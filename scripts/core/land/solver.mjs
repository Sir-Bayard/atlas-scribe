/**
 * Uplift against erosion on the land's graph (Braun and Willett's implicit stream-power scheme, m = 0.5, n = 1),
 * with hillslope diffusion, a talus cap, basins kept as lakes or filled, and nodes held fixed. Heights in units where
 * 1 is high mountains; lengths in miles; areas in square miles. Only + - * / and Math.sqrt in the loops, so the
 * result is the same bits in every engine. Pure.
 */
import { Heap } from "./heap.mjs";

/**
 * Work arrays for a graph, made once and reused every step: { hf, rec, rd, pop, A, tmp, done, heap }.
 */
export function workFor(g) {
  const n = g.n;
  return {
    hf: new Float64Array(n), rec: new Int32Array(n), rd: new Float64Array(n), pop: new Int32Array(n),
    A: new Float64Array(n), tmp: new Float64Array(n), done: new Uint8Array(n), heap: new Heap(Math.max(1024, n)),
    eps: epsilonsFor(g), ...diffusionWeights(g),
    basin: new Int32Array(n), basinArea: new Float64Array(n), stack: new Int32Array(n),
  };
}

/** Diffusion's edge weights (1 / length) and each node's total, worked out once. */
function diffusionWeights(g) {
  const ew = new Float64Array(g.indices.length), sw = new Float64Array(g.n);
  for (let i = 0; i < g.n; i++) for (let k = g.indptr[i]; k < g.indptr[i + 1]; k++) { ew[k] = 1 / g.elen[k]; sw[i] += ew[k]; }
  return { ew, sw };
}

/** Per-edge epsilons for the flood: a tiny rise per mile, varied 1 to 1.5 times by a hash so flats drain by uneven routes. */
function epsilonsFor(g) {
  const eps = new Float64Array(g.indices.length);
  for (let i = 0; i < g.n; i++) for (let k = g.indptr[i]; k < g.indptr[i + 1]; k++) {
    let h = (i * 73856093) ^ (g.indices[k] * 19349663);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h ^= h >>> 16;
    eps[k] = 1e-7 * g.elen[k] * (1 + 0.5 * ((h >>> 0) / 4294967296));
  }
  return eps;
}

/**
 * Priority flood from the outlets (Barnes): hf never below h, every node with a strictly lower path out. Records
 * each node's receiver (steepest descent on hf), the distance to it, and the order nodes left the heap (ascending
 * hf: a valid order for accumulation, reversed, and for the implicit update). Returns the count popped.
 */
export function fillRoute(g, h, outlet, w) {
  const { indptr, indices, elen } = g;
  const { hf, rec, rd, pop, done, heap, eps } = w;
  const n = g.n;
  heap.clear(); done.fill(0);
  let np = 0;
  for (let i = 0; i < n; i++) {
    hf[i] = h[i];
    if (!outlet[i]) continue;
    done[i] = 1;
    // (only outlets beside land go in the heap: open sea pops nothing useful)
    let edge = false;
    for (let k = indptr[i]; k < indptr[i + 1]; k++) if (!outlet[indices[k]]) { edge = true; break; }
    if (edge) heap.push(h[i], i); else pop[np++] = i;
  }
  while (heap.size > 0) {
    const i = heap.pop();
    pop[np++] = i;
    const hi = hf[i];
    for (let k = indptr[i]; k < indptr[i + 1]; k++) {
      const j = indices[k];
      if (done[j]) continue;
      done[j] = 1;
      const m = hi + eps[k];
      if (hf[j] < m) hf[j] = m;
      heap.push(hf[j], j);
    }
  }
  for (let i = 0; i < n; i++) {
    rec[i] = i; rd[i] = 1;
    if (outlet[i]) continue;
    let best = 0;
    for (let k = indptr[i]; k < indptr[i + 1]; k++) {
      const s = (hf[i] - hf[indices[k]]) / elen[k];
      if (s > best) { best = s; rec[i] = indices[k]; rd[i] = elen[k]; }
    }
  }
  return np;
}

/** Flow: each node's weight (rain times area) plus all that drains through it. */
export function accumulate(w, weight, np) {
  const { A, rec, pop } = w;
  A.set(weight);
  for (let k = np - 1; k >= 0; k--) {
    const i = pop[k], r = rec[i];
    if (r !== i) A[r] += A[i];
  }
}

/**
 * One step: uplift, stream power (implicit, cutting toward a receiver's lake surface when it has one), basins
 * (small ones filled outright, big ones filled slowly), diffusion and talus. p: { U, K, dt, fill, smallArea (a basin
 * smaller than this, in square miles, is filled outright; by area alone, since a depth test filled the shallow basins
 * big lakes grow from), D (diffusion), passes, talus (per node), outlet, fixed }.
 */
export function step(g, h, w, p, np) {
  const { indptr, indices, elen } = g;
  const { hf, rec, rd, pop, A, tmp, ew, sw } = w;
  const { U, K, dt, fill, smallArea = 0, D, passes, talus, outlet, fixed } = p;
  const n = g.n;
  for (let i = 0; i < n; i++) if (!outlet[i] && !(fixed && fixed[i])) h[i] += U[i] * dt;
  // flooded basins this step, and their areas: small ones are filled outright, big ones kept as lakes that fill slowly
  const { basin, basinArea, stack } = w;
  basin.fill(-1);
  let nb = 0;
  for (let s = 0; s < n; s++) {
    if (basin[s] >= 0 || !(hf[s] - h[s] > 1e-6) || outlet[s]) continue;
    let top = 0, area = 0;
    stack[top++] = s; basin[s] = nb;
    while (top) {
      const i = stack[--top]; area += g.area[i];
      for (let e = indptr[i]; e < indptr[i + 1]; e++) { const j = indices[e]; if (basin[j] < 0 && !outlet[j] && hf[j] - h[j] > 1e-6) { basin[j] = nb; stack[top++] = j; } }
    }
    basinArea[nb++] = area < smallArea ? -area : area;
  }
  for (let k = 0; k < np; k++) {
    const i = pop[k];
    if (outlet[i] || (fixed && fixed[i])) continue;
    const r = rec[i];
    const base = h[r] > hf[r] ? h[r] : hf[r];
    if (h[i] > base) {
      const f = K[i] * Math.sqrt(Math.max(0, A[i])) * dt / rd[i];
      h[i] = (h[i] + f * base) / (1 + f);
    } else if (basin[i] < 0 || basinArea[basin[i]] < 0) h[i] = hf[i];
    else h[i] += fill * (hf[i] - h[i]);
  }
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < n; i++) {
      if (outlet[i] || (fixed && fixed[i])) { tmp[i] = h[i]; continue; }
      let sh = 0;
      for (let k = indptr[i]; k < indptr[i + 1]; k++) sh += ew[k] * h[indices[k]];
      tmp[i] = h[i] + D[i] * dt * (sh / sw[i] - h[i]);
    }
    h.set(tmp);
  }
  for (let k = 0; k < np; k++) {
    const i = pop[k];
    if (outlet[i] || (fixed && fixed[i])) continue;
    let cap = Infinity;
    for (let e = indptr[i]; e < indptr[i + 1]; e++) {
      const hj = h[indices[e]];
      if (hj < h[i]) { const c = hj + talus[i] * elen[e]; if (c < cap) cap = c; }
    }
    if (h[i] > cap) h[i] = cap;
  }
}
