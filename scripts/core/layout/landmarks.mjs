/**
 * Landmarks an overland map shows from its own land, each a small mark and a name: waterfalls on its rivers, the
 * passes its roads climb to, its volcanoes, hot springs by them (or below its highest peak), one great tree deep in its
 * biggest forest, and sea stacks off a steep coast. They follow the land (and, for the passes and the tree, its roads
 * and settled land), so they're worked out at each layout rather than kept in the plan. Pure.
 */
import { BIOMES } from "../land/biome.mjs";
import { woodSpot, SETTLED } from "../land/settled.mjs";

/** The kinds of landmark, as their marks and names know them. */
export const LANDMARK_KINDS = ["falls", "pass", "volcano", "spring", "tree", "stacks", "oasis"];
// (at most this many of each on a map)
const MOST = { falls: 5, pass: 5, volcano: 6, spring: 3, tree: 1, stacks: 3, oasis: 6 };
const FOREST = new Set(["temperate-forest", "temperate-rainforest", "seasonal-forest", "rainforest", "taiga"]);

/**
 * land: the layout's compact land; settled: its settled field; items: the layout's items (roads in map units).
 * Returns [{ id, kind, x, y (map units), inv (the inventory feature's id, when it's one) }], in the map.
 */
export function landmarksOf(land, settled, items = []) {
  const { n, x, y, indptr, indices, h, landMask, lake } = land;
  const f = land.frame, M = f.margin, mpu = f.mpu, MW = f.mapW / mpu, MH = f.mapH / mpu;
  const U = (px, py) => [Math.round(((px - M) / mpu) * 1000) / 1000, Math.round(((py - M) / mpu) * 1000) / 1000];
  const inside = ([u, v], pad = 0.5) => u >= pad && v >= pad && u <= MW - pad && v <= MH - pad;
  const wet = (i) => !landMask[i] || lake?.[i] === 1;
  const out = [];
  // (an id from the inventory feature it is, or belongs to, so its name stays when it moves; else from where it is)
  const add = (kind, px, py, inv = null, of = null) => {
    const at = U(px, py);
    if (!inside(at) || out.filter((o) => o.kind === kind).length >= MOST[kind]) return false;
    // (clear of another landmark)
    if (out.some((o) => Math.hypot(o.x - at[0], o.y - at[1]) < 1)) return false;
    out.push({ id: inv ?? (of ? `${kind}:${of}` : `${kind}:${Math.round(px * 10)}:${Math.round(py * 10)}`), kind, x: at[0], y: at[1], inv });
    return true;
  };
  const inv = land.inventory ?? [];
  // waterfalls, on the bigger rivers first (their order in the inventory is the river's)
  for (const q of inv.filter((q) => q.kind === "falls")) add("falls", q.x, q.y, q.id);
  // (and where a big river drops steeply, leaving the hills: its steepest step, the biggest rivers first)
  const T = land.threshold ?? 1, drops = [];
  for (const R of land.rivers ?? []) {
    const nodes = R.nodes ?? [];
    let best = null;
    for (let k = 1; k < nodes.length; k++) {
      const a = nodes[k - 1], b = nodes[k];
      if (wet(a) || wet(b) || land.F[b] < 2 * T || h[a] < 0.06) continue;
      const grade = ((h[a] - h[b]) * 3.1) / Math.max(1e-9, Math.hypot(x[a] - x[b], y[a] - y[b]));
      if (grade > 0.012 && (!best || grade > best.grade)) best = { grade, i: b, flow: land.F[b] };
    }
    if (best) drops.push(best);
  }
  drops.sort((p, q) => q.flow * q.grade - p.flow * p.grade || p.i - q.i);
  for (const d of drops) add("falls", x[d.i], y[d.i]);
  // passes: those a road climbs to first, then the lowest
  const roads = items.filter((i) => i.kind === "way" && Array.isArray(i.path));
  const nearRoad = (u, v, r) => roads.some((w) => w.path.some((p) => Math.hypot(p[0] - u, p[1] - v) < r));
  const passes = inv.filter((q) => q.kind === "pass").map((q) => { const [u, v] = U(q.x, q.y); return { q, road: nearRoad(u, v, Math.max(1, (3 * land.spacing) / mpu)) }; });
  passes.sort((a, b) => Number(b.road) - Number(a.road) || (a.q.height ?? 0) - (b.q.height ?? 0) || (a.q.id < b.q.id ? -1 : 1));
  for (const { q } of passes) add("pass", q.x, q.y, q.id);
  // volcanoes, and a hot spring by each (on lower ground a little way off its cone)
  const cones = land.cones ?? [];
  for (const c of cones) add("volcano", c.at[0], c.at[1]);
  const springAt = (cx, cy, rad) => {
    let best = -1, bv = -Infinity;
    for (let i = 0; i < n; i++) {
      if (wet(i)) continue;
      const d = Math.hypot(x[i] - cx, y[i] - cy);
      if (d < rad * 0.8 || d > rad * 2) continue;
      const v = -h[i] - 0.001 * d;
      if (v > bv) { bv = v; best = i; }
    }
    return best;
  };
  for (const c of cones) { const i = springAt(c.at[0], c.at[1], Math.max(3 * land.spacing, c.rad ?? 10)); if (i >= 0) add("spring", x[i], y[i]); }
  if (!cones.length) {
    // (on a land with high mountains, one below its highest peak)
    const peaks = inv.filter((q) => q.kind === "peak" && (q.height ?? 0) > 0.55).sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
    if (peaks.length) { const p = peaks[0], i = springAt(p.x, p.y, Math.max(4 * land.spacing, 12)); if (i >= 0) add("spring", x[i], y[i]); }
  }
  // the great tree: deep in the biggest forest's uncleared wood, away from where its name goes
  if (f.scale === "kingdom" || f.scale === "realm") {
    const forest = inv.filter((q) => q.kind === "forest").sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0];
    const spot = forest ? woodSpot(land, settled, forest.x, forest.y) : null;
    if (forest && spot) {
      // (the wood's nodes and their steps from its edge)
      const isWood = (i) => !wet(i) && FOREST.has(BIOMES[land.biome[i]]) && (!settled || settled[i] < SETTLED) && inside(U(x[i], y[i]), 2);
      let start = -1, bd = Infinity;
      for (let i = 0; i < n; i++) if (isWood(i)) { const d = (x[i] - spot[0]) ** 2 + (y[i] - spot[1]) ** 2; if (d < bd) { bd = d; start = i; } }
      if (start >= 0) {
        const seen = new Int32Array(n).fill(-1), wood = [start];
        seen[start] = 0;
        for (let k = 0; k < wood.length; k++) for (let e = indptr[wood[k]]; e < indptr[wood[k] + 1]; e++) { const j = indices[e]; if (seen[j] < 0 && isWood(j)) { seen[j] = 0; wood.push(j); } }
        const depth = new Int32Array(n).fill(-1), q = [];
        for (const i of wood) for (let e = indptr[i]; e < indptr[i + 1]; e++) if (!isWood(indices[e])) { depth[i] = 0; q.push(i); break; }
        for (let k = 0; k < q.length; k++) for (let e = indptr[q[k]]; e < indptr[q[k] + 1]; e++) { const j = indices[e]; if (seen[j] === 0 && depth[j] < 0) { depth[j] = depth[q[k]] + 1; q.push(j); } }
        let deep = 0;
        for (const i of wood) if (depth[i] > deep) deep = depth[i];
        let best = -1, bv = -Infinity;
        for (const i of wood) { if (depth[i] < 0.5 * deep) continue; const v = Math.hypot(x[i] - spot[0], y[i] - spot[1]); if (v > bv || (v === bv && i < best)) { bv = v; best = i; } }
        if (best >= 0 && deep >= 2) add("tree", x[best], y[best], null, forest.id);
      }
    }
  }
  // sea stacks: in the sea beside a high, steep stretch of coast
  if (f.scale === "kingdom" || f.scale === "realm") {
    const cand = [];
    for (let i = 0; i < n; i++) {
      if (landMask[i]) continue;
      let top = 0;
      for (let e = indptr[i]; e < indptr[i + 1]; e++) { const j = indices[e]; if (landMask[j] && lake?.[j] !== 1) top = Math.max(top, h[j]); }
      if (top > 0.1) cand.push([top, i]);
    }
    cand.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    const gap = Math.max(10, 6 * land.spacing);
    const kept = [];
    for (const [, i] of cand) { if (kept.some((j) => Math.hypot(x[i] - x[j], y[i] - y[j]) < gap)) continue; if (add("stacks", x[i], y[i])) kept.push(i); }
  }
  // oases: the land's own (generator 3), in its deserts
  for (const o of land.oases ?? []) add("oasis", o.x, o.y);
  return out;
}
