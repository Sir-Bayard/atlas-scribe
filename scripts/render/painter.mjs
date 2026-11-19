/**
 * Paints a Layout into one image, in the worker. Big maps are painted in tiles, each with a margin wide enough for
 * the style's widest blur, and stitched; patterns are anchored to the map, so the joins don't show.
 */
import * as textured from "./styles/textured.mjs";
import * as illustrated from "./styles/illustrated.mjs";
import * as battle from "./styles/battle.mjs";
import * as region from "./styles/region.mjs";
import * as overland from "./styles/overland.mjs";
import { artPlacement } from "../core/layout/rooms.mjs";
import { drawnSet } from "./drawn-art.mjs";

/** The art scale every style paints at (Forgotten Adventures' 200 px a square); art at another is resized to it. */
const ART_PX = 200;

export const STYLES = { illustrated, textured, ink: illustrated }; // (ink: the illustrated style in black and white)

/**
 * The style module for a layout: a battle map's own, whatever style its plan names (a settlement's styles are drawn
 * for its scale); else its style (illustrated when its style is one this version doesn't know).
 */
export function styleOf(layout) {
  if (layout.kind === "battle") return battle;
  if (layout.kind === "region") return layout.overland ? overland : region;
  return STYLES[layout.style] ?? STYLES.illustrated;
}

/**
 * art: { role: [url, ...] } (variants); scale: { url: factor } resizes art not drawn at 200 px a square. Returns { blob, thumb, width, height, ms, tiles, failedArt, brokenArt,
 * overheads, furniture, mist, levels }: thumb a 300 px WebP; failedArt the roles whose files all failed (painted
 * plain); brokenArt the roles any file failed for, brokenUrls those files; overheads the pieces painted apart to lie over the map as tiles
 * ([{ name, kind, x, y, width, height (px from the map's corner), elevation, blob }]); furniture [{ src, f, x, y
 * (middle), width, height, rotation, floor, lock }, and with drawn.movable a battle map's movable props: { src, f (its class),
 * prop: true, animal (a horse, mule or ox, made a token), x, y (its middle), width, height, rotation, elevation }]; mist the fog tiles; levels a battle map's other floors ([{
 * floor, blob }]); drawnFiles the drawn images its furniture and mist tiles use ([{ name, blob }], their src
 * "drawn:<name>" until saved). progress(pct, label) runs from 0 to 1. drawn: { look, all, movable } for a battle map: roles with
 * no art drawn in that look ("painted" or "inked"), or with all every role drawn; with movable, its movable props as
 * tiles (in furniture) instead of painted.
 */
export async function paintLayout(input, progress = () => {}) {
  // (the drawn images this paint makes, its own, let go whether painting finishes or not)
  const drawnImages = drawnSet();
  try {
    return await paint(input, progress, drawnImages);
  } finally {
    drawnImages.forget();
  }
}

/** The most pixels all the art of one map may hold once loaded (four bytes each: about 1.5 GB). */
export const ART_BUDGET = 400e6;
/** The longest side an image is kept at: any art, and art painted as a repeating pattern (ground, roofs, water...). */
export const ART_SIDE = { any: 8192, pattern: 4096 };
const PATTERN = /^(ground|surface|roof|field|water|floor|stone|shore|dock|overlay|wall|wood|edge|strip|cliff)\./;

/**
 * An image's size from the first bytes of its file (PNG, JPEG, WebP), so a huge one can be decoded straight to the
 * size it's kept at instead of whole. Null for a file it can't read.
 */
export function imageSize(b) {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  const at = (i) => u[i] ?? 0;
  const be16 = (i) => (at(i) << 8) | at(i + 1), be32 = (i) => ((at(i) << 24) >>> 0) + (at(i + 1) << 16) + (at(i + 2) << 8) + at(i + 3);
  const le16 = (i) => at(i) | (at(i + 1) << 8), le24 = (i) => at(i) | (at(i + 1) << 8) | (at(i + 2) << 16);
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return { w: be32(16), h: be32(20) };
  if (at(0) === 0xff && at(1) === 0xd8) {
    for (let i = 2; i + 9 < u.length;) {
      if (at(i) !== 0xff) { i++; continue; }
      const m = at(i + 1);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: be16(i + 7), h: be16(i + 5) };
      i += 2 + be16(i + 2);
    }
    return null;
  }
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45) {
    const kind = String.fromCharCode(at(12), at(13), at(14), at(15));
    if (kind === "VP8X") return { w: le24(24) + 1, h: le24(27) + 1 };
    if (kind === "VP8 ") return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff };
    if (kind === "VP8L") { const b0 = at(21), b1 = at(22), b2 = at(23), b3 = at(24); return { w: 1 + (((b1 & 0x3f) << 8) | b0), h: 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) }; }
  }
  return null;
}

/** Whether a JPEG's first bytes hold an Exif block (APP1, "Exif"). */
function hasExif(u) {
  for (let i = 2; i + 10 < u.length && u[i] === 0xff;) {
    const m = u[i + 1], len = (u[i + 2] << 8) | u[i + 3];
    if (m === 0xe1 && u[i + 4] === 0x45 && u[i + 5] === 0x78 && u[i + 6] === 0x69 && u[i + 7] === 0x66) return true;
    if (m === 0xda) return false;
    i += 2 + len;
  }
  return false;
}

/**
 * A canvas for painting, or an error that says so in plain words when the browser can't give one that big (it
 * returns no context, or throws, past its own limit or out of memory).
 */
export function canvasOf(w, h, what) {
  let c = null, g = null;
  try {
    c = new OffscreenCanvas(w, h);
    g = c.getContext("2d");
  } catch {
    g = null;
  }
  if (!g) {
    const mb = Math.round((w * h * 4) / 1024 ** 2);
    throw new Error(`the browser couldn't make a ${w} by ${h} pixel canvas for ${what} (about ${mb.toLocaleString()} MB). Use fewer pixels a square, or a smaller map`);
  }
  return c;
}
/** Lets a canvas's memory go. */
const free = (c) => { if (c) { c.width = 1; c.height = 1; } };

/** Pixels past which a map saved "auto" is saved as JPEG: a 24 megapixel WebP takes a browser about 8 s to save. */
export const AUTO_JPEG = 24e6;

async function paint({ layout, art = {}, scale = {}, tileSize = 2560, quality = 0.86, format = "webp", drawn = null, partSide = 0 }, progress, drawnImages) {
  // (the map as WebP, or JPEG, which a browser saves several times faster; "auto" takes JPEG past AUTO_JPEG pixels.
  // Its floors, roofs and drawn pieces keep WebP's see-through parts)
  const type = format === "jpeg" || (format === "auto" && Math.round(layout.size.squares[0] * layout.pxPerSquare) * Math.round(layout.size.squares[1] * layout.pxPerSquare) > AUTO_JPEG) ? "image/jpeg" : "image/webp";
  const t0 = performance.now();
  const style = styleOf(layout);
  const pp = layout.pxPerSquare;
  const [MW, MH] = layout.size.squares;
  const W = Math.round(MW * pp), H = Math.round(MH * pp);

  // Load every image once (a file used by two roles is fetched once); roles whose files all fail are reported
  progress(0.01, "Loading art");
  const urls = Object.entries(art);
  const unique = [...new Set(urls.flatMap(([, list]) => list))];
  // (the longest side each file is kept at: a pattern's cap when every role using it is painted as one)
  const sideOf = new Map();
  for (const [role, list] of urls) for (const u of list) sideOf.set(u, Math.min(sideOf.get(u) ?? ART_SIDE.any, PATTERN.test(role) ? ART_SIDE.pattern : ART_SIDE.any));
  const loaded = new Map();
  const overBudget = [];
  let done = 0, held = 0;
  const load = async (url) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      // (art drawn at another scale than 200 px a square is resized as it's decoded, so every style can treat it as
      // FA's; and no image is kept past its longest side, nor all the art past the budget)
      const k = scale[url] && scale[url] !== 1 ? scale[url] : 1;
      const head = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
      // (a JPEG with Exif may be turned as it's decoded, so its header's width and height can't size it)
      const dims = head[0] === 0xff && head[1] === 0xd8 && hasExif(head) ? null : imageSize(head);
      const fit = (w, h) => Math.min(k, (sideOf.get(url) ?? ART_SIDE.any) / Math.max(w, h, 1));
      let bmp;
      if (dims?.w && dims?.h) {
        const kk = fit(dims.w, dims.h);
        const w = Math.max(1, Math.round(dims.w * kk)), h = Math.max(1, Math.round(dims.h * kk));
        if (held + w * h > ART_BUDGET) { overBudget.push(url); loaded.set(url, null); return; }
        held += w * h;
        try {
          bmp = await createImageBitmap(blob, kk === 1 ? {} : { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
        } catch (e) {
          held -= w * h; // (a file that won't decode takes nothing from the budget)
          throw e;
        }
      } else {
        const whole = await createImageBitmap(blob);
        const kk = fit(whole.width, whole.height);
        bmp = kk === 1 ? whole : await createImageBitmap(whole, { resizeWidth: Math.max(1, Math.round(whole.width * kk)), resizeHeight: Math.max(1, Math.round(whole.height * kk)), resizeQuality: "high" });
        if (bmp !== whole) whole.close();
        if (held + bmp.width * bmp.height > ART_BUDGET) { bmp.close(); overBudget.push(url); loaded.set(url, null); return; }
        held += bmp.width * bmp.height;
      }
      loaded.set(url, bmp);
    } catch {
      loaded.set(url, null);
    } finally {
      progress(0.01 + 0.09 * (++done / (unique.length || 1)), "Loading art");
    }
  };
  // (a few at a time, so a role with many variants doesn't fetch and decode them all at once)
  for (let i = 0; i < unique.length; i += 8) await Promise.all(unique.slice(i, i + 8).map(load));
  // (from here every image and canvas is let go whether the paint finishes or fails)
  const canvases = new Set();
  const make = (w, h, what) => { const c = canvasOf(w, h, what); canvases.add(c); return c; };
  try {
    const bitmaps = {}, urlsOf = new Map(urls);
    const failedArt = [], brokenArt = [];
    const skip = new Set(overBudget);
    const brokenUrls = unique.filter((u) => !loaded.get(u) && !skip.has(u));
    for (const [role, list] of urls) {
      bitmaps[role] = list.map((u) => loaded.get(u)).filter(Boolean);
      if (list.length && !bitmaps[role].length) failedArt.push(role);
      if (bitmaps[role].length < list.length) brokenArt.push(role);
    }
    // (a variant picks from all of a role's files, so one that failed to load changes only the pieces that wanted it,
    // which take the role's first that loaded, not which file every other piece gets)
    const pickOf = (all, ok, variant) => (all?.length ? (ok(all[Math.abs(variant | 0) % all.length]) ? all[Math.abs(variant | 0) % all.length] : all.find(ok)) ?? null : null);
    const fileArt = (role, variant = 0) => {
      const u = pickOf(urlsOf.get(role), (x) => !!loaded.get(x), variant);
      return u ? loaded.get(u) : null;
    };
    // (a battle map draws what has no art: drawn-art.mjs; a settlement's styles paint it plain)
    const look = layout.kind === "battle" && drawn ? (drawn.look === "inked" ? "inked" : "painted") : null;
    // (with the Movable props setting, a battle map's carts, wagons, barrels and tents are tiles and its animals tokens,
    // not painted)
    const movable = layout.kind === "battle" && !!drawn?.movable && !!style.movables;
    const drawnOf = (role, variant) => (look ? drawnImages.art(role, variant, { look }) : null);
    const getArt = (role, variant = 0) => (look && drawn.all ? null : fileArt(role, variant)) ?? drawnOf(role, variant);
    // (the drawn images tiles use, saved as files beside the map: one each, named by role, look and variant)
    const drawnFiles = new Map();
    const drawnSrc = async (role, variant) => {
      const im = drawnOf(role, variant);
      if (!im) return null;
      const name = `${role}-${look}-${((variant % 3) + 3) % 3}.webp`;
      if (!drawnFiles.has(name)) drawnFiles.set(name, { im, blob: await im.convertToBlob({ type: "image/webp", quality: 0.92 }) });
      return { src: `drawn:${name}`, im };
    };

    // Tiles: one when the map and its margin fit in 4096 px, else a grid. Every tile has a margin for the blur (one
    // tile too, so soft edges don't fade at the map's border), capped so a fine map doesn't need huge tiles
    const margin = Math.min(1024, Math.ceil(3 * (style.MAX_BLUR ?? 4) * pp));
    const single = W + 2 * margin <= 4096 && H + 2 * margin <= 4096;
    const cols = single ? 1 : Math.ceil(W / tileSize), rows = single ? 1 : Math.ceil(H / tileSize);
    const coreW = single ? W : tileSize, coreH = single ? H : tileSize;
    // (the ground, or with floor a floor above or below it: a battle map's other levels, each an image of its own, clear
    // where nothing of that floor is)
    // (a style that saves layers apart, as an overland map's places: the ground painted without them)
    const layerList = style.layers?.(layout) ?? [];
    const paintAll = (floor, p0, p1, layer = layerList.length ? "ground" : undefined) => {
      const out = make(W, H, floor ? "a floor of the map" : "the map");
      const og = out.getContext("2d");
      const n = cols * rows;
      for (let ty = 0; ty < rows; ty++) {
        for (let tx = 0; tx < cols; tx++) {
          const i = ty * cols + tx;
          const cx0 = tx * coreW, cy0 = ty * coreH;
          const cw = Math.min(coreW, W - cx0), ch = Math.min(coreH, H - cy0);
          const tw = cw + 2 * margin, th = ch + 2 * margin;
          const tile = make(tw, th, "a part of the map"), mask = make(tw, th, "a part of the map"), blur = make(tw, th, "a part of the map");
          try {
            style.paint({
              g: tile.getContext("2d"), mask, blur, W: tw, H: th, pp, floor, movable, layer,
              x0: (cx0 - margin) / pp, y0: (cy0 - margin) / pp,
              layout, art: getArt,
              progress: (p, label) => progress(p0 + ((p1 - p0) * (i + p)) / n, n > 1 ? `${label} (part ${i + 1} of ${n})` : label),
            });
            og.drawImage(tile, margin, margin, cw, ch, cx0, cy0, cw, ch);
          } finally {
            for (const c of [mask, blur, tile]) { free(c); canvases.delete(c); }
          }
        }
      }
      return out;
    };
    const floors = style.floorsOf?.(layout) ?? [];
    const n = cols * rows;
    const out = paintAll(0, 0.1, floors.length ? 0.6 : 0.9);
    // (the ground saved, its thumbnail made and let go before any other floor is painted: one map-sized canvas at a
    // time)
    progress(floors.length ? 0.6 : 0.9, "Saving the image");
    const blob = await out.convertToBlob({ type, quality });
    // (and in parts no more than partSide px a side, when the map is bigger: some graphics cards can't show it whole)
    const parts = [];
    if (partSide > 0 && Math.max(W, H) > partSide) {
      const nx = Math.ceil(W / partSide), ny = Math.ceil(H / partSide), pw = Math.ceil(W / nx), ph = Math.ceil(H / ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const x = i * pw, y = j * ph, w = Math.min(pw, W - x), h = Math.min(ph, H - y);
        const c = new OffscreenCanvas(w, h);
        canvases.add(c);
        c.getContext("2d").drawImage(out, x, y, w, h, 0, 0, w, h);
        parts.push({ x, y, width: w, height: h, blob: await c.convertToBlob({ type, quality }) });
        free(c); canvases.delete(c);
      }
    }
    progress(floors.length ? 0.62 : 0.94, "Making the thumbnail");
    const th = thumbCanvas(out, THUMB);
    free(out);
    // (each other floor saved as soon as it's painted, and let go)
    const levels = [];
    for (const [k, floor] of floors.entries()) {
      const c = paintAll(floor, 0.62 + (0.3 * k) / floors.length, 0.62 + (0.3 * (k + 1)) / floors.length);
      levels.push({ floor, blob: await c.convertToBlob({ type: "image/webp", quality }) });
      free(c);
    }

    // Layers (an overland map's places and roads): each a see-through image as big as the map (in parts, as the ground
    // is, past the largest image), laid on the thumbnail when the plan shows it, saved and let go
    const overlays = [];
    for (const [k, { name, shown }] of layerList.entries()) {
      const p0 = 0.945 + (0.005 * k) / layerList.length;
      const c = paintAll(0, p0, p0 + 0.005 / layerList.length, name);
      if (shown) th.g.drawImage(c, th.ox, th.oy, W * th.k, H * th.k);
      const pieces = [];
      if (partSide > 0 && Math.max(W, H) > partSide) {
        const nx = Math.ceil(W / partSide), ny = Math.ceil(H / partSide), pw = Math.ceil(W / nx), ph = Math.ceil(H / ny);
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pieces.push([i * pw, j * ph, Math.min(pw, W - i * pw), Math.min(ph, H - j * ph)]);
      } else pieces.push([0, 0, W, H]);
      for (const [q, [x, y, w, h]] of pieces.entries()) {
        let piece = c;
        if (pieces.length > 1) { piece = new OffscreenCanvas(w, h); canvases.add(piece); piece.getContext("2d").drawImage(c, x, y, w, h, 0, 0, w, h); }
        overlays.push({ name: pieces.length > 1 ? `${name}-${q + 1}` : name, kind: name, x, y, width: w, height: h, blob: await piece.convertToBlob({ type: "image/webp", quality: Math.max(quality, 0.9) }) });
        if (piece !== c) { free(piece); canvases.delete(piece); }
      }
      free(c);
    }
    // Overhead pieces: each painted on a canvas of its own, as big as its box, laid onto the thumbnail, saved and let go
    // before the next, so only one is held at a time
    const pieces = style.overheads?.(layout) ?? [];
    const overheads = [];
    for (const [k, piece] of pieces.entries()) {
      progress(0.95 + (0.04 * k) / pieces.length, "Roofs and trees");
      const [bx0, by0, bx1, by1] = piece.box;
      const x = Math.floor(bx0 * pp), y = Math.floor(by0 * pp);
      const w = Math.max(1, Math.min(W, Math.ceil(bx1 * pp)) - x), h = Math.max(1, Math.min(H, Math.ceil(by1 * pp)) - y);
      const c = make(w, h, "a roof or tree crown");
      style.paintOverhead({ g: c.getContext("2d"), W: w, H: h, pp, layout, art: getArt }, { ...piece, box: [x / pp, y / pp, bx1, by1] });
      th.g.drawImage(c, th.ox + x * th.k, th.oy + y * th.k, w * th.k, h * th.k);
      overheads.push({ name: piece.name, kind: piece.kind, x, y, width: w, height: h, elevation: piece.elevation, blob: await c.convertToBlob({ type: "image/webp", quality: Math.max(quality, 0.9) }) });
      free(c);
    }
    // Furniture (a battle map's): each piece a tile, its art placed by the part of its file that's drawn
    const furniture = [];
    for (const { role, variant, piece } of style.furniture?.(layout) ?? []) {
      const url = look && drawn.all ? null : pickOf(urlsOf.get(role), (x) => !!loaded.get(x), variant);
      const d = url ? null : await drawnSrc(role, variant);
      if (!url && !d) continue;
      const bmp = url ? loaded.get(url) : d.im;
      // (its own size in squares: the art is resized to 200 px a square when it's loaded)
      const at = artPlacement(piece, insetsOf(bmp), bmp ? [bmp.width / ART_PX, bmp.height / ART_PX] : null);
      furniture.push({ src: url ?? d.src, f: piece.f, x: at.x * pp, y: at.y * pp, width: at.w * pp, height: at.h * pp, rotation: at.rot, ...(piece.floor ? { floor: piece.floor } : {}), ...(piece.lock ? { lock: true } : {}) });
    }
    // Movable props (a battle map's, with the setting): each a tile at its art's whole size, turned as it would be
    // painted, at the height of the ground it stands on; sent with the furniture, which they're replaced with
    if (movable) for (const { role, variant, piece, elevation } of style.movables(layout)) {
      const url = look && drawn.all ? null : pickOf(urlsOf.get(role), (x) => !!loaded.get(x), variant);
      const d = url ? null : await drawnSrc(role, variant);
      if (!url && !d) continue;
      const bmp = url ? loaded.get(url) : d.im;
      if (!bmp) continue;
      const [w, h] = style.propSize(piece, bmp);
      furniture.push({ src: url ?? d.src, f: piece.class, prop: true, ...(style.ANIMAL_PROPS?.has(piece.class) ? { animal: true, id: piece.id } : {}), x: piece.x * pp, y: piece.y * pp, width: w * pp, height: h * pp, rotation: piece.rot ?? 0, elevation: Number.isFinite(elevation) ? elevation : 0 });
    }
    // Mist (a battle map's): each overlay a tile over the low place it lies in
    const mist = [];
    for (const m of style.mist?.(layout) ?? []) {
      const url = look && drawn.all ? null : pickOf(urlsOf.get(m.role), (x) => !!loaded.get(x), m.variant);
      const d = url ? null : await drawnSrc(m.role, m.variant);
      if (!url && !d) continue;
      mist.push({ src: url ?? d.src, x: m.x * pp, y: m.y * pp, width: m.size * pp, height: m.size * pp, rotation: m.rot, alpha: m.alpha });
    }
    const thumb = await th.canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
    return { blob, parts, thumb, width: W, height: H, tiles: n, failedArt, brokenArt, brokenUrls, overBudget, overheads, overlays, furniture, mist, levels, drawnFiles: [...drawnFiles].map(([name, { blob: b }]) => ({ name, blob: b })), ms: Math.round(performance.now() - t0) };
  } finally {
    for (const bmp of loaded.values()) bmp?.close();
    for (const c of canvases) free(c);
  }
}

/**
 * The part of a piece's art that's drawn: how far in from each edge it starts, [left, top, right, bottom] as shares of
 * the image's width and height, where its alpha passes a sixth. Measured once for each image.
 */
const INSETS = new WeakMap();
function insetsOf(bmp) {
  if (!bmp) return [0, 0, 0, 0];
  if (INSETS.has(bmp)) return INSETS.get(bmp);
  let out = [0, 0, 0, 0];
  try {
    const w = bmp.width, h = bmp.height, c = new OffscreenCanvas(w, h), k = c.getContext("2d");
    k.drawImage(bmp, 0, 0);
    const d = k.getImageData(0, 0, w, h).data;
    let l = w, t = h, r = -1, b = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 40) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; }
    if (r >= 0) out = [l / w, t / h, (w - 1 - r) / w, (h - 1 - b) / h];
  } catch { /* (an image the canvas can't read: placed by its whole art) */ }
  INSETS.set(bmp, out);
  return out;
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
