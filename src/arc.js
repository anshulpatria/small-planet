import * as THREE from "three";

/* Gulp's spit: a great-circle arc about the planet's centre with altitude above
   the surface the whole way. The radius is a smooth blend from the mouth's radius to the landing's
   radius plus a sine hump, floored at surface(dir) + CLEAR. Pure (needs only a surface(dir) function). */
const SPIT = { CLEAR: 1.2, H_MIN: 5, H_MAX: 12, H_BASE: 4, H_PER_M: 0.35 };

export class GreatCircleArc extends THREE.Curve {
  constructor(centre, from, to, surface, H) {
    super();
    this.centre = centre.clone(); this.surface = surface;
    this.d0 = from.clone().sub(centre); this.r0 = this.d0.length(); this.d0.normalize();
    this.d1 = to.clone().sub(centre); this.r1 = this.d1.length(); this.d1.normalize();
    this.omega = Math.acos(THREE.MathUtils.clamp(this.d0.dot(this.d1), -1, 1));
    // axis of the great circle; any perpendicular if the two points are (nearly) opposite or identical
    this.axis = new THREE.Vector3().crossVectors(this.d0, this.d1);
    if (this.axis.lengthSq() < 1e-8) { this.axis.set(0, 1, 0); if (Math.abs(this.d0.y) > 0.9) this.axis.set(1, 0, 0); this.axis.cross(this.d0); }
    this.axis.normalize();
    const chord = from.distanceTo(to);
    this.H = H ?? THREE.MathUtils.clamp(SPIT.H_BASE + SPIT.H_PER_M * chord, SPIT.H_MIN, SPIT.H_MAX);
    this._q = new THREE.Quaternion(); this._d = new THREE.Vector3();
  }
  dir(s, out = this._d) { return out.copy(this.d0).applyQuaternion(this._q.setFromAxisAngle(this.axis, this.omega * s)); }
  radius(s, d) {
    const base = this.r0 + (this.r1 - this.r0) * s + this.H * Math.pow(Math.sin(Math.PI * s), 0.8);
    return Math.max(base, this.surface(d) + SPIT.CLEAR * Math.min(1, Math.sin(Math.PI * s) * 10));   // the floor fades in over the first and last 3% so the ends stay on the mouth and the ground
  }
  getPoint(s, target = new THREE.Vector3()) {
    const d = this.dir(s); return target.copy(this.centre).addScaledVector(d, this.radius(s, d));
  }
  /* min height above surface(dir) over s in [a, b] (samples) */
  minClearance(a = 0.04, b = 0.96, n = 400) {
    let m = Infinity; const p = new THREE.Vector3(), d = new THREE.Vector3();
    for (let i = 0; i <= n; i++) { const s = a + (b - a) * i / n; this.getPoint(s, p); d.copy(p).sub(this.centre).normalize(); m = Math.min(m, p.distanceTo(this.centre) - this.surface(d)); }
    return m;
  }
}
