/**
 * A battle map's brief: what Quick Start's Battle map tab asks, and what the Describe box reads from words (plan
 * decision 44, Patrick's choices of 8 Nov: one brief, two ways in). A brief in, an ordinary battle plan out (roads,
 * water, heights, woods, buildings, props), so everything after it (the window, rerolls, render, publish) works on
 * it as on any plan. Every choice left out has a default, and the same brief and seed always give the same plan.
 * Pure: runs anywhere. Numbers are in battle squares (5 ft).
 *
 * The sites:
 *   - wilderness: the ground and its features, scattered as thickly as asked;
 *   - roadside: a road through the country with one building (an inn, a farmstead, a shrine, a smithy or a
 *     watchtower) set back from it, its outbuildings beside it;
 *   - street: a hamlet's, village's, town's or city quarter's street at battle size, the district building the rest;
 *   - camp: tents around a fire (a campsite), inside a ring of wagons (a caravan), or in rows (soldiers);
 *   - castle: a curtain wall with its towers and gatehouse (layout/castle.mjs builds their floors and the wall walk), a
 *     keep and buildings around its yard, its road in through the gate; a fort, a castle or a great castle by size.
 */
import { rng } from "./rng.mjs";
import { PLAN_VERSION } from "./plan.mjs";
import { CHARACTERS } from "./character.mjs";

/** The choices, the first of each the default. features and scatter levels as below. */
export const BRIEF = {
  site: ["wilderness", "roadside", "street", "camp", "castle"],
  size: ["medium", "small", "large"],
  season: ["summer", "spring", "autumn", "winter"],
  time: ["day", "dawn", "dusk", "night"],
  weather: ["season", "none", "rain", "fog", "snow"],
  ground: ["forest", "clearing", "open", "hills"],
  features: ["road", "stream", "pond", "cliff", "rise", "hollow"],
  trees: ["open", "none", "sparse", "thick", "dense"],
  litter: ["some", "none", "few", "lots"],
  rocks: ["few", "none", "some", "lots"],
  brush: ["some", "none", "few", "lots"],
  use: ["inn", "farmstead", "shrine", "smithy", "watchtower"],
  buildingSize: ["medium", "small", "large"],
  place: ["village", "hamlet", "town", "city"],
  quarter: CHARACTERS,
  camp: ["campsite", "caravan", "soldiers"],
  towers: ["open", "roofed"],
};

/** How each choice reads in the dialog (and on the Describe box's chips). */
export const BRIEF_LABELS = {
  site: { wilderness: "Wilderness", roadside: "Roadside building", street: "Village or town street", camp: "Camp", castle: "Castle" },
  size: { small: "Small (30 by 24)", medium: "Medium (45 by 34)", large: "Large (60 by 45)" },
  season: { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" },
  time: { day: "Day", dawn: "Dawn", dusk: "Dusk", night: "Night" },
  weather: { season: "Season's own", none: "None", rain: "Rain", fog: "Fog", snow: "Snow" },
  ground: { forest: "Forest", clearing: "Clearing", open: "Open", hills: "Hills" },
  features: { road: "Road", stream: "Stream", pond: "Pond", cliff: "Cliff", rise: "Rise", hollow: "Hollow" },
  trees: { none: "None", sparse: "Sparse", open: "Open", thick: "Thick", dense: "Dense" },
  litter: { none: "None", few: "A few", some: "Some", lots: "Lots" },
  rocks: { none: "None", few: "A few", some: "Some", lots: "Lots" },
  brush: { none: "None", few: "A few", some: "Some", lots: "Lots" },
  use: { inn: "Inn", farmstead: "Farmstead", shrine: "Shrine", smithy: "Smithy", watchtower: "Watchtower" },
  buildingSize: { small: "Small", medium: "Medium", large: "Large" },
  place: { hamlet: "Hamlet", village: "Village", town: "Town", city: "City quarter" },
  quarter: { homes: "Homes", market: "Market", merchants: "Merchants", crafts: "Crafts", docks: "Docks", nobles: "Nobles", temple: "Temple", poor: "Poor quarter", garrison: "Garrison" },
  camp: { campsite: "Campsite", caravan: "Caravan", soldiers: "Soldiers" },
  towers: { open: "Open, with battlements", roofed: "Roofed" },
  // (a castle's size names the castle, its map sized to hold it)
  castleSize: { small: "Fort (40 by 38)", medium: "Castle (48 by 46)", large: "Great castle (58 by 54)" },
};

/** The map in squares, by size. */
export const BRIEF_SIZES = { small: [30, 24], medium: [45, 34], large: [60, 45] };

/**
 * A castle site by size, in squares: its map; its curtain wall's middle line (across, down) and where its top left
 * corner stands; its keep; the towers' spacing along the wall in feet (a fort none between its corners, a castle one
 * on each wall, a great castle two); and the buildings around its yard, in order (each [use, length, depth, roof]).
 */
export const CASTLES = {
  small: { map: [40, 38], wall: [26, 22], at: [7, 6], keep: [7, 6], spacing: 1000, yard: [["barracks", 8, 4, "slate"], ["stable", 7, 4, "thatch"], ["store", 5, 4, "slate"]] },
  medium: { map: [48, 46], wall: [34, 30], at: [7, 6], keep: [13, 8], spacing: 100, yard: [["barracks", 10, 5, "slate"], ["stable", 9, 5, "thatch"], ["chapel", 7, 5, "slate"], ["smithy", 6, 5, "slate"], ["store", 6, 4, "slate"]] },
  large: { map: [58, 54], wall: [44, 38], at: [7, 6], keep: [17, 10], spacing: 80, yard: [["barracks", 12, 5, "slate"], ["stable", 10, 5, "thatch"], ["chapel", 8, 5, "slate"], ["smithy", 6, 5, "slate"], ["store", 8, 5, "slate"], ["armory", 6, 5, "slate"], ["barracks", 9, 5, "slate"]] },
};

/** Each site's own defaults where the brief leaves a choice out (a camp in a clearing, a roadside by its road). */
const SITE_DEFAULTS = {
  wilderness: { ground: "forest", trees: "thick" },
  roadside: { ground: "open", trees: "open", features: ["road"] },
  street: { ground: "open", trees: "sparse", litter: "none", rocks: "none", brush: "few" },
  camp: { ground: "clearing", trees: "thick" },
  castle: { ground: "open", trees: "sparse", litter: "few", rocks: "few", brush: "few" },
};

/** Scattered props per 100 square squares, by level: stumps and logs, rocks and boulders, bushes and ferns. */
const SCATTER = { litter: { none: 0, few: 0.5, some: 1.2, lots: 2.6 }, rocks: { none: 0, few: 0.3, some: 0.9, lots: 2 }, brush: { none: 0, few: 0.8, some: 2, lots: 4 } };
/** A level's woods (a wood's density); none means no woods. */
const WOOD = { none: null, sparse: "sparse", open: "open", thick: "thick", dense: "dense" };

/** A building by use and size: its footprint in squares (length along the road, depth), the plan's use, its outbuildings. */
const BUILDINGS = {
  inn: { dims: { small: [10, 7], medium: [14, 8], large: [18, 10] }, use: "inn", roof: "thatch", out: [{ use: "stable", dims: [7, 6] }] },
  farmstead: { dims: { small: [8, 6], medium: [10, 7], large: [12, 8] }, use: "house", roof: "thatch", out: [{ use: "stable", dims: [9, 6], name: "Barn" }, { use: "shed", dims: [4, 3] }] },
  shrine: { dims: { small: [5, 6], medium: [6, 8], large: [8, 11] }, use: "shrine", roof: "slate", out: [] },
  smithy: { dims: { small: [6, 5], medium: [8, 6], large: [10, 7] }, use: "smithy", roof: "slate", out: [{ use: "shed", dims: [4, 3] }] },
  watchtower: { dims: { small: [6, 6], medium: [7, 7], large: [8, 8] }, use: "watch", roof: "slate", tower: true, out: [{ use: "shed", dims: [4, 3] }] },
};

/** How many tents each kind of camp gets when the brief doesn't say; the most it takes. */
const TENTS = { campsite: 3, caravan: 4, soldiers: 8, most: 16 };

const oneOf = (list, v, fallback) => (list.includes(v) ? v : fallback ?? list[0]);
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const r2 = (v) => Math.round(v * 100) / 100;
const pt = (p) => [r2(p[0]), r2(p[1])];

/**
 * A brief with every choice filled in: those it gives (unknown values dropped), else its site's defaults, else the
 * first of each list. building: { use, size, rooms, name, floors (above the ground floor, null by its use), cellar (null
 * by its use), upstairs and cellarRooms (rooms in words) }; street: { place, quarter }; camp: { kind, tents }.
 */
export function normalizeBrief(input = {}) {
  const b = input ?? {};
  const site = oneOf(BRIEF.site, b.site);
  const d = SITE_DEFAULTS[site];
  const seed = Number.isFinite(Number(b.seed)) && Number(b.seed) >= 1 ? Math.floor(Number(b.seed)) : 1;
  const features = Array.isArray(b.features) ? BRIEF.features.filter((f) => b.features.includes(f)) : [...(d.features ?? [])];
  const bl = b.building ?? {};
  return {
    site,
    size: oneOf(BRIEF.size, b.size),
    season: oneOf(BRIEF.season, b.season),
    time: oneOf(BRIEF.time, b.time),
    weather: oneOf(BRIEF.weather, b.weather),
    ground: oneOf(BRIEF.ground, b.ground, d.ground),
    features,
    trees: oneOf(BRIEF.trees, b.trees, d.trees),
    litter: oneOf(BRIEF.litter, b.litter, d.litter),
    rocks: oneOf(BRIEF.rocks, b.rocks, d.rocks),
    brush: oneOf(BRIEF.brush, b.brush, d.brush),
    building: {
      use: oneOf(BRIEF.use, bl.use), size: oneOf(BRIEF.buildingSize, bl.size), rooms: typeof bl.rooms === "string" ? bl.rooms.trim() : "", name: typeof bl.name === "string" ? bl.name.trim() : "",
      // (its floors above and cellar, null for by its use; their rooms in words)
      floors: bl.floors === null || bl.floors === undefined || bl.floors === "" || !Number.isFinite(Number(bl.floors)) ? null : Math.max(0, Math.min(3, Math.round(Number(bl.floors)))),
      cellar: bl.cellar === true || bl.cellar === "yes" ? true : bl.cellar === false || bl.cellar === "no" ? false : null,
      upstairs: typeof bl.upstairs === "string" ? bl.upstairs.trim() : "", cellarRooms: typeof bl.cellarRooms === "string" ? bl.cellarRooms.trim() : "",
    },
    street: { place: oneOf(BRIEF.place, b.street?.place), quarter: oneOf(BRIEF.quarter, b.street?.quarter) },
    camp: { kind: oneOf(BRIEF.camp, b.camp?.kind), tents: Number.isFinite(Number(b.camp?.tents)) && Number(b.camp.tents) > 0 ? Math.min(TENTS.most, Math.round(Number(b.camp.tents))) : null },
    castle: { towers: oneOf(BRIEF.towers, b.castle?.towers) },
    name: typeof b.name === "string" ? b.name.trim() : "",
    seed,
  };
}

/**
 * A battle plan from a brief. Returns { plan, brief } (the brief as used, every choice filled in; the plan keeps it
 * as `brief`, so the window can show what it was made from).
 */
export function briefPlan(input = {}) {
  const b = normalizeBrief(input ?? {});
  const [W, H] = b.site === "castle" ? CASTLES[b.size].map : BRIEF_SIZES[b.size];
  const r = rng(b.seed, "brief", b.site);
  const features = [];
  const notes = []; // (what couldn't be made as asked, for the window to say)
  const taken = []; // (places kept clear of scatter, woods and each other: { at, r } circles, or { path, half } bands)
  const free = (p, pad = 0) => p[0] > 1 && p[1] > 1 && p[0] < W - 1 && p[1] < H - 1 && !taken.some((t) => (t.path ? nearPath(p, t.path) < t.half + pad : Math.hypot(p[0] - t.at[0], p[1] - t.at[1]) < t.r + pad));
  const has = (f) => b.features.includes(f);

  // 1. The road: across the map's long way, a little below its middle, wandering gently (a roadside's and a camp's by
  // it; a street's is the district's main street, below)
  let road = null;
  // (a camp's road low enough to leave its camp the room above it)
  // (a camp under a cliff keeps the top of the map for it: the camp squashes into the room between)
  // (as long as that leaves the smallest ring of its kind room squashed to half its width; else no cliff, said so below)
  let campTop = 0;
  if (b.site === "camp" && has("cliff")) {
    const d = campDims(b, W, H), least = d.kind === "soldiers" ? 2 * d.span : 2 * (d.span - d.R + RING_LEAST);
    campTop = Math.min(H * 0.2 + 4.5, (has("road") ? H - 3 - 1.4 - 3.5 : H - 2) - least);
    if (campTop < 8.5) campTop = 0;
  }
  // (a roadside's road low enough for its building behind it, and for a cliff above that when one's asked for)
  const roadsideY = () => { const dep = BUILDINGS[b.building.use].dims[b.building.size][1]; return Math.min(H - 2.5, Math.max(H * 0.66, (has("cliff") ? 1 + 3.5 + 4.5 : 1) + dep + 3.5 + 2 + 1.4)); };
  const roadY = b.site === "roadside" ? roadsideY() : b.site === "camp" ? Math.min(H - 3, Math.max(H * 0.5, campTop + 2 * campDims(b, W, H).span + 4.5 + r.range(0, 2))) : H * r.range(0.42, 0.6);
  if (has("road") && b.site !== "street" && b.site !== "castle") {
    const cls = b.site === "roadside" ? "highway" : "track";
    road = { path: wander(r, roadY, W, 1.4), cls, width: cls === "highway" ? 20 : 10 };
    features.push({ id: "road", type: "road", class: cls, surface: "dirt", width: road.width, path: road.path.map(pt) });
    taken.push({ path: road.path, half: road.width / 10 + 0.8 });
  }

  // 2. The site's own, by its road and before the cliff and the water, which keep clear of it: a building set back from
  // its road, a camp (a street's district comes after them, since its houses keep off them themselves)
  let site = null;
  const before = features.length;
  if (b.site === "roadside") site = roadside(b, r, W, H, road, features, taken);
  if (b.site === "camp") site = camp(b, r, W, H, road, features, taken, campTop);
  if (b.site === "castle") site = castle(b, r, W, H, features, taken, has("road"));
  if (site?.notes) notes.push(...site.notes);
  const sitePts = pointsOf(features.slice(before));
  if (site?.pts) sitePts.push(...site.pts); // (a castle's walls and towers, all around)
  const clearOfSite = (path, d) => sitePts.every((q) => nearPath(q, path) > d + (q[2] ?? 0));
  // (the room above the site and its road, and below them)
  const roadBand = road ? road.width / 10 + 1 : 0;
  const ys = [...sitePts.map((q) => q[1]), ...(road ? road.path.filter((q) => q[0] > -1 && q[0] < W + 1).flatMap((q) => [q[1] - roadBand, q[1] + roadBand]) : [])];
  const roomTop = ys.length ? Math.min(...ys) : H, roomBottom = ys.length ? H - Math.max(...ys) : H;

  // 3. A cliff: high ground along the map's top, its edge wandering across it (along the bottom when the site leaves
  // more room there; left out when there's room for neither)
  let cliffEdge = null;
  if (has("cliff")) {
    const want = H * r.range(0.24, 0.34), top = roomTop >= roomBottom || roomTop >= want + 3.5, room = top ? roomTop : roomBottom;
    const depth = Math.min(want, room - 4.5);
    if (depth < 3.5) notes.push(`There's no room for a cliff beside the ${b.site === "camp" ? "camp" : "building"} on a ${b.size} map, so it's left out${b.size === "large" ? "" : ": a larger map has room"}.`);
    else {
      const edge = wander(r, top ? depth : H - depth, W, Math.max(0.5, Math.min(2.2, (room - 3.5 - depth) / 2)));
      cliffEdge = edge;
      const shape = top ? [[-2, -2], [W + 2, -2], ...edge.slice().reverse()] : [[-2, H + 2], ...edge, [W + 2, H + 2]];
      features.push({ id: "cliff", type: "height", name: "The cliff", height: 5 * r.int(3) + 15, edge: "cliff", shape: shape.map(pt) });
      taken.push({ path: edge, half: 2.5 });
      const mid = top ? depth * 0.5 : H - depth * 0.5;
      for (let x = 0; x <= W; x += 2) taken.push({ at: [x, mid], r: depth * 0.5 + 0.5 });
    }
  }

  // 4. Water: a stream across the other way (along the map when the top is a cliff and the middle a road, or a camp
  // has the middle), clear of the site and its crossing where it meets the road; a pond in open ground
  if (has("stream")) {
    const down = !(cliffEdge && road) && !(b.site === "camp" && !road);
    // (a stream down the map may cross the cliff and the road; one along it keeps off both)
    const roadLow = road ? Math.max(...road.path.map((q) => q[1])) + roadBand : 0;
    const ok = (path, isDown) => clearOfSite(path, 3.2) && (isDown || ((!cliffEdge || cliffEdge.every((q) => nearPath(q, path) > 3)) && (!road || road.path.every((q) => q[0] < 0 || q[0] > W || nearPath(q, path) > roadBand + 3))));
    const downs = Array.from({ length: 10 }, (_, k) => () => wanderDown(r, W * (k < 4 ? r.range(0.25, 0.4) : r.range(0.12, 0.88)), H, 2));
    const alongs = [
      ...Array.from({ length: 8 }, () => () => wander(r, road ? r.range(Math.min(H - 2.5, roadLow + 3.5), H - 2.5) : r.range(H * 0.6, H - 2.5), W, 1.6)),
      ...Array.from({ length: 6 }, () => () => wander(r, r.range(2.5, H * 0.4), W, 1.6)),
    ];
    // (the preferred way first, then the other)
    const order = down ? [...downs.map((t) => [t, true]), ...alongs.map((t) => [t, false])] : [...alongs.map((t) => [t, false]), ...downs.map((t) => [t, true])];
    let path = null;
    for (const [t, isDown] of order) { const q = t(); if (ok(q, isDown)) { path = q; break; } }
    if (!path) notes.push(`There's no room for a stream clear of the rest on a ${b.size} map, so it's left out${b.size === "large" ? "" : ": a larger map has room"}.`);
    else {
      features.push({ id: "stream", type: "water", class: "stream", path: path.map(pt) });
      taken.push({ path, half: 2.4 });
      const hit = road && crossingOf(road.path, path);
      if (hit) features.push({ id: "crossing", type: "crossing", class: road.cls === "highway" ? "bridge" : "footbridge", at: pt(hit) });
    }
  }
  // (a copse may stand at the map's edge, half off it, and come nearer what's placed: the woods keep their trees off
  // roads and buildings themselves)
  const blob = (id, type, rad, extra, { edge = false } = {}) => {
    for (let k = 0; k < 60; k++) {
      const m = edge ? -rad * 0.4 : rad + 2, c = [r.range(m, W - m), r.range(m, H - m)];
      const inside = [Math.min(W - 1.5, Math.max(1.5, c[0])), Math.min(H - 1.5, Math.max(1.5, c[1]))];
      if (!free(inside, edge ? rad * 0.5 : rad + 1) || (!edge && sitePts.some((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) < rad * 1.15 + 1.5))) continue;
      const shape = Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * 2 * Math.PI, d = rad * r.range(0.8, 1.15); return pt([c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d]); });
      features.push({ id, type, ...extra, shape });
      taken.push({ at: c, r: rad + 1 });
      return c;
    }
    return null;
  };
  // (a smaller pond where a full one won't go)
  const pondR = r.range(3, 4.5);
  if (has("pond") && ![1, 0.8, 0.65].some((k) => blob("pond", "water", pondR * k, { class: "pond" }))) notes.push(`There's no room for a pond clear of the rest on a ${b.size} map, so it's left out${b.size === "large" ? "" : ": a larger map has room"}.`);

  // (a street's main street, cross street and district)
  if (b.site === "street") street(b, r, W, H, features, taken, has);

  // 5. Rises and hollows (hills bring a few low rises of their own), kept off what's placed
  if (has("rise")) blob("rise", "height", r.range(5, 7.5), { height: 10, edge: "slope" });
  if (has("hollow")) blob("hollow", "height", r.range(4, 6), { height: -10, edge: "bank" });
  if (b.ground === "hills") for (let k = 0; k < 3; k++) blob(`hill-${k + 1}`, "height", r.range(4, 7), { height: 5 * r.int(2) + 5, edge: "slope" });

  // 6. Woods by the ground: a forest all over (cleared around a site), a clearing's ring around an open middle, a few
  // copses on open ground or hills
  const density = WOOD[b.trees];
  if (density) {
    if (b.ground === "forest" && !site) features.push({ id: "woods", type: "area", class: "woods", density, shape: [[-2, -2], [W + 2, -2], [W + 2, H + 2], [-2, H + 2]] });
    else if (b.ground === "forest" || b.ground === "clearing") {
      // (the clearing kept inside the map, so its rim needn't be cut at the edge and the woods' outlines stay simple)
      const c = site?.at ?? [W / 2, H / 2], fit = (want, i, size) => Math.max(2, Math.min(want, (Math.min(c[i], size - c[i]) - 0.6) / 1.15));
      const rx = fit(site ? site.r + 3 : W * 0.3, 0, W), ry = fit(site ? site.r + 3 : H * 0.3, 1, H);
      ring(r, c, rx, ry, W, H).forEach((shape, k) => features.push({ id: `woods-${k + 1}`, type: "area", class: "woods", density, shape: shape.map(pt) }));
    } else {
      const n = b.size === "large" ? 4 : 3;
      for (let k = 0; k < n; k++) blob(`copse-${k + 1}`, "area", r.range(3.5, 6), { class: "woods", density: density === "dense" || density === "thick" ? density : "open" }, { edge: true });
    }
  }

  // 7. Scatter: stumps and logs, rocks and boulders, bushes and ferns, on top of what the woods have, kept off roads,
  // water, buildings and each other
  const area = W * H;
  const scatter = (level, kinds, key) => {
    const n = Math.round((SCATTER[key][level] * area) / 100);
    const s = rng(b.seed, "brief", "scatter", key);
    for (let k = 0, made = 0; made < n && k < n * 12; k++) {
      const p = [s.range(1, W - 1), s.range(1, H - 1)];
      if (!free(p, 0.6)) continue;
      const cls = s.pick(kinds);
      features.push({ id: `${key}-${made + 1}`, type: "prop", class: cls, at: pt(p), rot: Math.round(s.next() * 360) });
      taken.push({ at: p, r: cls === "log" ? 1.2 : 0.7 });
      made++;
    }
  };
  scatter(b.litter, ["stump", "log", "log", "stump", "branch"], "litter");
  scatter(b.rocks, ["rock", "rock", "rock", "boulder"], "rocks");
  scatter(b.brush, b.season === "winter" ? ["bush"] : ["bush", "fern", "fern"], "brush");

  const name = b.name || defaultName(b, site);
  const plan = {
    atlasScribe: PLAN_VERSION,
    id: `battle-${b.site}-${b.seed}`,
    name,
    kind: "battle",
    seed: b.seed,
    season: b.season,
    size: { squares: [W, H], ftPerSquare: 5 },
    features,
    brief: structuredClone(b),
    output: { pxPerSquare: 100, scene: { name, time: b.time, ...(b.weather !== "season" ? { weather: b.weather } : {}) } },
  };
  return { plan, brief: b, notes };
}

/** A road's path across the map at about y, wandering by amp, from past its left edge to past its right. */
function wander(r, y, W, amp) {
  const pts = [], n = Math.max(3, Math.round(W / 9));
  for (let i = 0; i <= n; i++) pts.push([-2 + ((W + 4) * i) / n, y + (i === 0 || i === n ? 0 : r.range(-amp, amp))]);
  return pts;
}
/** The same down the map at about x. */
function wanderDown(r, x, H, amp) {
  const pts = [], n = Math.max(3, Math.round(H / 8));
  for (let i = 0; i <= n; i++) pts.push([x + (i === 0 || i === n ? 0 : r.range(-amp, amp)), -2 + ((H + 4) * i) / n]);
  return pts;
}
/** How far a point lies from a path. */
function nearPath(p, path) {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], c = path[i], dx = c[0] - a[0], dy = c[1] - a[1], L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
    best = Math.min(best, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t));
  }
  return best;
}
/** The points a site's features cover, for keeping the cliff and the water clear: every square of a building's
 * footprint (its corners and edges too), a prop's place. */
function pointsOf(feats) {
  const out = [];
  for (const f of feats) {
    // (a wagon or a cart reaches farther from its middle than the rest)
    if (f.type === "prop") out.push([f.at[0], f.at[1], f.class === "wagon" || f.class === "cart" ? 1.4 : 0]);
    else if (Array.isArray(f.shape)) {
      const xs = f.shape.map((q) => q[0]), ys = f.shape.map((q) => q[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      for (let x = x0; x <= x1 + 1e-9; x += Math.max(0.5, (x1 - x0) / Math.ceil(x1 - x0 || 1))) for (let y = y0; y <= y1 + 1e-9; y += Math.max(0.5, (y1 - y0) / Math.ceil(y1 - y0 || 1))) out.push([x, y]);
    }
  }
  return out;
}
/** Where two paths first cross, or null. */
function crossingOf(a, b) {
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
    const p = a[i - 1], q = a[i], s = b[j - 1], t = b[j];
    const d = (q[0] - p[0]) * (t[1] - s[1]) - (q[1] - p[1]) * (t[0] - s[0]);
    if (Math.abs(d) < 1e-9) continue;
    const u = ((s[0] - p[0]) * (t[1] - s[1]) - (s[1] - p[1]) * (t[0] - s[0])) / d, v = ((s[0] - p[0]) * (q[1] - p[1]) - (s[1] - p[1]) * (q[0] - p[0])) / d;
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
  }
  return null;
}
/** The road's point and direction at x (its path runs left to right). */
function roadAt(path, x) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], c = path[i];
    if (x >= a[0] && x <= c[0]) {
      const t = (x - a[0]) / (c[0] - a[0] || 1), L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      return { p: [x, a[1] + (c[1] - a[1]) * t], u: [(c[0] - a[0]) / L, (c[1] - a[1]) / L] };
    }
  }
  return { p: [x, path[0][1]], u: [1, 0] };
}
/**
 * Woods all around an oval clearing: two pieces (above and below), each a simple shape from past the map's edge to
 * the clearing's wandering rim.
 */
function ring(r, c, rx, ry, W, H) {
  // (the rim's points: 0 to its right, 6 below, 12 to its left, 18 above; y runs down)
  // (kept inside the map, so the two pieces' shapes stay simple)
  const rim = Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * 2 * Math.PI, k = r.range(0.85, 1.15); return [Math.min(W - 0.5, Math.max(0.5, c[0] + Math.cos(a) * rx * k)), Math.min(H - 0.5, Math.max(0.5, c[1] + Math.sin(a) * ry * k))]; });
  const above = [rim[0], ...rim.slice(12).reverse()], below = rim.slice(0, 13);
  return [
    [[-2, -2], [W + 2, -2], [W + 2, rim[0][1]], ...above.slice(0, -1), rim[12], [-2, rim[12][1]]],
    [[-2, H + 2], [W + 2, H + 2], [W + 2, rim[0][1]], ...below, [-2, rim[12][1]]],
  ];
}

/** A roadside site: the building set back above the road, square to it, its outbuildings along beside it, a few props. */
function roadside(b, r, W, H, road, features, taken) {
  const B = BUILDINGS[b.building.use], [len, dep] = B.dims[b.building.size];
  const path = road?.path ?? wander(r, H * 0.66, W, 1.4);
  const at = roadAt(path, W * r.range(0.36, 0.46)), u = at.u, n = [u[1], -u[0]]; // (n: away from the road, upward)
  const back = (road ? road.width / 10 : 2) + 3.5 + dep / 2;
  const c = add(at.p, mul(n, back)), rot = r2((Math.atan2(u[1], u[0]) * 180) / Math.PI);
  const rect = (cx, cy, l, d) => [[cx - l / 2, cy - d / 2], [cx + l / 2, cy - d / 2], [cx + l / 2, cy + d / 2], [cx - l / 2, cy + d / 2]].map(pt);
  const id = b.building.use;
  const name = b.building.name || (b.building.use === "inn" ? innName(r) : "");
  features.push({ id, type: "building", use: B.use, roof: B.roof, ...(B.tower ? { tower: true, height: 30 } : {}), rot, ...(name ? { name } : {}), ...(b.building.rooms ? { rooms: b.building.rooms } : {}), ...(b.building.floors !== null ? { floors: b.building.floors } : {}), ...(b.building.cellar !== null ? { cellar: b.building.cellar } : {}), ...(b.building.upstairs ? { upstairs: b.building.upstairs } : {}), ...(b.building.cellarRooms ? { cellarRooms: b.building.cellarRooms } : {}), shape: rect(c[0], c[1], len, dep) });
  taken.push({ at: c, r: Math.hypot(len, dep) / 2 + 3 });
  // (outbuildings to its right along the road, a gap between)
  let x = len / 2 + 3;
  for (const [k, o] of B.out.entries()) {
    const [ol, od] = o.dims, oc = add(c, add(mul(u, x + ol / 2), mul(n, (od - dep) / 2)));
    if (oc[0] + ol / 2 > W - 1) break;
    features.push({ id: `${id}-out${k + 1}`, type: "building", use: o.use, roof: B.roof === "slate" ? "wood-shingle" : B.roof, rot, ...(o.name ? { name: o.name } : {}), shape: rect(oc[0], oc[1], ol, od) });
    taken.push({ at: oc, r: Math.hypot(ol, od) / 2 + 2 });
    x += ol + 3;
  }
  // (a few props by it: an inn's wagon and barrels and well, a farm's cart, a smithy's barrels and crates)
  const PROPS = { inn: ["wagon", "barrel", "barrel", "well"], farmstead: ["cart", "barrel", "crate"], smithy: ["barrel", "crate", "crate"], shrine: [], watchtower: ["crate", "barrel"] };
  const placed = [];
  for (const [k, cls] of (PROPS[b.building.use] ?? []).entries()) {
    // (in front, between the buildings and the road, clear of the middle of the front where the door and its path are,
    // and of each other)
    for (let t = 0; t < 30; t++) {
      const along = r.range(-len / 2 - 4, len / 2 + 6), p = add(c, add(mul(u, along), mul(n, r.range(-dep / 2 - 2.5, -dep / 2 - 1))));
      if (Math.abs(along) < 2.5 || (road && nearPath(p, road.path) < road.width / 10 + 1) || placed.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1.6)) continue;
      placed.push(p);
      features.push({ id: `${id}-prop${k + 1}`, type: "prop", class: cls, at: pt(p), rot: Math.round(rot + r.range(-25, 25)) });
      break;
    }
  }
  return { at: c, r: Math.max(len, dep) / 2 + x / 2, name };
}

/**
 * A castle: its curtain wall around the map's middle (a closed loop, its towers by the wall's spacing, open or roofed as
 * asked), its road in from the map's foot through the gate in its south wall to its keep, the keep across the yard's top
 * and its buildings down the yard's sides, a well and a few things about the yard; with a road asked for, a track
 * across the map's foot that the gate's road comes off. Returns { at, r, pts } (pts: points all over the castle, kept
 * clear by what's placed after it).
 */
function castle(b, r, W, H, features, taken, crossRoad) {
  const C = CASTLES[b.size], [cw, ch] = C.wall, [X0, Y0] = C.at, X1 = X0 + cw, Y1 = Y0 + ch;
  const cx = r2((X0 + X1) / 2);
  features.push({ id: "curtain", type: "wall", class: "town", path: [[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1], [X0, Y0]], straight: true, towers: b.castle.towers, towerSpacing: C.spacing });
  // (the gate's road: up from the map's foot, or off a track across it, through the gate to the keep's door)
  const [kl, kd] = C.keep, ky0 = Y0 + 5, ky1 = ky0 + kd;
  const foot = crossRoad ? H - 2.6 : H + 2;
  if (crossRoad) features.push({ id: "road", type: "road", class: "track", surface: "dirt", width: 10, path: wander(r, foot, W, 0.6).map(pt) });
  features.push({ id: "gate-road", type: "road", class: "track", surface: "dirt", width: 10, path: [[cx, foot], [cx, ky1 + 1.5]], straight: true });
  features.push({ id: "bailey", type: "square", name: "Bailey", surface: "trodden", middle: "none", shape: { rect: [X0 + 1.2, Y0 + 1.2, X1 - 1.2, Y1 - 1.2] } }); // (the yard up to the wall's inner face)
  features.push({ id: "keep", type: "building", use: "keep", name: "Keep", roof: "slate", height: 40, roofStyle: "hip", shape: { rect: [r2(cx - kl / 2), ky0, r2(cx + kl / 2), ky1] } });
  // (the yard's buildings: each in the first clear place down its sides from the top, west and east in turn, then
  // along the south wall either side of the gate's road; clear of the keep, the road, each other and the wall's strip)
  const inset = 4.4, gap = 1, yard = [X0 + inset, Y0 + inset, X1 - inset, Y1 - inset];
  const keepBox = [cx - kl / 2, ky0, cx + kl / 2, ky1], roadBox = [cx - 1, ky1, cx + 1, Y1];
  const placed = [keepBox];
  const meets = (a, q, pad) => a[0] < q[2] + pad && a[2] > q[0] - pad && a[1] < q[3] + pad && a[3] > q[1] - pad;
  const fits = (q) => q[0] >= yard[0] - 1e-9 && q[1] >= yard[1] - 1e-9 && q[2] <= yard[2] + 1e-9 && q[3] <= yard[3] + 1e-9 && !meets(q, roadBox, gap) && !placed.some((o) => meets(q, o, gap));
  const slots = (len, dep, west) => {
    const out = [];
    for (let y = yard[1]; y + len <= yard[3]; y += 0.5) out.push(west ? [yard[0], y, yard[0] + dep, y + len] : [yard[2] - dep, y, yard[2], y + len]);
    for (let x = west ? yard[0] : yard[2] - len; west ? x + len <= cx : x >= cx; x += west ? 0.5 : -0.5) out.push([x, yard[3] - dep, x + len, yard[3]]);
    return out;
  };
  C.yard.forEach(([use, len, dep, roof], k) => {
    const q = [...slots(len, dep, k % 2 === 0), ...slots(len, dep, k % 2 === 1)].find(fits);
    if (!q) return;
    placed.push(q);
    features.push({ id: `yard-${k + 1}`, type: "building", use, roof, shape: { rect: q.map(r2) } });
  });
  // (a well and a few things about the yard)
  const things = [["well", [cx - 4, (ky1 + Y1) / 2]], ["cart", [cx + 4.5, ky1 + 4]], ["barrel", [cx + 4, Y1 - inset - 3]], ["barrel", [cx + 4.6, Y1 - inset - 2.6]], ["crate", [cx - 4.5, Y1 - inset - 3]]];
  // (each where no building stands)
  things.forEach(([cls, at], k) => { if (!placed.some((o) => meets([at[0], at[1], at[0], at[1]], o, 1.2))) features.push({ id: `${cls}-${k + 1}`, type: "prop", class: cls, at: pt(at), rot: Math.round(r.range(-30, 30)) }); });
  // (kept clear: the castle and a little around it)
  const pts = [];
  for (let x = X0 - 4; x <= X1 + 4; x += 1.5) for (let y = Y0 - 4; y <= Y1 + 4.5; y += 1.5) { pts.push([x, y]); taken.push({ at: [x, y], r: 1.2 }); }
  return { at: [cx, (Y0 + Y1) / 2], r: Math.hypot(cw, ch) / 2 + 4, pts };
}

/** A street site: the main street across, a lane or cross street off it, a square where a town's meet, the district over all. */
function street(b, r, W, H, features, taken, has) {
  const { place, quarter } = b.street;
  const big = place === "town" || place === "city";
  const surface = place === "city" ? "flagstone" : place === "town" ? "cobble" : b.season === "winter" ? "slush" : "dirt";
  const main = wander(r, H * r.range(0.45, 0.55), W, 1);
  features.push({ id: "street", type: "road", class: "street", surface, path: main.map(pt) });
  const x = W * r.range(0.4, 0.6), at = roadAt(main, x);
  const cross = big ? [[x + r.range(-2, 2), -2], at.p, [x + r.range(-2, 2), H + 2]] : [at.p, [x + r.range(-3, 3), H * 0.75], [x + r.range(-4, 4), H + 2]];
  features.push({ id: "cross", type: "road", class: big ? "street" : "lane", surface: big ? surface : b.season === "winter" ? "snow" : "dirt", path: cross.map(pt) });
  if (big) features.push({ id: "square", type: "square", surface: "flagstone", middle: place === "city" ? "fountain" : r.chance(0.5) ? "cross" : "none", shape: { circle: [r2(at.p[0]), r2(at.p[1]), r2(r.range(4, 5.5))] } });
  features.push({ id: "quarter", type: "district", profile: place, character: quarter, shape: { rect: [0, 0, W, H] } });
  taken.push({ path: main, half: 3 }, { path: cross, half: 3 });
  // (the houses take the ground: woods, rises and scatter keep to its edges)
  for (let yy = 4; yy < H - 3; yy += 3) for (let xx = 4; xx < W - 3; xx += 3) taken.push({ at: [xx, yy], r: 2.2 });
  return null;
}

/** A camp: its fire and tents (a campsite's around the fire, a caravan's inside its ring of wagons, soldiers' in rows). */
function camp(b, r, W, H, road, features, taken, topFrom = 0) {
  const { kind, want, per, R, RW, span } = campDims(b, W, H);
  // (beside the road, above it and clear of it, when there's one; else the map's middle. Above a road the room is
  // from the map's top to the road's highest point under the camp; a ring with too little room either way is
  // squashed to fit, and takes as many tents as go around it)
  let c, room;
  if (road) {
    const x = W * 0.5;
    let top = Infinity;
    for (let dx = -span - 1; dx <= span + 1; dx += 1) top = Math.min(top, roadAt(road.path, x + dx).p[1]);
    room = top - road.width / 10 - 1.5 - 1 - topFrom;
    c = [x, 1 + topFrom + room / 2];
  } else {
    room = H - 2 - topFrom;
    c = [W / 2 + r.range(-2, 2), topFrom + (H - topFrom) / 2 + r.range(-1, 1)];
  }
  // (a ring with too little room is squashed: the ring of tents takes what's left up and down once its outside (a
  // caravan's wagons, kept their full distance outside the tents) is allowed for, but no less than a tent's room
  // across from its middle)
  const extra = span - R;
  const ry = kind === "soldiers" ? R : Math.min(R, Math.max(RING_LEAST, room / 2 - extra));
  const sy = kind === "soldiers" ? 1 : ry / R;
  const reachY = kind === "soldiers" ? span : ry + extra;
  // (kept a square inside the map's sides)
  const sx = kind === "soldiers" ? (per * TENT_ROOM) / 2 + 5 : span;
  c[0] = Math.min(W - 1 - sx, Math.max(1 + sx, c[0]));
  if (!road) c[1] = Math.min(H - 1 - reachY, Math.max(1 + topFrom + reachY, c[1]));
  const around = (a, b2) => Math.PI * (3 * (a + b2) - Math.sqrt((3 * a + b2) * (a + 3 * b2))); // (an ellipse's perimeter)
  const tents = kind === "soldiers" ? Math.min(want, per * 2) : Math.max(1, Math.min(want, Math.floor(around(R, R * sy) / (TENT_ROOM + 0.1))));
  const notes = tents < want ? [`There's room for ${tents} tents in this camp on a ${b.size} map (${want} asked).`] : [];
  // (a ring's point at angle a, rad across and rady up and down)
  const ring = (a, rad, rady = rad * sy) => [c[0] + Math.cos(a) * rad, c[1] + Math.sin(a) * rady];
  // (n angles spaced evenly along a squashed ring, not evenly around its middle, so its tents stand as far apart at
  // its ends as at its sides; from angle a0)
  const evenly = (n, rad, rady = rad * sy, a0 = 0) => {
    const steps = 360, len = [0];
    for (let i = 1; i <= steps; i++) { const p = ring(a0 + ((i - 1) / steps) * 2 * Math.PI, rad, rady), q = ring(a0 + (i / steps) * 2 * Math.PI, rad, rady); len.push(len[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1])); }
    return Array.from({ length: n }, (_, k) => { const want = (k / n) * len[steps]; let i = 1; while (i < steps && len[i] < want) i++; return a0 + ((i - 1 + (want - len[i - 1]) / (len[i] - len[i - 1] || 1)) / steps) * 2 * Math.PI; });
  };
  const put = (id, cls, p, rot = 0, extra = {}) => { features.push({ id, type: "prop", class: cls, at: pt(p), rot: Math.round(rot), ...extra }); };
  const facing = (p) => (Math.atan2(c[1] - p[1], c[0] - p[0]) * 180) / Math.PI - 90; // (a tent's front, the art's bottom, toward the fire)
  let reach;
  if (kind === "soldiers") {
    // Two rows of tents either side of a lane, a commander's tent at its head, braziers at the lane's ends, one cloth
    const gap = TENT_ROOM, len = Math.ceil(tents / 2) * gap, cloth = r.int(6);
    for (let i = 0; i < tents; i++) {
      const row = i % 2 ? 1 : -1, j = Math.floor(i / 2), p = [c[0] - len / 2 + gap / 2 + j * gap, c[1] + row * 3];
      put(`tent-${i + 1}`, "tent", p, row > 0 ? 0 : 180, { variant: cloth });
    }
    put("command", "tent", [c[0] + len / 2 + 3.2, c[1]], 90, { variant: cloth, size: 20 });
    put("fire", "firepit", [c[0] - len / 2 - 1.5, c[1]]);
    put("brazier-1", "brazier", [c[0] + len / 2 + 0.8, c[1] - 2.2]);
    put("brazier-2", "brazier", [c[0] + len / 2 + 0.8, c[1] + 2.2]);
    put("crates-1", "crate", [c[0] - len / 2 - 1.5, c[1] - 2.5]); put("crates-2", "crate", [c[0] - len / 2 - 2.2, c[1] - 2.2]); put("barrel-1", "barrel", [c[0] - len / 2 - 1.6, c[1] + 2.4]);
    reach = len / 2 + 5;
  } else {
    // Tents in a ring facing the fire; a caravan's wagons in a wider ring around them, bedrolls by the fire
    put("fire", "campfire", c);
    // (each a little off its place, by no more than leaves a tent's room between neighbors)
    const slack = Math.max(0, around(R, R * sy) / tents - TENT_ROOM) * 0.4, at = evenly(tents, R);
    for (let i = 0; i < tents; i++) {
      const a = at[i] + (r.range(-1, 1) * Math.min(0.15 * R, slack)) / R, p = ring(a, R);
      put(`tent-${i + 1}`, "tent", p, facing(p));
    }
    const rolls = kind === "campsite" ? Math.min(4, tents) : 2;
    for (let i = 0; i < rolls; i++) {
      const a = ((i + 0.5) / tents) * 2 * Math.PI, p = [c[0] + Math.cos(a) * 2, c[1] + Math.sin(a) * 2];
      put(`bedroll-${i + 1}`, "bedroll", p, facing(p) + 90);
    }
    reach = R + 2.5;
    if (kind === "caravan") {
      const n = Math.max(4, Math.min(Math.ceil(tents * 1.2), Math.floor(around(RW, ry + 4.2) / 3.4)));
      const wy = ry + 4.2, wat = evenly(n, RW, wy);
      for (let i = 0; i < n; i++) {
        const a = wat[i], p = ring(a, RW, wy);
        put(`wagon-${i + 1}`, "wagon", p, (Math.atan2((wy / RW) * Math.cos(a), -Math.sin(a)) * 180) / Math.PI - 90); // (along the ring)
      }
      put("barrel-1", "barrel", [c[0] + R * 0.5, c[1] - R * 0.6 * sy]); put("crate-1", "crate", [c[0] - R * 0.6, c[1] + R * 0.5 * sy]);
      reach = RW + 3;
    } else put("firewood", "log", [c[0] + 1.6, c[1] + 0.9], 20);
  }
  taken.push({ at: c, r: reach });
  return { at: c, r: reach, notes };
}

/** The room a tent takes around a ring or along a row: its 3 squares and a little between. */
const TENT_ROOM = 3.6;
/** The least a ring of tents is across its short way, from its middle: a tent's room and a little more. */
const RING_LEAST = 3.2;

/**
 * A camp's size on its map: its kind, the tents asked for, its ring of tents' radius R (a caravan's wagons' RW
 * outside it), how far it reaches from its middle (span; a ring is kept a square inside the map's sides), and a
 * soldiers' camp's tents to a row (per, as many as fit with the commander's tent at the head).
 */
function campDims(b, W, H) {
  const kind = b.camp.kind, want = b.camp.tents ?? TENTS[kind];
  if (kind === "soldiers") return { kind, want, R: 0, RW: 0, span: 5, per: Math.max(1, Math.min(Math.ceil(want / 2), Math.floor((W - 13) / TENT_ROOM))) };
  const extra = kind === "caravan" ? 7.2 : 2.5;
  const R = Math.max(3.6, Math.min(1.2 * want, W / 2 - 1 - extra));
  return { kind, want, R, RW: R + 4.2, span: R + extra, per: 0 };
}

/** An invented inn's name: "The Weary Fox". */
function innName(r) {
  return `The ${r.pick(["Wayside", "Gilded", "Crooked", "Weary", "Laughing", "Silver", "Red", "Drowsy", "Wandering", "Painted"])} ${r.pick(["Lantern", "Stag", "Kettle", "Goose", "Anchor", "Barrel", "Fox", "Wheel", "Hound", "Plow"])}`;
}

/** A plan's name from its brief: "Forest cliff", the building's name (an inn's made up) or "Roadside smithy", "Village street", "Caravan camp". */
function defaultName(b, site) {
  const feat = ["cliff", "stream", "pond", "hollow", "rise"].find((f) => b.features.includes(f));
  if (b.site === "wilderness") return `${BRIEF_LABELS.ground[b.ground]}${feat ? ` ${feat}` : ""}`;
  if (b.site === "roadside") return site?.name || `Roadside ${BRIEF_LABELS.use[b.building.use].toLowerCase()}`;
  if (b.site === "street") return `${BRIEF_LABELS.place[b.street.place]} street`;
  if (b.site === "castle") return BRIEF_LABELS.castleSize[b.size].replace(/ \(.*$/, "");
  return `${BRIEF_LABELS.camp[b.camp.kind]} camp`;
}
