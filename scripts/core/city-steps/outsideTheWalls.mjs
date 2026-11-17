// One step of making a city's plan from Quick Start's choices (quick-city.mjs, cityPlan): ctx holds what the steps share.
import { countryside, pt } from "../quick-city.mjs";
import { rng } from "../rng.mjs";

/**
 * Outside the walls: suburbs along the roads beyond some gates, then farms, fields and woods (the country)
 */
export function outsideTheWalls(ctx) {
  const { C, H, R, S, W, choices, citadel, crossingsOut, districts, docks, features, inWater, ringPoly, roads, seed, shape, wall, wet } = ctx;
  const outside = countryside({ choices, C, R, W, H, wallPoly: ctx.wallPoly, wall, roads: roads.filter((rd) => rd.angle !== undefined), wet, inWater, rivers: ctx.rivers, sea: ctx.sea, lake: ctx.lake, r: rng(seed, "quick", "city-country") });

  // The name above the city
  const top = Math.min(...ctx.wallPoly.map((p) => p[1]));
  const label = { at: pt([Math.max(6, Math.min(W - 6, C[0])), Math.max(1.5, top - 3)]) };

  return {
    W, H, px: S.px, center: C, wallPoly: ctx.wallPoly, ringPoly, river: ctx.form, shape: ctx.cliff || shape !== "cliff" ? shape : "compact",
    features: [
      ...(ctx.cliff ? [ctx.cliff] : []),
      ...roads.map(({ angle, ...rd }) => rd),
      ...features.filter((f) => f.type === "water"),
      ...crossingsOut,
      ...docks,
      ...features.filter((f) => f.type === "square"),
      wall,
      ...(ctx.oldWall ? [ctx.oldWall] : []),
      ...(citadel ? citadel.features : []),
      ...districts,
      ...(ctx.greens ?? []),
      ...outside,
    ],
    label,
  };
}
