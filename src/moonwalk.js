import * as THREE from "three";
import { markMoonVisited } from "./copy-r7.js?v=20261108-2229";

/* ASCII moonwalk, "Spell GITHUB" (the GitHub Portfolio's game, id artboard-42). An inked cream pad stands beside the kiosk's
   visitor spot: "Step into the terminal". Stepping on it (or pressing E there) holds the ASCII pass on (AsciiPass.hold: sustained
   for the act, not the secret's timed trigger). Six big floating letters G I T H U B, each drawn from ramp characters ( .:-=+*#%@),
   bob in an open arc 3 m from the pad, all visible at once. Walking through one pops it (scale-up plus an @ burst); the toast
   reads "GITHUB . G I _ _ _ _". All six: the letters flash, the pass sweeps back to colour and the host marks the project
   discovered (the kiosk's own path). Walking off, leaving the moon or any non-play state cancels: the hold is released the
   same frame and everything is cleared. Footprints stamp ramp characters where the feet touch the ground (grounded frames only:
   moon gravity is floaty), cel and inked, capped at STAMP_CAP, and fade away after the act. Unlit flat two-tone (cream + navy ink).
   Placement is relative to the kiosk frame: visitor spot S, kiosk base B, forward = S - B along the ground. */
const RAMP = " .:-=+*#%@", INK = "#1E1F26", CREAM = "#FFF1CE";
const PAD_OUT = 2.6;   // m from the kiosk's visitor spot, outward along the kiosk's facing
const WORD = "GITHUB", LETTER_H = 1.5, ARC_R = 3.0, ARC_STEP = 0.7, ARC_C = 0, HIT_R = 0.95, STAMP_CAP = 90, STEP = 0.6, PAD_R = 0.85, AREA_R = 9.5, LIFT = 0.05, FADE = 1.6, BURSTS = 30;
const PROJECT = "artboard-42";

const setScale = (m, s) => m.scale.setScalar(Math.max(1e-4, s));
const _f = new THREE.Vector3(), _d = new THREE.Vector3(), _r = new THREE.Vector3(), _p = new THREE.Vector3(), _g = new THREE.Vector3(), _l = new THREE.Vector3();   // scratch: no per-frame allocation
const _z = new THREE.Vector3(), _x = new THREE.Vector3(), _m = new THREE.Matrix4();
let M = null;   // the installed instance

function glyphMat(ch, big) {
  const cv = document.createElement("canvas"); cv.width = cv.height = 128;
  const c = cv.getContext("2d"); c.textAlign = "center"; c.textBaseline = "middle"; c.lineJoin = "round";
  c.font = `800 ${big ? 104 : 96}px ui-monospace, Menlo, monospace`;
  c.lineWidth = 16; c.strokeStyle = CREAM; c.strokeText(ch, 64, 68);   // cream halo, navy fill: two tones
  c.fillStyle = INK; c.fillText(ch, 64, 68);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false });
}

function padTexture() {
  const cv = document.createElement("canvas"); cv.width = cv.height = 256;
  const c = cv.getContext("2d"); c.fillStyle = CREAM; c.fillRect(0, 0, 256, 256);
  c.font = "800 120px ui-monospace, Menlo, monospace"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = INK; c.fillText(">_", 128, 134);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; return tex;
}


const BITS = {
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."], I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."], H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."], B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
};
function letterTexture(ch) {   // a 5x7 letter: solid navy ink blocks on cream; the ASCII pass renders them as ramp characters
  const cw = 40, chh = 40, cv = document.createElement("canvas"); cv.width = 5 * cw + 16; cv.height = 7 * chh + 16;
  const c = cv.getContext("2d"); c.textAlign = "center"; c.textBaseline = "middle"; c.font = "900 34px ui-monospace, Menlo, monospace";
  for (const pass of [0, 1]) BITS[ch].forEach((row, y) => [...row].forEach((v, x) => {
    if (v !== "#") return; const px = 8 + x * cw, py = 8 + y * chh;
    if (pass === 0) { c.fillStyle = CREAM; c.fillRect(px - 5, py - 5, cw + 10, chh + 10); } else { c.fillStyle = INK; c.fillRect(px - 1, py - 1, cw + 2, chh + 2); }
  }));
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; return tex;
}

export function moonwalkInstall(ctx) { try { return install(ctx); } catch (e) { console.warn("moonwalk: not installed", e); return null; } }
function install({ mr, moon, anchors, spots, ui, ascii, solve, log }) {
  if (M) return M;
  const body = mr.getObjectByName("KIOSK_artboard-42_body"), stand = anchors["KIOSK_" + PROJECT];
  if (!body || !stand) return null;
  mr.updateMatrixWorld(true);
  const scene = mr.parent, S = stand.getWorldPosition(new THREE.Vector3()), B = body.getWorldPosition(new THREE.Vector3());
  const upAt = p => moon.up(p), ground = (u, lift = 0) => moon.centre.clone().addScaledVector(u, moon.surface(u) + lift);
  const u0 = upAt(S), fwd = S.clone().sub(B); fwd.addScaledVector(u0, -fwd.dot(u0)); fwd.normalize();
  const side = new THREE.Vector3().crossVectors(u0, fwd).normalize();
  // keep clear of the flag, stars, trampolines and colliders: choose the side with the most room
  const hazards = [];
  for (const [n, o] of Object.entries(anchors)) if (/^(MOONSTAR_|MOONTRAMP_|COL_moon_flag|COL_k_artboard-42|LAND_moon|COL_moon)/.test(n)) hazards.push({ p: o.getWorldPosition(new THREE.Vector3()), r: (o.userData && o.userData.r) || 0.8 });
  const at = (s, a, b) => { const q = S.clone().addScaledVector(side, s * a).addScaledVector(fwd, b), u = upAt(q); return ground(u); };
  const room = s => { let m = 99; for (const [a, b] of [[2.4, 0.3], [5.0, 0.2], [5.6, 1.6], [5.6, -1.4]]) { const q = at(s, a, b); for (const h of hazards) m = Math.min(m, q.distanceTo(h.p) - h.r); } return m; };
  const sd = room(1) >= room(-1) ? 1 : -1;
  const padP = at(1, 0, PAD_OUT);   // R7 (user): on the screen's centre line, straight out in front of the kiosk (was 2.5 m to one side)
  const state = { act: null, found: false, pad: padP, centre: padP, side: sd, hazardRoom: room(sd) };

  const root = new THREE.Group(); root.name = "MOONWALK"; scene.add(root);
  const flat = (pos, spin) => {
    const u = upAt(pos), y = spin.clone().addScaledVector(u, -spin.dot(u)).normalize(), x = new THREE.Vector3().crossVectors(y, u).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, u));
  };
  // the pad: navy ink ring + cream disc with a ">_"
  const pad = new THREE.Group(); pad.name = "MOONWALK_pad";
  const padMat = new THREE.MeshBasicMaterial({ map: padTexture(), toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const inkMat = new THREE.MeshBasicMaterial({ color: INK, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(PAD_R, 48), padMat); disc.position.z = 0.012; disc.renderOrder = 2;
  const ring = new THREE.Mesh(new THREE.CircleGeometry(PAD_R + 0.13, 48), inkMat); ring.renderOrder = 1;
  pad.add(ring, disc); pad.position.copy(ground(upAt(padP), LIFT)); pad.quaternion.copy(flat(padP, fwd.clone().negate())); root.add(pad);

  const mats = {}; for (const ch of RAMP.slice(1)) mats[ch] = glyphMat(ch, ch === "@");
  const geo = new THREE.PlaneGeometry(1, 1);
  const mk = ch => { const m = new THREE.Mesh(geo, mats[ch]); m.renderOrder = 3; m.visible = false; root.add(m); return m; };
  const stamps = [];
  for (let i = 0; i < STAMP_CAP; i++) stamps.push({ mesh: mk("."), born: -1, size: 0.5 });
  // the letters: an open arc round the pad on the side away from the kiosk; each a sprite that always faces the camera
  const letters = [], n = WORD.length, out = fwd.clone();   // R7: the arc opens straight away from the kiosk, centred on the same line
  const pu = upAt(padP);
  const place = (l, i, centre, R) => { const a = centre - (i - (n - 1) / 2) * ARC_STEP, d = out.clone().applyAxisAngle(pu, a), q = padP.clone().addScaledVector(d, R), u = upAt(q); l.base = ground(u); l.up = u.clone(); };
  for (let i = 0; i < n; i++) {
    const a = 0, q = padP, u = upAt(q), g = ground(u);
    const spr = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: letterTexture(WORD[i]), transparent: true, alphaTest: 0.3, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false }));
    spr.scale.set(LETTER_H * 5 / 7, LETTER_H, 1); spr.renderOrder = 4; spr.layers.set(1); spr.visible = false; root.add(spr);
    spr.onBeforeRender = (rr, sc, cam) => {   // face the lens that is drawing it (yaw about the moon's up only); runs before the model-view matrix is built
      if (L.show) {   // R7: the payoff row, drawn in front of the lens, big and level
        const d = 7, w = 2 * d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.aspect, sp = Math.min(w * 0.82 / WORD.length, 2.3), h = Math.min(sp * 7 / 5 * 0.9, 3.2), k = 1 + 0.06 * Math.sin((performance.now() / 1000 - L.show) * 6 + L.phase);
        _x.set(1, 0, 0).applyQuaternion(cam.quaternion); _z.set(0, 1, 0).applyQuaternion(cam.quaternion);
        spr.position.copy(cam.position).addScaledVector(_f.set(0, 0, -1).applyQuaternion(cam.quaternion), d).addScaledVector(_x, (L.idx - (WORD.length - 1) / 2) * sp).addScaledVector(_z, 0.4);
        spr.scale.set(h * 5 / 7 * k, h * k, 1);
      }
      spr.quaternion.copy(cam.quaternion); spr.matrixWorld.compose(spr.position, spr.quaternion, spr.scale);   // a screen-aligned billboard: upright and readable from any camera pitch
    };
    const L = { idx: i, show: 0, ch: WORD[i], sprite: spr, base: g.clone(), up: u.clone(), got: false, popAt: 0, phase: i * 1.3 }; spr.userData.l = L; letters.push(L);
  }
  letters.forEach((l, i) => place(l, i, ARC_C, ARC_R)); state.relayout = (c, R) => letters.forEach((l, i) => place(l, i, c, R));
  const bursts = [];   // small @ particles for the pop
  for (let i = 0; i < BURSTS; i++) { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: mats["@"].map, transparent: true, alphaTest: 0.3, depthWrite: false, toneMapped: false })); m.visible = false; m.renderOrder = 5; root.add(m); bursts.push({ m, t0: -9, v: new THREE.Vector3() }); }

  /* R7 C2: Blip's marker. The ASCII pass turns the whole world into characters, Blip included, so while the act runs a flat ring
     (ink edge, cream band) lies at his feet on the crisp overlay layer, drawn over the ASCII like the letters. */
  const mark = new THREE.Group(); mark.name = "MOONWALK_blip_ring"; mark.visible = false; root.add(mark);
  const mkRing = (r0, r1, color, order) => { const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 56), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, depthWrite: false, toneMapped: false, fog: false })); m.renderOrder = order; m.layers.set(1); mark.add(m); return m; };
  mkRing(0.5, 1.02, INK, 6); mkRing(0.6, 0.92, CREAM, 7);
  const pulseHaptic = () => { try { const g = (navigator.getGamepads && [...navigator.getGamepads()].find(x => x && x.connected)); g && g.vibrationActuator && g.vibrationActuator.playEffect("dual-rumble", { duration: 90, strongMagnitude: 0.4, weakMagnitude: 0.6 }); } catch { /* optional */ } };
  /* the hint rides under the toast along the top while the act runs, so it never sits over the letter row or Blip's ring (r7-gh, injected here) */
  if (!document.getElementById("r7-gh-style")) { const st = document.createElement("style"); st.id = "r7-gh-style"; st.textContent = "#hint.r7-gh{bottom:auto !important;top:calc(var(--hud-t, var(--gut, 16px)) + 124px) !important;max-width:calc(100vw - 32px)}"; document.head.appendChild(st); }
  const hintTop = on => { const h = document.getElementById("hint"); h && h.classList.toggle("r7-gh", on); };
  const HINT = "Walk into each letter. No typing.";
  const A = { stampN: 0, count: 0, flash: 0, fade: 0, last: null, foot: 1, done: false, hold: false, armed: true, bn: 0 };
  M = Object.assign(state, { mark, spots, ascii, _mats: mats, toast: (msg, ms = 1800) => ui.toast(msg, ms), root, pad, letters, bursts, stamps, A, getStamps: () => stamps.filter(s => s.mesh.visible && s.born >= 0).map(s => s.mesh.position.clone()) });
  const word = () => "Collect the letters · " + letters.map(l => (l.got ? l.ch : "_")).join("&nbsp;");   // R7 C2: it names the verb, so it never reads as "type this"
  M.word = word;

  if (ascii) ascii.overlayLayer = 1;   // letters stay out of the ASCII conversion and are drawn crisp on top
  function ensureHold(on) { if (M.ascii) M.ascii.hold = on; A.hold = on; }
  function clearAll(instant) { A.fade = instant ? 0 : FADE; A.fadeFrom = performance.now() / 1000; if (instant) endFade(); }
  function stopTimers() { (A.timers || []).forEach(clearTimeout); A.timers = []; }
  function hideLetters() { for (const l of letters) { l.sprite.visible = false; l.got = false; l.show = 0; } for (const b of bursts) { b.m.visible = false; b.t0 = -9; } }
  function endFade() { stopTimers(); mark.visible = false; A.fade = 0; for (const s of stamps) { s.mesh.visible = false; s.born = -1; } hideLetters(); A.fadeFrom = 0; A.done = false; A.flash = 0; }
  function begin() {
    if (state.act) return;
    endFade();
    state.act = { t0: performance.now() / 1000 }; A.armed = false; A.count = 0; A.last = null; A.flash = 0; A.done = false; A.stampN = 0;
    for (const l of letters) { l.sprite.visible = true; l.got = false; l.popAt = 0; }
    ensureHold(true); M.toast(word(), 4000); ui.hint && ui.hint(HINT); hintTop(true);
    log && log("begin");
  }
  function cancel(why) {
    if (!state.act) return;
    stopTimers(); state.act = null; A.armed = true; ensureHold(false); hideLetters(); clearAll(false); mark.visible = false; ui.hideHint && ui.hideHint(); hintTop(false);
    log && log("cancel:" + why);
  }
  /* R7: a pickup lands. The letter flies up to the word on screen, the toast fills its slot and ticks, and an event goes out for a sound */
  const flyers = [];
  const toastTick = () => { const t = document.getElementById("toast"); if (!t) return; t.classList.remove("r7-tick"); void t.offsetWidth; t.classList.add("r7-tick"); };
  if (!document.getElementById("r7-gh-tick")) { const st = document.createElement("style"); st.id = "r7-gh-tick"; st.textContent = "@keyframes r7tick{0%{scale:1}35%{scale:1.14}100%{scale:1}}#toast.r7-tick{animation:r7tick .32s ease-out}"; document.head.appendChild(st); }
  function launch(l, n) {
    const m = new THREE.Mesh(geo, l.sprite.material.clone()); m.renderOrder = 6; m.layers.set(1); root.add(m);
    m.onBeforeRender = (rr, sc, cam) => {
      const q = Math.min(1, (performance.now() / 1000 - m.userData.t0) / 0.5), e = q * q * (3 - 2 * q);
      _x.set(1, 0, 0).applyQuaternion(cam.quaternion); _z.set(0, 1, 0).applyQuaternion(cam.quaternion);
      const tgt = _f.copy(cam.position).addScaledVector(_d.set(0, 0, -1).applyQuaternion(cam.quaternion), 6).addScaledVector(_z, 2.6 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * 2.1 / 2.6);
      m.position.copy(m.userData.from).lerp(tgt, e); m.scale.set(0.7 * (1 - 0.7 * e), 1.0 * (1 - 0.7 * e), 1); m.quaternion.copy(cam.quaternion); m.matrixWorld.compose(m.position, m.quaternion, m.scale);
    };
    m.userData = { t0: performance.now() / 1000, from: l.sprite.position.clone() }; flyers.push(m);
    toastTick(); try { window.dispatchEvent(new CustomEvent("r7:letter", { detail: { n, total: letters.length, ch: l.ch } })); } catch { /* optional */ }
  }
  M.flyers = flyers; M.launch = launch;
  function finish() {   // 6th letter picked: act ends (no more pickups), a beat, THEN the full word, THEN the old celebration
    if (!state.act) return;
    state.act = null; A.finishing = true; mark.visible = false; ui.hideHint && ui.hideHint(); hintTop(false);
    log && log("beat");
    A.timers = [setTimeout(() => {
      const t = performance.now() / 1000; for (const l of letters) { l.show = t; l.sprite.visible = true; l.sprite.material.opacity = 1; }
      M.toast("<b>Spelled it.</b> G I T H U B", 1700); try { window.dispatchEvent(new CustomEvent("r7:spelled")); } catch { /* optional */ }
      log && log("word");
    }, 400), setTimeout(() => { for (const l of letters) l.show = 0; A.finishing = false; celebrate(); }, 1950)];
  }
  function celebrate() {
    A.done = true; A.flash = 1; A.flashAt = performance.now() / 1000;
    state.act = null; A.done = true; A.flash = 1; A.flashAt = performance.now() / 1000; mark.visible = false; ui.hideHint && ui.hideHint(); hintTop(false);
    for (const l of letters) { l.sprite.visible = true; l.sprite.material.opacity = 1; }
    log && log("flash");
    A.timers = [setTimeout(() => { ensureHold(false); log && log("sweep-back"); }, 700),
    setTimeout(() => { hideLetters(); clearAll(false); if (!ui.found.has(PROJECT)) { solve(); } else ui.toast("GITHUB, again. You’re getting good at spelling.", 2200); log && log("solved"); }, 1900)];
  }
  function burst(pos, up) {
    for (let i = 0; i < 5; i++) { const b = bursts[A.bn++ % bursts.length]; b.m.position.copy(pos); b.t0 = performance.now() / 1000; b.m.visible = true;
      const r = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).addScaledVector(up, 0).normalize().multiplyScalar(1.6); b.v.copy(r).addScaledVector(up, 1.2 + Math.random()); b.m.scale.setScalar(0.4); }
  }
  M.pulse = pulseHaptic; M.begin = begin; M.cancel = cancel; M.finish = finish; M.endFade = endFade; M.burst = burst;

  spots.push({ id: "moonwalk-pad", kind: "extra", pos: pad.position.clone(), r: 1.9, body: "moon", label: "Collect the letters", target: disc,
    off: () => !!state.act || A.done || !A.armed, run: () => begin() });
  if (new URLSearchParams(location.search).has("debug")) window.__moonwalk = M;   // test hook, only with ?debug
  return M;
}

export function moonwalkUpdate(dt, t, player, stateName) { try { update(dt, t, player, stateName); } catch (e) { if (M && M.ascii) M.ascii.hold = false; if (!M || !M.broke) console.warn("moonwalk", e); if (M) M.broke = true; } }
function update(dt, t, player, stateName) {
  const m = M; if (!m || !player || !player.body) return;
  const A = m.A, now = performance.now() / 1000, moon = player.body;
  const onMoon = moon.name === "moon";
  if (onMoon) markMoonVisited();   // R7 D2: AP asks "have you been to the moon yet?" only until you have
  const foot = onMoon ? _f.copy(moon.centre).addScaledVector(player.up, moon.surface(player.up)) : null;
  if (!m.kspot) { m.kspot = m.spots.find(x => x.id === PROJECT) || null; if (m.kspot) { const o = m.kspot.off; m.kspot.off = () => !!m.act || m.nearPad || (o ? o() : false); } }   // the kiosk's "Look closer" is quiet only while the act runs
  m.nearPad = onMoon && !m.act && A.armed && !A.done && foot.distanceTo(m.pad.position) < 2.0;   // beside the pad, its prompt outranks the kiosk's
  m.pad.scale.setScalar(1 + 0.03 * Math.sin(t * 2.2));
  const grounded = player.height < 0.12 && !player.flight;
  if (!m.act) {
    if (onMoon && stateName === "play" && grounded && A.armed && !A.done && foot.distanceTo(m.pad.position) < PAD_R) m.begin();
    if (onMoon && foot.distanceTo(m.pad.position) > PAD_R + 0.7) A.armed = true;   // step off the pad to re-arm it
  } else {
    if (!onMoon || player.flight || stateName !== "play" || foot.distanceTo(m.centre) > AREA_R) { m.cancel(!onMoon ? "left-moon" : player.flight ? "flight" : stateName !== "play" ? "state:" + stateName : "area"); }
    else {
      // footprints: on ground contact only; alternate L/R about the walk line, one per STEP metres
      if (grounded) {
        if (!A.last) A.last = _l.copy(foot);
        if (foot.distanceTo(A.last) >= STEP) {
          const dir = _d.copy(foot).sub(A.last); dir.addScaledVector(player.up, -dir.dot(player.up)); if (dir.lengthSq() < 1e-6) dir.copy(player.facing); dir.normalize();
          const u = player.up, right = _r.crossVectors(dir, u).normalize(); A.foot = -A.foot;
          const p = _p.copy(foot).addScaledVector(right, 0.14 * A.foot), uu = moon.up(p), gp = _g.copy(moon.centre).addScaledVector(uu, moon.surface(uu) + LIFT);
          const ch = RAMP[1 + Math.min(8, Math.floor((A.count / m.letters.length) * 8.99))], s = m.stamps[A.stampN % m.stamps.length]; A.stampN++;
          s.mesh.material = m._mats[ch]; s.mesh.position.copy(gp);
          const y = dir.clone().addScaledVector(uu, -dir.dot(uu)).normalize(), x = new THREE.Vector3().crossVectors(y, uu).normalize();
          s.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, uu));
          s.born = now; s.size = 0.5; s.mesh.visible = true; setScale(s.mesh, s.size);
          A.last.copy(foot);
        }
      } else A.last = null;   // airborne: no stamping; the trail resumes from where he lands
      // R7 C2: the ring follows Blip's feet (flat on the ground, pulsing a little so the eye finds it)
      m.mark.visible = true; m.mark.position.copy(foot).addScaledVector(player.up, 0.04);
      _z.copy(player.up); _x.set(0, 1, 0); if (Math.abs(_z.y) > 0.99) _x.set(1, 0, 0);
      m.mark.quaternion.setFromUnitVectors(_x.set(0, 0, 1), _z); m.mark.scale.setScalar(1 + 0.08 * Math.sin(t * 5));
      // letters: walk through one (any order, any height of hop) to pop it
      for (const l of m.letters) {
        if (l.got || foot.distanceTo(l.base) > HIT_R) continue;
        l.got = true; l.popAt = now; A.count++; m.pulse && m.pulse(); m.launch(l, A.count); m.burst(l.base.clone().addScaledVector(l.up, LETTER_H * 0.9), l.up);
        if (A.count < m.letters.length) m.toast(m.word(), 2200); else m.toast(m.word(), 800);
      }
      if (A.count >= m.letters.length) m.finish();
    }
  }
  // letters bob and face the lens (sprites); a popped one scales up and vanishes
  for (const l of m.letters) {
    if (!l.sprite.visible) continue;
    if (l.show) continue;
    const bob = 0.1 * Math.sin(t * 1.8 + l.phase);
    l.sprite.position.copy(l.base).addScaledVector(l.up, LETTER_H * 0.62 + 0.45 + bob);
    let k = 1;
    if (A.flash > 0 && A.done) k = 1 + 0.25 * Math.max(0, Math.sin(Math.min(1, (now - A.flashAt) / 0.7) * Math.PI));
    if (l.got && !A.done) { const q = (now - l.popAt) / 0.28; if (q >= 1) { l.sprite.visible = false; continue; } k = 1 + 0.9 * q; l.sprite.material.opacity = 1 - q; } else l.sprite.material.opacity = 1;
    l.sprite.scale.set(LETTER_H * 5 / 7 * k, LETTER_H * k, 1);
  }
  for (let i = flyersOf(m).length - 1; i >= 0; i--) { const f = m.flyers[i]; if (now - f.userData.t0 > 0.5) { root0(f); m.flyers.splice(i, 1); } }
  for (const b of m.bursts) if (b.m.visible) { const q = (now - b.t0) / 0.6; if (q >= 1) { b.m.visible = false; continue; } b.m.position.addScaledVector(b.v, dt); b.v.multiplyScalar(0.94); b.m.material.opacity = 1 - q; }
  if (A.flash > 0 && now - A.flashAt > 1.9) A.flash = 0;
  if (A.fade > 0 && A.fadeFrom) {
    const k = Math.min(1, (now - A.fadeFrom) / FADE), s = 1 - k * k;
    for (const st of m.stamps) if (st.mesh.visible) setScale(st.mesh, st.size * s);
    if (k >= 1) m.endFade();
  }
}

const flyersOf = m => m.flyers || [];
const root0 = f => { f.parent && f.parent.remove(f); f.material.dispose(); };
