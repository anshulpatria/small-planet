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

/* Collector's dock: each project's coin is its own cel pair (lit, shade), ink glyph on top */
const COIN = {
  "pin-art": ["#6A6AFF", "#3030C8"], "gravity-pong": ["#FF9A4D", "#C2601F"], "brand-studio": ["#FF8FB8", "#C25283"],
  "engraver": ["#F2C632", "#B08A06"], "field": ["#4CC79A", "#238A63"], "genai-after-hours": ["#A67BFF", "#6A3FC9"],
  "orchestrator": ["#37B8E6", "#177FA6"], "the-bracket": ["#FF6A5F", "#B22F27"], "artboard-42": ["#8ED04F", "#528F21"],  "sea-ai-maturity": ["#E0A878", "#9C6A3E"],
};
/* glyphs the shared GLYPHS table (projects.js) may not carry yet: a flat-top hexagon with a small inner hex */
const GLYPH_EXTRA = { hex: '<path d="M8 4h8l4 8-4 8H8l-4-8Z"/><path d="M10.5 9.5h3l1.5 2.5-1.5 2.5h-3L9 12Z"/>' };
/* The bulb is contextual. Inside a mini-game it says how to play it (the games' own status copy, word for word);
   at a spot it explains that spot's action; otherwise it is the current goal. Never empty. */
const HOWTO = {
  "pin-art": "Drag to push the pins. Undo your last masterpiece. Reset your entire artistic career.",
  "gravity-pong": "Pull back from the ball, release, and aim for the blue ring. Gravity will interfere.",
  "brand-studio": "Tap squares until your mark matches the card. Design by controlled chaos.",
  "engraver": "Turn the dial. There’s a picture hiding in those lines.",
};
const FALLBACK_HINT = "Walk up to anything on the planet to try it. The map is in the menu.";
const KEYCAP = "<kbd>E</kbd>";
function spotHelp(s, touch) {
  const go = (verb, rest) => touch ? `Tap <b>${verb}</b>, then ${rest}` : `Press ${KEYCAP}, then ${rest}`;
  const game = { "pin-art": "drag across the pins to push them out.", "gravity-pong": "pull back from the ball, release, and aim for the blue ring.",
    "brand-studio": "tap the squares until the mark matches the goal.", "engraver": "turn the dial until the picture appears." };
  if (s.kind === "game" && game[s.id]) return go(s.label, game[s.id]);
  const act = (touch ? `Tap <b>${s.label}</b>` : `Press ${KEYCAP}`);
  switch (s.kind) {
    case "kiosk": return `${act} for a closer look. No sales pitch, promise.`;
    case "play": return `${act} for movie time. Esc brings you back to reality.`;
    case "map": return `${act} to open the map. Walking is optional.`;
    case "cannon": return s.id === "moon-cannon" ? `${act} for your extremely unconventional return flight.` : `Ancient transport technology. Aim at the moon, then climb in. Seems fine.`;
    case "fauna": return `${act} to say hi. Social skills vary by creature.`;
    case "bench": return `${act} to sit. Any key ends your well-earned break.`;
    case "ap": return `${act} to knock. Someone might pretend not to be home.`;
    case "booth": return `${act} for a Blip makeover.`;
    case "secret": return `${act} for the view. It’s worth the climb.`;
    case "extra": return `${act}. What’s the worst that could happen?`;
    case "cast": return `${act} to join the local nonsense.`;
    default: return `${act}: ${s.label || "interact"}.`;
  }
}

const glyphSvg = (name, cls = "") => `<svg viewBox="0 0 24 24" class="${cls}" data-g="${name}">${GLYPHS[name] || GLYPH_EXTRA[name] || ""}</svg>`;

export class UI {
  constructor() {
    const st = readState();
    this.puzzles = st.puzzles || { gates: {} };
    this.found = new Set(st.found || []);
    this.secrets = new Set(st.secrets || []);
    this.seenHint = !!st.seenHint;
    this._seen = new Set();   // hint keys the visitor has already read; a key outside it lights the bulb's red dot
    this._spot = null; this._focus = null;
    try { this._howSeen = new Set(JSON.parse(localStorage.getItem("archipelago.howto.v1")) || []); } catch { this._howSeen = new Set(); }
    this.finaleSeen = !!st.finaleSeen;
    // a save from before a project was added: the finale is not 'seen' until every CURRENT project is found, so it opens for the new last one
    if (PROJECTS.some(p => !this.found.has(p.id))) this.finaleSeen = false;
    $("discTotal").textContent = PROJECTS.length;
    this.renderGlyphs();
    $("discCount").textContent = this.found.size;
    this.setupGoal();
    this.setupMenu();
    this.setupDockFade();
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
    // either query counts as touch: some phones report hover:none without pointer:coarse, and the reverse
    const tq = [matchMedia("(hover: none)"), matchMedia("(pointer: coarse)")];
    const touch = tq.some(q => q.matches);
    $("glyphs").innerHTML = PROJECTS.map(p => { const c = COIN[p.id] || ["#6A6AFF", "#3030C8"];
      return `<li><button class="glyph tok" data-id="${p.id}" style="--c:${c[0]};--lo:${c[1]}">${glyphSvg(p.glyph)}<span class="glyph-tip" aria-hidden="true"><b>${p.name}</b><small></small></span></button></li>`; }).join("");
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
    b.classList.toggle("on", f); b.classList.toggle("found", f); b.classList.toggle("empty", !f);
    b.setAttribute("aria-label", `${p.name}, ${f ? "discovered" : "not found yet"}. Go there`);
    b.querySelector("small").textContent = f ? "Discovered · go there" : "Not found yet · go there";
  }
  placeTip(b) {
    const tip = b.querySelector(".glyph-tip"), panel = b.closest(".dock");
    const g = b.getBoundingClientRect(), P = panel.getBoundingClientRect(), w = tip.offsetWidth;
    const left = Math.min(Math.max(g.left + g.width / 2 - w / 2, P.left), P.right - w);   // viewport x
    tip.style.setProperty("--tb", `${g.top - P.top}px`);
    tip.style.setProperty("--tx", `${left - g.left}px`);
    tip.style.setProperty("--ax", `${g.left + g.width / 2 - left}px`);
  }
  showTip(b, ms) {
    if (ms) { this.closeGoal(); this.closeMenu(); }   // one popover at a time: a glyph name replaces the hint bubble
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
    if (id === "artboard-42" && !this.found.has(id) && !onMoon) { this.toast("That project is on the moon. Your ride is the old <b>cannon</b>. Naturally.", 3200); return A.travel("cannon"); }
    A.travel(id);
  }

  /* ---- the bulb. main.js calls goal(html) when the next step changes (updateGoal) and prompt(text, fn, spot)
     every frame; focusBar() tells it a mini-game is up. hintModel() picks the one line that is true right now:
     inside a game, how to play it; at a spot, what the spot does; else the goal. The bubble re-reads it live while
     open (never stale) and a hint the visitor has not read yet lights the bulb's red dot. It never opens by itself. */
  setupGoal() {
    const btn = $("goalBtn"), bub = $("goal");
    btn.onclick = () => (bub.hidden ? this.openGoal() : this.closeGoal());
    $("goalClose").onclick = () => this.closeGoal(true);
    // capture phase on window runs before input.js's keydown listener, so this Esc closes the bubble or the
    // menu and nothing else (not the panel, map or focus mode underneath)
    addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      const menu = $("menu"), mb = $("menuBtn");
      if (!menu.hidden) { e.preventDefault(); e.stopImmediatePropagation(); this.closeMenu(menu.contains(document.activeElement) || document.activeElement === mb); return; }
      if (bub.hidden) return;
      e.preventDefault(); e.stopImmediatePropagation();
      this.closeGoal(bub.contains(document.activeElement) || document.activeElement === btn);
    }, true);
    addEventListener("pointerdown", e => {
      if (!bub.hidden && !bub.contains(e.target) && !btn.contains(e.target)) this.closeGoal();
    }, true);
    this.refreshHint();
  }
  goal(html) {
    if ((html || null) !== this._goal) this.wakeDock();   // a new step (arrival, discovery, travel): show the dock for a moment
    this._goal = html || null;
    this.refreshHint();
  }
  hintModel() {
    const touch = document.body.classList.contains("touch");
    if (this._focus) {
      const how = HOWTO[this._focus.id];
      return { key: "game:" + this._focus.id, head: "How to play", html: how || "Have a look around. Leave when curiosity is satisfied." };
    }
    if (this._spot) return { key: "spot:" + this._spot.id, head: this._spot.label || "Here", html: spotHelp(this._spot, touch) };
    return { key: "goal:" + (this._goal || ""), head: "Next up", html: this._goal || FALLBACK_HINT };
  }
  refreshHint() {
    const m = this.hintModel(), btn = $("goalBtn"), open = !$("goal").hidden;
    if (m.key === this._hintKey) return;
    this._hintKey = m.key;
    $("goalHead").textContent = m.head;
    if ($("goalText").innerHTML !== m.html) $("goalText").innerHTML = m.html;
    if (open) { this._seen.add(m.key); return; }
    const fresh = !this._seen.has(m.key);
    btn.querySelector(".bulb-dot").hidden = !fresh;
    btn.setAttribute("aria-label", fresh ? "Hint, new" : "Hint");
    // the red dot is the only 'new hint' signal (no pulse ring: it showed in some states and not others)
  }
  openGoal() {
    this.wakeDock();
    this.closeMenu();
    // one popover at a time: the hint bubble replaces any coin name that is showing
    clearTimeout(this._tipT); $("glyphs").querySelectorAll(".glyph.tip").forEach(x => x.classList.remove("tip"));
    document.activeElement && document.activeElement.closest && document.activeElement.closest(".glyph") && document.activeElement.blur();
    this.refreshHint();
    this._seen.add(this._hintKey);
    $("goal").hidden = false; $("goalBtn").setAttribute("aria-expanded", "true");
    $("goalBtn").querySelector(".bulb-dot").hidden = true; $("goalBtn").setAttribute("aria-label", "Hint");
  }
  closeGoal(refocus = false) {
    if ($("goal").hidden) return;
    $("goal").hidden = true; $("goalBtn").setAttribute("aria-expanded", "false");
    if (refocus) $("goalBtn").focus({ preventScroll: true });
  }

  /* ---- the menu: Map, Projects list, Sound, Photo booth. The rows ARE the old buttons (same ids), so every
     handler main.js attached still runs; the menu only opens, closes and reports the sound state */
  setupMenu() {
    const btn = $("menuBtn"), menu = $("menu");
    btn.onclick = () => (menu.hidden ? this.openMenu() : this.closeMenu());
    // a row closes the menu after its own handler ran; Sound stays so the new state can be read
    menu.addEventListener("click", e => { const it = e.target.closest(".menu-item"); if (it && it.id !== "soundBtn") this.closeMenu(); });
    addEventListener("pointerdown", e => { if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) this.closeMenu(); }, true);
  }
  /* ---- the dock fades out after ~4 s idle and returns for ~4 s on: a discovery, arriving at an island, the
     menu / bulb / map / list opening, the pointer in the bottom band (mouse) or a tap on the dock (touch).
     It stays while keyboard focus is inside it. Faded coins are not tappable. The prompt and Say hi never fade. */
  setupDockFade() {
    const dock = $("dock"), root = document.documentElement;
    this._dockHold = false;
    dock.addEventListener("focusin", () => { this._dockHold = true; this.wakeDock(); });
    dock.addEventListener("focusout", () => { this._dockHold = false; this.wakeDock(); });
    addEventListener("pointermove", e => {
      if (e.pointerType !== "mouse") return;
      if (e.clientY > innerHeight - 120) this.wakeDock();
    }, true);
    addEventListener("pointerdown", e => {
      if (e.pointerType === "mouse") return;
      const r = dock.getBoundingClientRect();
      if (e.clientX > r.left - 24 && e.clientX < r.right + 24 && e.clientY > r.top - 24 && e.clientY < r.bottom + 24) this.wakeDock();
    }, true);
    // desktop / tablet: the prompt slot sits above the dock's real height (faded or not), so they can never overlap
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => root.style.setProperty("--dock-live", dock.offsetHeight + "px")).observe(dock);
    this.wakeDock();
  }
  wakeDock(ms = 4000) {
    const b = document.body;
    b.classList.remove("dock-idle");
    clearTimeout(this._dockT);
    this._dockT = setTimeout(() => { if (this._dockHold) return this.wakeDock(); b.classList.add("dock-idle"); }, ms);
  }
  openMenu() {
    this.wakeDock();
    this.closeGoal();
    $("menu").hidden = false; $("menuBtn").setAttribute("aria-expanded", "true");
    clearTimeout(this._tipT); $("glyphs").querySelectorAll(".glyph.tip").forEach(x => x.classList.remove("tip"));
  }
  closeMenu(refocus = false) {
    if ($("menu").hidden) return;
    $("menu").hidden = true; $("menuBtn").setAttribute("aria-expanded", "false");
    if (refocus) $("menuBtn").focus({ preventScroll: true });
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
    $("finaleGlyphs").innerHTML = PROJECTS.map(p => { const c = COIN[p.id] || ["#6A6AFF", "#3030C8"]; return `<li style="--c:${c[0]};--lo:${c[1]}">${glyphSvg(p.glyph)}</li>`; }).join("");
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
    $("dock").classList.toggle("done", this.allFound);
    $("finTitle").textContent = `${PROJECTS.length}/${PROJECTS.length}. Now let’s make trouble. The good kind.`;
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
    // U3: dismissing the card, by Escape or any other way, must always leave "Say hi" standing in the dock.
    // Re-assert it (hidden state, dock mode) and give it one nudge so the visitor sees where it went
    this.markAllFound();
    const hi = $("sayHi"); hi.classList.remove("nudge"); void hi.offsetWidth; hi.classList.add("nudge");
    clearTimeout(this._nt); this._nt = setTimeout(() => hi.classList.remove("nudge"), 2400);
  }

  /* returns true the first time a project is discovered */
  discover(id) {
    if (this.found.has(id)) return false;
    this.found.add(id);
    this.save();
    $("discCount").textContent = this.found.size;
    this.wakeDock();
    const idx = PROJECTS.findIndex(p => p.id === id);
    const btn = $("glyphs").querySelectorAll(".glyph")[idx];
    if (btn) { btn.classList.add("on", "pop"); this.labelGlyph(btn, PROJECTS[idx]); setTimeout(() => btn.classList.remove("pop"), 700); }
    const p = byId[id];
    this.toast(`${glyphSvg(p.glyph)} Found it! · ${p.name}`);
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
    // the first-run key line ("W A S D walk ... E interact ... M map") shows once, on the first visit, for ~6 s, and
    // never on touch (no keyboard keys there; the on-screen controls say it). Seated / "come back" hints still show.
    if (/W A S D|Thumb down|Stick to walk/.test(html)) {
      let seen = false; try { seen = localStorage.getItem("archipelago.keyhint.v1") === "1"; } catch { /* optional */ }
      const busy = this.panelOpen || this.mapOpen || this.finaleOpen || $("booth").getAttribute("aria-hidden") === "false";
      if (seen || busy) return;   // not while a panel, the map, the booth or the finale is up; it stays unspent for later
      try { localStorage.setItem("archipelago.keyhint.v1", "1"); } catch { /* optional */ }
      ms = 6000;
    }
    const h = $("hint");
    h.innerHTML = html; h.classList.add("show");
    clearTimeout(this._ht);
    if (ms) this._ht = setTimeout(() => h.classList.remove("show"), ms);
  }
  hideHint() { $("hint").classList.remove("show"); }

  /* the prompt keeps its behaviour; the third argument is the spot it belongs to (feeds the bulb and the dock's
     "you are here" dot) */
  prompt(text, onClick, spot) {
    const p = $("prompt");
    const on = text ? "on" : "off";   // track I's interact button mirrors this
    if (document.documentElement.dataset.prompt !== on) document.documentElement.dataset.prompt = on;
    if (!text) {
      if (!p.hidden) p.hidden = true;
      if (this._promptText) $("promptLive").textContent = "";
      this._promptText = null; this.setSpot(null); return;
    }
    if (this._promptText !== text) { $("promptText").textContent = text; this._promptText = text; $("promptLive").textContent = text; }
    p.hidden = false;
    p.onclick = onClick;
    this.setSpot(spot || null);
  }
  setSpot(spot) {
    if (spot === this._spot) return;
    this._spot = spot; this.refreshHint(); this.markHere();
  }
  /* "you are here": a dot under the coin of the project whose spot you stand at, or whose game is open */
  markHere() {
    const id = this._focus ? this._focus.id : this._spot ? this._spot.id.replace(/^play-/, "") : null;
    if (id !== this._hereId) { this._hereId = id; if (id) this.wakeDock(); }
    $("glyphs").querySelectorAll(".glyph").forEach(b => b.classList.toggle("here", b.dataset.id === id));
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
  /* the board map (boardmap.js, set as ui.board by main.js): dests are [{ id, label, project, locked }] */
  openMap(dests, onPick) {
    const go = d => {
      if (d.locked) { this.toast(d.locked); return; }
      this.sound.select(d.id); this.closeMap(); onPick(d.id);
    };
    if (this.board) this.board.open(dests, { found: this.found, onPick: go, onHover: id => this.sound.hover(id) });
    $("mapLegend").innerHTML = `<li><i style="background:var(--signal)"></i>Discovered</li><li><i style="background:#fff"></i>Not yet</li><li><i style="background:var(--signal);border-radius:50%;box-shadow:none"></i>You</li><li>${this.found.size} / ${PROJECTS.length} found${this.secrets.size ? ` · ${this.secrets.size} / 3 secrets` : ""}</li>`;
    this.wakeDock();
    $("map").classList.add("open"); $("map").setAttribute("aria-hidden", "false");
    if (!this.mapOpen) this.sound.reading("map", true);
    this.mapOpen = true;
  }
  closeMap() {
    if (this.mapOpen) this.sound.reading("map", false);
    if (this.board) this.board.close();
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
    this.mode = mode; this.wakeDock();
    this.sound.reading("list", mode === "list");
    $("list").classList.toggle("open", mode === "list");
    $("list").setAttribute("aria-hidden", mode === "list" ? "false" : "true");
    document.querySelectorAll("#menu [data-mode]").forEach(b => b.setAttribute("aria-current", String(b.dataset.mode === mode)));
  }

  status(text) {
    const el = $("focusStatus");
    el.hidden = !text; el.textContent = text || "";
  }
  tools(list) { this.focusBar($("focusTitle").textContent, list); }

  focusBar(title, tools) {
    const bar = $("focusbar");
    if (!title) { bar.hidden = true; document.body.classList.remove("focus"); this.status(null); if (this._focus) { this._focus = null; this.refreshHint(); this.markHere(); } return; }
    const pr = PROJECTS.find(x => x.name === title);
    if (!this._focus || this._focus.title !== title) {
      this._focus = { id: pr ? pr.id : title, title }; this.refreshHint(); this.markHere();
      // the first time a game opens, its bulb bubble opens by itself with that game's rules (once per game, remembered)
      const gid = this._focus.id;
      if (HOWTO[gid] && !this._howSeen.has(gid)) {
        this._howSeen.add(gid);
        try { localStorage.setItem("archipelago.howto.v1", JSON.stringify([...this._howSeen])); } catch { /* optional */ }
        setTimeout(() => { if (this._focus && this._focus.id === gid) this.openGoal(); }, 500);
      }
    }
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
