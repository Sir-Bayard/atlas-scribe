/**
 * A plan's bridges and fords sit where a road crosses water. A point placed by hand (or by an AI) is rarely exactly
 * on that crossing, so each one is snapped to the nearest place a road's centre line crosses a water's centre line,
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
 * crossing: { at, angle, length, width, class }. Returns it snapped (a copy, with snappedTo: road id) to the nearest
 * road-over-water crossing within reach (its length, and at least 3 squares), or unchanged (snappedTo: null).
 */
export function snapCrossing(crossing, crossings) {
  const reach = Math.max(3, crossing.length ?? 0);
  let best = null, bestD = Infinity;
  for (const c of crossings) {
    const d = Math.hypot(c.at[0] - crossing.at[0], c.at[1] - crossing.at[1]);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (!best || bestD > reach) return { ...crossing, snappedTo: null };
  const [rx, ry] = best.roadDir, [wx, wy] = best.waterDir;
  const sin = Math.max(0.35, Math.abs(rx * wy - ry * wx)); // how squarely the road meets the water
  const span = (best.water.width ?? 1) / sin + 1; // water and both banks, as the painter draws them
  const out = {
    ...crossing,
    at: best.at,
    angle: (Math.atan2(ry, rx) * 180) / Math.PI,
    length: crossing.class === "ford" ? crossing.length : Math.max(crossing.length ?? 0, span),
    snappedTo: best.road.id,
  };
  if (crossing.class === "bridge") out.width = Math.max(crossing.width ?? 0, (best.road.width ?? 0) + 0.15);
  return out;
}
