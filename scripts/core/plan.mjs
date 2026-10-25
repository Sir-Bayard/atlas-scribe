/**
 * The Plan: what the GM has decided about a map. Everything else is generated from it.
 *
 * A plan is JSON. Positions are in grid squares from the top left (y down); sizes are in feet. Materials are
 * plain words ("slate", "cobble"); the style and season turn them into art. One list of features, each with an
 * id and a type; TYPES below says what each type takes, and drives the defaults, the checker and the panel.
 * Pure: runs in the worker, on the page and under node.
 */

export const PLAN_VERSION = 1;

/** Field kinds: number, string, boolean, enum (one of values), object, list. `byClass` defaults depend on the feature's class. */
const num = (dflt, extra = {}) => ({ kind: "number", default: dflt, ...extra });
const str = (dflt = null, extra = {}) => ({ kind: "string", default: dflt, ...extra });
const bool = (dflt) => ({ kind: "boolean", default: dflt });
const oneOf = (values, dflt) => ({ kind: "enum", values, default: dflt });
const listOf = (values, dflt = null) => ({ kind: "list", values, default: dflt });

/**
 * Roof materials. The plain words ("slate", "wood-shingle") are the old defaults; the rest name a colour. Tile
 * colours come in several tile shapes (round, flat, beaver tail), picked by the building's variant.
 */
export const ROOFS = [
  "slate", "slate-black", "slate-blue", "slate-purple", "slate-mossy",
  "tile-red", "tile-orange", "tile-brown", "tile-tan", "tile-gray", "tile-black", "tile-blue", "tile-green", "tile-purple", "tile-mossy",
  "wood-shingle", "wood-shingle-dark", "wood-shingle-light", "wood-shingle-red", "wood-shingle-ashen", "wood-shingle-walnut",
  "thatch",
];

/**
 * Roof forms. gable: two slopes, upright ends. hip: four slopes. half-hip: a gable with its peak clipped into a small
 * hip. pyramid: four slopes to one point. flat: a flat roof behind a low parapet. mansard: steep slopes round a flat
 * top with a skylight. A round building always gets a cone.
 */
export const ROOF_STYLES = ["gable", "hip", "half-hip", "pyramid", "flat", "mansard"];
export const SURFACES = ["dirt", "slush", "snow", "trodden", "cobble", "gravel", "grass", "mud", "flagstone"];

/**
 * Feature types. geometry: "point" (at), "path" (path), "shape" (shape), "path|shape", or "buildings" (a landmark).
 * classes: the allowed classes, the first being the default.
 */
export const TYPES = {
  road: {
    geometry: "path",
    classes: ["street", "highway", "lane", "track", "path"],
    fields: {
      width: num(null, { unit: "ft", min: 1, byClass: { highway: 30, street: 20, lane: 15, track: 10, path: 5 } }),
      surface: oneOf(SURFACES, "dirt"),
      ruts: bool(false),
      straight: bool(false), // drawn straight between its points; else it curves smoothly through them
    },
  },
  water: {
    geometry: "path|shape",
    classes: ["stream", "river", "canal", "pond", "lake", "sea"],
    fields: {
      width: num(null, { unit: "ft", min: 1, byClass: { stream: 15, river: 60, canal: 20 } }),
      frozen: bool(false),
      straight: bool(false), // drawn straight between its points (a canal, say); else it curves smoothly through them
    },
  },
  crossing: {
    geometry: "point",
    classes: ["bridge", "footbridge", "ford"],
    fields: {
      angle: num(0, { unit: "deg" }),
      length: num(null, { unit: "ft", min: 1, byClass: { bridge: 60, footbridge: 40, ford: 50 } }),
      width: num(null, { unit: "ft", min: 1, byClass: { bridge: 20, footbridge: 10, ford: 50 } }),
      frozen: bool(false),
    },
  },
  square: {
    geometry: "shape",
    fields: { surface: oneOf(SURFACES, "cobble"), name: str(), radial: bool(false) },
  },
  building: {
    geometry: "shape",
    fields: {
      roof: oneOf(ROOFS, "slate"),
      height: num(20, { unit: "ft", min: 1 }),
      rot: num(0, { unit: "deg" }),
      chimney: { kind: "boolean", default: null }, // null: the generator decides
      roofStyle: { ...oneOf(ROOF_STYLES, "gable"), fallback: "it's drawn as a gable" },
      name: str(),
    },
  },
  landmark: {
    geometry: "buildings",
    fields: { name: str() },
  },
  district: {
    geometry: "shape",
    fields: {
      profile: str("village"),
      gardens: num(0.1, { min: 0, max: 1 }), // the share of houses with a tended garden (true and false still read)
      density: num(1, { min: 0, max: 2 }),
      surface: oneOf(SURFACES, null), // its streets' surface; else the surface of a road through it
      bend: num(null, { unit: "deg", min: 0, max: 90 }),
      spacing: num(null, { unit: "ft", min: 25 }),
      axis: num(null, { unit: "deg" }),
      spacious: num(0, { min: 0, max: 1 }),
      crofts: num(null, { min: 0, max: 1 }), // the share of plots with a croft behind; else the type's
      croftDepth: num(null, { min: 0.1, max: 1 }), // how far back a croft runs, as a share of the plot behind the yard; else the type's
      croftFence: oneOf(["all", "sides", "none"], null), // the croft's fence: all round, sides only (open at the back), none; else the type's
      plotLines: bool(false), // draw plot lines: yard and croft fences in hamlets and villages, faint walls between long plots elsewhere
      roofs: listOf(ROOFS), // the roof materials its houses choose from, equally; else a mix picked for its type from its seed
      roofStyles: listOf(ROOF_STYLES), // the roof forms its houses choose from, equally; else its type's mix
    },
  },
  area: {
    geometry: "shape",
    classes: ["yard", "farmstead", "woods", "trodden", "fields", "park", "cemetery"],
    fields: {
      surface: oneOf(SURFACES, null),
      fence: oneOf(["wattle", "wood", "stone"], null),
      rot: num(0, { unit: "deg" }),
      trees: num(null, { min: 0 }),
      mix: { kind: "object", default: null },
      style: oneOf(["green", "formal"], null), // a park's: a village green (the default) or a formal garden
      system: oneOf(["patchwork", "strips"], null), // a fields area's: enclosed fields or open strips; else picked from its seed
      fieldSize: num(null, { unit: "ft", min: 50 }), // a fields area's: about how big a field (patchwork) or furlong (strips) is
      border: oneOf(["hedge", "drystone", "none"], null), // a fields area's: what bounds its fields; else picked from its seed
      coverage: num(null, { min: 0, max: 1 }), // a fields area's: the share of its fields that are cultivated (0.65 if left out); the rest is grass
    },
  },
  wall: {
    geometry: "path",
    classes: ["drystone", "hedge", "fence", "stone"],
    fields: {
      height: num(null, { unit: "ft", min: 0, byClass: { drystone: 3, hedge: 5, fence: 4, stone: 6 } }),
      straight: bool(false), // drawn straight between its points (a town wall's straight runs, say); else it curves
    },
  },
  prop: {
    geometry: "point",
    classes: ["tree", "bush", "cart", "wagon", "well", "barrel", "crate", "statue"],
    fields: { rot: num(0, { unit: "deg" }), species: str(null), size: num(null, { unit: "ft", min: 0 }) },
  },
  label: {
    geometry: "point",
    fields: { text: str(""), show: oneOf(["gm", "all"], "gm"), size: oneOf(["small", "normal", "large", "huge"], "normal") },
  },
};

/** A label's text height in squares, by its size word. */
export const LABEL_SIZES = { small: 0.6, normal: 0.7, large: 0.86, huge: 1 };

/**
 * The scene a plan is published to (output.scene). name falls back to the plan's name. weather is one of the
 * weather effects Foundry offers (snow, rain, fog and so on); an unknown one is skipped with a warning.
 */
export const SCENE = {
  name: str(null),
  padding: num(0.05, { min: 0, max: 0.5 }),
  darkness: num(0, { min: 0, max: 1 }),
  globalLight: bool(true),
  tokenVision: bool(false),
  fog: bool(false),
  weather: str(null),
  navigation: bool(false),
  gridAlpha: num(0.1, { min: 0, max: 1 }),
  labelColor: str("#13202e"),
  labelFont: str("Signika"),
};

/** District profiles this version knows. */
export const PROFILES = ["hamlet", "village", "town", "core", "roadside"];

/** Classes a type accepts but this version doesn't draw yet (kept in the plan, left off the map). */
export const NOT_DRAWN_YET = { area: ["cemetery"] };

/** Top-level words this version knows. */
export const SEASONS = ["spring", "summer", "autumn", "winter"];
export const STYLES = ["textured"];

/** Limits on the image: Foundry's smallest grid, the largest WebP side, and the size some graphics cards stop at. */
export const OUTPUT_LIMITS = { minPxPerSquare: 20, maxSide: 16383, warnSide: 8192 };

/** Top-level defaults. */
const DEFAULTS = {
  kind: "settlement",
  season: "summer",
  sun: "high-south",
  style: "textured",
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

/** A field's default for a feature of a given class. */
export function fieldDefault(spec, cls) {
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
  p.atlasScribe ??= PLAN_VERSION;
  // Containers of the wrong kind are replaced (the checker reports them), so nothing downstream trips on them
  if (!isObj(p.size)) p.size = {};
  if (!Array.isArray(p.size.squares)) p.size.squares = [50, 50];
  p.size.ftPerSquare ??= p.kind === "battle" ? 5 : 25;
  p.features = (Array.isArray(p.features) ? p.features : []).map((f) => normalizeFeature(isObj(f) ? f : {}));
  if (!isObj(p.seeds)) p.seeds = {};
  if (!Array.isArray(p.locked)) p.locked = [];
  if (!isObj(p.art)) p.art = {};
  if (!isObj(p.output)) p.output = {};
  p.output.pxPerSquare ??= 50;
  p.output.format ??= "webp";
  p.output.quality ??= 0.86;
  if (!isObj(p.output.scene)) p.output.scene = {};
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
  if (f.type === "district" && typeof out.gardens === "boolean") out.gardens = out.gardens ? 0.1 : 0; // M1 plans said true or false
  if (f.type === "landmark") out.buildings = (Array.isArray(f.buildings) ? f.buildings : []).map((b) => normalizeFeature({ ...(isObj(b) ? b : {}), type: "building" }));
  return out;
}
