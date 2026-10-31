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
  const tensor = (x, y) => {
    let a = Math.cos(ax) * BASE, b = Math.sin(ax) * BASE;
    for (const l of lines) {
      const { d, ang } = nearestOnPath([x, y], l.path);
      const w = Math.exp(-((d / l.reach) ** 2));
      if (w < 1e-4) continue;
      a += Math.cos(2 * ang) * w;
      b += Math.sin(2 * ang) * w;
    }
    for (const r of radials) {
      const dx = x - r.at[0], dy = y - r.at[1];
      const dist = Math.hypot(dx, dy);
      const out = Math.max(0, dist - r.radius);
      const w = Math.exp(-((out / r.reach) ** 2)) * 1.2;
      if (w < 1e-4 || dist < 1e-6) continue;
      // Rings round the square: the direction square to the line from its center
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
