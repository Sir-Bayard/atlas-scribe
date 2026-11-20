// One step of making a city's plan from Quick Start's choices (quick-city.mjs, cityPlan): ctx holds what the steps share.
import { CITY_SHAPES, CITY_SIZES, CITY_WATER, RIVER_FORMS, SHAPE_FORMS, SHAPE_WATER, TAU, add, dirOf, mul, pt, toEdge } from "../quick-city.mjs";
import { rng } from "../rng.mjs";
import { union } from "../lots/poly.mjs";

/** The city's size, outline, water side and wall: its corners, a promontory's land, the river's form. */
export function cityOutline(ctx) {
  const { choices, seed } = ctx;
  const S = CITY_SIZES[choices.size]; ctx.S = S;
  const [W, H] = S.squares; ctx.H = H; ctx.W = W;
  const r = rng(seed, "quick", "city"); ctx.r = r;
  const winter = choices.season === "winter";
  const water = CITY_WATER.includes(choices.water) ? choices.water : "river"; ctx.water = water;
  const features = []; ctx.features = features;
  const C0 = [W / 2 + r.range(-0.05, 0.05) * W, H / 2 + r.range(-0.05, 0.05) * H];
  const R = S.R; ctx.R = R;
  // Its outline (one that doesn't go with its water is lobed), from a stream of its own, so a compact city draws as
  // it always has
  const shape = CITY_SHAPES.includes(choices.shape) && SHAPE_WATER[choices.shape].includes(water) ? choices.shape : choices.shape ? "lobed" : "compact"; ctx.shape = shape;
  const sp = rng(seed, "quick", "city-shape"); ctx.sp = sp;

  // Which way the sea or the lake lies, and the river's line
  ctx.seaward = r.next() * TAU;
  ctx.riverAngle = water === "estuary" ? ctx.seaward + r.range(-0.4, 0.4) : r.next() * Math.PI;
  // (a long city lies along the map's long side, and its shore or river with it)
  if (shape === "shore") {
    if (water === "river") ctx.riverAngle = sp.range(-0.3, 0.3);
    else {
      ctx.seaward = (sp.chance(0.5) ? 1 : -1) * (Math.PI / 2) + sp.range(-0.3, 0.3);
      if (water === "estuary") ctx.riverAngle = ctx.seaward + sp.range(-0.3, 0.3);
    }
  }
  // (the region's own directions, when it gives them: its sea or lake on that side, its river running that way)
  const D = ctx.dirs;
  if (D && (water === "coast" || water === "estuary") && D.coast !== null) {
    // (a river mouth's river turns with its sea, so it still reaches it)
    const turn = (D.coast * Math.PI) / 180 - ctx.seaward;
    ctx.seaward += turn;
    if (water === "estuary") ctx.riverAngle += turn;
  }
  else if (D && water === "lake" && (D.lake ?? D.coast) !== null) ctx.seaward = ((D.lake ?? D.coast) * Math.PI) / 180;
  // (a river mouth's given flow is kept within a right angle of its sea, so it runs out to it)
  if (D && D.flow !== null && water === "river") ctx.riverAngle = (D.flow * Math.PI) / 180;
  if (D && D.flow !== null && water === "estuary") {
    const f = (D.flow * Math.PI) / 180, off = Math.atan2(Math.sin(f - ctx.seaward), Math.cos(f - ctx.seaward));
    ctx.riverAngle = ctx.seaward + Math.max(-0.5, Math.min(0.5, off));
  }
  // (a city on a promontory sits a little out to sea from the map's middle, so there's room for the country behind)
  const C = shape === "promontory" ? add(C0, mul(dirOf(ctx.seaward), R * 0.25)) : C0; ctx.C = C;

  // The wall: a ring of straight runs between corners, its radius swelling and narrowing slowly around the city
  const a2 = r.range(0.04, 0.1), p2 = r.next() * TAU, a3 = r.range(0.03, 0.07), p3 = r.next() * TAU, stretch = r.range(1, 1.18), tilt = r.next() * Math.PI;
  // A lobed city swells and narrows more, in more lobes; a long one is an ellipse along its shore or river
  const lobes = shape === "lobed" ? [[sp.range(0.1, 0.18), 2], [sp.range(0.08, 0.14), 3], [sp.range(0.05, 0.1), 4], [sp.range(0.03, 0.06), 5]].map(([amp, n]) => [amp, n, sp.next() * TAU]) : [];
  const longWay = water === "river" ? ctx.riverAngle : ctx.seaward + Math.PI / 2; ctx.longWay = longWay;
  const longR = Math.min(R * sp.range(1.4, 1.6), toEdge(C, dirOf(longWay), W, H) - 16, toEdge(C, dirOf(longWay + Math.PI), W, H) - 16), shortR = R * sp.range(0.68, 0.76); ctx.shortR = shortR; ctx.longR = longR;
  const radiusAt = (a) => {
    if (shape === "shore") return (1 / Math.hypot(Math.cos(a - longWay) / longR, Math.sin(a - longWay) / shortR)) * (1 + a3 * 0.5 * Math.sin(3 * a + p3));
    const along = Math.cos(a - tilt) ** 2 * stretch + Math.sin(a - tilt) ** 2; // a little longer one way
    let k = 1 + a2 * Math.sin(2 * a + p2) + a3 * Math.sin(3 * a + p3);
    for (const [amp, n, ph] of lobes) k += amp * Math.sin(n * a + ph);
    return R * along * Math.max(0.55, k);
  }; ctx.radiusAt = radiusAt;
  const corners = (choices.size === "metropolis" ? 22 + r.int(6) : 14 + r.int(5)) + (shape === "lobed" || shape === "shore" ? 6 + sp.int(4) : 0);
  ctx.wallPoly = Array.from({ length: corners }, (_, k) => {
    const a = (k + r.range(-0.3, 0.3)) * (TAU / corners);
    return pt(add(C, mul(dirOf(a), radiusAt(a) * r.range(0.97, 1.03))));
  });

  // A promontory: the land around the city's middle, smaller than its wall (so the wall stands in the water but where
  // it crosses the neck), and a neck of land back to the shore
  const headland = shape === "promontory" ? (() => {
    const U = dirOf(ctx.seaward), V = [-U[1], U[0]], f = sp.range(0.8, 0.86), nw = R * sp.range(0.3, 0.42);
    const blob = Array.from({ length: 36 }, (_, k) => { const a = (k / 36) * TAU; return add(C, mul(dirOf(a), radiusAt(a) * f * sp.range(0.97, 1.03))); });
    const neck = [];
    for (let s = 0; s <= R * 3; s += 4) neck.push(add(add(C, mul(U, -s)), mul(V, nw * (1 + 0.6 * (s / (R * 3)) ** 2) * sp.range(0.92, 1.08))));
    for (let s = R * 3; s >= 0; s -= 4) neck.push(add(add(C, mul(U, -s)), mul(V, -nw * (1 + 0.6 * (s / (R * 3)) ** 2) * sp.range(0.92, 1.08))));
    return union([blob, neck]);
  })() : null; ctx.headland = headland;

  // The river's form, the choice's or picked by the seed (first, since a river meeting the sea around an island needs
  // the coast farther off: the island and the square on it lie between the city's middle and the sea)
  ctx.form = null;
  if (water === "river" || water === "estuary") {
    const forms = water === "estuary" ? ["meander", "island", "meeting"] : SHAPE_FORMS[shape] ?? RIVER_FORMS;
    // (a loop can't reach the sea: it bends through instead)
    ctx.form = choices.river === "loop" && water === "estuary" ? "meander" : forms.includes(choices.river) ? choices.river : forms[rng(seed, "quick", "river-form").int(forms.length)];
  }
}
