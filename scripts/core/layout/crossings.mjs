/**
 * A plan's bridges and fords sit where a road crosses water. A point placed by hand (or by an AI) is rarely exactly
 * on that crossing, so each one is snapped to the nearest place a road's center line crosses a water's center line,
 * turned to run along the road, made long enough to span the water at that angle, and (a bridge) wide enough to
 * carry the road. A crossing with no road over water near it is drawn where the plan puts it. Pure: runs anywhere.
 * Numbers are in squares.
 */

import { rng } from "../rng.mjs";

/** Where segment a-b crosses segment c-d: { p, t } (t along a-b), or null. */
function crossAt(a, b, c, d) {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - a[0], qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { p: [a[0] + rx * t, a[1] + ry * t], t };
}

const unit = (a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
};

/**
 * Every place a road crosses water: [{ at, roadDir, waterDir, road, water }]. roads and waters: [{ id, path, width }],
 * a water with widths (one a point) where it varies (its water is then given the width of the stretch crossed).
 */
export function roadWaterCrossings(roads, waters) {
  const out = [];
  for (const r of roads) {
    for (let i = 1; i < (r.path?.length ?? 0); i++) {
      for (const w of waters) {
        for (let j = 1; j < (w.path?.length ?? 0); j++) {
          const hit = crossAt(r.path[i - 1], r.path[i], w.path[j - 1], w.path[j]);
          if (hit) out.push({ at: hit.p, roadDir: unit(r.path[i - 1], r.path[i]), waterDir: unit(w.path[j - 1], w.path[j]), road: r, water: w.widths ? { ...w, width: Math.max(w.widths[j - 1], w.widths[j]) } : w });
        }
      }
    }
  }
  return out;
}

/**
 * plan crossings: [{ id, at, angle, length, width, class }]. Returns a Map id -> the crossing snapped (a copy, with
 * snappedTo: road id) or unchanged (snappedTo: null). Each road-over-water point takes one crossing at most, the
 * nearest first; a crossing reaches its length, and at least 3 squares.
 */
export function snapCrossings(list, crossings) {
  const pairs = [];
  list.forEach((c, n) => crossings.forEach((x, m) => {
    const d = Math.hypot(x.at[0] - c.at[0], x.at[1] - c.at[1]);
    if (d <= Math.max(3, c.length ?? 0)) pairs.push({ n, m, d });
  }));
  pairs.sort((a, b) => a.d - b.d);
  const takenC = new Set(), takenX = new Set(), out = new Map();
  for (const { n, m } of pairs) {
    if (takenC.has(n) || takenX.has(m)) continue;
    takenC.add(n); takenX.add(m);
    out.set(list[n].id, snapTo(list[n], crossings[m]));
  }
  for (const c of list) if (!out.has(c.id)) out.set(c.id, { ...c, snappedTo: null });
  return out;
}

/** A crossing put on one road-over-water point: along the road, long enough to span the water, a bridge as wide as the road. */
export function snapTo(crossing, x) {
  const [rx, ry] = x.roadDir, [wx, wy] = x.waterDir;
  const sin = Math.max(0.35, Math.abs(rx * wy - ry * wx)); // how squarely the road meets the water
  const cos = Math.sqrt(Math.max(0, 1 - sin * sin));
  const out = { ...crossing, at: x.at, angle: (Math.atan2(ry, rx) * 180) / Math.PI, snappedTo: x.road.id };
  if (crossing.class === "bridge") out.width = Math.max(crossing.width ?? 0, (x.road.width ?? 0) + 0.15);
  if (crossing.class !== "ford") {
    // The banks as both painters draw them (the water's width + 0.95) measured along the road, plus what the deck's
    // corners need on a skew crossing, so no corner of the deck ends over water
    const span = ((x.water.width ?? 1) + 0.95) / sin + ((out.width ?? 0) * cos) / sin;
    out.length = Math.max(crossing.length ?? 0, span);
  }
  return out;
}

/** The direction of the way nearest a point, within 3 squares (else straight down the map). ways: the layout's. */
export function wayDirectionNear(ways, [x, y]) {
  let best = null, bestD = Infinity;
  for (const w of ways) {
    for (let i = 0; i < w.path.length - 1; i++) {
      const [ax, ay] = w.path[i], [bx, by] = w.path[i + 1];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      const d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
      if (d < bestD) { bestD = d; const l = Math.sqrt(l2) || 1; best = [dx / l, dy / l]; }
    }
  }
  return bestD < 3 && best ? best : [0, 1];
}

/**
 * A ford's look, chosen here so the painter makes no choices: the road's direction through it (dir), its rocks when
 * frozen ({ x, y, size, turn, corners: [share of size] }) and its stepping stones ({ x, y, size, rot, cap }), from
 * its own stream. c: the crossing item; ways: the layout's ways.
 */
export function fordDetail(c, ways) {
  const [fx, fy] = c.at;
  const fa = (c.angle * Math.PI) / 180;
  const dir = wayDirectionNear(ways, c.at);
  const rx = (c.width ?? 2) * 1.15, ry = rx * 0.54;
  const along = (t) => [fx + dir[0] * t, fy + dir[1] * t];
  const r = rng(c.id, "ford");
  const rocks = [], stones = [];
  if (c.frozen) for (let i = 0; i < 14; i++) {
    const t = r.next() * Math.PI * 2, rr = 1 + r.next() * 0.35;
    const x = fx + Math.cos(t) * rx * rr * Math.cos(fa) - Math.sin(t) * ry * rr * Math.sin(fa);
    const y = fy + Math.cos(t) * rx * rr * Math.sin(fa) + Math.sin(t) * ry * rr * Math.cos(fa);
    const size = 0.25 + r.next() * 0.45, turn = r.next() * 3;
    const nv = 5 + Math.floor(r.next() * 3);
    rocks.push({ x, y, size, turn, corners: Array.from({ length: nv }, () => 0.3 + r.next() * 0.25) });
  }
  for (let i = 0; i < 16; i++) {
    const [sx, sy] = along(-1.2 + r.next() * 2.4);
    const x = sx + (r.next() - 0.5) * 0.9 * -dir[1], y = sy + (r.next() - 0.5) * 0.9 * dir[0];
    const size = 0.04 + r.next() * 0.09, rot = r.next() * 3;
    stones.push({ x, y, size, rot, cap: r.next() < 0.6 });
  }
  return { dir, rocks, stones };
}
