import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import { resetDb } from '../helpers/db';
import { getMember } from '../../src/db/repo';
import { TelegramClient } from '../../src/telegram/client';
import { handleWebhook, type IncomingCallback, type IncomingMessage } from '../../src/telegram/webhook';

const OWNER = 1001;
const clock = { now: () => new Date('2026-05-10T01:00:00Z') };

function update(id: number, fromId: number, text: string) {
  return { update_id: id, message: { message_id: 5, from: { id: fromId, first_name: 'Pat' }, chat: { id: fromId, type: 'private' }, text } };
}

function req(body: unknown, secret: string | null = env.TELEGRAM_WEBHOOK_SECRET) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers['X-Telegram-Bot-Api-Secret-Token'] = secret;
  return new Request('https://bot.example/telegram', { method: 'POST', headers, body: JSON.stringify(body) });
}

let messages: IncomingMessage[];
let callbacks: IncomingCallback[];
const deps = () => ({
  clock,
  tg: new TelegramClient('t', (async () => new Response('{"ok":true,"result":{}}')) as unknown as typeof fetch),
  onMessage: async (m: IncomingMessage) => { messages.push(m); },
  onCallback: async (c: IncomingCallback) => { callbacks.push(c); },
});

async function addOwner() {
  await env.DB.prepare("INSERT INTO members VALUES (?, 'Pat', 'owner', ?, '2026-05-01')").bind(OWNER, OWNER).run();
}

beforeEach(async () => { messages = []; callbacks = []; await resetDb(); });

describe('webhook', () => {
  test('an unset or short webhook secret fails closed', async () => {
    for (const configured of ['', 'short']) {
      const res = await handleWebhook(req(update(1, OWNER, 'hi'), configured), { ...env, TELEGRAM_WEBHOOK_SECRET: configured }, deps());
      expect(res.status).toBe(401);
    }
    const unset = { ...env, TELEGRAM_WEBHOOK_SECRET: undefined as unknown as string };
    expect((await handleWebhook(req(update(2, OWNER, 'hi'), null), unset, deps())).status).toBe(401);
    expect(messages).toHaveLength(0);
  });

  test('missing secret header is rejected', async () => {
    const res = await handleWebhook(req(update(1, OWNER, 'hi'), null), env, deps());
    expect(res.status).toBe(401);
    expect(messages).toHaveLength(0);
  });

  test('wrong secret is rejected', async () => {
    const res = await handleWebhook(req(update(1, OWNER, 'hi'), 'nope'), env, deps());
    expect(res.status).toBe(401);
  });

  test('known member text reaches onMessage once', async () => {
    await addOwner();
    const res = await handleWebhook(req(update(2, OWNER, 'she smiled')), env, deps());
    expect(res.status).toBe(200);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ updateId: 2, chatId: OWNER, text: 'she smiled', from: { role: 'owner' } });
  });

  test('unknown user is ignored silently', async () => {
    await addOwner();
    const res = await handleWebhook(req(update(3, 555, 'hello')), env, deps());
    expect(res.status).toBe(200);
    expect(messages).toHaveLength(0);
  });

  test('same update_id delivered twice is handled once', async () => {
    await addOwner();
    await handleWebhook(req(update(4, OWNER, 'one')), env, deps());
    await handleWebhook(req(update(4, OWNER, 'one')), env, deps());
    expect(messages).toHaveLength(1);
  });

  test('/start from OWNER_TELEGRAM_ID creates the owner', async () => {
    await handleWebhook(req(update(5, OWNER, '/start')), env, deps());
    expect(await getMember(env.DB, OWNER)).toMatchObject({ role: 'owner', chatId: OWNER });
    expect(messages).toHaveLength(1);
  });

  test('/start from anyone else is ignored even with no members', async () => {
    await handleWebhook(req(update(6, 777, '/start')), env, deps());
    expect(await getMember(env.DB, 777)).toBeNull();
    expect(messages).toHaveLength(0);
  });

  test('callback query from a member reaches onCallback', async () => {
    await addOwner();
    const body = {
      update_id: 7,
      callback_query: { id: 'cb', from: { id: OWNER, first_name: 'Pat' }, data: 'ms:1:a:yes', message: { message_id: 9, chat: { id: OWNER, type: 'private' } } },
    };
    await handleWebhook(req(body), env, deps());
    expect(callbacks).toEqual([expect.objectContaining({ callbackId: 'cb', chatId: OWNER, messageId: 9, data: 'ms:1:a:yes' })]);
  });

  test('sticker or other update is ignored with 200', async () => {
    await addOwner();
    const body = { update_id: 8, message: { message_id: 1, from: { id: OWNER }, chat: { id: OWNER, type: 'private' }, sticker: {} } };
    const res = await handleWebhook(req(body), env, deps());
    expect(res.status).toBe(200);
    expect(messages).toHaveLength(0);
  });

  test('a handler error still returns 200 so Telegram stops retrying', async () => {
    await addOwner();
    const d = { ...deps(), onMessage: async () => { throw new Error('boom'); } };
    const res = await handleWebhook(req(update(9, OWNER, 'x')), env, d);
    expect(res.status).toBe(200);
  });

  test('malformed JSON returns 400', async () => {
    const r = new Request('https://bot.example/telegram', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': env.TELEGRAM_WEBHOOK_SECRET },
      body: '{not json',
    });
    expect((await handleWebhook(r, env, deps())).status).toBe(400);
  });
});
