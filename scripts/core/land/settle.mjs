/**
 * Places, roads and crossings on generated land, where people would put them: cities on
 * the best sites (big rivers, confluences, river mouths, sheltered harbors, fertile low ground), highways between
 * them, towns where the highways and rivers make them (crossroads, crossings, the foot of a pass), roads to the
 * towns, villages on good land near the roads with tracks to them, castles on prominent ground near passes,
 * crossings and coasts, a few ruins on poor land. Roads take the least costly way over the land (steep ground,
 * marsh and ice dear, a river crossing by its size, a road already built cheap, so roads merge into trunks); a few
 * cities beyond the map's edge (in the land's context margin) send highways off the map. Each place records its
 * site (its river's size and bearings, the coast's bearing, its roads' bearings, its biome and ground) for Make this
 * town. Places the plan already has are kept where they are (the new ones keep their spacing from them and the
 * roads join them). The result is plan features: the plan keeps them, so they don't move when the generator changes.
 * Pure.
 */
import { Heap } from "./heap.mjs";
import { log, atan2, pow, PI } from "./dmath.mjs";
import { BIOMES } from "./biome.mjs";
import { rng } from "../rng.mjs";

/** The numbers the placer works by. Distances in miles; a map's spacings grow with its size (see spacingsOf). */
export const SETTLE = {
  // how many places, by the Places choice
  density: { few: 0.6, some: 1, many: 1.6 },
  // the miles between cities on a kingdom (240 mi across); a bigger map's grow as its size to the 0.75
  city: 55,
  // other places' spacing as a share of the cities'
  share: { town: 0.42, village: 0.19, castle: 0.36, ruin: 0.55 },
  // land area (square miles of the map's land) per place, in squared spacings: fewer the higher
  per: { city: 2.6, town: 3.4, village: 5.5 },
  // most of each
  most: { city: 40, town: 90, village: 160, castle: 30, ruin: 12 },
  // heights in the land's units: 1 is high mountains (about 5 km, 3.1 mi); places stay below `high`
  high: 0.5, mi: 3.1,
  // road cost: grade (rise over run) squared times this; a road already built at this share; crossing a river
  grade: 40, reuse: 0.5,
  // a detour link where the network's way is this many times the straight line
  detour: 1.6,
};
const CLASS_OF = ["", "track", "street", "highway"];
const BIOME_COST = { glacier: 8, tundra: 0.6, taiga: 0.3, "cold-steppe": 0, "temperate-forest": 0.25, "temperate-rainforest": 0.6, grassland: 0, shrubland: 0.1, "hot-desert": 0.6, savanna: 0, "seasonal-forest": 0.3, rainforest: 1, wetland: 2, "salt-flat": 0.3 };
const BIOME_BAD = { glacier: 4, "salt-flat": 2.5, tundra: 1, "hot-desert": 1, wetland: 0.7 };

/** The miles between places of each kind on a map whose longer side is `longMi`. */
export function spacingsOf(longMi) {
  const city = SETTLE.city * pow(Math.max(60, longMi) / 240, 0.75);
  const out = { city };
  for (const [k, s] of Object.entries(SETTLE.share)) out[k] = city * s;
  return out;
}

/**
 * Places, roads and crossings for an overland plan. land: the layout's compact land (layout.land); plan: the
 * normalized plan (its size, seed and any places it already has). density: few, some or many; reserve: ids not to give out. Returns { features,
 * notes, stats }: features are new plan features in map units (places with `site`, roads, crossings), ids `city-1`,
 * `road-1`... clear of the plan's own ids.
 */
export function settle(land, plan, { density = "some", seed = plan?.seed ?? 1, reserve = [] } = {}) {
  const { n, x, y, indptr, indices, h, landMask, lake, rain, temp, F, threshold: T } = land;
  const f = land.frame, mpu = f.mpu, M = f.margin;
  const MW = f.mapW / mpu, MH = f.mapH / mpu;
  const sp = spacingsOf(Math.max(f.mapW, f.mapH));
  const dens = SETTLE.density[density] ?? 1;
  const village = f.scale === "kingdom" || f.scale === "realm";
  // (a small seeded jitter per node, so Reroll places can move them)
  const salt = 1 + rng(seed, "settle").int(2147483645);
  const jit = (i, k) => { let v = Math.imul(i + 1, 2654435761) ^ Math.imul(salt + k, 1597334677); v = Math.imul(v ^ (v >>> 15), 2246822507); v = Math.imul(v ^ (v >>> 13), 3266489909); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
  const notes = [];
  const sq = (v) => v * v;
  const dist = (i, j) => Math.sqrt(sq(x[i] - x[j]) + sq(y[i] - y[j]));
  const U = (i) => [(x[i] - M) / mpu, (y[i] - M) / mpu];
  const wet = (i) => !landMask[i] || lake[i];
  const inMap = (i, pad = 0) => x[i] >= M + pad && y[i] >= M + pad && x[i] <= M + f.mapW - pad && y[i] <= M + f.mapH - pad;
  const biomeOf = (i) => BIOMES[land.biome[i]] ?? null;
  const step = land.spacing;

  // ---- what each node offers ----
  // drawn rivers: the flow at each river node, the river it is on; junctions (where a river joins another) and
  // mouths (where a river meets the sea)
  const riverF = new Float64Array(n), riverId = new Int32Array(n).fill(-1), junction = new Uint8Array(n), mouth = new Uint8Array(n);
  for (const R of land.rivers) {
    const nodes = R.nodes ?? [];
    for (let k = 0; k < nodes.length; k++) { const i = nodes[k]; if (F[i] > riverF[i]) { riverF[i] = F[i]; riverId[i] = R.id; } }
    if (R.to >= 0 && R.ends === "river") junction[R.to] = 1;
    if (R.ends === "sea" && nodes.length) { mouth[nodes[nodes.length - 1]] = 1; if (nodes.length > 1) mouth[nodes[nodes.length - 2]] = 1; }
  }
  // a spatial grid of nodes, for "within so many miles" questions
  const cell = Math.max(step * 2, 1e-6), gw = Math.ceil(f.W / cell) + 1, gh = Math.ceil(f.H / cell) + 1;
  const bucket = new Int32Array(gw * gh + 1), order = new Int32Array(n);
  for (let i = 0; i < n; i++) bucket[Math.min(gw - 1, Math.floor(x[i] / cell)) + Math.min(gh - 1, Math.floor(y[i] / cell)) * gw + 1]++;
  for (let c = 1; c <= gw * gh; c++) bucket[c] += bucket[c - 1];
  { const fill = bucket.slice(0, gw * gh); for (let i = 0; i < n; i++) { const c = Math.min(gw - 1, Math.floor(x[i] / cell)) + Math.min(gh - 1, Math.floor(y[i] / cell)) * gw; order[fill[c]++] = i; } }
  const within = (px, py, rad, fn) => {
    const c0 = Math.max(0, Math.floor((px - rad) / cell)), c1 = Math.min(gw - 1, Math.floor((px + rad) / cell));
    const r0 = Math.max(0, Math.floor((py - rad) / cell)), r1 = Math.min(gh - 1, Math.floor((py + rad) / cell));
    for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) { const b = cc + rr * gw; for (let k = bucket[b]; k < bucket[b + 1]; k++) { const j = order[k]; if (sq(x[j] - px) + sq(y[j] - py) <= rad * rad) fn(j); } }
  };
  const nearest = (px, py) => { let best = -1, bd = Infinity; within(px, py, cell * 1.5, (j) => { const d = sq(x[j] - px) + sq(y[j] - py); if (d < bd || (d === bd && j < best)) { bd = d; best = j; } }); return best; };
  const markNear = (pts, rad) => { const m = new Uint8Array(n); for (const [px, py] of pts) within(px, py, rad, (j) => { m[j] = 1; }); return m; };
  const heads = markNear(land.marks?.heads ?? [], 2 * step), lowBridges = markNear(land.marks?.bridges ?? [], 2 * step);
  // coast: land beside the sea; shore: beside a lake; shelter: how much land is around a coast node (a bay)
  const coast = new Uint8Array(n), shore = new Uint8Array(n), slope = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (wet(i)) continue;
    let s = 0;
    for (let k = indptr[i]; k < indptr[i + 1]; k++) { const j = indices[k]; if (!landMask[j]) coast[i] = 1; else if (lake[j]) shore[i] = 1; s = Math.max(s, Math.abs(h[i] - h[j]) / Math.max(1e-9, dist(i, j))); }
    slope[i] = s;
  }
  const shelter = new Float64Array(n), shelterR = Math.max(10, 4 * step);
  for (let i = 0; i < n; i++) if (coast[i]) { let a = 0, b = 0; within(x[i], y[i], shelterR, (j) => { b++; if (landMask[j]) a++; }); shelter[i] = clamp((a / Math.max(1, b) - 0.45) / 0.35); }
  // (flat by the land's own slopes: half its land's median slope is flat, twice it steep)
  const landSlopes = []; for (let i = 0; i < n; i++) if (!wet(i)) landSlopes.push(slope[i]);
  landSlopes.sort((a, b) => a - b);
  const medSlope = Math.max(1e-9, landSlopes.length ? landSlopes[landSlopes.length >> 1] : 1);
  const near1 = (arr, i) => { if (arr[i]) return 1; for (let k = indptr[i]; k < indptr[i + 1]; k++) if (arr[indices[k]]) return 1; return 0; };
  const flowNear = (i) => { let v = riverF[i]; for (let k = indptr[i]; k < indptr[i + 1]; k++) v = Math.max(v, riverF[indices[k]]); return v; };
  const fertOf = (i) => tri(rain[i], 0.3, 0.6, 1.4, 2.2) * tri(temp[i], 0.15, 0.32, 0.75, 0.92);

  // the base site score: river size, confluence, mouth, head of navigation, lowest bridging point, a sheltered
  // harbor, a lake shore, fertile, flat, low; minus ice, salt, tundra, desert without a river, marsh
  const base = new Float64Array(n).fill(-Infinity), fert = new Float64Array(n), flat = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (wet(i) || h[i] > SETTLE.high) continue;
    const fl = flowNear(i), riv = fl > 0 ? clamp(log(fl / T + 1) / log(40)) : 0;
    fert[i] = fertOf(i);
    flat[i] = clamp(1 - slope[i] / (2 * medSlope));
    const bio = biomeOf(i), bad = (BIOME_BAD[bio] ?? 0) * (bio === "hot-desert" && riv > 0 ? 0.2 : 1);
    base[i] = 1.4 * riv + 0.8 * near1(junction, i) + 0.6 * near1(mouth, i) + 0.7 * heads[i] + 0.5 * lowBridges[i]
      + coast[i] * (0.45 + 0.75 * shelter[i]) + 0.5 * shore[i] + 0.8 * fert[i] + 0.6 * flat[i] + 0.5 * clamp(1 - h[i] / 0.3) - bad
      + 0.25 * jit(i, 1);
  }

  // ---- roads: a network on the graph's edges, each edge the highest class run along it ----
  const E = indices.length, edgeClass = new Uint8Array(E), nodeClass = new Uint8Array(n), rev = new Int32Array(E);
  for (let i = 0; i < n; i++) for (let k = indptr[i]; k < indptr[i + 1]; k++) { const j = indices[k]; for (let q = indptr[j]; q < indptr[j + 1]; q++) if (indices[q] === i) { rev[k] = q; break; } }
  const g = new Float64Array(n), prev = new Int32Array(n), stamp = new Int32Array(n), heap = new Heap(4096);
  let gen = 0;
  const edgeCost = (i, k) => {
    const j = indices[k];
    if (wet(j)) return Infinity;
    const d = dist(i, j), grade = ((h[j] - h[i]) * SETTLE.mi) / Math.max(1e-9, d);
    let c = d * (1 + SETTLE.grade * grade * grade + (BIOME_COST[biomeOf(j)] ?? 0) + (h[j] > 0.55 ? 1.5 : 0));
    // (along one river cheap; onto a river from the land or from another river, the price of crossing it)
    if (riverF[j] > 0) c += riverF[i] > 0 && riverId[i] === riverId[j] ? 0.5 * d : step * 1.5 * (1 + log(riverF[j] / T + 1));
    if (edgeClass[k]) c *= edgeClass[k] === 3 ? SETTLE.reuse * 0.9 : SETTLE.reuse;
    return c;
  };
  // least cost from a node to a goal node (A*), or to any node `isGoal` says (Dijkstra); null past `most`
  const route = (src, goal, { isGoal = null, most = Infinity } = {}) => {
    gen++;
    const hx = goal >= 0 ? x[goal] : 0, hy = goal >= 0 ? y[goal] : 0;
    const hEst = (j) => (goal >= 0 ? 0.44 * Math.sqrt(sq(x[j] - hx) + sq(y[j] - hy)) : 0);
    heap.clear(); g[src] = 0; prev[src] = -1; stamp[src] = gen; heap.push(hEst(src), src);
    while (heap.size) {
      const i = heap.pop();
      const gi = g[i];
      if (heap.lastKey - hEst(i) > gi + 1e-9) continue;
      if (gi > most) return null;
      if (i !== src && (i === goal || (isGoal && isGoal(i)))) { const path = []; for (let k = i; k >= 0; k = prev[k]) path.push(k); return path.reverse(); }
      for (let k = indptr[i]; k < indptr[i + 1]; k++) {
        const j = indices[k], c = gi + edgeCost(i, k);
        if (c === Infinity) continue;
        if (stamp[j] !== gen || c < g[j]) { stamp[j] = gen; g[j] = c; prev[j] = i; heap.push(c + hEst(j), j); }
      }
    }
    return null;
  };
  const lay = (path, cls) => {
    if (!path) return false;
    for (let m = 1; m < path.length; m++) {
      const i = path[m - 1], j = path[m];
      for (let k = indptr[i]; k < indptr[i + 1]; k++) if (indices[k] === j) { if (cls > edgeClass[k]) { edgeClass[k] = cls; edgeClass[rev[k]] = cls; } break; }
    }
    for (const i of path) nodeClass[i] = Math.max(nodeClass[i], cls);
    return true;
  };
  // miles along the network from a node to every other (roads of class `least` or better)
  const networkFrom = (src, least = 1) => {
    const d = new Float64Array(n).fill(Infinity);
    heap.clear(); d[src] = 0; heap.push(0, src);
    while (heap.size) {
      const i = heap.pop(); if (heap.lastKey > d[i] + 1e-9) continue;
      for (let k = indptr[i]; k < indptr[i + 1]; k++) { if (edgeClass[k] < least) continue; const j = indices[k], c = d[i] + dist(i, j); if (c < d[j]) { d[j] = c; heap.push(c, j); } }
    }
    return (j) => d[j];
  };
  // landmasses (land without lakes, joined through the graph), so a road network can be made whole on each
  const landmass = new Int32Array(n).fill(-1);
  { let c = 0; const st = []; for (let s0 = 0; s0 < n; s0++) { if (landmass[s0] >= 0 || wet(s0)) continue; landmass[s0] = c; st.push(s0); while (st.length) { const i = st.pop(); for (let k = indptr[i]; k < indptr[i + 1]; k++) { const j = indices[k]; if (landmass[j] < 0 && !wet(j)) { landmass[j] = c; st.push(j); } } } c++; } }
  // every city and town joined to its landmass's network: one not on a road gets a road to the nearest; then each
  // separate network on a landmass (a tree edge that crossed water) joined to the biggest
  const joinLandmasses = (sites) => {
    const siteAt = new Set(sites.map((p) => p.node));
    for (const p of sites) if (!nodeClass[p.node] && sites.some((q) => q !== p && landmass[q.node] === landmass[p.node])) {
      // (to the nearest road on its land, or the nearest city or town there when there's no road yet)
      const lm = landmass[p.node];
      lay(route(p.node, -1, { isGoal: (i) => landmass[i] === lm && (nodeClass[i] >= 2 || siteAt.has(i)) }), 2);
    }
    for (let pass = 0; pass < 8; pass++) {
      // (road networks by flood over road edges)
      const net = new Int32Array(n).fill(-1); let c = 0;
      for (let s0 = 0; s0 < n; s0++) { if (net[s0] >= 0 || !nodeClass[s0]) continue; const st = [s0]; net[s0] = c; while (st.length) { const i = st.pop(); for (let k = indptr[i]; k < indptr[i + 1]; k++) if (edgeClass[k] && net[indices[k]] < 0) { net[indices[k]] = c; st.push(indices[k]); } } c++; }
      let joined = false;
      const lms = [...new Set(sites.map((p) => landmass[p.node]))].sort((a, b) => a - b);
      for (const lm of lms) {
        const here = sites.filter((p) => landmass[p.node] === lm && net[p.node] >= 0);
        const nets = [...new Set(here.map((p) => net[p.node]))];
        if (nets.length < 2) continue;
        const size = (k) => here.filter((p) => net[p.node] === k).length;
        nets.sort((a, b) => size(b) - size(a) || a - b);
        const main = nets[0], from = here.find((p) => net[p.node] === nets[nets.length - 1]);
        if (lay(route(from.node, -1, { isGoal: (i) => net[i] === main }), 2)) joined = true;
      }
      if (!joined) break;
    }
  };
  // a minimum spanning tree over sites by straight distance (Prim, ties by index), one per landmass so no link
  // crosses water, as [a, b, miles] index pairs into sites
  const spanning = (sites) => {
    const out = [];
    const lands = [...new Set(sites.map((p) => landmass[p.node]))].sort((a, b) => a - b);
    for (const lm of lands) {
      const ks = sites.map((_, k) => k).filter((k) => landmass[sites[k].node] === lm);
      const inT = [ks[0]], left = new Set(ks.slice(1));
      while (left.size) {
        let best = null;
        for (const a of inT) for (const b of left) { const d = dist(sites[a].node, sites[b].node); if (!best || d < best.d - 1e-12 || (Math.abs(d - best.d) <= 1e-12 && (a < best.a || (a === best.a && b < best.b)))) best = { a, b, d }; }
        out.push([best.a, best.b, best.d]); inT.push(best.b); left.delete(best.b);
      }
    }
    return out;
  };
  // links where the network's way around is much longer than the straight line
  const detours = (sites, reach, cls) => {
    for (let a = 0; a < sites.length; a++) {
      const net = networkFrom(sites[a].node);
      for (let b = a + 1; b < sites.length; b++) {
        const d = dist(sites[a].node, sites[b].node);
        if (d > reach || net(sites[b].node) <= SETTLE.detour * 1.15 * d) continue;
        // (the network changes, so later pairs from a see this link only on the next site's pass)
        lay(route(sites[a].node, sites[b].node), cls);
      }
    }
  };

  // ---- places, interleaved with the roads ----
  // (the plan's own places first: kept as they are, counted against the new ones' spacing, joined by the roads)
  const SPACING_OF = { city: sp.city, town: sp.town, castle: sp.castle, ruin: sp.village * 1.2 };
  const places = [];
  for (const q of plan?.features ?? []) {
    if (q?.type !== "place" || !Array.isArray(q.at) || !Number.isFinite(q.at[0]) || !Number.isFinite(q.at[1])) continue;
    const i = nearest(q.at[0] * mpu + M, q.at[1] * mpu + M);
    if (i >= 0 && !wet(i)) places.push({ kind: q.class, node: i, spacing: SPACING_OF[q.class] ?? sp.village, given: q.id, at: [q.at[0], q.at[1]] });
  }
  const givenOf = (kind) => places.filter((p) => p.given && p.kind === kind);
  // (each node's share of the land: a third of each triangle it's a corner of)
  const landArea = (() => {
    const t = land.triangles, area = new Float64Array(n);
    for (let k = 0; k + 2 < t.length; k += 3) { const a = t[k], b = t[k + 1], c = t[k + 2]; const A = Math.abs((x[b] - x[a]) * (y[c] - y[a]) - (x[c] - x[a]) * (y[b] - y[a])) / 6; area[a] += A; area[b] += A; area[c] += A; }
    let s = 0; for (let i = 0; i < n; i++) if (!wet(i) && inMap(i)) s += area[i];
    return s;
  })();
  const target = (kind, s) => Math.min(SETTLE.most[kind], Math.max(kind === "city" ? 1 : 0, Math.round((landArea / (s * s * SETTLE.per[kind])) * dens)));
  const ranked = (score) => { const o = []; for (let i = 0; i < n; i++) if (score[i] > -Infinity) o.push(i); return o.sort((a, b) => score[b] - score[a] || a - b); };
  const roomFor = (i, s, list = places) => list.every((p) => dist(p.node, i) >= s);
  const take = (kind, score, count, s, pad, extra = () => true) => {
    const got = [];
    for (const i of ranked(score)) {
      if (got.length >= count) break;
      if (!inMap(i, pad) || !roomFor(i, s) || !extra(i)) continue;
      const p = { kind, node: i, spacing: s }; places.push(p); got.push(p);
    }
    return got;
  };
  // cities, and beyond the map's edge a few more that send highways off it (in the land's margin, not kept)
  const cities = [...givenOf("city"), ...take("city", base, Math.max(0, target("city", sp.city) - givenOf("city").length), sp.city, Math.min(0.5 * sp.city, 0.12 * Math.min(f.mapW, f.mapH)))];
  if (!cities.length) notes.push({ level: "info", id: null, message: "No site on this land was fit for a city (too little dry, low land)." });
  const beyond = [];
  if (M > 0) for (const i of ranked(base)) {
    if (beyond.length >= 6) break;
    if (inMap(i) || !roomFor(i, sp.city, [...places, ...beyond])) continue;
    // (near enough the map that its road would come in: within a city spacing of the edge)
    const dx = Math.max(M - x[i], 0, x[i] - (M + f.mapW)), dy = Math.max(M - y[i], 0, y[i] - (M + f.mapH));
    if (Math.sqrt(dx * dx + dy * dy) > Math.min(M * 0.9, sp.city)) continue;
    beyond.push({ kind: "beyond", node: i, spacing: sp.city });
  }
  // highways: a tree over the cities, routed shortest first, then links that save a long way around, then each
  // city beyond the edge to its nearest city
  for (const [a, b] of spanning(cities).sort((p, q) => p[2] - q[2] || p[0] - q[0])) lay(route(cities[a].node, cities[b].node), 3);
  detours(cities, 2.4 * sp.city, 3);
  for (const o of beyond) {
    let best = null; for (const c of cities) { const d = dist(o.node, c.node); if (d < 2.5 * sp.city && (!best || d < best.d)) best = { c, d }; }
    if (best) lay(route(best.c.node, o.node), 3);
  }
  // towns: rescored with the highways (on one, a junction, where one crosses a river, the foot of a pass)
  const deg = (i) => { let c = 0; for (let k = indptr[i]; k < indptr[i + 1]; k++) if (edgeClass[k]) c++; return c; };
  const passes = (land.inventory ?? []).filter((q) => q.kind === "pass");
  const passFoot = markNear(passes.map((q) => [q.x, q.y]), 3 * step + 0.15 * sp.town);
  const townScore = new Float64Array(n).fill(-Infinity), hw = nodeClass.map((c) => (c === 3 ? 1 : 0));
  for (let i = 0; i < n; i++) {
    if (base[i] === -Infinity) continue;
    const onHw = near1(hw, i);
    townScore[i] = base[i] + 0.9 * (nodeClass[i] === 3 ? 1 : onHw * 0.7) + (nodeClass[i] && deg(i) >= 3 ? 0.6 : 0) + (nodeClass[i] && riverF[i] > 0 ? 0.5 : 0) + 0.4 * passFoot[i];
  }
  const towns = [...givenOf("town"), ...take("town", townScore, Math.max(0, target("town", sp.town) - givenOf("town").length), sp.town, 0.25 * sp.town)];
  // roads: a tree over cities and towns (what the highways already join costs little), then detour links
  const major = [...cities, ...towns];
  for (const [a, b] of spanning(major).sort((p, q) => p[2] - q[2] || p[0] - q[0])) {
    const A = major[a], B = major[b];
    lay(route(A.node, B.node), A.kind === "city" && B.kind === "city" ? 3 : 2);
  }
  detours(major, 2.2 * sp.town, 2);
  joinLandmasses(major);
  // villages (kingdom and realm): good land near the roads, a track to the nearest road
  const roadMiles = (() => {
    const d = new Float64Array(n).fill(Infinity); heap.clear();
    for (let i = 0; i < n; i++) if (nodeClass[i]) { d[i] = 0; heap.push(0, i); }
    while (heap.size) { const i = heap.pop(); if (heap.lastKey > d[i]) continue; for (let k = indptr[i]; k < indptr[i + 1]; k++) { const j = indices[k]; if (wet(j)) continue; const c = d[i] + dist(i, j); if (c < d[j]) { d[j] = c; heap.push(c, j); } } }
    return d;
  })();
  const tracksTo = (p, reach) => {
    if (nodeClass[p.node]) return;
    const path = route(p.node, -1, { isGoal: (i) => nodeClass[i] > 0, most: reach });
    // (and no longer than its reach in miles: a long track over cheap ground is no track to a village)
    if (path && path.reduce((s, i, m) => s + (m ? dist(path[m - 1], i) : 0), 0) <= reach) lay(path, 1);
  };
  let villages = [];
  if (village) {
    const vs = new Float64Array(n).fill(-Infinity);
    for (let i = 0; i < n; i++) if (base[i] > -Infinity) vs[i] = 0.6 * base[i] + 0.9 * fert[i] + 0.8 * clamp(1 - roadMiles[i] / (1.5 * sp.village)) - (BIOME_BAD[biomeOf(i)] ?? 0);
    villages = take("village", vs, target("village", sp.village), sp.village, 0.3 * sp.village);
    for (const v of villages) tracksTo(v, 3 * sp.village);
  }
  // castles: prominent ground near passes, crossings and coasts, within reach of a city or town
  const promR = Math.max(8, 4 * step), prom = new Float64Array(n);
  for (let i = 0; i < n; i++) { if (wet(i) || h[i] < 0.06 || h[i] > 0.62) continue; let s = 0, c = 0; within(x[i], y[i], promR, (j) => { if (landMask[j]) { s += h[j]; c++; } }); prom[i] = h[i] - s / Math.max(1, c); }
  const crossings = new Uint8Array(n); for (let i = 0; i < n; i++) if (nodeClass[i] >= 2 && riverF[i] > 0) crossings[i] = 1;
  const nearCross = markNear([...Array(n).keys()].filter((i) => crossings[i]).map((i) => [x[i], y[i]]), promR);
  const capes = markNear((land.inventory ?? []).filter((q) => q.kind === "cape").map((q) => [q.x, q.y]), promR);
  const cs = new Float64Array(n).fill(-Infinity);
  for (let i = 0; i < n; i++) if (prom[i] > 0.025 && !wet(i)) cs[i] = 5 * prom[i] + 0.6 * passFoot[i] + 0.5 * nearCross[i] + 0.4 * capes[i] + 0.3 * coast[i] + 0.1 * jit(i, 2);
  const castleCount = Math.min(SETTLE.most.castle, Math.round((cities.length * 0.8 + towns.length * 0.15) * dens));
  const castles = take("castle", cs, castleCount, sp.castle, 0.3 * sp.castle, (i) => major.some((p) => dist(p.node, i) < 2 * sp.town + 0.5 * sp.city));
  for (const c of castles) tracksTo(c, 2 * sp.town);
  for (const p of places.filter((q) => q.given && q.kind !== "city" && q.kind !== "town")) tracksTo(p, 2 * sp.town);
  // ruins: a few on poor land away from the roads
  const rs = new Float64Array(n).fill(-Infinity);
  for (let i = 0; i < n; i++) if (!wet(i) && h[i] < 0.6 && biomeOf(i) !== "glacier") rs[i] = clamp(roadMiles[i] / sp.town) + 0.6 * (1 - fertOf(i)) + 2 * Math.max(0, prom[i]) + 0.3 * jit(i, 3);
  // (kept a village's spacing from other places, a ruin's from each other)
  const ruinList = [];
  const ruins = take("ruin", rs, Math.min(SETTLE.most.ruin, Math.round(Math.max(1, cities.length * 0.7) * dens)), 1.2 * sp.village, 0.3 * sp.ruin, (i) => {
    if (!ruinList.every((p) => dist(p, i) >= sp.ruin)) return false;
    ruinList.push(i); return true;
  });

  // ---- the roads as lines: runs of one class between junctions, ends and places ----
  const isPlace = new Uint8Array(n);
  for (const p of places) isPlace[p.node] = 1;
  // (a link into a city or town is never pruned; one into a village or castle may be, the network still reaching it)
  const isMajor = new Uint8Array(n);
  for (const p of major) isMajor[p.node] = 1;
  const extract = () => {
    const isStop = Uint8Array.from(isPlace);
    for (let i = 0; i < n; i++) {
      if (!nodeClass[i]) continue;
      let c = 0, cls = -1, mixed = false;
      for (let k = indptr[i]; k < indptr[i + 1]; k++) if (edgeClass[k]) { c++; if (cls >= 0 && edgeClass[k] !== cls) mixed = true; cls = edgeClass[k]; }
      if (c !== 2 || mixed) isStop[i] = 1;
    }
    const done = new Uint8Array(E), out = [];
    const walk = (i, k) => {
      const cls = edgeClass[k], nodes = [i], ks = [];
      let a = i, kk = k;
      for (;;) {
        done[kk] = 1; done[rev[kk]] = 1; ks.push(kk);
        const b = indices[kk]; nodes.push(b);
        if (isStop[b]) break;
        let next = -1;
        for (let q = indptr[b]; q < indptr[b + 1]; q++) if (edgeClass[q] === cls && !done[q] && indices[q] !== a) { next = q; break; }
        if (next < 0) break;
        a = b; kk = next;
      }
      out.push({ cls, nodes, ks });
    };
    for (let i = 0; i < n; i++) if (isStop[i] && nodeClass[i]) for (let k = indptr[i]; k < indptr[i + 1]; k++) if (edgeClass[k] && !done[k]) walk(i, k);
    // (loops with no stop on them)
    for (let i = 0; i < n; i++) for (let k = indptr[i]; k < indptr[i + 1]; k++) if (edgeClass[k] && !done[k]) walk(i, k);
    return out;
  };
  // short links between two junctions (not places) that the network already joins nearly as well: the little
  // triangles two roads leave where they almost merge
  const lineMiles = (L) => { let s = 0; for (let m = 1; m < L.nodes.length; m++) s += dist(L.nodes[m - 1], L.nodes[m]); return s; };
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const L of extract().map((q) => ({ ...q, miles: lineMiles(q) })).sort((p, q) => p.miles - q.miles || p.nodes[0] - q.nodes[0])) {
      const a = L.nodes[0], b = L.nodes[L.nodes.length - 1];
      if (a === b || isMajor[a] || isMajor[b] || L.miles > 0.4 * sp.town) continue;
      const keep = L.ks.map((k) => edgeClass[k]);
      for (const k of L.ks) { edgeClass[k] = 0; edgeClass[rev[k]] = 0; }
      // (by roads at least as good as this one)
      if (networkFrom(a, L.cls)(b) <= Math.max(3 * L.miles, 0.3 * sp.town)) {
        changed = true;
        for (const i of L.nodes.slice(1, -1)) { let c = 0; for (let k = indptr[i]; k < indptr[i + 1]; k++) c = Math.max(c, edgeClass[k]); nodeClass[i] = c; }
      } else L.ks.forEach((k, m) => { edgeClass[k] = keep[m]; edgeClass[rev[k]] = keep[m]; });
    }
    if (!changed) break;
  }
  for (let i = 0; i < n; i++) if (nodeClass[i]) { let c = 0; for (let k = indptr[i]; k < indptr[i + 1]; k++) c = Math.max(c, edgeClass[k]); nodeClass[i] = c; }
  const lines = extract();
  const riverLines = land.rivers.map((R) => R.points.map((p) => [(p[0] - M) / mpu, (p[1] - M) / mpu, p[2]]));
  // (crossings counted once each: where a path runs through a river's own node, its two segments meet the river's two
  // there, four hits at one spot)
  const crossCount = (path) => { const hits = []; for (let m = 1; m < path.length; m++) for (const rl of riverLines) for (let q = 1; q < rl.length; q++) { const at = segHit(path[m - 1], path[m], rl[q - 1], rl[q]); if (at && !hits.some((p) => sq(p[0] - at[0]) + sq(p[1] - at[1]) < 1e-6)) hits.push(at); } return hits.length; };
  const tol = (0.35 * step) / mpu, edge = 0.25;
  const givenAt = new Map(places.filter((p) => p.given).map((p) => [p.node, p.at]));
  const features = [], roadsAt = new Map();
  // (ids in use: the plan's, and any reserved, as the ids of what a reroll took out, so nothing that pointed at one
  // finds a new place under it)
  const taken = new Set([...(plan?.features ?? []).map((q) => q?.id), ...reserve].filter(Boolean));
  const freeId = (base, k) => { let id; do id = `${base}-${++k.n}`; while (taken.has(id)); return id; };
  const nRoad = { n: 0 };
  for (const L of lines) {
    // (a road to one of the plan's own places ends at the place itself, not at the node nearest it)
    const raw = L.nodes.map((i, m) => (m === 0 || m === L.nodes.length - 1) && givenAt.has(i) ? givenAt.get(i) : U(i));
    let path = simplify(raw, tol);
    if (crossCount(path) !== crossCount(raw)) path = simplify(raw, tol / 4);
    if (crossCount(path) !== crossCount(raw)) path = raw;
    for (const piece of clipToRect(path, -edge, -edge, MW + edge, MH + edge)) {
      // (a scrap the map's edge cut off is dropped; a short link inside the map is kept)
      const cut = piece[0] !== path[0] || piece[piece.length - 1] !== path[path.length - 1];
      if (piece.length < 2 || (cut && pathLen(piece) < 0.3)) continue;
      const id = freeId("road", nRoad);
      features.push({ id, type: "road", class: CLASS_OF[L.cls], path: piece.map(round2) });
    }
    // (each road's ends, for the places' road bearings)
    const a = L.nodes[0], b = L.nodes[L.nodes.length - 1];
    (roadsAt.get(a) ?? roadsAt.set(a, []).get(a)).push(raw);
    (roadsAt.get(b) ?? roadsAt.set(b, []).get(b)).push(raw.slice().reverse());
  }
  // ---- crossings: where a road's line crosses a drawn river; a bridge, or a ford where a track meets a stream ----
  const nBridge = { n: 0 }, nFord = { n: 0 };
  const placeAt = places.map((p) => U(p.node));
  const crossAt = [];
  for (const ft of features.filter((q) => q.type === "road")) {
    const path = ft.path;
    for (let m = 1; m < path.length; m++) for (const rl of riverLines) for (let q = 1; q < rl.length; q++) {
      const at = segHit(path[m - 1], path[m], rl[q - 1], rl[q]);
      if (!at || at[0] < 0 || at[1] < 0 || at[0] > MW || at[1] > MH) continue;
      // (not on a place: the place is the crossing; not twice in one spot on one road, nor on top of another road's)
      if (placeAt.some((p) => sq(p[0] - at[0]) + sq(p[1] - at[1]) < sq(0.35))) continue;
      if (crossAt.some((c) => sq(c.at[0] - at[0]) + sq(c.at[1] - at[1]) < sq(c.road === ft.id ? 0.4 : 0.12))) continue;
      crossAt.push({ at, road: ft.id });
      const big = rl[q][2] > 4 * T, ford = ft.class === "track" && !big;
      const angle = Math.round((atan2(path[m][1] - path[m - 1][1], path[m][0] - path[m - 1][0]) * 180) / PI);
      features.push({ id: ford ? freeId("ford", nFord) : freeId("bridge", nBridge), type: "crossing", class: ford ? "ford" : "bridge", at: round2(at), angle });
    }
  }
  // ---- the places, with their site facts ----
  const counts = {};
  const sited = [];
  for (const p of places) {
    if (p.given) continue;
    let id; do id = `${p.kind}-${(counts[p.kind] = (counts[p.kind] ?? 0) + 1)}`; while (taken.has(id));
    sited.push({ id, type: "place", class: p.kind, at: round2(U(p.node)), site: siteOf(p.node) });
  }
  function siteOf(i) {
    const at = U(i);
    const bearing = (to) => Math.round(((atan2(to[0] - at[0], -(to[1] - at[1])) * 180) / PI + 360) % 360);
    // its river: its own node if a drawn river runs through it, else its neighbor on the biggest river; the way
    // upstream and down from there
    let rn = -1; if (riverF[i] > 0) rn = i; else for (let k = indptr[i]; k < indptr[i + 1]; k++) if (riverF[indices[k]] > (rn >= 0 ? riverF[rn] : 0)) rn = indices[k];
    let river = null;
    if (rn >= 0) {
      const R = land.rivers.find((q) => q.id === riverId[rn]), idx = R ? R.nodes.indexOf(rn) : -1;
      if (R && idx >= 0) {
        const up = R.nodes[Math.max(0, idx - 3)], down = idx + 3 < R.nodes.length ? R.nodes[idx + 3] : R.to;
        const fr = riverF[rn] / T;
        river = { size: fr < 3 ? "small" : fr < 15 ? "medium" : "large", in: up !== rn ? bearing(U(up)) : null, out: down >= 0 && down !== rn ? bearing(U(down)) : null, id: R.id };
      }
    }
    // the coast: the nearest sea within a few steps
    let sea = -1, sd = Infinity; within(x[i], y[i], Math.max(3, 3 * step), (j) => { if (!landMask[j]) { const d = sq(x[j] - x[i]) + sq(y[j] - y[i]); if (d < sd || (d === sd && j < sea)) { sd = d; sea = j; } } });
    // its roads: each road leaving it, the way it heads a few steps out
    const roads = (roadsAt.get(i) ?? []).map((pts) => bearing(pts[Math.min(pts.length - 1, 3)])).sort((a, b) => a - b);
    // (and what a name might say of it: rivers meeting there, a lake's shore, the foot of a pass)
    return { river, coast: sea >= 0 ? bearing(U(sea)) : null, roads: [...new Set(roads)], biome: biomeOf(i), ground: h[i] < 0.16 ? "low" : h[i] < 0.45 ? "hills" : "high",
      ...(near1(junction, i) && river ? { confluence: true } : {}), ...(shore[i] > 0.5 ? { lake: true } : {}), ...(passFoot[i] ? { pass: true } : {}) };
  }
  const roadsOut = features.filter((q) => q.type === "road"), crossOut = features.filter((q) => q.type === "crossing");
  return {
    features: [...sited, ...roadsOut, ...crossOut], notes,
    stats: { landArea, cities: cities.length, towns: towns.length, given: places.filter((p) => p.given).length, villages: villages.length, castles: castles.length, ruins: ruins.length, beyond: beyond.length, roads: roadsOut.length, bridges: nBridge.n, fords: nFord.n, spacing: sp },
  };
}

function clamp(v, a = 0, b = 1) { return v < a ? a : v > b ? b : v; }
/** 0 below a, rising to 1 at b, 1 to c, falling to 0 at d. */
function tri(v, a, b, c, d) { return v <= a || v >= d ? 0 : v < b ? (v - a) / (b - a) : v <= c ? 1 : (d - v) / (d - c); }
const round2 = (p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
const pathLen = (p) => { let s = 0; for (let k = 1; k < p.length; k++) { const dx = p[k][0] - p[k - 1][0], dy = p[k][1] - p[k - 1][1]; s += Math.sqrt(dx * dx + dy * dy); } return s; };
/** Where segments ab and cd cross, or null. */
function segHit(a, b, c, d) {
  const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
  if (!den) return null;
  const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den, u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] : null;
}
/** Douglas-Peucker. */
function simplify(p, tol) {
  if (p.length < 3) return p.slice();
  const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1;
  const stack = [[0, p.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = p[a], [bx, by] = p[b], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let best = -1, bd = tol * tol;
    for (let k = a + 1; k < b; k++) {
      const t = L2 ? Math.max(0, Math.min(1, ((p[k][0] - ax) * dx + (p[k][1] - ay) * dy) / L2)) : 0;
      const ex = p[k][0] - ax - t * dx, ey = p[k][1] - ay - t * dy, d = ex * ex + ey * ey;
      if (d > bd) { bd = d; best = k; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return p.filter((_, k) => keep[k]);
}
/** A path cut to a rectangle: the pieces inside (each crossing of the edge becomes an end). */
function clipToRect(p, x0, y0, x1, y1) {
  const inside = ([px, py]) => px >= x0 && py >= y0 && px <= x1 && py <= y1;
  const out = []; let cur = null;
  for (let k = 0; k < p.length; k++) {
    if (k === 0) { if (inside(p[0])) cur = [p[0]]; continue; }
    const a = p[k - 1], b = p[k];
    // (Liang-Barsky)
    let t0 = 0, t1 = 1; const dx = b[0] - a[0], dy = b[1] - a[1];
    let ok = true;
    for (const [pp, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]]) {
      if (pp === 0) { if (q < 0) { ok = false; break; } continue; }
      const t = q / pp;
      if (pp < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; } else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; }
    }
    if (!ok) { if (cur) { out.push(cur); cur = null; } continue; }
    const pa = t0 === 0 ? a : [a[0] + t0 * dx, a[1] + t0 * dy], pb = t1 === 1 ? b : [a[0] + t1 * dx, a[1] + t1 * dy];
    if (!cur) cur = [pa];
    cur.push(pb);
    if (t1 < 1) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}
