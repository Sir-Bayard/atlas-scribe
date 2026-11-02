/**
 * Curves for the plan's roads, rivers and walls. A plan gives a path as a few points; drawn straight between them,
 * every point is a sharp corner. Each path is replaced, for the layout only, by a smooth curve through the same points
 * (centripetal Catmull-Rom, which never loops or overshoots wildly at a tight turn), so a point placed by hand stays
 * on the line. A sharp turn (over 60 degrees) on a road or river is rounded off instead, cutting the corner by about
 * half a square, so the road never swings wide; a wall keeps its sharp corners and curves only its gentle bends. A
 * path that ended on another path still ends on it: its end is moved onto the other's curve.
 * A feature with straight: true is left as it is. The plan itself is never changed. Pure: runs anywhere.
 * Numbers are in squares.
 */

/** The types whose paths are smoothed. */
const CURVED = new Set(["road", "water", "wall"]); // (a cliff curves as a road does: its sharp corners rounded off)

/** Turns sharper than this (degrees) stay corners on a wall: a wall's corners are built, its gentle bends drift. */
const WALL_CORNER = 50;

/**
 * Turns sharper than this (degrees) on a road or river are rounded corners rather than part of the curve: a curve
 * forced through a sharp turn swings wide on both sides of it (over a square at a right angle), which reads wrong.
 */
const ROAD_CORNER = 60;

/** How far back along each side a road's or river's sharp corner is rounded off, in squares. */
const ROUND = 1.5;

const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;

/** How far the path turns at point i, in degrees (prev and next given). */
function turnAt(prev, at, next) {
  const a = Math.atan2(at[1] - prev[1], at[0] - prev[0]), b = Math.atan2(next[1] - at[1], next[0] - at[0]);
  return (Math.abs(((b - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 180) / Math.PI;
}

/**
 * A smooth curve through pts, a point about every step squares. Two points (or fewer) come back as they are.
 * corner: turns sharper than this many degrees are corners: the path is curved in pieces between them, so it never
 * swings wide to pass through a sharp turn. round: a corner is rounded off this far along each side (squares; 0
 * leaves it sharp). A path whose last point is its first (a ring road, a wall around a yard) is curved all the way
 * round, with no kink at the join.
 */
export function smoothPath(pts, step = 1, corner = 180, round = 0) {
  if (!Array.isArray(pts) || pts.length < 3) return pts;
  // Repeated points would make a zero-length span and a false corner
  let p = pts.filter((q, i) => i === 0 || !same(q, pts[i - 1])).map((q) => [q[0], q[1]]);
  if (p.length < 3) return p;
  const closed = p.length >= 4 && same(p[0], p[p.length - 1]);
  const sharp = (path, wrap) => {
    const n = path.length, out = [];
    for (let i = wrap ? 0 : 1; i < n - 1; i++) {
      const prev = i === 0 ? path[n - 2] : path[i - 1];
      if (turnAt(prev, path[i], path[i + 1]) > corner) out.push(i);
    }
    return out;
  };
  let ringCorner = false;
  if (closed) {
    const cuts = corner < 180 ? sharp(p, true) : [];
    if (!cuts.length) return catmullRom(p, step, true);
    // Start the ring at a corner, so the join is a corner and the rest curves as an open path
    const ring = p.slice(0, -1), k = cuts[0];
    p = [...ring.slice(k), ...ring.slice(0, k), ring[k]];
    ringCorner = true;
  }
  const inner = corner < 180 ? sharp(p, false) : [];
  const cuts = [0, ...inner, p.length - 1];
  const pieces = [];
  for (let k = 1; k < cuts.length; k++) pieces.push(catmullRom(p.slice(cuts[k - 1], cuts[k] + 1), step, false));
  if (!(round > 0)) return pieces.flatMap((piece, k) => (k ? piece.slice(1) : piece));
  // Round each corner: cut it back along both sides and join the cuts with a curve tangent to both
  const corners = ringCorner ? pieces.length : pieces.length - 1;
  for (let k = 0; k < corners; k++) {
    const a = pieces[k], b = pieces[(k + 1) % pieces.length];
    const d = Math.min(round, pathLength(a) * 0.45, pathLength(b) * 0.45);
    const tailA = cutBack(a, d), headB = cutForward(b, d);
    const c = a[a.length - 1];
    const n = Math.max(3, Math.ceil(d / (step / 3)));
    const arc = [];
    for (let s = 1; s < n; s++) {
      const t = s / n, u = 1 - t;
      arc.push([u * u * tailA.at[0] + 2 * u * t * c[0] + t * t * headB.at[0], u * u * tailA.at[1] + 2 * u * t * c[1] + t * t * headB.at[1]]);
    }
    pieces[k] = [...tailA.path, ...arc];
    pieces[(k + 1) % pieces.length] = headB.path;
    if (ringCorner && k === corners - 1) pieces[0] = headB.path; // the ring's join: the first piece starts after it
  }
  const out = pieces.flatMap((piece, k) => (k ? piece : piece));
  if (ringCorner) out.push([...out[0]]); // close the ring again
  return out;
}

const pathLength = (path) => path.reduce((sum, q, i) => (i ? sum + Math.hypot(q[0] - path[i - 1][0], q[1] - path[i - 1][1]) : 0), 0);

/** path without its last d squares: { path (ending at the cut), at (the cut) }. */
function cutBack(path, d) {
  let left = d;
  for (let i = path.length - 1; i > 0; i--) {
    const seg = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    if (seg >= left) {
      const t = (seg - left) / seg;
      const at = [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t];
      return { path: [...path.slice(0, i), at], at };
    }
    left -= seg;
  }
  return { path: [path[0]], at: path[0] };
}

/** path without its first d squares: { path (starting at the cut), at }. */
function cutForward(path, d) {
  const r = cutBack([...path].reverse(), d);
  return { path: r.path.reverse(), at: r.at };
}

/** Centripetal Catmull-Rom (alpha 0.5) through p (no repeated points), about every step squares. */
function catmullRom(p, step, closed, alpha = 0.5) {
  if (p.length < 3) return p.map((q) => [q[0], q[1]]);
  const n = p.length;
  // Past each end: for a ring, the points on the other side of the join; else a point mirrored, so the curve leaves
  // each end heading the way the path does
  const first = closed ? p[n - 2] : [2 * p[0][0] - p[1][0], 2 * p[0][1] - p[1][1]];
  const last = closed ? p[1] : [2 * p[n - 1][0] - p[n - 2][0], 2 * p[n - 1][1] - p[n - 2][1]];
  const q = [first, ...p, last];
  const out = [[p[0][0], p[0][1]]];
  for (let i = 1; i < q.length - 2; i++) {
    const [p0, p1, p2, p3] = [q[i - 1], q[i], q[i + 1], q[i + 2]];
    const knot = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), alpha) || 1e-6;
    const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    // Finer where the curve turns, so a bend stays round at a coarse step
    const bend = (closed || i > 1 ? turnAt(p0, p1, p2) : 0) + (closed || i < q.length - 3 ? turnAt(p1, p2, p3) : 0);
    const steps = Math.max(1, Math.ceil(len / step), Math.ceil(bend / 12));
    for (let s = 1; s <= steps; s++) {
      if (s === steps) { out.push([p2[0], p2[1]]); break; } // land exactly on the plan's point
      const t = t1 + ((t2 - t1) * s) / steps;
      const lerp = (a, b, ta, tb) => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
      const a1 = lerp(p0, p1, t0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2), b2 = lerp(a2, a3, t1, t3);
      out.push(lerp(b1, b2, t1, t2));
    }
  }
  return out;
}

/** The nearest point to pt on a path: { p, d }. */
function nearestOn(pt, path) {
  let best = null, bestD = Infinity;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / l2)) : 0;
    const p = [ax + dx * t, ay + dy * t];
    const d = Math.hypot(p[0] - pt[0], p[1] - pt[1]);
    if (d < bestD) { bestD = d; best = p; }
  }
  return { p: best, d: bestD };
}

/**
 * A copy of a (normalized) plan with its roads, rivers and walls along smooth curves. Ends that met another path of
 * the same type (within 0.05 squares of it, as the plan drew it) are moved onto that path's curve, so junctions and
 * river mouths still meet.
 */
export function smoothPlanPaths(plan, step = 1) {
  const features = Array.isArray(plan?.features) ? plan.features : [];
  const curved = (f) => CURVED.has(f?.type) && Array.isArray(f.path) && f.path.length >= 3 && f.straight !== true;
  const smoothed = new Map(features.filter(curved).map((f) => [f, f.type === "wall" && f.class !== "cliff" ? smoothPath(f.path, step, WALL_CORNER) : smoothPath(f.path, step, ROAD_CORNER, ROUND)]));
  if (!smoothed.size) return plan;
  const pathOf = (f) => smoothed.get(f) ?? f.path;
  const out = features.map((f) => {
    if (!CURVED.has(f?.type) || !Array.isArray(f.path) || f.path.length < 2) return f;
    let path = pathOf(f);
    // Ends that sat on another path of the same type follow it onto its curve
    const others = features.filter((g) => g !== f && g?.type === f.type && Array.isArray(g.path) && g.path.length >= 2 && smoothed.has(g));
    const fix = (end) => {
      let best = null, bestD = 0.05; // the nearest path it ended on, if any
      for (const g of others) {
        const d = nearestOn(end, g.path).d;
        if (d <= bestD) { bestD = d; best = g; }
      }
      return best ? nearestOn(end, pathOf(best)).p : null;
    };
    const a = fix(f.path[0]), b = fix(f.path[f.path.length - 1]);
    if (!a && !b && !smoothed.has(f)) return f;
    path = path.map((p) => [p[0], p[1]]);
    if (a) path[0] = a;
    if (b) path[path.length - 1] = b;
    return { ...f, path };
  });
  return { ...plan, features: out };
}
