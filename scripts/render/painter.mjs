/**
 * Paints a Layout into one image, in the worker. Big maps are painted in tiles, each with a margin wide enough for
 * the style's widest blur, and stitched; patterns are anchored to the map, so the joins don't show.
 */
import * as textured from "./styles/textured.mjs";

export const STYLES = { textured };

/** The style module for a layout (textured until the others exist). */
export function styleOf(layout) {
  return STYLES[layout.style] ?? STYLES.textured;
}

/**
 * art: { role: [url, ...] } (variants). Returns { blob, width, height, ms, tiles }.
 * progress(pct, label) runs from 0 to 1 across loading, painting and encoding.
 */
export async function paintLayout({ layout, art = {}, tileSize = 2560, quality = 0.86 }, progress = () => {}) {
  const t0 = performance.now();
  const style = styleOf(layout);
  const pp = layout.pxPerSquare;
  const [MW, MH] = layout.size.squares;
  const W = Math.round(MW * pp), H = Math.round(MH * pp);

  // Load every image once
  progress(0.01, "Loading art");
  const urls = Object.entries(art);
  const bitmaps = {};
  let done = 0;
  const total = urls.reduce((n, [, list]) => n + list.length, 0) || 1;
  await Promise.all(urls.map(async ([role, list]) => {
    bitmaps[role] = (await Promise.all(list.map(async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await createImageBitmap(await res.blob());
      } catch {
        return null;
      } finally {
        progress(0.01 + 0.09 * (++done / total), "Loading art");
      }
    }))).filter(Boolean);
  }));
  const getArt = (role, variant = 0) => {
    const list = bitmaps[role];
    return list?.length ? list[Math.abs(variant | 0) % list.length] : null;
  };

  // Tiles: one when the map is small, else a grid with a margin for the blur
  const single = W <= 4096 && H <= 4096;
  const margin = single ? 0 : Math.ceil(3 * (style.MAX_BLUR ?? 4) * pp);
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
      const mask = new OffscreenCanvas(tw, th);
      style.paint({
        g: tile.getContext("2d"), mask, W: tw, H: th, pp,
        x0: (cx0 - margin) / pp, y0: (cy0 - margin) / pp,
        layout, art: getArt,
        progress: (p, label) => progress(0.1 + (0.8 * (i + p)) / n, n > 1 ? `${label} (part ${i + 1} of ${n})` : label),
      });
      og.drawImage(tile, margin, margin, cw, ch, cx0, cy0, cw, ch);
      mask.width = mask.height = 1;
      tile.width = tile.height = 1;
    }
  }

  progress(0.92, "Saving the image");
  const blob = await out.convertToBlob({ type: "image/webp", quality });
  return { blob, width: W, height: H, tiles: n, ms: Math.round(performance.now() - t0) };
}
