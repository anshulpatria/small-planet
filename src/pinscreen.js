import * as THREE from "three";

/* The Pin Art Sanctuary's pinscreen, built to behave like the real product
   (https://anshulpatria.github.io/3D-pin-art/, a single index.html, three.js):

   - Each pin has one depth in 0..1. A picture sets every depth at once (the product's Image
     mode); the brush only ever ADDS depth (the product's Sculpt mode): strength
     (0.12 + pressure * 0.28) * 0.5 per pointer event, linear falloff 1 - d / r over a
     3-pin radius, clamped at 1. Nothing relaxes, springs back or ripples: what you push
     stays pushed until you pick a picture again or undo.
   - Pin z = base + depth * push. Colour comes from the depth along each pin
     (depthT = depth * (0.55 + 0.45 * along), along = 0 at the pin's root, 1 at its tip),
     so pushed pins show white tips over lilac shafts on a navy field, as in the product.
   - In the world the pins ease to their target (no overshoot) so a picture change reads as
     the pins sliding, not a cut. Once every pin has arrived the update sleeps.

   One InstancedMesh ("pinart-pins") of the PinUnit from shared-assets.glb; how far a pin
   slides out is a per-instance float (aOffset) read in the vertex shader (and the shadow
   pass), so a moving frame costs one small buffer upload. From further away a relief
   surface ("pinart-relief") stands in for the pins (they would only shimmer). */

const BASE = 0.09;     // m a pin stands out at depth 0 (product: baseLen 0.6 pin gaps, 0.15 m gap)
const PUSH = 0.9;      // m a pin slides out at depth 1 (product: maxPush 6 gaps x depthScale 1)
const PIN_LEN = 1.068; // PinUnit length along z (root z = 0, tip z = PIN_LEN)
const HI = 4;          // the relief's detail textures are HI x the pin grid
const BRUSH_PINS = 3;  // product default brush radius, in pins
const EASE = 10;       // 1/s, how fast a pin slides to its target
const UNDO = 16;
const HEAD = 0.8;      // pin head diameter / pin pitch (PinUnit is 0.1294 m across)
/* Source filter ("contrast"): hatched fills read as solid raised masses, as in the
   product shot. The picture is drawn at INK_S px per pin, its ink (1 - lum) dilated by INK_DIL px and
   box-blurred by INK_BLUR px, averaged per pin, then levels INK_LO..INK_HI with a smoothstep. */
const INK_S = 4, INK_DIL = 1, INK_BLUR = 2, INK_LO = 0.2, INK_HI = 0.6;
/* the cowboy cat drawing (assets/pin-art-cowboy-cat.png, 920 x 590): crop to the ink plus a margin and fit
   to 94 % of the board height, so the cat spans more pins */
const CAT_CROP = [257, 59, 424, 492];
/* The frame. The product has no bezel; ours (PIN_frame) is a rounded tube whose inner wall stands
   at x 7.02 / y 4.52 m up to 1.1 m in front of the pin roots, then rolls over to the front face.
   A tip is only BASE + PIN_LEN = 1.16 m out at depth 0 but 2.06 m at depth 1, so from the focus
   camera (13.7 m from that wall, 1.77 m above the middle) an outer pin pushed far slides over the
   lip in perspective. The outer three rings therefore slide at most this far (fraction of PUSH),
   per ring = (margin * 13.67 / offset from the lens axis - 0.058) / 0.9, rounded down: bottom and
   sides are tight, the top (nearer the lens axis) only its outer ring. Depth itself, the brush and
   undo are untouched, only how far those pins slide. */
const EDGE_CAP = { bottom: [0.18, 0.54, 0.86], side: [0.18, 0.54, 0.86], top: [0.5] };

export class Pinscreen {
  constructor(anchor, pinGeometry, { spacing, lowPower }) {
    const ud = anchor.userData;
    this.spacing = spacing || ud.spacing || 0.15;
    this.cols = Math.floor(ud.w / this.spacing);
    this.rows = Math.floor(ud.h / this.spacing);
    const n = this.n = this.cols * this.rows;
    this.origin = anchor.getWorldPosition(new THREE.Vector3());
    this.w = this.cols * this.spacing; this.h = this.rows * this.spacing;

    const geo = pinGeometry.clone();
    // thin pins (head 0.8 of the pitch) so every head stands apart with a dark gap round it, as in
    // the product, instead of the heads touching into one smooth skin
    geo.scale(HEAD * this.spacing / 0.1294, HEAD * this.spacing / 0.1294, 1);
    this.offsets = new Float32Array(n).fill(BASE);
    geo.setAttribute("aOffset", new THREE.InstancedBufferAttribute(this.offsets, 1).setUsage(THREE.DynamicDrawUsage));
    this.uTime = { value: 0 };
    this.uPixAng = { value: 0.0006 };   // radians per screen pixel (set from the camera each frame)

    // satin, not chrome: a tight specular dot on each 7 cm head jumps between pixels as the
    // camera moves and the whole screen glitters
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.0, roughness: 0.7 });
    mat.onBeforeCompile = sh => {
      sh.uniforms.uPixAng = this.uPixAng;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aOffset;\nvarying float vDepth;\nvarying float vAlong;\nvarying float vFar;\nuniform float uPixAng;")
        // distance-aware detail: once pins are only a few pixels apart they shimmer. Swell them so
        // neighbours close the gaps, and (in the fragment) flatten their lighting.
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          vec4 pinW = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float pinPx = ${this.spacing.toFixed(3)} / (distance(pinW.xyz, cameraPosition) * uPixAng);
          // only once a pin is under ~5 px (far beyond the walk-up) do the heads swell and flatten
          vFar = 1.0 - smoothstep(2.5, 5.0, pinPx);
          vAlong = clamp(transformed.z / ${PIN_LEN.toFixed(3)}, 0.0, 1.0);
          transformed.xy *= 1.0 + vFar * 0.2;
          transformed.z += aOffset;
          vDepth = clamp((aOffset - ${BASE.toFixed(3)}) / ${PUSH.toFixed(3)}, 0.0, 1.0);`);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vDepth;\nvarying float vAlong;\nvarying float vFar;\n" + RAMP)
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
          normal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz), vFar * 0.85));`)
        .replace("#include <color_fragment>", `#include <color_fragment>
          // the product's per-pin colour: depth scaled along the pin, so tips are lightest
          diffuseColor.rgb = pinRamp(clamp(vDepth * (0.55 + 0.45 * mix(vAlong, 1.0, vFar)), 0.0, 1.0));
          // the shaft just under the rounded head sits in its neighbours' shade: a dark ring round
          // every head, so each pin reads on its own
          diffuseColor.rgb *= mix(mix(0.5, 1.0, smoothstep(0.80, 0.965, vAlong)), 1.0, vFar);`);
    };
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aOffset;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed.z += aOffset;");
    };

    const mesh = this.mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.customDepthMaterial = depth;
    mesh.castShadow = !lowPower;
    mesh.receiveShadow = true;
    mesh.name = "pinart-pins";
    const m = new THREE.Matrix4();
    for (let j = 0; j < this.rows; j++) for (let i = 0; i < this.cols; i++) {
      m.makeTranslation(this.origin.x - this.w / 2 + (i + 0.5) * this.spacing, this.origin.y + this.h / 2 - (j + 0.5) * this.spacing, this.origin.z);
      mesh.setMatrixAt(j * this.cols + i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false; // offsets move pins outside the static bounds
    mesh.computeBoundingSphere();
    this.buildRelief(lowPower);

    this.depth = new Float32Array(n);      // 0..1 per pin: the product's depthData
    this.cap = new Float32Array(n).fill(1); // how far each pin may slide (EDGE_CAP on the outer rings)
    const ring = (list, e) => e < list.length ? list[e] : 1;
    for (let j = 0; j < this.rows; j++) for (let i = 0; i < this.cols; i++)
      this.cap[j * this.cols + i] = Math.min(ring(EDGE_CAP.top, j), ring(EDGE_CAP.bottom, this.rows - 1 - j),
        ring(EDGE_CAP.side, i), ring(EDGE_CAP.side, this.cols - 1 - i));
    this.patterns = {}; this.patternsHi = {};
    this.detail = 0;
    this.awake = true;
    this.work = 0;                          // total depth the brush has added (for the discovery)
    this.undoBuf = []; this.undoTop = 0; this.undoLen = 0;
    this.hover = null;
    this.last = null; this.wasDown = false;
    this._hit = new THREE.Vector3();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(this.origin.z + 1.2));
    this.active = false;
  }

  /* The product's Image mode, line for line: the picture is drawn into a cols x rows canvas
     (browser smoothing, no blur), luminance = 0.299 R + 0.587 G + 0.114 B, depth = 1 - lum
     (dark pushes out; Invert off), depth = depth ^ (1 / contrast) with contrast 1, clamped.
     Each picture is sampled once per pin (what the pins take) and once at HI x that (the relief
     LOD adds the fine part back so edges stay clean curves from across the plateau). */
  async preparePatterns() {
    const C = this.cols, R = this.rows;
    const both = (name, draw) => {
      this.patterns[name] = imageDepth(C, R, ctx => draw(ctx, C, R, 1));
      this.patternsHi[name] = imageDepth(C * HI, R * HI, ctx => draw(ctx, C * HI, R * HI, HI));
    };
    // The cowboy cat: the original drawing uploaded to Pin Art 3D, fitted to the
    // board; the product's mapping turns its ink into pushed pins (assets/pin-art-cowboy-cat.SOURCE.txt).
    const img = await loadImage("assets/pin-art-cowboy-cat.png").catch(() => null);
    if (img) {
      const [sx, sy, sw, sh] = CAT_CROP;
      const fill = (ctx, W, H) => { const h = H * 0.94, w = sw * h / sh; ctx.drawImage(img, sx, sy, sw, sh, (W - w) / 2, (H - h) / 2, w, h); };
      const [lo, hi] = inkDepth(C, R, fill);
      this.patterns.cat = lo; this.patternsHi.cat = hi;
    }
    await document.fonts.ready.catch(() => {});
    both("monogram", (ctx, W, H, s) => {
      ctx.filter = `blur(${0.6 * s}px)`;
      ctx.fillStyle = "#000";
      ctx.font = `800 ${Math.round(H * 0.82)}px "Bricolage Grotesque", sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("AP", W / 2, H * 0.54);
    });
    this.patterns.flat = new Float32Array(C * R); this.patternsHi.flat = new Float32Array(C * R * HI * HI);
  }

  /* Reset (the product's Reset button): the current picture again, hand pushes discarded. */
  reset() { this.setPattern(this.patternName || "flat"); }   // one undo step, like a picture change

  /* the product's Image mode: the picture replaces every depth (hand pushes are discarded) */
  setPattern(name) {
    const p = this.patterns[name];
    if (!p) return;
    if (this.patternName) this.pushUndo();
    this.depth.set(p);
    this.patternName = name;
    upload(this.patHiTex, this.patternsHi[name], this.cols * HI, this.rows * HI);
    upload(this.patLoTex, p, this.cols, this.rows);
    this.detail = 0;
    this.awake = true;
  }

  /* undo: a ring of depth snapshots, taken at the start of each stroke and picture change */
  pushUndo() {
    if (this.undoBuf.length < UNDO) this.undoBuf.push(new Float32Array(this.n));
    this.undoBuf[this.undoTop].set(this.depth);
    this.undoTop = (this.undoTop + 1) % UNDO;
    this.undoLen = Math.min(UNDO, this.undoLen + 1);
  }
  undo() {
    if (!this.undoLen) return false;
    this.undoTop = (this.undoTop - 1 + UNDO) % UNDO; this.undoLen--;
    this.depth.set(this.undoBuf[this.undoTop]);
    this.awake = true;
    return true;
  }
  get canUndo() { return this.undoLen > 0; }

  /* tell the shader how big a pixel is, and pick the level of detail: individual pins up close
     (or while playing), a smooth relief surface from further away */
  setView(camera, heightPx) {
    this.uPixAng.value = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, heightPx);
    const px = this.spacing / (this.origin.distanceTo(camera.position) * this.uPixAng.value);
    // the pins themselves at the walk-up and beyond (the relief reads as an embossed drawing);
    // the relief only stands in once a pin is under ~2.5 px
    const near = this.active || (this.mesh.visible ? px > 2.2 : px > 2.8);   // hysteresis
    if (near !== this.mesh.visible && !near) this.syncRelief();
    this.mesh.visible = near;
    this.relief.visible = !near;
  }

  /* LOD: a cols x rows grid displaced by the same offsets (a float texture), coloured with the
     pins' ramp at their tips, normals from the height field. */
  buildRelief(lowPower) {
    const C = this.cols, R = this.rows;
    this.reliefData = new Float32Array(C * R).fill(BASE);
    const tex = this.reliefTex = new THREE.DataTexture(this.reliefData, C, R, THREE.RedFormat, THREE.FloatType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    const geo = new THREE.PlaneGeometry(this.w - this.spacing, this.h - this.spacing, C - 1, R - 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0 });
    const red = (w, h) => {
      const t = new THREE.DataTexture(new Float32Array(w * h), w, h, THREE.RedFormat, THREE.FloatType);
      t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
    };
    this.patHiTex = red(C * HI, R * HI);
    this.patLoTex = red(C, R);
    this.uDetail = { value: 0 };
    const U = { uOff: { value: tex }, uTexel: { value: new THREE.Vector2(1 / C, 1 / R) }, uGrid: { value: new THREE.Vector2(C, R) },
      uCell: { value: new THREE.Vector2(this.spacing, this.spacing) }, uPatHi: { value: this.patHiTex },
      uPatLo: { value: this.patLoTex }, uHiTexel: { value: new THREE.Vector2(1 / (C * HI), 1 / (R * HI)) }, uDetail: this.uDetail };
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      // vertices sit on pin centres: vertex i of C samples texel centre (i + 0.5) / C
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform sampler2D uOff; uniform vec2 uTexel, uCell, uGrid; varying float vH; varying vec2 vUvR;")
        .replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>
          vec2 uvP = (uv * (uGrid - 1.0) + 0.5) / uGrid;
          float hL = texture2D(uOff, uvP - vec2(uTexel.x, 0.0)).r, hR = texture2D(uOff, uvP + vec2(uTexel.x, 0.0)).r;
          float hD = texture2D(uOff, uvP - vec2(0.0, uTexel.y)).r, hU = texture2D(uOff, uvP + vec2(0.0, uTexel.y)).r;
          objectNormal = normalize(vec3((hL - hR) / (2.0 * uCell.x), (hD - hU) / (2.0 * uCell.y), 1.0));`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          float h = texture2D(uOff, uvP).r;
          transformed.z += h + ${PIN_LEN.toFixed(3)};
          vH = clamp((h - ${BASE.toFixed(3)}) / ${PUSH.toFixed(3)}, 0.0, 1.0); vUvR = uvP;`);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vH; varying vec2 vUvR; uniform sampler2D uPatHi, uPatLo; uniform vec2 uHiTexel, uGrid, uCell; uniform float uDetail;\n" + RAMP)
        .replace("#include <color_fragment>", `#include <color_fragment>
          // the picture's fine part, as extra depth (hi minus its per-pin version)
          float dHi = (texture2D(uPatHi, vUvR).r - texture2D(uPatLo, vUvR).r) * uDetail;
          vec2 hx = vec2(uHiTexel.x, 0.0), hy = vec2(0.0, uHiTexel.y), lx = hx * ${HI}.0, ly = hy * ${HI}.0;
          vec2 sHi = vec2(texture2D(uPatHi, vUvR + hx).r - texture2D(uPatHi, vUvR - hx).r, texture2D(uPatHi, vUvR + hy).r - texture2D(uPatHi, vUvR - hy).r) * ${HI / 2}.0 / uCell;
          vec2 sLo = vec2(texture2D(uPatLo, vUvR + lx).r - texture2D(uPatLo, vUvR - lx).r, texture2D(uPatLo, vUvR + ly).r - texture2D(uPatLo, vUvR - ly).r) * 0.5 / uCell;
          vec2 detSlope = (sHi - sLo) * ${PUSH.toFixed(3)} * uDetail;
          diffuseColor.rgb = pinRamp(clamp(vH + dHi, 0.0, 1.0));`)
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
          normal = normalize(normal + (viewMatrix * vec4(-detSlope, 0.0, 0.0)).xyz);`);
    };
    const relief = this.relief = new THREE.Mesh(geo, mat);
    relief.position.copy(this.origin);
    relief.receiveShadow = true; relief.castShadow = !lowPower;
    relief.name = "pinart-relief";
    relief.visible = false;
    relief.frustumCulled = false;
  }

  syncRelief() {
    const C = this.cols, R = this.rows, d = this.reliefData, o = this.offsets;
    for (let j = 0; j < R; j++) d.set(o.subarray(j * C, j * C + C), (R - 1 - j) * C);   // texture rows run bottom-up
    this.reliefTex.needsUpdate = true;
  }

  /* Pointer ray (in focus mode). Returns true if it lands on the screen. Pressing starts a
     stroke (one undo step) and stamps the brush; dragging stamps along the path, like the
     product's pointerdown / pointermove. Holding still adds nothing. */
  pointer(ray, pressed, pressure = 0.6) {
    const hit = ray.intersectPlane(this.plane, this._hit);
    const gi = hit ? (hit.x - (this.origin.x - this.w / 2)) / this.spacing - 0.5 : -1;
    const gj = hit ? ((this.origin.y + this.h / 2) - hit.y) / this.spacing - 0.5 : -1;
    const on = !!hit && gi > -1 && gj > -1 && gi < this.cols && gj < this.rows;
    this.hover = on ? { i: gi, j: gj } : null;
    if (!pressed || !on) { this.wasDown = pressed && this.wasDown; if (!pressed) this.last = null; return on; }
    const s = (0.12 + Math.min(1, pressure) * 0.28) * 0.5;
    if (!this.wasDown || !this.last) {
      this.pushUndo();
      this.stamp(gi, gj, s);
      this.last = { i: gi, j: gj };
    } else {
      const di = gi - this.last.i, dj = gj - this.last.j, len = Math.hypot(di, dj);
      if (len > 0.15) {
        // a fast drag is stamped every ~0.6 brush radii so it leaves a line, not dots
        const steps = Math.max(1, Math.ceil(len / (BRUSH_PINS * 0.6)));
        for (let q = 1; q <= steps; q++) this.stamp(this.last.i + di * q / steps, this.last.j + dj * q / steps, s);
        this.last.i = gi; this.last.j = gj;
      }
    }
    this.wasDown = true;
    return true;
  }

  /* the product's brush: linear falloff 1 - d / r, adds depth, clamped at 1 */
  stamp(ci, cj, s, r = BRUSH_PINS) {
    const C = this.cols, d = this.depth;
    for (let j = Math.max(0, Math.ceil(cj - r)); j <= Math.min(this.rows - 1, Math.floor(cj + r)); j++)
      for (let i = Math.max(0, Math.ceil(ci - r)); i <= Math.min(C - 1, Math.floor(ci + r)); i++) {
        const dist = Math.hypot(i - ci, j - cj);
        if (dist >= r) continue;
        const k = j * C + i, nd = Math.min(1, d[k] + s * (1 - dist / r));
        this.work += nd - d[k];
        d[k] = nd;
      }
    this.awake = true;
  }

  update(dt, t, playerDist) {
    this.uTime.value = t;
    if (!this.awake || (!this.active && playerDist > 75)) return;
    dt = Math.min(dt, 1 / 30);
    const n = this.n, o = this.offsets, d = this.depth, cap = this.cap;
    const k = 1 - Math.exp(-dt * EASE);
    let err = 0;
    for (let i = 0; i < n; i++) {
      const e = BASE + (d[i] < cap[i] ? d[i] : cap[i]) * PUSH - o[i];
      o[i] += e * k;
      const a = e < 0 ? -e : e;
      if (a > err) err = a;
    }
    this.mesh.geometry.attributes.aOffset.needsUpdate = true;
    this.detail += (1 - this.detail) * k;
    this.uDetail.value = this.detail;
    if (this.relief.visible) this.syncRelief();
    // every pin has arrived: snap the last fraction of a millimetre and sleep
    if (err < 4e-4 && this.detail > 0.999) {
      for (let i = 0; i < n; i++) o[i] = BASE + Math.min(d[i], cap[i]) * PUSH;
      this.detail = 1; this.uDetail.value = 1;
      this.syncRelief();
      this.awake = false;
    }
  }
}

/* navy field -> lilac shafts -> white tips (Pin Art 3D's look) */
const RAMP = `vec3 pinRamp(float t) {
  vec3 c0 = vec3(0.075, 0.08, 0.52), c1 = vec3(0.30, 0.30, 0.85), c2 = vec3(0.66, 0.60, 1.0), c3 = vec3(0.97, 0.96, 1.0);
  // a wide lilac band (a pushed pin's shaft, t 0.55..0.85, reads lilac) and only
  // the last stretch to the tip goes white, as in the product shot
  vec3 c = mix(c0, c1, smoothstep(0.0, 0.3, t));
  c = mix(c, c2, smoothstep(0.3, 0.62, t));
  return mix(c, c3, smoothstep(0.8, 0.97, t));
}`;

/* a row-major, top-down W x H field into a red float texture (texture rows run bottom-up) */
function upload(tex, src, W, H) {
  if (!tex || !src) return;
  const d = tex.image.data;
  for (let j = 0; j < H; j++) d.set(src.subarray(j * W, j * W + W), (H - 1 - j) * W);
  tex.needsUpdate = true;
}

function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

/* the product's processImage: white canvas, picture drawn at C x R, depth = (1 - lum) ^ (1 / contrast) */
const CONTRAST = 1;   // product default (slider "con")
/* the product's Image mode with its contrast pushed and a small dilate + blur (INK_*): returns the
   per-pin depths and the INK_S x field (the relief's detail texture, HI must equal INK_S) */
function inkDepth(C, R, draw) {
  const S = INK_S, W = C * S, H = R * S;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  draw(ctx, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  let a = new Float32Array(W * H), b = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) a[k] = 1 - (d[k * 4] * 0.299 + d[k * 4 + 1] * 0.587 + d[k * 4 + 2] * 0.114) / 255;
  const pass = (src, dst, r, dx, dy, max) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let acc = max ? 0 : 0, n = 0;
      for (let q = -r; q <= r; q++) {
        const xx = Math.min(W - 1, Math.max(0, x + q * dx)), yy = Math.min(H - 1, Math.max(0, y + q * dy));
        const v = src[yy * W + xx];
        if (max) { if (v > acc) acc = v; } else { acc += v; n++; }
      }
      dst[y * W + x] = max ? acc : acc / n;
    }
  };
  pass(a, b, INK_DIL, 1, 0, true); pass(b, a, INK_DIL, 0, 1, true);
  pass(a, b, INK_BLUR, 1, 0, false); pass(b, a, INK_BLUR, 0, 1, false);
  const lev = v => { const t = Math.max(0, Math.min(1, (v - INK_LO) / (INK_HI - INK_LO))); return t * t * (3 - 2 * t); };
  const lo = new Float32Array(C * R), hi = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) hi[k] = lev(a[k]);
  for (let j = 0; j < R; j++) for (let i = 0; i < C; i++) {
    let s = 0;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) s += a[(j * S + y) * W + i * S + x];
    lo[j * C + i] = lev(s / (S * S));
  }
  return [lo, hi];
}

function imageDepth(C, R, draw) {
  const cv = document.createElement("canvas"); cv.width = C; cv.height = R;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, C, R);
  draw(ctx);
  const d = ctx.getImageData(0, 0, C, R).data;
  const out = new Float32Array(C * R);
  for (let k = 0; k < C * R; k++) {
    const lum = (d[k * 4] * 0.299 + d[k * 4 + 1] * 0.587 + d[k * 4 + 2] * 0.114) / 255;
    out[k] = Math.max(0, Math.min(1, Math.pow(1 - lum, 1 / CONTRAST)));
  }
  return out;
}
