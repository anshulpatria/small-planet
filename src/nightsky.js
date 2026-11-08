import * as THREE from "three";

/* Night sky + fireflies (R7 night upgrade). Night only: nothing here is visible or drawn at k = 0.
   - createNightStars(U): a Points layer of ~170 brighter stars with a SMALL soft halo each (the faked, subtle bloom), a few of them
     twinkling. It sits at the sky dome's depth (z = w) so the planet, clouds and props cover it. It is rotated into the same
     local frame as the dome's Milky Way (east / up / north round the visitor), so stars and band stay together.
     sky.js owns the dome shader (the band, dust lanes, the fine star field) and reads BAND from here.
   - installFireflies({ scene, bodies, getK }): ~60 fireflies that hover 0.3-1.6 m above the ground near the player. */

/* The Milky Way's great circle, in the local frame (x east, y up, z north). A low tilt keeps it near the horizon at every azimuth,
   which is where the follow camera sees sky (above the planet's limb); the core sits ~19 deg up, so it rides in the upper frame. */
const TILT = THREE.MathUtils.degToRad(19), AZ = THREE.MathUtils.degToRad(35);
const BN = new THREE.Vector3(Math.sin(TILT) * Math.cos(AZ), Math.cos(TILT), Math.sin(TILT) * Math.sin(AZ)).normalize();
const BA = new THREE.Vector3().crossVectors(BN, new THREE.Vector3(0, 1, 0)).normalize();   // on the horizon
const BB = new THREE.Vector3().crossVectors(BN, BA);                                         // BN x BA, in the plane
if (BB.y < 0) BB.negate();                                                                    // the in-plane axis that climbs
const CORE_ANG = Math.PI / 2;   // the core is where the circle peaks: along BB, from BA
export const BAND = { n: BN, a: BA, b: BB, core: CORE_ANG };
/* the dome shader measures `along` from the core: core direction = BB, so a = BB and b = -BA/BA (any perpendicular in plane) */
export const REFV = new THREE.Vector3(0.31, 0.12, 0.94);

const mulberry = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

export function createNightStars(U, R = 1400) {
  const rnd = mulberry(70417), N = 170;
  const pos = new Float32Array(N * 3), S = new Float32Array(N * 4), C = new Float32Array(N * 3);
  const v = new THREE.Vector3(), tw = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    if (rnd() < 0.5) {   // uniform on the sphere
      v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); if (v.lengthSq() > 1 || v.lengthSq() < 1e-3) { i--; continue; } v.normalize();
    } else {             // hugging the band: a gaussian in latitude about the great circle
      const g = (rnd() + rnd() + rnd() - 1.5) * 0.45, al = rnd() * Math.PI * 2, c = Math.sqrt(Math.max(0, 1 - g * g));
      v.copy(BN).multiplyScalar(g).addScaledVector(BA, c * Math.cos(al)).addScaledVector(BB, c * Math.sin(al));
    }
    pos[i * 3] = v.x * R; pos[i * 3 + 1] = v.y * R; pos[i * 3 + 2] = v.z * R;
    const m = Math.pow(rnd(), 2.6);                                  // few are really bright
    S[i * 4] = 9 + 17 * m;                                           // sprite px (core is ~1/8 of it, the halo fills the rest)
    S[i * 4 + 1] = 0.55 + 0.45 * m;                                  // brightness
    S[i * 4 + 2] = rnd() < 0.16 ? 0.4 + rnd() : 0;                   // twinkle (a few stars only)
    const t = rnd();                                                  // tint: cool blue-white, white, warm
    const col = t < 0.3 ? [0.72, 0.82, 1.0] : t < 0.75 ? [1.0, 0.98, 0.96] : [1.0, 0.86, 0.66];
    C.set(col, i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("aS", new THREE.BufferAttribute(S, 4)); geo.setAttribute("aCol", new THREE.BufferAttribute(C, 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 }, uK: { value: 0 } },
    vertexShader: `uniform float uTime, uPx, uK; attribute vec4 aS; attribute vec3 aCol; varying float vB; varying vec3 vC;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_Position.z = gl_Position.w;
        float t = aS.z > 0.0 ? 0.8 + 0.2 * sin(uTime * (0.7 + aS.z * 1.1) + aS.z * 40.0) : 1.0;
        vB = aS.y * t * uK; vC = aCol; gl_PointSize = aS.x * uPx * (0.94 + 0.06 * t); }`,
    fragmentShader: `varying float vB; varying vec3 vC;
      void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float r2 = dot(p, p); if (r2 > 1.0) discard;
        float core = exp(-r2 * 120.0), halo = exp(-r2 * 14.0) * 0.17 * (1.0 - r2);
        vec3 c = (mix(vC, vec3(1.0), core) * core + vC * halo) * vB;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; points.renderOrder = -2; points.visible = false; points.matrixAutoUpdate = true;
  points.onBeforeRender = r => { mat.uniforms.uPx.value = r.getPixelRatio(); mat.uniforms.uTime.value = performance.now() / 1000; };
  const E = new THREE.Vector3(), Nn = new THREE.Vector3(), M = new THREE.Matrix4();
  return {
    points,
    /* the local frame round `up`, shared with the dome shader (U.uEast / U.uNorth) */
    align(up) {
      E.crossVectors(up, REFV).normalize(); Nn.crossVectors(E, up);
      U.uEast.value.copy(E); U.uNorth.value.copy(Nn);
      M.makeBasis(E, up, Nn); points.quaternion.setFromRotationMatrix(M);
    },
    setK(k) { points.visible = k > 0.001; mat.uniforms.uK.value = THREE.MathUtils.smoothstep(k, 0.3, 1.0); },
  };
}

/* ---------------- fireflies ---------------- */
const FF = 60, RADIUS = 16, FADE_IN = 11;   // metres round the player: full below FADE_IN, gone by RADIUS

export function installFireflies({ scene, bodies = {}, getK = () => 0 }) {
  const rnd = mulberry(5150);
  const T = new Float32Array(FF * 3);
  const P = new Float32Array(FF * 3), A = new Float32Array(FF * 4);   // A: phase, period, size, glint
  const dir = [], t1 = [], t2 = [], par = [];
  for (let i = 0; i < FF; i++) {
    dir.push(new THREE.Vector3(0, 1, 0)); t1.push(new THREE.Vector3(1, 0, 0)); t2.push(new THREE.Vector3(0, 0, 1));
    par.push({ ax: 0.5 + rnd() * 1.4, ay: 0.5 + rnd() * 1.4, fx: 0.11 + rnd() * 0.18, fy: 0.09 + rnd() * 0.17, px: rnd() * 6.283, py: rnd() * 6.283, p2: rnd() * 6.283, hf: 0.15 + rnd() * 0.25, hp: rnd() * 6.283, live: false });
    A[i * 4] = rnd(); A[i * 4 + 1] = 1.5 + rnd() * 2.5; A[i * 4 + 2] = 0.8 + rnd() * 0.5; A[i * 4 + 3] = rnd();
  }
  const geo = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(P, 3); pa.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", pa); geo.setAttribute("aA", new THREE.BufferAttribute(A, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uTime: { value: 0 }, uPx: { value: 1 }, uK: { value: 0 }, uPlayer: { value: new THREE.Vector3() } },
    vertexShader: `uniform float uTime, uPx, uK; uniform vec3 uPlayer; attribute vec4 aA; varying float vG; varying float vS;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        float ph = fract(uTime / aA.y + aA.x), p = 0.5 + 0.5 * sin(6.2831853 * ph);
        float on = smoothstep(0.12, 0.92, p); on *= on * (0.75 + 0.25 * sin(uTime * 7.0 + aA.w * 30.0));
        float fade = 1.0 - smoothstep(${FADE_IN.toFixed(1)}, ${RADIUS.toFixed(1)}, distance(position, uPlayer));
        vG = on * fade * uK; vS = aA.z;
        float d = max(-mv.z, 0.5);
        gl_PointSize = clamp(22.0 * aA.z * uPx * clamp(14.0 / d, 0.55, 1.7) * (0.6 + 0.4 * on), 3.0, 64.0); }`,
    fragmentShader: `varying float vG; varying float vS;
      void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float r2 = dot(p, p); if (r2 > 1.0 || vG < 0.002) discard;
        float pin = exp(-r2 * 70.0), core = exp(-r2 * 16.0), halo = exp(-r2 * 3.6) * (1.0 - r2);
        vec3 c = vec3(0.55, 0.95, 0.08) * halo * 0.42 + vec3(0.92, 1.0, 0.25) * core * 0.9 + vec3(1.0, 1.0, 0.80) * pin * 0.9;
        gl_FragColor = vec4(c * vG, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.renderOrder = 8; pts.visible = false; scene.add(pts);

  const _o = new THREE.Vector3(), _n = new THREE.Vector3(), _a = new THREE.Vector3();
  let body = null, lastT = 0;
  const pickBody = pp => { let best = null, bd = 1e9; for (const b of Object.values(bodies)) { if (!b || !b.centre) continue; const d = Math.abs(pp.distanceTo(b.centre) - b.R); if (d < bd) { bd = d; best = b; } } return best; };
  const tangents = (n, a, b) => { _a.set(Math.abs(n.y) < 0.9 ? 0 : 1, Math.abs(n.y) < 0.9 ? 1 : 0, 0); a.crossVectors(_a, n).normalize(); b.crossVectors(n, a); };
  // put firefly i at a random spot round the player's up, rho metres out; `fwd` biases it ahead of Blip
  const place = (i, up, facing, rho, ang) => {
    const u = dir[i]; tangents(up, _o, _n);
    u.copy(up).multiplyScalar(body.R).addScaledVector(_o, Math.cos(ang) * rho).addScaledVector(_n, Math.sin(ang) * rho).normalize();
    tangents(u, t1[i], t2[i]); par[i].live = true;
  };
  const scatter = (pl, all) => {
    const up = pl.up, f = pl.facing;
    for (let i = 0; i < FF; i++) {
      const p = par[i]; const d = dir[i];
      const dist = p.live ? Math.acos(Math.min(1, d.dot(up))) * body.R : 1e9;
      if (!all && dist < RADIUS) continue;
      let ang;
      if (all) ang = rnd() * 6.283;
      else { tangents(up, _o, _n); const fa = Math.atan2(f.dot(_n), f.dot(_o)); ang = rnd() < 0.7 ? fa + (rnd() - 0.5) * 2.2 : rnd() * 6.283; }
      place(i, up, f, all ? 1.5 + 11.5 * Math.pow(rnd(), 1.3) : 13 + rnd() * 2.5, ang);
    }
  };
  pts.onBeforeRender = r => {
    const now = performance.now() / 1000;
    mat.uniforms.uPx.value = r.getPixelRatio(); mat.uniforms.uTime.value = now;
    const ap = window.__archipelago, pl = ap && ap.player; if (!pl || !pl.position) return;
    const b = pickBody(pl.position);
    if (b !== body) { body = b; scatter(pl, true); } else if (body) scatter(pl, false);
    if (!body) return;
    mat.uniforms.uPlayer.value.copy(pl.position);
    for (let i = 0; i < FF; i++) {
      const p = par[i], d = dir[i];
      const ox = p.ax * (Math.sin(now * p.fx + p.px) + 0.5 * Math.sin(now * p.fx * 2.31 + p.p2)), oy = p.ay * (Math.sin(now * p.fy + p.py) + 0.5 * Math.cos(now * p.fy * 1.93 + p.p2));
      _n.copy(d).multiplyScalar(body.R).addScaledVector(t1[i], ox).addScaledVector(t2[i], oy).normalize();
      const h = 0.3 + 1.3 * (0.5 + 0.5 * Math.sin(now * p.hf + p.hp)), rr = body.surface(_n) + h;
      P[i * 3] = body.centre.x + _n.x * rr; P[i * 3 + 1] = body.centre.y + _n.y * rr; P[i * 3 + 2] = body.centre.z + _n.z * rr;
    }
    pa.needsUpdate = true;
  };
  // day: not rendered at all (visible = false); night: faded in by k
  const poll = () => { const k = getK(); const v = k > 0.001; if (pts.visible !== v) pts.visible = v; mat.uniforms.uK.value = THREE.MathUtils.smoothstep(k, 0.4, 1.0); requestAnimationFrame(poll); };
  requestAnimationFrame(poll);
  return { points: pts, count: FF };
}
