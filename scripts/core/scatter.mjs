/**
 * Even scatter without a grid look: Poisson-disk sampling (Bridson, "Fast Poisson Disk Sampling in Arbitrary
 * Dimensions", 2007), inside a polygon. Points are at least `radius` apart. Every random number comes from the stream
 * given, so the same stream gives the same points. Pure: runs anywhere.
 */
import { pointInPolygon } from "./geom.mjs";

/**
 * poly: [[x, y], ...]. radius: the least distance between points. r: a random stream. keep(x, y): an extra test a
 * point must pass (clear of buildings, say). max: stop after this many points. tries: candidates per active point
 * (Bridson's k). Returns [[x, y], ...].
 */
export function poissonInPolygon(poly, radius, r, { keep = () => true, max = 5000, tries = 20 } = {}) {
  if (!poly || poly.length < 3 || !(radius > 0)) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const cell = radius / Math.SQRT2;
  const cols = Math.max(1, Math.ceil((x1 - x0) / cell)), rows = Math.max(1, Math.ceil((y1 - y0) / cell));
  if (cols * rows > 4e6) return []; // too fine for the area: nothing rather than a hang
  const grid = new Int32Array(cols * rows).fill(-1);
  const pts = [], active = [];
  const ok = (x, y) => {
    if (x < x0 || y < y0 || x > x1 || y > y1 || !pointInPolygon([x, y], poly) || !keep(x, y)) return false;
    const gx = Math.floor((x - x0) / cell), gy = Math.floor((y - y0) / cell);
    for (let j = Math.max(0, gy - 2); j <= Math.min(rows - 1, gy + 2); j++)
      for (let i = Math.max(0, gx - 2); i <= Math.min(cols - 1, gx + 2); i++) {
        const k = grid[j * cols + i];
        if (k >= 0 && Math.hypot(pts[k][0] - x, pts[k][1] - y) < radius) return false;
      }
    return true;
  };
  const add = (x, y) => {
    pts.push([x, y]);
    active.push(pts.length - 1);
    grid[Math.floor((y - y0) / cell) * cols + Math.floor((x - x0) / cell)] = pts.length - 1;
  };
  // A few starting points, so a polygon in pieces (or with a narrow neck) still fills
  for (let s = 0; s < 30 && pts.length < max; s++) {
    const x = x0 + r.next() * (x1 - x0), y = y0 + r.next() * (y1 - y0);
    if (ok(x, y)) add(x, y);
  }
  while (active.length && pts.length < max) {
    const ai = Math.floor(r.next() * active.length);
    const [px, py] = pts[active[ai]];
    let found = false;
    for (let t = 0; t < tries; t++) {
      const a = r.next() * 2 * Math.PI, d = radius * (1 + r.next());
      const x = px + Math.cos(a) * d, y = py + Math.sin(a) * d;
      if (ok(x, y)) { add(x, y); found = true; break; }
    }
    if (!found) active.splice(ai, 1);
  }
  return pts;
}
