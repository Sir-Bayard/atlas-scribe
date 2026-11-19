/**
 * Plates: grown over the graph from seeds by a noisy flood fill (Dijkstra with a cost that wanders), so they are
 * ragged and unequal and their edges don't look like Voronoi lines. Each drifts its own way and is oceanic or
 * continental by the shape field under it. Plates don't decide where land is (that's the recipe); they decide where
 * ranges go: boundaries where plates close become range spines, chained into polylines by kind (two continents,
 * ocean under continent, two oceans), and parting boundaries on land become rifts. Pure.
 */
import { Heap } from "./heap.mjs";
import { exp, log, cos, sin, len, PI } from "./dmath.mjs";

/** How many plates: auto by the frame's area (about one per 600,000 square miles), or few, some, many, or a count. */
export function plateCount(setting, frameArea) {
  const auto = Math.max(2, Math.round(frameArea / 600000));
  if (Number.isInteger(setting) && setting >= 2) return Math.min(40, setting);
  const k = { few: 0.6, some: 1, many: 1.8 }[setting] ?? 1;
  return Math.min(40, Math.max(2, Math.round(auto * k)));
}

/**
 * g: the graph; shape: shape value per node; wander: a noise value per node (deviation 1); count; r: a random stream.
 * Returns { plate (Int32Array), count, vel (Float64Array 2 per plate), continental (Uint8Array) }.
 */
export function growPlates(g, shape, wander, count, r) {
  const n = g.n, plate = new Int32Array(n).fill(-1), dist = new Float64Array(n).fill(Infinity);
  const heap = new Heap(n);
  const seeds = [];
  const pr = r.fork("seeds");
  while (seeds.length < Math.min(count, n)) { const s = pr.int(n); if (!seeds.includes(s)) seeds.push(s); }
  seeds.forEach((s, p) => { plate[s] = p; dist[s] = 0; heap.push(0, s); });
  const cost = new Float64Array(n);
  for (let i = 0; i < n; i++) cost[i] = exp(1.1 * wander[i]);
  while (heap.size) {
    const i = heap.pop(), d = heap.lastKey;
    if (d > dist[i]) continue;
    for (let k = g.indptr[i]; k < g.indptr[i + 1]; k++) {
      const j = g.indices[k], nd = d + g.elen[k] * cost[j];
      if (nd < dist[j]) { dist[j] = nd; plate[j] = plate[i]; heap.push(nd, j); }
    }
  }
  const vr = r.fork("drift"), vel = new Float64Array(2 * count);
  for (let p = 0; p < count; p++) {
    // (a normal pair by Box-Muller)
    const u1 = Math.max(1e-12, vr.next()), u2 = vr.next(), m = Math.sqrt(-2 * log(u1));
    vel[2 * p] = m * cos(2 * PI * u2); vel[2 * p + 1] = m * sin(2 * PI * u2);
  }
  // continental where at least a third of the plate is land in the shape field
  const landA = new Float64Array(count), cnt = new Float64Array(count);
  for (let i = 0; i < n; i++) { if (shape[i] > 0) landA[plate[i]] += g.area[i]; cnt[plate[i]] += g.area[i]; }
  const continental = new Uint8Array(count);
  for (let p = 0; p < count; p++) continental[p] = cnt[p] > 0 && landA[p] / cnt[p] > 0.33 ? 1 : 0;
  return { plate, count, vel, continental };
}

/**
 * Boundaries as spines. For every pair of plates, the nodes on one side next to the other, with how hard they close
 * (positive) or part (negative), chained into polylines through neighboring boundary nodes and split where the sign
 * changes. Returns [{ points: [[x, y]...], kind: "collision" | "coastal" | "arc" | "rift", conv (mean), side: the
 * plate the spine's range leans onto (continental side, or the larger), steep: +1 or -1 (which side of the line is
 * steeper, the incoming one), a, b (the plates) }].
 */
export function boundarySpines(g, plates, minLenMi) {
  const { plate, vel, continental } = plates;
  const n = g.n;
  const conv = new Float64Array(n), other = new Int32Array(n).fill(-1), isB = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let best = 0, bestAbs = -1, nb = -1;
    for (let k = g.indptr[i]; k < g.indptr[i + 1]; k++) {
      const j = g.indices[k];
      if (plate[j] === plate[i]) continue;
      const a = plate[i], b = plate[j];
      const dx = (g.x[j] - g.x[i]) / g.elen[k], dy = (g.y[j] - g.y[i]) / g.elen[k];
      const c = (vel[2 * a] - vel[2 * b]) * dx + (vel[2 * a + 1] - vel[2 * b + 1]) * dy;
      if (Math.abs(c) > bestAbs) { bestAbs = Math.abs(c); best = c; nb = b; }
    }
    if (nb >= 0) { isB[i] = 1; conv[i] = best; other[i] = nb; }
  }
  // normalize closing speeds to about -1..1
  let mx = 1e-9;
  for (let i = 0; i < n; i++) if (isB[i] && Math.abs(conv[i]) > mx) mx = Math.abs(conv[i]);
  for (let i = 0; i < n; i++) conv[i] /= mx;
  // chain: within one (plate, other plate, sign) set, walk through neighboring nodes of the set
  const kindOf = (i) => (conv[i] > 0.2 ? 1 : conv[i] < -0.2 ? -1 : 0);
  const used = new Uint8Array(n), spines = [];
  const inSet = (i, a, b, s) => isB[i] && !used[i] && plate[i] === a && other[i] === b && kindOf(i) === s;
  const nbrs = (i, a, b, s) => { const out = []; for (let k = g.indptr[i]; k < g.indptr[i + 1]; k++) { const j = g.indices[k]; if (inSet(j, a, b, s)) out.push(j); } return out; };
  for (let s0 = 0; s0 < n; s0++) {
    if (!isB[s0] || used[s0] || kindOf(s0) === 0) continue;
    // the plate pair is walked from the lower-numbered plate's side only, so each boundary gives one spine
    const a = plate[s0], b = other[s0], s = kindOf(s0);
    if (a > b) continue;
    // find an end: walk away from s0 until no new neighbor
    let start = s0;
    { const seen = new Set([s0]); let cur = s0; for (;;) { const nx = nbrs(cur, a, b, s).find((j) => !seen.has(j)); if (nx === undefined) break; seen.add(nx); cur = nx; } start = cur; }
    const chain = [start]; used[start] = 1;
    let cur = start;
    for (;;) {
      const cand = nbrs(cur, a, b, s);
      if (!cand.length) break;
      // (the farthest-along neighbor: closest to continuing straight)
      let pick = cand[0];
      if (chain.length >= 2) {
        const p = chain[chain.length - 2], dx = g.x[cur] - g.x[p], dy = g.y[cur] - g.y[p];
        let bestDot = -Infinity;
        for (const j of cand) { const d = (g.x[j] - g.x[cur]) * dx + (g.y[j] - g.y[cur]) * dy; if (d > bestDot) { bestDot = d; pick = j; } }
      }
      used[pick] = 1; chain.push(pick); cur = pick;
      // (the rest of the set's neighbors at this node are marked so parallel rows don't make twin spines)
      for (const j of cand) used[j] = 1;
    }
    let L = 0;
    for (let k = 1; k < chain.length; k++) L += len(g.x[chain[k]] - g.x[chain[k - 1]], g.y[chain[k]] - g.y[chain[k - 1]]);
    if (L < minLenMi) continue;
    const ca = continental[a], cb = continental[b];
    let mean = 0; for (const i of chain) mean += conv[i]; mean /= chain.length;
    const kind = s < 0 ? "rift" : ca && cb ? "collision" : ca || cb ? "coastal" : "arc";
    const lean = ca && !cb ? a : cb && !ca ? b : a; // (a coastal range stands on the continental plate)
    spines.push({ points: smooth(chain.map((i) => [g.x[i], g.y[i]])), kind, conv: mean, lean, a, b, side: a });
  }
  return { spines, conv, isB };
}

/** Chaikin's corner cutting, twice. */
function smooth(pts) {
  let p = pts;
  for (let t = 0; t < 2 && p.length > 2; t++) {
    const q = [p[0]];
    for (let k = 0; k + 1 < p.length; k++) { const [a, b] = [p[k], p[k + 1]]; q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}
