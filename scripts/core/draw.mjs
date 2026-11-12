/**
 * Drawing new features in the window: the tools, where a clicked point snaps, and the feature a finished drawing
 * makes. A district or area is drawn corner by corner (or as a box), its corners snapping onto other shapes' corners
 * and sides and the map's edge (a corner on another shape's side is added to it too, so the two share the side). A
 * road, river or wall is drawn point by point, snapping onto its own kind or the map's edge; where a new road crosses
 * water, a bridge or ford is added. Bridges, fords, props and labels are a click. Every function returns a new plan.
 * Pure; squares.
 */
import { isObj, normalize } from "./plan.mjs";
import { wallReach } from "./layout/walls.mjs";
import { offset } from "./lots/poly.mjs";
import { editableShape, shapeProblem, SAME } from "./reshape.mjs";
import { checkPlan } from "./check.mjs";
import { roadWaterCrossings } from "./layout/crossings.mjs";
import { shapeToPolygon, pointInPolygon, pathTouchesPolygon, distanceToPath, insidePoint, segmentNearPath, pointsAlong, bbox } from "./geom.mjs";
import { districtGates, gateSpacing } from "./streets/index.mjs";
import { lineAngleAt } from "./labels.mjs";
import { waterEntries, nearWater } from "./water.mjs";

/**
 * The drawing tools. geometry: "shape" (corners or a box), "box" (a box, or a click for a default size), "path"
 * (points), "point" (a click). make: the new feature's own settings. how: which hint the palette shows, when it isn't
 * the one for its geometry.
 */
export const TOOLS = [
  { id: "district", label: "District", icon: "fa-city", geometry: "shape", make: { type: "district", profile: "village" } },
  { id: "woods", label: "Woods", icon: "fa-tree", geometry: "shape", make: { type: "area", class: "woods" } },
  { id: "fields", label: "Fields", icon: "fa-wheat-awn", geometry: "shape", make: { type: "area", class: "fields" } },
  { id: "park", label: "Park", icon: "fa-seedling", geometry: "shape", make: { type: "area", class: "park" } },
  { id: "cemetery", label: "Cemetery", icon: "fa-cross", geometry: "shape", make: { type: "area", class: "cemetery" } },
  { id: "farmstead", label: "Farm", icon: "fa-warehouse", geometry: "shape", make: { type: "area", class: "farmstead" } },
  { id: "yard", label: "Yard", icon: "fa-vector-square", geometry: "shape", make: { type: "area", class: "yard" } },
  { id: "square", label: "Square", icon: "fa-square", geometry: "shape", make: { type: "square" } },
  { id: "building", label: "Building", icon: "fa-house", geometry: "box", make: { type: "building" }, size: [30, 20] },
  { id: "windmill", label: "Windmill", icon: "fa-fan", geometry: "box", round: true, make: { type: "building", use: "windmill", roof: "thatch", height: 45 }, size: [25, 25] },
  { id: "watermill", label: "Watermill", icon: "fa-gear", geometry: "box", make: { type: "building", use: "watermill", roof: "thatch", height: 30 }, size: [35, 25] },
  { id: "road", label: "Road", icon: "fa-road", geometry: "path", make: { type: "road", class: "street" } },
  { id: "lane", label: "Lane", icon: "fa-route", geometry: "path", make: { type: "road", class: "lane" } },
  { id: "track", label: "Track", icon: "fa-shoe-prints", geometry: "path", make: { type: "road", class: "track" } },
  { id: "river", label: "River", icon: "fa-water", geometry: "path", make: { type: "water", class: "river" } },
  { id: "stream", label: "Stream", icon: "fa-droplet", geometry: "path", make: { type: "water", class: "stream" } },
  { id: "pond", label: "Pond", icon: "fa-fish", geometry: "shape", make: { type: "water", class: "pond" } },
  { id: "lake", label: "Lake", icon: "fa-sailboat", geometry: "shape", make: { type: "water", class: "lake" } },
  { id: "sea", label: "Sea", icon: "fa-umbrella-beach", geometry: "shape", how: "sea", make: { type: "water", class: "sea" } },
  { id: "quay", label: "Quay", icon: "fa-anchor", geometry: "path", how: "quay", make: { type: "dock", class: "quay" } },
  { id: "pier", label: "Pier", icon: "fa-ship", geometry: "path", how: "pier", make: { type: "dock", class: "pier" } },
  { id: "wall", label: "Wall", icon: "fa-dungeon", geometry: "path", make: { type: "wall", class: "drystone" } },
  { id: "hedge", label: "Hedge", icon: "fa-leaf", geometry: "path", make: { type: "wall", class: "hedge" } },
  { id: "townwall", label: "Town wall", icon: "fa-chess-rook", geometry: "path", closes: true, base: "wall", make: { type: "wall", class: "town", straight: true } },
  { id: "palisade", label: "Palisade", icon: "fa-tents", geometry: "path", closes: true, make: { type: "wall", class: "palisade" } },
  { id: "cliff", label: "Cliff", icon: "fa-mountain", geometry: "path", how: "cliff", make: { type: "wall", class: "cliff" } },
  { id: "bridge", label: "Bridge", icon: "fa-bridge", geometry: "point", make: { type: "crossing", class: "bridge" } },
  { id: "ford", label: "Ford", icon: "fa-person-swimming", geometry: "point", make: { type: "crossing", class: "ford" } },
  { id: "tree", label: "Tree", icon: "fa-tree", geometry: "point", make: { type: "prop", class: "tree" } },
  { id: "well", label: "Well", icon: "fa-circle-dot", geometry: "point", make: { type: "prop", class: "well" } },
  { id: "cart", label: "Cart", icon: "fa-cart-flatbed", geometry: "point", make: { type: "prop", class: "cart" } },
  { id: "fountain", label: "Fountain", icon: "fa-faucet-drip", geometry: "point", make: { type: "prop", class: "fountain", size: 20 } },
  { id: "cross", label: "Market cross", icon: "fa-monument", geometry: "point", make: { type: "prop", class: "cross", size: 12 } },
  { id: "boat", label: "Boat", icon: "fa-sailboat", geometry: "point", make: { type: "prop", class: "boat" } },
  { id: "ship", label: "Ship", icon: "fa-ferry", geometry: "point", make: { type: "prop", class: "ship" } },
  { id: "rise", label: "Rise", icon: "fa-mountain-sun", geometry: "shape", how: "height", make: { type: "height", height: 10 } },
  { id: "hollow", label: "Hollow", icon: "fa-arrow-down-wide-short", geometry: "shape", how: "height", make: { type: "height", height: -10 } },
  { id: "campfire", label: "Campfire", icon: "fa-fire", geometry: "point", make: { type: "prop", class: "campfire" } },
  { id: "brazier", label: "Brazier", icon: "fa-fire-burner", geometry: "point", make: { type: "prop", class: "brazier" } },
  { id: "torch", label: "Torch", icon: "fa-fire-flame-simple", geometry: "point", make: { type: "prop", class: "torch" } },
  { id: "lamppost", label: "Lamp post", icon: "fa-lightbulb", geometry: "point", base: "lamp", make: { type: "prop", class: "lamp-post" } },
  { id: "crane", label: "Crane", icon: "fa-person-digging", geometry: "point", make: { type: "prop", class: "crane" } },
  { id: "cairn", label: "Cairn", icon: "fa-cubes-stacked", geometry: "point", make: { type: "prop", class: "cairn" } },
  { id: "standing-stone", label: "Standing stone", icon: "fa-grip-lines-vertical", geometry: "point", make: { type: "prop", class: "standing-stone" } },
  { id: "sledge", label: "Sledge", icon: "fa-sleigh", geometry: "point", make: { type: "prop", class: "sledge" } },
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
export function snapEnd(plan, type, p, tol, cls = null) {
  const kinds = [type];
  // (a cliff onto cliffs only, and other walls never onto a cliff)
  const cliff = (f) => f.type === "wall" && f.class === "cliff";
  let best = null;
  for (const f of plan?.features ?? []) {
    if (!isObj(f) || !kinds.includes(f.type) || !Array.isArray(f.path)) continue;
    if (type === "wall" && cliff(f) !== (cls === "cliff")) continue;
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
  // Not one the plan still names either (a leftover seed, lock or label from an imported plan), so a new feature
  // doesn't take over another's seed, lock or label
  const ids = new Set((plan?.features ?? []).filter(isObj).map((f) => f.id));
  for (const k of Object.keys(isObj(plan?.seeds) ? plan.seeds : {})) ids.add(k);
  for (const k of Array.isArray(plan?.locked) ? plan.locked : []) ids.add(k);
  for (const f of plan?.features ?? []) if (isObj(f) && f.type === "label" && typeof f.of === "string") ids.add(f.of);
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

/** How near an existing bridge or ford must be for a crossing to count as having one, in squares. */
const HAS_CROSSING = 3;

/**
 * Bridges and fords for a new road or water (in the copy it's given): one at each place it crosses the other kind,
 * unless a crossing the plan has already belongs there (within HAS_CROSSING, and nearer that place than any other
 * place a road crosses the water, as the layout pairs them). Returns the ids added.
 */
function addCrossings(plan, f) {
  if ((f.type !== "road" && f.type !== "water") || !Array.isArray(f.path)) return [];
  const others = plan.features.filter((g) => isObj(g) && g !== f && g.type === (f.type === "road" ? "water" : "road") && Array.isArray(g.path));
  const hits = f.type === "road" ? roadWaterCrossings([f], others) : roadWaterCrossings(others, [f]);
  const added = [];
  const ok = (g) => Array.isArray(g.path) && g.path.length >= 2 && g.path.every((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1]));
  const allRoads = plan.features.filter((g) => isObj(g) && g.type === "road" && ok(g));
  const allWater = plan.features.filter((g) => isObj(g) && g.type === "water" && ok(g));
  const spots = roadWaterCrossings(allRoads, allWater).map((x) => x.at);
  const nearestSpot = (p) => spots.reduce((b, s) => (!b || dist(s, p) < dist(b, p) ? s : b), null);
  for (const h of hits) {
    const have = plan.features.filter((g) => isObj(g) && g.type === "crossing" && Array.isArray(g.at));
    if (have.some((g) => dist(g.at, h.at) <= HAS_CROSSING && dist(nearestSpot(g.at) ?? g.at, h.at) <= SAME * 4)) continue;
    const ford = h.water.class === "stream" && (h.road.class === "track" || h.road.class === "path");
    const id = freeId(plan, ford ? "ford" : "bridge");
    plan.features.push({ id, type: "crossing", class: ford ? "ford" : "bridge", at: [r1(h.at[0]), r1(h.at[1])] });
    added.push(id);
  }
  return added;
}

/** Is a point in the plan's water, as the layout tests it for gates (half the width and a little, or in a lake)? */
export function waterTest(plan) {
  const ws = waterEntries(normalize(plan));
  return (x, y) => ws.some((w) => nearWater([x, y], w));
}

/**
 * A way in for a new district or square (in the copy it's given): a district with no road into it and no street from
 * a neighbor gets a lane from the nearest road, and a square in a district off the roads a street from the nearest
 * road. Each runs from a road point it can reach without crossing another district, yard, park, farm, square,
 * building, pond or (when a dry way is near) water, and not from off the map; with none, nothing is added and the
 * plan's problems say so. Returns the ids added.
 */
function addAccess(plan, f) {
  const full = normalize(plan);
  const roads = full.features.filter((g) => g.type === "road" && Array.isArray(g.path) && g.path.length >= 2 && g.path.every((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1])));
  const shape = (g) => { try { return shapeToPolygon(g.shape, g.type === "area" || g.type === "building" || g.type === "water" ? g.rot ?? 0 : 0); } catch { return []; } };
  const poly = shape(f);
  if (poly.length < 3) return [];
  const ring = [...poly, poly[0]];
  // A road into it (for a district, one crossing its outline, as the plan's problems ask; a square's apron takes in
  // a road passing within a few feet)
  if (roads.some((r) => pathTouchesPolygon(r.path, poly) || (f.type === "square" && (r.path.some((q) => distanceToPath(q, ring) < 0.3) || poly.some((q) => distanceToPath(q, r.path) < 0.3))))) return [];
  const target = insidePoint(poly);
  let home = null, cls = "lane";
  if (f.type === "square") {
    home = full.features.find((g) => g.type === "district" && pointInPolygon(target, shape(g)));
    if (!home) return [];
    if (home.profile === "town" || home.profile === "city") cls = "street";
  } else if (f.type === "district") {
    const sq = full.size.ftPerSquare || 25;
    const list = full.features.filter((g) => g.type === "district").map((g) => ({ id: g.id, poly: shape(g), ...gateSpacing(g, sq) })).filter((g) => g.poly.length >= 3);
    let gates = [];
    try { gates = districtGates(list, { roads, inWater: waterTest(plan), seed: Number.isFinite(full.seed) ? full.seed : 1 }).get(f.id) ?? []; } catch { gates = []; }
    if (gates.length) return [];
  } else return [];
  // The route: from the nearest road point it can reach without running through anything, dry if one is near enough
  const solid = full.features.filter((g) => g.id !== f.id && g.id !== home?.id && (g.type === "district" || g.type === "square" || g.type === "building" || (g.type === "area" && g.class !== "fields" && g.class !== "woods") || (g.type === "water" && !Array.isArray(g.path) && g.shape))).map(shape).filter((p) => p.length >= 3).map((p) => ({ p, box: bbox(p) }));
  const blocked = (a, b) => solid.some(({ p, box }) => Math.max(a[0], b[0]) >= box[0] && Math.min(a[0], b[0]) <= box[2] && Math.max(a[1], b[1]) >= box[1] && Math.min(a[1], b[1]) <= box[3] && pathTouchesPolygon([a, b], p));
  const sq = full.size.ftPerSquare || 25;
  const waters = full.features.filter((g) => g.type === "water" && Array.isArray(g.path) && g.path.length >= 2).map((g) => ({ path: g.path, half: (g.width ?? 0) / sq / 2 }));
  const crossesWater = (a, b) => waters.some((w) => w.path.some((q, i) => i && segCross(a, b, w.path[i - 1], q)));
  // Along a river inside its banks without crossing it: no bridge would go there, so no lane either
  const skirts = (a, b) => waters.some((w) => !w.path.some((q, i) => i && segCross(a, b, w.path[i - 1], q)) && segmentNearPath(a, b, w.path, w.half));
  const [W, H] = full.size.squares;
  const cands = roads.flatMap((r) => [...pointsAlong(r.path), ...r.path.slice(1).map((b, i) => onSegment(target, r.path[i], b).at)])
    .filter((q) => q[0] >= 0 && q[1] >= 0 && q[0] <= W && q[1] <= H && !waters.some((w) => distanceToPath(q, w.path) < w.half + 1))
    .map((q) => ({ q, d: dist(q, target) })).filter((x) => x.d <= 60)
    .sort((x, y) => x.d - y.d || x.q[0] - y.q[0] || x.q[1] - y.q[1]);
  // The nearest clear one, and the nearest that's dry too if it's not much farther
  const ok = (x) => !blocked(x.q, target) && !skirts(x.q, target);
  const first = cands.find(ok);
  if (!first) return [];
  const dry = crossesWater(first.q, target) ? cands.find((x) => x.d <= first.d * 1.5 + 3 && !crossesWater(x.q, target) && ok(x)) : first;
  const pick = dry ?? first;
  const id = freeId(plan, cls);
  plan.features.push({ id, type: "road", class: cls, path: [r3(pick.q), [r1(target[0]), r1(target[1])]] });
  return [id, ...addCrossings(plan, plan.features[plan.features.length - 1])];
}

/** True when segment a-b crosses segment c-d. */
function segCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/**
 * The plan with a new feature made by a tool: points (corners, a path's points, or one point), or box [x0, y0, x1,
 * y1]. Returns { plan, id, crossings, access } (the bridges, fords and ways in added) or { error }.
 */
export function addFeature(plan, toolId, { points = [], box = null } = {}) {
  const tool = toolOf(toolId);
  if (!tool) return { error: `There's no tool "${toolId}".` };
  const next = structuredClone(plan);
  if (!Array.isArray(next.features)) next.features = [];
  const id = freeId(next, tool.base ?? tool.id);
  const f = { id, ...structuredClone(tool.make) };
  const sq = normalize(plan).size.ftPerSquare || 25;
  const pts = points.map((p) => [p[0], p[1]]);
  if (tool.geometry === "point") {
    if (!pts[0]) return { error: "Click where it goes." };
    f.at = [r1(pts[0][0]), r1(pts[0][1])];
    if (f.type === "label") { const angle = lineAngleAt(plan, f.at); if (angle) f.angle = angle; } // along a road or river it's on
  } else if (tool.geometry === "path") {
    // Points too close to the one before are one point
    const path = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > SAME);
    if (path.length < 2) return { error: "A line needs at least two points." };
    // A town wall or palisade ended on its first point is a closed loop
    if (tool.closes && path.length >= 4 && dist(path[0], path[path.length - 1]) <= SAME) path[path.length - 1] = [...path[0]];
    f.path = path;
  } else if (box) {
    if (Math.abs(box[2] - box[0]) < 0.1 || Math.abs(box[3] - box[1]) < 0.1) return { error: "Drag a bigger box (at least a tenth of a square each way)." };
    const [x0, y0, x1, y1] = [Math.min(box[0], box[2]), Math.min(box[1], box[3]), Math.max(box[0], box[2]), Math.max(box[1], box[3])].map((v) => Math.round(v * 1000) / 1000);
    // A pond or lake dragged as a box is the oval inside it (a sea's box keeps its straight coast)
    const r4 = (v) => Math.round(v * 1000) / 1000;
    // (a round building, a windmill, is the circle inside it)
    f.shape = tool.round ? { circle: [r4((x0 + x1) / 2), r4((y0 + y1) / 2), r4(Math.min(x1 - x0, y1 - y0) / 2)] }
      : f.type === "water" && f.class !== "sea" ? { ellipse: [r4((x0 + x1) / 2), r4((y0 + y1) / 2), r4((x1 - x0) / 2), r4((y1 - y0) / 2)] } : { rect: [x0, y0, x1, y1] };
  } else if (tool.geometry === "box") {
    // A click places a building of the tool's size, centered there
    if (!pts[0]) return { error: "Drag a box, or click where it goes." };
    const [w, d] = tool.size.map((ft) => ft / sq);
    const [cx, cy] = pts[0];
    f.shape = tool.round ? { circle: [r1(cx), r1(cy), r1(Math.min(w, d) / 2)] } : { rect: [r1(cx - w / 2), r1(cy - d / 2), r1(cx + w / 2), r1(cy + d / 2)] };
  } else {
    const shape = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > SAME);
    while (shape.length > 1 && dist(shape[0], shape[shape.length - 1]) <= SAME) shape.pop();
    if (shape.length < 3) return { error: "A shape needs at least three corners (or drag a box)." };
    f.shape = shape;
  }
  next.features.push(f);
  const problem = (SHAPED.has(f.type) || f.type === "water" || f.type === "height") && Array.isArray(f.shape) ? shapeProblem({ features: [{ ...f, type: f.type === "square" ? "area" : f.type }] }, id) : null;
  if (problem) return { error: problem };
  if (SHAPED.has(f.type) && f.type !== "square") shareSides(next, id);
  const crossings = addCrossings(next, f);
  const access = f.type === "district" || f.type === "square" ? addAccess(next, f) : [];
  // Only what the new feature brings: a plan that already had problems can still be drawn on
  const had = new Set(checkPlan(plan).filter((p) => p.level === "error").map((p) => p.message));
  const errors = checkPlan(next).filter((p) => p.level === "error" && !had.has(p.message));
  if (errors.length) return { error: errors.map((p) => p.message).join(" ") };
  return { plan: next, id, crossings, access };
}

/**
 * Wall in: a closed town wall around a district, its clear strip just outside the district's edge, so the
 * district keeps all its ground. Roads crossing it get gates when the map is drawn. Returns { plan, id } or
 * { error }.
 */
export function wallIn(plan, districtId) {
  const d = (plan?.features ?? []).find((f) => isObj(f) && f.id === districtId);
  if (!d || d.type !== "district") return { error: `There's no district "${districtId}".` };
  const n = normalize(plan);
  const sq = n.size.ftPerSquare || 25;
  const wall = { type: "wall", class: "town", straight: true };
  const reach = wallReach(wall, sq);
  let poly;
  try { poly = shapeToPolygon(d.shape); } catch { poly = []; }
  if (poly.length < 3) return { error: `District "${districtId}" has no outline to wall in.` };
  const grown = offset([poly], reach).reduce((a, b) => (!a || ringArea(b) > ringArea(a) ? b : a), null);
  if (!grown || ringArea(grown) <= ringArea(poly)) return { error: `District "${districtId}" is too small to wall in.` };
  // Rounded, with points that land on each other dropped, and closed on its first point
  const ring = grown.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]).filter((p, i, a) => i === 0 || dist(p, a[i - 1]) > SAME);
  while (ring.length > 1 && dist(ring[0], ring[ring.length - 1]) <= SAME) ring.pop();
  if (ring.length < 3) return { error: `District "${districtId}" is too small to wall in.` };
  const next = structuredClone(plan);
  const id = freeId(next, "wall");
  next.features.push({ id, ...wall, path: [...ring, [...ring[0]]] });
  const had = new Set(checkPlan(plan).filter((p) => p.level === "error").map((p) => p.message));
  const errors = checkPlan(next).filter((p) => p.level === "error" && !had.has(p.message));
  if (errors.length) return { error: errors.map((p) => p.message).join(" ") };
  return { plan: next, id };
}

function ringArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a / 2);
}
