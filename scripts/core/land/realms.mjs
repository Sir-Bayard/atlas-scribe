/**
 * Realms on an overland map: kingdoms grown from capitals over the land by what it costs to travel and to hold it, so
 * their borders fall along ranges, big rivers and coasts. A realm is kept in the plan as a point feature (its crown,
 * on its capital) with a name and a color; its land is grown again from the crowns at every layout, so moving a crown
 * redraws the borders and nothing else is stored. Pure.
 */
import { Heap } from "./heap.mjs";
import { rng } from "../rng.mjs";
import { namer } from "./names.mjs";
import { parseNameSet } from "./namesets.mjs";
import { spacingsOf } from "./settle.mjs";
import { BIOMES } from "./biome.mjs";
import { normalize } from "../plan.mjs";
import { madeMark, untouched } from "./places.mjs";

/** How many realms Quick Start asks for. */
export const REALM_COUNTS = ["none", "few", "some", "many"];
/** A realm's spacing (miles between capitals) as a share of the cities', by how many. */
const SPREAD = { few: 3.1, some: 2.2, many: 1.55 };
/** Colors for realms: muted, told apart on the painted land, the first ones the most apart. */
export const REALM_COLORS = ["#b8433a", "#3a6fb0", "#c99a2e", "#6b4a9b", "#3f8f5a", "#c26a2b", "#2f8c8c", "#a3477e", "#7d7a2a", "#5a5f73", "#9b5a3a", "#4a7f9b"];
/** The land a realm can't reach for less than this many of its spacings (in miles' worth of travel) is left to no one (the wilds). */
const REACH = 2.2;
/** A big river's toll each way, onto it and off it, as a share of the realm spacing per log of its size. */
const RIVER_TOLL = 0.03;
const BIOME_COST = { glacier: 6, tundra: 0.6, "hot-desert": 0.9, wetland: 1.2, "salt-flat": 0.8, "temperate-rainforest": 0.3, rainforest: 0.5 };

/** A finder of the nearest node to a point in map units (squares), over the land's nodes. */
function nearestOf(land) {
  const { n, x, y, frame: f } = land;
  const cell = Math.max(land.spacing * 2, 1e-6), gw = Math.ceil(f.W / cell) + 1, gh = Math.ceil(f.H / cell) + 1;
  const start = new Int32Array(gw * gh + 1), at = new Int32Array(n);
  const ci = (i) => Math.min(gh - 1, Math.max(0, Math.floor(y[i] / cell))) * gw + Math.min(gw - 1, Math.max(0, Math.floor(x[i] / cell)));
  for (let i = 0; i < n; i++) start[ci(i) + 1]++;
  for (let k = 0; k < gw * gh; k++) start[k + 1] += start[k];
  const fill = start.slice(0, gw * gh);
  for (let i = 0; i < n; i++) at[fill[ci(i)]++] = i;
  return (u, v, test = () => true) => {
    const px = u * f.mpu + f.margin, py = v * f.mpu + f.margin, cx = Math.floor(px / cell), cy = Math.floor(py / cell);
    let best = -1, bd = Infinity;
    for (let r = 0; r < Math.max(gw, gh); r++) {
      for (let yy = cy - r; yy <= cy + r; yy++) for (let xx = cx - r; xx <= cx + r; xx++) {
        if (xx < 0 || yy < 0 || xx >= gw || yy >= gh || (Math.abs(yy - cy) < r && Math.abs(xx - cx) < r)) continue;
        const k = yy * gw + xx;
        for (let q = start[k]; q < start[k + 1]; q++) { const i = at[q]; if (!test(i)) continue; const d = (x[i] - px) ** 2 + (y[i] - py) ** 2; if (d < bd || (d === bd && i < best)) { bd = d; best = i; } }
      }
      // (a ring past the best found can hold nothing nearer)
      if (best >= 0 && (r * cell) ** 2 > bd) break;
    }
    return best;
  };
}

/** How far (in miles' worth of travel) a realm reaches from its crown, by how many realms the map has. */
export const realmReach = (land, count = "some") => realmSpacing(land, count) * REACH;

/** A realm's spacing in miles on this land, by how many realms. */
export function realmSpacing(land, count = "some") {
  return spacingsOf(Math.max(land.frame.mapW, land.frame.mapH)).city * (SPREAD[count] ?? SPREAD.some);
}

/**
 * Each land node's realm, grown from the crowns by least cost: travel (grade, ranges, rough ground), crossing a big
 * river (dear, so borders follow rivers), and the sea or a lake (dearer still, so a near island joins and a far one
 * stays apart). crowns: [{ at: [u, v] }] in map units. Returns { owner: Int16Array (a realm's index, -1 at sea or in
 * a lake, -2 land no realm reaches), cost: Float64Array (miles' worth from its crown) }.
 */
export function growRealms(land, crowns, { reach = Infinity, spacing = Number.isFinite(reach) ? reach / REACH : land.spacing * 20 } = {}) {
  const { n, x, y, indptr, indices, h, landMask, lake, F, threshold: T } = land;
  const owner = new Int16Array(n).fill(-1), cost = new Float64Array(n).fill(Infinity);
  const wet = (i) => !landMask[i] || lake[i] === 1;
  const toll = spacing * RIVER_TOLL;
  const nearest = nearestOf(land);
  const riverF = new Float64Array(n), riverId = new Int32Array(n).fill(-1);
  for (const R of land.rivers ?? []) for (const i of R.nodes ?? []) if (F[i] > riverF[i]) { riverF[i] = F[i]; riverId[i] = R.id; }
  const heap = new Heap(4096);
  const by = new Int16Array(n).fill(-1);
  const seats = crowns.map(() => -1);
  crowns.forEach((c, k) => {
    const i = nearest(c.at[0], c.at[1], (j) => !wet(j));
    if (i < 0) return;
    seats[k] = i;
    if (cost[i] > 0) { cost[i] = 0; by[i] = k; heap.push(0, i); }
  });
  while (heap.size) {
    const i = heap.pop(), gi = cost[i];
    if (heap.lastKey > gi + 1e-12) continue;
    if (gi > reach) continue;
    for (let q = indptr[i]; q < indptr[i + 1]; q++) {
      const j = indices[q];
      const d = Math.sqrt((x[i] - x[j]) ** 2 + (y[i] - y[j]) ** 2);
      let c;
      if (wet(j)) c = d * (landMask[j] ? 4 : 7);
      else {
        const grade = ((h[j] - h[i]) * 3.1) / Math.max(1e-9, d);
        c = d * (1 + 20 * grade * grade + (h[j] > 0.5 ? 2.5 : h[j] > 0.35 ? 0.8 : 0) + (BIOME_COST[BIOMES[land.biome?.[j]]] ?? 0));
      }
      // (across a big river, the dearer the bigger it is, so a river is a border more often than not: half on the way
      // onto it and half on the way off, so a realm that reaches a river can't run along it and off onto the far bank
      // for one toll)
      if (riverF[j] > 0 && riverId[j] !== riverId[i]) c += toll * Math.log(riverF[j] / T + 1);
      if (riverF[i] > 0 && riverId[i] !== riverId[j] && !wet(j)) c += toll * Math.log(riverF[i] / T + 1);
      const gj = gi + c;
      if (gj < cost[j] - 1e-12 || (Math.abs(gj - cost[j]) <= 1e-12 && by[i] < by[j])) { cost[j] = gj; by[j] = by[i]; heap.push(gj, j); }
    }
  }
  for (let i = 0; i < n; i++) owner[i] = wet(i) ? -1 : by[i] >= 0 && cost[i] <= reach ? by[i] : -2;
  // (a piece of a realm cut off from its crown on its own landmass, a sliver past another realm, goes to the realm
  // around it most)
  tidy(land, owner, seats);
  return { owner, cost };
}

/**
 * Pieces of a realm cut off from the piece its crown is in, on land another realm touches, given to the realm that
 * touches them most; a piece nothing else touches on land (an island, land reached across a bay) stays. seats: each
 * realm's crown node (-1: none; its biggest piece then stands for it).
 */
export function tidy(land, owner, seats = []) {
  const { n, indptr, indices } = land;
  const comp = new Int32Array(n).fill(-1), sizes = [], ownerOf = [];
  let c = 0;
  for (let s = 0; s < n; s++) {
    if (owner[s] < 0 || comp[s] >= 0) continue;
    const stack = [s]; comp[s] = c; let size = 0;
    while (stack.length) { const i = stack.pop(); size++; for (let q = indptr[i]; q < indptr[i + 1]; q++) { const j = indices[q]; if (comp[j] < 0 && owner[j] === owner[s]) { comp[j] = c; stack.push(j); } } }
    sizes.push(size); ownerOf.push(owner[s]); c++;
  }
  // (each realm's main piece: the one its crown is in, else its biggest)
  const main = new Map();
  for (let k = 0; k < c; k++) if (!main.has(ownerOf[k]) || sizes[k] > sizes[main.get(ownerOf[k])]) main.set(ownerOf[k], k);
  seats.forEach((i, k) => { if (i >= 0 && owner[i] === k) main.set(k, comp[i]); });
  for (let k = 0; k < c; k++) {
    if (main.get(ownerOf[k]) === k) continue;
    const touch = new Map();
    for (let i = 0; i < n; i++) if (comp[i] === k) for (let q = indptr[i]; q < indptr[i + 1]; q++) { const j = indices[q]; if (owner[j] >= 0 && owner[j] !== ownerOf[k]) touch.set(owner[j], (touch.get(owner[j]) ?? 0) + 1); }
    if (!touch.size) continue;
    const to = [...touch].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    for (let i = 0; i < n; i++) if (comp[i] === k) owner[i] = to;
  }
}

/** Which realms touch on land: a Set of "a,b" (a < b) pairs. */
export function neighborsOf(land, owner) {
  const out = new Set();
  for (let i = 0; i < land.n; i++) {
    if (owner[i] < 0) continue;
    for (let q = land.indptr[i]; q < land.indptr[i + 1]; q++) { const j = land.indices[q]; if (owner[j] >= 0 && owner[j] !== owner[i]) out.add(owner[i] < owner[j] ? `${owner[i]},${owner[j]}` : `${owner[j]},${owner[i]}`); }
  }
  return out;
}

/**
 * The realms over the map as a grid of cells (about half a node spacing, in map units): ids (a realm's index, -1 sea
 * or lake, -2 unclaimed land), with each realm's share of the map's land, the cell for its name (the one farthest
 * from its edges) and its borders as lines between realms or a realm and the wilds. Returns { w, h, cell, ids,
 * realms: [{ cells, spot: [u, v], room (units from the spot to its nearest edge) }], borders: [[[u, v], ...]] }.
 */
export function realmGrid(land, owner, count) {
  const f = land.frame, MW = f.mapW / f.mpu, MH = f.mapH / f.mpu;
  const cell = Math.max(MW, MH) / Math.min(420, Math.max(120, Math.round(Math.max(f.mapW, f.mapH) / (land.spacing * 0.6))));
  const w = Math.ceil(MW / cell), h = Math.ceil(MH / cell), ids = new Int16Array(w * h);
  const nearest = nearestOf(land);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) { const i = nearest((c + 0.5) * cell, (r + 0.5) * cell); ids[r * w + c] = i < 0 ? -1 : owner[i]; }
  // each realm's share and its name's spot: the cell farthest from any other id (a two-pass distance)
  const dist = new Float32Array(w * h).fill(1e9);
  for (let k = 0; k < w * h; k++) {
    const c = k % w, r = (k - c) / w, me = ids[k];
    if (me < 0) { dist[k] = 0; continue; }
    if (c === 0 || r === 0 || c === w - 1 || r === h - 1 || ids[k - 1] !== me || ids[k + 1] !== me || ids[k - w] !== me || ids[k + w] !== me) dist[k] = 1;
  }
  for (let pass = 0; pass < 2; pass++) {
    const fwd = pass === 0;
    for (let s = 0; s < w * h; s++) {
      const k = fwd ? s : w * h - 1 - s, c = k % w, r = (k - c) / w;
      if (ids[k] < 0) continue;
      const nb = fwd ? [[c - 1, r, 1], [c, r - 1, 1], [c - 1, r - 1, 1.414], [c + 1, r - 1, 1.414]] : [[c + 1, r, 1], [c, r + 1, 1], [c + 1, r + 1, 1.414], [c - 1, r + 1, 1.414]];
      for (const [cc, rr, dd] of nb) { if (cc < 0 || rr < 0 || cc >= w || rr >= h) continue; const v = dist[rr * w + cc] + dd; if (v < dist[k]) dist[k] = v; }
    }
  }
  const realms = Array.from({ length: count }, () => ({ cells: 0, spot: null, room: 0 }));
  for (let k = 0; k < w * h; k++) {
    const me = ids[k];
    if (me < 0) continue;
    const R = realms[me];
    if (!R) continue;
    R.cells++;
    if (dist[k] > R.room) { R.room = dist[k]; R.spot = [((k % w) + 0.5) * cell, (Math.floor(k / w) + 0.5) * cell]; }
  }
  for (const R of realms) R.room *= cell;
  // borders: the cell edges between two different land ids, chained into lines and smoothed
  const segs = [];
  const landId = (k) => ids[k] !== -1;
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const k = r * w + c;
    if (!landId(k)) continue;
    if (c + 1 < w && landId(k + 1) && ids[k + 1] !== ids[k]) segs.push([[c + 1, r], [c + 1, r + 1]]);
    if (r + 1 < h && landId(k + w) && ids[k + w] !== ids[k]) segs.push([[c, r + 1], [c + 1, r + 1]]);
  }
  // (the cells' stair steps taken out first, a line within a cell of them, then its corners rounded)
  const borders = chainSegments(segs).map((line) => smooth(simplify(line, 1.1).map(([c, r]) => [c * cell, r * cell]), 3));
  return { w, h, cell, ids, realms, borders };
}

/** Grid segments joined end to end into lines (a junction of three realms ends them). */
function chainSegments(segs) {
  const key = (p) => `${p[0]},${p[1]}`;
  const at = new Map();
  segs.forEach((s, i) => { for (const p of s) { const k = key(p); if (!at.has(k)) at.set(k, []); at.get(k).push(i); } });
  const used = new Uint8Array(segs.length), out = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line = [...segs[i]];
    for (const end of [1, 0]) {
      for (;;) {
        const tip = end ? line[line.length - 1] : line[0], list = at.get(key(tip)) ?? [];
        if (list.length !== 2) break;
        const j = list.find((q) => !used[q]);
        if (j === undefined) break;
        used[j] = 1;
        const s = segs[j], far = key(s[0]) === key(tip) ? s[1] : s[0];
        if (end) line.push(far); else line.unshift(far);
      }
    }
    out.push(line);
  }
  return out;
}

/** Douglas-Peucker: a line kept within tol of the original, its ends (and a closed line's first point) kept. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    let far = -1, fd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = L < 1e-9 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay) : Math.abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / L;
      if (d > fd) { fd = d; far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Chaikin's corner cutting, n times, ends kept (a closed line kept closed). */
function smooth(pts, times) {
  let p = pts;
  const closed = p.length > 3 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1];
  for (let t = 0; t < times; t++) {
    const q = closed ? [] : [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, ay] = p[i], [bx, by] = p[i + 1];
      q.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    if (closed) q.push(q[0]); else q.push(p[p.length - 1]);
    p = q;
  }
  return p.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
}

/**
 * Realms for an overland plan, in place of the generator's own the GM hasn't changed: capitals from its cities (towns
 * when cities are few), spread across its land; each named from the map's style or name set by its size, and colored
 * so neighbors differ. land: the layout's compact land; count: few, some or many. Returns { plan (with its realms),
 * added, removed, notes }.
 */
export function placeRealms(plan, land, { count = "some", seed = plan?.seed ?? 1 } = {}) {
  const all = plan.features ?? [];
  const keep = all.filter((f) => f.type !== "realm" || !untouched(f));
  const gone = all.filter((f) => f.type === "realm" && untouched(f)).map((f) => f.id);
  const notes = [];
  if (!REALM_COUNTS.includes(count) || count === "none") return { plan: { ...structuredClone(plan), features: structuredClone(keep) }, added: 0, removed: gone.length, notes };
  const f = land.frame, MW = f.mapW / f.mpu, MH = f.mapH / f.mpu;
  const r = rng(seed, "realms");
  const S = realmSpacing(land, count) / f.mpu; // (in map units)
  const kept = keep.filter((q) => q.type === "realm" && Array.isArray(q.at));
  // candidates: the cities on the map, then its towns, the ones with most roads first, the seed choosing among
  // the cities (so Reroll Realms moves the capitals, not only the names)
  const places = keep.filter((q) => q.type === "place" && Array.isArray(q.at) && q.at[0] >= 0 && q.at[1] >= 0 && q.at[0] <= MW && q.at[1] <= MH);
  const roads = keep.filter((q) => q.type === "road" && Array.isArray(q.path));
  const roadsAt = (p) => roads.filter((rd) => [rd.path[0], rd.path[rd.path.length - 1]].some((e) => Math.abs(e[0] - p.at[0]) < 0.05 && Math.abs(e[1] - p.at[1]) < 0.05)).length;
  const rank = { city: 2, town: 1 };
  const cand = places.filter((p) => rank[p.class]).map((p) => ({ p, w: rank[p.class] * 10 + roadsAt(p) + r.next() * 8 })).sort((a, b) => b.w - a.w || (a.p.id < b.p.id ? -1 : 1));
  // how many: the map's land over a realm's share of it
  let landCells = 0;
  for (let i = 0; i < land.n; i++) if (land.landMask[i] && !land.lake[i]) { const u = (land.x[i] - f.margin) / f.mpu, v = (land.y[i] - f.margin) / f.mpu; if (u >= 0 && v >= 0 && u <= MW && v <= MH) landCells++; }
  let total = 0; for (let i = 0; i < land.n; i++) { const u = (land.x[i] - f.margin) / f.mpu, v = (land.y[i] - f.margin) / f.mpu; if (u >= 0 && v >= 0 && u <= MW && v <= MH) total++; }
  const landArea = (landCells / Math.max(1, total)) * MW * MH;
  const want = Math.max(2, Math.min(16, Math.round(landArea / (S * S) * 1.3))) - kept.length;
  // farthest first: each next capital the candidate best placed and farthest from those chosen, never closer than
  // half a spacing
  const chosen = kept.map((q) => q.at);
  const picks = [];
  for (let t = 0; t < want && cand.length; t++) {
    let best = null, bv = -Infinity;
    for (const c of cand) {
      if (picks.includes(c)) continue;
      const dmin = chosen.length ? Math.min(...chosen.map((a) => Math.hypot(a[0] - c.p.at[0], a[1] - c.p.at[1]))) : S;
      if (dmin < S * 0.5) continue;
      const v = Math.min(dmin, S * 1.5) * (1 + 0.04 * c.w);
      if (v > bv) { bv = v; best = c; }
    }
    if (!best) break;
    picks.push(best); chosen.push(best.p.at);
  }
  if (!picks.length && !kept.length) {
    notes.push("There were no cities or towns on the map to rule realms from, so it has none. Place towns first.");
    return { plan: { ...structuredClone(plan), features: structuredClone(keep) }, added: 0, removed: gone.length, notes };
  }
  // grow them once, for their sizes and who borders whom
  const crowns = [...kept.map((q) => ({ at: q.at })), ...picks.map((c) => ({ at: c.p.at }))];
  const { owner } = growRealms(land, crowns, { reach: realmReach(land, count) });
  const nodes = new Array(crowns.length).fill(0); let held = 0;
  for (let i = 0; i < land.n; i++) if (owner[i] >= 0) { nodes[owner[i]]++; held++; }
  const pairs = neighborsOf(land, owner);
  // colors: a kept realm keeps its own; each new one the first color no neighbor has, else the least used
  const colors = crowns.map((c, k) => (k < kept.length ? kept[k].color ?? null : null));
  for (let k = kept.length; k < crowns.length; k++) {
    const near = new Set([...pairs].map((p) => p.split(",").map(Number)).filter(([a, b]) => a === k || b === k).map(([a, b]) => colors[a === k ? b : a]).filter(Boolean));
    const used = (c) => colors.filter((x) => x === c).length;
    colors[k] = REALM_COLORS.find((c) => !near.has(c) && !colors.includes(c)) ?? REALM_COLORS.filter((c) => !near.has(c)).sort((a, b) => used(a) - used(b))[0] ?? REALM_COLORS[k % REALM_COLORS.length];
  }
  // names: by rank (its share of the realms' land), from the map's style or its name set; a new realm's id clear of
  // the plan's own
  const L = plan.land ?? {};
  const set = L.nameStyle === "custom" && typeof L.nameSet?.text === "string" ? parseNameSet(L.nameSet.text).set : null;
  const nm = set ? namer("custom", seed, { set }) : namer(L.nameStyle ?? "english", seed);
  for (const q of keep) if (typeof q.name === "string") nm.take(q.name);
  const ids = new Set([...all.map((q) => q.id), ...gone]);
  let k = 0;
  const nextId = () => { do k++; while (ids.has(`realm-${k}`)); ids.add(`realm-${k}`); return `realm-${k}`; };
  const made = [];
  picks.forEach((c, m) => {
    const idx = kept.length + m, share = held ? nodes[idx] / held : 0;
    const rankWord = share > 0.3 || (crowns.length <= 3 && share > 0.2) ? "great" : share > 0.12 ? "middle" : "small";
    const capName = typeof c.p.name === "string" && c.p.name.trim() ? c.p.name.trim() : null;
    const name = nm.feature("realm", { rank: rankWord, near: capName }, `realm:${c.p.id}`);
    if (!name) return;
    const feat = { id: nextId(), type: "realm", class: "realm", at: [...c.p.at], name, color: colors[idx], capital: c.p.id };
    made.push({ ...feat, made: madeMark(feat) });
  });
  const unreached = held && landCells ? Math.max(0, 1 - held / Math.max(1, [...owner].filter((v) => v !== -1).length)) : 0;
  if (unreached > 0.25) notes.push(`About ${Math.round(unreached * 100)}% of the land is far from any capital and belongs to no realm (the wilds).`);
  return { plan: { ...structuredClone(plan), features: [...structuredClone(keep), ...made] }, added: made.length, removed: gone.length, notes };
}

/** The realms a plan keeps, normalized, in order: [{ id, name, color, at, capital }]. */
export function realmsOf(plan) {
  return (normalize(plan).features ?? []).filter((q) => q.type === "realm" && Array.isArray(q.at)).map((q, k) => ({ id: q.id, name: q.name ?? null, color: q.color ?? REALM_COLORS[k % REALM_COLORS.length], at: q.at, capital: q.capital ?? null }));
}
