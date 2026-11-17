// One phase of laying out a plan (layout/index.mjs, layoutPlan): ctx holds what the phases share.
import { fillFarmstead } from "../settlement.mjs";
import { grow } from "../index.mjs";
import { shapeToPolygon } from "../../geom.mjs";

/**
 * Parks: open ground that streets and plots keep out of (filled later, once the streets around them are known)
 */
export function parksAndFarms(ctx) {
  const { addBuilding, free, items, notes, parks, plan, progress, space, streamFor } = ctx;
  for (const f of parks) {
    const poly = shapeToPolygon(f.shape, f.rot ?? 0);
    space.reserved.push(grow(poly, 0.2));
    space.zones.push(poly);
  }

  // Farmsteads first, so district houses keep out of the farmyards
  progress(0.25, "Farms");
  for (const f of plan.features.filter((f) => f.type === "area" && f.class === "farmstead")) {
    const r = streamFor(f.id);
    const before = items.length;
    notes.push(...fillFarmstead({ area: f, r, free, addBuilding: (b, id, br) => addBuilding(b, id, br, f.id), items }));
    const yard = items.slice(before).find((i) => i.class === "farmyard");
    if (yard) {
      space.reserved.push(grow(yard.poly, 0.35));
      space.zones.push(yard.poly);
    }
  }
}
