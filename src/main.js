import * as THREE from "three";
import { PROJECTS, byId, GAMES } from "./projects.js?v=20261110-0921";
import { installTracking, track as stat } from "./track.js?v=20261110-0921";
installTracking();   // anonymous visitor stats; off until UMAMI_ID is set in track.js
import { createSky } from "./sky.js?v=20261110-0921";
import { World } from "./world.js?v=20261110-0921";
import { Body } from "./planet.js?v=20261110-0921";
import { Input } from "./input.js?v=20261110-0921";
import { createOccFade } from "./occfade.js?v=20261110-0921";
import { Player, SIT } from "./player.js?v=20261110-0921";
import { CameraRig } from "./camera.js?v=20261110-0921";
import { AsciiPass } from "./ascii.js?v=20261110-0921";
import { toonify, twoTone, twoToneSun, outline, inkResize, RIM_INK_PX, inkShell } from "./toon.js?v=20261110-0921";
import { setupMoonFlag } from "./moonflag.js?v=20261110-0921";
import { moonwalkInstall, moonwalkUpdate } from "./moonwalk.js?v=20261110-0921";
import { createBoardMap } from "./boardmap.js?v=20261110-0921";
/* cast + fauna ink: same 2.25 px as everything at range, never thinner than 13 mm up close */
const CHAR_INK = { minM: 0.008 };
// the creatures: a thinner line, held 9 cm back in depth, so close parts (eyes, lips, arms on the body) don't ink into one blob
const FAUNA_INK = { ...CHAR_INK, px: 1.6, back: 0.09 };
import { computeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
import { UI } from "./ui.js?v=20261110-0921";
import { FX } from "./fx.js?v=20261110-0921";
import { makeSignpost, fontsReady } from "./signs.js?v=20261110-0921";
import { cleanMoon } from "./moon.js?v=20261110-0921";
import { Birds, Butterflies, waterMaterial } from "./life.js?v=20261110-0921";
import { PondWater } from "./water.js?v=20261110-0921";
import { buildReeds } from "./reeds.js?v=20261110-0921";
import { Campfire } from "./fire.js?v=20261110-0921";
import { Grass, GROUND_GLSL, groundUniforms, groundFields } from "./grass.js?v=20261110-0921";
import { FieldFloor, FIELD_EFFECTS, Vending, MoonPlay, terraceFrame } from "./extras.js?v=20261110-0921";
import { HiveFloor } from "./hive.js?v=20261110-0921";
import { createAmbient } from "./audio.js?v=20261110-0921";
import { createSfx } from "./sfx.js?v=20261110-0921";
import { Booth, makeBooth, STAGE_FADE } from "./booth.js?v=20261110-0921";
import { createPinOccluder } from "./occluders.js?v=20261110-0921";
import { createSeatOrbit } from "./seatorbit.js?v=20261110-0921";
import { createSitButterfly, SITFLY, headPerch } from "./sitfly.js?v=20261110-0921";
import { Slate } from "./slate.js?v=20261110-0921";
import { installSid } from "./sid.js?v=20261110-0921";
import { installAP } from "./ap.js?v=20261110-0921";
import { CONSTELLATION_NAME } from "./copy-r7.js?v=20261110-0921";   // R7 T5
import { installGulp } from "./gulp.js?v=20261110-0921";
import { installChomp } from "./chomp.js?v=20261110-0921";
import { installLumen } from "./lumen.js?v=20261110-0921";
import { installZip } from "./zip.js?v=20261110-0921";
import { installRestart } from "./restart.js?v=20261110-0921";   // R7 T3
import { installNight } from "./night.js?v=20261110-0921";   // R7 T6
import { installRadio } from "./radio.js?v=20261110-0921";   // R7 T7
import { installRewards } from "./rewards.js?v=20261110-0921";   // R7 T8
import { installTrees, dropLobes, clearRoads, roadDistance, ROAD_HALF } from "./trees.js?v=20261110-0921";
import { GreatCircleArc } from "./arc.js?v=20261110-0921";
import { createHelmet, setHelmet, updateHelmet } from "./helmet.js?v=20261110-0921";

/* A tiny planet you can walk all the way around. Four projects are mini-games
   on terraces, four more are screens on little kiosks, and the ninth waits on the
   moon: aim the cannon and it fires you there. */

const $ = id => document.getElementById(id);
window.__spBoot = true;   // index.html's inline fallback checks this: the module ran (import maps and modules are supported)
const ui = new UI();
const isTouch = matchMedia("(pointer: coarse)").matches;
if (isTouch) document.body.classList.add("touch");

/* ambient bed (audio.js). Browsers only allow sound to start inside a user gesture, so the first
   pointerdown or keydown anywhere (the Explore world button included) unlocks it and fades it in;
   it never autoplays. The speaker button mutes; audio.js remembers the choice in localStorage. */
const amb = createAmbient();
const sfx = createSfx(amb);   // sound effects ride the bed's master gain: same mute, same first-gesture rule
ui.sfx = sfx;
ui.sound = amb;   // hover / select / reading hooks (audio.js interaction layer)
function syncSound() {
  const m = amb.muted, b = $("soundBtn");
  b.classList.toggle("is-muted", m); b.setAttribute("aria-pressed", String(m));
  b.setAttribute("aria-label", "Ambient sound");   // one name; the state is aria-pressed (a flipping name on a toggle reads as a double negative)
  b.title = m ? "Sound off · click to unmute" : "Sound on · click to mute";
}
syncSound();
// every activation-type gesture (capture phase) starts audio until the context really runs;
// re-armed when the browser stops it and retried on returning to the tab (audio.js armUnlock)
amb.armUnlock(window);
$("soundBtn").addEventListener("click", () => { amb.start(); amb.toggle(); syncSound(); });
document.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
$("introList").addEventListener("click", () => stat("skip", { at: Math.round(performance.now() / 1000) }));   // anonymous: intro "Skip the walking" taps, seconds since load

function webglOK() { try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; } }
if (!webglOK()) {
  $("intro").classList.add("gone"); document.body.classList.remove("is-loading");
  $("fallbackNote").hidden = false; $("listBack").hidden = true;
  $("mapBtn").hidden = true;
  // nothing below runs, so the controls that need the planet go too (the dock's "Go there", the bulb, the makeover)
  $("goalBtn").hidden = true; $("boothBtn").hidden = true; document.querySelector(".hud-bottom").hidden = true;
  ui.setMode("list");
  throw new Error("WebGL2 unavailable: showing the project list instead.");
}

/* ------------------------------------------------------------ renderer */
const lowPower = isTouch || (navigator.hardwareConcurrency || 8) <= 4;
const canvas = $("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1.5 : 1.75));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.2, 3000);
const slate = new Slate(scene, camera);   // creature dialogue as an in-world slate
const speak = (c, html, ms, o = {}) => slate.say({ name: c.name, html, ms, base: () => c.pos, up: () => c.up, top: c.holder, ...o });
camera.position.set(80, 70, 110);
const sky = createSky(renderer, scene, { shadow: 2048 });   // 60 m box / 2048 = 2.9 cm texels (4096 flickers more while walking)
const world = new World(scene);
const input = new Input(canvas, $("stick"));
const rig = new CameraRig(camera);
const ascii = new AsciiPass(renderer);
const fx = new FX(scene);
fx.camera = camera; fx.sun = sky.sunDir;

/* frame-driven tweens and waits (they advance with the game loop, so cutscenes also run
   correctly under the step() test hook) */
const tweens = [], waits = [];
const tween = (dur, fn) => new Promise(res => tweens.push({ t: 0, dur, fn, res }));
const sleep = sec => new Promise(res => waits.push({ t: sec, res }));
let flowClock = 0;   // seconds of game time (timers), for the creature trick-then-slate log
function runTimers(dt) {
  flowClock += dt;
  for (let i = tweens.length - 1; i >= 0; i--) {
    const w = tweens[i]; w.t += dt; const k = Math.min(1, w.t / w.dur); w.fn(k);
    if (k >= 1) { tweens.splice(i, 1); w.res(); }
  }
  for (let i = waits.length - 1; i >= 0; i--) { waits[i].t -= dt; if (waits[i].t <= 0) { const w = waits.splice(i, 1)[0]; w.res(); } }
}

let player, planet, moon;
const bodies = {};
const games = {};
const spots = [];           // interaction spots: { id, kind, pos, r, body, run() , label }
let state = "loading";      // loading | intro | play | focus | travel
let focused = null;
let autoTarget = null;      // tap-to-walk target { pos, spot }

/* A portrait phone keeps the 48 deg vertical view but would see only ~23 deg across, so you
   steer half blind; tall screens widen it (up to 72 deg, ~37 deg across at 375 x 812). */
const fovFor = aspect => aspect >= 1 ? 48 : Math.min(72, 48 + (1 - aspect) * 45);
function fitCamera() { camera.aspect = innerWidth / innerHeight; camera.fov = fovFor(camera.aspect); camera.updateProjectionMatrix(); }
fitCamera();
addEventListener("resize", () => { fitCamera(); renderer.setSize(innerWidth, innerHeight, false); });
// the stick walks only while you're out walking (not in a mini-game, map or flight)
input.stickZone = () => state === "play" && !focused && !ui.mapOpen && !(player && player.flight) && !seated;
input.onPad = (type, id) => ui.toast(type === "connect" ? `Controller connected · ${/xbox|045e/i.test(id) ? "Xbox" : /dualsense|dualshock|054c|wireless controller/i.test(id) ? "PlayStation" : /pro controller|switch|057e/i.test(id) ? "Switch" : "gamepad"} · left stick walks, right stick looks, A interacts, X jumps, Start is the menu` : "Controller disconnected", 2600);
{ // touch interact button = the E key through the same handlers; lit while the prompt is up (html[data-prompt] from the HUD, else the prompt's own visibility)
  const act = $("actBtn"), pr = $("prompt"), root = document.documentElement;
  const sync = () => { const on = root.dataset.prompt ? root.dataset.prompt === "on" : !pr.hidden; act.classList.toggle("on", on); act.setAttribute("aria-disabled", on ? "false" : "true"); };
  new MutationObserver(sync).observe(pr, { attributes: true, attributeFilter: ["hidden", "class"] });
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-prompt"] }); sync();
  act.addEventListener("pointerdown", e => { e.preventDefault(); input.press("e"); });
  act.addEventListener("click", e => { if (e.detail === 0) input.press("e"); });   // keyboard / assistive-tech activation (a pointer already pressed above)
}
// a lost WebGL context freezes the canvas: say so and fall back to the list (the only honest state left)
canvas.addEventListener("webglcontextlost", e => {
  e.preventDefault();
  ui.toast("The 3D view stopped. Here’s every project, minus the walking.", 4000);
  $("fallbackNote").textContent = "The 3D view stopped. Here’s every project, minus the walking. Reload to try the planet again.";
  $("fallbackNote").hidden = false;
  $("listBack").textContent = "Reload the planet"; $("listBack").dataset.mode = ""; $("listBack").onclick = () => location.reload();
  setMode("list");
});

/* ------------------------------------------------------------ loading */
const notes = ["Inflating planet. Please stand back…", "Convincing Blip to get out of bed…", "Polishing 5,000 pins. Individually. Obviously.", "Checking cannon safety. Found none…"];
let ni = 0;
const noteTimer = setInterval(() => { $("loadnote").textContent = notes[++ni % notes.length]; }, 1400);
const loadbar = document.querySelector(".loadbar");
Promise.all([world.loadEager(p => { $("loadfill").style.width = Math.round(p * 85) + "%"; loadbar.setAttribute("aria-valuenow", String(Math.round(p * 85))); }), world.loadCharacter(), world.load("moon")])
  .then(([, character]) => setup(character))
  .catch(err => {
    console.error(err); clearInterval(noteTimer);
    // the list is the recovery: show it, with the reason, instead of pointing "below" at nothing
    $("loadnote").textContent = "Planet failed to inflate. The projects survived. Here they are, minus the walking.";
    $("enter").hidden = true;
    $("fallbackNote").textContent = "The planet didn’t load. Here’s every project, minus the walking."; $("fallbackNote").hidden = false; $("listBack").hidden = true;
    setMode("list");
  });

const A = n => world.anchors[n];
const wpos = o => o.getWorldPosition(new THREE.Vector3());
const wfwd = o => new THREE.Vector3(0, 0, -1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));

/* The shots are wide banners (3:1 to 5:1) and the kiosk screen is 5:3: stretching one onto
   the other would squash every screen. Trim the banner to at most 2.6:1 around its focus (the side
   its headline sits on), then letterbox it in its own edge colour so nothing is distorted. */
const SCREEN_RADIUS_PX = 76.8;
const SCREEN_ASPECT = 4.0 / 2.4, SHOT_FOCUS = { "genai-after-hours": 0 };
function screenTexture(p) {
  const cv = document.createElement("canvas"); cv.width = 1024; cv.height = Math.round(1024 / SCREEN_ASPECT);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  tex.flipY = false;   // glTF UV convention (v runs down): the default flip shows every screen upside down
  const img = new Image();
  img.onload = () => {
    const g = cv.getContext("2d"), ia = img.width / img.height, ca = Math.min(ia, 2.6);
    const sw = img.height * ca, sx = (SHOT_FOCUS[p.id] ?? 0.5) * (img.width - sw);
    // edge colour: the banner's top row averaged down to one pixel
    const px = document.createElement("canvas"); px.width = px.height = 1;
    const pg = px.getContext("2d"); pg.drawImage(img, sx, 0, sw, 2, 0, 0, 1, 1);
    const [r, gg, b] = pg.getImageData(0, 0, 1, 1).data;
    // round the thumbnail to the kiosk's frame. The slab is a 4.6 x 3.0 m rounded rect (corner 0.6 m, build_planet.py rrect) and the screen
    // sits 0.3 m in from every edge, so the concentric inner radius is 0.6 - 0.3 = 0.3 m = 0.3 / 4.0 of the width = 76.8 px of the 1024 px canvas (256 px/m both ways)
    g.save(); g.beginPath(); g.roundRect(0, 0, cv.width, cv.height, SCREEN_RADIUS_PX); g.clip();
    g.fillStyle = `rgb(${r},${gg},${b})`; g.fillRect(0, 0, cv.width, cv.height);
    const h = cv.width / ca;
    g.drawImage(img, sx, 0, sw, img.height, 0, (cv.height - h) / 2, cv.width, h);
    g.restore();
    tex.needsUpdate = true;
  };
  img.src = p.shot;
  return tex;
}

async function setup(character) {
  const pr = world.islands.planet.root, mr = world.islands.moon.root;
  planet = bodies.planet = new Body("planet", wpos(A("BODY_planet")), A("BODY_planet").userData.r);
  moon = bodies.moon = new Body("moon", wpos(A("BODY_moon")), A("BODY_moon").userData.r);
  sizeMoonCannon(mr); layoutMoon(mr); layoutStair(pr); layoutIgloo(pr); l7InstallKiosk(pr); layoutMapTable(pr); layoutStudioPad(pr);   // before the colliders and spots below read their anchors
  for (const [name, o] of Object.entries(world.anchors)) {
    if (name.startsWith("PLATEAU_")) bodies[o.userData.body || "planet"].addPlateau(wpos(o), o.userData);
    if (name.startsWith("COL_")) { const p = wpos(o); (p.distanceTo(moon.centre) < moon.R + 8 ? moon : planet).colliders.push({ p, r: o.userData.r, wade: /^COL_pond_\d+$/.test(name) }); }   // wade: the player may walk through a pond collider (planet.collide), everything else still keeps out
  }
  pr.traverse(o => { if (/^PIN_fin_/.test(o.name)) planet.colliders.push({ p: wpos(o), r: 0.55 }); });

  // cel shading + ink outlines
  try { await installTrees(pr, world.loader); } catch (e) { console.warn("trees.glb: keeping the procedural trees", e); }   // pillow canopies on the same nodes
  dropLobes(pr);   // lollipops lose the side ball on their canopy
  clearRoads(pr, planet, groundUniforms(planet), world.anchors);   // trees standing on a road step to the roadside (with their colliders), before ink, BVHs and fades
  toonify(pr, { keep: o => /screen/i.test(o.name) });
  twoTone(pr, o => /^TREE_\d+(_\d+)?$/.test(o.name));   // trees: lit + shade only
  toonify(mr, { keep: o => /screen/i.test(o.name) });
  paintGround(pr.getObjectByName("PLANET_ground"), planet);
  cleanMoon(mr.getObjectByName("MOON_ground"));   // vertex-colour blotches off, true sphere normal (moon.js)
  const outlined = [];
  pr.traverse(o => { if (o.isMesh && /^(TREE|BUSH|SHROOM|KIOSK_.*_body|CANNON|MECH_cannon|STUDIO_house|STUDIO_maptable|MONUMENT|HUB_slab|STEP_|LOOKOUT|PIN_frame|PIN_plinth|PIN_fin|PIN_backplate|TRIGGER_)/.test(o.name)) outlined.push(o); });
  mr.traverse(o => { if (o.isMesh && /^(KIOSK_.*_body|CANNON|MOON_flag|MOON_rock_)/.test(o.name)) outlined.push(o); });
  // the cannon wheels are ink-coloured (M_Clay_Ink): a hull only fattened their black tyre past the
  // 2.86 px line every other part carries, so they stand as their own line
  outlined.filter(o => !/^(MECH_cannon|CANNON_moon)_wheel$/.test(o.name)).forEach(o => outline(o));
  moonFlag = setupMoonFlag({ root: mr, moon, spots, getPlayer: () => player, rig, fx, ui, tween, sleep });   // the blue flag becomes "Plant your flag" (moonflag.js)
  // cave shell + boulders, pond rims, moon landing pads and
  // the hub signal (it spins on a click, so its hull rides inside it)
  pr.traverse(o => { if (o.isMesh && !o.userData.isOutline && /^(CAVE_shell|CAVE_boulders|POND_\d+_rim)/.test(o.name)) outline(o); });
  mr.traverse(o => { if (o.isMesh && !o.userData.isOutline && /^MOON_pad/.test(o.name)) outline(o); });
  // terraces, plateaus, the moon deck and their lips: pushed back along the view ray
  // (like the birds), so only the silhouette against sky / far ground inks; no seam where a terrace
  // foot meets the ground or where a lip sits on its terrace top (lip needs the deeper push)
  for (const r of [pr, mr]) r.traverse(o => { if (o.isMesh && !o.userData.isOutline && /^(TERRACE_|LIP_)/.test(o.name)) outline(o, "#1E1F26", undefined, { back: /^LIP_/.test(o.name) ? 0.6 : 0.25 }); });
  // the pin-art fence posts (PIN_colonnade): pushed back along the view ray like the terraces, so the
  // thin posts ink only their silhouette and the hull does not stripe at range
  pr.traverse(o => { if (o.isMesh && !o.userData.isOutline && o.name === "PIN_colonnade") outline(o, "#1E1F26", undefined, { back: 0.25 }); });
  pr.traverse(o => { if (o.isMesh && !o.userData.isOutline && o.name === "HUB_signal") outline(o, "#1E1F26", undefined, { child: true }); });
  pr.traverse(o => { if (o.name === "PLANET_ground" && o.isMesh) outline(o, "#3A2F6B", undefined, { px: RIM_INK_PX, maxM: 1 }); });
  mr.traverse(o => { if (o.name === "MOON_ground" && o.isMesh) outline(o, "#3A2F6B", undefined, { px: RIM_INK_PX, maxM: 1 }); });

  // the visitor
  player = new Player(scene, character);
  toonify(player.figure);
  // ink only the silhouette parts: hulls on the eye, pupil and sparkles poke through the body
  outline(player.figure, "#1E1F26", o => !/Sparkle|Pupil|EyeWhite/i.test(o.material && o.material.name));
  helmet = createHelmet(player.figure);   // the cannon trip's fishbowl (hidden until he is inside the planet cannon)
  player.place(planet, wpos(A("SPAWN")), wfwd(A("SPAWN")));
  rig.snap(player);

  // kiosk screens wear the project screenshots
  for (const p of PROJECTS) {
    const screen = (pr.getObjectByName("KIOSK_" + p.id + "_screen") || mr.getObjectByName("KIOSK_" + p.id + "_screen"));
    if (!screen) continue;
    screen.material = new THREE.MeshBasicMaterial({ map: screenTexture(p), toneMapped: false, alphaTest: 0.5 });   // alphaTest: the rounded corners cut away
    const stand = A("KIOSK_" + p.id);
    // a film stage's screen is not a second prompt: the stage offers only the big button and
    // the cast. Its kiosk spot stays for the map, travel and goals (never prompts); clicking
    // the screen walks you over and plays the film.
    const film = p.id in FILMS;
    spots.push({ id: p.id, kind: "kiosk", pos: wpos(stand), r: 3.0, body: stand.parent === mr || mr.getObjectByName(stand.name) ? "moon" : "planet", label: "Take a peek", run: film ? () => spots.find(s => s.id === "play-" + p.id)?.run() : () => kiosk(p.id), target: screen, off: film ? () => true : undefined });
  }
  { // the map's reach is a ring round the TABLE (not its stand point 1.9 m behind it), so walking up to the table from any side, including
    // from the pinscreen, offers the map; `prio` lets it beat Pin Art's 4.5 m circle, which reaches the table's pin side
    const tab = pr.getObjectByName("STUDIO_maptable"), tc = new THREE.Vector3();
    spots.push({ id: "map", kind: "map", pos: wpos(A("MAP")), r: M1_R + 0.3, core: 0.8, prio: true, at: () => tab ? tab.getWorldPosition(tc) : tc.copy(wpos(A("MAP"))), body: "planet", label: "Find my bearings", run: openMap, target: tab });
  }
  spots.push({ id: "cannon", kind: "cannon", pos: wpos(A("CANNON_planet")), r: 3.4, body: "planet", label: "", run: useCannon, target: pr.getObjectByName("MECH_cannon_barrel") });
  spots.push({ id: "moon-cannon", kind: "cannon", pos: wpos(A("CANNON_moon")), r: 3.4, body: "moon", label: "Take the express home", run: fireHome, target: mr.getObjectByName("CANNON_moon_barrel") });
  setupWheels(pr, mr); setupBores(pr, mr);   // open the muzzles before the camera occluders' BVH is built
  // camera occluders (BVH so a ray against the whole planet costs microseconds)
  const occ = [];
  for (const root of [pr, mr]) root.traverse(o => {
    if (!o.isMesh || o.userData.isOutline || /screen|LIP_|studs|_flag|^POND_/i.test(o.name)) return;
    o.geometry.computeBoundsTree(); occ.push(o);
  });
  rig.occluders = occ;
  seatOrbit = createSeatOrbit({ rig, camera, planet, moon });   // ONLY the lookout marker ("Take in the view"): fly out round the planet and moon, then back (seatorbit.js). A bench never calls it.
  sitFly = createSitButterfly(scene);   // bench: after 10 s seated a butterfly lands on his head (sitfly.js)
  pinOcc = createPinOccluder({ scene, rig, getPins: () => games["pin-art"] && games["pin-art"].pins });   // the lens never sits inside the pins
  { // bushes wear their palette's mint and lilac: the salmon M_Peach ones (a material shared with other props) read as
    // peach blobs on the sand and the roads, so they take the mint bushes' own material
    const bushes = []; pr.traverse(o => { if (o.isMesh && /^BUSH_\d+$/.test(o.name)) bushes.push(o); });
    const mint = bushes.find(b => b.material.name === "M_Mint");
    if (mint) for (const b of bushes) if (b.material.name === "M_Peach") b.material = mint.material;
  }
  // props that may hide while the lens is right next to them (with their ink hulls)
  pr.traverse(o => {
    if (!o.isMesh || o.userData.isOutline || !/^(TREE|BUSH|SHROOM)/.test(o.name)) return;
    o.geometry.computeBoundingSphere();
    const hull = o.parent.children.find(c => c.name === o.name + "_outline");
    nearProps.push({ o, hull, c: o.localToWorld(o.geometry.boundingSphere.center.clone()), r: o.geometry.boundingSphere.radius });
  });
  // stairs and the lookout are walkable: the player stands on whatever is under its feet
  for (const root of [pr, mr]) root.traverse(o => { if (o.isMesh && !o.userData.isOutline && /^(STEP_|HUB_slab_)|^(LOOKOUT|MOON_pad(_\d+)?)$/.test(o.name)) player.supports.push(o); });
  { // the stair's rim (steps reach 2.7 m from the column) and the lookout's rail (2.6 m; the pie is 2.7 m)
    const c = wpos(A("PLATEAU_monument")), n = planet.up(c);
    player.walls.push({ c, n, r: 2.4, rTop: 2.4, hMin: 0.6, hTop: 7.75 });
  }
  setupBooth(pr);
  // lookout stair/column/deck/rail + booth go screen-door see-through while they hide Blip (occfade.js)
  rig.occFade = createOccFade({ rig, renderer, getPlayer: () => player, meshes: rig.occluders.filter(o => /^(STEP_|HUB_slab_\d|MONUMENT_column$|LOOKOUT|BOOTH_|TREE|BUSH|SHROOM|MOON_rock|STUDIO_house)/.test(o.name)) });   // + props: they fade at far zoom instead of pulling the lens in (camera.js)
  // the dress-up stage: the hub signal ring gets its own fade, used only while the booth panel is open (it never blocks the follow lens)
  { const sig = pr.getObjectByName("HUB_signal"); if (sig) rig.stageFade = createOccFade({ rig, renderer, getPlayer: () => player, meshes: [sig] }); }
  setupCannon(pr);
  setupMonument(pr);
  setupSecret();
  setupViewSpot();   // the lookout deck's "Take in the view" marker (the planet orbit lives here, not on the benches)
  setupStages();
  setupStudio(pr);
  setupPonds(pr);
  birds = new Birds(scene, planet.centre, planet.R, lowPower ? 6 : 10);
  butterflies = new Butterflies(scene, butterflyPlaces(pr)); butterflies.camera = camera;
  if (butterflies.migrated) { ui.puzzles.butterflies = []; ui.save(); }   // every visit starts at zero: a stored list is cleared, never restored (savestate.js)
  butterflies.rig = rig; butterflies.onCue = (c, k) => { if (c === "burst") sfx.play("star", { gain: 1.7 }); else sfx.play("butterfly", { gain: 0.55 + 0.2 * k }); };   // R7 F1: the swell (existing sprites, rising gain) + the camera beat (life.js)
  butterflies.onAll = n => { const say = () => { const el = document.getElementById("toast"); if (slate.active || (el && el.classList.contains("show") && !el.textContent.startsWith("Butterflies"))) sleep(0.5).then(say); else ui.toast(`All ${n} butterflies found. And there they go. Typical.`, 3200); }; say(); };   // spiral, then scatter (life.js)
  const castLoaded = loadCast();

  for (const id of GAMES) await mountGame(id);
  setupSigns();   // after the games, so their spots exist to point at and keep clear of
  setupExtras();   // before the grass, which keeps clear of the machine
  setupGrass();
  await castLoaded;   // the creatures pick resting spots clear of the casts
  await loadFauna();
  fontsReady.then(drawMapTable);
  bootMapTable();   // the 3D board's table-top snapshot, built behind the loading bar so play never hitches

  if (rig.occFade) rig.occFade.warm(scene, camera);   // compile the occluder fade's materials before first paint (no hitch on the first fade)
  if (rig.stageFade) rig.stageFade.warm(scene, camera);
  renderer.compile(scene, camera);
  clearInterval(noteTimer);
  $("loadfill").style.width = "100%"; loadbar.setAttribute("aria-valuenow", "100");
  $("loadnote").textContent = `${PROJECTS.length} projects. One tiny planet. One suspicious moon.${ui.found.size ? ` Welcome back. You’ve found ${ui.found.size}.` : ""}`;
  $("enter").disabled = false; $("enter").focus();
  installRestart();   // R7 T3: "Restart journey" in #menu and on the dock
  addEventListener("r7:letter", () => sfx.play("star", { gain: 0.55 }));   // R7: Spell GITHUB, each letter lands with a tick
  const r7radio = installRadio({ amb });   // R7 T7: the radio "world voice" greets once per session after the intro
  installNight({ scene, sky, ui, camera, spots, bodies, onNight: () => r7radio.wow() });   // R7 T6: night reveal for the first secret + the moon/sun toggle; switching the sun off plays the Wow! signal and shows the UFO
  installRewards({ ui, sfx, scene, camera, renderer, butterflies, player, bodies, slate, getMoonPlay: () => moonPlay });   // R7 T8: wallpapers, printable Blip, DP badges
  state = "intro";
}

$("enter").addEventListener("click", enter);
function enter() {
  stat("enter");
  if (state !== "intro") return;
  $("intro").classList.add("gone"); document.body.classList.remove("is-loading");
  state = "play";
  camera.zoom = 1; camera.clearViewOffset(); fitCamera();   // undo the planet-hero framing
  rig.snap(player);
  const end = camera.position.clone();
  camera.position.copy(player.position).addScaledVector(player.up, 60).add(new THREE.Vector3(30, 0, 40));
  introShot = { from: camera.position.clone(), to: end, t: 0 };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) introShot.t = 1;   // no fly-in: the first frame is the follow camera
  ui.hint(isTouch ? "Stick to walk · drag to look · tap to go there · the big round button interacts, the small one jumps" : "<kbd>W A S D</kbd> walk <kbd>Drag</kbd> look <kbd>Space</kbd> jump <kbd>E</kbd> interact <kbd>M</kbd> map", 9000);
  updateGoal();
}
let introShot = null;
let groundU = null, grass = null, fieldFloor = null, vending = null, moonPlay = null;

/* ------------------------------------------------------------ ground paint
   The patterns are computed per pixel from the surface direction (per-vertex colours on the
   1.2 m mesh would turn every patch edge and road into a zig-zag staircase), with edges
   anti-aliased by fwidth, and the sandy roads are true great-circle arcs from the summit to
   every terrace. */
function paintGround(mesh, body) {
  if (!mesh) return;
  const mat = mesh.material.clone();
  mat.vertexColors = false;
  const U = groundUniforms(body);
  U.uSpeckle = { value: 1 };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vDirG;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvDirG = normalize(position);");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec3 vDirG; uniform float uSpeckle;
        ${GROUND_GLSL}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        vec3 p = normalize(vDirG);
        // band edges antialiased by how fast the fields change across a pixel
        float w = max(fwidth(gFields(p).x), 1e-4) * 0.75;
        vec3 c = groundCol(p, w);
        // a fine speckle of darker blades, faded out well before it is small enough to shimmer
        vec3 m = p * uR * 5.0;
        float fade = 1.0 - smoothstep(0.12, 0.35, length(fwidth(m)));
        float sp = gNoise(m) * 0.6 + gNoise(m * 2.1 + 4.0) * 0.4;
        c *= 1.0 - 0.07 * fade * uSpeckle * smoothstep(0.62, 0.7, sp);
        // gRoad jumps from a real distance to 1e3 where an arc's end cut-off (along < span + 0.03)
        // switches; fwidth across that jump is ~1e3, which smears the edge into 50 % road colour on
        // every 2x2 pixel quad it crossed: thin dashed peach lines over the grass. A road edge never
        // moves more than ~1 m per pixel, so cap the antialias width there.
        float rd = gRoad(p);
        c = mix(c, uRoad, 1.0 - gAA(1.4, rd, min(fwidth(rd), 1.0) * 0.75 + 1e-4));
        diffuseColor.rgb = c;`)
      // light the ground with the true sphere normal per pixel: the mesh's interpolated
      // normals put the toon band edges on its 1.2 m triangles (zig-zag facets)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        normal = normalize((viewMatrix * vec4(normalize(vDirG), 0.0)).xyz);`);
  };
  mat.customProgramCacheKey = () => "ground-paint";
  mesh.material = mat;
  groundU = U;
}

/* L6: the GenAI prompt machine stands on the far side of its terrace from the kiosk (frame x/y in metres, yaw in rad), and its prompt
   circle is 1.65 m (was 1.9), which leaves a gap of at least 1 m to the kiosk's 3 m circle (the flat top is only 4.2 m in radius) */
const L6_VEND = { x: 3.5, y: 0.5, yaw: 0 }, L6_VEND_R = 1.4;   // V: beside the kiosk, same facing (yaw 0 = the kiosk's front), 0.3 m visual gap
/* the Field effect floor, the GenAI prompt machine, and the moon's trampolines and stars */
function setupExtras() {
  const pr = world.islands.planet.root;
  const fr = id => terraceFrame(A("PLATEAU_" + id), A("KIOSK_" + id), pr.getObjectByName("KIOSK_" + id + "_body"), planet.centre);
  if (A("PLATEAU_field")) fieldFloor = new FieldFloor(scene, fr("field"), pr.getObjectByName("KIOSK_field_screen"), { plateau: A("PLATEAU_field"), keepOut: A("COL_k_field") });
  hiveInstall();   // "Walk the hive", beside the AI Momentum to Value kiosk
  if (A("PLATEAU_genai-after-hours")) {
    vending = new Vending(scene, fr("genai-after-hours"), L6_VEND);
    toonify(vending.group); outline(vending.group, "#1E1F26", o => !o.material.map);
    planet.colliders.push(vending.collider);
    spots.push({ id: "vending", kind: "extra", pos: vending.standPos, r: L6_VEND_R, body: "planet", label: "Print a prompt", run: () => ui.toast(vending.pull(), 4200), target: vending.lever });
  }
  // every visit starts with the five stars back on the moon, like the butterflies: a stored list is cleared, never restored
  if ((ui.puzzles.stars || []).length) { ui.puzzles.stars = []; ui.save(); }
  moonPlay = new MoonPlay(scene, world.anchors, moon, planet, { saved: [], outline });
  for (const tr of moonPlay.tramps) toonify(tr.g);   // (the stars stay lit: they glow)
}

/* tufts over the open ground: clear of ponds, props, benches and every interaction spot */
function setupGrass() {
  const ponds = [], benches = [];
  for (const [name, a] of Object.entries(world.anchors)) {
    if (/^POND_\d+$/.test(name)) ponds.push([wpos(a), (a.userData.r || 3) + 0.5]);
    if (name.startsWith("BENCHSPOT_")) benches.push(wpos(a));
  }
  const q = new THREE.Vector3();
  const ok = d => {
    q.copy(planet.centre).addScaledVector(d, planet.R);
    if (ponds.some(([p, r]) => p.distanceTo(q) < r)) return false;
    if (planet.colliders.some(c => c.p.distanceTo(q) < c.r + 0.25)) return false;
    if (benches.some(b => b.distanceTo(q) < 1.6)) return false;
    return !spots.some(s => s.body === "planet" && s.pos.distanceTo(q) < 1.2);
  };
  grass = new Grass(scene, planet, groundU, { count: lowPower ? 1500 : 4200, ok });
}

/* ------------------------------------------------------------ games */
async function mountGame(id) {
  if (games[id]) return;
  const anchor = A("GAME_" + id);
  if (!anchor) return;
  let Mod;
  try { Mod = (await import(`./games/${id}.js?v=20261110-0921`)).default; } catch (e) {
    console.warn("game module missing", id, e);
    // the project stays reachable: its terrace offers the project card instead of a silent nothing
    spots.push({ id, kind: "kiosk", pos: wpos(anchor), r: 3, body: "planet", label: "Take a peek", target: anchor,
      run: () => { ui.toast("This game didn’t load. Here’s the project instead.", 3000); ui.openPanel(id); } });
    return;
  }
  const group = new THREE.Group();
  group.position.copy(wpos(anchor));
  group.quaternion.copy(anchor.getWorldQuaternion(new THREE.Quaternion()));
  scene.add(group); group.updateMatrixWorld(true);
  const ctx = {
    THREE, scene, camera, group, lowPower,
    palette: { paper: "#FBF8F1", ink: "#1E1F26", signal: "#2B2BEE", concrete: "#C4C5BE" },
    ui: { toast: t => ui.toast(t), status: t => ui.status(t), tools: l => ui.tools(l) },
    sfx: ui.sfx,   // GB1: the engraver's detent ticks and lock cue
    isSolved: () => ui.found.has(id), solved: () => solvedGame(id),
    extra: { anchor: A("PINS_anchor"), pinGeometry: world.shared.getObjectByName("PinUnit").geometry },
  };
  try {
    games[id] = new Mod(ctx); games[id].ctx = ctx;
    if (games[id].ready) await games[id].ready;
    toonify(group);
    // ink the cel parts like every other prop. Only toon meshes: screens,
    // the sign face, trails and glows are Basic/transparent; instanced court marks and dots are
    // decals. Hulls ride inside their meshes (child), so paddles, the ball, the dial and the
    // re-extruded brand mark carry their ink with them; the game modules carry no ink code.
    outline(group, "#1E1F26", o => !o.isInstancedMesh && o.material && o.material.isMeshToonMaterial && !o.material.transparent && !/screen|decal|label|text/i.test(o.name), { child: true });
  } catch (e) { console.error("game failed to start", id, e); return; }
  // the Pong court is centred on its (smaller) terrace, so its visitor stands closer
  const stand = group.localToWorld(new THREE.Vector3(0, 0, id === "gravity-pong" ? 2.6 : 4));
  spots.push({ id, kind: "game", pos: stand, r: id === "pin-art" ? L1_PIN_R : 2.8, body: "planet", label: byId[id].verb, run: () => enterGame(id), target: group });
}

function enterGame(id) {
  const g = games[id];
  if (!g) return ui.openPanel(id);
  ui.focusBar(byId[id].name, []);
  const view = g.enter();
  const gp = g.ctx.group;
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(gp.quaternion);
  rig.focus(gp.localToWorld(view.pos.clone()), gp.localToWorld(view.look.clone()), up);
  focused = { kind: "game", id }; state = "focus";
  player.frozen = true; input.lookEnabled = false; autoTarget = null;
  player.group.visible = false;   // the game camera sits behind the visitor's spot
  ui.prompt(null); ui.hideHint();
}
function solvedGame(id) {
  const first = ui.discover(id);
  if (first) amb.select(id, { discover: true });
  if (first) celebrate();
  player.play("Cheer");
  setTimeout(() => ui.openPanel(id), first ? 1400 : 300);
  updateGoal();
}
function exitFocus() {
  if (!focused) return;
  if (games[focused.id]) games[focused.id].exit();
  focused = null; state = "play";
  player.frozen = false; input.lookEnabled = true; player.group.visible = true;
  rig.release(); ui.focusBar(null); ui.closePanel();
  updateGoal();
}
$("focusExit").onclick = exitFocus;
$("focusInfo").onclick = () => focused && ui.openPanel(focused.id);

function kiosk(id) {
  const first = games[id] ? false : ui.discover(id);   // R7 T3: a peek never marks a mini-game done; only solving it does (solvedGame)
  amb.select(id, { discover: first });
  if (first) celebrate();
  player.play("Wave");
  ui.openPanel(id);
  updateGoal();
}

/* ------------------------------------------------------------ cannon (aim it, then ride it) */
let barrel, wheel, aim, aimShown;
function setupCannon(pr) {
  barrel = pr.getObjectByName("MECH_cannon_barrel"); wheel = pr.getObjectByName("MECH_cannon_wheel");
  barrel.userData.q0 = barrel.quaternion.clone(); wheel.userData.q0 = wheel.quaternion.clone();
  aim = ui.puzzles.cannon ?? 0; aimShown = aim;
  // outlines are added as siblings; let them follow their meshes
  [barrel, wheel].forEach(o => o.parent.children.filter(c => c.name === o.name + "_outline").forEach(h => (o.userData.hull = h)));
}
const AIM_STEPS = 2;
function useCannon() {
  if (aim < AIM_STEPS) {
    aim++; ui.puzzles.cannon = aim; ui.save();
    sfx.play("cannon_wind");
    ui.toast(aim < AIM_STEPS ? `Cannon alignment · ${aim} / ${AIM_STEPS}. What could go wrong?` : "Moon acquired. Please board your cannon.");
    updateGoal();
    return;
  }
  fire("CANNON_planet", barrel, planet, moon, wpos(A("LAND_moon")), wfwd(A("LAND_moon")), () => { ui.toast("Welcome to the moon. Something’s been expecting you.", 3000); updateGoal(); });
}
function fireHome() {
  fire("CANNON_moon", world.islands.moon.root.getObjectByName("CANNON_moon_barrel"), moon, planet, wpos(A("SPAWN")), wfwd(A("SPAWN")), () => updateGoal());
}

/* ---- circus human cannonball + fishbowl helmet ----
   The muzzle model ends in a solid dished floor 0.15-0.25 m down. setupBores() cuts that floor out
   (the ink hull shares the geometry, so it opens too) and lines the hole with a dark open tube and a
   plug that ride inside the barrel group, so nothing outside shows through. Both cannons are the same
   size (sizeMoonCannon), so one act plays at both ends. */
let helmet = null, suited = false;
const BORE_DEPTH = 1.9;   // world metres of liner below the floor
const ACT_DIST = 8.5, WAIST_Y = 0.38;   // follow-lens m the flight starts from; body y that sits at the rim
const HOP_APEX = 0.6, HOP_UP = 0.6;   // the climb's apex (m of feet over the rim centre; the tilted planet lip stands higher) and the share of its 0.8 s spent rising: a scripted arc, the same on both bodies
/* The moon cannon is modelled at 0.6 x. It is baked up to the planet cannon's size about its foot and moved to
   (MOON_CANNON_AT, deck x right / y forward as seen from the landing pad), where the full-size foot stays on the
   deck's flat top. Its anchors, approach spot and collider follow. Runs before setup() reads the anchors. */
const MOON_CANNON_SIZE = 1 / 0.6, MOON_CANNON_AT = [1.5, 1.0];
function deckFrame() {   // the moon landing deck: centre, up, x (right) and y (forward, from the pad to the deck centre)
  const c = wpos(A("PLATEAU_moon-landing")), n = c.clone().sub(wpos(A("BODY_moon"))).normalize();
  const y = c.clone().sub(wpos(A("LAND_moon"))); y.addScaledVector(n, -y.dot(n)).normalize();
  return { c, n, y, x: new THREE.Vector3().crossVectors(y, n) };
}
function sizeMoonCannon(mr) {
  const S = MOON_CANNON_SIZE, d = deckFrame(), base = mr.getObjectByName("CANNON_moon_base");
  if (!base || base.userData.sized) return;
  const B = base.position.clone(), B2 = d.c.clone().addScaledVector(d.x, MOON_CANNON_AT[0]).addScaledVector(d.y, MOON_CANNON_AT[1]);
  const geoms = new Set();
  for (const o of [...mr.children]) {
    if (!/^(CANNON_moon|COL_c_CANNON_moon$)/.test(o.name)) continue;
    o.position.sub(B).multiplyScalar(S).add(B2);
    o.traverse(k => { if (k !== o) k.position.multiplyScalar(S); if (k.isMesh && !geoms.has(k.geometry)) { geoms.add(k.geometry); k.geometry.scale(S, S, S); } });
    if (o.userData.r) o.userData.r *= S;
  }
  base.userData.sized = true;
}
/* The moon's layout around the full-size cannon: the Artboard 42 kiosk (body, screen, visitor spot, collider) steps
   KIOSK42_SHIFT along the deck (left and a little back, seen from the pad), and the flag stands on the far side, the
   point opposite its deck spot about the moon centre (facing away from the planet), kept FLAG_CLEAR m (arc) off any
   fallen-star spot or crater trampoline, upright and sunk FLAG_SINK m into the ground. */
const KIOSK42_AT = [-0.341, 0.9118, 0.2286], FLAG_CLEAR = 2.0, FLAG_SINK = 0.06;   // L4: KIOSK42_AT = unit direction of the kiosk's base from the moon centre (22 m of arc from the cannon, 9 m from the flag, 6.5 m from every star and trampoline)
function layoutMoon(mr) {
  const d = deckFrame(), flag = mr.getObjectByName("MOON_flag"), col = mr.getObjectByName("COL_moon_flag");
  if (!flag || flag.userData.moved) return;
  l4Kiosk(mr, d);
  moonwalkInstall({ mr, moon, anchors: world.anchors, spots, ui, ascii, solve: () => kiosk("artboard-42"), log: m => new URLSearchParams(location.search).has("debug") && (window.__mwlog = window.__mwlog || []).push([+(performance.now() / 1000).toFixed(2), m]) });   // ASCII moonwalk (moonwalk.js): pad + crater guide beside the kiosk
  const M = wpos(A("BODY_moon")), R = A("BODY_moon").userData.r;
  const q = new THREE.Quaternion().setFromAxisAngle(d.x, Math.PI), u = flag.position.clone().sub(M).applyQuaternion(q).normalize();
  q.premultiply(new THREE.Quaternion().setFromUnitVectors(d.n.clone().applyQuaternion(q), u));   // the pole stood on the flat deck: stand it radial
  for (const [nm, o] of Object.entries(world.anchors)) {   // step off a fallen star or trampoline that sits on the opposite point
    if (!/^(MOONSTAR_|MOONTRAMP_)/.test(nm)) continue;
    const s = wpos(o).sub(M).normalize(), gap = FLAG_CLEAR / R - s.angleTo(u);
    if (gap > 0) { const t = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3().crossVectors(s, u).normalize(), gap); u.applyQuaternion(t); q.premultiply(t); }
  }
  flag.quaternion.premultiply(q); flag.position.copy(M).addScaledVector(u, R - FLAG_SINK);
  if (col) col.position.copy(M).addScaledVector(u, R);
  flag.userData.moved = true;
}
/* L4 / L7: stand a kiosk rigidly (body, screen, visitor spot, collider) with its base at `base`, upright on `up`, its screen turned toward `face`
   (a tangent direction). Everything keeps its offset in the kiosk's own frame; the collider only moves. The visitor spot is put back on the ground. */
function l4Place(objs, body, ctr, R, base, up, face) {
  const z = face.clone().addScaledVector(up, -face.dot(up)).normalize(), x = new THREE.Vector3().crossVectors(up, z);
  const qn = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, z));
  const qr = qn.multiply(body.quaternion.clone().invert()), p0 = body.position.clone();
  for (const o of objs) {
    o.position.sub(p0).applyQuaternion(qr).add(base);
    if (!/^COL_/.test(o.name)) o.quaternion.premultiply(qr);
    if (/^KIOSK_[^_]*$/.test(o.name)) o.position.sub(ctr).setLength(R).add(ctr);   // the visitor spot (no _body/_screen suffix) stands on the ground
    o.updateMatrix();
  }
}
function l4Kiosk(mr, d) {   // the moon kiosk: far side of the moon from the home cannon, its screen turned toward the deck
  const body = mr.getObjectByName("KIOSK_artboard-42_body"); if (!body || body.userData.moved) return;
  const M = wpos(A("BODY_moon")), R = A("BODY_moon").userData.r, u = new THREE.Vector3(...KIOSK42_AT).normalize();
  l4Place(["KIOSK_artboard-42_body", "KIOSK_artboard-42_screen", "KIOSK_artboard-42", "COL_k_artboard-42"].map(n => mr.getObjectByName(n)).filter(Boolean), body, M, R, M.clone().addScaledVector(u, R - 0.05), u, d.c.clone().sub(M));
  body.userData.moved = true;
}
/* L3: the igloo moves to the quietest spot on the planet (found by a search: the point farthest from every spot, kiosk, creature and cannon, clear
   of ponds, terraces, roads and trunks): L3_HOUSE_AT is its unit direction. AP, the door, smoke, knock spot, Blip's mark and the knock camera all live
   in the house's own frame, so they come with it; only the collider (COL_studio) is moved by hand. The door turns toward the map table. */
const L3_HOUSE_AT = [0.1607, -0.9628, 0.2174];
function layoutIgloo(pr) {
  const h = pr.getObjectByName("STUDIO_house"), col = A("COL_studio"), tab = A("PLATEAU_studio"); if (!h || h.userData.moved) return;
  const C = planet.centre, u = new THREE.Vector3(...L3_HOUSE_AT).normalize(), base = C.clone().addScaledVector(u, planet.R - 0.08);
  const z = wpos(tab).sub(base); z.addScaledVector(u, -z.dot(u)).normalize();
  h.position.copy(base); h.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(u, z), u, z)); h.updateMatrix();
  if (col) { col.position.copy(base); col.updateMatrix(); }
  h.userData.moved = true; pr.updateMatrixWorld(true);
}
/* L7: the tenth project's kiosk (sea-ai-maturity): a copy of Field's kiosk (body, screen, visitor spot, collider) stood on open ground beside a road,
   L7_AT (unit direction of its base), its screen turned toward the road point L7_FACE. The existing screens/spots loop in setup() picks it up by name. */
const L7_ID = "sea-ai-maturity", L7_AT = [-0.685, -0.6919, 0.2281], L7_FACE = [-0.6705, -0.6357, 0.3825];   // R: the far hemisphere (L7_FACE: a point 5 m ahead of the kiosk, so the hive lies in the open ground in front of it)
function l7InstallKiosk(pr) {
  const src = pr.getObjectByName("KIOSK_field_body"), scr = pr.getObjectByName("KIOSK_field_screen"), st = A("KIOSK_field"), col = A("COL_k_field");
  if (!src || !scr || !st || !col || A("KIOSK_" + L7_ID)) return;
  const rn = o => { o.traverse(k => { k.name = k.name.replace("field", L7_ID); }); return o; };
  const body = rn(src.clone(true)), screen = rn(scr.clone(true)), stand = rn(st.clone(true)), coll = rn(col.clone(true));
  stand.userData = { name: stand.name, project: L7_ID }; coll.userData = { name: coll.name, r: col.userData.r };
  const C = planet.centre, u = new THREE.Vector3(...L7_AT).normalize(), base = C.clone().addScaledVector(u, planet.R - 0.1);
  const toRoad = C.clone().addScaledVector(new THREE.Vector3(...L7_FACE).normalize(), planet.R).sub(base);
  for (const o of [body, screen, stand, coll]) pr.add(o);
  pr.updateMatrixWorld(true);
  l4Place([body, screen, stand, coll], body, C, planet.R, base, u, toRoad);
  pr.updateMatrixWorld(true);
  world.anchors[stand.name] = stand; world.anchors[coll.name] = coll;
}
/* "Walk the hive" (hive.js): a 19-hex honeycomb in the L7 kiosk's own frame (local offsets from its visitor spot, so it follows the
   kiosk if the planet is resized). Called from setupExtras, next to the Field floor, because it needs the kiosk screen's map and the plateaus registered. */
let hive = null;
function hiveInstall() {
  const stand = A("KIOSK_" + L7_ID), body = world.islands.planet.root.getObjectByName("KIOSK_" + L7_ID + "_body"), screen = world.islands.planet.root.getObjectByName("KIOSK_" + L7_ID + "_screen");
  if (!stand || !body || hive) return;
  hive = new HiveFloor(scene, terraceFrame(stand, stand, body, planet.centre), {
    centre: planet.centre, surface: d => planet.surface(d), screen, supports: player.supports,   // the pad caps are walkable supports: Blip's feet ride them
    onSolved: () => setTimeout(() => { if (ui.discover(L7_ID)) { amb.select(L7_ID, { discover: true }); celebrate(); } updateGoal(); }, 1300),   // after the last move's toast has been read
  });
  if (new URLSearchParams(location.search).has("debug")) window.__hive = hive;   // test hook
}
/* L2: the lookout stair (terrace, column, steps, slabs, signal, deck, rail, its bench, secret spot and collider) turns as one rigid piece about
   the planet centre, so it stays upright on the surface, STAIR_TO is the unit direction of the new terrace centre: it stands clear of every
   other terrace, pond and spot (found by a clearance search; the old one stood 11 m from the cluster of creatures and the lookout bench).
   Runs before the plateaus, roads, signposts and creatures read their anchors, so all of those follow. */
const STAIR_TO = [0.7055, 0.6481, -0.2868], STAIR_PARTS = /^((TERRACE|LIP|PLATEAU)_monument|MONUMENT_column|HUB_slab_\d+|HUB_signal|STEP_\d+|LOOKOUT(_rail)?|SECRET_top|BENCHSPOT_monument|COL_monument)$/;
function layoutStair(pr) {
  const m = A("PLATEAU_monument"); if (!m || m.userData.stairMoved) return;
  const C = planet.centre, from = wpos(m).sub(C).normalize(), q = new THREE.Quaternion().setFromUnitVectors(from, new THREE.Vector3(...STAIR_TO).normalize());
  pr.traverse(o => { if (o.userData.isOutline || !STAIR_PARTS.test(o.name)) return; o.position.sub(C).applyQuaternion(q).add(C); o.quaternion.premultiply(q); o.updateMatrix(); });
  m.userData.stairMoved = true; pr.updateMatrixWorld(true);
}
/* M1: the map table leaves the Studio terrace and stands on the Pin Art terrace, left of the entrance as a visitor walks in (Lumen stands on the right).
   M1_AT = the table's centre in the Pin Art terrace's frame (x to the visitor's right, z toward the spawn, metres) and the horizontal direction from the
   table to its stand point (the MAP anchor); the table, its "Open the map" anchor and its collider turn and move as one piece, so the stand keeps
   its place on the table. The table's origin is the centre of its base, so it is centred on its own footprint. */
const M1_AT = { x: -5.4, z: 5.9, face: [0.173, 0.985] }, M1_R = 2.2;
function layoutMapTable(pr) {
  const tab = pr.getObjectByName("STUDIO_maptable"), mp = A("MAP"), col = A("COL_map"), pin = A("PLATEAU_pin-art"), sp = A("SPAWN");
  if (!tab || !mp || !pin || !sp || tab.userData.moved) return;
  const C = planet.centre, V = THREE.Vector3, up0 = new V(0, 1, 0).applyQuaternion(tab.quaternion).normalize();
  const c1 = wpos(pin), n1 = c1.clone().sub(C).normalize(), ez = wpos(sp).sub(c1); ez.addScaledVector(n1, -ez.dot(n1)).normalize();
  const ex = new V().crossVectors(n1, ez), base0 = wpos(tab), base1 = c1.clone().addScaledVector(ex, M1_AT.x).addScaledVector(ez, M1_AT.z);
  const h0 = wpos(mp).sub(base0); h0.addScaledVector(up0, -h0.dot(up0)).normalize();
  const h1 = ex.clone().multiplyScalar(M1_AT.face[0]).addScaledVector(ez, M1_AT.face[1]).normalize();
  const B = (h, u) => new THREE.Matrix4().makeBasis(h, u, new V().crossVectors(h, u));
  const q = new THREE.Quaternion().setFromRotationMatrix(B(h1, n1).multiply(B(h0, up0).transpose()));
  for (const o of [tab, mp, col]) { if (!o) continue; o.position.sub(base0).applyQuaternion(q).add(base1); o.quaternion.premultiply(q); o.updateMatrix(); }
  tab.userData.moved = true; pr.updateMatrixWorld(true);
}
/* R: the Studio terrace stood empty once the map table (M1) and the igloo (L3) had left it. The bare pad is removed at runtime (mesh, lip, plateau anchor, so no road or
   fork sign leads to it; planet.glb is untouched). Runs after the table has moved and before the plateaus, roads and signposts read their anchors. */
function layoutStudioPad(pr) {
  for (const n of ["TERRACE_studio", "LIP_studio", "PLATEAU_studio"]) { const o = pr.getObjectByName(n); if (o) o.parent.remove(o); delete world.anchors[n]; }
}
function setupBores(pr, mr) {
  const specs = [[pr, "MECH_cannon_barrel", "MOUTH_CANNON_planet"], [mr, "CANNON_moon_barrel", "MOUTH_CANNON_moon"]];
  const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  for (const [root, bn, mn] of specs) {
    const bar = root.getObjectByName(bn), mouth = root.getObjectByName(mn);
    const body = bar && bar.children.find(c => c.isMesh && !c.userData.isOutline && c.name === bn + "_1");
    if (!body || !mouth || bar.userData.bore) continue;
    const g = body.geometry, pos = g.attributes.position, ax = mouth.position.clone().normalize();
    const T = new Float32Array(pos.count), R = new Float32Array(pos.count);
    let tmax = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), t = x * ax.x + y * ax.y + z * ax.z;
      T[i] = t; R[i] = Math.sqrt(Math.max(0, x * x + y * y + z * z - t * t)); if (t > tmax) tmax = t;
    }
    let fi = -1;
    for (let i = 0; i < pos.count; i++) if (R[i] < 1e-3 && T[i] > 0) fi = i;   // the muzzle floor's centre vertex (the other centre is the breech)
    if (fi < 0 || !g.index) continue;
    const tFloor = T[fi]; let rBore = 0;
    for (let i = 0; i < pos.count; i++) if (Math.abs(T[i] - tFloor) < 2e-3) rBore = Math.max(rBore, R[i]);
    const idx = g.index.array, keep = [];
    for (let i = 0; i < idx.length; i += 3) if (idx[i] !== fi && idx[i + 1] !== fi && idx[i + 2] !== fi) keep.push(idx[i], idx[i + 1], idx[i + 2]);
    g.setIndex(new THREE.BufferAttribute(new idx.constructor(keep), 1));
    if (g.boundsTree) g.boundsTree = null;
    // dark liner (open tube, seen from inside) and a plug at its bottom
    const Ll = BORE_DEPTH, rL = rBore * 0.994;
    const cg = new THREE.CylinderGeometry(rL, rL, Ll, 48, 8, true), cp = cg.attributes.position, col = new Float32Array(cp.count * 3);
    const cTop = new THREE.Color("#3a3c52"), cBot = new THREE.Color("#0b0c10"), tmp = new THREE.Color();
    for (let i = 0; i < cp.count; i++) { const f = (cp.getY(i) + Ll / 2) / Ll; tmp.copy(cBot).lerp(cTop, Math.pow(f, 1.6)); col.set([tmp.r, tmp.g, tmp.b], i * 3); }
    cg.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const liner = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
    liner.quaternion.setFromUnitVectors(Y, ax); liner.position.copy(ax).multiplyScalar(tFloor + 0.004 - Ll / 2);
    const plug = new THREE.Mesh(new THREE.CircleGeometry(rL, 48), new THREE.MeshBasicMaterial({ color: "#0b0c10" }));
    plug.quaternion.setFromUnitVectors(Z, ax); plug.position.copy(ax).multiplyScalar(tFloor + 0.004 - Ll);
    for (const m of [liner, plug]) { m.name = bn + "_bore"; m.castShadow = m.receiveShadow = false; m.userData.isOutline = true; m.raycast = () => {}; bar.add(m); }
    bar.userData.bore = { ax, tmax, tFloor, rBore, liner, plug };
  }
}

/* The crank wheel model sits half inside the cannon's base (its disc reaches 0.38 m into the dome),
   so it would cut through the orange base and carriage. It is moved out along its own axle so its inner face clears the
   dome by 0.04 m, and a short axle (the wheel's own ink material) runs from it back into the cheek, so it still
   reads as fixed to the carriage. The wheel turns about its local X, which is the axle: the disc is symmetric about
   it, so the clearance holds at every aim step. */
const WHEELS = [["MECH_cannon_wheel", 0.52, 0.07, 0.53], ["CANNON_moon_wheel", 0.52, 0.07, 0.53]];   // name, shift out (m), axle radius, axle length back into the cheek beyond the shift
function setupWheels(pr, mr) {
  for (const [wn, d, r, back] of WHEELS) {
    const w = (pr.getObjectByName(wn) || mr.getObjectByName(wn));
    if (!w || w.userData.shifted) continue;
    w.userData.shifted = d;
    w.position.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(w.quaternion), d);   // outward: +X of the wheel points away from the base
    const len = d + back, g = new THREE.CylinderGeometry(r, r, len, 16, 1, false);
    g.rotateZ(Math.PI / 2); g.translate(-len / 2, 0, 0);
    const axle = new THREE.Mesh(g, w.material);
    axle.name = wn + "_axle"; axle.castShadow = true; axle.userData.isOutline = true; axle.raycast = () => {};   // out of the camera occluders and soot lists
    w.add(axle);
  }
}

const _pq = new THREE.Matrix4(), _px = new THREE.Vector3(), _pz = new THREE.Vector3();
function poseQuat(U, F, out = new THREE.Quaternion()) {   // the same basis as Player.orient: -z is his face, y his up
  _pz.copy(F).negate(); _px.crossVectors(U, _pz).normalize(); _pz.crossVectors(_px, U);
  return out.setFromRotationMatrix(_pq.makeBasis(_px, U, _pz));
}

/* Looney Tunes: climb up to the muzzle, slide in feet first until his chest is out of the barrel (the
   classic circus act), hold and wave, sink in, the fuse fizzes, KA-BOOM, fly out sooty with a smoke trail,
   land in a dust cloud, shake the soot off. */
async function fire(name, barrelObj, from, to, land, landFwd, after) {
  if (state !== "play") return;
  state = "travel"; autoTarget = null; ui.prompt(null); ui.hideHint(); ui.closePanel();
  const mouthO = A("MOUTH_" + name), fuseO = A("FUSE_" + name);
  scene.updateMatrixWorld(true);
  const mouth = wpos(mouthO), pivot = wpos(barrelObj), fuseP = wpos(fuseO);
  const dir = mouth.clone().sub(pivot).normalize();
  const bore = barrelObj.userData.bore, moonAct = name === "CANNON_moon";
  const rim = bore ? pivot.clone().addScaledVector(dir, bore.tmax) : mouth.clone();
  // framing: from the side and a little in front of the muzzle, so the barrel reads in profile and his face is to the lens
  const up0 = player.up.clone(), dist0 = rig.distWanted;
  const dTan = dir.clone().addScaledVector(up0, -dir.dot(up0)); if (dTan.lengthSq() < 1e-4) dTan.copy(player.facing); dTan.normalize();
  // the barrel and its stand are not camera occluders during the act (the lens is beside them; the chest-high ray would start inside them and pull the lens in to 2 m)
  const camHid = rig.occluders.filter(o => /^(CANNON_|MECH_cannon)/.test(o.name)); rig.occluders = rig.occluders.filter(o => !camHid.includes(o));
  // ...and they never dither-fade during the act: the fade's rays to his feet (inside the barrel) hit the base on and off, so it would flicker as a pink slab
  camHid.forEach(o => (o.userData.noOccFade = true));
  const p0 = player.position.clone(), q0 = player.group.quaternion.clone();
  const hover = rim.clone().addScaledVector(dir, 0.34), root1 = rim.clone().addScaledVector(dir, -WAIST_Y);
  const rimDist = rim.distanceTo(pivot);
  // the climb: up beside the barrel to HOP_APEX over the rim, then over and down onto the muzzle (scripted, so the moon's
  // gravity plays no part and the move across never starts low, into the base)
  const hHover = hover.clone().sub(p0).dot(up0), apex = Math.max(hHover, rim.clone().sub(p0).dot(up0) + HOP_APEX);
  const across = hover.clone().sub(p0).addScaledVector(up0, -hHover);   // the ground-plane leg, p0 to under the hover point
  // a held side view of the whole cannon and his climb (a follow lens rides up with him, sweeps the world past and stops dead
  // when he settles on the muzzle); eased in at most 0.2 m a frame, handed back to the follow lens at the launch.
  // It stands on the follow lens's side of the barrel unless a prop (the moon's kiosk, a tree) hides him or the cannon from there.
  const lo = p0.clone().addScaledVector(up0, -0.2), hi = rim.clone().addScaledVector(up0, HOP_APEX + 1.75);
  const mid = lo.clone().lerp(hi, 0.5), span = hi.clone().sub(lo).dot(up0), off = across.length() + 0.6;
  const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), D = Math.max(span / 2 / tv, off / (tv * camera.aspect)) / 0.78;
  const dv = new THREE.Vector3(), seen = [p0.clone().addScaledVector(up0, 0.6), wpos(A(name + "_base")).lerp(pivot, 0.25), pivot, rim];   // his knees, the cannon's foot (the pivot stands 1.9 m over it), its pivot, the muzzle
  const view = sd => { const tc = sd.clone().multiplyScalar(0.9).addScaledVector(dTan, 0.44).normalize(); return { tc, f: mid.clone().addScaledVector(tc, D * Math.cos(0.1)).addScaledVector(up0, D * Math.sin(0.1)) }; };
  const blocked = f => seen.filter(q => { rig.ray.set(f, dv.subVectors(q, f).normalize()); rig.ray.far = f.distanceTo(q) - 0.3; return rig.ray.intersectObjects(rig.occluders, false).some(h => h.object.visible); }).length;
  const side = new THREE.Vector3().crossVectors(up0, dTan).normalize();
  if (side.dot(camera.position.clone().sub(mouth)) < 0) side.negate();
  let vw = view(side); { const v2 = view(side.clone().negate()); if (blocked(v2.f) < blocked(vw.f)) vw = v2; }
  const toCam = vw.tc, fPos = vw.f;
  const camFwd = toCam.clone().negate(), face = toCam.clone().addScaledVector(dir, -toCam.dot(dir)).normalize(), qEnd = poseQuat(dir, face);
  // the follow frame swings round at most 0.022 rad a frame toward the act's view, so the lens it gets back at the launch already looks along it
  const camTrack = () => { const a = rig.fwd.angleTo(camFwd); rig.fwd.lerp(camFwd, Math.min(0.08, 0.022 / Math.max(a, 1e-4))).normalize(); };
  rig.distWanted = ACT_DIST;
  // 1. climb up and hover over the muzzle, tipping upright along the barrel
  player.cinematic = true; player.play("Jump"); player.actPhase = "hop";
  if (moonAct) { suited = true; setHelmet(helmet, true); }   // on the moon the bubble is on from the climb (also when he came by the map), not only from the launch
  const cur = camera.position.clone(), look = rig.look.clone();
  const track = () => { camTrack(); cur.add(dv.subVectors(fPos, cur).multiplyScalar(0.07).clampLength(0, 0.2)); look.add(dv.subVectors(mid, look).multiplyScalar(0.08).clampLength(0, 0.12)); rig.focus(cur, look, up0); };
  // 2. then slide in feet first until the waist is at the rim: chest, head and antennae stay out. The slide starts at the
  // speed the hop's drop ended with (a cubic ease-out) and both run in one tween, so he falls into the barrel in one move
  const HOP_T = 0.8, SLIDE_T = 0.7;
  const vDrop = (apex - hHover) * Math.PI / 2 / ((1 - HOP_UP) * HOP_T), s0 = Math.min(3, vDrop * SLIDE_T / Math.max(1e-3, hover.distanceTo(root1)));
  await tween(HOP_T + SLIDE_T, kk => {
    track();
    const t = kk * (HOP_T + SLIDE_T);
    if (t >= HOP_T) {
      const k = (t - HOP_T) / SLIDE_T; player.actPhase = "slide";
      player.position.lerpVectors(hover, root1, s0 * k + (3 - 2 * s0) * k * k + (s0 - 2) * k * k * k);
      player.group.quaternion.copy(qEnd);
      return;
    }
    const k = t / HOP_T;
    const v = k < HOP_UP ? apex * Math.sin(k / HOP_UP * Math.PI / 2) : apex + (hHover - apex) * (1 - Math.cos((k - HOP_UP) / (1 - HOP_UP) * Math.PI / 2));
    player.position.copy(p0).addScaledVector(across, sm01((k - 0.15) / 0.6)).addScaledVector(up0, v);   // over the bore before he drops (a later cross clips the planet cannon's lip)
    player.group.quaternion.copy(q0).slerp(qEnd, sm01((k - 0.35) / 0.65));
  });
  // 3. hold a beat and wave (the pose stays half-in: no sinking); on the moon the bubble stays on, its collar just clear of the lip
  if (player.actions && player.actions.Wave) player.play("Wave");
  player.actPhase = "hold";
  await tween(0.8, track);
  // 4. the fuse fizzes towards the breech while he stays half-in; the barrel swells in anticipation and he rides the rim as it grows
  player.actPhase = "fuse";
  fx.spark(k => fuseP.clone().lerp(pivot, k), 1.3);
  await tween(1.3, k => {
    track();
    barrelObj.scale.set(1 + 0.08 * k + 0.03 * Math.sin(k * 40), 1 + 0.08 * k, 1 + 0.08 * k);
    player.position.copy(pivot).addScaledVector(dir, rimDist * (1 + 0.08 * k) - WAIST_Y);
  });
  // 5. KA-BOOM
  player.group.visible = false; player.actPhase = "boom";
  barrelObj.userData.kick = 1;
  sfx.play("cannon_fire");
  amb.breath();
  fx.boom(mouth, dir, camera);
  await tween(0.25, k => barrelObj.scale.set(1 + 0.25 * (1 - k), 1 - 0.18 * (1 - k), 1 + 0.25 * (1 - k)));
  barrelObj.scale.setScalar(1);
  // 6. out he flies: sooty, spinning, trailing smoke, bubble on
  player.group.visible = true; player.cinematic = false; setSoot(1);
  rig.distWanted = dist0; player.actPhase = "flight"; rig.release();
  rig.occluders.push(...camHid); camHid.forEach(o => (o.userData.noOccFade = false));
  suited = true; setHelmet(helmet, true);
  player.position.copy(mouth);
  const c1 = mouth.clone().addScaledVector(dir, 40).addScaledVector(from.up(mouth), 18);
  const c2 = land.clone().addScaledVector(to.up(land), 30);
  player.launch(new THREE.CubicBezierCurve3(mouth, c1, c2, land), 3.6, to, landFwd, async () => {
    fx.dust(player.position, player.up);
    sfx.play("land", { speed: 14 });
    if (moonAct) { suited = false; setHelmet(helmet, false, "pop"); fx.puff(player.position.clone().addScaledVector(player.up, 0.9), { size: 0.45, life: 0.5, grow: 2 }); }   // the bubble comes off with a small pop
    state = "play";
    await sleep(1.1);
    // 7. shake the soot off
    for (let i = 0; i < 6; i++) fx.puff(player.position.clone().addScaledVector(player.up, 0.8), { size: 0.35, life: 0.9, vel: new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3).addScaledVector(player.up, 2), grow: 2 });
    player.play("Cheer");
    await tween(0.5, k => setSoot(1 - k));
    after && after();
  });
}

let sootMats = null;
function setSoot(k) {
  if (!sootMats) {
    sootMats = [];
    player.figure.traverse(o => { if (o.isMesh && !o.userData.isOutline) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.color && !sootMats.some(x => x.m === m)) sootMats.push({ m, base: m.color.clone() }); }); });
  }
  const soot = new THREE.Color("#2A2830");
  sootMats.forEach(({ m, base }) => m.color.copy(base).lerp(soot, k * 0.88));
}
function cannonLabel() { return aim < AIM_STEPS ? `Turn the wheel (${aim + 1}/${AIM_STEPS})` : "Climb in"; }
/* K1: an in-world marker on the active cannon step. A cream hoop with an ink hull (two tones plus ink, no emissive, no
   halo, no transparency): round the crank wheel while the wheel is the step, round the muzzle once aimed. They live in
   the scene, follow the part's matrixWorld, and only show while Blip stands at the cannon spot in "play". */
let K1marks = null;
const _k1m = new THREE.Matrix4(), _k1q = new THREE.Quaternion(), _k1s = new THREE.Vector3(1, 1, 1), _k1z = new THREE.Vector3(0, 0, 1);
function K1build() {
  if (!barrel || !wheel) return null;
  const mk = (R, tube) => {
    const g = new THREE.TorusGeometry(R, tube, 10, 40), grp = new THREE.Group();
    const m = new THREE.Mesh(g, new THREE.MeshToonMaterial({ color: "#FFF1CE" })); m.castShadow = false;
    twoTone(m, () => true);
    grp.add(m, inkShell(g)); grp.visible = false; grp.matrixAutoUpdate = false; scene.add(grp);
    return grp;
  };
  const mouth = barrel.getObjectByName("MOUTH_CANNON_planet"), axis = mouth.position.clone().normalize();
  const wl = new THREE.Matrix4().makeRotationY(Math.PI / 2);   // torus axis Z -> the wheel's axle, local X
  const bl = new THREE.Matrix4().compose(mouth.position.clone().addScaledVector(axis, 0.65), _k1q.clone().setFromUnitVectors(_k1z, axis), _k1s);   // floats 0.65 m out past the mouth anchor, clear of the rim (muzzle radius 0.72)
  return { wheel: mk(0.78, 0.1), barrel: mk(0.95, 0.1), wl, bl };   // tube 0.1 m: a band about 11 px at the 16.25 m home camera
}
function K1update(atSpot, t) {
  if (!K1marks) K1marks = K1build();
  const K = K1marks; if (!K) return;
  const on = atSpot && state === "play", step = aim < AIM_STEPS ? "wheel" : "barrel";
  K.wheel.visible = on && step === "wheel"; K.barrel.visible = on && step === "barrel";
  const part = step === "wheel" ? wheel : barrel, grp = K[step];
  if (!grp.visible) return;
  part.updateWorldMatrix(true, false);
  _k1m.copy(part.matrixWorld).multiply(step === "wheel" ? K.wl : K.bl);
  grp.matrix.copy(_k1m).scale(_k1s.setScalar(1 + 0.05 * Math.sin(t * 5))); _k1s.set(1, 1, 1);
  grp.matrixWorldNeedsUpdate = true;
}

/* ------------------------------------------------------------ film stages
   Orchestrator and The bracket do it again are films: each stage has a big play button that
   opens the film in a player, and the film's cast hangs around the stage. */
const FILMS = { "orchestrator": "oySlLRl5EBI", "the-bracket": "M1nIsHUE6dg" };
function setupStages() {
  const pr = world.islands.planet.root;
  for (const id of Object.keys(FILMS)) {
    const play = A("PLAY_" + id), trig = pr.getObjectByName("TRIGGER_" + id);
    if (!play || !trig) continue;
    spots.push({ id: "play-" + id, kind: "play", pos: wpos(play), r: 2.4, body: "planet", label: "Roll the film", run: () => playFilm(id, trig), target: trig });
  }
  $("videoClose").onclick = closeVideo;
  $("video").addEventListener("click", e => { if (e.target.id === "video") closeVideo(); });
}
async function playFilm(id, trig) {
  const first = ui.discover(id); amb.select(id, { discover: first });
  if (first) celebrate();
  updateGoal();
  castCheer(id);
  if (trig) { const s0 = trig.scale.y; await tween(0.18, k => trig.scale.y = s0 * (1 - 0.18 * Math.sin(Math.PI * k))); }
  $("videoCaption").textContent = `${byId[id].name} — ${byId[id].myth}`;
  $("videoFrame").title = `Film: ${byId[id].name}`;
  $("videoFrame").src = `https://www.youtube-nocookie.com/embed/${FILMS[id]}?autoplay=1&rel=0&modestbranding=1`;
  if (!videoOpen) ui.rememberFocus("video");
  $("video").classList.add("open"); $("video").setAttribute("aria-hidden", "false");
  amb.reading("film", true);
  videoOpen = true; amb.duck(true);   // the film has its own soundtrack: the bed steps back ~9 dB
  ui.overlay("video", true); ui.focusInto($("videoClose"));   // Esc cannot reach us from inside the YouTube frame, so focus starts on Close
}
function closeVideo() {
  const was = videoOpen;
  if (videoOpen) amb.reading("film", false);
  $("video").classList.remove("open"); $("video").setAttribute("aria-hidden", "true");
  $("videoFrame").src = "about:blank"; videoOpen = false; amb.duck(false);
  ui.overlay("video", false); if (was) ui.restoreFocus("video");
}
let videoOpen = false;

/* the casts: rigid-part toy characters (cast.glb) with procedural idle motion; they cheer
   when the film starts or when you say hello */
const casts = {};
async function loadCast() {
  const load = url => new Promise(r => world.loader.load(url, r, undefined, () => r(null)));
  // tour.glb may not be built yet: ask first, so a missing file is one quiet 404 and never a
  // GLTFLoader parse error (the dev server answers 404 with an HTML page)
  const maybe = url => fetch(url, { method: "HEAD" }).then(res => res.ok ? load(url) : null, () => null);
  // each film family is its own rigged model (cave.glb, tour.glb); cast.glb's groups are the fallback
  const [g, cave, tour] = await Promise.all([load("assets/models/cast.glb"), load("assets/models/cave.glb"), maybe("assets/models/tour.glb")]);
  const rigged = { "orchestrator": cave, "the-bracket": tour };
  for (const [id, key, label] of [["orchestrator", "CAST_orchestrator", "Meet the locals"], ["the-bracket", "CAST_bracket", "Join the very serious tour"]]) {
    const r = rigged[id], src = r && r.scene.getObjectByName(key) ? r : g;
    if (!src) continue;
    const grp = src.scene.getObjectByName(key), spot = A("CAST_" + id + "_spot");
    if (!grp || !spot) continue;
    const holder = new THREE.Group();
    grp.position.set(0, 0, 0); grp.quaternion.identity();
    // footprint of every cast member in the group's own frame (y up), before it is placed
    grp.removeFromParent(); grp.updateMatrixWorld(true);
    const feet = [];
    // one collider per character (CHAR_caveman_1, CHAR_guide), not per part
    grp.traverse(o => { if (!/^CHAR_[a-z]+(_\d+)?$/i.test(o.name)) return; const b = new THREE.Box3().setFromObject(o), sz = b.getSize(new THREE.Vector3()); feet.push({ c: b.getCenter(new THREE.Vector3()).setY(0), r: THREE.MathUtils.clamp(Math.max(sz.x, sz.z) * 0.5, 0.3, 0.9) }); });
    holder.position.copy(wpos(spot)); holder.quaternion.copy(spot.getWorldQuaternion(new THREE.Quaternion()));
    holder.add(grp); scene.add(holder); holder.updateMatrixWorld(true);
    for (const f of feet) planet.colliders.push({ p: holder.localToWorld(f.c.clone()), r: f.r });   // nobody walks through the family
    const flame = o => /FIRE_flame/.test(o.name);
    // skinned members keep frustum culling (there are ~130), but their bound is the pose at first
    // use; the tour guide's arm swings ~0.25 m out of it. Pad it so neither the view nor the sun's
    // shadow pass culls a limb (or its shadow) that is really there.
    holder.traverse(o => { if (o.isMesh) { o.castShadow = !flame(o); o.receiveShadow = true; if (o.isSkinnedMesh) { o.computeBoundingSphere(); o.boundingSphere.radius += 0.5; } } });
    toonify(holder, { keep: flame });
    holder.traverse(o => { if (flame(o) && o.material) { o.material = o.material.clone(); o.material.toneMapped = false; } });
    // ink the silhouettes only: hulls round eyes, blush, mouths and the little decals (spots,
    // moss, carvings, log ends, embers) smudge the toy faces
    const decal = o => /Eye|Glint|Blush|Mouth|Nose|Ember|Spot|Carving|Moss|WoodEnd|Berry/.test(o.material && o.material.name);
    // CHAR_INK: near-field floor so the figures keep a line when walked up to (see toon.js minM)
    if (src === g) outline(holder, "#1E1F26", o => !flame(o), CHAR_INK);
    else outline(holder, "#1E1F26", o => !flame(o) && !decal(o), CHAR_INK);
    const chars = [];
    grp.traverse(o => {
      if (!/^CHAR_[a-z]+(_\d+)?$/i.test(o.name)) return;
      const tag = o.name.replace(/^CHAR_/, "") + "_";
      const clips = src.animations.filter(a => a.name.startsWith(tag));
      if (clips.length) {   // rigged: its own mixer, Idle always on, Cheer on a hello
        const mixer = new THREE.AnimationMixer(o), actions = {};
        for (const clip of clips) actions[clip.name.slice(tag.length)] = mixer.clipAction(clip);
        const eyes = []; o.traverse(x => { if (/_eye_[LR]$/.test(x.name)) { x.userData.s0 = x.scale.clone(); eyes.push(x); } });
        const ch = { o, mixer, actions, eyes, q0: o.quaternion.clone(), turn: 0, blink: 1 + Math.random() * 4, current: null };
        if (actions.Idle) { actions.Idle.play(); actions.Idle.time = Math.random() * actions.Idle.getClip().duration; ch.current = actions.Idle; }
        if (actions.Cheer) { actions.Cheer.setLoop(THREE.LoopOnce, 1); actions.Cheer.clampWhenFinished = true; }
        chars.push(ch);
        return;
      }
      const part = n => { let f = null; o.traverse(x => { if (!f && x !== o && x.name.startsWith(o.name.replace(/^CHAR_/, "")) && x.name.endsWith(n)) f = x; }); if (!f) o.traverse(x => { if (!f && x.name.endsWith(n)) f = x; }); return f; };
      const parts = { head: part("_head"), armL: part("_arm_L"), armR: part("_arm_R"), body: part("_body") };
      for (const k in parts) if (parts[k]) { parts[k].userData.q0 = parts[k].quaternion.clone(); parts[k].userData.p0 = parts[k].position.clone(); }
      chars.push({ o, ...parts, guide: /guide/i.test(o.name), phase: Math.random() * 6.28 });
    });
    const flames = []; grp.traverse(o => { if (/^FIRE_flame/.test(o.name)) { o.userData.s0 = o.scale.clone(); flames.push(o); } });
    // the campfire lights the cave walls (warm, flickering, no shadows)
    const fl = grp.getObjectByName("FIRE_light");
    let light = null;
    if (fl) { light = new THREE.PointLight("#FF9A4A", 9, 13, 1.4); fl.add(light); }
    // the lathed flames give way to drawn, cel-banded ones that always face the lens
    let fire = null;
    if (flames.length) {
      for (const f of flames) f.visible = false;
      fire = new Campfire(scene, holder.position.clone(), new THREE.Vector3(0, 1, 0).applyQuaternion(holder.quaternion), 0.8);   // the stage floor's up, not radial
    }
    casts[id] = { holder, chars, flames: fire ? [] : flames, fire, excite: 0, light, rigged: src !== g };
    // the spot is the middle of the group (the fire), which is solid: the trigger is a ring
    // 2.6 m out (just past the family's knees) reaching 2.4 m further, so it answers from
    // anywhere round them, the cave mouth included
    spots.push({ id: "cast-" + id, kind: "cast", pos: wpos(spot), core: 2.6, r: 5.0, body: "planet", label, run: () => castCheer(id, true), target: holder });
    planet.colliders.push({ p: wpos(spot), r: 2.0 });
    nearProps.push({ o: holder, hull: null, c: wpos(spot), r: 2.2 });
  }
}
const CAST_NAMES = { "orchestrator": "The tribe", "the-bracket": "The guide" };
const CAST_TOAST = new Set(["orchestrator"]);   // casts that speak through the toast, not an in-world slate
const CAST_LINES = {
  "orchestrator": ["The whole tribe waves. This is a big deal around here.", "The tribe approves. Ugg would like you to notice the very large screen.", "A friendly berry is offered. No one explains why."],
  "the-bracket": ["“And on your left, the third bullet. Its purpose remains a mystery.”", "“Please follow the blue flag. It has more authority than I do.”", "“Please don’t touch the slides. They’re emotionally fragile.”"],
};
function castCheer(id, talk) {
  const c = casts[id]; if (!c) return;
  c.excite = 1;
  // rigged casts: a ripple of hellos round the fire, each turning (a little) toward you
  c.chars.forEach((ch, i) => {
    if (!ch.mixer || !ch.actions.Cheer) return;
    sleep(0.12 * i).then(() => {
      const a = ch.actions.Cheer; a.reset().setEffectiveWeight(1).play();
      if (ch.current && ch.current !== a) ch.current.crossFadeTo(a, 0.2, false);
      ch.current = a; ch.turnUntil = a.getClip().duration - 0.35; ch.cheerT = 0;
    });
  });
  if (talk) {   // same order as the fauna: the cast's Cheer (and Blip's wave) plays out first, then the slate pops
    const L = CAST_LINES[id], at = wpos(c.holder), up = planet.up(at), html = L[(Math.random() * L.length) | 0];
    const cheer = Math.max(0, ...c.chars.map((ch, i) => ch.actions && ch.actions.Cheer ? 0.12 * i + ch.actions.Cheer.getClip().duration : 0));
    player.play("Wave");
    const t0 = flowClock; c.flow = { trickEnd: t0 + cheer, slateOpen: null };
    slate.hide();
    // the tribe sits under the cave roof, where a floating slate stands inside the rock: their line is the on-screen toast
    sleep(cheer + TRICK_TO_SLATE_S).then(() => { c.flow.slateOpen = flowClock; if (CAST_TOAST.has(id)) ui.toast(`<b>${CAST_NAMES[id]}</b> · ${html}`, 2600); else slate.say({ name: CAST_NAMES[id] || "", html, ms: 2600, base: () => at, up: () => up, top: c.holder }); });
  }
}
const _cq = new THREE.Quaternion(), _ax = new THREE.Vector3(1, 0, 0), _az = new THREE.Vector3(0, 0, 1), _ay = new THREE.Vector3(0, 1, 0);
function updateCasts(dt, t) {
  for (const c of Object.values(casts)) {
    c.excite = Math.max(0, c.excite - dt * 0.35);
    const e = c.excite;
    if (c.light) c.light.intensity = 9 * (0.85 + 0.1 * Math.sin(t * 17) + 0.07 * Math.sin(t * 29 + 1.3)) * (1 + e * 0.3);
    if (c.fire) c.fire.update(dt, t, camera, e, fx);
    c.flames.forEach((f, i) => {
      const k = 1 + 0.22 * Math.sin(t * 13 + i * 2.1) + 0.12 * Math.sin(t * 23 + i);
      f.scale.set(f.userData.s0.x * (1 + 0.1 * Math.sin(t * 9 + i)), f.userData.s0.y * k * (1 + e * 0.4), f.userData.s0.z * (1 + 0.1 * Math.cos(t * 8 + i)));
    });
    for (const ch of c.chars) {
      if (ch.mixer) { updateRigged(ch, dt); continue; }
      const ph = ch.phase, hop = e > 0.05 ? Math.abs(Math.sin(t * 9 + ph)) * 0.22 * e : 0;
      if (ch.body) { ch.body.position.copy(ch.body.userData.p0); ch.body.position.y += hop + Math.sin(t * 1.6 + ph) * 0.012; }
      if (ch.head) ch.head.quaternion.copy(ch.head.userData.q0).multiply(_cq.setFromAxisAngle(_ay, Math.sin(t * 0.7 + ph) * 0.25)).multiply(_cq.setFromAxisAngle(_ax, Math.sin(t * 1.9 + ph) * 0.06));
      const swing = (side) => Math.sin(t * (ch.guide ? 3.2 : 1.4) + ph + side) * (ch.guide && side > 0 ? 0.35 : 0.08) + e * 1.3 * (0.6 + 0.4 * Math.sin(t * 12 + ph + side));
      if (ch.armL) ch.armL.quaternion.copy(ch.armL.userData.q0).multiply(_cq.setFromAxisAngle(_az, -swing(0)));
      if (ch.armR) ch.armR.quaternion.copy(ch.armR.userData.q0).multiply(_cq.setFromAxisAngle(_az, swing(1)));
    }
  }
}

/* a rigged cast member: Idle loops; during a Cheer it turns up to 60 deg toward the visitor on
   its seat, then settles back and returns to Idle */
const _cv = new THREE.Vector3();
function updateRigged(ch, dt) {
  const cheering = ch.current === ch.actions.Cheer;
  if (cheering) {
    ch.cheerT += dt;
    if (ch.cheerT >= ch.actions.Cheer.getClip().duration) {
      const idle = ch.actions.Idle; idle.reset().play(); ch.current.crossFadeTo(idle, 0.3, false); ch.current = idle;
    }
  }
  ch.turn = THREE.MathUtils.damp(ch.turn, cheering && ch.cheerT < ch.turnUntil ? 1 : 0, 5, dt);
  ch.o.quaternion.copy(ch.q0);
  if (ch.turn > 1e-3) {
    // the visitor in the cast's own frame (y up); the character faces its local -z
    ch.o.parent.worldToLocal(_cv.copy(player.position)).sub(ch.o.position);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ch.q0);
    let d = Math.atan2(-_cv.x, -_cv.z) - Math.atan2(-fwd.x, -fwd.z);
    d = Math.atan2(Math.sin(d), Math.cos(d));
    ch.o.quaternion.premultiply(_cq.setFromAxisAngle(_ay, THREE.MathUtils.clamp(d, -1.05, 1.05) * ch.turn));
  }
  for (const e of ch.eyes) e.scale.copy(e.userData.s0);
  ch.mixer.update(dt);
  ch.blink -= dt;
  if (ch.blink < 0) ch.blink = 2.5 + Math.random() * 3.5;
  if (ch.blink < 0.12) for (const e of ch.eyes) e.scale.y *= 0.15;
}

/* open, level ground: every point within `rad` of q (the reach of a signpost's planks) is
   plain planet surface, off every terrace and its skirt, clear of ponds, props and spots */
function clearGround(q, rad) {
  const up = planet.up(q), t = new THREE.Vector3(1, 0, 0).cross(up);
  if (t.lengthSq() < 0.01) t.set(0, 0, 1).cross(up);
  t.normalize();
  for (const r of [0, rad * 0.5, rad]) for (let k = 0; k < (r ? 16 : 1); k++) {
    const p = q.clone().addScaledVector(t.clone().applyAxisAngle(up, k * Math.PI / 8), r);
    const d = p.clone().sub(planet.centre).normalize();
    if (planet.surface(d) > planet.R + 0.02) return false;
  }
  for (const [name, a] of Object.entries(world.anchors)) if (name.startsWith("POND_") && /^POND_\d+$/.test(name) && wpos(a).distanceTo(q) < (a.userData.r || 3) + rad) return false;
  if (planet.colliders.some(c => c.p.distanceTo(q) < c.r + Math.min(rad, 1.6))) return false;   // planks ride above bushes
  if (spots.some(s => s.body === "planet" && s.pos.distanceTo(q) < 3.2)) return false;
  return !Object.entries(world.anchors).some(([name, a]) => name.startsWith("BENCHSPOT_") && wpos(a).distanceTo(q) < rad + 1.2);
}
/* the closest point to `q` (spiralling out on the surface) that passes `ok` */
function nearestClear(q, ok, rMax = 9) {
  const up = planet.up(q), t = new THREE.Vector3(1, 0, 0).cross(up).normalize();
  if (ok(q)) return q;
  for (let r = 0.6; r <= rMax; r += 0.6) for (let k = 0; k < 24; k++) {
    const p = q.clone().addScaledVector(t.clone().applyAxisAngle(up, k * Math.PI / 12), r);
    const d = p.clone().sub(planet.centre).normalize(), g = planet.centre.clone().addScaledVector(d, planet.surface(d));
    if (ok(g)) return g;
  }
  return null;
}

/* ------------------------------------------------------------ signposts
   One post wherever a visitor picks a way: by the spawn, and at each terrace a road carries on past (the lookout on to
   Field, the cannon terrace on to GenAI After Hours, the studio on to the cave, the engraver on to the bracket), plus the
   cave approach at the far end of the studio road. A fork's post stands beside the onward road just past the terrace's
   foot, off the road, on level ground clear of props, at least SIGN_GAP from every other post. Its arms point at the
   onward place first, then back the way you came, then home to the summit, then the nearest other place. */
const signPosts = [];
const SIGN_GAP = 12;
const SIGN_FORKS = [
  { at: "monument", on: "field", to: ["field", "monument", "pin-art"] },
  { at: "cannon", on: "genai-after-hours", to: ["genai-after-hours", "cannon", "pin-art"] },
  { at: "studio", on: "orchestrator", to: ["play-orchestrator", "map", "pin-art"] },
  { at: "engraver", on: "the-bracket", to: ["play-the-bracket", "engraver", "pin-art"] },
  { at: "orchestrator", on: "studio", to: ["play-orchestrator", "map", "play-the-bracket"] },
];
function setupSigns() {
  const S = id => spots.find(x => x.id === id);
  const dest = [
    ...GAMES.map(id => ({ id, label: byId[id].name, pos: S(id) && S(id).pos })),
    { id: "cannon", label: "Old cannon", pos: S("cannon").pos }, { id: "map", label: "Studio & map", pos: S("map").pos },
    { id: "monument", label: "Lookout tower", pos: wpos(A("PLATEAU_monument")) },
    { id: "play-orchestrator", label: "Orchestrator", pos: S("play-orchestrator") && S("play-orchestrator").pos },
    { id: "play-the-bracket", label: "The bracket", pos: S("play-the-bracket") && S("play-the-bracket").pos },
    { id: "field", label: "Field", pos: S("field").pos }, { id: "genai-after-hours", label: "GenAI After Hours", pos: S("genai-after-hours").pos },
  ].filter(d => d.pos);
  const places = [];   // [{ q, to }]
  const props = [];   // [point, clearance]: the planks stay out of canopies and off bushes and mushrooms
  world.islands.planet.root.traverse(o => { if (!o.isMesh && /^TREE_\d+$/.test(o.name)) props.push([wpos(o), 4.2]); else if (o.isMesh && /^(BUSH|SHROOM)_\d+$/.test(o.name)) props.push([wpos(o), 2.8]); });
  const ok = q => {
    const d = q.clone().sub(planet.centre).normalize();
    return roadDistance(d, groundU) > 2.3 && props.every(([p, r]) => p.distanceTo(q) > r) && places.every(p => p.q.distanceTo(q) >= SIGN_GAP) && clearGround(q, 2.7);
  };
  const sp = wpos(A("SPAWN")), f = wfwd(A("SPAWN")), right = f.clone().cross(planet.up(sp)).normalize();
  const spawnSign = sp.clone().addScaledVector(right, 2.8).addScaledVector(f, -1.5);
  places.push({ q: nearestClear(spawnSign, ok) || spawnSign, to: [] });
  for (const fork of SIGN_FORKS) {
    const J = A("PLATEAU_" + fork.at), D = A("PLATEAU_" + fork.on); if (!J || !D) continue;
    const a = wpos(J).sub(planet.centre).normalize(), b = wpos(D).sub(planet.centre).normalize();
    const foot = planet.plateaus.reduce((m, p) => (p.n.angleTo(a) < m.n.angleTo(a) ? p : m)).t1;
    const span = a.angleTo(b), side = a.clone().cross(b).normalize();
    // along the onward road from the terrace's foot outward, either side of it, nearest first
    search: for (const along of [3.5, 5, 6.5, 8, 10, 12]) for (const off of [3.0, -3.0, 4.0, -4.0, 5.2, -5.2]) {
      const d = a.clone().applyAxisAngle(side, Math.min(span, foot + along / planet.R)).addScaledVector(side, off / planet.R).normalize();
      const q = planet.centre.clone().addScaledVector(d, planet.R);
      if (ok(q)) { places.push({ q, to: fork.to }); break search; }
    }
  }
  for (const { q: p, to } of places) {
    const d = p.clone().sub(planet.centre).normalize();
    const pos = planet.centre.clone().addScaledVector(d, planet.surface(d));
    const near = dest.filter(x => x.pos.distanceTo(pos) > 7 && !to.includes(x.id)).sort((a, b) => a.pos.distanceTo(pos) - b.pos.distanceTo(pos));
    const targets = [...to.map(id => dest.find(x => x.id === id)).filter(Boolean), ...near];
    const sign = makeSignpost(scene, pos, planet.normal(d), targets, toonify, outline);
    signPosts.push(pos);
    planet.colliders.push({ p: pos, r: 0.35 });
    // the lens stops in front of a signpost rather than sweeping through it, and the sign
    // steps aside (like trees) if the camera ends up right next to it
    sign.traverse(o => { if (o.isMesh && !o.userData.isOutline && !o.material.isMeshBasicMaterial) { o.geometry.computeBoundsTree(); rig.occluders.push(o); } });
    nearProps.push({ o: sign, hull: null, c: pos.clone().addScaledVector(d, 1.8), r: 1.7 });
  }
}

/* ------------------------------------------------------------ monument + secrets */
let slabs = [];
const SIGNAL = new THREE.Color("#2B2BEE"), SLIME = new THREE.Color("#E2FA9E");
function setupMonument(pr) {
  slabs = PROJECTS.map((p, i) => {
    const m = pr.getObjectByName("HUB_slab_" + String(i + 1).padStart(2, "0"));
    if (!m) return null;
    m.material = m.material.clone(); m.userData.base = m.material.color.clone(); m.userData.lit = ui.found.has(p.id) ? 1 : 0;
    return m;
  });
}
function updateSlabs(dt) {
  slabs.forEach((m, i) => { if (!m) return; m.userData.lit = THREE.MathUtils.damp(m.userData.lit, ui.found.has(PROJECTS[i].id) ? 1 : 0, 2.5, dt); m.material.color.copy(m.userData.base).lerp(SIGNAL, m.userData.lit); });
}
let secretGlyph, topGlyph;
function setupSecret() {
  const top = A("SECRET_top");
  if (top) {
    const tok = world.shared.getObjectByName("Token").clone();
    tok.material = new THREE.MeshToonMaterial({ color: "#2B2BEE" });
    tok.position.copy(wpos(top)); scene.add(tok); topGlyph = tok;
    tok.visible = false;   // the stray blue hex on the lookout deck (shared-assets "Token" at SECRET_top) is hidden; the spot still works
    spots.push({ id: "secret-top", kind: "secret", pos: wpos(top), r: 2.2, body: "planet", label: "Admire everything", target: tok,
      run: () => { if (ui.findSecret("top", "You took the stairs. Respect.")) { for (let i = 0; i < 10; i++) fx.puff(wpos(top), { size: 0.3, color: new THREE.Color(["#FFC845", "#FF7A62", "#B9A2F2", "#7ED6B2"][i % 4]), life: 1.2, vel: new THREE.Vector3((Math.random() - 0.5) * 6, 3 + Math.random() * 3, (Math.random() - 0.5) * 6), grow: 1 }); player.play("Cheer"); } rig.distWanted = 20; } });
  }
  const s = A("SECRET_ascii"); if (!s) return;
  secretGlyph = world.shared.getObjectByName("Token").clone();
  secretGlyph.material = new THREE.MeshToonMaterial({ color: "#1E1F26" });
  /* the SECRET_ascii anchor sits behind the Pin Art board, out of reach, so the token hovers on the
     open grass by the first pond bench (the same 1.2 m above the ground as before, turned to the local up). */
  const asciiGround = planet.centre.clone().add(new THREE.Vector3(-18.22, 1.48, -23.79).sub(planet.centre).setLength(planet.R)), asciiUp = planet.up(asciiGround);
  const asciiAt = asciiGround.clone().addScaledVector(asciiUp, 1.2);
  secretGlyph.position.copy(asciiAt); secretGlyph.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), asciiUp); scene.add(secretGlyph);
  spots.push({ id: "secret", kind: "secret", pos: asciiGround, r: 2.0, body: "planet", label: "Take a peek", run: () => { ascii.trigger(14); ui.findSecret("ascii", "Reality has switched to text mode."); }, target: secretGlyph });
}
const ripple = (() => {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 96), new THREE.MeshBasicMaterial({ color: "#2B2BEE", transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  m.renderOrder = 3; scene.add(m); return { mesh: m, t: 1 };
})();
function celebrate() {
  ripple.mesh.position.copy(player.position).addScaledVector(player.viewUp, 0.08);
  ripple.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), player.viewUp);
  ripple.t = 0;
}

/* ------------------------------------------------------------ goals
   Projects first. The moon is never the opening ask: it is revealed from the lookout
   tower (climb it and you see the moon, then the cannon becomes the goal). */
let goalSpot = null;
function updateGoal() {
  if (!player) return;
  const f = ui.found, S = id => spots.find(s => s.id === id);
  const steps = [
    ["pin-art", "Find the giant pinscreen. <b>Poke it.</b> It can take it."],
    ["gravity-pong", "Yellow court, blue ring. <b>Bend a shot</b> and blame gravity if you miss."],
    ["brand-studio", "Find the hay.ag billboard and <b>make the mark</b>. No design degree required."],
    ["engraver", "At the peach terrace, <b>turn the dial</b>. There’s an image in there somewhere."],
    ["field", "Find the teal <b>Field kiosk</b>. The pixels are feeling interactive."],
    ["genai-after-hours", "Find <b>GenAI After Hours</b> at its kiosk. AI, but after office hours."],
    ["orchestrator", "Visit the <b>cave</b>. The family has made a film. Be polite."],
    ["the-bracket", "Find the <b>gallery tour</b> down south. Serious art, unserious people."],
    ["sea-ai-maturity", "Find the AI Momentum to Value <b>hive</b> and step on its five numbered pads."],
  ];
  const moonSteps = () => {
    if (aim < AIM_STEPS) return ["Find the old <b>cannon</b>. Point it at the moon. Try not to overthink it.", S("cannon")];
    if (player.body !== moon) return ["Get into the <b>cannon</b>. Yes, you are the ammunition.", S("cannon")];
    return ["One last screen. On the <b>moon</b>. Naturally.", S("artboard-42")];
  };
  let html, next = steps.find(([id]) => !f.has(id));
  const moonOpen = ui.puzzles.sawMoon && !f.has("artboard-42");
  if (moonOpen && (player.body === moon || aim > 0 || !next || ui.puzzles.moonFirst)) [html, goalSpot] = moonSteps();
  else if (next) { html = next[1]; goalSpot = S(next[0]); }
  else if (!f.has("artboard-42")) { html = "Climb to the <b>lookout</b>. There’s something up there worth seeing."; goalSpot = S("secret-top"); }
  else { html = `All ${PROJECTS.length} found. You’ve seen the lot. Go sit somewhere. You’ve earned it.`; goalSpot = null; }
  ui.goal(state === "intro" ? null : html);
  drawMapTable();
}
// standing on the lookout reveals the moon (once)
function checkLookout() {
  if (ui.puzzles.sawMoon || player.body !== planet || !lookoutTop) return;
  if (player.position.distanceTo(lookoutTop) > 5) return;
  const d = player.position.clone().sub(planet.centre), h = d.length() - planet.surface(d.normalize());
  if (h < 6.4) return;
  ui.puzzles.sawMoon = true; ui.puzzles.moonFirst = true; ui.save();
  ui.toast("Well, there’s <b>the moon</b>. And that cannon down there is pointing at absolutely nothing. For now.", 6000);
  // turn the lens toward the moon so the nudge is something you can see
  const toMoon = moon.centre.clone().sub(player.position); toMoon.addScaledVector(player.up, -toMoon.dot(player.up));
  if (toMoon.lengthSq() > 1e-4) rig.fwd.copy(toMoon.normalize());
  rig.pitch = 0.12; rig.distWanted = 19.5;
  sleep(7).then(() => { if (rig.distWanted === 19.5) { rig.distWanted = rig.home; rig.pitch = rig.homePitch; } });   // ease back to the usual framing
  updateGoal();
}
let lookoutTop = null, moonFlag = null;

/* ------------------------------------------------------------ the studio: house sign + map table */
let mapFace = null, mapFound = -1;
function setupStudio(pr) {
  const nm = pr.getObjectByName("STUDIO_name"), house = pr.getObjectByName("STUDIO_house");
  if (nm) nm.visible = false;   // the 3D "Anshul Patria" name board stays hidden; AP stands in its place (ap.js)
  if (house) installAP({ scene, loader: world.loader, house, toonify, outline, charInk: CHAR_INK, tween, sleep, slate, player, sfx, rig, fx, state: () => ({ moonFound: ui.found.has("artboard-42"), allFound: ui.allFound, butterflies: butterflies ? { got: butterflies.collected, total: butterflies.total } : null }) }).then(ap => {
    if (!ap) return;
    window.__ap = ap;   // test hook (also reachable as __archipelago.ap)
    spots.push({ id: "ap-door", kind: "ap", pos: ap.knockSpot(), r: 1.8, body: "planet", label: "Knock, knock", run: () => ap.knock(), target: house, off: () => ap.busy });
  }).catch(e => console.error("AP", e));
  const table = pr.getObjectByName("STUDIO_maptable");
  if (table) {
    // the model's table is inked black: make it a wooden drum table with a parchment map laid on top
    table.material = table.material.clone(); table.material.color = new THREE.Color("#B07A5A");
    mapFace = new THREE.Mesh(new THREE.CircleGeometry(1.14, 64), new THREE.MeshToonMaterial({ color: "#FFFFFF", gradientMap: table.material.gradientMap }));
    mapFace.position.y = 1.012; mapFace.rotation.x = -Math.PI / 2; mapFace.receiveShadow = true;
    table.add(mapFace);
  }
}
/* M2: once the board exists (built lazily when the player first comes within ~15 m of the table, or on the first map
   open), the table top shows a baked snapshot of its northern face, re-rendered once per discovery. The flat painting
   below stays only as the fallback (no WebGL, or the board not built yet). Everything hangs off mapFace, which is a
   child of the table object, so moving the table moves this too. */
let mapSnapFound = -1;
function ensureBoardMap() {
  if (boardMap) return boardMap;
  try { boardMap = createBoardMap({ world, bodies, games, spots, player, groundU, renderer, stage: $("mapStage"), pinsEl: $("mapPins") }); ui.board = boardMap; }
  catch (e) { console.error("board map failed", e); }
  return boardMap;
}
function snapMapTable() {
  if (!mapFace || !boardMap || !boardMap.snapshot || mapSnapFound === ui.found.size || ui.mapOpen) return false;
  const snap = boardMap.snapshot(768, ui.found);
  if (!snap) return false;
  mapSnapFound = ui.found.size;
  const S = 768, cv = document.createElement("canvas"); cv.width = cv.height = S;
  const g = cv.getContext("2d");
  g.fillStyle = "#B07A5A"; g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, 7); g.fill();   // the drum's wood shows round the coin
  g.save(); g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, 7); g.clip(); g.drawImage(snap, 0, 0, S, S); g.restore();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (mapFace.material.map) mapFace.material.map.dispose();
  mapFace.material.map = t; mapFace.material.needsUpdate = true;
  return true;
}
/* the board is built and the first snapshot taken at boot, behind the loading screen (bootMapTable). A discovery only marks the
   snapshot stale; mapTableTick re-renders it the next time a panel, slate or the map is up, never mid-walk. */
let mapTick = 0;
function bootMapTable() {
  if (!mapFace) return;
  ensureBoardMap(); snapMapTable();
}
function mapTableTick() {   // every 15th frame; cheap unless the snapshot is stale and a panel or slate covers the refresh
  if (!mapFace || !boardMap || mapSnapFound === ui.found.size || ++mapTick % 15) return;
  if (state === "play" && !focused && !slate.active && !seated) return;
  snapMapTable();
}
function drawMapTable() {
  if (!mapFace) return;
  if (boardMap && boardMap.snapshot) return;   // the 3D snapshot owns the top: stale until the tick refreshes it
  if (mapFound === ui.found.size) return;
  mapFound = ui.found.size;
  const S = 1024, cv = document.createElement("canvas"); cv.width = cv.height = S;
  const g = cv.getContext("2d");
  const grd = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S / 2);
  grd.addColorStop(0, "#FBF0D9"); grd.addColorStop(1, "#E7CB98");
  g.fillStyle = grd; g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, 7); g.fill();
  g.strokeStyle = "#7A4B33"; g.lineWidth = 12; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 12, 0, 7); g.stroke();
  g.lineWidth = 3; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 34, 0, 7); g.stroke();
  const k = 4.4, X = x => S / 2 + x * k, Y = y => S / 2 + (y + 18) * k;
  g.textAlign = "center"; g.textBaseline = "middle";
  for (const [cx, name] of [[-48, "North"], [48, "South"]]) {
    g.fillStyle = "#BFE0B4"; g.strokeStyle = "#5B4030"; g.lineWidth = 5;
    g.beginPath(); g.arc(X(cx), Y(10), 44 * k, 0, 7); g.fill(); g.stroke();
    g.fillStyle = "#5B4030"; g.font = '600 30px "Instrument Sans"'; g.fillText(name.toUpperCase(), X(cx), Y(59));
  }
  g.fillStyle = "#E4DDF2"; g.strokeStyle = "#5B4030"; g.lineWidth = 4;
  g.beginPath(); g.arc(X(0), Y(-88), 14 * k, 0, 7); g.fill(); g.stroke();
  g.fillStyle = "#5B4030"; g.font = '600 26px "Instrument Sans"'; g.fillText("MOON", X(0), Y(-88));
  g.font = '700 54px "Bricolage Grotesque"'; g.fillText("Small Planet", X(-58), Y(-76));
  // compass rose
  const cx = X(62), cy = Y(-80);
  g.fillStyle = "#7A4B33";
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; g.beginPath(); g.moveTo(cx + Math.sin(a) * 60, cy - Math.cos(a) * 60); g.lineTo(cx + Math.sin(a + 0.6) * 14, cy - Math.cos(a + 0.6) * 14); g.lineTo(cx + Math.sin(a - 0.6) * 14, cy - Math.cos(a - 0.6) * 14); g.fill(); }
  g.font = '700 24px "Bricolage Grotesque"'; g.fillText("N", cx, cy - 78);
  // places: blue once found, ink while still to find
  g.font = '600 21px "Instrument Sans"';
  for (const d of destinations()) {
    if (d.svg.y < -70) continue;
    const px = X(d.svg.x), py = Y(d.svg.y), found = d.project && ui.found.has(d.project);
    g.fillStyle = found ? "#2B2BEE" : "#3A2418";
    g.beginPath(); g.arc(px, py, d.size * 1.6, 0, 7); g.fill();
    g.fillText(d.label, px, py + d.size * 1.6 + 16, 210);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (mapFace.material.map) mapFace.material.map.dispose();
  mapFace.material.map = t; mapFace.material.needsUpdate = true;
}

/* ------------------------------------------------------------ ponds, birds, butterflies */
let birds, butterflies;
/* where the wild butterflies live (life.js places them, seeded): the ponds, the trees, and four
   harder spots -- the lookout's top deck (up the spiral stair), the cannon terrace's rim, the cave
   mouth (outside the wall ring, where Chomp's path runs) and the moon (by the landing deck) */
function butterflyPlaces(pr) {
  const ponds = [], trees = new Map(), q = new THREE.Vector3();
  for (const [name, a] of Object.entries(world.anchors)) if (/^POND_\d+$/.test(name)) ponds.push({ c: wpos(a), r: a.userData.r || 3 });
  pr.traverse(o => { const m = o.isMesh && /^TREE[^.]*?(\d+)/.exec(o.name); if (m && !trees.has(m[0])) trees.set(m[0], wpos(o)); });
  const ok = d => {
    q.copy(planet.centre).addScaledVector(d, planet.R);
    if (ponds.some(p => p.c.distanceTo(q) < p.r + 1)) return false;
    if (planet.colliders.some(c => c.p.distanceTo(q) < c.r + 0.6)) return false;
    return !Object.keys(world.anchors).some(n => n.startsWith("BENCHSPOT_") && wpos(A(n)).distanceTo(q) < 2);
  };
  const hard = [];
  const top = A("SECRET_top"), deck = pr.getObjectByName("LOOKOUT");
  if (top && deck) {   // drop onto the deck 1.4 m off the centre, so it sits on the floor Blip stands on
    const up = planet.up(wpos(top)), side = new THREE.Vector3(1, 0, 0).cross(up).normalize();
    const from = wpos(top).addScaledVector(side, 1.4).addScaledVector(up, 3);
    const hit = new THREE.Raycaster(from, up.clone().negate(), 0, 12).intersectObject(deck, false)[0];
    if (hit) hard.push({ id: "lookout", pos: hit.point, body: planet, rest: true });
  }
  const cannon = planet.plateaus.find(p => A("PLATEAU_cannon") && p.n.angleTo(wpos(A("PLATEAU_cannon")).sub(planet.centre).normalize()) < 0.01);
  if (cannon) {   // on the flat top, 0.5 m in from where the terrace's skirt drops away
    const t = new THREE.Vector3(1, 0, 0).cross(cannon.n).normalize(), ang = cannon.t0 - 0.5 / cannon.rp;
    const d = cannon.n.clone().applyAxisAngle(t, ang);
    hard.push({ id: "terrace", pos: planet.centre.clone().addScaledVector(d, planet.surface(d)), body: planet, rest: true });
  }
  const shell = A("CAVE_shell");
  if (shell) {
    const c = wpos(shell), up = planet.up(c), out = new THREE.Vector3(); let reach = 0, n = 0;
    for (const [name, a] of Object.entries(world.anchors)) if (/^COL_cave_\d+$/.test(name)) { const d = wpos(a).sub(c); d.addScaledVector(up, -d.dot(up)); reach += d.length(); n++; out.sub(d.normalize()); }
    if (n) { const p = c.addScaledVector(out.normalize(), reach / n + 1.0).sub(planet.centre).normalize(); hard.push({ id: "cave", pos: planet.centre.clone().addScaledVector(p, planet.surface(p)), body: planet, rest: false }); }
  }
  const land = A("LAND_moon");
  if (land) {
    const p = wpos(land), up = moon.up(p), side = new THREE.Vector3(0, 0, 1).cross(up).normalize();
    const d = p.addScaledVector(side, 3.5).sub(moon.centre).normalize();
    hard.push({ id: "moon", pos: moon.centre.clone().addScaledVector(d, moon.surface(d)), body: moon, rest: false });
  }
  return { planet, moon, ok, ponds, trees: [...trees.values()], hard, wild: 20, saved: ui.puzzles.butterflies || [] };
}
const waters = [], pondList = [];
let pondWater = null;
function setupPonds(pr) {
  for (let i = 0; i < 8; i++) {
    const w = pr.getObjectByName(`POND_${i}_water`), a = A(`POND_${i}`);
    if (!w || !a) continue;
    const m = waterMaterial(sky.sunDir);
    m.uniforms.uCentre.value.copy(wpos(a)); m.uniforms.uR.value = a.userData.r || 3;
    w.material = m; w.castShadow = false; w.receiveShadow = false;
    waters.push(m);
    pondList.push({ c: wpos(a), r: a.userData.r || 3, water: m, lilies: pr.getObjectByName(`POND_${i}_lilies`) });
  }
  // ripple rings, lily bob, landing splash (water.js)
  pondWater = new PondWater(pondList, { origin: planet.centre, fx, body: planet });
  scene.userData.pondWater = pondWater;   // test hook (tests read the ring buffers)
  lookoutTop = A("SECRET_top") ? wpos(A("SECRET_top")) : null;
  // cattails in natural clumps round each rim, off the bench wedge and every spot (reeds.js)
  scene.userData.reeds = buildReeds(pr, { centre: planet.centre, R: planet.R, anchors: world.anchors, wpos,
    avoid: w => spots.some(sp => sp.body === "planet" && sp.pos.distanceTo(w) < Math.min(sp.r || 2, 3) + 0.4) || planet.colliders.some(cl => !cl.wade && cl.p.distanceTo(w) < cl.r + 0.4) });
  for (const m of scene.userData.reeds.meshes) outline(m, "#1E1F26");   // built after the planet's ink pass: ink them here
}

/* ------------------------------------------------------------ fauna (tips and stories) + benches */
/* L1: Pin Art's and Lumen's prompt circles grow from 2.8 m to 3.1 m, and Lumen stands at least L1_APART m (centre to centre) from Pin Art's prompt point,
   on the terrace top (more than the 6.2 m the radii add up to), so their triggers never overlap. L5: only Gulp turns to look at you from L5_GULP_LOOK m (the others keep 9 m) */
const L1_PIN_R = 4.5, L1_LUMEN_R = 3.1, L1_APART = 6.4, L5_GULP_LOOK = 16;
function l1Apart() {   // Lumen's keep-out list: Pin Art's prompt point (L1_APART m), and the ground just past the terrace lip (a spot there hides behind the lip from the spawn side)
  const pin = A("GAME_pin-art"), pl = A("PLATEAU_pin-art"), keep = [[pin.localToWorld(new THREE.Vector3(0, 0, 4)), L1_APART]];
  const c = wpos(pl), n = c.clone().sub(planet.centre).normalize(), t = new THREE.Vector3(1, 0, 0).cross(n).normalize(), ang = (pl.userData.t1 * planet.R + 1.6) / planet.R;
  for (let k = 0; k < 48; k++) keep.push([planet.centre.clone().addScaledVector(n.clone().multiplyScalar(Math.cos(ang)).addScaledVector(t.clone().applyAxisAngle(n, k * Math.PI / 24), Math.sin(ang)), planet.R), 2.0]);
  return keep;
}
/* creature lines that name a control pick the visitor's input at talk time (talk() calls a line that is a function) */
const anyKey = () => input.usingPad ? "Any button" : "Any key";
const byInput = (key, touch, pad) => () => input.usingPad ? (pad || touch) : isTouch ? touch : key;
const FAUNA = [
  { key: "FAUNA_hammer", name: "Lumen", near: "SPAWN", foot: 0.8, open: true, apart: true, trick: trickLumen,   // open: a spot the touch shot can see from every side (not hemmed in by the pin wall and fence)
    beats: { touchOn: 1.14, touchOff: 1.94 }, lines: [
    byInput("New here? <b>WASD</b> to walk, drag to look, <b>E</b> to poke anything with a prompt. Please poke responsibly.",
      "New here? The stick walks, a drag looks around, and the big round button pokes anything with a prompt. Please poke responsibly.",
      "New here? Left stick walks, right stick looks, <b>A</b> pokes anything with a prompt. Please poke responsibly."),
    byInput("Lost already? <b>M</b> opens the map. There’s also a round map table by the Pin Art gate. Two maps. Luxury.",
      "Lost already? The menu has a map. There’s also a round map table by the Pin Art gate. Two maps. Luxury.",
      "Lost already? <b>Back</b> opens the map. There’s also a round map table by the Pin Art gate. Two maps. Luxury."),
    "Ten projects live here. Nine on the planet, one floating overhead. Look up.",
    "Not in a walking mood? Open <b>Menu → All the projects</b>. No judgment. Much." ] },
  { key: "FAUNA_stilts", name: "Tall Sid", near: "PLATEAU_monument", foot: 0.7, rMin: 5, benchGap: 6.2, trick: trickSid,   // benchGap: Sid's 2.8 m prompt stays clear of the monument bench's 2 m one
    beats: { pointOn: 2.86, pointOff: 3.7 }, lines: [
    "That staircase? All the way up. Glowing disc at the top. Best view on the planet. I checked.",
    "Every project you discover turns another white step blue. The stairs are keeping score.",
    byInput("Psst. Click the blue ring above the lookout. Three times.", "Psst. Tap the blue ring above the lookout. Three times.") ] },
  { key: "FAUNA_ring", name: "Gulp", near: "POND_0", foot: 0.8, gulp: true, trick: trickGulp,
    beats: { reach: 0.53, close: 0.635, release: 0.4 }, lines: [
    byInput("The benches are for sitting, not decoration. <b>E</b> to test one. Sunset included.",
      "The benches are for sitting, not decoration. Tap one to test it. Sunset included.",
      "The benches are for sitting, not decoration. <b>A</b> to test one. Sunset included."),
    "Anshul makes things for poking. Pins, balls, dials, films. I prefer swallowing.",
    "Tried to swallow the moon once. Still working on the distance." ] },
  { key: "FAUNA_gnash", name: "Chomp", near: "CAST_orchestrator_spot", base: caveMouth, rMin: 0, rMax: 6, foot: 0.7, trick: trickChomp,
    beats: { snap: 1.12 }, lines: [
    "The cave family made a film. Big button. <b>Orchestrator</b>. Popcorn not included.",
    "Don’t touch the fire. Actually, it’s fake. Be reckless.",
    "Another film down south. A gallery tour. Everyone’s taking it suspiciously seriously." ] },
  { key: "FAUNA_scoot", name: "Zip", near: "CANNON_planet", foot: 1.0, clear: 2.3, rMax: 18, trick: trickZip, beats: { patOn: 1.0, patOff: 2.6 }, lines: [
    "This cannon? Very old. Very powerful. Absolutely no instruction manual.",
    () => ui.puzzles.sawMoon ? "You've seen the moon, then. Turn the wheel twice and hop in." : "Climb the lookout and look up. You'll see what it's for.",
    "Landing is soft. That’s the official story." ] },
];
const fauna = [];
/* Chomp waits just outside the cave, not on the film stage: a point 3.5 m beyond the shell's
   wall, straight out of the mouth (the gap in the COL_cave_ ring), and a keep-out disc over the
   whole shell so the search never settles inside */
function caveMouth() {
  const shell = A("CAVE_shell"); if (!shell) return null;
  const c = wpos(shell), up = planet.up(c), out = new THREE.Vector3();
  let reach = 0, n = 0;
  for (const [name, a] of Object.entries(world.anchors)) {
    if (!/^COL_cave_\d+$/.test(name)) continue;
    const d = wpos(a).sub(c); d.addScaledVector(up, -d.dot(up));
    reach += d.length(); n++; out.sub(d.normalize());
  }
  if (!n) return null;
  reach /= n; out.normalize();
  return { pos: c.clone().addScaledVector(out, reach + 3.5), keepOut: [[c, reach + 1.6]] };
}
/* A resting spot for a creature: its whole footprint is level ground (open planet or a
   terrace's flat top, never a skirt or a lip), and it stands clear of props, benches,
   signposts, the spiral stair, the film casts, ponds and every interaction spot. */
const OPEN_SHOT = { dist: 4.6, lift: 0.8, n: 8 };   // restSpot `open`: camera spots round the creature that must all see it
function restSpot(base, rMin, rMax, seed, foot, keepOut = [], open = false) {
  const up = planet.up(base), t = new THREE.Vector3(1, 0, 0).cross(up);
  if (t.lengthSq() < 0.01) t.set(0, 0, 1).cross(up);
  t.normalize();
  const ground = p => { const d = p.clone().sub(planet.centre).normalize(); return planet.centre.clone().addScaledVector(d, planet.surface(d)); };
  const avoid = [];
  for (const [name, a] of Object.entries(world.anchors)) {
    if (name.startsWith("BENCHSPOT_")) avoid.push([wpos(a), 3.4]);   // a bench's 2 m prompt and a creature's 2.8 m one must not share the approach
    else if (/^CAST_.*_spot$/.test(name)) avoid.push([wpos(a), 3.0]);
    else if (/^POND_\d+$/.test(name)) avoid.push([wpos(a), (a.userData.r || 3) + 1.4]);
  }
  avoid.push([wpos(A("PLATEAU_monument")), 3.6]);
  for (const p of signPosts) avoid.push([p, 3.0]);
  for (const c of fauna) avoid.push([c.holder.position, 3.5]);
  avoid.push(...keepOut);
  // level = open ground all round (every sample on the bare sphere), or one terrace's flat
  // top all round (every sample on its plane); a skirt or a rim fails both
  const level = q => {
    const n = planet.normal(q.clone().sub(planet.centre).normalize());
    let open = true, flat = true;
    for (const r of [foot * 0.5, foot]) for (let k = 0; k < 12; k++) {
      const g = ground(q.clone().addScaledVector(t.clone().applyAxisAngle(n, k * Math.PI / 6), r));
      if (g.distanceTo(planet.centre) > planet.R + 0.02) open = false;
      if (Math.abs(g.clone().sub(q).dot(n)) > 0.05) flat = false;
      if (!open && !flat) return false;
    }
    return true;
  };
  for (let r = rMin; r <= rMax; r += 0.6) for (let k = 0; k < 24; k++) {
    const q = ground(base.clone().addScaledVector(t.clone().applyAxisAngle(up, seed + k * Math.PI / 12), r));
    if (!planet.colliders.every(c => c.p.distanceTo(q) > c.r + foot + 0.6)) continue;
    if (!spots.every(s => s.pos.distanceTo(q) > 3.2)) continue;
    if (!avoid.every(([p, rr]) => p.distanceTo(q) > rr + foot)) continue;
    if (level(q) && (!open || seenAllRound(q))) return q;
  }
  return null;
}
/* every one of OPEN_SHOT.n camera spots round q (OPEN_SHOT.dist out, OPEN_SHOT.lift up) has a clear line to the creature */
function seenAllRound(q) {
  const up = planet.up(q), look = q.clone().addScaledVector(up, 0.75), t = new THREE.Vector3(1, 0, 0).cross(up);
  if (t.lengthSq() < 0.01) t.set(0, 0, 1).cross(up);
  t.normalize();
  const d = new THREE.Vector3();
  for (let k = 0; k < OPEN_SHOT.n; k++) {
    const f = look.clone().addScaledVector(t.clone().applyAxisAngle(up, k * 2 * Math.PI / OPEN_SHOT.n), OPEN_SHOT.dist).addScaledVector(up, OPEN_SHOT.lift);
    rig.ray.set(f, d.subVectors(look, f).normalize()); rig.ray.far = f.distanceTo(look) - 0.4;
    if (rig.ray.intersectObjects(rig.occluders || [], false).some(h => h.object.visible)) return false;
  }
  return true;
}
const orientTo = (o, up, fwd) => {
  const z = fwd.clone().addScaledVector(up, -fwd.dot(up)).normalize().negate(), x = new THREE.Vector3().crossVectors(up, z).normalize();
  o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, up, z));
};
async function loadFauna() {
  const g = await new Promise(r => world.loader.load("assets/models/fauna.glb", r, undefined, () => r(null)));
  if (!g) return;
  await installSid(g);   // Tall Sid is models/sid.glb (sid.js; the procedural toy is its fallback)
  await installGulp(g, world.loader);   // Gulp is models/gulp.glb (gulp.js; the procedural mesh is the fallback)
  await installChomp(g, world.loader);   // Chomp is models/chomp.glb (chomp.js; the procedural mesh is the fallback)
  await installLumen(g, world.loader);   // Lumen is the white hammerhead models/lumen.glb on the fauna skeleton and clips (lumen.js; the fauna mesh is the fallback)
  await installZip(g, world.loader);   // Zip is the amber hammerhead models/zip.glb (zip.js; the fauna mesh is the fallback)
  const ink = o => !/Eye|Sclera|Iris|Glint|Tooth|Button|Glow|Fur|Seed/i.test(o.material && o.material.name) && !/fur|tuft/i.test(o.name);
  FAUNA.forEach((f, i) => {
    const body = g.scene.getObjectByName(f.key), near = A(f.near), at = f.base && f.base();
    if (!body || !near) return;
    const base = at ? at.pos : wpos(near);
    const spotArgs = [base, f.rMin ?? 4, f.rMax ?? 12, i * 1.7, f.clear ?? f.foot, [...(at ? at.keepOut : []), ...(f.benchGap ? Object.entries(world.anchors).filter(([n]) => n.startsWith("BENCHSPOT_")).map(([, a]) => [wpos(a), f.benchGap]) : []), ...(f.apart ? l1Apart() : [])]];
    const q = (f.open && restSpot(...spotArgs, true)) || restSpot(...spotArgs);   // no open spot in range: the usual one rather than no creature
    if (!q) return;
    // each creature appears once, so it keeps the loaded object itself (a plain clone would
    // leave its skinned meshes bound to the original skeleton)
    const holder = new THREE.Group();
    body.removeFromParent(); body.position.set(0, 0, 0); holder.add(body);
    const up = planet.normal(q.clone().sub(planet.centre).normalize());
    holder.position.copy(q); orientTo(holder, up, at ? q.clone().sub(at.keepOut[0][0]) : base.clone().sub(q));   // Chomp faces away from the cave, toward arrivals
    scene.add(holder);
    // the open mouth would catch thin stripes from its own teeth: let the palate skip shadows
    holder.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = !/Mouth/.test(o.material && o.material.name); o.frustumCulled = false; } });
    toonify(holder);
    twoToneSun(holder);   // the creatures: two tones per colour (lit + one shade), no third band
    if (f.key === "FAUNA_hammer") holder.traverse(o => { if (o.isMesh) { o.receiveShadow = false;   // flat toon only: no self-shadow streaks (the 'weird reflection')
      if (o.material && o.material.name === "Fauna_Pearl") { o.material.emissive = new THREE.Color("#F7F4EC"); o.material.emissiveIntensity = 0.32; } } });   // keeps the pearl white under the warm sun
    outline(holder, "#1E1F26", ink, FAUNA_INK);
    const eyes = [];
    body.traverse(o => { if (/_eye_[LR]$/.test(o.name) && !o.userData.isOutline) { o.userData.s0 = o.scale.clone(); eyes.push(o); } });
    const lids = [];   // eyelid bones (*_lid_L/R, Zip): collapsed to nothing, full size only during a blink, so the eyeball itself is never squashed
    body.traverse(o => { if (o.isBone && /_lid_[LR]$/.test(o.name)) { o.userData.s0 = o.scale.clone(); lids.push(o); } });
    const glow = [];
    holder.traverse(o => { if (o.isMesh && o.material && o.material.name === "Fauna_HandGlow") { o.material.emissive = new THREE.Color("#FFC53A"); o.material.emissiveIntensity = 0; glow.push(o.material); } });
    const mixer = new THREE.AnimationMixer(body), actions = {}, tag = f.key.replace("FAUNA_", "") + "_";
    for (const clip of g.animations) if (clip.name.startsWith(tag)) actions[clip.name.slice(tag.length)] = mixer.clipAction(clip);
    const c = { ...f, holder, body, eyes, lids, glow: [...new Set(glow)], mixer, actions, current: null, busy: false, up, pos: q, home: holder.quaternion.clone(), line: 0, blink: 2 + Math.random() * 3 };
    act(c, "Idle", { once: false, fade: 0 });
    if (c.actions.Idle) c.actions.Idle.time = Math.random() * c.actions.Idle.getClip().duration;
    fauna.push(c);
    planet.colliders.push({ p: q, r: f.foot * 0.8 });
    nearProps.push({ o: holder, hull: null, c: q.clone().addScaledVector(up, 0.8), r: 1.1, follow: holder, lift: up.clone().multiplyScalar(0.8) });   // follows the creature: Zip's lap takes it 1.9 m off its spot
    spots.push({ id: "fauna-" + f.key, kind: "fauna", pos: q, r: f.apart ? L1_LUMEN_R : 2.8, body: "planet", label: `Talk to ${f.name}`, run: () => talk(c), target: holder, off: () => c.busy });
  });
  // benches face the ponds and the view from the monument
  const bench = g.scene.getObjectByName("BENCH");
  if (!bench) return;
  for (const [name, a] of Object.entries(world.anchors)) {
    if (!name.startsWith("BENCHSPOT_")) continue;
    const p = wpos(a), d = p.clone().sub(planet.centre).normalize(), pos = planet.centre.clone().addScaledVector(d, planet.surface(d));
    const up = planet.normal(d), fwd = wfwd(a).addScaledVector(up, -wfwd(a).dot(up)).normalize();
    const b = bench.clone(true); b.position.copy(pos); orientTo(b, up, fwd);
    scene.add(b); b.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    toonify(b); outline(b, "#1E1F26");
    b.updateMatrixWorld(true);
    const seat = b.localToWorld(new THREE.Vector3(0, 0.45, 0.05));
    planet.colliders.push({ p: pos, r: 0.85 });
    spots.push({ id: "bench-" + name, kind: "bench", pos: pos.clone().addScaledVector(fwd, 1.2), r: 2.0, body: "planet", label: "Do absolutely nothing", run: () => sit({ seat, fwd, up, front: pos.clone().addScaledVector(fwd, 1.2) }), target: b });
  }
}
/* play a creature clip, cross-fading from whatever it was doing; returns the clip length */
function act(c, name, { once = true, fade = 0.25 } = {}) {
  const a = c.actions[name]; if (!a) return 0;
  a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = once;
  a.setEffectiveTimeScale(1); a.setEffectiveWeight(1); a.play();
  if (c.current && c.current !== a && fade > 0) c.current.crossFadeTo(a, fade, false);
  else if (c.current && c.current !== a) c.current.stop();
  c.current = a;
  return a.getClip().duration;
}
const rest = (c, fade = 0.35) => act(c, "Idle", { once: false, fade });

/* Talking: every creature turns to you, says a tip and does its own trick. You stand still
   for the trick (Gulp takes you somewhere else entirely). */
async function talk(c) {
  if (c.busy || state !== "play") return;
  c.busy = true; autoTarget = null;
  const line = c.lines[c.line % c.lines.length];   // a line may depend on progress (a function)
  // one order for every creature: the trick animation first, then the slate pops. No overlap.
  c.tip = typeof line === "function" ? line() : line; c.tipSpoken = false;
  c.line++;
  faceEachOther(c);
  slate.armTyping(c.tip); sfx.voice(c.name, { text: c.tip, ready: () => slate.active, ...(c.key === "FAUNA_gnash" ? { emoteWhen: () => c.current === c.actions.Snap, emoteDelay: (c.beats.snap - 0.12) * 1000 } : {}), reveal: (pl, t0, now, stop) => slate.startReveal(pl, t0, now, stop) });   // R7 T7: opening emotion now; the line's babble starts when the slate pops (the animation-then-slate order below is unchanged)
  player.frozen = true;
  try { await c.trick(c); }
  catch (e) { console.error(c.name, e); }
  finally { c.busy = false; player.frozen = false; player.cinematic = false; if (state === "travel" && !player.flight) state = "play"; rest(c); }
  if (!c.tipSpoken) { c.tipSpoken = true; c.flow = { trickEnd: flowClock, slateOpen: null }; await sleep(TRICK_TO_SLATE_S); c.flow.slateOpen = flowClock; speak(c, c.tip, 5200); }   // c.flow: game-time log for the ordering test
}
const TRICK_TO_SLATE_S = 0.15;   // a beat between the creature settling to Idle and the slate popping
function faceEachOther(c) {
  const toC = c.pos.clone().sub(player.position); toC.addScaledVector(player.up, -toC.dot(player.up));
  if (toC.lengthSq() > 1e-4) { player.facing.copy(toC.normalize()); player.orient(1); }
  const m = new THREE.Object3D(); orientTo(m, c.up, player.position.clone().sub(c.pos)); c.holder.quaternion.copy(m.quaternion);
}
/* walk Blip to `d` metres in front of the creature (for a touch, a gulp) */
async function approach(c, d) {
  const dir = player.position.clone().sub(c.pos); dir.addScaledVector(c.up, -dir.dot(c.up));
  if (dir.lengthSq() < 1e-4) dir.copy(player.facing).negate();
  dir.normalize();
  const goal = c.pos.clone().addScaledVector(dir, d), from = player.position.clone();
  planet.collide(goal, 0.45);   // never step into a neighbour (a caveman, a bench)
  const len = from.distanceTo(goal);
  if (len < 0.15) return;
  player.cinematic = true;
  await tween(Math.min(0.8, 0.25 + len * 0.3), k => {
    const p = from.clone().lerp(goal, k * k * (3 - 2 * k)), u = planet.up(p);
    player.position.copy(planet.centre).addScaledVector(u, planet.surface(u));
    player.up.copy(u); player.moveSpeed = 2.2 * Math.sin(Math.PI * k);
  });
  player.feet = planet.surface(player.up); player.moveSpeed = 0; player.lastPos.copy(player.position);
  faceEachOther(c);
  player.cinematic = false;
}
const blipMats = () => { const l = []; player.figure.traverse(o => { if (o.isMesh && !o.userData.isOutline && o.material && o.material.emissive) l.push(o.material); }); return [...new Set(l)]; };

/* Lumen: the hands warm up and glow, it reaches out and lays them on you, and the warmth
   passes into you (a glow that lingers and fades) */
const LUMEN_PEARL = new THREE.Color("#FBE6A8"), LUMEN_GOLD = new THREE.Color("#FFC53A");
const lumenHands = c => c.hand || (c.hand = [...new Set((() => { const a = []; c.holder.traverse(o => { if (o.isMesh && o.material && o.material.name === "Fauna_Hand") a.push(o.material); }); return a; })())]);
const LUMEN_SHOT = { yaws: [0, 0.35, -0.35, 0.7, -0.7, Math.PI, Math.PI - 0.35, Math.PI + 0.35, Math.PI - 0.7, Math.PI + 0.7], dist: 6.9, lift: 0, mid: 0.6, up: 1.9, glide: 2.5 };   // round 6: the touch shot (lens distance, lift, look point along Lumen -> Blip, look height, glide home)
async function trickLumen(c) {
  await approach(c, 1.2);
  const B = c.beats, len = act(c, "Touch");
  // a side-on shot of the touch, like the other tricks: across the line between you, on whichever side is clear
  const look = c.pos.clone().lerp(player.position, 0.5).addScaledVector(c.up, 0.75);
  const across = player.position.clone().sub(c.pos); across.addScaledVector(c.up, -across.dot(c.up)).normalize();
  { const o = LUMEN_SHOT, lk = c.pos.clone().addScaledVector(across, o.mid).addScaledVector(c.up, o.up), pin = spots.find(x => x.id === "pin-art");   // round 6: scored like Chomp's shot (c3Shot), on the visitor's side first (from the Pin Art entrance), so a post, the map table or the frame never hides the touch
    rig.focus(c3Shot(c, across, lk, o, pin ? pin.pos : null), lk, c.up.clone()); }
  const mats = blipMats(), warm = new THREE.Color("#FF6A2E");   // red-orange: on Blip's teal a yellower glow reads as green
  const light = new THREE.PointLight("#FFB25C", 0, 4, 2); player.group.add(light); light.position.set(0, 0.8, 0.4);
  let t = 0;
  await tween(len, k => {
    t = k * len;
    const hands = THREE.MathUtils.smoothstep(t, 0.1, B.touchOn) * (1 - THREE.MathUtils.smoothstep(t, B.touchOff + 0.2, len));
    for (const m of c.glow) m.emissiveIntensity = 1.3 * hands;   // a soft warm yellow glow, not a lamp (fades in to touchOn, out after touchOff)
    for (const m of lumenHands(c)) { m.emissive.copy(LUMEN_PEARL).lerp(LUMEN_GOLD, hands); m.emissiveIntensity = 0.32 + 0.98 * hands; }   // pearl paddles (Fauna_Hand) warm to #FFC53A and back
    const inYou = THREE.MathUtils.smoothstep(t, B.touchOn, B.touchOff);
    for (const m of mats) { m.emissive.copy(warm); m.emissiveIntensity = 0.13 * inYou; }
    light.intensity = 3.5 * inYou;
    if (t > B.touchOn && t < B.touchOff && Math.random() < 0.35)
      fx.puff(player.position.clone().addScaledVector(player.up, 0.6 + Math.random() * 0.6), { size: 0.09, color: new THREE.Color(Math.random() < 0.5 ? "#FFC845" : "#FF9A3C"), life: 0.9, vel: player.up.clone().multiplyScalar(0.9).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)), grow: 0.6 });
  });
  rest(c); player.play("Cheer");
  await tween(1.8, k => { for (const m of mats) m.emissiveIntensity = 0.13 * (1 - k); light.intensity = 3.5 * (1 - k); });
  rig.release(); rig.glideHome(LUMEN_SHOT.glide);   // smooth return, like Chomp's
  for (const m of mats) m.emissiveIntensity = 0;
  for (const m of lumenHands(c)) { m.emissive.copy(LUMEN_PEARL); m.emissiveIntensity = 0.32; }   // glow off after the trick
  light.removeFromParent(); light.dispose();
}

/* Tall Sid waves, you wave back, then it points straight up and the lens follows the
   finger to the lookout at the top of the stair */
/* true if a camera at `from` would not see `to`: a visible camera occluder (stair, wall, prop) is on the line between them */
const _lb = new THREE.Vector3();
const lensBlocked = (from, to) => { rig.ray.set(from, _lb.subVectors(to, from).normalize()); rig.ray.far = from.distanceTo(to) - 0.4; return rig.ray.intersectObjects(rig.occluders || [], false).some(h => h.object.visible); };
const SID_WAVE_HEADINGS = [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8];   // rad round Sid from your side, tried in order for the wave shot
const SID_POINT_TURN = 0.6;   // s: Sid turns his pointing side to the stair while the arm rises (2.4 - 2.86 s)
async function trickSid(c) {
  const B = c.beats, len = act(c, "WavePoint");
  sleep(0.35).then(() => player.play("Wave"));
  await sleep(0.2);
  // the wave: a closer shot from your side, over Blip, so the open hand reads before the point shot takes over
  const toYou = player.position.clone().sub(c.pos); toYou.addScaledVector(c.up, -toYou.dot(c.up)).normalize();
  // the first heading round Sid (yours first) with a clear line to him: from the stair side the lens sat inside the spiral steps
  const sidHead = c.pos.clone().addScaledVector(c.up, 1.9);
  let wavePos = null;
  for (const a of SID_WAVE_HEADINGS) {
    const d = toYou.clone().applyAxisAngle(c.up, a), side = new THREE.Vector3().crossVectors(c.up, d).normalize();   // a step to one side, so Blip does not cover Sid
    const f = c.pos.clone().addScaledVector(d, 9).addScaledVector(side, 2.6).addScaledVector(c.up, 2.4);
    if (!wavePos) wavePos = f;
    if (!lensBlocked(f, sidHead)) { wavePos = f; break; }
  }
  rig.focus(wavePos, sidHead.clone(), c.up.clone());
  const top = lookoutTop || wpos(A("PLATEAU_monument")).addScaledVector(c.up, 8);
  // he turns so his pointing arm (the clip's -X arm) is on the stair side: the raised finger points up at the lookout, not at open sky
  await sleep(Math.max(0, B.pointOn - SID_POINT_TURN - 0.45));
  const toStair = top.clone().sub(c.pos); toStair.addScaledVector(c.up, -toStair.dot(c.up)).normalize();
  const m = new THREE.Object3D(); orientTo(m, c.up, toStair.clone().cross(c.up));
  const q0 = c.holder.quaternion.clone();
  await tween(SID_POINT_TURN, k => c.holder.quaternion.slerpQuaternions(q0, m.quaternion, k * k * (3 - 2 * k)));
  await sleep(0.25);
  // from behind Sid, low: Sid's raised finger in the foreground, the lookout above it
  const away = c.pos.clone().sub(wpos(A("PLATEAU_monument"))); away.addScaledVector(c.up, -away.dot(c.up)).normalize();
  const head = c.pos.clone().addScaledVector(c.up, 1.9);
  rig.focus(c.pos.clone().addScaledVector(away, 8).addScaledVector(c.up, 1.0), head.lerp(top, 0.36), c.up.clone());
  await sleep(Math.max(1.4, B.pointOff - B.pointOn + 0.9));
  rig.release(); rig.snap(player);
  await sleep(Math.max(0, len - B.pointOff - 0.9));
}

/* Gulp swallows you whole, sits there bloated for a moment, and spits you out in a long arc
   to a project somewhere else on the planet (a different one each time) */
let lastSpit = null;
async function trickGulp(c) {
  act(c, "Talk");   // ring_Talk (a small open-close chatter) plays while Blip walks up
  await approach(c, 1.3);
  state = "travel"; ui.prompt(null);
  const B = c.beats;
  const sw = act(c, "Swallow");
  await sleep(B.reach);
  // the mouth arrives at Blip's front at `reach` and shuts at `close`: Blip shrinks into it
  const p0 = player.position.clone(), into = c.pos.clone().addScaledVector(c.up, 0.55);
  await tween(B.close - B.reach, k => { player.group.scale.setScalar(1 - 0.8 * k); player.position.copy(p0).lerp(into, k * 0.5); });
  player.group.visible = false; player.group.scale.setScalar(1); player.position.copy(p0);
  fx.puff(player.position.clone().addScaledVector(player.up, 0.7), { size: 0.5, color: new THREE.Color("#AEE24C"), life: 0.5, grow: 1.6 });
  await sleep(Math.max(0.05, sw - B.close - 0.05));
  const picks = spots.filter(s => s.body === "planet" && byId[s.id] && ["game", "kiosk"].includes(s.kind) && s.pos.distanceTo(c.pos) > 15 && s.id !== lastSpit);
  const dest = (window.__gulpDest && spots.find(s => s.id === window.__gulpDest && s.body === "planet" && ["game", "kiosk"].includes(s.kind))) || picks[(Math.random() * picks.length) | 0];   // test hook: force the destination
  act(c, "Full", { once: false, fade: 0.08 });
  await sleep(1.6);
  const sp = act(c, "Spit", { fade: 0.12 });
  await sleep(B.release);
  lastSpit = dest.id;
  c.holder.updateMatrixWorld(true);
  const fwd = player.position.clone().sub(c.pos); fwd.addScaledVector(c.up, -fwd.dot(c.up)).normalize();
  const mouth = c.pos.clone().addScaledVector(c.up, 0.3).addScaledVector(fwd, 0.6);
  const land = dest.pos.clone(), lu = planet.up(land);
  const look = dest.target ? wpos(dest.target) : land;
  const landFwd = look.clone().sub(land); landFwd.addScaledVector(lu, -landFwd.dot(lu));
  const spitArc = new GreatCircleArc(planet.centre, mouth, land, d => planet.surface(d), undefined);   // great circle, altitude above the surface all the way
  window.__spitArc = spitArc;   // test hook: sampled for the minimum clearance report
  const dist = mouth.distanceTo(land);
  fx.puff(mouth, { size: 0.6, color: new THREE.Color("#AEE24C"), life: 0.6, grow: 2 });
  player.position.copy(mouth); player.group.visible = true; player.frozen = false;
  spitTrail = true;
  await new Promise(res => player.launch(spitArc, 1.8 + dist / 30, planet, landFwd.lengthSq() > 1e-4 ? landFwd.normalize() : player.facing, () => {
    spitTrail = false; if (!window.__spitRaw) { rig.release(); rig.distWanted = rig.dist = rig.coll = rig.home; rig.pitch = rig.homePitch; rig.lift = 0; rig.yawV = rig.pitchV = 0; }   // the default follow framing (home distance and pitch, any zoom or drag undone; __spitRaw skips it, test hook)
    rig.snap(player); fx.dust(player.position, player.up); state = "play"; updateGoal();   // snap like travel(): the flight left the rig facing back at the project
    c.tipSpoken = true; c.flow = { trickEnd: flowClock, slateOpen: flowClock };   // Gulp's trick is the flight; its one slate (PTOO plus the tip) opens on landing
    slate.say({ name: "Gulp", html: `<b>PTOO!</b> Express delivery to <b>${byId[dest.id].name}</b>. No refunds. ${c.tip || ""}`, ms: 5200, base: () => player.position, up: () => player.up, top: 1.9, stay: true });
    res();
  }));
  await sleep(Math.max(0, sp - B.release));
}

/* Chomp chatters, hops at you and snaps the air right in front of your nose: you jump back */
const C3_SHOT = { dist: 7.6, lift: 0, mid: 0.8, up: 1.7, glide: 2.5 };   // round 6 C3: a side-on close shot of Chomp and Blip (he hops back to 2.3 m: the look point is half of that; `up` keeps the slate that pops above Chomp's head in the frame); the lens eases home over `glide` s
/* C3: the clearest side shot: both sides and several yaw offsets, two distances; each candidate casts a grid of rays (along the Chomp-Blip line, 25 % past both ends, low to slate height) and the one with the fewest blocked wins */
function c3Shot(c, across, look, o = C3_SHOT, pref = null) {   // pref: a world point; with equal scores the candidate nearest the line look -> pref wins (the visitor's side)
  const side = new THREE.Vector3().crossVectors(c.up, across).normalize(), cands = [];
  for (const d of [o.dist, o.dist + 0.8, o.dist - 0.8]) for (const a of o.yaws || [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, Math.PI, Math.PI - 0.4, Math.PI + 0.4, Math.PI - 0.8, Math.PI + 0.8, Math.PI - 1.2, Math.PI + 1.2])
    cands.push(look.clone().addScaledVector(side.clone().applyAxisAngle(c.up, a), d).addScaledVector(c.up, o.lift));
  if (pref) { const pd = pref.clone().sub(look); pd.addScaledVector(c.up, -pd.dot(c.up)).normalize(); const key = f => { const v = f.clone().sub(look); v.addScaledVector(c.up, -v.dot(c.up)); return v.normalize().angleTo(pd); }; cands.sort((a, b) => key(a) - key(b)); }
  let best = null, bestN = 1e9;
  for (const f of cands) {
    const right = new THREE.Vector3().crossVectors(c.up, look.clone().sub(f)).normalize();   // a grid across the view, covering both creatures and 25 % beyond, floor to slate height
    let n = 0;
    for (let i = -3; i <= 3; i++) for (let j = 0; j < 5; j++) { const q = look.clone().addScaledVector(right, i * (o.cell || 0.9)).addScaledVector(c.up, -o.up + 0.45 + j * 0.85); if (lensBlocked(f, q)) n++; }
    if (n < bestN) { bestN = n; best = f; if (!n) return f; }
  }
  return best;
}
async function trickChomp(c) {
  await approach(c, 1.6);   // the hop lands 0.32 m forward: the snap stops just short of your nose
  { // C3: closer side shot for the whole act (the rig.focus pattern of trickLumen), eased back to home at the end
    const across = player.position.clone().sub(c.pos); across.addScaledVector(c.up, -across.dot(c.up)).normalize();
    const look = c.pos.clone().addScaledVector(across, C3_SHOT.mid).addScaledVector(c.up, C3_SHOT.up);
    rig.focus(c3Shot(c, across, look), look, c.up.clone());
  }
  lifeKick(c, 0.45, KICK.chompLean); await sleep(0.3);   // leans back, lid shut, before the lunge
  const len = act(c, "Snap");
  await sleep(c.beats.snap);
  lifeKick(c, 1.2, KICK.chompOver);   // lid overshoot + settle, a recoil as Blip hops back
  const mouth = c.pos.clone().addScaledVector(c.up, 0.55).addScaledVector(player.position.clone().sub(c.pos).normalize(), 0.6);
  for (let i = 0; i < 6; i++) fx.puff(mouth, { size: 0.08, color: new THREE.Color("#FFF9EE"), life: 0.5, vel: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3), grow: 0.5 });
  player.play("Jump"); player.cinematic = true;
  const from = player.position.clone(), back = from.clone().sub(c.pos); back.addScaledVector(player.up, -back.dot(player.up)).normalize();
  await tween(0.45, k => {
    const p = from.clone().addScaledVector(back, 0.7 * Math.sin(k * Math.PI / 2)), u = planet.up(p);
    player.position.copy(planet.centre).addScaledVector(u, planet.surface(u) + Math.sin(k * Math.PI) * 0.45); player.up.copy(u);
  });
  player.feet = planet.surface(player.up); player.lastPos.copy(player.position); player.cinematic = false;
  player.play("Land");
  await sleep(Math.max(0.3, len - c.beats.snap - 0.45));
  await blipWorried();   // he is shaken, not cheerful; the slate follows in talk()
  rig.release(); rig.glideHome(C3_SHOT.glide);   // C3: smooth return to the home follow pose (no snap)
}

/* Blip's worried, agitated reaction to nearly being eaten: a flinch back (lean + squash), a fast side-to-side shake, both arms
   thrown up and flapping, and blue sweat drops that fly off his head. All procedural on his own bones (armL / armR, written after the
   mixer through `blipWorry`) and on the figure node, like the other tricks; no new rig. ~1.8 s, then everything is put back. */
let blipWorry = null;
async function blipWorried() {
  const fig = player.figure, bones = {}; fig.traverse(o => { if (o.isBone && /^arm[LR]$/.test(o.name)) bones[o.name] = o; });
  const rec = {}, st = { t: 0, w: 0, shake: 0, flinch: 0 }, qz = new THREE.Quaternion(), ax = new THREE.Vector3(0, 0, 1);
  window.__blipWorry = st;   // test hook
  player.cinematic = true;
  blipWorry = () => {
    const flap = 0.3 * Math.sin(st.t * 24);
    for (const [n, s] of [["armL", 1], ["armR", -1]]) {
      const b = bones[n]; if (!b) continue;
      const r = rec[n] || (rec[n] = { base: b.quaternion.clone(), mine: b.quaternion.clone() });
      if (b.quaternion.angleTo(r.mine) > 1e-6) r.base.copy(b.quaternion);   // the mixer rewrote it this frame; otherwise it still holds our last write
      b.quaternion.copy(r.base).multiply(qz.setFromAxisAngle(ax, s * (2.0 + flap * (n === "armL" ? 1 : -1)) * st.w));   // out and up about the arm's own Z
      r.mine.copy(b.quaternion);
    }
    fig.rotation.y = Math.sin(st.t * 38) * 0.26 * st.shake;                       // the quick shake
    fig.rotation.x = -0.32 * st.flinch + Math.sin(st.t * 26) * 0.05 * st.shake;   // leans away from the snap, trembles
    fig.scale.y = 1 - 0.1 * st.flinch; fig.scale.x = fig.scale.z = 1 + 0.05 * st.flinch;
  };
  const drop = () => {   // blue sweat drops thrown up and out from the head, falling back
    const head = player.position.clone().addScaledVector(player.up, 1.15);
    const right = new THREE.Vector3().crossVectors(player.up, player.facing).normalize();
    for (let i = 0; i < 5; i++) {
      const sd = i % 2 ? 1 : -1;
      fx.puff(head.clone().addScaledVector(right, sd * 0.3), { size: 0.2, color: new THREE.Color(i % 3 ? "#8FD3FF" : "#D8F1FF"), life: 0.8, grow: 0.12, glow: true, cool: false,
        vel: right.clone().multiplyScalar(sd * (1.2 + Math.random())).addScaledVector(player.up, 1.8 + Math.random() * 0.8) });
    }
  };
  const T = 1.9; let d1 = false, d2 = false, d3 = false;
  await tween(T, k => {
    const t = k * T; st.t = t;
    st.flinch = t < 0.18 ? sm01(t / 0.18) : Math.max(0.35, 1 - (t - 0.18) / 0.5 * 0.65) * (t > 1.55 ? 1 - sm01((t - 1.55) / 0.35) : 1);
    st.w = sm01(Math.min(1, t / 0.28)) * (t > 1.5 ? 1 - sm01((t - 1.5) / 0.4) : 1);
    st.shake = (t > 0.2 && t < 1.55) ? sm01(Math.min(1, (t - 0.2) / 0.1)) * (t > 1.3 ? 1 - sm01((t - 1.3) / 0.25) : 1) : 0;
    if (!d1 && t > 0.2) { d1 = true; drop(); } if (!d2 && t > 0.7) { d2 = true; drop(); } if (!d3 && t > 1.15) { d3 = true; drop(); }
  });
  blipWorry = null; for (const n in rec) bones[n].quaternion.copy(rec[n].base); fig.rotation.x = fig.rotation.y = 0; fig.scale.set(1, 1, 1);
  player.cinematic = false;
}

/* Zip folds his neck right down so the T head hangs at Blip's shoulder height in front of him (scoot_Bow, 3.6 s: down by 0.9,
   held to 2.75, up by 3.45). Blip steps up beside it (his right shoulder on Zip's centre line), raises that arm
   (procedurally on his armR bone, after the mixer: no pat clip exists) and gives three pats at 1.30 / 1.80 / 2.30 s;
   the clip bobs the head on each one, hearts pop, and the camera frames both from the side. Then the slate (talk()). */
const ZIP_PATS = [1.30, 1.80, 2.30], ZIP_HEAD = { f: 0.9, z: 0.95 }, ZIP_PET_GAP = 0.65;   // the yak's bowed head in Zip's frame at the hold; Blip stands at f + ZIP_PET_GAP (at 0.2 the new yak's muzzle went 38 cm into Blip; at 0.6+ nothing of Zip enters him)
function popHearts(pos, up, n = 3) {
  if (!popHearts.tex) {
    const cv = document.createElement("canvas"); cv.width = cv.height = 64; const g = cv.getContext("2d");
    g.fillStyle = "#FF6F96"; g.strokeStyle = "#1E1F26"; g.lineWidth = 5; g.beginPath(); g.moveTo(32, 56); g.bezierCurveTo(2, 34, 6, 6, 24, 8); g.bezierCurveTo(30, 9, 32, 14, 32, 18); g.bezierCurveTo(32, 14, 34, 9, 40, 8); g.bezierCurveTo(58, 6, 62, 34, 32, 56); g.closePath(); g.fill(); g.stroke();
    popHearts.tex = new THREE.CanvasTexture(cv); popHearts.tex.colorSpace = THREE.SRGBColorSpace;
  }
  for (let i = 0; i < n; i++) {
    const m = new THREE.SpriteMaterial({ map: popHearts.tex, transparent: true, depthTest: false, fog: false }), sp = new THREE.Sprite(m); sp.renderOrder = 999;
    const p0 = pos.clone().addScaledVector(up, 0.1), side = new THREE.Vector3((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5), sz = 0.2 + Math.random() * 0.12;
    scene.add(sp);
    tween(1.2, k => { sp.position.copy(p0).addScaledVector(up, 0.15 + 0.7 * k).addScaledVector(side, k); const e = Math.min(1, k * 6); sp.scale.setScalar(sz * e * (1 + 0.15 * Math.sin(k * 9))); m.opacity = 1 - THREE.MathUtils.smoothstep(k, 0.6, 1); }).then(() => { sp.removeFromParent(); m.dispose(); });
  }
}
async function trickZip(c) {
  await approach(c, 1.2);
  const len = act(c, "Bow");
  const up = c.up, fr = new THREE.Vector3(0, 0, -1).applyQuaternion(c.holder.quaternion); fr.addScaledVector(up, -fr.dot(up)).normalize();
  const right = new THREE.Vector3().crossVectors(fr, up).normalize();
  const hb = c.body.getObjectByName("scoot_head"), arm = player.figure.getObjectByName("armR");
  const headTop = () => { const p = hb.localToWorld(new THREE.Vector3(0, 0.06, 0)); return p.addScaledVector(up, 0.13); };   // the back of the bowed T bar
  const ctr = c.pos.clone().addScaledVector(fr, ZIP_HEAD.f).addScaledVector(up, ZIP_HEAD.z);
  // Blip steps beside the bowed head: right shoulder on Zip's centre line, a hand's reach behind the bar
  const goal = c.pos.clone().addScaledVector(fr, ZIP_HEAD.f + ZIP_PET_GAP).addScaledVector(right, 0.377), from = player.position.clone();
  planet.collide(goal, 0.3);
  player.cinematic = true;
  await tween(0.5, k => { const p = from.clone().lerp(goal, k * k * (3 - 2 * k)), u = planet.up(p); player.position.copy(planet.centre).addScaledVector(u, planet.surface(u)); player.up.copy(u); player.moveSpeed = 1.5 * Math.sin(Math.PI * k); });
  player.moveSpeed = 0; player.feet = planet.surface(player.up); player.lastPos.copy(player.position);
  player.facing.copy(fr).negate(); player.orient(1); player.group.updateMatrixWorld(true);
  const sh = arm.getWorldPosition(new THREE.Vector3()); player.position.addScaledVector(right, ctr.clone().sub(sh).dot(right) * 0.9); player.group.updateMatrixWorld(true);
  // Blip's arm, driven after his mixer each frame
  const qW = new THREE.Quaternion(), qP = new THREE.Quaternion(), qD = new THREE.Quaternion(), qL = new THREE.Quaternion(), vS = new THREE.Vector3(), vT = new THREE.Vector3(), vC = new THREE.Vector3();
  arm.updateWorldMatrix(true, false); arm.getWorldQuaternion(qW);
  const restDir = new THREE.Vector3(0.62, -0.78, 0).applyQuaternion(player.group.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(qW.clone().invert());   // the arm's own axis in bone space
  let t = 0;
  const post = () => {
    const w = THREE.MathUtils.smoothstep(t, 0.45, 0.95) * (1 - THREE.MathUtils.smoothstep(t, 2.75, 3.25));
    if (w <= 0) { arm.scale.setScalar(1); return; }
    let hit = 0; for (const tk of ZIP_PATS) hit = Math.max(hit, Math.exp(-(((t - tk) / 0.09) ** 2)));
    arm.parent.updateWorldMatrix(true, false); arm.updateWorldMatrix(false, false);
    arm.getWorldPosition(vS); vT.copy(headTop()).addScaledVector(up, 0.11 * (1 - hit) + 0.01);
    const d = vT.sub(vS).normalize(); arm.getWorldQuaternion(qW);
    vC.copy(restDir).applyQuaternion(qW); qD.setFromUnitVectors(vC, d); qW.premultiply(qD);
    arm.parent.getWorldQuaternion(qP); qL.copy(qP).invert().multiply(qW);
    arm.quaternion.slerp(qL, w); arm.scale.setScalar(1 + 0.45 * w);
  };
  const mixer = player.mixer, upd = mixer.update.bind(mixer); mixer.update = dt => { upd(dt); post(); };
  // camera: both from the side, low and wide
  const mid = ctr.clone().lerp(c.pos, 0.2).addScaledVector(up, 0.1);
  rig.focus(mid.clone().addScaledVector(right, -5.6).addScaledVector(fr, 0.6).addScaledVector(up, 0.7), mid.clone().addScaledVector(up, 0.2), up.clone());   // from Zip's left: Blip's body is behind the head, his patting arm is the near one
  let pats = 0;
  try {
    await tween(len, k => {
      t = k * len;
      while (pats < ZIP_PATS.length && t >= ZIP_PATS[pats]) {
        pats++; popHearts(headTop(), up, 3);
        for (let i = 0; i < 3; i++) fx.puff(headTop().addScaledVector(up, 0.1), { size: 0.07, color: new THREE.Color(i % 2 ? "#FFC845" : "#FFE9A8"), life: 0.7, grow: 0.5, glow: true, cool: false, vel: up.clone().multiplyScalar(0.8).add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8)) });
      }
    });
  } finally { mixer.update = upd; arm.scale.setScalar(1); rig.release(); rig.snap(player); }
  lifeKick(c, 1.1, KICK.zipPat);
  faceEachOther(c); player.cinematic = false;
}

/* procedural life layered on Zip's and Chomp's clips (idle variety, reacting to Blip,
   anticipation / follow-through on their tricks). Each frame the last offsets come back off
   before the mixer runs (a bone with no track in the playing clip would pile them up), and new
   ones go on after it. Offsets are rotations about the creature's own axes (body space: +y up,
   -z forward, +x right), carried into each bone's frame through its parent's rest orientation.
   Only body/head/ears/jaw/tail bones turn, plus one hind leg for Zip's scratch; when Zip's body
   bone tips, its four thighs turn back by the same amount so the feet stay planted. Chomp's
   two feet hang off gnash_body, which the layer never moves (its sway is on gnash_ball). */
const LIFE_ACTS = { scoot: ["look", "sniff", "scratch", "tail", "shift"], gnash: ["look", "sniff", "tail", "shift"] };
const LIFE_DUR = { look: 2.6, sniff: 1.5, scratch: 1.9, tail: 1.2, shift: 2.2 };
const LIFE_NEAR = [4, 5];   // perk up inside 4 m, settle once Blip is beyond 5 m (hysteresis)
const lifeRng = seed => { let s = (seed >>> 0) || 1; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };
const idlePick = (list, prev, r) => { const o = list.filter(a => a !== prev); return o[Math.min(o.length - 1, Math.floor(r * o.length))]; };   // never the same twice running
const idleGap = r => 3 + 5 * r;   // 3-8 s between idle actions
const sm01 = k => k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);
const holdEnv = (t, dur, a = 0.3) => sm01(t / a) * sm01((dur - t) / a);
const _lq = new THREE.Quaternion(), _lq2 = new THREE.Quaternion(), _le = new THREE.Euler(), _lv = new THREE.Vector3(), _lv2 = new THREE.Vector3();
function lifeSetup(c) {
  const tag = c.key === "FAUNA_scoot" ? "scoot" : c.key === "FAUNA_gnash" ? "gnash" : null;
  if (!tag) return null;
  const bones = {};
  c.body.traverse(o => { if (o.isBone) bones[o.name.slice(tag.length + 1)] = o; });
  c.body.updateMatrixWorld(true);
  const inv = c.body.getWorldQuaternion(new THREE.Quaternion()).invert(), restP = new Map();
  for (const b of Object.values(bones)) restP.set(b, inv.clone().multiply(b.parent.getWorldQuaternion(new THREE.Quaternion())));
  const L = { tag, bones, restP, applied: new Map(), rng: lifeRng(tag === "scoot" ? 0x5c007 : 0x6a45), kicks: [], o: {},
    gap: 0, act: null, prev: null, t: 0, near: false, w: 0, hy: 0, hp: 0, perk: 0, hop: -1, lag: 0, lagV: 0, lastQ: c.holder.quaternion.clone(), clock: 0 };
  L.gap = 1.5 + 2 * L.rng();
  return L;
}
const lifeAdd = (o, name, x, y = 0, z = 0) => { const v = o[name] || (o[name] = [0, 0, 0]); v[0] += x; v[1] += y; v[2] += z; };
/* the idle actions, as offsets at time t into an action of length d (they all start and end at rest) */
function lifeIdle(L, o, act, t, d, w) {
  const e = holdEnv(t, d) * w, S = L.tag === "scoot";
  if (act === "look") {   // left, a held beat, across to the right, back: eased holds, head leads, a touch of pitch
    const yaw = 0.55 * sm01((t - 0.1) / 0.35) - 1.05 * sm01((t - 1.15) / 0.45) + 0.5 * sm01((t - 2.05) / 0.4);
    const pitch = 0.12 * sm01((t - 0.1) / 0.35) - 0.18 * sm01((t - 1.15) / 0.45) + 0.06 * sm01((t - 2.05) / 0.4);
    if (S) { lifeAdd(o, "head", pitch * w, yaw * w, -0.12 * yaw * w); lifeAdd(o, "stalk_L", 0, 0.25 * yaw * w); lifeAdd(o, "stalk_R", 0, 0.25 * yaw * w); }
    else { lifeAdd(o, "ball", pitch * 0.6 * w, yaw * 0.6 * w); lifeAdd(o, "antenna", 0, 0.4 * yaw * w); }
  } else if (act === "sniff") {   // nose down and forward, quick small bobs
    const bob = Math.max(0, Math.sin(t * 2 * Math.PI * 6.5)) * sm01((t - 0.25) / 0.15) * sm01((d - 0.3 - t) / 0.15);
    if (S) { lifeAdd(o, "head", (-0.22 - 0.1 * bob) * e); lifeAdd(o, "mouth", 0.3 * bob * e); lifeAdd(o, "stalk_L", -0.25 * e); lifeAdd(o, "stalk_R", -0.25 * e); }
    else { lifeAdd(o, "ball", (-0.09 - 0.05 * bob) * e); lifeAdd(o, "head", 0.06 * bob * e); lifeAdd(o, "antenna", -0.3 * e); }
  } else if (act === "scratch") {   // Zip only: the right hind leg comes up and scratches; the other three stay down
    const s = Math.sin(t * 2 * Math.PI * 7) * sm01((t - 0.35) / 0.1) * sm01((d - 0.35 - t) / 0.1);
    lifeAdd(o, "thigh_BR", 0.75 * e, 0, 0.45 * e); lifeAdd(o, "shin_BR", (-0.6 + 0.3 * s) * e);
    lifeAdd(o, "head", -0.1 * e, -0.45 * e, -0.25 * e); lifeAdd(o, "stalk_R", 0.3 * e); lifeAdd(o, "stalk_L", -0.2 * e);
  } else if (act === "tail") {   // a quick flick, the tip a beat behind
    const f = k => Math.sin(Math.max(0, t - k) * 2 * Math.PI * 3.2) * holdEnv(Math.max(0, t - k), d - 0.15, 0.15) * w;
    if (S) { lifeAdd(o, "tail1", 0, 0.35 * f(0)); lifeAdd(o, "tail2", 0, 0.4 * f(0.05)); lifeAdd(o, "tail3", 0.1 * f(0.1), 0.5 * f(0.1)); }
    else { lifeAdd(o, "tail1", 0.2 * f(0), 0.7 * f(0)); lifeAdd(o, "tail2", 0, 0.9 * f(0.06)); }
  } else if (act === "shift") {   // weight onto one side, across, back to centre
    const r = (sm01(t / 0.5) - 2 * sm01((t - 0.85) / 0.5) + sm01((t - 1.6) / 0.5)) * w;
    if (S) { lifeAdd(o, "body", 0, 0, 0.025 * r); lifeAdd(o, "head", 0, -0.12 * r, -0.06 * r); lifeAdd(o, "tail1", 0, 0.15 * r); }
    else { lifeAdd(o, "ball", 0, 0.06 * r, 0.07 * r); }
  }
}
function lifePre(c) {   // take last frame's offsets back off (before the mixer writes the clip)
  const L = c.life; if (!L) return;
  for (const [b, q] of L.applied) b.quaternion.premultiply(_lq.copy(q).invert());
  L.applied.clear();
  c.body.position.set(0, 0, 0); c.body.scale.set(1, 1, 1);
}
function lifePost(c, dt) {
  const L = c.life; if (!L) return;
  const o = L.o; for (const k in o) delete o[k];
  L.clock += dt;
  const S = L.tag === "scoot", free = !c.busy && !c.driving;
  L.w += ((free ? 1 : 0) - L.w) * (1 - Math.exp(-dt * 5));
  // Blip close? (hysteresis)
  const d = player.body === planet ? player.position.distanceTo(c.holder.position) : 1e9;
  const wasNear = L.near;
  L.near = d < LIFE_NEAR[wasNear ? 1 : 0];
  if (L.near && !wasNear && free && S) L.hop = 0;   // Zip: a little hop of delight
  L.perk += ((L.near ? 1 : 0) - L.perk) * (1 - Math.exp(-dt * 4));
  // idle scheduler: one action at a time, never the same twice running, 3-8 s apart; paused while Blip is close
  if (L.act) { L.t += dt; if (L.t >= LIFE_DUR[L.act]) { L.prev = L.act; L.act = null; L.gap = idleGap(L.rng()); } }
  else if (free && !L.near) { L.gap -= dt; if (L.gap <= 0) { L.act = idlePick(LIFE_ACTS[L.tag], L.prev, L.rng()); L.t = 0; } }
  if (L.act) lifeIdle(L, o, L.act, L.t, LIFE_DUR[L.act], L.w * (1 - L.perk));   // Blip arriving fades the idle action out
  // head (Chomp: the whole shell) tracks Blip, clamped and eased, on top of the body's own turn
  let ty = 0, tp = 0;
  if (L.perk > 0.01) {
    const head = L.bones.head; head.getWorldPosition(_lv);
    _lv2.copy(player.position).addScaledVector(player.up, 0.5).sub(_lv).applyQuaternion(_lq2.copy(c.holder.quaternion).invert());
    ty = THREE.MathUtils.clamp(Math.atan2(-_lv2.x, -_lv2.z), -0.6, 0.6);
    tp = THREE.MathUtils.clamp(Math.atan2(_lv2.y, Math.hypot(_lv2.x, _lv2.z)), -0.3, 0.3);
  }
  const kk = 1 - Math.exp(-dt * 4);
  L.hy += (ty * L.perk * L.w - L.hy) * kk; L.hp += (tp * L.perk * L.w - L.hp) * kk;
  const p = L.perk * L.w;
  if (S) {
    lifeAdd(o, "head", L.hp, L.hy);
    lifeAdd(o, "stalk_L", 0.3 * p, 0, 0.12 * p); lifeAdd(o, "stalk_R", 0.3 * p, 0, -0.12 * p);   // eye stalks perk up and splay
    const wag = Math.sin(L.clock * 2 * Math.PI * 2.4) * p;
    lifeAdd(o, "tail1", 0.12 * p, 0.3 * wag); lifeAdd(o, "tail2", 0, 0.35 * wag); lifeAdd(o, "tail3", 0, 0.4 * wag);
  } else {
    lifeAdd(o, "ball", L.hp * 0.6 - 0.08 * p, L.hy * 0.6);   // a curious lean toward Blip
    lifeAdd(o, "antenna", 0.35 * p, 0, 0); lifeAdd(o, "antenna2", 0.25 * p);
    const wag = Math.sin(L.clock * 2 * Math.PI * 0.8) * p;   // slow wag
    lifeAdd(o, "tail1", 0, 0.4 * wag); lifeAdd(o, "tail2", 0, 0.5 * wag);
  }
  // Zip's hop of delight: crouch 0.12 s, 0.4 s in the air, a squash on landing
  if (L.hop >= 0) {
    L.hop += dt; const h = L.hop;
    if (h < 0.12) { const k = Math.sin(Math.PI * h / 0.24); c.body.scale.set(1 + 0.05 * k, 1 - 0.1 * k, 1 + 0.05 * k); }
    else if (h < 0.52) { const k = (h - 0.12) / 0.4; c.body.position.y = 0.14 * Math.sin(Math.PI * k); c.body.scale.set(1 - 0.03 * Math.sin(Math.PI * k), 1 + 0.06 * Math.sin(Math.PI * k), 1 - 0.03 * Math.sin(Math.PI * k)); lifeAdd(o, "tail1", 0.3 * Math.sin(Math.PI * k)); }
    else if (h < 0.7) { const k = Math.sin(Math.PI * (h - 0.52) / 0.18); c.body.scale.set(1 + 0.04 * k, 1 - 0.08 * k, 1 + 0.04 * k); }
    else L.hop = -1;
  }
  // Zip's head lags the turn on its zoomies and swings through when it stops (an underdamped spring)
  if (S) {
    _lq.copy(L.lastQ).invert().multiply(c.holder.quaternion); L.lastQ.copy(c.holder.quaternion);
    const rate = c.driving && dt > 0 ? 2 * Math.atan2(_lq.y, _lq.w) / dt : 0;
    const target = THREE.MathUtils.clamp(-0.07 * rate, -0.28, 0.28);
    L.lagV += (120 * (target - L.lag) - 9 * L.lagV) * dt; L.lag += L.lagV * dt;
    lifeAdd(o, "head", 0, L.lag, 0.3 * L.lag);
  }
  // trick kicks (anticipation, overshoot, recoil): fn(t, o, c) for dur seconds
  for (let i = L.kicks.length - 1; i >= 0; i--) { const k = L.kicks[i]; k.t += dt; if (k.t > k.dur) L.kicks.splice(i, 1); else k.fn(k.t, o, c); }
  // apply: body-space rotation R on bone b -> local' = (P^-1 R P) local, P = the parent's rest orientation
  const bodyR = o.body ? new THREE.Quaternion().setFromEuler(_le.set(o.body[0], o.body[1], o.body[2], "YXZ")) : null;
  for (const name in o) {
    const b = L.bones[name]; if (!b) continue;
    const v = o[name]; _lq.setFromEuler(_le.set(v[0], v[1], v[2], "YXZ"));
    const P = L.restP.get(b), C = new THREE.Quaternion().copy(P).invert().multiply(_lq).multiply(P);
    b.quaternion.premultiply(C); L.applied.set(b, C);
  }
  if (bodyR && S && L.bones.thigh_FL) for (const n of ["thigh_FL", "thigh_FR", "thigh_BL", "thigh_BR"]) {   // keep the feet planted under a body tip
    const b = L.bones[n], P = L.restP.get(b), C = new THREE.Quaternion().copy(P).invert().multiply(bodyR.clone().invert()).multiply(P);
    b.quaternion.premultiply(C); const prev = L.applied.get(b); L.applied.set(b, prev ? C.multiply(prev) : C);
  }
}
const lifeKick = (c, dur, fn) => { if (c.life) c.life.kicks.push({ t: 0, dur, fn }); };
/* the tricks' extra beats */
const KICK = {
  // Zip's happy squish and wiggle when Blip pats its head: a quick squash and stretch, the head wiggles, the tail flicks
  zipPat: (t, o, c) => {
    const e = Math.exp(-2.2 * t), k = Math.sin(2 * Math.PI * 2.4 * t) * e;
    c.body.scale.set(1 + 0.06 * k, 1 - 0.10 * k, 1 + 0.06 * k);
    lifeAdd(o, "head", 0.05 * k, 0.28 * Math.sin(2 * Math.PI * 3.4 * t) * e, 0.12 * Math.sin(2 * Math.PI * 3.4 * t + 1) * e);
    lifeAdd(o, "tail1", 0, 0.45 * Math.sin(2 * Math.PI * 4 * t) * e); lifeAdd(o, "tail2", 0, 0.5 * Math.sin(2 * Math.PI * 4 * t + 0.6) * e);
  },
  // Chomp leans back before the Snap, the lid shut tight; the lean lets go into the hop
  chompLean: (t, o) => { const k = t < 0.3 ? sm01(t / 0.3) : 1 - sm01((t - 0.3) / 0.15); lifeAdd(o, "ball", 0.26 * k); lifeAdd(o, "head", -0.05 * k); lifeAdd(o, "antenna", -0.4 * k); lifeAdd(o, "tail1", -0.3 * k); },
  // after the snap: the lid overshoots and settles, the shell nods past and recoils as Blip hops back
  chompOver: (t, o) => { lifeAdd(o, "head", 0.2 * Math.exp(-5 * t) * Math.sin(2 * Math.PI * 3 * t)); lifeAdd(o, "ball", -0.07 * Math.exp(-6 * t) * Math.cos(2 * Math.PI * 2 * t) + 0.12 * Math.sin(Math.PI * Math.min(1, Math.max(0, t - 0.12) / 0.25)) * Math.exp(-2.5 * Math.max(0, t - 0.12))); lifeAdd(o, "antenna", 0.5 * Math.exp(-3 * t) * Math.sin(2 * Math.PI * 2.5 * t)); },
};
function updateFauna(dt) {
  for (const c of fauna) {
    // turn to face the visitor when they come close, back to the resting pose otherwise
    if (!c.driving && !c.busy) {
      const toP = player.position.clone().sub(c.holder.position), near = player.body === planet && toP.length() < (c.gulp ? L5_GULP_LOOK : 9);
      if (near) { const m = new THREE.Object3D(); orientTo(m, c.up, toP); c.holder.quaternion.slerp(m.quaternion, 1 - Math.exp(-dt * 3)); }
      else c.holder.quaternion.slerp(c.home, 1 - Math.exp(-dt * 1));
    }
    for (const e of c.eyes) e.scale.copy(e.userData.s0);
    if (c.life === undefined) c.life = lifeSetup(c);   // Zip and Chomp get the procedural layer (null for the rest)
    lifePre(c);
    c.mixer.update(dt);
    lifePost(c, dt);
    c.blink -= dt;
    if (c.blink < 0) c.blink = 2.5 + Math.random() * 3.5;
    if (c.blink < 0.12) for (const e of c.eyes) e.scale.y *= 0.15;
    for (const l of c.lids) l.scale.copy(l.userData.s0).multiplyScalar(c.blink < 0.12 ? 1 : 0.001);
  }
}

/* sit on a bench: the camera drifts slowly round the seated Blip (never out to the planet); any key stands up.
   Only the lookout marker's `view` spot ever reaches seatOrbit (seatorbit.js). */
const SEATCAM = { dist: 5.2, pitch: 0.1, rate: 27 * Math.PI / 180 / 10, ease: 3.5 };   // close and low; 27 deg per 10 s once eased in (about 23 deg in the first 10 s)
let seatYaw = 0, seatEaseTok = 0; const _hdP = new THREE.Vector3(), _hdF = new THREE.Vector3();
let pinOcc = null, seatOrbit = null, sitFly = null;
let seated = null, seatBusy = false, seatT = 0;
let seatHintFlying = false;   // which hint is showing while seated (fly-round vs stand up)
/* the seated pose lives in player.js (sitting / sitK / SIT): legs blend into it and the locomotion weights fade to 0 */
function sit(s) {
  if (state !== "play" || seated || seatBusy) return;
  seated = s; autoTarget = null;
  player.cinematic = true; player.frozen = true; player.sitting = !s.view;   // a view spot (the lookout marker) is a stand, never a sit
  // hop up onto the seat instead of teleporting: the legs blend into the pose over the same beat
  const from = player.position.clone(), to = s.view ? s.seat.clone() : s.seat.clone().addScaledVector(s.up, -SIT.drop).addScaledVector(s.fwd, SIT.back);
  const f0 = player.facing.clone().addScaledVector(s.up, -player.facing.dot(s.up)).normalize();
  tween(0.4, k => {
    if (seated !== s) return;
    const e = k * k * (3 - 2 * k);
    player.position.copy(from).lerp(to, e).addScaledVector(s.up, (s.view ? 0.05 : 0.22) * Math.sin(Math.PI * k));
    player.facing.copy(f0).lerp(s.fwd, e).normalize(); player.up.copy(s.up); player.viewUp.copy(s.up); player.orient(1);
  });
  seatT = 0; seatYaw = 0; seatEaseTok++;
  if (s.view) rig.distWanted = rig.home;
  else { rig.distWanted = SEATCAM.dist; rig.pitch = SEATCAM.pitch; rig.fwd.copy(s.fwd); if (sitFly) sitFly.sit(); }   // a bench is just a seat: close and low behind Blip, then the lens drifts slowly round him (the loop); the butterfly timer starts
  if (seatOrbit && s.view) { seatOrbit.onDone = viewDone; seatOrbit.wait(player, s.up); }   // only the lookout marker: after a beat the lens flies out round the planet and the moon and comes back
  // no timeout: the way back up stays on screen for as long as Blip sits (stand() hides it)
  ui.prompt(null);
  if (s.view) ui.hint(isTouch ? "Tap to come back" : `${anyKey()} to come back`);
  else ui.hint(isTouch ? "Tap the stick or the scene to stand up" : `${anyKey()} to stand up`);
}
/* "Take in the view": a small toon plinth on the lookout's top deck, in LOOKOUT-local coordinates (deck top y 7.98).
   VIEW_AT is clear of the photo booth (booth prop at -150 deg / 1.75 m, its prompt centre at -150 deg / 0.96 m, reach 1.6 m: this one's
   reach 1.1 m leaves a gap), clear of the stair's exit (arrives at ~60..75 deg and steps off toward smaller angles; this is 2.5 m from it)
   and inside the rail. It re-points the existing "secret-top" spot (the guide, the "found the top" secret and the moon reveal all keep
   working), so the prompt reads "E Take in the view" and running it stands Blip on the plinth for the planet orbit (seatorbit.js). */
const VIEW_AT = { ang: -5, r: 2.0, reach: 1.1 };
function setupViewSpot() {
  const sp = spots.find(s => s.id === "secret-top"), lk = scene.getObjectByName("LOOKOUT");
  if (!sp || !lk) return;
  lk.geometry.computeBoundingBox();
  const a = VIEW_AT.ang * Math.PI / 180, y = lk.geometry.boundingBox.max.y;
  const g = new THREE.Group(); g.name = "VIEW_marker";
  const cream = new THREE.MeshStandardMaterial({ color: "#F4EBD8", roughness: 1, metalness: 0 }), lav = new THREE.MeshStandardMaterial({ color: "#B9A2F2", roughness: 1, metalness: 0 });   // standard in, toonify turns them into the world's 3-band toon
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.09, 40), cream); base.position.y = 0.045;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.4, 0.04, 40), lav); cap.position.y = 0.11;
  for (const m of [base, cap]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  g.position.set(Math.cos(a) * VIEW_AT.r, y, Math.sin(a) * VIEW_AT.r); lk.add(g);
  toonify(g); outline(g, "#1E1F26");
  // a subtle glow ring just outside the plinth that breathes (driven by its own onBeforeRender: no hook in the main loop)
  const ringMat = new THREE.MeshBasicMaterial({ color: "#B9A2F2", transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.78, 0.94, 56), ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; ring.renderOrder = 3; ring.castShadow = false;
  ring.onBeforeRender = () => { const w = performance.now() / 1000; ringMat.opacity = 0.42 + 0.22 * Math.sin(w * 2.2); ring.scale.setScalar(1 + 0.04 * Math.sin(w * 2.2)); };
  g.add(ring);
  lk.updateMatrixWorld(true);
  const top = g.localToWorld(new THREE.Vector3(0, 0.13, 0)), up = planet.up(top);
  const fwd = top.clone().sub(lk.getWorldPosition(new THREE.Vector3())); fwd.addScaledVector(up, -fwd.dot(up)).normalize();   // out over the rail
  Object.assign(sp, { pos: top.clone().addScaledVector(up, -0.13), r: VIEW_AT.reach, target: g, label: "Admire everything",
    run: () => {
      if (ui.findSecret("top", "You took the stairs. Respect.")) for (let i = 0; i < 10; i++) fx.puff(top, { size: 0.3, color: new THREE.Color(["#FFC845", "#FF7A62", "#B9A2F2", "#7ED6B2"][i % 4]), life: 1.2, vel: new THREE.Vector3((Math.random() - 0.5) * 6, 3 + Math.random() * 3, (Math.random() - 0.5) * 6), grow: 1 });
      sit({ view: true, seat: top, fwd, up, front: top });
    } });
}
/* the lookout marker's tour: any key / tap flies the lens back, and Blip is free once it lands (seatOrbit.onDone) */
function viewDone() {
  if (!seated || !seated.view) return;
  const s = seated; seated = null; seatBusy = true; ui.hideHint();
  rig.distWanted = rig.home; rig.pitch = rig.homePitch;
  const from = player.position.clone(), to = from.clone().addScaledVector(s.up, -0.13);   // step down off the plinth onto the deck (no pop)
  tween(0.2, k => player.position.lerpVectors(from, to, k * k * (3 - 2 * k))).then(() => { player.cinematic = false; player.frozen = false; seatBusy = false; });
}
function stand() {
  if (!seated) return;
  if (seated.view) {
    if (seatOrbit && seatOrbit.active) { if (!seatOrbit.guard()) seatOrbit.cancel(); if (!seatOrbit.active) viewDone(); }   // cancel in the 0.5 s wait ends it at once; later it lands via onDone
    else viewDone();
    return;
  }
  if (sitFly) sitFly.stand();   // a perched butterfly flutters off
  const s = seated; seated = null; seatBusy = true;
  { // the lens eases back round to where it started while he gets up (a new sit or a walk-off cancels the ease)
    const tok = ++seatEaseTok, total = seatYaw; let done = 0; seatYaw = 0;
    tween(1.2, k => { if (tok !== seatEaseTok) return; const e = k * k * (3 - 2 * k), d = total * e - done; done += d; rig.fwd.applyAxisAngle(rig.up, -d); });
  }
  player.sitting = false; ui.hideHint();   // the legs and the walk blend ease back over SIT_EASE (player.js)
  rig.distWanted = rig.home; rig.pitch = rig.homePitch;
  // hop down and a short step out to the front spot (no teleport, no pop), then hand control back
  const from = player.position.clone(), fu = planet.up(s.front), to = planet.centre.clone().addScaledVector(fu, planet.surface(fu));
  tween(0.4, k => {
    const e = k * k * (3 - 2 * k);
    player.position.copy(from).lerp(to, e).addScaledVector(s.up, 0.18 * Math.sin(Math.PI * k));
    player.moveSpeed = 1.6 * Math.sin(Math.PI * k);
  }).then(() => {
    player.place(planet, s.front, s.fwd); player.moveSpeed = 0;
    player.cinematic = false; player.frozen = false; seatBusy = false;
  });
}

/* ------------------------------------------------------------ map: the board game (boardmap.js), built on first open */
/* the studio map table's painted map (drawMapTable) still uses two hemispheres */
function svgOf(pos, body) {
  if (body === "moon") return { x: 0, y: -86 };
  const d = pos.clone().sub(planet.centre).normalize();
  const cx = d.y >= 0 ? -48 : 48;
  return { x: cx + d.x * 42 * (d.y >= 0 ? 1 : -1), y: 10 + d.z * 42 };
}
function destinations() {
  const d = [];
  for (const s of spots) {
    if (!["game", "kiosk", "cannon"].includes(s.kind)) continue;
    const pid = byId[s.id] ? s.id : null;
    const locked = s.body === "moon" && aim < AIM_STEPS ? "Moon access denied. Aim the cannon first." : null;
    d.push({ id: s.id, label: pid ? byId[pid].name.replace("The bracket does it again", "The bracket") : s.id === "cannon" ? "Cannon" : "Moon cannon", project: pid, svg: svgOf(s.pos, s.body), size: s.kind === "game" ? 7 : 4.5, locked });
  }
  return d;
}
let boardMap = null;
function openMap() {
  if (!player || state === "loading" || state === "intro") return;
  if (focused) exitFocus();
  ensureBoardMap();
  ui.openMap(destinations(), travel);
}
$("mapBtn").onclick = () => (ui.mapOpen ? ui.closeMap() : openMap());
async function travel(id) {
  const s = spots.find(x => x.id === id); if (!s) return;
  state = "travel"; autoTarget = null;
  amb.breath();
  $("fade").classList.add("on"); await wait(420);
  const b = bodies[s.body];
  const look = s.target ? wpos(s.target) : s.pos;
  const fwd = look.clone().sub(s.pos); fwd.addScaledVector(b.up(s.pos), -fwd.dot(b.up(s.pos)));
  player.place(b, s.pos, fwd.lengthSq() > 1e-4 ? fwd.normalize() : player.facing);
  rig.release(); rig.dist = rig.distWanted = rig.home; rig.pitch = rig.homePitch; rig.zoomBase = null; rig.occHit = null;   // C4: arrive at the home view, not on the zoom/pitch/lock the last place left (a stale zoom or drag, a focus shot)
  rig.snap(player);
  if (b === planet && suited) { suited = false; setHelmet(helmet, false, "off", 0.15); }   // back home by the map: the bubble comes off
  await wait(120); $("fade").classList.remove("on"); state = "play"; updateGoal();
}
const wait = ms => new Promise(r => setTimeout(r, ms));
function setMode(mode) {
  if (mode === "list") { if (focused) exitFocus(); ui.closeMap(); $("intro").classList.add("gone"); }   // "Skip the walking": the intro (z 40) sits over the list (z 25), so it has to go too
  ui.setMode(mode);
  if (mode === "world" && state === "intro") enter();
}

/* ------------------------------------------------------------ sound effects: footsteps, jump, land (sfx.js)
   Footsteps fire on Blip's heel strikes: the clip phase where each foot comes down to within 1 cm of the
   ground, measured from the footR / footL bones at real speed (Walk 0.945 / 0.445, Run 0.975 / 0.48). Walk and
   Run share one phase (player.js syncs them), so a blend between them never drops or doubles a step.
   Surfaces: moon on the moon; wood on a support above the ground (stairs, the lookout deck, a bench);
   stone in the cave and on a terrace's flat top; path on the sandy roads and sand patches; grass elsewhere.
   No steps in the air, in pond water, seated, in a cinematic or behind a panel. A jump() is seen as
   the radial speed jumping up between frames; a landing as a fall that stopped this frame. Walking off a
   stair (<= LEDGE, < ~6.9 m/s) is not a landing unless Blip was in the air from a jump or a bounce. */
const STEP_AT = { Walk: [0.945, 0.445], Run: [0.975, 0.48] };
let sfxVrEnd = 0, sfxAir = false, sfxAct = null, sfxPh = 0, stepCave;
function stepSurface(p) {
  if (p.body === moon) return "moon";
  if (p.feet - p.body.surface(p.up) > 0.1) return "wood";
  const d = p.up;
  if (stepCave === undefined) {   // the cave floor: inside the ring of COL_cave_ anchors round the shell
    const shell = A("CAVE_shell"); stepCave = null;
    if (shell) {
      const c = wpos(shell); let r = 0, n = 0;
      for (const [name, a] of Object.entries(world.anchors)) if (/^COL_cave_\d+$/.test(name)) { r += wpos(a).distanceTo(c); n++; }
      if (n) stepCave = { n: planet.up(c), a: r / n / planet.R };
    }
  }
  if (p.body === planet && stepCave && d.angleTo(stepCave.n) < stepCave.a) return "stone";
  for (const pl of p.body.plateaus) if (d.angleTo(pl.n) < pl.t0) return "stone";
  if (p.body === planet && groundU) {
    if (roadDistance(d, groundU) < ROAD_HALF) return "path";   // the same great-circle arcs the ground shader paints (gRoad)
    if (groundFields(d).sand < 0.3) return "path";
  }
  return "grass";
}
const crossed = (a, b, c) => (a <= b ? a < c && c <= b : c > a || c <= b);   // phase c passed between a and b (with wrap)
function sfxFrame(vr0) {
  const p = player;
  if (!p || p.flight || p.cinematic) { sfxVrEnd = p ? p.vr : 0; sfxAct = null; return; }
  if (vr0 > sfxVrEnd + 3) { sfxAir = true; sfx.play("jump"); }
  else if (vr0 === 0 && p.height < 0.05) sfxAir = false;   // standing: a later walk-off is not a jump's landing
  if (vr0 < 0 && p.vr === 0 && p.height < 0.05) {
    const v = -vr0;
    if (v > (sfxAir ? 2 : 6.9 * Math.sqrt(p.gravity || 1))) sfx.play("land", { speed: v });
    sfxAir = false;
  }
  const A = p.actions, quiet = state !== "play" || seated || focused || ui.panelOpen || ui.mapOpen || videoOpen || (booth && booth.isOpen) || p.frozen;
  if (!quiet && A && A.Walk && p.height < 0.05 && p.vr <= 0 && p.moveSpeed > 1.0 && !(p.wade > 0.1)) {
    const act = A.Run && A.Run.getEffectiveWeight() > A.Walk.getEffectiveWeight() ? A.Run : A.Walk;
    const ph = (act.time / act.getClip().duration) % 1;
    if (sfxAct && STEP_AT[act.getClip().name].some(c => crossed(sfxPh, ph, c))) sfx.step(stepSurface(p));
    sfxAct = act; sfxPh = ph;
  } else sfxAct = null;
  sfxVrEnd = p.vr;
}

/* ------------------------------------------------------------ input */
input.on("key", k => {
  if (k === "escape") {
    if (ui.closeR7Modal()) return;   // R7: any module's .r7-modal closes first (ui.js's capture handler usually got there already)
    if (booth && booth.isOpen) return booth.close();
    if (videoOpen) return closeVideo();
    if (ui.mapOpen) return ui.closeMap();
    if (ui.panelOpen) return ui.closePanel();
    if (focused) return exitFocus();
    if (ui.mode === "list") return setMode("world");
  }
  if (ui.mode === "list") return;
  if (seated) return stand();
  if (k === "enter" && state === "intro") return enter();
  const overlay = videoOpen || (booth && booth.isOpen);   // the map handles its own M below; a modal in front of the world takes every other key
  if (k === "m") return ui.mapOpen ? ui.closeMap() : overlay ? undefined : openMap();
  if (overlay || ui.mapOpen) return;
  if (k === " " && state === "play") player.jump();
  if ((k === "e" || k === "enter") && state === "play" && near) useSpot(near);   // Enter is an alias of E (not in any UI text)
});

const raycaster = new THREE.Raycaster(); const ndc = new THREE.Vector2();
input.on("pointerMove", p => forward("move", p)); input.on("pointerDown", p => forward("down", p)); input.on("pointerUp", p => forward("up", p));
function forward(type, p) {
  if (!focused) return;
  ndc.set(p.nx, p.ny); raycaster.setFromCamera(ndc, camera);
  games[focused.id] && games[focused.id].pointer({ type, ray: raycaster.ray.clone(), ndc: ndc.clone(), down: p.down });
}
input.on("click", p => {
  if (seated) return stand();   // a tap anywhere on the scene stands you up (touch has no "any key")
  if (state !== "play" || !player) return;
  ndc.set(p.nx, p.ny); raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects([world.islands.planet.root, world.islands.moon.root, ...Object.values(games).map(g => g.ctx.group), ...(secretGlyph ? [secretGlyph] : [])], true)[0];
  if (!hit) return;
  if (hit.object.name === "HUB_signal") { signalSpin = 1; if (++signalClicks >= 3) { signalClicks = 0; ui.findSecret("signal", "Someone picked up."); if (window.__night) window.__night.goDark(); else if (window.__radio) window.__radio.signal(); } return; }   // R7: and someone does: the sun goes off, a UFO hangs in the sky, the radio voice; three more clicks bring the day back (it also dawns by itself after 90 s)
  // tapped something with an interaction? walk to it and use it
  for (const s of spots) {
    if (!s.target) continue;
    let o = hit.object; while (o && o !== s.target) o = o.parent;
    if (o || (s.id === "pin-art" && /^pinart-/.test(hit.object.name))) {
      if (s.body !== player.body.name) return;
      autoTarget = { pos: s.pos.clone(), spot: s, until: performance.now() + 9000 };
      return;
    }
  }
  if (hit.point.distanceTo(player.position) < 60) autoTarget = { pos: hit.point.clone(), spot: null, until: performance.now() + 7000 };
});
let signalSpin = 0, signalClicks = 0;

/* ------------------------------------------------------------ loop */
let near = null, smokeT = 0, spitTrail = false;
// audio hooks: using a spot is one select (kiosk / film spots select in kiosk() / playFilm(), with discovery);
// the prompt's spot entering is one hover; camera angular speed drives amb.motion (allocation-free); body -> place
function useSpot(s) { if (s.kind !== "kiosk" && s.kind !== "play" && s.kind !== "cannon") amb.select(s.id); s.run(); }   // the cannon's own crank / fire is its response
let hoverSpot = null, placeSeen = null;
const _mPrev = new THREE.Vector3(), _mDir = new THREE.Vector3(), _mX = new THREE.Vector3();
function motionFrame(dt) {
  if (!(dt > 0)) return;
  input.pollPads(dt);
  camera.getWorldDirection(_mDir);
  const v = _mPrev.angleTo(_mDir) / dt, dir = Math.sign(_mX.crossVectors(_mPrev, _mDir).dot(camera.up));
  _mPrev.copy(_mDir);
  amb.motion(v > 6 ? 0 : v, dir);   // > 6 rad/s is a cut (snap / teleport), not a drag
}
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => { if (!stepping) loopBody(Math.min(clock.getDelta(), 0.05), clock.elapsedTime); });
let stepping = false;   // test hook: step() owns the loop while it runs
/* landing: drag (mouse or touch) anywhere on the intro to turn the planet like a globe. The slow orbit pauses while you
   hold it and carries on after; a flick coasts to a stop. Tilt is limited so the camera never goes over a pole. */
const HERO = { r: Math.hypot(95, 42), p0: Math.atan2(42, 95), auto: 0.06, tilt: 1.3, friction: 2.5 };
const heroSpin = { orbit: 0, yaw: 0, pitch: 0, vYaw: 0, vPitch: 0, drag: null };
(function heroSpinInstall() {
  const el = $("intro"); if (!el) return;
  const stop = e => {
    const d = heroSpin.drag; if (!d || d.id !== e.pointerId) return;
    if (performance.now() - d.t > 90) heroSpin.vYaw = heroSpin.vPitch = 0;   // held still before letting go: no coast
    heroSpin.drag = null; el.classList.remove("spinning");
  };
  el.addEventListener("pointerdown", e => {
    if (e.button > 0 || e.target.closest("button,a,input")) return;
    heroSpin.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    heroSpin.vYaw = heroSpin.vPitch = 0;
    el.setPointerCapture(e.pointerId); el.classList.add("spinning");
  });
  el.addEventListener("pointermove", e => {
    const d = heroSpin.drag; if (!d || d.id !== e.pointerId) return;
    const k = 4.2 / Math.min(innerWidth, innerHeight), now = performance.now(), sec = Math.max(8, now - d.t) / 1000;
    const dYaw = -(e.clientX - d.x) * k, dPitch = (e.clientY - d.y) * k;
    heroSpin.yaw += dYaw; heroSpin.pitch = THREE.MathUtils.clamp(heroSpin.pitch + dPitch, -HERO.tilt - HERO.p0, HERO.tilt - HERO.p0);
    heroSpin.vYaw = dYaw / sec; heroSpin.vPitch = dPitch / sec;
    d.x = e.clientX; d.y = e.clientY; d.t = now;
  });
  el.addEventListener("pointerup", stop); el.addEventListener("pointercancel", stop);
})();
function heroSpinStep(dt, t) {
  const s = heroSpin;
  if (!s.drag) {
    s.orbit += dt * HERO.auto;
    s.yaw += s.vYaw * dt; s.pitch += s.vPitch * dt;
    const f = Math.exp(-dt * HERO.friction); s.vYaw *= f; s.vPitch *= f;
  }
  const yaw = s.orbit + s.yaw;
  const p = THREE.MathUtils.clamp(HERO.p0 + s.pitch + Math.sin(t * 0.1) * 0.09, -HERO.tilt, HERO.tilt);
  s.pitch = THREE.MathUtils.clamp(s.pitch, -HERO.tilt - HERO.p0, HERO.tilt - HERO.p0);
  camera.up.set(0, 1, 0);
  camera.position.set(Math.sin(yaw) * Math.cos(p) * HERO.r, 8 + Math.sin(p) * HERO.r, Math.cos(yaw) * Math.cos(p) * HERO.r);
  camera.lookAt(0, 8, 0);
}
/* vertical rhythm on the landing. The planet is drawn by the camera, not the page, so measure where it lands on
   screen (its sphere plus the Pin Art wall on top and the trees round its rim) and push the name block down until the gap
   above the planet matches the gap below it (to the load bar). Only ever pushes down; re-measured on resize, not per frame
   (the orbiting camera bobs, so a per-frame value would make the text jitter). */
const HERO_TOP = 1.55, HERO_BOT = 1.28;   // visual reach above / below the planet centre, in planet radii (wall top / rim trees)
let heroKey = "";
function heroLayout() {
  if (!planet || !planet.R) return;
  const key = innerWidth + "x" + innerHeight; if (key === heroKey) return;
  const inner = document.querySelector("#intro .intro-inner"), tag = document.querySelector("#intro .intro-tag"), bar = document.querySelector("#intro .loadbar");
  if (!inner || !tag || !bar) return;
  heroKey = key;
  inner.style.setProperty("--hero-push", "0px");
  const cam = camera.clone(); cam.position.set(0, 50, 95); cam.up.set(0, 1, 0); cam.lookAt(0, 8, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const toY = v => (1 - v.clone().project(cam).y) / 2 * innerHeight;
  const c = planet.centre.clone(), cy = toY(c), edge = toY(c.clone().addScaledVector(cam.up, planet.R)), r = Math.abs(cy - edge);
  const top = cy - HERO_TOP * r, bot = cy + HERO_BOT * r;
  const T = tag.getBoundingClientRect().bottom, B = bar.getBoundingClientRect().top;
  const push = Math.max(0, Math.round((top - T) - (B - bot)));
  inner.style.setProperty("--hero-push", Math.min(push, innerHeight * 0.2) + "px");
}
function loopBody(dt, t) {
  if (ui.mode === "list" && state !== "loading") { input.pollPads(dt); return; }   // R7 B4: the pad must work in the list view too
  if (!innerWidth || !innerHeight) return;

  if (state === "loading" || state === "intro") {
    heroSpinStep(dt, t);
    // planet hero: the planet sits alone between the name (top) and the buttons (foot), so the lens backs off and the
    // frame drops a touch; enter() puts the zoom back and the play loop clears the offset
    const narrow = innerWidth <= 640, heroZoom = narrow ? 0.8 : 0.55;
    if (camera.zoom !== heroZoom) { camera.zoom = heroZoom; camera.updateProjectionMatrix(); }
    camera.setViewOffset(innerWidth, innerHeight, 0, -innerHeight * (narrow ? 0.03 : 0.035), innerWidth, innerHeight);
    heroLayout();
    sky.update(dt, t, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    if (games["pin-art"]) games["pin-art"].update(dt, t, false, 0);
    if (player) player.animate(dt);
    motionFrame(dt);
    render(dt); return;
  }

  // input -> movement
  const look = input.consumeLook();
  if (!focused) rig.applyLook(look.dx, look.dy);
  rig.zoom(input.consumeZoom());
  const ax = state === "play" && !ui.mapOpen ? input.axes() : { x: 0, y: 0, run: false };
  let move = rig.moveVector(ax.x, ax.y);
  if (move.lengthSq() > 0.01) autoTarget = null;
  else if (autoTarget && state === "play") {
    const to = autoTarget.pos.clone().sub(player.position); to.addScaledVector(player.up, -to.dot(player.up));
    const reach = autoTarget.spot ? 1.0 + (autoTarget.spot.core || 0) : 1.4;
    if (to.length() < reach || performance.now() > autoTarget.until) {
      const s = autoTarget.spot; autoTarget = null;
      if (s && s.pos.distanceTo(player.position) < s.r + 1) useSpot(s);
    } else move = to.normalize().multiplyScalar(1);
  }
  // any stick touch stands you up, even a tap dead centre (|x|+|y| stays 0 there)
  if (seated) {
    if (input.stick.active || Math.abs(ax.x) + Math.abs(ax.y) > 0.1) stand();
    else {
      move.set(0, 0, 0);
      if (!seated.view) { seatT += dt; const w = SEATCAM.rate * (seatT < SEATCAM.ease ? (x => x * x * (3 - 2 * x))(seatT / SEATCAM.ease) : 1); rig.fwd.applyAxisAngle(rig.up, w * dt); seatYaw += w * dt; }   // the lens drifts round the seated Blip, eased in
    }
  }
  if (seatOrbit) seatOrbit.update(dt);   // idle unless the lookout marker started it
  if (sitFly) {   // the bench butterfly follows his head: a rounded top corner, carried by the body bone, so the idle bob and the seat both carry it (sitfly.js headPerch)
    if (sitFly.state !== "idle") {
      const f = player.figure; f.updateMatrixWorld(true);
      const nrm = headPerch(f, _hdP);
      _hdF.set(0, 0, -1).transformDirection(f.matrixWorld);
      sitFly.update(dt, _hdP, player.up, _hdF, nrm);
    } else sitFly.update(dt, _hdP, player.up, _hdF);
  }
  // the hint: the lookout marker's own, otherwise "stand up"
  if (seated) {
    const flying = !!(seated.view && seatOrbit && seatOrbit.active && seatOrbit.phase() !== "wait");
    if (flying !== seatHintFlying) {
      seatHintFlying = flying;
      ui.hint(seated.view ? (isTouch ? "Tap to come back" : `${anyKey()} to come back`) : (isTouch ? "Tap the stick or the scene to stand up" : `${anyKey()} to stand up`));
    }
  } else seatHintFlying = false;
  const moving = move.lengthSq() > 0.01;
  runTimers(dt);
  const sfxVr0 = player.vr;   // radial speed before this frame's physics (a jump() between frames shows here)
  if (player.cinematic) player.animate(dt); else player.update(dt, move, ax.run);
  if (blipWorry) blipWorry();   // Blip's worried reaction after Chomp's snap (bone writes must come after the mixer)
  updateHelmet(helmet, dt);
  if (player.body.name !== placeSeen) { placeSeen = player.body.name; amb.place(placeSeen); }
  boothCollide();
  // smoke trail while flying out of a cannon
  if (player.flight) { smokeT -= dt; if (smokeT <= 0) { smokeT = spitTrail ? 0.07 : 0.032; fx.puff(player.position, spitTrail ? { size: 0.28, color: SLIME, life: 0.8, grow: 1.4 } : { size: 0.34 + Math.random() * 0.22, life: 1.1 + Math.random() * 0.5, grow: 2.2 }); } }
  fx.update(dt);
  if (moving && ui.panelOpen && !focused) ui.closePanel();

  for (const [id, g] of Object.entries(games)) {
    try { g.update(dt, t, !!focused && focused.id === id, g.ctx.group.position.distanceTo(player.position)); } catch (e) { console.error(id, e); }
  }

  // nearest interaction
  // a spot with a `core` (a cast round its fire) is a ring: its distance is measured from the
  // ring's edge, so standing anywhere round it counts. Spots are ranked by how far into their own
  // reach you are (0 at the centre or ring, 1 at the edge), not by metres: a creature with a 2.8 m
  // reach does not out-shout the 2 m bench you are walking up to. The prompt you have keeps
  // winning until another is clearly deeper (0.12) or you step 0.4 m past its reach: no flip-flop.
  const prev = near; near = null;
  if (state === "play" && !player.flight && !fauna.some(c => c.busy)) {
    let bd = Infinity, pd = Infinity, top = null, td = Infinity;
    for (const s of spots) {
      if (s.body !== player.body.name || (s.off && s.off())) continue;
      const raw = (s.at ? s.at() : s.pos).distanceTo(player.position), d = Math.max(0, raw - (s.core || 0)) / Math.max(0.5, s.r - (s.core || 0));   // `at`: where the reach is measured from, when that is not the stand point
      if (s === prev && raw < s.r + 0.4) pd = d;
      if (raw < s.r && d < bd) { bd = d; near = s; }
      if (s.prio && raw < s.r && d < td) { td = d; top = s; }
    }
    if (pd < Infinity && (!near || pd < bd + 0.12)) near = prev;
    if (top && !(near && near.prio)) near = top;   // a `prio` spot (the map table inside Pin Art's wide reach) wins wherever you can touch it
  }
  const label = near ? (near.kind === "cannon" && near.id === "cannon" ? cannonLabel() : near.label) : null;
  ui.prompt(label && !ui.mapOpen && !ui.panelOpen && !seated && !(booth && booth.isOpen) ? label : null, () => near && useSpot(near), near);   // UB: `near` also feeds the bulb's contextual hint
  const shownSpot = label && !ui.mapOpen && !ui.panelOpen && !seated && !(booth && booth.isOpen) ? near : null;
  if (!near) hoverSpot = null;   // walking away re-arms; a panel / map / booth hiding the prompt does not
  else if (shownSpot && shownSpot !== hoverSpot) { hoverSpot = shownSpot; amb.hover(shownSpot.id); }

  // cannon: wheel turns, barrel swings to its aim and kicks when fired
  if (barrel) {
    aimShown = THREE.MathUtils.damp(aimShown, aim, 3, dt);
    const off = (AIM_STEPS - aimShown) * 0.95;
    barrel.quaternion.copy(barrel.userData.q0).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), off));
    wheel.quaternion.copy(wheel.userData.q0).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), aimShown * 2.4));
    [barrel, wheel].forEach(o => { const h = o.userData.hull; if (h) { h.quaternion.copy(o.quaternion); h.scale.copy(o.scale); } });
    K1update(!!shownSpot && shownSpot.id === "cannon", t);   // K1: the marker on the active step
  }
  if (secretGlyph) secretGlyph.rotation.y += dt * 1.2;
  if (topGlyph) topGlyph.rotation.y += dt * 1.5;
  updateCasts(dt, t);
  if (ripple.t < 1) { ripple.t = Math.min(1, ripple.t + dt / 1.6); ripple.mesh.scale.setScalar(1 + ripple.t * 14); ripple.mesh.material.opacity = (1 - ripple.t) * 0.8; }
  updateSlabs(dt);
  const sig = world.anchors.HUB_signal;
  if (sig) { signalSpin = Math.max(0, signalSpin - dt * 0.6); sig.rotation.z += dt * (0.4 + signalSpin * 9); }
  updateFauna(dt);
  mapTableTick();
  birds && birds.update(dt, t);
  grass && grass.update(t, player.body === planet ? player.position : null);
  if (fieldFloor) {   // toast on every tile change, so it always names what the kiosk screen shows
    const ch = fieldFloor.update(dt, t, player.body === planet && state === "play" ? player : null);
    if (ch) ui.toast(ch.html || `<b>${ch.name}</b> · ${ch.i + 1}/${FIELD_EFFECTS.length}`, 1400);   // GB3: one format, "Name · n/9" 
  }
  if (hive) {   // toast on each move hex Blip steps onto: "Title · n/5"
    if (grass && !hive.grassDone) hive.clearGrass(grass);
    const ch = hive.update(dt, t, player.body === planet && state === "play" ? player : null);
    if (ch) ui.toast(ch.html, 2600);
  }
  if (vending) vending.update(dt, t, camera);
  moonwalkUpdate(dt, t, player, state);
  if (moonPlay) {
    player.gravity = player.body === moon ? 0.35 : 1;   // floaty on the moon
    const ev = moonPlay.update(dt, t, player, fx);
    if (ev.bounce) { sfxAir = true; sfx.play("trampoline"); }
    if (ev.grab) sfx.play("star");
    if (ev.done) sfx.play("star", { gain: 1.4 });
    if (ev.bounce && !ui.puzzles.bounced) { ui.puzzles.bounced = true; ui.save(); ui.toast("Boing. Again, but with more ambition.", 2600); }
    if (ev.grab) ui.toast(`Pocketed a star for ${CONSTELLATION_NAME} · ${ev.grab} / ${moonPlay.stars.length}`, 2200);
    if (ev.star) { ui.puzzles.stars = moonPlay.found; ui.save(); }
    if (ev.done) {
      ui.toast(`Five stars rescued. Look up: that’s ${CONSTELLATION_NAME}. The sky made you something.`, 6000); player.play("Cheer");
      // cut to a held shot of the whole constellation (from much of the moon it is below the horizon, and a glide there would pass through the moon), then cut back
      const v = moonPlay.skyShot(camera);
      rig.focus(v.pos, v.look, v.up); camera.position.copy(v.pos); rig.look.copy(v.look); camera.up.copy(v.up);
      player.frozen = true;
      sleep(6).then(() => { player.frozen = false; if (rig.mode === "focus" && rig.focusPos.equals(v.pos)) { rig.release(); rig.snap(player); } });
    }
  }
  sfxFrame(sfxVr0);
  if (butterflies) {
    if (butterflies.update(dt, t, player.position, player.viewUp, player.body, camera.position)) {
      sfx.play("butterfly");
      // never talk over another message (the lookout's moon toast: the deck's butterfly joins a second later)
      const say = () => { const el = document.getElementById("toast"); if (el && (slate.active || el.classList.contains("show")) && !el.textContent.startsWith("Butterflies")) sleep(0.5).then(say); else ui.toast(`Butterflies ${butterflies.collected} / ${butterflies.total}`, 1800); };
      say();
    }
    butterflies.setVisible(!focused);
  }
  for (const w of waters) w.uniforms.uTime.value = t;   // uSun is sky.sunDir itself (bound in waterMaterial)
  if (pondWater) pondWater.update(dt, t, state === "play" && !player.flight ? player : null, butterflies);
  if (state === "play") checkLookout();

  // camera
  if (introShot) {
    introShot.t = Math.min(1, introShot.t + dt / 2.8);
    const k = 1 - Math.pow(1 - introShot.t, 3);
    // the rig keeps its own lens (introShot.to): fed the blended position instead, its 1-exp(-9dt) catch-up made the blend's
    // target depend on each frame's length, so uneven frames (13/20 ms) stepped the camera back and forth for the first ~2 s
    camera.position.copy(introShot.to);
    rig.update(dt, player);
    introShot.to.copy(camera.position);
    camera.position.copy(introShot.from).lerp(introShot.to, k);
    camera.lookAt(rig.look);
    if (introShot.t >= 1) introShot = null;
  } else {
    if (input.pointer.down && rig.freed) rig.idleT = 0;   // a mouse held still mid-drag is not idle (no recentre)
    rig.update(dt, player);
  }
  if (pinOcc) pinOcc.update(dt);   // keeps the pin-art volume in rig.occluders (occluders.js)
  if (rig.occFade) { const inBooth = !!(booth && booth.isOpen); rig.occFade.update(dt, state === "play" && (rig.mode === "follow" || inBooth) && !player.flight, inBooth); }
  boothStage(dt);
  fx.applyShake(camera, dt);
  slate.update(dt, player.position);

  // side panel: shift the view's centre into the free space
  const wantOff = (ui.panelOpen || (booth && booth.isOpen)) && innerWidth >= 900 ? (Math.min(400, innerWidth) + 24) / 2 : 0;
  viewOff = THREE.MathUtils.damp(viewOff, wantOff, 5, dt);
  if (Math.abs(viewOff) > 0.5) camera.setViewOffset(innerWidth, innerHeight, viewOff, 0, innerWidth, innerHeight);
  else if (camera.view && camera.view.enabled) camera.clearViewOffset();

  for (const n of nearProps) {
    if (n.follow) n.c.copy(n.follow.position).add(n.lift);
    const gap = camera.position.distanceTo(n.c) - n.r;
    const show = n.o.visible ? gap > 0.8 : gap > 1.8;   // hysteresis: no blinking at the threshold
    if (n.o.visible !== show) { n.o.visible = show; if (n.hull) n.hull.visible = show; }
  }
  sky.update(dt, t, player.position, player.up, camera.position);
  motionFrame(dt);
  render(dt);
}
const nearProps = [];
let viewOff = 0;
function render(dt) { inkResize(renderer); if (ascii.active) ascii.render(scene, camera, dt); else renderer.render(scene, camera); }

window.__archipelago = { get boardMap() { return boardMap; }, openMap, get helmet() { return helmet; }, get suited() { return suited; }, slate, get booth() { return booth; }, get boothProp() { return boothProp; }, renderer, camera, get sky() { return sky; }, get groundU() { return groundU; }, fx, get grass() { return grass; }, get moonPlay() { return moonPlay; }, get vending() { return vending; }, get fieldFloor() { return fieldFloor; }, fauna, signPosts, get birds() { return birds; }, get butterflies() { return butterflies; }, sit, stand, get seated() { return seated; }, get sitFly() { return sitFly; }, get seatOrbit() { return seatOrbit; }, SEATCAM, SITFLY, get seatYaw() { return seatYaw; }, checkLookout, world, ui, rig, travel, spots, games, bodies, get player() { return player; }, get state() { return state; }, get audio() { return amb; }, fire, useCannon, updateGoal,
  // test hooks: skip the opening move; step the simulation without waiting for frames
  skipIntro() { introShot = null; rig.snap(player); },
  step(n = 1, dt = 1 / 60) { stepping = true; for (let i = 0; i < n; i++) loopBody(dt, (stepT += dt)); stepping = false; clock.getDelta(); } };
let stepT = 0;

/* ------------------------------------------------------------ photo booth on the lookout deck
   A box camera on a tripod on the top deck, in LOOKOUT-local coordinates (deck top y 7.98; up = +y).
   The stairwell gap spans ~70..170 deg, the stair's last steps arrive at ~60..75 deg
   and you step off toward smaller angles, the moon lies at 126 deg (above the gap) and the moon-reveal
   lens sits behind Blip at ~-54 deg. -150 deg at 1.75 m is clear of all three. Its own small round
   collider (deck height only: the stair winds below it) keeps Blip out of the prop. */
let booth = null, boothProp = null, boothC = null, boothN = null, lookC = null;
const BOOTH_AT = { ang: -150, r: 1.75, rad: 0.36, lens: 62 };
/* L2 follow-up: the dress-up lens is placed relative to the moon's bearing from the deck. layoutStair turned the whole stair (deck, bench, booth) about
   the planet centre, so the real bearing no longer is the one the lens was approved with (it swung the lens into the lookout bench). The lens takes the
   bearing the moon had before the move: the moon's centre carried through the same rotation (BOOTH_STAIR_FROM = the old PLATEAU_monument direction). */
const BOOTH_STAIR_FROM = [0.6040, 0.7660, -0.2198];
const boothMoon = { get centre() {
  const C = planet.centre, q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...BOOTH_STAIR_FROM).normalize(), new THREE.Vector3(...STAIR_TO).normalize());
  return moon.centre.clone().sub(C).applyQuaternion(q).add(C);
} };
function setupBooth(pr) {
  booth = new Booth({ player, renderer, scene, moon: boothMoon, camera, onOpen: boothOpen, onClose: boothClose, sfx, sound: amb });
  const lk = pr.getObjectByName("LOOKOUT"); if (!lk) return;
  lk.geometry.computeBoundingBox();
  const a = BOOTH_AT.ang * Math.PI / 180, x = Math.cos(a) * BOOTH_AT.r, z = Math.sin(a) * BOOTH_AT.r;
  boothProp = makeBooth();
  boothProp.position.set(x, lk.geometry.boundingBox.max.y, z);
  // the lens (-z) looks inward across the deck, at the top of the stair, so it faces whoever comes up
  const lens = BOOTH_AT.lens * Math.PI / 180;
  boothProp.rotation.y = Math.atan2(-Math.cos(lens), -Math.sin(lens));
  lk.add(boothProp); boothProp.updateMatrixWorld(true);
  boothProp.traverse(o => { if (o.isMesh && !o.userData.isOutline) { o.geometry.computeBoundsTree(); rig.occluders.push(o); } });
  boothC = boothProp.getWorldPosition(new THREE.Vector3()); boothN = planet.up(boothC);
  lookC = lk.getWorldPosition(new THREE.Vector3());
  const stand = lk.localToWorld(new THREE.Vector3(x * 0.55, lk.geometry.boundingBox.max.y, z * 0.55));
  spots.push({ id: "booth", kind: "booth", pos: stand, r: 1.6, body: "planet", label: "Give Blip a makeover", target: boothProp,
    run: () => {   // turn side-on to the booth so the lens can swing round in front of Blip
      const t = new THREE.Vector3().crossVectors(boothN, boothC.clone().sub(player.position)).normalize();
      if (t.lengthSq() > 0.5) player.facing.copy(t);
      booth.open();
    } });
}
function boothCollide() {
  if (!boothC || player.body !== planet || player.flight) return;
  const d = player.position.clone().sub(boothC), h = d.dot(boothN);
  if (h < -0.3 || h > 1.6) return;
  d.addScaledVector(boothN, -h);
  const l = d.length(), min = BOOTH_AT.rad + 0.42;
  if (l >= min || l < 1e-5) return;
  player.position.addScaledVector(d, (min - l) / l);
  // never out past the deck's wall (2.4 m round the column): behind the booth is too narrow to pass
  const r = player.position.clone().sub(lookC); r.addScaledVector(boothN, -r.dot(boothN));
  if (r.length() > 2.4) player.position.addScaledVector(r, (2.4 - r.length()) / r.length());
}
/* The dress-up lens (the pose itself is booth.js `dressPose`, shared with the postcard camera): a low,
   slightly upward shot from the moon-ward side of Blip, so the background is open sky, the moon and clouds. Blip turns to
   the lens through player.update's own orient (no snap). The rail, column, stair, the booth and the hub signal ring would
   cut the frame from there, so once the lens is nearly home they fade out (the occluder fade's own eased fade: 0.15 s in,
   0.4 s out), and they fade back as soon as the panel closes. boothStage(dt) runs just after the occluder fade's update. */
function boothOpen() {
  ui.closePanel(); if (ui.mapOpen) ui.closeMap();
  player.frozen = true; autoTarget = null;
  const g = booth.livePose();
  player.facing.copy(g.facing);
  rig.focus(g.pos, g.look, g.up);
}
let stageOn = false, stageT = 0;
let viewMarker = null;
function boothStage(dt) {
  // on from the moment the lens is within 14 m of its dress-up pose (so a stair slab, the rail or the ring is already melting
  // before the lens flies through it) until the lens is 9 m away again after the panel closes (so nothing fades back in across
  // the frame; capped at 1.2 s in case the follow lens settles close by)
  const d = camera.position.distanceTo(rig.focusPos);
  if (booth && booth.isOpen && rig.mode === "focus") { if (d < 14) { stageOn = true; stageT = 0; } }
  else if (stageOn && (d > 9 || (stageT += dt) > 1.2)) stageOn = false;
  const on = stageOn;
  if (on) for (const it of rig.occFade ? rig.occFade.items : []) if (STAGE_FADE.test(it.o.name)) it.hold = Math.max(it.hold, dt * 2);   // (occfade only decays a hold, so this holds it faded while on)
  { const vm = viewMarker || (viewMarker = scene.getObjectByName("VIEW_marker")); if (vm && vm.visible === on) vm.visible = !on; }   // the "Take in the view" plinth is not an occluder (no fade item), so it simply steps out while the booth stage is on and stays out of the photo (booth.js STAGE_HIDE too)
  if (rig.stageFade) { for (const it of rig.stageFade.items) if (on) it.hold = Math.max(it.hold, dt * 2); rig.stageFade.update(dt, false, true); }
}
function boothClose() { player.frozen = false; rig.release(); }
$("boothBtn").onclick = () => { if (!booth || state !== "play") return; booth.isOpen ? booth.close() : booth.open(); };
