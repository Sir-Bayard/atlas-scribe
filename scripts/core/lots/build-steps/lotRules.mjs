// One step of building on a district's plots (lots/build.mjs, buildOnLots): ctx holds what the steps share.
import { SegGrid, finitePaths } from "../../spatial.mjs";
import { area, difference, intersect, offset, union } from "../poly.mjs";
import { distToPath, distToSeg, fitsIn, fitsTight, grown, roofPalette, roofStyles, tidy } from "../build.mjs";
import { gardenShare as gardenShareOf } from "../../character.mjs";
import { lotTypeOf } from "../index.mjs";
import { pointInPolygon, polygonsOverlap } from "../../geom.mjs";

/** The longest a row house's part may be, in its depths. */
const ROW_LONGEST = 4;

/**
 * In the plot, clear of anything it was cut around and of every street (points along each side too, since a street
 * may bend at a house). The ways' segments sit in a grid so each test looks only at nearby streets (a way with a
 * broken point or width is tested the slow way)
 */
export function lotRules(ctx) {
  const { blocked, district, ftPerSquare, r, ways } = ctx;
  const exact = finitePaths(ways.map((w) => w.path)) && ways.every((w) => Number.isFinite(w.width));
  // (each way's segments padded by its own half width and a little, so a lookup is by the point alone: one very wide
  // road doesn't widen every lookup)
  const grid = exact ? new SegGrid(ways.map((w) => w.path), { pad: (p) => ways[p].width / 2 + 0.11 }) : null;
  const clearAt = grid
    ? (x, y) => { for (const k of grid.near(x, y, 0)) if (!(grid.dist(x, y, k) >= ways[grid.segPath[k]].width / 2 - 0.005)) return false; return true; }
    : (x, y) => ways.every((w) => distToPath([x, y], w.path) >= w.width / 2 - 0.005);
  const clearOfWays = (pts) => pts.every((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return [0, 0.25, 0.5, 0.75].every((t) => clearAt(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t));
  });
  /** True when the point is within 0.1 of a way's edge line. */
  const onWayEdge = grid
    ? (mid) => { let hit = false; grid.eachNear(mid[0], mid[1], 0, (p, d) => { if (Math.abs(d - ways[p].width / 2) < 0.1) hit = true; }); return hit; }
    : (mid) => ways.some((w) => Math.abs(distToPath(mid, w.path) - w.width / 2) < 0.1); ctx.onWayEdge = onWayEdge;
  // Battle maps: buildings a square apart, so there's always room to walk between two; each keeps half a square off
  // its plot's sides and back (roomOf), and a shed or stable a square off what else is on its plot (clearHere)
  const apart = district.battleScale ? 1 : 0; ctx.apart = apart;
  // (and a square off a named building, square or yard kept clear inside a block, where the plot runs around it)
  const keepOff = apart ? blocked.filter((b) => b.length >= 3).map((b) => grown(b, apart)) : blocked;
  const fits = (pts, poly) => !!poly && (apart ? fitsTight : fitsIn)(pts, poly) && clearOfWays(pts) && !keepOff.some((b) => polygonsOverlap(pts, b)); ctx.fits = fits;
  /** Where a plot's buildings may stand: the plot, or on a battle map the plot kept half a square in from its sides and back. */
  const roomOf = (lot) => {
    if (!apart) return lot.poly;
    const h = apart / 2 + 0.03; // (and the hair fitsTight allows)
    const [ax, ay] = lot.front.a, [bx, by] = lot.front.b, [nx, ny] = lot.inward;
    const L = Math.hypot(bx - ax, by - ay);
    const keep = offset([lot.poly], -h);
    // (the front, half a square short of each end, kept right to the street)
    let pieces = keep;
    if (L > 2 * h) {
      const ux = (bx - ax) / L, uy = (by - ay) / L;
      const p0 = [ax + ux * h, ay + uy * h], p1 = [bx - ux * h, by - uy * h], deep = h + 0.05;
      const band = [[p0[0] - nx, p0[1] - ny], [p1[0] - nx, p1[1] - ny], [p1[0] + nx * deep, p1[1] + ny * deep], [p0[0] + nx * deep, p0[1] + ny * deep]];
      pieces = union(keep, intersect([lot.poly], [band]));
    }
    return pieces.reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
  }; ctx.roomOf = roomOf;
  /**
   * A city row's parts on a plot, each { poly, rot, depth }: the plot's front, as deep as d, then (twice at most)
   * the longest stretch of what's left of it along a street (its side at a corner, its back on a plot through the
   * block), as deep again. None when the front is a poor fit (a narrow wedge at a sharp corner), so the plot takes
   * an ordinary house instead.
   */
  const rowParts = (lot, d) => {
    const [ux, uy] = lot.along, [nx, ny] = lot.inward, [mx, my] = lot.front.mid;
    const big = (ps) => ps.reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
    // A band square to a direction (u along it, n across it), from s0 to s1 out from a point
    const band = ([px, py], [ex, ey], [qx, qy], s0, s1) => [[px + qx * s0 - ex * 99, py + qy * s0 - ey * 99], [px + qx * s0 + ex * 99, py + qy * s0 + ey * 99], [px + qx * s1 + ex * 99, py + qy * s1 + ey * 99], [px + qx * s1 - ex * 99, py + qy * s1 - ey * 99]];
    const deg = (ex, ey) => (Math.atan2(ey, ex) * 180) / Math.PI;
    // (thin fingers and sharp wedges, where a plot's cut met its neighbor's at a slant, trimmed off: a footprint no
    // narrower anywhere than a few feet)
    const firm = (p) => { const q = big(intersect(offset(offset([p], -sq(3)), sq(3)), [p])); return q && area(q) > area(p) * 0.8 ? tidy(q) : tidy(p); };
    // (a part at most ROW_LONGEST times as long as it's deep: past that, the stretch of it holding the most is kept, and
    // the rest of the plot, a sharp corner's tip, is left a yard)
    const capped = (poly, e, q) => {
      // (by the part's mean depth, which a wedge's narrowing makes less than d)
      const proj = poly.map((p) => p[0] * e[0] + p[1] * e[1]), lo = Math.min(...proj), L = Math.max(...proj) - lo;
      const most = ROW_LONGEST * Math.min(d, area(poly) / (L || 1));
      if (L <= most) return poly;
      // (the band anchored across the part itself: it reaches only 99 squares either side of its anchor)
      const mq = poly.reduce((s, p) => s + p[0] * q[0] + p[1] * q[1], 0) / poly.length, at = [q[0] * mq, q[1] * mq];
      let best = null;
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const s0 = lo + (L - most) * t, piece = big(intersect([poly], [band(at, q, e, s0, s0 + most)]));
        if (piece && (!best || area(piece) > area(best))) best = piece;
      }
      return best ? firm(best) : poly;
    };
    const cut = band([mx, my], [ux, uy], [nx, ny], -1, d);
    const front = big(intersect([lot.poly], [cut]));
    const least = sq(12) * sq(12);
    if (!front || area(front) < least || area(front) < 0.55 * lot.frontage * d) return [];
    // (a plot may hold a hole: a named building, square or yard kept clear inside it; a row never covers one)
    const clear = (p) => !blocked.some((b) => b.length >= 3 && polygonsOverlap(p, b));
    const parts = [{ poly: capped(firm(front), [ux, uy], [nx, ny]), rot: deg(ux, uy), depth: d }];
    if (!clear(parts[0].poly)) return [];
    let rest = difference([lot.poly], [cut]);
    for (let k = 0; k < 2; k++) {
      let best = null;
      for (const piece of rest) {
        if (area(piece) < least) continue;
        const n = piece.length;
        const on = piece.map((p, j) => { const q = piece[(j + 1) % n]; return Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-6 && onWayEdge([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]); });
        const start = on.findIndex((v, j) => v && !on[(j + n - 1) % n]);
        if (start < 0) continue;
        // Runs of edges one after another along a street, each taken by its ends
        let run = null;
        for (let t = 0; t < n; t++) {
          const j = (start + t) % n;
          if (!on[j]) { run = null; continue; }
          if (!run) run = { piece, a: piece[j] };
          run.b = piece[(j + 1) % n];
          const L = Math.hypot(run.b[0] - run.a[0], run.b[1] - run.a[1]);
          if (L >= sq(16) && (!best || L > best.L)) best = { ...run, L };
        }
      }
      if (!best) break;
      const { piece, a, b, L } = best;
      const e = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      // Its inward side: toward the middle of the piece it's on
      const [gx, gy] = piece.reduce((s, p) => [s[0] + p[0] / piece.length, s[1] + p[1] / piece.length], [0, 0]);
      let q = [-e[1], e[0]];
      if ((gx - a[0]) * q[0] + (gy - a[1]) * q[1] < 0) q = [-q[0], -q[1]];
      const along = band(a, e, q, -1, d);
      const strip = big(intersect([piece], [along]));
      if (!strip || area(strip) < least || area(strip) < 0.5 * L * d) break;
      const part = capped(firm(strip), e, q);
      if (!clear(part)) break;
      parts.push({ poly: part, rot: deg(e[0], e[1]), depth: d });
      rest = difference(rest, [along]);
    }
    return parts;
  }; ctx.rowParts = rowParts;
  /** True when the point is in a blocked shape or within 0.15 of its edge. */
  const byBlocked = (mid) => blocked.some((b) => b.length >= 3 && (pointInPolygon(mid, b) || b.some((c, k) => distToSeg(mid, c, b[(k + 1) % b.length]) < 0.15))); ctx.byBlocked = byBlocked;
  const T = lotTypeOf(district); ctx.T = T;
  const sq = (ft) => ft / ftPerSquare; ctx.sq = sq;
  const spacious = Math.max(0, Math.min(1, district.spacious ?? 0)); ctx.spacious = spacious;
  const density = district.density ?? 1; ctx.density = density;
  const gardenShare = gardenShareOf(district); ctx.gardenShare = gardenShare;
  // (wallSite: the site each wall walls in, by its main house's id, one for each of walls)
  const out = { houses: [], outbuildings: [], gardens: [], crofts: [], bounds: [], trees: [], props: [], surfaces: [], pits: [], kilns: [], walls: [], wallSite: [] }; ctx.out = out;

  const workUse = (u) => u && u !== "house" && u !== "shop" && u !== "magic-shop"; ctx.workUse = workUse;
  const yards = []; ctx.yards = yards; // the yards of plots put to a trade: { i, use, at, from, to, width }
  const wayById = new Map(ways.map((w) => [w.id, w])); ctx.wayById = wayById;
  const boundClass = (lr) => (district.profile === "hamlet" || district.profile === "roadside" ? (lr.next() < 0.5 ? "hedge" : "wall") : lr.next() < 0.8 ? "fence" : "wall"); ctx.boundClass = boundClass;

  ctx.croftOf = -1;
  /** A polygon's edges as boundary segments, except those along a street. */
  const addBounds = (p, way, cls, skip = null) => {
    for (let k = 0; k < p.length; k++) {
      const a = p[k], b = p[(k + 1) % p.length];
      if (skip?.(a, b)) continue;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      // Never along a street: this plot's own, or another one at its back or side
      if (onWayEdge(mid)) continue;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.02) continue;
      out.bounds.push({ path: [a, b], class: cls });
    }
  }; ctx.addBounds = addBounds;

  const palette = roofPalette(district, T, r), styles = roofStyles(district, T); ctx.styles = styles; ctx.palette = palette;
}
