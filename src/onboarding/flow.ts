// First-run setup, owned by the owner: name → pronoun → birth date → due date → corrected age → next check-up.
// Dates are parsed here in code, never by the AI.
import { sgToday } from '../clock';
import { clearPending, listChildren, setPending, takePending } from '../db/repo';
import { addDays, type Child } from '../milestones/age';
import type { Ctx } from '../milestones/answers';
import { encrypt } from '../security/crypto';
import { getSetting } from '../settings/store';
import { escapeHtml, type Button } from '../telegram/client';
import type { IncomingCallback, IncomingMessage } from '../telegram/webhook';

type Step = 'name' | 'pronoun' | 'birth' | 'due' | 'due_required' | 'corrected' | 'checkup';
type State = { step: Step; name?: string; pronoun?: Child['pronoun']; birthDate?: string | null; dueDate?: string | null; useCorrectedAge?: boolean };

const KIND = 'onboarding';
const STATE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_NAME = 40;
const CORRECTED_AGE_THRESHOLD_DAYS = 21;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function validYmd(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Reads "2026-03-10", "10 Mar 2026", "10 March 2026" or "10/3/2026" (day first, as in Singapore). */
export function parseDate(text: string): string | null {
  const t = text.trim().toLowerCase();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) return validYmd(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{4})$/.exec(t);
  if (m) {
    const month = MONTHS.indexOf(m[2]!.slice(0, 3));
    if (month >= 0 && (m[2]!.length === 3 || 'january february march april may june july august september october november december'.split(' ')[month]!.startsWith(m[2]!))) {
      return validYmd(Number(m[3]), month + 1, Number(m[1]));
    }
  }
  return null;
}

function niceDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
}

function niceTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}

const PRIVACY_LINE =
  'Please keep personal data out of this chat: no ID numbers, phone numbers, addresses, passwords, bank details, or photos of faces or bodies.';

async function save(ctx: Ctx, userId: number, state: State): Promise<void> {
  await setPending(ctx.env.DB, userId, KIND, state, new Date(ctx.clock.now().getTime() + STATE_TTL_MS));
}

async function load(ctx: Ctx, userId: number): Promise<State | null> {
  const p = await takePending(ctx.env.DB, userId, ctx.clock.now());
  return p?.kind === KIND ? (p.payload as State) : null;
}

async function ask(ctx: Ctx, chatId: number, state: State, lead?: string): Promise<void> {
  const name = escapeHtml(state.name ?? 'your child');
  const send = (text: string, buttons?: Button[][]) => ctx.tg.sendMessage(chatId, lead ? `${lead}\n\n${text}` : text, buttons);
  switch (state.step) {
    case 'name':
      return void (await send("Hi! I'm your milestone companion. I'll send gentle notes about what to look forward to, and you can tell me how things are going.\n\nWhat should I call your child? A first name or nickname is enough."));
    case 'pronoun':
      return void (await send(`Lovely. Should I say she, he or they for ${name}?`, [
        [{ text: 'She', data: 'ob:pronoun:she' }, { text: 'He', data: 'ob:pronoun:he' }, { text: 'They', data: 'ob:pronoun:they' }],
      ]));
    case 'birth':
      return void (await send(`When was ${name} born? For example 10 Mar 2026.`, [[{ text: 'Not born yet', data: 'ob:unborn' }]]));
    case 'due':
      return void (await send(`What was the due date? It helps if ${name} arrived early. For example 28 Mar 2026.`, [[{ text: 'Skip', data: 'ob:skip' }]]));
    case 'due_required':
      return void (await send(`When is ${name} due? For example 28 Mar 2026.`));
    case 'corrected':
      return void (await send(
        `${name} arrived more than three weeks before the due date. Many doctors use corrected age (counted from the due date) for milestones in the first two years. Should I?`,
        [[{ text: 'Yes, use corrected age', data: 'ob:corrected:yes' }], [{ text: 'No, use birth date', data: 'ob:corrected:no' }]],
      ));
    case 'checkup':
      return void (await send(`When is ${name}'s next check-up? I'll remind you a week before. For example 20 Apr 2026.`, [[{ text: 'Skip', data: 'ob:skip' }]]));
  }
}

async function summary(ctx: Ctx, chatId: number, children: Child[]): Promise<void> {
  const time = niceTime(await getSetting(ctx.env.DB, 'note.time'));
  const lines = children.map((c) => {
    const born = c.birthDate ? `born ${niceDate(c.birthDate)}` : `due ${niceDate(c.dueDate!)}`;
    return `• <b>${escapeHtml(c.name)}</b>, ${born}${c.useCorrectedAge ? ', using corrected age' : ''}`;
  });
  await ctx.tg.sendMessage(
    chatId,
    `All set!\n${lines.join('\n')}\n\nDaily notes come at ${time} Singapore time, only on days there's something to share. You can change that anytime, for example "send notes at 8pm".\nSend /show_milestones for the list, or /help for more.\n\n${PRIVACY_LINE}`,
  );
}

/** After the birth and due dates: ask about corrected age only when the birth was over three weeks early. */
function afterDates(state: State): State {
  const early = state.birthDate && state.dueDate && addDays(state.birthDate, CORRECTED_AGE_THRESHOLD_DAYS) < state.dueDate;
  return { ...state, step: early ? 'corrected' : 'checkup' };
}

async function finish(ctx: Ctx, m: { chatId: number; from: { telegramUserId: number } }, state: State, checkup: string | null): Promise<void> {
  const db = ctx.env.DB;
  const res = await db
    .prepare('INSERT INTO children (name_enc, pronoun, birth_date, due_date, use_corrected_age, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await encrypt(state.name!, ctx.env.ENCRYPTION_KEY), state.pronoun!, state.birthDate ?? null, state.dueDate ?? null, state.useCorrectedAge ? 1 : 0, ctx.clock.now().toISOString())
    .run();
  if (checkup) await db.prepare('INSERT INTO checkups (child_id, date) VALUES (?, ?)').bind(res.meta.last_row_id, checkup).run();
  await clearPending(db, m.from.telegramUserId);
  await summary(ctx, m.chatId, await listChildren(db, ctx.env.ENCRYPTION_KEY));
}

/** True while onboarding owns the conversation (or handled /start). */
export async function handleOnboarding(m: IncomingMessage, ctx: Ctx): Promise<boolean> {
  const userId = m.from.telegramUserId;
  const text = m.text.trim();
  if (text === '/start' || text.startsWith('/start ')) {
    const children = await listChildren(ctx.env.DB, ctx.env.ENCRYPTION_KEY);
    if (children.length) {
      await summary(ctx, m.chatId, children);
    } else if (m.from.role !== 'owner') {
      await ctx.tg.sendMessage(m.chatId, "Hi! The owner hasn't finished setting things up yet. I'll be ready once they have.");
    } else {
      const state: State = { step: 'name' };
      await save(ctx, userId, state);
      await ask(ctx, m.chatId, state);
    }
    return true;
  }

  const state = await load(ctx, userId);
  if (!state || m.from.role !== 'owner') return false;
  const today = sgToday(ctx.clock);
  const retry = (why: string) => ask(ctx, m.chatId, state, why);

  switch (state.step) {
    case 'name': {
      if (!text || text.length > MAX_NAME || /[\n<>]/.test(text)) return retry(`Could you send a shorter name, up to ${MAX_NAME} letters, on one line?`).then(() => true);
      const next: State = { ...state, name: text, step: 'pronoun' };
      await save(ctx, userId, next);
      await ask(ctx, m.chatId, next);
      return true;
    }
    case 'birth':
    case 'due':
    case 'due_required':
    case 'checkup': {
      const date = parseDate(text);
      if (!date) return retry("Sorry, I couldn't read that date. Could you try it like 10 Mar 2026?").then(() => true);
      if (state.step === 'birth') {
        if (date > today) return retry(`That date is in the future. If ${escapeHtml(state.name!)} isn't born yet, tap "Not born yet".`).then(() => true);
        const next: State = { ...state, birthDate: date, step: 'due' };
        await save(ctx, userId, next);
        await ask(ctx, m.chatId, next);
        return true;
      }
      if (state.step === 'checkup') {
        if (date < today) return retry('That date has passed. When is the next one?').then(() => true);
        await finish(ctx, m, state, date);
        return true;
      }
      const next = afterDates({ ...state, dueDate: date });
      await save(ctx, userId, next);
      await ask(ctx, m.chatId, next);
      return true;
    }
    case 'pronoun':
    case 'corrected':
      // These steps take a button; re-show it.
      await ask(ctx, m.chatId, state);
      return true;
  }
}

export async function handleOnboardingCallback(c: IncomingCallback, ctx: Ctx): Promise<void> {
  await ctx.tg.answerCallbackQuery(c.callbackId);
  if (c.from.role !== 'owner') return;
  const state = await load(ctx, c.from.telegramUserId);
  if (!state) return;
  const userId = c.from.telegramUserId;
  const go = async (next: State) => {
    await save(ctx, userId, next);
    await ask(ctx, c.chatId, next);
  };

  const pronoun = /^ob:pronoun:(she|he|they)$/.exec(c.data);
  if (pronoun && state.step === 'pronoun') return go({ ...state, pronoun: pronoun[1] as Child['pronoun'], step: 'birth' });
  if (c.data === 'ob:unborn' && state.step === 'birth') return go({ ...state, birthDate: null, step: 'due_required' });
  if (c.data === 'ob:skip' && state.step === 'due') return go(afterDates({ ...state, dueDate: null }));
  if (c.data === 'ob:skip' && state.step === 'checkup') return finish(ctx, c, state, null);
  const corrected = /^ob:corrected:(yes|no)$/.exec(c.data);
  if (corrected && state.step === 'corrected') return go({ ...state, useCorrectedAge: corrected[1] === 'yes', step: 'checkup' });
}
