import * as THREE from "three";
import { outline } from "./toon.js?v=20261108-2229";

/* The bench butterfly. A bench is only a seat; if Blip stays seated for SITFLY.delay (10 s) one butterfly
   flies in along a smooth curved path and lands on a rounded top corner of his head (headPerch), folds into slow flaps while he sits, and flutters off
   (up and away, shrinking out) the moment he stands. Same look as the world's butterflies (life.js): one flat wing card on each
   side of a hinge, MeshBasicMaterial, ink hull drawn as a flat child outline. It owns no per-frame allocation.
   States: wait (seated, timer running) -> fly (curve in) -> perch (follows the head) -> leave (curve out) -> idle (hidden).
   Standing during `fly` hands over to `leave` from wherever it is, so nothing pops. */
export const SITFLY = {
  delay: 10,        // s seated before it comes
  flyIn: 3.6,       // s on the curved approach
  leave: 2.8,       // s fluttering off
  perchFlapHz: 0.9, // slow wing beats while perched
  flyFlapHz: 7.5,
  scale: 0.5,       // same as the swarm while flying
  perchScale: 0.34, // a touch smaller once landed (the size eases over the last quarter of the flight: no pop)
  perchLift: 0.035, // m the hinge sits out from the head along its surface normal: clear of the head's ink line
  startDist: 4.6,   // m out from the head where it appears (it grows in from nothing over the first 0.5 s)
};
const sm = x => THREE.MathUtils.smoothstep(x, 0, 1), sm5 = x => THREE.MathUtils.smootherstep(x, 0, 1);
const _t = new THREE.Vector3(), _l = new THREE.Vector3(), _u = new THREE.Vector3();

/* Where it lands: his head's back-right top corner, the rounded edge (figure space: +x his right, +y up, +z behind
   him; he faces -z). Every antenna option stands at the middle of the crown (the coral sprout leans out to the left),
   the eye and its glint are on the front, so this corner is the one with nothing on it. The spot is the support
   point of the head's own mesh (Blip_1, plus the Blip_7 sparkle decal on it) in the CORNER direction: the vertex
   furthest out that way. Every vertex of the head lies on or below the plane through it with normal CORNER, so a
   butterfly lying in that plane, wings only ever opening up out of it, never enters the head. Blip_1 is skinned
   to the body bone alone, so the spot is measured once in that bone's space and carried by it (the idle bob, the
   seat). headPerch writes the spot into `out` and returns its outward normal (a shared vector). */
const CORNER = new THREE.Vector3(0.55, 1, 0.6).normalize();
const perchCache = new WeakMap(), _pn = new THREE.Vector3();
export function headPerch(figure, out) {
  let s = perchCache.get(figure);
  if (!s) {
    figure.updateMatrixWorld(true);
    const bone = figure.getObjectByName("body") || figure, inv = bone.matrixWorld.clone().invert();
    const n = CORNER.clone().transformDirection(figure.matrixWorld).transformDirection(inv), v = new THREE.Vector3(), p = new THREE.Vector3();
    let best = -Infinity;
    for (const name of ["Blip_1", "Blip_7"]) {
      const m = figure.getObjectByName(name); if (!m) continue;
      for (let i = 0; i < m.geometry.attributes.position.count; i++) {
        m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld).applyMatrix4(inv);
        const d = v.dot(n); if (d > best) { best = d; p.copy(v); }
      }
    }
    s = { bone, p, n }; perchCache.set(figure, s);
  }
  out.copy(s.p).applyMatrix4(s.bone.matrixWorld);
  return _pn.copy(s.n).transformDirection(s.bone.matrixWorld);
}
function bezier(a, b, c, d, k, out) {   // cubic bezier, allocation-free
  const u = 1 - k, w0 = u * u * u, w1 = 3 * u * u * k, w2 = 3 * u * k * k, w3 = k * k * k;
  return out.set(0, 0, 0).addScaledVector(a, w0).addScaledVector(b, w1).addScaledVector(c, w2).addScaledVector(d, w3);
}

export function createSitButterfly(scene) {
  const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.bezierCurveTo(0.25, 0.3, 0.45, 0.12, 0.38, -0.05); shape.bezierCurveTo(0.42, -0.25, 0.15, -0.3, 0, -0.06);   // life.js's wing
  const geo = new THREE.ShapeGeometry(shape); geo.rotateX(-Math.PI / 2);
  { const P = geo.attributes.position, c = new THREE.Vector3(0.2, 0, 0.05), on = new Float32Array(P.count * 3), v = new THREE.Vector3();
    for (let k = 0; k < P.count; k++) { v.fromBufferAttribute(P, k).sub(c); v.y = 0; v.normalize(); on.set([v.x, 0, v.z], k * 3); }
    geo.setAttribute("oNormal", new THREE.BufferAttribute(on, 3)); }
  const mat = new THREE.MeshBasicMaterial({ color: "#FFC845", side: THREE.DoubleSide });   // the world's butterfly yellow
  const g = new THREE.Group(), l = new THREE.Mesh(geo, mat), r = new THREE.Mesh(geo, mat); r.scale.x = -1;
  l.castShadow = r.castShadow = false; g.add(l, r); outline(g, "#1E1F26", undefined, { flat: true, child: true });
  g.name = "SIT_butterfly"; g.visible = false; g.scale.setScalar(0.0001); scene.add(g);

  const st = { state: "idle", t: 0, timer: 0, seated: false, g };
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3();   // current bezier
  const side = new THREE.Vector3(), upv = new THREE.Vector3(), fwdv = new THREE.Vector3(), prev = new THREE.Vector3(), nrmv = new THREE.Vector3(), outv = new THREE.Vector3();
  const lastHead = new THREE.Vector3(), head0 = new THREE.Vector3();   // the head now / when the take-off began
  let flapPh = 0, amp = 1.1, hz = SITFLY.flyFlapHz, dur = 1, sc = 0, snapQ = true; const _qo = new THREE.Quaternion();

  /* sit(): the timer starts; stand(): a perched/arriving butterfly leaves, a waiting one never comes */
  st.sit = () => { st.seated = true; st.timer = 0; if (st.state === "idle") st.state = "wait"; };
  st.stand = () => {
    st.seated = false;
    if (st.state === "wait") { st.state = "idle"; return; }
    if (st.state === "fly" || st.state === "perch") startLeave();
  };
  function frame(up, fwd, nrm) {
    upv.copy(up); fwdv.copy(fwd).addScaledVector(up, -fwd.dot(up)).normalize(); side.crossVectors(up, fwdv).normalize();
    // perched it lies in the head's tangent plane (up = nrm) and faces out over the edge it sits on
    nrmv.copy(nrm || up); outv.copy(nrmv).addScaledVector(upv, -nrmv.dot(upv));
    if (outv.lengthSq() < 1e-4) outv.copy(fwdv); else outv.normalize();
  }
  function startFly(head) {
    // in from the front-left, high, swooping round one side and down onto the crown (a curve, never a straight line)
    A.copy(head).addScaledVector(fwdv, SITFLY.startDist * 0.85).addScaledVector(side, SITFLY.startDist * 0.55).addScaledVector(upv, 1.5);
    B.copy(head).addScaledVector(fwdv, SITFLY.startDist * 0.2).addScaledVector(side, -SITFLY.startDist * 0.55).addScaledVector(upv, 1.9);
    C.copy(head).addScaledVector(nrmv, 0.85).addScaledVector(upv, 0.25);   // the last stretch comes down onto the corner along its normal
    st.state = "fly"; st.t = 0; snapQ = true; dur = SITFLY.flyIn; g.visible = true; sc = 0; prev.copy(A); g.position.copy(A);
  }
  function startLeave() {
    // from wherever it is: up and out over the shoulder, away from the lens' usual side
    D.copy(g.position); A.copy(D);
    B.copy(D).addScaledVector(upv, 0.9).addScaledVector(side, -0.35);
    C.copy(D).addScaledVector(upv, 2.4).addScaledVector(side, -2.2).addScaledVector(fwdv, 1.2);
    D.copy(g.position).addScaledVector(upv, 4.4).addScaledVector(side, -4.8).addScaledVector(fwdv, 4.2);
    st.state = "leave"; st.t = 0; dur = SITFLY.leave; prev.copy(g.position); head0.copy(lastHead);
  }
  /* head: the perch point on the head; nrm: the head's outward normal there (up when omitted) */
  st.update = (dt, head, up, fwd, nrm) => {
    frame(up, fwd, nrm); lastHead.copy(head);
    if (st.state === "idle") return;
    if (st.state === "wait") {
      if (!st.seated) { st.state = "idle"; return; }
      st.timer += dt; if (st.timer >= SITFLY.delay) startFly(head);
      return;
    }
    st.t += dt;
    let targetHz, targetAmp;
    if (st.state === "fly") {
      const k = sm5(st.t / dur);                       // eased: slow at the start, a soft landing
      D.copy(head).addScaledVector(nrmv, SITFLY.perchLift);   // the end of the curve rides the head, so a nodding body never leaves it behind
      bezier(A, B, C, D, k, g.position);
      sc = THREE.MathUtils.lerp(SITFLY.scale, SITFLY.perchScale, sm((k - 0.75) / 0.25)) * sm(st.t / 0.5);              // grows in, no pop
      targetHz = SITFLY.flyFlapHz * (1 - 0.8 * sm((k - 0.7) / 0.3)) + SITFLY.perchFlapHz * 0.8 * sm((k - 0.7) / 0.3); targetAmp = 1.1 - 0.55 * sm((k - 0.75) / 0.25);
      if (st.t >= dur) { st.state = "perch"; st.t = 0; }
    } else if (st.state === "perch") {
      g.position.copy(head).addScaledVector(nrmv, SITFLY.perchLift); sc = SITFLY.perchScale;
      targetHz = SITFLY.perchFlapHz; targetAmp = 0.42;
    } else {   // leave
      const k = sm(st.t / dur);
      bezier(A, B, C, D, k, g.position);
      g.position.addScaledVector(_t.copy(head).sub(head0), 1 - k);   // carried by the head as he stands up, so it never sinks into it
      sc = THREE.MathUtils.lerp(SITFLY.perchScale, SITFLY.scale, sm(st.t / 0.4)) * (1 - sm((st.t / dur - 0.55) / 0.45));   // shrinks out at the end (it has flown off), never a pop
      targetHz = SITFLY.flyFlapHz; targetAmp = 1.1;
      if (st.t >= dur) { st.state = st.seated ? "wait" : "idle"; if (st.state === "wait") st.timer = 0; g.visible = false; g.scale.setScalar(0.0001); return; }
    }
    // wing beat: frequency and amplitude ease (no jump in phase), the beat is a smooth sine; perched, the wings open and close slowly
    hz = THREE.MathUtils.damp(hz, targetHz, 4, dt); amp = THREE.MathUtils.damp(amp, targetAmp, 4, dt);
    flapPh += dt * hz * Math.PI * 2;
    const f = state_flap(flapPh, amp);
    l.rotation.z = f; r.rotation.z = -f;
    // up: the head's normal while it sits (it lies in the tangent plane), eased in over the landing and out over the
    // first 0.6 s of the take-off; heading: along the flight (level with that up, so a near-vertical climb never flips
    // it), turning to face out over the corner as it lands
    const w = st.state === "perch" ? 1 : st.state === "fly" ? sm((st.t / dur - 0.7) / 0.3) : 1 - sm(st.t / 0.6);
    _u.copy(upv).lerp(nrmv, w).normalize();
    if (st.state === "perch") _t.copy(outv);
    else { _t.copy(g.position).sub(prev); _t.addScaledVector(_u, -_t.dot(_u)); if (_t.lengthSq() < 1e-10) _t.copy(outv); _t.normalize().lerp(outv, w); }
    prev.copy(g.position);
    _t.addScaledVector(_u, -_t.dot(_u)); if (_t.lengthSq() < 1e-8) _t.copy(fwdv);   // square to up: lookAt keeps the heading, so up must not lean along it
    _l.copy(g.position).add(_t.normalize());
    g.up.copy(_u);
    // slerp the heading so a turn is never a snap
    _qo.copy(g.quaternion); g.lookAt(_l);
    if (snapQ) snapQ = false; else g.quaternion.copy(_qo.slerp(g.quaternion, 1 - Math.exp(-dt * 10)));
    g.scale.setScalar(Math.max(0.0001, sc));
  };
  return st;
}
/* a wing angle: always >= 0.12 rad open (a closed pair would sit coplanar and z-fight) */
function state_flap(ph, amp) { return 0.12 + amp * (0.5 + 0.5 * Math.sin(ph)); }
