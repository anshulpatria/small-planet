/* Save-state rule for the butterflies. Pure: no DOM, no three, so tests/butterfly-save.smoke.mjs
   runs it in node. Every visit starts with zero butterflies: none following Blip, a 0 count, every one wild at its
   spot. archipelago.v1 -> puzzles.butterflies (a list of collected spot ids the game itself never writes) is therefore
   never restored; any list found there, partial or complete, is cleared. Collecting, the celebration and the
   scatter all happen within one visit. */
export const SAVE_VERSION = 2;
export function cleanButterflies(saved) {
  return { saved: [], cleared: Array.isArray(saved) && saved.length > 0 };
}
/* the whole archipelago.v1 object in, a new one out (never mutates); `changed` says whether it needs writing back */
export function migrateSave(st) {
  const s = st && typeof st === "object" ? st : {}, puzzles = { ...(s.puzzles || { gates: {} }) };
  const r = cleanButterflies(puzzles.butterflies);
  const changed = r.cleared || s.v !== SAVE_VERSION;
  if (puzzles.butterflies !== undefined || r.cleared) puzzles.butterflies = r.saved;
  return { state: { ...s, v: SAVE_VERSION, puzzles }, changed, cleared: r.cleared };
}

/* where each butterfly goes in the celebration scatter. entries: [{origin}] (the body of its original
   spot, or null). Result per entry: the PLANET, except an entry whose origin is another body keeps that
   body (it returns to its original spot). Independent of where Blip stands when the last one is collected. */
export function planScatter(entries, planet) {
  return entries.map(e => (e.origin && e.origin !== planet ? e.origin : planet));
}

/* Save-state migration for the moon's fallen stars. archipelago.v1 -> puzzles.stars is the list of star indices that
   have flown home. A list with no STARS_VERSION stamp beside it was written before the stars flew home as real stars:
   restored, it is a finished constellation with nothing left on the moon, so the player never sees a star arrive. It is
   cleared, once (the stamp is written when a star lands). A stamped list is real progress and is kept; bad and repeated
   indices are dropped. */
export const STARS_VERSION = 2;
export function cleanStars(saved, count, version) {
  const list = Array.isArray(saved) ? [...new Set(saved.filter(i => Number.isInteger(i) && i >= 0 && i < count))] : [];
  const stale = version !== STARS_VERSION && list.length > 0;
  return { saved: stale ? [] : list, cleared: stale };
}
