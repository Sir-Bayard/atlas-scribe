/**
 * Quick Start's region: a stretch of country many miles across from a few choices. A coast along one edge (or none),
 * mountains along another with hills before them, rivers running from the high ground to the sea or off the map
 * with streams joining them, lakes, woods, a marsh or two; then its places (a city where a river meets the coast or
 * crosses the plain, towns, villages and hamlets on the good land, castles on the hills, ruins, a mine by the
 * mountains, a temple, an inn on a road), every place named, joined by roads (the main ones between the city and
 * towns, tracks out to the villages), and farmland around the settled places. Pure: runs anywhere.
 */
import { PLAN_VERSION } from "./plan.mjs";
import { rng } from "./rng.mjs";
import { makeNoise } from "./noise.mjs";
import { placeName, slug } from "./quick.mjs";

/** Quick Start's region choices; the first of each is the default, and "any" lets the seed pick. */
export const REGION = {
  size: ["medium", "small", "large"],
  coast: ["any", "none", "north", "south", "east", "west"],
  mountains: ["any", "none", "edge", "scattered"],
  woods: ["some", "few", "many"],
  places: ["some", "few", "many"],
  season: ["summer", "spring", "autumn", "winter"],
};
export const REGION_LABELS = {
  size: { small: "Small (40 by 30 mi)", medium: "Medium (60 by 45 mi)", large: "Large (80 by 60 mi)" },
  coast: { any: "Any", none: "None", north: "North", south: "South", east: "East", west: "West" },
  mountains: { any: "Any", none: "None", edge: "Along an edge", scattered: "Scattered" },
  woods: { few: "Few", some: "Some", many: "Many" },
  places: { few: "Few", some: "Some", many: "Many" },
  season: { summer: "Summer", spring: "Spring", autumn: "Autumn", winter: "Winter" },
};
const SIZES = { small: [80, 60], medium: [120, 90], large: [160, 120] };
const r1 = (v) => Math.round(v * 10) / 10;
const pt = (p) => [r1(p[0]), r1(p[1])];

function inside([x, y], poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) c = !c;
  }
  return c;
}
const distSeg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0; return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]); };
const distPath = (p, path) => path.reduce((m, q, i) => (i ? Math.min(m, distSeg(p, path[i - 1], q)) : m), Infinity);

/** A blob around c of about radius rad: n points, each pushed in or out by noise. */
function blob(r, c, rad, n = 18, rough = 0.35) {
  return Array.from({ length: n }, (_, k) => { const a = (2 * Math.PI * k) / n, d = rad * (1 - rough / 2 + r.next() * rough); return [c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d]; });
}

/** The point on an edge's side: "north" is y = 0, and so on. along: 0 to 1 along it. */
const edgeAt = (side, along, W, H, inset = 0) => ({ north: [along * W, inset], south: [along * W, H - inset], west: [inset, along * H], east: [W - inset, along * H] })[side];
const OPPOSITE = { north: "south", south: "north", east: "west", west: "east" };

/**
 * The region's plan. options: { size, coast, mountains, woods, places, season, name, seed } (any left out or "any"
 * picked from the seed). Returns { plan, choices, notes }.
 */
export function regionPlan(options = {}) {
  const seed = Number.isFinite(Number(options.seed)) && Number(options.seed) >= 1 ? Math.floor(Number(options.seed)) : 1;
  const r = rng(seed, "region");
  const notes = [];
  const pick = (k) => { const v = options[k]; if (v != null && v !== "" && !REGION[k].includes(v)) notes.push(`"${v}" isn't a ${k} a region knows (${REGION[k].join(", ")}), so the seed picked one.`); return REGION[k].includes(v) && v !== "any" ? v : null; };
  const sides = ["north", "south", "east", "west"];
  const choices = {
    size: pick("size") ?? "medium",
    coast: pick("coast") ?? (r.fork("coast").next() < 0.3 ? "none" : r.fork("coast-side").pick(sides)),
    mountains: pick("mountains") ?? r.fork("mountains").pick(["edge", "edge", "scattered", "none"]),
    woods: pick("woods") ?? "some", places: pick("places") ?? "some", season: pick("season") ?? "summer",
  };
  const [W, H] = SIZES[choices.size];
  const k = (W * H) / (120 * 90); // (counts scale with the map)
  const features = [];
  const n = {};
  const id = (kind) => `${kind}-${(n[kind] = (n[kind] ?? 0) + 1)}`;

  // The sea: past a ragged line along its edge
  let sea = null;
  if (choices.coast !== "none") {
    const side = choices.coast, horiz = side === "north" || side === "south", len = horiz ? W : H, depth = (horiz ? H : W) * r.range(0.12, 0.22);
    const noise = makeNoise(seed, "coast", { scale: 18, octaves: 3 });
    const line = [];
    for (let t = -2; t <= len + 2; t += 2) { const d = depth * (0.65 + 0.7 * (noise(t, 0) + 1) / 2); line.push(side === "north" ? [t, d] : side === "south" ? [t, H - d] : side === "west" ? [d, t] : [W - d, t]); }
    const out = { north: [[W + 3, -3], [-3, -3]], south: [[W + 3, H + 3], [-3, H + 3]], west: [[-3, H + 3], [-3, -3]], east: [[W + 3, H + 3], [W + 3, -3]] }[side];
    sea = { side, line, poly: [...line, ...out] };
    features.push({ id: "sea", type: "water", class: "sea", shape: sea.poly.map(pt) });
  }
  const wet = (p) => !!sea && inside(p, sea.poly);

  // Mountains: a range along the edge away from the sea, or scattered massifs; hills before them
  const high = [];
  const mside = sea ? OPPOSITE[sea.side] : r.fork("mside").pick(sides);
  if (choices.mountains === "edge") {
    const horiz = mside === "north" || mside === "south", len = horiz ? W : H;
    for (let t = len * r.range(0, 0.15); t < len * r.range(0.85, 1); t += r.range(10, 16)) {
      const c = edgeAt(mside, t / len, W, H, r.range(4, 9));
      const m = blob(r, c, r.range(6, 10));
      high.push(m);
      features.push({ id: id("mountains"), type: "area", class: "mountains", shape: m.map(pt) });
      const hc = edgeAt(mside, t / len, W, H, r.range(12, 17));
      features.push({ id: id("hills"), type: "area", class: "hills", shape: blob(r, hc, r.range(6, 9)).map(pt) });
    }
  } else if (choices.mountains === "scattered") {
    for (let t = 0; t < Math.round(3 * k); t++) {
      const c = [r.range(W * 0.15, W * 0.85), r.range(H * 0.15, H * 0.85)];
      if (wet(c)) continue;
      const m = blob(r, c, r.range(5, 8));
      high.push(m);
      features.push({ id: id("mountains"), type: "area", class: "mountains", shape: m.map(pt) });
      features.push({ id: id("hills"), type: "area", class: "hills", shape: blob(r, [c[0] + r.range(-6, 6), c[1] + r.range(-6, 6)], r.range(7, 10)).map(pt) });
    }
  }
  const onHigh = (p) => high.some((m) => inside(p, m));

  // Rivers: from the high ground (or an edge) toward the sea (or the far edge), meandering; streams join them
  const rivers = [];
  const target = (from) => {
    if (sea) { const q = sea.line[Math.floor(r.next() * sea.line.length)]; return q; }
    const side = OPPOSITE[mside] ?? "south";
    return edgeAt(side, r.range(0.2, 0.8), W, H, -2);
  };
  const flow = (start, end, rr, step = 2.2) => {
    const pts = [start];
    let p = start;
    for (let guard = 0; guard < 300; guard++) {
      const d = Math.hypot(end[0] - p[0], end[1] - p[1]);
      if (d < step * 1.5 || wet(p) || p[0] < -2 || p[1] < -2 || p[0] > W + 2 || p[1] > H + 2) break;
      const a = Math.atan2(end[1] - p[1], end[0] - p[0]) + (rr.next() - 0.5) * 1.3;
      p = [p[0] + Math.cos(a) * step, p[1] + Math.sin(a) * step];
      pts.push(p);
    }
    pts.push(end);
    return pts;
  };
  const nRivers = choices.mountains === "none" ? 1 + r.int(2) : 1 + r.int(3);
  for (let i = 0; i < nRivers; i++) {
    const rr = r.fork("river", i);
    const start = high.length ? (() => { const m = high[rr.int(high.length)]; return m[rr.int(m.length)]; })() : edgeAt(mside, rr.range(0.2, 0.8), W, H, -2);
    const path = flow(start, target(start), rr);
    if (path.length < 4) continue;
    rivers.push(path);
    features.push({ id: id("river"), type: "water", class: "river", path: path.map(pt) });
    // (a stream or two joining it from the side)
    for (let j = 0; j < 1 + rr.int(2); j++) {
      const at = path[Math.floor(path.length * rr.range(0.3, 0.75))], side = rr.next() < 0.5 ? 1 : -1;
      const from = [at[0] + side * rr.range(12, 22), at[1] + rr.range(-14, 14)];
      if (from[0] < 0 || from[1] < 0 || from[0] > W || from[1] > H || wet(from)) continue;
      const s = flow(from, at, rr.fork("stream", j), 1.8);
      if (s.length >= 4) features.push({ id: id("stream"), type: "water", class: "stream", path: s.map(pt) });
    }
  }
  // Lakes, and a marsh by the water now and then
  for (let i = 0; i < r.int(3); i++) {
    const c = [r.range(W * 0.15, W * 0.85), r.range(H * 0.15, H * 0.85)];
    if (wet(c) || onHigh(c) || rivers.some((p) => distPath(c, p) < 6)) continue;
    features.push({ id: id("lake"), type: "water", class: "lake", shape: blob(r, c, r.range(2.5, 5), 14).map(pt) });
  }
  if (r.next() < 0.6 && rivers.length) {
    const p = rivers[0][Math.max(0, rivers[0].length - 3)];
    features.push({ id: id("marsh"), type: "area", class: "marsh", shape: blob(r, p, r.range(4, 7)).map(pt) });
  }

  // Places: on dry, low ground, apart
  const placed = [];
  // (a square clear of the mountains' foot, all around)
  const offHigh = (p) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => !onHigh([p[0] + dx, p[1] + dy]));
  const free = (p, apart) => p[0] > 3 && p[1] > 3 && p[0] < W - 3 && p[1] < H - 3 && !wet(p) && offHigh(p) && !placed.some((q) => Math.hypot(q.at[0] - p[0], q.at[1] - p[1]) < apart);
  const nearWater = (p) => (sea ? distPath(p, sea.line) : Infinity) < 3 || rivers.some((path) => distPath(p, path) < 1.5);
  const want = { few: 0.6, some: 1, many: 1.6 }[choices.places];
  const add = (cls, count, apart, prefer = () => 0) => {
    const pr = r.fork("places", cls);
    for (let c = 0, tries = 0; c < count && tries < count * 200; tries++) {
      // (of a few spots, the one its kind likes best: a city by water, a castle on the hills)
      let best = null;
      for (let t = 0; t < 8; t++) { const p = [pr.range(3, W - 3), pr.range(3, H - 3)]; if (!free(p, apart)) continue; const s = prefer(p) + pr.next() * 0.3; if (!best || s > best.s) best = { p, s }; }
      if (!best) continue;
      placed.push({ cls, at: best.p, name: cls === "ruin" || cls === "mine" || cls === "inn" || cls === "temple" || cls === "tower" ? null : placeName(pr, nearWater(best.p) ? "river" : "none") });
      c++;
    }
  };
  const hillsAreas = features.filter((f) => f.class === "hills").map((f) => f.shape);
  add("city", 1, 20, (p) => (nearWater(p) ? 2 : 0) - Math.hypot(p[0] - W / 2, p[1] - H / 2) / W);
  add("town", Math.round((2 + r.int(3)) * k * want), 14, (p) => (nearWater(p) ? 1 : 0));
  add("village", Math.round((6 + r.int(6)) * k * want), 7, (p) => (nearWater(p) ? 0.5 : 0));
  add("hamlet", Math.round((3 + r.int(5)) * k * want), 5);
  add("castle", Math.round((1 + r.int(2)) * k), 12, (p) => (hillsAreas.some((h) => inside(p, h)) ? 2 : 0));
  add("ruin", Math.round((1 + r.int(3)) * k), 8);
  if (high.length) add("mine", 1, 6, (p) => -Math.min(...high.map((m) => Math.min(...m.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1]))))) / 5);
  add("temple", 1, 8);
  add("tower", r.int(2), 10);
  // (names made apart: no two places share one)
  const names = new Set();
  for (const p of placed) if (p.name) { let nm = p.name, t = 0; while (names.has(nm) && t++ < 20) nm = placeName(r.fork("rename", t, p.at[0]), "none"); p.name = names.has(nm) ? null : nm; if (p.name) names.add(p.name); }

  // Roads: the city and towns joined (a tree of the shortest links, and one more), villages and hamlets to their
  // nearest, never over the mountains; an inn on a main road
  const linkable = placed.filter((p) => ["city", "town", "village", "hamlet", "castle"].includes(p.cls));
  const crossesHigh = (a, b) => { for (let t = 0.05; t < 1; t += 0.05) if (onHigh([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])) return true; return false; };
  const crossesSea = (a, b) => { for (let t = 0.05; t < 1; t += 0.05) if (wet([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])) return true; return false; };
  const road = (a, b, cls, rr) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.max(2, Math.round(L / 5)), nx = -(b[1] - a[1]) / (L || 1), ny = (b[0] - a[0]) / (L || 1);
    const path = [a];
    for (let s = 1; s < steps; s++) { const t = s / steps, w = (rr.next() - 0.5) * Math.min(3, L * 0.08); path.push([a[0] + (b[0] - a[0]) * t + nx * w, a[1] + (b[1] - a[1]) * t + ny * w]); }
    path.push(b);
    // (its bends kept off the mountains and out of the sea; else it runs straight, which was checked)
    const ok = path.every((q, i) => !i || [0.25, 0.5, 0.75, 1].every((t) => { const m = [path[i - 1][0] + (q[0] - path[i - 1][0]) * t, path[i - 1][1] + (q[1] - path[i - 1][1]) * t]; return !onHigh(m) && !wet(m); }));
    features.push({ id: id("road"), type: "road", class: cls, path: (ok ? path : [a, b]).map(pt) });
  };
  const big = linkable.filter((p) => p.cls === "city" || p.cls === "town");
  const inTree = big.length ? [big[0]] : [];
  const rest = big.slice(1);
  const links = [];
  while (rest.length) {
    let best = null;
    for (const a of inTree) for (const b of rest) { const d = Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]); if ((!best || d < best.d) && !crossesHigh(a.at, b.at) && !crossesSea(a.at, b.at)) best = { a, b, d }; }
    if (!best) break;
    links.push(best); inTree.push(best.b); rest.splice(rest.indexOf(best.b), 1);
  }
  links.forEach(({ a, b }, i) => road(a.at, b.at, "highway", r.fork("road", "main", i)));
  for (const [i, v] of linkable.filter((p) => !big.includes(p)).entries()) {
    const to = linkable.filter((q) => q !== v && (big.includes(q) || q.cls === "village") && !crossesHigh(v.at, q.at) && !crossesSea(v.at, q.at)).sort((a, b) => Math.hypot(a.at[0] - v.at[0], a.at[1] - v.at[1]) - Math.hypot(b.at[0] - v.at[0], b.at[1] - v.at[1]))[0];
    if (to && Math.hypot(to.at[0] - v.at[0], to.at[1] - v.at[1]) < 30) road(v.at, to.at, v.cls === "castle" || v.cls === "village" ? "street" : "track", r.fork("road", "side", i));
  }
  if (links.length) { const l = links[0], t = r.range(0.35, 0.65); const at = [l.a.at[0] + (l.b.at[0] - l.a.at[0]) * t, l.a.at[1] + (l.b.at[1] - l.a.at[1]) * t]; if (!wet(at)) placed.push({ cls: "inn", at, name: null }); }

  // Woods: blobs on dry, low ground off the places; farmland around the settled places
  const nWoods = Math.round({ few: 4, some: 8, many: 14 }[choices.woods] * k);
  for (let i = 0, t = 0; i < nWoods && t < nWoods * 20; t++) {
    const c = [r.range(0, W), r.range(0, H)];
    if (wet(c) || onHigh(c) || placed.some((p) => Math.hypot(p.at[0] - c[0], p.at[1] - c[1]) < 6)) continue;
    features.push({ id: id("woods"), type: "area", class: "woods", shape: blob(r, c, r.range(3, 8), 16, 0.5).map(pt) });
    i++;
  }
  for (const p of placed.filter((q) => ["city", "town", "village"].includes(q.cls))) {
    const rad = { city: 6, town: 4.5, village: 3 }[p.cls];
    for (let j = 0; j < 2; j++) {
      const c = [p.at[0] + r.range(-rad, rad), p.at[1] + r.range(-rad, rad)];
      if (!wet(c) && !onHigh(c)) features.push({ id: id("fields"), type: "area", class: "fields", shape: blob(r, c, rad * r.range(0.5, 0.8), 10, 0.4).map(pt) });
    }
  }

  // The places, and their names as labels just under each, following them
  const name = typeof options.name === "string" && options.name.trim() ? options.name.trim() : `The ${placeName(r.fork("name"), "none")} Reach`;
  for (const p of placed) {
    const fid = id(p.cls);
    features.push({ id: fid, type: "place", class: p.cls, ...(p.name ? { name: p.name } : {}), at: pt(p.at) });
    // (following the place: moved, renamed or deleted with it)
    if (p.name) features.push({ id: `${fid}-label`, type: "label", of: fid, offset: [0, p.cls === "city" ? 1.8 : 1.2], size: p.cls === "city" ? "large" : p.cls === "town" ? "normal" : "small", show: "all" });
  }
  features.push({ id: "name", type: "label", text: name, at: [r1(W / 2), 2.5], size: "huge", show: "gm" });
  const plan = {
    atlasScribe: PLAN_VERSION, id: `${slug(name)}-${seed}`, name, kind: "region", seed, season: choices.season,
    size: { squares: [W, H], ftPerSquare: 2640 }, ground: choices.season === "winter" ? "snow" : "grass",
    features, output: { pxPerSquare: 40, scene: { name, weather: "none" } },
  };
  return { plan, choices: { ...choices, seed, name }, notes };
}
