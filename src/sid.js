import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/* Tall Sid, the procedural fallback. A procedural toy stilt-walker: cornflower-blue egg body,
   cream belly, two bulging eyes with different irises (orange left, yellow right), red ears, cheeks
   and mitts, a topknot with a ball on it, and two long navy stilt legs with red sneakers.
   ~2.2 m tall, hips at 1.12 m, 2-bone legs solved by IK so the sneakers stay planted while the body
   bobs and sways.

   It replaces the skinned FAUNA_stilts of fauna.glb through installSid(g): same node key, same clip
   names (`stilts_Idle`, `stilts_Talk`, `stilts_WavePoint` of 3.2 s) and same beats (pointOn 1.86,
   pointOff 2.7), so loadFauna / talk / trickSid in main.js work unchanged. Rigid parts live in named
   groups (Sid_*) animated by keyframe tracks; meshes are static inside them, so main.js's inked
   hulls (which copy their transform once) follow along. Materials are Standard here and go
   through toonify() in loadFauna like every other creature; names avoid the words the ink filter
   skips (Eye, Sclera, Iris, Fur ...) except the face details, which are meant to stay un-inked. */

const TAU = Math.PI * 2;
const COL = {
  Fauna_SidBody: "#5E8BFF", Fauna_SidBelly: "#EEF4FF", Fauna_SidLeg: "#2C3A8E", Fauna_SidArm: "#4A74EA",
  Fauna_Red: "#E5303B", Fauna_Sclera: "#FFFFFF", Fauna_Eye: "#18141D",
  Fauna_IrisOrange: "#FF8A1E", Fauna_IrisYellow: "#FFD42A",
};
const mats = {};
function mat(name) {
  if (!mats[name]) { const m = new THREE.MeshStandardMaterial({ color: COL[name], roughness: 0.85, metalness: 0 }); m.name = name; mats[name] = m; }
  return mats[name];
}

const H_HIPS = 1.12, L1 = 0.54, L2 = 0.54, HIP_X = 0.17;
const ANKLE = { x: 0.19, y: 0.07, z: 0.02 };

/* geometry helpers: scale / rotate / move baked into the geometry, so every mesh is static in its group */
function bake(g, pos = [0, 0, 0], rot = [0, 0, 0]) {
  if (rot[0] || rot[1] || rot[2]) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])));
  g.translate(pos[0], pos[1], pos[2]);
  return g;
}
function ell(r, pos, rot, seg = [14, 10]) {
  const g = new THREE.SphereGeometry(1, seg[0], seg[1]);
  g.scale(r[0], r[1], r[2]);
  return bake(g, pos, rot);
}
function cap(radius, len, pos, rot, seg = [2, 8]) {
  return bake(new THREE.CapsuleGeometry(radius, Math.max(0.001, len - 2 * radius), seg[0], seg[1]), pos, rot);
}
function add(parent, geo, matName, name) {
  const m = new THREE.Mesh(geo, mat(matName)); m.name = name; parent.add(m); return m;
}
function grp(parent, name, pos = [0, 0, 0]) {
  const g = new THREE.Group(); g.name = name; g.position.set(pos[0], pos[1], pos[2]); parent.add(g); return g;
}

/* the egg: a lathe, wider low than high (pear-ish), z squashed a little */
function bodyGeo() {
  const pts = [], N = 22, R = 0.385, y0 = -0.2, hgt = 0.92;
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 2 * t - 1;
    pts.push(new THREE.Vector2(Math.max(0.0005, R * Math.sqrt(Math.max(0, 1 - u * u)) * (1 + 0.12 * (1 - t))), y0 + t * hgt));
  }
  const g = new THREE.LatheGeometry(pts, 24);
  g.scale(1, 1, 0.92);
  return g;
}

function buildSid() {
  const root = new THREE.Group(); root.name = "FAUNA_stilts";
  // the other creatures face -Z in their holder (orientTo points -Z at the visitor); built facing +Z, turned half a circle here
  const face = grp(root, "Sid_face"); face.rotation.y = Math.PI;
  const hips = grp(face, "Sid_hips", [0, H_HIPS, 0]);
  /* legs: thigh -> shin -> foot, each a pivot group */
  for (const [nm, s] of [["L", -1], ["R", 1]]) {
    const th = grp(hips, "Sid_thigh_" + nm, [s * HIP_X, 0, 0]);
    add(th, cap(0.058, L1 + 0.02, [0, -L1 / 2, 0]), "Fauna_SidLeg", "Sid_thighmesh_" + nm);
    add(th, ell([0.056, 0.056, 0.056], [0, -L1, 0], [0, 0, 0], [14, 10]), "Fauna_SidLeg", "Sid_knee_" + nm);
    const sh = grp(th, "Sid_shin_" + nm, [0, -L1, 0]);
    add(sh, cap(0.047, L2 + 0.02, [0, -L2 / 2, 0]), "Fauna_SidLeg", "Sid_shinmesh_" + nm);
    const ft = grp(sh, "Sid_foot_" + nm, [0, -L2, 0]);
    add(ft, ell([0.095, 0.068, 0.185], [0, -0.005, 0.075], [0, 0, 0], [16, 10]), "Fauna_Red", "Sid_shoe_" + nm);
  }
  /* chest: body, belly, face, ears, topknot, arms */
  const chest = grp(hips, "Sid_chest", [0, 0.2, 0]);
  add(chest, bodyGeo(), "Fauna_SidBody", "Sid_body");
  add(chest, ell([0.17, 0.17, 0.1], [0, -0.02, 0.275], [0.08, 0, 0], [20, 14]), "Fauna_SidBelly", "Sid_belly");
  add(chest, bake(new THREE.TorusGeometry(0.075, 0.011, 6, 16, Math.PI), [0, 0.355, 0.377], [0, 0, Math.PI]), "Fauna_Eye", "Sid_smile");
  for (const [nm, s] of [["L", -1], ["R", 1]]) {
    // eyes: group at the eye centre so blink (scale.y, set by main.js) squashes about the middle
    const eye = grp(chest, "Sid_eye_" + nm, [s * 0.175, 0.53, 0.235]);
    eye.rotation.y = s * 0.28;
    add(eye, new THREE.SphereGeometry(0.15, 18, 12), "Fauna_Sclera", "Sid_sclera_" + nm);
    const iris = nm === "L" ? "Fauna_IrisOrange" : "Fauna_IrisYellow";
    add(eye, ell([0.098, 0.098, 0.04], [0, 0, 0.118], [0, 0, 0], [16, 10]), iris, "Sid_iris_" + nm);
    add(eye, ell([0.052, 0.052, 0.04], [0, 0, 0.14], [0, 0, 0], [12, 8]), "Fauna_Eye", "Sid_pupil_" + nm);
    add(eye, ell([0.022, 0.022, 0.02], [0.03, 0.035, 0.168], [0, 0, 0], [8, 6]), "Fauna_Sclera", "Sid_glint_" + nm);
    // cheek
    add(chest, ell([0.06, 0.045, 0.02], [s * 0.255, 0.31, 0.275], [0, s * 0.65, 0], [10, 8]), "Fauna_Red", "Sid_cheek_" + nm);
    // ear: a red flap hinged at the side of the head
    const ear = grp(chest, "Sid_ear_" + nm, [s * 0.335, 0.55, -0.03]);
    add(ear, ell([0.05, 0.15, 0.12], [s * 0.065, 0.06, 0], [0, 0, -s * 0.35], [14, 10]), "Fauna_Red", "Sid_earmesh_" + nm);
    // arm: shoulder -> elbow -> mitt (R carries the pointing finger)
    const arm = grp(chest, "Sid_arm_" + nm, [s * 0.36, 0.13, 0]);
    add(arm, cap(0.042, 0.32, [0, -0.15, 0]), "Fauna_SidArm", "Sid_upper_" + nm);
    const el = grp(arm, "Sid_fore_" + nm, [0, -0.29, 0]);
    add(el, cap(0.036, 0.30, [0, -0.14, 0]), "Fauna_SidArm", "Sid_forearm_" + nm);
    const hand = grp(el, "Sid_hand_" + nm, [0, -0.29, 0]);
    add(hand, ell([0.07, 0.07, 0.07], [0, -0.03, 0], [0, 0, 0], [14, 10]), "Fauna_Red", "Sid_mitt_" + nm);
    if (nm === "R") add(hand, cap(0.021, 0.12, [0, -0.115, 0.01]), "Fauna_Red", "Sid_finger_R");
    else add(hand, ell([0.03, 0.04, 0.03], [-s * 0.06, -0.02, 0.03], [0, 0, 0], [8, 6]), "Fauna_Red", "Sid_thumb_L");
  }
  // topknot: a bendy stalk with a ball on it
  const knot = grp(chest, "Sid_topknot", [0, 0.7, -0.03]);
  add(knot, cap(0.02, 0.2, [0, 0.09, -0.02], [-0.25, 0, 0]), "Fauna_SidBody", "Sid_stalk");
  add(knot, ell([0.055, 0.055, 0.055], [0, 0.2, -0.05], [0, 0, 0], [14, 10]), "Fauna_Red", "Sid_knotball");
  return root;
}

/* ---------------------------------------------------------------- animation (sampled keyframes) */
const sm = x => THREE.MathUtils.smoothstep(x, 0, 1);
const ramp = (t, a, b) => sm((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const E = (x = 0, y = 0, z = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, "XYZ"));
function pose() {
  return { hips: [0, H_HIPS, 0], hipsR: [0, 0, 0], chest: [0, 0, 0], eyeL: [0, 0, 0], eyeR: [0, 0, 0], earL: [0, 0, 0], earR: [0, 0, 0],
    knot: [0, 0, 0],
    armL: [0, 0, 0], foreL: [0, 0, 0], handL: [0, 0, 0], armR: [0, 0, 0], foreR: [0, 0, 0], handR: [0, 0, 0] };
}
const REST_ARM = 0.16;   // arms hang with a little splay

function idlePose(t, T = 2.8, amp = 1) {
  const w = TAU * t / T, p = pose(), S = Math.sin;
  p.hips = [0.03 * amp * S(w), H_HIPS - 0.012 * amp * (1 - Math.cos(2 * w)) * 0.5 + 0.004, 0.006 * S(w + 1)];
  p.hipsR = [0, 0.02 * amp * S(w - 0.6), -0.03 * amp * S(w)];
  p.chest = [0.02 * S(2 * w) * amp, 0.05 * amp * S(w + 0.8), 0.045 * amp * S(w + 1.5)];
  p.eyeL = [0.04 * S(2 * w), 0.12 * S(w + 0.3), 0]; p.eyeR = [0.04 * S(2 * w + 0.5), 0.12 * S(w + 0.3), 0];
  p.earL = [0, 0, 0.12 * S(w + 0.5)]; p.earR = [0, 0, -0.12 * S(w + 1.9)];
  p.knot = [0.18 * S(w - 0.4) + 0.05, 0, 0.14 * S(2 * w + 1)];
  p.armL = [0.06 * S(w + 0.4), 0, -REST_ARM - 0.05 + 0.04 * S(w)];
  p.armR = [-0.06 * S(w + 0.4), 0, REST_ARM + 0.05 - 0.04 * S(w + 1)];
  p.foreL = [0.12 + 0.05 * S(w), 0, -0.05]; p.foreR = [0.12 + 0.05 * S(w + 1), 0, 0.05];
  return p;
}
function talkPose(t) {
  const T = 1.5, w = TAU * t / T, p = idlePose(t * (2.8 / T), 2.8, 0.6), S = Math.sin;
  const bounce = 0.5 - 0.5 * Math.cos(4 * w);
  p.hips[1] += 0.03 * bounce; p.hips[0] = 0.02 * S(w);
  p.chest = [0.06 + 0.05 * S(4 * w + 0.5), 0.12 * S(w), 0.06 * S(w)];
  p.earL = [0, 0, 0.3 * S(4 * w)]; p.earR = [0, 0, -0.3 * S(4 * w + 0.8)];
  p.knot = [0.1 + 0.25 * S(4 * w), 0, 0.2 * S(2 * w)];
  const g1 = 0.5 + 0.5 * S(2 * w), g2 = 0.5 + 0.5 * S(2 * w + 2);
  p.armL = [-0.3 * g1, 0, -REST_ARM - 0.5 * g1]; p.foreL = [0.5 * g1 + 0.2, 0, 0];
  p.armR = [-0.3 * g2, 0, REST_ARM + 0.5 * g2]; p.foreR = [0.5 * g2 + 0.2, 0, 0];
  return p;
}
/* 3.2 s: crouch, wave (0.3-1.55), ready, point straight up (arm up by 1.86, held to 2.7), settle */
function wavePointPose(t) {
  const p = idlePose(t * 0.6, 2.8, 0.5), S = Math.sin;
  const up = ramp(t, 0.18, 0.62) * (1 - ramp(t, 2.7, 3.15));   // the right arm is raised
  const pt = ramp(t, 1.45, 1.86);                             // wave -> straight-up point
  const lean = pt * (1 - ramp(t, 2.7, 3.15));
  const swing = S(TAU * 3.2 * (t - 0.3)), wv = (1 - pt) * up;
  // anticipation dip, then spring up
  p.hips[1] += -0.035 * S(Math.PI * ramp(t, 0.0, 0.3)) * (1 - ramp(t, 0.3, 0.4)) - 0.02 * S(Math.PI * pt) + 0.03 * lean;
  // right arm: rest -> wave pose (out and up, forearm swings) -> straight up for the point
  p.armR = [lerp(p.armR[0], -0.25 * (1 - pt) - 0.2 * pt, up), 0, lerp(REST_ARM, lerp(1.95, 3.0, pt), up)];
  p.foreR = [lerp(p.foreR[0], 0, up), 0, lerp(0.05, lerp(1.3 + 0.38 * swing * (1 - pt), 0.04, pt), up)];
  p.handR = [0, 0, 0.2 * swing * wv];
  // the other hand comes up to the belly and bobs with the wave
  p.armL = [lerp(p.armL[0], -0.15, up), 0, lerp(p.armL[2], -0.45 - 0.08 * S(TAU * 3.2 * t), up)];
  p.foreL = [lerp(p.foreL[0], 0.5, up), 0, lerp(p.foreL[2], -0.5, up)];
  p.chest[0] += -0.12 * lean; p.chest[2] += -0.08 * wv * S(TAU * 1.6 * t);
  p.chest[1] += 0.12 * wv * S(TAU * 1.6 * t + 1);
  // eyes follow the finger up
  p.eyeL[0] = lerp(p.eyeL[0], -0.55, lean); p.eyeR[0] = lerp(p.eyeR[0], -0.55, lean);
  p.earL[2] += 0.25 * wv * S(TAU * 3.2 * t); p.earR[2] -= 0.25 * wv * S(TAU * 3.2 * t + 0.7);
  p.knot[0] += 0.3 * lean;
  return p;
}

/* planar-ish 2-bone IK in hips space, knee pointing forward (+z): returns the thigh, shin and foot rotations */
const _v = new THREE.Vector3(), _hip = new THREE.Vector3(), _an = new THREE.Vector3(), _kn = new THREE.Vector3(), _dir = new THREE.Vector3(), _pole = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
function legIK(side, hipsPos, hipsQ) {
  const hq = hipsQ.clone().invert();
  _an.set(side * ANKLE.x, ANKLE.y, ANKLE.z).sub(hipsPos).applyQuaternion(hq);
  _hip.set(side * HIP_X, 0, 0);
  _v.copy(_an).sub(_hip);
  const dist = Math.min(_v.length(), L1 + L2 - 1e-3);
  _dir.copy(_v).normalize();
  const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  _pole.set(0, 0, 1).addScaledVector(_dir, -_dir.z).normalize();
  _kn.copy(_hip).addScaledVector(_dir, a).addScaledVector(_pole, h);
  const qT = new THREE.Quaternion().setFromUnitVectors(DOWN, _v.copy(_kn).sub(_hip).normalize());
  const ank = _hip.clone().addScaledVector(_dir, dist);
  const qSw = new THREE.Quaternion().setFromUnitVectors(DOWN, _v.copy(ank).sub(_kn).normalize());
  const qS = qT.clone().invert().multiply(qSw);
  const qF = qSw.clone().invert().multiply(hq).multiply(E(0, side * 0.14, 0));
  return { qT, qS, qF };
}

function buildClip(name, T, fn, fps = 30) {
  const n = Math.round(T * fps), times = [], tr = {};
  const push = (k, arr) => (tr[k] = tr[k] || []).push(...arr);
  for (let i = 0; i <= n; i++) {
    const t = i / fps, p = fn(t), at = Math.min(t, T);
    times.push(at);
    const hq = E(...p.hipsR);
    push("Sid_hips.position", p.hips);
    push("Sid_hips.quaternion", hq.toArray());
    for (const [nm, s] of [["L", -1], ["R", 1]]) {
      const ik = legIK(s, new THREE.Vector3(...p.hips), hq);
      push(`Sid_thigh_${nm}.quaternion`, ik.qT.toArray());
      push(`Sid_shin_${nm}.quaternion`, ik.qS.toArray());
      push(`Sid_foot_${nm}.quaternion`, ik.qF.toArray());
      const A = p["arm" + nm], F = p["fore" + nm];
      push(`Sid_arm_${nm}.quaternion`, E(0, 0, A[2]).multiply(E(A[0], 0, 0)).toArray());   // swing out (z), then forward (x)
      push(`Sid_fore_${nm}.quaternion`, E(F[0], 0, F[2]).toArray());
      push(`Sid_hand_${nm}.quaternion`, E(...p["hand" + nm]).toArray());
      push(`Sid_ear_${nm}.quaternion`, E(...p["ear" + nm]).toArray());
    }
    push("Sid_chest.quaternion", E(...p.chest).toArray());
    push("Sid_topknot.quaternion", E(...p.knot).toArray());
    // eyes: only the look direction; blink scale stays under main.js control
    push("Sid_eye_L.quaternion", E(p.eyeL[0], p.eyeL[1], 0).premultiply(E(0, -0.28, 0)).toArray());
    push("Sid_eye_R.quaternion", E(p.eyeR[0], p.eyeR[1], 0).premultiply(E(0, 0.28, 0)).toArray());
  }
  const tracks = [];
  for (const k of Object.keys(tr)) {
    const quat = k.endsWith("quaternion");
    tracks.push(quat ? new THREE.QuaternionKeyframeTrack(k, times, tr[k]) : new THREE.VectorKeyframeTrack(k, times, tr[k]));
  }
  return new THREE.AnimationClip(name, T, tracks);
}

function sidClips() {
  return [
    buildClip("stilts_Idle", 2.8, t => idlePose(t)),
    buildClip("stilts_Talk", 1.5, talkPose),
    buildClip("stilts_WavePoint", 3.2, wavePointPose),
  ];
}

/* The real model. blender/build_sid.py bakes models/sid.glb (a skinned egg with shingled
   fur tufts, 18 bones, actions stilts_Idle / stilts_Talk / stilts_WavePoint). installSid loads it and swaps
   it for the skinned FAUNA_stilts of fauna.glb under the same node key and clip names, so loadFauna / talk /
   trickSid are unchanged. If the GLB fails to load, the procedural toy above is installed instead (and if
   that throws too, fauna.glb's own Sid stays). */
const SID_GLB = "assets/models/sid.glb";
const SID_LEN = { stilts_Idle: 2.8, stilts_Talk: 1.5, stilts_WavePoint: 4.8 };  // 4.8 s, a 3-wave open-hand hi (0.3-2.5) then the point (beats pointOn 2.86 / pointOff 3.7 in main.js FAUNA)
const loadSidGLB = () => new Promise(res => new GLTFLoader().load(SID_GLB, res, undefined, () => res(null)));

function swap(g, sid, clips) {
  const old = g.scene.getObjectByName("FAUNA_stilts");
  g.scene.add(sid);
  if (old) old.removeFromParent();
  g.animations = g.animations.filter(c => !c.name.startsWith("stilts_")).concat(clips);
}

export async function installSid(g) {
  try {
    const glb = await loadSidGLB();
    const sid = glb && glb.scene.getObjectByName("FAUNA_stilts");
    const clips = glb ? glb.animations.filter(c => c.name.startsWith("stilts_")) : [];
    if (sid && ["Idle", "Talk", "WavePoint"].every(n => clips.some(c => c.name === "stilts_" + n))) {
      sid.removeFromParent();
      // Blender's NLA export keeps one extra frame; trim each clip back to its nominal length (loop seam, trick timing)
      // keep the key at exactly T (a copy of frame 0), so the loop wraps T -> 0 with no hold and no pop
      for (const c of clips) { const T = SID_LEN[c.name]; for (const tr of c.tracks) tr.trim(0, T + 1e-3); c.duration = T; }
      swap(g, sid, clips);
      return "glb";
    }
    console.warn("sid.glb missing or incomplete, using the procedural Sid");
  } catch (e) { console.warn("sid.glb failed, using the procedural Sid", e); }
  try {
    swap(g, buildSid(), sidClips());
    return "procedural";
  } catch (e) { console.error("Sid remake failed, keeping the old one", e); }
  return "fauna";
}
