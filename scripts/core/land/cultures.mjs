/**
 * Cultures on an overland map: peoples grown from the oldest good sites (low, fertile ground by coasts and rivers)
 * over the land, stopped by ranges, deserts and seas, each naming the places and realms on its land in its own way (in
 * the map's Names style, with a tongue of its own on invented maps). A culture is kept in the plan as a point feature
 * (its hearth) with a name, the seed of its tongue and, when the GM gives it one, a name set; its land is grown again
 * from the hearths at every layout. Pure.
 */
import { Heap } from "./heap.mjs";
import { len, log } from "./dmath.mjs";
import { rng, hashAt } from "../rng.mjs";
import { namer } from "./names.mjs";
import { parseNameSet } from "./namesets.mjs";
import { nodeAreas, nearestOf } from "./realms.mjs";
import { madeMark, untouched } from "./places.mjs";
import { BIOMES } from "./biome.mjs";

/** How many cultures a map has, by its scale: [fewest, most]. */
export const CULTURE_COUNTS = { kingdom: [1, 2], realm: [2, 3], continent: [3, 6], world: [5, 8] };

// (what crossing ground costs a people, beyond its miles: deserts and the high ground hold them back, the sea most)
const BIOME_COST = { "hot-desert": 1.2, "salt-flat": 1.5, glacier: 3, tundra: 0.8, wetland: 0.6, rainforest: 0.5 };

/**
 * Each land node's culture, grown from the hearths by least cost over the whole land: ranges and deserts dear, the
 * sea dearer (a near island or a strait is crossed, a wide sea isn't). hearths: [{ at: [u, v] }]
 * in map units. Returns an Int16Array (a culture's index, -1 at sea or in a lake).
 */
export function growCultures(land, hearths) {
  const { n, x, y, indptr, indices, h, landMask, lake } = land;
  const owner = new Int16Array(n).fill(-1), cost = new Float64Array(n).fill(Infinity), by = new Int16Array(n).fill(-1);
  const wet = (i) => !landMask[i] || lake[i] === 1;
  const nearest = nearestOf(land), heap = new Heap(4096);
  hearths.forEach((c, k) => {
    const i = nearest(c.at[0], c.at[1], (j) => !wet(j));
    if (i >= 0 && cost[i] > 0) { cost[i] = 0; by[i] = k; heap.push(0, i); }
  });
  while (heap.size) {
    const i = heap.pop(), gi = cost[i];
    if (heap.lastKey > gi + 1e-12) continue;
    for (let q = indptr[i]; q < indptr[i + 1]; q++) {
      const j = indices[q], d = len(x[i] - x[j], y[i] - y[j]);
      const c = wet(j) ? d * (landMask[j] ? 3 : 12) : d * (1 + 10 * Math.max(0, h[j] - 0.3) + (BIOME_COST[BIOMES[land.biome?.[j]]] ?? 0));
      const gj = gi + c;
      if (gj < cost[j] - 1e-12 || (Math.abs(gj - cost[j]) <= 1e-12 && by[i] < by[j])) { cost[j] = gj; by[j] = by[i]; heap.push(gj, j); }
    }
  }
  for (let i = 0; i < n; i++) owner[i] = wet(i) ? -1 : by[i];
  return owner;
}

/**
 * Cultures placed on a plan's land, in place of the generator's own the GM hasn't changed: how many by the map's scale
 * (CULTURE_COUNTS, by the seed), their hearths the best old sites farthest apart, each a name and the seed of its tongue.
 * Returns { plan, added, removed }.
 */
export function placeCultures(plan, land, { seed = plan?.seed ?? 1 } = {}) {
  const all = plan.features ?? [];
  const keep = all.filter((f) => f?.type !== "culture" || !untouched(f));
  const gone = all.filter((f) => f?.type === "culture" && untouched(f)).map((f) => f.id);
  const kept = keep.filter((f) => f?.type === "culture" && Array.isArray(f.at));
  const f = land.frame, MW = f.mapW / f.mpu, MH = f.mapH / f.mpu, r = rng(seed, "cultures");
  const [lo, hi] = CULTURE_COUNTS[f.scale] ?? CULTURE_COUNTS.realm;
  // (every culture kept, as Keep the Cultures does: none is added, so the kept ones keep their land and tongues)
  const want = kept.length && !gone.length ? 0 : Math.max(0, lo + r.int(hi - lo + 1) - kept.length);
  const area = nodeAreas(land);
  const U = (i) => [(land.x[i] - f.margin) / f.mpu, (land.y[i] - f.margin) / f.mpu];
  const inMap = (i) => { const [u, v] = U(i); return u >= 0 && v >= 0 && u <= MW && v <= MH; };
  let landMi = 0;
  for (let i = 0; i < land.n; i++) if (land.landMask[i] && !land.lake[i] && inMap(i)) landMi += area[i];
  // (an old site: low, wet enough, warm enough, by the sea or a river)
  const T = land.threshold ?? 1, cand = [];
  for (let i = 0; i < land.n; i++) {
    if (!land.landMask[i] || land.lake[i] || !inMap(i) || land.h[i] > 0.25) continue;
    let coast = false; for (let q = land.indptr[i]; q < land.indptr[i + 1]; q++) if (!land.landMask[land.indices[q]]) coast = true;
    const fertile = Math.max(0, 1 - Math.abs(Math.min(1.6, land.rain[i]) - 0.9) / 0.9) * Math.min(1, Math.max(0, (land.temp[i] - 0.15) * 4));
    const v = fertile + (coast ? 0.5 : 0) + (land.F?.[i] >= T ? 0.4 + 0.1 * log(land.F[i] / T + 1) : 0) + 0.3 * hashAt(i, 71, seed);
    cand.push([v, i]);
  }
  cand.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const gap = Math.sqrt(landMi / Math.max(1, want + kept.length)) * 0.7 / f.mpu;
  const chosen = kept.map((q) => q.at), picks = [];
  for (const [, i] of cand) {
    if (picks.length >= want) break;
    const at = U(i);
    if (chosen.some((a) => len(a[0] - at[0], a[1] - at[1]) < gap)) continue;
    picks.push(at); chosen.push(at);
  }
  const ids = new Set([...all.map((q) => q.id), ...gone]);
  let k = 0;
  const nextId = () => { do k++; while (ids.has(`culture-${k}`)); ids.add(`culture-${k}`); return `culture-${k}`; };
  const made = picks.map((at, m) => {
    const tongue = Math.floor(hashAt(m, 73, seed) * 1e6) + 1;
    const nm = namerOf({ seed: tongue }, plan);
    const feat = { id: nextId(), type: "culture", class: "culture", at: [Math.round(at[0] * 1000) / 1000, Math.round(at[1] * 1000) / 1000], seed: tongue, name: nm.feature("culture", {}, `culture:${m}`) };
    return { ...feat, made: madeMark(feat) };
  });
  return { plan: { ...structuredClone(plan), features: [...structuredClone(keep), ...made] }, added: made.length, removed: gone.length };
}

/** The cultures a plan keeps, in order: [{ id, name, at, seed, nameSet }]. */
export function culturesOf(plan) {
  return (plan.features ?? []).filter((q) => q.type === "culture" && Array.isArray(q.at) && q.at.length === 2 && Number.isFinite(q.at[0]) && Number.isFinite(q.at[1]))
    .map((q) => ({ id: q.id, name: q.name ?? null, at: q.at, seed: Number.isFinite(q.seed) ? q.seed : 1, nameSet: q.nameSet ?? null }));
}

/**
 * A culture's namer: its own name set when the GM gave it one, else the map's Names setting with the culture's seed
 * (English, English places with older features, an invented tongue of its own, or the map's name set).
 */
export function namerOf(culture, plan) {
  const own = culture.nameSet && typeof culture.nameSet.text === "string" ? parseNameSet(culture.nameSet.text).set : null;
  if (own) return namer("custom", culture.seed, { set: own });
  const L = plan.land ?? {};
  if (L.nameStyle === "custom" && typeof L.nameSet?.text === "string") return namer("custom", culture.seed, { set: parseNameSet(L.nameSet.text).set });
  return namer(L.nameStyle ?? "english", culture.seed);
}
