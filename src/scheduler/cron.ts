// Hourly run: at or after each child's note time (Singapore), plan, compose and send the day's note once.
import { sgToday, type Clock } from '../clock';
import {
  addMessageRef,
  getSentKeys,
  getStatuses,
  listChildren,
  listMembers,
  markFollowUpSent,
  recordSent,
  upcomingCheckups,
} from '../db/repo';
import type { Env } from '../env';
import type { Child } from '../milestones/age';
import { loadMilestones, type Milestone } from '../milestones/library';
import type { Member } from '../db/repo';
import { getSetting } from '../settings/store';
import type { TelegramClient } from '../telegram/client';
import { composeDailyNote } from './compose';
import { planDay, sentKey } from './planner';

type Deps = { clock: Clock; tg: TelegramClient };

/** Minutes since midnight in Singapore. */
function sgMinutes(clock: Clock): number {
  const d = new Date(clock.now().getTime() + 8 * 60 * 60 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function noteMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 9) * 60 + (m ?? 0);
}

export async function runHourly(env: Env, deps: Deps): Promise<void> {
  const members = await listMembers(env.DB);
  if (!members.length) return;
  const milestones = await loadMilestones(env.DB);
  for (const child of await listChildren(env.DB, env.ENCRYPTION_KEY)) {
    try {
      await runForChild(env, deps, child, members, milestones);
    } catch (err) {
      // Never log content: only which step failed.
      console.error('daily note failed', { childId: child.id, error: (err as Error).name });
    }
  }
}

async function runForChild(env: Env, deps: Deps, child: Child, members: Member[], milestones: readonly Milestone[]): Promise<void> {
  const db = env.DB;
  const today = sgToday(deps.clock);
  if (sgMinutes(deps.clock) < noteMinutes(await getSetting(db, 'note.time', child.id))) return;
  const sent = await getSentKeys(db, child.id);
  const noteKey = `daily_note:${today}`;
  if (sent.has(noteKey)) return;

  const items = planDay({
    child,
    today,
    milestones,
    statuses: await getStatuses(db, child.id),
    sent,
    checkups: await upcomingCheckups(db, child.id, today),
    cadence: {
      headsUpDays: await getSetting(db, 'cadence.headsUpDays', child.id),
      followUpDays: await getSetting(db, 'cadence.followUpDays', child.id),
      preCheckupDays: await getSetting(db, 'cadence.preCheckupDays', child.id),
      checkInsPerDay: await getSetting(db, 'cadence.checkInsPerDay', child.id),
    },
    pausedUntil: await getSetting(db, 'milestones.pausedUntil', child.id),
  });
  if (!items.length) return;

  // Claim the day first so an overlapping run cannot send twice.
  const claim = await db.prepare("INSERT OR IGNORE INTO sent_log (kind, child_id, ref, sent_on) VALUES ('daily_note', ?, ?, ?)").bind(child.id, today, today).run();
  if (claim.meta.changes !== 1) return;

  const messages = composeDailyNote(child, items, members.length);
  let delivered = 0;
  for (const member of members) {
    try {
      for (const msg of messages) {
        const { messageId } = await deps.tg.sendMessage(member.chatId, msg.text, msg.buttons.length ? msg.buttons : undefined);
        if (msg.milestoneId) await addMessageRef(db, member.chatId, messageId, child.id, msg.milestoneId);
      }
      delivered++;
    } catch (err) {
      console.error('send failed', { childId: child.id, error: (err as Error).name });
    }
  }

  if (!delivered) {
    // Nobody got it: release the claim so the next hourly run tries again.
    await db.prepare("DELETE FROM sent_log WHERE kind = 'daily_note' AND child_id = ? AND ref = ?").bind(child.id, today).run();
    return;
  }
  await recordSent(db, child.id, items.map(sentKey), today);
  for (const item of items) if (item.kind === 'follow_up') await markFollowUpSent(db, child.id, item.milestone.id);
}
