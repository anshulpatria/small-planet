/* Keyboard, mouse-drag look, wheel zoom, a fixed touch stick + interact button, a gamepad, and taps/clicks.
   A drag never counts as a click; a short still press does.

   Touch (I2): the stick is a fixed ring in the bottom-left corner and the interact button (= E) sits bottom-right
   (index.html / styles.css, --ctl-size); every other finger on the scene orbits the camera through the drag path below,
   and a quick still tap there is the old tap-to-go (main.js click handler); there is no touch jump gesture, so stick,
   centre drag and tap all work at once (each finger is its own pointerId). Enter = E on desktop (main.js key handler).

   Gamepad (I1 + R7 B4, standard mapping, polled once a frame from main's motionFrame via pollPads; the list view polls too):
     left stick   walk (radial dead zone 0.15; to 0.50 = walk 5.0 m/s, 0.50 to 0.90 = run blend, 0.90+ = run 7.75 m/s)
     right stick  camera yaw / pitch (same sign as a drag)
     A  (bottom face)  confirm: the intro's Enter button, or the focused button in any open overlay; out in the world it is
                       interact (E) while a prompt is up, else jump (Space)
     B  (right face)   back / close = Escape (main.js and ui.js close whatever is on top, including any .r7-modal)
     X, Y              jump (Space)
     LB, RB            step into / out of the Collector's dock (D-pad moves along the coins, A goes there)
     Start             the menu (opens it; Start again closes it)
     Back / Create     the map (M)
     D-pad, left stick when ANY overlay is open (intro, menu, panel, map, list, booth, film, finale, .r7-modal):
                       move keyboard focus between the visible buttons (spatial), A clicks the focused one. The focus look is
                       the existing html.kbd style (a thicker ink edge); nothing is added to .btn-cel.
     D-pad (nothing open) = the arrow keys (walk)
   The held D-pad arrows and the single-shot taps (E, Space, Escape, M) are real KeyboardEvents on window, so the keyboard
   listeners (this one, ui.js's Escape and Say hi handlers, a seated Blip's "any key") see a pad exactly as they see the
   keyboard. Confirm and focus moves are done directly on the DOM (el.click / el.focus), the way a Tab + Enter would. In a
   focused mini-game (body.focus) A and the D-pad are left to the game (games/padcursor.js reads the pad itself); only B
   (leave), Start, and the focus-bar buttons (stepped into with LB / RB) are handled here. */


const PAD_DEAD = 0.15, PAD_WALK_TOP = 0.5, PAD_RUN_FULL = 0.9, PAD_LOOK_PX = 400;   // look rate at full tilt = 400 px/s of drag
const PAD_ARROWS = [[12, "ArrowUp"], [13, "ArrowDown"], [14, "ArrowLeft"], [15, "ArrowRight"]];   // held while nothing is open (walk)
const NAV_DIR = { 12: [0, -1], 13: [0, 1], 14: [-1, 0], 15: [1, 0] };
const NAV_DELAY = 380, NAV_EVERY = 130, NAV_STICK = 0.6;   // ms before the first repeat / between repeats; stick tilt that counts as a press
const FOCUSABLE = "button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])";
const OVERLAYS = [   // topmost first: [selector of the open overlay root, selector of its pad targets (default FOCUSABLE)]
  ".r7-modal", "#finale.open", "#menu:not([hidden])", "#video.open", "#booth.open", "#panel.open", "#map.open", "#list.open", "#intro:not(.gone)"];
function shown(el, dock) {   // a real, on-screen, clickable-looking element (a faded dock coin still counts: focusing it wakes the dock)
  if (!el || el.disabled || el.hidden || el.getAttribute("aria-hidden") === "true") return false;
  if (!el.getClientRects().length) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none" && cs.pointerEvents !== "none" || (dock && cs.visibility !== "hidden");
}
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
    this.padBtns = new Set(); // pad buttons held last poll (edge detection for the action layer)
    this.nav = { key: null, t0: 0, last: 0 };   // D-pad / stick focus-move repeat
    this.dockNav = false;     // LB / RB stepped into the dock
    this.usingPad = false;    // the last thing the player touched was a pad (a real key or pointer clears it)
    this.ovSeen = null;       // the overlay root we last auto-focused into

    addEventListener("keydown", e => {
      if (e.isTrusted) this.usingPad = false;
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
    addEventListener("pointerdown", () => { this.usingPad = false; }, true);

    // touch jump (R7 B2): an extra round button next to the interact one = Space through the same handlers as the keyboard.
    // It is its own pointer target, so it works while the stick is held and after any drag.
    const jump = document.getElementById("jumpBtn");
    if (jump) jump.addEventListener("pointerdown", e => { e.preventDefault(); this.press(" "); });

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
    const held = new Set();
    let lookX = 0, lookY = 0, best = 0;
    for (const p of live) {
      const ax = p.axes || [], bt = p.buttons || [];
      for (let b = 0; b < bt.length; b++) if (bt[b] && (bt[b].pressed || bt[b].value > 0.5)) held.add(b);
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
    // buttons: edge-triggered actions; the D-pad is also the arrow keys (walk) while nothing is open
    const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest("input, textarea");
    if (typing) held.clear();
    const prev = this.padBtns; this.padBtns = held;
    const edges = [...held].filter(b => !prev.has(b));
    const root = this.overlay(), navMode = !!root || this.dockNav;
    if (root !== this.ovSeen) { this.ovSeen = root; if (root && this.usingPad) this.focusFirst(root); }
    if (this.dockNav && (root || document.body.classList.contains("focus"))) this.dockNav = false;
    // left stick steers the focus too while something is open (and does not walk Blip away behind it)
    let stickDir = null;
    if (root && P.active) { stickDir = Math.abs(P.vx) > Math.abs(P.vy) ? (P.vx > 0 ? 15 : 14) : (P.vy > 0 ? 13 : 12); if (Math.hypot(P.vx, P.vy) < NAV_STICK) stickDir = null; }
    if (root) { P.vx = P.vy = P.mag = 0; P.active = false; P.run = false; }
    for (const b of edges) this.padAction(b, root);
    // focus-move repeat: D-pad (or the stick) held in a direction
    const dirBtn = navMode ? [12, 13, 14, 15].find(b => held.has(b)) : undefined, dir = dirBtn !== undefined ? dirBtn : stickDir;
    if (navMode && dir != null) {
      const now = performance.now();
      if (this.nav.key !== dir) { this.nav.key = dir; this.nav.t0 = this.nav.last = now; this.navMove(NAV_DIR[dir], root); }
      else if (now - this.nav.t0 > NAV_DELAY && now - this.nav.last > NAV_EVERY) { this.nav.last = now; this.navMove(NAV_DIR[dir], root); }
    } else this.nav.key = null;
    const want = new Set();
    if (!navMode) for (const [b, k] of PAD_ARROWS) if (held.has(b)) want.add(k);
    for (const k of want) if (!this.padKeys.has(k)) this.padKey("keydown", k);
    for (const k of [...this.padKeys]) if (!want.has(k)) this.padKey("keyup", k);
    this.padKeys = want;
  }

  /* the topmost open overlay root (or null); order = OVERLAYS */
  overlay() {
    // (the hint bubble is NOT an overlay here: a game opens it by itself and it can stay up after you leave, which swallowed A at the
    // next game's prompt. B / Escape still closes it through ui.js.)
    for (const sel of OVERLAYS) {
      const els = document.querySelectorAll(sel);
      for (let i = els.length - 1; i >= 0; i--) {
        const el = els[i];
        if (sel !== ".r7-modal" || (!el.hidden && el.getAttribute("aria-hidden") !== "true" && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden")) return el;
      }
    }
    return null;
  }
  targets(root) {
    const dock = root.id === "dock";
    return [...root.querySelectorAll(FOCUSABLE)].filter(el => shown(el, dock) && el.tabIndex >= 0 && !el.closest("[inert]"));
  }
  focusFirst(root) {
    const t = this.targets(root); if (!t.length) return;
    const skip = el => el.matches(".panel-close, [aria-label^='Close' i], #listBack");
    this.focusEl(t.find(el => !skip(el)) || t[0]);
  }
  focusEl(el) {
    document.documentElement.classList.add("kbd");   // the existing keyboard-focus look (index.html clears it on the next pointerdown)
    try { el.focus({ preventScroll: false, focusVisible: true }); } catch (e) { el.focus(); }
  }
  /* spatial focus move: the nearest visible target in the pressed direction, with a penalty for drifting off-axis */
  navMove(d, root) {
    root = root || (this.dockNav ? document.getElementById("dock") : null); if (!root) return;
    this.usingPad = true;
    const t = this.targets(root), cur = document.activeElement && root.contains(document.activeElement) && t.includes(document.activeElement) ? document.activeElement : null;
    if (!cur) { this.focusFirst(root); return; }
    const c = cur.getBoundingClientRect(), cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    let best = null, bs = Infinity;
    for (const el of t) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect(), dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy;
      const along = dx * d[0] + dy * d[1], across = Math.abs(dx * d[1] - dy * d[0]);
      if (along < 2) continue;
      const sc = along + across * 2.2;
      if (sc < bs) { bs = sc; best = el; }
    }
    if (best) this.focusEl(best);
  }
  /* what each pad button does on its press */
  padAction(b, root) {
    this.usingPad = true;
    const body = document.body, inGame = body.classList.contains("focus"), cl = document.documentElement.classList;
    const active = document.activeElement, tap = k => { this.padKey("keydown", k); this.padKey("keyup", k); };
    const confirm = scope => {
      const t = this.targets(scope);
      if (active && scope.contains(active) && t.includes(active)) { cl.add("kbd"); active.click(); return true; }
      if (scope.id === "intro") { const e = document.getElementById("enter"); if (e && !e.disabled) { e.click(); return true; } }
      this.focusFirst(scope); return true;
    };
    switch (b) {
      case 0:   // A
        if (root) return confirm(root);
        if (this.dockNav) return confirm(document.getElementById("dock"));
        if (inGame) { const bar = document.getElementById("focusbar"); if (bar && active && bar.contains(active)) { cl.add("kbd"); active.click(); } return; }   // the game reads A itself
        if (body.classList.contains("is-loading")) return;
        { const pr = document.getElementById("prompt"); tap(pr && !pr.hidden ? "e" : " "); }
        return;
      case 1:   // B
        if (this.dockNav) { this.dockNav = false; if (active && active.blur) active.blur(); return; }
        if (inGame) { const bar = document.getElementById("focusbar"); if (bar && active && bar.contains(active) && !root) { active.blur(); return; } }
        tap("Escape"); return;
      case 2: case 3:   // X, Y: jump
        if (!root && !inGame) tap(" "); return;
      case 4: case 5: {   // LB, RB: the dock (or the game's focus bar)
        if (root) return;
        if (inGame) {
          const bar = document.getElementById("focusbar"), t = bar ? this.targets(bar) : [];
          if (bar && active && bar.contains(active)) { active.blur(); return; }
          if (t.length) this.focusEl(t[0]);
          return;
        }
        if (body.classList.contains("is-loading")) return;
        const dock = document.getElementById("dock");
        if (this.dockNav) { this.dockNav = false; if (active && active.blur) active.blur(); return; }
        const t = this.targets(dock); if (!t.length) return;
        this.dockNav = true; this.focusEl(t.find(el => el.classList.contains("here")) || t[0]); return;
      }
      case 8: if (!root && !inGame) tap("m"); return;   // Back: the map
      case 9: {   // Start: the menu
        if (body.classList.contains("is-loading") || document.getElementById("intro") && !document.getElementById("intro").classList.contains("gone")) return;
        this.dockNav = false;
        const menu = document.getElementById("menu"), mb = document.getElementById("menuBtn");
        if (menu && menu.hidden && mb) mb.click(); else tap("Escape");
        return;
      }
    }
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
