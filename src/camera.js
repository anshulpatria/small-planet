import * as THREE from "three";

/* Idle recentre: after a drag frees the lens, IDLE_RECENTRE_S after the last drag it eases back behind Blip,
   standing still too. One critically damped spring (no overshoot, ~1.9 s to within 5 deg) on the yaw and pitch
   errors. Any new drag cancels it; a scripted aim (moon reveal, bench, snap, a focus view) takes the lens over. */
export const IDLE_RECENTRE_S = 2.5;   // 2.5 s of no look input before the lens returns: third-person action cameras (Ghost of Tsushima, Zelda BotW, Uncharted; GDC "50 camera mistakes") hold a manual aim for ~2-3 s so a deliberate look is never fought, then ease back with a slow critically damped spring (no overshoot, no snap).
const FOLLOW_RATE = 1.4;   // 1/s: travel-follow yaw gain (rad/s per rad of error), capped by FOLLOW_MAX
const FOLLOW_MAX = 1.8;    // rad/s: the fastest the lens swings round behind the direction of travel (a full 180 in ~1.7 s)
export const RECENTRE_W = 2.6;   // spring rate, rad/s
/* Zoom recentre (zoom only, the direction recentre above is separate): ZOOM_RECENTRE_S after the last wheel or pinch, the zoom
   eases back to the distance it had before the player zoomed (the default follow distance, or a scripted view's own). */
export const ZOOM_RECENTRE_S = 2.5, ZOOM_RECENTRE_RATE = 1.6;
const ZOOM_WALK_S = 0.6, PITCH_WALK_RATE = 1.6;   // R7: once Blip walks, a zoom eases home after 0.6 s (not 2.5) and a manual tilt eases home at the zoom's rate (~2 s)   // s of no zoom input; 1/s exponential ease (~2 s to within 5 %)
/* Far-zoom occlusion. Zoomed out, only TERRAIN (and anything the occluder fade cannot draw see-through) moves the lens, so
   it does not snap in to every tree, post or house that crosses the line to Blip; a prop fades
   instead (occfade.js, every non-terrain occluder is handed to it). The prop pull-in is kept only for a close lens: below
   PROP_PULL_FULL x home (8.1 m) a prop fills most of the frame, so a see-through slab across the whole view reads worse than
   the lens stepping in front of it; it blends out by PROP_PULL_NONE x home (11.4 m, still well inside the default 16.25 m)
   so a zoom across the band never snaps. `fadeProps = false` pulls in for every occluder (the OFF control of the tests). */
export const PROP_PULL_FULL = 0.5, PROP_PULL_NONE = 0.7;
const TERRAIN_RE = /TERRACE|LIP_|_ground|^CAVE_/;   // planet/moon ground, terraces, the cave rock: always pull/lift
const OLD_TERRAIN_RE = /TERRACE|LIP_|_ground/;

/* one exact step of a critically damped spring pulling x (velocity v) to 0 */
export function springStep(x, v, w, dt) {
  const e = Math.exp(-w * dt), t = (v + w * x) * dt;
  return [(x + t) * e, (v - w * t) * e];
}
const _f = new THREE.Vector3(), _c = new THREE.Vector3(), _rq = new THREE.Quaternion();

/* Keep-out boxes (ADD-ONLY, round 6 C1): world-space Box3es the lens must never sit inside (the pin-art screen, see occluders.js).
   Applied to the finished lens position each frame: if the straight line from Blip's chest to the lens crosses a box, the lens
   stops at the box's face on that line. A chord of the position lerp (a fast drag) cannot take the lens through the screen. */
const _ko = new THREE.Vector3(), _kd = new THREE.Vector3(), _kr = new THREE.Ray(), _kh = new THREE.Vector3(), _kb = new THREE.Box3(), _ka = new THREE.Vector3(), _kb2 = new THREE.Vector3(), _kt = new THREE.Vector3(), _kq = new THREE.Vector3(), ROCK_R = 0.28, ROCK_NEAR = 20, _kRay = new THREE.Raycaster();

/* Follow camera for a round world. The camera's own forward is a tangent vector that
   rides along with the player (re-flattened to the local ground every frame), so the
   horizon curves away under you. Drag turns it around the local up; wheel zooms.
   `focus` glides to a game view; `chase` is used in cannon flight. */

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.fwd = new THREE.Vector3(0, 0, -1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.home = 16.25; this.homePitch = 0.5;   // pulled back so the curve of the planet reads around you
    this.dist = this.home; this.distWanted = this.home;
    this.pitch = this.homePitch;
    this.look = new THREE.Vector3();
    this.mode = "follow";
    this.focusPos = new THREE.Vector3(); this.focusLook = new THREE.Vector3(); this.focusUp = new THREE.Vector3(0, 1, 0);
    this.lockFwd = true;   // drift behind the player's facing when they walk
    this.ray = new THREE.Raycaster(); this.ray.firstHitOnly = true;
    this.keepOut = []; this.glide = null;   // world Box3es the lens may not enter (clampKeepOut)
    this.occluders = null; // set by main: BVH-backed meshes the lens must not pass through
    this.coll = this.home; this.lift = 0;
    this.fadeProps = true; this._fadeN = -1; this.occHit = null;   // occHit: the mesh the lens ray hit last frame (tests read it)
    // idle recentre state: freed by a drag; idleT since the last drag; spring velocities; last fwd/pitch the rig wrote
    this.freed = false; this.idleT = 0; this.yawV = 0; this.pitchV = 0;
    this.zoomBase = null; this.zoomT = 0; this.zoomSeen = 0;   // zoom recentre: the distance to return to, time since the last zoom, the distance the rig last wrote
    this.seenFwd = this.fwd.clone(); this.seenPitch = this.pitch; this.lastPos = null;
    // travel-follow: the move frame is latched so the lens swinging round behind Blip never changes the world direction of a held input (no feedback spin)
    this.mvFwd = this.fwd.clone(); this.mvAng = null; this.vel = 0;
  }

  applyLook(dx, dy) {
    if (dx || dy) { this.freed = true; this.idleT = 0; this.yawV = this.pitchV = 0; }   // a drag owns the lens; a new drag cancels a recentre
    if (Math.abs(dx) > 0) { this.fwd.applyAxisAngle(this.up, -dx * 0.006); this.mvFwd.applyAxisAngle(this.up, -dx * 0.006); }   // a drag turns the move frame with the lens
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.003, 0.12, 1.1);
    if (dx || dy) { this.seenFwd.copy(this.fwd); this.seenPitch = this.pitch; }
    if (dy) this.pitchUser = true;   // R7: a manual tilt is undone by walking, like the yaw
  }
  zoom(z) {
    if (!z) return;
    if (this.zoomBase === null) this.zoomBase = this.distWanted;
    this.distWanted = THREE.MathUtils.clamp(this.distWanted + z * 1.2, 4.5, 34);
    this.zoomT = 0; this.zoomSeen = this.distWanted;
  }
  /* round 6 C1: stop the lens at the face of any keepOut box that the line Blip -> lens crosses (Blip himself outside it) */
  clampKeepOut(player) {
    const pos = this.camera.position, from = _ko.copy(player.position).addScaledVector(player.viewUp || player.up, 1.3);
    for (const b of this.keepOut) {
      let box = b;
      if (b.containsPoint(from)) {   // Blip stands inside the margin: test the bare box instead (margin stored on the box)
        if (!b.margin) continue;
        box = _kb.copy(b).expandByScalar(-b.margin); if (box.containsPoint(from)) continue;
      }
      _kd.subVectors(pos, from); const len = _kd.length(); if (len < 1e-4) continue;
      _kr.set(from, _kd.divideScalar(len));
      if (_kr.intersectBox(box, _kh) && from.distanceTo(_kh) < len) pos.copy(_kh);
    }
  }
  /* round 6 C3 (ADD-ONLY): after a scripted focus shot, release() it and glide the lens back to the follow pose over `dur` s
     (smoothstep: peak speed 1.5x the mean, no snap), instead of the hard cut of snap(). Never used by existing callers. */
  glideHome(dur = 1.4) {
    this.mode = "follow"; this.freed = false;
    this.glide = { t: 0, dur, pos: this.camera.position.clone(), look: this.look.clone() };
  }
  /* round 6 C2 (ADD-ONLY): the lens is a 0.28 m ball that may not touch the cave rock (CAVE_*). Five rays from Blip's chest, one to
     the lens and four to points 0.28 m round it, give the nearest rock face; the lens stops 0.2 m short of it, along its own line
     (min 0.25 m from Blip). Before this the pull-in floor (1.8 m) and the fast lerp left the lens inside or flush with the rock. */
  clampRock(player) {
    if (!this.occluders) return;
    if (this._rockN !== this.occluders.length) {
      this._rockN = this.occluders.length; this._rock = this.occluders.filter(o => /^CAVE_/.test(o.name));
      this._rockBox = new THREE.Box3(); for (const o of this._rock) { o.geometry.computeBoundingBox(); this._rockBox.union(_kb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)); }   // once per list change
      this._rockSph = this._rockBox.getBoundingSphere(new THREE.Sphere());
    }
    if (!this._rock.length) return;
    const pos = this.camera.position, from = _ko.copy(player.position).addScaledVector(player.viewUp || player.up, 1.3);
    const far = this._rockSph.radius + ROCK_NEAR;   // nothing to do far from the cave: Blip and the lens both well outside its bounding sphere
    if (from.distanceTo(this._rockSph.center) > far && pos.distanceTo(this._rockSph.center) > far) return;
    _kd.subVectors(pos, from); const len = _kd.length(); if (len < 0.3) return; _kd.divideScalar(len);
    _ka.crossVectors(_kd, this.up); if (_ka.lengthSq() < 0.05) _ka.set(1, 0, 0); _ka.normalize(); _kb2.crossVectors(_kd, _ka).normalize();
    let best = len;
    for (let k = 0; k < 5; k++) {
      _kt.copy(pos); if (k) _kt.addScaledVector(k < 3 ? _ka : _kb2, (k & 1 ? 1 : -1) * ROCK_R);
      _kq.subVectors(_kt, from); const rl = _kq.length(); _kRay.set(from, _kq.divideScalar(rl)); _kRay.far = rl + 0.2;   // its own ray: this.ray (the occlusion code's) is left alone
      const h = _kRay.intersectObjects(this._rock, false)[0];
      if (h) best = Math.min(best, h.distance * (len / rl) - 0.2);
    }
    if (best < len) pos.copy(from).addScaledVector(_kd, Math.max(0.25, best));
  }
  focus(pos, look, up) { this.glide = null; this.mode = "focus"; this.focusPos.copy(pos); this.focusLook.copy(look); this.focusUp.copy(up); }
  release() { this.mode = "follow"; }

  /* movement intent (x = right, y = forward) as a world tangent vector */
  moveVector(x, y) {
    const mag = Math.hypot(x, y);
    if (mag < 0.05) { this.mvFwd.copy(this.fwd); this.mvAng = null; return new THREE.Vector3(); }   // idle: the next push is relative to the lens as it is now
    const ang = Math.atan2(x, y);
    // a new push, or a sudden change of direction (key press, stick flick): re-latch to the lens as it is now. A slow stick sweep keeps the frame, so it stays continuous.
    if (this.mvAng === null || Math.abs(Math.atan2(Math.sin(ang - this.mvAng), Math.cos(ang - this.mvAng))) > 0.25) this.mvFwd.copy(this.fwd);
    this.mvAng = ang;
    const f = this.mvFwd, right = new THREE.Vector3().crossVectors(f, this.up).normalize();
    return f.clone().multiplyScalar(Math.cos(ang) * Math.min(1, mag)).addScaledVector(right, Math.sin(ang) * Math.min(1, mag));
  }

  snap(player) {
    this.up.copy(player.viewUp || player.up);
    this.fwd.copy(player.facing).addScaledVector(this.up, -player.facing.dot(this.up)).normalize();
    const p = this.pose(player);
    this.camera.position.copy(p.pos); this.look.copy(p.look); this.camera.up.copy(this.up); this.camera.lookAt(this.look);
    this.coll = this.dist; this.lift = 0; this.glide = null;
    this.freed = false; this.seenFwd.copy(this.fwd); this.seenPitch = this.pitch;
    this.mvFwd.copy(this.fwd); this.mvAng = null; this.vel = 0; this.lastPos = null;
  }

  pose(player, dist = this.dist, pitch = this.pitch) {
    const target = player.position.clone().addScaledVector(player.viewUp || player.up, 1.3);
    const back = this.fwd.clone().multiplyScalar(-Math.cos(pitch) * dist).addScaledVector(this.up, Math.sin(pitch) * dist + 0.6);
    return { pos: target.clone().add(back), look: target.clone().addScaledVector(this.fwd, 2.2) };
  }

  /* Auto-follow (Ghost of Tsushima style): while Blip really travels (measured speed), the lens swings round behind
     his facing, sideways and diagonal included. This cannot spin him because moveVector() latches its frame: a held
     input keeps its world direction while the lens turns. A manual drag holds the lens for IDLE_RECENTRE_S first. */
  update(dt, player) {
    const cam = this.camera;
    if (this.zoomBase !== null) {   // a script that set distWanted since the last zoom owns the zoom now
      if (Math.abs(this.distWanted - this.zoomSeen) > 1e-6) this.zoomBase = null;
      else if ((this.zoomT += dt) >= ZOOM_RECENTRE_S || (this._trav && this.zoomT >= ZOOM_WALK_S)) {   // R7: walking brings the zoom home too
        this.distWanted = THREE.MathUtils.damp(this.distWanted, this.zoomBase, ZOOM_RECENTRE_RATE, dt);
        if (Math.abs(this.distWanted - this.zoomBase) < 0.02) { this.distWanted = this.zoomBase; this.zoomBase = null; }
        this.zoomSeen = this.distWanted;
      }
    }
    this.dist = THREE.MathUtils.damp(this.dist, this.distWanted, 6, dt);
    if (this.mode === "focus") {
      cam.position.lerp(this.focusPos, 1 - Math.exp(-dt * 3));
      this.look.lerp(this.focusLook, 1 - Math.exp(-dt * 3));
      cam.up.lerp(this.focusUp, 1 - Math.exp(-dt * 3)).normalize();
      cam.lookAt(this.look);
      this.freed = false;   // a game view owns the lens; coming back is not a recentre
      return;
    }
    // a scripted aim changed fwd or pitch from outside the rig (moon reveal, bench, stand-up): it owns the lens now
    if (this.fwd.distanceToSquared(this.seenFwd) > 1e-10 || Math.abs(this.pitch - this.seenPitch) > 1e-7) { this.freed = false; this.mvFwd.copy(this.fwd); this.pitchUser = false; }
    const dsp = this.lastPos && dt > 0 ? player.position.distanceTo(this.lastPos) / dt : 0;
    const still = this.lastPos ? dsp < 0.2 : false;   // standing (< 0.2 m/s)
    if (dsp < 25) this.vel = THREE.MathUtils.damp(this.vel, dsp, 10, dt); else this.vel = 0;   // a teleport (hop, cannon landing) is not travel
    (this.lastPos || (this.lastPos = new THREE.Vector3())).copy(player.position);
    // carry the frame with the player across the curve
    this.up.lerp(player.viewUp || player.up, 1 - Math.exp(-dt * (player.flight ? 3 : 6))).normalize();
    this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();
    this.mvFwd.addScaledVector(this.up, -this.mvFwd.dot(this.up)).normalize();
    if (this.freed) this.idleT += dt;
    const travelling = !player.flight && this.lockFwd && this.vel > 0.8 && !player.frozen && (!this.freed || this.idleT >= IDLE_RECENTRE_S);
    this._trav = travelling;
    if (player.flight) {
      const f = player.facing.clone().addScaledVector(this.up, -player.facing.dot(this.up)).normalize();
      this.fwd.lerp(f, 1 - Math.exp(-dt * 4)).normalize();
      this.yawV = this.pitchV = 0;
    } else if (travelling) {
      // swing behind the direction of travel: capped yaw rate, ramped in so tiny errors do not wobble, scaled by speed
      const f = _f.copy(player.facing).addScaledVector(this.up, -player.facing.dot(this.up)).normalize();
      const err = Math.atan2(_c.crossVectors(this.fwd, f).dot(this.up), this.fwd.dot(f));   // + = turn toward f
      const a = Math.abs(err), gate = THREE.MathUtils.smoothstep(a, 0.02, 0.25) * THREE.MathUtils.smoothstep(this.vel, 0.8, 2.2);
      const step = Math.sign(err || 1) * Math.min(FOLLOW_MAX, FOLLOW_RATE * a) * gate * dt;
      this.fwd.applyAxisAngle(this.up, Math.abs(step) > a ? err : step).normalize();
      this.freed = false; this.yawV = this.pitchV = 0;
      if (this.pitchUser) {   // R7: walking also eases a manual tilt back to the home pitch (same gate as the yaw follow)
        this.pitch = THREE.MathUtils.damp(this.pitch, this.homePitch, PITCH_WALK_RATE * THREE.MathUtils.smoothstep(this.vel, 0.8, 2.2), dt);
        if (Math.abs(this.pitch - this.homePitch) < 0.002) { this.pitch = this.homePitch; this.pitchUser = false; }
      }
    } else if (this.freed) {
      if (this.idleT >= IDLE_RECENTRE_S && still) {
        const f = _f.copy(player.facing).addScaledVector(this.up, -player.facing.dot(this.up)).normalize();
        const yaw = Math.atan2(_c.crossVectors(f, this.fwd).dot(this.up), f.dot(this.fwd));
        const [y2, yv] = springStep(yaw, this.yawV, RECENTRE_W, dt); this.yawV = yv;
        this.fwd.copy(f).applyQuaternion(_rq.setFromAxisAngle(this.up, y2));
        const [p2, pv] = springStep(this.pitch - this.homePitch, this.pitchV, RECENTRE_W, dt); this.pitchV = pv;
        this.pitch = this.homePitch + p2;
        if (Math.abs(y2) < 0.002 && Math.abs(p2) < 0.002) { this.freed = false; this.pitchUser = false; }
      } else this.yawV = this.pitchV = 0;
    } else if (this.pitchUser) {   // R7: the yaw already came home (a walk took the lens) but Blip stopped before the tilt did: finish it
      this.pitch = THREE.MathUtils.damp(this.pitch, this.homePitch, PITCH_WALK_RATE, dt);
      if (Math.abs(this.pitch - this.homePitch) < 0.002) { this.pitch = this.homePitch; this.pitchUser = false; }
    }
    /* Occlusion, without pumping:
       - ground and terraces in the way -> lift the camera over them (pitch boost);
       - anything else -> come in fast, ease back out slowly (hysteresis), so a ray that
         grazes a column on alternate frames can't yank the lens in and out. */
    let wantDist = this.dist, terrain = false;
    const fade = this.fadeProps && this.occFade && this.occFade.add ? this.occFade : null;
    if (fade && this.occluders && this.occluders.length !== this._fadeN) {   // (re)hand the props to the fade when the list changes
      this._fadeN = this.occluders.length;
      fade.add(this.occluders.filter(o => !TERRAIN_RE.test(o.name)));
    }
    this.occHit = null; this.occProp = null;   // occProp: the first prop the ray passed through (faded, not pulled for)
    if (this.occluders && !player.flight) {
      const probe = this.pose(player, this.dist, this.pitch + this.lift);
      const from = player.position.clone().addScaledVector(player.viewUp || player.up, 1.3);
      const dir = probe.pos.clone().sub(from); const len = dir.length(); dir.divideScalar(len);
      this.ray.set(from, dir); this.ray.far = len + 0.5;
      const hits = this.ray.intersectObjects(this.occluders, false);
      if (!fade) {
        const hit = hits.find(h => h.object.visible);
        if (hit) {
          this.occHit = hit.object;
          if (OLD_TERRAIN_RE.test(hit.object.name)) terrain = true;
          else wantDist = Math.max(1.8, hit.distance - 0.5);
        }
      } else {
        // 0 = props pull the lens in (close zoom) .. 1 = props only fade (default zoom and beyond)
        const propW = THREE.MathUtils.smoothstep(this.distWanted, this.home * PROP_PULL_FULL, this.home * PROP_PULL_NONE);
        for (const h of hits) {
          if (!h.object.visible) continue;
          const pull = Math.max(1.8, h.distance - 0.5);
          if (TERRAIN_RE.test(h.object.name)) {   // lift over it; once the lift is spent, come in in front of it
            this.occHit = h.object; terrain = true;
            if (this.lift > 0.74 || /^CAVE_/.test(h.object.name)) wantDist = pull;   // a lift cannot clear the cave shell (the lens would go inside the rock): come in now
            break;
          }
          const own = h.object.userData.occFade;   // a mesh with its own fade (the stage ring, rig.stageFade): hold it faded the same way
          if (own && !fade.has(h.object) && propW >= 1) own.hold = Math.max(own.hold, 0.25);
          if (own) {
            if (propW >= 1) { this.occProp = this.occProp || h.object; continue; }   // see-through: look past it for terrain
            this.occHit = h.object; wantDist = THREE.MathUtils.lerp(pull, this.dist, propW); break;
          }
          this.occHit = h.object; wantDist = pull; break;   // cannot fade (the pin volume, the stage ring): pull in
        }
      }
    }
    this.lift = terrain ? Math.min(0.75, this.lift + dt * 1.6) : THREE.MathUtils.damp(this.lift, 0, 1.2, dt);
    this.coll = wantDist < this.coll ? THREE.MathUtils.damp(this.coll, wantDist, 14, dt) : THREE.MathUtils.damp(this.coll, wantDist, 1.8, dt);
    const p = this.pose(player, Math.min(this.dist, this.coll), this.pitch + this.lift);
    if (this.glide) {   // C3: eased return from a focus shot (glideHome); p.pos / p.look keep moving with Blip underneath it
      const g = this.glide; g.t += dt; const u = Math.min(1, g.t / g.dur), k = u * u * (3 - 2 * u);
      cam.position.copy(g.pos).lerp(p.pos, k); this.look.copy(g.look).lerp(p.look, k);
      if (u >= 1) this.glide = null;
    } else {
    cam.position.lerp(p.pos, 1 - Math.exp(-dt * (player.flight ? 6 : 9)));
    }
    if (this.keepOut && this.keepOut.length && !player.flight) this.clampKeepOut(player);
    if (!player.flight) this.clampRock(player);
    if (!this.glide) this.look.lerp(p.look, 1 - Math.exp(-dt * 12));
    cam.up.lerp(this.up, 1 - Math.exp(-dt * 8)).normalize();
    cam.lookAt(this.look);
    this.seenFwd.copy(this.fwd); this.seenPitch = this.pitch;
  }
}
