// One phase of laying out a plan (layout/index.mjs, layoutPlan): ctx holds what the phases share.
import { battleWoods, openRocks, rockfall } from "../wild.mjs";
import { fillWoods, hedgeBushes } from "../settlement.mjs";
import { pointInPolygon, shapeToPolygon } from "../../geom.mjs";
import { rng } from "../../rng.mjs";
import { seasonOf } from "../../roles.mjs";
import { seedOf } from "../../seeds.mjs";

/**
 * Woods and hedgerows last: trees keep clear of every building
 */
export function woodsAndRocks(ctx) {
  const { H, W, battle, dropWet, free, items, notes, plan, progress, streamFor } = ctx;
  progress(0.6, "Woods");
  for (const f of plan.features.filter((f) => f.type === "area" && f.class === "woods")) {
    // (a battle map's woods at battle size: trees apart, with the ground between dressed, wild.mjs)
    if (battle) { const w = battleWoods({ area: f, r: streamFor(f.id), free, season: seasonOf(plan) }); items.push(...w.items); notes.push(...w.notes); }
    else notes.push(...fillWoods({ area: f, r: streamFor(f.id), free, items, winter: seasonOf(plan) === "winter" }));
  }
  // Fallen rock at the foot of each cliff
  if (battle) for (const e of items.filter((i) => i.kind === "edge" && i.style === "cliff")) items.push(...rockfall({ edge: e, r: rng(seedOf(plan, e.from), e.id, "fall"), free }));
  // Loose rock about a wild battle map's open ground (none in a town's: a battle map with a district or building)
  if (battle && !plan.features.some((f) => f.type === "district" || f.type === "building" || f.type === "landmark")) {
    const standing = items.filter((i) => (i.kind === "tree" || i.kind === "prop") && Number.isFinite(i.x));
    const woods = plan.features.filter((f) => f.type === "area" && f.class === "woods" && f.shape).map((f) => shapeToPolygon(f.shape, f.rot ?? 0));
    const near = (x, y, d) => woods.some((p) => pointInPolygon([x, y], p)) || standing.some((i) => Math.hypot(i.x - x, i.y - y) < d);
    items.push(...openRocks({ W, H, r: rng(plan.seed, "ground", "rocks"), free, near, edges: items.filter((i) => i.kind === "edge") }));
  }
  for (const f of plan.features.filter((f) => f.type === "wall" && f.class === "hedge")) {
    const before = items.length;
    hedgeBushes({ wall: f, r: streamFor(f.id), items });
    dropWet(before);
  }
}
