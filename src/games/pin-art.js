import * as THREE from "three";
import { Pinscreen } from "../pinscreen.js";
import { PadInput, PadReticle, padConnected } from "./padcursor.js";

/* PIN ART SANCTUARY: a walk-up version of Pin Art 3D (anshulpatria.github.io/3D-pin-art).
   The pinscreen always stands with the cowboy cat pressed into it, in graded relief (the
   product's Image mode run on assets/pin-art-cowboy-cat.png). Step up and drag across it to push
   pins out, exactly like the product's Sculpt mode (pushes add up and stay; nothing springs
   back). The picture buttons are the product's Image mode (a picture replaces the board), Undo
   steps back one stroke, Reset puts the current picture back. Pushing your first proper stroke
   counts as the discovery. Pins are one InstancedMesh, "pinart-pins" (see pinscreen.js). */

const DISCOVER_WORK = 20;   // total depth a visitor must push (about one short drag)

export default class PinArtGame {
  static id = "pin-art";

  constructor(ctx) {
    this.ctx = ctx;
    const ex = ctx.extra;
    this.pins = new Pinscreen(ex.anchor, ex.pinGeometry, { spacing: ctx.lowPower ? 0.2 : 0.15, lowPower: ctx.lowPower });
    ctx.scene.add(this.pins.mesh, this.pins.relief);
    this.ready = this.pins.preparePatterns().then(() => {
      this.pins.setPattern(this.pins.patterns.cat ? "cat" : "monogram");
      this.pins.undoLen = 0;   // the default picture is not an undo step
    });
    this.solved = ctx.isSolved();
    // R7 T4: gamepad. Left stick / D-pad moves a cursor over the board, A (held) pushes pins, Y undo, Back reset, LB/RB picture.
    // (Y undo; the picture chips and Reset are the focus-bar buttons, reached with LB / RB by input.js)
    this.pad = new PadInput(); this.reticle = new PadReticle(); this.padNdc = new THREE.Vector2(0, 0); this.padDrive = false;
    this._ray = new THREE.Raycaster();
  }

  enter() {
    this.padNdc.set(0, 0); this.padDrive = false;
    this.pins.active = true;
    this.pins.awake = true;
    this.tools();
    // frame the whole screen for this viewport
    const cam = this.ctx.camera, g = this.ctx.group;
    const centre = g.worldToLocal(this.pins.origin.clone());
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect);
    const vfov = THREE.MathUtils.degToRad(cam.fov);
    const need = Math.max((this.pins.w / 2 + 1.6) / Math.tan(hfov / 2), (this.pins.h / 2 + 2.2) / Math.tan(vfov / 2));
    // a little from the right and above (the product shot's oblique view), so the long
    // pins and their rounded heads read as pins, not a flat picture
    const pos = centre.clone().add(new THREE.Vector3(0.24, 0.16, 1).normalize().multiplyScalar(need));
    return { pos, look: centre };
  }

  tools() {
    const ui = this.ctx.ui, P = this.pins;
    ui.status(this.solved ? null : padConnected() ? "Hold A and move the stick to push the pins out" : "Drag across the pins to push them out");
    const img = name => () => { P.setPattern(name); this.tools(); };
    ui.tools([
      { label: "Cowboy cat", group: "img", pressed: P.patternName === "cat", onClick: img("cat") },
      { label: "Monogram", group: "img", pressed: P.patternName === "monogram", onClick: img("monogram") },
      { label: "Blank", group: "img", pressed: P.patternName === "flat", onClick: img("flat") },
      { label: "Undo", onClick: () => { P.undo(); } },
      { label: "Reset", onClick: () => { P.reset(); } },
    ]);
  }

  exit() { this.padDrive = false; this.reticle.hide(); this.pins.active = false; this.down = false; this.lastRay = null; this.pins.pointer(this._noRay || (this._noRay = new THREE.Ray()), false); }

  pointer(e) {
    if (!this.pins.active) return;
    this.padDrive = false;   // the mouse or a finger takes over again
    this.lastRay = e.ray; this.down = e.down;
  }

  /* gamepad: returns true when the pad is steering this frame (then lastRay / down come from the cursor) */
  padStep(dt) {
    const P = this.pad; P.poll();
    if (!P.on) { this.padDrive = false; this.reticle.hide(); return; }
    const A = P.held[0];
    if (P.mag > 0 || A) this.padDrive = true;
    if (P.edge[3]) this.pins.undo();
    if (!this.padDrive) return;
    const sp = 1.25 * P.mag * P.mag + 0.15 * P.mag;   // NDC per second: small tilts nudge, full tilt sweeps
    const n = this.padNdc, c = this.ctx.camera;
    n.x = Math.max(-1, Math.min(1, n.x + P.x * sp * dt)); n.y = Math.max(-1, Math.min(1, n.y - P.y * sp * dt));
    this.down = A;
    if (c) { this._ray.setFromCamera(n, c); this.lastRay = this._ray.ray.clone(); }
    this.reticle.show(n.x, n.y, A);
  }

  update(dt, t, focused, playerDist) {
    if (focused && this.pins.active) this.padStep(Math.min(dt, 0.05));
    this.pins.setView(this.ctx.camera, innerHeight * Math.min(devicePixelRatio, 1.75));
    if (focused && this.lastRay) this.pins.pointer(this.lastRay, this.down);
    this.pins.update(dt, t, playerDist);
    if (focused && !this.solved && this.pins.work >= DISCOVER_WORK) {
      this.solved = true;
      this.ctx.ui.status(null);
      this.ctx.solved();
    }
  }

  dispose() { this.reticle.dispose(); this.ctx.scene.remove(this.pins.mesh, this.pins.relief); }
}
