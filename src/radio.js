// radio.js: R7 D3, the radio "world voice" that greets a visitor once per session, right after the intro.
//
// It is stylised babble, not speech and not TTS: radio.m4a holds three pre-rendered broadcasts (recorded cello chopped into
// syllables, formant-coloured, then band-limited with crackle, hiss, a tune-in swirl and a squelch;
// audio-src/creatures/make-creatures.py). The words live here, as a caption in the house voice.
//
// Routing: source -> highpass 280 -> lowpass 3400 -> its own gain node (radioGain) -> amb.fx (the one-shot bus; amb.out if absent)
// -> master. While it plays the music steps back through the existing amb.duck(true) (-9 dB), released a beat after it ends.
// It waits for the intro to close and for the audio context to be running (never before the first gesture unlocks audio),
// shares the voice cap and peak budget with the other effects, and plays at most once per tab session.
//
//   installRadio({ amb })  -> { play(variant), state, log, captions }   (also on window.__radio for the test harness)
//   Muted: nothing is played or ducked, but the caption still shows (it is the greeting in text).

export const RADIO_CAPTIONS = [
  "<b>Radio</b> · …kzzt… Good evening, visitor. This is the Planet Broadcast. Today’s weather: round.",
  "<b>Radio</b> · …kshh… Attention, visitor. Ten projects, one moon, zero refunds. Please walk responsibly.",
  "<b>Radio</b> · …krrk… Welcome in. The butterflies are hiding. Allegedly. We’ll be right back, probably.",
];
const SEEN_KEY = "archipelago.radio.v1";    // sessionStorage: once per tab session (a reload does not replay it)
const RADIO_URL = new URL("../assets/audio/radio.json", import.meta.url);
const RADIO_GAIN = 0.35;                    // linear, the same bus level as the sfx bus (BUS_GAIN); the sprite sits at about -24 LUFS
const AFTER_INTRO_S = 1.7;                  // let the intro camera swoop land first
const WAIT_AUDIO_S = 10;                    // give up (stay silent, no caption) if audio never starts

export function installRadio({ amb } = {}) {
  const log = [];
  const note = (e) => { log.push(e); if (log.length > 40) log.shift(); try { console.debug("[radio]", JSON.stringify(e)); } catch (_) { } };
  let state = "idle", man = null, buf = null, loadState = "none", bus = null, busCtx = null, played = false, ducking = false;

  async function load(ctx) {
    if (loadState !== "none" || !ctx || typeof fetch !== "function") return;
    loadState = "loading";
    try {
      const r = await fetch(RADIO_URL); if (!r.ok) throw new Error("HTTP " + r.status);
      const m = await r.json(); if (!m || !m.variants || !m.file) throw new Error("bad radio manifest");
      const r2 = await fetch(new URL(m.file, RADIO_URL)); if (!r2.ok) throw new Error("HTTP " + r2.status);
      const bytes = await r2.arrayBuffer();
      buf = await new Promise((res, rej) => { try { const p = ctx.decodeAudioData(bytes, res, rej); if (p && p.then) p.then(res, rej); } catch (e) { rej(e); } });
      man = m; loadState = "ready";
    } catch (_) { loadState = "failed"; }
  }
  if (amb && typeof amb._onLoad === "function") amb._onLoad(load);

  // the caption: the house toast look (reuses the .toast class), its own element so it never fights the toast queue
  let cap = null;
  function showCaption(html, ms) {
    if (!document.getElementById("r7-radio-style")) {
      const st = document.createElement("style"); st.id = "r7-radio-style";
      st.textContent = ".toast.r7-radio-cap{top:calc(var(--gut,16px) + 64px + 74px);z-index:13}@media (max-width:760px){.toast.r7-radio-cap{top:calc(var(--hud-t,16px) + 64px + 74px)}}";
      document.head.appendChild(st);
    }
    if (!cap) {
      cap = document.createElement("div"); cap.className = "toast r7-radio-cap"; cap.setAttribute("role", "status"); cap.setAttribute("aria-live", "polite");
      document.body.appendChild(cap);
    }
    cap.innerHTML = html; requestAnimationFrame(() => cap.classList.add("show"));
    clearTimeout(showCaption._t); showCaption._t = setTimeout(() => cap.classList.remove("show"), ms);
  }

  function ensureBus(ctx) {
    if (bus && busCtx === ctx) return bus;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 280; hp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3400; lp.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.value = RADIO_GAIN;      // radioGain: the radio's own level, independent of the sfx bus
    hp.connect(lp); lp.connect(g); g.connect(amb.fx || amb.out);
    bus = { input: hp, gain: g }; busCtx = ctx;
    return bus;
  }

  let cur = null;
  // a creature poke cuts the broadcast (short fade): the visitor's own action is never talked over, and it frees the peak budget
  function stop() {
    if (!cur || state !== "playing") return false; const c = cur; cur = null;
    try { const t = c.ctx.currentTime; c.g.gain.cancelScheduledValues(t); c.g.gain.setValueAtTime(c.g.gain.value, t); c.g.gain.linearRampToValueAtTime(0, t + 0.15); c.src.stop(t + 0.18); } catch (_) { }
    note({ stopped: "creature poke", ok: true }); return true;
  }
  function play(variant) {
    const ctx = amb && amb.ctx, v = variant == null ? (Math.random() * RADIO_CAPTIONS.length) | 0 : variant | 0;
    const html = RADIO_CAPTIONS[v % RADIO_CAPTIONS.length];
    const ready = ctx && amb.out && !amb.muted && ctx.state === "running" && loadState === "ready" && man.variants[v];
    if (!ready) {
      const why = !ctx ? "no context" : amb.muted ? "muted" : ctx.state !== "running" ? "ctx " + ctx.state : "sprite " + loadState;
      note({ variant: v, ok: false, why });
      if (amb && amb.muted) showCaption(html, 5200);       // muted: the greeting still arrives, as text
      return false;
    }
    const sl = man.variants[v], now = ctx.currentTime, b = ensureBus(ctx);
    const want = (+man.peak || 0.35) * RADIO_GAIN;
    const sh = typeof amb._claimVoice === "function" && typeof amb._budget === "function";
    const k = sh ? amb._budget(now, want) : 1;
    if (k === 0) { note({ variant: v, ok: false, why: "budget" }); showCaption(html, 5200); return false; }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = k;
    src.connect(g); g.connect(b.input);
    if (typeof amb._noteNodes === "function") amb._noteNodes(4);
    const off = (+man.decoderOffsetSamples || 0) / (+man.sampleRate || 48000);
    src.start(now, +sl.start + off, +sl.dur);
    const rec = { src, t0: now, end: now + sl.dur + 0.05, peak: want * k, kind: "radio", stop() { try { src.stop(); } catch (_) { } rec.end = 0; } };
    if (sh) amb._claimVoice(rec);
    // the music steps back (existing -9 dB duck) for the broadcast, then comes back a beat after the squelch
    if (typeof amb.duck === "function") { amb.duck(true); ducking = true; }
    const done = () => { try { g.disconnect(); } catch (_) { } rec.end = 0; setTimeout(() => { if (ducking) { ducking = false; try { amb.duck(false); } catch (_) { } } }, 350); state = "done"; };
    src.onended = done;
    cur = { src, g, done, ctx };
    showCaption(html, sl.dur * 1000 + 1400);
    state = "playing";
    note({ t: +now.toFixed(3), variant: v, ok: true, dur: +sl.dur.toFixed(2), radioGain: RADIO_GAIN, budgetK: +k.toFixed(2), duck: true, chain: "src>hp280>lp3400>radioGain>" + (amb.fx ? "amb.fx" : "amb.out") });
    return true;
  }

  // arm: once the intro is closed, wait a beat, then wait (bounded) for audio to be running and the sprite decoded
  function greet() {
    if (played) return; played = true;
    try { if (sessionStorage.getItem(SEEN_KEY) === "1") { state = "seen"; return; } sessionStorage.setItem(SEEN_KEY, "1"); } catch (_) { /* optional */ }
    state = "waiting";
    setTimeout(() => {
      const t0 = performance.now();
      const tick = () => {
        const ctx = amb && amb.ctx, ok = amb && (amb.muted || (ctx && ctx.state === "running" && loadState === "ready"));
        if (ok) return void play();
        if (performance.now() - t0 > WAIT_AUDIO_S * 1000) { note({ ok: false, why: "audio never became ready", loadState }); state = "gave up"; return; }
        setTimeout(tick, 300);
      };
      tick();
    }, AFTER_INTRO_S * 1000);
  }
  const intro = document.getElementById("intro");
  if (!intro || intro.classList.contains("gone")) { if (!document.body.classList.contains("is-loading")) greet(); else new MutationObserver((_, o) => { if (!document.body.classList.contains("is-loading")) { o.disconnect(); greet(); } }).observe(document.body, { attributes: true, attributeFilter: ["class"] }); }
  else new MutationObserver((_, o) => { if (intro.classList.contains("gone")) { o.disconnect(); greet(); } }).observe(intro, { attributes: true, attributeFilter: ["class"] });

  /* R7: the night signal. A distorted voice on the radio, someone out there who heard the little planet: switching the sun off,
     or clicking the signal ring above the lookout three times, tunes it in. The clip is audio-src/radio-voice/make.sh (macOS `say`,
     rendered locally, then band-limited, bit-crushed, wobbled and hissed by ffmpeg) -> web/assets/audio/radio-voice.m4a.
     It nods to the Wow! signal (1977, source still unknown) by reading out "6EQUJ5". Muted: the caption only. */
  const VOICE_URL = new URL("../assets/audio/radio-voice.m4a", import.meta.url), VOICE_GAIN = 0.75;
  const WOW_CAP = "<b>Radio</b> · …hello? Is this the small planet? We picked up your signal… 6, E, Q, U, J, 5… Don't turn the sun back on.";
  let wowT = -Infinity, voiceBuf = null, voiceLoad = null;
  const loadVoice = ctx => voiceLoad || (voiceLoad = fetch(VOICE_URL).then(r => r.arrayBuffer()).then(b => new Promise((res, rej) => { const p = ctx.decodeAudioData(b, res, rej); if (p && p.then) p.then(res, rej); })).then(buf => (voiceBuf = buf)).catch(() => null));
  async function wow() {
    const nowMs = performance.now(); if (nowMs - wowT < 15000) return false; wowT = nowMs;   // not again within 15 s, however often it is triggered
    const ctx = amb && amb.ctx;
    showCaption(WOW_CAP, 11000);
    if (!ctx || !amb.out || amb.muted || ctx.state !== "running") { note({ wow: true, ok: false, why: !ctx ? "no context" : amb.muted ? "muted" : "ctx " + (ctx && ctx.state) }); return false; }
    const buf = voiceBuf || await loadVoice(ctx); if (!buf) { note({ wow: true, ok: false, why: "voice clip failed to load" }); return false; }
    const b = ensureBus(ctx);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = VOICE_GAIN / RADIO_GAIN;   // the bus applies RADIO_GAIN; the voice sits at VOICE_GAIN overall
    src.connect(g); g.connect(b.input);
    if (typeof amb.duck === "function") { amb.duck(true); ducking = true; }
    src.onended = () => { try { g.disconnect(); } catch (_) { } setTimeout(() => { if (ducking) { ducking = false; try { amb.duck(false); } catch (_) { } } }, 400); };
    src.start(ctx.currentTime + 0.15);
    note({ wow: true, ok: true, dur: +buf.duration.toFixed(2), gain: VOICE_GAIN });
    return true;
  }

  const api = { play, stop, wow, signal: wow, get state() { return state; }, get loadState() { return loadState; }, get log() { return log.slice(); }, captions: RADIO_CAPTIONS, seenKey: SEEN_KEY };
  try { window.__radio = api; } catch (_) { /* optional */ }
  return api;
}
