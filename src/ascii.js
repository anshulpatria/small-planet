import * as THREE from "three";

/* Secret: "Underneath, it was always lines." For a few seconds the whole world is
   re-rendered through the homepage's own ASCII ramp ( .:-=+*#%@), ink on paper. */

const RAMP = " .:-=+*#%@";

export class AsciiPass {
  constructor(renderer) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    const cw = 32, ch = 48;
    const cv = document.createElement("canvas"); cv.width = cw * RAMP.length; cv.height = ch;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, cv.width, ch);
    ctx.fillStyle = "#fff"; ctx.font = `600 ${ch * 0.8}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    [...RAMP].forEach((c, i) => ctx.fillText(c, i * cw + cw / 2, ch / 2 + 2));
    const atlas = new THREE.CanvasTexture(cv);
    atlas.minFilter = THREE.LinearFilter;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: this.rt.texture }, tAtlas: { value: atlas }, uRes: { value: new THREE.Vector2() }, uCell: { value: 10 }, uMix: { value: 0 } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: `uniform sampler2D tScene, tAtlas; uniform vec2 uRes; uniform float uCell, uMix; varying vec2 vUv;
        void main(){
          vec2 px = vUv * uRes; vec2 cell = vec2(uCell, uCell * 1.5);
          vec2 c0 = floor(px / cell) * cell;
          vec3 src = texture2D(tScene, vUv).rgb;
          #ifdef TONE_MAPPING
          src = toneMapping(src);
          #endif
          vec3 s = texture2D(tScene, (c0 + cell * 0.5) / uRes).rgb;
          float l = 1.0 - clamp(dot(s, vec3(0.2126, 0.7152, 0.0722)) * 1.25, 0.0, 1.0);
          float idx = floor(l * 9.99);
          vec2 f = (px - c0) / cell;
          float g = texture2D(tAtlas, vec2((idx + f.x) / 10.0, 1.0 - f.y)).r;
          vec3 paper = vec3(0.776, 0.784, 0.745), ink = vec3(0.008, 0.009, 0.011), sig = vec3(0.024, 0.024, 0.85);
          bool blue = s.b > s.r * 1.6 && s.b > 0.08;
          vec3 asc = mix(paper, blue ? sig : ink, g);
          gl_FragColor = vec4(mix(src, asc, uMix), 1.0);
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.qscene = new THREE.Scene(); this.qscene.add(this.quad);
    this.qcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mix = 0; this.until = 0; this.hold = false; this.overlayLayer = null;   // hold: sustained by an act (moonwalk.js), cleared by it; the secret only uses trigger()
  }
  trigger(seconds = 14) { this.until = performance.now() / 1000 + seconds; }
  get active() { return this.mix > 0.001 || performance.now() / 1000 < this.until || this.hold; }
  render(scene, camera, dt) {
    const now = performance.now() / 1000;
    this.mix = THREE.MathUtils.damp(this.mix, now < this.until || this.hold ? 1 : 0, 3, dt);
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    if (this.rt.width !== size.x || this.rt.height !== size.y) this.rt.setSize(size.x, size.y);
    this.mat.uniforms.uRes.value.copy(size);
    this.mat.uniforms.uCell.value = Math.max(7, Math.round(size.x / 160));
    this.mat.uniforms.uMix.value = this.mix;
    r.setRenderTarget(this.rt); r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.qscene, this.qcam);
    if (this.overlayLayer != null) {   // objects on this layer are drawn crisp over the ASCII composite (moonwalk.js letters); the secret never sets it
      const m = camera.layers.mask, ac = r.autoClear, bg = scene.background;
      camera.layers.set(this.overlayLayer); r.autoClear = false; scene.background = null; r.clearDepth(); r.render(scene, camera);
      camera.layers.mask = m; r.autoClear = ac; scene.background = bg;
    }
  }
}
