import * as THREE from "three";

/* The planet's TREE_nn meshes wear pillow canopies (blender/build_trees.py -> models/trees.glb).
   Every tree keeps its node (name, transform, colliders, occluder entry) and its own materials; only the geometry is
   swapped, so it must run BEFORE toonify/outline/occluder setup. If the GLB fails the planet.glb trees stay.
   The GLB has 4 variants TREEV_0..3, each three primitives in material order: trunk, canopy main, canopy shade. */

const SLOT = { M_Trunk: 0, M_TreeMain: 1, M_TreeShade: 2 };
const PILLOW_COUNT = 10;   // about a third of the 34 trees
const VARIANT_H = [6.45, 6.6, 6.19, 6.5];   // authored heights, to scale each variant to the planet.glb tree's height

function variantGeometry(gltf) {
  const out = [];
  for (let v = 0; v < 4; v++) {
    const node = gltf.scene.getObjectByName("TREEV_" + v);
    if (!node) return null;
    const parts = [];
    node.traverse(o => { if (o.isMesh) parts.push(o); });
    parts.sort((a, b) => (SLOT[a.material.name] ?? 9) - (SLOT[b.material.name] ?? 9));
    if (parts.length !== 3) return null;
    out.push(parts.map(p => { const g = p.geometry.clone(); for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k); return g; }));   // [trunk, main, shade]
  }
  return out;
}

/* The planet GLB splits each tree into one mesh per material, so a tree is a Group TREE_nn with children TREE_nn_1.. (trunk,
   canopy main, canopy shade; two-colour lollipops have only trunk + canopy). The children keep their names, order, materials
   and the group's transform; each just gets new geometry, so rig.occluders / outline hulls / near-prop fading see the same names. */
export async function installTrees(root, loader, url = "assets/models/trees.glb") {
  if (typeof location !== "undefined" && /[?&]trees=orig/.test(location.search)) return 0;   // debug: show the original planet.glb trees
  const gltf = await new Promise(r => loader.load(url, r, undefined, () => r(null)));
  if (!gltf) return 0;
  const variants = variantGeometry(gltf);
  if (!variants) return 0;
  let n = 0;
  const groups = [];
  root.traverse(o => { if (!o.isMesh && !o.userData.isOutline && /^TREE_\d+$/.test(o.name)) groups.push(o); });
  // Pillow trees are an ADDITION to the mix, not a replacement: only PILLOW_COUNT trees get swapped. Candidates are the plain
  // round-canopy trees (dense three-material canopy: the least distinctive kind, so the lollipops and cones, which are
  // distinctive, are never touched). Picks are farthest-point samples on the sphere (angular spread, not index order), so the
  // pillows land evenly round the planet and never next to each other. Everything else keeps its original planet.glb mesh.
  const info = groups.map(t => {
    const kids = t.children.filter(c => c.isMesh && !c.userData.isOutline).sort((a, b) => a.name.localeCompare(b.name));
    const box = new THREE.Box3(); let verts = 0;
    for (const k of kids) { k.geometry.computeBoundingBox(); box.union(k.geometry.boundingBox); verts += k.geometry.attributes.position.count; }
    const dir = t.getWorldPosition(new THREE.Vector3()).sub(root.getWorldPosition(new THREE.Vector3())).normalize();
    return { t, kids, height: box.max.y, dir, round: kids.length === 3 && verts > 1000 };
  });
  const cand = info.filter(i => i.round);
  const picked = [];
  if (cand.length) {
    picked.push(cand.reduce((a, b) => (a.dir.y > b.dir.y ? a : b)));   // seed: the round tree nearest the north pole
    while (picked.length < Math.min(PILLOW_COUNT, cand.length)) {
      let best = null, bestD = -1;
      for (const c of cand) {
        if (picked.includes(c)) continue;
        const d = Math.min(...picked.map(p => c.dir.angleTo(p.dir)));
        if (d > bestD) { bestD = d; best = c; }
      }
      picked.push(best);
    }
  }
  for (const { t, kids, height } of picked) {
    const idx = +t.name.slice(5);
    const v = height > 6.8 ? [1, 3][idx % 2] : [0, 2][idx % 2];   // tall originals get the tall/tier pillows, wide ones the round/wide
    const s = THREE.MathUtils.clamp(height / VARIANT_H[v], 0.85, 1.2);
    const yaw = (idx * 2.399963) % (Math.PI * 2);   // golden-angle yaw: no two trees face alike (the node transform is untouched)
    const gs = variants[v].map(g => { const c = g.clone(); c.rotateY(yaw); c.scale(s, s, s); return c; });
    kids.forEach((k, i) => {
      const old = k.geometry, g = gs[i];
      g.computeBoundingBox(); g.computeBoundingSphere();
      k.geometry = g; k.userData.pillowTree = v;
      old.dispose();
    });
    n++;
  }
  return n;
}

/* Lollipop trees in planet.glb carry a small darker ball stuck to one side of the round canopy (a third primitive about
   half the canopy's radius, centred off the trunk axis), and the canopy is open where the ball joins it. The ball is
   removed and the canopy rebuilt as a whole ellipsoid of the same size and centre, so a lollipop is one round canopy. */
export function dropLobes(root) {
  const groups = [];
  root.traverse(o => { if (!o.isMesh && !o.userData.isOutline && /^TREE_\d+$/.test(o.name)) groups.push(o); });
  let n = 0;
  for (const t of groups) {
    const kids = t.children.filter(c => c.isMesh && !c.userData.isOutline).sort((a, b) => a.name.localeCompare(b.name));
    if (kids.length !== 3 || kids.some(k => k.userData.pillowTree !== undefined)) continue;
    const [, main, lobe] = kids.map(k => { k.geometry.computeBoundingSphere(); return k; });
    const m = main.geometry.boundingSphere, l = lobe.geometry.boundingSphere;
    const off = Math.hypot(l.center.x - m.center.x, l.center.z - m.center.z);
    if (l.radius > 0.65 * m.radius || off < 0.4 * m.radius) continue;   // a full under-canopy, not a side ball
    main.geometry.computeBoundingBox();
    const box = main.geometry.boundingBox, c = box.getCenter(new THREE.Vector3()), h = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const rxz = Math.max(h.x, h.z), ball = new THREE.SphereGeometry(1, 20, 14);
    ball.scale(rxz, h.y, rxz); ball.translate(0, c.y, 0);
    main.geometry.dispose(); main.geometry = ball;
    lobe.removeFromParent(); lobe.geometry.dispose(); n++;
  }
  return n;
}

/* ---- trees off the roads
   The roads are painted by the ground shader (gRoad in grass.js, 1.4 m half width in main.js paintGround) as great-circle
   arcs whose ends come from groundUniforms; the planet.glb scatter knows nothing of them, so a few trees stand in the
   middle of a road. Each such TREE_nn turns about the planet centre to the nearest point where its whole canopy
   footprint clears every road, on level ground, clear of terraces, ponds, colliders, benches and the other props.
   Its trunk collider turns with it. Runs before toonify / outline / occluders, so ink hulls, BVHs and fades follow. */
export const ROAD_HALF = 1.4;   // m, the painted road's half width
const ROAD_GAP = 0.4;   // m of extra grass between a canopy's edge and the road
const CANOPY_GAP = 1.5;   // m of grass between a moved tree's canopy and any other tree's

export function roadDistance(d, U) {
  const ends = U.uEnds.value, starts = U.uStarts.value, nrm = new THREE.Vector3();
  let road = 1e3;
  for (let i = 0; i < ends.length; i++) {
    const b = ends[i], a0 = starts[i];
    nrm.crossVectors(a0, b); const L = nrm.length();
    if (L < 1e-3) continue; nrm.divideScalar(L);
    const span = Math.acos(THREE.MathUtils.clamp(a0.dot(b), -1, 1));
    const along = Math.acos(THREE.MathUtils.clamp(d.dot(a0), -1, 1)) + Math.acos(THREE.MathUtils.clamp(d.dot(b), -1, 1));
    if (along < span + 0.03) road = Math.min(road, Math.asin(Math.min(1, Math.abs(d.dot(nrm)))) * U.uR.value);
  }
  return road;
}

/* canopy footprint radius: the farthest vertex from the trunk axis, in metres */
function footprint(t, up) {
  const base = t.getWorldPosition(new THREE.Vector3()), v = new THREE.Vector3();
  let r = 0;
  t.traverse(k => {
    if (!k.isMesh || k.userData.isOutline) return;
    const pos = k.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      k.localToWorld(v.fromBufferAttribute(pos, i)).sub(base);
      r = Math.max(r, v.addScaledVector(up, -v.dot(up)).length());
    }
  });
  return r;
}

/* anchors: world.anchors; returns [{name, from, to}] for every tree it moved */
export function clearRoads(root, body, U, anchors) {
  root.updateMatrixWorld(true);
  const C = body.centre, R = body.R, wp = o => o.getWorldPosition(new THREE.Vector3());
  const props = [];
  root.traverse(o => {
    if (o.userData.isOutline) return;
    if (!o.isMesh && /^TREE_\d+$/.test(o.name)) { const p = wp(o); props.push({ o, p, tree: true, r: footprint(o, p.clone().sub(C).normalize()) }); }
    else if (o.isMesh && /^(BUSH|SHROOM)_\d+$/.test(o.name)) props.push({ o, p: wp(o), tree: false, r: 1.1 });
  });
  const keep = [];   // [point, radius] no trunk may come within
  for (const [name, a] of Object.entries(anchors)) {
    if (/^POND_\d+$/.test(name)) keep.push([wp(a), (a.userData.r || 3) + 1.0]);
    else if (name.startsWith("BENCHSPOT_")) keep.push([wp(a), 2.2]);
    else if (name === "SPAWN") keep.push([wp(a), 3.5]);
  }
  const moved = [], q = new THREE.Vector3(), tg = new THREE.Vector3(), t = new THREE.Vector3(), ring = new THREE.Vector3();
  const good = (d, me) => {
    if (roadDistance(d, U) < ROAD_HALF + ROAD_GAP + me.r) return false;
    for (const p of body.plateaus) if (d.angleTo(p.n) < p.t1 + (1.0 + me.r * 0.7) / R) return false;   // trunk off the skirt, canopy off the terrace
    q.copy(C).addScaledVector(d, R);
    tg.set(1, 0, 0).cross(d); if (tg.lengthSq() < 0.01) tg.set(0, 0, 1).cross(d); tg.normalize();
    for (let k = 0; k < 8; k++) {   // level ground under the trunk
      ring.copy(q).addScaledVector(tg.clone().applyAxisAngle(d, k * Math.PI / 4), 1.2).sub(C).normalize();
      if (body.surface(ring) > R + 0.02) return false;
    }
    if (keep.some(([p, r]) => p.distanceTo(q) < r + me.r * 0.5)) return false;
    // the whole canopy footprint stays clear of every collider prop, bush, mushroom and other canopy (CANOPY_GAP of
    // grass between two canopies), so no two canopies intersect and no neighbour stands close enough to shade it
    if (body.colliders.some(c => c !== me.col && !c.wade && c.p.distanceTo(q) < c.r + me.r + 0.3)) return false;
    return props.every(o => o === me || o.p.distanceTo(q) > me.r + o.r + (o.tree ? CANOPY_GAP : 0.5));
  };
  for (const me of props) {
    if (!me.tree) continue;
    const d0 = me.p.clone().sub(C).normalize();
    if (roadDistance(d0, U) >= ROAD_HALF + ROAD_GAP + me.r) continue;
    me.col = body.colliders.find(c => c.p.distanceTo(me.p) < 0.3);
    t.set(1, 0, 0).cross(d0); if (t.lengthSq() < 0.01) t.set(0, 0, 1).cross(d0); t.normalize();
    let to = null;
    search: for (let r = 0.5; r <= 20; r += 0.25) for (let k = 0; k < 48; k++) {   // nearest clear point: rings spiralling out
      const d = me.p.clone().addScaledVector(t.clone().applyAxisAngle(d0, k * Math.PI / 24), r).sub(C).normalize();
      if (good(d, me)) { to = d; break search; }
    }
    if (!to) { console.warn("trees: no clear roadside for", me.o.name); continue; }
    const turn = new THREE.Quaternion().setFromUnitVectors(d0, to);
    const from = me.p.clone(), w = me.p.clone().sub(C).applyQuaternion(turn).add(C);
    const qw = me.o.getWorldQuaternion(new THREE.Quaternion()).premultiply(turn);
    const parentQ = me.o.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    me.o.quaternion.copy(parentQ.multiply(qw));
    me.o.position.copy(me.o.parent.worldToLocal(w.clone()));
    me.o.updateMatrixWorld(true);
    if (me.col) me.col.p.sub(C).applyQuaternion(turn).add(C);
    me.p.copy(w);
    moved.push({ name: me.o.name, from, to: w, shift: +from.distanceTo(w).toFixed(2) });
  }
  return moved;
}
