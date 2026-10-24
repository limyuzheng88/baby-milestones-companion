// AI spend tracking against the monthly cap. Months are Singapore calendar months.
import type { Clock } from '../clock';

export const PRICES: Record<string, { inPerMTok: number; outPerMTok: number }> = {
  'claude-haiku-5-5': { inPerMTok: 0.1, outPerMTok: 0.5 },
  'claude-sonnet-5-5': { inPerMTok: 2, outPerMTok: 10 },
};

const SG_OFFSET_MS = 8 * 60 * 60 * 1000;

function priceOf(model: string) {
  // Unknown models are charged at the dearest known rate, so the cap can't be bypassed.
  return PRICES[model] ?? Object.values(PRICES).reduce((a, b) => (b.inPerMTok > a.inPerMTok ? b : a));
}

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceOf(model);
  return (inputTokens * p.inPerMTok + outputTokens * p.outPerMTok) / 1_000_000;
}

export async function recordUsage(db: D1Database, model: string, inputTokens: number, outputTokens: number, at: Date): Promise<void> {
  await db
    .prepare('INSERT INTO ai_usage (at, model, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?, ?)')
    .bind(at.toISOString(), model, inputTokens, outputTokens, costUsd(model, inputTokens, outputTokens))
    .run();
}

/** UTC instants bounding the current Singapore calendar month. */
function sgMonthRange(clock: Clock): [string, string] {
  const sg = new Date(clock.now().getTime() + SG_OFFSET_MS);
  const start = Date.UTC(sg.getUTCFullYear(), sg.getUTCMonth(), 1) - SG_OFFSET_MS;
  const end = Date.UTC(sg.getUTCFullYear(), sg.getUTCMonth() + 1, 1) - SG_OFFSET_MS;
  return [new Date(start).toISOString(), new Date(end).toISOString()];
}

export async function monthSpendUsd(db: D1Database, clock: Clock): Promise<number> {
  const [start, end] = sgMonthRange(clock);
  const r = await db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM ai_usage WHERE at >= ? AND at < ?').bind(start, end).first<{ total: number }>();
  return r?.total ?? 0;
}

export async function canSpend(db: D1Database, clock: Clock, capUsd: number): Promise<boolean> {
  // Compare in micro-dollars so float sums like 1.99 + 0.01 land exactly on the cap.
  return Math.round((await monthSpendUsd(db, clock)) * 1e6) < Math.round(capUsd * 1e6);
}
