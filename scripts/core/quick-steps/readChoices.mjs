// One step of making a plan from Quick Start's choices (quick.mjs, quickPlan): ctx holds what the steps share.
import { CENTERS, CITIES, PICK, QUICK, QUICK_ANY, SHORES, SIZES, cityQuick, placeName } from "../quick.mjs";
import { CITY_SHAPES, CITY_WATER, RIVER_FORMS, SHAPE_FORMS, SHAPE_WATER } from "../quick-city.mjs";
import { rng } from "../rng.mjs";
import { readDirections } from "../directions.mjs";

/** The choices: each one asked for, else picked from the seed; a city or metropolis is handed to cityQuick here. */
export function readChoices(ctx) {
  if (ctx.options.center === undefined && ctx.options.centre !== undefined) ctx.options = { ...ctx.options, center: ctx.options.centre }; // the name before 0.4.0, still read
  const seed = Number.isFinite(Number(ctx.options.seed)) && Number(ctx.options.seed) >= 1 ? Math.floor(Number(ctx.options.seed)) : 1; ctx.seed = seed;
  const pick = rng(seed, "quick", "choices");
  // (the way its roads, river and shore lie, when a region map gives them: Make This Town)
  ctx.dirs = readDirections(ctx.options.directions);
  const choices = {}; ctx.choices = choices;
  for (const [k, list] of Object.entries(QUICK)) if (!QUICK_ANY.includes(k)) choices[k] = list.includes(ctx.options[k]) ? ctx.options[k] : pick.pick(PICK[k] ?? list);
  if (RIVER_FORMS.includes(ctx.options.river)) choices.river = ctx.options.river;
  // (a center the size can't have: a well or a landmark's square becomes a square)
  if (!CENTERS[choices.size].includes(choices.center)) choices.center = "square";
  // A city's water left out is any a city can have, a stream is a river there; its outline the one asked for when it
  // goes with the water, else one that does
  if (CITIES.includes(choices.size)) {
    const asked = CITY_SHAPES.includes(ctx.options.shape) ? ctx.options.shape : null;
    // (a river form asked for means a river)
    if (!QUICK.water.includes(ctx.options.water)) choices.water = RIVER_FORMS.includes(ctx.options.river) ? "river" : rng(seed, "quick", "city-water").pick(asked ? SHAPE_WATER[asked] : CITY_WATER);
    else if (choices.water === "stream") choices.water = "river";
    // (and with the river's form, when one is asked for)
    const fits = CITY_SHAPES.filter((k) => SHAPE_WATER[k].includes(choices.water) && !(choices.water === "river" && RIVER_FORMS.includes(ctx.options.river) && SHAPE_FORMS[k] && !SHAPE_FORMS[k].includes(ctx.options.river)));
    choices.shape = asked && fits.includes(asked) ? asked : rng(seed, "quick", "city-shape-pick").pick(fits);
    return cityQuick(choices, seed, ctx.options);
  }
  // (a village or town by the sea or a lake has its shore; a river mouth is a city's, so one asked for there is a
  // river, as before)
  if (!PICK.water.includes(choices.water) && !SHORES.includes(choices.water)) choices.water = "river";
  delete choices.river; // (a city's)
  delete choices.shape;
  const S = SIZES[choices.size]; ctx.S = S;
  const [W, H] = S.squares; ctx.H = H; ctx.W = W;
  const r = rng(seed, "quick", "layout"); ctx.r = r;
  const name = String(ctx.options.name ?? "").trim() || placeName(rng(seed, "quick", "name"), choices.water); ctx.name = name;
  const winter = choices.season === "winter"; ctx.winter = winter;
  const features = []; ctx.features = features;
}
