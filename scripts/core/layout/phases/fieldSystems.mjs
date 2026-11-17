// One phase of laying out a plan (layout/index.mjs, layoutPlan): ctx holds what the phases share.
import { battleField, earlierFields, fieldKeepOut, fieldRoads, fillFields } from "../fields.mjs";
import { hedgeBushes } from "../settlement.mjs";
import { seasonOf } from "../../roles.mjs";

/**
 * Field systems: open ground, so nothing keeps out of them; their hedgerow trees keep clear of every building (on a
 * battle map each area is one field)
 */
export function fieldSystems(ctx) {
  const { H, W, battle, free, items, notes, plan, progress, sq, streamFor } = ctx;
  progress(0.55, "Fields");
  const keepOutMemo = {}; // what every field system keeps out of, worked out once
  for (const f of plan.features.filter((f) => f.type === "area" && f.class === "fields")) {
    const r = streamFor(f.id);
    // (on a battle map the area is one field, its rows at battle size)
    if (battle) { const fd = battleField(f, r, seasonOf(plan)); if (fd) items.push({ kind: "field", id: `${f.id}/f1`, from: f.id, system: "field", ...fd }); continue; }
    const made = fillFields({ area: f, r, keepOut: fieldKeepOut(plan, f, keepOutMemo), earlier: earlierFields(plan, f), along: fieldRoads(plan), W, H, ftPerSquare: sq, season: seasonOf(plan) });
    notes.push(...made.notes);
    made.fields.forEach((fd, k) => items.push({ kind: "field", id: `${f.id}/f${k + 1}`, from: f.id, system: made.system, ...fd }));
    made.balks.forEach((path, k) => items.push({ kind: "boundary", id: `${f.id}/k${k + 1}`, from: f.id, class: "balk", path }));
    made.walls.forEach((path, k) => items.push({ kind: "wall", id: `${f.id}/w${k + 1}`, from: f.id, class: "drystone", path, height: 3 / sq }));
    made.hedges.forEach((path, k) => {
      items.push({ kind: "boundary", id: `${f.id}/h${k + 1}`, from: f.id, class: "hedge", path });
      // Each hedge's bushes from a stream keyed by where it runs, so a hedge nothing touched keeps its bushes
      hedgeBushes({ wall: { id: `${f.id}/h${k + 1}`, from: f.id, path }, r: r.fork("hedge", ...path[0].map((v) => v.toFixed(2)), ...path[path.length - 1].map((v) => v.toFixed(2))), items, step: 0.45, scale: [0.55, 0.25], free });
    });
    let n = 0;
    for (const t of made.trees) if (free(t.x, t.y, 0.4)) items.push({ kind: "tree", id: `${f.id}/t${++n}`, from: f.id, x: t.x, y: t.y, species: "bare", size: null, s: t.s, rot: t.rot, variant: t.variant });
    if (made.fields.length) notes.push({ level: "info", id: f.id, message: `"${f.id}": ${made.system === "strips" ? "open strips" : "enclosed fields"}, ${made.fields.length} ${made.system === "strips" ? "strips" : "fields"}.` });
  }
}
