/**
 * Quick Start: a few choices in, a plan out. The plan is an ordinary plan (roads, water, crossings, a square or a
 * green, districts, farmsteads, woods, field systems and a label), so everything after it (the preview, rerolls,
 * reshaping, render and publish) works on it as on any other. Every choice left out is picked from the seed, and the
 * same choices and seed always give the same plan. Pure: runs anywhere. Numbers are in squares (25 ft).
 */
import { rng } from "./rng.mjs";
import { PLAN_VERSION } from "./plan.mjs";
import { cityPlan, CITY_WATER, RIVER_FORMS } from "./quick-city.mjs";
import { meander, bends } from "./meander.mjs";

/** The choices Quick Start offers, the first of each being the one shown first. */
export const QUICK = {
  size: ["village", "hamlet", "town", "city", "metropolis"],
  season: ["summer", "spring", "autumn", "winter"],
  water: ["river", "stream", "coast", "lake", "estuary", "none"],
  roads: ["crossroads", "through", "fork"],
  center: ["square", "green", "none"],
  surroundings: ["mixed", "farmland", "woodland", "open"],
  river: RIVER_FORMS, // a city's river (left out, the seed picks; the dialog shows Any first)
};

/** Choices the dialog leaves on Any unless they're picked, and that only some places use. */
export const QUICK_ANY = ["river"];

/**
 * What a choice left out is picked from: the sizes and water a village or town can have (a city is made only when it's
 * asked for, and the plans earlier seeds made stay the same).
 */
const PICK = { size: ["village", "hamlet", "town"], water: ["river", "stream", "none"] };
const CITIES = ["city", "metropolis"];

/** How each choice reads in the Quick Start dialog. */
export const QUICK_LABELS = {
  size: { hamlet: "A hamlet (a handful of houses)", village: "A village", town: "A town", city: "A walled city (wards)", metropolis: "A metropolis (two walls, many wards)" },
  season: { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" },
  water: { river: "A river", stream: "A stream", coast: "A sea coast and harbor (a city)", lake: "A lake shore (a city)", estuary: "A river meeting the sea (a city)", none: "No water" },
  roads: { crossroads: "A crossroads", through: "A road through", fork: "A fork in the road" },
  center: { square: "A market square", green: "A village green", none: "Neither" },
  surroundings: { mixed: "Farms and woods", farmland: "Farmland", woodland: "Woodland", open: "Open ground" },
  river: { meander: "Bending through", island: "Split around an island", loop: "Looping around the city", meeting: "Two rivers meeting" },
};

/** Per size: the map in squares, the main and cross roads' classes, the square's radius, the green's size. */
const SIZES = {
  hamlet: { squares: [50, 40], main: "street", cross: "lane", square: 2, green: [6, 4], farms: [2, 3], woods: [2, 3] },
  village: { squares: [70, 52], main: "street", cross: "lane", square: 2.6, green: [8, 5.5], farms: [3, 5], woods: [2, 4] },
  town: { squares: [100, 76], main: "highway", cross: "street", square: 3.6, green: [10, 7], farms: [4, 6], woods: [3, 5] },
};

const ROAD_FT = { highway: 30, street: 20, lane: 15 };

// Small geometry helpers
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dirOf = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
const r1 = (v) => Math.round(v * 10) / 10;
const pt = (p) => [r1(p[0]), r1(p[1])];
/** An outline rounded to a tenth, without a point repeated straight after itself (or the last repeating the first). */
function outline(poly) {
  const out = [];
  for (const p of poly.map(pt)) if (!out.length || out[out.length - 1][0] !== p[0] || out[out.length - 1][1] !== p[1]) out.push(p);
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}

function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
}
const distToPath = (p, path) => path.slice(1).reduce((m, q, i) => Math.min(m, distToSeg(p, path[i], q)), Infinity);
function inside(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** Distance from a point to a polygon (0 inside). */
const distToPoly = (p, poly) => (inside(p, poly) ? 0 : distToPath(p, [...poly, poly[0]]));

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
function clipToMap(poly, W, H, m = 0.5) {
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
function wander(r, start, dir, W, H, { step = 8, amp = 2, straight = 0 } = {}) {
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
function placeName(r, water) {
  const first = ["Ash", "Elm", "Oak", "Thorn", "Mill", "Stone", "Fen", "Holt", "Lark", "Wren", "Bram", "Cold", "Bright", "Alder", "Heath", "Barrow", "Haw", "Rush", "Sedge", "Wold"];
  const last = water !== "none" ? ["ford", "bridge", "mere", "wick", "ton", "by", "brook"] : ["ton", "by", "stead", "field", "well", "cote", "ham", "dale"];
  return r.pick(first) + r.pick(last);
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "quick-start";

/**
 * A plan from Quick Start's choices: { size, season, water, roads, center, surroundings, name, seed } (any left out
 * is picked from the seed; seed itself defaults to 1). Returns { plan, choices }: choices are the ones used.
 */
export function quickPlan(options = {}) {
  if (options.center === undefined && options.centre !== undefined) options = { ...options, center: options.centre }; // the name before 0.4.0
  const seed = Number.isFinite(Number(options.seed)) && Number(options.seed) >= 1 ? Math.floor(Number(options.seed)) : 1;
  const pick = rng(seed, "quick", "choices");
  const choices = {};
  for (const [k, list] of Object.entries(QUICK)) if (!QUICK_ANY.includes(k)) choices[k] = list.includes(options[k]) ? options[k] : pick.pick(PICK[k] ?? list);
  if (RIVER_FORMS.includes(options.river)) choices.river = options.river;
  // A city's water left out is any a city can have, a stream is a river there, and a village or town by the sea or a
  // lake has a river for now
  if (CITIES.includes(choices.size)) {
    if (!QUICK.water.includes(options.water)) choices.water = rng(seed, "quick", "city-water").pick(CITY_WATER);
    else if (choices.water === "stream") choices.water = "river";
    return cityQuick(choices, seed, options);
  }
  if (!PICK.water.includes(choices.water)) choices.water = "river";
  delete choices.river; // (a city's)
  const S = SIZES[choices.size];
  const [W, H] = S.squares;
  const r = rng(seed, "quick", "layout");
  const name = String(options.name ?? "").trim() || placeName(rng(seed, "quick", "name"), choices.water);
  const winter = choices.season === "winter";
  const features = [];

  // The center, and the main road's direction (mostly across the map's long side)
  const C = [W / 2 + r.range(-0.08, 0.08) * W, H / 2 + r.range(-0.08, 0.08) * H];
  const theta = r.range(-30, 30) + (choices.size !== "town" && r.chance(0.25) ? 90 : 0); // a town runs along the long side
  const U = dirOf(theta), V = [-U[1], U[0]];
  const at = (u, v) => add(add(C, mul(U, u)), mul(V, v));

  // Roads: arms from the center to the edges
  const arm = (deg, straight) => wander(r, C, dirOf(deg), W, H, { step: r.range(7, 10), amp: r.range(1, 2.4), straight });
  const join = (a, b) => [...[...a].reverse(), ...b.slice(1)]; // two arms into one road through the center
  const hold = S.square + 3; // straight near the center, so the roads meet the square squarely
  const roads = [];
  const mainA = arm(theta, hold), mainB = arm(theta + 180 + r.range(-8, 8), hold);
  const arms = [mainA, mainB]; // every road leaving the center
  if (choices.roads === "fork") {
    const branch = arm(theta + 180 + r.range(35, 55) * (r.chance(0.5) ? 1 : -1), hold);
    arms.push(branch);
    roads.push({ id: "main-road", class: S.main, path: join(mainA, mainB) });
    roads.push({ id: "branch-road", class: S.cross, path: [...branch].reverse() });
  } else {
    roads.push({ id: "main-road", class: S.main, path: join(mainA, mainB) });
    if (choices.roads === "crossroads") {
      const c1 = arm(theta + 90 + r.range(-20, 20), hold), c2 = arm(theta - 90 + r.range(-20, 20), hold);
      arms.push(c1, c2);
      roads.push({ id: "cross-road", class: S.cross, path: join(c1, c2) });
    }
  }
  const roadHalf = (rd) => ROAD_FT[rd.class] / 25 / 2;

  // Districts, laid out along the main road: shared corners exactly equal, outer corners a little uneven
  const jig = () => r.range(-1.2, 1.2);
  const box = (u0, u1, v0, v1, ragged) => [
    at(u0 + (ragged.includes("w") ? jig() : 0), v0 + (ragged.includes("n") ? jig() : 0)),
    at(u1 + (ragged.includes("e") ? jig() : 0), v0 + (ragged.includes("n") ? jig() : 0)),
    at(u1 + (ragged.includes("e") ? jig() : 0), v1 + (ragged.includes("s") ? jig() : 0)),
    at(u0 + (ragged.includes("w") ? jig() : 0), v1 + (ragged.includes("s") ? jig() : 0)),
  ];
  /** Where the main road actually runs (its v) at a given u, so a district strung along it sits on it. */
  const mainPath = [...[...mainA].reverse(), ...mainB.slice(1)];
  const roadV = (u) => {
    let best = 0, bestD = Infinity;
    for (const p of mainPath) {
      const pu = (p[0] - C[0]) * U[0] + (p[1] - C[1]) * U[1], pv = (p[0] - C[0]) * V[0] + (p[1] - C[1]) * V[1];
      if (Math.abs(pu - u) < bestD) { bestD = Math.abs(pu - u); best = pv; }
    }
    return best;
  };
  // Names by the compass side they lie on (the map's up is north)
  const compass = (dir) => (Math.abs(dir[0]) > Math.abs(dir[1]) ? (dir[0] > 0 ? "east" : "west") : dir[1] > 0 ? "south" : "north");
  const fwd = compass(U), back = compass(mul(U, -1));
  const districts = [];
  if (choices.size === "hamlet") {
    districts.push({ id: "hamlet", profile: "hamlet", poly: box(-9, 9, -6.5, 6.5, "nsew") });
  } else if (choices.size === "village") {
    const half = r.range(13, 16);
    // Sometimes a hamlet strung out along the road beyond the village; the village's end it meets stays straight,
    // so the two share that edge
    const end = r.chance(0.5) ? (r.chance(0.5) ? 1 : -1) : 0;
    districts.push({ id: "village", profile: "village", poly: box(-half, half, -11, 11, `ns${end === 1 ? "" : "e"}${end === -1 ? "" : "w"}`) });
    if (end) {
      const near = end * half, far = end * (half + r.range(8, 11));
      const vc = Math.max(-4, Math.min(4, roadV((near + far) / 2)));
      districts.push({ id: `${end > 0 ? fwd : back}-end`, profile: "hamlet", end: true, poly: box(Math.min(near, far), Math.max(near, far), vc - 6, vc + 6, end > 0 ? "nse" : "nsw") });
    }
  } else {
    const core = r.range(10, 12), mid = core + r.range(14, 17);
    const end = r.chance(0.6) ? (r.chance(0.5) ? 1 : -1) : 0; // a village beyond one of the towns
    districts.push({ id: "core", profile: "city", poly: box(-core, core, -11, 11, "") });
    districts.push({ id: `town-${fwd}`, profile: "town", poly: box(core, mid, -15, 15, end === 1 ? "ns" : "nse") });
    districts.push({ id: `town-${back}`, profile: "town", poly: box(-mid, -core, -15, 15, end === -1 ? "ns" : "nsw") });
    if (end) {
      const near = end * mid, far = end * (mid + r.range(9, 12));
      const vc = Math.max(-4, Math.min(4, roadV((near + far) / 2)));
      districts.push({ id: `village-${end > 0 ? fwd : back}`, profile: "village", end: true, poly: box(Math.min(near, far), Math.max(near, far), vc - 10, vc + 10, end > 0 ? "nse" : "nsw") });
    }
    // The core's corners and the towns' inner corners are the same points: put them back exactly
    const [k0, k1, k2, k3] = districts[0].poly;
    districts[1].poly[0] = [...k1]; districts[1].poly[3] = [...k2];
    districts[2].poly[1] = [...k0]; districts[2].poly[2] = [...k3];
  }
  // Inner edges between neighbors were built from the same u, v; snap equal points together after rounding
  for (const d of districts) d.poly = outline(clipToMap(d.poly.map(pt), W, H));
  // Points the same up to rounding become one point, so shared corners stay shared
  const all = districts.flatMap((d) => d.poly);
  for (const p of all) for (const q of all) if (p !== q && Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.15) { q[0] = p[0]; q[1] = p[1]; }
  // A district strung on the end of another meets it partway along a side: put its corners into that side too, so
  // the two share corners (and move together when reshaped)
  for (const d of districts.filter((x) => x.end)) {
    for (const p of d.poly) {
      for (const o of districts) {
        if (o === d || o.poly.some((q) => q[0] === p[0] && q[1] === p[1])) continue;
        const k = o.poly.findIndex((a, i) => distToSeg(p, a, o.poly[(i + 1) % o.poly.length]) < 0.12); // on it, give or take the rounding
        if (k >= 0) o.poly.splice(k + 1, 0, [p[0], p[1]]);
      }
    }
  }
  const cluster = districts.map((d) => d.poly);
  const nearCluster = (p, m) => cluster.some((poly) => distToPoly(p, poly) < m);

  // The center: a square where the roads meet, or a green beside them
  if (choices.center === "square") {
    const surface = choices.size === "town" ? "cobble" : choices.size === "village" ? "gravel" : "trodden";
    features.push({ id: "square", type: "square", shape: { circle: [r1(C[0]), r1(C[1]), S.square] }, surface, radial: choices.size === "town", name: "The square" });
  }
  let green = null;
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
    for (let push = 0; push < 6 && !green; push++) {
      const off = Math.hypot(gw, gd) / 2 / Math.max(0.5, Math.sin(Math.min(gap, Math.PI) / 2)) + roadHalf(roads[0]) + 0.8 + push;
      const gc = add(C, mul(D, off));
      const g = outline(clipToMap([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => pt(add(add(gc, mul(U, (a * gw) / 2)), mul(V, (b * gd) / 2)))), W, H));
      const edge = g.flatMap((p, i) => { const q = g[(i + 1) % g.length]; return [0, 0.25, 0.5, 0.75].map((t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); });
      if (g.length >= 3 && roads.every((rd) => edge.every((p) => distToPath(p, rd.path) > roadHalf(rd) + 0.4) && rd.path.every((p) => !inside(p, g)))) green = g;
    }
    if (green) features.push({ id: "green", type: "area", class: "park", style: "green", shape: green });
  }

  // Water: across the main road beyond the districts (or along one side if there's no room), clear of them
  let water = null;
  if (choices.water !== "none") {
    const width = choices.water === "river" ? r.range(45, 70) : r.range(12, 18);
    const half = width / 25 / 2;
    const extent = Math.max(...cluster.flat().map((p) => Math.abs((p[0] - C[0]) * U[0] + (p[1] - C[1]) * U[1])));
    const sideExtent = Math.max(...cluster.flat().map((p) => Math.abs((p[0] - C[0]) * V[0] + (p[1] - C[1]) * V[1])));
    const tries = [];
    for (const s of r.shuffle([1, -1])) tries.push({ q: (m) => at(s * (extent + m), 0), dir: theta + 90 });
    for (const s of r.shuffle([1, -1])) tries.push({ q: (m) => at(0, s * (sideExtent + m)), dir: theta });
    for (let t = 0; t < tries.length * 4 && !water; t++) {
      const tr = tries[t % tries.length];
      const q = tr.q(half + r.range(4, 8));
      if (q[0] < 3 || q[1] < 3 || q[0] > W - 3 || q[1] > H - 3) continue;
      const deg = tr.dir + r.range(-12, 12);
      // Bending as it goes (gentler on each round of tries, so it still finds room beside the town)
      const bd = bends(r, Math.min(W, H) * 0.45), calm = [1, 0.7, 0.45, 0.2][Math.floor(t / tries.length)];
      bd.swing *= calm;
      bd.swing2 *= calm;
      const path = thin(meander(q, (deg * Math.PI) / 180, W, H, bd), 0.08).map(pt);
      // (well across the map, not bending off it near a corner)
      // (on the last round, nearly straight, any length will do)
      if (t < tries.length * 3 && path.reduce((n, p, i) => n + (i ? Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]) : 0), 0) < Math.min(W, H) * 0.9) continue;
      // Clear of every district and the green, banks and all
      const clear = (p) => !nearCluster(p, half + 1.5) && !(green && distToPoly(p, green) < half + 1.5);
      const dense = path.flatMap((p, i) => (i ? Array.from({ length: 6 }, (_, k) => [path[i - 1][0] + ((p[0] - path[i - 1][0]) * k) / 6, path[i - 1][1] + ((p[1] - path[i - 1][1]) * k) / 6]) : [p]));
      if (!dense.every(clear)) continue;
      // Each road crosses it once at most in any stretch, so every crossing gets its own bridge
      const hits = roads.map((rd) => crossings(rd.path.map(pt), path));
      if (hits.some((h) => h.some((p, i) => h.some((q, j) => j > i && Math.hypot(p[0] - q[0], p[1] - q[1]) < 8)))) continue;
      water = { id: choices.water, type: "water", class: choices.water, width: Math.round(width), path, frozen: winter && choices.water === "stream" };
    }
    if (water) {
      features.push(water);
      // A bridge (or, on a stream, sometimes a ford) wherever a road crosses it
      let n = 0;
      for (const rd of roads) {
        // Worked out from the lines as the plan stores them (rounded), so none is missed
        for (const hit of crossings(rd.path.map(pt), water.path)) {
          const ford = choices.water === "stream" && rd.class !== "highway" && r.chance(0.4);
          features.push({ id: `${ford ? "ford" : "bridge"}-${++n}`, type: "crossing", class: ford ? "ford" : "bridge", at: pt(hit), frozen: ford && winter });
        }
      }
    }
  }

  // Keep-outs for what goes around the edge: the districts, the green, the roads, the water
  const clearOfThings = (p, m) => !nearCluster(p, m) && !(green && distToPoly(p, green) < m)
    && roads.every((rd) => distToPath(p, rd.path) > roadHalf(rd) + m)
    && !(water && distToPath(p, water.path) < water.width / 25 / 2 + m);
  const onMap = (p) => p[0] > 1 && p[1] > 1 && p[0] < W - 1 && p[1] < H - 1;
  const clearOf = (p, m) => clearOfThings(p, m) && onMap(p);

  // Farmsteads beside the roads, beyond the districts
  const farmish = choices.surroundings === "farmland" || choices.surroundings === "mixed";
  const woodish = choices.surroundings === "woodland" || choices.surroundings === "mixed";
  const [f0, f1] = S.farms;
  const farmsWanted = choices.surroundings === "open" ? r.int(2) : farmish ? f0 + r.int(f1 - f0 + 1) : r.int(2);
  const farms = [];
  for (let t = 0; t < 200 && farms.length < farmsWanted; t++) {
    const rd = r.pick(roads);
    const i = 1 + r.int(rd.path.length - 1);
    const a = rd.path[i - 1], b = rd.path[i], k = r.next();
    const on = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...d) || 1;
    const c = add(on, mul([-d[1] / l, d[0] / l], (r.chance(0.5) ? 1 : -1) * (roadHalf(rd) + r.range(3.5, 5))));
    const size = 4.6, rot = Math.round(r.range(-15, 15));
    // (its corners, the middles of its sides and its center: a bending river or stream can pass between corners)
    const corners = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]].map(([x, y]) => add(c, [(x * size) / 2, (y * size) / 2]));
    if (![c, ...corners].every((p) => clearOf(p, 1.2))) continue;
    if (farms.some((f) => Math.hypot(f.c[0] - c[0], f.c[1] - c[1]) < size * 2)) continue;
    farms.push({ c, size, rot });
  }
  farms.forEach((f, n) => features.push({ id: `farm-${n + 1}`, type: "area", class: "farmstead", shape: { rect: [r1(f.c[0] - f.size / 2), r1(f.c[1] - f.size / 2), r1(f.c[0] + f.size / 2), r1(f.c[1] + f.size / 2)] }, rot: f.rot }));

  // Field systems: in some of the wedges of land between the roads leaving the center (a wide gap split in two), each
  // filled with enclosed fields or open strips by the layout, which keeps them off the roads, water and farmyards and
  // a ragged margin of grass around the districts. Farmland runs to the map's edge; mixed country has fields around the
  // village and rough ground beyond
  const fields = [];
  if (choices.surroundings !== "open") {
    // The lines the wedges lie between: each road leaving the center, and a wandering line through a wide gap
    const angleOf = (path) => { const e = path[path.length - 1]; return Math.atan2(e[1] - C[1], e[0] - C[0]); };
    const lines = arms.map((path) => ({ path, a: angleOf(path) })).sort((x, y) => x.a - y.a);
    const withSplits = [];
    lines.forEach((l, i) => {
      withSplits.push(l);
      const next = i + 1 < lines.length ? lines[i + 1].a : lines[0].a + 2 * Math.PI;
      if (next - l.a > (140 * Math.PI) / 180) {
        const mid = (l.a + next) / 2;
        withSplits.push({ path: wander(r, C, [Math.cos(mid), Math.sin(mid)], W, H, { step: r.range(6, 9), amp: r.range(1.5, 3) }), a: mid });
      }
    });
    const extent = Math.max(...cluster.flat().map((p) => Math.hypot(p[0] - C[0], p[1] - C[1])));
    /** A line from the center cut off at distance R. */
    const upTo = (path, R) => {
      const out = [path[0]];
      for (let i = 1; i < path.length; i++) {
        const p = path[i], q = path[i - 1], d = Math.hypot(p[0] - C[0], p[1] - C[1]);
        if (d <= R) { out.push(p); continue; }
        const dq = Math.hypot(q[0] - C[0], q[1] - C[1]), t = (R - dq) / (d - dq || 1);
        out.push([q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t]);
        break;
      }
      return out;
    };
    const used = new Set();
    // Which wedges stay rough grass: in farmland one (when there are three or more), in mixed country about half (but
    // never all), in woodland most
    const rough = choices.surroundings === "farmland" ? (withSplits.length >= 3 ? r.int(withSplits.length) : -1) : -1;
    const keepAtLeast = choices.surroundings === "mixed" ? r.int(withSplits.length) : -1;
    withSplits.forEach((l, i) => {
      const m = withSplits[(i + 1) % withSplits.length];
      const a = l.a, b = i + 1 < withSplits.length ? m.a : m.a + 2 * Math.PI;
      const keep = r.next(), reach = r.range(12, 22), small = r.range(8, 14);
      // Not every stretch: some stay rough grass, so the fields don't ring the village
      const wanted = choices.surroundings === "farmland" ? i !== rough : choices.surroundings === "mixed" ? keep < 0.5 || i === keepAtLeast : keep < 0.25;
      if (!wanted) return;
      // Farmland runs to the map's edge; otherwise the fields stop a ragged way out from the village
      const R = choices.surroundings === "farmland" ? Math.hypot(W, H) : extent + (choices.surroundings === "mixed" ? reach : small);
      const n = Math.max(3, Math.ceil((b - a) / ((12 * Math.PI) / 180)));
      const arc = Array.from({ length: n - 1 }, (_, k) => {
        const t = a + ((b - a) * (k + 1)) / n, rr = R * r.range(0.88, 1.12);
        return add(C, [Math.cos(t) * rr, Math.sin(t) * rr]);
      });
      const out = choices.surroundings === "farmland" ? (path) => path : (path) => upTo(path, R);
      const shape = outline(clipToMap([...out(l.path), ...arc, ...[...out(m.path)].reverse().slice(0, -1)], W, H, 0));
      if (shape.length < 3) return;
      const side = compass(dirOf((((a + b) / 2) * 180) / Math.PI));
      let id = `fields-${side}`;
      for (let k = 2; used.has(id); k++) id = `fields-${side}-${k}`;
      used.add(id);
      fields.push({ id, type: "area", class: "fields", shape });
    });
  }
  features.push(...fields);

  // Woods toward the edges, clear of everything
  const [w0, w1] = S.woods;
  const woodsWanted = woodish ? w0 + r.int(w1 - w0 + 1) : choices.surroundings === "open" ? 0 : r.int(2);
  const woods = [];
  for (let t = 0; t < 300 && woods.length < woodsWanted; t++) {
    const rad = r.range(3.5, choices.size === "town" ? 9 : 7);
    const c = [r.range(1, W - 1), r.range(1, H - 1)];
    const n = 12, blob = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      const rr = rad * r.range(0.7, 1.15);
      blob.push([Math.max(0, Math.min(W, c[0] + Math.cos(a) * rr * 1.2)), Math.max(0, Math.min(H, c[1] + Math.sin(a) * rr))]);
    }
    // A point pushed onto the map's edge may sit on the edge, but never on a road, the water or a district there
    if (![c, ...blob].every((p) => clearOfThings(p, 1))) continue;
    // nor a road or the water running through its middle, between the points tested above
    if ([...roads.map((rd) => rd.path), ...(water ? [water.path] : [])].some((path) => densify(path, 0.5).some((q) => inside(q, blob)))) continue;
    if (!clearOf(c, rad * 0.8)) continue;
    if (woods.some((w) => Math.hypot(w.c[0] - c[0], w.c[1] - c[1]) < w.rad + rad + 2)) continue;
    if (farms.some((f) => Math.hypot(f.c[0] - c[0], f.c[1] - c[1]) < rad * 1.2 + f.size)) continue;
    woods.push({ c, rad, blob });
  }
  woods.forEach((w, n) => features.push({ id: `woods-${n + 1}`, type: "area", class: "woods", shape: outline(w.blob) }));

  // The name, above the districts and off the cross road
  const top = Math.max(...cluster.flat().map((p) => -((p[0] - C[0]) * V[0] + (p[1] - C[1]) * V[1])));
  const spot = (u) => { const q = at(u, -(top + 1.3)); return [Math.max(3, Math.min(W - 3, q[0])), Math.max(1.5, Math.min(H - 1.5, q[1]))]; };
  const tries = [0, 6, -6, 10, -10, 14, -14, 18, -18].map(spot);
  const labelAt = tries.find((q) => roads.every((rd) => distToPath(q, rd.path) > roadHalf(rd) + 1.2) && !(water && distToPath(q, water.path) < water.width / 25 / 2 + 1)) ?? tries[1];

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
      ...roads.map((rd) => ({ id: rd.id, type: "road", class: rd.class, path: rd.path.map(pt) })),
      ...features.filter((f) => f.type === "water" || f.type === "crossing"),
      ...features.filter((f) => f.type === "square"),
      ...districts.map((d) => ({ id: d.id, type: "district", profile: d.profile, shape: d.poly })),
      ...features.filter((f) => f.type === "area" || f.type === "wall"),
      { id: "name", type: "label", text: name, at: pt(labelAt), show: "gm", size: "huge" },
    ],
    output: { scene: { name, weather: winter ? "snow" : null } },
  };
  return { plan, choices: { ...choices, seed, name } };
}

/** A Quick Start city or metropolis (quick-city.mjs), as a plan like the others. */
function cityQuick(choices, seed, options) {
  const made = cityPlan(choices, seed);
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
    output: { pxPerSquare: made.px, scene: { name, weather: winter ? "snow" : null } },
  };
  const kept = { ...choices, seed, name };
  if (made.river) kept.river = made.river;
  else delete kept.river;
  return { plan, choices: kept };
}

/** A path with points dropped where it runs straight: none more than tol off the line kept (Douglas-Peucker). */
function thin(path, tol) {
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
function crossings(a, b) {
  const out = [];
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
    const hit = segCross(a[i - 1], a[i], b[j - 1], b[j]);
    if (hit) out.push(hit);
  }
  return out;
}

/** A path with a point at least every step squares. */
function densify(path, step) {
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
