import * as THREE from "three";

/* Cattails. The GLB's POND_n_reeds are nine stalks in one fan on one side of each pond (the bench side).
   They are hidden at runtime and rebuilt here as natural clumps all round each pond
   rim plus a few outliers a little further out, with the bench wedge (the walk in from the bench to the water),
   the bench, every interaction spot, props and the other ponds kept clear. One merged mesh per pond, drawn
   with the GLB's own toon material (same colour, same shape: a 3-ring tapered stalk with an elongated bulb). */

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* one cattail rooted at `p` (world), growing along `up`, leaning toward `lean` (a tangent vector), pushed into pos/idx */
function addReed(pos, idx, p, up, lean, hh, rStalk) {
  const side = new THREE.Vector3().crossVectors(up, lean).normalize();
  const pts = [0, 0.33, 0.66, 1].map(t => p.clone().addScaledVector(up, hh * t).addScaledVector(lean, 0.16 * hh * t * t));
  const SEG = 6;
  const ringAt = (c, r, tan) => {
    const a = new THREE.Vector3().crossVectors(tan, side).normalize(), b = new THREE.Vector3().crossVectors(tan, a).normalize();
    const base = pos.length / 3;
    for (let k = 0; k < SEG; k++) { const th = k / SEG * Math.PI * 2; pos.push(...c.clone().addScaledVector(a, Math.cos(th) * r).addScaledVector(b, Math.sin(th) * r).toArray()); }
    return base;
  };
  let prev = null;
  for (let i = 0; i < pts.length; i++) {
    const tan = pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[Math.max(i - 1, 0)]).normalize();
    const b = ringAt(pts[i], rStalk * (1 - 0.25 * i / 3), tan);
    if (prev !== null) for (let k = 0; k < SEG; k++) { const k2 = (k + 1) % SEG; idx.push(prev + k, prev + k2, b + k2, prev + k, b + k2, b + k); }
    prev = b;
  }
  // the bulb: an ellipsoid (0.07 x 0.07 x 0.22) round the stalk's top
  const top = pts[3], axis = up.clone().addScaledVector(lean, 0.3).normalize();
  const a = new THREE.Vector3().crossVectors(axis, side).normalize(), b2 = new THREE.Vector3().crossVectors(axis, a).normalize();
  const c = top.clone().addScaledVector(axis, -0.1);
  const RING = 8, ROWS = 6, base = pos.length / 3;
  pos.push(...c.clone().addScaledVector(axis, -0.22).toArray());
  for (let r = 1; r < ROWS; r++) {
    const ph = -Math.PI / 2 + Math.PI * r / ROWS;
    for (let k = 0; k < RING; k++) { const th = k / RING * Math.PI * 2; pos.push(...c.clone().addScaledVector(axis, Math.sin(ph) * 0.22).addScaledVector(a, Math.cos(ph) * Math.cos(th) * 0.07).addScaledVector(b2, Math.cos(ph) * Math.sin(th) * 0.07).toArray()); }
  }
  const tip = pos.length / 3; pos.push(...c.clone().addScaledVector(axis, 0.22).toArray());
  for (let k = 0; k < RING; k++) idx.push(base, base + 1 + (k + 1) % RING, base + 1 + k);
  for (let r = 0; r < ROWS - 2; r++) for (let k = 0; k < RING; k++) {
    const r0 = base + 1 + r * RING, r1 = r0 + RING, k2 = (k + 1) % RING;
    idx.push(r0 + k, r0 + k2, r1 + k2, r0 + k, r1 + k2, r1 + k);
  }
  const last = base + 1 + (ROWS - 2) * RING;
  for (let k = 0; k < RING; k++) idx.push(last + k, last + (k + 1) % RING, tip);
}

/* clumps(pondIndex) -> array of [x, y, z, height] for the test hook; returns { meshes, count, clumps } */
export function buildReeds(pr, { centre, R, anchors, wpos, avoid = () => false }) {
  const out = { meshes: [], count: 0, clumps: [] };
  const maxPond = 8;
  const ponds = [];
  for (let i = 0; i < maxPond; i++) { const a = anchors[`POND_${i}`]; if (a) ponds.push({ i, c: wpos(a), r: a.userData.r || 3 }); }
  const benches = Object.entries(anchors).filter(([n]) => n.startsWith("BENCHSPOT_")).map(([, a]) => wpos(a));
  for (const pd of ponds) {
    const old = pr.getObjectByName(`POND_${pd.i}_reeds`);
    if (!old) continue;
    const rand = rng(9100 + pd.i * 77);
    const n = pd.c.clone().sub(centre).normalize();
    const t1 = new THREE.Vector3(0, 1, 0); if (Math.abs(n.y) > 0.95) t1.set(1, 0, 0);
    t1.cross(n).normalize(); const t2 = new THREE.Vector3().crossVectors(n, t1);
    // this pond's bench: the nearest bench spot; its bearing round the pond is the walk-in wedge
    const bench = benches.slice().sort((x, y) => x.distanceTo(pd.c) - y.distanceTo(pd.c))[0];
    let aB = 0;
    if (bench) { const d = bench.clone().sub(pd.c); aB = Math.atan2(d.dot(t2), d.dot(t1)); }
    const wedge = 0.78;   // +-45 deg either side of the bench bearing stays clear of cattails
    const angDiff = a => Math.abs(Math.atan2(Math.sin(a - aB), Math.cos(a - aB)));
    const at = (a, s) => { const d = t1.clone().multiplyScalar(Math.cos(a)).addScaledVector(t2, Math.sin(a)); return pd.c.clone().sub(centre).addScaledVector(d, s).normalize(); };
    const okPoint = (q, a) => {
      if (angDiff(a) < wedge) return false;
      const w = centre.clone().addScaledVector(q, R);
      if (bench && w.distanceTo(bench) < 3.6) return false;
      if (ponds.some(o => o !== pd && o.c.distanceTo(w) < o.r + 1.4)) return false;
      if (avoid(w)) return false;
      return true;
    };
    // clump plan: [bearing from bench (deg), distance from pond centre beyond the rim, reeds]
    const rim = [[100, 0.85, 5], [150, 0.95, 4], [195, 0.8, 5], [245, 0.9, 4], [290, 0.85, 5]];
    const outer = [[125, 2.4, 3], [220, 2.9, 3], [320, 2.2, 2]];
    const pos = [], idx = [];
    for (const [deg, off, cnt] of [...rim, ...outer]) {
      const a = aB + (deg + (rand() - 0.5) * 24) * Math.PI / 180, s = pd.r + off + (rand() - 0.5) * 0.25;
      let q = at(a, s);
      if (!okPoint(q, a)) continue;
      const cl = []; 
      for (let k = 0; k < cnt; k++) {
        const aa = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * 0.42;
        const q2 = q.clone().addScaledVector(t1.clone().multiplyScalar(Math.cos(aa)).addScaledVector(t2, Math.sin(aa)), rr / R).normalize();
        const w = centre.clone().addScaledVector(q2, R - 0.08);
        const hh = 0.9 + rand() * 0.7 + (off > 2 ? -0.15 : 0);
        const lean = t1.clone().multiplyScalar(Math.cos(aa)).addScaledVector(t2, Math.sin(aa)).addScaledVector(q2, -q2.dot(t1.clone().multiplyScalar(Math.cos(aa)).addScaledVector(t2, Math.sin(aa)))).normalize();
        addReed(pos, idx, w, q2, lean, hh, 0.035);
        cl.push(hh);
      }
      out.count += cnt;
      out.clumps.push({ pond: pd.i, bearing: +(deg).toFixed(0), at: centre.clone().addScaledVector(q, R).toArray().map(x => +x.toFixed(2)), n: cnt });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, old.material);
    m.name = `POND_${pd.i}_reeds_v2`; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = true;
    old.visible = false;
    pr.add(m); out.meshes.push(m);
  }
  return out;
}
