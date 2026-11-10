import * as THREE from "three";
import { outline } from "./toon.js?v=20261110-0921";

/* Blip customiser. State model for every option; saved under its own key
   (never "archipelago.v1"). apply(figure, state) restyles the toy.glb figure in place:
   - antenna: the current two sprouts are Blip_5 (coral, bones sproutA1/A2) and Blip_6 (yellow,
     sproutB1/B2). A new antenna (bulb, spring, leaf) is a set of SkinnedMeshes bound to the same
     skeleton (and Blip_5's bindMatrix), weighted to the sprout bones, inked with outline() so each
     hull is a SkinnedMesh on the same skeleton: it rides every animation like the original.
   - colour: Toy_Body + Toy_BodyDark (arms/legs) colours. Teal is the toy.glb colour exactly.
   - pattern: "spots" (the default look) are the body-bone verts of Toy_Sparkle (Blip_7; its eye-bone
     verts are the eye glint and always stay). Stripes and freckles are drawn in the body's toon
     shader from bind-space position, before lighting, so the 3 cel bands still apply on top; they
     use darker steps of the body colour. */

export const KEY = "archipelago.blip.v1";
export const OPTIONS = {
  antenna: [
    { id: "sprouts", label: "Sprouts" },
    { id: "bulb", label: "Bulb" },
    { id: "spring", label: "Spring" },
    { id: "leaf", label: "Leaf" },
  ],
  // body = Toy_Body, dark = Toy_BodyDark (limbs, stripes, bulb stalk), deep = freckles
  colour: [
    { id: "teal", label: "Teal", body: "#3FA7A3", dark: "#2E8C88", deep: "#23706C" },
    { id: "lilac", label: "Lilac", body: "#A678B0", dark: "#8F5C9B", deep: "#734A7D" },
    { id: "coral", label: "Coral", body: "#E2705C", dark: "#CC5540", deep: "#A84331" },
    { id: "apricot", label: "Apricot", body: "#EB9A5A", dark: "#D9803A", deep: "#B0662B" },
    { id: "butter", label: "Butter", body: "#E2C35E", dark: "#CCA93F", deep: "#A38532" },
    { id: "sage", label: "Sage", body: "#8CAD6A", dark: "#749654", deep: "#5C7942" },
    { id: "cornflower", label: "Cornflower", body: "#6E98CF", dark: "#5280BC", deep: "#3F6699" },
    { id: "rose", label: "Rose", body: "#D27A9C", dark: "#BF5F84", deep: "#9C4A6A" },
  ],
  pattern: [
    { id: "none", label: "None" },
    { id: "spots", label: "Spots" },
    { id: "stripes", label: "Stripes" },
    { id: "freckles", label: "Freckles" },
  ],
};
export const DEFAULT = { antenna: "sprouts", colour: "teal", pattern: "spots" };

export const valid = (k, v) => !!OPTIONS[k] && OPTIONS[k].some(o => o.id === v && !o.stub);
/* any input -> a complete, valid state (unknown keys dropped, bad values -> default) */
export function normalise(s) {
  const out = { ...DEFAULT };
  if (s && typeof s === "object") for (const k of Object.keys(DEFAULT)) if (valid(k, s[k])) out[k] = s[k];
  return out;
}
export function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { s = null; }
  return normalise(s);
}
export function save(s) { try { localStorage.setItem(KEY, JSON.stringify(normalise(s))); } catch (e) { /* private mode: keep it for the session */ } }

/* freckles: small clusters on both cheeks, as directions from the body's centre in its own
   (ellipsoid-normalised) bind space; the eye is front (-z), x +-0.22, y 0.5..0.94 */
export const FRECKLE_C = [0, 0.61, -0.015], FRECKLE_R = [0.38, 0.46, 0.315];
export function freckleDirs() {
  const out = [];
  const cheek = [[0, 0], [0.075, 0.03], [0.03, -0.07], [-0.06, -0.035], [0.1, -0.06]];
  for (const side of [-1, 1]) for (const [du, dv] of cheek) {
    const p = [side * (0.27 + du * 0.9), 0.47 + dv, -0.24];
    const d = p.map((v, i) => (v - FRECKLE_C[i]) / FRECKLE_R[i]), l = Math.hypot(...d);
    out.push(d.map(v => v / l));
  }
  return out;   // 10 unit vectors
}

/* ---- per-figure setup (once) ---- */
function setup(figure) {
  if (figure.userData.custom) return figure.userData.custom;
  const get = n => figure.getObjectByName(n);
  const body = get("Blip_1"), dark = get("Blip_2"), coral = get("Blip_5"), yellow = get("Blip_6"), sparkle = get("Blip_7");
  const C = { body, dark, sprouts: [coral, yellow], antennas: {}, sparkle };
  // own materials (the toonified ones are cached and shared by material name)
  body.material = body.material.clone(); dark.material = dark.material.clone();
  const U = { patMode: { value: 0 }, patColor: { value: new THREE.Color("#2E8C88") },
    frk: { value: freckleDirs().map(d => new THREE.Vector3(...d)) } };
  C.U = U;
  body.material.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vPatP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPatP = position;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vPatP;\nuniform int patMode;\nuniform vec3 patColor;\nuniform vec3 frk[10];")
      .replace("#include <color_fragment>", `#include <color_fragment>
        if (patMode == 1) {
          // three soft-edged bands round the lower body, kept below the eye line
          float y = vPatP.y * 9.0;
          float f = abs(fract(y) - 0.5);
          float w = fwidth(y) * 0.75;
          float band = 1.0 - smoothstep(0.22 - w, 0.22 + w, f);
          band *= 1.0 - smoothstep(0.50, 0.54, vPatP.y);
          band *= smoothstep(0.17, 0.21, vPatP.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, patColor, band);
        } else if (patMode == 2) {
          // freckles: round dots at fixed directions (cheeks), anti-aliased
          vec3 d = normalize((vPatP - vec3(${FRECKLE_C.join(", ")})) / vec3(${FRECKLE_R.join(", ")}));
          float m = 0.0;
          for (int i = 0; i < 10; i++) {
            float a = 1.0 - dot(d, frk[i]);
            float w = fwidth(a);
            m = max(m, 1.0 - smoothstep(0.0011 - w, 0.0011 + w, a));
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, patColor, m);
        }`);
  };
  body.material.customProgramCacheKey = () => "blip-body-pattern-2";
  // spots on/off: an index without the sparkle's body-bone triangles (the eye glint stays)
  const g = sparkle.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const eyeBone = sparkle.skeleton.bones.findIndex(b => b.name === "eye");
  const onEye = i => { let best = 0, bi = 0; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > best) { best = w; bi = si.getComponent(i, k); } } return bi === eyeBone; };
  const idx = g.index.array, keep = [];
  for (let t = 0; t < idx.length; t += 3) if (onEye(idx[t]) && onEye(idx[t + 1]) && onEye(idx[t + 2])) keep.push(idx[t], idx[t + 1], idx[t + 2]);
  C.sparkleFull = g;
  C.sparkleEye = g.clone(); C.sparkleEye.setIndex(keep);
  figure.userData.custom = C;
  return C;
}

/* skin a set of antenna parts (built in the sprouts' bind space, crown at y ~1.0) onto the sprout
   bones: weights blend the A and B chains, base -> tip, so they bob with them. Each part is inked;
   its hull is a SkinnedMesh on the same skeleton (toon.js outline()). */
function skinParts(C, parts) {
  const ref = C.sprouts[0], sk = ref.skeleton, bi = n => sk.bones.findIndex(b => b.name === n);
  const A1 = bi("sproutA1"), A2 = bi("sproutA2"), B1 = bi("sproutB1"), B2 = bi("sproutB2");
  const weigh = geo => {
    const p = geo.attributes.position, n = p.count, idx = new Uint16Array(n * 4), w = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const k = THREE.MathUtils.clamp((p.getY(i) - 1.03) / 0.14, 0, 1);   // A1/B1 at the crown, A2/B2 above
      idx.set([A1, B1, A2, B2], i * 4);
      w.set([(1 - k) * 0.5, (1 - k) * 0.5, k * 0.5, k * 0.5], i * 4);
    }
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(idx, 4));
    geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(w, 4));
    return geo;
  };
  const out = parts.map(([geo, mat, name]) => {
    const m = new THREE.SkinnedMesh(weigh(geo), mat);
    m.name = name; m.castShadow = true; m.frustumCulled = false;
    m.position.copy(ref.position); m.quaternion.copy(ref.quaternion); m.scale.copy(ref.scale);
    ref.parent.add(m);
    m.bind(sk, ref.bindMatrix);
    return m;
  });
  for (const m of out) outline(m.parent, "#1E1F26", o => o === m);
  return out;
}

/* the curly spring: a helix tube from the crown with a coral ball on top */
function buildSpring(C) {
  const y0 = 0.98, y1 = 1.36, turns = 3.25, R = 0.075;
  class Helix extends THREE.Curve {
    getPoint(t, out = new THREE.Vector3()) {
      const a = t * turns * Math.PI * 2, rr = R * (1 - 0.25 * t);
      const lead = Math.min(1, t * 8);   // the first bit rises straight out of the crown
      return out.set(Math.cos(a) * rr * lead, y0 + (y1 - y0) * t, Math.sin(a) * rr * lead);
    }
  }
  const coil = new THREE.TubeGeometry(new Helix(), 120, 0.03, 10, false);
  const top = new Helix().getPoint(1);
  const ball = new THREE.SphereGeometry(0.085, 20, 14); ball.translate(top.x, top.y + 0.07, top.z);
  return skinParts(C, [[coil, C.sprouts[1].material, "Blip_spring_coil"], [ball, C.sprouts[0].material, "Blip_spring_ball"]]);
}

/* the bulb: one gently bent stalk in the limb colour with a yellow bulb on top */
function buildBulb(C) {
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.97, 0), new THREE.Vector3(-0.035, 1.16, 0.01), new THREE.Vector3(0.025, 1.3, 0));
  const stalk = new THREE.TubeGeometry(curve, 40, 0.027, 10, false);
  const bulb = new THREE.SphereGeometry(0.1, 22, 16); bulb.translate(0.03, 1.38, 0);
  return skinParts(C, [[stalk, C.dark.material, "Blip_bulb_stalk"], [bulb, C.sprouts[1].material, "Blip_bulb_bulb"]]);
}

/* the leaf sprout: a little seedling, a green stalk and two leaves opening to the sides */
function buildLeaf(C) {
  const green = C.sprouts[1].material.clone(); green.color.set("#6FB35A");
  const stem = green.clone(); stem.color.set("#4E9446");
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.97, 0), new THREE.Vector3(0.02, 1.1, 0), new THREE.Vector3(0, 1.22, 0));
  const stalk = new THREE.TubeGeometry(curve, 30, 0.022, 8, false);
  const leaf = side => {
    const g = new THREE.SphereGeometry(1, 20, 10);
    g.scale(0.14, 0.026, 0.075); g.translate(0.135, 0, 0);                 // base at the origin, tip along +x
    g.rotateZ(0.5); g.rotateY(side < 0 ? Math.PI : 0); g.rotateY(0.25);   // tilted up, a slight twist
    g.translate(0, 1.21, 0);
    return g;
  };
  const tip = new THREE.SphereGeometry(0.03, 12, 8); tip.translate(0, 1.22, 0);   // the bud between the leaves
  return skinParts(C, [[stalk, stem, "Blip_leaf_stalk"], [leaf(1), green, "Blip_leaf_L"], [leaf(-1), green, "Blip_leaf_R"], [tip, stem, "Blip_leaf_bud"]]);
}
const BUILD = { bulb: buildBulb, spring: buildSpring, leaf: buildLeaf };

function show(m, on) { m.visible = on; if (m.userData.hull) m.userData.hull.visible = on; }

export function apply(figure, st) {
  if (!figure || !figure.getObjectByName("Blip_1")) return;
  const s = normalise(st);
  const C = setup(figure);
  // antenna
  if (BUILD[s.antenna] && !C.antennas[s.antenna]) C.antennas[s.antenna] = BUILD[s.antenna](C);
  for (const m of C.sprouts) show(m, s.antenna === "sprouts");
  for (const [id, parts] of Object.entries(C.antennas)) for (const m of parts) show(m, s.antenna === id);
  // colour
  const col = OPTIONS.colour.find(o => o.id === s.colour);
  C.body.material.color.set(col.body); C.dark.material.color.set(col.dark);
  // pattern
  C.sparkle.geometry = s.pattern === "spots" ? C.sparkleFull : C.sparkleEye;
  C.U.patMode.value = s.pattern === "stripes" ? 1 : s.pattern === "freckles" ? 2 : 0;
  C.U.patColor.value.set(s.pattern === "freckles" ? col.deep : col.dark);
}
