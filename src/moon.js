import * as THREE from "three";

/* The moon's ground surface. Two things would make it read as dirty:
   1. the baked per-VERTEX colour (dark lilac "maria" painted in Blender) interpolated over a 4.5k-vertex mesh gives
      soft, smeared, staircase-edged patches;
   2. the toon cel band edge (terminator) follows the mesh's interpolated normals, so it runs along triangle facets.
   So, as the planet's ground does (paintGround in main.js): the vertex colours give way to the mesh's median colour,
   and the surface is lit with the true sphere normal per pixel. The shadow setup is untouched. */
export function cleanMoon(mesh) {
  if (!mesh || !mesh.isMesh) return null;
  const g = mesh.geometry, col = g.attributes.color, mat = mesh.material.clone();
  if (col) {   // median per channel: the dominant surface colour, not an average pulled toward the patches
    const n = col.count, ch = [[], [], []];
    for (let i = 0; i < n; i++) { ch[0].push(col.getX(i)); ch[1].push(col.getY(i)); ch[2].push(col.getZ(i)); }
    const med = a => a.sort((x, y) => x - y)[a.length >> 1];
    mat.color.setRGB(med(ch[0]), med(ch[1]), med(ch[2]), THREE.LinearSRGBColorSpace);
  }
  mat.vertexColors = false;
  g.computeBoundingSphere();
  const centre = g.boundingSphere.center.clone();   // the mesh is not modelled about its own origin
  mat.onBeforeCompile = sh => {
    sh.uniforms.uMoonC = { value: centre };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vDirM; uniform vec3 uMoonC;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvDirM = normalize(mat3(modelMatrix) * (position - uMoonC));");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vDirM;")
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(normalize(vDirM), 0.0)).xyz);");
  };
  mat.customProgramCacheKey = () => "moon-clean";
  mesh.material = mat;
  return mat;
}
