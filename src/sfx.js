// sfx.js — foley synthesiser + compatibility layer of the unified sound system (audio.js is the home).
//
// API:
//   import { createAmbient } from './audio.js';
//   import { createSfx } from './sfx.js';
//   const amb = createAmbient();
//   const sfx = createSfx(amb);
//   sfx.play(name, opts)   name: one of SFX_NAMES (below). opts (all optional):
//                            surface: 'grass' | 'path' | 'wood' | 'stone' | 'moon'   (footstep only; default 'grass')
//                            speed:   fall speed in m/s           (land only; 0..~20, scales level + weight)
//                            gain:    extra linear gain, default 1 (clamped to 0..2); star with gain >= 1.3 = star_done
//                          Returns true if a sound was started, false if dropped (no context yet, muted,
//                          rate-limited, unknown name, silent name). Never throws, never creates an AudioContext.
//   sfx.step(surface)      shorthand for play('step', {surface}) with the footstep rate limit.
//   sfx.names              the list of effect names.
//
// Behaviour:
//   - star / butterfly / trampoline: delegated to amb.oneshot() (recorded piano sprite) when amb._spriteReady;
//     otherwise the synth below plays (fallback, e.g. while the sprite is missing).
//   - ui_open / ui_close / ui_click: silent no-ops returning false (no transition / UI click sounds).
//     Their synth recipes stay so the offline checks and SFX_NAMES order hold.
//   - step: one of three recorded variants per surface from the foley sprite (never the same one twice running),
//     with +-5 % rate and +-12 % gain; the moon's steps are softer. Synth fallback until the sprite is decoded.
//   - foley (step, jump, land, cannon_wind, cannon_fire, shutter): sfx bus (BUS_GAIN) -> amb.fx (one-shot bus)
//     -> master, falling back to amb.out. With audio.js it shares one voice cap (8) and one peak budget with the
//     sprite voices via amb._claimVoice / amb._budget.
// So mute (amb.setMuted), the first-gesture rule and the film duck apply to foley exactly as to the music.
//
// Synthesis: each effect is rendered ONCE per variant by a pure-JS function (synth(), exported) into
// a Float32Array, wrapped in an AudioBuffer and cached; play() starts an AudioBufferSourceNode with a
// small random playbackRate / gain. The offline Node checks render the very same synth() output.
// Synthesised tonal effects (fallback only) use D major pentatonic, the key of the bed.
//
// Pile-up guards: at most MAX_VOICES effects at once (oldest stopped first), footsteps no closer
// than STEP_MIN_GAP s, any effect identical to one started < 40 ms ago is dropped, and a peak budget
// (PEAK_BUDGET, budgetGain) turns new voices down (or drops them) so bed + effects cannot clip.

export const SFX_NAMES = ['step', 'jump', 'land', 'cannon_wind', 'cannon_fire', 'butterfly', 'star',
  'trampoline', 'ui_open', 'ui_close', 'ui_click', 'shutter'];
export const BUS_GAIN = 0.35;      // whole foley bus, linear (about -9 dB): master peak = buffer PEAK * gain * BUS_GAIN (* TRIM)
const MAX_VOICES = 8;
// Peak budget (linear, at the master): the summed nominal peaks of sounding effects + sprite voices stay under this.
// Single source of truth (audio.js imports PEAK_BUDGET, budgetGain, TAIL_WEIGHT, FRESH_S from here).
// Derivation: the bed has a true peak of -9.91 dBTP (0.320); the peak of a random 250 ms window of it
//   (the fresh part of a one-shot) has median 0.213, p90 0.250, p99 0.280.
//   PEAK_BUDGET = 10^(-6/20) - BED_WINDOW_PEAK = 0.501 - 0.213 = 0.288 (not rounded up, so the sum stays <= -6 dBFS; tests assert it): a pile-up landing on a typical bed
//   moment stays <= -6 dBTP; worst alignment with the bed's absolute peak is 0.320 + 0.288 = 0.61 (-4.3 dBFS), no clip.
//   Fits the largest legitimate pairs at nominal level: discover 0.224; hover (stopped, tail) 0.036 + select 0.178 =
//   0.214 (hover tail 0.022); select tail 0.045 + discover 0.224 = 0.269; star tails + star_done 0.200 <= 0.288.
// Tail weighting: a voice older than FRESH_S (or already stopped) counts TAIL_WEIGHT of its peak. Sprite slices can
// still reach 0.8-1.0 of their peak after 0.25 s, but maxima of different voices do not line up, and the full-mix
// true peak over the real bed stays <= -6 dBTP at 0.25 (a measured, not a proven, bound).
export const BED_WINDOW_PEAK = 0.213;
export const PEAK_BUDGET = 0.288;
export const TAIL_WEIGHT = 0.25, FRESH_S = 0.25;
export function budgetGain(activePeakSum, want) {
  const room = PEAK_BUDGET - activePeakSum;
  if (want <= room) return 1;
  if (room < 0.02) return 0;            // no room: drop it
  return room / want;
}
export function bufferPeak(x) { let p = 0; for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i])); return p; }
const STEP_MIN_GAP = 0.12;   // a run plants a foot every ~167 ms; frame and audio-clock jitter brings two plants to ~150 ms
const VARIANTS = { step: 4 };      // synthesised footsteps get 4 pre-rendered variants per surface
const STEP_SURFACES = { grass: 1, path: 1, wood: 1, stone: 1, moon: 1 };
const SYNTH_SURFACE = { path: 'grass', stone: 'wood' };   // the synth fallback has three surfaces
const STEP_GAIN = { moon: 0.5 };   // dust on the moon: its longer puff at half gain sits ~1 LU under a grass step

const TAU = Math.PI * 2;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- tiny DSP helpers (pure JS) ----------
function buf(sr, sec) { return new Float32Array(Math.max(1, Math.round(sr * sec))); }
// one-pole lowpass over an array in place, cutoff may be a function of time
function lp1(x, sr, fc) {
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    const f = typeof fc === 'function' ? fc(i / sr) : fc;
    const k = 1 - Math.exp(-TAU * f / sr);
    y += (x[i] - y) * k; x[i] = y;
  }
  return x;
}
// two-pole resonant bandpass (RBJ), in place
function bp(x, sr, f0, q) {
  const w = TAU * f0 / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w);
  const b0 = al, b2 = -al, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = (b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0; x[i] = y0;
  }
  return x;
}
function noise(x, r, amp = 1) { for (let i = 0; i < x.length; i++) x[i] = (r() * 2 - 1) * amp; return x; }
function add(dst, src, g = 1, at = 0) { for (let i = 0; i < src.length && i + at < dst.length; i++) dst[i + at] += src[i] * g; return dst; }
function normalise(x, peak) { let p = 0; for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i])); if (p > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / p; return x; }
function fadeTail(x, sr, sec = 0.01) { const n = Math.min(x.length, Math.round(sr * sec)); for (let i = 0; i < n; i++) x[x.length - 1 - i] *= i / n; return x; }
// ---------- timbre palette: shared with the ambient bed ----------
// Physically motivated sources only: felt-hammered strings / soft wooden modal mallets (inharmonic modes,
// per-mode decay, curved 3-8 ms attack, detuned pairs), noise-excited resonators, filtered air noise, and
// one short dense room that every effect passes through. No sine-plus-envelope beeps, no sine-drop kicks,
// no bright noise hats: nothing below ~70 Hz (hp) and nothing prominent above ~6 kHz (lp).
function hp1(x, sr, fc) { // one-pole highpass, in place
  const k = 1 - Math.exp(-TAU * fc / sr); let y = 0;
  for (let i = 0; i < x.length; i++) { y += (x[i] - y) * k; x[i] -= y; }
  return x;
}
// curved attack (sin^2 rise over atk s) then exponential decay (tau = dec); start offset in s
function senv(x, sr, atk, dec, start = 0) {
  const s0 = Math.round(start * sr);
  for (let i = 0; i < x.length; i++) {
    const t = (i - s0) / sr;
    x[i] *= t < 0 ? 0 : t < atk ? Math.pow(Math.sin(Math.PI / 2 * t / atk), 2) : Math.exp(-(t - atk) / dec);
  }
  return x;
}
// modal voice: each mode [ratio, amp, tau] is a detuned pair of damped partials with a curved attack.
// glide(t) optionally multiplies all frequencies (a soft membrane bend, not a sweep).
function modal(sr, sec, f0, modes, vel, atk, r, det = 0.0015, glide = null) {
  const x = buf(sr, sec), n = x.length;
  for (const [ratio, amp, tau] of modes) {
    for (const sgn of [-1, 1]) {
      const f = f0 * ratio * (1 + sgn * det * (0.6 + 0.8 * r()));
      if (f > sr * 0.45) continue;
      let ph = r(); const a0 = amp * vel * 0.5;
      const ma = Math.min(atk * (1 + ratio * 0.15), 0.012); // upper modes bloom a touch later: felt, not click
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += f * (glide ? glide(t) : 1) / sr; ph -= Math.floor(ph);
        const e = (t < ma ? Math.pow(Math.sin(Math.PI / 2 * t / ma), 2) : 1) * Math.exp(-t / tau);
        if (e < 1e-5 && t > ma) break;
        x[i] += Math.sin(TAU * ph) * a0 * e;
      }
    }
  }
  return x;
}
// felt-hammered string (near-harmonic, slightly stretched, upper modes die fast) and soft wooden/kalimba bar
const FELT = [[1, 1, 0.9], [2.004, 0.38, 0.42], [3.011, 0.14, 0.2], [4.027, 0.06, 0.1], [5.05, 0.025, 0.06]];
const WOOD = [[1, 1, 0.5], [2.76, 0.22, 0.14], [5.4, 0.06, 0.05], [8.93, 0.02, 0.02]];
// soft pressure onset: sin^2 fade-in over atk s (a foot loads the surface; nothing starts in < 1 ms)
function ease(x, sr, atk) { const n = Math.min(x.length, Math.round(sr * atk)); for (let i = 0; i < n; i++) x[i] *= Math.pow(Math.sin(Math.PI / 2 * i / n), 2); return x; }
function scaleTau(modes, k) { return modes.map(([a, b, c]) => [a, b, c * k]); }
// a soft struck note: modal body + a tiny low-passed felt contact noise
function note(sr, sec, m, vel, modes, atk, r, tauK = 1) {
  const x = modal(sr, sec, mtof(m), scaleTau(modes, tauK), vel, atk, r);
  add(x, senv(lp1(lp1(noise(buf(sr, 0.03), r), sr, 900), sr, 1400), sr, 0.002, 0.006), 0.18 * vel);
  return x;
}
// filtered air: noise -> bandpass(f, q) -> lowpass(lpf) -> curved envelope
function air(sr, sec, r, f, q, lpf, atk, dec, start = 0) {
  return senv(lp1(bp(noise(buf(sr, sec), r), sr, f, q), sr, lpf), sr, atk, dec, start);
}
// the shared short dense room (~0.14 s): sparse decaying taps, darkened. Returns a longer buffer (tail room).
const ROOM_LEN = 0.14;
function room(x, sr, mix) {
  const rr = mulberry32(9001), taps = [];
  for (let k = 0; k < 96; k++) {
    const d = 0.004 + Math.pow(rr(), 0.8) * (ROOM_LEN - 0.006);
    taps.push([Math.round(d * sr), (rr() < 0.5 ? -1 : 1) * Math.exp(-d / 0.045) * (0.5 + rr() * 0.5)]);
  }
  let norm = 0; for (const t of taps) norm += Math.abs(t[1]);
  const wet = new Float32Array(x.length + Math.round(ROOM_LEN * sr));
  for (const [d, g] of taps) { const gg = g / norm * 3.2; for (let i = 0; i < x.length; i++) wet[i + d] += x[i] * gg; }
  lp1(lp1(wet, sr, 2600), sr, 3400);
  const y = new Float32Array(wet.length);
  for (let i = 0; i < y.length; i++) y[i] = (i < x.length ? x[i] : 0) + wet[i] * mix;
  return y;
}

// Peak targets of the raw buffer before the bus gain (normalise() sets them exactly). Soft attacks carry less
// loudness per unit peak, so the effects sit under the bed rather than on top of it. The step is capped at hover's
// master peak (louder would eat about half the peak budget at walking rate); jump is capped at land's master peak so a
// jump + select pair stays inside PEAK_BUDGET (jump is a slow swell with a high crest).
const PEAK = {
  step: 0.223, jump: 0.40, land: 0.5, cannon_wind: 0.4, cannon_fire: 0.5, butterfly: 0.28, star: 0.45,
  trampoline: 0.32, ui_open: 0.22, ui_close: 0.2, ui_click: 0.16, shutter: 0.55,
};
// runtime trim after BUS_GAIN (linear); the step level lives in PEAK.step (master peak 0.223 * 0.35 = 0.078).
const TRIM = { step: 1 };
// names that the unified system plays from the recorded sprite when it is loaded (amb.oneshot)
const SPRITE_NAMES = { star: 1, butterfly: 1, trampoline: 1 };
// UI taps are silent (no transition sounds). Names kept in SFX_NAMES.
const SILENT = { ui_open: 1, ui_close: 1, ui_click: 1 };
const ROOM_MIX = { step: 0.07, jump: 0.15, land: 0.08, cannon_wind: 0.18, cannon_fire: 0.15, butterfly: 0.25, star: 0.28,
  trampoline: 0.2, ui_open: 0.15, ui_close: 0.15, ui_click: 0.12, shutter: 0.1 };

// ---------- toy-material foley ----------
// The music is a playful F-major piano piece; foley is "light, playful, toy-like: soft, short, rounded". Two primitives:
//  softPress: a low-passed noise grain shaped like a soft press (sin^2 rise over `rise` s, cosine release) - the felt /
//    foam / rubber contact, never a crack: nothing reaches full level in < 4 ms and nothing much above lpf.
//  toyBody:   1-3 damped, inharmonic, low-Q modes of a small toy object (felt-padded wood block, cardboard box, rubber
//    ball), each a detuned pair with a curved attack (modal()). Modal resonances of materials, not an instrument note:
//    short (tau 10-45 ms), non-integer ratios, 250-1700 Hz.
function softPress(sr, r, rise, len, lpf, hpf = 120) {
  const x = noise(buf(sr, len), r), n = x.length, nr = Math.max(1, Math.round(rise * sr));
  for (let i = 0; i < n; i++) x[i] *= i < nr ? Math.pow(Math.sin(Math.PI / 2 * i / nr), 2) : Math.pow(Math.cos(Math.PI / 2 * (i - nr) / Math.max(1, n - nr)), 2);
  lp1(lp1(x, sr, lpf), sr, lpf * 1.3); hp1(x, sr, hpf);
  return x;
}
function toyBody(sr, r, f0, ratios, amps, tau, atk, glide = null) {
  return modal(sr, tau * 7 + atk + 0.01, f0, ratios.map((k, i) => [k, amps[i], tau * (1 - 0.18 * i)]), 1, atk, r, 0.004, glide);
}
// one toy pat = press + body; returns a mono buffer `sec` long with the pat at 0
function toyPat(sr, sec, r, p) {
  const x = buf(sr, sec);
  const pr = softPress(sr, r, p.rise, p.len, p.lpf);
  const b = toyBody(sr, r, p.f0, p.ratios, p.amps, p.tau, p.atk, p.glide);
  add(x, normalise(pr, 1), p.noise); add(x, normalise(b, 1), p.body, Math.round(sr * 0.002));
  return x;
}

// ---------- the effects ----------
// synth(name, sampleRate, {surface, variant, speed}) -> Float32Array (mono). Pure, deterministic per variant.
export function synth(name, sr = 48000, o = {}) {
  const surface = o.surface || 'grass', variant = o.variant | 0;
  const seedStr = name + ':' + surface + ':' + variant;
  let seed = 17; for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) | 0;
  const r = mulberry32(seed);
  let x;
  switch (name) {
    case 'step': {
      // a tiny soft toy pat, not a footstep recording and not a drum: a felt/foam press
      // (8-20 ms sin^2 rise, 40-90 ms) on 2 low-Q inharmonic modes of a small padded wood block / cardboard box.
      // Odd variants are the other foot (slightly lower, softer). grass = brushier press, wood = hollower box,
      // moon = softer, duller, slower.
      const foot = variant & 1, fk = foot ? 0.93 : 1;
      const P = surface === 'wood'
        ? { rise: 0.009, len: 0.045, lpf: 900, f0: 820 * fk * (1 + 0.04 * r()), ratios: [1, 1.47, 2.09], amps: [1, 0.5, 0.2], tau: 0.026, atk: 0.006, noise: 0.15, body: 1 }
        : surface === 'moon'
          ? { rise: 0.016, len: 0.07, lpf: 600, f0: 600 * fk * (1 + 0.04 * r()), ratios: [1, 1.61, 2.27], amps: [1, 0.3, 0.1], tau: 0.02, atk: 0.012, noise: 0.1, body: 1 }
          : { rise: 0.011, len: 0.055, lpf: 1200, f0: 700 * fk * (1 + 0.05 * r()), ratios: [1, 1.57, 2.21], amps: [1, 0.4, 0.15], tau: 0.022, atk: 0.009, noise: 0.12, body: 1 };
      x = toyPat(sr, 0.16, r, P);
      lp1(x, sr, surface === 'moon' ? 1100 : 2400); ease(x, sr, 0.004); hp1(x, sr, 110);
      break;
    }
    case 'jump': { // a small soft upward "pff" of a rubber toy: rounded press + a rubber mode that bends up a little
      x = toyPat(sr, 0.16, r, { rise: 0.016, len: 0.06, lpf: 800, f0: 620, ratios: [1, 1.68, 2.3], amps: [1, 0.3, 0.1], tau: 0.03, atk: 0.01, noise: 0.15, body: 1,
        glide: (t) => 1 + 0.22 * (1 - Math.exp(-t / 0.04)) });
      lp1(x, sr, 2200); hp1(x, sr, 140);
      break;
    }
    case 'land': { // a soft rounded pat-pat of two feet; faster = lower, rounder, longer body, the second pat closer
      const s = Math.max(0, Math.min(1, (o.speed == null ? 6 : o.speed) / 14));
      x = buf(sr, 0.22);
      const gap = 0.07 - 0.015 * s;
      for (const [at, g, k] of [[0, 1, 1], [gap, 0.75, 0.92]]) {
        add(x, toyPat(sr, 0.2, r, { rise: 0.014 + 0.004 * s, len: 0.06, lpf: 800, f0: (760 - 110 * s) * k * (1 + 0.03 * r()),
          ratios: [1, 1.52, 2.24], amps: [1, 0.45, 0.18], tau: 0.022 + 0.008 * s, atk: 0.01, noise: 0.08, body: 1 }), g, Math.round(sr * at));
      }
      lp1(x, sr, 2000); hp1(x, sr, 90);
      break;
    }
    case 'cannon_wind': { // a soft toy ratchet: 10 rounded plastic/wood ticks, slightly accelerating, low-passed
      x = buf(sr, 0.7);
      let tt = 0.02;
      for (let k = 0; k < 10; k++) {
        const t = toyPat(sr, 0.06, r, { rise: 0.003, len: 0.012, lpf: 1400, f0: 1150 + r() * 90, ratios: [1, 1.47, 2.13], amps: [1, 0.4, 0.15], tau: 0.012, atk: 0.003, noise: 0.12, body: 1 });
        add(x, t, 0.6 + 0.4 * k / 9, Math.round(sr * (tt + (r() - 0.5) * 0.004)));
        tt += 0.062 - k * 0.0025;
      }
      lp1(x, sr, 2600); hp1(x, sr, 160);
      break;
    }
    case 'cannon_fire': { // a soft cork "pop": a rounded press, a hollow mode that drops a little, then a small soft puff
      x = buf(sr, 0.36);
      add(x, toyPat(sr, 0.2, r, { rise: 0.006, len: 0.04, lpf: 1000, f0: 760, ratios: [1, 1.43, 2.05], amps: [1, 0.35, 0.12], tau: 0.035, atk: 0.005, noise: 0.15, body: 1,
        glide: (t) => 1.12 - 0.12 * (1 - Math.exp(-t / 0.03)) }));
      add(x, softPress(sr, r, 0.03, 0.16, 700, 100), 0.12, Math.round(sr * 0.02)); // puff of air from the cork, small
      lp1(x, sr, 2400); hp1(x, sr, 110);
      break;
    }
    case 'butterfly': { // a flutter of air and three tiny soft-mallet notes, A5 B5 D6
      x = buf(sr, 0.9);
      const ns = [81, 83, 86];
      for (let k = 0; k < ns.length; k++) add(x, note(sr, 0.7, ns[k], 0.9 - k * 0.12, WOOD, 0.004, r, 0.4), 1, Math.round(sr * (k * 0.07 + r() * 0.012)));
      const fl = air(sr, 0.9, r, 2400, 1.2, 4500, 0.05, 0.12);
      for (let i = 0; i < fl.length; i++) fl[i] *= 0.6 + 0.4 * Math.sin(TAU * 17 * i / sr);
      add(x, fl, 0.12);
      break;
    }
    case 'star': { // gentle rising felt figure D5 F#5 A5, the last one rings
      x = buf(sr, 1.4);
      const ns = [[74, 0.7, 0], [78, 0.8, 0.095 + r() * 0.01], [81, 1, 0.2 + r() * 0.012]];
      for (const [m, v, at] of ns) add(x, note(sr, 1.3, m, v, FELT, 0.006, r, at > 0.15 ? 0.85 : 0.45), 1, Math.round(sr * at));
      add(x, note(sr, 1.0, 86, 0.18, WOOD, 0.008, r, 0.9), 1, Math.round(sr * 0.21)); // faint wooden octave colour
      break;
    }
    case 'trampoline': { // soft springy membrane: felt D3 + A3 with a small upward bend, cushioned
      x = buf(sr, 0.6);
      const bend = t => 1 + 0.06 * (1 - Math.exp(-t / 0.05));
      add(x, modal(sr, 0.6, mtof(50), scaleTau(FELT, 0.28), 1, 0.006, r, 0.003, bend));
      add(x, modal(sr, 0.6, mtof(57), scaleTau(FELT, 0.2), 0.45, 0.007, r, 0.003, bend));
      add(x, air(sr, 0.6, r, 400, 1, 1200, 0.01, 0.05), 0.35);
      hp1(x, sr, 80);
      break;
    }
    case 'ui_open': { // two tiny soft wooden taps up: A4 -> D5
      x = buf(sr, 0.35);
      add(x, note(sr, 0.3, 69, 0.8, WOOD, 0.004, r, 0.25)); add(x, note(sr, 0.3, 74, 1, WOOD, 0.004, r, 0.3), 1, Math.round(sr * 0.065));
      break;
    }
    case 'ui_close': { // two tiny soft wooden taps down: D5 -> A4
      x = buf(sr, 0.33);
      add(x, note(sr, 0.3, 74, 0.8, WOOD, 0.004, r, 0.22)); add(x, note(sr, 0.28, 69, 1, WOOD, 0.004, r, 0.25), 1, Math.round(sr * 0.06));
      break;
    }
    case 'ui_click': { // one tiny felt-wood tap, F#5
      x = note(sr, 0.12, 78, 1, WOOD, 0.003, r, 0.12);
      break;
    }
    case 'shutter': { // a tiny toy-camera click-clack: two small rounded plastic ticks, the second lower
      x = buf(sr, 0.16);
      add(x, toyPat(sr, 0.06, r, { rise: 0.0025, len: 0.01, lpf: 2600, f0: 1250, ratios: [1, 1.38], amps: [1, 0.45], tau: 0.01, atk: 0.002, noise: 0.35, body: 1 }), 1);
      add(x, toyPat(sr, 0.07, r, { rise: 0.003, len: 0.012, lpf: 2000, f0: 900, ratios: [1, 1.52], amps: [1, 0.4], tau: 0.014, atk: 0.0025, noise: 0.35, body: 1 }), 0.85, Math.round(sr * 0.065));
      lp1(x, sr, 3200); hp1(x, sr, 200);
      break;
    }
    default: return null;
  }
  x = room(x, sr, ROOM_MIX[name]);
  fadeTail(x, sr, 0.03);
  // land weight by speed is also in the peak (0.8 .. 1.0 of PEAK.land over 0..14 m/s)
  return normalise(x, name === 'land' ? PEAK.land * (0.8 + 0.2 * Math.max(0, Math.min(1, (o.speed == null ? 6 : o.speed) / 14))) : PEAK[name]);
}

// ---------- runtime ----------
// Routing: foley -> one sfx bus GainNode (BUS_GAIN) -> amb.fx (the shared one-shot bus in audio.js)
// -> master; falls back to amb.out when amb.fx is absent (the smoke tests' fakes).
// When amb exposes _claimVoice/_budget (audio.js), foley shares the one voice cap (8, oldest stolen) and the one
// peak budget with the sprite voices; otherwise it keeps its own local cap/budget (same numbers).
// jump / land / cannon_wind / cannon_fire / shutter and the footsteps play recorded slices from earshot's shipped
// bank (web/assets/audio/foley.json + foley.m4a, packed by audio-src/foley/pack-foley.py, each slice peak-normalised to
// PEAK[name] so the budget is unchanged; foley.steps holds three variants per surface at stepPeak = PEAK.step). Loaded once through amb._onLoad (unmuted load chain); until it is decoded,
// or if it fails, the synthesised versions below play. star / butterfly / trampoline stay on the piano sprite.
/* GB1 (Engraver dial): warmer/colder detent tick. Closeness 0..1 maps to a playback rate (pitch AND brightness of the
   recorded slice), a low-pass cutoff and a level, all strictly increasing, so the tick climbs as the dial nears the answer.
   Pure, so the offline render in the evidence uses this very function. Recorded foley slice only; no oscillator. */
export function tickParams(closeness) {
  const c = Math.max(0, Math.min(1, +closeness || 0));
  return { rate: 0.7 + 1.0 * c, cutoff: 700 * Math.pow(10, c), gain: 0.3 + 0.7 * c };   // 0.70..1.70, 700 Hz..7 kHz, 0.3..1.0
}
const FOLEY_URL = new URL('../assets/audio/foley.json', import.meta.url);
const FOLEY_NAMES = { jump: 1, land: 1, cannon_wind: 1, cannon_fire: 1, shutter: 1 };
export function createSfx(amb) {
  let bus = null, busCtx = null;
  let foley = null, foleyBuf = null, foleyState = 'none';
  async function loadFoley(ctx) {
    if (foleyState !== 'none' || !ctx || typeof fetch !== 'function') return;
    foleyState = 'loading';
    try {
      const r = await fetch(FOLEY_URL); if (!r.ok) throw new Error('HTTP ' + r.status);
      const man = await r.json(); if (!man || !man.slices || !man.file) throw new Error('bad foley manifest');
      const r2 = await fetch(new URL(man.file, FOLEY_URL)); if (!r2.ok) throw new Error('HTTP ' + r2.status);
      const bytes = await r2.arrayBuffer();
      const b = await new Promise((res, rej) => { try { const p = ctx.decodeAudioData(bytes, res, rej); if (p && p.then) p.then(res, rej); } catch (e) { rej(e); } });
      foley = man; foleyBuf = b; foleyState = 'ready';
    } catch (_) { foleyState = 'failed'; }
  }
  if (amb && typeof amb._onLoad === 'function') amb._onLoad(loadFoley);
  const cache = new Map();
  const voices = [];             // local fallback only: {src, t0, end, peak}
  let lastStep = -1, lastStepVar = -1, lastByName = Object.create(null), pendingStar = null;
  const shared = () => !!(amb && typeof amb._claimVoice === 'function' && typeof amb._budget === 'function');

  function ensureBus(ctx) {
    if (bus && busCtx === ctx) return bus;
    try {
      bus = ctx.createGain(); bus.gain.value = BUS_GAIN;
      bus.connect(amb.fx || amb.out); busCtx = ctx;
    } catch (_) { bus = null; }
    return bus;
  }
  function getBuffer(ctx, name, o) {
    const landBand = name === 'land' ? Math.round(Math.max(0, Math.min(20, o.speed == null ? 6 : o.speed)) / 4) : 0; // 6 weight bands
    const key = name + '|' + (o.surface || '') + '|' + (o.variant | 0) + '|' + landBand;
    let b = cache.get(key);
    if (b) return b;
    const data = synth(name, ctx.sampleRate, { surface: o.surface, variant: o.variant, speed: name === 'land' ? landBand * 4 : o.speed });
    if (!data) return null;
    b = ctx.createBuffer(1, data.length, ctx.sampleRate);
    b.getChannelData(0).set(data);
    b._peak = bufferPeak(data);
    cache.set(key, b);
    return b;
  }

  function play(name, opts) {
    try {
      const o = opts || {};
      const ctx = amb && amb.ctx;
      if (!ctx || !amb.out || amb.muted || ctx.state !== 'running') return false;
      if (!SFX_NAMES.includes(name)) return false;
      if (SILENT[name]) return false;
      if (SPRITE_NAMES[name] && amb._spriteReady && typeof amb.oneshot === 'function') {
        const n2 = name === 'star' && o.gain != null && +o.gain >= 1.3 ? 'star_done' : name;
        // the last star grab and star_done arrive in the same frame (main.js: grab, then done). The grab is held
        // for one microtask and star_done supersedes it, so the completion figure is never turned down by the budget.
        if (n2 === 'star') { const p = { o }; pendingStar = p; Promise.resolve().then(() => { if (pendingStar === p) { pendingStar = null; amb.oneshot('star', o); } }); return true; }
        if (n2 === 'star_done') pendingStar = null;
        return !!amb.oneshot(n2, o);
      }
      const now = ctx.currentTime;
      if (name === 'step') { if (now - lastStep < STEP_MIN_GAP) return false; lastStep = now; }
      if (lastByName[name] != null && now - lastByName[name] < 0.04) return false;
      lastByName[name] = now;
      const surface = name === 'step' ? (STEP_SURFACES[o.surface] ? o.surface : 'grass') : undefined;
      const variant = VARIANTS[name] ? (Math.random() * VARIANTS[name]) | 0 : 0;
      let sl = FOLEY_NAMES[name] && foleyState === 'ready' && foley.slices[name];
      const steps = name === 'step' && foleyState === 'ready' && foley.steps && foley.steps[surface];
      if (steps && steps.length) {
        let i = (Math.random() * steps.length) | 0;
        if (steps.length > 1 && i === lastStepVar) i = (i + 1) % steps.length;
        lastStepVar = i; sl = { start: steps[i].start, dur: steps[i].dur, peak: foley.stepPeak };
      }
      let b;
      if (sl) { b = foleyBuf; }
      else b = getBuffer(ctx, name, { surface: SYNTH_SURFACE[surface] || surface, variant, speed: o.speed });
      const out = ensureBus(ctx);
      if (!b || !out) return false;
      const sh = shared();
      if (!sh) {
        // local voice cap: stop the oldest
        for (let i = voices.length - 1; i >= 0; i--) if (voices[i].end <= now) voices.splice(i, 1);
        while (voices.length >= MAX_VOICES) { const v = voices.shift(); try { v.src.stop(); } catch (_) { } }
      }
      let lvl = Math.max(0, Math.min(2, o.gain == null ? 1 : +o.gain || 0));
      if (name === 'step') lvl *= STEP_GAIN[surface] || 1;
      if (sl && name === 'land' && o.speed != null) lvl *= Math.max(0.55, Math.min(1, 0.45 + (+o.speed || 0) / 25));   // a light hop lands softer
      const bPeak = sl ? (+sl.peak || 0.5) : b._peak, bDur = sl ? +sl.dur : b.duration;
      let gv = lvl * (1 + (Math.random() * 2 - 1) * (name === 'step' ? 0.12 : 0.05)) * (TRIM[name] || 1);
      // pile-up guard: keep the summed peaks of sounding effects under PEAK_BUDGET
      const want = bPeak * lvl * (TRIM[name] || 1) * BUS_GAIN;   // nominal: the +-5/12 % jitter never decides
      let k;
      if (sh) k = amb._budget(now, want);
      else { let active = 0; for (const v of voices) active += now - v.t0 < FRESH_S ? v.peak : v.peak * TAIL_WEIGHT; k = budgetGain(active, want); }
      if (k === 0) return false;
      gv *= k;
      const src = ctx.createBufferSource();
      src.buffer = b;
      const jitter = name === 'step' ? 0.05 : 0.03; // footsteps +-5 %
      src.playbackRate.value = 1 + (Math.random() * 2 - 1) * jitter;
      const g = ctx.createGain();
      if (typeof amb._noteNodes === 'function') amb._noteNodes(2);
      g.gain.value = gv;
      src.connect(g); g.connect(out);
      if (sl) src.start(now, +sl.start + (+foley.decoderOffsetSamples || 0) / (+foley.sampleRate || 48000), bDur); else src.start(now);
      const v = { src, t0: now, end: now + bDur / src.playbackRate.value + 0.05, peak: bPeak * gv * BUS_GAIN, kind: name,
        stop() { try { src.stop(); } catch (_) { } v.end = 0; } };
      src.onended = () => { try { g.disconnect(); } catch (_) { } const i = voices.indexOf(v); if (i >= 0) voices.splice(i, 1); v.end = 0; };
      if (sh) amb._claimVoice(v); else voices.push(v);
      return true;
    } catch (_) { return false; }
  }


  /* GB1: one detent tick from the recorded 'land' knock (foley sprite), shaped by tickParams(closeness).
     Returns the params used (or null when nothing sounded). Own 35 ms gap; shares the voice cap and peak budget. */
  let lastTick = -1;
  function tick(closeness) {
    try {
      const ctx = amb && amb.ctx;
      if (!ctx || !amb.out || amb.muted || ctx.state !== 'running' || foleyState !== 'ready' || !foley.slices.land) return null;
      const now = ctx.currentTime; if (now - lastTick < 0.035) return null; lastTick = now;
      const P = tickParams(closeness), sl = foley.slices.land, out = ensureBus(ctx);
      if (!out) return null;
      const want = (+sl.peak || 0.5) * P.gain * BUS_GAIN;
      const k = shared() ? amb._budget(now, want) : 1;
      if (k === 0) return null;
      const src = ctx.createBufferSource(); src.buffer = foleyBuf; src.playbackRate.value = P.rate;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = P.cutoff; lp.Q.value = 0.5;
      const g = ctx.createGain(); g.gain.value = P.gain * k;
      if (typeof amb._noteNodes === 'function') amb._noteNodes(3);
      src.connect(lp); lp.connect(g); g.connect(out);
      src.start(now, +sl.start + (+foley.decoderOffsetSamples || 0) / (+foley.sampleRate || 48000), +sl.dur);
      const v = { src, t0: now, end: now + (+sl.dur) / P.rate + 0.05, peak: want * k, kind: 'tick',
        stop() { try { src.stop(); } catch (_) { } v.end = 0; } };
      src.onended = () => { try { g.disconnect(); lp.disconnect(); } catch (_) { } v.end = 0; };
      if (shared()) amb._claimVoice(v);
      return P;
    } catch (_) { return null; }
  }

  return {
    play,
    tick,
    step(surface) { return play('step', { surface }); },
    get names() { return SFX_NAMES.slice(); },
    get foleyState() { return foleyState; },
    get voices() { if (shared()) { try { return amb.stats.voices; } catch (_) { return 0; } } return voices.length; },
  };
}
