/* Chomp (FAUNA_gnash), built by blender/build_chomp.py -> assets/models/chomp.glb.
   Same contract as fauna.glb's own creature: object FAUNA_gnash, bones gnash_*, clips gnash_Idle /
   gnash_Talk / gnash_Snap (snap beat 1.12 s). If the file fails, fauna.glb's own Chomp stays. */
export async function installChomp(g, loader) {
  try {
    const c = await new Promise(r => loader.load("assets/models/chomp.glb", r, undefined, () => r(null)));
    const root = c && c.scene.getObjectByName("FAUNA_gnash");
    if (!root || !c.animations.some(a => a.name === "gnash_Snap")) return;
    const old = g.scene.getObjectByName("FAUNA_gnash");
    root.removeFromParent();
    g.scene.add(root);
    if (old) old.removeFromParent();
    g.animations = g.animations.filter(a => !a.name.startsWith("gnash_")).concat(c.animations.filter(a => a.name.startsWith("gnash_")));
  } catch (e) { console.error("Chomp remake failed, keeping the old one", e); }
}
