/**
 * A battle map's yards and walls, laid over what the districts built. At 5 ft a square the plot lines a town map
 * draws (every lot's edge a fence) read as fences running at odd angles beside houses and into the street, and a
 * walled yard's wall follows its plot's odd outline. So on a battle map (Patrick, 3 Nov):
 *  - each house gets a fenced yard behind it, square to it, as a map maker would draw one, with a gate in its back
 *    fence; its depth is cut short, or it's left out, to keep clear of streets, other buildings, water and other yards;
 *  - a walled yard (a churchyard, a manor's grounds) is walled around its outline made convex, with a gate on the side
 *    nearest a street.
 * Everything in squares. Pure: runs anywhere.
 */
import { shapeToPolygon, pointInPolygon, distanceToPath } from "../geom.mjs";

/**
 * How deep a yard is tried, in squares, deepest first; how far it keeps from a street's edge and from other buildings;
 * its gate's half width; its least width.
 */
export const YARD = { depths: [5, 4, 3, 2.5], offStreet: 0.7, offBuilding: 0.4, gate: 0.6, minWidth: 3 };
/** A walled yard's gate: half its width, in squares, and the shortest side that takes one. */
/**
 * A walled yard's wall: its gate's half width and the shortest side that takes one, in squares; how far it keeps off a
 * street's center beyond half the street's width (its own half thickness and the curb), and how near its ends that's
 * waived (where the wall meets the street).
 */
const WALL_GATE = { half: 0.7, minSide: 2, offCurb: 0.5, endReach: 0.6 };

/** A building item's footprint: its turned rectangle, a round one's circle, a row house's own outline. */
export function footprint(b) {
  if (Array.isArray(b.poly) && b.poly.length >= 3) return b.poly;
  if (b.round) return shapeToPolygon({ circle: [b.cx, b.cy, Math.min(b.len, b.dep) / 2] }, 0, 24);
  return shapeToPolygon({ rect: [b.cx - b.len / 2, b.cy - b.dep / 2, b.cx + b.len / 2, b.cy + b.dep / 2] }, b.rot ?? 0);
}

/** The convex hull of some points (Andrew's monotone chain), counterclockwise in screen terms; null under three points. */
export function hull(pts) {
  const P = [...pts].filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return null;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cross(lo.at(-2), lo.at(-1), p) <= 0) lo.pop(); lo.push(p); }
  for (const p of [...P].reverse()) { while (up.length >= 2 && cross(up.at(-2), up.at(-1), p) <= 0) up.pop(); up.push(p); }
  const h = [...lo.slice(0, -1), ...up.slice(0, -1)];
  return h.length >= 3 ? h : null;
}

/** Points every step squares along a path, its corners included. */
function samples(path, step) {
  const out = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let t = 1; t <= n; t++) out.push([a[0] + ((b[0] - a[0]) * t) / n, a[1] + ((b[1] - a[1]) * t) / n]);
  }
  return out;
}

/** A path with corners closer than tol to the line between their neighbors dropped (Douglas-Peucker). */
export function simplify(path, tol) {
  if (path.length <= 2) return path;
  const a = path[0], b = path.at(-1);
  let far = -1, d = -1;
  for (let i = 1; i < path.length - 1; i++) { const e = distanceToPath(path[i], [a, b]); if (e > d) { d = e; far = i; } }
  if (d <= tol) return [a, b];
  return [...simplify(path.slice(0, far + 1), tol).slice(0, -1), ...simplify(path.slice(far), tol)];
}

/**
 * A closed outline as wall runs with a gate: in the middle of the side nearest a street, else (no street, or no side
 * near one long enough) the longest side.
 */
function gated(ring0, ways) {
  const ring = [...ring0, ring0[0]];
  const len = (i) => Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]);
  let gate = -1, best = Infinity;
  for (let i = 1; i < ring.length; i++) {
    if (len(i) < WALL_GATE.minSide) continue;
    const m = [(ring[i - 1][0] + ring[i][0]) / 2, (ring[i - 1][1] + ring[i][1]) / 2];
    const d = Math.min(Infinity, ...ways.map((w) => distanceToPath(m, w.path) - (w.width ?? 0) / 2));
    if (d < best) { best = d; gate = i; }
  }
  if (gate < 0) for (let i = 1; i < ring.length; i++) if (gate < 0 || len(i) > len(gate)) gate = i;
  const out = [];
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i], l = len(i);
    const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    // (a side too short for the whole gate is left open)
    if (i === gate) { if (l > 2 * WALL_GATE.half + 0.2) out.push([a, at(0.5 - WALL_GATE.half / l)], [at(0.5 + WALL_GATE.half / l), b]); }
    else out.push([a, b]);
  }
  return out;
}

/**
 * Lays a battle map's yards and walls into items (changed in place). Expects the walls of walled yards marked `lot`
 * (the site they wall in, the same for all of one site's) and the main house of each plot marked `main`. W, H: the map's size in squares.
 */
export function battleYards(items, W, H) {
  const ways = items.filter((i) => i.kind === "way" && !i.faint && Array.isArray(i.path) && i.path.length >= 2);
  const water = items.filter((i) => i.kind === "water");
  const nearWay = (p, extra) => ways.some((w) => distanceToPath(p, w.path) < (w.width ?? 1) / 2 + extra);
  const inWater = (p) => water.some((w) => (Array.isArray(w.poly) ? pointInPolygon(p, w.poly) : Array.isArray(w.path) && distanceToPath(p, w.path) < (w.width ?? 1) / 2 + 0.5));

  // Walled yards: each site's walls (lot: the site they wall in) walled again around their outline made convex, with a
  // gate on the side nearest a street. Where that outline would run onto a street or through a building (a plot that
  // bends around a corner, a wall cut where another district's street passes), the site's own walls are kept with their
  // small jogs straightened, and where even those would, only their clear stretches
  // (a wall keeps its stone off a street's curb, except where its end meets the street; it stays out of buildings and
  // water)
  const buildings0 = items.filter((i) => i.kind === "building").map((b) => footprint(b));
  const clearAt = (p, atEnd) => !ways.some((w) => distanceToPath(p, w.path) < (w.width ?? 1) / 2 + (atEnd ? -0.1 : WALL_GATE.offCurb)) &&
    !inWater(p) &&
    !buildings0.some((f) => pointInPolygon(p, f) && distanceToPath(p, [...f, f[0]]) > 0.05);
  const clearPaths = (paths) => paths.every((path) => {
    const ends = [path[0], path.at(-1)];
    return samples(path, 0.2).every((p) => clearAt(p, ends.some((e) => Math.hypot(p[0] - e[0], p[1] - e[1]) < WALL_GATE.endReach)));
  });
  /** The pieces of a path that are clear (every point kept off curbs, buildings and water), each half a square or more. */
  const clearPieces = (path) => {
    const out = [];
    let run = [];
    for (const p of samples(path, 0.2)) {
      if (clearAt(p, false)) { run.push(p); continue; }
      if (run.length >= 2) out.push(run);
      run = [];
    }
    if (run.length >= 2) out.push(run);
    return out.map((r) => simplify(r, 0.02)).filter((r) => r.reduce((t, q, i) => (i ? t + Math.hypot(q[0] - r[i - 1][0], q[1] - r[i - 1][1]) : 0), 0) >= 0.5);
  };
  const bySite = new Map();
  for (const w of items.filter((i) => i.kind === "wall" && i.lot && Array.isArray(i.path))) {
    const k = `${w.from}|${w.lot}`;
    if (!bySite.has(k)) bySite.set(k, []);
    bySite.get(k).push(w);
  }
  const walls = [], walledIn = [];
  for (const g of bySite.values()) {
    const base = g[0];
    const made = (paths) => paths.map((path, k) => ({ kind: "wall", id: `${base.id}-y${k + 1}`, from: base.from, class: base.class, path, height: base.height }));
    const h = hull(g.flatMap((w) => w.path));
    const around = h ? gated(h, ways) : null;
    if (around && clearPaths(around)) { walls.push(...made(around)); walledIn.push(h); continue; }
    const straightened = g.map((w) => simplify(w.path, 0.6));
    // (else only the stretches of them that are clear)
    walls.push(...made(clearPaths(straightened) ? straightened : straightened.flatMap(clearPieces)));
  }
  for (let k = items.length - 1; k >= 0; k--) if (items[k].kind === "wall" && items[k].lot) items.splice(k, 1);
  items.push(...walls);

  // Fenced yards behind the houses
  const buildings = items.filter((i) => i.kind === "building");
  const feet = buildings.map((b) => ({ b, poly: footprint(b) }));
  // (paved and walled ground, crofts, a manor's lawns: everything with an outline but a dense quarter's built-up ground)
  const keepOut = [
    ...items.filter((i) => i.kind === "surface" && Array.isArray(i.poly) && i.class !== "backyard" && i.class !== "quarter").map((i) => i.poly),
    ...items.filter((i) => i.kind === "surface" && i.garden).map(({ garden: g }) => shapeToPolygon({ rect: [g.cx - g.w / 2, g.cy - g.d / 2, g.cx + g.w / 2, g.cy + g.d / 2] }, g.rot ?? 0)),
    ...walledIn, // (the ground a convex wall takes in)
  ];
  const allWalls = items.filter((i) => (i.kind === "wall" || i.kind === "boundary") && Array.isArray(i.path));
  const yards = [];
  for (const b of buildings.filter((x) => x.main && !x.round)) {
    const a = ((b.rot ?? 0) * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
    // Its back: the long side farther from the nearest street
    const sideD = (sg) => Math.min(Infinity, ...ways.map((w) => distanceToPath([b.cx + (nx * sg * b.dep) / 2, b.cy + (ny * sg * b.dep) / 2], w.path) - (w.width ?? 0) / 2));
    const sg = sideD(1) > sideD(-1) ? 1 : -1;
    const hw = b.len / 2 - 0.2;
    if (hw < 1) continue;
    const p0 = [b.cx + (nx * sg * b.dep) / 2, b.cy + (ny * sg * b.dep) / 2];
    const corner = (u, v) => [p0[0] + ux * u + nx * sg * v, p0[1] + uy * u + ny * sg * v];
    // (across its whole back, else across one end of it: a wing behind the other end takes the rest)
    const spans = [[-hw, hw], [-hw, -hw + 1.1 * hw], [hw - 1.1 * hw, hw]].filter(([u0, u1]) => u1 - u0 >= YARD.minWidth);
    const own = (f) => (f.b.group ?? f.b.id) === (b.group ?? b.id);
    find: for (const depth of YARD.depths) for (const [u0, u1] of spans) {
      const rect = [corner(u0, 0), corner(u1, 0), corner(u1, depth), corner(u0, depth)];
      // (sampled every half square or closer, a row just off the house's back wall too)
      const pts = [], ni = Math.max(6, Math.ceil((u1 - u0) / 0.5)), nj = Math.max(4, Math.ceil(depth / 0.5));
      for (let i = 0; i <= ni; i++) for (const v of [0.05, ...Array.from({ length: nj }, (_, j) => (depth * (j + 1)) / nj)]) pts.push(corner(u0 + ((u1 - u0) * i) / ni, v));
      const clear = pts.every((q) =>
        q[0] > 0 && q[1] > 0 && q[0] < W && q[1] < H &&
        !nearWay(q, YARD.offStreet) && !inWater(q) &&
        // (clear of every other building, and a little way off any but the house's own wings, which it may meet)
        !feet.some((f) => f.b !== b && (pointInPolygon(q, f.poly) || (!own(f) && distanceToPath(q, [...f.poly, f.poly[0]]) < YARD.offBuilding))) &&
        !keepOut.some((p) => pointInPolygon(q, p)) &&
        !yards.some((y) => pointInPolygon(q, y.poly)) &&
        !allWalls.some((w) => distanceToPath(q, w.path) < 0.6));
      if (!clear) continue;
      yards.push({ b, poly: rect });
      break find;
    }
  }
  for (const { b, poly } of yards) {
    const [p0, p1, p2, p3] = poly;
    const back = [p3[0] - p2[0], p3[1] - p2[1]], bl = Math.hypot(back[0], back[1]);
    const mid = [(p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2], g = YARD.gate;
    const fences = [[p1, p2], [p3, p0], [p2, [mid[0] - (back[0] / bl) * g, mid[1] - (back[1] / bl) * g]], [[mid[0] + (back[0] / bl) * g, mid[1] + (back[1] / bl) * g], p3]];
    items.push({ kind: "surface", id: `${b.id}/yard`, from: b.from, class: "backyard", poly });
    fences.forEach((path, k) => items.push({ kind: "boundary", id: `${b.id}/yard-f${k + 1}`, from: b.from, class: "fence", path }));
  }
  return { yards: yards.length, walls: walls.length };
}
