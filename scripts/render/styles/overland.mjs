/**
 * The painted overland style: generated land (layout/overland.mjs) painted as a hand-painted fantasy map, needing no
 * art. The smooth parts (color by climate converging to browns, grays and snow with height; Imhof's warm light and cool
 * shade; texture shading; the sea by its depth; lakes) are worked out once at relief resolution (about a third of the
 * picture's size) and scaled up; what must be crisp (ripple rings, the coast's ink, rivers, lake rims, marsh and dune
 * marks, places, roads, the furniture, paper grain) is drawn at full size in each tile.
 */
import { PALETTE } from "./palette.mjs";
import { dress, paintKey } from "./furniture.mjs";
import { keyOf } from "../../core/dressing.mjs";
import { drawAtlas, crownMark, CROWN_LIFT } from "./atlas.mjs";
import { landRasters, boxBlur, fbm, chaikin, distance, nodeRaster } from "../../core/land/raster.mjs";
import { refineLand } from "../../core/land/refine.mjs";
import { contours, smoothLine } from "../../core/land/vector.mjs";
import { BIOMES, BIOME_CLIMATE } from "../../core/land/biome.mjs";
import { LAPSE } from "../../core/land/climate.mjs";
import { SETTLED } from "../../core/land/settled.mjs";

export const MAX_BLUR = 0.5;
export const rolesFor = () => [];

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// (the continental shelf's width in relief pixels: about 2% of the map's long side, narrower off a steep coast)
const shelfPx = (L, R) => Math.max(2, (0.018 * Math.max(L.land.frame.mapW, L.land.frame.mapH)) / R.cellMi);
const rgb = ([r, g, b], a = 1) => (a === 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`);

/** The look's colors (mockup 3's palette: clear meadows and ochres, a canopy of its own, warm rock under violet shade). */
const LOOK = {
  dry: [206, 178, 116], meadow: [168, 180, 86], lush: [124, 158, 70], heath: [176, 178, 150], sand: [222, 196, 138], polar: [226, 228, 222],
  forest: [92, 122, 72], forestCold: [-14, -8, 6], conifer: [58, 92, 76], rainforest: [46, 108, 54], drywood: [100, 120, 62],
  bareWood: [124, 108, 90], autumn: [[178, 112, 50], [154, 82, 46], [192, 152, 62]], spring: [150, 186, 80], straw: [186, 172, 128],
  farm: [196, 184, 112], pasture: [138, 166, 82], valley: [172, 192, 104],
  fields: { summer: [[208, 186, 102], [146, 166, 80]], spring: [[150, 184, 86], [122, 156, 72]], autumn: [[198, 174, 108], [148, 118, 82]], winter: [[182, 172, 142], [152, 140, 112]] },
  ice: [214, 226, 232], riverIce: [178, 198, 212], riverIceCase: [92, 108, 120], rock: [158, 142, 116], snow: [248, 248, 244], alluvium: [178, 184, 120], salt: [236, 230, 212],
  warm: [96, 76, 34], cool: [62, 60, 34], coolSnow: [80, 70, 40],
  shallow: [172, 206, 198], deep: [66, 112, 128], lakeRim: [96, 172, 196], lakeDeep: [38, 104, 152],
  turquoise: [104, 204, 198], reef: [238, 232, 204], playa: [200, 204, 194], beach: [232, 216, 172], cliff: [112, 98, 86], badland: [176, 108, 74], reg: [168, 148, 116], riverDry: [138, 150, 140],
  rocks: [[196, 188, 166], [184, 134, 92], [158, 146, 140], [102, 98, 96]],
  ripple: [36, 66, 76], coast: [50, 42, 32], river: [84, 146, 188], riverCase: [30, 46, 56], lakeInk: [50, 70, 80], paper: [236, 226, 200], vignette: [96, 74, 44],
};
/** The rock families' colors (limestone, sandstone, granite, basalt), for tests. */
export const LOOK_ROCKS = LOOK.rocks;
/**
 * Snow from the air's warmth at a height: the climate's warmth (0 to 1) taken back to sea level, as the year's mean in
 * degrees Fahrenheit (about 79 by the equator, 52 at 45 degrees, 38 at 60, 21 by the pole), cooled by a real lapse rate
 * (3.6 degrees a thousand feet) at the height in feet (a land unit is high mountains, about 5 km). Snow starts where
 * the mean is below 26 F and covers the ground below 16 F: a snow line near 15,000 to 17,500 ft by the equator, 7,000 to
 * 10,000 ft at 45 degrees, at the sea near the poles. And it needs the wet (moist 0 to 1): a dry plateau stays bare.
 */
export const FT_PER_UNIT = 16400;
/**
 * The air at a place, [mean, swing] in degrees Fahrenheit: the year's mean at its height (as snowAt reads it) and how
 * far the coldest month falls below it (and the warmest rises above), from its latitude (read back from the warmth at
 * sea level): a few degrees in the tropics, about 17 at 45 degrees, 23 at 60.
 */
export function airF(temp, z) {
  const zz = Math.max(0, z), sea = temp + LAPSE * zz, lat = Math.min(90, Math.max(0, 78 - 62 * Math.min(1, sea)));
  return [21 + 58 * sea - (3.6 * zz * FT_PER_UNIT) / 1000, Math.max(3, 0.45 * (lat - 8))];
}
/**
 * Snow lying in each season, past the year-round snow (the mean below 26 F, all of it below 16 F): [how much of the
 * swing below the mean the season's air is, where snow starts, where it covers the ground]. Winter's is the snow of the
 * coldest month, lying where it's below about freezing; spring keeps the high snowpack; autumn has the first snow on
 * the heights. Summer is the year-round snow alone.
 */
export const SEASON_SNOW = { winter: [1, 34, 26], spring: [0.45, 30, 20], autumn: [0.25, 28, 18] };
export function snowAt(temp, z, moist = 1, season = "summer") {
  const [f, swing] = airF(temp, z);
  return snowOfAir(f, swing, moist, season);
}
/** snowAt for air already worked out (airF's mean and swing). */
export function snowOfAir(f, swing, moist, season) {
  const s = SEASON_SNOW[season];
  const lying = s ? Math.max(smooth(26, 16, f), smooth(s[1], s[2], f - s[0] * swing)) : smooth(26, 16, f);
  return lying * smooth(0.08, 0.4, moist);
}
/** How frozen a lake or river is (0 to 1): in winter, where the coldest month is below about 22 F. */
export function iceAt(temp, z, season = "summer") {
  if (season !== "winter") return 0;
  const [f, swing] = airF(temp, z);
  return smooth(26, 18, f - swing);
}
/**
 * How much of a forest's texture shows (0 to 1) on a map so many miles on its long side: a speckle of crowns on a
 * kingdom's map (the whole of it to about 400 miles), less on a realm's, a smooth tone on a continent's (1,500 miles
 * and more), the same at every picture size. With cellMi (miles a pixel), how much of its clumps and glades show: as
 * much, where the picture is big enough to draw them (a clump is about a mile and a fifth; under four pixels, noise).
 */
export const forestTexture = (miles, cellMi = 0) => smooth(1500, 400, miles) * (cellMi > 0 ? smooth(2, 4, 1.2 / cellMi) : 1);
/** A field's size in raster pixels (long, short): a few pixels each, so fields read as a texture, not as plots. */
export const FIELD_PX = [5, 3];
/**
 * The field a raster pixel i is in: [along, across] its nearest road, counted in fields from the road's start (every
 * other row of fields offset by half, as strips are). ra: roadAngles.
 */
export function fieldCell(i, rw, ra) {
  const a = ra.ang[i], x = (i % rw) - ra.ox[i], y = (i - (i % rw)) / rw - ra.oy[i], ca = Math.cos(a), sa = Math.sin(a);
  const cu = Math.floor((ra.os[i] + x * ca + y * sa) / FIELD_PX[0]);
  return [cu, Math.floor((-x * sa + y * ca) / FIELD_PX[1] + (cu & 1) * 0.5)];
}
/** Which of two tones a field is (0 to 1), by its cell. */
const fieldTone = (cu, cv, seed) => { let h = Math.imul(cu | 0, 374761393) ^ Math.imul(cv | 0, 668265263) ^ Math.imul(seed | 0, 2246822519); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
/**
 * Each raster pixel's nearest road stretch, for fields lined up with it: { ang (its direction, radians), ox, oy (where
 * it starts, in raster pixels), os (how far along its road that is, in raster pixels) }: the fields are counted from
 * the road's start, so their rows run on unbroken around its bends. The roads drawn into the raster, then the nearest
 * drawn pixel's stretch carried out by a two-pass chamfer. A map with no roads: east and west from the corner.
 */
export function roadAngles(L, R) {
  const { rw, rh, cell } = R, N = rw * rh, ang = new Float32Array(N), ox = new Float32Array(N), oy = new Float32Array(N), os = new Float32Array(N), d = new Float32Array(N).fill(1e9);
  for (const it of L.items ?? []) {
    if (it.kind !== "way" || !Array.isArray(it.path)) continue;
    let run = 0;
    for (let m = 1; m < it.path.length; m++) {
      const [ax, ay] = it.path[m - 1], [bx, by] = it.path[m], a = Math.atan2(by - ay, bx - ax), len = Math.hypot(bx - ax, by - ay) / cell, k = Math.max(1, Math.ceil(len * 2));
      for (let q = 0; q <= k; q++) {
        const x = Math.floor((ax + ((bx - ax) * q) / k) / cell), y = Math.floor((ay + ((by - ay) * q) / k) / cell);
        if (x < 0 || y < 0 || x >= rw || y >= rh) continue;
        const i = y * rw + x; d[i] = 0; ang[i] = a; ox[i] = ax / cell; oy[i] = ay / cell; os[i] = run;
      }
      run += len;
    }
  }
  const D2 = Math.SQRT2;
  const take = (i, j, step) => { if (d[j] + step < d[i]) { d[i] = d[j] + step; ang[i] = ang[j]; ox[i] = ox[j]; oy[i] = oy[j]; os[i] = os[j]; } };
  for (let i = 0; i < N; i++) {
    const x = i % rw, y = (i - x) / rw;
    if (x > 0) take(i, i - 1, 1);
    if (y > 0) { take(i, i - rw, 1); if (x > 0) take(i, i - rw - 1, D2); if (x < rw - 1) take(i, i - rw + 1, D2); }
  }
  for (let i = N - 1; i >= 0; i--) {
    const x = i % rw, y = (i - x) / rw;
    if (x < rw - 1) take(i, i + 1, 1);
    if (y < rh - 1) { take(i, i + rw, 1); if (x > 0) take(i, i + rw - 1, D2); if (x < rw - 1) take(i, i + rw + 1, D2); }
  }
  return { ang, ox, oy, os };
}
/** An autumn leaf's color for a patch noise n (about -1.7 to 1.7): russet where it's low, gold where it's high, orange between. Into out. */
export function autumnLeaf(n, out) {
  for (let ch = 0; ch < 3; ch++) out[ch] = LOOK.autumn[0][ch];
  mixTo(out, LOOK.autumn[1], smooth(-0.1, -0.6, n)); mixTo(out, LOOK.autumn[2], smooth(0.1, 0.6, n));
  return out;
}
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

/** The key's land cover swatches: each the color its cover is painted, near enough to find on the map. */
const COVER_SWATCH = { farmland: LOOK.farm, broadleaf: LOOK.forest, conifer: LOOK.conifer, rainforest: LOOK.rainforest, grassland: LOOK.meadow, desert: LOOK.dry, marsh: [124, 140, 100], tundra: LOOK.heath, snow: LOOK.snow };
/**
 * How a layout is painted (options kept for side-by-sides): forest "speckle" (crowns as a fine speckle, the default)
 * or "plain"; heights "refined" (the graph subdivided and a few solver steps run at the finer spacing, the default)
 * or "blend" (tangent planes between the nodes).
 */
export const LOOK_OPTIONS = { forest: "speckle", heights: "refined" };

/** The relief raster's long side for a picture whose long side is `full` pixels: half of it, 800 to 2,730. */
export function reliefSide(full) {
  return full <= 800 ? Math.max(64, Math.round(full)) : Math.max(800, Math.min(2730, Math.round(full / 2)));
}

// Worked out once per land and relief size, for every tile of a paint (and every layout of one land: an edit to labels
// keeps them all). What they read is the land, the seed, the season, the look and size, and the places and roads
// (settled land); an edit to places or roads keeps the land's own rasters, outlines and rivers at a preview's size
// and paints the image again.
const PREPARED = new WeakMap(), RASTERS = new WeakMap();
// (the land's own rasters are kept for pictures up to this many relief pixels: a preview's; a render's are let go)
const KEEP_RASTERS = 1600 * 1600;
export function prepared(L, pp) {
  const [MW, MH] = L.size.squares;
  const side = reliefSide(Math.max(MW, MH) * pp);
  // (rh covers the map's height at the raster's cell, which rw sets; drawn by that cell, so the outlines and the paint
  // agree)
  const rw = MW >= MH ? side : Math.max(16, Math.round((side * MW) / MH)), rh = Math.max(16, Math.ceil((rw * MH) / MW));
  let byKey = PREPARED.get(L.land);
  if (!byKey) { byKey = new Map(); PREPARED.set(L.land, byKey); }
  const baseKey = `${rw}x${rh}:${MW}x${MH}:${L.seed}:${L.season ?? "summer"}:${L.look?.forest ?? LOOK_OPTIONS.forest}:${L.look?.heights ?? LOOK_OPTIONS.heights}`;
  const key = `${baseKey}:${L.settledKey ?? ""}`;
  if (!byKey.has(key)) {
    // (two kept at most, a preview's and a render's; an older one let go, its canvases freed)
    while (byKey.size >= 2) { const [k0, old] = byKey.entries().next().value; byKey.delete(k0); for (const v of Object.values(old)) if (v && typeof v === "object" && "width" in v && "getContext" in v) { v.width = 1; v.height = 1; } }
    let kept = RASTERS.get(L.land);
    if (!kept) { kept = new Map(); RASTERS.set(L.land, kept); }
    let base = kept.get(baseKey);
    if (!base) {
      base = landPart(L, rw, rh);
      if (rw * rh <= KEEP_RASTERS) { while (kept.size >= 2) kept.delete(kept.keys().next().value); kept.set(baseKey, base); }
    }
    byKey.set(key, prepare(L, base));
  }
  return byKey.get(key);
}

/** How far a flood plain's marsh reaches from a big river (miles), and how flat its ground (feet a mile at most). */
export const FLOOD = { miles: 2.5, ftPerMile: 25 };
/**
 * Flood plains: marsh on the flat floor beside a big river, its edge broken by noise, where the ground isn't dry,
 * frozen, settled (cleared land beside a river is meadow and fields) or inside a painted zone. Sets those pixels'
 * biome to wetland, so they are painted and marked as marsh. Changes R.biome in place.
 */
export function floodMarsh(R, settled, seed) {
  const { rw, rh, cellMi, z, land, lake, riverDist, biome } = R, N = rw * rh;
  const wet = BIOMES.indexOf("wetland"), dry = new Set(["hot-desert", "salt-flat", "cold-steppe", "glacier", "tundra"].map((b) => BIOMES.indexOf(b)));
  const reach = FLOOD.miles / cellMi, n = fbm(rw, rh, Math.max(2, reach * 1.5), seed * 5 + 29, 0.55);
  const ft = 16400 / (2 * cellMi);
  for (let i = 0; i < N; i++) {
    if (!land[i] || lake[i] || R.zone?.[i] || dry.has(biome[i]) || biome[i] === wet || (settled && settled[i] >= SETTLED - 0.05)) continue;
    if (riverDist[i] > reach * (0.6 + 0.5 * Math.tanh(n[i]))) continue;
    const x = i % rw, y = (i - x) / rw;
    if (x < 1 || y < 1 || x >= rw - 1 || y >= rh - 1) continue;
    const gx = (z[i + 1] - z[i - 1]) * ft, gy = (z[i + rw] - z[i - rw]) * ft;
    if (gx * gx + gy * gy < FLOOD.ftPerMile * FLOOD.ftPerMile) biome[i] = wet;
  }
}

/** The land's own part for a relief size, which places and roads don't change: its rasters, outlines and rivers. */
function landPart(L, rw, rh) {
  const seed = (Number.isFinite(Number(L.seed)) ? Number(L.seed) : 1) | 0;
  const land = (L.look?.heights ?? LOOK_OPTIONS.heights) === "refined" ? refineLand(L.land) : L.land;
  const R = landRasters(land, { rw, rh, seed });
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
    const p = Rv.points.map(([x, y, fl, hh, dy]) => [(x - f.margin) / f.mpu, (y - f.margin) / f.mpu, fl, hh, dy ?? 0]);
    const pts = [];
    for (let k = 0; k + 1 < p.length; k++) {
      const [x0, y0, f0, h0, d0] = p[k], [x1, y1, f1, h1, d1] = p[k + 1];
      pts.push([x0, y0, f0, d0]);
      const dx = x1 - x0, dy = y1 - y0, ll = Math.sqrt(dx * dx + dy * dy) || 1e-9;
      const slope = Math.abs(h0 - h1) / (ll * f.mpu);
      const amp = (rnd(Rv.id * 977 + k, 3) * 2 - 1) * (slope < 0.00002 ? 0.28 : 0.1) * ll;
      pts.push([(x0 + x1) / 2 - (dy / ll) * amp, (y0 + y1) / 2 + (dx / ll) * amp, (f0 + f1) / 2, (d0 + d1) / 2]);
    }
    { const e = p[p.length - 1]; pts.push([e[0], e[1], e[2], e[4]]); }
    const sm = chaikin(pts, 3);
    const line = sm.map(([x, y, fl]) => [x, y, fmax > fmin ? Math.max(0, Math.min(1, Math.log(fl / fmin) / Math.log(fmax / fmin))) : 0.5]);
    // (its id, for its name; each point's distance from its source in map units, for the taper; and whether it
    // starts small, at a spring: one that starts where a lake spills already carries the lake's water)
    line.id = Rv.id;
    line.spring = !(Rv.points[0][2] > 3 * (L.land.threshold ?? Infinity));
    let run = 0;
    line.from = line.map((q, k) => (run += k ? Math.hypot(q[0] - line[k - 1][0], q[1] - line[k - 1][1]) : 0));
    // (one that runs out on dry land narrows to its end)
    line.toDry = Rv.ends === "dry";
    // (how frozen it is at each point, in a cold winter)
    line.ice = line.map(([x, y]) => { const i = Math.min(rh - 1, Math.max(0, Math.floor(y / R.cell))) * rw + Math.min(rw - 1, Math.max(0, Math.floor(x / R.cell))); return iceAt(R.temp[i], R.z[i], L.season ?? "summer"); });
    // (where its bed runs dry, as the land marked it)
    line.dry = sm.map((q) => (q[3] > 0.5 ? 1 : 0));
    rivers.push(line);
  }
  return { R, seed, rw, rh, coast, shores, ripples, rivers };
}

/** The smooth image and what the tiles read, from the land's part and the layout's settled land. */
function prepare(L, base) {
  const { seed, rw, rh, coast, shores, ripples, rivers } = base;
  // (settled land drawn from the layout's nodes: it follows the places and roads, not the land; flood plain marsh on a
  // copy of the biomes, so the land's part stays as it was)
  const settled = L.settled?.length === L.land.n ? nodeRaster(L.land, L.settled, rw, rh) : null;
  const R = { ...base.R, biome: Uint8Array.from(base.R.biome) };
  floodMarsh(R, settled, seed);
  const { rgba: image, bare, erg, shelfR } = smoothImage(R, L, seed, { settled });
  // reefs: the painted shelf's edge in warm seas, as runs of its contour where the water is warm (turquoise shows)
  const reefs = [], toMap = (pts) => pts.map(([x, y]) => [x * R.cell, y * R.cell]);
  if (shelfR) for (const c of contours(shelfR, rw, rh, 1, 8)) {
    let run = [];
    for (const [x, y] of smoothLine(c.pts, c.closed, 2)) {
      const i = Math.min(rh - 1, Math.max(0, Math.floor(y))) * rw + Math.min(rw - 1, Math.max(0, Math.floor(x)));
      if (!R.land[i] && R.temp[i] > 0.8) run.push([x, y]); else { if (run.length > 3) reefs.push(toMap(run)); run = []; }
    }
    if (run.length > 3) reefs.push(toMap(run));
  }
  // marsh and dune marks: where, from the biome raster
  const wetland = BIOMES.indexOf("wetland"), desert = BIOMES.indexOf("hot-desert");
  // the land without lakes, as a picture, so rivers are clipped to it
  const landImg = canvasOf(rw, rh);
  { const k = landImg.getContext("2d"), id = k.createImageData(rw, rh); for (let i = 0; i < rw * rh; i++) { id.data[4 * i + 3] = R.land[i] && !R.lake[i] ? 255 : 0; } k.putImageData(id, 0, 0); }
  const smoothCanvas = canvasOf(rw, rh);
  { const k = smoothCanvas.getContext("2d"), id = k.createImageData(rw, rh); id.data.set(image); k.putImageData(id, 0, 0); }
  // (only what the tiles read is kept: the rest of the rasters go)
  return { R: { rw, rh, cell: R.cell, land: R.land, lake: R.lake, biome: R.biome, bare, erg: (L.land.gen ?? 0) >= 3 ? erg : null }, rw, rh, smoothCanvas, landImg, coast, shores, ripples, reefs, rivers, wetland, desert };
}

/**
 * The river segments to stroke, [x0, y0, x1, y1, width, ice, dry] in map units and output pixels: width by flow (t, 0 to 1),
 * at least a floor on a named river, tapered over the first stretch from its source (a spring, not a lake's outlet) and
 * over the last before a dry end,
 * wider in spring when the rivers run high; ice 0 to 1, how frozen it is; dry 1 where the bed runs dry. keep(line): whether
 * a line is drawn.
 */
export function riverSegs(L, S, outPx, keep) {
  const mul = (L.land.frame.scale === "kingdom" ? 1.15 : 1) * (outPx / 3072) * (L.season === "spring" ? SPRING_RIVERS : 1);
  const named = namedRivers(L), taper = 0.03 * Math.max(L.size.squares[0], L.size.squares[1]), out = [];
  for (const rv of S.rivers) {
    if (!keep(rv)) continue;
    const floor = named.has(rv.id) ? 2.4 * mul : 0;
    for (let q = 1; q < rv.length; q++) {
      const k = (rv.spring === false ? 1 : 0.35 + 0.65 * smooth(0, taper, rv.from[q])) * (rv.toDry ? 0.35 + 0.65 * smooth(0, taper, rv.from[rv.length - 1] - rv.from[q]) : 1);
      out.push([rv[q - 1][0], rv[q - 1][1], rv[q][0], rv[q][1], Math.max(0.6, Math.max(floor, (0.6 + 6.4 * Math.pow(rv[q][2], 1.35)) * mul) * k), rv.ice ? (rv.ice[q - 1] + rv.ice[q]) / 2 : 0, rv.dry ? rv.dry[q - 1] & rv.dry[q] : 0]);
    }
  }
  return out;
}
// (how much wider rivers run in spring)
export const SPRING_RIVERS = 1.15;
// (the dark casing's extra width, both sides together)
const riverCasing = (outPx) => Math.max(1, (1.6 * outPx) / 3072);
// (the rivers with a name on the map: their own label's id is "@land:" and the inventory entry naming them)
const NAMED = new WeakMap();
function namedRivers(L) {
  if (NAMED.has(L)) return NAMED.get(L);
  const inv = new Map((L.land.inventory ?? []).filter((q) => q.kind === "river").map((q) => [`@land:${q.id}`, q.river]));
  const out = new Set((L.labels ?? []).filter((l) => inv.has(l.id)).map((l) => inv.get(l.id)));
  NAMED.set(L, out);
  return out;
}

function canvasOf(w, h) {
  return new OffscreenCanvas(w, h);
}

/** The smooth image at relief resolution: { rgba (bytes), bare (0 to 255: how much snow or bare rock), wood (0 to 1: how much forest), erg (1 where a sand sea's dunes are drawn), shelfR (at sea, the distance offshore over the shelf's width there) }. */
export function smoothImage(R, L, seed, { settled = null } = {}) {
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
  // the forest's kinds, from the biomes, smoothed as the climate: conifer (taiga, the cold rainforest), broadleaf (the
  // temperate forest), dry broadleaf (the seasonal forest), rainforest; and savanna's scattered trees
  // (only the kinds the map has; a kind it lacks reads as a shared empty field)
  const KIND = { taiga: 0, "temperate-rainforest": 0, "temperate-forest": 1, "seasonal-forest": 2, rainforest: 3, savanna: 4 };
  const kindOf = BIOMES.map((b) => KIND[b]), none = new Float32Array(N), kindW = [none, none, none, none, none];
  for (let i = 0; i < N; i++) { const k = kindOf[R.biome[i]]; if (k !== undefined && R.land[i]) { if (kindW[k] === none) kindW[k] = new Float32Array(N); kindW[k][i] = 1; } }
  for (const a of kindW) if (a !== none) boxBlur(a, rw, rh, Math.max(1, side / 300));
  const texK = forestTexture(Math.max(f.mapW, f.mapH)), clumpK = forestTexture(Math.max(f.mapW, f.mapH), R.cellMi);
  const season = L.season ?? "summer";
  const clumpN = clumpK > 0 ? fbm(rw, rh, Math.max(2, 1.2 / R.cellMi), seed * 11 + 12, 0.55) : none;
  // (fields: shown where a settled map's texture and clumps show, each lined up with the nearest road)
  const fieldK = settled ? clumpK : 0, roadAng = fieldK > 0 ? roadAngles(L, R) : null;
  const tintN = season === "autumn" ? fbm(rw, rh, Math.max(3, side / 220), seed * 11 + 13, 0.6) : none;
  // alluvium along big rivers, salt flats
  const allu = new Float32Array(N);
  const rivReach = Math.max(4, (40 * side) / 3072);
  for (let i = 0; i < N; i++) allu[i] = R.land[i] ? Math.max(0, 1 - R.riverDist[i] / rivReach) * (1 - smooth(0.05, 0.15, E[i])) : 0;
  boxBlur(allu, rw, rh, Math.max(1, side / 500));
  // settled land (0 to 1, from the places and roads), and how cleared it is: woods end with an edge where it passes
  // SETTLED, broken by a little noise
  const st = settled ?? none;
  const cleared = (i) => smooth(SETTLED - 0.05, SETTLED + 0.07, st[i] + 0.06 * Math.tanh(edgeN[i]));
  // the forest: where it's wet, warm enough and not high (inside a painted zone, by the zone's biome), its edge
  // broken up, as mockup 3; cleared where the land is settled, and opened into meadows on a big river's floor
  const wood = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (!R.land[i] || R.lake[i]) continue;
    const t = warm[i] + 0.6 * E[i];
    const byClimate = Math.min(1, Math.max(0, (moist[i] - 0.66) * 4)) * Math.min(1, Math.max(0, (0.42 - E[i]) * 6)) * smooth(0.1, 0.18, t);
    const v = R.zone[i] ? Math.min(1, Math.max(0, (R.forest[i] - 0.3) * 2.5)) * Math.min(1, Math.max(0, (0.5 - E[i]) * 6)) : byClimate;
    // (at a kingdom's scale the woods break into clumps with glades between)
    wood[i] = Math.min(1, Math.max(0, v * 1.5 + 0.35 * Math.tanh(1.3 * edgeN[i]) - 0.1)) * (1 - 0.85 * clumpK * smooth(0.5, 1.0, clumpN[i])) * (1 - cleared(i)) * (1 - 0.75 * smooth(0.35, 0.75, allu[i]));
  }
  boxBlur(wood, rw, rh, Math.max(1, side / 2400));
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
  // the sea floor: a shelf about 2% of the map's long side wide, narrower off a steep coast (the land's height near it),
  // then the slope down to the deep
  const nearE = Float32Array.from(E); boxBlur(nearE, rw, rh, Math.max(2, side / 120));
  const shelf = shelfPx(L, R);
  // seasonal lakes' beds, oases (a green patch at each), for generator 3 lands
  const seasB = R.seasonal ? Float32Array.from(R.seasonal) : null;
  if (seasB) boxBlur(seasB, rw, rh, 1);
  const oasisW = new Float32Array(N);
  for (const o of L.land.oases ?? []) {
    const ox = (o.x - f.margin) / R.cellMi, oy = (o.y - f.margin) / R.cellMi, rr = Math.max(2, side / 170);
    for (let y = Math.max(0, Math.floor(oy - 2 * rr)); y <= Math.min(rh - 1, Math.ceil(oy + 2 * rr)); y++) for (let x = Math.max(0, Math.floor(ox - 2 * rr)); x <= Math.min(rw - 1, Math.ceil(ox + 2 * rr)); x++) {
      const d2 = ((x + 0.5 - ox) ** 2 + (y + 0.5 - oy) ** 2) / (rr * rr), i = y * rw + x;
      oasisW[i] = Math.max(oasisW[i], Math.exp(-d2) * (0.75 + 0.25 * Math.tanh(edgeN[i])));
    }
  }
  // (a beach's and a cliff's width at the coast, in relief pixels)
  const beachW = Math.max(1, side / 900), cliffW = Math.max(1.2, side / 700);
  const erg = new Uint8Array(N), shelfR = new Float32Array(N);
  // (the rock families blended across their edges, for generator 3 lands)
  const famW = R.rock && (L.land.gen ?? 0) >= 3 ? [0, 1, 2, 3].map((k) => { const a = Float32Array.from(R.rock, (v) => (v === k ? 1 : 0)); boxBlur(a, rw, rh, Math.max(1, side / 400)); return a; }) : null;
  const out = new Uint8ClampedArray(N * 4), bare = new Uint8Array(N);
  const azs = [[315, 40, 0.62], [270, 60, 0.19], [0, 60, 0.19]].map(([az, alt, w]) => { const a = (az * Math.PI) / 180, e = (alt * Math.PI) / 180; return [Math.sin(a) * Math.cos(e), -Math.cos(a) * Math.cos(e), Math.sin(e), w]; });
  const flat = 0.62 * Math.sin((40 * Math.PI) / 180) + 0.38 * Math.sin((60 * Math.PI) / 180);
  const col = [0, 0, 0], fc = [0, 0, 0], leaf = [0, 0, 0], turn = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    if (!R.land[i]) {
      // the sea: shallow over the shelf, a break at its edge, then deep by its depth, brushed; turquoise over a warm
      // sea's shelf; pack ice where the sea's air freezes it
      const sd = R.seaDist[i], ws = shelf * (1.3 - 0.8 * smooth(0.01, 0.12, nearE[i])) * (0.75 + 0.5 * smooth(-1, 1, edgeN[i]));
      const tb = 0.16 * Math.min(1, sd / ws) + 0.1 * R.depth[i], ta = Math.max(0.34, R.depth[i]);
      const t = tb + (ta - tb) * smooth(ws, 1.4 * ws, sd), k = 1 + 0.035 * Math.tanh(seaN[i]);
      shelfR[i] = sd / ws;
      for (let ch = 0; ch < 3; ch++) col[ch] = (LOOK.shallow[ch] + (LOOK.deep[ch] - LOOK.shallow[ch]) * t) * k;
      mixTo(col, LOOK.turquoise, 0.38 * smooth(0.72, 0.88, warm[i]) * (1 - smooth(0.5 * ws, 1.2 * ws, sd)));
      const pack = smooth(0.25, 0.75, iceAt(warm[i] - 0.03, 0, season) + 0.2 * Math.tanh(seaN[i]));
      if (pack > 0) mixTo(col, LOOK.ice, 0.85 * pack);
    } else if (R.lake[i]) {
      // (the water darker by its depth below the lake's level in feet, a little by the way out from its shore: the
      // most saturated color on the map)
      const t = 0.3 * Math.min(1, lakeDist[i] / lakeFar) + 0.7 * (1 - Math.exp(-(R.lakeDepth[i] * FT_PER_UNIT) / 100));
      for (let ch = 0; ch < 3; ch++) col[ch] = LOOK.lakeRim[ch] + (LOOK.lakeDeep[ch] - LOOK.lakeRim[ch]) * t;
      // (frozen in a cold winter)
      mixTo(col, LOOK.ice, iceAt(R.temp[i], R.z[i], season));
    } else {
      const e = E[i], slope = slopeA[i], zk = 1 - Math.min(1, zoneW[i] * 1.2);
      // the ground by climate: dry ochre to meadow by moisture, heath where it's cold, sand where hot and dry; by season,
      // straw where winter is cold, new green in spring, a little gold in autumn
      groundColor(moist[i], warm[i], warm[i] + 0.6 * e, col);
      const [airMean, swing] = airF(R.temp[i], R.z[i]), coldMonth = airMean - swing;
      if (season === "winter") mixTo(col, LOOK.straw, 0.45 * smooth(46, 32, coldMonth));
      else if (season === "spring") mixTo(col, LOOK.spring, 0.3 * smooth(0.15, 0.45, moist[i]) * smooth(30, 45, airMean) * smooth(72, 62, airMean));
      else if (season === "autumn") mixTo(col, LOOK.autumn[2], 0.18 * smooth(70, 55, airMean) * smooth(25, 35, airMean));
      // (savanna's ground ochre)
      mixTo(col, LOOK.dry, 0.5 * kindW[4][i]);
      if (zoneW[i] > 0.01) { const k = Math.min(1, zoneW[i] * 1.2), s = 1 / zoneW[i]; col[0] += (zr[i] * s - col[0]) * k; col[1] += (zg[i] * s - col[1]) * k; col[2] += (zb[i] * s - col[2]) * k; }
      // bare rock high and on the steepest ground (slope against the land's own 95th percentile, so it doesn't follow
      // the light's exaggeration; not inside a painted zone)
      const sr = slope / 1.6;
      const rk = Math.min(1, Math.max(0, (e - 0.45) * 3.5 + (sr - 1.1) * 0.7)) * zk;
      // (the rock by its family where the land has one: limestone pale, sandstone red, granite gray, basalt dark)
      if (famW) { const w0 = famW[0][i], w1 = famW[1][i], w2 = famW[2][i], w3 = famW[3][i], ws0 = w0 + w1 + w2 + w3 || 1; for (let ch = 0; ch < 3; ch++) fc[ch] = (LOOK.rocks[0][ch] * w0 + LOOK.rocks[1][ch] * w1 + LOOK.rocks[2][ch] * w2 + LOOK.rocks[3][ch] * w3) / ws0; }
      const rockC = famW ? fc : LOOK.rock;
      for (let ch = 0; ch < 3; ch++) col[ch] += (rockC[ch] - col[ch]) * rk;
      // deserts by their ground (generator 3): sand seas on low flat ground, stony plains higher up, badlands banded on
      // dry hillsides of soft rock
      const dd = (L.land.gen ?? 0) >= 3 ? smooth(0.32, 0.16, moist[i]) * smooth(0.55, 0.7, warm[i] + 0.6 * e) * zk * (1 - rk) : 0;
      if (dd > 0.01) {
        const soft = R.rock ? (R.rock[i] <= 1 ? 1 : 0.4) : 1, steepish = smooth(0.25, 0.7, sr);
        const bl = dd * steepish * soft, band = 0.5 + 0.5 * Math.sin(zl[i] * 900 + 0.6 * edgeN[i]);
        mixTo(col, LOOK.badland, 0.55 * bl * (0.55 + 0.45 * band));
        const rg = dd * smooth(0.04, 0.12, e) * (1 - steepish);
        mixTo(col, LOOK.reg, 0.4 * rg * (0.85 + 0.3 * crownsB[i]));
        const er = dd * smooth(0.1, 0.04, e) * smooth(0.25, 0.1, sr);
        mixTo(col, LOOK.sand, 0.5 * er);
        if (er > 0.35) erg[i] = 1;
      }
      // alluvium and salt flats
      const al = allu[i] * 0.3, sl = saltB[i] * 0.9;
      for (let ch = 0; ch < 3; ch++) { col[ch] += (LOOK.alluvium[ch] - col[ch]) * al; col[ch] += (LOOK.salt[ch] - col[ch]) * sl; }
      // a seasonal lake's bed, pale; an oasis's green
      if (seasB && seasB[i] > 0.01) mixTo(col, LOOK.playa, 0.75 * seasB[i]);
      if (oasisW[i] > 0.01) mixTo(col, LOOK.lush, 0.85 * oasisW[i]);
      // a beach on a low coast, a cliff's dark face on a steep one
      if ((L.land.gen ?? 0) >= 3 && R.landDist[i] < cliffW) {
        const steepC = Math.max(smooth(0.9, 1.6, sr), smooth(0.08, 0.18, e));
        mixTo(col, LOOK.cliff, 0.45 * steepC * (1 - R.landDist[i] / cliffW));
        if (R.landDist[i] < beachW && e < 0.04) mixTo(col, LOOK.beach, 0.55 * (1 - steepC) * (1 - R.landDist[i] / beachW));
      }
      // a big river's floor: light, a meadow, where it's flat
      mixTo(col, LOOK.valley, 0.35 * smooth(0.3, 0.8, allu[i]) * smooth(1.2, 0.4, sr) * (1 - rk));
      // farmland on settled land: a lighter, warmer ground; on a kingdom's map, where the picture can draw them, small
      // fields in two tones lined up with the nearest road; pasture, not fields, on slopes
      const fk = cleared(i) * (1 - rk) * (1 - sl);
      if (fk > 0.01) {
        const pasture = smooth(0.18, 0.45, sr);
        mixTo(col, LOOK.farm, 0.5 * fk * (1 - pasture));
        mixTo(col, LOOK.pasture, 0.45 * fk * pasture);
        if (fieldK > 0 && roadAng) {
          const [cu, cv] = fieldCell(i, rw, roadAng), tone = fieldTone(cu, cv, seed);
          const two = LOOK.fields[season] ?? LOOK.fields.summer;
          mixTo(col, two[tone < 0.5 ? 0 : 1], 0.55 * fk * fieldK * (1 - pasture) * (0.6 + 0.8 * Math.abs(tone - 0.5)));
        }
      }
      // the forest canopy by kind: conifer dark and blue-green with a fine sharp speckle, broadleaf warmer and rounder,
      // rainforest deep and dense; by season, broadleaf bare and gray-brown where winter is cold, turned in autumn where
      // the year is cool, bright in spring
      const wd = wood[i] * (1 - rk);
      if (wd > 0) {
        const kc = kindW[0][i], kb = kindW[1][i], kd = kindW[2][i], kr = kindW[3][i], kn = kc + kb + kd + kr;
        if (kn < 0.05) { const cold = smooth(0.4, 0.2, warm[i] + 0.6 * e); for (let ch = 0; ch < 3; ch++) fc[ch] = LOOK.forest[ch] + LOOK.forestCold[ch] * cold; }
        else {
          for (let ch = 0; ch < 3; ch++) leaf[ch] = LOOK.forest[ch];
          if (season === "winter") mixTo(leaf, LOOK.bareWood, smooth(40, 30, coldMonth));
          else if (season === "autumn") {
            // (orange, russet or gold in patches)
            autumnLeaf(tintN[i], turn);
            mixTo(leaf, turn, 0.5 * smooth(64, 50, airMean) * smooth(26, 36, airMean));
          }
          else if (season === "spring") mixTo(leaf, LOOK.spring, 0.3 * smooth(30, 45, airMean) * smooth(72, 62, airMean));
          for (let ch = 0; ch < 3; ch++) fc[ch] = (LOOK.conifer[ch] * kc + leaf[ch] * kb + LOOK.drywood[ch] * kd + LOOK.rainforest[ch] * kr) / kn;
        }
        const k3 = kn > 0 ? kc / kn : 0, kr3 = kn > 0 ? kr / kn : 0;
        const sp = forestLook === "speckle"
          ? texK * ((0.09 + 0.06 * k3) * crowns[i] + (0.05 - 0.03 * k3) * crownsB[i]) + (1 - texK) * 0.02 * crownsB[i]
          : 0.04 * crownsB[i];
        // (a wood's edge against cleared land a little darker, as the woods of a settled country are drawn)
        const rim = texK * 0.12 * smooth(0.15, 0.6, cleared(i)) * (wd < 0.95 ? 1 : 0);
        const dense = Math.min(1, wd * (1 + 0.3 * kr3));
        if (rim > 0) for (let ch = 0; ch < 3; ch++) fc[ch] *= 1 - rim;
        for (let ch = 0; ch < 3; ch++) col[ch] += (fc[ch] * (1 + sp) - col[ch]) * dense;
      }
      // savanna's trees: scattered dark crowns on the ochre, seen at a kingdom's scale, a faint darkening on a continent's
      // (cleared from settled land, as the forest is)
      const sv = kindW[4][i] * (1 - rk) * (1 - cleared(i));
      if (sv > 0.02) {
        const dots = texK * smooth(0.55, 0.85, crowns[i]) * 0.55 + (1 - texK) * 0.12;
        mixTo(col, LOOK.drywood, sv * dots);
      }
      // snow where the air is cold enough at its height (snowAt), less on steep faces
      // (half as much on a forest's crowns, so a snowy wood still reads dark)
      const snow = snowOfAir(airMean, swing, moist[i], season) * Math.min(1, Math.max(0, 1.5 - sr * 0.45)) * zk * (1 - 0.5 * wd);
      for (let ch = 0; ch < 3; ch++) col[ch] += (LOOK.snow[ch] - col[ch]) * snow;
      bare[i] = Math.round(255 * Math.max(snow, rk));
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
  return { rgba: out, bare, wood, erg, shelfR };
}

/**
 * The layers a map is saved in besides its ground, each a see-through image (a tile over the land in the scene, shown
 * or hidden there), when the map has places: its places, roads and crossings (shown when the plan shows them), then
 * its dressing (frame, compass rose, scale bar), so the frame stays over road ends and the compass over any mark, then
 * its key when it has one (with the scale bar), so the GM can hide it and see what's under it.
 * [{ name, shown, box? }] (box: [x0, y0, x1, y1] in map units, the part of the map a layer covers; else all of it).
 */
// (the key's box with a little room, in map units: its layer is saved as that much of the map, not all of it)
const keyBox = (layout) => { const k = keyOf(layout); if (!k) return null; const p = k.unit; return [Math.max(0, k.x - p), Math.max(0, k.y - p), k.x + k.w + p, k.y + k.h + p]; };

export function layers(layout) {
  if (!layout.overland || !(layout.items ?? []).some((i) => i.kind === "place" || i.kind === "way" || i.kind === "crossing")) return [];
  // (realms under the places: their wash and borders, so the GM can hide them and keep the towns)
  return [...(layout.realms?.list?.length ? [{ name: "realms", shown: layout.showRealms !== false }] : []), { name: "places", shown: layout.places !== false }, ...(layout.dressing ? [{ name: "dressing", shown: true }] : []), ...(keyBox(layout) ? [{ name: "legend", shown: true, box: keyBox(layout) }] : [])];
}

/**
 * Paints one tile (ctx as every style's: g, W, H, x0, y0 in map units, pp, layout, mask, progress). ctx.layer: "ground"
 * paints the land alone, "places" the places, roads and crossings alone on a clear tile, "dressing" the dressing alone;
 * left out, all of them (a preview), the places only when the plan shows them.
 */
export function paint(ctx) {
  const { g, W, H, x0, y0, pp, layout: L, progress = () => {}, layer } = ctx;
  if (layer === "realms") {
    paintRealms(ctx, L, prepared(L, pp), Math.max(L.size.squares[0], L.size.squares[1]) * pp);
    progress(1, "Done");
    return;
  }
  if (layer === "places") {
    const [MW0, MH0] = L.size.squares;
    drawAtlas(ctx, L, prepared(L, pp).rivers, Math.max(MW0, MH0) * pp);
    progress(1, "Done");
    return;
  }
  if (layer === "dressing") {
    if (L.dressing) dress(ctx, { ...PALETTE }, { miles: true, key: false });
    progress(1, "Done");
    return;
  }
  if (layer === "legend") {
    if (L.dressing) paintKey(ctx, { ...PALETTE }, { miles: true, covers: COVER_SWATCH });
    progress(1, "Done");
    return;
  }
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
  // reefs: a dotted pale line along the shelf's edge in warm seas
  if (S.reefs?.length) {
    const rw0 = g.lineWidth, dot = Math.max(1, outPx / 1500);
    g.lineCap = "round"; g.lineWidth = dot; g.setLineDash([0.1, 2.6 * dot]); g.strokeStyle = rgb(LOOK.reef, 0.8);
    for (const r of S.reefs) { if (!near(r, 1)) continue; line(r, false); g.stroke(); }
    g.setLineDash([]); g.lineWidth = rw0;
  }
  // marsh tufts and dune ripples, at full size
  marks(ctx, S, k);
  // rivers, clipped to the land (not the sea or lakes)
  progress(0.65, "Rivers");
  const m = ctx.mask;
  if (m && S.rivers.length) {
    const mg = m.getContext("2d");
    mg.setTransform(1, 0, 0, 1, 0, 0); mg.globalCompositeOperation = "source-over"; mg.clearRect(0, 0, W, H);
    // (stroked opaque, then laid on at the river's alpha, so the joints between segments don't bead: every casing
    // first, then every river over them, so where two join the casing doesn't cross the water)
    mg.lineCap = "round"; mg.lineJoin = "round";
    const segs = riverSegs(L, S, outPx, (rv) => near(rv, 1));
    // (a frozen stretch pale, its casing gray)
    const tint = (a, b, t) => rgb(t > 0.01 ? a.map((v, ch) => v + (b[ch] - v) * t) : a);
    for (const [color, iceColor, extra] of [[LOOK.riverCase, LOOK.riverIceCase, riverCasing(outPx)], [LOOK.river, LOOK.riverIce, 0]]) {
      for (const [ax, ay, bx, by, w, ice, dryBed] of segs) { if (dryBed) continue; mg.strokeStyle = tint(color, iceColor, ice); mg.lineWidth = w + extra; mg.beginPath(); mg.moveTo(X(ax), Y(ay)); mg.lineTo(X(bx), Y(by)); mg.stroke(); }
    }
    // (a dry bed: a thinner dashed line in a dull gray-green, no casing, each run of it one path so the dashes run on)
    const dryW = Math.max(0.8, outPx / 2600);
    mg.strokeStyle = rgb(LOOK.riverDry); mg.setLineDash([3 * dryW, 2.2 * dryW]);
    let open = null;
    const flush = () => { if (open) { mg.lineWidth = open.w; mg.stroke(); open = null; } };
    for (const [ax, ay, bx, by, w, , dryBed] of segs) {
      if (!dryBed) { flush(); continue; }
      if (!open || Math.abs(open.x - ax) > 1e-9 || Math.abs(open.y - ay) > 1e-9) { flush(); mg.beginPath(); mg.moveTo(X(ax), Y(ay)); open = { w: Math.max(dryW, 0.6 * w) }; }
      mg.lineTo(X(bx), Y(by)); open.x = bx; open.y = by;
    }
    flush();
    mg.setLineDash([]);
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
  // paper: a vignette at the map's edge and grain; then roads, crossings and places as atlas markers, crisp on top
  paper(ctx, MW, MH);
  progress(0.85, "Places");
  if (layer !== "ground" && L.showRealms !== false && L.realms?.list?.length) paintRealms(ctx, L, S, outPx);
  if (layer !== "ground" && L.places !== false) drawAtlas(ctx, L, S.rivers, outPx);
  // (the dressing on the ground, unless it's a layer of its own over the places)
  if (L.dressing && !(layer === "ground" && layers(L).some((q) => q.name === "dressing"))) dress(ctx, P, { miles: true });
  progress(1, "Done");
}

// (the realm band's width in miles, as hand-colored atlases: a stripe inside each border, its color fading to nothing
// inward; the same width for every realm of a map, however big: a fortieth of the map's long side, 6 miles on a
// kingdom map, 18 on a realm, 60 on a continent, 180 on a world; its strength at the border)
export const BAND_SHARE = 0.025, BAND_PEAK = 0.8;
const BAND = new WeakMap();

/**
 * Each realm's band at relief resolution, worked out once per prepared picture and realms: the realm's color along its
 * borders with another realm or the wilds (not the coast), fading to nothing within the band's miles, none on snow, bare
 * rock or lakes. Its color is the ground's own (with the paper's vignette) times the realm's color, so laid over the
 * ground at its alpha it multiplies the ground: the relief shows through, as a multiply would across the layer tiles.
 */
export function realmBand(L, S) {
  const R = L.realms, held = BAND.get(S);
  if (held && held.R === R) return held.img;
  const { rw, rh, cell: rc, land, lake, bare } = S.R, N = rw * rh;
  const { w: gw, h: gh, cell: gc, ids } = R.grid;
  const f = L.land.frame, [MW, MH] = L.size.squares;
  // (each relief pixel's realm: of the four grid cells about it, the land id with the most weight, so the edge between
  // two realms runs smooth and close to the border line drawn over it)
  // (a cell counts only if its middle is land: realms grow over the sea too, and the sea out of reach is marked as wilds)
  const cellLand = new Uint8Array(gw * gh);
  for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
    const x = Math.min(rw - 1, Math.floor(((c + 0.5) * gc) / rc)), y = Math.min(rh - 1, Math.floor(((r + 0.5) * gc) / rc));
    cellLand[r * gw + c] = land[y * rw + x] && !lake[y * rw + x] ? 1 : 0;
  }
  const own = new Int16Array(N).fill(-1);
  const wt = new Map();
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const i = y * rw + x;
    if (!land[i] || lake[i]) continue;
    const gx = Math.min(gw - 1, Math.max(0, ((x + 0.5) * rc) / gc - 0.5)), gy = Math.min(gh - 1, Math.max(0, ((y + 0.5) * rc) / gc - 0.5));
    const c0 = Math.floor(gx), r0 = Math.floor(gy), fx = gx - c0, fy = gy - r0, c1 = Math.min(gw - 1, c0 + 1), r1 = Math.min(gh - 1, r0 + 1);
    wt.clear();
    for (const [c, r, v] of [[c0, r0, (1 - fx) * (1 - fy)], [c1, r0, fx * (1 - fy)], [c0, r1, (1 - fx) * fy], [c1, r1, fx * fy]]) {
      const id = ids[r * gw + c];
      if (id !== -1 && cellLand[r * gw + c]) wt.set(id, (wt.get(id) ?? 0) + v);
    }
    let best = -3, bw = -1;
    for (const [id, v] of wt) if (v > bw) { bw = v; best = id; }
    own[i] = best;
  }
  // (a pixel with no land cell about it, on a spit, an islet or the coast's edge: its nearest neighbor's, by a flood)
  let open = [];
  for (let i = 0; i < N; i++) if (own[i] === -3) open.push(i);
  while (open.length) {
    const next = [], got = [];
    for (const i of open) {
      const x = i % rw;
      for (const j of [x > 0 ? i - 1 : -1, x < rw - 1 ? i + 1 : -1, i - rw, i + rw]) if (j >= 0 && j < N && own[j] !== -3 && own[j] !== -1) { got.push(i, own[j]); break; }
    }
    if (!got.length) break;
    for (let k = 0; k < got.length; k += 2) own[got[k]] = got[k + 1];
    for (const i of open) if (own[i] === -3) next.push(i);
    open = next;
  }
  for (const i of open) own[i] = -2;
  // distance in relief pixels from the realm's edge with another realm or the wilds (the sea and lakes aren't edges)
  const d = new Float32Array(N).fill(1e9);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const i = y * rw + x, me = own[i];
    if (me < 0) continue;
    if ((x > 0 && own[i - 1] !== me && own[i - 1] !== -1) || (x < rw - 1 && own[i + 1] !== me && own[i + 1] !== -1) || (y > 0 && own[i - rw] !== me && own[i - rw] !== -1) || (y < rh - 1 && own[i + rw] !== me && own[i + rw] !== -1)) d[i] = 0;
  }
  const D2 = Math.SQRT2;
  for (let pass = 0; pass < 2; pass++) for (let s = 0; s < N; s++) {
    const i = pass ? N - 1 - s : s, me = own[i];
    if (me < 0) continue;
    const x = i % rw, y = (i - x) / rw;
    const look = pass
      ? [[x < rw - 1, i + 1, 1], [y < rh - 1, i + rw, 1], [y < rh - 1 && x > 0, i + rw - 1, D2], [y < rh - 1 && x < rw - 1, i + rw + 1, D2]]
      : [[x > 0, i - 1, 1], [y > 0, i - rw, 1], [y > 0 && x > 0, i - rw - 1, D2], [y > 0 && x < rw - 1, i - rw + 1, D2]];
    for (const [ok, j, step] of look) if (ok && own[j] === me && d[j] + step < d[i]) d[i] = d[j] + step;
  }
  const miPx = (rc * Math.max(f.mapW, f.mapH)) / Math.max(MW, MH);
  const band = Math.max(3, Math.max(1, BAND_SHARE * Math.max(f.mapW, f.mapH)) / miPx);
  // (each color brightened toward full strength, so the multiply tints more than it darkens)
  const cols = R.list.map((q) => { const c = hexColor(q.color) ?? [140, 120, 100], k = Math.pow(255 / Math.max(1, ...c), 0.6); return c.map((v) => v * k); });
  // (the paper's vignette, as paper() lays it on the ground, so the band's ground matches the ground under it)
  const edge = (Math.max(MW, MH) * 160) / 3072, V = LOOK.vignette, img = S.smoothCanvas.getContext("2d").getImageData(0, 0, rw, rh).data;
  const out = canvasOf(rw, rh), og = out.getContext("2d"), id = og.createImageData(rw, rh);
  for (let i = 0; i < N; i++) {
    const me = own[i];
    if (me < 0 || !cols[me] || d[i] >= band) continue;
    const t = d[i] / band, a = BAND_PEAK * Math.pow(1 - t, 1.4) * (1 - bare[i] / 255);
    if (a <= 0.004) continue;
    const x = i % rw, y = (i - x) / rw, mx = (x + 0.5) * rc, my = (y + 0.5) * rc;
    const v = Math.pow(Math.min(1, Math.max(0, Math.min(mx, MW - mx, my, MH - my) / edge)), 0.7), av = 0.8 + 0.2 * v, vb = (1 - v) * 0.09;
    for (let ch = 0; ch < 3; ch++) id.data[4 * i + ch] = ((img[4 * i + ch] * av + V[ch] * vb) * cols[me][ch]) / 255;
    id.data[4 * i + 3] = Math.round(255 * a);
  }
  og.putImageData(id, 0, 0);
  if (held) { held.img.width = 1; held.img.height = 1; }
  BAND.set(S, { R, img: out });
  return out;
}

/**
 * The realms: a band of each realm's color inside its borders (realmBand), cut off the rivers and the coast's and lakes'
 * ink, and the borders as dashed lines in the map's ink on a pale halo, all on the land only (not the sea or lakes).
 */
function paintRealms(ctx, L, S, outPx) {
  const { g, W, H, x0, y0, pp } = ctx, R = L.realms;
  const X = (x) => (x - x0) * pp, Y = (y) => (y - y0) * pp;
  // (on a scratch canvas, so the cuts below cut only the band, then laid on the tile)
  const m = ctx.mask ?? canvasOf(W, H), target = m.getContext("2d");
  target.setTransform(1, 0, 0, 1, 0, 0); target.globalCompositeOperation = "source-over"; target.clearRect(0, 0, W, H);
  target.imageSmoothingEnabled = true; target.imageSmoothingQuality = "high";
  const u = outPx / 3600;
  target.lineCap = "round"; target.lineJoin = "round";
  // (crowns stand well above their mark on a big picture: the same reach past the tile as the atlas marks)
  const tx1 = x0 + W / pp, ty1 = y0 + H / pp, pad = Math.max(1, (40 * u) / pp + 0.5);
  const near = (pts) => pts.some(([x, y]) => x >= x0 - pad && y >= y0 - pad && x <= tx1 + pad && y <= ty1 + pad);
  const path = (pts) => { target.beginPath(); pts.forEach(([x, y], i) => (i ? target.lineTo(X(x), Y(y)) : target.moveTo(X(x), Y(y)))); };
  {
    target.drawImage(realmBand(L, S), 0, 0, S.rw, S.rh, X(0), Y(0), S.rw * S.R.cell * pp, S.rh * S.R.cell * pp);
    // the band off the rivers and the ink of coasts and lake shores, a little wider than they're drawn
    target.globalCompositeOperation = "destination-out"; target.strokeStyle = "#000";
    const casing = riverCasing(outPx);
    for (const [ax, ay, bx, by, w] of riverSegs(L, S, outPx, near)) { target.lineWidth = w + casing + 1; target.beginPath(); target.moveTo(X(ax), Y(ay)); target.lineTo(X(bx), Y(by)); target.stroke(); }
    target.lineWidth = Math.max(1.1, outPx / 1700) * 1.6 + 1;
    for (const c of [...S.coast, ...S.shores]) { if (!near(c.pts)) continue; path(c.pts); if (c.closed) target.closePath(); target.stroke(); }
    // (and thinned where the ground has marsh tufts and dune marks, drawn as the ground draws them, so they still show)
    marks({ ...ctx, g: target }, S, (L.size.squares[0] * pp) / S.rw);
    target.globalCompositeOperation = "source-over";
  }
  // the borders: a pale halo, then the ink by the border's kind: a dash and dot across open country and along a crest
  // (longer there), a light dotted line beside a river, red dashes where two enemies meet, sparse dots on a frontier
  // with the wilds; provinces' borders faint dots inside their realm
  const INK = { open: ["rgba(58,40,30,0.85)", 3.2, [11, 5, 2.5, 5]], crest: ["rgba(58,40,30,0.85)", 3.2, [16, 5, 2.5, 5]], river: ["rgba(58,40,30,0.7)", 2.4, [2, 4]], disputed: ["rgba(150,34,30,0.9)", 3.4, [7, 5]], frontier: ["rgba(88,64,44,0.75)", 3, [0.1, 7]] };
  target.strokeStyle = "rgba(252,246,232,0.7)"; target.lineWidth = Math.max(1, 7 * u); target.setLineDash([]);
  for (const b of R.borders) { if (!near(b)) continue; path(b); target.stroke(); }
  R.borders.forEach((b, k) => {
    if (!near(b)) return;
    const [stroke, width, dash] = INK[R.kinds?.[k]] ?? INK.open;
    target.strokeStyle = stroke; target.lineWidth = Math.max(1, width * u); target.setLineDash(dash.map((v) => v * u));
    path(b); target.stroke();
  });
  target.strokeStyle = "rgba(58,40,30,0.45)"; target.lineWidth = Math.max(1, 1.6 * u); target.setLineDash([0.1, 4 * u]);
  for (const b of R.provinceLines ?? []) { if (!near(b)) continue; path(b); target.stroke(); }
  target.setLineDash([]);
  target.globalCompositeOperation = "destination-in";
  target.drawImage(S.landImg, 0, 0, S.rw, S.rh, X(0), Y(0), S.rw * S.R.cell * pp, S.rh * S.R.cell * pp);
  target.globalCompositeOperation = "source-over";
  g.drawImage(m, 0, 0);
  // each capital's crown, above its mark (on this layer, so hiding the realms hides the crowns)
  for (const p of L.items ?? []) if (p.kind === "place" && p.capital && near([[p.x, p.y]])) crownMark(g, X(p.x), Y(p.y) - (CROWN_LIFT[p.class] ?? 14) * u, u);
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
    } else if (R.erg ? R.erg[i] === 1 : b === S.desert) {
      // (dune crests on a sand sea, where the land has them; else on the whole desert)
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
