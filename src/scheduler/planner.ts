// Decides what a child's daily note holds. Pure: no clock, no I/O. Catch-up is built in, because
// every rule asks "is it due and not yet sent" rather than "is it exactly today".
import { addDays, addMonths, effectiveBirthDate, type Child } from '../milestones/age';
import { bandsOf, type Milestone } from '../milestones/library';

export type Status = { status: 'yes' | 'not_yet' | 'not_sure'; answeredAt: string; followUpSent: boolean };

export type Band = { startMonths: number; endMonths: number };

export type DueItem =
  | { kind: 'heads_up'; band: Band; milestones: Milestone[] }
  | { kind: 'check_in'; milestone: Milestone }
  | { kind: 'follow_up'; milestone: Milestone }
  | { kind: 'pre_checkup'; checkupDate: string; open: Milestone[] };

export type Cadence = { headsUpDays: number; followUpDays: number; preCheckupDays: number; checkInsPerDay: number };

export type PlanInput = {
  child: Child;
  today: string;
  milestones: readonly Milestone[];
  statuses: Map<string, Status>;
  sent: Set<string>;
  checkups: string[];
  cadence: Cadence;
  pausedUntil: string | null;
};

export function sentKey(item: DueItem): string {
  switch (item.kind) {
    case 'heads_up':
      return `heads_up:${item.band.startMonths}`;
    case 'check_in':
    case 'follow_up':
      return `${item.kind}:${item.milestone.id}`;
    case 'pre_checkup':
      return `pre_checkup:${item.checkupDate}`;
  }
}

/** Singapore calendar date of a UTC ISO timestamp. */
function sgDateOf(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function planDay(input: PlanInput): DueItem[] {
  const { child, today, statuses, sent, cadence } = input;
  if (input.pausedUntil && today < input.pausedUntil) return [];

  const born = effectiveBirthDate(child);
  const opens = (months: number) => addMonths(born, months);
  const ms = [...input.milestones].sort((a, b) => a.bandStartMonths - b.bandStartMonths);
  const items: DueItem[] = [];

  for (const band of bandsOf(ms)) {
    const open = opens(band.startMonths);
    const item: DueItem = { kind: 'heads_up', band, milestones: ms.filter((m) => m.bandStartMonths === band.startMonths && m.bandEndMonths === band.endMonths) };
    if (today >= addDays(open, -cadence.headsUpDays) && today < open && !sent.has(sentKey(item))) items.push(item);
  }

  let checkIns = 0;
  for (const milestone of ms) {
    if (checkIns >= cadence.checkInsPerDay) break;
    const item: DueItem = { kind: 'check_in', milestone };
    const inWindow = today >= opens(milestone.bandStartMonths) && today <= opens(milestone.bandEndMonths);
    if (inWindow && !statuses.has(milestone.id) && !sent.has(sentKey(item))) {
      items.push(item);
      checkIns++;
    }
  }

  for (const milestone of ms) {
    const s = statuses.get(milestone.id);
    const item: DueItem = { kind: 'follow_up', milestone };
    if (!s || s.status === 'yes' || s.followUpSent || sent.has(sentKey(item))) continue;
    if (today >= addDays(sgDateOf(s.answeredAt), cadence.followUpDays)) items.push(item);
  }

  // Worth raising: answered "not yet"/"not sure", or never answered but asked about (or still in its window).
  // Items from windows that ended before the bot ever asked are left out, so a late start doesn't flood the list.
  const isOpenForVisit = (m: Milestone): boolean => {
    const s = statuses.get(m.id);
    if (s) return s.status !== 'yes';
    if (opens(m.bandStartMonths) > today) return false;
    return today <= opens(m.bandEndMonths) || sent.has(`check_in:${m.id}`);
  };

  for (const checkupDate of [...input.checkups].sort()) {
    const item: DueItem = {
      kind: 'pre_checkup',
      checkupDate,
      open: ms.filter((m) => isOpenForVisit(m)),
    };
    if (today >= addDays(checkupDate, -cadence.preCheckupDays) && today < checkupDate && !sent.has(sentKey(item))) items.push(item);
  }

  return items;
}
