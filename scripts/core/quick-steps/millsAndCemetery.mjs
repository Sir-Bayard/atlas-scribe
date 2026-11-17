// One step of making a plan from Quick Start's choices (quick.mjs, quickPlan): ctx holds what the steps share.
import { add, densify, distToPath, distToPoly, inside, mul, pt } from "../quick.mjs";
import { watermill, windmill } from "../mills.mjs";

/**
 * Mills (their own stream, so adding them changes nothing else): a watermill on a race by the edge of a village or
 * town, and a windmill out among the fields
 */
export function millsAndCemetery(ctx) {
  const { H, W, choices, clearOf, cluster, features, has, millKeep, nearCluster, r, roadHalf, roads } = ctx;
  {
    const mr = r.fork("mills");
    const autoWater = ctx.water && (choices.size !== "hamlet" || mr.chance(0.5));
    const wantWater = ctx.water && (has.watermill ?? autoWater);
    if (wantWater) {
      const ok = (p, m) => p[0] > 2 && p[1] > 2 && p[0] < W - 2 && p[1] < H - 2 && !nearCluster(p, m + 0.5) && !(ctx.green && distToPoly(p, ctx.green) < m)
        && roads.every((rd) => distToPath(p, rd.path) > roadHalf(rd) + m + 3) && distToPath(p, ctx.water.path) > ctx.water.width / 25 / 2 + 0.9;
      const made = watermill({ water: ctx.water, ok, want: (c) => cluster.some((poly) => distToPoly(c, poly) < 12), r: mr.fork("water") });
      if (made) {
        if (ctx.water.frozen) made[0].frozen = true; // (its race freezes with the stream)
        features.push(...made);
        const [x0, y0, x1, y1] = made[1].shape.rect;
        millKeep.push({ path: made[0].path, half: 0.2 + 0.6 }, { path: [[(x0 + x1) / 2, (y0 + y1) / 2], [(x0 + x1) / 2, (y0 + y1) / 2]], half: Math.hypot(x1 - x0, y1 - y0) / 2 + 0.5 });
      }
    }
    const fieldy = choices.surroundings === "farmland" || choices.surroundings === "mixed";
    const autoWind = !fieldy ? 0 : choices.size === "town" ? 1 + (mr.chance(0.4) ? 1 : 0) : choices.size === "village" ? (mr.chance(0.6) ? 1 : 0) : 0;
    const wind = has.windmill === false ? 0 : has.windmill ? Math.max(1, autoWind) : autoWind;
    const wr = mr.fork("wind");
    for (let k = 0; k < wind; k++) {
      // Out past the houses, near a road (a lane comes to its yard)
      const spot = () => { const rd = wr.pick(roads), i = 1 + wr.int(rd.path.length - 1), t = wr.next(), a = rd.path[i - 1], b = rd.path[i], d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...d) || 1, side = wr.chance(0.5) ? 1 : -1, off = roadHalf(rd) + wr.range(4, 8); return [a[0] + d[0] * t - (d[1] / l) * side * off, a[1] + d[1] * t + (d[0] / l) * side * off]; };
      const made = windmill({ ok: (p, m) => clearOf(p, m) && !nearCluster(p, 5), spot, r: wr.fork(k), id: k ? `windmill-${k + 1}` : "windmill" });
      if (made) {
        features.push(...made);
        const [x0, y0, x1, y1] = made[0].shape.rect;
        millKeep.push({ poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
      }
    }
  }

  // A town's cemetery beside a road a little beyond its edge, clear of everything (its own stream)
  ctx.cemetery = null;
  if (has.cemetery ?? choices.size === "town") {
    const cr = r.fork("cemetery");
    // (from the stretches of road just past the houses)
    const spots = roads.flatMap((rd) => { const pts = densify(rd.path, 0.5); return pts.slice(1).map((q, j) => ({ rd, a: pts[j], b: q })); })
      .filter(({ a }) => !nearCluster(a, 4) && nearCluster(a, 16));
    // (one asked for and not placed is tried again smaller, nearer the houses)
    for (let t = 0; t < (has.cemetery ? 500 : 250) && !ctx.cemetery && spots.length; t++) {
      const small = t >= 250;
      const { rd, a, b } = spots[cr.int(spots.length)], side = cr.chance(0.5) ? 1 : -1;
      const w = small ? cr.range(5.5, 7.5) : cr.range(8, 11), dd = small ? cr.range(4.5, 6) : cr.range(6, 8);
      const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...d) || 1, u = [d[0] / l, d[1] / l], n = [-u[1] * side, u[0] * side];
      const c = add(a, mul(n, roadHalf(rd) + 1.6 + dd / 2));
      const shape = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => pt(add(add(c, mul(u, (x * w) / 2)), mul(n, (y * dd) / 2))));
      const edge = shape.flatMap((p, j) => { const q = shape[(j + 1) % 4]; return [0, 0.25, 0.5, 0.75].map((f) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]); });
      if (![c, ...edge].every((p) => clearOf(p, 1.2))) continue;
      if (cluster.some((poly) => distToPoly(c, poly) < dd / 2 + (small ? 2 : 4))) continue; // (a little way out, not against the houses)
      if (roads.some((rd2) => rd2.path.some((q) => inside(q, shape)))) continue;
      ctx.cemetery = shape;
    }
    if (ctx.cemetery) {
      features.push({ id: "cemetery", type: "area", class: "cemetery", name: "The cemetery", shape: ctx.cemetery });
      millKeep.push({ poly: ctx.cemetery }); // (the farms and woods keep off it)
    }
  }
}
