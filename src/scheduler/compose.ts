// Turns planned items into Telegram messages. Fixed templates, no AI, so the tone is always gentle.
import type { Child } from '../milestones/age';
import type { Domain, Milestone } from '../milestones/library';
import { escapeHtml, type Button } from '../telegram/client';
import type { Band, DueItem } from './planner';

export type OutgoingMessage = { text: string; buttons: Button[][]; milestoneId?: string };

export type Answer = 'yes' | 'not_yet' | 'not_sure' | 'note' | 'change';

const TELEGRAM_LIMIT = 4096;

const FORMS = {
  she: { subject: 'she', object: 'her', possessive: 'her', doing: "She's doing it" },
  he: { subject: 'he', object: 'him', possessive: 'his', doing: "He's doing it" },
  they: { subject: 'they', object: 'them', possessive: 'their', doing: "They're doing it" },
} as const;

const DOMAIN_LABEL: Record<Domain, string> = {
  movement: 'Moving',
  communication: 'Talking and listening',
  social: 'Playing and people',
  thinking: 'Exploring and thinking',
};

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Fills {pronoun}/{Pronoun}/{object}/{possessive}. Library wording is third-person singular,
 * so for "they" the subject is the child's name ("Test Baby smiles", not "they smiles").
 */
export function fillPlaceholders(text: string, child: Child): string {
  const f = FORMS[child.pronoun];
  const subject = child.pronoun === 'they' ? child.name : f.subject;
  return text
    .replaceAll('{Pronoun}', child.pronoun === 'they' ? child.name : capitalise(subject))
    .replaceAll('{pronoun}', subject)
    .replaceAll('{object}', f.object)
    .replaceAll('{possessive}', f.possessive);
}

export function callbackData(childId: number, milestoneId: string, answer: Answer): string {
  return `ms:${childId}:${milestoneId}:${answer}`;
}

export function checkInButtons(child: Child, milestoneId: string): Button[][] {
  const b = (text: string, answer: Answer): Button => ({ text, data: callbackData(child.id, milestoneId, answer) });
  return [[b(FORMS[child.pronoun].doing, 'yes')], [b('Not yet', 'not_yet'), b('Not sure', 'not_sure')], [b('Add a note', 'note')]];
}

function bandLabel(band: Band): string {
  if (band.startMonths >= 24 && band.startMonths % 12 === 0 && band.endMonths % 12 === 0) {
    return `${band.startMonths / 12} to ${band.endMonths / 12} years`;
  }
  return `${band.startMonths} to ${band.endMonths} months`;
}

function dateLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
}

/** Splits lines into messages under the limit, repeating the header so every message names the child. */
function chunk(header: string, lines: string[]): string[] {
  const out: string[] = [];
  let current = header;
  for (const line of lines) {
    const piece = line.length > TELEGRAM_LIMIT - header.length - 2 ? line.slice(0, TELEGRAM_LIMIT - header.length - 3) + '…' : line;
    if (current.length + 1 + piece.length > TELEGRAM_LIMIT) {
      out.push(current);
      current = header;
    }
    current += `\n${piece}`;
  }
  out.push(current);
  return out;
}

/** First line of every milestone message: the child's name and the area of development. */
export function milestoneHeader(child: Child, m: Milestone): string {
  return `<b>${escapeHtml(child.name)}</b> · ${DOMAIN_LABEL[m.domain]}`;
}

export function checkInText(child: Child, m: Milestone, memberCount: number): string {
  const fill = (s: string) => escapeHtml(fillPlaceholders(s, child));
  const anyone = memberCount > 1 ? '\nAnyone here can tap.' : '';
  return `${milestoneHeader(child, m)}\n${fill(m.wording)}?\n\nPlay idea: ${fill(m.tip)}\n\nTap whatever fits today. There's no wrong answer.${anyone}`;
}

export function composeDailyNote(child: Child, items: DueItem[], memberCount: number): OutgoingMessage[] {
  if (!items.length) return [];
  const name = escapeHtml(child.name);
  const fill = (s: string) => escapeHtml(fillPlaceholders(s, child));
  const possessive = FORMS[child.pronoun].possessive;
  const anyone = memberCount > 1 ? '\nAnyone here can tap.' : '';
  const messages: OutgoingMessage[] = [];

  for (const item of items) {
    if (item.kind === 'heads_up') {
      const header = `🌱 <b>${name}</b>: Things to look forward to`;
      const lines = [
        `Around ${bandLabel(item.band)}, you might start to notice:`,
        ...item.milestones.map((m) => `• ${fill(m.wording)}`),
        `Babies vary widely, so think of this as a peek ahead, not a checklist. I'll ask gently once the time comes.`,
      ];
      for (const text of chunk(header, lines)) messages.push({ text, buttons: [] });
    } else if (item.kind === 'pre_checkup') {
      const header = `🩺 <b>${name}</b> has a check-up on ${dateLabel(item.checkupDate)}`;
      const lines = item.open.length
        ? [`Things worth mentioning at ${possessive} next visit:`, ...item.open.map((m) => `• ${fill(m.wording)}`)]
        : ['Nothing open on the milestone list right now.'];
      lines.push('Remember to bring the Health Booklet. The doctor is the best person to talk any of this through with.');
      for (const text of chunk(header, lines)) messages.push({ text, buttons: [] });
    }
  }

  for (const item of items) {
    if (item.kind !== 'check_in' && item.kind !== 'follow_up') continue;
    const m = item.milestone;
    const text =
      item.kind === 'check_in'
        ? checkInText(child, m, memberCount)
        : `${milestoneHeader(child, m)}\nChecking back in, no rush: ${fill(m.wording)}?\n\nEvery child gets there in their own time. Another go at this play idea: ${fill(m.tip)}${anyone}`;
    messages.push({ text: text.slice(0, TELEGRAM_LIMIT), buttons: checkInButtons(child, m.id), milestoneId: m.id });
  }
  return messages;
}
