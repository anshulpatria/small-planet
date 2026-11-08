/* Brand Studio - "Make the hay.ag mark".
   The backdrop is a hay.ag hero billboard (forest board, mint extruded metaball slabs, cream logo + copy).
   The puzzle: rebuild the hay.ag logomark from the metaball grid; solving lights the billboard up, and
   "New mark" cycles other Brand Studio palettes/marks to show the tool makes whole identity systems.
   Pure logic (matches, progress, markRuns, nextMark, springStep, markBounds, drawBillboard) is exported for Node tests. */
import * as THREE from "three";

/* ------------------------------------------------------------------ logic */
// 3x3 patterns, index = row * 3 + col, row 0 is the TOP row of the mark.
export const PATTERNS = {
  // hay.ag logomark reconstructed on the 3x3 metaball grid: a stem with a right bump up top and a left bump below
  hay:   [0, 1, 0, 0, 1, 1, 1, 1, 0],
  plus:  [0, 1, 0, 1, 1, 1, 0, 1, 0],
  s:     [0, 1, 1, 0, 1, 0, 1, 1, 0],
  z:     [1, 1, 0, 0, 1, 0, 0, 1, 1],
  t:     [1, 1, 1, 0, 1, 0, 0, 1, 0],
  stair: [1, 0, 0, 1, 1, 0, 0, 1, 1],
  l:     [1, 0, 0, 1, 0, 0, 1, 1, 0],
  tile:  [1, 1, 0, 1, 1, 0, 0, 0, 0],
};
export const MARK_ORDER = ["hay", "plus", "s", "z", "t", "stair", "l", "tile"];
/* Brand Studio colour presets (tool: COLOR_PRESETS). bg = board, p = pattern/slabs, head/body = copy,
   cta/ctaTx = button, logo = logomark + wordmark. Forest uses the hay.ag hero values. */
export const PALETTES = [
  { name: "Forest", bg: "#3E6B53", p: "#96E6B3", head: "#FFF6E3", body: "#F2EDE4", cta: "#96E6B3", ctaTx: "#3E6B53", logo: "#FFFBF0" },
  { name: "Earth",  bg: "#3D1F2B", p: "#FFA070", head: "#F2EDE4", body: "#FFF6E3", cta: "#FFA070", ctaTx: "#3D1F2B", logo: "#FFFBF0" },
  { name: "Coral",  bg: "#FFA070", p: "#3D1F2B", head: "#1E1E2E", body: "#3D1F2B", cta: "#3D1F2B", ctaTx: "#FFA070", logo: "#1E1E2E" },
  { name: "Ocean",  bg: "#82C4F0", p: "#1B3A5C", head: "#1B3A5C", body: "#1B3A5C", cta: "#CCE87A", ctaTx: "#1B3A5C", logo: "#1B3A5C" },
  { name: "Bloom",  bg: "#C9A0F5", p: "#FFCCE8", head: "#3D1F2B", body: "#3D1F2B", cta: "#FFCCE8", ctaTx: "#3D1F2B", logo: "#3D1F2B" },
  { name: "Night",  bg: "#1E1E2E", p: "#7AEAAC", head: "#FFF6E3", body: "#F2EDE4", cta: "#7AEAAC", ctaTx: "#1E1E2E", logo: "#FFFBF0" },
  { name: "Spring", bg: "#7AEAAC", p: "#2D6B4F", head: "#2D6B4F", body: "#3D1F2B", cta: "#2D6B4F", ctaTx: "#7AEAAC", logo: "#1E1E2E" },
];
/* Adjacent cell pairs: [a, b, vertical?] */
export const PAIRS = (() => {
  const p = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    if (c < 2) p.push([r * 3 + c, r * 3 + c + 1, 0]);
    if (r < 2) p.push([r * 3 + c, (r + 1) * 3 + c, 1]);
  }
  return p;
})();
/* Diagonal pairs [a, b]: the tool draws a small bridge at the shared corner of diagonal neighbours. */
export const DIAGS = (() => {
  const p = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
    if (c < 2) p.push([r * 3 + c, (r + 1) * 3 + c + 1]);
    if (c > 0) p.push([r * 3 + c, (r + 1) * 3 + c - 1]);
  }
  return p;
})();

/* The tool's merge rule (renderMetaballToCanvas): consecutive cells in a row merge into one run,
   vertical runs merge when 2+ long, and diagonal neighbours get a corner bridge. */
export function markRuns(pat) {
  const h = [], v = [], diag = [];
  for (let r = 0; r < 3; r++) {
    let c = 0;
    while (c < 3) {
      if (!pat[r * 3 + c]) { c++; continue; }
      let e = c; while (e < 3 && pat[r * 3 + e]) e++;
      h.push({ r, c0: c, c1: e - 1 }); c = e;
    }
  }
  for (let c = 0; c < 3; c++) {
    let r = 0;
    while (r < 3) {
      if (!pat[r * 3 + c]) { r++; continue; }
      let e = r; while (e < 3 && pat[e * 3 + c]) e++;
      if (e - r >= 2) v.push({ c, r0: r, r1: e - 1 });
      r = e;
    }
  }
  for (const [a, b] of DIAGS) if (pat[a] && pat[b]) diag.push([a, b]);
  return { h, v, diag };
}

export function matches(live, target) {
  for (let i = 0; i < 9; i++) if (!!live[i] !== !!target[i]) return false;
  return true;
}
/* hit = target cells already lit, total = target cells, extra = lit cells that should be off */
export function progress(live, target) {
  let hit = 0, total = 0, extra = 0;
  for (let i = 0; i < 9; i++) {
    if (target[i]) { total++; if (live[i]) hit++; } else if (live[i]) extra++;
  }
  return { hit, total, extra };
}
export function pickTarget(prev, rng = Math.random) {
  const keys = Object.keys(PATTERNS);
  for (let i = 0; i < 20; i++) {
    const p = PATTERNS[keys[Math.floor(rng() * keys.length)]];
    if (!prev || !matches(p, prev)) return p.slice();
  }
  return PATTERNS.plus.slice();
}
/* k = 0 is the hay.ag mark in Forest; later k cycle other marks AND other palettes. */
export function nextMark(k) {
  const n = ((k % MARK_ORDER.length) + MARK_ORDER.length) % MARK_ORDER.length;
  const key = MARK_ORDER[n];
  return { key, palette: ((k % PALETTES.length) + PALETTES.length) % PALETTES.length, pattern: PATTERNS[key].slice() };
}
/* Damped spring (semi-implicit Euler). state = {x, v}; returns nothing, mutates. */
export function springStep(st, target, dt, k = 190, c = 16) {
  st.v += ((target - st.x) * k - st.v * c) * dt;
  st.x += st.v * dt;
}

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
/* Rounded box in the XY plane, extruded along z, centred on the origin. */
function boxXY(w, h, d, r, bt, hole) {
  const sh = rrPath(new THREE.Shape(), w - 2 * bt, h - 2 * bt, r - bt);
  if (hole) sh.holes.push(rrPath(new THREE.Path(), hole.w + 2 * bt, hole.h + 2 * bt, hole.r + bt));
  const g = new THREE.ExtrudeGeometry(sh, { depth: d - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bt, bevelSegments: 3, curveSegments: 10 });
  g.translate(0, 0, -(d - 2 * bt) / 2);
  return g;
}
/* Rounded slab standing on y=0: footprint w (x) by d (z), height h. */
function slab(w, d, h, r, bt) {
  const sh = rrPath(new THREE.Shape(), w - 2 * bt, d - 2 * bt, r - bt);
  const g = new THREE.ExtrudeGeometry(sh, { depth: h - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bt, bevelSegments: 3, curveSegments: 10 });
  g.rotateX(-Math.PI / 2); g.translate(0, bt, 0);
  return g;
}
/* Numpad keycap standing on y=0: a w x w rounded square (corner radius r) carried `lift` above the
   tray on a stem inset by `inset`; its walls lean in by `taper` up to a chamfer of `bev`, then a flat
   top. Stem, underside, walls, chamfer and top are separate bands, so the cel edge falls on the top
   edge, and the underside gives the ink hull a silhouette all round the cap, clear of the tray;
   around each corner the normals turn smoothly. */
function keycap(w, h, r, taper, bev, lift, inset, seg = 6) {
  const ring = (half, rad, y) => {
    const p = [];
    for (let k = 0; k < 4; k++) {
      const sx = k === 0 || k === 3 ? 1 : -1, sz = k < 2 ? 1 : -1;
      for (let j = 0; j <= seg; j++) {
        const a = (k + j / seg) * Math.PI / 2, dx = Math.cos(a), dz = Math.sin(a);
        p.push({ x: sx * (half - rad) + dx * rad, y, z: sz * (half - rad) + dz * rad, dx, dz });
      }
    }
    return p;
  };
  const h0 = w / 2, h1 = h0 - taper, h2 = h1 - bev;
  const S0 = ring(h0 - inset, r * 0.5, 0), S1 = ring(h0 - inset, r * 0.5, lift);
  const R0 = ring(h0, r, lift), R1 = ring(h1, r * h1 / h0, h - bev), R2 = ring(h2, Math.max(0.01, r * h1 / h0 - bev * 0.6), h);
  const pos = [], nor = [];
  const tri = (a, b, c, na, nb, nc) => {
    // wind each triangle outward (against its own normals)
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (fx * (na[0] + nb[0] + nc[0]) + fy * (na[1] + nb[1] + nc[1]) + fz * (na[2] + nb[2] + nc[2]) < 0) { [b, c] = [c, b]; [nb, nc] = [nc, nb]; }
    for (const [p, n] of [[a, na], [b, nb], [c, nc]]) { pos.push(p.x, p.y, p.z); nor.push(...n); }
  };
  const band = (A, B, nf) => {
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length, na = nf(A[i]), nb = nf(A[j]);
      tri(A[i], A[j], B[j], na, nb, nb); tri(A[i], B[j], B[i], na, nb, na);
    }
  };
  const unit = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
  band(S0, S1, p => [p.dx, 0, p.dz]);
  band(S1, R0, () => [0, -1, 0]);
  band(R0, R1, p => unit(p.dx * (h - bev - lift), taper, p.dz * (h - bev - lift)));
  band(R1, R2, p => unit(p.dx * bev, bev, p.dz * bev));
  const cap = (R, y, n) => { const c = { x: 0, y, z: 0 }; for (let i = 0; i < R.length; i++) tri(c, R[i], R[(i + 1) % R.length], n, n, n); };
  cap(R2, h, [0, 1, 0]);   // (the stem's foot stands on the tray, so it stays open)
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
/* Rectilinear polygon with every corner (convex and concave) rounded by a quadratic fillet. */
function roundedPoly(points, r) {
  const sh = new THREE.Shape(), n = points.length;
  for (let i = 0; i < n; i++) {
    const P = points[i], A = points[(i + n - 1) % n], B = points[(i + 1) % n];
    const da = Math.hypot(A[0] - P[0], A[1] - P[1]), db = Math.hypot(B[0] - P[0], B[1] - P[1]);
    const rr = Math.min(r, da / 2, db / 2);
    const sx = P[0] + ((A[0] - P[0]) / da) * rr, sy = P[1] + ((A[1] - P[1]) / da) * rr;
    const ex = P[0] + ((B[0] - P[0]) / db) * rr, ey = P[1] + ((B[1] - P[1]) / db) * rr;
    if (i === 0) sh.moveTo(sx, sy); else sh.lineTo(sx, sy);
    sh.quadraticCurveTo(P[0], P[1], ex, ey);
  }
  sh.closePath();
  return sh;
}
/* Extruded outline: x/y exactly the outline, z from 0 (back) to depth (front), bevelled edges. */
function polySlab(points, r, depth, bt) {
  const g = new THREE.ExtrudeGeometry(roundedPoly(points, r), { depth: depth - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bt, bevelOffset: -bt, bevelSegments: 3, curveSegments: 8 });
  g.translate(0, 0, bt);
  return g;
}

/* ------------------------------------------------------------------ layout */
export const PITCH = 1.0;
export const CELL = { w: 1.0, d: 0.7 };             // live cell size (xy, cells touch) and depth (z)
export const MAX_SCALE = 1.08;                       // springs may overshoot, but are clamped to this
export const TURN = { x: 0, y: 1.2, z: -5 };         // turntable axis; y = disc top surface
export const DISC_R = 2.0;
export const SCULPT_Y = 1.54 + 0.1;                  // sculpture origin above the disc (bottom cell at full overshoot + 10 cm air)
export const BOB = 0.03;                             // idle float amplitude (upwards only)
/* the hay.ag hero billboard: centre (x,y,z), width, height, depth */
export const POSTER = { x: 0, y: 5.0, z: -7.7, w: 11.6, h: 6.0, d: 0.3 };
export const POSTER_BOX = { minX: -5.8, maxX: 5.8, minY: 2.0, maxY: 8.0, minZ: -7.85, maxZ: -7.55 };
export const PLINTH_BOX = { minX: -2.3, maxX: 2.3, minY: 0, maxY: 1.1, minZ: -7.3, maxZ: -2.7 };
export const LECTERN_BOX = { minX: -1.6, maxX: 1.6, minY: 0, maxY: 1.0, minZ: 0.02, maxZ: 1.98 };
/* target preview card, pinned proud of the billboard's upper right. GA2: 3.2 x 3.4 (was a 2.2 square), a cream
   bezel, a GOAL title with a live count and pip row, and the mark drawn larger (scale 0.72, lower in the card).
   It sits above the billboard copy (so it never hides a word) and in front of the corner slab, clear of the
   slabs' lit ripple. */
const CARD = { x: 3.9, y: 6.18, size: 3.0, h: 3.2, scale: 0.68, markDy: 0.5, bezel: 0.12, z: POSTER_BOX.maxZ + 0.52 };
export const CAM = { pos: [0, 8.2, 12.5], look: [0, 2.2, -3] };
const BF = POSTER_BOX.maxZ;                          // board front face
const Z_TEXT = BF + 0.002, Z_SLAB = BF + 0.008, SLAB_D = 0.28;
const CS = 0.72;                                     // hero grid cell (the screenshot's slabs are 90 px cells)
const RX = POSTER.w / 2, TY = POSTER.h / 2;
/* Mint slabs as outlines in board-local (u, v) metres, built from the hero's metaball grid. */
const fromTL = (cx, cy) => [-RX + cx * CS, TY - cy * CS];
const fromTR = (cx, cy) => [RX - cx * CS, TY - cy * CS];
const fromBR = (cx, cy) => [RX - cx * CS, -TY + cy * CS];
export const SLAB_SHAPES = [
  { name: "tab", pts: [fromTL(3, 0), fromTL(6, 0), fromTL(6, 1), fromTL(3, 1)], r: 0.28 },
  { name: "corner", pts: [fromTR(5, 0), fromTR(2, 0), fromTR(2, 1), fromTR(1, 1), fromTR(1, 0), fromTR(0, 0), fromTR(0, 3), fromTR(3, 3), fromTR(3, 1), fromTR(5, 1)], r: 0.27 },
  { name: "foot", pts: [fromBR(3, 0), fromBR(0, 0), fromBR(0, 1), fromBR(3, 1)].reverse(), r: 0.28 },
];
const CTA = { u: -4.0, v: -2.1, w: 2.5, h: 0.7, d: 0.2 };
const PYLON_X = 4.2;

/* Conservative bounds of a pattern's live sculpture in WORLD (group) coords, over any turntable yaw.
   `radius` is the max horizontal distance from the turntable axis; y range includes bob + overshoot. */
export function markBounds(pattern) {
  let minY = Infinity, maxY = -Infinity, radius = 0, any = false;
  const hw = (CELL.w / 2) * MAX_SCALE, hd = (CELL.d / 2) * MAX_SCALE;
  for (let i = 0; i < 9; i++) {
    if (!pattern[i]) continue; any = true;
    const cx = ((i % 3) - 1) * PITCH, cy = (1 - Math.floor(i / 3)) * PITCH;
    minY = Math.min(minY, cy - hw); maxY = Math.max(maxY, cy + hw);
    radius = Math.max(radius, Math.hypot(Math.abs(cx) + hw, hd));
  }
  if (!any) return { minY: TURN.y + SCULPT_Y, maxY: TURN.y + SCULPT_Y, radius: 0 };
  const oy = TURN.y + SCULPT_Y;
  return { minY: oy + minY, maxY: oy + maxY + BOB, radius };
}

/* ---------------------------------------------------------- flat graphics */
const MARK_PATH = "M33.13.09c3.57-.16,7.79-.08,11.38,0,5.09.13,4.34,5.6,4.38,9.28.11,9.13,4.34,11.85,13.07,11.7,3.69-.21,7.78.36,7.49,5.22-.2,3.4.69,9.79-.74,12.83-1.23,2.62-6.14,2.12-8.78,2.22-1.36.06-2.71.24-4.03.55-2.15.52-4.5,1.87-5.34,3.72-3.86,8.43.86,15.27,10.11,14.96,2.15-.07,4.9-.17,6.65.82,1.58.89,2.08,2.79,2.11,4.46.05,3.18,0,6.36-.01,9.54,0,2.3-.82,4.38-3.23,5.04-1.2.32-2.87.32-4.09.31-7.48-.07-12.89,2.35-13.1,10.56-.03,1.36-.14,3.43-.93,4.58-.74,1.08-1.75,1.55-3.03,1.79-3.26.54-9.13-.04-12.55-.05-1.68,0-3.61-2.2-3.64-3.94-.03-4.06-.27-8.46.07-12.48.26-3.15,4.27-3.69,6.67-3.6,4.4.16,11.7-.81,12.76-6.17,1.51-7.63-4.23-10.7-10.94-10.63-1.47.02-3.38,0-4.85-.18-3.42-.63-4-3.79-3.82-6.73-.13-2.77-.14-6.17-1.64-8.57-4.08-6.76-14.14-1.66-18.48-5.99-1.01-1.01-.73-12.48-.37-15.55.04-.36.2-.7.46-.96,2.21-2.23,4.92-1.75,7.88-1.77,1.23,0,2.46-.1,3.68-.3,2.52-.41,6.01-1.49,7.12-3.98,1.1-2.81,1.45-6.48,1.36-9.48-.09-3.45.24-6.58,4.39-7.22ZM45.84,22.41c-2.26-1.63-6.05-2.34-8.72-1.97-2.31.31-5.44,1.14-6.9,3.1-3.15,4.25-2.98,11.66,1.44,15.01,2.02,1.54,6.06,2.14,8.54,1.81,3.07-.48,5.36-1.06,7.22-3.74,2.56-3.68,2.24-11.46-1.57-14.21Z";   // hay.ag logomark outline, viewBox 0 0 78 98
const HEAD_FONT = '"Bricolage Grotesque", "Instrument Sans", system-ui, sans-serif';
const BODY_FONT = '"Instrument Sans", system-ui, sans-serif';
export const BOARD_PX = { w: 2048, h: Math.round((2048 * POSTER.h) / POSTER.w) };
const COPY = { head: ["Grow more,", "with less."], body: "Agriculture advances when knowledge is open, structured, and built upon.", cta: "Get Started", brand: "hay.ag" };

function rrCanvas(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
/* Draw the flat parts of the billboard (logomark, wordmark, headline, body, caption) on a transparent canvas. */
export function drawBillboard(g, W, H, pal) {
  const s = W / POSTER.w;
  const X = (u) => (u + POSTER.w / 2) * s, Y = (v) => (POSTER.h / 2 - v) * s;
  g.clearRect(0, 0, W, H);
  g.textAlign = "left"; g.textBaseline = "alphabetic";
  // logomark (real outline when Path2D exists, else rebuilt from the metaball grid) + wordmark
  const mh = 0.7 * s, mx = X(-5.3), my = Y(1.62 + 0.35);
  g.fillStyle = pal.logo;
  if (typeof Path2D !== "undefined" && MARK_PATH.length > 20) {
    const k = mh / 98; g.save(); g.translate(mx, my); g.scale(k, k); g.fill(new Path2D(MARK_PATH), "evenodd"); g.restore();
  } else {
    const cs = mh / 3, runs = markRuns(PATTERNS.hay);
    for (const q of runs.h) { rrCanvas(g, mx + q.c0 * cs, my + q.r * cs, (q.c1 - q.c0 + 1) * cs, cs, cs * 0.23); g.fill(); }
    for (const q of runs.v) { rrCanvas(g, mx + q.c * cs, my + q.r0 * cs, cs, (q.r1 - q.r0 + 1) * cs, cs * 0.23); g.fill(); }
  }
  g.font = `500 ${0.62 * s}px ${BODY_FONT}`;
  g.fillText(COPY.brand, mx + 0.78 * (mh / 98) * 98 + 0.3 * s * 0.82, Y(1.62 - 0.35 + 0.17));
  // headline
  g.fillStyle = pal.head; g.font = `700 ${0.94 * s}px ${HEAD_FONT}`;
  g.fillText(COPY.head[0], X(-5.35), Y(0.3)); g.fillText(COPY.head[1], X(-5.35), Y(-0.68));
  // body, shrunk to fit so it never runs into the target card
  g.fillStyle = pal.body;
  let fs = 0.27 * s; g.font = `400 ${fs}px ${BODY_FONT}`;
  const m = g.measureText ? g.measureText(COPY.body) : null, maxW = 8.3 * s;
  if (m && m.width > maxW) { fs *= maxW / m.width; g.font = `400 ${fs}px ${BODY_FONT}`; }
  g.fillText(COPY.body, X(-5.35), Y(-1.32));
  // caption: which identity of the system is on show
  g.globalAlpha = 0.75; g.fillStyle = pal.body; g.font = `600 ${0.17 * s}px ${BODY_FONT}`;
  g.fillText(`HAY.AG BRAND SYSTEM  /  ${pal.name.toUpperCase()}`, X(-5.35), Y(-2.82));
  g.globalAlpha = 1;
}
function drawCta(g, W, H, pal) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = pal.ctaTx; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = `700 ${Math.round(H * 0.46)}px ${BODY_FONT}`;
  g.fillText(COPY.cta, W / 2, H * 0.54, W * 0.86);
}

/* ------------------------------------------------------------------ marks */
/* The mark is ONE extruded outline, like the billboard's slabs, not 29 overlapping blocks: a
   bevel per block would show each seam between two cells as a groove. The
   outline is the zero line of a 2D distance field made of exact pieces, traced every frame while
   the springs move and extruded once:
   - each cell a rounded square (its own spring sets its size; corner radius ROUND),
   - each pair of lit neighbours a sharp bridge from centre to centre, which fills the notch the
     two rounded corners leave, so the shared edge is dead straight,
   - each inside (concave) corner a fillet of the same radius,
   - two diagonal-only neighbours a small corner bridge, blended in softly (the tool's rule). */
const ROUND = 0.28;
const sdBox = (px, py, hx, hy) => {
  const dx = Math.abs(px) - hx, dy = Math.abs(py) - hy;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
};
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const cellXY = i => [((i % 3) - 1) * PITCH, (1 - Math.floor(i / 3)) * PITCH];
const PAIR_IX = (() => { const m = {}; PAIRS.forEach(([a, c], j) => { m[a * 9 + c] = j; }); return m; })();
/* s: 9 cell scales; b: one spring per PAIRS entry; d: one per DIAGS entry. Returns f(x, y), < 0 inside. */
/* A bridge appears at NECK half-width (x full) rather than growing from a hairline, and disappears
   there when it shrinks: a 1 cm neck cannot carry the sculpture's 6 cm bevel, so extrudeMark had to
   drop the bevel of the whole mark for that frame ("bevel pulse"). The smoke test holds the bevel
   at >= 0.5x nominal through the mid-spring sweep. */
const NECK = 0.03, DIAG_MIN = 0.35;
export function markField(s, b, d, { full = PITCH, r = ROUND } = {}) {
  const on = i => s[i] > 0.05;
  const hard = [], soft = [];
  for (let i = 0; i < 9; i++) {
    if (s[i] <= 0.004) continue;
    const [x, y] = cellXY(i), h = (full / 2) * s[i], rr = Math.min(r, h);
    hard.push((px, py) => sdBox(px - x, py - y, h - rr, h - rr) - rr);
  }
  PAIRS.forEach(([a, c, vert], j) => {
    // never wider than the smaller cell: an overshooting bridge (b > 1) would stand 2 cm proud of it, a ledge too thin to bevel
    const k = Math.min(s[a], s[c]) * Math.min(1, b[j]);
    if (k <= 0.004) return;
    const [ax, ay] = cellXY(a), [cx, cy] = cellXY(c), mx = (ax + cx) / 2, my = (ay + cy) / 2, h = (full / 2) * k;
    if (h < NECK * full) return;          // no neck thinner than the bevel can round (see NECK)
    hard.push(vert ? (px, py) => sdBox(px - mx, py - my, h, PITCH / 2) : (px, py) => sdBox(px - mx, py - my, PITCH / 2, h));
  });
  // inside corners: the four inner lattice points where exactly three cells are lit.
  // The fillet sits in the concave corner the two bridges from the diagonal cell C make, not on the
  // lattice point: mid-spring those bridges are narrower than PITCH, and a fillet left on the lattice
  // point would float free of them as a loose shard (or hang on by a ~1 cm neck that costs the bevel).
  // At rest the bridges are PITCH wide, so the corner is the lattice point.
  for (let rr = 0; rr < 2; rr++) for (let c = 0; c < 2; c++) {
    const q = [rr * 3 + c, rr * 3 + c + 1, (rr + 1) * 3 + c, (rr + 1) * 3 + c + 1];   // TL TR BL BR
    const lit = q.filter(on);
    if (lit.length !== 3) continue;
    const empty = q.findIndex(i => !on(i)), ex = empty % 2 ? 1 : -1, ey = empty < 2 ? 1 : -1;
    const ci = 3 - empty, C = q[ci], Cv = q[ci ^ 2], Ch = q[ci ^ 1];          // diagonal cell, its column / row neighbours
    const bV = Math.min(1, b[PAIR_IX[Math.min(C, Cv) * 9 + Math.max(C, Cv)]]), bH = Math.min(1, b[PAIR_IX[Math.min(C, Ch) * 9 + Math.max(C, Ch)]]);
    const hV = (full / 2) * Math.min(s[C], s[Cv]) * bV, hH = (full / 2) * Math.min(s[C], s[Ch]) * bH;
    if (hV <= 0.004 || hH <= 0.004) continue;
    const vx = (c - 0.5) * PITCH - ex * (PITCH / 2 - hV), vy = (0.5 - rr) * PITCH - ey * (PITCH / 2 - hH);
    const f = r * Math.min(...lit.map(i => s[i])) * Math.min(1, bV, bH);
    if (f <= 0.004) continue;
    const bx = vx + ex * f / 2, by = vy + ey * f / 2, ox = vx + ex * f, oy = vy + ey * f;
    hard.push((px, py) => Math.max(sdBox(px - bx, py - by, f / 2, f / 2), f - Math.hypot(px - ox, py - oy)));
  }
  DIAGS.forEach(([a, c], j) => {
    const k = Math.min(s[a], s[c]) * d[j];
    if (k <= 0.004) return;
    const [ax, ay] = cellXY(a), [cx, cy] = cellXY(c), mx = (ax + cx) / 2, my = (ay + cy) / 2, h = 0.17 * full * k;
    if (k < DIAG_MIN) return;
    soft.push((px, py) => sdBox(px - mx, py - my, h * 0.4, h * 0.4) - h * 0.6);
  });
  return (x, y) => {
    let v = 1e3;
    for (const g of hard) { const u = g(x, y); if (u < v) v = u; }
    for (const g of soft) v = smin(v, g(x, y), 0.16);
    return v;
  };
}

/* Marching squares over f on [x0,x1]x[y0,y1] at spacing h: closed loops of [x, y].
   `raw`, if given, also receives the loops before simplify() (the smoke test's reference area).
   Islands under `minIsland` m^2 are left out of both (see ISLAND). */
export function contours(f, x0, y0, x1, y1, h, raw, minIsland = ISLAND) {
  const nx = Math.ceil((x1 - x0) / h) + 1, ny = Math.ceil((y1 - y0) / h) + 1;
  const v = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = f(x0 + i * h, y0 + j * h);
  const pts = new Map(), nb = new Map();
  const H = (i, j) => (j * nx + i) * 2, V = (i, j) => (j * nx + i) * 2 + 1;
  const point = key => {
    if (pts.has(key)) return;
    const n = key >> 1, i = n % nx, j = (n - i) / nx, vert = key & 1;
    const va = v[j * nx + i], vb = vert ? v[(j + 1) * nx + i] : v[j * nx + i + 1], t = va / (va - vb);
    pts.set(key, vert ? [x0 + i * h, y0 + (j + t) * h] : [x0 + (i + t) * h, y0 + j * h]);
  };
  const seg = (p, q) => {
    point(p); point(q);
    (nb.get(p) || nb.set(p, []).get(p)).push(q); (nb.get(q) || nb.set(q, []).get(q)).push(p);
  };
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = v[j * nx + i], b = v[j * nx + i + 1], c = v[(j + 1) * nx + i + 1], d = v[(j + 1) * nx + i];
    // pieces meet exactly on their shared edges (f = 0 there), so 0 counts as inside
    const id = (a <= 0) | ((b <= 0) << 1) | ((c <= 0) << 2) | ((d <= 0) << 3);
    if (id === 0 || id === 15) continue;
    const e0 = H(i, j), e1 = V(i + 1, j), e2 = H(i, j + 1), e3 = V(i, j);
    if (id === 5 || id === 10) {
      const mid = (a + b + c + d) / 4 <= 0;
      if ((id === 5) === mid) { seg(e0, e1); seg(e2, e3); } else { seg(e3, e0); seg(e1, e2); }
      continue;
    }
    const crossed = [];
    if ((a <= 0) !== (b <= 0)) crossed.push(e0);
    if ((b <= 0) !== (c <= 0)) crossed.push(e1);
    if ((d <= 0) !== (c <= 0)) crossed.push(e2);
    if ((a <= 0) !== (d <= 0)) crossed.push(e3);
    seg(crossed[0], crossed[1]);
  }
  const all = [], seen = new Set();
  for (const start of nb.keys()) {
    if (seen.has(start)) continue;
    const loop = []; let prev = -1, cur = start;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur); loop.push(pts.get(cur));
      const n = nb.get(cur), next = n[0] !== prev ? n[0] : n[1];
      prev = cur; cur = next;
    }
    if (loop.length > 2) all.push(loop);
  }
  const keep = dropIslands(all, minIsland), loops = [];
  all.forEach((loop, i) => { if (keep[i]) { loops.push(simplify(loop, h * 0.04)); if (raw) raw.push(loop); } });
  return loops;
}
/* Loose dots: mid-spring a cell that has lost (or not yet grown) its bridges is a detached island,
   and while it is small it reads as a stray dot beside the 1 m cells ("0>9 f3", "270>7 f6",
   "card->plus"). Islands (outer loops at even nesting depth) under ISLAND m^2, and anything inside
   them, are not traced. ISLAND is 0.15 m^2 = 16% of a settled cell (1 m square, 0.28 corners:
   0.933 m^2), i.e. a cell under ~40% scale: the largest dot the taste gate named is 0.119 m^2, and
   a settled mark's smallest island is a whole cell, so the look at rest is unchanged (smoke test).
   The springs cross 40% in about 4 frames, so a lone cell appears/vanishes ~4 frames early/late. */
const ISLAND = 0.15;
function dropIslands(all, min) {
  const keep = all.map(() => true);
  if (!(min > 0)) return keep;
  const depth = all.map((l, i) => all.filter((m, j) => j !== i && inside(l[0], m)).length);
  const drop = all.map((l, i) => depth[i] % 2 === 0 && Math.abs(area(l)) < min);
  all.forEach((l, i) => { if (drop[i] || all.some((m, j) => j !== i && drop[j] && inside(l[0], m))) keep[i] = false; });
  return keep;
}
/* Straight runs become 2 points: walk from an anchor and keep the farthest point such that every
   point skipped lies within tol of the chord anchor -> kept point.
   Why not a 3-point test (is p on the line between its neighbours?): at a 2 cm sample spacing a
   rounded corner of radius 0.28 bends less than tol between neighbours, so a sliding 3-point test
   drops whole arcs, possibly everything up to its first kept point half-way round the loop; the
   Shape then closes with one straight chord across the mark and the front face loses a wedge.
   The anchor here is the lowest-then-leftmost point, which lies on the hull and is always kept.
   Near-duplicate points (a crossing that lands on a sample) fall within tol and drop out too, so
   ExtrudeGeometry never sees a zero-length edge (its bevel vector there is garbage). */
export function simplify(loop, tol) {
  const n = loop.length;
  if (n < 4) return loop;
  let s0 = 0;
  for (let i = 1; i < n; i++) { const p = loop[i], q = loop[s0]; if (p[1] < q[1] || (p[1] === q[1] && p[0] < q[0])) s0 = i; }
  const P = k => loop[(s0 + k) % n];
  const fits = (a, b, from, to) => {       // all points strictly between indices from..to within tol of chord a-b
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    if (L < tol) return false;
    for (let k = from + 1; k < to; k++) { const p = P(k); if (Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L > tol) return false; }
    return true;
  };
  const out = [P(0)];
  let a = 0;
  while (a < n) {
    let b = a + 1;
    while (b + 1 <= n && fits(P(a), P(b + 1), a, b + 1)) b++;
    if (b >= n) break;                     // reached the anchor again: the loop is closed
    out.push(P(b)); a = b;
  }
  // the last kept point may sit on the closing chord back to the anchor
  while (out.length > 3) {
    const a2 = out[out.length - 2], p = out[out.length - 1], b2 = out[0];
    const dx = b2[0] - a2[0], dy = b2[1] - a2[1], L = Math.hypot(dx, dy) || 1;
    if (Math.abs((p[0] - a2[0]) * dy - (p[1] - a2[1]) * dx) / L > tol && Math.hypot(p[0] - b2[0], p[1] - b2[1]) > tol) break;
    out.pop();
  }
  // and no edge shorter than 5 tol (a crossing next to a sample leaves two points ~1 mm apart:
  // their bevel vectors cross and the inset cap folds there)
  const minL = 5 * tol, clean = [out[0]];
  for (let i = 1; i < out.length; i++) { const q = clean[clean.length - 1], p = out[i]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= minL) clean.push(p); }
  while (clean.length > 3) { const p = clean[clean.length - 1], q = clean[0]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= minL) break; clean.pop(); }
  return clean.length >= 3 ? clean : loop;
}
const area = l => { let A = 0; for (let i = 0; i < l.length; i++) { const p = l[i], q = l[(i + 1) % l.length]; A += p[0] * q[1] - q[0] * p[1]; } return A / 2; };
const inside = (p, l) => {
  let c = false;
  for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
    const a = l[i], b = l[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};
const SPECK = 0.003;
/* loops -> THREE.Shapes: a loop inside an odd number of others is a hole of the smallest one around it */
export function loopsToShapes(loops) {
  const depth = loops.map((l, i) => loops.filter((m, j) => j !== i && inside(l[0], m)).length);
  const shapes = new Map();
  // Specks under SPECK m^2 are dropped: mid-spring the inside-corner fillet floats free of its
  // cells for a few frames as a cusped sliver, and a cusp folds under any bevel. A cell growing
  // from nothing passes this size in about two frames.
  loops.forEach((l, i) => { if (depth[i] % 2 === 0 && Math.abs(area(l)) >= SPECK) shapes.set(i, new THREE.Shape(l.map(([x, y]) => new THREE.Vector2(x, y)))); });
  loops.forEach((l, i) => {
    if (depth[i] % 2 === 0 || Math.abs(area(l)) < SPECK) return;     // pin-holes are filled (same cusps, inside out)
    let best = -1, bestA = Infinity;
    for (const [k] of shapes) { const A = Math.abs(area(loops[k])); if (inside(l[0], loops[k]) && A < bestA) { best = k; bestA = A; } }
    if (best >= 0) shapes.get(best).holes.push(new THREE.Path(l.map(([x, y]) => new THREE.Vector2(x, y))));
  });
  return [...shapes.values()];
}

/* Front-cap area wound the wrong way (m^2). ExtrudeGeometry puts both caps on the outline inset by
   the bevel (bevelOffset -bt), moving each vertex along its own bevel vector. Where the mark is
   thinner than 2*bt (a bridge still growing between two small cells) the inset crosses itself and
   those cap triangles flip: back-face culled, a hole in the face. Exported for the smoke test. */
export function capFlipArea(g) {
  const pos = g.attributes.position.array;
  let plus = 0, minus = 0;
  for (const gr of g.groups) {
    if (gr.materialIndex !== 0) continue;            // caps; per shape, first half back, second half front
    for (let k = gr.start + gr.count / 2; k < gr.start + gr.count; k += 3) {
      const a = k * 3, A = ((pos[a + 3] - pos[a]) * (pos[a + 7] - pos[a + 1]) - (pos[a + 6] - pos[a]) * (pos[a + 4] - pos[a + 1])) / 2;
      if (A > 0) plus += A; else minus -= A;
    }
  }
  return Math.min(plus, minus);                      // whichever winding is the minority
}
/* ExtrudeGeometry triangulates the outline once, then reuses those triangles for both caps on the
   inset outline. Moving the vertices of a long thin earcut triangle (one that spans a straight
   edge kept as 2 points) by their own bevel vectors can flip it: a crack across the face. So
   re-triangulate each cap on the inset points themselves. Same vertex count and holes, so the
   same triangle count, in place; the side walls are untouched and still meet the cap exactly. */
function recap(g, shapes) {
  const pos = g.attributes.position, uv = g.attributes.uv, caps = g.groups.filter(gr => gr.materialIndex === 0);
  shapes.forEach((sh, si) => {
    const gr = caps[si];
    if (!gr) return;
    // the exact points and winding ExtrudeGeometry used (see its addShape)
    const { shape, holes } = sh.extractPoints(1);
    let v = shape; if (!THREE.ShapeUtils.isClockWise(v)) v = v.reverse();
    const hs = holes.map(h => (THREE.ShapeUtils.isClockWise(h) ? h.reverse() : h));
    const faces = THREE.ShapeUtils.triangulateShape(v, hs);
    const n = v.length + hs.reduce((a, h) => a + h.length, 0), half = gr.count / 2;
    if (faces.length * 3 !== half) return;
    const inset = new Array(n), front = gr.start + half;
    faces.forEach((f, i) => { for (let q = 0; q < 3; q++) inset[f[q]] = new THREE.Vector2(pos.getX(front + i * 3 + q), pos.getY(front + i * 3 + q)); });
    if (inset.some(p => !p)) return;
    let o = v.length; const ic = inset.slice(0, o), ih = hs.map(h => inset.slice(o, (o += h.length)));
    const nf = THREE.ShapeUtils.triangulateShape(ic, ih);
    if (nf.length !== faces.length) return;
    const zb = pos.getZ(gr.start), zf = pos.getZ(front);
    nf.forEach((f, i) => {
      const put = (k, j, z) => { pos.setXYZ(k, inset[j].x, inset[j].y, z); uv.setXY(k, inset[j].x, inset[j].y); };
      put(gr.start + i * 3, f[2], zb); put(gr.start + i * 3 + 1, f[1], zb); put(gr.start + i * 3 + 2, f[0], zb);
      put(front + i * 3, f[0], zf); put(front + i * 3 + 1, f[1], zf); put(front + i * 3 + 2, f[2], zf);
    });
  });
  pos.needsUpdate = true; uv.needsUpdate = true;
  g.computeVertexNormals();
}
/* Extrude the traced outline with a rounded bevel of bt. If the inset cap still folds (a part
   thinner than 2*bt, e.g. a bridge still growing between two small cells; see capFlipArea), retry
   with half the bevel: this only happens while parts are tiny, where a small bevel is what they
   would have anyway, and the depth stays d. */
export function extrudeMark(shapes, d, bt) {
  // mid-spring the field can pinch to a ~1 cm neck (a soft diagonal bridge meeting a half-grown
  // cell), so allow down to bt/32; at rest every pattern keeps the full bevel (smoke test)
  let g, b = bt;
  for (let k = 0; k < 6; k++) {
    if (k) { g.dispose(); b *= 0.5; }
    g = new THREE.ExtrudeGeometry(shapes, { depth: d - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 3, curveSegments: 1 });
    recap(g, shapes);
    if (capFlipArea(g) < 1e-5) break;
  }
  g.translate(0, 0, -(d - 2 * b) / 2);
  g.userData.bt = b;
  return g;
}
/* The outline the Mark extrudes, for spring state (s, b, d) already clamped. Exported so the smoke
   test triangulates exactly what the sculpture and the billboard card extrude. */
export function markShapes(s, b, d, full = PITCH, raw) {
  const f = markField(s, b, d, { full });
  const L = 1.5 * PITCH + (full / 2) * (MAX_SCALE - 1) + 0.12;
  return loopsToShapes(contours(f, -L + 0.0037, -L + 0.0053, L, L, 0.02, raw));   // off-lattice, so no sample sits on a seam
}

export class Mark {
  /* A 3x3 metaball-grid mark drawn as one merged slab. Springs per cell, per bridge and per
     diagonal bridge; the outline is re-traced only while something moves. */
  constructor(parent, material, { depth, bt, shadow = false, full = PITCH }) {
    this.depth = depth; this.bt = bt; this.full = full;
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.castShadow = shadow; this.mesh.receiveShadow = true; this.mesh.visible = false;
    parent.add(this.mesh);
    this.cs = Array.from({ length: 9 }, () => ({ x: 0, v: 0 }));
    this.bs = Array.from({ length: PAIRS.length }, () => ({ x: 0, v: 0 }));
    this.ds = Array.from({ length: DIAGS.length }, () => ({ x: 0, v: 0 }));
    this.dirty = true;
  }
  /* Drive springs toward `pattern`. Returns true while anything is still moving. */
  step(pattern, dt, kick) {
    let moving = false;
    const go = (st, on, k, c, kk) => {
      if (kick && on) st.v += kick * kk;
      springStep(st, on, dt, k, c);
      if (Math.abs(st.x - on) > 0.002 || Math.abs(st.v) > 0.02) moving = true;
    };
    for (let i = 0; i < 9; i++) go(this.cs[i], pattern[i] ? 1 : 0, 190, 16, 1);
    PAIRS.forEach(([a, b], j) => go(this.bs[j], pattern[a] && pattern[b] ? 1 : 0, 170, 17, 1));
    // a diagonal bridge only where the two cells meet at nothing but a corner
    DIAGS.forEach(([a, b], j) => {
      const ra = Math.floor(a / 3), ca = a % 3, rb = Math.floor(b / 3), cb = b % 3;
      const other = pattern[ra * 3 + cb] || pattern[rb * 3 + ca];
      go(this.ds[j], pattern[a] && pattern[b] && !other ? 1 : 0, 170, 17, 0.6);
    });
    if (moving || this.dirty) this.rebuild();
    this.dirty = false;
    return moving;
  }
  rebuild() {
    const clamp = st => Math.min(MAX_SCALE, Math.max(0, st.x));
    const shapes = markShapes(this.cs.map(clamp), this.bs.map(clamp), this.ds.map(clamp), this.full);
    this.mesh.geometry.dispose();
    this.has = shapes.length > 0;
    if (!this.has) { this.mesh.geometry = new THREE.BufferGeometry(); this.mesh.visible = false; return; }
    this.mesh.geometry = extrudeMark(shapes, this.depth, this.bt); this.mesh.visible = true;
  }
  dispose() { this.mesh.geometry.dispose(); }
}

/* ------------------------------------------------------------------- game */
const BTN = { size: 0.5, gap: 0.12, h: 0.14, topY: 0.8 };
const BTN_PITCH = BTN.size + BTN.gap;
const BTN_Z0 = 1.0; // centre row z
const GHOST_ON = 0.95;

export default class BrandStudio {
  static id = "brand-studio";

  constructor(ctx) {
    this.ctx = ctx;
    const pal = ctx.palette || {};
    this.cols = { paper: pal.paper || "#ECEDE8", ink: pal.ink || "#1B1C20", signal: pal.signal || "#2B2BEE", concrete: pal.concrete || "#C4C5BE" };
    this.geos = []; this.mats = []; this.texs = [];
    this.root = new THREE.Group(); ctx.group.add(this.root);
    const low = !!ctx.lowPower;
    const shadow = !low;
    const mat = (o) => { const m = new THREE.MeshStandardMaterial(o); this.mats.push(m); return m; };
    const geo = (g) => { this.geos.push(g); return g; };
    const add = (g, m, parent = this.root, cast = true) => {
      const o = new THREE.Mesh(g, m); o.castShadow = cast && shadow; o.receiveShadow = true; parent.add(o); return o;
    };
    this.solids = [];                                  // every static solid, for overlap tests

    const ceramic = mat({ color: "#FFF6E6", roughness: 0.55 });
    const concrete = mat({ color: "#E9E0CF", roughness: 0.9 });
    const ink = mat({ color: "#1E1F26", roughness: 0.75 });
    const P0 = PALETTES[0];

    // lectern (ink) with nine tactile buttons
    const lect = add(geo(slab(3.2, 1.96, BTN.topY, 0.5, 0.08)), ink);
    lect.position.set(0, 0, 1.0); this.solids.push(lect); lect.name = "lectern";
    const trayW = 3 * BTN.size + 2 * BTN.gap + 0.2;
    const tray = add(geo(slab(trayW, trayW, 0.03, 0.3, 0.012)), concrete, this.root, false);
    tray.position.set(0, BTN.topY, BTN_Z0);
    const btnGeo = geo(keycap(BTN.size, BTN.h, 0.06, 0.03, 0.02, 0.025, 0.06));
    // keycaps: two tones (lit, shade) with the world's lit threshold, and no received shadow,
    // so a neighbour's shadow-map edge never adds a third tone to a key
    const keyRamp = new THREE.DataTexture(new Uint8Array([175, 175, 175, 255, 175, 175, 175, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
    keyRamp.minFilter = keyRamp.magFilter = THREE.NearestFilter; keyRamp.needsUpdate = true; this.texs.push(keyRamp);
    this.btns = [];
    for (let i = 0; i < 9; i++) {
      const m = new THREE.MeshToonMaterial({ color: "#FFF6E6", gradientMap: keyRamp }); this.mats.push(m);
      const b = add(btnGeo, m); b.receiveShadow = false;
      this.btns.push({ mesh: b, mat: m, press: { x: 0, v: 0 }, on: { x: 0, v: 0 } });
      b.position.set(((i % 3) - 1) * BTN_PITCH, BTN.topY + 0.03, BTN_Z0 + (Math.floor(i / 3) - 1) * BTN_PITCH);
    }

    // plinth + turntable disc (static); the sculpture floats 10 cm above the disc and spins on TURN
    const plinth = add(geo(slab(4.6, 4.6, 1.1, 0.7, 0.08)), concrete);
    plinth.position.set(TURN.x, 0, TURN.z); this.solids.push(plinth); plinth.name = "plinth";
    const disc = add(geo(new THREE.CylinderGeometry(DISC_R, DISC_R + 0.1, 0.1, 56)), ceramic);
    disc.position.set(TURN.x, TURN.y - 0.05, TURN.z);
    this.turn = new THREE.Group(); this.turn.position.set(TURN.x, TURN.y, TURN.z); this.root.add(this.turn);
    this.sculpt = new THREE.Group(); this.sculpt.position.set(0, SCULPT_Y, 0); this.turn.add(this.sculpt);

    // ---- the hay.ag hero billboard: forest board on two pylons
    this.boardMat = this.panelMat = mat({ color: P0.bg, roughness: 0.65 });
    const board = add(geo(boxXY(POSTER.w, POSTER.h, POSTER.d, 0.45, 0.06)), this.panelMat);
    board.position.set(POSTER.x, POSTER.y, POSTER.z); this.solids.push(board); board.name = "board";
    const pylonGeo = geo(slab(0.9, 0.5, POSTER_BOX.minY - 0.005, 0.2, 0.05));
    for (const sx of [-PYLON_X, PYLON_X]) { const p = add(pylonGeo, concrete); p.position.set(sx, 0, POSTER.z); this.solids.push(p); p.name = "pylon"; }
    // flat graphics (logomark, wordmark, headline, body) on a transparent 2048 px canvas just in front of the board
    this.txtCanvas = document.createElement("canvas"); this.txtCanvas.width = BOARD_PX.w; this.txtCanvas.height = BOARD_PX.h;
    this.txtTex = new THREE.CanvasTexture(this.txtCanvas); this.txtTex.colorSpace = THREE.SRGBColorSpace; this.txtTex.anisotropy = 8; this.texs.push(this.txtTex);
    this.txtMat = new THREE.MeshBasicMaterial({ map: this.txtTex, transparent: true, depthWrite: false, toneMapped: false }); this.mats.push(this.txtMat);
    this.txtPlane = new THREE.Mesh(geo(new THREE.PlaneGeometry(POSTER.w, POSTER.h)), this.txtMat);
    this.txtPlane.position.set(POSTER.x, POSTER.y, Z_TEXT); this.root.add(this.txtPlane);
    // mint metaball slabs, proud of the board; they ripple when the mark is made
    this.slabMat = mat({ color: P0.p, roughness: 0.5 });
    this.slabs = [];
    for (const sh of SLAB_SHAPES) {
      const m = add(geo(polySlab(sh.pts, sh.r, SLAB_D, 0.05)), this.slabMat);
      m.position.set(POSTER.x, POSTER.y, Z_SLAB); m.name = "slab-" + sh.name;
      let cu = 0; for (const p of sh.pts) cu += p[0]; cu /= sh.pts.length;
      this.slabs.push({ mesh: m, u: cu }); this.solids.push(m);
    }
    // "Get Started" pill: its own slab + label, pulses when lit
    // unlit, like a printed button: under the low sunset a toon-lit mint goes murky and the label vanishes
    this.ctaMat = new THREE.MeshBasicMaterial({ color: P0.cta, toneMapped: false }); this.mats.push(this.ctaMat);
    this.cta = new THREE.Group(); this.cta.position.set(POSTER.x + CTA.u, POSTER.y + CTA.v, Z_SLAB); this.root.add(this.cta);
    const pill = add(geo(polySlab([[-CTA.w / 2, -CTA.h / 2], [CTA.w / 2, -CTA.h / 2], [CTA.w / 2, CTA.h / 2], [-CTA.w / 2, CTA.h / 2]], CTA.h / 2, CTA.d, 0.04)), this.ctaMat, this.cta);
    pill.name = "cta"; this.solids.push(pill);
    this.ctaCanvas = document.createElement("canvas"); this.ctaCanvas.width = 512; this.ctaCanvas.height = Math.round(512 * CTA.h / CTA.w);
    this.ctaTex = new THREE.CanvasTexture(this.ctaCanvas); this.ctaTex.colorSpace = THREE.SRGBColorSpace; this.ctaTex.anisotropy = 8; this.texs.push(this.ctaTex);
    const ctaTxMat = new THREE.MeshBasicMaterial({ map: this.ctaTex, transparent: true, depthWrite: false, toneMapped: false }); this.mats.push(ctaTxMat);
    const lab = new THREE.Mesh(geo(new THREE.PlaneGeometry(CTA.w, CTA.h)), ctaTxMat);
    lab.position.z = CTA.d + 0.003; this.cta.add(lab);

    // target preview card on the billboard face (dark tile, nothing touches the board or the sculpture)
    this.cardMat = mat({ color: "#1E1F26", roughness: 0.7, transparent: true, opacity: 0.95, depthWrite: false });
    this.card = add(geo(boxXY(CARD.size, CARD.h, 0.1, 0.4, 0.025)), this.cardMat, this.root, false);
    this.card.position.set(CARD.x, CARD.y, CARD.z + 0.05); this.card.renderOrder = 1;
    // GA2: cream bezel (a toon slab, so it is inked like every prop) and a GOAL / live-progress face
    this.bezelMat = mat({ color: "#FFF6E6", roughness: 0.6 });
    this.bezel = add(geo(boxXY(CARD.size + CARD.bezel * 2, CARD.h + CARD.bezel * 2, 0.07, 0.5, 0.02)), this.bezelMat, this.root, false);
    this.bezel.position.set(CARD.x, CARD.y, CARD.z + 0.035);
    this.cardCanvas = document.createElement("canvas"); this.cardCanvas.width = 480; this.cardCanvas.height = Math.round(480 * CARD.h / CARD.size);
    this.cardTex = new THREE.CanvasTexture(this.cardCanvas); this.cardTex.colorSpace = THREE.SRGBColorSpace; this.cardTex.anisotropy = 8; this.texs.push(this.cardTex);
    this.cardFaceMat = new THREE.MeshBasicMaterial({ map: this.cardTex, transparent: true, depthWrite: false, toneMapped: false }); this.mats.push(this.cardFaceMat);
    this.cardFace = new THREE.Mesh(geo(new THREE.PlaneGeometry(CARD.size, CARD.h)), this.cardFaceMat);
    this.cardFace.position.set(CARD.x, CARD.y, CARD.z + 0.1 + 0.005); this.cardFace.renderOrder = 1.5; this.root.add(this.cardFace);
    this.cardKey = "";
    this.ghostRoot = new THREE.Group();
    this.ghostRoot.position.set(CARD.x, CARD.y - CARD.markDy, CARD.z + 0.1 + 0.03 + 0.002); this.ghostRoot.scale.setScalar(CARD.scale);
    this.root.add(this.ghostRoot);

    this.liveMat = mat({ color: P0.p, roughness: 0.38 });
    this.ghostMat = mat({ color: "#FFF6E6", roughness: 0.5, transparent: true, opacity: 0.92, depthWrite: false });
    this.live = new Mark(this.sculpt, this.liveMat, { depth: CELL.d, bt: 0.06, shadow });
    this.ghost = new Mark(this.ghostRoot, this.ghostMat, { depth: 0.08, bt: 0.02 });
    this.ghost.mesh.renderOrder = 2;
    this.cursor = add(geo(boxXY(1.04, 1.04, 0.05, 0.34, 0.015, { w: 0.9, h: 0.9, r: 0.26 })),
      mat({ color: P0.p, roughness: 0.5, transparent: true, opacity: 0.85 }), this.sculpt, false);
    this.cursor.position.set(0, 0, CELL.d / 2 * MAX_SCALE + 0.04); this.cursor.visible = false;
    this.cursorS = { x: 0, v: 0 }; this.cursorCell = -1;

    // state
    this.liveP = new Array(9).fill(0);
    this.markIdx = 0;
    this.target = PATTERNS.hay.slice();
    this.palIdx = 0; this.free = false; this.matched = false;
    this.ghostOp = GHOST_ON; this.ghostOpT = GHOST_ON;
    const C = (h) => new THREE.Color(h);
    this.cur = { bg: C(P0.bg), p: C(P0.p), cta: C(P0.cta), head: C(P0.head) };
    this.tgt = { bg: C(P0.bg), p: C(P0.p), cta: C(P0.cta), head: C(P0.head) };
    this.paper = C("#FFF6E6"); this._c = new THREE.Color();
    this.lit = 0; this.gleam = 0;
    this.txt = { op: 1, dirty: false };
    this.yaw = 0; this.yawV = 0; this.yawGoal = undefined; this.dragging = false; this.dragX = 0; this.spinning = false;
    this.focused = false; this.busy = true; this.kick = 0; this.t = 0; this.disposed = false;
    this._inv = new THREE.Matrix4(); this._ray = new THREE.Ray(); this._hit = new THREE.Vector3();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(BTN.topY + BTN.h));

    // draw now with fallback fonts, redraw crisply once the web fonts arrive
    this.redrawFlat();
    this._onFonts = () => { if (!this.disposed) { this.redrawFlat(); this.busy = true; } };
    const fonts = typeof document !== "undefined" ? document.fonts : null;
    if (fonts && fonts.load) {
      Promise.all([fonts.load('700 100px "Bricolage Grotesque"'), fonts.load('400 40px "Instrument Sans"'), fonts.load('500 40px "Instrument Sans"'), fonts.load('600 40px "Instrument Sans"')])
        .then(this._onFonts).catch(() => {});
      if (fonts.ready && fonts.ready.then) fonts.ready.then(this._onFonts).catch(() => {});
      if (fonts.addEventListener) fonts.addEventListener("loadingdone", this._onFonts);
    }
  }

  redrawFlat() {
    const p = PALETTES[this.palIdx];
    drawBillboard(this.txtCanvas.getContext("2d"), this.txtCanvas.width, this.txtCanvas.height, p);
    this.txtTex.needsUpdate = true;
    drawCta(this.ctaCanvas.getContext("2d"), this.ctaCanvas.width, this.ctaCanvas.height, p);
    this.ctaTex.needsUpdate = true;
    this.cardKey = ""; this.redrawCard();
  }

  /* GA2: GOAL title over the mark, and a pip per target square under it: filled = right, hollow = still to do,
     coral = an extra square that is not in the mark. It redraws only when the counts change. */
  redrawCard() {
    const pr = progress(this.liveP, this.target), done = this.matched;
    const key = [pr.hit, pr.total, pr.extra, done ? 1 : 0, this.palIdx].join("|");
    if (key === this.cardKey) return;
    this.cardKey = key;
    const c = this.cardCanvas, g = c.getContext("2d"), W = c.width, H = c.height, P = PALETTES[this.palIdx];
    g.clearRect(0, 0, W, H);
    g.textBaseline = "alphabetic";
    g.textAlign = "left"; g.fillStyle = "#FFF6E6"; g.font = '700 84px "Bricolage Grotesque", sans-serif';
    g.fillText(done ? "MADE IT" : "GOAL", 36, 100);
    g.textAlign = "right"; g.font = '700 66px "Bricolage Grotesque", sans-serif';
    g.fillStyle = done ? P.p : "#FFF6E6"; g.fillText(`${pr.hit}/${pr.total}`, W - 36, 98);
    if (pr.extra) { g.fillStyle = "#FF7A62"; g.font = '700 34px "Bricolage Grotesque", sans-serif'; g.fillText(`+${pr.extra} extra`, W - 36, 134); }
    // one pip per square of the mark: filled = right, hollow = still to do
    const n = pr.total, r = 10, gap = 9, y = 150;
    for (let i = 0; i < n; i++) {
      const x = 36 + r + i * (2 * r + gap);
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
      if (i < pr.hit) { g.fillStyle = P.p; g.fill(); }
      g.lineWidth = 4; g.strokeStyle = i < pr.hit ? P.p : "#FFF6E6"; g.stroke();
    }
    this.cardTex.needsUpdate = true;
  }

  enter() {
    this.focused = true; this.busy = true;
    this.bindKeys();
    this.pushStatus();
    this.pushTools();
    // billboard fills the frame; the button lectern (z 0..2) stays above the focus bar
    return { pos: new THREE.Vector3(...CAM.pos), look: new THREE.Vector3(...CAM.look) };
  }
  exit() { this.focused = false; this.dragging = false; this.cursorCell = -1; this.padMode = false; this.padA = false; this.unbindKeys(); }

  /* B4 gamepad: input.js turns the D-pad into arrow key events (and B into Escape, which main.js uses to leave), so the
     cell cursor rides those keys; Enter/Space/E also mark, for a keyboard. A sends no key while a game is open, so the
     game reads pad button 0 itself in update() (edge-triggered). Any pointer event hands the cursor back to the pointer. */
  bindKeys() {
    if (this._onKey || typeof addEventListener === "undefined") return;
    this.padCell = this.padCell >= 0 ? this.padCell : 4;
    this._onKey = (e) => {
      if (!this.focused || e.repeat && /^(enter| |e)$/i.test(e.key)) return;
      if (e.target && e.target.closest && e.target.closest("input, textarea, button, a")) return;
      const k = e.key, d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
      if (d) {
        if (!this.padMode) { this.padMode = true; this.busy = true; return; }     // first press just shows the cursor
        const c = Math.max(0, Math.min(2, (this.padCell % 3) + d[0])), r = Math.max(0, Math.min(2, Math.floor(this.padCell / 3) + d[1]));
        this.padCell = r * 3 + c; this.busy = true;
      } else if (k === "Enter" || k === " " || k === "e" || k === "E") {
        if (!this.padMode) { this.padMode = true; this.busy = true; return; }
        this.toggle(this.padCell); this.busy = true;
      }
    };
    addEventListener("keydown", this._onKey);
  }
  unbindKeys() {
    if (this._onKey && typeof removeEventListener !== "undefined") removeEventListener("keydown", this._onKey);
    this._onKey = null;
  }
  padPoll() {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return;
    let down = false;
    try { for (const p of navigator.getGamepads() || []) if (p && p.connected && p.buttons && p.buttons[0] && (p.buttons[0].pressed || p.buttons[0].value > 0.5)) down = true; } catch (e) { return; }
    if (down && !this.padA) {
      this.padA = true;
      if (!this.padMode) { this.padMode = true; this.busy = true; } else this.toggle(this.padCell);
    } else if (!down) this.padA = false;
  }

  pushTools() {
    this.ctx.ui.tools(this.free ? [{ label: "New mark", onClick: () => this.newMark() }] : []);
  }
  pushStatus() {
    if (this.free && this.matched) { this.ctx.ui.status(`${PALETTES[this.palIdx].name} mark made · drag the sculpture to spin it`); return; }
    const p = progress(this.liveP, this.target);
    const extra = p.extra ? `, ${p.extra} extra` : "";
    const lead = this.markIdx === 0 ? "Make the hay.ag mark" : "Match the mark";
    this.ctx.ui.status(`${lead} · tap the squares (${p.hit} / ${p.total} right${extra})`);
  }

  setPalette(i, instant) {
    this.palIdx = i;
    const P = PALETTES[i];
    this.tgt.bg.set(P.bg); this.tgt.p.set(P.p); this.tgt.cta.set(P.cta); this.tgt.head.set(P.head);
    if (instant) { for (const k of Object.keys(this.cur)) this.cur[k].copy(this.tgt[k]); this.redrawFlat(); }
    else this.txt.dirty = true;     // flat graphics cross-fade to the new identity
  }

  newMark() {
    const m = nextMark(++this.markIdx);
    this.target = m.pattern;
    this.setPalette(m.palette, false);
    this.matched = false; this.ghostOpT = GHOST_ON;
    this.yawGoal = Math.round(this.yaw / (Math.PI * 2)) * Math.PI * 2; this.spinning = false;
    this.busy = true; this.pushStatus();
  }

  /* ------------------------------------------------------------ pointer */
  cellAt(e) {
    this.ctx.group.updateWorldMatrix(true, false);
    this._inv.copy(this.ctx.group.matrixWorld).invert();
    this._ray.copy(e.ray).applyMatrix4(this._inv);
    const p = this._ray.intersectPlane(this._plane, this._hit);
    if (!p) return -1;
    const c = Math.round(p.x / BTN_PITCH) + 1, r = Math.round((p.z - BTN_Z0) / BTN_PITCH) + 1;
    if (c < 0 || c > 2 || r < 0 || r > 2) return -1;
    const half = BTN.size / 2 + BTN.gap / 2;
    if (Math.abs(p.x - (c - 1) * BTN_PITCH) > half || Math.abs(p.z - (BTN_Z0 + (r - 1) * BTN_PITCH)) > half) return -1;
    return r * 3 + c;
  }

  pointer(e) {
    if (this.padMode) { this.padMode = false; this.cursorCell = -1; }
    if (e.type === "down") {
      const i = this.cellAt(e);
      if (i >= 0) { this.toggle(i); this.cursorCell = i; }
      else if (this.free) { this.dragging = true; this.dragX = e.ndc.x; this.yawV = 0; this.spinning = true; }
    } else if (e.type === "move") {
      if (this.dragging && e.down) {
        const dx = e.ndc.x - this.dragX; this.dragX = e.ndc.x;
        this.yaw += dx * 4.2; this.yawV = dx * 4.2 * 60;
      } else {
        if (this.dragging) this.dragging = false;
        if (!e.down) this.cursorCell = this.cellAt(e);
      }
    } else if (e.type === "up") {
      this.dragging = false;
      this.cursorCell = -1;
    }
    this.busy = true;
  }

  toggle(i) {
    this.liveP[i] = this.liveP[i] ? 0 : 1;
    const b = this.btns[i]; b.press.v -= 2.6;
    if (this.free) this.matched = false;
    const ok = matches(this.liveP, this.target);
    if (ok && !this.matched) {
      this.matched = true; this.kick = 7; this.ghostOpT = 0;
      this.lit = 1; this.gleam = 1;                      // billboard lights up, sculpture gleams
      if (!this.free) {
        this.free = true;
        this.pushTools();
        this.ctx.solved();
      } else {
        this.ctx.ui.toast("Mark made. Designer approved. Probably.");
      }
    }
    this.pushStatus();
  }

  /* ------------------------------------------------------------- update */
  update(dt, t, focused) {
    dt = Math.min(dt, 0.05);
    this.t = t;
    if (!focused && !this.busy) return;
    if (focused) { this.padPoll(); if (this.padMode) this.cursorCell = this.padCell; }
    let moving = false;
    const kick = this.kick; this.kick = 0;
    if (this.live.step(this.liveP, dt, kick)) moving = true;
    if (this.ghost.step(this.target, dt, 0)) moving = true;

    // palette easing (board, slabs, sculpture, pill)
    const e = 1 - Math.exp(-5 * dt);
    let dsum = 0;
    for (const k of Object.keys(this.cur)) {
      const a = this.cur[k], b = this.tgt[k];
      a.lerp(b, e); dsum += Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
    }
    if (dsum > 0.004) moving = true;
    // flat graphics: fade out, redraw in the new palette, fade back in
    if (this.txt.dirty) {
      this.txt.op = Math.max(0, this.txt.op - dt * 6);
      if (this.txt.op <= 0) { this.redrawFlat(); this.txt.dirty = false; }
      moving = true;
    } else if (this.txt.op < 1) { this.txt.op = Math.min(1, this.txt.op + dt * 4); moving = true; }
    this.txtMat.opacity = this.txt.op;

    // lit billboard: slabs ripple and warm toward the headline colour, the pill pulses, the sculpture gleams
    this.lit = Math.max(0, this.lit - dt * 0.4); this.gleam = Math.max(0, this.gleam - dt * 0.7);
    const L = this.lit, ease = L * L * (3 - 2 * L);
    this.boardMat.color.copy(this.cur.bg);
    this.slabMat.color.copy(this.cur.p).lerp(this.cur.head, ease * 0.45);
    this.ctaMat.color.copy(this.cur.cta).lerp(this.cur.head, ease * (0.5 + 0.5 * Math.sin(t * 12)) * 0.5);
    for (const s of this.slabs) s.mesh.position.z = Z_SLAB + ease * 0.16 * (0.5 + 0.5 * Math.sin(t * 7 - s.u * 1.4));
    this.cta.scale.setScalar(1 + (L > 0.002 ? 0.07 * ease * (0.5 + 0.5 * Math.sin(t * 12)) : 0));
    this.liveMat.color.copy(this.cur.p).lerp(this.cur.head, Math.min(1, this.gleam * 0.85));
    this.cursor.material.color.copy(this.cur.p);
    if (L > 0.002 || this.gleam > 0.002) moving = true;
    // ghost fade
    this.ghostOp += (this.ghostOpT - this.ghostOp) * (1 - Math.exp(-4 * dt));
    this.ghostMat.opacity = this.ghostOp; this.cardMat.opacity = Math.min(0.95, this.ghostOp);
    this.card.visible = this.ghostOp > 0.004;
    this.bezel.visible = this.card.visible && this.ghostOpT > 0.5; this.cardFace.visible = this.card.visible;
    for (const sl of this.slabs) if (sl.mesh.name === "slab-corner") sl.mesh.visible = !(this.card.visible && this.ghostOpT > 0.5);   // GA2: the corner slab steps aside while the goal card is up
    this.cardFaceMat.opacity = Math.min(1, this.ghostOp / GHOST_ON);
    this.redrawCard();
    if (Math.abs(this.ghostOp - this.ghostOpT) > 0.002) moving = true;
    const gv = this.ghostOp > 0.004;
    this.ghost.mesh.visible = !!this.ghost.has && gv;

    // buttons
    for (let i = 0; i < 9; i++) {
      const b = this.btns[i];
      springStep(b.press, i === this.cursorCell ? -0.35 : 0, dt, 220, 18);
      springStep(b.on, this.liveP[i], dt, 160, 20);
      b.mesh.position.y = BTN.topY + 0.03 + Math.max(-0.6, Math.min(0.3, b.press.x)) * 0.05;
      b.mat.color.copy(this.paper).lerp(this.cur.p, Math.max(0, Math.min(1, b.on.x)));
      if (Math.abs(b.press.x) > 0.002 || Math.abs(b.press.v) > 0.02 || Math.abs(b.on.x - this.liveP[i]) > 0.002) moving = true;
    }

    // hover cursor on the live mark (follows hovered / last tapped cell)
    const cs = this.cursorS;
    springStep(cs, this.cursorCell >= 0 && Math.abs(this.yaw) < 0.2 ? 1 : 0, dt, 200, 20);
    if (this.cursorCell >= 0) this.cursor.position.set(((this.cursorCell % 3) - 1) * PITCH, (1 - Math.floor(this.cursorCell / 3)) * PITCH, CELL.d / 2 * MAX_SCALE + 0.04);
    this.cursor.visible = cs.x > 0.01; this.cursor.scale.setScalar(Math.max(0.0001, cs.x));
    if (Math.abs(cs.x) > 0.01 || Math.abs(cs.v) > 0.05 || this.cursorCell >= 0) moving = true;

    // turn: unsolved sculpture stays front-on; solved one spins with inertia
    if (!this.free) { this.yaw += (0 - this.yaw) * (1 - Math.exp(-6 * dt)); this.yawV = 0; }
    else if (!this.dragging) {
      if (this.yawGoal !== undefined && !this.spinning) {
        this.yaw += (this.yawGoal - this.yaw) * (1 - Math.exp(-4 * dt));
        if (Math.abs(this.yawGoal - this.yaw) < 0.002) { this.yaw = this.yawGoal; this.yawGoal = undefined; }
      } else {
        this.yaw += this.yawV * dt; this.yawV *= Math.exp(-2.2 * dt);
        if (Math.abs(this.yawV) < 0.01) this.spinning = false;
      }
      if (this.yawGoal !== undefined || Math.abs(this.yawV) > 0.01) moving = true;
    } else moving = true;
    this.turn.rotation.y = this.yaw;
    // gentle idle float of the sculpture
    this.sculpt.position.y = SCULPT_Y + BOB * (0.5 + 0.5 * Math.sin(t * 1.2));
    this.busy = moving || focused;
  }

  dispose() {
    this.disposed = true; this.unbindKeys();
    const fonts = typeof document !== "undefined" ? document.fonts : null;
    if (fonts && fonts.removeEventListener) fonts.removeEventListener("loadingdone", this._onFonts);
    this.ctx.ui.tools([]); this.ctx.ui.status(null);
    this.ctx.group.remove(this.root);
    this.live.dispose(); this.ghost.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const t of this.texs) t.dispose();
    this.geos.length = this.mats.length = this.texs.length = 0;
  }
}
