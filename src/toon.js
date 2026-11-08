import * as THREE from "three";

/* Cel shading: every Standard material becomes a MeshToonMaterial on a 3-band ramp,
   and selected meshes get an inverted-hull ink outline of one screen-space width (works on
   skinned and instanced meshes too: the hull shares the skeleton and is offset after skinning). */

let ramp;
function gradient() {
  if (ramp) return ramp;
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  ramp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}

let ramp2;
function gradient2() {
  if (ramp2) return ramp2;
  ramp2 = new THREE.DataTexture(new Uint8Array([140, 140, 140, 255, 255, 255, 255, 255]), 2, 1, THREE.RGBAFormat);
  ramp2.minFilter = ramp2.magFilter = THREE.NearestFilter;
  ramp2.needsUpdate = true;
  return ramp2;
}
/* two-tone cel (lit + shade, one hard edge) for the toonified meshes `test` picks: their materials are copied onto a
   2-band ramp, and they receive no shadows, so a neighbour's shadow never adds a third tone */
export function twoTone(root, test) {
  const copies = new Map();
  root.traverse(o => {
    if (!o.isMesh || o.userData.isOutline || !test(o)) return;
    const conv = m => {
      if (!m || !m.isMeshToonMaterial) return m;
      if (!copies.has(m)) { const c = m.clone(); c.color = m.color; c.gradientMap = gradient2(); copies.set(m, c); }
      return copies.get(m);
    };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
    o.receiveShadow = false;
  });
}
/* two-tone cel for the creatures: every colour is lit or shaded, nothing else. The sun (the first directional light)
   alone picks the side, one hard edge at N.L = 0; the hemisphere and the fill light add the same constant everywhere
   (their average), so they cannot add a soft ramp or a third band, and no shadows are received. Pale parts (eye
   whites, teeth, glints) take a lighter shade so they stay white. */
export function twoToneSun(root, test = () => true) {
  const copies = new Map();
  root.traverse(o => {
    if (!o.isMesh || o.userData.isOutline || !test(o)) return;
    const conv = m => {
      if (!m || !m.isMeshToonMaterial) return m;
      if (!copies.has(m)) {
        const c = m.clone(); c.color = m.color; c.name = m.name;
        const shade = /Sclera|Tooth|Molar|Glint/i.test(m.name) ? "0.82" : "0.55";
        c.onBeforeCompile = s => {
          s.fragmentShader = s.fragmentShader.replace("#include <opaque_fragment>", `
#if NUM_DIR_LIGHTS > 0
  vec3 ttAmb = ambientLightColor;
  #if NUM_HEMI_LIGHTS > 0
  for (int i = 0; i < NUM_HEMI_LIGHTS; i++) ttAmb += 0.5 * (hemisphereLights[i].skyColor + hemisphereLights[i].groundColor);
  #endif
  #if NUM_DIR_LIGHTS > 1
  for (int i = 1; i < NUM_DIR_LIGHTS; i++) ttAmb += 0.5 * directionalLights[i].color;
  #endif
  float ttLit = step(0.0, dot(normal, directionalLights[0].direction));
  outgoingLight = (ttAmb + directionalLights[0].color * mix(${shade}, 1.0, ttLit)) * BRDF_Lambert(diffuseColor.rgb) + totalEmissiveRadiance;
#endif
#include <opaque_fragment>`);
        };
        c.customProgramCacheKey = () => "twoToneSun" + shade;
        copies.set(m, c);
      }
      return copies.get(m);
    };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
    o.receiveShadow = false;
  });
}

const cache = new Map();
export function toonify(root, { keep = () => false } = {}) {
  root.traverse(o => {
    if (!o.isMesh || keep(o)) return;
    const conv = m => {
      if (!m || m.isMeshToonMaterial || m.isShaderMaterial || m.isMeshBasicMaterial || m.transparent || !m.isMeshStandardMaterial) return m;
      if (cache.has(m)) return cache.get(m);
      const t = new THREE.MeshToonMaterial({
        color: m.color, map: m.map || null, vertexColors: m.vertexColors,
        // glTF exports everything double-sided; the meshes are closed, and DoubleSide puts
        // front faces into the shadow map (acne that otherwise needs huge biases)
        gradientMap: gradient(), transparent: m.transparent, opacity: m.opacity, side: THREE.FrontSide,
      });
      t.name = m.name;
      t.color = m.color;   // share the Color so code that tints the original keeps working
      // metals keep a little sheen through emissive tint so aluminium doesn't go flat grey
      if (m.metalness > 0.5) t.color = m.color.clone().multiplyScalar(1.15);   // (metals: own copy, brightened)
      cache.set(m, t);
      return t;
    };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
}

/* ---- ink: one screen-space line width for every cel object ------------------------------
   A hull pushed out a fixed number of metres reads at a different width on every object and thins
   to nothing far away. So the hull is the mesh itself, drawn back-faces-only, and each
   vertex is moved INK_PX CSS pixels outward on screen: the view-space (smoothed) normal is
   projected to a screen direction and clip.xy is offset by INK_PX * 2/res * clip.w, so the step
   is the same number of pixels at any depth. inkU.res holds the drawing-buffer size and pixel
   ratio (inkResize(renderer), called every frame by main), so DPR 1, 2 or a resize keep the
   width. Two caps: far away a fixed pixel width would swallow a 3 px tree, so the step is held
   to INK_MAX_M metres (reached ~30 m out at 13 m camera); and a vertex behind the camera
   (clip.w <= 0) is left alone instead of being flipped across the screen. */
export const INK_PX = 2.25;           // CSS px: a 0.045 m world-space hull at the 13 m camera
const INK_MAX_M = 0.07;        // m: far-field cap on the outward step
/* far fade: a constant 2.25 px line on a tree half the size read twice as
   heavy at 25 m as at 11 m. Past INK_FADE_M[0] metres of view depth the width eases down to
   INK_FAR_K of INK_PX by INK_FADE_M[1]; the 13 m camera's near and mid ground keeps the full width.
   Only the capped prop inks fade (maxM < 0.5): the planet/moon rim and clouds keep their width. */
const INK_FADE_M = [15, 32];
const INK_FAR_K = 0.6;
export const RIM_INK_PX = 3.5;        // planet + moon silhouette: the one bolder line (sells the toy-globe edge)
export const inkU = { res: { value: new THREE.Vector3(1280, 800, 1) } };
const _buf = new THREE.Vector2();
export function inkResize(renderer) {
  renderer.getDrawingBufferSize(_buf);
  inkU.res.value.set(_buf.x, _buf.y, renderer.getPixelRatio());
}
const inkMats = new Map();
/* color; px: line width in CSS px; maxM: far cap (m); back: metres to slide the hull away from the
   camera along the view ray (same screen position, but always behind every front face of the
   object, so overlapping parts get no inner seam: the line shows only against what lies beyond) */
/* minM (metres, default 0 = off): a near-field floor on the step. A constant 2.25 px line is right
   for Blip at the 13 m camera, but on a 1.7 m tour member or creature walked up to at 2-4 m it is
   ~1% of a 600 px figure, dark on dark hair/skin, and reads as no ink at all. With minM the line is
   never thinner than minM metres, so it grows on approach like a world-space hull and is untouched
   at mid/far range. */
export function inkMaterial(color = "#1E1F26", { px = INK_PX, maxM = INK_MAX_M, back = 0, flat = false, fade = maxM < 0.5, minM = 0 } = {}) {
  const key = `${color}|${px}|${maxM}|${back}|${flat}|${fade}|${minM}`;
  if (inkMats.has(key)) return inkMats.get(key);
  // flat: a single-sided card (butterfly wing) has no back faces to show, so its hull is drawn
  // from both sides, a hair behind the card in depth (polygon offset), its oNormal the in-plane
  // outward direction (see outline's flat note)
  const m = new THREE.MeshBasicMaterial({ color, side: flat ? THREE.DoubleSide : THREE.BackSide });
  if (flat) { m.polygonOffset = true; m.polygonOffsetFactor = 2; m.polygonOffsetUnits = 8; }
  m.onBeforeCompile = sh => {
    sh.uniforms.inkRes = inkU.res;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 oNormal;\nuniform vec3 inkRes;")
      // after three's own skinning/instancing/projection (so skinned hulls follow their bones)
      .replace("#include <project_vertex>", `#include <project_vertex>
        {
          vec3 inkN = oNormal;
          #ifdef USE_SKINNING
            inkN = (skinMatrix * vec4(inkN, 0.0)).xyz;
          #endif
          #ifdef USE_INSTANCING
            inkN = mat3(instanceMatrix) * inkN;
          #endif
          vec3 vn = normalize(normalMatrix * inkN);
          ${back > 0 ? `mvPosition.xyz += normalize(mvPosition.xyz) * ${back.toFixed(3)}; gl_Position = projectionMatrix * mvPosition;` : ""}
          if (gl_Position.w > 0.0) {
            // screen direction of the normal, in device pixels
            vec2 d = (projectionMatrix * vec4(vn, 0.0)).xy * inkRes.xy;
            float l = length(d);
            if (l > 1e-6) {
              float px = ${px.toFixed(3)} * inkRes.z;
              // metres one step covers at this depth (perspective: grows with w; ortho: w = 1)
              float m = px * 2.0 * gl_Position.w / (inkRes.y * projectionMatrix[1][1]);
              px *= min(1.0, ${maxM.toFixed(4)} / m);
              ${fade ? `px *= mix(1.0, ${INK_FAR_K.toFixed(3)}, smoothstep(${INK_FADE_M[0].toFixed(1)}, ${INK_FADE_M[1].toFixed(1)}, gl_Position.w));` : ""}
              ${minM > 0 ? `px = max(px, ${minM.toFixed(4)} * inkRes.y * projectionMatrix[1][1] / (2.0 * gl_Position.w));` : ""}
              gl_Position.xy += d / l * px * 2.0 / inkRes.xy * gl_Position.w;
            }
          }
        }`);
  };
  m.customProgramCacheKey = () => "ink|" + key;
  inkMats.set(key, m);
  return m;
}

/* Ink every mesh under root that passes include(). Hulls share the mesh's geometry (and skeleton
   / instance matrices) and copy its local transform, so anything that animates must move a parent
   group, pass { child: true }, or call inkFollow. Other opts go to inkMaterial: { px, maxM, back, flat, fade, minM }. */
export function outline(root, color = "#1E1F26", include = () => true, opts = {}) {
  const meshes = [];
  // (child hulls may start on an empty geometry: the brand mark is extruded on its first spring)
  root.traverse(o => { if (o.isMesh && !o.userData.isOutline && (o.geometry.attributes.normal || opts.child) && include(o)) meshes.push(o); });
  const hulls = [];
  for (const o of meshes) {
    smoothNormals(o.geometry);
    const mat = inkMaterial(color, opts);
    let hull;
    if (o.isSkinnedMesh) { hull = new THREE.SkinnedMesh(o.geometry, mat); hull.bind(o.skeleton, o.bindMatrix); }
    else if (o.isInstancedMesh) { hull = new THREE.InstancedMesh(o.geometry, mat, o.count); hull.instanceMatrix = o.instanceMatrix; }
    else hull = new THREE.Mesh(o.geometry, mat);
    hull.userData.isOutline = true;
    hull.castShadow = false; hull.receiveShadow = false;   // never in the sun's shadow pass
    // same geometry, same bound: the 2 px step can only clip at the very screen edge
    hull.frustumCulled = o.frustumCulled;
    if (o.boundingSphere) hull.boundingSphere = o.boundingSphere;   // skinned/instanced: share any padded bound
    hull.raycast = () => {};
    hull.renderOrder = o.renderOrder;
    hull.name = o.name + "_outline";
    // child: the hull rides inside the mesh (identity transform), for meshes animated directly
    if (opts.child) {
      o.add(hull);
      // and follows a geometry swap (the brand mark is re-extruded every frame mid-spring); the
      // check runs in the renderer's matrix pass, before the frame's draw list is built
      hull.updateMatrixWorld = function (force) {
        if (this.geometry !== o.geometry) { smoothNormals(o.geometry); this.geometry = o.geometry; }
        THREE.Object3D.prototype.updateMatrixWorld.call(this, force);
      };
    }
    else { hull.position.copy(o.position); hull.quaternion.copy(o.quaternion); hull.scale.copy(o.scale); hull.visible = o.visible; o.parent.add(hull); }
    o.userData.hull = hull;
    hulls.push(hull);
  }
  return hulls;
}
/* a mesh whose geometry is replaced (the brand mark is re-extruded every frame mid-spring) or that
   moves on its own: give its hull the new geometry and pose */
export function inkFollow(o) {
  const h = o.userData.hull; if (!h) return;
  if (h.geometry !== o.geometry) { smoothNormals(o.geometry); h.geometry = o.geometry; }
  h.position.copy(o.position); h.quaternion.copy(o.quaternion); h.scale.copy(o.scale); h.visible = o.visible;
}
/* an ink-only shell from a stand-in geometry (the vending door's hole-free slab) */
export function inkShell(geometry, color = "#1E1F26", opts = {}) {
  smoothNormals(geometry);
  const h = new THREE.Mesh(geometry, inkMaterial(color, opts));
  h.userData.isOutline = true; h.castShadow = h.receiveShadow = false; h.raycast = () => {};
  return h;
}

/* Hulls pushed along split (hard-edge) normals tear open at corners. Average the normals
   of every vertex sharing a position into `oNormal` and push along that instead. */
function smoothNormals(g) {
  if (g.attributes.oNormal || !g.attributes.position || !g.attributes.normal) return;
  const pos = g.attributes.position, nor = g.attributes.normal, n = pos.count;
  const acc = new Map(), keys = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    keys[i] = k;
    const a = acc.get(k) || [0, 0, 0];
    a[0] += nor.getX(i); a[1] += nor.getY(i); a[2] += nor.getZ(i);
    acc.set(k, a);
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = acc.get(keys[i]), l = Math.hypot(a[0], a[1], a[2]) || 1;
    out[i * 3] = a[0] / l; out[i * 3 + 1] = a[1] / l; out[i * 3 + 2] = a[2] / l;
  }
  g.setAttribute("oNormal", new THREE.BufferAttribute(out, 3));
}
