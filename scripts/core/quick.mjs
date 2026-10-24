/**
 * Quick Start: a few choices in, a plan out. The plan is an ordinary plan (roads, water, crossings, a square or a
 * green, districts, farmsteads, woods, field walls and a label), so everything after it (the preview, rerolls,
 * reshaping, render and publish) works on it as on any other. Every choice left out is picked from the seed, and the
 * same choices and seed always give the same plan. Pure: runs anywhere. Numbers are in squares (25 ft).
 */
import { rng } from "./rng.mjs";
import { PLAN_VERSION } from "./plan.mjs";

/** The choices Quick Start offers, the first of each being the one shown first. */
export const QUICK = {
  size: ["village", "hamlet", "town"],
  season: ["summer", "spring", "autumn", "winter"],
  water: ["river", "stream", "none"],
  roads: ["crossroads", "through", "fork"],
  centre: ["square", "green", "none"],
  surroundings: ["mixed", "farmland", "woodland", "open"],
};

/** How each choice reads in the Quick Start dialog. */
export const QUICK_LABELS = {
  size: { hamlet: "A hamlet (a handful of houses)", village: "A village", town: "A town" },
  season: { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" },
  water: { river: "A river", stream: "A stream", none: "No water" },
  roads: { crossroads: "A crossroads", through: "A road through", fork: "A fork in the road" },
  centre: { square: "A market square", green: "A village green", none: "Neither" },
  surroundings: { mixed: "Farms and woods", farmland: "Farmland", woodland: "Woodland", open: "Open ground" },
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
 * A plan from Quick Start's choices: { size, season, water, roads, centre, surroundings, name, seed } (any left out
 * is picked from the seed; seed itself defaults to 1). Returns { plan, choices }: choices are the ones used.
 */
export function quickPlan(options = {}) {
  const seed = Number.isFinite(Number(options.seed)) && Number(options.seed) >= 1 ? Math.floor(Number(options.seed)) : 1;
  const pick = rng(seed, "quick", "choices");
  const choices = {};
  for (const [k, list] of Object.entries(QUICK)) choices[k] = list.includes(options[k]) ? options[k] : pick.pick(list);
  const S = SIZES[choices.size];
  const [W, H] = S.squares;
  const r = rng(seed, "quick", "layout");
  const name = String(options.name ?? "").trim() || placeName(rng(seed, "quick", "name"), choices.water);
  const winter = choices.season === "winter";
  const features = [];

  // The centre, and the main road's direction (mostly across the map's long side)
  const C = [W / 2 + r.range(-0.08, 0.08) * W, H / 2 + r.range(-0.08, 0.08) * H];
  const theta = r.range(-30, 30) + (choices.size !== "town" && r.chance(0.25) ? 90 : 0); // a town runs along the long side
  const U = dirOf(theta), V = [-U[1], U[0]];
  const at = (u, v) => add(add(C, mul(U, u)), mul(V, v));

  // Roads: arms from the centre to the edges
  const arm = (deg, straight) => wander(r, C, dirOf(deg), W, H, { step: r.range(7, 10), amp: r.range(1, 2.4), straight });
  const join = (a, b) => [...[...a].reverse(), ...b.slice(1)]; // two arms into one road through the centre
  const hold = S.square + 3; // straight near the centre, so the roads meet the square squarely
  const roads = [];
  const mainA = arm(theta, hold), mainB = arm(theta + 180 + r.range(-8, 8), hold);
  if (choices.roads === "fork") {
    const branch = arm(theta + 180 + r.range(35, 55) * (r.chance(0.5) ? 1 : -1), hold);
    roads.push({ id: "main-road", class: S.main, path: join(mainA, mainB) });
    roads.push({ id: "branch-road", class: S.cross, path: [...branch].reverse() });
  } else {
    roads.push({ id: "main-road", class: S.main, path: join(mainA, mainB) });
    if (choices.roads === "crossroads") {
      const c1 = arm(theta + 90 + r.range(-20, 20), hold), c2 = arm(theta - 90 + r.range(-20, 20), hold);
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
    districts.push({ id: "core", profile: "core", poly: box(-core, core, -11, 11, "") });
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
  // Inner edges between neighbours were built from the same u, v; snap equal points together after rounding
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

  // The centre: a square where the roads meet, or a green beside them
  if (choices.centre === "square") {
    const surface = choices.size === "town" ? "cobble" : choices.size === "village" ? "gravel" : "trodden";
    features.push({ id: "square", type: "square", shape: { circle: [r1(C[0]), r1(C[1]), S.square] }, surface, radial: choices.size === "town", name: "The square" });
  }
  let green = null;
  if (choices.centre === "green") {
    // In the widest gap between the roads leaving the centre, clear of them
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
    // Pushed out from the centre until it's clear of every road (they wander a little once past the centre)
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
    for (let t = 0; t < tries.length * 3 && !water; t++) {
      const tr = tries[t % tries.length];
      const q = tr.q(half + r.range(4, 8));
      if (q[0] < 3 || q[1] < 3 || q[0] > W - 3 || q[1] > H - 3) continue;
      const deg = tr.dir + r.range(-12, 12);
      const a = wander(r, q, dirOf(deg), W, H, { step: r.range(6, 9), amp: r.range(1.2, 2.6) });
      const b = wander(r, q, dirOf(deg + 180), W, H, { step: r.range(6, 9), amp: r.range(1.2, 2.6) });
      const path = join(a, b).map(pt);
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

  // Keep-outs for what goes round the edge: the districts, the green, the roads, the water
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
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => add(c, [(x * size) / 2, (y * size) / 2]));
    if (![c, ...corners].every((p) => clearOf(p, 1.2))) continue;
    if (farms.some((f) => Math.hypot(f.c[0] - c[0], f.c[1] - c[1]) < size * 2)) continue;
    farms.push({ c, size, rot });
  }
  farms.forEach((f, n) => features.push({ id: `farm-${n + 1}`, type: "area", class: "farmstead", shape: { rect: [r1(f.c[0] - f.size / 2), r1(f.c[1] - f.size / 2), r1(f.c[0] + f.size / 2), r1(f.c[1] + f.size / 2)] }, rot: f.rot }));

  const walls = []; // field wall paths
  // Field walls through the farmland, beyond the districts: walls square to each road every few chains, each running
  // back until it meets something, and back walls joining neighbours, so the land reads as fields along the road
  if (farmish) {
    const nearFarm = (p) => farms.some((f) => Math.hypot(p[0] - f.c[0], p[1] - f.c[1]) < f.size * 0.85);
    for (const rd of roads) {
      const path = rd.path;
      const lens = path.map((q, i) => (i ? Math.hypot(q[0] - path[i - 1][0], q[1] - path[i - 1][1]) : 0));
      const total = lens.reduce((a, b) => a + b, 0);
      const along = (t) => {
        let k = 1, acc = 0;
        while (k < path.length - 1 && acc + lens[k] < t) acc += lens[k++];
        const a = path[k - 1], b = path[k], f = Math.min(1, Math.max(0, (t - acc) / (lens[k] || 1)));
        const d = [(b[0] - a[0]) / (lens[k] || 1), (b[1] - a[1]) / (lens[k] || 1)];
        return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], d };
      };
      for (const s of [1, -1]) {
        let last = null;
        for (let t = r.range(3, 8); t < total - 2; t += r.range(9, 14)) {
          const { p, d } = along(t);
          const side = [-d[1] * s, d[0] * s];
          const start = add(p, mul(side, roadHalf(rd) + 0.6));
          if (!clearOf(add(start, mul(side, 1)), 0.4) || nearCluster(p, 3)) { last = null; continue; }
          // Back from the road until something is in the way, or the field is deep enough
          const want = r.range(10, 20);
          let depth = 0;
          for (let x = 0.5; x <= want; x += 0.5) {
            const q = add(start, mul(side, x));
            if (!clearOf(q, 0.6) || nearFarm(q)) break;
            depth = x;
          }
          if (depth < 5) { last = null; continue; }
          const end = add(start, mul(side, depth));
          const rail = { path: [pt(start), pt(add(start, mul(side, depth / 2))), pt(end)], end, kept: false };
          // A field is two walls from the road joined at the back: a wall with no neighbour to close it is left out
          if (last) {
            const span = Math.hypot(end[0] - last.end[0], end[1] - last.end[1]);
            const steps = Math.ceil(span / 0.5); // every half square, so nothing narrow slips between samples
            const ok = span < 20 && Array.from({ length: steps - 1 }, (_, i) => (i + 1) / steps).every((k) => {
              const q = add(last.end, mul([end[0] - last.end[0], end[1] - last.end[1]], k));
              return clearOf(q, 0.6) && !nearFarm(q);
            });
            if (ok) {
              for (const w of [last, rail]) if (!w.kept) { w.kept = true; walls.push(w.path); }
              walls.push([pt(last.end), pt(end)]);
            }
          }
          last = rail;
        }
      }
    }
  }

  const wallClass = winter || choices.season === "autumn" ? "drystone" : r.pick(["drystone", "hedge"]);
  walls.forEach((path, k) => features.push({ id: `field-wall-${k + 1}`, type: "wall", class: wallClass, path }));
  const nearWall = (p, m) => walls.some((w) => distToPath(p, w) < m);

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
    if (![c, ...blob].every((p) => clearOfThings(p, 1) && !nearWall(p, 1))) continue;
    if (walls.some((w) => w.some((q) => inside(q, blob)))) continue; // nor a field wall running through it
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
