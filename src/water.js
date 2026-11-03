import * as THREE from "three";

/* Pond water that answers Blip.

   Each pond keeps a small ring buffer of ripple sources (pond-local 2D centre, start time,
   strength) that the water shader draws as expanding rings and the lily pads ride on.
   - Rings: per ring a lighter band of constant width (plus a thinner concentric one inside), tiered
     like the water's own toon bands, combined with max(), edges anti-aliased per pixel (no decal, nothing drawn on the ground: the rings live only in the water shader).
   - Lily pads: a vertex-shader bob (each pad moves as one piece, from its own centre), lifted
     and tilted by the same ripple height the JS side computes (pondHeight) for tests.
   - Splash: a few droplets from fx.puff (the inked cel puff) arcing up and back, on landing.
   Wading: Blip CAN walk into the ponds. COL_pond_i is still in the body's collider list (so
   props, fauna and the butterflies' spawn checks keep out of the water) but is flagged `wade`, which the
   player's own collide() skips. There is no pond bed to fall through: the ground under the water is the open
   sphere (Body.surface = R) and the water is a cap a hand's breadth (0.07 m) above it, so the pond is
   shallow everywhere. In the water `wade` (0..1, smoothed, written to player.wade) lowers the figure by
   WADE_SINK and slows him by WADE_SLOW (player.js); the planet's opaque ground cuts him below R and the
   water surface (alpha 0.92) cuts him cleanly above it, and a calm foam collar in the water shader rides at
   his legs. Ripples start at his actual spot while he stands in the water (feet within FEET of the edge, a
   toe on the rim stones counts: the nearest water edge point), a landing in it splashes there, and a jump out
   leaves a ring. Hooks for sound: `onSplash(k, kind)` ("land" | "jump") and `player.wade`. */

export const RIPPLE_N = 8;            // sources per pond (uniform array size; fixed)
export const RIPPLE_SPEED = 0.8;      // m/s ring growth
export const RIPPLE_LIFE = 2.2;       // s until a ring has faded out
export const BOB_AMP = 0.06;          // m lift of a pad at a full-strength ring crest
export const WALK_EVERY = 0.35, STAND_EVERY = 1.5;
const EDGE_ZONE = 0.3;         // m beyond the water edge that still counts as "at the water" (a toe on the rim stones)
export const FEET = 0.1;              // m: feet count as in the water this far outside the edge (the sole is wider than his centre)
export const WADE_IN = 0.5;           // m from the edge over which the wade depth eases 0 -> 1
export const wadeDepth = (dist, r) => { const k = THREE.MathUtils.clamp((r + FEET - dist) / (WADE_IN + FEET), 0, 1); return k * k * (3 - 2 * k); };

/* the ring buffer: Vector4(x, y, t0, strength); a slot is free once t - t0 >= RIPPLE_LIFE */
export class RippleRing {
  constructor(n = RIPPLE_N) { this.v = Array.from({ length: n }, () => new THREE.Vector4(0, 0, -1e4, 0)); this.head = 0; }
  emit(x, y, t, s) { const r = this.v[this.head]; r.set(x, y, t, s); this.head = (this.head + 1) % this.v.length; return r; }
  active(t) { let n = 0; for (const r of this.v) { const a = t - r.z; if (r.w > 0 && a >= 0 && a < RIPPLE_LIFE) n++; } return n; }
}
/* the envelope of one ring at age a (0 outside its life) */
export function ringEnv(a, s) { if (a <= 0 || a >= RIPPLE_LIFE || s <= 0) return 0; const k = 1 - a / RIPPLE_LIFE; return s * k * Math.sqrt(k); }
/* surface lift (m) at pond-local (x, y): the sum of every live ring's crest (the shader's lilyH) */
export function pondHeight(ring, x, y, t) {
  let h = 0;
  for (const r of ring.v) {
    const a = t - r.z, e = ringEnv(a, r.w); if (!e) continue;
    const d = Math.hypot(x - r.x, y - r.y), q = (d - RIPPLE_SPEED * a) / 0.28;
    h += BOB_AMP * e * Math.exp(-q * q);
  }
  return h;
}

const RIP_FN = /* glsl */`
  uniform vec4 uRip[${RIPPLE_N}]; uniform vec3 uE1, uE2, uWadeAt;
  float ripLive(vec4 q, out float a) { a = uTime - q.z; if (a <= 0.0 || a >= ${RIPPLE_LIFE.toFixed(2)} || q.w <= 0.0) return 0.0;
    float k = 1.0 - a / ${RIPPLE_LIFE.toFixed(2)}; return q.w * k * sqrt(k); }
`;
/* the water's rings at a pond-local point -> (light band, white band) coverage, 0..1.
   Each ring is drawn on its own as a band of constant width in metres (RIP_HW half-width) around the
   radius, its distance taken per fragment, its edge anti-aliased over one pixel (derivatives of p, taken
   outside the loop), and rings combine with max(): an overlap never merges two rings into a blob or breaks
   one into arcs. The ring's strength only picks its tier (light / white) and fades it out at the end. */
const RIP_HW = 0.05, RIP_HW2 = 0.035;
export const COLLAR_R = 0.36, COLLAR_HW = 0.04;   // m: radius and half-width of the foam band round his legs
const WATER_FN = RIP_FN + /* glsl */`
  vec2 ripTier(float e) { return vec2(smoothstep(0.12, 0.26, e), smoothstep(0.62, 0.82, e)); }
  vec2 ripBands(vec2 p) {
    float fw = max(0.5 * (length(dFdx(p)) + length(dFdy(p))), 1e-4);
    vec2 b = vec2(0.0);
    for (int i = 0; i < ${RIPPLE_N}; i++) { float a; float e = ripLive(uRip[i], a); if (e <= 0.0) continue;
      float d = length(p - uRip[i].xy), R = ${RIPPLE_SPEED.toFixed(2)} * a;
      b = max(b, smoothstep(${RIP_HW.toFixed(3)} + fw, ${RIP_HW.toFixed(3)} - fw, abs(d - R)) * ripTier(e));
      // a fainter, thinner concentric ring trailing inside (a whole circle of its own)
      b = max(b, smoothstep(${RIP_HW2.toFixed(3)} + fw, ${RIP_HW2.toFixed(3)} - fw, abs(d - R * 0.62)) * ripTier(0.55 * e * smoothstep(0.2, 0.45, a)));
    }
    return b;
  }
`;
const WATER_APPLY = /* glsl */`
  { vec3 rel = vW - uCentre; vec2 rb = ripBands(vec2(dot(rel, uE1), dot(rel, uE2)));
    c = mix(c, mix(uShallow, vec3(1.0), 0.45), rb.x * 0.75);
    c = mix(c, vec3(1.0, 0.99, 0.96), rb.y * 0.7);
    // wading collar: one calm foam band round his legs (a steady circle of constant width; uWadeAt = x, y, strength)
    vec2 wp = vec2(dot(rel, uE1), dot(rel, uE2)); float wfw = max(0.5 * (length(dFdx(wp)) + length(dFdy(wp))), 1e-4);
    float col = smoothstep(${COLLAR_HW.toFixed(3)} + wfw, ${COLLAR_HW.toFixed(3)} - wfw, abs(length(wp - uWadeAt.xy) - ${COLLAR_R.toFixed(3)})) * uWadeAt.z;
    c = mix(c, vec3(1.0, 0.99, 0.96), col * 0.8); }
`;
const LILY_VERT = RIP_FN + /* glsl */`
  uniform vec3 uC, uN; attribute vec3 aPad;
  float lilyH(vec2 p) { float h = 0.0;
    for (int i = 0; i < ${RIPPLE_N}; i++) { float a; float e = ripLive(uRip[i], a); if (e <= 0.0) continue;
      float q = (length(p - uRip[i].xy) - ${RIPPLE_SPEED.toFixed(2)} * a) / 0.28; h += ${BOB_AMP.toFixed(3)} * e * exp(-q * q); }
    return h; }
`;

/* a pond-local frame at centre c on a body centred at o */
function frame(c, o) {
  const n = c.clone().sub(o).normalize(), e1 = new THREE.Vector3(1, 0, 0);
  if (Math.abs(n.dot(e1)) > 0.9) e1.set(0, 0, 1);
  e1.addScaledVector(n, -e1.dot(n)).normalize();
  return { n, e1, e2: new THREE.Vector3().crossVectors(n, e1) };
}

/* the pads in a merged lily mesh: one attribute aPad (pad centre in pond-local 2D, phase), from the
   mesh's connected pieces, so a pad bobs and tilts as one rigid piece */
function padAttribute(geo, c, f) {
  const P = geo.attributes.position, idx = geo.index ? geo.index.array : null, n = P.count;
  const par = new Int32Array(n); for (let i = 0; i < n; i++) par[i] = i;
  const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  if (idx) for (let i = 0; i < idx.length; i += 3) { const a = find(idx[i]); par[find(idx[i + 1])] = a; par[find(idx[i + 2])] = a; }
  // vertices that share a position (split normals / UV seams) belong to the same piece
  const key = new Map(), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(P, i); const k = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`; if (key.has(k)) par[find(i)] = find(key.get(k)); else key.set(k, i); }
  const sums = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); v.fromBufferAttribute(P, i).sub(c); const s = sums.get(r) || [0, 0, 0]; s[0] += v.dot(f.e1); s[1] += v.dot(f.e2); s[2]++; sums.set(r, s); }
  const a = new Float32Array(n * 3), pads = [];
  let k = 0; const ph = new Map();
  for (const [r, s] of sums) { ph.set(r, (k++ * 2.399) % (Math.PI * 2)); pads.push([s[0] / s[2], s[1] / s[2]]); }
  for (let i = 0; i < n; i++) { const r = find(i), s = sums.get(r); a[i * 3] = s[0] / s[2]; a[i * 3 + 1] = s[1] / s[2]; a[i * 3 + 2] = ph.get(r); }
  geo.setAttribute("aPad", new THREE.BufferAttribute(a, 3));
  return pads;
}

const _d = new THREE.Vector3(), _g = new THREE.Vector3(), _s = new THREE.Vector3();
export class PondWater {
  /* ponds: [{ c: Vector3 centre, r, water: ShaderMaterial (life.js waterMaterial), lilies: Mesh|null }];
     origin: the planet's centre; fx: the FX (droplet puffs) */
  constructor(ponds, { origin, fx, body = null }) {
    this.fx = fx; this.body = body; this.enabled = true;
    this.drops = [];   // [{ m, ud, up }] puffs we pull down with gravity
    this.ponds = ponds.map(p => {
      const f = frame(p.c, origin), ring = new RippleRing();
      const pond = { c: p.c.clone(), r: p.r, ...f, ring, walkT: 0, standT: STAND_EVERY * 0.5, pads: [], mat: p.water, lilyU: null, wadeAt: new THREE.Vector3() };
      // water: rings in the fragment shader (anchors in life.js waterMaterial)
      const m = p.water, fs = m.fragmentShader;
      const A1 = "#include <fog_pars_fragment>", A2 = "gl_FragColor = vec4(c, 0.92);";
      if (fs.includes(A1) && fs.includes(A2)) {
        m.fragmentShader = fs.replace(A1, A1 + WATER_FN).replace(A2, WATER_APPLY + A2);
        m.uniforms.uRip = { value: ring.v }; m.uniforms.uE1 = { value: f.e1 }; m.uniforms.uE2 = { value: f.e2 }; m.uniforms.uWadeAt = { value: pond.wadeAt };
        m.needsUpdate = true;
      } else console.warn("water.js: waterMaterial anchors not found; ripples off");
      // lily pads: their own material copy (the GLB shares one across ponds) with the bob
      if (p.lilies) {
        pond.pads = padAttribute(p.lilies.geometry, p.c, f);
        const lm = p.lilies.material = p.lilies.material.clone();
        const u = pond.lilyU = { uRip: { value: ring.v }, uE1: { value: f.e1 }, uE2: { value: f.e2 }, uC: { value: pond.c }, uN: { value: f.n }, uTime: { value: 0 } };
        lm.onBeforeCompile = sh => {
          Object.assign(sh.uniforms, u);
          sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;" + LILY_VERT)
            .replace("#include <begin_vertex>", `#include <begin_vertex>
              { vec2 lp = aPad.xy; float h = lilyH(lp);
                vec2 g = vec2(lilyH(lp + vec2(0.15, 0.0)) - h, lilyH(lp + vec2(0.0, 0.15)) - h) / 0.15;
                vec3 rel = position - uC; vec2 q = vec2(dot(rel, uE1), dot(rel, uE2)) - lp;
                transformed += uN * (h + 0.012 * sin(uTime * 1.2 + aPad.z) + 0.9 * dot(g, q)); }`);
        };
        lm.customProgramCacheKey = () => "lily-bob";
      }
      return pond;
    });
    this.prevH = 0; this.airVr = 0; this.prevPos = new THREE.Vector3(); this.bfly = new Map();
    this.wade = 0; this.lastPlayer = null; this.onSplash = null;   // onSplash(k, "land" | "jump"): the sound hook
  }

  /* pond-local 2D of a world point -> out [x, y, dist] */
  local(p, w, out) { _d.copy(w).sub(p.c); out[0] = _d.dot(p.e1); out[1] = _d.dot(p.e2); out[2] = Math.hypot(out[0], out[1]); out[3] = _d.dot(p.n); return out; }
  /* the source point: Blip's own spot if over the water, else the water edge nearest him */
  edge(p, l, inset = 0.15) { const m = Math.min(l[2], p.r - inset) / Math.max(l[2], 1e-4); l[0] *= m; l[1] *= m; return l; }
  emit(i, x, y, t, s) { return this.ponds[i].ring.emit(x, y, t, s); }

  /* a landing in (or at) the water: two rings and a ring of droplets. side = a unit tangent to throw the
     droplets along (Blip's left/right: the play camera sits behind him, so a spray straight ahead would be
     hidden by his body); null = along the edge */
  splash(p, l, t, k, side = null) {
    this.emit(this.ponds.indexOf(p), l[0], l[1], t, 1.4 * k);
    this.emit(this.ponds.indexOf(p), l[0], l[1], t + 0.18, 0.7 * k);
    if (!this.fx) return;
    const at = p.c.clone().addScaledVector(p.e1, l[0]).addScaledVector(p.e2, l[1]).addScaledVector(p.n, 0.04);
    const ll = Math.hypot(l[0], l[1]) || 1, tg = new THREE.Vector3();
    if (side) tg.copy(side).addScaledVector(p.n, -side.dot(p.n)).normalize();
    else tg.addScaledVector(p.e1, -l[1] / ll).addScaledVector(p.e2, l[0] / ll);
    const n = 6 + Math.round(3 * Math.min(1, (k - 0.6) / 0.9));
    for (let i = 0; i < n; i++) {
      const sd = i % 2 ? 1 : -1, a = (i / n) * Math.PI * 2 + Math.random() * 0.6, out = 0.8 + Math.random() * 0.8;
      const vel = p.n.clone().multiplyScalar((4.2 + Math.random() * 1.6) * Math.min(1.3, k))
        .addScaledVector(p.e1, Math.cos(a) * out).addScaledVector(p.e2, Math.sin(a) * out).addScaledVector(tg, sd * (1.2 + Math.random()));
      const m = this.fx.puff(_g.copy(at).addScaledVector(tg, sd * (0.35 + Math.random() * 0.3)), { size: 0.09 + Math.random() * 0.05, color: new THREE.Color(i % 3 ? "#9EC9EE" : "#E4F2FB"), life: 0.55 + Math.random() * 0.2, vel, grow: 0.9, cool: false });
      this.drops.push({ m, ud: m.userData, up: p.n });
    }
  }

  update(dt, t, player, butterflies) {
    for (const p of this.ponds) if (p.lilyU) p.lilyU.uTime.value = t;
    // droplets: gravity on top of the puff's own drag (only while the puff is still ours)
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      if (d.m.userData !== d.ud || !d.m.parent) { this.drops.splice(i, 1); continue; }
      d.ud.vel.addScaledVector(d.up, -16 * dt);
    }
    // no player (a game, the cannon, a cutscene): let go of the wade so nothing stays sunk or slowed
    if (!this.enabled || !player) {
      this.wade = THREE.MathUtils.damp(this.wade, 0, 14, dt);
      if (this.lastPlayer) this.lastPlayer.wade = this.wade;
      for (const p of this.ponds) p.wadeAt.z = THREE.MathUtils.damp(p.wadeAt.z, 0, 14, dt);
      return;
    }
    this.lastPlayer = player;
    const l = this._l || (this._l = [0, 0, 0, 0]);
    const air = player.height >= 0.05, landed = !air && this.prevH >= 0.05, takeoff = air && this.prevH < 0.05 && player.vr > 1;
    if (air && player.vr < 0) this.airVr = player.vr;
    const moved = dt > 0 ? _g.copy(player.position).sub(this.prevPos).length() / dt : 0;
    this.prevPos.copy(player.position);
    const side = _s.crossVectors(player.up, player.facing);   // Blip's left/right, for the droplets
    let target = 0;
    for (const p of this.ponds) {
      let k = 0;
      if (!(this.body && player.body !== this.body)) {
        this.local(p, player.position, l);
        if (Math.abs(l[3]) <= 3) k = wadeDepth(l[2], p.r);
      }
      if (this.body && player.body !== this.body) { p.walkT = 0; continue; }
      if (k > 0 && !air) target = Math.max(target, k);
      // the foam collar: follows his legs while he stands in it (smoothly in and out)
      const tk = air ? 0 : k;
      p.wadeAt.z = THREE.MathUtils.damp(p.wadeAt.z, tk, 14, dt);
      if (tk > 0) { p.wadeAt.x = l[0]; p.wadeAt.y = l[1]; }
      if (Math.abs(l[3]) > 3 || l[2] > p.r + EDGE_ZONE) { p.walkT = 0; continue; }
      const i = this.ponds.indexOf(p), inside = l[2] < p.r + FEET;
      if (landed) {
        const kk = THREE.MathUtils.clamp(-this.airVr / 8, 0.6, 1.5) * (inside ? 1 : 0.6);
        this.edge(p, l, 0.2); this.splash(p, l, t, kk, inside ? side : null); p.walkT = WALK_EVERY; p.standT = STAND_EVERY;
        if (this.onSplash) this.onSplash(kk, "land");
        continue;
      }
      if (takeoff) { if (inside) { this.edge(p, l, 0.2); this.emit(i, l[0], l[1], t, 0.8); if (this.onSplash) this.onSplash(0.5, "jump"); } continue; }
      if (air) continue;
      if (moved > 0.4 && moved < 20) {
        p.walkT -= dt; p.standT = STAND_EVERY;
        if (p.walkT <= 0) { p.walkT = WALK_EVERY; this.edge(p, l); this.emit(i, l[0], l[1], t, inside ? 0.6 : 0.4); }
      } else {
        p.walkT = 0; p.standT -= dt;
        if (p.standT <= 0) { p.standT = STAND_EVERY; this.edge(p, l); this.emit(i, l[0], l[1], t, 0.3); }
      }
    }
    if (landed) this.airVr = 0;
    this.prevH = player.height;
    this.wade = THREE.MathUtils.damp(this.wade, target, 14, dt);
    player.wade = this.wade;
    this.updateButterflies(t, butterflies);
  }

  updateButterflies(t, butterflies) {
    const l = this._lb || (this._lb = [0, 0, 0, 0]);
    // pond butterflies dip toward the water on the low point of their loop: a tiny ring under them
    if (butterflies && butterflies.items) for (const it of butterflies.items) {
      if (it.mode !== "wild" || it.kind !== "pond" || !it.home) continue;
      const h = _d.copy(it.g.position).sub(it.home).dot(it.up), was = this.bfly.get(it) ?? h;
      this.bfly.set(it, h);
      if (!(h < 0.42 && was >= 0.42)) continue;
      for (let i = 0; i < this.ponds.length; i++) {
        const p = this.ponds[i]; this.local(p, it.g.position, l);
        if (l[2] < p.r + 0.4 && Math.abs(l[3]) < 2) { this.edge(p, l); this.emit(i, l[0], l[1], t, 0.28); break; }
      }
    }
  }
  /* 0..1 how deep in any pond a world point stands (0 = dry): stateless, so a sound hook can ask on the very frame of a
     landing (player.wade has already eased back to 0 while he was in the air) */
  depthAt(world) {
    let k = 0; const l = this._ld || (this._ld = [0, 0, 0, 0]);
    for (const p of this.ponds) { this.local(p, world, l); if (Math.abs(l[3]) <= 3) k = Math.max(k, wadeDepth(l[2], p.r)); }
    return k;
  }
}
