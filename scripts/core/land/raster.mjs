/**
 * A per-node value (one a node of the compact land) drawn into a raster rw by rh over the map, straight between each
 * triangle's corners and smoothed by half the node spacing, as landRasters draws the climate. Pure.
 */
export function nodeRaster(land, values, rw, rh) {
  const { frame } = land, n = land.n, cellMi = frame.mapW / rw, N = rw * rh;
  const px = new Float64Array(n), py = new Float64Array(n);
  for (let i = 0; i < n; i++) { px[i] = (land.x[i] - frame.margin) / cellMi; py[i] = (land.y[i] - frame.margin) / cellMi; }
  const out = new Float32Array(N), covered = new Uint8Array(N), tri = land.triangles;
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t], b = tri[t + 1], c = tri[t + 2];
    const ax = px[a], ay = py[a], bx = px[b], by = py[b], cx = px[c], cy = py[c];
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(rw - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(rh - 1, Math.ceil(Math.max(ay, by, cy)));
    if (x0 > x1 || y0 > y1) continue;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-12) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const qx = x + 0.5, qy = y + 0.5;
      const wa = ((by - cy) * (qx - cx) + (cx - bx) * (qy - cy)) / det, wb = ((cy - ay) * (qx - cx) + (ax - cx) * (qy - cy)) / det, wc = 1 - wa - wb;
      if (wa < -1e-9 || wb < -1e-9 || wc < -1e-9) continue;
      const i = y * rw + x;
      if (covered[i]) continue;
      covered[i] = 1;
      out[i] = wa * values[a] + wb * values[b] + wc * values[c];
    }
  }
  boxBlur(out, rw, rh, Math.max(1, (0.5 * land.spacing) / cellMi));
  return out;
}

/**
 * The land drawn into rasters for painting: the generator's nodes blended into a fine height raster over the map (not
 * the margin), rivers carved into it, small relief added, the coast, lakes from their levels, the sea's depth, and the
 * climate and cover the painter colors by. Painting needn't be the same to the bit on every computer (the canvas isn't),
 * so plain Math is used here, but the same land always gives the same rasters on one computer. Pure.
 *
 * land: the layout's compact land (layout/overland.mjs). The raster is rw by rh pixels over the map, a pixel cell
 * map units across. Heights are the generator's (1 is high mountains).
 */
import { BIOMES } from "./biome.mjs";

/** Biomes that are forest, and how much: the painter's canopy. */
const FOREST = { "temperate-forest": 1, "temperate-rainforest": 1, taiga: 0.85, "seasonal-forest": 0.9, rainforest: 1, savanna: 0.25, wetland: 0.3, shrubland: 0.15 };
const FOREST_OF = BIOMES.map((b) => FOREST[b] ?? 0);
/** The biome index the compact land uses for lake and sea nodes. */
export const LAKE_BIOME = 254, SEA_BIOME = 255;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** A fast integer hash to [0, 1). */
function hash2(ix, iy, s) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Smooth value noise at (x, y) (lattice 1 apart), -1 to 1. */
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, s), b = hash2(ix + 1, iy, s), c = hash2(ix, iy + 1, s), d = hash2(ix + 1, iy + 1, s);
  return 2 * (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) - 1;
}
/**
 * Fractal noise over a w by h raster: octaves from a feature `scale` pixels across down to 2 px, each `gain` times the
 * last. Normalized to deviation about 1. Returns Float32Array.
 */
export function fbm(w, h, scale, seed, gain = 0.55, octaves = 0) {
  const out = new Float32Array(w * h);
  const n = octaves || Math.max(1, Math.min(9, Math.ceil(Math.log2(Math.max(2, scale / 2))) + 1));
  let amp = 1, f = 1 / Math.max(1, scale), norm = 0;
  for (let o = 0; o < n; o++) {
    const s = (seed * 131 + o * 7919) | 0, ox = hash2(o, 1, seed) * 1000, oy = hash2(o, 2, seed) * 1000;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] += amp * vnoise(x * f + ox, y * f + oy, s);
    norm += amp * amp; amp *= gain; f *= 2;
  }
  const k = 1 / (0.42 * Math.sqrt(norm));
  for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

/** A box blur of radius r (pixels, may be fractional: rounded), three passes, in place. Edges clamp. */
export function boxBlur(a, w, h, r) {
  r = Math.min(Math.round(r), Math.max(w, h));
  if (r < 1) return a;
  const tmp = new Float32Array(a.length), k = 1 / (2 * r + 1);
  const pass = (src, dst, n, m, stride, step) => {
    for (let j = 0; j < m; j++) {
      const o = j * stride;
      let acc = src[o] * (r + 1);
      for (let i = 1; i <= r; i++) acc += src[o + Math.min(n - 1, i) * step];
      for (let i = 0; i < n; i++) {
        dst[o + i * step] = acc * k;
        acc += src[o + Math.min(n - 1, i + r + 1) * step] - src[o + Math.max(0, i - r) * step];
      }
    }
  };
  for (let t = 0; t < 3; t++) { pass(a, tmp, w, h, w, 1); pass(tmp, a, h, w, 1, w); }
  return a;
}

/** Exact distance (pixels) from every pixel to the nearest where test(i) holds (Felzenszwalb). Float32Array. */
export function distance(w, h, test) {
  const INF = 1e20, d = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = test(i) ? 0 : INF;
  const n = Math.max(w, h), f = new Float64Array(n), z = new Float64Array(n + 1), v = new Int32Array(n), o = new Float64Array(n);
  const line = (len, get, set) => {
    for (let q = 0; q < len; q++) f[q] = get(q);
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s;
      for (;;) { const p = v[k]; s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p); if (s <= z[k] && k > 0) k--; else break; }
      if (s <= z[k]) { v[0] = q; z[0] = -INF; z[1] = INF; k = 0; continue; }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const p = v[k]; o[q] = (q - p) * (q - p) + f[p]; }
    for (let q = 0; q < len; q++) set(q, o[q]);
  };
  for (let x = 0; x < w; x++) line(h, (y) => d[y * w + x], (y, val) => { d[y * w + x] = val; });
  for (let y = 0; y < h; y++) line(w, (x) => d[y * w + x], (x, val) => { d[y * w + x] = val; });
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = Math.sqrt(d[i]);
  return out;
}

/** 4-connected regions where test(i): { label (Int32Array, -1 outside), sizes, edge (touches the raster's border) }. */
function regions(w, h, test) {
  const label = new Int32Array(w * h).fill(-1), sizes = [], edge = [], stack = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (label[s] >= 0 || !test(s)) continue;
    const id = sizes.length; let top = 0, cnt = 0, touch = false;
    stack[top++] = s; label[s] = id;
    while (top) {
      const i = stack[--top]; cnt++;
      const x = i % w;
      if (x === 0 || x === w - 1 || i < w || i >= w * (h - 1)) touch = true;
      if (x > 0 && label[i - 1] < 0 && test(i - 1)) { label[i - 1] = id; stack[top++] = i - 1; }
      if (x < w - 1 && label[i + 1] < 0 && test(i + 1)) { label[i + 1] = id; stack[top++] = i + 1; }
      if (i >= w && label[i - w] < 0 && test(i - w)) { label[i - w] = id; stack[top++] = i - w; }
      if (i + w < w * h && label[i + w] < 0 && test(i + w)) { label[i + w] = id; stack[top++] = i + w; }
    }
    sizes.push(cnt); edge.push(touch);
  }
  return { label, sizes, edge };
}

/** A seeded stream of numbers in [0, 1) (mulberry32: painting needn't match the generator's streams). */
function stream(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Droplet erosion (as mockup 4b): droplets rolled over the land cut gullies and drop what they carry in hollows.
 * z is scaled by zs while rolling (the droplet's constants were set on heights of that size). In place.
 */
function droplets(z, land, w, h, count, seed, steps = 40, zs = 60, minZ = 0.05) {
  const r = stream(seed), minStart = minZ * zs;
  for (let i = 0; i < z.length; i++) z[i] *= zs;
  const inertia = 0.05, capk = 4, minsl = 0.01, erk = 0.3, depk = 0.3, evap = 0.015, grav = 4;
  const at = (x, y) => { const ix = x | 0, iy = y | 0, fx = x - ix, fy = y - iy, o = iy * w + ix; return z[o] * (1 - fx) * (1 - fy) + z[o + 1] * fx * (1 - fy) + z[o + w] * (1 - fx) * fy + z[o + w + 1] * fx * fy; };
  for (let k = 0; k < count; k++) {
    let x = r() * (w - 6) + 3, y = r() * (h - 6) + 3;
    // (gullies on raised ground only: the plains stay plain)
    if (!land[(y | 0) * w + (x | 0)] || z[(y | 0) * w + (x | 0)] < minStart) continue;
    let dx = 0, dy = 0, v = 1, wat = 1, sed = 0;
    for (let s = 0; s < steps; s++) {
      const ix = x | 0, iy = y | 0;
      if (ix < 3 || iy < 3 || ix > w - 4 || iy > h - 4) break;
      const fx = x - ix, fy = y - iy, o = iy * w + ix;
      const a = z[o], b = z[o + 1], c = z[o + w], d = z[o + w + 1];
      if (a < 0 || !land[o]) break;
      const gx = (b - a) * (1 - fy) + (d - c) * fy, gy = (c - a) * (1 - fx) + (d - b) * fx;
      const hh = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
      dx = dx * inertia - gx * (1 - inertia); dy = dy * inertia - gy * (1 - inertia);
      const L = Math.sqrt(dx * dx + dy * dy);
      if (L < 1e-9) break;
      dx /= L; dy /= L;
      const nx = x + dx, ny = y + dy;
      if (nx < 3 || ny < 3 || nx > w - 4 || ny > h - 4) break;
      const dh = at(nx, ny) - hh;
      const cap = Math.max(-dh, minsl) * v * wat * capk;
      if (sed > cap || dh > 0) {
        const dep = dh > 0 ? Math.min(dh, sed) : (sed - cap) * depk;
        sed -= dep;
        z[o] += dep * (1 - fx) * (1 - fy); z[o + 1] += dep * fx * (1 - fy); z[o + w] += dep * (1 - fx) * fy; z[o + w + 1] += dep * fx * fy;
      } else {
        const er = Math.min((cap - sed) * erk, -dh);
        // (a 3 by 3 brush, weights 1.5 - distance, summing to 1)
        const wc = 1.5, we = 0.5, wd = 1.5 - Math.SQRT2, tot = wc + 4 * we + 4 * wd;
        z[o] -= (er * wc) / tot;
        z[o - 1] -= (er * we) / tot; z[o + 1] -= (er * we) / tot; z[o - w] -= (er * we) / tot; z[o + w] -= (er * we) / tot;
        z[o - w - 1] -= (er * wd) / tot; z[o - w + 1] -= (er * wd) / tot; z[o + w - 1] -= (er * wd) / tot; z[o + w + 1] -= (er * wd) / tot;
        sed += er;
      }
      const q = v * v - dh * grav;
      v = q > 0 ? Math.sqrt(q) : 0;
      wat *= 1 - evap; x = nx; y = ny;
    }
  }
  for (let i = 0; i < z.length; i++) z[i] /= zs;
}

/** Chaikin corner cutting (n times) of a polyline of [x, y, ...rest] points: the rest interpolated alike. */
export function chaikin(p, n = 2) {
  for (let t = 0; t < n; t++) {
    if (p.length < 3) return p;
    const q = [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i], b = p[i + 1];
      q.push(a.map((v, k) => 0.75 * v + 0.25 * b[k]), a.map((v, k) => 0.25 * v + 0.75 * b[k]));
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

/**
 * The rasters for a compact land. rw, rh: the raster's size over the map; seed: the layout's. Returns { rw, rh, cell
 * (map units a pixel), cellMi, z (heights), land (Uint8), landS (signed: land above 0, its zero line the coast), lake
 * (Uint8), lakeS (signed: water above 0, -1 away from any lake), salt (Uint8), rain, temp, hard, forest (0 to 1),
 * biome (Uint8 index, nearest node), zone (Int16, 0 none), seaDist, landDist (pixels), depth (0 shallow to 1 deep),
 * riverDist (pixels to a drawn river big enough to have a floodplain), ms }.
 */
export function landRasters(land, { rw, rh, seed = 1 }) {
  const t0 = performance.now();
  const { frame } = land, n = land.n;
  const cell = frame.mapW / frame.mpu / rw; // (map units a pixel)
  const cellMi = cell * frame.mpu, N = rw * rh;
  // node positions in raster pixels
  const px = new Float64Array(n), py = new Float64Array(n);
  for (let i = 0; i < n; i++) { px[i] = (land.x[i] - frame.margin) / cellMi; py[i] = (land.y[i] - frame.margin) / cellMi; }

  // each node's slope by least squares over its neighbors (pixels), for blending tangent planes
  const gx = new Float64Array(n), gy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sxx = 0, sxy = 0, syy = 0, sxh = 0, syh = 0;
    for (let k = land.indptr[i]; k < land.indptr[i + 1]; k++) {
      const j = land.indices[k], dx = px[j] - px[i], dy = py[j] - py[i], dh = land.h[j] - land.h[i];
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy; sxh += dx * dh; syh += dy * dh;
    }
    const det = sxx * syy - sxy * sxy;
    if (Math.abs(det) > 1e-12) { gx[i] = (syy * sxh - sxy * syh) / det; gy[i] = (sxx * syh - sxy * sxh) / det; }
  }

  // every triangle drawn: heights by blended tangent planes, the rest straight between its corners
  const z = new Float32Array(N), landQ = new Float32Array(N), rain = new Float32Array(N), temp = new Float32Array(N);
  const hard = new Float32Array(N), forest = new Float32Array(N), sdep = new Float32Array(N), saltQ = new Float32Array(N);
  const lakeOf = new Int32Array(N).fill(-1), biome = new Uint8Array(N).fill(SEA_BIOME), zone = new Int16Array(N);
  const covered = new Uint8Array(N);
  const tri = land.triangles;
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t], b = tri[t + 1], c = tri[t + 2];
    const ax = px[a], ay = py[a], bx = px[b], by = py[b], cx = px[c], cy = py[c];
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(rw - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(rh - 1, Math.ceil(Math.max(ay, by, cy)));
    if (x0 > x1 || y0 > y1) continue;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-12) continue;
    const hmin = Math.min(land.h[a], land.h[b], land.h[c]), hmax = Math.max(land.h[a], land.h[b], land.h[c]), pad = 0.25 * (hmax - hmin);
    const lk = land.lakeId[a] >= 0 ? land.lakeId[a] : land.lakeId[b] >= 0 ? land.lakeId[b] : land.lakeId[c];
    for (let y = y0; y <= y1; y++) {
      const qy = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const qx = x + 0.5;
        const wa = ((by - cy) * (qx - cx) + (cx - bx) * (qy - cy)) / det;
        const wb = ((cy - ay) * (qx - cx) + (ax - cx) * (qy - cy)) / det;
        const wc = 1 - wa - wb;
        if (wa < -1e-9 || wb < -1e-9 || wc < -1e-9) continue;
        const i = y * rw + x;
        if (covered[i]) continue;
        covered[i] = 1;
        const ha = land.h[a] + gx[a] * (qx - ax) + gy[a] * (qy - ay);
        const hb = land.h[b] + gx[b] * (qx - bx) + gy[b] * (qy - by);
        const hc = land.h[c] + gx[c] * (qx - cx) + gy[c] * (qy - cy);
        z[i] = Math.min(hmax + pad, Math.max(hmin - pad, wa * ha + wb * hb + wc * hc));
        landQ[i] = wa * (land.landMask[a] ? 1 : -1) + wb * (land.landMask[b] ? 1 : -1) + wc * (land.landMask[c] ? 1 : -1);
        rain[i] = wa * land.rain[a] + wb * land.rain[b] + wc * land.rain[c];
        temp[i] = wa * land.temp[a] + wb * land.temp[b] + wc * land.temp[c];
        hard[i] = wa * land.hard[a] + wb * land.hard[b] + wc * land.hard[c];
        sdep[i] = wa * land.sea[a] + wb * land.sea[b] + wc * land.sea[c];
        saltQ[i] = wa * (land.salt[a] ? 1 : -1) + wb * (land.salt[b] ? 1 : -1) + wc * (land.salt[c] ? 1 : -1);
        const near = wa >= wb && wa >= wc ? a : wb >= wc ? b : c;
        const bi = land.biome[near];
        biome[i] = bi;
        forest[i] = wa * (FOREST_OF[land.biome[a]] ?? 0) + wb * (FOREST_OF[land.biome[b]] ?? 0) + wc * (FOREST_OF[land.biome[c]] ?? 0);
        zone[i] = land.zone ? land.zone[near] : 0;
        if (lk >= 0) lakeOf[i] = lk;
      }
    }
  }

  // smoothed by a quarter of the node spacing (the blend is continuous, its creases aren't)
  const sp = land.spacing / cellMi;
  boxBlur(z, rw, rh, 0.25 * sp);
  boxBlur(landQ, rw, rh, Math.max(1, 0.18 * sp));
  for (const a of [rain, temp, hard, sdep, forest]) boxBlur(a, rw, rh, Math.max(1, 0.5 * sp));
  boxBlur(saltQ, rw, rh, Math.max(1, 0.2 * sp));

  // rivers carved in: a trench along each drawn river, its floor below the river's level by its flow, so rivers sit
  // in their valleys; big rivers' floors flat. riverDist: how far a pixel is from a river with a floodplain
  const rivers = land.rivers ?? [];
  let fmax = 0, fmin = Infinity;
  for (const R of rivers) for (const p of R.points) { if (p[2] > fmax) fmax = p[2]; if (p[2] < fmin) fmin = p[2]; }
  const lf = (f) => (fmax > fmin ? Math.max(0, Math.min(1, Math.log(f / fmin) / Math.log(fmax / fmin))) : 0.5);
  const bigRiver = new Uint8Array(N);
  for (const R of rivers) {
    const pts = chaikin(R.points.map(([x, y, f, hh]) => [(x - frame.margin) / cellMi, (y - frame.margin) / cellMi, f, hh]), 2);
    for (let k = 0; k + 1 < pts.length; k++) {
      const [x0, y0, f0, h0] = pts[k], [x1, y1, f1, h1] = pts[k + 1];
      const t = lf(0.5 * (f0 + f1));
      const half = Math.max(0.8, (0.6 + 4 * t) * (Math.max(rw, rh) / 2048) * 1.4), depth = 0.002 + 0.01 * t, flat = t > 0.55 ? 0.5 : 0;
      const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1e-9;
      const bx0 = Math.max(0, Math.floor(Math.min(x0, x1) - half - 1)), bx1 = Math.min(rw - 1, Math.ceil(Math.max(x0, x1) + half + 1));
      const by0 = Math.max(0, Math.floor(Math.min(y0, y1) - half - 1)), by1 = Math.min(rh - 1, Math.ceil(Math.max(y0, y1) + half + 1));
      for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
        const s = Math.max(0, Math.min(1, ((x + 0.5 - x0) * dx + (y + 0.5 - y0) * dy) / L2));
        const ex = x0 + s * dx - x - 0.5, ey = y0 + s * dy - y - 0.5, d = Math.sqrt(ex * ex + ey * ey) / half;
        if (d >= 1) continue;
        const i = y * rw + x;
        const level = h0 + s * (h1 - h0);
        const prof = d < flat ? 1 : 1 - smooth(flat, 1, d);
        const target = level - depth * prof;
        if (target < z[i] && landQ[i] > -0.2) z[i] = target;
        if (t > 0.35) bigRiver[i] = 1;
      }
    }
  }
  const riverDist = distance(rw, rh, (i) => bigRiver[i] === 1);

  // the coast: the land indicator's zero line, made ragged below the node spacing by noise scaled by relief and rock
  // (ragged where mountains meet the sea, smooth along low coasts)
  const c1 = fbm(rw, rh, Math.max(4, 1.6 * sp), seed * 7 + 1, 0.6), c2 = fbm(rw, rh, Math.max(2, 0.5 * sp), seed * 7 + 2, 0.5);
  const relief = Float32Array.from(z, (v) => Math.max(0, v));
  boxBlur(relief, rw, rh, Math.max(2, sp));
  const landS = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const rough = 0.55 + 0.9 * smooth(0.04, 0.35, relief[i]) + 0.4 * hard[i];
    landS[i] = covered[i] ? landQ[i] + rough * (0.22 * c1[i] + 0.07 * c2[i]) : -1;
  }
  // (sea specks inland filled, land specks at sea dropped; sizes by the raster's)
  const holeMax = Math.max(12, (N * 4e-4) | 0), speckMin = Math.max(6, (N * 4e-5) | 0);
  {
    const sea = regions(rw, rh, (i) => landS[i] <= 0);
    // (not a piece of sea the map's edge cuts off: it's part of a bigger sea beyond)
    for (let i = 0; i < N; i++) { const l = sea.label[i]; if (l >= 0 && sea.sizes[l] < holeMax && !sea.edge[l]) landS[i] = 0.05; }
    const isl = regions(rw, rh, (i) => landS[i] > 0);
    for (let i = 0; i < N; i++) { const l = isl.label[i]; if (l >= 0 && isl.sizes[l] < speckMin && !isl.edge[l]) landS[i] = -0.05; }
  }
  const landM = Uint8Array.from(landS, (v) => (v > 0 ? 1 : 0));

  // small relief on the land: noise growing with height, then droplets for gullies
  // (two bands: about the node spacing, and a few pixels, which the light picks out on high ground)
  const det = fbm(rw, rh, Math.max(3, 0.8 * sp), seed * 7 + 3, 0.55), fine = fbm(rw, rh, 3, seed * 7 + 5, 0.5, 2);
  for (let i = 0; i < N; i++) if (landM[i]) { const zz = Math.min(1, Math.max(0, z[i])); z[i] += (0.0001 + 0.03 * Math.pow(zz, 1.4)) * det[i] + 0.008 * zz * zz * fine[i]; }
  let landPx = 0; for (let i = 0; i < N; i++) landPx += landM[i];
  droplets(z, landM, rw, rh, Math.round(landPx * 0.6), seed * 7 + 4, 40, 60 * (1365 / Math.max(rw, rh)));
  for (let i = 0; i < N; i++) if (landM[i] && z[i] < 0.0008) z[i] = 0.0008;

  // the sea rising a little into low river mouths: estuaries
  {
    const seaD0 = distance(rw, rh, (i) => !landM[i]);
    const reach = Math.max(3, 0.012 * Math.max(rw, rh));
    for (let i = 0; i < N; i++) if (landM[i] && riverDist[i] < 1.5 && seaD0[i] < reach && z[i] < 0.003 + 0.004 * (1 - seaD0[i] / reach)) { landM[i] = 0; landS[i] = -0.02; }
  }

  // lakes from their levels: water wherever the ground is below its lake's level inside that lake's basin
  // (lakeDepth: how far below its lake's level the ground is, in height units, where there's water)
  const lakeS = new Float32Array(N).fill(-1), lake = new Uint8Array(N), salt = new Uint8Array(N), lakeDepth = new Float32Array(N);
  const level = new Map((land.lakes ?? []).map((L) => [L.id, L.level]));
  for (let i = 0; i < N; i++) {
    if (!landM[i]) continue;
    const k = lakeOf[i];
    if (k >= 0 && level.has(k)) {
      const s = (level.get(k) - z[i]) * 4000;
      lakeS[i] = Math.max(-1, Math.min(1, s));
      if (s > 0) { lake[i] = 1; lakeDepth[i] = level.get(k) - z[i]; }
    }
    if (!lake[i] && saltQ[i] > 0) salt[i] = 1;
  }
  // (lake specks dropped)
  { const lr = regions(rw, rh, (i) => lake[i] === 1); for (let i = 0; i < N; i++) { const l = lr.label[i]; if (l >= 0 && lr.sizes[l] < speckMin) { lake[i] = 0; lakeDepth[i] = 0; lakeS[i] = Math.min(lakeS[i], -0.01); } } }

  // the sea's depth: the distance offshore, blended with the recipe's shape continued under the water (shelves, banks,
  // island platforms, deep channels)
  const seaDist = distance(rw, rh, (i) => landM[i] === 1);
  const landDist = distance(rw, rh, (i) => landM[i] === 0);
  const depth = new Float32Array(N);
  let sd90 = 0;
  { const vals = []; for (let i = 0; i < N; i += 7) if (!landM[i]) vals.push(Math.max(0, -sdep[i])); vals.sort((a, b) => a - b); sd90 = vals[Math.floor(vals.length * 0.9)] || 1; }
  const far = 0.13 * Math.max(rw, rh);
  for (let i = 0; i < N; i++) {
    if (landM[i]) continue;
    const byDist = Math.pow(Math.min(1, seaDist[i] / far), 0.6), byShape = Math.min(1, Math.max(0, -sdep[i]) / sd90);
    depth[i] = 0.7 * byDist + 0.3 * byShape * Math.min(1, seaDist[i] / 4);
  }
  boxBlur(depth, rw, rh, Math.max(1, 1.5 * sp));

  return { rw, rh, cell, cellMi, z, land: landM, landS, lake, lakeS, lakeDepth, salt, rain, temp, hard, forest, biome, zone, seaDist, landDist, depth, riverDist, ms: Math.round(performance.now() - t0) };
}
