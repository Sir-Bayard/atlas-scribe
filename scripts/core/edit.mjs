/**
 * Changing a plan from the window: what each feature's settings are (in plain words, with their defaults), setting
 * one, and deleting a feature. Every function returns a new plan and never changes the one it's given. The settings
 * come from TYPES in plan.mjs, so a field added there shows up here; FIELD_TEXT gives each its words.
 * Pure: runs in the worker, on the page and under node.
 */
import { TYPES, SURFACES, SEASONS, ROOFS, OLD_PROFILES, RUNNING, BODIES, fieldDefault, isObj, normalize, isConifer } from "./plan.mjs";
import { nameLabelsOf, cleanFont } from "./labels.mjs";

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

  "water.width": { label: "Width", help: "How wide it is at its first point, in feet" },
  "water.endWidth": { label: "End width", help: "How wide it is at its last point, in feet: it widens or narrows smoothly along the way", auto: "the same all along" },
  "water.widths": { hidden: true }, // a width at each point, for plans written by hand
  "water.shore": { label: "Shore", names: { sand: "sand", pebbles: "pebbles", rocks: "rocks", grass: "grass", marsh: "marsh", reeds: "reeds" }, auto: "picked from its seed" },
  "water.frozen": { label: "Frozen" },
  "water.straight": { label: "Straight", help: "Straight lines between its points (a canal) instead of a smooth curve" },

  "dock.width": { label: "Width", help: "How wide it is, in feet" },
  "dock.material": { label: "Built of", names: { stone: "stone", wood: "timber" } },

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
  "building.chimneyAt": { hidden: true },
  "building.join": { hidden: true },
  "building.cut": { hidden: true },

  "district.profile": { label: "Type", kind: "enum", values: PROFILE_CHOICES, help: "Hamlet: houses on the roads only. Village: a few lanes, deep plots. Town: long plots with back lanes. City: dense rows and alleys." },
  "district.gardens": { label: "Gardens", help: "The share of houses with a tended garden (0 to 1)" },
  "district.density": { label: "Built up", help: "Below 1, some plots are left empty (0 to 1)", more: true },
  "district.surface": { label: "Street surface", help: "Else the surface of a road through it", auto: "its road's" },
  "district.bend": { label: "Bend", help: "How much its streets wander, in degrees", auto: "its type's", more: true },
  "district.spacing": { label: "Street spacing", help: "How far apart its main streets run, in feet", auto: "its type's", more: true },
  "district.axis": { label: "Street direction", help: "Degrees; its main streets run this way where no road steers them", auto: "from its roads", more: true },
  "district.spacious": { label: "Spacious", help: "Wider plots, houses farther apart (0 to 1)" },
  "district.crofts": { label: "Crofts", help: "The share of plots with a small field behind (0 to 1)", auto: "its type's" },
  "district.croftDepth": { label: "Croft depth", help: "How far back a croft runs, as a share of the plot behind the yard", auto: "its type's" },
  "district.croftFence": { label: "Croft fence", names: { all: "all around", sides: "sides only", none: "none" }, auto: "its type's" },
  "district.plotLines": { label: "Plot lines", help: "Fences around yards and crofts in hamlets and villages, faint walls between long plots elsewhere" },
  "district.roofs": { label: "Roofs", help: "The roof materials its houses choose from", auto: "a mix for its type" },
  "district.roofStyles": { label: "Roof forms", help: "The roof forms its houses choose from", auto: "its type's mix" },

  "area.surface": { label: "Surface", auto: "trodden ground" },
  "area.fence": { label: "Fence", auto: "none" },
  "area.rot": { label: "Turned", help: "Degrees; a turned area can't be reshaped by its corners yet", more: true },
  "area.density": { label: "Density", help: "Sparse: lone trees and small clumps. Open: big trees standing apart, like wood pasture. Thick: groves with clearings. Dense: crowns touching, a few gaps. A wood drawn bigger or smaller keeps its look", auto: "thick", names: { sparse: "sparse", open: "open", thick: "thick", dense: "dense" } },
  "area.trees": { label: "Tree count", help: "A set number of trees, in place of the density (setting one clears the other)", auto: "from its density and size", more: true },
  "area.mix": { label: "Leafy share", kind: "share", key: "bare", help: "The share of leafy trees; the rest are firs (0 to 1)", auto: "by density and season: outside winter half to three quarters leafy (0.5 sparse, 0.75 open, 0.7 thick, 0.6 dense), in winter mostly firs" },
  "area.style": { label: "Style", names: { green: "village green", formal: "formal garden" }, auto: "village green" },
  "area.system": { label: "Field system", names: { patchwork: "hedged patchwork", strips: "open strips" }, help: "Else picked from its seed", auto: "by seed" },
  "area.fieldSize": { label: "Field size", help: "About how big a field (or a furlong of strips) is, in feet", auto: "by system" },
  "area.border": { label: "Border", help: "What bounds its fields; else picked from its seed", auto: "by seed" },
  "area.coverage": { label: "Cultivated", help: "The share of its fields that are farmed; the rest is grass (0 to 1)", auto: "0.65" },

  "wall.height": { label: "Height", help: "In feet" },
  "wall.straight": { label: "Straight", help: "Straight lines between its points (a town wall's runs) instead of a smooth curve" },
  "wall.thickness": { label: "Thickness", help: "How thick the wall is, in feet" },
  "wall.towers": { label: "Towers", names: { roofed: "roofed", open: "open, with battlements", mixed: "some of each" }, auto: "picked from its seed" },
  "wall.towerShape": { label: "Tower shape", names: { round: "round", square: "square", mixed: "some of each" }, auto: "picked from its seed (a palisade's are square)" },
  "wall.towerSpacing": { label: "Tower spacing", help: "About how far apart its towers stand along a straight run, in feet; there's one at every corner too", more: true },
  "wall.outside": { label: "Outside", names: { none: "nothing", ditch: "a dry ditch", moat: "a moat" }, help: "What runs along its outside" },
  "wall.ditchWidth": { label: "Ditch width", help: "How wide its ditch or moat is, in feet" },
  "wall.side": { label: "Outside is on the", names: { left: "left", right: "right" }, help: "For a wall that isn't a closed loop: which side is outside, going along it from its first point (a closed loop's outside is outward)", more: true },

  "prop.rot": { label: "Turned", help: "Degrees clockwise", notFor: ["tree"] }, // a tree is turned at random
  "prop.species": { label: "Tree", kind: "enum", values: ["conifer", "bare"], names: { conifer: "fir", bare: "leafy" }, auto: "leafy" },
  "prop.size": { label: "Size", help: "How wide it is, in feet (a tree's crown); else the usual size", more: true },

  "label.text": { label: "Text" },
  "label.show": { label: "Shown to", names: { gm: "the GM only", all: "everyone" } },
  "label.size": { label: "Size" },
  "label.angle": { label: "Turn", help: "Degrees clockwise. A label dropped on a road or water turns along it; drag the dot beside a picked label to turn it by hand" },
  "label.color": { label: "Color", kind: "color", help: "Left as the plan's label color unless set" },
  "label.font": { label: "Font", kind: "font", help: "Left as the plan's label font unless set" },
  "label.alpha": { label: "Opacity", help: "Lower for quiet labels, like a wood's or a field's name" },
  "label.of": { hidden: true },
  "label.offset": { hidden: true },
};

/** The plan-wide settings, by path: what the "Plan" panel shows. */
export const PLAN_FIELDS = [
  { path: "name", label: "Name", kind: "string" },
  { path: "season", label: "Season", kind: "enum", values: SEASONS },
  { path: "ground", label: "Ground", kind: "enum", values: SURFACES },
  { path: "size.squares.0", label: "Width", kind: "number", unit: "squares", min: 1, step: 1, required: true, help: "The map's width in squares" },
  { path: "size.squares.1", label: "Height", kind: "number", unit: "squares", min: 1, step: 1, required: true, help: "The map's height in squares" },
  { path: "size.ftPerSquare", label: "Feet a square", kind: "number", min: 1, max: 100, help: "25 suits a village or town" },
  { path: "output.pxPerSquare", label: "Pixels a square", kind: "number", min: 20, step: 1, whole: true, help: "The finished image's grid size, and so its size" },
  { path: "seed", label: "Seed", kind: "number", step: 1, whole: true, help: "Changing it redraws everything that has no seed of its own", more: true },
  { path: "output.scene.labelColor", label: "Label color", kind: "color", more: true, help: "Every label's color, unless a label sets its own" },
  { path: "output.scene.labelFont", label: "Label font", kind: "font", more: true, help: "Every label's font, unless a label sets its own" },
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
  // Water drawn along a path is a stream, river or canal; drawn as a shape, a pond, lake or sea
  const kinds = f.type === "water" ? t.classes.filter((c) => (Array.isArray(f.path) ? RUNNING : BODIES).includes(c)) : t.classes;
  if (t.classes) out.push({ name: "class", label: "Kind", kind: "enum", values: kinds, value: cls, auto: t.classes[0] });
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
    if (f.type === "prop" && name === "species" && value !== undefined && value !== null) value = isConifer(value) ? "conifer" : "bare"; // "pine" is drawn, and shown, as a fir
    let auto = txt.auto ?? (dflt === null || dflt === undefined ? null : dflt);
    if (f.type === "water" && name === "frozen" && dflt === null) auto = "in winter"; // a pond or lake left unset
    // A label's color and font fall back to the plan's; a name label's text to its feature's name
    if (f.type === "label" && name === "color") { const c = normalize(plan).output.scene.labelColor; auto = /^#[0-9a-f]{6}$/i.test(c ?? "") ? c : "#13202e"; }
    if (f.type === "label" && name === "font") auto = cleanFont(normalize(plan).output.scene.labelFont) ?? "Signika";
    if (f.type === "label" && name === "text" && f.of) { const o = featureOf(plan, f.of); auto = o ? `the name of ${o.name ?? o.id}` : null; }
    out.push({
      name, label: txt.label ?? name, help: txt.help ?? null, kind, values: values ?? null, names: txt.names ?? null,
      unit: spec.unit ?? null, min: spec.min ?? null, max: spec.max ?? null,
      value, auto, more: !!txt.more,
    });
    // A district's or area's name on the map: a label that follows it (after its name)
    // A landmark's roof, for all its buildings at once (blank when they differ)
    if (name === "name" && f.type === "landmark") {
      const roofs = new Set((Array.isArray(f.buildings) ? f.buildings : []).map((b) => b?.roof ?? "slate"));
      out.push({ name: ROOF_ALL, label: "Roof", help: "The roof of all its buildings", kind: "enum", values: ROOFS, names: null, unit: null, min: null, max: null, value: roofs.size === 1 ? [...roofs][0] : undefined, auto: roofs.size > 1 ? "mixed" : null, more: false, required: true });
    }
    if (name === "name" && (f.type === "district" || f.type === "area" || f.type === "landmark"))
      out.push({ name: NAME_LABEL, label: "Name on the map", help: "A label with its name that sits inside it and moves with it. Click the label to move it, turn it or change its look", kind: "boolean", values: null, names: null, unit: null, min: null, max: null, value: nameLabelsOf(plan, id).length > 0, auto: false, more: false, required: true });
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
    case "font":
      if (!String(raw).trim()) return { value: undefined };
      return cleanFont(String(raw)) ? { value: cleanFont(String(raw)) } : { error: `${field.label} should be a font's name (letters, numbers, spaces, dots and dashes).` };
    case "color":
      return /^#[0-9a-f]{6}$/i.test(String(raw).trim()) ? { value: String(raw).trim().toLowerCase() } : { error: `${field.label} should be a color like #13202e.` };
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
  if (name === NAME_LABEL) return { plan: withNameLabel(plan, id, value) };
  if (name === ROOF_ALL) {
    if (value === undefined) return { plan };
    const next = structuredClone(plan);
    for (const b of featureOf(next, id).buildings ?? []) if (isObj(b)) b.roof = value;
    return { plan: next };
  }
  // A placed label with no text couldn't be seen or picked again: it keeps its words (Delete takes it out)
  if (f.type === "label" && name === "text" && value === undefined && !f.of) return { error: "A label needs some text (Delete takes it out)." };
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
  // A wood's character and its tree count are two ways to say how thick it is: the one set last wins (the count used
  // to win whatever the density said, so an older wood's density did nothing)
  if (g.type === "area" && g.class === "woods" && value !== undefined) {
    if (name === "density") delete g.trees;
    if (name === "trees") delete g.density;
  }
  if (name === "class") {
    const t = TYPES[g.type];
    for (const [k, spec] of Object.entries(t.fields)) if (spec.only && !spec.only.includes(g.class ?? t.classes[0])) delete g[k];
  }
  return { plan: next };
}

/** The inspector's setting for a district's or area's name on the map (not a plan field: it adds or takes out a label). */
export const NAME_LABEL = "@nameLabel";

/** The inspector's setting for a landmark's roof (all its buildings at once). */
export const ROOF_ALL = "@roof";

/** The plan with a feature's name label added (on) or taken out (off). */
function withNameLabel(plan, id, on) {
  const had = nameLabelsOf(plan, id);
  if (!!on === had.length > 0) return plan;
  if (!on) return { ...structuredClone(plan), features: plan.features.filter((f) => !(isObj(f) && f.type === "label" && f.of === id)).map((f) => structuredClone(f)) };
  const next = structuredClone(plan);
  const f = featureOf(next, id);
  const taken = new Set(next.features.map((x) => x?.id));
  let lid = `${id}-name`;
  for (let n = 2; taken.has(lid); n++) lid = `${id}-name-${n}`;
  next.features.push({ id: lid, type: "label", of: id, size: f.type === "district" ? "large" : "normal" });
  return next;
}

/** The plan without a feature: its seed and its lock go with it, and so do the name labels following it. */
export function deleteFeature(plan, id) {
  const next = structuredClone(plan);
  next.features = (Array.isArray(next.features) ? next.features : []).filter((f) => !(isObj(f) && (f.id === id || (f.type === "label" && f.of === id))));
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

