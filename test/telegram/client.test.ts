import { describe, expect, test } from 'vitest';
import { TelegramClient, TelegramError, escapeHtml } from '../../src/telegram/client';

type Call = { url: string; body: any };

function fakeFetch(responses: Array<{ status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const r = responses.shift() ?? { json: { ok: true, result: {} } };
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const noSleep = async () => {};

describe('TelegramClient', () => {
  test('sendMessage posts HTML text with inline keyboard', async () => {
    const f = fakeFetch([{ json: { ok: true, result: { message_id: 42 } } }]);
    const tg = new TelegramClient('tok', f.fn, noSleep);
    const res = await tg.sendMessage(7, 'Hi', [[{ text: 'Not yet', data: 'ms:1:a:not_yet' }]]);
    expect(res).toEqual({ messageId: 42 });
    expect(f.calls[0]!.url).toBe('https://api.telegram.org/bottok/sendMessage');
    expect(f.calls[0]!.body).toEqual({
      chat_id: 7,
      text: 'Hi',
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Not yet', callback_data: 'ms:1:a:not_yet' }]] },
    });
  });

  test('sendMessage without buttons sends no reply_markup', async () => {
    const f = fakeFetch([{ json: { ok: true, result: { message_id: 1 } } }]);
    await new TelegramClient('tok', f.fn, noSleep).sendMessage(7, 'Hi');
    expect(f.calls[0]!.body.reply_markup).toBeUndefined();
  });

  test('API error throws TelegramError with description', async () => {
    const f = fakeFetch([{ status: 400, json: { ok: false, description: 'Bad Request: chat not found' } }]);
    const tg = new TelegramClient('tok', f.fn, noSleep);
    await expect(tg.sendMessage(7, 'Hi')).rejects.toThrow(TelegramError);
    await expect(
      new TelegramClient('tok', fakeFetch([{ status: 400, json: { ok: false, description: 'x' } }]).fn, noSleep).sendMessage(7, 'Hi'),
    ).rejects.toThrow('x');
  });

  test('429 waits retry_after seconds then retries once', async () => {
    const waits: number[] = [];
    const f = fakeFetch([
      { status: 429, json: { ok: false, description: 'Too Many Requests', parameters: { retry_after: 3 } } },
      { json: { ok: true, result: { message_id: 9 } } },
    ]);
    const tg = new TelegramClient('tok', f.fn, async (ms) => { waits.push(ms); });
    expect(await tg.sendMessage(7, 'Hi')).toEqual({ messageId: 9 });
    expect(waits).toEqual([3000]);
    expect(f.calls).toHaveLength(2);
  });

  test('callback data over 64 bytes throws before sending', async () => {
    const f = fakeFetch([]);
    const tg = new TelegramClient('tok', f.fn, noSleep);
    await expect(tg.sendMessage(7, 'Hi', [[{ text: 'x', data: 'a'.repeat(65) }]])).rejects.toThrow(/64 bytes/);
    expect(f.calls).toHaveLength(0);
  });

  test('editMessageText and answerCallbackQuery hit the right methods', async () => {
    const f = fakeFetch([{ json: { ok: true, result: true } }, { json: { ok: true, result: true } }]);
    const tg = new TelegramClient('tok', f.fn, noSleep);
    await tg.editMessageText(7, 42, 'Done', []);
    await tg.answerCallbackQuery('cb1', 'Saved');
    expect(f.calls[0]!.url).toMatch(/editMessageText$/);
    expect(f.calls[0]!.body).toMatchObject({ chat_id: 7, message_id: 42, text: 'Done', parse_mode: 'HTML' });
    expect(f.calls[1]!.url).toMatch(/answerCallbackQuery$/);
    expect(f.calls[1]!.body).toEqual({ callback_query_id: 'cb1', text: 'Saved' });
  });
});

test('escapeHtml escapes the three HTML-significant characters', () => {
  expect(escapeHtml('<b>&')).toBe('&lt;b&gt;&amp;');
});
