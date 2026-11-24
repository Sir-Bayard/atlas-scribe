/**
 * Routes on an overland map beyond its roads: ports on sheltered coasts, sea lanes between them kept off the shore,
 * ferries over straits between landmasses, caravan routes across deserts and open country between distant cities on a
 * continent or a world, away from the roads, and trails out to the lonely places on a kingdom or a realm (points of
 * interest and hamlets no road reaches). Each is a plan feature of type `route` (a path in map units, a class of ROUTE_CLASSES), made by the
 * generator with a made mark like its places, so Reroll Places makes them again and the GM's own stay. A port is a
 * place whose site says so (`site.port`). Pure.
 */
import { Heap } from "./heap.mjs";
import { len, len as hyp } from "./dmath.mjs";
import { hashAt } from "../rng.mjs";
import { nearestOf } from "./realms.mjs";
import { BIOMES } from "./biome.mjs";
import { madeMark, untouched } from "./places.mjs";
import { SITE_CLASSES, SECRET_SITES } from "./sites.mjs";

/** The kinds of route. */
export const ROUTE_CLASSES = ["sea-lane", "ferry", "caravan", "trail"];

/** How many of each, at most, a map, by scale: caravan routes on a continent or a world, trails on a kingdom or a realm. */
const MOST = { "sea-lane": { kingdom: 6, realm: 10, continent: 14, world: 18 }, ferry: { kingdom: 3, realm: 4, continent: 4, world: 4 }, caravan: { kingdom: 0, realm: 0, continent: 5, world: 7 }, trail: { kingdom: 24, realm: 10, continent: 0, world: 0 } };
// (open country a caravan crosses cheaply, and country it crosses dearly)
const CARAVAN_EASY = new Set(["hot-desert", "cold-steppe", "grassland", "shrubland", "savanna", "salt-flat"]);
const CARAVAN_HARD = { "temperate-forest": 2.5, "temperate-rainforest": 4, rainforest: 5, wetland: 6, glacier: 30, taiga: 2.5, tundra: 1.5, "seasonal-forest": 2 };

/**
 * Least-cost paths over the land's nodes from `from` to the nearest `most` nodes of `goal` (a Set of node ids or a
 * function), cost(i, j, d) for each step (Infinity for a step not allowed), up to a cost of `limit`. Returns the paths
 * (nodes in order), the cheapest first.
 */
function cheapestMany(land, from, goal, cost, { limit = Infinity, most = 1 } = {}) {
  const { n, x, y, indptr, indices } = land;
  const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), heap = new Heap(4096);
  const isGoal = typeof goal === "function" ? goal : (i) => goal.has(i);
  const found = [];
  dist[from] = 0; heap.push(0, from);
  while (heap.size) {
    const i = heap.pop();
    if (heap.lastKey > dist[i] + 1e-12) continue;
    if (i !== from && isGoal(i)) { const out = [i]; for (let k = prev[i]; k >= 0; k = prev[k]) out.push(k); found.push(out.reverse()); if (found.length >= most) break; }
    if (dist[i] > limit) break;
    for (let q = indptr[i]; q < indptr[i + 1]; q++) {
      const j = indices[q], d = len(x[i] - x[j], y[i] - y[j]), c = cost(i, j, d);
      if (!(c < Infinity)) continue;
      const nd = dist[i] + c;
      if (nd < dist[j] - 1e-12) { dist[j] = nd; prev[j] = i; heap.push(nd, j); }
    }
  }
  return found;
}
/** The cheapest path to any goal node (cheapestMany's first), or null. */
const cheapest = (land, from, goal, cost, limit = Infinity) => cheapestMany(land, from, goal, cost, { limit })[0] ?? null;

/** A point's distance to a polyline, in the same units. */
function lineDist(p, line) {
  let best = Infinity;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1], b = line[k], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
    best = Math.min(best, hyp(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best;
}

/** A line of nodes as a smooth path in map units, every `step`-th node kept (its ends always), rounded. */
function pathOf(land, nodes, step = 2) {
  const f = land.frame, U = (i) => [(land.x[i] - f.margin) / f.mpu, (land.y[i] - f.margin) / f.mpu];
  const keep = nodes.filter((_, k) => k === 0 || k === nodes.length - 1 || k % step === 0).map(U);
  // (a pass of corner cutting, the ends held)
  const out = [keep[0]];
  for (let k = 1; k < keep.length - 1; k++) out.push([(keep[k - 1][0] + 2 * keep[k][0] + keep[k + 1][0]) / 4, (keep[k - 1][1] + 2 * keep[k][1] + keep[k + 1][1]) / 4]);
  if (keep.length > 1) out.push(keep[keep.length - 1]);
  return out.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]);
}

/**
 * Routes placed on an overland plan's land, in place of the generator's own the GM hasn't changed (the GM's own are
 * left as they are, and the new ones join them rather than doubling them), with its ports marked (a coastal city, or a
 * town on a sheltered coast or at a river's mouth). Run after the towns, realms and points of interest. reserve: ids
 * not to give out. Returns { plan, added: { ports, "sea-lane", ferry, caravan, trail }, removed }.
 */
export function placeRoutes(plan, land, { seed = plan?.seed ?? 1, reserve = [] } = {}) {
  const all = plan.features ?? [];
  const keep = all.filter((f) => f?.type !== "route" || !untouched(f));
  const gone = all.filter((f) => f?.type === "route" && untouched(f)).map((f) => f.id);
  const f = land.frame, MW = f.mapW / f.mpu, MH = f.mapH / f.mpu, scale = f.scale ?? "realm";
  const { n, x, y, indptr, indices, landMask, lake } = land;
  const near = nearestOf(land);
  const wet = (i) => !landMask[i] && !lake[i];
  const dry = (i) => landMask[i] && !lake[i];
  const inMap = (p) => p[0] >= 0 && p[1] >= 0 && p[0] <= MW && p[1] <= MH;
  const out = structuredClone(keep);
  // (ports are marked again each time: a place that was one last time may not be now)
  for (const q of out) if (q.type === "place" && q.site?.port) { const { port, ...rest } = q.site; q.site = rest; }
  const places = out.filter((q) => q.type === "place" && Array.isArray(q.at) && inMap(q.at));
  const roads = out.filter((q) => q.type === "road" && Array.isArray(q.path) && q.path.length >= 2);
  const kept = out.filter((q) => q.type === "route" && Array.isArray(q.path) && q.path.length >= 2);
  const spacing = land.spacing;
  // (the nodes along a line, every half spacing of it, for "on a road" and "beside a road")
  const nodesAlong = (line, test = dry) => {
    const got = new Set();
    for (let k = 0; k < line.length; k++) {
      const a = line[Math.max(0, k - 1)], b = line[k], steps = Math.max(1, Math.ceil((len(b[0] - a[0], b[1] - a[1]) * f.mpu) / (0.5 * spacing)));
      for (let t = k ? 1 : 0; t <= steps; t++) { const i = near(a[0] + ((b[0] - a[0]) * t) / steps, a[1] + ((b[1] - a[1]) * t) / steps, test); if (i >= 0) got.add(i); }
    }
    return got;
  };
  const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  // (what the GM's kept routes already join: place pairs, each port's lanes)
  const joined = new Set(kept.filter((r) => r.from && r.to).map((r) => pairKey(r.from, r.to)));
  const lanesAt = new Map();
  for (const r of kept) if (r.class === "sea-lane") for (const id of [r.from, r.to]) if (id) lanesAt.set(id, (lanesAt.get(id) ?? 0) + 1);
  // distance from the shore over the sea, in miles (a lane keeps off it), and each place's coast node
  const shoreD = new Float64Array(n).fill(Infinity), heap = new Heap(4096);
  for (let i = 0; i < n; i++) if (wet(i)) for (let q = indptr[i]; q < indptr[i + 1]; q++) if (dry(indices[q])) { shoreD[i] = 0; heap.push(0, i); break; }
  while (heap.size) { const i = heap.pop(); if (heap.lastKey > shoreD[i] + 1e-12) continue; for (let q = indptr[i]; q < indptr[i + 1]; q++) { const j = indices[q]; if (!wet(j)) continue; const d = shoreD[i] + len(x[i] - x[j], y[i] - y[j]); if (d < shoreD[j] - 1e-12) { shoreD[j] = d; heap.push(d, j); } } }
  const seaBy = (p) => { const i = near(p[0], p[1], wet); if (i < 0) return -1; const dx = (x[i] - f.margin) / f.mpu - p[0], dy = (y[i] - f.margin) / f.mpu - p[1]; return Math.sqrt(dx * dx + dy * dy) * f.mpu <= 3 * spacing ? i : -1; };
  // (how sheltered a coast is: the share of land within a few spacings, by the nodes' own areas, as the points are
  // sparser out at sea)
  const shelter = (i) => { let a = 0, b = 0; const R = 6 * spacing; for (let j = 0; j < n; j++) { const d2 = (x[j] - x[i]) ** 2 + (y[j] - y[i]) ** 2; if (d2 > R * R) continue; const w = land.area?.[j] ?? 1; b += w; if (landMask[j]) a += w; } return b ? a / b : 0; };
  // ---- ports: coastal cities and towns, the sheltered ones first
  const coastal = places.filter((p) => (p.class === "city" || p.class === "town") && p.site?.coast != null).map((p) => ({ p, sea: seaBy(p.at) })).filter((c) => c.sea >= 0);
  for (const c of coastal) c.shelter = shelter(c.sea);
  const ports = coastal.filter((c) => c.p.class === "city" || c.shelter > 0.55 || c.p.site?.river);
  for (const c of ports) c.p.site = { ...(c.p.site ?? {}), port: true };
  const made = [], ids = new Set([...all.map((q) => q.id), ...gone, ...reserve]);
  const nextId = (cls) => { let k = 1; while (ids.has(`${cls}-${k}`)) k++; ids.add(`${cls}-${k}`); return `${cls}-${k}`; };
  const add = (cls, path, extra = {}) => { const feat = { id: nextId(cls), type: "route", class: cls, path, ...extra }; made.push({ ...feat, made: madeMark(feat) }); };
  const counts = { ports: ports.length, "sea-lane": 0, ferry: 0, caravan: 0, trail: 0 };
  // ---- ferries: between places on two landmasses close across the water, one a pair of landmasses
  const landId = new Int32Array(n).fill(-1);
  { let id = 0; for (let s = 0; s < n; s++) { if (!dry(s) || landId[s] >= 0) continue; const st = [s]; landId[s] = id; while (st.length) { const i = st.pop(); for (let q = indptr[i]; q < indptr[i + 1]; q++) { const j = indices[q]; if (dry(j) && landId[j] < 0) { landId[j] = id; st.push(j); } } } id++; } }
  const placeNode = (p) => near(p.at[0], p.at[1], dry);
  const strait = (Math.max(MW, MH) * f.mpu) / 12;
  const ferryFrom = places.filter((p) => ["city", "town", "village"].includes(p.class) && seaBy(p.at) >= 0);
  const fpairs = [];
  for (let a = 0; a < ferryFrom.length; a++) for (let b = a + 1; b < ferryFrom.length; b++) {
    const A = ferryFrom[a], B = ferryFrom[b], ia = placeNode(A), ib = placeNode(B);
    if (ia < 0 || ib < 0 || landId[ia] === landId[ib]) continue;
    const d = len(A.at[0] - B.at[0], A.at[1] - B.at[1]) * f.mpu;
    if (d > strait) continue;
    fpairs.push({ A, B, d });
  }
  fpairs.sort((p, q) => p.d - q.d || (p.A.id < q.A.id ? -1 : 1));
  const linked = new Set();
  for (const r of kept) if (r.class === "ferry") { const A = places.find((q) => q.id === r.from), B = places.find((q) => q.id === r.to); if (A && B) { const ka = landId[placeNode(A)], kb = landId[placeNode(B)]; linked.add(ka < kb ? `${ka},${kb}` : `${kb},${ka}`); } }
  for (const fp of fpairs) {
    if (counts.ferry >= MOST.ferry[scale]) break;
    const ka = landId[placeNode(fp.A)], kb = landId[placeNode(fp.B)], key = ka < kb ? `${ka},${kb}` : `${kb},${ka}`;
    if (linked.has(key) || joined.has(pairKey(fp.A.id, fp.B.id))) continue;
    // (over the water from shore to shore; across a strait so narrow both shores share their water, straight)
    const sa = seaBy(fp.A.at), sb = seaBy(fp.B.at);
    const nodes = sa === sb ? [] : cheapest(land, sa, new Set([sb]), (i, j, d) => (wet(j) ? d : Infinity), strait * 2);
    if (!nodes) continue;
    linked.add(key); joined.add(pairKey(fp.A.id, fp.B.id));
    add("ferry", [fp.A.at, ...(nodes.length ? pathOf(land, nodes, 4) : []), fp.B.at].map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]), { from: fp.A.id, to: fp.B.id });
    counts.ferry++;
  }
  // ---- sea lanes: each port to its nearest ports by sea (a lane over open water, kept off the shore and out of
  // narrow channels where it can), the cheapest pairs first, no port with more than three lanes
  const seaCost = (i, j, d) => (wet(j) ? d * (1 + 1.2 / (1 + shoreD[j] / (2 * spacing))) : Infinity);
  if (ports.length >= 2) {
    const pairs = [];
    for (let a = 0; a < ports.length; a++) {
      // (to the other ports' water, the nearest few, in one search; a port sharing its water with this one is too near)
      const goal = new Map(ports.map((c, b) => [c.sea, b]).filter(([w, b]) => b !== a && w !== ports[a].sea));
      for (const nodes of cheapestMany(land, ports[a].sea, new Set(goal.keys()), seaCost, { most: 5 })) {
        let L = 0; for (let k = 1; k < nodes.length; k++) L += len(x[nodes[k]] - x[nodes[k - 1]], y[nodes[k]] - y[nodes[k - 1]]);
        pairs.push({ a, b: goal.get(nodes[nodes.length - 1]), nodes, L });
      }
    }
    pairs.sort((p, q) => p.L - q.L || p.a - q.a || p.b - q.b);
    const deg = ports.map((c) => lanesAt.get(c.p.id) ?? 0), done = new Set(joined);
    // (a lane shorter than a few spacings is a harbor's mouth, not a sea lane)
    for (const pr of pairs) {
      if (counts["sea-lane"] >= MOST["sea-lane"][scale]) break;
      const key = pairKey(ports[pr.a].p.id, ports[pr.b].p.id);
      if (done.has(key) || deg[pr.a] >= 3 || deg[pr.b] >= 3 || pr.L < 8 * spacing) continue;
      done.add(key); deg[pr.a]++; deg[pr.b]++;
      add("sea-lane", pathOf(land, pr.nodes, 3), { from: ports[pr.a].p.id, to: ports[pr.b].p.id });
      counts["sea-lane"]++;
    }
  }
  // ---- caravan routes (a continent or a world): between cities far apart over open or dry country, cheap over
  // deserts and steppe, dear through forest and marsh, and dear beside the roads, so a caravan route goes where the
  // roads don't
  if (MOST.caravan[scale]) {
    const cities = places.filter((p) => p.class === "city").map((p) => ({ p, i: placeNode(p) })).filter((c) => c.i >= 0);
    const byRoad = new Uint8Array(n);
    for (const rd of roads) for (const i of nodesAlong(rd.path)) { byRoad[i] = 1; for (let q = indptr[i]; q < indptr[i + 1]; q++) byRoad[indices[q]] = 1; }
    const cost = (i, j, d) => { if (!dry(j)) return Infinity; const b = BIOMES[land.biome?.[j]]; return d * (CARAVAN_EASY.has(b) ? 0.55 : CARAVAN_HARD[b] ?? 1.3) * (1 + 12 * Math.max(0, land.h[j] - 0.35)) * (byRoad[j] ? 3 : 1); };
    const roadShare = (nodes) => nodes.filter((i) => byRoad[i]).length / Math.max(1, nodes.length);
    const dryShare = (nodes) => nodes.filter((i) => CARAVAN_EASY.has(BIOMES[land.biome?.[i]])).length / Math.max(1, nodes.length);
    const cand = [];
    const far = Math.max(MW, MH) * f.mpu / 5;
    for (let a = 0; a < cities.length; a++) for (let b = a + 1; b < cities.length; b++) {
      const d = len(cities[a].p.at[0] - cities[b].p.at[0], cities[a].p.at[1] - cities[b].p.at[1]) * f.mpu;
      if (d < far || landId[cities[a].i] !== landId[cities[b].i]) continue;
      cand.push({ a, b, d, k: hashAt(a * 131 + b, 91, seed) });
    }
    cand.sort((p, q) => p.d - q.d || p.k - q.k);
    const used = new Array(cities.length).fill(0);
    for (const c of cand) {
      if (counts.caravan >= MOST.caravan[scale]) break;
      if (used[c.a] >= 2 || used[c.b] >= 2 || joined.has(pairKey(cities[c.a].p.id, cities[c.b].p.id))) continue;
      const nodes = cheapest(land, cities[c.a].i, new Set([cities[c.b].i]), cost);
      // (a caravan route only where the way is mostly open or dry country and mostly off the roads: elsewhere the roads
      // serve)
      if (!nodes || dryShare(nodes) < 0.45 || roadShare(nodes) > 0.4) continue;
      used[c.a]++; used[c.b]++;
      add("caravan", pathOf(land, nodes, 3), { from: cities[c.a].p.id, to: cities[c.b].p.id });
      counts.caravan++;
    }
  }
  // ---- trails (a kingdom or a realm): from each point of interest or hamlet no road comes near to the nearest road,
  // village or trail, over the land
  if (MOST.trail[scale]) {
    const onRoad = new Uint8Array(n);
    for (const rd of roads) for (const i of nodesAlong(rd.path)) onRoad[i] = 1;
    // (a trail to a secret place is on the GM's hidden tile, so no trail players see is led onto it)
    const secretIds = new Set(places.filter((p) => SECRET_SITES.includes(p.class)).map((p) => p.id));
    for (const r of kept) if (r.class === "trail" && !secretIds.has(r.to)) for (const i of nodesAlong(r.path)) onRoad[i] = 1;
    for (const p of places) if (["city", "town", "village"].includes(p.class)) { const i = placeNode(p); if (i >= 0) onRoad[i] = 1; }
    const trailed = new Set(kept.filter((r) => r.class === "trail" && r.to).map((r) => r.to));
    const lonely = places.filter((p) => (p.class === "hamlet" || SITE_CLASSES.includes(p.class)) && !["wreck", "cove", "lighthouse"].includes(p.class) && !trailed.has(p.id));
    const far = 3 * spacing;
    const withD = lonely.map((p) => {
      const i = placeNode(p);
      let best = Infinity;
      for (const rd of roads) best = Math.min(best, lineDist(p.at, rd.path) * f.mpu);
      return { p, i, best, k: hashAt(i, 93, seed) };
    }).filter((c) => c.i >= 0 && !onRoad[c.i] && c.best > far && c.best < 25 * spacing);
    withD.sort((p, q) => q.best - p.best || p.k - q.k);
    for (const c of withD) {
      if (counts.trail >= MOST.trail[scale]) break;
      // (over the land, steep ground dear: a grade from the heights, 1 being about 3.1 miles up)
      const nodes = cheapest(land, c.i, (i) => onRoad[i] === 1, (i, j, d) => { if (!dry(j)) return Infinity; const g = (Math.abs(land.h[j] - land.h[i]) * 3.1) / Math.max(1e-9, d); return d * (1 + 20 * g * g); }, 40 * spacing);
      if (!nodes || nodes.length < 3) continue;
      add("trail", pathOf(land, nodes, 2), { to: c.p.id });
      if (!secretIds.has(c.p.id)) for (const i of nodes) onRoad[i] = 1;
      counts.trail++;
    }
  }
  return { plan: { ...structuredClone(plan), features: [...out, ...made] }, added: counts, removed: gone.length };
}
