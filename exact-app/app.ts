import type { Answer, Result, Sources } from './app.contract.d.ts';

// The wake-up alarm (LKM-696): AlarmKit's permission prompt, with `purpose.alarms` as its text
// (NSAlarmKitUsageDescription).
export const grants = 'device.alarms purpose.alarms';

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

/** The wall clock at `at` in `timeZone`, "HH:MM" (24-hour): what a wake-up alarm is set from. */
export function wallClock(at: number, timeZone: string): string {
  let format: Intl.DateTimeFormat;
  const options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  try {
    format = new Intl.DateTimeFormat('en-US', { ...options, timeZone: timeZone || undefined });
  } catch {
    format = new Intl.DateTimeFormat('en-US', options);
  }
  const parts = format.formatToParts(new Date(at));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${part('hour').padStart(2, '0')}:${part('minute')}`;
}

/** An alarm's day and time as the person's region writes them: "Mon, Mar 16, 8:00 AM". */
export function formatAlarm(at: number, locale: string, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat(locale || undefined, { ...options, timeZone: timeZone || undefined });
  } catch {
    format = new Intl.DateTimeFormat(undefined, options);
  }
  return format.format(new Date(at)).replace(/[\u202f\u00a0]/g, ' ');
}

type Row = Result<'schedule'>['wake'][number];

const rows = (times: Wake[], locale: string, timeZone: string): Row[] =>
  times.map(({ cycles, at }) => ({
    cycles,
    time: formatClock(at, locale, timeZone),
    hhmm: wallClock(at, timeZone),
    progress: progressPercentage(cycles),
  }));

// The wake-up alarm (LKM-696): modules/apple/WakeAlarm.swift answers, through AlarmKit on iOS 26
// and later. Where there is no module (the web) or it cannot answer, the alarm is unsupported:
// never a notification in its place.

/** What the native module answers (WakeAlarmSnapshot.json). */
export interface AlarmReply {
  available: boolean;
  auth: string;
  scheduled: boolean;
  at: number;
  hhmm: string;
  error: string;
}

export type AlarmView = Result<'wakeAlarm'>;

export const UNSUPPORTED: AlarmReply = { available: false, auth: 'unsupported', scheduled: false, at: 0, hhmm: '', error: '' };

/** A reply as the view reads it, the alarm's day and time written for the person's region. */
export function alarmView(reply: Partial<AlarmReply> | null | undefined, locale: string, timeZone: string): AlarmView {
  const r = { ...UNSUPPORTED, ...(reply ?? {}) };
  const scheduled = Boolean(r.scheduled) && typeof r.at === 'number' && r.at > 0;
  return {
    available: Boolean(r.available),
    auth: String(r.auth),
    scheduled,
    at: scheduled ? r.at : 0,
    label: scheduled ? formatAlarm(r.at, locale, timeZone) : '',
    time: scheduled ? formatClock(r.at, locale, timeZone) : '',
    hhmm: scheduled ? String(r.hhmm) : '',
    error: String(r.error ?? ''),
  };
}

type Native = Parameters<Sources['wakeAlarm']>[3];

async function ask(native: Native, request: Record<string, unknown>): Promise<Partial<AlarmReply>> {
  if (!native?.available) return UNSUPPORTED;
  try {
    return (await native.later(request)) as Partial<AlarmReply>;
  } catch {
    // The web without a module, or a host that refused: no alarm here.
    return request.op === 'status' ? UNSUPPORTED : { ...UNSUPPORTED, error: 'unsupported' };
  }
}

const sources: Sources = {
  schedule: ([utcOffset, wakeUp, fallAsleep, cycleLength, locale, timeZone, now]): Result<'schedule'> => {
    const wakeAt = wakeUpInstant(now, utcOffset, wakeUp);
    return {
      wakeUpTime: formatClock(wakeAt, locale, timeZone),
      wake: rows(wakeUpTimes(now, fallAsleep, cycleLength), locale, timeZone),
      bed: rows(bedTimes(wakeAt, fallAsleep, cycleLength), locale, timeZone),
    };
  },
  wakeAlarm: async ([locale, timeZone], _store, _storage, native) => {
    native?.watch('alarm');
    return alarmView(await ask(native, { op: 'status' }), locale, timeZone);
  },
  setWakeAlarm: async ([hhmm, timeZone, title, now, locale], _store, _storage, native) =>
    alarmView(await ask(native, { op: 'set', hhmm, timeZone, title, now }), locale, timeZone),
  cancelWakeAlarm: async ([locale, timeZone], _store, _storage, native) =>
    alarmView(await ask(native, { op: 'cancel' }), locale, timeZone),
};
export const answer: Answer = (source, args, store, storage, native) =>
  sources[source](args, store, storage, native);
