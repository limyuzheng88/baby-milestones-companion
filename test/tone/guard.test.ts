import { expect, test } from 'vitest';
import { findBannedWords } from '../../src/tone/guard';

test('finds a banned word', () => {
  expect(findBannedWords('She is a bit behind')).toEqual(['behind']);
});

test('whole words only, so shoulder passes', () => {
  expect(findBannedWords('Shoulder rolls and should-free fun')).toEqual(['should']);
  expect(findBannedWords('Shoulder rolls')).toEqual([]);
});

test('case-insensitive and deduplicated', () => {
  expect(findBannedWords('SHOULD she? Should she?')).toEqual(['should']);
});

test('finds several', () => {
  expect(findBannedWords('Missed it, delayed and failed')).toEqual(['delayed', 'missed', 'failed']);
});

test('clean text', () => {
  expect(findBannedWords('Worth mentioning at her next visit')).toEqual([]);
});
