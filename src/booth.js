import * as THREE from "three";
import { toonify, outline, inkU, inkResize } from "./toon.js?v=20261108-2312";
import { OPTIONS, load, save, apply } from "./customise.js?v=20261108-2312";

/* Photo booth: a little box camera on a tripod on the lookout's top deck, the
   customiser panel (#booth) and the postcard (off-screen render, its own camera, no HUD). */

/* ---- the prop: built standing on y = 0, lens looking down -z ---- */
export function makeBooth() {
  const g = new THREE.Group(); g.name = "BOOTH";
  const M = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  const wood = M("#B9825A"), coral = M("#FF6F59"), plum = M("#8E3B5A"), dark = M("#2A2B33"), yellow = M("#FFC845"), lilac = M("#B9A2F2");
  const add = (geo, mat, name, p, r) => { const m = new THREE.Mesh(geo, mat); m.name = "BOOTH_" + name; m.position.set(...p); if (r) m.rotation.set(...r); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  // tripod: three chunky splayed legs and a centre column meeting under the camera
  const legH = 0.71;
  add(new THREE.CylinderGeometry(0.045, 0.05, legH * 0.9, 10), wood, "column", [0, legH * 0.55, 0]);
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2 + Math.PI / 6, sp = 0.36;
    const leg = new THREE.CylinderGeometry(0.045, 0.057, Math.hypot(legH, sp), 10);
    const m = add(leg, wood, "leg" + i, [Math.cos(a) * sp / 2, legH / 2, Math.sin(a) * sp / 2]);
    // point the leg from the hub (0, legH) to its foot
    const dir = new THREE.Vector3(Math.cos(a) * sp, -legH, Math.sin(a) * sp).normalize();
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.negate());
  }
  add(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 16), dark, "hub", [0, legH, 0]);
  // the camera body: a rounded coral box with a cream band, bellows and a big lens
  const box = new THREE.BoxGeometry(0.5, 0.36, 0.34, 2, 2, 2);
  add(box, coral, "body", [0, legH + 0.21, 0.04]);
  add(new THREE.BoxGeometry(0.52, 0.08, 0.36), plum, "band", [0, legH + 0.13, 0.04]);
  add(new THREE.CylinderGeometry(0.15, 0.17, 0.14, 24), lilac, "bellows", [0, legH + 0.22, -0.19], [Math.PI / 2, 0, 0]);
  add(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 24), dark, "lens", [0, legH + 0.22, -0.29], [Math.PI / 2, 0, 0]);
  const glass = add(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 24), M("#C9B8F5"), "glass", [0, legH + 0.22, -0.335], [Math.PI / 2, 0, 0]);
  glass.userData.noInk = true;
  // flash on a little post, and a shutter button
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8), dark, "post", [0.16, legH + 0.45, 0.04]);
  add(new THREE.SphereGeometry(0.075, 16, 12), yellow, "flash", [0.16, legH + 0.54, 0.04]);
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 12), yellow, "button", [-0.15, legH + 0.41, 0.1]);
  toonify(g);
  outline(g, "#1E1F26", o => !o.userData.noInk, { minM: 0.008 });   // the characters' near-field floor: never hairline up close
  return g;
}

/* ---- the dress-up lens. ONE pose for the live view and the postcard camera, so the picture is
   what the panel showed. From Blip on the deck: the lens sits D m behind him on the far side from the moon (the moon is
   ~109 m away at 126 deg, ~5 deg above the deck, so it stays near-straight ahead), `side` m to the right of that line
   so the moon lands beside his head rather than behind it, and `h` m above the deck: below his centre (0.78 m), so it
   tips up a few degrees (a slight low angle). It is aimed so his centre lands at NDC (ax, ay). From there the open
   sky is the background (sky, the moon, clouds); the deck is a thin stage under his feet. The rail, column, stair
   slabs, the hub signal ring and the booth would all cut the frame from there, so they are faded out while the
   panel is open (STAGE_FADE, main.js) and hidden in the postcard (STAGE_HIDE). Blip turns to the lens, `turn` off it. */
const DRESS = { D: 3.4, side: 1.0, h: 0.45, mid: 0.78, ay: -0.1, turn: 20 * Math.PI / 180, blipW: 1.05, blipH: 1.55 };
export const STAGE_FADE = /^(MONUMENT_column$|STEP_|HUB_slab_|LOOKOUT_rail$|BOOTH_|VIEW_marker$)/;                          // meshes the occluder fade manages
export const STAGE_HIDE = /^(MONUMENT_column|STEP_\d+|HUB_slab_\d+|LOOKOUT_rail|HUB_signal|BOOTH|VIEW_marker)(_outline)?$/;   // what the postcard hides
const _up = new THREE.Vector3();
/* pos/up: Blip's feet and the local up; moonC: the moon's centre; facing: fallback when the moon is straight overhead;
   f: the fraction of the screen's height left above a bottom sheet (phones), 1 = all of it */
export function dressPose({ pos, up, moonC, facing, fov, aspect, ax = 0, ay = DRESS.ay, f = 1 }) {
  const V = THREE.Vector3, U = _up.copy(up).normalize();
  const d = moonC.clone().sub(pos); d.addScaledVector(U, -d.dot(U));
  if (d.lengthSq() < 1e-4) d.copy(facing);
  d.normalize();
  const right = new V().crossVectors(d, U).normalize();
  const th = Math.tan(fov * Math.PI / 360), tw = th * aspect;
  // far enough that his width fits the frame (a portrait phone) and his height fits above a bottom sheet
  const D = Math.max(DRESS.D, DRESS.blipW / tw, DRESS.blipH / (1.7 * Math.max(f, 0.2) * th));
  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.1, 3000);
  cam.position.copy(pos).addScaledVector(d, -D).addScaledVector(right, DRESS.side).addScaledVector(U, DRESS.h);
  cam.up.copy(U);
  const tgt = pos.clone().addScaledVector(U, DRESS.mid);
  cam.lookAt(tgt); cam.updateMatrixWorld();
  for (let i = 0; i < 8; i++) {   // turn the lens until his centre lands on the anchor
    const n = tgt.clone().project(cam);
    cam.rotateOnWorldAxis(U, Math.atan((ax - n.x) * tw));
    cam.rotateX(-Math.atan((ay - n.y) * th));
    cam.updateMatrixWorld();
  }
  const fwd = new V(0, 0, -1).applyQuaternion(cam.quaternion);
  const toCam = cam.position.clone().sub(pos); toCam.addScaledVector(U, -toCam.dot(U)).normalize();
  return { cam, pos: cam.position.clone(), look: cam.position.clone().addScaledVector(fwd, 10), up: U.clone(), D, facing: toCam.applyAxisAngle(U, DRESS.turn) };
}

/* ---- the postcard's layout (pure): 1800 x 1200, 5% margin on three sides, 18% below for the title */
export function cardLayout(W = 1800, H = 1200) {
  const m = Math.round(W * 0.05), mb = Math.round(H * 0.18);
  return { W, H, m, mb, pw: W - 2 * m, ph: H - m - mb };
}

/* ---- the panel ---- */
export class Booth {
  constructor({ player, renderer, scene, moon, camera, onOpen, onClose, sfx, sound }) {
    Object.assign(this, { player, renderer, scene, moon, camera, onOpen, onClose });
    this.sfx = sfx || { play: () => false };
    this.sound = sound || { hover: () => false, select: () => false, reading: () => false };
    this.state = load();
    this.isOpen = false;
    apply(player.figure, this.state);
    const el = this.el = document.getElementById("booth");
    for (const k of Object.keys(OPTIONS)) {
      const box = el.querySelector(`[data-opt="${k}"]`);
      box.innerHTML = OPTIONS[k].map(o => `<button type="button" class="${k === "colour" ? "swatch" : "chip"}" data-k="${k}" data-v="${o.id}" aria-pressed="false" ${k === "colour" ? `style="--sw:${o.body}" aria-label="${o.label}" title="${o.label}"` : ""}>${k === "colour" ? "" : o.label}</button>`).join("");
    }
    el.addEventListener("click", e => {
      const b = e.target.closest("button[data-k]"); if (!b || b.disabled) return;
      this.state[b.dataset.k] = b.dataset.v; save(this.state); apply(this.player.figure, this.state); this.sync();
    });
    document.getElementById("boothClose").onclick = () => this.close();
    document.getElementById("boothPhoto").onclick = () => this.download();
    this.sync();
  }
  sync() {
    for (const b of this.el.querySelectorAll("button[data-k]")) b.setAttribute("aria-pressed", String(this.state[b.dataset.k] === b.dataset.v));
  }
  open() {
    if (this.isOpen) return;
    this.sound.reading("booth", true);
    const from = document.activeElement; this._from = from && from !== document.body ? from : null;
    this.isOpen = true; this.el.classList.add("open"); this.el.setAttribute("aria-hidden", "false");
    document.body.classList.add("booth-open");
    const c = document.getElementById("boothClose"); requestAnimationFrame(() => { try { c.focus({ preventScroll: true }); } catch { /* optional */ } });   // focus follows the sheet in
    this.onOpen && this.onOpen();
  }
  close() {
    if (!this.isOpen) return;
    this.sound.reading("booth", false);
    this.isOpen = false; this.el.classList.remove("open"); this.el.setAttribute("aria-hidden", "true");
    document.body.classList.remove("booth-open");
    const f = this._from; this._from = null;   // and back out to where it came from
    if (f && document.contains(f) && f.getClientRects().length && !f.closest("[hidden], [aria-hidden='true']")) { try { f.focus({ preventScroll: true }); } catch { /* optional */ } }
    else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    this.onClose && this.onClose();
  }

  /* ---- postcard: an 1800 x 1200 Polaroid. Cream card, 5% margin (90 px) on three sides, 18% (216 px)
     below for the title; the photo is 1620 x 894. The photo goes through the SAME pipeline as the screen
     (tone mapping + sRGB happen only on the canvas): the renderer is resized to the photo, rendered with
     the postcard camera, copied to a 2D canvas in the same task, then put back exactly as it was. */
  /* the dress-up pose for a frame of this aspect; ax/ay = where Blip's centre should land (NDC) */
  dress(aspect, o = {}) {
    const p = this.player;
    return dressPose({ pos: p.position, up: p.viewUp, moonC: this.moon.centre, facing: p.facing, fov: this.camera ? this.camera.fov : 48, aspect, ...o });
  }
  /* the live lens: the pose main.js hands to rig.focus. Desktop (>= 900 px): Blip dead centre, because main.js shifts the
     view's centre into the space beside the panel (setViewOffset, as the project panels do). 641-899 px: the panel
     covers the right part, so aim him left. Phone (<= 640 px): a bottom sheet, so he goes in the band between the header buttons and the sheet. */
  livePose() {
    const W = innerWidth, H = innerHeight;
    if (W <= 640) { const f = THREE.MathUtils.clamp((H - this.el.offsetHeight) / H, 0.3, 0.75) - 0.04, tm = 0.24; return this.dress(W / H, { ax: 0, ay: 1 - tm - f, f: f - tm }); }   // the band between the header and key-hint bars (top 24 %) and the sheet
    return this.dress(W / H, { ax: W >= 900 ? 0 : -428 / W });
  }
  async postcard({ photoOnly = false } = {}) {
    const { W, H, m, mb, pw, ph } = cardLayout();
    await document.fonts.load('700 64px "Bricolage Grotesque"'); await document.fonts.load('500 30px "Instrument Sans"'); await document.fonts.ready;
    const p = this.player, r = this.renderer, up = p.viewUp.clone(), dp = this.dress(pw / ph, { ax: -0.34 }), cam = dp.cam;
    // everything from here to the restore runs in one task: the live view never sees the photo state
    const hidden = [];
    this.scene.traverse(o => { if (o.visible && (STAGE_HIDE.test(o.name) || (o.name === "Token" && o.parent === this.scene))) { o.visible = false; hidden.push(o); } });
    const f0 = p.facing.clone(), q0 = p.group.quaternion.clone();
    const pr = r.getPixelRatio(), size = r.getSize(new THREE.Vector2());
    const photo = document.createElement("canvas"); photo.width = pw; photo.height = ph;
    try {
      // Blip turns to the lens, 20 degrees off it (the same turn as the live view), and waves
      p.facing.copy(dp.facing); p.orient(1);
      if (p.mixer && p.actions && p.actions.Wave) { p.play("Wave"); p.mixer.update(0.55); }
      p.group.updateMatrixWorld(true);
      r.setPixelRatio(1); r.setSize(pw, ph, false);
      inkResize(r); inkU.res.value.z = pw / 1280;   // ink as on a 1280-wide screen, scaled to the photo
      r.setRenderTarget(null); r.render(this.scene, cam);
      photo.getContext("2d").drawImage(r.domElement, 0, 0, pw, ph);
    } finally {
      for (const o of hidden) o.visible = true;
      p.facing.copy(f0); p.group.quaternion.copy(q0); p.group.updateMatrixWorld(true);
      r.setPixelRatio(pr); r.setSize(size.x, size.y, false); inkResize(r);
    }
    if (photoOnly) return photo;
    // compose the card
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d");
    x.fillStyle = "#F6EFE4"; x.fillRect(0, 0, W, H);
    const rr = (px, py, w, h, rad) => { x.beginPath(); x.roundRect(px, py, w, h, rad); };
    x.save(); rr(m, m, pw, ph, 4); x.clip(); x.drawImage(photo, m, m); x.restore();
    x.strokeStyle = "#3A2F6B"; x.lineWidth = 1.5; rr(m + 0.75, m + 0.75, pw - 1.5, ph - 1.5, 4); x.stroke();
    x.textBaseline = "alphabetic"; x.textAlign = "left";
    x.fillStyle = "#1E1F26"; x.font = '700 64px "Bricolage Grotesque"'; x.fillText("Small Planet", m, m + ph + 100);
    x.fillStyle = "#6A5F7E"; x.font = '500 30px "Instrument Sans"'; x.fillText("Wish you were weird", m + 2, m + ph + 150);
    return c;
  }
  async download() {
    this.sfx.play("shutter");   // before the render: the photo takes a moment
    const btn = document.getElementById("boothPhoto"); btn.disabled = true;
    try {
      const c = await this.postcard();
      const blob = await new Promise(res => c.toBlob(res, "image/png"));
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "small-planet-blip.png";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } finally { btn.disabled = false; }
  }
}
