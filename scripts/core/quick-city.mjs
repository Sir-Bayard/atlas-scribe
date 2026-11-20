/**
 * Quick Start for a city or a metropolis: a walled city cut into wards. A wall outline around a center, main roads from
 * the center out through its gates, a street just inside the wall, and the inside cut into wards (Voronoi cells
 * between the main roads, each an ordinary district) whose edges are streets. The water is a river through it, a sea
 * coast with a harbor, a lake shore, or a river meeting the sea. Everything comes out as plan features, so rerolls,
 * locks and reshaping work as on any plan. Pure: runs anywhere. Numbers are in squares (25 ft).
 */
import { Delaunay } from "../../vendor/d3-delaunay.mjs";
import { intersect, difference, union, offset, area, centroid, bands } from "./lots/poly.mjs";
import { pathTouchesPolygon, polygonCrossesItself, polygonsOverlap } from "./geom.mjs";
import { meander, bends } from "./meander.mjs";
import { watermill, windmill } from "./mills.mjs";
import { cityOutline, cityWater, cliffAndGates, wards, cityDistricts, cityGreens, wallsAndHarbor, outsideTheWalls } from "./city-steps/index.mjs";

/**
 * Per size: the map in squares, the wall's mean radius, the wards wanted, pixels a square (so the image stays under
 * about 8000 px a side), how many gates, the central square's radius.
 */
export const CITY_SIZES = {
  city: { squares: [150, 116], R: 38, wards: [10, 14], px: 40, square: 4, gates: { through: 2, fork: 3, crossroads: 4 } },
  metropolis: { squares: [230, 176], R: 64, wards: [24, 32], px: 30, square: 6, gates: { through: 4, fork: 5, crossroads: 6 } },
};

/** The water a city can have (a river, a sea coast with a harbor, a lake shore, a river meeting the sea, or none). */
export const CITY_WATER = ["river", "coast", "lake", "estuary", "none"];

/**
 * The shapes a city's river takes: bending through it, split around an island, looping around the city, or two
 * rivers meeting in it.
 */
export const RIVER_FORMS = ["meander", "island", "loop", "meeting"];

/**
 * The outlines a city can take: compact (roughly round), lobed (swelling and narrowing in lobes), on a promontory
 * (the sea or a lake on three sides, the wall across its neck), along a shore or a river (long and narrow, lying
 * along it), or against a cliff (its wall ending at the cliff, the city at its foot or on top of it).
 */
export const CITY_SHAPES = ["compact", "lobed", "promontory", "shore", "cliff"];

/** The river forms a long city's river or one by a cliff can take (the others take any). */
export const SHAPE_FORMS = { shore: ["meander", "island", "meeting"], cliff: ["meander", "meeting"] };

/** The water each outline goes with. */
export const SHAPE_WATER = {
  compact: CITY_WATER,
  lobed: CITY_WATER,
  promontory: ["coast", "lake"],
  shore: ["river", "coast", "lake", "estuary"],
  cliff: ["none", "river", "coast", "lake"],
};

export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const mul = (a, k) => [a[0] * k, a[1] * k];
export const dirOf = (rad) => [Math.cos(rad), Math.sin(rad)];
export const r1 = (v) => Math.round(v * 10) / 10;
export const pt = (p) => [r1(p[0]), r1(p[1])];
export const TAU = 2 * Math.PI;
/** An angle brought into [0, 2pi). */
export const norm = (a) => ((a % TAU) + TAU) % TAU;
/** How far apart two angles are, either way around. */
export const apart = (a, b) => { const d = Math.abs(norm(a) - norm(b)); return Math.min(d, TAU - d); };

export function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
}
export const distToPath = (p, path) => path.slice(1).reduce((m, q, i) => Math.min(m, distToSeg(p, path[i], q)), Infinity);
export const distToRing = (p, poly) => distToPath(p, [...poly, poly[0]]);
export function inside(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** A path with a point at least every step squares. */
export function densify(path, step) {
  return path.flatMap((p, i) => {
    if (!i) return [p];
    const q = path[i - 1], n = Math.max(1, Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / step));
    return Array.from({ length: n }, (_, k) => [q[0] + ((p[0] - q[0]) * (k + 1)) / n, q[1] + ((p[1] - q[1]) * (k + 1)) / n]);
  });
}
/** Where segment a-b crosses segment c-d, or null. */
export function segCross(a, b, c, d) {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - a[0], qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + rx * t, a[1] + ry * t] : null;
}
export function crossings(a, b) {
  const out = [];
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) { const h = segCross(a[i - 1], a[i], b[j - 1], b[j]); if (h) out.push(h); }
  return out;
}
/** How far along dir from c to the map's edge. */
export function toEdge(c, dir, W, H) {
  const ts = [];
  if (dir[0] > 1e-9) ts.push((W - c[0]) / dir[0]);
  if (dir[0] < -1e-9) ts.push(-c[0] / dir[0]);
  if (dir[1] > 1e-9) ts.push((H - c[1]) / dir[1]);
  if (dir[1] < -1e-9) ts.push(-c[1] / dir[1]);
  return Math.max(0, Math.min(...ts));
}
/** A wandering line from start along dir to the map's edge (a point every step, pushed sideways at most amp). */
export function wander(r, start, dir, W, H, { step = 8, amp = 2 } = {}) {
  const len = toEdge(start, dir, W, H), side = [-dir[1], dir[0]];
  const pts = [start];
  let off = 0;
  for (let s = step; s < len - step * 0.6; s += step) {
    off = Math.max(-amp, Math.min(amp, off + r.range(-amp * 0.6, amp * 0.6)));
    const p = add(add(start, mul(dir, s)), mul(side, off));
    pts.push([Math.max(0.5, Math.min(W - 0.5, p[0])), Math.max(0.5, Math.min(H - 0.5, p[1]))]);
  }
  pts.push(add(start, mul(dir, len)));
  return pts;
}
/** A closed polygon rounded to a tenth, no point repeated straight after itself. */
export function outline(poly) {
  const out = [];
  for (const p of poly.map(pt)) if (!out.length || out[out.length - 1][0] !== p[0] || out[out.length - 1][1] !== p[1]) out.push(p);
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}
/** The pieces of a path outside every polygon in polys (sampled every half square), each at least min long. */
export function pathOutside(path, polys, min = 1) {
  const pts = densify(path, 0.5);
  const runs = [];
  let cur = null;
  for (const p of pts) {
    if (polys.some((q) => inside(p, q))) { cur = null; continue; }
    if (!cur) { cur = []; runs.push(cur); }
    cur.push(p);
  }
  const len = (p) => p.reduce((s, q, i) => s + (i ? Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);
  // A closed ring's last run and first run meet at its start: one run
  const closedRing = path.length > 2 && path[0][0] === path[path.length - 1][0] && path[0][1] === path[path.length - 1][1];
  if (closedRing && runs.length > 1 && runs[0][0] === pts[0] && runs[runs.length - 1][runs[runs.length - 1].length - 1] === pts[pts.length - 1]) runs[0] = [...runs.pop(), ...runs[0].slice(1)];
  return runs.filter((p) => p.length >= 2 && len(p) >= min).map((p) => simplify(p, 0.05));
}
/** A path with points dropped where it runs straight: none of them more than tol off the line kept (Douglas-Peucker). */
export function simplify(path, tol) {
  if (path.length < 3) return path;
  const keep = new Array(path.length).fill(false);
  keep[0] = keep[path.length - 1] = true;
  const stack = [[0, path.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let far = -1, d = tol;
    for (let k = i + 1; k < j; k++) { const e = distToSeg(path[k], path[i], path[j]); if (e > d) { d = e; far = k; } }
    if (far >= 0) { keep[far] = true; stack.push([i, far], [far, j]); }
  }
  return path.filter((_, k) => keep[k]);
}

/**
 * The city's plan pieces: { W, H, features, label, center, px }. choices: Quick Start's (size city or metropolis,
 * water from CITY_WATER, river, shape, roads, center, surroundings, season); seed: the plan's; dirs: the way its roads,
 * river and shore lie (directions.mjs readDirections), or null.
 */
export function cityPlan(choices, seed, dirs = null) {
  const ctx = { choices, seed, dirs };
  cityOutline(ctx);
  cityWater(ctx);
  cliffAndGates(ctx);
  wards(ctx);
  cityDistricts(ctx);
  cityGreens(ctx);
  wallsAndHarbor(ctx);
  return outsideTheWalls(ctx);
}

export const pathLen = (p) => p.reduce((s, q, i) => s + (i ? Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);

/** Segments joined end to end into paths (ends matched to a hundredth). */
export function chain(segs) {
  const key = (p) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
  const at = new Map();
  segs.forEach((s, i) => { for (const p of s) { const k = key(p); if (!at.has(k)) at.set(k, []); at.get(k).push(i); } });
  const used = new Set(), out = [];
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const path = [...segs[i]];
    // Grow from both ends while exactly one unused segment continues it (a junction ends a path)
    for (const end of [1, 0]) {
      for (;;) {
        const tip = end ? path[path.length - 1] : path[0];
        const next = (at.get(key(tip)) ?? []).filter((j) => !used.has(j));
        if (next.length !== 1 || (at.get(key(tip)) ?? []).length > 2) break;
        const j = next[0];
        used.add(j);
        const s = segs[j], far = key(s[0]) === key(tip) ? s[1] : s[0];
        if (end) path.push(far); else path.unshift(far);
      }
    }
    out.push(path);
  }
  return out;
}

/** Cells smaller than min joined to the neighbor they share the longest side with (smallest first). */
export function mergeSmall(cells, min) {
  const key = (p) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
  const shared = (a, b) => {
    const pts = new Set(b.map(key));
    let len = 0;
    for (let i = 0; i < a.length; i++) { const p = a[i], q = a[(i + 1) % a.length]; if (pts.has(key(p)) && pts.has(key(q))) len += Math.hypot(q[0] - p[0], q[1] - p[1]); }
    return len;
  };
  let list = cells.slice();
  for (;;) {
    const small = list.filter((c) => area(c) < min).sort((a, b) => area(a) - area(b))[0];
    if (!small || list.length < 2) return list;
    const best = list.filter((c) => c !== small).map((c) => ({ c, l: shared(small, c) })).sort((a, b) => b.l - a.l)[0];
    if (!best || best.l < 0.5) return list;
    const joined = union([small, best.c]);
    if (joined.length !== 1) return list;
    list = [...list.filter((c) => c !== small && c !== best.c), joined[0]];
  }
}

/** A polygon cut into k Voronoi cells, its seeds spread by two rounds of moving each to its cell's middle. */
export function voronoiIn(poly, k, r) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const box = [Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) + 1, Math.max(...ys) + 1];
  let seeds = [];
  for (let t = 0; t < 2000 && seeds.length < k; t++) {
    const p = [r.range(box[0], box[2]), r.range(box[1], box[3])];
    if (inside(p, poly)) seeds.push(p);
  }
  if (seeds.length < 2) return [poly];
  let cells = [];
  for (let round = 0; round < 3; round++) {
    const vor = Delaunay.from(seeds).voronoi(box);
    cells = seeds.map((_, i) => {
      const c = vor.cellPolygon(i);
      if (!c) return null;
      const pieces = intersect([c.slice(0, -1)], [poly]);
      return pieces.reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
    });
    if (round < 2) seeds = seeds.map((s, i) => (cells[i] && area(cells[i]) > 0.5 ? centroid(cells[i]) : s));
  }
  return cells.filter((c) => c && area(c) > 2);
}

/** A compass word for a direction (the map's up is north): north, northeast, east... */
function compass(a) {
  const names = ["east", "southeast", "south", "southwest", "west", "northwest", "north", "northeast"];
  return names[Math.round(norm(a) / (Math.PI / 4)) % 8];
}
const cap = (w) => w[0].toUpperCase() + w.slice(1);

/**
 * Gives each ward a character by the city's geography, varied by seed: the market on the central square, a temple
 * beside it, docks on the water, the garrison by a gate (sometimes walled as a citadel), the nobles on the quiet side
 * upstream, crafts by the water downstream and near the gates, the poor by the wall, merchants along the main roads,
 * the rest homes. Sets each district's character and name. Returns the citadel ({ features }) or null.
 */
export function assignCharacters({ lead = null, allow = null, wantCitadel, districts, C, R, S, size, sea, lake, rivers, island, ringPoly, oldPoly, gateRoads, allRoads, squarePoly = null, harbor = true, r }) {
  if (!districts.length) return null;
  const metro = size === "metropolis";
  const shore = sea ?? lake;
  const river = rivers[0] ?? null;
  const flow = river ? [river.path[river.path.length - 1][0] - river.path[0][0], river.path[river.path.length - 1][1] - river.path[0][1]] : null;
  const fl = flow ? Math.hypot(...flow) || 1 : 1;
  const info = districts.map((d) => {
    const c = centroid(d.shape);
    const near = (path, m) => d.shape.filter((p) => distToPath(p, path) < m).length;
    return {
      d, c,
      center: Math.hypot(c[0] - C[0], c[1] - C[1]) / R,
      square: d.shape.some((p) => Math.hypot(p[0] - C[0], p[1] - C[1]) < S.square + 1.5) ? 1 : 0,
      wall: ringPoly && d.shape.some((p) => distToRing(p, ringPoly) < 0.6) ? 1 : 0,
      shore: shore ? near([...shore, shore[0]], 2.5) : 0,
      river: rivers.reduce((n, rv) => n + near(rv.path, widestOf(rv) / 25 / 2 + 1.6), 0),
      isle: island && inside(c, island) ? 1 : 0,
      gates: gateRoads.filter((rd) => d.shape.some((p) => distToPath(p, rd.path) < 0.3)).length,
      down: flow ? ((c[0] - C[0]) * flow[0] + (c[1] - C[1]) * flow[1]) / fl / R : 0,
      old: oldPoly ? (inside(c, oldPoly) ? 1 : 0) : 0,
      j: r.next(),
    };
  });
  const free = () => info.filter((w) => !w.d.character);
  const take = (n, score, character) => {
    if (allow && !allow.has(character)) return [];
    const picked = free().map((w) => ({ w, s: score(w) })).filter((x) => x.s > -Infinity).sort((a, b) => b.s - a.s).slice(0, n);
    for (const { w } of picked) w.d.character = character;
    return picked.map((x) => x.w);
  };
  const count = (lo, hi) => lo + r.int(hi - lo + 1);
  // A cathedral or palace asked for at the center: its ward takes the square first, its landmark placed toward it
  const led = lead ? take(1, (x) => x.square * 10 - x.center * 3 + x.j, lead) : [];
  for (const w of led) { w.d.anchorToward = [r1(C[0]), r1(C[1])]; w.d.anchorAt = "edge"; }
  // (the lead ward counts as one of its kind's)
  const less = (kind, n) => (lead === kind ? n - led.length : n);
  // The market and the temple at the heart of the city
  take(metro ? 2 : 1, (w) => w.square * 10 - w.center * 3 + w.j, "market");
  // (on the island, when the river splits around one)
  take(less("temple", metro ? 2 : 1), (w) => (w.center < 0.6 ? 5 : 0) + w.square * 2 - w.center * 3 + w.isle * 4 + w.j * 1.5, "temple");
  // Docks along the shore or the river
  // (on the river where the shore stays outside the wall: an estuary city whose sea lies off past its island)
  // (on the shore only where it has room for the harbor's quay inside the wall street)
  const onShore = shore && harbor ? take(metro ? count(2, 3) : count(1, 2), (w) => (w.shore ? w.shore * 2 + w.j : -Infinity), "docks") : [];
  if (!onShore.length && river) take(metro ? 2 : 1, (w) => (w.river ? w.river + w.j * 2 : -Infinity), "docks");
  // The garrison against the wall, by a gate, on the water if it can
  const garrison = take(metro ? count(1, 2) : 1, (w) => w.wall * 4 + w.gates * 2 + (w.shore || w.river ? 2 : 0) + w.center * 2 + w.j * 2, "garrison");
  // The nobles on the quiet side: off the main roads, upstream, away from the garrison and the docks
  take(less("nobles", metro ? count(2, 3) : count(1, 2)), (w) => -w.gates * 2 - w.down * 2 - w.wall + (w.old ? 1.5 : 0) - (w.center > 0.75 ? 2 : 0) + w.j * 2, "nobles");
  // Crafts by the water downstream and near the gates
  take(metro ? count(3, 4) : count(1, 2), (w) => (w.river ? 2 : 0) + w.down * 2 + w.gates + w.wall + w.j * 2, "crafts");
  // The poor by the wall, away from the nobles
  const nobles = info.filter((w) => w.d.character === "nobles");
  take(metro ? count(3, 4) : count(1, 2), (w) => w.wall * 3 + w.center * 2 + w.down + Math.min(...nobles.map((n) => Math.hypot(n.c[0] - w.c[0], n.c[1] - w.c[1])), 99) / R - (w.old ? 2 : 0) + w.j * 2, "poor");
  // Merchants along the main roads
  take(metro ? count(2, 3) : 1, (w) => w.gates * 2 - w.center + (w.old ? 1 : 0) + w.j * 2, "merchants");
  for (const w of free()) w.d.character = "homes";

  // Names: the ward's character, or for homes its side of the city
  const NAME = { market: "Market Ward", temple: "Temple Ward", docks: onShore.length ? "Harbor Ward" : "River Ward", garrison: "Garrison Ward", nobles: "High Ward", crafts: "Craft Ward", poor: "Low Ward", merchants: "Merchant Ward" };
  const used = new Map();
  // (the lead ward named first, so it's never its kind's "II")
  for (const w of [...led, ...info.filter((x) => !led.includes(x))]) {
    const base = w.d.character === "homes" ? (w.isle ? "Isle Ward" : `${cap(compass(Math.atan2(w.c[1] - C[1], w.c[0] - C[0])))} Ward`) : NAME[w.d.character];
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    w.d.name = n > 1 ? `${base} ${["", "", "II", "III", "IV", "V", "VI"][n] ?? n}` : base;
  }
  for (const w of info) if (w.d.character === "homes") delete w.d.character; // homes is the default

  // The citadel: often the garrison walled in on its own (a city about half the time, a metropolis mostly)
  const g = garrison[0];
  if (!g) return null;
  const roll = r.chance(metro ? 0.75 : 0.5);
  if (wantCitadel === false || (!roll && wantCitadel !== true)) return null;
  const reach = (12 / 2 + 15) / 25;
  // (in from its edge by the main road's half width, the wall's reach and its towers', so the road runs clear of it)
  // (and kept off the square, wall and towers both, where the ward reaches it)
  let pieces = offset([g.d.shape], -(reach + 0.6 + 1.2));
  if (squarePoly && pieces.length) pieces = difference(pieces, offset([squarePoly], reach + 1.2));
  const ring = pieces.reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
  if (!ring || area(ring) < 40) return null;
  const citadelWall = tidyRing(outline(ring));
  if (citadelWall.length < 3 || polygonCrossesItself(citadelWall)) return null;
  if (squarePoly && polygonsOverlap(citadelWall, squarePoly)) return null; // (a square in the ward's middle: no citadel around it)
  const wasNamed = g.d.name;
  g.d.name = "The Citadel";
  // Its gate: a street in to its middle from the nearest point of a road on its edge (a main road or a ward
  // street), running inside the ward all the way; with none, no citadel
  const mid = centroid(citadelWall);
  const near = (p) => inside(p, g.d.shape) || distToRing(p, g.d.shape) < 0.3;
  let from = null;
  for (const path of allRoads) for (const p of densify(path, 0.5)) {
    if (distToRing(p, g.d.shape) > 0.3) continue;
    if (from && Math.hypot(p[0] - mid[0], p[1] - mid[1]) >= Math.hypot(from[0] - mid[0], from[1] - mid[1])) continue;
    if (densify([p, mid], 0.4).every(near)) from = p;
  }
  if (!from) { g.d.name = wasNamed; return null; }
  const features = [
    { id: "citadel-wall", type: "wall", class: "town", path: [...citadelWall, citadelWall[0]], straight: true, outside: "none", towers: "roofed" },
    { id: "citadel-gate", type: "road", class: "street", surface: "cobble", path: [pt(from), pt(mid)] },
  ];
  return { features };
}

/** True when no point of `pts` lies inside any of polys. */
const clearOfAll = (pts, polys) => pts.every((p) => !polys.some((q) => inside(p, q)));

/**
 * Outside the walls: suburbs along the roads beyond about half the gates, farmsteads farther out, field systems
 * between the roads, and woods. Plan features.
 */
export function countryside({ choices, C, R, W, H, wallPoly, wall, roads, wet, inWater, rivers = [], r }) {
  const out = [];
  const metro = choices.size === "metropolis";
  // Kept off: the city (its wall and what lies outside it, a ditch or moat and towers) and the water
  const city = offset([wallPoly], 3.2).reduce((a, b) => (!a || area(b) > area(a) ? b : a), wallPoly);
  const onMap = (p) => p[0] > 1 && p[1] > 1 && p[0] < W - 1 && p[1] < H - 1;
  const suburbs = [];
  for (const rd of roads) {
    if (!r.chance(metro ? 0.85 : 0.6) || choices.suburbs === false) continue;
    // From just past the wall, along the road
    const pts = densify(rd.path, 0.5);
    const startI = pts.findIndex((p) => !inside(p, city));
    if (startI < 0) continue;
    const len = metro ? r.range(14, 22) : r.range(9, 15), half = r.range(4.5, 6.5);
    const along = [];
    let run = 0;
    for (let i = startI; i < pts.length && run <= len; i++) { along.push(pts[i]); if (i > startI) run += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); }
    if (run < len * 0.7) continue;
    // (the road's stretch buffered by Clipper, so a bend never twists the outline)
    let poly = bands([{ path: simplify(along, 0.1), half }])[0];
    if (!poly) continue;
    // Clear of the city, the water, the map's edge and the other suburbs
    const pieces = difference(intersect([poly], [[[1, 1], [W - 1, 1], [W - 1, H - 1], [1, H - 1]]]), [city, ...wet, ...suburbs]);
    const big = pieces.reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
    if (!big || area(big) < 30) continue;
    poly = tidyRing(simplify(outline(big), 0.15));
    if (poly.length < 3 || polygonCrossesItself(poly) || !pathTouchesPolygon(rd.path, poly)) continue; // (its road must still run into it)
    suburbs.push(poly);
    // (a quarter left out of the city isn't outside it either)
    const picked = r.pick(["poor", "poor", "crafts", "homes"]);
    const character = Array.isArray(choices.quarters) && !choices.quarters.includes(picked) ? "homes" : picked;
    let name = `${cap(compass(rd.angle))} Gate ${character === "poor" ? "Shanties" : character === "crafts" ? "Yards" : "Suburb"}`;
    for (let n = 2; out.some((f) => f.name === name); n++) name = `${name.replace(/ [IVX]+$/, "")} ${["", "", "II", "III", "IV", "V", "VI"][n] ?? n}`;
    out.push({ id: `suburb-${suburbs.length}`, type: "district", profile: "village", ...(character !== "homes" ? { character } : {}), name, shape: poly });
  }
  // Cemeteries outside the walls: one or two beside a main road past the suburbs (their own stream, so the rest is
  // unchanged)
  const graves = [];
  {
    const cr = r.fork("cemeteries"), want = choices.cemetery === false ? 0 : metro ? 2 : cr.chance(0.5) ? 2 : 1;
    const taken = [city, ...suburbs.map((p) => offset([p], 2)[0] ?? p), ...wet];
    for (let t = 0; t < 200 && graves.length < want; t++) {
      // (past the city and the suburbs along the road, somewhere along what's left of it)
      const rd = cr.pick(roads), pts = densify(rd.path, 0.5), out0 = pts.findIndex((p) => !inside(p, city));
      const i0 = out0 < 0 ? -1 : pts.findIndex((p, k) => k >= out0 && !suburbs.some((q) => inside(p, q) || distToRing(p, q) < 2));
      const i = i0 + 4 + cr.int(Math.max(1, Math.min(40, pts.length - i0 - 6))), side = cr.chance(0.5) ? 1 : -1;
      const w = metro ? cr.range(14, 22) : cr.range(10, 16), dd = metro ? cr.range(10, 14) : cr.range(7, 11);
      if (i0 < 0 || i + 1 >= pts.length) continue;
      const a = pts[i], b = pts[i + 1], u = [(b[0] - a[0]) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1), (b[1] - a[1]) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1)], n = [-u[1] * side, u[0] * side];
      const c = add(a, mul(n, 0.6 + 1.2 + dd / 2));
      const shape = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => pt(add(add(c, mul(u, (x * w) / 2)), mul(n, (y * dd) / 2))));
      const test = [c, ...densify([...shape, shape[0]], 1)];
      if (!test.every(onMap) || !clearOfAll(test, [...taken, ...graves]) || test.some((p) => inWater(p))) continue;
      if ([...taken, ...graves].some((q) => polygonsOverlap(q, shape))) continue;
      if (roads.some((rd2) => densify(rd2.path, 0.5).some((q) => inside(q, shape) || distToRing(q, shape) < 0.7))) continue;
      graves.push(shape);
      const name = `${cap(compass(Math.atan2(c[1] - C[1], c[0] - C[0])))} Burial Ground`;
      out.push({ id: `cemetery-${graves.length}`, type: "area", class: "cemetery", name: out.some((f) => f.name === name) ? `${name} II` : name, shape });
    }
  }
  // Mills (their own stream): a watermill on a race beside the river outside the walls (two in a metropolis), and
  // windmills out among the fields
  const mills = [];
  {
    const mr = r.fork("mills"), taken = [city, ...suburbs.map((p) => offset([p], 2)[0] ?? p), ...graves];
    const ok = (p, m) => onMap(p) && p[0] > 2 && p[1] > 2 && p[0] < W - 2 && p[1] < H - 2 && clearOfAll([p], taken) && taken.every((q) => distToRing(p, q) > m) && roads.every((rd) => distToPath(p, rd.path) > 0.6 + m + 3) && mills.every((c) => Math.hypot(c[0] - p[0], c[1] - p[1]) > 6);
    const wantWater = rivers.length && choices.mills !== false ? (metro ? 2 : 1) : 0;
    for (let k = 0, made = 0; k < wantWater * 2 && made < wantWater; k++) {
      const rv = rivers[k % rivers.length];
      const got = watermill({ water: { path: rv.path, width: widestOf(rv) }, ok: (p, m) => ok(p, m) && !inWater(p), want: (c) => distToRing(c, city) < R * 0.5, r: mr.fork("water", k), id: made ? `watermill-${made + 1}` : "watermill" });
      if (!got) continue;
      made++;
      out.push(...got);
      const [x0, y0, x1, y1] = got[1].shape.rect;
      mills.push([(x0 + x1) / 2, (y0 + y1) / 2]);
    }
    if ((choices.surroundings === "farmland" || choices.surroundings === "mixed") && choices.mills !== false) {
      const wr = mr.fork("wind"), want = (metro ? 3 : 2) + wr.int(2);
      for (let k = 0, made = 0; k < want * 3 && made < want; k++) {
        const spot = () => { const rd = wr.pick(roads), pts = densify(rd.path, 0.5), i0 = pts.findIndex((p) => !inside(p, city)); if (i0 < 0) return null; const i = Math.min(pts.length - 2, i0 + 10 + wr.int(50)), a = pts[i], b = pts[i + 1], d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...d) || 1, side = wr.chance(0.5) ? 1 : -1, off = 0.6 + wr.range(4, 9); return [a[0] - (d[1] / l) * side * off, a[1] + (d[0] / l) * side * off]; };
        const got = windmill({ ok: (p, m) => onMap(p) && clearOfAll([p], taken) && taken.every((q) => distToRing(p, q) > m + 2) && roads.every((rd) => distToPath(p, rd.path) > 0.6 + m + 0.5) && mills.every((c) => Math.hypot(c[0] - p[0], c[1] - p[1]) > 8) && !inWater(p) && !wet.some((q) => distToRing(p, q) < 1.5), spot, r: wr.fork(k), id: made ? `windmill-${made + 1}` : "windmill" });
        if (!got) continue;
        made++;
        out.push(...got);
        const [x0, y0, x1, y1] = got[0].shape.rect;
        mills.push([(x0 + x1) / 2, (y0 + y1) / 2]);
      }
    }
  }
  if (choices.surroundings === "open") return out;
  const farmish = choices.surroundings === "farmland" || choices.surroundings === "mixed";
  const woodish = choices.surroundings === "woodland" || choices.surroundings === "mixed";
  const builtUp = [city, ...suburbs.map((p) => offset([p], 1.5)[0] ?? p), ...graves.map((p) => offset([p], 1.5)[0] ?? p), ...mills.map((c) => [[c[0] - 4, c[1] - 4], [c[0] + 4, c[1] - 4], [c[0] + 4, c[1] + 4], [c[0] - 4, c[1] + 4]])];
  const roadClear = (p, m) => roads.every((rd) => distToPath(p, rd.path) > 0.6 + m);

  // Farmsteads beside the roads, beyond the suburbs
  const farms = [];
  const want = farmish ? (metro ? 6 : 4) + r.int(3) : r.int(2);
  for (let t = 0; t < 300 && farms.length < want; t++) {
    const rd = r.pick(roads), i = 1 + r.int(rd.path.length - 1);
    const a = rd.path[i - 1], b = rd.path[i], k = r.next();
    const on = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...d) || 1;
    const c = add(on, mul([-d[1] / l, d[0] / l], (r.chance(0.5) ? 1 : -1) * r.range(4, 5.5)));
    const size = 4.6;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => add(c, [(x * size) / 2, (y * size) / 2]));
    const ring = [c, ...corners];
    if (!ring.every(onMap) || !clearOfAll(ring, [...builtUp, ...wet]) || !ring.every((p) => roadClear(p, 1)) || ring.some((p) => inWater(p))) continue;
    if (builtUp.some((q) => distToRing(c, q) < 4)) continue;
    if (farms.some((f) => Math.hypot(f[0] - c[0], f[1] - c[1]) < size * 2.5)) continue;
    farms.push(c);
    out.push({ id: `farm-${farms.length}`, type: "area", class: "farmstead", shape: { rect: [r1(c[0] - size / 2), r1(c[1] - size / 2), r1(c[0] + size / 2), r1(c[1] + size / 2)] }, rot: Math.round(r.range(-15, 15)) });
  }

  // Fields in the wedges of land between the main roads, the city and its suburbs left out (the layout keeps them off
  // the roads, the water and the farmyards too)
  const sorted = [...roads].sort((a, b) => a.angle - b.angle);
  const reachOut = choices.surroundings === "farmland" ? Math.hypot(W, H) : R * r.range(1.9, 2.3);
  sorted.forEach((rd, k) => {
    const next = sorted[(k + 1) % sorted.length];
    const a0 = rd.angle, a1 = next.angle + (next.angle <= rd.angle ? 2 * Math.PI : 0);
    const keep = r.next();
    if (choices.surroundings === "woodland" ? keep > 0.3 : keep > 0.8) return; // not every wedge: some stay rough grass
    const arc = [];
    for (let t = a0; t <= a1; t += 0.15) arc.push(add(C, mul(dirOf(t), reachOut * r.range(0.9, 1.1))));
    const wedge = [C, ...arc, add(C, mul(dirOf(a1), reachOut))];
    const pieces = difference(intersect([wedge], [[[0, 0], [W, 0], [W, H], [0, H]]]), [...builtUp, ...wet]);
    const big = pieces.reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
    if (!big || area(big) < 120) return;
    const shape = tidyRing(outline(big));
    if (shape.length >= 3 && !polygonCrossesItself(shape)) out.push({ id: `fields-${compass((a0 + a1) / 2)}`, type: "area", class: "fields", shape });
  });
  // Ids made unique (two wedges on one side)
  const seenId = new Map();
  for (const f of out) { const n = (seenId.get(f.id) ?? 0) + 1; seenId.set(f.id, n); if (n > 1) f.id = `${f.id}-${n}`; }

  // Woods toward the edges, clear of everything
  const woods = [];
  const wantWoods = woodish ? (metro ? 5 : 3) + r.int(3) : r.int(2);
  const fieldPolys = out.filter((f) => f.class === "fields").map((f) => f.shape);
  for (let t = 0; t < 400 && woods.length < wantWoods; t++) {
    const rad = r.range(5, metro ? 12 : 9);
    const c = [r.range(2, W - 2), r.range(2, H - 2)];
    const blob = [];
    for (let k = 0; k < 12; k++) { const a = (k / 12) * 2 * Math.PI, rr = rad * r.range(0.7, 1.15); blob.push([Math.max(0, Math.min(W, c[0] + Math.cos(a) * rr * 1.2)), Math.max(0, Math.min(H, c[1] + Math.sin(a) * rr))]); }
    const test = [c, ...blob];
    if (!clearOfAll(test, [...builtUp, ...wet, ...fieldPolys]) || fieldPolys.some((f) => polygonsOverlap(f, blob)) || !test.every((p) => roadClear(p, 1)) || roads.some((rd) => densify(rd.path, 0.5).some((q) => inside(q, blob)))) continue;
    if (builtUp.some((q) => distToRing(c, q) < rad + 3) || farms.some((f) => Math.hypot(f[0] - c[0], f[1] - c[1]) < rad + 5)) continue;
    if (woods.some((w) => Math.hypot(w.c[0] - c[0], w.c[1] - c[1]) < w.rad + rad + 3)) continue;
    woods.push({ c, rad });
    out.push({ id: `woods-${woods.length}`, type: "area", class: "woods", shape: outline(blob) });
  }
  return out;
}

/**
 * Where a harbor's quay goes: the longest unbroken run of the shore inside the wall street, a square off the map's
 * edge and clear of the river's mouth (a point every half square), or null when that's too short for one.
 */
export function harborRun({ shore, ringPoly, river, W, H }) {
  if (!shore || !ringPoly) return null;
  const mouth = river ? widestOf(river) / 25 / 2 + 2 : 0;
  const edge = densify([...shore, shore[0]], 0.5).filter((p) => inside(p, ringPoly) && p[0] > 1 && p[1] > 1 && p[0] < W - 1 && p[1] < H - 1 && !(river && distToPath(p, river.path) < mouth)); // (not across the river's mouth)
  const runs = [];
  let cur = null, last = null;
  for (const p of edge) { if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.8) { cur = []; runs.push(cur); } cur.push(p); last = p; }
  const quay = runs.reduce((a, b) => (!a || b.length > a.length ? b : a), null);
  return quay && quay.length > 8 ? quay : null;
}

/** A river's width in feet at each point of its path: its widths, or its width eased to its endWidth along it. */
export function feetOf(rv) {
  if (Array.isArray(rv.widths) && rv.widths.length === rv.path.length) return rv.widths;
  const at = [0];
  for (let i = 1; i < rv.path.length; i++) at.push(at[i - 1] + Math.hypot(rv.path[i][0] - rv.path[i - 1][0], rv.path[i][1] - rv.path[i - 1][1]));
  const L = at[at.length - 1] || 1;
  return rv.path.map((_, i) => (Number.isFinite(rv.endWidth) ? rv.width + (rv.endWidth - rv.width) * (at[i] / L) : rv.width));
}
export const widestOf = (rv) => Math.max(...feetOf(rv));
/** Length along a path at each of its points. */
function along(path) {
  const at = [0];
  for (let i = 1; i < path.length; i++) at.push(at[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  return at;
}
/** The unit normal at each point of a path (square to the line through its neighbors). */
const normals = (path) => path.map((_, i) => {
  const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)], d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...d) || 1;
  return [-d[1] / l, d[0] / l];
});
/** A path simplified in pieces split at the given indexes, so those points stay exactly where they are. */
function simplifyKeeping(path, at, tol = 0.08) {
  const cuts = [0, ...[...new Set(at)].filter((i) => i > 0 && i < path.length - 1).sort((a, b) => a - b), path.length - 1];
  const out = [];
  for (let k = 1; k < cuts.length; k++) out.push(...simplify(path.slice(cuts[k - 1], cuts[k] + 1), tol).slice(k > 1 ? 1 : 0));
  return out;
}
/** True when two paths cross, skipping the first `skip` segments of a (where it leaves b on purpose). */
export function pathsCross(a, b, skip = 0) {
  for (let i = 1 + skip; i < a.length; i++) for (let j = 1; j < b.length; j++) if (segCross(a[i - 1], a[i], b[j - 1], b[j])) return true;
  return false;
}
/** The stretches of a path on the map (each cut where it leaves it). */
export function onMapRuns(path, W, H) {
  const ok = (p) => p[0] >= 0 && p[1] >= 0 && p[0] <= W && p[1] <= H;
  const edge = (a, b) => {
    let t = 1;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (b[0] < 0) t = Math.min(t, -a[0] / dx);
    if (b[0] > W) t = Math.min(t, (W - a[0]) / dx);
    if (b[1] < 0) t = Math.min(t, -a[1] / dy);
    if (b[1] > H) t = Math.min(t, (H - a[1]) / dy);
    return [a[0] + dx * t, a[1] + dy * t];
  };
  const runs = [];
  let cur = null;
  path.forEach((p, i) => {
    if (ok(p)) {
      if (!cur) { cur = i && !ok(path[i - 1]) ? [edge(p, path[i - 1])] : []; runs.push(cur); }
      cur.push(p);
    } else if (cur) { cur.push(edge(path[i - 1], p)); cur = null; }
  });
  return runs.filter((r) => r.length >= 2 && along(r).at(-1) > 6);
}

/**
 * A city's running water in one of RIVER_FORMS (one that can't be made falls back to a meander). A river meeting the
 * sea runs from inland to a square and a half past the coast, widening as it goes. Returns { rivers (plan water
 * features, the main river first), island (the polygon between two arms, or null), form (the one made) }.
 */
export function riverForm({ form, water, r, C, R, W, H, S, radiusAt, riverAngle, sea, bendSize = R }) {
  const width = Math.round(r.range(55, 80)), half = width / 25 / 2;
  const estuary = water === "estuary" && !!sea;
  const endWidth = estuary ? Math.round(width * r.range(1.8, 2.6)) : null;
  const U = dirOf(riverAngle), V = [-U[1], U[0]];
  /** Cut where it reaches the sea: a square and a half past the coast. */
  const toSea = (path) => {
    if (!estuary) return path;
    const dense = densify(path, 0.5), i = dense.findIndex((p) => inside(p, sea));
    return i > 1 ? simplify(dense.slice(0, Math.min(dense.length, i + 3)), 0.02) : path;
  };
  const main = (path, extra = {}) => ({ id: "river", type: "water", class: "river", width, ...(endWidth && !extra.widths ? { endWidth } : {}), ...extra, path });
  // The main line: bending through the city a little off its center, clear of the central square (through: across
  // the center, gently, to split around an island there)
  const line = (through) => {
    let best = null, bestClear = -Infinity;
    for (let t = 0; t < 24; t++) {
      const b = bends(r, through ? R : bendSize, { gentle: through }); // (shorter bends along a long city or by a cliff, so it keeps to its course)
      if (through) { b.swing2 *= 0.35; b.wave2 *= 1.5; }
      const off = through ? R * r.range(-0.06, 0.06) : (r.chance(0.5) ? 1 : -1) * R * r.range(0.15, 0.32);
      const path = toSea(meander(add(C, mul(V, off)), riverAngle, W, H, b));
      if (through) return path;
      const clear = Math.min(...densify(path, 0.5).map((p) => Math.hypot(p[0] - C[0], p[1] - C[1])));
      if (clear >= S.square * 1.55 + half + 3) return path; // (a rectangle square's corner reaches 1.51 times its radius)
      if (clear > bestClear) { bestClear = clear; best = path; }
    }
    return best;
  };
  const meanderOnly = () => ({ rivers: [main(simplify(line(false), 0.08))], island: null, form: "meander" });

  if (form === "island") {
    // Two arms around an island at the city's heart, the square on it (clear of both arms, or another try)
    const armW = Math.round(width * r.range(0.6, 0.72)), armHalf = armW / 25 / 2;
    for (let t = 0; t < 8; t++) {
      const M = line(true);
      const at = along(M), target = C;
      let k = 0;
      M.forEach((p, i) => { if (Math.hypot(p[0] - target[0], p[1] - target[1]) < Math.hypot(M[k][0] - target[0], M[k][1] - target[1])) k = i; });
      const L = R * r.range(0.55, 0.8), w = Math.max(S.square + armHalf + 3.7, R * r.range(0.22, 0.3));
      const stop = estuary ? at.at(-1) - (endWidth / 25) * 2 - 6 : Infinity;
      let i0 = at.findIndex((s) => s >= at[k] - L), i1 = at.findLastIndex((s) => s <= Math.min(at[k] + L, stop));
      if (i0 < 1 || i1 > M.length - 2 || i1 - i0 < 8) continue;
      const n = normals(M), span = at[i1] - at[i0];
      const off = (i) => w * Math.sin((Math.PI * (at[i] - at[i0])) / span) ** 0.8; // (a full lens)
      const A = M.map((p, i) => (i > i0 && i < i1 ? add(p, mul(n[i], off(i))) : p));
      const B = M.slice(i0, i1 + 1).map((p, j) => (j > 0 && j < i1 - i0 ? add(p, mul(n[i0 + j], -off(i0 + j))) : p));
      const island = [...A.slice(i0, i1 + 1), ...B.slice(1, -1).reverse()];
      // (the square, as big as a rectangle's corner reaches, on the island and clear of both arms' water)
      const sqReach = S.square * 1.55 + 1;
      if (!inside(C, island) || [A, B].some((arm, j) => densify(arm, 0.5).some((p, i) => Math.hypot(p[0] - C[0], p[1] - C[1]) < sqReach + (j ? armHalf : Math.max(half, armHalf))))) continue;
      if (polygonCrossesItself(island) || pathsCross(A.slice(0, i0), B.slice(1)) || pathsCross(A.slice(i1 + 1), B.slice(0, -1))) continue;
      // Each arm narrower than the river above and below the island (the main river eased out to the sea)
      const keep = simplifyKeeping(A.map((p, i) => [...p, i]), [i0, i1]);
      const share = along(keep), Ls = share.at(-1) || 1;
      const ft = keep.map((p, j) => {
        const i = p[2], w0 = i > i0 && i < i1 ? armW : width;
        return Math.round(endWidth ? w0 * (1 + (endWidth / width - 1) * (share[j] / Ls)) : w0);
      });
      const path = keep.map((p) => [p[0], p[1]]);
      const arm = { id: "river-arm", type: "water", class: "river", width: armW, path: simplify(B, 0.08) };
      return { rivers: [main(path, { widths: ft }), arm], island, form };
    }
    return meanderOnly();
  }

  if (form === "meeting") {
    // A smaller river joining it inside the walls, from upstream at an angle
    const tribW = Math.round(width * r.range(0.5, 0.68)), tHalf = tribW / 25 / 2;
    for (let t = 0; t < 12; t++) {
      const M = line(false), at = along(M);
      const ok = M.map((p, i) => {
        const d = Math.hypot(p[0] - C[0], p[1] - C[1]);
        return i > 2 && i < M.length - 3 && d > R * 0.22 && d < R * 0.7 && d > S.square + half + 4 && at.at(-1) - at[i] > 10 && !(sea && inside(p, sea));
      }).map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
      if (!ok.length) continue;
      const j = ok[r.int(ok.length)];
      const d = [M[j + 1][0] - M[j - 1][0], M[j + 1][1] - M[j - 1][1]];
      const back = Math.atan2(d[1], d[0]) + Math.PI + (r.chance(0.5) ? 1 : -1) * r.range(0.6, 1.1);
      const b = bends(r, R * 0.7);
      b.swing *= 0.6;
      const T = meander(M[j], back, W, H, b, { oneWay: true });
      const Ta = along(T), clearFrom = (half + tHalf + 3) / Math.sin(0.6) + 2;
      if (Ta.at(-1) < R * 0.8) continue;
      if (T.some((p, i) => Ta[i] > clearFrom && (distToPath(p, M) < half + tHalf + 3 || (sea && inside(p, sea))))) continue;
      if (densify(T, 0.5).some((p) => Math.hypot(p[0] - C[0], p[1] - C[1]) < S.square + tHalf + 3)) continue;
      if (pathsCross(T, M, 2)) continue;
      // (below the meeting the river carries both: as wide as the two together would be, the root of their squares'
      // sum, as a river's width goes with the root of the water it carries; widening on to the sea at an estuary)
      const keep = simplifyKeeping(M.map((p, i) => [...p, i]), [j]);
      const below = Math.round(Math.hypot(width, tribW)), share = along(keep), Ls = share.at(-1) || 1;
      const ft = keep.map((p, k) => { const w0 = p[2] > j ? below : width; return Math.round(endWidth ? w0 * (1 + (endWidth / width - 1) * (share[k] / Ls)) : w0); });
      const trib = { id: "river-2", type: "water", class: "river", width: tribW, path: simplify([...T].reverse(), 0.08) };
      return { rivers: [main(keep.map((p) => [p[0], p[1]]), { widths: ft }), trib], island: null, form };
    }
    return meanderOnly();
  }

  if (form === "loop") {
    // Around the city just outside its wall, all but across a neck of land turned toward the side with the most room
    // (the wall's corners stand up to 3% out, then its towers, the river's half width and its bank)
    const need = (a) => radiusAt(a) * 1.03 + 12 / 25 / 2 + 0.9 + half + 1.2 + 0.3;
    const room = (a) => toEdge(C, dirOf(a), W, H) - 1.5;
    const dTheta = 1.5 / (R * 1.1);
    const spread = r.range(0.4, 0.6);
    const necks = Array.from({ length: 16 }, (_, k) => {
      const n = (k / 16) * TAU;
      let worst = -Infinity;
      for (let a = n + spread; a <= n + TAU - spread; a += 0.1) worst = Math.max(worst, need(a) + 2 - room(a));
      return { n, worst };
    });
    const fits = necks.filter((x) => x.worst <= 0);
    const order = fits.length ? r.shuffle(fits) : necks.sort((a, b) => a.worst - b.worst);
    for (const { n } of order.slice(0, 6)) {
      const gap = r.range(0.3, 1.2), ph = r.next() * TAU, lobe = R * r.range(0.02, 0.05), a0 = n + spread, a1 = n + TAU - spread;
      const arc = [];
      for (let a = a0; a <= a1 + 1e-9; a += dTheta) {
        const e = Math.min(a - a0, a1 - a);
        // (close around the wall, as a city sits tight inside its river's bend)
        let rho = need(a) + gap + lobe * (1 + Math.sin(2 * a + ph * 3)) + 0.6 * (1 + Math.sin(3 * a + ph)) + 0.3 * (1 + Math.sin(7 * a + ph * 2));
        if (e < 0.4) rho += R * 0.4 * (1 - e / 0.4) ** 2; // (its ends turning out from the city)
        arc.push(add(C, mul(dirOf(a), Math.min(rho, Math.max(need(a), room(a))))));
      }
      const legB = bends(r, R * 0.8);
      legB.swing *= 0.5;
      const leg1 = meander(arc[0], a0 + 0.3, W, H, legB, { oneWay: true });
      const leg2 = meander(arc[arc.length - 1], a1 - 0.3, W, H, { ...legB, phase: legB.phase + 1.7 }, { oneWay: true });
      if (pathsCross(leg1, leg2, 1) || pathsCross(leg1, arc.slice(2), 1) || pathsCross(leg2, arc.slice(0, -2), 1)) continue;
      const full = [...[...leg1].reverse(), ...arc.slice(1), ...leg2.slice(1)];
      const runs = onMapRuns(full, W, H).map((p) => simplify(p, 0.08));
      if (!runs.length) continue;
      runs.sort((a, b) => along(b).at(-1) - along(a).at(-1));
      return { rivers: runs.map((p, k) => (k ? { id: `river-${k + 1}`, type: "water", class: "river", width, path: p } : main(p))), island: null, form };
    }
    return meanderOnly();
  }
  return meanderOnly();
}

/** The biggest of some polygons, or null. */
export const biggest = (ps) => (ps ?? []).reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);

/**
 * A closed outline cut off along a line, as an open run: from where it leaves the line around to where it comes
 * back. Returns { path, side (its outside, for a wall: away from the inside) } or null when it never touches the line.
 */
export function openRun(poly, line) {
  const n = poly.length, on = poly.map((p) => distToPath(p, line) < 0.15);
  const start = on.findIndex((v, i) => v && !on[(i + 1) % n]);
  if (start < 0) return null;
  const path = [poly[start]];
  for (let k = 1; k <= n; k++) { const i = (start + k) % n; path.push(poly[i]); if (on[i]) break; }
  // The inside is on its left when a point just left of its first stretch's middle lies inside
  const [a, b] = path, l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, m = [(a[0] + b[0]) / 2 + ((b[1] - a[1]) / l) * 0.3, (a[1] + b[1]) / 2 - ((b[0] - a[0]) / l) * 0.3];
  return { path, side: inside(m, poly) ? "right" : "left" };
}

/** A polygon grown by m (the biggest piece). */
export function grown(poly, m) {
  return offset([poly], m).reduce((a, b) => (!a || area(b) > area(a) ? b : a), null) ?? poly;
}

/**
 * An outline without a point visited twice (snapping shared corners together can pinch off a sliver: the bigger loop
 * is kept) or a spike (a corner it runs out to and straight back from), rounded again.
 */
export function tidyRing(poly) {
  let pts = poly.slice();
  for (let guard = 0; guard < 20; guard++) {
    const seen = new Map();
    let cut = null;
    for (let i = 0; i < pts.length && !cut; i++) {
      const k = `${pts[i][0]},${pts[i][1]}`;
      if (seen.has(k)) cut = [seen.get(k), i];
      else seen.set(k, i);
    }
    if (!cut) break;
    const [i, j] = cut;
    const a = pts.slice(i, j), b = [...pts.slice(j), ...pts.slice(0, i)];
    pts = area(a) >= area(b) ? a : b;
  }
  // Spikes: a corner where the outline runs out and straight back (along a side, or a hair beside it)
  for (let changed = true; changed && pts.length > 3; ) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const p = pts[(i + pts.length - 1) % pts.length], c = pts[i], n = pts[(i + 1) % pts.length];
      const ax = p[0] - c[0], ay = p[1] - c[1], bx = n[0] - c[0], by = n[1] - c[1];
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la < 1e-9 || lb < 1e-9) { pts.splice(i, 1); changed = true; i--; continue; }
      const cos = (ax * bx + ay * by) / (la * lb), gap = Math.abs(ax * by - ay * bx) / Math.max(la, lb);
      // (or turns back sharply onto the line it came out along: a neighbor a hair off the other side)
      if ((cos > 0.94 && gap < 0.35) || (cos > 0.5 && (distToSeg(n, p, c) < 0.12 || distToSeg(p, c, n) < 0.12))) { pts.splice(i, 1); changed = true; i--; }
    }
  }
  return outline(pts);
}
