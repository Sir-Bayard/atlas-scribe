/**
 * Rerolling and locking. Every district and area draws its random choices from its own stream, seeded by
 * plan.seeds[id] (else the plan's seed), so giving one a new seed redraws it and nothing else. plan.locked lists the
 * features a reroll must leave alone. Nothing here is random: a new seed comes from the old one, so rerolling the
 * same plan twice gives the same result, and rerolling again from there gives the next. Pure: runs anywhere.
 */
import { rng } from "./rng.mjs";
import { isObj } from "./plan.mjs";

/** The features a reroll can redraw: districts, areas (woods, farmsteads, parks, and the rest) and bodies of water (their shore). */
export const rerollable = (f) => isObj(f) && (f.type === "district" || f.type === "area" || f.type === "height" || (f.type === "water" && !Array.isArray(f.path) && f.shape != null)) && typeof f.id === "string";

/** A feature's seed as the layout reads it. */
export function seedOf(plan, id) {
  const own = plan?.seeds?.[id];
  return Number.isFinite(own) ? own : plan?.seed ?? 1;
}

/**
 * A copy of the plan with new seeds for the features named (ids: one id or a list), or for every rerollable feature
 * that isn't locked when ids is left out. Never touches a locked feature, the plan's own seed (which places the gates
 * where districts meet) or anything else in the plan. Returns { plan, rerolled: [id], skipped: [{ id, why }] }.
 */
export function rerollPlan(plan, ids = null) {
  const out = structuredClone(isObj(plan) ? plan : {});
  const features = Array.isArray(out.features) ? out.features : [];
  const locked = new Set(Array.isArray(out.locked) ? out.locked : []);
  const wanted = ids === null || ids === undefined ? features.filter(rerollable).map((f) => f.id) : [ids].flat();
  const rerolled = [], skipped = [];
  for (const id of wanted) {
    const f = features.find((x) => isObj(x) && x.id === id);
    if (!f) { skipped.push({ id, why: "there's no feature with that id" }); continue; }
    if (!rerollable(f)) { skipped.push({ id, why: `a ${f.type ?? "feature"} has nothing to reroll (only districts, areas, ponds, lakes and seas do)` }); continue; }
    if (locked.has(id)) { skipped.push({ id, why: "it's locked" }); continue; }
    if (!isObj(out.seeds)) out.seeds = {};
    out.seeds[id] = 1 + rng(seedOf(out, id), "reroll", id).int(2 ** 31 - 2);
    rerolled.push(id);
  }
  return { plan: out, rerolled, skipped };
}

/** A copy of the plan with the features named locked (on: true) or unlocked (on: false). Unknown ids are ignored. */
export function setLocked(plan, ids, on = true) {
  const out = structuredClone(isObj(plan) ? plan : {});
  const features = Array.isArray(out.features) ? out.features : [];
  const known = new Set(features.filter(isObj).map((f) => f.id));
  const set = new Set(Array.isArray(out.locked) ? out.locked : []);
  for (const id of [ids].flat()) if (known.has(id)) (on ? set.add(id) : set.delete(id));
  out.locked = [...set];
  return out;
}
