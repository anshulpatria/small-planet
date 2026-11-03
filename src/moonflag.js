import * as THREE from "three";
import { OPTIONS, load } from "./customise.js";
import { toonify, outline } from "./toon.js";

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

/* the flag in its own frame: Y up, the pole on the origin, the cloth flying to +X */
function buildFlag(colour) {
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
  const cloth = new THREE.Mesh(cg, mat(colour, "BlipFlag_Cloth"));
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
  const spot = { id: "moon-flag", kind: "extra", pos: ground.clone(), r: 2.2, body: "moon", label: "Plant your flag", target: old, off: () => state.planted || state.busy };
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
      const flag = buildFlag(blipColour()); state.flag = flag;
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
      ui.toast("Flag planted. One small hop for Blip.", 3200);
      await sleep(1.4);
    } finally { state.busy = false; const p = getPlayer(); p.frozen = false; p.cinematic = false; if (rig) { rig.release(); rig.snap(p); } }
  };
  spots.push(spot);
  return state;
}
