/**
 * Caves and dungeons on a battle map (an area of class cave or dungeon): solid rock with its open ground carved out.
 * A cave by cellular automata (random rock smoothed by its neighbors until passages and chambers form, its largest
 * open part kept, its outline rounded); a dungeon by binary space partition (the area split in two again and again,
 * a room in each part, the parts' rooms joined by corridors, a door where a corridor meets a room). Their floors are
 * then worn by wave function collapse: cracks, rubble, moss and puddles in patches that fit their neighbors. Squares
 * are the plan's; pure: runs anywhere.
 */
import { bbox, distanceToPath, pointInPolygon, shapeToPolygon } from "../geom.mjs";
import { union, signedArea } from "../lots/poly.mjs";
import { simplify } from "./battle.mjs";

/** The wear a floor square can have, how often, and which may lie beside which (every kind beside clean ground). */
export const WEAR = {
  clean: { weight: 24, next: ["clean", "crack", "rubble", "moss", "puddle"] },
  crack: { weight: 2, next: ["clean", "crack", "rubble"] },
  rubble: { weight: 1.5, next: ["clean", "crack", "rubble"] },
  moss: { weight: 2, next: ["clean", "moss", "puddle"] },
  puddle: { weight: 1, next: ["clean", "moss", "puddle"] },
};
const KINDS = Object.keys(WEAR);

/** Rounds a ring's corners (Chaikin's cutting, twice), for a cave's outline. */
function rounded(ring, times = 2) {
  let pts = ring;
  for (let t = 0; t < times; t++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = out;
  }
  return pts;
}

/**
 * A closed ring with points closer than tol to the line between their neighbors dropped (Douglas-Peucker on its two
 * halves, split at the point farthest from its first), so its walls are hundreds of pieces, not thousands.
 */
function simplifyRing(ring, tol) {
  if (ring.length < 8) return ring;
  let far = 1, d = -1;
  for (let i = 1; i < ring.length; i++) { const e = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]); if (e > d) { d = e; far = i; } }
  const a = simplify(ring.slice(0, far + 1), tol), b = simplify([...ring.slice(far), ring[0]], tol);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? out : ring;
}

/** The cells of a grid (open[j][i] true) as polygons: the open ground's outlines, each hole a ring of its own. */
function cellsToRings(open, x0, y0, cell) {
  const ny = open.length, nx = open[0]?.length ?? 0;
  const isOpen = (i, j) => j >= 0 && j < ny && i >= 0 && i < nx && !!open[j][i];
  // (every side of an open cell facing a closed one, going around the cell clockwise as the map is drawn, y down:
  // the open ground on each edge's right; edges from each corner)
  const from = new Map(), edges = [];
  const K = (x, y) => y * (nx + 2) + x;
  const add = (ax, ay, bx, by) => { const e = { ax, ay, bx, by, used: false }; edges.push(e); const k = K(ax, ay); if (!from.has(k)) from.set(k, []); from.get(k).push(e); };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!open[j][i]) continue;
    if (!isOpen(i, j - 1)) add(i, j, i + 1, j);
    if (!isOpen(i + 1, j)) add(i + 1, j, i + 1, j + 1);
    if (!isOpen(i, j + 1)) add(i + 1, j + 1, i, j + 1);
    if (!isOpen(i - 1, j)) add(i, j + 1, i, j);
  }
  // Each ring followed edge to edge; where two leave one corner (cells touching only there), the right turn, so cells
  // that touch at a corner stay apart, as the floor's four-way joins have them
  const rings = [];
  for (const e0 of edges) {
    if (e0.used) continue;
    const pts = [];
    let e = e0;
    while (e && !e.used) {
      e.used = true;
      pts.push([e.ax, e.ay]);
      const dx = e.bx - e.ax, dy = e.by - e.ay;
      const next = (from.get(K(e.bx, e.by)) ?? []).filter((q) => !q.used);
      const turn = (q) => { const qx = q.bx - q.ax, qy = q.by - q.ay; return qx === -dy && qy === dx ? 0 : qx === dx && qy === dy ? 1 : 2; };
      e = next.sort((a, b) => turn(a) - turn(b))[0];
    }
    // (corners only: points in a straight line dropped)
    const ring = pts.filter((p, k) => { const a = pts[(k - 1 + pts.length) % pts.length], b = pts[(k + 1) % pts.length]; return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) !== 0; });
    if (ring.length >= 3) rings.push(ring.map(([x, y]) => [x0 + x * cell, y0 + y * cell]));
  }
  return rings;
}

/**
 * A cave's open ground: a grid of cells (cell squares) over the area, about fill of them rock at first, smoothed steps
 * times (a cell is rock when five or more of the nine around it are), the area's edge kept rock, the largest open part
 * kept. Returns { open, x0, y0, cell }.
 */
export function caveCells(poly, r, { cell = 0.5, fill = 0.46, steps = 5 } = {}) {
  const [bx0, by0, bx1, by1] = bbox(poly);
  const nx = Math.max(3, Math.ceil((bx1 - bx0) / cell)), ny = Math.max(3, Math.ceil((by1 - by0) / cell));
  // (which cells are the area's edge, worked out once)
  const edges = Array.from({ length: ny }, (_, j) => Array.from({ length: nx }, (_, i) => i <= 1 || j <= 1 || i >= nx - 2 || j >= ny - 2 || !pointInPolygon([bx0 + (i + 0.5) * cell, by0 + (j + 0.5) * cell], poly)));
  const edge = (i, j) => edges[j][i];
  let rock = Array.from({ length: ny }, (_, j) => Array.from({ length: nx }, (_, i) => edge(i, j) || r.next() < fill));
  for (let s = 0; s < steps; s++) {
    const next = rock.map((row) => row.slice());
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (edge(i, j)) { next[j][i] = true; continue; }
      let n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) n += rock[j + dj]?.[i + di] ?? true ? 1 : 0;
      next[j][i] = n >= 5;
    }
    rock = next;
  }
  // (only the largest open part: no sealed pockets nobody can reach)
  const seen = Array.from({ length: ny }, () => new Array(nx).fill(-1));
  let best = -1, bestN = 0, label = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (rock[j][i] || seen[j][i] >= 0) continue;
    let n = 0;
    const stack = [[i, j]];
    seen[j][i] = label;
    while (stack.length) {
      const [a, b] = stack.pop();
      n++;
      for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = a + da, d = b + db;
        if (c >= 0 && d >= 0 && c < nx && d < ny && !rock[d][c] && seen[d][c] < 0) { seen[d][c] = label; stack.push([c, d]); }
      }
    }
    if (n > bestN) { bestN = n; best = label; }
    label++;
  }
  const open = seen.map((row) => row.map((v) => v === best && best >= 0));
  return { open, x0: bx0, y0: by0, cell };
}

/**
 * A dungeon's rooms and corridors by binary space partition of the area's box (whole squares): each part split across
 * its longer side while it's more than twice the smallest room, a room in each leaf, then each split's two halves joined
 * by an L-shaped corridor between a room on either side. Returns { rooms: [[x0, y0, x1, y1]], corridors: [[x0, y0, x1,
 * y1]] } (rectangles in squares), only those inside the area.
 */
export function dungeonRooms(poly, r, { min = 5, corridor = 1 } = {}) {
  const [bx0, by0, bx1, by1] = bbox(poly).map((v, k) => (k < 2 ? Math.ceil(v) + 1 : Math.floor(v) - 1));
  const rooms = [], corridors = [];
  const rectIn = ([a, b, c, d]) => [[a, b], [c, b], [c, d], [a, d]].every((p) => pointInPolygon(p, poly));
  const split = (box, depth) => {
    const [x0, y0, x1, y1] = box, w = x1 - x0, h = y1 - y0;
    const canX = w >= 2 * min + 2, canY = h >= 2 * min + 2;
    if (depth > 8 || (!canX && !canY)) {
      // A room in the leaf: most of it, a square or more in from its sides
      const rw = Math.max(3, Math.min(w - 2, Math.round(w * (0.55 + r.next() * 0.35)))), rh = Math.max(3, Math.min(h - 2, Math.round(h * (0.55 + r.next() * 0.35))));
      const rx = x0 + 1 + Math.floor(r.next() * Math.max(1, w - rw - 1)), ry = y0 + 1 + Math.floor(r.next() * Math.max(1, h - rh - 1));
      const room = [rx, ry, Math.min(x1 - 1, rx + rw), Math.min(y1 - 1, ry + rh)];
      if (room[2] - room[0] >= 2 && room[3] - room[1] >= 2 && rectIn(room)) { rooms.push(room); return [room]; }
      return [];
    }
    const across = canX && (!canY || w > h || (w === h && r.next() < 0.5));
    const at = across ? x0 + min + 1 + Math.floor(r.next() * (w - 2 * min - 1)) : y0 + min + 1 + Math.floor(r.next() * (h - 2 * min - 1));
    const A = split(across ? [x0, y0, at, y1] : [x0, y0, x1, at], depth + 1), B = split(across ? [at, y0, x1, y1] : [x0, at, x1, y1], depth + 1);
    if (A.length && B.length) {
      // (the nearest pair of rooms across the split, joined: along, then across)
      let pair = null;
      for (const a of A) for (const b of B) {
        const d = Math.hypot((a[0] + a[2]) / 2 - (b[0] + b[2]) / 2, (a[1] + a[3]) / 2 - (b[1] + b[3]) / 2);
        if (!pair || d < pair.d) pair = { a, b, d };
      }
      const ca = [Math.floor((pair.a[0] + pair.a[2]) / 2), Math.floor((pair.a[1] + pair.a[3]) / 2)], cb = [Math.floor((pair.b[0] + pair.b[2]) / 2), Math.floor((pair.b[1] + pair.b[3]) / 2)];
      const c = corridor;
      const seg = (p, q) => [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]) + c, Math.max(p[1], q[1]) + c];
      const bend = r.next() < 0.5 ? [cb[0], ca[1]] : [ca[0], cb[1]];
      for (const s of [seg(ca, bend), seg(bend, cb)]) if (rectIn(s)) corridors.push(s);
    }
    return [...A, ...B];
  };
  split([bx0, by0, bx1, by1], 0);
  return { rooms, corridors };
}

/**
 * Wear over a floor by wave function collapse: each square of cells (a grid, true where there's floor) gets a kind of
 * WEAR that its four neighbors allow, the square with the fewest choices settled first (by weight, from r), its
 * neighbors' choices narrowed in turn; a square left with none is clean. Returns [[i, j, kind]] for every worn square.
 */
export function wearOf(cells, r) {
  const ny = cells.length, nx = cells[0]?.length ?? 0;
  const opts = cells.map((row) => row.map((v) => (v ? new Set(KINDS) : null)));
  const allowed = (set) => new Set([...set].flatMap((k) => WEAR[k].next));
  const narrow = (i, j, changed) => {
    const stack = [[i, j]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const here = allowed(opts[b][a]);
      for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const s = opts[b + db]?.[a + da];
        if (!s) continue;
        const before = s.size;
        for (const k of [...s]) if (!here.has(k)) s.delete(k);
        if (!s.size) s.add("clean");
        if (s.size !== before) { stack.push([a + da, b + db]); changed.push([a + da, b + db]); }
      }
    }
  };
  // (the square with the fewest choices first, ties by a number each square drew at the start: a heap of squares by
  // that, an entry stale once its square's choices change)
  const tie = cells.map((row) => row.map(() => r.next()));
  const heap = [];
  const less = (a, b) => a[0] < b[0];
  const push = (e) => { heap.push(e); let k = heap.length - 1; while (k) { const p = (k - 1) >> 1; if (!less(heap[k], heap[p])) break; [heap[k], heap[p]] = [heap[p], heap[k]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const a = 2 * k + 1, b = a + 1; let m = k; if (a < heap.length && less(heap[a], heap[m])) m = a; if (b < heap.length && less(heap[b], heap[m])) m = b; if (m === k) break; [heap[k], heap[m]] = [heap[m], heap[k]]; k = m; } } return top; };
  const queue = (i, j) => { const s = opts[j][i]; if (s && s.size > 1) push([s.size + tie[j][i] * 0.1, i, j, s.size]); };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) queue(i, j);
  const narrowed = [];
  while (heap.length) {
    const [, i, j, size] = pop();
    const s = opts[j][i];
    if (!s || s.size <= 1 || s.size !== size) continue;
    const list = [...s], total = list.reduce((t, k) => t + WEAR[k].weight, 0);
    let pick = r.next() * total, choice = list[0];
    for (const k of list) { pick -= WEAR[k].weight; if (pick <= 0) { choice = k; break; } }
    opts[j][i] = new Set([choice]);
    narrowed.length = 0;
    narrow(i, j, narrowed);
    for (const [a, b] of narrowed) queue(a, b);
  }
  const out = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = opts[j][i] && [...opts[j][i]][0];
    if (k && k !== "clean") out.push([i, j, k]);
  }
  return out;
}

/**
 * Lays out one cave or dungeon area f. r: its random stream. Returns { items, floor: rings } (items: the rock, the
 * floor, the rock walls, a dungeon's doors, the wear) and the floor's rings for what else keeps to it.
 */
export function layUnderground(f, r) {
  const poly = shapeToPolygon(f.shape, f.rot ?? 0);
  const items = [];
  if (poly.length < 3) return { items, floor: [] };
  const cave = f.class === "cave";
  let rings = [], doors = [];
  if (cave) {
    const { open, x0, y0, cell } = caveCells(poly, r.fork("cells"), { fill: f.openness === "tight" ? 0.5 : f.openness === "open" ? 0.42 : 0.46 });
    rings = cellsToRings(open, x0, y0, cell).map((ring) => simplifyRing(rounded(ring), 0.15));
  } else {
    const { rooms, corridors } = dungeonRooms(poly, r.fork("rooms"), { corridor: f.corridors === "wide" ? 2 : 1 });
    const rect = ([a, b, c, d]) => [[a, b], [c, b], [c, d], [a, d]];
    rings = union([...rooms, ...corridors].map(rect));
    // (only the rooms the corridors join to the biggest: a room a corridor couldn't reach, in an odd shape, left rock)
    const main = rings.reduce((m, ring) => (!m || Math.abs(signedArea(ring)) > Math.abs(signedArea(m)) ? ring : m), null);
    if (main) rings = rings.filter((ring) => ring === main || pointInPolygon(ring[0], main));
    // Doors where a corridor leaves a room: across the corridor, on the room's side
    for (const c of corridors) for (const rm of rooms) {
      const [cx0, cy0, cx1, cy1] = c, [rx0, ry0, rx1, ry1] = rm;
      // (the corridor running out through one of the room's four sides: a door across it on that side)
      const vertical = cx1 - cx0 < cy1 - cy0;
      if (vertical && cx0 >= rx0 && cx1 <= rx1) {
        if (cy0 < ry0 && cy1 > ry0) doors.push([[cx0, ry0], [cx1, ry0]]);
        if (cy0 < ry1 && cy1 > ry1) doors.push([[cx0, ry1], [cx1, ry1]]);
      } else if (!vertical && cy0 >= ry0 && cy1 <= ry1) {
        if (cx0 < rx0 && cx1 > rx0) doors.push([[rx0, cy0], [rx0, cy1]]);
        if (cx0 < rx1 && cx1 > rx1) doors.push([[rx1, cy0], [rx1, cy1]]);
      }
    }
    const key = (d) => d.flat().map((v) => v.toFixed(2)).join(",");
    doors = [...new Map(doors.map((d) => [key(d), d])).values()].filter(() => r.next() < (f.doors === "none" ? 0 : f.doors === "all" ? 1 : 0.6));
    // (none on a room left out: a door's middle lies on the kept floor's edge or inside it)
    const onKept = ([a, b]) => { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; return !main || pointInPolygon(m, main) || distanceToPath(m, [...main, main[0]]) < 0.05; };
    doors = doors.filter(onKept);
  }
  rings = rings.filter((ring) => ring.length >= 3 && Math.abs(signedArea(ring)) > 0.5);
  if (!rings.length) return { items, floor: [] };
  items.push({ kind: "rock", id: `${f.id}/rock`, from: f.id, ring: poly, holes: rings, style: cave ? "cave" : "dungeon" });
  items.push({ kind: "surface", id: `${f.id}/floor`, from: f.id, class: cave ? "cavefloor" : "dungeonfloor", rings });
  rings.forEach((ring, k) => items.push({ kind: "rockwall", id: `${f.id}/wall${k + 1}`, from: f.id, path: [...ring, ring[0]], closed: true }));
  doors.forEach(([a, b], k) => items.push({ kind: "door", id: `${f.id}/door${k + 1}`, from: f.id, a, b }));
  // The wear, a square at a time over the floor
  const [x0, y0, x1, y1] = bbox(rings.flat());
  // (a square's middle on the floor: inside an odd number of rings, found a row at a time where the rings cross it)
  const cells = [];
  for (let y = Math.floor(y0); y < y1; y++) {
    const yc = y + 0.5, xs = [];
    for (const ring of rings) for (let k = 0; k < ring.length; k++) {
      const [ax, ay] = ring[k], [bx, by] = ring[(k + 1) % ring.length];
      if ((ay > yc) !== (by > yc)) xs.push(ax + ((yc - ay) * (bx - ax)) / (by - ay));
    }
    xs.sort((a, b) => a - b);
    const row = [];
    for (let x = Math.floor(x0); x < x1; x++) { const xc = x + 0.5; let n = 0; for (const v of xs) { if (v < xc) n++; else break; } row.push(n % 2 === 1); }
    cells.push(row);
  }
  if (f.wear !== "none") for (const [i, j, kind] of wearOf(cells, r.fork("wear"))) {
    const x = Math.floor(x0) + i + 0.5, y = Math.floor(y0) + j + 0.5, wr = r.fork("worn", i, j);
    if (kind === "rubble") items.push({ kind: "prop", id: `${f.id}/rubble-${i}-${j}`, from: f.id, class: "rock", x: x + (wr.next() - 0.5) * 0.4, y: y + (wr.next() - 0.5) * 0.4, rot: wr.next() * 360, variant: wr.int(8), scale: 0.35 + wr.next() * 0.2 });
    else items.push({ kind: "wear", id: `${f.id}/${kind}-${i}-${j}`, from: f.id, class: kind, x, y, rot: wr.next() * 360, s: 0.7 + wr.next() * 0.5 });
  }
  return { items, floor: rings };
}
