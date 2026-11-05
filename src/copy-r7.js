/* R7 copy (track T5): the constellation's name, AP's rotating lines, and the "have you been to the moon" latch.
   Pure data plus two tiny helpers; nothing here touches rendering. */

/* C1. The one place the constellation's name lives: swap this string and every toast follows.
   Shortlist (first is shipped): Blip's Dipper, The Little Walker, Moonlight Five, The Lopsided Kite, Stardust Kettle. */
export const CONSTELLATION_NAME = "Blip's Dipper";

/* "Moon visited" has no flag in the save, so moonwalk.js's per-frame update latches it here the first time Blip stands on the moon.
   Key is under archipelago.* so Restart journey clears it. */
const MOON_KEY = "archipelago.r7.moonSeen", KNOCK_KEY = "archipelago.r7.apKnocks";
export const moonVisited = () => { try { return localStorage.getItem(MOON_KEY) === "1"; } catch { return false; } };
export const markMoonVisited = () => { try { if (localStorage.getItem(MOON_KEY) !== "1") localStorage.setItem(MOON_KEY, "1"); } catch { /* optional */ } };
export const apKnocks = () => { try { return +localStorage.getItem(KNOCK_KEY) || 0; } catch { return 0; } };
export const bumpApKnocks = () => { try { localStorage.setItem(KNOCK_KEY, String(apKnocks() + 1)); } catch { /* optional */ } };

/* D1. The user's words, exactly. */
export const AP_HEY = "...hey";
export const AP_FIRST = "Go collect butterflies. Have you been to the moon yet?";

/* D2. The pool. Each line has a `when(s)` over the state { moon, butterflies: {got,total}|null, allFound, butterfliesDone }, and
   `text` is a string or a function of the state. Order matters only for the rotation, which never repeats the last line. */
export const AP_POOL = [
  { id: "cooking", when: () => true, text: "Something's cooking, please come back later." },
  { id: "moon-ask", when: s => !s.moon, text: "Have you been to the moon yet?" },
  { id: "moon-cannon", when: s => !s.moon, text: "The big white thing in the sky is not decoration. The cannon is free." },
  { id: "moon-commute", when: s => !s.moon, text: "There's a whole project on the moon. I'd go, but the commute." },
  { id: "bf-hobby", when: s => !s.butterfliesDone, text: "Go collect butterflies. They won't catch themselves. I've tried." },
  { id: "bf-count", when: s => !s.butterfliesDone && s.butterflies && s.butterflies.total > s.butterflies.got,
    text: s => { const n = s.butterflies.total - s.butterflies.got; return `${n} ${n === 1 ? "butterfly" : "butterflies"} still out there. Not that I'm counting. ${n}.`; } },
  { id: "moon-flag", when: s => s.moon, text: "Moon's good, right? The flag is very proud of itself." },
  { id: "done-bench", when: s => s.allFound && s.butterfliesDone, text: "You've seen everything. Honestly, go sit on a bench." },
  { id: "done-impressed", when: s => s.allFound && s.butterfliesDone, text: "Nothing left to find. I'll pretend I'm not impressed." },
  { id: "knock", when: () => true, text: "You knock a lot. Respect. I'm still not coming out for long." },
];

let last = null, forced = null;
export const forceApId = id => { forced = id; };   // test hook: the next pick uses this pool id once
/* Pick a line for this knock. The very first knock ever is always the user's greeting; after that, a random state-valid line,
   never the one before it. `rnd` is injectable for tests. */
export function pickApLine(s, rnd = Math.random) {
  if (apKnocks() === 0) { last = "first"; return AP_FIRST; }
  const ok = AP_POOL.filter(l => l.when(s) && l.id !== last);
  const l = (forced && AP_POOL.find(x => x.id === forced)) || ok[Math.floor(rnd() * ok.length)] || AP_POOL[0];
  forced = null;
  last = l.id;
  return typeof l.text === "function" ? l.text(s) : l.text;
}
export const lastApId = () => last;   // test hook
