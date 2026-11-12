/**
 * A district's character: what it's for, beside its profile (how built up it is). A character shifts the odds of
 * its profile's numbers rather than making the district uniform (real quarters were mixed): plot sizes, how much of
 * the plot the house takes, house shapes and details, gardens, roofs, and its streets. Homes, the default, changes
 * nothing. Pure: runs anywhere.
 */

/** The characters this version knows, the default first. */
export const CHARACTERS = ["homes", "market", "merchants", "crafts", "docks", "nobles", "temple", "poor", "garrison"];

/** What the window calls each. */
export const CHARACTER_LABELS = {
  homes: "Homes", market: "Market", merchants: "Merchants", crafts: "Crafts", docks: "Docks", nobles: "Nobles",
  temple: "Temple", poor: "Poor quarter", garrison: "Garrison",
};

/**
 * Per character, changes to its profile's plot numbers (see LOT_TYPES) and street numbers (see DISTRICT_TYPES).
 * lots: frontage, depth and houseDepth multiply the profile's ranges; cover and setback are ranges in their own
 * right, or { add } to shift the profile's; outbuilding, croft, merge and rows are shares (number) or { add } or
 * { mul };
 * shapes and extras: each share multiplied (mul) then raised (add), kept between 0 and 1; roofs: weights multiplied
 * by name (missing names unchanged), add: new weights; styles: weights multiplied likewise; fill: a mix of its own.
 * gardens: the share of houses with a tended garden when the district doesn't say. streets: spacing, width and the
 * lanes' spacing multiply; bend multiplies; trim replaces.
 */
export const CHARACTER = {
  homes: {},
  // Narrow, deep-built frontages along wide streets: shops and stalls fronting the street, little behind
  market: {
    lots: { frontage: 0.8, depth: 0.85, cover: { min: 0.85 }, setback: [0, 0], outbuilding: { mul: 0.5 }, croft: 0, fill: { open: 0.6, trees: 0.25, garden: 0.15 } },
    gardens: 0.03,
    streets: { width: 1.3 },
  },
  // Wide plots and big houses around courtyards, warehouses at the back, tile and slate
  merchants: {
    lots: {
      frontage: 1.35, depth: 1.1, houseDepth: 1.15, merge: { add: 0.15 }, croft: 0, rows: { mul: 0.5 },
      shapes: { L: { add: 0.05 }, U: { add: 0.1 }, court: { add: 0.18 } },
      extras: { dormers: { add: 0.15 }, bay: { add: 0.08 }, turret: { add: 0.05 }, rear: { add: 0.25 } },
      roofs: { mul: { thatch: 0.1, "wood-shingle": 0.4, "wood-shingle-light": 0.4 }, add: { "tile-red": 1 } },
      fill: { garden: 0.35, orchard: 0.2, trees: 0.25, open: 0.2 },
    },
    gardens: 0.2,
  },
  // Workshops and yards: more outbuildings and ranges at the back, open yards, few gardens
  crafts: {
    lots: {
      frontage: 0.95, outbuilding: { add: 0.35 }, croft: { mul: 0.5 },
      shapes: { L: { add: 0.1 } }, extras: { rear: { add: 0.3 }, dormers: { mul: 0.5 }, turret: { mul: 0.3 } },
      fill: { open: 0.6, trees: 0.25, garden: 0.15 },
    },
    gardens: 0.04,
  },
  // Long, plain buildings close together by the water, yards and no gardens
  docks: {
    lots: {
      frontage: 1.2, depth: 0.8, cover: { min: 0.8 }, setback: [0, 5], outbuilding: { add: 0.2 }, croft: 0, rows: 0,
      shapes: { L: { mul: 0.6 }, U: { mul: 0.3 }, court: { mul: 0.3 } }, extras: { dormers: { mul: 0.3 }, turret: 0, bay: 0, rear: { add: 0.2 } },
      roofs: { mul: { thatch: 0.2 }, add: { "wood-shingle-dark": 1 } },
      styles: { mul: { gable: 1.5, mansard: 0.2, "half-hip": 0.5 } },
      fill: { open: 0.85, trees: 0.15 },
    },
    gardens: 0,
    streets: { spacing: 0.8, width: 0.9 },
  },
  // Big houses set back in their grounds, gardens and orchards, wide calm streets
  nobles: {
    lots: {
      frontage: 2.2, depth: 1.3, houseDepth: 1.25, cover: [0.45, 0.7], setback: [20, 45], merge: { add: 0.2 }, outbuilding: 0.5, croft: 0, rows: 0,
      shapes: { L: { add: 0.1 }, U: { add: 0.2 }, court: { add: 0.25 } },
      extras: { turret: { add: 0.15 }, dormers: { add: 0.2 }, bay: { add: 0.2 }, steps: { mul: 0.5 } },
      roofs: { mul: { thatch: 0, "wood-shingle": 0.1, "wood-shingle-dark": 0.1, "wood-shingle-light": 0.1 }, add: { "slate-blue": 1, "tile-red": 1 } },
      styles: { mul: { hip: 1.6, mansard: 1.5, flat: 0.3 } },
      fill: { garden: 0.4, orchard: 0.3, trees: 0.3 },
      wild: 0.8, // trees in the grounds a little closer
    },
    gardens: 0.7,
    streets: { spacing: 1.3, width: 1.3, bend: 0.6 },
  },
  // Quiet plots around the temple: houses set back a little, gardens, slate and tile
  temple: {
    lots: {
      frontage: 1.4, setback: { add: [5, 15] }, croft: 0, rows: 0,
      shapes: { court: { add: 0.15 }, U: { add: 0.05 } },
      roofs: { mul: { thatch: 0.2, "wood-shingle": 0.5 }, add: { slate: 1 } },
      fill: { garden: 0.45, orchard: 0.25, trees: 0.3 },
    },
    gardens: 0.5,
  },
  // Narrow, shallow plots packed tight, plain houses, thatch and dark shingle, crooked narrow streets with alleys
  poor: {
    lots: {
      frontage: 0.7, depth: 0.75, houseDepth: 0.8, cover: { min: 0.85 }, setback: [0, 3], merge: 0, outbuilding: { mul: 0.5 }, croft: { mul: 0.5 },
      shapes: { L: { mul: 0.3 }, T: { mul: 0.3 }, U: { mul: 0.2 }, court: 0 },
      extras: { bay: 0, dormers: { mul: 0.2 }, turret: 0, steps: { mul: 0.5 }, rear: { mul: 0.5 } },
      roofs: { mul: { "slate-purple": 0.2, "slate-blue": 0.3, "tile-orange": 0.3, "tile-tan": 0.3 }, add: { thatch: 3, "wood-shingle-dark": 2, "wood-shingle": 1 } },
      styles: { mul: { mansard: 0, hip: 0.6, flat: 0.5 } },
      fill: { open: 0.7, trees: 0.3 },
    },
    gardens: 0,
    streets: { spacing: 0.7, width: 0.75, lanes: 0.75, bend: 1.6, trim: false },
  },
  // Big ranges around yards, straight wide streets, no gardens
  garrison: {
    lots: {
      frontage: 1.5, depth: 1.2, houseDepth: 1.1, cover: { min: 0.7 }, merge: { add: 0.15 }, outbuilding: { add: 0.2 }, croft: 0, rows: 0,
      shapes: { L: { add: 0.1 }, U: { add: 0.2 }, court: { add: 0.3 } },
      extras: { bay: 0, dormers: 0, turret: { mul: 0.5 }, steps: 0 },
      roofs: { mul: { thatch: 0.2, "wood-shingle-light": 0.3 }, add: { slate: 1 } },
      styles: { mul: { gable: 1.4, "half-hip": 0.3, mansard: 0 } },
      fill: { open: 1 },
    },
    gardens: 0,
    streets: { width: 1.3, spacing: 1.2, bend: 0 },
  },
};

/**
 * How each character shows from above, beyond its plots (1 Nov: the quarters must read apart at a glance,
 * as on good fantasy city maps). ground: what covers the district under its houses (a surface's art at alpha, or
 * lush grass); street: its streets' surface when the district doesn't say; streetTrees: trees along its streets;
 * roofs: its own roof materials, all of them used (not a random few from its profile's); back: the empty middles of
 * its blocks built up (sizes in feet, the gap between buildings, their use; clutter between them, or gardens and
 * orchards); sheds: the share of plots whose back is built up with sheds and stores rather than left open; extras:
 * how many small things stand by its streets (wells, fountains, wayside shrines, watch posts), as in good city maps
 * (more shrines and watch posts where the poor live, fountains where the rich do).
 */
export const LOOK = {
  homes: {},
  market: {
    ground: { surface: "cobble", alpha: 0.85 }, street: "cobble",
    roofs: { "tile-red": 3, "tile-orange": 2, "tile-brown": 1 },
    back: { len: [18, 30], dep: [14, 22], gap: 5, use: "store", clutter: ["crate", "barrel", "sacks"] }, sheds: 0.5,
    extras: { well: 1, watch: 1 },
  },
  merchants: {
    ground: { surface: "cobble", alpha: 0.6 }, street: "cobble",
    roofs: { "tile-red": 2, slate: 2, "tile-tan": 1 },
    back: { len: [28, 50], dep: [18, 28], gap: 8, use: "store", clutter: ["crate", "barrel"] }, sheds: 0.4,
    extras: { well: 1, fountain: 1 },
  },
  crafts: {
    ground: { surface: "dirt", alpha: 0.7 }, street: "dirt",
    roofs: { "wood-shingle": 2, "wood-shingle-dark": 2, "tile-brown": 1 },
    back: { len: [14, 30], dep: [12, 20], gap: 6, use: "workshop", clutter: ["planks", "firewood", "barrel", "crate", "cart"] }, sheds: 0.6,
    extras: { well: 3, shrine: 1 },
  },
  docks: {
    ground: { surface: "cobble", alpha: 0.75 }, street: "cobble",
    roofs: { "wood-shingle-dark": 3, slate: 2 },
    back: { len: [40, 70], dep: [22, 32], gap: 8, use: "store", clutter: ["crate", "crate", "barrel", "sacks"] }, sheds: 0.5,
    extras: { well: 1, watch: 2 },
  },
  nobles: { ground: { lush: true, alpha: 0.55 }, street: "cobble", streetTrees: true, roofs: { "slate-blue": 3, "slate-purple": 2, slate: 1 }, extras: { fountain: 2 } },
  temple: {
    ground: { lush: true, alpha: 0.45 }, street: "cobble", streetTrees: true, roofs: { slate: 2, "slate-blue": 1 },
    // A close: clergy houses, almshouses and the like among kitchen gardens and orchards (not a graveyard: a parish
    // buries its dead in its temple's yard, and a city's cemeteries lie outside its walls)
    back: { len: [30, 46], dep: [24, 32], gap: 14, use: "house", gardens: true },
    extras: { shrine: 2, well: 1 },
  },
  poor: {
    ground: { surface: "dirt", alpha: 0.85, mud: true }, street: "dirt",
    roofs: { thatch: 3, "wood-shingle-dark": 2, "wood-shingle": 1 },
    back: { len: [12, 20], dep: [10, 15], gap: 3, use: "house", clutter: ["barrel", "firewood"] }, sheds: 0.7,
    extras: { well: 3, shrine: 3, watch: 2 },
  },
  garrison: {
    ground: { surface: "trodden", alpha: 0.8 }, street: "gravel", roofs: { slate: 3, "tile-brown": 1 },
    back: { len: [50, 90], dep: [22, 28], gap: 18, use: "store", clutter: ["crate", "cart", "hay"] },
    extras: { well: 1, watch: 2 },
  },
};

/**
 * How ordinary housing looks in a city district: trodden ground, its block middles built up with houses and yards (a
 * city's homes are packed, not houses on grass), and a few wells (1 Nov).
 */
const CITY_HOMES = {
  ground: { surface: "trodden", alpha: 0.6 }, street: "cobble",
  back: { len: [16, 26], dep: [12, 18], gap: 4, use: "house", clutter: ["barrel", "firewood"] },
  extras: { well: 2 },
};

/** A district's look: its character's, and for homes in a city district the city's own. */
export function lookOf(d) {
  const c = characterOf(d);
  if (c === "homes" && (d?.profile === "city" || d?.profile === "core")) return CITY_HOMES;
  return LOOK[c] ?? {};
}

/** The district's character, the default for anything this version doesn't know. */
export const characterOf = (district) => (Object.hasOwn(CHARACTER, district?.character) ? district.character : "homes");

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const scaled = (range, m) => (Array.isArray(range) && Number.isFinite(m) ? range.map((v) => v * m) : range);
/** A range changed by a character: a range of its own, { add: n or [lo, hi] } shifted, or { min } raised to. */
function ranged(range, ch) {
  if (ch === undefined) return range;
  if (Array.isArray(ch)) return ch;
  const [lo, hi] = range ?? [0, 0];
  if (ch.add !== undefined) { const [a, b] = Array.isArray(ch.add) ? ch.add : [ch.add, ch.add]; return [lo + a, hi + b]; }
  if (ch.min !== undefined) return [Math.max(lo, ch.min), Math.max(hi, ch.min)];
  return range;
}
/** A share changed by a character: a number of its own, or { mul, add }. */
function share(v, ch) {
  if (ch === undefined) return v;
  if (typeof ch === "number") return ch;
  return clamp01((v ?? 0) * (ch.mul ?? 1) + (ch.add ?? 0));
}
/** Each share in a set changed (see share). */
function shares(set, ch) {
  if (!ch) return set;
  const out = { ...(set ?? {}) };
  for (const [k, c] of Object.entries(ch)) out[k] = share(out[k], c);
  return out;
}
/** Weights changed: some multiplied, some added; any that come to nothing dropped (at least one is kept). */
function weights(set, ch) {
  if (!ch) return set;
  const out = { ...(set ?? {}) };
  for (const [k, m] of Object.entries(ch.mul ?? {})) if (k in out) out[k] *= m;
  for (const [k, a] of Object.entries(ch.add ?? {})) out[k] = (out[k] ?? 0) + a;
  const kept = Object.fromEntries(Object.entries(out).filter(([, w]) => w > 0));
  return Object.keys(kept).length ? kept : set;
}

/** A profile's plot numbers with a character's changes (the same object for homes). */
export function withCharacterLots(T, character) {
  const c = CHARACTER[character]?.lots;
  if (!c) return T;
  const L = LOOK[character] ?? {};
  return {
    ...T,
    frontage: scaled(T.frontage, c.frontage), depth: scaled(T.depth, c.depth), houseDepth: scaled(T.houseDepth, c.houseDepth),
    cover: ranged(T.cover, c.cover).map(clamp01), setback: ranged(T.setback, c.setback),
    outbuilding: share(T.outbuilding, c.outbuilding), croft: share(T.croft, c.croft), merge: share(T.merge ?? 0, c.merge), rows: share(T.rows ?? 0, c.rows),
    shapes: shares(T.shapes, c.shapes), extras: shares(T.extras, c.extras),
    roofs: L.roofs ?? weights(T.roofs, c.roofs), palette: L.roofs ? Object.keys(L.roofs).length : T.palette, styles: weights(T.styles, c.styles),
    fill: L.sheds ? withSheds(c.fill ?? T.fill, L.sheds) : c.fill ?? T.fill, wild: c.wild !== undefined ? (T.wild ?? 1.5) * c.wild : T.wild,
  };
}

/** A fill mix with a share of sheds: the other kinds scaled down to make room. */
function withSheds(fill, share) {
  const total = Object.values(fill ?? {}).reduce((a, b) => a + b, 0) || 1;
  return { ...Object.fromEntries(Object.entries(fill ?? {}).map(([k, v]) => [k, (v / total) * (1 - share)])), sheds: share };
}

/** A profile's street numbers with a character's changes (the same object for homes, or a type without streets). */
export function withCharacterStreets(type, character) {
  const c = CHARACTER[character]?.streets;
  if (!c || !type.streets) return type;
  return {
    ...type,
    streets: { ...type.streets, spacing: scaled(type.streets.spacing, c.spacing ?? 1), width: Math.round(type.streets.width * (c.width ?? 1)) },
    lanes: type.lanes ? { ...type.lanes, spacing: type.lanes.spacing * (c.lanes ?? 1), width: Math.max(6, Math.round(type.lanes.width * (c.width ?? 1))) } : type.lanes,
    back: type.back ? { ...type.back, width: Math.max(6, Math.round(type.back.width * (c.width ?? 1))) } : type.back,
    bend: type.bend * (c.bend ?? 1),
    trim: c.trim ?? type.trim,
  };
}

/** The share of a district's houses with a tended garden: its own, else its character's, else a tenth. */
export function gardenShare(district) {
  if (Number.isFinite(district?.gardens)) return district.gardens;
  return CHARACTER[characterOf(district)].gardens ?? 0.1;
}
