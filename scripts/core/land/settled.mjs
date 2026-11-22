/**
 * Settled land: how cleared and farmed each node of an overland map is (0 to 1), from its places, roads and navigable
 * rivers. Each place clears the country about it by its size, each road a strip along it; the clearing spreads over
 * the land by a least-cost flood, dearer up steep slopes, onto high ground, into marsh, desert and the cold, and cheap
 * along a navigable river (a main river from where it carries a tenth of its water at the mouth), so farms follow the
 * valleys and the roads and stop at the hills. The painter clears the forest by it into woods with edges and paints
 * fields on it; the labels put a forest's name in what's left of it. Deterministic (plain arithmetic and Math.exp on
 * one computer). Pure.
 */
import { Heap } from "./heap.mjs";
import { BIOMES } from "./biome.mjs";
import { nearestOf } from "./realms.mjs";

/**
 * How much each kind of place clears and how far (miles of easy ground over which its clearing falls by e). Land over
 * about 0.35 is cleared and farmed: on a kingdom's map with some towns about a fifth of the land, with few an eighth.
 * Ruins, battlefields and the wilds' points of interest (lairs, wrecks, stones...) clear nothing.
 */
export const SETTLE_PLACE = { city: [1, 25], town: [0.95, 15], village: [0.85, 8], hamlet: [0.7, 5], castle: [0.7, 6], tower: [0.45, 3], temple: [0.55, 3.75], inn: [0.5, 3], mine: [0.4, 2.5], quarry: [0.4, 2], fort: [0.55, 3.5], monastery: [0.5, 3], lighthouse: [0.3, 1.5], customs: [0.4, 2], place: [0.6, 3.75] };
/** And each class of road, along its whole length. */
export const SETTLE_ROAD = { highway: [0.75, 5.5], road: [0.65, 4], track: [0.45, 2.25], path: [0.3, 1.5] };
/** Settled enough to be cleared and farmed. */
export const SETTLED = 0.35;
// (a clearing fainter than this is none: the flood stops there)
const FAINTEST = 0.02, CUT = -Math.log(FAINTEST);
// (a land's nearest-node lookup, made once)
const NEAR = new WeakMap();
const nearOf = (land) => { let f = NEAR.get(land); if (!f) { f = nearestOf(land); NEAR.set(land, f); } return f; };
// (a navigable river's stretch: how much cheaper travel along it is than over open ground)
const RIVER_EASE = 0.4;
// (feet a height unit)
const FT_PER_UNIT = 16400;
// (extra cost per mile on ground that's hard to farm)
const BIOME_COST = { wetland: 1.5, "hot-desert": 3, "salt-flat": 4, "cold-steppe": 1.2, tundra: 2.5, glacier: 8, taiga: 0.6, "temperate-rainforest": 0.4, rainforest: 0.8 };
// (how much of the clearing a node's own ground lets be farmed)
const BIOME_KEEP = { wetland: 0.45, "hot-desert": 0.35, "salt-flat": 0.1, tundra: 0.3, glacier: 0 };

/**
 * land: the layout's compact land; items: the layout's items (places { kind: "place", class, x, y } and roads
 * { kind: "way", class, path } in map units). Returns a Float32Array, one value a node: 0 wild to 1 cleared, shared
 * with every layout of the same land, places and roads (read it, don't change it).
 */
export function settledField(land, items) {
  // (kept a land, for its last two sets of places and roads: a plan's other changes lay it out again with the same)
  const memo = MEMO.get(land) ?? MEMO.set(land, new Map()).get(land), mk = settledKey(items);
  if (memo.has(mk)) { const hit = memo.get(mk); memo.delete(mk); memo.set(mk, hit); return hit; }
  const out = settledOf(land, items);
  if (memo.size >= 2) memo.delete(memo.keys().next().value);
  memo.set(mk, out);
  return out;
}
const MEMO = new WeakMap();
function settledOf(land, items) {
  const { n, x, y, indptr, indices, h, landMask, lake, frame: f } = land;
  const out = new Float32Array(n);
  const places = items.filter((it) => it.kind === "place" && Number.isFinite(it.x) && Number.isFinite(it.y) && SETTLE_PLACE[it.class] && it.class !== "ruin");
  const roads = items.filter((it) => it.kind === "way" && Array.isArray(it.path) && it.path.length >= 2);
  if (!places.length && !roads.length) return out;
  const dry = (i) => landMask[i] === 1 && lake[i] !== 1;
  const nearest = nearOf(land);
  // the sources: a key a node (the less the more it's cleared) and the reach it spreads at
  const key = new Float64Array(n).fill(Infinity), reach = new Float64Array(n).fill(1);
  const heap = new Heap(4096);
  const seed = (i, strength, r) => {
    if (i < 0 || !dry(i)) return;
    const k = -Math.log(strength);
    if (k < key[i] - 1e-12 || (Math.abs(k - key[i]) <= 1e-12 && r > reach[i])) { key[i] = k; reach[i] = r; heap.push(k, i); }
  };
  for (const p of places) { const [s, r] = SETTLE_PLACE[p.class]; seed(nearest(p.x, p.y, dry), s, r); }
  const step = Math.max(1e-6, (land.spacing * 0.5) / f.mpu);
  for (const w of roads) {
    const [s, r] = SETTLE_ROAD[w.class] ?? SETTLE_ROAD.road;
    for (let m = 1; m < w.path.length; m++) {
      const [ax, ay] = w.path[m - 1], [bx, by] = w.path[m], k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
      for (let q = 0; q <= k; q++) seed(nearest(ax + ((bx - ax) * q) / k, ay + ((by - ay) * q) / k, dry), s, r);
    }
  }
  // (navigable: a main river from where it carries a tenth of its water at the mouth, down)
  const navigable = new Uint8Array(n);
  for (const R of land.rivers ?? []) {
    if (!R.main) continue;
    const nodes = R.nodes ?? [];
    const last = nodes.length ? land.F[nodes[nodes.length - 1]] : 0;
    let from = nodes.findIndex((i) => land.F[i] >= 0.1 * last);
    if (from < 0) from = nodes.length;
    for (let k = from; k < nodes.length; k++) navigable[nodes[k]] = 1;
  }
  const costMul = BIOMES.map((b) => BIOME_COST[b] ?? 0), keepOf = BIOMES.map((b) => BIOME_KEEP[b] ?? 1);
  // the flood: a node's key is the least, over its sources, of (miles' worth of cost from it) / (its reach) - ln(strength)
  while (heap.size) {
    const i = heap.pop();
    if (heap.lastKey > key[i]) continue;
    for (let q = indptr[i]; q < indptr[i + 1]; q++) {
      const j = indices[q];
      if (!dry(j)) continue;
      const mi = Math.hypot(x[j] - x[i], y[j] - y[i]), grade = (Math.abs(h[j] - h[i]) * FT_PER_UNIT) / Math.max(1e-6, mi * 5280);
      let c = mi * (1 + 200 * grade * grade + (h[j] > 0.42 ? 2 : 0) + (costMul[land.biome[j]] ?? 0));
      if (navigable[i] && navigable[j]) c *= RIVER_EASE;
      const k = key[i] + c / reach[i];
      if (k < key[j] - 1e-12 && k < CUT) { key[j] = k; reach[j] = reach[i]; heap.push(k, j); }
    }
  }
  for (let i = 0; i < n; i++) if (dry(i) && key[i] < Infinity) {
    // (what's left of a node's clearing on its own ground: little on high mountains, in marsh and desert)
    const high = h[i] > 0.55 ? 0.2 : h[i] > 0.45 ? 0.6 : 1;
    out[i] = Math.exp(-key[i]) * high * (keepOf[land.biome[i]] ?? 1);
  }
  return out;
}

/** A short key for what a settled field is made from (its places and roads), for caches. */
export function settledKey(items) {
  let hsh = 2166136261;
  const mix = (v) => { hsh = Math.imul(hsh ^ (Math.round(v * 1000) | 0), 16777619); };
  for (const it of items) {
    if (it.kind === "place") { mix(1); mix(it.x); mix(it.y); for (const ch of String(it.class)) mix(ch.charCodeAt(0)); }
    else if (it.kind === "way") { mix(2); for (const ch of String(it.class)) mix(ch.charCodeAt(0)); for (const p of it.path) { mix(p[0]); mix(p[1]); } }
  }
  return (hsh >>> 0).toString(36);
}

// (the forest biomes, as the land's inventory groups them into forests)
const FOREST = new Set(["temperate-forest", "temperate-rainforest", "seasonal-forest", "rainforest", "taiga"]);

/**
 * Where a forest's name goes once the settled land has cleared some of it: the node of its uncleared wood farthest (in
 * steps) from cleared land or open country, so the name sits inside what's left. land: the compact land; settled: its
 * settledField; x, y: the forest's spot in the inventory (frame miles). Returns [x, y] in frame miles, the spot itself
 * when nothing is settled, or null when too little of it is left to name (under a fifth of it, or none). Pure.
 */
export function woodSpot(land, settled, x, y) {
  if (!settled || settled.length !== land.n) return [x, y];
  const { n, indptr, indices, landMask, lake, biome, frame: f } = land;
  const inMap = (i) => land.x[i] >= f.margin && land.y[i] >= f.margin && land.x[i] <= f.margin + f.mapW && land.y[i] <= f.margin + f.mapH;
  const isForest = (i) => landMask[i] && !(lake?.[i] === 1) && FOREST.has(BIOMES[biome[i]]) && inMap(i);
  const start = nearOf(land)((x - f.margin) / f.mpu, (y - f.margin) / f.mpu, isForest);
  if (start < 0) return [x, y];
  // the forest's nodes (from its spot, over forest), and its wood: those not cleared
  const comp = new Int32Array(n).fill(-1), all = [start];
  comp[start] = 0;
  for (let k = 0; k < all.length; k++) for (let e = indptr[all[k]]; e < indptr[all[k] + 1]; e++) { const j = indices[e]; if (comp[j] < 0 && isForest(j)) { comp[j] = 0; all.push(j); } }
  const wood = all.filter((i) => settled[i] < SETTLED);
  if (wood.length === all.length) return [x, y];
  let left = 0, whole = 0;
  for (const i of all) { whole += land.area[i]; if (settled[i] < SETTLED) left += land.area[i]; }
  if (!wood.length || left < 0.2 * whole) return null;
  // steps from the wood's edge: a flood from every wood node with a neighbor outside the wood
  const inWood = new Uint8Array(n), d = new Int32Array(n).fill(-1), q = [];
  for (const i of wood) inWood[i] = 1;
  for (const i of wood) for (let e = indptr[i]; e < indptr[i + 1]; e++) if (!inWood[indices[e]]) { d[i] = 0; q.push(i); break; }
  for (let k = 0; k < q.length; k++) for (let e = indptr[q[k]]; e < indptr[q[k] + 1]; e++) { const j = indices[e]; if (inWood[j] && d[j] < 0) { d[j] = d[q[k]] + 1; q.push(j); } }
  let best = wood[0];
  for (const i of wood) if (d[i] > d[best] || (d[i] === d[best] && i < best)) best = i;
  return [land.x[best], land.y[best]];
}
