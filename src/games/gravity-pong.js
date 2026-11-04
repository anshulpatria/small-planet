/* Gravity Pong - "Curve a shot into the blue ring".
   Pure logic (stepBall, simulateShot, solveShot, randomWells) is exported for Node tests. */
import * as THREE from "three";

/* ------------------------------------------------------------------ logic */
export const COURT = { minX: -3.3, maxX: 3.3, minZ: -7.4, maxZ: 1.5, y: 0.5 };
export const BALL_R = 0.2;
export const LAUNCH = { x: 0, z: 0.55 };
export const GOAL = { x: 1.9, z: -6.45, r: 0.62 };
export const PHYS = { wellK: 30, wellR: 1.9, soft: 0.45, friction: 0.16, restitution: 0.82, maxSpeed: 11, bumperRest: 0.9, bumperKick: 2.8 };
export const PULL = { k: 3.6, max: 2.6, min: 0.3 };
export const DT = 1 / 120;
/* Round bumpers; the ball bounces off them like pinball posts. */
/* Each leaves >= one ball diameter between bumper and rail so the ball can never wedge. */
export const BUMPERS = [
  { x: -2.3, z: -6.45, r: 0.5 },
  { x: -2.45, z: -0.9, r: 0.4 },
  { x: 2.45, z: -0.9, r: 0.4 },
  { x: 2.5, z: -4.9, r: 0.35 },
];
export const DEFAULT_WELLS = [
  { x: 0.2, z: -3.4, sign: -1 },   // repeller, sits on the straight line to the goal
  { x: 1.75, z: -2.9, sign: 1 },   // attractor, bends shots back toward the goal
];
/* GA1: the FIRST arrangement a visitor meets (same hoop, same bumpers). The attractor sits just short of the
   hoop on the aim line and funnels a roughly-aimed shot in; the repeller leans from the left and nudges the
   ball toward the hoop instead of blocking the line. Every later layout (DEFAULT_WELLS, challengeLayout,
   randomWells) is unchanged. Order matches DEFAULT_WELLS: [repeller, attractor]. */
export const FIRST_WELLS = [
  { x: -1.0, z: -4.6, sign: -1 },
  { x: 1.4, z: -4.2, sign: 1 },
];

/* One fixed step. s = {x,z,vx,vz}. Returns 0 nothing, 1 bounced off a rail, 2 inside goal, 3 bumper.
   On a bounce, s.ik (kind), s.ix/s.iz (unit normal of the surface) and s.ib (bumper index) and s.isp
   (impact speed) describe the last impact for animation. Max travel per step (11/120 = 0.09) is
   far below the ball radius, so nothing can tunnel through a rail or bumper. */
export function stepBall(s, dt, wells, goal = GOAL, P = PHYS, C = COURT, bumpers = BUMPERS) {
  let ax = 0, az = 0;
  const R2 = P.wellR * P.wellR;
  for (let i = 0; i < wells.length; i++) {
    const w = wells[i];
    const dx = w.x - s.x, dz = w.z - s.z, d2 = dx * dx + dz * dz;
    if (d2 >= R2) continue;
    const d = Math.sqrt(d2);
    const f = 1 - d / P.wellR;
    const m = (w.sign * P.wellK * f) / Math.max(d, P.soft);
    ax += dx * m; az += dz * m;
  }
  s.vx += ax * dt; s.vz += az * dt;
  const damp = Math.max(0, 1 - P.friction * dt);
  s.vx *= damp; s.vz *= damp;
  const sp2 = s.vx * s.vx + s.vz * s.vz;
  if (sp2 > P.maxSpeed * P.maxSpeed) { const k = P.maxSpeed / Math.sqrt(sp2); s.vx *= k; s.vz *= k; }
  s.x += s.vx * dt; s.z += s.vz * dt;
  let hit = 0;
  // bumpers first (corner posts), rails afterwards so the ball can never end outside
  for (let i = 0; i < bumpers.length; i++) {
    const b = bumpers[i];
    const dx = s.x - b.x, dz = s.z - b.z, rr = b.r + BALL_R, d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) continue;
    const d = Math.sqrt(d2) || 1e-6, nx = dx / d, nz = dz / d;
    s.x = b.x + nx * (rr + 0.001); s.z = b.z + nz * (rr + 0.001);
    const vn = s.vx * nx + s.vz * nz;
    if (vn < 0) {
      s.isp = -vn;
      s.vx -= (1 + P.bumperRest) * vn * nx; s.vz -= (1 + P.bumperRest) * vn * nz;
      const out = s.vx * nx + s.vz * nz;
      if (out < P.bumperKick) { s.vx += (P.bumperKick - out) * nx; s.vz += (P.bumperKick - out) * nz; }
      s.ik = 3; s.ix = nx; s.iz = nz; s.ib = i; hit = 3;
    }
  }
  const lo = C.minX + BALL_R, hi = C.maxX - BALL_R, zlo = C.minZ + BALL_R, zhi = C.maxZ - BALL_R;
  const rail = (nx, nz, v) => { s.ik = 1; s.ix = nx; s.iz = nz; s.isp = Math.abs(v); if (hit === 0) hit = 1; };
  if (s.x < lo) { s.x = lo; rail(1, 0, s.vx); s.vx = Math.abs(s.vx) * P.restitution; }
  else if (s.x > hi) { s.x = hi; rail(-1, 0, s.vx); s.vx = -Math.abs(s.vx) * P.restitution; }
  if (s.z < zlo) { s.z = zlo; rail(0, 1, s.vz); s.vz = Math.abs(s.vz) * P.restitution; }
  else if (s.z > zhi) { s.z = zhi; rail(0, -1, s.vz); s.vz = -Math.abs(s.vz) * P.restitution; }
  const gx = s.x - goal.x, gz = s.z - goal.z;
  if (gx * gx + gz * gz < goal.r * goal.r) return 2;
  return hit;
}

/* Launch velocity from the plunger pull vector (pull = pointer - launcher, in xz). */
function pullToVelocity(px, pz, out) {
  let len = Math.hypot(px, pz);
  if (len < PULL.min) { out.vx = 0; out.vz = 0; out.power = 0; return out; }
  const L = Math.min(len, PULL.max);
  out.vx = (-px / len) * L * PULL.k; out.vz = (-pz / len) * L * PULL.k; out.power = L / PULL.max;
  return out;
}

/* Simulate a shot, writing sampled points into `out` (Float32Array, x,z pairs).
   Returns { n, goal }. */
export function simulateShot(vx, vz, wells, out, seconds = 2.8, every = 8, goal = GOAL) {
  const s = { x: LAUNCH.x, z: LAUNCH.z, vx, vz };
  const steps = Math.floor(seconds / DT), cap = out.length >> 1;
  let n = 0, scored = false;
  for (let i = 0; i < steps && n < cap; i++) {
    const r = stepBall(s, DT, wells, goal);
    if (r === 2) { out[n * 2] = s.x; out[n * 2 + 1] = s.z; n++; scored = true; break; }
    if (i % every === every - 1) { out[n * 2] = s.x; out[n * 2 + 1] = s.z; n++; }
  }
  return { n, goal: scored };
}

/* Search for any shot that scores; returns {vx, vz} or null. Used for the "assist" hint. */
export function solveShot(wells, goal = GOAL) {
  const tmp = new Float32Array(128);
  let best = null, bestScore = -1;
  for (let a = -70; a <= 70; a += 1) {
    for (let sp = 4; sp <= 9.4; sp += 0.6) {
      const ang = (a * Math.PI) / 180;
      const vx = Math.sin(ang) * sp, vz = -Math.cos(ang) * sp;
      if (simulateShot(vx, vz, wells, tmp, 3, 8, goal).goal) {
        // prefer shots that are not just a straight line and have moderate power
        const score = 10 - Math.abs(sp - 7) - Math.abs(a) * 0.01;
        if (score > bestScore) { bestScore = score; best = { vx, vz }; }
      }
    }
  }
  return best;
}

/* Random well layout, kept apart from each other, the goal and the launcher. */
export function randomWells(rng = Math.random, goal = GOAL) {
  for (let tries = 0; tries < 60; tries++) {
    const a = { x: (rng() * 2 - 1) * 1.8, z: -1.9 - rng() * 3.4, sign: 1 };
    const b = { x: (rng() * 2 - 1) * 1.8, z: -1.9 - rng() * 3.4, sign: -1 };
    const ok = (w) => Math.hypot(w.x - goal.x, w.z - goal.z) > 1.8 && Math.hypot(w.x - LAUNCH.x, w.z - LAUNCH.z) > 2.2;
    if (Math.hypot(a.x - b.x, a.z - b.z) > 2.4 && ok(a) && ok(b)) return [a, b];
  }
  return [{ ...DEFAULT_WELLS[0] }, { ...DEFAULT_WELLS[1] }];
}

/* ------------------------------------------------------- challenge logic */
const CHALLENGE = { seconds: 30, previewFrac: 0.4, curveBonus: 2, bankBonus: 1, maxMult: 3, reloadFade: 0.2, reloadSink: 0.22 };
export const BEST_KEY = "gravityPong.best";

/* Combo multiplier from the number of goals already scored in a row: 1,1,2,2,3,3... */
export function comboMult(streak) { return Math.min(CHALLENGE.maxMult, 1 + Math.floor(Math.max(0, streak) / 2)); }
/* Per-step flight bookkeeping: flags = { banks, fieldA, fieldB }. A well "field" is entered inside wellR. */
export function newFlags() { return { banks: 0, fieldA: false, fieldB: false }; }
function trackFlight(flags, s, wells, hit) {
  if (hit === 3) flags.banks++;
  const R2 = PHYS.wellR * PHYS.wellR;
  for (let i = 0; i < wells.length; i++) {
    const dx = wells[i].x - s.x, dz = wells[i].z - s.z;
    if (dx * dx + dz * dz < R2) { if (wells[i].sign > 0) flags.fieldA = true; else flags.fieldB = true; }
  }
  return flags;
}
/* Bonus for a scoring shot: curved through both wells' fields (+2) and/or banked off a bumper (+1). */
export function shotBonus(flags) {
  const curve = !!(flags.fieldA && flags.fieldB), bank = flags.banks >= 1;
  let bonus = 0, tag = "";
  if (curve) { bonus += CHALLENGE.curveBonus; tag = "CURVE"; }
  if (bank) { bonus += CHALLENGE.bankBonus; tag = tag ? tag + " + BANK" : "BANK"; }
  return { bonus, tag };
}
export function bestUpdate(best, score) { return score > best ? { best: score, isNew: true } : { best, isNew: false }; }
export function newRound(best = 0) { return { phase: "run", left: CHALLENGE.seconds, score: 0, streak: 0, goals: 0, best, newBest: false }; }
export function finishRound(r) {
  r.phase = "over"; r.left = 0;
  const u = bestUpdate(r.best, r.score); r.best = u.best; r.newBest = u.isNew; return r;
}
export function tickRound(r, dt) {
  if (r.phase !== "run") return r;
  r.left = Math.max(0, r.left - dt);
  if (r.left <= 0) finishRound(r);
  return r;
}
/* A goal in a running round: (1 + bonus) * combo multiplier. Returns the pop-up description. */
export function scoreGoal(r, flags) {
  const { bonus, tag } = shotBonus(flags), mult = comboMult(r.streak), base = 1 + bonus, points = base * mult;
  r.score += points; r.streak++; r.goals++;
  return { points, base, bonus, mult, tag, text: bonus > 0 ? `+${bonus} ${tag}!` : `+${points}`, sub: mult > 1 ? `COMBO x${mult}` : "" };
}
export function missShot(r) { r.streak = 0; return r; }
export function loadBest(storage) {
  try { const st = storage !== undefined ? storage : globalThis.localStorage; const v = parseInt(st.getItem(BEST_KEY), 10); return Number.isFinite(v) && v > 0 ? v : 0; } catch (e) { return 0; }
}
export function saveBest(v, storage) {
  try { const st = storage !== undefined ? storage : globalThis.localStorage; st.setItem(BEST_KEY, String(v)); return true; } catch (e) { return false; }
}
/* True if simply aiming at the hoop (any power) already scores. Challenge layouts avoid that so shots need some skill. */
export function straightScores(wells, goal) {
  const dx = goal.x - LAUNCH.x, dz = goal.z - LAUNCH.z, L = Math.hypot(dx, dz), out = new Float32Array(128);
  for (let sp = 4; sp <= 9.6; sp += 0.8) if (simulateShot((dx / L) * sp, (dz / L) * sp, wells, out, 3, 8, goal).goal) return true;
  return false;
}
/* New hoop position + well layout, guaranteed to have a scoring shot. Returns { goal:{x,z,r}, wells:[attractor, repeller], shot }. */
export function challengeLayout(rng = Math.random, prev = null) {
  for (let tries = 0; tries < 120; tries++) {
    const goal = { x: (rng() * 2 - 1) * 2.2, z: -4.7 - rng() * 1.75, r: GOAL.r };
    if (prev && Math.hypot(goal.x - prev.x, goal.z - prev.z) < 1.4) continue;
    if (BUMPERS.some((b) => Math.hypot(b.x - goal.x, b.z - goal.z) < b.r + goal.r + 0.15)) continue;
    const wells = randomWells(rng, goal);
    if (wells[0].sign === wells[1].sign || Math.hypot(wells[0].x - wells[1].x, wells[0].z - wells[1].z) <= 2.3) continue;
    if (tries < 90 && straightScores(wells, goal)) continue;
    const shot = solveShot(wells, goal);
    if (shot) return { goal, wells, shot };
  }
  return { goal: { ...GOAL }, wells: DEFAULT_WELLS.map((w) => ({ ...w })), shot: solveShot(DEFAULT_WELLS, GOAL) };
}

/* --------------------------------------------------------------- geometry */
function rrPath(p, w, d, r) {
  const x = -w / 2, y = -d / 2;
  r = Math.max(0.001, Math.min(r, w / 2 - 0.001, d / 2 - 0.001));
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y); p.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  p.lineTo(x + w, y + d - r); p.absarc(x + w - r, y + d - r, r, 0, Math.PI / 2, false);
  p.lineTo(x + r, y + d); p.absarc(x + r, y + d - r, r, Math.PI / 2, Math.PI, false);
  p.lineTo(x, y + r); p.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return p;
}
/* Rounded slab: footprint w (x) by d (z), height h (y), base at y=0. */
function slabGeo(w, d, h, r, bt, hole) {
  const sh = rrPath(new THREE.Shape(), w - 2 * bt, d - 2 * bt, r - bt);
  if (hole) sh.holes.push(rrPath(new THREE.Path(), hole.w + 2 * bt, hole.d + 2 * bt, hole.r + bt));
  const g = new THREE.ExtrudeGeometry(sh, { depth: h - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bt, bevelSegments: 3, curveSegments: 10 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bt, 0);
  return g;
}
/* Rounded box in the XY plane (faces +z), extruded along z, centred on the origin. */
function boxXY(w, h, d, r, bt) {
  const sh = rrPath(new THREE.Shape(), w - 2 * bt, h - 2 * bt, r - bt);
  const g = new THREE.ExtrudeGeometry(sh, { depth: d - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bt, bevelSegments: 3, curveSegments: 10 });
  g.translate(0, 0, -(d - 2 * bt) / 2);
  return g;
}
function spring1(st, target, dt, k = 300, c = 16) { st.v += ((target - st.x) * k - st.v * c) * dt; st.x += st.v * dt; }

const C = {
  cream: "#F6EBD2", ink: "#1E1F26", signal: "#2B2BEE", coral: "#FF7A62", sun: "#FFC845",
  lilac: "#B9A2F2", teal: "#3FA7A3", field: "#3A2F7A", cyan: "#5ED3E8", cup: "#1A1AA8",
};
export const SIGN = { w: 3.4, h: 1.3, y: 1.55, z: -7.6 };

/* Coach: a ghost hand plays the real gesture (press the ball, drag back, let go) while the real
   plunger and aim dots follow it, then a ghost ball runs the dotted path into the hoop.
   Times in seconds within one demo loop; the ghost ball runs at FLY x real speed. */
const COACH = { fadeIn: 0.35, press: 0.6, drag: 1.5, hold: 2.0, handOut: 0.4, fly: 1.3, rest: 0.8, idle: 6, misses: 2 };
const HAND_SVG = '<svg viewBox="0 0 60 78" width="60" height="78"><g fill="#FBF8F1" stroke="#1E1F26" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">'
  + '<path d="M13 41V9a6 6 0 0 1 12 0v20.5a5.2 5.2 0 0 1 10.2 1.2a5 5 0 0 1 9.6 1.4a4.6 4.6 0 0 1 8.6 2.6C55.2 44 54.6 55 49.5 62.5L48 70H22l-1.5-6.5C15 58.5 7.5 52 5.6 46.6a4.4 4.4 0 0 1 7.4-4.6z"/>'
  + '<path d="M25 29.5v8M35.2 30.7v7M44.8 32.1v6M13 42.6c2.2 3.4 5 5.2 8.6 5.6" fill="none"/>'
  + '<rect x="20.5" y="69" width="29" height="8" rx="2.5" fill="#2B2BEE"/></g></svg>';
const HAND_TIP = { x: 19, y: 3 };   // fingertip inside the hand SVG
const smooth = (k) => THREE.MathUtils.smoothstep(k, 0, 1);

/* ------------------------------------------------------------------- game */
export default class GravityPong {
  static id = "gravity-pong";

  constructor(ctx) {
    this.ctx = ctx;
    this.geos = []; this.mats = []; this.texs = [];
    this.root = new THREE.Group();
    ctx.group.add(this.root);

    const low = !!ctx.lowPower;
    const mat = (o) => { const m = new THREE.MeshStandardMaterial(o); this.mats.push(m); return m; };
    const geo = (g) => { this.geos.push(g); return g; };
    const mesh = (g, m, parent = this.root, shadow = true) => {
      const o = new THREE.Mesh(g, m); o.castShadow = shadow && !low; o.receiveShadow = true; parent.add(o); return o;
    };
    this._mat = mat; this._geo = geo; this._mesh = mesh;
    const cream = mat({ color: C.cream, roughness: 0.6 });
    const lilac = mat({ color: C.lilac, roughness: 0.7 });
    const field = mat({ color: C.field, roughness: 0.85 });
    const coral = mat({ color: C.coral, roughness: 0.5 });
    const inkM = mat({ color: C.ink, roughness: 0.7 });
    const mark = mat({ color: C.cream, roughness: 0.9 });
    this.BY = COURT.y + BALL_R + 0.02;

    // ---- table: lilac foot, deep indigo playfield, chunky cream rails
    const cx = (COURT.minX + COURT.maxX) / 2, cz = (COURT.minZ + COURT.maxZ) / 2;
    const iw = COURT.maxX - COURT.minX, id = COURT.maxZ - COURT.minZ;
    mesh(geo(slabGeo(iw + 1.0, id + 1.0, COURT.y - 0.12, 0.7, 0.07)), lilac).position.set(cx, 0, cz);
    mesh(geo(slabGeo(iw + 0.9, id + 0.9, 0.12, 0.6, 0.04)), field).position.set(cx, COURT.y - 0.12, cz);
    mesh(geo(slabGeo(iw + 0.9, id + 0.9, 0.42, 0.6, 0.09, { w: iw, d: id, r: 0.22 })), cream).position.set(cx, COURT.y, cz);
    // pong-style markings: dashed centre line, centre ring, goal arc (flat slivers 1 cm above the field)
    const dashGeo = geo(new THREE.BoxGeometry(0.24, 0.02, 0.08));
    const nD = 13;
    const dashes = new THREE.InstancedMesh(dashGeo, mark, nD);
    const d0 = new THREE.Object3D();
    for (let i = 0; i < nD; i++) { d0.position.set(-2.4 + i * 0.4, COURT.y + 0.004, cz); d0.updateMatrix(); dashes.setMatrixAt(i, d0.matrix); }
    dashes.receiveShadow = true; this.root.add(dashes); this.dashes = dashes;
    const ring = (r, x, z) => { const t = mesh(geo(new THREE.TorusGeometry(r, 0.035, 6, 56)), mark, this.root, false); t.rotation.x = Math.PI / 2; t.scale.z = 0.3; t.position.set(x, COURT.y, z); return t; };
    ring(0.9, cx, cz);
    this.goalRing = ring(1.15, GOAL.x, GOAL.z);
    ring(0.9, LAUNCH.x, LAUNCH.z);

    // ---- corner bumpers: coral post, cream collar, domed cap (squash on hit)
    this.bumperViews = [];
    const collarGeo = geo(new THREE.CylinderGeometry(1, 1.08, 0.12, 28));
    const postGeo = geo(new THREE.CylinderGeometry(0.84, 0.92, 0.3, 28));
    const capGeo = geo(new THREE.SphereGeometry(0.82, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2));
    for (const b of BUMPERS) {
      const g = new THREE.Group(); g.position.set(b.x, COURT.y, b.z); this.root.add(g);
      const body = new THREE.Group(); g.add(body);
      mesh(collarGeo, cream, g).scale.set(b.r, 1, b.r);
      const cl = g.children[g.children.length - 1]; cl.position.y = 0.06;
      const post = mesh(postGeo, coral, body); post.scale.set(b.r, 1, b.r); post.position.y = 0.27;
      const cap = mesh(capGeo, coral, body); cap.scale.set(b.r, b.r * 0.55, b.r); cap.position.y = 0.42;
      const dot = mesh(geo(new THREE.SphereGeometry(0.11, 12, 8)), cream, body); dot.scale.set(b.r / 0.5, b.r / 0.5 * 0.5, b.r / 0.5); dot.position.set(0, 0.42 + b.r * 0.55 - 0.03, 0);
      this.bumperViews.push({ body, sq: { x: 0, v: 0 } });
    }

    // ---- plunger: coil spring between a fixed back plate and a cup that cradles the ball
    const pad = mesh(geo(new THREE.CylinderGeometry(0.46, 0.5, 0.05, 36)), cream, this.root, false);
    pad.position.set(LAUNCH.x, COURT.y + 0.025, LAUNCH.z);
    this.hintRing = mesh(geo(new THREE.TorusGeometry(0.66, 0.03, 8, 48)), coral, this.root, false);
    this.hintRing.rotation.x = Math.PI / 2; this.hintRing.scale.z = 0.5; this.hintRing.position.set(LAUNCH.x, COURT.y + 0.05, LAUNCH.z);
    this.plunger = new THREE.Group(); this.plunger.position.set(LAUNCH.x, COURT.y, LAUNCH.z); this.root.add(this.plunger);
    this.PL = { rest: 0.24, plate: 0.92, travel: 0.42 };
    const plate = mesh(geo(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 24)), coral, this.plunger);
    plate.rotation.x = Math.PI / 2; plate.position.set(0, 0.2, this.PL.plate + 0.07);
    const knob = mesh(geo(new THREE.SphereGeometry(0.15, 16, 12)), cream, this.plunger);
    knob.position.set(0, 0.2, this.PL.plate + 0.2);
    this.cup = mesh(geo(new THREE.CylinderGeometry(0.2, 0.2, 0.07, 24)), coral, this.plunger);
    this.cup.rotation.x = Math.PI / 2; this.cup.position.y = 0.2;
    this.coils = [];
    const coilGeo = geo(new THREE.TorusGeometry(0.13, 0.032, 8, 20));
    for (let i = 0; i < 7; i++) { const c = mesh(coilGeo, inkM, this.plunger, false); c.position.y = 0.2; this.coils.push(c); }
    this.plungerS = { x: 0, v: 0 }; this.aimYaw = 0;

    // ---- goal: blue hoop around a deeper cup, a chase of lamps, a standing arch
    this.goalGroup = new THREE.Group();
    this.goalGroup.position.set(GOAL.x, COURT.y, GOAL.z);
    this.root.add(this.goalGroup);
    this.hoopMat = mat({ color: C.signal, roughness: 0.4 });
    const hoop = mesh(geo(new THREE.TorusGeometry(GOAL.r - 0.04, 0.1, 14, 48)), this.hoopMat, this.goalGroup);
    hoop.rotation.x = Math.PI / 2; hoop.position.y = 0.1;
    const cupM = mesh(geo(new THREE.CylinderGeometry(GOAL.r - 0.1, GOAL.r - 0.1, 0.05, 40)), mat({ color: C.cup, roughness: 0.7 }), this.goalGroup, false);
    cupM.position.y = 0.012;
    this.bulbOff = mat({ color: C.cream, roughness: 0.5 }); this.bulbOn = mat({ color: C.sun, roughness: 0.4 });
    const bulbGeo = geo(new THREE.SphereGeometry(0.055, 10, 8));
    this.bulbs = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const b = mesh(bulbGeo, this.bulbOff, this.goalGroup, false);
      b.position.set(Math.cos(a) * (GOAL.r - 0.04), 0.2, Math.sin(a) * (GOAL.r - 0.04)); this.bulbs.push(b);
    }
    const arch = mesh(geo(new THREE.TorusGeometry(0.62, 0.07, 12, 40, Math.PI)), this.hoopMat, this.goalGroup);
    arch.position.set(0, 0.05, -0.78);

    // ---- scoreboard: chunky canvas sign on two posts at the far rail, faces the visitor
    const postG = geo(new THREE.CylinderGeometry(0.1, 0.12, SIGN.y - 0.4 + 0.1, 14));
    for (const sx of [-1.2, 1.2]) mesh(postG, cream).position.set(sx, 0.8 + (SIGN.y - 0.4) / 2 - 0.05 + 0.05, SIGN.z - 0.02);
    const frame = mesh(geo(boxXY(SIGN.w + 0.3, SIGN.h + 0.3, 0.22, 0.3, 0.05)), coral, this.root);
    this.signG = new THREE.Group(); this.signG.position.set(0, 0.8 + SIGN.y, SIGN.z); this.root.add(this.signG);
    frame.parent.remove(frame); this.signG.add(frame);
    this.signCanvas = document.createElement("canvas"); this.signCanvas.width = 768; this.signCanvas.height = 288;
    this.signTex = new THREE.CanvasTexture(this.signCanvas); this.signTex.colorSpace = THREE.SRGBColorSpace; this.texs.push(this.signTex);
    const signMat = new THREE.MeshBasicMaterial({ map: this.signTex }); this.mats.push(signMat);
    const face = new THREE.Mesh(geo(new THREE.PlaneGeometry(SIGN.w, SIGN.h)), signMat);
    face.position.z = 0.125; this.signG.add(face);
    this.signPop = 0;

    // ---- ball (squash group + mesh) and ribbon trail
    this.ballG = new THREE.Group(); this.root.add(this.ballG);
    this.ball = mesh(geo(new THREE.SphereGeometry(BALL_R, 28, 20)), mat({ color: "#FFFFFF", roughness: 0.18, metalness: 0.0 }), this.ballG);
    this.ballG.position.set(LAUNCH.x, this.BY, LAUNCH.z);
    this.ballQ = { x: 0, v: 0 };
    this.TRAIL = 16;
    this.trailGeo = geo(new THREE.BufferGeometry());
    this.trailPos = new Float32Array(this.TRAIL * 2 * 3);
    const idx = [];
    for (let i = 0; i < this.TRAIL - 1; i++) { const A = i * 2, B = i * 2 + 1, Cc = i * 2 + 2, D = i * 2 + 3; idx.push(A, B, Cc, B, D, Cc); }
    this.trailGeo.setAttribute("position", new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.trailGeo.setIndex(idx);
    const trailMat = new THREE.MeshBasicMaterial({ color: C.coral, transparent: true, opacity: 0.7, depthWrite: false }); this.mats.push(trailMat);
    this.trail = new THREE.Mesh(this.trailGeo, trailMat); this.trail.frustumCulled = false; this.trail.renderOrder = 2; this.root.add(this.trail);
    this.trailPts = new Float32Array(this.TRAIL * 2); this.trailN = 0; this.trailClock = 0;

    // ---- dotted aim preview (cream dots read on the indigo field)
    const dotGeo = geo(new THREE.SphereGeometry(0.075, 10, 8));
    this.DOTS = 48;
    this.dots = new THREE.InstancedMesh(dotGeo, mat({ color: C.cream, roughness: 0.5 }), this.DOTS);
    this.dots.frustumCulled = false; this.root.add(this.dots);
    // ghost ball for the coach demo (flat, see-through, never inked)
    const ghostMat = new THREE.MeshBasicMaterial({ color: "#FFFFFF", transparent: true, opacity: 0.85, depthWrite: false }); this.mats.push(ghostMat);
    this.ghost = new THREE.Mesh(geo(new THREE.SphereGeometry(BALL_R, 20, 14)), ghostMat);
    this.ghost.position.set(LAUNCH.x, this.BY, LAUNCH.z); this.ghost.visible = false; this.ghost.renderOrder = 3; this.root.add(this.ghost);

    // ---- wells: soft contracting / expanding rings around a solid-looking core
    this.wells = [
      { x: FIRST_WELLS[0].x, z: FIRST_WELLS[0].z, sign: -1, tx: FIRST_WELLS[0].x, tz: FIRST_WELLS[0].z },
      { x: FIRST_WELLS[1].x, z: FIRST_WELLS[1].z, sign: 1, tx: FIRST_WELLS[1].x, tz: FIRST_WELLS[1].z },
    ];
    this.wellViews = [];
    const ringGeo = geo(new THREE.RingGeometry(0.955, 1, 64));
    const coreGeo = geo(new THREE.SphereGeometry(0.3, 24, 16));
    const baseGeo = geo(new THREE.CylinderGeometry(0.42, 0.48, 0.08, 32));
    const RINGS = 4;
    for (const w of this.wells) {
      const colour = w.sign > 0 ? C.sun : C.cyan;
      const g = new THREE.Group(); this.root.add(g);
      const tex = this.radialTexture(colour); this.texs.push(tex);
      const disc = mesh(geo(new THREE.CircleGeometry(PHYS.wellR, 48)),
        mat({ map: tex, transparent: true, opacity: 0.4, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), g, false);
      disc.rotation.x = -Math.PI / 2; disc.position.y = COURT.y + 0.008; disc.receiveShadow = false;
      const rings = [];
      for (let k = 0; k < RINGS; k++) {
        const rm = mat({ color: colour, transparent: true, opacity: 0.5, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
        const r = mesh(ringGeo, rm, g, false); r.rotation.x = -Math.PI / 2; r.position.y = COURT.y + 0.014 + k * 0.001; r.receiveShadow = false;
        rings.push({ mesh: r, mat: rm });
      }
      const wm = mat({ color: colour, roughness: 0.4 });
      mesh(baseGeo, cream, g).position.y = COURT.y + 0.04;
      const core = mesh(coreGeo, wm, g); core.position.y = COURT.y + 0.3;
      let extra = null;
      if (w.sign > 0) { extra = mesh(geo(new THREE.TorusGeometry(0.42, 0.05, 8, 32)), wm, g, false); extra.rotation.x = Math.PI / 2; extra.position.y = COURT.y + 0.3; }
      else { extra = mesh(geo(new THREE.ConeGeometry(0.17, 0.34, 4)), wm, g, false); extra.position.y = COURT.y + 0.68; }
      this.wellViews.push({ g, core, extra, rings, sign: w.sign, dip: 0 });
    }
    this.syncWells();

    // ---- ripples (rail / bumper / goal) and confetti-lite pools
    this.ripples = [];
    const rpGeo = geo(new THREE.RingGeometry(0.8, 1, 32));
    for (let i = 0; i < 5; i++) {
      const m = mat({ color: C.cream, transparent: true, opacity: 0, depthWrite: false, roughness: 1 });
      const r = mesh(rpGeo, m, this.root, false); r.rotation.x = -Math.PI / 2; r.visible = false; r.receiveShadow = false;
      this.ripples.push({ mesh: r, mat: m, t: 1 });
    }
    this.confMats = [C.coral, C.sun, C.lilac, C.teal].map((c) => mat({ color: c, roughness: 0.5 }));
    const confGeos = [geo(new THREE.BoxGeometry(0.14, 0.04, 0.09)), geo(new THREE.TetrahedronGeometry(0.08)), geo(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 6))];
    this.conf = [];
    for (let i = 0; i < 14; i++) {
      const m = mesh(confGeos[i % 3], this.confMats[i % 4], this.root, false); m.visible = false;
      m.position.set(GOAL.x, COURT.y, GOAL.z); this.conf.push({ mesh: m, vx: 0, vy: 0, vz: 0, sx: 0, sz: 0, t: 9 });
    }
    this.confLive = false; this.fxSeed = 7;

    // ---- sim state
    this.ballS = { x: LAUNCH.x, z: LAUNCH.z, vx: 0, vz: 0 };
    this.mode = "ready"; // ready | flying | sink | fade
    this.life = 0; this.modeT = 0; this.acc = 0; this.slow = 0;
    this.ballScale = 1;
    this.pullX = 0; this.pullZ = 0; this.aiming = false;
    this.goals = 0; this.misses = 0; this.free = false; this.focused = false;
    this.prevPts = new Float32Array(this.DOTS * 2); this.prevN = 0;
    this.assist = null; this.launchOff = { x: 0, z: 0 };
    this._tmpV = { vx: 0, vz: 0, power: 0 };
    this._dummy = new THREE.Object3D();
    this._inv = new THREE.Matrix4(); this._ray = new THREE.Ray(); this._hit = new THREE.Vector3();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(COURT.y + BALL_R));
    this.goalPulse = 0; this.goalLit = 0;
    // mutable goal (the hoop moves in challenge mode) and challenge state
    this.goal = { x: GOAL.x, z: GOAL.z, r: GOAL.r, tx: GOAL.x, tz: GOAL.z };
    this.round = null; this.flags = newFlags(); this.disposed = false; this.pending = null;
    this.popText = ""; this.popSub = ""; this.popT = 0; this.signKey = ""; this.statusKey = "";
    this.best = loadBest();
    this.coach = { el: null, on: false, t: 0, idle: 0, misses: 0, scored: false, held: false, still: false, pull: null, pullV: { x: 0, z: 0 }, power: 0, flyN: 0, shot: null };
    this.coachPts = new Float32Array(this.DOTS * 2);
    this._cv = new THREE.Vector3(); this._focusW = new THREE.Vector3(); this._sa = { x: 0, y: 0 }; this._sb = { x: 0, y: 0 };
    this.buildCoach();
    this.drawSign(true);
    if (typeof document !== "undefined" && document.fonts && document.fonts.load) {
      this._onFonts = () => { if (!this.disposed) this.drawSign(true); };
      Promise.all([document.fonts.load('800 40px "Bricolage Grotesque"')]).then(this._onFonts).catch(() => {});
    }
    this.updatePreview();
  }

  /* Scoreboard canvas: GOALS in free play; TIME + SCORE (+ pop text) during a round; "TIME! n - BEST m" after. */
  drawSign(force) {
    const r = this.round;
    const secs = r ? Math.ceil(r.left - 1e-9) : 0;
    const key = !r ? "free:" + this.goals : r.phase === "run" ? ["run", secs, r.score, this.popT > 0 ? this.popText + this.popSub : "", r.streak, this.best].join("|") : ["over", r.score, r.best, r.newBest].join("|");
    if (!force && key === this.signKey) return;
    this.signKey = key;
    const c = this.signCanvas, g = c.getContext("2d"), W = c.width, H = c.height;
    g.fillStyle = C.ink; g.fillRect(0, 0, W, H);
    g.textAlign = "center"; g.textBaseline = "alphabetic";
    const F = (px) => `800 ${px}px "Bricolage Grotesque", sans-serif`;
    if (!r) {
      g.fillStyle = C.lilac; g.font = F(60); g.fillText("GOALS", W / 2, 78);
      g.fillStyle = C.sun; g.font = F(192); g.fillText(String(this.goals), W / 2, 258);
    } else if (r.phase === "run") {
      g.fillStyle = C.lilac; g.font = F(46); g.fillText("TIME", W * 0.25, 62); g.fillText("SCORE", W * 0.75, 62);
      g.fillStyle = secs <= 5 ? C.coral : C.sun; g.font = F(160); g.fillText(String(secs), W * 0.25, 208);
      g.fillStyle = C.cream; g.fillText(String(r.score), W * 0.75, 208);
      g.fillStyle = C.teal; g.fillRect(W / 2 - 2, 90, 4, 120);
      if (this.popT > 0) {
        g.fillStyle = C.sun; g.font = F(50); g.fillText(this.popText + (this.popSub ? "  " + this.popSub : ""), W / 2, 266);
      } else {
        g.fillStyle = C.lilac; g.font = F(36); g.fillText(r.streak >= 2 ? `COMBO x${comboMult(r.streak)}` : `BEST ${this.best}`, W / 2, 262);
      }
    } else {
      g.fillStyle = C.sun; g.font = F(132); g.fillText(`TIME! ${r.score}`, W / 2, 160);
      g.fillStyle = r.newBest ? C.coral : C.lilac; g.font = F(70); g.fillText(r.newBest ? `NEW BEST ${r.best}!` : `BEST ${r.best}`, W / 2, 248);
    }
    this.signTex.needsUpdate = true;
  }

  radialTexture(hex) {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, hex + "88"); grad.addColorStop(0.6, hex + "33"); grad.addColorStop(1, hex + "00");
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  syncWells() {
    for (let i = 0; i < this.wells.length; i++) this.wellViews[i].g.position.set(this.wells[i].x, 0, this.wells[i].z);
  }
  syncGoal() {
    this.goalGroup.position.set(this.goal.x, COURT.y, this.goal.z);
    this.goalRing.position.set(this.goal.x, COURT.y, this.goal.z);
  }
  /* Jump wells and hoop straight to their targets (used before a launch so physics matches the solver). */
  snapLayout() {
    for (const w of this.wells) { w.x = w.tx; w.z = w.tz; }
    this.goal.x = this.goal.tx; this.goal.z = this.goal.tz;
    this.syncWells(); this.syncGoal();
  }
  layoutSettled() {
    const g = this.goal;
    return Math.abs(g.tx - g.x) + Math.abs(g.tz - g.z) < 0.004 && this.wells.every((w) => Math.abs(w.tx - w.x) + Math.abs(w.tz - w.z) < 0.004);
  }
  setLayout(L) {
    this.wells[0].tx = L.wells[1].x; this.wells[0].tz = L.wells[1].z; // repeller
    this.wells[1].tx = L.wells[0].x; this.wells[1].tz = L.wells[0].z; // attractor
    this.goal.tx = L.goal.x; this.goal.tz = L.goal.z;
    this.assist = null; this.coach.shot = null;
  }

  enter() {
    this.focused = true;
    const pos = new THREE.Vector3(0, 9, 6.2);
    this.ctx.group.updateWorldMatrix(true, false); this._focusW.copy(pos).applyMatrix4(this.ctx.group.matrixWorld);   // where the camera lands
    if (!this.free && this.ctx.isSolved && this.ctx.isSolved()) {   // solved on an earlier visit: the challenge is open, on the classic layout
      this.free = true; this.setLayout({ wells: DEFAULT_WELLS.map((w) => ({ ...w })), goal: GOAL }); this.snapLayout();
    }
    this.pushStatus();
    if (this.coach.el) { this.coach.scored = false; this.showCoach(false); }
    else this.ctx.ui.toast("Pull back from the ball, release, and aim for the blue ring. Gravity will interfere.");
    return { pos, look: new THREE.Vector3(0, 0.4, -3.0) };
  }
  exit() { this.focused = false; this.aiming = false; this.hideCoach(); if (this.round) this.stopChallenge(); this.updatePreview(); }

  /* ------------------------------------------------------------- coach */
  /* DOM overlay: the ghost hand, its drag line and a one-line instruction. Only in a real page. */
  buildCoach() {
    if (typeof document === "undefined" || !document.body || !this.ctx.camera || typeof window === "undefined") return;
    const el = document.createElement("div"); el.className = "gp-coach";
    el.innerHTML = '<svg class="gp-coach-drag" aria-hidden="true"><line/><path d="M-9 -7L0 4L9 -7"/></svg>'
      + '<div class="gp-coach-tap" aria-hidden="true"></div>'
      + '<div class="gp-coach-hand" aria-hidden="true">' + HAND_SVG + '</div>'
      + '<p class="gp-coach-line" role="note"><span class="gp-long">Pull back from the ball, release, and aim for the blue ring. Gravity will interfere.</span><span class="gp-short">Pull back from the ball, then release</span></p>';
    document.body.appendChild(el);
    const q = (s) => el.querySelector(s);
    const c = this.coach;
    c.el = el; c.hand = q(".gp-coach-hand"); c.tap = q(".gp-coach-tap"); c.line = q(".gp-coach-line");
    c.drag = q(".gp-coach-drag"); c.dragLine = q(".gp-coach-drag line"); c.arrow = q(".gp-coach-drag path");
    c.still = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /* gentle = the coach returning after misses or idling: a slower fade in, after a short beat */
  showCoach(gentle) {
    const c = this.coach;
    if (!c.el || c.on) return;
    c.on = true; c.t = gentle ? -0.5 : 0; c.idle = 0; c.misses = 0; c.held = false; c.shot = null;
    c.el.classList.toggle("gp-gentle", !!gentle); c.el.classList.add("gp-on");
    c.el.classList.toggle("gp-still", c.still);
  }
  hideCoach() {
    const c = this.coach;
    c.idle = 0;
    if (!c.on) return;
    c.on = false; c.pull = null; c.power = 0; c.held = false; this.ghost.visible = false;
    c.el.classList.remove("gp-on");
    if (this.mode === "ready" && !this.aiming) this.updatePreview();
  }

  /* local court point -> CSS px on screen */
  toScreen(x, y, z, out) {
    const v = this._cv.set(x, y, z);
    this.ctx.group.localToWorld(v); v.project(this.ctx.camera);
    out.x = (v.x + 1) * 0.5 * window.innerWidth; out.y = (1 - v.y) * 0.5 * window.innerHeight;
    return out;
  }

  updateCoach(dt) {
    const c = this.coach;
    if (!c.el) return;
    // wait for the focus camera to arrive (and any panel to close) before showing anything
    const moving = this.ctx.camera.position.distanceToSquared(this._focusW) > 1.44;
    const away = moving || document.body.classList.contains("panel-open");
    c.el.classList.toggle("gp-away", away);
    if (!c.on) {
      // returns after a couple of misses or a quiet spell at the plunger, until this visit's first goal
      const calm = this.focused && this.mode === "ready" && !this.aiming && !this.round && !c.scored && !away;
      if (!calm) { c.idle = 0; return; }
      c.idle += dt;
      if (c.idle > COACH.idle || c.misses >= COACH.misses) this.showCoach(true);
      return;
    }
    if (away || c.held || this.aiming || this.mode !== "ready" || !this.layoutSettled()) {
      if (c.pull) { c.pull = null; c.power = 0; this.ghost.visible = false; this.updatePreview(); }
      c.hand.style.opacity = c.tap.style.opacity = c.drag.style.opacity = "0"; c.t = 0;
      return;
    }
    if (!c.shot) {
      if (!this.free && this.misses >= 2 && this.assist) c.shot = this.assist;
      else c.shot = solveShot(this.wells, this.goal) || { vx: 0, vz: -7 };
    }
    const fx = -c.shot.vx / PULL.k, fz = -c.shot.vz / PULL.k;
    const T = COACH;
    c.t += dt;
    const u = c.t;
    let k, handA, press;
    if (c.still) { k = 1; handA = 1; press = 1; }
    else {
      const d = Math.max(0, Math.min(1, (u - T.press) / (T.drag - T.press)));
      k = 1 - (1 - d) * (1 - d) * (1 - d);   // ease out: quickly past the weak pulls, settling on the full one
      handA = u < 0 ? 0 : u < T.hold ? smooth(u / T.fadeIn) : 1 - smooth((u - T.hold) / T.handOut);
      press = u < T.hold ? smooth((u - T.fadeIn) / (T.press - T.fadeIn)) : 1 - smooth((u - T.hold) / 0.15);
    }
    const released = !c.still && u >= T.hold;
    // the real plunger and aim dots follow the ghost hand
    const px = fx * k, pz = fz * k;
    if (!c.pull || c.pull.x !== px || c.pull.z !== pz) {
      c.pull = c.pullV; c.pull.x = px; c.pull.z = pz;
      this.updatePreview();
    }
    if (released && c.power > 0) {
      this.plungerS.v -= 9 * c.power; c.power = 0;
      this.coachPts.set(this.prevPts); c.flyN = this.prevN;
    } else if (!released) c.power = Math.min(1, Math.hypot(px, pz) / PULL.max);
    // ghost ball runs the dotted path at the shot's real pace (15 samples a second)
    const flyT = c.flyN > 1 ? (c.flyN / 15) / T.fly : 0;
    if (released) {
      const f = (u - T.hold) * 15 * T.fly;
      if (f < c.flyN - 1) {
        const i = Math.floor(f), a = f - i, P = this.coachPts;
        const x0 = i === 0 ? LAUNCH.x : P[(i - 1) * 2], z0 = i === 0 ? LAUNCH.z : P[(i - 1) * 2 + 1];
        this.ghost.position.set(x0 + (P[i * 2] - x0) * a, this.BY, z0 + (P[i * 2 + 1] - z0) * a);
        this.ghost.visible = true;
      } else if (this.ghost.visible) { this.ghost.visible = false; if (this.prevGoal) this.goalPulse = 0.6; }
      if (u > T.hold + flyT + T.rest) { c.t = 0; c.flyN = 0; }
    }
    // hand: fingertip on the ball, then on the drag point (the plunger pull, at ball height)
    const a = this.toScreen(LAUNCH.x, this.BY, LAUNCH.z, this._sa);
    const kb = released ? 1 : k, b = this.toScreen(LAUNCH.x + fx * kb, this.BY, LAUNCH.z + fz * kb, this._sb);
    b.y = Math.min(b.y, window.innerHeight - 80);   // the whole hand stays on screen
    // the still diagram keeps the hand pressing the ball, with an arrow showing the way to drag
    const s = 1 - 0.1 * press, h = c.still ? a : b;
    c.hand.style.transform = `translate(${(h.x - HAND_TIP.x * s).toFixed(1)}px,${(h.y - HAND_TIP.y * s).toFixed(1)}px) scale(${s.toFixed(3)})`;
    c.hand.style.opacity = handA.toFixed(3);
    // tap ring under the fingertip as it presses
    const tp = c.still ? 0 : smooth((u - T.fadeIn) / 0.5);
    c.tap.style.transform = `translate(${a.x.toFixed(1)}px,${a.y.toFixed(1)}px) scale(${(0.4 + tp * 0.9).toFixed(3)})`;
    c.tap.style.opacity = (u > T.fadeIn && tp < 1 ? 0.8 * (1 - tp) : 0).toFixed(3);
    // dashed drag line from the ball to the fingertip, with an arrowhead in the still diagram
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    c.drag.style.opacity = (L > 12 ? handA : 0).toFixed(3);
    c.dragLine.setAttribute("x1", a.x.toFixed(1)); c.dragLine.setAttribute("y1", a.y.toFixed(1));
    c.dragLine.setAttribute("x2", b.x.toFixed(1)); c.dragLine.setAttribute("y2", b.y.toFixed(1));
    if (c.still && L > 12) c.arrow.setAttribute("transform", `translate(${b.x.toFixed(1)},${b.y.toFixed(1)}) rotate(${(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI - 90).toFixed(1)})`);
    // instruction: beside the ball where there is room, else centred under the top bar
    const W = window.innerWidth, lw = c.line.offsetWidth, lh = c.line.offsetHeight;
    let lx = a.x + 64, ly = a.y - lh / 2;
    if (lx + lw > W - 16) { lx = (W - lw) / 2; ly = 112; }
    c.line.style.transform = `translate(${Math.round(lx)}px,${Math.round(ly)}px)`;
  }

  pushStatus(tools = true) {
    const r = this.round;
    if (r && r.phase === "run") {
      this.ctx.ui.status(`${Math.ceil(r.left - 1e-9)}s · ${r.score} pts${comboMult(r.streak) > 1 ? " · combo x" + comboMult(r.streak) : ""}`);
    } else if (r) {
      this.ctx.ui.status(`Time! Score ${r.score} · best ${r.best}${r.newBest ? " (new!)" : ""}`);
    } else {
      this.ctx.ui.status(this.free ? `Goals: ${this.goals}` : "Curve a shot into the blue ring");
    }
    if (tools) this.pushTools();
  }
  pushTools() {
    const r = this.round;
    if (!this.free) this.ctx.ui.tools([]);
    else if (!r) this.ctx.ui.tools([{ label: "Move the wells", onClick: () => this.moveWells() }, { label: "Play 30s challenge", onClick: () => this.startChallenge() }]);
    else if (r.phase === "run") this.ctx.ui.tools([{ label: "Free play", onClick: () => this.stopChallenge() }]);
    else this.ctx.ui.tools([{ label: "Play again", onClick: () => this.startChallenge() }, { label: "Free play", onClick: () => this.stopChallenge() }]);
  }

  moveWells() {
    const n = randomWells(Math.random, this.goal);
    this.setLayout({ wells: n, goal: this.goal });
  }

  /* --------------------------------------------------------- challenge */
  startChallenge() {
    this.best = Math.max(this.best, loadBest());
    this.round = newRound(this.best);
    this.setLayout(challengeLayout(Math.random, this.goal));
    this.popText = "LET’S GO!"; this.popSub = ""; this.popT = 1; this.goalLit = 0; this.goalPulse = 0;
    this.pending = null; this.aiming = false; this.flags = newFlags();
    if (this.mode !== "ready") { this.mode = "fade"; this.modeT = 0; }
    this.signPop = 1; this.drawSign(true); this.updatePreview(); this.statusKey = ""; this.pushStatus();
  }
  stopChallenge() {
    this.round = null; this.pending = null; this.popT = 0;
    this.setLayout({ wells: DEFAULT_WELLS.map((w) => ({ ...w })), goal: GOAL });
    this.goal.r = GOAL.r;
    this.drawSign(true); this.updatePreview(); this.statusKey = ""; this.pushStatus();
  }
  roundOver() {
    const r = this.round;
    if (r.newBest) saveBest(r.best);
    this.best = r.best; this.aiming = false; this.pending = null;
    if (this.mode === "flying") { this.mode = "fade"; this.modeT = 0; }
    this.signPop = 1; this.popT = 0; this.drawSign(true); this.updatePreview(); this.statusKey = ""; this.pushStatus();
    this.ctx.ui.toast(r.newBest && r.score > 0 ? `New best: ${r.score}` : `Time! ${r.score} points`);
  }

  /* ------------------------------------------------------------ preview */
  currentPull() {
    if (this.aiming) return { x: this.pullX, z: this.pullZ };
    if (this.coach.pull) return this.coach.pull;
    if (!this.free && this.misses >= 2) {
      if (!this.assist) this.assist = solveShot(this.wells, this.goal) || { vx: 0, vz: -7 };
      return { x: -this.assist.vx / PULL.k, z: -this.assist.vz / PULL.k, assist: true };
    }
    return { x: 0, z: 1.6 };
  }

  updatePreview() {
    const p = this.currentPull();
    pullToVelocity(p.x, p.z, this._tmpV);
    const r = simulateShot(this._tmpV.vx, this._tmpV.vz, this.wells, this.prevPts, 2.8, 8, this.goal);
    if (this.round) r.n = Math.max(1, Math.ceil(r.n * CHALLENGE.previewFrac)); // challenge: only the first ~40% of the path
    this.prevN = r.n; this.prevGoal = r.goal;
    const hide = this.mode !== "ready" || this._tmpV.power === 0;
    const d = this._dummy;
    for (let i = 0; i < this.DOTS; i++) {
      if (i < r.n && !hide) {
        const f = 1 - i / this.DOTS;
        d.position.set(this.prevPts[i * 2], COURT.y + 0.06, this.prevPts[i * 2 + 1]);
        d.scale.setScalar(0.5 + 0.9 * f);
      } else { d.position.set(0, -5, 0); d.scale.setScalar(0.0001); }
      d.updateMatrix(); this.dots.setMatrixAt(i, d.matrix);
    }
    this.dots.instanceMatrix.needsUpdate = true;
  }

  /* ------------------------------------------------------------ pointer */
  planePoint(e) {
    this.ctx.group.updateWorldMatrix(true, false);
    this._inv.copy(this.ctx.group.matrixWorld).invert();
    this._ray.copy(e.ray).applyMatrix4(this._inv);
    return this._ray.intersectPlane(this._plane, this._hit);
  }

  pointer(e) {
    if (e.type === "up") { if (this.aiming) this.release(); return; }
    const p = this.planePoint(e);
    if (e.type === "down") {
      this.coach.idle = 0;
      if (!p || this.mode !== "ready" || (this.round && this.round.phase === "over")) return;
      if (Math.hypot(p.x - LAUNCH.x, p.z - LAUNCH.z) < 1.5) { this.coach.held = true; this.coach.pull = null; this.ghost.visible = false; this.aiming = true; this.setPull(p); }
      return;
    }
    if (e.type === "move" && this.aiming && p) {
      if (!e.down) { this.release(); return; }
      this.setPull(p);
    }
  }

  setPull(p) {
    let px = p.x - LAUNCH.x, pz = p.z - LAUNCH.z;
    if (pz < 0) pz = 0; // a plunger only pulls back toward the visitor
    const len = Math.hypot(px, pz);
    if (len > PULL.max) { px *= PULL.max / len; pz *= PULL.max / len; }
    this.pullX = px; this.pullZ = pz;
    this.updatePreview();
  }


  release() {
    this.aiming = false; this.coach.held = false;
    pullToVelocity(this.pullX, this.pullZ, this._tmpV);
    if (this._tmpV.power === 0) { this.updatePreview(); return; }
    // GA1 G1: hideCoach() and updatePreview() reuse _tmpV for the idle preview pull, so read the shot first
    let vx = this._tmpV.vx, vz = this._tmpV.vz, power = this._tmpV.power;
    this.hideCoach();   // the first real shot puts the coach away
    if (!this.layoutSettled()) { this.snapLayout(); pullToVelocity(this.pullX, this.pullZ, this._tmpV); vx = this._tmpV.vx; vz = this._tmpV.vz; power = this._tmpV.power; }
    const s = this.ballS;
    this.flags = newFlags();
    s.x = LAUNCH.x; s.z = LAUNCH.z; s.vx = vx; s.vz = vz;
    this.launchOff.x = this.ballG.position.x - LAUNCH.x; this.launchOff.z = this.ballG.position.z - LAUNCH.z;   // GA1 G2: the ball is drawn from the cup and glides onto the sim path over 0.3 s
    this.plungerS.v -= 9 * power; // snap forward with a little overshoot
    this.mode = "flying"; this.life = 0; this.slow = 0; this.acc = 0;
    this.trailN = 0; this.trailClock = 0;
    this.updatePreview();
  }

  /* ------------------------------------------------------------- effects */
  rnd() { this.fxSeed = (this.fxSeed * 1664525 + 1013904223) >>> 0; return this.fxSeed / 4294967296; }

  ripple(x, z, size, colour) {
    let r = this.ripples[0];
    for (const q of this.ripples) if (q.t > r.t) r = q;
    r.t = 0; r.size = size; r.mesh.scale.setScalar(0.1); r.mesh.position.set(x, COURT.y + 0.02, z); r.mesh.visible = true; r.mat.color.set(colour || C.cream);
  }

  burst() {
    for (const p of this.conf) {
      const a = this.rnd() * Math.PI * 2, sp = 1.2 + this.rnd() * 1.6;
      p.mesh.position.set(this.goal.x, COURT.y + 0.3, this.goal.z);
      p.vx = Math.cos(a) * sp; p.vz = Math.sin(a) * sp; p.vy = 3.4 + this.rnd() * 2.4;
      p.sx = (this.rnd() - 0.5) * 14; p.sz = (this.rnd() - 0.5) * 14; p.t = 0; p.mesh.visible = true;
    }
    this.confLive = true;
  }

  impact(s) {
    const q = Math.min(1, (s.isp || 4) / 7);
    if (s.ik === 3) {
      this.bumperViews[s.ib].sq.v += 9 * (0.5 + q);
      this.ripple(this.ballG.position.x, this.ballG.position.z, 0.5, C.coral);
    } else {
      this.ripple(this.ballG.position.x, this.ballG.position.z, 0.4, C.cream);
    }
    this.ballQ.v += 7 * (0.4 + q); this.squashN = Math.atan2(s.ix, s.iz);
  }

  updateFx(dt) {
    let live = false;
    for (const r of this.ripples) {
      if (r.t >= 1) { if (r.mesh.visible) { r.mesh.visible = false; r.mesh.scale.setScalar(0.1); } continue; }
      r.t = Math.min(1, r.t + dt * 2.8); live = true;
      r.mesh.scale.setScalar(0.1 + r.size * r.t); r.mat.opacity = 0.7 * (1 - r.t);
    }
    if (this.confLive) {
      let any = false;
      for (const p of this.conf) {
        if (p.t >= 1.1) { if (p.mesh.visible) { p.mesh.visible = false; p.mesh.position.set(GOAL.x, COURT.y, GOAL.z); } continue; }
        p.t += dt; any = true; p.vy -= 9 * dt;
        const m = p.mesh; m.position.x += p.vx * dt; m.position.y += p.vy * dt; m.position.z += p.vz * dt;
        m.rotation.x += p.sx * dt; m.rotation.z += p.sz * dt;
        m.scale.setScalar(Math.max(0.001, Math.min(1, (1.1 - p.t) * 4)));
        if (m.position.y < COURT.y + 0.03) { m.position.y = COURT.y + 0.03; p.vy = Math.abs(p.vy) * 0.3; p.vx *= 0.6; p.vz *= 0.6; }
      }
      this.confLive = any; live = live || any;
    }
    return live;
  }

  /* ------------------------------------------------------------- update */
  update(dt, t, focused) {
    dt = Math.min(dt, 0.05);
    // wells ease toward targets
    const ease = 1 - Math.exp(-(this.round ? 12 : 6) * dt);
    let moved = false;
    const gl = this.goal;
    if (Math.abs(gl.tx - gl.x) > 0.002 || Math.abs(gl.tz - gl.z) > 0.002) { gl.x += (gl.tx - gl.x) * ease; gl.z += (gl.tz - gl.z) * ease; this.syncGoal(); moved = true; }
    for (let i = 0; i < 2; i++) {
      const w = this.wells[i];
      if (Math.abs(w.tx - w.x) > 0.002 || Math.abs(w.tz - w.z) > 0.002) { w.x += (w.tx - w.x) * ease; w.z += (w.tz - w.z) * ease; moved = true; }
    }
    if (moved) { this.syncWells(); if (this.mode === "ready") this.updatePreview(); }
    this.tickChallenge(dt);
    const fxLive = (this.round && this.round.phase === "run") || this.popT > 0 || this.confLive || this.ripples.some((r) => r.t < 1) || this.goalLit > 0.002 || this.signPop > 0.002;
    if (!focused && this.mode === "ready" && !moved && !fxLive) return;

    // wells: attractor rings contract inward, repeller rings pulse outward
    for (let i = 0; i < 2; i++) {
      const v = this.wellViews[i], n = v.rings.length;
      for (let k = 0; k < n; k++) {
        const ph = (t * 0.4 + k / n + i * 0.3) % 1;
        const rad = Math.max(0.12, (v.sign > 0 ? 1 - ph : ph) * PHYS.wellR);
        v.rings[k].mesh.scale.setScalar(rad);
        v.rings[k].mat.opacity = 0.5 * Math.sin(ph * Math.PI);
      }
      const br = 1 + Math.sin(t * 3 + i) * 0.06 * (v.sign > 0 ? -1 : 1);
      // GA1 G5: the solid core and its ring/cone sink into the playfield while the ball rolls over the well
      let dip = 0;
      if (this.mode === "flying") { const w = this.wells[i], bd = Math.hypot(this.ballS.x - w.x, this.ballS.z - w.z); dip = Math.max(0, Math.min(1, (0.85 - bd) / 0.35)); dip = dip * dip * (3 - 2 * dip); }
      v.dip += (dip - v.dip) * (1 - Math.exp(-24 * dt));
      v.core.position.y = COURT.y + 0.3 - v.dip * 0.9; v.extra.position.y = (v.sign > 0 ? COURT.y + 0.3 : COURT.y + 0.68) - v.dip * 0.9;
      v.core.scale.setScalar(br);
      if (v.sign > 0) v.extra.rotation.z = t * 0.8; else v.extra.rotation.y = t * 1.2;
    }
    this.hintRing.scale.set(1 + Math.sin(t * 3) * 0.06, 1 + Math.sin(t * 3) * 0.06, 0.5);
    this.hintRing.visible = this.mode === "ready" && !this.aiming;
    this.updateCoach(dt);

    // goal: pop + lamp chase + hoop lights up
    if (this.goalPulse > 0) this.goalPulse = Math.max(0, this.goalPulse - dt * 1.6);
    this.goalLit = Math.max(0, this.goalLit - dt * 0.5);
    this.goalGroup.scale.setScalar(1 + Math.sin(this.goalPulse * Math.PI) * 0.18);
    this.hoopMat.color.set(C.signal).lerp(this._sun || (this._sun = new THREE.Color(C.sun)), Math.min(1, this.goalLit * 1.4));
    for (let i = 0; i < 8; i++) {
      const on = this.goalLit > 0.002 ? ((Math.floor(t * 14) + i) % 8) < 4 : (i === Math.floor(t * 2) % 8);
      this.bulbs[i].material = on ? this.bulbOn : this.bulbOff;
    }
    this.signPop = Math.max(0, this.signPop - dt * 2);
    this.signG.scale.setScalar(1 + Math.sin(this.signPop * Math.PI) * 0.1);

    // plunger: pull tied to the drag, springy snap-back on release
    const power = this.aiming ? Math.min(1, Math.hypot(this.pullX, this.pullZ) / PULL.max) : this.coach.power;
    spring1(this.plungerS, power, dt, 420, 15);
    const cp = this.coach.pull, yawT = this.aiming && power > 0.05 ? Math.atan2(this.pullX, this.pullZ) : cp && power > 0.05 ? Math.atan2(cp.x, cp.z) : 0;
    if (this.aiming) this.aimYaw += (yawT - this.aimYaw) * (1 - Math.exp(-20 * dt));
    else this.aimYaw += (0 - this.aimYaw) * (1 - Math.exp(-6 * dt));
    this.plunger.rotation.y = this.aimYaw;
    const off = this.PL.travel * Math.max(-0.35, Math.min(1, this.plungerS.x));
    this.cup.position.z = off + this.PL.rest + 0.02;
    const z0 = this.cup.position.z + 0.05, z1 = this.PL.plate;
    for (let i = 0; i < this.coils.length; i++) this.coils[i].position.z = z0 + ((i + 0.5) / this.coils.length) * (z1 - z0);

    // simulation (fixed 120 Hz)
    const s = this.ballS;
    if (this.mode === "flying") {
      this.life += dt; this.acc += dt;
      let n = 0;
      this.ballG.position.set(s.x, this.BY, s.z);
      while (this.acc >= DT && n++ < 12) {
        this.acc -= DT;
        const r = stepBall(s, DT, this.wells, this.goal);
        trackFlight(this.flags, s, this.wells, r);
        if (r === 1 || r === 3) { this.ballG.position.set(s.x, this.BY, s.z); this.impact(s); }
        if (r === 2) { this.score(); break; }
      }
      if (this.mode === "flying") {
        const sp = Math.hypot(s.vx, s.vz);
        this.slow = sp < 0.35 ? this.slow + dt : 0;
        if (this.life > (this.round ? 4.5 : 6) || this.slow > (this.round ? 0.5 : 0.9)) { this.mode = "fade"; this.modeT = 0; }
        const lo = Math.max(0, 1 - this.life / 0.3); this.lo2 = lo;
        // GA1 G3: draw the ball at the sub-step remainder (acc is time since the last 1/120 s step) so frames with 1 or 2 steps move it evenly
        const ex = Math.max(COURT.minX + BALL_R, Math.min(COURT.maxX - BALL_R, s.x + s.vx * this.acc)), ez = Math.max(COURT.minZ + BALL_R, Math.min(COURT.maxZ - BALL_R, s.z + s.vz * this.acc));
        this.ballG.position.set(ex + this.launchOff.x * this.lo2, this.BY, ez + this.launchOff.z * this.lo2);
        this.trailClock += dt;
        if (this.trailClock > 0.025) {
          this.trailClock = 0;
          const tp = this.trailPts;
          for (let i = this.TRAIL - 1; i > 0; i--) { tp[i * 2] = tp[(i - 1) * 2]; tp[i * 2 + 1] = tp[(i - 1) * 2 + 1]; }
          tp[0] = s.x; tp[1] = s.z; this.trailN = Math.min(this.TRAIL, this.trailN + 1);
        }
      }
    } else if (this.mode === "sink") {
      this.modeT += dt;
      const k = Math.min(1, this.modeT / (this.round ? CHALLENGE.reloadSink : 0.45)), e = k * k * (3 - 2 * k);
      this.ballG.position.set(s.x + (this.goal.x - s.x) * e, this.BY - 0.14 * e, s.z + (this.goal.z - s.z) * e);
      this.ball.scale.setScalar(Math.max(0.001, 1 - e));
      if (k >= 1) this.respawn();
    } else if (this.mode === "fade") {
      this.modeT += dt;
      const k = Math.min(1, this.modeT / (this.round ? CHALLENGE.reloadFade : 0.45));
      this.ball.scale.setScalar(Math.max(0.001, 1 - k * k));
      if (k >= 1) this.respawn();
    } else if (this.mode === "ready") {
      // ball rides the plunger cup
      const bx = Math.sin(this.aimYaw), bz = Math.cos(this.aimYaw), bo = off;
      this.ballG.position.set(LAUNCH.x + bx * bo, this.BY, LAUNCH.z + bz * bo);
      if (this.ballScale < 1) { this.ballScale = Math.min(1, this.ballScale + dt * (this.round ? 9 : 3)); const e = this.ballScale; this.ball.scale.setScalar(Math.max(0.001, 1 - Math.pow(1 - e, 3))); }
    }

    // squash: ball along the impact normal, bumpers flatten
    spring1(this.ballQ, 0, dt, 320, 17);
    const q = Math.max(-0.25, Math.min(1, this.ballQ.x));
    this.ballG.rotation.y = this.squashN || 0;
    this.ballG.scale.set(1 + 0.22 * q, 1 + 0.22 * q, 1 - 0.38 * q);
    for (const b of this.bumperViews) {
      spring1(b.sq, 0, dt, 280, 13);
      const k = Math.max(-0.3, Math.min(1, b.sq.x));
      b.body.scale.set(1 + 0.18 * k, 1 - 0.3 * k, 1 + 0.18 * k);
    }

    // ribbon trail (head at ball, tail tapers)
    this.writeTrail();
    this.updateFx(dt);
  }

  writeTrail() {
    const n = this.mode === "flying" ? this.trailN : 0, P = this.trailPos, T = this.TRAIL, y = COURT.y + 0.08;
    const tp = this.trailPts;
    let lx = 0, lz = 0, ly = 1;
    for (let i = 0; i < T; i++) {
      let px, pz, w;
      if (i < n) {
        px = tp[i * 2]; pz = tp[i * 2 + 1]; w = 0.15 * (1 - i / T);
        const j = i < n - 1 ? i + 1 : i - 1;
        let fx = (tp[j * 2] - px) * (i < n - 1 ? 1 : -1), fz = (tp[j * 2 + 1] - pz) * (i < n - 1 ? 1 : -1);
        const L = Math.hypot(fx, fz);
        if (L > 1e-6) { lx = fx / L; lz = fz / L; }
      } else { px = n > 0 ? tp[(n - 1) * 2] : 0; pz = n > 0 ? tp[(n - 1) * 2 + 1] : 0; w = 0; if (n === 0) { P[i * 6 + 1] = P[i * 6 + 4] = -5; P[i * 6] = P[i * 6 + 3] = 0; P[i * 6 + 2] = P[i * 6 + 5] = 0; continue; } }
      // tail-ward direction f=(lx,lz); r=(-fz,fx); A=p-r*w, B=p+r*w
      const rx = -lz, rz = lx;
      P[i * 6] = px - rx * w; P[i * 6 + 1] = y; P[i * 6 + 2] = pz - rz * w;
      P[i * 6 + 3] = px + rx * w; P[i * 6 + 4] = y; P[i * 6 + 5] = pz + rz * w;
    }
    this.trailGeo.attributes.position.needsUpdate = true;
  }

  score() {
    this.mode = "sink"; this.modeT = 0; this.goalPulse = 1; this.goalLit = 1;
    this.goals++; this.misses = 0; this.signPop = 1; this.coach.scored = true;
    const r = this.round;
    if (r && r.phase === "run") {
      const res = scoreGoal(r, this.flags);
      this.popText = res.text; this.popSub = res.sub; this.popT = 1.4;
      this.pending = challengeLayout(Math.random, this.goal);   // hoop + wells reshuffle once the ball has sunk
    }
    this.drawSign(true); this.burst(); this.ripple(this.goal.x, this.goal.z, 1.6, C.sun);
    if (!this.free) {
      this.free = true;
      this.ctx.ui.toast("Goal! Gravity is now your problem.");
      this.ctx.solved();
    }
    this.statusKey = ""; this.pushStatus();
  }

  respawn() {
    const r = this.round;
    if (this.mode === "fade") { this.misses++; this.coach.misses++; if (r && r.phase === "run") { missShot(r); this.drawSign(true); } }
    if (this.pending) { this.setLayout(this.pending); this.pending = null; this.goalLit = 0; this.goalPulse = 0; }
    this.mode = "ready"; this.ballScale = 0; this.ball.scale.setScalar(0.001);
    this.ballG.position.set(LAUNCH.x, this.BY, LAUNCH.z);
    this.ballS.vx = 0; this.ballS.vz = 0; this.ballQ.x = 0; this.ballQ.v = 0;
    this.updatePreview();
  }

  /* Round clock, pop-up text and live scoreboard/status refresh (cheap: redraws only when a shown value changes). */
  tickChallenge(dt) {
    const r = this.round;
    if (this.popT > 0) { this.popT = Math.max(0, this.popT - dt); if (this.popT === 0) this.drawSign(); }
    if (!r || r.phase !== "run") return;
    tickRound(r, dt);
    if (r.phase === "over") { this.roundOver(); return; }
    this.drawSign();
    const k = Math.ceil(r.left - 1e-9) + ":" + r.score + ":" + comboMult(r.streak);
    if (k !== this.statusKey) { this.statusKey = k; this.pushStatus(false); }
  }

  dispose() {
    this.disposed = true;
    this.ctx.ui.tools([]); this.ctx.ui.status(null);
    if (this.coach.el) { this.coach.el.remove(); this.coach.el = null; }
    this.ctx.group.remove(this.root);
    this.dots.dispose(); this.dashes.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const t of this.texs) t.dispose();
    this.geos.length = this.mats.length = this.texs.length = 0;
  }
}
