/**
 * Points of interest on an overland plan, each sited by the land, the places and roads, the settled land and the
 * realms: hamlets in farmed country, inns a day apart along the roads, mines where hard rock meets a river, quarries
 * near towns, watchtowers on passes and borders, forts where roads cross borders or climb to passes, shrines on hills
 * above settled land, monasteries in high quiet valleys, lighthouses on capes, customs houses where a road crosses a
 * border, battlefields on open ground along a border; and in the wilds a few of standing stones and barrows on open
 * downs, shipwrecks off rocky coasts, lairs and caves, sacred groves in the forest, brigands on lonely roads, pirates
 * in hidden coves and monsters by their haunt (a lake, the sea, the hills). How many comes from the map's Points of
 * Interest choice (land.sites). They're plan features (places of their own classes), kept like towns: what the GM
 * moved or changed stays. Pure.
 */
import { Heap } from "./heap.mjs";
import { BIOMES } from "./biome.mjs";
import { rng } from "../rng.mjs";
import { spacingsOf } from "./settle.mjs";
import { settledField } from "./settled.mjs";
import { growRealms, realmReach, nearestOf } from "./realms.mjs";
import { normalize } from "../plan.mjs";
import { untouched, madeMark, stillNeeded } from "./places.mjs";
import { atan2, PI } from "./dmath.mjs";

/** The Points of Interest choice's values, and how many of each kind they mean (a share of the full count). */
export const SITE_COUNTS = ["none", "few", "some", "many"];
const DENSITY = { none: 0, few: 0.5, some: 1, many: 1.7 };
/**
 * Each kind: spacing (a share of the cities' spacing, from others of its kind), per (land in squared spacings for
 * each: fewer the higher), most (at most this many), scales (the map scales it's placed on), wild (one of the kinds a
 * map takes only some of, by its seed, so maps differ: three with few, four with some, six with many).
 */
export const SITE_KINDS = {
  hamlet: { spacing: 0.14, per: 18, most: 40, scales: ["kingdom"] },
  inn: { spacing: 0.44, per: 8, most: 16, scales: ["kingdom", "realm"] },
  mine: { spacing: 0.35, per: 19, most: 12, scales: ["kingdom", "realm", "continent", "world"] },
  quarry: { spacing: 0.4, per: 19, most: 8, scales: ["kingdom", "realm"] },
  tower: { spacing: 0.35, per: 19, most: 12, scales: ["kingdom", "realm", "continent"] },
  fort: { spacing: 0.5, per: 12, most: 10, scales: ["kingdom", "realm", "continent", "world"] },
  temple: { spacing: 0.4, per: 15, most: 10, scales: ["kingdom", "realm", "continent"] },
  monastery: { spacing: 0.6, per: 12, most: 6, scales: ["kingdom", "realm", "continent"] },
  lighthouse: { spacing: 0.3, per: 35, most: 10, scales: ["kingdom", "realm", "continent"] },
  customs: { spacing: 0.3, per: 25, most: 10, scales: ["kingdom", "realm"] },
  battlefield: { spacing: 0.6, per: 12, most: 4, scales: ["kingdom", "realm", "continent", "world"] },
  stones: { spacing: 0.5, per: 18, most: 5, scales: ["kingdom", "realm"], wild: true },
  barrow: { spacing: 0.15, per: 60, most: 8, scales: ["kingdom", "realm"], wild: true },
  wreck: { spacing: 0.4, per: 25, most: 6, scales: ["kingdom", "realm", "continent"], wild: true },
  lair: { spacing: 0.45, per: 14, most: 6, scales: ["kingdom", "realm", "continent", "world"], wild: true },
  cave: { spacing: 0.4, per: 15, most: 6, scales: ["kingdom", "realm"], wild: true },
  grove: { spacing: 0.45, per: 20, most: 5, scales: ["kingdom", "realm"], wild: true },
  camp: { spacing: 0.45, per: 20, most: 5, scales: ["kingdom", "realm"], wild: true },
  cove: { spacing: 0.5, per: 18, most: 4, scales: ["kingdom", "realm", "continent"], wild: true },
  monster: { spacing: 0.7, per: 9, most: 4, scales: ["kingdom", "realm", "continent", "world"], wild: true },
};
/** The classes of place that are points of interest (what Place Towns and Roads puts down after the towns). */
export const SITE_CLASSES = Object.keys(SITE_KINDS);
/** The kinds drawn as a mark with no label (their names are kept for the gazetteer): secrets and small things. */
export const MARK_ONLY = ["stones", "barrow", "wreck", "lair", "cave", "grove", "camp", "cove", "monster"];
/** The kinds whose place depends on the realms' borders (placed again when the realms are). */
export const BORDER_SITES = ["customs", "battlefield", "fort", "tower"];
/** How many of the wild kinds a map takes, by the choice. */
const WILD_TAKES = { few: 3, some: 4, many: 6 };
// (heights in the land's units: 1 is about 5 km, 3.1 mi)
const MI_PER_UNIT = 3.1;
// (the miles a day's travel covers on a road, for inns and the lonely stretches brigands keep to)
const DAY_MI = 22;

/**
 * Points of interest placed on an overland plan's land in place of the generator's own the GM hasn't changed. land:
 * the layout's compact land; count: none, few, some or many (the plan's land.sites when left out); only: the kinds to
 * place again (the others stay as they are), all when left out; reserve: ids not to give out (those of places that
 * went before this). Returns { plan, added, removed, notes }.
 */
export function placeSites(plan, land, { count = null, seed = plan?.seed ?? 1, only = null, reserve = [] } = {}) {
  const want = SITE_COUNTS.includes(count) ? count : SITE_COUNTS.includes(plan?.land?.sites) ? plan.land.sites : "some";
  const kinds = new Set(only ?? SITE_CLASSES);
  const all = plan.features ?? [];
  // (what a label follows or a kept road ends at stays, as with towns)
  const need = stillNeeded(all);
  const mine = (f) => f?.type === "place" && kinds.has(f.class) && untouched(f) && !need.has(f.id);
  const keep = all.filter((f) => !mine(f));
  const gone = [...all.filter(mine).map((f) => f.id), ...reserve];
  const out = (made, notes = []) => ({ plan: { ...structuredClone(plan), features: [...structuredClone(keep), ...made] }, added: made.length, removed: gone.length, notes });
  if (want === "none" || !land?.n) return out([]);
  const spots = siteSpots(land, normalize({ ...plan, features: keep }), { count: want, seed, kinds });
  const ids = new Set([...all.map((f) => f.id), ...gone]);
  const counts = {};
  const made = spots.map((s) => {
    let id; do id = `${s.kind}-${(counts[s.kind] = (counts[s.kind] ?? 0) + 1)}`; while (ids.has(id));
    ids.add(id);
    const feat = { id, type: "place", class: s.kind, at: s.at, site: s.site };
    return { ...feat, made: madeMark(feat) };
  });
  return out(made);
}

/**
 * Where each kind goes: [{ kind, at: [u, v] map units, site }], in the order placed. plan: normalized, with the places
 * and roads (and realms) that stay. Pure; each kind draws from a stream of its own.
 */
export function siteSpots(land, plan, { count = "some", seed = 1, kinds = new Set(SITE_CLASSES) } = {}) {
  const { n, x, y, indptr, indices, h, landMask, lake, rain, temp, F, threshold: T } = land;
  const f = land.frame, mpu = f.mpu, M = f.margin, scale = f.scale;
  const dens = DENSITY[count] ?? 1;
  const sp = spacingsOf(Math.max(f.mapW, f.mapH));
  const sq = (v) => v * v;
  const dist = (i, j) => Math.sqrt(sq(x[i] - x[j]) + sq(y[i] - y[j]));
  const U = (i) => [Math.round(((x[i] - M) / mpu) * 100) / 100, Math.round(((y[i] - M) / mpu) * 100) / 100];
  const wet = (i) => !landMask[i] || lake[i] === 1;
  const sea = (i) => !landMask[i];
  const inMap = (i, pad = 0) => x[i] >= M + pad && y[i] >= M + pad && x[i] <= M + f.mapW - pad && y[i] <= M + f.mapH - pad;
  const biomeOf = (i) => BIOMES[land.biome[i]] ?? null;
  const hard = land.hard ?? new Float32Array(n);
  const step = land.spacing;
  const nearest = nearestOf(land);
  const nodeAt = (p, test) => nearest(p[0], p[1], test);
  const features = plan.features ?? [];
  const places = features.filter((q) => q.type === "place" && Array.isArray(q.at));
  const roads = features.filter((q) => q.type === "road" && Array.isArray(q.path) && q.path.length >= 2);
  const jitter = (kind) => { const r = rng(seed, "sites", kind); const salt = 1 + r.int(2147483645); return (i) => { let v = Math.imul(i + 1, 2654435761) ^ Math.imul(salt, 1597334677); v = Math.imul(v ^ (v >>> 15), 2246822507); v = Math.imul(v ^ (v >>> 13), 3266489909); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; }; };

  // ---- what each node offers ----
  // slope (rise over run, both in miles) and prominence (height over its surroundings)
  const slope = new Float64Array(n), prom = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (wet(i)) continue;
    let s = 0;
    for (let k = indptr[i]; k < indptr[i + 1]; k++) { const j = indices[k]; s = Math.max(s, (Math.abs(h[i] - h[j]) * MI_PER_UNIT) / Math.max(1e-9, dist(i, j))); }
    slope[i] = s;
  }
  // (a spatial grid of nodes, for "within so many miles")
  const cell = Math.max(step * 2, 1e-6), gw = Math.ceil(f.W / cell) + 1, gh = Math.ceil(f.H / cell) + 1;
  const bucket = new Int32Array(gw * gh + 1), order = new Int32Array(n);
  const cellOf = (i) => Math.min(gw - 1, Math.floor(x[i] / cell)) + Math.min(gh - 1, Math.floor(y[i] / cell)) * gw;
  for (let i = 0; i < n; i++) bucket[cellOf(i) + 1]++;
  for (let c = 1; c <= gw * gh; c++) bucket[c] += bucket[c - 1];
  { const fill = bucket.slice(0, gw * gh); for (let i = 0; i < n; i++) order[fill[cellOf(i)]++] = i; }
  const within = (px, py, rad, fn) => {
    const c0 = Math.max(0, Math.floor((px - rad) / cell)), c1 = Math.min(gw - 1, Math.floor((px + rad) / cell));
    const r0 = Math.max(0, Math.floor((py - rad) / cell)), r1 = Math.min(gh - 1, Math.floor((py + rad) / cell));
    for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) { const b = cc + rr * gw; for (let k = bucket[b]; k < bucket[b + 1]; k++) { const j = order[k]; if (sq(x[j] - px) + sq(y[j] - py) <= rad * rad) fn(j); } }
  };
  const promR = Math.max(6, 4 * step);
  for (let i = 0; i < n; i++) { if (wet(i)) continue; let s = 0, c = 0; within(x[i], y[i], promR, (j) => { if (landMask[j]) { s += h[j]; c++; } }); prom[i] = h[i] - s / Math.max(1, c); }
  // rivers: the flow at each river node
  const riverF = new Float64Array(n);
  for (const R of land.rivers ?? []) for (const i of R.nodes ?? []) if (F[i] > riverF[i]) riverF[i] = F[i];
  const riverNear = (i) => { if (riverF[i] > 0) return riverF[i]; let v = 0; for (let k = indptr[i]; k < indptr[i + 1]; k++) v = Math.max(v, riverF[indices[k]]); return v; };
  // coast: dry land beside the sea; shelter: how much land is around a coast node (a bay); cliffs: a steep coast
  const coast = new Uint8Array(n), shelter = new Float64Array(n);
  for (let i = 0; i < n; i++) { if (wet(i)) continue; for (let k = indptr[i]; k < indptr[i + 1]; k++) if (sea(indices[k])) { coast[i] = 1; break; } }
  const shelterR = Math.max(8, 4 * step);
  for (let i = 0; i < n; i++) if (coast[i]) { let a = 0, b = 0; within(x[i], y[i], shelterR, (j) => { b++; if (landMask[j]) a++; }); shelter[i] = Math.max(0, Math.min(1, (a / Math.max(1, b) - 0.45) / 0.35)); }
  // the settled land, from the places and roads that stay
  const items = [
    ...places.map((p) => ({ kind: "place", class: p.class, x: p.at[0], y: p.at[1] })),
    ...roads.map((r) => ({ kind: "way", class: r.class === "highway" ? "highway" : r.class === "track" || r.class === "path" ? r.class : "road", path: r.path })),
  ];
  const settled = settledField(land, items);
  // roads as nodes (the best class through each), and points along each road with the road they're on
  const RANK = { path: 1, track: 1, street: 2, highway: 3 };
  const roadClass = new Uint8Array(n), roadPts = [];
  const sampleStep = Math.max(0.2, (step * 0.5) / mpu);
  for (const r of roads) {
    const rank = RANK[r.class] ?? 2;
    let run = 0;
    for (let m = 1; m < r.path.length; m++) {
      const [ax, ay] = r.path[m - 1], [bx, by] = r.path[m], len = Math.hypot(bx - ax, by - ay), k = Math.max(1, Math.ceil(len / sampleStep));
      for (let q = m === 1 ? 0 : 1; q <= k; q++) {
        const p = [ax + ((bx - ax) * q) / k, ay + ((by - ay) * q) / k], i = nodeAt(p, (j) => !wet(j));
        if (i >= 0) roadClass[i] = Math.max(roadClass[i], rank);
        roadPts.push({ p, i, rank, road: r.id, miles: (run + (len * q) / k) * mpu });
      }
      run += len;
    }
  }
  // miles over the land to the nearest road, and to the nearest town or city (or village and hamlet: "people")
  const flood = (isSource) => {
    const d = new Float64Array(n).fill(Infinity), heap = new Heap(1024);
    for (let i = 0; i < n; i++) if (isSource(i)) { d[i] = 0; heap.push(0, i); }
    while (heap.size) { const i = heap.pop(); if (heap.lastKey > d[i]) continue; for (let k = indptr[i]; k < indptr[i + 1]; k++) { const j = indices[k]; if (wet(j)) continue; const c = d[i] + dist(i, j); if (c < d[j]) { d[j] = c; heap.push(c, j); } } }
    return d;
  };
  const roadMiles = flood((i) => roadClass[i] > 0);
  const townNodes = new Uint8Array(n), peopleNodes = new Uint8Array(n);
  for (const p of places) {
    const i = nodeAt(p.at, (j) => !wet(j));
    if (i < 0) continue;
    if (p.class === "city" || p.class === "town") townNodes[i] = 1;
    if (["city", "town", "village", "hamlet", "castle"].includes(p.class)) peopleNodes[i] = 1;
  }
  const townMiles = flood((i) => townNodes[i]), peopleMiles = flood((i) => peopleNodes[i]);
  // the realms' borders (as the layout grows them), when the plan has realms
  const realmList = features.filter((q) => q.type === "realm" && Array.isArray(q.at));
  let owner = null;
  if (realmList.length) {
    const rc = ["few", "some", "many"].includes(plan.land?.realms) ? plan.land.realms : "some";
    owner = growRealms(land, realmList.map((q) => ({ at: q.at })), { reach: realmReach(land, rc) }).owner;
  }
  const border = new Uint8Array(n), frontier = new Uint8Array(n);
  if (owner) for (let i = 0; i < n; i++) {
    if (owner[i] < 0) continue;
    for (let k = indptr[i]; k < indptr[i + 1]; k++) { const o = owner[indices[k]]; if (o >= 0 && o !== owner[i]) border[i] = 1; else if (o === -2) frontier[i] = 1; }
  }
  const inv = land.inventory ?? [];
  const passes = inv.filter((q) => q.kind === "pass").map((q) => nearest((q.x - M) / mpu, (q.y - M) / mpu, (j) => !wet(j))).filter((i) => i >= 0);
  const capes = inv.filter((q) => q.kind === "cape").map((q) => nearest((q.x - M) / mpu, (q.y - M) / mpu, (j) => coast[j] === 1)).filter((i) => i >= 0);
  const fertile = (i) => tri(rain[i], 0.3, 0.6, 1.4, 2.2) * tri(temp[i], 0.15, 0.32, 0.75, 0.92);
  const FOREST = new Set(["temperate-forest", "temperate-rainforest", "seasonal-forest", "rainforest", "taiga"]);
  const OPEN = new Set(["grassland", "shrubland", "cold-steppe", "savanna", "tundra"]);

  // ---- placing ----
  const landArea = (() => { let s = 0; for (let i = 0; i < n; i++) if (!wet(i) && inMap(i)) s += land.area?.[i] ?? 0; return s; })();
  const taken = places.map((p) => nodeAt(p.at, () => true)).filter((i) => i >= 0);
  const out = [];
  const gap = Math.max(1.5, 0.05 * sp.city);
  const free = (i, own, s) => taken.every((j) => dist(i, j) >= gap) && own.every((j) => dist(i, j) >= s);
  const targetOf = (kind) => { const K = SITE_KINDS[kind], s = sp.city * K.spacing; return Math.min(K.most, Math.round((landArea / (s * s * K.per)) * dens)); };
  // (the wild kinds this map takes, by its seed, among those its land has room for)
  const r = rng(seed, "sites", "wild");
  const wildOk = { wreck: capes.length > 0 || coast.some((c) => c), cove: coast.some((c) => c) };
  const wilds = r.shuffle(SITE_CLASSES.filter((k) => SITE_KINDS[k].wild && SITE_KINDS[k].scales.includes(scale) && wildOk[k] !== false));
  const wildTaken = new Set(wilds.slice(0, WILD_TAKES[count] ?? 4));
  if (wildTaken.has("barrow") && !wildTaken.has("stones") && wilds.includes("stones")) wildTaken.add("stones");
  const placeKind = (kind, score, { at = (i) => U(i), site = () => ({}), pad = 0.2 * sp.city * SITE_KINDS[kind].spacing, extra = () => true, nodes = null } = {}) => {
    if (!kinds.has(kind) || !SITE_KINDS[kind].scales.includes(scale) || (SITE_KINDS[kind].wild && !wildTaken.has(kind))) return;
    const count = targetOf(kind);
    if (count <= 0) return;
    const s = sp.city * SITE_KINDS[kind].spacing, jit = jitter(kind);
    const cand = [];
    for (const i of nodes ?? Array.from({ length: n }, (_, k) => k)) { const v = score(i); if (v > -Infinity && Number.isFinite(v)) cand.push([v + 0.15 * jit(i), i]); }
    cand.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    const own = [];
    for (const [, i] of cand) {
      if (own.length >= count) break;
      if (!inMap(i, pad) || !free(i, own, s) || !extra(i)) continue;
      own.push(i); taken.push(i);
      out.push({ kind, at: at(i), site: wet(i) ? { water: true, ...site(i) } : { biome: biomeOf(i), ground: h[i] < 0.16 ? "low" : h[i] < 0.45 ? "hills" : "high", ...(coast[i] ? { coast: seaBearing(i) } : {}), ...(riverNear(i) > 0 ? { riverside: true } : {}), ...site(i) } });
    }
  };
  const ok = (i) => !wet(i) && h[i] < 0.75;
  // (the way to the sea from a coast node, in degrees from north, as a town's site gives it)
  const seaBearing = (i) => { let sx = 0, sy = 0; for (let k = indptr[i]; k < indptr[i + 1]; k++) { const j = indices[k]; if (sea(j)) { sx += x[j] - x[i]; sy += y[j] - y[i]; } } return Math.round(((atan2(sx, -sy) * 180) / PI + 360) % 360); };

  // hamlets: farmed country between the villages, near a road
  placeKind("hamlet", (i) => (ok(i) && settled[i] > 0.3 && settled[i] < 0.85 && h[i] < 0.4 ? fertile(i) + 0.5 * settled[i] - 0.2 * slope[i] * 10 - (roadMiles[i] > 6 ? 1 : 0) : -Infinity));
  // inns: along the roads, a day's travel from towns and from each other, highways first
  {
    const kind = "inn";
    if (kinds.has(kind) && SITE_KINDS[kind].scales.includes(scale)) {
      const want = targetOf(kind), jit = jitter(kind), own = [];
      const s = Math.max(sp.city * SITE_KINDS[kind].spacing, DAY_MI * 0.8);
      const cand = roadPts.filter((q) => q.i >= 0 && q.rank >= 2 && townMiles[q.i] > 0.4 * DAY_MI && inMap(q.i, 1)).map((q) => ({ ...q, v: q.rank + Math.min(1, townMiles[q.i] / DAY_MI) + 0.3 * jit(q.i) })).sort((a, b) => b.v - a.v || a.i - b.i);
      for (const q of cand) {
        if (own.length >= want) break;
        if (!own.every((o) => Math.hypot(o.p[0] - q.p[0], o.p[1] - q.p[1]) * mpu >= s) || !taken.every((j) => dist(q.i, j) >= gap)) continue;
        own.push(q); taken.push(q.i);
        out.push({ kind, at: [Math.round(q.p[0] * 100) / 100, Math.round(q.p[1] * 100) / 100], site: { biome: biomeOf(q.i), ground: h[q.i] < 0.16 ? "low" : "hills", road: q.road } });
      }
    }
  }
  // (rock that shows: hard rock the GM painted, else steep ground in the hills)
  const rocky = (i) => Math.max(hard[i], clamp((h[i] - 0.1) / 0.25) * clamp(slope[i] / 0.06));
  // mines: rock in the hills, beside a river
  placeKind("mine", (i) => (ok(i) && h[i] > 0.12 && h[i] < 0.6 && rocky(i) > 0.35 && riverNear(i) > 0 ? 2 * rocky(i) + 0.5 * Math.min(1, prom[i] * 20) - Math.min(1, roadMiles[i] / (0.5 * sp.city)) : -Infinity));
  // quarries: rock on low hills near a road and a town
  placeKind("quarry", (i) => (ok(i) && h[i] > 0.06 && h[i] < 0.35 && rocky(i) > 0.2 && roadMiles[i] < 0.15 * sp.city ? 1.5 * rocky(i) + Math.max(0, 1 - townMiles[i] / (0.6 * sp.city)) : -Infinity));
  // watchtowers: on passes and border hilltops; else hilltops above the roads
  const passNear = new Uint8Array(n); for (const p of passes) within(x[p], y[p], Math.max(4, 3 * step), (j) => { passNear[j] = 1; });
  placeKind("tower", (i) => (ok(i) && h[i] > 0.06 && prom[i] > 0.01 ? 2 * passNear[i] + 1.5 * border[i] + 0.8 * frontier[i] + 10 * prom[i] + (roadMiles[i] < 0.1 * sp.city ? 0.6 : 0) : -Infinity), { site: (i) => ({ ...(passNear[i] ? { pass: true } : {}), ...(border[i] ? { border: true } : {}) }) });
  // forts: where a road crosses a border, at the foot of a pass on a road, or on the frontier with the wilds
  placeKind("fort", (i) => (ok(i) && h[i] < 0.55 && (border[i] || passNear[i] || frontier[i]) ? 1.5 * (border[i] && roadClass[i] ? 1 : 0) + 1.2 * (passNear[i] && roadMiles[i] < 0.1 * sp.city ? 1 : 0) + 0.8 * frontier[i] + 0.5 * border[i] + 5 * Math.max(0, prom[i]) : -Infinity), { site: (i) => ({ ...(border[i] ? { border: true } : {}), ...(passNear[i] ? { pass: true } : {}), ...(frontier[i] ? { frontier: true } : {}) }) });
  // shrines: hilltops above settled country
  placeKind("temple", (i) => (ok(i) && settled[i] > 0.15 && settled[i] < 0.7 && prom[i] > 0.005 ? 10 * prom[i] + 0.5 * settled[i] : -Infinity));
  // monasteries: high, gentle valleys far from towns, wet enough to farm a little
  placeKind("monastery", (i) => (ok(i) && h[i] > 0.18 && h[i] < 0.5 && slope[i] < 0.06 && rain[i] > 0.4 && biomeOf(i) !== "glacier" ? Math.min(1, townMiles[i] / (0.6 * sp.city)) + 2 * (h[i] - 0.18) - 5 * slope[i] + 0.3 * fertile(i) : -Infinity));
  // lighthouses: capes and harbor mouths near a town or city on the coast
  const capeNear = new Uint8Array(n); for (const c of capes) within(x[c], y[c], Math.max(3, 2 * step), (j) => { if (coast[j]) capeNear[j] = 1; });
  placeKind("lighthouse", (i) => (coast[i] && (capeNear[i] || (townMiles[i] < 0.25 * sp.city && shelter[i] < 0.5)) ? 1.5 * capeNear[i] + Math.max(0, 1 - townMiles[i] / (0.5 * sp.city)) + 5 * Math.max(0, prom[i]) + 0.5 * (1 - shelter[i]) : -Infinity));
  // customs houses: where a highway or road crosses a border, highways first
  {
    const kind = "customs";
    if (owner && kinds.has(kind) && SITE_KINDS[kind].scales.includes(scale)) {
      const want = targetOf(kind), own = [], s = sp.city * SITE_KINDS[kind].spacing, cross = [];
      for (let k = 1; k < roadPts.length; k++) {
        const a = roadPts[k - 1], b = roadPts[k];
        if (a.road !== b.road || a.rank < 2 || a.i < 0 || b.i < 0 || owner[a.i] < 0 || owner[b.i] < 0 || owner[a.i] === owner[b.i] || !inMap(b.i, 1)) continue;
        cross.push(b);
      }
      cross.sort((p, q) => q.rank - p.rank || p.i - q.i);
      for (const b of cross) {
        if (own.length >= want) break;
        if (!own.every((o) => Math.hypot(o[0] - b.p[0], o[1] - b.p[1]) * mpu >= s) || !taken.every((j) => dist(b.i, j) >= gap)) continue;
        own.push(b.p); taken.push(b.i);
        out.push({ kind, at: [Math.round(b.p[0] * 100) / 100, Math.round(b.p[1] * 100) / 100], site: { biome: biomeOf(b.i), ground: "low", border: true, road: b.road } });
      }
    }
  }
  // battlefields: open, gentle ground on a border
  if (owner) placeKind("battlefield", (i) => (ok(i) && border[i] && h[i] < 0.3 && slope[i] < 0.04 && !FOREST.has(biomeOf(i)) ? 1 - 10 * slope[i] + 0.3 * settled[i] : -Infinity), { site: () => ({ border: true }) });

  // ---- the wilds (a few kinds a map, by its seed) ----
  // standing stones: hilltops on open downs; barrows near them along the ridges
  placeKind("stones", (i) => (ok(i) && OPEN.has(biomeOf(i)) && h[i] > 0.04 && h[i] < 0.35 && settled[i] < 0.5 ? 10 * prom[i] + 0.3 * (1 - settled[i]) : -Infinity));
  const stones = out.filter((s) => s.kind === "stones").map((s) => nodeAt(s.at, () => true));
  placeKind("barrow", (i) => (ok(i) && !FOREST.has(biomeOf(i)) && h[i] > 0.03 && h[i] < 0.4 && settled[i] < 0.6 ? 6 * prom[i] + (stones.some((j) => dist(i, j) < 0.4 * sp.city) ? 1.5 : 0) : -Infinity));
  // shipwrecks: off a rocky cape or a steep coast, in the shallows
  placeKind("wreck", (i) => {
    if (!sea(i)) return -Infinity;
    let land1 = -1; for (let k = indptr[i]; k < indptr[i + 1]; k++) if (coast[indices[k]]) { land1 = indices[k]; break; }
    if (land1 < 0) return -Infinity;
    return 1.5 * capeNear[land1] + 10 * Math.max(0, h[land1] - 0.05) + 0.5 * (1 - shelter[land1]);
  });
  // lairs: the deepest wilds, forest, mountains or marsh, far from people and roads
  placeKind("lair", (i) => (ok(i) && settled[i] < 0.05 ? Math.min(1.5, peopleMiles[i] / (0.4 * sp.city)) + Math.min(1, roadMiles[i] / (0.3 * sp.city)) + (FOREST.has(biomeOf(i)) || biomeOf(i) === "wetland" ? 0.4 : 0) + (h[i] > 0.35 ? 0.4 : 0) : -Infinity));
  // caves: steep hillsides in quiet country
  placeKind("cave", (i) => (ok(i) && h[i] > 0.12 && h[i] < 0.6 && settled[i] < 0.3 && slope[i] > 0.03 ? 8 * slope[i] + 0.5 * Math.min(1, roadMiles[i] / (0.2 * sp.city)) : -Infinity));
  // sacred groves: in a forest's uncleared wood, near the farms at its edge
  placeKind("grove", (i) => (ok(i) && FOREST.has(biomeOf(i)) && settled[i] > 0.05 && settled[i] < 0.3 ? 1 - Math.abs(settled[i] - 0.18) * 4 + 0.3 * fertile(i) : -Infinity), { site: (i) => ({ forest: biomeOf(i) }) });
  // brigands: on a road far from any town, in forest or hills
  placeKind("camp", (i) => (ok(i) && roadClass[i] >= 1 && townMiles[i] > 0.5 * DAY_MI ? Math.min(1.5, townMiles[i] / DAY_MI) + (FOREST.has(biomeOf(i)) ? 0.5 : 0) + (h[i] > 0.2 ? 0.4 : 0) - settled[i] : -Infinity));
  // pirates: a sheltered cove far from towns
  placeKind("cove", (i) => (coast[i] && shelter[i] > 0.3 && settled[i] < 0.3 ? shelter[i] + Math.min(1, townMiles[i] / (0.5 * sp.city)) : -Infinity));
  // monsters: one haunt each, a great lake, the open sea off the coast, or the wild hills
  {
    const lakeDeep = new Float64Array(n);
    for (let i = 0; i < n; i++) if (landMask[i] && lake[i] === 1) { let s = 0; for (let k = indptr[i]; k < indptr[i + 1]; k++) if (lake[indices[k]] === 1) s++; lakeDeep[i] = s / Math.max(1, indptr[i + 1] - indptr[i]); }
    const offshore = new Float64Array(n);
    // (open sea a little way off the coast: coast within four steps, none within one and a half)
    for (let i = 0; i < n; i++) if (sea(i)) { let far = 0, close = 0; within(x[i], y[i], 4 * step, (j) => { if (coast[j]) far = 1; }); if (far) within(x[i], y[i], 1.5 * step, (j) => { if (coast[j]) close = 1; }); offshore[i] = far && !close ? 1 : 0; }
    const habitat = (i) => (lake[i] === 1 && landMask[i] ? "lake" : sea(i) ? "sea" : "hills");
    placeKind("monster", (i) => (lakeDeep[i] > 0.99 ? 2.2 : offshore[i] ? 1.4 : ok(i) && h[i] > 0.25 && settled[i] < 0.05 ? 1 + 4 * prom[i] : -Infinity), { site: (i) => ({ habitat: habitat(i) }) });
  }
  return out;
}

function clamp(v, a = 0, b = 1) { return v < a ? a : v > b ? b : v; }
/** 0 below a, rising to 1 at b, 1 to c, falling to 0 at d. */
function tri(v, a, b, c, d) { return v <= a || v >= d ? 0 : v < b ? (v - a) / (b - a) : v <= c ? 1 : (d - v) / (d - c); }
