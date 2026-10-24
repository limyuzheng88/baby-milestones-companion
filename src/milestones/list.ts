// /show_milestones rendering and filters.

export type ListFilter = {
  /** Which answers to include. 'unanswered' = asked or in window but no answer yet. */
  status: 'all' | 'yes' | 'not_yet' | 'not_sure' | 'unanswered';
  /** 'current' = bands whose window has opened and not ended, plus open items from earlier bands. */
  scope: 'current' | 'all';
};

export const DEFAULT_FILTER: ListFilter = { status: 'all', scope: 'current' };
