import { AnthropicProvider } from './ai/provider';
import { onCallback, onMessage, type AppCtx } from './app';
import { systemClock } from './clock';
import type { Env } from './env';
import { runHourly } from './scheduler/cron';
import { getSetting } from './settings/store';
import { TelegramClient } from './telegram/client';
import { handleWebhook } from './telegram/webhook';

function appCtx(env: Env): AppCtx {
  return {
    env,
    tg: new TelegramClient(env.TELEGRAM_BOT_TOKEN),
    clock: systemClock,
    makeAi: async () => new AnthropicProvider(env.ANTHROPIC_API_KEY, await getSetting(env.DB, 'ai.model')),
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== '/telegram' || req.method !== 'POST') return new Response('not found', { status: 404 });
    const ctx = appCtx(env);
    return handleWebhook(req, env, {
      clock: ctx.clock,
      tg: ctx.tg,
      onMessage: (m) => onMessage(m, ctx),
      onCallback: (c) => onCallback(c, ctx),
    });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runHourly(env, { clock: systemClock, tg: new TelegramClient(env.TELEGRAM_BOT_TOKEN) }));
  },
} satisfies ExportedHandler<Env>;
