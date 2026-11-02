/**
 * Plan to Layout: everything the generator works out from a plan, as plain items in squares.
 *
 * Fixed features become items as they are; districts and areas are filled. Each district or area has its own
 * random stream (the plan seed, or its own seed in plan.seeds, and its id), and draws from it the same number of
 * times whatever fits, so reseeding one moves only what it places and anything that was crowding against it.
 * Every random choice is made here, never in the painter, so the same plan always paints the same map, whatever
 * tiles it's painted in. Pure: runs in the worker and under node.
 */
import { roadWaterCrossings, snapCrossings, fordDetail } from "./crossings.mjs";
import { ROOF_STYLES, normalize, okJoin, okCut, okChimney, NOT_DRAWN_YET, PROP_SQUARES, isConifer } from "../plan.mjs";
import { smoothPlanPaths } from "../smooth.mjs";
import { rng, hash128 } from "../rng.mjs";
import { shapeToPolygon, bbox, pointInPolygon, distanceToPath, pathTouchesPolygon, polygonsOverlap } from "../geom.mjs";
import { BoxGrid, SegGrid } from "../spatial.mjs";
import { seasonOf } from "../roles.mjs";
import { seedOf } from "../seeds.mjs";
import { labelsOf } from "../labels.mjs";
import { fillFarmstead, fillWoods, fillPark, hedgeBushes, groundPatches } from "./settlement.mjs";
import { fillFields, fieldKeepOut, earlierFields, fieldRoads, accessLanes } from "./fields.mjs";
import { streetsFor, districtGates, gateSpacing, DISTRICT_TYPES, typeOf } from "../streets/index.mjs";
import { sharedEdges } from "../streets/borders.mjs";
import { lotsFor, lotTypeOf } from "../lots/index.mjs";
import { isTownWall, layWall, bandPieces, offsetPath } from "./walls.mjs";
import { buildOnLots } from "../lots/build.mjs";
import { centroid, shapes } from "../lots/poly.mjs";
import { notablesFor, planUses, useLabel, USE_INFO, CLUTTER_FT } from "../uses.mjs";
import { LOOK, characterOf, lookOf } from "../character.mjs";
import { anchorFor, layAnchor } from "./anchors.mjs";
import { poissonInPolygon } from "../scatter.mjs";
import { makeNoise } from "../noise.mjs";
import { isBody, isRunning, bodyOf, widthsOf, mouthWidths, shoreOf, frozenOf, keepOf, nearWater, segClears, pastEdge, SHORE_REACH } from "../water.mjs";
import { layDock, shoreRuns } from "./docks.mjs";
import { shoreLife } from "./shores.mjs";
import { marketStalls } from "./market.mjs";
import { fillCemetery } from "./cemetery.mjs";
import { harborProps, afloat, BOAT_SQUARES } from "./harbor.mjs";

export const LAYOUT_VERSION = 3;


/** An ordinary house is 20 ft; each 20 ft above that is one step of "tall" (longer shadows). */
/** A building's chimney: the one drawn, unless it's pinned where it stood ({ u, v, variant }). */
const chimneyOf = (b, drawn) => (drawn && okChimney(b.chimneyAt) ? { u: b.chimneyAt.u, v: b.chimneyAt.v, variant: b.chimneyAt.variant } : drawn);
const tallOf = (heightFt) => Math.max(0, (Number(heightFt) - 20) / 20);

/** How far along a ray (from, unit dir) it meets the segment a-b, or null. */
function rayHit([ox, oy], [dx, dy], [ax, ay], [bx, by]) {
  const ex = bx - ax, ey = by - ay, den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((ax - ox) * ey - (ay - oy) * ex) / den, u = ((ax - ox) * dy - (ay - oy) * dx) / den;
  return u >= 0 && u <= 1 ? t : null;
}

/** Points every step squares along a path, each with the path's direction there: [[point, [dx, dy]]]. */
function stepsAlong(path, step) {
  const out = [];
  let next = step / 2, run = 0; // where the next point falls, and how far along the path this segment starts
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const l = Math.hypot(bx - ax, by - ay);
    if (!l) continue;
    const d = [(bx - ax) / l, (by - ay) / l];
    for (; next < run + l; next += step) out.push([[ax + d[0] * (next - run), ay + d[1] * (next - run)], d]);
    run += l;
  }
  return out;
}

/** A district's own roof forms, those AtlasScribe knows. */
const ownStyles = (d) => (Array.isArray(d.roofStyles) ? d.roofStyles.filter((s) => ROOF_STYLES.includes(s)) : []);

/** A roof for a quarter's back building: one of its character's own materials, else the district's own palette. */
function pickRoof(d, r, palette = null) {
  const roofs = (Array.isArray(d.roofs) && d.roofs.length ? Object.fromEntries(d.roofs.map((x) => [x, 1])) : LOOK[characterOf(d)]?.roofs ?? palette ?? lotTypeOf(d).roofs) ?? { slate: 1 };
  const keys = Object.keys(roofs), total = keys.reduce((a, k) => a + roofs[k], 0);
  let x = r.next() * total;
  for (const k of keys) if ((x -= roofs[k]) < 0) return k;
  return keys[keys.length - 1];
}

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

/** The box around every point in a value (a polygon, a path entry, a building item), or null if it has none. */
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

/**
 * Streets cut where they'd run into a building (their edge inside it): each street is split there, and pieces shorter
 * than a square are dropped. A street that only passes a building, its edge at most touching the wall (a house on the
 * street line), is left whole.
 */
function trimAtBuildings(streets, feet) {
  if (!feet.length) return streets;
  const walls = feet.map((p) => ({ p, ring: closed(p), box: bbox(p) }));
  const out = [];
  for (const st of streets) {
    const m = st.width / 2 - 0.015; // into the wall by more than a hair
    const inside = (q) => walls.some(({ p, ring, box }) => q[0] > box[0] - m && q[0] < box[2] + m && q[1] > box[1] - m && q[1] < box[3] + m && (pointInPolygon(q, p) || distanceToPath(q, ring) < m));
    if (!st.path.some((q, k) => k && walls.some(({ box }) => Math.max(q[0], st.path[k - 1][0]) > box[0] - m && Math.min(q[0], st.path[k - 1][0]) < box[2] + m && Math.max(q[1], st.path[k - 1][1]) > box[1] - m && Math.min(q[1], st.path[k - 1][1]) < box[3] + m))) { out.push(st); continue; }
    // Walk the path in steps of a tenth of a square, keeping its own points and the last point before each cut
    const pieces = [];
    let cur = [], last = null, cut = false;
    const end = () => { if (cur.length) { if (last && last !== cur.at(-1)) cur.push(last); pieces.push(cur); } cur = []; last = null; };
    const visit = (q, own) => {
      if (inside(q)) { cut = true; end(); return; }
      if (own || !cur.length) cur.push(q);
      last = q;
    };
    for (let k = 0; k < st.path.length - 1; k++) {
      const a = st.path[k], b = st.path[k + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1));
      for (let t = 0; t < n; t++) visit(t ? [a[0] + ((b[0] - a[0]) * t) / n, a[1] + ((b[1] - a[1]) * t) / n] : a, t === 0);
    }
    visit(st.path.at(-1), true);
    end();
    if (!cut) { out.push(st); continue; }
    const len = (pts) => pts.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0), 0);
    for (const pc of pieces) {
      const pts = pc.map((q) => [q[0], q[1]]);
      if (pts.length >= 2 && len(pts) >= 1) out.push({ ...st, path: pts });
    }
  }
  return out;
}

export function layoutPlan(rawPlan, { onProgress = null, cache = true } = {}) {
  // Roads, rivers and walls curve through their points (the plan itself is left as it is)
  const asGiven = normalize(rawPlan);
  const plan = withWater(windAlike(smoothPlanPaths(asGiven)), asGiven);
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
  let otherFor = null, other = new Map(); // owner -> whether it counts as elsewhere, while `filling` is otherFor
  const elsewhere = (o) => {
    const by = owner.get(o);
    if (filling === null || by === undefined || by === filling) return false;
    if (otherFor !== filling) { otherFor = filling; other = new Map(); }
    let v = other.get(by);
    if (v === undefined) other.set(by, (v = districtIds.has(by) && !touching.has(`${filling}|${by}`)));
    return v;
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
    plan.features.filter((f) => f.type === "water" && Array.isArray(f.path)).map((f) => (f._w ? { id: f.id, path: f.path, width: Math.max(...f._w), widths: f._w } : { id: f.id, path: f.path, width: ft(f.width) })),
  );
  const snapped = snapCrossings(
    plan.features.filter((f) => f.type === "crossing" && Array.isArray(f.at)).map((f) => ({ id: f.id, class: f.class, at: f.at, angle: f.angle, length: ft(f.length), width: ft(f.width) })),
    overWater,
  );
  const ways = [];
  const parks = [];
  const bodies = []; // ponds, lakes and seas
  const winter = seasonOf(plan) === "winter";
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
        if (isRunning(f)) {
          if (f._w) {
            // Wider at one end, or opening out into a lake: a width at each point, and the widest for its box
            const width = Math.max(...f._w);
            items.push({ kind: "water", id: f.id, from: f.id, class: f.class, path: f.path, width, widths: f._w, frozen: !!f.frozen });
            space.water.push({ path: f.path, clear: width / 2 + 0.225, clears: segClears(f._w, 0.225) });
          } else {
            const width = ft(f.width ?? 60); // a pond, lake or sea along a path is drawn as a river (the checker says so)
            items.push({ kind: "water", id: f.id, from: f.id, class: f.class, path: f.path, width, frozen: !!f.frozen });
            space.water.push({ path: f.path, clear: width / 2 + 0.225 });
          }
        } else if (f._poly) {
          // A pond, lake or sea: its shore, and frozen in winter unless the plan says (a sea never freezes unasked)
          // Its shore's reach is what's painted; things keep clear by keep, which a reroll never changes
          const shore = f._shore;
          const reach = SHORE_REACH[shore];
          const frozen = frozenOf(f, winter);
          const item = { kind: "water", id: f.id, from: f.id, class: f.class, poly: f._poly, ring: f._ring, shore, reach, keep: f._keep, frozen, surf: f.class === "sea" && !frozen && !winter };
          items.push(item);
          bodies.push(item);
          space.water.push({ path: f._ring, clear: f._keep + 0.15, body: f._poly });
          space.reserved.push(f._poly);
          space.zones.push(f._poly);
        } else notes.push({ level: "warning", id: f.id, message: `"${f.id}" has no outline to draw.` });
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
        if (f.class === "hedge" || isTownWall(f)) break; // hedges are bushes, placed after the fill; town walls just below
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
        } else if (f.class === "park" || f.class === "cemetery") {
          parks.push(f); // laid out once every road is known, so its paths can meet them
        } else if (f.class !== "farmstead" && f.class !== "woods" && f.class !== "fields" && !NOT_DRAWN_YET.area.includes(f.class)) {
          notes.push({ level: "warning", id: f.id, message: `"${f.id}": areas of class "${f.class}" aren't drawn yet.` }); // (the checker already says so for a class not drawn yet)
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

  // Mills: a windmill's sails over its cap, turned by its own stream; a watermill's wheel just in the water its
  // nearest wall faces (within a square of the wall), else no wheel and a note
  for (const b of items.filter((i) => i.kind === "building" && (i.use === "windmill" || i.use === "watermill"))) {
    const r = rng(seedOf(plan, b.from), b.id, "mill");
    if (b.use === "windmill") {
      items.push({ kind: "prop", id: `${b.id}/sails`, from: b.from, class: "sails", x: b.cx, y: b.cy, rot: r.next() * 90, variant: r.int(8), scale: Math.max(2, Math.max(b.len, b.dep) * 3.2) / (PROP_SQUARES.sails ?? 2.4) });
      continue;
    }
    // Out from the middle of each wall to the water it faces: the wheel stands just in it, on the nearest
    const foot = shapeToPolygon({ rect: [b.cx - b.len / 2, b.cy - b.dep / 2, b.cx + b.len / 2, b.cy + b.dep / 2] }, b.rot);
    const runs = items.filter((i) => i.kind === "water" && Array.isArray(i.path) && i.path.length >= 2);
    let best = null;
    for (let k = 0; k < 4; k++) {
      const a = foot[k], e = foot[(k + 1) % 4], m = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2], l = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
      let n = [-(e[1] - a[1]) / l, (e[0] - a[0]) / l];
      if (pointInPolygon([m[0] + n[0] * 0.1, m[1] + n[1] * 0.1], foot)) n = [-n[0], -n[1]];
      for (let t = 0.05; t <= 1.0 && !(best && best.t <= t); t += 0.05) {
        const q = [m[0] + n[0] * t, m[1] + n[1] * t];
        if (runs.some((w) => pastEdge(q, w) < -0.06)) { best = { t, m, n, along: Math.atan2(e[1] - a[1], e[0] - a[0]) }; break; }
      }
    }
    const variant = r.int(8);
    if (!best) { notes.push({ level: "warning", id: b.from, message: `"${b.from}" is a watermill with no river or stream within a square of its walls, so it has no wheel. Move it next to the water.` }); continue; }
    items.push({ kind: "prop", id: `${b.id}/wheel`, from: b.from, class: "waterwheel", x: best.m[0] + best.n[0] * best.t, y: best.m[1] + best.n[1] * best.t, rot: (best.along * 180) / Math.PI - 90, variant, scale: 1 });
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
    const cc = r.chance(0.75), cv = r.chance(0.5), ci = r.int(8); // the chimney's, likewise (a landmark's buildings share a stream)
    const item = {
      kind: "building", id, from, cx, cy, len, dep, rot: b.rot ?? 0, roof, variant: b.variant ?? v, tall: tallOf(b.height ?? 20),
      roofStyle: round ? (b.tower && b.roofStyle === "flat" ? "flat" : "cone") : b.roofStyle ?? "gable", // see ROOF_STYLES; a round building's is a cone (an open tower's flat)
      ...(round ? { round: true } : {}),
      ...(b.tower ? { tower: true, ...(b.crenels ? { crenels: true } : {}), ...(b.flatRoof ? { flatRoof: b.flatRoof } : {}) } : {}),
      ...(b.join ? { join: b.join } : {}), // a wing's ends that run into another roof (valleys there, no hip)
      ...(b.cut ? { cut: b.cut } : {}), // hips that start in from their corner, where a flush wing covers it
      chimney: chimneyOf(b, (b.chimney ?? cc) && !round ? { u: 0.3, v: cv ? -0.2 : 0.2, variant: ci } : null),
      ...(b.name ? { name: b.name } : {}),
      ...(b.use ? { use: b.use } : {}),
      ...(b.grand ? { grand: true } : {}),
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

  /**
   * True when a rectangle (its four corners) keeps clear of this district's and the plan's buildings, ways, water,
   * squares, yards and other kept ground: tested at its corners, the middles of its sides and its middle, and its
   * outline against every building near it. Things another district placed don't count (see elsewhere).
   */
  function rectFree(pts) {
    catchUp();
    const samples = [...pts, ...pts.map((p, i) => [(p[0] + pts[(i + 1) % 4][0]) / 2, (p[1] + pts[(i + 1) % 4][1]) / 2]), [(pts[0][0] + pts[2][0]) / 2, (pts[0][1] + pts[2][1]) / 2]];
    const reach = Math.hypot(pts[2][0] - pts[0][0], pts[2][1] - pts[0][1]) / 2;
    const [cx, cy] = samples[8];
    for (const [x, y] of samples) {
      if (x < 0 || y < 0 || x > W || y > H) return false;
      for (const k of nearby.ways.near(x, y, 0.02)) { const w = space.ways[nearby.ways.segPath[k]]; if (!elsewhere(w) && nearby.ways.dist(x, y, k) < w.clear + 0.02) return false; }
      for (const k of nearby.water.near(x, y, 0.02)) { const w = space.water[nearby.water.segPath[k]]; if (nearby.water.dist(x, y, k) < (w.clears ? w.clears[nearby.water.segIndex[k] - 1] : w.clear)) return false; }
    }
    for (const k of nearby.buildings.near(cx, cy, reach)) { const b = space.buildings[k]; if (!elsewhere(b) && polygonsOverlap(pts, footOf(b))) return false; }
    for (const z of space.zones) if (!elsewhere(z) && polygonsOverlap(pts, z)) return false;
    for (const k of nearby.gardens.near(cx, cy, reach)) { const g = space.gardens[k]; if (!elsewhere(g) && polygonsOverlap(pts, g)) return false; }
    return true;
  }
  /** A building item's footprint (a round one's square box). */
  function footOf(b) {
    return b.round ? shapeToPolygon({ rect: [b.cx - b.len / 2, b.cy - b.dep / 2, b.cx + b.len / 2, b.cy + b.dep / 2] }, b.rot) : shapeToPolygon({ rect: [b.cx - b.len / 2, b.cy - b.dep / 2, b.cx + b.len / 2, b.cy + b.dep / 2] }, b.rot);
  }

  /**
   * Builds up one empty middle of a dense quarter's block: rows of buildings square to the nearest street, each inside
   * the piece and clear of the others, with a little clutter in the gaps. B: the quarter's back numbers (LOOK).
   */
  function fillBack(d, shape, k, B, near, r, plots = [], palette = null) {
    const piece = shape.outer, holes = shape.holes ?? [];
    // The plots along the streets (with their boxes): the middle of a block can reach a little into the backs of the
    // odd plot, and a temple's yard or a mansion's grounds stay open
    const [px0, py0, px1, py1] = bbox(piece);
    const near2 = plots.filter(([, b]) => b[0] < px1 && b[2] > px0 && b[1] < py1 && b[3] > py0);
    const onPlot = (pts) => {
      const [x0, y0, x1, y1] = bbox(pts);
      const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
      const inset = pts.map(([x, y]) => { const dx = mx - x, dy = my - y, l = Math.hypot(dx, dy) || 1, t = Math.min(0.08, l * 0.4) / l; return [x + dx * t, y + dy * t]; });
      return near2.some(([p, b]) => b[0] < x1 && b[2] > x0 && b[1] < y1 && b[3] > y0 && polygonsOverlap(inset, p));
    };
    const [cx0, cy0] = centroid(piece);
    let dir = [1, 0], bd = Infinity;
    for (const w of near) for (let i = 1; i < w.path.length; i++) {
      const [ax, ay] = w.path[i - 1], [bx, by] = w.path[i];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((cx0 - ax) * dx + (cy0 - ay) * dy) / l2));
      const dd = Math.hypot(ax + t * dx - cx0, ay + t * dy - cy0);
      if (dd < bd) { bd = dd; const l = Math.sqrt(l2); dir = [dx / l, dy / l]; }
    }
    const [ux, uy] = dir, nxv = -uy, nyv = ux;
    const rot = (Math.atan2(uy, ux) * 180) / Math.PI;
    const us = piece.map(([x, y]) => (x - cx0) * ux + (y - cy0) * uy), vs = piece.map(([x, y]) => (x - cx0) * nxv + (y - cy0) * nyv);
    const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
    const ext = (range) => (range[0] + r.next() * (range[1] - range[0])) / sq;
    const gap = B.gap / sq;
    const placed = [];
    // Corners in the piece, none of its corners (or a hole's) poking in, and no hole under it
    const inside = (pts) => pts.every((p) => pointInPolygon(p, piece)) && !piece.some((p) => pointInPolygon(p, pts)) && !holes.some((h) => polygonsOverlap(h, pts)) && !onPlot(pts);
    let n = 0, m = 0;
    for (let v = v0 + gap; v < v1 - gap && n < 200; ) {
      const dd = ext(B.dep);
      for (let u = u0 + gap; u < u1 - gap && n < 200; ) {
        const ll = ext(B.len);
        const cu = u + ll / 2, cv = v + dd / 2;
        const x = cx0 + ux * cu + nxv * cv, y = cy0 + uy * cu + nyv * cv;
        const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + ux * (a * ll) / 2 + nxv * (b * dd) / 2, y + uy * (a * ll) / 2 + nyv * (b * dd) / 2]);
        // Now and then a gap is left open: a yard with the quarter's clutter, or (a close) a garden or an orchard
        const open = r.next() < (B.gardens ? 0.4 : 0.15);
        if (!open && inside(pts) && !placed.some((q) => polygonsOverlap(q, pts)) && rectFree(pts)) {
          placed.push(pts);
          addBuilding({ shape: { rect: [x - ll / 2, y - dd / 2, x + ll / 2, y + dd / 2] }, rot, roof: pickRoof(d, r, palette), variant: r.int(8), roofStyle: ownStyles(d).length ? ownStyles(d)[r.int(ownStyles(d).length)] : "gable", height: 15, chimney: B.use === "house" ? undefined : false, use: B.use }, `${d.id}/o-b${k}-${++n}`, r.fork("b", n), d.id);
        } else if (open && B.gardens && inside(pts) && !placed.some((q) => polygonsOverlap(q, pts)) && rectFree(pts)) {
          placed.push(pts);
          if (r.next() < 0.6) {
            const garden = { cx: x, cy: y, w: ll * 0.9, d: dd * 0.9, rot, strip: true };
            items.push({ kind: "surface", id: `${d.id}/g-b${k}-${++m}`, from: d.id, class: "garden", garden });
            const gp = shapeToPolygon({ rect: [x - ll * 0.45, y - dd * 0.45, x + ll * 0.45, y + dd * 0.45] }, rot);
            owner.set(gp, d.id);
            space.gardens.push(gp);
          } else for (const [a2, b2] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
            const tx = x + ux * a2 * ll + nxv * b2 * dd, ty = y + uy * a2 * ll + nyv * b2 * dd;
            items.push({ kind: "tree", id: `${d.id}/t-b${k}-${++m}`, from: d.id, x: tx, y: ty, species: "bare", size: null, s: 0.35 + r.next() * 0.1, rot: r.next() * 360, variant: r.int(8) });
          }
        } else if (open && B.clutter?.length && inside(pts) && !placed.some((q) => polygonsOverlap(q, pts)) && rectFree(pts)) {
          placed.push(pts); // the yard stays open
          const cls = B.clutter[r.int(B.clutter.length)];
          items.push({ kind: "prop", id: `${d.id}/q-b${k}-${++m}`, from: d.id, class: cls, x, y, rot: rot + r.next() * 30, variant: r.int(8), scale: (CLUTTER_FT[cls] ?? 6) / sq / (PROP_SQUARES[cls] ?? 0.45) });
        }
        u += ll + gap;
      }
      v += dd + gap;
    }
  }

  /** Puts a district's anchor on the map: its square, buildings, garden, walls, props and trees. */
  function addAnchor(d, A, r) {
    A.surfaces.forEach((x, k) => items.push({ kind: "surface", id: `${d.id}/anchor-s${k + 1}`, from: d.id, class: x.class, poly: x.poly, ...(x.surface ? { surface: x.surface } : {}) }));
    // The landmark and its parts, ids as a house's (the first, then w1, w2...), so it's picked and pinned as one
    A.buildings.forEach((b, k) => addBuilding(b.spec, k ? `${d.id}/h-anchor0w${k}` : `${d.id}/h-anchor0`, r.fork(b.key), d.id));
    A.walls.forEach((path, k) => items.push({ kind: "wall", id: `${d.id}/anchor-v${k + 1}`, from: d.id, class: "stone", path, height: 6 / sq }));
    A.hedges.forEach((path, k) => items.push({ kind: "boundary", id: `${d.id}/anchor-h${k + 1}`, from: d.id, class: "clipped", path }));
    // (a stall comes with its own color and scale)
    A.props.forEach((x, k) => { const variant = r.int(8); items.push({ kind: "prop", id: `${d.id}/anchor-q${k + 1}`, from: d.id, class: x.class, x: x.x, y: x.y, rot: x.rot, variant: x.variant ?? variant, scale: x.scale ?? (x.size ?? CLUTTER_FT[x.class] ?? 6) / sq / (PROP_SQUARES[x.class] ?? 0.45) }); });
    A.trees.forEach((t, k) => items.push({ kind: "tree", id: `${d.id}/anchor-t${k + 1}`, from: d.id, x: t.x, y: t.y, species: t.species ?? "bare", size: t.size ?? null, s: t.s, rot: t.rot, variant: t.variant }));
    // The temple's yard holds its graves (a churchyard is where a parish buries its own; big cemeteries lie outside)
    for (const yard of A.surfaces.filter((x) => x.class === "churchyard")) addGraves(d, yard.poly, A.rot ?? 0, graveCount(d, true), r.fork("graves"));
    // Kept clear, so nothing else is built on it
    const kept = A.block;
    owner.set(kept, d.id);
    space.reserved.push(kept);
    space.zones.push(kept);
  }

  /**
   * Wells, fountains, shrines and watch posts at the corners of a district's streets: just off a street where two
   * meet or one ends, on free ground, kept apart from each other.
   */
  function streetCorners(d, poly, own, want, r) {
    // Where two of its own streets meet (a well or fountain stands right there, in the crossing; never on the plan's
    // roads), and spots along every street just off it (a shrine or watch post, where there's room)
    const junctions = [];
    for (const w of own) for (const end of [w.path[0], w.path[w.path.length - 1]]) {
      if (own.some((o) => o !== w && distanceToPath(end, o.path) < (o.width ?? 0.6) / 2 + 0.1) && !ways.some((o) => distanceToPath(end, o.path) < (o.width ?? 0.6) / 2 + 0.6)) junctions.push(end);
    }
    const spots = [];
    for (const w of own) for (const [at, dir] of stepsAlong(w.path, 2.5)) for (const s of [-1, 1]) spots.push({ at, dir, side: s, width: w.width });
    const order = r.shuffle(spots), crossings = r.shuffle(junctions);
    // What this district has already put down that space doesn't hold (walls, props, trees, kilns), to keep off
    const mine = items.filter((i) => i.from === d.id && (i.kind === "prop" || i.kind === "tree" || i.kind === "kiln"));
    const myWalls = items.filter((i) => i.from === d.id && i.kind === "wall");
    const clearOfMine = (x, y, rad) => !mine.some((i) => Math.hypot(i.x - x, i.y - y) < rad + (i.rad ?? 0.25)) && !myWalls.some((w) => distanceToPath([x, y], w.path) < rad + 0.1);
    const ownBuildings = space.buildings.filter((b) => owner.get(b) === d.id || owner.get(b) === b.from && !dfeats.some((f) => f.id === owner.get(b)));
    const taken = [];
    const SIZE = { well: 10, fountain: 18, shrine: 12, watch: 14 }; // feet across
    for (const [what, n] of Object.entries(want)) {
      let left = n;
      if (what === "well" || what === "fountain") {
        for (const [x, y] of crossings) {
          if (left <= 0) break;
          const size = SIZE[what] / sq;
          if (!pointInPolygon([x, y], poly) || taken.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < 6) || !clearOfMine(x, y, size / 2)) continue;
          if (ownBuildings.some((b) => Math.hypot(b.cx - x, b.cy - y) < Math.max(b.len, b.dep) / 2 + size / 2)) continue;
          taken.push([x, y]);
          left--;
          items.push({ kind: "prop", id: `${d.id}/x-${what}${taken.length}`, from: d.id, class: what, x, y, rot: 0, variant: r.int(8), scale: (what === "fountain" ? 18 : 8) / sq / 0.45 });
        }
      }
      for (const sp of order) {
        if (left <= 0) break;
        const size = SIZE[what] / sq, reach = (size / 2) * Math.SQRT2; // a turned square's corners reach farther
        const off = sp.width / 2 + reach + 0.25, along = reach + 0.4;
        const x = sp.at[0] + sp.dir[0] * along - sp.dir[1] * off * sp.side, y = sp.at[1] + sp.dir[1] * along + sp.dir[0] * off * sp.side;
        const rot = (Math.atan2(sp.dir[1], sp.dir[0]) * 180) / Math.PI;
        const box = shapeToPolygon({ rect: [x - reach, y - reach, x + reach, y + reach] });
        if (!box.every((p) => pointInPolygon(p, poly)) || taken.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < 6)) continue;
        if (!free(x, y, reach + 0.1, reach) || !rectFree(box) || !clearOfMine(x, y, reach)) continue;
        taken.push([x, y]);
        left--;
        if (what === "shrine") addBuilding({ shape: { rect: [x - size / 2, y - size / 2, x + size / 2, y + size / 2] }, rot, roof: "slate", roofStyle: "pyramid", height: 22, chimney: false, use: "shrine" }, `${d.id}/h-shrine${taken.length}`, r.fork("shrine", taken.length), d.id);
        else if (what === "watch") addBuilding({ shape: { circle: [x, y, size / 2] }, rot, roof: "slate-black", roofStyle: "flat", height: 34, chimney: false, tower: true, crenels: true, use: "watch" }, `${d.id}/h-watch${taken.length}`, r.fork("watch", taken.length), d.id);
        else items.push({ kind: "prop", id: `${d.id}/x-${what}${taken.length}`, from: d.id, class: what, x, y, rot, variant: r.int(8), scale: (what === "fountain" ? SIZE.fountain : 8) / sq / 0.45 });
      }
    }
  }

  /** How many graves a temple's yard holds: more in a bigger place, most around a cathedral. */
  function graveCount(d, cathedral) {
    return Math.round(({ hamlet: 8, village: 14, town: 22, city: 30 }[d.profile] ?? 14) * (cathedral ? 1.6 : 1));
  }
  /**
   * Graves in rows in a temple's yard, square to the temple, each clear of buildings, trees and each other.
   */
  function addGraves(d, poly, rot, count, r) {
    const ux = Math.cos((rot * Math.PI) / 180), uy = Math.sin((rot * Math.PI) / 180);
    const [cx, cy] = centroid(poly);
    const us = poly.map(([x, y]) => (x - cx) * ux + (y - cy) * uy), vs = poly.map(([x, y]) => -(x - cx) * uy + (y - cy) * ux);
    const step = 14 / sq, row = 20 / sq;
    const spots = [];
    // Only this district's own trees (another district's never reach into its temple's yard, and reading another
    // feature's would tie these graves to it, outside the district's cache key; a grave under a plan's tree is taken
    // out after, with the other districts' clean-up)
    const trees = items.filter((t) => t.kind === "tree" && t.from === d.id);
    for (let v = Math.min(...vs) + row / 2; v < Math.max(...vs); v += row) for (let u = Math.min(...us) + step / 2; u < Math.max(...us); u += step) {
      const x = cx + ux * u - uy * v, y = cy + uy * u + ux * v;
      if (pointInPolygon([x, y], poly) && free(x, y, 0.3, 0.2) && !trees.some((t) => Math.abs(t.x - x) < 0.8 && Math.abs(t.y - y) < 0.8)) spots.push([x, y]);
    }
    // Rows filled from one side, a few gaps left, so the yard reads as used but not full
    let n = 0;
    for (const [x, y] of spots) {
      if (n >= count) break;
      if (r.next() < 0.25) continue;
      items.push({ kind: "prop", id: `${d.id}/grave${++n}-${Math.round(x * 10)}`, from: d.id, class: "grave", x, y, rot: rot + 90 + (r.next() - 0.5) * 8, variant: r.int(8), scale: 9 / sq / 0.45 });
    }
  }

  function addProp(f, r) {
    const [x, y] = f.at;
    const size = Number.isFinite(f.size) && f.size > 0 ? f.size / sq : null; // across, in squares
    if (f.class === "tree") {
      const species = isConifer(f.species) ? "conifer" : "bare";
      const s = species === "bare" ? 0.5 + r.next() * 0.25 : 0.9 + r.next() * 0.6; // drawn even when its size is given
      // Its size: the crown across (the art is drawn 1.1 times its size, the crown filling about three quarters)
      const sized = size === null ? s : size / ((species === "bare" ? 2.2 * 0.75 : 0.85) * 1.1);
      items.push({ kind: "tree", id: f.id, from: f.id, x, y, species, size: species === "conifer" ? "large" : null, s: sized, rot: r.next() * 360, variant: r.int(8) });
    } else {
      items.push({ kind: "prop", id: f.id, from: f.id, class: f.class, x, y, rot: f.rot ?? 0, variant: r.int(8), ...(size !== null ? { scale: size / (PROP_SQUARES[f.class] ?? 0.45) } : {}) });
    }
  }

  // What free() keeps clear of, in grids so it measures only what's near (the same answers as measuring
  // everything). The grids catch up with space's lists, which only grow, each time free() is asked
  const nearby = {
    reserved: new BoxGrid(), gardens: new BoxGrid(), buildings: new BoxGrid(),
    water: new SegGrid([], { pad: (p) => space.water[p].clear }), ways: new SegGrid([], { pad: (p) => space.ways[p].clear }),
  };
  const polyBox = (grid, poly) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of poly) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
    grid.add(x0, y0, x1, y1);
  };
  const catchUp = () => {
    for (const k of ["reserved", "gardens"]) while (nearby[k].count < space[k].length) polyBox(nearby[k], space[k][nearby[k].count]);
    for (const k of ["water", "ways"]) while (nearby[k].paths.length < space[k].length) nearby[k].addPath(space[k][nearby[k].paths.length].path);
    const bs = nearby.buildings;
    while (bs.count < space.buildings.length) {
      const b = space.buildings[bs.count], m = Math.max(b.len, b.dep) * 0.5 * 0.8 + 0.15;
      bs.add(b.cx - m, b.cy - m, b.cx + m, b.cy + m);
    }
  };

  /** True when a thing of radius rad (half-depth half, when given) at x, y keeps clear of everything placed so far. */
  function free(x, y, rad, half = rad) {
    if (x < -1 || y < -1 || x > W + 1 || y > H + 1) return false;
    catchUp();
    const pr = Math.max(0, rad * 0.9);
    for (const k of nearby.reserved.near(x, y, pr)) { const poly = space.reserved[k]; if (!elsewhere(poly) && (pointInPolygon([x, y], poly) || distanceToPath([x, y], closed(poly)) < rad * 0.9)) return false; }
    for (const k of nearby.gardens.near(x, y, pr)) { const poly = space.gardens[k]; if (!elsewhere(poly) && (pointInPolygon([x, y], poly) || distanceToPath([x, y], closed(poly)) < rad * 0.9)) return false; }
    const hr = Math.max(0, half);
    // (a pond's or lake's shore by the thing's whole reach, so a farmhouse's corner stays off it too)
    for (const k of nearby.water.near(x, y, Math.max(hr, rad))) { const w = space.water[nearby.water.segPath[k]]; if (nearby.water.dist(x, y, k) < (w.body ? Math.max(half, rad) : half) + (w.clears ? w.clears[nearby.water.segIndex[k] - 1] : w.clear)) return false; }
    for (const k of nearby.ways.near(x, y, hr)) { const w = space.ways[nearby.ways.segPath[k]]; if (!elsewhere(w) && nearby.ways.dist(x, y, k) < half + w.clear) return false; }
    for (const k of nearby.buildings.near(x, y, Math.max(0, rad * 0.8))) { const b = space.buildings[k]; if (!elsewhere(b) && Math.hypot(b.cx - x, b.cy - y) < (rad + Math.max(b.len, b.dep) * 0.5) * 0.8 + 0.15) return false; }
    return true;
  }



  // Quays and wharves along the water's edge (ways that houses front and streets start from), piers and jetties out
  // into it; then each lake's or sea's shore where no quay covers it, and the reeds and lily pads along it
  const runsSq = items.filter((i) => i.kind === "water" && i.path);
  const quayEdges = [];
  const docks = [];
  const laid = []; // each quay as laid, to lay again along a moat (below)
  for (const f of plan.features.filter((f) => f.type === "dock")) {
    const d = layDock(f, { runs: runsSq, bodies, sq });
    if (!d) { notes.push({ level: "warning", id: f.id, message: `"${f.id}" is too short to build.` }); continue; }
    notes.push(...d.notes);
    if (!d.item) continue;
    items.push(d.item);
    docks.push(d.item);
    if (d.way) {
      const entry = { path: d.way.path, clear: d.way.width / 2 - 0.05, owner: null };
      ways.push(d.way);
      space.ways.push(entry);
      quayEdges.push(d.edge);
      laid.push({ f, d, entry, notes: d.notes });
    }
    for (const poly of d.keep) { space.reserved.push(poly); space.zones.push(poly); }
  }
  for (const b of bodies) {
    const { runs, quayed } = shoreRuns(b.ring, quayEdges);
    b.runs = runs;
    // The shore no quay covers is kept clear: streets end short of it and nothing is placed on it
    for (const run of runs) for (const poly of bandPieces(run, b.keep)) { space.reserved.push(poly); space.zones.push(poly); }
    // Where a quay covers the shore, things keep clear of the water's edge only, as along a river
    if (quayed.some(Boolean)) {
      const entry = space.water.find((w) => w.body === b.poly);
      entry.clears = quayed.map((q) => (q ? 0.225 : entry.clear));
    }
    const life = shoreLife({ body: b, r: streamFor(b.id).fork("life"), docks, seed: seedOf(plan, b.id), W, H, winter });
    life.reeds.forEach((t, k) => items.push({ kind: "reed", id: `${b.id}/r${k + 1}`, from: b.id, ...t }));
    life.lilies.forEach((t, k) => items.push({ kind: "lily", id: `${b.id}/l${k + 1}`, from: b.id, ...t }));
  }

  // Town walls and palisades: their runs, towers and gatehouses, a ditch or moat, and clear ground along them
  // (streets end there, and only roads pass, through gates)
  const wallBands = [];
  const gatedBy = new Set(); // what has a gate through a wall
  const wallGatePts = []; // where the gates stand
  {
    // (and quays: one with no water near it yet may be moved onto a moat, below, so it gets a gate where it crosses
    // and keeps towers off it, but doesn't stop the wall where it only runs over it)
    const roadsSq = [...plan.features.filter((f) => f.type === "road" && Array.isArray(f.path)).map((f) => ({ id: f.id, path: f.path, width: ft(f.width) })), ...laid.map((q) => ({ id: q.d.way.id, path: q.d.way.path, width: q.d.way.width, ...(q.d.snapped ? {} : { over: false }) }))];
    const watersSq = [
      ...plan.features.filter((f) => f.type === "water" && Array.isArray(f.path)).map((f) => (f._w ? { id: f.id, path: f.path, width: Math.max(...f._w), widths: f._w } : { id: f.id, path: f.path, width: ft(f.width) })),
      ...bodies.map((b) => ({ id: b.id, path: b.ring, width: 0, body: b.poly, reach: b.keep })),
    ];
    const moatFrozen = plan.features.some((f) => f.type === "water" && f.frozen); // a moat freezes with the plan's water
    for (const f of plan.features.filter(isTownWall)) {
      const r = streamFor(f.id);
      const w = layWall(f, { roads: roadsSq, waters: watersSq, sq, r: r.fork("wall") });
      for (const g of w.gates) { gatedBy.add(g.road); if (Array.isArray(g.at)) wallGatePts.push(g.at); }
      if (!w.runs.length && !w.notes.some((n) => /too short|all gates or water/.test(n.message))) notes.push({ level: "warning", id: f.id, message: `Nothing of "${f.id}" is built: all of it lies on roads or water.` });
      // Each run carries its outer face (where the battlements are) and its inner one
      w.runs.forEach((path, k) => items.push({ kind: "wall", id: w.runs.length === 1 ? f.id : `${f.id}/r${k + 1}`, from: f.id, class: f.class, path, height: ft(f.height), tall: tallOf(f.height ?? 25), thickness: ft(f.thickness), side: w.side, face: offsetPath(path, (w.side * ft(f.thickness)) / 2), back: offsetPath(path, (-w.side * ft(f.thickness)) / 2) }));
      w.ditches.forEach((d, k) => {
        const id = `${f.id}/${d.moat ? "moat" : "ditch"}${k ? `-${k + 1}` : ""}`;
        if (d.moat) {
          // Before the plan's own water, so a river or stream is painted over where the moat opens into it
          const first = items.findIndex((i) => i.kind === "water");
          items.splice(first < 0 ? items.length : first, 0, { kind: "water", id, from: f.id, class: "moat", path: d.path, width: d.width, frozen: moatFrozen });
          space.water.push({ path: d.path, clear: d.width / 2 + 0.225 });
        } else items.push({ kind: "ditch", id, from: f.id, path: d.path, width: d.width });
        for (const poly of bandPieces(d.path, d.width / 2 + 0.1)) { space.reserved.push(poly); space.zones.push(poly); }
      });
      w.bridges.forEach((b, k) => items.push({ kind: "crossing", id: `${f.id}/b${k + 1}`, from: f.id, class: "bridge", at: b.at, angle: b.angle, length: b.length, width: b.width, frozen: false }));
      // Each tower from its own stream by where it stands; none well off the map
      const onMap = (t) => !Array.isArray(t.at) || (t.at[0] > -0.5 && t.at[1] > -0.5 && t.at[0] < W + 0.5 && t.at[1] < H + 0.5);
      w.towers.forEach((t, k) => { if (onMap(t)) addBuilding(t, `${f.id}/t${k + 1}`, r.fork("tower", t.key), f.id); });
      w.towers = w.towers.filter(onMap);
      for (const poly of bandPieces(f.path, w.band.half)) { space.reserved.push(poly); space.zones.push(poly); }
      wallBands.push({ path: f.path, half: w.band.half });
      notes.push(...w.notes);
      notes.push({ level: "info", id: f.id, message: `"${f.id}": ${w.towers.filter((t) => t.kind !== "gatehouse").length} towers, ${w.gates.length} ${w.gates.length === 1 ? "gate" : "gates"}${w.ditches.length ? (w.ditches[0].moat ? ", a moat" : ", a ditch") : ""}.` });
    }
  }
  const inWallBand = (x, y) => wallBands.some((b) => distanceToPath([x, y], b.path) < b.half);

  // A quay with no water near it until the walls' moats were dug: laid again along the moat (nothing has placed
  // anything by it yet)
  const moats = items.filter((i) => i.kind === "water" && i.class === "moat");
  if (moats.length) for (const q of laid) {
    if (q.d.snapped || gatedBy.has(q.d.way.id)) continue; // one with a gate stays where it was drawn, through it
    const again = layDock(q.f, { runs: moats, bodies: [], sq });
    if (!again?.item || !again.snapped) continue;
    // Not on the moat's inner bank, between the moat and the wall: the wall and its towers stand there
    if ([...again.item.path, ...again.item.land].some(([x, y]) => inWallBand(x, y))) continue;
    Object.assign(q.d.item, again.item);
    q.d.way.path = q.entry.path = again.way.path;
    for (const n of q.notes) { const k = notes.indexOf(n); if (k >= 0) notes.splice(k, 1); }
    notes.push(...again.notes);
  }
  // A quay drawn in a district and moved onto the water's edge out of it: the district has nothing to front it
  for (const { f, d } of laid) {
    const home = districts.find((x) => pathTouchesPolygon(f.path, x.poly));
    if (home && !pathTouchesPolygon(d.item.land, home.poly) && !pathTouchesPolygon(d.item.path, home.poly))
      notes.push({ level: "warning", id: f.id, message: `"${f.id}" was moved onto the water's edge, outside "${home.id}", so no houses there face it. Take "${home.id}" out to the water.` });
  }

  // Squares: a fountain or a market cross near the middle (as the square's setting says, else by its seed: a
  // market square mostly a cross, a paved one often a fountain), clear of the roads through it; then market stalls
  // in rows along the road through it, off the roads, water, buildings and props there, and clear of that. Laid
  // once the walls, their towers and moats and the docks are (a square a wall runs through keeps clear of it)
  for (const f of plan.features.filter((x) => x.type === "square")) {
    const poly = shapeToPolygon(f.shape), ring = [...poly, poly[0]];
    if (poly.length < 3 || !poly.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) continue; // (the checker refuses it)
    const [x0, y0, x1, y1] = bbox(poly);
    const at = f.shape?.circle ? [f.shape.circle[0], f.shape.circle[1]] : [(x0 + x1) / 2, (y0 + y1) / 2];
    // The rows run along the road nearest its middle, else along its longer side
    let angle = x1 - x0 >= y1 - y0 ? 0 : 90, best = Infinity;
    for (const w of ways) for (let i = 1; i < w.path.length; i++) {
      const a = w.path[i - 1], b = w.path[i], d = distanceToPath(at, [a, b]);
      if (d < best && d < Math.max(x1 - x0, y1 - y0) / 2) { best = d; angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI; }
    }
    const fixedBuildings = items.filter((i) => i.kind === "building").map((b) => shapeToPolygon({ rect: [b.cx - b.len / 2, b.cy - b.dep / 2, b.cx + b.len / 2, b.cy + b.dep / 2] }, b.rot));
    // (each plan prop or tree by its own size; walls, hedges and fences as lines)
    const fixedProps = items.filter((i) => i.kind === "prop" || i.kind === "tree").map((q) => ({ x: q.x, y: q.y, r: q.kind === "tree" ? 0.5 : ((PROP_SQUARES[q.class] ?? 0.45) * (q.scale ?? 1)) / 2 }));
    const lines = items.filter((i) => (i.kind === "wall" || i.kind === "boundary") && Array.isArray(i.path));
    const walled = (p, m) => inWallBand(p[0], p[1]) || lines.some((w) => distanceToPath(p, w.path) < (w.thickness ?? 0.2) / 2 + m);
    const clear = (p) => (!mid || Math.hypot(p[0] - mid[0], p[1] - mid[1]) > 0.9)
      && ways.every((w) => distanceToPath(p, w.path) > w.width / 2 + 0.08)
      && !space.water.some((w) => nearWater(p, w, 0.3)) && !walled(p, 0.15)
      && !fixedBuildings.some((b) => pointInPolygon(p, b) || distanceToPath(p, [...b, b[0]]) < 0.15)
      && fixedProps.every((q) => Math.hypot(q.x - p[0], q.y - p[1]) > q.r + 0.15);
    const inside = (p) => pointInPolygon(p, poly) && distanceToPath(p, ring) > 0.2;
    const mr = rng(seedOf(plan, f.id), f.id, "middle"), roll = mr.next(), turn = mr.next() * 360, variant = mr.int(8);
    const kind = ["fountain", "cross", "none"].includes(f.middle) ? f.middle
      : f.market ? (roll < 0.55 ? "cross" : "fountain")
      : f.surface === "grass" ? (roll < 0.25 ? "cross" : "none")
      : roll < 0.4 ? "fountain" : roll < 0.6 ? "cross" : "none";
    let mid = null;
    if (kind !== "none") {
      const rad = (kind === "fountain" ? 20 : 12) / sq / 2;
      const ok = (p) => inside(p) && distanceToPath(p, ring) > rad + 0.2 && ways.every((w) => distanceToPath(p, w.path) > w.width / 2 + rad + 0.3) && !space.water.some((w) => nearWater(p, w, rad + 0.3))
        && !walled(p, rad + 0.2) && !fixedBuildings.some((b) => pointInPolygon(p, b) || distanceToPath(p, [...b, b[0]]) < rad + 0.2) && fixedProps.every((q) => Math.hypot(q.x - p[0], q.y - p[1]) > q.r + rad + 0.2);
      // The open spot nearest the middle (rings out from it)
      for (let d = 0; d <= Math.max(x1 - x0, y1 - y0) / 2 && !mid; d += 0.25) for (let k = 0, n = Math.max(1, Math.round(d * 8)); k < n && !mid; k++) {
        const p = [at[0] + Math.cos((k / n) * 2 * Math.PI) * d, at[1] + Math.sin((k / n) * 2 * Math.PI) * d];
        if (ok(p)) mid = p;
      }
      if (mid) {
        const size = kind === "fountain" ? 20 : 12;
        items.push({ kind: "prop", id: `${f.id}/${kind}`, from: f.id, class: kind, x: mid[0], y: mid[1], rot: kind === "cross" ? angle : turn, variant, scale: size / sq / PROP_SQUARES[kind] });
        fixedProps.push({ x: mid[0], y: mid[1], r: rad });
      }
    }
    if (f.market !== true) continue;
    const reach = Math.min(Math.hypot(x1 - x0, y1 - y0) / 2 + 1, Math.hypot(W, H));
    marketStalls({ at, angle, reach, inside, clear, r: rng(seedOf(plan, f.id), f.id, "stalls"), sq }).forEach((x, k) => items.push({ kind: "prop", id: `${f.id}/stall-${k + 1}`, from: f.id, ...x }));
  }

  // Boats and cranes: moored along the quays, wharves, piers and jetties, ships at the sea's, cranes on stone quays,
  // ships riding at anchor off a harbor and rowboats on a river by the houses; none on frozen water or under a bridge
  {
    const lakeLike = items.filter((i) => i.kind === "water" && i.poly && !i.frozen);
    const rivers = items.filter((i) => i.kind === "water" && i.path && !i.frozen && (i.class === "river" || i.class === "stream"));
    const waterAt = (p) => {
      for (const b of lakeLike) if (pointInPolygon(p, b.poly)) return b.class === "sea" ? "sea" : "lake";
      for (const w of rivers) if (pastEdge(p, w) < -0.03) return "river";
      return null;
    };
    const spans = items.filter((i) => i.kind === "crossing").map((c) => ({ at: c.at, r: (c.length ?? 1) / 2 + 0.6 }));
    const piers = docks.filter((d) => !d.edge);
    const clear = (p) => spans.every((c) => Math.hypot(c.at[0] - p[0], c.at[1] - p[1]) > c.r) && piers.every((d) => distanceToPath(p, d.path) > d.width / 2 + 0.03);
    const H = harborProps({ docks, waterAt, clear, forkOf: (id) => streamFor(id).fork("boats") });
    const sea = lakeLike.find((b) => b.class === "sea");
    const ar = rng(plan.seed ?? 1, "afloat");
    if (sea && docks.length) {
      const near = (p) => Math.min(...docks.map((d) => Math.min(...d.path.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1])))));
      const [x0, y0, x1, y1] = bbox(sea.poly), spots = [];
      for (let k = 0; k < 160; k++) { const p = [x0 + ar.next() * (x1 - x0), y0 + ar.next() * (y1 - y0)], a = ar.next() * 2 * Math.PI; if (pointInPolygon(p, sea.poly) && distanceToPath(p, [...sea.ring, sea.ring[0]]) > 3 && near(p) < 16) spots.push({ p, u: [Math.cos(a), Math.sin(a)], d: near(p) }); }
      afloat({ spots: spots.sort((a, b) => a.d - b.d), cls: "ship", count: 1 + ar.int(3), kinds: ["sea"], fits: H.fits, add: H.add, r: ar.fork("ships") });
    }
    if (rivers.length && districts.length) {
      const spots = [];
      for (const w of rivers) for (let i = 1; i < w.path.length; i++) {
        const a = w.path[i - 1], b = w.path[i], u = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...u) || 1, n = [-u[1] / l, u[0] / l], side = ar.chance(0.5) ? 1 : -1, off = ((w.width ?? 1) / 2) * 0.45;
        const p = [(a[0] + b[0]) / 2 + n[0] * side * off, (a[1] + b[1]) / 2 + n[1] * side * off];
        const d = Math.min(...districts.map((x) => (pointInPolygon(p, x.poly) ? 0 : distanceToPath(p, [...x.poly, x.poly[0]]))));
        if (d < 6 && (w.width ?? 0) > BOAT_SQUARES.boat * 3) spots.push({ p, u: [u[0] / l, u[1] / l], d: d + ar.next() * 4 });
      }
      afloat({ spots: spots.sort((a, b) => a.d - b.d), cls: "boat", count: ar.int(3), kinds: ["river"], fits: H.fits, add: H.add, r: ar.fork("boats") });
    }
    H.props.forEach((x, k) => items.push({ kind: "prop", id: `harbor/${x.class}-${k + 1}`, from: "plan", ...x, scale: 1 }));
  }

  // Parks: open ground that streets and plots keep out of (filled later, once the streets around them are known)
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
  const waterAt = (x, y) => space.water.some((w) => nearWater([x, y], w));
  const gates = districtGates(dlist, { roads: ways, inWater: (x, y) => waterAt(x, y) || inWallBand(x, y), seed: plan.seed });
  const radials = plan.features.filter((f) => f.type === "square" && f.radial).map((f) => {
    const poly = shapeToPolygon(f.shape);
    const [x0, y0, x1, y1] = bbox(poly);
    const at = [(x0 + x1) / 2, (y0 + y1) / 2];
    return { at, radius: poly.reduce((s, p) => s + Math.hypot(p[0] - at[0], p[1] - at[1]), 0) / poly.length };
  });
  // What every district's fill reads besides itself and what's near it (see districtCache), hashed once
  const waterItems = items.filter((i) => i.kind === "water" && i.path);
  // What plots keep off: each stream and river (a stretch at a time where its width varies), and each lake's or sea's
  // shore where no quay covers it (a quay is a way, which plots front)
  const lotWater = [
    ...waterItems.flatMap((w) => (w.widths ? w.path.slice(1).map((b, i) => ({ path: [w.path[i], b], width: Math.max(w.widths[i], w.widths[i + 1]) })) : [w])),
    ...bodies.flatMap((b) => b.runs.map((path) => ({ path, width: 2 * (b.keep - 0.1) }))),
  ];
  // Each settlement's notable buildings shared out among its districts, and what the trades are sited by: the water
  // (rivers flow from their first point), the plan's roads, the squares and greens, the wind for smoke
  const roadIds = new Set(plan.features.filter((f) => f.type === "road").map((f) => f.id));
  const useWater = [...waterItems.map((w) => ({ path: w.path, width: w.width })), ...bodies.map((b) => ({ ring: b.ring }))];
  const greens = [...plan.features.filter((f) => f.type === "square").map((f) => shapeToPolygon(f.shape)), ...parks.filter((f) => f.class === "park" && f.style !== "formal").map((f) => shapeToPolygon(f.shape, f.rot ?? 0))];
  const notables = notablesFor({ dlist: dlist.map((x) => ({ ...x, seed: seedOf(plan, x.id), feature: dfeats.find((f) => f.id === x.id) })), squares: greens, roads: ways.filter((w) => roadIds.has(w.id)), gates: wallGatePts, r: rng(plan.seed, "notables") });
  const wind = rng(plan.seed, "wind").next() * 360;
  // Buildings the plan already has with a use (drawn, or pinned), by the district they stand in: a district doesn't
  // build another inn because the GM pinned its inn
  const planUsesIn = new Map();
  for (const f of plan.features) {
    const bs = f.type === "building" ? [f] : f.type === "landmark" ? f.buildings ?? [] : [];
    const counted = new Set();
    for (const b of bs) {
      if (typeof b.use !== "string" || counted.has(b.use)) continue;
      const [x0, y0, x1, y1] = bbox(shapeToPolygon(b.shape ?? { rect: [0, 0, 0, 0] }));
      const home = dlist.find((x) => pointInPolygon([(x0 + x1) / 2, (y0 + y1) / 2], x.poly));
      if (!home) continue;
      counted.add(b.use); // a landmark's parts share a use: one building
      const m = planUsesIn.get(home.id) ?? {};
      m[b.use] = (m[b.use] ?? 0) + 1;
      planUsesIn.set(home.id, m);
    }
  }
  /** A list of uses less those the plan already has (each counted once). */
  const lessPlanned = (list, have = {}) => { const left = { ...have }; return list.filter((u) => !(left[u] > 0 && left[u]--)); };
  /** Counts of small things less those the plan already has. */
  const reduceBy = (want, have = {}) => Object.fromEntries(Object.entries(want).map(([k, n]) => [k, Math.max(0, n - (have[k] ?? 0))]));
  const shared = cache ? hash128(keyJSON([LAYOUT_VERSION, plan.seed, sq, W, H, waterItems, space.water, radials, bodies.length ? lotWater : 0, wind])).join(".") : null;
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
    // Squares, yards and buildings placed before the districts, for plots and houses to keep off. The streets are traced
    // around the squares and yards only: a building (a plan's, or a pinned house) would stop a street being seeded
    // anywhere near it, so a pinned house would take its own street away. Streets that run into one are cut short of it
    // after (trimAtBuildings)
    const blocked = [...around.zones, ...around.plots];
    const streetBlocked = [...around.zones];
    // Laid out before with the same inputs: what it made is put back as it was (a district overlapping another sees
    // that one's things, so it's always laid out afresh)
    const overlaps = [...touching].some((k) => k.startsWith(`${d.id}|`));
    let key = null;
    if (cache && !overlaps) {
      key = hash128(keyJSON([shared, d, seedOf(plan, d.id), notables.get(d.id) ?? null, planUsesIn.get(d.id) ?? null, [...roadIds], gates.get(d.id) ?? [], borders, dlist.filter((o) => o.id !== d.id).flatMap((o) => sharedEdges(poly, o.poly)), nearHere, around])).join(".");
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
    // Its anchor first, the landmark its character is known by, on its own square: the streets lead to it and the
    // plots keep off it (where it stands hangs on the district's shape and roads, not its seed)
    const anchorAt = anchorFor({ district: d, poly, roads: nearHere, water: space.water, blocked: [...around.zones, ...around.plots], ftPerSquare: sq });
    const anchor = anchorAt ? layAnchor(anchorAt, r.fork("anchor"), sq) : null;
    // A band along a path (half its width each side) that stays in the district, off water, the plan's roads, squares,
    // yards and buildings: where the anchor's ring and approach streets may run
    // (bandWhy says what's in the way: "road" when it's only a plan road, which can stand in for the street; skip: a
    // road it may meet)
    const bandWhy = (path, half, skip = null) => {
      catchUp();
      let road = false;
      for (const [p] of stepsAlong(path, 0.4)) {
        if (!pointInPolygon(p, poly)) return "other";
        for (const k of nearby.water.near(p[0], p[1], half)) { const w = space.water[nearby.water.segPath[k]]; if (nearby.water.dist(p[0], p[1], k) < half + (w.clears ? w.clears[nearby.water.segIndex[k] - 1] : w.clear)) return "other"; }
        if ([...around.zones, ...around.plots].some((z) => pointInPolygon(p, z) || distanceToPath(p, closed(z)) < half)) return "other";
        if (nearHere.some((w) => w !== skip && distanceToPath(p, w.path) < w.width / 2 + half)) road = true;
      }
      return road ? "road" : null;
    };
    const bandClear = (path, half, skip = null) => bandWhy(path, half, skip) === null;
    // A street all around the anchor's block, so the houses about it face it, as a square's do (where it fits); the
    // district's own streets then stop at its outer edge rather than on the block's walls
    const ringWidth = sq ? (typeOf(d).streets?.width ?? 15) / sq : 0.6;
    // A side the main road already runs along is left to the road (the anchor often stands by it); anything else in
    // the way, and there's no ring. anchorRing: the ring's corners; ringRuns: the stretches laid, front (the side
    // facing out, R[0] to R[1]) first if it's laid
    let anchorRing = null, ringRuns = [], frontOnRoad = false;
    if (anchor) {
      const g = ringWidth / 2 + 0.02;
      const R = shapeToPolygon({ rect: [anchor.center[0] - anchor.w / 2 - g, anchor.center[1] - anchor.h / 2 - g, anchor.center[0] + anchor.w / 2 + g, anchor.center[1] + anchor.h / 2 + g] }, anchor.rot);
      const why = R.map((a, k) => bandWhy([a, R[(k + 1) % 4]], ringWidth / 2));
      if (!why.includes("other") && why.some((w) => w === null)) {
        anchorRing = R;
        if (why.every((w) => w === null)) ringRuns = [[...R, R[0]]];
        else {
          // Runs of laid sides, each from the corner after a road side
          const start = why.findIndex((w, k) => w === null && why[(k + 3) % 4] !== null);
          let cur = null;
          for (let n = 0; n < 4; n++) {
            const k = (start + n) % 4;
            if (why[k] !== null) { cur = null; continue; }
            if (!cur) { cur = [R[k]]; ringRuns.push(cur); }
            cur.push(R[(k + 1) % 4]);
          }
        }
      }
      // Its front: the side whose middle is nearest where the approach starts
      const fp = anchor.approach?.[0];
      if (fp) {
        const mids = R.map((a, k) => [(a[0] + R[(k + 1) % 4][0]) / 2, (a[1] + R[(k + 1) % 4][1]) / 2]);
        const fk = mids.reduce((b, m, k) => (Math.hypot(m[0] - fp[0], m[1] - fp[1]) < Math.hypot(mids[b][0] - fp[0], mids[b][1] - fp[1]) ? k : b), 0);
        frontOnRoad = why[fk] === "road";
      }
    }
    // (with no ring, a street's half width short of the walls, so its end doesn't run over them)
    const grow = anchorRing ? ringWidth + 0.05 : ringWidth / 2 + 0.05;
    const streetStop = anchor ? shapeToPolygon({ rect: [anchor.center[0] - anchor.w / 2 - grow, anchor.center[1] - anchor.h / 2 - grow, anchor.center[0] + anchor.w / 2 + grow, anchor.center[1] + anchor.h / 2 + grow] }, anchor.rot) : null;
    const made = streetsFor({
      district: d, poly, roads: fixedHere, water: space.water, radials: anchor?.radial ? [...radials, { ...anchor.radial, anchor: true }] : radials, blocked: streetStop ? [...streetBlocked, streetStop] : streetBlocked, gates: gates.get(d.id) ?? [], borders,
      ftPerSquare: sq, r: r.fork("streets"),
    });
    made.streets = trimAtBuildings(made.streets, around.plots);
    for (const path of ringRuns) made.streets.push({ path, kind: "street", width: ringWidth, ends: [], ring: true });
    // The anchor's square opens onto the town: a street straight out from the middle of its front to the nearest
    // street or road it meets, where that way is clear
    // (none when its front is on the main road already); checked up to the edge of the way it meets
    if (anchor?.approach && !frontOnRoad) {
      const [front, dir] = anchor.approach;
      const from = anchorRing ? [front[0] + dir[0] * ringWidth, front[1] + dir[1] * ringWidth] : front;
      const others = [...made.streets.filter((st) => !st.ring).map((st) => ({ path: st.path, width: st.width ?? ringWidth, road: null })), ...nearHere.map((w) => ({ path: w.path, width: w.width, road: w }))];
      let hit = null;
      for (const o of others) for (let i = 1; i < o.path.length; i++) {
        const t = rayHit(from, dir, o.path[i - 1], o.path[i]);
        if (t !== null && t > 0.2 && (!hit || t < hit.t)) hit = { t, o };
      }
      const to = hit ? [from[0] + dir[0] * hit.t, from[1] + dir[1] * hit.t] : null;
      const upTo = hit ? hit.t - hit.o.width / 2 - 0.05 : 0;
      if (to && hit.t < 25 && upTo > 0.1 && bandClear([from, [from[0] + dir[0] * upTo, from[1] + dir[1] * upTo]], ringWidth / 2, hit.o.road)) made.streets.push({ path: [from, to], kind: "street", width: ringWidth, ends: [] });
    }
    // How its character shows: the ground under it, its streets' surface, trees along them, its blocks built up
    const look = lookOf(d);
    const surface = d.surface ?? look.street ?? fixedHere.find((w) => !w.quay)?.surface ?? "dirt";
    if (look.ground) items.push({ kind: "surface", id: `${d.id}/ground`, from: d.id, class: "quarter", poly, ...look.ground });
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
    const keepOff = [...blocked, ...gateClear, ...(anchor ? [anchor.block] : [])];
    const { lots, back } = lotsFor({ district: d, poly, ways: [...nearHere, ...own], water: lotWater, blocked: keepOff, ftPerSquare: sq, r: r.fork("lots") });
    // Which plots go to its notable buildings, trades and shops
    const note = notables.get(d.id);
    const usesFor = (tryForm) => planUses({ district: d, lots, ways: [...nearHere, ...own], want: lessPlanned((note?.want ?? []).filter((u) => !(anchor && u === "temple" && anchorAt.kind === "temple")), planUsesIn.get(d.id)), ctx: note?.ctx ?? { center: centroid(poly), radius: 10, gates: [], squares: [] }, water: useWater, roadIds, ftPerSquare: sq, r: r.fork("uses"), tryForm });
    const built = buildOnLots({ lots, district: d, ways: [...nearHere, ...own], blocked: keepOff, ftPerSquare: sq, r: r.fork("build"), usesFor });
    const uses = built.uses;
    filling = d.id;
    if (anchor) addAnchor(d, anchor, r.fork("anchor-fill"));
    const smoky = [];
    for (const h of built.houses) { const item = addBuilding(h.building, `${d.id}/h-${h.id}`, h.r, d.id); if (h.smoke) smoky.push([item, h.smoke]); }
    for (const o of built.outbuildings) addBuilding(o.building, `${d.id}/o-${o.id}`, o.r, d.id);
    // Smoke from a forge's, kiln's or oven's chimney (or its middle), drifting with the map's wind
    for (const [b, tint] of smoky) {
      const a = (b.rot * Math.PI) / 180, u = b.chimney ? b.chimney.u * b.len : 0, v = b.chimney ? b.chimney.v * b.dep : 0;
      items.push({ kind: "smoke", id: `${b.id}/smoke`, from: d.id, x: b.cx + u * Math.cos(a) - v * Math.sin(a), y: b.cy + u * Math.sin(a) + v * Math.cos(a), tint, s: 1, wind });
    }
    built.kilns.forEach((k, n) => {
      items.push({ kind: "kiln", id: `${d.id}/k${n + 1}`, from: d.id, x: k.x, y: k.y, rad: k.rad });
      items.push({ kind: "smoke", id: `${d.id}/k${n + 1}/smoke`, from: d.id, x: k.x, y: k.y, tint: USE_INFO[k.use]?.smoke ?? "gray", s: 1.2, wind });
      const kp = shapeToPolygon({ circle: [k.x, k.y, k.rad] }, 0, 12);
      owner.set(kp, d.id);
      space.plots.push(kp);
    });
    built.surfaces.forEach((x, k) => items.push({ kind: "surface", id: `${d.id}/u${k + 1}`, from: d.id, class: x.class, poly: x.poly, surface: x.surface }));
    for (const x of built.surfaces.filter((x) => x.class === "churchyard")) {
      const t = built.houses.find((h) => h.site === "temple" && pointInPolygon([(h.building.shape.rect?.[0] + h.building.shape.rect?.[2]) / 2, (h.building.shape.rect?.[1] + h.building.shape.rect?.[3]) / 2], x.poly));
      addGraves(d, x.poly, t?.building.rot ?? 0, graveCount(d, false), r.fork("graves", x.poly.length, Math.round(x.poly[0][0] * 10)));
    }
    built.pits.forEach((x, k) => items.push({ kind: "pit", id: `${d.id}/p${k + 1}`, from: d.id, ...x }));
    built.walls.forEach((path, k) => items.push({ kind: "wall", id: `${d.id}/v${k + 1}`, from: d.id, class: "stone", path, height: 5 / sq }));
    built.props.forEach((x, k) => items.push({ kind: "prop", id: `${d.id}/q${k + 1}`, from: d.id, class: x.class, x: x.x, y: x.y, rot: x.rot, variant: x.variant, scale: (CLUTTER_FT[x.class] ?? 6) / sq / (PROP_SQUARES[x.class] ?? 0.45) }));
    built.gardens.forEach((garden, k) => {
      items.push({ kind: "surface", id: `${d.id}/g${k + 1}`, from: d.id, class: "garden", garden });
      const gp = shapeToPolygon({ rect: [garden.cx - garden.w / 2, garden.cy - garden.d / 2, garden.cx + garden.w / 2, garden.cy + garden.d / 2] }, garden.rot);
      owner.set(gp, d.id);
      space.gardens.push(gp);
    });
    built.crofts.forEach((poly, k) => items.push({ kind: "surface", id: `${d.id}/c${k + 1}`, from: d.id, class: "croft", poly }));
    built.bounds.forEach((b, k) => items.push({ kind: "boundary", id: `${d.id}/f${k + 1}`, from: d.id, class: b.class, path: b.path }));
    // Trees in the plots: orchards in rows and trees about the yards
    built.trees.forEach((t, k) => items.push({ kind: "tree", id: `${d.id}/y${k + 1}`, from: d.id, x: t.x, y: t.y, species: t.species ?? "bare", size: t.size ?? null, s: t.s, rot: t.rot, variant: t.variant }));
    // Ground no plot takes (beyond the back lanes, the middle of big blocks): trees scattered evenly (Poisson-disk),
    // thinned in patches by a noise, so they gather in clumps with open ground between
    const T = lotTypeOf(d);
    const wr = r.fork("wild");
    const patch = makeNoise(plan.seed, `${d.id}/wild`, { scale: 6, octaves: 2 });
    let wild = 0;
    // A dense quarter builds up the middles of its blocks instead: rows of stores, workshops or shacks square to the
    // nearest street, with its clutter between them
    const keepPlots = look.back ? [...lots.map((l) => l.poly), ...built.surfaces.filter((x) => x.poly).map((x) => x.poly)].map((p) => [p, bbox(p)]) : [];
    if (look.back) shapes(back).forEach((piece, k) => fillBack(d, piece, k, look.back, [...nearHere, ...own], r.fork("back", k), keepPlots, built.palette));
    else back.forEach((poly, k) => {
      const pts = poissonInPolygon(poly, T.wild ?? 1.5, wr.fork(k), { keep: (x, y) => patch(x, y) > -0.1 && free(x, y, 0.45), max: 400 });
      for (const [x, y] of pts) {
        wild++;
        items.push({ kind: "tree", id: `${d.id}/w${wild}`, from: d.id, x, y, species: "bare", size: null, s: 0.4 + wr.next() * 0.25, rot: wr.next() * 360, variant: wr.int(8) });
      }
    });
    // Trees along its main streets (a nobles' or temple quarter's), where there's room
    if (look.streetTrees) {
      const tr = r.fork("avenue");
      let n = 0;
      for (const st of own.filter((w) => w.class === "street")) {
        for (const [p, dir] of stepsAlong(st.path, 35 / sq)) for (const side of [-1, 1]) {
          const off = st.width / 2 + 7 / sq;
          const x = p[0] - dir[1] * off * side, y = p[1] + dir[0] * off * side;
          if (!pointInPolygon([x, y], poly) || !free(x, y, 0.4, 0.3)) continue;
          items.push({ kind: "tree", id: `${d.id}/a${++n}`, from: d.id, x, y, species: "bare", size: null, s: 0.42 + tr.next() * 0.12, rot: tr.next() * 360, variant: tr.int(8) });
        }
      }
    }
    // Small things by its streets: wells, fountains, wayside shrines, watch posts (its character says how many)
    if (look.extras) streetCorners(d, poly, own.filter((w) => w.class !== "back"), reduceBy(look.extras, planUsesIn.get(d.id)), r.fork("extras"));
    filling = null;
    const remember = () => {
      if (!key) return;
      districtCache.set(key, structuredClone({
        items: items.slice(mark.items), buildings: space.buildings.slice(mark.buildings), reserved: space.reserved.slice(mark.reserved),
        plots: space.plots.slice(mark.plots), gardens: space.gardens.slice(mark.gardens), ways: space.ways.slice(mark.ways), notes: notes.slice(mark.notes),
      }));
      while (districtCache.size > DISTRICT_CACHE_SIZE) districtCache.delete(districtCache.keys().next().value);
    };
    notes.push({ level: "info", id: d.id, message: `"${d.id}": ${own.length} ${own.length === 1 ? "street or lane" : "streets and lanes"}, ${made.bridges.length} ${made.bridges.length === 1 ? "bridge" : "bridges"}, ${lots.length - uses.sites.reduce((n, st) => n + st.lots.length - 1, 0)} plots, ${built.houses.filter((h) => !h.wing).length} houses (${["L", "T", "U", "court"].map((k) => `${built.houses.filter((h) => h.shape === k).length} ${k}`).join(", ")}; ${built.houses.filter((h) => h.shape === "steps").length} in steps, ${built.houses.filter((h) => /b$/.test(h.id)).length} bays, ${built.houses.filter((h) => /d\d$/.test(h.id)).length} dormers, ${built.houses.filter((h) => /t$/.test(h.id)).length} turrets), ${built.outbuildings.length} outbuildings, ${built.gardens.length} gardens, ${built.crofts.length} crofts, ${built.trees.length} trees in plots, ${wild} beyond.` });
    for (const use of uses?.missed ?? []) notes.push({ level: "info", id: d.id, message: `"${d.name ?? d.id}" had no room for its ${useLabel(use).toLowerCase()}.` });
    for (const use of uses?.dry ?? []) notes.push({ level: "info", id: d.id, message: `"${d.name ?? d.id}" has no water near for its ${useLabel(use).toLowerCase()}, so it has none.` });
    remember();
  }

  // Field systems: open ground, so nothing keeps out of them; their hedgerow trees keep clear of every building
  progress(0.55, "Fields");
  const keepOutMemo = {}; // what every field system keeps out of, worked out once
  for (const f of plan.features.filter((f) => f.type === "area" && f.class === "fields")) {
    const r = streamFor(f.id);
    const made = fillFields({ area: f, r, keepOut: fieldKeepOut(plan, f, keepOutMemo), earlier: earlierFields(plan, f), along: fieldRoads(plan), W, H, ftPerSquare: sq, season: seasonOf(plan) });
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

  /** Hedge bushes added since item number from that stand in a pond, lake or the sea, or on its shore, taken out again. */
  const dropWet = (from) => {
    if (!bodies.length) return;
    for (let k = items.length - 1; k >= from; k--) if (space.water.some((w) => w.body && nearWater([items[k].x, items[k].y], w))) items.splice(k, 1);
  };

  // Parks, filled now: their paths start where the roads, the districts' streets and their own lanes meet them
  const streets = items.filter((i) => i.kind === "way" && !i.faint && !ways.includes(i));
  for (const f of parks) {
    if (f.class === "cemetery") { layCemetery(f); continue; }
    const park = fillPark({ area: f, r: streamFor(f.id), roads: [...ways, ...lanes.filter((l) => l.from === f.id), ...streets], ftPerSquare: sq });
    // A pond, lake or the sea on a green: its paths stop at the shore, and no tree or bed stands in the water
    if (bodies.length) {
      const wet = (x, y, extra = 0) => space.water.some((w) => w.body && nearWater([x, y], w, extra));
      park.surface.paths = park.surface.paths.flatMap((w) => dryPieces(w.path, (q) => wet(q[0], q[1], w.width / 2)).map((path) => ({ ...w, path })));
      park.trees = park.trees.filter((t) => !wet(t.x, t.y, 0.3));
      park.beds = park.beds.filter((b) => !wet(b.cx, b.cy, Math.hypot(b.w, b.d) / 2));
      if (park.surface.basin && wet(park.surface.basin.at[0], park.surface.basin.at[1], park.surface.basin.radius)) park.surface.basin = null;
    }
    items.push({ kind: "surface", id: f.id, from: f.id, class: "park", poly: park.surface.poly, style: park.surface.style, paths: park.surface.paths, basin: park.surface.basin });
    park.trees.forEach((t, k) => items.push({ kind: "tree", id: `${f.id}/t${k + 1}`, from: f.id, x: t.x, y: t.y, species: "bare", size: null, s: t.s, rot: t.rot, variant: t.variant }));
    park.beds.forEach((garden, k) => items.push({ kind: "surface", id: `${f.id}/g${k + 1}`, from: f.id, class: "garden", garden }));
    // Clipped hedges around the beds: small bushes close together
    park.hedges.forEach((path, k) => {
      const before = items.length;
      hedgeBushes({ wall: { id: `${f.id}/h${k + 1}`, from: f.id, path }, r: streamFor(f.id).fork("hedge", k), items, step: 0.22, scale: [0.32, 0.08] });
      dropWet(before);
    });
  }

  /**
   * A cemetery: its ground and paths as a park's (style cemetery), yews, graves, its tombs and chapel, and its wall or
   * hedge; paths cut at a pond, lake or the sea, and nothing of it in the water.
   */
  function layCemetery(f) {
    const r = streamFor(f.id);
    const c = fillCemetery({ area: f, r, roads: [...ways, ...lanes.filter((l) => l.from === f.id), ...streets], ftPerSquare: sq });
    // What's there already keeps its place: roads, water of any kind, buildings, props and trees (the plan's and
    // the generator's), each by its own size; the cemetery's paths are cut at water, its graves, yews, tombs, chapel,
    // wall and hedge left out where they'd stand on any of it
    // (only buildings, props and trees standing in it count, so nothing a neighbor places by its edge, and no reroll
    // of a neighbor, changes it)
    const outline = shapeToPolygon(f.shape, f.rot ?? 0);
    const here = (x) => x.from !== f.id;
    const foots = items.filter((i) => i.kind === "building" && here(i)).map((b) => footOf(b)).filter((ft) => ft.some((q) => pointInPolygon(q, outline)) || outline.some((q) => pointInPolygon(q, ft)));
    const things = items.filter((i) => (i.kind === "prop" || i.kind === "tree") && here(i) && pointInPolygon([i.x, i.y], outline)).map((q) => ({ x: q.x, y: q.y, r: q.kind === "tree" ? 0.5 : ((PROP_SQUARES[q.class] ?? 0.45) * (q.scale ?? 1)) / 2 }));
    const allWays = [...ways, ...streets, ...lanes.filter((l) => l.from !== f.id)];
    const wet = (x, y, extra = 0) => space.water.some((w) => nearWater([x, y], w, extra));
    const crossed = (x, y, m) => wet(x, y, m) || allWays.some((w) => distanceToPath([x, y], w.path) < w.width / 2 + m);
    const taken = (x, y, m) => crossed(x, y, m)
      || foots.some((ft) => pointInPolygon([x, y], ft) || distanceToPath([x, y], closed(ft)) < m) || things.some((q) => Math.hypot(q.x - x, q.y - y) < q.r + m);
    c.surface.paths = c.surface.paths.flatMap((w) => dryPieces(w.path, (q) => wet(q[0], q[1], w.width / 2)).map((path) => ({ ...w, path }))).filter((w) => w.path.length >= 2);
    items.push({ kind: "surface", id: f.id, from: f.id, class: "park", poly: c.surface.poly, style: "cemetery", paths: c.surface.paths, basin: null });
    c.buildings.forEach(({ key, spec }) => {
      const [x0, y0, x1, y1] = spec.shape.rect, foot = shapeToPolygon(spec.shape, spec.rot ?? 0);
      if (![[(x0 + x1) / 2, (y0 + y1) / 2], ...foot].some(([x, y]) => taken(x, y, 0.2))) addBuilding(spec, `${f.id}/${key}`, r.fork(key), f.id);
    });
    c.trees.forEach((t, k) => { if (!taken(t.x, t.y, 0.3)) items.push({ kind: "tree", id: `${f.id}/t${k + 1}`, from: f.id, x: t.x, y: t.y, species: "conifer", size: "medium", s: t.s, rot: t.rot, variant: t.variant }); });
    c.graves.forEach((g, k) => { if (!taken(g.x, g.y, 0.2)) items.push({ kind: "prop", id: `${f.id}/grave${k + 1}`, from: f.id, class: "grave", x: g.x, y: g.y, rot: g.rot, variant: g.variant, scale: 7 / sq / 0.45 }); });
    // (a wall or hedge broken only where a road or water crosses its line)
    const pieces = (path) => { const out = []; let cur = []; for (const q of path) { if (crossed(q[0], q[1], 0.3)) { if (cur.length > 1) out.push(cur); cur = []; } else cur.push(q); } if (cur.length > 1) out.push(cur); return out; };
    c.walls.flatMap(pieces).forEach((path, k) => items.push({ kind: "wall", id: `${f.id}/w${k + 1}`, from: f.id, class: "drystone", path, height: 4 / sq }));
    c.hedges.flatMap(pieces).forEach((path, k) => {
      const before = items.length;
      items.push({ kind: "boundary", id: `${f.id}/h${k + 1}`, from: f.id, class: "hedge", path });
      hedgeBushes({ wall: { id: `${f.id}/h${k + 1}`, from: f.id, path }, r: r.fork("hedge", k), items, step: 0.4, scale: [0.5, 0.2] });
      dropWet(before);
    });
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
        // A house by the lane's end: a track (wider than a lane) would clip it
        const trackHalf = 10 / sq / 2 + 0.02;
        if (items.some((b) => b.kind === "building" && b.from === d.id && Math.abs(b.cx - p[0]) < Math.max(b.len, b.dep) + 1 && Math.abs(b.cy - p[1]) < Math.max(b.len, b.dep) + 1 && (pointInPolygon(p, footOf(b)) || distanceToPath(p, closed(footOf(b))) < trackHalf))) continue;
        const path = [p];
        let at = p, joined = false;
        for (let k = 0; k < want; k++) {
          dir += (wobble * Math.PI) / 180 / 3;
          const next = [at[0] + Math.cos(dir), at[1] + Math.sin(dir)];
          if (next[0] < 0.5 || next[1] < 0.5 || next[0] > W - 0.5 || next[1] > H - 0.5) break;
          if (space.water.some((w) => nearWater(next, w, 0.3))) break;
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
    const before = items.length;
    hedgeBushes({ wall: f, r: streamFor(f.id), items });
    dropWet(before);
  }

  // A tree laid before another feature's street (a green's, or one district's wild tree by the next one's lane) is
  // dropped where that street runs over it, as a house crowding a wood removes the trees it stands on
  // (and a hedge's bushes where a farm's or a park's lane goes through it)
  const hard = items.filter((i) => i.kind === "way" && (!i.faint || lanes.includes(i))).map((w) => { const [x0, y0, x1, y1] = bbox(w.path), m = w.width / 2 + 0.05; return { w, m, box: [x0 - m, y0 - m, x1 + m, y1 + m] }; });
  for (let k = items.length - 1; k >= 0; k--) {
    const t = items[k];
    if ((t.kind === "tree" || (t.kind === "prop" && t.class === "bush")) && t.id !== t.from && hard.some(({ w, m, box }) => w.from !== t.from && t.x > box[0] && t.x < box[2] && t.y > box[1] && t.y < box[3] && distanceToPath([t.x, t.y], w.path) < m)) items.splice(k, 1);
  }

  // A grave under a tree the plan or another feature put in a temple's yard
  const yardTrees = items.filter((t) => t.kind === "tree");
  for (let k = items.length - 1; k >= 0; k--) {
    const g = items[k];
    if (g.kind === "prop" && g.class === "grave" && /\/grave\d+-/.test(g.id) && yardTrees.some((t) => t.from !== g.from && Math.abs(t.x - g.x) < 0.8 && Math.abs(t.y - g.y) < 0.8)) items.splice(k, 1);
  }

  // A yard's or a centerpiece's wall where another district's street comes by (one bending to its gate can cut a
  // corner over the border): a gap there
  for (let k = items.length - 1; k >= 0; k--) {
    const v = items[k];
    if (v.kind !== "wall" || !/\/(v|anchor-v)\d+$/.test(v.id)) continue;
    const [x0, y0, x1, y1] = bbox(v.path);
    const near = hard.filter(({ w, box }) => w.from !== v.from && box[0] < x1 && box[2] > x0 && box[1] < y1 && box[3] > y0);
    if (!near.length) continue;
    const runs = cutWhere(v.path, (pt) => near.some(({ w, m }) => distanceToPath(pt, w.path) < m));
    if (runs.length === 1 && runs[0] === v.path) continue;
    items.splice(k, 1, ...runs.map((path, n) => ({ ...v, id: n ? `${v.id}-${n + 1}` : v.id, path })));
  }

  // A boat on the water where a district's street later bridged the river is taken out again
  {
    const spans = items.filter((i) => i.kind === "crossing").map((c) => ({ at: c.at, r: (c.length ?? 1) / 2 + 0.6 }));
    for (let k = items.length - 1; k >= 0; k--) {
      const b = items[k];
      if (b.kind === "prop" && (b.class === "boat" || b.class === "ship") && b.from === "plan" && spans.some((c) => Math.hypot(c.at[0] - b.x, c.at[1] - b.y) < c.r)) items.splice(k, 1);
    }
  }

  // Each ford's stepping stones (and rocks, frozen), once every way is laid
  const allWays = items.filter((i) => i.kind === "way");
  for (const c of items) if (c.kind === "crossing" && c.class === "ford") Object.assign(c, fordDetail(c, allWays));

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

/**
 * A path in pieces, leaving out where hit(point) is true (tested every 0.05 squares); the same path when nothing
 * is hit. Pieces shorter than 0.1 go.
 */
function cutWhere(path, hit) {
  const pts = [];
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.05));
    for (let j = i === 1 ? 0 : 1; j <= n; j++) {
      const p = [ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n];
      pts.push({ p, vertex: j === 0 || j === n, off: hit(p) });
    }
  }
  if (!pts.some((q) => q.off)) return [path];
  const out = [];
  let cur = null;
  for (let k = 0; k < pts.length; k++) {
    const q = pts[k];
    if (q.off) { cur = null; continue; }
    // A piece keeps its corners and its two ends
    const end = !cur || k === pts.length - 1 || pts[k + 1].off;
    if (!cur) { cur = [q.p]; out.push(cur); } else if (q.vertex || end) cur.push(q.p);
  }
  const len = (p) => p.reduce((s, q, i) => s + (i ? Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);
  return out.filter((p) => p.length >= 2 && len(p) >= 0.1);
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
 * The plan with every district's and area's corners given the same way around (the way a rect's run), so an outline
 * saved the other way around lays out the same.
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

/**
 * The plan with its water worked out once, for everything that reads it (the fields and the walls too): each pond's,
 * lake's and sea's outline (_poly, and _ring closed on its first point), shore (_shore) and how far things keep from
 * its edge (_keep), and the width at each point (_w, in squares)
 * of a stream or river that varies in width or opens out into a lake or the sea. given: the plan as it came, its
 * paths as drawn (smoothed, the layout's are longer). Features are in the same order in both.
 */
function withWater(plan, given) {
  const sq = plan.size.ftPerSquare, [W, H] = plan.size.squares;
  if (!plan.features.some((f) => f.type === "water")) return plan;
  const bodies = [];
  let features = plan.features.map((f) => {
    if (!isBody(f)) return f;
    const b = bodyOf(f, { W, H, seed: plan.seed });
    if (!b) return f;
    bodies.push(b);
    return { ...f, _poly: b.poly, _ring: b.ring, _shore: shoreOf(f, rng(seedOf(plan, f.id), f.id).fork("shore")), _keep: keepOf(f) }; // the shore as streamFor(id) draws it
  });
  features = features.map((f, i) => {
    if (!isRunning(f) || f.path.length < 2) return f;
    const w = widthsOf(f, given.features[i]?.path, sq);
    const width = Number.isFinite(f.width) ? f.width / sq : null;
    const mouth = w || width > 0 ? mouthWidths(f.path, w, width, bodies) : null;
    const ws = mouth ?? w;
    return ws ? { ...f, _w: ws } : f;
  });
  return { ...plan, features };
}

/**
 * The pieces of a path that keep out of somewhere (wet(point) is true there), each a square long or more: the path
 * walked in steps of a tenth of a square, keeping its own points and the last dry step before each cut. The path
 * itself when it's dry all along.
 */
function dryPieces(path, wet) {
  const pieces = [];
  let cur = [], last = null, cut = false;
  const end = () => { if (last && cur.length && cur.at(-1) !== last) cur.push(last); if (cur.length >= 2) pieces.push(cur); cur = []; last = null; };
  const visit = (q, own) => {
    if (wet(q)) { cut = true; end(); return; }
    if (own || !cur.length) cur.push(q);
    last = q;
  };
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1));
    for (let t = 0; t < n; t++) visit(t ? [a[0] + ((b[0] - a[0]) * t) / n, a[1] + ((b[1] - a[1]) * t) / n] : a, t === 0);
  }
  if (path.length) visit(path.at(-1), true);
  end();
  if (!cut) return [path];
  const len = (p) => p.reduce((sum, q, k) => (k ? sum + Math.hypot(q[0] - p[k - 1][0], q[1] - p[k - 1][1]) : 0), 0);
  return pieces.filter((p) => len(p) >= 1);
}
