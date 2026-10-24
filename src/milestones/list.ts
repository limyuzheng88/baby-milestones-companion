// /show_milestones rendering and filters.
import { sgToday, type Clock } from '../clock';
import { getListStatuses, getNotes, listChildren } from '../db/repo';
import type { Env } from '../env';
import type { TelegramClient } from '../telegram/client';
import { bandLabel, chunk, fillPlaceholders } from '../scheduler/compose';
import type { Status } from '../scheduler/planner';
import { escapeHtml } from '../telegram/client';
import { addMonths, effectiveBirthDate, type Child } from './age';
import { bandsOf, loadMilestones, type Domain, type Milestone } from './library';

export type ListFilter = {
  bandStartMonths?: number;
  /** 'unasked' = window open, no answer yet; 'coming_up' = window not open yet. */
  statuses?: ('yes' | 'not_yet' | 'not_sure' | 'unasked' | 'coming_up')[];
  domain?: Domain;
};

export type ListStatus = Status & { achievedOn: string | null };

type Shown = NonNullable<ListFilter['statuses']>[number];

function dateLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
}

export function renderMilestoneList(
  child: Child,
  today: string,
  milestones: readonly Milestone[],
  statuses: Map<string, ListStatus>,
  notes: Map<string, string[]>,
  filter: ListFilter,
): string[] {
  const born = effectiveBirthDate(child);
  const fill = (s: string) => escapeHtml(fillPlaceholders(s, child));
  const lines: string[] = [];

  for (const band of bandsOf(milestones)) {
    if (filter.bandStartMonths !== undefined && band.startMonths !== filter.bandStartMonths) continue;
    const open = addMonths(born, band.startMonths) <= today;
    const items = milestones.filter(
      (m) => m.bandStartMonths === band.startMonths && m.bandEndMonths === band.endMonths && (!filter.domain || m.domain === filter.domain),
    );
    const rows: string[] = [];
    for (const m of items) {
      const s = statuses.get(m.id);
      const shown: Shown = s ? s.status : open ? 'unasked' : 'coming_up';
      if (filter.statuses && !filter.statuses.includes(shown)) continue;
      const line =
        shown === 'yes'
          ? `✓ ${fill(m.wording)}${s?.achievedOn ? ` (${dateLabel(s.achievedOn)})` : ''}`
          : shown === 'not_yet'
            ? `○ ${fill(m.wording)}: not yet`
            : shown === 'not_sure'
              ? `○ ${fill(m.wording)}: not sure`
              : shown === 'unasked'
                ? `○ ${fill(m.wording)}`
                : `· ${fill(m.wording)}`;
      rows.push(line, ...(notes.get(m.id) ?? []).map((n) => `   📝 ${escapeHtml(n)}`));
    }
    if (rows.length) lines.push('', `<b>${bandLabel(band)}</b>${open ? '' : ' (coming up)'}`, ...rows);
  }

  const header = `📋 <b>${escapeHtml(child.name)}</b>: milestones`;
  if (!lines.length) return [`${header}\nNothing to show for that filter yet.`];
  return chunk(header, lines);
}

/** Sends the list for each child. */
export async function showMilestones(ctx: { env: Env; tg: TelegramClient; clock: Clock }, chatId: number, filter: ListFilter): Promise<void> {
  const { DB: db, ENCRYPTION_KEY: key } = ctx.env;
  const children = await listChildren(db, key);
  if (!children.length) {
    await ctx.tg.sendMessage(chatId, "There's no child set up yet. The owner can send /start to begin.");
    return;
  }
  const milestones = await loadMilestones(db);
  for (const child of children) {
    const msgs = renderMilestoneList(child, sgToday(ctx.clock), milestones, await getListStatuses(db, child.id), await getNotes(db, key, child.id), filter);
    for (const text of msgs) await ctx.tg.sendMessage(chatId, text);
  }
}
