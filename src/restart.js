/* R7 T3: "Restart journey". One button in #menu and one small button on the Collector's dock, both appended at runtime
   (no edit to index.html / ui.js / styles.css). Each opens one confirm ("Start over?", which says what goes); confirming
   clears every saved key the game owns except the sound preference, then reloads.
   The modal reuses the house classes (.finale card, .btn-cel, .finale-stay), so it adds no new look and no ring. */

export const KEEP_KEYS = ["archipelago.audio.muted"];   // restarting must not unmute
export const PREFIX = "archipelago.";
export const EXTRA_KEYS = ["gravityPong.best"];         // the only progress key outside the prefix (games/gravity-pong.js BEST_KEY)

/* which keys a restart clears, from the list of every key in storage (pure, so node can test it) */
export function keysToClear(allKeys) {
  return allKeys.filter(k => (k.startsWith(PREFIX) || EXTRA_KEYS.includes(k)) && !KEEP_KEYS.includes(k));
}
export function clearProgress(storage) {
  const all = []; for (let i = 0; i < storage.length; i++) all.push(storage.key(i));
  const gone = keysToClear(all);
  for (const k of gone) storage.removeItem(k);
  return gone;
}

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none"><path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M17 3.5v4h-4"/></svg>';   // drawn like the dock glyphs (projects.js GLYPHS): 24 box, plain strokes, the coin's own stroke rule
const CSS = `
.r7-restart-item{position:relative;margin-top:8px}
.r7-restart-item::before{content:"";position:absolute;left:10px;right:10px;top:-5px;border-top:2px solid var(--cream-lo)}
.r7-restart-dock.tok{--c:var(--cel-grey,#E6E7E2);--lo:var(--cel-grey-lo,#BABCB3)}   /* R7: exactly a found project coin (.tok.found: ring, shadow, gloss, hover, focus); only the colour pair and the glyph differ */
.r7-restart-item svg{fill:none;stroke:var(--cel-ink);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.r7-restart-modal .finale-card{width:min(420px,100%)}
`;

export function installRestart() {
  if (installRestart.done) return; installRestart.done = true;
  const st = document.createElement("style"); st.id = "r7-restart-style"; st.textContent = CSS; document.head.appendChild(st);
  // the only destructive row sits last in the menu, under a rule (rewards.js inserts its row above this one)

  /* ---- the confirm: a .finale card, so it looks like the finale (cream card over the blurred scene) */
  const modal = document.createElement("section");
  modal.className = "finale r7-modal r7-restart-modal";
  modal.id = "r7RestartModal";
  modal.setAttribute("role", "alertdialog"); modal.setAttribute("aria-modal", "true"); modal.setAttribute("aria-hidden", "true");
  modal.setAttribute("aria-labelledby", "r7RestartHead"); modal.setAttribute("aria-describedby", "r7RestartText");
  modal.innerHTML = `<div class="finale-card">
    <h2 id="r7RestartHead">Start over?</h2>
    <p id="r7RestartText" class="finale-text">This clears your found projects, butterflies, stars, secrets, badges, Blip’s outfit and your Gravity Pong best. Sound settings stay. Your butterflies fly home.</p>
    <div class="finale-actions">
      <button id="r7RestartNo" class="btn-cel" type="button">Keep playing</button>
      <button id="r7RestartYes" class="finale-stay" type="button">Start over</button>
    </div></div>`;
  modal.hidden = true;
  // The card lives in the DOM only while it is shown: the global Escape / B branch for .r7-modal (ui.js) otherwise "closes" it
  // even when it is not open, and swallows the first Escape that should leave a mini-game.
  const yes = modal.querySelector("#r7RestartYes"), no = modal.querySelector("#r7RestartNo");
  let opener = null;

  const isOpen = () => modal.classList.contains("open") && !modal.hidden;
  const close = () => {
    modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true"); modal.hidden = true;
    setTimeout(() => { if (!isOpen()) modal.remove(); }, 520);   // after the fade
    const o = opener; opener = null;
    if (o && document.contains(o)) try { o.focus({ preventScroll: true }); } catch { /* optional */ }
  };
  // the global "Escape / B closes any .r7-modal" branch (T1) hides a modal with the hidden attribute; follow it so the card really goes
  new MutationObserver(() => { if (modal.hidden && modal.classList.contains("open")) close(); }).observe(modal, { attributes: true, attributeFilter: ["hidden"] });
  const open = from => {
    if (isOpen()) return;
    opener = from || document.activeElement;
    modal.hidden = false;
    if (!modal.isConnected) { document.body.appendChild(modal); void modal.offsetWidth; }   // flush styles so the fade-in runs
    modal.classList.add("open"); modal.setAttribute("aria-hidden", "false");
    // the safe choice first (A / Enter on the pad or keyboard keeps playing). .finale is visibility:hidden until its fade starts, so retry briefly
    let tries = 0;
    const focusNo = () => { no.focus({ preventScroll: true }); if (isOpen() && document.activeElement !== no && ++tries < 12) setTimeout(focusNo, 40); };
    focusNo();
  };
  const confirm = () => {
    // a save() that fires between the clear and the reload must not write the old progress back
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (this === localStorage && (String(k).startsWith(PREFIX) || EXTRA_KEYS.includes(String(k))) && !KEEP_KEYS.includes(String(k))) return; return set.call(this, k, v); };
    try { clearProgress(localStorage); } catch { /* private window: nothing was stored */ }
    location.reload();
  };
  yes.addEventListener("click", confirm);
  no.addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });
  // Escape closes the confirm (capture phase, so the game's own Escape never also fires). Tab stays inside the two buttons.
  addEventListener("keydown", e => {
    if (!isOpen()) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    else if (e.key === "Tab") { e.preventDefault(); (document.activeElement === no ? yes : no).focus({ preventScroll: true }); }
  }, true);

  /* ---- the menu row (same classes as the other rows) */
  const menu = document.getElementById("menu");
  if (menu && !menu.querySelector(".r7-restart-item")) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "menu-item r7-restart-item";
    b.setAttribute("aria-label", "Restart journey: start over from the beginning");
    b.setAttribute("aria-haspopup", "dialog");
    b.innerHTML = `${ICON}<span class="mi-t">Restart journey</span>`;
    b.addEventListener("click", () => open(document.getElementById("menuBtn") || b));
    menu.appendChild(b);
  }

  /* ---- the dock button: a real button, the last coin on the dock row (right end), same size as the project coins */
  const dock = document.getElementById("dock");
  if (dock && !dock.querySelector(".r7-restart-dock")) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "tok found r7-restart-dock"; b.title = "Restart journey";
    b.setAttribute("aria-label", "Restart journey: start over from the beginning");
    b.setAttribute("aria-haspopup", "dialog");
    b.innerHTML = ICON;
    b.addEventListener("click", () => open(b));
    // inside the coin row (an <li> after the 10 project coins), so it stays on that line in both dock layouts (the flex bar, and the
    // finished 10/10 grid with "Say hello"); ui.js builds the row once in setup, before this runs
    const row = document.getElementById("glyphs"), li = document.createElement("li"); li.className = "r7-restart-li"; li.appendChild(b);
    (row || dock).appendChild(row ? li : b);
  }
  return { open, close, isOpen };
}
