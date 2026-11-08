import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { outline, inkFollow } from "./toon.js?v=20261108-2312";
import { createNightStars, BAND } from "./nightsky.js?v=20261108-2312";

/* two soft cel bands for the clouds: shade and sunlit */
function cloudRamp() {
  const t = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255, 255, 255, 255, 255]), 2, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
}
/* A cloud silhouette from a recipe of lumps. Lobes are [x, y, z, r] in units of W (x along the
   cloud's length, y up from the flat base at 0, every lump dips below 0 so the base is cut flat).
   Six recipes (the recipe is the silhouette; sizes and flips vary on top). The smooth union of the
   lumps is one closed surface, so it shades in clean cel bands and its ink line has no inner seams. */
const J = (rnd, a) => (1 - a / 2 + rnd() * a);   // jitter factor around 1
const RECIPES = {
  // a long scalloped row, biggest in the middle, a smaller row behind
  row(rnd) {
    const n = 5 + Math.floor(rnd() * 2), L = [], R = 0.2;
    for (let k = 0; k < n; k++) { const u = k / (n - 1) * 2 - 1, r = R * (0.45 + 0.55 * Math.cos(u * Math.PI / 2) ** 1.5) * J(rnd, 0.2);
      L.push([u * 0.42, r * 0.55, 0.05 * (rnd() - 0.5), r]); }
    for (let k = 0; k < n - 1; k++) { const u = (k + 0.5) / (n - 1) * 2 - 1, r = R * 0.62 * J(rnd, 0.2); L.push([u * 0.42, r * 0.7, -0.12, r]); }
    return L;
  },
  // a short puff of three lumps in a line (no round or upright shapes: every recipe is wider than tall)
  puff(rnd) { return [[-0.2, 0.08, 0, 0.14 * J(rnd, 0.2)], [0.0, 0.12, 0.02, 0.2 * J(rnd, 0.15)], [0.22, 0.08, -0.02, 0.15 * J(rnd, 0.2)], [0.02, 0.07, -0.1, 0.13]]; },
  // a low cumulus bank: a long base of lumps with one gentle hump on top
  tower(rnd) { const l = rnd() < 0.5 ? -1 : 1; return [[-0.38, 0.05, 0, 0.11], [-0.2, 0.08, 0.03, 0.16], [0.0, 0.1, -0.02, 0.2], [0.22, 0.08, 0, 0.16], [0.4, 0.05, 0, 0.11],
    [0.06 * l, 0.22, 0, 0.15 * J(rnd, 0.12)]]; },
  // two humps with a dip between, a heart-like twin
  twin(rnd) { return [[-0.22, 0.12, 0, 0.21 * J(rnd, 0.1)], [0.22, 0.1, 0.02, 0.19 * J(rnd, 0.1)], [-0.22, 0.28, 0, 0.14], [0.2, 0.25, 0, 0.12],
    [0, 0.06, 0, 0.17], [-0.4, 0.05, 0, 0.1], [0.4, 0.04, 0, 0.09]]; },
  // a long low stratus streak of small lumps, almost flat on top
  streak(rnd) { const L = []; for (let k = 0; k < 8; k++) { const u = k / 7 * 2 - 1, r = (0.075 + 0.045 * Math.cos(u * Math.PI / 2)) * J(rnd, 0.25); L.push([u * 0.46, r * 0.5, (rnd() - 0.5) * 0.05, r]); } return L; },
  // a shelf: a wide flat-topped crown on a low base
  anvil(rnd) { return [[-0.32, 0.08, 0, 0.12], [-0.12, 0.1, 0.02, 0.16], [0.12, 0.1, -0.02, 0.16], [0.34, 0.08, 0, 0.12 * J(rnd, 0.15)], [-0.1, 0.22, 0, 0.12], [0.14, 0.21, 0, 0.12]]; },
};
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);
function cumulus(W, rnd, kind) {
  const lobes = RECIPES[kind](rnd).map(([x, y, z, r]) => [x * W, y * W, z * W, r * W]);
  const R = W * 0.2, k = R * 0.16;
  let top = 0; for (const l of lobes) top = Math.max(top, l[1] + l[3]);
  const sdf = (x, y, z) => {
    let d = 1e9;
    for (const [lx, ly, lz, r] of lobes) d = smin(d, Math.hypot(x - lx, y - ly, z - lz) - r, k);
    return smax(d, -y, R * 0.12);                    // the flat base
  };
  const g = new THREE.SphereGeometry(1, 72, 40), pos = g.attributes.position, c = new THREE.Vector3(0, top * 0.45, 0), d = new THREE.Vector3();
  const reach = W;
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    // march in from outside to the first (outermost) crossing, then bisect
    let t = reach, prev = reach;
    while (t > 0) { const v = sdf(c.x + d.x * t, c.y + d.y * t, c.z + d.z * t); if (v < 0) break; prev = t; t -= Math.max(v * 0.9, 0.02); }
    let lo = Math.max(t, 0), hi = prev;
    for (let it = 0; it < 18; it++) { const m = (lo + hi) / 2; if (sdf(c.x + d.x * m, c.y + d.y * m, c.z + d.z * m) < 0) lo = m; else hi = m; }
    pos.setXYZ(i, c.x + d.x * lo, c.y + d.y * lo, c.z + d.z * lo);
  }
  // weld the sphere's seam and poles, or the smooth normals split into a visible line
  g.deleteAttribute("uv"); g.deleteAttribute("normal");
  const w = mergeVertices(g, 1e-4); w.computeVertexNormals(); w.computeBoundingBox();
  return w;
}

/* One cloud's own geometry: the shared recipe mesh scaled to its size, then
   (1) flattened until it is at least MIN_ASPECT times longer than tall, so no cloud can read as a pillar, and
   (2) bent down along its length by the sphere it rides on (drop = x^2 / 2r at orbit radius r), so a long cloud
   follows the sky's curve instead of a straight board. The long axis stays x, tangent to the orbit. */
const MIN_ASPECT = 2.4;
function shapeCloud(geo, s, orbitR) {
  const g = geo.clone(), p = g.attributes.position;
  g.deleteAttribute("normal");
  const len = (geo.boundingBox.max.x - geo.boundingBox.min.x) * s, hgt = geo.boundingBox.max.y * s;
  const sy = Math.min(1, len / MIN_ASPECT / hgt);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) * s;
    p.setXYZ(i, x, p.getY(i) * s * sy - x * x / (2 * orbitR), p.getZ(i) * s);
  }
  g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

/* A calm sunset. The sky is drawn relative to the visitor's own "up" (so the horizon is
   right everywhere on the little planet): dusky violet overhead, lavender, rose, peach,
   and a low, warm sun with a soft glow; painted cloud streaks catch the light on the sun's
   side. The directional light comes from exactly where that sun is drawn, in the same
   warm orange, and its shadow box follows the visitor (texel-snapped, steady roll). */

const SUN_ELEV = THREE.MathUtils.degToRad(32);

/* Cast shadows fade out on faces turned edge-on to the sun (N.L from 0.30 down to 0.05). There a
   shadow-map texel is stretched 1/(N.L) times along the surface, so a cast shadow lands as a
   staircase of big texels (the moon's curved flank under the deck lip, the planet's limb, the
   back of rocks). Those faces are already in the toon ramp's dark band from their own shading,
   so nothing visible is lost; the stair steps and terminator acne are. Directional lights only. */
const DIR_SHADOW = "getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )";
if (THREE.ShaderChunk.lights_fragment_begin.includes(DIR_SHADOW) && !THREE.ShaderChunk.lights_fragment_begin.includes("SKY_GRAZE"))
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace(DIR_SHADOW,
    `mix( 1.0, ${DIR_SHADOW}, smoothstep( 0.05 * directionalLightShadow.shadowRadius, 0.3 * directionalLightShadow.shadowRadius, dot( geometryNormal, directLight.direction ) ) ) /* SKY_GRAZE */`);
/* The fade edges scale with the sun. shadow.radius carries k = sin(elev)/sin(32), capped at 1
   (biasFor). PCFSoftShadowMap ignores radius in r169, so it is free to carry k; at 32-70 deg k = 1 and
   the edges are 0.05-0.3. At 10 deg flat ground has N.L 0.17: fixed edges would halve Blip's shadow
   there; scaled edges (0.016-0.10) keep it whole and still fade the true grazing faces.
   If the shadow type ever changes to PCF/VSM, radius would also blur: move k to another carrier. */

export function createSky(renderer, scene, { shadow = 2048 } = {}) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.3;
  scene.background = new THREE.Color("#EBCDAB");
  scene.fog = new THREE.Fog(new THREE.Color("#E8CFB4"), 150, 520);

  const U = {
    uUp: { value: new THREE.Vector3(0, 1, 0) }, uSun: { value: new THREE.Vector3(1, 0.3, 0).normalize() }, uTime: { value: 0 }, uNight: { value: 0 },
    uEast: { value: new THREE.Vector3(1, 0, 0) }, uNorth: { value: new THREE.Vector3(0, 0, 1) }, uBandN: { value: BAND.n }, uBandA: { value: BAND.a }, uBandB: { value: BAND.b },
    zenith: { value: new THREE.Color("#3F6BAE") }, high: { value: new THREE.Color("#86A9D6") }, mid: { value: new THREE.Color("#DCD2C6") },
    low: { value: new THREE.Color("#F6CD98") }, sunCol: { value: new THREE.Color("#FFF1CC") }, glow: { value: new THREE.Color("#FFB674") },
    cloudLit: { value: new THREE.Color("#FFF1DF") }, cloudShade: { value: new THREE.Color("#A9B6D0") }, below: { value: new THREE.Color("#D8C2AC") },
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: U,
    vertexShader: "varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }",
    fragmentShader: `uniform vec3 uEast, uNorth, uBandN, uBandA, uBandB; uniform vec3 uUp, uSun, zenith, high, mid, low, sunCol, glow, cloudLit, cloudShade, below; uniform float uTime, uNight; varying vec3 vD;
      float h2(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
      float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * n2(p); p = p * 2.02 + 3.1; a *= 0.5; } return s; }
      float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z); }
      float fbm3(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * n3(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
      // fine stars on a 3D cell grid: soft gaussian dots (no hard edges, no shimmer), density 'dens' in 0..1
      float fineStars(vec3 l, float S, float dens, float rad){ vec3 sp = l * S, id = floor(sp); float r1 = h3(id), r2 = h3(id + 7.7);
        vec3 cen = id + 0.25 + 0.5 * vec3(h3(id + 1.3), h3(id + 2.9), h3(id + 4.1)); vec3 q = sp - cen;
        return step(1.0 - dens, r1) * exp(-dot(q, q) / (rad * rad)) * (0.35 + 0.65 * r2 * r2); }
      void main(){
        vec3 d = normalize(vD);
        float h = dot(d, uUp);                        // elevation above the visitor's horizon
        float s = max(dot(d, uSun), 0.0);
        vec3 c = mix(low, mid, smoothstep(0.0, 0.18, h));
        c = mix(c, high, smoothstep(0.15, 0.45, h));
        c = mix(c, zenith, smoothstep(0.45, 1.0, h));
        c = mix(c, below, smoothstep(0.0, -0.25, h));
        // warm halo around the sun, wider near the horizon
        c += glow * (pow(s, 6.0) * 0.55 + pow(s, 40.0) * 0.5) * (1.0 - 0.6 * smoothstep(0.0, 0.6, h));
        // painted cloud streaks: stretched noise in a band above the horizon
        vec3 east = normalize(cross(uUp, vec3(0.31, 0.12, 0.94))); vec3 north = cross(east, uUp);
        vec2 q = vec2(atan(dot(d, east), dot(d, north)) * 3.0, h * 14.0);
        float cl = fbm(vec2(q.x * 1.3 + uTime * 0.004, q.y * 0.55));
        float band = smoothstep(0.02, 0.1, h) * (1.0 - smoothstep(0.32, 0.5, h));
        float cloud = smoothstep(0.52, 0.72, cl) * band;
        vec3 cc = mix(cloudShade, cloudLit, clamp(0.35 + s * 0.9, 0.0, 1.0));
        c = mix(c, cc, cloud * 0.85);
        // night (sun under the horizon, sky.shadowK -> 0): the whole dome sinks to a deep blue
        c = mix(c, mix(vec3(0.04, 0.055, 0.15), vec3(0.01, 0.018, 0.075), smoothstep(0.0, 0.8, h)), uNight);
        // night Milky Way (R7 upgrade). Everything below is inside uNight > 0, so by day the branch never runs and the day sky is untouched.
        if (uNight > 0.001) {
          float nk = smoothstep(0.3, 1.0, uNight);
          vec3 l = vec3(dot(d, uEast), dot(d, uUp), dot(d, uNorth));
          // a faint indigo/violet drift across the whole dome, so the navy is never flat
          float drift = fbm3(l * 1.6 + 4.0);
          c += mix(vec3(0.0, 0.01, 0.045), vec3(0.05, 0.02, 0.09), drift) * nk * (0.6 + 0.4 * smoothstep(-0.2, 0.5, l.y));
          // the band: a great circle, wide and soft, brightest and widest at the core
          float b = dot(l, uBandN), along = atan(dot(l, uBandA), dot(l, uBandB));
          float cw = 0.5 + 0.5 * cos(along), core = cw * cw;
          float w = mix(0.20, 0.34, cw);
          float broad = exp(-(b * b) / (w * w)), narrow = exp(-(b * b) / (w * w * 0.12));
          float warp = fbm3(l * 3.0 + 9.0);
          float cloud = fbm3(l * 5.5 + warp * 1.4);                 // nebulous structure
          float struc = 0.3 + 0.9 * smoothstep(0.3, 0.75, cloud);
          float lane = fbm3(l * vec3(9.0, 11.0, 9.0) + warp * 2.0 + 3.0);
          float dust = smoothstep(0.48, 0.70, lane) * exp(-(b * b) / (w * w * 0.5));
          float rift = exp(-pow((b - 0.04 * sin(along * 3.0 + warp * 4.0)) / 0.028, 2.0)) * (0.35 + 0.65 * cw);
          float glow = (broad * 0.5 + narrow * 0.85) * struc * (1.0 - 0.8 * dust) * (1.0 - 0.7 * rift);
          float edge = smoothstep(0.1, 0.9, abs(b) / w);                  // far from the spine: cool
          vec3 cool = vec3(0.16, 0.26, 0.78), violet = vec3(0.50, 0.34, 0.92), warm = vec3(1.0, 0.64, 0.34);
          vec3 bc = mix(violet, cool, edge);
          bc = mix(bc, warm, smoothstep(0.35, 0.95, core) * (1.0 - 0.7 * edge));
          float lum = 0.62 * (0.4 + 0.8 * core);
          c += bc * glow * lum * nk;
          // fine stars: a field that thickens toward the band and thins in the dust lanes
          float bd = clamp(broad * 0.8 + narrow * 0.5, 0.0, 1.0) * (1.0 - 0.75 * dust);
          float sf = fineStars(l, 150.0, 0.045 + 0.40 * bd, 0.13) * 0.55 + fineStars(l + 3.1, 70.0, 0.02 + 0.10 * bd, 0.11) * 0.9;
          float tint = h3(floor(l * 150.0) + 5.5);
          c += mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), tint) * sf * nk * (1.0 - 0.5 * dust);
        }
        // the sun disc, soft-edged
        c = mix(c, sunCol, smoothstep(0.9975, 0.9988, s));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  sky.frustumCulled = false; sky.renderOrder = -1; scene.add(sky);
  const night = createNightStars(U); scene.add(night.points);   // R7: brighter stars with small halos, drawn only at night

  /* 3D clouds: satellites of the planet. Three orbital planes through the planet's centre (so every
     cloud rides a great circle), at three sky heights, all turning the SAME way, so from any spot on
     the surface they drift one way across the sky and read as horizon clouds. Each plane is one
     group spun about its tilted axis; each cloud sits in its plane with its flat base to the planet and
     its long side along the track. Planes are 9-10 m apart in radius and no cloud is taller than
     CLOUD_H, so clouds on different planes can never meet where the great circles cross; clouds
     in one plane share a speed and are >= 40 deg apart. Heights: ground 30, lookout deck 38.4, moon
     centre 116.6 (R 9): the lowest cloud base is 60, the highest top is under 88. */
  const cloudMat = new THREE.MeshToonMaterial({ color: "#FFFFFF", gradientMap: cloudRamp(), emissive: new THREE.Color("#7C98C8"), emissiveIntensity: 0.45 });
  const CLOUD_H = 9;
  const clouds = new THREE.Group();
  let sd = 11; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const up = new THREE.Vector3(0, 1, 0);
  const PLANES = [
    { r: 60, tilt: 15, az: 40, speed: 0.0058 }, { r: 69, tilt: 42, az: 200, speed: 0.0044 }, { r: 78, tilt: 26, az: 305, speed: 0.0034 },
  ];
  const KINDS = ["row", "puff", "tower", "twin", "streak", "anvil", "row", "puff", "twin", "tower", "streak", "anvil", "row", "puff", "anvil"];
  const SIZES = { row: [16, 24], puff: [15, 20], tower: [16, 22], twin: [14, 20], streak: [20, 28], anvil: [16, 22] };
  const geoCache = new Map();
  const planes = [], faces = [];   // faces: per-cloud turn about its own radial (see update)
  let ci = 0;
  for (const P of PLANES) {
    const t = THREE.MathUtils.degToRad(P.tilt), a = THREE.MathUtils.degToRad(P.az);
    const axis = new THREE.Vector3(Math.sin(t) * Math.cos(a), Math.cos(t), Math.sin(t) * Math.sin(a)).normalize();
    const u = new THREE.Vector3(0, 0, 1).cross(axis).normalize(), v = axis.clone().cross(u);   // in-plane basis, v = u rotated +90 deg about the axis
    const grp = new THREE.Group();
    const phase0 = rnd() * 6.283;
    for (let k = 0; k < 5; k++, ci++) {
      const kind = KINDS[ci], [w0, w1] = SIZES[kind];
      const ph = phase0 + k * 1.2566 + (rnd() - 0.5) * 0.45;
      let W = w0 + rnd() * (w1 - w0);
      // two shapes per kind (different seeds), so the same recipe never repeats exactly
      const key = kind + (ci % 2); if (!geoCache.has(key)) geoCache.set(key, cumulus(1 * 20, rnd, kind));
      const geo = geoCache.get(key);
      let s = W / 20; const hgt = (geo.boundingBox.max.y) * s; if (hgt > CLOUD_H) s *= CLOUD_H / hgt;
      const m = new THREE.Mesh(shapeCloud(geo, s, P.r), cloudMat);
      m.castShadow = true; m.receiveShadow = false;
      const radial = u.clone().multiplyScalar(Math.cos(ph)).addScaledVector(v, Math.sin(ph));
      const tang = u.clone().multiplyScalar(-Math.sin(ph)).addScaledVector(v, Math.cos(ph));
      m.position.copy(radial).multiplyScalar(P.r);
      const flip = rnd() < 0.5 ? -1 : 1;                                  // half of them run the other way round their track
      const bx = tang.clone().multiplyScalar(flip), bz = new THREE.Vector3().crossVectors(bx, radial);
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(bx, radial, bz));
      m.userData.kind = kind;
      faces.push({ m, g: grp, bx0: bx.clone(), rad: radial.clone(), yaw: 0, set: false });
      grp.add(m);
    }
    grp.userData = { axis, speed: P.speed, ang: 0 };
    planes.push(grp); clouds.add(grp);
  }
  outline(clouds, "#6A7898", undefined, { maxM: 2 });   // slate blue ink, same px as the props; big and far, so no far cap
  scene.add(clouds);
  /* A long cloud whose axis points AWAY from the viewer reads as a tall pillar (perspective
     stretches it up the screen). Each cloud therefore turns about its own radial (so its axis stays tangent to
     the sky sphere, >= 80 deg from the radial) to lie across the viewer's line of sight, eased (tau 1.3 s, 25 deg/s max)
     so it never snaps. `sky.cloudFace = false` gives the pure orbit-aligned layout back. */
  const _e = new THREE.Vector3(), _t = new THREE.Vector3(), _a = new THREE.Vector3(), _x = new THREE.Vector3(), _z = new THREE.Vector3(), _q = new THREE.Quaternion(), _mx = new THREE.Matrix4();
  const faceClouds = (dt, eye, snap) => {
    for (const f of faces) {
      _q.copy(f.g.quaternion).invert(); _e.copy(eye).applyQuaternion(_q).sub(f.m.position);
      _t.copy(_e).addScaledVector(f.rad, -_e.dot(f.rad));
      if (_t.lengthSq() > 4) {
        _a.crossVectors(f.rad, _t).normalize();
        const th = Math.atan2(f.rad.dot(_x.crossVectors(f.bx0, _a)), f.bx0.dot(_a));
        const want = th + Math.PI * Math.round((f.yaw - th) / Math.PI);   // a cloud has no front: take the nearer of the two ends
        if (!f.set || snap) { f.yaw = want; f.set = true; }
        else { const step = (want - f.yaw) * (1 - Math.exp(-dt / 1.3)), cap = dt * 0.436; f.yaw += Math.max(-cap, Math.min(cap, step)); }
      }
      const c = Math.cos(f.yaw), sn = Math.sin(f.yaw);
      _x.copy(f.bx0).multiplyScalar(c).addScaledVector(_z.crossVectors(f.rad, f.bx0), sn);
      _z.crossVectors(_x, f.rad);
      f.m.quaternion.setFromRotationMatrix(_mx.makeBasis(_x, f.rad, _z));
      inkFollow(f.m);
    }
  };

  const hemi = new THREE.HemisphereLight("#B2C6E8", "#DDB48E", 0.72);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight("#FFD3A2", 2.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadow, shadow);
  /* Box: 2*BOX m square round the visitor, texel-snapped (aim()). BOX 30 still reaches past the
     ground the 13 m home camera sees in front of Blip; texel = 60 m / 2048 = 2.9 cm (old: 68 m,
     3.3 cm). 4096 was tried: finer, but the glitch harness measured more walk/orbit flicker. With fine texels and the grazing fade above, the
     offsets drop from normalBias 0.22 m (which cut the bottom 22 cm off every caster's shadow,
     so Blip's floated off his feet) to NB_TEX texels' worth of normal offset. */
  const BOX = 30, TEXEL = (2 * BOX) / shadow, NB_TEX = 3;
  const sc = sun.shadow.camera; sc.left = -BOX; sc.right = BOX; sc.top = BOX; sc.bottom = -BOX; sc.near = 1; sc.far = 180;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = NB_TEX * TEXEL;
  sun.shadow.intensity = 0.5;    // pastel world: shadows tint, they don't punch black holes
  scene.add(sun, sun.target);
  // a soft cool fill from the opposite side so faces turned from the sun stay readable
  const fill = new THREE.DirectionalLight("#B4C3E8", 0.45);
  scene.add(fill, fill.target);

  /* The sun is held per region: SUN_ELEV above the visitor's horizon toward a fixed compass
     bearing, re-aimed only after a walk of ~30 deg round the planet (eased), or instantly
     on a teleport. Moving the light every step would slide the toon bands.
     ONE source of truth: `d` (returned as sunDir) is the only sun direction in the app. The sky
     shader, the shadow light, the fill, the pond water (bound to this same Vector3) and the cel
     puffs (fx.sun is this same Vector3) all read it live; nobody keeps a copy. setSun() moves
     elevation/bearing and relights everything in the same call, so a day/night cycle can drive it. */
  const REF = new THREE.Vector3(0.31, 0.12, 0.94).normalize();
  let elev = SUN_ELEV, bear = 0;   // radians; bear spins the compass bearing round the local up
  const sunFor = (up, out) => {
    const t = REF.clone().addScaledVector(up, -REF.dot(up));
    if (t.lengthSq() < 1e-4) t.set(1, 0, 0).addScaledVector(up, -up.x);
    t.normalize();
    if (bear) t.applyAxisAngle(up, bear);
    return out.copy(up).multiplyScalar(Math.sin(elev)).addScaledVector(t, Math.cos(elev)).normalize();
  };
  // the offsets are set in texels at 32 deg. Above 32 normalBias falls as 1/k (k = sin(elev)/sin(32)),
  // and below 32 it falls WITH k (down to 1 texel): a normal offset b moves the shadow lookup
  // b/sin(elev) along flat ground, so a 6-texel clamp at 10 deg would slide Blip's shadow ~1 m off his
  // feet. 1 texel at 10 deg shows no acne on the planet, deck, moon flank or walls.
  const biasFor = () => {
    const k = Math.max(Math.sin(elev), 0.01) / Math.sin(SUN_ELEV);
    sun.shadow.normalBias = NB_TEX * TEXEL * (k >= 1 ? 1 / k : Math.max(k, 1 / NB_TEX));
    sun.shadow.radius = THREE.MathUtils.clamp(k, 0.2, 1);   // SKY_GRAZE edge scale (see top)
    sun.shadow.bias = -0.0004;
    dayFor();
  };
  /* Night: from +6 deg down to the horizon the sun light and its shadows fade smoothly to 0
     (smoothstep), so a sun under the horizon never lights or shadows anything from below. The
     hemisphere ambient rises by up to +0.45 so the world stays readable (a stand-in for a real
     night palette). castShadow stays on (toggling it recompiles every lit shader); the shadow's
     strength goes to 0 instead. shadowK (0..1) is the one fade. */
  const SUN_I = sun.intensity, SHADOW_I = sun.shadow.intensity, HEMI_I = hemi.intensity, FILL_I = fill.intensity;
  let shadowK = 1;
  const BG_DAY = scene.background.clone(), FOG_DAY = scene.fog.color.clone(), BG_NIGHT = new THREE.Color("#1A2347"), FOG_NIGHT = new THREE.Color("#1D2749");
  const dayFor = () => {
    shadowK = THREE.MathUtils.smoothstep(THREE.MathUtils.radToDeg(elev), 0, 6);
    sun.intensity = SUN_I * shadowK;
    sun.shadow.intensity = SHADOW_I * shadowK;
    hemi.intensity = HEMI_I + 0.45 * (1 - shadowK);
    U.uNight.value = 1 - shadowK; night.setK(U.uNight.value);
    scene.background.lerpColors(BG_DAY, BG_NIGHT, 1 - shadowK); scene.fog.color.lerpColors(FOG_DAY, FOG_NIGHT, 1 - shadowK);
    fill.intensity = FILL_I;
  };
  const anchorUp = new THREE.Vector3(0, 1, 0), d = sunFor(anchorUp, new THREE.Vector3()), want = d.clone();
  U.uSun.value = d;   // the sky shader reads the one sun by reference too
  const skyUp = new THREE.Vector3(0, 1, 0), lastUp = new THREE.Vector3(0, 1, 0), lastFocus = new THREE.Vector3();
  const X = new THREE.Vector3(), Y = new THREE.Vector3(), f = new THREE.Vector3();
  let first = true;
  // point the sky shader, shadow light (texel-snapped box), its target and the fill at `d`
  const aim = focus => {
    U.uUp.value.copy(skyUp); night.align(skyUp);
    X.crossVectors(Math.abs(REF.dot(d)) > 0.95 ? new THREE.Vector3(1, 0, 0) : REF, d).normalize();
    Y.crossVectors(d, X);
    sc.up.copy(Y);
    const T = (2 * BOX) / shadow, snap = v => Math.round(v / T) * T;
    f.copy(X).multiplyScalar(snap(focus.dot(X))).addScaledVector(Y, snap(focus.dot(Y))).addScaledVector(d, focus.dot(d));
    sun.target.position.copy(f);
    sun.position.copy(f).addScaledVector(d, 90);
    fill.target.position.copy(focus);
    fill.position.copy(focus).addScaledVector(d, -60).addScaledVector(skyUp, 30);
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld(); fill.updateMatrixWorld(); fill.target.updateMatrixWorld();
  };
  biasFor();
  return {
    sunDir: d,
    light: sun, fill, clouds, cloudPlanes: planes, cloudFaces: faces,
    /* sky.setSun({ elevation, bearing }) -- DEGREES. elevation: height above the local horizon
       (32 is the shipped sunset). bearing: turn of the sun round the local up from the shipped
       compass bearing (0 = as shipped). Either may be omitted. Relights in this call: d (sunDir,
       shared by water and puffs), sky uSun, light + target + shadow box, fill, shadow offsets. */
    setSun({ elevation, bearing } = {}) {
      if (elevation !== undefined) elev = THREE.MathUtils.degToRad(elevation);
      if (bearing !== undefined) bear = THREE.MathUtils.degToRad(bearing);
      sunFor(anchorUp, want); d.copy(want);
      biasFor(); aim(lastFocus);
    },
    get sun() { return { elevation: THREE.MathUtils.radToDeg(elev), bearing: THREE.MathUtils.radToDeg(bear), dir: d, light: sun, uSun: U.uSun.value, shadowK, intensity: sun.intensity, shadowIntensity: sun.shadow.intensity, hemi: hemi.intensity }; },
    get shadowK() { return shadowK; },
    cloudFace: true,
    update(dt, t, focus, up, eye) {
      U.uTime.value = t;
      for (const g of planes) { const o = g.userData; o.ang += dt * o.speed; g.quaternion.setFromAxisAngle(o.axis, o.ang); }   // every plane turns the same way: one drift direction
      if (eye && this.cloudFace) faceClouds(dt, eye, first);
      // a jump of more than ~20 deg in one frame is a cut (fast travel, cannon landing): relight instantly
      const cut = lastUp.angleTo(up) > 0.35;
      lastUp.copy(up); lastFocus.copy(focus);
      if (first || cut || anchorUp.angleTo(up) > 0.52) { anchorUp.copy(up); sunFor(anchorUp, want); }
      if (first || cut) { d.copy(want); skyUp.copy(up); first = false; }
      d.lerp(want, 1 - Math.exp(-dt * 0.9)).normalize();
      skyUp.lerp(up, 1 - Math.exp(-dt * 2)).normalize();
      aim(focus);
    },
  };
}
