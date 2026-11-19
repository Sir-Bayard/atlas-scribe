/**
 * A finer land for painting (tried beside plain interpolation): the graph subdivided once (a node at about the middle
 * of every edge), the new nodes' values between their edge's ends, and a few solver steps run at the finer spacing with
 * no uplift, so valleys and ridges grow at a scale the coarse graph can't hold, where interpolation and droplets only
 * scratch. Painting only: the layout's land (its rivers, lakes, inventory) is unchanged. Pure.
 */
import { makeGraph } from "./graph.mjs";
import { workFor, fillRoute, accumulate, step } from "./solver.mjs";
import { SOLVER } from "./uplift.mjs";

/** land: the layout's compact land. Returns a compact land of the same form with about four times the nodes. */
export function refineLand(land, { steps = 15 } = {}) {
  const { n } = land;
  // the edges, once each (i < j)
  const edges = [];
  for (let i = 0; i < n; i++) for (let k = land.indptr[i]; k < land.indptr[i + 1]; k++) { const j = land.indices[k]; if (i < j) edges.push(i, j); }
  const m = edges.length / 2, N = n + m;
  const x = new Float64Array(N), y = new Float64Array(N), level = new Uint8Array(N);
  x.set(land.x); y.set(land.y);
  const hsh = (a, b) => { let h = Math.imul(a, 2654435761) ^ Math.imul(b, 1597334677); h = Math.imul(h ^ (h >>> 15), 2246822507); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };
  for (let e = 0; e < m; e++) {
    const a = edges[2 * e], b = edges[2 * e + 1];
    // (a little off the middle, across the edge, so the new points aren't in rows)
    const dx = land.x[b] - land.x[a], dy = land.y[b] - land.y[a], t = 0.5 + (hsh(a, b) - 0.5) * 0.12, s = (hsh(b, a) - 0.5) * 0.18;
    x[n + e] = land.x[a] + dx * t - dy * s; y[n + e] = land.y[a] + dy * t + dx * s;
    level[n + e] = 2;
  }
  const g = makeGraph({ n: N, x, y, level });
  // values: the old nodes' own, the new nodes' between their edge's ends (a kind from the lower end)
  const mix = (arr, Type) => { const o = new Type(N); o.set(arr); for (let e = 0; e < m; e++) { const a = edges[2 * e], b = edges[2 * e + 1]; o[n + e] = (arr[a] + arr[b]) / 2; } return o; };
  const pick = (arr, Type) => { const o = new Type(N); o.set(arr); for (let e = 0; e < m; e++) { const a = edges[2 * e], b = edges[2 * e + 1]; o[n + e] = arr[land.h[a] <= land.h[b] ? a : b]; } return o; };
  const h = mix(land.h, Float64Array);
  const landMask = new Uint8Array(N); landMask.set(land.landMask);
  for (let e = 0; e < m; e++) { const a = edges[2 * e], b = edges[2 * e + 1]; landMask[n + e] = land.landMask[a] && land.landMask[b] ? 1 : land.landMask[a] || land.landMask[b] ? (h[n + e] > 0.0008 ? 1 : 0) : 0; }
  const hard = mix(land.hard, Float64Array), rain = mix(land.rain, Float64Array);
  // a few steps at the finer spacing: stream power and rounding, nothing raised
  const outlet = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (!landMask[i] || g.border[i]) outlet[i] = 1;
  for (let i = 0; i < N; i++) if (outlet[i] && landMask[i] === 0) h[i] = Math.min(h[i], 0);
  const spacing = land.spacing / 2;
  const K = new Float64Array(N), talus = new Float64Array(N), D = new Float64Array(N), U = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    K[i] = SOLVER.K0 * (1 - 0.55 * hard[i]);
    talus[i] = SOLVER.talus * Math.pow(spacing, -0.3) * (1 + 0.6 * hard[i]);
    D[i] = (0.03 * (1 - 0.6 * hard[i])) / SOLVER.dt;
  }
  let meanArea = 0; for (let i = 0; i < N; i++) meanArea += g.area[i]; meanArea /= N;
  const w = workFor(g), weight = new Float64Array(N);
  let mr = 0, cnt = 0; for (let i = 0; i < N; i++) if (landMask[i]) { mr += rain[i]; cnt++; }
  mr = mr / Math.max(1, cnt) || 1;
  for (let i = 0; i < N; i++) weight[i] = (rain[i] / mr) * g.area[i];
  const p = { U, K, dt: SOLVER.dt, fill: 0.008, smallArea: Math.max(15, 3 * meanArea), D, passes: 1, talus, outlet, fixed: null };
  for (let s = 0; s < steps; s++) { const np = fillRoute(g, h, outlet, w); accumulate(w, weight, np); step(g, h, w, p, np); }
  for (let i = 0; i < N; i++) if (landMask[i] && h[i] < 0.0008) h[i] = 0.0008;
  return {
    ...land, n: N, x, y, triangles: g.triangles, indptr: g.indptr, indices: g.indices, spacing,
    h, landMask, hard, rain, temp: mix(land.temp, Float64Array), sea: mix(land.sea, Float32Array),
    lake: pick(land.lake, Uint8Array), salt: pick(land.salt, Uint8Array), lakeId: pick(land.lakeId, Int32Array),
    biome: pick(land.biome, Uint8Array), zone: pick(land.zone, Int16Array), F: mix(land.F, Float64Array),
  };
}
