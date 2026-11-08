import * as THREE from "three";

/* Gulp: a lime bean with two stubby feet, a big round mouth ringed by nine fat teardrop petal teeth round a small
   hub, one tall eyestalk on top and one angled to the side. Modelled in Blender (blender/build_gulp.py) and exported
   to assets/models/gulp.glb: one skinned mesh with clips ring_Idle / Talk / Swallow / Full / Spit.

   installGulp(g, loader) swaps it into the loaded fauna.glb in place of the fauna.glb FAUNA_ring: same node key,
   same clip names, same lengths and the same beats (reach 0.53, close 0.635, release 0.4), which loadFauna / talk /
   trickGulp in main.js rely on. The eye bones are ring_eye_L / ring_eye_R (blink by scale.y, main.js). The `mouth`
   and `petal_N` bones open the mouth; while Full, the `lips` / `pucker` / `cheek_*` / `lump` bones make him read as
   a stuffed mouth. If gulp.glb fails to load or lacks the node, the fauna.glb Gulp stays. */
/* The eye whites and teeth sit on their own light cel ramp (still 3 hard bands, like toon.js, but all of them
   near white) and carry a little white emissive, so the warm sunset light cannot turn them tan. toonify leaves a
   MeshToonMaterial alone, and the ink filter in main.js skips both names. */
function brightToon(name, color, ramp, glow) {
  const tex = new THREE.DataTexture(new Uint8Array(ramp.flatMap(v => [v, v, v, 255])), ramp.length, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
  const m = new THREE.MeshToonMaterial({ color, gradientMap: tex, emissive: new THREE.Color("#FFFFFF"), emissiveIntensity: glow });
  m.name = name; return m;
}
export async function installGulp(g, loader) {
  try {
    const gl = await new Promise((res, rej) => loader.load("assets/models/gulp.glb", res, undefined, rej));
    const fresh = gl.scene.getObjectByName("FAUNA_ring");
    const clips = gl.animations.filter(c => c.name.startsWith("ring_"));
    if (!fresh || clips.length < 5) throw new Error("gulp.glb has no FAUNA_ring or clips");
    const white = brightToon("Fauna_Sclera", "#FFFFFF", [235, 250, 255], 0.85), tooth = brightToon("Fauna_Tooth", "#FFFBF0", [215, 238, 255], 0.55);
    fresh.traverse(o => { if (o.isMesh && o.material) { if (o.material.name === "Fauna_Sclera") o.material = white; else if (o.material.name === "Fauna_Tooth") o.material = tooth; } });
    const old = g.scene.getObjectByName("FAUNA_ring");
    fresh.removeFromParent();
    g.scene.add(fresh);
    if (old) old.removeFromParent();
    g.animations = g.animations.filter(c => !c.name.startsWith("ring_")).concat(clips);
    return true;
  } catch (e) { console.error("Gulp remake failed, keeping the old one", e); return false; }
}
