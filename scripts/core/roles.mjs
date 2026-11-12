/**
 * Art roles: what a piece of the map should look like ("roof.slate.winter", "tree.conifer.large.winter"), never
 * a file. Providers turn roles into files; a role nobody can fill gets a plain color, so a map always paints.
 * Pure: runs anywhere.
 */

/** The names to try for a role, most specific first: roof.slate.winter, then roof.slate. Never fewer than two parts. */
export function roleChain(role) {
  const parts = String(role).split(".");
  const out = [];
  for (let n = parts.length; n >= Math.min(2, parts.length); n--) out.push(parts.slice(0, n).join("."));
  return out;
}

/** Plain colors for roles with no art, by their first part (and second where it matters). */
const COLORS = {
  ground: "#c9cdc4",
  "ground.snow": "#e6eaef",
  "ground.grass": "#8fa36a",
  surface: "#a99b84",
  "surface.slush": "#9c9387",
  "surface.trodden": "#d3d1cc",
  "surface.cobble": "#9a958d",
  "surface.flagstone": "#a7a197",
  "surface.setts": "#8f8a83",
  "surface.herringbone": "#a2694e",
  "surface.brick": "#9a5a44",
  "surface.tiles": "#b3ada2",
  "surface.grass": "#8fa36a",
  "surface.grass.winter": "#dde2e2",
  overlay: "rgba(255,255,255,0)",
  cliff: "#7d7466",
  "cliff.face.slate": "#6f7276",
  "cliff.top": "rgba(0,0,0,0)",
  "cliff.foot": "rgba(0,0,0,0)",
  water: "#4f6f8f",
  "water.ice": "#b9cad8",
  "water.lake": "#4a6a88",
  "water.sea": "#3f617f",
  shore: "#b4a684",
  "shore.sand": "#cdb98c",
  "shore.pebbles": "#9d968a",
  "shore.rocks": "#8a857e",
  "shore.grass": "#7f9a5a",
  "shore.marsh": "#6f7a4a",
  "shore.reeds": "#76804e",
  "shore.sand.winter": "#e3e7ec",
  "shore.pebbles.winter": "#d4d8dc",
  "shore.rocks.winter": "#c9cdd2",
  "shore.grass.winter": "#dde2e2",
  "shore.marsh.winter": "#d6dcd8",
  "shore.reeds.winter": "#d6dcd8",
  dock: "#9a958d",
  "dock.wood": "#7a5e44",
  "prop.stall": "#b08a5a",
  "prop.stall-long": "#b08a5a",
  "prop.sails": "#d9d2c0",
  "prop.boat": "#7a5e44",
  "prop.ship": "#6b4f36",
  "prop.sail": "#e6dfcc",
  "prop.cross": "#a39d92",
  "prop.waterwheel": "#6b4f36",
  "prop.reeds": "#6d6440",
  "prop.lily": "#4f7a3a",
  stone: "#8a857e",
  roof: "#7b6a5c",
  "roof.slate": "#5d636b",
  "roof.wood-shingle": "#7a5e44",
  "roof.tile-red": "#9b4a36",
  "roof.tile-brown": "#7c5a3f",
  "roof.thatch": "#a88a52",
  "roof.slate-black": "#3f4247",
  "roof.slate-blue": "#4c6177",
  "roof.slate-purple": "#5a5268",
  "roof.slate-mossy": "#66704a",
  "roof.tile-orange": "#b4632c",
  "roof.tile-tan": "#a8916a",
  "roof.tile-gray": "#8c8f94",
  "roof.tile-black": "#3d3b3a",
  "roof.tile-blue": "#4d6a8a",
  "roof.tile-green": "#5b7357",
  "roof.tile-purple": "#6d5878",
  "roof.tile-mossy": "#6f7448",
  "roof.wood-shingle-dark": "#5e4632",
  "roof.wood-shingle-light": "#9c7a52",
  "roof.wood-shingle-red": "#7d3f2c",
  "roof.wood-shingle-ashen": "#7a7468",
  "roof.wood-shingle-walnut": "#6a4a33",
  "roof.flat": "#a39e95",
  "roof.flat.winter": "#dfe3e8",
  "roof.flat.wood": "#6e5038",
  wall: "#aaa49a",
  wood: "#5e4430",
  tree: "#4b5e43",
  "tree.bare": "#6b5a4a",
  "tree.deciduous": "#55703c",
  "tree.deciduous.autumn": "#9a7a32",
  "bush.leafy": "#5a7444",
  bush: "#5f6b4f",
  chimney: "#6e655c",
  prop: "#7a6450",
  field: "#8d9a5c",
  "field.plowed": "#7a5f42",
  "field.growing": "#6f8a3e",
  "field.ripe": "#c4a24e",
  "field.stubble": "#b39c6a",
  "field.hay": "#b8ab72",
  "field.pasture": "#86a457",
  "field.fallow": "#8d9a5c",
  "field.plowed.winter": "#d9dde2",
  "field.stubble.winter": "#d8d6cf",
  "field.pasture.winter": "#e4e8ed",
  "field.fallow.winter": "#dde2e2",
  // (a battle map's floors, walls, fences and banks)
  floor: "#9c7a56",
  "floor.stone": "#8f8a82",
  "floor.wood": "#9c7a56",
  window: "#8fa9b8",
  fence: "#6f5a44",
  "fence.stone": "#8a857e",
  edge: "#7d7466",
  "edge.bank": "#7a6a50",
  furn: "#7a5e44",
};

/** The color that stands in for a role. */
export function fallbackColor(role) {
  for (const r of roleChain(role)) if (COLORS[r]) return COLORS[r];
  const first = String(role).split(".")[0];
  return COLORS[first] ?? "#999999";
}

/** A season word for role names; unknown seasons count as summer. */
export function seasonOf(plan) {
  const s = String(plan?.season ?? "summer").toLowerCase();
  return ["winter", "spring", "summer", "autumn"].includes(s) ? s : "summer";
}
