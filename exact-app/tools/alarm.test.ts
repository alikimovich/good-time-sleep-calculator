// The wake-up alarm's side in app.ts (LKM-696): what a native reply shows, and the wall clock a row
// sets an alarm from. The scheduling itself is Swift's: tools/wake-alarm-tests.swift.
import { describe, expect, test } from 'bun:test';
import { alarmErrorShown, alarmSound, alarmView, formatAlarm, MODULE_FAILED, UNSUPPORTED, wallClock } from '../app.ts';

const at = Date.UTC(2026, 2, 16, 8, 0); // Mon 16 Mar 2026, 08:00 UTC

describe('wallClock', () => {
  test('is the 24-hour wall clock in the zone', () => {
    expect(wallClock(at, 'UTC')).toBe('08:00');
    expect(wallClock(at, 'Europe/Moscow')).toBe('11:00');
    expect(wallClock(Date.UTC(2026, 2, 16, 0, 5), 'UTC')).toBe('00:05');
    expect(wallClock(Date.UTC(2026, 2, 16, 23, 59), 'America/Los_Angeles')).toBe('16:59');
  });
  test('falls back to the host zone for an unknown one', () => {
    expect(wallClock(at, 'Not/AZone')).toMatch(/^\d\d:\d\d$/);
  });
});

describe('alarmView', () => {
  test('no reply, or the web, is unsupported', () => {
    for (const reply of [null, undefined, UNSUPPORTED]) {
      const v = alarmView(reply, 'en-US', 'UTC');
      expect(v.available).toBe(false);
      expect(v.scheduled).toBe(false);
      expect(v.label).toBe('');
    }
  });
  test('a scheduled alarm shows the day and time the system holds', () => {
    const v = alarmView({ available: true, auth: 'authorized', scheduled: true, at, hhmm: '08:00', error: '' }, 'en-US', 'UTC');
    expect(v.scheduled).toBe(true);
    // ICU writes "Mon, Mar 16, 8:00 AM" on some hosts and "Mon, Mar 16 at 8:00 AM" on others.
    expect(v.label).toMatch(/^Mon, Mar 16(,| at) 8:00 AM$/);
    expect(v.time).toBe('8:00 AM');
    expect(v.hhmm).toBe('08:00');
  });
  test('the label is in the person\'s zone and language', () => {
    expect(formatAlarm(at, 'en-US', 'America/New_York')).toMatch(/^Mon, Mar 16(,| at) 4:00 AM$/);
    expect(formatAlarm(at, 'ru-RU', 'Europe/Moscow')).toContain('11:00');
  });
  test('no success without an instant: scheduled with no time is not scheduled', () => {
    const v = alarmView({ available: true, auth: 'authorized', scheduled: true, at: 0, hhmm: '08:00', error: '' }, 'en-US', 'UTC');
    expect(v.scheduled).toBe(false);
    expect(v.label).toBe('');
  });
  test('a refusal carries its error and no alarm', () => {
    const v = alarmView({ available: true, auth: 'denied', scheduled: false, at: 0, hhmm: '', error: 'denied' }, 'en-US', 'UTC');
    expect(v.auth).toBe('denied');
    expect(v.error).toBe('denied');
    expect(v.scheduled).toBe(false);
  });
});

describe('errors', () => {
  test('a module failure is a failure, not "unsupported"', () => {
    const v = alarmView(MODULE_FAILED, 'en-US', 'UTC');
    expect(v.available).toBe(true);
    expect(v.showError).toBe(true);
  });
  test('which errors get a message', () => {
    expect(alarmErrorShown('', 'authorized')).toBe(false);
    expect(alarmErrorShown('busy', 'authorized')).toBe(false);
    expect(alarmErrorShown('unsupported', 'unsupported')).toBe(false);
    expect(alarmErrorShown('denied', 'denied')).toBe(false); // the denied card says it
    expect(alarmErrorShown('denied', 'notDetermined')).toBe(true); // asked, but nothing came of it
    expect(alarmErrorShown('failed', 'authorized')).toBe(true);
    expect(alarmErrorShown('invalid', 'authorized')).toBe(true);
  });
});

describe('sound', () => {
  test('a known id is kept; anything else is the system default', () => {
    expect(alarmSound('chime')).toBe('chime');
    expect(alarmSound('default')).toBe('default');
    for (const id of ['', null, undefined, 'Chime', '../x', 'ringtone']) expect(alarmSound(id)).toBe('default');
  });
  test('a scheduled alarm shows the sound the system was given', () => {
    const v = alarmView({ available: true, auth: 'authorized', scheduled: true, at, hhmm: '08:00', error: '', sound: 'sunrise' }, 'en-US', 'UTC');
    expect(v.sound).toBe('sunrise');
    const old = alarmView({ available: true, auth: 'authorized', scheduled: true, at, hhmm: '08:00', error: '' }, 'en-US', 'UTC');
    expect(old.sound).toBe('default');
    expect(alarmView(UNSUPPORTED, 'en-US', 'UTC').sound).toBe('');
  });
  test('setWakeAlarm passes the chosen sound, and a safe one', async () => {
    const { answer } = await import('../app.ts');
    const sent: Record<string, unknown>[] = [];
    const native = { available: true, later: async (r: Record<string, unknown>) => { sent.push(r); return { available: true, auth: 'authorized', scheduled: true, at, hhmm: '08:00', error: '', sound: r.sound }; } };
    const call = answer as unknown as (s: string, a: unknown[], st: unknown, sg: unknown, n: unknown) => Promise<{ sound: string }>;
    const v = await call('setWakeAlarm', ['08:00', 'UTC', 'Wake up', 'Stop', at, 'en-US', 'pulse'], null, null, native);
    expect(sent[0].sound).toBe('pulse');
    expect(v.sound).toBe('pulse');
    await call('setWakeAlarm', ['08:00', 'UTC', 'Wake up', 'Stop', at, 'en-US', 'nope'], null, null, native);
    expect(sent[1].sound).toBe('default');
  });
});
