import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/milestones.fixture.json';
import type { Child } from '../../src/milestones/age';
import { parseLibrary, type Milestone } from '../../src/milestones/library';
import { renderMilestoneList, type ListStatus } from '../../src/milestones/list';
import { findBannedWords } from '../../src/tone/guard';

const ms = parseLibrary(fixture).milestones;
const child: Child = { id: 1, name: 'Test Baby', pronoun: 'she', birthDate: '2026-03-10', dueDate: null, useCorrectedAge: false };
// 2026-06-15: 1-2 and 3-5 bands open, 6-12 coming up.
const today = '2026-06-15';
const statuses = new Map<string, ListStatus>([
  ['fx-move-1', { status: 'yes', answeredAt: '2026-04-12T02:00:00Z', followUpSent: false, achievedOn: '2026-04-12' }],
  ['fx-talk-1', { status: 'not_yet', answeredAt: '2026-04-12T02:00:00Z', followUpSent: false, achievedOn: null }],
]);
const notes = new Map([['fx-move-1', ['loves the <blue> sock']]]);
const render = (filter = {}, list: readonly Milestone[] = ms) => renderMilestoneList(child, today, list, statuses, notes, filter).join('\n');

describe('renderMilestoneList', () => {
  it('groups by band oldest first and shows answers, dates and notes', () => {
    const out = render();
    expect(out).toContain('Test Baby');
    expect(out.indexOf('1 to 2 months')).toBeLessThan(out.indexOf('3 to 5 months'));
    expect(out).toContain('✓ She wiggles her toes at the fixture (12 Apr)');
    expect(out).toContain('loves the &lt;blue&gt; sock');
    expect(out).toMatch(/She hums a fixture tune.*not yet/);
    expect(out).toMatch(/6 to 12 months.*coming up/s);
  });

  it('filters by status', () => {
    const out = render({ statuses: ['not_yet'] });
    expect(out).toContain('She hums a fixture tune');
    expect(out).not.toContain('wiggles');
    expect(out).not.toContain('puppet');
  });

  it('shows unasked items in open bands', () => {
    const out = render({ statuses: ['unasked'] });
    expect(out).toContain('She grins at a fixture puppet');
    expect(out).not.toContain('hidden fixture block');
  });

  it('filters by band and domain', () => {
    expect(render({ bandStartMonths: 3 })).not.toContain('wiggles');
    expect(render({ bandStartMonths: 3 })).toContain('puppet');
    expect(render({ domain: 'movement' })).toContain('wiggles');
    expect(render({ domain: 'movement' })).not.toContain('hums');
  });

  it('says so kindly when nothing matches', () => {
    expect(render({ statuses: ['not_sure'] })).toMatch(/Nothing to show/);
  });

  it('never uses a banned word', () => {
    expect(findBannedWords(render())).toEqual([]);
  });

  it('splits long lists under 4096 characters, naming the child each time', () => {
    const many = Array.from({ length: 200 }, (_, i): Milestone => ({ ...ms[0]!, id: `fx-${i}`, wording: `${ms[0]!.wording} number ${i} ${'x'.repeat(40)}` }));
    const msgs = renderMilestoneList(child, today, many, new Map(), new Map(), {});
    expect(msgs.length).toBeGreaterThan(1);
    for (const m of msgs) {
      expect(m.length).toBeLessThanOrEqual(4096);
      expect(m).toContain('Test Baby');
    }
    expect(msgs.join('\n')).toContain('number 199');
  });
});
