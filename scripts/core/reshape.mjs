/**
 * Reshaping districts, areas, roads, rivers and walls by their points, for the preview window. A road, river or wall
 * has a handle on each point of its path and one in the middle of each stretch (dragging it adds a point there); a
 * point where two paths meet moves for both, and after a road or river moves, the plan's bridges and fords move to
 * where the roads and the water now cross. For districts and areas: a shape given as a list of points or a
 * rect has a handle on each corner (a rect becomes a list of points once one is moved) and one in the middle of each
 * side (dragging it adds a corner there); a circle has one handle on its edge for its radius, an ellipse one on each
 * axis. A shape turned by rot isn't reshaped here yet. Corners two shapes share (within 0.05 squares) move together,
 * and adding or removing a corner on a side two shapes share does it to both, so a shared border stays shared.
 * Every function returns a new plan and leaves the one given alone. Pure: runs anywhere. Numbers are in squares.
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
const PATHS = new Set(["road", "water", "wall"]);

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
  if (!rerollable(f) || (Number(f.rot) || 0) !== 0) return null;
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
        out.push({ id: f.id, kind: "corner", i, at: p, path: e.kind === "path" });
        if (e.kind === "path" && i === e.pts.length - 1) return; // a path's last point has no stretch after it
        const q = e.pts[(i + 1) % e.pts.length];
        out.push({ id: f.id, kind: "mid", i, at: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], path: e.kind === "path" });
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

/** The other shapes' corners at the same place as this corner: [{ id, i }]. */
export function partnersOf(plan, id, i) {
  const all = polys(plan);
  const me = all.find((x) => x.f.id === id);
  if (!me?.pts[i]) return [];
  const out = [];
  // Paths share points with paths, shapes with shapes: a district corner on a road's point doesn't drag the road
  for (const o of all) if (o !== me && o.path === me.path) o.pts.forEach((p, j) => { if (near(p, me.pts[i])) out.push({ id: o.f.id, i: j }); });
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
    else f.shape = pts;
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
    return refit(withPoints(plan, [...new Set(where.map((w) => w.id))], (pts, fid) => {
      for (const w of where) if (w.id === fid) pts[w.i] = [...at];
      return pts;
    }));
  }
  if (kind === "mid") {
    const me = polys(plan).find((x) => x.f.id === id);
    if (!me) return structuredClone(plan);
    const a = me.pts[i], b = me.pts[(i + 1) % me.pts.length];
    // Every shape with a side from a to b (either way round) gets the new corner on it
    const sides = new Map();
    for (const o of polys(plan)) {
      for (let j = 0; j < (o.path ? o.pts.length - 1 : o.pts.length); j++) {
        const p = o.pts[j], q = o.pts[(j + 1) % o.pts.length];
        if ((near(p, a) && near(q, b)) || (near(p, b) && near(q, a))) { sides.set(o.f.id, j); break; }
      }
    }
    return refit(withPoints(plan, [...sides.keys()], (pts, fid) => { pts.splice(sides.get(fid) + 1, 0, [...at]); return pts; }));
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
  return refit(withPoints(plan, [...where.keys()], (pts, fid) => (pts.length > (isPath(fid) ? 2 : 3) ? pts.filter((_, j) => j !== where.get(fid)) : null)));
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

/**
 * After a road or the water moves (in a plan copy, changed in place): each of the plan's bridges and fords moves to the
 * nearest place a road now crosses the water (one each, nearest first), so they follow the road and the river. One
 * with no crossing left for it stays put.
 */
export function refit(plan) {
  const feats = plan?.features ?? [];
  const list = feats.filter((f) => isObj(f) && f.type === "crossing" && Array.isArray(f.at));
  if (!list.length) return plan;
  const roads = feats.filter((f) => isObj(f) && f.type === "road" && Array.isArray(f.path));
  const waters = feats.filter((f) => isObj(f) && f.type === "water" && Array.isArray(f.path));
  const spots = [];
  for (const r of roads) for (let i = 1; i < r.path.length; i++) for (const w of waters) for (let j = 1; j < w.path.length; j++) {
    const x = cross(r.path[i - 1], r.path[i], w.path[j - 1], w.path[j]);
    if (x) spots.push(x);
  }
  const pairs = [];
  list.forEach((c, n) => spots.forEach((x, m) => pairs.push({ n, m, d: Math.hypot(x[0] - c.at[0], x[1] - c.at[1]) })));
  pairs.sort((a, b) => a.d - b.d);
  const usedC = new Set(), usedX = new Set();
  for (const { n, m } of pairs) {
    if (usedC.has(n) || usedX.has(m)) continue;
    usedC.add(n); usedX.add(m);
    list[n].at = [round(spots[m][0]), round(spots[m][1])];
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
