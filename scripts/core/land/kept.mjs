/**
 * Kept land (Keep This Land): a finished land's heights saved as a 16-bit gray PNG over its context frame, so later
 * versions of the generator never move its coasts, ranges or rivers. Pixel value 0 is sea; 1 to 65535 are land
 * heights from 0 to `max`. A private chunk ("asND") holds the generator's own node heights and coast, read back
 * exactly while the generator's points are the same as the keeper's (schema's POINTS_GEN), its later steps run as the
 * keeper ran them; the raster is for a generator whose points differ. The plan keeps
 * { path, gen, frame: [W, H] (miles), size: [w, h] (pixels), max, hash } as
 * land.keep; the file (a JSON file holding the PNG, since Foundry turns uploaded PNGs into WebP) sits beside the map's
 * images. A layout reads the heights back from a store the worker fills
 * before a job (provideKept), since layouts are synchronous. Pure apart from the PNG streams.
 */
import { encodeGray, decodeGraySync, withChunk, readChunk } from "./pngio.mjs";
import { frameOf } from "./units.mjs";
import { GEN } from "./schema.mjs";

/** The longest side of a kept land's file in pixels. */
export const KEPT_MAX_SIDE = 2048;

/** A hash of bytes (FNV-1a, 32 bits, as eight hex digits): tells a kept file from another one. */
export function bytesHash(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/**
 * A land's heights over its context frame, linear across each triangle of its graph (so a node reads back its own
 * height): { w, h, cell, max, values: Uint16Array (0 sea) }. L: a full land (generateLand's), plan: its plan.
 */
export function keptRaster(L) {
  const { g, frame, h: H, landMask } = L;
  const cell = Math.max(L.spacing / 3, Math.max(frame.W, frame.H) / KEPT_MAX_SIDE);
  const w = Math.max(2, Math.ceil(frame.W / cell)), hh = Math.max(2, Math.ceil(frame.H / cell));
  let max = 0;
  for (let i = 0; i < g.n; i++) if (landMask[i] && H[i] > max) max = H[i];
  max = max > 0 ? max : 1;
  const values = new Uint16Array(w * hh);
  const tri = g.triangles, x = g.x, y = g.y;
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t], b = tri[t + 1], c = tri[t + 2];
    const minX = Math.max(0, Math.floor(Math.min(x[a], x[b], x[c]) / cell - 0.5)), maxX = Math.min(w - 1, Math.ceil(Math.max(x[a], x[b], x[c]) / cell - 0.5));
    const minY = Math.max(0, Math.floor(Math.min(y[a], y[b], y[c]) / cell - 0.5)), maxY = Math.min(hh - 1, Math.ceil(Math.max(y[a], y[b], y[c]) / cell - 0.5));
    const det = (y[b] - y[c]) * (x[a] - x[c]) + (x[c] - x[b]) * (y[a] - y[c]);
    if (Math.abs(det) < 1e-12) continue;
    for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
      const X = (px + 0.5) * cell, Y = (py + 0.5) * cell;
      const l1 = ((y[b] - y[c]) * (X - x[c]) + (x[c] - x[b]) * (Y - y[c])) / det;
      const l2 = ((y[c] - y[a]) * (X - x[c]) + (x[a] - x[c]) * (Y - y[c])) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      // land where the land side of the triangle holds the pixel; its height from the land corners
      const m = l1 * landMask[a] + l2 * landMask[b] + l3 * landMask[c];
      if (m < 0.5) { values[py * w + px] = 0; continue; }
      const v = l1 * H[a] + l2 * H[b] + l3 * H[c];
      values[py * w + px] = 1 + Math.round(Math.min(1, Math.max(0, v / max)) * 65534);
    }
  }
  return { w, h: hh, cell, max, values };
}

/**
 * The file and the plan's record for a land kept: { bytes (the PNG), keep: { gen, frame, size, max, hash } } (the
 * path is added by whoever saves the file). L: generateLand's land of the plan.
 */
export async function makeKept(L) {
  const R = keptRaster(L);
  // (the node block: a header (with the coast's forms, when it has any), then each node's height (Float64) and whether
  // it's land)
  const n = L.g.n, head = new TextEncoder().encode(JSON.stringify({ gen: L.gen ?? GEN, attempt: L.attempt ?? 0, n, pos: pointsHash(L.g), ...(L.coasts?.length ? { coasts: L.coasts } : {}) }));
  const block = new Uint8Array(4 + head.length + n * 9);
  new DataView(block.buffer).setUint32(0, head.length);
  block.set(head, 4);
  const hv = new Float64Array(n); hv.set(L.hPre ?? L.h);
  block.set(new Uint8Array(hv.buffer), 4 + head.length);
  block.set(L.landMask, 4 + head.length + n * 8);
  const bytes = await withChunk(await encodeGray(R.values, R.w, R.h, 16), "asND", block);
  return { bytes, keep: { gen: L.gen ?? GEN, frame: [round3(L.frame.W), round3(L.frame.H)], size: [R.w, R.h], cell: R.cell, max: R.max, hash: bytesHash(bytes) } };
}
const round3 = (v) => Math.round(v * 1000) / 1000;

/** A hash of a graph's points (where its nodes are): tells whether a kept node block fits the points made now. */
export function pointsHash(g) {
  const xy = new Float64Array(g.n * 2);
  for (let i = 0; i < g.n; i++) { xy[2 * i] = g.x[i]; xy[2 * i + 1] = g.y[i]; }
  return bytesHash(new Uint8Array(xy.buffer));
}

/** The node block of a kept file: { gen, attempt, n, pos, h: Float64Array, mask: Uint8Array, coasts }, or null. */
function readNodes(bytes) {
  let block;
  try { block = readChunk(bytes, "asND"); } catch { return null; }
  if (!block || block.length < 4) return null;
  const hl = new DataView(block.buffer, block.byteOffset, block.byteLength).getUint32(0);
  let head;
  try { head = JSON.parse(new TextDecoder().decode(block.subarray(4, 4 + hl))); } catch { return null; }
  const n = head?.n;
  if (!(Number.isInteger(n) && n > 0 && block.length === 4 + hl + n * 9)) return null;
  const h = new Float64Array(n);
  new Uint8Array(h.buffer).set(block.subarray(4 + hl, 4 + hl + n * 8));
  return { gen: head.gen, attempt: head.attempt ?? 0, n, pos: head.pos, h, mask: Uint8Array.from(block.subarray(4 + hl + n * 8)), coasts: Array.isArray(head.coasts) ? head.coasts : [] };
}

/** The kept file read into fields over the frame: { heights, land, nodes } (land 1 or 0, nearest pixel; nodes the exact block or null), or { error }. */
export function readKept(bytes, keep) {
  // (the cheap check first: a replaced file isn't inflated)
  if (keep?.hash && bytesHash(bytes) !== keep.hash) return { error: "its file isn't the one kept (it was changed or replaced)" };
  let img;
  try { img = decodeGraySync(bytes); } catch (e) { return { error: `its file couldn't be read (${e.message})` }; }
  const w = img.w, h = img.h, max = Number.isFinite(keep?.max) && keep.max > 0 ? keep.max : 1;
  const W = Array.isArray(keep?.frame) ? keep.frame[0] : null;
  if (!(w >= 2 && h >= 2 && W > 0)) return { error: "its file has no size" };
  // (the record's own cell when it has one: the raster's pixels needn't divide the frame evenly)
  const cell = Number.isFinite(keep?.cell) && keep.cell > 0 ? keep.cell : W / w;
  const heights = { w, h, cell, data: new Float64Array(w * h) }, land = { w, h, cell, data: new Float64Array(w * h) };
  for (let i = 0; i < w * h; i++) { const v = img.values[i]; land.data[i] = v > 0 ? 1 : 0; heights.data[i] = v > 0 ? ((v - 1) / 65534) * max : 0; }
  return { heights, land, nodes: readNodes(bytes) };
}

// ---------------------------------------------------------------- the store a layout reads

const store = new Map();

/** Puts a kept land's file in the store (bytes as read from its path). Returns { ok } or { error }. */
export function provideKept(keep, bytes) {
  if (!keep?.path) return { error: "no path" };
  const prior = store.get(keep.path);
  if (prior && prior.hash === keep.hash && !prior.error) return { ok: true };
  const r = readKept(bytes, keep);
  store.set(keep.path, { hash: keep.hash ?? null, ...r });
  return r.error ? { error: r.error } : { ok: true };
}

/**
 * Says a kept land's file couldn't be fetched (its layouts make the land from its settings, with a note). It's asked
 * for again before the next job, so a file put back is found.
 */
export function missingKept(keep, why) {
  if (keep?.path) store.set(keep.path, { hash: keep.hash ?? null, error: why, missing: true });
}

/** Whether the store has a kept land's file read (one that couldn't be fetched or read is asked for again, so a file put back is found). */
export const hasKept = (keep) => { const e = keep?.path ? store.get(keep.path) : null; return !!e && e.hash === (keep.hash ?? null) && !e.missing && !e.error; };

/**
 * What a layout gets for a plan's kept land: { heights, land } to hold it, { error } when its file couldn't be had
 * (the land is then made from its settings), or null when it keeps none.
 */
export function keptFor(plan) {
  const keep = plan?.land?.keep;
  if (!keep || typeof keep !== "object" || typeof keep.path !== "string") return null;
  const e = store.get(keep.path);
  if (!e || e.hash !== (keep.hash ?? null)) return { error: "its file wasn't loaded" };
  if (e.error) return { error: e.error };
  // (a file made for another frame: the map's size or margin changed since it was kept)
  const f = frameOf(plan);
  if (Array.isArray(keep.frame) && (Math.abs(keep.frame[0] - f.W) > 0.01 * f.W || Math.abs(keep.frame[1] - f.H) > 0.01 * f.H)) return { error: "it was kept for a map of another size" };
  return { heights: e.heights, land: e.land, nodes: e.nodes ?? null };
}

/** Empties the store (tests; a worker's forget). */
export function forgetKept() { store.clear(); }
