import * as THREE from "three";

/* A walkable body (the planet or the moon). Walking height is analytic: the same
   terrace formula build_planet.py used to make the meshes, so feet meet the ground
   exactly and nothing needs a raycast. Colliders are circles on the surface. */

export class Body {
  constructor(name, centre, radius) {
    this.name = name;
    this.centre = centre.clone();
    this.R = radius;
    this.plateaus = [];   // { n, rp, t0, t1 }
    this.colliders = [];  // { p, r }
  }

  addPlateau(worldPos, ud) {
    const n = worldPos.clone().sub(this.centre).normalize();
    this.plateaus.push({ n, rp: ud.rp, t0: ud.t0, t1: ud.t1, c0: Math.cos(ud.t1) });
  }

  /* distance from the centre to the walkable surface along unit direction d */
  surface(d) {
    let r = this.R;
    for (const p of this.plateaus) {
      const c = d.dot(p.n);
      if (c < p.c0) continue;
      const th = Math.acos(Math.min(1, c));
      let rr;
      if (th <= p.t0) rr = p.rp / Math.cos(th);
      else {
        let k = (th - p.t0) / (p.t1 - p.t0); k = k * k * (3 - 2 * k);
        rr = (p.rp / Math.cos(p.t0)) * (1 - k) + (this.R - 0.25) * k;
      }
      if (rr > r) r = rr;
    }
    return r;
  }

  /* the ground's facing at unit direction d: a terrace's own normal on its flat top,
     blending to radial across its skirt; radial on open ground */
  normal(d, out = new THREE.Vector3()) {
    let best = this.R, n = null, k = 0;
    for (const p of this.plateaus) {
      const c = d.dot(p.n);
      if (c < p.c0) continue;
      const th = Math.acos(Math.min(1, c));
      let rr, kk;
      if (th <= p.t0) { rr = p.rp / Math.cos(th); kk = 0; }
      else { let q = (th - p.t0) / (p.t1 - p.t0); q = q * q * (3 - 2 * q); rr = (p.rp / Math.cos(p.t0)) * (1 - q) + (this.R - 0.25) * q; kk = q; }
      if (rr > best) { best = rr; n = p.n; k = kk; }
    }
    if (!n) return out.copy(d);
    return out.copy(n).lerp(d, k).normalize();
  }

  up(pos, out = new THREE.Vector3()) { return out.copy(pos).sub(this.centre).normalize(); }

  /* push a surface point out of every collider (tangential), radius = body size.
     The 3D distance check comes first: projecting onto the tangent plane alone makes
     colliders on the far side of the planet look close (the axis between them is the
     one the projection throws away), which would shove the player around every frame. */
  collide(pos, radius, wade = false) {
    // a few relaxation passes so narrow gaps (two colliders at once) settle instead of vibrating
    for (let pass = 0; pass < 3; pass++) this.collideOnce(pos, radius, wade);
  }
  /* wade: the mover can walk through colliders flagged `wade` (the ponds: the ground under the water is the
     ordinary open ground, so Blip may stand in it). Anything that omits it (fauna, props) still keeps out. */
  collideOnce(pos, radius, wade = false) {
    const up = this.up(pos);
    for (const c of this.colliders) {
      if (wade && c.wade) continue;
      if (pos.distanceToSquared(c.p) > (c.r + radius + 2.5) ** 2) continue;
      const d = pos.clone().sub(c.p);
      d.addScaledVector(up, -d.dot(up));
      const l = d.length(), min = c.r + radius;
      if (l < min && l > 1e-5) pos.addScaledVector(d, (min - l) / l);
    }
  }
}
