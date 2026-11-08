import { PROJECTS, byId, GLYPHS } from "./projects.js?v=20261108-2312";

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
/* the keycap follows the last input used (input.js sets html[data-input]): E on a keyboard, A on a pad */
const KEYCAP = () => document.documentElement.dataset.input === "pad" ? "<kbd>A</kbd>" : "<kbd>E</kbd>";
function spotHelp(s, touch) {
  const pad = document.documentElement.dataset.input === "pad";
  const go = (verb, rest) => touch ? `Tap <b>${verb}</b>, then ${rest}` : `Press ${KEYCAP()}, then ${rest}`;
  const game = { "pin-art": "drag across the pins to push them out.", "gravity-pong": "pull back from the ball, release, and aim for the blue ring.",
    "brand-studio": "tap the squares until the mark matches the goal.", "engraver": "turn the dial until the picture appears." };
  if (s.kind === "game" && game[s.id]) return go(s.label, game[s.id]);
  const act = (touch ? `Tap <b>${s.label}</b>` : `Press ${KEYCAP()}`);
  const back = touch ? "<b>Leave</b> brings you back to reality." : pad ? "<b>B</b> brings you back to reality." : "Esc brings you back to reality.";
  const up = touch ? "Tap the stick to end your well-earned break." : pad ? "Any button ends your well-earned break." : "Any key ends your well-earned break.";
  switch (s.kind) {
    case "kiosk": return `${act} for a closer look. No sales pitch, promise.`;
    case "play": return `${act} for movie time. ${back}`;
    case "map": return `${act} to open the map. Walking is optional.`;
    case "cannon": return s.id === "moon-cannon" ? `${act} for your extremely unconventional return flight.` : `Ancient transport technology. Aim at the moon, then climb in. Seems fine.`;
    case "fauna": return `${act} to say hi. Social skills vary by creature.`;
    case "bench": return `${act} to sit. ${up}`;
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
    // dock icons: the drawings are not centred in their 24x24 frames (some sit 1-2.6 px low on a 28 px coin), so each
    // frame is re-centred on its own ink. Dock only; covers coins added later (the restart coin). Retries while hidden (no bbox yet).
    const centreInk = () => { let todo = 0;
      box.querySelectorAll(".tok svg:not([data-ink])").forEach(s => { let bb; try { bb = s.getBBox(); } catch { bb = null; }
        if (!bb || !bb.width) { todo++; return; }
        s.setAttribute("viewBox", `${(bb.x + bb.width / 2 - 12).toFixed(2)} ${(bb.y + bb.height / 2 - 12).toFixed(2)} 24 24`); s.dataset.ink = "1"; });
      if (todo) setTimeout(centreInk, 400); };
    centreInk(); new MutationObserver(centreInk).observe(box, { childList: true, subtree: true });
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
      if (this.closeR7Modal()) { e.preventDefault(); e.stopImmediatePropagation(); return; }   // R7: the topmost .r7-modal wins over everything below it
      const menu = $("menu"), mb = $("menuBtn");
      if (!menu.hidden) { e.preventDefault(); e.stopImmediatePropagation(); this.closeMenu(menu.contains(document.activeElement) || document.activeElement === mb); return; }
      if (bub.hidden) return;
      // R7: a game's hint bubble opens by itself 500 ms after you step in; it must not eat the first Esc / pad B that leaves the game
      if (document.body.classList.contains("focus") && !bub.contains(document.activeElement) && document.activeElement !== btn) { this.closeGoal(); return; }
      e.preventDefault(); e.stopImmediatePropagation();
      this.closeGoal(bub.contains(document.activeElement) || document.activeElement === btn);
    }, true);
    addEventListener("pointerdown", e => {
      if (!bub.hidden && !bub.contains(e.target) && !btn.contains(e.target)) this.closeGoal();
    }, true);
    this.refreshHint();
  }
  /* R7: Escape / pad B closes the topmost visible .r7-modal (any module's). Its own close / cancel button is clicked if it has
     one; else it gets a cancelable "r7close" event; else it is hidden. Returns true when one was closed. */
  closeR7Modal() {
    const ms = [...document.querySelectorAll(".r7-modal")].reverse();
    const m = ms.find(el => !el.hidden && el.getAttribute("aria-hidden") !== "true" && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
    if (!m) return false;
    const cb = m.querySelector("[data-r7-close], .r7-close, [data-close], [aria-label^='Close' i], [aria-label^='Cancel' i]");
    if (cb) cb.click();
    else if (m.dispatchEvent(new CustomEvent("r7close", { bubbles: true, cancelable: true }))) { m.hidden = true; m.setAttribute("aria-hidden", "true"); }
    return true;
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
    if (this._spot) {
      // a game already found: say so and point at the next goal, instead of repeating its first-time rule
      if (this._spot.kind === "game" && this.found.has(this._spot.id) && this._goal) return { key: `done:${this._spot.id}:${this._goal}`, head: "Found already", html: `Play again if you like. Next up: ${this._goal}` };
      return { key: "spot:" + this._spot.id, head: this._spot.label || "Here", html: spotHelp(this._spot, touch) };
    }
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
    menu.addEventListener("click", e => {
      const it = e.target.closest(".menu-item"); if (!it || it.id === "soundBtn") return;
      this.closeMenu();
      // a keyboard activation (detail 0) must not strand focus on a hidden row: unless the row's overlay took focus, it goes back to the button
      if (e.detail === 0) setTimeout(() => { const a = document.activeElement; if (!a || a === document.body || menu.contains(a)) btn.focus({ preventScroll: true }); }, 60);
    });
    addEventListener("pointerdown", e => { if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) this.closeMenu(); }, true);
    // Tab past the last row (keyboard only: html.kbd) closes the menu; a pointer tap on a row must still reach its click
    menu.addEventListener("focusout", e => {
      if (!document.documentElement.classList.contains("kbd")) return;
      const to = e.relatedTarget; if (to && (menu.contains(to) || to === btn)) return;
      setTimeout(() => { if (!menu.hidden && !menu.contains(document.activeElement) && document.activeElement !== btn) this.closeMenu(); }, 0);
    });
    // overlays make the HUD inert while they are up (and the dock while a game is up): no Tab stop lands on an invisible control
    new MutationObserver(() => this.syncInert()).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    this.syncInert();
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
    // opened from the keyboard: focus moves to the first row (a disclosure, so no menu roles or arrow keys)
    if (document.documentElement.classList.contains("kbd")) this.focusInto($("menu").querySelector(".menu-item:not([hidden])"));
  }
  /* ---- focus plumbing shared by the overlays: remember where focus was, move it in, give it back on close */
  rememberFocus(key) { this._from = this._from || {}; const a = document.activeElement; this._from[key] = a && a !== document.body ? a : null; }
  restoreFocus(key) {
    const a = this._from && this._from[key]; if (this._from) this._from[key] = null;
    if (a && document.contains(a) && !a.closest("[hidden], [aria-hidden='true']") && a.getClientRects().length) { try { a.focus({ preventScroll: true }); return; } catch { /* optional */ } }
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  }
  focusInto(el) {
    if (!el) return;
    const f = () => { try { el.focus({ preventScroll: true }); } catch { /* optional */ } };
    requestAnimationFrame(() => { f(); if (document.activeElement !== el) setTimeout(f, 80); });   // overlays are visibility:hidden until their open class lands
  }
  overlay(name, on) { this._ov = this._ov || new Set(); this._ov[on ? "add" : "delete"](name); this.syncInert(); }
  syncInert() {
    const b = document.body.classList, ov = this._ov || new Set();
    const loading = b.contains("is-loading"), modal = !!this.mapOpen || this.mode === "list" || ov.has("video");
    const set = (el, on) => { if (el && "inert" in el && el.inert !== on) el.inert = on; };
    set(document.querySelector(".hud-top"), loading || modal);
    set(document.querySelector(".hud-bottom"), loading || modal || b.contains("focus"));
    set($("prompt"), modal); set($("focusbar"), modal);
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
  /* R7: two tick rows under "N / N projects discovered": every project found, and the butterflies collected */
  finaleChecks() {
    let ul = $("finaleChecks");
    if (!ul) {
      const st = document.createElement("style");
      st.textContent = ".finale-checks{list-style:none;margin:10px 0 2px;padding:0;display:grid;gap:6px}.finale-checks li{display:flex;align-items:center;gap:9px;font:700 15px/1.25 var(--f-body);color:var(--cel-ink)}.finale-checks svg{flex:none;width:20px;height:20px;padding:2px;border-radius:50%;background:var(--cel-ink);stroke:var(--cream);stroke-width:3;fill:none}.finale-checks li.todo{opacity:.55}.finale-checks li.todo svg{background:transparent;stroke:var(--cel-ink);border:2px solid var(--cel-ink);padding:0}";
      document.head.appendChild(st);
      ul = document.createElement("ul"); ul.id = "finaleChecks"; ul.className = "finale-checks";
      $("finaleMeta").insertAdjacentElement("afterend", ul);
    }
    const bf = (typeof window !== "undefined" && window.__archipelago && window.__archipelago.butterflies) || null;
    const tot = bf ? bf.total || 0 : 0, got = bf ? Math.min(tot, bf.collected || 0) : 0;
    const tick = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9"/></svg>';
    const rows = [[true, `All ${PROJECTS.length} projects found`]];
    if (tot) rows.push([got >= tot, got >= tot ? `All ${tot} butterflies collected` : `${got} of ${tot} butterflies collected`]);
    ul.innerHTML = rows.map(([ok, t]) => `<li class="${ok ? "" : "todo"}">${tick}<span>${t}</span></li>`).join("");
  }
  openFinale() {
    if (this.finaleOpen) return;
    clearInterval(this._fq); this._fq = null;
    this.closeGoal(); this.closeMap();
    this._finaleFrom = document.activeElement;
    this.finaleSeen = true; this.save();
    this.finaleOpen = true;
    this.finaleChecks();
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
    this.toast(`${glyphSvg(p.glyph)} Found it! · ${p.name}`, 2600, { hold: true });
    this.renderCards();
    this.markAllFound();
    return true;
  }

  findSecret(id, label) {
    if (this.secrets.has(id)) return false;
    this.secrets.add(id); this.save();
    this.toast(`Secret ${this.secrets.size} / 3 · ${label}`);
    if (this.onSecret) this.onSecret(id, this.secrets.size);   // R7: other modules chain onto this (night reveal, badges)
    return true;
  }

  toast(html, ms = 2600, { hold = false } = {}) {
    const t = $("toast");
    // a held toast ("Found it!") is not overwritten by the badge or star toast a moment later: those wait their turn
    if (this._toastHold && !hold) { (this._toastQ = this._toastQ || []).push([html, ms]); return; }
    t.innerHTML = html; t.classList.add("show");
    this._toastHold = hold;
    clearTimeout(this._tt); clearTimeout(this._tc);
    this._tt = setTimeout(() => {
      t.classList.remove("show"); this._toastHold = false;
      this._tc = setTimeout(() => { if (!t.classList.contains("show")) t.innerHTML = ""; }, 600);   // the live region empties once faded
      const q = this._toastQ && this._toastQ.shift(); if (q) setTimeout(() => this.toast(q[0], q[1]), 350);
    }, ms);
  }

  hint(html, ms) {
    // the first-run key line ("W A S D walk ... E interact ... M map") shows once, on the first visit, for ~6 s, and
    // never on touch (no keyboard keys there; the on-screen controls say it). Seated / "come back" hints still show.
    const firstRun = /W A S D|Thumb down|Stick to walk/.test(html);
    if (firstRun) {
      let seen = false; try { seen = localStorage.getItem("archipelago.keyhint.v1") === "1"; } catch { /* optional */ }
      const busy = this.panelOpen || this.mapOpen || this.finaleOpen || $("booth").getAttribute("aria-hidden") === "false";
      if (seen || busy) return;   // not while a panel, the map, the booth or the finale is up; it stays unspent for later
      ms = 6000;
      // spent only once it has really been on screen for ~2 s: the prompt wins the shared slot, so a visitor who spawns inside a
      // prompt's reach (Pin Art's) would otherwise never see it. Until then it comes back when the slot frees, three showings at most
      if (!this._keyHint) { this._keyHint = { html, ms, shown: 0, tries: 0 }; this.watchKeyHint(); }
      this._keyHint.tries++;
    }
    const h = $("hint");
    h.innerHTML = html; h.classList.add("show"); this._hintHtml = html;
    clearTimeout(this._ht); clearTimeout(this._hc);
    if (ms) this._ht = setTimeout(() => this.hideHint(), ms);
  }
  hideHint() {
    const h = $("hint"); h.classList.remove("show");
    clearTimeout(this._hc); this._hc = setTimeout(() => { if (!h.classList.contains("show")) { h.innerHTML = ""; this._hintHtml = null; } }, 600);   // the live region empties once faded
  }
  watchKeyHint() {
    clearInterval(this._khT);
    const k = this._keyHint, h = $("hint");
    this._khT = setInterval(() => {
      if (!k || k !== this._keyHint) return clearInterval(this._khT);
      const mine = this._hintHtml === k.html, up = mine && h.classList.contains("show") && parseFloat(getComputedStyle(h).opacity) > 0.85;   // really readable, not mid-fade
      if (up) k.shown += 250;
      if (k.shown >= 2000) { try { localStorage.setItem("archipelago.keyhint.v1", "1"); } catch { /* optional */ } this._keyHint = null; return clearInterval(this._khT); }
      const free = $("prompt").hidden && (this._hintHtml == null || mine) && !this.panelOpen && !this.mapOpen && !this.finaleOpen && !document.body.classList.contains("focus") && !document.body.classList.contains("is-loading");
      if (!h.classList.contains("show") && free && k.tries < 3) this.hint(k.html, k.ms);   // only once it has gone, never mid-fade
    }, 250);
  }

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
    if (!this.panelOpen) this.rememberFocus("panel");
    this.panelOpen = id;
    document.body.classList.add("panel-open");
    setTimeout(() => this.panelOpen && $("panelOpen").focus({ preventScroll: true }), 400);
  }
  closePanel() {
    if (this.panelOpen) this.sound.reading("panel", false);
    const was = this.panelOpen;
    $("panel").classList.remove("open"); $("panel").setAttribute("aria-hidden", "true");
    this.panelOpen = false;
    document.body.classList.remove("panel-open");
    if (was) this.restoreFocus("panel");
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
    if (!this.mapOpen) this.rememberFocus("map");
    $("map").classList.add("open"); $("map").setAttribute("aria-hidden", "false");
    if (!this.mapOpen) { this.sound.reading("map", true); this.focusInto($("mapClose")); }
    this.mapOpen = true; this.syncInert();
  }
  closeMap() {
    const was = this.mapOpen;
    if (this.mapOpen) this.sound.reading("map", false);
    if (this.board) this.board.close();
    $("map").classList.remove("open"); $("map").setAttribute("aria-hidden", "true"); this.mapOpen = false; this.syncInert();
    if (was) this.restoreFocus("map");
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
          <span class="sr-only">Opens in a new tab</span>
        </div>
      </a>`).join("");
  }

  setMode(mode) {
    const was = this.mode;
    if (mode === "list" && was !== "list") this.rememberFocus("list");
    this.mode = mode; this.wakeDock();
    this.sound.reading("list", mode === "list");
    $("list").classList.toggle("open", mode === "list");
    $("list").setAttribute("aria-hidden", mode === "list" ? "false" : "true");
    document.querySelectorAll("#menu [data-mode]").forEach(b => b.setAttribute("aria-current", String(b.dataset.mode === mode)));
    this.syncInert();
    if (mode === "list" && was !== "list") this.focusInto($("listBack").hidden ? $("listHead") : $("listBack"));
    else if (mode !== "list" && was === "list") this.restoreFocus("list");
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
      if (HOWTO[gid] && gid !== "pin-art" && !this._howSeen.has(gid)) {   // Pin Art shows its own how-to card every visit (games/pin-art.js)
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
