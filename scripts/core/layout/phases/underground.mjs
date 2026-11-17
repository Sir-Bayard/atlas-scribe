// One phase of laying out a plan (layout/index.mjs, layoutPlan): ctx holds what the phases share.
import { grow } from "../index.mjs";
import { shapeToPolygon } from "../../geom.mjs";
import { layUnderground } from "../underground.mjs";

/**
 * Caves and dungeons (battle maps): rock with its floor carved out, laid out before anything else is placed, and kept
 * clear of everything else; on a settlement map a note says they're drawn only on battle maps
 */
export function underground(ctx) {
  const { battle, items, notes, plan, progress, space, streamFor } = ctx;
  const areas = plan.features.filter((f) => f.type === "area" && (f.class === "cave" || f.class === "dungeon"));
  if (!areas.length) return;
  if (!battle) {
    for (const f of areas) notes.push({ level: "warning", id: f.id, message: `"${f.name ?? f.id}" is a ${f.class}, drawn only on a battle map; it's left out of this one.` });
    return;
  }
  progress(0.08, "Caves and dungeons");
  for (const f of areas) {
    const { items: made, floor } = layUnderground(f, streamFor(f.id));
    if (!floor.length) { notes.push({ level: "warning", id: f.id, message: `"${f.name ?? f.id}" is too small to carve a ${f.class} in.` }); continue; }
    items.push(...made);
    const poly = shapeToPolygon(f.shape, f.rot ?? 0);
    space.reserved.push(grow(poly, 0.2));
    space.zones.push(poly);
  }
}
