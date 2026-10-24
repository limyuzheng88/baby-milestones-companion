// Understands free-text messages with one structured AI call, then acts through fixed, validated code paths.
// The AI never writes to the database directly: it proposes an intent, and this file checks it.
import { sgToday } from '../clock';
import { getChild, listChildren } from '../db/repo';
import { addNote, recordAnswer, type Ctx } from '../milestones/answers';
import { ageInWholeMonths, type Child } from '../milestones/age';
import { loadMilestones, type Milestone } from '../milestones/library';
import { showMilestones, type ListFilter } from '../milestones/list';
import { fillPlaceholders } from '../scheduler/compose';
import { SETTING_RULES, isSettingKey, parseSettingValue } from '../settings/rules';
import { getSetting, setSetting, type SettingKey } from '../settings/store';
import { escapeHtml, type Button } from '../telegram/client';
import type { IncomingCallback, IncomingMessage } from '../telegram/webhook';
import { findBannedWords } from '../tone/guard';
import { AiRefusal, type AiProvider } from './provider';
import { canSpend, recordUsage } from './spend';

export type RouterCtx = Ctx & { ai: AiProvider; aiTimeoutMs?: number };

export type Intent =
  | { kind: 'mark_milestone'; candidates: string[]; achievedOn: string | null }
  | { kind: 'add_note'; milestoneId: string | null; note: string }
  | { kind: 'change_setting'; key: SettingKey; value: unknown; childId?: number }
  | { kind: 'show_milestones'; filter: ListFilter }
  | { kind: 'question'; text: string }
  | { kind: 'other' };

export const FALLBACK_TEXT = "I didn't quite get that. You can use the buttons, or try saying it another way.";
const PAUSED_TEXT =
  "I've used this month's AI budget, so chat replies are paused until next month. Your daily reminders and the buttons still work as usual.";
const QUESTION_FOOTER = 'If anything worries you, your doctor or polyclinic is the best person to ask.';
const SAFE_ANSWER = `That's a good one to talk through with your doctor or polyclinic. I can only share what the milestone checklist says, and every child has their own timing.`;
const DEFAULT_TIMEOUT_MS = 10_000;

const nullableString = { type: ['string', 'null'] };
const INTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'candidates', 'achievedOn', 'milestoneId', 'note', 'settingKey', 'settingValue', 'filterStatus', 'filterDomain', 'question'],
  properties: {
    kind: { type: 'string', enum: ['mark_milestone', 'add_note', 'change_setting', 'show_milestones', 'question', 'other'] },
    candidates: { type: 'array', items: { type: 'string' } },
    achievedOn: nullableString,
    milestoneId: nullableString,
    note: nullableString,
    settingKey: nullableString,
    settingValue: nullableString,
    filterStatus: nullableString,
    filterDomain: nullableString,
    question: nullableString,
  },
};

class InvalidIntent extends Error {
  override name = 'InvalidIntent';
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('AI timeout')), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/** One AI call with timeout, usage recording and refusal handling. Throws on any failure. */
async function ask(ctx: RouterCtx, system: string, user: string, maxTokens: number, jsonSchema?: Record<string, unknown>): Promise<string> {
  try {
    const res = await withTimeout(ctx.ai.complete({ system, messages: [{ role: 'user', content: user }], maxTokens, jsonSchema }), ctx.aiTimeoutMs ?? DEFAULT_TIMEOUT_MS);
    await recordUsage(ctx.env.DB, ctx.ai.model, res.inputTokens, res.outputTokens, ctx.clock.now());
    return res.text;
  } catch (err) {
    if (err instanceof AiRefusal) await recordUsage(ctx.env.DB, ctx.ai.model, err.inputTokens, err.outputTokens, ctx.clock.now());
    throw err;
  }
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const isDate = (v: string | null) => v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Turns the model's JSON into an Intent, or throws InvalidIntent. */
export function parseIntent(text: string): Intent {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new InvalidIntent('not JSON');
  }
  if (typeof raw !== 'object' || raw === null) throw new InvalidIntent('not an object');
  switch (raw.kind) {
    case 'mark_milestone': {
      const candidates = Array.isArray(raw.candidates) ? raw.candidates.filter((c): c is string => typeof c === 'string') : [];
      const achievedOn = str(raw.achievedOn);
      return { kind: 'mark_milestone', candidates, achievedOn: isDate(achievedOn) ? achievedOn : null };
    }
    case 'add_note': {
      const note = str(raw.note);
      if (!note) throw new InvalidIntent('empty note');
      return { kind: 'add_note', milestoneId: str(raw.milestoneId), note };
    }
    case 'change_setting': {
      if (!isSettingKey(raw.settingKey)) throw new InvalidIntent('unknown setting');
      return { kind: 'change_setting', key: raw.settingKey, value: raw.settingValue };
    }
    case 'show_milestones': {
      const filter: ListFilter = {};
      if (['yes', 'not_yet', 'not_sure', 'unasked', 'coming_up'].includes(raw.filterStatus as string)) {
        filter.statuses = [raw.filterStatus as NonNullable<ListFilter['statuses']>[number]];
      }
      if (['movement', 'communication', 'social', 'thinking'].includes(raw.filterDomain as string)) filter.domain = raw.filterDomain as ListFilter['domain'];
      return { kind: 'show_milestones', filter };
    }
    case 'question': {
      const q = str(raw.question);
      if (!q) throw new InvalidIntent('empty question');
      return { kind: 'question', text: q };
    }
    case 'other':
      return { kind: 'other' };
    default:
      throw new InvalidIntent('unknown kind');
  }
}

/** Milestones worth putting in front of the model: everything up to six months ahead of the child's age. */
function relevant(child: Child, today: string, ms: readonly Milestone[]): Milestone[] {
  const age = ageInWholeMonths(child, today);
  return ms.filter((m) => m.bandStartMonths <= age + 6);
}

function classifierPrompt(child: Child, today: string, ms: Milestone[]): string {
  // Deliberately no names: the child is "the child", members are not mentioned.
  const settings = Object.entries(SETTING_RULES)
    .map(([k, r]) => `- ${k}: ${r.label}. Allowed: ${r.allowed}.`)
    .join('\n');
  const list = ms.map((m) => `- ${m.id} (${m.bandStartMonths}-${m.bandEndMonths} months, ${m.domain}): ${fillPlaceholders(m.wording, { ...child, name: 'The child' })}`).join('\n');
  return `You classify messages sent by a parent to a baby-milestone companion bot in Singapore.
Today is ${today} (Singapore). The child is ${ageInWholeMonths(child, today)} months old (pronoun: ${child.pronoun}).

Return JSON only. kind is one of:
- mark_milestone: the parent says the child did something. candidates = ids from the list below that match, best first (at most 3). achievedOn = YYYY-MM-DD if a day is given, else null.
- add_note: the parent wants to note something about a milestone. milestoneId = matching id or null. note = the note text, as written.
- change_setting: the parent wants a setting changed. settingKey = one key below. settingValue = the new value as a string in the allowed format (use "null" to clear).
- show_milestones: the parent wants to see the milestone list. filterStatus = yes | not_yet | not_sure | unasked | coming_up, or null for all. filterDomain = movement | communication | social | thinking, or null for all.
- question: a question about development or milestones. question = the question.
- other: anything else.
Unused fields are null (candidates is [] when unused). Never invent ids.

Milestones:
${list}

Settings:
${settings}`;
}

function questionPrompt(child: Child, today: string, ms: Milestone[]): string {
  const list = ms.map((m) => `- (${m.bandStartMonths}-${m.bandEndMonths} months, source ${m.source}) ${fillPlaceholders(m.wording, { ...child, name: 'The child' })}`).join('\n');
  return `You answer a parent's question for a gentle baby-milestone companion in Singapore. Today is ${today}. The child is ${ageInWholeMonths(child, today)} months old.
Answer ONLY from the milestone checklist below, in two to four short, warm sentences, and name the source (for example "the HPB checklist").
Babies vary widely: never compare, rank or worry the parent. Never use the words delayed, behind, missed, should or failed.
For any health or development worry, say to raise it with their doctor or polyclinic. Do not give medical advice. If the checklist doesn't cover it, say so.
Plain text only, no markdown.

Checklist:
${list}`;
}

function dateLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
}

async function reply(ctx: RouterCtx, chatId: number, text: string, buttons?: Button[][]): Promise<void> {
  await ctx.tg.sendMessage(chatId, text, buttons);
}

export async function routeMessage(m: IncomingMessage, ctx: RouterCtx): Promise<void> {
  const db = ctx.env.DB;
  const children = await listChildren(db, ctx.env.ENCRYPTION_KEY);
  const child = children[0];
  if (!child) return reply(ctx, m.chatId, "Let's add your child first. Send /start to set things up.");
  if (!(await canSpend(db, ctx.clock, await getSetting(db, 'ai.monthlyCapUsd')))) return reply(ctx, m.chatId, PAUSED_TEXT);

  const today = sgToday(ctx.clock);
  const ms = relevant(child, today, await loadMilestones(db));
  let intent: Intent;
  try {
    intent = parseIntent(await ask(ctx, classifierPrompt(child, today, ms), m.text.slice(0, 2000), 400, INTENT_SCHEMA));
  } catch (err) {
    console.error('router: classify failed', { error: (err as Error).name });
    return reply(ctx, m.chatId, FALLBACK_TEXT);
  }

  switch (intent.kind) {
    case 'mark_milestone':
      return confirmMark(ctx, m.chatId, child, ms, intent, today);
    case 'add_note': {
      const target = ms.find((x) => x.id === intent.milestoneId);
      if (!target) return reply(ctx, m.chatId, 'Which milestone is this note for? You can reply to its check-in message, or tap "Add a note" there.');
      await addNote(db, ctx.env.ENCRYPTION_KEY, child.id, target.id, intent.note, m.from.telegramUserId, ctx.clock.now());
      return reply(ctx, m.chatId, `📝 Saved your note for ${escapeHtml(child.name)}: ${escapeHtml(fillPlaceholders(target.wording, child))}.`);
    }
    case 'change_setting':
      return changeSetting(ctx, m, intent.key, intent.value);
    case 'show_milestones':
      return showMilestones(ctx, m.chatId, intent.filter);
    case 'question':
      return answerQuestion(ctx, m.chatId, child, today, ms, intent.text);
    case 'other':
      return reply(ctx, m.chatId, FALLBACK_TEXT);
  }
}

async function confirmMark(ctx: RouterCtx, chatId: number, child: Child, ms: Milestone[], intent: { candidates: string[]; achievedOn: string | null }, today: string) {
  const found = intent.candidates.map((id) => ms.find((x) => x.id === id)).filter((x): x is Milestone => !!x).slice(0, 3);
  if (!found.length) return reply(ctx, chatId, FALLBACK_TEXT);
  const on = intent.achievedOn && intent.achievedOn <= today ? intent.achievedOn : today;
  const compact = on.replaceAll('-', '');
  const data = (m: Milestone) => `mk:${child.id}:${m.id}:${compact}`;
  if (found.length === 1) {
    const m = found[0]!;
    return reply(ctx, chatId, `Mark "${escapeHtml(fillPlaceholders(m.wording, child))}" as done on ${dateLabel(on)}?`, [
      [{ text: 'Yes', data: data(m) }, { text: 'Not this one', data: 'mk:no' }],
    ]);
  }
  return reply(ctx, chatId, `Which one did ${escapeHtml(child.name)} do? I'll note it for ${dateLabel(on)}.`, [
    ...found.map((m) => [{ text: fillPlaceholders(m.wording, child).slice(0, 60), data: data(m) }]),
    [{ text: 'None of these', data: 'mk:no' }],
  ]);
}

async function changeSetting(ctx: RouterCtx, m: IncomingMessage, key: SettingKey, raw: unknown): Promise<void> {
  const rule = SETTING_RULES[key];
  if (rule.ownerOnly && m.from.role !== 'owner') return reply(ctx, m.chatId, `Only the owner can change the ${rule.label}. I've left it as it is.`);
  const value = parseSettingValue(key, raw);
  if (value === undefined) return reply(ctx, m.chatId, `I can't set the ${rule.label} to that. It takes ${rule.allowed}.`);
  const db = ctx.env.DB;
  const old = await getSetting(db, key);
  await setSetting(db, key, value as never, m.from.telegramUserId);
  const fmt = rule.format as (v: unknown) => string;
  return reply(ctx, m.chatId, `Done. The ${rule.label} changed from ${escapeHtml(fmt(old))} to ${escapeHtml(fmt(value))}.`, [
    [{ text: 'Undo', data: `undo:${key}:${JSON.stringify(old)}` }],
  ]);
}

async function answerQuestion(ctx: RouterCtx, chatId: number, child: Child, today: string, ms: Milestone[], question: string): Promise<void> {
  let answer: string;
  try {
    answer = (await ask(ctx, questionPrompt(child, today, ms), question.slice(0, 1000), 400)).trim();
  } catch (err) {
    console.error('router: answer failed', { error: (err as Error).name });
    return reply(ctx, chatId, FALLBACK_TEXT);
  }
  // AI-written text must pass the tone guard, or a fixed safe answer goes instead.
  const safe = answer && !findBannedWords(answer).length ? answer : SAFE_ANSWER;
  return reply(ctx, chatId, `${escapeHtml(safe)}\n\n${QUESTION_FOOTER}`);
}

/** Buttons the router created: mk:* (confirm a milestone) and undo:* (revert a setting). */
export async function handleRouterCallback(c: IncomingCallback, ctx: Ctx): Promise<void> {
  const db = ctx.env.DB;
  await ctx.tg.answerCallbackQuery(c.callbackId);

  if (c.data === 'mk:no') {
    await ctx.tg.editMessageText(c.chatId, c.messageId, 'No problem, nothing changed.');
    return;
  }
  const mk = /^mk:(\d+):([a-z0-9-]+):(\d{8})$/.exec(c.data);
  if (mk) {
    const child = await getChild(db, ctx.env.ENCRYPTION_KEY, Number(mk[1]));
    const milestone = (await loadMilestones(db)).find((x) => x.id === mk[2]);
    const on = `${mk[3]!.slice(0, 4)}-${mk[3]!.slice(4, 6)}-${mk[3]!.slice(6)}`;
    if (!child || !milestone || on > sgToday(ctx.clock)) return;
    await recordAnswer(db, child.id, milestone.id, 'yes', c.from.telegramUserId, on, ctx.clock.now());
    await ctx.tg.editMessageText(c.chatId, c.messageId, `🎉 Lovely! Noted: ${escapeHtml(fillPlaceholders(milestone.wording, child))} (${dateLabel(on)}).`);
    return;
  }
  const undo = /^undo:([a-zA-Z.]+):(.*)$/.exec(c.data);
  if (undo && isSettingKey(undo[1])) {
    const key = undo[1];
    const rule = SETTING_RULES[key];
    if (rule.ownerOnly && c.from.role !== 'owner') return;
    let raw: unknown;
    try {
      raw = JSON.parse(undo[2]!);
    } catch {
      return;
    }
    const value = parseSettingValue(key, raw);
    if (value === undefined) return;
    await setSetting(db, key, value as never, c.from.telegramUserId);
    await ctx.tg.editMessageText(c.chatId, c.messageId, `Undone. The ${rule.label} is back to ${escapeHtml((rule.format as (v: unknown) => string)(value))}.`);
  }
}
