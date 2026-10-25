import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import fixture from '../fixtures/milestones.fixture.json';
import { bandsOf, clearMilestoneCache, loadMilestones, parseLibrary, toSeedSql } from '../../src/milestones/library';
import { findBannedWords } from '../../src/tone/guard';
import { resetDb } from '../helpers/db';

const clone = () => JSON.parse(JSON.stringify(fixture)) as { version: string; milestones: Record<string, unknown>[] };

describe('parseLibrary', () => {
  it('accepts the fixture library', () => {
    const lib = parseLibrary(fixture);
    expect(lib.version).toBe('fixture-1');
    expect(lib.milestones).toHaveLength(4);
  });

  it('fixture items follow the library rules', () => {
    const { milestones } = parseLibrary(fixture);
    for (const m of milestones) {
      expect(m.sourceUrl.startsWith('https://')).toBe(true);
      expect(m.bandStartMonths).toBeLessThan(m.bandEndMonths);
      expect(findBannedWords(`${m.wording} ${m.tip}`)).toEqual([]);
    }
  });

  it('rejects a non-https source url, naming the item', () => {
    const bad = clone();
    bad.milestones[1]!.sourceUrl = 'http://example.org';
    expect(() => parseLibrary(bad)).toThrow(/fx-talk-1/);
  });

  it('rejects a band whose start is not before its end', () => {
    const bad = clone();
    bad.milestones[0]!.bandEndMonths = 1;
    expect(() => parseLibrary(bad)).toThrow(/fx-move-1/);
  });

  it('rejects a band starting outside 0 to 72 months', () => {
    const bad = clone();
    bad.milestones[0]!.bandStartMonths = 73;
    bad.milestones[0]!.bandEndMonths = 80;
    expect(() => parseLibrary(bad)).toThrow(/fx-move-1/);
  });

  it('rejects duplicate ids', () => {
    const bad = clone();
    bad.milestones[1]!.id = 'fx-move-1';
    expect(() => parseLibrary(bad)).toThrow(/duplicate.*fx-move-1/i);
  });

  it('rejects banned words in wording or tip', () => {
    const bad = clone();
    bad.milestones[2]!.tip = 'She should be grinning by now';
    expect(() => parseLibrary(bad)).toThrow(/fx-play-1.*should/);
  });

  it('rejects an unknown domain or source', () => {
    const bad = clone();
    bad.milestones[3]!.domain = 'sleep';
    expect(() => parseLibrary(bad)).toThrow(/fx-think-1/);
    const bad2 = clone();
    bad2.milestones[3]!.source = 'Blog';
    expect(() => parseLibrary(bad2)).toThrow(/fx-think-1/);
  });

  it('rejects ids too long for Telegram button data', () => {
    const bad = clone();
    bad.milestones[0]!.id = 'x'.repeat(41);
    expect(() => parseLibrary(bad)).toThrow(/too long/);
  });

  it('rejects unknown placeholders', () => {
    const bad = clone();
    bad.milestones[0]!.wording = '{Her} wiggles';
    expect(() => parseLibrary(bad)).toThrow(/fx-move-1.*\{Her\}/);
  });

  it('rejects a missing version or milestones array', () => {
    expect(() => parseLibrary({ milestones: [] })).toThrow(/version/);
    expect(() => parseLibrary({ version: 'x' })).toThrow(/milestones/);
  });
});

describe('bandsOf', () => {
  it('returns unique bands sorted by start', () => {
    const { milestones } = parseLibrary(fixture);
    expect(bandsOf([...milestones].reverse())).toEqual([
      { startMonths: 1, endMonths: 2 },
      { startMonths: 3, endMonths: 5 },
      { startMonths: 6, endMonths: 12 },
    ]);
  });
});

describe('loadMilestones', () => {
  beforeEach(async () => {
    await resetDb();
    clearMilestoneCache();
  });

  it('round-trips the seeded library from D1', async () => {
    const lib = parseLibrary(fixture);
    const sql = toSeedSql(lib);
    for (const stmt of sql.split(';\n').map((s) => s.trim()).filter(Boolean)) {
      await env.DB.prepare(stmt).run();
    }
    const loaded = await loadMilestones(env.DB);
    expect([...loaded].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [...lib.milestones].sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it('seed SQL escapes quotes in wording', async () => {
    const lib = parseLibrary(fixture);
    lib.milestones[0]!.wording = "{Pronoun} says 'hi'";
    for (const stmt of toSeedSql(lib).split(';\n').map((s) => s.trim()).filter(Boolean)) {
      await env.DB.prepare(stmt).run();
    }
    const loaded = await loadMilestones(env.DB);
    expect(loaded.find((m) => m.id === 'fx-move-1')!.wording).toBe("{Pronoun} says 'hi'");
  });

  it('caches a loaded library per isolate', async () => {
    for (const stmt of toSeedSql(parseLibrary(fixture)).split(';\n').map((s) => s.trim()).filter(Boolean)) {
      await env.DB.prepare(stmt).run();
    }
    const first = await loadMilestones(env.DB);
    await env.DB.prepare('DELETE FROM milestones').run();
    expect(await loadMilestones(env.DB)).toBe(first);
  });

  it('does not cache an empty library, so a later seed is picked up', async () => {
    expect(await loadMilestones(env.DB)).toEqual([]);
    for (const stmt of toSeedSql(parseLibrary(fixture)).split(';\n').map((s) => s.trim()).filter(Boolean)) {
      await env.DB.prepare(stmt).run();
    }
    expect(await loadMilestones(env.DB)).toHaveLength(4);
  });
});
