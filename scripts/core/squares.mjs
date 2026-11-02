/**
 * Squares for Quick Start: the paving a square is laid in, and its shape (a circle, a rectangle along the main road,
 * an irregular market place, a triangle where the roads fork, or the main road widened into a market street). Pure:
 * runs anywhere. Numbers are in squares.
 */

/** The pavings a paved square or plaza is laid in. */
export const PAVINGS = ["cobble", "setts", "flagstone", "herringbone", "brick", "tiles"];

/** The ground of a square in a place whose roads aren't paved. */
export const UNPAVED = ["dirt", "trodden", "gravel"];

/** The shapes a Quick Start square can take. */
export const SQUARE_SHAPES = ["circle", "rect", "irregular", "triangle", "street"];

const r2 = (v) => Math.round(v * 100) / 100;

/**
 * A square's shape: { kind, shape (a plan shape: { circle } or a polygon), radial (whether streets should ring it) }.
 * r: a stream; C: its middle; angle: the main road's direction there (radians); rad: about how far it reaches from
 * its middle; fork: the roads fork there (a triangle is likely); kinds: the shapes to pick from; arms: the directions
 * (radians) the roads leave its middle, for a triangle's corners.
 */
export function squareShape({ r, C, angle, rad, fork = false, kinds = SQUARE_SHAPES, arms = null }) {
  const roll = r.next(), jit = Array.from({ length: 8 }, () => r.range(0.78, 1.18)), turn = r.range(-0.25, 0.25), long = r.range(1.9, 2.6);
  const pool = kinds.filter((k) => k !== "triangle" || fork);
  // A fork leans to a triangle; else each shape about as likely
  const leans = fork && pool.includes("triangle");
  const kind = leans && roll < 0.45 ? "triangle" : pool[Math.min(pool.length - 1, Math.floor((leans ? (roll - 0.45) / 0.55 : roll) * pool.length))] ?? "circle";
  const U = [Math.cos(angle), Math.sin(angle)], V = [-U[1], U[0]];
  const at = (u, v) => [r2(C[0] + U[0] * u + V[0] * v), r2(C[1] + U[1] * u + V[1] * v)];
  switch (kind) {
    case "rect": {
      const a = rad * 1.25, b = rad * 0.85;
      return { kind, shape: [at(-a, -b), at(a, -b), at(a, b), at(-a, b)], radial: true };
    }
    case "irregular": {
      // Corners around it at uneven distances, a little off even spacing (never crossing: the angles stay in order)
      const n = 6 + Math.min(2, Math.floor(((jit[0] - 0.78) / 0.4) * 3)); // (six to eight corners)
      return { kind, shape: Array.from({ length: n }, (_, k) => { const a = angle + turn + ((k + (jit[k % 8] - 1) * 0.6) / n) * 2 * Math.PI, d = rad * jit[(k + 3) % 8]; return [r2(C[0] + Math.cos(a) * d), r2(C[1] + Math.sin(a) * d)]; }), radial: true };
    }
    case "triangle": {
      // A corner between each two of the three roads, so each road leaves through the middle of a side (without the
      // roads' directions: one side across the main road)
      const d = rad * 1.35, TAU = 2 * Math.PI;
      const sorted = Array.isArray(arms) && arms.length === 3 ? arms.map((a) => ((a % TAU) + TAU) % TAU).sort((a, b) => a - b) : null;
      const corners = sorted ? sorted.map((a, k) => { const b = k < 2 ? sorted[k + 1] : sorted[0] + TAU; return (a + b) / 2 + turn * 0.15; }) : [0, 1, 2].map((k) => angle + Math.PI + turn * 0.5 + (k * TAU) / 3);
      return { kind, shape: corners.map((a) => [r2(C[0] + Math.cos(a) * d), r2(C[1] + Math.sin(a) * d)]), radial: false };
    }
    case "street": {
      // The main road widened into a long market place
      const a = rad * long, b = rad * 0.62;
      return { kind, shape: [at(-a, -b), at(a, -b), at(a, b), at(-a, b)], radial: false };
    }
    default:
      return { kind: "circle", shape: { circle: [r2(C[0]), r2(C[1]), rad] }, radial: true };
  }
}
