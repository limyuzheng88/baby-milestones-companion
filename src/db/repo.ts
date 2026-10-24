// D1 access. Each function is one query or one small transaction; no business rules here.
import type { Child } from '../milestones/age';
import type { Status } from '../scheduler/planner';
import { decrypt } from '../security/crypto';

export type Member = {
  telegramUserId: number;
  displayName: string;
  role: 'owner' | 'member';
  chatId: number;
};

type MemberRow = { telegram_user_id: number; display_name: string; role: 'owner' | 'member'; chat_id: number };

const toMember = (r: MemberRow): Member => ({
  telegramUserId: r.telegram_user_id,
  displayName: r.display_name,
  role: r.role,
  chatId: r.chat_id,
});

export async function getMember(db: D1Database, telegramUserId: number): Promise<Member | null> {
  const r = await db.prepare('SELECT * FROM members WHERE telegram_user_id = ?').bind(telegramUserId).first<MemberRow>();
  return r ? toMember(r) : null;
}

export async function listMembers(db: D1Database): Promise<Member[]> {
  const rows = await db.prepare('SELECT * FROM members ORDER BY created_at').all<MemberRow>();
  return rows.results.map(toMember);
}

export async function createMember(db: D1Database, m: Member, at: Date): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO members (telegram_user_id, display_name, role, chat_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(m.telegramUserId, m.displayName, m.role, m.chatId, at.toISOString())
    .run();
}

/** Records an update id. Returns false if it was already processed. */
export async function markUpdateProcessed(db: D1Database, updateId: number, at: Date): Promise<boolean> {
  const res = await db
    .prepare('INSERT OR IGNORE INTO processed_updates (update_id, at) VALUES (?, ?)')
    .bind(updateId, at.toISOString())
    .run();
  return res.meta.changes === 1;
}

type ChildRow = {
  id: number;
  name_enc: string;
  pronoun: Child['pronoun'];
  birth_date: string | null;
  due_date: string | null;
  use_corrected_age: number;
};

/** All children, with names decrypted. */
export async function listChildren(db: D1Database, encryptionKey: string): Promise<Child[]> {
  const { results } = await db.prepare('SELECT * FROM children ORDER BY id').all<ChildRow>();
  return Promise.all(
    results.map(async (r) => ({
      id: r.id,
      name: await decrypt(r.name_enc, encryptionKey),
      pronoun: r.pronoun,
      birthDate: r.birth_date,
      dueDate: r.due_date,
      useCorrectedAge: r.use_corrected_age === 1,
    })),
  );
}

type StatusRow = { milestone_id: string; status: Status['status']; answered_at: string; follow_up_sent: number };

export async function getStatuses(db: D1Database, childId: number): Promise<Map<string, Status>> {
  const { results } = await db
    .prepare('SELECT milestone_id, status, answered_at, follow_up_sent FROM milestone_status WHERE child_id = ?')
    .bind(childId)
    .all<StatusRow>();
  return new Map(results.map((r) => [r.milestone_id, { status: r.status, answeredAt: r.answered_at, followUpSent: r.follow_up_sent === 1 }]));
}

export async function markFollowUpSent(db: D1Database, childId: number, milestoneId: string): Promise<void> {
  await db.prepare('UPDATE milestone_status SET follow_up_sent = 1 WHERE child_id = ? AND milestone_id = ?').bind(childId, milestoneId).run();
}

/** Sent-log keys for a child, as `kind:ref`. */
export async function getSentKeys(db: D1Database, childId: number): Promise<Set<string>> {
  const { results } = await db.prepare('SELECT kind, ref FROM sent_log WHERE child_id = ?').bind(childId).all<{ kind: string; ref: string }>();
  return new Set(results.map((r) => `${r.kind}:${r.ref}`));
}

/** Records `kind:ref` keys as sent on a date. Keys already present are left as they were. */
export async function recordSent(db: D1Database, childId: number, keys: string[], sentOn: string): Promise<void> {
  if (!keys.length) return;
  await db.batch(
    keys.map((key) => {
      const i = key.indexOf(':');
      return db
        .prepare('INSERT OR IGNORE INTO sent_log (kind, child_id, ref, sent_on) VALUES (?, ?, ?, ?)')
        .bind(key.slice(0, i), childId, key.slice(i + 1), sentOn);
    }),
  );
}

export async function addMessageRef(db: D1Database, chatId: number, messageId: number, childId: number, milestoneId: string): Promise<void> {
  await db
    .prepare('INSERT OR REPLACE INTO message_refs (chat_id, message_id, child_id, milestone_id) VALUES (?, ?, ?, ?)')
    .bind(chatId, messageId, childId, milestoneId)
    .run();
}

/** Check-up dates from today on. */
export async function upcomingCheckups(db: D1Database, childId: number, today: string): Promise<string[]> {
  const { results } = await db.prepare('SELECT date FROM checkups WHERE child_id = ? AND date >= ? ORDER BY date').bind(childId, today).all<{ date: string }>();
  return results.map((r) => r.date);
}

export async function getChild(db: D1Database, encryptionKey: string, id: number): Promise<Child | null> {
  return (await listChildren(db, encryptionKey)).find((c) => c.id === id) ?? null;
}

/** Upserts an answer. A changed answer clears follow_up_sent so the follow-up timer starts again. */
export async function upsertStatus(
  db: D1Database,
  childId: number,
  milestoneId: string,
  status: Status['status'],
  by: number,
  achievedOn: string | null,
  at: Date,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO milestone_status (child_id, milestone_id, status, achieved_on, answered_by, answered_at, follow_up_sent)
       VALUES (?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT (child_id, milestone_id) DO UPDATE SET
         follow_up_sent = CASE WHEN milestone_status.status = excluded.status THEN milestone_status.follow_up_sent ELSE 0 END,
         achieved_on = CASE WHEN milestone_status.status = excluded.status THEN milestone_status.achieved_on ELSE excluded.achieved_on END,
         answered_at = CASE WHEN milestone_status.status = excluded.status THEN milestone_status.answered_at ELSE excluded.answered_at END,
         status = excluded.status, answered_by = excluded.answered_by`,
    )
    .bind(childId, milestoneId, status, achievedOn, by, at.toISOString())
    .run();
}

export async function insertNote(db: D1Database, childId: number, milestoneId: string, noteEnc: string, by: number, at: Date): Promise<void> {
  await db
    .prepare('INSERT INTO milestone_notes (child_id, milestone_id, note_enc, added_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(childId, milestoneId, noteEnc, by, at.toISOString())
    .run();
}

export async function getMessageRef(db: D1Database, chatId: number, messageId: number): Promise<{ childId: number; milestoneId: string } | null> {
  const r = await db
    .prepare('SELECT child_id, milestone_id FROM message_refs WHERE chat_id = ? AND message_id = ?')
    .bind(chatId, messageId)
    .first<{ child_id: number; milestone_id: string }>();
  return r ? { childId: r.child_id, milestoneId: r.milestone_id } : null;
}

export async function setPending(db: D1Database, userId: number, kind: string, payload: unknown, expiresAt: Date): Promise<void> {
  await db
    .prepare('INSERT OR REPLACE INTO pending_input (telegram_user_id, kind, payload_json, expires_at) VALUES (?, ?, ?, ?)')
    .bind(userId, kind, JSON.stringify(payload), expiresAt.toISOString())
    .run();
}

/** The user's pending input if it has not expired. Expired rows are removed. */
export async function takePending(db: D1Database, userId: number, now: Date): Promise<{ kind: string; payload: unknown } | null> {
  const r = await db
    .prepare('SELECT kind, payload_json, expires_at FROM pending_input WHERE telegram_user_id = ?')
    .bind(userId)
    .first<{ kind: string; payload_json: string; expires_at: string }>();
  if (!r) return null;
  if (r.expires_at <= now.toISOString()) {
    await clearPending(db, userId);
    return null;
  }
  return { kind: r.kind, payload: JSON.parse(r.payload_json) };
}

export async function clearPending(db: D1Database, userId: number): Promise<void> {
  await db.prepare('DELETE FROM pending_input WHERE telegram_user_id = ?').bind(userId).run();
}
