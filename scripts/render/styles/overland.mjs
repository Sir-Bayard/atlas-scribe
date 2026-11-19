/**
 * The painted overland style: generated land (layout/overland.mjs) painted as a hand-painted fantasy map, needing no
 * art. The smooth parts (color by climate converging to browns, grays and snow with height; Imhof's warm light and cool
 * shade; texture shading; the sea by its depth; lakes) are worked out once at relief resolution (about a third of the
 * picture's size) and scaled up; what must be crisp (ripple rings, the coast's ink, rivers, lake rims, marsh and dune
 * marks, places, roads, the furniture, paper grain) is drawn at full size in each tile.
 */
import { PALETTE } from "./palette.mjs";
import { dress } from "./furniture.mjs";
import { drawRoads, drawPlaces } from "./region.mjs";
import { landRasters, boxBlur, fbm, chaikin, distance } from "../../core/land/raster.mjs";
import { refineLand } from "../../core/land/refine.mjs";
import { contours, smoothLine } from "../../core/land/vector.mjs";
import { BIOMES, BIOME_CLIMATE } from "../../core/land/biome.mjs";

export const MAX_BLUR = 0.5;
export const rolesFor = () => [];

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const rgb = ([r, g, b], a = 1) => (a === 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`);

/** The look's colors (mockup 3's palette: clear meadows and ochres, a canopy of its own, warm rock under violet shade). */
const LOOK = {
  dry: [206, 178, 116], meadow: [168, 180, 86], lush: [124, 158, 70], heath: [176, 178, 150], sand: [222, 196, 138], polar: [226, 228, 222],
  forest: [92, 122, 72], forestCold: [-14, -8, 6], rock: [158, 142, 116], snow: [248, 248, 244], alluvium: [178, 184, 120], salt: [236, 230, 212],
  warm: [96, 76, 34], cool: [62, 60, 34], coolSnow: [80, 70, 40],
  shallow: [172, 206, 198], deep: [66, 112, 128], lakeRim: [150, 192, 192], lakeDeep: [96, 140, 150],
  ripple: [36, 66, 76], coast: [50, 42, 32], river: [58, 98, 118], lakeInk: [50, 70, 80], paper: [236, 226, 200], vignette: [96, 74, 44],
};
const mixTo = (c, to, t) => { const k = Math.min(1, Math.max(0, t)); for (let ch = 0; ch < 3; ch++) c[ch] += (to[ch] - c[ch]) * k; };
/**
 * The ground's color by climate, as mockup 3: dry ochre to meadow by moisture (lusher where wetter), heath where it's
 * cold (t: the climate's temperature there), sand where hot and dry and pale where it's polar (tl: with height's cooling
 * added back). Into out.
 */
function groundColor(m, t, tl, out) {
  for (let ch = 0; ch < 3; ch++) out[ch] = LOOK.dry[ch];
  mixTo(out, LOOK.meadow, (m - 0.14) * 4);
  mixTo(out, LOOK.lush, (m - 0.55) * 3);
  mixTo(out, LOOK.sand, Math.min(1, Math.max(0, (tl - 0.72) * 5)) * Math.min(1, Math.max(0, (0.3 - m) * 5)));
  mixTo(out, LOOK.heath, (0.3 - t) * 3);
  mixTo(out, LOOK.polar, (0.1 - tl) * 8);
  return out;
}

const hexColor = (s) => (typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s) ? [1, 3, 5].map((k) => parseInt(s.slice(k, k + 2), 16)) : null);

/**
 * How a layout is painted (options kept for side-by-sides): forest "speckle" (crowns as a fine speckle, Patrick's pick)
 * or "plain"; heights "refined" (the graph subdivided and a few solver steps run at the finer spacing, Patrick's pick)
 * or "blend" (tangent planes between the nodes).
 */
export const LOOK_OPTIONS = { forest: "speckle", heights: "refined" };

/** The relief raster's long side for a picture whose long side is `full` pixels: half of it, 800 to 2,730. */
export function reliefSide(full) {
  return full <= 800 ? Math.max(64, Math.round(full)) : Math.max(800, Math.min(2730, Math.round(full / 2)));
}

// Worked out once per layout and relief size, for every tile of a paint
const PREPARED = new WeakMap();
function prepared(L, pp) {
  const [MW, MH] = L.size.squares;
  const side = reliefSide(Math.max(MW, MH) * pp);
  // (rh covers the map's height at the raster's cell, which rw sets; drawn by that cell, so the outlines and the paint
  // agree)
  const rw = MW >= MH ? side : Math.max(16, Math.round((side * MW) / MH)), rh = Math.max(16, Math.ceil((rw * MH) / MW));
  let byKey = PREPARED.get(L);
  if (!byKey) { byKey = new Map(); PREPARED.set(L, byKey); }
  const key = `${rw}x${rh}:${L.look?.forest ?? LOOK_OPTIONS.forest}:${L.look?.heights ?? LOOK_OPTIONS.heights}`;
  if (!byKey.has(key)) byKey.set(key, prepare(L, rw, rh));
  return byKey.get(key);
}

/** The rasters, the smooth image and the outlines for a relief size. */
function prepare(L, rw, rh) {
  const seed = (Number.isFinite(Number(L.seed)) ? Number(L.seed) : 1) | 0;
  const land = (L.look?.heights ?? LOOK_OPTIONS.heights) === "refined" ? refineLand(L.land) : L.land;
  const R = landRasters(land, { rw, rh, seed });
  const image = smoothImage(R, L, seed);
  const toMap = (pts) => pts.map(([x, y]) => [x * R.cell, y * R.cell]);
  const coast = contours(R.landS, rw, rh, 0, 4).map((c) => ({ pts: toMap(smoothLine(c.pts, c.closed, 2)), closed: c.closed }));
  const lakeS = Float32Array.from(R.lakeS, (v, i) => (R.land[i] ? v : -1));
  const shores = contours(lakeS, rw, rh, 0, 4).map((c) => ({ pts: toMap(smoothLine(c.pts, c.closed, 2)), closed: c.closed }));
  // ripple rings offshore, at distances by the picture's size
  const ripples = [];
  for (const [d, a] of [[8, 0.22], [17, 0.14], [28, 0.08]]) {
    const dd = (d * Math.max(rw, rh)) / 3072;
    for (const c of contours(R.seaDist, rw, rh, Math.max(1.2, dd), 6)) ripples.push({ pts: toMap(smoothLine(c.pts, c.closed, 2)), closed: c.closed, alpha: a });
  }
  // rivers: smoothed, with a bend between nodes (wider where the ground is flat), widths by flow
  const f = L.land.frame, rivers = [];
  let fmax = 0, fmin = Infinity;
  for (const Rv of L.land.rivers) for (const p of Rv.points) { if (p[2] > fmax) fmax = p[2]; if (p[2] < fmin) fmin = p[2]; }
  const rnd = (a, b) => { let h = Math.imul(a | 0, 2654435761) ^ Math.imul(b | 0, 1597334677) ^ seed; h = Math.imul(h ^ (h >>> 15), 2246822507); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };
  for (const Rv of L.land.rivers) {
    const p = Rv.points.map(([x, y, fl, hh]) => [(x - f.margin) / f.mpu, (y - f.margin) / f.mpu, fl, hh]);
    const pts = [];
    for (let k = 0; k + 1 < p.length; k++) {
      const [x0, y0, f0, h0] = p[k], [x1, y1, f1, h1] = p[k + 1];
      pts.push([x0, y0, f0]);
      const dx = x1 - x0, dy = y1 - y0, ll = Math.sqrt(dx * dx + dy * dy) || 1e-9;
      const slope = Math.abs(h0 - h1) / (ll * f.mpu);
      const amp = (rnd(Rv.id * 977 + k, 3) * 2 - 1) * (slope < 0.00002 ? 0.28 : 0.1) * ll;
      pts.push([(x0 + x1) / 2 - (dy / ll) * amp, (y0 + y1) / 2 + (dx / ll) * amp, (f0 + f1) / 2]);
    }
    pts.push(p[p.length - 1].slice(0, 3));
    const sm = chaikin(pts, 3);
    rivers.push(sm.map(([x, y, fl]) => [x, y, fmax > fmin ? Math.max(0, Math.min(1, Math.log(fl / fmin) / Math.log(fmax / fmin))) : 0.5]));
  }
  // marsh and dune marks: where, from the biome raster
  const wetland = BIOMES.indexOf("wetland"), desert = BIOMES.indexOf("hot-desert");
  // the land without lakes, as a picture, so rivers are clipped to it
  const landImg = canvasOf(rw, rh);
  { const k = landImg.getContext("2d"), id = k.createImageData(rw, rh); for (let i = 0; i < rw * rh; i++) { id.data[4 * i + 3] = R.land[i] && !R.lake[i] ? 255 : 0; } k.putImageData(id, 0, 0); }
  const smoothCanvas = canvasOf(rw, rh);
  { const k = smoothCanvas.getContext("2d"), id = k.createImageData(rw, rh); id.data.set(image); k.putImageData(id, 0, 0); }
  // (only what the tiles read is kept: the rest of the rasters go)
  return { R: { rw, rh, cell: R.cell, land: R.land, lake: R.lake, biome: R.biome }, rw, rh, smoothCanvas, landImg, coast, shores, ripples, rivers, wetland, desert };
}

function canvasOf(w, h) {
  return new OffscreenCanvas(w, h);
}

/** The smooth image at relief resolution: RGBA bytes. */
function smoothImage(R, L, seed) {
  const { rw, rh } = R, N = rw * rh, side = Math.max(rw, rh);
  const forestLook = L.look?.forest ?? LOOK_OPTIONS.forest;
  const E = new Float32Array(N);
  for (let i = 0; i < N; i++) E[i] = R.land[i] ? Math.min(1, Math.max(0, R.z[i] / 1.1)) : 0;
  // heights for the light, and the light's strength by percentile: the 95th percentile of land slope at a fixed
  // shading strength, held between half and twice a base in true slope (a continent's slopes are gentler per mile
  // than a kingdom's; per pixel it scales with the raster, so every picture size of one map shades alike)
  const zl = new Float32Array(N);
  for (let i = 0; i < N; i++) zl[i] = R.land[i] ? Math.max(R.z[i], 0.0008) : Math.min(R.z[i], 0);
  const zlit = Float32Array.from(zl);
  boxBlur(zlit, rw, rh, Math.max(1, side / 1700));
  const slopes = [];
  for (let y = 1; y < rh - 1; y += 2) for (let x = 1; x < rw - 1; x += 2) {
    const i = y * rw + x;
    if (!R.land[i]) continue;
    const dx = (zlit[i + 1] - zlit[i - 1]) / 2, dy = (zlit[i + rw] - zlit[i - rw]) / 2;
    slopes.push(Math.sqrt(dx * dx + dy * dy));
  }
  slopes.sort((a, b) => a - b);
  const p95 = slopes[Math.floor(slopes.length * 0.95)] || 1e-4;
  const f = L.land.frame, base = (0.55 * Math.pow(Math.max(f.mapW, f.mapH), 0.75)) / R.cellMi;
  // (the strength itself gentler on bigger maps: a continent's lowlands read flat, its ranges carry the relief)
  const strength = 1.6 * Math.pow(240 / Math.max(240, Math.max(f.mapW, f.mapH)), 0.13);
  const kz = Math.min(2 * base, Math.max(0.5 * base, strength / p95));
  const gxA = new Float32Array(N), gyA = new Float32Array(N), slopeA = new Float32Array(N);
  for (let y = 1; y < rh - 1; y++) for (let x = 1; x < rw - 1; x++) {
    const i = y * rw + x;
    gxA[i] = ((zlit[i + 1] - zlit[i - 1]) / 2) * kz; gyA[i] = ((zlit[i + rw] - zlit[i - rw]) / 2) * kz;
    slopeA[i] = Math.sqrt(gxA[i] * gxA[i] + gyA[i] * gyA[i]);
  }
  // texture shading (differences of blurs at several scales: ridges light, valleys dark), gently
  const tex = new Float32Array(N);
  for (const [r, w] of [[1, 0.5], [3, 0.8], [8, 1], [20, 0.8]]) {
    const b = Float32Array.from(zl);
    boxBlur(b, rw, rh, Math.max(1, (r * side) / 1365));
    for (let i = 0; i < N; i++) tex[i] += w * (zl[i] - b[i]);
  }
  let tsd = 0, tn = 0;
  for (let i = 0; i < N; i += 3) if (R.land[i]) { tsd += tex[i] * tex[i]; tn++; }
  tsd = Math.sqrt(tsd / Math.max(1, tn)) || 1;
  // ambient occlusion: hollows darker
  const ao = Float32Array.from(zl);
  boxBlur(ao, rw, rh, Math.max(2, (9 * side) / 1536));
  // noise: the forest's broken edge, its crowns (a fine speckle), brush, the sea
  const edgeN = fbm(rw, rh, Math.max(4, side / 160), seed * 11 + 6, 0.7);
  const crowns = fbm(rw, rh, 1.6, seed * 11 + 5, 0.5, 2);
  const crownsB = fbm(rw, rh, Math.max(2, side / 600), seed * 11 + 9, 0.5, 2);
  const brush = fbm(rw, rh, Math.max(4, side / 120), seed * 11 + 7, 0.55);
  const seaN = fbm(rw, rh, Math.max(6, side / 80), seed * 11 + 8, 0.55);
  // climate, smoothed so its edges blend (moisture and warmth at the lowland: height's cooling added back)
  // (moisture 0 to 1 from the climate's rain, 1 being a rainy coastal lowland: scaled so a temperate land's middle rain
  // is meadow, as mockup 3's was)
  const moist = Float32Array.from(R.rain, (v) => Math.min(1, Math.max(0, v / 1.05)));
  const warm = Float32Array.from(R.temp);
  boxBlur(moist, rw, rh, Math.max(1, side / 300)); boxBlur(warm, rw, rh, Math.max(1, side / 300));
  // the forest: where it's wet, warm enough and not high (inside a painted zone, by the zone's biome), its edge
  // broken up, as mockup 3
  const wood = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (!R.land[i] || R.lake[i]) continue;
    const t = warm[i] + 0.6 * E[i];
    const byClimate = Math.min(1, Math.max(0, (moist[i] - 0.66) * 4)) * Math.min(1, Math.max(0, (0.42 - E[i]) * 6)) * smooth(0.1, 0.18, t);
    const v = R.zone[i] ? Math.min(1, Math.max(0, (R.forest[i] - 0.3) * 2.5)) * Math.min(1, Math.max(0, (0.5 - E[i]) * 6)) : byClimate;
    wood[i] = Math.min(1, Math.max(0, v * 1.5 + 0.35 * Math.tanh(1.3 * edgeN[i]) - 0.1));
  }
  boxBlur(wood, rw, rh, Math.max(1, side / 2400));
  // alluvium along big rivers, salt flats
  const allu = new Float32Array(N);
  const rivReach = Math.max(4, (40 * side) / 3072);
  for (let i = 0; i < N; i++) allu[i] = R.land[i] ? Math.max(0, 1 - R.riverDist[i] / rivReach) * (1 - smooth(0.05, 0.15, E[i])) : 0;
  boxBlur(allu, rw, rh, Math.max(1, side / 500));
  const saltB = Float32Array.from(R.salt);
  boxBlur(saltB, rw, rh, 1);
  // zones: their biome's color laid over, blended over a few miles with a ragged edge (painted intent, not an outline)
  const zoneColor = new Map();
  for (const z of L.land.zones ?? []) {
    const own = hexColor(z.color);
    if (own) zoneColor.set(z.index, own);
    else if (BIOME_CLIMATE[z.biome]) { const c = BIOME_CLIMATE[z.biome]; zoneColor.set(z.index, groundColor(Math.min(1, c.rain / 1.6), c.temp, c.temp, [0, 0, 0])); }
  }
  const zoneW = new Float32Array(N), zr = new Float32Array(N), zg = new Float32Array(N), zb = new Float32Array(N);
  if (zoneColor.size) {
    for (let i = 0; i < N; i++) { const c = zoneColor.get(R.zone[i]); if (c && R.land[i]) { zoneW[i] = 1; zr[i] = c[0]; zg[i] = c[1]; zb[i] = c[2]; } }
    for (const a of [zoneW, zr, zg, zb]) boxBlur(a, rw, rh, Math.max(3, side / 80));
    const edge = fbm(rw, rh, Math.max(6, side / 70), seed * 11 + 10, 0.6);
    for (let i = 0; i < N; i++) if (zoneW[i] > 0.001) { const k = smooth(0.05, 0.95, zoneW[i] + 0.3 * edge[i]) / zoneW[i]; zoneW[i] *= k; zr[i] *= k; zg[i] *= k; zb[i] *= k; }
  }
  // (how far inside a lake: its middle darker)
  const lakeDist = R.lake.some((v) => v) ? distance(rw, rh, (i) => !R.lake[i]) : new Float32Array(N);
  const lakeFar = Math.max(4, (36 * side) / 3072);
  const out = new Uint8ClampedArray(N * 4);
  const azs = [[315, 40, 0.62], [270, 60, 0.19], [0, 60, 0.19]].map(([az, alt, w]) => { const a = (az * Math.PI) / 180, e = (alt * Math.PI) / 180; return [Math.sin(a) * Math.cos(e), -Math.cos(a) * Math.cos(e), Math.sin(e), w]; });
  const flat = 0.62 * Math.sin((40 * Math.PI) / 180) + 0.38 * Math.sin((60 * Math.PI) / 180);
  const col = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    if (!R.land[i]) {
      // the sea: shallows to deep by its depth, brushed
      const t = R.depth[i], k = 1 + 0.035 * Math.tanh(seaN[i]);
      for (let ch = 0; ch < 3; ch++) col[ch] = (LOOK.shallow[ch] + (LOOK.deep[ch] - LOOK.shallow[ch]) * t) * k;
    } else if (R.lake[i]) {
      const t = Math.min(1, lakeDist[i] / lakeFar);
      for (let ch = 0; ch < 3; ch++) col[ch] = LOOK.lakeRim[ch] + (LOOK.lakeDeep[ch] - LOOK.lakeRim[ch]) * t;
    } else {
      const e = E[i], slope = slopeA[i], zk = 1 - Math.min(1, zoneW[i] * 1.2);
      // the ground by climate: dry ochre to meadow by moisture, heath where it's cold, sand where hot and dry
      groundColor(moist[i], warm[i], warm[i] + 0.6 * e, col);
      if (zoneW[i] > 0.01) { const k = Math.min(1, zoneW[i] * 1.2), s = 1 / zoneW[i]; col[0] += (zr[i] * s - col[0]) * k; col[1] += (zg[i] * s - col[1]) * k; col[2] += (zb[i] * s - col[2]) * k; }
      // bare rock high and on the steepest ground (slope against the land's own 95th percentile, so it doesn't follow
      // the light's exaggeration; not inside a painted zone)
      const sr = slope / 1.6;
      const rk = Math.min(1, Math.max(0, (e - 0.45) * 3.5 + (sr - 1.1) * 0.7)) * zk;
      for (let ch = 0; ch < 3; ch++) col[ch] += (LOOK.rock[ch] - col[ch]) * rk;
      // alluvium and salt flats
      const al = allu[i] * 0.3, sl = saltB[i] * 0.9;
      for (let ch = 0; ch < 3; ch++) { col[ch] += (LOOK.alluvium[ch] - col[ch]) * al; col[ch] += (LOOK.salt[ch] - col[ch]) * sl; }
      // the forest canopy: its own dark green (bluer where it's cold), a speckle of crowns, its edge broken
      const wd = wood[i] * (1 - rk);
      if (wd > 0) {
        const cold = smooth(0.4, 0.2, warm[i] + 0.6 * e);
        const sp = forestLook === "speckle" ? 0.09 * crowns[i] + 0.05 * crownsB[i] : 0.04 * crownsB[i];
        for (let ch = 0; ch < 3; ch++) col[ch] += ((LOOK.forest[ch] + LOOK.forestCold[ch] * cold) * (1 + sp) - col[ch]) * wd;
      }
      // snow on high, cold ground, less on steep faces
      const snow = Math.min(1, Math.max(0, (e - 0.6) * 6 + (0.18 - R.temp[i]) * 4)) * Math.min(1, Math.max(0, 1.5 - sr * 0.45)) * zk * smooth(0.25, 0.4, e);
      for (let ch = 0; ch < 3; ch++) col[ch] += (LOOK.snow[ch] - col[ch]) * snow;
      // brush
      const bk = 1 + 0.04 * Math.tanh(brush[i]);
      for (let ch = 0; ch < 3; ch++) col[ch] *= bk;
      // painted light: warm in the light, cool and violet in the shade; texture shading; occlusion
      let hs = 0;
      const gx = gxA[i], gy = gyA[i], nrm = Math.sqrt(gx * gx + gy * gy + 1);
      for (const [sx, sy, sz, w] of azs) hs += w * Math.max(0, Math.min(1, (gx * -sx + gy * -sy + sz) / nrm));
      // (aerial perspective: the light strongest on the heights, soft on the lowlands)
      const sh = (hs - flat) * (0.35 + 0.85 * smooth(0.02, 0.5, e)), tone = snow > 0.4 ? LOOK.coolSnow : LOOK.cool;
      for (let ch = 0; ch < 3; ch++) col[ch] += Math.max(0, sh) * LOOK.warm[ch] - Math.max(0, -sh) * tone[ch] * 1.35;
      const tk = 1 + 0.06 * Math.tanh(tex[i] / (tsd * 2.2)) * (0.1 + 0.9 * smooth(0.04, 0.35, e));
      const aok = Math.min(1.04, Math.max(0.65, 1 - 7 * (ao[i] - zl[i])));
      for (let ch = 0; ch < 3; ch++) col[ch] *= tk * aok;
    }
    out[4 * i] = col[0]; out[4 * i + 1] = col[1]; out[4 * i + 2] = col[2]; out[4 * i + 3] = 255;
  }
  return out;
}

/** Paints one tile (ctx as every style's: g, W, H, x0, y0 in map units, pp, layout, mask, progress). */
export function paint(ctx) {
  const { g, W, H, x0, y0, pp, layout: L, progress = () => {} } = ctx;
  const P = { ...PALETTE };
  const [MW, MH] = L.size.squares;
  const X = (x) => (x - x0) * pp, Y = (y) => (y - y0) * pp;
  const tx1 = x0 + W / pp, ty1 = y0 + H / pp;
  const near = (pts, pad) => { for (const [x, y] of pts) if (x >= x0 - pad && y >= y0 - pad && x <= tx1 + pad && y <= ty1 + pad) return true; return false; };
  progress(0.02, "Rasters");
  const S = prepared(L, pp);
  const k = (MW * pp) / S.rw; // (output pixels a relief pixel)
  g.lineCap = "round"; g.lineJoin = "round";
  // paper past the map's edge, then the smooth image scaled up
  g.fillStyle = rgb(LOOK.paper); g.fillRect(0, 0, W, H);
  progress(0.4, "Painting");
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.drawImage(S.smoothCanvas, 0, 0, S.rw, S.rh, X(0), Y(0), S.rw * S.R.cell * pp, S.rh * S.R.cell * pp);
  const line = (pts, closed) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); if (closed) g.closePath(); };
  const outPx = Math.max(MW, MH) * pp;
  // ripple rings offshore
  progress(0.55, "The sea");
  g.lineWidth = Math.max(1, outPx / 3072);
  for (const r of S.ripples) { if (!near(r.pts, 1)) continue; g.strokeStyle = rgb(LOOK.ripple, r.alpha); line(r.pts, r.closed); g.stroke(); }
  // marsh tufts and dune ripples, at full size
  marks(ctx, S, k);
  // rivers, clipped to the land (not the sea or lakes)
  progress(0.65, "Rivers");
  const m = ctx.mask;
  if (m && S.rivers.length) {
    const mg = m.getContext("2d");
    mg.setTransform(1, 0, 0, 1, 0, 0); mg.globalCompositeOperation = "source-over"; mg.clearRect(0, 0, W, H);
    // (stroked opaque, then laid on at the river's alpha, so the joints between segments don't bead)
    mg.lineCap = "round"; mg.lineJoin = "round"; mg.strokeStyle = rgb(LOOK.river);
    const scale = outPx / 3072, mul = (L.land.frame.scale === "kingdom" ? 1.15 : 1) * scale;
    for (const rv of S.rivers) {
      if (!near(rv, 1)) continue;
      for (let q = 1; q < rv.length; q++) {
        const t = rv[q][2];
        mg.lineWidth = Math.max(0.8, (0.6 + 6.4 * Math.pow(t, 1.35)) * mul);
        mg.beginPath(); mg.moveTo(X(rv[q - 1][0]), Y(rv[q - 1][1])); mg.lineTo(X(rv[q][0]), Y(rv[q][1])); mg.stroke();
      }
    }
    mg.globalCompositeOperation = "destination-in";
    mg.imageSmoothingEnabled = true;
    mg.drawImage(S.landImg, 0, 0, S.rw, S.rh, X(0), Y(0), S.rw * S.R.cell * pp, S.rh * S.R.cell * pp);
    mg.globalCompositeOperation = "source-over";
    g.globalAlpha = 0.92; g.drawImage(m, 0, 0); g.globalAlpha = 1;
  }
  // the coast's ink (opaque on the scratch canvas, laid on at its alpha, as the rivers) and lake rims
  progress(0.75, "Coasts");
  const ink = m ? m.getContext("2d") : g;
  if (m) { ink.setTransform(1, 0, 0, 1, 0, 0); ink.globalCompositeOperation = "source-over"; ink.clearRect(0, 0, W, H); ink.lineCap = "round"; ink.lineJoin = "round"; }
  ink.strokeStyle = rgb(LOOK.coast, m ? 1 : 0.72);
  const inkW = Math.max(1.1, outPx / 1700);
  const inkLine = (pts) => { ink.beginPath(); pts.forEach(([x, y], i) => (i ? ink.lineTo(X(x), Y(y)) : ink.moveTo(X(x), Y(y)))); };
  for (const c of S.coast) {
    if (!near(c.pts, 2)) continue;
    // (in runs, each a little wider or thinner, as a pen's line)
    const step = 24;
    for (let s = 0; s < c.pts.length - 1; s += step) {
      const run = c.pts.slice(s, Math.min(c.pts.length, s + step + 1));
      if (c.closed && s + step >= c.pts.length - 1) run.push(c.pts[0]);
      const hsh = Math.sin((c.pts[s][0] * 12.9898 + c.pts[s][1] * 78.233) * 1.7) * 43758.5453;
      ink.lineWidth = inkW * (0.8 + 0.4 * (hsh - Math.floor(hsh)));
      inkLine(run); ink.stroke();
    }
  }
  if (m) { g.globalAlpha = 0.72; g.drawImage(m, 0, 0); g.globalAlpha = 1; }
  g.strokeStyle = rgb(LOOK.lakeInk, 0.55); g.lineWidth = Math.max(1, inkW * 0.6);
  for (const s of S.shores) { if (!near(s.pts, 1)) continue; line(s.pts, s.closed); g.stroke(); }
  // roads and places (markers until the towns and roads style is picked)
  progress(0.85, "Places");
  const items = L.items ?? [];
  drawRoads(ctx, items.filter((i) => i.kind === "way"), P);
  drawPlaces(ctx, items.filter((i) => i.kind === "place"), P);
  // paper: a vignette at the map's edge and grain
  paper(ctx, MW, MH);
  if (L.dressing) dress(ctx, P, { miles: true });
  progress(1, "Done");
}

/** Marsh tufts and dune ripples, at full size, where the biome raster says. */
function marks(ctx, S, k) {
  const { g, W, H, x0, y0, pp } = ctx;
  const { R } = S;
  const step = Math.max(5, Math.round(Math.max(3, k * 2.2)));
  const cellPx = pp * R.cell; // (output pixels a relief pixel)
  const hsh = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
  g.lineWidth = Math.max(0.8, step / 9);
  // (on a grid anchored to the map, so tiles join)
  const gx0 = Math.floor((x0 * pp) / step) * step - x0 * pp, gy0 = Math.floor((y0 * pp) / step) * step - y0 * pp;
  for (let py = gy0; py < H; py += step) for (let px = gx0; px < W; px += step) {
    const ax = Math.round(px + x0 * pp), ay = Math.round(py + y0 * pp);
    const ox = px + hsh(ax, ay) * step, oy = py + hsh(ay, ax) * step;
    const rx = Math.floor((x0 * pp + ox) / cellPx), ry = Math.floor((y0 * pp + oy) / cellPx);
    if (rx < 0 || ry < 0 || rx >= R.rw || ry >= R.rh) continue;
    const i = ry * R.rw + rx;
    if (!R.land[i] || R.lake[i]) continue;
    const b = R.biome[i];
    if (b === S.wetland) {
      if (hsh(ax + 0.5, ay) > 0.55) continue;
      const s = step * 0.45;
      g.strokeStyle = "rgba(62,84,60,0.45)";
      g.beginPath();
      for (const dx of [-0.35, 0, 0.35]) { g.moveTo(ox + dx * s * 0.6, oy); g.lineTo(ox + dx * s, oy - s * (0.7 + Math.abs(dx))); }
      g.moveTo(ox - s * 0.5, oy); g.lineTo(ox + s * 0.5, oy); g.stroke();
    } else if (b === S.desert) {
      if (hsh(ay + 0.5, ax) > 0.35) continue;
      const s = step * 0.8;
      g.strokeStyle = "rgba(150,110,60,0.28)";
      g.beginPath(); g.moveTo(ox - s, oy); g.quadraticCurveTo(ox, oy - s * 0.45, ox + s, oy); g.stroke();
    }
  }
}

/** A vignette at the map's edge and paper grain, in map units so tiles join. */
function paper(ctx, MW, MH) {
  const { g, W, H, x0, y0, pp } = ctx;
  let id;
  try { id = g.getImageData(0, 0, W, H); } catch { return; }
  const d = id.data, edge = (Math.max(MW, MH) * 160) / 3072, V = LOOK.vignette;
  for (let y = 0; y < H; y++) {
    const my = y0 + (y + 0.5) / pp;
    for (let x = 0; x < W; x++) {
      const mx = x0 + (x + 0.5) / pp;
      const dist = Math.min(mx, MW - mx, my, MH - my);
      const v = Math.pow(Math.min(1, Math.max(0, dist / edge)), 0.7);
      const gx = Math.round(mx * pp), gy = Math.round(my * pp);
      let h = Math.imul(gx, 374761393) ^ Math.imul(gy, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177);
      const grain = (((h ^ (h >>> 16)) >>> 0) / 4294967296 - 0.5) * 6;
      const o = 4 * (y * W + x), a = 0.8 + 0.2 * v, b = (1 - v) * 0.09;
      d[o] = d[o] * a + V[0] * b + grain; d[o + 1] = d[o + 1] * a + V[1] * b + grain; d[o + 2] = d[o + 2] * a + V[2] * b + grain;
    }
  }
  g.putImageData(id, 0, 0);
}
