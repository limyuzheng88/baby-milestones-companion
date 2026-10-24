import { describe, expect, it } from 'vitest';
import { SETTING_RULES, parseSettingValue } from '../../src/settings/rules';
import { DEFAULTS } from '../../src/settings/store';

describe('setting rules', () => {
  it('covers every setting key', () => {
    expect(Object.keys(SETTING_RULES).sort()).toEqual(Object.keys(DEFAULTS).sort());
  });

  it('accepts valid values and normalises them', () => {
    expect(parseSettingValue('note.time', '8:00')).toBe('08:00');
    expect(parseSettingValue('note.time', '20:30')).toBe('20:30');
    expect(parseSettingValue('cadence.headsUpDays', '7')).toBe(7);
    expect(parseSettingValue('cadence.checkInsPerDay', 2)).toBe(2);
    expect(parseSettingValue('milestones.pausedUntil', '2026-11-01')).toBe('2026-11-01');
    expect(parseSettingValue('milestones.pausedUntil', null)).toBeNull();
    expect(parseSettingValue('ai.model', 'claude-sonnet-5-5')).toBe('claude-sonnet-5-5');
    expect(parseSettingValue('ai.monthlyCapUsd', '5')).toBe(5);
  });

  it('rejects out-of-range or malformed values', () => {
    for (const [key, raw] of [
      ['note.time', '25:00'],
      ['note.time', 'eight'],
      ['cadence.headsUpDays', '-1'],
      ['cadence.headsUpDays', '1.5'],
      ['cadence.checkInsPerDay', 0],
      ['milestones.pausedUntil', '2026-13-01'],
      ['ai.model', 'gpt-9'],
      ['ai.monthlyCapUsd', '1000'],
    ] as const) {
      expect(parseSettingValue(key, raw), `${key}=${raw}`).toBeUndefined();
    }
  });

  it('marks AI keys as owner-only', () => {
    expect(SETTING_RULES['ai.model'].ownerOnly).toBe(true);
    expect(SETTING_RULES['ai.monthlyCapUsd'].ownerOnly).toBe(true);
    expect(SETTING_RULES['note.time'].ownerOnly).toBe(false);
  });
});
