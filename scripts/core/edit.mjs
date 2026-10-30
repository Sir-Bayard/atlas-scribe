/**
 * Changing a plan from the window: what each feature's settings are (in plain words, with their defaults), setting
 * one, and deleting a feature. Every function returns a new plan and never changes the one it's given. The settings
 * come from TYPES in plan.mjs, so a field added there shows up here; FIELD_TEXT gives each its words.
 * Pure: runs in the worker, on the page and under node.
 */
import { TYPES, SURFACES, SEASONS, OLD_PROFILES, fieldDefault, isObj, normalize } from "./plan.mjs";

/** The district types the window offers (an old plan's "roadside" reads as a hamlet, "core" as a city). */
export const PROFILE_CHOICES = ["hamlet", "village", "town", "city"];

/**
 * Each field's words: label, help (a tooltip), auto (what happens when it's left empty, when that isn't a plain
 * value), more (shown under "More" as less used), values and kind (when the window shows it differently from its
 * spec), names (words for enum values), hidden (never shown: a field the generator ignores for now).
 * Keyed by "<type>.<field>", or "*.<field>" for every type.
 */
export const FIELD_TEXT = {
  "*.name": { label: "Name", help: "What the window calls it, in place of its id", auto: "its id" },
  "*.class": { label: "Kind" },

  "road.width": { label: "Width", help: "How wide it is, in feet" },
  "road.surface": { label: "Surface" },
  "road.ruts": { label: "Cart ruts", help: "Two worn ruts along the middle" },
  "road.straight": { label: "Straight", help: "Straight lines between its points instead of a smooth curve through them" },

  "water.width": { label: "Width", help: "How wide it is, in feet" },
  "water.frozen": { label: "Frozen" },
  "water.straight": { label: "Straight", help: "Straight lines between its points (a canal) instead of a smooth curve" },

  "crossing.angle": { label: "Angle", help: "Bridges and fords are turned to their road when one crosses the water nearby", more: true },
  "crossing.length": { label: "Length", help: "In feet; a bridge is made long enough for its water whatever this says" },
  "crossing.width": { label: "Width", help: "In feet; a bridge is made at least as wide as its road" },
  "crossing.frozen": { label: "Frozen" },

  "square.surface": { label: "Paving" },
  "square.radial": { label: "Streets ring it", help: "The district's streets circle the square and run out from it" },

  "building.roof": { label: "Roof" },
  "building.roofStyle": { label: "Roof form" },
  "building.height": { label: "Height", help: "In feet; taller buildings cast longer shadows" },
  "building.chimney": { label: "Chimney", kind: "tristate", auto: "the generator decides" },
  "building.rot": { label: "Turned", help: "Degrees clockwise", more: true },
  "building.variant": { label: "Art piece", help: "Which of the roof art's pieces it uses; else picked from the seed", more: true },

  "district.profile": { label: "Type", kind: "enum", values: PROFILE_CHOICES, help: "Hamlet: houses on the roads only. Village: a few lanes, deep plots. Town: long plots with back lanes. City: dense rows and alleys." },
  "district.gardens": { label: "Gardens", help: "The share of houses with a tended garden (0 to 1)" },
  "district.density": { label: "Built up", help: "Below 1, some plots are left empty (0 to 1)", more: true },
  "district.surface": { label: "Street surface", help: "Else the surface of a road through it", auto: "its road's" },
  "district.bend": { label: "Bend", help: "How much its streets wander, in degrees", auto: "its type's", more: true },
  "district.spacing": { label: "Street spacing", help: "How far apart its main streets run, in feet", auto: "its type's", more: true },
  "district.axis": { label: "Street direction", help: "Degrees; its main streets run this way where no road steers them", auto: "from its roads", more: true },
  "district.spacious": { label: "Spacious", help: "Wider plots, houses further apart (0 to 1)" },
  "district.crofts": { label: "Crofts", help: "The share of plots with a small field behind (0 to 1)", auto: "its type's" },
  "district.croftDepth": { label: "Croft depth", help: "How far back a croft runs, as a share of the plot behind the yard", auto: "its type's" },
  "district.croftFence": { label: "Croft fence", names: { all: "all round", sides: "sides only", none: "none" }, auto: "its type's" },
  "district.plotLines": { label: "Plot lines", help: "Fences round yards and crofts in hamlets and villages, faint walls between long plots elsewhere" },
  "district.roofs": { label: "Roofs", help: "The roof materials its houses choose from", auto: "a mix for its type" },
  "district.roofStyles": { label: "Roof forms", help: "The roof forms its houses choose from", auto: "its type's mix" },

  "area.surface": { label: "Surface", auto: "trodden ground" },
  "area.fence": { label: "Fence", auto: "none" },
  "area.rot": { label: "Turned", help: "Degrees; a turned area can't be reshaped by its corners yet", more: true },
  "area.trees": { label: "Trees", help: "About how many trees; else about one for every 2.4 square squares", auto: "from its size" },
  "area.mix": { label: "Leafy share", kind: "share", key: "bare", help: "The share of leafy trees; the rest are firs (0 to 1)", auto: "0.15" },
  "area.style": { label: "Style", names: { green: "village green", formal: "formal garden" }, auto: "village green" },
  "area.system": { label: "Field system", names: { patchwork: "hedged patchwork", strips: "open strips" }, help: "Else picked from its seed", auto: "by seed" },
  "area.fieldSize": { label: "Field size", help: "About how big a field (or a furlong of strips) is, in feet", auto: "by system" },
  "area.border": { label: "Border", help: "What bounds its fields; else picked from its seed", auto: "by seed" },
  "area.coverage": { label: "Cultivated", help: "The share of its fields that are farmed; the rest is grass (0 to 1)", auto: "0.65" },

  "wall.height": { label: "Height", help: "In feet" },
  "wall.straight": { label: "Straight", help: "Straight lines between its points (a town wall's runs) instead of a smooth curve" },

  "prop.rot": { label: "Turned", help: "Degrees clockwise", notFor: ["tree"] }, // a tree is turned at random
  "prop.species": { label: "Tree", kind: "enum", values: ["conifer", "bare"], names: { conifer: "fir", bare: "leafy" }, auto: "leafy" },
  "prop.size": { hidden: true }, // not used yet

  "label.text": { label: "Text" },
  "label.show": { label: "Shown to", names: { gm: "the GM only", all: "everyone" } },
  "label.size": { label: "Size" },
};

/** The plan-wide settings, by path: what the "Plan" panel shows. */
export const PLAN_FIELDS = [
  { path: "name", label: "Name", kind: "string" },
  { path: "season", label: "Season", kind: "enum", values: SEASONS },
  { path: "ground", label: "Ground", kind: "enum", values: SURFACES },
  { path: "size.squares.0", label: "Width", kind: "number", unit: "squares", min: 1, step: 1, required: true, help: "The map's width in squares" },
  { path: "size.squares.1", label: "Height", kind: "number", unit: "squares", min: 1, step: 1, required: true, help: "The map's height in squares" },
  { path: "size.ftPerSquare", label: "Feet a square", kind: "number", min: 1, max: 100, help: "25 for a town; 5 for a battle map" },
  { path: "output.pxPerSquare", label: "Pixels a square", kind: "number", min: 20, step: 1, whole: true, help: "The finished image's grid size, and so its size" },
  { path: "seed", label: "Seed", kind: "number", step: 1, whole: true, help: "Changing it redraws everything that has no seed of its own", more: true },
  { path: "output.scene.name", label: "Scene name", kind: "string", group: "scene" },
  { path: "output.scene.weather", label: "Weather", kind: "string", group: "scene", help: "A Foundry weather effect (snow, rain, fog...), or empty for none" },
  { path: "output.scene.darkness", label: "Darkness", kind: "number", min: 0, max: 1, group: "scene" },
  { path: "output.scene.globalLight", label: "Global light", kind: "boolean", group: "scene" },
  { path: "output.scene.tokenVision", label: "Token vision", kind: "boolean", group: "scene" },
  { path: "output.scene.fog", label: "Fog of war", kind: "boolean", group: "scene" },
  { path: "output.scene.padding", label: "Padding", kind: "number", min: 0, max: 0.5, group: "scene" },
  { path: "output.scene.gridAlpha", label: "Grid strength", kind: "number", min: 0, max: 1, group: "scene" },
];

const textOf = (type, name) => FIELD_TEXT[`${type}.${name}`] ?? FIELD_TEXT[`*.${name}`] ?? {};

/** The feature with this id, or null. */
export function featureOf(plan, id) {
  return (Array.isArray(plan?.features) ? plan.features : []).find((f) => isObj(f) && f.id === id) ?? null;
}

/**
 * A feature's settings as the window shows them: [{ name, label, help, kind, values, names, unit, min, max, value,
 * auto, more }]. value is what the plan says (undefined when left out); auto describes what's used when it's left
 * out (a default value, or words). Only the fields its class uses.
 */
export function fieldsOf(plan, id) {
  const f = featureOf(plan, id);
  const t = f && TYPES[f.type];
  if (!t) return [];
  const out = [];
  // An unknown class is drawn as the type's first, so the window shows that
  const cls = t.classes ? (t.classes.includes(f.class) ? f.class : t.classes[0]) : undefined;
  if (t.classes) out.push({ name: "class", label: "Kind", kind: "enum", values: t.classes, value: cls, auto: t.classes[0] });
  // Water drawn as a shape (a pond, a lake) has no width and nothing to straighten
  const shaped = f.type === "water" && !Array.isArray(f.path);
  for (const [name, spec] of Object.entries(t.fields)) {
    if (spec.only && !spec.only.includes(cls)) continue;
    const txt = textOf(f.type, name);
    if (txt.hidden || txt.notFor?.includes(cls)) continue;
    if (shaped && (name === "width" || name === "straight")) continue;
    const kind = txt.kind ?? (spec.kind === "enum" ? "enum" : spec.kind);
    const values = txt.values ?? spec.values;
    const dflt = fieldDefault(spec, cls);
    let value = f[name];
    if (kind === "share") value = isObj(f[name]) ? f[name][txt.key] : undefined;
    if (f.type === "district" && name === "gardens" && typeof value === "boolean") value = value ? 0.1 : 0; // an M1 plan's
    if (f.type === "district" && name === "profile" && Object.hasOwn(OLD_PROFILES, value)) value = OLD_PROFILES[value]; // an older plan's name for it
    out.push({
      name, label: txt.label ?? name, help: txt.help ?? null, kind, values: values ?? null, names: txt.names ?? null,
      unit: spec.unit ?? null, min: spec.min ?? null, max: spec.max ?? null,
      value, auto: txt.auto ?? (dflt === null || dflt === undefined ? null : dflt), more: !!txt.more,
    });
  }
  return out;
}

/**
 * Checks and converts a value from the window for a field ({ kind, values, min, max }). Returns { value } (undefined
 * to leave the field out, so its default applies) or { error }.
 */
export function readValue(field, raw) {
  if (raw === undefined || raw === null || raw === "") return { value: undefined };
  switch (field.kind) {
    case "number":
    case "share": {
      const v = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isFinite(v)) return { error: `${field.label} should be a number.` };
      if (field.whole && !Number.isInteger(v)) return { error: `${field.label} should be a whole number.` };
      const min = field.kind === "share" ? 0 : field.min, max = field.kind === "share" ? 1 : field.max;
      if ((min !== null && min !== undefined && v < min) || (max !== null && max !== undefined && v > max))
        return { error: `${field.label} should be ${max !== null && max !== undefined ? `${min} to ${max}` : `at least ${min}`}.` };
      return { value: v };
    }
    case "boolean":
      return { value: raw === true || raw === "true" || raw === "on" };
    case "tristate":
      return raw === "yes" || raw === true ? { value: true } : raw === "no" || raw === false ? { value: false } : { value: undefined };
    case "enum":
      return field.values.includes(raw) ? { value: raw } : { error: `${field.label} can't be "${raw}".` };
    case "list": {
      const list = (Array.isArray(raw) ? raw : [raw]).filter((v) => field.values.includes(v));
      return { value: list.length ? field.values.filter((v) => list.includes(v)) : undefined };
    }
    case "string":
      return { value: String(raw).trim() || undefined };
    default:
      return { error: `${field.label} can't be changed here.` };
  }
}

/**
 * The plan with one of a feature's fields set (value undefined leaves it out, so its default applies). Changing a
 * feature's class drops the settings the new class doesn't use. Returns { plan } or { error }.
 */
export function setField(plan, id, name, raw) {
  const f = featureOf(plan, id);
  if (!f) return { error: `There's no feature "${id}".` };
  const field = fieldsOf(plan, id).find((x) => x.name === name);
  if (!field) return { error: `"${id}" has no setting "${name}".` };
  const { value, error } = readValue(field, raw);
  if (error) return { error };
  const next = structuredClone(plan);
  const g = featureOf(next, id);
  if (field.kind === "share") {
    const key = textOf(f.type, name).key;
    const obj = isObj(g[name]) ? { ...g[name] } : {};
    if (value === undefined) delete obj[key];
    else obj[key] = value;
    if (Object.keys(obj).length) g[name] = obj;
    else delete g[name];
  } else if (value === undefined) delete g[name];
  else g[name] = value;
  if (name === "class") {
    const t = TYPES[g.type];
    for (const [k, spec] of Object.entries(t.fields)) if (spec.only && !spec.only.includes(g.class ?? t.classes[0])) delete g[k];
  }
  return { plan: next };
}

/** The plan without a feature: its seed and its lock go with it. */
export function deleteFeature(plan, id) {
  const next = structuredClone(plan);
  next.features = (Array.isArray(next.features) ? next.features : []).filter((f) => !(isObj(f) && f.id === id));
  if (isObj(next.seeds)) delete next.seeds[id];
  if (Array.isArray(next.locked)) next.locked = next.locked.filter((x) => x !== id);
  return next;
}

const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** The plan-wide settings: PLAN_FIELDS with each one's value now (as written) and what applies when it's left out. */
export function planFieldsOf(plan) {
  const full = normalize(plan);
  return PLAN_FIELDS.map((p) => ({ ...p, name: p.path, value: getPath(plan, p.path), auto: getPath(full, p.path) ?? null }));
}

/** The plan with one plan-wide setting changed. Returns { plan } or { error }. */
export function setPlanField(plan, path, raw) {
  const field = planFieldsOf(plan).find((p) => p.path === path);
  if (!field) return { error: `The plan has no setting "${path}".` };
  const { value, error } = readValue(field, raw);
  if (error) return { error };
  const keys = path.split(".");
  const next = structuredClone(plan);
  // The map's size is two whole numbers, both always written
  if (path.startsWith("size.squares.")) {
    if (value === undefined || !Number.isInteger(value)) return { error: `${field.label} should be a whole number of squares.` };
    next.size = isObj(next.size) ? next.size : {};
    const sq = Array.isArray(next.size.squares) ? [...next.size.squares] : [...normalize(plan).size.squares];
    sq[Number(keys[2])] = value;
    next.size.squares = sq;
    return { plan: next };
  }
  let o = next;
  for (const k of keys.slice(0, -1)) {
    if (!isObj(o[k])) o[k] = {};
    o = o[k];
  }
  const last = keys[keys.length - 1];
  if (value === undefined) delete o[last];
  else o[last] = value;
  return { plan: next };
}

/** Words for a value shown in the window ("hedged patchwork", "250 ft", "village green"). */
export function wordsFor(field, v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (field.names && v in field.names) return field.names[v];
  if (typeof v === "boolean") return v ? "yes" : "no";
  return field.unit === "ft" ? `${v} ft` : String(v);
}

