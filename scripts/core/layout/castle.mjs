/**
 * A battle map's castle works (M6 chunk 8, Patrick's choices of 8 Nov): what a stone town wall becomes up close. Its
 * curtain is solid masonry with a wall walk along its top, a level of its own at 20 ft behind a parapet, reached by
 * open flights of stairs up its inner face and through its towers. Its towers (round at the corners, square along the
 * walls) and its gatehouse are buildings of thick masonry with floors: a tower a room on each floor, curling stairs
 * painted around a round tower's wall (FA has only straight flights) or a straight flight in a square one, and doors
 * onto the walk at its level (20 ft); a gatehouse a passage with doors at each end and a portcullis, a guard room
 * each side, and a room over the passage reached from the walk.
 *
 * Laid out after the walls and their towers (walls.mjs: a tower or gatehouse is a building with `works`), before the
 * buildings' shells: each works building gets its shell (its ground floor's walls and doors), an interior for each
 * floor and its stairs, all as a building's (rooms.mjs), so the style and publish draw and wall them the same way;
 * each curtain run its Foundry walls (`curtain` on the wall item); and the wall stairs are stairs items of their own.
 * Pure: runs anywhere.
 */
import { pointInPolygon, distanceToPath, polygonsOverlap, solidOverlap, shapeToPolygon } from "../geom.mjs";
import { offset } from "../lots/poly.mjs";
import { rng } from "../rng.mjs";
import { FURNITURE } from "./rooms.mjs";
import { offsetPath } from "./walls.mjs";

/**
 * The works' sizes, in squares: walk, the wall walk's floor (20 ft); a tower's and a gatehouse's wall thickness; a door
 * onto the walk; the wall stairs' flight (two of FA's 1 by 3 flights end to end), about how far apart along a wall
 * and how far clear of buildings; a parapet's merlons (long, deep, apart), drawn by the style.
 */
export const CASTLE = { walk: 2, towerWall: 1, gateWall: 0.9, door: 1.4, flight: 6, flightEvery: 50, flightClear: 0.6, merlon: [0.55, 0.45, 0.9] };

const r3 = (v) => Math.round(v * 1000) / 1000;
const pt = (p) => [r3(p[0]), r3(p[1])];
const norm = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
const deg = (a) => (a * 180) / Math.PI;

/** A polygon's perimeter as [{ a, b, s0, s1 }], each side with where along the perimeter it starts and ends. */
function sides(ring) {
  const out = [];
  let s = 0;
  ring.forEach((a, i) => { const b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); out.push({ a, b, s0: s, s1: s + L, L }); s += L; });
  return out;
}
/** The point at length s around a ring. */
function atLength(ring, s) {
  const sd = sides(ring), P = sd.at(-1).s1, t = ((s % P) + P) % P;
  const e = sd.find((x) => t <= x.s1 + 1e-9) ?? sd.at(-1), u = e.L ? (t - e.s0) / e.L : 0;
  return [e.a[0] + (e.b[0] - e.a[0]) * u, e.a[1] + (e.b[1] - e.a[1]) * u];
}
/** Where around a ring a point is nearest, as a length along it. */
function lengthAt(ring, p) {
  let best = { d: Infinity, s: 0 };
  for (const e of sides(ring)) {
    const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], l2 = dx * dx + dy * dy;
    const u = l2 ? Math.max(0, Math.min(1, ((p[0] - e.a[0]) * dx + (p[1] - e.a[1]) * dy) / l2)) : 0;
    const d = Math.hypot(e.a[0] + u * dx - p[0], e.a[1] + u * dy - p[1]);
    if (d < best.d) best = { d, s: e.s0 + u * e.L };
  }
  return best.s;
}

/**
 * A ring's walls with openings cut in it: openings [{ s, w, type }] (s where around the ring, w how wide), each a
 * straight segment between its ends (a door's or a window's), the walls between them following the ring. Returns
 * segments [{ type, a, b, inward }] (inward toward the ring's middle).
 */
function ringWalls(ring, openings, mid) {
  const sd = sides(ring), P = sd.at(-1).s1;
  const ops = openings.map((o) => ({ ...o, s0: o.s - o.w / 2, s1: o.s + o.w / 2 })).sort((a, b) => a.s0 - b.s0);
  const inward = (a, b) => { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; return norm([mid[0] - m[0], mid[1] - m[1]]); };
  const out = [];
  const wallFrom = (s0, s1) => {
    // (the ring's corners between s0 and s1, then s1: a wall piece for each side or part of one)
    const pts = [atLength(ring, s0)];
    for (const e of sd) for (const c of [e.s0, e.s0 + P]) if (c > s0 + 1e-6 && c < s1 - 1e-6) pts.push(atLength(ring, c));
    pts.sort((p, q) => {
      const sp = lengthAt(ring, p), sq = lengthAt(ring, q);
      const fix = (v) => (v < ((s0 % P) + P) % P - 1e-6 ? v + P : v);
      return fix(sp) - fix(sq);
    });
    pts.push(atLength(ring, s1));
    for (let k = 1; k < pts.length; k++) if (Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]) > 1e-4) out.push({ type: "wall", a: pt(pts[k - 1]), b: pt(pts[k]), inward: inward(pts[k - 1], pts[k]) });
  };
  if (!ops.length) { wallFrom(0, P); return out; }
  for (let k = 0; k < ops.length; k++) {
    const o = ops[k], next = ops[(k + 1) % ops.length];
    const a = atLength(ring, o.s0), b = atLength(ring, o.s1);
    out.push({ type: o.type, a: pt(a), b: pt(b), inward: inward(a, b), ...(o.side ? { side: o.side } : {}) });
    wallFrom(o.s1, next.s0 + (k + 1 < ops.length ? 0 : P));
  }
  return out;
}

/** Where a path crosses a ring: [{ at, s }] (s where around the ring). */
function crossings(path, ring) {
  const out = [];
  for (let i = 1; i < path.length; i++) for (const e of sides(ring)) {
    const [p, q] = [path[i - 1], path[i]];
    const r = [q[0] - p[0], q[1] - p[1]], d = [e.b[0] - e.a[0], e.b[1] - e.a[1]];
    const den = r[0] * d[1] - r[1] * d[0];
    if (Math.abs(den) < 1e-12) continue;
    const t = ((e.a[0] - p[0]) * d[1] - (e.a[1] - p[1]) * d[0]) / den, u = ((e.a[0] - p[0]) * r[1] - (e.a[1] - p[1]) * r[0]) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) continue;
    const at = [p[0] + r[0] * t, p[1] + r[1] * t];
    if (out.some((o) => Math.hypot(o.at[0] - at[0], o.at[1] - at[1]) < 0.3)) continue;
    out.push({ at, s: e.s0 + u * e.L });
  }
  return out;
}

/** The parts of a segment outside every polygon (cut where it crosses their sides), each a little or more long. */
export function cutOutside(a, b, polys, min = 0.05) {
  const ts = [0, 1];
  const r = [b[0] - a[0], b[1] - a[1]];
  for (const poly of polys) for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], d = [q[0] - p[0], q[1] - p[1]];
    const den = r[0] * d[1] - r[1] * d[0];
    if (Math.abs(den) < 1e-12) continue;
    const t = ((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]) / den, u = ((p[0] - a[0]) * r[1] - (p[1] - a[1]) * r[0]) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const L = Math.hypot(r[0], r[1]), out = [];
  for (let k = 1; k < ts.length; k++) {
    if ((ts[k] - ts[k - 1]) * L < min) continue;
    const m = (ts[k] + ts[k - 1]) / 2, mp = [a[0] + r[0] * m, a[1] + r[1] * m];
    if (polys.some((poly) => pointInPolygon(mp, poly))) continue;
    const pa = [a[0] + r[0] * ts[k - 1], a[1] + r[1] * ts[k - 1]], pb = [a[0] + r[0] * ts[k], a[1] + r[1] * ts[k]];
    const last = out.at(-1);
    if (last && Math.hypot(last[1][0] - pa[0], last[1][1] - pa[1]) < 1e-6) last[1] = pt(pb);
    else out.push([pt(pa), pt(pb)]);
  }
  return out;
}

/** A rectangle w along u by d across around c, turned so its length runs along u, as a polygon. */
function boxAt(c, u, w, d) {
  const v = [-u[1], u[0]];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => pt([c[0] + u[0] * (i * w) / 2 + v[0] * (j * d) / 2, c[1] + u[1] * (i * w) / 2 + v[1] * (j * d) / 2]));
}

/**
 * Furniture along a room's walls: each piece of `want` (furniture names) set against the room's inside face somewhere
 * clear of the openings, the stairs and what's placed, its back to the wall. room: the floor polygon (inside the walls);
 * keep: polygons to stay off; doors: points to keep 1.1 squares from. Returns pieces { f, x, y, rot, variant }.
 */
function alongWalls(room, want, { keep = [], doors = [], r }) {
  const placed = [];
  const mid = room.reduce((a, p) => [a[0] + p[0] / room.length, a[1] + p[1] / room.length], [0, 0]);
  const P = sides(room).at(-1).s1;
  for (const f of want) {
    const F = FURNITURE[f];
    if (!F) continue;
    const [bw, bh] = F.body, back = F.back ?? "top";
    const deep = back === "left" ? bw : back === "none" ? Math.max(bw, bh) : bh;
    const start = r.next() * P;
    // (around the walls, and a little further out from a curved one, whose middle bows away from the piece's corners)
    for (let k = 0; k < 144; k++) {
      const s = start + ((k % 48) * P) / 48, foot = atLength(room, s), gap = 0.05 + Math.floor(k / 48) * 0.2;
      // (the wall's inward normal there: toward the room's middle, square to its side)
      const s2 = atLength(room, s + 0.05), t = norm([s2[0] - foot[0], s2[1] - foot[1]]);
      let n = [-t[1], t[0]];
      if (n[0] * (mid[0] - foot[0]) + n[1] * (mid[1] - foot[1]) < 0) n = [-n[0], -n[1]];
      const c = [foot[0] + n[0] * (deep / 2 + gap), foot[1] + n[1] * (deep / 2 + gap)];
      const o = [-n[0], -n[1]]; // toward the wall
      const rot = back === "left" ? deg(Math.atan2(-o[1], -o[0])) : back === "none" ? r.int(4) * 90 : deg(Math.atan2(o[0], -o[1]));
      const a = (rot * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      const body = [[-bw / 2, -bh / 2], [bw / 2, -bh / 2], [bw / 2, bh / 2], [-bw / 2, bh / 2]].map(([u, v]) => [c[0] + u * ca - v * sa, c[1] + u * sa + v * ca]);
      if (!body.every((q) => pointInPolygon(q, room) && distanceToPath(q, [...room, room[0]]) > 0.02 - 1e-9)) continue;
      if (doors.some((d) => body.some((q) => Math.hypot(q[0] - d[0], q[1] - d[1]) < 1.1) || Math.hypot(c[0] - d[0], c[1] - d[1]) < 1.3)) continue;
      if (keep.some((poly) => polygonsOverlap(body, poly))) continue;
      if (placed.some((p) => solidOverlap(body, p.body))) continue;
      placed.push({ f, x: r3(c[0]), y: r3(c[1]), rot: r3(rot), variant: r.int(8), body });
      break;
    }
  }
  return placed.map(({ body, ...p }) => p);
}

/** What each floor of a tower and of a gatehouse holds. */
const TOWER_FLOORS = [
  { kind: "store", want: ["barrel", "barrel", "crate", "crate", "chest"] },
  { kind: "bedroom", want: ["bed.single", "bed.single", "chest", "chest", "stool"] },
  { kind: "armory", want: ["weapon.rack", "weapon.rack", "armor.stand", "table.square", "chair", "barrel"] },
];
const GUARD_ROOM = ["weapon.rack", "table.square", "stool", "chest"];
const GATE_ROOM = ["table.work", "weapon.rack", "weapon.rack", "crate", "crate", "barrel"];

/**
 * The castle works on a battle map: every works building (a tower or gatehouse a stone town wall set up, `works` its
 * kind) gets its shell, floors and stairs, and is marked `castle` (buildingShells leaves it); every stone town wall's
 * run gets `curtain` (its Foundry walls: face and back on the ground and the floor above, the parapet and the walk's
 * inner edge at the walk); and wall stairs go up the runs' inner faces. W, H: the map's size in squares. Returns how
 * many works were built.
 */
export function castleWorks(items, W, H, seed) {
  const runs = items.filter((i) => i.kind === "wall" && i.class === "town" && Array.isArray(i.path) && i.path.length >= 2 && Array.isArray(i.face) && Array.isArray(i.back));
  const works = items.filter((i) => i.kind === "building" && i.works);
  if (!runs.length && !works.length) return 0;
  const r = rng(seed ?? 1, "castle");
  const added = [];
  const ringOf = new Map(); // a works building's wall line (its ring)
  const footOf = new Map();
  // Each works building's outline, its walls' middle line (its ring) and its floor inside them
  const geo = new Map();
  for (const b of works) {
    const gate = b.works === "gatehouse", TW = gate ? CASTLE.gateWall : CASTLE.towerWall;
    const a = ((b.rot ?? 0) * Math.PI) / 180, u = [Math.cos(a), Math.sin(a)], v = [-u[1], u[0]];
    const c = [b.cx, b.cy];
    const outerOf = (inset) => b.round ? shapeToPolygon({ circle: [b.cx, b.cy, b.len / 2 - inset] }, 0, 32) : boxAt(c, u, b.len - 2 * inset, b.dep - 2 * inset);
    const foot = outerOf(0);
    // (one the map's edge cuts is closed, as any building is: walls, no doors, no floors)
    const closed = foot.some(([x, y]) => x < -OFF_MAP || y < -OFF_MAP || x > W + OFF_MAP || y > H + OFF_MAP);
    geo.set(b, { gate, TW, u, v, c, foot, ring: outerOf(TW / 2), floor: outerOf(TW), closed });
  }
  // A run's end just short of a works building's walls (a gate's tower stands over its run's end, a little in from it)
  // is drawn back inside them, so the curtain stops in the tower, not in the gateway beside it
  for (const w of runs) trimEnds(w, [...geo.values()].map((g) => g.ring));
  for (const b of works) {
    const { gate, TW, u, v, c, foot, ring, floor, closed } = geo.get(b);
    ringOf.set(b, ring); footOf.set(b, foot);
    b.castle = true; b.group ??= b.id; b.use = gate ? "gatehouse" : "tower"; b.floorsAbove = closed ? 0 : 2;
    // (a closed tower: walls only; a closed gatehouse keeps its passage's doors below, so the road isn't sealed)
    if (closed && !gate) {
      added.push({ kind: "shell", id: `${b.group}/shell`, from: b.from, group: b.group, use: b.use, material: "masonry", works: b.works, closed: true, thickness: TW, variant: Math.floor(r.next() * 1000), walls: ringWalls(ring, [], c), ring, holes: [], foot, floor });
      continue;
    }
    // (inward: toward the wall's inner face from here, where the castle is)
    let best = { d: Infinity, p: null };
    for (const w of runs) for (let i = 1; i < w.back.length; i++) {
      const p = w.back[i - 1], q = w.back[i], dx = q[0] - p[0], dy = q[1] - p[1], l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((c[0] - p[0]) * dx + (c[1] - p[1]) * dy) / l2)) : 0;
      const m = [p[0] + t * dx, p[1] + t * dy], d = Math.hypot(m[0] - c[0], m[1] - c[1]);
      if (d < best.d) best = { d, p: m };
    }
    const inward = best.p ? norm([best.p[0] - c[0], best.p[1] - c[1]]) : [0, 1];
    // (the walk's way in: where a run's middle line crosses the ring, a door on the walk's floor)
    const walkDoors = runs.flatMap((w) => crossings(w.path, ring)).map((x) => ({ s: x.s, w: CASTLE.door, type: "door", at: x.at }));
    const P = sides(ring).at(-1).s1;
    const mid = c;
    const runPolys = runs.map((w) => [...w.face, ...w.back.slice().reverse()]);
    // (its door into the castle: the place around its ring that faces the castle most squarely where a door a square
    // wide opens onto open ground, clear of the wall's masonry and of other works; straight in, failing that)
    const others = [...geo.entries()].filter(([o]) => o !== b).map(([, g]) => g.foot);
    const opensOnto = (sAt) => {
      const a0 = atLength(ring, sAt - 0.5), b0 = atLength(ring, sAt + 0.5), m = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2];
      if (Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) < 0.9) return null; // (not across a corner)
      let n = norm([-(b0[1] - a0[1]), b0[0] - a0[0]]);
      if (n[0] * (m[0] - c[0]) + n[1] * (m[1] - c[1]) < 0) n = [-n[0], -n[1]];
      const outside = [a0, m, b0].map((p) => [p[0] + n[0] * (TW / 2 + 0.35), p[1] + n[1] * (TW / 2 + 0.35)]);
      if (outside.some((p) => runPolys.some((poly) => pointInPolygon(p, poly)) || others.some((f) => pointInPolygon(p, f)))) return null;
      return n[0] * inward[0] + n[1] * inward[1];
    };
    let inAt = lengthAt(ring, [c[0] + inward[0] * b.len, c[1] + inward[1] * b.len]), bestFace = -Infinity;
    for (let sAt = 0; sAt < P; sAt += 0.1) { const f = opensOnto(sAt); if (f != null && f > bestFace + 1e-9) { bestFace = f; inAt = sAt; } }
    // Arrow slits: a few around the ring, clear of the doors and of the wall's runs
    const slits = (taken) => {
      const out = [];
      const n = b.round ? 6 : 8;
      for (let k = 0; k < n; k++) {
        const s = ((k + 0.5) * P) / n;
        if (taken.some((o) => Math.abs(((s - o.s + P / 2) % P + P) % P - P / 2) < o.w / 2 + 0.8)) continue;
        const at = atLength(ring, s), out1 = [at[0] + (at[0] - c[0]) * 0.01, at[1] + (at[1] - c[1]) * 0.01];
        if (runPolys.some((poly) => pointInPolygon(out1, poly))) continue;
        out.push({ s, w: 0.5, type: "window" });
      }
      return out;
    };

    if (!gate) {
      // A tower: a door into the castle on the ground, the walk's doors at the walk's level, a room on each floor and
      // its stairs (painted around a round tower's wall, else FA's flight against its outer side)
      const groundOps = [{ s: inAt, w: 1, type: "door", side: "front" }];
      const ops2 = walkDoors.map(({ at, ...o }) => o);
      const rr = b.len / 2 - TW;
      let stairs;
      const outward = [-inward[0], -inward[1]];
      if (b.round) {
        const a0 = deg(Math.atan2(outward[1], outward[0])) - 60, a1 = a0 + 120;
        const r0 = Math.max(0.8, rr - 1.05), steps = 12;
        const arc = (rad, from, to) => Array.from({ length: 17 }, (_, k) => { const t = ((from + ((to - from) * k) / 16) * Math.PI) / 180; return pt([c[0] + rad * Math.cos(t), c[1] + rad * Math.sin(t)]); });
        stairs = { kind: "stairs", id: `${b.id}/stairs`, from: b.from ?? b.id, group: b.group, at: pt(c), rot: 0, len: 3, width: 1, floors: [0, 2], material: "stone", painted: true, curl: { c: pt(c), r0: r3(r0), r1: r3(rr), a0: r3(a0), a1: r3(a1), steps }, box: [...arc(rr, a0, a1), ...arc(r0 - 0.05, a1, a0)] };
      } else {
        // (along the side away from the castle, against its inside face)
        const side = Math.abs(outward[0] * u[0] + outward[1] * u[1]) > Math.abs(outward[0] * v[0] + outward[1] * v[1]) ? u : v;
        const sgn = side[0] * outward[0] + side[1] * outward[1] > 0 ? 1 : -1, n = [side[0] * sgn, side[1] * sgn];
        const half = (side === u ? b.len : b.dep) / 2 - TW;
        const along = [-n[1], n[0]];
        const at = [c[0] + n[0] * (half - 0.5), c[1] + n[1] * (half - 0.5)];
        stairs = { kind: "stairs", id: `${b.id}/stairs`, from: b.from ?? b.id, group: b.group, at: pt(at), rot: r3(deg(Math.atan2(along[1], along[0]))), len: 3, width: 1, floors: [0, 2], material: "stone", box: boxAt(at, along, 3, 1) };
      }
      added.push(stairs);
      const doorPts = (ops) => ops.filter((o) => o.type === "door").map((o) => atLength(ring, o.s));
      const shellWalls = ringWalls(ring, [...groundOps, ...slits(groundOps)], mid);
      added.push({ kind: "shell", id: `${b.group}/shell`, from: b.from, group: b.group, use: "tower", material: "masonry", works: b.works, thickness: TW, variant: Math.floor(r.next() * 1000), walls: shellWalls, ring, holes: [], foot, floor });
      for (let f = 0; f <= 2; f++) {
        const ops = f === 2 ? ops2 : [];
        const outer = f ? ringWalls(ring, [...ops, ...slits(ops)], mid) : undefined;
        const fr = rng(seed ?? 1, "castle", b.id, f);
        const furniture = alongWalls(floor, TOWER_FLOORS[f].want, { keep: [stairs.box], doors: doorPts(f ? ops : groundOps), r: fr });
        added.push({ kind: "interior", id: f ? `${b.group}/shell/interior-floor${f}` : `${b.group}/shell/interior`, from: b.from, group: b.group, use: "tower", ...(f ? { floor: f } : {}), rooms: [{ kind: TOWER_FLOORS[f].kind, poly: floor, floor: "stone", private: true }], walls: [], thickness: 0.3, material: "masonry", outerThickness: TW, ...(outer ? { outer } : {}), furniture, foot });
      }
      continue;
    }

    // A gatehouse: a passage through it where the road runs (doors at both ends, a portcullis near the outer one), a
    // guard room each side with a door into the passage, and the room over it on the walk's floor
    const p = Math.max(2, Math.min(b.passage ?? 3, b.len - 2 * TW - 4));
    const outV = [-inward[0], -inward[1]]; // (the gatehouse's outward side)
    const vs = v[0] * outV[0] + v[1] * outV[1] >= 0 ? v : [-v[0], -v[1]];
    const hl = b.len / 2 - TW, hd = b.dep / 2 - TW;
    const F = (du, dv) => pt([c[0] + u[0] * du + vs[0] * dv, c[1] + u[1] * du + vs[1] * dv]);
    // (the passage's ends in the ring: on its outer and inner sides)
    const outerAt = lengthAt(ring, F(0, b.dep)), innerAt = lengthAt(ring, F(0, -b.dep));
    const groundOps = [{ s: outerAt, w: p, type: "door", side: "gate" }, { s: innerAt, w: p, type: "door", side: "front" }];
    const shellWalls = ringWalls(ring, [...groundOps, ...slits(groundOps)], mid);
    added.push({ kind: "shell", id: `${b.group}/shell`, from: b.from, group: b.group, use: "gatehouse", material: "masonry", works: "gatehouse", ...(closed ? { closed: true } : {}), thickness: TW, variant: Math.floor(r.next() * 1000), walls: shellWalls, ring, holes: [], foot, floor });
    if (closed) continue;
    const wi = 0.3, pu = p / 2 + wi / 2;
    const passage = [F(-p / 2, -hd), F(p / 2, -hd), F(p / 2, hd), F(-p / 2, hd)];
    const leftRoom = [F(-hl, -hd), F(-pu - wi / 2, -hd), F(-pu - wi / 2, hd), F(-hl, hd)];
    const rightRoom = [F(pu + wi / 2, -hd), F(hl, -hd), F(hl, hd), F(pu + wi / 2, hd)];
    const doorV = -hd + 1.2; // (the guard rooms' doors toward the castle, inside the portcullis)
    const inner = [];
    for (const sg of [-1, 1]) {
      const x = sg * pu;
      inner.push({ type: "wall", a: F(x, -hd - TW / 2), b: F(x, doorV - 0.5) }, { type: "door", a: F(x, doorV - 0.5), b: F(x, doorV + 0.5) }, { type: "wall", a: F(x, doorV + 0.5), b: F(x, hd + TW / 2) });
    }
    const portV = hd - 1.0;
    inner.push({ type: "portcullis", a: F(-p / 2, portV), b: F(p / 2, portV) });
    const gr = rng(seed ?? 1, "castle", b.id, 0);
    const furniture = [
      ...alongWalls(leftRoom, GUARD_ROOM, { doors: [F(-pu, doorV)], r: gr }),
      ...alongWalls(rightRoom, GUARD_ROOM, { doors: [F(pu, doorV)], r: gr }),
    ];
    added.push({ kind: "interior", id: `${b.group}/shell/interior`, from: b.from, group: b.group, use: "gatehouse", rooms: [{ kind: "guardroom", poly: leftRoom, floor: "stone", private: true }, { kind: "guardroom", poly: rightRoom, floor: "stone", private: true }, { kind: "passage", poly: passage, floor: "stone", private: false }], walls: inner, thickness: wi, material: "masonry", furniture, foot, portcullis: [F(-p / 2, portV), F(p / 2, portV)] });
    const ops2 = walkDoors.map(({ at, ...o }) => o);
    added.push({ kind: "interior", id: `${b.group}/shell/interior-floor2`, from: b.from, group: b.group, use: "gatehouse", floor: 2, rooms: [{ kind: "gateroom", poly: floor, floor: "stone", private: true }], walls: [], thickness: 0.3, material: "masonry", outerThickness: TW, outer: ringWalls(ring, [...ops2, ...slits(ops2)], mid), furniture: alongWalls(floor, GATE_ROOM, { doors: ops2.map((o) => atLength(ring, o.s)), r: rng(seed ?? 1, "castle", b.id, 2) }), foot });
  }

  // Each run's curtain: its faces on the ground (and the floor above, below the walk), cut where the works stand; at
  // the walk, the parapet along its face and its inner edge
  // (cut where an open works building stands, whose walls close it at every level; a closed one has no floors above, so
  // the curtain and its walk run on through it)
  const rings = works.filter((b) => !geo.get(b).closed).map((b) => ringOf.get(b));
  const otherFeet = items.filter((i) => i.kind === "building" && !i.works).map((b) => b.round ? shapeToPolygon({ circle: [b.cx, b.cy, b.len / 2] }, 0, 24) : Array.isArray(b.poly) ? b.poly : boxAt([b.cx, b.cy], [Math.cos(((b.rot ?? 0) * Math.PI) / 180), Math.sin(((b.rot ?? 0) * Math.PI) / 180)], b.len, b.dep));
  const ways = items.filter((i) => i.kind === "way" && !i.faint && Array.isArray(i.path) && i.path.length >= 2);
  const segs = (path) => path.slice(1).map((q, i) => [path[i], q]);
  const flights = [];
  for (const w of runs) {
    const cut = (path) => segs(path).flatMap(([a, b]) => cutOutside(a, b, rings));
    const face = cut(w.face), back = cut(w.back);
    // (an end of the run that no works building covers is closed across its thickness)
    const ends = [[w.face[0], w.back[0]], [w.face.at(-1), w.back.at(-1)]].filter(([a, b]) => !rings.some((ring) => pointInPolygon([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ring))).map(([a, b]) => [pt(a), pt(b)]);
    // Wall stairs: an open flight against the inner face, about every CASTLE.flightEvery squares along the run, where
    // the yard is clear (of buildings, the works, ways, other flights and the map's edge) and the face runs straight
    const L = segs(w.back).reduce((t, [a, b]) => t + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);
    const n = L >= CASTLE.flight * 2 ? Math.max(1, Math.round(L / CASTLE.flightEvery)) : 0;
    const mine = [];
    for (let k = 0; k < n; k++) {
      const target = (L * (k + 0.5)) / n, reach = L / (2 * n);
      // (from the target outward, half a square at a time, either way in turn)
      for (let j = 0; j <= Math.ceil(reach / 0.5) * 2; j++) {
        const s = target + (j % 2 ? -1 : 1) * Math.ceil(j / 2) * 0.5;
        if (s < CASTLE.flight / 2 + 0.5 || s > L - CASTLE.flight / 2 - 0.5) continue;
        const at = alongPath(w.back, s), a0 = alongPath(w.back, s - CASTLE.flight / 2), a1 = alongPath(w.back, s + CASTLE.flight / 2);
        const ax = norm([a1[0] - a0[0], a1[1] - a0[1]]);
        // (straight: the face's two ends and middle on one line)
        if (Math.abs((at[0] - a0[0]) * ax[1] - (at[1] - a0[1]) * ax[0]) > 0.05) continue;
        let nIn = [-ax[1], ax[0]];
        // (into the yard: from the outer face toward the inner one)
        const out0 = alongPath(w.face, segsLength(w.face) * (s / L));
        if (nIn[0] * (at[0] - out0[0]) + nIn[1] * (at[1] - out0[1]) < 0) nIn = [-nIn[0], -nIn[1]];
        const c = [at[0] + nIn[0] * 0.5, at[1] + nIn[1] * 0.5], box = boxAt(c, ax, CASTLE.flight, 1);
        const clearBox = boxAt([c[0] + nIn[0] * 0.3, c[1] + nIn[1] * 0.3], ax, CASTLE.flight + 2 * CASTLE.flightClear, 1 + 2 * CASTLE.flightClear);
        if (!box.every(([x, y]) => x > 0.5 && y > 0.5 && x < W - 0.5 && y < H - 0.5)) continue;
        if ([...otherFeet, ...works.map((b) => footOf.get(b))].some((f) => polygonsOverlap(clearBox, f))) continue;
        if (ways.some((wy) => box.some((q) => distanceToPath(q, wy.path) < (wy.width ?? 1) / 2 + 0.3) || distanceToPath(c, wy.path) < (wy.width ?? 1) / 2 + 0.8)) continue;
        if ([...flights, ...mine].some((f) => polygonsOverlap(clearBox, f.box))) continue;
        const fl = { kind: "stairs", id: `${w.id}/stairs${mine.length + 1}`, from: w.from ?? w.id, at: pt(c), rot: r3(deg(Math.atan2(ax[1], ax[0]))), len: CASTLE.flight, width: 1, floors: [0, CASTLE.walk], levels: [0, CASTLE.walk], material: "stone", wall: true, box, foot: pt(at) };
        mine.push(fl);
        break;
      }
    }
    flights.push(...mine);
    // (at the walk, the inner edge runs around each flight's top instead of along the face there)
    const tops = mine.map((f) => f.box);
    const edge = back.flatMap(([a, b]) => cutOutside(a, b, tops.map((bx) => offset([bx], 0.02)[0] ?? bx)));
    for (const bx of tops) {
      // (the box's three sides away from the wall: the one along the wall is the walk's own edge)
      const sd = bx.map((p, i) => [p, bx[(i + 1) % 4]]);
      const far = sd.map((sg) => ({ sg, d: distanceToPath([(sg[0][0] + sg[1][0]) / 2, (sg[0][1] + sg[1][1]) / 2], w.back) })).sort((x, y) => x.d - y.d).slice(1).map((x) => x.sg);
      edge.push(...far.map(([a, b]) => [pt(a), pt(b)]));
    }
    w.curtain = { face, back, ends, parapet: face, edge };
  }
  items.push(...added, ...flights);
  return works.length;
}

/** How far past the map's edge a works building may run and still be entered (battle.mjs SHELL.offMap). */
const OFF_MAP = 0.5;
/** How far short of a works building's walls a run's end may stop and still be drawn back inside them, in squares. */
const TRIM_REACH = 1.8;

/**
 * Draws a run's ends back inside a works building's walls where the run reaches into them and out again just short of
 * its end (its middle line, faces and back as the layout gave them, offset again from the trimmed middle line).
 */
function trimEnds(w, rings) {
  let path = w.path.map((p) => [...p]);
  const inAny = (p) => rings.some((ring) => pointInPolygon(p, ring));
  for (const atStart of [true, false]) {
    if (atStart) path.reverse();
    // (the end is the path's last point now)
    const end = path[path.length - 1];
    if (!inAny(end)) {
      let walked = 0;
      for (let i = path.length - 1; i > 0 && walked <= TRIM_REACH; i--) {
        const a = path[i], b = path[i - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        let hit = null;
        for (let t = 0.05; t <= L + 1e-9; t += 0.05) { const q = [a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L]; if (walked + t > TRIM_REACH) break; if (inAny(q)) { hit = t; break; } }
        if (hit != null) {
          const t = Math.min(L, hit + 0.3), q = [a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L];
          path = [...path.slice(0, i), pt(q)];
          break;
        }
        walked += L;
      }
    }
    if (atStart) path.reverse();
  }
  if (path.length === w.path.length && path.every((p, i) => p[0] === w.path[i][0] && p[1] === w.path[i][1])) return;
  const half = (w.thickness ?? 2.4) / 2, side = w.side ?? 1;
  w.path = path; w.face = offsetPath(path, side * half); w.back = offsetPath(path, -side * half);
}

function segsLength(path) { let t = 0; for (let i = 1; i < path.length; i++) t += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); return t; }
function alongPath(path, s) {
  let t = 0;
  for (let i = 1; i < path.length; i++) {
    const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    if (t + l >= s || i === path.length - 1) { const u = l ? Math.max(0, Math.min(1, (s - t) / l)) : 0; return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * u, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * u]; }
    t += l;
  }
  return path[0];
}
