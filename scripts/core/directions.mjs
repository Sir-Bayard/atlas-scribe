/**
 * Directions for Quick Start: which way a place's roads leave it, which way its river runs, and on which side its sea
 * or lake lies, as a region map shows them (Make This Town). Given as compass bearings (0 is north, the map's top; 90
 * east), read here into the screen angles the generators lay things out by (degrees, 0 along +x, 90 down the map). A
 * plan made without directions is made exactly as before. Pure.
 */

/** A compass bearing as a screen angle in degrees (north, the map's top, is -90). */
export const screenOf = (bearing) => bearing - 90;

/** How far apart two angles in degrees are, 0 to 180. */
export const apartDeg = (a, b) => { const d = Math.abs((((a - b) % 360) + 540) % 360 - 180); return d; };

const bearingOf = (v) => (typeof v === "number" && Number.isFinite(v) ? ((v % 360) + 360) % 360 : null);

/**
 * Directions as Quick Start takes them: { roads: [bearing] (each road leaving the place), river: { in, out }
 * (bearings to where it comes from and where it goes), coast (the bearing to the sea), lake (to a lake shore) }, any
 * left out. Returns { roads: [screen degrees], flow (screen degrees the river runs, or null), coast, lake } with
 * screen angles, or null when none is given.
 */
export function readDirections(d) {
  if (!d || typeof d !== "object") return null;
  const roads = (Array.isArray(d.roads) ? d.roads : []).map(bearingOf).filter((b) => b !== null);
  // (the way a river runs: from where it comes in toward where it goes out; with one end known, from or to it)
  const rin = bearingOf(d.river?.in), rout = bearingOf(d.river?.out);
  let flow = null;
  if (rin !== null && rout !== null) {
    const a = (screenOf(rin) * Math.PI) / 180, b = (screenOf(rout) * Math.PI) / 180;
    const x = Math.cos(b) - Math.cos(a), y = Math.sin(b) - Math.sin(a);
    flow = Math.hypot(x, y) > 1e-6 ? (Math.atan2(y, x) * 180) / Math.PI : screenOf(rout);
  } else if (rout !== null) flow = screenOf(rout);
  else if (rin !== null) flow = screenOf(rin) + 180;
  const coast = bearingOf(d.coast), lake = bearingOf(d.lake);
  const out = { roads: roads.map(screenOf), flow, coast: coast === null ? null : screenOf(coast), lake: lake === null ? null : screenOf(lake) };
  return out.roads.length || out.flow !== null || out.coast !== null || out.lake !== null ? out : null;
}

/** How far apart two roads may lie and still be the two ends of one road through a place, in degrees. */
export const THROUGH_APART = 100;

/**
 * The roads as a main road through the place and the rest: the two most nearly opposite as the main road ([a, b]);
 * when even they lie on the same side (under THROUGH_APART apart), only the first is the main road's (its other end
 * the seed's) and the rest branch off. roads: screen degrees. Returns { main, rest }.
 */
export function mainRoad(roads) {
  if (!roads?.length) return { main: [], rest: [] };
  if (roads.length === 1) return { main: [roads[0]], rest: [] };
  let best = [0, 1], most = -1;
  for (let i = 0; i < roads.length; i++) for (let j = i + 1; j < roads.length; j++) { const d = apartDeg(roads[i], roads[j]); if (d > most + 1e-9) { most = d; best = [i, j]; } }
  if (most < THROUGH_APART) return { main: [roads[best[0]]], rest: roads.filter((_, k) => k !== best[0]) };
  return { main: best.map((k) => roads[k]), rest: roads.filter((_, k) => !best.includes(k)) };
}
