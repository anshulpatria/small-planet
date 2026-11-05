/* R7 T4: gamepad aim for the pointer-only mini-games (Pin Art, Gravity Pong).
   input.js turns the pad into KeyboardEvents (A = Space, B/X = E, Start = Escape, D-pad = arrows), which no mini-game
   reads, so these games read the same standard pad themselves, only while they are focused. Nothing here is drawn until a
   pad is actually used in the game; a mouse or touch move puts the reticle away again. No effect without a pad. */

const DEAD = 0.18;

function firstPad() {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return null;
  let list = [];
  try { list = Array.from(navigator.getGamepads() || []); } catch (e) { return null; }
  return list.find(p => p && p.connected && p.mapping === "standard") || null;
}

export function padConnected() { return !!firstPad(); }

export class PadInput {
  constructor() { this.x = 0; this.y = 0; this.mag = 0; this.held = []; this.prev = []; this.edge = []; this.on = false; }
  /* call once per frame; x right +, y down + (screen sense); held[i] / edge[i] (pressed this frame) by standard button index */
  poll() {
    const p = firstPad(), bt = p ? p.buttons : [], ax = p ? p.axes : [];
    this.prev = this.held; this.held = []; this.edge = [];
    for (let i = 0; i < 17; i++) {
      const h = !!(bt[i] && (bt[i].pressed || bt[i].value > 0.5));
      this.held[i] = h; this.edge[i] = h && !this.prev[i];
    }
    let x = ax[0] || 0, y = ax[1] || 0;
    const raw = Math.hypot(x, y);
    if (raw < DEAD) { x = y = 0; } else { const k = Math.min(1, (raw - DEAD) / (1 - DEAD)) / raw; x *= k; y *= k; }
    // the D-pad steers too (digital, full tilt)
    if (this.held[14]) x -= 1; if (this.held[15]) x += 1; if (this.held[12]) y -= 1; if (this.held[13]) y += 1;
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    this.x = x; this.y = y; this.mag = Math.min(1, l);
    this.on = !!p;
    return p;
  }
}

/* a small cursor in the cursor's own colours (cream face, navy outline, lavender side), shown only for a pad */
export class PadReticle {
  constructor() { this.el = null; this.shown = false; this.mouse = () => this.hide(); }
  build() {
    if (this.el || typeof document === "undefined" || !document.body || !document.body.appendChild) return;
    const el = document.createElement("div");
    if (!el.style) return;
    el.setAttribute && el.setAttribute("aria-hidden", "true");
    el.style.cssText = "position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:#FFF6E6;border:3px solid #181894;box-shadow:0 3px 0 #B7A9F0;pointer-events:none;z-index:14;opacity:0;transition:opacity .15s;will-change:transform";
    document.body.appendChild(el); this.el = el;
    if (typeof window !== "undefined") window.addEventListener("pointermove", this.mouse);
  }
  /* ndc in -1..1; down = the button is held (the face fills in) */
  show(nx, ny, down) {
    this.build(); if (!this.el) return;
    const x = (nx + 1) / 2 * innerWidth, y = (1 - ny) / 2 * innerHeight;
    this.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${down ? 0.8 : 1})`;
    this.el.style.background = down ? "#B7A9F0" : "#FFF6E6";
    if (!this.shown) { this.shown = true; this.el.style.opacity = "1"; }
  }
  hide() { if (this.el && this.shown) { this.shown = false; this.el.style.opacity = "0"; } }
  dispose() { this.hide(); if (typeof window !== "undefined") window.removeEventListener("pointermove", this.mouse); if (this.el && this.el.remove) this.el.remove(); this.el = null; }
}
