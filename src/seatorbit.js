import * as THREE from "three";

/* "Take in the view": on the lookout's top deck Blip steps onto the marker and the lens flies out, goes
   once round the planet pulled in close (the planet fills about 60 % of the frame height) and settles back behind him.
   About 10 s in all: ORBIT.delay + tIn + tOrbit + tOut. Any key / tap (stand() calls cancel) flies straight back.
   The benches do not orbit: they are only a seat.

   Geometry: the lens orbits C, the planet's centre, at the distance where the planet's limb fills `planetFill` of the
   frame height, and looks at C itself (lookK 0): the planet is dead centre, the framing symmetric, for the whole orbit.
   The moon (118 from C, the lens 116) only clears the limb and stays in frame in a narrow arc on the far side, so the axis is
   tilted 40 deg (the moon passes just below the planet instead of behind it) and the orbit runs on orbitEase: zero speed at
   both ends, 0.6x the mean speed at the far side (the moon window, mid-orbit because the lookout faces the moon), 1.7x at the
   quarters. tOrbit 6.0: that 1.72x quarter peak is then 103 deg/s round C, and the peak never sits on the moon.
   roll 40 deg: the axis swings 40 deg round the planet-moon line. Seen from C the lookout points at the moon, so with roll 0
   the lookout tower would cross the moon in mid-window (clear of it only ~0.8 s); rolled, the moon arcs past the tower (fully
   in frame and clear of planet and tower for ~1.8 s) and the orbit starts 5 deg from straight over Blip, a short fly-in.
   The fly in and out lerp the look point to / from C with smootherstep, so there is no snap.
   The flight in and out is a slerp round C with a lerped radius, so the lens never cuts through the planet. */
export const ORBIT = { delay: 0.5, tIn: 2.2, tOrbit: 6.0, tOut: 2.2, tCancel: 1.6, tilt: 40 * Math.PI / 180, planetFill: 0.6, lookK: 0, maxD: 340, roll: 40 * Math.PI / 180 };

/* the orbit's progress 0..1: speed 1 - 0.3 cos 2pi x - 0.7 cos 4pi x (0 at both ends, 0.6 mid, never negative) */
export const orbitEase = x => { x = Math.min(1, Math.max(0, x)); return x - 0.3 / (2 * Math.PI) * Math.sin(2 * Math.PI * x) - 0.7 / (4 * Math.PI) * Math.sin(4 * Math.PI * x); };
const sm5 = x => THREE.MathUtils.smootherstep(x, 0, 1);   // smootherstep for the fly in / out

/* pure: the orbit's frame for a spot (up u there), planet/moon centres and the camera's fov/aspect */
export function orbitFrame({ planetC, moonC, u, fovDeg, aspect, planetR = 30 }) {
  const toMoon = moonC.clone().sub(planetC), L = toMoon.length(), e1 = toMoon.clone().divideScalar(L);
  const M = planetC.clone().addScaledVector(e1, L * ORBIT.lookK);   // the look target: lookK 0 = the planet's centre (dead centre in frame)
  const vf = THREE.MathUtils.degToRad(fovDeg), hf = 2 * Math.atan(Math.tan(vf / 2) * aspect), f = Math.min(vf, hf);
  const alpha = Math.atan(ORBIT.planetFill * Math.tan(f / 2));   // half the angle the planet should span
  const D = Math.min(ORBIT.maxD, planetR / Math.sin(alpha));
  let a = u.clone().addScaledVector(e1, -u.dot(e1)); if (a.lengthSq() < 1e-4) a.set(0, 1, 0).addScaledVector(e1, -e1.y);
  a.normalize();
  if (ORBIT.roll) a.applyAxisAngle(e1, ORBIT.roll);   // swing the orbit's axis round the planet-moon line (same moon window by symmetry)
  const e2 = new THREE.Vector3().crossVectors(a, e1).normalize();
  const dir = th => e1.clone().multiplyScalar(Math.cos(ORBIT.tilt) * Math.cos(th)).addScaledVector(e2, Math.cos(ORBIT.tilt) * Math.sin(th)).addScaledVector(a, Math.sin(ORBIT.tilt));
  let th0 = 0, best = -2;
  for (let i = 0; i < 360; i++) { const th = i * Math.PI / 180, d = dir(th).dot(u); if (d > best) { best = d; th0 = th; } }
  const pos = th => planetC.clone().addScaledVector(dir(th), D);
  const ring = Array.from({ length: 72 }, (_, i) => pos(i * Math.PI / 36));
  return { M, C: planetC, D, a, th0, e1, e2, pos, minSepToMoon: Math.min(...ring.map(p => p.distanceTo(moonC))), minRadius: Math.min(...ring.map(p => p.distanceTo(planetC))) };
}

export function createSeatOrbit({ rig, camera, planet, moon }) {
  const st = { active: false };
  let t = 0, phase = "wait", fr = null, from = null, guard = 0, outT = 0, outDur = 0, seat = null;
  const vP = new THREE.Vector3(), vL = new THREE.Vector3(), lastP = new THREE.Vector3(), lastL = new THREE.Vector3(); let seen = false;
  const DRIFT = 0.25;   // the lens's own motion at the start of the fly-in (the rig still swinging behind Blip) decays over ~0.25 s instead of stopping dead
  const snap = () => ({ pos: camera.position.clone(), look: rig.look.clone(), up: camera.up.clone() });
  const slerpPos = (A, B, k, C) => {   // direction slerped round C, radius lerped: never inside the planet
    const a = A.clone().sub(C), b = B.clone().sub(C), ra = a.length(), rb = b.length();
    const q = new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize());
    const part = new THREE.Quaternion().slerp(q, k);   // identity -> q
    return a.normalize().applyQuaternion(part).multiplyScalar(ra + (rb - ra) * k).add(C);
  };
  function put(pos, look, up) {
    camera.position.copy(pos); rig.look.copy(look); camera.up.copy(up).normalize(); camera.lookAt(look);
    rig.focusPos.copy(pos); rig.focusLook.copy(look); rig.focusUp.copy(camera.up);   // focus mode lerps toward itself: a no-op
  }
  const seatedPose = () => { const p = rig.pose(seat.player); return { pos: p.pos, look: p.look, up: rig.up.clone() }; };
  function begin(player, u) {
    seat = { player };
    fr = orbitFrame({ planetC: planet.centre, moonC: moon.centre, u, fovDeg: camera.fov, aspect: camera.aspect, planetR: planet.R });
    from = snap(); from.vP = vP.clone(); from.vL = vL.clone(); t = 0; phase = "in"; st.active = true;
    put(from.pos, from.look, from.up); rig.mode = "focus";   // sync the rig's focus targets first, or its focus lerp tugs the lens 5 % toward a stale target for a frame (a 145 m/s spike)
    st.frame = fr;
  }
  st.wait = (player, u) => { st.pending = { player, u }; t = 0; phase = "wait"; st.active = true; seen = false; vP.set(0, 0, 0); vL.set(0, 0, 0); };
  st.cancel = () => {
    if (!st.active || phase === "out" || phase === "done") return false;
    if (phase === "wait") { st.active = false; st.pending = null; return true; }
    from = snap(); outT = 0; outDur = ORBIT.tCancel; phase = "out"; guard = 0.7; return true;
  };
  st.stop = () => { st.active = false; st.pending = null; phase = "done"; if (rig.mode === "focus") rig.release(); };
  st.guard = () => guard > 0;
  st.update = dt => {
    if (guard > 0) guard -= dt;
    if (!st.active) return;
    if (phase === "wait") { t += dt;
      if (seen && dt > 0) { vP.subVectors(camera.position, lastP).divideScalar(dt); vL.subVectors(rig.look, lastL).divideScalar(dt); } else { vP.set(0, 0, 0); vL.set(0, 0, 0); }
      if (vP.length() > 30) vP.set(0, 0, 0); if (vL.length() > 30) vL.set(0, 0, 0);   // a teleport is not motion
      lastP.copy(camera.position); lastL.copy(rig.look); seen = true;
      if (t >= ORBIT.delay && st.pending) { const p = st.pending; st.pending = null; begin(p.player, p.u); } if (phase === "wait") return; }   // begin() falls straight into the first fly-in frame: no held frame
    if (phase === "in") {
      t += dt; const k = sm5(t / ORBIT.tIn), tgt = fr.pos(fr.th0), dr = DRIFT * (1 - Math.exp(-t / DRIFT));
      const p0 = from.pos.clone().addScaledVector(from.vP, dr), l0 = from.look.clone().addScaledVector(from.vL, dr);
      put(slerpPos(p0, tgt, k, fr.C), l0.lerp(fr.M, k), from.up.clone().lerp(fr.a, k));
      if (t >= ORBIT.tIn) { phase = "orbit"; t = 0; }
    } else if (phase === "orbit") {
      t += dt; const th = fr.th0 + Math.PI * 2 * orbitEase(t / ORBIT.tOrbit);
      put(fr.pos(th), fr.M, fr.a);
      if (t >= ORBIT.tOrbit) { phase = "out"; outT = 0; outDur = ORBIT.tOut; from = { pos: fr.pos(fr.th0), look: fr.M.clone(), up: fr.a.clone() }; }
    } else if (phase === "out") {
      outT += dt; const k = sm5(outT / outDur), s = seatedPose();
      put(slerpPos(from.pos, s.pos, k, fr.C), from.look.clone().lerp(s.look, k), from.up.clone().lerp(s.up, k));
      if (outT >= outDur) { st.active = false; phase = "done"; rig.release(); if (st.onDone) st.onDone(); }   // the tour is over: main.js hands Blip back
    }
  };
  st.phase = () => phase;
  return st;
}
