// One step of making a city's plan from Quick Start's choices (quick-city.mjs, cityPlan): ctx holds what the steps share.
import { distanceToPath, pointInPolygon, shapeToPolygon } from "../geom.mjs";
import { densify, r1 } from "../quick-city.mjs";
import { rng } from "../rng.mjs";

/**
 * Open ground inside the wards: a nobles' ward lays out a formal garden, and now and then a homes or merchants' ward
 * keeps a green. Each stands clear of the ward's edge (so its streets run around it), the roads and the water; one
 * with no room is left out. From a stream of its own, so the rest of the city doesn't move.
 */
export function cityGreens(ctx) {
  const { S, districts, inWater, roads, seed } = ctx;
  const r = rng(seed, "quick", "city-greens");
  const greens = [];
  ctx.greens = greens;
  for (const d of districts) {
    const kind = d.character === "nobles" ? "formal" : (!d.character || d.character === "merchants") && r.fork("roll", d.id).next() < 0.3 ? "green" : null;
    if (!kind) continue;
    const gr = r.fork("place", d.id);
    const [len, dep] = kind === "formal" ? [S.square * gr.range(1.6, 2.1), S.square * gr.range(1.1, 1.4)] : [S.square * gr.range(1.0, 1.4), S.square * gr.range(0.8, 1.1)];
    const at = placeGreen({ poly: d.shape, len, dep, roads, inWater, r: gr });
    if (at) greens.push({ id: `${d.id}-${kind === "formal" ? "garden" : "green"}`, type: "area", class: "park", style: kind, ...(d.name ? { name: `${d.name.replace(/ Ward( II| III)?$/, "")} ${kind === "formal" ? "Gardens" : "Green"}` } : {}), ...at });
  }
}

/**
 * Where a green or garden of len by dep squares fits in a district (poly): two squares in from its edge (so streets run
 * around it), clear of the roads by clear squares and of the water, laid along the nearest road. Returns { shape, rot }
 * (rot left out when 0), or null when 40 tries find no room. r: its own stream.
 */
export function placeGreen({ poly, len, dep, roads, inWater = () => false, r, clear = 2.5 }) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const edge = [...poly, poly[0]];
  for (let t = 0; t < 40; t++) {
    const c = [x0 + r.next() * (x1 - x0), y0 + r.next() * (y1 - y0)];
    if (!pointInPolygon(c, poly)) continue;
    let best = null;
    for (const rd of roads) for (let i = 1; i < rd.path.length; i++) {
      const dd = distanceToPath(c, [rd.path[i - 1], rd.path[i]]);
      if (!best || dd < best.dd) best = { dd, a: Math.atan2(rd.path[i][1] - rd.path[i - 1][1], rd.path[i][0] - rd.path[i - 1][0]) };
    }
    const rot = best ? Math.round((((best.a * 180) / Math.PI) % 180 + 180) % 180) % 180 : 0;
    const shape = { rect: [r1(c[0] - len / 2), r1(c[1] - dep / 2), r1(c[0] + len / 2), r1(c[1] + dep / 2)] };
    const ring = shapeToPolygon(shape, rot);
    if (!ring.every((q) => pointInPolygon(q, poly) && distanceToPath(q, edge) >= 2)) continue;
    const around = densify([...ring, ring[0]], 0.5);
    if (roads.some((rd) => around.some((q) => distanceToPath(q, rd.path) < clear) || densify(rd.path, 0.5).some((q) => pointInPolygon(q, ring)))) continue;
    if (around.some((q) => inWater(q)) || inWater(c)) continue;
    return { ...(rot ? { rot } : {}), shape };
  }
  return null;
}
