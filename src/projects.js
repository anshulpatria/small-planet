/* The nine projects, copied from the PROJECTS array on anshulpatria.github.io
   (names, myths, descriptions, type and input are the site's own words).
   `tech` lists only what was verified in each project's shipped source.
   `island` names the GLB the project lives in; satellites share one plinth asset. */

export const PROJECTS = [
  { id: "pin-art", ord: "II", glyph: "eye", island: "pin-art", status: "built",
    name: "Pin Art 3D", type: "Toy", input: "Orbit",
    myth: "It holds whatever you press into it.",
    desc: "A pinscreen driven by depth. Push the pins by hand or imprint a photograph, then relight it and orbit around.",
    tech: ["three.js", "InstancedMesh"],
    url: "https://anshulpatria.github.io/3D-pin-art/", shot: "assets/shots/pin-art-3d.jpg",
    verb: "Push the pins" },

  { id: "gravity-pong", ord: "I", glyph: "lotus", island: "gravity-pong", status: "blockout",
    name: "Gravity Pong", type: "Game", input: "Keys",
    myth: "You meant to leave an hour ago.",
    desc: "Pong with gravity wells in the court. Power shots, magnets, one or two players.",
    tech: ["Canvas 2D", "JavaScript"],
    url: "https://anshulpatria.github.io/gravitypong/", shot: "assets/shots/gravity-pong.jpg",
    verb: "Curve a shot" },

  { id: "brand-studio", ord: "III", glyph: "pig", island: "brand-studio", status: "blockout",
    name: "Brand Studio", type: "Tool", input: "Drag",
    myth: "Marks that move until you stop them.",
    desc: "Builds whole identity systems out of a metaball grid. Custom SVG and canvas renderers, exporting stills and video.",
    tech: ["SVG", "Canvas 2D"],
    url: "https://anshulpatria.github.io/brandstudio/", shot: "assets/shots/brand-studio.jpg",
    verb: "Match the mark" },

  { id: "engraver", ord: "VIII", glyph: "raft", island: "engraver", status: "blockout",
    name: "Engraver", type: "Tool", input: "Upload",
    myth: "Underneath, it was always lines.",
    desc: "Redraws any image as a grid of strokes. Set the density and the contrast, then export it as SVG, PNG or WebM.",
    tech: ["Canvas 2D", "SVG", "MediaRecorder"],
    url: "https://anshulpatria.github.io/linevisualiser/", shot: "assets/shots/line-visualizer.jpg",
    verb: "Turn the dial" },

  { id: "field", ord: "IV", glyph: "song", island: "satellite", status: "satellite",
    name: "Field", type: "Catalog", input: "Hover",
    myth: "Pick one. Then pick another.",
    desc: "Twenty generative effects that follow the cursor. Open a tile, read how it works, turn the parameters, take the code.",
    url: "https://field-8yc.pages.dev/", shot: "assets/shots/field.jpg", verb: "Look closer" },

  { id: "genai-after-hours", ord: "V", glyph: "bottle", island: "satellite", status: "satellite",
    name: "GenAI After Hours", type: "Deck", input: "Arrows",
    myth: "Ninety minutes, not seven years.",
    desc: "Slides from a ninety minute session on building microsites with AI tools.",
    url: "https://anshulpatria.github.io/genaiafterhourspub/", shot: "assets/shots/genai-after-hours.jpg", verb: "Look closer" },

  { id: "orchestrator", ord: "VI", glyph: "wave", island: "satellite", status: "satellite",
    name: "Orchestrator", type: "Video", input: "Watch",
    myth: "Agentic workflows, from scratch.",
    desc: "A generated film, assembled in under sixteen hours of prompting with Magnific.",
    url: "https://youtu.be/oySlLRl5EBI", shot: "assets/shots/orchestrator.jpg", verb: "Look closer" },

  { id: "the-bracket", ord: "VII", glyph: "bracket", island: "satellite", status: "satellite",
    name: "The bracket does it again", type: "Video", input: "Watch",
    myth: "Nobody remembers the third bullet.",
    desc: "A short film for the Live Slides training, on finding the story already sitting inside the most ordinary deck in the building.",
    url: "https://youtu.be/M1nIsHUE6dg", shot: "assets/shots/live-slides.jpg", verb: "Look closer" },

  { id: "artboard-42", ord: "IX", glyph: "throne", island: "satellite", status: "satellite",
    name: "Artboard 42", type: "Site", input: "Scroll",
    myth: "Home.",
    desc: "The main portfolio.",
    url: "https://www.artboard42.com", shot: "assets/shots/artboard-42.jpg", verb: "Look closer" },
];

export const byId = Object.fromEntries(PROJECTS.map(p => [p.id, p]));

/* Bodies in load order: the planet and the shared parts gate the loader; the moon streams in after. */
export const ISLANDS = [
  { id: "shared-assets", file: "assets/models/shared-assets.glb", eager: true },
  { id: "planet",        file: "assets/models/planet.glb",        eager: true },
  { id: "moon",          file: "assets/models/moon.glb",          eager: false },
];

/* the four projects that are full mini-games (modules in ./games/) */
export const GAMES = ["pin-art", "gravity-pong", "brand-studio", "engraver"];

/* Glyphs: the site's own plate names, drawn as small geometric marks. */
export const GLYPHS = {
  lotus:   '<path d="M12 4c2.5 3 2.5 7 0 10-2.5-3-2.5-7 0-10Zm-7 5c3 .5 5.5 3 7 5-3 .5-6-1.5-7-5Zm14 0c-1 3.5-4 5.5-7 5 1.5-2 4-4.5 7-5ZM5 18h14"/>',
  eye:     '<path d="M3 12c4-6 14-6 18 0-4 6-14 6-18 0Z"/><circle cx="12" cy="12" r="2.6"/>',
  pig:     '<rect x="4" y="7" width="16" height="11" rx="5"/><circle cx="12" cy="12.5" r="2.2"/><path d="M7 7 6 4M17 7l1-3"/>',
  song:    '<path d="M9 17V6l10-2v11"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="15" r="2"/>',
  bottle:  '<path d="M10 3h4v4l2 3v10H8V10l2-3Z"/><path d="M8 14h8"/>',
  wave:    '<path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/><path d="M3 17c2-4 4-4 6 0s4 4 6 0 4-4 6 0" opacity=".5"/>',
  bracket: '<path d="M9 4H6v16h3M15 4h3v16h-3"/><path d="M10 12h4"/>',
  raft:    '<path d="M3 15h18M5 15V9M9 15V7M13 15V8M17 15V10M4 19h16"/>',
  throne:  '<path d="M7 20V4h10v16M7 12h10M5 20h14"/>',
};
