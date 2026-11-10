import * as THREE from "three";
import { groundFields } from "./grass.js?v=20261110-0921";
import { inkMaterial, outline } from "./toon.js?v=20261110-0921";
import { GreatCircleArc } from "./arc.js?v=20261110-0921";
import { cleanButterflies, planScatter } from "./savestate.js?v=20261110-0921";

/* Small signs of life: birds wheeling above the planet, butterflies near the visitor,
   and pond water that holds the sunset. */

/* ---------- birds: little toon gulls that wander, bank into their turns, and alternate
   bursts of hinged flapping with long glides. Every bird shares the same geometries and
   materials (each bird owns only its two tiny wing skeletons). Each wing is ONE closed skinned
   mesh (shoulder + elbow bones, weights blended across the elbow) so it bends without a join, and
   one material whose vertex colour runs peach -> coral toward the tip, so there is no colour seam
   either. No negative scales anywhere: the right wing is built from its own mirrored geometry. */
const BIRD_SCALE = 2.4;
/* Ink: toon.js's screen-space hull (INK_PX on every part, like the rest of the world), slid
   INK_BACK metres back along the view ray: same screen position, but behind every front face of
   the bird, so a hull can only show against whatever lies beyond the bird (sky, ground), never on
   top of another part, and the joins between body/head/wings/tail carry no seam line. */
const INK_BACK = 0.6;   // metres of pushback
const birdInkMat = () => inkMaterial("#1E1F26", { back: INK_BACK });
// averaged normals so a hull pushed along them never tears at a seam vertex (sphere poles/u-seam)
function inkNormals(g) {
  const pos = g.attributes.position, nor = g.attributes.normal, acc = new Map(), keys = [];
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`; keys.push(k);
    const a = acc.get(k) || [0, 0, 0]; a[0] += nor.getX(i); a[1] += nor.getY(i); a[2] += nor.getZ(i); acc.set(k, a);
  }
  const out = new Float32Array(pos.count * 3);
  keys.forEach((k, i) => { const a = acc.get(k), l = Math.hypot(...a) || 1; out.set([a[0] / l, a[1] / l, a[2] / l], i * 3); });
  g.setAttribute("oNormal", new THREE.BufferAttribute(out, 3));
  return g;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
let birdKit;
function birdParts() {
  if (birdKit) return birdKit;
  /* toon.js's 3 bands are 90/175/255; birds are mostly seen from below against bright sky, where
     that bottom band plus a small lift read as a dark stick, so their ramp starts higher */
  const ramp = new THREE.DataTexture(new Uint8Array([140, 140, 140, 255, 200, 200, 200, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
  const toon = (c, lift = 0.3) => new THREE.MeshToonMaterial({ color: c, gradientMap: ramp, emissive: new THREE.Color(c).multiplyScalar(lift) });
  const ell = (sx, sy, sz, ws = 16, hs = 8) => new THREE.SphereGeometry(1, ws, hs).scale(sx, sy, sz);
  const mirror = g => { const m = g.clone(), p = m.attributes.position; for (let i = 0; i < p.count; i++) p.setX(i, -p.getX(i)); m.index.array.reverse(); m.computeVertexNormals(); return m; };
  /* wing: a sphere with its poles turned onto the span axis, so its 12 rings run root -> tip (what the
     elbow bend needs) and 8 points go round each thin cross-section. Root sits inside the body at
     x = -0.04, tip at 0.66; broad arm, slight wrist, then a swept taper to a rounded point. */
  const wingGeo = () => {
    const g = new THREE.SphereGeometry(1, 8, 12).rotateZ(-Math.PI / 2), p = g.attributes.position, n = p.count;
    const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const pe = new THREE.Color("#F7C3A3"), co = new THREE.Color("#E98C78"), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      // rings are evenly spaced in angle, so bunched at the ends; re-space them evenly along the span
      // (a sparse middle drew the outline as long straight chords) and rebuild the round profile there
      const x0 = p.getX(i), y = p.getY(i), z = p.getZ(i), p0 = Math.sqrt(Math.max(0, 1 - x0 * x0)) || 1e-6;
      const u = (Math.asin(Math.max(-1, Math.min(1, x0))) / (Math.PI / 2) + 1) / 2, x = 2 * u - 1, pr = Math.sqrt(Math.max(0, 1 - x * x));
      const hc = 0.095 * Math.pow(pr, 0.45) / p0 * (1 - 0.6 * sstep(0.45, 1, u));      // half chord (/p0 undoes the sphere's own section radius)
      const ht = 0.026 * Math.pow(pr, 0.5) / p0 * (1 - 0.45 * u);                     // half thickness
      const X = -0.04 + u * 0.7, back = 0.16 * u * u + 0.02;                          // sweep the hand back
      p.setXYZ(i, X, y * ht, z * hc - back + 0.02);
      c.copy(pe).lerp(co, sstep(0.5, 0.85, u)); col.set([c.r, c.g, c.b], i * 3);
      const e = sstep(0.27, 0.39, X); si.set([0, 1, 0, 0], i * 4); sw.set([1 - e, e, 0, 0], i * 4);   // elbow bone at x = 0.31
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
    g.computeVertexNormals(); return g;
  };
  /* tail: a thin disc (poles top/bottom) whose rim is mapped onto a forked fan outline, ray-cast from a
     point inside it (the outline is star-shaped about it), with corners rounded by Chaikin passes */
  const tailGeo = () => {
    let poly = [[0, -0.09], [0.035, -0.1], [0.06, -0.22], [0.09, -0.345], [0.05, -0.315], [0, -0.275]];
    poly = poly.concat(poly.slice(1, -1).reverse().map(([x, z]) => [-x, z]));
    for (let k = 0; k < 2; k++) poly = poly.flatMap((a, i) => { const b = poly[(i + 1) % poly.length]; return [[0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]]; });
    const P = [0, -0.18], rad = th => {   // distance from P to the outline along angle th
      const dx = Math.cos(th), dz = Math.sin(th); let best = 0.1;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length], ex = b[0] - a[0], ez = b[1] - a[1];
        const den = dx * ez - dz * ex; if (Math.abs(den) < 1e-9) continue;
        const ax = a[0] - P[0], az = a[1] - P[1], t = (ax * ez - az * ex) / den, s = (ax * dz - az * dx) / den;
        if (t > 0 && s >= 0 && s <= 1) best = t;
      }
      return best;
    };
    const g = new THREE.SphereGeometry(1, 20, 4), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = Math.hypot(x, z), th = Math.atan2(z, x), R = rad(th);
      const X = P[0] + r * R * Math.cos(th), Z = P[1] + r * R * Math.sin(th);
      p.setXYZ(i, X, y * 0.018 * (1 - 1.2 * (-0.09 - Z)) + 0.02 - 0.12 * (Z + 0.1), Z);   // thins and lifts toward the fork
    }
    g.computeVertexNormals(); return g;
  };
  const wing = wingGeo();
  // eyes: flattened lenses laid on the head surface (normal along the ellipsoid gradient), barely proud of it
  const hc = new THREE.Vector3(0, 0.07, 0.19), hr = new THREE.Vector3(0.075, 0.072, 0.08);
  const eyeDir = new THREE.Vector3(0.72, 0.22, 0.66).normalize();
  birdKit = {
    body: ell(0.1, 0.095, 0.2, 16, 10),
    head: ell(hr.x, hr.y, hr.z, 20, 12).translate(hc.x, hc.y, hc.z),
    beak: new THREE.ConeGeometry(0.03, 0.09, 8).rotateX(Math.PI / 2).translate(0, 0.06, 0.29),
    tail: tailGeo(), eye: new THREE.SphereGeometry(0.014, 6, 3).scale(1, 1, 0.35),
    eyePos: eyeDir.clone().multiply(hr), eyeNor: eyeDir.clone().divide(hr).normalize(), headC: hc,
    wings: [wing, mirror(wing)],
    cream: toon("#FFF1E4"), coral: toon("#E98C78"), beakM: toon("#FFB43F"),
    wingM: toon("#FFFFFF"),
    eyeM: new THREE.MeshBasicMaterial({ color: "#1E1F26" }),
  };
  // vertex colour drives the wing's diffuse; make it drive the emissive lift too, or the coral tip would wash pale
  birdKit.wingM.vertexColors = true;
  birdKit.wingM.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace("vec3 totalEmissiveRadiance = emissive;", "vec3 totalEmissiveRadiance = emissive * vColor;"); };
  birdKit.wingM.customProgramCacheKey = () => "birdWing";
  for (const g of [birdKit.body, birdKit.head, birdKit.beak, birdKit.tail, ...birdKit.wings]) inkNormals(g);
  return birdKit;
}
// one ink hull per inked part, sharing the part's geometry and transform (and skeleton, for wings)
function inkBird(root, skip) {
  const ms = []; root.traverse(o => { if (o.isMesh && !skip(o)) ms.push(o); });
  for (const o of ms) {
    const h = o.isSkinnedMesh ? new THREE.SkinnedMesh(o.geometry, birdInkMat()) : new THREE.Mesh(o.geometry, birdInkMat());
    if (o.isSkinnedMesh) { h.bind(o.skeleton, o.bindMatrix); h.frustumCulled = false; }
    h.userData.isOutline = true; h.raycast = () => {};
    h.position.copy(o.position); h.quaternion.copy(o.quaternion); h.scale.copy(o.scale); o.parent.add(h);
  }
}

export class Birds {
  constructor(scene, centre, R, count = 9) {
    this.items = []; this.centre = centre;
    const k = birdParts();
    for (let i = 0; i < count; i++) {
      const g = new THREE.Group(); g.userData.bird = true;
      const roll = new THREE.Group(); g.add(roll);   // bank + pitch live here, so lookAt on g stays clean
      roll.add(new THREE.Mesh(k.body, k.cream), new THREE.Mesh(k.head, k.cream), new THREE.Mesh(k.beak, k.beakM), new THREE.Mesh(k.tail, k.coral));
      for (const sx of [1, -1]) {
        const e = new THREE.Mesh(k.eye, k.eyeM), n = k.eyeNor.clone(); n.x *= sx;
        e.position.copy(k.eyePos).multiply(new THREE.Vector3(sx, 1, 1)).add(k.headC).addScaledVector(n, -0.002);
        e.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n); roll.add(e);
      }
      const wing = s => {   // skinned: shoulder bone at the mesh origin, elbow bone 0.31 out along the span
        const m = new THREE.SkinnedMesh(k.wings[s > 0 ? 0 : 1], k.wingM); m.position.set(0.075 * s, 0.035, 0.03);
        const sh = new THREE.Bone(), el = new THREE.Bone(); el.position.set(0.31 * s, 0, 0);
        sh.add(el); m.add(sh); m.frustumCulled = false;   // the bound sphere would be the rest pose; wings flap out of it
        roll.add(m); m.updateMatrixWorld(true); m.bind(new THREE.Skeleton([sh, el]));
        return { sh, el };
      };
      const L = wing(1), Rw = wing(-1);
      g.scale.setScalar(BIRD_SCALE);
      inkBird(g, o => o.material === k.eyeM);
      // the birds cast real sun shadows (small dark dots that sweep over the ground); they don't
      // receive (no self-shadow speckle at 12 cm), and their ink hulls never cast
      g.traverse(o => { if (o.isMesh) { o.castShadow = !o.userData.isOutline; o.receiveShadow = false; } });
      scene.add(g);
      const d = new THREE.Vector3().randomDirection();
      const h = new THREE.Vector3().randomDirection().projectOnPlane(d).normalize();
      this.items.push({ g, roll, L, R: Rw, d, h, alt: R + 11 + Math.random() * 9, speed: 3.2 + Math.random() * 1.6,
        phase: Math.random() * 100, period: 6 + Math.random() * 4, time: Math.random() * 50, bank: 0, flapPh: 0 });
    }
  }
  update(dt) {
    // stateful (own clock, integrated heading) so a long frame never teleports a bird
    const c = this.centre, ax = new THREE.Vector3(), look = new THREE.Vector3();
    for (const it of this.items) {
      it.time += dt; const t = it.time, ph = it.phase;
      // wander: a slowly varying turn rate gives loose S-curves and the odd full circle
      const turn = 0.32 * Math.sin(t * 0.21 + ph) + 0.22 * Math.sin(t * 0.57 + ph * 1.7);
      it.h.applyAxisAngle(it.d, turn * dt);
      const r = it.alt + 1.4 * Math.sin(t * 0.33 + ph);
      ax.crossVectors(it.d, it.h).normalize();
      it.d.applyAxisAngle(ax, it.speed * dt / r); it.h.applyAxisAngle(ax, it.speed * dt / r);
      it.h.projectOnPlane(it.d).normalize();
      it.g.position.copy(c).addScaledVector(it.d, r);
      it.g.up.copy(it.d);
      it.g.lookAt(look.copy(it.g.position).add(it.h));
      // bank into the turn (+turn is a left turn; local +x is the left wing), eased so it never snaps
      it.bank += (THREE.MathUtils.clamp(-turn * 1.5, -0.6, 0.6) - it.bank) * (1 - Math.exp(-dt * 3));
      it.roll.rotation.z = it.bank;
      // glide/flap rhythm: a burst of beats once per period, then a long glide on slightly raised wings
      const env = THREE.MathUtils.clamp((Math.sin(t * 2 * Math.PI / it.period + ph) - 0.45) * 2.5, 0, 1);
      it.flapPh += dt * 9.5 * (0.35 + 0.65 * env);
      const s = Math.sin(it.flapPh);
      const shoulder = 0.14 + env * (0.2 + 0.72 * s);            // up to +1.06, down to -0.38
      const elbow = -0.06 + env * (-0.42 * Math.sin(it.flapPh - 1.0) - 0.08);   // the hand lags the arm
      it.L.sh.rotation.z = shoulder; it.R.sh.rotation.z = -shoulder;
      it.L.el.rotation.z = elbow; it.R.el.rotation.z = -elbow;
      it.roll.position.y = -0.025 * s * env;                      // the body heaves against each beat
      it.roll.rotation.x = -0.06 * env - 0.04 * Math.sin(t * 0.33 + ph + 1.57);   // nose up while working, follows the climb
    }
  }
}

/* ---------- butterflies: they all live out in the world (on the lilac beds, by the ponds, under
   trees and in a few harder places) and join the swarm when Blip walks within JOIN_R of them. Every
   visit starts with none following him (savestate.js). Placement is seeded, so they rest in the same
   places every visit. All of them share one wing geometry and six materials, and update() allocates
   nothing per frame. They never cast shadows: a wing is a few cm across against a ~3.3 cm shadow
   texel, so its shadow would be a flickering speck rather than a shape. */
const JOIN_R = 2.5, JOIN_T = 1.4;
/* finding cue for the wild ones: at 19-25 m a butterfly is ~10 px, so each wild one also has a small
   four-point glint above it that twinkles briefly (about once every 2.6-4 s, never two in step) at a
   fixed on-screen size. A glint is a Sprite (no ink, no shadow, no fog) and a child of the butterfly,
   so setVisible() and joining hide it with the butterfly. GLINT_PX: peak size in CSS px. */
/* all collected: a spiral round Blip, then a scatter to new spots round the planet */
/* R7 F1: a taller, wider vortex that accelerates to a climax (CLIMB_S), then a burst (BURST_S) and the scatter.
   W0 -> W1: spin rate (rad/s) at the start and the climax; H: column height (m); R0 -> R1: radius at the bottom and the top. */
const CEL = { SPIRAL_S: 4.75, CLIMB_S: 4.2, BURST_S: 0.55, ENTER_S: 0.7, W0: 2.2, W1: 9.5, H: 10.5, R0: 1.5, R1: 5.6, SCATTER_MIN: 2.2, SCATTER_MAX: 3.8, STAGGER: 0.7 };
const CEL_CUES = [0.15, 1.3, 2.4, 3.3, 3.9];   // the swell: a rising ping ladder (k = 0..4), then the burst cue at CLIMB_S
const CEL_TR = 7, CEL_SHARDS = 18;             // trail samples per butterfly; burst shards
const CEL_CREAM = "#FFF3C8", CEL_INK = "#1E1F26";   // the trail and flash are exactly these two tones, flat
const WILD_S = 0.78, SWARM_S = 0.62, GLINT_PX = 20;   // SWARM_S: a collected wild one shrinks back to the swarm's size
let glintTex = null;
function glintTexture() {
  if (glintTex) return glintTex;
  const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 30); r.addColorStop(0, "rgba(255,255,245,1)"); r.addColorStop(0.35, "rgba(255,248,210,0.95)"); r.addColorStop(1, "rgba(255,236,170,0.15)");
  g.fillStyle = r; g.beginPath();   // a soft four-point star
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 - Math.PI / 2, rr = k % 2 ? 9 : 31; g.lineTo(32 + Math.cos(a) * rr, 32 + Math.sin(a) * rr); }
  g.closePath(); g.fill();
  glintTex = new THREE.CanvasTexture(c); glintTex.colorSpace = THREE.SRGBColorSpace;
  return glintTex;
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
function seeded(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/* a flight from one body to another (the celebration scatter after the last one is
   collected on the moon). The great-circle arc about the TARGET body (altitude above it all the way, so it never cuts
   through it), plus a lift straight off the body it leaves that fades out by mid-flight, so it rises off the moon
   instead of ploughing into it; then pushed out of every body (surface + CLEAR, faded at the ends) as a last guard.
   It starts exactly where the butterfly is (no pop) and ends over its new spot. */
class CrossArc {
  constructor(from, fromBody, to, toBody, bodies, H) {
    this.gc = new GreatCircleArc(toBody.centre, from, to, d => toBody.surface(d), H);
    this.lift = from.clone().sub(fromBody.centre).normalize().multiplyScalar(fromBody.R * 1.6);
    this.bodies = bodies; this._v = new THREE.Vector3(); this._d = new THREE.Vector3();
  }
  getPoint(s, out = new THREE.Vector3()) {
    this.gc.getPoint(s, out);
    const u = Math.min(1, s / 0.6); out.addScaledVector(this.lift, 2.6 * Math.sin(Math.PI * u) * (1 - u) * (1 - u));
    const fade = Math.min(1, Math.sin(Math.PI * s) * 10);
    for (const b of this.bodies) {
      const v = this._v.copy(out).sub(b.centre), r = v.length(); if (r < 1e-6) continue;
      const d = this._d.copy(v).divideScalar(r), floor = b.surface(d) + 1.2 * fade;
      if (r < floor) out.copy(b.centre).addScaledVector(d, floor);
    }
    return out;
  }
}
function tangents(up, t1, t2) { t1.set(1, 0, 0).cross(up); if (t1.lengthSq() < 0.01) t1.set(0, 0, 1).cross(up); t1.normalize(); t2.crossVectors(up, t1); }

export class Butterflies {
  /* opts: planet, moon (Body), ok(d) -> open planet ground, ponds [{c, r}], trees [Vector3],
     hard [{id, pos, body, rest}], wild (how many live out in the world), saved (the stored list, never restored) */
  constructor(scene, opts) {
    const { planet, ok = () => true, ponds = [], trees = [], hard = [], wild = 20, saved = [] } = opts;
    this.items = []; this.lowCount = wild;
    this.scene = scene; this.rig = null; this.onCue = null; this.planet = planet; this.okFn = ok; this.armed = false; this.cel = null; this.onAll = null; this.celebrated = false;
    const cols = ["#FFC845", "#FF8FA3", "#B9A2F2", "#7ED6B2", "#FFB27A", "#FFFFFF"];
    const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.bezierCurveTo(0.25, 0.3, 0.45, 0.12, 0.38, -0.05); shape.bezierCurveTo(0.42, -0.25, 0.15, -0.3, 0, -0.06);
    const geo = new THREE.ShapeGeometry(shape); geo.rotateX(-Math.PI / 2);
    { const P = geo.attributes.position, c = new THREE.Vector3(0.2, 0, 0.05), on = new Float32Array(P.count * 3), v = new THREE.Vector3();
      for (let k = 0; k < P.count; k++) { v.fromBufferAttribute(P, k).sub(c); v.y = 0; v.normalize(); on.set([v.x, 0, v.z], k * 3); }
      geo.setAttribute("oNormal", new THREE.BufferAttribute(on, 3)); }
    this.mats = cols.map(c => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    const rnd = seeded(20251031);
    const ground = (body, d) => body.centre.clone().addScaledVector(d, body.surface(d));
    const spots = [];   // [{id, pos, body, rest, kind, tier}] -- tier 0 survives lowPower
    // lilac beds (the ground shader paints lilac where bed > 0.66; the field peaks near 0.70): well inside the bed field (and clear of the peach sand that paints over it), three beds far apart
    const beds = [], d = new THREE.Vector3();
    for (let i = 0; i < 6000; i++) {
      d.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); const L = d.lengthSq(); if (L > 1 || L < 1e-3) continue; d.normalize();
      const f = groundFields(d);
      if (f.bed < 0.675 || f.sand < 0.36 || planet.surface(d) > planet.R + 0.003 || !ok(d)) continue;
      if (planet.plateaus.some(p => d.angleTo(p.n) < p.t1 + 1 / planet.R)) continue;
      beds.push({ d: d.clone(), v: f.bed });
    }
    beds.sort((x, y) => y.v - x.v);
    const chosen = [];
    for (const b of beds) { if (chosen.length >= 3) break; if (chosen.every(c => c.d.angleTo(b.d) * planet.R > 14)) chosen.push(b); }
    const t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
    chosen.forEach((b, bi) => {
      const n = [3, 2, 2][bi];
      tangents(b.d, t1, t2);
      for (let j = 0; j < n; j++) {
        const ang = rnd() * Math.PI * 2, r = 0.25 + rnd() * 0.45;
        const dd = b.d.clone().multiplyScalar(planet.R).addScaledVector(t1, Math.cos(ang) * r).addScaledVector(t2, Math.sin(ang) * r).normalize();
        spots.push({ id: `lilac${bi}-${j}`, pos: ground(planet, groundFields(dd).bed > 0.668 ? dd : b.d), body: planet, rest: j !== 1, kind: "lilac", tier: j < 2 && bi < 2 ? 0 : 1 });
      }
    });
    // ponds: fluttering over the rim, a step out from the water
    ponds.forEach((p, pi) => {
      const up = planet.up(p.c); tangents(up, t1, t2);
      for (let j = 0; j < (pi < 2 ? 2 : 1); j++) {
        const ang = rnd() * Math.PI * 2;
        const q = p.c.clone().addScaledVector(t1, Math.cos(ang) * (p.r + 0.6)).addScaledVector(t2, Math.sin(ang) * (p.r + 0.6));
        spots.push({ id: `pond${pi}-${j}`, pos: ground(planet, q.sub(planet.centre).normalize()), body: planet, rest: false, kind: "pond", tier: j === 0 ? 0 : 1 });
      }
    });
    // trees: under the canopy, beside the trunk
    const pool = trees.slice();
    for (let j = 0; j < 4 && pool.length; j++) {
      const tp = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
      const up = planet.up(tp); tangents(up, t1, t2);
      const ang = rnd() * Math.PI * 2, q = tp.clone().addScaledVector(t1, Math.cos(ang) * 1.3).addScaledVector(t2, Math.sin(ang) * 1.3);
      spots.push({ id: `tree${j}`, pos: ground(planet, q.sub(planet.centre).normalize()), body: planet, rest: j % 2 === 1, kind: "tree", tier: j < 2 ? 0 : 1 });
    }
    hard.forEach((h, j) => spots.push({ ...h, kind: "hard", tier: j === 1 ? 1 : 0 }));
    const use = wild >= spots.length ? spots : spots.filter(s => s.tier === 0).concat(spots.filter(s => s.tier !== 0)).slice(0, wild);
    // a visit starts at zero: a stored list is dropped, never restored as butterflies round Blip (savestate.js)
    this.migrated = cleanButterflies(saved).cleared;
    const make = (i, spot) => {
      const g = new THREE.Group(), m = this.mats[i % this.mats.length], l = new THREE.Mesh(geo, m), r = new THREE.Mesh(geo, m); r.scale.x = -1;
      l.castShadow = r.castShadow = false;   // see the note above the class
      // ink: flat cards, so the hull's push direction is in the wing's plane, out from its middle
      // (ShapeGeometry keeps only contour points); a child of each wing, so it flaps with it.
      // Without it a wing in front of same-coloured ground vanishes.
      g.add(l, r); outline(g, "#1E1F26", undefined, { flat: true, child: true });
      // wild ones a size up from the swarm, so one resting on a lilac bed reads at the 13-25 m camera
      g.scale.setScalar(WILD_S); scene.add(g);
      // added after outline(): the glint gets no hull
      const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTexture(), color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false, sizeAttenuation: false }));
      glint.position.set(0, 0.55 / WILD_S, 0); glint.renderOrder = 2; glint.visible = false; g.add(glint);
      const it = { id: spot.id, g, l, r, mode: "wild", kind: spot.kind, body: spot.body, rest: spot.rest,
        home: spot.pos.clone(), up: new THREE.Vector3(), t1: new THREE.Vector3(), t2: new THREE.Vector3(),
        off: new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize(), phase: rnd() * 50, speed: 0.5 + rnd() * 0.5,
        from: new THREE.Vector3(), prev: new THREE.Vector3(), k: 0,
        glint, gPeriod: 2.6 + rnd() * 1.4, gPhase: rnd() };
      it.orig = { body: spot.body, pos: spot.pos.clone(), d: spot.pos.clone().sub(spot.body.centre).normalize() };   // where it first lived (a moon one returns there)
      spot.body.normal(spot.pos.clone().sub(spot.body.centre).normalize(), it.up); tangents(it.up, it.t1, it.t2);
      this.pose(it, 0);
      this.items.push(it);
    };
    use.forEach((s, i) => make(i, s));
    this.total = this.items.length;
    this.cueOn = true;   // the glint (test hook: off for an ON/OFF control in the same frame)
  }
  /* the wild ones' glint: a short twinkle (0.6 s rise and fall) once per period, sized in screen px */
  glint(it, t) {
    const s = it.glint; if (!s) return;
    const u = ((t / it.gPeriod + it.gPhase) % 1) * it.gPeriod, w = 0.6;
    const k = this.cueOn && u < w ? Math.sin(Math.PI * u / w) : 0;
    s.visible = k > 0.01;
    if (!s.visible) return;
    s.material.opacity = 0.95 * k;
    s.material.rotation = 0.6 * u;
    // sizeAttenuation off: on-screen height = scale * P[1][1] * viewport/2 (the parent's scale multiplies it)
    const p11 = this.camera ? this.camera.projectionMatrix.elements[5] : 2.246;
    const sz = GLINT_PX * (0.55 + 0.45 * k) * 2 / (Math.max(1, innerHeight) * p11 * WILD_S);
    s.scale.set(sz, sz, 1);
  }
  get wild() { return this.items.filter(it => it.mode === "wild"); }
  get collected() { return this.celebrated ? this.items.length : this.items.length - this.wild.length; }   // once all were found this visit, the post-celebration scatter does not un-collect them
  /* a wild one's place at time t: resting with its wings slowly opening and closing, or a small loop above its home */
  pose(it, t) {
    const p = it.g.position;
    if (it.rest) {
      p.copy(it.home).addScaledVector(it.up, 0.05);   // just above the ground so a wing never meets it
      it.g.up.copy(it.up); _a.copy(p).add(it.t1); it.g.lookAt(_a);
      // 0.45..1.3 rad per wing: they never close flat onto each other (no coplanar, z-fighting pair)
      const f = 0.45 + 0.85 * (0.5 + 0.5 * Math.sin(t * 1.4 + it.phase));
      it.l.rotation.z = f; it.r.rotation.z = f * -1;
      return;
    }
    const a = t * (0.6 + it.speed * 0.5) + it.phase, rr = 0.7 + 0.25 * Math.sin(t * 0.7 + it.phase);
    p.copy(it.home).addScaledVector(it.up, 0.7 + 0.35 * Math.sin(t * 1.3 + it.phase))
      .addScaledVector(it.t1, Math.cos(a) * rr).addScaledVector(it.t2, Math.sin(a) * rr);
    it.g.up.copy(it.up);
    _a.copy(p).addScaledVector(it.t1, -Math.sin(a)).addScaledVector(it.t2, Math.cos(a)); it.g.lookAt(_a);
    const f = Math.sin(t * 20 + it.phase) * 1.1; it.l.rotation.z = f; it.r.rotation.z = -f;
  }
  /* where a swarm member wants to be: a loose ring 1.8-5 m round Blip, riding at Blip's own height
     (so the lookout top, the moon and the cannon flight all work), kept off Blip and the lens */
  target(it, t, centre, up, body, cam, out) {
    _a.copy(it.off).addScaledVector(up, -it.off.dot(up)); if (_a.lengthSq() < 1e-4) _a.copy(up).cross(it.t1.set(1, 0, 0)); _a.normalize();
    out.copy(centre).addScaledVector(_a, 1.8 + 3.2 * (0.5 + 0.5 * Math.sin(it.phase)));
    out.x += 0.9 * Math.sin(t * it.speed * 2 + it.phase); out.y += 0.9 * Math.sin(t * it.speed * 3.1 + it.phase * 2); out.z += 0.9 * Math.cos(t * it.speed * 2.3 + it.phase);
    _b.copy(out).sub(body.centre).normalize();
    const feet = _c.copy(centre).sub(body.centre).length();
    out.copy(body.centre).addScaledVector(_b, Math.max(body.surface(_b), feet) + 0.8 + 0.7 * (0.5 + 0.5 * Math.sin(t * 1.7 + it.phase)));
    // keep 1.3 m (sideways) off Blip and 1.2 m off the camera
    _c.copy(out).sub(centre); _c.addScaledVector(up, -_c.dot(up)); const h = _c.length();
    if (h < 1.3) out.addScaledVector(_c.normalize(), 1.3 - h);
    if (cam) { _c.copy(out).sub(cam); const dc = _c.length(); if (dc < 1.2) out.addScaledVector(_c.normalize(), 1.2 - dc); }
    return out;
  }
  /* returns how many joined this frame (main shows the toast) */
  update(dt, t, centre, up, body, cam) {
    let joined = 0;
    for (const it of this.items) {
      if (it.mode === "spiral" || it.mode === "scatter") { this.celebrateStep(it, dt, t, centre, up, body, cam); continue; }
      if (it.mode === "wild") {
        if (body === it.body && centre.distanceToSquared(it.home) < JOIN_R * JOIN_R) { it.mode = "join"; it.k = 0; it.from.copy(it.g.position); joined++; if (it.glint) it.glint.visible = false; }
        else { this.pose(it, t); this.glint(it, t); continue; }
      }
      it.prev.copy(it.g.position);
      const tgt = this.target(it, t, centre, up, body, cam, _d);
      if (it.mode === "join") {
        // a short take-off: lift off its spot in an arc and ease into its place in the swarm
        it.k = Math.min(1, it.k + dt / JOIN_T);
        const e = it.k * it.k * (3 - 2 * it.k);
        it.g.scale.setScalar(WILD_S + (SWARM_S - WILD_S) * e);   // back to the swarm's size on the way in
        it.g.position.lerpVectors(it.from, tgt, e).addScaledVector(it.up, Math.sin(Math.PI * it.k) * 1.0);
        if (it.k >= 1) it.mode = "swarm";
      } else {
        // trail at a relaxed pace; catch up faster when far behind (a cannon shot, a travel jump)
        const far = it.g.position.distanceToSquared(tgt) > 144;
        it.g.position.lerp(tgt, 1 - Math.exp(-dt * (far ? 5 : 1.2)));
      }
      _e.copy(it.g.position).sub(body.centre).normalize(); it.g.up.copy(_e);
      _a.copy(it.g.position).sub(it.prev); _a.addScaledVector(_e, -_a.dot(_e));
      if (_a.lengthSq() > 1e-8) { _a.normalize().add(it.g.position); it.g.lookAt(_a); }
      const f = Math.sin(t * (it.mode === "join" ? 30 : 22) + it.phase) * 1.1;
      it.l.rotation.z = f; it.r.rotation.z = -f;
      it.off.applyAxisAngle(up, dt * 0.15);
    }
    if (joined) this.armed = true;
    // the last wild one has joined and every butterfly is back in the swarm: start the celebration once
    if (this.armed && !this.celebrated && !this.cel && this.items.every(it => it.mode === "swarm")) this.startCelebration(body);
    if (this.cel) { this.cel.t += dt; if (this.cel.t >= CEL.SPIRAL_S && !this.cel.scattering) this.startScatter(body); this.celFx(dt, centre, up); this.celBeat(dt); }
    return joined;
  }
  /* ---- celebration ---- */
  startCelebration(body) {
    this.celebrated = true;
    const n = this.items.length;
    this.cel = { t: 0, scattering: false, body, n, cue: 0, burst: false, acc: 0, shards: [], flashAge: -1, beat: null, ctr: new THREE.Vector3() };
    const rg = this.rig;   // the camera beat: remember the framing so it can return exactly
    if (rg && rg.mode === "follow") this.cel.beat = { dist0: rg.distWanted, pitch0: rg.pitch, lastDist: rg.distWanted, done: false };
    this.items.forEach((it, i) => { it.mode = "spiral"; it.cs = { th0: i * 2.39996, h0: i / n, from: it.g.position.clone(), tr: new Float32Array(CEL_TR * 3), trH: 0, trN: 0 }; });
    if (this.onAll) this.onAll(n);
  }
  /* new random spots: open ground (the same test the wild ones use) on the body Blip is on */
  scatterSpots(body, n, out = []) {
    const rnd = Math.random, d = new THREE.Vector3(), tries = 4000;
    for (let k = 0; k < tries && out.length < n; k++) {
      d.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); const L = d.lengthSq(); if (L > 1 || L < 1e-3) continue; d.normalize();
      if (body === this.planet) {
        if (!this.okFn(d) || body.surface(d) > body.R + 0.003) continue;
        if (body.plateaus && body.plateaus.some(p => d.angleTo(p.n) < p.t1 + 1 / body.R)) continue;
      } else if (body.surface(d) > body.R + 0.003) continue;
      // spread: not within 3 m of another pick
      if (out.some(o => o.d.angleTo(d) * body.R < 3)) continue;
      out.push({ d: d.clone(), pos: body.centre.clone().addScaledVector(d, body.surface(d)) });
    }
    while (out.length < n) { d.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(); out.push({ d: d.clone(), pos: body.centre.clone().addScaledVector(d, body.surface(d)) }); }
    return out;
  }
  /* the scatter never depends on where Blip stands. Every butterfly goes to a new spot on the PLANET,
     except one whose original spot was on another body (the moon one): that goes back to its original spot. `body` is ignored. */
  startScatter(_body) {
    const cel = this.cel; cel.scattering = true;
    const plan = planScatter(this.items.map(it => ({ origin: it.orig ? it.orig.body : null })), this.planet);
    const need = plan.filter(p => p === this.planet).length;
    const fresh = this.scatterSpots(this.planet, need);
    this.scatterLog = [];
    // the body the swarm is flying round now (Blip's), and every body a flight must stay out of
    const from = (cel.body) || this.planet, bodies = [this.planet];
    for (const b of [from, ...this.items.map(it => it.orig && it.orig.body)]) if (b && !bodies.includes(b)) bodies.push(b);
    this.items.forEach((it, i) => {
      const tb = plan[i];
      const sp = tb === this.planet ? fresh.shift() : { d: it.orig.d.clone(), pos: it.orig.pos.clone() };
      const to = sp.pos.clone().addScaledVector(sp.d, 0.8 + Math.random() * 1.2);   // hover a little above the spot
      this.scatterLog.push({ pos: sp.pos.clone(), body: tb, id: it.id });
      it.mode = "scatter";
      // from the moon to the planet (or back): a body-to-body flight, longer in time so it reads as a flight, not a streak
      const cross = from !== tb, far = cross ? it.g.position.distanceTo(to) : 0;
      it.cs = { tr: it.cs?.tr || new Float32Array(CEL_TR * 3), trH: it.cs?.trH || 0, trN: it.cs?.trN || 0, delay: Math.random() * CEL.STAGGER, dur: CEL.SCATTER_MIN + Math.random() * (CEL.SCATTER_MAX - CEL.SCATTER_MIN) + Math.min(5, far / 25), t: 0, home: sp.pos.clone(), spotUp: sp.d.clone(), body: tb };
      it.cs.arc = cross ? new CrossArc(it.g.position, from, to, tb, bodies, 4 + Math.random() * 3)
        : new GreatCircleArc(tb.centre, it.g.position.clone(), to, d => tb.surface(d), 3 + Math.random() * 3);
      it.body = tb;
    });
  }
  celebrateStep(it, dt, t, centre, up, body, cam) {
    const cs = it.cs, cel = this.cel; it.prev.copy(it.g.position);
    if (it.mode === "spiral") {
      const tau = cel.t, n = cel.n, Tc = CEL.CLIMB_S;
      // spin rate eases from W0 up to W1 over the climb (angle = integral), then holds W1 through the burst
      const tc = Math.min(tau, Tc), ph = CEL.W0 * tc + (CEL.W1 - CEL.W0) * tc * tc / (2 * Tc) + (tau > Tc ? CEL.W1 * (tau - Tc) : 0);
      const th = cs.th0 + ph, p = tc / Tc, f = (0.18 + 0.82 * cs.h0) * Math.pow(p, 1.5);
      let h = 0.7 + CEL.H * f, r = CEL.R0 + (CEL.R1 - CEL.R0) * Math.pow(f, 0.85);
      if (tau > Tc) { const b = Math.min(1, (tau - Tc) / CEL.BURST_S), eb = 1 - (1 - b) * (1 - b); r += (10 + 8 * ((it.phase * 0.618) % 1)) * eb; h += (3 + 5 * ((it.phase * 0.37) % 1)) * eb; }
      it.g.scale.setScalar(SWARM_S * (1 + 0.45 * p));
      tangents(up, it.t1, it.t2);
      const tgt = _d.copy(centre).addScaledVector(it.t1, Math.cos(th) * r).addScaledVector(it.t2, Math.sin(th) * r).addScaledVector(up, h);
      if (cam) { _c.copy(tgt).sub(cam); const dc = _c.length(); if (dc < 1.2) tgt.addScaledVector(_c.normalize(), 1.2 - dc); }
      const e = Math.min(1, tau / CEL.ENTER_S), ee = e * e * (3 - 2 * e);
      it.g.position.lerpVectors(cs.from, tgt, ee); if (e >= 1) it.g.position.copy(tgt);
    } else if (it.mode === "scatter") {
      cs.t += dt; const k = Math.min(1, Math.max(0, (cs.t - cs.delay) / cs.dur)), e = k * k * (3 - 2 * k);
      if (k > 0 || cs.t > cs.delay) cs.arc.getPoint(e, it.g.position);
      if (k >= 1) {
        // settle into a small loop over its new spot (not collectable: it is already yours)
        this.release(it, cs);
        if (!this.items.some(x => x.mode === "scatter" || x.mode === "spiral")) { this.cel = null; this.armed = false; }
      }
    }
    if (it.mode === "wild") { this.pose(it, t); this.glint(it, t); return; }
    _e.copy(it.g.position).sub((it.mode === "scatter" ? cs.body : body).centre).normalize(); it.g.up.copy(_e);
    _a.copy(it.g.position).sub(it.prev); _a.addScaledVector(_e, -_a.dot(_e));
    if (_a.lengthSq() > 1e-8) { _a.normalize().add(it.g.position); it.g.lookAt(_a); }
    const f = Math.sin(t * 28 + it.phase) * 1.1; it.l.rotation.z = f; it.r.rotation.z = -f;
  }
  /* ---- R7 F1: the celebration's trail, burst and cues (cel style: flat cream stars on a flat ink twin, no gradients, no bloom) ---- */
  buildFx() {
    const star = new THREE.Shape(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 - Math.PI / 2, rr = k % 2 ? 0.34 : 1; if (k) star.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else star.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); } star.closePath();   // moveTo first: a bare lineTo starts from (0,0) and cuts a wedge out of every star
    const geo = new THREE.ShapeGeometry(star), N = this.items.length * CEL_TR + CEL_SHARDS + 2;
    const mk = (col, ro) => { const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: col, toneMapped: false, fog: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide }), N); m.frustumCulled = false; m.renderOrder = ro; m.count = N; this.scene.add(m); return m; };
    return { ink: mk(CEL_INK, 3), fill: mk(CEL_CREAM, 4), N, m4: new THREE.Matrix4(), q: new THREE.Quaternion(), qz: new THREE.Quaternion(), pos: new THREE.Vector3(), sc: new THREE.Vector3(), zero: new THREE.Matrix4().makeScale(0, 0, 0) };
  }
  celFx(dt, centre, up) {
    const cel = this.cel; if (!cel || !this.camera) { if (this.fx && this.fx.ink.visible) this.fx.ink.visible = this.fx.fill.visible = false; return; }   // no celebration: never leave stale stars up
    const F = this.fx || (this.fx = this.buildFx()), tau = cel.t;
    // sound cues: a rising ping ladder through the climb, then the burst
    if (this.onCue) {
      while (cel.cue < CEL_CUES.length && tau >= CEL_CUES[cel.cue]) this.onCue("ping", cel.cue++);
      if (!cel.burst && tau >= CEL.CLIMB_S) this.onCue("burst", 0);
    }
    cel.ctr.copy(centre).addScaledVector(up, 0.7 + CEL.H * 0.55);
    if (!cel.burst && tau >= CEL.CLIMB_S) {
      cel.burst = true; cel.flashAge = 0;
      for (let k = 0; k < CEL_SHARDS; k++) {
        const a = k * 2.39996, e = 0.15 + 0.7 * ((k * 0.381) % 1), v = new THREE.Vector3();
        tangents(up, _a, _b);
        v.copy(_a).multiplyScalar(Math.cos(a)).addScaledVector(_b, Math.sin(a)).multiplyScalar(Math.sqrt(1 - e * e)).addScaledVector(up, e).multiplyScalar(9 + 8 * ((k * 0.618) % 1));
        cel.shards.push({ p: cel.ctr.clone(), v, age: 0, life: 0.55 + 0.35 * ((k * 0.73) % 1), spin: a });
      }
    }
    const live = tau < CEL.SPIRAL_S + 0.55;
    if (!live) { if (F.ink.visible) F.ink.visible = F.fill.visible = false; return; }
    // trail samples, 35/s, while a butterfly is circling (or has just left)
    cel.acc += dt; const step = cel.acc >= 0.028; if (step) cel.acc = 0;
    const p = Math.min(1, tau / CEL.CLIMB_S), TS = 0.16 + 0.2 * p, on = tau > 0.5;
    let i = 0;
    const put = (pos, scale, spin) => {
      F.q.copy(this.camera.quaternion); F.qz.setFromAxisAngle(_e.set(0, 0, 1), spin); F.q.multiply(F.qz);
      F.sc.setScalar(scale * 1.42); F.m4.compose(pos, F.q, F.sc); F.ink.setMatrixAt(i, F.m4);
      F.sc.setScalar(scale); F.m4.compose(pos, F.q, F.sc); F.fill.setMatrixAt(i, F.m4); i++;
    };
    const none = () => { F.ink.setMatrixAt(i, F.zero); F.fill.setMatrixAt(i, F.zero); i++; };
    for (const it of this.items) {
      const cs = it.cs, vis = on && (it.mode === "spiral" || (it.mode === "scatter" && cs.t < 0.4));
      if (step && vis) { cs.trH = (cs.trH + 1) % CEL_TR; cs.tr[cs.trH * 3] = it.g.position.x; cs.tr[cs.trH * 3 + 1] = it.g.position.y; cs.tr[cs.trH * 3 + 2] = it.g.position.z; cs.trN = Math.min(CEL_TR, cs.trN + 1); }
      if (!vis && cs.trN) { if (step) cs.trN = Math.max(0, cs.trN - 2); }
      for (let j = 0; j < CEL_TR; j++) {
        if (j >= cs.trN) { none(); continue; }
        const k = (cs.trH - j + CEL_TR) % CEL_TR;
        put(F.pos.set(cs.tr[k * 3], cs.tr[k * 3 + 1], cs.tr[k * 3 + 2]), TS * (1 - j / CEL_TR), tau * 3 + j);
      }
    }
    // burst shards (flat stars thrown outward, slowing) and the flash: two crossed stars that pop and vanish
    for (let k = 0; k < CEL_SHARDS; k++) {
      const sh = cel.shards[k]; if (!sh || sh.age >= sh.life) { none(); continue; }
      sh.age += dt; sh.p.addScaledVector(sh.v, dt); sh.v.multiplyScalar(Math.exp(-1.6 * dt));
      put(sh.p, 0.9 * Math.max(0, 1 - sh.age / sh.life), sh.spin + sh.age * 5);
    }
    for (let k = 0; k < 2; k++) {
      if (cel.flashAge >= 0 && cel.flashAge < 0.32) { const e = 1 - Math.pow(1 - cel.flashAge / 0.32, 3); put(cel.ctr, 4 * e, k * Math.PI / 4); }
      else none();
    }
    if (cel.flashAge >= 0) cel.flashAge += dt;
    F.ink.visible = F.fill.visible = true; F.ink.instanceMatrix.needsUpdate = F.fill.instanceMatrix.needsUpdate = true;
  }
  /* the camera beat: pull back and tilt up to take in the tall vortex, hold through the climax, then ease home.
     It writes only rig.distWanted and rig.pitch (the same levers as the lookout and cannon framings); a drag, a zoom or
     a scripted focus shot hands the lens back at once. */
  celBeat(dt) {
    const cel = this.cel, B = cel && cel.beat, rg = this.rig; if (!B || B.done || !rg) return;
    const abort = rg.mode !== "follow" || Math.abs(rg.distWanted - B.lastDist) > 1e-6;   // someone else moved the zoom or took the lens
    if (abort) { B.done = true; return; }
    const tau = cel.t, UP0 = 0.2, UP1 = 1.5, DN0 = CEL.SPIRAL_S + 0.2, DN1 = DN0 + 1.4;
    const sm = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
    const k = sm((tau - UP0) / (UP1 - UP0)) * (1 - sm((tau - DN0) / (DN1 - DN0)));
    const dist = Math.min(34, B.dist0 * 1.55), pitch = Math.max(0.2, B.pitch0 - 0.24);
    rg.distWanted = B.dist0 + (dist - B.dist0) * k; B.lastDist = rg.distWanted;
    if (!rg.freed) rg.pitch = B.pitch0 + (pitch - B.pitch0) * k;
    if (tau >= DN1) { rg.distWanted = B.dist0; rg.pitch = B.pitch0; B.done = true; }
  }
  /* after the scatter every butterfly is wild again at its new spot: collectable, with its glint, never "following" */
  release(it, cs) {
    it.mode = "wild"; it.home.copy(cs.home); it.rest = false; it.up.copy(cs.spotUp); tangents(it.up, it.t1, it.t2);
    it.g.scale.setScalar(WILD_S); it.k = 0;
    if (!it.glint) {
      it.glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTexture(), color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false, sizeAttenuation: false }));
      it.glint.position.set(0, 0.55 / WILD_S, 0); it.glint.renderOrder = 2; it.g.add(it.glint);
    }
    it.glint.visible = false; it.l.rotation.z = it.r.rotation.z = 0.8;
  }
  setVisible(v) { for (const it of this.items) it.g.visible = v; }
}

/* ---------- pond water: calm, toon, with the sunset in it and slow ripple rings */
/* sunDir: the sky's live sun Vector3 (sky.sunDir). It is bound by reference, not copied, so the
   glint follows setSun() and the day with no per-frame copy and no second sun to drift. */
export function waterMaterial(sunDir) {
  const m = new THREE.ShaderMaterial({
    transparent: true, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uDeep: { value: new THREE.Color("#5E86C9") }, uShallow: { value: new THREE.Color("#9EC9EE") },
      uGlow: { value: new THREE.Color("#FFC9A6") }, uCentre: { value: new THREE.Vector3() }, uR: { value: 3 },
    }]),
    vertexShader: `varying vec3 vW; varying vec3 vN;
      #include <fog_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime, uR; uniform vec3 uDeep, uShallow, uGlow, uSun, uCentre; varying vec3 vW; varying vec3 vN;
      #include <fog_pars_fragment>
      void main(){
        float r = distance(vW, uCentre) / uR;
        vec3 c = mix(uDeep, uShallow, smoothstep(0.2, 1.0, r));
        // sunset sheen toward the sun
        vec3 V = normalize(cameraPosition - vW); vec3 Rf = reflect(-V, normalize(vN));
        float s = pow(max(dot(Rf, normalize(uSun)), 0.0), 12.0);
        c = mix(c, uGlow, clamp(s * 1.2 + 0.18 * (1.0 - abs(dot(V, normalize(vN)))), 0.0, 0.8));
        // two slow ripple rings
        float rings = 0.0;
        for (int i = 0; i < 2; i++) { float ph = fract(uTime * 0.12 + float(i) * 0.5); rings += smoothstep(0.035, 0.0, abs(r - ph)) * (1.0 - ph); }
        c = mix(c, vec3(1.0), rings * 0.35);
        // soft foam at the rim
        c = mix(c, vec3(1.0, 0.98, 0.95), smoothstep(0.86, 0.99, r) * 0.6);
        gl_FragColor = vec4(c, 0.92);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  m.uniforms.uSun = { value: sunDir };   // after merge(): merge clones values, this must stay the shared one
  return m;
}
