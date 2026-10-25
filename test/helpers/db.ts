import { env } from 'cloudflare:test';

const TABLES = [
  'members', 'children', 'milestones', 'milestone_status', 'milestone_notes', 'checkups', 'sent_log',
  'message_refs', 'settings', 'processed_updates', 'ai_usage', 'pending_input',
];

/** Storage is shared across tests in a file, so each test starts from empty tables. */
export async function resetDb(): Promise<void> {
  await env.DB.batch(TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
}
