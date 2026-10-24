import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { canSpend, costUsd, monthSpendUsd, recordUsage } from '../../src/ai/spend';
import { resetDb } from '../helpers/db';

const clock = (iso: string) => ({ now: () => new Date(iso) });

beforeEach(resetDb);

describe('spend', () => {
  it('prices Haiku at $0.10 in and $0.50 out per million tokens', () => {
    expect(costUsd('claude-haiku-5-5', 1_000_000, 100_000)).toBeCloseTo(0.15, 10);
    expect(costUsd('claude-sonnet-5-5', 1_000_000, 100_000)).toBeCloseTo(3, 10);
  });

  it('prices an unknown model at the most expensive known rate, so the cap still holds', () => {
    expect(costUsd('some-new-model', 1_000_000, 0)).toBe(2);
  });

  it('counts only the current Singapore calendar month', async () => {
    await recordUsage(env.DB, 'claude-haiku-5-5', 1_000_000, 100_000, new Date('2026-09-30T15:59:00Z')); // 23:59 SGT 30 Sep
    await recordUsage(env.DB, 'claude-haiku-5-5', 1_000_000, 0, new Date('2026-09-30T16:00:00Z')); // 00:00 SGT 1 Oct
    expect(await monthSpendUsd(env.DB, clock('2026-10-15T00:00:00Z'))).toBeCloseTo(0.1, 10);
    expect(await monthSpendUsd(env.DB, clock('2026-09-30T15:00:00Z'))).toBeCloseTo(0.15, 10);
  });

  it('allows spending below the cap and stops at it', async () => {
    const c = clock('2026-10-15T00:00:00Z');
    await recordUsage(env.DB, 'claude-sonnet-5-5', 995_000, 0, new Date('2026-10-02T00:00:00Z')); // $1.99
    expect(await canSpend(env.DB, c, 2)).toBe(true);
    await recordUsage(env.DB, 'claude-sonnet-5-5', 5_000, 0, new Date('2026-10-02T00:00:00Z')); // +$0.01
    expect(await canSpend(env.DB, c, 2)).toBe(false);
  });
});
