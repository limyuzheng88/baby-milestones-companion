import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/milestones.fixture.json';
import { parseLibrary } from '../../src/milestones/library';
import type { Child } from '../../src/milestones/age';
import { planDay, sentKey, type Status } from '../../src/scheduler/planner';

// Fixture bands: 1-2 months (fx-move-1, fx-talk-1), 3-5 (fx-play-1), 6-12 (fx-think-1).
// Test Baby born 2026-03-10: the 1-month band opens 2026-04-10, the 3-month band 2026-06-10.
const milestones = parseLibrary(fixture).milestones;
const child: Child = { id: 1, name: 'Test Baby', pronoun: 'she', birthDate: '2026-03-10', dueDate: '2026-03-28', useCorrectedAge: false };
const cadence = { headsUpDays: 14, followUpDays: 14, preCheckupDays: 7, checkInsPerDay: 3 };

function plan(today: string, over: Partial<Parameters<typeof planDay>[0]> = {}) {
  return planDay({ child, today, milestones, statuses: new Map(), sent: new Set(), checkups: [], cadence, pausedUntil: null, ...over });
}

const kinds = (items: ReturnType<typeof plan>) => items.map(sentKey);

describe('planDay', () => {
  it('sends a heads-up 14 days before a band opens, once', () => {
    const items = plan('2026-03-27');
    expect(kinds(items)).toEqual(['heads_up:1']);
    const first = items[0]!;
    expect(first.kind === 'heads_up' && first.milestones.map((m) => m.id)).toEqual(['fx-move-1', 'fx-talk-1']);
    expect(plan('2026-03-27', { sent: new Set(['heads_up:1']) })).toEqual([]);
  });

  it('sends nothing 15 days before', () => {
    expect(plan('2026-03-26')).toEqual([]);
  });

  it('checks in on each milestone when its window opens', () => {
    expect(kinds(plan('2026-04-10'))).toEqual(['check_in:fx-move-1', 'check_in:fx-talk-1']);
  });

  it('catches up on check-ins after missed runs but not on the heads-up', () => {
    expect(kinds(plan('2026-04-12'))).toEqual(['check_in:fx-move-1', 'check_in:fx-talk-1']);
  });

  it('spreads check-ins over days, a few per day', () => {
    expect(kinds(plan('2026-04-10', { cadence: { ...cadence, checkInsPerDay: 1 } }))).toEqual(['check_in:fx-move-1']);
    expect(kinds(plan('2026-04-11', { cadence: { ...cadence, checkInsPerDay: 1 }, sent: new Set(['check_in:fx-move-1']) }))).toEqual([
      'check_in:fx-talk-1',
    ]);
  });

  it('does not check in late once a window has ended', () => {
    // 1-2 month window ends 2026-05-10; the 3-5 heads-up is due around then.
    expect(kinds(plan('2026-05-11')).filter((k) => k.startsWith('check_in:fx-move'))).toEqual([]);
  });

  it('skips answered milestones', () => {
    const statuses = new Map<string, Status>([['fx-move-1', { status: 'yes', answeredAt: '2026-04-10T02:00:00Z', followUpSent: false }]]);
    expect(kinds(plan('2026-04-10', { statuses }))).toEqual(['check_in:fx-talk-1']);
  });

  it('follows up gently on not yet after the follow-up gap, once', () => {
    const notYet = (followUpSent: boolean) =>
      new Map<string, Status>([
        ['fx-move-1', { status: 'not_yet', answeredAt: '2026-04-11T02:00:00Z', followUpSent }],
        ['fx-talk-1', { status: 'yes', answeredAt: '2026-04-11T02:00:00Z', followUpSent: false }],
      ]);
    expect(kinds(plan('2026-04-24', { statuses: notYet(false) }))).toEqual([]);
    expect(kinds(plan('2026-04-25', { statuses: notYet(false) }))).toEqual(['follow_up:fx-move-1']);
    expect(kinds(plan('2026-04-25', { statuses: notYet(true) }))).toEqual([]);
  });

  it('uses the Singapore date of the answer for the follow-up gap', () => {
    // 16:30 UTC on 04-10 is 00:30 on 04-11 in Singapore.
    const statuses = new Map<string, Status>([['fx-move-1', { status: 'not_sure', answeredAt: '2026-04-10T16:30:00Z', followUpSent: false }]]);
    expect(kinds(plan('2026-04-24', { statuses })).filter((k) => k.startsWith('follow_up'))).toEqual([]);
    expect(kinds(plan('2026-04-25', { statuses })).filter((k) => k.startsWith('follow_up'))).toEqual(['follow_up:fx-move-1']);
  });

  it('never follows up on yes', () => {
    const statuses = new Map<string, Status>([['fx-move-1', { status: 'yes', answeredAt: '2026-04-11T02:00:00Z', followUpSent: false }]]);
    expect(kinds(plan('2026-06-01', { statuses })).filter((k) => k.startsWith('follow_up'))).toEqual([]);
  });

  it('sends nothing while paused', () => {
    expect(plan('2026-04-10', { pausedUntil: '2026-04-20' })).toEqual([]);
    expect(kinds(plan('2026-04-20', { pausedUntil: '2026-04-20' }))).toEqual(['check_in:fx-move-1', 'check_in:fx-talk-1']);
  });

  it('reminds a week before a check-up with the open items whose window has opened', () => {
    const statuses = new Map<string, Status>([
      ['fx-move-1', { status: 'yes', answeredAt: '2026-04-11T02:00:00Z', followUpSent: false }],
      ['fx-talk-1', { status: 'not_yet', answeredAt: '2026-04-11T02:00:00Z', followUpSent: true }],
    ]);
    const sent = new Set(['heads_up:3', 'check_in:fx-play-1']);
    const items = plan('2026-06-13', { statuses, sent, checkups: ['2026-06-20'] });
    const pre = items.find((i) => i.kind === 'pre_checkup');
    expect(pre && pre.kind === 'pre_checkup' && { date: pre.checkupDate, open: pre.open.map((m) => m.id) }).toEqual({
      date: '2026-06-20',
      open: ['fx-talk-1', 'fx-play-1'],
    });
    expect(sentKey(pre!)).toBe('pre_checkup:2026-06-20');
  });

  it('leaves never-asked items from long-past windows off the pre-checkup list', () => {
    // Bot started at 13 months: the 1-2 and 3-5 windows ended without check-ins, 6-12 ended too but was asked.
    const items = plan('2027-04-13', { checkups: ['2027-04-20'], sent: new Set(['check_in:fx-think-1']) });
    const pre = items.find((i) => i.kind === 'pre_checkup');
    expect(pre && pre.kind === 'pre_checkup' && pre.open.map((m) => m.id)).toEqual(['fx-think-1']);
  });

  it('catches up on a missed pre-checkup reminder before the visit, not after', () => {
    expect(kinds(plan('2026-06-16', { checkups: ['2026-06-20'], sent: new Set(['heads_up:3', 'check_in:fx-play-1']) }))).toEqual(['pre_checkup:2026-06-20']);
    expect(kinds(plan('2026-06-20', { checkups: ['2026-06-20'], sent: new Set(['heads_up:3', 'check_in:fx-play-1']) }))).toEqual([]);
    expect(plan('2026-06-16', { checkups: ['2026-06-20'], sent: new Set(['heads_up:3', 'check_in:fx-play-1', 'pre_checkup:2026-06-20']) })).toEqual([]);
  });

  it('uses the due date when corrected age is on', () => {
    const corrected = { ...child, useCorrectedAge: true };
    // Due 2026-03-28: the 1-month band opens 2026-04-28.
    expect(kinds(plan('2026-04-10', { child: corrected }))).toEqual([]);
    expect(kinds(plan('2026-04-28', { child: corrected }))).toEqual(['check_in:fx-move-1', 'check_in:fx-talk-1']);
  });
});
