import * as THREE from "three";
import { inkShell } from "./toon.js?v=20261108-2229";
import { cleanStars, STARS_VERSION } from "./savestate.js?v=20261108-2229";

/* Things to do on the quieter platforms:
   - FieldFloor: nine of Field's cursor effects set into the Field terrace as a 3 × 3 grid of
     glowing floor tiles. They follow Blip's feet the way the real ones follow the cursor; the tile you stand
     on also plays full-screen, with its name, on the Field kiosk.
   - Vending: a prompt vending machine beside the GenAI After Hours kiosk. Pull the lever and it
     prints a card: a silly prompt and the little site it became.
   - MoonPlay: floaty moon gravity (set in main), three crater trampolines and five fallen stars
     that fly home into a constellation beside the moon. */

const INK = "#1E1F26";
const UP = new THREE.Vector3(0, 1, 0);

const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o });

/* a terrace's frame: centre on its flat top, up, and forward from the visitor's stand to the kiosk */
export function terraceFrame(plateau, stand, kioskBody, centreOfBody) {
  const c = plateau.getWorldPosition(new THREE.Vector3()), n = c.clone().sub(centreOfBody).normalize();
  const f = kioskBody.getWorldPosition(new THREE.Vector3()).sub(stand.getWorldPosition(new THREE.Vector3()));
  f.addScaledVector(n, -f.dot(n)).normalize();
  const x = new THREE.Vector3().crossVectors(f, n);
  // three's object frame: +x right, +y up, -z forward
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, n, f.clone().negate()));
  return { c, n, f, x, q };
}

/* ======================================================================= Field */
/* The nine effects, in tile order: tile k (row-major from the stand-side left corner) plays
   effect k, the kiosk screen plays effect k, and the label/toast name is FIELD_EFFECTS[k].
   The GLSL branch ids below are the same k, so the three can never drift apart; if you add
   or reorder one, change all three together. */
export const FIELD_EFFECTS = ["Ripple", "Halftone", "Flow", "Voronoi", "Spiral", "Magnet", "Contour", "Truchet", "Metaballs"];
/* GB3: the ONE format for every Field string (kiosk label and toast): "Name · n/9". n is the TILE number (row-major, 1-9), not a
   discovered count, so it always matches the tile under Blip. No explanatory sentence anywhere. */
export const fieldText = i => `${FIELD_EFFECTS[i]} · ${i + 1}/${FIELD_EFFECTS.length}`;

/* GLSL: effect(i, uv, f, t) -> colour. uv 0..1 in the tile, f = the "cursor" in the same units. */
const EFFECTS_GLSL = /* glsl */`
  const vec3 cBg = vec3(0.13, 0.11, 0.24), cMint = vec3(0.49, 0.84, 0.70), cCoral = vec3(1.0, 0.48, 0.38),
    cSun = vec3(1.0, 0.78, 0.27), cLilac = vec3(0.73, 0.64, 0.95), cCream = vec3(1.0, 0.96, 0.9);
  float fh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec2 fh2(vec2 p) { return vec2(fh(p), fh(p + 17.3)); }
  float aaStep(float e, float x) { float w = fwidth(x) * 0.8 + 1e-4; return smoothstep(e - w, e + w, x); }
  vec3 effect(int i, vec2 uv, vec2 f, float t) {
    float d = distance(uv, f);
    vec3 c = cBg;
    if (i == 0) {           // Ripple: rings out of the cursor
      float r = fract(d * 5.0 - t * 1.2);
      c = mix(cBg, cMint, aaStep(0.55, r) * (1.0 - aaStep(0.8, r)) * smoothstep(1.4, 0.0, d));
    } else if (i == 1) {    // Halftone: dots swell near the cursor
      vec2 g = uv * 7.0, cell = floor(g) + 0.5;
      float rr = mix(0.08, 0.46, smoothstep(0.9, 0.0, distance(cell / 7.0, f)));
      c = mix(cBg, cSun, 1.0 - aaStep(rr, length(g - cell)));
    } else if (i == 2) {    // Flow: lines bending round the cursor
      vec2 v = uv - f; float k = exp(-dot(v, v) * 9.0);
      float s = sin((uv.y + v.x * k * 0.9 * sign(v.y + 1e-3)) * 40.0 + t * 1.5);
      c = mix(cBg, cLilac, aaStep(0.6, s));
    } else if (i == 3) {    // Voronoi: drifting cells; the cursor is a seed too
      float m1 = 9.0, m2 = 9.0; vec2 best = vec2(0.0);
      for (int k = 0; k < 7; k++) {
        vec2 p = k == 6 ? f : fh2(vec2(float(k), 3.1)) + 0.12 * vec2(sin(t + float(k)), cos(t * 0.8 + float(k)));
        float q = distance(uv, p);
        if (q < m1) { m2 = m1; m1 = q; best = p; } else if (q < m2) m2 = q;
      }
      c = mix(distance(best, f) < 0.01 ? cCoral : cBg * 1.6, cCream, 1.0 - aaStep(0.02, m2 - m1));
    } else if (i == 4) {    // Spiral: wound round the cursor
      vec2 v = uv - f; float a = atan(v.y, v.x) / 6.2832;
      c = mix(cBg, cCoral, aaStep(0.5, fract(a * 3.0 + length(v) * 4.0 - t * 0.6)));
    } else if (i == 5) {    // Magnet: needles all point at the cursor
      vec2 g = uv * 6.0, cell = floor(g) + 0.5, p = g - cell, dir = normalize(f * 6.0 - cell + 1e-4);
      float along = dot(p, dir), across = abs(dot(p, vec2(-dir.y, dir.x)));
      float needle = (1.0 - aaStep(0.06, across)) * (1.0 - aaStep(0.36, abs(along)));
      c = mix(cBg, along > 0.0 ? cCoral : cCream, needle);
    } else if (i == 6) {    // Contour: a map of the hill under the cursor
      float h = exp(-d * d * 6.0) + 0.25 * sin(uv.x * 7.0 + t * 0.3) * sin(uv.y * 6.0);
      float l = fract(h * 9.0);
      c = mix(cBg, cMint, 1.0 - aaStep(0.12, min(l, 1.0 - l) * 2.0));
    } else if (i == 7) {    // Truchet: arcs; tiles flip near the cursor
      vec2 g = uv * 5.0, id = floor(g), p = fract(g);
      bool flip = (fh(id) > 0.5) != (distance((id + 0.5) / 5.0, f) < 0.25);
      if (flip) p.x = 1.0 - p.x;
      float a = abs(length(p) - 0.5), b = abs(length(p - 1.0) - 0.5);
      c = mix(cBg, cSun, 1.0 - aaStep(0.09, min(a, b)));
    } else {                // Metaballs (8): three orbiting blobs and the cursor
      float s = 0.012 / max(1e-4, d * d);
      for (int k = 0; k < 3; k++) { vec2 p = vec2(0.5) + 0.3 * vec2(cos(t * 0.9 + float(k) * 2.1), sin(t * 1.1 + float(k) * 2.1)); float q = distance(uv, p); s += 0.008 / max(1e-4, q * q); }
      c = mix(cBg, cCoral, aaStep(1.0, s)); c = mix(c, cSun, aaStep(2.2, s));
    }
    return c;
  }`;

export class FieldFloor {
  /* frame: from terraceFrame(); screen: the Field kiosk screen mesh (its map is the screenshot);
     plateau: the PLATEAU_field anchor (userData rp, t0: the flat top is a disc of radius rp·tan t0);
     keepOut: the kiosk's COL_ anchor (userData r), which the grid stays clear of.
     The grid is laid out from those, not from fixed metres, so it follows the terrace if the
     Blender side resizes it again. */
  constructor(scene, frame, screen, { plateau, keepOut, N = 3, clear = 0.75, rim = 1.0 } = {}) {
    const V = THREE.Vector3, rp = plateau?.userData.rp ?? 30.35, t0 = plateau?.userData.t0 ?? 0.189;
    const R = rp * Math.tan(t0);                               // flat-top radius, ~5.8 m
    // tiles scale with the terrace (~1 m on the 5.8 m top), held to the 0.95–1.05 m the design asks for
    const tile = THREE.MathUtils.clamp(R * 0.17, 0.95, 1.05), gap = 0.08;
    this.N = N; this.pitch = tile + gap; this.size = N * this.pitch;
    // the kiosk's front: where its collider starts along f (the stand-to-kiosk direction)
    let front = R * 0.1;
    if (keepOut) {
      const kp = keepOut.getWorldPosition(new V()).sub(frame.c);
      front = kp.dot(frame.f) - (keepOut.userData.r ?? 2);
    }
    // far edge `clear` short of the kiosk, but never past the flat top's back rim (minus `rim`)
    let at = front - clear - this.size / 2;
    at = Math.max(at, -(R - rim) + this.size / 2);
    this.layout = { R, tile, gap, pitch: this.pitch, size: this.size, front, at,
      cornerR: Math.hypot(this.size / 2, Math.abs(at) + this.size / 2) };
    this.frame = frame; this.active = -1; this.seen = new Set();
    this.U = { uTime: { value: 0 }, uFeet: { value: new THREE.Vector2(9, 9) }, uOn: { value: 0 }, uActive: { value: -1 },
      uN: { value: N }, uPitch: { value: this.pitch }, uTile: { value: tile } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.U, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      vertexShader: "varying vec2 vP; void main(){ vP = vec2(position.x, -position.z); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `varying vec2 vP; uniform float uTime, uN, uPitch, uTile, uOn, uActive; uniform vec2 uFeet;
        ${EFFECTS_GLSL}
        void main() {
          vec2 g = vP / uPitch + uN * 0.5, id = floor(g);
          if (id.x < 0.0 || id.y < 0.0 || id.x >= uN || id.y >= uN) discard;
          vec2 p = (fract(g) - 0.5) * uPitch;                 // metres from the tile centre
          float hs = uTile * 0.5, r = 0.12;
          vec2 q = abs(p) - (hs - r);
          float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
          if (sd > 0.0) discard;
          // same row-major index as update() uses for tileNow: tile k plays effect k
          int i = int(id.y * uN + id.x + 0.5);
          vec2 uv = p / uTile + 0.5;
          // the cursor: Blip's feet when on the floor, otherwise a lazy orbit of its own per tile
          vec2 idle = vec2(0.5) + 0.32 * vec2(cos(uTime * 0.7 + float(i) * 1.7), sin(uTime * 0.9 + float(i) * 2.3));
          vec2 feet = (uFeet / uPitch + uN * 0.5 - id - 0.5) * uPitch / uTile + 0.5;
          // feet only steer the tile under them and its neighbours: on the far tiles the feet sit
          // well outside the tile, which would leave Ripple blank and Flow/Halftone flat; they idle instead
          float near = 1.0 - smoothstep(0.75, 1.5, length(feet - 0.5));
          vec2 f = mix(idle, feet, uOn * near);
          vec3 c = effect(i, uv, f, uTime);
          bool on = abs(float(i) - uActive) < 0.5;
          if (on) c = c * 1.25 + 0.04;
          // ink rim, thicker (and cream) on the tile you stand on
          float ink = on ? 0.055 : 0.035;
          if (sd > -ink) c = on ? vec3(1.0, 0.96, 0.9) : vec3(0.118, 0.122, 0.149);
          gl_FragColor = vec4(c, 1.0);   // palette values are display colours already: no encode
        }`,
    });
    const g = new THREE.PlaneGeometry(this.size, this.size); g.rotateX(-Math.PI / 2);
    // the plane's local xy is the grid's (x right, y toward the kiosk): rotateX maps y -> -z
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.position.copy(frame.c).addScaledVector(frame.f, at).addScaledVector(frame.n, 0.012);
    this.mesh.quaternion.copy(frame.q);
    this.mesh.renderOrder = 1; this.mesh.raycast = () => {};
    scene.add(this.mesh);
    this.centre = this.mesh.position.clone();

    // the kiosk screen: the screenshot, or the effect you stand on with its name
    this.screen = screen;
    if (screen) {
      this.label = document.createElement("canvas"); this.label.width = 512; this.label.height = 96;
      this.labelTex = new THREE.CanvasTexture(this.label); this.labelTex.colorSpace = THREE.SRGBColorSpace; this.labelTex.flipY = false;
      this.SU = { uShot: { value: screen.material.map }, uLabel: { value: this.labelTex }, uMix: { value: 0 }, uEffect: { value: 0 }, uTime: this.U.uTime };
      screen.material = new THREE.ShaderMaterial({
        uniforms: this.SU, toneMapped: false,
        vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: `varying vec2 vUv; uniform sampler2D uShot, uLabel; uniform float uMix, uEffect, uTime;
          ${EFFECTS_GLSL}
          void main() {
            vec2 rq = abs((vUv - 0.5) * vec2(4.0, 2.4)) - (vec2(2.0, 1.2) - 0.3);   // the frame's inner corner, radius 0.3 m (main.js SCREEN_RADIUS_PX)
            if (length(max(rq, 0.0)) - 0.3 > 0.0) discard;
            vec3 shot = linearToOutputTexel(texture2D(uShot, vUv)).rgb;   // decoded on sampling: back to display colour
            vec2 uv = vec2(vUv.x * 1.667, 1.0 - vUv.y);        // the 5:3 screen, square effect cells
            vec2 f = vec2(0.83, 0.5) + vec2(0.45 * cos(uTime * 0.6), 0.3 * sin(uTime * 0.8));
            vec3 fx = effect(int(uEffect + 0.5), uv, f, uTime);
            vec3 c = mix(shot, fx, uMix);
            vec4 lab = linearToOutputTexel(texture2D(uLabel, vec2(vUv.x, (vUv.y - 0.78) / 0.2)));
            if (vUv.y > 0.78 && vUv.y < 0.98) c = mix(c, lab.rgb, lab.a * uMix);
            gl_FragColor = vec4(c, 1.0);
          }`,
      });
    }
  }
  drawLabel(i) {
    const g = this.label.getContext("2d"), W = this.label.width, H = this.label.height;
    g.clearRect(0, 0, W, H);
    g.font = '700 46px "Bricolage Grotesque", system-ui, sans-serif'; g.textBaseline = "middle";
    const txt = fieldText(i), w = g.measureText(txt).width;
    g.fillStyle = "rgba(255,246,230,0.92)"; g.beginPath(); g.roundRect(18, 12, w + 44, H - 24, 30); g.fill();
    g.fillStyle = INK; g.fillText(txt, 40, H / 2 + 2);
    this.labelTex.needsUpdate = true;
    this.labelText = txt;
  }
  /* Returns { i, name, first } whenever the tile under Blip changes (null otherwise), so the toast
     is re-sent on every change, not only on a tile's first visit: otherwise walking back onto a
     seen tile moves the screen while the toast still names the previous tile for its 2.4 s. */
  update(dt, t, player) {
    this.U.uTime.value = t;
    let tileNow = -1, onFloor = false;
    if (player && !player.flight) {
      const d = player.position.clone().sub(this.centre);
      const lx = d.dot(this.frame.x), ly = d.dot(this.frame.f), h = d.dot(this.frame.n);
      const half = this.size / 2;
      if (Math.abs(lx) < half + 0.6 && Math.abs(ly) < half + 0.6 && Math.abs(h) < 1.5) {
        onFloor = true;
        this.U.uFeet.value.set(lx, ly);
        const ix = Math.floor(lx / this.pitch + this.N / 2), iy = Math.floor(ly / this.pitch + this.N / 2);
        if (ix >= 0 && iy >= 0 && ix < this.N && iy < this.N && Math.abs(lx) < half && Math.abs(ly) < half) tileNow = iy * this.N + ix;
      }
    }
    this.U.uOn.value = THREE.MathUtils.damp(this.U.uOn.value, onFloor ? 1 : 0, 6, dt);
    this.U.uActive.value = tileNow;
    let change = null;
    if (tileNow >= 0 && tileNow !== this.active) {
      this.active = tileNow;
      if (this.screen) { this.SU.uEffect.value = tileNow; this.drawLabel(tileNow); }
      const first = !this.seen.has(tileNow); this.seen.add(tileNow);
      // GB3: `first` stays false (the old "one of Field's 9 effects" sentence is retired); `html` is the toast in the one format
      change = { i: tileNow, name: FIELD_EFFECTS[tileNow], first: false, html: `<b>${FIELD_EFFECTS[tileNow]}</b> · ${tileNow + 1}/${FIELD_EFFECTS.length} on this floor` };
    }
    if (this.screen) this.SU.uMix.value = THREE.MathUtils.damp(this.SU.uMix.value, onFloor && this.active >= 0 ? 1 : 0, 5, dt);
    if (!onFloor) this.active = -1;
    return change;
  }
}

/* ======================================================================= Vending */
const PROMPTS = [
  ["a bakery that only sells croissants", "Flake & Co.", "Flaky by design.", "#FFC845", "#3D1F2B"],
  ["a portfolio for a cat photographer", "Whisker Lens", "Sit. Stay. Judge.", "#B9A2F2", "#1E1E2E"],
  ["a band that only plays in lifts", "Going Up", "Elevator music with ambitions.", "#FF7A62", "#1E1F26"],
  ["a library for lost socks", "Odd Sock Archive", "Your other half is in here somewhere.", "#7ED6B2", "#1B3A5C"],
  ["a weather app for moles", "Underground", "Today: damp. Tomorrow: also damp.", "#C9A0F5", "#2D1B3D"],
  ["a travel agency for the moon", "Lunar Holidays", "Come for the craters. Stay for the bounce.", "#82C4F0", "#1B3A5C"],
  ["a gym for houseplants", "Leaf Day", "No pain. All gain. Some rain.", "#96E6B3", "#2D6B4F"],
  ["a bank run by squirrels", "Acorn Savings", "Your savings are in a very safe hole.", "#FFA070", "#3D1F2B"],
  ["a museum of tiny chairs", "Little Seats", "Look with your eyes. Not your bottom.", "#FFCCE8", "#3D1F2B"],
  ["a cinema that only shows sunsets", "Golden Hour", "Every evening. Weather permitting.", "#FFB98C", "#3A2F6B"],
];
/* drawn in a 480 x 640 layout, scaled up to the canvas's real size */
function drawCard(cv, p, n) {
  const [prompt, title, tag, accent, ink] = p, g = cv.getContext("2d"), W = 480, H = 640, S = cv.width / W;
  g.setTransform(S, 0, 0, S, 0, 0);
  const HEAD = '"Bricolage Grotesque", system-ui, sans-serif', BODY = '"Instrument Sans", system-ui, sans-serif';
  g.fillStyle = "#FFF6E6"; g.fillRect(0, 0, W, H);
  // the prompt
  g.fillStyle = "#6B6478"; g.font = `600 22px ${BODY}`; g.fillText(`PROMPT #${n}`, 36, 52);
  g.fillStyle = INK; g.font = `500 30px ${BODY}`;
  const words = `"${prompt}"`.split(" "); let line = "", y = 96;
  for (const w of words) { if (g.measureText(line + w).width > W - 72) { g.fillText(line, 36, y); line = ""; y += 38; } line += w + " "; }
  g.fillText(line, 36, y);
  // the site it printed: a browser window
  const top = y + 34, bw = W - 72, bh = H - top - 40;
  g.fillStyle = INK; g.beginPath(); g.roundRect(36, top, bw, bh, 22); g.fill();
  g.fillStyle = "#3A3B44"; g.beginPath(); g.roundRect(36, top, bw, 40, [22, 22, 0, 0]); g.fill();
  ["#FF7A62", "#FFC845", "#7ED6B2"].forEach((c, k) => { g.fillStyle = c; g.beginPath(); g.arc(62 + k * 24, top + 20, 7, 0, Math.PI * 2); g.fill(); });
  g.save(); g.beginPath(); g.roundRect(42, top + 40, bw - 12, bh - 46, [0, 0, 18, 18]); g.clip();
  g.fillStyle = accent; g.fillRect(42, top + 40, bw - 12, bh - 46);
  g.fillStyle = ink; g.font = `700 26px ${HEAD}`; g.fillText(title, 64, top + 86);
  const tw = tag.split(" "), wrapN = px => { g.font = `800 ${px}px ${HEAD}`; let n = 1, l = ""; for (const w of tw) { if (g.measureText(l + w).width > bw - 70) { n++; l = ""; } l += w + " "; } return n; };
  const tpx = wrapN(50) > 3 ? 40 : 50, tlh = tpx === 50 ? 54 : 44;
  g.font = `800 ${tpx}px ${HEAD}`;
  let tl = "", ty = top + 150;
  for (const w of tw) { if (g.measureText(tl + w).width > bw - 70) { g.fillText(tl, 64, ty); tl = ""; ty += tlh; } tl += w + " "; }
  g.fillText(tl, 64, ty);
  g.fillStyle = ink; g.beginPath(); g.roundRect(64, ty + 28, 170, 50, 25); g.fill();
  g.fillStyle = accent; g.font = `700 22px ${BODY}`; g.fillText("Get started", 86, ty + 61);
  for (let k = 0; k < 3; k++) { g.globalAlpha = 0.28; g.fillStyle = ink; g.beginPath(); g.roundRect(64 + k * ((bw - 100) / 3), ty + 104, (bw - 130) / 3, 90, 12); g.fill(); }
  g.globalAlpha = 1; g.restore();
}

/* The machine is built from front-profile slabs: a rounded-rect outline in x/y extruded along z,
   so every part already stands upright and nothing needs rotating flat. */
function rrPath(p, x0, y0, x1, y1, r) {
  r = Math.min(r, (x1 - x0) / 2 - 1e-3, (y1 - y0) / 2 - 1e-3);
  p.moveTo(x0 + r, y0); p.lineTo(x1 - r, y0); p.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0);
  p.lineTo(x1, y1 - r); p.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2);
  p.lineTo(x0 + r, y1); p.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI);
  p.lineTo(x0, y0 + r); p.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5);
  return p;
}
/* a slab whose face is the rounded rect [x0,x1] x [y0,y1] (plus optional see-through holes),
   running from z = z0 to z = z0 + depth, soft-bevelled all round */
function profileSlab(x0, y0, x1, y1, r, z0, depth, holes = [], bt = 0.025) {
  const s = rrPath(new THREE.Shape(), x0, y0, x1, y1, r);
  for (const h of holes) s.holes.push(rrPath(new THREE.Path(), ...h));
  const g = new THREE.ExtrudeGeometry(s, { depth: depth - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bt, bevelOffset: -bt, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, z0 + bt);
  return g;
}
/* small canvas textures: the dark cabinet inside the window, the glass glints, the shelf cards */
function canvasTex(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function miniCardTex([, title, , accent, ink]) {
  return canvasTex(64, 88, (g, W, H) => {
    g.fillStyle = "#FFF6E6"; g.fillRect(0, 0, W, H);
    g.fillStyle = accent; g.beginPath(); g.roundRect(5, 5, W - 10, H - 26, 6); g.fill();
    g.fillStyle = ink; g.fillRect(11, 14, 30, 6); g.fillRect(11, 26, 42, 9); g.fillRect(11, 40, 26, 9);
    g.beginPath(); g.roundRect(11, 52, 22, 8, 4); g.fill();
    g.fillStyle = "#6B6478"; g.fillRect(8, H - 14, 34, 5);
    g.fillStyle = INK; g.font = "700 9px system-ui, sans-serif"; g.fillText(title.split(" ")[0].slice(0, 7), 8, H - 17);
  });
}

export class Vending {
  constructor(scene, frame, { x = 2.55, y = -1.0, yaw = -0.45 } = {}) {
    this.group = new THREE.Group();
    this.group.position.copy(frame.c).addScaledVector(frame.x, x).addScaledVector(frame.f, y);
    this.group.quaternion.copy(frame.q).multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));   // front (+z) faces the visitor's side, turned toward the middle
    this.group.scale.setScalar(1.15);
    scene.add(this.group); this.group.updateMatrixWorld(true);
    const G = this.group, add = (geo, mat, px = 0, py = 0, pz = 0, parent = G) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
    const body = std("#7B6CF6"), door = std("#8C7EF8"), cream = std("#FFF6E6"), ink = std(INK, { roughness: 0.8 }), coral = std("#FF7A62"), sun = std("#FFC845"), mint = std("#7ED6B2");
    // Layout, machine-local (front is +z): body x +-0.625, y 0.08..2.2, z -0.425..0.425.
    // The front 0.17 m is a separate "door" slab with real holes for the sign, window and slot,
    // so all three sit recessed in the face; the seam between door and cabinet inks as a door line.
    const X0 = -0.625, X1 = 0.625, Y0 = 0.08, Y1 = 2.2, ZB = -0.425, ZD = 0.255, ZF = 0.425;
    const SIGN = [-0.5, 1.93, 0.5, 2.1, 0.05], WIN = [-0.53, 0.74, 0.2, 1.84, 0.06], SLOT = [-0.42, 0.3, 0.14, 0.46, 0.05];
    this.body = add(profileSlab(X0, Y0, X1, Y1, 0.2, ZB, ZD - ZB + 0.012), body);   // cabinet (just reaches into the door)
    // The holed door gets its own ink hull. Inking the holed slab itself puts hull back faces on the
    // hole walls, whose averaged normals tilt into the holes: dark slivers across the door face. So
    // the door carries a plain white map (main inks only map-less meshes) and this hole-free shell
    // of the same outer size carries the ink, at the same screen-space width as everything else.
    const plain = canvasTex(1, 1, (g) => { g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, 1, 1); });
    door.map = plain;
    add(profileSlab(X0, Y0, X1, Y1, 0.2, ZD, ZF - ZD, [SIGN, WIN, SLOT]), door);
    G.add(inkShell(profileSlab(X0, Y0, X1, Y1, 0.2, ZD, ZF - ZD), INK));
    for (const [fx, fz] of [[-0.45, -0.28], [0.45, -0.28], [-0.45, 0.28], [0.45, 0.28]]) add(new THREE.CylinderGeometry(0.07, 0.09, 0.1, 12), ink, fx, 0.05, fz);
    // recess backs: textured planes just in front of the cabinet front (it reaches ZD + 0.012), inside each hole (textured, so main gives them no ink hull)
    const dark = canvasTex(32, 64, (g, W, H) => { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "#4A3F7A"); gr.addColorStop(1, "#221E36"); g.fillStyle = gr; g.fillRect(0, 0, W, H); });
    const slotDark = canvasTex(8, 8, (g) => { g.fillStyle = "#15161C"; g.fillRect(0, 0, 8, 8); });
    const back = (h, tex) => { const m = add(new THREE.PlaneGeometry(h[2] - h[0], h[3] - h[1]), std("#FFFFFF", { map: tex }), (h[0] + h[2]) / 2, (h[1] + h[3]) / 2, ZD + 0.016); m.castShadow = false; return m; };
    back(WIN, dark); back(SLOT, slotDark);
    // shelves of tiny finished sites behind the glass (all inside the 17 cm recess, hulls included)
    const wx = (WIN[0] + WIN[2]) / 2, ww = WIN[2] - WIN[0];
    this.shelfCards = [];
    for (let r = 0; r < 3; r++) {
      const sy = 0.8 + r * 0.36;
      add(new THREE.BoxGeometry(ww - 0.01, 0.02, 0.09), cream, wx, sy, 0.31);
      for (let k = 0; k < 3; k++) {
        const c = add(new THREE.PlaneGeometry(0.15, 0.2), std("#FFFFFF", { map: miniCardTex(PROMPTS[(r * 3 + k) % PROMPTS.length]) }), wx + (k - 1) * 0.22, sy + 0.01 + 0.1 * Math.cos(0.15), 0.31);
        c.rotation.x = -0.15; c.castShadow = false; this.shelfCards.push(c);   // leaning back on the shelf
      }
    }
    // the glass: 2.5 cm behind the door face, faint glints (a map, so no hull; never casts)
    const glint = canvasTex(64, 128, (g, W, H) => {
      g.fillStyle = "rgba(220,230,255,0.10)"; g.fillRect(0, 0, W, H);
      g.fillStyle = "rgba(255,255,255,0.45)";
      for (const [o, w] of [[10, 9], [30, 4]]) { g.beginPath(); g.moveTo(o, H); g.lineTo(o + w, H); g.lineTo(o + w + 40, 0); g.lineTo(o + 40, 0); g.fill(); }
    });
    const glass = add(new THREE.PlaneGeometry(ww, WIN[3] - WIN[1]), new THREE.MeshBasicMaterial({ map: glint, transparent: true, depthWrite: false, toneMapped: false }), wx, (WIN[1] + WIN[3]) / 2, ZF - 0.025);
    glass.castShadow = glass.receiveShadow = false;
    // the button column: a raised cream plate right of the window, three lights, a keypad, a coin slot
    add(profileSlab(0.27, 0.74, 0.53, 1.84, 0.05, ZF - 0.01, 0.03, [], 0.008), cream);
    // keypad and coin slot are smaller than a 3 cm hull, so they carry the plain map and go un-inked
    // (inked, their hulls would cross over each other into a hash on the cream plate)
    const keyInk = std(INK, { roughness: 0.8, map: plain }), keyCoral = std("#FF7A62", { map: plain });
    // the lights: un-inked caps (a 3 cm hull reads as a heavy crescent over each) sitting in an ink bezel ring
    this.lights = [sun, mint, coral].map((m, k) => {
      const y = 1.7 - k * 0.18, l = m.clone(); l.map = plain;
      add(new THREE.CylinderGeometry(0.068, 0.068, 0.014, 20), keyInk, 0.4, y, ZF + 0.025).rotation.x = Math.PI / 2;
      const b = add(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 20), l, 0.4, y, ZF + 0.035); b.rotation.x = Math.PI / 2; return b;
    });   // meshes: main toonifies their materials
    for (let k = 0; k < 4; k++) add(new THREE.BoxGeometry(0.07, 0.06, 0.03), k % 3 ? keyInk : keyCoral, 0.355 + (k % 2) * 0.09, 1.13 - Math.floor(k / 2) * 0.1, ZF + 0.025);
    add(new THREE.BoxGeometry(0.035, 0.14, 0.02), keyInk, 0.4, 0.86, ZF + 0.02);
    // the header sign, set into its own hole in the door
    const sc = document.createElement("canvas"); sc.width = 512; sc.height = 88; this.signCanvas = sc;
    this.signTex = new THREE.CanvasTexture(sc); this.signTex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(SIGN[2] - SIGN[0], SIGN[3] - SIGN[1]), new THREE.MeshBasicMaterial({ map: this.signTex, toneMapped: false }));
    sign.position.set(0, (SIGN[1] + SIGN[3]) / 2, ZF - 0.02); G.add(sign);
    this.drawSign();
    // the lever on the right side: a fixed boss on the side wall, and a pivot group (hub, arm, knob)
    // hinged on the machine's x axis, so the arm swings fore-aft parallel to the side wall
    const boss = add(new THREE.CylinderGeometry(0.14, 0.14, 0.03, 20), ink, X1 + 0.005, 1.15, 0); boss.rotation.z = Math.PI / 2;
    this.lever = new THREE.Group(); this.lever.position.set(X1, 1.15, 0); G.add(this.lever);
    add(new THREE.CylinderGeometry(0.085, 0.085, 0.13, 16), cream, 0.075, 0, 0, this.lever).rotation.z = Math.PI / 2;
    add(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 10), cream, 0.1, 0.3, 0, this.lever);
    add(new THREE.SphereGeometry(0.1, 18, 12), coral, 0.1, 0.6, 0, this.lever);
    this.leverRest = -0.18;   // leaning back a little, ready to pull forward
    this.lever.rotation.x = this.leverRest;
    this.leverS = { x: 0, v: 0 }; this.shake = 0; this.blink = 0;
    this.slot = { x: (SLOT[0] + SLOT[2]) / 2, y: (SLOT[1] + SLOT[3]) / 2, z0: ZD + 0.155 };
    // the printed card
    this.cardCanvas = document.createElement("canvas"); this.cardCanvas.width = 600; this.cardCanvas.height = 800;
    this.cardTex = new THREE.CanvasTexture(this.cardCanvas); this.cardTex.colorSpace = THREE.SRGBColorSpace; this.cardTex.anisotropy = 8;
    this.card = new THREE.Group(); G.add(this.card); this.card.visible = false;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.8), new THREE.MeshBasicMaterial({ map: this.cardTex, toneMapped: false }));
    face.position.z = 0.008; this.card.add(face);
    const cb = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.84, 0.01), std("#7B6CF6")); this.card.add(cb);
    this.cardT = -1; this.count = 0; this.order = PROMPTS.map((_, i) => i).sort(() => Math.random() - 0.5);
    this.standPos = this.group.localToWorld(new THREE.Vector3(0, 0, 1.55));
    this.collider = { p: this.group.position.clone(), r: 0.85 };
    this.home = this.group.position.clone(); this.side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.group.quaternion);
  }
  drawSign() {
    const g = this.signCanvas.getContext("2d"), W = 512, H = 88;
    g.fillStyle = INK; g.fillRect(0, 0, W, H);
    g.fillStyle = "#FFC845"; g.textAlign = "center"; g.textBaseline = "middle";
    const sign = "IDEA IN → WEBSITE OUT"; let px = 50;
    do { g.font = `800 ${px}px "Bricolage Grotesque", system-ui, sans-serif`; px -= 2; } while (g.measureText(sign).width > W - 40 && px > 24);
    g.fillText(sign, W / 2, H / 2 + 3);
    this.signTex.needsUpdate = true;
  }
  /* pull the lever; returns the toast text */
  pull() {
    this.leverS.v += 9; this.shake = 1; this.blink = 1.6;
    const p = PROMPTS[this.order[this.count % PROMPTS.length]];
    this.count++;
    drawCard(this.cardCanvas, p, this.count); this.cardTex.needsUpdate = true;
    this.cardT = 0; this.card.visible = true;
    this.placeCard(0, 0, null);
    return `Printed: <b>${p[1]}</b>, from "${p[0]}"`;
  }
  /* the card's path, machine-local. It slides out of the slot lying flat (face up) until it is
     clear of the door and buttons (z 0.84), then rises, grows (to 1.62 x, so it reads from the follow lens) and
     turns to the lens while it keeps moving away from the face, so its corners stay in front of the machine at every
     frame. Its lower edge ends 1.6 up the machine (machine-local), above Blip's head at the stand. */
  placeCard(k, t, camera) {
    const s = this.slot, out = THREE.MathUtils.smoothstep(k, 0, 0.7), rise = THREE.MathUtils.smoothstep(k, 0.7, 1.8);
    this.card.position.set(s.x * (1 - rise), s.y + rise * 1.91 + Math.sin(t * 2) * 0.04 * rise, s.z0 + out * 0.46 + rise * 0.55);
    this.card.scale.setScalar(0.3 + 1.32 * rise);
    const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    this.card.quaternion.copy(flat);
    if (camera && rise > 0) {
      const look = camera.position.clone(); this.card.parent.worldToLocal(look);
      const want = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(look, this.card.position, UP));
      this.card.quaternion.slerp(want, rise);
    }
  }
  update(dt, t, camera) {
    // lever: pulled forward, springs back (the pivot group turns; its ink hulls are its children)
    this.leverS.v += (-this.leverS.x * 90 - this.leverS.v * 9) * dt; this.leverS.x += this.leverS.v * dt;
    this.lever.rotation.x = this.leverRest + Math.max(-0.12, Math.min(1.1, this.leverS.x * 0.9));
    this.shake = Math.max(0, this.shake - dt * 2.2);
    // shake the whole machine (its ink hulls ride along)
    this.group.position.copy(this.home).addScaledVector(this.side, Math.sin(t * 40) * 0.025 * this.shake);
    this.blink = Math.max(0, this.blink - dt);
    this.lights.forEach((b, k) => b.material.emissive && b.material.emissive.setScalar(this.blink > 0 && Math.floor(t * 8 + k) % 3 === 0 ? 0.6 : 0));
    // the card: out of the slot, up in front of the machine, turned to the lens; gone after a while
    if (this.cardT >= 0) {
      this.cardT += dt;
      this.placeCard(this.cardT, t, camera);
      if (this.cardT > 12) { this.cardT = -1; this.card.visible = false; }
    }
  }
}

/* ======================================================================= Moon */
function starShape(R, r) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + (i / 10) * Math.PI * 2, q = i % 2 ? r : R; i ? s.lineTo(Math.cos(a) * q, Math.sin(a) * q) : s.moveTo(Math.cos(a) * q, Math.sin(a) * q); }
  return s;
}
const SKY_SCALE = 3.2, FLY = 2.2, HALO = 2.4;
// twinkle: slow (2.6 s), staggered per star, scale and brightness; a hint before completion, full after
const TW_PERIOD = 2.6, TW_AMP = 0.1, TW_AMP0 = 0.03, TW_STAGGER = 2 * Math.PI * 0.37;
const STAR_HOME = new THREE.Color("#FFE27A"), STAR_WARM = new THREE.Color("#FFC23A"), STAR_HOT = new THREE.Color("#FFF4C4");
const LINE_COOL = new THREE.Color("#FFF6E6"), LINE_WARM = new THREE.Color("#FFD978");
const _c = new THREE.Color(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _z = new THREE.Vector3(0, 0, 1), _v = new THREE.Vector3(), _m = new THREE.Matrix4();
// the stars' save stamp sits beside archipelago.v1 (savestate.js cleanStars); storage may be refused (private window),
// and the node smoke test has none
const STARS_KEY = "archipelago.stars";
const hasStore = () => typeof document !== "undefined";
function starsStamp() { try { return hasStore() ? Number(localStorage.getItem(STARS_KEY)) : 0; } catch { return 0; } }
function stampStars() { try { if (hasStore()) localStorage.setItem(STARS_KEY, String(STARS_VERSION)); } catch { /* optional */ } }
function haloTexture() {
  if (typeof document === "undefined") return null;   // (the node smoke test builds MoonPlay headless)
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.35, "rgba(255,255,255,0.55)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
export class MoonPlay {
  /* anchors: world.anchors; moon/planet: bodies; saved: indices of stars already home */
  constructor(scene, anchors, moon, planet, { saved = [], outline } = {}) {
    this.scene = scene; this.moon = moon;
    const wp = o => o.getWorldPosition(new THREE.Vector3()), wq = o => o.getWorldQuaternion(new THREE.Quaternion());
    // ---- trampolines
    this.tramps = [];
    const ringM = std("#2B2BEE", { roughness: 0.4 }), legM = std("#FFF6E6"), padM = std("#FFC845", { roughness: 0.5 });
    for (let i = 0; i < 3; i++) {
      const a = anchors["MOONTRAMP_" + i]; if (!a) continue;
      const R = Math.min(1.2, a.userData.r || 1.2) - 0.05, g = new THREE.Group();
      g.position.copy(wp(a)); g.quaternion.copy(wq(a)); scene.add(g);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.11, 10, 48), ringM); ring.rotation.x = Math.PI / 2; ring.position.y = 0.42; g.add(ring);
      // the group's floor is the tangent plane at the pad centre; the moon (r 9) falls away under
      // the ring by r - sqrt(r^2 - R^2) (7 cm at R 1.15), so each leg runs down past it into the dust
      const sag = moon.R - Math.sqrt(moon.R * moon.R - R * R), LEG = 0.42 + sag + 0.08;
      for (let k = 0; k < 6; k++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, LEG, 8), legM); const an = k / 6 * Math.PI * 2; l.position.set(Math.cos(an) * R, 0.42 - LEG / 2, Math.sin(an) * R); g.add(l); }
      // the mat sags under a landing: a disc whose middle dips (in its vertex shader)
      const padG = new THREE.CircleGeometry(R - 0.06, 40, 0, Math.PI * 2); padG.rotateX(-Math.PI / 2);
      const pm = padM.clone(), dip = { value: 0 };
      pm.onBeforeCompile = sh => { sh.uniforms.uDip = dip; sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uDip;").replace("#include <begin_vertex>", `#include <begin_vertex>\nfloat rr = length(position.xz) / ${(R - 0.06).toFixed(3)}; transformed.y -= uDip * (1.0 - rr * rr);`); };
      const pad = new THREE.Mesh(padG, pm); pad.position.y = 0.4; g.add(pad);
      [ring, pad, ...g.children].forEach(o => { o.castShadow = true; o.receiveShadow = true; });
      if (outline) outline(g, INK, o => o !== pad);
      this.tramps.push({ g, R, dip, s: { x: 0, v: 0 }, n: wp(a).sub(moon.centre).normalize(), combo: 0, cool: 0 });
    }
    // ---- fallen stars and their constellation
    // an unstamped saved list predates the stars flying home and is cleared; the caller's array (ui.puzzles.stars) is
    // emptied with it, so the next save writes the cleared list back
    const mig = cleanStars(saved, 5, starsStamp());
    if (Array.isArray(saved)) saved.splice(0, saved.length, ...mig.saved);
    const starGeo = new THREE.ExtrudeGeometry(starShape(0.42, 0.19), { depth: 0.1, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 2 });
    starGeo.center();
    this.starMat = new THREE.MeshStandardMaterial({ color: "#FFD23F", emissive: new THREE.Color("#FFB020"), emissiveIntensity: 0.55, roughness: 0.4 });
    this.stars = [];
    for (let i = 0; i < 5; i++) {
      const a = anchors["MOONSTAR_" + i]; if (!a) continue;
      // each star rides in its own group so its ink hull (added beside it) moves with it
      const m = new THREE.Group(), mesh = new THREE.Mesh(starGeo, this.starMat); mesh.castShadow = true; m.add(mesh);
      // never culled (nor its hull), so the lens that draws the sky is always seen (see facing())
      mesh.frustumCulled = false; mesh.onBeforeRender = (r, sc, cam) => this.seeLens(cam);
      const base = wp(a), n = base.clone().sub(moon.centre).normalize();
      m.position.copy(base).addScaledVector(n, 1.0);
      scene.add(m);
      if (outline) outline(m, INK);
      this.stars.push({ m, mesh, base, n, i, home: mig.saved.includes(i), fly: -1, pop: 1 });
    }
    // the constellation hangs beside the moon (low in the sky from the deck, beside the moon from the planet)
    const toP = planet.centre.clone().sub(moon.centre).normalize();
    const side = new THREE.Vector3(0, 1, 0).cross(toP).normalize(), upv = toP.clone().cross(side).normalize();
    // (above the deck's horizon: the deck faces the planet, so it sits planet-side of the moon)
    this.cCentre = moon.centre.clone().addScaledVector(side, -26).addScaledVector(upv, 8).addScaledVector(toP, 17);
    // laid out on a plane turned halfway between the landing deck and the planet's moon-facing side: square on to
    // either, the shape would be edge-on (a line) from the other
    const deck = moon.centre.clone().addScaledVector(toP, moon.R), below = planet.centre.clone().addScaledVector(toP, -(planet.R || 0));
    const nrm = deck.clone().sub(this.cCentre).normalize().add(below.sub(this.cCentre).normalize()).normalize();
    const cu = toP.clone().cross(nrm).normalize(), cv = nrm.clone().cross(cu).normalize();
    const shape = [[-12, -3], [-5, 5], [2, 1], [8, 7], [13, -2]];
    this.skyFrame = { nrm, cu, cv, up: toP };
    this.slots = shape.map(([u, v]) => this.cCentre.clone().addScaledVector(cu, u).addScaledVector(cv, v));
    this.ghostMat = new THREE.MeshBasicMaterial({ color: "#FFE27A", transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false });
    this.lineMat = new THREE.MeshBasicMaterial({ color: "#FFF6E6", transparent: true, opacity: 0.0, depthWrite: false, toneMapped: false });
    // each slot's pose before any lens has drawn the sky: a star face along the plane's normal
    const dummy = new THREE.Object3D();
    this.slotQ = this.slots.map(p => { dummy.position.copy(p); dummy.lookAt(p.clone().add(nrm)); return dummy.quaternion.clone(); });
    this.eye = new THREE.Vector3(); this.eyeUp = new THREE.Vector3(); this.eyeSeen = false;
    // the dim ghost marks an empty slot; it goes when its own (physical) star arrives and sits there
    this.sky = this.slots.map((p, i) => {
      const m = new THREE.Mesh(starGeo, this.ghostMat); m.position.copy(p); m.quaternion.copy(this.slotQ[i]); m.scale.setScalar(SKY_SCALE); scene.add(m); return m;
    });
    // a soft halo behind each star once it is home (flat cream disc, soft edge: no lens flare)
    const haloTex = haloTexture();
    for (const s of this.stars) {
      s.homeMat = new THREE.MeshBasicMaterial({ color: STAR_HOME.clone(), toneMapped: false });
      s.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: "#FFF1B8", transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      s.halo.visible = false; s.halo.scale.setScalar(HALO); s.m.add(s.halo);
    }
    // the lines grow from one star to the next (geometry based at its start), so they can draw on
    this.lines = [];
    for (let k = 0; k < 4; k++) {
      const a = this.slots[k], b = this.slots[k + 1], L = a.distanceTo(b), dir = b.clone().sub(a).normalize();
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, L - 3.4, 6).translate(0, (L - 3.4) / 2, 0), this.lineMat.clone());
      l.position.copy(a).addScaledVector(dir, 1.7); l.quaternion.setFromUnitVectors(UP, dir); l.scale.y = 0.001; scene.add(l);
      l.userData.draw = 0; this.lines.push(l);
    }
    for (const s of this.stars) if (s.home) this.seat(s);
    // a constellation saved as complete comes back complete: glowing, lines drawn, twinkling
    this.complete = this.stars.length > 0 && this.stars.every(s => s.home);
    this.doneT = this.complete ? 99 : -1; this.glow = this.complete ? 1 : 0;
    this.twinkle = { period: TW_PERIOD, scaleAmp: TW_AMP, scaleAmpBefore: TW_AMP0, stagger: TW_STAGGER };
    this.refreshLines(true);
  }
  /* a grabbed star sets off; it arcs out over the middle of its path (away from the moon), so a
     star from the far side swings round the limb instead of cutting through the rock */
  launch(s) {
    s.fly = 0; s.from = s.m.position.clone(); s.q0 = s.m.quaternion.clone();
    s.lift = s.from.clone().lerp(this.slots[s.i], 0.5).sub(this.moon.centre).normalize();
  }
  /* the physical star takes its slot: exact slot position, facing the lens, sky scale, unlit glow material */
  seat(s) {
    s.m.position.copy(this.slots[s.i]); this.facing(s.m.position, s.m.quaternion, s.i); s.m.scale.setScalar(SKY_SCALE);
    s.m.visible = true; s.mesh.material = s.homeMat; s.mesh.castShadow = false;
    s.halo.visible = true; this.sky[s.i].visible = false;
  }
  /* a home star: arrival pop, then the twinkle (warmer, brighter and bigger once all five are home) */
  shine(s, dt, t) {
    s.pop = Math.min(1, s.pop + dt / 0.5);
    this.facing(s.m.position, s.m.quaternion, s.i);
    const p = s.pop, bump = Math.sin(Math.PI * p) * (1 - 0.5 * p) * 0.45;
    const w = 0.5 + 0.5 * Math.sin(t * (2 * Math.PI / TW_PERIOD) + s.i * TW_STAGGER), g = this.glow;
    const amp = TW_AMP0 + (TW_AMP - TW_AMP0) * g;
    s.m.scale.setScalar(SKY_SCALE * (1 + bump + amp * (2 * w - 1)));
    s.homeMat.color.copy(STAR_HOME).lerp(_c.copy(STAR_WARM).lerp(STAR_HOT, w), g);
    // halo: a big quick flash on arrival, then a soft glow that breathes with the twinkle
    const base = (0.16 + g * (0.22 + 0.3 * w)), flash = (1 - p) * (1 - p);
    s.halo.material.opacity = base + 0.75 * flash;
    s.halo.scale.setScalar(HALO * (1 + 0.35 * g + 0.25 * g * w + 1.4 * p * (1 - p) * 2));
  }
  /* the lens that draws the stars (not the sun's shadow pass), kept for the next update */
  seeLens(cam) {
    if (!cam.isPerspectiveCamera) return;
    const e = cam.matrixWorld.elements;
    this.eye.set(e[12], e[13], e[14]); this.eyeUp.set(e[4], e[5], e[6]); this.eyeSeen = true;
  }
  /* the pose that turns a sky star at p (or ghost) square on to that lens, upright on its screen: from the planet as
     from the moon each one reads as a whole star, never edge-on. slotQ until a lens has drawn the sky. */
  facing(p, q, i) {
    return this.eyeSeen ? q.setFromRotationMatrix(_m.lookAt(this.eye, p, this.eyeUp)) : q.copy(this.slotQ[i]);
  }
  /* a held lens on the whole constellation for rig.focus: out along its plane's normal (the deck and planet side), far enough that all five
     stars fit the frame with a 25% margin, looking at the middle of the shape, the deck's up as up. The constellation
     is below the horizon from much of the moon, so the follow lens cannot always show it. */
  skyShot(camera) {
    const { nrm, cu, cv, up } = this.skyFrame, us = [], vs = [];
    for (const p of this.slots) { const d = p.clone().sub(this.cCentre); us.push(d.dot(cu)); vs.push(d.dot(cv)); }
    const r = 0.42 * SKY_SCALE * 1.2, hu = (Math.max(...us) - Math.min(...us)) / 2 + r, hv = (Math.max(...vs) - Math.min(...vs)) / 2 + r;
    const look = this.cCentre.clone().addScaledVector(cu, (Math.max(...us) + Math.min(...us)) / 2).addScaledVector(cv, (Math.max(...vs) + Math.min(...vs)) / 2);
    const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), dist = 1.25 * Math.max(hv / tv, hu / (tv * camera.aspect));
    return { pos: look.clone().addScaledVector(nrm, dist), look, up: up.clone() };
  }
  get found() { return this.stars.filter(s => s.home).map(s => s.i); }
  refreshLines(instant) {
    this.lines.forEach((l, k) => { l.userData.want = this.stars.find(s => s.i === k)?.home && this.stars.find(s => s.i === k + 1)?.home ? 0.85 : 0; if (instant) { l.material.opacity = l.userData.want; l.userData.draw = l.userData.want > 0 ? 1 : 0; l.scale.y = Math.max(0.001, l.userData.draw); } });
  }
  /* returns events: { bounce: combo } | { star: count, done } */
  update(dt, t, player, fx) {
    const ev = {};
    const onMoon = player.body === this.moon && !player.flight;
    // trampolines
    for (const tr of this.tramps) {
      tr.cool = Math.max(0, tr.cool - dt);
      tr.s.v += (-tr.s.x * 120 - tr.s.v * 7) * dt; tr.s.x += tr.s.v * dt;
      tr.dip.value = tr.s.x * 0.28;
      if (!onMoon || tr.cool > 0) continue;
      const d = player.position.clone().sub(tr.g.position), h = d.dot(tr.n);
      d.addScaledVector(tr.n, -h);
      // a height window, not just "below 0.75": the cylinder under a pad runs straight through the
      // moon and out the far side, so without the floor at -0.3 m the bare ground opposite each
      // pad (h ~ -18 m) would bounce Blip forever
      if (d.length() < tr.R - 0.15 && h > -0.3 && h < 0.75 && player.vr <= 0.5) {
        tr.combo = player.height > 0.6 ? Math.min(3, tr.combo + 1) : 1;      // landing from a bounce builds it up
        player.vr = [0, 10.5, 12.5, 14.5][tr.combo];
        player.play("Jump");
        tr.s.v -= 6; tr.cool = 0.35;
        if (fx) for (let k = 0; k < 6; k++) { const an = k / 6 * Math.PI * 2; const v = new THREE.Vector3(Math.cos(an), 0, Math.sin(an)).applyQuaternion(tr.g.quaternion).multiplyScalar(2.2).addScaledVector(tr.n, 0.8); fx.puff(tr.g.position.clone().addScaledVector(tr.n, 0.5), { size: 0.16, life: 0.55, vel: v, grow: 1.4 }); }
        ev.bounce = tr.combo;
      }
      if (player.height < 0.05 && d.length() > tr.R + 0.5) tr.combo = 0;
    }
    for (let k = 0; k < this.sky.length; k++) if (this.sky[k].visible) this.facing(this.sky[k].position, this.sky[k].quaternion, k);
    // stars bob and spin; collect when Blip touches one
    if (this.doneT >= 0) this.doneT += dt;
    // the whole constellation warms up just after the last star lands
    this.glow = THREE.MathUtils.damp(this.glow, this.complete && this.doneT > 0.35 ? 1 : 0, 2.2, dt);
    for (const s of this.stars) {
      if (s.home) { this.shine(s, dt, t); continue; }
      if (s.fly >= 0) {
        // the physical star flies up off the moon on an eased arc and settles into its own slot
        s.fly += dt / FLY;
        const k = Math.min(1, s.fly), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        const to = this.slots[s.i];
        s.m.position.copy(s.from).lerp(to, e).addScaledVector(s.lift, Math.sin(Math.PI * e) * 10);
        s.m.scale.setScalar(1 + e * (SKY_SCALE - 1));
        // spins down as it turns to face the lens; the spin is 3 whole turns, so it ends square on
        s.m.quaternion.copy(s.q0).slerp(this.facing(s.m.position, _q2, s.i), e).multiply(_q.setFromAxisAngle(_z, (1 - e) * (1 - e) * Math.PI * 6));
        if (fx && Math.random() < 0.5) fx.puff(s.m.position, { size: 0.12 + 0.2 * e, color: new THREE.Color("#FFD23F"), life: 0.5, glow: true, grow: 1 });
        if (k >= 1) {
          s.home = true; s.fly = -1; s.pop = 0; this.seat(s); this.refreshLines(); stampStars();
          ev.star = this.found.length; ev.done = ev.star === this.stars.length;
          if (ev.done) { this.complete = true; this.doneT = 0; }
          // the arrival flash: a ring of sparks at the slot
          if (fx) for (let j = 0; j < 12; j++) { const an = j / 12 * Math.PI * 2; fx.puff(to, { size: 0.35, color: new THREE.Color(j % 2 ? "#FFD23F" : "#FFF6E6"), life: 0.6, glow: true, grow: 1.6, vel: _v.set(Math.cos(an), Math.sin(an), 0).applyQuaternion(s.m.quaternion).multiplyScalar(5).clone() }); }
        }
        continue;
      }
      s.m.position.copy(s.base).addScaledVector(s.n, 1.0 + Math.sin(t * 2 + s.i) * 0.12);
      // upright (its points in the plane that holds the moon's up), spinning about that up
      s.m.quaternion.setFromUnitVectors(UP, s.n).multiply(new THREE.Quaternion().setFromAxisAngle(UP, t * 1.4 + s.i));
      if (onMoon && player.position.clone().addScaledVector(player.up, 0.6).distanceTo(s.m.position) < 1.15) {
        this.launch(s); ev.grab = this.stars.filter(q => q.home || q.fly >= 0).length;
        if (fx) for (let k = 0; k < 10; k++) fx.puff(s.m.position, { size: 0.12, color: new THREE.Color(k % 2 ? "#FFD23F" : "#FFF6E6"), life: 0.7, glow: true, grow: 1, vel: new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4) });
      }
    }
    // lines draw on from star to star; on completion a warm brightening runs down the chain
    this.lines.forEach((l, k) => {
      const want = l.userData.want;
      l.userData.draw = want > 0 ? Math.min(1, l.userData.draw + dt / 0.7) : 0;
      const d = l.userData.draw, de = 1 - Math.pow(1 - d, 3);
      l.scale.y = Math.max(0.001, de);
      const lit = this.complete ? THREE.MathUtils.clamp((this.doneT - 0.4 - k * 0.3) / 0.6, 0, 1) : 0;
      l.material.opacity = THREE.MathUtils.damp(l.material.opacity, want > 0 ? 0.85 + 0.15 * lit : 0, 3, dt);
      l.material.color.copy(LINE_COOL).lerp(LINE_WARM, lit);
      l.scale.x = l.scale.z = 1 + 0.6 * lit;
    });
    return ev;
  }
}
