/* Engraver - "Focus the lines".
   Pure logic (angleError, focusAmount, coverRect, darknessGrid, strokeWidth, gridFor) is exported for Node tests. */
import * as THREE from "three";

/* ------------------------------------------------------------------ logic */
const TAU = Math.PI * 2;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
export const TOL = 0.1;        // radians: "close enough" to the target angle
export const RANGE = 2.4;      // radians: beyond this the strokes are fully scrambled
const TURN_RATE = 1.5;  // radians per second at full key or stick turn
const HOLD = 0.4;      // seconds inside TOL before the picture snaps
/* GB1: warmer / colder. The dial has 36 detents (the 36 printed ticks). Each detent it crosses makes one recorded foley knock whose
   pitch, brightness and level rise with closeness = focusAmount(error) (sfx.tick / tickParams); the ring of ticks lights up
   in signal blue by the same closeness; inside tolerance the ring is full and, once the picture snaps, a distinct lock cue plays ONCE. */
const DETENTS = 36;
const DET = TAU / DETENTS;

function wrapPi(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
export function angleError(a, b) { return Math.abs(wrapPi(a - b)); }
export function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
/* 1 = perfectly focused, 0 = scrambled. */
export function focusAmount(err, tol = TOL, range = RANGE) { return 1 - smoothstep(tol, range, err); }

/* Source-rect for drawImage: take the x-range [x0,x1] (fractions of the image), then cover-fit
   an `aspect` (w/h) window inside it, centred at `fx` (0..1 within that range) and `fy`. */
export function coverRect(w, h, x0, x1, aspect, fx = 0.5, fy = 0.5) {
  const rx = w * x0, rw = w * (x1 - x0);
  let sw = rw, sh = rw / aspect;
  if (sh > h) { sh = h; sw = h * aspect; }
  const sx = rx + (rw - sw) * fx, sy = (h - sh) * fy;
  return { sx, sy, sw, sh };
}

/* Box-average an RGBA image into cols x rows darkness values (0..1) with percentile contrast. */
export function darknessGrid(rgba, w, h, cols, rows, out, invert = false, gamma = 1) {
  const n = cols * rows;
  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor((r * h) / rows), y1 = Math.max(y0 + 1, Math.floor(((r + 1) * h) / rows));
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * w) / cols), x1 = Math.max(x0 + 1, Math.floor(((c + 1) * w) / cols));
      let sum = 0, cnt = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const k = (y * w + x) * 4;
        sum += (0.2126 * rgba[k] + 0.7152 * rgba[k + 1] + 0.0722 * rgba[k + 2]) / 255; cnt++;
      }
      const lum = sum / cnt;
      out[r * cols + c] = invert ? lum : 1 - lum;
    }
  }
  // percentile stretch (2%..98%) via histogram
  const bins = new Uint32Array(64);
  for (let i = 0; i < n; i++) bins[Math.min(63, Math.max(0, Math.floor(out[i] * 64)))]++;
  let acc = 0, lo = 0, hi = 1;
  for (let b = 0; b < 64; b++) { acc += bins[b]; if (acc >= n * 0.02) { lo = b / 64; break; } }
  acc = 0;
  for (let b = 63; b >= 0; b--) { acc += bins[b]; if (acc >= n * 0.02) { hi = (b + 1) / 64; break; } }
  if (hi - lo < 0.05) { lo = 0; hi = 1; }
  for (let i = 0; i < n; i++) out[i] = Math.pow(Math.min(1, Math.max(0, (out[i] - lo) / (hi - lo))), gamma);
  return out;
}

/* Stroke width (world units) for a darkness value, given the column pitch. */
export function strokeWidth(d, pitch) { return pitch * (0.05 + 0.95 * d); }

const DENSITY = { fine: { cols: 96, rows: 64 }, bold: { cols: 48, rows: 32 } };
/* The picture frame (world units). Aspect 1.5 so the full cat pinscreen fits. */
export const PIC = { w: 9.0, h: 6.0, cy: 4.3, z: -5 };
export function gridFor(key, low) {
  const g = DENSITY[key] || DENSITY.fine;
  return low ? { cols: Math.round(g.cols / 2), rows: Math.round(g.rows / 2) } : g;
}

/* Procedural stand-in shown until an image has loaded (a soft face-like blob). */
function proceduralDark(cols, rows, out) {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = (c + 0.5) / cols - 0.5, y = (r + 0.5) / rows - 0.5;
    const d = Math.hypot(x * 1.2, y * 2);
    out[r * cols + c] = smoothstep(0.55, 0.2, d) * (0.6 + 0.4 * Math.sin(x * 40));
  }
  return out;
}

/* Scrambled layout for one row of one column: wavy x offset (in pitches) and uniform width fraction.
   Neighbouring rows share a smooth wave so every line stays continuous. */
export function scrambleOffset(c, r, t = 0) {
  return Math.sin(r * 0.28 + c * 0.55 + t * 0.9) * 2.2 + Math.sin(r * 0.11 - c * 0.23) * 1.6;
}
const SCRAMBLE_W = 0.34;

/* --------------------------------------------------------------- geometry */
function rrPath(p, w, h, r) {
  const x = -w / 2, y = -h / 2;
  r = Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001));
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y); p.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  p.lineTo(x + w, y + h - r); p.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  p.lineTo(x + r, y + h); p.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  p.lineTo(x, y + r); p.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return p;
}
function boxXY(w, h, d, r, bt) {
  const sh = rrPath(new THREE.Shape(), w - 2 * bt, h - 2 * bt, r - bt);
  const g = new THREE.ExtrudeGeometry(sh, { depth: d - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bt, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -(d - 2 * bt) / 2);
  return g;
}
function slab(w, d, h, r, bt) {
  const sh = rrPath(new THREE.Shape(), w - 2 * bt, d - 2 * bt, r - bt);
  const g = new THREE.ExtrudeGeometry(sh, { depth: h - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bt, bevelSegments: 3, curveSegments: 10 });
  g.rotateX(-Math.PI / 2); g.translate(0, bt, 0);
  return g;
}
/* Lathe disc with a rounded rim: radius r, height h (y from 0..h). */
function roundDisc(r, h, edge) {
  const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(r - edge, 0)];
  for (let i = 1; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(r - edge + Math.sin(a) * edge, edge - Math.cos(a) * edge)); }
  pts.push(new THREE.Vector2(r, h - edge));
  for (let i = 1; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(r - edge + Math.cos(a) * edge, h - edge + Math.sin(a) * edge)); }
  pts.push(new THREE.Vector2(0, h));
  return new THREE.LatheGeometry(pts, 56);
}

/* ------------------------------------------------------------------ game */
const SOURCES = {
  cat: { label: "Cat", url: "assets/shots/pin-art-3d.jpg", x0: 0.295, x1: 0.79, fx: 0.5, fy: 0.5, invert: true, gamma: 1.0 },
  crew: { label: "Crew", url: "assets/shots/orchestrator.jpg", x0: 0.27, x1: 0.66, fx: 0.5, fy: 0.31, invert: false, gamma: 1.35 },
  mono: { label: "Monogram", mono: true, invert: false, gamma: 1.0 },
};
export { SOURCES };
const IMG_W = 720, IMG_H = 480; // same 3:2 aspect as the picture frame

export default class Engraver {
  static id = "engraver";

  constructor(ctx) {
    this.ctx = ctx;
    const pal = ctx.palette || {};
    this.cols = { paper: pal.paper || "#ECEDE8", ink: pal.ink || "#1B1C20", signal: pal.signal || "#2B2BEE", concrete: pal.concrete || "#C4C5BE" };
    this.geos = []; this.mats = [];
    this.root = new THREE.Group(); ctx.group.add(this.root);
    this.low = !!ctx.lowPower;
    const mat = (o) => { const m = new THREE.MeshStandardMaterial(o); this.mats.push(m); return m; };
    const geo = (g) => { this.geos.push(g); return g; };
    const add = (g, m, parent = this.root, cast = true) => {
      const o = new THREE.Mesh(g, m); o.castShadow = cast && !this.low; o.receiveShadow = true; parent.add(o); return o;
    };
    const ceramic = mat({ color: this.cols.paper, roughness: 0.5 });
    const concrete = mat({ color: this.cols.concrete, roughness: 0.9 });
    const ink = mat({ color: this.cols.ink, roughness: 0.7 });
    const warm = mat({ color: "#EFE7DA", roughness: 0.85 });

    // wall: low plinth + cream board; picture strokes float 3 cm in front of the board face
    const base = add(geo(slab(10.8, 1.4, 0.35, 0.55, 0.07)), concrete);
    base.position.set(0, 0, PIC.z);
    const panel = add(geo(boxXY(10.2, 7.0, 0.35, 0.55, 0.06)), warm);
    panel.position.set(0, PIC.cy, PIC.z);
    this.frontZ = PIC.z + 0.175 + 0.045;

    // strokes: one bar per cell, gap 0 vertically so each column reads as one continuous line
    const g0 = gridFor("fine", this.low);
    this.MAX = g0.cols * g0.rows;
    this.strokeGeo = geo(new THREE.BoxGeometry(1, 1, 0.06));
    this.strokeMat = mat({ color: this.cols.signal, roughness: 0.6 });
    this.strokes = new THREE.InstancedMesh(this.strokeGeo, this.strokeMat, this.MAX);
    this.strokes.frustumCulled = false; this.strokes.receiveShadow = false;
    this.strokes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.add(this.strokes);
    this.dark = new Float32Array(this.MAX);
    this.cache = {}; // `${source}|${density}` -> Float32Array
    this.imgs = {};  // source -> HTMLImageElement | "fail"
    this.canvas = document.createElement("canvas"); this.canvas.width = IMG_W; this.canvas.height = IMG_H;
    this.g2d = this.canvas.getContext("2d", { willReadFrequently: true });

    // dial
    this.buildDial(geo, mat, add, ceramic, concrete, ink);

    // state
    this.source = "cat"; this.density = "fine";
    this.cols_ = g0.cols; this.rows_ = g0.rows;
    this.target = 2.3;              // the secret angle
    this.dialIn = 0; this.dialVis = 0; this.fT = 0; this.f = 0; this.fPrev = -1;
    this.lastDet = null; this.cl = 0; this.pulse = 0; this.litN = -1; this.snapped = false;
    this.hold = 0; this.free = false; this.dragging = false; this.lastPsi = 0;
    this.focused = false; this.dirty = true; this.t = 0;
    this._sig = new THREE.Color(this.cols.signal); this._ink = new THREE.Color(this.cols.ink);
    this._inv = new THREE.Matrix4(); this._ray = new THREE.Ray(); this._hit = new THREE.Vector3();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.17);
    this.disposed = false;
    this.applySource(false);
    for (const k of Object.keys(SOURCES)) this.loadSource(k);
  }

  buildDial(geo, mat, add, ceramic, concrete, ink) {
    const rig = new THREE.Group(); rig.position.set(0, 0, 0.5); this.root.add(rig);
    // trumpet pedestal
    const pts = [];
    for (let i = 0; i <= 14; i++) { const k = i / 14; pts.push(new THREE.Vector2(0.2 + 0.62 * Math.pow(1 - k, 2.2), k * 1.04)); }
    pts.unshift(new THREE.Vector2(0, 0)); pts.push(new THREE.Vector2(0, 1.04));
    add(geo(new THREE.LatheGeometry(pts, 40)), concrete, rig);
    this.tilt = new THREE.Group(); this.tilt.position.set(0, 1.16, 0); this.tilt.rotation.x = 0.45; rig.add(this.tilt);
    add(geo(roundDisc(1.0, 0.1, 0.05)), ink, this.tilt).position.y = -0.1;
    // static tick ring
    const tickGeo = geo(new THREE.CapsuleGeometry(0.018, 0.07, 4, 8));
    this.ticks = new THREE.InstancedMesh(tickGeo, mat({ color: this.cols.paper, roughness: 0.5 }), 36);
    const d = new THREE.Object3D();
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * TAU;
      d.position.set(Math.cos(a) * 0.9, 0.012, -Math.sin(a) * 0.9);
      d.rotation.set(Math.PI / 2, 0, 0); d.rotateOnWorldAxis(Y_AXIS, a + Math.PI / 2);
      d.scale.set(1, i % 9 === 0 ? 1.8 : 1, 1);
      d.updateMatrix(); this.ticks.setMatrixAt(i, d.matrix);
    }
    this._tickD = d.clone(); this._tickBase = [];
    for (let i = 0; i < 36; i++) { this.ticks.getMatrixAt(i, this._tickD.matrix); this._tickBase.push(this._tickD.matrix.clone()); }
    this._cOff = new THREE.Color("#ffffff");
    // lit tick = signal blue once multiplied by the paper material colour
    const pap = new THREE.Color(this.cols.paper);
    this._cOn = new THREE.Color(Math.min(1, this._sigRGB().r / Math.max(0.05, pap.r)), Math.min(1, this._sigRGB().g / Math.max(0.05, pap.g)), Math.min(1, this._sigRGB().b / Math.max(0.05, pap.b)));
    for (let i = 0; i < 36; i++) this.ticks.setColorAt(i, this._cOff);
    this.ticks.castShadow = false; this.tilt.add(this.ticks);
    // knob
    this.knob = new THREE.Group(); this.knob.position.y = 0.01; this.tilt.add(this.knob);
    add(geo(roundDisc(0.74, 0.16, 0.07)), ceramic, this.knob);
    const notch = add(geo(new THREE.CapsuleGeometry(0.06, 0.34, 6, 12)), mat({ color: this.cols.signal, roughness: 0.4 }), this.knob, false);
    notch.rotation.z = Math.PI / 2; notch.position.set(0.5, 0.17, 0);
    const cap = add(geo(roundDisc(0.2, 0.05, 0.02)), concrete, this.knob, false);
    cap.position.y = 0.158;
    // finger dimples: little dark rounded studs around the rim
    const stud = geo(new THREE.SphereGeometry(0.045, 12, 8));
    this.studs = new THREE.InstancedMesh(stud, mat({ color: this.cols.ink, roughness: 0.6 }), 24);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      d.rotation.set(0, 0, 0); d.scale.set(1, 0.5, 1);
      d.position.set(Math.cos(a) * 0.64, 0.158, -Math.sin(a) * 0.64); d.updateMatrix(); this.studs.setMatrixAt(i, d.matrix);
    }
    this.knob.add(this.studs);
  }

  _sigRGB() { return this._sg || (this._sg = new THREE.Color(this.cols.signal)); }
  /* GB1: the sfx engine (main.js does not hand it to games, so read it from the page's hook; ctx.sfx wins if a host adds it) */
  _sfx() { return this.ctx.sfx || (globalThis.__archipelago && globalThis.__archipelago.ui && globalThis.__archipelago.ui.sfx) || null; }
  /* GB1: light `n` of the 36 ticks (growing the lit ones a little), only when the count changes */
  lightTicks(n) {
    if (n === this.litN) return;
    this.litN = n;
    const m = new THREE.Matrix4(), sc = new THREE.Matrix4();
    for (let i = 0; i < DETENTS; i++) {
      const on = i < n;
      this.ticks.setColorAt(i, on ? this._cOn : this._cOff);
      sc.makeScale(1, on ? 1.5 : 1, on ? 1.5 : 1);
      this.ticks.setMatrixAt(i, m.copy(this._tickBase[i]).multiply(sc));
    }
    this.ticks.instanceColor.needsUpdate = true; this.ticks.instanceMatrix.needsUpdate = true;
  }

  /* ------------------------------------------------------- image sources */
  drawMono() {
    const g = this.g2d;
    g.fillStyle = "#fff"; g.fillRect(0, 0, IMG_W, IMG_H);
    g.fillStyle = "#000"; g.textAlign = "center"; g.textBaseline = "alphabetic";
    g.font = '800 400px "Bricolage Grotesque", sans-serif';
    g.fillText("AP", IMG_W / 2, IMG_H / 2 + 140);
  }

  loadSource(key) {
    const s = SOURCES[key];
    if (s.mono) {
      if (document.fonts && document.fonts.load) {
        document.fonts.load('800 100px "Bricolage Grotesque"').then(() => {
          delete this.cache[`mono|fine`]; delete this.cache[`mono|bold`];
          if (!this.disposed && this.source === "mono") { this.applySource(false); }
        }).catch(() => {});
      }
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (this.disposed) return;
      this.imgs[key] = img;
      if (this.source === key) { this.applySource(false); }
    };
    img.onerror = () => { this.imgs[key] = "fail"; };
    img.src = s.url;
  }

  /* Build (or fetch from cache) the darkness grid for the current source + density. */
  gridData() {
    const key = `${this.source}|${this.density}`;
    if (this.cache[key]) return this.cache[key];
    const { cols, rows } = gridFor(this.density, this.low);
    const out = new Float32Array(cols * rows);
    const s = SOURCES[this.source];
    let ok = false;
    try {
      if (s.mono) { this.drawMono(); ok = true; }
      else if (this.imgs[this.source] && this.imgs[this.source] !== "fail") {
        const im = this.imgs[this.source];
        const r = coverRect(im.naturalWidth, im.naturalHeight, s.x0, s.x1, IMG_W / IMG_H, s.fx, s.fy ?? 0.5);
        this.g2d.fillStyle = "#fff"; this.g2d.fillRect(0, 0, IMG_W, IMG_H);
        this.g2d.drawImage(im, r.sx, r.sy, r.sw, r.sh, 0, 0, IMG_W, IMG_H);
        ok = true;
      }
      if (ok) {
        const px = this.g2d.getImageData(0, 0, IMG_W, IMG_H).data;
        darknessGrid(px, IMG_W, IMG_H, cols, rows, out, s.invert, s.gamma || 1);
      }
    } catch (e) { ok = false; }
    if (!ok) { proceduralDark(cols, rows, out); return out; } // not cached: retry when the image arrives
    this.cache[key] = out;
    return out;
  }

  applySource(refocus) {
    this.wrote = false;
    const g = gridFor(this.density, this.low);
    this.cols_ = g.cols; this.rows_ = g.rows;
    this.dark = this.gridData();
    this.strokes.count = g.cols * g.rows;
    if (refocus) this.f = 0;
    this.dirty = true;
  }

  /* ------------------------------------------------------------ UI */
  enter() {
    this.focused = true; this.dirty = true; this.wrote = false;
    this.pushUi();
    this.bindKeys();
    return { pos: new THREE.Vector3(0, 6.2, 10.2), look: new THREE.Vector3(0, 3.0, -3.0) };   // high enough that the dial clears the focus bar
  }
  exit() { this.focused = false; this.dragging = false; this.unbindKeys(); }

  /* R7 B4: keyboard and gamepad. The pad's D-pad arrives as ArrowLeft / ArrowRight / ArrowUp / ArrowDown key events (input.js),
     A as Enter / E, B as Escape (main.js leaves the game). The left stick is read straight from the pad (it sends no key).
     Before the solve: Left / Right (or A / D, or the stick) turn the dial. After it: Left / Right or A pick the picture, Up / Down the density. */
  bindKeys() {
    if (this._kd || typeof addEventListener !== "function") return;   // node tests have no window
    this.turnKeys = { l: false, r: false };
    this._kd = e => this.onKey(e, true); this._ku = e => this.onKey(e, false); this._kb = () => { this.turnKeys.l = this.turnKeys.r = false; };
    addEventListener("keydown", this._kd); addEventListener("keyup", this._ku); addEventListener("blur", this._kb);
  }
  unbindKeys() {
    if (!this._kd) return;
    removeEventListener("keydown", this._kd); removeEventListener("keyup", this._ku); removeEventListener("blur", this._kb);
    this._kd = this._ku = this._kb = null;
  }
  onKey(e, down) {
    if (!this.focused || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && e.target.closest && e.target.closest("input, textarea")) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const left = k === "ArrowLeft" || k === "a", right = k === "ArrowRight" || k === "d";
    if (left) this.turnKeys.l = down; if (right) this.turnKeys.r = down;
    if (!down || e.repeat) return;
    const onButton = document.activeElement && document.activeElement.closest && document.activeElement.closest("button, a");   // a focused tool button handles its own Enter / A
    const keys = Object.keys(SOURCES);
    const step = d => this.setSource(keys[(keys.indexOf(this.source) + d + keys.length) % keys.length]);
    if (this.free) {
      if (left) step(-1); else if (right) step(1);
      else if (k === "ArrowUp") this.setDensity("fine"); else if (k === "ArrowDown") this.setDensity("bold");
      else if ((k === "e" || k === "Enter") && !onButton) step(1);
      else return;
      this.pushUi();
    } else if ((k === "e" || k === "Enter") && !onButton) this.pulse = 1;
  }
  /* the dial's turn this frame, -1..1: held keys, plus the left stick of any standard pad (dead zone 0.15, eased so small tilts are fine) */
  turnInput() {
    let t = (this.turnKeys && this.turnKeys.r ? 1 : 0) - (this.turnKeys && this.turnKeys.l ? 1 : 0);
    try {
      for (const p of Array.from((navigator.getGamepads && navigator.getGamepads()) || [])) {
        if (!p || !p.connected || p.mapping !== "standard") continue;
        const ax = (p.axes && p.axes[0]) || 0, m = Math.abs(ax);
        if (m > 0.15) t += Math.sign(ax) * Math.pow((m - 0.15) / 0.85, 2);
      }
    } catch (err) { /* no pads */ }
    return Math.max(-1, Math.min(1, t));
  }

  pushUi() {
    if (!this.free) {
      this.ctx.ui.status("Turn the dial. There’s a picture hiding in those lines.");
      this.ctx.ui.tools([
        { label: "− Turn", onClick: () => { this.dialIn -= 0.35; } },
        { label: "Turn +", onClick: () => { this.dialIn += 0.35; } },
      ]);
    } else {
      this.ctx.ui.status("Choose a picture. Then decide how many lines is too many.");
      const tools = [];
      for (const k of Object.keys(SOURCES)) tools.push({ label: SOURCES[k].label, group: "src", pressed: this.source === k, onClick: () => this.setSource(k) });
      tools.push({ label: "Fine", group: "den", pressed: this.density === "fine", onClick: () => this.setDensity("fine") });
      tools.push({ label: "Bold", group: "den", pressed: this.density === "bold", onClick: () => this.setDensity("bold") });
      this.ctx.ui.tools(tools);
    }
  }
  setSource(k) { this.source = k; this.applySource(true); }
  setDensity(k) { this.density = k; this.applySource(true); }

  /* ------------------------------------------------------------ pointer */
  dialPsi(e) {
    this.tilt.updateWorldMatrix(true, false);
    this._inv.copy(this.tilt.matrixWorld).invert();
    this._ray.copy(e.ray).applyMatrix4(this._inv);
    const p = this._ray.intersectPlane(this._plane, this._hit);
    if (!p) return null;
    return { psi: Math.atan2(-p.z, p.x), r: Math.hypot(p.x, p.z) };
  }
  pointer(e) {
    if (e.type === "down") {
      const h = this.dialPsi(e);
      if (h && h.r < 1.3) { this.dragging = true; this.lastPsi = h.psi; }
    } else if (e.type === "move" && this.dragging) {
      if (!e.down) { this.dragging = false; return; }
      const h = this.dialPsi(e);
      if (h) { this.dialIn += wrapPi(h.psi - this.lastPsi); this.lastPsi = h.psi; }
    } else if (e.type === "up") this.dragging = false;
  }

  /* ------------------------------------------------------------ update */
  update(dt, t, focused) {
    dt = Math.min(dt, 0.05); this.t = t;
    if (!focused && !this.dirty) return;
    if (focused && !this.free) { const tn = this.turnInput(); if (tn) { this.dialIn += tn * TURN_RATE * dt; this.dirty = true; } }   // R7 B4: keys and the pad stick
    // the dial follows the input smoothly
    this.dialVis += (this.dialIn - this.dialVis) * (1 - Math.exp(-16 * dt));
    this.knob.rotation.y = this.dialVis;
    const err = angleError(this.dialVis, this.target);
    this.fT = focusAmount(err);
    // GB1: one detent tick per 10 degrees crossed, warmer (higher, brighter, louder) the closer to the answer
    const det = Math.floor(this.dialVis / DET);
    if (this.lastDet === null) this.lastDet = det;
    else if (det !== this.lastDet) { this.lastDet = det; if (focused) { const sf = this._sfx(); if (sf && sf.tick) sf.tick(this.fT); } }
    this.cl += (this.fT - this.cl) * (1 - Math.exp(-14 * dt));
    this.lightTicks(this.snapped ? DETENTS : Math.round(Math.min(1, this.cl) * DETENTS));
    this.pulse *= Math.exp(-7 * dt);
    this.knob.scale.setScalar(1 + 0.08 * this.pulse);
    // solve: hold inside tolerance, then snap the dial onto the exact angle
    if (err < TOL) {
      this.hold += dt;
      if (this.hold > HOLD && !this.snapped) {
        this.snapped = true;
        this.pulse = 1; this.lightTicks(DETENTS);   // GB1: the lock cue (a click plus the piano chord), once per lock, and a pop on the knob
        { const sf = this._sfx(); if (sf) { sf.play("shutter"); sf.play("star", { gain: 1.4 }); } }
        this.dialIn = this.dialVis + wrapPi(this.target - this.dialVis);
        if (!this.free) { this.free = true; this.pushUi(); this.ctx.solved(); }
      }
    } else { this.hold = 0; this.snapped = false; }
    this.f += (this.fT - this.f) * (1 - Math.exp(-9 * dt));
    if (this.snapped) this.f += (1 - this.f) * (1 - Math.exp(-12 * dt));
    this.strokeMat.color.lerpColors(this._sig, this._ink, smoothstep(0.05, 0.95, this.f));
    const still = Math.abs(this.fT - this.f) < 0.002;
    const settled = still && (this.f > 0.998 || !focused);
    if (settled && this.wrote) { this.dirty = false; return; }
    this.wrote = settled;
    this.writeStrokes(this.f, t, settled);
    this.dirty = !settled;
  }

  writeStrokes(f, t, settled) {
    const cols = this.cols_, rows = this.rows_, n = cols * rows;
    const px = PIC.w / cols, py = PIC.h / rows;
    const arr = this.strokes.instanceMatrix.array;
    const inv = 1 - f, z = this.frontZ + 0.03, x0 = -PIC.w / 2 + px / 2, yTop = PIC.cy + PIC.h / 2 - py / 2;
    const tt = settled ? 0 : t;
    // columns are laid out at 96-col reference spacing so the wave looks the same in every density
    const cs = 96 / cols, rs = 64 / rows;
    for (let i = 0; i < n; i++) {
      const c = i % cols, r = (i / cols) | 0;
      const wt = strokeWidth(this.dark[i], px), ws = px * SCRAMBLE_W;
      const w = ws + (wt - ws) * f;
      const off = inv * scrambleOffset(c * cs, r * rs, tt) * px;
      const k = i * 16;
      arr[k] = w; arr[k + 1] = 0; arr[k + 2] = 0; arr[k + 3] = 0;
      arr[k + 4] = 0; arr[k + 5] = py * 1.001; arr[k + 6] = 0; arr[k + 7] = 0;
      arr[k + 8] = 0; arr[k + 9] = 0; arr[k + 10] = 1; arr[k + 11] = 0;
      arr[k + 12] = x0 + c * px + off;
      arr[k + 13] = yTop - r * py;
      arr[k + 14] = z; arr[k + 15] = 1;
    }
    this.strokes.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.disposed = true; this.unbindKeys();
    this.ctx.ui.tools([]); this.ctx.ui.status(null);
    this.ctx.group.remove(this.root);
    this.strokes.dispose(); this.ticks.dispose(); this.studs.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.geos.length = this.mats.length = 0;
    this.cache = {}; this.imgs = {}; this.canvas.width = this.canvas.height = 1;
  }
}
