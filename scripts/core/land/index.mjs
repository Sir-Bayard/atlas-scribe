/**
 * Generated land for overland maps: the stage runner. A region plan with a `land` block becomes a Land: the graph,
 * heights, water, climate, biomes and the feature inventory, all in miles over the context frame. Stages run in
 * order (shape, uplift, heights, water, climate, biomes, inventory) and each can be entered with data from outside
 * (a kept land at the heights stage; later a height map import or a zoomed parent). Same plan and generator version,
 * same land, bit for bit, in every engine. Pure: runs in the worker and under node.
 */
import { frameOf, latitudeOf, scaleClass } from "./units.mjs";
import { shapeField } from "./recipes.mjs";
import { GEN, normalizeLand } from "./schema.mjs";
import { makePoints, makeGraph, nodeGrid } from "./graph.mjs";
import { distanceTo, atNodes } from "./field.mjs";
import { upliftStage, SOLVER, components } from "./uplift.mjs";
import { workFor, fillRoute, accumulate, step } from "./solver.mjs";
import { climateStage } from "./climate.mjs";
import { remapHeights } from "./hypso.mjs";
import { valleyFloors, lakesStage, riversStage, riverMarks, forcedNodes, holdForced, RIVER_CATCHMENT } from "./water.mjs";
import { biomeOf, BIOME_CLIMATE } from "./biome.mjs";
import { rng, hashAt, hash128 } from "../rng.mjs";
import { inventoryOf } from "./inventory.mjs";
import { intentAtNodes } from "./layers.mjs";
import { sample } from "./field.mjs";
import { landProblems } from "./quality.mjs";

/** How many times a land that fails its checks is made again (from sub-seeds) before the best is kept. */
export const TRIES = 4;

/**
 * Generates the land of a plan (normalized or raw), checking it and trying again from sub-seeds when it fails, the
 * best kept. opts: { onProgress, nodes (the full node budget, 45,000), maxLevel (2: all points; 1 for a preview),
 * tries }. Returns the Land, with inventory, problems and attempt.
 */
export function generateLand(plan, opts = {}) {
  let best = null;
  const tries = Math.max(1, opts.tries ?? TRIES);
  for (let attempt = 0; attempt < tries; attempt++) {
    const L = generateOnce(plan, { ...opts, attempt, onProgress: (p, l) => opts.onProgress?.((attempt + p) / tries < 1 ? (attempt === 0 ? p : 0.9 + 0.1 * p) : p, attempt ? `${l} (try ${attempt + 1})` : l) });
    L.inventory = inventoryOf(L);
    L.problems = landProblems(L, L.inventory);
    if (!best || L.problems.length < best.problems.length) best = L;
    if (!L.problems.length) break;
  }
  return best;
}

/**
 * One land, no checks (attempt picks the sub-seed). opts.intent: the plan's painted intent (readIntent's result,
 * read beforehand since PNG decoding is async). opts.kept: a kept land entering at the heights stage: { heights (a
 * field of heights over the frame) }; with no lock layer every land node is held (the solver is skipped), with one
 * only the locked nodes are.
 */
export function generateOnce(plan, opts = {}) {
  const progress = (p, l) => opts.onProgress?.(p, l);
  const land = normalizeLand(plan.land);
  const seed = seedOf(Number.isFinite(land.seed) ? land.seed : plan.seed);
  const attempt = opts.attempt ?? 0;
  const r = rng(seed, "land", attempt);
  const frame = frameOf(plan);
  const lat = latitudeOf({ ...plan, land }, frame);
  const mountains = land.mountains;
  const subSeed = attempt ? seed * 1000003 + attempt : seed;

  progress(0.02, "Land and sea");
  const shapeF = shapeField(frame, land, subSeed, r.fork("recipe"));

  // the graph: every point near land and inside the map, one in four far out at sea and in the margin
  progress(0.08, "Points");
  const seaDist = distanceTo(shapeF, (i) => shapeF.data[i] > 0);
  const pad = 0.03 * Math.max(frame.mapW, frame.mapH);
  const full = (x, y) => x > frame.margin - pad && y > frame.margin - pad && x < frame.margin + frame.mapW + pad && y < frame.margin + frame.mapH + pad && sampleLike(seaDist, x, y) < 60;
  let aFull = 0, aRest = 0;
  for (let y = 0; y < shapeF.h; y++) for (let x = 0; x < shapeF.w; x++) { if (full((x + 0.5) * shapeF.cell, (y + 0.5) * shapeF.cell)) aFull++; else aRest++; }
  const px2 = shapeF.cell * shapeF.cell;
  const budget = opts.nodes ?? 45000;
  const spacing = Math.sqrt((aFull * px2 + (aRest * px2) / 4) / budget);
  const pts = makePoints({ width: frame.W, height: frame.H, spacing, seed: subSeed, maxLevel: opts.maxLevel ?? 2, keep: (x, y, lv) => lv === 0 || full(x, y) });
  const g = makeGraph(pts);
  const grid = nodeGrid(g);
  const intent = intentAtNodes(opts.intent ?? null, g);

  // painted terrain from the plan (units to frame miles)
  // (a raw plan may carry a broken point or path: the checker reports it; here it is left out)
  const terrain = (plan.features ?? []).filter((f) => f && f.type === "terrain").map((f) => ({
    ...f,
    path: isPath(f.path) ? f.path.map((p) => frame.toFrame(p)) : null,
    at: isPoint(f.at) ? frame.toFrame(f.at) : null,
  }));
  progress(0.15, "Plates and ranges");
  const up = upliftStage({ g, frame, land, seed: subSeed, r: r.fork("uplift"), shapeF, terrain, intent });
  const { U, Uold, K, D, talus, landMask, outlet, fixedH } = up;
  const n = g.n;

  // heights: uplift against erosion; rain from the wind from 45% of the run on
  progress(0.25, "Mountains and valleys");
  const h = new Float64Array(n);
  for (let i = 0; i < n; i++) h[i] = outlet[i] ? fixedH[i] : 0.01 + 0.006 * hashAt(i, 3, subSeed);
  // a kept land: its heights held (all of it, or only where locked)
  let fixed = null, allKept = false;
  if (opts.kept?.heights) {
    fixed = new Uint8Array(n);
    allKept = !intent?.lock;
    for (let i = 0; i < n; i++) if (landMask[i] && !outlet[i] && (allKept || intent.lock[i])) { fixed[i] = 1; h[i] = Math.max(0.0015, sample(opts.kept.heights, g.x[i], g.y[i])); }
  }
  // climate as the painted intent asks: wetter, warmer, and zones whose world reacts
  const zoneTargets = [];
  if (intent?.zone) for (const z of intent.zones ?? []) {
    if (!z.reacts || !BIOME_CLIMATE[z.biome]) continue;
    const nodes = Uint8Array.from(intent.zone, (v) => (v === z.index ? 1 : 0));
    zoneTargets.push({ nodes, rain: BIOME_CLIMATE[z.biome].rain, temp: BIOME_CLIMATE[z.biome].temp });
  }
  const climateIntent = intent && (intent.wet || intent.warm) ? { wet: intent.wet ?? null, warm: intent.warm ?? null } : null;
  const forced = (plan.features ?? []).filter((f) => f && f.type === "water" && f.class === "river" && isPath(f.path))
    .map((f) => forcedNodes(f.path.map((p) => frame.toFrame(p)), grid.nearest, up.spacing));
  const w = workFor(g);
  const steps = SOLVER.steps[up.age];
  const Ueff = new Float64Array(n);
  let weight = Float64Array.from(g.area), rainNow = null;
  let meanArea = 0; for (let i = 0; i < n; i++) meanArea += g.area[i]; meanArea /= n;
  const p = { U: Ueff, K, dt: SOLVER.dt, fill: 0.008, smallArea: Math.max(15, 3 * meanArea), D, passes: 2, talus, outlet, fixed };
  for (let s = 0; s < (allKept ? 0 : steps); s++) {
    if (s === Math.floor(steps * 0.45)) {
      const c = climateStage({ g, frame, h, landMask, lat, land, seaSide: shapeF.seaSide, grid, intent: climateIntent, zones: zoneTargets });
      rainNow = c.rain;
      let sum = 0, cnt = 0;
      for (let i = 0; i < n; i++) if (landMask[i]) { sum += rainNow[i]; cnt++; }
      const mean = sum / Math.max(1, cnt) || 1;
      weight = new Float64Array(n);
      for (let i = 0; i < n; i++) weight[i] = (rainNow[i] / mean) * g.area[i];
      progress(0.25 + 0.4 * (s / steps), "Rain from the wind");
    }
    const old = s < steps * 0.5;
    for (let i = 0; i < n; i++) Ueff[i] = U[i] + (old ? Uold[i] : 0);
    const np = fillRoute(g, h, outlet, w);
    accumulate(w, weight, np);
    step(g, h, w, p, np);
    for (const fn of forced) holdForced(g, h, fn, fixed, outlet);
    if (s % 40 === 0) progress(0.25 + 0.45 * (s / steps), "Mountains and valleys");
  }

  // height distribution, valley floors, then the water on the finished land
  progress(0.72, "Lowlands and hills");
  const hypso = allKept ? null : remapHeights(h, landMask, fixed, mountains);
  let np = fillRoute(g, h, outlet, w);
  const cl1 = climateStage({ g, frame, h, landMask, lat, land, seaSide: shapeF.seaSide, grid, intent: climateIntent, zones: zoneTargets });
  const rainW = new Float64Array(n);
  for (let i = 0; i < n; i++) rainW[i] = cl1.rain[i] * g.area[i];
  accumulate(w, rainW, np);
  const scale = frame.scale;
  const mult = { few: 2, some: 1, many: 0.5 }[land.rivers] ?? 1;
  // (a map's land smaller than a quarter of the map, an archipelago or an arc on a continent, draws smaller rivers,
  // down to a tenth of the scale's catchment, so its islands aren't bare: a map always shows its main rivers)
  const inMap = (i) => landMask[i] && frame.inMap(g.x[i], g.y[i]);
  const biggest = Math.max(0, ...components(g, inMap).areas);
  const fit = Math.min(1, Math.max(0.1, biggest / (0.25 * frame.mapW * frame.mapH)));
  const threshold = RIVER_CATCHMENT[scale] * mult * fit;
  if (!allKept) valleyFloors(g, h, w, threshold * 1.5, landMask, fixed);
  for (const fn of forced) holdForced(g, h, fn, fixed, outlet);
  np = fillRoute(g, h, outlet, w);
  progress(0.8, "Rain and rivers");
  const climate = climateStage({ g, frame, h, landMask, lat, land, seaSide: shapeF.seaSide, grid, intent: climateIntent, zones: zoneTargets });
  const pxPerMile = (Number(plan.output?.pxPerSquare) || 100) / frame.mpu;
  const lk = lakesStage({ g, h, w, np, rain: climate.rain, temp: climate.temp, land: landMask, outlet, pxPerMile });
  // (a flooded hollow too small to show as a lake is filled flat, as sediment would: rivers then never step uphill)
  for (let i = 0; i < n; i++) if (landMask[i] && !lk.lake[i] && !lk.salt[i] && lk.depth[i] > 0) h[i] = w.hf[i];
  const rv = riversStage({ g, h, w, F: lk.F, land: landMask, lake: lk.lake, outlet, threshold, forced });
  const marks = riverMarks(rv.rivers, up.hard);

  // biomes; wetland where flat, low ground carries a lot of water
  progress(0.9, "Biomes");
  const biome = new Array(n);
  for (let i = 0; i < n; i++) {
    if (!landMask[i]) { biome[i] = "sea"; continue; }
    if (lk.lake[i]) { biome[i] = "lake"; continue; }
    const slope = w.rec[i] !== i ? (h[i] - h[w.rec[i]]) / w.rd[i] : 0;
    const wet = h[i] < 0.03 && slope < 0.0004 && lk.F[i] > threshold * 0.6 && climate.rain[i] > 0.7;
    biome[i] = biomeOf(climate.temp[i], h[i], climate.rain[i], wet, lk.salt[i] === 1);
    // a painted zone's biome, whatever the climate made (its own name for a custom one)
    if (intent?.zone?.[i]) { const z = intent.zones.find((q) => q.index === intent.zone[i]); if (z) biome[i] = BIOME_CLIMATE[z.biome] ? z.biome : `custom:${z.id ?? z.index}`; }
  }
  progress(1, "Done");
  return {
    gen: GEN, attempt, seed, frame, land, g, grid, shapeF, h, hf: Float64Array.from(w.hf), rec: Int32Array.from(w.rec),
    landMask, outlet, U, hard: up.hard, spines: up.spines, plates: up.plates, distSea: up.distSea,
    rain: climate.rain, temp: climate.temp, rainF: climate.rainF, tempF: climate.tempF,
    F: lk.F, lake: lk.lake, salt: lk.salt, lakes: lk.lakes, lakeId: lk.lakeId, rivers: rv.rivers, riverOf: rv.riverOf, marks,
    biome, hypso, threshold, spacing: up.spacing, fixed, kept: !!opts.kept, zones: intent?.zones ?? [],
  };
}

/** A plan's seed as a number: a word (check allows one) by its hash, so "alpha" and "beta" differ. */
const isPoint = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const isPath = (a) => Array.isArray(a) && a.length >= 2 && a.every(isPoint);
function seedOf(s) {
  if (Number.isFinite(s)) return s;
  if (typeof s === "string" && s) return hash128(s)[0] % 1000000;
  return 1;
}

/** A field's value at (x, y), as field.sample (kept local so the hot loop above stays small). */
function sampleLike(f, x, y) {
  const fx = Math.min(f.w - 1, Math.max(0, Math.floor(x / f.cell))), fy = Math.min(f.h - 1, Math.max(0, Math.floor(y / f.cell)));
  return f.data[fy * f.w + fx];
}

export { BIOME_CLIMATE, scaleClass, atNodes, GEN, normalizeLand };
