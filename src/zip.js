/* Zip: the amber hammerhead, modelled in blender/build_zip.py and shipped as
   assets/models/zip.glb (skinned, 10 bones scoot_*, clips scoot_Idle / scoot_Talk / scoot_Bow).

   installZip(g, loader) is Zip's only hook into main.js: loadFauna() calls it right after the fauna.glb loads.
   It swaps fauna.glb's FAUNA_scoot node (and every scoot_* clip) for the new ones under the same node key and clip
   prefix, so FAUNA, talk() and the idle layer (lifeSetup finds scoot_head / scoot_tail1 / scoot_tail2 by name)
   keep working. scoot_Bow bows the T head down over Blip (hold 1.14 s to 1.94 s: the beats patOn / patOff that
   trickZip uses for Blip's pat and Zip's happy squish). If zip.glb fails to load or lacks a clip, fauna.glb's
   crab-like Zip stays. */
const NEEDED = ["scoot_Idle", "scoot_Talk", "scoot_Bow"];

export async function installZip(g, loader, url = "assets/models/zip.glb") {
  try {
    const gl = await new Promise(r => loader.load(url, r, undefined, () => r(null)));
    if (!gl) throw new Error("zip.glb did not load");
    const node = gl.scene.getObjectByName("FAUNA_scoot");
    const clips = gl.animations.filter(c => c.name.startsWith("scoot_"));
    if (!node || NEEDED.some(n => !clips.some(c => c.name === n))) throw new Error("zip.glb is missing the node or a clip");
    const old = g.scene.getObjectByName("FAUNA_scoot");
    node.userData.glb = url;   // which file this creature came from (read by the evidence eval)
    node.removeFromParent();
    g.scene.add(node);
    if (old) old.removeFromParent();
    g.animations = g.animations.filter(c => !c.name.startsWith("scoot_")).concat(clips);
    return true;
  } catch (e) { console.warn("Zip remake failed, keeping the old one:", e.message || e); return false; }
}
