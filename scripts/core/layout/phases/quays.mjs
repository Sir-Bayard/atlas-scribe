// One phase of laying out a plan (layout/index.mjs, layoutPlan): ctx holds what the phases share.
import { bandPieces } from "../walls.mjs";
import { layDock, shoreRuns } from "../docks.mjs";
import { seedOf } from "../../seeds.mjs";
import { shoreLife } from "../shores.mjs";

/**
 * Quays and wharves along the water's edge (ways that houses front and streets start from), piers and jetties out
 * into it; then each lake's or sea's shore where no quay covers it, and the reeds and lily pads along it
 */
export function quays(ctx) {
  const { H, W, bodies, items, notes, plan, space, sq, streamFor, ways, winter } = ctx;
  const runsSq = items.filter((i) => i.kind === "water" && i.path);
  const quayEdges = [];
  const docks = []; ctx.docks = docks;
  const laid = []; ctx.laid = laid; // each quay as laid, to lay again along a moat (below)
  for (const f of plan.features.filter((f) => f.type === "dock")) {
    const d = layDock(f, { runs: runsSq, bodies, sq });
    if (!d) { notes.push({ level: "warning", id: f.id, message: `"${f.id}" is too short to build.` }); continue; }
    notes.push(...d.notes);
    if (!d.item) continue;
    items.push(d.item);
    docks.push(d.item);
    if (d.way) {
      const entry = { path: d.way.path, clear: d.way.width / 2 - 0.05, owner: null };
      ways.push(d.way);
      space.ways.push(entry);
      quayEdges.push(d.edge);
      laid.push({ f, d, entry, notes: d.notes });
    }
    for (const poly of d.keep) { space.reserved.push(poly); space.zones.push(poly); }
  }
  for (const b of bodies) {
    const { runs, quayed } = shoreRuns(b.ring, quayEdges);
    b.runs = runs;
    // The shore no quay covers is kept clear: streets end short of it and nothing is placed on it
    for (const run of runs) for (const poly of bandPieces(run, b.keep)) { space.reserved.push(poly); space.zones.push(poly); }
    // Where a quay covers the shore, things keep clear of the water's edge only, as along a river
    if (quayed.some(Boolean)) {
      const entry = space.water.find((w) => w.body === b.poly);
      entry.clears = quayed.map((q) => (q ? 0.225 : entry.clear));
    }
    const life = shoreLife({ body: b, r: streamFor(b.id).fork("life"), docks, seed: seedOf(plan, b.id), W, H, winter });
    life.reeds.forEach((t, k) => items.push({ kind: "reed", id: `${b.id}/r${k + 1}`, from: b.id, ...t }));
    life.lilies.forEach((t, k) => items.push({ kind: "lily", id: `${b.id}/l${k + 1}`, from: b.id, ...t }));
  }
}
