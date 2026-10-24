import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { getSetting, setSetting } from '../../src/settings/store';

describe('settings store', () => {
  test('defaults when unset', async () => {
    expect(await getSetting(env.DB, 'note.time')).toBe('09:00');
    expect(await getSetting(env.DB, 'ai.model')).toBe('claude-haiku-5-5');
    expect(await getSetting(env.DB, 'ai.monthlyCapUsd')).toBe(2);
    expect(await getSetting(env.DB, 'milestones.pausedUntil')).toBeNull();
  });

  test('child override beats global', async () => {
    await setSetting(env.DB, 'cadence.headsUpDays', 7, 1);
    await setSetting(env.DB, 'cadence.headsUpDays', 3, 1, 2);
    expect(await getSetting(env.DB, 'cadence.headsUpDays', 2)).toBe(3);
    expect(await getSetting(env.DB, 'cadence.headsUpDays', 1)).toBe(7);
  });

  test('setting again replaces the value', async () => {
    await setSetting(env.DB, 'note.time', '20:00', 1);
    await setSetting(env.DB, 'note.time', '08:30', 1);
    expect(await getSetting(env.DB, 'note.time')).toBe('08:30');
  });
});
