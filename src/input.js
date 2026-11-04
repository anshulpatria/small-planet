/* Keyboard, mouse-drag look, wheel zoom, a fixed touch stick + interact button, a gamepad, and taps/clicks.
   A drag never counts as a click; a short still press does.

   Touch (I2): the stick is a fixed ring in the bottom-left corner and the interact button (= E) sits bottom-right
   (index.html / styles.css, --ctl-size); every other finger on the scene orbits the camera through the drag path below,
   and a quick still tap there is the old tap-to-go (main.js click handler); there is no touch jump gesture, so stick,
   centre drag and tap all work at once (each finger is its own pointerId). Enter = E on desktop (main.js key handler).

   Gamepad (I1, standard mapping, polled once a frame from main's motionFrame via pollPads):
     left stick   walk (radial dead zone 0.15; to 0.50 = walk 5.0 m/s, 0.50 to 0.90 = run blend, 0.90+ = run 7.75 m/s)
     right stick  camera yaw / pitch (same sign as a drag)
     bottom face  (A on Xbox, Cross on DualSense, B on Switch)   = Space (jump)
     right / left face (B, X; Circle, Square; A, Y)               = E (interact)
     Start / Options / +                                          = Escape
     Back / Create / Share / -                                    = M (map)
     D-pad        = the arrow keys (walk)
   Buttons are sent as real KeyboardEvents on window, so every keyboard listener (this one, ui.js's Escape and Say hi
   handlers, a seated Blip's "any key") sees a pad exactly as it sees the keyboard. */

const PAD_DEAD = 0.15, PAD_WALK_TOP = 0.5, PAD_RUN_FULL = 0.9, PAD_LOOK_PX = 400;   // look rate at full tilt = 400 px/s of drag
const PAD_KEYS = [[0, " "], [1, "e"], [2, "e"], [8, "m"], [9, "Escape"], [12, "ArrowUp"], [13, "ArrowDown"], [14, "ArrowLeft"], [15, "ArrowRight"]];
const WALK_OVER_RUN = 5.0 / 7.75;   // main/player.js WALK_SPEED / RUN_SPEED: the run band starts at exactly walking speed

export class Input {
  constructor(canvas, stickEl) {
    this.keys = new Set();
    this.look = { dx: 0, dy: 0 };
    this.zoom = 0;
    this.stick = { x: 0, y: 0, active: false };
    this.pointer = { x: 0, y: 0, nx: 0, ny: 0, down: false, inside: false };
    this.handlers = { click: [], key: [], pointerMove: [], pointerDown: [], pointerUp: [] };
    this.lookEnabled = true;
    this.touch = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
    this.moved = false;
    this.pad = { vx: 0, vy: 0, mag: 0, run: false, active: false };
    this.padKeys = new Set();
    this.pads = new Map();    // connected standard pads: index -> id
    this.onPad = null;        // (type: "connect" | "disconnect", id) set by main (toasts)

    addEventListener("keydown", e => {
      if (e.target.closest && e.target.closest("input, textarea")) return;
      const k = e.key.toLowerCase();
      // Enter on a focused HUD button / link belongs to the browser (it clicks it); anywhere else Enter is E (main.js)
      if (k === "enter" && e.target.closest && e.target.closest("button, a, summary, [role=button]")) return;
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
      if (!this.keys.has(k)) this.handlers.key.forEach(f => f(k, e));
      this.keys.add(k);
    });
    addEventListener("keyup", e => this.keys.delete(e.key.toLowerCase()));
    addEventListener("blur", () => this.keys.clear());

    // touch: the stick is the fixed ring in the bottom-left corner; every other finger on the scene looks around.
    // Main sets `stickZone` to say when walking is possible at all (playing, no mini-game, no map).
    this.stickZone = () => true;
    const capture = (el, id) => { try { el.setPointerCapture(id); } catch (e) { /* synthetic or ended pointer */ } };
    const drags = new Map();
    canvas.addEventListener("pointerdown", e => {
      capture(canvas, e.pointerId);
      drags.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), travel: 0 });
      this.setPointer(e, canvas);
      this.pointer.down = true;
      this.handlers.pointerDown.forEach(f => f(this.pointer, e));
    });
    canvas.addEventListener("pointermove", e => {
      this.setPointer(e, canvas);
      this.pointer.inside = true;
      const d = drags.get(e.pointerId);
      if (d) {
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        d.travel += Math.abs(dx) + Math.abs(dy);
        d.x = e.clientX; d.y = e.clientY;
        if (this.lookEnabled && d.travel > 4) { this.look.dx += dx; this.look.dy += dy; }
      }
      this.handlers.pointerMove.forEach(f => f(this.pointer, e));
    });
    const end = e => {
      const d = drags.get(e.pointerId);
      drags.delete(e.pointerId);
      this.pointer.down = drags.size > 0;
      this.handlers.pointerUp.forEach(f => f(this.pointer, e));
      // a quick still tap is still a tap (walk to it)
      if (d && d.travel < 8 && performance.now() - d.t < 450) this.handlers.click.forEach(f => f(this.pointer, e));
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", () => { this.pointer.inside = false; });
    canvas.addEventListener("wheel", e => { e.preventDefault(); this.zoom += Math.sign(e.deltaY); }, { passive: false });

    // touch stick: grab the fixed ring (bottom-left). A small dead zone stops a resting thumb from creeping; pushing to
    // the rim runs. The finger keeps steering after it slides off the ring (pointer capture).
    if (stickEl) {
      const knob = stickEl.firstElementChild;
      let id = null, cx = 0, cy = 0;
      const DEAD = 0.14;
      let R = 30;
      const start = e => {
        if (id !== null) return false;
        id = e.pointerId;
        const r = stickEl.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
        R = r.width * 0.34;   // the knob (45 % of the ring) travels to a cap overhanging the rim by a hair
        stickEl.classList.add("live");
        this.stick.active = true; move(e);
        return true;
      };
      const move = e => {
        if (e.pointerId !== id) return;
        let x = e.clientX - cx, y = e.clientY - cy;
        const l = Math.hypot(x, y); if (l > R) { x *= R / l; y *= R / l; }
        knob.style.transform = `translate(${x}px, ${y}px)`;
        const m = Math.min(1, l / R), k = m < DEAD ? 0 : (m - DEAD) / (1 - DEAD) / Math.max(m, 1e-6);
        this.stick.x = (x / R) * k; this.stick.y = (y / R) * k;
        this.stick.run = l >= R * 0.97;
      };
      const end = e => {
        if (e.pointerId !== id) return;
        id = null; this.stick.active = false; this.stick.run = false; this.stick.x = this.stick.y = 0; knob.style.transform = "";
        stickEl.classList.remove("live");
      };
      stickEl.addEventListener("pointerdown", e => { e.preventDefault(); if (start(e)) capture(stickEl, e.pointerId); });
      stickEl.addEventListener("pointermove", move);
      stickEl.addEventListener("pointerup", end);
      stickEl.addEventListener("pointercancel", end);
    }
  }

  /* Gamepad: call once per frame. Connect / disconnect are found by comparing the pad list (works for browsers that
     fire gamepadconnected late and for test stubs), so each fires exactly once. */
  pollPads(dt = 1 / 60) {
    if (!navigator.getGamepads) return;
    let list = [];
    try { list = Array.from(navigator.getGamepads() || []); } catch (e) { return; }
    const live = list.filter(p => p && p.connected && p.mapping === "standard");
    const seen = new Set(live.map(p => p.index));
    for (const p of live) if (!this.pads.has(p.index)) { this.pads.set(p.index, p.id); this.onPad && this.onPad("connect", p.id); }
    for (const [i, id] of [...this.pads]) if (!seen.has(i)) { this.pads.delete(i); this.onPad && this.onPad("disconnect", id); }
    const P = this.pad; P.vx = P.vy = P.mag = 0; P.active = false;
    const want = new Set();
    let lookX = 0, lookY = 0, best = 0;
    for (const p of live) {
      const ax = p.axes || [], bt = p.buttons || [];
      for (const [b, k] of PAD_KEYS) if (bt[b] && (bt[b].pressed || bt[b].value > 0.5)) want.add(k);
      const lx = ax[0] || 0, ly = ax[1] || 0, raw = Math.hypot(lx, ly);
      if (raw > best) {
        best = raw;
        if (raw > PAD_DEAD) {
          const t = Math.min(1, raw);
          // walk band 0.15..0.50 ramps 0.25 -> 1.0 of walking speed; the run band 0.50..0.90 starts at the same speed
          // (run flag on, magnitude 5.0/7.75) and ends at 7.75, so crossing 0.5 never jumps
          let mag, run = this.pad.run ? t > PAD_WALK_TOP - 0.05 : t > PAD_WALK_TOP;
          if (!run) mag = 0.25 + 0.75 * Math.min(1, (t - PAD_DEAD) / (PAD_WALK_TOP - PAD_DEAD));
          else mag = WALK_OVER_RUN + (1 - WALK_OVER_RUN) * Math.min(1, Math.max(0, (t - PAD_WALK_TOP) / (PAD_RUN_FULL - PAD_WALK_TOP)));
          P.vx = (lx / raw) * mag; P.vy = (ly / raw) * mag; P.mag = mag; P.run = run; P.active = true;
        } else P.run = false;
      }
      const rx = ax[2] || 0, ry = ax[3] || 0, rr = Math.hypot(rx, ry);
      if (rr > PAD_DEAD) {
        const k = Math.min(1, (rr - PAD_DEAD) / (1 - PAD_DEAD)), s = k * k / rr;   // eased: small tilts nudge, full tilt sweeps
        lookX += rx * s; lookY += ry * s;
      }
    }
    if (!P.active) P.run = false;
    if (this.lookEnabled && (lookX || lookY)) { this.look.dx += lookX * PAD_LOOK_PX * dt; this.look.dy += lookY * PAD_LOOK_PX * dt; }
    // buttons become real key events (edge-triggered); never into a text field
    const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest("input, textarea");
    if (typing) want.clear();
    for (const k of want) if (!this.padKeys.has(k)) this.padKey("keydown", k);
    for (const k of [...this.padKeys]) if (!want.has(k)) this.padKey("keyup", k);
    this.padKeys = want;
  }

  padKey(type, key) {
    dispatchEvent(new KeyboardEvent(type, { key, code: key === " " ? "Space" : key.length > 1 ? key : "Key" + key.toUpperCase(), bubbles: true, cancelable: true }));
  }

  setPointer(e, canvas) {
    const r = canvas.getBoundingClientRect();
    this.pointer.x = e.clientX; this.pointer.y = e.clientY;
    this.pointer.nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.ny = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  on(type, fn) { this.handlers[type].push(fn); }
  /* a virtual key press through the same handlers as the keyboard (the touch interact button = E) */
  press(k) { this.handlers.key.forEach(f => f(k, { preventDefault() {} })); }

  /* Movement intent in camera space: x = strafe right, y = forward. */
  axes() {
    const k = this.keys;
    let x = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
    let y = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0);
    if (this.stick.active) { x += this.stick.x; y -= this.stick.y; }
    if (this.pad.active) { x += this.pad.vx; y -= this.pad.vy; }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    if (l > 0.05) this.moved = true;
    return { x, y, run: k.has("shift") || (this.stick.active && this.stick.run) || (this.pad.active && this.pad.run) };
  }

  consumeLook() { const l = { ...this.look }; this.look.dx = this.look.dy = 0; return l; }
  consumeZoom() { const z = this.zoom; this.zoom = 0; return z; }
}
