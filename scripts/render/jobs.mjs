/**
 * What the AtlasScribe worker does (render/worker.mjs runs these off Foundry's page; with the Render in a worker
 * setting off, the page runs them itself). Plain data and image URLs in, plain data and images out; nothing of Foundry.
 * Each job is (payload, progress(pct, label)) => result.
 */
import { layoutPlan } from "../core/layout/index.mjs";
import { forgetLand } from "../core/layout/overland.mjs";
import { pinnables } from "../core/pin.mjs";
import { zoomPlan } from "../core/zoom.mjs";
import { placeTowns, keepNames, untouched } from "../core/land/places.mjs";
import { placeRealms, REALM_COUNTS } from "../core/land/realms.mjs";
import { normalize } from "../core/plan.mjs";
import { generateLand } from "../core/land/index.mjs";
import { makeKept, provideKept, missingKept, hasKept, forgetKept, keptFor } from "../core/land/kept.mjs";
import { fromDataUrl } from "../core/land/pngio.mjs";
import { landPicture } from "../core/land/debug.mjs";
import { settle } from "../core/land/settle.mjs";
import { paintLayout, styleOf } from "./painter.mjs";
import * as sketch from "./styles/sketch.mjs";
import * as region from "./styles/region.mjs";
import * as overland from "./styles/overland.mjs";

/** The last layout made here, kept so a paint of it needn't be sent it back from the page: { id, layout }. */
let kept = null, nextId = 1;

/** What the window needs to pick a realm by clicking its land: the realm ids and the layout's realm grid, or null when the map shows none. */
export const realmPick = (layout) => (layout?.realms?.list?.length && layout.showRealms !== false ? { ids: layout.realms.list.map((q) => q.id), grid: layout.realms.grid } : null);

/**
 * Readies what a job's plan needs from outside before it's laid out: a kept land's file, fetched from the URL the page
 * gave (keptUrl) and read into the store layouts use, once per file. A file that can't be fetched is noted, and the
 * land is made from its settings with a note saying so.
 */
/** A kept land's file as fetched: the PNG inside its JSON ({ png: a data URL }), or PNG bytes as they are. */
export function keptBytes(bytes) {
  if (bytes[0] !== 0x7b) return bytes; // ("{": JSON)
  try { const o = JSON.parse(new TextDecoder().decode(bytes)); return typeof o?.png === "string" ? fromDataUrl(o.png) : bytes; } catch { return bytes; }
}

export async function prepare(payload) {
  const keep = payload?.plan?.land?.keep;
  if (!keep || typeof keep !== "object" || typeof keep.path !== "string" || hasKept(keep)) return;
  if (!payload.keptUrl) return missingKept(keep, "its file couldn't be reached");
  // (a fetch that hangs gives up after 30 seconds, rather than hold the job)
  const stop = typeof AbortController === "function" ? new AbortController() : null;
  const timer = stop ? setTimeout(() => stop.abort(), 30000) : null;
  try {
    const res = await fetch(payload.keptUrl, stop ? { signal: stop.signal } : undefined);
    if (!res.ok) return missingKept(keep, `its file wasn't found at ${keep.path}`);
    provideKept(keep, keptBytes(new Uint8Array(await res.arrayBuffer())));
  } catch (e) {
    missingKept(keep, e?.name === "AbortError" ? "its file took too long to fetch" : `its file couldn't be fetched (${e.message ?? e})`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The views the window's layer switch offers (beside the map itself). */
export const LAND_VIEWS = ["shade", "uplift", "rain", "temp", "flow", "biome", "plates", "site"];

// (the last full land made for a layer view, so switching views doesn't make it again)
let viewLand = null;
// (as the layout's own key: what the land is made from, and whether its kept file was read)
const viewKey = (plan) => { const { names, keptNames, nameStyle, nameSet, towns, realms, ...landIn } = plan.land ?? {}; return JSON.stringify([landIn, plan.seed, plan.size, plan.output?.grid ?? null, plan.output?.pxPerSquare ?? null, (plan.features ?? []).filter((f) => f && (f.type === "terrain" || f.type === "water")), keptFor(plan)?.error ?? null]); };

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
    viewLand = null;
    forgetLand();
    forgetKept();
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
    return { blob, width: W, height: H, pxPerSquare: pp, squares: [MW, MH], notes: layout.notes.map((n) => n.message), labels: layout.labels, crossings: layout.items.filter((i) => i.kind === "crossing" && i.id === i.from).map((i) => ({ id: i.id, at: i.at })), pinnables: pinnables(layout), realms: realmPick(layout), landAttempt: Number.isInteger(layout.land?.attempt) ? layout.land.attempt : null, counts, ms: Math.round(performance.now() - t0) };
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

  /**
   * Towns and roads placed on an overland plan's land (land/places.mjs placeTowns), in place of the generator's own the
   * GM hasn't changed. plan: the plan as the window holds it (it comes back the same but for its features). Returns
   * { plan, added, removed, notes }.
   */
  async placeTowns({ plan, seed, density = null }, progress) {
    const layout = layoutPlan(normalize(plan), { onProgress: (p, l) => progress(0.9 * p, l) });
    progress(0.92, "Placing towns and roads");
    const { plan: out, added, removed, notes } = placeTowns(plan, layout.land, { seed, density });
    // (realms ruled from the new towns, when the plan asks for them or still has some the generator made)
    // (a plan with the generator's realms but no count, from a script, keeps some; one whose realms are all the GM's
    // gets none added)
    const count = out.land?.realms, has = out.features.some((f) => f.type === "realm" && untouched(f));
    if (["few", "some", "many"].includes(count) || has) {
      progress(0.97, "Placing realms");
      const R = placeRealms(out, layout.land, { count: REALM_COUNTS.includes(count) ? count : "some", seed });
      return { plan: R.plan, added, removed, notes: [...notes, ...R.notes], realms: R.added };
    }
    return { plan: out, added, removed, notes };
  },

  /**
   * Realms placed on an overland plan's land (land/realms.mjs placeRealms), in place of the generator's own the GM
   * hasn't changed. count: few, some or many (the plan's land.realms when left out). Returns { plan, added, removed,
   * notes }.
   */
  async placeRealms({ plan, seed, count = null }, progress) {
    const layout = layoutPlan(normalize(plan), { onProgress: (p, l) => progress(0.9 * p, l) });
    progress(0.95, "Placing realms");
    // (left out: the plan's own count, or some when it has none; the count used is written into the plan, so Reroll
    // Places keeps as many)
    const own = plan.land?.realms, n = REALM_COUNTS.includes(count) ? count : ["few", "some", "many"].includes(own) ? own : "some";
    const res = placeRealms(plan, layout.land, { count: n, seed });
    return { ...res, plan: { ...res.plan, land: { ...res.plan.land, realms: n } } };
  },

  /** The names an overland plan's map makes, kept in the plan (land/places.mjs keepNames). Returns { plan, places, features }. */
  async keepNames({ plan }, progress) {
    const layout = layoutPlan(normalize(plan), { onProgress: (p, l) => progress(0.95 * p, l) });
    return keepNames(plan, layout);
  },

  /**
   * A layer view of an overland plan's land (the window's view switch): view one of LAND_VIEWS, px the picture's width.
   * Rivers are drawn over every view but flow and plates, the ranges' spines over uplift. Returns { blob (PNG), width,
   * height }.
   */
  async landView({ plan, view = "shade", px = 1200 }, progress) {
    if (!LAND_VIEWS.includes(view)) throw new Error(`there's no layer view "${view}"`);
    const p = normalize(plan);
    if (p.kind !== "region" || !p.land) throw new Error("layer views are of an overland map's land");
    const key = viewKey(p);
    if (viewLand?.key !== key) viewLand = { key, L: generateLand(p, { onProgress: (q, l) => progress(0.85 * q, l) }), site: null };
    const L = viewLand.L;
    if (view === "site" && !viewLand.site) {
      progress(0.9, "Site scores");
      const lay = layoutPlan(p);
      viewLand.site = settle(lay.land, p, { density: p.land.towns ?? "some", seed: p.seed, scores: true }).scores ?? null;
    }
    progress(0.95, "Drawing the view");
    const width = Math.max(64, Math.min(4096, Math.round(px)));
    const pic = landPicture(L, view, width, false, { site: viewLand.site });
    const c = new OffscreenCanvas(pic.width, pic.height), g = c.getContext("2d");
    g.putImageData(new ImageData(pic.rgba, pic.width, pic.height), 0, 0);
    g.lineCap = "round"; g.lineJoin = "round";
    if (view !== "flow" && view !== "plates") {
      g.strokeStyle = "rgba(40, 90, 160, 0.9)";
      for (const R of pic.rivers) { g.lineWidth = Math.max(0.8, R[R.length - 1][2] * (width / 1200)); g.beginPath(); R.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); }
    }
    if (view === "uplift") {
      g.strokeStyle = "rgba(60, 20, 20, 0.8)"; g.lineWidth = Math.max(1, 2 * (width / 1200));
      for (const S of pic.spines) { g.beginPath(); S.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); }
    }
    return { blob: await c.convertToBlob({ type: "image/png" }), width: pic.width, height: pic.height };
  },

  /**
   * A land kept (Keep This Land): the plan's land made from its settings, its heights as a 16-bit PNG with the
   * generator's own node block (core/land/kept.mjs). Returns { bytes (Uint8Array, the PNG), keep } for the page to
   * save beside the maps and write into the plan with its path.
   */
  async keepLand({ plan }, progress) {
    const p = normalize(plan);
    if (p.land?.keep) throw new Error("this land is already kept");
    const L = generateLand(p, { kept: null, onProgress: (q, l) => progress(0.9 * q, l) });
    progress(0.95, "Saving its heights");
    return makeKept(L);
  },
};
