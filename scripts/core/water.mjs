/**
 * Water as the layout, the checker and the drawing tools see it. A stream, river or canal runs along a path, its
 * width at its first point and its endWidth at its last (or one at each point), opening out where it meets a lake or
 * the sea. A pond, lake or sea is a curved, slightly ragged shape; a sea's corners near the map's edge are moved past
 * it, so its outline is the coast. Pure; squares unless they say feet.
 */
import { BODIES, RUNNING, SHORES } from "./plan.mjs";
import { shapeToPolygon, pointInPolygon, distanceToPath, polygonCrossesItself } from "./geom.mjs";
import { smoothPath } from "./smooth.mjs";
import { makeNoise } from "./noise.mjs";
import { segDist } from "./spatial.mjs";

export { BODIES, RUNNING, SHORES };

/** How far a river's stone bank reaches past its water, as both painters draw it. */
export const BANK = 0.475;

/** How far each shore reaches out from the water's edge (a river's stone bank reaches BANK). */
export const SHORE_REACH = { sand: 1.1, pebbles: 0.8, rocks: 0.6, grass: 0.3, marsh: 1.4, reeds: 0.5 };

/** The shores each kind of water picks from by its seed when the plan leaves it out: [shore, weight]. */
const SHORE_PICK = {
  pond: [["grass", 1], ["reeds", 1]],
  lake: [["grass", 3], ["reeds", 2], ["sand", 1], ["pebbles", 1], ["rocks", 1], ["marsh", 1]],
  sea: [["sand", 3], ["pebbles", 2], ["rocks", 2]],
};

/**
 * A sea's corners this near the map's edge (or past it) go onto it; its sides along the edge are then moved SEA_PAST
 * past it, so the coast is its only shore on the map.
 */
export const SEA_SNAP = 1;
const SEA_PAST = 3;

const finite = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** Water drawn as a shape: a pond, lake or sea (water of any class given a shape and no path is drawn as one). */
export const isBody = (f) => !!f && typeof f === "object" && f.type === "water" && !Array.isArray(f.path) && f.shape != null;

/** Water along a path. */
export const isRunning = (f) => !!f && typeof f === "object" && f.type === "water" && Array.isArray(f.path);

/** A body of water's shore: the plan's, else one picked from r (always drawn, so the stream stays the same). */
export function shoreOf(f, r) {
  const list = SHORE_PICK[f.class] ?? SHORE_PICK.lake;
  const total = list.reduce((s, [, w]) => s + w, 0);
  let x = r.next() * total, pick = list[0][0];
  for (const [s, w] of list) { if (x < w) { pick = s; break; } x -= w; }
  return SHORES.includes(f.shore) ? f.shore : pick;
}

/**
 * How far things keep from a body of water's edge: its shore's reach when the plan sets the shore, else the widest
 * shore its kind could pick, so rerolling a lake (a new shore) never moves what's around it.
 */
export function keepOf(f) {
  if (SHORES.includes(f.shore)) return SHORE_REACH[f.shore];
  return Math.max(...(SHORE_PICK[f.class] ?? SHORE_PICK.lake).map(([s]) => SHORE_REACH[s]));
}

/** A body of water is frozen when the plan says so, or (a pond or lake left unset) in winter. A sea never freezes unasked. */
export const frozenOf = (f, winter) => (typeof f.frozen === "boolean" ? f.frozen : winter && f.class !== "sea");

const bodyMemo = new WeakMap();

/**
 * A body of water's outline: { poly, ring } (ring closed), or null with fewer than three usable corners. W, H: the
 * map's size; seed: the plan's (not the lake's own, so a reroll never moves its outline, which steers the streets).
 */
export function bodyOf(f, { W, H, seed = 1 }) {
  const key = JSON.stringify([W, H, seed, f.id, f.class, f.straight, f.shape]);
  const hit = bodyMemo.get(f);
  if (hit && hit.key === key) return hit.body;
  const body = makeBody(f, W, H, seed);
  bodyMemo.set(f, { key, body });
  return body;
}

function makeBody(f, W, H, seed) {
  let pts;
  try { pts = shapeToPolygon(f.shape, 0, 48); } catch { pts = []; }
  pts = (Array.isArray(pts) ? pts : []).filter(finite).map((p) => [p[0], p[1]]);
  const tidy = (list) => {
    // Repeated corners, and a closing corner equal to the first, are one corner
    const out = list.filter((p, i) => i === 0 || Math.hypot(p[0] - list[i - 1][0], p[1] - list[i - 1][1]) > 1e-6);
    while (out.length > 1 && Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) <= 1e-6) out.pop();
    return out;
  };
  pts = tidy(pts);
  if (pts.length < 3) return null;
  // Sharp corners are rounded off inside the outline, gentle ones curved through; a point at least every half square
  // for the ragged edge to move
  const curve = (path) => densify(path.length >= 3 ? smoothPath(path, 0.5, 60, 4) : path, 0.5);
  let ring = null;
  if (f.class === "sea" && Number.isFinite(W) && Number.isFinite(H)) {
    pts = tidy(pts.map(([x, y]) => [x <= SEA_SNAP ? 0 : x >= W - SEA_SNAP ? W : x, y <= SEA_SNAP ? 0 : y >= H - SEA_SNAP ? H : y]));
    if (pts.length < 3) return null;
    ring = seaRing(pts, W, H, f.straight === true ? (p) => p : curve);
  }
  if (!ring) ring = f.straight === true ? [...pts, pts[0]] : curve([...pts, pts[0]]);
  if (f.straight !== true) ring = ragged(ring, f, seed, W, H);
  return { poly: ring.slice(0, -1), ring };
}

/** A path with a point at least every step squares (its own points kept). */
function densify(path, step) {
  const out = [[path[0][0], path[0][1]]];
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) out.push(k === n ? [bx, by] : [ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

/**
 * A sea's outline from its corners (those near the map's edge already on it): each run of sides that isn't along the
 * map's edge is the coast, curved as drawn; its ends, and the corners along the edge, are moved SEA_PAST past the
 * edge, so no shore shows along it. Null when no side runs along the edge (a sea in the middle of the map is drawn as
 * a lake is); a closed ring otherwise.
 */
function seaRing(pts, W, H, curve) {
  const n = pts.length;
  const edges = ([x, y]) => [x === 0 && "L", x === W && "R", y === 0 && "T", y === H && "B"].filter(Boolean);
  // A side along the edge with the sea on the map's side of it (not land reaching the edge between two bits of sea)
  const IN = { L: [1, 0], R: [-1, 0], T: [0, 1], B: [0, -1] };
  const along = (a, b) => edges(a).filter((e) => edges(b).includes(e)).some((e) => pointInPolygon([(a[0] + b[0]) / 2 + IN[e][0] * 0.01, (a[1] + b[1]) / 2 + IN[e][1] * 0.01], pts));
  const side = pts.map((p, i) => along(p, pts[(i + 1) % n])); // side i runs from corner i to corner i + 1
  if (!side.some(Boolean)) return null;
  const out = ([x, y]) => [x === 0 ? -SEA_PAST : x === W ? W + SEA_PAST : x, y === 0 ? -SEA_PAST : y === H ? H + SEA_PAST : y];
  if (side.every(Boolean)) { const o = pts.map(out); return [...o, o[0]]; }
  // Start at the first corner of a run of coast
  const start = side.findIndex((s, i) => !s && side[(i + n - 1) % n]);
  const ring = [];
  let k = 0;
  while (k < n) {
    const i = (start + k) % n;
    if (side[i]) { ring.push(out(pts[i])); k++; continue; }
    // A run of coast: from corner i along every side that isn't along the edge
    const chain = [pts[i]];
    while (k < n && !side[(start + k) % n]) { chain.push(pts[(start + k + 1) % n]); k++; }
    const c = curve(chain);
    ring.push(out(chain[0]), ...c.map((p) => [p[0], p[1]]), out(chain.at(-1)));
  }
  const tidy = ring.filter((p, i) => i === 0 || Math.hypot(p[0] - ring[i - 1][0], p[1] - ring[i - 1][1]) > 1e-6);
  while (tidy.length > 1 && Math.hypot(tidy[0][0] - tidy.at(-1)[0], tidy[0][1] - tidy.at(-1)[1]) <= 1e-6) tidy.pop();
  return [...tidy, tidy[0]];
}

/**
 * The outline moved in and out a little by a noise along its length, so a shore isn't a perfect curve: up to half a
 * square on a lake or the sea, much less on a pond. Kept smooth if that would make it cross itself.
 */
function ragged(ring, f, seed, W, H) {
  const poly = ring.slice(0, -1), n = poly.length;
  if (n < 6) return ring;
  let a = 0;
  for (let i = 0; i < n; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n]; a += x1 * y2 - x2 * y1; }
  const size = Math.sqrt(Math.abs(a / 2));
  const amp = f.class === "pond" ? Math.min(0.12, size * 0.03) : Math.min(0.5, size * 0.05);
  if (!(amp > 0.01)) return ring;
  const noise = makeNoise(seed, `${f.id}/shore`, { scale: 3, octaves: 2 });
  const sign = Math.sign(a) || 1;
  const out = poly.map((p, i) => {
    const prev = poly[(i + n - 1) % n], next = poly[(i + 1) % n];
    // Off the map (a sea past its edge) nothing shows, so nothing moves
    if (p[0] < 0 || p[1] < 0 || p[0] > W || p[1] > H) return [p[0], p[1]];
    const dx = next[0] - prev[0], dy = next[1] - prev[1], l = Math.hypot(dx, dy) || 1;
    const nx = (dy / l) * sign, ny = (-dx / l) * sign;
    const d = noise(p[0], p[1]) * amp;
    return [p[0] + nx * d, p[1] + ny * d];
  });
  if (polygonCrossesItself(out)) return ring;
  return [...out, out[0]];
}

/** Cumulative length along a path as a share of its whole (0 at the first point, 1 at the last). */
function shares(path) {
  const out = [0];
  for (let i = 1; i < path.length; i++) out.push(out[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const L = out.at(-1) || 1;
  return out.map((s) => s / L);
}

/** True when list is a width in feet for each of n points. */
export const okWidths = (list, n) => Array.isArray(list) && list.length === n && list.every((v) => Number.isFinite(v) && v >= 1);

/**
 * The width at each point of a stream's, river's or canal's path (as the layout draws it, perhaps smoothed), in
 * squares; or null when it's the same all along. f: the feature, its path as drawn; given: its path as the plan gives
 * it (for widths, one at each of the plan's points: each drawn point takes the width at its share of the way along).
 */
export function widthsOf(f, given, sq) {
  const n = Array.isArray(given) ? given.length : 0;
  const list = okWidths(f.widths, n) ? f.widths : null;
  const w0 = Number.isFinite(f.width) ? f.width : null, w1 = Number.isFinite(f.endWidth) ? f.endWidth : null;
  if (!list && (w0 === null || w1 === null || w1 === w0)) return null;
  const tp = shares(f.path);
  if (!list) return tp.map((t) => (w0 + (w1 - w0) * t) / sq);
  const tg = shares(given);
  return tp.map((t) => {
    let k = 1;
    while (k < tg.length - 1 && tg[k] < t) k++;
    const a = tg[k - 1], b = tg[k], u = b > a ? Math.max(0, Math.min(1, (t - a) / (b - a))) : 0;
    return (list[k - 1] + (list[k] - list[k - 1]) * u) / sq;
  });
}

/** Where segment a-b crosses segment c-d: the share t along a-b, or null. */
function crossT(a, b, c, d) {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - a[0], qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/**
 * A stream's or river's widths (in squares, one a point) opened out where it meets a lake or the sea: wider for a
 * few of its own widths either side of where it crosses the shore, up to nearly twice as wide there. widths: one a
 * point, or null with width for all. Returns new widths, or null when it meets no body of water.
 */
export function mouthWidths(path, widths, width, bodies) {
  if (!Array.isArray(path) || path.length < 2 || !bodies.length) return null;
  const at = [0];
  for (let i = 1; i < path.length; i++) at.push(at[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const w = (i) => (widths ? widths[i] : width);
  const hits = []; // [length along, width there]
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    for (const { ring } of bodies) {
      for (let j = 1; j < ring.length; j++) {
        const t = crossT(a, b, ring[j - 1], ring[j]);
        if (t !== null) hits.push([at[i - 1] + (at[i] - at[i - 1]) * t, w(i - 1) + (w(i) - w(i - 1)) * t]);
      }
    }
  }
  if (!hits.length) return null;
  return path.map((_, i) => {
    let f = 1;
    for (const [s, wc] of hits) {
      const L = Math.max(1.5, Math.min(6, 2.5 * wc));
      const k = Math.max(0, 1 - Math.abs(at[i] - s) / L);
      f = Math.max(f, 1 + 0.9 * k * k);
    }
    return w(i) * f;
  });
}

/**
 * True when (x, y) is within extra of a water entry as the layout keeps clear of it: { path, clear } (clear from the
 * center line), with clears (one a segment) on water that varies in width, and body (a polygon) on a lake or pond,
 * whose path is its shore.
 */
export function nearWater([x, y], w, extra = 0) {
  if (w.body && pointInPolygon([x, y], w.body)) return true;
  const p = w.path;
  if (!w.clears) return distanceToPath([x, y], p) < w.clear + extra;
  for (let i = 1; i < p.length; i++) if (segDist(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) < w.clears[i - 1] + extra) return true;
  return false;
}

/** One clearance a segment from one width a point: the wider end of each, halved, plus pad. */
export const segClears = (widths, pad) => widths.slice(1).map((w, i) => Math.max(w, widths[i]) / 2 + pad);

/**
 * The plan's water as tests that don't need a layout (the checker, the drawing tools): [{ path, clear, body? }] for
 * nearWater, each stream or river at its widest (a little more than the layout keeps clear of where it narrows).
 * plan: normalized.
 */
export function waterEntries(plan, pad = 0.225) {
  const sq = Number.isFinite(plan.size?.ftPerSquare) && plan.size.ftPerSquare > 0 ? plan.size.ftPerSquare : 25;
  const [W, H] = plan.size?.squares ?? [50, 50];
  const out = [];
  for (const f of plan.features ?? []) {
    if (isRunning(f) && f.path.length >= 2 && f.path.every(finite)) {
      const widest = Math.max(Number.isFinite(f.width) ? f.width : 0, Number.isFinite(f.endWidth) ? f.endWidth : 0, ...(okWidths(f.widths, f.path.length) ? f.widths : []));
      out.push({ path: f.path, clear: widest / sq / 2 + pad });
    } else if (isBody(f)) {
      const b = bodyOf(f, { W, H, seed: plan.seed ?? 1 });
      if (b) out.push({ path: b.ring, clear: keepOf(f) + 0.15, body: b.poly }); // as the layout keeps clear of its shore
    }
  }
  return out;
}

/**
 * How far (x, y) lies past a water's edge (less than 0 inside it). w: { path, width } in squares, with widths (one a
 * point) where it varies, or body (a polygon) and path its shore.
 */
export function pastEdge([x, y], w) {
  if (w.body) {
    const d = distanceToPath([x, y], w.path);
    return pointInPolygon([x, y], w.body) ? -d : d;
  }
  const p = w.path;
  let best = Infinity;
  for (let i = 1; i < p.length; i++) {
    const [ax, ay] = p[i - 1], [bx, by] = p[i];
    // The width where the nearest point on this stretch is
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const half = (w.widths ? w.widths[i - 1] + (w.widths[i] - w.widths[i - 1]) * t : w.width ?? 1) / 2;
    best = Math.min(best, segDist(x, y, ax, ay, bx, by) - half);
  }
  return best;
}

/** How far a water's bank (a stream's or river's stone bank, a lake's shore) reaches past its edge. */
export const bankOf = (w) => (w.body ? w.reach ?? BANK : BANK);

/**
 * How running water wanders on a battle map: its middle swings up to sway of its width either side of the plan's path
 * over a long wave, and its width swells by up to swell over a shorter one. Both fade out near a crossing, so a
 * bridge stands on straight banks, and come from the plan's seed and the water's id.
 */
export const WANDER = { sway: 0.12, swayMin: 0.2, swayMost: 0.7, swayWave: 9, swell: 0.12, swellWave: 5.5, step: 0.5, calm: 1.5 };

/**
 * A running water's path and widths on a battle map, wandering as WANDER says. path: its middle line (smoothed);
 * widths: its width at each point (squares), or null for width all along; near: [[x, y, r]] places it keeps straight
 * near (a crossing, r its half length). Returns { path, widths } (resampled every WANDER.step squares), or null for a
 * path too short to wander.
 */
export function wander(path, widths, width, { seed = 1, id = "water", near = [] } = {}) {
  if (!Array.isArray(path) || path.length < 2) return null;
  // (the path every half square, each point with its share along it, for the widths to follow)
  const pts = [path[0]], at = [0];
  const arcs = [0];
  for (let i = 1; i < path.length; i++) arcs.push(arcs[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const total = arcs.at(-1);
  if (!(total > 2 * WANDER.step)) return null;
  const n = Math.max(2, Math.ceil(total / WANDER.step));
  let k = 1;
  for (let j = 1; j <= n; j++) {
    const s = (total * j) / n;
    while (k < path.length - 1 && arcs[k] < s) k++;
    const u = arcs[k] > arcs[k - 1] ? (s - arcs[k - 1]) / (arcs[k] - arcs[k - 1]) : 0;
    pts.push([path[k - 1][0] + (path[k][0] - path[k - 1][0]) * u, path[k - 1][1] + (path[k][1] - path[k - 1][1]) * u]);
    at.push(s);
  }
  const widthAt = (s) => {
    if (!Array.isArray(widths) || widths.length !== path.length) return width;
    let i = 1;
    while (i < arcs.length - 1 && arcs[i] < s) i++;
    const u = arcs[i] > arcs[i - 1] ? Math.max(0, Math.min(1, (s - arcs[i - 1]) / (arcs[i] - arcs[i - 1]))) : 0;
    return widths[i - 1] + (widths[i] - widths[i - 1]) * u;
  };
  const sway = makeNoise(seed, `wander-${id}`, { scale: WANDER.swayWave, octaves: 2 });
  const swell = makeNoise(seed, `swell-${id}`, { scale: WANDER.swellWave, octaves: 2 });
  const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
  const outPath = [], outW = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
    // (still near a crossing: nothing wanders within its half length and a square, easing in over the next calm squares)
    let keep = 1;
    for (const [x, y, r] of near) keep = Math.min(keep, smooth((Math.hypot(p[0] - x, p[1] - y) - r - 1) / WANDER.calm));
    const w = widthAt(at[i]);
    const amp = Math.min(WANDER.swayMost, Math.max(WANDER.swayMin, w * WANDER.sway)) * keep;
    const d = sway(at[i], 0.37) * amp;
    outPath.push([p[0] + nx * d, p[1] + ny * d]);
    outW.push(Math.max(0.5, w * (1 + swell(at[i], 0.71) * WANDER.swell * keep)));
  });
  return { path: outPath, widths: outW };
}
