/**
 * The tensor field that steers generated streets (after Chen et al., Interactive Procedural Street Modeling,
 * 2008). At each point it gives the direction main streets run; cross streets run square to it.
 *
 * A direction field can't tell a street running north from one running south, and main from cross streets are a
 * quarter turn apart, so the field stores each direction as a tensor: angle t is kept as (cos 2t, sin 2t) times a
 * weight. Tensors from several sources add up smoothly, and the major direction is half the summed angle.
 *
 * Sources, each fading with distance: the plan's roads (streets run along and across them), rivers (along and
 * across the bank), radial squares (streets ring them and spoke out), and the district's own axis, which wins
 * only where nothing else is near. A smooth seeded wobble then turns the result by up to `bend` degrees.
 * Everything in squares. Pure: runs anywhere.
 */
import { makeNoise } from "../noise.mjs";
import { finitePaths } from "../spatial.mjs";

/** The nearest point on a path, and the direction of the segment it's on. Returns { d, ang }. */
function nearestOnPath([x, y], path) {
  let best = Infinity, ang = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i], [bx, by] = path[i + 1];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    if (!l2) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    const px = ax + t * dx - x, py = ay + t * dy - y;
    const d = px * px + py * py;
    if (d < best) { best = d; ang = Math.atan2(dy, dx); }
  }
  return { d: Math.sqrt(best), ang };
}

/**
 * Builds the field. lines: [{ path, reach }] (roads and rivers; reach is how far, in squares, a line's pull
 * carries); radials: [{ at: [x, y], radius, reach }]; axis: the base angle in degrees; bend: the wobble in
 * degrees; seed and key for the wobble's noise; wobble: its scale in squares.
 * Returns { tensor(x, y) -> [a, b], major(x, y) -> angle in radians, minor(x, y) }.
 */
export function makeField({ lines = [], radials = [], axis = 0, bend = 0, seed = 1, key = "field", wobble = 14 }) {
  const noise = bend ? makeNoise(seed, key, { scale: wobble }) : null;
  const ax = 2 * axis * (Math.PI / 180);
  const BASE = 0.04; // the axis's weight: it matters only where every other source has faded
  // A line's pull is under 1e-4 (and left out) beyond 3.04 times its reach, and a long line has a great many
  // segments. So each line is split into runs of segments with a box around each run: only runs whose box could hold
  // a nearer segment than the best found so far, within 3.1 reaches, are measured. On a tie the earlier segment wins,
  // so the result matches a full scan to the last bit. Lines with a broken point or reach are scanned in full.
  const dense = Array.isArray(lines) && Object.keys(lines).length === lines.length; // a list with no holes
  const gridded = dense && lines.every((l) => Number.isFinite(l?.reach) && l.reach > 0) && finitePaths(lines.map((l) => l.path));
  const runsOf = (path) => {
    const n = Math.max(0, path.length - 1), size = Math.max(4, Math.ceil(Math.sqrt(n)));
    const runs = [];
    for (let s0 = 1; s0 <= n; s0 += size) {
      const s1 = Math.min(n, s0 + size - 1);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = s0 - 1; i <= s1; i++) { const [px, py] = path[i]; x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
      runs.push({ s0, s1, x0, y0, x1, y1 });
    }
    runs.scale = path.reduce((m, [px, py]) => Math.max(m, Math.abs(px), Math.abs(py)), 0); // the line's size, for the slack
    return runs;
  };
  const boxes = gridded ? lines.map((l) => runsOf(l.path)) : null;
  const pull = (l, d, ang, sum) => {
    const w = Math.exp(-((d / l.reach) ** 2));
    if (w < 1e-4) return;
    sum[0] += Math.cos(2 * ang) * w;
    sum[1] += Math.sin(2 * ang) * w;
  };
  const lb = new Float64Array(64);
  /** A line's nearest segment to (x, y): { d, ang } as nearestOnPath gives them, when within its cutoff. */
  const nearest = (runs, l, x, y) => {
    const path = l.path, far = l.reach * 3.1;
    let best = Infinity, bestK = -1, ang = 0, first = -1;
    // Each run's least possible squared distance, a hair under, so rounding never skips a run that holds the nearest.
    // The hair grows with the numbers' size: far from 0, rounding errors are bigger than any fixed slack
    const slack = 1e-9 + 1e-12 * (Math.max(runs.scale, Math.abs(x), Math.abs(y)) + far);
    const bound = runs.length <= lb.length ? lb : new Float64Array(runs.length);
    for (let j = 0; j < runs.length; j++) {
      const b = runs[j];
      const dx = Math.max(b.x0 - x, 0, x - b.x1), dy = Math.max(b.y0 - y, 0, y - b.y1);
      const m = Math.max(0, Math.hypot(dx, dy) - slack);
      bound[j] = m > far ? Infinity : m * m;
      if (bound[j] !== Infinity && (first < 0 || bound[j] < bound[first])) first = j;
    }
    if (first < 0) return { d: Infinity, ang: 0 };
    const scan = (b) => {
      for (let i = b.s0; i <= b.s1; i++) {
        const [ax0, ay0] = path[i - 1], [bx, by] = path[i];
        const dx = bx - ax0, dy = by - ay0, l2 = dx * dx + dy * dy;
        if (!l2) continue;
        const t = Math.max(0, Math.min(1, ((x - ax0) * dx + (y - ay0) * dy) / l2));
        const px = ax0 + t * dx - x, py = ay0 + t * dy - y;
        const d = px * px + py * py;
        if (d < best || (d === best && i < bestK)) { best = d; bestK = i; ang = Math.atan2(dy, dx); }
      }
    };
    scan(runs[first]);
    for (let j = 0; j < runs.length; j++) if (j !== first && bound[j] <= best) scan(runs[j]);
    return { d: Math.sqrt(best), ang };
  };
  const tensor = (x, y) => {
    const sum = [Math.cos(ax) * BASE, Math.sin(ax) * BASE];
    if (boxes) for (let n = 0; n < lines.length; n++) { const { d, ang } = nearest(boxes[n], lines[n], x, y); pull(lines[n], d, ang, sum); }
    else for (const l of lines) { const { d, ang } = nearestOnPath([x, y], l.path); pull(l, d, ang, sum); }
    let [a, b] = sum;
    for (const r of radials) {
      const dx = x - r.at[0], dy = y - r.at[1];
      const dist = Math.hypot(dx, dy);
      const out = Math.max(0, dist - r.radius);
      const w = Math.exp(-((out / r.reach) ** 2)) * 1.2;
      if (w < 1e-4 || dist < 1e-6) continue;
      // Rings around the square: the direction square to the line from its center
      const ang = Math.atan2(dy, dx) + Math.PI / 2;
      a += Math.cos(2 * ang) * w;
      b += Math.sin(2 * ang) * w;
    }
    if (noise) {
      const turn = 2 * noise(x, y) * bend * (Math.PI / 180);
      const c = Math.cos(turn), s = Math.sin(turn);
      [a, b] = [a * c - b * s, a * s + b * c];
    }
    return [a, b];
  };
  const major = (x, y) => {
    const [a, b] = tensor(x, y);
    return Math.atan2(b, a) / 2;
  };
  return { tensor, major, minor: (x, y) => major(x, y) + Math.PI / 2 };
}
