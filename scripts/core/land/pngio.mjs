/**
 * A small PNG encoder and decoder for gray images (8 or 16 bits a pixel), on the platform's CompressionStream
 * ("deflate" is zlib's format), so values come back exactly: no canvas, no color management, no premultiplied alpha.
 * Used for the painted intent layers (8-bit, kept in the plan as data URLs) and a kept land's heights (16-bit). Pure
 * apart from the streams, which the browser, the worker and node all have.
 */

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

async function through(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
const be32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
function chunk(type, data) {
  const t = new TextEncoder().encode(type);
  const body = new Uint8Array(t.length + data.length); body.set(t); body.set(data, t.length);
  const out = new Uint8Array(12 + data.length);
  out.set(be32(data.length), 0); out.set(body, 4); out.set(be32(crc32(body)), 8 + data.length);
  return out;
}

/** A gray PNG of w by h pixels from values (Uint8Array for 8 bits, Uint16Array for 16). Returns Uint8Array. */
export async function encodeGray(values, w, h, bits = 8) {
  const bpp = bits === 16 ? 2 : 1, row = w * bpp;
  const raw = new Uint8Array((row + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (row + 1)] = 0; // (no filter)
    for (let x = 0; x < w; x++) {
      const v = values[y * w + x], o = y * (row + 1) + 1 + x * bpp;
      if (bpp === 2) { raw[o] = (v >>> 8) & 255; raw[o + 1] = v & 255; } else raw[o] = v & 255;
    }
  }
  const z = await through(raw, new CompressionStream("deflate"));
  const ihdr = new Uint8Array([...be32(w), ...be32(h), bits, 0, 0, 0, 0]);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Decodes a gray PNG (8 or 16 bits, any filter, no interlace). Returns { w, h, bits, values }. */
export async function decodeGray(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((b, i) => u[i] === b)) throw new Error("not a PNG");
  let o = 8, w = 0, h = 0, bits = 8, color = 0, inter = 0;
  const idat = [];
  while (o < u.length) {
    const len = (u[o] << 24 | u[o + 1] << 16 | u[o + 2] << 8 | u[o + 3]) >>> 0;
    const type = String.fromCharCode(u[o + 4], u[o + 5], u[o + 6], u[o + 7]);
    const data = u.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") { w = (data[0] << 24 | data[1] << 16 | data[2] << 8 | data[3]) >>> 0; h = (data[4] << 24 | data[5] << 16 | data[6] << 8 | data[7]) >>> 0; bits = data[8]; color = data[9]; inter = data[12]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  if (color !== 0 || inter !== 0 || (bits !== 8 && bits !== 16)) throw new Error("only gray, non-interlaced, 8 or 16-bit PNGs are read here");
  const z = new Uint8Array(idat.reduce((s, p) => s + p.length, 0)); { let q = 0; for (const p of idat) { z.set(p, q); q += p.length; } }
  const raw = await through(z, new DecompressionStream("deflate"));
  const bpp = bits === 16 ? 2 : 1, row = w * bpp;
  const cur = new Uint8Array(row), prev = new Uint8Array(row);
  const values = bits === 16 ? new Uint16Array(w * h) : new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (row + 1)], line = raw.subarray(y * (row + 1) + 1, (y + 1) * (row + 1));
    for (let i = 0; i < row; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) values[y * w + x] = bpp === 2 ? (cur[2 * x] << 8) | cur[2 * x + 1] : cur[x];
    prev.set(cur);
  }
  return { w, h, bits, values };
}

/** A data URL for PNG bytes, and back. */
export function toDataUrl(bytes) {
  let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(s)}`;
}
export function fromDataUrl(url) {
  const b = atob(String(url).replace(/^data:image\/png;base64,/, ""));
  const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}
