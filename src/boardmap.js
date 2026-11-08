import * as THREE from "three";
import { toonify, outline, inkU } from "./toon.js?v=20261108-2312";

/* The world map as a board game: a two-faced coin. The top face is the northern hemisphere and the
   back face the southern (north = above the planet's equator, world +y, the old map's split), each
   an azimuthal map around its pole (distance from the centre = angle from the pole, the equator on
   the rim), with the real sandy roads and trees and one miniature piece per destination standing
   on an inked base. Drag up or down (or the flip button) to turn the coin over. A piece is a frozen copy of the real thing: every mesh
   on that terrace (terrace, kiosk, game, cast, ink hulls) re-parented into the piece's own frame,
   sharing the world's geometry and materials, so the board always matches the world. Skinned
   figures are baked into their current pose. The moon's landing deck stands on a pedestal at the
   rim of the face it hangs over, toward it. Built on the first open; renders only while open.
   Labels are DOM buttons over the canvas (keyboard and screen readers get them for free). */

const INK = "#1E1F26";
const B = 10;                         // board radius
const COIN_H = 0.7;                   // coin thickness (felt faces sit on either side)
const TOP = COIN_H / 2 + 0.08;        // a face's felt surface, in its face group's frame
const PIECE_S = 0.155;                // world metres -> board for pieces and trees (larger than the map's true scale, so detail reads)
const MOON_SCALE = 0.22;
const PAWN_H = 1.05;                  // the Blip pawn's height on the board
const BASE_H = 0.22;
const LIFT = 0.32;                    // hover lift
const C = { felt: "#8CC870", table: "#EFD9B5", road: "#F0C88E", base: "#F6EEE0", band: "#C4C5BE", found: "#2B2BEE", hover: "#DADBFF", moon: "#D9C3DA", post: "#F6EEE0", pawn: "#2B2BEE" };
const SKIP = /TREE|BUSH|SHROOM|GRASS|CLOUD|SIGN|REED|CATTAIL|LILY|FLOWER|bird|butterfl|GROUND|ROAD|POND|WATER|SKY|STAR|MOON_rock|BODY_|LAND_|flag|COL_/i;

/* one piece per terrace. names: the objects that define it (their outlines, lips and screens come
   along); dests: the map destinations it carries (anchor: the object a destination's label sits over) */
const PIECES = [
  { key: "pin-art", names: ["TERRACE_pin-art"], dests: ["pin-art"] },
  { key: "gravity-pong", names: ["TERRACE_gravity-pong"], dests: ["gravity-pong"] },
  { key: "brand-studio", names: ["TERRACE_brand-studio"], dests: ["brand-studio"] },
  { key: "engraver", names: ["TERRACE_engraver"], dests: ["engraver"] },
  { key: "field", names: ["TERRACE_field", "KIOSK_field_body"], dests: ["field"] },
  { key: "genai-after-hours", names: ["TERRACE_genai-after-hours", "KIOSK_genai-after-hours_body"], dests: ["genai-after-hours"] },
  { key: "orchestrator", names: ["TERRACE_orchestrator", "CAVE_shell", "CAVE_boulders", "TRIGGER_orchestrator", "KIOSK_orchestrator_body"], dests: ["orchestrator"] },
  { key: "the-bracket", names: ["TERRACE_the-bracket", "TRIGGER_the-bracket", "KIOSK_the-bracket_body"], dests: ["the-bracket"] },
  { key: "cannon", names: ["TERRACE_cannon"], dests: ["cannon"] },
  { key: "sea-ai-maturity", names: ["KIOSK_sea-ai-maturity_body"], dests: ["sea-ai-maturity"], own: true },
  { key: "moon", names: ["TERRACE_moon-landing"], dests: ["artboard-42", "moon-cannon"], moon: true,
    anchors: { "artboard-42": "KIOSK_artboard-42_body", "moon-cannon": "CANNON_moon_barrel" } },
];

const shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
const skipped = o => { for (let p = o; p; p = p.parent) if (SKIP.test(p.name || "")) return true; return false; };

function bakeSkinned(m, cache) {
  const key = m.geometry.uuid + "|" + m.skeleton.uuid;
  if (cache.has(key)) return cache.get(key);
  const src = m.geometry.attributes.position, g = m.geometry.clone(), pos = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < src.count; i++) { v.fromBufferAttribute(src, i); m.applyBoneTransform(i, v); pos.setXYZ(i, v.x, v.y, v.z); }
  g.deleteAttribute("skinIndex"); g.deleteAttribute("skinWeight");
  g.computeBoundingBox(); g.computeBoundingSphere();
  cache.set(key, g);
  return g;
}
/* the piece's own copy of a world material, cut at its ground plane (what sits below the planet's
   surface in the world, a terrace's buried foundation, would otherwise show on the board) */
function clipMat(src, plane, cache) {
  if (Array.isArray(src)) return src.map(s => clipMat(s, plane, cache));
  if (!src || !plane) return src;
  if (cache.has(src)) return cache.get(src);
  const c = src.clone();
  c.onBeforeCompile = src.onBeforeCompile; c.customProgramCacheKey = src.customProgramCacheKey;
  c.clippingPlanes = [plane];
  cache.set(src, c);
  return c;
}
/* a static copy of world mesh `m`, placed by `toLocal` (world -> piece frame) */
function copyMesh(m, toLocal, cache, plane = null, mats = null) {
  let c;
  const mat = clipMat(m.material, plane, mats);
  if (m.isSkinnedMesh) c = new THREE.Mesh(bakeSkinned(m, cache), mat);
  else if (m.isInstancedMesh) { c = new THREE.InstancedMesh(m.geometry, mat, m.count); c.instanceMatrix.copy(m.instanceMatrix); if (m.instanceColor) c.instanceColor = m.instanceColor.clone(); }
  else c = new THREE.Mesh(m.geometry, mat);
  c.matrixAutoUpdate = false;
  c.matrix.multiplyMatrices(toLocal, m.matrixWorld);
  c.castShadow = m.castShadow; c.receiveShadow = m.receiveShadow;
  c.renderOrder = m.renderOrder; c.frustumCulled = false;
  c.userData.isOutline = !!m.userData.isOutline;
  c.raycast = () => {};
  return c;
}
/* world-space bound of the non-ink meshes under `objs` */
function worldBox(objs) {
  const box = new THREE.Box3(), b = new THREE.Box3();
  for (const o of objs) {
    o.updateMatrixWorld(true);
    o.traverse(m => {
      if (!m.isMesh || m.isInstancedMesh || !m.geometry || m.userData.isOutline) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      if (!Number.isFinite(m.geometry.boundingBox.min.x)) return;
      box.union(b.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld));
    });
  }
  return box;
}

export function createBoardMap({ world, bodies, games, spots, player, groundU, renderer: mainRenderer, stage, pinsEl }) {
  const planet = bodies.planet, moon = bodies.moon;
  const pr = world.islands.planet.root, mr = world.islands.moon.root;
  const get = n => pr.getObjectByName(n) || mr.getObjectByName(n);
  let worldScene = pr; while (worldScene.parent) worldScene = worldScene.parent;

  // ---- renderer (its own canvas; on failure the labels fall back to a plain list)
  let renderer = null;
  const canvas = stage.querySelector("canvas");
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = mainRenderer.toneMapping; renderer.toneMappingExposure = mainRenderer.toneMappingExposure;
    renderer.outputColorSpace = mainRenderer.outputColorSpace;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  } catch (e) { console.warn("board map: no WebGL, list fallback", e); renderer = null; stage.classList.add("flat"); }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 16 / 10, 0.5, 200);
  scene.add(new THREE.HemisphereLight(0xb2c6e8, 0xddb48e, 0.72));
  const sun = new THREE.DirectionalLight(0xffd3a2, 2.9);
  sun.position.set(-9, 22, 12); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xb4c3e8, 0.45); fill.position.set(10, 8, -6); scene.add(fill);

  // ---- the coin: one face group per hemisphere. faceS is turned over (rotation.x = pi), so with the
  // coin flipped it reads exactly like faceN does face up; both share the equator along the rim
  const board = new THREE.Group(); scene.add(board);
  const N = new THREE.Vector3(0, 1, 0), REF = new THREE.Vector3(0, 0, 1);
  const K = (B * 0.9) / (Math.PI / 2);      // board units per radian from a pole: the equator lands at 0.9 B
  const faces = ["north", "south"].map((key, i) => {
    const pole = i ? N.clone().negate() : N.clone(), ref2 = pole.clone().cross(REF);
    const group = new THREE.Group(); if (i) group.rotation.x = Math.PI; board.add(group);
    return { key, i, pole, ref2, group };
  });
  const hemi = d => (d.y >= 0 ? faces[0] : faces[1]);
  /* planet direction -> (x, 0, z) on face f (its group's frame) */
  function toFace(f, d) {
    const n = d.clone().normalize(), ang = Math.acos(THREE.MathUtils.clamp(n.dot(f.pole), -1, 1));
    const brg = Math.atan2(n.dot(f.ref2), n.dot(REF)), r = Math.min(ang * K, B * 0.94);
    return new THREE.Vector3(Math.cos(brg) * r, 0, -Math.sin(brg) * r);
  }
  const std = c => new THREE.MeshStandardMaterial({ color: c, roughness: 1, metalness: 0 });
  const table = new THREE.Mesh(new THREE.CylinderGeometry(B + 0.5, B + 0.5, COIN_H, 120), std(C.table));
  table.receiveShadow = true; table.castShadow = true; board.add(table);
  const felts = faces.map(f => { const m = new THREE.Mesh(new THREE.CylinderGeometry(B, B, 0.16, 120), std(C.felt)); m.position.y = TOP - 0.08; m.receiveShadow = true; f.group.add(m); return m; });
  const roadMat = std(C.road); roadMat.polygonOffset = true; roadMat.polygonOffsetFactor = -2; roadMat.polygonOffsetUnits = -2; roadMat.side = THREE.DoubleSide;
  const ends = groundU.uEnds.value, starts = groundU.uStarts.value, summit = groundU.uPole.value.clone().normalize();
  for (let i = 0; i < ends.length; i++) {
    const a0 = (starts[i] || summit).clone().normalize(), b = ends[i].clone().normalize();
    const ang = a0.angleTo(b), ax = a0.clone().cross(b).normalize(), M = 48;
    // split the great circle where it crosses the equator: each run goes on its own face
    let run = [], runFace = null;
    const flush = () => { if (runFace && run.length > 1) runFace.group.add(ribbon(run.map(d => toFace(runFace, d)), 0.55, roadMat, TOP + 0.004)); run = []; };
    for (let k = 0; k <= M; k++) {
      const d = a0.clone().applyAxisAngle(ax, ang * k / M), f = hemi(d);
      if (f !== runFace) { const keep = run[run.length - 1]; flush(); runFace = f; if (keep) run.push(keep); }
      run.push(d);
    }
    flush();
  }
  { const f = hemi(summit), hub = new THREE.Mesh(new THREE.CircleGeometry(0.9, 48), roadMat), p = toFace(f, summit);
    hub.rotation.x = -Math.PI / 2; hub.position.set(p.x, TOP + 0.004, p.z); hub.receiveShadow = true; f.group.add(hub); }
  toonify(board);
  outline(board, INK, o => o === table || felts.includes(o));

  // ---- pieces
  const pieces = [];      // { key, root, lift, body, base, band, hit, dests: [{ id, el, anchor(local) }], pop }
  const bakeCache = new Map();
  function buildPiece(P) {
    const named = [];
    for (const n of P.names) {
      named.push(n, n + "_outline");
      if (/^KIOSK_.*_body$/.test(n)) named.push(n.replace("_body", "_screen"));
      if (/^TERRACE_/.test(n)) { const l = n.replace("TERRACE_", "LIP_"); named.push(l, l + "_outline"); }
    }
    const roots = [...new Set(named)].map(get).filter(Boolean);
    if (!roots.length) return null;
    const box = worldBox(P.names.map(get).filter(Boolean));
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() * 0.5;
    const body = P.moon ? moon : planet, up = body.up(c);
    for (const d of P.dests) { const g = games[d]; if (g) { roots.push(g.ctx.group); if (g.pins) roots.push(g.pins.mesh, g.pins.relief); } }
    // everything else standing on the terrace: the cast, the vending machine, the cannon, the screen dressing
    const keep = new Set();
    for (const o of roots) o.traverse(m => keep.add(m));
    const wc = new THREE.Vector3(), dd = new THREE.Vector3();
    worldScene.traverse(m => {
      if (!m.isMesh || keep.has(m) || !m.geometry || (m.isInstancedMesh && m.count > 2000)) return;
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const bs = m.geometry.boundingSphere; if (!bs || !Number.isFinite(bs.radius)) return;
      wc.copy(bs.center).applyMatrix4(m.matrixWorld);
      const rad = bs.radius * m.matrixWorld.getMaxScaleOnAxis();
      dd.copy(wc).sub(c); const h = dd.dot(up), tan = dd.addScaledVector(up, -h).length();
      if (rad < r * 0.8 && tan < r * 0.62 && h > -4 && h < 9 && !skipped(m)) m.traverse(k => keep.add(k));
    });
    // frame: +Y up out of the ground, +Z toward where the visitor stands
    const spot = spots.find(s => s.id === P.dests[0]);
    const fwd = (spot ? spot.pos.clone() : c.clone().add(new THREE.Vector3(1, 0, 0))).sub(c); fwd.addScaledVector(up, -fwd.dot(up));
    if (fwd.lengthSq() < 1e-6) fwd.copy(new THREE.Vector3(1, 0, 0).cross(up)); fwd.normalize();
    const right = up.clone().cross(fwd).normalize();
    const frame = new THREE.Matrix4().makeBasis(right, up, fwd).setPosition(c), toLocal = frame.clone().invert();
    const model = new THREE.Group(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), mats = new Map();
    for (const m of keep) if (m.isMesh && shown(m)) model.add(copyMesh(m, toLocal, bakeCache, plane, mats));
    // local bound; the piece stands with the planet's ground level (where the terrace leaves the grass) on y = 0
    const lb = new THREE.Box3();
    for (const k of model.children) { if (k.userData.isOutline || k.isInstancedMesh) continue; if (!k.geometry.boundingBox) k.geometry.computeBoundingBox(); lb.union(k.geometry.boundingBox.clone().applyMatrix4(k.matrix)); }
    // grass level: the surface on a ring just outside the terrace (surface() at the centre is the terrace top)
    const ringR = Math.max(lb.max.x - lb.min.x, lb.max.z - lb.min.z) * 0.5 * 1.15, side = new THREE.Vector3(), lv = [];
    for (let k = 0; k < 8; k++) {
      side.copy(right).multiplyScalar(Math.cos(k * Math.PI / 4)).addScaledVector(fwd, Math.sin(k * Math.PI / 4));
      const d = c.clone().addScaledVector(side, ringR).sub(body.centre).normalize();
      lv.push(body.centre.clone().addScaledVector(d, body.surface(d)).sub(c).dot(up));
    }
    lv.sort((x, y) => x - y);
    const ground = lv[3];
    const ctr = lb.getCenter(new THREE.Vector3());
    const scale = P.moon ? MOON_SCALE : PIECE_S;
    const shift = new THREE.Matrix4().makeTranslation(-ctr.x, -ground, -ctr.z);
    for (const k of model.children) k.matrix.premultiply(shift);
    // footprint: the widest vertex above the grass (the buried flare of a terrace doesn't count)
    let fr = 0; const vv = new THREE.Vector3();
    for (const k of model.children) {
      if (k.userData.isOutline || k.isInstancedMesh) continue;
      const pa = k.geometry.attributes.position; if (!pa) continue;
      const step = Math.max(1, Math.floor(pa.count / 4000));
      for (let i = 0; i < pa.count; i += step) { vv.fromBufferAttribute(pa, i).applyMatrix4(k.matrix); if (vv.y > 0.05) fr = Math.max(fr, Math.hypot(vv.x, vv.z)); }
    }
    const foot = (fr || Math.max(lb.max.x - lb.min.x, lb.max.z - lb.min.z) * 0.5) * scale;
    const height = Math.max(0.3, (lb.max.y - ground) * scale);
    model.scale.setScalar(scale);
    // base: a cream puck with a band that lights blue once the project is found
    const baseR = Math.max(foot + 0.14, 0.55);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(baseR, baseR + 0.04, BASE_H, 64), std(C.base));
    base.position.y = BASE_H / 2; base.castShadow = base.receiveShadow = true;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(baseR + 0.045, baseR + 0.07, BASE_H * 0.42, 64), std(C.band));
    band.position.y = BASE_H * 0.26; band.castShadow = true;
    const lift = new THREE.Group(); lift.add(model); model.position.y = BASE_H;
    const root = new THREE.Group(); root.add(base, band, lift);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(baseR + 0.1, baseR + 0.1, height + BASE_H + 0.3, 24), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = (height + BASE_H + 0.3) / 2; root.add(hit);
    toonify(root, { keep: o => !(o === base || o === band) });
    outline(root, INK, o => o === base || o === band);
    const face = hemi(P.moon ? moon.centre.clone().sub(planet.centre) : c.clone().sub(planet.centre));
    const piece = { key: P.key, moon: !!P.moon, face, root, model, plane, lift, base, band, hit, foot: baseR, height, hot: 0 };
    // where on the board
    if (P.moon) {
      // on a pedestal at the rim, toward the moon, at the nearest bearing clear of every terrace
      const mp = toFace(face, moon.centre.clone().sub(planet.centre)), yaw0 = Math.atan2(mp.x, mp.z), RR = B * 0.8;
      let at = null;
      for (let k = 0; k < 40 && !at; k++) {
        const yaw = yaw0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.12, p = new THREE.Vector3(Math.sin(yaw) * RR, 0, Math.cos(yaw) * RR);
        if (pieces.every(q => q.face !== face || Math.hypot(q.root.position.x - p.x, q.root.position.z - p.z) > q.foot + baseR + 0.5)) at = p;
      }
      at = at || new THREE.Vector3(Math.sin(yaw0) * RR, 0, Math.cos(yaw0) * RR);
      const postH = 0.55;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, postH, 24), std(C.post));
      post.position.copy(at).setY(TOP + postH / 2); post.castShadow = true;
      const foot2 = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.16, 40), std(C.base)); foot2.position.copy(at).setY(TOP + 0.08); foot2.castShadow = foot2.receiveShadow = true;
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(baseR + 0.3, baseR + 0.18, 0.3, 64), std(C.moon)); disc.position.y = -0.15; disc.castShadow = disc.receiveShadow = true;
      root.add(disc);
      face.group.add(post, foot2);
      toonify(post); toonify(foot2); toonify(disc); outline(post, INK); outline(foot2, INK); outline(disc, INK);
      root.position.copy(at).setY(TOP + postH + 0.3);
    } else {
      root.position.copy(toFace(face, c.clone().sub(planet.centre))).setY(TOP);
      // a terrace near the equator would hang over the rim: pull it in so its base stays on the felt
      const rr = Math.hypot(root.position.x, root.position.z), max = B - baseR - 0.15;
      if (rr > max) { root.position.x *= max / rr; root.position.z *= max / rr; }
    }
    face.group.add(root);
    // label anchors in the piece's local space
    const dests = P.dests.map(id => {
      let anchor = new THREE.Vector3(0, BASE_H + height + 0.12, 0);
      if (P.anchors && P.anchors[id]) {
        const o = get(P.anchors[id]);
        if (o) {
          const ob = worldBox([o]), p = ob.getCenter(new THREE.Vector3()).applyMatrix4(toLocal).applyMatrix4(shift).multiplyScalar(scale);
          anchor = new THREE.Vector3(p.x, BASE_H + p.y + ob.getSize(new THREE.Vector3()).length() * 0.5 * scale + 0.1, p.z);
        }
      }
      return { id, anchor, slot: P.dests.length > 1 ? (P.dests.indexOf(id) ? 1 : -1) : 0 };
    });
    piece.dests = dests;
    return piece;
  }
  // planet pieces first (the moon deck looks for a clear rim spot among them)
  for (const P of [...PIECES.filter(p => !p.moon), ...PIECES.filter(p => p.moon)]) {
    const p = buildPiece(P); if (!p) continue;
    pieces.push(p); p.hit.userData.piece = p;
    // nudge apart any two planet pieces whose bases would touch (bearing kept, distance from the hub eased)
    if (!p.moon) for (let it = 0; it < 6; it++) for (const q of pieces) {
      if (q === p || q.moon || q.face !== p.face) continue;
      const dx = p.root.position.x - q.root.position.x, dz = p.root.position.z - q.root.position.z, d = Math.hypot(dx, dz), min = p.foot + q.foot + 0.25;
      if (d < min && d > 1e-3) { const push = (min - d) / 2; p.root.position.x += dx / d * push; p.root.position.z += dz / d * push; q.root.position.x -= dx / d * push; q.root.position.z -= dz / d * push; }
    }
  }
  renderer && (renderer.localClippingEnabled = true);
  // the planet's trees, at the pieces' scale, where they really stand (any under a piece or on its label are left out)
  pr.children.forEach(t => {
    if (t.isMesh || !/^TREE_\d+$/.test(t.name) || !shown(t)) return;
    t.updateMatrixWorld(true);
    const at = t.getWorldPosition(new THREE.Vector3()), up = planet.up(at), f = hemi(at.clone().sub(planet.centre)), p = toFace(f, at.clone().sub(planet.centre));
    if (Math.hypot(p.x, p.z) > B - 0.5 || pieces.some(q => q.face === f && Math.hypot(q.root.position.x - p.x, q.root.position.z - p.z) < q.foot + 0.75)) return;
    const tf = new THREE.Vector3(1, 0, 0).cross(up).normalize(), right = up.clone().cross(tf).normalize();
    const toLocal = new THREE.Matrix4().makeBasis(right, up, tf).setPosition(at).invert();
    const g = new THREE.Group();
    t.traverse(m => { if (m.isMesh && shown(m)) g.add(copyMesh(m, toLocal, bakeCache)); });
    g.scale.setScalar(PIECE_S); g.position.set(p.x, TOP, p.z);
    f.group.add(g);
  });

  // ---- the pawn: Blip, baked in his current pose and outfit
  const pawn = new THREE.Group(); let pawnFace = faces[0];
  const pawnBase = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.08, 40), std(C.pawn)); pawnBase.position.y = 0.04; pawnBase.castShadow = true;
  const pawnFig = new THREE.Group(); pawn.add(pawnBase, pawnFig);
  toonify(pawnBase); outline(pawnBase, INK);
  let pawnGeos = new Map();
  function bakePawn() {
    pawnFig.clear(); pawnGeos.forEach(g => g.dispose()); pawnGeos = new Map();
    const fig = player.figure || player.group; fig.updateMatrixWorld(true);
    const up = player.up.clone(), f = player.facing.clone().addScaledVector(up, -player.facing.dot(up)).normalize(), right = up.clone().cross(f).normalize();
    const toLocal = new THREE.Matrix4().makeBasis(right, up, f).setPosition(player.position).invert();
    fig.traverse(m => { if (m.isMesh && shown(m)) pawnFig.add(copyMesh(m, toLocal, pawnGeos)); });
    const pb = new THREE.Box3(); for (const k of pawnFig.children) if (!k.userData.isOutline) { if (!k.geometry.boundingBox) k.geometry.computeBoundingBox(); pb.union(k.geometry.boundingBox.clone().applyMatrix4(k.matrix)); }
    pawnFig.scale.setScalar(PAWN_H / Math.max(0.1, pb.max.y - Math.min(0, pb.min.y))); pawnFig.position.y = 0.08;
  }
  function placePawn() {
    const onMoon = player.body === moon;
    let p, y;
    if (onMoon) { const mp = pieces.find(q => q.moon); pawnFace = mp.face; p = mp.root.position.clone().add(new THREE.Vector3(0.6, 0, 0.6)); y = mp.root.position.y; }
    else { const d = player.position.clone().sub(planet.centre); pawnFace = hemi(d); p = toFace(pawnFace, d); y = TOP; }
    pawnFace.group.add(pawn);
    // standing on a piece (Blip is on its terrace): step off it to its front, the side the lens sees
    const clear = (x, z) => pieces.every(q => q.face !== pawnFace || q.moon !== onMoon || Math.hypot(x - q.root.position.x, z - q.root.position.z) > q.foot + 0.3);
    const on = pieces.find(q => q.face === pawnFace && q.moon === onMoon && Math.hypot(p.x - q.root.position.x, p.z - q.root.position.z) < q.foot + 0.3);
    if (on && !onMoon) {
      const R = on.foot + 0.34;
      for (const a of [0.95, -0.95, 1.5, -1.5, 0.5, -0.5, 2.3, -2.3, Math.PI]) {
        const x = on.root.position.x + Math.sin(a) * R, z = on.root.position.z + Math.cos(a) * R;
        if (clear(x, z)) { p.x = x; p.z = z; break; }
      }
    }
    pawn.position.set(p.x, y, p.z);
  }

  // ---- labels
  const labels = new Map();     // id -> { el, piece, dest }
  for (const q of pieces) for (const d of q.dests) {
    const el = document.createElement("button");
    el.type = "button"; el.className = "map-pin"; el.dataset.id = d.id;
    pinsEl.appendChild(el);
    labels.set(d.id, { el, piece: q, dest: d });
  }

  const youEl = document.createElement("span"); youEl.className = "map-you"; youEl.textContent = "You"; youEl.setAttribute("aria-hidden", "true"); pinsEl.appendChild(youEl);
  // which hemisphere is up, and the button that turns the coin over
  const faceEl = document.createElement("p"); faceEl.className = "map-face"; faceEl.setAttribute("aria-live", "polite");
  const flipEl = document.createElement("button"); flipEl.type = "button"; flipEl.className = "map-flip";
  stage.append(faceEl, flipEl);

  // ---- camera, drag, hover
  let flip = 0, flipTo = 0, shownFace = null;
  let yaw = 0, yawTo = 0, open = false, raf = 0, last = 0, hover = null, opts = null, destById = new Map(), t0 = 0;
  const TARGET = new THREE.Vector3(0, 0.2, 1.7), PITCH = 0.8;
  // the distance at which the whole table (rim and the tallest piece) fits the stage, per aspect
  const fitCache = new Map(), rim = [];
  for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; rim.push(new THREE.Vector3(Math.sin(a) * (B + 0.5), -COIN_H / 2, Math.cos(a) * (B + 0.5)), new THREE.Vector3(Math.sin(a) * B * 0.85, TOP + 3.0, Math.cos(a) * B * 0.85)); }
  function place(dist) {
    camera.position.set(Math.sin(yaw) * Math.cos(PITCH) * dist, Math.sin(PITCH) * dist, Math.cos(yaw) * Math.cos(PITCH) * dist).add(TARGET);
    camera.lookAt(TARGET); camera.updateMatrixWorld(true);
  }
  function fitDist() {
    const key = camera.aspect.toFixed(3); if (fitCache.has(key)) return fitCache.get(key);
    // fits at every turn the drag allows, so turning never crops the rim
    let d = 20; const v = new THREE.Vector3(), y0 = yaw;
    const fits = () => [-0.7, -0.35, 0, 0.35, 0.7].every(yy => { yaw = yy; place(d); return rim.every(p => { v.copy(p).project(camera); return Math.abs(v.x) < 0.97 && Math.abs(v.y) < 0.95; }); });
    for (let i = 0; i < 80 && !fits(); i++) d *= 1.03;
    yaw = y0; fitCache.set(key, d); return d;
  }
  function frameCamera() {
    const w = stage.clientWidth || 960, h = stage.clientHeight || 600;
    if (Math.abs(camera.aspect - w / h) > 1e-4) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
    place(fitDist());
    return { w, h };
  }
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const faceUp = f => (f.i ? -1 : 1) * Math.cos(flip);      // +1: this face looks straight up
  const hits = () => pieces.filter(q => faceUp(q.face) > 0.3).map(q => q.hit);
  function pick(e) {
    const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObjects(hits(), false)[0]; if (!h) return null;
    const q = h.object.userData.piece;
    if (q.dests.length === 1) return q.dests[0].id;
    // the moon deck carries two: the nearer label wins
    let best = null, bd = 1e9;
    for (const d of q.dests) { const s = q.root.localToWorld(d.anchor.clone()).project(camera); const dd = Math.hypot(s.x - ndc.x, (s.y - ndc.y) / camera.aspect); if (dd < bd) { bd = dd; best = d.id; } }
    return best;
  }
  function setHover(id) {
    if (id === hover) return;
    hover = id;
    labels.forEach((L, k) => L.el.classList.toggle("hot", k === id));
    canvas.style.cursor = id ? "var(--cur-pt, pointer)" : "";
    if (id && opts && opts.onHover) opts.onHover(id);
  }
  function choose(id) { const d = destById.get(id); if (d && opts) opts.onPick(d); }
  let down = null;
  const FLIP_PX = 0.011;      // radians of flip per pixel dragged up or down
  canvas.addEventListener("pointerdown", e => { down = { x: e.clientX, y: e.clientY, yaw: yawTo, flip: flipTo, mode: null }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", e => {
    if (down) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!down.mode && Math.hypot(dx, dy) > 6) down.mode = Math.abs(dy) > Math.abs(dx) ? "flip" : "turn";
      if (down.mode === "turn") { yawTo = THREE.MathUtils.clamp(down.yaw - dx * 0.006, -0.7, 0.7); setHover(null); return; }
      if (down.mode === "flip") { flipTo = flip = down.flip + dy * FLIP_PX; setHover(null); return; }
    }
    setHover(pick(e));
  });
  canvas.addEventListener("pointerup", e => {
    const was = down; down = null; if (!was) return;
    if (!was.mode) { const id = pick(e); if (id) choose(id); return; }
    // a flip past a third of the way turns the coin over; less springs back
    if (was.mode === "flip") { const moved = flipTo - was.flip; flipTo = Math.abs(moved) > Math.PI / 3 ? was.flip + Math.sign(moved) * Math.PI : was.flip; }
  });
  flipEl.addEventListener("click", () => { flipTo = Math.round(flipTo / Math.PI) * Math.PI + Math.PI; setHover(null); });
  canvas.addEventListener("pointerleave", () => { if (!down) setHover(null); });
  for (const [id, L] of labels) {
    L.el.addEventListener("click", () => choose(id));
    L.el.addEventListener("pointerenter", () => setHover(id));
    L.el.addEventListener("focus", () => setHover(id));
    L.el.addEventListener("pointerleave", () => setHover(null));
    L.el.addEventListener("blur", () => setHover(null));
  }

  // ---- frame loop (only while open)
  const camFwd = new THREE.Vector3(), tmpN = new THREE.Vector3(), wp = new THREE.Vector3(), wup = new THREE.Vector3(); let lastW = 0, lastH = 0;
  const tmp = new THREE.Vector3(), prevRes = new THREE.Vector3(), baseCol = new THREE.Color(C.base), hotCol = new THREE.Color(C.hover);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const easeBack = x => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  function frame(now) {
    if (!open) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now;
    const t = (now - t0) / 1000;
    yaw = THREE.MathUtils.damp(yaw, yawTo, 8, dt);
    if (!(down && down.mode === "flip")) flip = Math.abs(flipTo - flip) < 1e-4 ? flipTo : THREE.MathUtils.damp(flip, flipTo, 6, dt);
    board.rotation.x = flip;
    // the coin rises a little while it turns, so its rim clears the stage floor
    board.position.y = Math.abs(Math.sin(flip)) * 1.2;
    // the face turned underneath would peek out below the near rim: it only shows while the coin is mid-turn
    for (const f of faces) f.group.visible = faceUp(f) > -0.35;
    const up = faces.find(f => faceUp(f) > 0) || faces[0];
    if (up !== shownFace) {
      shownFace = up;
      faceEl.textContent = up.i ? "Southern hemisphere" : "Northern hemisphere";
      flipEl.textContent = up.i ? "Flip to the north" : "Flip to the south";
      flipEl.setAttribute("aria-label", up.i ? "Turn the map over to the northern hemisphere" : "Turn the map over to the southern hemisphere");
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { w, h } = frameCamera();
    if (renderer) {
      if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
      const cur = renderer.getSize(new THREE.Vector2()); if (cur.x !== w || cur.y !== h) renderer.setSize(w, h, false);
    }
    pieces.forEach((q, i) => {
      const ids = q.dests.map(d => d.id), isHot = ids.includes(hover);
      q.hot = THREE.MathUtils.damp(q.hot, isHot ? 1 : 0, 12, dt);
      q.lift.position.y = q.hot * LIFT;
      const k = reduce ? 1 : THREE.MathUtils.clamp((t - 0.06 * i) / 0.45, 0, 1);
      q.root.scale.setScalar(Math.max(0.001, reduce ? 1 : easeBack(k)));
      const found = ids.some(id => opts && opts.found && opts.found.has(id));
      q.band.material.color.set(found ? C.found : C.band);
      q.base.material.color.copy(baseCol).lerp(hotCol, q.hot);
    });
    // each piece's ground cut follows it (hover lift, pop-in scale)
    board.updateMatrixWorld(true);
    for (const q of pieces) {
      const nrm = tmpN.set(0, 1, 0).transformDirection(q.model.matrixWorld), o = tmp.set(0, 0, 0).applyMatrix4(q.model.matrixWorld);
      q.plane.setFromNormalAndCoplanarPoint(nrm, o); q.plane.constant += 0.002;
    }
    pawn.position.y = (player.body === moon ? pieces.find(q => q.moon).root.position.y : TOP) + Math.abs(Math.sin(t * 2.4)) * 0.12;
    pawn.rotation.y = Math.sin(t * 0.8) * 0.25;
    // labels over their pieces
    // labels: a name plate on the front of each piece's base (the side facing the lens)
    camFwd.set(camera.position.x, 0, camera.position.z).normalize();
    if (w !== lastW || h !== lastH) { lastW = w; lastH = h; labels.forEach(L => { L.w = L.h = 0; }); }
    const boxes = [];
    for (const [, L] of labels) {
      if (L.el.hidden) continue;
      const q = L.piece, f = q.foot * q.root.scale.x, fu = faceUp(q.face);
      const vis = THREE.MathUtils.clamp((fu - 0.55) / 0.35, 0, 1);
      L.el.style.opacity = vis.toFixed(2); L.el.classList.toggle("away", vis < 0.05);
      if (vis < 0.05) continue;
      q.root.getWorldPosition(wp); wup.set(0, 1, 0).transformDirection(q.root.matrixWorld);
      tmp.copy(wp).addScaledVector(camFwd, f * 0.97).addScaledVector(wup, (q.moon ? -0.1 : BASE_H * 0.5) * q.root.scale.x); tmp.project(camera);
      const lw = L.w || (L.w = L.el.offsetWidth), lh = L.h || (L.h = L.el.offsetHeight);
      const cx = (tmp.x + 1) / 2 * w, cy = (1 - tmp.y) / 2 * h;
      const x = L.dest.slot < 0 ? cx - lw - 3 : L.dest.slot > 0 ? cx + 3 : cx - lw / 2;
      boxes.push({ L, x, y: cy - lh / 2, w: lw, h: lh, depth: tmp.z });
    }
    // name plates never overlap: nearer pieces keep their spot, a plate behind steps up above its piece's base
    boxes.sort((a, b) => a.depth - b.depth);
    const placed = [], hit = (a, b) => a.x < b.x + b.w + 2 && b.x < a.x + a.w + 2 && a.y < b.y + b.h + 2 && b.y < a.y + a.h + 2;
    for (const b of boxes) {
      for (let k = 0; k < 6 && placed.some(p => hit(b, p)); k++) b.y -= b.h * 0.6;
      b.x = THREE.MathUtils.clamp(b.x, 2, w - b.w - 2); b.y = THREE.MathUtils.clamp(b.y, 2, h - b.h - 2);
      placed.push(b);
      b.L.el.style.transform = `translate(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px)`;
    }
    // the "You" tag over the pawn, stepping up past any plate it would cover
    const pv = THREE.MathUtils.clamp((faceUp(pawnFace) - 0.55) / 0.35, 0, 1); youEl.style.opacity = pv.toFixed(2);
    pawn.getWorldPosition(tmp); wup.set(0, 1, 0).transformDirection(pawn.matrixWorld); tmp.addScaledVector(wup, PAWN_H + 0.2); tmp.project(camera);
    const yw = youEl.offsetWidth || 34, yh = youEl.offsetHeight || 20;
    const you = { x: (tmp.x + 1) / 2 * w - yw / 2, y: (1 - tmp.y) / 2 * h - yh, w: yw, h: yh };
    for (let k = 0; k < 8 && placed.some(p => hit(you, p)); k++) you.y -= yh * 0.6;
    youEl.style.transform = `translate(${you.x.toFixed(1)}px, ${you.y.toFixed(1)}px)`;
    if (renderer) {
      prevRes.copy(inkU.res.value);
      inkU.res.value.set(w * dpr, h * dpr, dpr);
      renderer.render(scene, camera);
      inkU.res.value.copy(prevRes);
    }
  }

  return {
    get isOpen() { return open; },
    scene, camera, pieces, pawn, faces, toFace,
    get side() { return shownFace ? shownFace.key : null; },
    flipTo(side) { const want = side === "south" ? 1 : 0, cur = Math.round(flipTo / Math.PI); if (((cur % 2) + 2) % 2 !== want) flipTo = (cur + 1) * Math.PI; },
    settle() { flip = flipTo; },
    /* dests: [{ id, label, locked }] from main.js; o: { found:Set, onPick(dest), onHover(id) } */
    open(dests, o) {
      opts = o; destById = new Map(dests.map(d => [d.id, d]));
      for (const [id, L] of labels) {
        const d = destById.get(id);
        L.el.hidden = !d;
        if (!d) continue;
        const found = o.found && o.found.has(id);
        if (L.el.textContent !== d.label) { L.el.textContent = d.label; L.w = L.h = 0; }
        L.el.classList.toggle("found", !!found);
        L.el.classList.toggle("locked", !!d.locked);
        L.el.setAttribute("aria-label", d.locked ? "Locked: " + d.locked : "Travel to " + d.label + (found ? " (discovered)" : ""));
      }
      bakePawn(); placePawn();
      // open on Blip's hemisphere
      flip = flipTo = pawnFace.i ? Math.PI : 0; shownFace = null;
      // turn the board so the pawn stands on the near side
      const pp = pawn.position; yaw = yawTo = player.body === moon ? THREE.MathUtils.clamp(Math.atan2(pp.x, pp.z), -0.7, 0.7) : THREE.MathUtils.clamp(Math.atan2(pp.x, pp.z) * 0.35, -0.7, 0.7);
      hover = null; labels.forEach(L => L.el.classList.remove("hot"));
      if (!open) { open = true; t0 = performance.now(); last = 0; raf = requestAnimationFrame(frame); }
    },
    close() { open = false; cancelAnimationFrame(raf); setHover(null); },
    /* M2: render the northern face once, near top-down, into a size x size 2D canvas (the in-world map table's top).
       Own renderer, one render, state restored; returns null while the overlay is open or without WebGL. */
    snapshot(size = 768, found = null) {
      if (!renderer || open) return null;
      const keep = { rx: board.rotation.x, py: board.position.y, aspect: camera.aspect, pawn: pawn.visible, sz: renderer.getSize(new THREE.Vector2()), pr: renderer.getPixelRatio(), vis: faces.map(f => f.group.visible), ps: pieces.map(q => [q.root.scale.x, q.lift.position.y, q.band.material.color.getHex()]), yaw };
      board.rotation.x = 0; board.position.y = 0; faces[0].group.visible = true; faces[1].group.visible = false; pawn.visible = false;
      pieces.forEach(q => { q.root.scale.setScalar(1); q.lift.position.y = 0; if (found) q.band.material.color.set(q.dests.some(d => found.has(d.id)) ? C.found : C.band); });
      board.updateMatrixWorld(true);
      for (const q of pieces) { const nrm = tmp.set(0, 1, 0).transformDirection(q.model.matrixWorld), o = wp.set(0, 0, 0).applyMatrix4(q.model.matrixWorld); q.plane.setFromNormalAndCoplanarPoint(nrm, o); q.plane.constant += 0.002; }
      camera.aspect = 1; camera.updateProjectionMatrix();
      const y0 = yaw; yaw = 0; camera.position.set(0, 52, 9); camera.lookAt(0, 0.4, 0.2); camera.updateMatrixWorld(true); yaw = y0;
      renderer.setPixelRatio(1); renderer.setSize(size, size, false);
      prevRes.copy(inkU.res.value); inkU.res.value.set(size, size, 1);
      renderer.render(scene, camera);
      inkU.res.value.copy(prevRes);
      const out = document.createElement("canvas"); out.width = out.height = size;
      out.getContext("2d").drawImage(renderer.domElement, 0, 0, size, size);
      renderer.setPixelRatio(keep.pr); renderer.setSize(keep.sz.x, keep.sz.y, false);
      board.rotation.x = keep.rx; board.position.y = keep.py; camera.aspect = keep.aspect; camera.updateProjectionMatrix(); pawn.visible = keep.pawn;
      faces.forEach((f, i) => { f.group.visible = keep.vis[i]; });
      pieces.forEach((q, i) => { q.root.scale.setScalar(keep.ps[i][0]); q.lift.position.y = keep.ps[i][1]; q.band.material.color.setHex(keep.ps[i][2]); });
      return out;
    },
    /* one frame now (tests and screenshots: headless can skip rAF) */
    renderNow() { const was = open; open = true; frame(performance.now()); cancelAnimationFrame(raf); open = was; if (was) raf = requestAnimationFrame(frame); },
  };
}

/* a flat strip of width w along the board-space polyline pts, at height y */
function ribbon(pts, w, mat, y) {
  const pos = [], idx = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b.x - a.x, tz = b.z - a.z, L = Math.hypot(tx, tz) || 1, nx = -tz / L * w / 2, nz = tx / L * w / 2;
    pos.push(pts[i].x + nx, y, pts[i].z + nz, pts[i].x - nx, y, pts[i].z - nz);
    if (i) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.setAttribute("normal", new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true;
  return m;
}
