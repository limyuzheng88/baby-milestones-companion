import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import fixture from '../fixtures/milestones.fixture.json';
import { clearMilestoneCache, parseLibrary, toSeedSql } from '../../src/milestones/library';
import { encrypt } from '../../src/security/crypto';
import { setSetting } from '../../src/settings/store';
import { TelegramClient } from '../../src/telegram/client';
import { runHourly } from '../../src/scheduler/cron';
import { resetDb } from '../helpers/db';

// Test Baby born 2026-03-10: the fixture's 1-2 month check-ins open on 2026-04-10.
type Sent = { chatId: number; text: string; buttons: unknown };
let sent: Sent[];
let failChat: number | null;
let nextId: number;

function tg() {
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { chat_id: number; text: string; reply_markup?: unknown };
    if (body.chat_id === failChat) return new Response('{"ok":false,"description":"Forbidden"}', { status: 403 });
    sent.push({ chatId: body.chat_id, text: body.text, buttons: body.reply_markup });
    return new Response(JSON.stringify({ ok: true, result: { message_id: nextId++ } }));
  }) as unknown as typeof fetch;
  return new TelegramClient('t', fetchFn);
}

const at = (iso: string) => ({ clock: { now: () => new Date(iso) }, tg: tg() });
const rows = async (sql: string) => (await env.DB.prepare(sql).all()).results;

beforeEach(async () => {
  await resetDb();
  clearMilestoneCache();
  sent = [];
  failChat = null;
  nextId = 100;
  for (const stmt of toSeedSql(parseLibrary(fixture)).split(';\n').filter((s) => s.trim())) await env.DB.prepare(stmt).run();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO members VALUES (1001, 'Pat', 'owner', 501, '2026-03-01')"),
    env.DB.prepare("INSERT INTO members VALUES (1002, 'Sam', 'member', 502, '2026-03-02')"),
    env.DB.prepare("INSERT INTO children (id, name_enc, pronoun, birth_date, due_date, use_corrected_age, created_at) VALUES (1, ?, 'she', '2026-03-10', '2026-03-28', 0, '2026-03-11')").bind(
      await encrypt('Test Baby', env.ENCRYPTION_KEY),
    ),
  ]);
});

describe('runHourly', () => {
  it('sends nothing before the note time (08:30 SGT)', async () => {
    await runHourly(env, at('2026-04-10T00:30:00Z'));
    expect(sent).toEqual([]);
  });

  it('sends the note to every member at 09:00 SGT, once a day', async () => {
    await runHourly(env, at('2026-04-10T01:00:00Z'));
    expect(sent.map((s) => s.chatId).sort()).toEqual([501, 501, 502, 502]);
    expect(sent[0]!.text).toContain('Test Baby');
    expect(await rows("SELECT kind, ref, sent_on FROM sent_log ORDER BY kind, ref")).toEqual([
      { kind: 'check_in', ref: 'fx-move-1', sent_on: '2026-04-10' },
      { kind: 'check_in', ref: 'fx-talk-1', sent_on: '2026-04-10' },
      { kind: 'daily_note', ref: '2026-04-10', sent_on: '2026-04-10' },
    ]);
    expect(await rows('SELECT chat_id, child_id, milestone_id FROM message_refs ORDER BY chat_id, milestone_id')).toEqual([
      { chat_id: 501, child_id: 1, milestone_id: 'fx-move-1' },
      { chat_id: 501, child_id: 1, milestone_id: 'fx-talk-1' },
      { chat_id: 502, child_id: 1, milestone_id: 'fx-move-1' },
      { chat_id: 502, child_id: 1, milestone_id: 'fx-talk-1' },
    ]);
    sent = [];
    await runHourly(env, at('2026-04-10T02:00:00Z'));
    expect(sent).toEqual([]);
  });

  it('uses the Singapore date: 16:30 UTC is already the next day', async () => {
    await setSetting(env.DB, 'note.time', '00:00', 1001);
    await runHourly(env, at('2026-04-09T16:30:00Z'));
    expect(await rows("SELECT ref FROM sent_log WHERE kind = 'daily_note'")).toEqual([{ ref: '2026-04-10' }]);
  });

  it('sends nothing and records nothing on a day with nothing due', async () => {
    await runHourly(env, at('2026-03-20T01:00:00Z'));
    expect(sent).toEqual([]);
    expect(await rows('SELECT * FROM sent_log')).toEqual([]);
  });

  it('follows the note time setting, rounded up to the next hourly run', async () => {
    await setSetting(env.DB, 'note.time', '20:00', 1001);
    await runHourly(env, at('2026-04-10T01:00:00Z'));
    expect(sent).toEqual([]);
    await runHourly(env, at('2026-04-10T12:00:00Z'));
    expect(sent).toHaveLength(4);
    sent = [];
    await setSetting(env.DB, 'note.time', '09:30', 1001);
    await runHourly(env, at('2026-04-11T01:00:00Z'));
    await runHourly(env, at('2026-04-12T01:00:00Z'));
    expect(sent).toEqual([]);
  });

  it('still delivers to other members when one chat fails', async () => {
    failChat = 502;
    await runHourly(env, at('2026-04-10T01:00:00Z'));
    expect(sent.map((s) => s.chatId)).toEqual([501, 501]);
    expect(await rows("SELECT ref FROM sent_log WHERE kind = 'daily_note'")).toEqual([{ ref: '2026-04-10' }]);
  });

  it('retries next hour when every chat fails', async () => {
    failChat = 501;
    await env.DB.prepare('DELETE FROM members WHERE telegram_user_id = 1002').run();
    await runHourly(env, at('2026-04-10T01:00:00Z'));
    expect(await rows('SELECT * FROM sent_log')).toEqual([]);
    failChat = null;
    await runHourly(env, at('2026-04-10T02:00:00Z'));
    expect(sent).toHaveLength(2);
  });

  it('marks a follow-up as sent so it is not repeated', async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO milestone_status VALUES (1, 'fx-move-1', 'not_yet', NULL, 1001, '2026-04-10T02:00:00Z', 0)"),
      env.DB.prepare("INSERT INTO milestone_status VALUES (1, 'fx-talk-1', 'yes', NULL, 1001, '2026-04-10T02:00:00Z', 0)"),
    ]);
    await runHourly(env, at('2026-04-24T01:00:00Z'));
    expect(sent.filter((s) => s.text.includes('Checking back'))).toHaveLength(2);
    expect(await rows("SELECT follow_up_sent FROM milestone_status WHERE milestone_id = 'fx-move-1'")).toEqual([{ follow_up_sent: 1 }]);
  });

  it('reminds before a check-up stored for the child', async () => {
    await env.DB.prepare("INSERT INTO checkups (child_id, date) VALUES (1, '2026-04-20')").run();
    await env.DB.prepare("INSERT INTO sent_log VALUES ('check_in', 1, 'fx-move-1', '2026-04-10'), ('check_in', 1, 'fx-talk-1', '2026-04-10')").run();
    await runHourly(env, at('2026-04-13T01:00:00Z'));
    expect(sent.filter((s) => s.text.includes('check-up'))).toHaveLength(2);
  });

  it('does nothing without members', async () => {
    await env.DB.prepare('DELETE FROM members').run();
    await runHourly(env, at('2026-04-10T01:00:00Z'));
    expect(sent).toEqual([]);
    expect(await rows('SELECT * FROM sent_log')).toEqual([]);
  });
});
