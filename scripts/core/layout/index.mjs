/**
 * Plan to Layout: everything the generator works out from a plan, as plain items in squares. Fixed features become
 * items as they are; districts and areas are filled, each from its own random stream (the plan seed or its own seed,
 * and its id), drawing the same number of times whatever fits, so reseeding one moves only what it places. Every
 * random choice is made here, never in the painter, so a plan always paints the same map. Pure: worker and node.
 */
import { ROOF_STYLES, normalize, okChimney } from "../plan.mjs";
import { rng } from "../rng.mjs";
import { bbox, pointInPolygon, distanceToPath, spansAt } from "../geom.mjs";
import { seedOf } from "../seeds.mjs";
import { DISTRICT_TYPES } from "../streets/index.mjs";
import { lotTypeOf } from "../lots/index.mjs";
import { offset, area } from "../lots/poly.mjs";
import { LOOK, characterOf } from "../character.mjs";
import { isBody, isRunning, bodyOf, widthsOf, mouthWidths, shoreOf, keepOf, wander } from "../water.mjs";
import { layoutRegion } from "./region.mjs";
import { readPlan, fixedFeatures, battleHeights, millsAndPlacing, spaceGrids, quays, townWalls, squares, boatsAndCranes, parksAndFarms, fillDistricts, fieldSystems, countryLanes, fillParks, wildTracks, woodsAndRocks, tidyUp, finishLayout, underground, riverbeds } from "./phases/index.mjs";

export const LAYOUT_VERSION = 9;


/** A building's chimney: the one drawn, unless it's pinned where it stood ({ u, v, variant }). */
export const chimneyOf = (b, drawn) => (drawn && okChimney(b.chimneyAt) ? { u: b.chimneyAt.u, v: b.chimneyAt.v, variant: b.chimneyAt.variant } : drawn);
/** How tall a building is: an ordinary house is 20 ft; each 20 ft above that is one step of "tall" (longer shadows). */
export const tallOf = (heightFt) => Math.max(0, (Number(heightFt) - 20) / 20);

/**
 * A row house's chimney ({ u, v, variant }, shares of its box from its middle): on its ridge, near one end (the far
 * end when far), so it stands on the roof whatever the footprint's shape.
 */
export function ridgeChimney(poly, cx, cy, len, rot, far, variant) {
  const a = (rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const local = poly.map(([x, y]) => [(x - cx) * c + (y - cy) * s, -(x - cx) * s + (y - cy) * c]);
  const [x0, x1] = spansAt(local, 0).reduce((b, sp) => (!b || sp[1] - sp[0] > b[1] - b[0] ? sp : b), null) ?? [-len / 2, len / 2];
  const mid = (x0 + x1) / 2, x = mid + (far ? -1 : 1) * 0.32 * (x1 - x0);
  return { u: len > 0 ? x / len : 0, v: 0, variant };
}

/** How far along a ray (from, unit dir) it meets the segment a-b, or null. */
export function rayHit([ox, oy], [dx, dy], [ax, ay], [bx, by]) {
  const ex = bx - ax, ey = by - ay, den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((ax - ox) * ey - (ay - oy) * ex) / den, u = ((ax - ox) * dy - (ay - oy) * dx) / den;
  return u >= 0 && u <= 1 ? t : null;
}

/** Points every step squares along a path, each with the path's direction there: [[point, [dx, dy]]]. */
export function stepsAlong(path, step) {
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
export const ownStyles = (d) => (Array.isArray(d.roofStyles) ? d.roofStyles.filter((s) => ROOF_STYLES.includes(s)) : []);

/** A roof for a quarter's back building: one of its character's own materials, else the district's own palette. */
export function pickRoof(d, r, palette = null) {
  const roofs = (Array.isArray(d.roofs) && d.roofs.length ? Object.fromEntries(d.roofs.map((x) => [x, 1])) : LOOK[characterOf(d)]?.roofs ?? palette ?? lotTypeOf(d).roofs) ?? { slate: 1 };
  const keys = Object.keys(roofs), total = keys.reduce((a, k) => a + roofs[k], 0);
  let x = r.next() * total;
  for (const k of keys) if ((x -= roofs[k]) < 0) return k;
  return keys[keys.length - 1];
}

/** The widest street and lane any district type makes, in feet: what a neighbor's street at a gate can be. */
export const GATE_WIDTH = {
  street: Math.max(...Object.values(DISTRICT_TYPES).map((t) => t.streets?.width ?? 0)),
  lane: Math.max(...Object.values(DISTRICT_TYPES).map((t) => t.lanes?.width ?? t.streets?.width ?? 0)),
};

/**
 * What each district made, kept so a district whose inputs haven't changed isn't laid out again. Keyed by a hash of
 * everything its fill reads: its settings and seed, the plan's seed and size, all water and radial squares, its gates
 * and shared edges, the roads in or beside it, and what was placed before the districts within KEY_MARGIN squares.
 * Holds the districts used last, up to DISTRICT_CACHE_BYTES of their JSON in all, per worker, never saved.
 */
export const DISTRICT_CACHE_BYTES = 12 * 1024 * 1024;
export const KEY_MARGIN = 4;
export const districtCache = new Map(); // key -> { rec, bytes }
export const cacheUse = { bytes: 0 }; // the bytes the district cache holds
export const cacheStats = { hits: 0, misses: 0 };

/** Empties the cache of districts' layouts (for tests). */
export function clearLayoutCache() {
  districtCache.clear();
  cacheUse.bytes = 0;
  cacheStats.hits = cacheStats.misses = 0;
}

/** How often a district came from the cache since it was last cleared: { hits, misses } (for tests). */
export const layoutCacheStats = () => ({ ...cacheStats });

/** JSON for a cache key: NaN and Infinity written as themselves, so they never share a key with null. */
export const keyJSON = (v) => JSON.stringify(v, (k, x) => (typeof x === "number" && !Number.isFinite(x) ? `#${x}` : x));

/** The box around every point in a value (a polygon, a path entry, a building item), or null if it has none. */
export function boxOf(v) {
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
 * Streets cut where they'd run into a building: split there, pieces under a square dropped, and pieces cut at both
 * ends shorter than STUB feet that no other street meets. Cut ends are marked (wallEnds: [start, end]) so a battle
 * map draws them on to the wall. A street that only touches a building's wall is left whole.
 */
const STUB = 40;
export function trimAtBuildings(streets, feet, ftPerSquare = 5) {
  if (!feet.length) return streets;
  const walls = feet.map((p) => ({ p, ring: closed(p), box: bbox(p) }));
  const out = [];
  for (const st of streets) {
    const m = st.width / 2 - 0.015; // into the wall by more than a hair
    const inside = (q) => walls.some(({ p, ring, box }) => q[0] > box[0] - m && q[0] < box[2] + m && q[1] > box[1] - m && q[1] < box[3] + m && (pointInPolygon(q, p) || distanceToPath(q, ring) < m));
    if (!st.path.some((q, k) => k && walls.some(({ box }) => Math.max(q[0], st.path[k - 1][0]) > box[0] - m && Math.min(q[0], st.path[k - 1][0]) < box[2] + m && Math.max(q[1], st.path[k - 1][1]) > box[1] - m && Math.min(q[1], st.path[k - 1][1]) < box[3] + m))) { out.push(st); continue; }
    // Walk the path in steps of a tenth of a square, keeping its own points and the last point before each cut
    const pieces = [];
    let cur = [], last = null, cut = false, cutBefore = false;
    const end = (atCut) => { if (cur.length) { if (last && last !== cur.at(-1)) cur.push(last); cur.cutStart = cutBefore; cur.cutEnd = atCut; pieces.push(cur); } cur = []; last = null; };
    const visit = (q, own) => {
      if (inside(q)) { cut = true; end(true); cutBefore = true; return; }
      if (own || !cur.length) cur.push(q);
      last = q;
    };
    for (let k = 0; k < st.path.length - 1; k++) {
      const a = st.path[k], b = st.path[k + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1));
      for (let t = 0; t < n; t++) visit(t ? [a[0] + ((b[0] - a[0]) * t) / n, a[1] + ((b[1] - a[1]) * t) / n] : a, t === 0);
    }
    visit(st.path.at(-1), true);
    end(false);
    if (!cut) { out.push(st); continue; }
    const len = (pts) => pts.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0), 0);
    for (const pc of pieces) {
      const pts = pc.map((q) => [q[0], q[1]]);
      const met = () => streets.some((o) => o !== st && [o.path[0], o.path.at(-1)].some((e) => distanceToPath(e, pts) < st.width / 2 + 0.3));
      if (pts.length < 2 || len(pts) < 1 || (pc.cutStart && pc.cutEnd && len(pts) < STUB / ftPerSquare && !met())) continue;
      out.push({ ...st, path: pts, ...(pc.cutStart || pc.cutEnd ? { wallEnds: [!!pc.cutStart, !!pc.cutEnd] } : {}) });
    }
  }
  return out;
}

/**
 * A battle map's bridge parapet and footbridge rail, in squares out from the deck's edge to their middle line (a
 * parapet half its painted thickness out, so its inner face is the deck's edge); a stone bridge's wing walls run wing
 * squares on from each parapet's end, turned wingTurn degrees out.
 */
export const PARAPET = { out: 0.24, rail: 0.07, wing: 1.6, wingTurn: 35 };

export function layoutPlan(rawPlan, { onProgress = null, cache = true } = {}) {
  // (a region map has its own: places as markers, at a scale of miles)
  if (rawPlan?.kind === "region") return layoutRegion(normalize(rawPlan), { onProgress });
  const ctx = { rawPlan, onProgress, cache };
  readPlan(ctx);
  fixedFeatures(ctx);
  battleHeights(ctx);
  underground(ctx);
  millsAndPlacing(ctx);
  spaceGrids(ctx);
  quays(ctx);
  townWalls(ctx);
  squares(ctx);
  boatsAndCranes(ctx);
  parksAndFarms(ctx);
  fillDistricts(ctx);
  fieldSystems(ctx);
  countryLanes(ctx);
  fillParks(ctx);
  wildTracks(ctx);
  woodsAndRocks(ctx);
  riverbeds(ctx);
  tidyUp(ctx);
  return finishLayout(ctx);
}

/**
 * A path in pieces, leaving out where hit(point) is true (tested every 0.05 squares); the same path when nothing
 * is hit. Pieces shorter than 0.1 go.
 */
export function cutWhere(path, hit) {
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

/** A footprint grown by d all around, square at its corners: the room a building keeps about it. */
export function apartBy(poly, d) {
  return offset([poly], d).reduce((a, b) => (!a || area(b) > area(a) ? b : a), null) ?? poly;
}

/** A polygon pushed out from its center by a margin (rough, for keeping clear; fine for convex shapes). */
export function grow(poly, by) {
  if (!by) return poly;
  const [x0, y0, x1, y1] = bbox(poly);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return poly.map(([x, y]) => {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1;
    return [x + (dx / d) * by, y + (dy / d) * by];
  });
}

export const closed = (poly) => [...poly, poly[0]];

/**
 * The plan with every district's and area's corners given the same way around (the way a rect's run), so an outline
 * saved the other way around lays out the same.
 */
export function windAlike(plan) {
  const signed = (p) => p.reduce((s, [x1, y1], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + x1 * y2 - x2 * y1; }, 0);
  // (a corner that isn't a point is left out, as shapeToPolygon leaves it out)
  const good = (shape) => shape.filter((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1]));
  const turn = (f) => (f.type === "district" || f.type === "area") && Array.isArray(f.shape) && good(f.shape).length >= 3 && signed(good(f.shape)) < 0;
  return plan.features.some(turn) ? { ...plan, features: plan.features.map((f) => (turn(f) ? { ...f, shape: [...f.shape].reverse() } : f)) } : plan;
}

/** A polygon pulled in toward its center by a fraction, so shapes that only touch don't count as overlapping. */
export function shrink(poly, by) {
  const [x0, y0, x1, y1] = bbox(poly);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return poly.map(([x, y]) => [x + (cx - x) * by, y + (cy - y) * by]);
}

/**
 * The plan with its water worked out once for everything that reads it: each pond's, lake's and sea's outline (_poly,
 * _ring), shore (_shore) and keep distance (_keep), and the width at each point (_w, squares) of a stream or river
 * that varies or opens into a lake or the sea. given: the plan as it came, its paths as drawn; features in the same
 * order.
 */
export function withWater(plan, given) {
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
    // (a stream or river on a battle map wanders a little, its width too, kept straight near its crossings; a canal
    // or one drawn straight keeps its line)
    if (plan.kind === "battle" && !f.straight && f.class !== "canal" && !mouth) {
      const near = plan.features.filter((c) => c.type === "crossing" && Array.isArray(c.at)).map((c) => [c.at[0], c.at[1], (Number.isFinite(c.length) ? c.length / sq : 2) / 2]);
      const wd = wander(f.path, ws, width ?? 1, { seed: seedOf(plan, f.id), id: f.id, near });
      if (wd) return { ...f, path: wd.path, _w: wd.widths };
    }
    return ws ? { ...f, _w: ws } : f;
  });
  return { ...plan, features };
}

/**
 * The pieces of a path that keep out of somewhere (wet(point) true there), each a square long or more; the path
 * itself when it's dry all along.
 */
export function dryPieces(path, wet) {
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
