/**
 * Landmass recipes: the shape field (land above 0, sea below) over the frame, from a few primitives (spectral noise
 * with its longest waves cut, domain warp, a tilt toward a side, the map's edge sinking, blobs, rings). A recipe is
 * about the map's composition (where land and sea lie in the picture), so its lengths are shares of the map's longer
 * side, not miles; the physics after it (ranges, rain, rivers) is in miles. The field is shifted so the requested
 * share of the map (not the margin) is land, then land specks and small sea holes are cleaned out. Pure.
 */
import { makeField, like, noise, warp, regions } from "./field.mjs";
import { len, exp, cos, sin, pow, PI } from "./dmath.mjs";

import { LAND_TYPES } from "./schema.mjs";
export { LAND_TYPES };
export const SIDES = ["north", "south", "east", "west"];

/**
 * An archipelago's islands: [{ u, v (across the map), r (share of the long side), s (stretch), rot }], the largest
 * first: radii by a power law along two or three arcs, and a hot-spot chain of a few shrinking ones. q: the recipe's
 * stream; want: the land share asked for.
 */
export function archipelagoIsles(q, frame, L, want = 0.25) {
  const sx = Math.max(frame.mapW, frame.mapH) / frame.mapW, sy = Math.max(frame.mapW, frame.mapH) / frame.mapH;
  // (each arc passes through the map: its middle lies inside, its center off to one side)
  const count = 22 + q.int(11), arcs = Array.from({ length: 2 + q.int(2) }, (_, k) => {
    const a = q.fork("arc", k), mu = a.range(0.2, 0.8), mv = a.range(0.2, 0.8), R = a.range(0.25, 0.55), t0 = a.range(0, 2 * PI);
    return { cu: mu - R * cos(t0) * sx, cv: mv - R * sin(t0) * sy, R, t0, span: a.range(1, 2) };
  });
  const out = [];
  // (clear of the islands already placed by more than their reach, so they stay apart; an island's reach is its long
  // half-axis, r times the root of its stretch s)
  const clear = (u, v, r, s = 1) => out.every((k) => len((u - k.u) / sx, (v - k.v) / sy) > (r * Math.sqrt(s) + k.r * Math.sqrt(k.s)) * 1.3);
  const inside = (u, v, m) => u > m && u < 1 - m && v > m && v < 1 - m;
  // (the radii scaled so the islands together come to about the land asked for, as the share's cut would otherwise
  // swell them into one another; none smaller than the specks the field's cleaning takes away)
  const base = Array.from({ length: count }, (_, k) => 0.13 * pow(k + 1, -0.55));
  const area = base.reduce((t, r) => t + PI * r * r, 0) + 0.008, mapArea = (frame.mapW * frame.mapH) / (L * L);
  const fit = Math.min(2.2, Math.max(0.5, Math.sqrt((want * mapArea) / area)));
  const least = 1.4 * Math.sqrt((0.002 * mapArea) / PI);
  for (let k = 0; k < count; k++) {
    const a = arcs[k % arcs.length], p = q.fork("isle", k), r = Math.max(least, base[k] * fit);
    let done = false;
    for (let tries = 0; tries < 24 && !done; tries++) {
      const t = a.t0 + p.range(-0.5, 0.5) * a.span, R = a.R * (1 + p.range(-0.12, 0.12));
      const u = a.cu + R * cos(t) * sx, v = a.cv + R * sin(t) * sy;
      // (stretched along the arc, as islands on a ridge are)
      const st = p.range(1, 2.4), rot = t + PI / 2 + p.range(-0.4, 0.4);
      if (inside(u, v, 0.06) && clear(u, v, r, st)) { out.push({ u, v, r, s: st, rot }); done = true; }
    }
    // (an island its arc has no room for goes anywhere clear in the map)
    for (let tries = 0; tries < 24 && !done; tries++) { const u = p.range(0.08, 0.92), v = p.range(0.08, 0.92), st = p.range(1, 1.8), rot = p.range(0, PI); if (clear(u, v, r, st)) { out.push({ u, v, r, s: st, rot }); done = true; } }
  }
  // (a hot-spot chain: a line of islands, each smaller than the one before)
  const c = q.fork("chain"), cu = c.range(0.15, 0.85), cv = c.range(0.15, 0.85), ang = c.range(0, 2 * PI);
  for (let k = 0; k < 5; k++) { const u = cu + 0.07 * k * cos(ang), v = cv + 0.07 * k * sin(ang), r = Math.max(least, 0.04 * pow(0.7, k)); if (inside(u, v, 0.04) && clear(u, v, r)) out.push({ u, v, r, s: 1, rot: 0 }); }
  return out;
}

/**
 * A world's land: { masses: [{ u, v, r, stretch, rot }] (one or two great, two or three middling, sized to the land
 * share want), isles: [the same, small, strung along arcs], ocean: { u, v, r } (an open ocean kept clear) }. q: the
 * recipe's stream.
 */
export function worldMasses(q, frame = { mapW: 2, mapH: 1 }, L = 2, want = 0.4) {
  // (distances in shares of the long side, so a wide map's masses stay as far apart as they look)
  const W = frame.mapW / L, H = frame.mapH / L, dist = (u, v, p) => len((u - p.u) * W, (v - p.v) * H);
  const ocean = { u: q.range(0.2, 0.8), v: q.range(0.25, 0.75), r: q.range(0.15, 0.2) };
  // (each mass's share of the land: one great continent and a large second one, or two great and smaller ones; the
  // radii from the land asked for, so the share's cut neither swells them together nor shrinks them away)
  const greats = 1 + q.int(2), mids = 2 + q.int(2);
  const shares = greats === 1 ? [0.55, 0.2, 0.12, 0.08] : [0.4, 0.3, 0.12, 0.08, 0.06];
  const parts = shares.slice(0, greats + mids), total = parts.reduce((t, x) => t + x, 0);
  const landArea = 0.95 * want * W * H;
  const masses = [];
  // (a mass reaches r·stretch along its long axis; masses keep that reach and a gap apart, and clear of the ocean)
  parts.forEach((part, k) => {
    const p = q.fork("mass", k);
    for (let t = 0; t < 60; t++) {
      const shrink = 1 - t / 120, r = shrink * Math.sqrt(((part / total) * landArea) / PI), stretch = p.range(1, 1.5), reach = r * stretch;
      const u = p.range(0.1, 0.9), v = p.range(0.12, 0.88);
      if (dist(u, v, ocean) > ocean.r + reach * 0.6 && masses.every((m) => dist(u, v, m) > (m.r * m.stretch + reach) * 1.05 + 0.025)) { masses.push({ u, v, r, stretch, rot: p.range(0, PI) }); return; }
    }
  });
  // (island arcs out at sea: strings of small islands along a curve, clear of the masses and of each other)
  const isles = [];
  for (let k = 0; k < 1 + q.int(2); k++) {
    const a = q.fork("arc", k), R = a.range(0.12, 0.25), cu = a.range(0.1, 0.9), cv = a.range(0.1, 0.9), t0 = a.range(0, 2 * PI), span = a.range(0.8, 1.6);
    for (let j = 0; j < 7; j++) {
      const t = t0 + (j / 6 - 0.5) * span, u = cu + (R * cos(t)) / W, v = cv + (R * sin(t)) / H, r = a.range(0.022, 0.04), stretch = a.range(1.2, 2);
      if (u < 0.05 || u > 0.95 || v < 0.05 || v > 0.95) continue;
      if ([...masses, ...isles].every((m) => dist(u, v, m) > (m.r * m.stretch + r * stretch) * 1.2 + 0.015)) isles.push({ u, v, r, stretch, rot: t + PI / 2 });
    }
  }
  return { masses, isles, ocean };
}

/** Each type's default land share. */
export const SHARE = { continents: 0.4, supercontinent: 0.6, archipelago: 0.25, island: 0.35, arc: 0.15, coastal: 0.74, landlocked: 0.97, peninsula: 0.45, "inland-sea": 0.7 };

/**
 * The shape field. frame: frameOf(plan); land: the plan's land block (normalized); seed; opts.gen: the generator
 * whose recipes to use (from 3, archipelagos with islands by a size law along arcs and chains, and continents on a
 * continent's or a world's map as one or two large continents, a few smaller, island arcs and an open ocean);
 * opts.scale: the map's scale class. Returns the field (miles over the frame, long side 512 px) with { share
 * (reached), seaSide }.
 */
export function shapeField(frame, land, seed, r, { gen = 3, scale = null } = {}) {
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

  const bigScale = scale === "continent" || scale === "world";
  if (gen >= 3 && type === "archipelago") {
    // islands by a size law (one large, a few middling, many small) strung along arcs and a hot-spot chain
    const mid = N(1.2, "mid"), q = r.fork("isles");
    const isles = archipelagoIsles(q, frame, L, Number.isFinite(land.share) ? land.share : SHARE.archipelago).map((k) => ({ ...k, c: cos(k.rot), s1: sin(k.rot) }));
    const wx = N(1.6, "wx"), wy = N(1.6, "wy");
    for (let i = 0; i < d.length; i++) {
      const g = geo(i), wu = g.u + (0.012 * L * wx.data[i]) / frame.mapW, wv = g.v + (0.012 * L * wy.data[i]) / frame.mapH;
      let best = -1.5;
      for (const k of isles) {
        const du = ((wu - k.u) * frame.mapW) / L, dv = ((wv - k.v) * frame.mapH) / L, q2 = Math.sqrt(k.s);
        const a = (du * k.c + dv * k.s1) / q2, b = (-du * k.s1 + dv * k.c) * q2;
        const v = 1 - len(a, b) / k.r; if (v > best) best = v;
      }
      // (the noise is on the islands' own scale, so small ones are as ragged as large)
      d[i] = 2 * best + 0.3 * mid.data[i] + 0.12 * rough * fine.data[i] + edgeFade(g.e, 0.06, 2);
    }
  } else if (gen >= 3 && type === "continents" && bigScale) {
    // a world of one or two great continents, a few smaller ones, island arcs, and an open ocean kept clear
    const mid = N(1.4, "mid"), q = r.fork("world"), want = Number.isFinite(land.share) ? Math.min(0.97, Math.max(0.05, land.share)) : SHARE.continents;
    const W = worldMasses(q, frame, L, want), all = [...W.masses, ...W.isles].map((m) => ({ ...m, c: cos(m.rot), s1: sin(m.rot) }));
    const wx = N(1.7, "wx"), wy = N(1.7, "wy"), gap = new Uint8Array(d.length);
    for (let i = 0; i < d.length; i++) {
      const g = geo(i), wu = g.u + (0.05 * L * wx.data[i]) / frame.mapW, wv = g.v + (0.05 * L * wy.data[i]) / frame.mapH;
      let best = -1.5, second = -1.5;
      for (const m of all) {
        const du = ((wu - m.u) * frame.mapW) / L, dv = ((wv - m.v) * frame.mapH) / L;
        const a = du * m.c + dv * m.s1, b = -du * m.s1 + dv * m.c;
        const v = 1 - len(a / m.stretch, b * m.stretch) / m.r;
        if (v > best) { second = best; best = v; } else if (v > second) second = v;
      }
      // (where two lands are about as near as each other: the strait between them)
      gap[i] = best - second < 0.28 ? 1 : 0;
      const oc = len((g.u - W.ocean.u) * frame.mapW, (g.v - W.ocean.v) * frame.mapH) / L;
      d[i] = 2 * best + 0.5 * mid.data[i] + 0.15 * rough * fine.data[i] - 2.5 * Math.max(0, 1 - oc / W.ocean.r) + edgeFade(g.e, 0.05, 1.5);
    }
    // (the straits cut after the share's level is found, so however far the cut moves the coasts, the lands stay apart;
    // well below it, so the final cut and the cleaning, a little lower for the land the straits take, leave them sea)
    const inMap = []; for (let i = 0; i < d.length; i++) if (geo(i).e >= 0) inMap.push(d[i]);
    inMap.sort((p, q2) => p - q2);
    const level = inMap[Math.min(inMap.length - 1, Math.max(0, Math.floor((1 - want) * inMap.length)))] ?? 0;
    for (let i = 0; i < d.length; i++) if (gap[i]) d[i] = Math.min(d[i], level - 0.6);
  } else if (type === "continents") {
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
