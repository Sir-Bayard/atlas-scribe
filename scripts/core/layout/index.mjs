/**
 * Plan to Layout: everything the generator works out from a plan, as plain items in squares.
 *
 * Fixed features become items as they are; districts and areas are filled. Each district or area has its own
 * random stream (the plan seed, or its own seed in plan.seeds, and its id), and draws from it the same number of
 * times whatever fits, so reseeding one moves only what it places and anything that was crowding against it.
 * Every random choice is made here, never in the painter, so the same plan always paints the same map, whatever
 * tiles it's painted in. Pure: runs in the worker and under node.
 */
import { roadWaterCrossings, snapCrossings } from "./crossings.mjs";
import { normalize, okJoin, okCut, okChimney } from "../plan.mjs";
import { smoothPlanPaths } from "../smooth.mjs";
import { rng, hash128 } from "../rng.mjs";
import { shapeToPolygon, bbox, pointInPolygon, distanceToPath, pathTouchesPolygon, polygonsOverlap } from "../geom.mjs";
import { seasonOf } from "../roles.mjs";
import { seedOf } from "../seeds.mjs";
import { labelsOf } from "../labels.mjs";
import { fillFarmstead, fillWoods, fillPark, hedgeBushes, groundPatches } from "./settlement.mjs";
import { fillFields, fieldKeepOut, earlierFields, fieldRoads, accessLanes } from "./fields.mjs";
import { streetsFor, districtGates, gateSpacing, DISTRICT_TYPES } from "../streets/index.mjs";
import { sharedEdges } from "../streets/borders.mjs";
import { lotsFor, lotTypeOf } from "../lots/index.mjs";
import { buildOnLots } from "../lots/build.mjs";
import { poissonInPolygon } from "../scatter.mjs";
import { makeNoise } from "../noise.mjs";

export const LAYOUT_VERSION = 1;

/** An ordinary house is 20 ft; each 20 ft above that is one step of "tall" (longer shadows). */
/** A building's chimney: the one drawn, unless it's pinned where it stood ({ u, v, variant }). */
const chimneyOf = (b, drawn) => (drawn && okChimney(b.chimneyAt) ? { u: b.chimneyAt.u, v: b.chimneyAt.v, variant: b.chimneyAt.variant } : drawn);
const tallOf = (heightFt) => Math.max(0, (Number(heightFt) - 20) / 20);

/** The widest street and lane any district type makes, in feet: what a neighbor's street at a gate can be. */
const GATE_WIDTH = {
  street: Math.max(...Object.values(DISTRICT_TYPES).map((t) => t.streets?.width ?? 0)),
  lane: Math.max(...Object.values(DISTRICT_TYPES).map((t) => t.lanes?.width ?? t.streets?.width ?? 0)),
};

/**
 * What each district made, kept from earlier layouts so a district whose inputs haven't changed isn't laid out again
 * (an edit in the window redraws only what it touched). Keyed by a hash of everything a district's fill reads: its
 * own settings and seed; the plan's seed and size; all water and radial squares (they steer every district's
 * streets); its gates and shared edges; the roads in or beside it; and whatever was placed before the districts
 * (squares, yards, parks, farms, buildings and their footprints, roads) within KEY_MARGIN squares of it. Holds the
 * last DISTRICT_CACHE_SIZE districts; per worker (or page), never saved.
 */
const DISTRICT_CACHE_SIZE = 96;
const KEY_MARGIN = 4;
const districtCache = new Map();
const cacheStats = { hits: 0, misses: 0 };

/** Empties the cache of districts' layouts (for tests). */
export function clearLayoutCache() {
  districtCache.clear();
  cacheStats.hits = cacheStats.misses = 0;
}

/** How often a district came from the cache since it was last cleared: { hits, misses } (for tests). */
export const layoutCacheStats = () => ({ ...cacheStats });

/** JSON for a cache key: NaN and Infinity written as themselves, so they never share a key with null. */
const keyJSON = (v) => JSON.stringify(v, (k, x) => (typeof x === "number" && !Number.isFinite(x) ? `#${x}` : x));

/** The box round every point in a value (a polygon, a path entry, a building item), or null if it has none. */
function boxOf(v) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y, r = 0) => { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); };
  const walk = (o, depth) => {
    if (depth > 4 || o === null || typeof o !== "object") return;
    if (Array.isArray(o)) {
      if (o.length >= 2 && Number.isFinite(o[0]) && Number.isFinite(o[1]) && typeof o[0] === "number") return add(o[0], o[1]);
      for (const e of o) walk(e, depth + 1);
      return;
    }
    if (Number.isFinite(o.cx) && Number.isFinite(o.cy)) add(o.cx, o.cy, Math.hypot(o.len ?? 0, o.dep ?? 0) / 2);
    for (const k of ["path", "poly", "clear"]) if (k in o) walk(o[k], depth + 1);
  };
  walk(v, 0);
  if (!(x0 <= x1)) return null;
  const pad = Number.isFinite(v?.clear) ? v.clear : 0; // a way's clearance reaches past its center line
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

export function layoutPlan(rawPlan, { onProgress = null, cache = true } = {}) {
  // Roads, rivers and walls curve through their points (the plan itself is left as it is)
  const asGiven = normalize(rawPlan);
  const plan = windAlike(smoothPlanPaths(asGiven));
  const sq = plan.size.ftPerSquare;
  const ft = (v) => (v == null ? null : v / sq);
  const [W, H] = plan.size.squares;
  const notes = [];
  const items = [];
  // Labels: placed, or following their district or area (as the window and the scene place them)
  const labels = labelsOf(asGiven);
  const streamFor = (id) => rng(seedOf(plan, id), id); // as a reroll reads it: a seed that isn't a number is ignored
  const progress = (pct, label) => onProgress?.(pct, label);

  // Everything placed so far that new things must keep clear of. While a district fills, what other districts
  // placed is ignored (each district's houses and gardens stay inside it, so they can't overlap), which keeps
  // districts independent: reseeding one never moves another.
  const owner = new WeakMap(); // a polygon or building item to the district that placed it
  const districts = plan.features.filter((f) => f.type === "district").map((f) => ({ id: f.id, poly: shapeToPolygon(f.shape) }));
  const districtIds = new Set(districts.map((d) => d.id));
  const touching = new Set(); // "a|b" for districts that overlap: free() sees each other's things there (wild trees and tracks), though houses are built over each other
  for (const a of districts) for (const b of districts) if (a !== b && polygonsOverlap(shrink(a.poly, 0.01), shrink(b.poly, 0.01))) touching.add(`${a.id}|${b.id}`);
  let filling = null; // the district being filled
  const elsewhere = (o) => {
    const by = owner.get(o);
    return filling !== null && by !== undefined && by !== filling && districtIds.has(by) && !touching.has(`${filling}|${by}`);
  };
  const space = {
    reserved: [], // polygons
    zones: [], // squares and yards: open ground that gardens mustn't spill into either
    plots: [], // gardens laid so far, and every building's footprint, for gardens to keep out of
    gardens: [], // gardens laid so far, for houses to keep out of
    buildings: [], // {cx, cy, len, dep}
    ways: [], // {path, clear}: distance a new thing's edge keeps from the way's center line
    water: [],
  };

  progress(0.05, "Fixed features");
  // Where the plan's roads cross its water, for its bridges and fords to sit on
  const overWater = roadWaterCrossings(
    plan.features.filter((f) => f.type === "road" && Array.isArray(f.path)).map((f) => ({ id: f.id, path: f.path, width: ft(f.width) })),
    plan.features.filter((f) => f.type === "water" && Array.isArray(f.path)).map((f) => ({ id: f.id, path: f.path, width: ft(f.width) })),
  );
  const snapped = snapCrossings(
    plan.features.filter((f) => f.type === "crossing" && Array.isArray(f.at)).map((f) => ({ id: f.id, class: f.class, at: f.at, angle: f.angle, length: ft(f.length), width: ft(f.width) })),
    overWater,
  );
  const ways = [];
  const parks = [];
  for (const f of plan.features) {
    switch (f.type) {
      case "road": {
        const width = ft(f.width);
        const item = { kind: "way", id: f.id, from: f.id, class: f.class, path: f.path, width, surface: f.surface, ruts: !!f.ruts };
        items.push(item);
        ways.push(item);
        space.ways.push({ path: f.path, clear: width / 2 + (f.class === "highway" ? 0.05 : -0.05), owner: null });
        break;
      }
      case "water":
        if (f.path) {
          items.push({ kind: "water", id: f.id, from: f.id, class: f.class, path: f.path, width: ft(f.width), frozen: !!f.frozen });
          space.water.push({ path: f.path, clear: ft(f.width) / 2 + 0.225 });
        } else notes.push({ level: "warning", id: f.id, message: `"${f.id}": water drawn as an area isn't painted yet; only rivers and streams along a path are.` });
        break;
      case "crossing": {
        const c = snapped.get(f.id) ?? { at: f.at, angle: f.angle, length: ft(f.length), width: ft(f.width), snappedTo: null };
        if (!c.snappedTo) notes.push({ level: "warning", id: f.id, message: `"${f.id}": there's no road over water near it, so it's drawn where the plan puts it.` });
        items.push({ kind: "crossing", id: f.id, from: f.id, class: f.class, at: c.at, angle: c.angle, length: c.length, width: c.width, frozen: !!f.frozen });
        break;
      }
      case "square": {
        const poly = shapeToPolygon(f.shape);
        items.push({ kind: "surface", id: f.id, from: f.id, class: "square", poly, surface: f.surface });
        space.reserved.push(grow(poly, 0.3));
        space.zones.push(poly);
        break;
      }
      case "building":
        addBuilding(planBuilding(f), f.id, streamFor(f.id));
        break;
      case "landmark": {
        const r = streamFor(f.id);
        f.buildings.forEach((b, j) => addBuilding(planBuilding(b), `${f.id}/${j + 1}`, r, f.id));
        break;
      }
      case "wall":
        if (f.class === "hedge") break; // hedges are bushes, placed after the fill
        items.push({ kind: "wall", id: f.id, from: f.id, class: f.class, path: f.path, height: ft(f.height) });
        break;
      case "prop":
        addProp(f, streamFor(f.id));
        break;
      case "area":
        if (f.class === "yard") {
          const poly = shapeToPolygon(f.shape, f.rot);
          items.push({ kind: "surface", id: f.id, from: f.id, class: "yard", poly, surface: f.surface ?? "trodden", fence: f.fence ?? null });
          space.reserved.push(grow(poly, 0.35));
          space.zones.push(poly);
        } else if (f.class === "trodden") {
          items.push({ kind: "surface", id: f.id, from: f.id, class: "trodden", poly: shapeToPolygon(f.shape, f.rot, 48), surface: "trodden" });
        } else if (f.class === "park") {
          parks.push(f); // laid out once every road is known, so its paths can meet them
        } else if (f.class !== "farmstead" && f.class !== "woods" && f.class !== "fields") {
          notes.push({ level: "warning", id: f.id, message: `"${f.id}": areas of class "${f.class}" aren't drawn yet.` });
        }
        break;
      default:
        break;
    }
  }

  // A curve swings a little outside its straight line at a bend: say so where that takes a road into a plan building
  // its straight line kept clear of (more points, or straight: true, fixes it)
  {
    const fixed = new Set(plan.features.filter((f) => f.type === "building" || f.type === "landmark").map((f) => f.id));
    const feet = items.filter((i) => i.kind === "building" && fixed.has(i.from));
    for (const w of ways) {
      const given = asGiven.features.find((f) => f.id === w.id)?.path;
      if (!given || given.length < 3) continue;
      for (const b of feet) {
        const foot = shapeToPolygon({ rect: [b.cx - b.len / 2, b.cy - b.dep / 2, b.cx + b.len / 2, b.cy + b.dep / 2] }, b.rot);
        const ring = [...foot, foot[0]];
        const gap = (path) => Math.min(...foot.map((p) => distanceToPath(p, path)), ...path.map((p) => (pointInPolygon(p, foot) ? 0 : distanceToPath(p, ring))));
        if (gap(w.path) < w.width / 2 && gap(given) >= w.width / 2)
          notes.push({ level: "warning", id: w.id, message: `"${w.id}" curves into "${b.from}" at a bend. Give the road another point there, or set straight: true on it.` });
      }
    }
  }

  /** A plan's building as addBuilding takes it: join and cut are the generator's own, never read from a plan. */
  function planBuilding(b) {
    // join and cut only as the generator writes them (a pinned building); anything else is left out
    const { join, cut, chimneyAt, ...rest } = b;
    return { ...rest, ...(okJoin(join) ? { join } : {}), ...(okCut(cut) ? { cut } : {}), ...(okChimney(chimneyAt) ? { chimneyAt } : {}) };
  }

  /** Adds a building item and keeps space clear around it. r: the stream for its own small choices. */
  function addBuilding(b, id, r, from = id) {
    let cx, cy, len, dep, round = false;
    if (b.shape?.circle) {
      // A round building (a tower, a dovecote): drawn under a cone
      const [x, y, rad] = b.shape.circle;
      cx = x; cy = y; len = dep = 2 * rad; round = true;
    } else if (b.shape?.rect) {
      const [x0, y0, x1, y1] = b.shape.rect;
      cx = (x0 + x1) / 2; cy = (y0 + y1) / 2; len = x1 - x0; dep = y1 - y0;
    } else {
      const [x0, y0, x1, y1] = bbox(shapeToPolygon(b.shape));
      cx = (x0 + x1) / 2; cy = (y0 + y1) / 2; len = x1 - x0; dep = y1 - y0;
      notes.push({ level: "warning", id, message: `"${id}": only rectangular and round buildings are drawn so far; this one is drawn as its bounding box.` });
    }
    const roof = b.roof ?? "slate";
    const v = r.int(8); // drawn even when given, so the stream stays the same
    const item = {
      kind: "building", id, from, cx, cy, len, dep, rot: b.rot ?? 0, roof, variant: b.variant ?? v, tall: tallOf(b.height ?? 20),
      roofStyle: round ? "cone" : b.roofStyle ?? "gable", // see ROOF_STYLES; a round building's is always a cone
      ...(round ? { round: true } : {}),
      ...(b.join ? { join: b.join } : {}), // a wing's ends that run into another roof (valleys there, no hip)
      ...(b.cut ? { cut: b.cut } : {}), // hips that start in from their corner, where a flush wing covers it
      chimney: chimneyOf(b, (b.chimney ?? r.chance(0.75)) && !round ? { u: 0.3, v: r.chance(0.5) ? -0.2 : 0.2, variant: r.int(8) } : null),
      ...(b.name ? { name: b.name } : {}),
    };
    items.push(item);
    space.buildings.push(item);
    const foot = round ? shapeToPolygon({ circle: [cx, cy, len / 2] }) : shapeToPolygon({ rect: [cx - len / 2, cy - dep / 2, cx + len / 2, cy + dep / 2] }, item.rot);
    const kept = grow(foot, 0.4);
    for (const o of [item, foot, kept]) owner.set(o, from);
    space.reserved.push(kept);
    space.plots.push(foot);
    return item;
  }

  function addProp(f, r) {
    const [x, y] = f.at;
    if (f.class === "tree") {
      const species = f.species === "conifer" ? "conifer" : "bare";
      items.push({ kind: "tree", id: f.id, from: f.id, x, y, species, size: species === "conifer" ? "large" : null, s: species === "bare" ? 0.5 + r.next() * 0.25 : 0.9 + r.next() * 0.6, rot: r.next() * 360, variant: r.int(8) });
    } else {
      items.push({ kind: "prop", id: f.id, from: f.id, class: f.class, x, y, rot: f.rot ?? 0, variant: r.int(8) });
    }
  }

  /** True when a thing of radius rad (half-depth half, when given) at x, y keeps clear of everything placed so far. */
  function free(x, y, rad, half = rad) {
    if (x < -1 || y < -1 || x > W + 1 || y > H + 1) return false;
    for (const poly of space.reserved) if (!elsewhere(poly) && (pointInPolygon([x, y], poly) || distanceToPath([x, y], closed(poly)) < rad * 0.9)) return false;
    for (const poly of space.gardens) if (!elsewhere(poly) && (pointInPolygon([x, y], poly) || distanceToPath([x, y], closed(poly)) < rad * 0.9)) return false;
    for (const w of space.water) if (distanceToPath([x, y], w.path) < half + w.clear) return false;
    for (const w of space.ways) if (!elsewhere(w) && distanceToPath([x, y], w.path) < half + w.clear) return false;
    for (const b of space.buildings) if (!elsewhere(b) && Math.hypot(b.cx - x, b.cy - y) < (rad + Math.max(b.len, b.dep) * 0.5) * 0.8 + 0.15) return false;
    return true;
  }



  // Parks: open ground that streets and plots keep out of (filled later, once the streets round them are known)
  for (const f of parks) {
    const poly = shapeToPolygon(f.shape, f.rot ?? 0);
    space.reserved.push(grow(poly, 0.2));
    space.zones.push(poly);
  }

  // Farmsteads first, so district houses keep out of the farmyards
  progress(0.25, "Farms");
  for (const f of plan.features.filter((f) => f.type === "area" && f.class === "farmstead")) {
    const r = streamFor(f.id);
    const before = items.length;
    notes.push(...fillFarmstead({ area: f, r, free, addBuilding: (b, id, br) => addBuilding(b, id, br, f.id), items }));
    const yard = items.slice(before).find((i) => i.class === "farmyard");
    if (yard) {
      space.reserved.push(grow(yard.poly, 0.35));
      space.zones.push(yard.poly);
    }
  }

  // Districts: generated streets first (each district's own, meeting its neighbors' at gates on shared edges),
  // then houses along every road, street and lane that runs into it
  progress(0.4, "Districts");
  const dfeats = plan.features.filter((f) => f.type === "district");
  const dlist = dfeats.map((d) => ({ id: d.id, poly: shapeToPolygon(d.shape), ...gateSpacing(d, sq) }));
  const waterAt = (x, y) => space.water.some((w) => distanceToPath([x, y], w.path) < w.clear);
  const gates = districtGates(dlist, { roads: ways, inWater: waterAt, seed: plan.seed });
  const radials = plan.features.filter((f) => f.type === "square" && f.radial).map((f) => {
    const poly = shapeToPolygon(f.shape);
    const [x0, y0, x1, y1] = bbox(poly);
    const at = [(x0 + x1) / 2, (y0 + y1) / 2];
    return { at, radius: poly.reduce((s, p) => s + Math.hypot(p[0] - at[0], p[1] - at[1]), 0) / poly.length };
  });
  // What every district's fill reads besides itself and what's near it (see districtCache), hashed once
  const waterItems = items.filter((i) => i.kind === "water" && i.path);
  const shared = cache ? hash128(keyJSON([LAYOUT_VERSION, plan.seed, sq, W, H, waterItems, space.water, radials])).join(".") : null;
  // What was placed before the districts, with each thing's box (the districts add to space as they fill). A district
  // sees only what lies within KEY_MARGIN squares of it, with or without the cache, so its key covers all it reads
  const placed = Object.fromEntries(["reserved", "zones", "plots", "buildings", "ways", "gardens"].map((k) => [k, space[k].map((v) => [v, boxOf(v)])]));
  for (const d of dfeats) {
    const { poly } = dlist.find((x) => x.id === d.id);
    const fixedHere = ways.filter((w) => pathTouchesPolygon(w.path, poly));
    // Roads running just outside the edge too, so plots and houses keep off them
    const ring = closed(poly);
    const nearHere = [...fixedHere, ...ways.filter((w) => !fixedHere.includes(w) && (w.path.some((p) => distanceToPath(p, ring) < w.width / 2 + 0.5) || poly.some((p) => distanceToPath(p, w.path) < w.width / 2 + 0.5)))];
    const borders = dlist.filter((o) => o.id !== d.id && o.streetSpacing).flatMap((o) => sharedEdges(poly, o.poly));
    const [bx0, by0, bx1, by1] = bbox(poly);
    const near = ([, b]) => !b || (b[0] <= bx1 + KEY_MARGIN && b[2] >= bx0 - KEY_MARGIN && b[1] <= by1 + KEY_MARGIN && b[3] >= by0 - KEY_MARGIN);
    const around = Object.fromEntries(Object.entries(placed).map(([k, list]) => [k, list.filter(near).map(([v]) => v)]));
    // Squares, yards and buildings placed before the districts, for plots and houses to keep off; streets keep well off
    // the buildings (a plan's, or a pinned house), so none clips them: the tracer lets a street run a little way inside
    // what it avoids, so the buildings are grown by about a street's width
    const blocked = [...around.zones, ...around.plots];
    const streetBlocked = [...around.zones, ...around.plots.map((p) => grow(p, 0.6))];
    // Laid out before with the same inputs: what it made is put back as it was (a district overlapping another sees
    // that one's things, so it's always laid out afresh)
    const overlaps = [...touching].some((k) => k.startsWith(`${d.id}|`));
    let key = null;
    if (cache && !overlaps) {
      key = hash128(keyJSON([shared, d, seedOf(plan, d.id), gates.get(d.id) ?? [], borders, dlist.filter((o) => o.id !== d.id).flatMap((o) => sharedEdges(poly, o.poly)), nearHere, around])).join(".");
    }
    if (key && districtCache.has(key)) {
      cacheStats.hits++;
      const kept = districtCache.get(key);
      districtCache.delete(key);
      districtCache.set(key, kept); // most recently used last
      // One clone of the whole record, so a building is the same object in items and in space.buildings, as it was
      const rec = structuredClone(kept);
      items.push(...rec.items);
      rec.buildings.forEach((b) => {
        space.buildings.push(b);
        owner.set(b, d.id);
      });
      for (const p of rec.reserved) { space.reserved.push(p); owner.set(p, d.id); }
      for (const p of rec.plots) { space.plots.push(p); owner.set(p, d.id); }
      for (const p of rec.gardens) { space.gardens.push(p); owner.set(p, d.id); }
      for (const w of rec.ways) { space.ways.push(w); owner.set(w, d.id); }
      notes.push(...rec.notes);
      continue;
    }
    if (key) cacheStats.misses++;
    const mark = { items: items.length, buildings: space.buildings.length, reserved: space.reserved.length, plots: space.plots.length, gardens: space.gardens.length, ways: space.ways.length, notes: notes.length };
    const r = streamFor(d.id);
    const made = streetsFor({
      district: d, poly, roads: fixedHere, water: space.water, radials, blocked: streetBlocked, gates: gates.get(d.id) ?? [], borders,
      ftPerSquare: sq, r: r.fork("streets"),
    });
    const surface = d.surface ?? fixedHere[0]?.surface ?? "dirt";
    const own = [];
    made.streets.forEach((st, k) => {
      const item = { kind: "way", id: `${d.id}/s${k + 1}`, from: d.id, class: st.kind, path: st.path, width: st.width, surface, ruts: false };
      items.push(item);
      own.push(item);
      const entry = { path: st.path, clear: st.width / 2 - 0.05 };
      owner.set(entry, d.id);
      space.ways.push(entry);
    });
    made.bridges.forEach((b, k) => {
      const foot = b.kind === "footbridge";
      items.push({ kind: "crossing", id: `${d.id}/b${k + 1}`, from: d.id, class: b.kind, at: b.at, angle: b.angle, length: b.length + 0.3, width: (foot ? 8 : 20) / sq, frozen: false });
    });
    // Plots along every road and street, and what stands on them. Each gate is kept clear too: the neighbor's street
    // starts there, and its width reaches a little over the shared edge even where this district's street doesn't
    const gateClear = (gates.get(d.id) ?? []).map((g) => shapeToPolygon({ circle: [g.at[0], g.at[1], (g.kind === "lane" ? GATE_WIDTH.lane : GATE_WIDTH.street) / sq / 2 + 0.05] }));
    const keepOff = [...blocked, ...gateClear];
    const { lots, back } = lotsFor({ district: d, poly, ways: [...nearHere, ...own], water: waterItems, blocked: keepOff, ftPerSquare: sq, r: r.fork("lots") });
    const built = buildOnLots({ lots, district: d, ways: [...nearHere, ...own], blocked: keepOff, ftPerSquare: sq, r: r.fork("build") });
    filling = d.id;
    for (const h of built.houses) addBuilding(h.building, `${d.id}/h-${h.id}`, h.r, d.id);
    for (const o of built.outbuildings) addBuilding(o.building, `${d.id}/o-${o.id}`, o.r, d.id);
    built.gardens.forEach((garden, k) => {
      items.push({ kind: "surface", id: `${d.id}/g${k + 1}`, from: d.id, class: "garden", garden });
      const gp = shapeToPolygon({ rect: [garden.cx - garden.w / 2, garden.cy - garden.d / 2, garden.cx + garden.w / 2, garden.cy + garden.d / 2] }, garden.rot);
      owner.set(gp, d.id);
      space.gardens.push(gp);
    });
    built.crofts.forEach((poly, k) => items.push({ kind: "surface", id: `${d.id}/c${k + 1}`, from: d.id, class: "croft", poly }));
    built.bounds.forEach((b, k) => items.push({ kind: "boundary", id: `${d.id}/f${k + 1}`, from: d.id, class: b.class, path: b.path }));
    // Trees in the plots: orchards in rows and trees about the yards
    built.trees.forEach((t, k) => items.push({ kind: "tree", id: `${d.id}/y${k + 1}`, from: d.id, x: t.x, y: t.y, species: "bare", size: null, s: t.s, rot: t.rot, variant: t.variant }));
    // Ground no plot takes (beyond the back lanes, the middle of big blocks): trees scattered evenly (Poisson-disk),
    // thinned in patches by a noise, so they gather in clumps with open ground between
    const T = lotTypeOf(d);
    const wr = r.fork("wild");
    const patch = makeNoise(plan.seed, `${d.id}/wild`, { scale: 6, octaves: 2 });
    let wild = 0;
    back.forEach((poly, k) => {
      const pts = poissonInPolygon(poly, T.wild ?? 1.5, wr.fork(k), { keep: (x, y) => patch(x, y) > -0.1 && free(x, y, 0.45), max: 400 });
      for (const [x, y] of pts) {
        wild++;
        items.push({ kind: "tree", id: `${d.id}/w${wild}`, from: d.id, x, y, species: "bare", size: null, s: 0.4 + wr.next() * 0.25, rot: wr.next() * 360, variant: wr.int(8) });
      }
    });
    filling = null;
    const remember = () => {
      if (!key) return;
      districtCache.set(key, structuredClone({
        items: items.slice(mark.items), buildings: space.buildings.slice(mark.buildings), reserved: space.reserved.slice(mark.reserved),
        plots: space.plots.slice(mark.plots), gardens: space.gardens.slice(mark.gardens), ways: space.ways.slice(mark.ways), notes: notes.slice(mark.notes),
      }));
      while (districtCache.size > DISTRICT_CACHE_SIZE) districtCache.delete(districtCache.keys().next().value);
    };
    notes.push({ level: "info", id: d.id, message: `"${d.id}": ${own.length} streets and lanes, ${made.bridges.length} bridges, ${lots.length} plots, ${built.houses.filter((h) => !h.wing).length} houses (${["L", "T", "U", "court"].map((k) => `${built.houses.filter((h) => h.shape === k).length} ${k}`).join(", ")}; ${built.houses.filter((h) => h.shape === "steps").length} in steps, ${built.houses.filter((h) => /b$/.test(h.id)).length} bays, ${built.houses.filter((h) => /d\d$/.test(h.id)).length} dormers, ${built.houses.filter((h) => /t$/.test(h.id)).length} turrets), ${built.outbuildings.length} outbuildings, ${built.gardens.length} gardens, ${built.crofts.length} crofts, ${built.trees.length} trees in plots, ${wild} beyond.` });
    remember();
  }

  // Field systems: open ground, so nothing keeps out of them; their hedgerow trees keep clear of every building
  progress(0.55, "Fields");
  for (const f of plan.features.filter((f) => f.type === "area" && f.class === "fields")) {
    const r = streamFor(f.id);
    const made = fillFields({ area: f, r, keepOut: fieldKeepOut(plan, f), earlier: earlierFields(plan, f), along: fieldRoads(plan), W, H, ftPerSquare: sq, season: seasonOf(plan) });
    notes.push(...made.notes);
    made.fields.forEach((fd, k) => items.push({ kind: "field", id: `${f.id}/f${k + 1}`, from: f.id, system: made.system, ...fd }));
    made.balks.forEach((path, k) => items.push({ kind: "boundary", id: `${f.id}/k${k + 1}`, from: f.id, class: "balk", path }));
    made.walls.forEach((path, k) => items.push({ kind: "wall", id: `${f.id}/w${k + 1}`, from: f.id, class: "drystone", path, height: 3 / sq }));
    made.hedges.forEach((path, k) => {
      items.push({ kind: "boundary", id: `${f.id}/h${k + 1}`, from: f.id, class: "hedge", path });
      // Each hedge's bushes from a stream keyed by where it runs, so a hedge nothing touched keeps its bushes
      hedgeBushes({ wall: { id: `${f.id}/h${k + 1}`, from: f.id, path }, r: r.fork("hedge", ...path[0].map((v) => v.toFixed(2)), ...path[path.length - 1].map((v) => v.toFixed(2))), items, step: 0.45, scale: [0.55, 0.25] });
    });
    let n = 0;
    for (const t of made.trees) if (free(t.x, t.y, 0.4)) items.push({ kind: "tree", id: `${f.id}/t${++n}`, from: f.id, x: t.x, y: t.y, species: "bare", size: null, s: t.s, rot: t.rot, variant: t.variant });
    if (made.fields.length) notes.push({ level: "info", id: f.id, message: `"${f.id}": ${made.system === "strips" ? "open strips" : "enclosed fields"}, ${made.fields.length} ${made.system === "strips" ? "strips" : "fields"}.` });
  }

  // Lanes out to the roads: a track from each farmyard, and from a yard, park or square out in the country, to the
  // road nearest it (the fields keep off them)
  const lanes = [];
  for (const lane of accessLanes(plan)) {
    const item = { kind: "way", id: lane.id, from: lane.from, class: "track", path: lane.path, width: lane.width, surface: "trodden", ruts: false, faint: true };
    items.push(item);
    lanes.push(item);
    space.ways.push({ path: lane.path, clear: lane.width / 2 });
  }

  // Parks, filled now: their paths start where the roads, the districts' streets and their own lanes meet them
  const streets = items.filter((i) => i.kind === "way" && !i.faint && !ways.includes(i));
  for (const f of parks) {
    const park = fillPark({ area: f, r: streamFor(f.id), roads: [...ways, ...lanes.filter((l) => l.from === f.id), ...streets], ftPerSquare: sq });
    items.push({ kind: "surface", id: f.id, from: f.id, class: "park", poly: park.surface.poly, style: park.surface.style, paths: park.surface.paths, basin: park.surface.basin });
    park.trees.forEach((t, k) => items.push({ kind: "tree", id: `${f.id}/t${k + 1}`, from: f.id, x: t.x, y: t.y, species: "bare", size: null, s: t.s, rot: t.rot, variant: t.variant }));
    park.beds.forEach((garden, k) => items.push({ kind: "surface", id: `${f.id}/g${k + 1}`, from: f.id, class: "garden", garden }));
    // Clipped hedges round the beds: small bushes close together
    park.hedges.forEach((path, k) => hedgeBushes({ wall: { id: `${f.id}/h${k + 1}`, from: f.id, path }, r: streamFor(f.id).fork("hedge", k), items, step: 0.22, scale: [0.32, 0.08] }));
  }

  // Tracks: a district's street that stops at the district's edge carries on as a trodden track out into the land, as
  // the lanes of a village run out to its fields, wandering a little, until it reaches a field (its gate), a road,
  // water, another district or area, something in the way or its length. Laid after the fields, which never depend on
  // them, and from what the plan, the field systems and this district placed, so rerolling one district never changes
  // another's (rerolling a field system can move where a track meets its fields)
  const fieldItems = items.filter((i) => i.kind === "field");
  const areaPolys = plan.features.filter((f) => f.type === "area" && f.class !== "fields").map((f) => shapeToPolygon(f.shape, f.rot ?? 0, 32));
  for (const d of dfeats) {
    filling = d.id;
    const { poly } = dlist.find((x) => x.id === d.id);
    const ring = closed(poly);
    const tr = streamFor(d.id).fork("tracks");
    let n = 0;
    for (const st of items.filter((i) => i.kind === "way" && i.from === d.id && !i.faint)) {
      for (const end of [0, st.path.length - 1]) {
        const want = tr.range(4, 10), wobble = tr.range(-6, 6), some = tr.chance(0.6); // drawn for every end, so the stream stays the same
        if (!some) continue; // not every lane runs on out to the fields
        const p = st.path[end], q = st.path[end === 0 ? 1 : end - 1];
        if (!q || distanceToPath(p, ring) > 1) continue; // ends inside the district
        if ([...ways, ...items.filter((w) => w.kind === "way" && w.from === d.id)].some((w) => w !== st && distanceToPath(p, w.path) < w.width / 2 + 0.6)) continue; // meets a way
        const l = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1;
        let dir = Math.atan2(p[1] - q[1], p[0] - q[0]);
        if (pointInPolygon([p[0] + ((p[0] - q[0]) / l) * 1.5, p[1] + ((p[1] - q[1]) / l) * 1.5], poly)) continue; // runs back in
        const path = [p];
        let at = p, joined = false;
        for (let k = 0; k < want; k++) {
          dir += (wobble * Math.PI) / 180 / 3;
          const next = [at[0] + Math.cos(dir), at[1] + Math.sin(dir)];
          if (next[0] < 0.5 || next[1] < 0.5 || next[0] > W - 0.5 || next[1] > H - 0.5) break;
          if (space.water.some((w) => distanceToPath(next, w.path) < w.clear + 0.3)) break;
          if (fieldItems.some((f) => pointInPolygon(next, f.poly))) break; // at a field's gate
          if (districts.some((o) => o.id !== d.id && pointInPolygon(next, o.poly))) break;
          // A square short of a wood, a yard or a green, so a track never thins the trees at a wood's edge
          if (areaPolys.some((a) => pointInPolygon(next, a) || distanceToPath(next, closed(a)) < 1)) break;
          const road = ways.find((w) => distanceToPath(next, w.path) < w.width / 2 + 0.2);
          if (road) { path.push(next); joined = true; break; }
          if (!free(next[0], next[1], 0.3)) break;
          path.push(next);
          at = next;
        }
        if (path.length < (joined ? 2 : 3)) continue;
        const item = { kind: "way", id: `${d.id}/t${++n}`, from: d.id, class: "track", path, width: 10 / sq, surface: "trodden", ruts: false, faint: true };
        items.push(item);
        const entry = { path, clear: item.width / 2 };
        owner.set(entry, d.id);
        space.ways.push(entry);
      }
    }
    filling = null;
  }

  // Woods and hedgerows last: trees keep clear of every building
  progress(0.6, "Woods");
  for (const f of plan.features.filter((f) => f.type === "area" && f.class === "woods")) {
    notes.push(...fillWoods({ area: f, r: streamFor(f.id), free, items, winter: seasonOf(plan) === "winter" }));
  }
  for (const f of plan.features.filter((f) => f.type === "wall" && f.class === "hedge")) {
    hedgeBushes({ wall: f, r: streamFor(f.id), items });
  }

  // A tree laid before another feature's street (a green's, or one district's wild tree by the next one's lane) is
  // dropped where that street runs over it, as a house crowding a wood removes the trees it stands on
  // (and a hedge's bushes where a farm's or a park's lane goes through it)
  const hard = items.filter((i) => i.kind === "way" && (!i.faint || lanes.includes(i))).map((w) => { const [x0, y0, x1, y1] = bbox(w.path), m = w.width / 2 + 0.05; return { w, m, box: [x0 - m, y0 - m, x1 + m, y1 + m] }; });
  for (let k = items.length - 1; k >= 0; k--) {
    const t = items[k];
    if ((t.kind === "tree" || (t.kind === "prop" && t.class === "bush")) && t.id !== t.from && hard.some(({ w, m, box }) => w.from !== t.from && t.x > box[0] && t.x < box[2] && t.y > box[1] && t.y < box[3] && distanceToPath([t.x, t.y], w.path) < m)) items.splice(k, 1);
  }

  progress(0.85, "Ground");
  items.unshift({ kind: "ground", id: "plan/ground", from: "plan", base: plan.ground, patches: groundPatches(rng(plan.seed, "ground"), W, H) });

  const layout = {
    atlasScribe: LAYOUT_VERSION,
    plan: plan.id ?? null,
    size: { squares: [W, H], ftPerSquare: sq },
    season: seasonOf(plan),
    style: plan.style,
    sun: plan.sun,
    pxPerSquare: plan.output.pxPerSquare,
    items,
    labels,
    notes,
  };
  progress(1, "Done");
  return layout;
}

/** A polygon pushed out from its center by a margin (rough, for keeping clear; fine for convex shapes). */
function grow(poly, by) {
  if (!by) return poly;
  const [x0, y0, x1, y1] = bbox(poly);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return poly.map(([x, y]) => {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1;
    return [x + (dx / d) * by, y + (dy / d) * by];
  });
}

const closed = (poly) => [...poly, poly[0]];

/**
 * The plan with every district's and area's corners given the same way round (the way a rect's run), so an outline
 * saved the other way round lays out the same.
 */
function windAlike(plan) {
  const signed = (p) => p.reduce((s, [x1, y1], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + x1 * y2 - x2 * y1; }, 0);
  const turn = (f) => (f.type === "district" || f.type === "area") && Array.isArray(f.shape) && f.shape.length >= 3 && signed(f.shape) < 0;
  return plan.features.some(turn) ? { ...plan, features: plan.features.map((f) => (turn(f) ? { ...f, shape: [...f.shape].reverse() } : f)) } : plan;
}

/** A polygon pulled in toward its center by a fraction, so shapes that only touch don't count as overlapping. */
function shrink(poly, by) {
  const [x0, y0, x1, y1] = bbox(poly);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return poly.map(([x, y]) => [x + (cx - x) * by, y + (cy - y) * by]);
}
