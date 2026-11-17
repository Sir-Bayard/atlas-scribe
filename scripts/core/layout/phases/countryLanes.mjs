// One phase of laying out a plan (layout/index.mjs, layoutPlan): ctx holds what the phases share.
import { accessLanes } from "../fields.mjs";
import { nearWater } from "../../water.mjs";

/**
 * Lanes out to the roads: a track from each farmyard, and from a yard, park or square out in the country, to the
 * road nearest it (the fields keep off them)
 */
export function countryLanes(ctx) {
  const { bodies, items, plan, space } = ctx;
  const lanes = []; ctx.lanes = lanes;
  for (const lane of accessLanes(plan)) {
    const item = { kind: "way", id: lane.id, from: lane.from, class: "track", path: lane.path, width: lane.width, surface: "trodden", ruts: false, faint: true };
    items.push(item);
    lanes.push(item);
    space.ways.push({ path: lane.path, clear: lane.width / 2 });
  }

  /** Hedge bushes added since item number from that stand in a pond, lake or the sea, or on its shore, taken out again. */
  const dropWet = (from) => {
    if (!bodies.length) return;
    for (let k = items.length - 1; k >= from; k--) if (space.water.some((w) => w.body && nearWater([items[k].x, items[k].y], w))) items.splice(k, 1);
  }; ctx.dropWet = dropWet;
}
