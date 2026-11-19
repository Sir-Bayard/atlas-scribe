/**
 * An overland map (a region plan with land): the land generated (core/land), kept in the layout in a compact form the
 * painter draws its rasters from, with the plan's places and roads as markers and its labels. Pure: runs anywhere.
 */
import { LAYOUT_VERSION } from "./index.mjs";
import { REGION_WIDTHS } from "./region.mjs";
import { labelsOf } from "../labels.mjs";
import { generateLand } from "../land/index.mjs";
import { extentOf } from "../land/units.mjs";
import { sample } from "../land/field.mjs";
import { BIOMES } from "../land/biome.mjs";
import { LAKE_BIOME, SEA_BIOME } from "../land/raster.mjs";

/** The biome index for a painted zone's own (custom) biome. */
export const CUSTOM_BIOME = 253;

/**
 * The land as the painter needs it: typed arrays per node, positions in frame miles; rivers as [x, y, flow, height]
 * points from source to where they end.
 */
export function compactLand(L) {
  const { g } = L, n = g.n;
  const biome = new Uint8Array(n), zone = new Int16Array(n), sea = new Float32Array(n);
  const index = new Map(BIOMES.map((b, i) => [b, i]));
  for (let i = 0; i < n; i++) {
    const b = L.biome[i];
    biome[i] = b === "sea" ? SEA_BIOME : b === "lake" ? LAKE_BIOME : index.has(b) ? index.get(b) : CUSTOM_BIOME;
    // (the painted zone's index, whatever the biome there: a zone that doesn't react colors its ground too)
    zone[i] = L.zone ? L.zone[i] : 0;
    sea[i] = sample(L.shapeF, g.x[i], g.y[i]);
  }
  const rivers = L.rivers.map((R) => {
    const pts = R.nodes.map((k) => [g.x[k], g.y[k], L.F[k], L.h[k]]);
    const last = R.points[R.points.length - 1];
    if (R.points.length > R.nodes.length) {
      const r = L.rec[R.nodes[R.nodes.length - 1]];
      pts.push([last[0], last[1], last[2], L.lakeId[r] >= 0 ? L.lakes[L.lakeId[r]].level : L.h[r]]);
    }
    return { id: R.id, parent: R.parent, order: R.order, main: R.main, ends: R.ends, points: pts };
  });
  const f = L.frame;
  return {
    gen: L.gen, attempt: L.attempt, seed: L.seed,
    frame: { W: f.W, H: f.H, margin: f.margin, mapW: f.mapW, mapH: f.mapH, mpu: f.mpu, scale: f.scale },
    n, x: g.x, y: g.y, triangles: g.triangles, indptr: g.indptr, indices: g.indices, spacing: L.spacing,
    h: L.h, landMask: L.landMask, lake: L.lake, salt: L.salt, lakeId: L.lakeId,
    lakes: L.lakes.map((k) => ({ id: k.id, level: k.level, closed: k.closed, area: k.area })),
    rain: L.rain, temp: L.temp, hard: L.hard, biome, zone, sea, F: L.F, threshold: L.threshold,
    zones: (L.zones ?? []).map((z) => ({ index: z.index, id: z.id ?? null, name: z.name ?? null, biome: z.biome, color: z.color ?? null })),
    rivers, inventory: L.inventory ?? [],
  };
}

/** Lays out an overland plan (normalized). Returns the layout. */
export function layoutOverland(plan, { onProgress = null } = {}) {
  const progress = (p, l) => onProgress?.(p, l);
  const L = generateLand(plan, { onProgress: (p, l) => progress(0.9 * p, l) });
  const land = compactLand(L);
  const [W, H] = extentOf(plan);
  const items = [];
  const notes = L.problems.map((p) => ({ level: "info", id: null, message: `The land is short of its kind here (${p.detail}); it was made ${L.attempt + 1 === 1 ? "once" : `${L.attempt + 1} times`} and the closest kept.` }));
  for (const f of plan.features) {
    if (f.type === "road" && Array.isArray(f.path) && f.path.length >= 2) items.push({ kind: "way", id: f.id, from: f.id, class: f.class, path: f.path, width: REGION_WIDTHS[f.class] ?? 0.12 });
    else if (f.type === "place" && Array.isArray(f.at)) items.push({ kind: "place", id: f.id, from: f.id, class: f.class, x: f.at[0], y: f.at[1], name: f.name ?? null });
  }
  // (how much of each corner is land, for the dressing: nw, ne, sw, se)
  const cornerLand = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([cx, cy]) => {
    const f = L.frame, x0 = f.margin + cx * f.mapW * 0.76, y0 = f.margin + cy * f.mapH * 0.76;
    let a = 0, b = 0;
    for (let i = 0; i < L.g.n; i++) { const x = L.g.x[i], y = L.g.y[i]; if (x >= x0 && y >= y0 && x <= x0 + f.mapW * 0.24 && y <= y0 + f.mapH * 0.24) { b += L.g.area[i]; if (L.landMask[i]) a += L.g.area[i]; } }
    return b ? Math.round((a / b) * 1000) / 1000 : 0;
  });
  progress(1, "Done");
  return {
    atlasScribe: LAYOUT_VERSION, plan: plan.id ?? null, kind: "region", overland: true, seed: plan.seed,
    size: { squares: [W, H], ftPerSquare: plan.size.ftPerSquare, grid: plan.output?.grid === "hex" ? "hex" : "square", cells: plan.size.squares },
    season: plan.season ?? "summer", style: "painted",
    title: typeof plan.name === "string" && plan.name.trim() ? plan.name.trim() : null, dressing: plan.output?.dressing === true, sun: plan.sun,
    pxPerSquare: plan.output.pxPerSquare, items, labels: labelsOf(plan), notes, cornerLand, land,
  };
}
