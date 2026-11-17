/**
 * Quick Start: a few choices in, a plan out. The plan is an ordinary plan (roads, water, crossings, a square or a
 * green, districts, farmsteads, woods, field systems and a label), so everything after it (the preview, rerolls,
 * reshaping, render and publish) works on it as on any other. Every choice left out is picked from the seed, and the
 * same choices and seed always give the same plan. Pure: runs anywhere. Numbers are in squares (25 ft).
 */
import { rng } from "./rng.mjs";
import { PLAN_VERSION } from "./plan.mjs";
import { cityPlan, RIVER_FORMS, CITY_SHAPES } from "./quick-city.mjs";
import { readChoices, roadsAndDistricts, wallsAndCenter, waterBeyond, millsAndCemetery, farmsAndFields, woodsAndCliffs, finishPlan, highGround } from "./quick-steps/index.mjs";

/** The choices Quick Start offers, the first of each being the one shown first. */
export const QUICK = {
  size: ["village", "hamlet", "town", "city", "metropolis"],
  season: ["summer", "spring", "autumn", "winter"],
  water: ["river", "stream", "coast", "lake", "estuary", "none"],
  roads: ["crossroads", "through", "fork"],
  center: ["square", "green", "none", "well", "cathedral", "palace"],
  surroundings: ["mixed", "farmland", "woodland", "open"],
  river: RIVER_FORMS, // a city's river (left out, the seed picks; the dialog shows Any first)
  shape: CITY_SHAPES, // a city's outline (the same)
};

/** High ground along an edge of a village's or town's map: none unless asked (so older seeds make the same places). */
export const QUICK_HIGH = ["none", "hills", "mountains"];
export const QUICK_HIGH_LABELS = { none: "None", hills: "Hills along an edge", mountains: "Mountains along an edge" };

/** Choices the dialog leaves on Any unless they're picked, and that only some places use. */
export const QUICK_ANY = ["river", "shape"];

/**
 * What a choice left out is picked from: the sizes and water a village or town can have (a city only when asked, so
 * earlier seeds' plans stay the same).
 */
export const PICK = { size: ["village", "hamlet", "town"], water: ["river", "stream", "none"], center: ["square", "green", "none"] };
export const CITIES = ["city", "metropolis"];

/** The centers each size can have (the dialog grays out the rest). */
export const CENTERS = {
  hamlet: ["green", "well", "square", "none"],
  village: ["green", "square", "well", "none"],
  town: ["square", "green", "well", "none"],
  city: ["square", "cathedral", "palace", "green", "none"],
  metropolis: ["square", "cathedral", "palace", "green", "none"],
};

/** A village's or town's buildings and places that can be asked for or left out (has: { key: true | false }). */
export const HAS = ["temple", "inn", "smithy", "cemetery", "watermill", "windmill", "walled"];

/** A city's quarters (all of them unless some are left out), and what lies outside its walls. */
export const QUARTERS = ["docks", "market", "temple", "nobles", "crafts", "poor", "garrison", "merchants"];
export const OUTSIDE = ["citadel", "oldWall", "suburbs", "cemetery", "mills"];

/** Why a choice can't be had for a size (the dialog's tooltips), by choice and value. */
export function quickLacks(size) {
  const city = CITIES.includes(size), lacks = {};
  for (const c of QUICK.center) if (!CENTERS[size]?.includes(c)) (lacks.center ??= {})[c] = city ? "A city's center is a square, a green or a landmark beside a square" : c === "well" ? "" : "A cathedral or a palace is a city's";
  if (!city) for (const w of ["coast", "lake", "estuary"]) (lacks.water ??= {})[w] = "A city's (a village or town by the sea or a lake gets a river)";
  if (city) (lacks.water ??= {}).stream = "A city's water is a river at least";
  if (size === "city") (lacks.outside ??= {}).oldWall = "A metropolis's (its old town's wall inside the new)";
  if (!city) { lacks.river = "A city's"; lacks.shape = "A city's"; }
  return lacks;
}

/** How each choice reads in the Quick Start dialog. */
export const QUICK_LABELS = {
  size: { hamlet: "A hamlet (a handful of houses)", village: "A village", town: "A town", city: "A walled city (wards)", metropolis: "A metropolis (two walls, many wards)" },
  season: { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" },
  water: { river: "A river", stream: "A stream", coast: "A sea coast and harbor (a city)", lake: "A lake shore (a city)", estuary: "A river meeting the sea (a city)", none: "No water" },
  roads: { crossroads: "A crossroads", through: "A road through", fork: "A fork in the road" },
  center: { square: "A market square", green: "A village green", none: "Neither", well: "A well", cathedral: "A cathedral by the square", palace: "A palace by the square" },
  surroundings: { mixed: "Farms and woods", farmland: "Farmland", woodland: "Woodland", open: "Open ground" },
  river: { meander: "Bending through", island: "Split around an island", loop: "Looping around the city", meeting: "Two rivers meeting" },
  shape: { compact: "Compact, roughly round", lobed: "Lobed and uneven", promontory: "On a promontory (by the sea or a lake)", shore: "Long, along its shore or river", cliff: "Against a cliff" },
};

/** Per size: the map in squares, the main and cross roads' classes, the square's radius, the green's size. */
export const SIZES = {
  hamlet: { squares: [50, 40], main: "street", cross: "lane", square: 2, green: [6, 4], farms: [2, 3], woods: [2, 3] },
  village: { squares: [70, 52], main: "street", cross: "lane", square: 2.6, green: [8, 5.5], farms: [3, 5], woods: [2, 4] },
  town: { squares: [100, 76], main: "highway", cross: "street", square: 3.6, green: [10, 7], farms: [4, 6], woods: [3, 5] },
};

export const ROAD_FT = { highway: 30, street: 20, lane: 15 };

// Small geometry helpers
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const mul = (a, k) => [a[0] * k, a[1] * k];
export const dirOf = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
export const r1 = (v) => Math.round(v * 10) / 10;
export const pt = (p) => [r1(p[0]), r1(p[1])];
/** An outline rounded to a tenth, without a point repeated straight after itself (or the last repeating the first). */
export function outline(poly) {
  const out = [];
  for (const p of poly.map(pt)) if (!out.length || out[out.length - 1][0] !== p[0] || out[out.length - 1][1] !== p[1]) out.push(p);
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}

export function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
}
export const distToPath = (p, path) => path.slice(1).reduce((m, q, i) => Math.min(m, distToSeg(p, path[i], q)), Infinity);
export function inside(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** Distance from a point to a polygon (0 inside). */
export const distToPoly = (p, poly) => (inside(p, poly) ? 0 : distToPath(p, [...poly, poly[0]]));

/** How far along dir from c to the map's edge (inset by m). */
function toEdge(c, dir, W, H, m = 0) {
  const ts = [];
  if (dir[0] > 1e-9) ts.push((W - m - c[0]) / dir[0]);
  if (dir[0] < -1e-9) ts.push((m - c[0]) / dir[0]);
  if (dir[1] > 1e-9) ts.push((H - m - c[1]) / dir[1]);
  if (dir[1] < -1e-9) ts.push((m - c[1]) / dir[1]);
  return Math.min(...ts.filter((t) => t > 0));
}

/** A polygon clipped to the box [m, W-m] x [m, H-m] (Sutherland-Hodgman). */
export function clipToMap(poly, W, H, m = 0.5) {
  const edges = [
    (p) => p[0] >= m, (p) => p[0] <= W - m, (p) => p[1] >= m, (p) => p[1] <= H - m,
  ];
  const cut = [
    (a, b) => { const t = (m - a[0]) / (b[0] - a[0]); return [m, a[1] + (b[1] - a[1]) * t]; },
    (a, b) => { const t = (W - m - a[0]) / (b[0] - a[0]); return [W - m, a[1] + (b[1] - a[1]) * t]; },
    (a, b) => { const t = (m - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, m]; },
    (a, b) => { const t = (H - m - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, H - m]; },
  ];
  let out = poly;
  for (let e = 0; e < 4 && out.length; e++) {
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[(i + inp.length - 1) % inp.length], b = inp[i];
      const ina = edges[e](a), inb = edges[e](b);
      if (inb) { if (!ina) out.push(cut[e](a, b)); out.push(b); }
      else if (ina) out.push(cut[e](a, b));
    }
  }
  return out;
}

/**
 * A wandering line from start in direction dir to the map's edge: a point every step squares, each pushed sideways
 * by a slow random walk (at most amp squares), the last one on the edge. The first `straight` squares stay straight.
 */
export function wander(r, start, dir, W, H, { step = 8, amp = 2, straight = 0 } = {}) {
  const len = toEdge(start, dir, W, H);
  const side = [-dir[1], dir[0]];
  const pts = [start];
  let off = 0;
  for (let s = Math.max(step, straight); s < len - step * 0.6; s += step) {
    off = Math.max(-amp, Math.min(amp, off + r.range(-amp * 0.6, amp * 0.6)));
    const p = add(add(start, mul(dir, s)), mul(side, off));
    pts.push([Math.max(0.5, Math.min(W - 0.5, p[0])), Math.max(0.5, Math.min(H - 0.5, p[1]))]);
  }
  pts.push(add(start, mul(dir, len)));
  return pts;
}

/** A name for a place: two parts of an English place name. */
export function placeName(r, water) {
  const first = ["Ash", "Elm", "Oak", "Thorn", "Mill", "Stone", "Fen", "Holt", "Lark", "Wren", "Bram", "Cold", "Bright", "Alder", "Heath", "Barrow", "Haw", "Rush", "Sedge", "Wold"];
  const last = water !== "none" ? ["ford", "bridge", "mere", "wick", "ton", "by", "brook"] : ["ton", "by", "stead", "field", "well", "cote", "ham", "dale"];
  return r.pick(first) + r.pick(last);
}

// (cut at 60 characters, so a long name still makes a file name a file system can save)
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60).replace(/-$/, "") || "quick-start";

/** What was asked of Quick Start that can't be used (a seed below 1 or not a number, a choice it doesn't know). */
/**
 * Notes on what quickPlan was asked that it couldn't use and replaced (a size it doesn't know, a seed that isn't a
 * whole number of 1 or more): a script would otherwise get the default with no word.
 */
function quickNotes(options) {
  const notes = [];
  const s = options.seed;
  if (s !== undefined && s !== null && s !== "") {
    const n = Number(s);
    if (!Number.isFinite(n) || n < 1) notes.push(`The seed ${JSON.stringify(s)} isn't a number of 1 or more, so 1 was used.`);
    else if (!Number.isInteger(n)) notes.push(`The seed ${n} was rounded down to ${Math.floor(n)}.`);
  }
  for (const [k, list] of Object.entries(QUICK)) {
    const v = options[k];
    if (v !== undefined && v !== null && v !== "" && !list.includes(v)) notes.push(`"${v}" isn't a ${k} Quick Start knows (${list.join(", ")}), so the seed picked one.`);
  }
  return notes;
}

/**
 * A plan from Quick Start's choices: { size, season, water, roads, center, surroundings, river, shape, high, name, seed }
 * (any left out is picked from the seed; seed itself defaults to 1). Returns { plan, choices, notes }: choices are the
 * ones used; notes, what was asked that couldn't be used (an unknown size or a bad seed), replaced by the seed's pick.
 */
export function quickPlan(options = {}) {
  options ??= {};
  const notes = quickNotes(options);
  const out = quickPlanOf(options);
  // (a citadel is the garrison quarter walled in: asked for in a city with no garrison, it's said why there's none)
  const q = out.choices?.quarters;
  if (options.outside?.citadel === true && Array.isArray(q) && !q.includes("garrison")) notes.push("A citadel is the garrison quarter walled in, and this city has no garrison quarter, so it has no citadel. Add Garrison to its quarters for one.");
  if (out.stepNotes) { notes.push(...out.stepNotes); delete out.stepNotes; }
  if (options.high && options.high !== "none" && !QUICK_HIGH.includes(options.high)) notes.push(`"${options.high}" isn't high ground Quick Start knows (${QUICK_HIGH.join(", ")}), so the map has none.`);
  if (options.high && options.high !== "none" && CITIES.includes(out.choices?.size)) notes.push("A city's own ground makes its high ground; the High ground choice is for a village or town.");
  // (choices asked for that the rest didn't allow, and what was used instead)
  const used = out.choices ?? {};
  if (CITIES.includes(used.size)) {
    if (options.shape && QUICK.shape?.includes?.(options.shape) && used.shape && used.shape !== options.shape) notes.push(`A ${options.shape} outline doesn't go with ${used.water === "river" && options.river ? `a river's ${options.river} form` : ({ none: "no water", river: "a river", coast: "the sea", lake: "a lake", estuary: "a river mouth" })[used.water] ?? used.water}, so its outline is ${used.shape}.`);
    if (RIVER_FORMS.includes(options.river) && used.water && !["river", "estuary"].includes(used.water)) notes.push(`A river's form (${options.river}) needs a river, and this city's water is ${used.water}, so it's left out.`);
  } else if (used.size && ["coast", "lake", "estuary"].includes(options.water)) notes.push(`The ${options.water === "coast" ? "sea" : options.water === "lake" ? "lake shore" : "river mouth"} is a city's; a village or town gets a river instead.`);
  return { ...out, notes };
}

function quickPlanOf(options) {
  const ctx = { options };
  const readChoicesDone = readChoices(ctx);
  if (readChoicesDone !== undefined) return readChoicesDone;
  roadsAndDistricts(ctx);
  wallsAndCenter(ctx);
  waterBeyond(ctx);
  millsAndCemetery(ctx);
  farmsAndFields(ctx);
  woodsAndCliffs(ctx);
  highGround(ctx);
  return finishPlan(ctx);
}

/** A Quick Start city or metropolis (quick-city.mjs), as a plan like the others. */
export function cityQuick(choices, seed, options) {
  // (quarters: the ones it may have, all unless a list is given; outside: { citadel, oldWall, suburbs, cemetery, mills },
  // each true or false, else as the seed has it)
  const quarters = Array.isArray(options.quarters) ? QUARTERS.filter((q) => options.quarters.includes(q)) : null;
  const outside = Object.fromEntries(OUTSIDE.filter((k) => options.outside?.[k] === true || options.outside?.[k] === false).map((k) => [k, options.outside[k]]));
  const made = cityPlan({ ...choices, ...(quarters ? { quarters } : {}), ...outside }, seed);
  const name = String(options.name ?? "").trim() || placeName(rng(seed, "quick", "name"), choices.water);
  const winter = choices.season === "winter";
  const plan = {
    atlasScribe: PLAN_VERSION,
    id: `${slug(name)}-${seed}`,
    name,
    kind: "settlement",
    size: { squares: [made.W, made.H], ftPerSquare: 25 },
    season: choices.season,
    sun: winter ? "low-south" : "high-south",
    seed,
    ground: winter ? "snow" : "grass",
    features: [...made.features, { id: "name", type: "label", text: name, at: made.label.at, show: "gm", size: "huge" }],
    output: { pxPerSquare: made.px, dressing: true, scene: { name, weather: winter ? "snow" : null } }, // (a city's map dressed: frame, compass, scale)
  };
  const has = (id) => made.features.some((f) => f.id === id || f.id?.startsWith?.(`${id}-`));
  // (the quarters made, inside the walls)
  const madeQuarters = QUARTERS.filter((q) => made.features.some((f) => f.type === "district" && f.character === q && !f.id?.startsWith?.("suburb")));
  const kept = { ...choices, quarters: madeQuarters, outside: { citadel: has("citadel"), oldWall: has("old-wall"), suburbs: has("suburb"), cemetery: has("cemetery"), mills: has("watermill") || has("windmill") }, seed, name };
  kept.shape = made.shape;
  if (made.river) kept.river = made.river;
  else delete kept.river;
  return { plan, choices: kept };
}

/** A path with points dropped where it runs straight: none more than tol off the line kept (Douglas-Peucker). */
export function thin(path, tol) {
  if (path.length < 3) return path;
  const keep = path.map((_, i) => i === 0 || i === path.length - 1);
  const off = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
  };
  const stack = [[0, path.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let far = -1, d = tol;
    for (let k = i + 1; k < j; k++) { const e = off(path[k], path[i], path[j]); if (e > d) { d = e; far = k; } }
    if (far >= 0) { keep[far] = true; stack.push([i, far], [far, j]); }
  }
  return path.filter((_, k) => keep[k]);
}

/** Every point where path a crosses path b. */
export function crossings(a, b) {
  const out = [];
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
    const hit = segCross(a[i - 1], a[i], b[j - 1], b[j]);
    if (hit) out.push(hit);
  }
  return out;
}

/** A path with a point at least every step squares. */
export function densify(path, step) {
  return path.flatMap((p, i) => {
    if (!i) return [p];
    const q = path[i - 1], n = Math.max(1, Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / step));
    return Array.from({ length: n }, (_, k) => [q[0] + ((p[0] - q[0]) * (k + 1)) / n, q[1] + ((p[1] - q[1]) * (k + 1)) / n]);
  });
}

/** Where segment a-b crosses segment c-d, or null. */
function segCross(a, b, c, d) {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - a[0], qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + rx * t, a[1] + ry * t] : null;
}
