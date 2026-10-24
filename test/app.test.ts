import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import fixture from './fixtures/milestones.fixture.json';
import type { AiProvider } from '../src/ai/provider';
import { onCallback, onMessage } from '../src/app';
import type { Member } from '../src/db/repo';
import { clearMilestoneCache, parseLibrary, toSeedSql } from '../src/milestones/library';
import { encrypt } from '../src/security/crypto';
import { TelegramClient } from '../src/telegram/client';
import type { IncomingCallback, IncomingMessage } from '../src/telegram/webhook';
import worker from '../src/index';
import { resetDb } from './helpers/db';

type Call = { method: string; body: Record<string, unknown> };
let calls: Call[];
let aiUsed: number;

const owner: Member = { telegramUserId: 1001, displayName: 'Pat', role: 'owner', chatId: 501 };
const ai: AiProvider = {
  model: 'claude-haiku-5-5',
  async complete() {
    aiUsed++;
    return { text: '{"kind":"other"}', inputTokens: 1, outputTokens: 1 };
  },
};

function ctx() {
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ method: url.split('/').pop()!, body: JSON.parse(init.body as string) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 900 } }));
  }) as unknown as typeof fetch;
  return { env, tg: new TelegramClient('t', fetchFn), clock: { now: () => new Date('2026-04-12T02:00:00Z') }, makeAi: async () => ai };
}

let id = 1;
const say = (text: string, replyToMessageId?: number): IncomingMessage => ({ updateId: id++, chatId: 501, messageId: id, from: owner, text, replyToMessageId });
const tap = (data: string): IncomingCallback => ({ updateId: id++, callbackId: `cb${id}`, chatId: 501, messageId: 77, from: owner, data });
const lastText = () => String(calls.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText').at(-1)?.body.text);

beforeEach(async () => {
  await resetDb();
  clearMilestoneCache();
  calls = [];
  aiUsed = 0;
  for (const stmt of toSeedSql(parseLibrary(fixture)).split(';\n').filter((s) => s.trim())) await env.DB.prepare(stmt).run();
  await env.DB.prepare("INSERT INTO members VALUES (1001, 'Pat', 'owner', 501, '2026-03-01')").run();
});

async function addChild() {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO children (id, name_enc, pronoun, birth_date, due_date, use_corrected_age, created_at) VALUES (1, ?, 'she', '2026-03-10', NULL, 0, '2026-03-11')").bind(
      await encrypt('Test Baby', env.ENCRYPTION_KEY),
    ),
    env.DB.prepare("INSERT INTO message_refs VALUES (501, 77, 1, 'fx-move-1')"),
  ]);
}

describe('message dispatch', () => {
  it('/start goes to onboarding', async () => {
    await onMessage(say('/start'), ctx());
    expect(lastText()).toMatch(/nickname/);
    expect(aiUsed).toBe(0);
  });

  it('/help lists what the bot can do, without AI', async () => {
    await addChild();
    await onMessage(say('/help'), ctx());
    expect(lastText()).toContain('/show_milestones');
    expect(lastText()).toMatch(/clinic's phone number/);
    expect(aiUsed).toBe(0);
  });

  it('/show_milestones renders the list, without AI', async () => {
    await addChild();
    await onMessage(say('/show_milestones'), ctx());
    expect(lastText()).toContain('Test Baby');
    expect(aiUsed).toBe(0);
  });

  it('a reply to a check-in is saved as a note, without AI', async () => {
    await addChild();
    await onMessage(say('loves it', 77), ctx());
    expect(lastText()).toMatch(/Saved your note/);
    expect(aiUsed).toBe(0);
  });

  it('other text goes to the AI router', async () => {
    await addChild();
    await onMessage(say('hello there'), ctx());
    expect(aiUsed).toBe(1);
  });

  it('unknown commands get a short hint, without AI', async () => {
    await addChild();
    await onMessage(say('/frobnicate'), ctx());
    expect(lastText()).toMatch(/\/help/);
    expect(aiUsed).toBe(0);
  });
});

describe('callback dispatch', () => {
  it('routes milestone, router and onboarding buttons by prefix', async () => {
    await addChild();
    await onCallback(tap('ms:1:fx-move-1:yes'), ctx());
    expect((await env.DB.prepare('SELECT status FROM milestone_status').first())).toEqual({ status: 'yes' });
    await onCallback(tap('undo:note.time:"07:00"'), ctx());
    expect(lastText()).toMatch(/back to 07:00/);
    calls = [];
    await onCallback(tap('zz:unknown'), ctx());
    expect(calls.map((c) => c.method)).toEqual(['answerCallbackQuery']);
  });
});

describe('worker', () => {
  it('answers 404 outside the webhook path', async () => {
    const res = await worker.fetch(new Request('https://bot.example/'), env);
    expect(res.status).toBe(404);
  });

  it('rejects webhook posts without the secret', async () => {
    const res = await worker.fetch(new Request('https://bot.example/telegram', { method: 'POST', body: '{}' }), env);
    expect(res.status).toBe(401);
  });
});
