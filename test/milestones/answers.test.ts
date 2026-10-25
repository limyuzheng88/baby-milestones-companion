import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import fixture from '../fixtures/milestones.fixture.json';
import type { Member } from '../../src/db/repo';
import { handleMilestoneCallback, handlePendingNote, recordAnswer } from '../../src/milestones/answers';
import { clearMilestoneCache, parseLibrary, toSeedSql } from '../../src/milestones/library';
import { decrypt, encrypt } from '../../src/security/crypto';
import { TelegramClient } from '../../src/telegram/client';
import type { IncomingCallback, IncomingMessage } from '../../src/telegram/webhook';
import { resetDb } from '../helpers/db';

type Call = { method: string; body: Record<string, unknown> };
let calls: Call[];
let now: Date;

const pat: Member = { telegramUserId: 1001, displayName: 'Pat', role: 'owner', chatId: 501 };

function ctx() {
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ method: url.split('/').pop()!, body: JSON.parse(init.body as string) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 900 } }));
  }) as unknown as typeof fetch;
  return { env, tg: new TelegramClient('t', fetchFn), clock: { now: () => now } };
}

let updateId = 1;
const tap = (data: string, messageId = 77): IncomingCallback => ({ updateId: updateId++, callbackId: `cb${updateId}`, chatId: 501, messageId, from: pat, data });
const text = (t: string, replyToMessageId?: number): IncomingMessage => ({ updateId: updateId++, chatId: 501, messageId: 300 + updateId, from: pat, text: t, replyToMessageId });
const rows = async (sql: string) => (await env.DB.prepare(sql).all()).results;
const statusRows = () => rows('SELECT milestone_id, status, achieved_on, answered_by, follow_up_sent FROM milestone_status');

beforeEach(async () => {
  await resetDb();
  clearMilestoneCache();
  calls = [];
  now = new Date('2026-04-10T02:00:00Z');
  for (const stmt of toSeedSql(parseLibrary(fixture)).split(';\n').filter((s) => s.trim())) await env.DB.prepare(stmt).run();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO members VALUES (1001, 'Pat', 'owner', 501, '2026-03-01')"),
    env.DB.prepare("INSERT INTO children (id, name_enc, pronoun, birth_date, due_date, use_corrected_age, created_at) VALUES (1, ?, 'she', '2026-03-10', NULL, 0, '2026-03-11')").bind(
      await encrypt('Test Baby', env.ENCRYPTION_KEY),
    ),
    env.DB.prepare("INSERT INTO message_refs VALUES (501, 77, 1, 'fx-move-1')"),
  ]);
});

describe('milestone callbacks', () => {
  it('records yes with today as the achieved date and celebrates', async () => {
    await handleMilestoneCallback(tap('ms:1:fx-move-1:yes'), ctx());
    expect(await statusRows()).toEqual([{ milestone_id: 'fx-move-1', status: 'yes', achieved_on: '2026-04-10', answered_by: 1001, follow_up_sent: 0 }]);
    const edit = calls.find((c) => c.method === 'editMessageText')!;
    expect(edit.body.message_id).toBe(77);
    expect(JSON.stringify(edit.body.reply_markup)).toContain('Change answer');
    expect(calls.some((c) => c.method === 'answerCallbackQuery')).toBe(true);
  });

  it('keeps one row with the latest answer after double taps and old buttons', async () => {
    await handleMilestoneCallback(tap('ms:1:fx-move-1:yes'), ctx());
    await handleMilestoneCallback(tap('ms:1:fx-move-1:yes'), ctx());
    await handleMilestoneCallback(tap('ms:1:fx-move-1:not_yet'), ctx());
    expect(await statusRows()).toEqual([{ milestone_id: 'fx-move-1', status: 'not_yet', achieved_on: null, answered_by: 1001, follow_up_sent: 0 }]);
    expect(calls.filter((c) => c.method === 'editMessageText')).toHaveLength(3);
  });

  it('resets the follow-up when an answer changes', async () => {
    await recordAnswer(env.DB, 1, 'fx-move-1', 'not_yet', 1001, null, now);
    await env.DB.prepare('UPDATE milestone_status SET follow_up_sent = 1').run();
    await handleMilestoneCallback(tap('ms:1:fx-move-1:yes'), ctx());
    expect(await statusRows()).toEqual([{ milestone_id: 'fx-move-1', status: 'yes', achieved_on: '2026-04-10', answered_by: 1001, follow_up_sent: 0 }]);
  });

  it('shows the tip on not yet and a gentle check-back on not sure', async () => {
    await handleMilestoneCallback(tap('ms:1:fx-move-1:not_yet'), ctx());
    expect(String(calls.find((c) => c.method === 'editMessageText')!.body.text)).toContain('Wiggle a pretend toy near her feet.');
    calls = [];
    await handleMilestoneCallback(tap('ms:1:fx-move-1:not_sure'), ctx());
    expect(String(calls.find((c) => c.method === 'editMessageText')!.body.text)).toContain("I'll check back in a couple of weeks");
  });

  it('change answer brings the four buttons back without writing anything', async () => {
    await handleMilestoneCallback(tap('ms:1:fx-move-1:yes'), ctx());
    calls = [];
    await handleMilestoneCallback(tap('ms:1:fx-move-1:change'), ctx());
    expect(JSON.stringify(calls.find((c) => c.method === 'editMessageText')!.body.reply_markup)).toContain("She's doing it");
    expect(await statusRows()).toHaveLength(1);
  });

  it('answers but writes nothing for malformed data, unknown children or unknown milestones', async () => {
    for (const data of ['ms:1', 'ms:x:fx-move-1:yes', 'ms:1:fx-move-1:maybe', 'ms:9:fx-move-1:yes', 'ms:1:nope:yes']) {
      calls = [];
      await handleMilestoneCallback(tap(data), ctx());
      expect(calls.map((c) => c.method)).toEqual(['answerCallbackQuery']);
    }
    expect(await statusRows()).toEqual([]);
  });
});

describe('notes', () => {
  it('saves the next text after tapping Add a note, encrypted', async () => {
    await handleMilestoneCallback(tap('ms:1:fx-move-1:note'), ctx());
    expect(calls.some((c) => c.method === 'sendMessage' && String(c.body.text).includes('What would you like to note?'))).toBe(true);
    now = new Date('2026-04-10T02:10:00Z');
    expect(await handlePendingNote(text("3 rolls in a row at grandma's"), ctx())).toBe(true);
    const [note] = (await rows('SELECT child_id, milestone_id, note_enc, added_by FROM milestone_notes')) as { note_enc: string }[];
    expect(note).toMatchObject({ child_id: 1, milestone_id: 'fx-move-1', added_by: 1001 });
    expect(note!.note_enc).not.toContain('grandma');
    expect(await decrypt(note!.note_enc, env.ENCRYPTION_KEY)).toBe("3 rolls in a row at grandma's");
    expect(await rows('SELECT * FROM pending_input')).toEqual([]);
    expect(await handlePendingNote(text('next message'), ctx())).toBe(false);
  });

  it('saves a reply to a check-in message as a note without tapping', async () => {
    expect(await handlePendingNote(text('she did it twice today', 77), ctx())).toBe(true);
    expect(await rows('SELECT milestone_id FROM milestone_notes')).toEqual([{ milestone_id: 'fx-move-1' }]);
  });

  it('lets an expired pending note fall through to the router', async () => {
    await handleMilestoneCallback(tap('ms:1:fx-move-1:note'), ctx());
    now = new Date('2026-04-10T02:31:00Z');
    expect(await handlePendingNote(text('hello'), ctx())).toBe(false);
    expect(await rows('SELECT * FROM milestone_notes')).toEqual([]);
  });

  it('ignores replies to messages that are not check-ins', async () => {
    expect(await handlePendingNote(text('hello', 12345), ctx())).toBe(false);
  });

  it('treats a command as a command, not a note', async () => {
    await handleMilestoneCallback(tap('ms:1:fx-move-1:note'), ctx());
    expect(await handlePendingNote(text('/show_milestones'), ctx())).toBe(false);
    expect(await rows('SELECT * FROM milestone_notes')).toEqual([]);
  });
});
