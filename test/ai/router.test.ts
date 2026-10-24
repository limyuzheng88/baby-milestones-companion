import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import fixture from '../fixtures/milestones.fixture.json';
import type { AiProvider, AiRequest } from '../../src/ai/provider';
import { AiRefusal } from '../../src/ai/provider';
import { FALLBACK_TEXT, handleRouterCallback, routeMessage } from '../../src/ai/router';
import { recordUsage } from '../../src/ai/spend';
import type { Member } from '../../src/db/repo';
import { clearMilestoneCache, parseLibrary, toSeedSql } from '../../src/milestones/library';
import { encrypt } from '../../src/security/crypto';
import { getSetting } from '../../src/settings/store';
import { TelegramClient } from '../../src/telegram/client';
import type { IncomingCallback, IncomingMessage } from '../../src/telegram/webhook';
import { findBannedWords } from '../../src/tone/guard';
import { resetDb } from '../helpers/db';

type Call = { method: string; body: Record<string, unknown> };
let calls: Call[];
let aiCalls: AiRequest[];

const owner: Member = { telegramUserId: 1001, displayName: 'Pat', role: 'owner', chatId: 501 };
const member: Member = { telegramUserId: 1002, displayName: 'Sam', role: 'member', chatId: 502 };

const intent = (over: Record<string, unknown>) =>
  JSON.stringify({ kind: 'other', candidates: [], achievedOn: null, milestoneId: null, note: null, settingKey: null, settingValue: null, filterStatus: null, filterScope: null, question: null, ...over });

function fakeAi(...replies: (string | Error | 'hang')[]): AiProvider {
  return {
    model: 'claude-haiku-5-5',
    async complete(req) {
      aiCalls.push(req);
      const r = replies.shift() ?? intent({});
      if (r === 'hang') return new Promise(() => {});
      if (r instanceof Error) throw r;
      return { text: r, inputTokens: 1000, outputTokens: 100 };
    },
  };
}

function ctx(ai: AiProvider) {
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ method: url.split('/').pop()!, body: JSON.parse(init.body as string) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 900 } }));
  }) as unknown as typeof fetch;
  return { env, tg: new TelegramClient('t', fetchFn), clock: { now: () => new Date('2026-04-12T02:00:00Z') }, ai, aiTimeoutMs: 50 };
}

let id = 1;
const say = (text: string, from = owner): IncomingMessage => ({ updateId: id++, chatId: from.chatId, messageId: id, from, text });
const tap = (data: string, from = owner): IncomingCallback => ({ updateId: id++, callbackId: `cb${id}`, chatId: from.chatId, messageId: 900, from, data });
const sends = () => calls.filter((c) => c.method === 'sendMessage');
const lastText = () => String(sends().at(-1)?.body.text ?? calls.filter((c) => c.method === 'editMessageText').at(-1)?.body.text);
const buttonsOf = (c: Call | undefined) =>
  ((c?.body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] } | undefined)?.inline_keyboard ?? []).flat();
const noWrites = async () => {
  expect((await env.DB.prepare('SELECT * FROM settings').all()).results).toEqual([]);
  expect((await env.DB.prepare('SELECT * FROM milestone_status').all()).results).toEqual([]);
  expect((await env.DB.prepare('SELECT * FROM milestone_notes').all()).results).toEqual([]);
};

beforeEach(async () => {
  await resetDb();
  clearMilestoneCache();
  calls = [];
  aiCalls = [];
  for (const stmt of toSeedSql(parseLibrary(fixture)).split(';\n').filter((s) => s.trim())) await env.DB.prepare(stmt).run();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO members VALUES (1001, 'Pat', 'owner', 501, '2026-03-01'), (1002, 'Sam', 'member', 502, '2026-03-02')"),
    env.DB.prepare("INSERT INTO children (id, name_enc, pronoun, birth_date, due_date, use_corrected_age, created_at) VALUES (1, ?, 'she', '2026-03-10', NULL, 0, '2026-03-11')").bind(
      await encrypt('Test Baby', env.ENCRYPTION_KEY),
    ),
  ]);
});

describe('routeMessage', () => {
  it('confirms a single milestone match, and Yes records it with today', async () => {
    await routeMessage(say('she wiggled her toes today'), ctx(fakeAi(intent({ kind: 'mark_milestone', candidates: ['fx-move-1'] }))));
    expect(lastText()).toContain('She wiggles her toes at the fixture');
    expect(lastText()).toContain('12 Apr');
    const buttons = buttonsOf(sends().at(-1));
    expect(buttons.map((b) => b.text)).toEqual(['Yes', 'Not this one']);
    await handleRouterCallback(tap(buttons[0]!.callback_data), ctx(fakeAi()));
    expect((await env.DB.prepare('SELECT milestone_id, status, achieved_on FROM milestone_status').all()).results).toEqual([
      { milestone_id: 'fx-move-1', status: 'yes', achieved_on: '2026-04-12' },
    ]);
  });

  it('keeps the date the parent gave', async () => {
    await routeMessage(say('she did it last friday'), ctx(fakeAi(intent({ kind: 'mark_milestone', candidates: ['fx-move-1'], achievedOn: '2026-04-10' }))));
    await handleRouterCallback(tap(buttonsOf(sends().at(-1))[0]!.callback_data), ctx(fakeAi()));
    expect((await env.DB.prepare('SELECT achieved_on FROM milestone_status').first())).toEqual({ achieved_on: '2026-04-10' });
  });

  it('offers one button per candidate when several match, dropping unknown ids', async () => {
    await routeMessage(say('she did a thing'), ctx(fakeAi(intent({ kind: 'mark_milestone', candidates: ['fx-move-1', 'made-up', 'fx-talk-1'] }))));
    expect(buttonsOf(sends().at(-1)).map((b) => b.text)).toEqual(['She wiggles her toes at the fixture', 'She hums a fixture tune', 'None of these']);
  });

  it('Not this one writes nothing', async () => {
    await routeMessage(say('she wiggled'), ctx(fakeAi(intent({ kind: 'mark_milestone', candidates: ['fx-move-1'] }))));
    await handleRouterCallback(tap(buttonsOf(sends().at(-1))[1]!.callback_data), ctx(fakeAi()));
    await noWrites();
  });

  it('changes a setting, says what changed, and Undo restores it', async () => {
    await routeMessage(say('send the notes at 8pm'), ctx(fakeAi(intent({ kind: 'change_setting', settingKey: 'note.time', settingValue: '20:00' }))));
    expect(await getSetting(env.DB, 'note.time')).toBe('20:00');
    expect(lastText()).toContain('09:00');
    expect(lastText()).toContain('20:00');
    const undo = buttonsOf(sends().at(-1)).find((b) => b.text === 'Undo')!;
    await handleRouterCallback(tap(undo.callback_data), ctx(fakeAi()));
    expect(await getSetting(env.DB, 'note.time')).toBe('09:00');
  });

  it('refuses owner-only settings for members, politely', async () => {
    await routeMessage(say('switch to Sonnet', member), ctx(fakeAi(intent({ kind: 'change_setting', settingKey: 'ai.model', settingValue: 'claude-sonnet-5-5' }))));
    expect(await getSetting(env.DB, 'ai.model')).toBe('claude-haiku-5-5');
    expect(lastText()).toMatch(/only the owner/i);
  });

  it('refuses a forged owner-only Undo from a member', async () => {
    await handleRouterCallback(tap('undo:ai.model:"claude-sonnet-5-5"', member), ctx(fakeAi()));
    expect(await getSetting(env.DB, 'ai.model')).toBe('claude-haiku-5-5');
  });

  it('rejects invalid setting values without writing', async () => {
    await routeMessage(say('notes at 25 o clock'), ctx(fakeAi(intent({ kind: 'change_setting', settingKey: 'note.time', settingValue: '25:00' }))));
    await noWrites();
    expect(lastText()).toMatch(/HH:MM/);
  });

  it('falls back and changes nothing on invalid JSON, errors, refusals, timeouts or bad intents', async () => {
    for (const reply of ['not json', new Error('boom'), new AiRefusal(10, 0), 'hang' as const, intent({ kind: 'launch_rocket' }), intent({ kind: 'change_setting', settingKey: 'evil.key', settingValue: '1' })]) {
      calls = [];
      await routeMessage(say('hmm'), ctx(fakeAi(reply)));
      expect(lastText()).toBe(FALLBACK_TEXT);
    }
    await noWrites();
  });

  it('answers questions from the library and replaces a reply with a banned word', async () => {
    await routeMessage(say('is it normal that she is not wiggling yet?'), ctx(fakeAi(intent({ kind: 'question', question: 'wiggling' }), 'Honestly she is behind.')));
    expect(aiCalls[1]!.system).toContain('She wiggles her toes at the fixture');
    for (const c of sends()) expect(findBannedWords(String(c.body.text))).toEqual([]);
    expect(lastText()).toContain('your doctor or polyclinic');
  });

  it('passes a clean answer through, HTML-escaped', async () => {
    await routeMessage(say('what comes next?'), ctx(fakeAi(intent({ kind: 'question', question: 'next' }), 'Next up <soon>: humming (HPB).')));
    expect(lastText()).toContain('Next up &lt;soon&gt;: humming (HPB).');
  });

  it('pauses chat when the monthly cap is reached, without calling the AI', async () => {
    await recordUsage(env.DB, 'claude-sonnet-5-5', 1_000_000, 0, new Date('2026-04-02T00:00:00Z'));
    await routeMessage(say('hi'), ctx(fakeAi()));
    expect(aiCalls).toEqual([]);
    expect(lastText()).toMatch(/paused until next month/);
    expect(lastText()).toMatch(/reminders/);
  });

  it('records usage for every AI call', async () => {
    await routeMessage(say('hi'), ctx(fakeAi(intent({}))));
    expect((await env.DB.prepare('SELECT model, input_tokens, output_tokens FROM ai_usage').all()).results).toEqual([
      { model: 'claude-haiku-5-5', input_tokens: 1000, output_tokens: 100 },
    ]);
  });

  it('saves a note for a named milestone', async () => {
    await routeMessage(say('note for toes: loves the blue sock'), ctx(fakeAi(intent({ kind: 'add_note', milestoneId: 'fx-move-1', note: 'loves the blue sock' }))));
    expect((await env.DB.prepare('SELECT milestone_id FROM milestone_notes').all()).results).toEqual([{ milestone_id: 'fx-move-1' }]);
  });

  it('does not send the child name or member names to the AI', async () => {
    await routeMessage(say('hi'), ctx(fakeAi(intent({}))));
    const sent = JSON.stringify(aiCalls);
    expect(sent).not.toContain('Test Baby');
    expect(sent).not.toContain('Pat');
  });
});
