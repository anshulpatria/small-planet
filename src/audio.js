// audio.js — the one sound manager for Small Planet (ambient bed + atmosphere + interaction one-shots).
// sfx.js stays the foley synthesiser and plugs into the one-shot bus defined here.
//
// API:
//   import { createAmbient } from './audio.js';
//   const amb = createAmbient();
//   amb.start()        call from a user gesture (click / keydown / pointerdown).
//                      Creates or resumes the AudioContext synchronously inside the gesture, fades in over ~4 s.
//                      Idempotent; never throws; never autoplays on its own.
//                      If the stored choice is muted, it unlocks audio but stays silent (see LOADING below).
//   amb.armUnlock(t)   listen on t (default window) for every activation-type event and call start()
//                      until the context is running; re-arms itself if the browser stops the context, and tries a
//                      resume on returning to the tab. amb.running / amb.unlockArmed / amb.level: diagnostics.
//   amb.setMuted(b)    smooth ~0.6 s fade; persists to localStorage 'archipelago.audio.muted'
//                      ('1' / '0'). When muted, the context is suspended after the fade (saves CPU).
//   amb.muted          getter: stored choice (default false = unmuted).
//   amb.toggle()       flips muted; returns the new muted value.
//   amb.duck(b)        true while a film plays: smoothly drops ~9 dB; false restores (master gain, unchanged).
//   amb.started        getter: true once start() has run successfully.
//   amb.ctx            getter: the AudioContext, or null until start() ran from a user gesture (for sfx.js).
//   amb.out            getter: the master GainNode (mute / duck / fade live here). Exists as soon as start() ran.
//   amb.fx             getter: the one-shot bus GainNode (-> master). Sprite voices and sfx.js foley connect here.
//   amb.layers         getter (diagnostics, read-only): [{id, state:'loading'|'playing'|'failed',
//                      loopStart, loopEnd, duration, sampleRate}] — [] until the manifest is read.
//   --- interaction layer ---
//   amb.hover(id)      soft resonance on ENTERING an interactive target. Pitch class (v2 sprite, PALETTE s6): from the
//                      bed's current chord (loop position since bedT0) ∩ F pentatonic {F G A C D}, else the chord's
//                      pcs; stable per id (hash), never the previous hover's pc when another fits. No bed: chord F.
//                      v1 sprite (hover.D ...): nearest available pc by semitone. Per-id cooldown 4 s, global gap 0.3 s, one hover voice: a new hover
//                      < 0.25 s after the current one started is skipped (stats.hoverSkips), otherwise the old
//                      one fades over ~80 ms. Returns true if a sound started.
//   amb.select(id, {discover})  a slightly louder bloom (pc as hover, no repeat rule), or 'discover.<chordKey>'.
//                      Fades any hover, own 0.5 s gap. Hover / select start immediately.
//   amb.oneshot(name)  sprite slice by name: star | star_done ('<name>.<chordKey>' in v2) | butterfly | trampoline.
//                      discover / star / star_done wait for the next 8th-note grid point only if it is <= 70 ms away.
//                      SPARKLE (exported const): discover / star_done (star -6 dB) add 'sparkle.<chordKey>' 40-120 ms
//                      later at LEVEL_DB.sparkle; a sparkle never turns a piano voice down (dropped instead).
//   amb.reading(key, on)  key in panel|map|film|booth|list. While any key is on the atmosphere is "reading":
//                      -5.5 dB, lowpass 1.9 kHz (Butterworth), linear / exponential ramps 1.2 s in, 2.5 s out (exact).
//   amb.motion(v, dir) camera angular speed in rad/s, every frame. Allocation-free; JS smoothing (0.3 s up,
//                      0.5 s down); AudioParams written <= 15 Hz with setTargetAtTime, only on meaningful change.
//                      Full speed (2.5 rad/s): atmos +1.25 dB, 'air' high shelf (2 kHz) +1.75 dB, width 1.2, balance by dir.
//   amb.place(body)    'planet' (exact rest) | 'moon' (lowpass 3 kHz, width 0.85, -1.5 dB, ~3 s). Idempotent.
//   amb.breath()       travel moment: atmosphere dips -1.5 dB (tau 0.15 s) and returns (tau 0.6 s).
//   amb.stats          getter: {voices, nodesCreated, reading, readingKeys, motion, place, hoverSkips, budgetHits,
//                      spriteState, chord, sparkles, sparkleDrops}
//   setMuted(true) also fades every sounding one-shot (sprite + foley) over the mute fade and stops it, so nothing
//   resumes on unmute.
//   hover/select/oneshot return false and schedule nothing while muted, suspended, before start(), or while
//   the sprite is not loaded; nothing is queued for later. motion/reading/place/breath only update state
//   then and are applied when the context is running again.
//   Private (for sfx.js only): amb._claimVoice(rec), amb._budget(now, want), amb._spriteReady, amb._noteNodes(n).
//
// GRAPH (all nodes created once in start(); per one-shot only an AudioBufferSourceNode is created):
//   layers (bed gain; detailMod is a fixed unity no-op) -> atmosIn (forced stereo, 'speakers' up-mix)
//     -> shelf (highshelf 2 kHz: motion 'air') -> lp (lowpass, Q -3 dB = 0.707: reading / moon) -> splitter -> 4 gains
//     (mid/side width + L/R balance folded into a 2x2 matrix) -> merger -> atmosGain (motion, breath)
//     -> calmGain (reading, moon; linear ramps) -> master `gain` -> destination
//   fx (GainNode, 1.0) -> master. Pool of POOL strips (gain -> StereoPanner -> fx), MAX_VOICES live voices.
// REST STATE (motion 0, nothing reading, place 'planet', no breath) is exactly transparent:
//   shelf gain 0 dB (RBJ highshelf with A=1 has b == a), lp frequency = Nyquist (WebAudio defines the
//   lowpass at normalised cutoff 1 as the identity), width matrix [[1,0],[0,1]], balance 1/1, atmosGain 1,
//   calmGain 1, detailMod 1. reading / place reach these values exactly at the end of their ramps. Mono layers are up-mixed L=R at atmosIn.
//
// Sound: pre-rendered seamless loops (web/assets/audio/ambient.json + one .m4a per layer), rendered offline
// by audio-src/. Each layer: fetch -> decodeAudioData -> looping AudioBufferSourceNode (loopStart/loopEnd in
// seconds from the manifest) -> per-layer GainNode -> atmosphere chain. Interaction sounds: one small sprite
// (web/assets/audio/interactions.json + interactions.m4a, schema in audio10 PALETTE s4); gain per play =
// 10^(targetDb/20) / slice.peak, compensated for the panner's equal-power law, so targets are sample peaks
// at the master (unmuted, undocked).
//
// LOADING: the sprite loads first (small), then layers strictly one after another (peak memory). Any failure
// (404, bad JSON, decode error, missing slice) leaves that part silent: one console.warn, no throw.
// Muted decision: if the stored choice is muted, start() still creates/resumes the context but DEFERS all
// fetching/decoding (sprite and bed) until the first unmute.

import { PEAK_BUDGET, budgetGain, TAIL_WEIGHT, FRESH_S } from './sfx.js';
const KEY = 'archipelago.audio.muted';
const LEVEL = 1.0;          // master level; masters are pre-leveled offline, so left at unity
const DUCK = 0.355;         // -9 dB
const FADE_IN = 4.0, FADE_MUTE = 0.6, FADE_DUCK = 1.2;
const MANIFEST_URL = new URL('../assets/audio/ambient.json', import.meta.url);
const SPRITE_URL = new URL('../assets/audio/interactions.json', import.meta.url);

// --- one-shot bus ---
const MAX_VOICES = 8;       // shared by sprite voices and sfx.js foley
const POOL = 12;            // strips: MAX_VOICES live + room for voices fading out after a steal
// PEAK_BUDGET / budgetGain / TAIL_WEIGHT: one source of truth in sfx.js (derivation there). Nominal levels are budgeted.
const LEVEL_DB = { hover: -20.5, select: -14, discover: -14, star: -15, star_done: -14, butterfly: -22, trampoline: -18, sparkle: -23 };   // RMS relative to the music: hover ~-8 dB, select/discover ~-3 dB; sparkle 9 dB under its piano layer
// SPARKLE: soft glock layer on discover / star_done (star at SPARKLE_STAR_DB more). Flip to false to remove it entirely.
export const SPARKLE = true;
const SPARKLE_STAR_DB = -6, SPARKLE_DMIN = 0.04, SPARKLE_DMAX = 0.12;
// v2 harmony (PALETTE s6): F major, pitch classes and diatonic triad keys
const PCS = ['F', 'G', 'A', 'Bb', 'C', 'D', 'E'];
const PENTA = ['F', 'G', 'A', 'C', 'D'];
const CHORD_KEYS = ['F', 'Gm', 'Am', 'Bb', 'C', 'Dm'];
const ROOT_KEY = { F: 'F', G: 'Gm', A: 'Am', Bb: 'Bb', C: 'C', D: 'Dm', E: 'C' };   // E(dim) = upper part of C7 -> C
const SEMI = { C: 0, Cs: 1, Db: 1, D: 2, Ds: 3, Eb: 3, E: 4, F: 5, Fs: 6, Gb: 6, G: 7, Gs: 8, Ab: 8, A: 9, As: 10, Bb: 10, B: 11 };
const DEFAULT_CHORD = { t: 0, root: 'F', pcs: ['F', 'A', 'C'], key: 'F' };
const SNAP_MAX = 0.070;     // discover / star / star_done wait for the next 8th only if it is this close
const HOVER_COOLDOWN = 4.0, HOVER_GAP = 0.3, HOVER_STEAL_MIN = 0.25, HOVER_FADE_TAU = 0.027, SELECT_GAP = 0.5;
const HOVER_AFTER_SELECT = 2.0;   // a select's bloom is not interrupted by a hover (e.g. 'go there' lands Blip on the spot)
// --- atmosphere ---
const READ_KEYS = ['panel', 'map', 'film', 'booth', 'list'];
// single-layer bed (dark piano, little above 4 kHz): reading must act low to be heard
const READ_DB = -5.5, READ_LP = 1900, READ_IN = 1.2, READ_OUT = 2.5;   // ramp seconds; endpoints exact
const LP_Q = -3;            // WebAudio lowpass Q is in dB: -3 dB = 0.707 (Butterworth, no bump)
const MOT_FULL = 2.5, MOT_ATK = 0.3, MOT_REL = 0.5, MOT_TAU = 0.12, MOT_DT = 1 / 15;
const MOT_ATMOS_DB = 1.25, MOT_WIDTH = 0.2, MOT_BAL = 0.06, MOT_SHELF_DB = 1.75;
const MOON_LP = 3000, MOON_DB = -1.5, MOON_WIDTH = 0.85, PLACE_S = 3.0, PLACE_TAU = 1.0;
const BREATH_DB = -1.5, BREATH_TAU_IN = 0.15, BREATH_HOLD = 0.45, BREATH_TAU_OUT = 0.6;
const SHELF_HZ = 2000;

function readMuted() {
  try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; }
}
function writeMuted(m) {
  try { localStorage.setItem(KEY, m ? '1' : '0'); } catch (_) { /* private mode */ }
}
function warn(msg, e) {
  try { console.warn('[audio] ' + msg + (e && e.message ? ': ' + e.message : '')); } catch (_) { /* ignore */ }
}
const db = (d) => Math.pow(10, d / 20);
function hashStr(s) { s = String(s); let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
function nowMs() { try { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); } catch (_) { return Date.now(); } }

// callback form wrapped in a Promise: older Safari has no promise-returning decodeAudioData
function decode(ctx, bytes) {
  return new Promise((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(bytes, resolve, (e) => reject(e || new Error('decode failed')));
      if (p && typeof p.catch === 'function') p.catch(() => {}); // avoid a duplicate unhandled rejection
    } catch (e) { reject(e); }
  });
}

export function createAmbient() {
  let ctx = null, gain = null, loadStarted = false;
  const loadHooks = [];   // async (ctx) => {}: run once in the unmuted load chain, after the sprite, before the bed
  let muted = readMuted(), ducked = false, started = false, suspendTimer = 0;
  const layers = [];
  // graph (built once in start)
  let atmosIn = null, shelf = null, lp = null, mLL = null, mRL = null, mLR = null, mRR = null, atmosGain = null,
    detailMod = null, fx = null, calmGain = null, nyq = 24000, graphNodes = 0;
  const strips = [];             // {g, p, src, t0, end, releasing}
  const active = [];             // live voice records shared with sfx.js: {t0, end, peak, stop, kind}
  let nodesCreated = 0;
  // sprite
  let sprite = null, spriteBuf = null, spriteState = 'none', spriteWarned = false;
  const lastVariant = Object.create(null);
  // interaction timing
  const hoverLast = new Map();
  let lastHoverT = -1e9, hoverVoice = null, hoverSkips = 0, lastSelectT = -1e9, budgetHits = 0;
  let lastHoverPc = null, sparkles = 0, sparkleDrops = 0, muteEnd = -1e9;
  // music clock: ctx time the bed reaches loopStart, its loop length and the intro played once before it;
  // bedT0 -1 = bed not playing (chord F)
  let bedT0 = -1, bedLoop = 0, bedIntro = 0;
  // atmosphere state
  const readingOn = { panel: false, map: false, film: false, booth: false, list: false };
  let readingCount = 0, place = 'planet';
  // motion state lives in a Float64Array: per-frame writes to typed-array slots allocate nothing (closure doubles
  // would be boxed as heap numbers on every assignment)
  const M = new Float64Array(5); M[3] = -1; M[4] = -1e9;   // 0 raw, 1 x (eased), 2 dir, 3 last ms, 4 last write (ctx s)
  let breathEnd = -1e9, placeUntil = -1e9;
  // last written targets (NaN = never written)
  let wAtmos = NaN, wShelf = NaN, wLp = NaN, wCalm = NaN, wWidth = NaN, wBal = NaN;

  const target = () => (muted ? 0 : LEVEL * (ducked ? DUCK : 1));
  const running = () => !!(ctx && atmosGain && ctx.state === 'running');

  function ramp(seconds) {
    if (!ctx || !gain) return;
    try {
      const now = ctx.currentTime, g = gain.gain;
      const cur = g.value;
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now); else g.cancelScheduledValues(now);
      g.setValueAtTime(cur, now);
      // linear-in-amplitude feels abrupt at the bottom; setTargetAtTime gives a soft exponential glide
      g.setTargetAtTime(target(), now, Math.max(0.01, seconds / 3));
    } catch (_) { /* ignore */ }
  }

  function scheduleSuspend() {
    clearTimeout(suspendTimer);
    if (!muted || !ctx) return;
    suspendTimer = setTimeout(() => {
      if (muted && ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
    }, (FADE_MUTE + 0.4) * 1000);
  }

  // ---------------------------------------------------------------- graph
  function buildGraph() {
    const c0 = ctx;
    nyq = (c0.sampleRate || 48000) / 2;
    atmosIn = c0.createGain();
    try { atmosIn.channelCount = 2; atmosIn.channelCountMode = 'explicit'; atmosIn.channelInterpretation = 'speakers'; } catch (_) { }
    shelf = c0.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = SHELF_HZ; shelf.gain.value = 0;
    lp = c0.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = nyq; lp.Q.value = LP_Q;
    const split = c0.createChannelSplitter(2), merge = c0.createChannelMerger(2);
    mLL = c0.createGain(); mRL = c0.createGain(); mLR = c0.createGain(); mRR = c0.createGain();
    mLL.gain.value = 1; mRL.gain.value = 0; mLR.gain.value = 0; mRR.gain.value = 1;
    atmosGain = c0.createGain(); atmosGain.gain.value = 1;
    detailMod = c0.createGain(); detailMod.gain.value = 1;
    fx = c0.createGain(); fx.gain.value = 1;
    atmosIn.connect(shelf); shelf.connect(lp); lp.connect(split);
    split.connect(mLL, 0); split.connect(mLR, 0); split.connect(mRL, 1); split.connect(mRR, 1);
    mLL.connect(merge, 0, 0); mRL.connect(merge, 0, 0); mLR.connect(merge, 0, 1); mRR.connect(merge, 0, 1);
    calmGain = c0.createGain(); calmGain.gain.value = 1;
    merge.connect(atmosGain); atmosGain.connect(calmGain); calmGain.connect(gain);
    detailMod.connect(atmosIn);   // single-layer bed: a fixed unity no-op, kept so a second layer could still plug in
    fx.connect(gain);
    graphNodes = 13;
    for (let i = 0; i < POOL; i++) {
      const g = c0.createGain(); g.gain.value = 0;
      let p = null;
      try { if (c0.createStereoPanner) { p = c0.createStereoPanner(); p.connect(fx); } } catch (_) { p = null; }
      g.connect(p || fx);
      strips.push({ g, p, src: null, t0: -1e9, end: -1e9, releasing: false });
      graphNodes += p ? 2 : 1;
    }
  }

  // ---------------------------------------------------------------- atmosphere
  // Two owners, no shared params: motion + breath write shelf / matrix / atmosGain with setTargetAtTime (continuous,
  // <= 15 Hz); reading + place write lp / calmGain with ramps whose endpoints are exact (rare events only), and the
  // matrix width for the moon (setTargetAtTime, PLACE_TAU).
  function holdAt(prm, now) {
    if (prm.cancelAndHoldAtTime) prm.cancelAndHoldAtTime(now);
    else { const v = prm.value; prm.cancelScheduledValues(now); prm.setValueAtTime(v, now); }
  }
  // K4: cancelAndHoldAtTime followed by a new ramp misfires in Chrome on a ramp that is still running (a quick map
  // open / close / open), and AudioParam.value is stale mid-ramp on some Safari / Firefox builds. So neither is trusted:
  // each ramped param keeps a shadow of its last ramp {t0, v0, t1, v1, exp}, the live value is computed from that
  // shadow, the timeline is wiped and that value is pinned at `now`, then the new ramp starts from it.
  const sh = (prm) => ({ prm, t0: 0, v0: NaN, t1: 0, v1: NaN, exp: false });
  function shadowNow(w, now) {
    if (!(w.v1 === w.v1)) return w.prm.value;                    // never ramped: the node's own value
    if (now >= w.t1) return w.v1;
    if (!(now > w.t0)) return w.v0;
    const k = (now - w.t0) / (w.t1 - w.t0);
    return w.exp && w.v0 > 0 && w.v1 > 0 ? w.v0 * Math.pow(w.v1 / w.v0, k) : w.v0 + (w.v1 - w.v0) * k;
  }
  function rampFrom(w, now, target, seconds) {
    const v = shadowNow(w, now), prm = w.prm;
    prm.cancelScheduledValues(now);
    prm.setValueAtTime(v, now);
    if (w.exp) prm.exponentialRampToValueAtTime(target, now + seconds); else prm.linearRampToValueAtTime(target, now + seconds);
    w.t0 = now; w.v0 = v; w.t1 = now + seconds; w.v1 = target;
  }
  // reading / place: one combined target, ramped over the duration of the transition that changed it
  let _shC = null, _shL = null;
  const shCalm = () => _shC || (_shC = sh(calmGain.gain)), shLp = () => (_shL || (_shL = Object.assign(sh(lp.frequency), { exp: true })));
  function applyCalm(seconds) {
    if (!running()) return;
    const now = ctx.currentTime, reading = readingCount > 0, moon = place === 'moon';
    const tCalm = db((reading ? READ_DB : 0) + (moon ? MOON_DB : 0));
    const tLp = Math.min(reading ? READ_LP : nyq, moon ? MOON_LP : nyq);
    try {
      if (!(seconds > 0)) {   // (re)start / resume: jump-free re-assert of the current target
        if (!(wCalm === tCalm)) rampFrom(shCalm(), now, tCalm, 0.3);
        if (!(wLp === tLp)) rampFrom(shLp(), now, tLp, 0.3);
      } else {
        if (!(wCalm === tCalm)) rampFrom(shCalm(), now, tCalm, seconds);
        if (!(wLp === tLp)) rampFrom(shLp(), now, tLp, seconds);
      }
      wCalm = tCalm; wLp = tLp;
    } catch (_) { /* never throw */ }
  }

  function applyAtmos(force) {
    if (!running()) return;
    const now = ctx.currentTime, x = M[1], moon = place === 'moon';
    const inBreath = now < breathEnd;
    const tAtmos = db(x * MOT_ATMOS_DB + (inBreath ? BREATH_DB : 0));
    const tShelf = x * MOT_SHELF_DB;
    const tWidth = (moon ? MOON_WIDTH : 1) + x * MOT_WIDTH;
    const tBal = MOT_BAL * x * M[2];
    const tauP = now < placeUntil ? PLACE_TAU : MOT_TAU;
    try {
      if (force || Math.abs(tAtmos - wAtmos) > 0.004 || !(wAtmos === wAtmos) || (tAtmos === 1 && wAtmos !== 1)) {   // rest is always written exactly
        const tau = inBreath ? BREATH_TAU_IN : (now < breathEnd + 3 * BREATH_TAU_OUT ? BREATH_TAU_OUT : MOT_TAU);
        atmosGain.gain.setTargetAtTime(tAtmos, now, tau);
        if (inBreath) atmosGain.gain.setTargetAtTime(tAtmos * db(-BREATH_DB), breathEnd, BREATH_TAU_OUT); // the return
        wAtmos = tAtmos;
      }
      if (force || Math.abs(tShelf - wShelf) > 0.05 || !(wShelf === wShelf) || (tShelf === 0 && wShelf !== 0)) { shelf.gain.setTargetAtTime(tShelf, now, MOT_TAU); wShelf = tShelf; }
      if (force || Math.abs(tWidth - wWidth) > 0.004 || Math.abs(tBal - wBal) > 0.003 || !(wWidth === wWidth) || (x === 0 && (tWidth !== wWidth || tBal !== wBal))) {
        // M/S width w and balance b folded into the 2x2 matrix; balance only attenuates (never boosts)
        const a = (1 + tWidth) / 2, s = (1 - tWidth) / 2, bl = tBal > 0 ? 1 - tBal : 1, br = tBal < 0 ? 1 + tBal : 1;
        mLL.gain.setTargetAtTime(a * bl, now, tauP); mRL.gain.setTargetAtTime(s * bl, now, tauP);
        mLR.gain.setTargetAtTime(s * br, now, tauP); mRR.gain.setTargetAtTime(a * br, now, tauP);
        wWidth = tWidth; wBal = tBal;
      }
    } catch (_) { /* never throw from a frame loop */ }
  }

  function reading(key, on) {
    if (READ_KEYS.indexOf(key) < 0) return;
    on = !!on;
    if (readingOn[key] === on) return;
    const before = readingCount > 0;
    readingOn[key] = on; readingCount += on ? 1 : -1;
    const after = readingCount > 0;
    if (before === after) return;
    applyCalm(after ? READ_IN : READ_OUT);
  }

  function motion(v, dir) {
    const t = nowMs();
    const dt = M[3] < 0 ? 0 : Math.min(0.25, (t - M[3]) / 1000);
    M[3] = t;
    let raw = +v / MOT_FULL; if (!(raw > 0)) raw = 0; else if (raw > 1) raw = 1;
    if (dt > 0) {
      const r0 = M[0], tau = raw > r0 ? MOT_ATK : MOT_REL;
      let r1 = r0 + (raw - r0) * (1 - Math.exp(-dt / tau));
      if (r1 < 1e-3 && raw === 0) r1 = 0;
      M[0] = r1;
    }
    const r = M[0];
    M[1] = r * r * (3 - 2 * r);   // smoothstep ease
    if (dir > 0) M[2] = 1; else if (dir < 0) M[2] = -1;
    if (!running()) return;
    const now = ctx.currentTime;
    if (now - M[4] < MOT_DT) return;
    M[4] = now;
    applyAtmos(false);
  }

  function setPlace(body) {
    const b = body === 'moon' ? 'moon' : 'planet';
    if (b === place) return;
    place = b;
    if (ctx) placeUntil = ctx.currentTime + 3 * PLACE_TAU;
    applyAtmos(true);
    applyCalm(PLACE_S);
  }

  function breath() {
    if (!running()) return;
    breathEnd = ctx.currentTime + BREATH_HOLD;
    applyAtmos(true);
  }

  // ---------------------------------------------------------------- voices (shared with sfx.js)
  function pruneVoices(now) {
    for (let i = active.length - 1; i >= 0; i--) if (active[i].end <= now) active.splice(i, 1);
  }
  function activePeak(now) {
    let s = 0;
    // fresh voices count fully; tails and voices already stopped (fading, tau 27 ms) count TAIL_WEIGHT
    for (let i = 0; i < active.length; i++) { const v = active[i]; s += (now - v.t0 < FRESH_S && !v.fading) ? v.peak : v.peak * TAIL_WEIGHT; }
    return s;
  }
  function budget(now, want) {
    pruneVoices(now);
    // a sparkle never costs a piano / foley voice its level: if the budget is short, the sparkles go first
    if (budgetGain(activePeak(now), want) < 1) {
      // stopped sparkles still count TAIL_WEIGHT (same rule as every stopped voice) while they fade (tau 27 ms)
      for (let i = 0; i < active.length; i++) { const v = active[i]; if (v.kind === 'sparkle' && !v.fading) { try { v.stop && v.stop(); } catch (_) { } sparkleDrops++; } }
    }
    const k = budgetGain(activePeak(now), want);
    if (k < 1) budgetHits++;
    return k;
  }
  // register a voice; steals the oldest when MAX_VOICES are live. rec: {t0, end, peak, stop()}
  function claimVoice(rec) {
    const now = ctx ? ctx.currentTime : 0;
    pruneVoices(now);
    while (active.length >= MAX_VOICES) {
      const v = active.shift();
      try { v.stop && v.stop(); } catch (_) { }
    }
    active.push(rec);
    return true;
  }

  function fadeStrip(st, now) {
    if (!st || !st.src) return;
    try {
      const g = st.g.gain;
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now); else { g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); }
      g.setTargetAtTime(0, now, HOVER_FADE_TAU);
      st.src.stop(now + 0.12);
    } catch (_) { }
    st.releasing = true;
    st.end = Math.min(st.end, now + 0.13);
  }

  function freeStrip(now) {
    let best = null;
    for (let i = 0; i < strips.length; i++) { const s = strips[i]; if (s.end <= now) return s; if (!best || s.t0 < best.t0) best = s; }
    if (best) { try { best.src && best.src.stop(); } catch (_) { } best.end = now; }   // all 12 busy: hard reuse (not expected)
    return best;
  }

  function canPlay() {
    return !!(started && !muted && running() && spriteState === 'ready' && spriteBuf && sprite);
  }

  // start one sprite slice. key: slice key; dB: target peak; id: pan seed (or null); delay: s from now;
  // kind 'sparkle': not budgeted here (the caller checked the room and drops it rather than turning it down)
  function playSlice(key, dB, id, delay, kind) {
    const list = sprite.slices && sprite.slices[key];
    if (!Array.isArray(list) || !list.length) { warnOnce('slice "' + key + '" missing'); return null; }
    let vi = (Math.random() * list.length) | 0;
    if (list.length > 1 && vi === lastVariant[key]) vi = (vi + 1 + ((Math.random() * (list.length - 1)) | 0)) % list.length;
    lastVariant[key] = vi;
    const sl = list[vi];
    if (!sl || !(sl.peak > 0) || !(sl.dur > 0) || !(sl.start >= 0)) { warnOnce('slice "' + key + '" invalid'); return null; }
    const now = ctx.currentTime, when = now + (delay > 0 ? delay : 0);
    const rate = 1 + (Math.random() * 2 - 1) * 0.004;
    const dBj = dB + (Math.random() * 2 - 1) * 1.5;
    const base = id == null ? 0 : ((hashStr(id) % 1000) / 999 * 2 - 1) * 0.25;
    const pan = Math.max(-1, Math.min(1, base + (Math.random() * 2 - 1) * 0.08));
    const xp = (pan + 1) / 2, panPeak = Math.max(Math.cos(xp * Math.PI / 2), Math.sin(xp * Math.PI / 2));
    // budget the nominal level (the +-1.5 dB humanising jitter never decides whether a sound is turned down)
    const k = kind === 'sparkle' ? 1 : budget(now, db(dB));
    if (k === 0) return null;
    let peakAtMaster = db(dBj) * k;
    const st = freeStrip(now);
    if (!st) return null;
    const lin = peakAtMaster / sl.peak / ((st.p ? panPeak : 1) || 1);
    const src = ctx.createBufferSource(); nodesCreated++;
    src.buffer = spriteBuf;
    src.playbackRate.value = rate;
    const dur = sl.dur / rate;
    try {
      const g = st.g.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(lin, now);            // the strip was silent and the slice starts at its own soft attack
      if (st.p) st.p.pan.setValueAtTime(pan, now);
    } catch (_) { }
    src.connect(st.g);
    src.start(when, sl.start, sl.dur);
    st.src = src; st.t0 = when; st.end = when + dur + 0.05; st.releasing = false;
    const rec = { t0: when, end: st.end, peak: peakAtMaster, stop: null, strip: st, kind: kind || key };
    rec.stop = () => {
      const t = ctx.currentTime;
      rec.fading = true; fadeStrip(st, t);
      // not started yet (a delayed sparkle dropped by the budget): cancel it outright, it never sounds and costs nothing
      if (rec.t0 > t + 1e-4) { try { src.stop(t); } catch (_) { } rec.end = t; st.end = t; }
      else rec.end = Math.min(rec.end, t + 0.13);
    };
    src.onended = () => {
      try { src.disconnect(); } catch (_) { }
      if (st.src === src) { st.src = null; st.end = -1e9; }
      const i = active.indexOf(rec); if (i >= 0) active.splice(i, 1);
    };
    claimVoice(rec);
    return rec;
  }

  function warnOnce(msg, e) { if (spriteWarned) return; spriteWarned = true; warn('interaction sounds: ' + msg + ' (playing nothing)', e); }

  // ---------------------------------------------------------------- harmony (v2 sprite, PALETTE s6)
  function music() { return sprite && sprite.music && typeof sprite.music === 'object' ? sprite.music : null; }
  function loopLen() {
    if (bedLoop > 0) return bedLoop;
    const m = music(); return m && m.loopSeconds > 0 ? +m.loopSeconds : 0;
  }
  // position of the bed in seconds (0 = loopStart; negative while the first pass plays the intro before loopStart),
  // or null when the bed is not playing
  function loopPos(now) {
    const L = loopLen();
    if (!(bedT0 >= 0) || !(L > 0)) return null;
    const p = now - bedT0;
    if (p < 0 && p >= -bedIntro) return p;
    const q = p % L; return q < 0 ? q + L : q;
  }
  // chord key: explicit .key, a root already written as a key ('Gm', S's format), a plain root ('G' -> 'Gm'), else F
  function chordKeyOf(c) {
    if (!c) return 'F';
    if (CHORD_KEYS.indexOf(c.key) >= 0) return c.key;
    if (CHORD_KEYS.indexOf(c.root) >= 0) return c.root;
    return ROOT_KEY[c.root] || 'F';
  }
  function chordAt(now) {
    const m = music(), pos = loopPos(now);
    const list = m && Array.isArray(m.chords) ? m.chords : null;
    if (pos === null || !list || !list.length) return DEFAULT_CHORD;
    let c = null;
    for (let i = 0; i < list.length; i++) { const e = list[i]; if (e && e.t <= pos) c = e; else if (e && e.t > pos) break; }
    if (!c) c = list[list.length - 1];   // before the first entry: wrap to the last
    if (!c || !Array.isArray(c.pcs) || !c.pcs.length) return DEFAULT_CHORD;
    return c;
  }
  // slice key for "<family>.<pc>", falling back to the nearest available pc (v1 sprite: D E Fs A B Cs Gs)
  function pcSlice(family, pc) {
    const sl = sprite.slices || {};
    if (Array.isArray(sl[family + '.' + pc]) && sl[family + '.' + pc].length) return family + '.' + pc;
    const want = SEMI[pc]; if (want == null) return null;
    let best = null, bd = 99;
    for (const k in sl) {
      if (k.indexOf(family + '.') !== 0 || !Array.isArray(sl[k]) || !sl[k].length) continue;
      const s2 = SEMI[k.slice(family.length + 1)]; if (s2 == null) continue;
      const d0 = Math.abs(s2 - want), d = Math.min(d0, 12 - d0) + (PCS.indexOf(k.slice(family.length + 1)) >= 0 ? 0 : 0.5);   // ties -> in F major
      if (d < bd || (d === bd && k < best)) { bd = d; best = k; }
    }
    return best;
  }
  // pc for hover / select: chord ∩ F pentatonic (else the chord's own pcs), stable per id, optionally avoiding one pc
  function pickPc(id, chord, avoid) {
    const pcs = chord.pcs.filter((p) => PCS.indexOf(p) >= 0);
    let cand = PENTA.filter((p) => pcs.indexOf(p) >= 0);
    if (!cand.length) cand = pcs.length ? pcs : ['F'];
    let i = hashStr(id) % cand.length;
    if (avoid && cand[i] === avoid && cand.length > 1) i = (i + 1) % cand.length;
    return cand[i];
  }
  // family slice for the current chord: "<family>.<chordKey>", else the v1 plain "<family>" slice, else null
  function chordSlice(family, ck) {
    const sl = sprite.slices || {};
    if (Array.isArray(sl[family + '.' + ck]) && sl[family + '.' + ck].length) return family + '.' + ck;
    if (Array.isArray(sl[family]) && sl[family].length) return family;
    return null;
  }
  // delay to the next 8th-note grid point if it is <= SNAP_MAX away, else 0 (play now)
  function snapDelay(now) {
    const m = music(), pos = loopPos(now);
    if (!m || pos === null || !(m.bpm > 0)) return 0;
    const e = 60 / m.bpm / 2, ph = +m.beatPhase || 0;
    let w = (ph - pos) % e; if (w < 0) w += e;
    if (w < 1e-4 || w > e - 1e-4) return 0;   // on the grid
    return w <= SNAP_MAX ? w : 0;
  }
  // The sparkle must fit next to its piano layer at NOMINAL level (the +-1.5 dB humanising jitter never decides, same rule
  // as budget()): fresh nominal peaks stay within PEAK_BUDGET, else the sparkle is dropped, never turned down. Worst real
  // sum with jitter: 0.237 + 0.071 = 0.308 (-10.2 dBFS on the bus).
  function sparkle(ck, delay, extraDb, main, nominal) {
    if (!SPARKLE) return;
    const key = chordSlice('sparkle', ck);
    if (!key || key === 'sparkle') return;
    const now = ctx.currentTime, dB = LEVEL_DB.sparkle + (extraDb || 0);
    pruneVoices(now);
    const used = activePeak(now) - (main && active.indexOf(main) >= 0 ? main.peak : 0) + db(nominal);   // nominal, like every other voice
    if (used + db(dB + 1.5) > PEAK_BUDGET) { sparkleDrops++; return; }   // its own +1.5 dB jitter counted; never turned down: dropped
    const d = delay + SPARKLE_DMIN + Math.random() * (SPARKLE_DMAX - SPARKLE_DMIN);
    if (playSlice(key, dB, null, d, 'sparkle')) sparkles++;
  }

  function hover(id) {
    try {
      if (!canPlay()) return false;
      const now = ctx.currentTime;
      if (hoverVoice && hoverVoice.end > now && now - hoverVoice.t0 < HOVER_STEAL_MIN) { hoverSkips++; return false; }
      if (now - lastHoverT < HOVER_GAP) { hoverSkips++; return false; }
      if (now - lastSelectT < HOVER_AFTER_SELECT) { hoverSkips++; return false; }
      const key = String(id);
      const last = hoverLast.get(key);
      if (last != null && now - last < HOVER_COOLDOWN) { hoverSkips++; return false; }
      const pc = pickPc(key, chordAt(now), lastHoverPc);
      const sk = pcSlice('hover', pc);
      if (!sk) { warnOnce('no hover slice'); return false; }
      if (hoverVoice && hoverVoice.end > now) { hoverVoice.stop(); }
      const rec = playSlice(sk, LEVEL_DB.hover, key);
      if (!rec) return false;
      hoverVoice = rec; lastHoverT = now; hoverLast.set(key, now); lastHoverPc = pc;
      return true;
    } catch (_) { return false; }
  }

  function select(id, opts) {
    try {
      if (!canPlay()) return false;
      const now = ctx.currentTime;
      if (now - lastSelectT < SELECT_GAP) return false;
      const disc = !!(opts && opts.discover);
      if (hoverVoice && hoverVoice.end > now) { hoverVoice.stop(); hoverVoice = null; }
      const chord = chordAt(now);
      let key, delay = 0, ck = null;
      if (disc) { ck = chordKeyOf(chord); key = chordSlice('discover', ck); delay = snapDelay(now); }
      else key = pcSlice('select', pickPc(String(id), chord, null));
      if (!key) { warnOnce('no ' + (disc ? 'discover' : 'select') + ' slice'); return false; }
      const rec = playSlice(key, disc ? LEVEL_DB.discover : LEVEL_DB.select, id == null ? null : String(id), delay);
      if (!rec) return false;
      lastSelectT = now;
      if (disc) sparkle(ck, delay, 0, rec, LEVEL_DB.discover);
      return true;
    } catch (_) { return false; }
  }

  function oneshot(name, opts) {
    try {
      if (!canPlay()) return false;
      if (!Object.prototype.hasOwnProperty.call(LEVEL_DB, name) || name === 'hover' || name === 'select' || name === 'discover' || name === 'sparkle') return false;
      const id = opts && opts.id != null ? String(opts.id) : null;
      if (name !== 'star' && name !== 'star_done') return !!playSlice(name, LEVEL_DB[name], id);
      const now = ctx.currentTime, ck = chordKeyOf(chordAt(now)), key = chordSlice(name, ck);
      if (!key) { warnOnce('no ' + name + ' slice'); return false; }
      const delay = snapDelay(now);
      const rec = playSlice(key, LEVEL_DB[name], id, delay);
      if (!rec) return false;
      sparkle(ck, delay, name === 'star' ? SPARKLE_STAR_DB : 0, rec, LEVEL_DB[name]);
      return true;
    } catch (_) { return false; }
  }

  // mute: every sounding one-shot (sprite strips and sfx.js foley) fades with the master and is stopped at the end
  // of the mute fade, so no tail is left frozen in a suspended context to resume on unmute.
  function silenceVoices() {
    if (!ctx || !fx) return;
    try {
      const now = ctx.currentTime, tEnd = now + FADE_MUTE;
      for (let i = 0; i < strips.length; i++) {
        const st = strips[i]; if (!st.src || st.end <= now) continue;
        try { holdAt(st.g.gain, now); st.g.gain.setTargetAtTime(0, now, FADE_MUTE / 5); st.src.stop(tEnd); } catch (_) { }
        st.releasing = true; st.end = Math.min(st.end, tEnd + 0.01);
      }
      for (let i = 0; i < active.length; i++) {
        const v = active[i]; v.fading = true;
        if (!v.strip) { try { if (v.src && v.src.stop) v.src.stop(tEnd); else if (v.stop) v.stop(); } catch (_) { } }
        v.end = Math.min(v.end, tEnd + 0.01);
      }
      // foley gains are sfx.js's: the shared bus fades them, and is back at unity once they are stopped
      holdAt(fx.gain, now); fx.gain.setTargetAtTime(0, now, FADE_MUTE / 5); fx.gain.setValueAtTime(1, tEnd + 0.02);
      hoverVoice = null; muteEnd = tEnd + 0.02;
    } catch (_) { }
  }
  // unmute inside the mute fade: the old voices end now (short fade), the bus returns at once for new sounds
  function unsilence() {
    if (!ctx || !fx) return;
    const now = ctx.currentTime;
    if (!(now < muteEnd)) return;
    try {
      const t1 = now + 0.04;
      for (let i = 0; i < strips.length; i++) { const st = strips[i]; if (st.src && st.releasing) { try { st.src.stop(t1); } catch (_) { } st.end = Math.min(st.end, t1); } }
      for (let i = 0; i < active.length; i++) { const v = active[i]; if (!v.strip && v.src && v.src.stop) { try { v.src.stop(t1); } catch (_) { } } v.end = Math.min(v.end, t1); }
      holdAt(fx.gain, now); fx.gain.setTargetAtTime(0, now, 0.01); fx.gain.setValueAtTime(1, t1 + 0.005);
      muteEnd = -1e9;
    } catch (_) { }
  }

  // ---------------------------------------------------------------- loading
  async function loadSprite() {
    spriteState = 'loading';
    try {
      const res = await fetch(SPRITE_URL);
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for interactions.json');
      const man = await res.json();
      if (!man || typeof man.slices !== 'object' || !man.file) throw new Error('bad sprite manifest');
      const r2 = await fetch(new URL(man.file, SPRITE_URL));
      if (!r2.ok) throw new Error('HTTP ' + r2.status + ' for ' + man.file);
      const b = await decode(ctx, await r2.arrayBuffer());
      sprite = man; spriteBuf = b; spriteState = 'ready';
    } catch (e) { spriteState = 'failed'; warnOnce('sprite unavailable', e); }
  }

  // decode -> looping source on its own gain. Throws on failure (caught by loadAll).
  async function playLayer(entry, info, index) {
    const res = await fetch(new URL(info.file, MANIFEST_URL));
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + info.file);
    const buf = await decode(ctx, await res.arrayBuffer());
    const lg = ctx.createGain(); nodesCreated++;
    const full = typeof info.gain === 'number' ? info.gain : 1;
    // First layer rides the master fade-in. If the master already finished rising (slow load), or for
    // any later layer, fade on the layer gain so nothing pops in.
    const masterUp = gain.gain.value > 0.3 * LEVEL * (ducked ? DUCK : 1) && !muted;
    const fade = index > 0 || masterUp;
    lg.gain.value = fade ? 0 : full;
    lg.connect(atmosIn);   // single-layer bed; detailMod is a unity no-op
    const src = ctx.createBufferSource(); nodesCreated++;
    src.buffer = buf;
    src.loop = true;
    src.loopStart = info.loopStart;
    src.loopEnd = info.loopEnd;
    src.connect(lg);
    // the first pass starts at startAt and plays the intro once; after that only [loopStart, loopEnd) repeats
    const at = (typeof info.startAt === 'number' && info.startAt >= 0 && info.startAt < info.loopStart) ? info.startAt : info.loopStart;
    src.start(0, at);
    if (entry.id === 'bed' || bedT0 < 0) {   // music clock for chord-aware one-shots (loop position 0 = loopStart)
      bedIntro = info.loopStart - at;
      bedT0 = ctx.currentTime + bedIntro;
      const L = (+info.loopEnd) - (+info.loopStart);
      bedLoop = L > 0 ? L : 0;
    }
    if (fade) lg.gain.setTargetAtTime(full, ctx.currentTime, FADE_IN / 3);
    entry.duration = buf.duration;
    entry.sampleRate = buf.sampleRate;
    entry.state = 'playing';
  }

  async function loadAll() {
    let man;
    try {
      const res = await fetch(MANIFEST_URL);
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for ambient.json');
      man = await res.json();
      if (!man || !Array.isArray(man.layers)) throw new Error('bad manifest');
    } catch (e) { warn('ambient manifest unavailable, bed stays silent', e); return; }
    const entries = man.layers.map((l) => ({
      id: String(l && l.id), state: 'loading',
      loopStart: l && l.loopStart, loopEnd: l && l.loopEnd, duration: null, sampleRate: null,
    }));
    layers.push(...entries);
    for (let i = 0; i < entries.length; i++) {   // sequential on purpose (peak memory)
      try { await playLayer(entries[i], man.layers[i], i); }
      catch (e) { entries[i].state = 'failed'; warn('layer "' + entries[i].id + '" failed, staying silent', e); }
    }
  }

  function maybeLoad() {
    if (loadStarted || muted || !ctx) return;    // muted: defer until first unmute (see header)
    loadStarted = true;
    (async () => {
      try { await loadSprite(); } catch (_) { }  // small, first; failure never blocks the bed
      for (const fn of loadHooks) { try { await fn(ctx); } catch (_) { } }   // sfx.js foley sprite (44 KB)
      await loadAll();
    })().catch((e) => warn('ambient loader', e));
  }

  // ---------------------------------------------------------------- unlock
  // Only some events carry user activation: keydown (not Esc), mousedown, pointerdown from a MOUSE, pointerup /
  // touchend from touch, click. A touch pointerdown does not, and a gesture that comes before the context can resume
  // would be lost, so every activation-type event calls start() until the context is actually running (or the visitor chose mute); if the context later
  // stops (iOS 'interrupted', a background tab suspended by the browser), returning to the tab tries a resume and
  // re-arms the gesture listeners.
  const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'keydown', 'click', 'touchend'];
  let unlockTarget = null, unlockArmed = false, pageHooks = false;
  function onUnlockGesture(e) {
    if (e && e.type === 'keydown' && e.key === 'Escape') return;   // Esc carries no activation
    start();
    if (started && (muted || (ctx && ctx.state === 'running'))) disarmUnlock();
  }
  function disarmUnlock() {
    if (!unlockArmed || !unlockTarget) return;
    for (const ev of UNLOCK_EVENTS) unlockTarget.removeEventListener(ev, onUnlockGesture, true);
    unlockArmed = false;
  }
  function armUnlock(target) {
    if (target) unlockTarget = target;
    if (!unlockTarget && typeof window !== 'undefined') unlockTarget = window;
    if (!unlockTarget || !unlockTarget.addEventListener) return;
    if (!unlockArmed) {
      for (const ev of UNLOCK_EVENTS) unlockTarget.addEventListener(ev, onUnlockGesture, true);
      unlockArmed = true;
    }
    if (!pageHooks && typeof document !== 'undefined' && document.addEventListener) {
      pageHooks = true;
      const back = () => { if (document.visibilityState === 'visible') resumeIfNeeded(); };
      document.addEventListener('visibilitychange', back);
      if (typeof window !== 'undefined') window.addEventListener('pageshow', back);
    }
  }
  function resumeIfNeeded() {
    if (!ctx || !started || muted || ctx.state === 'running' || ctx.state === 'closed') return;
    try {
      ctx.resume().then(() => { applyAtmos(true); applyCalm(0); ramp(FADE_MUTE); }).catch(() => {});
    } catch (_) { }
    armUnlock();   // if the resume needs a gesture, the next one does it
  }

  function start() {
    try {
      if (!ctx) {
        const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
        if (!AC) return;
        ctx = new AC({ latencyHint: 'playback' });
        gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(ctx.destination);
        try { buildGraph(); } catch (e) { warn('atmosphere graph', e); }
        nodesCreated = 0;
        try {   // stopped later by the browser (not by our mute): wait for the next gesture
          ctx.addEventListener('statechange', () => {
            if (ctx.state === 'running') { applyAtmos(true); applyCalm(0); if (unlockArmed && !muted) disarmUnlock(); }
            else if (ctx.state !== 'closed' && started && !muted) armUnlock();
          });
        } catch (_) { }
      }
      // resume synchronously inside the gesture (iOS unlock), even if muted
      if (ctx.state !== 'running') ctx.resume().then(() => { applyAtmos(true); applyCalm(0); }).catch(() => {});
      started = true;
      ramp(FADE_IN);
      maybeLoad();
      scheduleSuspend();
    } catch (_) { /* never throw into the caller's gesture handler */ }
  }

  function setMuted(m) {
    m = !!m;
    muted = m;
    writeMuted(m);
    if (!ctx) return;
    try {
      clearTimeout(suspendTimer);
      if (m) silenceVoices(); else unsilence();
      if (!m && ctx.state !== 'running') ctx.resume().then(() => { applyAtmos(true); applyCalm(0); }).catch(() => {});
      ramp(FADE_MUTE);
      maybeLoad();
      scheduleSuspend();
    } catch (_) { /* ignore */ }
  }

  return {
    start,
    setMuted,
    armUnlock,
    get running() { return !!(ctx && ctx.state === 'running'); },
    get unlockArmed() { return unlockArmed; },
    get level() { return gain ? gain.gain.value : 0; },
    get muted() { return muted; },
    get started() { return started; },
    get ctx() { return ctx; },
    get out() { return gain; },
    get fx() { return fx; },
    get layers() { return layers.map((l) => ({ ...l })); },
    toggle() { setMuted(!muted); return muted; },
    duck(b) { ducked = !!b; ramp(FADE_DUCK); },
    hover,
    select,
    oneshot,
    reading,
    motion,
    place: setPlace,
    breath,
    get stats() {
      const now = ctx ? ctx.currentTime : 0;
      if (ctx) pruneVoices(now);
      return {
        voices: active.length, nodesCreated, reading: readingCount > 0,
        readingKeys: READ_KEYS.filter((k) => readingOn[k]), motion: M[1], place, hoverSkips, budgetHits, spriteState,
        chord: (sprite && ctx) ? chordKeyOf(chordAt(now)) : 'F', sparkles, sparkleDrops,
      };
    },
    // private, for sfx.js (documented in the header)
    _claimVoice: (rec) => claimVoice(rec),
    _budget: (now, want) => budget(now, want),
    get _spriteReady() { return spriteState === 'ready'; },
    _noteNodes(n) { nodesCreated += n | 0; },
    _onLoad(fn) { if (typeof fn !== 'function') return; if (loadStarted && ctx) { Promise.resolve().then(() => fn(ctx)).catch(() => {}); } else loadHooks.push(fn); },
    get _graphNodes() { return graphNodes; },
  };
}
