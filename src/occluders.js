import * as THREE from "three";

/* Camera-occluder proxies.
   The pin-art screen is one InstancedMesh whose pins slide out in the vertex shader, so it cannot be a camera
   occluder itself (a ray would test thousands of instances and the shader offsets are invisible to it). The
   backplate and frame ARE occluders, though, and alone they would stop the lens 0.5 m in front of the backplate:
   right inside the pin tips. This keeps ONE invisible box over the whole pin volume in rig.occluders, rebuilt
   whenever the pin mesh is replaced, never cached as a stale array.
   The box is never added to the scene, so it costs nothing to draw; FrontSide only, so a ray that starts inside
   it (Blip walking right up to the pins) does not pin the lens to the minimum distance. */
const PIN_PAD = { front: 1.9, back: 0.3, side: 0.4 };   // metres past the mesh's own bounds (front = the pins' travel, 1.65 m, plus a lens margin)

/* pure: the proxy's local box from the pin mesh's instance bounds (local +z is the pins' travel direction) */
function proxyBox(bb, pad = PIN_PAD) {
  return new THREE.Box3(
    new THREE.Vector3(bb.min.x - pad.side, bb.min.y - pad.side, bb.min.z - pad.back),
    new THREE.Vector3(bb.max.x + pad.side, bb.max.y + pad.side, bb.max.z + pad.front));
}

const fp = m => { const e = m.matrixWorld.elements; return m.uuid + m.count + "|" + e[12].toFixed(2) + e[13].toFixed(2) + e[14].toFixed(2) + e[0].toFixed(3) + e[2].toFixed(3); };

export function createPinOccluder({ scene, rig, getPins }) {
  let mesh = null, key = "", proxy = null, probeT = 0;
  const mat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.FrontSide });
  const drop = () => { if (proxy) { const i = rig.occluders ? rig.occluders.indexOf(proxy) : -1; if (i >= 0) rig.occluders.splice(i, 1); } proxy = null; key = ""; };
  const ensureListed = () => { if (proxy && rig.occluders && !rig.occluders.includes(proxy)) rig.occluders.push(proxy); };
  function build(m) {
    if (!m.boundingBox) m.computeBoundingBox();
    m.updateWorldMatrix(true, false);
    const b = proxyBox(m.boundingBox), size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    const old = proxy; drop();
    proxy = old || new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    if (!old) proxy.name = "PINS_proxy";
    proxy.geometry.dispose(); proxy.geometry = new THREE.BoxGeometry(size.x, size.y, size.z).translate(c.x, c.y, c.z);
    proxy.matrixAutoUpdate = false; proxy.matrix.copy(m.matrixWorld); proxy.matrixWorld.copy(m.matrixWorld); proxy.userData.isOutline = false;
    proxy.geometry.computeBoundingBox(); proxy.geometry.computeBoundingSphere();
    key = fp(m);
    ensureListed();
  }
  return {
    get proxy() { return proxy; },
    /* call once a frame: a few property reads while nothing changed */
    update(dt = 0.016) {
      let m = getPins && getPins();
      m = m && m.mesh ? m.mesh : m;
      if (!m || !m.isInstancedMesh) {   // pinscreen replaced or mounted late: look it up by name about once a second
        probeT -= dt;
        if (probeT <= 0) { probeT = 1; m = scene.getObjectByName("pinart-pins"); if (m && !m.isInstancedMesh) m = null; }
        else m = mesh;
      }
      if (!m) { mesh = null; drop(); return; }
      mesh = m;
      if (key !== fp(m)) build(m);
      else ensureListed();
    },
  };
}
