import { expect, test } from 'vitest';
import { sgHour, sgToday } from '../src/clock';

test('sgToday crosses midnight before UTC does', () => {
  expect(sgToday({ now: () => new Date('2026-10-21T16:30:00Z') })).toBe('2026-10-22');
  expect(sgToday({ now: () => new Date('2026-10-21T15:59:00Z') })).toBe('2026-10-21');
});

test('sgHour is UTC+8', () => {
  expect(sgHour({ now: () => new Date('2026-05-10T01:00:00Z') })).toBe(9);
  expect(sgHour({ now: () => new Date('2026-05-10T16:30:00Z') })).toBe(0);
});
