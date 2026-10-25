export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

// Singapore has no daylight saving: a fixed UTC+8 offset is exact.
const SG_OFFSET_MS = 8 * 60 * 60 * 1000;

function sgShifted(clock: Clock): Date {
  return new Date(clock.now().getTime() + SG_OFFSET_MS);
}

/** Today's date in Asia/Singapore as YYYY-MM-DD. */
export function sgToday(clock: Clock): string {
  return sgShifted(clock).toISOString().slice(0, 10);
}

/** Current hour (0-23) in Asia/Singapore. */
export function sgHour(clock: Clock): number {
  return sgShifted(clock).getUTCHours();
}
