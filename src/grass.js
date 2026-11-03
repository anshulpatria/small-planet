import * as THREE from "three";

/* Grass. The ground's colour is one function of the surface direction, written twice (GLSL for
   the ground and the tufts, JS for placing tufts), so a tuft's root is exactly the colour of the
   ground it grows from and only its tip reads as a blade. The ground is domain-warped value noise in
   three soft cel bands (sunlit, meadow, clover), with lilac flower beds, sandy patches, a fine
   speckle that fades out before it can shimmer, and the sandy roads on top.

   Tufts are one InstancedMesh of five-blade clumps over the open ground (off terraces, roads,
   ponds, flower beds and props). They are lit like the ground (the sphere normal), sway in a
   slow wind, lean away from Blip's feet, and shrink to nothing before they are small enough to
   alias in the distance. */

const GROUND_COLOURS = {
  uSun: "#A8DC97", uMeadow: "#8ED193", uClover: "#73C08A",
  uLilac: "#B39BEF", uPeach: "#FFB98C", uRoad: "#FBE3B5",
};

/* GLSL: noise + the ground colour. Needs uniforms uPole, uEnds[12], uR and the colours above. */
export const GROUND_GLSL = /* glsl */`
  uniform vec3 uPole; uniform vec3 uEnds[12]; uniform vec3 uStarts[12]; uniform float uR;
  uniform vec3 uSun, uMeadow, uClover, uLilac, uPeach, uRoad;
  float gHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float gNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(gHash(i), gHash(i + vec3(1,0,0)), f.x), mix(gHash(i + vec3(0,1,0)), gHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(gHash(i + vec3(0,0,1)), gHash(i + vec3(1,0,1)), f.x), mix(gHash(i + vec3(0,1,1)), gHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float gFbm(vec3 p) { return 0.55 * gNoise(p) + 0.3 * gNoise(p * 2.03 + 7.1) + 0.15 * gNoise(p * 4.1 + 3.7); }
  /* the three noise fields the colour is made of (x: grass tone, y: flower beds, z: sand) */
  vec3 gFields(vec3 d) {
    vec3 q = d * 3.1;
    q += 0.55 * vec3(gNoise(q * 1.6 + 11.0), gNoise(q * 1.6 + 23.0), gNoise(q * 1.6 + 37.0));
    return vec3(gFbm(q), gFbm(d * 2.3 + 5.0), gFbm(d * 2.6 + 17.0));
  }
  float gAA(float e, float x, float w) { return smoothstep(e - w, e + w, x); }
  /* distance in metres to the nearest sandy road (a great-circle arc from the summit) */
  float gRoad(vec3 p) {
    float road = 1e3;
    for (int i = 0; i < 12; i++) {
      vec3 b = uEnds[i]; vec3 a0 = uStarts[i]; vec3 nrm = cross(a0, b); float L = length(nrm);
      if (L < 1e-3) continue; nrm /= L;
      float span = acos(clamp(dot(a0, b), -1.0, 1.0));
      float along = acos(clamp(dot(p, a0), -1.0, 1.0)) + acos(clamp(dot(p, b), -1.0, 1.0));
      if (along < span + 0.03) road = min(road, asin(clamp(abs(dot(p, nrm)), 0.0, 1.0)) * uR);
    }
    return road;
  }
  /* w: antialias width in field units (0 = hard) */
  vec3 groundCol(vec3 d, float w) {
    vec3 f = gFields(d);
    // the grass-tone bands get a soft minimum edge (~0.4 m) so a small meadow island inside clover
    // reads as a sunny patch, not a hard pale ellipse; lilac, sand and road keep their crisp edges
    float wx = max(w, 0.02);
    vec3 c = mix(uMeadow, uSun, gAA(0.56, f.x, wx));
    c = mix(c, uClover, 1.0 - gAA(0.4, f.x, wx));
    c = mix(c, uLilac, gAA(0.66, f.y, w));
    c = mix(c, uPeach, 1.0 - gAA(0.3, f.z, w));
    return c;
  }`;

/* ---- the same functions in JS (placement only; float precision differs a hair from the GPU) */
const fract = x => x - Math.floor(x);
function hash(x, y, z) {
  x = fract(x * 0.3183099 + 0.1) * 17; y = fract(y * 0.3183099 + 0.1) * 17; z = fract(z * 0.3183099 + 0.1) * 17;
  return fract(x * y * z * (x + y + z));
}
function noise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(hash(ix, iy, iz), hash(ix + 1, iy, iz), fx), L(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), fx), fy),
           L(L(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), fx), L(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), fx), fy), fz);
}
const fbm = (x, y, z) => 0.55 * noise(x, y, z) + 0.3 * noise(x * 2.03 + 7.1, y * 2.03 + 7.1, z * 2.03 + 7.1) + 0.15 * noise(x * 4.1 + 3.7, y * 4.1 + 3.7, z * 4.1 + 3.7);
export function groundFields(d) {
  let qx = d.x * 3.1, qy = d.y * 3.1, qz = d.z * 3.1;
  const wx = noise(qx * 1.6 + 11, qy * 1.6 + 11, qz * 1.6 + 11), wy = noise(qx * 1.6 + 23, qy * 1.6 + 23, qz * 1.6 + 23), wz = noise(qx * 1.6 + 37, qy * 1.6 + 37, qz * 1.6 + 37);
  qx += 0.55 * wx; qy += 0.55 * wy; qz += 0.55 * wz;
  return { tone: fbm(qx, qy, qz), bed: fbm(d.x * 2.3 + 5, d.y * 2.3 + 5, d.z * 2.3 + 5), sand: fbm(d.x * 2.6 + 17, d.y * 2.6 + 17, d.z * 2.6 + 17) };
}
function roadDistance(d, pole, ends, R, starts) {
  let road = 1e3;
  const nrm = new THREE.Vector3();
  for (let i = 0; i < ends.length; i++) {
    const b = ends[i], a0 = starts ? starts[i] : pole;
    nrm.crossVectors(a0, b); const L = nrm.length();
    if (L < 1e-3) continue; nrm.divideScalar(L);
    const span = Math.acos(THREE.MathUtils.clamp(a0.dot(b), -1, 1));
    const along = Math.acos(THREE.MathUtils.clamp(d.dot(a0), -1, 1)) + Math.acos(THREE.MathUtils.clamp(d.dot(b), -1, 1));
    if (along < span + 0.03) road = Math.min(road, Math.asin(Math.min(1, Math.abs(d.dot(nrm)))) * R);
  }
  return road;
}

/* uniforms shared by the ground and the tufts */
export function groundUniforms(body) {
  const pole = body.plateaus.reduce((a, p) => (p.n.y > a.n.y ? p : a));
  const ends = body.plateaus.filter(p => p !== pole).map(p => p.n.clone());
  /* a far terrace whose road would leave the summit within 15 deg of a nearer terrace's road would make a "Y" (two bands
     running side by side, then forking). That far road starts at the nearer terrace instead (a chain: summit to
     terrace, terrace to the next one), so no road forks off another and every road still leads somewhere. */
  const bear = e => Math.atan2(e.dot(new THREE.Vector3().crossVectors(pole.n, new THREE.Vector3(1, 0, 0)).normalize().cross(pole.n)) , e.dot(new THREE.Vector3().crossVectors(pole.n, new THREE.Vector3(1, 0, 0)).normalize()));
  const dist = e => Math.acos(THREE.MathUtils.clamp(e.dot(pole.n), -1, 1));
  const starts = ends.map(e => {
    let best = null;
    for (const s of ends) {
      if (s === e || dist(s) >= dist(e) - 0.2) continue;
      const db = Math.abs(Math.atan2(Math.sin(bear(e) - bear(s)), Math.cos(bear(e) - bear(s))));
      if (db < 0.26 && (!best || dist(s) > dist(best))) best = s;
    }
    return best ? best.clone() : pole.n.clone();
  });
  while (ends.length < 12) { ends.push(pole.n.clone()); starts.push(pole.n.clone()); }
  const U = { uPole: { value: pole.n.clone() }, uEnds: { value: ends.slice(0, 12) }, uStarts: { value: starts.slice(0, 12) }, uR: { value: body.R } };
  for (const [k, v] of Object.entries(GROUND_COLOURS)) U[k] = { value: new THREE.Color(v) };
  return U;
}

/* one clump: five tapered, slightly curved blades leaning outward, 1 unit tall (scaled per instance) */
function tuftGeometry() {
  const pos = [], h = [], idx = [];
  const blades = [[0, 0, 0, 1.0], [1.3, 0.06, 0.03, 0.82], [2.5, -0.05, 0.05, 0.9], [3.8, 0.04, -0.06, 0.74], [5.1, -0.06, -0.02, 0.86]];
  for (const [a, ox, oz, ht] of blades) {
    const dx = Math.cos(a), dz = Math.sin(a), sx = -dz, sz = dx;   // lean direction and the blade's width axis
    const lean = 0.32, wid = 0.09, base = pos.length / 3;
    const ring = (t, w) => {
      const y = t * ht, out = lean * t * t * ht;
      for (const s of [-1, 1]) { pos.push(ox + dx * out + sx * w * s, y, oz + dz * out + sz * w * s); h.push(t); }
    };
    ring(0, wid); ring(0.5, wid * 0.7);
    pos.push(ox + dx * lean * ht, ht, oz + dz * lean * ht); h.push(1);
    idx.push(base, base + 1, base + 3, base, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute("aH", new THREE.Float32BufferAttribute(h, 1));
  g.setIndex(idx);
  return g;
}

export class Grass {
  /* `ok(dir)`: extra placement test (ponds, props, benches); `count`: clumps */
  constructor(scene, body, U, { count = 2600, ok = () => true, seed = 11 } = {}) {
    this.U = Object.assign({}, U, {
      uTime: { value: 0 }, uWind: { value: 1 }, uFeet: { value: new THREE.Vector3(1e4, 0, 0) },
      uCentre: { value: body.centre.clone() }, uFar: { value: new THREE.Vector2(26, 38) },
    });
    let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const pole = U.uPole.value, ends = U.uEnds.value;
    const good = d => {
      if (body.surface(d) > body.R + 0.003) return false;
      for (const p of body.plateaus) if (d.angleTo(p.n) < p.t1 + 0.5 / body.R) return false;   // terraces and their skirts
      if (roadDistance(d, pole, ends, body.R, U.uStarts.value) < 1.9) return false;
      const f = groundFields(d);
      if (f.bed > 0.63 || f.sand < 0.33) return false;    // flower beds and sand stay bare
      return ok(d);
    };
    const mats = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const d = new THREE.Vector3(), c = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let k = 0, tries = 0; k < count && tries < count * 12; tries++) {
      c.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
      if (c.lengthSq() > 1 || c.lengthSq() < 1e-3) continue;
      c.normalize();
      if (!good(c)) continue;
      k++;
      t1.set(1, 0, 0).cross(c); if (t1.lengthSq() < 0.01) t1.set(0, 0, 1).cross(c);
      t1.normalize(); t2.crossVectors(c, t1);
      const n = 3 + Math.floor(rnd() * 4), spread = 0.25 + rnd() * 0.3;
      for (let j = 0; j < n; j++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * spread;
        d.copy(c).multiplyScalar(body.R).addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r).normalize();
        if (j && !good(d)) continue;
        q.setFromUnitVectors(up, d);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(up, rnd() * Math.PI * 2));
        const hgt = 0.3 + rnd() * 0.2, wd = 0.9 + rnd() * 0.5;
        sc.set(hgt * wd, hgt, hgt * wd);
        m.compose(d.clone().multiplyScalar(body.R - 0.02).add(body.centre), q, sc);
        mats.push(m.clone());
      }
    }
    const geo = tuftGeometry();
    const mat = new THREE.MeshToonMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const UU = this.U;
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, UU);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", `#include <common>
          attribute float aH; varying float vH; varying vec3 vRoot;
          uniform float uTime, uWind; uniform vec3 uFeet, uCentre; uniform vec2 uFar;`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          vec4 rootW = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vRoot = normalize(rootW.xyz - uCentre); vH = aH;
          float far = 1.0 - smoothstep(uFar.x, uFar.y, distance(rootW.xyz, cameraPosition));
          // wind: a slow travelling gust plus a flutter, both growing with height
          float ph = dot(rootW.xyz, vec3(0.37, 0.21, 0.29));
          float gust = sin(uTime * 1.1 + ph) * 0.6 + sin(uTime * 2.7 + ph * 2.3) * 0.25;
          transformed.x += gust * 0.16 * aH * aH * uWind;
          transformed.z += sin(uTime * 1.7 + ph * 1.3) * 0.08 * aH * aH * uWind;
          // lean away from Blip's feet (bend in world space, then back to the clump's frame)
          vec3 away = rootW.xyz - uFeet; float dd = length(away);
          if (dd < 0.9 && dd > 1e-3) {
            float k = 1.0 - dd / 0.9;
            vec3 side = away - vRoot * dot(away, vRoot);
            vec3 push = (dot(side, side) > 1e-6 ? normalize(side) : vec3(0.0)) * k * 0.22 * aH;   // metres
            transformed += inverse(mat3(modelMatrix * instanceMatrix)) * push;
            transformed.y -= 0.35 * k * aH;
          }
          transformed *= far;`);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>
          varying float vH; varying vec3 vRoot;
          ${GROUND_GLSL}`)
        .replace("#include <color_fragment>", `#include <color_fragment>
          vec3 gc = groundCol(vRoot, 0.0);
          // root = the ground exactly; the tip lightens and warms a touch, in two flat steps
          vec3 tip = gc * vec3(1.16, 1.2, 0.98) + vec3(0.07, 0.08, 0.0);
          diffuseColor.rgb = mix(gc, tip, smoothstep(0.3, 0.36, vH) * 0.5 + smoothstep(0.66, 0.72, vH) * 0.5);`)
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
          normal = normalize((viewMatrix * vec4(vRoot, 0.0)).xyz);`);
    };
    mat.customProgramCacheKey = () => "grass-tuft";
    this.mesh = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((mm, i) => this.mesh.setMatrixAt(i, mm));
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.frustumCulled = false;   // spread over the whole planet; far clumps collapse in the vertex shader
    this.mesh.castShadow = false; this.mesh.receiveShadow = true;
    this.mesh.raycast = () => {};
    this.mesh.name = "GRASS";
    this.count = mats.length;
    scene.add(this.mesh);
  }
  update(t, feet) { this.U.uTime.value = t; if (feet) this.U.uFeet.value.copy(feet); }
  setWind(k) { this.U.uWind.value = k; }
}
