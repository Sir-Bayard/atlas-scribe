/**
 * Plain pictures of a Land for tuning and checking (not the painted look): a shaded view and layer views (uplift,
 * rain, temperature, flow, biome, plates), as RGBA pixel arrays over the map (or the whole frame), so the same code
 * serves the node contact-sheet tool and, later, the window's layer views. Rivers and spines come back as polylines
 * in the picture's pixels for the caller to stroke. Pure.
 */
import { exp } from "./dmath.mjs";

const BIOME_RGB = {
  sea: [70, 110, 140], lake: [90, 140, 170], glacier: [240, 242, 245], tundra: [180, 180, 160], taiga: [95, 120, 95],
  "cold-steppe": [190, 180, 140], "temperate-forest": [100, 135, 85], "temperate-rainforest": [70, 115, 80],
  grassland: [165, 175, 105], shrubland: [180, 170, 115], "hot-desert": [225, 200, 140], savanna: [200, 185, 110],
  "seasonal-forest": [120, 145, 80], rainforest: [65, 115, 65], wetland: [110, 140, 120], "salt-flat": [235, 230, 210],
};

// (plates told apart: neighbors in this list differ in hue and lightness)
const PLATE_RGB = [[214, 120, 90], [90, 150, 200], [220, 190, 90], [130, 180, 110], [170, 120, 190], [90, 190, 180], [200, 140, 160], [150, 150, 90], [110, 120, 200], [230, 160, 70], [120, 90, 70], [180, 200, 220]];

const ramp = (v, stops) => {
  v = Math.min(1, Math.max(0, v));
  const k = Math.min(stops.length - 2, Math.floor(v * (stops.length - 1))), t = v * (stops.length - 1) - k;
  return stops[k].map((c, i) => c + (stops[k + 1][i] - c) * t);
};

/**
 * view: "shade" | "uplift" | "rain" | "temp" | "flow" | "biome" | "plates" | "site" (site: { site } gives the scores);
 * width (px); whole: the whole frame (else the map). Returns { width, height, rgba (Uint8ClampedArray), toPx(x, y) frame miles -> px, rivers: [[[x, y, w]...]],
 * spines: [[[x, y]...]] }.
 */
export function landPicture(L, view = "shade", width = 320, whole = false, { site = null } = {}) {
  const fr = L.frame;
  const ox = whole ? 0 : fr.margin, oy = whole ? 0 : fr.margin, W = whole ? fr.W : fr.mapW, H = whole ? fr.H : fr.mapH;
  const s = W / width, height = Math.max(1, Math.round(H / s));
  const rgba = new Uint8ClampedArray(width * height * 4);
  const node = new Int32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) node[y * width + x] = L.grid.nearest(ox + (x + 0.5) * s, oy + (y + 0.5) * s);
  // heights by linear interpolation over the triangles (smooth for shading), sea at 0
  const hr = rasterize(L, (j) => (L.landMask[j] ? L.h[j] : 0), ox, oy, s, width, height);
  const hAt = (x, y) => hr[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  let fmax = 1; if (view === "flow") for (let i = 0; i < L.g.n; i++) if (L.landMask[i] && L.F[i] > fmax) fmax = L.F[i];
  let umax = 1e-6; if (view === "uplift") for (let i = 0; i < L.g.n; i++) if (L.U[i] > umax) umax = L.U[i];
  // (site: settle's base score at each node, from its lowest to its highest where anything is built)
  let smin = Infinity, smax = -Infinity;
  if (view === "site" && site) for (let i = 0; i < L.g.n; i++) if (site[i] > -Infinity) { if (site[i] < smin) smin = site[i]; if (site[i] > smax) smax = site[i]; }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const j = node[y * width + x], o = (y * width + x) * 4;
    let c;
    // (the sea: blue on the map-like views, pale on the data views, so their wettest or highest land doesn't read as sea)
    if (!L.landMask[j] && view !== "plates") c = view === "shade" || view === "biome" ? [70, 110, 140] : [214, 220, 226];
    else if (view === "shade" || view === "biome") {
      const base = view === "biome" ? BIOME_RGB[L.biome[j]] ?? [200, 0, 200] : ramp(hAt(x, y) / 1.1, [[120, 160, 100], [170, 175, 120], [190, 170, 135], [205, 200, 190], [250, 250, 250]]);
      // a quick hillshade from the northwest
      const k = 110 / s;
      const gx = (hAt(x + 1, y) - hAt(x - 1, y)) * k, gy = (hAt(x, y + 1) - hAt(x, y - 1)) * k;
      const lit = Math.min(1.4, Math.max(0.2, (1 - 0.7 * gx - 0.7 * gy) / Math.sqrt(1 + gx * gx + gy * gy)));
      c = base.map((v) => v * (0.45 + 0.55 * lit));
      if (L.lake[j]) c = [90, 140, 170];
      if (L.salt[j]) c = [235, 230, 210];
    } else if (view === "uplift") c = ramp(L.U[j] / umax, [[236, 230, 210], [214, 170, 110], [170, 90, 60], [90, 40, 40]]);
    else if (view === "rain") c = ramp(L.rain[j] / 2, [[214, 190, 130], [196, 196, 120], [120, 160, 90], [60, 120, 110], [40, 80, 120]]);
    else if (view === "temp") c = ramp(L.temp[j], [[240, 244, 250], [150, 180, 210], [200, 210, 150], [230, 180, 100], [210, 110, 60]]);
    else if (view === "flow") c = ramp(Math.log(1 + L.F[j]) / Math.log(1 + fmax), [[240, 240, 230], [150, 190, 220], [30, 80, 160]]);
    else if (view === "site") c = site && site[j] > -Infinity && smax > smin ? ramp((site[j] - smin) / (smax - smin), [[60, 60, 70], [110, 80, 150], [210, 90, 90], [245, 190, 70], [255, 250, 200]]) : [150, 150, 145];
    else if (view === "plates") { const p = L.plates.plate[j]; c = PLATE_RGB[((p % PLATE_RGB.length) + PLATE_RGB.length) % PLATE_RGB.length]; if (!L.landMask[j]) c = c.map((v) => v * 0.6); }
    rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
  }
  const toPx = (x, y) => [(x - ox) / s, (y - oy) / s];
  const fmx = Math.max(1, ...L.rivers.map((R) => R.points[R.points.length - 1][2]));
  const rivers = L.rivers.map((R) => R.points.map(([x, y, f]) => [...toPx(x, y), 0.6 + 2.2 * Math.log(f / L.threshold + 1) / Math.log(fmx / L.threshold + 1)]));
  const spines = L.spines.map((sp) => sp.points.map(([x, y]) => toPx(x, y)));
  return { width, height, rgba, toPx, rivers, spines };
}

/**
 * A per-node value over a picture by linear interpolation on the graph's triangles. ox, oy: the picture's corner in
 * frame miles; s: miles a pixel. Returns a Float64Array (width * height).
 */
export function rasterize(L, valueOf, ox, oy, s, width, height) {
  const out = new Float64Array(width * height), { x, y, triangles } = L.g;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
    const ax = (x[a] - ox) / s - 0.5, ay = (y[a] - oy) / s - 0.5, bx = (x[b] - ox) / s - 0.5, by = (y[b] - oy) / s - 0.5, cx = (x[c] - ox) / s - 0.5, cy = (y[c] - oy) / s - 0.5;
    const x0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx))), x1 = Math.min(width - 1, Math.floor(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.ceil(Math.min(ay, by, cy))), y1 = Math.min(height - 1, Math.floor(Math.max(ay, by, cy)));
    if (x0 > x1 || y0 > y1) continue;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (det === 0) continue;
    const va = valueOf(a), vb = valueOf(b), vc = valueOf(c);
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det, l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det, l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      out[py * width + px] = l1 * va + l2 * vb + l3 * vc;
    }
  }
  return out;
}

export { exp };
