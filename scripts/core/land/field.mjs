/**
 * Fields over the land's frame: a raster of numbers (Float64Array) with its size in pixels and miles a pixel,
 * sampled anywhere in the frame (bilinear, clamped at the edges); spectral noise made by FFT (1/f^beta noise with
 * random phases, its longest wavelengths optionally cut), domain warping, blurs and connected-region labels. Every
 * function here depends only on the frame and the seed, never on the graph, so a field reads the same at any node
 * count. Pure; bit-identical in every engine (dmath, integer randomness).
 */
import { cos, sin, pow, PI } from "./dmath.mjs";
import { rng } from "../rng.mjs";

/** A field over a frame of W by H miles with its longer side `long` pixels. */
export function makeField(W, H, long = 512) {
  const cell = Math.max(W, H) / long;
  const w = Math.max(2, Math.round(W / cell)), h = Math.max(2, Math.round(H / cell));
  return { w, h, cell, data: new Float64Array(w * h) };
}

/** A new field of the same size (zeros, or a copy of data). */
export const like = (f, data = null) => ({ w: f.w, h: f.h, cell: f.cell, data: data ? Float64Array.from(data) : new Float64Array(f.w * f.h) });

/** The field's value at (x, y) miles in the frame: bilinear, clamped. */
export function sample(f, x, y) {
  let fx = x / f.cell - 0.5, fy = y / f.cell - 0.5;
  if (fx < 0) fx = 0; else if (fx > f.w - 1) fx = f.w - 1;
  if (fy < 0) fy = 0; else if (fy > f.h - 1) fy = f.h - 1;
  // (a field one pixel wide or tall reads as its one row or column)
  const ix = Math.max(0, Math.min(f.w - 2, Math.floor(fx))), iy = Math.max(0, Math.min(f.h - 2, Math.floor(fy)));
  const dx = f.w > 1 ? 1 : 0, dy = f.h > 1 ? f.w : 0;
  const tx = fx - ix, ty = fy - iy, d = f.data, o = iy * f.w + ix;
  return (d[o] * (1 - tx) + d[o + dx] * tx) * (1 - ty) + (d[o + dy] * (1 - tx) + d[o + dy + dx] * tx) * ty;
}

/** The field sampled at every node of a graph: Float64Array. */
export function atNodes(f, g) {
  const out = new Float64Array(g.n);
  for (let i = 0; i < g.n; i++) out[i] = sample(f, g.x[i], g.y[i]);
  return out;
}

// ---------------------------------------------------------------- FFT
const tables = new Map();
function tablesFor(n) {
  let t = tables.get(n);
  if (t) return t;
  const c = new Float64Array(n / 2), s = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) { c[k] = cos((2 * PI * k) / n); s[k] = sin((2 * PI * k) / n); }
  const rev = new Uint32Array(n);
  let bits = 0; while ((1 << bits) < n) bits++;
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  t = { c, s, rev };
  tables.set(n, t);
  return t;
}

/** In-place radix-2 FFT of re and im (length n, a power of two), at stride and offset; inverse with sign -1 (unscaled). */
function fft1(re, im, n, off, stride, inverse, buf) {
  const { c, s, rev } = tablesFor(n);
  const br = buf.re, bi = buf.im;
  for (let i = 0; i < n; i++) { const j = off + rev[i] * stride; br[i] = re[j]; bi[i] = im[j]; }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k++) {
        const wr = c[k * step], wi = inverse ? s[k * step] : -s[k * step];
        const a = i + k, b = a + half;
        const tr = br[b] * wr - bi[b] * wi, ti = br[b] * wi + bi[b] * wr;
        br[b] = br[a] - tr; bi[b] = bi[a] - ti; br[a] += tr; bi[a] += ti;
      }
    }
  }
  for (let i = 0; i < n; i++) { const j = off + i * stride; re[j] = br[i]; im[j] = bi[i]; }
}

/** 2D FFT in place over an nx by ny grid (row-major), powers of two. */
export function fft2(re, im, nx, ny, inverse = false) {
  const buf = { re: new Float64Array(Math.max(nx, ny)), im: new Float64Array(Math.max(nx, ny)) };
  for (let y = 0; y < ny; y++) fft1(re, im, nx, y * nx, 1, inverse, buf);
  for (let x = 0; x < nx; x++) fft1(re, im, ny, x, nx, inverse, buf);
  if (inverse) { const k = 1 / (nx * ny); for (let i = 0; i < re.length; i++) { re[i] *= k; im[i] *= k; } }
}

const pow2Above = (v) => { let p = 1; while (p < v) p *= 2; return p; };

/**
 * Spectral noise on a field's grid: amplitude k^-beta, random phases from rng(seed, ...keys), wavelengths longer than
 * lowCut miles dropped (0: none), shorter than highCut miles dropped (0: none). Normalized to mean 0, deviation 1.
 * Periodic over a power-of-two square at least as big as the field, so it doesn't repeat inside the frame.
 */
export function noise(f, beta, seed, keys, { lowCut = 0, highCut = 0 } = {}) {
  const N = pow2Above(Math.max(f.w, f.h));
  const re = new Float64Array(N * N), im = new Float64Array(N * N);
  const r = rng(seed, "land-noise", ...keys);
  const per = N * f.cell; // (miles one period spans)
  for (let y = 0; y < N; y++) {
    const ky = y <= N / 2 ? y : y - N;
    for (let x = 0; x < N; x++) {
      const kx = x <= N / 2 ? x : x - N;
      const k = Math.sqrt(kx * kx + ky * ky);
      const ph = 2 * PI * r.next();
      if (k === 0) continue;
      const wave = per / k; // (wavelength in miles)
      if ((lowCut && wave > lowCut) || (highCut && wave < highCut)) continue;
      const a = pow(k, -beta);
      re[y * N + x] = a * cos(ph); im[y * N + x] = a * sin(ph);
    }
  }
  fft2(re, im, N, N, true);
  const out = like(f);
  let sum = 0;
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) { const v = re[y * N + x]; out.data[y * f.w + x] = v; sum += v; }
  const mean = sum / out.data.length;
  let sq = 0;
  for (let i = 0; i < out.data.length; i++) { out.data[i] -= mean; sq += out.data[i] * out.data[i]; }
  const sd = Math.sqrt(sq / out.data.length) || 1;
  for (let i = 0; i < out.data.length; i++) out.data[i] /= sd;
  return out;
}

/** The field warped: each pixel takes the value amt miles away along two noise fields (wx, wy, deviation 1). */
export function warp(f, wx, wy, amt) {
  const out = like(f);
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const i = y * f.w + x;
    out.data[i] = sample(f, (x + 0.5) * f.cell + wx.data[i] * amt, (y + 0.5) * f.cell + wy.data[i] * amt);
  }
  return out;
}

/** A box blur of radius r pixels, three passes (close to a Gaussian), in place. */
export function blur(f, r) {
  if (r < 1) return f;
  const { w, h } = f, tmp = new Float64Array(w * h);
  // (past the field's size a wider box adds only more of the clamped edge, at a cost that grows with r)
  r = Math.min(r, Math.max(w, h));
  const pass = (src, dst, horiz) => {
    const n = horiz ? w : h, m = horiz ? h : w;
    for (let j = 0; j < m; j++) {
      let acc = 0;
      const at = (i) => (horiz ? j * w + Math.min(n - 1, Math.max(0, i)) : Math.min(n - 1, Math.max(0, i)) * w + j);
      for (let i = -r; i <= r; i++) acc += src[at(i)];
      for (let i = 0; i < n; i++) {
        dst[horiz ? j * w + i : i * w + j] = acc / (2 * r + 1);
        acc += src[at(i + r + 1)] - src[at(i - r)];
      }
    }
  };
  for (let k = 0; k < 3; k++) { pass(f.data, tmp, true); pass(tmp, f.data, false); }
  return f;
}

/** Labels 4-connected regions of pixels where test(i) holds. Returns { label (Int32Array, -1 outside), sizes, edge (touches the frame) }. */
export function regions(f, test) {
  const { w, h } = f, label = new Int32Array(w * h).fill(-1);
  const sizes = [], edge = [];
  const stack = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (label[s] >= 0 || !test(s)) continue;
    const id = sizes.length;
    let top = 0, n = 0, touches = false;
    stack[top++] = s; label[s] = id;
    while (top) {
      const i = stack[--top]; n++;
      const x = i % w, y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
      const visit = (j) => { if (label[j] < 0 && test(j)) { label[j] = id; stack[top++] = j; } };
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (y > 0) visit(i - w);
      if (y < h - 1) visit(i + w);
    }
    sizes.push(n); edge.push(touches);
  }
  return { label, sizes, edge };
}

/**
 * Distance in miles from every pixel to the nearest pixel where test(i) holds (exact Euclidean distance transform,
 * Felzenszwalb and Huttenlocher, linear time). Returns a field.
 */
export function distanceTo(f, test) {
  const { w, h } = f, INF = 1e20;
  const d = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = test(i) ? 0 : INF;
  const n = Math.max(w, h), fz = new Float64Array(n), z = new Float64Array(n + 1), v = new Int32Array(n), out = new Float64Array(n);
  const pass1 = (get, set, len) => {
    for (let q = 0; q < len; q++) fz[q] = get(q);
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s;
      for (;;) { const p = v[k]; s = ((fz[q] + q * q) - (fz[p] + p * p)) / (2 * q - 2 * p); if (s <= z[k] && k > 0) k--; else break; }
      if (s <= z[k]) { v[0] = q; z[0] = -INF; z[1] = INF; k = 0; continue; }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const p = v[k]; out[q] = (q - p) * (q - p) + fz[p]; }
    for (let q = 0; q < len; q++) set(q, out[q]);
  };
  for (let x = 0; x < w; x++) pass1((y) => d[y * w + x], (y, val) => { d[y * w + x] = val; }, h);
  for (let y = 0; y < h; y++) pass1((x) => d[y * w + x], (x, val) => { d[y * w + x] = val; }, w);
  const res = like(f);
  for (let i = 0; i < w * h; i++) res.data[i] = Math.sqrt(d[i]) * f.cell;
  return res;
}
