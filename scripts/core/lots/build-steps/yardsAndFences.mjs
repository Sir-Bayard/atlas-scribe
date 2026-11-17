// One step of building on a district's plots (lots/build.mjs, buildOnLots): ctx holds what the steps share.
import { USE_INFO } from "../../uses.mjs";
import { cleanRing, distToSeg, joinBounds, mergeCollinear, partCorners } from "../build.mjs";
import { pointInPolygon } from "../../geom.mjs";

/**
 * What a trade leaves in its yard: its clutter, tanning or dyeing pits, a kiln
 */
export function yardsAndFences(ctx) {
  const { lots, out, r, sq, yards } = ctx;
  for (const y of yards) {
    const info = USE_INFO[y.use] ?? {};
    const yr = r.fork("yard", y.i);
    const span = y.to - y.from;
    if (span < sq(8)) continue;
    const rects = y.parts ?? [...out.houses.filter((h) => h.lot === y.i), ...out.outbuildings.filter((h) => h.lot === y.i)].map((h) => partCorners(h.building));
    const taken = [];
    const lotPoly = y.poly ?? lots[y.i].poly; // a joined site's whole yard
    const free = (x, yy, rad) => pointInPolygon([x, yy], lotPoly) && !rects.some((q) => pointInPolygon([x, yy], q) || q.some((c, k) => distToSeg([x, yy], c, q[(k + 1) % q.length]) < rad)) && !taken.some(([px, py, pr]) => Math.hypot(px - x, py - yy) < rad + pr);
    const spot = (rad) => {
      for (let k = 0; k < 12; k++) {
        const [x, yy] = y.at((yr.next() - 0.5) * y.width, y.from + rad + yr.next() * Math.max(0, span - 2 * rad));
        if (free(x, yy, rad)) { taken.push([x, yy, rad]); return [x, yy]; }
      }
      return null;
    };
    if (info.kiln) {
      const rad = sq(7 + yr.next() * 3), p = spot(rad);
      if (p) out.kilns.push({ x: p[0], y: p[1], rad, use: y.use });
    }
    if (info.pits) {
      // A grid of pits square to the plot, as many as fit
      const size = sq(6), step = sq(9);
      const cols = Math.max(1, Math.min(4, Math.floor((y.width * 0.8) / step))), rows = Math.max(1, Math.min(3, Math.floor((span * 0.7) / step)));
      for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
        const [x, yy] = y.at((a - (cols - 1) / 2) * step, y.from + sq(5) + b * step);
        if (!free(x, yy, size * 0.75)) continue;
        taken.push([x, yy, size * 0.6]);
        out.pits.push({ x, y: yy, size, rot: y.rot, liquid: info.pits === "dye" ? ["blue", "red", "yellow", "green"][yr.int(4)] : info.pits });
      }
    }
    const things = [...(info.yard ?? []), ...(y.inn ? ["wagon", "hay", "barrel"] : [])];
    const extra = yr.int(2), n = things.length ? Math.min(things.length + extra, 5) : 0; // (a use with no yard things leaves none)
    for (let k = 0; k < n; k++) {
      const cls = things[k % things.length];
      const p = spot(sq(cls === "wagon" || cls === "cart" ? 7 : 3));
      if (p) out.props.push({ class: cls, x: p[0], y: p[1], rot: y.rot + (yr.next() - 0.5) * 40 + (yr.next() < 0.5 ? 90 : 0), variant: yr.int(8) });
    }
  }
  // Neighbors' fences on the same line become one fence (their pieces overlap with staggered ends otherwise)
  out.bounds = joinBounds(mergeCollinear(out.bounds));
  // Each building's outline cleaned once, where it's made: no corner twice, no spike
  for (const h of [...out.houses, ...out.outbuildings]) if (Array.isArray(h.building?.shape)) h.building.shape = cleanRing(h.building.shape);
  return out;
}
