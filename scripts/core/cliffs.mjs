/**
 * Cliffs: a line with a drop on one side. The plan gives a wall of class cliff (its path the top edge, its side the
 * low ground at its foot, its height in feet); the layout, the checker and the painters all read it through here.
 * Pure: runs anywhere. Numbers are in squares unless they say feet.
 */

/** A cliff's face seen from above, as wide as about two thirds of its height, in squares: never narrower than 0.4. */
export const cliffWidth = (heightFt, sq) => Math.max(0.4, (0.7 * (Number.isFinite(heightFt) && heightFt >= 0 ? heightFt : 30)) / sq);

/** How far the rubble at its foot reaches past the face, in squares. */
export const CLIFF_FOOT = 0.35;

/** -1 or 1: which way its low side lies from its line (left of the way it runs for side "left"). */
export const lowSign = (side) => (side === "right" ? -1 : 1);

/** True when a path's last point is its first (a ring). */
const isRing = (path) => path.length > 3 && path[0][0] === path[path.length - 1][0] && path[0][1] === path[path.length - 1][1];

/**
 * A path moved d squares to its left (negative: right). d is one distance, or one for each point. At a bend each point
 * moves along the bisector, far enough that both sides stay d off (mitered, at most three times d), so a sharp corner
 * neither pinches the band on its outside nor folds it on its inside; a ring's first and last points meet.
 */
export function offsetLine(path, d) {
  const n = path.length, ring = isRing(path);
  const normal = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return l ? [dy / l, -dx / l] : null; };
  // (each stretch's normal, a zero-length stretch taking its neighbor's)
  const seg = path.slice(1).map((q, i) => normal(path[i], q));
  for (let i = 1; i < seg.length; i++) seg[i] ??= seg[i - 1];
  for (let i = seg.length - 2; i >= 0; i--) seg[i] ??= seg[i + 1];
  return path.map((p, i) => {
    const k = Array.isArray(d) ? d[i] : d;
    let n0 = i > 0 ? seg[i - 1] : ring ? seg[seg.length - 1] : null, n1 = i < n - 1 ? seg[i] : ring ? seg[0] : null;
    n0 ??= n1; n1 ??= n0;
    if (!n0) return [p[0], p[1]];
    const mx = n0[0] + n1[0], my = n0[1] + n1[1], ml = Math.hypot(mx, my);
    if (ml < 1e-6) return [p[0] + n1[0] * k, p[1] + n1[1] * k];
    const m = Math.min(3, 1 / Math.max(1e-6, (mx / ml) * n1[0] + (my / ml) * n1[1]));
    return [p[0] + (mx / ml) * m * k, p[1] + (my / ml) * m * k];
  });
}

/** A path with a point at least every step squares (its own points kept). */
function resample(path, step) {
  const out = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** How far a cliff takes to rise from nothing at an end inside the map, in squares. */
export const CLIFF_RAMP = 2.5;

/**
 * What a cliff takes up: { line (its top edge, a point every half square), taper (at each point, the share of its
 * full height it stands: an end inside the map dies away over a few squares), toe (the face's foot), w (the face's
 * full width), sign (its low side), keep: { path, half } (a band along the face and its foot, with a little of the top,
 * for things to keep off) }. size: the map's [width, height] in squares, so an end off the map runs on at full height.
 */
export function cliffOf(f, sq, size = null) {
  const w = cliffWidth(f.height, sq), sign = lowSign(f.side);
  const line = resample(f.path, 0.5);
  const at = [0];
  for (let i = 1; i < line.length; i++) at.push(at[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const L = at[at.length - 1], ramp = Math.min(CLIFF_RAMP, L / 3);
  const inside = (p) => !size || (p[0] > 0.5 && p[1] > 0.5 && p[0] < size[0] - 0.5 && p[1] < size[1] - 0.5);
  const ease = (d) => (ramp > 0 && d < ramp ? 0.15 + 0.85 * Math.sin(((d / ramp) * Math.PI) / 2) : 1);
  // (a ring, a mesa's edge or a pit's, has no ends)
  const ring = isRing(f.path);
  const [dieA, dieB] = ring ? [false, false] : [inside(line[0]), inside(line[line.length - 1])];
  const taper = at.map((s) => Math.min(dieA ? ease(s) : 1, dieB ? ease(L - s) : 1));
  const toe = offsetLine(line, taper.map((t) => sign * w * t));
  return { line, taper, toe, w, sign, keep: { path: offsetLine(f.path, (sign * (w + CLIFF_FOOT - 0.3)) / 2), half: (w + CLIFF_FOOT + 0.3) / 2 + 0.15 } };
}

/** Whether p lies on the face, from the nearest of the given stretches of the line (i: a stretch's end index). */
function faceTest(p, c, idx, half) {
  let best = Infinity, at = -1, t = 0;
  for (const i of idx) {
    const a = c.line[i - 1], b = c.line[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const u = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    const e = Math.hypot(a[0] + dx * u - p[0], a[1] + dy * u - p[1]);
    if (e < best) { best = e; at = i; t = u; }
  }
  // (not past either end: there the nearest point is the end itself, and the point is off the cliff)
  if (at < 0 || (at === 1 && t === 0) || (at === c.line.length - 1 && t === 1)) return false;
  const a = c.line[at - 1], b = c.line[at], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
  const side = c.sign * (((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / l); // (positive on the low side)
  const w = c.w * ((c.taper[at - 1] ?? 1) * (1 - t) + (c.taper[at] ?? 1) * t);
  return side > 0.02 - half && side < w + 0.1 + half;
}

/**
 * True when p lies on a cliff's face, between its top edge and its toe (not counting the top edge itself), or within
 * half of it: c from cliffOf. A road ending at the top of a cliff isn't on it; one running down its face is.
 */
export function onFace(p, c, half = 0) {
  return faceTest(p, c, c.line.map((_, i) => i).slice(1), half);
}

/**
 * True when a path runs on a cliff's face anywhere (sampled every fifth of a square): c from cliffOf; half, the path's
 * half width (a road whose edge reaches the face counts, except near its ends, so one ending at the top is fine).
 * The line is taken in runs of a few stretches, each with its box, so a sample is tested only against those near it.
 */
export function runsOnFace(path, c, half = 0) {
  const m = c.w + half + 1, runs = [];
  for (let i = 1; i < c.line.length; i += 8) {
    const idx = [], pts = [];
    for (let j = i; j < Math.min(c.line.length, i + 8); j++) { idx.push(j); pts.push(c.line[j - 1], c.line[j], c.toe[j - 1], c.toe[j]); }
    runs.push({ idx, box: [Math.min(...pts.map((p) => p[0])) - m, Math.min(...pts.map((p) => p[1])) - m, Math.max(...pts.map((p) => p[0])) + m, Math.max(...pts.map((p) => p[1])) + m] });
  }
  const inBox = (q, b) => q[0] >= b[0] && q[0] <= b[2] && q[1] >= b[1] && q[1] <= b[3];
  const at = [0];
  for (let i = 1; i < path.length; i++) at.push(at[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const L = at[at.length - 1];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const near = runs.filter((r) => Math.max(a[0], b[0]) >= r.box[0] && Math.min(a[0], b[0]) <= r.box[2] && Math.max(a[1], b[1]) >= r.box[1] && Math.min(a[1], b[1]) <= r.box[3]);
    if (!near.length) continue;
    const l = at[i] - at[i - 1], n = Math.max(1, Math.ceil(l / 0.2));
    for (let k = 0; k <= n; k++) {
      const q = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n], s = at[i - 1] + (l * k) / n;
      const idx = near.filter((r) => inBox(q, r.box)).flatMap((r) => r.idx);
      if (idx.length && faceTest(q, c, idx, Math.min(s, L - s) > half + 0.3 ? half : 0)) return true;
    }
  }
  return false;
}

/** Whether segment a-b crosses segment c-d. */
function cross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/** True when a path crosses a cliff's line. */
export function crossesCliff(path, cliff) {
  for (let i = 1; i < path.length; i++) for (let j = 1; j < cliff.length; j++) if (cross(path[i - 1], path[i], cliff[j - 1], cliff[j])) return true;
  return false;
}
