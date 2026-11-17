// One phase of laying out a plan (layout/index.mjs, layoutPlan): ctx holds what the phases share.
import { battleWoods, openRocks, rockfall } from "../wild.mjs";
import { fillWoods, hedgeBushes } from "../settlement.mjs";
import { clearing } from "../cleared.mjs";
import { pointInPolygon, shapeToPolygon } from "../../geom.mjs";
import { rng } from "../../rng.mjs";
import { seasonOf } from "../../roles.mjs";
import { seedOf } from "../../seeds.mjs";

/** A ring's points with more between them, no two more than step squares apart. */
const densify = (ring, step) => ring.flatMap((a, i) => { const b = ring[(i + 1) % ring.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); return Array.from({ length: n }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]); });

/**
 * Woods and hedgerows last: trees keep clear of every building
 */
export function woodsAndRocks(ctx) {
  const { H, W, battle, dropWet, free, items, notes, plan, progress, streamFor } = ctx;
  const ftPer = plan.size?.ftPerSquare ?? 25;
  progress(0.6, "Woods");
  // (the town a cleared wood is thinned toward: its districts' outlines and its buildings, gathered once)
  let town = null;
  const townPoints = () => (town ??= [
    ...plan.features.filter((f) => (f.type === "district" || f.type === "landmark") && f.shape).flatMap((f) => densify(shapeToPolygon(f.shape, f.rot ?? 0), 2)),
    ...items.filter((i) => i.kind === "building" && Number.isFinite(i.cx)).map((b) => [b.cx, b.cy]),
  ]);
  for (const f of plan.features.filter((f) => f.type === "area" && f.class === "woods")) {
    // (cleared: thinned over the 300 ft nearest the town, kept between 6 and 16 squares: 80 ft on a battle map)
    const cleared = f.cleared === true ? clearing(townPoints(), { band: Math.min(16, Math.max(6, 300 / ftPer)), id: f.id, sq: ftPer, battle }) : null;
    // (a battle map's woods at battle size: trees apart, with the ground between dressed, wild.mjs)
    if (battle) { const w = battleWoods({ area: f, r: streamFor(f.id), free, season: seasonOf(plan), cleared }); items.push(...w.items); notes.push(...w.notes); }
    else notes.push(...fillWoods({ area: f, r: streamFor(f.id), free, items, winter: seasonOf(plan) === "winter", cleared }));
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
    hedgeBushes({ wall: f, r: streamFor(f.id), items, free });
    dropWet(before);
  }
}
