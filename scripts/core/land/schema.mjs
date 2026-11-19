/**
 * The `land` block of an overland plan: its defaults and its checks, and the painted terrain feature classes. Kept
 * apart from the generator so plan.mjs and check.mjs can use it without loading the generator. Pure.
 */

/** The generator's version: a change that moves land bumps it (plans record it as land.gen). */
export const GEN = 1;

export const LAND_TYPES = ["continents", "supercontinent", "archipelago", "island", "arc", "coastal", "landlocked", "peninsula", "inland-sea"];
export const LAND_CLIMATES = ["temperate", "cold", "warm", "arid", "tropical", "auto"];
export const LAND_AMOUNTS = ["few", "some", "many"];
export const LAND_AGES = ["young", "mature", "old"];
export const LAND_SIDES = ["north", "south", "east", "west", "auto"];
/** The intent layers a plan may carry (8-bit gray rasters over the context frame). */
export const LAYER_NAMES = ["relief", "rock", "water", "climateWet", "climateWarm", "cover", "zones", "lock"];
/** Painted terrain classes: range is drawn along a path, peak at a point, the rest as shapes. */
export const TERRAIN_CLASSES = ["range", "peak", "land", "sea", "basin", "plateau", "lowland", "hardness", "climate", "biome", "lock"];
export const terrainGeometry = (cls) => (cls === "range" ? "path" : cls === "peak" ? "point" : "shape");

/** The land block with every default filled (never changes its input). */
export function normalizeLand(land = {}) {
  const L = { ...(land && typeof land === "object" ? land : {}) };
  L.gen = Number.isInteger(L.gen) ? L.gen : GEN;
  if (!LAND_TYPES.includes(L.type)) L.type = "continents";
  L.mountains = Number.isFinite(L.mountains) ? Math.min(1, Math.max(0, L.mountains)) : 0.5;
  L.age = LAND_AGES.includes(L.age) ? L.age : "mature";
  L.coast = Number.isFinite(L.coast) ? Math.min(1, Math.max(0, L.coast)) : 0.5;
  L.rivers = LAND_AMOUNTS.includes(L.rivers) ? L.rivers : "some";
  L.lakes = LAND_AMOUNTS.includes(L.lakes) ? L.lakes : "some";
  L.plates ??= "auto";
  L.climate = LAND_CLIMATES.includes(L.climate) ? L.climate : "temperate";
  if (!Number.isFinite(L.wind)) L.wind = "auto";
  L.rain = ["drier", "normal", "wetter"].includes(L.rain) ? L.rain : "normal";
  L.plateaus = L.plateaus === true;
  L.volcanic = L.volcanic === true;
  L.zones = Array.isArray(L.zones) ? L.zones : [];
  L.names = L.names && typeof L.names === "object" ? L.names : {};
  L.layers ??= null;
  L.keep ??= null;
  return L;
}

/** Problems with a raw land block: [{ level, field, message }]. */
export function checkLand(raw) {
  const out = [];
  const err = (field, message) => out.push({ level: "error", field: `land.${field}`, message });
  const warn = (field, message) => out.push({ level: "warning", field: `land.${field}`, message });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { err("", "land should be an object, like { type: \"continents\" }."); return out; }
  const known = new Set(["gen", "type", "seaSide", "share", "mountains", "plates", "age", "plateaus", "volcanic", "coast", "climate", "latitude", "wind", "rain", "rivers", "lakes", "seed", "margin", "layers", "zones", "names", "keep"]);
  for (const k of Object.keys(raw)) if (!known.has(k)) warn(k, `land.${k} isn't a setting AtlasScribe knows; it's kept but does nothing.`);
  if (raw.gen !== undefined && !(Number.isInteger(raw.gen) && raw.gen >= 1)) err("gen", "land.gen must be a whole number (the generator version).");
  else if (Number.isInteger(raw.gen) && raw.gen > GEN) warn("gen", `This land was made by a newer AtlasScribe (generator ${raw.gen}); this version makes generator ${GEN}, so the land will look different unless it was kept.`);
  else if (Number.isInteger(raw.gen) && raw.gen < GEN && !raw.keep) warn("gen", `This land was made by an older generator (${raw.gen}); it will look different now. Keep this land to stop that.`);
  if (raw.type !== undefined && !LAND_TYPES.includes(raw.type)) err("type", `land.type "${raw.type}" isn't one AtlasScribe knows (${LAND_TYPES.join(", ")}).`);
  if (raw.seaSide !== undefined && !LAND_SIDES.includes(raw.seaSide)) warn("seaSide", `land.seaSide should be one of ${LAND_SIDES.join(", ")}; the seed picks one.`);
  const unit = (k, lo, hi) => { if (raw[k] !== undefined && !(Number.isFinite(raw[k]) && raw[k] >= lo && raw[k] <= hi)) err(k, `land.${k} must be a number from ${lo} to ${hi}.`); };
  unit("share", 0.05, 0.97); unit("mountains", 0, 1); unit("coast", 0, 1); unit("margin", 0, 1);
  if (raw.plates !== undefined && !(raw.plates === "auto" || LAND_AMOUNTS.includes(raw.plates) || (Number.isInteger(raw.plates) && raw.plates >= 2 && raw.plates <= 40))) err("plates", "land.plates must be auto, few, some, many or a whole number from 2 to 40.");
  if (raw.age !== undefined && !LAND_AGES.includes(raw.age)) err("age", `land.age must be ${LAND_AGES.join(", ")}.`);
  if (raw.climate !== undefined && !LAND_CLIMATES.includes(raw.climate)) err("climate", `land.climate must be one of ${LAND_CLIMATES.join(", ")}.`);
  if (raw.latitude !== undefined && raw.latitude !== null && !(Array.isArray(raw.latitude) && raw.latitude.length === 2 && raw.latitude.every((v) => Number.isFinite(v) && v >= -90 && v <= 90))) err("latitude", "land.latitude must be [top, bottom] in degrees from -90 to 90, or null.");
  if (raw.wind !== undefined && raw.wind !== "auto" && !(Number.isFinite(raw.wind) && raw.wind >= 0 && raw.wind <= 360)) err("wind", "land.wind must be auto or a heading in degrees (the direction the wind comes from: 270 is a west wind).");
  if (raw.rain !== undefined && !["drier", "normal", "wetter"].includes(raw.rain)) err("rain", "land.rain must be drier, normal or wetter.");
  for (const k of ["rivers", "lakes"]) if (raw[k] !== undefined && !LAND_AMOUNTS.includes(raw[k])) err(k, `land.${k} must be few, some or many.`);
  for (const k of ["plateaus", "volcanic"]) if (raw[k] !== undefined && typeof raw[k] !== "boolean") err(k, `land.${k} must be true or false.`);
  if (raw.seed !== undefined && raw.seed !== null && !Number.isInteger(raw.seed)) err("seed", "land.seed must be a whole number, or null for the plan's seed.");
  if (raw.zones !== undefined) {
    if (!Array.isArray(raw.zones)) err("zones", "land.zones must be a list.");
    else {
      const idx = new Set();
      raw.zones.forEach((z, k) => {
        if (!z || typeof z !== "object") return err(`zones[${k}]`, "a zone must be an object, like { id, index, name, biome, reacts }.");
        if (!(Number.isInteger(z.index) && z.index >= 1 && z.index <= 255)) err(`zones[${k}].index`, "a zone's index must be a whole number from 1 to 255 (its value in the zones layer).");
        else if (idx.has(z.index)) err(`zones[${k}].index`, `two zones share index ${z.index}.`); else idx.add(z.index);
        if (z.reacts !== undefined && typeof z.reacts !== "boolean") err(`zones[${k}].reacts`, "a zone's reacts must be true or false.");
      });
    }
  }
  if (raw.layers !== undefined && raw.layers !== null) {
    if (typeof raw.layers !== "object") err("layers", "land.layers must be an object of painted layers.");
    else for (const k of Object.keys(raw.layers)) {
      if (k === "size") { if (!(Array.isArray(raw.layers.size) && raw.layers.size.length === 2 && raw.layers.size.every((v) => Number.isInteger(v) && v >= 8 && v <= 1024))) err("layers.size", "land.layers.size must be [width, height] in pixels, 8 to 1024."); continue; }
      if (!LAYER_NAMES.includes(k)) warn(`layers.${k}`, `land.layers.${k} isn't a layer AtlasScribe knows (${LAYER_NAMES.join(", ")}); it's ignored.`);
      else if (typeof raw.layers[k] !== "string" || !raw.layers[k].startsWith("data:image/png;base64,")) err(`layers.${k}`, `land.layers.${k} must be a PNG as a data URL.`);
    }
  }
  if (raw.keep !== undefined && raw.keep !== null && !(typeof raw.keep === "object" && typeof raw.keep.path === "string")) err("keep", "land.keep must be null or { path, gen, frame, size, hash } (a kept land's files).");
  return out;
}
