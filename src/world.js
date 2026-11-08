import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { ISLANDS } from "./projects.js?v=20261108-2229";

/* Loads the GLBs (shared assets and the planet first, then the moon) and collects the
   named nodes the runtime is built on (the anchor prefixes in ingest()) into world.anchors. */

export class World {
  constructor(scene) {
    this.scene = scene;
    this.anchors = {};
    this.islands = {};
    this.pickables = [];          // meshes a tap can land on
    this.shared = null;
    const draco = new DRACOLoader().setDecoderPath("vendor/three/addons/libs/draco/gltf/");
    this.loader = new GLTFLoader().setDRACOLoader(draco);
  }

  loadCharacter() {
    const tryLoad = f => new Promise(res => this.loader.load(f, res, undefined, () => res(null)));
    return tryLoad("assets/models/toy.glb").then(g => g || tryLoad("assets/models/character.glb"));
  }

  async loadEager(progress) {
    const eager = ISLANDS.filter(i => i.eager);
    const share = new Array(eager.length).fill(0);
    await Promise.all(eager.map((isl, k) => this.load(isl.id, e => {
      if (e.lengthComputable) share[k] = e.loaded / e.total;
      progress(share.reduce((a, b) => a + b, 0) / eager.length);
    })));
  }

  load(id, onProgress) {
    if (this.islands[id]) return this.islands[id].promise;
    const isl = ISLANDS.find(i => i.id === id);
    const st = { root: null, state: "loading" };
    st.promise = new Promise((resolve, reject) => {
      this.loader.load(isl.file, gltf => {
        st.root = gltf.scene; st.root.name = id;
        this.ingest(id, gltf.scene);
        st.state = "ready";
        resolve(st.root);
      }, onProgress, err => { st.state = "error"; console.error("island failed", id, err); reject(err); });
    });
    this.islands[id] = st;
    return st.promise;
  }

  ingest(id, root) {
    root.updateMatrixWorld(true);
    root.traverse(o => {
      if (o.isMesh) {
        o.castShadow = !/studs|rods/i.test(o.name);
        o.receiveShadow = true;
        if (id !== "shared-assets") this.pickables.push(o);
      }
      if (/^(GAME_|PINS_anchor|SPAWN|KIOSK_|CANNON_|PLATEAU_|COL_|BODY_|MAP|LAND_|SECRET_|MECH_|HUB_slab|HUB_signal|PLAY_|CAST_|MOUTH_|FUSE_|TRIGGER_|POND_|BENCHSPOT_|CAVE_|STUDIO_name|MOONTRAMP_|MOONSTAR_)/.test(o.name)) this.anchors[o.name] = o;
    });
    if (id === "shared-assets") { this.shared = root; return; }
    this.scene.add(root);
  }
}
