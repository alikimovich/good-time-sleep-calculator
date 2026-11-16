// Good Time's own alarm tones (LKM-696), synthesized here from sine waves: no recording, no
// third-party asset, nothing downloaded. The WAVs in assets/sounds/ are this file's output:
//
//   bun tools/alarm-tones.mjs          # writes assets/sounds/alarm-<name>.wav
//
// Each is 16-bit PCM, mono, 22.05 kHz, 8 seconds: inside what a Contract `sound` declares (PCM, at
// most 10 s; the preview plays it) and what Apple plays as a custom alert sound (Linear PCM in a
// .wav, under 30 s; AlarmKit's `AlertConfiguration.AlertSound.named`). tools/alarm-tones.test.ts
// checks the committed files against this generator.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const RATE = 22050;
export const SECONDS = 8;
/** The tones' ids, as app.ts, app.contract and WakeAlarmCore.swift name them. */
export const TONES = ['sunrise', 'chime', 'pulse'];

const TAU = 2 * Math.PI;
const note = (semitonesFromA4) => 440 * 2 ** (semitonesFromA4 / 12);

/** A soft attack and an exponential tail, so a note neither clicks nor cuts off. */
function envelope(t, attack, decay) {
  if (t < 0) return 0;
  const a = t < attack ? t / attack : 1;
  return a * Math.exp(-(t - Math.min(t, attack)) / decay);
}

/** Adds a note with these partials ([ratio, gain]) at `start` seconds. */
function strike(out, start, freq, gain, partials, attack, decay) {
  const from = Math.floor(start * RATE);
  const to = Math.min(out.length, from + Math.ceil((attack + decay * 7) * RATE));
  for (let i = from; i < to; i++) {
    const t = (i - from) / RATE;
    let s = 0;
    for (const [ratio, g] of partials) s += g * Math.sin(TAU * freq * ratio * t);
    out[i] += gain * envelope(t, attack, decay) * s;
  }
}

const tones = {
  // A rising major arpeggio that grows louder each round: a gentle start.
  sunrise(out) {
    const steps = [-9, -5, -2, 3, 7, 10]; // C5 E5 G5 C6 E6 G6, from A4
    const warm = [[1, 1], [2, 0.25], [3, 0.08]];
    for (let round = 0; round < 4; round++) {
      const gain = 0.35 + round * 0.15;
      steps.forEach((s, k) => strike(out, round * 2 + k * 0.22, note(s), gain, warm, 0.02, 0.35));
    }
  },
  // A struck bell (inharmonic partials, a long ring) every two seconds, two notes apart.
  chime(out) {
    const bell = [[1, 1], [2.76, 0.45], [5.4, 0.22], [8.93, 0.1]];
    for (let k = 0; k < 4; k++) {
      strike(out, k * 2, note(3), 0.7, bell, 0.004, 0.55);
      strike(out, k * 2 + 0.5, note(-2), 0.55, bell, 0.004, 0.55);
    }
  },
  // The classic digital alarm: four short beeps, a pause, again.
  pulse(out) {
    const beep = [[1, 1], [3, 0.2], [5, 0.06]];
    for (let group = 0; group < 8; group++) {
      for (let b = 0; b < 4; b++) strike(out, group + b * 0.12, 2000, 0.6, beep, 0.004, 0.012);
    }
  },
};

/** The tone's samples, 16-bit, peak-normalized to -1 dBFS, with the last 50 ms faded out. */
export function samples(name) {
  const make = tones[name];
  if (!make) throw new Error(`no tone named ${name}`);
  const out = new Float64Array(RATE * SECONDS);
  make(out);
  const fade = Math.floor(0.05 * RATE);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const scale = peak > 0 ? (0.891 * 32767) / peak : 0;
  return Int16Array.from(out, (v) => Math.round(v * scale));
}

/** A RIFF/WAVE file: PCM, mono, 16-bit. */
export function wav(pcm, rate = RATE) {
  const data = pcm.length * 2;
  const bytes = new Uint8Array(44 + data);
  const view = new DataView(bytes.buffer);
  const ascii = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, 36 + data, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, data, true);
  pcm.forEach((v, i) => view.setInt16(44 + i * 2, v, true));
  return bytes;
}

export const path = (name) => resolve(import.meta.dir, '..', 'assets/sounds', `alarm-${name}.wav`);

if (import.meta.main) {
  for (const name of TONES) {
    writeFileSync(path(name), wav(samples(name)));
    console.log(`wrote ${path(name)}`);
  }
}
