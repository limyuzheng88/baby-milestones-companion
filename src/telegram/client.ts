export type Button = { text: string; data: string };

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TelegramError';
  }
}

const MAX_CALLBACK_BYTES = 64;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function keyboard(buttons: Button[][]) {
  for (const row of buttons) {
    for (const b of row) {
      if (new TextEncoder().encode(b.data).length > MAX_CALLBACK_BYTES) {
        throw new Error(`Callback data over ${MAX_CALLBACK_BYTES} bytes: ${b.data}`);
      }
    }
  }
  return { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) };
}

export class TelegramClient {
  constructor(
    private readonly token: string,
    // Wrapped so fetch never runs with the client as `this`, which Workers rejects as an illegal invocation.
    private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async sendMessage(chatId: number, text: string, buttons?: Button[][]): Promise<{ messageId: number }> {
    const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML' };
    if (buttons) body.reply_markup = keyboard(buttons);
    const result = await this.call<{ message_id: number }>('sendMessage', body);
    return { messageId: result.message_id };
  }

  async editMessageText(chatId: number, messageId: number, text: string, buttons?: Button[][]): Promise<void> {
    const body: Record<string, unknown> = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
    if (buttons) body.reply_markup = keyboard(buttons);
    await this.call('editMessageText', body);
  }

  async answerCallbackQuery(id: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', text === undefined ? { callback_query_id: id } : { callback_query_id: id, text });
  }

  private async call<T>(method: string, body: Record<string, unknown>, retried = false): Promise<T> {
    const res = await this.fetchFn(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      ok: boolean;
      result?: T;
      description?: string;
      parameters?: { retry_after?: number };
    };
    if (json.ok) return json.result as T;
    if (res.status === 429 && !retried) {
      await this.sleep((json.parameters?.retry_after ?? 1) * 1000);
      return this.call<T>(method, body, true);
    }
    // The token is in the URL, never in the message, so this error is safe to log.
    throw new TelegramError(json.description ?? `Telegram ${method} failed`, res.status);
  }
}
