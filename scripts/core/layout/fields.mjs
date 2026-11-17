/**
 * Field systems: an area of class "fields" filled with fields from a Voronoi diagram of points scattered over it
 * (d3-delaunay, in vendor/). Two systems:
 *
 * - patchwork: enclosed fields, each a cell (a few merged into bigger ones), hedged or walled along the roads, around
 *   the edge and on about a quarter of the sides between, the cells stretched along the area's long axis so fields
 *   run long as old enclosures do.
 * - strips: open furlongs plowed in long narrow strips, with grass balks between strips and headlands between
 *   furlongs; no hedges inside.
 *
 * Every field takes a crop for the season and a row direction; about a third are left as grass. The cells come from
 * the area's own shape and stream, so moving a road clips the fields but never reshuffles them. Pure; squares.
 */
import { cliffOf } from "../cliffs.mjs";
import { Delaunay } from "../../../vendor/d3-delaunay.mjs";
import { bands, difference, intersect, union, offset, shapes, area as areaOf, centroid } from "../lots/poly.mjs";
import { shapeToPolygon, pointInPolygon, bbox, distanceToPath, pathTouchesPolygon, insidePoint, segmentNearPath, pointsAlong } from "../geom.mjs";
import { poissonInPolygon } from "../scatter.mjs";
import { makeNoise } from "../noise.mjs";
import { isTownWall, wallReach, wallReachOut } from "./walls.mjs";

export const SYSTEMS = ["patchwork", "strips"];
export const CROPS = ["plowed", "growing", "ripe", "stubble", "hay", "pasture", "fallow"];

/** How likely each crop is, by season, in enclosed fields; open strips are arable, so pasture and hay are rare there. */
const CROP_MIX = {
  spring: { plowed: 3, growing: 4, pasture: 3, fallow: 1.5 },
  summer: { growing: 3, ripe: 2.5, hay: 1.5, pasture: 2.5, fallow: 1, plowed: 0.5 },
  autumn: { stubble: 3, plowed: 3, ripe: 0.7, pasture: 2.5, fallow: 1.5 },
  winter: { plowed: 4, stubble: 2, pasture: 3, fallow: 1 },
};
const STRIP_DAMP = { pasture: 0.15, hay: 0, fallow: 0.6 };

/**
 * A battle map's field: the whole area one field, a crop for the season (from r) and its rows along the area's longest
 * side. Returns the field ({ poly, holes, crop, angle, shade, variant, rows }) or null for an area with no shape.
 */
export function battleField(area, r, season = "summer") {
  const poly = shapeToPolygon(area.shape, area.rot ?? 0, 48);
  if (poly.length < 3) return null;
  const mix = Object.entries(CROP_MIX[season] ?? CROP_MIX.summer);
  let t = r.next() * mix.reduce((a, [, w]) => a + w, 0), crop = mix[mix.length - 1][0];
  for (const [c, w] of mix) if ((t -= w) < 0) { crop = c; break; }
  let best = 0, angle = 0;
  poly.forEach((a, i) => { const b = poly[(i + 1) % poly.length], d = Math.hypot(b[0] - a[0], b[1] - a[1]); if (d > best) { best = d; angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI; } });
  return { poly, holes: [], crop, angle, shade: r.range(-1, 1), variant: r.int(8), rows: ROWS[crop] ?? 0 };
}

/** The rows a crop shows: spacing in squares, or none. */
export const ROWS = { plowed: 0.3, growing: 0.26, ripe: 0.26, stubble: 0.3, hay: 1.2 };

/** Field and furlong sizes, in feet, when the plan gives none; a strip's width. */
const FIELD_FT = { patchwork: 300, strips: 450 };
const STRIP_FT = 60;
/** How far fields keep from things, in squares (beyond a road's or river's half width). */
const KEEP = { road: 0.5, water: 0.7, square: 0.3, building: 0.6, area: 0.15, wall: 0.4, lane: 0.35 };
/** The grass around a farmyard before the fields start, in feet, varying around it as a district's does. */
const FARM_MARGIN_FT = [30, 90];
/** An access lane: how wide, in feet, and the farthest a farm, yard, park or square can be from a road and still get one, in squares. */
const LANE_FT = 10, LANE_REACH = 40;
/** The grass around a district before the fields start, in feet: at least the first, up to the second, varying around it. */
const MARGIN_FT = [75, 200];
/** The share of a system's fields (or furlongs) that are cultivated when the plan gives no coverage; the rest is grass. */
const COVERAGE = 0.65;
/** The share of the sides between enclosed fields that carry a hedge or wall (roadsides and a system's own edge always do). */
const HEDGED = 0.25;

/**
 * What a field system keeps out of, as polygons from the plan alone: roads, water and docks at their widths, walls
 * and hedges, districts with a ragged margin (marginRound), squares, plan buildings, other areas and earlier field
 * systems. plan: normalized, its paths smoothed.
 */
export function fieldKeepOut(plan, self, memo = null) {
  // Only earlier field systems depend on which system asks, so with a memo (one per layout) the rest is worked out
  // once
  if (memo) {
    if (!memo.parts) memo.parts = keepOutParts(plan);
    const { bandsOut, each } = memo.parts;
    const out = [...bandsOut];
    let before = true;
    for (const { f, polys } of each) {
      if (f === self) { before = false; continue; }
      if (f.type === "area" && f.class === "fields" && !before) continue;
      out.push(...polys);
    }
    return out;
  }
  const { bandsOut, each } = keepOutParts(plan, self);
  return [...bandsOut, ...each.flatMap((e) => e.polys)];
}

/**
 * fieldKeepOut's pieces: the buffered paths, and each feature's polygons (in Clipper's winding) in plan order. With
 * self, only the field systems before it; without, every field system (for the memo to choose from).
 */
function keepOutParts(plan, self = undefined) {
  const ft = (v) => (v == null ? 0 : v / plan.size.ftPerSquare);
  const paths = [], each = [];
  let polys;
  const grown = (poly, by) => (by ? offset([poly], by) : [poly]);
  let before = true;
  for (const f of plan.features) {
    if (f === self) { before = false; continue; }
    polys = [];
    switch (f.type) {
      case "road":
        if (Array.isArray(f.path)) paths.push({ path: f.path, half: ft(f.width) / 2 + KEEP.road });
        break;
      case "water":
        // A stream or river a stretch at a time where its width varies (f._w, from the layout); a lake or the sea as
        // the layout draws its outline (f._poly), past its shore (f._keep)
        if (Array.isArray(f.path) && f._w) f.path.slice(1).forEach((b, i) => paths.push({ path: [f.path[i], b], half: Math.max(f._w[i], f._w[i + 1]) / 2 + KEEP.water }));
        else if (Array.isArray(f.path)) paths.push({ path: f.path, half: ft(f.width) / 2 + KEEP.water });
        else if (f._poly) polys.push(...grown(f._poly, KEEP.water + (f._keep ?? 0)));
        else if (f.shape) polys.push(...grown(shapeToPolygon(f.shape, f.rot ?? 0, 48), KEEP.water));
        break;
      case "dock":
        if (Array.isArray(f.path)) paths.push({ path: f.path, half: ft(f.width ?? 15) / 2 + KEEP.road });
        break;
      case "prop":
        // A tree, well or cart the plan placed: its own spot (a tree its crown)
        if (Array.isArray(f.at) && Number.isFinite(f.at[0]) && Number.isFinite(f.at[1])) polys.push(shapeToPolygon({ circle: [f.at[0], f.at[1], (f.class === "tree" ? 1 : 0.6) + KEEP.area] }, 0, 12));
        break;
      case "wall":
        // A town wall or palisade keeps its clear strip, and its ditch or moat, too
        // (a cliff its face and the rubble at its foot)
        if (Array.isArray(f.path) && f.class === "cliff" && f.path.length >= 2) { const k = cliffOf(f, plan.size.ftPerSquare).keep; paths.push({ path: k.path, half: k.half + KEEP.wall }); }
        else if (Array.isArray(f.path)) paths.push({ path: f.path, half: KEEP.wall + (isTownWall(f) ? Math.max(wallReach(f, plan.size.ftPerSquare), wallReachOut(f, plan.size.ftPerSquare)) : 0) });
        break;
      case "district":
        polys.push(...marginRound(plan, f));
        break;
      case "square":
        polys.push(...grown(shapeToPolygon(f.shape), KEEP.square));
        break;
      case "building":
        polys.push(...grown(shapeToPolygon(f.shape, f.rot ?? 0), KEEP.building));
        break;
      case "landmark":
        for (const b of f.buildings ?? []) polys.push(...grown(shapeToPolygon(b.shape, b.rot ?? 0), KEEP.building));
        break;
      case "area":
        if (f.class === "fields") { if (before || self === undefined) polys.push(shapeToPolygon(f.shape, f.rot ?? 0, 48)); }
        else if (f.class === "farmstead") polys.push(...marginRound(plan, f, FARM_MARGIN_FT));
        else polys.push(...grown(shapeToPolygon(f.shape, f.rot ?? 0, 48), KEEP.area));
        break;
      default:
        break;
    }
    // Every polygon in Clipper's own winding (a union of one), so a shape drawn the other way around can't cancel
    // another where they overlap
    if (polys.length) each.push({ f, polys: polys.filter((p) => p.length >= 3).flatMap((p) => union([p])) });
  }
  // A farm's (or a yard's, park's or square's) lane out to the road
  for (const lane of accessLanes(plan)) paths.push({ path: lane.path, half: lane.width / 2 + KEEP.lane });
  return { bandsOut: bands(paths), each };
}

/**
 * A district and the grass around it where fields don't come: its outline pushed out 75 to 200 feet, wandering by
 * noise from the plan's seed and the district's id (not its own seed, so a reroll never moves the fields).
 */
export function marginRound(plan, district, feet = MARGIN_FT) {
  const sq = plan.size.ftPerSquare;
  const [lo, hi] = feet.map((v) => v / sq);
  const rings = offset([shapeToPolygon(district.shape, district.rot ?? 0)], lo);
  if (!rings.length) return [];
  const ring = rings.reduce((a, b) => (areaOf(b) > areaOf(a) ? b : a));
  const noise = makeNoise(plan.seed, `${district.id}/margin`, { scale: 7, octaves: 2 });
  // A point every square or so, each pushed outward by its share of the extra
  const pts = [];
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length], n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1])));
    for (let k = 0; k < n; k++) pts.push([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]);
  });
  const ragged = pts.map((p, i) => {
    const a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length];
    let nx = b[1] - a[1], ny = -(b[0] - a[0]);
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    if (pointInPolygon([p[0] + nx * 0.3, p[1] + ny * 0.3], ring)) { nx = -nx; ny = -ny; } // outward
    const t = Math.max(0, Math.min(1, (noise(p[0], p[1]) + 0.6) / 1.2));
    return [p[0] + nx * (hi - lo) * t, p[1] + ny * (hi - lo) * t];
  });
  return union([ring, ragged]);
}

/** True when segment a-b crosses segment c-d. */
function crosses(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/**
 * Lanes to the roads: a straight track from each farmstead, and from each yard, park or square outside every district
 * with no road along it, to the nearest point on a plan road within LANE_REACH. None through water, a district,
 * another yard, park, farm or square, a plan building or a pond, off the map, or by a detour of more than a third
 * again (and 3 squares); woods and fields it may cross. From the plan alone, worked out once per plan. Returns [{ id,
 * from, path, width }]; ids end in /lane (a farm's) or /access.
 */
const laneCache = new WeakMap();
export function accessLanes(plan) {
  if (laneCache.has(plan)) return laneCache.get(plan);
  const sq = plan.size.ftPerSquare;
  const [W, H] = plan.size.squares;
  const roads = plan.features.filter((f) => f.type === "road" && Array.isArray(f.path) && f.path.length >= 2);
  const waters = plan.features.filter((f) => f.type === "water" && Array.isArray(f.path) && f.path.length >= 2).map((f) => ({ path: f.path, half: f._w ? Math.max(...f._w) / 2 : (f.width ?? 0) / sq / 2, box: bbox(f.path) }));
  const byWater = (q, w, d) => q[0] >= w.box[0] - d && q[0] <= w.box[2] + d && q[1] >= w.box[1] - d && q[1] <= w.box[3] + d && distanceToPath(q, w.path) < d;
  // Places a lane may meet a road: on the map, and not at the water's edge (a ford)
  const roadPts = roads.flatMap((r) => pointsAlong(r.path).map((q) => ({ q, half: (r.width ?? 0) / sq / 2 })))
    .filter(({ q }) => q[0] >= 0 && q[1] >= 0 && q[0] <= W && q[1] <= H && !waters.some((w) => byWater(q, w, w.half + 1)));
  const poly = (f) => { if (f._poly) return f._poly; try { return shapeToPolygon(f.shape, f.type === "area" || f.type === "building" || f.type === "water" ? f.rot ?? 0 : 0); } catch { return []; } };
  const roadBox = new Map(roads.map((r) => [r, bbox(r.path)]));
  const districts = plan.features.filter((f) => f.type === "district").map(poly).filter((d) => d.length >= 3);
  const farms = plan.features.filter((f) => f.type === "area" && f.class === "farmstead").map((f) => ({ id: f.id, pts: poly(f) })).filter((x) => x.pts.length >= 3).map((x) => ({ ...x, ring: [...x.pts, x.pts[0]] }));
  // Through water, or along it inside its banks
  const wet = (a, b) => waters.some((w) => w.path.some((q, i) => i && crosses(a, b, w.path[i - 1], q)) || segmentNearPath(a, b, w.path, w.half));
  // What a lane mustn't run through: districts (their houses), the other yards, parks, farms and squares, plan
  // buildings (a landmark's too) and ponds
  const solid = [];
  for (const f of plan.features) {
    if (f.type === "district" || f.type === "square" || (f.type === "area" && f.class !== "fields" && f.class !== "woods") || f.type === "building" || (f.type === "water" && !Array.isArray(f.path) && f.shape))
      solid.push({ id: f.id, poly: poly(f), water: f.type === "water" });
    if (f.type === "landmark") for (const b of f.buildings ?? []) solid.push({ id: f.id, poly: poly({ ...b, type: "building" }) });
  }
  const walls = solid.filter((x) => x.poly.length >= 3).map((x) => ({ ...x, box: bbox(x.poly), ring: [...x.poly, x.poly[0]] }));
  const townWalls = plan.features.filter((f) => isTownWall(f) && Array.isArray(f.path) && f.path.length >= 2);
  const cliffs = plan.features.filter((f) => f.type === "wall" && f.class === "cliff" && Array.isArray(f.path) && f.path.length >= 2).map((f) => cliffOf(f, sq).keep);
  const out = [];
  for (const f of plan.features) {
    const farm = f.type === "area" && f.class === "farmstead";
    // (and a watermill or windmill out in the country: a faint track to it from the road)
    const mill = f.type === "building" && (f.use === "watermill" || f.use === "windmill");
    const other = (f.type === "area" && (f.class === "yard" || f.class === "park" || f.class === "cemetery")) || f.type === "square" || mill;
    if (!farm && !other) continue;
    const pts = poly(f);
    if (pts.length < 3) continue;
    const ring = [...pts, pts[0]];
    const [x0, y0, x1, y1] = bbox(pts);
    const ponds = walls.filter((x) => x.water);
    let c = insidePoint(pts);
    if (!farm && districts.some((d) => pointInPolygon(c, d))) continue; // the district's streets reach it
    // (a mill in a yard or farm of its own is reached by that one's lane)
    if (mill && plan.features.some((g) => g.type === "area" && (g.class === "yard" || g.class === "farmstead") && pointInPolygon(c, poly(g)))) continue;
    if (!farm && farms.some((x) => pts.some((q) => distanceToPath(q, x.ring) < 1) || x.ring.some((q) => distanceToPath(q, ring) < 1))) continue; // a farm's yard: the farm's lane serves it
    // Already on a road: one runs through it or along it (a park's paths meet a road whose side averages within 2.5
    // squares of a side of it, as fillPark finds them)
    const meets = (b, m) => b[2] >= x0 - m && b[0] <= x1 + m && b[3] >= y0 - m && b[1] <= y1 + m;
    if (roads.some((r) => meets(roadBox.get(r), f.class === "park" ? 27.5 : 0.6) && (pathTouchesPolygon(r.path, pts) || (f.class === "park" ? sideAlong(pts, r.path) : r.path.some((q) => distanceToPath(q, ring) < 0.6) || pts.some((q) => distanceToPath(q, r.path) < 0.6))))) continue;
    // What it mustn't run through: anything apart from what stands in it or beside it (a farm's own yard and barns)
    const own = (x) => x.id === f.id || (!x.water && meets(x.box, 1) && x.poly.some((q) => pointInPolygon(q, pts) || distanceToPath(q, ring) < 1)); // never a pond beside it
    const blockers = walls.filter((x) => !own(x));
    // (nor through a town wall: only the plan's roads get gates)
    const blocked = (a, b) => blockers.some((x) => Math.max(a[0], b[0]) >= x.box[0] && Math.min(a[0], b[0]) <= x.box[2] && Math.max(a[1], b[1]) >= x.box[1] && Math.min(a[1], b[1]) <= x.box[3] && pathTouchesPolygon([a, b], x.poly))
      || townWalls.some((w) => w.path.some((q, i) => i && crosses(a, b, w.path[i - 1], q)))
      || cliffs.some((k) => segmentNearPath(a, b, k.path, k.half)); // (nor up or down a cliff)
    // Every road point in reach, then those within the detour allowed of the nearest
    const near = roadPts.filter(({ q }) => q[0] >= x0 - LANE_REACH && q[0] <= x1 + LANE_REACH && q[1] >= y0 - LANE_REACH && q[1] <= y1 + LANE_REACH);
    // A yard whose middle is in its pond starts from the dry point in it nearest a road in reach (tried on a grid of
    // at most about 60 points a side)
    if (ponds.some((x) => pointInPolygon(c, x.poly))) {
      let best = null;
      const step = Math.max(0.5, Math.max(x1 - x0, y1 - y0) / 60);
      const toRoad = (q) => near.reduce((m, r) => Math.min(m, Math.hypot(r.q[0] - q[0], r.q[1] - q[1])), Infinity);
      for (let gx = x0 + step / 2; gx <= x1; gx += step) for (let gy = y0 + step / 2; gy <= y1; gy += step) {
        const q = [gx, gy];
        if (!pointInPolygon(q, pts) || ponds.some((x) => pointInPolygon(q, x.poly) || distanceToPath(q, x.ring) < 0.5)) continue;
        const d = toRoad(q);
        if (!best || d < best.d) best = { q, d };
      }
      if (best) c = best.q;
    }
    // Where it leaves from: the middle of the yard (the lane starts at its edge), or a park's side middles
    // (never from a side's middle that's in a river or a pond)
    const starts = (f.class === "park" || f.class === "cemetery" ? pts.map((q, i) => { const n = pts[(i + 1) % pts.length]; return { from: [(q[0] + n[0]) / 2, (q[1] + n[1]) / 2], edge: true }; }) : [{ from: c, edge: false }])
      .filter((st) => !st.edge || (!waters.some((w) => byWater(st.from, w, w.half + 0.3)) && !ponds.some((x) => pointInPolygon(st.from, x.poly))));
    const cands = [];
    for (const st of starts) for (const { q, half } of near) {
      const d = Math.hypot(q[0] - st.from[0], q[1] - st.from[1]);
      if (d > LANE_REACH || d === 0) continue;
      cands.push({ d, q, st, half });
    }
    if (!cands.length) continue;
    // the road behind a park (reached through it) doesn't count
    const behind = (x) => x.st.edge && pointInPolygon([x.st.from[0] + ((x.q[0] - x.st.from[0]) / x.d) * 0.3, x.st.from[1] + ((x.q[1] - x.st.from[1]) / x.d) * 0.3], pts);
    const order = (a, b) => a.d - b.d || a.q[0] - b.q[0] || a.q[1] - b.q[1];
    const within = (lim) => cands.filter((x) => x.d <= lim).sort(order);
    // Sorting only what's near enough to matter (a round park has many sides, each its own start)
    const least = cands.reduce((m, x) => Math.min(m, x.d), Infinity);
    let list = within(least + Math.max(3, least / 3));
    let first = list.find((x) => !behind(x));
    if (!first) { list = within(LANE_REACH); first = list.find((x) => !behind(x)); }
    if (!first) continue;
    const cap = first.d + Math.max(3, first.d / 3); // no lane rather than a long way around
    if (cap > list.at(-1).d) list = within(cap);
    // (a mill's track may cross its own race or a stream by a plank: only water wider than a square stops it)
    const wetHere = mill ? (a, b) => waters.some((w) => w.half > 0.5 && (w.path.some((q, i) => i && crosses(a, b, w.path[i - 1], q)) || segmentNearPath(a, b, w.path, w.half))) : wet;
    const best = list.find((x) => x.d >= first.d && x.d <= cap && !behind(x) && !wetHere(x.st.from, x.q) && !blocked(x.st.from, x.q));
    if (!best) continue;
    const { st, q } = best;
    const dir = [(q[0] - st.from[0]) / best.d, (q[1] - st.from[1]) / best.d];
    let t = 0;
    if (!st.edge) while (t < best.d && pointInPolygon([st.from[0] + dir[0] * t, st.from[1] + dir[1] * t], pts)) t += 0.05;
    const end = Math.max(t, best.d - best.half * 0.5);
    if (end - t < 0.3) continue; // it's on the road
    out.push({ id: `${f.id}/${farm ? "lane" : "access"}`, from: f.id, path: [[st.from[0] + dir[0] * t, st.from[1] + dir[1] * t], [st.from[0] + dir[0] * end, st.from[1] + dir[1] * end]], width: LANE_FT / sq });
  }
  laneCache.set(plan, out);
  return out;
}

/** True when a road runs along a side of a polygon: within 2.5 squares of it, on average (fillPark's test). */
export function sideAlong(poly, path) {
  // Only the stretch of road near enough to matter: a side averaging within 2.5 has no point more than 27.5 off
  const [x0, y0, x1, y1] = bbox(poly), m = 27.5;
  const segs = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    if (Math.max(a[0], b[0]) >= x0 - m && Math.min(a[0], b[0]) <= x1 + m && Math.max(a[1], b[1]) >= y0 - m && Math.min(a[1], b[1]) <= y1 + m) segs.push([a, b]);
  }
  if (!segs.length) return false;
  const far = (p) => Math.min(...segs.map((s) => distanceToPath(p, s)));
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    let sum = 0;
    for (let k = 0; k <= 10; k++) sum += far([a[0] + ((b[0] - a[0]) * k) / 10, a[1] + ((b[1] - a[1]) * k) / 10]);
    if (sum / 11 <= 2.5) return true;
  }
  return false;
}

export const farmLanes = (plan) => accessLanes(plan).filter((l) => l.id.endsWith("/lane"));

/** The plan's roads as fields see them: { path, half }, half being how far the fields keep from the road's middle. */
export function fieldRoads(plan) {
  return plan.features.filter((f) => f.type === "road" && Array.isArray(f.path)).map((f) => ({ path: f.path, half: (f.width ?? 0) / plan.size.ftPerSquare / 2 + KEEP.road }));
}

/** The shapes of the field systems listed before this one: the edge this one takes from them already has a border. */
export function earlierFields(plan, self) {
  const out = [];
  for (const f of plan.features) {
    if (f === self) break;
    if (f.type === "area" && f.class === "fields") out.push(shapeToPolygon(f.shape, f.rot ?? 0, 48));
  }
  return out;
}

/**
 * Fills one field system. area: the plan's area; r: its stream; keepOut: fieldKeepOut's; earlier: earlierFields' (no
 * border along their edges); along: the roads ([{ path, half }]), always hedged; W, H: the map in squares;
 * ftPerSquare; season. Returns { system, fields, hedges, walls, balks, trees, notes }: fields [{ poly, holes, crop,
 * angle, shade, variant, rows }] (angle: their rows' direction in degrees; rows: spacing in squares, 0 for none;
 * shade: -1 to 1), hedges and walls (paths), balks (grass lines), trees (hedgerow trees to place: [{ x, y, s, rot,
 * variant }]).
 */
export function fillFields({ area, r, keepOut, earlier = [], along = [], W, H, ftPerSquare, season = "summer" }) {
  const notes = [];
  const out = { system: null, fields: [], hedges: [], walls: [], balks: [], trees: [], notes };
  const shape = shapeToPolygon(area.shape, area.rot ?? 0, 48);
  // Every choice drawn up front, so the stream is the same whatever the land turns out to be
  const sysDraw = r.next(), borderDraw = r.next(), grainDraw = r.next(), jitter = r.range(-12, 12);
  const system = SYSTEMS.includes(area.system) ? area.system : sysDraw < 0.5 ? "patchwork" : "strips";
  out.system = system;
  if (shape.length < 3) return out;
  const border = area.border ?? (system === "strips" ? "none" : borderDraw < 0.65 ? "hedge" : "drystone");
  const coverage = Number.isFinite(area.coverage) ? Math.max(0, Math.min(1, area.coverage)) : COVERAGE;

  // The land: the shape on the map, less what it keeps out of, with slivers under a square across opened away
  const mapRect = [[0, 0], [W, 0], [W, H], [0, H]];
  const onMap = intersect([shape], [mapRect]);
  if (!onMap.length) {
    notes.push({ level: "warning", id: area.id, message: `"${area.id}" lies off the map, so it has no fields.` });
    return out;
  }
  let landFlat = difference(onMap, keepOut);
  landFlat = offset(offset(landFlat, -0.5), 0.5);
  const land = shapes(landFlat).filter((s) => areaOf(s.outer) - s.holes.reduce((a, h) => a + areaOf(h), 0) >= 2);
  landFlat = land.flatMap((s) => [s.outer, ...s.holes]);
  if (!land.length) {
    notes.push({ level: "warning", id: area.id, message: `"${area.id}": nothing's left of it once the roads, water and buildings are kept clear, so it has no fields.` });
    return out;
  }

  // The grain: along the shape's long axis (its outline's main direction, weighted by length), so it comes from the
  // area alone and moving a road never turns its fields; a shape with no long axis takes one from its seed
  const [sx0, sy0, sx1, sy1] = bbox(shape);
  const mid = [(sx0 + sx1) / 2, (sy0 + sy1) / 2];
  let sxx = 0, syy = 0, sxy = 0;
  shape.forEach((p, i) => {
    const q = shape[(i + 1) % shape.length], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy);
    if (!l) return;
    sxx += (dx * dx) / l; syy += (dy * dy) / l; sxy += (dx * dy) / l;
  });
  const spread = Math.hypot(sxx - syy, 2 * sxy) / (sxx + syy || 1);
  let grain = spread > 0.08 ? (Math.atan2(2 * sxy, sxx - syy) * 90) / Math.PI : grainDraw * 180;
  grain += jitter;

  // Cells: points scattered over the shape in a frame turned to the grain and squashed along it, so the cells come out
  // long along the grain; one round of relaxing (Lloyd) evens them without making a honeycomb
  const size = (area.fieldSize ?? FIELD_FT[system]) / ftPerSquare;
  const stretch = system === "patchwork" ? 1.6 : 1.15;
  const a = (grain * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const toT = ([x, y]) => { const dx = x - mid[0], dy = y - mid[1]; return [(dx * ca + dy * sa) / stretch, -dx * sa + dy * ca]; };
  const fromT = ([u, v]) => { const x = u * stretch; return [mid[0] + x * ca - v * sa, mid[1] + x * sa + v * ca]; };
  const shapeT = shape.map(toT);
  // Fields no smaller than a few hundred cells would make: a huge area at a small fieldSize gets bigger fields (said in
  // the notes) rather than running out of cells halfway across
  const MAX_CELLS = 400;
  let radius = (size / Math.sqrt(stretch)) * 0.8;
  const wanted = areaOf(shapeT) / (radius * radius * 1.3);
  if (wanted > MAX_CELLS) {
    radius *= Math.sqrt(wanted / MAX_CELLS);
    notes.push({ level: "info", id: area.id, message: `"${area.id}" is big for fields of that size, so its fields are about ${Math.round(Math.sqrt(wanted / MAX_CELLS) * 10) / 10} times as big.` });
  }
  let seeds = poissonInPolygon(shapeT, radius, r.fork("seeds"), { max: MAX_CELLS * 2 });
  if (seeds.length < 2) seeds = [centroid(shapeT), ...seeds].slice(0, Math.max(1, seeds.length));
  const [tx0, ty0, tx1, ty1] = bbox(shapeT);
  const bounds = [tx0 - 1, ty0 - 1, tx1 + 1, ty1 + 1];
  const cellsOf = (pts) => {
    if (pts.length === 1) return [[[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]]]];
    const vor = Delaunay.from(pts).voronoi(bounds);
    return pts.map((_, i) => (vor.cellPolygon(i) ?? []).slice(0, -1));
  };
  if (seeds.length > 1) {
    seeds = cellsOf(seeds).map((cell, i) => {
      const inside = intersect([cell], [shapeT]);
      if (!inside.length) return seeds[i];
      return centroid(inside.reduce((p, q) => (areaOf(q) > areaOf(p) ? q : p)));
    });
  }
  const cellsT = cellsOf(seeds);
  const cells = cellsT.map((c) => c.map(fromT));

  // The sides two cells share (keyed by their ends, as d3 gives the same corner to both cells)
  const key = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const sides = new Map();
  cellsT.forEach((cell, i) => cell.forEach((p, k) => {
    const q = cell[(k + 1) % cell.length];
    const id = [key(p), key(q)].sort().join("|");
    const s = sides.get(id) ?? { id, a: fromT(p), b: fromT(q), cells: [] };
    s.cells.push(i);
    sides.set(id, s);
  }));
  const inner = [...sides.values()].filter((s) => s.cells.length === 2);

  const mix = CROP_MIX[season] ?? CROP_MIX.summer;
  const pickCrop = (rr, damp = {}) => {
    const list = Object.entries(mix).map(([c, w]) => [c, w * (damp[c] ?? 1)]).filter(([, w]) => w > 0);
    let t = rr.next() * list.reduce((s, [, w]) => s + w, 0);
    for (const [c, w] of list) if ((t -= w) < 0) return c;
    return list[list.length - 1][0];
  };

  if (system === "patchwork") {
    // A few neighbors merged into one bigger field (never more than three cells), so not every field is a cell
    const group = cells.map((_, i) => i);
    const find = (i) => (group[i] === i ? i : (group[i] = find(group[i])));
    const count = cells.map(() => 1);
    const mr = r.fork("merge");
    for (const s of inner) {
      const draw = mr.next();
      const [i, j] = s.cells.map(find);
      if (i === j || draw > 0.15 || count[i] + count[j] > 3) continue;
      group[j] = i;
      count[i] += count[j];
    }
    const groups = new Map(), open = new Set();
    cells.forEach((c, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); });
    for (const [g, list] of [...groups].sort((x, y) => x[0] - y[0])) {
      const fr = r.fork("field", g);
      const crop = pickCrop(fr);
      const angle = grain + (fr.chance(0.6) ? 0 : 90) + fr.range(-8, 8);
      const shade = fr.range(-1, 1), variant = fr.int(8);
      // Some fields left as grass (pasture, common, rough ground), so the land isn't cultivated wall to wall
      if (fr.next() >= coverage) { open.add(g); continue; }
      const whole = list.length > 1 ? union(list) : list;
      for (const piece of shapes(intersect(whole, landFlat))) {
        if (sliver(piece, 3)) continue; // a scrap the roads and margins cut off is left as grass
        out.fields.push({ poly: piece.outer, holes: piece.holes, crop, angle, shade, variant, rows: ROWS[crop] ?? 0 });
      }
    }
    // Borders: every side between two fields (or a field and grass), and around the fields at the land's edge, except
    // along the map's edge and along an earlier field system (whose own border runs there). Grass meets grass unbounded
    const bordered = (s) => { const [i, j] = s.cells.map(find); return i !== j && !(open.has(i) && open.has(j)); };
    const openAt = (p) => { const i = cells.findIndex((c) => pointInPolygon(p, c)); return i >= 0 && open.has(find(i)); };
    // Not every border is a hedge or wall: those along a road and around the system's edge are, and about a quarter
    // of the sides between fields; the rest are a faint grass edge, as are edges facing a village, water or a wood
    const walled = (s) => border !== "none" && r.fork("side", s.id).chance(HEDGED);
    const shapeRing = [...shape, shape[0]];
    const onRoad = (m) => along.some((w) => distanceToPath(m, w.path) < w.half + 0.3);
    const edges = [], faint = [];
    for (const s of inner) if (bordered(s)) (walled(s) ? edges : faint).push(...clipSegment(s.a, s.b, land));
    for (const [p, q] of outlineOf(land, W, H, earlier)) {
      const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      if (openAt(m)) continue;
      (border !== "none" && (onRoad(m) || distanceToPath(m, shapeRing) < 0.3) ? edges : faint).push([p, q]);
    }
    const paths = joinSegments(edges).filter((p) => pathLen(p) >= 0.6);
    if (border === "hedge") out.hedges.push(...paths);
    else if (border === "drystone") out.walls.push(...paths);
    out.balks.push(...trimLines(faint, out.fields, false));
    // A tree in the hedgerow every so often: laid along each hedged side between two fields from that side's own
    // stream, so moving a road or a district never moves the trees on sides it doesn't reach
    if (border === "hedge") {
      for (const s of inner) {
        if (!bordered(s) || !walled(s)) continue;
        const tr = r.fork("hedgerow tree", s.id);
        const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
        for (let d = tr.range(2, 8); d < len - 1; d += tr.range(5, 11)) {
          const keep = tr.chance(0.35), sz = 0.5 + tr.next() * 0.3, rot = tr.next() * 360, variant = tr.int(8);
          const x = s.a[0] + ((s.b[0] - s.a[0]) * d) / len, y = s.a[1] + ((s.b[1] - s.a[1]) * d) / len;
          if (keep && inLand([x, y], land)) out.trees.push({ x, y, s: sz, rot, variant });
        }
      }
    }
  } else {
    // Open fields: each cell a furlong of strips with the grain or across it, laid across the whole cell (each
    // drawing its choices) before trimming to the land, so a road taking a corner never moves the rest
    const stripW = STRIP_FT / ftPerSquare;
    const openF = new Set();
    cells.forEach((cell, i) => {
      const fr = r.fork("furlong", i);
      const turn = fr.chance(0.5) ? 0 : 90;
      const dir = grain + turn + fr.range(-6, 6);
      const furlongCrop = pickCrop(fr, STRIP_DAMP);
      // Some furlongs left as common grazing
      if (fr.next() >= coverage) { openF.add(i); return; }
      const sr = fr.fork("strips");
      const d = (dir * Math.PI) / 180, cd = Math.cos(d), sd = Math.sin(d);
      const toF = ([x, y]) => [x * cd + y * sd, -x * sd + y * cd];
      const fromF = ([u, v]) => [u * cd - v * sd, u * sd + v * cd];
      const pieces = shapes(intersect([cell], landFlat)).filter((pc) => areaOf(pc.outer) >= 1);
      const piecesFlat = pieces.flatMap((pc) => [pc.outer, ...pc.holes]);
      const [u0, v0, u1, v1] = bbox(cell.map(toF));
      let v = v0 - sr.next() * stripW;
      const kept = [], cuts = [];
      while (v < v1) {
        const w = stripW * sr.range(0.8, 1.25);
        const crop = sr.chance(0.7) ? furlongCrop : pickCrop(sr, STRIP_DAMP);
        const shade = sr.range(-1, 1), variant = sr.int(8);
        if (pieces.length) {
          const band = [[u0 - 1, v], [u1 + 1, v], [u1 + 1, v + w], [u0 - 1, v + w]].map(fromF);
          for (const strip of shapes(intersect([band], piecesFlat))) {
            if (sliver(strip, stripW * stripW * 1.5)) continue; // a stub of a strip, shorter than it is wide, is grass
            const f = { poly: strip.outer, holes: strip.holes, crop, angle: dir, shade, variant, rows: ROWS[crop] ?? 0, strip: true };
            out.fields.push(f);
            kept.push(f);
          }
          if (v + w < v1) cuts.push(...clipSegment(fromF([u0 - 1, v + w]), fromF([u1 + 1, v + w]), pieces));
        }
        v += w;
      }
      // A balk only runs between two strips that are there (a stub left as grass takes its balk with it)
      out.balks.push(...trimLines(cuts, kept, true));
    });
    // Headlands between furlongs, and the border (if any) around the land
    const headlands = [];
    for (const s of inner) if (!(openF.has(s.cells[0]) && openF.has(s.cells[1]))) headlands.push(...clipSegment(s.a, s.b, land));
    out.balks.push(...trimLines(headlands, out.fields, false));
    if (border !== "none") {
      const inOpen = (p) => { const i = cells.findIndex((c) => pointInPolygon(p, c)); return i >= 0 && openF.has(i); };
      const paths = joinSegments(outlineOf(land, W, H, earlier).filter(([p, q]) => !inOpen([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]))).filter((p) => pathLen(p) >= 0.6);
      (border === "hedge" ? out.hedges : out.walls).push(...paths);
    }
  }
  return out;
}

/**
 * The parts of some lines that run beside fields: each line cut into pieces about a square long, a piece kept when there
 * is a field on both sides of it (both) or on at least one, and the pieces joined back into paths.
 */
function trimLines(segs, fields, both) {
  const inField = (p) => fields.some((f) => pointInPolygon(p, f.poly) && !(f.holes ?? []).some((h) => pointInPolygon(p, h)));
  const keep = [];
  for (const [a, b] of segs) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(len > 0)) continue;
    const n = Math.max(1, Math.ceil(len)), nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
    for (let k = 0; k < n; k++) {
      const p = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n], q = [a[0] + ((b[0] - a[0]) * (k + 1)) / n, a[1] + ((b[1] - a[1]) * (k + 1)) / n];
      const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const l = inField([m[0] + nx * 0.4, m[1] + ny * 0.4]), r = inField([m[0] - nx * 0.4, m[1] - ny * 0.4]);
      if (both ? l && r : l || r) keep.push([p, q]);
    }
  }
  return joinSegments(keep);
}

/** True for a piece too small (under min square squares) or too thin (under about a square across) to be a field. */
function sliver({ outer, holes = [] }, min) {
  const a = areaOf(outer) - holes.reduce((t, h) => t + areaOf(h), 0);
  const perim = outer.reduce((t, p, i) => { const q = outer[(i + 1) % outer.length]; return t + Math.hypot(q[0] - p[0], q[1] - p[1]); }, 0);
  return a < min || (2 * a) / (perim || 1) < 0.5;
}

/** The land's outline as segments, leaving out the stretches along the map's edge and along an earlier system's edge. */
function outlineOf(land, W, H, earlier = []) {
  const onEdge = (p, q) => [[0, 0], [1, 0], [0, W], [1, H]].some(([axis, at]) => Math.abs(p[axis] - at) < 0.02 && Math.abs(q[axis] - at) < 0.02);
  const rings = earlier.map((e) => [...e, e[0]]);
  const onEarlier = (p, q) => {
    const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    return rings.some((ring) => [p, m, q].every((x) => distanceToPath(x, ring) < 0.1));
  };
  const out = [];
  for (const s of land) for (const ring of [s.outer, ...s.holes]) ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    if (!onEdge(p, q) && !onEarlier(p, q)) out.push([p, q]);
  });
  return out;
}

/** True when a point is on the land: inside an outer ring and outside its holes. */
function inLand(p, pieces) {
  return pieces.some((s) => pointInPolygon(p, s.outer) && !s.holes.some((h) => pointInPolygon(p, h)));
}

/** The parts of segment a-b inside the land (pieces: [{ outer, holes }]), as segments. */
export function clipSegment(a, b, pieces) {
  const ts = [0, 1];
  for (const s of pieces) for (const ring of [s.outer, ...s.holes]) for (let i = 0; i < ring.length; i++) {
    const t = crossAt(a, b, ring[i], ring[(i + 1) % ring.length]);
    if (t !== null) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const out = [];
  let open = null;
  for (let i = 1; i < ts.length; i++) {
    if (ts[i] - ts[i - 1] < 1e-9) continue;
    if (inLand(at((ts[i - 1] + ts[i]) / 2), pieces)) {
      if (open && Math.abs(open[1] - ts[i - 1]) < 1e-9) open[1] = ts[i];
      else { if (open) out.push(open); open = [ts[i - 1], ts[i]]; }
    }
  }
  if (open) out.push(open);
  return out.map(([t0, t1]) => [at(t0), at(t1)]).filter(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.05);
}

/** Where along a-b (0 to 1) it crosses c-d, or null. */
function crossAt(a, b, c, d) {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - a[0], qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : null;
}

/** Segments joined end to end into paths where they meet (two at a point; a corner where three meet ends them). */
export function joinSegments(segs) {
  const k = (p) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
  const at = new Map();
  segs.forEach((s, i) => { for (const p of s) { const id = k(p); if (!at.has(id)) at.set(id, []); at.get(id).push(i); } });
  const used = new Set();
  const out = [];
  const extend = (path) => {
    for (;;) {
      const end = path[path.length - 1], here = at.get(k(end)) ?? [];
      if (here.length !== 2) return;
      const j = here.find((i) => !used.has(i));
      if (j === undefined) return;
      used.add(j);
      const [p, q] = segs[j];
      path.push(k(p) === k(end) ? q : p);
    }
  };
  segs.forEach((s, i) => {
    if (used.has(i)) return;
    used.add(i);
    const path = [s[0], s[1]];
    extend(path);
    path.reverse();
    extend(path);
    out.push(path);
  });
  return out;
}

const pathLen = (p) => p.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);
