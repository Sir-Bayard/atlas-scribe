/**
 * A battle map's yards and walls, laid over what the districts built (a town map's plot lines would read as fences at
 * odd angles at this scale): each house gets a fenced yard behind it, square to it, with a gate in its back fence,
 * shortened or left out to keep clear of streets, buildings, water and other yards; a walled yard is walled around
 * its outline made convex, with a gate on the side nearest a street. Squares; pure.
 */
import { shapeToPolygon, pointInPolygon, distanceToPath, polygonsOverlap } from "../geom.mjs";
import { union, offset, signedArea, shapes } from "../lots/poly.mjs";

/**
 * How deep a yard is tried, in squares, deepest first; how far it keeps from a street's edge and from other buildings;
 * its gate's half width; its least width.
 */
export const YARD = { depths: [5, 4, 3, 2.5], offStreet: 0.7, offBuilding: 0.4, gate: 0.6, minWidth: 3 };
/** A plan's own building gets a yard too, unless it's one of these (a temple, a keep, a stable or shed of a yard's own). */
const NO_YARD = new Set(["temple", "chapel", "shrine", "keep", "palace", "barracks", "watch", "tower", "tomb", "stable", "shed", "store", "warehouse", "market-hall", "guildhall", "customs", "windmill", "watermill", "armory"]);
/**
 * A path to a front door standing off the road: how far off the nearest way's edge a door gets one, its width, how
 * far it runs straight out from the door, and its longest run, in squares.
 */
export const APPROACH = { from: 1.2, width: 1, out: 1, longest: 30 };
/**
 * A walled yard's wall: its gate's half width and the shortest side that takes one, in squares; how far it keeps off a
 * street's center beyond half the street's width (its own half thickness and the curb), and how near its ends that's
 * waived (where the wall meets the street).
 */
const WALL_GATE = { half: 0.7, minSide: 2, offCurb: 0.5, endReach: 0.6 };

/** The nearest point of a path to p: { q, d }. */
function nearestOnPath(p, path) {
  let best = { q: path[0], d: Infinity };
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i], vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - ax) * vx + (p[1] - ay) * vy) / L2)) : 0;
    const q = [ax + vx * t, ay + vy * t], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < best.d) best = { q, d };
  }
  return best;
}

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
  battleGroups(items);
  const ways = items.filter((i) => i.kind === "way" && !i.faint && Array.isArray(i.path) && i.path.length >= 2);
  const water = items.filter((i) => i.kind === "water");
  const nearWay = (p, extra) => ways.some((w) => distanceToPath(p, w.path) < (w.width ?? 1) / 2 + extra);
  const inWater = (p) => water.some((w) => (Array.isArray(w.poly) ? pointInPolygon(p, w.poly) : Array.isArray(w.path) && distanceToPath(p, w.path) < (w.width ?? 1) / 2 + 0.5));

  // Walled yards: each site's walls walled again around their convex outline, with a gate nearest a street; where
  // that would cross a street or a building, the site's own walls straightened, or only their clear stretches (off a
  // street's curb but where an end meets the street, out of buildings and water)
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
  // (each outline's box, so a yard's points are tested only against what's near it: a big town's battle map has
  // thousands of buildings)
  const boxOf = (pts) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return [x0, y0, x1, y1]; };
  const hits = (a, b, m) => a[0] <= b[2] + m && a[2] >= b[0] - m && a[1] <= b[3] + m && a[3] >= b[1] - m;
  for (const f of feet) f.bb = boxOf(f.poly);
  const keepBoxed = keepOut.map((p) => ({ p, bb: boxOf(p) })), wallsBoxed = allWalls.map((w) => ({ w, bb: boxOf(w.path) }));
  const yards = [];
  // (a house's or a plan building's, not a warehouse's, a stable's or another that has none)
  for (const b of buildings.filter((x) => (x.main || x.id === x.from) && !NO_YARD.has(x.use ?? "house") && !x.round)) {
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
      const rect = [corner(u0, 0), corner(u1, 0), corner(u1, depth), corner(u0, depth)], rb = boxOf(rect);
      const nFeet = feet.filter((f) => hits(f.bb, rb, YARD.offBuilding + 0.1)), nKeep = keepBoxed.filter((k) => hits(k.bb, rb, 0.1)).map((k) => k.p);
      const nYards = yards.filter((y) => hits(boxOf(y.poly), rb, 0.1)), nWalls = wallsBoxed.filter((x) => hits(x.bb, rb, 0.7)).map((x) => x.w);
      // (sampled every half square or closer, a row just off the house's back wall too)
      const pts = [], ni = Math.max(6, Math.ceil((u1 - u0) / 0.5)), nj = Math.max(4, Math.ceil(depth / 0.5));
      for (let i = 0; i <= ni; i++) for (const v of [0.05, ...Array.from({ length: nj }, (_, j) => (depth * (j + 1)) / nj)]) pts.push(corner(u0 + ((u1 - u0) * i) / ni, v));
      const clear = pts.every((q) =>
        q[0] > 0 && q[1] > 0 && q[0] < W && q[1] < H &&
        !nearWay(q, YARD.offStreet) && !inWater(q) &&
        // (clear of every other building, and a little way off any but the house's own wings, which it may meet)
        !nFeet.some((f) => f.b !== b && (pointInPolygon(q, f.poly) || (!own(f) && distanceToPath(q, [...f.poly, f.poly[0]]) < YARD.offBuilding))) &&
        !nKeep.some((p) => pointInPolygon(q, p)) &&
        !nYards.some((y) => pointInPolygon(q, y.poly)) &&
        !nWalls.some((w) => distanceToPath(q, w.path) < 0.6));
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
  const shells = buildingShells(items, W, H);
  const approaches = approachPaths(items, W, H);
  return { yards: yards.length, walls: walls.length, shells, approaches };
}

/**
 * Worn paths to the front doors that stand off every way (and off every square): from a square out from the door,
 * straight to the nearest point of the nearest way, when that runs clear of other buildings, walls, fences and water
 * (else none). Items `way` class path, surface trodden, `approach: true` (lamp posts and lanterns don't count them as
 * streets). Returns how many.
 */
export function approachPaths(items, W = Infinity, H = Infinity) {
  const ways = items.filter((i) => i.kind === "way" && !i.faint && !i.approach && Array.isArray(i.path) && i.path.length >= 2);
  if (!ways.length) return 0;
  const squares = items.filter((i) => i.kind === "surface" && (i.class === "square" || i.class === "plaza") && Array.isArray(i.poly));
  const feet = items.filter((i) => i.kind === "building").map((b) => ({ b, f: footprint(b) }));
  const fences = items.filter((i) => (i.kind === "wall" || i.kind === "boundary") && Array.isArray(i.path) && i.class !== "cliff");
  const water = items.filter((i) => i.kind === "water");
  const inWater = (p) => water.some((w) => (Array.isArray(w.poly) ? pointInPolygon(p, w.poly) : Array.isArray(w.path) && distanceToPath(p, w.path) < (w.width ?? 1) / 2 + 0.3));
  const edgeD = (p) => Math.min(...ways.map((w) => distanceToPath(p, w.path) - (w.width ?? 0) / 2));
  let n = 0;
  for (const sh of items.filter((i) => i.kind === "shell" && !i.closed)) {
    const door = sh.walls.find((w) => w.type === "door" && w.side === "front");
    if (!door) continue;
    const m = [(door.a[0] + door.b[0]) / 2, (door.a[1] + door.b[1]) / 2], o = [-door.inward[0], -door.inward[1]];
    const p0 = [m[0] + o[0] * ((sh.thickness ?? 0.3) / 2 + 0.05), m[1] + o[1] * ((sh.thickness ?? 0.3) / 2 + 0.05)];
    if (edgeD(p0) <= APPROACH.from || squares.some((q) => pointInPolygon(p0, q.poly) || distanceToPath(p0, [...q.poly, q.poly[0]]) <= APPROACH.from)) continue;
    const p1 = [p0[0] + o[0] * APPROACH.out, p0[1] + o[1] * APPROACH.out];
    // (the nearest point of the nearest way's middle line, from a square out)
    let best = null;
    for (const w of ways) for (let i = 1; i < w.path.length; i++) {
      const a = w.path[i - 1], b = w.path[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p1[0] - a[0]) * dx + (p1[1] - a[1]) * dy) / L2)), q = [a[0] + dx * t, a[1] + dy * t];
      const d = Math.hypot(q[0] - p1[0], q[1] - p1[1]);
      if (!best || d < best.d) best = { d, q, w };
    }
    if (!best || best.d > APPROACH.longest) continue;
    // (it stops at the way's edge)
    const L = best.d || 1, half = (best.w.width ?? 1) / 2;
    const end = [best.q[0] + ((p1[0] - best.q[0]) / L) * Math.max(0, half - 0.3), best.q[1] + ((p1[1] - best.q[1]) / L) * Math.max(0, half - 0.3)];
    const path = [p0, p1, end];
    const pts = [];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.25));
      for (let j = 0; j <= k; j++) pts.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
    }
    const own = (x) => (x.b.group ?? x.b.id) === sh.group;
    const clear = pts.slice(1).every((p) => p[0] > 0 && p[1] > 0 && p[0] < W && p[1] < H && !inWater(p) &&
      !feet.some((x) => !own(x) ? pointInPolygon(p, x.f) || distanceToPath(p, [...x.f, x.f[0]]) < 0.3 : pointInPolygon(p, x.f)) &&
      !fences.some((w) => distanceToPath(p, w.path) < 0.25));
    if (!clear) continue;
    items.push({ kind: "way", id: `${sh.group}/approach`, from: sh.from, class: "path", surface: "trodden", width: APPROACH.width, path, approach: true });
    n++;
  }
  return n;
}

/**
 * What fills a block's middle on a battle map behind its street fronts, so a zoomed town reads as full as its
 * overview: the quarter's own back numbers (LOOK.back) with sheds and clutter added, else back houses. Feet; gap
 * between buildings; shed: its size and its share of the houses' tries. Laid by fillBack near the plots only.
 */
export const BATTLE_BACK = {
  len: [24, 34], dep: [18, 24], gap: 5, use: "house", gardens: true,
  shed: { share: 0.3, len: [12, 18], dep: [10, 14], use: "shed" },
  clutter: ["barrel", "crate", "firewood", "cart"],
};
export const battleBack = (B) => (B ? { shed: BATTLE_BACK.shed, clutter: BATTLE_BACK.clutter, ...B } : BATTLE_BACK);

/**
 * How high a roof sits, in feet: 10 for an ordinary building, 20 for a tower or tall building. Foundry reveals a
 * raised surface to a token outside, more of it the lower it is.
 */
export const ROOF_HEIGHT = { low: 10, tall: 20 };
/**
 * A building group's roof height: tall when any part is a tower or stands 40 ft or more; with floors above, on top of
 * the highest (10 ft a floor).
 */
export const roofHeight = (parts) => Math.max(parts.some((b) => b.tower || b.tall >= 1) ? ROOF_HEIGHT.tall : ROOF_HEIGHT.low, ROOF_HEIGHT.low * (1 + Math.max(0, ...parts.map((b) => b.floorsAbove ?? 0))));

/**
 * A building's walls in squares: thickness (the art's band), door, wide door and window widths, window spacing,
 * corner keep; offMap: how far past the map's edge a building may run and still be entered; nearStreet: how near a
 * way passes to count as its street; doorClear: how far before a door must be clear of fences and on the map.
 */
export const SHELL = { thickness: 0.3, door: 1, wideDoor: 2, window: 0.5, windowEvery: 2.6, cornerKeep: 0.45, offMap: 0.5, nearStreet: 4, doorClear: 0.8 };
const STONE_USES = new Set(["temple", "shrine", "keep", "watch", "tower", "gatehouse", "chapel", "guildhall", "customs", "palace", "market-hall"]);
const hashOf = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };

/**
 * A battle map's building groups, one per building that stands as one (one roof tile, one set of walls): touching
 * parts stay together, separate ones (an inn's stable) become groups of their own, and a centerpiece's or landmark's
 * parts are joined as they touch. Sets each building's group; the one holding a plot's main house keeps its name.
 */
export function battleGroups(items) {
  const buildings = items.filter((i) => i.kind === "building");
  const byKey = new Map();
  for (const b of buildings) {
    // (a plan landmark's parts, and a pinned house's, are ids <landmark>/1, /2... from it)
    const part = typeof b.from === "string" && b.id.startsWith(`${b.from}/`) && /^\d+$/.test(b.id.slice(b.from.length + 1));
    const k = b.group ?? b.id.match(/^(.*\/h-anchor\d+)(w\d+)?$/)?.[1] ?? (part ? b.from : b.id);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(b);
  }
  for (const [k, parts] of byKey) {
    if (parts.length === 1) { parts[0].group = k; continue; }
    // (parts a hair apart count as touching: a wing is set into the house it joins)
    const feet = parts.map((b) => offset([footprint(b)], 0.02).reduce((a, q) => (!a || Math.abs(signedArea(q)) > Math.abs(signedArea(a)) ? q : a), null) ?? footprint(b));
    const root = parts.map((_, i) => i);
    const find = (i) => (root[i] === i ? i : (root[i] = find(root[i])));
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (find(i) !== find(j) && polygonsOverlap(feet[i], feet[j])) root[find(j)] = find(i);
    const sets = new Map();
    parts.forEach((b, i) => { const r = find(i); if (!sets.has(r)) sets.set(r, []); sets.get(r).push(b); });
    const named = [...sets.values()].find((set) => set.some((b) => b.main || b.id === k)) ?? [...sets.values()][0];
    for (const set of sets.values()) for (const b of set) b.group = set === named ? k : set[0].id;
  }
}

/**
 * Each building's walls as rings of segments (wall, door, window) half a thickness inside its footprint, so the roof
 * covers them: a front door nearest a street, a back door into its yard (or a courtyard), windows clear of corners,
 * doors and neighbors. Adds a shell item per piece; returns how many. W, H: the map's size; a building the map's edge
 * cuts is closed (no doors, no interior).
 */
export function buildingShells(items, W = Infinity, H = Infinity) {
  const ways = items.filter((i) => i.kind === "way" && !i.faint && Array.isArray(i.path) && i.path.length >= 2);
  const buildings = items.filter((i) => i.kind === "building");
  const groups = new Map();
  for (const b of buildings) { const k = b.group ?? b.id; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); }
  const yards = new Map(items.filter((i) => i.kind === "surface" && i.class === "backyard").map((y) => [y.id.replace(/\/yard$/, ""), y]));
  // (the fences and walls a door mustn't open straight onto)
  const barriers = items.filter((i) => (i.kind === "boundary" || i.kind === "wall") && Array.isArray(i.path) && i.path.length >= 2 && i.class !== "cliff");
  const T = SHELL.thickness;
  const biggest = (list) => list.reduce((a, b) => (!a || Math.abs(signedArea(b.outer)) > Math.abs(signedArea(a.outer)) ? b : a), null);
  let n = 0;
  for (const [g, parts] of groups) {
    const main = parts.find((b) => b.main) ?? parts[0];
    if (parts.some((b) => b.castle)) continue; // (a castle's tower or gatehouse: castle.mjs built its walls)
    // The group's outline (a courtyard a hole in it; a round building its many-sided footprint), its walls' line half
    // a thickness in: a piece for each part (a narrow neck may split it), the biggest first
    const pieces = shapes(offset(union(parts.map(footprint)).filter((r) => signedArea(r) !== 0), -T / 2)).filter((p) => Math.abs(signedArea(p.outer)) > 1);
    pieces.sort((a, b) => Math.abs(signedArea(b.outer)) - Math.abs(signedArea(a.outer)));
    const shed = main.use === "shed" || (/\/o-/.test(main.id) && !main.use);
    const use = main.use ?? (shed ? "shed" : "house");
    const material = STONE_USES.has(use) || main.tower ? "stone" : shed || use === "stable" || use === "barn" ? "wood" : use === "smithy" ? "stonewood" : "timber";
    const h = hashOf(g);
    // (a lane cut short at this building's wall isn't its street when another way passes within a few squares)
    const feet = parts.map(footprint);
    const endsHere = (w) => (w.wallEnds ?? []).some((cut, i) => cut && feet.some((f) => { const p = i ? w.path[w.path.length - 1] : w.path[0]; return pointInPolygon(p, f) || distanceToPath(p, [...f, f[0]]) < (w.width ?? 1) / 2 + 1; }));
    const ownWays = ways.filter((w) => !endsHere(w));
    const passes = ownWays.some((w) => feet.some((f) => f.flatMap((p, i) => { const q = f[(i + 1) % f.length]; return [p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]]; }).some((p) => distanceToPath(p, w.path) - (w.width ?? 0) / 2 < SHELL.nearStreet)));
    const streets = passes ? ownWays : ways;
    pieces.forEach((piece, k) => {
      const sgn = Math.sign(signedArea(piece.outer));
      // (points on a straight line dropped)
      const tidy = (ring) => ring.filter((p, i) => { const a = ring[(i - 1 + ring.length) % ring.length], c = ring[(i + 1) % ring.length]; return Math.abs((p[0] - a[0]) * (c[1] - a[1]) - (p[1] - a[1]) * (c[0] - a[0])) > 1e-4; });
      const rings = [piece.outer, ...piece.holes].map(tidy).filter((r) => r.length >= 3);
      // (a round building's sides are too short for a door: its wall runs straight across the arc facing its street,
      // or the map's middle with no way on the map, just wide enough for its door)
      if (parts.every((b) => b.round) && rings[0]?.length >= 8) {
        const ring = rings[0], c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
        const near = streets.length ? streets.map((w) => nearestOnPath(c, w.path)).reduce((a, b) => (b.d < a.d ? b : a)).q : Number.isFinite(W) && Number.isFinite(H) ? [W / 2, H / 2] : [c[0], c[1] + 1];
        const at = ring.reduce((bi, p, i) => (Math.hypot(p[0] - near[0], p[1] - near[1]) < Math.hypot(ring[bi][0] - near[0], ring[bi][1] - near[1]) ? i : bi), 0);
        const need = (use === "temple" && k === 0 ? SHELL.wideDoor : SHELL.door) + 2 * SHELL.cornerKeep + 0.05, n = ring.length;
        let m = 1;
        while (m < n / 3 && Math.hypot(ring[(at - m + n) % n][0] - ring[(at + m) % n][0], ring[(at - m + n) % n][1] - ring[(at + m) % n][1]) < need) m++;
        const drop = new Set(Array.from({ length: 2 * m - 1 }, (_, j) => (at - m + 1 + j + n) % n));
        rings[0] = ring.filter((_, i) => !drop.has(i));
      }
      // Each ring's sides; a hole runs the other way around, so the same rule finds the building's side of it
      const ringEdges = rings.map((ring, ri) => ring.map((a, i) => {
        const b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
        const inward = sgn > 0 ? [-u[1], u[0]] : [u[1], -u[0]];
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const street = ri ? Infinity : Math.min(Infinity, ...streets.map((w) => distanceToPath(mid, w.path) - (w.width ?? 0) / 2));
        const out = [mid[0] - inward[0] * (T + 0.35), mid[1] - inward[1] * (T + 0.35)];
        const against = buildings.some((o) => !parts.includes(o) && pointInPolygon(out, footprint(o)));
        // (where a door in it would open: off the map, or straight onto a fence or wall)
        const step = [mid[0] - inward[0] * (T + SHELL.doorClear), mid[1] - inward[1] * (T + SHELL.doorClear)];
        const offMap = step[0] < 0 || step[1] < 0 || step[0] > W || step[1] > H;
        const fenced = barriers.some((w) => distanceToPath(step, w.path) < 0.35 || distanceToPath(out, w.path) < 0.35);
        return { a, b, L, u, inward, mid, step, street, against, offMap, fenced, court: ri > 0, open: [] };
      }));
      ringEdges.forEach((edges) => edges.forEach((e, i) => { e.prev = edges[(i - 1 + edges.length) % edges.length]; e.next = edges[(i + 1) % edges.length]; }));
      const edges = ringEdges.flat();
      // Front door: the free outer side nearest a street (a long side if one is about as near); none in a building cut
      // by the map's edge more than half a square past it (closed: windows only)
      const closed = parts.some((b) => footprint(b).some(([x, y]) => x < -SHELL.offMap || y < -SHELL.offMap || x > W + SHELL.offMap || y > H + SHELL.offMap));
      const doorW = use === "temple" && k === 0 ? SHELL.wideDoor : SHELL.door;
      const roomy = (e, w) => !e.against && e.L >= w + 2 * SHELL.cornerKeep;
      // (a door opens onto the map with room in front of it: a side that would put it off the map or onto a fence is
      // taken only when there's no other)
      const doorable = (list) => { const ok = list.filter((e) => !e.offMap && !e.fenced); return ok.length ? ok : list.filter((e) => !e.offMap); };
      const free = closed ? [] : doorable(ringEdges[0].filter((e) => roomy(e, doorW)));
      if (free.length) {
        const front = free.reduce((a, b) => (b.street + (b.L < 2.5 ? 1.5 : 0) < a.street + (a.L < 2.5 ? 1.5 : 0) ? b : a));
        const room = front.L / 2 - doorW / 2 - SHELL.cornerKeep;
        front.open.push({ type: "door", at: front.L / 2 + (h - 0.5) * room * 0.8, w: doorW, side: "front" });
        // Back door: into the yard, toward one end
        const yard = k === 0 ? yards.get(main.id) : null;
        if (yard) {
          const c = yard.poly.reduce((s, p) => [s[0] + p[0] / yard.poly.length, s[1] + p[1] / yard.poly.length], [0, 0]);
          // (toward one end, but clear of its corner; one that opens into the yard itself, read where the door would be,
          // clear of the yard's fence)
          const lo = SHELL.cornerKeep + SHELL.door / 2;
          const backAt = (e) => Math.min(e.L - lo, Math.max(lo, e.L * (h < 0.5 ? 0.3 : 0.7)));
          const opensInto = (e) => {
            const at = backAt(e), p = [e.a[0] + e.u[0] * at, e.a[1] + e.u[1] * at];
            const out = (d) => [p[0] - e.inward[0] * d, p[1] - e.inward[1] * d], q = out(T + SHELL.doorClear), q0 = out(T / 2 + 0.5);
            return pointInPolygon(q, yard.poly) && !barriers.some((w) => distanceToPath(q, w.path) < 0.35 || distanceToPath(q0, w.path) < 0.35);
          };
          const back = ringEdges[0].filter((e) => e !== front && roomy(e, SHELL.door) && opensInto(e)).reduce((a, b) => (!a || Math.hypot(b.mid[0] - c[0], b.mid[1] - c[1]) < Math.hypot(a.mid[0] - c[0], a.mid[1] - c[1]) ? b : a), null);
          if (back) back.open.push({ type: "door", at: backAt(back), w: SHELL.door, side: "back" });
        }
      }
      // A courtyard's door, in its longest side
      for (const ring of closed ? [] : ringEdges.slice(1)) {
        const side = ring.filter((e) => roomy(e, SHELL.door)).reduce((a, b) => (!a || b.L > a.L ? b : a), null);
        if (side) side.open.push({ type: "door", at: side.L / 2, w: SHELL.door, side: "court" });
      }
      // Windows: every so far along each free side, clear of its corners and doors (none in a shed)
      if (!shed) for (const e of edges.filter((e) => !e.against)) {
        const count = Math.floor((e.L - 2 * SHELL.cornerKeep) / SHELL.windowEvery);
        for (let i = 0; i < count; i++) {
          const at = e.L / 2 + (i - (count - 1) / 2) * SHELL.windowEvery;
          if (e.open.some((o) => Math.abs(o.at - at) < o.w / 2 + SHELL.window / 2 + 0.4)) continue;
          if (at - SHELL.window / 2 < SHELL.cornerKeep || at + SHELL.window / 2 > e.L - SHELL.cornerKeep) continue;
          e.open.push({ type: "window", at, w: SHELL.window });
        }
      }
      // The rings as segments; a wall piece at a corner is cut along the corner's bisector (a mitered joint), so the
      // art of two sides meets cleanly: `clip` is the piece's outline, a thickness either side of its line (and more)
      const walls = [];
      const miter = (e, which) => {
        const o = which === 0 ? e.prev : e.next;
        const p = which === 0 ? e.a : e.b;
        // (the joint line runs through the corner along the sum of the two sides' inward normals)
        const m = [e.inward[0] + o.inward[0], e.inward[1] + o.inward[1]], ml = Math.hypot(m[0], m[1]) || 1;
        const d = T / Math.max(0.2, m[0] / ml * e.inward[0] + m[1] / ml * e.inward[1]);
        return [[p[0] + (m[0] / ml) * d, p[1] + (m[1] / ml) * d], [p[0] - (m[0] / ml) * d, p[1] - (m[1] / ml) * d]];
      };
      const clipOf = (e, t0, t1, c0, c1) => {
        const P = (t, v) => [e.a[0] + e.u[0] * t + e.inward[0] * v, e.a[1] + e.u[1] * t + e.inward[1] * v];
        const s0 = c0 ? miter(e, 0) : [P(t0, T), P(t0, -T)], s1 = c1 ? miter(e, 1) : [P(t1, T), P(t1, -T)];
        return [s0[0], s1[0], s1[1], s0[1]];
      };
      for (const e of edges) {
        const P = (t) => [e.a[0] + e.u[0] * t, e.a[1] + e.u[1] * t];
        let t = 0;
        for (const o of e.open.sort((x, y) => x.at - y.at)) {
          const t0 = o.at - o.w / 2, t1 = o.at + o.w / 2;
          if (t0 > t + 1e-6) walls.push({ type: "wall", a: P(t), b: P(t0), inward: e.inward, corner: [t === 0, false], clip: clipOf(e, t, t0, t === 0, false) });
          walls.push({ type: o.type, a: P(t0), b: P(t1), inward: e.inward, side: o.side });
          t = t1;
        }
        if (t < e.L - 1e-6) walls.push({ type: "wall", a: P(t), b: P(e.L), inward: e.inward, corner: [t === 0, true], clip: clipOf(e, t, e.L, t === 0, true) });
      }
      items.push({ kind: "shell", id: k ? `${g}/shell${k + 1}` : `${g}/shell`, ...(closed ? { closed: true } : {}), from: main.from, group: g, use, material, thickness: T, variant: Math.floor(h * 1000), walls, ring: rings[0], holes: rings.slice(1) });
      n++;
    });
  }
  return n;
}
