// One phase of laying out a plan (layout/index.mjs, layoutPlan): ctx holds what the phases share.
import { riverbed } from "../riverbed.mjs";
import { rng } from "../../rng.mjs";
import { seedOf } from "../../seeds.mjs";

/** A path's points with more between them, no two more than step squares apart. */
const densify = (path, step) => path.flatMap((a, i) => { if (!i) return [a]; const b = path[i - 1], n = Math.max(1, Math.ceil(Math.hypot(a[0] - b[0], a[1] - b[1]) / step)); return Array.from({ length: n }, (_, k) => [b[0] + ((a[0] - b[0]) * (k + 1)) / n, b[1] + ((a[1] - b[1]) * (k + 1)) / n]); });

/**
 * Riverbeds, once everything that meets the water is laid: a running water's gravel bars and islands when its plan
 * asks (shallows, islands), clear of the bridges, fords, docks, boats and mills on it. A battle map's water takes its
 * bars but no islands (the ground in it would want its own walls), said in a note.
 */
export function riverbeds(ctx) {
  const { battle, items, notes, plan } = ctx;
  const asked = plan.features.filter((f) => f.type === "water" && (f.shallows === true || f.islands > 0));
  if (!asked.length) return;
  const avoid = [
    ...items.filter((i) => i.kind === "crossing" && Array.isArray(i.at)).map((i) => i.at),
    ...items.filter((i) => i.kind === "prop" && ["boat", "ship", "waterwheel", "crane"].includes(i.class)).map((i) => [i.x, i.y]),
    ...items.filter((i) => (i.kind === "dock" || i.kind === "way") && Array.isArray(i.path)).flatMap((i) => densify(i.path, 0.5)),
  ];
  for (const f of asked) {
    const w = items.find((i) => i.kind === "water" && i.from === f.id && Array.isArray(i.path));
    if (!w) continue;
    if (battle && f.islands > 0) notes.push({ level: "info", id: f.id, message: `"${f.id}": islands are drawn on settlement maps only; its shallows are drawn here.` });
    const bed = riverbed(w, { shallows: f.shallows === true, islands: battle ? 0 : f.islands }, { avoid, r: rng(seedOf(plan, f.id), f.id, "bed") });
    if (bed.bars.length) w.bars = bed.bars;
    if (bed.islands.length) w.islands = bed.islands;
  }
}
