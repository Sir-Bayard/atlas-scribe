/**
 * An overland map (a region plan with land): the land generated (core/land), kept in the layout in a compact form the
 * painter draws its rasters from, with the plan's places and roads as markers and its labels. Pure: runs anywhere.
 */
import { LAYOUT_VERSION } from "./index.mjs";
import { REGION_WIDTHS } from "./region.mjs";
import { labelsOf } from "../labels.mjs";
import { overlandLabels } from "./overland-labels.mjs";
import { dressingBoxes, keyOf } from "../dressing.mjs";
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
    // (nodes: the river's own nodes, source to end; to: the node it flows into, a river it joins or a lake or the
    // sea, or -1)
    const lastNode = R.nodes[R.nodes.length - 1];
    return { id: R.id, parent: R.parent, order: R.order, main: R.main, ends: R.ends, points: pts, nodes: Int32Array.from(R.nodes), to: R.points.length > R.nodes.length ? L.rec[lastNode] : -1 };
  });
  const f = L.frame;
  const marks = L.marks ?? {};
  return {
    gen: L.gen, attempt: L.attempt, seed: L.seed,
    frame: { W: f.W, H: f.H, margin: f.margin, mapW: f.mapW, mapH: f.mapH, mpu: f.mpu, scale: f.scale },
    n, x: g.x, y: g.y, triangles: g.triangles, indptr: g.indptr, indices: g.indices, spacing: L.spacing,
    h: L.h, landMask: L.landMask, lake: L.lake, salt: L.salt, lakeId: L.lakeId,
    lakes: L.lakes.map((k) => ({ id: k.id, level: k.level, closed: k.closed, area: k.area })),
    rain: L.rain, temp: L.temp, hard: L.hard, biome, zone, sea, F: L.F, threshold: L.threshold,
    zones: (L.zones ?? []).map((z) => ({ index: z.index, id: z.id ?? null, name: z.name ?? null, biome: z.biome, color: z.color ?? null })),
    rivers, inventory: L.inventory ?? [],
    // (river marks in frame miles: the head of navigation and the lowest bridging point on main rivers to the sea)
    marks: { heads: marks.heads ?? [], bridges: marks.bridges ?? [] },
  };
}

// (the last land made, kept while the plan's land doesn't change: a change to places, roads, labels or the plan's
// output then lays out at once; the land is read only, so one land can serve several layouts. Only what a layout
// reads after the compact land is made is kept)
let lastLand = null;
/** Lets go of the land kept for the next layout (a worker's forget, or a layout of another kind of map). */
export function forgetLand() { lastLand = null; }
/** What the land is made from: its settings (not the names given its features, their style or how many towns), seed, size, grid, picture scale, painted terrain and water. */
function landKey(plan) {
  const { names, nameStyle, towns, ...landIn } = plan.land ?? {};
  return JSON.stringify([landIn, plan.seed, plan.size, plan.output?.grid ?? null, plan.output?.pxPerSquare ?? null, (plan.features ?? []).filter((f) => f && (f.type === "terrain" || f.type === "water"))]);
}

/** Lays out an overland plan (normalized). Returns the layout. */
export function layoutOverland(plan, { onProgress = null } = {}) {
  const progress = (p, l) => onProgress?.(p, l);
  const key = landKey(plan);
  let L, land;
  if (lastLand?.key === key) ({ L, land } = lastLand);
  else {
    const full = generateLand(plan, { onProgress: (p, l) => progress(0.9 * p, l) });
    land = compactLand(full);
    L = { problems: full.problems, attempt: full.attempt, frame: full.frame, grid: full.grid, landMask: full.landMask, lake: full.lake, g: { n: full.g.n, x: full.g.x, y: full.g.y, area: full.g.area } };
  }
  lastLand = { key, L, land };
  const [W, H] = extentOf(plan);
  const items = [];
  const notes = L.problems.map((p) => ({ level: "info", id: null, message: `The land is short of its kind here (${p.detail}); it was made ${L.attempt + 1 === 1 ? "once" : `${L.attempt + 1} times`} and the closest kept.` }));
  for (const f of plan.features) {
    if (f.type === "road" && Array.isArray(f.path) && f.path.length >= 2) items.push({ kind: "way", id: f.id, from: f.id, class: f.class, path: f.path, width: REGION_WIDTHS[f.class] ?? 0.12 });
    else if (f.type === "place" && Array.isArray(f.at)) items.push({ kind: "place", id: f.id, from: f.id, class: f.class, x: f.at[0], y: f.at[1], name: f.name ?? null });
    else if (f.type === "crossing" && Array.isArray(f.at)) items.push({ kind: "crossing", id: f.id, from: f.id, class: f.class, x: f.at[0], y: f.at[1], angle: f.angle ?? 0 });
  }
  // (how much of each corner is land, for the dressing: nw, ne, sw, se)
  const cornerLand = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([cx, cy]) => {
    const f = L.frame, x0 = f.margin + cx * f.mapW * 0.76, y0 = f.margin + cy * f.mapH * 0.76;
    let a = 0, b = 0;
    for (let i = 0; i < L.g.n; i++) { const x = L.g.x[i], y = L.g.y[i]; if (x >= x0 && y >= y0 && x <= x0 + f.mapW * 0.24 && y <= y0 + f.mapH * 0.24) { b += L.g.area[i]; if (L.landMask[i]) a += L.g.area[i]; } }
    // (each place or crossing in the corner counts as a share of land too, and each road through it by its length
    // there, so the compass and scale bar keep off them)
    const [W0, H0] = [f.mapW / f.mpu, f.mapH / f.mpu], u0 = cx * W0 * 0.76, v0 = cy * H0 * 0.76, cw = W0 * 0.24, ch = H0 * 0.24;
    const inC = (x, y) => x >= u0 && y >= v0 && x <= u0 + cw && y <= v0 + ch;
    const marks = items.filter((it) => (it.kind === "place" || it.kind === "crossing") && inC(it.x, it.y)).length;
    let road = 0;
    for (const it of items) if (it.kind === "way") for (let m = 1; m < it.path.length; m++) {
      const [ax, ay] = it.path[m - 1], [bx, by] = it.path[m], len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)), k = Math.max(1, Math.ceil(len / 0.25));
      for (let q = 0; q < k; q++) { const t = (q + 0.5) / k; if (inC(ax + (bx - ax) * t, ay + (by - ay) * t)) road += len / k; }
    }
    return b ? Math.round((a / b + 0.12 * marks + (0.6 * road) / Math.max(1e-9, Math.min(cw, ch))) * 1000) / 1000 : 0;
  });
  // names and labels: every place and the land's features, the plan's own names first (hidden labels, placed after the
  // places so they keep off the marks, and off the dressing's corners)
  const title = typeof plan.name === "string" && plan.name.trim() ? plan.name.trim() : null;
  const size = { squares: [W, H], ftPerSquare: plan.size.ftPerSquare, grid: plan.output?.grid === "hex" ? "hex" : "square", cells: plan.size.squares };
  const shape = { size, cornerLand, title, items, overland: true, dressing: plan.output?.dressing === true, places: plan.output?.places !== false, legend: plan.output?.legend !== false };
  const keepOut = dressingBoxes(shape, { miles: true, pad: Math.min(W, H) / 100 });
  const keyBox = keyOf(shape);
  const named = overlandLabels(plan, land, items, { keepOut, hidden: keyBox ? [[keyBox.x, keyBox.y, keyBox.x + keyBox.w, keyBox.y + keyBox.h]] : [] });
  for (const it of items) if (it.kind === "place") it.name = named.placeNames.get(it.id) ?? it.name;
  // places standing in water and roads running through it (a GM's edit, or land that changed under them)
  { const fr = L.frame;
    const wetAt = (u, v) => { const i = L.grid.nearest(u * fr.mpu + fr.margin, v * fr.mpu + fr.margin); return i >= 0 && (!L.landMask[i] || L.lake[i] === 1); };
    const named = (it) => `"${it.name ?? it.id}"`;
    for (const it of items) {
      if (it.kind === "place" && wetAt(it.x, it.y)) notes.push({ level: "warning", id: it.id, message: `${named(it)} stands in the water; move it onto the land.` });
      if (it.kind !== "way") continue;
      // (samples about every 2 miles, at most every half unit; over 10 miles of water in a row is more than a bridge)
      const gap = Math.min(0.5, 2 / fr.mpu), most = Math.max(3, Math.ceil(10 / (gap * fr.mpu)));
      let run = 0, worst = 0;
      for (let m = 1; m < it.path.length; m++) {
        const [ax, ay] = it.path[m - 1], [bx, by] = it.path[m], steps = Math.max(1, Math.ceil(Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) / gap));
        for (let s = m === 1 ? 0 : 1; s <= steps; s++) { const t = s / steps; run = wetAt(ax + (bx - ax) * t, ay + (by - ay) * t) ? run + 1 : 0; worst = Math.max(worst, run); }
      }
      if (worst >= most) notes.push({ level: "warning", id: it.id, message: `${named(it)} runs a long way through open water (more than a bridge would cross); it's drawn as it is.` });
    }
  }
  progress(1, "Done");
  return {
    atlasScribe: LAYOUT_VERSION, plan: plan.id ?? null, kind: "region", overland: true, seed: plan.seed,
    size,
    season: plan.season ?? "summer", style: "painted",
    title, dressing: plan.output?.dressing === true, places: plan.output?.places !== false, legend: plan.output?.legend !== false, sun: plan.sun,
    pxPerSquare: plan.output.pxPerSquare, items, labels: [...labelsOf(plan), ...named.labels], landNames: Object.fromEntries(named.featureNames), notes, cornerLand, land,
  };
}
