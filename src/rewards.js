import { fontsReady } from "./signs.js";
import { PROJECTS } from "./projects.js";

/* R7 T8: takeaways.
   - Wallpapers (phone + desktop): unlocked by finding every butterfly. The user's own art, served as static files (takeShot below).
   - Printable Blip: unlocked by everything (all projects, all butterflies, all five stars). A static watertight 70 mm STL + 3MF of the in-game Blip in his wave pose, standing on his feet (blender/blip_print.py).
   - WhatsApp DP badges (640x640, circle-safe, subject inside 80% of the circle): one per milestone, drawn on a canvas in the house cel look
     (two tones per shape, ink outline).
   Runtime DOM only: nothing here edits ui.js, index.html or styles.css. Classes are .r7-reward-*; the panel is an .r7-modal. */

const INK = "#1E1F26";
const KEY = "archipelago.rewards.v1";          // cleared by the restart (prefix archipelago.)
const STL_URL = "assets/rewards/blip.stl", MF_URL = "assets/rewards/blip.3mf", STL_PREVIEW = "assets/rewards/blip-preview.png";
const WALLS = { phone: { label: "Phone", r: 9 / 16 }, desktop: { label: "Desktop", r: 16 / 9 } };
const BADGE_PX = 640, SAFE_R = BADGE_PX / 2 * 0.8;   // the subject sits inside 80% of the circle: radius 256

/* ---- the milestones. Each: one badge. `test` reads live state. */
const MILESTONES = [
  { id: "first", title: "First find", hint: "Discover your first project.", bg: ["#FFC845", "#E39B1B"] },
  { id: "butterflies", title: "Butterfly collector", hint: "Find every butterfly.", bg: ["#B9A2F2", "#8E78D6"] },
  { id: "moon", title: "Moon visitor", hint: "Get yourself fired at the moon.", bg: ["#3B3E8F", "#25276A"] },
  { id: "secrets", title: "Secret keeper", hint: "Find all three secrets.", bg: ["#7ED6B2", "#3FA283"] },
  { id: "everything", title: "The whole planet", hint: "Every project, butterfly and star.", bg: ["#FF9AA8", "#D9606F"] },
];

/* =================================================================== drawing: the house cel look */
function circ(x, y, r) { const p = new Path2D(); p.arc(x, y, r, 0, Math.PI * 2); return p; }
function ell(x, y, rx, ry, rot = 0) { const p = new Path2D(); p.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); return p; }
function rrect(x, y, w, h, r) { const p = new Path2D(); p.roundRect(x, y, w, h, r); return p; }
/* a shape in exactly two tones (lit, shade: the shade is the lower-right crescent) plus the ink outline */
function cel(ctx, path, lit, shade, { off = 14, lw = 9 } = {}) {
  ctx.save(); ctx.fillStyle = shade; ctx.fill(path); ctx.clip(path);
  ctx.translate(-off, -off * 0.8); ctx.fillStyle = lit; ctx.fill(path); ctx.restore();
  ctx.save(); ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.lineWidth = lw; ctx.strokeStyle = INK; ctx.stroke(path); ctx.restore();
}
function inkLine(ctx, pts, color, w) {
  ctx.save(); ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.strokeStyle = INK; ctx.lineWidth = w + 9; ctx.stroke(); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke(); ctx.restore();
}
function star4(x, y, r, color = "#FFFDF6") {
  const p = new Path2D(); for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + i * Math.PI / 4, k = i % 2 ? r * 0.36 : r; i ? p.lineTo(x + Math.cos(a) * k, y + Math.sin(a) * k) : p.moveTo(x + Math.cos(a) * k, y + Math.sin(a) * k); }
  p.closePath(); return p;
}
function star5(x, y, r) {
  const p = new Path2D(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, k = i % 2 ? r * 0.45 : r; i ? p.lineTo(x + Math.cos(a) * k, y + Math.sin(a) * k) : p.moveTo(x + Math.cos(a) * k, y + Math.sin(a) * k); }
  p.closePath(); return p;
}
/* the field behind a badge: lit tone, with a curved planet horizon in the shade tone (two tones) */
function badgeField(ctx, [lit, shade]) {
  ctx.fillStyle = lit; ctx.fillRect(0, 0, BADGE_PX, BADGE_PX);
  const h = circ(320, 1060, 560); ctx.fillStyle = shade; ctx.fill(h); ctx.save(); ctx.lineWidth = 8; ctx.strokeStyle = INK; ctx.stroke(h); ctx.restore();
}

/* butterfly: the SAME wing outline as life.js (ShapeGeometry), mirrored for the other wing */
function butterfly(ctx, cx, cy, S, lit, shade, lw = 9) {
  const wing = sign => {
    const P = (x, y) => [cx + sign * x * S, cy - y * S], p = new Path2D(), a = P(0, 0), b1 = P(0.25, 0.3), b2 = P(0.45, 0.12), b3 = P(0.38, -0.05), c1 = P(0.42, -0.25), c2 = P(0.15, -0.3), c3 = P(0, -0.06);
    p.moveTo(...a); p.bezierCurveTo(...b1, ...b2, ...b3); p.bezierCurveTo(...c1, ...c2, ...c3); p.closePath(); return p;
  };
  cel(ctx, wing(-1), lit, shade, { off: S * 0.03, lw }); cel(ctx, wing(1), lit, shade, { off: S * 0.03, lw });
  cel(ctx, ell(cx, cy - S * 0.06, S * 0.032, S * 0.16), "#3A3552", "#24213A", { off: 3, lw: lw * 0.8 });
  inkLine(ctx, [[cx, cy - S * 0.2], [cx - S * 0.07, cy - S * 0.33]], "#3A3552", 4); inkLine(ctx, [[cx, cy - S * 0.2], [cx + S * 0.07, cy - S * 0.33]], "#3A3552", 4);
}

/* Blip from the front (toy.glb: a teal rounded box, one big eye under a brow, flippers, two antennae), drawn flat in two tones */
function blip(ctx, cx, cy, k = 1) {
  ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k);
  const T = ["#3FA7A3", "#2E8C88"], D = ["#2E8C88", "#1F6E6A"];
  cel(ctx, ell(-62, 150, 52, 28), ...D, { off: 6 }); cel(ctx, ell(62, 150, 52, 28), ...D, { off: 6 });
  cel(ctx, ell(-142, 30, 26, 74, 0.22), ...D, { off: 6 }); cel(ctx, ell(142, 30, 26, 74, -0.22), ...D, { off: 6 });
  // antennae: the coral three-sprout and the yellow stalk
  inkLine(ctx, [[-40, -88], [-50, -140]], "#FF6F59", 9); inkLine(ctx, [[-50, -140], [-88, -178]], "#FF6F59", 7); inkLine(ctx, [[-50, -140], [-50, -190]], "#FF6F59", 7); inkLine(ctx, [[-50, -140], [-12, -178]], "#FF6F59", 7);
  for (const [x, y] of [[-88, -184], [-50, -198], [-12, -184]]) cel(ctx, circ(x, y, 17), "#FF6F59", "#C94B38", { off: 4, lw: 7 });
  inkLine(ctx, [[46, -88], [52, -140], [78, -168]], "#FFC845", 9); cel(ctx, circ(84, -176, 20), "#FFC845", "#D9A11F", { off: 4, lw: 7 });
  cel(ctx, rrect(-128, -98, 256, 240, 84), ...T, { off: 18 });
  cel(ctx, circ(0, -6, 82), "#F6F2E8", "#CBC4B2", { off: 10, lw: 8 });
  ctx.save(); ctx.beginPath(); ctx.arc(0, -6, 96, Math.PI * 1.12, Math.PI * 1.88); ctx.strokeStyle = INK; ctx.lineWidth = 24; ctx.lineCap = "round"; ctx.stroke(); ctx.strokeStyle = D[0]; ctx.lineWidth = 12; ctx.stroke(); ctx.restore();
  cel(ctx, circ(8, 0, 38), "#2A2B33", "#16171A", { off: 5, lw: 6 });
  ctx.fillStyle = "#FFFFFF"; ctx.beginPath(); ctx.arc(-2, -12, 8, 0, 7); ctx.fill();
  ctx.restore();
}

/* subjects: every one is centred on (320,320); the badge test measures the radius they actually reach */
const SUBJECTS = {
  first(ctx) {
    cel(ctx, circ(320, 316, 168), "#6A6AFF", "#3030C8", { off: 20, lw: 12 });
    ctx.save(); ctx.lineWidth = 6; ctx.strokeStyle = "#F6EFE4"; ctx.stroke(circ(320, 316, 138)); ctx.restore();
    const eye = new Path2D(); eye.moveTo(214, 316); eye.bezierCurveTo(262, 238, 378, 238, 426, 316); eye.bezierCurveTo(378, 394, 262, 394, 214, 316); eye.closePath();
    cel(ctx, eye, "#F6F2E8", "#CBC4B2", { off: 8, lw: 9 }); cel(ctx, circ(320, 316, 36), "#2A2B33", "#16171A", { off: 5, lw: 6 });
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(309, 304, 8, 0, 7); ctx.fill();
    cel(ctx, star4(448, 196, 26), "#FFFDF6", "#E5DEC9", { off: 3, lw: 6 });
  },
  butterflies(ctx) {
    butterfly(ctx, 320, 330, 470, "#FFC845", "#E39B1B", 10);
    butterfly(ctx, 168, 168, 130, "#FF8FA3", "#D9607A", 7); butterfly(ctx, 478, 470, 120, "#7ED6B2", "#3FA283", 7);
  },
  moon(ctx) {
    cel(ctx, circ(320, 330, 168), "#F6EFE4", "#CFC4B2", { off: 22, lw: 12 });
    cel(ctx, ell(262, 292, 32, 28), "#E4DAC8", "#BDB19C", { off: 5, lw: 7 }); cel(ctx, ell(372, 350, 40, 34), "#E4DAC8", "#BDB19C", { off: 6, lw: 7 });
    cel(ctx, ell(300, 402, 20, 17), "#E4DAC8", "#BDB19C", { off: 4, lw: 6 });
    inkLine(ctx, [[400, 232], [400, 98]], "#F6EFE4", 8); cel(ctx, (() => { const p = new Path2D(); p.moveTo(404, 100); p.lineTo(488, 122); p.lineTo(404, 150); p.closePath(); return p; })(), "#FF6F59", "#C94B38", { off: 4, lw: 7 });
    cel(ctx, star4(168, 168, 24), "#FFFDF6", "#E5DEC9", { off: 3, lw: 6 }); cel(ctx, star4(142, 380, 18), "#FFFDF6", "#E5DEC9", { off: 3, lw: 5 });
  },
  secrets(ctx) {
    cel(ctx, circ(320, 322, 164), "#FFC845", "#E39B1B", { off: 20, lw: 12 });
    const kh = new Path2D(); kh.arc(320, 296, 38, 0, Math.PI * 2); kh.moveTo(296, 322); kh.lineTo(344, 322); kh.lineTo(364, 420); kh.lineTo(276, 420); kh.closePath();
    ctx.fillStyle = INK; ctx.fill(kh);
    cel(ctx, star4(160, 150, 28), "#FFFDF6", "#E5DEC9", { off: 3, lw: 6 }); cel(ctx, star4(488, 480, 24), "#FFFDF6", "#E5DEC9", { off: 3, lw: 6 }); cel(ctx, star4(500, 168, 18), "#FFFDF6", "#E5DEC9", { off: 3, lw: 5 });
  },
  everything(ctx) {
    blip(ctx, 320, 338, 0.9);
    for (const [x, y] of [[132, 176], [508, 176], [96, 330], [544, 330]]) cel(ctx, star5(x, y, 26), "#FFC845", "#D9A11F", { off: 3, lw: 6 });
  },
};

/* per-subject fit [scale, dx, dy]: measured so the drawn pixels stay inside the 80% circle (radius 256) and sit on the centre */
const FIT = { first: [1.15, 0, 4], butterflies: [0.9, 0, 10], moon: [0.93, 12, 25], secrets: [0.95, -4, 7], everything: [0.93, 0, 0] };

/* a badge canvas. opts.bare = the field only (the test diffs it against the full badge to measure the subject) */
export async function renderBadge(id, opts = {}) {
  await fontsReady;
  const m = MILESTONES.find(x => x.id === id), c = document.createElement("canvas"); c.width = c.height = BADGE_PX;
  const ctx = c.getContext("2d"); badgeField(ctx, m.bg);
  if (!opts.bare) { const [k, dx, dy] = FIT[id]; ctx.save(); ctx.translate(320 + dx, 320 + dy); ctx.scale(k, k); ctx.translate(-320, -320); SUBJECTS[id](ctx); ctx.restore(); }
  return c;
}

/* ---- wordmark: blue face, #181894 extrusion, ink around both (the intro headline's recipe, on a canvas) */
function wordmark(ctx, text, x, y, size, align = "center") {
  ctx.save(); ctx.font = `800 ${size}px "Bricolage Grotesque", system-ui, sans-serif`; ctx.textAlign = align; ctx.textBaseline = "alphabetic"; ctx.lineJoin = "round";
  const e = Math.round(size * 0.07);
  ctx.strokeStyle = INK; ctx.lineWidth = size * 0.1;
  for (let i = e; i >= 1; i--) { ctx.fillStyle = "#181894"; ctx.strokeText(text, x + i, y + i); }
  ctx.strokeText(text, x, y);
  for (let i = e; i >= 1; i--) ctx.fillText(text, x + i, y + i);
  ctx.fillStyle = "#3B3BF2"; ctx.fillText(text, x, y); ctx.restore();
}

export function installRewards({ ui, sfx, scene, camera, renderer, butterflies, player, bodies, slate, getMoonPlay }) {
  const $ = id => document.getElementById(id);
  /* ---------------------------------------------------------------- state (own key; restart clears it with the rest of archipelago.*) */
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  let st = read(); st.flags = st.flags || {}; st.unlocked = st.unlocked || [];
  const write = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* optional */ } };
  const has = id => st.unlocked.includes(id);
  const total = () => butterflies && butterflies.total || 0;

  const REWARDS = [
    { id: "wallpapers", title: "Wallpapers", ok: () => !!st.flags.butterflies, toast: "Wallpapers unlocked. Your phone is about to get better taste." },
    { id: "print", title: "Printable Blip", ok: () => !!(st.flags.butterflies && st.flags.stars && ui.found.size >= PROJECTS.length), toast: "Everything found. Blip is yours to print." },
    ...MILESTONES.map(m => ({ id: "badge-" + m.id, title: m.title, ok: () => ({
      first: () => ui.found.size >= 1, butterflies: () => !!st.flags.butterflies, moon: () => !!st.flags.moon,
      secrets: () => ui.secrets.size >= 3, everything: () => !!(st.flags.butterflies && st.flags.stars && ui.found.size >= PROJECTS.length),
    })[m.id](), toast: `Badge unlocked · ${m.title}` })),
  ];

  /* ---------------------------------------------------------------- unlock toasts: one at a time, after any toast or slate that is up */
  const queue = []; let pumping = false;
  const pump = () => {
    if (pumping) return; pumping = true;
    const tick = () => {
      if (!queue.length) { pumping = false; return; }
      const el = $("toast"), busy = (slate && slate.active) || (el && el.classList.contains("show")) || document.body.classList.contains("is-loading");
      if (busy) return setTimeout(tick, 500);
      ui.toast(queue.shift(), 3600); setTimeout(tick, 4000);
    };
    setTimeout(tick, 600);
  };
  function unlock(id, { silent = false } = {}) {
    if (has(id)) return false;
    st.unlocked.push(id); write(); refreshMenu();
    const r = REWARDS.find(x => x.id === id);
    if (r && !silent) { try { sfx.play("star"); } catch { /* sound is optional */ } queue.push(`${r.toast} <b>Menu › Rewards</b>`); pump(); }
    if (panel && !panel.hidden) renderPanel();
    return true;
  }
  /* the reward gates: idempotent, safe to call often. Nothing unlocks before the intro is gone (a returning visitor's saved progress
     would otherwise toast over the loading screen). */
  function evaluate() {
    const intro = $("intro"); if (intro && !intro.classList.contains("gone")) return;
    try {
      if (!st.flags.moon && player && bodies && player.body === bodies.moon) { st.flags.moon = true; write(); }
      const mp = getMoonPlay && getMoonPlay(); if (!st.flags.stars && mp && mp.complete) { st.flags.stars = true; write(); }
    } catch { /* poll again */ }
    for (const r of REWARDS) if (!has(r.id) && r.ok()) unlock(r.id);
  }

  /* hooks: chain, never replace (T6 owns the butterflies.onAll line, T1 the ui.onSecret line) */
  if (butterflies) { const prev = butterflies.onAll; butterflies.onAll = n => { if (prev) prev(n); st.flags.butterflies = true; write(); setTimeout(evaluate, 0); }; }
  { const prev = ui.discover.bind(ui); ui.discover = (...a) => { const r = prev(...a); if (r) setTimeout(evaluate, 0); return r; }; }
  { const prev = ui.findSecret.bind(ui); ui.findSecret = (...a) => { const r = prev(...a); if (r) setTimeout(evaluate, 0); return r; }; }
  setInterval(evaluate, 700);

  /* ---------------------------------------------------------------- downloads (client-side) */
  const save = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  const toBlob = c => new Promise(res => c.toBlob(res, "image/png"));
  const shots = {};   // kind -> { blob, url }
  /* R7: the wallpapers are the user's own art (made outside the game), served as static files:
     web/assets/rewards/wallpaper-phone.(png|jpg) and wallpaper-desktop.(png|jpg). */
  const WALL_DIR = new URL("../assets/rewards/", import.meta.url);
  async function takeShot(kind) {
    for (const ext of ["jpg", "png", "jpeg", "webp"]) {
      try {
        const res = await fetch(new URL(`wallpaper-${kind}.${ext}`, WALL_DIR), { cache: "no-store" });
        if (!res.ok) continue;
        const blob = await res.blob();
        if (shots[kind]) URL.revokeObjectURL(shots[kind].url);
        let dim = "", w = 0, h = 0;   // the label and the frame follow the file's real size, whatever the user drops in
        try { const bm = await createImageBitmap(blob); w = bm.width; h = bm.height; dim = `${w} × ${h}`; bm.close(); } catch {}
        shots[kind] = { blob, ext, dim, w, h, url: URL.createObjectURL(blob) }; return shots[kind];
      } catch {}
    }
    shots[kind] = { missing: true }; return shots[kind];
  }
  const badgeBlobs = {};
  async function badgeBlob(id) { return badgeBlobs[id] || (badgeBlobs[id] = await toBlob(await renderBadge(id))); }
  async function downloadStl(mf) { const res = await fetch(mf ? MF_URL : STL_URL); save(await res.blob(), mf ? "small-planet-blip-70mm.3mf" : "small-planet-blip-70mm.stl"); }

  /* ---------------------------------------------------------------- the panel (.r7-modal) */
  const css = document.createElement("style"); css.id = "r7-reward-style";
  css.textContent = `
.r7-reward-modal{position:fixed;inset:0;z-index:36;display:grid;place-items:center;padding:var(--gut,20px);background:rgba(228,229,224,.55);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.r7-reward-card{position:relative;width:min(780px,100%);max-height:100%;overflow:auto;border-radius:var(--r,18px);background:var(--paper-2,#EDEEEA);box-shadow:var(--shadow);padding:26px 26px 30px}
.r7-reward-card h2{margin:0;font:700 34px/1 var(--f-display);letter-spacing:-.03em}
.r7-reward-sub{margin:8px 44px 0 0;font-size:14.5px;line-height:1.5;color:var(--ink-soft,#6E706C)}
.r7-reward-card h3{margin:26px 0 10px;font:700 20px/1.1 var(--f-display);letter-spacing:-.02em}
.r7-reward-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.r7-reward-item{display:flex;flex-direction:column;gap:10px;align-items:flex-start}
.r7-reward-thumb{width:100%;height:210px;display:grid;place-items:center;border:3px solid var(--ink);border-radius:14px;background:#FFFDF6;box-shadow:3px 4px 0 var(--ink);overflow:hidden}
.r7-reward-thumb{position:relative}
.r7-reward-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block}
.r7-reward-thumb.r7-fit{height:auto;background:none;box-sizing:content-box;width:auto;align-self:stretch}
.r7-reward-thumb.r7-fit.r7-reward-blip{align-self:flex-start;width:min(234px,calc(100% - 6px))}
.r7-reward-thumb.r7-fit img{object-fit:cover}
.r7-reward-walls{display:flex;gap:16px;align-items:flex-start}
.r7-reward-walls>.r7-reward-item{min-width:0}
.r7-reward-blip{width:min(240px,100%)}
.r7-reward-one{grid-template-columns:minmax(200px,340px)}
.r7-reward-locked .r7-reward-thumb{border-style:dashed;box-shadow:none;background:transparent;color:var(--ink-soft,#6E706C);font:600 14px/1.4 var(--f-body);text-align:center;padding:14px}
.r7-reward-name{margin:0;font:700 15px/1.2 var(--f-body)}
.r7-reward-note{margin:0;font-size:12.5px;line-height:1.4;color:var(--ink-soft,#6E706C)}
.r7-reward-row{display:flex;gap:8px;flex-wrap:wrap}
.r7-reward-btn.btn-cel{padding:9px 15px 11px;font-size:14px;border-radius:13px}
.r7-reward-badges{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(112px,1fr))}
.r7-reward-badge{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center}
.r7-reward-badge button{all:unset;cursor:pointer;display:block;border-radius:50%}
.r7-reward-badge button:disabled{cursor:default}
.r7-reward-badge canvas,.r7-reward-ghost{display:block;width:104px;height:104px;border-radius:50%;border:3px solid var(--ink);box-shadow:3px 4px 0 var(--ink)}
.r7-reward-ghost{border-style:dashed;box-shadow:none;display:grid;place-items:center;font:700 22px var(--f-display);color:var(--ink-soft,#6E706C)}
.r7-reward-badge .r7-reward-note{max-width:128px}
@media (max-width:600px){.r7-reward-card{padding:20px 18px 24px}.r7-reward-card h2{font-size:28px}.r7-reward-thumb{height:170px}.r7-reward-thumb.r7-fit{height:auto}.r7-reward-walls{flex-direction:column;gap:22px}.r7-reward-walls>.r7-reward-item{flex:none!important;width:100%}.r7-wall-phone .r7-reward-thumb.r7-fit{align-self:flex-start;width:min(170px,calc(100% - 6px))}}`;
  document.head.appendChild(css);

  const panel = document.createElement("div"); panel.className = "r7-modal r7-reward-modal"; panel.hidden = true;
  panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-labelledby", "r7RewardTitle");
  document.body.appendChild(panel);
  let opener = null;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const lockTxt = { wallpapers: `Find all ${total() || "the"} butterflies.`, print: "Finish everything: every project, every butterfly, every star." };

  function renderPanel() {
    const fa = document.activeElement, fk = fa && panel.contains(fa) ? (fa.dataset.dl ? `[data-dl="${fa.dataset.dl}"]` : fa.dataset.retake ? `[data-retake="${fa.dataset.retake}"]` : fa.hasAttribute("data-close") ? "[data-close]" : null) : null;
    const wp = has("wallpapers"), pr = has("print");
    const wcard = k => {
      const W = WALLS[k], s = shots[k];
      const ok = s && !s.missing, r = ok && s.w && s.h ? s.w / s.h : WALLS[k].r;
      return wp ? `<div class="r7-reward-item r7-wall-${k}" style="flex:${r.toFixed(4)} 1 6px"><div class="r7-reward-thumb${ok ? " r7-fit" : ""}"${ok ? ` style="aspect-ratio:${s.w || r} / ${s.h || 1}"` : ""}>${ok ? `<img alt="${W.label} wallpaper preview" src="${s.url}">` : `<span class="r7-reward-note">${s ? "Being painted. Check back soon." : "Loading…"}</span>`}</div>
        <p class="r7-reward-name">${W.label}${ok && s.dim ? ` · ${s.dim}` : ""}</p><div class="r7-reward-row">
        <button type="button" class="btn-cel r7-reward-btn" data-dl="wall-${k}"${ok ? "" : " disabled"}>Download</button></div></div>`
        : `<div class="r7-reward-item r7-reward-locked" style="flex:1 1 0"><div class="r7-reward-thumb">Locked<br>${esc(lockTxt.wallpapers)}</div><p class="r7-reward-name">${W.label}</p></div>`;
    };
    panel.innerHTML = `<div class="r7-reward-card"><button type="button" class="panel-close" data-close aria-label="Close rewards"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <h2 id="r7RewardTitle">Takeaways</h2><p class="r7-reward-sub">Things you can keep.</p>
      <h3>Wallpapers</h3><div class="r7-reward-walls">${wcard("phone")}${wcard("desktop")}</div>
      <h3>Print Blip</h3><div class="r7-reward-grid r7-reward-one">${pr
        ? `<div class="r7-reward-item"><div class="r7-reward-thumb r7-fit r7-reward-blip" style="aspect-ratio:1 / 1"><img alt="Preview of the printable Blip, waving" src="${STL_PREVIEW}"></div><p class="r7-reward-name">Blip, 70 mm tall, waving</p><p class="r7-reward-note">The in-game Blip as one solid piece that stands on his own feet. Print him upright with tree supports (45°) and a brim: PLA, 0.2 mm layers, 3 walls, 15% infill.</p><div class="r7-reward-row"><button type="button" class="btn-cel r7-reward-btn" data-dl="stl">Download STL</button><button type="button" class="btn-cel btn-cel-grey r7-reward-btn" data-dl="3mf">3MF</button></div></div>`
        : `<div class="r7-reward-item r7-reward-locked"><div class="r7-reward-thumb">Locked<br>${esc(lockTxt.print)}</div></div>`}</div>
      <h3>Profile badges</h3><p class="r7-reward-note" style="margin:-4px 0 12px">640 × 640. Made for a round profile picture: the picture stays inside the circle.</p>
      <div class="r7-reward-badges">${MILESTONES.map(m => has("badge-" + m.id)
        ? `<div class="r7-reward-badge"><button type="button" data-dl="badge-${m.id}" aria-label="Download the ${esc(m.title)} badge"><canvas width="${BADGE_PX}" height="${BADGE_PX}" data-badge="${m.id}"></canvas></button><p class="r7-reward-name">${esc(m.title)}</p><p class="r7-reward-note">Tap to save</p></div>`
        : `<div class="r7-reward-badge"><button type="button" disabled aria-label="${esc(m.title)}, locked"><span class="r7-reward-ghost" aria-hidden="true">?</span></button><p class="r7-reward-name">${esc(m.title)}</p><p class="r7-reward-note">${esc(m.hint)}</p></div>`).join("")}</div></div>`;
    panel.querySelectorAll("canvas[data-badge]").forEach(async cv => { const src = await renderBadge(cv.dataset.badge); cv.getContext("2d").drawImage(src, 0, 0); });
    const back = (fk && panel.querySelector(fk)) || (fa && panel.contains(fa) && panel.querySelector("[data-close]"));
    if (back && !back.disabled) back.focus({ preventScroll: true });   // a re-render must not drop the pad / keyboard focus
  }
  let busy = false;
  async function ensureShots() {
    if (!has("wallpapers") || busy) return; busy = true;
    try {
      for (const k of Object.keys(WALLS)) { if (!shots[k]) { await takeShot(k); if (!panel.hidden) renderPanel(); } }
    } finally { busy = false; }
  }
  function open() {
    if (!panel.hidden) return; opener = document.activeElement; ui.closeMenu && ui.closeMenu();
    panel.hidden = false; renderPanel(); ensureShots();
    const b = panel.querySelector("[data-close]"); b && b.focus({ preventScroll: true });
  }
  function close() { if (panel.hidden) return; panel.hidden = true; if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true }); else document.activeElement && document.activeElement.blur(); }
  panel.addEventListener("click", async e => {
    if (e.target === panel || e.target.closest("[data-close]")) return close();
    const dl = e.target.closest("[data-dl]"), rt = e.target.closest("[data-retake]");
    if (rt) { const k = rt.dataset.retake; rt.disabled = true; delete shots[k]; renderPanel(); await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30))); await takeShot(k); if (!panel.hidden) renderPanel(); return; }
    if (!dl) return; const id = dl.dataset.dl;
    if (id === "stl" || id === "3mf") return downloadStl(id === "3mf");
    if (id.startsWith("wall-")) { const k = id.slice(5); return shots[k] && shots[k].blob && save(shots[k].blob, `small-planet-wallpaper-${k}.${shots[k].ext}`); }
    if (id.startsWith("badge-")) return save(await badgeBlob(id.slice(6)), `small-planet-badge-${id.slice(6)}-640.png`);
  });
  // capture phase, like the finale card: Esc closes, Tab stays inside, no other key reaches the game
  addEventListener("keydown", e => {
    if (panel.hidden) return;
    e.stopImmediatePropagation();
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    const f = [...panel.querySelectorAll("button:not(:disabled)")], i = f.indexOf(document.activeElement);
    if (!f.length) return;
    if (e.shiftKey ? i <= 0 : i === f.length - 1) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
  }, true);

  /* ---------------------------------------------------------------- the menu row (same classes as the other rows) */
  const menu = $("menu"), row = document.createElement("button");
  row.id = "r7RewardsBtn"; row.type = "button"; row.className = "menu-item"; row.hidden = true; row.setAttribute("aria-haspopup", "dialog");
  row.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10h14v10H5zM4 7h16v3H4zM12 7v13"/><path d="M12 7c-1-3-5-3-5-1s3 1 5 1Zm0 0c1-3 5-3 5-1s-3 1-5 1Z"/></svg><span class="mi-t">Rewards</span><span class="mi-state" aria-hidden="true"></span>`;
  row.addEventListener("click", open);
  if (menu) menu.appendChild(row);
  function refreshMenu() { const n = st.unlocked.length; row.hidden = n === 0; const s = row.querySelector(".mi-state"); if (s) s.textContent = `${n}/${REWARDS.length}`; }
  refreshMenu();

  const api = { unlock, evaluate, open, close, renderBadge, takeShot, get state() { return st; }, REWARDS, MILESTONES, SAFE_R, BADGE_PX,
    reset() { st = { flags: {}, unlocked: [] }; write(); refreshMenu(); } };
  window.__rewards = api;
  return api;
}
