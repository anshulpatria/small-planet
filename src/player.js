import * as THREE from "three";

/* The visitor on a small planet. Gravity points to the centre of whichever body
   they stand on; "forward" is a tangent vector carried along as they move.
   Movement: tangent step -> re-project onto the analytic surface -> push out of
   colliders. Space jumps. A scripted `flight` (the cannon) overrides all of it. */

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _ax = new THREE.Vector3();
export const SIT = { back: 0.16, thigh: Math.PI / 2, foot: -2.8, drop: 0.16 };   // rad about the bone's X (thigh level, foot hanging), root sink below the seat anchor and shift toward the seat's front (m); tuned by eye: ankle ends 0.36 m in front of the anchor, clear of the seat edge
const SIT_EASE = 0.35;  // s to blend into / out of the seated pose
const HOP_FADE = 16;    // 1/s: Jump/Land hand back to the stride in ~0.15 s (Cheer/Wave keep their slower 6)
const LAND_MOVING = 0.8; // share of the Land pose given up to the stride at full walking blend (legs keep cycling on a moving landing)
const TURN = 14;       // rad/s: a full about-turn in about a quarter of a second
export const WALK_SPEED = 5.0, RUN_SPEED = 7.75;   // m/s
const STEP_UP = 0.6;   // tallest edge you can walk up (the stair's rise is 0.42)
const LEDGE = 1.0;     // deepest drop you can walk off a stair/lookout (a jump can go further)
export const WADE_SINK = 0.11;   // m the figure stands lower in a pond (water.js sets `wade` 0..1); the camera follows the feet, not this
export const WADE_SLOW = 0.25;   // fraction of walking speed lost at full wade

export class Player {
  constructor(scene, gltf) {
    this.group = new THREE.Group(); this.group.name = "PLAYER"; scene.add(this.group);
    this.position = this.group.position;
    this.body = null;
    this.up = new THREE.Vector3(0, 1, 0);      // radial: gravity and movement
    this.viewUp = new THREE.Vector3(0, 1, 0);  // ground normal (flat on terraces): stance, camera
    this.gN = new THREE.Vector3();
    this.lastPos = new THREE.Vector3();
    this.supports = [];                         // walkable meshes above the ground (stairs, lookout)
    this.walls = [];                            // invisible round walls { c, n, r, rTop, hMin, hTop } (the spiral stair)
    this.sRay = new THREE.Raycaster(); this.sRay.firstHitOnly = true;
    this.moveSpeed = 0;                         // measured tangential speed (drives the walk blend)
    this.facing = new THREE.Vector3(0, 0, -1);
    this.height = 0; this.vr = 0;          // jump: height above ground, radial speed
    this.gravity = 1;                      // scale on the pull (the moon is floaty)
    this.speed = 0;
    this.wade = 0;                         // 0..1 how deep in pond water (set by PondWater each frame)
    this.flight = null;
    this.frozen = false;
    if (gltf) {
      this.figure = gltf.scene;
      this.figure.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });   // skinned: never culled out of the shadow pass by a rest-pose bound
      this.mixer = new THREE.AnimationMixer(this.figure);
      this.actions = {};
      for (const c of gltf.animations) this.actions[c.name] = this.mixer.clipAction(c);
      for (const n of ["Cheer", "Wave", "Jump", "Land"]) if (this.actions[n]) { this.actions[n].setLoop(THREE.LoopOnce, 1); this.actions[n].clampWhenFinished = true; }
      this.mixer.addEventListener("finished", e => { if (e.action === this.oneShot) this.release(); });
      // locomotion clips always run; their weights are set from speed every frame (no restarts)
      for (const n of ["Idle", "Walk", "Run"]) if (this.actions[n]) { this.actions[n].play(); this.actions[n].setEffectiveWeight(n === "Idle" ? 1 : 0); }
      this.osW = 0; this.fdW = 0; this.fadeRate = 6;   // weights of the playing one-shot and of the one fading out
      this.airK = 0;                                   // 0..1 eased "well off the ground" (halves the stride rate in the air without a pop)
      // seated pose (bench): procedural, on the two leg bones; the GLB has no sit clip
      this.sitting = false; this.sitK = 0;
      this.legs = [];
      this.figure.traverse(o => { if (o.isBone && /^leg/i.test(o.name)) { const foot = o.children.find(c => c.isBone && /^foot/i.test(c.name)); this.legs.push({ bone: o, foot, q0: o.quaternion.clone(), f0: foot ? foot.quaternion.clone() : null }); } });
    } else this.figure = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.6, 6, 16), new THREE.MeshToonMaterial({ color: "#3FA7A3" }));
    this.group.add(this.figure);
    // no fake shade under Blip (no blob, no ground disc): the figure casts the real sun shadow
    // like everything else; sky.js keeps the light's offsets small enough that it meets his feet
  }

  /* one-shots (Jump, Land, Cheer, Wave) fade in over the locomotion blend and back out */
  play(name) {
    const a = this.actions && this.actions[name];
    if (!a) return;
    if (this.fading === a) { this.fading.stop(); this.fading = null; this.osW = Math.max(this.osW, this.fdW); this.fdW = 0; }
    if (this.oneShot && this.oneShot !== a) this.release();   // the old one fades out under the new one (no snap)
    a.reset().play();
    this.oneShot = a;
  }

  /* hand the playing one-shot over to the fade-out slot (it holds its pose while its weight goes to the blend) */
  release() {
    const a = this.oneShot;
    if (!a) return;
    if (this.fading && this.fading !== a) this.fading.stop();
    this.fading = a; this.fdW = this.osW; this.osW = 0; this.oneShot = null;
    this.fadeRate = (a === this.actions.Jump || a === this.actions.Land) ? HOP_FADE : 6;
  }

  /* stand on `body` at world position `pos`, facing tangent `fwd` */
  place(body, pos, fwd) {
    this.body = body;
    body.up(pos, this.up);
    const r = body.surface(this.up);
    this.position.copy(body.centre).addScaledVector(this.up, r);
    if (fwd) this.facing.copy(fwd).addScaledVector(this.up, -fwd.dot(this.up)).normalize();
    this.height = 0; this.vr = 0; this.speed = 0; this.moveSpeed = 0;
    this.feet = r; this.stepLift = 0;
    body.normal(this.up, this.viewUp);
    this.lastPos.copy(this.position);
    this.orient(1);
  }

  jump() { if (this.height < 0.05 && !this.flight) { this.vr = 7.5; this.play("Jump"); } }

  orient(k) {
    const z = this.facing.clone().negate(), y = this.viewUp, x = new THREE.Vector3().crossVectors(y, z).normalize();
    z.crossVectors(x, y);
    _m.makeBasis(x, y, z); _q.setFromRotationMatrix(_m);
    this.group.quaternion.slerp(_q, k);
  }

  /* move: tangent direction (world, unit or zero) and magnitude 0..1 */
  /* highest walkable surface (stairs, lookout) under `pos` whose top is at most `maxR`
     from the centre; null if none */
  supportTop(b, up, maxR, minR) {
    if (!this.supports.length) return null;
    const from = b.centre.clone().addScaledVector(up, maxR);
    this.sRay.set(from, up.clone().negate()); this.sRay.far = Math.max(0.01, maxR - minR);
    // walk the line down `up` (Blip's radial direction)
    const hit = this.sRay.intersectObjects(this.supports, false)[0];
    return hit ? hit.point.distanceTo(b.centre) : null;
  }

  /* Up on the spiral stair the open side is a drop: once you are above the first step and
     were inside the stair's round footprint, you can't step out past its rim (or the
     lookout's rail). Someone jumping beside the stair from outside is never pulled in. */
  keepInside(prev) {
    for (const w of this.walls) {
      const d = this.position.clone().sub(w.c), h = d.dot(w.n);
      if (h < w.hMin) continue;
      const rim = h > w.hTop ? w.rTop : w.r;
      const p0 = prev.clone().sub(w.c); p0.addScaledVector(w.n, -p0.dot(w.n));
      if (p0.length() > rim + 0.3) continue;
      const rad = d.clone().addScaledVector(w.n, -h), l = rad.length();
      if (l > rim) this.position.addScaledVector(rad, (rim - l) / l);
    }
  }

  update(dt, move, run) {
    if (this.flight) return this.updateFlight(dt);
    const b = this.body;
    const prev = this.position.clone();
    const prevFeet = this.feet ?? prev.distanceTo(b.centre);
    // standing on a stair/lookout (not on the ground, not mid-jump)
    const standing = this.height < 0.05 && this.vr <= 0 && prevFeet - b.surface(this.up) > 0.3;
    const mag = this.frozen ? 0 : Math.min(1, move.length());
    let want = (run ? RUN_SPEED : WALK_SPEED) * mag * (1 - WADE_SLOW * this.wade);
    let ang = 0;
    if (mag > 0.02) {
      const dir = move.clone().normalize();
      const cross = new THREE.Vector3().crossVectors(this.facing, dir);
      ang = Math.atan2(cross.dot(this.up), this.facing.dot(dir));
      // near-in-place turns: the further Blip is from facing where he wants to go, the less he travels (full speed inside ~25 deg, almost stopped past ~100 deg)
      const align = 1 - THREE.MathUtils.smoothstep(Math.abs(ang), 0.45, 1.75);
      want *= align;
      if (this.speed > want && align < 0.98) this.speed = THREE.MathUtils.damp(this.speed, want, 26, dt);   // brake hard while swinging round
      else this.speed = THREE.MathUtils.damp(this.speed, want, 10, dt);
      this.position.addScaledVector(dir, this.speed * dt);
      // turn toward the move at a steady rate around the local up (no lerp through zero on reversals)
      const turn = THREE.MathUtils.clamp(ang, -TURN * dt, TURN * dt);
      this.facing.applyAxisAngle(this.up, turn).normalize();
    } else {
      this.speed = THREE.MathUtils.damp(this.speed, want, 10, dt);
      if (this.speed > 0.05) this.position.addScaledVector(this.facing, this.speed * dt);
    }
    // back onto the body (sideways), then find the floor: the ground, or a stair/lookout
    // under the feet that is no more than a step above them
    b.up(this.position, this.up);
    b.collide(this.position, 0.45, true);
    this.keepInside(prev);
    b.up(this.position, this.up);
    const ground = b.surface(this.up);
    let floor = ground;
    if (this.supports.length) {
      // a walkable edge between a step and head height is a wall: refuse the move
      const wall = this.supportTop(b, this.up, prevFeet + 1.6, prevFeet + STEP_UP);
      if (wall !== null) {
        this.position.copy(prev); b.up(this.position, this.up);
      }
      const floorHere = () => {
        const top = this.supportTop(b, this.up, prevFeet + STEP_UP, b.surface(this.up) - 0.05);
        return Math.max(b.surface(this.up), top ?? -Infinity);
      };
      floor = floorHere();
      // Ledge guard (safety net). Standing on a stair/lookout, a walk never drops you more than
      // LEDGE (two risers are 0.84 m). The lookout pie reaches the steps' 2.7 m, so in practice
      // this only fires at the stairwell's edge (stay put); if some other rim ever runs past its
      // floor, out past rTop you slide in toward the stair's axis. A jump still clears the edge.
      if (standing && prevFeet - floor > LEDGE) {
        const w = this.walls.find(w => prev.clone().sub(w.c).dot(w.n) >= w.hMin);
        let ok = false;
        if (w) {
          const rad = prev.clone().sub(w.c); rad.addScaledVector(w.n, -rad.dot(w.n));
          const l = rad.length();
          if (l > w.rTop) {   // only out past the lookout's rail radius; at the stairwell's edge, just stop
            this.position.copy(prev).addScaledVector(rad, -Math.min(l - w.rTop, Math.max(this.speed, 1) * dt) / l);
            b.up(this.position, this.up); b.collide(this.position, 0.45, true); b.up(this.position, this.up);
            floor = floorHere(); ok = prevFeet - floor <= LEDGE;
          }
        }
        if (!ok) { this.position.copy(prev); b.up(this.position, this.up); floor = floorHere(); }
      }
    }
    // gravity / jump on radial distance
    this.vr -= 22 * this.gravity * dt;
    let feet = prevFeet + this.vr * dt;
    if (feet <= floor) {
      // touchdown: the Jump pose lets go at once, a hard one plays Land
      if (this.vr < 0 && this.actions && this.oneShot === this.actions.Jump) this.release();
      if (this.vr < -9 * Math.sqrt(this.gravity)) this.play("Land");
      if (floor - prevFeet > 0.05 && this.vr <= 0) this.stepLift = (this.stepLift || 0) - (floor - Math.max(prevFeet, feet));  // ease the body up the step
      feet = floor; this.vr = 0;
    }
    this.feet = feet;
    this.height = feet - floor;
    this.position.copy(b.centre).addScaledVector(this.up, feet);
    this.stepLift = THREE.MathUtils.damp(this.stepLift || 0, 0, 18, dt);
    this.figure.position.y = this.stepLift - WADE_SINK * this.wade;
    this.facing.addScaledVector(this.up, -this.facing.dot(this.up)).normalize();
    // stand square to the ground: flat terrace tops tilt up to ~20 deg from radial at their rims
    b.normal(this.up, this.gN);
    this.viewUp.lerp(this.gN, 1 - Math.exp(-dt * 10)).normalize();
    this.orient(1 - Math.exp(-dt * 14));
    const moved = this.position.clone().sub(this.lastPos); moved.addScaledVector(this.up, -moved.dot(this.up));
    this.moveSpeed = THREE.MathUtils.damp(this.moveSpeed, dt > 0 ? moved.length() / dt : 0, 12, dt);
    this.lastPos.copy(this.position);
    this.animate(dt);
  }

  /* cannon: follow a curve; on landing switch body */
  launch(curve, duration, toBody, landFwd, onLand) {
    this.flight = { curve, t: 0, duration, toBody, landFwd, onLand };
    this.play("Jump");
  }
  updateFlight(dt) {
    const f = this.flight;
    f.t = Math.min(1, f.t + dt / f.duration);
    const k = f.t < 0.5 ? 2 * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 2) / 2;
    const p = f.curve.getPoint(k);
    const tan = f.curve.getTangent(Math.min(0.999, k + 0.001));
    this.position.copy(p);
    // tumble a little in flight, upright again for landing
    const toB = f.toBody.centre.clone().sub(p).normalize().negate();
    this.up.lerp(toB, f.t * f.t).normalize();
    this.viewUp.copy(this.up);
    this.facing.copy(tan).addScaledVector(this.up, -tan.dot(this.up)).normalize();
    this.orient(0.3);
    this.figure.rotation.x = Math.sin(f.t * Math.PI) * -1.2;
    if (f.t >= 1) {
      this.flight = null; this.figure.rotation.x = 0;
      this.place(f.toBody, p, f.landFwd);
      this.viewUp.copy(this.up);
      this.flight = null;
      this.play("Land");
      f.onLand && f.onLand();
    }
    this.mixer && this.mixer.update(dt);
  }

  animate(dt) {
    if (!this.mixer) return;
    const A = this.actions;
    // seated: ease the locomotion blend out (weights always sum to 1 with Idle, so nothing pops) and the legs into the sit pose
    if (this.sitting) this.moveSpeed = THREE.MathUtils.damp(this.moveSpeed, 0, 9, dt);
    this.sitK = THREE.MathUtils.clamp(this.sitK + (this.sitting ? dt : -dt) / SIT_EASE, 0, 1);
    // in the air the stride runs at half rate (eased). Only the clip rate slows: the Walk/Run mix keeps following the
    // ground speed, so leaving or touching the ground never snaps Run->Walk->Run between two unsynced cycles
    this.airK = THREE.MathUtils.damp(this.airK, this.height > 0.3 ? 1 : 0, 12, dt);
    const sitE = THREE.MathUtils.smoothstep(this.sitK, 0, 1), gs = this.moveSpeed, sp = gs * (1 - 0.5 * this.airK);
    // Idle -> Walk between 0.3 and 1.8 m/s; Walk -> Run only above the walking speed, so walking (no Shift) is the Walk clip alone
    const walkK = THREE.MathUtils.smoothstep(gs, 0.3, 1.8), runK = THREE.MathUtils.smoothstep(gs, WALK_SPEED + 0.3, RUN_SPEED - 0.5);
    // a landing on the move keeps most of the stride (Land only dips the body); standing still it plays in full
    const osT = !this.oneShot ? 0 : this.oneShot === A.Land ? 1 - LAND_MOVING * walkK : 1;
    this.osW = THREE.MathUtils.damp(this.osW, osT, this.osW < osT ? 14 : HOP_FADE, dt);
    this.fdW = this.fading ? Math.min(THREE.MathUtils.damp(this.fdW, 0, this.fadeRate, dt), 1 - this.osW) : 0;
    const base = Math.max(0, 1 - this.osW - this.fdW);
    const walkW = walkK * (1 - runK) * base * (1 - sitE), runW = walkK * runK * base * (1 - sitE);
    A.Idle && A.Idle.setEffectiveWeight(base - walkW - runW);   // Idle (breathing) takes whatever locomotion gives up
    A.Walk && A.Walk.setEffectiveWeight(walkW);
    A.Run && A.Run.setEffectiveWeight(runW);
    if (A.Walk) A.Walk.timeScale = THREE.MathUtils.clamp(sp / 3.0, 0.6, WALK_SPEED / 3.0);
    if (A.Run) A.Run.timeScale = THREE.MathUtils.clamp(sp / 5.5, 0.8, 1.25);
    // while Walk and Run blend, the weaker one follows the stronger one's phase (both clips put the same leg forward
    // at the same fraction of their cycle), so a speed change across the band never crosses the legs mid-stride
    if (A.Walk && A.Run && walkW > 1e-3 && runW > 1e-3) {
      const lead = runW > walkW ? A.Run : A.Walk, follow = lead === A.Run ? A.Walk : A.Run;
      follow.time = (lead.time / lead.getClip().duration) * follow.getClip().duration;
    }
    if (this.oneShot) this.oneShot.setEffectiveWeight(this.osW);
    if (this.fading) {   // a finished one-shot holds its last pose; fade it out, then let it go
      this.fading.setEffectiveWeight(this.fdW);
      if (this.fdW < 0.01) { this.fading.stop(); this.fading = null; this.fdW = 0; }
    }
    this.mixer.update(dt);
    if (sitE > 0) this.applySit(sitE);
  }

  /* blend the leg bones from whatever the mixer left toward the seated pose (thighs forward and level, feet dangling) */
  applySit(e) {
    const c = SIT;
    for (const l of this.legs) {
      _q.setFromAxisAngle(_ax.set(1, 0, 0), c.thigh).multiply(l.q0);
      l.bone.quaternion.slerp(_q, e);
      if (l.foot) { _q.setFromAxisAngle(_ax.set(1, 0, 0), c.foot).multiply(l.f0); l.foot.quaternion.slerp(_q, e); }
    }
  }
}
