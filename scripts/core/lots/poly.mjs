/**
 * Polygon operations for blocks and lots, over the bundled Clipper2 (vendor/clipper2.mjs, Boost licence).
 * AtlasScribe's polygons are lists of [x, y] in squares; Clipper's are lists of { x, y }. Pure: runs anywhere.
 */
import * as C from "../../../vendor/clipper2.mjs";

const PREC = 3; // decimal places Clipper keeps: a thousandth of a square

const toC = (poly) => poly.map(([x, y]) => ({ x, y }));
const fromC = (path) => path.map((p) => [p.x, p.y]);
// Slivers with next to no area are dropped: Clipper's offset fails on a polygon that has collapsed to a point
const many = (polys) => polys.filter((p) => p.length >= 3 && area(p) > 1e-6).map(toC);

/** The shapes covered by each path, buffered to its own half width (open paths, round ends). */
export function bands(paths) {
  let out = [];
  for (const { path, half } of paths) {
    if (path.length < 2 || !(half > 0)) continue;
    out = C.unionD(out, C.inflatePathsD([toC(path)], half, C.JoinType.Round, C.EndType.Round, 2, PREC), C.FillRule.NonZero, PREC);
  }
  return out.map(fromC);
}

/** a minus b (both lists of polygons). Returns the pieces, outer rings and holes, as [x, y] polygons. */
export function difference(a, b) {
  return C.differenceD(many(a), many(b), C.FillRule.NonZero, PREC).map(fromC);
}

export function intersect(a, b) {
  return C.intersectD(many(a), many(b), C.FillRule.NonZero, PREC).map(fromC);
}

export function union(a, b = []) {
  return C.unionD(many(a), many(b), C.FillRule.NonZero, PREC).map(fromC);
}

/** Polygons grown (by > 0) or shrunk (by < 0); mitred corners, so blocks keep square corners. */
export function offset(polys, by) {
  return C.inflatePathsD(many(polys), by, C.JoinType.Miter, C.EndType.Polygon, 2.5, PREC).map(fromC);
}

/** Signed area: positive for one winding, negative for the other (a hole comes out opposite its outer ring). */
export function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export const area = (poly) => Math.abs(signedArea(poly));

/**
 * Splits a flat list from Clipper into shapes: { outer, holes }. Clipper gives outer rings and holes in opposite
 * windings; each hole goes with the outer ring that contains it.
 */
export function shapes(polys) {
  if (!polys.length) return [];
  const sign = Math.sign(signedArea(polys.reduce((a, b) => (area(b) > area(a) ? b : a))));
  const outers = polys.filter((p) => Math.sign(signedArea(p)) === sign).map((outer) => ({ outer, holes: [] }));
  // Each hole goes with the smallest outer ring round it (an island inside a hole has its own outer ring, and a hole
  // in that island is the island's, not the bigger ring's)
  for (const h of polys.filter((p) => Math.sign(signedArea(p)) !== sign)) {
    const homes = outers.filter((o) => C.pointInPolygonD({ x: h[0][0], y: h[0][1] }, toC(o.outer), PREC) !== C.PointInPolygonResult.IsOutside);
    const home = homes.reduce((best, o) => (!best || area(o.outer) < area(best.outer) ? o : best), null);
    home?.holes.push(h);
  }
  return outers;
}

export function centroid(poly) {
  let x = 0, y = 0, a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    const f = x1 * y2 - x2 * y1;
    x += (x1 + x2) * f;
    y += (y1 + y2) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-12) return poly[0];
  return [x / (3 * a), y / (3 * a)];
}
