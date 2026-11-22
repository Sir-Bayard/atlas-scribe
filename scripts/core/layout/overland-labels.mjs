/**
 * Names and labels for an overland map: every place and the land's features (seas, bays, lakes, main rivers, ranges,
 * forests, deserts, marshes, islands, capes, and on a continent or world map the land masses) get a name, the plan's
 * own where it has one (a place's name, `land.names` by feature id), else an invented one in the plan's name style
 * (`land.nameStyle`). Each gets a hidden label, sized by the picture as the markers are: a place's beside its mark
 * where it clears the others, a river's turned along its straightest stretch, a range's along its spine in capitals,
 * the rest over their middle. Pure.
 */
import { namer } from "../land/names.mjs";
import { parseNameSet, usesRiver } from "../land/namesets.mjs";
import { readable, cleanFont } from "../labels.mjs";
import { Heap } from "../land/heap.mjs";

/** Each label's font size in pixels on a picture 3600 px on its long side (larger pictures, larger labels alike). */
export const LABEL_PX = { realm: 46, city: 34, town: 27, village: 19, hamlet: 17, castle: 21, ruin: 18, tower: 18, temple: 18, inn: 17, mine: 17, place: 18, sea: 62, ocean: 80, land: 72, range: 36, river: 23, lake: 26, bigLake: 34, bay: 28, forest: 27, desert: 30, marsh: 23, island: 25, cape: 19 };
// (each mark's half size, in the same pixels as the markers: the label sits beside it)
const MARK_PX = { city: 13, town: 9.6, village: 5, hamlet: 3.4, castle: 12, ruin: 11, tower: 13, temple: 7, inn: 4.5, mine: 6 };
const WATER = new Set(["sea", "ocean", "bay", "lake", "bigLake", "river"]);
// (each look's colors: Foundry outlines a light label in black and a dark one in white, so "bold" is white with a black
// outline and "ink" dark with a light one)
const LOOKS = { bold: { water: "#e8f3ff", land: "#fff8ec", place: "#ffffff" }, ink: { water: "#1d4a6e", land: "#4b3621", place: null } };
const FONT = { water: "Amiri", land: "Vollkorn" };
// (the order labels are placed in: the first placed keeps its spot, later ones step around it)
const ORDER = ["ocean", "sea", "land", "realm", "range", "city", "town", "river", "bigLake", "lake", "bay", "castle", "forest", "desert", "marsh", "island", "village", "cape", "ruin", "tower", "temple", "inn", "mine", "hamlet", "place"];

/**
 * plan: the normalized plan; land: the layout's compact land; items: the layout's items so far; keepOut: boxes in map
 * units labels keep off where they can (the compass rose, the scale bar, the key and the cartouche: core/dressing.mjs);
 * hidden: boxes covering the map (the key), so a place under one gets no label. Returns { labels,
 * placeNames: Map(place id -> name), featureNames: Map(inventory id -> name, for each named feature) }; labels are in labelsOf's shape plus `em` (font size in map units) and `gen`
 * (made here, not a plan label).
 */
export function overlandLabels(plan, land, items, { keepOut = [], hidden = [], realms = [], borders = [] } = {}) {
  const f = land.frame, mpu = f.mpu, M = f.margin;
  const MW = f.mapW / mpu, MH = f.mapH / mpu, side = Math.max(MW, MH);
  const em = (px) => (px * side) / 3600;
  const U = (x, y) => [(x - M) / mpu, (y - M) / mpu];
  const inside = (u, v, pad = 0) => u >= pad && v >= pad && u <= MW - pad && v <= MH - pad;
  const scene = plan.output?.scene ?? {};
  const COLOR = LOOKS[scene.labelLook] ?? LOOKS.bold;
  const placeColor = COLOR.place ?? (/^#[0-9a-f]{6}$/i.test(scene.labelColor ?? "") ? scene.labelColor : "#13202e");
  const ownFont = cleanFont(scene.labelFont), placeFont = ownFont && ownFont !== "Signika" ? ownFont : FONT.land;
  // (a GM's own name set: read once for its text)
  const set = plan.land?.nameStyle === "custom" && typeof plan.land?.nameSet?.text === "string" ? setOf(plan.land.nameSet.text) : null;
  const nm = namer(set ? "custom" : plan.land?.nameStyle, Number.isFinite(plan.land?.seed) ? plan.land.seed : plan.seed, { set });
  const given = plan.land?.names && typeof plan.land.names === "object" ? plan.land.names : {};
  const byId = new Map((plan.features ?? []).map((q) => [q.id, q]));
  const clean = (s) => (typeof s === "string" && s.trim() ? s.replace(/\s+/g, " ").trim() : null);
  // (names the plan gives are taken first, so an invented one never repeats them)
  for (const q of plan.features ?? []) if (q.type === "place" && clean(q.name)) nm.take(clean(q.name));
  for (const v of Object.values(given)) if (clean(v)) nm.take(clean(v));
  // a nearest-node lookup, for heights under a range
  const cell = Math.max(land.spacing * 2, 1e-6), gw = Math.ceil(f.W / cell) + 1, buckets = new Map();
  for (let i = 0; i < land.n; i++) { const k = Math.floor(land.x[i] / cell) + Math.floor(land.y[i] / cell) * gw; (buckets.get(k) ?? buckets.set(k, []).get(k)).push(i); }
  const nearest = (x, y) => { let b = -1, bd = Infinity; const cx = Math.floor(x / cell), cy = Math.floor(y / cell); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const i of buckets.get(cx + dx + (cy + dy) * gw) ?? []) { const d = (land.x[i] - x) ** 2 + (land.y[i] - y) ** 2; if (d < bd || (d === bd && i < b)) { bd = d; b = i; } } return b; };

  // ---- what's to be named ----
  const inv = (land.inventory ?? []).filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
  const mapArea = f.mapW * f.mapH;
  // (each feature named once: a river a place's name needs is named then, and keeps that name)
  const madeNames = new Map();
  const named = (q, kind, info = {}) => {
    if (madeNames.has(q.id)) return madeNames.get(q.id);
    const near = ["bay", "lake", "marsh", "cape"].includes(kind) ? nearTown(q) : null;
    const name = clean(given[q.id]) ?? nm.feature(kind, { ...info, near }, q.id);
    madeNames.set(q.id, name);
    return name;
  };
  // (a place's river by name, for a name set whose word parts name it: Inver-something)
  const riverOf = set && usesRiver(set) ? (id) => { const q = inv.find((r) => r.kind === "river" && r.river === id); return q ? named(q, "river") : null; } : null;
  const nearTown = (q) => {
    const [u, v] = U(q.x, q.y);
    let best = null, bd = (0.09 * side) ** 2;
    for (const p of places) if (p.class === "city" || p.class === "town" || p.class === "village") { const d = (p.x - u) ** 2 + (p.y - v) ** 2; if (d < bd) { bd = d; best = placeNames.get(p.id); } }
    // (its plain name only: "Fenford", not "Fenford Keep")
    return best && /^\p{Lu}\p{Ll}+$/u.test(best) ? best : null;
  };
  const want = [];
  // (a place past the map's edge, or under the key, keeps its name but gets no label)
  const places = items.filter((i) => i.kind === "place");
  const shown = (p) => inside(p.x, p.y) && !hidden.some((b) => p.x > b[0] && p.x < b[2] && p.y > b[1] && p.y < b[3]);
  const placeNames = new Map();
  const rank = (c) => (ORDER.indexOf(c) < 0 ? ORDER.length : ORDER.indexOf(c));
  for (const p of places.slice().sort((a, b) => rank(a.class) - rank(b.class) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const raw = byId.get(p.from ?? p.id);
    const site = raw?.site && typeof raw.site === "object" ? { ...raw.site, mouth: !!raw.site.river && raw.site.coast != null } : {};
    if (riverOf && site.river?.id !== undefined) site.riverName = riverOf(site.river.id);
    const name = clean(raw?.name) ?? clean(p.name) ?? nm.place(p.class, site, p.id);
    placeNames.set(p.id, name);
    const cls = LABEL_PX[p.class] ? p.class : "place";
    if (shown(p)) want.push({ id: `@place:${p.id}`, kind: cls, text: name, place: p, px: LABEL_PX[cls] });
  }
  // realms: each name in wide spaced capitals over the heart of its land (its spot, the farthest from its borders),
  // smaller for a small realm so it stays inside it
  for (const R of realms) {
    if (!R.spot || !R.name) continue;
    const letters = R.name.toUpperCase().replace(/\s+/g, " ").length, full = em(LABEL_PX.realm);
    const fits = (2 * R.room) / Math.max(1, letters * 0.66 * 1.4);
    want.push({ id: `@realm:${R.id}`, kind: "realm", text: R.name, spot: R.spot, caps: true, spaced: true, px: Math.max(22, Math.min(LABEL_PX.realm, (LABEL_PX.realm * Math.min(full, fits)) / full)) });
  }
  // features: by kind, the biggest first, with limits so a map isn't flooded with small ones
  const kindsOf = (k) => inv.filter((q) => q.kind === k).sort((a, b) => (b.size ?? 0) - (a.size ?? 0) || (a.id < b.id ? -1 : 1));
  for (const q of kindsOf("sea")) { const big = q.size > 0.2 * mapArea && (f.scale === "continent" || f.scale === "world"); want.push({ id: `@land:${q.id}`, kind: big ? "ocean" : "sea", text: named(q, "sea", { big }), q }); }
  if (f.scale === "continent" || f.scale === "world") for (const q of kindsOf("land")) want.push({ id: `@land:${q.id}`, kind: "land", text: named(q, "land"), q, caps: true });
  // (a river or range by the part of it in the map: one wholly in the margin past the edge goes unnamed here)
  const lineOf = (q, kind) => (kind === "river" ? riverLine(land, q, U) : (q.points ?? []).map(([x, y]) => U(x, y)));
  const runsOf = (line) => { const runs = []; let cur = []; for (const p of line) { if (inside(p[0], p[1], 0.2)) cur.push(p); else { if (cur.length) runs.push(cur); cur = []; } } if (cur.length) runs.push(cur); return runs; };
  const lengthOf = (run) => { let t = 0; for (let k = 1; k < run.length; k++) t += Math.hypot(run[k][0] - run[k - 1][0], run[k][1] - run[k - 1][1]); return t; };
  const seen = (q, kind) => { const runs = runsOf(lineOf(q, kind)).map((r) => ({ r, len: lengthOf(r) })).sort((a, b) => b.len - a.len); return { runs, len: runs.reduce((t, x) => t + x.len, 0) }; };
  for (const { q, vis } of kindsOf("range").map((q) => ({ q, vis: seen(q, "range") })).filter((x) => x.vis.len > 0).slice(0, 8)) {
    let hs = 0, k = 0; for (const [x, y] of q.points ?? [[q.x, q.y]]) { const i = nearest(x, y); if (i >= 0 && land.landMask[i]) { hs += land.h[i]; k++; } }
    want.push({ id: `@land:${q.id}`, kind: "range", text: named(q, "range", { high: k ? hs / k > 0.42 : false }), q, vis, caps: true });
  }
  // (the main rivers: those with a good length in the map)
  const rivers = kindsOf("river").map((q) => ({ q, vis: seen(q, "river") })).filter((x) => x.vis.len > 0.12 * side).sort((a, b) => b.vis.len - a.vis.len || (a.q.id < b.q.id ? -1 : 1)).slice(0, 14);
  for (const { q, vis } of rivers) want.push({ id: `@land:${q.id}`, kind: "river", text: named(q, "river"), q, vis });
  for (const q of kindsOf("lake").filter((q) => q.size > 0.0006 * mapArea).slice(0, 12)) want.push({ id: `@land:${q.id}`, kind: q.size > 0.006 * mapArea ? "bigLake" : "lake", text: named(q, "lake", { size: q.size }), q });
  // (a bay of the sea only: the inventory's bay finder can also catch a lake's arm, which the lake's name covers; and
  // water shut in by land with no sea of the inventory's in it, as a landlocked map can have, is named once, as a lake)
  const comp = new Int32Array(land.n).fill(-1);
  { let c = 0; for (let s0 = 0; s0 < land.n; s0++) { if (land.landMask[s0] || comp[s0] >= 0) continue; const st = [s0]; comp[s0] = c; while (st.length) { const i = st.pop(); for (let k = land.indptr[i]; k < land.indptr[i + 1]; k++) { const j = land.indices[k]; if (!land.landMask[j] && comp[j] < 0) { comp[j] = c; st.push(j); } } } c++; } }
  const seaComps = new Set(kindsOf("sea").map((q) => comp[nearest(q.x, q.y)]).filter((c) => c >= 0));
  const shutIn = new Set();
  for (const q of kindsOf("bay").filter((q) => { const i = nearest(q.x, q.y); return i >= 0 && !land.landMask[i] && land.lake[i] !== 1; })) {
    const c = comp[nearest(q.x, q.y)];
    if (seaComps.has(c)) { if (want.filter((x) => x.kind === "bay").length < 8) want.push({ id: `@land:${q.id}`, kind: "bay", text: named(q, "bay"), q }); continue; }
    if (shutIn.has(c)) continue;
    shutIn.add(c);
    let n = 0; for (let i = 0; i < land.n; i++) if (comp[i] === c) n++;
    const size = n * land.spacing * land.spacing;
    want.push({ id: `@land:${q.id}`, kind: size > 0.006 * mapArea ? "bigLake" : "lake", text: named(q, "lake", { size }), q, shut: true });
  }
  for (const k of ["forest", "desert", "marsh"]) for (const q of kindsOf(k).slice(0, 6)) want.push({ id: `@land:${q.id}`, kind: k, text: named(q, k), q });
  for (const q of kindsOf("island").slice(0, 10)) want.push({ id: `@land:${q.id}`, kind: "island", text: named(q, "island"), q });
  for (const q of kindsOf("cape").slice(0, 6)) want.push({ id: `@land:${q.id}`, kind: "cape", text: named(q, "cape"), q });

  // (open water: the water node farthest from its shore, in the map, among the water joined to the feature's point;
  // a sea's or a lake's name goes there, clear of the land)
  const dist = (isShore) => {
    const d = new Float64Array(land.n).fill(Infinity), heap = new Heap(4096);
    for (let i = 0; i < land.n; i++) if (isShore(i)) { d[i] = 0; heap.push(0, i); }
    while (heap.size) { const i = heap.pop(); if (heap.lastKey > d[i]) continue; for (let k = land.indptr[i]; k < land.indptr[i + 1]; k++) { const j = land.indices[k], c = d[i] + Math.sqrt((land.x[i] - land.x[j]) ** 2 + (land.y[i] - land.y[j]) ** 2); if (c < d[j]) { d[j] = c; heap.push(c, j); } } }
    return d;
  };
  let dSea = null, dLake = null;
  const openWater = (q, lakeWater) => {
    const isW0 = lakeWater ? (i) => land.lake[i] === 1 && (q.lake === undefined || land.lakeId[i] === q.lake) : (i) => !land.landMask[i];
    // (the water in the map only: two seas the map shows apart may join beyond its edge)
    const isW = (i) => { if (!isW0(i)) return false; const [u, v] = U(land.x[i], land.y[i]); return inside(u, v); };
    const d = lakeWater ? (dLake ??= dist((i) => land.lake[i] !== 1)) : (dSea ??= dist((i) => land.landMask[i] === 1));
    const pad = 0.04 * side;
    // (from the feature's point, or for a lake from any of its water in the map: its middle may lie past the edge)
    let start = nearest(q.x, q.y);
    if (start < 0 || !isW(start)) { start = -1; if (lakeWater) for (let i = 0; i < land.n; i++) if (isW(i)) { start = i; break; } }
    if (start < 0) return [];
    // (how open: its distance to the shore, or to the map's edge or the dressing where that's nearer, so a sea's name
    // doesn't run off to a corner of open ocean)
    const seen = new Uint8Array(land.n), st = [start], pool = []; seen[start] = 1;
    while (st.length) {
      const i = st.pop();
      const [u, v] = U(land.x[i], land.y[i]);
      // (the key, compass and cartouche count as shore too, so a sea's name keeps clear of them)
      const toHard = hard.reduce((m, b) => Math.min(m, Math.hypot(Math.max(b[0] - u, 0, u - b[2]), Math.max(b[1] - v, 0, v - b[3]))), Infinity);
      if (inside(u, v, pad)) pool.push([i, Math.min(d[i], Math.min(u, v, MW - u, MH - v) * mpu, toHard * mpu)]);
      for (let k = land.indptr[i]; k < land.indptr[i + 1]; k++) { const j = land.indices[k]; if (!seen[j] && isW(j)) { seen[j] = 1; st.push(j); } }
    }
    pool.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    // (the most open spots, a few, apart from each other)
    const out = [];
    for (const [i] of pool) { const p = U(land.x[i], land.y[i]); if (out.every((o) => (o[0] - p[0]) ** 2 + (o[1] - p[1]) ** 2 > (0.06 * side) ** 2)) out.push(p); if (out.length >= 6) break; }
    return out;
  };

  // ---- where each label goes ----
  const boxes = [];
  // (the dressing: covering it counts many times over covering another label, so a label goes there only when every
  // other spot is worse still)
  const hard = (keepOut ?? []).filter((b) => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite));
  // (each place's mark, so no label covers one: covering a mark counts a few times over covering another label)
  const marks = places.filter(shown).map((p) => { const r = em(MARK_PX[p.class] ?? 4.4); return [p.x - r, p.y - r, p.x + r, p.y + r]; });
  const boxOf = (at, angle, w, h) => {
    const a = (angle * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    const hw = (w * c + h * s) / 2, hh = (w * s + h * c) / 2;
    return [at[0] - hw, at[1] - hh, at[0] + hw, at[1] + hh];
  };
  // (how much of a box other labels and marks already cover: the spot covering least wins when none is clear)
  const overlap = (b, o) => Math.max(0, Math.min(b[2], o[2]) - Math.max(b[0], o[0])) * Math.max(0, Math.min(b[3], o[3]) - Math.max(b[1], o[1]));
  const cover = (b) => { let a = 0; for (const o of boxes) a += overlap(b, o); for (const o of marks) a += 4 * overlap(b, o); for (const o of hard) a += 8 * overlap(b, o); return a; };
  // (the realms' borders as points a little apart: a river's or range's name over a border's dashes costs as much as
  // covering a mark, by the length of border under it)
  const bstep = 0.004 * side, bpts = [];
  for (const b of borders ?? []) for (let k = 1; k < b.length; k++) {
    const [ax, ay] = b[k - 1], [bx, by] = b[k], m = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / bstep));
    for (let q = 0; q < m; q++) bpts.push(ax + ((bx - ax) * (q + 0.5)) / m, ay + ((by - ay) * (q + 0.5)) / m);
  }
  const onBorders = (at, angle, w, h) => {
    if (!bpts.length) return 0;
    const a = (angle * Math.PI) / 180, c = Math.cos(a), s0 = Math.sin(a), R = (w + h) / 2;
    let n = 0;
    for (let k = 0; k < bpts.length; k += 2) {
      const dx = bpts[k] - at[0], dy = bpts[k + 1] - at[1];
      if (Math.abs(dx) > R || Math.abs(dy) > R) continue;
      if (Math.abs(dx * c + dy * s0) <= w / 2 && Math.abs(-dx * s0 + dy * c) <= h / 2) n++;
    }
    return 4 * n * bstep * h;
  };
  const least = (list, w, h, extra = () => 0) => { let best = null, bc = Infinity; for (const c of list) { const v = cover(boxOf(c.at, c.angle ?? 0, w, h)) + extra(c.at, c.angle ?? 0, w, h); if (v < bc - 1e-12) { bc = v; best = c; } if (v === 0) break; } return best; };
  // (how much of a label's box the dressing covers, as a share of it)
  const onDressing = (at, angle, w, h) => { const b = boxOf(at, angle, w, h), A = (b[2] - b[0]) * (b[3] - b[1]) || 1; let a = 0; for (const o of hard) a += overlap(b, o); return a / A; };
  const onMarks = (at, angle, w, h) => { const b = boxOf(at, angle, w, h); return marks.filter((o) => overlap(b, o) > 0.25 * (o[2] - o[0]) * (o[3] - o[1])).length; };
  const edge = 0.025 * side;
  const fit = (at, w, h, angle) => {
    // (kept inside the map, clear of the frame)
    const b = boxOf(at, angle, w, h), dx = b[0] < edge ? edge - b[0] : b[2] > MW - edge ? MW - edge - b[2] : 0, dy = b[1] < edge ? edge - b[1] : b[3] > MH - edge ? MH - edge - b[3] : 0;
    return [at[0] + dx, at[1] + dy];
  };
  const labels = [];
  // (each feature's name as made, before capitals, labeled or not: for keepNames)
  const featureNames = madeNames;
  for (const L of want.sort((a, b) => rank(a.kind) - rank(b.kind))) {
    const size = em(L.px ?? LABEL_PX[L.kind] ?? 20), caps = L.caps ? L.text.toUpperCase() : L.text;
    // (a realm's letters spread with thin spaces, its words with wider ones, as an atlas sets a country's name)
    const text = L.spaced ? caps.split(" ").map((w0) => [...w0].join("\u2009")).join("\u2002") : caps;
    const w = caps.length * size * (L.caps ? 0.66 : 0.5) * (L.spaced ? 1.4 : 1), h = size * 1.2;
    let at = null, angle = 0;
    if (L.place) {
      const p = L.place, r = em(MARK_PX[p.class] ?? 4.4), gap = size * 0.25;
      const spots = [[p.x + r + gap + w / 2, p.y], [p.x - r - gap - w / 2, p.y], [p.x, p.y - r - gap - h / 2], [p.x, p.y + r + gap + h / 2]];
      at = least(spots.map((s) => ({ at: fit(s, w, h, 0) })), w, h).at;
    } else if (L.kind === "river" || L.kind === "range") {
      // (along the parts of it in the map, the longest first)
      const stretches = L.vis.runs.filter((x) => x.r.length >= 2).slice(0, 3).flatMap((x) => straightest(x.r, w * 1.15, inside).slice(0, 6));
      stretches.sort((a, b) => a.score - b.score);
      // (a river's name beside it, on either side; a range's over its spine or just off it; the best few stretches
      // tried, and the first spot clear of other labels kept)
      const cand = [];
      for (const st of stretches.slice(0, 12)) {
        const ang = readable(st.angle), a = (ang * Math.PI) / 180, offs = L.kind === "river" ? [size * 0.8, -size * 0.8] : [0, size * 0.9, -size * 0.9, size * 1.8, -size * 1.8];
        for (const off of offs) cand.push({ at: fit([st.mid[0] + Math.sin(a) * off, st.mid[1] - Math.cos(a) * off], w, h, ang), angle: ang });
      }
      const pick = least(cand, w, h, onBorders);
      if (pick) ({ at, angle } = pick);
      else {
        // (no stretch long enough: flat, at the middle of the longest part in the map)
        const r = L.vis.runs[0]?.r;
        if (!r?.length) continue;
        at = fit(r[Math.floor(r.length / 2)], w, h, 0);
      }
    } else if (L.kind === "realm") {
      // (over its spot, or a little off it where another label is)
      const step = h * 1.2, b = L.spot;
      at = least([b, [b[0], b[1] - step], [b[0], b[1] + step], [b[0] - w * 0.25, b[1]], [b[0] + w * 0.25, b[1]]].map((s) => ({ at: fit(s, w, h, 0) })), w, h).at;
    } else {
      const open = ["sea", "ocean", "lake", "bigLake"].includes(L.kind) ? openWater(L.q, (L.kind === "lake" || L.kind === "bigLake") && !L.shut) : null;
      const step = h * 1.1;
      // (a lake or sea with none of its water in the map, clear of the frame, goes unlabeled)
      if (open && !open.length) continue;
      const spots = (open ?? [U(L.q.x, L.q.y)]).flatMap((base) => [base, [base[0], base[1] - step], [base[0], base[1] + step], [base[0] - w * 0.4, base[1]], [base[0] + w * 0.4, base[1]]]).map((s) => fit(s, w, h, 0));
      at = least(spots.map((s0) => ({ at: s0 })), w, h).at;
    }
    if (!inside(at[0], at[1])) continue;
    // (a feature's name that could only go over the compass rose, the scale bar, the cartouche or a place's mark is left
    // off: the GM can add it; a place's stays, beside its mark)
    // (a realm's name spans its land as an atlas's does, over the towns in it: only the dressing keeps it off)
    if (!L.place && (onDressing(at, angle, w, h) > 0.15 || (L.kind !== "realm" && onMarks(at, angle, w, h) > 0))) continue;
    boxes.push(boxOf(at, angle, w, h));
    const water = WATER.has(L.kind);
    labels.push({
      id: L.id, of: null, text, at: [Math.round(at[0] * 1000) / 1000, Math.round(at[1] * 1000) / 1000], angle, size: "normal", em: Math.round(size * 1000) / 1000, show: "gm",
      color: L.place ? placeColor : water ? COLOR.water : COLOR.land, font: L.place ? placeFont : water ? FONT.water : FONT.land, alpha: 1, gen: true,
    });
  }
  return { labels, placeNames, featureNames };
}

// (name sets as read, by their text: a few kept)
const SETS = new Map();
function setOf(text) {
  if (!SETS.has(text)) { if (SETS.size > 8) SETS.delete(SETS.keys().next().value); SETS.set(text, parseNameSet(text).set); }
  return SETS.get(text);
}

/** A river's main stem as a line in map units, from the land's rivers. */
function riverLine(land, q, U) {
  const R = (land.rivers ?? []).find((r) => r.id === q.river);
  return R ? R.points.map((p) => U(p[0], p[1])) : [];
}

/**
 * The straightest stretches of a line `len` long, inside the map, the best first (straight, and near the line's
 * middle): [{ mid, angle (degrees) }]; the whole line's chord when it's shorter; none for a line with no length.
 */
function straightest(line, len, inside) {
  const cum = [0];
  for (let k = 1; k < line.length; k++) cum.push(cum[k - 1] + Math.sqrt((line[k][0] - line[k - 1][0]) ** 2 + (line[k][1] - line[k - 1][1]) ** 2));
  const total = cum[cum.length - 1];
  if (!(total > 0)) return [];
  const at = (s) => { let k = 1; while (k < cum.length - 1 && cum[k] < s) k++; const t = (s - cum[k - 1]) / Math.max(1e-12, cum[k] - cum[k - 1]); return [line[k - 1][0] + (line[k][0] - line[k - 1][0]) * t, line[k - 1][1] + (line[k][1] - line[k - 1][1]) * t]; };
  const chord = (s0, s1) => { const a = at(s0), b = at(s1); return { mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], angle: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI, a, b }; };
  if (total <= len) { const c = chord(0, total); return inside(c.mid[0], c.mid[1], 0.2) ? [{ ...c, score: 1 }] : []; }
  const all = [];
  const n = Math.max(4, Math.min(60, Math.ceil((total - len) / (len * 0.1))));
  for (let k = 0; k <= n; k++) {
    const s0 = ((total - len) * k) / n, s1 = s0 + len, c = chord(s0, s1);
    // (how far the river strays from the chord along the stretch; all of it inside the map)
    let dev = 0, out = false;
    for (let q = 0; q <= 8; q++) {
      const p = at(s0 + (len * q) / 8);
      if (!inside(p[0], p[1], 0.2)) { out = true; break; }
      const dx = c.b[0] - c.a[0], dy = c.b[1] - c.a[1], L2 = dx * dx + dy * dy || 1e-12;
      const t = ((p[0] - c.a[0]) * dx + (p[1] - c.a[1]) * dy) / L2;
      dev = Math.max(dev, Math.sqrt((p[0] - c.a[0] - t * dx) ** 2 + (p[1] - c.a[1] - t * dy) ** 2));
    }
    if (out) continue;
    const score = dev / len + 0.35 * Math.abs((s0 + len / 2) / total - 0.5);
    all.push({ ...c, score });
  }
  return all.sort((a, b) => a.score - b.score);
}
