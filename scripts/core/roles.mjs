/**
 * Art roles: what a piece of the map should look like ("roof.slate.winter", "tree.conifer.large.winter"), never
 * a file. Providers turn roles into files; a role nobody can fill gets a plain colour, so a map always paints.
 * Pure: runs anywhere.
 */

/** The names to try for a role, most specific first: roof.slate.winter, then roof.slate. Never fewer than two parts. */
export function roleChain(role) {
  const parts = String(role).split(".");
  const out = [];
  for (let n = parts.length; n >= Math.min(2, parts.length); n--) out.push(parts.slice(0, n).join("."));
  return out;
}

/** Plain colours for roles with no art, by their first part (and second where it matters). */
const COLORS = {
  ground: "#c9cdc4",
  "ground.snow": "#e6eaef",
  "ground.grass": "#8fa36a",
  surface: "#a99b84",
  "surface.slush": "#9c9387",
  "surface.trodden": "#d3d1cc",
  "surface.cobble": "#9a958d",
  overlay: "rgba(255,255,255,0)",
  water: "#4f6f8f",
  "water.ice": "#b9cad8",
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
  tree: "#4b5e43",
  "tree.bare": "#6b5a4a",
  bush: "#5f6b4f",
  chimney: "#6e655c",
  prop: "#7a6450",
};

/** The colour that stands in for a role. */
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
