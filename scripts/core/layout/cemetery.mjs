/**
 * A cemetery: a gate where the nearest road meets it, a path from there across it (and one across that in a big
 * one), graves in rows square to the path, yews along the path and here and there, tombs beside the paths and a
 * chapel at the far end in a big one, and a stone wall or a hedge around it with a gap at the gate. Pure: runs
 * anywhere. Numbers are in squares unless they say feet.
 */
import { bbox, pointInPolygon, shapeToPolygon, distanceToPath } from "../geom.mjs";
import { centroid, area as polyArea } from "../lots/poly.mjs";
import { makeNoise } from "../noise.mjs";

/** How big a cemetery (square squares) gets a cross path and tombs, and a chapel. */
export const CEMETERY_BIG = 70;
export const CEMETERY_CHAPEL = 140;

const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
function nearestOn(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return [a[0] + dx * t, a[1] + dy * t];
}

/**
 * Fills a cemetery area. area: the plan's feature; r: its stream; roads: [{ path }] it may open onto; ftPerSquare.
 * Returns { surface: { poly, style: "cemetery", paths: [{ path, width, surface }], basin: null }, trees: [{ x, y, s,
 * rot, variant }] (yews: conifers), graves: [{ x, y, rot, variant }], buildings: [{ key, spec }] (addBuilding specs:
 * tombs and a chapel), walls: [path] (stone, the gate left open), hedges: [path], border }.
 */
export function fillCemetery({ area, r, roads = [], ftPerSquare }) {
  const sq = (ft) => ft / ftPerSquare;
  const poly = shapeToPolygon(area.shape, area.rot ?? 0);
  const ring = [...poly, poly[0]];
  const out = { surface: { poly, style: "cemetery", paths: [], basin: null }, trees: [], graves: [], buildings: [], walls: [], hedges: [], border: "none" };
  if (poly.length < 3) return out;
  // Every draw up front from forks keyed by what it's for, so the roads around it moving changes only what they touch
  const border = ["hedge", "drystone", "none"].includes(area.border) ? area.border : r.fork("border").chance(0.65) ? "drystone" : "hedge";
  out.border = border;
  const size = polyArea(poly), c = centroid(poly);
  const inside = (p, m = 0) => pointInPolygon(p, poly) && distanceToPath(p, ring) > m;

  // The gate: the point of its outline nearest a road (within 30 squares), else the end of its long axis
  let gate = null, best = 30;
  for (const road of roads) for (let i = 1; i < road.path.length; i++) for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length];
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], on = nearestOn(q, road.path[i - 1], road.path[i]), d = near(q, on);
      if (d < best) { best = d; gate = q; }
    }
  }
  const [x0, y0, x1, y1] = bbox(poly);
  if (!gate) gate = poly.reduce((a, b) => (near(b, c) > near(a, c) ? b : a));
  // The main path: from the gate across through the middle to the far side
  const dir = [c[0] - gate[0], c[1] - gate[1]], dl = Math.hypot(...dir) || 1, U = [dir[0] / dl, dir[1] / dl], V = [-U[1], U[0]];
  const angle = (Math.atan2(U[1], U[0]) * 180) / Math.PI;
  const run = (from, d) => {
    const pts = [from];
    for (let t = 0.25; t < Math.hypot(x1 - x0, y1 - y0) + 2; t += 0.25) {
      const p = [from[0] + d[0] * t, from[1] + d[1] * t];
      if (!inside(p, 0.6)) { if (pts.length > 1 || t > 2) break; continue; }
      pts.push(p);
    }
    return pts.length > 1 ? [pts[0], pts[pts.length - 1]] : null;
  };
  const big = size >= CEMETERY_BIG, width = sq(big ? 8 : 6), surface = big ? "gravel" : "trodden";
  const mainPath = run([gate[0] + U[0] * 0.05, gate[1] + U[1] * 0.05], U);
  if (mainPath) out.surface.paths.push({ path: mainPath, width, surface });
  if (big) {
    const a = run(c, V), b = run(c, [-V[0], -V[1]]);
    if (a && b) out.surface.paths.push({ path: [b[1], c, a[1]], width: width * 0.8, surface });
  }
  const onPath = (p, m) => out.surface.paths.some((w) => distanceToPath(p, w.path) < w.width / 2 + m);

  // A chapel at the far end of the path in a big one, tombs beside the paths (up front: graves keep clear of them)
  const R = r.fork("buildings"), feet = [];
  const place = (key, cx, cy, len, dep, rot, extra) => {
    const a = (rot * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [cx + (ux * i * len) / 2 - (uy * j * dep) / 2, cy + (uy * i * len) / 2 + (ux * j * dep) / 2]);
    if (!corners.every((p) => inside(p, 0.45)) || corners.some((p) => onPath(p, 0.15)) || onPath([cx, cy], 0.15)) return false;
    if (feet.some((f) => near(f.c, [cx, cy]) < (f.r + Math.hypot(len, dep) / 2) * 0.95)) return false;
    feet.push({ c: [cx, cy], r: Math.hypot(len, dep) / 2, corners });
    out.buildings.push({ key, spec: { shape: { rect: [cx - len / 2, cy - dep / 2, cx + len / 2, cy + dep / 2] }, rot, chimney: false, ...extra } });
    return true;
  };
  const wantChapel = size >= CEMETERY_CHAPEL && R.chance(0.75);
  if (wantChapel && mainPath) {
    const e = mainPath[1], L = sq(40), D = sq(24);
    for (const back of [0.6, 1.2, 1.8, 2.6]) if (place("chapel", e[0] - U[0] * (L / 2 + back), e[1] - U[1] * (L / 2 + back), L, D, angle, { roof: "slate", roofStyle: "gable", height: 30, use: "chapel" })) {
      // (the path ends at its door)
      mainPath[1] = [e[0] - U[0] * (L + back), e[1] - U[1] * (L + back)];
      break;
    }
  }
  const tombs = big ? 2 + R.int(Math.min(6, Math.floor(size / 60))) : 0;
  for (let k = 0, made = 0; k < 24 && made < tombs; k++) {
    const w = out.surface.paths[R.int(out.surface.paths.length || 1)] ?? null, t = R.next(), side = R.chance(0.5) ? 1 : -1, long = R.chance(0.5);
    if (!w) break;
    const [a, b] = [w.path[0], w.path[w.path.length - 1]], d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...d) || 1, n = [-d[1] / l, d[0] / l];
    const len = sq(long ? 18 : 12), dep = sq(12), off = w.width / 2 + dep / 2 + sq(4);
    const p = [a[0] + d[0] * t + n[0] * side * off, a[1] + d[1] * t + n[1] * side * off];
    if (place(`tomb${made + 1}`, p[0], p[1], len, dep, (Math.atan2(d[1], d[0]) * 180) / Math.PI, { roof: "slate", roofStyle: R.chance(0.5) ? "pyramid" : "gable", height: 14, use: "tomb" })) made++;
  }

  // Yews along the main path and here and there
  const T = r.fork("trees");
  const tree = (x, y, s) => { const rot = T.next() * 360, variant = T.int(8); if (inside([x, y], 0.5) && !onPath([x, y], 0.35) && !feet.some((f) => near(f.c, [x, y]) < f.r + 0.4)) out.trees.push({ x, y, s, rot, variant }); };
  if (mainPath) {
    const [a, b] = mainPath, l = near(a, b);
    for (let t = 1.2; t < l - 0.8; t += 1.8) for (const side of [-1, 1]) {
      const keep = T.chance(0.8), s = 0.7 + T.next() * 0.2;
      if (keep) tree(a[0] + U[0] * t + V[0] * side * (width / 2 + 0.55), a[1] + U[1] * t + V[1] * side * (width / 2 + 0.55), s);
    }
  }
  for (let k = 0, n = 3 + Math.floor(size / 25); k < n; k++) { const x = x0 + T.next() * (x1 - x0), y = y0 + T.next() * (y1 - y0); tree(x, y, 0.6 + T.next() * 0.3); }

  // Graves in rows square to the main path, in patches with open grass between (old and new parts of the ground)
  const G = r.fork("graves"), patch = makeNoise(G.int(1e9), "patches", { scale: 4, octaves: 2 });
  let level = G.range(-0.4, -0.15);
  const step = 0.42, row = 0.58;
  const reach = Math.hypot(x1 - x0, y1 - y0) / 2 + 1;
  const spots = [];
  for (let v = -reach; v <= reach; v += step) for (let u = -reach; u <= reach; u += row) {
    const keep = G.chance(0.82), rot = angle + (G.next() - 0.5) * 8, variant = G.int(8);
    const p = [c[0] + U[0] * u + V[0] * v, c[1] + U[1] * u + V[1] * v];
    if (!keep || !inside(p, 0.5) || onPath(p, 0.3)) continue;
    if (feet.some((f) => near(f.c, p) < f.r + 0.3) || out.trees.some((t) => near([t.x, t.y], p) < 0.45)) continue;
    spots.push({ x: p[0], y: p[1], rot, variant, n: patch(p[0], p[1]) });
  }
  // (at least half its ground in graves: a patch level that would leave fewer is lowered to keep that many)
  const sorted = spots.map((g) => g.n).sort((a, b) => b - a);
  if (sorted.length && sorted.filter((n) => n >= level).length < sorted.length * 0.5) level = sorted[Math.floor(sorted.length * 0.5)];
  for (const g of spots) if (g.n >= level) out.graves.push({ x: g.x, y: g.y, rot: g.rot, variant: g.variant });

  // Around it: a stone wall or a hedge, the gate left open
  if (border !== "none") {
    const gap = Math.max(width / 2 + 0.3, 0.6);
    const pts = [];
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length], n = Math.max(1, Math.ceil(near(a, b) / 0.25));
      for (let i = 0; i < n; i++) pts.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
    }
    const open = (p) => near(p, gate) < gap;
    const start = pts.findIndex(open);
    const order = start < 0 ? [...pts, pts[0]] : [...pts.slice(start), ...pts.slice(0, start)];
    const runs = [];
    let cur = null;
    for (const p of order) { if (open(p)) { cur = null; continue; } if (!cur) runs.push((cur = [])); cur.push(p); }
    (border === "drystone" ? out.walls : out.hedges).push(...runs.filter((w) => w.length > 1));
  }
  return out;
}
