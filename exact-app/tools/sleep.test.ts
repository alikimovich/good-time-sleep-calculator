// Unit tests for app.ts's sleep-cycle math, checked against the SwiftUI app's formulas
// (good-time/WakeUpView.swift, BedTimeView.swift). Run: bun test tools/
import { describe, expect, test } from 'bun:test';
import { bedTimes, formatClock, parseClock, progressPercentage, wakeUpInstant, wakeUpTimes } from '../app.ts';

const MIN = 60_000;
const at = (iso: string) => Date.parse(iso);

describe('wakeUpTimes', () => {
  test('defaults: 15 min to fall asleep, 90 min cycles, 3 to 6 cycles, earliest first', () => {
    const now = at('2026-03-15T23:00:00Z');
    expect(wakeUpTimes(now, 15, 90)).toEqual([
      { cycles: 3, at: at('2026-03-16T03:45:00Z') },
      { cycles: 4, at: at('2026-03-16T05:15:00Z') },
      { cycles: 5, at: at('2026-03-16T06:45:00Z') },
      { cycles: 6, at: at('2026-03-16T08:15:00Z') },
    ]);
  });
  test('follows the settings', () => {
    const now = 0;
    expect(wakeUpTimes(now, 30, 100).map((w) => w.at / MIN)).toEqual([330, 430, 530, 630]);
    expect(wakeUpTimes(now, 5, 70).map((w) => w.at / MIN)).toEqual([215, 285, 355, 425]);
  });
});

describe('bedTimes', () => {
  test('defaults: waking at 8:00, bed at 22:45, 0:15, 1:45, 3:15 (6 cycles first)', () => {
    const wake = at('2026-03-16T08:00:00Z');
    expect(bedTimes(wake, 15, 90)).toEqual([
      { cycles: 6, at: at('2026-03-15T22:45:00Z') },
      { cycles: 5, at: at('2026-03-16T00:15:00Z') },
      { cycles: 4, at: at('2026-03-16T01:45:00Z') },
      { cycles: 3, at: at('2026-03-16T03:15:00Z') },
    ]);
  });
  test('follows the settings', () => {
    expect(bedTimes(1000 * MIN, 20, 110).map((w) => [w.cycles, w.at / MIN])).toEqual([
      [6, 320], [5, 430], [4, 540], [3, 650],
    ]);
  });
});

test('progressPercentage: 3 cycles is half the bar, 6 is full', () => {
  expect([3, 4, 5, 6].map(progressPercentage)).toEqual([0.5, 0.5 + 1 / 6, 0.5 + 2 / 6, 1]);
});

describe('wakeUpInstant', () => {
  test('today at the chosen time, in the zone', () => {
    expect(wakeUpInstant(at('2026-03-15T06:30:00Z'), 0, '08:00')).toBe(at('2026-03-15T08:00:00Z'));
    // 23:30 in Los Angeles (UTC-7) on the 14th: "today" is the 14th there.
    expect(wakeUpInstant(at('2026-03-15T06:30:00Z'), -420, '07:15')).toBe(at('2026-03-14T14:15:00Z'));
    // Moscow (UTC+3): 01:00 on the 16th local.
    expect(wakeUpInstant(at('2026-03-15T22:00:00Z'), 180, '06:00')).toBe(at('2026-03-16T03:00:00Z'));
  });
  test('an unreadable value is 8:00, as the SwiftUI default', () => {
    expect(parseClock('')).toEqual({ hour: 8, minute: 0 });
    expect(parseClock('25:00')).toEqual({ hour: 8, minute: 0 });
    expect(parseClock('6:05')).toEqual({ hour: 6, minute: 5 });
  });
});

test('formatClock writes the region\'s short time', () => {
  const t = at('2026-03-15T22:45:00Z');
  expect(formatClock(t, 'en-US', 'UTC')).toBe('10:45 PM');
  expect(formatClock(t, 'ru-RU', 'UTC')).toBe('22:45');
  expect(formatClock(at('2026-03-15T07:05:00Z'), 'ru-RU', 'UTC')).toBe('07:05');
  expect(formatClock(t, 'en-US', 'America/Los_Angeles')).toBe('3:45 PM');
});
