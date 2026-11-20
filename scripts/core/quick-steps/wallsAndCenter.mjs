// One step of making a plan from Quick Start's choices (quick.mjs, quickPlan): ctx holds what the steps share.
import { HAS, add, clipToMap, distToPath, distToPoly, inside, mul, outline, pt } from "../quick.mjs";
import { PAVINGS, UNPAVED, squareShape } from "../squares.mjs";
import { offset, area as polyArea, union } from "../lots/poly.mjs";
import { wallReach } from "../layout/walls.mjs";

/**
 * What's asked for or left out (has: { temple, inn, smithy, cemetery, watermill, windmill, walled })
 */
export function wallsAndCenter(ctx) {
  const { C, H, S, U, V, W, arms, at, choices, cluster, features, r, roadHalf, roads, theta } = ctx;
  const has = Object.fromEntries(HAS.filter((k) => ctx.options.has?.[k] === true || ctx.options.has?.[k] === false).map((k) => [k, ctx.options.has[k]])); ctx.has = has;
  const notables = Object.fromEntries(["temple", "inn", "smithy"].filter((k) => k in has).map((k) => [k, has[k]])); ctx.notables = notables;
  // Walled: a palisade (a town's stone wall) around the districts, just outside them, everything after keeping off it
  ctx.walled = null;
  if (has.walled) {
    // (towers wider apart than a city's: a village's palisade has a few, not dozens)
    const wall = { type: "wall", class: choices.size === "town" ? "town" : "palisade", straight: true, towerSpacing: choices.size === "town" ? 200 : 260 };
    const ring = offset(union(cluster), wallReach(wall, 25) + 0.4).reduce((a, b) => (!a || polyArea(b) > polyArea(a) ? b : a), null);
    if (ring && ring.length >= 3) {
      const path = clipToMap(ring.map(pt), W, H, 1.5);
      ctx.walled = { id: "town-wall", ...wall, path: [...path, [...path[0]]] };
      cluster.push(path);
    }
  }
  const nearCluster = (p, m) => cluster.some((poly) => distToPoly(p, poly) < m); ctx.nearCluster = nearCluster;

  // The center: a square where the roads meet, or a green beside them (its paving, its roads' and its shape from its
  // own stream: a town paves about half the time, a village seldom)
  const sr = r.fork("square");
  const paved = choices.size === "town" ? sr.chance(0.55) : choices.size === "village" ? sr.chance(0.12) : false; ctx.paved = paved;
  const paving = sr.pick(PAVINGS), bare = choices.size === "hamlet" ? "trodden" : sr.pick(UNPAVED);
  if (choices.center === "square") {
    const kinds = choices.size === "hamlet" ? ["circle", "irregular"] : choices.size === "village" ? ["circle", "rect", "irregular", "triangle"] : undefined;
    const sh = squareShape({ r: sr.fork("shape"), C, angle: (theta * Math.PI) / 180, rad: S.square, fork: choices.roads === "fork", kinds, arms: arms.map((a) => Math.atan2(a[1][1] - a[0][1], a[1][0] - a[0][0])) });
    features.push({ id: "square", type: "square", shape: sh.shape, surface: paved ? paving : bare, radial: choices.size === "town" && sh.radial, market: true, name: sh.kind === "street" ? "The Market Street" : "The Square" });
  }
  // A well: beside the main road where the roads meet, with no square or green
  if (choices.center === "well") features.push({ id: "well", type: "prop", class: "well", at: pt(at(0, roadHalf(roads[0]) + 0.9)) });
  ctx.green = null;
  if (choices.center === "green") {
    // In the widest gap between the roads leaving the center, clear of them
    const angles = roads.flatMap((rd) => {
      const i = rd.path.findIndex((p) => Math.hypot(p[0] - C[0], p[1] - C[1]) < 1e-6);
      const out = [];
      if (i > 0) out.push(Math.atan2(rd.path[i - 1][1] - C[1], rd.path[i - 1][0] - C[0]));
      if (i >= 0 && i < rd.path.length - 1) out.push(Math.atan2(rd.path[i + 1][1] - C[1], rd.path[i + 1][0] - C[0]));
      return out;
    }).sort((a, b) => a - b);
    let best = 0, gap = -1;
    angles.forEach((a, i) => {
      const b = i + 1 < angles.length ? angles[i + 1] : angles[0] + 2 * Math.PI;
      if (b - a > gap) { gap = b - a; best = (a + b) / 2; }
    });
    const [gw, gd] = S.green;
    const D = [Math.cos(best), Math.sin(best)];
    // Pushed out from the center until it's clear of every road (they wander a little once past the center)
    for (let push = 0; push < 6 && !ctx.green; push++) {
      const off = Math.hypot(gw, gd) / 2 / Math.max(0.5, Math.sin(Math.min(gap, Math.PI) / 2)) + roadHalf(roads[0]) + 0.8 + push;
      const gc = add(C, mul(D, off));
      const g = outline(clipToMap([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => pt(add(add(gc, mul(U, (a * gw) / 2)), mul(V, (b * gd) / 2)))), W, H));
      const edge = g.flatMap((p, i) => { const q = g[(i + 1) % g.length]; return [0, 0.25, 0.5, 0.75].map((t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); });
      if (g.length >= 3 && roads.every((rd) => edge.every((p) => distToPath(p, rd.path) > roadHalf(rd) + 0.4) && rd.path.every((p) => !inside(p, g)))) ctx.green = g;
    }
    if (ctx.green) features.push({ id: "green", type: "area", class: "park", style: "green", shape: ctx.green });
  }
}
