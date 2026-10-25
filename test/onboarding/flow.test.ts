import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Member } from '../../src/db/repo';
import { handleOnboarding, handleOnboardingCallback, parseDate } from '../../src/onboarding/flow';
import { decrypt } from '../../src/security/crypto';
import { findBannedWords } from '../../src/tone/guard';
import { TelegramClient } from '../../src/telegram/client';
import type { IncomingCallback, IncomingMessage } from '../../src/telegram/webhook';
import { resetDb } from '../helpers/db';

type Call = { method: string; body: Record<string, unknown> };
let calls: Call[];

const owner: Member = { telegramUserId: 1001, displayName: 'Pat', role: 'owner', chatId: 501 };
const member: Member = { telegramUserId: 1002, displayName: 'Sam', role: 'member', chatId: 502 };

function ctx() {
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ method: url.split('/').pop()!, body: JSON.parse(init.body as string) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 900 } }));
  }) as unknown as typeof fetch;
  return { env, tg: new TelegramClient('t', fetchFn), clock: { now: () => new Date('2026-04-12T02:00:00Z') } };
}

let id = 1;
const say = (text: string, from = owner): IncomingMessage => ({ updateId: id++, chatId: from.chatId, messageId: id, from, text });
const tap = (data: string, from = owner): IncomingCallback => ({ updateId: id++, callbackId: `cb${id}`, chatId: from.chatId, messageId: 900, from, data });
const lastText = () => String(calls.filter((c) => c.method === 'sendMessage').at(-1)?.body.text);
const allText = () => calls.filter((c) => c.method === 'sendMessage').map((c) => String(c.body.text)).join('\n');
const buttons = () =>
  ((calls.filter((c) => c.method === 'sendMessage').at(-1)?.body.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] } | undefined)?.inline_keyboard ?? []).flat();
const press = async (label: string, from = owner) => {
  const b = buttons().find((x) => x.text === label);
  expect(b, `button ${label}`).toBeDefined();
  await handleOnboardingCallback(tap(b!.callback_data, from), ctx());
};
const children = async () => (await env.DB.prepare('SELECT * FROM children').all<Record<string, unknown>>()).results;

beforeEach(async () => {
  await resetDb();
  calls = [];
  await env.DB.prepare("INSERT INTO members VALUES (1001, 'Pat', 'owner', 501, '2026-03-01'), (1002, 'Sam', 'member', 502, '2026-03-02')").run();
});

describe('parseDate', () => {
  it('reads common formats and rejects impossible dates', () => {
    expect(parseDate('2026-03-10')).toBe('2026-03-10');
    expect(parseDate('10 Mar 2026')).toBe('2026-03-10');
    expect(parseDate('10 march 2026')).toBe('2026-03-10');
    expect(parseDate('10/3/2026')).toBe('2026-03-10');
    expect(parseDate('31 Feb 2026')).toBeNull();
    expect(parseDate('soon')).toBeNull();
  });
});

describe('onboarding', () => {
  async function upToBirth() {
    expect(await handleOnboarding(say('/start'), ctx())).toBe(true);
    expect(lastText()).toMatch(/nickname/);
    expect(await handleOnboarding(say('Test Baby'), ctx())).toBe(true);
    await press('She');
  }

  it('sets up a child on the happy path without asking about corrected age for 18 days early', async () => {
    await upToBirth();
    expect(await handleOnboarding(say('10 Mar 2026'), ctx())).toBe(true);
    expect(await handleOnboarding(say('2026-03-28'), ctx())).toBe(true);
    expect(allText()).not.toMatch(/corrected age/i);
    await press('Skip');
    const [row] = await children();
    expect(row).toMatchObject({ pronoun: 'she', birth_date: '2026-03-10', due_date: '2026-03-28', use_corrected_age: 0 });
    expect(await decrypt(String(row!.name_enc), env.ENCRYPTION_KEY)).toBe('Test Baby');
    expect(lastText()).toContain('9:00am');
    expect(lastText()).toMatch(/ID numbers/);
    expect(lastText()).toMatch(/photos of faces or bodies/);
    expect(lastText()).toMatch(/your family's/);
    expect(lastText()).toMatch(/clinic's phone number/);
    expect(await handleOnboarding(say('hello'), ctx())).toBe(false);
  });

  it('asks about corrected age for a birth six weeks early', async () => {
    await upToBirth();
    await handleOnboarding(say('2026-02-14'), ctx());
    await handleOnboarding(say('2026-03-28'), ctx());
    expect(lastText()).toMatch(/corrected age/i);
    await press('Yes, use corrected age');
    await handleOnboarding(say('20 Apr 2026'), ctx());
    expect(await children()).toMatchObject([{ use_corrected_age: 1 }]);
    expect((await env.DB.prepare('SELECT date FROM checkups').all()).results).toEqual([{ date: '2026-04-20' }]);
  });

  it('re-asks politely on an impossible date', async () => {
    await upToBirth();
    calls = [];
    expect(await handleOnboarding(say('31 Feb'), ctx())).toBe(true);
    expect(lastText()).toMatch(/couldn't read that date/i);
    expect(await children()).toEqual([]);
  });

  it('rejects a future birth date unless Not born yet is chosen', async () => {
    await upToBirth();
    await handleOnboarding(say('2026-05-01'), ctx());
    expect(lastText()).toMatch(/future/);
    await press('Not born yet');
    expect(buttons().map((b) => b.text)).not.toContain('Skip');
    await handleOnboarding(say('2026-06-01'), ctx());
    await press('Skip');
    expect(await children()).toMatchObject([{ birth_date: null, due_date: '2026-06-01' }]);
  });

  it('does not let a member start onboarding', async () => {
    expect(await handleOnboarding(say('/start', member), ctx())).toBe(true);
    expect(lastText()).toMatch(/owner/);
    expect(await handleOnboarding(say('Test Baby', member), ctx())).toBe(false);
    expect(await children()).toEqual([]);
  });

  it('ignores onboarding buttons pressed by someone else', async () => {
    await handleOnboarding(say('/start'), ctx());
    await handleOnboarding(say('Test Baby'), ctx());
    await press('She', member);
    expect(await handleOnboarding(say('10 Mar 2026'), ctx())).toBe(true);
    expect(lastText()).toMatch(/She|he|they/i);
  });

  it('shows the summary on /start after setup instead of adding a child', async () => {
    await upToBirth();
    await handleOnboarding(say('10 Mar 2026'), ctx());
    await press('Skip');
    await press('Skip');
    calls = [];
    expect(await handleOnboarding(say('/start'), ctx())).toBe(true);
    expect(lastText()).toContain('Test Baby');
    expect(await children()).toHaveLength(1);
  });

  it('creates the child once when the last button is tapped twice at the same time', async () => {
    await upToBirth();
    await handleOnboarding(say('10 Mar 2026'), ctx());
    await press('Skip');
    const skip = buttons().find((b) => b.text === 'Skip')!.callback_data;
    await Promise.all([handleOnboardingCallback(tap(skip), ctx()), handleOnboardingCallback(tap(skip), ctx())]);
    expect(await children()).toHaveLength(1);
  });

  it('never uses a banned word in any onboarding message', async () => {
    await upToBirth();
    await handleOnboarding(say('2026-02-14'), ctx());
    await handleOnboarding(say('2026-03-28'), ctx());
    await press('Yes, use corrected age');
    await handleOnboarding(say('20 Apr 2026'), ctx());
    await handleOnboarding(say('/start', member), ctx());
    for (const c of calls.filter((x) => x.method === 'sendMessage')) expect(findBannedWords(String(c.body.text))).toEqual([]);
  });

  it('does not take a command as the child name', async () => {
    await handleOnboarding(say('/start'), ctx());
    await handleOnboarding(say('/help'), ctx());
    expect(lastText()).toMatch(/nickname/);
  });

  it('rejects an empty or overly long name', async () => {
    await handleOnboarding(say('/start'), ctx());
    await handleOnboarding(say('x'.repeat(41)), ctx());
    expect(lastText()).toMatch(/shorter/);
  });
});
