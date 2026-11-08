import * as THREE from "three";
import { OPTIONS, load } from "./customise.js?v=20261108-2229";
import { toonify, outline } from "./toon.js?v=20261108-2229";

/* Blip's flag on the moon. The moon's own blue MOON_flag (and its ink hull) is hidden at load; its spot becomes
   "Plant your flag". Pressing E walks Blip up to it, and a small flag in Blip's own body colour (read from the photo
   booth customiser when it is planted, so it matches him) is pushed down into the moon: a dust puff on the impact, a
   damped wobble, then Blip cheers. It stays for the visit (like the stars and butterflies, nothing is saved).

   setupMoonFlag(ctx) -> { planted } ; ctx = { root (the moon island), moon (Body), spots, getPlayer, rig, fx, ui, tween, sleep } */
const POLE = { h: 1.35, r: 0.032 }, CLOTH = { w: 0.52, h: 0.34, d: 0.03, waves: 1.5, amp: 0.035 };
const PLANT = { reach: 1.1, walk: 0.45, drop: 0.8, fall: 0.32, wobble: 0.9, tilt: 0.16 };
const SHOT = { side: 4.4, lift: 1.1, look: 0.7 };   // the side-on shot: m out across the Blip-flag line, m up, m above the ground it looks at (so Blip never hides the flag)   // m from the pole Blip stands; s to walk up; m it falls from; s; s; rad of the first sway

function blipColour() {
  const st = load(), c = OPTIONS.colour.find(o => o.id === st.colour) || OPTIONS.colour.find(o => o.id === "teal");
  return c.body;
}

/* K2: the headgear Blip wears, screen-printed on the cloth. Flat shapes only: a cream fill and a navy ink line on the
   cloth's own colour (the cream and ink never shade), one drawing per customiser antenna, on a face-and-head crest.
   Read once when the flag is planted: the planted flag is a memento of that visit and does not follow later booth changes. */
const INK = "#1E1F26", CREAM = "#FFF1CE", PRINT = { w: 520, h: 340 };
function emblemTexture(antenna, ground) {
  const cv = document.createElement("canvas"); cv.width = PRINT.w; cv.height = PRINT.h;
  const c = cv.getContext("2d"); c.lineJoin = c.lineCap = "round";
  c.fillStyle = ground; c.fillRect(0, 0, PRINT.w, PRINT.h);   // the cloth colour is in the texture, so the material stays white and the print never tints
  const blob = (x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = CREAM; c.fill(); c.lineWidth = 9; c.strokeStyle = INK; c.stroke(); };
  const line = (pts, w = 14) => {   // an inked stalk: ink wide, cream narrow on top
    for (const [lw, col] of [[w, INK], [w - 9, CREAM]]) { c.beginPath(); c.moveTo(...pts[0]); for (let i = 1; i < pts.length; i++) c.lineTo(...pts[i]); c.lineWidth = lw; c.strokeStyle = col; c.stroke(); }
  };
  const curve = (a, b, d, w) => { const pts = []; for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push([a[0] + (b[0] - a[0]) * t + d * Math.sin(Math.PI * t), a[1] + (b[1] - a[1]) * t]); } line(pts, w); };
  const X = PRINT.w / 2, TOP = 170;   // the crown, where the antenna starts
  if (antenna === "bulb") {
    curve([X, TOP], [X + 8, 100], 14); blob(X + 10, 66, 36);
    c.lineWidth = 6; c.strokeStyle = INK; c.beginPath(); c.moveTo(X - 6, 74); c.lineTo(X + 2, 56); c.lineTo(X + 12, 74); c.lineTo(X + 22, 56); c.stroke();
    c.fillStyle = INK; c.fillRect(X - 10, 96, 40, 12);
  } else if (antenna === "spring") {
    const pts = []; for (let i = 0; i <= 60; i++) { const t = i / 60; pts.push([X + 26 * Math.sin(t * Math.PI * 7), TOP - 16 - t * 92]); } line(pts, 14); blob(X, 40, 22);
  } else if (antenna === "leaf") {
    line([[X, TOP], [X, 88]], 14);
    const leaf = k => { c.save(); c.translate(X, 112); c.rotate(k * 0.9); c.beginPath(); c.ellipse(k * 36, -20, 40, 18, 0, 0, Math.PI * 2); c.fillStyle = CREAM; c.fill(); c.lineWidth = 9; c.strokeStyle = INK; c.stroke(); c.restore(); };
    leaf(1); leaf(-1); blob(X, 80, 14);
  } else {   // sprouts (the default): two stalks, two buds
    curve([X - 18, TOP], [X - 56, 78], -20); blob(X - 60, 64, 24);
    curve([X + 18, TOP], [X + 52, 92], 18); blob(X + 56, 78, 19);
  }
  // the head: a rounded square with Blip's one big eye
  const hx = X - 92, hy = TOP - 6, hw = 184, hh = 150, r = 38;
  c.beginPath(); c.moveTo(hx + r, hy); c.arcTo(hx + hw, hy, hx + hw, hy + hh, r); c.arcTo(hx + hw, hy + hh, hx, hy + hh, r); c.arcTo(hx, hy + hh, hx, hy, r); c.arcTo(hx, hy, hx + hw, hy, r); c.closePath();
  c.fillStyle = CREAM; c.fill(); c.lineWidth = 10; c.strokeStyle = INK; c.stroke();
  c.beginPath(); c.ellipse(X, hy + 74, 36, 40, 0, 0, Math.PI * 2); c.fillStyle = INK; c.fill();
  c.beginPath(); c.arc(X + 9, hy + 62, 11, 0, Math.PI * 2); c.fillStyle = CREAM; c.fill();
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; return tex;
}

/* the flag in its own frame: Y up, the pole on the origin, the cloth flying to +X */
function buildFlag(colour, antenna = "sprouts") {
  const g = new THREE.Group(); g.name = "BLIP_flag";
  const mat = (c, name) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }); m.name = name; return m; };
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(POLE.r, POLE.r * 1.15, POLE.h, 10), mat("#F1E3C4", "BlipFlag_Pole"));
  pole.position.y = POLE.h / 2; g.add(pole);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(POLE.r * 2.1, 12, 8), mat("#F1E3C4", "BlipFlag_Knob"));
  knob.position.y = POLE.h + POLE.r; g.add(knob);
  // the cloth is a thin closed box (an open sheet would render black under the ink hull), with a soft wave along it
  const cg = new THREE.BoxGeometry(CLOTH.w, CLOTH.h, CLOTH.d, 12, 4, 1), p = cg.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) + CLOTH.w / 2; p.setZ(i, p.getZ(i) + CLOTH.amp * Math.sin(Math.PI * CLOTH.waves * x / CLOTH.w) * (x / CLOTH.w)); }
  cg.translate(CLOTH.w / 2 + POLE.r, 0, 0); cg.computeVertexNormals();
  // box faces: +x -x +y -y edges in the plain cloth colour, +z and -z carry the print (the back reads the right way round)
  const print = mat("#ffffff", "BlipFlag_ClothPrint"); print.map = emblemTexture(antenna, colour);
  const cloth = new THREE.Mesh(cg, [mat(colour, "BlipFlag_Cloth"), mat(colour, "BlipFlag_Cloth"), mat(colour, "BlipFlag_Cloth"), mat(colour, "BlipFlag_Cloth"), print, print]);
  cloth.position.y = POLE.h - CLOTH.h / 2 - 0.03; g.add(cloth);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  toonify(g); outline(g);
  return g;
}

export function setupMoonFlag({ root, moon, spots, getPlayer, rig, fx, ui, tween, sleep }) {
  const old = root.getObjectByName("MOON_flag");
  if (!old) return null;
  old.updateWorldMatrix(true, false);
  const base = old.getWorldPosition(new THREE.Vector3()), up = moon.up(base);
  const ground = moon.centre.clone().addScaledVector(up, moon.surface(up));
  old.visible = false; if (old.userData.hull) old.userData.hull.visible = false;
  const state = { planted: false, flag: null, busy: false };
  const spot = { id: "moon-flag", kind: "extra", pos: ground.clone(), r: 2.2, body: "moon", label: "Claim this rock", target: old, off: () => state.planted || state.busy };
  spot.run = async () => {
    if (state.planted || state.busy) return;
    const player = getPlayer();   // made after the moon is set up
    state.busy = true; player.frozen = true;
    try {
      // walk up to the spot and face it
      const from = player.position.clone(), away = from.clone().sub(ground); away.addScaledVector(up, -away.dot(up));
      if (away.lengthSq() < 1e-4) away.copy(player.facing).negate();
      away.normalize();
      const goal = ground.clone().addScaledVector(away, PLANT.reach);
      player.cinematic = true;
      await tween(PLANT.walk, k => {
        const q = from.clone().lerp(goal, k * k * (3 - 2 * k)), u = moon.up(q);
        player.position.copy(moon.centre).addScaledVector(u, moon.surface(u)); player.up.copy(u); player.moveSpeed = 1.6 * Math.sin(Math.PI * k);
      });
      player.moveSpeed = 0; player.feet = moon.surface(player.up); player.lastPos.copy(player.position);
      player.facing.copy(away).negate(); player.orient(1);
      // side on, like the other acts: the camera across the line between Blip and the spot, so Blip never hides the flag
      const across = new THREE.Vector3().crossVectors(up, away).normalize(), look = ground.clone().lerp(goal, 0.5).addScaledVector(up, SHOT.look);
      if (rig) rig.focus(look.clone().addScaledVector(across, SHOT.side).addScaledVector(up, SHOT.lift), look, up.clone());
      // the flag, in Blip's colour, upright on the moon and facing across his view (the cloth to his right)
      const flag = buildFlag(blipColour(), load().antenna); state.flag = flag;
      const right = new THREE.Vector3().crossVectors(away.clone().negate(), up).normalize();
      const rest = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, new THREE.Vector3().crossVectors(right, up)));
      root.parent.add(flag);
      flag.quaternion.copy(rest);
      // pushed down into the ground from above
      await tween(PLANT.fall, k => { flag.position.copy(ground).addScaledVector(up, PLANT.drop * (1 - k * k)); });
      flag.position.copy(ground).addScaledVector(up, -0.05);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2, d = right.clone().applyAxisAngle(up, a);
        fx.puff(ground.clone().addScaledVector(up, 0.05), { size: 0.18, color: new THREE.Color("#E6D3DE"), life: 0.6, grow: 1.6, cool: false, vel: d.multiplyScalar(1.2).addScaledVector(up, 0.4) });   // moon dust: stays light (no cooling to soot)
      }
      // a damped sway about its foot, then still
      const axis = away.clone();
      await tween(PLANT.wobble, k => { const s = PLANT.tilt * Math.exp(-4.5 * k) * Math.sin(Math.PI * 4.2 * k); flag.quaternion.copy(rest).premultiply(new THREE.Quaternion().setFromAxisAngle(axis, s)); });
      flag.quaternion.copy(rest);
      state.planted = true;
      player.play("Cheer");
      ui.toast("Flag planted. Blip claims one (1) moon.", 3200);
      await sleep(1.4);
    } finally { state.busy = false; const p = getPlayer(); p.frozen = false; p.cinematic = false; if (rig) { rig.release(); rig.snap(p); } }
  };
  spots.push(spot);
  return state;
}
