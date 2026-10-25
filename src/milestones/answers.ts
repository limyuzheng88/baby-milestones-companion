// One-tap answers and notes on milestone check-ins.
import { sgToday, type Clock } from '../clock';
import { clearPending, getChild, getMessageRef, insertNote, listMembers, setPending, takePending, upsertStatus } from '../db/repo';
import type { Env } from '../env';
import { checkInButtons, checkInText, fillPlaceholders, milestoneHeader, type Answer } from '../scheduler/compose';
import { encrypt } from '../security/crypto';
import { escapeHtml, type TelegramClient } from '../telegram/client';
import type { IncomingCallback, IncomingMessage } from '../telegram/webhook';
import type { Child } from './age';
import { loadMilestones, type Milestone } from './library';

export type Ctx = { env: Env; tg: TelegramClient; clock: Clock };

const NOTE_WINDOW_MS = 30 * 60 * 1000;
const MAX_NOTE_LENGTH = 2000;
const ANSWERS: readonly string[] = ['yes', 'not_yet', 'not_sure', 'note', 'change'];

export async function recordAnswer(
  db: D1Database,
  childId: number,
  milestoneId: string,
  status: 'yes' | 'not_yet' | 'not_sure',
  by: number,
  achievedOn: string | null,
  at: Date,
  explicitDate = false,
): Promise<void> {
  await upsertStatus(db, childId, milestoneId, status, by, achievedOn, at, explicitDate);
}

export async function addNote(db: D1Database, key: string, childId: number, milestoneId: string, note: string, by: number, at: Date): Promise<void> {
  await insertNote(db, childId, milestoneId, await encrypt(note.slice(0, MAX_NOTE_LENGTH), key), by, at);
}

function parseData(data: string): { childId: number; milestoneId: string; answer: Answer } | null {
  const parts = data.split(':');
  if (parts.length !== 4 || parts[0] !== 'ms') return null;
  const [, child, milestoneId, answer] = parts as [string, string, string, string];
  if (!/^\d+$/.test(child) || !milestoneId || !ANSWERS.includes(answer)) return null;
  return { childId: Number(child), milestoneId, answer: answer as Answer };
}

async function lookup(ctx: Ctx, childId: number, milestoneId: string): Promise<{ child: Child; milestone: Milestone } | null> {
  const child = await getChild(ctx.env.DB, ctx.env.ENCRYPTION_KEY, childId);
  const milestone = (await loadMilestones(ctx.env.DB)).find((m) => m.id === milestoneId);
  return child && milestone ? { child, milestone } : null;
}

function answeredText(child: Child, m: Milestone, answer: 'yes' | 'not_yet' | 'not_sure', by: string, today: string): string {
  const fill = (s: string) => escapeHtml(fillPlaceholders(s, child));
  const who = escapeHtml(by);
  const result = {
    yes: `🎉 Lovely! Noted on ${today} by ${who}.`,
    not_yet: `Noted as not yet by ${who}. That's completely fine, every child has their own timing.\nSomething to try: ${fill(m.tip)}`,
    not_sure: `No problem, I'll check back in a couple of weeks. (${who})`,
  }[answer];
  return `${milestoneHeader(child, m)}\n${fill(m.wording)}\n\n${result}`;
}

const changeButton = (child: Child, milestoneId: string) => [[{ text: 'Change answer', data: `ms:${child.id}:${milestoneId}:change` }]];

export async function handleMilestoneCallback(c: IncomingCallback, ctx: Ctx): Promise<void> {
  const parsed = parseData(c.data);
  const found = parsed && (await lookup(ctx, parsed.childId, parsed.milestoneId));
  if (!parsed || !found) {
    await ctx.tg.answerCallbackQuery(c.callbackId, 'That button has expired.');
    return;
  }
  const { child, milestone } = found;
  const db = ctx.env.DB;
  const now = ctx.clock.now();
  await ctx.tg.answerCallbackQuery(c.callbackId);

  if (parsed.answer === 'change') {
    const members = await listMembers(db);
    await ctx.tg.editMessageText(c.chatId, c.messageId, checkInText(child, milestone, members.length), checkInButtons(child, milestone.id));
    return;
  }
  if (parsed.answer === 'note') {
    await setPending(db, c.from.telegramUserId, 'note', { childId: child.id, milestoneId: milestone.id }, new Date(now.getTime() + NOTE_WINDOW_MS));
    const wording = escapeHtml(fillPlaceholders(milestone.wording, child));
    await ctx.tg.sendMessage(c.chatId, `What would you like to note? Just type it and I'll save it with ${escapeHtml(child.name)}'s "${wording}".`);
    return;
  }
  const today = sgToday(ctx.clock);
  await recordAnswer(db, child.id, milestone.id, parsed.answer, c.from.telegramUserId, parsed.answer === 'yes' ? today : null, now);
  await ctx.tg.editMessageText(c.chatId, c.messageId, answeredText(child, milestone, parsed.answer, c.from.displayName, today), changeButton(child, milestone.id));
}

/** Saves the message as a note if one is pending or it replies to a check-in. Returns true if consumed. */
export async function handlePendingNote(m: IncomingMessage, ctx: Ctx): Promise<boolean> {
  const db = ctx.env.DB;
  const userId = m.from.telegramUserId;
  const now = ctx.clock.now();
  const text = m.text.trim();
  if (!text) return false;
  if (text.startsWith('/')) {
    await clearPending(db, userId);
    return false;
  }

  let target: { childId: number; milestoneId: string } | null = null;
  if (m.replyToMessageId !== undefined) target = await getMessageRef(db, m.chatId, m.replyToMessageId);
  if (!target) {
    const pending = await takePending(db, userId, now);
    if (pending?.kind === 'note') target = pending.payload as { childId: number; milestoneId: string };
  }
  if (!target) return false;
  const found = await lookup(ctx, target.childId, target.milestoneId);
  await clearPending(db, userId);
  if (!found) return false;

  await addNote(db, ctx.env.ENCRYPTION_KEY, found.child.id, found.milestone.id, text, userId, now);
  await ctx.tg.sendMessage(m.chatId, `📝 Saved your note for ${escapeHtml(found.child.name)}: ${escapeHtml(fillPlaceholders(found.milestone.wording, found.child))}.`);
  return true;
}
