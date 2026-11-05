import * as THREE from "three";
import { outline } from "./toon.js";
import { fontsReady } from "./signs.js";

/* Creature dialogue as an in-world slate.
   A thin cream cuboid (toon shaded, ink outlined) that floats above the speaker, yaw-billboarded to
   the camera about the planet's local up and sized to its text. The words sit on a transparent
   CanvasTexture plane laid just proud of the front face: the speaker's name in Bricolage Grotesque,
   the line in Instrument Sans, <b> in bold. A visually hidden aria-live copy carries the same text.
   Only one slate exists at a time; a new one replaces the old. */

export const SLATE = {
  PPM: 180,            // canvas pixels per world metre (text is ~58 px tall: sharp at DPR 1-2 with mips)
  FONT_M: 0.28,        // body font size in metres (about 15 css px at 1280x800, camera 18.2 m)
  NAME_M: 0.26,
  LINE_K: 1.34,        // line height / font size
  PAD_X: 0.3, PAD_Y: 0.24, NAME_GAP: 0.08,
  MAX_W: 4.4, MAX_W_PORTRAIT: 3.8,   // text column width limit (m); portrait phones get a narrower, bigger slate
  MIN_W: 1.5, DEPTH: 0.2,
  POP_IN: 0.3, POP_OUT: 0.22,
  AWAY_M: 16,          // hide when the player is further than this from the speaker
  HOME_DIST: 18.2,     // camera distance the sizes above are tuned for
  LIFT: 0.35,          // gap between the speaker's head and the slate's bottom edge (m)
  BOB_M: 0.05, BOB_HZ: 0.45,   // a slow float, so it reads as a thing in the world, not a pasted label
};
// flat (unlit) colours: the sunset light would tint a lit slate peach. Front cream, the edges a shade darker so it reads as a cuboid.
const CREAM = "#EFEBE1", CREAM_EDGE = "#C9C3B4", CREAM_BACK = "#DDD8CB", INK_TEXT = "#2A2A33";
const BODY_FONT = (px, bold) => `${bold ? 700 : 500} ${px}px "Instrument Sans", system-ui, sans-serif`;
const NAME_FONT = px => `700 ${px}px "Bricolage Grotesque", "Instrument Sans", system-ui, sans-serif`;

/* ---------------------------------------------------------------- pure text layout (smoke-tested) */
/* "<b>Gulp</b> · Mmmf" -> [{t:"Gulp", b:true}, {t:" · Mmmf", b:false}]; other tags are dropped */
export function parseRuns(html) {
  const out = []; let bold = false;
  const ent = s => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  for (const part of String(html).split(/(<\/?[a-z][^>]*>)/i)) {
    if (!part) continue;
    const tag = /^<(\/?)([a-z0-9]+)/i.exec(part);
    if (tag && part.startsWith("<")) { if (/^(b|strong)$/i.test(tag[2])) bold = !tag[1]; continue; }
    const t = ent(part); if (t) out.push({ t, b: bold });
  }
  return out;
}
export const plainText = runs => runs.map(r => r.t).join("");

/* greedy word wrap of styled runs; measure(text, bold) -> width in the same unit as maxW.
   Returns lines of [{t, b, w}]; a single over-long word keeps its own line (never split). */
export function wrapRuns(runs, maxW, measure) {
  const words = [];
  for (const r of runs) for (const m of r.t.matchAll(/\S+\s*|\s+/g)) words.push({ t: m[0], b: r.b });
  const lines = []; let cur = [], w = 0;
  const trimEnd = l => { if (l.length) { const last = l[l.length - 1]; last.t = last.t.replace(/\s+$/, ""); last.w = measure(last.t, last.b); } };
  for (const wd of words) {
    const ww = measure(wd.t, wd.b), bare = measure(wd.t.replace(/\s+$/, ""), wd.b);
    if (cur.length && w + bare > maxW) { trimEnd(cur); lines.push(cur); cur = []; w = 0; if (!wd.t.trim()) continue; }
    cur.push({ t: wd.t, b: wd.b, w: ww }); w += ww;
  }
  if (cur.length) { trimEnd(cur); lines.push(cur); }
  return lines.length ? lines : [[]];
}
/* slate size in metres from its wrapped lines: width follows the longest line (or the name), height
   follows the line count, both with padding */
export function slateSize(lines, nameW, measureLine = l => l.reduce((a, s) => a + s.w, 0)) {
  const S = SLATE;
  const textW = Math.max(nameW || 0, ...lines.map(measureLine));
  const w = Math.max(S.MIN_W, textW + 2 * S.PAD_X);
  const h = 2 * S.PAD_Y + (nameW ? S.NAME_M * S.LINE_K + S.NAME_GAP : 0) + lines.length * S.FONT_M * S.LINE_K;
  return { w, h, textW };
}

/* ---------------------------------------------------------------- the 3D object */
const easeOutBack = x => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const easeInCubic = x => x * x * x;
const _v = new THREE.Vector3(), _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _m = new THREE.Matrix4();

export class Slate {
  constructor(scene, camera) {
    this.scene = scene; this.camera = camera;
    this.group = new THREE.Group(); this.group.visible = false; this.group.name = "dialogue_slate";
    this.body = new THREE.Group(); this.group.add(this.body);   // scaled for the pop; hull rides inside
    scene.add(this.group);
    this.cur = null; this.phase = "idle"; this.t = 0; this.k = 1; this.token = 0; this.lastFwd = new THREE.Vector3(0, 0, 1);
    this.ctx = document.createElement("canvas").getContext("2d");
    // visually hidden live region: the same words for screen readers
    const el = document.createElement("div");
    el.id = "slate-live"; el.setAttribute("aria-live", "polite"); el.setAttribute("role", "status");
    el.style.cssText = "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0";
    document.body.appendChild(el); this.live = el;
    this.fontsOk = false;
    // R7 skip: E / Enter / pad A (a real KeyboardEvent from input.js) / click / tap while a creature line types completes it and stops the
    // babble; a second press closes it. Captured on window so the press is not also an interact or a walk-there.
    const eat = e => { if (this.skip()) { e.stopImmediatePropagation(); e.preventDefault(); } };
    const on = typeof addEventListener === "function" ? addEventListener : () => {};   // the node smoke test has no window
    on("keydown", e => { if ((e.key === "e" || e.key === "E" || e.key === "Enter") && !e.repeat) eat(e); }, true);
    on("pointerdown", e => { if (!(e.target && e.target.closest && e.target.closest("#dock,#menu,button"))) eat(e); }, true);
    this.fonts = Promise.all([fontsReady, document.fonts.load(BODY_FONT(32, false)), document.fonts.load(BODY_FONT(32, true)), document.fonts.load(NAME_FONT(32))].map(p => Promise.resolve(p).catch(() => {}))).then(() => { this.fontsOk = true; });
  }
  /* R7: the next say() whose plain text equals `text` types out (blank until startReveal) */
  armTyping(text) { this.armed = String(text == null ? "" : text).replace(/<\/?[a-z][^>]*>/gi, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
  /* R7: plan.reveal = [{t, n}] on the clock now() (seconds), t0 = when the babble's chunk time 0 sounds. Every entry shows n chars the
     moment its chunk sounds (same schedule as the audio, no second clock). stop(tail) silences the babble (skip). */
  startReveal(plan, t0, now, stop) {
    const c = this.cur; if (!c || !c.typed || c.rev || plan.len !== c.body.length) return false;
    c.rev = { sched: plan.reveal, t0, now, stop, i: 0, log: [] };
    c.until = Math.max(c.until, plan.dur + 0.1 + 1.8);   // hold: the typing, then a reading beat, then it closes as before
    return true;
  }
  /* skip: while typing, show the whole line now and stop the babble with a short tail; true if it consumed the press */
  skip() {
    const c = this.cur; if (!c || this.phase === "idle" || this.phase === "out") return false;
    if (c.typed && c.shown < c.body.length) {
      c.shown = c.body.length; c.draw(c.shown); c.tex.needsUpdate = true; c.skipped = true;
      if (c.rev && c.rev.stop) c.rev.stop(0.12);
      c.rev = null; this.live.textContent = c.text; c.until = Math.max(c.until, this.t + 1.8);
      return true;
    }
    if (c.skipped) { c.skipped = false; this.hide(); return true; }
    return false;
  }
  get active() { return this.phase !== "idle"; }
  get text() { return this.cur ? this.cur.text : ""; }

  /* opts: { name, html, ms, base: () => Vector3 (speaker's feet), up: () => Vector3, top: metres above base (or an Object3D to measure), stay: keep showing when the player is far } */
  async say(opts) {
    const token = ++this.token;
    if (!this.fontsOk) await this.fonts;
    if (token !== this.token) return;   // a newer line arrived while the fonts were loading
    const S = SLATE, portrait = innerWidth > 0 && innerWidth / Math.max(1, innerHeight) < 0.8;
    const runs = parseRuns(opts.html), text = (opts.name ? opts.name + ". " : "") + plainText(runs);
    const ppm = S.PPM, ctx = this.ctx;
    const mFont = S.FONT_M * ppm, nFont = S.NAME_M * ppm;
    const measure = (t, b) => { ctx.font = BODY_FONT(mFont, b); return ctx.measureText(t).width / ppm; };
    const lines = wrapRuns(runs, portrait ? S.MAX_W_PORTRAIT : S.MAX_W, measure);
    let nameW = 0; if (opts.name) { ctx.font = NAME_FONT(nFont); nameW = ctx.measureText(opts.name).width / ppm; }
    const { w, h } = slateSize(lines, nameW);
    this._clear();
    // canvas: transparent, text only (the cream is the cuboid itself)
    const cv = document.createElement("canvas"); cv.width = Math.ceil(w * ppm); cv.height = Math.ceil(h * ppm);
    const g = cv.getContext("2d"); g.textBaseline = "alphabetic"; g.fillStyle = INK_TEXT;
    // R7 reveal: the canvas can be redrawn showing only the first n chars of the body (the layout is always the full line's)
    const body = plainText(runs); let pos = 0;
    for (const ln of lines) for (const sg of ln) { const ix = body.indexOf(sg.t, pos); sg.start = ix < 0 ? pos : ix; pos = sg.start + sg.t.length; }
    const draw = (n) => {
      if (g.clearRect) g.clearRect(0, 0, cv.width, cv.height); g.fillStyle = INK_TEXT;
      let y = S.PAD_Y * ppm;
      if (opts.name) { g.font = NAME_FONT(nFont); y += nFont * 0.98; g.fillText(opts.name, S.PAD_X * ppm, y); y += (S.NAME_GAP * ppm) + nFont * (S.LINE_K - 0.98); }
      for (const ln of lines) {
        y += mFont * 1.0; let x = S.PAD_X * ppm;
        for (const s of ln) {
          const part = n >= s.start + s.t.length ? s.t : n > s.start ? s.t.slice(0, n - s.start) : "";
          if (part) { g.font = BODY_FONT(mFont, s.b); g.fillText(part, x, y); }
          x += s.w * ppm;
        }
        y += mFont * (S.LINE_K - 1.0);
      }
    };
    const typed = !!this.armed && this.armed === body; this.armed = null;
    draw(typed ? 0 : Infinity);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.needsUpdate = true;
    // box faces: +x, -x, +y, -y, +z (front), -z (back); depth-tested like the rest of the world and casting a real shadow
    const flat = c => new THREE.MeshBasicMaterial({ color: c, toneMapped: false, fog: false });
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, S.DEPTH), [flat(CREAM_EDGE), flat(CREAM_EDGE), flat(CREAM_EDGE), flat(CREAM_EDGE), flat(CREAM), flat(CREAM_BACK)]);
    box.castShadow = true;
    box.name = "slate_box";
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    face.position.z = S.DEPTH / 2 + 0.006; face.renderOrder = 1; face.name = "slate_text"; face.raycast = () => {};
    box.raycast = () => {};
    this.body.add(box, face);
    this.hulls = outline(this.body, "#1E1F26", o => o === box, { fade: false });   // hull is added beside the box, identity transform
    let top = opts.top;
    if (top && top.isObject3D) top = SlateTop(top, opts.base(), opts.up());
    this.cur = { ...opts, text, body, draw, typed, shown: typed ? 0 : body.length, typedAt: this.cur0 = performance.now(), rev: null, skipped: false, w, h, top: top ?? 2.2, box, face, tex, until: (opts.ms ?? 2600) / 1000, held: 0 };
    this.live.textContent = text;
    this.phase = "in"; this.t = 0; this.group.visible = true; this.body.scale.setScalar(0.001);
    this.k = this.k || 1;
    return this.cur;
  }

  /* pop out now (the player walked off, or a caller wants it gone) */
  hide(instant = false) {
    this.token++;
    if (!this.cur) return;
    if (instant) { this._clear(); this.phase = "idle"; this.group.visible = false; this.cur = null; return; }
    if (this.phase !== "out") { this.phase = "out"; this.t = 0; this.outFrom = this.body.scale.x; }
  }
  _clear() {
    for (const h of this.hulls || []) h.removeFromParent();   // the shared ink material stays
    this.hulls = [];
    if (this.cur) {
      for (const m of [this.cur.box, this.cur.face]) { m.removeFromParent(); m.geometry.dispose(); [].concat(m.material).forEach(x => x.dispose()); }
      this.cur.tex.dispose();
    }
  }

  /* per frame, after the camera has moved */
  update(dt, playerPos) {
    const c = this.cur; if (!c || this.phase === "idle") return;
    const S = SLATE, cam = this.camera;
    if (c.typed && c.shown < c.body.length) {
      const R = c.rev;
      if (R) {
        const tt = R.now() - R.t0; let n = c.shown;
        while (R.i < R.sched.length && R.sched[R.i].t <= tt) { n = Math.max(n, R.sched[R.i].n); R.log.push({ n: R.sched[R.i].n, planned: +R.sched[R.i].t.toFixed(3), shown: +tt.toFixed(3) }); R.i++; }
        if (n !== c.shown) { c.shown = Math.min(n, c.body.length); c.draw(c.shown); c.tex.needsUpdate = true; }
      } else if (performance.now() - c.typedAt > 3500) { c.shown = c.body.length; c.draw(c.shown); c.tex.needsUpdate = true; }   // no voice came: never leave a slate blank
    }
    this.t += dt;
    if (this.phase === "hold" && c.typed && c.shown < c.body.length && this.t >= c.until) c.until = this.t + 0.5;   // never close mid-typing
    if (this.phase === "in") { const x = Math.min(1, this.t / S.POP_IN); this.pop = easeOutBack(x); if (x >= 1) { this.phase = "hold"; this.t = 0; this.pop = 1; } }
    else if (this.phase === "hold") {
      this.pop = 1;
      if (this.t >= c.until) this.hide();
      else if (!c.stay && playerPos && playerPos.distanceTo(c.base()) > S.AWAY_M) this.hide();
    } else if (this.phase === "out") {
      const x = Math.min(1, this.t / S.POP_OUT); this.pop = this.outFrom * (1 - easeInCubic(x));
      if (x >= 1) { this.hide(true); return; }
    }
    const base = c.base(), up = c.up();
    // size: constant on screen across camera distances (a little), a bit bigger on a portrait phone
    const aspect = innerWidth / Math.max(1, innerHeight);
    const dist = cam.position.distanceTo(base);
    const want = THREE.MathUtils.clamp(dist / S.HOME_DIST, 0.7, 1.8) * (aspect < 0.8 ? 1.35 : aspect < 1.1 ? 1.15 : 1);
    this.k = this.k ? THREE.MathUtils.damp(this.k, want, 8, dt) : want;
    const s = this.k;
    // billboard about the speaker's up: z toward the camera (planar), y = up
    _v.copy(cam.position).sub(base); _v.addScaledVector(up, -_v.dot(up));
    if (_v.lengthSq() > 1e-4) this.lastFwd.copy(_v.normalize()); else _v.copy(this.lastFwd);
    _fwd.copy(this.lastFwd); _right.crossVectors(up, _fwd).normalize();
    _m.makeBasis(_right, up, _fwd); this.group.quaternion.setFromRotationMatrix(_m);
    this.bobT = (this.bobT || 0) + dt;
    const bob = Math.sin(this.bobT * Math.PI * 2 * S.BOB_HZ) * S.BOB_M;
    this.group.position.copy(base).addScaledVector(up, c.top + S.LIFT + (c.h * s) / 2 + bob).addScaledVector(_fwd, 0.5);
    this.body.scale.setScalar(Math.max(0.001, this.pop * s));
  }
}

/* height of an object's top above `base` along `up`, from its bounding box (clamped to something sane) */
function SlateTop(obj, base, up) {
  const bb = new THREE.Box3().setFromObject(obj); if (bb.isEmpty()) return 2.2;
  let m = 0;
  for (let i = 0; i < 8; i++) { _v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).sub(base); m = Math.max(m, _v.dot(up)); }
  return THREE.MathUtils.clamp(m, 1.2, 5);
}
