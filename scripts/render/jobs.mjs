/**
 * What the AtlasScribe worker does (render/worker.mjs runs these off Foundry's page; with the Render in a worker
 * setting off, the page runs them itself). Plain data and image URLs in, plain data and images out; nothing of Foundry.
 * Each job is (payload, progress(pct, label)) => result.
 */
import { layoutPlan } from "../core/layout/index.mjs";
import { forgetLand } from "../core/layout/overland.mjs";
import { pinnables } from "../core/pin.mjs";
import { zoomPlan } from "../core/zoom.mjs";
import { paintLayout, styleOf } from "./painter.mjs";
import * as sketch from "./styles/sketch.mjs";
import * as region from "./styles/region.mjs";
import * as overland from "./styles/overland.mjs";

/** The last layout made here, kept so a paint of it needn't be sent it back from the page: { id, layout }. */
let kept = null, nextId = 1;

export const jobs = {
  /**
   * Plan to Layout. Returns { layout, roles, layoutId }: roles are the art roles the layout's style needs; with keep,
   * the layout is kept here for a paint, and layoutId names it.
   */
  async layout({ plan, keep = false }, progress) {
    const layout = layoutPlan(plan, { onProgress: (p, l) => progress(p, l) });
    kept = keep ? { id: nextId++, layout } : null;
    return { layout, roles: styleOf(layout).rolesFor(layout), layoutId: kept?.id ?? null };
  },

  /** Lets go of the layout kept for a paint that won't come (a render that failed or stopped first). */
  async forget() {
    kept = null;
    forgetLand();
    return true;
  },

  /**
   * Layout to image. art: { role: [url, ...] }; scale: { url: factor } for art not drawn at 200 px a square; drawn: {
   * look, all } for a battle map's drawn art. Returns paintLayout's result: { blob, thumb, width, height, tiles,
   * failedArt, brokenArt, overheads, furniture, mist, levels, drawnFiles, ms }.
   */
  async paint({ layout = null, layoutId = null, art, scale, tileSize, quality, format, drawn, partSide }, progress) {
    // (by its id, the layout made here last; a worker started since doesn't have it, and says so)
    const L = layout ?? (kept && kept.id === layoutId ? kept.layout : null);
    if (!L) throw new Error("no layout: the layout to paint isn't kept in this worker (send it)");
    kept = null;
    return paintLayout({ layout: L, art, scale, tileSize, quality, format, drawn, partSide }, progress);
  },

  /**
   * A quick look at a plan: laid out, then painted in plain colors (the sketch style, no art) with the longer side
   * about px pixels. Returns { blob, width, height, pxPerSquare, squares, notes, labels, crossings, pinnables,
   * counts, ms }.
   */
  async preview({ plan, px = 1600 }, progress) {
    const t0 = performance.now();
    const layout = layoutPlan(plan, { onProgress: (p, l) => progress(0.7 * p, l) });
    const [MW, MH] = layout.size.squares;
    const pp = Math.max(4, Math.min(layout.pxPerSquare, px / Math.max(MW, MH)));
    const W = Math.max(1, Math.round(MW * pp)), H = Math.max(1, Math.round(MH * pp));
    const c = new OffscreenCanvas(W, H);
    // (a region in its own style, an overland map painted small: neither has a plain-color sketch)
    const style = layout.kind === "region" ? (layout.overland ? overland : region) : sketch;
    style.paint({ g: c.getContext("2d"), mask: layout.overland ? new OffscreenCanvas(W, H) : null, W, H, x0: 0, y0: 0, pp, layout, art: () => null, progress: (p, l) => progress(0.7 + 0.25 * p, l) });
    progress(0.96, "Encoding");
    const blob = await c.convertToBlob({ type: "image/webp", quality: 0.9 });
    const counts = {};
    for (const i of layout.items) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
    return { blob, width: W, height: H, pxPerSquare: pp, squares: [MW, MH], notes: layout.notes.map((n) => n.message), labels: layout.labels, crossings: layout.items.filter((i) => i.kind === "crossing" && i.id === i.from).map((i) => ({ id: i.id, at: i.at })), pinnables: pinnables(layout), counts, ms: Math.round(performance.now() - t0) };
  },

  /**
   * A battle map of a rectangle on a plan (zoom.mjs): the plan laid out, and the rectangle made a plan of its own.
   * rect: [x0, y0, x1, y1] in the plan's squares. Returns { plan, notes }.
   */
  async zoom({ plan, rect, zoom }, progress) {
    const layout = layoutPlan(plan, { onProgress: (p, l) => progress(0.9 * p, l) });
    progress(0.95, "Making the battle map");
    return zoomPlan(plan, layout, rect, { zoom });
  },
};
