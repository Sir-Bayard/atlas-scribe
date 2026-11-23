/**
 * Realms on an overland map: kingdoms grown from capitals over the land by what it costs to travel and to hold it, so
 * their borders fall along ranges, big rivers and coasts. A realm is kept in the plan as a point feature (its crown,
 * on its capital) with a name and a color; its land is grown again from the crowns at every layout, so moving a crown
 * redraws the borders and nothing else is stored. Pure.
 */
import { Heap } from "./heap.mjs";
import { log, len } from "./dmath.mjs";
import { rng } from "../rng.mjs";
import { namer } from "./names.mjs";
import { parseNameSet } from "./namesets.mjs";
import { spacingsOf } from "./settle.mjs";
import { BIOMES } from "./biome.mjs";
import { normalize } from "../plan.mjs";
import { madeMark, untouched } from "./places.mjs";
import { culturesOf, growCultures, namerOf } from "./cultures.mjs";

/** How many realms Quick Start asks for. */
export const REALM_COUNTS = ["none", "few", "some", "many"];
/** A realm's spacing (miles between capitals) as a share of the cities', by how many. */
const SPREAD = { few: 3.1, some: 2.2, many: 1.55 };
/** Colors for realms: muted, told apart on the painted land, the first ones the most apart. */
export const REALM_COLORS = ["#b8433a", "#3a6fb0", "#c99a2e", "#6b4a9b", "#3f8f5a", "#c26a2b", "#2f8c8c", "#a3477e", "#7d7a2a", "#5a5f73", "#9b5a3a", "#4a7f9b"];
/** The land a realm can't reach for less than this many of its spacings (in miles' worth of travel) is left to no one (the wilds). */
const REACH = 2.2;
/** A big river's toll each way, onto it and off it, as a share of the realm spacing per log of its size. */
const RIVER_TOLL = 0.03;
const BIOME_COST = { glacier: 6, tundra: 0.6, "hot-desert": 0.9, wetland: 1.2, "salt-flat": 0.8, "temperate-rainforest": 0.3, rainforest: 0.5 };
/** The kinds of realm, by how they grow: naval peoples cross the sea, river peoples follow rivers, highlanders hold
 * the hills, nomads the open grass and desert; the rest grow as all realms do. */
export const REALM_KINDS = ["naval", "river", "highland", "nomadic", "generic"];
// (open country, where nomads ride, and woods, which slow them)
const OPEN = new Set(["grassland", "shrubland", "savanna", "cold-steppe", "hot-desert", "salt-flat", "tundra"]), WOODS = new Set(["temperate-forest", "temperate-rainforest", "seasonal-forest", "rainforest", "taiga"]);
/** How far realms reach by the Realm Growth setting (a multiple of their reach). */
export const GROWTH = { slow: 0.75, normal: 1, fast: 1.4 };
/** The forms of rule: a monarchy's name is by its rank, the others by their form. */
export const RULE_FORMS = ["monarchy", "republic", "league", "horde", "free city"];
/** How two realms stand with each other. */
export const RELATIONS = ["ally", "friendly", "neutral", "rival", "enemy", "vassal", "overlord"];

/**
 * The ranks a realm can take, smallest first, from its land in square miles (the part in the map) and its towns and
 * cities: a barony under 1,500 sq mi, a county under 5,000, a duchy (a march on a frontier with the wilds) under 12,000,
 * a kingdom under 250,000 and an empire above; a kingdom needs two towns or cities and an empire six, a duchy one, or
 * it's a rank lower.
 */
export const REALM_RANKS = ["barony", "county", "duchy", "kingdom", "empire"];
const RANK_AREA = [1500, 5000, 12000, 250000];
const RANK_TOWNS = { duchy: 1, kingdom: 2, empire: 6 };
export function realmRank(sqMi, towns) {
  let k = RANK_AREA.findIndex((a) => sqMi < a);
  if (k < 0) k = REALM_RANKS.length - 1;
  while (k > 1 && towns < (RANK_TOWNS[REALM_RANKS[k]] ?? 0)) k--;
  return REALM_RANKS[k];
}

/** Each node's area in square miles: the land's own, or a third of each triangle it's a corner of. */
export function nodeAreas(land) {
  if (land.area) return land.area;
  const { n, x, y, triangles: tri } = land, area = new Float64Array(n);
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t], b = tri[t + 1], c = tri[t + 2];
    const s = Math.abs((x[b] - x[a]) * (y[c] - y[a]) - (x[c] - x[a]) * (y[b] - y[a])) / 6;
    area[a] += s; area[b] += s; area[c] += s;
  }
  return area;
}

/** A finder of the nearest node to a point in map units (squares), over the land's nodes. */
export function nearestOf(land) {
  const { n, x, y, frame: f } = land;
  const cell = Math.max(land.spacing * 2, 1e-6), gw = Math.ceil(f.W / cell) + 1, gh = Math.ceil(f.H / cell) + 1;
  const start = new Int32Array(gw * gh + 1), at = new Int32Array(n);
  const ci = (i) => Math.min(gh - 1, Math.max(0, Math.floor(y[i] / cell))) * gw + Math.min(gw - 1, Math.max(0, Math.floor(x[i] / cell)));
  for (let i = 0; i < n; i++) start[ci(i) + 1]++;
  for (let k = 0; k < gw * gh; k++) start[k + 1] += start[k];
  const fill = start.slice(0, gw * gh);
  for (let i = 0; i < n; i++) at[fill[ci(i)]++] = i;
  return (u, v, test = () => true) => {
    const px = u * f.mpu + f.margin, py = v * f.mpu + f.margin, cx = Math.floor(px / cell), cy = Math.floor(py / cell);
    let best = -1, bd = Infinity;
    for (let r = 0; r < Math.max(gw, gh); r++) {
      for (let yy = cy - r; yy <= cy + r; yy++) for (let xx = cx - r; xx <= cx + r; xx++) {
        if (xx < 0 || yy < 0 || xx >= gw || yy >= gh || (Math.abs(yy - cy) < r && Math.abs(xx - cx) < r)) continue;
        const k = yy * gw + xx;
        for (let q = start[k]; q < start[k + 1]; q++) { const i = at[q]; if (!test(i)) continue; const d = (x[i] - px) ** 2 + (y[i] - py) ** 2; if (d < bd || (d === bd && i < best)) { bd = d; best = i; } }
      }
      // (a ring past the best found can hold nothing nearer)
      if (best >= 0 && (r * cell) ** 2 > bd) break;
    }
    return best;
  };
}

/** How far (in miles' worth of travel) a realm reaches from its crown, by how many realms the map has. */
export const realmReach = (land, count = "some", growth = "normal") => realmSpacing(land, count) * REACH * (GROWTH[growth] ?? 1);

/** A realm's spacing in miles on this land, by how many realms. */
export function realmSpacing(land, count = "some") {
  return spacingsOf(Math.max(land.frame.mapW, land.frame.mapH)).city * (SPREAD[count] ?? SPREAD.some);
}

/**
 * Each land node's realm, grown from the crowns by least cost: travel (grade, ranges, rough ground), crossing a big
 * river (dear, so borders follow rivers), and the sea or a lake (dearer still, so a near island joins and a far one
 * stays apart), open ground a little dearer or cheaper here and there (wanderOf, by `wander`, so borders across it
 * wander). crowns: [{ at: [u, v], kind (REALM_KINDS), might (1 by default) }] in map units. islands: give an island no
 * realm reached to the realm across the water (holdIslands; realms placed since kinds came, so older maps keep their
 * borders). Returns { owner: Int16Array (a realm's index, -1 at sea or in a lake, -2 land no realm reaches), cost:
 * Float64Array (miles' worth from its crown) }.
 */
export function growRealms(land, crowns, { reach = Infinity, spacing = Number.isFinite(reach) ? reach / REACH : land.spacing * 20, wander: amount = WANDER, islands = false } = {}) {
  // (each crown's kind and might: a kind changes what ground costs it, its might divides every cost, so a mighty realm
  // grows farther before it meets a neighbor)
  const kinds = crowns.map((c) => (REALM_KINDS.includes(c.kind) ? c.kind : "generic")), might = crowns.map((c) => (Number.isFinite(c.might) && c.might > 0 ? c.might : 1));
  const { n, x, y, indptr, indices, h, landMask, lake, F, threshold: T } = land;
  const wander = wanderOf(land, spacing, amount);
  const owner = new Int16Array(n).fill(-1), cost = new Float64Array(n).fill(Infinity);
  const wet = (i) => !landMask[i] || lake[i] === 1;
  const toll = spacing * RIVER_TOLL;
  const nearest = nearestOf(land);
  const riverF = new Float64Array(n), riverId = new Int32Array(n).fill(-1);
  for (const R of land.rivers ?? []) for (const i of R.nodes ?? []) if (F[i] > riverF[i]) { riverF[i] = F[i]; riverId[i] = R.id; }
  const heap = new Heap(4096);
  const by = new Int16Array(n).fill(-1);
  const seats = crowns.map(() => -1);
  crowns.forEach((c, k) => {
    const i = nearest(c.at[0], c.at[1], (j) => !wet(j));
    if (i < 0) return;
    seats[k] = i;
    if (cost[i] > 0) { cost[i] = 0; by[i] = k; heap.push(0, i); }
  });
  while (heap.size) {
    const i = heap.pop(), gi = cost[i];
    if (heap.lastKey > gi + 1e-12) continue;
    if (gi > reach) continue;
    for (let q = indptr[i]; q < indptr[i + 1]; q++) {
      const j = indices[q];
      const d = Math.sqrt((x[i] - x[j]) ** 2 + (y[i] - y[j]) ** 2);
      let c;
      const kind = kinds[by[i]], bj = BIOMES[land.biome?.[j]];
      if (wet(j)) c = d * (landMask[j] ? 4 : kind === "naval" ? 1.6 : 7);
      else {
        const grade = ((h[j] - h[i]) * 3.1) / Math.max(1e-9, d), high = h[j] > 0.5 ? 2.5 : h[j] > 0.35 ? 0.8 : 0;
        c = d * (1 + (kind === "highland" ? 8 : 20) * grade * grade + (kind === "highland" ? 0.3 : 1) * high + (BIOME_COST[bj] ?? 0)) * wander[j];
        if (kind === "nomadic") c *= OPEN.has(bj) ? 0.6 : WOODS.has(bj) ? 1.5 : 1;
        if (kind === "river" && riverF[j] > 0) c *= 0.6;
      }
      c /= might[by[i]];
      // (across a big river, the dearer the bigger it is, so a river is a border more often than not: half on the way
      // onto it and half on the way off, so a realm that reaches a river can't run along it and off onto the far bank
      // for one toll)
      const tollK = kind === "river" ? 0.3 : 1;
      if (riverF[j] > 0 && riverId[j] !== riverId[i]) c += tollK * toll * log(riverF[j] / T + 1);
      if (riverF[i] > 0 && riverId[i] !== riverId[j] && !wet(j)) c += tollK * toll * log(riverF[i] / T + 1);
      const gj = gi + c;
      if (gj < cost[j] - 1e-12 || (Math.abs(gj - cost[j]) <= 1e-12 && by[i] < by[j])) { cost[j] = gj; by[j] = by[i]; heap.push(gj, j); }
    }
  }
  for (let i = 0; i < n; i++) owner[i] = wet(i) ? -1 : by[i] >= 0 && cost[i] <= reach ? by[i] : -2;
  // (a piece of a realm cut off from its crown on its own landmass, a sliver past another realm, goes to the realm
  // around it most)
  tidy(land, owner, seats);
  // (an island no realm reached goes to the realm whose shore is nearest across the sea, within half a spacing; a naval
  // realm's across a whole one)
  if (islands && Number.isFinite(reach)) holdIslands(land, owner, spacing, kinds);
  return { owner, cost };
}

/**
 * Islands no realm reached (whole landmasses touching no realm's land) given to the realm whose shore is nearest across
 * the water: within half a spacing, a naval realm's within a whole one. Changes owner in place.
 */
function holdIslands(land, owner, spacing, kinds) {
  const { n, x, y, indptr, indices, landMask, lake } = land;
  const dist = new Float64Array(n).fill(Infinity), from = new Int16Array(n).fill(-1), heap = new Heap(4096);
  for (let i = 0; i < n; i++) if (owner[i] >= 0) for (let q = indptr[i]; q < indptr[i + 1]; q++) { const j = indices[q]; if (!landMask[j] && dist[j] > 0) { dist[j] = 0; from[j] = owner[i]; heap.push(0, j); } }
  while (heap.size) {
    const i = heap.pop();
    if (heap.lastKey > dist[i] + 1e-12 || dist[i] > spacing) continue;
    for (let q = indptr[i]; q < indptr[i + 1]; q++) { const j = indices[q]; if (landMask[j]) continue; const dd = dist[i] + len(x[i] - x[j], y[i] - y[j]); if (dd < dist[j] - 1e-12 || (Math.abs(dd - dist[j]) <= 1e-12 && from[i] < from[j])) { dist[j] = dd; from[j] = from[i]; heap.push(dd, j); } }
  }
  const seen = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (seen[s] || owner[s] !== -2) continue;
    const comp = [s], st = [s]; seen[s] = 1; let open = true;
    while (st.length) { const i = st.pop(); for (let q = indptr[i]; q < indptr[i + 1]; q++) { const j = indices[q]; if (!landMask[j] || lake[j] === 1) continue; if (owner[j] >= 0) open = false; if (!seen[j] && owner[j] === -2) { seen[j] = 1; st.push(j); comp.push(j); } } }
    if (!open) continue;
    let best = -1, bd = Infinity;
    for (const i of comp) for (let q = indptr[i]; q < indptr[i + 1]; q++) { const j = indices[q]; if (!landMask[j] && from[j] >= 0) { const lim = kinds[from[j]] === "naval" ? spacing : 0.5 * spacing; if (dist[j] < bd && dist[j] <= lim) { bd = dist[j]; best = from[j]; } } }
    if (best >= 0) for (const i of comp) owner[i] = best;
  }
}

export const WANDER = 0.35;

/**
 * A gentle unevenness in what open ground costs to cross, per node (about 0.65 to 1.35), so a border no range or river
 * guides wanders as old borders do rather than running ruled across a plain: smooth noise over the land, its rises
 * a seventh of a realm spacing apart, from the land's seed. Whole-number hashing and plain arithmetic, so every
 * browser grows the same borders.
 */
export function wanderOf(land, spacing, amount = WANDER) {
  const { n, x, y } = land, out = new Float64Array(n).fill(1);
  const seed = (Number(land.seed) | 0) ^ 0x5f3759df;
  const hash = (i, j, o) => { let k = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed + o, 1274126177); k = Math.imul(k ^ (k >>> 13), 1103515245); return ((k ^ (k >>> 16)) >>> 0) / 4294967296; };
  const fade = (t) => t * t * (3 - 2 * t);
  const noise = (px, py, o) => {
    const i = Math.floor(px), j = Math.floor(py), fx = fade(px - i), fy = fade(py - j);
    const a = hash(i, j, o), b = hash(i + 1, j, o), c = hash(i, j + 1, o), d = hash(i + 1, j + 1, o);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  };
  const L1 = Math.max(1e-6, spacing / 7), L2 = L1 / 2.3;
  for (let i = 0; i < n; i++) {
    const v = (noise(x[i] / L1, y[i] / L1, 0) - 0.5) * 1.4 + (noise(x[i] / L2, y[i] / L2, 7) - 0.5) * 0.6;
    out[i] = 1 + amount * v;
  }
  return out;
}

/**
 * Pieces of a realm cut off from the piece its crown is in, on land another realm touches, given to the realm that
 * touches them most; a piece nothing else touches on land (an island, land reached across a bay) stays. seats: each
 * realm's crown node (-1: none; its biggest piece then stands for it).
 */
export function tidy(land, owner, seats = []) {
  const { n, indptr, indices } = land;
  const comp = new Int32Array(n).fill(-1), sizes = [], ownerOf = [];
  let c = 0;
  for (let s = 0; s < n; s++) {
    if (owner[s] < 0 || comp[s] >= 0) continue;
    const stack = [s]; comp[s] = c; let size = 0;
    while (stack.length) { const i = stack.pop(); size++; for (let q = indptr[i]; q < indptr[i + 1]; q++) { const j = indices[q]; if (comp[j] < 0 && owner[j] === owner[s]) { comp[j] = c; stack.push(j); } } }
    sizes.push(size); ownerOf.push(owner[s]); c++;
  }
  // (each realm's main piece: the one its crown is in, else its biggest)
  const main = new Map();
  for (let k = 0; k < c; k++) if (!main.has(ownerOf[k]) || sizes[k] > sizes[main.get(ownerOf[k])]) main.set(ownerOf[k], k);
  seats.forEach((i, k) => { if (i >= 0 && owner[i] === k) main.set(k, comp[i]); });
  for (let k = 0; k < c; k++) {
    if (main.get(ownerOf[k]) === k) continue;
    const touch = new Map();
    for (let i = 0; i < n; i++) if (comp[i] === k) for (let q = indptr[i]; q < indptr[i + 1]; q++) { const j = indices[q]; if (owner[j] >= 0 && owner[j] !== ownerOf[k]) touch.set(owner[j], (touch.get(owner[j]) ?? 0) + 1); }
    if (!touch.size) continue;
    const to = [...touch].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    for (let i = 0; i < n; i++) if (comp[i] === k) owner[i] = to;
  }
}

/** How realm a stands with realm b (realmsOf's list): a's own word for b, else b's for a turned round, else neutral. */
export function relationOf(list, a, b) {
  const A = list[a], B = list[b];
  if (!A || !B) return "neutral";
  const own = A.relations?.[B.id];
  if (own) return own;
  const back = B.relations?.[A.id];
  return back === "vassal" ? "overlord" : back === "overlord" ? "vassal" : back ?? "neutral";
}

/** Which realms touch on land: a Set of "a,b" (a < b) pairs. */
export function neighborsOf(land, owner) {
  const out = new Set();
  for (let i = 0; i < land.n; i++) {
    if (owner[i] < 0) continue;
    for (let q = land.indptr[i]; q < land.indptr[i + 1]; q++) { const j = land.indices[q]; if (owner[j] >= 0 && owner[j] !== owner[i]) out.add(owner[i] < owner[j] ? `${owner[i]},${owner[j]}` : `${owner[j]},${owner[i]}`); }
  }
  return out;
}

/**
 * The realms over the map as a grid of cells (about half a node spacing, in map units): ids (a realm's index, -1 sea
 * or lake, -2 unclaimed land), with each realm's share of the map's land, the cell for its name (the one farthest
 * from its edges) and its borders as lines between realms or a realm and the wilds. Returns { w, h, cell, ids,
 * realms: [{ cells, spot: [u, v], room (units from the spot to its nearest edge) }], borders: [[[u, v], ...]] }.
 */
export function realmGrid(land, owner, count, { relation = null } = {}) {
  const f = land.frame, MW = f.mapW / f.mpu, MH = f.mapH / f.mpu;
  const cell = Math.max(MW, MH) / Math.min(420, Math.max(120, Math.round(Math.max(f.mapW, f.mapH) / (land.spacing * 0.6))));
  const w = Math.ceil(MW / cell), h = Math.ceil(MH / cell), ids = new Int16Array(w * h);
  const nearest = nearestOf(land);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) { const i = nearest((c + 0.5) * cell, (r + 0.5) * cell); ids[r * w + c] = i < 0 ? -1 : owner[i]; }
  // each realm's share and its name's spot: the cell farthest from any other id (a two-pass distance)
  const dist = new Float32Array(w * h).fill(1e9);
  for (let k = 0; k < w * h; k++) {
    const c = k % w, r = (k - c) / w, me = ids[k];
    if (me < 0) { dist[k] = 0; continue; }
    if (c === 0 || r === 0 || c === w - 1 || r === h - 1 || ids[k - 1] !== me || ids[k + 1] !== me || ids[k - w] !== me || ids[k + w] !== me) dist[k] = 1;
  }
  for (let pass = 0; pass < 2; pass++) {
    const fwd = pass === 0;
    for (let s = 0; s < w * h; s++) {
      const k = fwd ? s : w * h - 1 - s, c = k % w, r = (k - c) / w;
      if (ids[k] < 0) continue;
      const nb = fwd ? [[c - 1, r, 1], [c, r - 1, 1], [c - 1, r - 1, 1.414], [c + 1, r - 1, 1.414]] : [[c + 1, r, 1], [c, r + 1, 1], [c + 1, r + 1, 1.414], [c - 1, r + 1, 1.414]];
      for (const [cc, rr, dd] of nb) { if (cc < 0 || rr < 0 || cc >= w || rr >= h) continue; const v = dist[rr * w + cc] + dd; if (v < dist[k]) dist[k] = v; }
    }
  }
  const realms = Array.from({ length: count }, () => ({ cells: 0, spot: null, room: 0 }));
  for (let k = 0; k < w * h; k++) {
    const me = ids[k];
    if (me < 0) continue;
    const R = realms[me];
    if (!R) continue;
    R.cells++;
    if (dist[k] > R.room) { R.room = dist[k]; R.spot = [((k % w) + 0.5) * cell, (Math.floor(k / w) + 0.5) * cell]; }
  }
  for (const R of realms) R.room *= cell;
  // borders: the cell edges between two different land ids, by kind (BORDER_KINDS: a frontier with the wilds, a
  // disputed line between enemies, a river, a crest, else across open country), each kind chained into lines and smoothed
  const segs = Object.fromEntries(BORDER_KINDS.map((k) => [k, []]));
  const landId = (k) => ids[k] !== -1;
  const riverF = new Float64Array(land.n);
  for (const R of land.rivers ?? []) for (const i of R.nodes ?? []) riverF[i] = Math.max(riverF[i], land.F[i]);
  const T = land.threshold ?? Infinity;
  const kindOf = (a, b, cx, cy) => {
    if (a === -2 || b === -2) return "frontier";
    if (relation && relation(a, b) === "enemy") return "disputed";
    const i = nearest(cx * cell, cy * cell);
    if (i < 0) return "open";
    let river = riverF[i] > T;
    for (let q = land.indptr[i]; q < land.indptr[i + 1] && !river; q++) if (riverF[land.indices[q]] > T) river = true;
    return river ? "river" : land.h[i] > 0.35 ? "crest" : "open";
  };
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const k = r * w + c;
    if (!landId(k)) continue;
    if (c + 1 < w && landId(k + 1) && ids[k + 1] !== ids[k]) segs[kindOf(ids[k], ids[k + 1], c + 1, r + 0.5)].push([[c + 1, r], [c + 1, r + 1]]);
    if (r + 1 < h && landId(k + w) && ids[k + w] !== ids[k]) segs[kindOf(ids[k], ids[k + w], c + 0.5, r + 1)].push([[c, r + 1], [c + 1, r + 1]]);
  }
  // (the cells' stair steps taken out first, a line within a cell of them, then its corners rounded)
  const borders = [], kinds = [];
  for (const kind of BORDER_KINDS) for (const line of chainSegments(segs[kind])) { borders.push(smooth(simplify(line, 1.1).map(([c, r]) => [c * cell, r * cell]), 3)); kinds.push(kind); }
  return { w, h, cell, ids, realms, borders, kinds };
}

/** The kinds of border, as realmGrid sorts them. */
export const BORDER_KINDS = ["open", "river", "crest", "disputed", "frontier"];

/**
 * Provinces within the realms: a share of each realm's towns (one in three, at least one more beside the capital when it
 * has four) seat a province, farthest from the capital and each other first, and each province grows inside its realm
 * from its seat (the capital's around it). places: [{ id, at: [u, v], class }]; realms: [{ capital, at }]. Returns {
 * prov: Int16Array (a province's index a node, -1 none), list: [{ realm, seat (a place id), at, spot }], lines (map
 * units: province borders inside realms) }.
 */
export function provincesOf(land, owner, realms, places, G) {
  const n = land.n, f = land.frame, nearest = nearestOf(land), prov = new Int16Array(n).fill(-1), list = [];
  const towns = places.filter((p) => p.class === "town" || p.class === "city");
  const nodeOf = (at) => nearest(at[0], at[1], (j) => land.landMask[j] && !land.lake[j]);
  const seeds = [];
  realms.forEach((R, k) => {
    const mine = towns.filter((p) => { const i = nodeOf(p.at); return i >= 0 && owner[i] === k && p.id !== R.capital; });
    const want = mine.length >= 3 ? Math.max(1, Math.floor(mine.length / 3)) : 0;
    if (!want) return;
    const chosen = [R.at];
    seeds.push({ realm: k, seat: R.capital ?? null, at: R.at });
    for (let t = 0; t < want; t++) {
      let best = null, bd = -1;
      for (const p of mine) { if (chosen.includes(p.at)) continue; const d = Math.min(...chosen.map((a) => len(a[0] - p.at[0], a[1] - p.at[1]))); if (d > bd || (d === bd && best && p.id < best.id)) { bd = d; best = p; } }
      if (!best) break;
      chosen.push(best.at); seeds.push({ realm: k, seat: best.id, at: best.at });
    }
  });
  // (grown by distance inside each realm)
  const dist = new Float64Array(n).fill(Infinity), heap = new Heap(4096);
  seeds.forEach((sd, m) => { const i = nodeOf(sd.at); if (i >= 0 && owner[i] === sd.realm && dist[i] > 0) { dist[i] = 0; prov[i] = m; heap.push(0, i); } list.push({ realm: sd.realm, seat: sd.seat, at: sd.at, spot: null }); });
  while (heap.size) {
    const i = heap.pop();
    if (heap.lastKey > dist[i] + 1e-12) continue;
    for (let q = land.indptr[i]; q < land.indptr[i + 1]; q++) {
      const j = land.indices[q];
      if (owner[j] !== owner[i]) continue;
      const d = dist[i] + len(land.x[i] - land.x[j], land.y[i] - land.y[j]);
      if (d < dist[j] - 1e-12 || (Math.abs(d - dist[j]) <= 1e-12 && prov[i] < prov[j])) { dist[j] = d; prov[j] = prov[i]; heap.push(d, j); }
    }
  }
  // lines: grid edges inside one realm between two provinces; each province's spot its middle cell
  const pid = new Int16Array(G.w * G.h).fill(-1), sum = list.map(() => [0, 0, 0]);
  for (let r = 0; r < G.h; r++) for (let c = 0; c < G.w; c++) { const i = nearest((c + 0.5) * G.cell, (r + 0.5) * G.cell); const v = i >= 0 ? prov[i] : -1; pid[r * G.w + c] = v; if (v >= 0) { sum[v][0] += c + 0.5; sum[v][1] += r + 0.5; sum[v][2]++; } }
  // (its own cell nearest its middle, so a bent province's name sits inside it)
  list.forEach((p, m) => {
    if (!sum[m][2]) return;
    const mx = sum[m][0] / sum[m][2], my = sum[m][1] / sum[m][2];
    let bk = -1, bd = Infinity;
    for (let k = 0; k < pid.length; k++) if (pid[k] === m) { const d = (k % G.w + 0.5 - mx) ** 2 + (Math.floor(k / G.w) + 0.5 - my) ** 2; if (d < bd) { bd = d; bk = k; } }
    p.spot = [(bk % G.w + 0.5) * G.cell, (Math.floor(bk / G.w) + 0.5) * G.cell];
  });
  const segs = [];
  for (let r = 0; r < G.h; r++) for (let c = 0; c < G.w; c++) {
    const k = r * G.w + c;
    if (pid[k] < 0) continue;
    if (c + 1 < G.w && pid[k + 1] >= 0 && pid[k + 1] !== pid[k] && G.ids[k + 1] === G.ids[k]) segs.push([[c + 1, r], [c + 1, r + 1]]);
    if (r + 1 < G.h && pid[k + G.w] >= 0 && pid[k + G.w] !== pid[k] && G.ids[k + G.w] === G.ids[k]) segs.push([[c, r + 1], [c + 1, r + 1]]);
  }
  const lines = chainSegments(segs).map((line) => smooth(simplify(line, 1.1).map(([c, r]) => [c * G.cell, r * G.cell]), 3));
  return { prov, list, lines };
}

/**
 * The wild lands: land in the map no realm holds, in pieces of at least 3% of the map's land, each with a spot for its
 * name (its node farthest from held land and the map's edge). Returns [{ id, at: [u, v], area (sq mi) }].
 */
export function wildsOf(land, owner) {
  const f = land.frame, n = land.n, area = nodeAreas(land), MW = f.mapW / f.mpu, MH = f.mapH / f.mpu;
  const U = (i) => [(land.x[i] - f.margin) / f.mpu, (land.y[i] - f.margin) / f.mpu];
  const inMap = (i) => { const [u, v] = U(i); return u >= 0 && v >= 0 && u <= MW && v <= MH; };
  let total = 0; for (let i = 0; i < n; i++) if (land.landMask[i] && !land.lake[i] && inMap(i)) total += area[i];
  // (how far each wild node is from held land, in steps)
  const steps = new Int32Array(n).fill(-1), q = [];
  for (let i = 0; i < n; i++) if (owner[i] >= 0) { steps[i] = 0; q.push(i); }
  for (let k = 0; k < q.length; k++) { const u = q[k]; for (let e = land.indptr[u]; e < land.indptr[u + 1]; e++) { const v = land.indices[e]; if (steps[v] < 0 && owner[v] === -2) { steps[v] = steps[u] + 1; q.push(v); } } }
  const seen = new Uint8Array(n), out = [];
  for (let s = 0; s < n; s++) {
    if (seen[s] || owner[s] !== -2 || !inMap(s)) continue;
    // (its spot: the node farthest both from held land and from the map's edge, so its name sits inside it)
    const room = (i) => { const [u, v] = U(i); return Math.min((steps[i] < 0 ? 1e9 : steps[i]) * land.spacing, Math.min(u, v, MW - u, MH - v) * f.mpu); };
    const st = [s]; seen[s] = 1; let a = 0, best = s;
    while (st.length) { const i = st.pop(); if (inMap(i)) { a += area[i]; const ri = room(i), rb = inMap(best) ? room(best) : -1; if (ri > rb || (ri === rb && i < best)) best = i; } for (let e = land.indptr[i]; e < land.indptr[i + 1]; e++) { const j = land.indices[e]; if (!seen[j] && owner[j] === -2) { seen[j] = 1; st.push(j); } } }
    if (a >= 0.03 * total) out.push({ id: `wilds-${best}`, at: U(best), area: Math.round(a) });
  }
  return out;
}

/** Grid segments joined end to end into lines (a junction of three realms ends them). */
function chainSegments(segs) {
  const key = (p) => `${p[0]},${p[1]}`;
  const at = new Map();
  segs.forEach((s, i) => { for (const p of s) { const k = key(p); if (!at.has(k)) at.set(k, []); at.get(k).push(i); } });
  const used = new Uint8Array(segs.length), out = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line = [...segs[i]];
    for (const end of [1, 0]) {
      for (;;) {
        const tip = end ? line[line.length - 1] : line[0], list = at.get(key(tip)) ?? [];
        if (list.length !== 2) break;
        const j = list.find((q) => !used[q]);
        if (j === undefined) break;
        used[j] = 1;
        const s = segs[j], far = key(s[0]) === key(tip) ? s[1] : s[0];
        if (end) line.push(far); else line.unshift(far);
      }
    }
    out.push(line);
  }
  return out;
}

/** Douglas-Peucker: a line kept within tol of the original, its ends (and a closed line's first point) kept. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.sqrt(dx * dx + dy * dy);
    let far = -1, fd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = L < 1e-9 ? Math.sqrt((pts[i][0] - ax) ** 2 + (pts[i][1] - ay) ** 2) : Math.abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / L;
      if (d > fd) { fd = d; far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Chaikin's corner cutting, n times, ends kept (a closed line kept closed). */
function smooth(pts, times) {
  let p = pts;
  const closed = p.length > 3 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1];
  for (let t = 0; t < times; t++) {
    const q = closed ? [] : [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, ay] = p[i], [bx, by] = p[i + 1];
      q.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    if (closed) q.push(q[0]); else q.push(p[p.length - 1]);
    p = q;
  }
  return p.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
}

/**
 * Realms for an overland plan, in place of the generator's own the GM hasn't changed: capitals from its cities (towns
 * when cities are few), spread across its land; each named from the map's style or name set by its size, and colored
 * so neighbors differ. land: the layout's compact land; count: few, some or many. Returns { plan (with its realms),
 * added, removed, notes }.
 */
export function placeRealms(plan, land, { count = "some", seed = plan?.seed ?? 1 } = {}) {
  const all = plan.features ?? [];
  const keep = all.filter((f) => f.type !== "realm" || !untouched(f));
  const gone = all.filter((f) => f.type === "realm" && untouched(f)).map((f) => f.id);
  const notes = [];
  if (!REALM_COUNTS.includes(count) || count === "none") return { plan: { ...structuredClone(plan), features: structuredClone(keep) }, added: 0, removed: gone.length, notes };
  const f = land.frame, MW = f.mapW / f.mpu, MH = f.mapH / f.mpu;
  const r = rng(seed, "realms");
  const S = realmSpacing(land, count) / f.mpu; // (in map units)
  const kept = keep.filter((q) => q.type === "realm" && Array.isArray(q.at));
  // candidates: the cities on the map, then its towns, the ones with most roads first, the seed choosing among
  // the cities (so Reroll Realms moves the capitals, not only the names)
  const places = keep.filter((q) => q.type === "place" && Array.isArray(q.at) && q.at[0] >= 0 && q.at[1] >= 0 && q.at[0] <= MW && q.at[1] <= MH);
  const roads = keep.filter((q) => q.type === "road" && Array.isArray(q.path));
  const roadsAt = (p) => roads.filter((rd) => [rd.path[0], rd.path[rd.path.length - 1]].some((e) => Math.abs(e[0] - p.at[0]) < 0.05 && Math.abs(e[1] - p.at[1]) < 0.05)).length;
  const rank = { city: 2, town: 1 };
  const cand = places.filter((p) => rank[p.class]).map((p) => ({ p, w: rank[p.class] * 10 + roadsAt(p) + r.next() * 8 })).sort((a, b) => b.w - a.w || (a.p.id < b.p.id ? -1 : 1));
  // how many: the map's land (by the nodes' own areas: points are sparser far out at sea) over a realm's share of it
  const area = nodeAreas(land);
  const inMap = (i) => { const u = (land.x[i] - f.margin) / f.mpu, v = (land.y[i] - f.margin) / f.mpu; return u >= 0 && v >= 0 && u <= MW && v <= MH; };
  let landMi = 0;
  for (let i = 0; i < land.n; i++) if (land.landMask[i] && !land.lake[i] && inMap(i)) landMi += area[i];
  const landArea = landMi / (f.mpu * f.mpu);
  const want = Math.max(2, Math.min(16, Math.round(landArea / (S * S) * 1.3))) - kept.length;
  // farthest first: each next capital the candidate best placed and farthest from those chosen, never closer than
  // half a spacing
  const chosen = kept.map((q) => q.at);
  const picks = [];
  for (let t = 0; t < want && cand.length; t++) {
    let best = null, bv = -Infinity;
    for (const c of cand) {
      if (picks.includes(c)) continue;
      const dmin = chosen.length ? Math.min(...chosen.map((a) => Math.sqrt((a[0] - c.p.at[0]) ** 2 + (a[1] - c.p.at[1]) ** 2))) : S;
      if (dmin < S * 0.5) continue;
      const v = Math.min(dmin, S * 1.5) * (1 + 0.04 * c.w);
      if (v > bv) { bv = v; best = c; }
    }
    if (!best) break;
    picks.push(best); chosen.push(best.p.at);
  }
  if (!picks.length && !kept.length) {
    notes.push("There were no cities or towns on the map to rule realms from, so it has none. Place Towns and Roads first.");
    return { plan: { ...structuredClone(plan), features: structuredClone(keep) }, added: 0, removed: gone.length, notes };
  }
  // each new realm's kind, from its capital's site (high ground, the coast, a big river, open country), and its might
  // (the Realm Sizes setting: varied by the seed, or even)
  const L0 = plan.land ?? {}, growth = GROWTH[L0.realmGrowth] ? L0.realmGrowth : "normal", varied = L0.realmSizes !== "even";
  const nearest0 = nearestOf(land), riverF = new Float64Array(land.n);
  for (const R of land.rivers ?? []) for (const i of R.nodes ?? []) riverF[i] = Math.max(riverF[i], land.F[i]);
  const kindAt = (at, key) => {
    const i = nearest0(at[0], at[1], (j) => land.landMask[j] && !land.lake[j]);
    if (i < 0) return "generic";
    let coast = false; for (let q = land.indptr[i]; q < land.indptr[i + 1]; q++) if (!land.landMask[land.indices[q]]) coast = true;
    const b = BIOMES[land.biome?.[i]], k = r.fork("kind", key).next();
    return land.h[i] > 0.3 ? "highland" : coast && k < 0.45 ? "naval" : riverF[i] > 3 * (land.threshold ?? Infinity) && k < 0.8 ? "river" : OPEN.has(b) && land.rain[i] < 0.6 ? "nomadic" : "generic";
  };
  const newKinds = picks.map((c) => kindAt(c.p.at, c.p.id)), newMight = picks.map((c) => (varied ? Math.round((0.65 + 0.7 * r.fork("might", c.p.id).next()) * 100) / 100 : 1));
  // grow them once, for their sizes and who borders whom
  const crowns = [...kept.map((q) => ({ at: q.at, kind: q.kind, might: q.might })), ...picks.map((c, m) => ({ at: c.p.at, kind: newKinds[m], might: newMight[m] }))];
  const { owner } = growRealms(land, crowns, { reach: realmReach(land, count, growth), islands: true });
  // (how much of the land any realm holds, for the note on the wilds)
  let held = 0, dry = 0;
  for (let i = 0; i < land.n; i++) if (owner[i] !== -1) { dry += area[i]; if (owner[i] >= 0) held += area[i]; }
  const pairs = neighborsOf(land, owner);
  // colors: a kept realm keeps its own; each new one the first color no neighbor has, else the least used
  const colors = crowns.map((c, k) => (k < kept.length ? kept[k].color ?? null : null));
  for (let k = kept.length; k < crowns.length; k++) {
    const near = new Set([...pairs].map((p) => p.split(",").map(Number)).filter(([a, b]) => a === k || b === k).map(([a, b]) => colors[a === k ? b : a]).filter(Boolean));
    const used = (c) => colors.filter((x) => x === c).length;
    colors[k] = REALM_COLORS.find((c) => !near.has(c) && !colors.includes(c)) ?? REALM_COLORS.filter((c) => !near.has(c)).sort((a, b) => used(a) - used(b))[0] ?? REALM_COLORS[k % REALM_COLORS.length];
  }
  // names: by rank (realmRank: its land in the map in square miles and its towns), from the map's style or its name
  // set; a new realm's id clear of the plan's own
  const landOf = new Array(crowns.length).fill(0), townsOf = new Array(crowns.length).fill(0), frontier = new Array(crowns.length).fill(false);
  for (let i = 0; i < land.n; i++) {
    const o = owner[i];
    if (o < 0 || !land.landMask[i] || land.lake[i]) continue;
    if (inMap(i)) landOf[o] += area[i];
    for (let q = land.indptr[i]; q < land.indptr[i + 1]; q++) { const j = land.indices[q]; if (owner[j] === -2 && land.landMask[j] && !land.lake[j]) frontier[o] = true; }
  }
  const nearest = nearestOf(land);
  for (const p of places) if (p.class === "town" || p.class === "city") { const i = nearest(p.at[0], p.at[1]); if (i >= 0 && owner[i] >= 0) townsOf[owner[i]]++; }
  const L = plan.land ?? {};
  const set = L.nameStyle === "custom" && typeof L.nameSet?.text === "string" ? parseNameSet(L.nameSet.text).set : null;
  const nm = set ? namer("custom", seed, { set }) : namer(L.nameStyle ?? "english", seed);
  for (const q of keep) if (typeof q.name === "string") nm.take(q.name);
  // (a realm is named in the tongue of the culture its capital stands in, when the plan has cultures)
  const cultures = culturesOf(plan), cOwner = cultures.length ? growCultures(land, cultures) : null;
  const cNamers = cultures.map((c) => { const m = namerOf(c, plan); for (const q of keep) if (typeof q.name === "string") m.take(q.name); return m; });
  const cultureAt = (at) => { if (!cOwner) return -1; const i = nearest(at[0], at[1], (j) => land.landMask[j] && !land.lake[j]); return i >= 0 ? cOwner[i] : -1; };
  // (forms of rule: nomads a horde; a small sea realm a republic, a free city with one town; a middling one a league
  // now and then; the rest monarchies)
  const formOf = (kind, rank, towns, key) => { const k = r.fork("form", key).next(); return kind === "nomadic" ? "horde" : kind === "naval" && (rank === "barony" || rank === "county") ? (towns <= 1 ? "free city" : "republic") : kind === "naval" && rank === "duchy" && k < 0.5 ? "league" : "monarchy"; };
  const ids = new Set([...all.map((q) => q.id), ...gone]);
  let k = 0;
  const nextId = () => { do k++; while (ids.has(`realm-${k}`)); ids.add(`realm-${k}`); return `realm-${k}`; };
  const made = [], featOf = crowns.map((cr, k) => (k < kept.length ? kept[k] : null));
  picks.forEach((c, m) => {
    const idx = kept.length + m, rank = realmRank(landOf[idx], townsOf[idx]);
    const rankWord = rank === "duchy" && frontier[idx] ? "march" : rank;
    const capName = typeof c.p.name === "string" && c.p.name.trim() ? c.p.name.trim() : null;
    const kind = newKinds[m], form = formOf(kind, rank, townsOf[idx], c.p.id), cu = cultureAt(c.p.at);
    const name = (cu >= 0 ? cNamers[cu] : nm).feature("realm", { rank: rankWord, form: form === "monarchy" ? null : form, near: capName }, `realm:${c.p.id}`);
    if (!name) return;
    const feat = { id: nextId(), type: "realm", class: "realm", at: [...c.p.at], name, color: colors[idx], capital: c.p.id, kind, form, might: newMight[m], ...(cu >= 0 ? { culture: cultures[cu].id } : {}) };
    made.push({ ...feat, made: madeMark(feat) });
    featOf[idx] = made[made.length - 1];
  });
  // relations between neighbors (a new realm's, kept on it): a small realm beside a great one of its culture its vassal;
  // the same culture allies or friends; another rivals, enemies or neutral, by the seed
  const ranks = crowns.map((cr, k) => realmRank(landOf[k], townsOf[k])), cultOf = featOf.map((q) => q?.culture ?? null);
  for (const pair of pairs) {
    const [a, b] = pair.split(",").map(Number), A = featOf[a], B = featOf[b];
    if (!A || !B || (a < kept.length && b < kept.length)) continue;
    const same = cultOf[a] && cultOf[a] === cultOf[b], ra = REALM_RANKS.indexOf(ranks[a]), rb = REALM_RANKS.indexOf(ranks[b]), k = r.fork("relation", pair).next();
    let ab, ba;
    if (same && ra <= 1 && rb >= 3) { ab = "vassal"; ba = "overlord"; } else if (same && rb <= 1 && ra >= 3) { ab = "overlord"; ba = "vassal"; }
    else if (same) ab = ba = k < 0.45 ? "ally" : "friendly";
    else ab = ba = k < 0.25 ? "enemy" : k < 0.6 ? "rival" : "neutral";
    if (a >= kept.length) A.relations = { ...(A.relations ?? {}), [B.id]: ab };
    if (b >= kept.length) B.relations = { ...(B.relations ?? {}), [A.id]: ba };
  }
  for (const q of made) q.made = madeMark(q);
  const unreached = held && dry ? Math.max(0, 1 - held / dry) : 0;
  if (unreached > 0.25) notes.push(`About ${Math.round(unreached * 100)}% of the land is far from any capital and belongs to no realm (the wilds).`);
  // (a kept realm's relations with realms no longer on the map are dropped)
  const out = structuredClone(keep), live = new Set([...out.filter((q) => q.type === "realm").map((q) => q.id), ...made.map((q) => q.id)]);
  for (const q of out) if (q.type === "realm" && q.relations && typeof q.relations === "object") {
    const rel = Object.fromEntries(Object.entries(q.relations).filter(([id]) => live.has(id) && id !== q.id));
    if (Object.keys(rel).length !== Object.keys(q.relations).length) { if (Object.keys(rel).length) q.relations = rel; else delete q.relations; }
  }
  return { plan: { ...structuredClone(plan), features: [...out, ...made] }, added: made.length, removed: gone.length, notes };
}

/** The realms a plan keeps, normalized, in order: [{ id, name, color, at, capital, kind, form, might, relations, culture }]. */
export function realmsOf(plan) {
  return (normalize(plan).features ?? []).filter((q) => q.type === "realm" && Array.isArray(q.at) && q.at.length === 2 && Number.isFinite(q.at[0]) && Number.isFinite(q.at[1])).map((q, k) => ({ id: q.id, name: q.name ?? null, color: q.color ?? REALM_COLORS[k % REALM_COLORS.length], at: q.at, capital: q.capital ?? null, kind: q.kind ?? "generic", form: q.form ?? "monarchy", might: Number.isFinite(q.might) ? q.might : 1, relations: q.relations ?? null, culture: q.culture ?? null }));
}
