import type { Answer, Result, Sources } from './app.contract.d.ts';

export const grants = '';

// The sleep-cycle math, as the SwiftUI app does it (good-time/WakeUpView.swift, BedTimeView.swift):
// a night is 3 to 6 whole cycles, after the time it takes to fall asleep.

const MINUTE = 60_000;
export const MIN_CYCLES = 3;
export const MAX_CYCLES = 6;
const CYCLES = [3, 4, 5, 6];

export interface Wake {
  cycles: number;
  at: number; // Unix milliseconds
}

/** Going to bed at `now`: wake after `fallAsleep` minutes and 3, 4, 5 or 6 cycles, earliest first. */
export function wakeUpTimes(now: number, fallAsleep: number, cycleLength: number): Wake[] {
  const base = now + fallAsleep * MINUTE;
  return CYCLES.map((cycles) => ({ cycles, at: base + cycles * cycleLength * MINUTE }));
}

/** Waking at `wakeUp`: go to bed `fallAsleep` minutes before 6, 5, 4 or 3 cycles, earliest first. */
export function bedTimes(wakeUp: number, fallAsleep: number, cycleLength: number): Wake[] {
  const base = wakeUp - fallAsleep * MINUTE;
  return CYCLES.map((cycles) => ({ cycles, at: base - cycles * cycleLength * MINUTE })).reverse();
}

/** The bar's fill: 3 cycles is half, 6 is full. */
export function progressPercentage(cycles: number): number {
  return (cycles - MIN_CYCLES) / (MAX_CYCLES - MIN_CYCLES) / 2 + 0.5;
}

/** "HH:MM" (an `input type="time"` value) as hours and minutes; 8:00 when unreadable. */
export function parseClock(value: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return { hour: 8, minute: 0 };
  const hour = Number(m[1]), minute = Number(m[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : { hour: 8, minute: 0 };
}

/**
 * Today at `value` ("HH:MM") in the zone `utcOffset` minutes east of UTC, as Unix milliseconds:
 * SwiftUI's `Calendar.current.date(bySettingHour:minute:second:0, of: Date())`.
 */
export function wakeUpInstant(now: number, utcOffset: number, value: string): number {
  const { hour, minute } = parseClock(value);
  const offset = utcOffset * MINUTE;
  const localMidnight = Math.floor((now + offset) / 86_400_000) * 86_400_000 - offset;
  return localMidnight + (hour * 60 + minute) * MINUTE;
}

/** A time of day as the person's region writes it (DateFormatter's `.short` time style). */
export function formatClock(at: number, locale: string, timeZone: string): string {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat(locale || undefined, { timeStyle: 'short', timeZone: timeZone || undefined });
  } catch {
    format = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
  }
  // ICU puts a narrow no-break space before AM/PM on some hosts and a space on others.
  return format.format(new Date(at)).replace(/[\u202f\u00a0]/g, ' ');
}

type Row = Result<'schedule'>['wake'][number];

const rows = (times: Wake[], locale: string, timeZone: string): Row[] =>
  times.map(({ cycles, at }) => ({
    cycles,
    time: formatClock(at, locale, timeZone),
    progress: progressPercentage(cycles),
  }));

const sources: Sources = {
  schedule: ([utcOffset, wakeUp, fallAsleep, cycleLength, locale, timeZone, now]): Result<'schedule'> => {
    const wakeAt = wakeUpInstant(now, utcOffset, wakeUp);
    return {
      wakeUpTime: formatClock(wakeAt, locale, timeZone),
      wake: rows(wakeUpTimes(now, fallAsleep, cycleLength), locale, timeZone),
      bed: rows(bedTimes(wakeAt, fallAsleep, cycleLength), locale, timeZone),
    };
  },
};
export const answer: Answer = (source, args, store, storage, native) =>
  sources[source](args, store, storage, native);
