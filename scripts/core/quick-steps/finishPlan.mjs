// One step of making a plan from Quick Start's choices (quick.mjs, quickPlan): ctx holds what the steps share.
import { PLAN_VERSION } from "../plan.mjs";
import { distToPath, pt, slug } from "../quick.mjs";

/**
 * The name, above the districts and off the cross road
 */
export function finishPlan(ctx) {
  const { C, H, V, W, at, choices, cluster, districts, features, has, name, notables, paved, roadHalf, roads, seed, winter } = ctx;
  const top = Math.max(...cluster.flat().map((p) => -((p[0] - C[0]) * V[0] + (p[1] - C[1]) * V[1])));
  const spot = (u) => { const q = at(u, -(top + 1.3)); return [Math.max(3, Math.min(W - 3, q[0])), Math.max(1.5, Math.min(H - 1.5, q[1]))]; };
  const tries = [0, 6, -6, 10, -10, 14, -14, 18, -18].map(spot);
  const labelAt = tries.find((q) => roads.every((rd) => distToPath(q, rd.path) > roadHalf(rd) + 1.2) && !(ctx.water && distToPath(q, ctx.water.path) < ctx.water.width / 25 / 2 + 1)) ?? tries[1];

  // Roads first, then the rest, so the plan reads from the outside in
  const plan = {
    atlasScribe: PLAN_VERSION,
    id: `${slug(name)}-${seed}`, // the seed too, so two Quick Starts that drew the same name don't share a file or a scene
    name,
    kind: "settlement",
    size: { squares: [W, H], ftPerSquare: 25 },
    season: choices.season,
    sun: winter ? "low-south" : "high-south",
    seed,
    ground: winter ? "snow" : "grass",
    features: [
      // (a paved place's main and cross roads are cobbled)
      ...roads.map((rd) => ({ id: rd.id, type: "road", class: rd.class, ...(paved && rd.class !== "lane" ? { surface: "cobble" } : {}), path: rd.path.map(pt) })),
      ...features.filter((f) => f.type === "water" || f.type === "crossing"),
      ...features.filter((f) => f.type === "square"),
      ...districts.map((d) => ({ id: d.id, type: "district", profile: d.profile, ...(Object.keys(notables).length ? { notables } : {}), shape: d.poly })),
      ...(ctx.walled ? [ctx.walled] : []),
      ...features.filter((f) => f.type === "area" || f.type === "wall"),
      ...features.filter((f) => f.type === "building" || f.type === "prop"),
      { id: "name", type: "label", text: name, at: pt(labelAt), show: "gm", size: "huge" },
    ],
    output: { scene: { name, weather: winter ? "snow" : null } },
  };
  // (what it has, for the dialog: what was asked, else what a place of its size gets)
  const got = (id) => features.some((f) => f.id === id || f.id?.startsWith?.(`${id}-`));
  const hasOut = {
    temple: has.temple ?? choices.size !== "hamlet",
    inn: has.inn ?? choices.size !== "hamlet",
    smithy: has.smithy ?? (choices.size !== "hamlet" || null), // (a hamlet: now and then, null for the dialog)
    cemetery: got("cemetery"),
    watermill: got("watermill"),
    windmill: got("windmill"),
    walled: !!ctx.walled,
  };
  return { plan, choices: { ...choices, has: hasOut, seed, name } };
}
