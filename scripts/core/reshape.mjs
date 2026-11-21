/**
 * Reshaping shapes and paths by their points in the window. A path has a handle on each point and one mid-stretch
 * (dragging it adds a point); a point where two paths meet moves for both, and bridges and fords follow the roads and
 * water. A shape has a handle on each corner (a rect becomes points once moved) and mid-side; a circle one for its
 * radius, an ellipse one per axis; a turned shape has no handles. Corners two shapes share (within SAME) move
 * together, and a corner added or removed on a shared side is for both. Every function returns a new plan. Pure.
 */
import { isObj } from "./plan.mjs";
import { rerollable } from "./seeds.mjs";
import { polygonCrossesItself } from "./geom.mjs";

/** Corners closer than this are the same corner. */
export const SAME = 0.05;

const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= SAME;

/** A point list without a closing point equal to the first, or one point repeated straight after itself. */
function clean(pts) {
  const out = [];
  for (const p of pts) if (!out.length || !near(out[out.length - 1], p)) out.push([p[0], p[1]]);
  while (out.length > 1 && near(out[0], out[out.length - 1])) out.pop();
  return out;
}

/** The types whose paths can be reshaped. */
const PATHS = new Set(["road", "water", "wall", "dock", "trail", "tether", "terrain"]);

/**
 * A feature's shape as handles see it: { kind: "poly", pts } | { kind: "path", pts } | { kind: "circle", c, r } |
 * { kind: "ellipse", c, rx, ry } | null.
 */
export function editableShape(f) {
  if (isObj(f) && PATHS.has(f.type) && Array.isArray(f.path)) {
    // Repeated points dropped, but a path whose last point is its first (a ring) keeps it
    const pts = [];
    for (const p of f.path) if (Array.isArray(p) && (!pts.length || !near(pts[pts.length - 1], p))) pts.push([p[0], p[1]]);
    return pts.length >= 2 ? { kind: "path", pts } : null;
  }
  // (a district, area, height or body of water; or a plan's own region, which has no seed but is reshaped the same)
  const region = isObj(f) && f.type === "region" && typeof f.id === "string";
  // (painted terrain on an overland map, a plateau or a biome zone, is reshaped the same)
  if (!(rerollable(f) || region || (isObj(f) && f.type === "terrain")) || (Number(f.rot) || 0) !== 0) return null;
  const s = f.shape;
  if (Array.isArray(s)) {
    const pts = clean(s);
    return pts.length >= 3 ? { kind: "poly", pts } : null;
  }
  if (isObj(s) && Array.isArray(s.rect)) {
    const [x0, y0, x1, y1] = s.rect;
    return { kind: "poly", pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] };
  }
  if (isObj(s) && Array.isArray(s.circle)) return { kind: "circle", c: [s.circle[0], s.circle[1]], r: s.circle[2] };
  if (isObj(s) && Array.isArray(s.ellipse)) return { kind: "ellipse", c: [s.ellipse[0], s.ellipse[1]], rx: s.ellipse[2], ry: s.ellipse[3] };
  return null;
}

/** Every handle in the plan: [{ id, kind: "corner" | "mid" | "radius" | "rx" | "ry", i, at: [x, y] }]. */
export function handlesOf(plan) {
  const out = [];
  for (const f of plan?.features ?? []) {
    const e = editableShape(f);
    if (!e) continue;
    if (e.kind === "poly" || e.kind === "path") {
      e.pts.forEach((p, i) => {
        out.push({ id: f.id, kind: "corner", i, at: p, path: e.kind === "path", type: f.type, family: familyOf(f) });
        if (e.kind === "path" && i === e.pts.length - 1) return; // a path's last point has no stretch after it
        const q = e.pts[(i + 1) % e.pts.length];
        out.push({ id: f.id, kind: "mid", i, at: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], path: e.kind === "path", type: f.type, family: familyOf(f) });
      });
    } else if (e.kind === "circle") out.push({ id: f.id, kind: "radius", i: 0, at: [e.c[0] + e.r, e.c[1]] });
    else {
      out.push({ id: f.id, kind: "rx", i: 0, at: [e.c[0] + e.rx, e.c[1]] });
      out.push({ id: f.id, kind: "ry", i: 0, at: [e.c[0], e.c[1] + e.ry] });
    }
  }
  return out;
}

/** The point-list shapes and paths in a plan: [{ f, pts, path }]. */
const polys = (plan) => (plan?.features ?? []).map((f) => ({ f, e: editableShape(f) })).filter((x) => x.e?.kind === "poly" || x.e?.kind === "path").map((x) => ({ f: x.f, pts: x.e.pts, path: x.e.kind === "path" }));

/**
 * What a feature's points snap to and move with: paths of their own type (a cliff with cliffs, never a wall), and
 * shapes with shapes (ponds, lakes and seas with each other, districts and areas with each other).
 */
export function familyOf(f) {
  if (Array.isArray(f?.path)) return f.type === "wall" && f.class === "cliff" ? "cliff" : f.type;
  return f?.type === "water" ? "body" : f?.type === "height" ? "height" : f?.type === "region" ? "region" : "shape";
}

/** The other shapes' corners at the same place as this corner: [{ id, i }]. */
export function partnersOf(plan, id, i) {
  const all = polys(plan);
  const me = all.find((x) => x.f.id === id);
  if (!me?.pts[i]) return [];
  const out = [];
  // Paths share points with paths of their own type (a road with roads, never with a river or a wall), shapes with
  // shapes: a district corner on a road's point doesn't drag the road
  for (const o of all) if (o !== me && o.path === me.path && familyOf(o.f) === familyOf(me.f)) o.pts.forEach((p, j) => { if (near(p, me.pts[i])) out.push({ id: o.f.id, i: j }); });
  // A ring's first and last points are one point
  if (me.path) me.pts.forEach((p, j) => { if (j !== i && near(p, me.pts[i])) out.push({ id: me.f.id, i: j }); });
  return out;
}

const round = (v) => Math.round(v * 10) / 10;

/** A copy of the plan with fn(points) applied to the named shapes' corners (a rect becomes a list of points). */
function withPoints(plan, ids, fn) {
  const out = structuredClone(plan);
  for (const f of out.features) {
    if (!isObj(f) || !ids.includes(f.id)) continue;
    const e = editableShape(f);
    if (!e || (e.kind !== "poly" && e.kind !== "path")) continue;
    const pts = fn(e.pts, f.id);
    if (!pts) continue;
    if (e.kind === "path") f.path = pts;
    else f.shape = clean(pts); // a corner dropped on its neighbor becomes one corner, not two in the same place
  }
  return out;
}

/**
 * Moves a handle to a point. The point is rounded to a tenth of a square unless exact is true (a corner snapped onto
 * another keeps that corner's exact place, so the two stay one corner). A corner takes the corners it shares with
 * other shapes along (partners: from partnersOf). A side's middle adds a corner there, in this shape and in any shape
 * that shares that side. A radius or axis handle sets the circle's radius or the ellipse's axis (at least 0.5).
 */
export function moveHandle(plan, { id, kind, i }, to, partners = [], { exact = false } = {}) {
  const at = exact ? [to[0], to[1]] : [round(to[0]), round(to[1])];
  if (kind === "corner") {
    const where = [{ id, i }, ...partners];
    const ids = [...new Set(where.map((w) => w.id))];
    const next = withPoints(plan, ids, (pts, fid) => {
      for (const w of where) if (w.id === fid) pts[w.i] = [...at];
      return pts;
    });
    // (a corner dropped onto its neighbor becomes one corner: a height's stretches follow)
    keepStretches(plan, next, ids);
    return refitAfter(plan, where.map((w) => w.id), next);
  }
  if (kind === "mid") {
    const me = polys(plan).find((x) => x.f.id === id);
    if (!me) return structuredClone(plan);
    const a = me.pts[i], b = me.pts[(i + 1) % me.pts.length];
    // Every shape with a side from a to b (either way around) gets the new corner on it
    const sides = new Map();
    for (const o of polys(plan)) {
      if (familyOf(o.f) !== familyOf(me.f)) continue; // (only its own kind shares a side)
      for (let j = 0; j < (o.path ? o.pts.length - 1 : o.pts.length); j++) {
        const p = o.pts[j], q = o.pts[(j + 1) % o.pts.length];
        if ((near(p, a) && near(q, b)) || (near(p, b) && near(q, a))) { sides.set(o.f.id, j); break; }
      }
    }
    const next = withPoints(plan, [...sides.keys()], (pts, fid) => { pts.splice(sides.get(fid) + 1, 0, [...at]); return pts; });
    // A river's width at each point gets one for the new point too: halfway between its neighbors'
    keepWidths(plan, next, [...sides.keys()], (w, fid) => { const j = sides.get(fid); w.splice(j + 1, 0, (w[j] + w[j + 1]) / 2); });
    keepStretches(plan, next, [...sides.keys()]);
    return refitAfter(plan, [...sides.keys()], next);
  }
  const out = structuredClone(plan);
  const f = out.features.find((x) => isObj(x) && x.id === id);
  const e = f && editableShape(f);
  if (!e) return out;
  const size = (d) => Math.max(0.5, round(d));
  if (kind === "radius" && e.kind === "circle") f.shape = { circle: [e.c[0], e.c[1], size(Math.hypot(at[0] - e.c[0], at[1] - e.c[1]))] };
  if (kind === "rx" && e.kind === "ellipse") f.shape = { ellipse: [e.c[0], e.c[1], size(Math.abs(at[0] - e.c[0])), e.ry] };
  if (kind === "ry" && e.kind === "ellipse") f.shape = { ellipse: [e.c[0], e.c[1], e.rx, size(Math.abs(at[1] - e.c[1]))] };
  return out;
}

/**
 * Removes a corner, and the same corner from any shape that shares it, where each keeps at least three corners (a
 * path at least two points). A point where a path joins another isn't taken from the other path.
 */
export function removeCorner(plan, id, i) {
  const all = polys(plan);
  const isPath = (fid) => !!all.find((x) => x.f.id === fid)?.path;
  const where = new Map([[id, i]]);
  if (!isPath(id)) for (const p of partnersOf(plan, id, i)) if (!isPath(p.id)) where.set(p.id, p.i);
  // A ring's first and last points are one point: taking it off takes both, and the ring closes on its new first
  const take = (pts, j) => {
    const ring = pts.length >= 4 && Math.abs(pts[0][0] - pts[pts.length - 1][0]) < 1e-9 && Math.abs(pts[0][1] - pts[pts.length - 1][1]) < 1e-9;
    if (ring && pts.length < 5) return null; // a ring keeps three corners at least
    if (!ring || (j !== 0 && j !== pts.length - 1)) return pts.filter((_, k) => k !== j);
    const inner = pts.slice(1, -1);
    return [...inner, [...inner[0]]];
  };
  const next = withPoints(plan, [...where.keys()], (pts, fid) => (pts.length > (isPath(fid) ? 2 : 3) ? take(pts, where.get(fid)) : null));
  keepWidths(plan, next, [...where.keys()], (w, fid) => w.splice(where.get(fid), 1)); // a river's width there goes with it
  keepStretches(plan, next, [...where.keys()]);
  return refitAfter(plan, [...where.keys()], next);
}

/**
 * A height's edge stretches (its edges field, by its outline's point numbers) kept in step when its outline gained or
 * lost one corner between before and after (the window's add, remove, or a corner dropped onto its neighbor): past a
 * new corner the numbers move on one; past a taken one they move back one, and a stretch ending on the taken corner
 * ends on the corner before it. A stretch whose ends come to one point is dropped. Changes after in place.
 */
function keepStretches(before, after, ids) {
  for (const f of after.features) {
    if (!isObj(f) || f.type !== "height" || !ids.includes(f.id) || !Array.isArray(f.edges)) continue;
    const was = before.features.find((x) => isObj(x) && x.id === f.id)?.shape;
    if (!Array.isArray(was) || !Array.isArray(f.shape)) continue;
    const n0 = was.length, n1 = f.shape.length;
    if (Math.abs(n1 - n0) !== 1) continue;
    const same = (p, q) => p && q && p[0] === q[0] && p[1] === q[1];
    // (the first place the outlines part: the new corner, or the taken one)
    let j = 0;
    while (j < Math.min(n0, n1) && same(was[j], f.shape[j])) j++;
    // (corner 0 dropped onto the last corner: the outline then starts at the last, and every other keeps its number)
    const wrapped = n1 < n0 && j === 0 && same(was[n0 - 1], f.shape[0]);
    const renumber = wrapped ? (k) => (k === n0 - 1 ? 0 : k) : n1 > n0 ? (k) => (k >= j ? k + 1 : k) : (k) => (k < j ? k : k > j ? k - 1 : (j - 1 + n1) % n1);
    f.edges = f.edges.map((x) => (isObj(x) && Number.isInteger(x.from) && Number.isInteger(x.to) ? { ...x, from: renumber(x.from), to: renumber(x.to) } : x)).filter((x) => !isObj(x) || x.from !== x.to);
    if (!f.edges.length) delete f.edges;
  }
}

/**
 * A river's widths (one for each point of its path) kept in step when a point is added or taken off: for each id,
 * when the water had one width a point before and its path changed length by one, change (a copy of its widths, and
 * the id) makes them match again. Changes the plan after in place.
 */
function keepWidths(before, after, ids, change) {
  for (const fid of ids) {
    const was = (before?.features ?? []).find((f) => isObj(f) && f.id === fid);
    const now = (after?.features ?? []).find((f) => isObj(f) && f.id === fid);
    if (!was || !now || was.type !== "water" || !Array.isArray(was.path) || !Array.isArray(now.path)) continue;
    if (!Array.isArray(was.widths) || was.widths.length !== was.path.length || Math.abs(now.path.length - was.path.length) !== 1) continue;
    const w = [...was.widths];
    change(w, fid);
    if (w.length === now.path.length) now.widths = w;
  }
}

/** Where segment a-b crosses c-d, or null. */
function cross(a, b, c, d) {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - a[0], qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + rx * t, a[1] + ry * t] : null;
}

/** refit, when one of the features moved (ids, in the plan before) is a road or water: districts and woods move no bridge. */
function refitAfter(before, ids, plan) {
  const moved = new Set(ids);
  return (before?.features ?? []).some((f) => isObj(f) && moved.has(f.id) && (f.type === "road" || f.type === "water")) ? refit(plan, before) : plan;
}

/** Every place a road crosses the water: [{ at, road, water }], one per place (a road point on the water's line is one). */
function crossingSpots(plan) {
  const feats = plan?.features ?? [];
  const roads = feats.filter((f) => isObj(f) && f.type === "road" && Array.isArray(f.path));
  const waters = feats.filter((f) => isObj(f) && f.type === "water" && Array.isArray(f.path));
  const spots = [];
  for (const r of roads) for (let i = 1; i < r.path.length; i++) for (const w of waters) for (let j = 1; j < w.path.length; j++) {
    const x = cross(r.path[i - 1], r.path[i], w.path[j - 1], w.path[j]);
    if (x && !spots.some((s) => near(s.at, x))) spots.push({ at: x, road: r.id, water: w.id });
  }
  return spots;
}

/**
 * After a road or the water moves (in a plan copy, changed in place): each bridge and ford moves to the nearest place
 * a road now crosses the water. One that sat on a road's crossing (in the plan before) follows that road over that
 * water however far it moved; any other moves only within a few squares, so a lone footbridge doesn't jump across the
 * map.
 */
export function refit(plan, before = null) {
  const feats = plan?.features ?? [];
  const list = feats.filter((f) => isObj(f) && f.type === "crossing" && Array.isArray(f.at));
  if (!list.length) return plan;
  const sq = Number(plan?.size?.ftPerSquare) || 25;
  const spots = crossingSpots(plan).map((s) => ({ ...s, key: `${s.road}|${s.water}` }));
  const old = before ? crossingSpots(before) : [];
  const pairs = [];
  list.forEach((c, n) => {
    const on = old.find((s) => Math.hypot(s.at[0] - c.at[0], s.at[1] - c.at[1]) <= 0.5);
    const reach = Math.max(3, (Number(c.length) || 0) / sq);
    spots.forEach((x, m) => {
      const d = Math.hypot(x.at[0] - c.at[0], x.at[1] - c.at[1]);
      if (d <= reach || (on && x.key === `${on.road}|${on.water}`)) pairs.push({ n, m, d });
    });
  });
  pairs.sort((a, b) => a.d - b.d);
  const usedC = new Set(), usedX = new Set();
  for (const { n, m } of pairs) {
    if (usedC.has(n) || usedX.has(m)) continue;
    usedC.add(n); usedX.add(m);
    list[n].at = [round(spots[m].at[0]), round(spots[m].at[1])];
  }
  return plan;
}

/** Why a reshaped shape can't be kept (it crosses itself, or two corners meet), or null if it's fine. */
export function shapeProblem(plan, id) {
  const f = (plan?.features ?? []).find((x) => isObj(x) && x.id === id);
  const e = f && editableShape(f);
  if (!e || e.kind !== "poly") return null; // a road or river may cross itself or loop
  if (e.pts.length < 3) return `"${id}" needs at least three corners.`;
  return polygonCrossesItself(e.pts) ? `"${id}" would cross itself or fold two corners together.` : null;
}
