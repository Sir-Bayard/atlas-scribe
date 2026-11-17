// One step of making a plan from Quick Start's choices (quick.mjs, quickPlan): ctx holds what the steps share.
import { add, densify, dirOf, distToPoly, inside, mul, outline, pt } from "../quick.mjs";
import { crossesCliff } from "../cliffs.mjs";
import { rng } from "../rng.mjs";

/**
 * Woods toward the edges, clear of everything; those near the place cleared toward it
 */
export function woodsAndCliffs(ctx) {
  const { H, S, W, choices, clearOf, clearOfThings, farms, features, r, roads, seed, woodish } = ctx;
  const [w0, w1] = S.woods;
  // (woodland: mostly woods, bigger and more of them, up to the map's edges)
  const woodland = choices.surroundings === "woodland";
  const woodsWanted = woodland ? w1 + 2 + r.int(w1 - w0 + 3) : woodish ? w0 + r.int(w1 - w0 + 1) : choices.surroundings === "open" ? 0 : r.int(2);
  const woods = [];
  for (let t = 0; t < (woodland ? 700 : 300) && woods.length < woodsWanted; t++) {
    const rad = woodland ? r.range(5, choices.size === "town" ? 13 : 10) : r.range(3.5, choices.size === "town" ? 9 : 7);
    const c = [r.range(1, W - 1), r.range(1, H - 1)];
    const n = 12, blob = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      const rr = rad * r.range(0.7, 1.15);
      blob.push([Math.max(0, Math.min(W, c[0] + Math.cos(a) * rr * 1.2)), Math.max(0, Math.min(H, c[1] + Math.sin(a) * rr))]);
    }
    // A point pushed onto the map's edge may sit on the edge, but never on a road, the water or a district there
    if (![c, ...blob].every((p) => clearOfThings(p, 1))) continue;
    // nor a road or the water running through its middle, between the points tested above
    if ([...roads.map((rd) => rd.path), ...(ctx.water ? [ctx.water.path] : [])].some((path) => densify(path, 0.5).some((q) => inside(q, blob)))) continue;
    if (!clearOf(c, rad * 0.8)) continue;
    if (woods.some((w) => Math.hypot(w.c[0] - c[0], w.c[1] - c[1]) < w.rad + rad + (woodland ? 0.5 : 2))) continue;
    if (farms.some((f) => Math.hypot(f.c[0] - c[0], f.c[1] - c[1]) < rad * 1.2 + f.size)) continue;
    if (ctx.cemetery && (distToPoly(c, ctx.cemetery) < rad * 1.2 + 2 || inside(c, ctx.cemetery))) continue;
    woods.push({ c, rad, blob });
  }
  // (a wood near the place is cleared toward it: felled for timber and firewood, thickening farther off)
  const nearTown = (blob) => (ctx.cluster ?? []).some((poly) => blob.some((p) => distToPoly(p, poly) < 12));
  woods.forEach((w, n) => features.push({ id: `woods-${n + 1}`, type: "area", class: "woods", shape: outline(w.blob), ...(nearTown(w.blob) ? { cleared: true } : {}) }));

  // Now and then an escarpment in the country (its own stream): a cliff in from the map's edge, clear of the place,
  // its roads, water, mills and farms
  {
    const er = rng(seed, "quick", "escarpment");
    if (er.chance(0.2)) for (let t = 0; t < 60; t++) {
      const side = er.int(4), u = er.range(0.15, 0.85), len = er.range(15, 35);
      const start = [[u * W, 0], [W, u * H], [u * W, H], [0, u * H]][side];
      let h = [90, 180, 270, 0][side] + er.range(-50, 50);
      const pts = [start];
      for (let s = 3; s <= len; s += 3) { h += er.range(-14, 14); pts.push(add(pts[pts.length - 1], mul(dirOf(h), 3))); }
      const dense = densify(pts, 0.5).slice(1);
      if (!dense.every((p) => p[0] >= 0 && p[1] >= 0 && p[0] <= W && p[1] <= H && clearOfThings(p, 3))) continue;
      if (roads.some((rd) => crossesCliff(rd.path, pts)) || farms.some((f) => dense.some((p) => Math.hypot(p[0] - f.c[0], p[1] - f.c[1]) < f.size + 2.5))) continue;
      features.push({ id: "escarpment", type: "wall", class: "cliff", side: er.chance(0.5) ? "left" : "right", height: 5 * Math.round(er.range(20, 40) / 5), path: pts.map(pt) });
      break;
    }
  }
}
