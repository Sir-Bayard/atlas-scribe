/**
 * The land's graph: points over the context frame, joined by their Delaunay triangulation, as compact arrays
 * (neighbors in CSR form: node i's neighbors are indices[indptr[i] .. indptr[i + 1]]). Lengths in miles, areas in
 * square miles. Pure.
 *
 * Points come from a jittered grid at the finest spacing; each point gets a level from a hash of its grid cell (0 for
 * one in four, 1 for the next one in four, 2 for the rest), so the points of levels 0 and 1 are a subset of all three:
 * a preview made from a coarser set is the same land, coarser. keep(x, y, level) lets a caller thin points (deep sea,
 * the margin) without changing which points the others are.
 */
import { Delaunay } from "../../../vendor/d3-delaunay.mjs";
import { hashAt } from "../rng.mjs";

/**
 * points: { width, height } (miles), spacing (miles), seed, maxLevel (0 to 2: which levels to include), keep(x, y,
 * level) -> boolean. Returns { n, x, y (Float64Array), level (Uint8Array) }.
 */
export function makePoints({ width, height, spacing, seed = 1, maxLevel = 2, keep = null }) {
  // (whole cells across the frame, each a little wider or taller than spacing if need be, so no point is clamped
  // onto the frame's edge: points in a line along an edge make long, thin triangles)
  const cols = Math.max(2, Math.round(width / spacing)), rows = Math.max(2, Math.round(height / spacing));
  const sx = width / cols, sy = height / rows;
  const cap = cols * rows;
  const x = new Float64Array(cap), y = new Float64Array(cap), level = new Uint8Array(cap);
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const h = hashAt(c, r, 7, seed);
      const lv = h < 0.25 ? 0 : h < 0.5 ? 1 : 2;
      if (lv > maxLevel) continue;
      const px = (c + 0.5 + (hashAt(c, r, 1, seed) - 0.5) * 0.84) * sx;
      const py = (r + 0.5 + (hashAt(c, r, 2, seed) - 0.5) * 0.84) * sy;
      if (keep && !keep(px, py, lv)) continue;
      x[n] = px; y[n] = py; level[n] = lv; n++;
    }
  }
  // a ring of points on the frame's edge, at the coarsest spacing everywhere, so the hull is the frame and no long
  // thin triangles run along it (these are level 0: in every point set)
  const ring = [];
  const step = 2 * Math.max(sx, sy);
  const nx = Math.max(2, Math.round(width / step)), ny = Math.max(2, Math.round(height / step));
  for (let k = 0; k < nx; k++) { ring.push([(k * width) / nx, 0], [((k + 1) * width) / nx, height]); }
  for (let k = 0; k < ny; k++) { ring.push([width, (k * height) / ny], [0, ((k + 1) * height) / ny]); }
  const N = n + ring.length;
  const X = new Float64Array(N), Y = new Float64Array(N), LV = new Uint8Array(N);
  X.set(x.subarray(0, n)); Y.set(y.subarray(0, n)); LV.set(level.subarray(0, n));
  ring.forEach(([px, py], k) => { X[n + k] = px; Y[n + k] = py; LV[n + k] = 0; });
  return { n: N, x: X, y: Y, level: LV };
}

/**
 * The graph of a set of points. Returns { n, x, y, level, indptr (Int32Array n + 1), indices (Int32Array),
 * elen (Float64Array, miles), area (Float64Array, square miles: a third of each touching triangle), border
 * (Uint8Array: on the triangulation's hull), triangles (Int32Array, three nodes each) }.
 */
export function makeGraph(pts) {
  const { n, x, y } = pts;
  const coords = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) { coords[2 * i] = x[i]; coords[2 * i + 1] = y[i]; }
  const del = new Delaunay(coords);
  const tri = del.triangles, half = del.halfedges;
  const next = (e) => (e % 3 === 2 ? e - 2 : e + 1);
  // every half-edge gives a directed edge; a hull half-edge (no twin) gives its reverse too
  const deg = new Int32Array(n);
  for (let e = 0; e < tri.length; e++) {
    deg[tri[e]]++;
    if (half[e] < 0) deg[tri[next(e)]]++;
  }
  const indptr = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) indptr[i + 1] = indptr[i] + deg[i];
  const indices = new Int32Array(indptr[n]);
  const fill = indptr.slice(0, n);
  const border = new Uint8Array(n);
  for (let e = 0; e < tri.length; e++) {
    const a = tri[e], b = tri[next(e)];
    indices[fill[a]++] = b;
    if (half[e] < 0) { indices[fill[b]++] = a; border[a] = 1; border[b] = 1; }
  }
  // (each node's neighbors in index order, so every walk over them is the same in every engine)
  for (let i = 0; i < n; i++) indices.subarray(indptr[i], indptr[i + 1]).sort();
  const elen = new Float64Array(indices.length);
  for (let i = 0; i < n; i++) for (let k = indptr[i]; k < indptr[i + 1]; k++) {
    const j = indices[k], dx = x[j] - x[i], dy = y[j] - y[i];
    elen[k] = Math.sqrt(dx * dx + dy * dy);
  }
  const area = new Float64Array(n);
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t], b = tri[t + 1], c = tri[t + 2];
    const s = Math.abs((x[b] - x[a]) * (y[c] - y[a]) - (x[c] - x[a]) * (y[b] - y[a])) / 6;
    area[a] += s; area[b] += s; area[c] += s;
  }
  return { ...pts, indptr, indices, elen, area, border, triangles: Int32Array.from(tri) };
}

/** A bucket grid over a graph's nodes for nearest-node lookups. Returns nearest(x, y) -> node index. */
export function nodeGrid(g) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < g.n; i++) { if (g.x[i] < x0) x0 = g.x[i]; if (g.y[i] < y0) y0 = g.y[i]; if (g.x[i] > x1) x1 = g.x[i]; if (g.y[i] > y1) y1 = g.y[i]; }
  const cell = Math.sqrt(((x1 - x0) * (y1 - y0)) / Math.max(1, g.n)) * 2 || 1;
  const cw = Math.max(1, Math.ceil((x1 - x0) / cell) + 1), ch = Math.max(1, Math.ceil((y1 - y0) / cell) + 1);
  const count = new Int32Array(cw * ch + 1);
  const cellOf = (x, y) => Math.min(ch - 1, Math.max(0, Math.floor((y - y0) / cell))) * cw + Math.min(cw - 1, Math.max(0, Math.floor((x - x0) / cell)));
  for (let i = 0; i < g.n; i++) count[cellOf(g.x[i], g.y[i]) + 1]++;
  for (let c = 0; c < cw * ch; c++) count[c + 1] += count[c];
  const items = new Int32Array(g.n), fill = count.slice(0, cw * ch);
  for (let i = 0; i < g.n; i++) items[fill[cellOf(g.x[i], g.y[i])]++] = i;
  function nearest(x, y) {
    const cx = Math.min(cw - 1, Math.max(0, Math.floor((x - x0) / cell))), cy = Math.min(ch - 1, Math.max(0, Math.floor((y - y0) / cell)));
    let best = -1, bd = Infinity;
    for (let r = 0; r < Math.max(cw, ch); r++) {
      for (let yy = cy - r; yy <= cy + r; yy++) for (let xx = cx - r; xx <= cx + r; xx++) {
        if (yy < 0 || xx < 0 || yy >= ch || xx >= cw || (Math.abs(yy - cy) !== r && Math.abs(xx - cx) !== r)) continue;
        const c = yy * cw + xx;
        for (let k = count[c]; k < count[c + 1]; k++) { const i = items[k], dx = g.x[i] - x, dy = g.y[i] - y, d = dx * dx + dy * dy; if (d < bd || (d === bd && i < best)) { bd = d; best = i; } }
      }
      if (best >= 0 && Math.sqrt(bd) <= r * cell) break;
    }
    return best;
  }
  return { nearest, cell };
}
