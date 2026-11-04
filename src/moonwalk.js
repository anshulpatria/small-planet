import * as THREE from "three";

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
  const padP = at(sd, 2.5, 0.2);
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
  const letters = [], n = WORD.length, out = side.clone().multiplyScalar(sd);
  const pu = upAt(padP);
  const place = (l, i, centre, R) => { const a = centre - (i - (n - 1) / 2) * ARC_STEP, d = out.clone().applyAxisAngle(pu, a), q = padP.clone().addScaledVector(d, R), u = upAt(q); l.base = ground(u); l.up = u.clone(); };
  for (let i = 0; i < n; i++) {
    const a = 0, q = padP, u = upAt(q), g = ground(u);
    const spr = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: letterTexture(WORD[i]), transparent: true, alphaTest: 0.3, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false }));
    spr.scale.set(LETTER_H * 5 / 7, LETTER_H, 1); spr.renderOrder = 4; spr.layers.set(1); spr.visible = false; root.add(spr);
    spr.onBeforeRender = (rr, sc, cam) => {   // face the lens that is drawing it (yaw about the moon's up only); runs before the model-view matrix is built
      spr.quaternion.copy(cam.quaternion); spr.matrixWorld.compose(spr.position, spr.quaternion, spr.scale);   // a screen-aligned billboard: upright and readable from any camera pitch
    };
    const L = { ch: WORD[i], sprite: spr, base: g.clone(), up: u.clone(), got: false, popAt: 0, phase: i * 1.3 }; spr.userData.l = L; letters.push(L);
  }
  letters.forEach((l, i) => place(l, i, ARC_C, ARC_R)); state.relayout = (c, R) => letters.forEach((l, i) => place(l, i, c, R));
  const bursts = [];   // small @ particles for the pop
  for (let i = 0; i < BURSTS; i++) { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: mats["@"].map, transparent: true, alphaTest: 0.3, depthWrite: false, toneMapped: false })); m.visible = false; m.renderOrder = 5; root.add(m); bursts.push({ m, t0: -9, v: new THREE.Vector3() }); }

  const A = { stampN: 0, count: 0, flash: 0, fade: 0, last: null, foot: 1, done: false, hold: false, armed: true, bn: 0 };
  M = Object.assign(state, { spots, ascii, _mats: mats, toast: (msg, ms = 1800) => ui.toast(msg, ms), root, pad, letters, bursts, stamps, A, getStamps: () => stamps.filter(s => s.mesh.visible && s.born >= 0).map(s => s.mesh.position.clone()) });
  const word = () => "GITHUB · " + letters.map(l => (l.got ? l.ch : "_")).join("&nbsp;");
  M.word = word;

  if (ascii) ascii.overlayLayer = 1;   // letters stay out of the ASCII conversion and are drawn crisp on top
  function ensureHold(on) { if (M.ascii) M.ascii.hold = on; A.hold = on; }
  function clearAll(instant) { A.fade = instant ? 0 : FADE; A.fadeFrom = performance.now() / 1000; if (instant) endFade(); }
  function stopTimers() { (A.timers || []).forEach(clearTimeout); A.timers = []; }
  function hideLetters() { for (const l of letters) { l.sprite.visible = false; l.got = false; } for (const b of bursts) { b.m.visible = false; b.t0 = -9; } }
  function endFade() { stopTimers(); A.fade = 0; for (const s of stamps) { s.mesh.visible = false; s.born = -1; } hideLetters(); A.fadeFrom = 0; A.done = false; A.flash = 0; }
  function begin() {
    if (state.act) return;
    endFade();
    state.act = { t0: performance.now() / 1000 }; A.armed = false; A.count = 0; A.last = null; A.flash = 0; A.done = false; A.stampN = 0;
    for (const l of letters) { l.sprite.visible = true; l.got = false; l.popAt = 0; }
    ensureHold(true); M.toast(word(), 4000);
    log && log("begin");
  }
  function cancel(why) {
    if (!state.act) return;
    stopTimers(); state.act = null; A.armed = true; ensureHold(false); hideLetters(); clearAll(false);
    log && log("cancel:" + why);
  }
  function finish() {
    if (!state.act) return;
    state.act = null; A.done = true; A.flash = 1; A.flashAt = performance.now() / 1000;
    for (const l of letters) { l.sprite.visible = true; l.sprite.material.opacity = 1; }
    log && log("flash");
    A.timers = [setTimeout(() => { ensureHold(false); log && log("sweep-back"); }, 700),
    setTimeout(() => { hideLetters(); clearAll(false); if (!ui.found.has(PROJECT)) { solve(); } else ui.toast("GITHUB, again. You’re getting good at spelling.", 2200); log && log("solved"); }, 1900)];
  }
  function burst(pos, up) {
    for (let i = 0; i < 5; i++) { const b = bursts[A.bn++ % bursts.length]; b.m.position.copy(pos); b.t0 = performance.now() / 1000; b.m.visible = true;
      const r = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).addScaledVector(up, 0).normalize().multiplyScalar(1.6); b.v.copy(r).addScaledVector(up, 1.2 + Math.random()); b.m.scale.setScalar(0.4); }
  }
  M.begin = begin; M.cancel = cancel; M.finish = finish; M.endFade = endFade; M.burst = burst;

  spots.push({ id: "moonwalk-pad", kind: "extra", pos: pad.position.clone(), r: 1.9, body: "moon", label: "Spell it out", target: disc,
    off: () => !!state.act || A.done || !A.armed, run: () => begin() });
  if (new URLSearchParams(location.search).has("debug")) window.__moonwalk = M;   // test hook, only with ?debug
  return M;
}

export function moonwalkUpdate(dt, t, player, stateName) { try { update(dt, t, player, stateName); } catch (e) { if (M && M.ascii) M.ascii.hold = false; if (!M || !M.broke) console.warn("moonwalk", e); if (M) M.broke = true; } }
function update(dt, t, player, stateName) {
  const m = M; if (!m || !player || !player.body) return;
  const A = m.A, now = performance.now() / 1000, moon = player.body;
  const onMoon = moon.name === "moon";
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
      // letters: walk through one (any order, any height of hop) to pop it
      for (const l of m.letters) {
        if (l.got || foot.distanceTo(l.base) > HIT_R) continue;
        l.got = true; l.popAt = now; A.count++; m.burst(l.base.clone().addScaledVector(l.up, LETTER_H * 0.9), l.up);
        m.toast(m.word(), A.count === m.letters.length ? 1200 : 2200);
      }
      if (A.count >= m.letters.length) m.finish();
    }
  }
  // letters bob and face the lens (sprites); a popped one scales up and vanishes
  for (const l of m.letters) {
    if (!l.sprite.visible) continue;
    const bob = 0.1 * Math.sin(t * 1.8 + l.phase);
    l.sprite.position.copy(l.base).addScaledVector(l.up, LETTER_H * 0.62 + 0.45 + bob);
    let k = 1;
    if (A.flash > 0 && A.done) k = 1 + 0.25 * Math.max(0, Math.sin(Math.min(1, (now - A.flashAt) / 0.7) * Math.PI));
    if (l.got && !A.done) { const q = (now - l.popAt) / 0.28; if (q >= 1) { l.sprite.visible = false; continue; } k = 1 + 0.9 * q; l.sprite.material.opacity = 1 - q; } else l.sprite.material.opacity = 1;
    l.sprite.scale.set(LETTER_H * 5 / 7 * k, LETTER_H * k, 1);
  }
  for (const b of m.bursts) if (b.m.visible) { const q = (now - b.t0) / 0.6; if (q >= 1) { b.m.visible = false; continue; } b.m.position.addScaledVector(b.v, dt); b.v.multiplyScalar(0.94); b.m.material.opacity = 1 - q; }
  if (A.flash > 0 && now - A.flashAt > 1.9) A.flash = 0;
  if (A.fade > 0 && A.fadeFrom) {
    const k = Math.min(1, (now - A.fadeFrom) / FADE), s = 1 - k * k;
    for (const st of m.stamps) if (st.mesh.visible) setScale(st.mesh, st.size * s);
    if (k >= 1) m.endFade();
  }
}
