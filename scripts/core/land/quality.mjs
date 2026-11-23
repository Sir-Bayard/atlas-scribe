import { distanceTo } from "./field.mjs";

/**
 * Land checks and deterministic retries: a generated land is scored against its type (land share, the largest land
 * mass's share, a world's open ocean, a range when mountains are asked for, enough rivers, no range ringing a whole
 * plate); a land that fails is made again from a sub-seed, up to a few times, keeping the best. The attempt is
 * recorded, so the same plan still gives the same map. Pure.
 */

/** The problems with a land: [{ check, detail }] (empty when it passes). */
export function landProblems(L, inventory) {
  const out = [];
  const { frame, land, g, landMask } = L;
  // land share over the map
  let a = 0, b = 0;
  for (let i = 0; i < g.n; i++) if (frame.inMap(g.x[i], g.y[i])) { b += g.area[i]; if (landMask[i]) a += g.area[i]; }
  const share = a / (b || 1);
  const want = Number.isFinite(land.share) ? land.share : L.shapeF.share;
  if (Math.abs(share - want) > 0.08) out.push({ check: "share", detail: `land is ${share.toFixed(2)} of the map, asked ${want.toFixed(2)}` });
  // the largest land mass by type
  const masses = inventory.filter((f) => f.kind === "land" || f.kind === "island").map((f) => f.share ?? 0).sort((p, q) => q - p);
  const top = masses[0] ?? 0, second = masses[1] ?? 0;
  if (land.type === "continents" && second < 0.1) out.push({ check: "masses", detail: "continents need two land masses of a tenth of the land or more" });
  if (land.type === "island" && top < 0.8) out.push({ check: "masses", detail: "an island needs one land mass of most of the land" });
  // (from the third generator, a continents map a continent or a world wide: one great land of near a third of the land
  // or more, and an open ocean, some water more than 8% of the map's long side from any land)
  if (land.type === "continents" && (L.gen ?? 0) >= 3 && ["continent", "world"].includes(L.frame.scale)) {
    if (top < 0.3) out.push({ check: "masses", detail: "a world's largest continent has under 30% of the land" });
    if (!openOcean(L)) out.push({ check: "ocean", detail: "no open ocean" });
  }
  if (land.type === "archipelago" && top > 0.4) out.push({ check: "masses", detail: "an archipelago has no land mass over 40% of the land" });
  // (a map under about 40 miles across is smaller than a range and a river's catchment: those two aren't asked of it)
  const big = Math.max(L.frame.mapW, L.frame.mapH) >= 40;
  // a range when mountains are asked for (not of islands: their heights stand in the sea, a peak or two above it)
  if (big && land.mountains > 0.3 && !["archipelago", "arc"].includes(land.type) && !inventory.some((f) => f.kind === "range")) out.push({ check: "range", detail: "no range on land" });
  // rivers, unless the land is mostly small islands
  const mains = L.rivers.filter((R) => R.main).length;
  if (big && !["archipelago", "arc"].includes(land.type) && mains < 2) out.push({ check: "rivers", detail: `only ${mains} river${mains === 1 ? "" : "s"}` });
  // no range ringing a plate: a plate whose boundary nodes are nearly all high
  const { plate } = L.plates;
  const edge = new Float64Array(L.plates.count), high = new Float64Array(L.plates.count);
  for (let i = 0; i < g.n; i++) {
    if (!landMask[i]) continue;
    let onEdge = false;
    for (let k = g.indptr[i]; k < g.indptr[i + 1]; k++) if (plate[g.indices[k]] !== plate[i]) { onEdge = true; break; }
    if (!onEdge) continue;
    edge[plate[i]] += 1; if (L.h[i] > 0.5) high[plate[i]] += 1;
  }
  for (let p = 0; p < L.plates.count; p++) if (edge[p] > 30 && high[p] / edge[p] > 0.8) out.push({ check: "ring", detail: `plate ${p} is ringed by mountains` });
  return out;
}

/** Whether the land's shape has open ocean: a sea pixel in the map more than 8% of its long side from land. */
function openOcean(L) {
  const f = L.shapeF, { frame } = L;
  if (!f) return true;
  const d = distanceTo(f, (i) => f.data[i] > 0), far = 0.08 * Math.max(frame.mapW, frame.mapH);
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (d.data[y * f.w + x] > far && frame.inMap((x + 0.5) * f.cell, (y + 0.5) * f.cell)) return true;
  return false;
}
