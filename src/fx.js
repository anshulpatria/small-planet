import * as THREE from "three";

/* Cartoon effects for the cannon: a crackling fuse spark, a KA-BOOM (fire puffs, a spiky
   star burst, comic lettering), smoke puffs along the flight, a dust ring on landing,
   and a camera shake.

   Puffs are cel-shaded like the rest of the world, not see-through blobs: each is a flat
   sprite that draws a lumpy cloud ball in three hard bands lit from the sun, inside the same
   ink line as every prop. It never fades; it pops out, holds, and then dissolves through
   noise holes edged in ink (the classic hand-drawn smoke break-up). The sprite writes the
   depth of the ball's surface, so a puff sinks into the ground or a wall like a real sphere.
   Self-lit puffs (sparks, embers, dust) are flat colour without ink. */

const puffGeo = new THREE.PlaneGeometry(1, 1);
const PUFF_VERT = /* glsl */`
  uniform float uSize; varying vec2 vUv; varying vec3 vCentre; varying vec4 vPz;
  void main() {
    vUv = position.xy * 2.0;
    vPz = vec4(projectionMatrix[2][2], projectionMatrix[3][2], projectionMatrix[2][3], projectionMatrix[3][3]);
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vCentre = mv.xyz;
    mv.xy += position.xy * 2.0 * uSize * 1.12;    // a little slack round the lumps
    gl_Position = projectionMatrix * mv;
  }`;
const PUFF_FRAG = /* glsl */`
  uniform vec3 uLit, uMid, uShade, uInk, uLightV;
  uniform float uK, uSeed, uGlow, uSize;
  varying vec2 vUv; varying vec3 vCentre; varying vec4 vPz;
  float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    vec2 p = vUv * 1.12;
    float r = length(p), a = atan(p.y, p.x);
    float edge = 0.88 + 0.07 * sin(a * 5.0 + uSeed * 6.3) + 0.04 * sin(a * 8.0 - uSeed * 3.1);
    if (r > edge) discard;
    vec2 q = p / edge; float nz = sqrt(max(0.0, 1.0 - dot(q, q)));
    vec3 n = normalize(vec3(q * 0.9, nz));
    // break-up: holes open from the noise's low spots over the second half of the life
    float dis = smoothstep(0.45, 1.0, uK) * 1.08;
    float hn = n2(p * 2.4 + uSeed * 13.0) * 0.62 + n2(p * 5.1 + uSeed * 7.0) * 0.38;
    if (hn < dis) discard;
    float l = dot(n, uLightV);
    vec3 c = l > 0.3 ? uLit : (l > -0.25 ? uMid : uShade);
    if (uGlow > 0.5) c = r < edge * 0.55 ? uLit * 1.15 + 0.06 : uLit;
    else {
      float ink = max(clamp(0.045 / uSize, 0.05, 0.16), fwidth(r) * 1.3);
      if (r > edge - ink || (dis > 0.0 && hn < dis + ink * 0.7)) c = uInk;
    }
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
    // depth of the ball's front surface, not of the flat sprite
    float z = vCentre.z + nz * uSize * 0.85;
    gl_FragDepthEXT = clamp(((vPz.x * z + vPz.y) / (vPz.z * z + vPz.w)) * 0.5 + 0.5, 0.0, 1.0);
  }`;
const INK = new THREE.Color("#1E1F26");
const SMOKE_LIT = new THREE.Color("#F6F0F6"), SMOKE_MID = new THREE.Color("#DACDE6"), SMOKE_SHADE = new THREE.Color("#AE9EC6");
const sharedPuff = { uLightV: { value: new THREE.Vector3(0.4, 0.7, 0.5).normalize() }, uInk: { value: INK } };
const _lv = new THREE.Vector3();
const FIRE = ["#FFF3B0", "#FFC845", "#FF8A3D", "#FF5A36", "#E2453A"].map(c => new THREE.Color(c));
const SMOKE = new THREE.Color("#E9E4F2"), SOOT = new THREE.Color("#6B6478"), EMBER = new THREE.Color("#C8705A");

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.puffs = [];
    this.free = [];
    this.shakeT = 0; this.shakeAmp = 0;
    this.items = [];   // misc animated objects (burst star, text, spark)
    // the spiky star burst
    const s = new THREE.Shape();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, r = i % 2 ? 0.45 : 1;
      i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(r, 0);
    }
    this.starGeo = new THREE.ShapeGeometry(s);
    // comic lettering texture
    const cv = document.createElement("canvas"); cv.width = 1024; cv.height = 256;
    const g = cv.getContext("2d");
    g.font = '900 170px "Bricolage Grotesque", Impact, sans-serif'; g.textAlign = "center"; g.textBaseline = "middle";
    const W = 900;   // fit the word inside the canvas, with room for the ink stroke
    g.lineJoin = "round"; g.lineWidth = 30; g.strokeStyle = "#1E1F26"; g.strokeText("KA-BOOM!", 512, 136, W);
    g.fillStyle = "#FFC845"; g.fillText("KA-BOOM!", 512, 136, W);
    g.lineWidth = 7; g.strokeStyle = "#FF5A36"; g.strokeText("KA-BOOM!", 512, 136, W);
    this.boomTex = new THREE.CanvasTexture(cv); this.boomTex.colorSpace = THREE.SRGBColorSpace;
  }

  /* `glow`: lights itself (sparks, embers) instead of taking the scene's light.
     `cool`: a coloured puff fades toward soot as it ages (fire into smoke); dust passes false,
     or a pale sand puff turns grey-brown */
  puff(pos, { size = 1, color = SMOKE, life = 1, vel = null, grow = 2.2, glow = false, cool = true } = {}) {
    let m = this.free.pop();
    if (!m) {
      const u = { ...sharedPuff, uLit: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uShade: { value: new THREE.Color() },
        uK: { value: 0 }, uSeed: { value: 0 }, uGlow: { value: 0 }, uSize: { value: 1 } };
      m = new THREE.Mesh(puffGeo, new THREE.ShaderMaterial({ uniforms: u, vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG, toneMapped: false }));
      m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;
      m.raycast = () => {};
    }
    const u = m.material.uniforms;
    u.uSeed.value = Math.random() * 10; u.uGlow.value = glow ? 1 : 0; u.uK.value = 0;
    m.position.copy(pos);
    m.userData = { t: 0, life, size, grow, vel: vel ? vel.clone() : new THREE.Vector3(), c0: color.clone(), cool, glow };
    this.tint(m, 0);
    this.scene.add(m); this.puffs.push(m);
    return m;
  }

  /* the three bands of a puff at age k: smoke is lilac-white; a coloured puff shades toward
     violet, and fire cools to soot as it ages */
  tint(m, k) {
    const u = m.material.uniforms, d = m.userData;
    if (d.c0.equals(SMOKE)) { u.uLit.value.copy(SMOKE_LIT); u.uMid.value.copy(SMOKE_MID); u.uShade.value.copy(SMOKE_SHADE); return; }
    const c = u.uLit.value.copy(d.c0);
    // fire cools through ember red to soot (a straight blend from yellow to grey-violet goes olive)
    if (d.cool && !d.glow) { const q = Math.min(1, k * 1.4); if (q < 0.5) c.lerp(EMBER, q * 2); else c.copy(EMBER).lerp(SOOT, (q - 0.5) * 2); }
    u.uMid.value.copy(c).multiplyScalar(0.84);
    u.uShade.value.copy(c).multiplyScalar(0.62).lerp(SMOKE_SHADE, 0.25);
  }

  /* the fuse: a little bright spark that fizzes along a path of points */
  spark(getPos, duration) {
    const m = new THREE.Mesh(this.starGeo, new THREE.MeshBasicMaterial({ color: "#FFE27A", side: THREE.DoubleSide, toneMapped: false }));
    m.scale.setScalar(0.22);
    this.scene.add(m);
    this.items.push({ kind: "spark", m, t: 0, duration, getPos });
  }

  boom(pos, dir, camera) {
    // fireball: a fat cluster of fire puffs blowing out of the muzzle
    for (let i = 0; i < 14; i++) {
      const v = dir.clone().multiplyScalar(4 + Math.random() * 7).add(new THREE.Vector3((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5));
      this.puff(pos.clone().addScaledVector(dir, 0.4), { size: 0.5 + Math.random() * 0.5, color: FIRE[(Math.random() * FIRE.length) | 0], life: 0.5 + Math.random() * 0.3, vel: v, grow: 2.2 });
    }
    for (let i = 0; i < 8; i++) {
      const v = dir.clone().multiplyScalar(2 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3));
      this.puff(pos.clone(), { size: 0.6 + Math.random() * 0.5, color: SMOKE, life: 1.3 + Math.random() * 0.6, vel: v, grow: 2.2 });
    }
    // star burst + lettering, facing the camera
    const star = new THREE.Mesh(this.starGeo, new THREE.MeshBasicMaterial({ color: "#FFC845", side: THREE.DoubleSide, transparent: true, toneMapped: false, depthTest: false }));
    star.position.copy(pos).addScaledVector(dir, 1.6); star.renderOrder = 10;
    this.scene.add(star);
    this.items.push({ kind: "burst", m: star, t: 0, duration: 0.6, camera });
    const word = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.3), new THREE.MeshBasicMaterial({ map: this.boomTex, transparent: true, depthTest: false, toneMapped: false }));
    word.position.copy(pos).addScaledVector(dir, 2.4); word.renderOrder = 11;
    this.scene.add(word);
    this.items.push({ kind: "word", m: word, t: 0, duration: 1.3, camera });
    this.shake(0.55, 0.5);
  }

  dust(pos, up) {
    const side = new THREE.Vector3(1, 0, 0); if (Math.abs(side.dot(up)) > 0.9) side.set(0, 0, 1);
    const a = side.cross(up).normalize(), b = up.clone().cross(a).normalize();
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const v = a.clone().multiplyScalar(Math.cos(ang) * 3.2).addScaledVector(b, Math.sin(ang) * 3.2).addScaledVector(up, 0.6);
      this.puff(pos.clone().addScaledVector(up, 0.3), { size: 0.45, color: SMOKE, life: 0.9, vel: v, grow: 2.4 });
    }
    this.shake(0.25, 0.25);
  }

  shake(amp, dur) { this.shakeAmp = Math.max(this.shakeAmp, amp); this.shakeT = Math.max(this.shakeT, dur); }

  /* call after the camera has been placed: returns nothing, nudges the camera */
  applyShake(camera, dt) {
    if (this.shakeT <= 0) return;
    this.shakeT -= dt;
    const k = Math.max(0, this.shakeT) * this.shakeAmp * 1.6;
    camera.position.x += (Math.random() - 0.5) * k; camera.position.y += (Math.random() - 0.5) * k; camera.position.z += (Math.random() - 0.5) * k;
    if (this.shakeT <= 0) this.shakeAmp = 0;
  }

  update(dt) {
    // the sun in view space, for every puff's bands
    if (this.sun && this.camera) sharedPuff.uLightV.value.copy(_lv.copy(this.sun).transformDirection(this.camera.matrixWorldInverse));
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const m = this.puffs[i], u = m.userData;
      u.t += dt;
      const k = u.t / u.life;
      if (k >= 1) { this.scene.remove(m); this.puffs.splice(i, 1); this.free.push(m); continue; }
      m.position.addScaledVector(u.vel, dt); u.vel.multiplyScalar(Math.exp(-dt * 3));
      // pop out fast, hold, settle a touch while it breaks up
      const s = u.size * (0.4 + u.grow * (1 - Math.pow(1 - Math.min(1, k * 1.6), 3))) * (1 - 0.15 * Math.max(0, (k - 0.6) / 0.4));
      m.material.uniforms.uSize.value = s * (u.glow ? 1 : 0.85);
      m.material.uniforms.uK.value = u.glow ? Math.max(0, k * 1.3 - 0.3) : k;
      if (!u.c0.equals(SMOKE) && u.cool) this.tint(m, k);
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = it.t / it.duration;
      if (it.kind === "spark") {
        it.m.position.copy(it.getPos(Math.min(1, k)));
        it.m.scale.setScalar(0.18 + Math.random() * 0.14);
        it.m.rotation.z += dt * 20;
        if (Math.random() < 0.6) this.puff(it.m.position, { size: 0.12, color: FIRE[1 + ((Math.random() * 3) | 0)], life: 0.3, vel: new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2), grow: 1 });
      } else if (it.kind === "burst") {
        it.m.quaternion.copy(it.camera.quaternion);
        it.m.scale.setScalar(0.6 + 2.6 * (1 - Math.pow(1 - Math.min(1, k * 1.6), 3)));
        it.m.rotation.z += dt * 2;
        it.m.material.opacity = 1 - k;
      } else if (it.kind === "word") {
        it.m.quaternion.copy(it.camera.quaternion);
        const pop = k < 0.2 ? (k / 0.2) * 1.25 : 1.25 - 0.25 * Math.min(1, (k - 0.2) / 0.15);
        it.m.scale.setScalar(pop);
        it.m.material.opacity = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
      }
      if (k >= 1) { this.scene.remove(it.m); this.items.splice(i, 1); }
    }
  }
}
