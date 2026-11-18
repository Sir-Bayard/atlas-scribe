/**
 * The Plan: what the GM has decided about a map. Everything else is generated from it.
 *
 * A plan is JSON. Positions are in grid squares from the top left (y down); sizes are in feet. Materials are
 * plain words ("slate", "cobble"); the style and season turn them into art. One list of features, each with an
 * id and a type; TYPES below says what each type takes, and drives the defaults, the checker and the panel.
 * Pure: runs in the worker, on the page and under node.
 */

import { CHARACTERS } from "./character.mjs";
import { USES, TRADES } from "./uses.mjs";

/** Where in its district a centerpiece may stand (a district's anchorAt; left out, the plan's seed picks). */
export const ANCHOR_PLACES = ["middle", "side", "edge"];

export const PLAN_VERSION = 1;

/**
 * Field kinds: number, string, boolean, enum (one of values), object, list. `byClass` defaults depend on the feature's
 * class; `only` lists the classes a field means anything for (the window shows it only for those).
 */
const num = (dflt, extra = {}) => ({ kind: "number", default: dflt, ...extra });
const str = (dflt = null, extra = {}) => ({ kind: "string", default: dflt, ...extra });
const bool = (dflt) => ({ kind: "boolean", default: dflt });
const oneOf = (values, dflt) => ({ kind: "enum", values, default: dflt });
const listOf = (values, dflt = null) => ({ kind: "list", values, default: dflt });
const pointOf = () => ({ kind: "point", default: null });

/**
 * Roof materials. The plain words ("slate", "wood-shingle") are the old defaults; the rest name a color. Tile
 * colors come in several tile shapes (round, flat, beaver tail), picked by the building's variant.
 */
export const ROOFS = [
  "slate", "slate-black", "slate-blue", "slate-purple", "slate-mossy",
  "tile-red", "tile-orange", "tile-brown", "tile-tan", "tile-gray", "tile-black", "tile-blue", "tile-green", "tile-purple", "tile-mossy",
  "wood-shingle", "wood-shingle-dark", "wood-shingle-light", "wood-shingle-red", "wood-shingle-ashen", "wood-shingle-walnut",
  "thatch",
];

/**
 * Roof forms. gable: two slopes, upright ends. hip: four slopes. half-hip: a gable with its peak clipped into a small
 * hip. pyramid: four slopes to one point. flat: a flat roof behind a low parapet. mansard: steep slopes around a flat
 * top with a skylight. A round building always gets a cone.
 */
export const ROOF_STYLES = ["gable", "hip", "half-hip", "pyramid", "flat", "mansard"];
export const SURFACES = ["dirt", "slush", "snow", "trodden", "cobble", "gravel", "grass", "mud", "flagstone", "setts", "herringbone", "brick", "tiles"];

/** Water along a path, and water drawn as a shape (a body of water); the shores a body of water can have. */
export const RUNNING = ["stream", "river", "canal"];
export const BODIES = ["pond", "lake", "sea"];
export const SHORES = ["sand", "pebbles", "rocks", "grass", "marsh", "reeds"];

/** The wall classes with towers, gates and a clear strip inside: town walls and palisades. */
export const TOWN_WALLS = ["town", "palisade"];

/**
 * Feature types. geometry: "point" (at), "path" (path), "shape" (shape), "path|shape", or "buildings" (a landmark).
 * classes: the allowed classes, the first being the default.
 */
export const TYPES = {
  road: {
    geometry: "path",
    classes: ["street", "highway", "lane", "track", "path"],
    fields: {
      width: num(null, { unit: "ft", min: 1, max: 200, byClass: { highway: 30, street: 20, lane: 15, track: 10, path: 5 } }),
      surface: oneOf(SURFACES, "dirt"),
      ruts: bool(false),
      straight: bool(false), // drawn straight between its points; else it curves smoothly through them
      // (on a battle map: the road runs in a cut this many feet below the ground either side, a holloway or sunken
      // lane, its banks a cliff past 5 ft; its faces lie outside its width)
      sunken: num(null, { unit: "ft", min: 1, max: 60 }),
    },
  },
  water: {
    // A stream, river or canal runs along a path; a pond, lake or sea is a shape (a sea's corners near the map's edge
    // go past it, so its outline is the coast)
    geometry: "path|shape",
    classes: ["stream", "river", "canal", "pond", "lake", "sea"],
    fields: {
      width: num(null, { unit: "ft", min: 1, max: 2000, byClass: { stream: 15, river: 60, canal: 20 }, only: RUNNING }), // at its first point
      endWidth: num(null, { unit: "ft", min: 1, max: 2000, only: RUNNING }), // at its last point, widening or narrowing smoothly between; else the same all along
      widths: { kind: "data", default: null, only: RUNNING }, // one width in feet for each point of its path (wins over width and endWidth)
      shore: { ...oneOf(SHORES, null), only: BODIES, fallback: "picked from its seed" },
      frozen: { kind: "boolean", default: false, byClass: { pond: null, lake: null } }, // a pond or lake left unset freezes in winter
      straight: bool(false), // drawn straight between its points (a canal, a stone basin); else it curves smoothly through them
      shallows: { ...bool(false), only: RUNNING }, // gravel bars in the shallows on the inside of its bends
      islands: num(0, { min: 0, max: 6, integer: true, only: RUNNING }), // small islands where it runs wide and straight (settlement maps)
      // On a battle map: how far below its banks its bed lies, how its banks come down, and their rock
      depth: num(null, { unit: "ft", min: 0, max: 60, byClass: { stream: 5, river: 10, canal: 5 }, only: RUNNING }),
      banks: { ...oneOf(["bank", "cliff", "slope"], "bank"), only: RUNNING },
      rock: { ...oneOf(["earthy", "slate", "mossy"], null), only: RUNNING, fallback: "picked from its seed" },
      // On a battle map in winter: ice along its banks (shelves either side of an open channel), unless it's frozen
      // over or none; outside winter it stays open
      ice: { ...oneOf(["edges", "none"], null), only: RUNNING, fallback: "ice along its banks in winter on a battle map" },
      // (a Climb DC for its banks where they're cliffs; else natural rock's, CLIMB_DC in rules.mjs)
      climbDC: { ...num(null, { min: 1, max: 60, integer: true }), only: RUNNING, fallback: "15, natural rock's" },
    },
  },
  height: {
    // On a battle map: ground standing higher or lower than around it (a rise, a ledge, a hollow), its height in feet
    // (below the ground around for a hollow), its edge a cliff, a steep bank or a walkable slope
    geometry: "shape",
    fields: {
      name: str(),
      height: num(10, { unit: "ft", min: -60, max: 60 }),
      edge: { ...oneOf(["cliff", "bank", "slope"], null), fallback: "a bank for 5 ft or less, else a cliff" },
      // (stretches of its outline with an edge of their own: [{ from, to, edge }], from and to its outline's point
      // numbers counted from 0, running from one to the other in the outline's own order; a collapse, ramp or breach
      // in a cliff, say)
      edges: { kind: "stretches", values: ["cliff", "bank", "slope"], default: null },
      rock: { ...oneOf(["earthy", "slate", "mossy"], null), fallback: "picked from its seed" },
      // (the Climb DC of its edge where it's a cliff; else natural rock's, or a cut or built face's when straight)
      climbDC: { ...num(null, { min: 1, max: 60, integer: true }), fallback: "15, or 20 with sharp corners (a cut or built face)" },
      rot: num(0, { unit: "deg" }),
      straight: bool(false), // its corners kept sharp (a quarry's cut, a built terrace); else rounded as ground lies
    },
  },
  dock: {
    // A quay or wharf runs along the water's edge (its line is moved onto the nearest edge, and houses front it); a
    // pier or jetty runs out into the water
    geometry: "path",
    classes: ["quay", "wharf", "pier", "jetty"],
    fields: {
      width: num(null, { unit: "ft", min: 3, max: 200, byClass: { quay: 15, wharf: 15, pier: 15, jetty: 6 } }),
      material: { ...oneOf(["stone", "wood"], null), byClass: { quay: "stone", wharf: "wood", pier: "stone", jetty: "wood" } },
    },
  },
  crossing: {
    geometry: "point",
    classes: ["bridge", "footbridge", "ford"],
    fields: {
      angle: num(0, { unit: "deg" }),
      length: num(null, { unit: "ft", min: 1, max: 2000, byClass: { bridge: 60, footbridge: 40, ford: 50 } }),
      width: num(null, { unit: "ft", min: 1, max: 200, byClass: { bridge: 20, footbridge: 10, ford: 50 } }),
      frozen: bool(false),
    },
  },
  square: {
    geometry: "shape",
    fields: { surface: oneOf(SURFACES, "cobble"), name: str(), radial: bool(false), market: bool(false), middle: { ...oneOf(["fountain", "cross", "none"], null), fallback: "its seed picks one" } },
  },
  building: {
    geometry: "shape",
    fields: {
      roof: oneOf(ROOFS, "slate"),
      height: num(20, { unit: "ft", min: 1, max: 500 }),
      rot: num(0, { unit: "deg" }),
      chimney: { kind: "boolean", default: null }, // null: the generator decides
      roofStyle: { ...oneOf(ROOF_STYLES, "gable"), fallback: "it's drawn as a gable" },
      variant: num(null, { min: 0, max: 999, integer: true }), // which of the roof art's pieces (else from the seed)
      name: str(),
      use: { ...oneOf(USES, null), fallback: "it's taken as a house" }, // what it's for (a pinned building keeps its use); named on the scene's labels
      rooms: str(), // its rooms on a battle map, in words ("common room with stage, kitchen, 2 bedrooms"); else from its use
      // Its floors on a battle map (each a level of the scene): how many above the ground floor (else by its use: an
      // inn's guest floor, a keep's two), whether it has a cellar (else by its use), and their rooms in words
      floors: num(null, { min: 0, max: 3, integer: true }),
      cellar: { kind: "boolean", default: null },
      upstairs: str(), // the rooms of each floor above, in words ("7 bedrooms"); else by its use
      cellarRooms: str(), // the cellar's rooms, in words ("cellar, storeroom"); else by its use
      // A pinned generated building keeps how it was drawn: where its chimney stands ({ u, v, variant }), the ends
      // that run into another roof (join) and the hips that start in from a corner (cut)
      tower: bool(false), // drawn as a tower: a flat roof inside a parapet, a round one too (a pinned watch post)
      crenels: bool(false), // a tower's parapet notched as battlements
      chimneyAt: { kind: "data", default: null },
      join: { kind: "data", default: null },
      cut: { kind: "data", default: null },
    },
  },
  landmark: {
    geometry: "buildings",
    fields: { name: str() },
  },
  district: {
    geometry: "shape",
    fields: {
      name: str(), // what the window and the outlines call it; else its id
      profile: str("village"),
      character: { ...oneOf(CHARACTERS, "homes"), fallback: "it's built as homes" }, // what it's for, beside how built up it is (see character.mjs)
      trades: listOf(TRADES), // the trades worked there, each sited by its rule (a crafts district picks some if none are given)
      notable: bool(true), // a temple, an inn and a smithy of its own, as a place its size would have
      notables: { kind: "data", default: null }, // { temple, inn, smithy }: true gives the settlement one, false none (Quick Start's)
      streets: bool(true), // streets and lanes of its own between the roads through it; off, only the plan's (a zoomed battle map's, whose streets come from its overview)
      uses: bool(true), // its character's buildings and trades (warehouses, mansions, workshops, shops); off, its houses are all plain (a zoomed battle map's, whose notable buildings come from its overview)
      anchor: bool(true), // its character's landmark on its own square (a temple quarter's cathedral, the nobles' palace)
      anchorAt: { ...oneOf(ANCHOR_PLACES, null), fallback: "its place is picked from the map's seed" }, // where it stands: in the middle, off to one side, at the edge; else picked from the plan's seed
      anchorToward: { kind: "data", default: null }, // [x, y]: the point its landmark is placed toward (a city's central square)
      gardens: num(null, { min: 0, max: 1 }), // the share of houses with a tended garden, else its character's (true and false still read)
      density: num(1, { min: 0, max: 1 }),
      surface: oneOf(SURFACES, null), // its streets' surface; else the surface of a road through it
      bend: num(null, { unit: "deg", min: 0, max: 90 }),
      spacing: num(null, { unit: "ft", min: 25, max: 2000 }),
      axis: num(null, { unit: "deg" }),
      spacious: num(0, { min: 0, max: 1 }),
      crofts: num(null, { min: 0, max: 1 }), // the share of plots with a croft behind; else the type's
      croftDepth: num(null, { min: 0.1, max: 1 }), // how far back a croft runs, as a share of the plot behind the yard; else the type's
      croftFence: oneOf(["all", "sides", "none"], null), // the croft's fence: all around, sides only (open at the back), none; else the type's
      plotLines: bool(false), // draw plot lines: yard and croft fences in hamlets and villages, faint walls between long plots elsewhere
      roofs: listOf(ROOFS), // the roof materials its houses choose from, equally; else a mix picked for its type from its seed
      roofStyles: listOf(ROOF_STYLES), // the roof forms its houses choose from, equally; else its type's mix
    },
  },
  area: {
    geometry: "shape",
    classes: ["yard", "farmstead", "woods", "trodden", "fields", "park", "cemetery", "cave", "dungeon", "mountains", "hills", "marsh"],
    fields: {
      name: str(), // what the window and the outlines call it; else its id
      surface: { ...oneOf(SURFACES, null), only: ["yard"] },
      fence: { ...oneOf(["wattle", "wood", "stone"], null), only: ["yard"] },
      rot: num(0, { unit: "deg" }),
      trees: num(null, { min: 0, max: 20000, integer: true, only: ["woods"] }),
      density: { ...oneOf(["sparse", "open", "thick", "dense"], null), only: ["woods"], fallback: "it's drawn as thick" }, // a wood's: how thick its trees stand (thick if left out); a tree count wins
      mix: { kind: "object", default: null, only: ["woods"] }, // a wood's species shares, { bare: 0.15 } (the rest are firs)
      cleared: { ...bool(false), only: ["woods"] }, // a wood thinned toward the town: scattered trees and stumps near it, thick far from it
      style: { ...oneOf(["green", "formal"], null), only: ["park"] }, // a park's: a village green (the default) or a formal garden
      feature: { ...oneOf(["pond", "well", "maypole", "cross", "none"], null), only: ["park"], fallback: "its seed picks one, or none" }, // a green's: what stands on it
      layout: { ...oneOf(["quartered", "saltire", "goose-foot", "concentric", "canal", "compartments"], null), only: ["park"], fallback: "its seed picks one" }, // a formal garden's walks
      center: { ...oneOf(["basin", "fountain", "statue", "sundial", "rond-point"], null), only: ["park"], fallback: "its seed picks one" }, // a formal garden's middle
      beds: { ...oneOf(["lawn", "parterre", "kitchen", "orchard"], null), only: ["park"], fallback: "its seed picks one" }, // a formal garden's beds
      edging: { ...oneOf(["hedge", "wall", "none"], null), only: ["park"], fallback: "its seed picks one" }, // around a formal garden's beds
      planting: { ...oneOf(["avenue", "quincunx", "bosquets", "none"], null), only: ["park"], fallback: "its seed picks one" }, // a formal garden's trees
      // A cave or dungeon (on a battle map): rock with its open ground carved out
      openness: { ...oneOf(["tight", "medium", "open"], "medium"), only: ["cave"] }, // how much of a cave is open ground
      corridors: { ...oneOf(["narrow", "wide"], "narrow"), only: ["dungeon"] }, // a dungeon's corridors: one square wide or two
      doors: { ...oneOf(["none", "some", "all"], "some"), only: ["dungeon"] }, // doors where corridors meet rooms
      wear: { ...oneOf(["some", "none"], "some"), only: ["cave", "dungeon"] }, // cracks, rubble, moss and puddles on the floor
      system: { ...oneOf(["patchwork", "strips"], null), only: ["fields"] }, // a fields area's: enclosed fields or open strips; else picked from its seed
      fieldSize: num(null, { unit: "ft", min: 50, max: 5000, only: ["fields"] }), // a fields area's: about how big a field (patchwork) or furlong (strips) is
      border: { ...oneOf(["hedge", "drystone", "none"], null), only: ["fields", "cemetery"], fallback: "its seed picks one" }, // a fields area's or a cemetery's: what bounds it; else picked from its seed
      coverage: num(null, { min: 0, max: 1, only: ["fields"] }), // a fields area's: the share of its fields that are cultivated (0.65 if left out); the rest is grass
    },
  },
  wall: {
    geometry: "path",
    classes: ["drystone", "hedge", "fence", "stone", "town", "palisade", "cliff"],
    fields: {
      height: num(null, { unit: "ft", min: 0, max: 400, byClass: { drystone: 3, hedge: 5, fence: 4, stone: 6, town: 25, palisade: 10, cliff: 30 } }),
      straight: bool(false), // drawn straight between its points (a town wall's straight runs, say); else it curves
      // Town walls and palisades. A path whose last point is its first is a closed loop, its outside outward; an open
      // run's outside is on its `side` (left or right, going along the path from its first point)
      thickness: num(null, { unit: "ft", min: 1, max: 100, byClass: { town: 12, palisade: 4 }, only: TOWN_WALLS }),
      towers: { ...oneOf(["roofed", "open", "mixed"], null), only: TOWN_WALLS, fallback: "picked from its seed" },
      // (corners: round at its corners and ends, square between, as a battle map's castle has them by default)
      towerShape: { ...oneOf(["round", "square", "mixed", "corners"], null), only: TOWN_WALLS, fallback: "picked from its seed (a palisade's are square; on a battle map round at the corners, square between)" },
      towerSpacing: num(null, { unit: "ft", min: 30, max: 1000, byClass: { town: 120, palisade: 90 }, only: TOWN_WALLS }),
      outside: { ...oneOf(["none", "ditch", "moat"], "none"), only: TOWN_WALLS },
      ditchWidth: num(null, { unit: "ft", min: 5, max: 300, byClass: { town: 20, palisade: 12 }, only: TOWN_WALLS }),
      side: { ...oneOf(["left", "right"], "left"), only: [...TOWN_WALLS, "cliff"] },
      // A cliff: its path is its top edge, the drop on its side (the low ground, left or right going along it); its
      // rock is the stone it's cut in
      rock: { ...oneOf(["earthy", "slate"], null), only: ["cliff"], fallback: "picked from its seed" },
      climbDC: { ...num(null, { min: 1, max: 60, integer: true }), only: ["cliff"], fallback: "15, natural rock's" },
    },
  },
  tether: {
    // On a battle map: a picket line along its path, a rope between stakes, where horses, mules or oxen are tied
    geometry: "path",
    fields: {},
  },
  trail: {
    // On a battle map: a trail of prints along its path, from where it starts to where it ends (feet, hooves, paws or
    // a cart's wheels), in any season: a clue the players can follow
    geometry: "path",
    classes: ["foot", "hoof", "paw", "wheel"],
    fields: {},
  },
  light: {
    // On a battle map: a light of the plan's own (a lantern on a post, a window's glow, a magic light), placed with the
    // scene. bright and dim are its radii in feet; lit only after dark when dark is true
    geometry: "point",
    fields: {
      bright: num(10, { unit: "ft", min: 0, max: 300 }),
      dim: num(20, { unit: "ft", min: 0, max: 300 }),
      color: str("#ffc56b"),
      alpha: num(0.5, { min: 0, max: 1 }),
      animation: oneOf(["none", "torch", "flame", "pulse", "wave", "fog"], "none"),
      dark: bool(false),
    },
  },
  region: {
    // On a battle map: a region of the plan's own, set on the scene. difficult and greater: walking there costs twice
    // or three times as much; hazard, cover, squeeze and note: a marked region whose note is shown when a token enters
    // (the GM decides what it does)
    geometry: "shape",
    classes: ["difficult", "greater", "hazard", "cover", "squeeze", "note"],
    fields: { name: str(), note: str(""), rot: num(0, { unit: "deg" }) },
  },
  place: {
    // A place on a region map (kind "region"): its marker and name; its own map is made from it
    geometry: "point",
    classes: ["city", "town", "village", "hamlet", "castle", "ruin", "tower", "temple", "inn", "mine"],
    fields: { name: str(), seed: num(null, { min: 1, integer: true }) },
  },
  prop: {
    geometry: "point",
    // (campfire, fire pit, brazier, torch and lamp post: lights on a battle map, each lit where it stands)
    // (cairn, standing stone, sledge, tracks and ribbon: what tells a place's story on a battle map; tracks are
    // footprints in snow, drawn in winter only)
    classes: ["tree", "bush", "cart", "wagon", "well", "barrel", "crate", "statue", "fountain", "cross", "maypole", "sundial", "boat", "ship", "crane", "fern", "log", "stump", "rock", "boulder", "branch", "roots", "leaves", "campfire", "firepit", "brazier", "torch", "lamp-post", "tent", "bedroll", "cairn", "standing-stone", "sledge", "tracks", "ribbon", "horse", "mule", "ox"],
    // (variant: which of its art's pieces, else from the seed: a soldiers' camp's tents all one cloth)
    // (rot: degrees clockwise from how its art is drawn: at 0 a cart, wagon, boat, bedroll or animal runs down the map,
    // a wagon's shafts and an animal's head to the south, and a sledge lies across it; size: its length in feet along its longest side, a wagon's with its shafts, a tree's crown
    // across, a rock's or stump's width)
    fields: { rot: num(0, { unit: "deg" }), species: { ...str(null), only: ["tree"] }, size: num(null, { unit: "ft", min: 0, max: 500 }), variant: num(null, { min: 0, max: 999, integer: true }) },
  },
  label: {
    geometry: "point",
    // A label is placed (at), or follows a district, area or landmark (of), sitting inside it plus its offset and showing its
    // name unless it has text of its own (labels.mjs)
    fields: {
      text: str(""), show: oneOf(["gm", "all"], "gm"), size: oneOf(["small", "normal", "large", "huge"], "normal"),
      // angle: any number of degrees, read as -180 to 180 (370 is 10)
      angle: num(0, { unit: "deg" }), color: str(null), font: str(null), alpha: num(1, { min: 0.1, max: 1 }),
      of: str(null), offset: pointOf(),
    },
  },
};

/**
 * Trees a square square in a thick wood (groves with clearings; what a wood with neither a density nor a count
 * gets). Sparse, open and dense woods are laid out by their own character (layout/settlement.mjs): about 0.1, 0.2 and
 * 1 tree a square square.
 */
export const WOOD_DENSITY = { thick: 1 / 2.4 };

/** A plan tree's species words drawn as a conifer (any other is a broadleaf, bare in winter). */
export const CONIFERS = ["conifer", "fir", "pine", "spruce", "cedar", "larch", "yew", "cypress", "juniper", "hemlock", "evergreen"];
export const isConifer = (species) => typeof species === "string" && CONIFERS.includes(species.trim().toLowerCase());

/** How wide a battle map draws a prop the plan gives no size, in squares, where its art's own size is too big for it. */
export const PROP_SIZE = { tracks: 0.9, ribbon: 1.1, "standing-stone": 1.2, cairn: 2.2, horse: 1.1, mule: 0.9, ox: 1.3 };

/** How wide a prop is drawn, in squares, when the plan gives it no size (a prop's size, in feet, sets it). */
export const PROP_SQUARES = { maypole: 0.6, sundial: 0.4, tent: 0.6, bedroll: 0.3, well: 0.45, cart: 0.45, wagon: 0.6, barrel: 0.45, crate: 0.45, statue: 0.45, stall: 0.4, "stall-long": 0.4, sails: 2.4, waterwheel: 0.25, boat: 0.2, ship: 0.8, cross: 0.5, fountain: 0.45 };

/** A label's text height in squares, by its size word. */
export const LABEL_SIZES = { small: 0.6, normal: 0.7, large: 0.86, huge: 1 };

/**
 * The scene a plan is published to (output.scene). name falls back to the plan's name. weather is one of the
 * weather effects Foundry offers (snow, rain, fog and so on); an unknown one is skipped with a warning; left out, a
 * battle map in winter snows ("none" for none).
 */
export const SCENE = {
  name: str(null),
  padding: num(0.05, { min: 0, max: 0.5 }),
  darkness: num(0, { min: 0, max: 1 }),
  globalLight: bool(true),
  // The time of day (a battle map's): sets the scene's darkness, its light outdoors and its tint in place of darkness
  // and globalLight, and which lights are lit (TIMES in publish.mjs). Left out, those two settings are used
  time: oneOf(["day", "dawn", "dusk", "night", "dark"], null),
  tokenVision: bool(false),
  fog: bool(false),
  weather: str(null),
  navigation: bool(false),
  gridAlpha: num(0.1, { min: 0, max: 1 }),
  labelColor: str("#13202e"),
  labelFont: str("Signika"),
};

/** A pinned building's details as the generator writes them: join { start?, end?, inset, flush? }, cut [[a, b, t]...], chimneyAt { u, v, variant }. */
export const okJoin = (j) => !!j && typeof j === "object" && !Array.isArray(j) && (j.start === true || j.end === true) && (j.inset === undefined || (Number.isFinite(j.inset) && Math.abs(j.inset) <= 0.5)) && (j.flush === undefined || [-1, 1].includes(j.flush));
export const okCut = (c) => Array.isArray(c) && c.length > 0 && c.every((x) => Array.isArray(x) && x.length === 3 && x.every(Number.isFinite) && [-1, 1].includes(x[0]) && [-1, 1].includes(x[1]) && x[2] >= 0 && x[2] <= 1);
export const okChimney = (c) => !!c && typeof c === "object" && [c.u, c.v, c.variant].every(Number.isFinite) && Math.abs(c.u) <= 0.5 && Math.abs(c.v) <= 0.5;

/** District profiles this version knows: how built up a district is. */
export const PROFILES = ["hamlet", "village", "town", "city"];

/** Older profile names still read as their new ones: "roadside" is a hamlet, "core" a city. */
export const OLD_PROFILES = { roadside: "hamlet", core: "city" };

/** Classes a type accepts but this version doesn't draw yet (kept in the plan, left off the map). */
export const NOT_DRAWN_YET = { area: [] };

/** Top-level words this version knows. */
export const SEASONS = ["spring", "summer", "autumn", "winter"];
/** Styles: illustrated (drawn, no art: settlements' maps), textured (Forgotten Adventures art: for battle maps). */
export const STYLES = ["illustrated", "textured", "ink"];

/** Limits on the image: Foundry's smallest grid, the largest WebP side, and the size some graphics cards stop at. */
export const OUTPUT_LIMITS = { minPxPerSquare: 20, maxSide: 16383, warnSide: 8192 };

/** Top-level defaults. */
const DEFAULTS = {
  kind: "settlement",
  season: "summer",
  sun: "high-south",
  seed: 1,
  ground: "grass",
};

/**
 * Reads a plan from an object, a JSON string, or text with a ```mapplan (or ```json) fenced block in it.
 * Returns { plan, error }: plan is null when the text can't be read, with error saying where.
 */
export function readPlan(input) {
  if (input && typeof input === "object") return { plan: input, error: null };
  let text = String(input ?? "");
  // A ```mapplan block wins; else a ```json block; else the whole text
  const fence = text.match(/```mapplan[^\n]*\n([\s\S]*?)```/) ?? text.match(/```json[^\n]*\n([\s\S]*?)```/);
  if (fence) text = fence[1];
  try {
    return { plan: JSON.parse(text), error: null };
  } catch (e) {
    const at = /position (\d+)/.exec(e.message);
    let where = "";
    if (at) {
      const before = text.slice(0, Number(at[1]));
      const line = before.split("\n").length, col = before.length - before.lastIndexOf("\n");
      where = ` (line ${line}, column ${col})`;
    }
    return { plan: null, error: `The plan isn't valid JSON${where}: ${e.message}` };
  }
}

/** A field's default for a feature of a given class (none for a class the field isn't for). */
export function fieldDefault(spec, cls) {
  if (Array.isArray(spec.only) && cls != null && !spec.only.includes(cls)) return null;
  if (spec.byClass && cls in spec.byClass) return spec.byClass[cls];
  return spec.default ?? null;
}

/**
 * The plan with every default filled in. Doesn't change the plan it's given. Unknown fields are kept (the checker
 * reports them), so nothing a newer version wrote is lost.
 */
export function normalize(plan) {
  const p = structuredClone(isObj(plan) ? plan : {});
  for (const [k, v] of Object.entries(DEFAULTS)) p[k] ??= v;
  p.style ??= p.kind === "battle" ? "textured" : p.kind === "region" ? "region" : "illustrated"; // (a settlement drawn, a battle map in its art)
  p.atlasScribe ??= PLAN_VERSION;
  // Containers of the wrong kind are replaced (the checker reports them), so nothing downstream trips on them
  if (!isObj(p.size)) p.size = {};
  if (!Array.isArray(p.size.squares)) p.size.squares = [50, 50];
  p.size.ftPerSquare ??= p.kind === "battle" ? 5 : p.kind === "region" ? 2640 : 25;
  p.features = (Array.isArray(p.features) ? p.features : []).map((f) => normalizeFeature(isObj(f) ? f : {}));
  if (!isObj(p.seeds)) p.seeds = {};
  if (!Array.isArray(p.locked)) p.locked = [];
  if (!isObj(p.art)) p.art = {};
  if (!isObj(p.output)) p.output = {};
  p.output.pxPerSquare ??= 50;
  p.output.format ??= "auto";
  p.output.quality ??= 0.86;
  p.output.dressing ??= false; // a frame, compass rose, scale bar and the map's name, painted on (illustrated style)
  if (!isObj(p.output.scene)) p.output.scene = {};
  // (a battle map is for tokens to see by: its walls, doors and windows block their sight, and what a token has seen
  // stays on the map, dimmed, rather than going black behind it: fog exploration)
  if (p.kind === "battle") {
    p.output.scene.tokenVision ??= true;
    p.output.scene.fog ??= true;
  }
  for (const [k, spec] of Object.entries(SCENE)) p.output.scene[k] ??= spec.default;
  p.output.scene.name ??= p.name ?? p.id ?? "Map";
  return p;
}

/** A plain object (not null, not a list). */
export function isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function normalizeFeature(f) {
  const t = TYPES[f?.type];
  if (!t) return { ...f };
  const out = { ...f };
  if (t.classes && !t.classes.includes(out.class)) out.class = t.classes[0]; // unknown classes are drawn as the default (the checker says so)
  for (const [name, spec] of Object.entries(t.fields)) if (out[name] === undefined) out[name] = fieldDefault(spec, out.class);
  if (f.type === "district" && Object.hasOwn(OLD_PROFILES, out.profile)) out.profile = OLD_PROFILES[out.profile];
  if (f.type === "district" && typeof out.gardens === "boolean") out.gardens = out.gardens ? null : 0; // older plans give true (its character's share) or false
  // A stream, river or canal given a shape is drawn as a lake: frozen in winter unless the plan says
  if (f.type === "water" && !Array.isArray(f.path) && f.shape != null && f.frozen === undefined && RUNNING.includes(out.class)) out.frozen = null;
  if (f.type === "landmark") out.buildings = (Array.isArray(f.buildings) ? f.buildings : []).map((b) => normalizeFeature({ ...(isObj(b) ? b : {}), type: "building" }));
  return out;
}
