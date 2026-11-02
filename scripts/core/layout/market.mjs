/**
 * Market stalls: awnings in loose double rows, back to back, with walking lanes between, a few gaps, and crates,
 * barrels and sacks set out in front of some. Used for a square with Market stalls on and for a market quarter's
 * square. Stalls are drawn a little larger than life (GRAND), as the centerpieces are, so a market reads on a map of
 * a whole town. Pure: runs anywhere. Numbers are in squares unless they say feet.
 */
import { CLUTTER_FT } from "../uses.mjs";

/** How wide a stall's art is drawn when its scale is 1, in squares (its 10 ft side at 25 ft a square). */
export const STALL_SQUARES = 0.4;
/** How much larger than life stalls are drawn. */
export const GRAND = 1.4;

/**
 * Stalls in an area. at: a point inside it; angle: the rows' direction (degrees); reach: how far out from at to
 * look (squares); inside(p): in the area; clear(p): free of roads, water and what's there; r: a stream; sq: feet a
 * square. Returns props: { class, x, y, rot, variant, scale } (stall, stall-long, crate, barrel, sacks).
 */
export function marketStalls({ at, angle, reach, inside, clear, r, sq }) {
  const s = (ft) => (ft * GRAND) / sq;
  const a = (angle * Math.PI) / 180, U = [Math.cos(a), Math.sin(a)], V = [-Math.sin(a), Math.cos(a)];
  const P = (u, v) => [at[0] + U[0] * u + V[0] * v, at[1] + U[1] * u + V[1] * v];
  const dep = s(10), lane = s(r.range(8, 11)), pitch = 2 * dep + lane;
  const out = [];
  // A box's corners and middle, a hair inside, all inside the area and clear
  const fits = (u, v, len, d) => {
    const pts = [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1], [-1, 0], [1, 0]].map(([i, j]) => P(u + (i * len) / 2 * 0.96, v + (j * d) / 2 * 0.96));
    return pts.every((p) => inside(p) && clear(p));
  };
  const start = -reach + r.next() * pitch;
  for (let v = start; v <= reach; v += pitch) {
    for (const side of [-1, 1]) {
      const vc = v + (side * dep) / 2; // back to back along the row's middle
      for (let u = -reach + r.next() * s(10); u <= reach; ) {
        const long = r.chance(0.35), len = long ? s(15) : s(10), gap = s(r.range(1, 3)), skip = r.chance(0.12);
        const tint = r.int(18), tilt = (r.next() - 0.5) * 6, goods = r.chance(0.35), what = r.pick(["crate", "barrel", "sacks", "crate", "sacks"]);
        const off = (r.next() - 0.5) * len * 0.6;
        if (!skip && fits(u + len / 2, vc, len, dep)) {
          const [x, y] = P(u + len / 2, vc);
          // (a long stall's art is 2 by 3, drawn across its short side and turned to lie along the row)
          out.push({ class: long ? "stall-long" : "stall", x, y, rot: angle + (long ? 90 : 0) + tilt, variant: tint, scale: dep / STALL_SQUARES });
          if (goods) {
            const g = P(u + len / 2 + off, vc + side * (dep / 2 + s(3)));
            if (inside(g) && clear(g)) out.push({ class: what, x: g[0], y: g[1], rot: r.next() * 360, variant: r.int(8), scale: ((CLUTTER_FT[what] ?? 4) * GRAND) / sq / 0.45 });
          }
        }
        u += len + gap;
      }
    }
  }
  return out;
}
