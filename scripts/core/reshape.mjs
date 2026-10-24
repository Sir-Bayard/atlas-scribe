/**
 * Reshaping districts and areas by their corners, for the preview window. A shape given as a list of points or a
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

/** A feature's shape as handles see it: { kind: "poly", pts } | { kind: "circle", c, r } | { kind: "ellipse", c, rx, ry } | null. */
export function editableShape(f) {
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
    if (e.kind === "poly") {
      e.pts.forEach((p, i) => {
        out.push({ id: f.id, kind: "corner", i, at: p });
        const q = e.pts[(i + 1) % e.pts.length];
        out.push({ id: f.id, kind: "mid", i, at: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] });
      });
    } else if (e.kind === "circle") out.push({ id: f.id, kind: "radius", i: 0, at: [e.c[0] + e.r, e.c[1]] });
    else {
      out.push({ id: f.id, kind: "rx", i: 0, at: [e.c[0] + e.rx, e.c[1]] });
      out.push({ id: f.id, kind: "ry", i: 0, at: [e.c[0], e.c[1] + e.ry] });
    }
  }
  return out;
}

/** The point-list shapes in a plan: [{ f, pts }]. */
const polys = (plan) => (plan?.features ?? []).map((f) => ({ f, e: editableShape(f) })).filter((x) => x.e?.kind === "poly").map((x) => ({ f: x.f, pts: x.e.pts }));

/** The other shapes' corners at the same place as this corner: [{ id, i }]. */
export function partnersOf(plan, id, i) {
  const all = polys(plan);
  const me = all.find((x) => x.f.id === id);
  if (!me?.pts[i]) return [];
  const out = [];
  for (const o of all) if (o !== me) o.pts.forEach((p, j) => { if (near(p, me.pts[i])) out.push({ id: o.f.id, i: j }); });
  return out;
}

const round = (v) => Math.round(v * 10) / 10;

/** A copy of the plan with fn(points) applied to the named shapes' corners (a rect becomes a list of points). */
function withPoints(plan, ids, fn) {
  const out = structuredClone(plan);
  for (const f of out.features) {
    if (!isObj(f) || !ids.includes(f.id)) continue;
    const e = editableShape(f);
    if (!e || e.kind !== "poly") continue;
    const pts = fn(e.pts, f.id);
    if (pts) f.shape = pts;
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
    const where = new Map([[id, i], ...partners.map((p) => [p.id, p.i])]);
    return withPoints(plan, [...where.keys()], (pts, fid) => { pts[where.get(fid)] = [...at]; return pts; });
  }
  if (kind === "mid") {
    const me = polys(plan).find((x) => x.f.id === id);
    if (!me) return structuredClone(plan);
    const a = me.pts[i], b = me.pts[(i + 1) % me.pts.length];
    // Every shape with a side from a to b (either way round) gets the new corner on it
    const sides = new Map();
    for (const o of polys(plan)) {
      for (let j = 0; j < o.pts.length; j++) {
        const p = o.pts[j], q = o.pts[(j + 1) % o.pts.length];
        if ((near(p, a) && near(q, b)) || (near(p, b) && near(q, a))) { sides.set(o.f.id, j); break; }
      }
    }
    return withPoints(plan, [...sides.keys()], (pts, fid) => { pts.splice(sides.get(fid) + 1, 0, [...at]); return pts; });
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

/** Removes a corner, and the same corner from any shape that shares it, where each keeps at least three. */
export function removeCorner(plan, id, i) {
  const where = new Map([[id, i], ...partnersOf(plan, id, i).map((p) => [p.id, p.i])]);
  return withPoints(plan, [...where.keys()], (pts, fid) => (pts.length > 3 ? pts.filter((_, j) => j !== where.get(fid)) : null));
}

/** Why a reshaped shape can't be kept (it crosses itself, or two corners meet), or null if it's fine. */
export function shapeProblem(plan, id) {
  const f = (plan?.features ?? []).find((x) => isObj(x) && x.id === id);
  const e = f && editableShape(f);
  if (!e || e.kind !== "poly") return null;
  if (e.pts.length < 3) return `"${id}" needs at least three corners.`;
  return polygonCrossesItself(e.pts) ? `"${id}" would cross itself or fold two corners together.` : null;
}
