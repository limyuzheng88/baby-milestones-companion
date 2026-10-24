// D1 access. Each function is one query or one small transaction; no business rules here.

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
