import { PROJECTS, byId, GLYPHS } from "./projects.js";

/* Everything in HTML: progress + glyphs, prompt, toast, hint, panel, map, list.
   Discovery state persists in localStorage (wrapped: private windows may refuse it). */

const $ = id => document.getElementById(id);
const KEY = "archipelago.v1";
/* where the finale's "Connect on LinkedIn" button goes (a full https:// profile URL) */
const CONTACT_LINKEDIN = "https://www.linkedin.com/in/anshulpatria512";

function readState() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function writeState(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* optional */ } }

const glyphSvg = (name, cls = "") => `<svg viewBox="0 0 24 24" class="${cls}" data-g="${name}">${GLYPHS[name] || ""}</svg>`;

export class UI {
  constructor() {
    const st = readState();
    this.puzzles = st.puzzles || { gates: {} };
    this.found = new Set(st.found || []);
    this.secrets = new Set(st.secrets || []);
    this.seenHint = !!st.seenHint;
    this.finaleSeen = !!st.finaleSeen;
    $("discTotal").textContent = PROJECTS.length;
    this.renderGlyphs();
    $("discCount").textContent = this.found.size;
    this.setupGoal();
    this.panelOpen = false;
    this.mapOpen = false;
    this.sfx = { play: () => false };   // main.js sets ui.sfx = createSfx(amb)
    this.sound = { hover: () => false, select: () => false, reading: () => false };   // main.js sets ui.sound = amb
    this.mode = "world";
    $("panelClose").onclick = () => this.closePanel();
    $("mapClose").onclick = () => this.closeMap();
    $("map").addEventListener("click", e => { if (e.target.id === "map") this.closeMap(); });
    this.renderCards();
    this.setupFinale();
  }

  /* ---- projects discovered: one button per project. Activating one travels there through
     `onGlyph(id)` when main.js sets it, else through the same `travel(id)` the map uses.
     Touch has no hover, so a tap shows the name first and travels a beat later. */
  renderGlyphs() {
    // either query counts as touch: some phones report hover:none without pointer:coarse, and the
    // reverse; re-labelled on change so a rotated tablet or a toggled emulator never says "Click"
    const tq = [matchMedia("(hover: none)"), matchMedia("(pointer: coarse)")];
    const touch = tq.some(q => q.matches);
    const cta = () => { $("glyphCta").lastElementChild.textContent = `${tq.some(q => q.matches) ? "Tap" : "Click"} a project to go there`; };
    cta(); tq.forEach(q => q.addEventListener("change", cta));
    $("glyphs").innerHTML = PROJECTS.map(p => `<li><button class="glyph" data-id="${p.id}">${glyphSvg(p.glyph)}<span class="glyph-tip" aria-hidden="true"><b>${p.name}</b><small></small></span></button></li>`).join("");
    $("glyphs").querySelectorAll(".glyph").forEach((b, i) => this.labelGlyph(b, PROJECTS[i]));
    const box = $("glyphs");
    // place a tip before it fades in (hover, keyboard focus, or a tap via showTip)
    box.addEventListener("pointerover", e => { const b = e.target.closest(".glyph"); if (b) this.placeTip(b); });
    box.addEventListener("focusin", e => { const b = e.target.closest(".glyph"); if (b) this.placeTip(b); });
    // a soft hover on entering a different glyph (not on every move inside one); leaving the row resets
    const hov = e => { const b = e.target.closest(".glyph"); if (b && b.dataset.id !== this._hovGlyph) { this._hovGlyph = b.dataset.id; this.sound.hover(b.dataset.id); } };
    box.addEventListener("pointerover", hov); box.addEventListener("focusin", hov);
    box.addEventListener("pointerleave", () => { this._hovGlyph = null; });
    box.addEventListener("click", e => {
      const b = e.target.closest(".glyph"); if (!b) return;
      // pointerType is "" for keyboard-synthesised clicks; only a real touch/pen waits to show the name
      const wait = e.pointerType === "touch" || e.pointerType === "pen" || (touch && e.pointerType !== "mouse" && e.detail > 0);
      // a pointer click leaves focus on the button; drop it, or the next Space (jump) would travel again
      if (e.detail > 0) b.blur();
      this.showTip(b, wait ? 1100 : 0);
      if (wait) setTimeout(() => this.goGlyph(b.dataset.id), 550); else this.goGlyph(b.dataset.id);
    });
    // Enter/Space are handled here and stopped, so the game never also sees them (Space = jump)
    box.addEventListener("keydown", e => {
      const b = e.target.closest(".glyph"); if (!b || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault(); e.stopPropagation();
      if (!e.repeat) this.goGlyph(b.dataset.id);
    });
  }
  labelGlyph(b, p) {
    const f = this.found.has(p.id);
    b.classList.toggle("on", f);
    b.setAttribute("aria-label", `${p.name}, ${f ? "discovered" : "not found yet"}. Go there`);
    b.querySelector("small").textContent = f ? "Discovered · go there" : "Not found yet · go there";
  }
  placeTip(b) {
    const tip = b.querySelector(".glyph-tip"), panel = b.closest(".progress");
    const g = b.getBoundingClientRect(), P = panel.getBoundingClientRect(), w = tip.offsetWidth;
    const left = Math.min(Math.max(g.left + g.width / 2 - w / 2, P.left), P.right - w);   // viewport x
    tip.style.setProperty("--tb", `${g.top - P.top}px`);
    tip.style.setProperty("--tx", `${left - g.left}px`);
    tip.style.setProperty("--ax", `${g.left + g.width / 2 - left}px`);
  }
  showTip(b, ms) {
    if (ms) this.closeGoal();   // one popover at a time: a glyph name replaces the goal bubble
    $("glyphs").querySelectorAll(".glyph.tip").forEach(x => x !== b && x.classList.remove("tip"));
    if (!ms) return;
    this.placeTip(b); b.classList.add("tip"); clearTimeout(this._tipT); this._tipT = setTimeout(() => b.classList.remove("tip"), ms);
  }
  goGlyph(id) {
    if (this.onGlyph) return this.onGlyph(id);
    const A = window.__archipelago;
    if (!A || A.state !== "play") return;
    this.sound.select(id);
    this.closeMap(); this.closeGoal();
    // Artboard 42 sits on the moon, which the cannon puzzle unlocks: until it is found,
    // send the visitor to the cannon rather than skipping the puzzle
    const onMoon = A.player && A.player.body && A.player.body.name === "moon";
    if (id === "artboard-42" && !this.found.has(id) && !onMoon) { this.toast("Artboard 42 is on the moon. The old <b>cannon</b> is the way up.", 3200); return A.travel("cannon"); }
    A.travel(id);
  }

  /* ---- goal: main.js calls goal(html) whenever the next step changes. It is stored and
     only shown when the visitor opens it from the lightbulb; a changed goal pulses the
     button once and never opens the bubble by itself. */
  setupGoal() {
    const btn = $("goalBtn"), bub = $("goal");
    btn.onclick = () => (bub.hidden ? this.openGoal() : this.closeGoal());
    $("goalClose").onclick = () => this.closeGoal(true);
    // capture phase on window runs before input.js's keydown listener, so this Esc
    // closes the bubble and nothing else (not the panel, map or focus mode underneath)
    addEventListener("keydown", e => {
      if (e.key !== "Escape" || bub.hidden) return;
      e.preventDefault(); e.stopImmediatePropagation();
      this.closeGoal(bub.contains(document.activeElement) || document.activeElement === btn);
    }, true);
    addEventListener("pointerdown", e => {
      if (!bub.hidden && !bub.contains(e.target) && !btn.contains(e.target)) this.closeGoal();
    }, true);
  }
  goal(html) {
    const btn = $("goalBtn"), prev = this._goal;
    this._goal = html || null;
    btn.hidden = !html;
    if (!html) { this.closeGoal(); return; }
    if ($("goalText").innerHTML !== html) $("goalText").innerHTML = html;
    if (prev && prev !== html && $("goal").hidden) {   // a new step: one quiet pulse, no auto-open
      btn.classList.remove("pulse"); void btn.offsetWidth; btn.classList.add("pulse");
      clearTimeout(this._pt); this._pt = setTimeout(() => btn.classList.remove("pulse"), 3000);
    }
  }
  openGoal() {
    if (!this._goal) return;
    // one popover at a time: the goal bubble replaces any glyph name that is showing
    clearTimeout(this._tipT); $("glyphs").querySelectorAll(".glyph.tip").forEach(x => x.classList.remove("tip"));
    document.activeElement && document.activeElement.closest && document.activeElement.closest(".glyph") && document.activeElement.blur();
    $("goal").hidden = false; $("goalBtn").setAttribute("aria-expanded", "true"); $("goalBtn").classList.remove("pulse");
  }
  closeGoal(refocus = false) {
    if ($("goal").hidden) return;
    $("goal").hidden = true; $("goalBtn").setAttribute("aria-expanded", "false");
    if (refocus) $("goalBtn").focus({ preventScroll: true });
  }

  save() { writeState({ found: [...this.found], secrets: [...this.secrets], seenHint: this.seenHint, puzzles: this.puzzles, finaleSeen: this.finaleSeen }); }

  /* ---- finale: once every project is found, a card thanks the visitor and links to LinkedIn.
     It opens by itself once (when the world is calm: no panel, map, film, booth, game or list up),
     and again from the "Say hi" button that joins the progress card at 9 / 9. */
  get allFound() { return this.found.size >= PROJECTS.length; }
  setupFinale() {
    const box = $("finale"), link = $("finaleLink");
    this.finaleOpen = false;
    $("finaleMeta").textContent = `${PROJECTS.length} / ${PROJECTS.length} projects discovered`;
    $("finaleGlyphs").innerHTML = PROJECTS.map(p => `<li>${glyphSvg(p.glyph)}</li>`).join("");
    link.setAttribute("href", CONTACT_LINKEDIN);
    $("finaleClose").onclick = () => this.closeFinale();
    $("finaleStay").onclick = () => this.closeFinale();
    // a pointer click leaves focus on the button; drop it, or a later Space (jump) would reopen the card
    $("sayHi").onclick = e => { if (e.detail > 0) e.currentTarget.blur(); this.openFinale(); };
    box.addEventListener("click", e => { if (e.target === box) this.closeFinale(); });
    // capture phase on window runs before input.js: while the card is up, Esc closes it, Tab stays
    // inside it, and no other key reaches the game (Enter / Space still press the focused button)
    addEventListener("keydown", e => {
      if (!this.finaleOpen) return;
      e.stopImmediatePropagation();
      if (e.key === "Escape") { e.preventDefault(); this.closeFinale(); return; }
      if (e.key !== "Tab") return;
      const f = [...box.querySelectorAll("a[href],button")], i = f.indexOf(document.activeElement);
      if (e.shiftKey ? i <= 0 : i === f.length - 1) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
    }, true);
    this.markAllFound();
  }
  markAllFound() {
    $("sayHi").hidden = !this.allFound;
    document.querySelector(".progress").classList.toggle("done", this.allFound);
    if (this.allFound && !this.finaleSeen) this.queueFinale();
  }
  /* waits for 1.2 s of calm in free play, so it never lands on top of the 9th project's own panel */
  queueFinale() {
    if (this._fq) return;
    let calm = 0;
    this._fq = setInterval(() => {
      const A = window.__archipelago, busy = !A || A.state !== "play" || this.panelOpen || this.mapOpen || this.mode === "list"
        || document.body.classList.contains("focus") || $("video").classList.contains("open") || $("booth").getAttribute("aria-hidden") === "false";
      calm = busy ? 0 : calm + 1;
      if (calm >= 3) { clearInterval(this._fq); this._fq = null; this.openFinale(); }
    }, 400);
  }
  openFinale() {
    if (this.finaleOpen) return;
    clearInterval(this._fq); this._fq = null;
    this.closeGoal(); this.closeMap();
    this._finaleFrom = document.activeElement;
    this.finaleSeen = true; this.save();
    this.finaleOpen = true;
    $("finale").classList.add("open"); $("finale").setAttribute("aria-hidden", "false");
    setTimeout(() => this.finaleOpen && $("finaleLink").focus({ preventScroll: true }), 350);
  }
  closeFinale() {
    if (!this.finaleOpen) return;
    this.finaleOpen = false;
    $("finale").classList.remove("open"); $("finale").setAttribute("aria-hidden", "true");
    const back = this._finaleFrom;
    if (back && back.id === "sayHi") back.focus({ preventScroll: true }); else document.activeElement && document.activeElement.blur();
  }

  /* returns true the first time a project is discovered */
  discover(id) {
    if (this.found.has(id)) return false;
    this.found.add(id);
    this.save();
    $("discCount").textContent = this.found.size;
    const idx = PROJECTS.findIndex(p => p.id === id);
    const btn = $("glyphs").querySelectorAll(".glyph")[idx];
    if (btn) { btn.classList.add("on", "pop"); this.labelGlyph(btn, PROJECTS[idx]); setTimeout(() => btn.classList.remove("pop"), 700); }
    const p = byId[id];
    this.toast(`${glyphSvg(p.glyph)} Discovered · ${p.name}`);
    this.renderCards();
    this.markAllFound();
    return true;
  }

  findSecret(id, label) {
    if (this.secrets.has(id)) return false;
    this.secrets.add(id); this.save();
    this.toast(`Secret ${this.secrets.size} / 3 · ${label}`);
    return true;
  }

  toast(html, ms = 2600) {
    const t = $("toast");
    t.innerHTML = html; t.classList.add("show");
    clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove("show"), ms);
  }

  hint(html, ms) {
    const h = $("hint");
    h.innerHTML = html; h.classList.add("show");
    clearTimeout(this._ht);
    if (ms) this._ht = setTimeout(() => h.classList.remove("show"), ms);
  }
  hideHint() { $("hint").classList.remove("show"); }

  prompt(text, onClick) {
    const p = $("prompt");
    if (!text) { if (!p.hidden) p.hidden = true; this._promptText = null; return; }
    if (this._promptText !== text) { $("promptText").textContent = text; this._promptText = text; }
    p.hidden = false;
    p.onclick = onClick;
  }

  openPanel(id) {
    const p = byId[id];
    $("panelShot").src = p.shot; $("panelShot").alt = `Screenshot of ${p.name}`;
    $("panelOrd").textContent = p.ord;
    $("panelType").textContent = p.type;
    $("panelInput").textContent = p.input;
    $("panelName").textContent = p.name;
    $("panelMyth").textContent = p.myth;
    $("panelDesc").textContent = p.desc;
    $("panelTech").innerHTML = (p.tech || []).map(t => `<li>${t}</li>`).join("");
    $("panelOpen").href = p.url;
    this.sound.reading("panel", true);
    $("panel").classList.add("open");
    $("panel").setAttribute("aria-hidden", "false");
    this.panelOpen = id;
    document.body.classList.add("panel-open");
    setTimeout(() => $("panelOpen").focus({ preventScroll: true }), 400);
  }
  closePanel() {
    if (this.panelOpen) this.sound.reading("panel", false);
    $("panel").classList.remove("open"); $("panel").setAttribute("aria-hidden", "true");
    this.panelOpen = false;
    document.body.classList.remove("panel-open");
    document.activeElement && document.activeElement.blur();
  }

  /* World map: islands drawn from their real positions (x, z in metres). */
  openMap(dests, me, onPick, backdrop = "") {
    const svg = $("mapSvg");
    const S = 1.55;
    const bridges = dests.filter(d => d.bridge).map(d => `<line class="bridge" x1="0" y1="0" x2="${d.pos.x * S}" y2="${d.pos.z * S}"/>`).join("");
    const isles = dests.map(d => {
      const x = d.svg ? d.svg.x : d.pos.x * S, y = d.svg ? d.svg.y : d.pos.z * S, r = d.size;
      const found = d.project && this.found.has(d.project);
      const locked = d.locked;
      const label = d.label;
      const ly = y + r + 8;
      return `<g class="isle${found ? " found" : ""}${locked ? " locked" : ""}" tabindex="0" role="button" aria-label="${locked ? "Locked: " + locked : "Travel to " + label}${found ? " (discovered)" : ""}" data-id="${d.id}">
        <circle class="hit" cx="${x}" cy="${y}" r="${Math.max(r, 12)}"/><circle class="body" cx="${x}" cy="${y}" r="${r}"/>
        ${locked ? `<path class="lock" d="M${x - 2.4} ${y - 0.6}h4.8v4h-4.8z M${x - 1.5} ${y - 0.6}v-1.6a1.5 1.5 0 0 1 3 0v1.6"/>` : ""}
        <text x="${x}" y="${ly}" text-anchor="middle">${label}</text></g>`;
    }).join("");
    const mx = me.svg ? me.svg.x : me.x * S, my = me.svg ? me.svg.y : me.z * S;
    svg.innerHTML = backdrop + bridges + isles + `<circle class="me-ring" cx="${mx}" cy="${my}" r="6"/><circle class="me" cx="${mx}" cy="${my}" r="2.6"/>`;
    svg.querySelectorAll(".isle").forEach(g => {
      const go = () => { if (g.classList.contains("locked")) { this.toast(g.getAttribute("aria-label")); return; } this.sound.select(g.dataset.id); this.closeMap(); onPick(g.dataset.id); };
      g.addEventListener("pointerenter", () => this.sound.hover(g.dataset.id)); g.addEventListener("focus", () => this.sound.hover(g.dataset.id));
      g.addEventListener("click", go);
      g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
    $("mapLegend").innerHTML = `<li><i style="background:var(--signal)"></i>Discovered</li><li><i style="background:#fff"></i>Not yet</li><li><i style="background:var(--signal);border-radius:50%;box-shadow:none"></i>You</li><li>${this.found.size} / ${PROJECTS.length} found${this.secrets.size ? ` · ${this.secrets.size} / 3 secrets` : ""}</li>`;
    $("map").classList.add("open"); $("map").setAttribute("aria-hidden", "false");
    if (!this.mapOpen) this.sound.reading("map", true);
    this.mapOpen = true;
    this.placeMapLabels(svg);
  }
  /* label layout: each name takes the first of below / above / right / left (and two staggered
     fallbacks) whose box clears every island, every name already placed and the map's edge.
     Boxes come from getBBox, so the real font widths count, not a guess */
  placeMapLabels(svg) {
    const isles = [...svg.querySelectorAll(".isle")].map(g => { const c = g.querySelector(".body"); return { g, t: g.querySelector("text"), x: +c.getAttribute("cx"), y: +c.getAttribute("cy"), r: +c.getAttribute("r") }; });
    const placed = [], pad = 1.2, VB = 110;
    const hitsCircle = (b, c) => { const nx = Math.max(b.x, Math.min(c.x, b.x + b.width)), ny = Math.max(b.y, Math.min(c.y, b.y + b.height)); return Math.hypot(nx - c.x, ny - c.y) < c.r + pad; };
    const hitsBox = (a, b) => a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad;
    for (const I of isles) {
      const { t, x, y, r } = I;
      const cands = [[x, y + r + 7, "middle"], [x, y - r - 2.5, "middle"], [x + r + 3.5, y + 2, "start"], [x - r - 3.5, y + 2, "end"], [x, y + r + 14, "middle"], [x, y - r - 9.5, "middle"]];
      let best = null;
      for (const [cx, cy, anchor] of cands) {
        t.setAttribute("x", cx); t.setAttribute("y", cy); t.setAttribute("text-anchor", anchor);
        const b = t.getBBox();
        const ok = b.x > -VB && b.x + b.width < VB && b.y > -VB && b.y + b.height < VB && !isles.some(o => hitsCircle(b, o)) && !placed.some(p => hitsBox(b, p));
        if (ok) { best = b; break; }
      }
      if (!best) { const [cx, cy, anchor] = cands[0]; t.setAttribute("x", cx); t.setAttribute("y", cy); t.setAttribute("text-anchor", anchor); best = t.getBBox(); }
      placed.push(best);
    }
  }
  closeMap() {
    if (this.mapOpen) this.sound.reading("map", false);
    $("map").classList.remove("open"); $("map").setAttribute("aria-hidden", "true"); this.mapOpen = false;
  }

  renderCards() {
    $("cards").innerHTML = PROJECTS.map(p => `
      <a class="card" href="${p.url}" target="_blank" rel="noopener">
        <img src="${p.shot}" alt="" loading="lazy">
        <div class="card-body">
          <div class="card-meta"><span>${p.ord} · ${p.type}</span><span class="${this.found.has(p.id) ? "found" : ""}">${this.found.has(p.id) ? "Discovered" : p.input}</span></div>
          <h3>${p.name}</h3>
          <p class="myth">${p.myth}</p>
          <p class="desc">${p.desc}</p>
        </div>
      </a>`).join("");
  }

  setMode(mode) {
    this.mode = mode;
    this.sound.reading("list", mode === "list");
    $("list").classList.toggle("open", mode === "list");
    $("list").setAttribute("aria-hidden", mode === "list" ? "false" : "true");
    document.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.mode === mode)));
  }

  status(text) {
    const el = $("focusStatus");
    el.hidden = !text; el.textContent = text || "";
  }
  tools(list) { this.focusBar($("focusTitle").textContent, list); }

  focusBar(title, tools) {
    const bar = $("focusbar");
    if (!title) { bar.hidden = true; document.body.classList.remove("focus"); this.status(null); return; }
    $("focusTitle").textContent = title;
    const box = $("focusTools");
    box.innerHTML = "";
    tools.forEach(t => {
      const b = document.createElement("button");
      b.className = "chip"; b.textContent = t.label;
      if (t.group) b.dataset.group = t.group;
      if (t.pressed) b.setAttribute("aria-pressed", "true");
      b.onclick = () => {
        if (t.group) box.querySelectorAll(`[data-group="${t.group}"]`).forEach(x => x.setAttribute("aria-pressed", String(x === b)));
        t.onClick();
      };
      box.appendChild(b);
    });
    bar.hidden = false;
    document.body.classList.add("focus");
  }
}
