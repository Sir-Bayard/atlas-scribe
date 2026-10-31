/**
 * A plan's bridges and fords sit where a road crosses water. A point placed by hand (or by an AI) is rarely exactly
 * on that crossing, so each one is snapped to the nearest place a road's center line crosses a water's center line,
 * turned to run along the road, made long enough to span the water at that angle, and (a bridge) wide enough to
 * carry the road. A crossing with no road over water near it is drawn where the plan puts it. Pure: runs anywhere.
 * Numbers are in squares.
 */

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

/** Every place a road crosses water: [{ at, roadDir, waterDir, road, water }]. roads and waters: [{ id, path, width }]. */
export function roadWaterCrossings(roads, waters) {
  const out = [];
  for (const r of roads) {
    for (let i = 1; i < (r.path?.length ?? 0); i++) {
      for (const w of waters) {
        for (let j = 1; j < (w.path?.length ?? 0); j++) {
          const hit = crossAt(r.path[i - 1], r.path[i], w.path[j - 1], w.path[j]);
          if (hit) out.push({ at: hit.p, roadDir: unit(r.path[i - 1], r.path[i]), waterDir: unit(w.path[j - 1], w.path[j]), road: r, water: w });
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
function snapTo(crossing, x) {
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
