import * as THREE from "three";

/* R7: night, a secret. Clicking the signal ring three times (main.js) calls goDark(): the sun sinks, the Milky Way sky and the
   fireflies fade in (sky.js, nightsky.js), a UFO silhouette hangs in the sky and the radio plays its voice (onNight). Three more
   clicks bring the day back, and it dawns by itself after NIGHT_S. Nothing is saved: every visit starts in daylight. There is no
   switch in the UI, by design (it is found by accident).
   - Night is driven only through sky.setSun({ elevation }) (sky.js fades light, shadows, background and fog on it) plus the
     night terms in sky.js's shader (zero by day). Night OFF restores elevation 32 exactly, so the day render is the baseline's. */

const DAY_ELEV = 32, NIGHT_ELEV = -14;      // degrees: the shipped sunset, and a sun well under the horizon
const FADE_S = 1.5, HOLD_S = 3.2;           // the reveal: 1.5 + 3.2 + 1.5 = 6.2 s
export function installNight({ scene, sky, ui, camera, spots = [], bodies = {}, onNight = null }) {
  let keep = false;          // night kept on (set by the signal ring; never saved: day by default on every visit)
  let p = 0, k = 0, goal = 0, raf = 0, reveal = null;   // p: linear 0 day .. 1 night; k: its ease

  // ---- the sky: one lever, sky.setSun({ elevation }) ----
  const apply = () => {
    if (typeof ufo !== "undefined") ufo.visible = ufoArmed && k > 0.6;   // R7 UFO: only in a real night the player switched on
    if (k <= 0.0001) { k = 0; sky.setSun({ elevation: DAY_ELEV }); return; }
    sky.setSun({ elevation: DAY_ELEV + (NIGHT_ELEV - DAY_ELEV) * k });
  };
  import("./nightsky.js?v=20261108-2312").then(m => m.installFireflies({ scene, bodies, getK: () => k }));   // R7: fireflies (night only; lazy so first paint is untouched)
  const ease = x => x * x * (3 - 2 * x);
  let last = 0;
  const tick = now => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (reveal) {
      reveal.t += dt;
      goal = reveal.t < FADE_S + HOLD_S ? 1 : 0;
      if (reveal.t >= FADE_S * 2 + HOLD_S) { reveal = null; goal = keep ? 1 : 0; }
    }
    const step = dt / FADE_S;   // progress p moves linearly; k is its ease
    p = goal > p ? Math.min(goal, p + step) : Math.max(goal, p - step);
    k = ease(p); apply();
    raf = (p !== goal || reveal) ? requestAnimationFrame(tick) : 0;
  };
  const go = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } };
  const set = (on, instant) => {
    keep = on; reveal = null; goal = on ? 1 : 0;
    if (instant) { p = goal; k = ease(p); apply(); } else go();
  };
  // R7: the signal ring (three clicks) switches the sun off too: night on and kept, the toggle unlocked, the UFO, the radio voice
  const NIGHT_S = 90;   // a ring night lasts this long, then dawn comes by itself (or click the ring three times again)
  let dawnT = 0;
  const goDark = () => {
    clearTimeout(dawnT);
    if (keep) { set(false); return "day"; }   // the ring again: the sun comes back
    set(true); placeUfo(); if (onNight) onNight();
    dawnT = setTimeout(() => { if (keep) set(false); }, NIGHT_S * 1000);
    return "night";
  };

  /* ---- R7: the UFO. With the sun switched off, a saucer silhouette hangs far off in the night sky: a shape a shade darker than
     the sky, three dim lights, drifting slowly and now and then not quite there. Shown only at night; placed ahead and to one
     side of the lens each time the sun goes off, ~650 m out, so it reads as distant and barely moves with Blip. ---- */
  const ufoTex = (() => {
    const c = document.createElement("canvas"); c.width = 256; c.height = 128; const g = c.getContext("2d");
    g.fillStyle = "#070A18";
    g.beginPath(); g.ellipse(128, 60, 46, 26, 0, Math.PI, 0); g.fill();            // the dome
    g.beginPath(); g.ellipse(128, 72, 118, 20, 0, 0, Math.PI * 2); g.fill();     // the rim
    g.fillStyle = "#F4E7C2"; for (const x of [70, 128, 186]) { g.globalAlpha = x === 128 ? 0.55 : 0.35; g.beginPath(); g.arc(x, 76, 4.5, 0, Math.PI * 2); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const ufo = new THREE.Sprite(new THREE.SpriteMaterial({ map: ufoTex, transparent: true, depthWrite: false, fog: false, opacity: 0 }));
  ufo.scale.set(34, 17, 1); ufo.visible = false; ufo.renderOrder = -1; ufo.frustumCulled = false; scene.add(ufo);
  const ufoHome = new THREE.Vector3(), ufoSide = new THREE.Vector3(); let ufoArmed = false;
  function placeUfo() {
    if (!camera) return;
    // the upper right of the current frame (screen axes), 600 m out: far past the little planet, so it is open night sky
    camera.updateMatrixWorld();
    const fwd = new THREE.Vector3(), sUp = new THREE.Vector3(), sRight = new THREE.Vector3();
    camera.getWorldDirection(fwd); sRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize(); sUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    ufoSide.copy(sRight);
    const dir = fwd.clone().addScaledVector(sUp, 0.3).addScaledVector(sRight, 0.42).normalize();
    ufoHome.copy(camera.position).addScaledVector(dir, 600);
    ufo.position.copy(ufoHome); ufoArmed = true; ufo.visible = k > 0.6;
  }
  ufo.onBeforeRender = () => {
    const t = performance.now() / 1000;
    ufo.position.copy(ufoHome).addScaledVector(ufoSide, Math.sin(t * 0.05) * 60).addScaledVector(camera ? camera.up : ufoSide, Math.sin(t * 0.7) * 2.5);   // a slow sideways drift and a gentle bob
    const flicker = (t % 9) < 0.35 ? 0.15 : 1;   // every 9 s it is briefly not quite there
    ufo.material.opacity = Math.max(0, (k - 0.6) / 0.4) * 0.92 * flicker;
  };

  const api = { get k() { return k; }, get keep() { return keep; }, get revealing() { return !!reveal; }, set, ufo, placeUfo, goDark };
  window.__night = api;
  return api;
}
