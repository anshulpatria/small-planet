import * as THREE from "three";
import { fontsReady } from "./signs.js?v=20261108-2312";
import { outline } from "./toon.js?v=20261108-2312";

/* "Walk the hive": a honeycomb of raised, spring-loaded hex pads on the ground by the AI Momentum to Value kiosk.
   Five of the 19 hexes are numbered honey buttons; stepping on one lights it for good and toasts that strategic move.
   All five lit = one quick ripple across the hive + opts.onSolved().

   The titles are the five moves' headings, copied verbatim from the report itself
   (https://sea-ai-maturity.bcg.com/, section "5 strategic moves that chart the path to value", the five <h3>s,
   read 2026-11-04 from a single headless page load). Nothing here is invented copy. */
export const HIVE_MOVES = [
  "Give AI leaders real authority, not just a title",
  "Commit to bold topline ambitions, not just cost",
  "Prioritize few, scaled plays over a graveyard of pilots",
  "Build a real AI platform, not AI components",
  "Supercharge employees to work in human-AI teams",
];

const INK = "#1E1F26";
// the world's own colours: terrace cream (M_Clay_Cream) for the base plate, the Brand Studio keycap cream for plain caps,
// the kiosk's M_Teal as the ONE accent for the move caps (a darker teal once pressed)
const TONES = { plate: "#9E8A70", cap: "#FFF6E6", teal: "#3FA7A3", tealLit: "#2B7A77", wave: "#B8EBDD" };
const SQ3 = Math.sqrt(3);
const PAD_W = 0.74;   // a pad across its flats: ~1.0x Blip's body (0.75 m), top face ~0.8x; Brand Studio keycaps are 0.5 m
const KS = PAD_W / 0.5;   // the keypad keycap's size ratio: every keycap dimension below is brand-studio's, scaled by it
const PLATE_H = 0.05, PAD_H = 0.14 * KS, DOME = 0.006;   // plate top above the ground; cap top above the plate; the cap's dome
const SPRING_K = 300, SPRING_C = 18;               // pad spring: stiffness, damping (zeta ~ 0.52: a visible overshoot)
const SINK = 0.07, SINK_NEAR = 0.012, SINK_LIT = 0.04;   // dip under Blip; under his neighbours (~15%); a pressed move pad's rest dip

/* the Brand Studio keypad's two-tone ramp (games/brand-studio.js): lit + shade, one hard edge */
function keyRamp() {
  const t = new THREE.DataTexture(new Uint8Array([175, 175, 175, 255, 175, 175, 175, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
}

/* A rounded hexagon ring at height y: apothem a, corner radius r, first corner at angle `phase`; the points carry their outward
   direction (dx, dz) so normals turn smoothly round each corner (local: x right, z = -v, v toward the kiosk). */
function hexRingR(a, r, y, phase, seg) {
  const p = [], cd = (a - r) * 2 / SQ3;
  for (let k = 0; k < 6; k++) {
    const ang = phase + k * Math.PI / 3, cx = Math.cos(ang) * cd, cy = Math.sin(ang) * cd;
    for (let j = 0; j <= seg; j++) {
      const th = ang - Math.PI / 6 + (j / seg) * Math.PI / 3;
      p.push({ x: cx + Math.cos(th) * r, y, z: -(cy + Math.sin(th) * r), dx: Math.cos(th), dz: -Math.sin(th) });
    }
  }
  return p;
}
/* Triangles with explicit normals, wound outward against them (the same helper shape as keycap() in brand-studio.js). */
function Mesher() {
  const pos = [], nor = [];
  const tri = (a, b, c, na, nb, nc) => {
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (fx * (na[0] + nb[0] + nc[0]) + fy * (na[1] + nb[1] + nc[1]) + fz * (na[2] + nb[2] + nc[2]) < 0) { [b, c] = [c, b]; [nb, nc] = [nc, nb]; }
    for (const [p, n] of [[a, na], [b, nb], [c, nc]]) { pos.push(p.x, p.y, p.z); nor.push(...n); }
  };
  const band = (A, B, nf) => { for (let i = 0; i < A.length; i++) { const j = (i + 1) % A.length, na = nf(A[i]), nb = nf(A[j]); tri(A[i], A[j], B[j], na, nb, nb); tri(A[i], B[j], B[i], na, nb, na); } };
  const geo = () => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); g.computeBoundingSphere(); return g; };
  return { tri, band, geo };
}
const unit = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };

/* The pad: Brand Studio's keycap in hexagon form. A stem (inset) carries the cap lift above the plate; the cap's walls lean in by `taper`
   to a chamfer of `bev`, then a top with a slight dome. Stem, underside, walls, chamfer and top are separate bands, so the cel edge
   falls on the top edge and the ink hull has a silhouette all round the cap. The stem runs down into the plate so the pad can sink. */
function hexKeycap(a, h, r, taper, bev, lift, inset, seg = 4) {
  const a1 = a - taper, a2 = a1 - bev, ph = Math.PI / 2;   // pointy-top
  const S0 = hexRingR(a - inset, r * 0.5, -0.14, ph, seg), S1 = hexRingR(a - inset, r * 0.5, lift, ph, seg);
  const R0 = hexRingR(a, r, lift, ph, seg), R1 = hexRingR(a1, r * a1 / a, h - bev, ph, seg), R2 = hexRingR(a2, Math.max(0.01, r * a1 / a - bev * 0.6), h, ph, seg);
  const M = Mesher();
  M.band(S0, S1, p => [p.dx, 0, p.dz]);
  M.band(S1, R0, () => [0, -1, 0]);
  M.band(R0, R1, p => unit(p.dx, -0.8, p.dz));   // the wall leans its normal DOWN so the sun never lights it: the side band is always the shade tone
  M.band(R1, R2, () => [0, 1, 0]);   // the chamfer takes the top's flat normal: a clean lit rim, so the cel edge falls only on the wall's top edge
  const c = { x: 0, y: h + DOME, z: 0 }, nc = [0, 1, 0];
  const top = p => unit(p.dx * 0.0, 1, p.dz * 0.0);   // the dome is in the silhouette only: a flat normal keeps the top ONE tone
  for (let i = 0; i < R2.length; i++) { const j = (i + 1) % R2.length; M.tri(c, R2[i], R2[j], nc, top(R2[i]), top(R2[j])); }
  return M.geo();
}

/* The base plate: a low rounded-hexagon slab like a terrace, built in world space so it follows the planet's curve (sampled per vertex),
   its top PLATE_H above the ground, a soft chamfer, and a wall that runs below the ground (no floating edge).
   sample(lx, v, h) -> { x, y, z, up } on the surface in the hive's frame; dirOf(dx, dv) -> the world direction of a local outward vector. */
function plateGeo(a, r, sample, dirOf) {
  const T = hexRingR(a - 0.08, Math.max(0.01, r - 0.08), PLATE_H, 0, 6), B = hexRingR(a, r, PLATE_H - 0.03, 0, 6), W = hexRingR(a, r, -0.08, 0, 6);   // flat-top slab
  const M = Mesher();
  const P = q => ({ ...sample(q.x, -q.z, q.y), dx: q.dx, dz: q.dz });
  const nrm = (p, k) => { const o = dirOf(p.dx, -p.dz); return unit(o.x * k[0] + p.up.x * k[1], o.y * k[0] + p.up.y * k[1], o.z * k[0] + p.up.z * k[1]); };
  const Tp = T.map(P), Bp = B.map(P), Wp = W.map(P);
  M.band(Bp, Wp, p => nrm(p, [1, 0]));
  M.band(Tp, Bp, p => nrm(p, [0.7, 0.7]));
  const rings = [1, 0.66, 0.33].map(s => T.map(q => P({ ...q, x: q.x * s, z: q.z * s })));
  const upN = p => [p.up.x, p.up.y, p.up.z];
  for (let k = 0; k < rings.length - 1; k++) M.band(rings[k], rings[k + 1], upN);
  const cp = P({ x: 0, y: PLATE_H, z: 0, dx: 0, dz: 0 }), last = rings[rings.length - 1];
  for (let i = 0; i < last.length; i++) { const j = (i + 1) % last.length; M.tri(cp, last[i], last[j], upN(cp), upN(last[i]), upN(last[j])); }
  return M.geo();
}

export class HiveFloor {
  /* frame: { c, n, f, x } from terraceFrame(): c = the kiosk's visitor spot, f toward the kiosk, n up (radial).
     opts.centre / opts.surface: the planet's centre and its analytic surface(dir) (distance from the centre), sampled per vertex.
     opts.at: [x, f] metres from the visitor spot, in the frame (local: it follows the planet when it is resized).
     opts.screen: the kiosk screen mesh (shows the move you stand on). opts.onSolved: fired once. */
  constructor(scene, frame, { centre, surface, at = [0, -3.5], screen = null, onSolved = null, pitch = PAD_W + 0.07, gap = 0.07, rings = 2, supports = null } = {}) {
    this.scene = scene; this.frame = frame; this.onSolved = onSolved; this.screen = screen;
    this.pitch = pitch; this.Rc = (pitch - gap) / SQ3;
    this.lit = new Set(); this.active = -1; this.solved = false; this.rip = -1; this.lastMove = -1;
    const V = THREE.Vector3;
    this.centre = frame.c.clone().addScaledVector(frame.x, at[0]).addScaledVector(frame.f, at[1]);

    // axial coordinates of the flower: centre + `rings` rings (19 for rings = 2)
    const cells = [];
    for (let q = -rings; q <= rings; q++) for (let r = -rings; r <= rings; r++) if (Math.abs(q + r) <= rings) cells.push({ q, r });
    for (const k of cells) { k.lx = pitch * (k.q + k.r / 2); k.ly = pitch * (SQ3 / 2) * k.r; k.ring = Math.max(Math.abs(k.q), Math.abs(k.r), Math.abs(k.q + k.r)); }
    this.cells = cells;
    // the five move pads form a dice-five: the centre pad and the four around it at +-60/120 degrees (symmetric about both axes), numbered 1-2 (far row),
    // 3-4 (near row, clockwise), then the centre as 5
    this.moves = [[-1, 1], [0, 1], [1, -1], [0, -1], [0, 0]].map(([q, r]) => cells.findIndex(k => k.q === q && k.r === r));
    this.moveOf = new Map(this.moves.map((ci, m) => [ci, m]));

    // A low inked BASE PLATE (a terrace-style slab in the terrace cream) carries the pads, so the hive reads as an installation. Each pad is a
    // hex keycap (Brand Studio's language: two-tone cel, rounded bevel, domed top, chunky skirt, ink hull from toon.js outline()).
    // The plate top and every cap top are walkable supports for Blip (player.supports), so his feet ride them with no change to player.js.
    this.supports = supports; this.pads = [];
    this.group = new THREE.Group(); this.group.name = "HIVE_floor";
    const Rc = this.Rc, apo = Rc * SQ3 / 2, ramp = keyRamp();
    const dir = new V(), w = new V(), X = new V(), Z = new V(), Mx = new THREE.Matrix4();
    const sampleAt = (lx, v, h) => {
      w.copy(this.centre).addScaledVector(frame.x, lx).addScaledVector(frame.f, v);
      dir.copy(w).sub(centre).normalize();
      const p = new V().copy(centre).addScaledVector(dir, surface(dir) + h);
      return { x: p.x, y: p.y, z: p.z, up: dir.clone() };
    };
    const dirOf = (dx, dv) => new V().addScaledVector(frame.x, dx).addScaledVector(frame.f, dv);
    this.Rp = 2 * pitch * SQ3 / 2 + Rc + 0.3;   // plate apothem: the lattice's reach plus a margin
    const plateMat = new THREE.MeshToonMaterial({ color: TONES.plate, gradientMap: ramp });
    this.plate = new THREE.Mesh(plateGeo(this.Rp, 0.5, sampleAt, dirOf), plateMat);
    this.plate.castShadow = true; this.plate.receiveShadow = true; this.plate.frustumCulled = false; this.plate.name = "HIVE_plate";
    this.group.add(this.plate);
    if (outline) outline(this.plate, INK, undefined, { back: 0.25 });   // the same hull as the terraces
    if (supports) supports.push(this.plate);
    const capGeo = hexKeycap(apo, PAD_H, 0.06 * KS, 0.025 * KS, 0.02 * KS, 0.025 * KS, 0.06 * KS);
    this.atlas = document.createElement("canvas"); this.atlas.width = 640; this.atlas.height = 128;
    this.atlasTex = new THREE.CanvasTexture(this.atlas); this.atlasTex.colorSpace = THREE.NoColorSpace;
    this.drawAtlas(); fontsReady.then(() => this.drawAtlas());   // the numerals wait for Bricolage Grotesque
    this.geos = [capGeo, this.plate.geometry]; this.mats = [plateMat]; this.ramp = ramp;
    cells.forEach((k, ci) => {
      const s = sampleAt(k.lx, k.ly, PLATE_H), base = new V(s.x, s.y, s.z), up = s.up;
      X.copy(frame.x).addScaledVector(up, -frame.x.dot(up)).normalize();
      Z.crossVectors(X, up);                                   // right-handed (X, N, Z); Z = -f
      const root = new THREE.Group(); root.position.copy(base); root.quaternion.setFromRotationMatrix(Mx.makeBasis(X, up, Z));
      const mover = new THREE.Group(); root.add(mover);
      const move = this.moveOf.has(ci) ? this.moveOf.get(ci) : -1;
      const mat = new THREE.MeshToonMaterial({ color: move >= 0 ? TONES.teal : TONES.cap, gradientMap: ramp });
      const cap = new THREE.Mesh(capGeo, mat); cap.castShadow = true; cap.receiveShadow = false; cap.frustumCulled = false; cap.name = "HIVE_pad_" + ci;
      mover.add(cap); this.group.add(root); this.mats.push(mat);
      let num = null;
      if (move >= 0) {   // the inked number on the cap
        const g = new THREE.PlaneGeometry(0.3, 0.3); g.rotateX(-Math.PI / 2);
        const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, (move + uv.getX(i)) / 5);
        num = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: this.atlasTex, color: INK, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
        num.position.y = PAD_H + DOME + 0.002; num.raycast = () => {}; num.renderOrder = 2; num.frustumCulled = false;
        mover.add(num); this.geos.push(g); this.mats.push(num.material);
      }
      if (outline) outline(cap, INK);   // the keycap hull: the world's shared ink line, riding inside the mover
      if (supports) supports.push(cap);
      this.pads.push({ root, mover, cap, mat, num, move, lit: false, state: -1, x: 0, v: 0, drawn: 1, kicked: false });
    });
    scene.add(this.group); this.group.updateMatrixWorld(true);

    // the kiosk screen: the screenshot, or the move you stand on
    if (screen) {
      this.panel = document.createElement("canvas"); this.panel.width = 1000; this.panel.height = 600;
      this.panelTex = new THREE.CanvasTexture(this.panel); this.panelTex.colorSpace = THREE.SRGBColorSpace; this.panelTex.flipY = false;
      this._origMat = screen.material;
      this.SU = { uShot: { value: screen.material.map }, uPanel: { value: this.panelTex }, uMix: { value: 0 } };
      screen.material = new THREE.ShaderMaterial({
        uniforms: this.SU, toneMapped: false,
        vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: `varying vec2 vUv; uniform sampler2D uShot, uPanel; uniform float uMix;
          void main() {
            vec2 rq = abs((vUv - 0.5) * vec2(4.0, 2.4)) - (vec2(2.0, 1.2) - 0.3);
            if (length(max(rq, 0.0)) - 0.3 > 0.0) discard;
            vec3 shot = linearToOutputTexel(texture2D(uShot, vUv)).rgb;
            vec3 pan = linearToOutputTexel(texture2D(uPanel, vUv)).rgb;
            gl_FragColor = vec4(mix(shot, pan, uMix), 1.0);
          }`,
      });
      this.drawPanel(-1);
      fontsReady.then(() => this.drawPanel(this.lastMove));
    }
  }

  drawPanel(m) {
    if (!this.panel) return;
    const g = this.panel.getContext("2d"), W = 1000, H = 600;
    g.fillStyle = "#211C3D"; g.fillRect(0, 0, W, H);
    g.textBaseline = "alphabetic";
    const hex = (x, y, r, fill, stroke) => {
      g.beginPath(); for (let j = 0; j < 6; j++) { const a = Math.PI / 2 + j * Math.PI / 3; g[j ? "lineTo" : "moveTo"](x + Math.cos(a) * r, y - Math.sin(a) * r); }
      g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } g.lineWidth = 6; g.strokeStyle = stroke; g.stroke();
    };
    g.fillStyle = TONES.wave; g.font = '700 44px "Bricolage Grotesque", system-ui, sans-serif';
    g.fillText(m < 0 ? "Walk the hive" : `Move ${m + 1}  ·  ${this.lit.size} of ${HIVE_MOVES.length} lit`, 60, 100);
    g.fillStyle = "#FFF6E6"; g.font = '700 78px "Bricolage Grotesque", system-ui, sans-serif';
    const text = m < 0 ? "Five pads. Five big moves. Tiny footsteps." : HIVE_MOVES[m];
    const words = text.split(" "), lines = []; let cur = "";
    for (const w of words) { const t = cur ? cur + " " + w : w; if (g.measureText(t).width > W - 120 && cur) { lines.push(cur); cur = w; } else cur = t; }
    lines.push(cur);
    lines.forEach((l, j) => g.fillText(l, 60, 215 + j * 92));
    for (let j = 0; j < HIVE_MOVES.length; j++) hex(110 + j * 120, 520, 40, this.lit.has(this.moves[j]) ? TONES.teal : null, this.lit.has(this.moves[j]) ? TONES.wave : "#8E86B8");
    this.panelTex.needsUpdate = true;
  }

  /* Returns { i, name, n, count, first, solved, html } (n = the move's number in the report; the toast's n/5 is the count lit) when Blip steps onto a move hex (null otherwise), the same
     shape of event as FieldFloor's; the host toasts `html`. */
  update(dt, t, player) {
    let now = -1, onFloor = false;
    if (player && !player.flight) {
      const d = player.position.clone().sub(this.centre), f = this.frame;
      const lx = d.dot(f.x), ly = d.dot(f.f), h = d.dot(f.n), reach = this.pitch * 2 + this.Rc + 1;
      if (Math.hypot(lx, ly) < reach && Math.abs(h) < 1.5) {
        onFloor = true;
        let best = 1e9;
        this.cells.forEach((k, ci) => { const e = Math.hypot(lx - k.lx, ly - k.ly); if (e < best && e < this.pitch * 0.5) { best = e; now = ci; } });
      }
    }
    let change = null;
    if (now >= 0 && now !== this.active && this.moveOf.has(now)) {
      const m = this.moveOf.get(now), first = !this.lit.has(now);
      this.lit.add(now); this.pads[now].lit = true; this.lastMove = m;
      this.drawPanel(m);
      const solved = first && this.lit.size === HIVE_MOVES.length && !this.solved;
      change = { i: m, name: HIVE_MOVES[m], n: m + 1, count: this.lit.size, first, solved, html: `<b>${HIVE_MOVES[m]}</b> · ${this.lit.size}/${HIVE_MOVES.length}` };
      if (solved) { this.solved = true; this.rip = 0; if (this.onSolved) this.onSolved(); }
    }
    this.active = now;
    if (this.rip >= 0) { this.rip += dt; if (this.rip > 0.8) this.rip = -1; }
    this.springs(dt, player && (player.height ?? 0) < 0.15 ? now : -1);
    if (this.screen) this.SU.uMix.value = THREE.MathUtils.damp(this.SU.uMix.value, onFloor ? 1 : 0, 5, dt);
    return change;
  }

  /* The pads are springs: x = dip (m, down along the pad's normal), target = 0 at rest, SINK under Blip, SINK_NEAR under the six around him,
     SINK_LIT for a pressed move pad (the larger wins). Semi-implicit Euler, sub-stepped; the solved ripple kicks each pad as its ring goes by. */
  springs(dt, stand) {
    const n = Math.max(1, Math.ceil(dt * 120)), h = Math.min(dt, 0.05) / n, sc = stand >= 0 ? this.cells[stand] : null;
    this.pads.forEach((p, ci) => {
      let tgt = this.lit.has(ci) ? SINK_LIT : 0;
      if (sc) { const k = this.cells[ci], dq = k.q - sc.q, dr = k.r - sc.r, d = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)); tgt = Math.max(tgt, d === 0 ? SINK : d === 1 ? SINK_NEAR : 0); }
      if (this.rip >= 0 && !p.kicked && this.rip >= this.cells[ci].ring * 0.08) { p.kicked = true; p.v += 0.9; }
      if (this.rip < 0) p.kicked = false;
      const ring = this.cells[ci].ring, wave = this.rip >= 0 && this.rip >= ring * 0.08 && this.rip < ring * 0.08 + 0.3;   // the ripple flips the whole pad
      const st = wave ? 3 : p.lit ? 2 : p.move >= 0 ? 1 : 0;
      if (st !== p.state) {
        p.state = st; p.mat.color.set([TONES.cap, TONES.teal, TONES.tealLit, TONES.wave][st]);
        if (p.num) p.num.material.color.set(st === 2 ? TONES.cap : INK);
      }
      for (let i = 0; i < n; i++) { p.v += (-SPRING_K * (p.x - tgt) - SPRING_C * p.v) * h; p.x += p.v * h; }
      p.x = THREE.MathUtils.clamp(p.x, -0.05, 0.12);
      if (Math.abs(p.x - p.drawn) > 1e-5) { p.drawn = p.x; p.mover.position.y = -p.x; p.root.updateMatrixWorld(true); }
    });
  }

  drawAtlas() {
    const g = this.atlas.getContext("2d"); g.clearRect(0, 0, 640, 128);
    g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; g.font = '800 104px "Bricolage Grotesque", system-ui, sans-serif';
    for (let i = 0; i < 5; i++) g.fillText(String(i + 1), i * 128 + 64, 70);
    this.atlasTex.needsUpdate = true;
  }

  /* The grass is scattered after the extras are built, so it does not know about the hive: flatten the tufts
     under the honeycomb (zero-scale their instances). Called once, from the host's frame loop, when grass exists. */
  clearGrass(grass) {
    if (!grass || !grass.mesh || this.grassDone) return;
    this.grassDone = true;
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), zero = new THREE.Vector3(0, 0, 0);
    const reach = this.Rp * 1.16 + 0.3, f = this.frame;
    for (let i = 0; i < grass.mesh.count; i++) {
      grass.mesh.getMatrixAt(i, m); m.decompose(p, q, s);
      const d = p.clone().sub(this.centre);
      if (Math.hypot(d.dot(f.x), d.dot(f.f)) < reach && Math.abs(d.dot(f.n)) < 2) { m.compose(p, q, zero); grass.mesh.setMatrixAt(i, m); }
    }
    grass.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.group);
    if (this.supports) for (const m of [this.plate, ...this.pads.map(p => p.cap)]) { const i = this.supports.indexOf(m); if (i >= 0) this.supports.splice(i, 1); }
    for (const g of this.geos) g.dispose(); for (const m of this.mats) m.dispose(); this.ramp.dispose(); this.atlasTex.dispose();
    if (this.screen && this._origMat) { this.screen.material.dispose(); this.screen.material = this._origMat; }
    if (this.panelTex) this.panelTex.dispose();
  }
}
