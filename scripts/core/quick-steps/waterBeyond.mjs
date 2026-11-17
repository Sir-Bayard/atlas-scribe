// One step of making a plan from Quick Start's choices (quick.mjs, quickPlan): ctx holds what the steps share.
import { rng } from "../rng.mjs";
import { bends, meander } from "../meander.mjs";
import { crossings, distToPath, distToPoly, pt, thin } from "../quick.mjs";

/**
 * Water: across the main road beyond the districts (or along one side if there's no room), clear of them; a river with shallows and now and then an island
 */
export function waterBeyond(ctx) {
  const { C, H, U, V, W, at, choices, cluster, features, nearCluster, r, roadHalf, roads, seed, theta, winter } = ctx;
  ctx.water = null;
  if (choices.water !== "none") {
    const width = choices.water === "river" ? r.range(45, 70) : r.range(12, 18);
    const half = width / 25 / 2;
    const extent = Math.max(...cluster.flat().map((p) => Math.abs((p[0] - C[0]) * U[0] + (p[1] - C[1]) * U[1])));
    const sideExtent = Math.max(...cluster.flat().map((p) => Math.abs((p[0] - C[0]) * V[0] + (p[1] - C[1]) * V[1])));
    const tries = [];
    for (const s of r.shuffle([1, -1])) tries.push({ q: (m) => at(s * (extent + m), 0), dir: theta + 90 });
    for (const s of r.shuffle([1, -1])) tries.push({ q: (m) => at(0, s * (sideExtent + m)), dir: theta });
    for (let t = 0; t < tries.length * 4 && !ctx.water; t++) {
      const tr = tries[t % tries.length];
      const q = tr.q(half + r.range(4, 8));
      if (q[0] < 3 || q[1] < 3 || q[0] > W - 3 || q[1] > H - 3) continue;
      const deg = tr.dir + r.range(-12, 12);
      // Bending as it goes (gentler on each round of tries, so it still finds room beside the town)
      const bd = bends(r, Math.min(W, H) * 0.45), calm = [1, 0.7, 0.45, 0.2][Math.floor(t / tries.length)];
      bd.swing *= calm;
      bd.swing2 *= calm;
      const path = thin(meander(q, (deg * Math.PI) / 180, W, H, bd), 0.08).map(pt);
      // (well across the map, not bending off it near a corner)
      // (on the last round, nearly straight, any length will do)
      if (t < tries.length * 3 && path.reduce((n, p, i) => n + (i ? Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]) : 0), 0) < Math.min(W, H) * 0.9) continue;
      // Clear of every district and the green, banks and all
      const clear = (p) => !nearCluster(p, half + 1.5) && !(ctx.green && distToPoly(p, ctx.green) < half + 1.5);
      const dense = path.flatMap((p, i) => (i ? Array.from({ length: 6 }, (_, k) => [path[i - 1][0] + ((p[0] - path[i - 1][0]) * k) / 6, path[i - 1][1] + ((p[1] - path[i - 1][1]) * k) / 6]) : [p]));
      if (!dense.every(clear)) continue;
      // Each road crosses it once at most in any stretch, so every crossing gets its own bridge
      const hits = roads.map((rd) => crossings(rd.path.map(pt), path));
      if (hits.some((h) => h.some((p, i) => h.some((q, j) => j > i && Math.hypot(p[0] - q[0], p[1] - q[1]) < 8)))) continue;
      ctx.water = { id: choices.water, type: "water", class: choices.water, width: Math.round(width), path, frozen: winter && choices.water === "stream" };
    }
    if (ctx.water) {
      // (a river's shallows on its bends, and now and then an island or two; from a stream of its own)
      if (choices.water === "river") {
        const br = rng(seed, "quick", "riverbed");
        ctx.water.shallows = true;
        const isl = br.next() < 0.5 ? 0 : 1 + br.int(2);
        if (isl) ctx.water.islands = isl;
      }
      features.push(ctx.water);
      // A bridge (or, on a stream, sometimes a ford) wherever a road crosses it
      let n = 0;
      for (const rd of roads) {
        // Worked out from the lines as the plan stores them (rounded), so none is missed
        for (const hit of crossings(rd.path.map(pt), ctx.water.path)) {
          const ford = choices.water === "stream" && rd.class !== "highway" && r.chance(0.4);
          features.push({ id: `${ford ? "ford" : "bridge"}-${++n}`, type: "crossing", class: ford ? "ford" : "bridge", at: pt(hit), frozen: ford && winter });
        }
      }
    }
  }

  // Keep-outs for what goes around the edge: the districts, the green, the roads, the water
  const millKeep = []; ctx.millKeep = millKeep; // the mills' races and yards, kept off by everything placed after them
  const clearOfThings = (p, m) => !nearCluster(p, m) && !(ctx.green && distToPoly(p, ctx.green) < m)
    && roads.every((rd) => distToPath(p, rd.path) > roadHalf(rd) + m)
    && !(ctx.water && distToPath(p, ctx.water.path) < ctx.water.width / 25 / 2 + m)
    && !millKeep.some((k) => (k.poly ? distToPoly(p, k.poly) < m : distToPath(p, k.path) < k.half + m)); ctx.clearOfThings = clearOfThings;
  const onMap = (p) => p[0] > 1 && p[1] > 1 && p[0] < W - 1 && p[1] < H - 1;
  const clearOf = (p, m) => clearOfThings(p, m) && onMap(p); ctx.clearOf = clearOf;
}
