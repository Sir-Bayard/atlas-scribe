/**
 * Meandering rivers for Quick Start: a line whose heading swings slowly from side to side about a direction (a sine
 * generated curve, the shape real rivers take in their bends), with a smaller swing on top so no two bends are alike.
 * Pure: runs anywhere. Numbers are in squares.
 */

const TAU = 2 * Math.PI;

/** Where segment a-b leaves the box [0, W] x [0, H] (a inside, b outside), or b when it doesn't. */
function exitAt(a, b, W, H) {
  let t = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (b[0] < 0) t = Math.min(t, -a[0] / dx);
  if (b[0] > W) t = Math.min(t, (W - a[0]) / dx);
  if (b[1] < 0) t = Math.min(t, -a[1] / dy);
  if (b[1] > H) t = Math.min(t, (H - a[1]) / dy);
  t = Math.max(0, Math.min(1, t));
  return [a[0] + dx * t, a[1] + dy * t];
}

const onMap = (p, W, H) => p[0] >= 0 && p[1] >= 0 && p[0] <= W && p[1] <= H;

/**
 * The bends of a meander, drawn from r: a wavelength wave (squares), the heading's swing either side (radians) and a
 * second, shorter swing on top. size: how big the bends are against (a city's wall radius, a town's map); gentle
 * gives wider, softer bends (a river split around an island, say).
 */
export function bends(r, size, { gentle = false } = {}) {
  return {
    wave: size * r.range(1.3, 2),
    swing: gentle ? r.range(0.25, 0.5) : r.range(0.6, 1.15),
    wave2: size * r.range(0.45, 0.65),
    swing2: r.range(0.12, 0.28),
    phase: r.next() * TAU,
    phase2: r.next() * TAU,
  };
}

/**
 * A meandering line through P, its mean heading angle (radians), run both ways to the map's edge (or only forward
 * with oneWay): a point every step squares, from the back end to the front, the end points on the edge. b: from bends.
 */
export function meander(P, angle, W, H, b, { step = 1.5, oneWay = false } = {}) {
  const heading = (s) => angle + b.swing * Math.sin((TAU * s) / b.wave + b.phase) + b.swing2 * Math.sin((TAU * s) / b.wave2 + b.phase2);
  const most = Math.ceil((4 * (W + H)) / step);
  const run = (sign) => {
    const pts = [P];
    let p = P;
    for (let k = 1; k <= most; k++) {
      const s = sign * (k - 0.5) * step, h = heading(s);
      const q = [p[0] + sign * Math.cos(h) * step, p[1] + sign * Math.sin(h) * step];
      if (!onMap(q, W, H)) { pts.push(exitAt(p, q, W, H)); break; }
      pts.push(q);
      p = q;
    }
    return pts;
  };
  const front = run(1);
  if (oneWay) return front;
  return [...run(-1).reverse(), ...front.slice(1)];
}
