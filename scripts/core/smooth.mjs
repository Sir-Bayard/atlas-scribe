/**
 * Curves for the plan's roads, rivers and walls. A plan gives a path as a few points; drawn straight between them,
 * every point is a sharp corner. Each path is replaced, for the layout only, by a smooth curve through the same points
 * (centripetal Catmull-Rom, which never loops or overshoots wildly at a tight turn), so a point placed by hand stays
 * on the line. A wall keeps its sharp corners and curves only its gentle bends. A path that ended on another path
 * still ends on it: its end is moved onto the other's curve.
 * A feature with straight: true is left as it is. The plan itself is never changed. Pure: runs anywhere.
 * Numbers are in squares.
 */

/** The types whose paths are smoothed. */
const CURVED = new Set(["road", "water", "wall"]);

/** Turns sharper than this (degrees) stay corners on a wall: a wall's corners are built, its gentle bends drift. */
const WALL_CORNER = 50;

/**
 * A smooth curve through pts, a point about every step squares. Two points (or fewer) come back as they are.
 * corner: turns sharper than this many degrees stay sharp (the path is curved in pieces between them).
 */
export function smoothPath(pts, step = 0.5, corner = 180) {
  if (!Array.isArray(pts) || pts.length < 3) return pts;
  if (corner < 180) {
    const cuts = [0];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
      const b = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
      const turn = Math.abs(((b - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      if ((turn * 180) / Math.PI > corner) cuts.push(i);
    }
    cuts.push(pts.length - 1);
    if (cuts.length > 2) {
      const out = [];
      for (let k = 1; k < cuts.length; k++) {
        const piece = catmullRom(pts.slice(cuts[k - 1], cuts[k] + 1), step);
        out.push(...(k === 1 ? piece : piece.slice(1)));
      }
      return out;
    }
  }
  return catmullRom(pts, step);
}

/** Centripetal Catmull-Rom (alpha 0.5) through pts, about every step squares. */
function catmullRom(pts, step, alpha = 0.5) {
  if (!Array.isArray(pts) || pts.length < 3) return pts;
  // Repeated points would make a zero-length span
  const p = pts.filter((q, i) => i === 0 || Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) > 1e-9);
  if (p.length < 3) return p;
  // Mirror a point past each end, so the curve leaves each end heading the way the path does
  const first = [2 * p[0][0] - p[1][0], 2 * p[0][1] - p[1][1]];
  const n = p.length;
  const last = [2 * p[n - 1][0] - p[n - 2][0], 2 * p[n - 1][1] - p[n - 2][1]];
  const q = [first, ...p, last];
  const out = [p[0]];
  for (let i = 1; i < q.length - 2; i++) {
    const [p0, p1, p2, p3] = [q[i - 1], q[i], q[i + 1], q[i + 2]];
    const knot = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), alpha) || 1e-6;
    const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(1, Math.ceil(len / step));
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
export function smoothPlanPaths(plan, step = 0.5) {
  const features = Array.isArray(plan?.features) ? plan.features : [];
  const curved = (f) => CURVED.has(f?.type) && Array.isArray(f.path) && f.path.length >= 3 && f.straight !== true;
  const smoothed = new Map(features.filter(curved).map((f) => [f, smoothPath(f.path, step, f.type === "wall" ? WALL_CORNER : 180)]));
  if (!smoothed.size) return plan;
  const pathOf = (f) => smoothed.get(f) ?? f.path;
  const out = features.map((f) => {
    if (!CURVED.has(f?.type) || !Array.isArray(f.path) || f.path.length < 2) return f;
    let path = pathOf(f);
    // Ends that sat on another path of the same type follow it onto its curve
    const others = features.filter((g) => g !== f && g?.type === f.type && Array.isArray(g.path) && g.path.length >= 2 && smoothed.has(g));
    const fix = (end) => {
      for (const g of others) {
        if (nearestOn(end, g.path).d > 0.05) continue;
        return nearestOn(end, pathOf(g)).p;
      }
      return null;
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
