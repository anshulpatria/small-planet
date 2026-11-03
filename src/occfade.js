import * as THREE from "three";

/* Occluder fade. On the lookout's spiral stair the follow camera keeps its own path (extra camera motion
   pumps or puts the lens inside a slab); instead a stair slab, the column/deck/rail or the photo booth that
   stands between the lens and Blip goes see-through.
   How: real alpha blending, see "how a faded mesh is drawn" below. Mode "bayer" is a screen-door dither (4x4 Bayer in
   screen space, cells of OCC_CELL CSS px, discard): on a 1x screen each cell is a whole device pixel and shows a
   visible stipple grid; blending shows an even see-through at any pixel ratio. Either way the pass is depth-correct
   with no pops, and a faded mesh still casts its whole shadow.
   Blockers: every frame, rays from the lens to points on Blip (head, chest, feet, and a ring OCC_PAD m wider
   than his body in the camera plane, plus the same rays from where lens and Blip will be OCC_LEAD_S ahead at
   their current speed, and from the pose the rig is easing the lens to, so the fade has started before the slab actually covers him, running too). A hit
   mesh is held "wanted" for OCC_HOLD_S (no flicker on grazing rays), eases to OCC_MIN in OCC_IN_S (ease-out:
   past 0.35 in ~0.1 s) and back to solid over OCC_OUT_S: never a pop.
   OCC_MIN 0.12: a faded mesh keeps ~2 of 16 pixels (a light stipple, not a grey scrim). OCC_CELL 0.5 CSS px: cells of
   one device pixel on a 2x screen, so the 4x4 pattern is a fine even tint there instead of a 2-px checker (1 px on 1x).
   A hit only counts when it is nearer the lens than Blip's front (OCC_DEPTH m short of his centre along the line of
   sight): the padded side/top rays can end inside the column or a slab standing BESIDE or BEHIND him, which hides nothing.
   Booth mode (panel open, rig in focus): the same test from the booth lens, faded right out (no stipple, as the
   postcard hides them), never the booth itself or the deck Blip stands on. */
const GROUPED = /^(TREE|BUSH|SHROOM|STUDIO_house|MOON_rock)/;   // multi-mesh props whose parts fade together
const LENS_PAD = 0.6;   // m past the near plane: a prop this close to the lens fades whatever the rays say
export const OCC_MIN = 0.12, OCC_IN_S = 0.15, OCC_OUT_S = 0.4, OCC_HOLD_S = 0.25, OCC_PAD = 0.9, OCC_LEAD_S = 0.3, OCC_CELL = 0.5, OCC_DEPTH = 0.35;
const BOOTH_KEEP = /^(BOOTH|LOOKOUT$)/;

/* ---- how a faded mesh is drawn (one global mode; `occFade.mode` switches it at run time for the tests)
   blend  DEFAULT, every pixel ratio. Real alpha blending: a clone of the material with transparent = true and
          opacity = the fade, worn only while the mesh is fading (solid again = the very same untouched opaque material).
          Depth-tested and drawn after every opaque (Blip is opaque, so he is already in the buffer and the slab blends
          over him), so there is nothing to sort against what it hides; depthWrite stays on so a concave piece never
          layers its own back faces over its front. The shadow pass uses three's own depth material, so the whole
          shadow stays. The ink hull is blended with the same opacity. Programs are compiled in warm() before first paint.
   bayer  screen-door (4x4 Bayer, cell = whole device px, discard): the measured reference and a fallback.
   Why blend (measured, HANDOFF "Occluder fade on 1x screens"): the dither is a fixed-amplitude per-pixel pattern whatever
   the pixel ratio (RMS 44 luma against a perfect blend at 1x and at 1.75x; interleaved-gradient noise 43, so no better);
   alpha-to-coverage (4x MSAA) 16 but depends on the GPU's coverage pattern and on MSAA being on; blend 10, with no
   high-frequency energy at all (the rest is the overlap of several faded layers, which a true blend does draw). */
export const FADE_MODES = ["blend", "bayer"];
const FADE_DEFAULT = "blend";
export function pickFadeMode(/* pixelRatio */) { return FADE_DEFAULT; }

const DECL = `
uniform float uOcFade;
uniform float uOcCell;
float ocBayer(vec2 fc) {
  vec2 c = mod(floor(fc / uOcCell), 4.0);
  int i = int(c.x) + 4 * int(c.y);
  const float B[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (B[i] + 0.5) / 16.0;
}
void main() {
  if (uOcFade < 0.999 && ocBayer(gl_FragCoord.xy) > uOcFade) discard;
`;
/* a clone of m for one fade mode. It keeps m's own shader patch (the ink hull's screen-space step) and its Color
   object (so tints that write m.color keep working), and takes its own program key. */
function fadeClone(m, mode, u, cell) {
  const c = m.clone();
  if (m.color) c.color = m.color;
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey.bind(m);
  if (mode === "blend") {
    c.onBeforeCompile = (sh, r) => prev.call(m, sh, r);
    c.transparent = true; c.depthWrite = true;
  } else {
    c.onBeforeCompile = (sh, r) => {
      prev.call(m, sh, r);
      sh.uniforms.uOcFade = u; sh.uniforms.uOcCell = cell;
      sh.fragmentShader = sh.fragmentShader.replace("void main() {", DECL);
    };
  }
  c.customProgramCacheKey = () => prevKey() + "|occfade-" + mode;
  c.userData = { ...m.userData, occBase: m.opacity };
  return c;
}

/* rig: CameraRig; getPlayer(): the Player; renderer: for the pixel ratio; meshes: the meshes that may fade */
export function createOccFade({ rig, getPlayer, renderer, meshes }) {
  const cell = { value: 1 };
  const items = [];
  let mode = pickFadeMode(renderer.getPixelRatio());
  /* one mesh into the fade. Far-zoom props (trees, houses, posts) join through add(); some of them
     keep their ink hull only as a sibling "<name>_outline" (main.js nearProps), so that sibling is found as a fallback and
     faded with the mesh (never a solid black ink silhouette round a see-through tree). */
  function addItem(o) {
    if (!o.isMesh || o.userData.isOutline || o.userData.occFade || Array.isArray(o.material) || !o.material || o.material.visible === false) return null;
    const u = { value: 1 };
    let h = o.userData.hull;
    if (!h && o.parent) { h = o.parent.children.find(c => c.name === o.name + "_outline" && c.isMesh) || null; if (h) o.userData.hull = h; }
    const it = { o, u, k: 0, hold: 0, solid: o.material, hullSolid: h && !Array.isArray(h.material) ? h.material : null, mats: new Map(), mine: new Set() };
    o.userData.occFade = it;
    if (GROUPED.test(o.name)) it.grp = (o.parent ? o.parent.uuid : "") + "|" + o.name.replace(/_\d+$/, "");
    items.push(it);
    return it;
  }
  for (const o of meshes) addItem(o);
  /* the materials a mesh (and its hull) should wear now. `solid` is whatever the rest of the game put on the mesh:
     if something swaps it later (the monument slabs clone theirs to tint them), that one is adopted as the solid. */
  function wear(it) {
    const o = it.o, h = o.userData.hull;
    if (!it.mine.has(o.material) || (h && it.hullSolid && !it.mine.has(h.material))) {
      if (!it.mine.has(o.material)) it.solid = o.material;
      if (h && it.hullSolid && !it.mine.has(h.material)) it.hullSolid = h.material;
      it.mats.clear(); it.mine.add(it.solid); if (it.hullSolid) it.mine.add(it.hullSolid);   // `mine` only grows: a stale clone must still be recognised as ours
    }
    const faded = mode === "blend" ? it.k > 0 : true;
    const get = (kind, base) => { const key = mode + kind; let m = it.mats.get(key); if (!m) { m = fadeClone(base, mode, it.u, cell); it.mats.set(key, m); it.mine.add(m); } return m; };
    const next = faded ? get("m", it.solid) : it.solid;
    if (o.material !== next) o.material = next;
    if (h && it.hullSolid) { const nh = faded ? get("h", it.hullSolid) : it.hullSolid; if (h.material !== nh) h.material = nh; }
    if (faded && mode === "blend") {
      const op = it.u.value, dw = op > 0.01;
      for (const m of [o.material, h && h.material]) if (m && it.mine.has(m)) { m.opacity = (m.userData.occBase ?? 1) * op; m.depthWrite = dw; }
    }
  }
  // every solid starts as its own "mine": so the first wear() does not mistake it for a foreign swap
  for (const it of items) { it.mine.add(it.solid); if (it.hullSolid) it.mine.add(it.hullSolid); }
  const list = items.map(i => i.o);
  let needWarm = false;
  const _lp = new THREE.Vector3(), _ws = new THREE.Vector3(), _box = new THREE.Box3();
  function lensNear(cam) {
    const pad = (cam.near || 0.1) + LENS_PAD, out = new Set(), cp = cam.position;
    for (const it of items) {
      const o = it.o; if (!o.visible || !o.geometry) continue;
      const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); if (!g.boundingBox) g.computeBoundingBox();
      if (!it.ws || it.wsT !== o.matrixWorld.elements[12] + o.matrixWorld.elements[13] * 3 + o.matrixWorld.elements[14] * 7) {   // (re)cache the world sphere when the mesh moved
        const e = o.matrixWorld.elements; it.wsT = e[12] + e[13] * 3 + e[14] * 7;
        it.ws = g.boundingSphere.center.clone().applyMatrix4(o.matrixWorld); _ws.setFromMatrixScale(o.matrixWorld);
        it.sMax = Math.max(_ws.x, _ws.y, _ws.z) || 1; it.wr = g.boundingSphere.radius * it.sMax;
        it.inv = o.matrixWorld.clone().invert();
      }
      if (cp.distanceToSquared(it.ws) > (it.wr + pad) * (it.wr + pad)) continue;
      _lp.copy(cp).applyMatrix4(it.inv); _box.copy(g.boundingBox).expandByScalar(pad / it.sMax);
      if (_box.containsPoint(_lp)) out.add(it);
    }
    return out;
  }
  const ray = new THREE.Raycaster(); ray.firstHitOnly = false;
  const pts = Array.from({ length: 14 }, () => new THREE.Vector3());
  const lastP = new THREE.Vector3(), lastC = new THREE.Vector3(), vP = new THREE.Vector3(), vC = new THREE.Vector3(), camF = new THREE.Vector3();
  let have = false;
  const up = new THREE.Vector3(), right = new THREE.Vector3(), dir = new THREE.Vector3(), base = new THREE.Vector3();
  const fwd = new THREE.Vector3(), mid = new THREE.Vector3(), rel = new THREE.Vector3();
  const centre = new THREE.Vector3(); let rad = 0;
  const bounds = () => { const b = new THREE.Box3(); for (const o of list) b.expandByObject(o); b.getCenter(centre); rad = b.getSize(dir).length() / 2 + 14; };
  bounds();
  let enabled = true;

  /* rays from `from` to pts[0..n); `c` is Blip's centre for this set: hits at or past his front are not blockers */
  function cast(from, n, hit, c) {
    fwd.copy(c).sub(from); const D = fwd.length(); if (D < 0.3) return;
    fwd.divideScalar(D);
    const lim = D - OCC_DEPTH;
    for (let i = 0; i < n; i++) {
      dir.copy(pts[i]).sub(from); const L = dir.length(); if (L < 0.3) continue;
      dir.divideScalar(L);
      ray.set(from, dir); ray.near = 0; ray.far = L - 0.05;
      for (const h of ray.intersectObjects(list, false)) if (rel.copy(h.point).sub(from).dot(fwd) < lim) hit.add(h.object);
    }
  }
  function blockers(cam, pl, booth) {
    const hit = new Set();
    up.copy(pl.viewUp || pl.up).normalize();
    right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    base.copy(pl.position);
    let n = 0;
    const add = (h, s) => pts[n++].copy(base).addScaledVector(up, h).addScaledVector(right, s);
    add(1.3, 0); add(0.75, 0); add(0.15, 0);
    add(1.3, -0.35 - OCC_PAD * 0.6); add(1.3, 0.35 + OCC_PAD * 0.6);
    add(0.75, -0.4 - OCC_PAD); add(0.75, 0.4 + OCC_PAD);
    add(0.15, -0.3 - OCC_PAD * 0.6); add(0.15, 0.3 + OCC_PAD * 0.6);
    add(1.3 + 0.35 + OCC_PAD * 0.6, 0);   // (no point below the feet: the floor he stands on must never fade)
    mid.copy(base).addScaledVector(up, 0.75);
    cast(cam.position, n, hit, mid);
    // booth: the lens is easing to rig.focusPos, so clear that line early too; the follow goal does not apply
    if (booth) { cast(rig.focusPos, n, hit, mid); return hit; }
    // lead: where both will be OCC_LEAD_S from now
    base.addScaledVector(vP, OCC_LEAD_S); n = 0;
    add(1.3, 0); add(0.75, 0); add(0.15, 0);
    mid.copy(base).addScaledVector(up, 0.75);
    cast(camF.copy(cam.position).addScaledVector(vC, OCC_LEAD_S), n, hit, mid);
    // and from where the rig is taking the lens (its pose after the collision pull-in), to now and lead points
    const goal = rig.pose(pl, Math.min(rig.dist, rig.coll), rig.pitch + rig.lift).pos;
    cast(goal, n, hit, mid);
    base.copy(pl.position); n = 0; add(1.3, 0); add(0.75, 0); add(0.15, 0);
    mid.copy(base).addScaledVector(up, 0.75);
    cast(goal, n, hit, mid);
    return hit;
  }

  return {
    items,
    /* more meshes that may fade (the camera rig hands over every non-terrain occluder, so at far zoom a tree
       fades instead of yanking the lens in). Returns how many joined; their fade programs compile on the next update. */
    add(meshes) {
      let n = 0;
      for (const o of meshes) { const it = addItem(o); if (!it) continue; it.extra = true; it.mine.add(it.solid); if (it.hullSolid) it.mine.add(it.hullSolid); list.push(o); n++; }
      if (n) { bounds(); needWarm = true; }
      return n;
    },
    has(o) { const it = o.userData.occFade; return !!it && items.includes(it); },
    get enabled() { return enabled; }, set enabled(v) { enabled = v; },
    get mode() { return mode; }, set mode(v) { if (FADE_MODES.includes(v)) { mode = v; for (const it of items) wear(it); } },
    /* draw every faded material once now (compile its program) so the first fade is not a hitch */
    warm(scene, camera) {
      const was = mode; if (mode === "blend") {
        const k = items.map(i => i.k); for (const it of items) it.k = 1;
        for (const it of items) wear(it);
        try { renderer.compile(scene, camera); } catch (e) { console.warn("occfade warm", e); }
        items.forEach((it, i) => it.k = k[i]); for (const it of items) wear(it);
      }
      return was;
    },
    /* opacity equivalent of a mesh (1 for meshes this module does not manage) */
    opacityOf(o) { const it = o.userData.occFade; return it ? it.u.value : 1; },
    /* booth: the photo-booth panel is open (rig in focus mode) */
    update(dt, active, booth = false) {
      if (needWarm && mode === "blend") {   // compile the newcomers' fade programs once (most share the warmed toon programs)
        needWarm = false; let sc = list[list.length - 1]; while (sc && sc.parent) sc = sc.parent;
        if (sc && sc.isScene) this.warm(sc, rig.camera);
      }
      cell.value = Math.max(1, Math.round(OCC_CELL * renderer.getPixelRatio()));
      const pl = getPlayer(), cam = rig.camera;
      const near = enabled && active && pl && cam.position.distanceTo(centre) < rad + 13 && pl.position.distanceTo(centre) < rad;
      if (pl && dt > 0) {
        if (have) { vP.subVectors(pl.position, lastP).divideScalar(dt); vC.subVectors(cam.position, lastC).divideScalar(dt); }
        if (!have || vP.lengthSq() > 400) vP.set(0, 0, 0);   // a teleport / cannon is not a walk
        if (!have || vC.lengthSq() > 400) vC.set(0, 0, 0);
        lastP.copy(pl.position); lastC.copy(cam.position); have = true;
      }
      const hit = near ? blockers(cam, pl, booth) : null;
      /* a prop the lens is inside or right against (near plane + LENS_PAD) fades too, ray or not: otherwise the near plane
         slices a canopy open and its inverted ink hull shows as solid black crescents. Broad phase: a cached world
         sphere per item; narrow: the camera in the mesh's local box, padded. */
      const lensHit = enabled && active && !booth && rig.fadeProps !== false ? lensNear(cam) : null;
      /* a prop made of several meshes (a tree's canopy lobes TREE_01_1.._3) fades as one: with one lobe see-through, the
         solid neighbour's inverted ink hull, normally buried inside it, showed as solid black crescents */
      const heldGrp = new Set();
      for (const it of items) if (it.grp && !it.o.userData.noOccFade && ((lensHit && lensHit.has(it)) || (hit && hit.has(it.o) && !(it.extra && rig.fadeProps === false)))) heldGrp.add(it.grp);
      const min = booth ? 0 : OCC_MIN;
      for (const it of items) {
        if (it.o.userData.noOccFade) it.hold = 0;   // held solid by a script (the cannon act): eases back to solid, never flickers
        else if ((lensHit && lensHit.has(it)) || (it.grp && heldGrp.has(it.grp))) it.hold = OCC_HOLD_S;
        else if (hit && hit.has(it.o) && !(it.extra && rig.fadeProps === false) && !(booth && BOOTH_KEEP.test(it.o.name))) it.hold = OCC_HOLD_S; else it.hold = Math.max(0, it.hold - dt);
        // k = how far faded (0 solid .. 1 at OCC_MIN). In: exponential ease-out (95% by OCC_IN_S); out: linear over
        // OCC_OUT_S. k itself is continuous either way, and the dither quantises it to 1/16 steps.
        if (it.hold > 0) { it.k += (1 - it.k) * (1 - Math.exp(-3 * dt / OCC_IN_S)); if (it.k > 0.995) it.k = 1; }
        else it.k = Math.max(0, it.k - dt / OCC_OUT_S);
        it.u.value = 1 - (1 - min) * it.k;
        wear(it);
      }
    },
  };
}
