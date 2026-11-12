/**
 * Town walls and palisades: where a wall's runs stand, its gates, towers and gatehouses, its ditch or moat, and the
 * ground kept clear around it. A wall is a plan path; one whose last point is its first is a closed loop, its
 * outside outward, and an open run's outside is on its `side`. Wherever a road crosses it there's a gate (a
 * gatehouse over the road, or a tower each side of it), and where water crosses it the wall stops at a tower each
 * side. Towers stand at its corners, at the ends of an open run and about every `towerSpacing` feet between.
 * Everything in squares; every random choice comes from the wall's own stream. Pure: runs anywhere.
 */
import { pointInPolygon, distanceToPath } from "../geom.mjs";
import { offset, bands } from "../lots/poly.mjs";
import { roadWaterCrossings, snapTo } from "./crossings.mjs";
import { TOWN_WALLS } from "../plan.mjs";
import { pastEdge, bankOf } from "../water.mjs";

export const isTownWall = (f) => f?.type === "wall" && TOWN_WALLS.includes(f.class) && Array.isArray(f.path) && f.path.length >= 2;

/** Clear ground on each side of a wall's face, in feet: a strip inside, a berm outside. */
const STRIP_FT = { town: 15, palisade: 10 };
/** Between the wall's outer face and its ditch or moat, in feet. */
const BERM_FT = { town: 6, palisade: 4 };
/** A wall's thickness when the plan gives none (as plan.mjs's defaults), in feet. */
const THICK_FT = { town: 12, palisade: 4 };
/** Roof materials a town wall's roofed towers choose from (one per wall). */
const TOWER_ROOFS = ["slate", "slate-blue", "slate-black", "tile-red", "tile-brown"];
const CORNER_DEG = 25; // a turn sharper than this is a corner, with a tower
/**
 * A stone wall's works on a battle map (castle.mjs builds them), in feet: a round tower's size across and a square
 * one's side; a gatehouse's passage at least, each guard room's width, its walls' thickness and its depth across the
 * wall; and how far a tower's inside reaches past the wall's inner face at least (its door opens into the yard there).
 */
export const BATTLE_TOWER_FT = { round: 35, square: 32, passage: 15, guard: 17.5, gateWall: 4.5, gateDeep: 36, intoYard: 5 };

const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
export const isClosed = (path) => path.length >= 4 && same(path[0], path[path.length - 1]);

/**
 * A wall's sizes in squares: T its thickness, half of it, D a tower's size (across a round one, a square one's side),
 * push (how far a tower stands out from the center line), deep (a gatehouse's depth across the wall), gateOut (how far
 * its center stands out), towerOut (how far out a tower can reach, a square one turned to the wall included) and
 * ditchIn (where a ditch or moat starts: beyond the berm, the towers and the gatehouses).
 */
function geometryOf(f, sq, battle = false) {
  const ft = (v) => v / sq;
  const palisade = f.class === "palisade";
  const T = ft(f.thickness ?? THICK_FT[f.class] ?? 12), half = T / 2;
  // (on a battle map a stone wall's towers are buildings with rooms: a round one 35 ft across, a square one 32 ft)
  const D = palisade ? Math.max(3 * T, ft(14)) : battle ? Math.max(2.2 * T, ft(BATTLE_TOWER_FT.round)) : Math.max(2.2 * T, ft(24));
  const push = Math.max(0, D / 2 - half) * 0.7;
  const deep = Math.max(2 * T, ft(22)), gateOut = T * 0.25;
  const towerOut = push + (D / 2) * Math.SQRT2;
  const ditchIn = Math.max(half + ft(BERM_FT[f.class] ?? 6), towerOut + ft(3), gateOut + deep / 2 + ft(3));
  return { T, half, D, push, deep, gateOut, towerOut, ditchIn };
}

/** How far from a wall's center line its towers can reach, in squares (a road nearer than that loses towers). */
export const towerReach = (f, ftPerSquare) => geometryOf(f, ftPerSquare).towerOut;

/** How far from a wall's center line nothing is built (half its thickness and the clear strip), in squares. */
export function wallReach(f, ftPerSquare) {
  return ((f.thickness ?? THICK_FT[f.class] ?? 12) / 2 + (STRIP_FT[f.class] ?? 15)) / ftPerSquare;
}

/** How far from a wall's center line its towers, ditch or moat reach, in squares (at least its reach). */
export function wallReachOut(f, ftPerSquare) {
  const G = geometryOf(f, ftPerSquare);
  const out = !f.outside || f.outside === "none" ? G.towerOut : G.ditchIn + (f.ditchWidth ?? (f.class === "palisade" ? 12 : 20)) / ftPerSquare;
  return Math.max(wallReach(f, ftPerSquare), out);
}

/** A path's lengths along it: cum[i] is the length up to point i. */
function lengths(path) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  return cum;
}

/** The point at length s along a path, and the direction there. */
function along(path, cum, s) {
  const L = cum[cum.length - 1];
  s = Math.max(0, Math.min(L, s));
  let i = 1;
  while (i < path.length - 1 && cum[i] < s) i++;
  const a = path[i - 1], b = path[i], l = cum[i] - cum[i - 1] || 1;
  const t = (s - cum[i - 1]) / l;
  const ux = (b[0] - a[0]) / l, uy = (b[1] - a[1]) / l;
  return { at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], u: [ux, uy] };
}

/** The piece of a path from length s0 to s1 (s0 < s1, both within it). */
function piece(path, cum, s0, s1) {
  const out = [along(path, cum, s0).at];
  for (let i = 1; i < path.length - 1; i++) if (cum[i] > s0 && cum[i] < s1) out.push(path[i]);
  out.push(along(path, cum, s1).at);
  return out;
}

/** An open path pushed sideways by d (positive to its left, going along it), corners mitered up to 3 times d. */
export function offsetPath(path, d) {
  const n = path.length;
  const normal = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; };
  const out = [];
  for (let i = 0; i < n; i++) {
    const n0 = i > 0 ? normal(path[i - 1], path[i]) : null, n1 = i < n - 1 ? normal(path[i], path[i + 1]) : null;
    let nx, ny;
    if (n0 && n1) {
      const mx = n0[0] + n1[0], my = n0[1] + n1[1], ml = Math.hypot(mx, my);
      if (ml < 1e-6) { nx = n1[0]; ny = n1[1]; }
      else {
        const k = Math.min(3, 1 / Math.max(1e-6, (mx / ml) * n1[0] + (my / ml) * n1[1]));
        nx = (mx / ml) * k; ny = (my / ml) * k;
      }
    } else [nx, ny] = n0 ?? n1;
    out.push([path[i][0] + nx * d, path[i][1] + ny * d]);
  }
  return out;
}

/** +1 when a wall's outside is to the left of its path (going along it), -1 when to the right. */
function outsideSign(f, path, closed) {
  if (!closed) return f.side === "right" ? -1 : 1;
  // A closed loop: test just to the left of its longest stretch
  let best = 1, len = -1;
  for (let i = 1; i < path.length; i++) {
    const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    if (l > len) { len = l; best = i; }
  }
  const a = path[best - 1], b = path[best], l = len || 1;
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], left = [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
  const eps = Math.min(0.05, l / 4);
  return pointInPolygon([mid[0] + left[0] * eps, mid[1] + left[1] * eps], path) ? -1 : 1;
}

/** Where segment a-b crosses c-d, as a fraction along a-b, or null. */
function crossT(a, b, c, d) {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - a[0], qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, dir: [sx, sy] } : null;
}

/** Every place a line crosses the wall: [{ s (length along the wall), at, dir (the line's direction, a unit vector) }]. */
function crossings(path, cum, line) {
  const out = [];
  for (let i = 1; i < path.length; i++)
    for (let j = 1; j < (line?.length ?? 0); j++) {
      const hit = crossT(path[i - 1], path[i], line[j - 1], line[j]);
      if (!hit) continue;
      const l = Math.hypot(hit.dir[0], hit.dir[1]) || 1;
      const s = cum[i - 1] + hit.t * (cum[i] - cum[i - 1]);
      out.push({ s, at: along(path, cum, s).at, dir: [hit.dir[0] / l, hit.dir[1] / l] });
    }
  return out;
}

/**
 * Lays out one town wall or palisade. f: the plan wall (normalized, its path smoothed). roads: [{ id, path, width,
 * over }] (over: false, a way that gets gates and keeps towers off it but doesn't stop the wall where it only runs
 * over it) and waters: [{ id, path, width }] in squares (with widths where it varies, or body and its shore's reach for a lake
 * or the sea, its path then the shore); sq: feet a square; r: the wall's stream. Returns { runs: [path],
 * towers: [building spec], gates: [{ at, road }], ditches: [{ path, width, closed, moat }] (a dry ditch stops short of
 * water, a moat runs on into it), bridges: [crossing spec],
 * band: { path, half } (what's kept clear), side, closed, notes }. A tower spec is what addBuilding takes, plus `kind`,
 * `at` and `key` (where it stands, for its stream).
 */
export function layWall(f, { roads = [], waters = [], sq, r, battle = false }) {
  // Repeated points dropped (a closed loop keeps its closing point)
  const path = f.path.filter((p, i) => i === 0 || Math.hypot(p[0] - f.path[i - 1][0], p[1] - f.path[i - 1][1]) > 1e-6);
  if (path.length >= 2 && isClosed(f.path) && !same(path[0], path[path.length - 1])) path.push([...path[0]]);
  const notes = [];
  const cum = lengths(path);
  const L = cum[cum.length - 1];
  const empty = { runs: [], towers: [], gates: [], ditches: [], bridges: [], band: { path, half: wallReach(f, sq) }, side: 1, closed: false, notes };
  if (path.length < 2 || !(L > 0.2)) {
    notes.push({ level: "warning", id: f.id, message: `"${f.id}" is too short to build.` });
    return empty;
  }
  const closed = isClosed(path) && path.length >= 4;
  const ft = (v) => v / sq;
  const palisade = f.class === "palisade";
  const works = battle && !palisade; // (a stone wall's towers and gatehouses with rooms, castle.mjs)
  const G = geometryOf(f, sq, works);
  const { T, half, D, push } = G;
  const sign = outsideSign(f, path, closed);

  // The wall's look, from its stream unless the plan says: every choice drawn, so a setting never moves the others
  const lookRoll = r.next(), shapeRoll = r.next(), roofRoll = r.next();
  const look = f.towers ?? (lookRoll < 0.45 ? "roofed" : lookRoll < 0.8 ? "open" : "mixed");
  // (on a battle map, round at its corners and ends and square between, unless the plan says)
  const shape = palisade ? (f.towerShape === "round" ? "round" : f.towerShape === "mixed" ? "mixed" : "square") : f.towerShape ?? (works ? "corners" : shapeRoll < 0.5 ? "round" : shapeRoll < 0.8 ? "square" : "mixed");
  const roof = palisade ? "wood-shingle-dark" : TOWER_ROOFS[Math.floor(roofRoll * TOWER_ROOFS.length)];
  const spacing = ft(f.towerSpacing ?? (palisade ? 90 : 120));
  const height = f.height ?? (palisade ? 10 : 25);
  const R = (D / 2) * (shape === "round" ? 1 : Math.SQRT2); // how far a tower reaches from its center, at most
  const wrap = (s) => (closed ? ((s % L) + L) % L : s);

  // True when a corner of the wall lies between lengths a and b (around a closed loop, either way over its start)
  const cornerAt = [];
  for (let i = closed ? 0 : 1; i < path.length - 1; i++) {
    const prev = i === 0 ? path[path.length - 2] : path[i - 1], b = path[i], c = path[i + 1];
    const u1 = [b[0] - prev[0], b[1] - prev[1]], u2 = [c[0] - b[0], c[1] - b[1]];
    const cos = (u1[0] * u2[0] + u1[1] * u2[1]) / ((Math.hypot(...u1) * Math.hypot(...u2)) || 1);
    if (Math.acos(Math.max(-1, Math.min(1, cos))) * (180 / Math.PI) >= 5) cornerAt.push(cum[i]);
  }
  const cornerIn = (a, b) => cornerAt.some((c) => (c > a && c < b) || (closed && (c + L > a && c + L < b || c - L > a && c - L < b)));

  // Gaps, as stretches [a, b] along the wall: a gate wherever a road crosses, wide enough that a tower each side
  // and the wall's ends clear the road however slanting it crosses
  const iv = [];
  for (const rd of roads) {
    const seen = [];
    for (const x of crossings(path, cum, rd.path)) {
      // A road through a wall's point crosses both its segments there (a closed loop's start is at 0 and at its length)
      if (seen.some((s0) => Math.abs(s0 - x.s) < 1e-6 || (closed && Math.abs(Math.abs(s0 - x.s) - L) < 1e-6))) continue;
      seen.push(x.s);
      const u = along(path, cum, x.s).u;
      const sin = Math.max(0.25, Math.abs(u[0] * x.dir[1] - u[1] * x.dir[0])), cos = Math.sqrt(1 - sin * sin);
      const rh = (rd.width ?? 1) / 2;
      let h = Math.max((rh + 0.25) / sin, (rh + half * cos + 0.05) / sin, (rh + R + 0.05 + push * cos) / sin - D / 2 + 0.02);
      // Past a corner the wall can turn back toward the road: wider until both ends clear it, measured straight
      const endClear = (sg) => { const sv = x.s + sg * h; return !closed && (sv < 0 || sv > L) ? true : distanceToPath(along(path, cum, wrap(sv)).at, rd.path) >= rh + half + 0.05; };
      for (let k = 0; k < 60 && !(endClear(-1) && endClear(1)); k++) h += 0.1;
      const corner = cornerIn(x.s - h, x.s + h);
      iv.push({ a: x.s - h, b: x.s + h, water: false, roads: [{ id: rd.id, at: x.at, dir: x.dir, width: rd.width, sin, corner }] });
    }
  }
  // Wherever the wall would stand in water or on its bank (crossing a river, or running along it), it stops with a
  // tower at each end, over the wall's last stretch: the water is the defense there. A gate that would fall in it
  // goes too (the road is on a bridge)
  for (const [a, b] of wetStretches(path, cum, closed, (q) => inWater(q, waters, half + 0.05))) iv.push({ a: a - 0.1, b: b + 0.1, water: true, roads: [] });
  // Where a road passes over the wall without crossing its line (a wide road by a corner, or one running along it),
  // the wall stops at a tower each side, as at water: nothing is built on the road. Stretches a gate already opens
  // don't count, nor a road that only ends at the wall (a dead-end street against it)
  const gated = iv.filter((g) => !g.water).map((g) => [g.a, g.b]);
  const inGate = (s) => gated.some(([a, b]) => (s >= a && s <= b) || (closed && ((s + L >= a && s + L <= b) || (s - L >= a && s - L <= b))));
  const onRoad = (q) => roads.some((rd) => rd.over !== false && Array.isArray(rd.path) && rd.path.length >= 2 && passesOver(q, rd.path, (rd.width ?? 1) / 2 + half + 0.05));
  for (const [a, b] of wetStretches(path, cum, closed, (q) => onRoad(q))) {
    // Only what lies outside every gate: sampled, as the wet stretches are
    const n = Math.max(2, Math.ceil((b - a) / 0.2));
    let from = null;
    for (let k = 0; k <= n; k++) {
      const s = a + ((b - a) * k) / n, out = !inGate(wrap(s)) && onRoad(along(path, cum, wrap(s)).at);
      if (out && from === null) from = s;
      if ((!out || k === n) && from !== null) { iv.push({ a: from - 0.1, b: (out ? s : s - (b - a) / n) + 0.1, water: true, roads: [] }); from = null; }
    }
  }
  // Gaps that overlap, or leave no room for two towers between, are one gap; on an open run, a gap so near an end
  // that only a stub of wall would be left reaches the end
  const room = D + 2 * R + 0.1;
  if (!closed) for (const g of iv) { if (g.a < room / 2) g.a = Math.min(g.a, -0.01); if (g.b > L - room / 2) g.b = Math.max(g.b, L + 0.01); }
  iv.sort((x, y) => x.a - y.a);
  const merged = [];
  for (const g of iv) {
    const last = merged[merged.length - 1];
    if (last && g.a < last.b + room) { last.b = Math.max(last.b, g.b); last.water ||= g.water; last.roads.push(...g.roads); }
    else merged.push({ ...g, roads: [...g.roads] });
  }
  if (closed && merged.length > 1) {
    const first = merged[0], last = merged[merged.length - 1];
    if (first.a + L < last.b + room) { last.b = Math.max(last.b, first.b + L); last.water ||= first.water; last.roads.push(...first.roads); merged.shift(); }
  }
  if (closed && merged.some((g) => g.b - g.a >= L - room)) {
    notes.push({ level: "warning", id: f.id, message: `"${f.id}" is all gates or water, so no wall is built.` });
    return { ...empty, closed, side: sign };
  }
  const gaps = merged.map((g) => {
    const s = (g.a + g.b) / 2, p = along(path, cum, wrap(s));
    return { s: wrap(s), half: (g.b - g.a) / 2, at: p.at, u: p.u, water: g.water, roads: g.roads };
  });

  // The wall's runs: the path less its gaps. Around a closed loop lengths wrap: a gap can reach past the start, and
  // the runs are taken from the end of one gap to the start of the next
  const runs = [];
  const span = (s0, s1) => {
    if (s1 - s0 <= 0.2) return;
    if (!closed) { runs.push(piece(path, cum, Math.max(0, s0), Math.min(L, s1))); return; }
    const a = wrap(s0), b = a + (s1 - s0);
    runs.push(b <= L ? piece(path, cum, a, b) : [...piece(path, cum, a, L).slice(0, -1), ...piece(path, cum, 0, b - L)]);
  };
  if (!gaps.length) runs.push(path.slice());
  else if (!closed) {
    let at = 0;
    for (const g of gaps) { span(at, g.s - g.half); at = Math.max(at, g.s + g.half); }
    span(at, L);
  } else {
    // In order around the loop from the first gap's end
    const order = gaps.slice().sort((x, y) => x.s - y.s);
    for (let k = 0; k < order.length; k++) {
      const g = order[k], next = order[(k + 1) % order.length];
      span(g.s + g.half, next.s - next.half + (k + 1 < order.length ? 0 : L));
    }
  }

  // Towers. Each one's look and shape come from its own fork, keyed by where it stands, and gate towers come first;
  // one that would stand over another, in a road or in water is left out
  const towers = [];
  const taken = []; // [x, y, reach] of each tower and gatehouse placed
  const outward = (u, k = 1) => [sign * u[1] * k, -sign * u[0] * k];
  const keyOf = (at) => `${Math.round(at[0] * 2)}:${Math.round(at[1] * 2)}`;
  const clearOf = (c, reach, gate) => {
    if (taken.some(([x, y, rr]) => Math.hypot(x - c[0], y - c[1]) < 0.9 * (rr + reach))) return false;
    if (roads.some((rd) => Array.isArray(rd.path) && distanceToPath(c, rd.path) < (rd.width ?? 1) / 2 + reach + 0.02)) return false;
    // A gate's towers stand over the wall's ends beside water, so only towers along the wall are kept off its bank
    return gate || !waters.some((w) => Array.isArray(w.path) && (w.body || w.widths ? pastEdge(c, w) < bankOf(w) + reach : distanceToPath(c, w.path) < (w.width ?? 1) / 2 + 0.475 + reach));
  };
  const addTower = (at, u, kind, bisector = null) => {
    const tr = r.fork("tower", keyOf(at));
    const lk = look === "mixed" ? (tr.next() < 0.5 ? "roofed" : "open") : look;
    const sh = shape === "mixed" ? (tr.next() < 0.5 ? "round" : "square") : shape === "corners" ? (kind === "corner" || kind === "end" ? "round" : "square") : shape;
    const n = bisector ?? outward(u);
    // (a works tower: its size by its shape, and set in so its inside reaches past the wall's inner face into the yard)
    const size = works && sh === "square" ? ft(BATTLE_TOWER_FT.square) : D;
    // (its inside: in from its outside by its wall, 5 ft; reaching the inner face, past a corner's, and on into the yard)
    const inYard = half * (bisector ? Math.SQRT2 : 1) + ft(BATTLE_TOWER_FT.intoYard) + ft(5);
    const out = works ? Math.max(0, Math.min(push, size / 2 - inYard)) : push;
    const c = [at[0] + n[0] * out, at[1] + n[1] * out]; // a tower stands out from the wall's outer face
    const reach = (size / 2) * (sh === "round" ? 1 : Math.SQRT2);
    if (!clearOf(c, reach, kind === "gate")) return false;
    taken.push([c[0], c[1], reach]);
    const rot = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
    const spec = sh === "round"
      ? { shape: { circle: [c[0], c[1], size / 2] }, roofStyle: lk === "open" ? "flat" : "cone" }
      : { shape: { rect: [c[0] - size / 2, c[1] - size / 2, c[0] + size / 2, c[1] + size / 2] }, rot, roofStyle: lk === "open" ? "flat" : "pyramid" };
    towers.push({
      ...spec, roof, height: height + (palisade ? 6 : 10), chimney: false, tower: true, crenels: lk === "open" && !palisade,
      ...(palisade ? { flatRoof: "wood" } : {}), kind, at, key: keyOf(at), ...(works ? { works: kind } : {}),
    });
    return true;
  };

  const GATE_SQUARE = 0.9;
  // Gatehouses: a block on the wall over one road crossing it squarely enough, else a tower each side; an opening
  // for water, or for several roads together, gets a tower each side
  const gates = [];
  for (const g of gaps) {
    const gr = r.fork("gate", keyOf(g.at));
    const blockRoll = gr.next(), lookRoll2 = gr.next();
    // (on a battle map, a gatehouse wherever one can stand: Patrick's full gatehouse)
    // (a battle map's, whose passage lies square to the wall, only over a road crossing it all but squarely, within
    // about 25 degrees, so the road runs down its passage, not through its guard rooms: else a tower each side)
    const block = !g.water && g.roads.length === 1 && !palisade && g.roads[0].sin >= (works ? GATE_SQUARE : 0.6) && !g.roads[0].corner && (works || blockRoll < 0.5);
    if (block) {
      const n = outward(g.u);
      // (a works gatehouse: its passage the road's width or more, a guard room each side, its walls)
      const passage = works ? Math.max((g.roads[0].width ?? 1) + 0.4, ft(BATTLE_TOWER_FT.passage)) : 0;
      const len = works ? Math.max(2 * g.half + 2 * ft(4), passage + 2 * ft(BATTLE_TOWER_FT.guard) + 4 * ft(BATTLE_TOWER_FT.gateWall)) : 2 * g.half + 2 * ft(4);
      const deep = works ? Math.max(G.deep, ft(BATTLE_TOWER_FT.gateDeep)) : G.deep;
      const c = [g.at[0] + n[0] * G.gateOut, g.at[1] + n[1] * G.gateOut];
      const rot = (Math.atan2(g.u[1], g.u[0]) * 180) / Math.PI;
      const lk = look === "mixed" ? (lookRoll2 < 0.5 ? "roofed" : "open") : look;
      towers.push({
        shape: { rect: [c[0] - len / 2, c[1] - deep / 2, c[0] + len / 2, c[1] + deep / 2] }, rot,
        roofStyle: lk === "open" ? "flat" : "hip", roof, height: height + 8, chimney: false, tower: true, crenels: lk === "open", kind: "gatehouse", at: g.at, key: keyOf(g.at),
        ...(works ? { works: "gatehouse", passage } : {}),
      });
      taken.push([c[0], c[1], Math.hypot(len, deep) / 2]);
    } else {
      for (const side of [-1, 1]) {
        const s = g.s + side * (g.half + D / 2 - 0.02); // over the run's end, clear of the road or water
        if (!closed && (s < 0 || s > L)) continue;
        const p = along(path, cum, wrap(s));
        addTower(p.at, p.u, "gate");
      }
    }
    for (const rd of g.roads) if (!g.water || !inWater(rd.at, waters, 0.05)) gates.push({ at: rd.at, road: rd.id, block }); // a road on a bridge has none
  }
  // Corners, open ends and towers between
  const nearGap = (s, m) => gaps.some((g) => {
    const d = closed ? Math.min(Math.abs(g.s - s), L - Math.abs(g.s - s)) : Math.abs(g.s - s);
    return d < g.half + m;
  });
  const anchors = []; // lengths along the wall with a tower: corners, ends, and both sides of each gap
  for (let i = closed ? 0 : 1; i < path.length - 1; i++) {
    const prev = i === 0 ? path[path.length - 2] : path[i - 1], b = path[i], c = path[i + 1];
    const u1 = [b[0] - prev[0], b[1] - prev[1]], u2 = [c[0] - b[0], c[1] - b[1]];
    const l1 = Math.hypot(...u1), l2 = Math.hypot(...u2);
    if (!l1 || !l2) continue;
    const cos = (u1[0] * u2[0] + u1[1] * u2[1]) / (l1 * l2);
    if (Math.acos(Math.max(-1, Math.min(1, cos))) * (180 / Math.PI) < CORNER_DEG) continue;
    if (nearGap(cum[i], D / 2)) continue;
    // The corner's outward bisector
    const n1 = outward([u1[0] / l1, u1[1] / l1]), n2 = outward([u2[0] / l2, u2[1] / l2]);
    const bx = n1[0] + n2[0], by = n1[1] + n2[1], bl = Math.hypot(bx, by) || 1;
    if (addTower(b, [u2[0] / l2, u2[1] / l2], "corner", [bx / bl, by / bl])) anchors.push(cum[i]);
  }
  if (!closed) {
    // Its ends count for the spacing even when their own tower is left out (on a bank, say)
    for (const s of [0, L]) if (!nearGap(s, D / 2)) { const p = along(path, cum, s); addTower(p.at, p.u, "end"); anchors.push(s); }
  }
  for (const g of gaps) anchors.push(g.s - g.half, g.s + g.half);
  anchors.sort((a, b) => a - b);
  // Between each pair of neighboring anchors (around a closed loop, the last back to the first), evenly spaced
  const between = [];
  if (!anchors.length && closed) { const p = along(path, cum, 0); addTower(p.at, p.u, "wall"); between.push([0, L]); }
  for (let k = 0; k < anchors.length; k++) {
    const a = anchors[k], b = k + 1 < anchors.length ? anchors[k + 1] : closed ? anchors[0] + L : null;
    if (b !== null) between.push([a, b]);
  }
  for (const [a, b] of between) {
    if (gaps.some((g) => Math.abs(g.s - g.half - wrap(a)) < 1e-9 && Math.abs(g.s + g.half - wrap(a) - (b - a)) < 1e-9)) continue; // the gap itself
    const n = Math.round((b - a) / spacing + 0.25); // so no stretch runs much past the spacing without one
    for (let k = 1; k < n; k++) {
      const sm = wrap(a + ((b - a) * k) / n);
      if (nearGap(sm, D / 2)) continue;
      const p = along(path, cum, sm);
      addTower(p.at, p.u, "wall");
    }
  }

  // The ditch or moat: a band along the outside, beyond a berm. It stops where it would run into water (a river
  // along the wall is its moat there), so it can come in pieces
  const ditches = [];
  const bridges = [];
  if (f.outside === "ditch" || f.outside === "moat") {
    const W = ft(f.ditchWidth ?? (palisade ? 12 : 20));
    const d = G.ditchIn + W / 2; // beyond the towers and gatehouses, so none stands in it
    let line = null;
    if (closed) {
      const ring = path.slice(0, -1);
      const grown = offset([ring], d);
      const big = grown.reduce((x, y) => (!x || ringArea(y) > ringArea(x) ? y : x), null);
      if (big && ringArea(big) > ringArea(ring)) line = [...big, big[0]];
    } else line = offsetPath(path, d * sign);
    if (closed && !line) notes.push({ level: "warning", id: f.id, message: `"${f.id}" crosses itself, so its ${f.outside} can't be laid out.` });
    if (line && line.length >= 2) {
      const lcum = lengths(line), LL = lcum[lcum.length - 1];
      // A moat runs on into any water it meets, so where a river runs close along the wall the water comes right up
      // to it (the moat is painted under the river). A dry ditch stops short of the water instead
      const moat = f.outside === "moat";
      const wet = moat ? [] : wetStretches(line, lcum, closed, (q) => inWater(q, waters, W / 2));
      const dry = [];
      const join = (p) => ({ path: p });
      if (!wet.length) dry.push(closed ? { path: line, closed: true } : { path: line, closed: false });
      else if (!closed) {
        let at = 0;
        for (const [a, b] of wet) { if (a - at > 1) dry.push(join(piece(line, lcum, at, a))); at = Math.min(LL, b); }
        if (LL - at > 1) dry.push(join(piece(line, lcum, at, LL)));
      } else {
        for (let k = 0; k < wet.length; k++) {
          const a = wet[k][1], b = wet[(k + 1) % wet.length][0] + (k + 1 < wet.length ? 0 : LL);
          if (b - a <= 1) continue;
          const a0 = ((a % LL) + LL) % LL, b0 = a0 + (b - a);
          dry.push(join(b0 <= LL ? piece(line, lcum, a0, b0) : [...piece(line, lcum, a0, LL).slice(0, -1), ...piece(line, lcum, 0, Math.min(LL, b0 - LL))]));
        }
      }
      for (const d of dry) {
        const ditch = { path: d.path, width: W, closed: !!d.closed, moat };
        ditches.push(ditch);
        // A bridge wherever a road crosses the moat
        if (ditch.moat) for (const x of roadWaterCrossings(roads, [{ id: `${f.id}/moat`, path: ditch.path, width: W }])) bridges.push(snapTo({ class: "bridge", width: 0, length: 0 }, x));
      }
    }
  }
  return { runs, towers, gates, ditches, bridges, band: { path, half: wallReach(f, sq) }, side: sign, closed, notes };
}

function ringArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a / 2);
}

/**
 * A band along a path (half its width each side) as simple polygons, a few squares of the path each, so a closed
 * loop's band never comes out as one ring around everything inside it.
 */
export function bandPieces(path, half, step = 6) {
  const cum = lengths(path), L = cum[cum.length - 1];
  if (!(L > 0) || !(half > 0)) return [];
  const n = Math.max(1, Math.ceil(L / step));
  const out = [];
  for (let k = 0; k < n; k++) out.push(...bands([{ path: piece(path, cum, (L * k) / n, (L * (k + 1)) / n), half }]));
  return out.filter((p) => p.length >= 3);
}

/**
 * True when a road passes within d of a point somewhere along it, not just at one of its ends (the nearest place on
 * it isn't its first or last point).
 */
function passesOver(q, path, d) {
  let best = Infinity, end = false;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((q[0] - ax) * dx + (q[1] - ay) * dy) / l2)) : 0;
    const dist = Math.hypot(ax + t * dx - q[0], ay + t * dy - q[1]);
    if (dist < best) { best = dist; end = (i === 1 && t === 0) || (i === path.length - 1 && t === 1); }
  }
  return best < d && !end;
}

/** True when a point is in water or on its bank or shore, reach squares (half of what stands there) or less from its edge. */
function inWater(q, waters, reach) {
  return waters.some((w) => Array.isArray(w.path) && w.path.length >= 2 && (w.body || w.widths ? pastEdge(q, w) < bankOf(w) + reach : distanceToPath(q, w.path) < (w.width ?? 1) / 2 + 0.475 + reach));
}

/**
 * The stretches of a path that are wet, as [from, to] lengths along it, from samples every 0.2 squares. Around a
 * closed loop a stretch over its start runs from a length past the end's (to - from stays its length).
 */
function wetStretches(path, cum, closed, wet) {
  const L = cum[cum.length - 1];
  if (!(L > 0)) return [];
  const n = Math.max(2, Math.ceil(L / 0.2));
  const marks = [];
  for (let k = 0; k <= n; k++) marks.push(wet(along(path, cum, (L * k) / n).at));
  if (!marks.some(Boolean)) return [];
  if (closed && marks.every(Boolean)) return [[0, L]];
  const out = [];
  let from = null;
  for (let k = 0; k <= n; k++) {
    if (marks[k] && from === null) from = k;
    if ((!marks[k] || k === n) && from !== null) { out.push([(L * Math.max(0, from - 0.5)) / n, (L * Math.min(n, (marks[k] ? k : k - 1) + 0.5)) / n]); from = null; }
  }
  // A closed loop's stretch that runs over its start is one stretch
  if (closed && out.length > 1 && marks[0] && marks[n]) {
    const first = out.shift(), last = out.pop();
    out.push([last[0], first[1] + L]);
  }
  return out;
}

