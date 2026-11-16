// The alarm tones in assets/sounds/ (LKM-696): they are what tools/alarm-tones.mjs makes, and they stay inside
// what a Contract `sound` and an AlarmKit custom sound accept (16-bit PCM WAV, at most 10 s, under 30 s).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
// @ts-ignore: a plain module, not type-checked
import { RATE, TONES, path, samples, wav } from './alarm-tones.mjs';
import { ALARM_SOUNDS } from '../app.ts';

describe('alarm tones', () => {
  test('the app offers System default and each generated tone', () => {
    expect(ALARM_SOUNDS).toEqual(['default', ...TONES]);
  });

  for (const name of TONES as string[]) {
    test(`${name}: PCM 16-bit mono WAV, 8 s, as generated`, () => {
      const file = new Uint8Array(readFileSync(path(name)));
      const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
      const text = (at: number) => String.fromCharCode(...file.slice(at, at + 4));
      expect(text(0)).toBe('RIFF');
      expect(text(8)).toBe('WAVE');
      expect(view.getUint16(20, true)).toBe(1); // PCM
      expect(view.getUint16(22, true)).toBe(1); // mono
      expect(view.getUint32(24, true)).toBe(RATE);
      expect(view.getUint16(34, true)).toBe(16);
      const seconds = view.getUint32(40, true) / 2 / RATE;
      expect(seconds <= 10).toBe(true);
      // Within a sample's rounding of the generator, so a different float library does not fail it.
      const made = wav(samples(name)) as Uint8Array;
      expect(made.length).toBe(file.length);
      const committed = new Int16Array(file.buffer.slice(file.byteOffset + 44, file.byteOffset + file.byteLength));
      const fresh = new Int16Array(made.buffer.slice(44));
      let worst = 0;
      for (let i = 0; i < fresh.length; i++) worst = Math.max(worst, Math.abs(fresh[i] - committed[i]));
      expect(worst <= 1).toBe(true);
      // Not silent.
      let peak = 0;
      for (const v of committed) peak = Math.max(peak, Math.abs(v));
      expect(peak > 20000).toBe(true);
    });
  }
});
