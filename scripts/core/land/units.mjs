/**
 * Miles, grids and frames for overland maps. Plan coordinates are isotropic map units in both axes: one unit is one
 * grid cell's center-to-center distance (size.ftPerSquare), never a hex index. On a hex map size.squares is
 * [columns, rows] of flat-topped hexes in columns: columns sqrt(3)/2 units apart, rows 1 unit apart, every other
 * column half a row down. The land is generated over a context frame larger than the map (a margin on each side),
 * in miles, and the map is cropped from it. Pure.
 */

export const MILE_FT = 5280;
const HEX_COL = Math.sqrt(3) / 2;
/** A flat-topped hex's width corner to corner, in units (its flat-to-flat width is 1). */
const HEX_CORNERS = 2 / Math.sqrt(3);

/** Scale presets: the map's size in miles, the cell, the margin each side (a share of the map), the grid. */
export const SCALES = {
  kingdom: { miles: [240, 160], cell: 6, margin: 1 / 3 },
  realm: { miles: [720, 480], cell: 12, margin: 1 / 3 },
  continent: { miles: [2400, 1600], cell: 40, margin: 1 / 6 },
  world: { miles: [7200, 4800], cell: 120, margin: 0 },
};

/** The middle latitude each climate puts the map at (degrees north), and a moisture bias. */
export const CLIMATES = {
  temperate: { lat: 45, wet: 0 },
  cold: { lat: 58, wet: -0.05 },
  warm: { lat: 33, wet: 0 },
  arid: { lat: 26, wet: -0.35 },
  tropical: { lat: 12, wet: 0.15 },
};

/** The columns and rows a grid of `cell`-mile cells needs to cover a map of [w, h] miles. */
export function gridFor([w, h], cell, grid = "hex") {
  if (grid !== "hex") return [Math.max(1, Math.round(w / cell)), Math.max(1, Math.round(h / cell))];
  return [Math.max(1, Math.round((w / cell - HEX_CORNERS) / HEX_COL + 1)), Math.max(1, Math.round(h / cell - 0.5))];
}

/** The map's extent in units: a square grid's size.squares; a hex grid's from hex geometry. */
export function extentOf(plan) {
  const [c, r] = plan?.size?.squares ?? [50, 50];
  if ((plan?.output?.grid ?? "square") !== "hex") return [c, r];
  return [(c - 1) * HEX_COL + HEX_CORNERS, r + 0.5];
}

/** Miles in one unit. */
export const milesPerUnit = (plan) => (Number(plan?.size?.ftPerSquare) || MILE_FT) / MILE_FT;

/** Which scale a map of this size reads as (for defaults that depend on scale): by its longer side in miles. */
export function scaleClass(longMiles) {
  return longMiles <= 400 ? "kingdom" : longMiles <= 1200 ? "realm" : longMiles <= 4000 ? "continent" : "world";
}

/**
 * The frame the land is generated over. Returns { mapW, mapH (miles), margin (miles each side), W, H (the frame,
 * miles), scale (its class), mpu (miles a unit), toFrame([x, y] units) -> miles in the frame, toMap([x, y] frame
 * miles) -> units, inMap(x, y) frame miles }.
 */
export function frameOf(plan) {
  const mpu = milesPerUnit(plan);
  const [eu, ev] = extentOf(plan);
  const mapW = eu * mpu, mapH = ev * mpu;
  const scale = scaleClass(Math.max(mapW, mapH));
  const share = Number.isFinite(plan?.land?.margin) ? plan.land.margin : SCALES[scale].margin;
  const margin = share * Math.max(mapW, mapH);
  return {
    mapW, mapH, margin, W: mapW + 2 * margin, H: mapH + 2 * margin, scale, mpu,
    toFrame: ([x, y]) => [x * mpu + margin, y * mpu + margin],
    toMap: ([x, y]) => [(x - margin) / mpu, (y - margin) / mpu],
    inMap: (x, y) => x >= margin && y >= margin && x <= margin + mapW && y <= margin + mapH,
  };
}

/**
 * Latitude in degrees at a height in the frame (miles from its top): the map's span is its height in miles over 69,
 * centered on the climate's latitude; land.latitude [top, bottom] overrides. Returns lat(yMiles).
 */
export function latitudeOf(plan, frame) {
  const land = plan?.land ?? {};
  if (Array.isArray(land.latitude) && land.latitude.length === 2 && land.latitude.every(Number.isFinite)) {
    const [top, bottom] = land.latitude;
    return (y) => top + ((bottom - top) * (y - frame.margin)) / frame.mapH;
  }
  const scale = frame.scale;
  const mid = scale === "world" ? 35 : (CLIMATES[land.climate] ?? CLIMATES.temperate).lat;
  return (y) => mid - (y - frame.margin - frame.mapH / 2) / 69;
}
