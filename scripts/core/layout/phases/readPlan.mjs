// One phase of laying out a plan (layout/index.mjs, layoutPlan): ctx holds what the phases share.
import { labelsOf } from "../../labels.mjs";
import { normalize } from "../../plan.mjs";
import { polygonsOverlap, shapeToPolygon } from "../../geom.mjs";
import { rng } from "../../rng.mjs";
import { seedOf } from "../../seeds.mjs";
import { shrink, windAlike, withWater } from "../index.mjs";
import { smoothPlanPaths } from "../../smooth.mjs";

/**
 * Roads, rivers and walls curve through their points (the plan itself is left as it is)
 */
export function readPlan(ctx) {
  const { onProgress, rawPlan } = ctx;
  const asGiven = normalize(rawPlan); ctx.asGiven = asGiven;
  const plan = withWater(windAlike(smoothPlanPaths(asGiven)), asGiven); ctx.plan = plan;
  const sq = plan.size.ftPerSquare; ctx.sq = sq;
  // A battle map's districts build at battle size (lots/index.mjs, BATTLE_LOTS), and its yards are laid after (battle.mjs)
  const battle = plan.kind === "battle"; ctx.battle = battle;
  // (only the plan's kind says so: a district can't ask for it)
  for (const f of plan.features) if (f.type === "district") { if (battle) f.battleScale = true; else delete f.battleScale; }
  const ft = (v) => (v == null ? null : v / sq); ctx.ft = ft;
  const [W, H] = plan.size.squares; ctx.H = H; ctx.W = W;
  const notes = []; ctx.notes = notes;
  const items = []; ctx.items = items;
  // Labels: placed, or following their district or area (as the window and the scene place them)
  const labels = labelsOf(asGiven); ctx.labels = labels;
  const streamFor = (id) => rng(seedOf(plan, id), id); ctx.streamFor = streamFor; // as a reroll reads it: a seed that isn't a number is ignored
  const progress = (pct, label) => onProgress?.(pct, label); ctx.progress = progress;

  // Everything placed so far that new things keep clear of. While a district fills, what other districts placed is
  // ignored (each district's things stay inside it), so reseeding one never moves another.
  const owner = new WeakMap(); ctx.owner = owner; // a polygon or building item to the district that placed it
  const districts = plan.features.filter((f) => f.type === "district").map((f) => ({ id: f.id, poly: shapeToPolygon(f.shape) })); ctx.districts = districts;
  const districtIds = new Set(districts.map((d) => d.id));
  const touching = new Set(); ctx.touching = touching; // "a|b" for districts that overlap: free() sees each other's things there (wild trees and tracks), though houses are built over each other
  for (const a of districts) for (const b of districts) if (a !== b && polygonsOverlap(shrink(a.poly, 0.01), shrink(b.poly, 0.01))) touching.add(`${a.id}|${b.id}`);
  ctx.filling = null; // the district being filled
  let otherFor = null, other = new Map(); // owner -> whether it counts as elsewhere, while `filling` is otherFor
  const elsewhere = (o) => {
    const by = owner.get(o);
    if (ctx.filling === null || by === undefined || by === ctx.filling) return false;
    if (otherFor !== ctx.filling) { otherFor = ctx.filling; other = new Map(); }
    let v = other.get(by);
    if (v === undefined) other.set(by, (v = districtIds.has(by) && !touching.has(`${ctx.filling}|${by}`)));
    return v;
  }; ctx.elsewhere = elsewhere;
  const space = {
    reserved: [], // polygons
    zones: [], // squares and yards: open ground that gardens mustn't spill into either
    plots: [], // gardens laid so far, and every building's footprint, for gardens to keep out of
    gardens: [], // gardens laid so far, for houses to keep out of
    buildings: [], // {cx, cy, len, dep}
    ways: [], // {path, clear}: distance a new thing's edge keeps from the way's center line
    water: [],
  }; ctx.space = space;
}
