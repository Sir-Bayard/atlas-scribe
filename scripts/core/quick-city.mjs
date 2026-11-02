/**
 * Quick Start for a city or a metropolis: a walled city cut into wards. A wall outline around a center, main roads from
 * the center out through its gates, a street just inside the wall, and the inside cut into wards (Voronoi cells
 * between the main roads, each an ordinary district) whose edges are streets. The water is a river through it, a sea
 * coast with a harbor, a lake shore, or a river meeting the sea. Everything comes out as plan features, so rerolls,
 * locks and reshaping work as on any plan. Pure: runs anywhere. Numbers are in squares (25 ft).
 */
import { rng } from "./rng.mjs";
import { Delaunay } from "../../vendor/d3-delaunay.mjs";
import { intersect, difference, union, offset, area, centroid, bands } from "./lots/poly.mjs";
import { pathTouchesPolygon, polygonCrossesItself, polygonsOverlap, shapeToPolygon } from "./geom.mjs";
import { meander, bends } from "./meander.mjs";
import { watermill, windmill } from "./mills.mjs";
import { PAVINGS, squareShape } from "./squares.mjs";
import { cliffOf, cliffWidth, offsetLine } from "./cliffs.mjs";

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

const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dirOf = (rad) => [Math.cos(rad), Math.sin(rad)];
const r1 = (v) => Math.round(v * 10) / 10;
const pt = (p) => [r1(p[0]), r1(p[1])];
const TAU = 2 * Math.PI;
/** An angle brought into [0, 2pi). */
const norm = (a) => ((a % TAU) + TAU) % TAU;
/** How far apart two angles are, either way around. */
const apart = (a, b) => { const d = Math.abs(norm(a) - norm(b)); return Math.min(d, TAU - d); };

function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
}
const distToPath = (p, path) => path.slice(1).reduce((m, q, i) => Math.min(m, distToSeg(p, path[i], q)), Infinity);
const distToRing = (p, poly) => distToPath(p, [...poly, poly[0]]);
function inside(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** A path with a point at least every step squares. */
function densify(path, step) {
  return path.flatMap((p, i) => {
    if (!i) return [p];
    const q = path[i - 1], n = Math.max(1, Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / step));
    return Array.from({ length: n }, (_, k) => [q[0] + ((p[0] - q[0]) * (k + 1)) / n, q[1] + ((p[1] - q[1]) * (k + 1)) / n]);
  });
}
/** Where segment a-b crosses segment c-d, or null. */
function segCross(a, b, c, d) {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - a[0], qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + rx * t, a[1] + ry * t] : null;
}
function crossings(a, b) {
  const out = [];
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) { const h = segCross(a[i - 1], a[i], b[j - 1], b[j]); if (h) out.push(h); }
  return out;
}
/** How far along dir from c to the map's edge. */
function toEdge(c, dir, W, H) {
  const ts = [];
  if (dir[0] > 1e-9) ts.push((W - c[0]) / dir[0]);
  if (dir[0] < -1e-9) ts.push(-c[0] / dir[0]);
  if (dir[1] > 1e-9) ts.push((H - c[1]) / dir[1]);
  if (dir[1] < -1e-9) ts.push(-c[1] / dir[1]);
  return Math.max(0, Math.min(...ts));
}
/** A wandering line from start along dir to the map's edge (a point every step, pushed sideways at most amp). */
function wander(r, start, dir, W, H, { step = 8, amp = 2 } = {}) {
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
function outline(poly) {
  const out = [];
  for (const p of poly.map(pt)) if (!out.length || out[out.length - 1][0] !== p[0] || out[out.length - 1][1] !== p[1]) out.push(p);
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}
/** The pieces of a path outside every polygon in polys (sampled every half square), each at least min long. */
function pathOutside(path, polys, min = 1) {
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
function simplify(path, tol) {
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
 * water from CITY_WATER, roads, center, surroundings, season); seed; the name.
 */
export function cityPlan(choices, seed) {
  const S = CITY_SIZES[choices.size];
  const [W, H] = S.squares;
  const r = rng(seed, "quick", "city");
  const winter = choices.season === "winter";
  const water = CITY_WATER.includes(choices.water) ? choices.water : "river";
  const features = [];
  const C0 = [W / 2 + r.range(-0.05, 0.05) * W, H / 2 + r.range(-0.05, 0.05) * H];
  const R = S.R;
  // Its outline (one that doesn't go with its water is lobed), from a stream of its own, so a compact city draws as
  // it always has
  const shape = CITY_SHAPES.includes(choices.shape) && SHAPE_WATER[choices.shape].includes(water) ? choices.shape : choices.shape ? "lobed" : "compact";
  const sp = rng(seed, "quick", "city-shape");

  // Which way the sea or the lake lies, and the river's line
  let seaward = r.next() * TAU;
  let riverAngle = water === "estuary" ? seaward + r.range(-0.4, 0.4) : r.next() * Math.PI;
  // (a long city lies along the map's long side, and its shore or river with it)
  if (shape === "shore") {
    if (water === "river") riverAngle = sp.range(-0.3, 0.3);
    else {
      seaward = (sp.chance(0.5) ? 1 : -1) * (Math.PI / 2) + sp.range(-0.3, 0.3);
      if (water === "estuary") riverAngle = seaward + sp.range(-0.3, 0.3);
    }
  }
  // (a city on a promontory sits a little out to sea from the map's middle, so there's room for the country behind)
  const C = shape === "promontory" ? add(C0, mul(dirOf(seaward), R * 0.25)) : C0;

  // The wall: a ring of straight runs between corners, its radius swelling and narrowing slowly around the city
  const a2 = r.range(0.04, 0.1), p2 = r.next() * TAU, a3 = r.range(0.03, 0.07), p3 = r.next() * TAU, stretch = r.range(1, 1.18), tilt = r.next() * Math.PI;
  // A lobed city swells and narrows more, in more lobes; a long one is an ellipse along its shore or river
  const lobes = shape === "lobed" ? [[sp.range(0.1, 0.18), 2], [sp.range(0.08, 0.14), 3], [sp.range(0.05, 0.1), 4], [sp.range(0.03, 0.06), 5]].map(([amp, n]) => [amp, n, sp.next() * TAU]) : [];
  const longWay = water === "river" ? riverAngle : seaward + Math.PI / 2;
  const longR = Math.min(R * sp.range(1.4, 1.6), toEdge(C, dirOf(longWay), W, H) - 16, toEdge(C, dirOf(longWay + Math.PI), W, H) - 16), shortR = R * sp.range(0.68, 0.76);
  const radiusAt = (a) => {
    if (shape === "shore") return (1 / Math.hypot(Math.cos(a - longWay) / longR, Math.sin(a - longWay) / shortR)) * (1 + a3 * 0.5 * Math.sin(3 * a + p3));
    const along = Math.cos(a - tilt) ** 2 * stretch + Math.sin(a - tilt) ** 2; // a little longer one way
    let k = 1 + a2 * Math.sin(2 * a + p2) + a3 * Math.sin(3 * a + p3);
    for (const [amp, n, ph] of lobes) k += amp * Math.sin(n * a + ph);
    return R * along * Math.max(0.55, k);
  };
  const corners = (choices.size === "metropolis" ? 22 + r.int(6) : 14 + r.int(5)) + (shape === "lobed" || shape === "shore" ? 6 + sp.int(4) : 0);
  let wallPoly = Array.from({ length: corners }, (_, k) => {
    const a = (k + r.range(-0.3, 0.3)) * (TAU / corners);
    return pt(add(C, mul(dirOf(a), radiusAt(a) * r.range(0.97, 1.03))));
  });

  // A promontory: the land around the city's middle, smaller than its wall (so the wall stands in the water but where
  // it crosses the neck), and a neck of land back to the shore
  const headland = shape === "promontory" ? (() => {
    const U = dirOf(seaward), V = [-U[1], U[0]], f = sp.range(0.8, 0.86), nw = R * sp.range(0.3, 0.42);
    const blob = Array.from({ length: 36 }, (_, k) => { const a = (k / 36) * TAU; return add(C, mul(dirOf(a), radiusAt(a) * f * sp.range(0.97, 1.03))); });
    const neck = [];
    for (let s = 0; s <= R * 3; s += 4) neck.push(add(add(C, mul(U, -s)), mul(V, nw * (1 + 0.6 * (s / (R * 3)) ** 2) * sp.range(0.92, 1.08))));
    for (let s = R * 3; s >= 0; s -= 4) neck.push(add(add(C, mul(U, -s)), mul(V, -nw * (1 + 0.6 * (s / (R * 3)) ** 2) * sp.range(0.92, 1.08))));
    return union([blob, neck]);
  })() : null;

  // The river's form, the choice's or picked by the seed (first, since a river meeting the sea around an island needs
  // the coast farther off: the island and the square on it lie between the city's middle and the sea)
  let form = null;
  if (water === "river" || water === "estuary") {
    const forms = water === "estuary" ? ["meander", "island", "meeting"] : SHAPE_FORMS[shape] ?? RIVER_FORMS;
    // (a loop can't reach the sea: it bends through instead)
    form = choices.river === "loop" && water === "estuary" ? "meander" : forms.includes(choices.river) ? choices.river : forms[rng(seed, "quick", "river-form").int(forms.length)];
  }

  // Water as polygons (to keep the wards off it) and as plan features
  const wet = []; // polygons nothing is built in
  let river = null, sea = null, lake = null;
  let made = null; // (an estuary's river around an island, made with its coast)
  if (water === "coast" || water === "estuary") {
    // A coast across the map, square to the seaward direction, cutting the city a good way out from the center
    // (behind the middle, for a promontory: the sea all around it but its neck)
    const coast = (cr, extra) => {
      const d0 = R * cr.range(0.5, 0.72), d = headland ? -R * sp.range(0.95, 1.1) : d0 + extra, U = dirOf(seaward), V = [-U[1], U[0]];
      const mid = add(C, mul(U, d));
      const span = Math.hypot(W, H);
      const line = [];
      let off = 0;
      for (let s = -span; s <= span; s += 6) { off = Math.max(-3, Math.min(3, off + cr.range(-1.5, 1.5))); line.push(add(add(mid, mul(V, s)), mul(U, off))); }
      const far = line.map((p) => add(p, mul(U, span))).reverse();
      const clip = intersect([[...line, ...far]], [[[0, 0], [W, 0], [W, H], [0, H]]]);
      const big = clip.reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
      const open = big && headland ? biggest(difference([big], headland)) : big;
      return open ? outline(open) : null;
    };
    if (water === "estuary" && form === "island" && !headland) {
      // (an island and the square on it between the middle and the sea: the coast moved out only as far as the island
      // needs, so most such cities keep their harbor inside the wall)
      for (const extra of [0, 0.15, 0.3, 0.45]) {
        sea = coast(r.fork("coast", extra), R * extra);
        made = riverForm({ form, water, r: rng(seed, "quick", "river"), C, R, W, H, S, radiusAt, riverAngle, sea, bendSize: shape === "shore" || shape === "cliff" ? R * 0.6 : R });
        if (made.form === "island") break;
      }
    } else sea = coast(r, 0);
    if (sea) {
      wet.push(grown(sea, 0.5)); // (the layout curves and roughens a body's shore by up to half a square)
      features.push({ id: "sea", type: "water", class: "sea", shape: sea });
    }
  }
  if (water === "lake") {
    const U = dirOf(seaward);
    let ra = R * r.range(0.6, 0.8), rb = ra * r.range(0.6, 0.85), spin = seaward + r.range(-0.6, 0.6);
    let lc = add(C, mul(U, R * r.range(0.95, 1.15) + rb * 0.3));
    // (a promontory's lake wraps around it: wide across, its middle just out from the city's)
    if (headland) { ra = R * sp.range(1.25, 1.35); rb = R * sp.range(0.98, 1.08); spin = seaward + Math.PI / 2; lc = add(C, mul(U, R * 0.1)); }
    // (a long city's lake lies along it, its near shore well into the city's side)
    else if (shape === "shore") { ra = longR * sp.range(1.0, 1.15); rb = R * sp.range(0.4, 0.5); spin = longWay; lc = add(C, mul(U, shortR * sp.range(0.55, 0.75) + rb)); }
    const n = headland ? 30 : 18, ring = [];
    for (let k = 0; k < n; k++) {
      const t = (k / n) * TAU, rr = r.range(0.9, 1.08);
      const p = [Math.cos(t) * ra * rr, Math.sin(t) * rb * rr];
      ring.push(add(lc, [p[0] * Math.cos(spin) - p[1] * Math.sin(spin), p[0] * Math.sin(spin) + p[1] * Math.cos(spin)]));
    }
    const clip = intersect(headland ? difference([ring], headland) : [ring], [[[2, 2], [W - 2, 2], [W - 2, H - 2], [2, H - 2]]]);
    const big = clip.reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
    if (big) {
      lake = outline(big);
      wet.push(grown(lake, 0.9)); // (a lake's shore is roughened more than the sea's)
      features.push({ id: "lake", type: "water", class: "lake", shape: lake });
    }
  }
  // Running water: one of four river forms (from the review of the first city renders: "every river through a city
  // reads almost exactly the same"), the choice's or picked by the seed. A river meeting the sea takes a form that can
  // reach it
  let rivers = [], island = null;
  if (water === "river" || water === "estuary") {
    made ??= riverForm({ form, water, r: rng(seed, "quick", "river"), C, R, W, H, S, radiusAt, riverAngle, sea, bendSize: shape === "shore" || shape === "cliff" ? R * 0.6 : R });
    rivers = made.rivers.map((rv) => ({ ...rv, path: rv.path.map(pt) }));
    island = made.island;
    form = made.form;
  }
  river = rivers[0] ?? null;
  features.push(...rivers);
  // The rivers as bands nothing is built in (half their widest, and a bank; the layout curves them a little off these
  // points, and widens a river up to 1.9 times within 6 squares of the sea), each stretch buffered by Clipper and
  // joined, so a bend never folds a band over itself; and a disc around a mouth, where it flares into the sea
  for (const rv of rivers) {
    const ft = feetOf(rv), dense = [rv.path[0]], wide = [ft[0] / 25];
    for (let i = 1; i < rv.path.length; i++) {
      const a = rv.path[i - 1], b = rv.path[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
      for (let k = 1; k <= n; k++) { dense.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]); wide.push((ft[i - 1] + ((ft[i] - ft[i - 1]) * k) / n) / 25); }
    }
    const mouthAt = sea ? dense.findIndex((p) => inside(p, sea)) : -1;
    const halves = dense.map((_, i) => wide[i] / 2 * (mouthAt < 0 ? 1 : 1 + 0.9 * Math.max(0, 1 - Math.abs(i - mouthAt) * 0.5 / 6)) + 1.2);
    wet.push(...bands(dense.slice(1).map((p, i) => ({ path: [dense[i], p], half: Math.max(halves[i], halves[i + 1]) }))));
    if (sea && mouthAt >= 0) {
      const e = rv.path[rv.path.length - 1], rad = wide[wide.length - 1] / 2 * 1.9 + 1.2;
      wet.push(Array.from({ length: 16 }, (_, k) => add(e, mul(dirOf((k / 16) * TAU), rad))));
    }
  }
  // A cliff across the map behind the city, clear of the water; the wall ends at it and nothing is built on it
  let cliff = null, cutLine = null, cliffAway = null, cliffKeep = null; // (cliffAway: the way from the city across the cliff)
  if (shape === "cliff") {
    let sides = [sp.next() * TAU];
    if (sea || lake) sides = [seaward + Math.PI];
    else if (river) {
      // (on the other side of the middle from the river)
      const n = dirOf(riverAngle + Math.PI / 2), near = densify(river.path, 1).filter((p) => Math.hypot(p[0] - C[0], p[1] - C[1]) < R * 1.2);
      const lean = near.reduce((s, p) => s + (p[0] - C[0]) * n[0] + (p[1] - C[1]) * n[1], 0);
      sides = lean > 0 ? [riverAngle - Math.PI / 2, riverAngle + Math.PI / 2] : [riverAngle + Math.PI / 2, riverAngle - Math.PI / 2];
    }
    const foot = sp.chance(0.55), height = 5 * Math.round(sp.range(40, 70) / 5), rock = sp.chance(0.6) ? "earthy" : "slate";
    found: for (const B of sides) for (const dc of [0.55, 0.62, 0.7, 0.8]) {
      const U = dirOf(B), V = [-U[1], U[0]], mid = add(C, mul(U, radiusAt(B) * dc)), span = Math.hypot(W, H), line = [];
      let off = 0;
      for (let s = -span; s <= span; s += 5) { off = Math.max(-2.5, Math.min(2.5, off + sp.range(-1.2, 1.2))); line.push(add(add(mid, mul(V, s)), mul(U, off))); }
      const run = onMapRuns(line, W, H).sort((a, b) => along(b).at(-1) - along(a).at(-1))[0];
      if (!run) continue;
      const pts = densify(run, 1);
      if (rivers.some((rv) => pathsCross(run, rv.path) || pts.some((p) => distToPath(p, rv.path) < widestOf(rv) / 25 / 2 + 3))) continue;
      if ([sea, lake].some((q) => q && pts.some((p) => inside(p, q)))) continue;
      // (its line runs with the middle on its right: the city at its foot is on its low side, on top on its high side)
      cliff = { id: "cliff", type: "wall", class: "cliff", side: foot ? "right" : "left", height, rock, path: simplify(run, 0.15).map(pt) };
      // The city stops at its toe (at its foot) or just back from its top edge, with room for the tower at the wall's end
      cutLine = offsetLine(run, -((foot ? cliffWidth(height, 25) : 0) + 1.4));
      const beyond = [...cutLine, ...[...cutLine].reverse().map((p) => add(p, mul(U, span)))];
      const kept = biggest(difference([wallPoly], [beyond]));
      if (!kept || area(kept) < area(wallPoly) * 0.5) { cliff = null; continue; }
      wallPoly = outline(kept);
      cliffAway = U;
      cliffKeep = cliffOf(cliff, 25, [W, H]).keep;
      wet.push(...bands([{ path: cliffKeep.path, half: cliffKeep.half + 0.5 }]));
      break found;
    }
  }
  const inWater = (p) => wet.some((q) => inside(p, q));

  // Gates: spread around the land side of the wall, none toward the sea or the lake. Each main road runs from the
  // center straight out to the wall (a slight jog on the way), then wanders to the map's edge; a road is kept only
  // when it stays out of the sea and the lake and crosses the river squarely enough (at 40 degrees or more). Gates
  // stand at least a share of an even spacing apart, the share eased when the land side is narrow
  const gateCount = S.gates[choices.roads] ?? S.gates.through;
  const blocked = (a) => (headland ? apart(a, seaward + Math.PI) > 0.6 : sea || lake ? apart(a, seaward) < 1.15 : false);
  const roadAt = (a) => {
    const U = dirOf(a), V = [-U[1], U[0]];
    const wallAt = radiusAt(a);
    const inner = [C];
    for (const f of [0.33, 0.66]) inner.push(add(add(C, mul(U, wallAt * f)), mul(V, r.range(-0.8, 0.8))));
    const gate = add(C, mul(U, wallAt * 1.06));
    inner.push(gate);
    const outer = wander(r, gate, dirOf(a + r.range(-0.1, 0.1)), W, H, { step: r.range(7, 10), amp: r.range(1, 2) });
    return [...inner, ...outer.slice(1)].map(pt);
  };
  // (and never runs along a river within its banks for longer than crossing it takes)
  const crossesWell = (path) => {
    for (const rv of rivers) {
      for (let i = 1; i < path.length; i++) for (let j = 1; j < rv.path.length; j++) {
        if (!segCross(path[i - 1], path[i], rv.path[j - 1], rv.path[j])) continue;
        const a = Math.atan2(path[i][1] - path[i - 1][1], path[i][0] - path[i - 1][0]), b = Math.atan2(rv.path[j][1] - rv.path[j - 1][1], rv.path[j][0] - rv.path[j - 1][0]);
        const d = Math.min(apart(a, b), apart(a, b + Math.PI));
        if (d < (40 * Math.PI) / 180) return false;
      }
      const half = widestOf(rv) / 25 / 2 + 1, most = (2 * half) / Math.sin((40 * Math.PI) / 180) + 1;
      let run = 0;
      for (const p of densify(path, 0.5)) { run = distToPath(p, rv.path) < half ? run + 0.5 : 0; if (run > most) return false; }
    }
    // (and crosses two rivers well apart, so each gets a bridge of its own)
    const hits = rivers.flatMap((rv) => crossings(path, rv.path));
    if (hits.some((p, i) => hits.some((q, j) => j > i && Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.3 && Math.hypot(p[0] - q[0], p[1] - q[1]) < 6))) return false;
    return true;
  };
  const roads = [];
  for (const share of cliff ? [0.6, 0.5, 0.4, 0.3, 0.22, 0.15] : [0.6, 0.5, 0.4, 0.3]) { // (closer together where a cliff leaves less room)
    for (let t = 0; t < 300 && roads.length < gateCount; t++) {
      const a = r.next() * TAU;
      if (blocked(a) || roads.some((g) => apart(g.angle, a) < (TAU / gateCount) * share)) continue;
      const path = roadAt(a);
      if ((sea || lake) && densify(path, 0.5).some((p) => inside(p, sea ?? lake))) continue;
      if (!crossesWell(path)) continue;
      // (none up or down the cliff, and none at the wall's end by it)
      // (none up or down the cliff or along its face, and none at the wall's end by it)
      if (cliff && (densify(path, 0.5).some((p) => distToPath(p, cliffKeep.path) < cliffKeep.half + 0.9) || distToPath(add(C, mul(dirOf(a), radiusAt(a))), cutLine) < 5)) continue;
      // (its gate clear of where a river passes the wall, where the wall stops at a tower each side)
      const gateAt = add(C, mul(dirOf(a), radiusAt(a)));
      if (rivers.some((rv) => distToPath(gateAt, rv.path) < widestOf(rv) / 25 / 2 + 3.5)) continue;
      roads.push({ type: "road", class: "highway", surface: "cobble", path, angle: a });
    }
    if (roads.length >= gateCount) break;
  }
  roads.sort((a, b) => a.angle - b.angle);
  roads.forEach((rd, k) => { rd.id = `gate-road-${k + 1}`; });

  // The street inside the wall: the wall drawn in by its reach (half its thickness and the clear strip) and half a
  // street, kept to the land
  const ringPoly = (offset([wallPoly], -((12 / 2 + 15 + 10) / 25 + 0.2)) ?? []).reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
  const ringPieces = ringPoly ? pathOutside([...ringPoly, ringPoly[0]], [sea, lake].filter(Boolean), 3) : [];
  const ringClosed = ringPieces.length === 1 && !sea && !lake;
  // (drawn straight between its points, so it never curves out into the wall's band)
  ringPieces.forEach((p, k) => roads.push({ id: ringPieces.length > 1 ? `wall-street-${k + 1}` : "wall-street", type: "road", class: "street", surface: "cobble", straight: true, path: (ringClosed ? [...ringPoly, ringPoly[0]] : p).map(pt) }));

  // The ground the wards cover: inside the wall street, off the water
  let land = ringPoly ? difference([ringPoly], wet) : [];
  // A metropolis keeps its old wall: a smaller ring around the old town, the wards cut by its line (half its reach in
  // from it inside, half out from it outside), the main roads passing through it at its own gates
  let oldWall = null, oldPoly = null, oldCut = null;
  if (choices.size === "metropolis") {
    const n = 10 + r.int(4), f = r.range(0.48, 0.56);
    oldPoly = Array.from({ length: n }, (_, k) => {
      const a = (k + r.range(-0.3, 0.3)) * (TAU / n);
      return pt(add(C, mul(dirOf(a), radiusAt(a) * f * r.range(0.95, 1.05))));
    });
    // (drawn in toward the middle where it would come within a few squares of the wall street, which would run along it)
    if (ringPoly) {
      const ringPath = [...ringPoly, ringPoly[0]];
      for (let k = 0; k < 4 && densify([...oldPoly, oldPoly[0]], 1).some((p) => inside(p, ringPoly) && distToPath(p, ringPath) < 3); k++) oldPoly = oldPoly.map((p) => pt(add(C, mul([p[0] - C[0], p[1] - C[1]], 0.92))));
    }
    if (cutLine) {
      // (stopping at the cliff too, as the town wall does; else, where that would run it along the wall street inside
      // the town wall, a little further in)
      const ringPath = ringPoly ? [...ringPoly, ringPoly[0]] : null;
      for (const pull of [0, -4.5]) {
        const pulled = pull ? offsetLine(cutLine, pull) : cutLine, beyond = [...pulled, ...[...pulled].reverse().map((p) => add(p, mul(cliffAway, Math.hypot(W, H))))];
        const kept = biggest(difference([oldPoly], [beyond]));
        if (!kept) continue;
        const run = openRun(outline(kept), pulled);
        if (pull === 0 && run && ringPath) {
          // (the longest stretch within reach of the wall street, away from its ends, where it crosses that street)
          const pts = densify(run.path, 0.5), lens = [0];
          for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
          const L = lens[lens.length - 1];
          let cur = 0, most = 0;
          pts.forEach((p, i) => { cur = lens[i] > 3 && lens[i] < L - 3 && distToPath(p, ringPath) < 1.6 ? cur + 0.5 : 0; most = Math.max(most, cur); });
          if (most > 2) continue;
        }
        oldPoly = outline(kept); oldCut = pulled;
        break;
      }
    }
    const reach = (12 / 2 + 15) / 25 + 0.15;
    const innerLand = intersect(land, offset([oldPoly], -reach));
    const outerLand = difference(land, offset([oldPoly], reach));
    land = [...innerLand, ...outerLand];
    const oldRun = oldCut ? openRun(oldPoly, oldCut) : null;
    oldWall = { id: "old-wall", type: "wall", class: "town", path: oldRun ? oldRun.path : [...oldPoly, oldPoly[0]], ...(oldRun ? { side: oldRun.side } : {}), straight: true, outside: "none", towers: "roofed" };
  }
  const landArea = land.reduce((s, p) => s + area(p), 0);

  // Sectors between neighboring main roads (each road's own line is the edge, out to beyond the wall), split by the
  // water into pieces; an island in the river is a piece of its own, the main roads crossing it (cut into wedges, it
  // left slivers too small to build on)
  const far = R * 3;
  const pieces = island ? intersect(land, [island]).filter((p) => area(p) > 4) : [];
  const mainland = island ? difference(land, [island]) : land;
  roads.filter((rd) => rd.angle !== undefined).forEach((rd, k, list) => {
    const next = list[(k + 1) % list.length];
    const cut = (path) => { const i = path.findIndex((p) => Math.hypot(p[0] - C[0], p[1] - C[1]) > R * 1.6); return i < 0 ? path : path.slice(0, i + 1); };
    const a0 = rd.angle, a1 = next === rd ? rd.angle + TAU : next.angle + (next.angle <= rd.angle ? TAU : 0);
    const arc = [];
    for (let t = a0; t <= a1; t += 0.2) arc.push(add(C, mul(dirOf(t), far)));
    arc.push(add(C, mul(dirOf(a1), far)));
    const wedge = list.length === 1 ? null : [...cut(rd.path), ...arc, ...[...cut(next.path)].reverse().slice(0, -1)];
    for (const piece of wedge ? intersect([wedge], mainland) : mainland) if (area(piece) > 4) pieces.push(piece);
  });

  // Wards: each piece cut into Voronoi cells by its share of the wards wanted, the seeds spread out a little
  const [w0, w1] = S.wards;
  const wanted = w0 + r.int(w1 - w0 + 1);
  const target = landArea / wanted;
  const wards = [];
  const streets = [];
  for (const piece of pieces) {
    const k = Math.max(1, Math.round(area(piece) / target));
    if (area(piece) < target * 0.15) continue; // a scrap between the water and the wall stays open ground
    const cells = k === 1 ? [piece] : mergeSmall(voronoiIn(piece, k, r), target * 0.4);
    // Edges between two cells of this piece are streets; edges on the piece's own outline aren't
    const onEdge = (m) => distToRing(m, piece) < 0.05;
    const seen = new Map();
    for (const cell of cells) {
      wards.push(cell);
      for (let i = 0; i < cell.length; i++) {
        const a = cell[i], b = cell[(i + 1) % cell.length];
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (onEdge(m) || Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.05) continue;
        const key = [pt(a), pt(b)].map((p) => p.join(",")).sort().join("|");
        if (!seen.has(key)) seen.set(key, [a, b]);
      }
    }
    streets.push(...chain([...seen.values()]));
  }
  streets.filter((p) => pathLen(p) >= 2).forEach((p, k) => roads.push({ id: `ward-street-${k + 1}`, type: "road", class: "street", surface: "cobble", straight: true, path: p.map(pt) }));

  // The central square, where the main roads meet
  // (a green: the main roads meet on a grass square)
  // (its paving and shape from a stream of its own: a circle, a rectangle or an irregular market place)
  const sr = rng(seed, "quick", "city-square");
  const spin = sr.next() * Math.PI, main = roads.find((rd) => rd.angle !== undefined); // (a rectangle lies along a main road)
  const sh = squareShape({ r: sr.fork("shape"), C, angle: main ? main.angle : spin, rad: S.square, kinds: ["circle", "rect", "irregular"] });
  const square = choices.center === "green"
    ? { id: "square", type: "square", shape: { circle: [r1(C[0]), r1(C[1]), S.square] }, surface: "grass", name: "The green" }
    : { id: "square", type: "square", shape: sh.shape, surface: sr.pick(PAVINGS), market: true, name: "The market square" };
  if (choices.center !== "none") features.push(square);

  // Districts: the wards, dense throughout, numbered around from the north
  const order = wards.map((poly) => ({ poly: outline(poly), c: centroid(poly) }))
    .filter((w) => w.poly.length >= 3)
    .sort((a, b) => norm(Math.atan2(a.c[1] - C[1], a.c[0] - C[0]) + Math.PI / 2) - norm(Math.atan2(b.c[1] - C[1], b.c[0] - C[0]) + Math.PI / 2) || Math.hypot(a.c[0] - C[0], a.c[1] - C[1]) - Math.hypot(b.c[0] - C[0], b.c[1] - C[1]));
  // Points the same up to rounding become one point, so shared corners stay shared
  const all = order.flatMap((w) => w.poly);
  for (const p of all) for (const q of all) if (p !== q && Math.abs(p[0] - q[0]) < 0.15 && Math.abs(p[1] - q[1]) < 0.15 && Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.15) { q[0] = p[0]; q[1] = p[1]; }
  // A corner of one ward lying on another's side (where a ward street meets a main road, say) goes into that side too,
  // so the two share it exactly
  // (only where the ward itself runs along that side from the corner: a corner merely near another ward's side, on
  // a side of its own, would pull that side over)
  const along = (u, v) => { const lu = Math.hypot(...u) || 1, lv = Math.hypot(...v) || 1; return Math.abs(u[0] * v[1] - u[1] * v[0]) / (lu * lv) < 0.1; };
  for (const w of order) w.poly.forEach((p, i) => {
    const prev = w.poly[(i + w.poly.length - 1) % w.poly.length], next = w.poly[(i + 1) % w.poly.length];
    for (const o of order) {
      if (o === w || o.poly.some((q) => q[0] === p[0] && q[1] === p[1])) continue;
      const k = o.poly.findIndex((a, j) => {
        const b = o.poly[(j + 1) % o.poly.length], side = [b[0] - a[0], b[1] - a[1]];
        return distToSeg(p, a, b) < 0.12 && (along(side, [prev[0] - p[0], prev[1] - p[1]]) || along(side, [next[0] - p[0], next[1] - p[1]]));
      });
      if (k >= 0) o.poly.splice(k + 1, 0, [p[0], p[1]]);
    }
  });
  const districts = order.map((w, k) => ({
    id: `ward-${k + 1}`, type: "district",
    profile: "city", // dense inside the walls (its character sets how dense, chunk 4)
    shape: tidyRing(outline(w.poly)),
  })).filter((d) => d.shape.length >= 3);
  // Last repairs: an outline that crosses itself is untangled (its biggest piece kept), and where two wards still
  // overlap (a road meeting a river's bank at a shallow angle can leave a sliver both claim) the smaller gives way
  const inset = (poly) => offset([poly], -0.03);
  for (const d of districts) if (polygonCrossesItself(d.shape)) { const u = biggest(union([d.shape])); if (u) d.shape = tidyRing(outline(u)); }
  for (let i = 0; i < districts.length; i++) for (let j = i + 1; j < districts.length; j++) {
    const a = districts[i], b = districts[j];
    const shared = intersect(inset(a.shape), inset(b.shape)).reduce((n, p) => n + area(p), 0);
    if (shared <= 0.02) continue;
    const [small, big] = area(a.shape) < area(b.shape) ? [a, b] : [b, a];
    const left = biggest(difference([small.shape], offset([big.shape], 0.06) ?? [big.shape])); // (a little past its edge, so rounding the corners to a tenth can't bring them back over)
    small.shape = left ? tidyRing(outline(left)) : [];
  }
  for (let k = districts.length - 1; k >= 0; k--) if (districts[k].shape.length < 3 || area(districts[k].shape) < 4 || polygonCrossesItself(districts[k].shape)) districts.splice(k, 1);
  // A ward no road reaches (cut off between the water and the old wall) gets a street in from the nearest road, on
  // dry ground; failing that it's left as open ground
  const roadPts = roads.flatMap((rd) => densify(rd.path, 0.5).map((p) => ({ p, rd })));
  for (let k = districts.length - 1; k >= 0; k--) {
    const d = districts[k];
    if (roads.some((rd) => pathTouchesPolygon(rd.path, d.shape))) continue;
    const mid = centroid(d.shape);
    const best = roadPts.map((x) => ({ ...x, l: Math.hypot(x.p[0] - mid[0], x.p[1] - mid[1]) })).filter((x) => x.l < R * 0.6 && !densify([mid, x.p], 0.4).some((q) => inWater(q))).sort((a, b) => a.l - b.l)[0];
    if (best) roads.push({ id: `${d.id}-street`, type: "road", class: "street", surface: "cobble", path: [pt(best.p), pt(mid)] });
    else districts.splice(k, 1);
  }
  const citadel = assignCharacters({ districts, C, R, S, size: choices.size, sea, lake, rivers, island, ringPoly, oldPoly, gateRoads: roads.filter((rd) => rd.angle !== undefined), allRoads: roads.map((rd) => rd.path), squarePoly: choices.center !== "none" ? shapeToPolygon(square.shape) : null, harbor: !!(sea ?? lake) && (!ringPoly || !!harborRun({ shore: sea ?? lake, ringPoly, river, W, H })), r: rng(seed, "quick", "city-wards") });

  // The town wall, closed, straight between its corners; a moat where it's by a river, else a ditch or none
  // (against a cliff: open, from the cliff around to the cliff)
  const wallRun = cutLine ? openRun(wallPoly, cutLine) : null;
  const wall = { id: "town-wall", type: "wall", class: "town", path: wallRun ? wallRun.path : [...wallPoly, wallPoly[0]], ...(wallRun ? { side: wallRun.side } : {}), straight: true, outside: form === "loop" ? "none" : river ? (r.chance(0.6) ? "moat" : "ditch") : r.pick(["none", "ditch", "ditch", "moat"]) };

  // Bridges wherever a road crosses the river
  const crossingsOut = [];
  if (rivers.length) {
    let n = 0;
    for (const rv of rivers) for (const rd of roads) for (const hit of crossings(rd.path.map(pt), rv.path)) {
      if (crossingsOut.some((c) => Math.hypot(c.at[0] - hit[0], c.at[1] - hit[1]) < 1.2)) continue; // (the same crossing twice, where an arm leaves the river)
      crossingsOut.push({ id: `bridge-${++n}`, type: "crossing", class: "bridge", at: pt(hit) });
    }
  }

  // The harbor: a quay along the shore inside the wall, and piers out from it
  const docks = [];
  const shore = sea ?? lake;
  if (shore && ringPoly) {
    const quay = harborRun({ shore, ringPoly, river, W, H });
    if (quay) {
      const path = simplify(quay.slice(2, -2), 0.1).map(pt);
      docks.push({ id: "quay", type: "dock", class: sea ? "quay" : "wharf", path });
      // Piers square to the shore, out into the water
      const piers = sea ? 2 + r.int(3) : 1 + r.int(2);
      for (let k = 0; k < piers; k++) {
        const i = Math.floor(((k + 0.5) / piers) * (quay.length - 2)) + 1;
        const a = quay[i - 1], b = quay[i + 1];
        const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...d) || 1;
        let n = [-d[1] / l, d[0] / l];
        if (!inside(add(quay[i], mul(n, 1.5)), shore)) n = mul(n, -1);
        const len = sea ? r.range(4, 7) : r.range(2.5, 4);
        docks.push({ id: `${sea ? "pier" : "jetty"}-${k + 1}`, type: "dock", class: sea ? "pier" : "jetty", path: [pt(quay[i]), pt(add(quay[i], mul(n, len)))] });
      }
    }
  }
  if (river && (water === "river" || !docks.length) && ringPoly) {
    // A quay along one bank inside the wall (an estuary's too, when its sea lies beyond the wall)
    const ft = feetOf(river);
    const side = r.chance(0.5) ? 1 : -1;
    // (in one unbroken stretch: the longest, where an arm or another river leaves it or the wall comes near)
    const runs = [[]];
    for (let i = 1; i < river.path.length; i++) {
      const a = river.path[i - 1], b = river.path[i], d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...d) || 1, n = [(-d[1] / l) * side, (d[0] / l) * side];
      const half = Math.max(ft[i - 1], ft[i]) / 25 / 2;
      for (const p of densify([a, b], 0.5)) {
        const q = add(p, mul(n, half + 0.3));
        if (inside(q, ringPoly) && distToRing(q, ringPoly) > 3 && !rivers.some((o) => o !== river && distToPath(q, o.path) < widestOf(o) / 25 / 2 + 1.5)) runs[runs.length - 1].push(q);
        else if (runs[runs.length - 1].length) runs.push([]);
      }
    }
    const bank = runs.reduce((x, y) => (y.length > x.length ? y : x));
    if (bank.length > 10) docks.push({ id: "quay", type: "dock", class: "quay", path: simplify(bank.slice(2, -2), 0.1).map(pt) });
  }

  // Outside the walls: suburbs along the roads beyond some gates, then farms, fields and woods (the country)
  const outside = countryside({ choices, C, R, W, H, wallPoly, wall, roads: roads.filter((rd) => rd.angle !== undefined), wet, inWater, rivers, sea, lake, r: rng(seed, "quick", "city-country") });

  // The name above the city
  const top = Math.min(...wallPoly.map((p) => p[1]));
  const label = { at: pt([Math.max(6, Math.min(W - 6, C[0])), Math.max(1.5, top - 3)]) };

  return {
    W, H, px: S.px, center: C, wallPoly, ringPoly, river: form, shape: cliff || shape !== "cliff" ? shape : "compact",
    features: [
      ...(cliff ? [cliff] : []),
      ...roads.map(({ angle, ...rd }) => rd),
      ...features.filter((f) => f.type === "water"),
      ...crossingsOut,
      ...docks,
      ...features.filter((f) => f.type === "square"),
      wall,
      ...(oldWall ? [oldWall] : []),
      ...(citadel ? citadel.features : []),
      ...districts,
      ...outside,
    ],
    label,
  };
}

const pathLen = (p) => p.reduce((s, q, i) => s + (i ? Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);

/** Segments joined end to end into paths (ends matched to a hundredth). */
function chain(segs) {
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
function mergeSmall(cells, min) {
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
function voronoiIn(poly, k, r) {
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
 * Gives each ward a character by rule (Patrick, 1 Nov: by the city's geography, varied by seed): the market on the
 * central square, a temple beside it, docks on the water, the garrison against the wall by a gate (sometimes walled
 * in as a citadel), the nobles on the quiet side away from the main roads and upstream, crafts by the water downstream
 * and near the gates, the poor by the wall away from the nobles, merchants along the main roads; the rest are homes.
 * Sets each district's character and name in place. Returns the citadel ({ features }) or null.
 */
function assignCharacters({ districts, C, R, S, size, sea, lake, rivers, island, ringPoly, oldPoly, gateRoads, allRoads, squarePoly = null, harbor = true, r }) {
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
    const picked = free().map((w) => ({ w, s: score(w) })).filter((x) => x.s > -Infinity).sort((a, b) => b.s - a.s).slice(0, n);
    for (const { w } of picked) w.d.character = character;
    return picked.map((x) => x.w);
  };
  const count = (lo, hi) => lo + r.int(hi - lo + 1);
  // The market and the temple at the heart of the city
  take(metro ? 2 : 1, (w) => w.square * 10 - w.center * 3 + w.j, "market");
  // (on the island, when the river splits around one)
  take(metro ? 2 : 1, (w) => (w.center < 0.6 ? 5 : 0) + w.square * 2 - w.center * 3 + w.isle * 4 + w.j * 1.5, "temple");
  // Docks along the shore or the river
  // (on the river where the shore stays outside the wall: an estuary city whose sea lies off past its island)
  // (on the shore only where it has room for the harbor's quay inside the wall street)
  const onShore = shore && harbor ? take(metro ? count(2, 3) : count(1, 2), (w) => (w.shore ? w.shore * 2 + w.j : -Infinity), "docks") : [];
  if (!onShore.length && river) take(metro ? 2 : 1, (w) => (w.river ? w.river + w.j * 2 : -Infinity), "docks");
  // The garrison against the wall, by a gate, on the water if it can
  const garrison = take(metro ? count(1, 2) : 1, (w) => w.wall * 4 + w.gates * 2 + (w.shore || w.river ? 2 : 0) + w.center * 2 + w.j * 2, "garrison");
  // The nobles on the quiet side: off the main roads, upstream, away from the garrison and the docks
  take(metro ? count(2, 3) : count(1, 2), (w) => -w.gates * 2 - w.down * 2 - w.wall + (w.old ? 1.5 : 0) - (w.center > 0.75 ? 2 : 0) + w.j * 2, "nobles");
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
  for (const w of info) {
    const base = w.d.character === "homes" ? (w.isle ? "Isle Ward" : `${cap(compass(Math.atan2(w.c[1] - C[1], w.c[0] - C[0])))} Ward`) : NAME[w.d.character];
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    w.d.name = n > 1 ? `${base} ${["", "", "II", "III", "IV", "V", "VI"][n] ?? n}` : base;
  }
  for (const w of info) if (w.d.character === "homes") delete w.d.character; // homes is the default

  // The citadel: often the garrison walled in on its own (a city about half the time, a metropolis mostly)
  const g = garrison[0];
  if (!g || !r.chance(metro ? 0.75 : 0.5)) return null;
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

/** A polygon's area-weighted check: true when every point of `pts` is on the map, off the water and clear of polys. */
const clearOfAll = (pts, polys) => pts.every((p) => !polys.some((q) => inside(p, q)));

/**
 * Outside the walls: suburbs (village districts strung along the main roads beyond about half the gates, more in a
 * metropolis: the poor and the crafts that weren't let in), farmsteads by the roads farther out, field systems in the
 * land between the roads (to the map's edge in farmland, a ragged way out in mixed country) and woods. Plan features.
 */
function countryside({ choices, C, R, W, H, wallPoly, wall, roads, wet, inWater, rivers = [], r }) {
  const out = [];
  const metro = choices.size === "metropolis";
  // Kept off: the city (its wall and what lies outside it, a ditch or moat and towers) and the water
  const city = offset([wallPoly], 3.2).reduce((a, b) => (!a || area(b) > area(a) ? b : a), wallPoly);
  const onMap = (p) => p[0] > 1 && p[1] > 1 && p[0] < W - 1 && p[1] < H - 1;
  const suburbs = [];
  for (const rd of roads) {
    if (!r.chance(metro ? 0.85 : 0.6)) continue;
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
    const character = r.pick(["poor", "poor", "crafts", "homes"]);
    let name = `${cap(compass(rd.angle))} Gate ${character === "poor" ? "Shanties" : character === "crafts" ? "Yards" : "Suburb"}`;
    for (let n = 2; out.some((f) => f.name === name); n++) name = `${name.replace(/ [IVX]+$/, "")} ${["", "", "II", "III", "IV", "V", "VI"][n] ?? n}`;
    out.push({ id: `suburb-${suburbs.length}`, type: "district", profile: "village", ...(character !== "homes" ? { character } : {}), name, shape: poly });
  }
  // Cemeteries outside the walls: one or two (two in a metropolis) beside a main road past the suburbs (their own
  // stream, so the rest draws as before)
  const graves = [];
  {
    const cr = r.fork("cemeteries"), want = metro ? 2 : cr.chance(0.5) ? 2 : 1;
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
    const wantWater = rivers.length ? (metro ? 2 : 1) : 0;
    for (let k = 0, made = 0; k < wantWater * 2 && made < wantWater; k++) {
      const rv = rivers[k % rivers.length];
      const got = watermill({ water: { path: rv.path, width: widestOf(rv) }, ok: (p, m) => ok(p, m) && !inWater(p), want: (c) => distToRing(c, city) < R * 0.5, r: mr.fork("water", k), id: made ? `watermill-${made + 1}` : "watermill" });
      if (!got) continue;
      made++;
      out.push(...got);
      const [x0, y0, x1, y1] = got[1].shape.rect;
      mills.push([(x0 + x1) / 2, (y0 + y1) / 2]);
    }
    if (choices.surroundings === "farmland" || choices.surroundings === "mixed") {
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
function harborRun({ shore, ringPoly, river, W, H }) {
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
function feetOf(rv) {
  if (Array.isArray(rv.widths) && rv.widths.length === rv.path.length) return rv.widths;
  const at = [0];
  for (let i = 1; i < rv.path.length; i++) at.push(at[i - 1] + Math.hypot(rv.path[i][0] - rv.path[i - 1][0], rv.path[i][1] - rv.path[i - 1][1]));
  const L = at[at.length - 1] || 1;
  return rv.path.map((_, i) => (Number.isFinite(rv.endWidth) ? rv.width + (rv.endWidth - rv.width) * (at[i] / L) : rv.width));
}
const widestOf = (rv) => Math.max(...feetOf(rv));
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
function pathsCross(a, b, skip = 0) {
  for (let i = 1 + skip; i < a.length; i++) for (let j = 1; j < b.length; j++) if (segCross(a[i - 1], a[i], b[j - 1], b[j])) return true;
  return false;
}
/** The stretches of a path on the map (each cut where it leaves it). */
function onMapRuns(path, W, H) {
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
function riverForm({ form, water, r, C, R, W, H, S, radiusAt, riverAngle, sea, bendSize = R }) {
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
      const path = simplifyKeeping(M, [j]);
      const trib = { id: "river-2", type: "water", class: "river", width: tribW, path: simplify([...T].reverse(), 0.08) };
      return { rivers: [main(path), trib], island: null, form };
    }
    return meanderOnly();
  }

  if (form === "loop") {
    // Around the city just outside its wall, all but across a neck of land: in from the map's edge, around, and out
    // again beside where it came in (the neck turned toward the side with the most room beyond it)
    // (the wall's corners stand up to 3% out; its outer half, its towers, the river's half width and its no-build bank)
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
const biggest = (ps) => (ps ?? []).reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);

/**
 * A closed outline cut off along a line, as an open run: from where it leaves the line around to where it comes
 * back. Returns { path, side (its outside, for a wall: away from the inside) } or null when it never touches the line.
 */
function openRun(poly, line) {
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
function grown(poly, m) {
  return offset([poly], m).reduce((a, b) => (!a || area(b) > area(a) ? b : a), null) ?? poly;
}

/**
 * An outline without a point visited twice (snapping shared corners together can pinch off a sliver: the bigger loop
 * is kept) or a spike (a corner it runs out to and straight back from), rounded again.
 */
function tidyRing(poly) {
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
