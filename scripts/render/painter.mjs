/**
 * Paints a Layout into one image, in the worker. Big maps are painted in tiles, each with a margin wide enough for
 * the style's widest blur, and stitched; patterns are anchored to the map, so the joins don't show.
 */
import * as textured from "./styles/textured.mjs";
import * as illustrated from "./styles/illustrated.mjs";
import * as battle from "./styles/battle.mjs";

export const STYLES = { illustrated, textured };

/**
 * The style module for a layout: a battle map's own, whatever style its plan names (a settlement's styles are drawn
 * for its scale); else its style (illustrated when its style is one this version doesn't know).
 */
export function styleOf(layout) {
  if (layout.kind === "battle") return battle;
  return STYLES[layout.style] ?? STYLES.illustrated;
}

/**
 * art: { role: [url, ...] } (variants). Returns { blob, thumb, width, height, ms, tiles, failedArt, brokenArt, overheads }:
 * thumb is a 300 px WebP for the scene list, failedArt the roles whose files wouldn't load (painted in plain colors),
 * brokenArt the roles any file failed for (painted with fewer variants, or plain), overheads the pieces a style paints
 * apart to lie over the map as tiles (a battle map's roofs and tree crowns): [{ name, kind, x, y, width, height (px,
 * from the map's corner), elevation, blob }], empty for a style without them.
 * progress(pct, label) runs from 0 to 1 across loading, painting and encoding.
 */
export async function paintLayout({ layout, art = {}, tileSize = 2560, quality = 0.86 }, progress = () => {}) {
  const t0 = performance.now();
  const style = styleOf(layout);
  const pp = layout.pxPerSquare;
  const [MW, MH] = layout.size.squares;
  const W = Math.round(MW * pp), H = Math.round(MH * pp);

  // Load every image once (a file used by two roles is fetched once); roles whose files all fail are reported
  progress(0.01, "Loading art");
  const urls = Object.entries(art);
  const unique = [...new Set(urls.flatMap(([, list]) => list))];
  const loaded = new Map();
  let done = 0;
  await Promise.all(unique.map(async (url) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      loaded.set(url, await createImageBitmap(await res.blob()));
    } catch {
      loaded.set(url, null);
    } finally {
      progress(0.01 + 0.09 * (++done / (unique.length || 1)), "Loading art");
    }
  }));
  const bitmaps = {};
  const failedArt = [], brokenArt = [];
  for (const [role, list] of urls) {
    bitmaps[role] = list.map((u) => loaded.get(u)).filter(Boolean);
    if (list.length && !bitmaps[role].length) failedArt.push(role);
    if (bitmaps[role].length < list.length) brokenArt.push(role);
  }
  const getArt = (role, variant = 0) => {
    const list = bitmaps[role];
    return list?.length ? list[Math.abs(variant | 0) % list.length] : null;
  };

  // Tiles: one when the map and its margin fit in 4096 px, else a grid. Every tile has a margin for the blur, a single
  // one too, so soft edges don't fade toward the map's border. The margin is capped, so a map at hundreds of pixels a
  // square doesn't need tiles of many thousand pixels for the widest blur (the ground's soft patches) alone
  const margin = Math.min(1024, Math.ceil(3 * (style.MAX_BLUR ?? 4) * pp));
  const single = W + 2 * margin <= 4096 && H + 2 * margin <= 4096;
  const cols = single ? 1 : Math.ceil(W / tileSize), rows = single ? 1 : Math.ceil(H / tileSize);
  const coreW = single ? W : tileSize, coreH = single ? H : tileSize;
  const out = new OffscreenCanvas(W, H);
  const og = out.getContext("2d");
  const n = cols * rows;
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const i = ty * cols + tx;
      const cx0 = tx * coreW, cy0 = ty * coreH;
      const cw = Math.min(coreW, W - cx0), ch = Math.min(coreH, H - cy0);
      const tw = cw + 2 * margin, th = ch + 2 * margin;
      const tile = new OffscreenCanvas(tw, th);
      const mask = new OffscreenCanvas(tw, th), blur = new OffscreenCanvas(tw, th);
      style.paint({
        g: tile.getContext("2d"), mask, blur, W: tw, H: th, pp,
        x0: (cx0 - margin) / pp, y0: (cy0 - margin) / pp,
        layout, art: getArt,
        progress: (p, label) => progress(0.1 + (0.8 * (i + p)) / n, n > 1 ? `${label} (part ${i + 1} of ${n})` : label),
      });
      og.drawImage(tile, margin, margin, cw, ch, cx0, cy0, cw, ch);
      mask.width = mask.height = 1;
      blur.width = blur.height = 1;
      tile.width = tile.height = 1;
    }
  }

  progress(0.9, "Saving the image");
  const blob = await out.convertToBlob({ type: "image/webp", quality });
  progress(0.94, "Making the thumbnail");
  const th = thumbCanvas(out, THUMB);
  out.width = out.height = 1;

  // Overhead pieces: each painted on a canvas of its own, as big as its box, laid onto the thumbnail, saved and let go
  // before the next, so only one is held at a time
  const pieces = style.overheads?.(layout) ?? [];
  const overheads = [];
  for (const [k, piece] of pieces.entries()) {
    progress(0.95 + (0.04 * k) / pieces.length, "Roofs and trees");
    const [bx0, by0, bx1, by1] = piece.box;
    const x = Math.floor(bx0 * pp), y = Math.floor(by0 * pp);
    const w = Math.max(1, Math.min(W, Math.ceil(bx1 * pp)) - x), h = Math.max(1, Math.min(H, Math.ceil(by1 * pp)) - y);
    const c = new OffscreenCanvas(w, h);
    style.paintOverhead({ g: c.getContext("2d"), W: w, H: h, pp, layout, art: getArt }, { ...piece, box: [x / pp, y / pp, bx1, by1] });
    th.g.drawImage(c, th.ox + x * th.k, th.oy + y * th.k, w * th.k, h * th.k);
    overheads.push({ name: piece.name, kind: piece.kind, x, y, width: w, height: h, elevation: piece.elevation, blob: await c.convertToBlob({ type: "image/webp", quality: Math.max(quality, 0.9) }) });
    c.width = c.height = 1;
  }
  for (const bmp of loaded.values()) bmp?.close();
  const thumb = await th.canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
  return { blob, thumb, width: W, height: H, tiles: n, failedArt, brokenArt, overheads, ms: Math.round(performance.now() - t0) };
}

/** Thumbnail size, as Foundry makes them. */
const THUMB = 300;

/**
 * The scene list's thumbnail: a size by size canvas of the map's middle, scaled to cover (as Foundry's own scene
 * thumbnails are). Returns { canvas, g, k, ox, oy }: k and ox, oy place map pixels on it, for laying overhead pieces on.
 */
function thumbCanvas(src, size) {
  const k = Math.max(size / src.width, size / src.height);
  const w = src.width * k, h = src.height * k;
  const canvas = new OffscreenCanvas(size, size);
  const g = canvas.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(src, (size - w) / 2, (size - h) / 2, w, h);
  return { canvas, g, k, ox: (size - w) / 2, oy: (size - h) / 2 };
}
