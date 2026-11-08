// sfx.js — foley synthesiser + compatibility layer of the unified sound system (audio.js is the home).
//
// API:
//   import { createAmbient } from './audio.js?v=20261108-2229';
//   import { createSfx } from './sfx.js?v=20261108-2229';
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
/* R7 F2 (v2): the creature babble planner. Pure and deterministic given `rng`, so the offline renders in the evidence use this
   very function. The line's text drives a string of short chunks (about one per syllable, with a small foley/consonant chunk
   before some of them); punctuation sets the contour: "?" rises, "!" spikes, "..." trails off (falling, quieter, stretched),
   "," lifts and pauses briefly, "." falls and pauses. spec = one creature's manifest entry:
   { cps (syllables/s), vdur (mean vowel chunk s), pitch: [lo, hi] semitones, modem (0..1 chance per phrase), chunks: {..} }.
   Returns { events: [{ t, cls, key, pick, rate, gain }], dur, speed }. Chunk keys: a e i o u (voiced), plo, fri, liq, mod. */
export function plainLine(text) {
  return String(text == null ? '' : text).replace(/<\/?[a-z][^>]*>/gi, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
const ONSET_CLASS = (c) => 'bpdtkgqc'.includes(c) ? 'plo' : 'sfvzhxj'.includes(c) ? 'fri' : 'lrmnwy'.includes(c) ? 'liq' : null;
const ONSET_P = { plo: 0.75, fri: 0.7, liq: 0.35 };
export function syllabify(word) {
  const w = word.replace(/[^a-z]/g, ''); if (!w) return [];
  const out = []; const re = /([^aeiouy]*)([aeiouy]+)/g; let m;
  while ((m = re.exec(w))) out.push({ onset: m[1] ? m[1][0] : '', v: m[2][0] === 'y' ? 'i' : m[2][0] });
  if (!out.length) out.push({ onset: w[0], v: null });   // "hm", "psst": no vowel, a consonant puff only
  return out;
}
export function planBabble(text, spec, rng, o) {
  rng = rng || Math.random; o = o || {};
  const maxS = o.maxS || 5.0;
  // src = the line exactly as the slate shows it (tags stripped, five entities decoded: slate.js plainText), so a char index here is a char index there
  const src = plainLine(text), low = src.toLowerCase().replace(/’/g, "'");
  const toks = [...low.matchAll(/[a-z']+|\.{2,}|…|[,.!?;:—–-]/g)].map(m => ({ s: m[0], i: m.index }));
  const lo = spec.pitch ? spec.pitch[0] : -5, hi = spec.pitch ? spec.pitch[1] : 9, vdur = spec.vdur || 0.12, base = spec.base || 0;   // base: a whole-voice shift in semitones (VOICE_DOWN)
  const attempt = (speed) => {
    const ev = [], cps = (spec.cps || 7) * speed;
    let tt = 0, sem = 0, phraseStart = 0, sylInPhrase = [];   // sylInPhrase: indices into ev of this phrase's vowel events
    const flush = (punct) => {
      const idx = sylInPhrase, n = idx.length; sylInPhrase = [];
      if (n) {
        const bump = (j, st, g, stretch) => { const e = ev[idx[n - 1 - j]]; if (!e) return; e.rate *= Math.pow(2, st / 12); e.gain *= g; };
        if (punct === '?') { bump(1, 3, 1.05); bump(0, 6.5, 1.1); }
        else if (punct === '!') { bump(1, 5, 1.35); bump(0, 2, 1.15); }
        else if (punct === '…') { bump(2, -1.5, 0.8); bump(1, -3, 0.6); bump(0, -5, 0.4); }
        else if (punct === ',') { bump(0, 1.5, 1.0); }
        else if (punct === '.') { bump(0, -2, 0.95); }
      }
      if (punct === '…') tt += 0.38; else if (punct === '.') tt += 0.26; else if (punct === '?' || punct === '!') tt += 0.3; else if (punct === ',') tt += 0.14;
      sem = (rng() - 0.5) * 3; phraseStart = ev.length;
      if (spec.modem && rng() < spec.modem && n >= 2) ev.push({ t: Math.max(0, tt - 0.12), cls: 'mod', key: 'mod', pick: rng(), rate: (0.9 + rng() * 0.3) * Math.pow(2, base / 12), gain: 0.5 });
    };
    const rv = [];   // reveal schedule: { t, n } = at time t the first n chars of src are shown
    for (let ti = 0; ti < toks.length; ti++) {
      const tkO = toks[ti], tk = tkO.s;
      if (/^[a-z']+$/.test(tk)) {
        const syl = syllabify(tk), nx = toks[ti + 1], tail = nx && /^[,.!?;:—–-]$|^\.{2,}$|^…$/.test(nx.s) && nx.i === tkO.i + tk.length ? nx.s.length : 0;
        if (!syl[0].v) rv.push({ t: tt, n: tkO.i + tk.length + tail });
        syl.forEach((s, si) => {
          sem = sem * 0.8 + (rng() - 0.5) * 2.6 - 0.3;               // a short random walk with a pull to centre and a gentle declination
          const stress = si === 0 ? 1.2 : 0, st = Math.max(lo, Math.min(hi, sem + stress));
          const period = (1 / cps) * (0.85 + 0.3 * rng()), g = (si === 0 ? 1.12 : 0.92) * (0.9 + 0.2 * rng());
          const cls = s.onset ? ONSET_CLASS(s.onset) : null;
          let lead = 0;
          if (cls && rng() < (ONSET_P[cls] || 0.5)) { ev.push({ t: tt, cls, key: cls, pick: rng(), rate: Math.pow(2, (st + base + (rng() - 0.5)) / 12), gain: 0.75 * g }); lead = Math.min(0.035, period * 0.3); }
          if (s.v) { ev.push({ t: tt + lead, cls: 'v', key: s.v, pick: rng(), rate: Math.pow(2, (st + base) / 12), gain: g }); sylInPhrase.push(ev.length - 1);
            rv.push({ t: tt + lead, n: si === syl.length - 1 ? tkO.i + tk.length + tail : tkO.i + Math.max(1, Math.round(tk.length * (si + 1) / syl.length)) }); }
          tt += period;
        });
        tt += 0.02;                                                // a hair of space between words
      } else {
        flush(/^\.{2,}$|…/.test(tk) ? '…' : /[;:—–-]/.test(tk) ? ',' : tk);
      }
    }
    flush(null);
    let end = 0; for (const e of ev) end = Math.max(end, e.t + (e.cls === 'v' ? vdur : 0.08) / e.rate);
    return { ev, end, rv };
  };
  let speed = 1, r = attempt(speed);
  if (r.end > maxS) { speed = Math.min(1.5, r.end / maxS); r = attempt(speed); }
  const events = r.ev.filter(e => e.t < maxS).sort((a, b) => a.t - b.t);
  const reveal = r.rv.filter(e => e.t < maxS).sort((a, b) => a.t - b.t);
  const lastT = reveal.length ? reveal[reveal.length - 1].t : 0;
  reveal.push({ t: lastT + 0.12, n: src.length });   // a line cut at maxS still finishes with its last chunk
  return { events, dur: Math.min(maxS + 0.2, Math.max(r.end, lastT + 0.2)), speed, reveal, len: src.length };
}
const CREATURES_URL = new URL('../assets/audio/creatures.json', import.meta.url);
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
  /* R7 F2: creature interaction voices. A second sprite (creatures.m4a/json, built by audio-src/creatures/make-creatures.py
     from recorded cello/viola sustains and earshot bank foley; no oscillators). Loaded through the same unmuted load chain.
     No synth fallback on purpose: until it is decoded (or if it fails) voice() stays silent rather than beeping. */
  let cre = null, creBuf = null, creState = 'none';
  async function loadCreatures(ctx) {
    if (creState !== 'none' || !ctx || typeof fetch !== 'function') return;
    creState = 'loading';
    try {
      const r = await fetch(CREATURES_URL); if (!r.ok) throw new Error('HTTP ' + r.status);
      const man = await r.json(); if (!man || !man.voices || !man.file) throw new Error('bad creatures manifest');
      const r2 = await fetch(new URL(man.file, CREATURES_URL)); if (!r2.ok) throw new Error('HTTP ' + r2.status);
      const bytes = await r2.arrayBuffer();
      const b = await new Promise((res, rej) => { try { const p = ctx.decodeAudioData(bytes, res, rej); if (p && p.then) p.then(res, rej); } catch (e) { rej(e); } });
      cre = man; creBuf = b; creState = 'ready';
    } catch (_) { creState = 'failed'; }
  }
  if (amb && typeof amb._onLoad === 'function') amb._onLoad(loadCreatures);
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

  /* R7 F2 (v2): creature babble. voice(name, { text, ready }) = the creature's opening emotion one-shot now, then, once
     `ready()` says the slate has popped (animation first, THEN the slate: the order in main.js talk() is untouched), the
     line's text drives a string of short chunks from that creature's own bank (planBabble, above). emote(name, kind) plays
     one emotion one-shot ('happy' | 'annoyed' | 'surprised'). Same gates as play() (running context, not muted); the whole
     babble shares the voice cap and the peak budget as ONE voice (stop() silences every chunk). Every call, played or dropped,
     is appended to voiceLog and printed with console.debug('[sfx.voice]'). Chunk and emotion banks: creatures.m4a/json. */
  const voiceLog = [], lastVoice = Object.create(null), lastEmo = Object.create(null);
  const logVoice = (e) => { voiceLog.push(e); if (voiceLog.length > 80) voiceLog.shift(); try { console.debug('[sfx.voice]', JSON.stringify(e)); } catch (_) { } };
  const voiceKey = (n) => { const s = String(n || '').toLowerCase(); if (s === 'ap') return 'ap'; for (const k of ['lumen', 'sid', 'gulp', 'chomp', 'zip']) if (s.includes(k)) return k; return null; };
  /* R7: AP (the igloo NPC) talks too. He has no bank of his own: he borrows Lumen's warm chunks, pitched down and a little slower,
     with a narrower, flatter contour, so he reads as a calm grown-up next to the creatures. */
  const AP_FROM = 'lumen';
  /* each creature's babble is shifted down as a whole (semitones, via playbackRate, so pitch and formants move together);
     0 keeps the bank's own pitch (AP, and Zip the yak, keep theirs) */
  const VOICE_DOWN = { zip: 0, sid: -5, lumen: -4, chomp: -3, gulp: -2, ap: 0 };
  const bankV = (key) => { const V = bankV0(key); return V && VOICE_DOWN[key] ? { ...V, base: VOICE_DOWN[key] } : V; };
  const bankV0 = (key) => { if (!cre) return null; if (key !== 'ap' || cre.voices.ap) return cre.voices[key]; const L = cre.voices[AP_FROM]; if (!L) return null;
    const p = L.pitch || [-5, 9]; return { ...L, pitch: [p[0] - 5, p[0] + Math.round((p[1] - p[0]) * 0.5) - 3], cps: (L.cps || 7) * 0.85, modem: 0 }; };
  const bankVary = (key) => cre && (cre.vary[key] || cre.vary[AP_FROM]);   // 'ap' has its own dedicated bank now (make-babble.py); the Lumen-pitched-down fallback is kept for an old sprite
  const gate = (key, why0) => {
    const ctx = amb && amb.ctx;
    if (!key) return 'unknown creature';
    if (!ctx || !amb.out) return 'no context';
    if (amb.muted) return 'muted';
    if (ctx.state !== 'running') return 'ctx ' + ctx.state;
    if (creState !== 'ready' || !bankV(key)) return 'sprite ' + creState;
    return null;
  };
  const peakFilter = (ctx, vary) => {
    const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.Q.value = 1.1;
    pk.frequency.value = vary.f[0] + Math.random() * (vary.f[1] - vary.f[0]); pk.gain.value = vary.gdb * (0.4 + 0.6 * Math.random());
    return pk;
  };
  function emote(name, kind, opts) {
    const o = opts || {}, key = voiceKey(name);
    try {
      const why = gate(key); if (why) { logVoice({ key, emote: kind, ok: false, why }); return false; }
      const V = bankV(key), takes = V.emo && V.emo[kind];
      if (!takes || !takes.length) { logVoice({ key, emote: kind, ok: false, why: 'no such emotion' }); return false; }
      const ctx = amb.ctx, now = ctx.currentTime, out = ensureBus(ctx);
      if (!out) return false;
      let ti = (Math.random() * takes.length) | 0;
      if (takes.length > 1 && ti === lastEmo[key + kind]) ti = (ti + 1) % takes.length;
      lastEmo[key + kind] = ti;
      const tk = takes[ti], vary = bankVary(key);
      const lvl = Math.max(0, Math.min(2, o.gain == null ? 1 : +o.gain || 0));
      const rate = (1 + (Math.random() * 2 - 1) * vary.rate) * Math.pow(2, (V.base || 0) / 12), dB = (Math.random() * 2 - 1) * 1.0;
      const want = (+V.peak || 0.3) * lvl * BUS_GAIN;
      const k = shared() ? amb._budget(now, want) : 1;
      if (k === 0) { logVoice({ key, emote: kind, ok: false, why: 'budget' }); return false; }
      const gv = lvl * Math.pow(10, dB / 20) * k;
      const src = ctx.createBufferSource(); src.buffer = creBuf; src.playbackRate.value = rate;
      const pk = peakFilter(ctx, vary), g = ctx.createGain(); g.gain.value = gv;
      if (typeof amb._noteNodes === 'function') amb._noteNodes(3);
      src.connect(pk); pk.connect(g); g.connect(out);
      src.start(now, +tk.start + (+cre.decoderOffsetSamples || 0) / (+cre.sampleRate || 48000), +tk.dur);
      const v = { src, t0: now, end: now + tk.dur / rate + 0.05, peak: want * gv, kind: 'emote:' + key,
        stop() { try { src.stop(); } catch (_) { } v.end = 0; } };
      src.onended = () => { try { g.disconnect(); pk.disconnect(); } catch (_) { } v.end = 0; };
      if (shared()) amb._claimVoice(v);
      logVoice({ t: +now.toFixed(3), key, emote: kind, take: ti, rate: +rate.toFixed(3), gain: +gv.toFixed(3), budgetK: +k.toFixed(2), peakF: Math.round(pk.frequency.value), peakDb: +pk.gain.value.toFixed(1), busGain: BUS_GAIN, dur: +(tk.dur / rate).toFixed(2), ok: true });
      return true;
    } catch (e) { return false; }
  }
  let curBabble = null;
  function stopBabble(tail) {
    const b = curBabble; if (!b) return false; curBabble = null;
    try {
      const now = b.ctx.currentTime, t = tail == null ? 0.12 : tail;
      b.master.gain.cancelScheduledValues(now); b.master.gain.setValueAtTime(b.master.gain.value, now); b.master.gain.linearRampToValueAtTime(0, now + t);
      for (const [sr] of b.srcs) { try { sr.stop(now + t + 0.03); } catch (_) { } }
      logVoice({ key: b.key, stopBabble: true, tailMs: Math.round(t * 1000), ok: true });
    } catch (_) { }
    return true;
  }
  const nowS = () => performance.now() / 1000;
  const DEFAULT_SPEC = { cps: 7, vdur: 0.12, pitch: [-5, 9], modem: 0 };
  // no sound (muted, or the sprite is not ready): the text still types at the very same pace, from the same planner
  function silent(key, text, o, why) {
    const spec = bankV(key) || DEFAULT_SPEC, plan = planBabble(text, spec, Math.random);
    if (typeof o.reveal === 'function') o.reveal(plan, nowS(), nowS, null);
    logVoice({ key, say: plainLine(text).slice(0, 48), silent: true, why, chunks: 0, dur: +plan.dur.toFixed(2), revealSteps: plan.reveal.length, ok: true });
    return plan;
  }
  function say(name, text, opts) {
    const o = opts || {}, key = voiceKey(name);
    try {
      const why = gate(key); if (why) return key ? silent(key, text, o, why) : false;
      const V = bankV(key), vary = bankVary(key), ctx = amb.ctx, now = ctx.currentTime, out = ensureBus(ctx);
      if (!out) return silent(key, text, o, 'no bus');
      const plan = planBabble(text, V, Math.random);
      if (!plan.events.length) { logVoice({ key, say: true, ok: false, why: 'empty line' }); return false; }
      const lvl = Math.max(0, Math.min(2, o.gain == null ? 1 : +o.gain || 0));
      const want = (+V.chunkPeak || 0.3) * lvl * BUS_GAIN * 1.3;   // chunks seldom overlap: about 1.3 chunk peaks at once
      let k = shared() ? amb._budget(now, want) : 1;
      if (k === 0) { logVoice({ key, say: true, ok: false, why: 'budget (played at 0.3 instead)' }); k = 0.3; }   // a creature's voice is never dropped by the budget: it is the point of the poke
      stopBabble(0.05);
      const master = ctx.createGain(); master.gain.value = lvl * k * Math.pow(10, ((Math.random() * 2 - 1) * 1.0) / 20);
      const pk = peakFilter(ctx, vary);
      master.connect(pk); pk.connect(out);
      const off = (+cre.decoderOffsetSamples || 0) / (+cre.sampleRate || 48000), srcs = [], t0 = now + 0.05 + (+o.delay || 0);
      for (const e of plan.events) {
        const bank = V.chunks[e.key]; if (!bank || !bank.length) continue;
        const ck = bank[Math.min(bank.length - 1, (e.pick * bank.length) | 0)];
        const src = ctx.createBufferSource(); src.buffer = creBuf;
        src.playbackRate.value = Math.max(0.5, Math.min(2.4, e.rate * (1 + (Math.random() * 2 - 1) * 0.02)));
        const g = ctx.createGain(); g.gain.value = e.gain;
        src.connect(g); g.connect(master);
        src.start(t0 + e.t, +ck.start + off, +ck.dur); srcs.push([src, g]);
      }
      if (typeof amb._noteNodes === 'function') amb._noteNodes(srcs.length * 2 + 2);
      const v = { src: srcs[0] && srcs[0][0], t0, end: t0 + plan.dur + 0.1, peak: want * k, kind: 'babble:' + key,
        stop() { for (const [s] of srcs) { try { s.stop(); } catch (_) { } } v.end = 0; } };
      curBabble = { ctx, master, srcs, key };
      if (srcs.length) srcs[srcs.length - 1][0].onended = () => { for (const [s, g] of srcs) { try { g.disconnect(); } catch (_) { } } try { master.disconnect(); pk.disconnect(); } catch (_) { } v.end = 0; if (curBabble && curBabble.master === master) curBabble = null; };
      if (shared()) amb._claimVoice(v);
      // the reveal runs on the AUDIO clock: chunk i sounds at t0 + e.t, and its syllable is revealed at the same instant
      if (typeof o.reveal === 'function') o.reveal(plan, t0, () => ctx.currentTime, stopBabble);
      logVoice({ t: +t0.toFixed(3), key, say: plainLine(text).slice(0, 48), chunks: srcs.length, dur: +plan.dur.toFixed(2), speed: +plan.speed.toFixed(2),
        masterGain: +master.gain.value.toFixed(3), budgetK: +k.toFixed(2), peakF: Math.round(pk.frequency.value), busGain: BUS_GAIN, revealSteps: plan.reveal.length, ok: true });
      return plan;
    } catch (e) { return false; }
  }
  const OPENING = { lumen: 'happy', sid: 'happy', gulp: 'surprised', chomp: 'annoyed', zip: 'happy' };   // what each creature does the moment you poke it
  function voice(name, opts) {
    const o = opts || {}, key = voiceKey(name);
    try {
      if (!key) { logVoice({ name, ok: false, why: 'unknown creature' }); return false; }
      // NOT gated here (R7 fix, Lumen): Lumen is the first creature a visitor pokes, usually while the sprite is still decoding or the
      // arrival radio is on. The opening one-shot and the babble each gate themselves, and wait for the sprite instead of giving up.
      try { if (typeof window !== 'undefined' && window.__radio && window.__radio.stop) window.__radio.stop(); } catch (_) { }
      const t0 = performance.now(), ctx0 = amb && amb.ctx;
      if (ctx0 && lastVoice[key] != null && ctx0.currentTime - lastVoice[key] < 0.4) { logVoice({ key, ok: false, why: 'rate limit' }); return false; }
      if (ctx0) lastVoice[key] = ctx0.currentTime;
      const tryEmote = () => {
        if (amb && !amb.muted && creState !== 'ready' && creState !== 'failed' && performance.now() - t0 < 3000) return setTimeout(tryEmote, 80);   // sprite still decoding
        emote(name, o.emoteKind || OPENING[key], { gain: o.gain });
      };
      if (typeof o.emoteWhen === 'function') {
        // the opening one-shot lands on a beat of the trick, not at the poke: wait for the cue, then `emoteDelay` ms (Chomp: on its snap)
        const iv0 = setInterval(() => {
          let r = false; try { r = !!o.emoteWhen(); } catch (_) { }
          if (r) { clearInterval(iv0); setTimeout(tryEmote, +o.emoteDelay || 0); }
          else if (performance.now() - t0 > 8000) { clearInterval(iv0); tryEmote(); }
        }, 16);
      } else tryEmote();
      if (o.text && typeof o.ready === 'function') {
        let sawIdle = false;
        const iv = setInterval(() => {
          let r = false; try { r = !!o.ready(); } catch (_) { }
          if (!r) sawIdle = true;
          else if (sawIdle) { clearInterval(iv); say(name, o.text, { gain: o.gain, reveal: o.reveal }); return; }
          if (performance.now() - t0 > 25000) clearInterval(iv);
        }, 30);
      } else if (o.text) say(name, o.text, { gain: o.gain, reveal: o.reveal });
      return true;
    } catch (e) { return false; }
  }

  return {
    play,
    voice, emote, say, stopBabble,
    get voiceLog() { return voiceLog.slice(); },
    get creaturesState() { return creState; },
    tick,
    step(surface) { return play('step', { surface }); },
    get names() { return SFX_NAMES.slice(); },
    get foleyState() { return foleyState; },
    get voices() { if (shared()) { try { return amb.stats.voices; } catch (_) { return 0; } } return voices.length; },
  };
}
