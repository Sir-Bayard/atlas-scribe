/**
 * Coasts with a cause, made part way through the wearing down of the land: the sea a little above the shore's low
 * ground (so valleys flood into inlets, ridges stand out as headlands and hilltops as islands, more where the coast is
 * steep), skerries off high coasts, estuaries and deltas at the big rivers' mouths, and spits and barrier islands with
 * lagoons along low, smooth coasts. Each form is listed for the inventory, so it is named. Generator 3 on; a land kept
 * by an older generator never runs these. Pure: works on the arrays in place.
 */
import { hashAt } from "../rng.mjs";
import { len } from "./dmath.mjs";

/** How far the sea rises above the shore's low ground, in the land's height units (1 is about 5 km): about 60 m where
 * the coast is steep. */
export const DROWN_RISE = 0.012;
/** The land the rise may take at most, as a share of the land. */
export const DROWN_MOST = 0.08;

// (each node's neighbors, by graph steps, within k steps)
function rings(g, i, k, fn) {
  const seen = new Map([[i, 0]]), q = [i];
  for (let a = 0; a < q.length; a++) {
    const u = q[a], d = seen.get(u);
    fn(u, d);
    if (d >= k) continue;
    for (let e = g.indptr[u]; e < g.indptr[u + 1]; e++) { const v = g.indices[e]; if (!seen.has(v)) { seen.set(v, d + 1); q.push(v); } }
  }
}

/**
 * The coast forms of one land: drowning, skerries, estuaries, deltas, spits and barriers, in that order. g: the graph;
 * h, landMask, outlet, fixedH: changed in place (a node given to the sea gets h 0 and becomes an outlet; a node raised
 * from it a small height); held: nodes whose heights the GM fixed (never given to the sea); A: each node's drained
 * area (square miles) on the land, for the rivers' mouths; rec: each node's receiver on that land (so an estuary
 * follows its own river up); frame; seed; scale (kingdom, realm, continent, world); threshold: a river's drained area;
 * spacing: the graph's spacing near the land. Returns { features: [{ kind, x, y, size, nodes }], drowned, raised }
 * (kinds: estuary, delta, spit, lagoon; x, y on a member node).
 */
export function coastForms({ g, h, landMask, outlet, fixedH, held = null, A, rec = null, frame, seed, scale, threshold, spacing: step = null }) {
  const n = g.n, features = [];
  const sea = (i) => !landMask[i];
  const inMap = (i) => frame.inMap(g.x[i], g.y[i]);
  const L = Math.max(frame.mapW, frame.mapH);
  let landArea = 0; for (let i = 0; i < n; i++) if (landMask[i] && inMap(i)) landArea += g.area[i];
  if (landArea <= 0) return { features, drowned: 0, raised: 0 };
  const coastNode = (i) => { if (!landMask[i]) return false; for (let e = g.indptr[i]; e < g.indptr[i + 1]; e++) if (sea(g.indices[e])) return true; return false; };
  const toSea = (i) => { landMask[i] = 0; outlet[i] = 1; h[i] = 0; fixedH[i] = 0; };
  // (a form's point: the member node nearest its middle, so a label put there lies on it)
  const pointOf = (nodes) => { let sx = 0, sy = 0; for (const u of nodes) { sx += g.x[u]; sy += g.y[u]; } sx /= nodes.length; sy /= nodes.length; let b = nodes[0], bd = Infinity; for (const u of nodes) { const d = (g.x[u] - sx) ** 2 + (g.y[u] - sy) ** 2; if (d < bd || (d === bd && u < b)) { bd = d; b = u; } } return { x: g.x[b], y: g.y[b] }; };
  const toLand = (i, v) => { landMask[i] = 1; outlet[i] = g.border[i] ? 1 : 0; h[i] = v; fixedH[i] = g.border[i] ? v : 0; };

  // ---- drowning: the sea rises up the valleys from the coast, by how steep the coast is ----
  // (relief: how far a node is below the highest ground within three steps; a steep coast drowns deeper)
  // (the highest land within three steps, by three passes of a neighbor maximum)
  let top = Float64Array.from(h, (v, i) => (landMask[i] ? v : 0));
  for (let pass = 0; pass < 3; pass++) {
    const next = Float64Array.from(top);
    for (let i = 0; i < n; i++) for (let e = g.indptr[i]; e < g.indptr[i + 1]; e++) { const v = top[g.indices[e]]; if (v > next[i]) next[i] = v; }
    top = next;
  }
  const relief = new Float64Array(n);
  for (let i = 0; i < n; i++) if (landMask[i]) relief[i] = top[i] - h[i];
  // (the sea's rise is above the coast's own low ground, the lowest third of its shore: the land the solver made stands a
  // little above the sea everywhere, so a rise from zero would reach nothing)
  const shore = []; for (let i = 0; i < n; i++) if (coastNode(i) && inMap(i)) shore.push(h[i]);
  shore.sort((p, q) => p - q);
  const base = shore.length ? shore[Math.floor(0.3 * (shore.length - 1))] : 0;
  // (low ground, for deltas and spits: within about 70 m of the shore's low ground)
  const lowH = base + 0.014;
  const level = (i) => base + DROWN_RISE * Math.min(1.5, Math.max(0.15, relief[i] / 0.06));
  // (a priority flood from the sea, lowest first, no further inland than a twentieth of the map, the take capped; in
  // the map only, as the cap is of the map's land)
  const reach = 0.05 * L, cap = DROWN_MOST * landArea;
  const dist = new Float64Array(n).fill(Infinity), took = new Uint8Array(n);
  const heap = [];
  const push = (key, i) => { heap.push([key, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] < heap[k][0] || (heap[p][0] === heap[k][0] && heap[p][1] <= heap[k][1])) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const first = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const a = 2 * k + 1, b = a + 1; let m = k; if (a < heap.length && (heap[a][0] < heap[m][0] || (heap[a][0] === heap[m][0] && heap[a][1] < heap[m][1]))) m = a; if (b < heap.length && (heap[b][0] < heap[m][0] || (heap[b][0] === heap[m][0] && heap[b][1] < heap[m][1]))) m = b; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return first; };
  for (let i = 0; i < n; i++) if (coastNode(i) && inMap(i)) { let d = Infinity; for (let e = g.indptr[i]; e < g.indptr[i + 1]; e++) { const j = g.indices[e]; if (sea(j)) d = Math.min(d, len(g.x[i] - g.x[j], g.y[i] - g.y[j]) * 0.5); } dist[i] = d; push(h[i] - level(i), i); }
  let drowned = 0, taken = 0;
  while (heap.length) {
    const [key, i] = pop();
    if (took[i] || !landMask[i] || key >= 0 || g.border[i] || held?.[i]) continue;
    if (taken + g.area[i] > cap) break;
    took[i] = 1; taken += g.area[i]; drowned++;
    for (let e = g.indptr[i]; e < g.indptr[i + 1]; e++) {
      const j = g.indices[e];
      if (!landMask[j] || took[j] || !inMap(j)) continue;
      const d = dist[i] + len(g.x[i] - g.x[j], g.y[i] - g.y[j]);
      if (d < dist[j]) dist[j] = d;
      if (dist[j] <= reach) push(Math.max(key, h[j] - level(j)), j);
    }
  }
  for (let i = 0; i < n; i++) if (took[i]) toSea(i);

  // ---- skerries: islets in the sea just off a high coast ----
  let raised = 0;
  for (let i = 0; i < n; i++) {
    if (landMask[i] || g.border[i] || !inMap(i)) continue;
    // (two steps out, not beside the land: a few of them, more off higher ground, by a hash)
    let near = false;
    for (let e = g.indptr[i]; e < g.indptr[i + 1]; e++) if (landMask[g.indices[e]]) { near = true; break; }
    if (near) continue;
    let high = 0;
    rings(g, i, 2, (u, d) => { if (d === 2 && landMask[u]) high = Math.max(high, h[u]); });
    if (high > 0.08 && hashAt(i, 41, seed) < 0.05 + 0.4 * Math.min(1, (high - 0.08) / 0.2)) { toLand(i, 0.004 + 0.01 * hashAt(i, 42, seed)); raised++; }
  }

  // ---- the big rivers' mouths: estuaries where the coast is steep or drowned, deltas where it's low ----
  // (land beside the sea draining twice a river's area, the biggest first, kept apart, six at most)
  const mouths = [];
  for (let i = 0; i < n; i++) {
    if (!landMask[i] || !inMap(i) || A[i] < 2 * threshold) continue;
    let toS = false; for (let e = g.indptr[i]; e < g.indptr[i + 1]; e++) if (sea(g.indices[e])) { toS = true; break; }
    if (toS) mouths.push(i);
  }
  mouths.sort((a, b) => A[b] - A[a] || a - b);
  const used = [];
  // (the graph's spacing where it's dense, near the land)
  const spacing = Math.max(1e-3, step ?? Math.sqrt(landArea / Math.max(1, n)));
  for (const m of mouths) {
    if (used.some((u) => len(g.x[u] - g.x[m], g.y[u] - g.y[m]) < 0.08 * L)) continue;
    if (features.filter((f) => f.kind === "estuary" || f.kind === "delta").length >= 6) break;
    used.push(m);
    // (how low the coast is around the mouth)
    let low = 0, cnt = 0; rings(g, m, 3, (u) => { if (landMask[u]) { cnt++; if (h[u] < lowH) low++; } });
    const flat = low / Math.max(1, cnt);
    const size = Math.sqrt(A[m] / threshold);
    if (flat > 0.6) {
      // a delta: a fan of low land out into the sea before the mouth, lobed by a hash
      const dx = [], dy = [];
      for (let e = g.indptr[m]; e < g.indptr[m + 1]; e++) { const j = g.indices[e]; if (sea(j)) { dx.push(g.x[j] - g.x[m]); dy.push(g.y[j] - g.y[m]); } }
      const ax = dx.reduce((s, v) => s + v, 0), ay = dy.reduce((s, v) => s + v, 0), al = len(ax, ay) || 1;
      const R = Math.min(0.04 * L, (2 + size) * spacing);
      const nodes = [];
      rings(g, m, Math.ceil(R / spacing) + 1, (u) => {
        if (landMask[u] || g.border[u] || !inMap(u)) return;
        const vx = g.x[u] - g.x[m], vy = g.y[u] - g.y[m], along = (vx * ax + vy * ay) / al, across = Math.abs(vx * ay - vy * ax) / al, r = len(vx, vy);
        if (along <= 0 || r > R * (0.75 + 0.5 * hashAt(u, 43, seed)) || across > along * 1.4 + spacing) return;
        nodes.push(u);
      });
      for (const u of nodes) toLand(u, 0.002 + 0.002 * hashAt(u, 44, seed));
      raised += nodes.length;
      if (nodes.length >= 3) features.push({ kind: "delta", ...pointOf(nodes), size: nodes.length, nodes });
    } else {
      // an estuary: the river's last miles widen into a funnel of sea
      const path = [m];
      for (let k = 0; k < 40; k++) {
        const u = path[path.length - 1];
        let best = -1, ba = 0;
        for (let e = g.indptr[u]; e < g.indptr[u + 1]; e++) { const j = g.indices[e]; if (landMask[j] && (rec ? rec[j] === u : A[j] < A[u]) && A[j] > ba && !path.includes(j)) { ba = A[j]; best = j; } }
        if (best < 0 || A[best] < 0.5 * A[m]) break;
        path.push(best);
      }
      const Lest = Math.min(0.06 * L, (3 + 1.5 * size) * spacing);
      const nodes = [];
      let run = 0;
      for (let k = 0; k < path.length; k++) {
        if (k) run += len(g.x[path[k]] - g.x[path[k - 1]], g.y[path[k]] - g.y[path[k - 1]]);
        if (run > Lest) break;
        const wid = (1 - run / Lest) * (0.8 + 0.4 * size) * spacing;
        rings(g, path[k], Math.ceil(wid / spacing) + 1, (u) => { if (landMask[u] && !g.border[u] && !held?.[u] && len(g.x[u] - g.x[path[k]], g.y[u] - g.y[path[k]]) <= wid && h[u] < 0.08) nodes.push(u); });
      }
      const uniq = [...new Set(nodes)];
      for (const u of uniq) toSea(u);
      drowned += uniq.length;
      if (uniq.length >= 3) features.push({ kind: "estuary", ...pointOf(uniq), size: uniq.length, nodes: uniq });
    }
  }

  // ---- spits and barrier islands, with lagoons behind them, along low smooth coasts (kingdom and realm maps) ----
  if (scale === "kingdom" || scale === "realm") {
    const isCoast = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (coastNode(i)) isCoast[i] = 1;
    // (a stretch qualifies where the land behind it is low and flat, farther from the mouths than a bar reaches)
    const lowCoast = [];
    for (let i = 0; i < n; i++) {
      if (!isCoast[i] || !inMap(i) || g.border[i] || h[i] > base + 0.008) continue;
      let hi = 0; rings(g, i, 2, (u) => { if (landMask[u]) hi = Math.max(hi, h[u]); });
      if (hi < lowH && !used.some((u) => len(g.x[u] - g.x[i], g.y[u] - g.y[i]) < 0.1 * L)) lowCoast.push(i);
    }
    // (a barrier starts at a few of them, by a hash, apart from each other)
    const starts = lowCoast.filter((i) => hashAt(i, 45, seed) < 0.06).sort((a, b) => a - b);
    const done = [];
    for (const s of starts) {
      if (done.some((u) => len(g.x[u] - g.x[s], g.y[u] - g.y[s]) < 0.1 * L) || features.filter((f) => f.kind === "spit").length >= 4) continue;
      done.push(s);
      // the barrier: sea nodes two steps out from the coast near the start, along about a fifteenth of the map
      const span = 0.07 * L, bar = [], lagoon = [];
      rings(g, s, Math.ceil(span / spacing), (u) => {
        if (landMask[u] || g.border[u] || !inMap(u) || len(g.x[u] - g.x[s], g.y[u] - g.y[s]) > span) return;
        // (its steps from the coast; only along low land: a sea node by high ground is no part of a barrier or its
        // lagoon)
        let d1 = false, d2 = false, high = false;
        for (let e = g.indptr[u]; e < g.indptr[u + 1]; e++) { const j = g.indices[e]; if (landMask[j]) { d1 = true; if (h[j] >= lowH) high = true; } else for (let f = g.indptr[j]; f < g.indptr[j + 1]; f++) { const k = g.indices[f]; if (landMask[k]) { d2 = true; if (h[k] >= lowH) high = true; } } }
        if (high) return;
        if (d1) lagoon.push(u); else if (d2) bar.push(u);
      });
      if (bar.length < 4) continue;
      // (an inlet or two through it, by a hash: a spit stays joined at its start, a barrier island doesn't)
      const joined = hashAt(s, 46, seed) < 0.5;
      const kept = bar.filter((u) => hashAt(u, 47, seed) > 0.12);
      if (kept.length < 3) continue;
      for (const u of kept) toLand(u, 0.002 + 0.001 * hashAt(u, 48, seed));
      raised += kept.length;
      // (a spit: the lagoon closed at its start, so the bar runs out from the shore)
      const root = joined ? lagoon.filter((u) => len(g.x[u] - g.x[s], g.y[u] - g.y[s]) < spacing * 2) : [];
      for (const u of root) toLand(u, 0.002);
      const open = lagoon.filter((u) => !root.includes(u));
      features.push({ kind: "spit", ...pointOf(kept), size: kept.length, nodes: kept, joined });
      if (open.length >= 3) features.push({ kind: "lagoon", ...pointOf(open), size: open.length, nodes: open });
    }
  }
  return { features, drowned, raised };
}
