import * as THREE from "three";

/* Wooden signposts: a post and a stack of arrow-shaped planks, each pointing along the
   planet's surface (the great circle) toward its place. The names are burnt into the wood
   itself in the homepage's display face (Bricolage Grotesque): dark scorched letters with a
   thin lit lip below them, on a transparent texture laid flush on the plank. */

const WOOD = new THREE.Color("#C98B6B"), WOOD_DARK = new THREE.Color("#9C6447");
const FONT = '700 60px "Bricolage Grotesque"';
let plankGeo;
function arrowPlank() {
  if (plankGeo) return plankGeo;
  const L = 2.3, H = 0.46, tip = 0.36;
  const s = new THREE.Shape();
  s.moveTo(-L / 2, -H / 2); s.lineTo(L / 2 - tip, -H / 2); s.lineTo(L / 2, 0); s.lineTo(L / 2 - tip, H / 2); s.lineTo(-L / 2, H / 2); s.closePath();
  plankGeo = new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.02, bevelSegments: 2 });
  plankGeo.translate(L / 2 - 0.1, 0, -0.04);   // pivot near the post
  return plankGeo;
}

/* the site fonts arrive from Google Fonts; a canvas drawn before they land silently uses a
   fallback face, so every lettering call waits for them first */
export const fontsReady = (async () => {
  try { await Promise.all([document.fonts.load(FONT), document.fonts.load('600 40px "Instrument Sans"'), document.fonts.load('700 60px "Bricolage Grotesque"')]); } catch { /* offline: fallback face */ }
})();

function engraving(text) {
  const cv = document.createElement("canvas"); cv.width = 512; cv.height = 96;
  const g = cv.getContext("2d");
  g.font = FONT; g.textBaseline = "middle"; g.textAlign = "left";
  g.fontVariationSettings = '"wdth" 85';
  // lit lower lip of the groove, then the scorched letter on top of it
  g.fillStyle = "rgba(255,226,190,0.55)"; g.fillText(text, 24, 54, 450);
  g.fillStyle = "#4A2615"; g.fillText(text, 24, 51, 450);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/* pos: world point on the ground; up: ground normal; targets: [{label, pos}] */
export function makeSignpost(scene, pos, up, targets, toonify, outline) {
  const root = new THREE.Group();
  root.position.copy(pos);
  root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 3.3, 10), new THREE.MeshStandardMaterial({ color: WOOD_DARK }));
  post.name = "SIGN_post"; post.position.y = 1.65; post.castShadow = true; root.add(post);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.22, 10), new THREE.MeshStandardMaterial({ color: WOOD_DARK }));
  cap.name = "SIGN_cap"; cap.position.y = 3.4; root.add(cap);
  const inv = root.quaternion.clone().invert();
  const faces = [];
  targets.slice(0, 4).forEach((t, i) => {
    // direction to the target along the surface, expressed in the post's local frame
    const d = t.pos.clone().sub(pos); d.addScaledVector(up, -d.dot(up)).normalize().applyQuaternion(inv);
    const arm = new THREE.Group();
    arm.position.y = 2.85 - i * 0.58;
    arm.rotation.y = Math.atan2(-d.z, d.x);
    const plank = new THREE.Mesh(arrowPlank(), new THREE.MeshStandardMaterial({ color: WOOD }));
    plank.name = "SIGN_plank"; plank.castShadow = true;
    arm.add(plank);
    for (const side of [1, -1]) {
      // lit with the plank (toon), transparent everywhere but the letters, a hair off the wood
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 0.33), new THREE.MeshToonMaterial({ transparent: true, alphaTest: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      face.name = "SIGN_label"; face.position.set(0.95, 0, side * 0.0655);
      if (side < 0) face.rotation.y = Math.PI;   // mirrored side still reads left-to-right
      face.userData.label = t.label; face.userData.isLabel = true;
      arm.add(face); faces.push(face);
    }
    arm.rotation.z = (i % 2 ? -1 : 1) * 0.04;     // hand-hammered wonk
    root.add(arm);
  });
  scene.add(root);
  toonify(root);
  fontsReady.then(() => faces.forEach(f => { f.material.map = engraving(f.userData.label); f.material.needsUpdate = true; }));
  // ink the post, the cap AND every arm plank: the planks are one shared extrusion, ink is a back-face hull pushed
  // INK_PX on screen, so it is as steady as on the post; the burnt-letter planes are flat decals and stay un-inked.
  // Every part is named: the occluder fade pairs a mesh with its sibling "<name>_outline" when it has no hull of its own,
  // and an unnamed label plane would take the plank's hull ("_outline") and leave it wearing a see-through fade clone
  outline(root, "#1E1F26", o => !o.userData.isLabel);
  return root;
}
