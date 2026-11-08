import * as THREE from "three";
import { inkU, INK_PX } from "./toon.js?v=20261108-2312";

/* Fishbowl helmet for Blip's cannon trip.
   A transparent toon bubble parented to the figure (so it tumbles with him in flight), open at the
   bottom and closed off by a thin ink collar ring. The look is all in the shader, so no ink hull is
   needed (a hull sphere would fill the whole disc behind the glass): a thin ink line on the silhouette
   (constant INK_PX screen width, like toon.js), a hard-edged soft-white rim band, and a specular
   streak plus a dot, in three flat steps. Transparent, depthWrite off, renderOrder high, never casts a
   shadow. Enclosing size: his body is 0.75 m wide and ~1.1 m tall with the antennae to 1.50 m (spring
   ball, the tallest of the four customiser options), so R 0.72 centred at y 0.80 spans 0.08..1.52 and
   the collar sits at y 0.42 (radius 0.61), clear of his arms (they reach 0.6 m out at shoulder height).
   The scale pops on and off through `setHelmet` / `updateHelmet`; everything lives under one group so a
   scale of 0 hides it with no leftover. */

export const HELMET = { radius: 0.72, centreY: 0.80, cutY: 0.42, collarR: 0, top: 1.52 };
const RADIUS = HELMET.radius, CENTRE_Y = HELMET.centreY, CUT_Y = HELMET.cutY;
HELMET.collarR = Math.sqrt(RADIUS * RADIUS - (CUT_Y - CENTRE_Y) ** 2);

let mat, ringMat;
function material() {
  if (mat) return mat;
  mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, side: THREE.FrontSide,
    uniforms: { inkRes: inkU.res, uInk: { value: new THREE.Color("#1E1F26") }, uPx: { value: INK_PX }, uFade: { value: 1 } },
    vertexShader: /* glsl */`
      uniform vec3 inkRes;
      varying vec3 vN; varying float vRpx; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = -mv.xyz;
        vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec4 cp = projectionMatrix * c;
        float sc = length(modelMatrix[0].xyz);
        vRpx = ${RADIUS.toFixed(3)} * sc * projectionMatrix[1][1] / max(cp.w, 0.01) * inkRes.y * 0.5 / inkRes.z;   // CSS px radius
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uInk; uniform float uPx, uFade;
      varying vec3 vN; varying float vRpx; varying vec3 vV;
      void main() {
        vec3 n = normalize(vN), v = normalize(vV);
        float ndv = clamp(dot(n, v), 0.0, 1.0);
        float r = sqrt(max(0.0, 1.0 - ndv * ndv));              // 0 centre .. 1 silhouette
        float edgePx = (1.0 - r) * vRpx;                         // css px in from the silhouette (ortho approx)
        float ink = 1.0 - step(uPx, edgePx);
        float rim = 1.0 - step(vRpx * 0.12 + uPx, edgePx);       // soft-white band inside the ink
        // sun-side streak: an arc in view space, upper left
        vec2 p = n.xy;
        vec2 q = p - vec2(-0.50, 0.46);
        float s1 = 1.0 - step(1.0, dot(q * vec2(2.9, 1.0), q * vec2(2.9, 1.0)) / 0.045 * 0.5);
        vec2 q2 = p - vec2(-0.30, 0.74);
        float s2 = 1.0 - step(1.0, dot(q2, q2) / 0.0016);
        float streak = max(s1 * step(0.3, ndv), s2);
        vec3 col = vec3(0.86, 0.95, 1.0);
        float a = 0.07 + 0.05 * (1.0 - ndv);                      // faint cool tint, a touch denser to the edge
        a = mix(a, 0.30, rim);
        col = mix(col, vec3(1.0), rim * 0.6);
        a = mix(a, 0.78, streak); col = mix(col, vec3(1.0), streak);
        col = mix(col, uInk, ink); a = mix(a, 0.88, ink);
        gl_FragColor = vec4(col, a * uFade);
      }`,
  });
  mat.name = "helmet_glass";
  ringMat = new THREE.MeshBasicMaterial({ color: "#1E1F26" });
  ringMat.name = "helmet_collar";
  return mat;
}

export function createHelmet(figure) {
  const glassMat = material();
  const root = new THREE.Group();
  root.name = "HELMET";
  root.position.y = CENTRE_Y;
  root.visible = false; root.scale.setScalar(0);
  const theta = Math.acos((CUT_Y - CENTRE_Y) / RADIUS);   // open below the collar plane
  const glass = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 44, 30, 0, Math.PI * 2, 0, theta), glassMat);
  glass.name = "HELMET_glass";
  glass.renderOrder = 50;      // after every opaque and after the occluder-fade clones
  const ring = new THREE.Mesh(new THREE.TorusGeometry(HELMET.collarR, 0.03, 8, 48), ringMat);
  ring.name = "HELMET_collar";
  ring.rotation.x = Math.PI / 2; ring.position.y = CUT_Y - CENTRE_Y;
  for (const m of [glass, ring]) {
    m.castShadow = m.receiveShadow = false; m.frustumCulled = false;
    m.raycast = () => {};
    m.userData.isOutline = true;   // keeps soot / ink traversals (which skip outlines) away from it
    root.add(m);
  }
  root.userData = { isOutline: true, s: 0, v: 0, mode: "off", t: 0, dur: 0.15, glass, ring };
  figure.add(root);
  return root;
}

/* "on": spring up with a little overshoot; "off": ease to nothing in `dur` s; "pop": swell, then burst away (the landing) */
export function setHelmet(h, on, mode, dur = 0.15) {
  const u = h.userData;
  const m = mode || (on ? "on" : "off");
  if (m === u.mode && (m === "on" || m === "off")) return;
  u.mode = m; u.dur = dur; u.t = 0;
  if (m === "on") h.visible = true;
}
const sm = x => THREE.MathUtils.smoothstep(x, 0, 1);
export function updateHelmet(h, dt) {
  if (!h) return;
  const u = h.userData;
  if (u.mode === "on") {
    // damped spring toward 1 (omega 24, zeta 0.55): one small overshoot
    // sub-stepped so a slow frame (dt 1/20) cannot blow the spring up
    const w = 24, z = 0.55, n = Math.max(1, Math.ceil(dt / (1 / 240))), h2 = dt / n;
    for (let i = 0; i < n; i++) { const a = w * w * (1 - u.s) - 2 * z * w * u.v; u.v += a * h2; u.s += u.v * h2; }
    if (Math.abs(1 - u.s) < 0.002 && Math.abs(u.v) < 0.02) { u.s = 1; u.v = 0; }
  } else if (u.mode === "off") {
    u.v = 0; u.s = Math.max(0, u.s - dt / u.dur);
  } else if (u.mode === "pop") {
    u.t += dt; const s0 = u.s0 ?? (u.s0 = Math.max(u.s, 0.01));
    u.s = u.t < 0.08 ? s0 * (1 + 0.18 * sm(u.t / 0.08)) : s0 * 1.18 * (1 - sm(Math.min(1, (u.t - 0.08) / 0.17)));
    if (u.t >= 0.25) { u.s = 0; u.mode = "off"; u.s0 = undefined; }
  }
  if (u.mode !== "pop") u.s0 = undefined;
  h.scale.setScalar(Math.max(0, u.s));
  h.visible = u.s > 0.003;
}
