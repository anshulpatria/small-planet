/* Lumen: the round white glow-hands with one eye on a stalk, modelled in blender/tt/build_lumen_tt.py and
   shipped as assets/models/lumen.glb (skinned, the 17 hammer_* bones, clips hammer_Idle / hammer_Talk /
   hammer_Touch with fauna.glb's lengths and trickLumen's beats: touchOn 1.14, touchOff 1.94).

   installLumen(g, loader) is the only hook into main.js: loadFauna() calls it right after the fauna.glb loads.
   It swaps fauna.glb's FAUNA_hammer node and every hammer_* clip for the new ones (same key, same clip names). The hands use the
   material Fauna_HandGlow, which main.js finds and pulses during the touch. If lumen.glb fails to load or lacks a
   bone the clips need, the original fauna.glb Lumen stays. */
const CLIPS = ["hammer_Idle", "hammer_Talk", "hammer_Touch"];
const BONES = ["root", "hips", "chest", "neck", "head", "eye_L", "eye_R", "arm_L", "fore_L", "hand_L", "arm_R", "fore_R", "hand_R", "leg_L", "leg_R", "foot_L", "foot_R"];

export async function installLumen(g, loader, url = "assets/models/lumen.glb") {
  try {
    const gl = await new Promise(r => loader.load(url, r, undefined, () => r(null)));
    if (!gl) throw new Error("lumen.glb did not load");
    const node = gl.scene.getObjectByName("FAUNA_hammer");
    const clips = gl.animations.filter(c => c.name.startsWith("hammer_"));
    if (!node || BONES.some(b => !node.getObjectByName("hammer_" + b)) || CLIPS.some(n => !clips.some(c => c.name === n))) throw new Error("lumen.glb is missing the node, a bone or a clip");
    const old = g.scene.getObjectByName("FAUNA_hammer");
    node.userData.glb = url;   // which file this creature came from (read by the evidence eval)
    // the flipper tips (last ~30%, material Fauna_Hand, inked) are a faint warm yellow at rest and glow #FFC53A in
    // trickLumen. toonify() drops emissive, so on the first draw give the tip the same 0.32 lift main.js gives Fauna_Pearl.
    node.traverse(o => { if (o.isMesh && o.material && o.material.name === "Fauna_Hand") o.onBeforeRender = function () {
      const m = this.material; if (m && m.emissive && !m.userData.lumenLift) { m.userData.lumenLift = 1; m.emissive.set("#FBE6A8"); m.emissiveIntensity = 0.32; } }; });
    node.removeFromParent();
    g.scene.add(node);
    if (old) old.removeFromParent();
    g.animations = g.animations.filter(c => !c.name.startsWith("hammer_")).concat(clips);
    return true;
  } catch (e) { console.warn("Lumen remake failed, keeping the original:", e.message || e); return false; }
}
