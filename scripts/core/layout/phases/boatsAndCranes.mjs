// One phase of laying out a plan (layout/index.mjs, layoutPlan): ctx holds what the phases share.
import { BOAT_SQUARES, afloat, harborProps } from "../harbor.mjs";
import { bbox, distanceToPath, pointInPolygon } from "../../geom.mjs";
import { pastEdge } from "../../water.mjs";
import { rng } from "../../rng.mjs";

/**
 * Boats and cranes: moored along the quays, wharves, piers and jetties, ships at the sea's, cranes on stone quays,
 * ships riding at anchor off a harbor and rowboats on a river by the houses; none on frozen water or under a bridge
 */
export function boatsAndCranes(ctx) {
  const { districts, docks, items, plan, streamFor } = ctx;
  {
    const lakeLike = items.filter((i) => i.kind === "water" && i.poly && !i.frozen);
    const rivers = items.filter((i) => i.kind === "water" && i.path && !i.frozen && (i.class === "river" || i.class === "stream"));
    const waterAt = (p) => {
      for (const b of lakeLike) if (pointInPolygon(p, b.poly)) return b.class === "sea" ? "sea" : "lake";
      for (const w of rivers) if (pastEdge(p, w) < -0.03) return "river";
      return null;
    };
    const spans = items.filter((i) => i.kind === "crossing").map((c) => ({ at: c.at, r: (c.length ?? 1) / 2 + 0.6 }));
    const piers = docks.filter((d) => !d.edge);
    const clear = (p) => spans.every((c) => Math.hypot(c.at[0] - p[0], c.at[1] - p[1]) > c.r) && piers.every((d) => distanceToPath(p, d.path) > d.width / 2 + 0.03);
    const H = harborProps({ docks, waterAt, clear, forkOf: (id) => streamFor(id).fork("boats") });
    const sea = lakeLike.find((b) => b.class === "sea");
    const ar = rng(plan.seed ?? 1, "afloat");
    if (sea && docks.length) {
      const near = (p) => Math.min(...docks.map((d) => Math.min(...d.path.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1])))));
      const [x0, y0, x1, y1] = bbox(sea.poly), spots = [];
      for (let k = 0; k < 160; k++) { const p = [x0 + ar.next() * (x1 - x0), y0 + ar.next() * (y1 - y0)], a = ar.next() * 2 * Math.PI; if (pointInPolygon(p, sea.poly) && distanceToPath(p, [...sea.ring, sea.ring[0]]) > 3 && near(p) < 16) spots.push({ p, u: [Math.cos(a), Math.sin(a)], d: near(p) }); }
      afloat({ spots: spots.sort((a, b) => a.d - b.d), cls: "ship", count: 1 + ar.int(3), kinds: ["sea"], fits: H.fits, add: H.add, r: ar.fork("ships") });
    }
    if (rivers.length && districts.length) {
      const spots = [];
      for (const w of rivers) for (let i = 1; i < w.path.length; i++) {
        const a = w.path[i - 1], b = w.path[i], u = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...u) || 1, n = [-u[1] / l, u[0] / l], side = ar.chance(0.5) ? 1 : -1, off = ((w.width ?? 1) / 2) * 0.45;
        const p = [(a[0] + b[0]) / 2 + n[0] * side * off, (a[1] + b[1]) / 2 + n[1] * side * off];
        const d = Math.min(...districts.map((x) => (pointInPolygon(p, x.poly) ? 0 : distanceToPath(p, [...x.poly, x.poly[0]]))));
        if (d < 6 && (w.width ?? 0) > BOAT_SQUARES.boat * 3) spots.push({ p, u: [u[0] / l, u[1] / l], d: d + ar.next() * 4 });
      }
      afloat({ spots: spots.sort((a, b) => a.d - b.d), cls: "boat", count: ar.int(3), kinds: ["river"], fits: H.fits, add: H.add, r: ar.fork("boats") });
    }
    H.props.forEach((x, k) => items.push({ kind: "prop", id: `harbor/${x.class}-${k + 1}`, from: "plan", ...x, scale: 1 }));
  }
}
