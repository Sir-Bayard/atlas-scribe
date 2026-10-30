/**
 * Drawing new features in the window: the tools, where a clicked point snaps to, and the feature a finished drawing
 * makes. A district or area is drawn corner by corner (or as a box); its corners snap onto other districts' and
 * areas' corners and sides, and onto the map's edge, and a corner put on another shape's side adds that corner to
 * the other shape too, so the two share the side (their streets meet at gates there, and the shared corner moves for
 * both). A road, river or wall is drawn point by point; its points snap onto another of its kind (a road onto a
 * road, water onto water, a wall onto a wall) or onto the map's edge. Bridges, fords, props and labels are a single click. Every function
 * returns a new plan and leaves the one given alone. Pure: runs anywhere. Numbers are in squares.
 */
import { isObj, normalize } from "./plan.mjs";
import { editableShape, shapeProblem, SAME } from "./reshape.mjs";
import { checkPlan } from "./check.mjs";

/**
 * The drawing tools. geometry: "shape" (corners or a box), "box" (a box, or a click for a default size), "path"
 * (points), "point" (a click). make: the new feature's own settings.
 */
export const TOOLS = [
  { id: "district", label: "District", icon: "fa-city", geometry: "shape", make: { type: "district", profile: "village" } },
  { id: "woods", label: "Woods", icon: "fa-tree", geometry: "shape", make: { type: "area", class: "woods" } },
  { id: "fields", label: "Fields", icon: "fa-wheat-awn", geometry: "shape", make: { type: "area", class: "fields" } },
  { id: "park", label: "Park", icon: "fa-seedling", geometry: "shape", make: { type: "area", class: "park" } },
  { id: "farmstead", label: "Farm", icon: "fa-warehouse", geometry: "shape", make: { type: "area", class: "farmstead" } },
  { id: "yard", label: "Yard", icon: "fa-vector-square", geometry: "shape", make: { type: "area", class: "yard" } },
  { id: "square", label: "Square", icon: "fa-square", geometry: "shape", make: { type: "square" } },
  { id: "building", label: "Building", icon: "fa-house", geometry: "box", make: { type: "building" }, size: [30, 20] },
  { id: "road", label: "Road", icon: "fa-road", geometry: "path", make: { type: "road", class: "street" } },
  { id: "lane", label: "Lane", icon: "fa-route", geometry: "path", make: { type: "road", class: "lane" } },
  { id: "track", label: "Track", icon: "fa-shoe-prints", geometry: "path", make: { type: "road", class: "track" } },
  { id: "river", label: "River", icon: "fa-water", geometry: "path", make: { type: "water", class: "river" } },
  { id: "stream", label: "Stream", icon: "fa-droplet", geometry: "path", make: { type: "water", class: "stream" } },
  { id: "wall", label: "Wall", icon: "fa-dungeon", geometry: "path", make: { type: "wall", class: "drystone" } },
  { id: "hedge", label: "Hedge", icon: "fa-leaf", geometry: "path", make: { type: "wall", class: "hedge" } },
  { id: "bridge", label: "Bridge", icon: "fa-bridge", geometry: "point", make: { type: "crossing", class: "bridge" } },
  { id: "ford", label: "Ford", icon: "fa-person-swimming", geometry: "point", make: { type: "crossing", class: "ford" } },
  { id: "tree", label: "Tree", icon: "fa-tree", geometry: "point", make: { type: "prop", class: "tree" } },
  { id: "well", label: "Well", icon: "fa-circle-dot", geometry: "point", make: { type: "prop", class: "well" } },
  { id: "cart", label: "Cart", icon: "fa-cart-flatbed", geometry: "point", make: { type: "prop", class: "cart" } },
  { id: "label", label: "Label", icon: "fa-font", geometry: "point", make: { type: "label", text: "New label", show: "gm" } },
];

export const toolOf = (id) => TOOLS.find((t) => t.id === id) ?? null;

const SHAPED = new Set(["district", "area", "square"]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (p) => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]; // a point snapped onto a line: close enough to stay on it

/** The nearest point on segment a-b to p, and how far along it (0 to 1). */
function onSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return { at: [a[0] + t * dx, a[1] + t * dy], t };
}

/**
 * The point-list outline of a district, area or square (a rect as its four corners), or null: circles, ellipses and
 * turned areas aren't snapped to or shared.
 */
function outlineOf(f) {
  if (!isObj(f) || !SHAPED.has(f.type)) return null;
  const e = f.type === "square" ? editableShape({ ...f, type: "area" }) : editableShape(f);
  return e?.kind === "poly" ? e.pts : null;
}

/** Snaps a point to the map's edge when it's within tol of it (each side separately, so a corner snaps to both). */
function toEdge(p, plan, tol) {
  const [W, H] = normalize(plan).size.squares;
  const q = [p[0], p[1]];
  if (Math.abs(q[0]) <= tol) q[0] = 0;
  else if (Math.abs(q[0] - W) <= tol) q[0] = W;
  if (Math.abs(q[1]) <= tol) q[1] = 0;
  else if (Math.abs(q[1] - H) <= tol) q[1] = H;
  return q;
}

/**
 * Where a corner of a new district, area or square lands: on another shape's corner within tol (exactly, so the two
 * are one corner), else on another shape's side within tol, else on the map's edge within tol, else where it was
 * clicked (to a tenth of a square). Returns { at, kind: "corner" | "side" | "edge" | null, id }.
 */
export function snapCorner(plan, p, tol) {
  let best = null;
  for (const f of plan?.features ?? []) {
    const pts = outlineOf(f);
    if (!pts) continue;
    for (const c of pts) {
      const d = dist(p, c);
      if (d <= tol && (!best || d < best.d)) best = { d, at: [c[0], c[1]], kind: "corner", id: f.id };
    }
  }
  if (best) return best;
  for (const f of plan?.features ?? []) {
    const pts = outlineOf(f);
    if (!pts) continue;
    for (let i = 0; i < pts.length; i++) {
      const { at } = onSegment(p, pts[i], pts[(i + 1) % pts.length]);
      const d = dist(p, at);
      if (d <= tol && (!best || d < best.d)) best = { d, at: r3(at), kind: "side", id: f.id };
    }
  }
  if (best) return best;
  const e = toEdge(p, plan, tol);
  if (e[0] !== p[0] || e[1] !== p[1]) return { at: e.map((v, k) => (v === p[k] ? r1(v) : v)), kind: "edge", id: null };
  return { at: [r1(p[0]), r1(p[1])], kind: null, id: null };
}

/**
 * Where a point of a new road, river or wall lands: on another of its kind (a road onto a road's line, water onto
 * water's, a wall onto a wall's) within tol, else on the map's edge within tol, else where it was clicked. (A wall
 * isn't snapped onto a road: the road is drawn curved, and the wall's end would miss it.)
 * Returns { at, kind: "path" | "edge" | null, id }.
 */
export function snapEnd(plan, type, p, tol) {
  const kinds = [type];
  let best = null;
  for (const f of plan?.features ?? []) {
    if (!isObj(f) || !kinds.includes(f.type) || !Array.isArray(f.path)) continue;
    for (let i = 1; i < f.path.length; i++) {
      const { at } = onSegment(p, f.path[i - 1], f.path[i]);
      const d = dist(p, at);
      if (d <= tol && (!best || d < best.d)) best = { d, at: r3(at), kind: "path", id: f.id };
    }
  }
  if (best) return best;
  const e = toEdge(p, plan, tol);
  if (e[0] !== p[0] || e[1] !== p[1]) return { at: e.map((v, k) => (v === p[k] ? r1(v) : v)), kind: "edge", id: null };
  return { at: [r1(p[0]), r1(p[1])], kind: null, id: null };
}

/** An id not yet in the plan: the tool's word and a number ("woods-3"). */
export function freeId(plan, base) {
  const ids = new Set((plan?.features ?? []).filter(isObj).map((f) => f.id));
  for (let n = 1; ; n++) if (!ids.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Points that lie on a side of an outline (not on its corners), inserted into it as corners; null if none were. */
function withCornersOn(pts, others) {
  let out = pts, changed = false;
  for (const c of others) {
    if (out.some((q) => dist(q, c) <= SAME)) continue;
    for (let i = 0; i < out.length; i++) {
      const { at, t } = onSegment(c, out[i], out[(i + 1) % out.length]);
      if (t > 0 && t < 1 && dist(at, c) <= SAME) { out = [...out.slice(0, i + 1), [c[0], c[1]], ...out.slice(i + 1)]; changed = true; break; }
    }
  }
  return changed ? out : null;
}

/**
 * Where a new shape meets another along a side, each gets the other's corners that lie on that side, so the side is
 * shared corner for corner (its corners move together when either is reshaped). Changes the copy it's given.
 */
function shareSides(plan, id) {
  const me = plan.features.find((f) => isObj(f) && f.id === id);
  const mine = outlineOf(me);
  if (!mine) return;
  let own = mine;
  for (const f of plan.features) {
    if (f === me || !isObj(f) || f.type === "square" || !SHAPED.has(f.type)) continue;
    const e = editableShape(f);
    if (e?.kind !== "poly") continue;
    const theirs = withCornersOn(e.pts, own);
    if (theirs) f.shape = theirs;
    const next = withCornersOn(own, e.pts);
    if (next) own = next;
  }
  if (own !== mine) me.shape = own;
}

/**
 * The plan with a new feature made by a tool from what was drawn: points (corners, a path's points, or one point),
 * or box: [x0, y0, x1, y1]. Returns { plan, id } or { error } (too few points, a shape that crosses itself, one too
 * small, or anything else the checker would refuse about the new feature).
 */
export function addFeature(plan, toolId, { points = [], box = null } = {}) {
  const tool = toolOf(toolId);
  if (!tool) return { error: `There's no tool "${toolId}".` };
  const next = structuredClone(plan);
  if (!Array.isArray(next.features)) next.features = [];
  const id = freeId(next, tool.id);
  const f = { id, ...structuredClone(tool.make) };
  const sq = normalize(plan).size.ftPerSquare || 25;
  const pts = points.map((p) => [p[0], p[1]]);
  if (tool.geometry === "point") {
    if (!pts[0]) return { error: "Click where it goes." };
    f.at = [r1(pts[0][0]), r1(pts[0][1])];
  } else if (tool.geometry === "path") {
    // Points too close to the one before are one point
    const path = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > SAME);
    if (path.length < 2) return { error: "A line needs at least two points." };
    f.path = path;
  } else if (box) {
    if (Math.abs(box[2] - box[0]) < 0.1 || Math.abs(box[3] - box[1]) < 0.1) return { error: "Drag a bigger box (at least a tenth of a square each way)." };
    const [x0, y0, x1, y1] = [Math.min(box[0], box[2]), Math.min(box[1], box[3]), Math.max(box[0], box[2]), Math.max(box[1], box[3])].map((v) => Math.round(v * 1000) / 1000);
    f.shape = { rect: [x0, y0, x1, y1] };
  } else if (tool.geometry === "box") {
    // A click places a building of the tool's size, centred there
    if (!pts[0]) return { error: "Drag a box, or click where it goes." };
    const [w, d] = tool.size.map((ft) => ft / sq);
    const [cx, cy] = pts[0];
    f.shape = { rect: [r1(cx - w / 2), r1(cy - d / 2), r1(cx + w / 2), r1(cy + d / 2)] };
  } else {
    const shape = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > SAME);
    while (shape.length > 1 && dist(shape[0], shape[shape.length - 1]) <= SAME) shape.pop();
    if (shape.length < 3) return { error: "A shape needs at least three corners (or drag a box)." };
    f.shape = shape;
  }
  next.features.push(f);
  const problem = SHAPED.has(f.type) && Array.isArray(f.shape) ? shapeProblem({ features: [{ ...f, type: f.type === "square" ? "area" : f.type }] }, id) : null;
  if (problem) return { error: problem };
  if (SHAPED.has(f.type) && f.type !== "square") shareSides(next, id);
  // Only what the new feature brings: a plan that already had problems can still be drawn on
  const had = new Set(checkPlan(plan).filter((p) => p.level === "error").map((p) => p.message));
  const errors = checkPlan(next).filter((p) => p.level === "error" && !had.has(p.message));
  if (errors.length) return { error: errors.map((p) => p.message).join(" ") };
  return { plan: next, id };
}
