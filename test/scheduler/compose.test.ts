import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/milestones.fixture.json';
import { MAX_ID_LENGTH, parseLibrary, type Milestone } from '../../src/milestones/library';
import type { Child } from '../../src/milestones/age';
import { checkInButtons, composeDailyNote, fillPlaceholders } from '../../src/scheduler/compose';
import type { DueItem } from '../../src/scheduler/planner';
import { findBannedWords } from '../../src/tone/guard';

const milestones = parseLibrary(fixture).milestones;
const she: Child = { id: 1, name: 'Test Baby', pronoun: 'she', birthDate: '2026-03-10', dueDate: null, useCorrectedAge: false };
const they: Child = { ...she, pronoun: 'they' };
const m0 = milestones[0]!;

const allKinds = (ms: readonly Milestone[]): DueItem[] => [
  { kind: 'heads_up', band: { startMonths: 1, endMonths: 2 }, milestones: [...ms] },
  ...ms.map((milestone): DueItem => ({ kind: 'check_in', milestone })),
  ...ms.map((milestone): DueItem => ({ kind: 'follow_up', milestone })),
  { kind: 'pre_checkup', checkupDate: '2026-06-20', open: [...ms] },
  { kind: 'pre_checkup', checkupDate: '2026-06-27', open: [] },
];

const labels = (b: ReturnType<typeof checkInButtons>) => b.flat().map((x) => x.text);

describe('checkInButtons', () => {
  it('uses the child pronoun on the yes button', () => {
    expect(labels(checkInButtons(she, m0.id))).toEqual(["She's doing it", 'Not yet', 'Not sure', 'Add a note']);
    expect(labels(checkInButtons({ ...she, pronoun: 'he' }, m0.id))[0]).toBe("He's doing it");
    expect(labels(checkInButtons(they, m0.id))[0]).toBe("They're doing it");
  });

  it('encodes child, milestone and answer in at most 64 bytes', () => {
    expect(checkInButtons(she, 'm2-head-lift').flat().map((b) => b.data)).toEqual([
      'ms:1:m2-head-lift:yes',
      'ms:1:m2-head-lift:not_yet',
      'ms:1:m2-head-lift:not_sure',
      'ms:1:m2-head-lift:note',
    ]);
    const longest = 'x'.repeat(MAX_ID_LENGTH);
    for (const b of checkInButtons({ ...she, id: 99999 }, longest).flat()) expect(new TextEncoder().encode(b.data).length).toBeLessThanOrEqual(64);
  });
});

describe('fillPlaceholders', () => {
  it('fills she, he and they forms', () => {
    const t = '{Pronoun} lifts {possessive} head; hold {object} while {pronoun} plays';
    expect(fillPlaceholders(t, she)).toBe('She lifts her head; hold her while she plays');
    expect(fillPlaceholders(t, { ...she, pronoun: 'he' })).toBe('He lifts his head; hold him while he plays');
    expect(fillPlaceholders(t, they)).toBe('Test Baby lifts their head; hold them while Test Baby plays');
  });
});

describe('composeDailyNote', () => {
  it('never uses a banned word, for any item kind or pronoun', () => {
    for (const child of [she, { ...she, pronoun: 'he' as const }, they]) {
      for (const count of [1, 2]) {
        for (const msg of composeDailyNote(child, allKinds(milestones), count)) {
          expect(findBannedWords(msg.text)).toEqual([]);
          for (const b of msg.buttons.flat()) expect(findBannedWords(b.text)).toEqual([]);
        }
      }
    }
  });

  it('names the child in every message', () => {
    for (const msg of composeDailyNote(she, allKinds(milestones), 1)) expect(msg.text).toContain('Test Baby');
  });

  it('opens a heads-up with things to look forward to and says babies vary', () => {
    const [msg] = composeDailyNote(she, [{ kind: 'heads_up', band: { startMonths: 1, endMonths: 2 }, milestones: [m0] }], 1);
    expect(msg!.text).toMatch(/Things to look forward to/);
    expect(msg!.text).toMatch(/vary/);
    expect(msg!.text).toContain('She wiggles her toes at the fixture');
    expect(msg!.buttons).toEqual([]);
  });

  it('gives each check-in its own message with wording, tip and buttons', () => {
    const msgs = composeDailyNote(she, [{ kind: 'check_in', milestone: m0 }, { kind: 'check_in', milestone: milestones[1]! }], 1);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.text).toContain('She wiggles her toes at the fixture');
    expect(msgs[0]!.text).toContain('Wiggle a pretend toy near her feet.');
    expect(msgs[0]!.buttons).toEqual(checkInButtons(she, m0.id));
    expect(msgs[0]!.milestoneId).toBe(m0.id);
    expect(msgs[1]!.milestoneId).toBe(milestones[1]!.id);
  });

  it('offers the buttons again on a follow-up', () => {
    const [msg] = composeDailyNote(she, [{ kind: 'follow_up', milestone: m0 }], 1);
    expect(msg!.buttons).toEqual(checkInButtons(she, m0.id));
    expect(msg!.milestoneId).toBe(m0.id);
  });

  it('lists open items worth mentioning at the next visit and mentions the Health Booklet', () => {
    const [msg] = composeDailyNote(she, [{ kind: 'pre_checkup', checkupDate: '2026-06-20', open: [m0] }], 1);
    expect(msg!.text).toContain('worth mentioning at her next visit');
    expect(msg!.text).toContain('Health Booklet');
    expect(msg!.text).toContain('She wiggles her toes at the fixture');
  });

  it('says anyone in the group can answer when there are several members', () => {
    const one = composeDailyNote(she, [{ kind: 'check_in', milestone: m0 }], 1)[0]!.text;
    const two = composeDailyNote(she, [{ kind: 'check_in', milestone: m0 }], 2)[0]!.text;
    expect(one).not.toMatch(/anyone/i);
    expect(two).toMatch(/anyone/i);
  });

  it('keeps every message within 4096 characters, with buttons beside their item', () => {
    const many: Milestone[] = Array.from({ length: 40 }, (_, i) => ({ ...m0, id: `fx-${i}`, wording: `${m0.wording} ${'and more '.repeat(20)}${i}` }));
    const msgs = composeDailyNote(she, [{ kind: 'heads_up', band: { startMonths: 1, endMonths: 2 }, milestones: many }, ...many.map((milestone): DueItem => ({ kind: 'check_in', milestone })), { kind: 'pre_checkup', checkupDate: '2026-06-20', open: many }], 1);
    expect(msgs.length).toBeGreaterThan(40);
    for (const msg of msgs) expect(msg.text.length).toBeLessThanOrEqual(4096);
    for (const msg of msgs.filter((m) => m.milestoneId)) {
      expect(msg.text).toContain(`and more ${msg.milestoneId!.slice(3)}`);
      expect(msg.buttons).toEqual(checkInButtons(she, msg.milestoneId!));
    }
    const text = msgs.map((m) => m.text).join('\n');
    for (let i = 0; i < 40; i++) expect(text).toContain(`and more ${i}`);
  });

  it('escapes HTML in names and library text', () => {
    const [msg] = composeDailyNote({ ...she, name: 'A<B' }, [{ kind: 'check_in', milestone: { ...m0, tip: 'Use <b>&' } }], 1);
    expect(msg!.text).toContain('A&lt;B');
    expect(msg!.text).toContain('Use &lt;b&gt;&amp;');
  });

  it('returns nothing for no items', () => {
    expect(composeDailyNote(she, [], 1)).toEqual([]);
  });
});
