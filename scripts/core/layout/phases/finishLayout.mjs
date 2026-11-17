// One phase of laying out a plan (layout/index.mjs, layoutPlan): ctx holds what the phases share.
import { LAYOUT_VERSION } from "../index.mjs";
import { LIGHT_PROPS, lightsOf, mistOf } from "../lights.mjs";
import { characterOf } from "../../character.mjs";
import { groundPatches } from "../settlement.mjs";
import { rng } from "../../rng.mjs";
import { seasonOf } from "../../roles.mjs";

/** The ground under everything, a battle map's lights and mist, and the layout put together. */
export function finishLayout(ctx) {
  const { H, W, battle, dfeats, dlist, items, labels, notes, plan, progress, sq } = ctx;
  progress(0.85, "Ground");
  items.unshift({ kind: "ground", id: "plan/ground", from: "plan", base: plan.ground, patches: groundPatches(rng(plan.seed, "ground"), W, H) },
    // (each district's outline, for a style that draws the built-up ground as one mass)
    ...dfeats.map((d) => ({ kind: "district", id: `${d.id}/outline`, from: d.id, profile: d.profile, character: characterOf(d), poly: dlist.find((x) => x.id === d.id).poly })));

  // A battle map's lights (its fires, candles, lanterns, torches and lamp posts) and the mist in its low places; a
  // plan's own fires and lamps become lights there, and on a settlement map aren't drawn
  const lit = items.filter((i) => i.kind === "prop" && LIGHT_PROPS.includes(i.class));
  if (battle) {
    items.push(...lightsOf(items, plan.seed, { size: plan.size?.squares }));
    items.push(...mistOf(items, plan.seed, { fog: plan.output?.scene?.weather === "fog" }));
  } else if (lit.length) notes.push({ level: "info", id: lit[0].from ?? lit[0].id, message: `Campfires, braziers, torches and lamp posts are drawn on battle maps only; ${lit.length === 1 ? "this one is" : `these ${lit.length} are`} left off.` });
  if (lit.length) for (let k = items.length - 1; k >= 0; k--) if (lit.includes(items[k])) items.splice(k, 1);

  const layout = {
    atlasScribe: LAYOUT_VERSION,
    plan: plan.id ?? null,
    kind: plan.kind,
    seed: plan.seed, // (for a style's own noise, which must be the same in every tile)
    size: { squares: [W, H], ftPerSquare: sq },
    season: seasonOf(plan),
    style: plan.style,
    title: typeof plan.name === "string" && plan.name.trim() ? plan.name.trim() : null,
    dressing: plan.output.dressing === true,
    sun: plan.sun,
    pxPerSquare: plan.output.pxPerSquare,
    items,
    labels,
    notes,
  };
  progress(1, "Done");
  return layout;
}
