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

export const ROOFS = ["slate", "wood-shingle", "tile-red", "tile-brown", "thatch"];
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
    },
  },
  water: {
    geometry: "path|shape",
    classes: ["stream", "river", "canal", "pond", "lake", "sea"],
    fields: {
      width: num(null, { unit: "ft", min: 1, byClass: { stream: 15, river: 60, canal: 20 } }),
      frozen: bool(false),
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
    fields: { surface: oneOf(SURFACES, "cobble"), name: str() },
  },
  building: {
    geometry: "shape",
    fields: {
      roof: oneOf(ROOFS, "slate"),
      height: num(20, { unit: "ft", min: 1 }),
      rot: num(0, { unit: "deg" }),
      chimney: { kind: "boolean", default: null }, // null: the generator decides
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
      profile: str("roadside"),
      gardens: bool(true),
      density: num(1, { min: 0, max: 2 }),
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
    },
  },
  wall: {
    geometry: "path",
    classes: ["drystone", "hedge", "fence", "stone"],
    fields: { height: num(null, { unit: "ft", min: 0, byClass: { drystone: 3, hedge: 5, fence: 4, stone: 6 } }) },
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
export const PROFILES = ["roadside"];

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
  const fence = text.match(/```(?:mapplan|json)?[^\n]*\n([\s\S]*?)```/);
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
  const p = structuredClone(plan ?? {});
  for (const [k, v] of Object.entries(DEFAULTS)) p[k] ??= v;
  p.atlasScribe ??= PLAN_VERSION;
  p.size ??= {};
  p.size.squares ??= [50, 50];
  p.size.ftPerSquare ??= p.kind === "battle" ? 5 : 25;
  p.features = (p.features ?? []).map((f) => normalizeFeature(f));
  p.seeds ??= {};
  p.locked ??= [];
  p.art ??= {};
  p.output ??= {};
  p.output.pxPerSquare ??= 50;
  p.output.format ??= "webp";
  p.output.quality ??= 0.86;
  p.output.scene ??= {};
  for (const [k, spec] of Object.entries(SCENE)) p.output.scene[k] ??= spec.default;
  p.output.scene.name ??= p.name ?? p.id ?? "Map";
  return p;
}

function normalizeFeature(f) {
  const t = TYPES[f?.type];
  if (!t) return { ...f };
  const out = { ...f };
  if (t.classes) out.class ??= t.classes[0];
  for (const [name, spec] of Object.entries(t.fields)) if (out[name] === undefined) out[name] = fieldDefault(spec, out.class);
  if (f.type === "landmark") out.buildings = (f.buildings ?? []).map((b) => normalizeFeature({ ...b, type: "building" }));
  return out;
}
