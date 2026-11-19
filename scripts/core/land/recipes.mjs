/**
 * Landmass recipes: the shape field (land above 0, sea below) over the frame, from a few primitives (spectral noise
 * with its longest waves cut, domain warp, a tilt toward a side, the map's edge sinking, blobs, rings). A recipe is
 * about the map's composition (where land and sea lie in the picture), so its lengths are shares of the map's longer
 * side, not miles; the physics after it (ranges, rain, rivers) is in miles. The field is shifted so the requested
 * share of the map (not the margin) is land, then land specks and small sea holes are cleaned out. Pure.
 */
import { makeField, like, noise, warp, regions } from "./field.mjs";
import { len, exp } from "./dmath.mjs";

import { LAND_TYPES } from "./schema.mjs";
export { LAND_TYPES };
export const SIDES = ["north", "south", "east", "west"];

/** Each type's default land share. */
export const SHARE = { continents: 0.4, supercontinent: 0.6, archipelago: 0.25, island: 0.35, arc: 0.15, coastal: 0.74, landlocked: 0.97, peninsula: 0.45, "inland-sea": 0.7 };

/**
 * The shape field. frame: frameOf(plan); land: the plan's land block (normalized); seed. Returns the field (miles
 * over the frame, long side 512 px) with { share (reached), seaSide }.
 */
export function shapeField(frame, land, seed, r) {
  const f = makeField(frame.W, frame.H, 512);
  const L = Math.max(frame.mapW, frame.mapH);
  const N = (beta, key, lowShare = 0) => noise(f, beta, seed, ["shape", key], { lowCut: lowShare * L });
  const type = LAND_TYPES.includes(land.type) ? land.type : "continents";
  const rough = 0.5 + (Number.isFinite(land.coast) ? land.coast : 0.5);
  const side = SIDES.includes(land.seaSide) ? land.seaSide : r.fork("sea-side").pick(SIDES);
  // per pixel: u, v across the map (0 to 1 over its width and height; beyond it in the margin), e (distance inside
  // the map's nearest edge, as a share of L: negative in the margin), c (distance from the map's middle, share of L)
  const px = (i) => { const x = i % f.w, y = (i - x) / f.w; return [(x + 0.5) * f.cell, (y + 0.5) * f.cell]; };
  const geo = (i) => {
    const [x, y] = px(i);
    const u = (x - frame.margin) / frame.mapW, v = (y - frame.margin) / frame.mapH;
    const e = Math.min(x - frame.margin, frame.margin + frame.mapW - x, y - frame.margin, frame.margin + frame.mapH - y) / L;
    const c = len(x - frame.margin - frame.mapW / 2, y - frame.margin - frame.mapH / 2) / L;
    return { x, y, u, v, e, c };
  };
  const edgeFade = (e, width, amp) => { const t = Math.min(1, Math.max(0, e / width)); return -amp * (1 - t) * (1 - t); };
  const towardSea = (u, v) => ({ east: u, west: 1 - u, south: v, north: 1 - v })[side];
  const out = like(f);
  const d = out.data;
  const fine = N(0.95, "fine");

  if (type === "continents") {
    const big = N(1.7, "big", 0.68), mid = N(1.3, "mid");
    const base = like(f); for (let i = 0; i < d.length; i++) base.data[i] = big.data[i] + 0.45 * mid.data[i];
    const w = warp(base, N(1.6, "wx"), N(1.6, "wy"), 0.027 * L);
    for (let i = 0; i < d.length; i++) { const g = geo(i); d[i] = w.data[i] + 0.17 * rough * fine.data[i] + edgeFade(g.e, 0.1, 2.2); }
  } else if (type === "coastal") {
    const big = N(1.8, "big", 0.5), mid = N(1.3, "mid");
    const base = like(f); for (let i = 0; i < d.length; i++) { const g = geo(i); base.data[i] = 0.5 * big.data[i] + 0.24 * mid.data[i] + 4.5 * (0.5 - towardSea(g.u, g.v)); }
    const w = warp(base, N(1.6, "wx"), N(1.6, "wy"), 0.03 * L);
    for (let i = 0; i < d.length; i++) d[i] = w.data[i] + 0.12 * rough * fine.data[i];
  } else if (type === "archipelago") {
    const big = N(1.4, "big", 0.3), mid = N(1.0, "mid");
    for (let i = 0; i < d.length; i++) { const g = geo(i); d[i] = big.data[i] + 0.3 * mid.data[i] + 0.12 * rough * fine.data[i] + edgeFade(g.e, 0.08, 2); }
  } else if (type === "island") {
    const mid = N(1.5, "mid"), small = N(1.1, "small");
    const R = 0.33 * Math.min(frame.mapW, frame.mapH) / L;
    for (let i = 0; i < d.length; i++) { const g = geo(i); d[i] = 2 * (1 - g.c / R) + 0.6 * mid.data[i] + 0.25 * rough * small.data[i] + 0.1 * rough * fine.data[i] + edgeFade(g.e, 0.15, 3); }
  } else if (type === "supercontinent") {
    const mid = N(1.6, "mid"), small = N(1.2, "small");
    const R = 0.45 * Math.min(frame.mapW, frame.mapH) / L;
    const seas = Array.from({ length: 2 + r.fork("seas").int(3) }, (_, k) => { const q = r.fork("sea", k); return { u: q.range(0.3, 0.7), v: q.range(0.3, 0.7), rad: q.range(0.05, 0.1) }; });
    for (let i = 0; i < d.length; i++) {
      const g = geo(i);
      let s = 2 * (1 - g.c / R) + 0.6 * mid.data[i] + 0.25 * rough * small.data[i] + 0.1 * rough * fine.data[i] + edgeFade(g.e, 0.1, 2.5);
      for (const q of seas) { const dd = len((g.u - q.u) * frame.mapW, (g.v - q.v) * frame.mapH) / L; s -= 2.2 * Math.max(0, 1 - dd / q.rad); }
      d[i] = s;
    }
  } else if (type === "arc") {
    const mid = N(1.3, "mid");
    const q = r.fork("arc");
    const cu = q.range(0.3, 0.7), cv = q.chance(0.5) ? q.range(1.1, 1.5) : q.range(-0.5, -0.1); // (the arc's center, off the map)
    const R = len((0.5 - cu) * frame.mapW, (0.5 - cv) * frame.mapH) / L, wid = 0.06;
    for (let i = 0; i < d.length; i++) {
      const g = geo(i);
      const rr = len((g.u - cu) * frame.mapW, (g.v - cv) * frame.mapH) / L;
      d[i] = 1.6 * exp(-((rr - R) / wid) * ((rr - R) / wid)) + 0.5 * mid.data[i] + 0.12 * rough * fine.data[i] - 0.6 + edgeFade(g.e, 0.05, 1.5);
    }
  } else if (type === "landlocked") {
    const mid = N(1.6, "mid");
    for (let i = 0; i < d.length; i++) d[i] = 1 + 0.5 * mid.data[i] + 0.1 * fine.data[i];
  } else if (type === "peninsula") {
    const mid = N(1.5, "mid"), small = N(1.1, "small");
    for (let i = 0; i < d.length; i++) {
      const g = geo(i), t = towardSea(g.u, g.v), across = side === "east" || side === "west" ? g.v : g.u;
      const width = 0.38 * (1 - 0.6 * t);
      d[i] = 2.5 * (width - Math.abs(across - 0.5)) / 0.38 + 1.5 * (0.85 - t) + 0.45 * mid.data[i] + 0.2 * rough * small.data[i] + 0.1 * rough * fine.data[i];
    }
  } else if (type === "inland-sea") {
    const mid = N(1.5, "mid"), small = N(1.1, "small");
    const R = 0.28 * Math.min(frame.mapW, frame.mapH) / L;
    for (let i = 0; i < d.length; i++) { const g = geo(i); d[i] = 2 * (g.c / R - 1) + 0.6 * mid.data[i] + 0.25 * rough * small.data[i] + 0.1 * rough * fine.data[i]; }
  }

  // shift so the requested share of the map is land
  const want = Number.isFinite(land.share) ? Math.min(0.97, Math.max(0.05, land.share)) : SHARE[type];
  const inMap = [];
  for (let i = 0; i < d.length; i++) { const g = geo(i); if (g.e >= 0) inMap.push(d[i]); }
  inMap.sort((a, b) => a - b);
  const cut = inMap[Math.min(inMap.length - 1, Math.max(0, Math.floor((1 - want) * inMap.length)))] ?? 0;
  for (let i = 0; i < d.length; i++) d[i] -= cut;
  // clean: land specks under 0.2% of the map, sea holes (not reaching the frame's edge) under 0.5%
  const mapPx = (frame.mapW * frame.mapH) / (f.cell * f.cell);
  const landR = regions(out, (i) => d[i] > 0);
  for (let i = 0; i < d.length; i++) if (landR.label[i] >= 0 && landR.sizes[landR.label[i]] < 0.002 * mapPx) d[i] = -0.02;
  const seaR = regions(out, (i) => d[i] <= 0);
  for (let i = 0; i < d.length; i++) if (seaR.label[i] >= 0 && !seaR.edge[seaR.label[i]] && seaR.sizes[seaR.label[i]] < 0.005 * mapPx) d[i] = 0.02;
  let landPx = 0, mapCount = 0;
  for (let i = 0; i < d.length; i++) { const g = geo(i); if (g.e >= 0) { mapCount++; if (d[i] > 0) landPx++; } }
  out.share = landPx / Math.max(1, mapCount);
  out.seaSide = side;
  out.type = type;
  return out;
}
