/**
 * Field systems: an area of class "fields" filled with fields, from a Voronoi diagram of points scattered over it
 * (d3-delaunay, bundled in vendor/). Two systems:
 *
 * - patchwork: enclosed fields, each a Voronoi cell (a few merged with a neighbour into one bigger field), hedged or
 *   walled along the roads, round the system's edge and on about a quarter of the sides between them (the rest a faint
 *   grass edge), with a tree in the hedgerow here and there. The cells are stretched along the
 *   system's grain (the area's long axis), so fields run long and their sides fall roughly parallel, as old enclosures do.
 * - strips: open fields. The cells are furlongs, each ploughed in long narrow strips running one way or the other
 *   across the grain, with grass balks between the strips and headlands between the furlongs. No hedges inside.
 *
 * Every field takes a crop for the season (ploughed, growing, ripe, stubble, hay, pasture, fallow) and the way its
 * rows run; about a third of the fields (or furlongs) are left as grass, by the area's coverage, so the land isn't
 * cultivated wall to wall. The cells come from the area's own shape and stream, never from what's round it, so moving
 * a road clips the fields differently but never reshuffles them; the land a system fills is its shape less the roads,
 * water, districts and a ragged margin of grass round each, squares, yards, other areas, buildings and the fields
 * systems listed before it. Pure: runs anywhere.
 * Numbers are in squares.
 */
import { Delaunay } from "../../../vendor/d3-delaunay.mjs";
import { bands, difference, intersect, union, offset, shapes, area as areaOf, centroid } from "../lots/poly.mjs";
import { shapeToPolygon, pointInPolygon, bbox, distanceToPath } from "../geom.mjs";
import { poissonInPolygon } from "../scatter.mjs";
import { makeNoise } from "../noise.mjs";

export const SYSTEMS = ["patchwork", "strips"];
export const CROPS = ["ploughed", "growing", "ripe", "stubble", "hay", "pasture", "fallow"];

/** How likely each crop is, by season, in enclosed fields; open strips are arable, so pasture and hay are rare there. */
const CROP_MIX = {
  spring: { ploughed: 3, growing: 4, pasture: 3, fallow: 1.5 },
  summer: { growing: 3, ripe: 2.5, hay: 1.5, pasture: 2.5, fallow: 1, ploughed: 0.5 },
  autumn: { stubble: 3, ploughed: 3, ripe: 0.7, pasture: 2.5, fallow: 1.5 },
  winter: { ploughed: 4, stubble: 2, pasture: 3, fallow: 1 },
};
const STRIP_DAMP = { pasture: 0.15, hay: 0, fallow: 0.6 };

/** The rows a crop shows: spacing in squares, or none. */
export const ROWS = { ploughed: 0.3, growing: 0.26, ripe: 0.26, stubble: 0.3, hay: 1.2 };

/** Field and furlong sizes, in feet, when the plan gives none; a strip's width. */
const FIELD_FT = { patchwork: 300, strips: 450 };
const STRIP_FT = 60;
/** How far fields keep from things, in squares (beyond a road's or river's half width). */
const KEEP = { road: 0.5, water: 0.7, square: 0.3, building: 0.6, area: 0.15, wall: 0.4, lane: 0.35 };
/** The grass round a farmyard before the fields start, in feet, varying round it as a district's does. */
const FARM_MARGIN_FT = [30, 90];
/** A farm lane: how wide, in feet, and the farthest a farmyard can be from a road and still get one, in squares. */
const LANE_FT = 10, LANE_REACH = 12;
/** The grass round a district before the fields start, in feet: at least the first, up to the second, varying round it. */
const MARGIN_FT = [75, 200];
/** The share of a system's fields (or furlongs) that are cultivated when the plan gives no coverage; the rest is grass. */
const COVERAGE = 0.65;
/** The share of the sides between enclosed fields that carry a hedge or wall (roadsides and a system's own edge always do). */
const HEDGED = 0.25;

/**
 * What a field system keeps out of: polygons, from the plan alone (roads and water at their widths, walls and hedges,
 * districts with a ragged margin of grass round them (marginRound), squares, plan buildings, other areas, and the fields systems listed before this one). plan: normalized, its paths
 * smoothed (as the layout has it).
 */
export function fieldKeepOut(plan, self) {
  const ft = (v) => (v == null ? 0 : v / plan.size.ftPerSquare);
  const paths = [], polys = [];
  const grown = (poly, by) => (by ? offset([poly], by) : [poly]);
  let before = true;
  for (const f of plan.features) {
    if (f === self) { before = false; continue; }
    switch (f.type) {
      case "road":
        if (Array.isArray(f.path)) paths.push({ path: f.path, half: ft(f.width) / 2 + KEEP.road });
        break;
      case "water":
        if (Array.isArray(f.path)) paths.push({ path: f.path, half: ft(f.width) / 2 + KEEP.water });
        else if (f.shape) polys.push(...grown(shapeToPolygon(f.shape, f.rot ?? 0, 48), KEEP.water));
        break;
      case "wall":
        if (Array.isArray(f.path)) paths.push({ path: f.path, half: KEEP.wall });
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
        if (f.class === "fields") { if (before) polys.push(shapeToPolygon(f.shape, f.rot ?? 0, 48)); }
        else if (f.class === "farmstead") polys.push(...marginRound(plan, f, FARM_MARGIN_FT));
        else polys.push(...grown(shapeToPolygon(f.shape, f.rot ?? 0, 48), KEEP.area));
        break;
      default:
        break;
    }
  }
  // A farm's lane out to the road
  for (const lane of farmLanes(plan)) paths.push({ path: lane.path, half: lane.width / 2 + KEEP.lane });
  // Every polygon in Clipper's own winding (a union of one), so a shape drawn the other way round can't cancel another
  // where they overlap
  return [...bands(paths), ...polys.filter((p) => p.length >= 3).flatMap((p) => union([p]))];
}

/**
 * A district and the grass round it, where fields don't come: the outline pushed out by 75 to 200 feet, the distance
 * wandering round it by a noise from the plan's seed and the district's id (not its own seed, so rerolling a district
 * never moves the fields). The district's box is lost in plain grass instead of standing out against the crops.
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

/**
 * Each farmstead's lane: a straight track from the middle of its yard to the nearest point of the nearest plan road,
 * when one is within reach. From the plan alone, so the fields can keep off it and rerolling the farm never moves it.
 * Returns [{ id, from, path, width }] (path from the yard's edge to the road; width in squares).
 */
export function farmLanes(plan) {
  const sq = plan.size.ftPerSquare;
  const roads = plan.features.filter((f) => f.type === "road" && Array.isArray(f.path));
  const out = [];
  for (const f of plan.features) {
    if (f.type !== "area" || f.class !== "farmstead") continue;
    const yard = shapeToPolygon(f.shape, f.rot ?? 0);
    if (yard.length < 3) continue;
    const [x0, y0, x1, y1] = bbox(yard), c = [(x0 + x1) / 2, (y0 + y1) / 2];
    let best = null;
    for (const r of roads) for (let i = 1; i < r.path.length; i++) {
      const q = nearestOn(c, r.path[i - 1], r.path[i]), d = Math.hypot(q[0] - c[0], q[1] - c[1]);
      if (!best || d < best.d) best = { d, q, half: (r.width ?? 0) / sq / 2 };
    }
    if (!best || best.d > LANE_REACH || best.d < 0.5) continue;
    // From where the line leaves the yard to the road's edge
    const dir = [(best.q[0] - c[0]) / best.d, (best.q[1] - c[1]) / best.d];
    let t = 0;
    while (t < best.d && pointInPolygon([c[0] + dir[0] * t, c[1] + dir[1] * t], yard)) t += 0.05;
    const end = Math.max(t, best.d - best.half * 0.5);
    if (end - t < 0.3) continue; // the yard is on the road
    out.push({ id: `${f.id}/lane`, from: f.id, path: [[c[0] + dir[0] * t, c[1] + dir[1] * t], [c[0] + dir[0] * end, c[1] + dir[1] * end]], width: LANE_FT / sq });
  }
  return out;
}

/** The point of segment a-b nearest p. */
function nearestOn(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return [a[0] + dx * t, a[1] + dy * t];
}

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
 * Fills one field system. area: the plan's area; r: its stream; keepOut: from fieldKeepOut; earlier: from earlierFields
 * (no border is drawn along their edges, which have their own); along: the roads ([{ path, half }], fieldRoads), whose
 * sides are always hedged; W, H: the map, in squares; ftPerSquare; season. Returns { system, fields, hedges, walls, balks, trees,
 * notes }: fields [{ poly, holes, crop, angle, shade, variant, rows }] (angle: the way its rows run, in degrees; rows: their
 * spacing in squares, 0 for none; shade: -1 to 1, a little darker or lighter than its crop), hedges and walls
 * (paths: the border, by its class), balks (paths: grass lines between strips, between furlongs, and the
 * faint edges between enclosed fields that carry no hedge), trees (hedgerow
 * trees for the caller to place where there's room: [{ x, y, s, rot, variant }]).
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
    // A few neighbours merged into one bigger field (never more than three cells), so not every field is a cell
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
    // Borders: every side between two fields (or a field and grass), and round the fields at the land's edge, except
    // along the map's edge and along an earlier field system (whose own border runs there). Grass meets grass unbounded
    const bordered = (s) => { const [i, j] = s.cells.map(find); return i !== j && !(open.has(i) && open.has(j)); };
    const openAt = (p) => { const i = cells.findIndex((c) => pointInPolygon(p, c)); return i >= 0 && open.has(find(i)); };
    // Not every border is a hedge or wall, or every field is ringed by one: those along a road and round the system's
    // own edge are, and about a quarter of the sides between fields (each side's own draw); the rest are a faint grass
    // edge, as are the edges facing a village, water or a wood
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
    // Open fields: each cell a furlong of strips running with the grain or across it. The strips are laid across the
    // whole cell, each drawing its choices whether or not any of it is left, and only then trimmed to the land, so a
    // road taking a corner of a furlong never moves the strips in the rest of it
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
    // Headlands between furlongs, and the border (if any) round the land
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
