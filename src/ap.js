import * as THREE from "three";

/* AP, the boy who lives in the white igloo studio house.
   ap.glb (blender/build_ap.py) holds a rigged boy, hands in his pockets, with the clips AP_Idle and AP_Walk. He lives
   inside the dome and is hidden unless you knock:
     1. the hinged door swings open (a dark doorway behind it),
     2. he walks out to the doorway and turns his head to look at Blip for a beat,
     3. (optional) one slate line, only AFTER the look,
     4. he turns, walks back in until he is out of sight, and the door closes.
   Everything lives in the house group's own frame (Y up, the door faces +Z), so it follows the
   planet no matter how the house is placed. Time runs on the game's tween/sleep clock, so the
   whole thing is also deterministic under __archipelago.step().
   If ap.glb fails to load, a plain stand-in (capsule boy) plays the same sequence without clips. */

const AP_LINE = "…oh. A visitor. Hey.";
const DOOR = { x: 0.78, open: 1.85, w: 1.56, h: 2.0, rect: 1.38, pad: 0.16, fd: 0.16, R: 3.3 };   // hinge x (screen-right edge of the opening), open angle (rad about Y), arch size, frame pad / depth, dome radius
const Z_IN = 2.7, Z_STEP = 4.0, X_OUT = 0;   // hidden inside the dome / standing just outside the doorway, in its middle
/* AP_Walk is built from the feet (blender/build_ap.py): one cycle carries him STRIDE metres, so the clip phase is driven by the
   distance walked and a planted sole stays fixed on the ground at any speed. He walks at `v`, easing in over `accel` seconds. */
const WALK = { stride: 0.84, v: 0.84, accel: 0.35, decel: 0.45, stop: 0.3 };   // stop: the cycle phase he halts on (left foot planted under him)
/* The doorway turn is a quick pivot on the spot: `steps` short alternating steps, each turning him a share of the way while the
   other foot stays pinned (leg IK over the Idle clip), then one closing step. The hips sink `dip` so the legs can reach.
   3 x 0.24 s + a 0.2 s close: ~0.9 s in all (4 x 0.4 s read as 3-4 slow steps; 2 x 0.15 s was too abrupt). */
const TURN = { steps: 3, t: 0.24, close: 0.2, lift: 0.045, dip: 0.03, shift: 0.018, feetX: 0.088 };
const ease = k => k * k * (3 - 2 * k);
const INK = /Eye|Mouth|Nose|Blush|Brow|Ear|Pocket|Sclera|Iris|Glint|Tooth|Button|Glow|Fur/i;   // face decals, nose, inner ears, pocket lips: no ink hull (no ink line inside the face)

/* The dome (STUDIO_house_1) is an ellipsoid cap on a cylinder: radius 3.3 up to y 1.5, then 3.3*sqrt(1-((y-1.5)/3.1)^2).
   zw(x, y) is the wall's z at the doorway, so door, frame and doorway panel are all bent to the real surface. */
const zw = (x, y) => { const r = y <= 1.5 ? DOOR.R : DOOR.R * Math.sqrt(Math.max(0.02, 1 - ((y - 1.5) / 3.1) ** 2)); return Math.sqrt(Math.max(0.01, r * r - x * x)); };
const HINGE_Z = zw(DOOR.x, 1.0);
/* the arched outline: straight sides, a half-ellipse head. rx grows with pad */
function archPath(P, pad, y0) {
  const rx = DOOR.w / 2 + pad, ry = DOOR.h - DOOR.rect + pad;
  P.moveTo(-rx, y0); P.lineTo(rx, y0); P.lineTo(rx, DOOR.rect);
  P.absellipse(0, DOOR.rect, rx, ry, 0, Math.PI, false);
  P.lineTo(-rx, y0);
  return P;
}
const inArch = (x, y, pad) => { const rx = DOOR.w / 2 + pad, ry = DOOR.h - DOOR.rect + pad; if (y < -pad) return false; if (y <= DOOR.rect) return Math.abs(x) <= rx; return (x / rx) ** 2 + ((y - DOOR.rect) / ry) ** 2 <= 1; };
/* bend an extruded shape onto the wall: shape x is across the doorway (0 = middle), z gets the wall's depth + `dz` */
function bend(g, dz, xOff = 0, zRef = 0) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) - xOff, y = p.getY(i); p.setZ(i, zw(x, y) - zRef + p.getZ(i) + dz); }
  g.computeVertexNormals(); return g;
}
/* the door leaf: the arch, x 0..w (so it hangs left of the hinge), back 2.5 cm off the wall, front 0.5 cm proud of the frame */
function doorGeometry() {
  const s = archPath(new THREE.Shape(), 0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: false, curveSegments: 16, steps: 1 });
  g.translate(DOOR.w / 2, 0, 0);   // x 0..w
  return bend(g, 0.025, DOOR.w - DOOR.x, HINGE_Z);   // world x = local - (w - hinge x)
}
/* the frame: an arch ring (door arch inside, `pad` wide), sunk 4 cm into the wall, front face 12 cm proud of it */
function frameGeometry() {
  const s = archPath(new THREE.Shape(), DOOR.pad, -0.14);
  const hole = archPath(new THREE.Path(), 0, 0); s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: DOOR.fd, bevelEnabled: false, curveSegments: 16, steps: 1 });
  return bend(g, -0.04);
}
/* the dark inside of the doorway: a grid clipped to the (slightly larger) arch, bent onto the wall, just proud of it */
function panelGeometry() {
  const pad = 0.07, nx = 30, ny = 40, hw = DOOR.w / 2 + pad + 0.05, y0 = -0.06, y1 = DOOR.h + pad + 0.05;
  const pos = [], idx = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { const x = -hw + 2 * hw * i / nx, y = y0 + (y1 - y0) * j / ny; pos.push(x, y, zw(x, y) + 0.014); }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const cx = -hw + 2 * hw * (i + 0.5) / nx, cy = y0 + (y1 - y0) * (j + 0.5) / ny;
    if (!inArch(cx, cy, pad)) continue;
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 2, d = a + nx + 1;
    idx.push(a, b, c, a, c, d);   // counter-clockwise seen from +Z
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

/* a plain stand-in used only when ap.glb is missing */
function fallbackBoy() {
  const g = new THREE.Group(), m = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });
  const add = (geo, c, x, y, z, name) => { const o = new THREE.Mesh(geo, m(c)); o.position.set(x, y, z); if (name) o.material.name = name; g.add(o); return o; };
  add(new THREE.CapsuleGeometry(0.2, 0.55, 4, 10), "#DACDB5", 0, 1.05, 0);
  add(new THREE.CylinderGeometry(0.2, 0.22, 0.5, 12), "#8E857A", 0, 0.45, 0);
  const head = new THREE.Group(); head.position.set(0, 1.62, 0); head.name = "AP_Head"; g.add(head);
  const sk = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), m("#EDB89B")); head.add(sk);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8, 0, 6.3, 0, 1.5), m("#33261F")); hair.position.y = 0.02; head.add(hair);
  add(new THREE.BoxGeometry(0.12, 0.17, 0.22), "#6A4330", -0.3, 0.78, 0);
  return g;
}

/* ctx: { scene, loader, house, toonify, outline, charInk, tween, sleep, slate, player, sfx }.
   Resolves to { holder, knock(), busy, state, door, ... }. */
let ap_hiddenOriginal = [];
export async function installAP(ctx) {
  const { house, tween, sleep, player } = ctx;
  if (!house) return null;
  const glb = await new Promise(r => ctx.loader.load("assets/models/ap.glb", r, undefined, () => r(null)));
  const root = new THREE.Group(); root.name = "AP_root"; house.add(root);

  // ---- the doorway: the house's ORIGINAL door is a blue bulge baked into STUDIO_house (the primitive with the M_Signal material, a
  // 1.7 x 2.1 m patch on the +Z wall). Hide it at load, so the hinged door is the only door, and reuse its colour.
  let doorCol = "#1D1CB8"; ap_hiddenOriginal = []; let domeMat = null;
  house.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    const mn = (o.material && o.material.name) || "";
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    if (/M_Clay_White/.test(mn) && !o.userData.isOutline && !domeMat) domeMat = o.material;
    const isDoor = /M_Signal/.test(mn) || (bb.min.z > 2.6 && bb.max.z < 3.7 && Math.abs(bb.min.x) < 1 && Math.abs(bb.max.x) < 1 && bb.max.y < 2.4);
    if (isDoor) { o.visible = false; ap_hiddenOriginal.push(o); if (/M_Signal/.test(mn) && o.material.color) doorCol = "#" + o.material.color.getHexString(); }
  });
  const tune = ctx.toonify;
  // the opening: a door-shaped dark panel on the wall, inside an arch frame (same cream as the dome, inked), so the door sits IN it
  const dark = new THREE.Mesh(panelGeometry(), new THREE.MeshBasicMaterial({ color: "#1F1A24" }));
  dark.name = "AP_doorway"; root.add(dark);
  const frame = new THREE.Mesh(frameGeometry(), domeMat || new THREE.MeshStandardMaterial({ color: "#EBD3BE", roughness: 0.9 }));
  frame.name = "AP_doorframe"; frame.castShadow = true; frame.receiveShadow = true; root.add(frame);
  ctx.outline(frame, "#1E1F26", () => true, ctx.charInk);
  const hinge = new THREE.Group(); hinge.name = "AP_door_hinge"; hinge.position.set(DOOR.x, 0, HINGE_Z);   // on the frame's right edge, so the open door swings away from the knocking spot (the left)
  const leaf = new THREE.Group(); leaf.position.x = -DOOR.w; hinge.add(leaf);
  const slab = new THREE.Mesh(doorGeometry(), new THREE.MeshStandardMaterial({ color: doorCol, roughness: 0.8 }));
  slab.name = "AP_door"; slab.castShadow = true; slab.receiveShadow = true;
  leaf.add(slab);
  // brass knob so it reads as a door (on the leaf's free edge)
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshStandardMaterial({ color: "#F2C14E", roughness: 0.6 }));
  knob.material.name = "AP_knob"; knob.position.set(0.2, 1.0, zw(DOOR.x - DOOR.w + 0.2 - 0 , 1.0) - HINGE_Z + 0.17); leaf.add(knob);
  root.add(hinge);
  tune(hinge);
  ctx.outline(hinge, "#1E1F26", o => o !== knob, ctx.charInk);

  // ---- the boy
  const holder = new THREE.Group(); holder.name = "AP_holder"; holder.position.set(0, 0, Z_IN); holder.visible = false; root.add(holder);
  let mixer = null, actions = {}, current = null, head = null, usedGlb = false;
  if (glb) {
    const body = glb.scene; usedGlb = true;
    holder.add(body);
    body.traverse(o => { if (o.isMesh) { o.castShadow = !/Eye|Mouth|Blush|Brow|EarIn|Pocket/.test((o.material && o.material.name) || ''); o.receiveShadow = true; o.frustumCulled = false; } if (o.isBone && o.name === "AP_Head") head = o; });
    tune(holder);
    ctx.outline(holder, "#1E1F26", o => !INK.test(o.material && o.material.name), ctx.charInk);
    mixer = new THREE.AnimationMixer(body);
    for (const clip of glb.animations) actions[clip.name.replace(/^AP_/, "")] = mixer.clipAction(clip);
    if (actions.Idle) { actions.Idle.play(); current = actions.Idle; }
    if (actions.Walk) actions.Walk.timeScale = 0;   // its time is set from the distance walked (see the ticker)
  } else {
    const f = fallbackBoy(); holder.add(f); head = f.getObjectByName("AP_Head");
    f.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    tune(holder); ctx.outline(holder, "#1E1F26", o => !INK.test(o.material && o.material.name), ctx.charInk);
  }
  const setAnim = (name, fade = 0.25) => {
    const a = actions[name]; if (!a || a === current) return;
    a.reset().setEffectiveWeight(1).play();
    if (current) current.crossFadeTo(a, fade, false);
    current = a;
  };

  // ---- the head-turn is layered on top of whatever clip is playing (after the mixer, each frame)
  const ap = { hiddenOriginal: ap_hiddenOriginal, holder, door: hinge, dark, frame, usedGlb, busy: false, headYaw: 0, headPitch: 0, phase: "hidden", log: [], hinge, root };
  const tmpA = new THREE.Quaternion(), tmpB = new THREE.Quaternion(), axis = new THREE.Vector3(), rax = new THREE.Vector3();
  const applyHead = () => {
    if (!head || (!ap.headYaw && !ap.headPitch)) return;
    head.parent.getWorldQuaternion(tmpA);   // parent bone, world
    holder.getWorldQuaternion(tmpB);        // his own frame, world
    axis.set(0, 1, 0).applyQuaternion(tmpB).applyQuaternion(tmpA.clone().invert());
    head.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, ap.headYaw));
    if (ap.headPitch) {
      rax.set(1, 0, 0).applyQuaternion(tmpB).applyQuaternion(tmpA.invert());
      head.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(rax, ap.headPitch));
    }
  };
  const feet = [], _ft = new THREE.Vector3(), ANKLE_Y = 0.085;   // the ankle bones and their height with the sole flat on the ground
  holder.traverse(o => { if (o.isBone && /^AP_Foot/.test(o.name)) feet.push(o); });
  const gait = { dist: 0, phase0: 0 };   // metres walked on the current path, and the cycle phase it started on
  /* leg IK for the stepping turn: each ankle is put on its target (in the root frame) with the knee bending forward, the sole flat
     at the foot's own yaw. Runs after the mixer, so the upper body keeps the Idle clip. */
  const legs = {}, hipsBone = holder.getObjectByName("AP_Hips");
  for (const sd of ["L", "R"]) {
    const thigh = holder.getObjectByName("AP_Thigh" + sd), shin = holder.getObjectByName("AP_Shin" + sd), foot = holder.getObjectByName("AP_Foot" + sd);
    if (thigh && shin && foot) legs[sd] = { thigh, shin, foot, pin: new THREE.Vector3(), yaw: 0, qrel: new THREE.Quaternion(), x: sd === "L" ? TURN.feetX : -TURN.feetX };
  }
  const turn = { on: false, dip: 0, hipY: 0 };   // hipY: the Idle hip height the dip is taken from
  const _h = new THREE.Vector3(), _k = new THREE.Vector3(), _a = new THREE.Vector3(), _t = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3();
  const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qy = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  const aim = (bone, from, to) => {   // swing `bone` so the world direction `from` turns onto `to`
    _q.setFromUnitVectors(from, to); bone.getWorldQuaternion(_qb); bone.parent.getWorldQuaternion(_qp);
    bone.quaternion.copy(_qp.invert().multiply(_q.multiply(_qb))); bone.updateMatrixWorld(true);
  };
  const legIK = () => {
    hipsBone.position.y = turn.hipY - turn.dip; holder.updateMatrixWorld(true);
    const fwd = _w.set(0, 0, 1).transformDirection(holder.matrixWorld).clone();
    for (const L of Object.values(legs)) {
      L.thigh.getWorldPosition(_h); L.shin.getWorldPosition(_k); L.foot.getWorldPosition(_a);
      const a = _k.distanceTo(_h), b = _a.distanceTo(_k);
      root.localToWorld(_t.copy(L.pin));
      _d.copy(_t).sub(_h); const d = Math.min(_d.length(), (a + b) * 0.9995); _u.copy(_d).normalize();
      const ca = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sa = Math.sqrt(1 - ca * ca);
      const pole = fwd.clone().addScaledVector(_u, -fwd.dot(_u)).normalize();
      const knee = _h.clone().addScaledVector(_u, a * ca).addScaledVector(pole, a * sa);
      aim(L.thigh, _k.clone().sub(_h).normalize(), knee.clone().sub(_h).normalize());
      L.shin.getWorldPosition(_k); L.foot.getWorldPosition(_a);
      aim(L.shin, _a.clone().sub(_k).normalize(), _h.clone().addScaledVector(_u, d).sub(_k).normalize());
      root.getWorldQuaternion(_q).multiply(_qy.setFromAxisAngle(Y, L.yaw)).multiply(L.qrel);   // the sole flat, at the foot's yaw
      L.shin.getWorldQuaternion(_qp); L.foot.quaternion.copy(_qp.invert().multiply(_q)); L.foot.updateMatrixWorld(true);
    }
  };
  let last = 0;
  tween(1e9, k => {   // a ticker on the game's own clock (runTimers), so it also runs under step()
    const t = k * 1e9, dt = Math.min(0.1, Math.max(0, t - last)); last = t;
    if (actions.Walk) { const f = gait.phase0 + gait.dist / WALK.stride; actions.Walk.time = (f - Math.floor(f)) * actions.Walk.getClip().duration; }
    if (mixer && holder.visible) {
      mixer.update(dt);
      if (feet.length) {   // a crossfade between Idle and Walk can blend a sole below the ground: lift him by that much, never more
        holder.position.y = 0; holder.updateMatrixWorld(true);
        let lo = 9; for (const f of feet) lo = Math.min(lo, root.worldToLocal(f.getWorldPosition(_ft)).y);
        holder.position.y = turn.on ? 0 : Math.max(0, ANKLE_Y - lo);
      }
      if (turn.on) legIK();
    }
    if (holder.visible) { holder.updateMatrixWorld(true); applyHead(); }
  });
  const setDoor = a => { hinge.rotation.y = a; };
  const place = z => holder.position.set(X_OUT, 0, z);
  /* walk along path(s) -> [x, z, yaw] for D metres: speed eases in (and out, if `stop`), the cycle phase follows the distance */
  const walkPath = (path, D, phase0, stop) => {
    const { v, accel: ta } = WALK, td = stop ? WALK.decel : 0, T = D / v + (ta + td) / 2;
    gait.dist = 0; gait.phase0 = phase0;
    return tween(T, k => {
      const t = k * T;
      const sd = t < ta ? 0.5 * v * t * t / ta : (t <= T - td ? v * (t - ta / 2) : D - 0.5 * v * (T - t) ** 2 / td);
      const [x, z, yaw] = path(Math.min(D, sd)); gait.dist = sd;
      holder.position.set(x, 0, z); holder.rotation.y = yaw;
    });
  };
  const stopPhase = D => { const f = WALK.stop - D / WALK.stride; return f - Math.floor(f); };   // start phase that halts on WALK.stop
  /* turn on the spot from his current yaw to y1: the foot on the turning side steps first; while a foot is lifted the body turns
     its share and leans onto the planted foot, which stays pinned; a last step brings the trailing foot alongside */
  const stepTurn = async y1 => {
    const y0 = holder.rotation.y, c = holder.position.clone(), sg = y1 < y0 ? -1 : 1, N = TURN.steps;
    holder.updateMatrixWorld(true);
    const hq = holder.getWorldQuaternion(new THREE.Quaternion()).invert();
    for (const L of Object.values(legs)) { L.foot.getWorldPosition(_a); L.pin.copy(root.worldToLocal(_a)); L.yaw = y0; L.qrel.copy(hq).multiply(L.foot.getWorldQuaternion(_q)); }
    const order = sg < 0 ? ["R", "L"] : ["L", "R"];   // his right foot is -X, so a turn to his right opens with it
    const spot = (L, yaw) => new THREE.Vector3(c.x + L.x * Math.cos(yaw), ANKLE_Y, c.z - L.x * Math.sin(yaw));
    turn.on = true; turn.dip = 0; turn.hipY = hipsBone.position.y;
    for (let i = 0; i <= N; i++) {
      const L = legs[order[i % 2]], other = legs[order[(i + 1) % 2]], last = i === N;
      const ya = y0 + (y1 - y0) * Math.min(i, N) / N, yb = last ? y1 : y0 + (y1 - y0) * (i + 1) / N;
      const from = L.pin.clone(), fy = L.yaw, to = spot(L, yb), lean = other.pin.clone().sub(c).setY(0);
      await tween(last ? TURN.close : TURN.t, k => {
        const e = smoother(k), up = Math.sin(Math.PI * k);
        holder.rotation.y = ya + (yb - ya) * e;
        holder.position.copy(c).addScaledVector(lean, (TURN.shift / TURN.feetX) * up).setY(0);
        L.pin.copy(from).lerp(to, e); L.pin.y = ANKLE_Y + TURN.lift * up; L.yaw = fy + (yb - fy) * e;
        turn.dip = TURN.dip * (i === 0 ? ease(Math.min(1, k * 2)) : last ? 1 - ease(k) : 1);
      });
      L.pin.copy(to); L.yaw = yb;
    }
    turn.on = false; turn.dip = 0; hipsBone.position.y = turn.hipY; holder.position.copy(c); holder.rotation.y = y1;
  };
  const log = s => { ap.phase = s; ap.log.push(s); };

  /* where Blip stands to knock, and a world position for the slate */
  ap.standLocal = new THREE.Vector3(-1.8, 0, 5.4);   // the spot's own position (the mark below is the same place)
  ap.worldFoot = () => holder.localToWorld(new THREE.Vector3(0, 0, 0));
  ap.knockSpot = () => { house.updateWorldMatrix(true, false); return house.localToWorld(ap.standLocal.clone()); };

  /* The knock shot: ONE fixed framing in the house's own frame: the lens stands front-right of the
     doorway at a fixed distance and height, so Blip (at the fixed knock spot, left of the door) and AP in the doorway are both in
     frame, whatever way Blip came in. The lens is driven on an exact path: a quintic ease (zero speed and acceleration at both
     ends) that swings round the shot's pivot (angle, radius and height are eased separately, so it arcs round the dome, never
     through it). rig.focus() lerps toward its target at a fixed rate, so each frame the target is set to the point that makes
     that lerp land exactly on the path. The way back eases to the follow pose the rig will take on
     release (its yaw chosen so the follow ray is clear of the house: no occluder pull-in), so release() is seamless. */
  const SHOT = { cam: new THREE.Vector3(2.5, 2.0, 9.7), look: new THREE.Vector3(-0.2, 1.05, 4.2), tIn: 1.8, tOut: 1.7, swing: 1.6, rate: 3 };
  const smoother = k => k * k * k * (k * (6 * k - 15) + 10);
  const camJob = { job: null };
  const houseUp = () => house.localToWorld(new THREE.Vector3(0, 1, 0)).sub(house.localToWorld(new THREE.Vector3())).normalize();
  // pose in the house frame: offset from the pivot as (angle in the X/Z plane, horizontal radius, height)
  const polar = v => { const o = v.clone().sub(SHOT.look); return { a: Math.atan2(o.x, o.z), r: Math.hypot(o.x, o.z), h: o.y }; };
  const fromPolar = (p, out) => out.set(SHOT.look.x + Math.sin(p.a) * p.r, SHOT.look.y + p.h, SHOT.look.z + Math.cos(p.a) * p.r);
  const camPath = (fromCamW, fromLookW, toCamL, toLookL, dur, upTo) => new Promise(res => {
    house.updateWorldMatrix(true, false);
    const c0 = polar(house.worldToLocal(fromCamW.clone())), c1 = polar(toCamL);
    let da = c1.a - c0.a; da = Math.atan2(Math.sin(da), Math.cos(da));   // the short way round
    dur += SHOT.swing * Math.abs(da) / Math.PI;   // a long swing (coming from behind the house) gets more time, so the lens never whips round
    camJob.job = { t: 0, dur, c0, c1, da, l0: house.worldToLocal(fromLookW.clone()), l1: toLookL.clone(), up0: ctx.rig.camera.up.clone(), upTo, res };
  });
  const _pc = new THREE.Vector3(), _pl = new THREE.Vector3(), _fp = new THREE.Vector3(), _fl = new THREE.Vector3();
  tween(1e9, (() => { let last = 0; return k => {   // the lens driver, on the game clock with the frame's own dt
    const t = k * 1e9, dt = Math.max(0, t - last); last = t;
    const j = camJob.job, rig = ctx.rig; if (!j || !rig || dt <= 0) return;
    j.t = Math.min(j.dur, j.t + dt);
    const e = smoother(j.t / j.dur);
    house.updateWorldMatrix(true, false);
    fromPolar({ a: j.c0.a + j.da * e, r: j.c0.r + (j.c1.r - j.c0.r) * e, h: j.c0.h + (j.c1.h - j.c0.h) * e }, _pc); house.localToWorld(_pc);
    _pl.copy(j.l0).lerp(j.l1, e); house.localToWorld(_pl);
    const a = 1 - Math.exp(-dt * SHOT.rate), cam = rig.camera;   // the rig moves a of the way to its target this frame: aim past, land on the path
    _fp.copy(_pc).sub(cam.position).divideScalar(a).add(cam.position);
    _fl.copy(_pl).sub(rig.look).divideScalar(a).add(rig.look);
    rig.focus(_fp, _fl, j.up0.clone().lerp(j.upTo, e).normalize());
    if (j.t >= j.dur && !j.done) { j.done = true; j.res(); }
  }; })());
  const camFocus = () => {
    const rig = ctx.rig; if (!rig) return Promise.resolve();
    ap.camFocused = true;
    return camPath(rig.camera.position, rig.look, SHOT.cam, SHOT.look, SHOT.tIn, houseUp());
  };
  // hold: keep aiming at the shot (the driver keeps the job's end pose)
  const camBack = async () => {
    const rig = ctx.rig; if (!rig || !ap.camFocused) return;
    // the follow pose release() will take: Blip's up, the home pitch, a yaw from the shot toward Blip, turned until the follow ray is clear
    const up = (player.viewUp || player.up).clone(), from = player.position.clone().addScaledVector(up, 1.3);
    rig.up.copy(up); rig.pitch = rig.homePitch; rig.lift = 0; rig.freed = false;
    const base = player.position.clone().sub(rig.camera.position); base.addScaledVector(up, -base.dot(up)).normalize();
    let best = null;
    for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4]) {
      rig.fwd.copy(base).applyAxisAngle(up, off);
      const probe = rig.pose(player, rig.dist, rig.pitch);
      const dir = probe.pos.clone().sub(from), len = dir.length(); dir.divideScalar(len);
      let hit = null;
      if (rig.occluders) { rig.ray.set(from, dir); rig.ray.far = len + 0.5; hit = rig.ray.intersectObjects(rig.occluders, false).find(h => h.object.visible); }
      if (!hit) { best = off; break; }
    }
    rig.fwd.copy(base).applyAxisAngle(up, best ?? 0);
    rig.distWanted = rig.dist; rig.coll = rig.dist;
    rig.seenFwd.copy(rig.fwd); rig.seenPitch = rig.pitch; rig.mvFwd.copy(rig.fwd); rig.mvAng = null;
    const p = rig.pose(player, rig.dist, rig.pitch);
    house.updateWorldMatrix(true, false);
    await camPath(rig.camera.position, rig.look, house.worldToLocal(p.pos.clone()), house.worldToLocal(p.look.clone()), SHOT.tOut, up);
    camJob.job = null; rig.release(); ap.camFocused = false;
  };
  ap.camShot = SHOT;
  /* Blip's mark: a fixed spot beside the door; he walks there (short ease, walk cycle) and faces the doorway */
  ap.markLocal = new THREE.Vector3(-1.8, 0, 5.4);
  const walkToMark = async () => {
    house.updateWorldMatrix(true, false);
    const goal = house.localToWorld(ap.markLocal.clone()), from = player.position.clone(), body = player.body;
    const len = from.distanceTo(goal);
    if (body && len > 0.05) {
      player.cinematic = true;
      const dir = goal.clone().sub(from); dir.addScaledVector(player.up, -dir.dot(player.up));
      if (dir.lengthSq() > 1e-4) { player.facing.copy(dir.normalize()); player.orient && player.orient(0.5); }
      await tween(Math.min(0.9, 0.25 + len * 0.25), k => {
        const p = from.clone().lerp(goal, ease(k)), u = new THREE.Vector3(); body.up(p, u);
        player.position.copy(body.centre).addScaledVector(u, body.surface(u)); player.up.copy(u); player.moveSpeed = 2.2 * Math.sin(Math.PI * k);
      });
      player.feet = body.surface(player.up); player.moveSpeed = 0; player.lastPos && player.lastPos.copy(player.position);
      player.cinematic = false;
    }
    const d = house.localToWorld(new THREE.Vector3(0, 0, 3.5)).sub(player.position); d.addScaledVector(player.up, -d.dot(player.up));
    if (d.lengthSq() > 1e-4) {   // turn to the door (eased, no snap)
      d.normalize(); const f0 = player.facing.clone(), ang = Math.atan2(new THREE.Vector3().crossVectors(f0, d).dot(player.up), f0.dot(d));
      await tween(0.4, k => { player.facing.copy(f0).applyAxisAngle(player.up, ang * smoother(k)).normalize(); player.orient && player.orient(1); });
    }
  };
  ap.knock = async function () {
    if (ap.busy) return;
    ap.busy = true; player.frozen = true;
    try {
      log("to-mark");
      const shot = camFocus();   // the lens eases into the one knock shot while Blip walks to the fixed mark and turns to the door
      await walkToMark();
      log("door-opening");
      await sleep(0.63);   // two knocks of silence: the audio10 spec keeps ui_click silent and the smoke tests forbid that call
      await shot;
      await tween(0.9, k => setDoor(DOOR.open * ease(k)));
      // he is behind the doorway patch: show him there, so nothing pops
      holder.rotation.y = 0; place(Z_IN); holder.visible = true;
      log("walking-out");
      setAnim("Walk", 0.25);
      const dOut = Z_STEP - Z_IN;
      await walkPath(s => [X_OUT, Z_IN + s, 0], dOut, stopPhase(dOut), true);
      setAnim("Idle", 0.35);
      await sleep(0.25);
      // look at Blip: the body turns part of the way, the head the rest
      log("looking");
      const toB = holder.worldToLocal(player.position.clone());
      const ang = Math.atan2(toB.x, toB.z), body = THREE.MathUtils.clamp(ang * 0.45, -0.8, 0.8), hd = THREE.MathUtils.clamp(ang - body, -1.05, 1.05);
      await tween(0.55, k => { const e = ease(k); holder.rotation.y = body * e; ap.headYaw = hd * e; ap.headPitch = 0.03 * e; });
      await sleep(1.5);   // the beat
      log("looked");
      if (ctx.slate) ctx.slate.say({ name: "AP", html: AP_LINE, ms: 2200, base: () => ap.worldFoot(), up: () => house.localToWorld(new THREE.Vector3(0, 1, 0)).sub(house.localToWorld(new THREE.Vector3())).normalize(), top: 2.0 });
      await sleep(1.2);
      await tween(0.45, k => { const e = ease(k); ap.headYaw = hd * (1 - e); ap.headPitch = 0.03 * (1 - e); });
      // turn about on the spot with short steps (round toward the side he is already facing), then walk straight in until hidden
      log("turning");
      const y1 = holder.rotation.y <= 0 ? -Math.PI : Math.PI;
      if (Object.keys(legs).length === 2) await stepTurn(y1);
      else await tween(0.8, k => { holder.rotation.y = y1 * ease(k); });
      log("walking-in");
      setAnim("Walk", 0.25);
      const xe = holder.position.x, ze = holder.position.z;
      await walkPath(s => [xe, ze - s, y1], ze - Z_IN, WALK.stop, false);
      holder.visible = false; setAnim("Idle", 0.01); holder.rotation.y = 0; place(Z_IN);
      log("door-closing");
      const closing = camBack();   // the lens eases back to the follow pose while the door closes, then releases
      await sleep(0.2);
      await tween(0.8, k => setDoor(DOOR.open * (1 - ease(k))));
      setDoor(0); log("hidden");
      await closing;
    } finally { if (ap.camFocused && ctx.rig) { camJob.job = null; ctx.rig.release(); ap.camFocused = false; } player.cinematic = false; ap.headYaw = ap.headPitch = 0; ap.busy = false; player.frozen = false; }
  };
  installChimney(ctx, ap);
  return ap;
}

/* The house's long coral cylinder (STUDIO_house_4: a ball on the dome top merged with a 0.7 x 2.0 m cylinder at x 1.4, z -0.6,
   y 3.6..5.6) becomes a chimney at load: the flat cap triangles are dropped (the ink hull shares the geometry, so it opens too),
   a short lip ring and a dark inner tube + floor go in, and every ~1.7 s a cream toon puff (fx.puff: ink-edged, noise-dissolving)
   leaves the top and drifts up and downwind. planet.glb is untouched. */
const CHIM = { x: 1.4, z: -0.6, top: 5.6, r: 0.35 };
function installChimney(ctx, ap) {
  const { house, tween } = ctx;
  let m = house.getObjectByName("STUDIO_house_4");
  if (!m || !m.isMesh) { m = null; house.traverse(o => { if (!m && o.isMesh && !o.userData.isOutline && /M_Coral/.test((o.material && o.material.name) || "")) m = o; }); }
  if (!m) return;
  const g = m.geometry, pos = g.attributes.position, ix = g.index;
  let dropped = 0;
  if (ix) {
    const keep = [], A = ix.array;
    for (let i = 0; i < A.length; i += 3) {
      let cap = true;
      for (let k = 0; k < 3; k++) { const v = A[i + k]; if (Math.abs(pos.getY(v) - CHIM.top) > 0.005 || Math.hypot(pos.getX(v) - CHIM.x, pos.getZ(v) - CHIM.z) > CHIM.r + 0.02) cap = false; }
      if (cap) dropped++; else keep.push(A[i], A[i + 1], A[i + 2]);
    }
    if (dropped) g.setIndex(keep);
  }
  const grp = new THREE.Group(); grp.name = "AP_chimney"; grp.position.set(CHIM.x, 0, CHIM.z); house.add(grp);
  const dark = new THREE.MeshBasicMaterial({ color: "#1B1520", side: THREE.BackSide });
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.262, 0.262, 1.1, 20, 1, true), dark); tube.position.y = CHIM.top - 0.55; tube.name = "AP_chimney_inside"; grp.add(tube);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(0.27, 20), new THREE.MeshBasicMaterial({ color: "#120D17" })); floor.rotation.x = -Math.PI / 2; floor.position.y = CHIM.top - 1.0; grp.add(floor);
  // a thick lip: inner wall, flat top, outer wall (a lathe of the rim profile), same coral as the shaft
  const prof = [[0.262, CHIM.top - 0.02], [0.262, CHIM.top + 0.065], [0.372, CHIM.top + 0.065], [0.372, CHIM.top - 0.02]].map(([r, y]) => new THREE.Vector2(r, y));
  const lip = new THREE.Mesh(new THREE.LatheGeometry(prof, 24), m.material.clone()); lip.material.side = THREE.DoubleSide; lip.name = "AP_chimney_lip";
  lip.castShadow = true; lip.receiveShadow = true; grp.add(lip);
  ctx.outline(grp, "#1E1F26", o => o === lip, ctx.charInk);
  ap.chimney = { group: grp, dropped, puffs: [], emitted: 0 };

  // ---- smoke: gentle interval, rises + drifts on its own (fx puffs have a short drag, so the climb is added here), fx draws the cel puff
  const fx = ctx.fx; if (!fx) return;
  const V3 = THREE.Vector3, mine = ap.chimney.puffs;
  const upW = new V3(), top = new V3(), wind = new V3();
  let acc = 1.2, tPrev = 0;
  const frame = () => {
    house.updateWorldMatrix(true, false);
    top.set(CHIM.x, CHIM.top + 0.12, CHIM.z); house.localToWorld(top);
    upW.set(0, 1, 0).transformDirection(house.matrixWorld);
    wind.set(0.55, 0, 0.25).transformDirection(house.matrixWorld);
  };
  tween(1e9, k => {
    const t = k * 1e9, dt = Math.min(0.1, Math.max(0, t - tPrev)); tPrev = t;
    if (dt <= 0) return;
    for (let i = mine.length - 1; i >= 0; i--) {
      const p = mine[i];
      if (!p.userData.chim || !p.parent) { mine.splice(i, 1); continue; }   // faded and recycled by fx
      const a = p.userData.t / p.userData.life;
      p.position.addScaledVector(upW, (0.62 - 0.25 * a) * dt).addScaledVector(wind, (0.05 + 0.20 * a) * dt);
    }
    acc += dt;
    if (acc >= 1.7) {
      acc = 0; frame();
      const pf = fx.puff(top, { size: 0.24 + Math.random() * 0.06, color: new THREE.Color("#FFF1DC"), life: 4.2, grow: 1.9, cool: false });
      pf.userData.chim = true; mine.push(pf); ap.chimney.emitted++;
    }
  });
}
