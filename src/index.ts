import { systemClock } from './clock';
import type { Env } from './env';
import { runHourly } from './scheduler/cron';
import { TelegramClient } from './telegram/client';

export default {
  async fetch(_req: Request, _env: Env): Promise<Response> {
    return new Response('not found', { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runHourly(env, { clock: systemClock, tg: new TelegramClient(env.TELEGRAM_BOT_TOKEN) }));
  },
} satisfies ExportedHandler<Env>;
