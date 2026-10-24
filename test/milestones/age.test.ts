import { expect, test } from 'vitest';
import { addMonths, ageInWholeMonths, effectiveBirthDate, windowOpenDate, type Child } from '../../src/milestones/age';

const testBaby: Child = { id: 1, name: 'Test Baby', pronoun: 'she', birthDate: '2026-03-10', dueDate: '2026-03-28', useCorrectedAge: false };

test('whole months tick over on the same day of the month', () => {
  expect(ageInWholeMonths(testBaby, '2026-05-09')).toBe(1);
  expect(ageInWholeMonths(testBaby, '2026-05-10')).toBe(2);
  expect(ageInWholeMonths(testBaby, '2026-03-10')).toBe(0);
});

test('addMonths clamps to month end', () => {
  expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
});

test('a month-end birthday turns one month at the next month end', () => {
  const c = { ...testBaby, birthDate: '2026-01-31' };
  expect(ageInWholeMonths(c, '2026-02-27')).toBe(0);
  expect(ageInWholeMonths(c, '2026-02-28')).toBe(1);
});

test('corrected age counts from the due date', () => {
  const c: Child = { ...testBaby, birthDate: '2026-02-15', dueDate: '2026-03-28', useCorrectedAge: true };
  expect(effectiveBirthDate(c)).toBe('2026-03-28');
  expect(windowOpenDate(c, 2)).toBe('2026-05-28');
});

test('actual age when not corrected', () => {
  expect(windowOpenDate(testBaby, 2)).toBe('2026-05-10');
});

test('unborn child (no birth date) uses due date', () => {
  const c: Child = { ...testBaby, birthDate: null, dueDate: '2026-08-01' };
  expect(effectiveBirthDate(c)).toBe('2026-08-01');
});
