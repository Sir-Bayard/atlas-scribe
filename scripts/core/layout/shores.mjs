/**
 * What grows at the water's edge: reeds in clumps along a reedy or marshy shore (in the shallows, and out on the
 * marsh), and lily pads in the still water of a pond or lake outside winter. Everything is drawn from the body of
 * water's own stream, the same number of times whatever is kept, so a dock moved along the shore changes only the
 * reeds near it. Pure: runs anywhere. Numbers are in squares.
 */
import { pointInPolygon, distanceToPath } from "../geom.mjs";
import { makeNoise } from "../noise.mjs";

/** Steps along the shore between clumps of reeds, and how far they reach in and out. */
const STEP = 0.3;

/**
 * body: the layout's water item ({ id, class, poly, ring, shore, runs (the shore no quay covers), frozen }). r: its
 * stream. docks: [{ path, width }] to keep clear of. seed: for the clumps' noise. W, H: the map. winter: the season.
 * Returns { reeds: [{ x, y, rot, s, variant }], lilies: [same] }.
 */
export function shoreLife({ body, r, docks = [], seed = 1, W, H, winter = false }) {
  const reeds = [], lilies = [];
  const { poly, ring } = body;
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; a += x1 * y2 - x2 * y1; }
  const turn = Math.sign(a) || 1; // which way around the ring runs, so "in" points into the water
  const clear = (x, y) => x > 0.2 && y > 0.2 && x < W - 0.2 && y < H - 0.2 && !docks.some((d) => distanceToPath([x, y], d.path) < d.width / 2 + 0.35);
  const reedy = body.shore === "reeds" || body.shore === "marsh";
  if (reedy) {
    const rr = r.fork("reeds");
    const clump = makeNoise(seed, `${body.id}/reeds`, { scale: 2.5, octaves: 2 });
    const marsh = body.shore === "marsh";
    for (const run of body.runs ?? [ring]) {
      for (let i = 1; i < run.length; i++) {
        const [ax, ay] = run[i - 1], [bx, by] = run[i];
        const l = Math.hypot(bx - ax, by - ay);
        const ux = (bx - ax) / (l || 1), uy = (by - ay) / (l || 1);
        const inx = -uy * turn, iny = ux * turn; // into the water
        const n = Math.max(1, Math.round(l / STEP));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n, px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
          const count = 1 + rr.int(3), some = rr.next();
          const picks = Array.from({ length: 3 }, () => [rr.next(), rr.next(), rr.next(), rr.next(), rr.int(12)]);
          if (clump(px, py) < (marsh ? -0.05 : 0.05) || some > (body.class === "pond" ? 0.45 : 0.75)) continue;
          for (let c = 0; c < count; c++) {
            const [u, v, w, z, variant] = picks[c];
            // In the shallows; on a marsh, as often out on the wet ground
            const out = marsh && z < 0.5;
            const d = out ? -(0.15 + u * 0.9) : 0.05 + u * 0.5;
            const x = px + inx * d + ux * (v - 0.5) * STEP, y = py + iny * d + uy * (v - 0.5) * STEP;
            if (!clear(x, y)) continue;
            if (pointInPolygon([x, y], poly) === out) continue; // the shore bent: it landed on the wrong side
            reeds.push({ x, y, rot: w * 360, s: 1 + z * 0.5, variant }); // the art fills under half its square
          }
        }
      }
    }
  }
  // Lily pads: a few clusters out from a still shore
  const still = (body.class === "pond" || body.class === "lake") && !body.frozen && !winter && body.shore !== "sand" && body.shore !== "shingle" && body.shore !== "rocks";
  const lr = r.fork("lilies");
  const cum = [0];
  for (let i = 1; i < ring.length; i++) cum.push(cum[i - 1] + Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]));
  const L = cum.at(-1);
  const clusters = Math.min(8, Math.max(1, Math.round(L / 9)));
  for (let c = 0; c < clusters; c++) {
    const s = lr.next() * L, d = 0.7 + lr.next() * 1.4, pads = 3 + lr.int(5);
    const spots = Array.from({ length: 7 }, () => [lr.next(), lr.next(), lr.next(), lr.next(), lr.int(23)]);
    if (!still) continue;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const [ax, ay] = ring[i - 1], [bx, by] = ring[i], l = Math.hypot(bx - ax, by - ay) || 1;
    const t = Math.max(0, Math.min(1, (s - cum[i - 1]) / l));
    const cx = ax + (bx - ax) * t + (-(by - ay) / l) * turn * d, cy = ay + (by - ay) * t + ((bx - ax) / l) * turn * d;
    for (let k = 0; k < pads; k++) {
      const [u, v, w, z, variant] = spots[k];
      const ang = u * Math.PI * 2, rad = Math.sqrt(v) * 0.55;
      const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad;
      if (!clear(x, y) || !pointInPolygon([x, y], poly) || distanceToPath([x, y], ring) < 0.35) continue;
      lilies.push({ x, y, rot: w * 360, s: 0.5 + z * 0.25, variant });
    }
  }
  return { reeds, lilies };
}
