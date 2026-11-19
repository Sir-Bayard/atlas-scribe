/**
 * Water on the finished land: flat valley floors along big rivers, lakes (flooded basins with a level, a water
 * balance, one outlet or none, and salt flats where a closed lake has shrunk), rivers drawn from the drainage tree
 * by catchment in square miles (merging, never splitting), each with its main stem, order, head of navigation and
 * falls, and a GM's forced river course. Lengths in miles, areas in square miles. Pure.
 */
import { fillRoute, accumulate } from "./solver.mjs";
import { Heap } from "./heap.mjs";
import { len } from "./dmath.mjs";

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
 * Lakes. ctx: { g, h, w (fillRoute work, routed on h), np, rain, temp, land, outlet, pxPerMile }. Every flooded
 * basin is a lake candidate; its level is the basin's filled height. Water balance: inflow (the runoff of its
 * catchment: rain less what the land gives back to the air, a share that grows with warmth and dryness, as Budyko's
 * curve) against evaporation (its open water's area times warmth); what's left leaves by its outlet, and the flow below
 * a lake is cut by the share it kept, so a hot, dry basin's lakes close where a wet one's overflow. A closed lake
 * keeps its deepest share and the rest becomes salt flat. Returns { lake (Uint8Array), salt, lakeId (Int32Array),
 * lakes: [{ id, level, area, inflow, evap, closed, outlet }], F (flow with lakes) }.
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
  const minArea = Math.max(40 / (ctx.pxPerMile * ctx.pxPerMile), 4 * meanArea);
  const lakes = [], lakeOfReg = new Int32Array(regs.length).fill(-1);
  for (const r of regs) if (r.open >= minArea) { lakeOfReg[r.id] = lakes.length; lakes.push({ id: lakes.length, reg: r.id, area: r.open, level: 0, inflow: 0, evap: r.open * (0.06 + 0.35 * Math.min(1, Math.max(0, r.temp))), closed: false, outlet: -1 }); }
  // flow with lakes: evaporation is taken from what leaves each lake by its outlet
  // (F, the flow drawn as rivers, is rain; Q, the water balance's, is runoff)
  const F = new Float64Array(n), Q = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = Math.max(0, rain[i]), pet = 0.3 + 0.9 * Math.min(1, Math.max(0, temp[i]));
    F[i] = r * g.area[i]; Q[i] = ((r * r) / (r + pet || 1)) * g.area[i];
  }
  const left = lakes.map((L) => L.evap);
  for (let k = np - 1; k >= 0; k--) {
    const i = pop[k], r = rec[i];
    if (r === i) continue;
    const li = reg[i] >= 0 ? lakeOfReg[reg[i]] : -1;
    if (li >= 0 && reg[r] !== reg[i]) {
      lakes[li].inflow += Q[i]; lakes[li].outlet = i;
      const take = Math.min(Q[i], left[li]); left[li] -= take;
      const kept = Q[i] > 0 ? (Q[i] - take) / Q[i] : 1;
      Q[r] += Q[i] - take; F[r] += F[i] * kept;
    } else { Q[r] += Q[i]; F[r] += F[i]; }
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
 * Rivers. ctx: { g, h, w (routed), F (flow with lakes), land, lake, outlet, threshold (catchment to draw) }. Main
 * channels where F >= threshold; heads a few steps further up where F >= threshold / 3 if they join a main channel.
 * Each river from its source to where it ends (the sea, a lake, the frame's edge, or a larger river: at a
 * confluence the larger flow keeps the river's identity). Returns { rivers: [{ id, parent, order, main, points:
 * [[x, y, F, slope]...], ends: "sea" | "lake" | "edge" | "river", nodes }], drawn (Uint8Array), riverOf (Int32Array) }.
 */
export function riversStage(ctx) {
  const { g, h, w, F, land, lake, outlet, threshold } = ctx;
  const { rec, rd } = w;
  const n = g.n;
  const main = new Uint8Array(n), drawn = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (land[i] && !lake[i] && F[i] >= threshold) main[i] = 1;
  // (a river the GM drew is drawn its whole length, however little drains into its first reach)
  for (const list of ctx.forced ?? []) for (const i of list) if (land[i] && !lake[i]) main[i] = 1;
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
    const ends = parent >= 0 ? "river" : lake[r] ? "lake" : !land[r] ? "sea" : outlet[r] || r === last ? "edge" : "river";
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
 * A GM's forced river: the nodes along its course (source to mouth), held as a valley that runs downhill. Called
 * after each solver step. path: [[x, y]...] frame miles; nearest: node lookup. Returns the node list (once) when
 * nodes is null.
 */
export function forcedNodes(path, nearest, spacing) {
  const out = [];
  for (let k = 0; k + 1 < path.length; k++) {
    const [ax, ay] = path[k], [bx, by] = path[k + 1], L = len(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(L / (spacing * 0.5)));
    for (let s = 0; s <= steps; s++) { const j = nearest(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps); if (out[out.length - 1] !== j) out.push(j); }
  }
  return out;
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

export { fillRoute, accumulate };
