// Decides which part of the bot handles each message or button. Commands and buttons never use AI.
import type { AiProvider } from './ai/provider';
import { handleRouterCallback, routeMessage } from './ai/router';
import { handleMilestoneCallback, handlePendingNote, type Ctx } from './milestones/answers';
import { showMilestones } from './milestones/list';
import { handleOnboarding, handleOnboardingCallback } from './onboarding/flow';
import type { IncomingCallback, IncomingMessage } from './telegram/webhook';

export type AppCtx = Ctx & { makeAi: () => Promise<AiProvider> };

const HELP = `Here's what I can do:
• Each morning, when there's something to share, I send a short note about milestones coming up and gentle check-ins. Tap a button to answer.
• Reply to a check-in, or tap "Add a note", to save a note.
• Tell me things in your own words, like "she rolled over today" or "send notes at 8pm".
• /show_milestones shows the list with your answers and notes.
• /start shows your setup.

Please keep personal data out of this chat: no ID numbers, phone numbers, addresses, passwords, bank details, or photos of faces or bodies.`;

export async function onMessage(m: IncomingMessage, ctx: AppCtx): Promise<void> {
  if (await handleOnboarding(m, ctx)) return;
  const command = m.text.trim().split(/[\s@]/)[0]!.toLowerCase();
  if (command === '/help') return void (await ctx.tg.sendMessage(m.chatId, HELP));
  if (command === '/show_milestones' || command === '/milestones') return showMilestones(ctx, m.chatId, {});
  if (await handlePendingNote(m, ctx)) return;
  if (command.startsWith('/')) return void (await ctx.tg.sendMessage(m.chatId, "I don't know that command. Send /help to see what I can do."));
  await routeMessage(m, { ...ctx, ai: await ctx.makeAi() });
}

export async function onCallback(c: IncomingCallback, ctx: AppCtx): Promise<void> {
  const prefix = c.data.split(':')[0];
  if (prefix === 'ms') return handleMilestoneCallback(c, ctx);
  if (prefix === 'mk' || prefix === 'undo') return handleRouterCallback(c, ctx);
  if (prefix === 'ob') return handleOnboardingCallback(c, ctx);
  await ctx.tg.answerCallbackQuery(c.callbackId);
}
