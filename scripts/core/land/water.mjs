/**
 * Water on the finished land: flat valley floors along big rivers, lakes (flooded basins with a level, a water
 * balance, one outlet or none, and salt flats where a closed lake has shrunk), rivers drawn from the drainage tree
 * by catchment in square miles (merging, never splitting), each with its main stem, order, head of navigation and
 * falls, and a GM's forced river course. Lengths in miles, areas in square miles. Pure.
 */
import { fillRoute, accumulate } from "./solver.mjs";
import { Heap } from "./heap.mjs";
import { len, exp } from "./dmath.mjs";

/** The share of a river's water lost a mile where the land is as dry as it gets (generator 3 on): about two fifths over
 * 25 miles of desert. */
export const DRY_LOSS = 0.02;

/** The share of the most water it carried below which a river losing water in dry country has run out (generator 3). */
export const DRY_END = 0.7;

/** Catchment (rain-weighted square miles) above which a river is drawn, by scale; times 2 for few, 0.5 for many. */
export const RIVER_CATCHMENT = { kingdom: 1000, realm: 6000, continent: 40000, world: 150000 };

/**
 * Flat valley floors (E5): along rivers whose catchment exceeds `big`, ground within a width set by flow is pulled
 * toward the river's height with a smooth ramp at the edge (only lowered). h is changed in place.
 */
export function valleyFloors(g, h, w, big, land, fixed) {
  const { A } = w;
  const n = g.n, src = new Int32Array(n).fill(-1), dist = new Float64Array(n).fill(Infinity);
  const heap = new Heap(n);
  for (let i = 0; i < n; i++) if (land[i] && A[i] >= big) { src[i] = i; dist[i] = 0; heap.push(0, i); }
  const widthOf = (i) => Math.min(40, 1.2 * Math.sqrt(A[i] / big) * Math.sqrt(big) / 8);
  while (heap.size) {
    const i = heap.pop(), d = heap.lastKey;
    if (d > dist[i]) continue;
    for (let k = g.indptr[i]; k < g.indptr[i + 1]; k++) {
      const j = g.indices[k], nd = d + g.elen[k];
      if (nd < dist[j] && nd < widthOf(src[i])) { dist[j] = nd; src[j] = src[i]; heap.push(nd, j); }
    }
  }
  for (let i = 0; i < n; i++) {
    if (src[i] < 0 || src[i] === i || !land[i] || (fixed && fixed[i])) continue;
    const W = widthOf(src[i]), t = dist[i] / W, ramp = t * t * (3 - 2 * t);
    const target = h[src[i]] + (h[i] - h[src[i]]) * ramp;
    if (target < h[i]) h[i] = target;
  }
}

/**
 * Lakes. ctx: { g, h, w (fillRoute work, routed on h), np, rain, temp, land, outlet, pxPerMile, amount (land.lakes:
 * few, some, many: how small a basin still shows as a lake, and how fast its water goes to the air) }. Every flooded
 * basin is a lake candidate; its level is the basin's filled height. Water balance: inflow (the runoff of its
 * catchment: rain less what the land gives back to the air, a share that grows with warmth and dryness, as Budyko's
 * curve) against evaporation (its open water's area times warmth); what's left leaves by its outlet, and the flow below
 * a lake is cut by the share it kept, so a hot, dry basin's lakes close where a wet one's overflow. A closed lake
 * keeps its deepest share and the rest becomes salt flat. From generator 3 (ctx.gen) a river loses water across dry
 * country (DRY_LOSS). Returns { lake (Uint8Array), salt, lakeId (Int32Array), lakes: [{ id, level, area, inflow, evap,
 * closed, outlet }], F (flow with lakes) }.
 */
export function lakesStage(ctx) {
  const { g, h, w, np, rain, temp, land } = ctx;
  const { hf, rec, pop } = w;
  const n = g.n;
  const depth = new Float64Array(n);
  for (let i = 0; i < n; i++) depth[i] = land[i] ? hf[i] - h[i] : 0;
  // flooded regions (the whole basin to its rim)
  const reg = new Int32Array(n).fill(-1), stack = new Int32Array(n);
  const regs = [];
  for (let s = 0; s < n; s++) {
    if (reg[s] >= 0 || !(depth[s] > 1e-5)) continue;
    const id = regs.length; let top = 0, area = 0, deep = 0, open = 0, tsum = 0;
    stack[top++] = s; reg[s] = id;
    while (top) {
      const i = stack[--top]; area += g.area[i];
      if (depth[i] > deep) deep = depth[i];
      if (depth[i] > 0.003) { open += g.area[i]; tsum += temp[i] * g.area[i]; }
      for (let k = g.indptr[i]; k < g.indptr[i + 1]; k++) { const j = g.indices[k]; if (reg[j] < 0 && depth[j] > 1e-5) { reg[j] = id; stack[top++] = j; } }
    }
    regs.push({ id, area, deep, open, temp: open ? tsum / open : 0.5 });
  }
  // shown lakes: open water of at least about 40 px of picture (a few nodes at least)
  let meanArea = 0; for (let i = 0; i < n; i++) meanArea += g.area[i]; meanArea /= n || 1;
  const LAKES = { few: { size: 3, evap: 1.3 }, some: { size: 1, evap: 1 }, many: { size: 0.3, evap: 0.75 } }[ctx.amount] ?? { size: 1, evap: 1 };
  const minArea = Math.max(40 / (ctx.pxPerMile * ctx.pxPerMile), 4 * meanArea) * LAKES.size;
  const lakes = [], lakeOfReg = new Int32Array(regs.length).fill(-1);
  for (const r of regs) if (r.open >= minArea) { lakeOfReg[r.id] = lakes.length; lakes.push({ id: lakes.length, reg: r.id, area: r.open, level: 0, inflow: 0, evap: LAKES.evap * r.open * (0.06 + 0.35 * Math.min(1, Math.max(0, r.temp))), closed: false, outlet: -1 }); }
  // flow with lakes: evaporation is taken from what leaves each lake by its outlet
  // (F, the flow drawn as rivers, is rain; Q, the water balance's, is runoff)
  const F = new Float64Array(n), Q = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = Math.max(0, rain[i]), pet = 0.3 + 0.9 * Math.min(1, Math.max(0, temp[i]));
    F[i] = r * g.area[i]; Q[i] = ((r * r) / (r + pet || 1)) * g.area[i];
  }
  const left = lakes.map((L) => L.evap);
  // (from generator 3, a river in dry country loses water into its bed and the air as it goes: a share a mile by how
  // far the rain there falls short of what the air would take up, so a river fed by wet highlands runs out into the
  // desert and ends there)
  const lossAt = (ctx.gen ?? 0) >= 3 ? (i) => { const r = Math.max(0, rain[i]), pet = 0.3 + 0.9 * Math.min(1, Math.max(0, temp[i])), a = Math.max(0, (pet - r) / pet); return exp(-DRY_LOSS * a * a * w.rd[i]); } : null;
  for (let k = np - 1; k >= 0; k--) {
    const i = pop[k], r = rec[i];
    if (r === i) continue;
    const li = reg[i] >= 0 ? lakeOfReg[reg[i]] : -1;
    if (li >= 0 && reg[r] !== reg[i]) {
      lakes[li].inflow += Q[i]; lakes[li].outlet = i;
      const take = Math.min(Q[i], left[li]); left[li] -= take;
      const kept = Q[i] > 0 ? (Q[i] - take) / Q[i] : 1;
      Q[r] += Q[i] - take; F[r] += F[i] * kept;
    } else if (lossAt && land[i] && reg[i] < 0) { const keep = lossAt(i); Q[r] += Q[i] * keep; F[r] += F[i] * keep; } else { Q[r] += Q[i]; F[r] += F[i]; }
  }
  const lake = new Uint8Array(n), salt = new Uint8Array(n), lakeId = new Int32Array(n).fill(-1);
  const byLake = lakes.map(() => []);
  // (a shown lake is its whole flooded basin, shallow edge too: so rivers leave it once, at its outlet, and don't run
  // out and back in across a shallow fringe; the painter draws lakes from their levels the same way)
  for (let i = 0; i < n; i++) { const li = reg[i] >= 0 ? lakeOfReg[reg[i]] : -1; if (li >= 0) byLake[li].push(i); }
  for (const L of lakes) {
    const nodes = byLake[L.id];
    L.level = nodes.length ? hf[nodes[0]] : 0;
    L.closed = L.inflow < L.evap;
    const frac = L.closed ? Math.min(1, L.inflow / Math.max(1e-9, L.evap)) : 1;
    if (frac < 0.12) { for (const i of nodes) salt[i] = 1; continue; }
    const cut = frac < 1 ? [...nodes].map((i) => depth[i]).sort((a, b) => a - b)[Math.floor((1 - frac) * nodes.length)] : -Infinity;
    for (const i of nodes) { if (depth[i] >= cut) { lake[i] = 1; lakeId[i] = L.id; } else salt[i] = 1; }
  }
  return { lake, salt, lakeId, lakes, F, depth };
}

/**
 * Rivers. ctx: { g, h, w (routed), np (its order's length), F (flow with lakes), land, lake, outlet, threshold
 * (catchment to draw), gen }. Main
 * channels where F >= threshold; heads a few steps further up where F >= threshold / 3 if they join a main channel.
 * Each river from its source to where it ends (the sea, a lake, the frame's edge, or a larger river: at a
 * confluence the larger flow keeps the river's identity). Returns { rivers: [{ id, parent, order, main, points:
 * [[x, y, F, slope]...], ends: "sea" | "lake" | "edge" | "river" | "dry" (generator 3: run out on dry land), nodes }],
 * drawn (Uint8Array), riverOf (Int32Array) }.
 */
export function riversStage(ctx) {
  const { g, h, w, F, land, outlet, threshold } = ctx;
  const { rec, rd } = w;
  const n = g.n;
  // (a salt flat is a dried lake: rivers end at it, as at a lake, and don't cross it)
  const lake = ctx.salt ? Uint8Array.from(ctx.lake, (v, i) => (v || ctx.salt[i] ? 1 : 0)) : ctx.lake;
  const main = new Uint8Array(n), drawn = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (land[i] && !lake[i] && F[i] >= threshold) main[i] = 1;
  // (from generator 3 a river that falls below the threshold as it loses water in dry country runs on, drawn, while it
  // keeps DRY_END of the most it carried; past that it has run out, and ends "dry")
  if ((ctx.gen ?? 0) >= 3 && ctx.np) {
    const peak = new Float64Array(n), { pop } = w;
    for (let k = ctx.np - 1; k >= 0; k--) {
      const i = pop[k], r = rec[i];
      if (!main[i]) continue;
      if (F[i] > peak[i]) peak[i] = F[i];
      if (r === i || !land[r] || lake[r]) continue;
      if (peak[i] > peak[r]) peak[r] = peak[i];
      if (!main[r] && F[r] >= DRY_END * peak[i]) main[r] = 1;
    }
    // (a river that runs out a little above where the water gathers again, as other streams join, is drawn on to it, so
    // it isn't broken by a gap)
    for (let i = 0; i < n; i++) {
      if (!main[i] || rec[i] === i || main[rec[i]] || !land[rec[i]] || lake[rec[i]]) continue;
      const path = [];
      let j = rec[i];
      while (path.length < 30 && land[j] && !lake[j] && !main[j] && rec[j] !== j) { path.push(j); j = rec[j]; }
      if (main[j] && land[j] && !lake[j]) for (const u of path) main[u] = 1;
    }
  }
  // (a river the GM drew is drawn its whole length, however little drains into its first reach)
  for (const list of ctx.forced ?? []) {
    for (const i of list) if (land[i] && !lake[i]) main[i] = 1;
    // (and on from its end, the way its water goes, to where it meets a river, a lake, the sea or the edge)
    let j = list[list.length - 1];
    for (let guard = 0; guard < 4000 && rec[j] !== j; guard++) { j = rec[j]; if (!land[j] || lake[j] || main[j]) break; main[j] = 1; }
  }
  for (let i = 0; i < n; i++) {
    drawn[i] = main[i];
    if (main[i] || !land[i] || lake[i] || F[i] < threshold / 3) continue;
    let j = i, k = 0;
    while (k < 12 && rec[j] !== j && !main[j]) { j = rec[j]; k++; }
    if (main[j]) drawn[i] = 1;
  }
  // donors: for each drawn node, its drawn upstream neighbors, biggest first
  const donors = Array.from({ length: n }, () => null);
  for (let i = 0; i < n; i++) if (drawn[i] && rec[i] !== i && drawn[rec[i]] && !lake[rec[i]]) (donors[rec[i]] ??= []).push(i);
  for (const d of donors) if (d) d.sort((a, b) => F[b] - F[a] || a - b);
  // mouths: drawn nodes whose receiver isn't a drawn river node
  const mouths = [];
  for (let i = 0; i < n; i++) if (drawn[i] && (rec[i] === i || !drawn[rec[i]] || lake[rec[i]])) mouths.push(i);
  mouths.sort((a, b) => F[b] - F[a] || a - b);
  const rivers = [], riverOf = new Int32Array(n).fill(-1);
  const queue = mouths.map((m) => ({ start: m, parent: -1 }));
  while (queue.length) {
    const { start, parent } = queue.shift();
    const id = rivers.length, nodes = [];
    let i = start;
    for (;;) {
      nodes.push(i); riverOf[i] = id;
      const d = donors[i];
      if (!d || !d.length) break;
      for (let k = 1; k < d.length; k++) queue.push({ start: d[k], parent: id });
      i = d[0];
    }
    nodes.reverse(); // (source to mouth)
    const last = nodes[nodes.length - 1], r = rec[last];
    // (from generator 3 a main river can run out on dry land: it ends "dry")
    const ends = parent >= 0 ? "river" : lake[r] ? "lake" : !land[r] ? "sea" : outlet[r] || r === last ? "edge" : (ctx.gen ?? 0) >= 3 && main[last] ? "dry" : "river";
    const points = nodes.map((k) => [g.x[k], g.y[k], F[k], rec[k] !== k ? Math.max(0, (h[k] - h[rec[k]]) / rd[k]) : 0]);
    // (the river's last step reaches into what it ends in)
    if (r !== last) points.push([g.x[r], g.y[r], F[last], 0]);
    rivers.push({ id, parent, order: 1, main: parent < 0, points, ends, nodes });
  }
  // Strahler-like order: a river's order is one more than the largest of its tributaries' when two of that order join
  const kids = rivers.map(() => []);
  for (const R of rivers) if (R.parent >= 0) kids[R.parent].push(R.id);
  const orderOf = (id) => {
    const os = kids[id].map(orderOf).sort((a, b) => b - a);
    const o = !os.length ? 1 : os.length > 1 && os[0] === os[1] ? os[0] + 1 : Math.max(1, os[0]);
    rivers[id].order = o;
    return o;
  };
  for (const R of rivers) if (R.parent < 0) orderOf(R.id);
  return { rivers, drawn, riverOf };
}

/**
 * Where rivers run out on dry land, and their dry beds (generator 3). The end of each river that ends "dry" spreads
 * over the low ground around it (a share of the map by its flow): a salt pan where the land is driest, a seasonal lake
 * where it's dry, a marsh where it's wetter (an inland delta). A river's points where it has lost water, in country
 * drier than DRY_BED, are its dry bed. ctx: { g, h, rivers, F, rain, temp, land, lake, threshold, frame }. Returns { sinks: [{ kind ("salt-pan",
 * "seasonal-lake" or "inland-marsh"), x, y, size (square miles), river, nodes }], salt, seasonal, marsh (Uint8Array:
 * the nodes each covers) } and sets each river's dry (Uint8Array a point, 1 where its bed is dry).
 */
export function drySinks(ctx) {
  const { g, h, rivers, F, rain, temp, land, lake, threshold, frame } = ctx;
  const mapArea = frame ? frame.mapW * frame.mapH : Infinity;
  const n = g.n, salt = new Uint8Array(n), seasonal = new Uint8Array(n), marsh = new Uint8Array(n), sinks = [];
  const arid = (i) => { const r = Math.max(0, rain[i]), pet = 0.3 + 0.9 * Math.min(1, Math.max(0, temp[i])); return Math.max(0, (pet - r) / pet); };
  for (const R of rivers) {
    // (a dry bed: where the river has lost water, under 85% of the most it carried, in country drier than DRY_BED)
    let top = 0;
    R.dry = Uint8Array.from(R.nodes.map((i) => { top = Math.max(top, F[i]); return arid(i) > DRY_BED && F[i] < 0.85 * top ? 1 : 0; }));
    if (R.ends !== "dry") continue;
    const m = R.nodes[R.nodes.length - 1], a = arid(m);
    // (the spread: low ground near the end, its area from the river's flow, never into a lake or the sea)
    const want = Math.min(0.01 * mapArea, Math.max(0.0015 * mapArea, 0.05 * threshold) * Math.max(0.5, Math.min(3, F[m] / threshold))), floor = h[m] + 0.02;
    // (a round patch of that area about the end, over ground no higher than a little above it, joined to the end)
    const rad = Math.sqrt(want / Math.PI), nodes = [], seen = new Set([m]), q = [m];
    let area = 0;
    for (let k = 0; k < q.length; k++) {
      const u = q[k];
      if (!land[u] || lake[u] || h[u] > floor || len(g.x[u] - g.x[m], g.y[u] - g.y[m]) > rad) continue;
      nodes.push(u); area += g.area[u];
      for (let e = g.indptr[u]; e < g.indptr[u + 1]; e++) { const v = g.indices[e]; if (!seen.has(v)) { seen.add(v); q.push(v); } }
    }
    if (nodes.length < 2) continue;
    const kind = a > 0.75 ? "salt-pan" : a > 0.5 ? "seasonal-lake" : "inland-marsh";
    const mask = kind === "salt-pan" ? salt : kind === "seasonal-lake" ? seasonal : marsh;
    for (const u of nodes) mask[u] = 1;
    let sx = 0, sy = 0; for (const u of nodes) { sx += g.x[u]; sy += g.y[u]; }
    sx /= nodes.length; sy /= nodes.length;
    let b = nodes[0], bd = Infinity; for (const u of nodes) { const dx = g.x[u] - sx, dy = g.y[u] - sy, d = dx * dx + dy * dy; if (d < bd || (d === bd && u < b)) { bd = d; b = u; } }
    sinks.push({ kind, x: g.x[b], y: g.y[b], size: Math.round(area * 10) / 10, river: R.id, nodes });
  }
  return { sinks, salt, seasonal, marsh };
}

/** The dryness (0 wet to 1 desert: how far the rain falls short of what the air would take up) past which a river that
 * is losing water is drawn as a dry bed. */
export const DRY_BED = 0.6;

/**
 * Marks along rivers: falls (a step much steeper than the reach around it), the head of navigation (on a main
 * river, the lowest point above which it steepens: the classic inland city site) and the lowest bridging point
 * (the first narrow crossing above a river's mouth on the sea). Returns { falls: [[x, y, riverId]], heads: [[x, y,
 * riverId]], bridges: [[x, y, riverId]] }.
 */
export function riverMarks(rivers, hard) {
  const falls = [], heads = [], bridges = [];
  for (const R of rivers) {
    const p = R.points, m = p.length;
    if (m < 6) continue;
    for (let k = 2; k < m - 2; k++) {
      const s = p[k][3], around = (p[k - 2][3] + p[k - 1][3] + p[k + 1][3] + p[k + 2][3]) / 4;
      if (s > 0.004 && s > 4 * around && (hard ? hard[R.nodes[k]] > 0.3 : true)) falls.push([p[k][0], p[k][1], R.id]);
    }
    if (R.main && R.ends === "sea" && m >= 10) {
      // walking up from the mouth: the first point where the slope over the next few nodes rises well above the lower reach's
      let low = 0, cnt = 0;
      for (let k = m - 2; k > 2; k--) {
        const s = (p[k][3] + p[k - 1][3] + p[k - 2][3]) / 3;
        if (cnt > 4 && s > 3 * (low / cnt) && s > 0.0005) { heads.push([p[k][0], p[k][1], R.id]); break; }
        low += p[k][3]; cnt++;
      }
      bridges.push([p[Math.max(0, m - 4)][0], p[Math.max(0, m - 4)][1], R.id]);
    }
  }
  return { falls, heads, bridges };
}

/**
 * A GM's forced river: the nodes along its course (source to mouth), each a neighbor of the one before, held as a
 * valley that runs downhill. path: [[x, y]...] frame miles; nearest: node lookup; g: the graph.
 */
export function forcedNodes(path, nearest, spacing, g) {
  const out = [], on = new Set();
  const add = (j) => { if (!on.has(j)) { out.push(j); on.add(j); } };
  // (from the last node toward a target node through neighbors, so the course has no gaps)
  const walk = (to) => {
    let cur = out[out.length - 1];
    for (let guard = 0; cur !== to && guard < 4000; guard++) {
      const tx = g.x[to], ty = g.y[to];
      let best = -1, bd = len(g.x[cur] - tx, g.y[cur] - ty);
      for (let e = g.indptr[cur]; e < g.indptr[cur + 1]; e++) { const j = g.indices[e], d = len(g.x[j] - tx, g.y[j] - ty); if (d < bd || (d === bd && best >= 0 && j < best)) { bd = d; best = j; } }
      if (best < 0) break;
      cur = best;
      add(cur);
    }
    add(to);
  };
  for (let k = 0; k + 1 < path.length; k++) {
    const [ax, ay] = path[k], [bx, by] = path[k + 1], L = len(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(L / (spacing * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const j = nearest(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps);
      if (!out.length) add(j); else if (out[out.length - 1] !== j) walk(j);
    }
  }
  // (a node the walk stepped through beside the way is left out where the next one is already a neighbor, so the
  // course is one chain with no side steps)
  const nb = (a, b) => { for (let e = g.indptr[a]; e < g.indptr[a + 1]; e++) if (g.indices[e] === b) return true; return false; };
  const chain = [];
  for (let k = 0; k < out.length; k++) {
    chain.push(out[k]);
    let m = k + 1;
    while (m + 1 < out.length && nb(out[k], out[m + 1])) m++;
    k = m - 1;
  }
  return chain;
}
/** Holds a forced river's valley: each node below the one before it and a little below its other neighbors (never
 * raised; the sea and the frame's outlets left alone). */
export function holdForced(g, h, nodes, fixed, outlet) {
  const on = (nodes.on ??= new Set(nodes));
  for (let k = 1; k < nodes.length; k++) {
    const i = nodes[k], p = nodes[k - 1];
    if ((fixed && fixed[i]) || (outlet && outlet[i])) continue;
    let mn = Infinity;
    for (let e = g.indptr[i]; e < g.indptr[i + 1]; e++) { const j = g.indices[e]; if (j !== p && !on.has(j) && h[j] < mn) mn = h[j]; }
    const cap = Math.min(h[p] - 1e-6, mn - 0.002);
    if (h[i] > cap) h[i] = Math.min(h[i], Math.max(0.0005, cap));
  }
}

/**
 * A forced river that ends on ground rising around it floods back along its own valley: here the least cut that lets
 * its end drain on is made, away from the river's course (two neighbors' width of it kept clear, so no ditch runs
 * beside it). Left alone when its end is in a lake that isn't mostly its own valley (a river drawn into a lake), or no
 * way out is found within reach. w: routing made after the hold (fillRoute). Returns whether anything was cut.
 */
export function breachForced(g, h, w, nodes, fixed, outlet) {
  const end = nodes[nodes.length - 1], on = (nodes.on ??= new Set(nodes));
  if (nodes.length < 2 || (outlet && outlet[end]) || !(w.hf[end] > h[end])) return false;
  // (cut into rising ground, its end sits well below the ground beside it; in a lake's bed it doesn't: a river drawn
  // into a lake, and a lake that is mostly not the river's own valley, are left as they are)
  let beside = Infinity;
  for (let e = g.indptr[end]; e < g.indptr[end + 1]; e++) { const j = g.indices[e]; if (!on.has(j) && h[j] < beside) beside = h[j]; }
  if (beside - h[end] < 0.5 * (w.hf[end] - h[end]) || !trenchFlood(g, h, w, end, on)) return false;
  // (the course and two rings of neighbors around it kept clear, but for its last few nodes, where the way out starts)
  const clear = new Uint8Array(g.n);
  const tail = new Set(nodes.slice(-3));
  let ring = nodes.filter((k) => !tail.has(k));
  for (const k of ring) clear[k] = 1;
  for (let pass = 0; pass < 2; pass++) {
    const next = [];
    for (const k of ring) for (let e = g.indptr[k]; e < g.indptr[k + 1]; e++) { const j = g.indices[e]; if (!clear[j] && !tail.has(j)) { clear[j] = 1; next.push(j); } }
    ring = next;
  }
  for (const k of nodes) clear[k] = 1;
  clear[end] = 0;
  // (least cost: the length, and dearly the height that would have to be cut down to the end's level)
  const base = h[end], cost = new Float64Array(g.n).fill(Infinity), prev = new Int32Array(g.n).fill(-1);
  const heap = new Heap(256);
  cost[end] = 0; heap.push(0, end);
  let goal = -1, popped = 0;
  while (heap.size && popped < 20000) {
    const i = heap.pop();
    if (heap.lastKey > cost[i]) continue;
    popped++;
    if (i !== end && ((outlet && outlet[i]) || (h[i] < base && w.hf[i] <= h[i] && !on.has(w.rec[i])))) { goal = i; break; }
    for (let e = g.indptr[i]; e < g.indptr[i + 1]; e++) {
      const j = g.indices[e];
      if (clear[j] || (fixed && fixed[j])) continue;
      const c = cost[i] + g.elen[e] * (1 + 2000 * Math.max(0, h[j] - base));
      if (c < cost[j]) { cost[j] = c; prev[j] = i; heap.push(c, j); }
    }
  }
  if (goal < 0) return false;
  const path = [];
  for (let k = goal; k !== end && k >= 0; k = prev[k]) path.push(k);
  path.reverse();
  let last = base;
  for (const k of path) {
    if (outlet && outlet[k]) break;
    if (h[k] >= last) h[k] = Math.max(0.0005, last - 1e-6);
    last = h[k];
  }
  return true;
}

/**
 * Whether the flooded hollow a forced river ends in is the river's own valley flooding back along itself (its nodes
 * a good share of the hollow), not a lake it runs into.
 */
function trenchFlood(g, h, w, start, on) {
  const seen = new Set([start]), queue = [start];
  let course = 0;
  for (let q = 0; q < queue.length && queue.length < 5000; q++) {
    const i = queue[q];
    if (on.has(i)) course++;
    for (let e = g.indptr[i]; e < g.indptr[i + 1]; e++) { const j = g.indices[e]; if (!seen.has(j) && w.hf[j] > h[j]) { seen.add(j); queue.push(j); } }
  }
  return course >= 0.25 * queue.length;
}

export { fillRoute, accumulate };
