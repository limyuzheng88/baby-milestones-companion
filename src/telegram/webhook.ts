import type { Clock } from '../clock';
import { createMember, getMember, markUpdateProcessed, type Member } from '../db/repo';
import type { Env } from '../env';
import type { TelegramClient } from './client';
import type { TgUpdate } from './types';

export type IncomingMessage = {
  updateId: number;
  chatId: number;
  messageId: number;
  from: Member;
  text: string;
  replyToMessageId?: number;
};

export type IncomingCallback = {
  updateId: number;
  callbackId: string;
  chatId: number;
  messageId: number;
  from: Member;
  data: string;
};

export interface Deps {
  clock: Clock;
  tg: TelegramClient;
  onMessage(m: IncomingMessage): Promise<void>;
  onCallback(c: IncomingCallback): Promise<void>;
}

const MIN_SECRET_LENGTH = 16;

const ok = () => new Response('ok', { status: 200 });

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x.at(i) ?? 0) ^ (y.at(i) ?? 0);
  return diff === 0;
}

async function resolveMember(env: Env, deps: Deps, userId: number, chatId: number, name: string, text?: string) {
  const known = await getMember(env.DB, userId);
  if (known) return known;
  // The only way in for a new user in Phase 1: the configured owner sending /start.
  if (text?.startsWith('/start') && String(userId) === env.OWNER_TELEGRAM_ID.trim()) {
    const owner: Member = { telegramUserId: userId, displayName: name, role: 'owner', chatId };
    await createMember(env.DB, owner, deps.clock.now());
    console.log('owner registered');
    return owner;
  }
  return null;
}

export async function handleWebhook(req: Request, env: Env, deps: Deps): Promise<Response> {
  const configured = env.TELEGRAM_WEBHOOK_SECRET ?? '';
  // Fail closed: a missing or weak configured secret must never let unsigned requests through.
  if (configured.length < MIN_SECRET_LENGTH) {
    console.error('webhook secret not configured');
    return new Response('unauthorized', { status: 401 });
  }
  const secret = req.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
  if (!safeEqual(secret, configured)) return new Response('unauthorized', { status: 401 });

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return new Response('bad request', { status: 400 });
  }

  try {
    const msg = update.message;
    const cb = update.callback_query;
    if (msg?.from && typeof msg.text === 'string') {
      const from = await resolveMember(env, deps, msg.from.id, msg.chat.id, msg.from.first_name ?? 'Owner', msg.text);
      if (!from || !(await markUpdateProcessed(env.DB, update.update_id, deps.clock.now()))) return ok();
      await deps.onMessage({
        updateId: update.update_id,
        chatId: msg.chat.id,
        messageId: msg.message_id,
        from,
        text: msg.text,
        replyToMessageId: msg.reply_to_message?.message_id,
      });
    } else if (cb?.message && typeof cb.data === 'string') {
      const from = await getMember(env.DB, cb.from.id);
      if (!from || !(await markUpdateProcessed(env.DB, update.update_id, deps.clock.now()))) return ok();
      await deps.onCallback({
        updateId: update.update_id,
        callbackId: cb.id,
        chatId: cb.message.chat.id,
        messageId: cb.message.message_id,
        from,
        data: cb.data,
      });
    }
  } catch (err) {
    // Log the error type only: message text may contain family details.
    console.error('webhook handler failed', err instanceof Error ? err.name : 'unknown');
  }
  return ok();
}
