// One phase of laying out a plan (layout/index.mjs, layoutPlan): ctx holds what the phases share.
import { PROP_SQUARES } from "../../plan.mjs";
import { bbox, distanceToPath, pointInPolygon, shapeToPolygon } from "../../geom.mjs";
import { marketStalls } from "../market.mjs";
import { nearWater } from "../../water.mjs";
import { rng } from "../../rng.mjs";
import { seedOf } from "../../seeds.mjs";

/**
 * Squares: a fountain or market cross near the middle (as set, else by seed), clear of the roads through it; then
 * market stalls in rows along the road, clear of everything there. Laid after the walls, moats and docks
 */
export function squares(ctx) {
  const { H, W, footOf, inWallBand, items, plan, space, sq, ways } = ctx;
  for (const f of plan.features.filter((x) => x.type === "square")) {
    const poly = shapeToPolygon(f.shape), ring = [...poly, poly[0]];
    if (poly.length < 3 || !poly.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) continue; // (the checker refuses it)
    const [x0, y0, x1, y1] = bbox(poly);
    const at = f.shape?.circle ? [f.shape.circle[0], f.shape.circle[1]] : [(x0 + x1) / 2, (y0 + y1) / 2];
    // The rows run along the road nearest its middle, else along its longer side
    let angle = x1 - x0 >= y1 - y0 ? 0 : 90, best = Infinity;
    for (const w of ways) for (let i = 1; i < w.path.length; i++) {
      const a = w.path[i - 1], b = w.path[i], d = distanceToPath(at, [a, b]);
      if (d < best && d < Math.max(x1 - x0, y1 - y0) / 2) { best = d; angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI; }
    }
    const fixedBuildings = items.filter((i) => i.kind === "building").map(footOf);
    // (each plan prop or tree by its own size; walls, hedges and fences as lines)
    const fixedProps = items.filter((i) => i.kind === "prop" || i.kind === "tree").map((q) => ({ x: q.x, y: q.y, r: q.kind === "tree" ? 0.5 : ((PROP_SQUARES[q.class] ?? 0.45) * (q.scale ?? 1)) / 2 }));
    const lines = items.filter((i) => (i.kind === "wall" || i.kind === "boundary") && Array.isArray(i.path));
    const walled = (p, m) => inWallBand(p[0], p[1]) || lines.some((w) => distanceToPath(p, w.path) < (w.thickness ?? 0.2) / 2 + m);
    const clear = (p) => (!mid || Math.hypot(p[0] - mid[0], p[1] - mid[1]) > 0.9)
      && ways.every((w) => distanceToPath(p, w.path) > w.width / 2 + 0.08)
      && !space.water.some((w) => nearWater(p, w, 0.3)) && !walled(p, 0.15)
      && !fixedBuildings.some((b) => pointInPolygon(p, b) || distanceToPath(p, [...b, b[0]]) < 0.15)
      && fixedProps.every((q) => Math.hypot(q.x - p[0], q.y - p[1]) > q.r + 0.15);
    const inside = (p) => pointInPolygon(p, poly) && distanceToPath(p, ring) > 0.2;
    const mr = rng(seedOf(plan, f.id), f.id, "middle"), roll = mr.next(), turn = mr.next() * 360, variant = mr.int(8);
    const kind = ["fountain", "cross", "none"].includes(f.middle) ? f.middle
      : f.market ? (roll < 0.55 ? "cross" : "fountain")
      : f.surface === "grass" ? (roll < 0.25 ? "cross" : "none")
      : roll < 0.4 ? "fountain" : roll < 0.6 ? "cross" : "none";
    let mid = null;
    if (kind !== "none") {
      const rad = (kind === "fountain" ? 20 : 12) / sq / 2;
      const ok = (p) => inside(p) && distanceToPath(p, ring) > rad + 0.2 && ways.every((w) => distanceToPath(p, w.path) > w.width / 2 + rad + 0.3) && !space.water.some((w) => nearWater(p, w, rad + 0.3))
        && !walled(p, rad + 0.2) && !fixedBuildings.some((b) => pointInPolygon(p, b) || distanceToPath(p, [...b, b[0]]) < rad + 0.2) && fixedProps.every((q) => Math.hypot(q.x - p[0], q.y - p[1]) > q.r + rad + 0.2);
      // The open spot nearest the middle (rings out from it)
      for (let d = 0; d <= Math.max(x1 - x0, y1 - y0) / 2 && !mid; d += 0.25) for (let k = 0, n = Math.max(1, Math.round(d * 8)); k < n && !mid; k++) {
        const p = [at[0] + Math.cos((k / n) * 2 * Math.PI) * d, at[1] + Math.sin((k / n) * 2 * Math.PI) * d];
        if (ok(p)) mid = p;
      }
      if (mid) {
        const size = kind === "fountain" ? 20 : 12;
        items.push({ kind: "prop", id: `${f.id}/${kind}`, from: f.id, class: kind, x: mid[0], y: mid[1], rot: kind === "cross" ? angle : turn, variant, scale: size / sq / PROP_SQUARES[kind] });
        fixedProps.push({ x: mid[0], y: mid[1], r: rad });
      }
    }
    if (f.market !== true) continue;
    const reach = Math.min(Math.hypot(x1 - x0, y1 - y0) / 2 + 1, Math.hypot(W, H));
    marketStalls({ at, angle, reach, inside, clear, r: rng(seedOf(plan, f.id), f.id, "stalls"), sq }).forEach((x, k) => items.push({ kind: "prop", id: `${f.id}/stall-${k + 1}`, from: f.id, ...x }));
  }
}
