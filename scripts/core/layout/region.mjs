/**
 * A region map (plan kind "region"): many places on one map, at a scale of miles. Its places (cities, towns,
 * villages, castles, ruins...) are markers with their names, its roads and rivers lines drawn wide enough to see, its
 * woods trees, its mountains and hills peaks, its marshes reeds, its farmland a tint. Nothing is built street by street:
 * a place's own map is made from it (Quick Start at the place's size). Pure: runs anywhere.
 */
import { LAYOUT_VERSION } from "./index.mjs";
import { labelsOf } from "../labels.mjs";
import { bbox, pointInPolygon, shapeToPolygon } from "../geom.mjs";
import { poissonInPolygon } from "../scatter.mjs";
import { rng } from "../rng.mjs";
import { seedOf } from "../seeds.mjs";

/** How wide a region's lines are drawn, in squares (true widths would be hairlines at a mile a square). */
export const REGION_WIDTHS = { river: 0.32, stream: 0.16, canal: 0.2, highway: 0.22, street: 0.15, lane: 0.11, track: 0.08, path: 0.06 };
/** The places a region shows, biggest first. */
export const PLACE_CLASSES = ["city", "town", "village", "hamlet", "castle", "ruin", "tower", "temple", "inn", "mine"];
/** The ground a region's areas can be. */
export const REGION_AREAS = ["woods", "mountains", "hills", "marsh", "fields"];

/** Lays out a region plan (normalized). Returns the layout, as layoutPlan's. */
export function layoutRegion(plan, { onProgress = null } = {}) {
  const progress = (p, l) => onProgress?.(p, l);
  const [W, H] = plan.size.squares;
  const items = [{ kind: "ground", id: "ground", base: plan.ground ?? "grass" }];
  const notes = [];
  const streamFor = (id) => rng(seedOf(plan, id), id);
  progress(0.1, "Water");
  for (const f of plan.features) {
    if (f.type === "water" && Array.isArray(f.path) && f.path.length >= 2) items.push({ kind: "water", id: f.id, from: f.id, class: f.class, path: f.path, width: REGION_WIDTHS[f.class] ?? 0.2 });
    else if (f.type === "water" && f.shape) { const poly = shapeToPolygon(f.shape); if (poly.length >= 3) items.push({ kind: "water", id: f.id, from: f.id, class: f.class, poly }); }
  }
  progress(0.3, "Land");
  for (const f of plan.features.filter((x) => x.type === "area")) {
    const poly = shapeToPolygon(f.shape, f.rot ?? 0);
    if (poly.length < 3) continue;
    const r = streamFor(f.id);
    const [x0, y0, x1, y1] = bbox(poly);
    const big = (x1 - x0) * (y1 - y0);
    const dots = (spacing, max) => poissonInPolygon(poly, spacing, r.fork("dots"), { max: Math.min(max, Math.ceil((big / (spacing * spacing)) * 1.2)) });
    if (f.class === "woods") items.push({ kind: "forest", id: f.id, from: f.id, poly, trees: dots(0.85, 6000).map(([x, y]) => [x, y, 0.75 + r.next() * 0.5]) });
    else if (f.class === "mountains") for (const [k, [x, y]] of dots(1.7, 1500).entries()) items.push({ kind: "peak", id: `${f.id}/p${k + 1}`, from: f.id, x, y, s: 0.8 + r.next() * 0.6, snow: r.next() < 0.6 });
    else if (f.class === "hills") for (const [k, [x, y]] of dots(1.5, 2000).entries()) items.push({ kind: "hillock", id: `${f.id}/h${k + 1}`, from: f.id, x, y, s: 0.7 + r.next() * 0.5 });
    else if (f.class === "marsh") { items.push({ kind: "marsh", id: f.id, from: f.id, poly }); for (const [k, [x, y]] of dots(0.9, 3000).entries()) items.push({ kind: "tuft", id: `${f.id}/t${k + 1}`, from: f.id, x, y }); }
    else if (f.class === "fields") items.push({ kind: "farmland", id: f.id, from: f.id, poly });
    else notes.push({ level: "warning", id: f.id, message: `"${f.name ?? f.id}" is ${f.class === "park" ? "a park" : `a ${f.class}`}, which a region map doesn't draw; it's left off.` });
  }
  progress(0.6, "Roads");
  for (const f of plan.features.filter((x) => x.type === "road" && Array.isArray(x.path) && x.path.length >= 2)) items.push({ kind: "way", id: f.id, from: f.id, class: f.class, path: f.path, width: REGION_WIDTHS[f.class] ?? 0.12 });
  progress(0.8, "Places");
  for (const f of plan.features.filter((x) => x.type === "place" && Array.isArray(x.at))) items.push({ kind: "place", id: f.id, from: f.id, class: f.class, x: f.at[0], y: f.at[1], name: f.name ?? null });
  const skipped = plan.features.filter((f) => ["district", "building", "landmark", "square", "wall", "height", "crossing", "prop", "tree"].includes(f.type));
  if (skipped.length) notes.push({ level: "warning", id: null, message: `${skipped.length} ${skipped.length === 1 ? "feature is" : "features are"} of a kind a region map doesn't draw (districts, buildings, squares, walls and the like belong on a place's own map), so ${skipped.length === 1 ? "it's" : "they're"} left off.` });
  // (trees out of the water and off the roads' lines; peaks and hills out of the water)
  const wet = items.filter((i) => i.kind === "water" && i.poly);
  const inWet = (x, y) => wet.some((w) => pointInPolygon([x, y], w.poly));
  for (const fo of items.filter((i) => i.kind === "forest")) fo.trees = fo.trees.filter(([x, y]) => !inWet(x, y) && x > -1 && y > -1 && x < W + 1 && y < H + 1);
  const dry = items.filter((i) => !((i.kind === "peak" || i.kind === "hillock" || i.kind === "tuft") && inWet(i.x, i.y)));
  progress(1, "Done");
  return {
    atlasScribe: LAYOUT_VERSION, plan: plan.id ?? null, kind: "region", seed: plan.seed,
    size: { squares: [W, H], ftPerSquare: plan.size.ftPerSquare }, season: plan.season ?? "summer", style: "region",
    title: typeof plan.name === "string" && plan.name.trim() ? plan.name.trim() : null, dressing: plan.output?.dressing === true, sun: plan.sun,
    pxPerSquare: plan.output.pxPerSquare, items: dry, labels: labelsOf(plan), notes,
  };
}
