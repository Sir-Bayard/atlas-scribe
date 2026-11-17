// One step of making a city's plan from Quick Start's choices (quick-city.mjs, cityPlan): ctx holds what the steps share.
import { TAU, add, biggest, dirOf, feetOf, grown, inside, mul, outline, pt, riverForm } from "../quick-city.mjs";
import { area, bands, difference, intersect } from "../lots/poly.mjs";
import { rng } from "../rng.mjs";

/**
 * Water as polygons (to keep the wards off it) and as plan features
 */
export function cityWater(ctx) {
  const { C, H, R, S, W, features, headland, longR, longWay, r, radiusAt, seed, shape, shortR, sp, water } = ctx;
  const wet = []; ctx.wet = wet; // polygons nothing is built in
  ctx.river = null; ctx.sea = null; ctx.lake = null;
  let made = null; // (an estuary's river around an island, made with its coast)
  if (water === "coast" || water === "estuary") {
    // A coast across the map, square to the seaward direction, cutting the city a good way out from the center
    // (behind the middle, for a promontory: the sea all around it but its neck)
    const coast = (cr, extra) => {
      const d0 = R * cr.range(0.5, 0.72), d = headland ? -R * sp.range(0.95, 1.1) : d0 + extra, U = dirOf(ctx.seaward), V = [-U[1], U[0]];
      const mid = add(C, mul(U, d));
      const span = Math.hypot(W, H);
      const line = [];
      let off = 0;
      for (let s = -span; s <= span; s += 6) { off = Math.max(-3, Math.min(3, off + cr.range(-1.5, 1.5))); line.push(add(add(mid, mul(V, s)), mul(U, off))); }
      const far = line.map((p) => add(p, mul(U, span))).reverse();
      const clip = intersect([[...line, ...far]], [[[0, 0], [W, 0], [W, H], [0, H]]]);
      const big = clip.reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
      const open = big && headland ? biggest(difference([big], headland)) : big;
      return open ? outline(open) : null;
    };
    if (water === "estuary" && ctx.form === "island" && !headland) {
      // (an island and the square on it between the middle and the sea: the coast moved out only as far as the island
      // needs, so most such cities keep their harbor inside the wall)
      for (const extra of [0, 0.15, 0.3, 0.45]) {
        ctx.sea = coast(r.fork("coast", extra), R * extra);
        made = riverForm({ form: ctx.form, water, r: rng(seed, "quick", "river"), C, R, W, H, S, radiusAt, riverAngle: ctx.riverAngle, sea: ctx.sea, bendSize: shape === "shore" || shape === "cliff" ? R * 0.6 : R });
        if (made.form === "island") break;
      }
    } else ctx.sea = coast(r, 0);
    if (ctx.sea) {
      wet.push(grown(ctx.sea, 0.5)); // (the layout curves and roughens a body's shore by up to half a square)
      features.push({ id: "sea", type: "water", class: "sea", shape: ctx.sea });
    }
  }
  if (water === "lake") {
    const U = dirOf(ctx.seaward);
    let ra = R * r.range(0.6, 0.8), rb = ra * r.range(0.6, 0.85), spin = ctx.seaward + r.range(-0.6, 0.6);
    let lc = add(C, mul(U, R * r.range(0.95, 1.15) + rb * 0.3));
    // (a promontory's lake wraps around it: wide across, its middle just out from the city's)
    if (headland) { ra = R * sp.range(1.25, 1.35); rb = R * sp.range(0.98, 1.08); spin = ctx.seaward + Math.PI / 2; lc = add(C, mul(U, R * 0.1)); }
    // (a long city's lake lies along it, its near shore well into the city's side)
    else if (shape === "shore") { ra = longR * sp.range(1.0, 1.15); rb = R * sp.range(0.4, 0.5); spin = longWay; lc = add(C, mul(U, shortR * sp.range(0.55, 0.75) + rb)); }
    const n = headland ? 30 : 18, ring = [];
    for (let k = 0; k < n; k++) {
      const t = (k / n) * TAU, rr = r.range(0.9, 1.08);
      const p = [Math.cos(t) * ra * rr, Math.sin(t) * rb * rr];
      ring.push(add(lc, [p[0] * Math.cos(spin) - p[1] * Math.sin(spin), p[0] * Math.sin(spin) + p[1] * Math.cos(spin)]));
    }
    const clip = intersect(headland ? difference([ring], headland) : [ring], [[[2, 2], [W - 2, 2], [W - 2, H - 2], [2, H - 2]]]);
    const big = clip.reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
    if (big) {
      ctx.lake = outline(big);
      wet.push(grown(ctx.lake, 0.9)); // (a lake's shore is roughened more than the sea's)
      features.push({ id: "lake", type: "water", class: "lake", shape: ctx.lake });
    }
  }
  // Running water: one of four river forms, chosen or picked by the seed, so cities don't all read alike; a river
  // meeting the sea takes a form that can reach it
  ctx.rivers = []; ctx.island = null;
  if (water === "river" || water === "estuary") {
    made ??= riverForm({ form: ctx.form, water, r: rng(seed, "quick", "river"), C, R, W, H, S, radiusAt, riverAngle: ctx.riverAngle, sea: ctx.sea, bendSize: shape === "shore" || shape === "cliff" ? R * 0.6 : R });
    ctx.rivers = made.rivers.map((rv) => ({ ...rv, path: rv.path.map(pt) }));
    ctx.island = made.island;
    ctx.form = made.form;
  }
  ctx.river = ctx.rivers[0] ?? null;
  // (a city's rivers run between quays and walls: shallows on their bends only, no islands)
  for (const rv of ctx.rivers) rv.shallows = true;
  features.push(...ctx.rivers);
  // The rivers as bands nothing is built in (half their widest plus a bank), each stretch buffered and joined so a
  // bend never folds a band over itself, and a disc around a mouth where it flares into the sea
  for (const rv of ctx.rivers) {
    const ft = feetOf(rv), dense = [rv.path[0]], wide = [ft[0] / 25];
    for (let i = 1; i < rv.path.length; i++) {
      const a = rv.path[i - 1], b = rv.path[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
      for (let k = 1; k <= n; k++) { dense.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]); wide.push((ft[i - 1] + ((ft[i] - ft[i - 1]) * k) / n) / 25); }
    }
    const mouthAt = ctx.sea ? dense.findIndex((p) => inside(p, ctx.sea)) : -1;
    const halves = dense.map((_, i) => wide[i] / 2 * (mouthAt < 0 ? 1 : 1 + 0.9 * Math.max(0, 1 - Math.abs(i - mouthAt) * 0.5 / 6)) + 1.2);
    wet.push(...bands(dense.slice(1).map((p, i) => ({ path: [dense[i], p], half: Math.max(halves[i], halves[i + 1]) }))));
    if (ctx.sea && mouthAt >= 0) {
      const e = rv.path[rv.path.length - 1], rad = wide[wide.length - 1] / 2 * 1.9 + 1.2;
      wet.push(Array.from({ length: 16 }, (_, k) => add(e, mul(dirOf((k / 16) * TAU), rad))));
    }
  }
}
