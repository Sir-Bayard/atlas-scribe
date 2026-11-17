// One step of making a plan from Quick Start's choices (quick.mjs, quickPlan): ctx holds what the steps share.
import { add, clipToMap, dirOf, mul, outline, r1, wander } from "../quick.mjs";

/**
 * Farmsteads beside the roads, beyond the districts
 */
export function farmsAndFields(ctx) {
  const { C, H, S, W, arms, choices, clearOf, cluster, compass, features, r, roadHalf, roads } = ctx;
  const farmish = choices.surroundings === "farmland" || choices.surroundings === "mixed";
  const woodish = choices.surroundings === "woodland" || choices.surroundings === "mixed"; ctx.woodish = woodish;
  const [f0, f1] = S.farms;
  const farmsWanted = choices.surroundings === "open" ? r.int(2) : farmish ? f0 + r.int(f1 - f0 + 1) : r.int(2);
  const farms = []; ctx.farms = farms;
  for (let t = 0; t < 200 && farms.length < farmsWanted; t++) {
    const rd = r.pick(roads);
    const i = 1 + r.int(rd.path.length - 1);
    const a = rd.path[i - 1], b = rd.path[i], k = r.next();
    const on = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...d) || 1;
    const c = add(on, mul([-d[1] / l, d[0] / l], (r.chance(0.5) ? 1 : -1) * (roadHalf(rd) + r.range(3.5, 5))));
    const size = 4.6, rot = Math.round(r.range(-15, 15));
    // (its corners, the middles of its sides and its center: a bending river or stream can pass between corners)
    const corners = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]].map(([x, y]) => add(c, [(x * size) / 2, (y * size) / 2]));
    if (![c, ...corners].every((p) => clearOf(p, 1.2))) continue;
    if (farms.some((f) => Math.hypot(f.c[0] - c[0], f.c[1] - c[1]) < size * 2)) continue;
    farms.push({ c, size, rot });
  }
  farms.forEach((f, n) => features.push({ id: `farm-${n + 1}`, type: "area", class: "farmstead", shape: { rect: [r1(f.c[0] - f.size / 2), r1(f.c[1] - f.size / 2), r1(f.c[0] + f.size / 2), r1(f.c[1] + f.size / 2)] }, rot: f.rot }));

  // Field systems in some of the wedges between the roads leaving the center; the layout keeps them off roads, water,
  // farmyards and a ragged margin around the districts. Farmland runs to the map's edge; mixed country has fields
  // around the village and rough ground beyond
  const fields = [];
  if (choices.surroundings !== "open") {
    // The lines the wedges lie between: each road leaving the center, and a wandering line through a wide gap
    const angleOf = (path) => { const e = path[path.length - 1]; return Math.atan2(e[1] - C[1], e[0] - C[0]); };
    const lines = arms.map((path) => ({ path, a: angleOf(path) })).sort((x, y) => x.a - y.a);
    const withSplits = [];
    lines.forEach((l, i) => {
      withSplits.push(l);
      const next = i + 1 < lines.length ? lines[i + 1].a : lines[0].a + 2 * Math.PI;
      if (next - l.a > (140 * Math.PI) / 180) {
        const mid = (l.a + next) / 2;
        withSplits.push({ path: wander(r, C, [Math.cos(mid), Math.sin(mid)], W, H, { step: r.range(6, 9), amp: r.range(1.5, 3) }), a: mid });
      }
    });
    const extent = Math.max(...cluster.flat().map((p) => Math.hypot(p[0] - C[0], p[1] - C[1])));
    /** A line from the center cut off at distance R. */
    const upTo = (path, R) => {
      const out = [path[0]];
      for (let i = 1; i < path.length; i++) {
        const p = path[i], q = path[i - 1], d = Math.hypot(p[0] - C[0], p[1] - C[1]);
        if (d <= R) { out.push(p); continue; }
        const dq = Math.hypot(q[0] - C[0], q[1] - C[1]), t = (R - dq) / (d - dq || 1);
        out.push([q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t]);
        break;
      }
      return out;
    };
    const used = new Set();
    // Which wedges stay rough grass: in farmland one (when there are three or more), in mixed country about half (but
    // never all), in woodland most
    const rough = choices.surroundings === "farmland" ? (withSplits.length >= 3 ? r.int(withSplits.length) : -1) : -1;
    const keepAtLeast = choices.surroundings === "mixed" ? r.int(withSplits.length) : -1;
    withSplits.forEach((l, i) => {
      const m = withSplits[(i + 1) % withSplits.length];
      const a = l.a, b = i + 1 < withSplits.length ? m.a : m.a + 2 * Math.PI;
      const keep = r.next(), reach = r.range(12, 22), small = r.range(8, 14);
      // Not every stretch: some stay rough grass, so the fields don't ring the village
      const wanted = choices.surroundings === "farmland" ? i !== rough : choices.surroundings === "mixed" ? keep < 0.5 || i === keepAtLeast : keep < 0.25;
      if (!wanted) return;
      // Farmland runs to the map's edge; otherwise the fields stop a ragged way out from the village
      const R = choices.surroundings === "farmland" ? Math.hypot(W, H) : extent + (choices.surroundings === "mixed" ? reach : small);
      const n = Math.max(3, Math.ceil((b - a) / ((12 * Math.PI) / 180)));
      const arc = Array.from({ length: n - 1 }, (_, k) => {
        const t = a + ((b - a) * (k + 1)) / n, rr = R * r.range(0.88, 1.12);
        return add(C, [Math.cos(t) * rr, Math.sin(t) * rr]);
      });
      const out = choices.surroundings === "farmland" ? (path) => path : (path) => upTo(path, R);
      const shape = outline(clipToMap([...out(l.path), ...arc, ...[...out(m.path)].reverse().slice(0, -1)], W, H, 0));
      if (shape.length < 3) return;
      const side = compass(dirOf((((a + b) / 2) * 180) / Math.PI));
      let id = `fields-${side}`;
      for (let k = 2; used.has(id); k++) id = `fields-${side}-${k}`;
      used.add(id);
      fields.push({ id, type: "area", class: "fields", shape });
    });
  }
  features.push(...fields);
}
