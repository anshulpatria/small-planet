import * as THREE from "three";

/* A cartoon campfire: flat, hand-drawn flames. Each flame is a quad that
   turns round the fire's up axis to face the lens, and a shader draws a teardrop with licking
   tongues in three hard cel bands (red rim, orange, yellow core) inside an ink line the same
   colour as every other outline. The shape sways and flickers with noise, so no two frames of
   fire are the same, and it is opaque (discard outside the ink), so it sorts like any mesh. */

const VERT = /* glsl */`
  varying vec2 vP;
  uniform vec2 uSize;
  void main() {
    vP = vec2((uv.x - 0.5) * uSize.x, uv.y * uSize.y);   // metres: x across, y up from the base
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FRAG = /* glsl */`
  varying vec2 vP;
  uniform vec2 uSize;
  uniform float uTime, uSeed, uBoost;
  uniform vec3 uInk, uRim, uMid, uCore;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  /* <1 inside: a round belly of radius r at the base, then a tongue tapering to height h */
  float shape(vec2 p, float r, float h, float sway) {
    float x = p.x - sway, y = p.y, w;
    if (y < r) w = sqrt(max(0.0, r * r - (y - r) * (y - r)));
    else {
      float k = clamp((y - r) / max(1e-3, h - r), 0.0, 1.0);
      w = r * pow(1.0 - k, 1.35) * (1.0 + 0.22 * sin(y * 11.0 - uTime * 9.0 + uSeed * 5.0) * k);
    }
    return abs(x) / max(w, 1e-4);
  }
  void main() {
    float t = uTime, H = uSize.y * 0.92 * (1.0 + uBoost * 0.18);
    float r = uSize.x * 0.34;
    float y = vP.y;
    // the whole flame leans and wiggles more the higher up it goes
    float sway = (noise(vec2(y * 2.4 - t * 2.1, uSeed * 7.0)) - 0.5) * 0.42 * pow(clamp(y / H, 0.0, 1.0), 1.4) * uSize.x;
    float flick = 1.0 + 0.09 * sin(t * 13.0 + uSeed * 3.0) + 0.06 * sin(t * 21.0 + uSeed);
    float h = H * flick;
    float ink = 0.035;
    if (shape(vP, r + ink, h + ink * 1.6, sway) > 1.0) discard;
    vec3 c = uInk;
    if (shape(vP, r, h, sway) <= 1.0) c = uRim;
    if (shape(vP, r * 0.74, h * 0.74, sway * 0.85) <= 1.0) c = uMid;
    if (shape(vP + vec2(0.0, -r * 0.08), r * 0.46, h * 0.46, sway * 0.6) <= 1.0) c = uCore;
    gl_FragColor = vec4(c, 1.0);
  }`;

export class Campfire {
  /* `at`: world point at the base of the fire; `up`: its up; `scale`: metres */
  constructor(scene, at, up, scale = 1) {
    this.up = up.clone().normalize();
    this.base = at.clone();
    this.items = [];
    const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0, 0.5, 0);
    // one big flame and two smaller ones tucked in front and behind, so it reads as a fire from every side
    const flames = [[0, 0, 0.9, 1.35, 0.0], [0.2, 0.1, 0.55, 0.85, 1.7], [-0.18, -0.12, 0.5, 0.75, 3.1], [0.04, -0.2, 0.42, 0.6, 4.6]];
    const side = new THREE.Vector3(1, 0, 0).cross(this.up); if (side.lengthSq() < 0.01) side.set(0, 0, 1).cross(this.up);
    side.normalize();
    const side2 = this.up.clone().cross(side);
    for (const [dx, dz, w, h, seed] of flames) {
      const u = {
        uSize: { value: new THREE.Vector2(w * scale, h * scale) }, uTime: { value: 0 }, uSeed: { value: seed }, uBoost: { value: 0 },
        uInk: { value: new THREE.Color("#1E1F26") }, uRim: { value: new THREE.Color("#F2502A") },
        uMid: { value: new THREE.Color("#FF9A2E") }, uCore: { value: new THREE.Color("#FFE45C") },
      };
      const m = new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, toneMapped: false });
      const q = new THREE.Mesh(geo, m);
      q.scale.set(w * scale, h * scale, 1);
      q.position.copy(at).addScaledVector(side, dx * scale).addScaledVector(side2, dz * scale).addScaledVector(this.up, 0.06 * scale);
      q.castShadow = false; q.receiveShadow = false; q.frustumCulled = false;
      q.renderOrder = 2;
      scene.add(q);
      this.items.push({ q, u, seed });
    }
    this.sparkT = 0;
  }

  /* turn every flame to the lens round the fire's up axis; `boost` 0..1 makes it leap */
  update(dt, t, camera, boost = 0, fx = null) {
    const z = new THREE.Vector3(), x = new THREE.Vector3(), m = new THREE.Matrix4();
    for (const it of this.items) {
      z.copy(camera.position).sub(it.q.position); z.addScaledVector(this.up, -z.dot(this.up));
      if (z.lengthSq() < 1e-6) continue;
      z.normalize(); x.crossVectors(this.up, z);
      it.q.quaternion.setFromRotationMatrix(m.makeBasis(x, this.up, z));
      it.u.uTime.value = t; it.u.uBoost.value = boost;
    }
    // a few sparks drifting up out of the fire
    this.sparkT -= dt;
    if (fx && this.sparkT <= 0) {
      this.sparkT = 0.18 + Math.random() * 0.25 - boost * 0.12;
      const p = this.base.clone().addScaledVector(this.up, 0.5 + Math.random() * 0.4);
      const v = this.up.clone().multiplyScalar(1.1 + Math.random() * 0.8).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4));
      fx.puff(p, { size: 0.05, color: new THREE.Color(Math.random() < 0.5 ? "#FFD23F" : "#FF8A2E"), life: 1.0, vel: v, grow: 0.3, glow: true });
    }
  }
}
