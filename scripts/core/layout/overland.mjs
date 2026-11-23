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
import { realmsOf, growRealms, realmGrid, realmReach } from "../land/realms.mjs";
import { keptFor } from "../land/kept.mjs";
import { settledField, settledKey, SETTLED } from "../land/settled.mjs";
import { landmarksOf } from "./landmarks.mjs";
const WATER_SITES = new Set(["wreck", "monster"]);

/** The biome index for a painted zone's own (custom) biome. */
export const CUSTOM_BIOME = 253;

/**
 * The land as the painter needs it: typed arrays per node, positions in frame miles; rivers as [x, y, flow, height,
 * dry] points from source to where they end (dry 1 where the bed runs dry).
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
    // (a fifth value a point: 1 where its bed runs dry, generator 3)
    const pts = R.nodes.map((k, q) => [g.x[k], g.y[k], L.F[k], L.h[k], R.dry?.[q] ?? 0]);
    const last = R.points[R.points.length - 1];
    if (R.points.length > R.nodes.length) {
      const r = L.rec[R.nodes[R.nodes.length - 1]];
      pts.push([last[0], last[1], last[2], L.lakeId[r] >= 0 ? L.lakes[L.lakeId[r]].level : L.h[r], R.dry?.[R.nodes.length - 1] ?? 0]);
    }
    // (nodes: the river's own nodes, source to end; to: the node it flows into, a river it joins or a lake or the
    // sea, or -1)
    const lastNode = R.nodes[R.nodes.length - 1];
    return { id: R.id, parent: R.parent, order: R.order, main: R.main, ends: R.ends, points: pts, nodes: Int32Array.from(R.nodes), to: R.points.length > R.nodes.length ? L.rec[lastNode] : -1 };
  });
  const f = L.frame;
  const marks = L.marks ?? {};
  return {
    gen: L.gen, attempt: L.attempt, tries: L.tries, seed: L.seed,
    frame: { W: f.W, H: f.H, margin: f.margin, mapW: f.mapW, mapH: f.mapH, mpu: f.mpu, scale: f.scale },
    n, x: g.x, y: g.y, area: g.area, triangles: g.triangles, indptr: g.indptr, indices: g.indices, spacing: L.spacing,
    h: L.h, landMask: L.landMask, lake: L.lake, salt: L.salt, lakeId: L.lakeId,
    lakes: L.lakes.map((k) => ({ id: k.id, level: k.level, closed: k.closed, area: k.area })),
    rain: L.rain, temp: L.temp, hard: L.hard, biome, zone, sea, F: L.F, threshold: L.threshold,
    zones: (L.zones ?? []).map((z) => ({ index: z.index, id: z.id ?? null, name: z.name ?? null, biome: z.biome, color: z.color ?? null })),
    rivers, inventory: L.inventory ?? [],
    // (generator 3: the beds of seasonal lakes, each node's rock family, the oases in frame miles)
    seasonal: L.seasonal ?? null, rock: L.rock ?? null, oases: (L.oases ?? []).map((o) => ({ x: o.x, y: o.y })),
    // (the volcanoes' cones, [{ at: [x, y] frame miles, rad }], for their marks)
    cones: (L.cones ?? []).map((c) => ({ at: [c.at[0], c.at[1]], rad: c.rad })),
    // (river marks in frame miles: the head of navigation and the lowest bridging point on main rivers to the sea)
    marks: { heads: marks.heads ?? [], bridges: marks.bridges ?? [] },
  };
}

/**
 * The land covers an overland map's key shows, most first: those on at least 5% of the dry land in the map (a marsh 2%):
 * farmland (settled land), broadleaf, conifer and rainforest, grassland, desert, marsh, tundra, snow and ice; four at
 * most, so the key stays small.
 */
const COVER_OF = { "temperate-forest": "broadleaf", "seasonal-forest": "broadleaf", taiga: "conifer", "temperate-rainforest": "conifer", rainforest: "rainforest", grassland: "grassland", savanna: "grassland", shrubland: "grassland", "hot-desert": "desert", "cold-steppe": "desert", "salt-flat": "desert", wetland: "marsh", tundra: "tundra", glacier: "snow" };
export const COVERS_MAX = 4;
export function coversOf(land, settled) {
  const f = land.frame, share = new Map();
  let dry = 0;
  for (let i = 0; i < land.n; i++) {
    if (!land.landMask[i] || land.lake[i] === 1) continue;
    const u = land.x[i] - f.margin, v = land.y[i] - f.margin;
    if (u < 0 || v < 0 || u > f.mapW || v > f.mapH) continue;
    const a = land.area?.[i] ?? 1;
    dry += a;
    const c = settled[i] >= SETTLED ? "farmland" : COVER_OF[BIOMES[land.biome[i]]];
    if (c) share.set(c, (share.get(c) ?? 0) + a);
  }
  return [...share].filter(([c, a]) => a >= (c === "marsh" ? 0.02 : 0.05) * dry).sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1)).slice(0, COVERS_MAX).map(([c]) => c);
}

// (the last land made, kept while the plan's land doesn't change: a change to places, roads, labels or the plan's
// output then lays out at once; the land is read only, so one land can serve several layouts. Only what a layout
// reads after the compact land is made is kept)
let lastLand = null;
/** Lets go of the land kept for the next layout (a worker's forget, or a layout of another kind of map). */
export function forgetLand() { lastLand = null; }
/** What the land is made from: its settings (not the names given its features, their style or name set, or how many towns), seed, size, grid, picture scale, painted terrain and water. */
function landKey(plan) {
  const { names, keptNames, nameStyle, nameSet, towns, realms, sites, ...landIn } = plan.land ?? {};
  // (and whether a kept land's file was read: a land made without it isn't kept once the file comes)
  return JSON.stringify([landIn, plan.seed, plan.size, plan.output?.grid ?? null, plan.output?.pxPerSquare ?? null, (plan.features ?? []).filter((f) => f && (f.type === "terrain" || f.type === "water")), keptFor(plan)?.error ?? null]);
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
    L = { problems: full.problems, keptError: full.keptError ?? null, attempt: full.attempt, tries: full.tries, frame: full.frame, grid: full.grid, landMask: full.landMask, lake: full.lake, g: { n: full.g.n, x: full.g.x, y: full.g.y, area: full.g.area } };
  }
  lastLand = { key, L, land };
  const [W, H] = extentOf(plan);
  const items = [];
  const notes = L.problems.map((p) => ({ level: "info", id: null, message: `The land is short of its kind here (${p.detail}); it was made ${(L.tries ?? 1) === 1 ? "once" : `${L.tries} times`} and the closest kept.` }));
  // (a kept land whose file couldn't be had: made from its settings, and said)
  if (L.keptError) notes.push({ level: "warning", id: null, message: `This map's kept land couldn't be read (${L.keptError}), so it was made from its settings and may differ. Put its file back at ${plan.land?.keep?.path ?? "its path"}, or Forget the Kept Land.` });
  for (const f of plan.features) {
    if (f.type === "road" && Array.isArray(f.path) && f.path.length >= 2) items.push({ kind: "way", id: f.id, from: f.id, class: f.class, path: f.path, width: REGION_WIDTHS[f.class] ?? 0.12 });
    else if (f.type === "place" && Array.isArray(f.at)) items.push({ kind: "place", id: f.id, from: f.id, class: f.class, x: f.at[0], y: f.at[1], name: f.name ?? null });
    else if (f.type === "crossing" && Array.isArray(f.at)) items.push({ kind: "crossing", id: f.id, from: f.id, class: f.class, x: f.at[0], y: f.at[1], angle: f.angle ?? 0 });
  }
  // Realms: grown from their crowns over the land; each capital's mark crowned
  const realmList = realmsOf(plan);
  let realms = null;
  if (realmList.length) {
    const count = ["few", "some", "many"].includes(plan.land?.realms) ? plan.land.realms : "some";
    const { owner } = growRealms(land, realmList, { reach: realmReach(land, count) });
    const G = realmGrid(land, owner, realmList.length);
    realms = { list: realmList.map((q, k) => ({ ...q, spot: G.realms[k].spot, room: G.realms[k].room, cells: G.realms[k].cells })), grid: { w: G.w, h: G.h, cell: G.cell, ids: G.ids }, borders: G.borders };
    const caps = new Set(realmList.map((q) => q.capital).filter(Boolean));
    for (const it of items) if (it.kind === "place" && caps.has(it.id)) it.capital = true;
  }
  // settled land: how cleared and farmed each node is, from the places and roads (the painter's fields and woods)
  const settled = settledField(land, items);
  const covers = coversOf(land, settled);
  // landmarks from the land (falls, passes, volcanoes...), with the points of interest
  const landmarks = plan.land?.sites === "none" ? [] : landmarksOf(land, settled, items);
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
  // (the realms too: their key entries make the key taller, which can move it to another corner)
  const shape = { size, cornerLand, title, items, overland: true, dressing: plan.output?.dressing === true, places: plan.output?.places !== false, legend: plan.output?.legend !== false, realms, showRealms: plan.output?.realms !== false, covers };
  const keepOut = dressingBoxes(shape, { miles: true, pad: Math.min(W, H) / 100 });
  const keyBox = keyOf(shape);
  const named = overlandLabels(plan, land, items, { keepOut, hidden: keyBox ? [[keyBox.x, keyBox.y, keyBox.x + keyBox.w, keyBox.y + keyBox.h]] : [], realms: plan.output?.realms !== false ? realms?.list ?? [] : [], borders: plan.output?.realms !== false ? realms?.borders ?? [] : [], settled, landmarks });
  for (const it of items) if (it.kind === "place") it.name = named.placeNames.get(it.id) ?? it.name;
  // places standing in water and roads running through it (a GM's edit, or land that changed under them)
  { const fr = L.frame;
    const wetAt = (u, v) => { const i = L.grid.nearest(u * fr.mpu + fr.margin, v * fr.mpu + fr.margin); return i >= 0 && (!L.landMask[i] || L.lake[i] === 1); };
    const named = (it) => `"${it.name ?? it.id}"`;
    for (const it of items) {
      // (a wreck lies in the sea, and a monster may haunt a lake or the sea)
      if (it.kind === "place" && wetAt(it.x, it.y) && !WATER_SITES.has(it.class)) notes.push({ level: "warning", id: it.id, message: `${named(it)} stands in the water; move it onto the land.` });
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
  // (a plan label on a place shows the name the map made for it, in place of the made label, when the place has no
  // name of its own)
  const own = labelsOf(plan).map((l) => {
    const owner = l.of ? plan.features.find((f) => f.id === l.of) : null;
    const text = owner?.type === "place" && !(typeof owner.name === "string" && owner.name.trim()) && !(plan.features.find((f) => f.id === l.id)?.text) ? named.placeNames.get(owner.id) : null;
    return text ? { ...l, text, placeName: true } : l;
  });
  const shadowed = new Set(own.filter((l) => l.placeName).map((l) => `@place:${l.of}`));
  progress(1, "Done");
  return {
    atlasScribe: LAYOUT_VERSION, plan: plan.id ?? null, kind: "region", overland: true, seed: plan.seed,
    size,
    season: plan.season ?? "summer", style: "painted",
    title, dressing: plan.output?.dressing === true, places: plan.output?.places !== false, legend: plan.output?.legend !== false, sun: plan.sun,
    realms, showRealms: plan.output?.realms !== false, settled, settledKey: settledKey(items), covers, landmarks,
    pxPerSquare: plan.output.pxPerSquare, items, labels: [...own, ...named.labels.filter((l) => !shadowed.has(l.id))], landNames: Object.fromEntries(named.featureNames), notes, cornerLand, land,
  };
}
