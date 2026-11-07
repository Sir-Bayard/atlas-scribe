/**
 * The AtlasScribe worker. Heavy work (laying out a plan, painting a map) runs here, off Foundry's page, so the
 * client never freezes. It knows nothing of Foundry: it gets plain data and image URLs, and sends back plain
 * data and images.
 *
 * Messages in:  { id, type, payload }
 * Messages out: { id, progress: { pct, label } } while working, then { id, result } or { id, error }.
 */
import { rng } from "../core/rng.mjs";
import { layoutPlan } from "../core/layout/index.mjs";
import { pinnables } from "../core/pin.mjs";
import { zoomPlan } from "../core/zoom.mjs";
import { paintLayout, styleOf } from "./painter.mjs";
import * as sketch from "./styles/sketch.mjs";

const jobs = {
  /** Plan to Layout. Returns { layout, roles }: roles are the art roles the layout's style needs. */
  async layout({ plan }, progress) {
    const layout = layoutPlan(plan, { onProgress: (p, l) => progress(p, l) });
    return { layout, roles: styleOf(layout).rolesFor(layout) };
  },

  /** Layout to image. art: { role: [url, ...] }. Returns { blob, thumb, width, height, tiles, failedArt, brokenArt, ms }. */
  async paint({ layout, art, tileSize, quality }, progress) {
    return paintLayout({ layout, art, tileSize, quality }, progress);
  },

  /**
   * A quick look at a plan: laid out, then painted in plain colors (the sketch style, no art) with the longer side
   * about px pixels. Returns { blob, width, height, pxPerSquare, squares, notes, counts, ms }.
   */
  async preview({ plan, px = 1600 }, progress) {
    const t0 = performance.now();
    const layout = layoutPlan(plan, { onProgress: (p, l) => progress(0.7 * p, l) });
    const [MW, MH] = layout.size.squares;
    const pp = Math.max(4, Math.min(layout.pxPerSquare, px / Math.max(MW, MH)));
    const W = Math.max(1, Math.round(MW * pp)), H = Math.max(1, Math.round(MH * pp));
    const c = new OffscreenCanvas(W, H);
    sketch.paint({ g: c.getContext("2d"), mask: null, W, H, x0: 0, y0: 0, pp, layout, art: () => null, progress: (p, l) => progress(0.7 + 0.25 * p, l) });
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

  /** A test pattern: proves the worker, image loading, soft masks, progress and WebP output. */
  async test({ width = 2048, height = 2048, texture = null, seed = 1 }, progress) {
    const t0 = performance.now();
    const r = rng(seed, "test");
    const c = new OffscreenCanvas(width, height);
    const g = c.getContext("2d");
    progress(0.05, "Ground");
    g.fillStyle = "#d8dde3";
    g.fillRect(0, 0, width, height);
    if (texture) {
      const bmp = await loadBitmap(texture);
      const p = g.createPattern(bmp, "repeat");
      p.setTransform(new DOMMatrix().scale(0.5));
      g.fillStyle = p;
      g.fillRect(0, 0, width, height);
      bmp.close();
    }
    progress(0.25, "Soft patches");
    softFill(g, width, height, (k) => {
      for (let i = 0; i < 120; i++) {
        k.beginPath();
        k.arc(r.next() * width, r.next() * height, 20 + r.next() * 120, 0, Math.PI * 2);
        k.fill();
      }
    }, "rgb(40,60,90)", 18, 0.35);
    progress(0.5, "Grid");
    g.strokeStyle = "rgba(20,30,40,0.35)";
    g.lineWidth = 2;
    for (let x = 0; x <= width; x += 100) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, height); g.stroke(); }
    for (let y = 0; y <= height; y += 100) { g.beginPath(); g.moveTo(0, y); g.lineTo(width, y); g.stroke(); }
    progress(0.7, "Blocks");
    for (let i = 0; i < 400; i++) {
      g.save();
      g.translate(r.next() * width, r.next() * height);
      g.rotate(r.range(-0.2, 0.2));
      g.fillStyle = `hsl(${r.int(40) + 10} 35% ${r.int(20) + 35}%)`;
      g.fillRect(-30, -18, 60, 36);
      g.strokeStyle = "rgba(20,20,28,0.8)";
      g.strokeRect(-30, -18, 60, 36);
      g.restore();
    }
    g.fillStyle = "rgba(20,30,40,0.9)";
    g.font = `bold ${Math.round(width / 20)}px sans-serif`;
    g.textAlign = "center";
    g.fillText("AtlasScribe test", width / 2, height / 2);
    progress(0.9, "Encoding");
    const blob = await c.convertToBlob({ type: "image/webp", quality: 0.86 });
    return { blob, width, height, ms: Math.round(performance.now() - t0) };
  },
};

/** Fetch an image by URL (same origin as Foundry) and decode it, off the page. */
async function loadBitmap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`couldn't load ${url} (HTTP ${res.status})`);
  return createImageBitmap(await res.blob());
}

/**
 * The soft-edge technique from the prototype: draw shapes blurred into a mask, fill the mask with a color or
 * pattern (source-in), and lay it down. Blurring the mask, never the texture, keeps the texture sharp.
 */
function softFill(g, width, height, shape, fill, blurPx, alpha = 1, op = "source-over") {
  const m = new OffscreenCanvas(width, height);
  const q = m.getContext("2d");
  q.filter = blurPx ? `blur(${blurPx}px)` : "none";
  q.fillStyle = "#000";
  q.strokeStyle = "#000";
  shape(q);
  q.filter = "none";
  q.globalCompositeOperation = "source-in";
  q.fillStyle = fill;
  q.fillRect(0, 0, width, height);
  g.save();
  g.globalAlpha = alpha;
  g.globalCompositeOperation = op;
  g.drawImage(m, 0, 0);
  g.restore();
}

// A message that can't be read (it failed to clone) would otherwise leave its job waiting for ever
self.onmessageerror = () => self.postMessage({ id: null, error: { message: "a message to the worker couldn't be read" } });

self.onmessage = async (event) => {
  const { id, type, payload } = event.data ?? {};
  const job = jobs[type];
  if (!job) return self.postMessage({ id, error: { message: `unknown job "${type}"` } });
  const progress = (pct, label) => self.postMessage({ id, progress: { pct, label } });
  try {
    const result = await job(payload ?? {}, progress);
    self.postMessage({ id, result }); // a Blob crosses by reference, so nothing needs transferring
  } catch (e) {
    self.postMessage({ id, error: { message: e?.message ?? String(e), stack: e?.stack ?? null } });
  }
};
