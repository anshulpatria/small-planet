/* Keyboard, mouse-drag look, wheel zoom, a touch joystick, and taps/clicks.
   A drag never counts as a click; a short still press does. */

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

    addEventListener("keydown", e => {
      if (e.target.closest && e.target.closest("input, textarea")) return;
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
      if (!this.keys.has(k)) this.handlers.key.forEach(f => f(k, e));
      this.keys.add(k);
    });
    addEventListener("keyup", e => this.keys.delete(e.key.toLowerCase()));
    addEventListener("blur", () => this.keys.clear());

    // touch: a finger that lands on the left side of the scene becomes the stick (it appears under
    // the thumb, so there is no small target to find); anywhere else it looks around. Main sets
    // `stickZone` to say when walking is possible at all (playing, no mini-game, no map).
    this.stickZone = () => true;
    let floating = null;   // the stick's floating handler, set up below
    const capture = (el, id) => { try { el.setPointerCapture(id); } catch (e) { /* synthetic or ended pointer */ } };
    const drags = new Map();
    canvas.addEventListener("pointerdown", e => {
      capture(canvas, e.pointerId);
      const stick = floating && e.pointerType === "touch" && this.stickZone() && e.clientX < innerWidth * 0.5 && e.clientY > innerHeight * 0.3 && floating.start(e);
      drags.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), travel: 0, stick });
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
        if (d.stick) floating.move(e);
        else if (this.lookEnabled && d.travel > 4) { this.look.dx += dx; this.look.dy += dy; }
      }
      this.handlers.pointerMove.forEach(f => f(this.pointer, e));
    });
    const end = e => {
      const d = drags.get(e.pointerId);
      drags.delete(e.pointerId);
      if (d && d.stick) floating.end(e);
      this.pointer.down = drags.size > 0;
      this.handlers.pointerUp.forEach(f => f(this.pointer, e));
      // a quick still tap is still a tap (walk to it), even where a stick would have started
      if (d && d.travel < 8 && performance.now() - d.t < 450) this.handlers.click.forEach(f => f(this.pointer, e));
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", () => { this.pointer.inside = false; });
    canvas.addEventListener("wheel", e => { e.preventDefault(); this.zoom += Math.sign(e.deltaY); }, { passive: false });

    // touch joystick: grab the ring itself, or put a thumb down anywhere on the left of the scene
    // and the ring jumps there. A small dead zone stops a resting thumb from creeping; pushing to
    // the rim runs.
    if (stickEl) {
      const knob = stickEl.firstElementChild;
      let id = null, cx = 0, cy = 0;
      const R = 48, DEAD = 0.14;
      const start = (e, float) => {
        if (id !== null) return false;
        id = e.pointerId;
        if (float) {
          // centre the ring under the thumb (kept fully on screen)
          const half = stickEl.offsetWidth / 2;
          cx = Math.min(innerWidth - half - 4, Math.max(half + 4, e.clientX));
          cy = Math.min(innerHeight - half - 4, Math.max(half + 4, e.clientY));
          stickEl.style.left = `${cx - half}px`; stickEl.style.top = `${cy - half}px`; stickEl.style.bottom = "auto";
        } else {
          const r = stickEl.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
        }
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
        stickEl.style.left = stickEl.style.top = stickEl.style.bottom = "";   // back to its resting spot
      };
      floating = { start: e => start(e, true), move, end };
      stickEl.addEventListener("pointerdown", e => { if (start(e, false)) capture(stickEl, e.pointerId); });
      stickEl.addEventListener("pointermove", move);
      stickEl.addEventListener("pointerup", end);
      stickEl.addEventListener("pointercancel", end);
    }
  }

  setPointer(e, canvas) {
    const r = canvas.getBoundingClientRect();
    this.pointer.x = e.clientX; this.pointer.y = e.clientY;
    this.pointer.nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.ny = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  on(type, fn) { this.handlers[type].push(fn); }

  /* Movement intent in camera space: x = strafe right, y = forward. */
  axes() {
    const k = this.keys;
    let x = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
    let y = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0);
    if (this.stick.active) { x += this.stick.x; y -= this.stick.y; }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    if (l > 0.05) this.moved = true;
    return { x, y, run: k.has("shift") || (this.stick.active && this.stick.run) };
  }

  consumeLook() { const l = { ...this.look }; this.look.dx = this.look.dy = 0; return l; }
  consumeZoom() { const z = this.zoom; this.zoom = 0; return z; }
}
