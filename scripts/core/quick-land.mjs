/**
 * Quick Start's generated regions: a kingdom, realm, continent or world map from a few choices, as an overland plan
 * whose land the generator makes (core/land). The land's type, climate and mountains are always written (Any picks
 * them from the seed); the other settings only when chosen, so the generator's defaults stay its own. A world takes
 * a span of latitudes instead of a climate and a hemisphere (pole to pole by default). Pure.
 */
import { PLAN_VERSION } from "./plan.mjs";
import { rng } from "./rng.mjs";
import { slug } from "./quick.mjs";
import { SCALES, gridFor, MILE_FT } from "./land/units.mjs";
import { LAND_TYPES, LAND_AGES } from "./land/schema.mjs";
import { namer } from "./land/names.mjs";
import { parseNameSet } from "./land/namesets.mjs";

/** The choices; the first of each is the default. Any (or auto) lets the seed, or the generator, pick. */
export const LAND_QUICK = {
  scale: ["kingdom", "realm", "continent", "world"],
  type: ["any", ...LAND_TYPES],
  seaSide: ["auto", "north", "south", "east", "west"],
  climate: ["any", "temperate", "cold", "warm", "arid", "tropical"],
  hemisphere: ["north", "south"],
  span: ["poles", "north", "south", "equator"],
  mountains: ["any", "none", "few", "some", "many"],
  towns: ["some", "few", "many"],
  grid: ["hex", "square"],
  size: ["medium", "small", "large"],
  names: ["english", "mixed", "invented"],
  season: ["summer", "spring", "autumn", "winter"],
  // (under More)
  age: ["any", ...LAND_AGES],
  plates: ["auto", "few", "some", "many"],
  coast: ["any", "smooth", "some", "rugged"],
  wind: ["auto", "west", "east", "north", "south"],
  rain: ["normal", "drier", "wetter"],
  rivers: ["some", "few", "many"],
  lakes: ["some", "few", "many"],
  plateaus: ["no", "yes"],
  volcanic: ["no", "yes"],
};
/** The choices shown under More. */
export const LAND_MORE = ["age", "plates", "coast", "wind", "rain", "rivers", "lakes", "plateaus", "volcanic"];

export const LAND_QUICK_LABELS = {
  scale: { kingdom: "Kingdom (240 by 160 mi)", realm: "Realm (720 by 480 mi)", continent: "Continent (2,400 by 1,600 mi)", world: "World (7,200 by 4,800 mi)" },
  type: { any: "Any", continents: "Continents", supercontinent: "One great continent", archipelago: "Many islands", island: "An island", arc: "An island arc", coastal: "A coast", landlocked: "No sea", peninsula: "A peninsula", "inland-sea": "An inland sea" },
  seaSide: { auto: "Any", north: "North", south: "South", east: "East", west: "West" },
  climate: { any: "Any", temperate: "Temperate", cold: "Cold", warm: "Warm", arid: "Dry", tropical: "Tropical" },
  hemisphere: { north: "Northern", south: "Southern" },
  span: { poles: "Pole to pole", north: "Northern half", south: "Southern half", equator: "Across the equator" },
  mountains: { any: "Any", none: "None", few: "Few", some: "Some", many: "Many" },
  towns: { few: "Few", some: "Some", many: "Many" },
  grid: { hex: "Hexes", square: "Squares" },
  size: { small: "Small (2,048 px)", medium: "Medium (4,096 px)", large: "Large (8,192 px, slower)" },
  names: { english: "English countryside", mixed: "English places, older features", invented: "One invented tongue" },
  season: { summer: "Summer", spring: "Spring", autumn: "Autumn", winter: "Winter" },
  age: { any: "Any", young: "Young (sharp)", mature: "Mature", old: "Old (worn down)" },
  plates: { auto: "Any", few: "Few", some: "Some", many: "Many" },
  coast: { any: "Any", smooth: "Smooth", some: "Some inlets", rugged: "Rugged" },
  wind: { auto: "Any", west: "From the west", east: "From the east", north: "From the north", south: "From the south" },
  rain: { normal: "Normal", drier: "Drier", wetter: "Wetter" },
  rivers: { few: "Few", some: "Some", many: "Many" },
  lakes: { few: "Few", some: "Some", many: "Many" },
  plateaus: { no: "None", yes: "Behind the ranges" },
  volcanic: { no: "None", yes: "Volcanoes" },
};

/** The picture's long side in pixels for each Size. */
export const LAND_PX = { small: 2048, medium: 4096, large: 8192 };
/** What Mountains and Coast are as the land's 0 to 1 settings, and Wind as the heading it comes from. */
const MOUNTAINS = { none: 0, few: 0.25, some: 0.5, many: 0.8 };
const COAST = { smooth: 0.2, some: 0.5, rugged: 0.85 };
const WIND = { north: 0, east: 90, south: 180, west: 270 };
/** The kinds of land the seed picks from at each scale (a kingdom is rarely a world's worth of continents). */
const TYPES_AT = {
  kingdom: ["coastal", "coastal", "peninsula", "island", "landlocked", "inland-sea", "archipelago"],
  realm: ["coastal", "peninsula", "island", "landlocked", "inland-sea", "archipelago", "continents"],
  continent: ["continents", "supercontinent", "coastal", "peninsula", "inland-sea", "archipelago", "arc"],
  world: ["continents", "continents", "supercontinent", "archipelago"],
};
const CLIMATES_ANY = ["temperate", "temperate", "temperate", "cold", "warm", "arid", "tropical"];

/**
 * The plan. options: { scale, type, seaSide, climate, hemisphere, span (a world's), mountains, towns, grid, size,
 * names, season, age, plates, coast, wind, rain, rivers, lakes, plateaus, volcanic, nameSet ({ name, text, from }: a
 * set from the library, used for the names), name, seed }.
 * Returns { plan, choices, notes }.
 */
export function landPlan(options = {}) {
  const seed = Number.isFinite(Number(options.seed)) && Number(options.seed) >= 1 ? Math.floor(Number(options.seed)) : 1;
  const notes = [];
  const pick = (k) => {
    const v = options[k];
    if (v != null && v !== "" && !LAND_QUICK[k].includes(v)) notes.push(`"${v}" isn't a ${k} Quick Start knows for a generated region (${LAND_QUICK[k].join(", ")}), so ${["any", "auto"].includes(LAND_QUICK[k][0]) ? "the seed picked one" : `it's ${LAND_QUICK[k][0]}`}.`);
    return LAND_QUICK[k].includes(v) ? v : LAND_QUICK[k][0];
  };
  const c = Object.fromEntries(Object.keys(LAND_QUICK).map((k) => [k, pick(k)]));
  // (each Any from a stream of its own, so picking one choice doesn't change what the seed picks for another)
  const any = (k, list) => rng(seed, "quick-land", k).pick(list);
  if (c.type === "any") c.type = any("type", TYPES_AT[c.scale]);
  // (a world runs from the poles to the equator: its climate is its latitude, so the choice is left out)
  if (c.scale === "world") c.climate = null;
  else if (c.climate === "any") c.climate = any("climate", CLIMATES_ANY);
  if (c.mountains === "any") c.mountains = any("mountains", ["few", "some", "some", "many"]);
  const s = SCALES[c.scale];
  const squares = gridFor(s.miles, s.cell, c.grid);
  // (pixels a cell from the picture's long side: a hex map's width is its columns at sqrt(3)/2 apart)
  const across = c.grid === "hex" ? (squares[0] - 1) * (Math.sqrt(3) / 2) + 2 / Math.sqrt(3) : squares[0];
  const down = c.grid === "hex" ? squares[1] + 0.5 : squares[1];
  // (rounded down, so a picture never passes the size asked: 8,192 px is where some graphics cards stop)
  const pxPerSquare = Math.max(20, Math.floor(LAND_PX[c.size] / Math.max(across, down)));
  // The land: its type, climate, mountains and towns, then the rest only as chosen
  const land = { type: c.type, ...(c.climate ? { climate: c.climate } : {}), mountains: MOUNTAINS[c.mountains], towns: c.towns };
  if (c.seaSide !== "auto") land.seaSide = c.seaSide;
  if (c.age !== "any") land.age = c.age;
  if (c.plates !== "auto") land.plates = c.plates;
  if (c.coast !== "any") land.coast = COAST[c.coast];
  if (c.wind !== "auto") land.wind = WIND[c.wind];
  if (c.rain !== "normal") land.rain = c.rain;
  if (c.rivers !== "some") land.rivers = c.rivers;
  if (c.lakes !== "some") land.lakes = c.lakes;
  if (c.plateaus === "yes") land.plateaus = true;
  if (c.volcanic === "yes") land.volcanic = true;
  // Latitudes: a world's span (the northern half is the generator's own: no setting), a smaller map's hemisphere
  if (c.scale === "world") {
    if (c.span === "poles") land.latitude = [90, -90];
    else if (c.span === "equator") land.latitude = [35, -35];
    else if (c.span === "south") land.hemisphere = "south";
  } else if (c.hemisphere === "south") land.hemisphere = "south";
  // Names: a style, or a set of the GM's own copied in (a set that can't make names is left out, with a note)
  const set = options.nameSet && typeof options.nameSet.text === "string" ? options.nameSet : null;
  const parsed = set ? parseNameSet(set.text) : null;
  if (set && (!parsed.set || parsed.problems.some((p) => p.level === "error"))) notes.push(`The name set "${set.name ?? "Name set"}" can't make names (${parsed.problems.find((p) => p.level === "error")?.message ?? "it makes none"}), so ${LAND_QUICK_LABELS.names[c.names]} names are used.`);
  if (set && parsed.set && !parsed.problems.some((p) => p.level === "error")) {
    land.nameStyle = "custom";
    land.nameSet = { name: typeof set.name === "string" && set.name.trim() ? set.name.trim() : "Name set", text: set.text, ...(set.from ? { from: set.from } : {}) };
  } else land.nameStyle = c.names;
  // The map's name: the one given, else a name for the land in its own style
  const given = typeof options.name === "string" ? options.name.trim() : "";
  const nm = land.nameStyle === "custom" ? namer("custom", seed, { set: parsed.set }) : namer(land.nameStyle, seed);
  const made = nm.feature("land", {}, "map-name").replace(/^the /, "The ");
  const name = given || made;
  const plan = {
    atlasScribe: PLAN_VERSION, id: `${slug(name)}-${seed}`, name, kind: "region", seed, season: c.season,
    size: { squares, ftPerSquare: s.cell * MILE_FT },
    output: { grid: c.grid, pxPerSquare, scene: { name, weather: "none" } },
    land,
    features: [],
  };
  return { plan, choices: { ...c, seed, name, ...(land.nameSet ? { nameSet: land.nameSet.name } : {}) }, notes };
}
