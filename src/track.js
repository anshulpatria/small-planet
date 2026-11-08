/* Anonymous visitor stats via Umami Cloud (cookieless: no cookies, no IPs stored, no personal data; country comes from
   Umami's server-side lookup and is all it keeps of location).
   What it records:
     - a page view on load (Umami shows countries, visitors and the average visit time from this);
     - "leave" with { seconds } when the tab is hidden or closed, so the visit time covers the whole stay in this one-page game;
     - "download" with { file: wallpaper-phone | wallpaper-desktop | stl | 3mf } for each reward download.
   Off until UMAMI_ID is set to the website ID from cloud.umami.is (Settings → Websites → Add website). Also off on
   localhost, so dev play never counts. Every call is a no-op when off, and nothing here can throw into the game. */
const UMAMI_ID = "0926a79e-ab59-4e3d-92c1-cea763c735e4";
const SRC = "https://cloud.umami.is/script.js";

const on = () => !!UMAMI_ID && typeof location !== "undefined" && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const queue = [];
let t0 = typeof performance !== "undefined" ? performance.now() : 0, left = false;

export function track(name, data) {
  if (!on()) return;
  try {
    const u = window.umami;
    if (u && typeof u.track === "function") u.track(name, data); else if (queue.length < 20) queue.push([name, data]);
  } catch (_) { /* stats never break the game */ }
}

export function installTracking() {
  if (!on()) return;
  try {
    const s = document.createElement("script");
    s.defer = true; s.src = SRC; s.dataset.websiteId = UMAMI_ID; s.dataset.doNotTrack = "true";
    s.onload = () => { const q = queue.splice(0); for (const [n, d] of q) track(n, d); };
    document.head.appendChild(s);
    const leave = () => {
      if (left) return; left = true;
      track("leave", { seconds: Math.round((performance.now() - t0) / 1000) });
    };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") leave();
      else if (left) { left = false; t0 = performance.now(); }   // back on the tab: time the next stretch
    });
    addEventListener("pagehide", leave);
  } catch (_) { /* optional */ }
}
