/**
 * Climate: temperature from latitude and height, and rain carried by the wind across the frame. The wind sweeps
 * column by column along its heading (any angle: the frame is resampled along the wind), the air picking up
 * moisture over the sea, losing a little per mile over land and much where the ground rises along the wind, so the
 * far side of a range is dry; rows mix a little as it goes, so a shadow spreads and fades. With the wind left to the
 * latitude, westerlies blow between about 35 and 60 degrees and easterlies outside them, with a dry belt near 28
 * degrees and a wet band at the equator. Painted climate (wetter, drier, warmer, colder, zones that react) is
 * applied here, before erosion uses the rain. Rain is normalized so 1 is a rainy coastal lowland. Per mile, not per
 * pixel, so it is the same at any scale. Pure.
 */
import { makeField, like, sample, blur, lineBlur } from "./field.mjs";
import { nodeGrid } from "./graph.mjs";
import { exp, cos, sin, PI } from "./dmath.mjs";

/** Rain per mile that counts as 1 (a rainy coastal lowland). */
const RAIN_REF = 0.0013;
/** How much temperature falls per unit of height (1 is high mountains): at 45 degrees, alpine tundra from about 0.65 and ice from about 0.8. */
export const LAPSE = 0.6;
/** Sea-level temperature (0 to 1) at a latitude: 1 within about 16 degrees of the equator, 0.53 at 45 (mid-temperate),
 * 0.34 at 57 (cool, mixed forest to taiga), tundra past about 70, ice past about 76. */
export const seaTemp = (lat) => Math.min(1, Math.max(0, (78 - Math.abs(lat)) / 62));

/**
 * ctx: { g, frame, h (heights per node), landMask, lat (y miles -> degrees), land (block), seaSide, intent ({ wet,
 * warm } per node, -1..1, or null), zones ([{ nodes: mask, rain, temp }] targets for zones that react), gen (the
 * generator to run as: 1 has no smoothing along the wind; left out, the newest) }.
 * Returns { rain, temp (per node), rainF, tempF (fields over the frame) }.
 */
export function climateStage(ctx) {
  const { g, frame, h, landMask, lat, land } = ctx;
  const f = makeField(frame.W, frame.H, 384);
  const near = ctx.grid ?? nodeGrid(g);
  const hr = like(f), lr = like(f);
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const j = near.nearest((x + 0.5) * f.cell, (y + 0.5) * f.cell);
    hr.data[y * f.w + x] = landMask[j] ? Math.max(0, h[j]) : -0.02;
    lr.data[y * f.w + x] = landMask[j] ? 1 : 0;
  }
  // (heights smoothed over about 20 miles: rain answers ranges and uplands, not every small hill, at any scale)
  blur(hr, Math.max(1, Math.round(20 / f.cell)));
  const sweepAt = (deg) => sweep(f, hr, lr, deg);
  const rainF = like(f);
  const wind = land.wind;
  if (Number.isFinite(wind)) {
    rainF.data.set(sweepAt(wind).data);
  } else {
    const west = sweepAt(270), east = sweepAt(90);
    const small = frame.scale === "kingdom" || frame.scale === "realm";
    const seaDir = { east: 90, west: 270, north: 0, south: 180 }[ctx.seaSide];
    const fromSea = small && seaDir !== undefined ? sweepAt(seaDir) : null;
    for (let y = 0; y < f.h; y++) {
      // (the belts by distance from the equator: westerlies blow in both hemispheres' middle latitudes)
      const L = Math.abs(lat((y + 0.5) * f.cell));
      const wW = Math.min(1, Math.max(0, (L - 27) / 8)) * Math.min(1, Math.max(0, (66 - L) / 6));
      for (let x = 0; x < f.w; x++) {
        const i = y * f.w + x;
        let v = west.data[i] * wW + east.data[i] * (1 - wW);
        if (fromSea) v = 0.8 * v + 0.2 * fromSea.data[i];
        rainF.data[i] = v;
      }
    }
  }
  // belts by latitude: the subtropical dry belt and the wet equatorial band; the climate's own bias
  const bias = 1 + ({ arid: -0.55, tropical: 0.15, cold: -0.05 }[land.climate] ?? 0) + ({ drier: -0.3, wetter: 0.35 }[land.rain] ?? 0);
  for (let y = 0; y < f.h; y++) {
    const L = Math.abs(lat((y + 0.5) * f.cell));
    const belt = (1 - 0.45 * exp(-((L - 28) / 7) * ((L - 28) / 7))) * (1 + 0.5 * exp(-(L / 8) * (L / 8))) * bias;
    for (let x = 0; x < f.w; x++) rainF.data[y * f.w + x] *= belt / RAIN_REF;
  }
  // (smoothed along the wind first, so the wet and dry lands run a little downwind, not in round patches: about 1% of
  // the frame each way, 15 miles at least, little enough that a range still casts its rain shadow; never more than 6%
  // of the field's pixels, which a map a few miles across would ask for many times over)
  if ((ctx.gen ?? 2) >= 2) lineBlur(rainF, Number.isFinite(wind) ? wind : 90, Math.max(1, Math.min(Math.round(0.06 * Math.max(f.w, f.h)), Math.round(Math.max(15, 0.01 * Math.max(frame.W, frame.H)) / f.cell))));
  blur(rainF, Math.max(1, Math.round(15 / f.cell)));
  const n = g.n, rain = new Float64Array(n), temp = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let r = sample(rainF, g.x[i], g.y[i]);
    let t = seaTemp(lat(g.y[i])) - LAPSE * Math.max(0, h[i]);
    if (ctx.intent?.wet) r *= Math.max(0.05, 1 + 1.5 * ctx.intent.wet[i]);
    if (ctx.intent?.warm) t += 0.25 * ctx.intent.warm[i];
    // (the blur's running sums leave a rounding residue that can dip below 0 at sea)
    rain[i] = Math.max(0, r); temp[i] = t;
  }
  for (const z of ctx.zones ?? []) for (let i = 0; i < n; i++) if (z.nodes[i]) {
    if (Number.isFinite(z.rain)) rain[i] = 0.15 * rain[i] + 0.85 * z.rain;
    if (Number.isFinite(z.temp)) temp[i] = 0.15 * temp[i] + 0.85 * (z.temp - LAPSE * Math.max(0, h[i]));
  }
  const tempF = like(f);
  for (let y = 0; y < f.h; y++) {
    const t0 = seaTemp(lat((y + 0.5) * f.cell));
    for (let x = 0; x < f.w; x++) tempF.data[y * f.w + x] = t0 - LAPSE * Math.max(0, hr.data[y * f.w + x]);
  }
  return { rain, temp, rainF, tempF };
}

/**
 * One sweep of the wind from heading `deg` (the direction it comes from: 270 is a west wind) over the frame. The
 * frame is resampled onto a grid turned to the wind, swept along it (rows mixing), and the rain resampled back.
 */
function sweep(f, hr, lr, deg) {
  const a = (deg * PI) / 180;
  // the wind blows toward deg + 180: its direction in frame terms (x east, y south)
  const ux = -sin(a), uy = cos(a);
  const vx = -uy, vy = ux;
  const W = f.w * f.cell, H = f.h * f.cell, L = f.cell;
  const corners = [[0, 0], [W, 0], [0, H], [W, H]];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, y] of corners) { const u = x * ux + y * uy, v = x * vx + y * vy; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
  const nu = Math.ceil((u1 - u0) / L) + 1, nv = Math.ceil((v1 - v0) / L) + 1;
  const rot = new Float64Array(nu * nv);
  let q = new Float64Array(nv).fill(0.9), tmp = new Float64Array(nv);
  const pick = 1 - exp(-0.013 * L), capL = 1 - exp(-0.06 * L), sig = (1.5 * Math.sqrt(L)) / L;
  const R = Math.max(1, Math.ceil(2.5 * sig));
  const ker = new Float64Array(2 * R + 1);
  { let s = 0; for (let k = -R; k <= R; k++) { ker[k + R] = exp(-(k * k) / (2 * sig * sig)); s += ker[k + R]; } for (let k = 0; k < ker.length; k++) ker[k] /= s; }
  const prevH = new Float64Array(nv).fill(-1);
  for (let iu = 0; iu < nu; iu++) {
    const u = u0 + iu * L;
    for (let iv = 0; iv < nv; iv++) {
      const v = v0 + iv * L;
      const x = u * ux + v * vx, y = u * uy + v * vy;
      const inside = x >= 0 && y >= 0 && x <= W && y <= H;
      const hh = inside ? sample(hr, x, y) : -0.02, land = inside && sample(lr, x, y) > 0.5;
      let p = 0;
      if (land) {
        const rise = prevH[iv] > -0.5 ? Math.max(0, hh - prevH[iv]) : 0;
        p = Math.min(q[iv] * (0.0013 * L + 0.8 * rise), q[iv] * capL);
        q[iv] = q[iv] - p + 0.45 * p;
      } else {
        q[iv] += (1 - q[iv]) * pick;
      }
      prevH[iv] = hh;
      rot[iu * nv + iv] = p / L;
    }
    for (let iv = 0; iv < nv; iv++) { let s = 0; for (let k = -R; k <= R; k++) s += ker[k + R] * q[Math.min(nv - 1, Math.max(0, iv + k))]; tmp[iv] = s; }
    const t = q; q = tmp; tmp = t;
  }
  const out = like(f);
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const px = (x + 0.5) * L, py = (y + 0.5) * L;
    const fu = (px * ux + py * uy - u0) / L, fv = (px * vx + py * vy - v0) / L;
    const iu = Math.min(nu - 2, Math.max(0, Math.floor(fu))), iv = Math.min(nv - 2, Math.max(0, Math.floor(fv)));
    const tu = Math.min(1, Math.max(0, fu - iu)), tv = Math.min(1, Math.max(0, fv - iv));
    out.data[y * f.w + x] = (rot[iu * nv + iv] * (1 - tv) + rot[iu * nv + iv + 1] * tv) * (1 - tu) + (rot[(iu + 1) * nv + iv] * (1 - tv) + rot[(iu + 1) * nv + iv + 1] * tv) * tu;
  }
  return out;
}
