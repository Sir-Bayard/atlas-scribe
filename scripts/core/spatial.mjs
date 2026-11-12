/**
 * Grids for finding the few things near a point without testing every one. Big maps have hundreds of streets and
 * thousands of buildings, and a plot, a house or a tree asks what it's near many thousands of times.
 *
 * A grid only narrows the search: it returns everything that may lie within the asked radius of the point, perhaps
 * with a few farther things, and the caller measures them exactly as it would have without the grid. So a test like
 * "is any street nearer than r" gives the same answer, to the last bit, as testing every street.
 * Everything in squares. Pure: runs anywhere.
 */

const SLACK = 1e-6; // added to every box and radius, so rounding at a cell's edge never drops a thing
const SPAN = 32768; // cells either side of 0 that have their own key; anything beyond is always a candidate

/** The distance from (x, y) to the segment from (ax, ay) to (bx, by), worked out as every path test here does. */
export function segDist(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + t * dx - x, ay + t * dy - y);
}

/** Things by the boxes they cover. Things are numbered in the order they're added; more can be added any time. */
export class BoxGrid {
  constructor(cell = 4) {
    this.cell = cell;
    this.cells = new Map();
    this.always = []; // things whose box is broken or too big to key: a candidate for every point
    this.stamp = [];
    this.round = 0;
    this.out = [];
    this.count = 0;
  }

  /** Adds a thing covering the box [x0, y0, x1, y1]; returns its number. A box that's broken (not a number, or
   * turned inside out) or very big is a candidate for every point. */
  add(x0, y0, x1, y1) {
    const k = this.count++;
    this.stamp.push(0);
    const c = this.cell;
    const i0 = Math.floor((x0 - SLACK) / c), i1 = Math.floor((x1 + SLACK) / c);
    const j0 = Math.floor((y0 - SLACK) / c), j1 = Math.floor((y1 + SLACK) / c);
    if (!(x1 >= x0 && y1 >= y0 && i0 > -SPAN && j0 > -SPAN && i1 < SPAN && j1 < SPAN) || (i1 - i0 + 1) * (j1 - j0 + 1) > 4096) {
      this.always.push(k);
      return k;
    }
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const key = (i + SPAN) * 65536 + (j + SPAN);
      const list = this.cells.get(key);
      if (list) list.push(k);
      else this.cells.set(key, [k]);
    }
    return k;
  }

  /** The things whose box may come within r of (x, y), each once, in no set order. The array is reused by the next call. */
  near(x, y, r) {
    const out = this.out;
    out.length = 0;
    const stamp = this.stamp;
    if (++this.round > 2 ** 30) { stamp.fill(0); this.round = 1; }
    const round = this.round;
    for (const k of this.always) { stamp[k] = round; out.push(k); }
    const c = this.cell, rr = r + SLACK;
    const i0 = Math.floor((x - rr) / c), i1 = Math.floor((x + rr) / c), j0 = Math.floor((y - rr) / c), j1 = Math.floor((y + rr) / c);
    if (!(i0 > -SPAN && j0 > -SPAN && i1 < SPAN && j1 < SPAN && i1 >= i0 && j1 >= j0) || (i1 - i0 + 1) * (j1 - j0 + 1) > 4096) {
      for (let k = 0; k < this.count; k++) if (stamp[k] !== round) { stamp[k] = round; out.push(k); }
      return out;
    }
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const list = this.cells.get((i + SPAN) * 65536 + (j + SPAN));
      if (list) for (const k of list) if (stamp[k] !== round) { stamp[k] = round; out.push(k); }
    }
    return out;
  }
}

/**
 * The segments of a list of paths, each grown by its path's `pad` (so a query radius can leave the pad out).
 * Segments are numbered path by path, in order along each, so sorting numbers sorts by path and then along it.
 */
export class SegGrid {
  /** paths: [[x, y], ...] polylines. pad: a number or (path index) -> number, at least 0. cell: in squares. */
  constructor(paths = [], { cell = 4, pad = 0 } = {}) {
    this.grid = new BoxGrid(cell);
    this.paths = [];
    this.pad = pad;
    this.segPath = []; // the path each segment is on
    this.segIndex = []; // where on it: the segment runs from point segIndex - 1 to point segIndex
    for (const p of paths) this.addPath(p);
  }

  /** Adds a path; returns its index. */
  addPath(path) {
    const p = this.paths.length;
    this.paths.push(path);
    const pad = Math.max(0, (typeof this.pad === "function" ? this.pad(p) : this.pad) || 0);
    for (let i = 1; i < (path?.length ?? 0); i++) {
      const a = path[i - 1], b = path[i];
      this.grid.add(Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad);
      this.segPath.push(p);
      this.segIndex.push(i);
    }
    return p;
  }

  /** Segments that may lie within r (plus their pad) of (x, y), in no set order. Reused by the next call. */
  near(x, y, r) {
    return this.grid.near(x, y, r);
  }

  /** The same, sorted: by path, then along it. */
  nearSorted(x, y, r) {
    return this.grid.near(x, y, r).sort((a, b) => a - b);
  }

  /** The distance from (x, y) to segment k. */
  dist(x, y, k) {
    const path = this.paths[this.segPath[k]], i = this.segIndex[k];
    const a = path[i - 1], b = path[i];
    return segDist(x, y, a[0], a[1], b[0], b[1]);
  }

  /**
   * For each path with a segment that may lie within r of (x, y), in path order: calls fn(path index, d), d the
   * least distance over its segments found. Where the path's true distance is under r, d is that distance exactly.
   */
  eachNear(x, y, r, fn) {
    const ids = this.nearSorted(x, y, r);
    let cur = -1, best = Infinity;
    for (const k of ids) {
      const p = this.segPath[k];
      if (p !== cur) {
        if (cur >= 0) fn(cur, best);
        cur = p;
        best = Infinity;
      }
      best = Math.min(best, this.dist(x, y, k));
    }
    if (cur >= 0) fn(cur, best);
  }
}

/**
 * True when every path is a list with no holes of points that are lists of finite numbers (so a grid sees them where
 * a full scan would). Anything else goes to the full scan, so a broken path fails the same way with or without the
 * grid.
 */
export const finitePaths = (paths) => {
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    if (!Array.isArray(p)) return false;
    for (let j = 0; j < p.length; j++) { const q = p[j]; if (!Array.isArray(q) || !Number.isFinite(q[0]) || !Number.isFinite(q[1])) return false; }
  }
  return true;
};
