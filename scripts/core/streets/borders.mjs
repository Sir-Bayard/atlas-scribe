/**
 * Gates between districts. Where two districts share an edge, fixed points along it are where streets cross from
 * one to the other: both districts must run a street to each one, so their streets meet. The gates depend only on
 * the shared edge, the two districts' types and the plan's seed, never on either district's own seed, so
 * rerolling one district can't move the other. Pure: runs anywhere.
 */
import { pointInPolygon } from "../geom.mjs";
import { rng } from "../rng.mjs";

const TOUCH = 0.12; // squares: edges this close count as shared
const STEP = 0.2; // squares: how finely edges are sampled

function distToPolyEdge([x, y], poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return best;
}

/** The stretches of a's edge that lie along b's edge, as paths (in a's order). */
export function sharedEdges(a, b) {
  // (none where their boxes lie apart)
  const box = (p) => [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))];
  const [ax0, ay0, ax1, ay1] = box(a), [bx0, by0, bx1, by1] = box(b);
  if (ax0 > bx1 + TOUCH || bx0 > ax1 + TOUCH || ay0 > by1 + TOUCH || by0 > ay1 + TOUCH) return [];
  const runs = [];
  let run = null, firstSample = null;
  for (let i = 0; i < a.length; i++) {
    const [ax, ay] = a[i], [bx, by] = a[(i + 1) % a.length];
    const l = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(l / STEP));
    for (let k = 0; k < n; k++) {
      const p = [ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n];
      firstSample ??= p;
      if (distToPolyEdge(p, b) < TOUCH) {
        if (!run) { run = []; runs.push(run); }
        run.push(p);
      } else run = null;
    }
  }
  // A stretch that runs through a's first corner was split in two (the end of the loop and its start): join it
  const wraps = run !== null && runs.length > 1 && runs[0][0] === firstSample;
  if (wraps) runs[0] = [...runs.pop(), ...runs[0]];
  return runs.filter((r) => r.length >= 3);
}

function pathLength(path) {
  let l = 0;
  for (let i = 1; i < path.length; i++) l += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return l;
}

/** The point and direction at distance d along a path. */
function along(path, d) {
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const l = Math.hypot(bx - ax, by - ay);
    if (d <= l || i === path.length - 1) {
      const t = l ? Math.min(1, d / l) : 0;
      return { at: [ax + (bx - ax) * t, ay + (by - ay) * t], ux: l ? (bx - ax) / l : 1, uy: l ? (by - ay) / l : 0 };
    }
    d -= l;
  }
  return { at: path[0], ux: 1, uy: 0 };
}

/**
 * districts: [{ id, poly, streetSpacing, laneSpacing }] (squares; null where the district has none). roads:
 * [{ path }] (a road already crossing the edge is a connection, so no gate goes near it). water: a function
 * telling whether a point is in water. seed: the plan's seed.
 * Returns a map from district id to [{ at, nx, ny, kind }]: nx, ny point into that district.
 */
export function districtGates(districts, { roads = [], inWater = () => false, seed = 1 } = {}) {
  const gates = new Map(districts.map((d) => [d.id, []]));
  for (let i = 0; i < districts.length; i++)
    for (let j = i + 1; j < districts.length; j++) {
      const A = districts[i], B = districts[j];
      if (!A.streetSpacing || !B.streetSpacing) continue; // a hamlet makes no streets to meet
      const [p, q] = A.id < B.id ? [A, B] : [B, A];
      const r = rng(seed, "border", p.id, q.id);
      for (const edge of sharedEdges(p.poly, q.poly)) {
        const L = pathLength(edge);
        const spots = [];
        const place = (spacing, kind) => {
          const n = Math.floor(L / spacing);
          const start = n ? (L - (n - 1) * spacing) / 2 : L / 2;
          for (let k = 0; k < Math.max(1, n); k++) {
            const d = start + k * spacing + (r.next() - 0.5) * spacing * 0.25;
            if (d < 0.75 || d > L - 0.75) continue; // too near a corner
            if (spots.some((s) => Math.abs(s.d - d) < spacing * 0.5)) continue;
            const { at, ux, uy } = along(edge, d);
            if (inWater(at[0], at[1])) continue;
            if (roads.some((road) => nearPath(at, road.path, spacing * 0.4))) continue;
            spots.push({ d, at, ux, uy, kind });
          }
        };
        place(Math.max(p.streetSpacing, q.streetSpacing), "street");
        if (p.laneSpacing && q.laneSpacing) place(Math.max(p.laneSpacing, q.laneSpacing), "lane");
        for (const s of spots) {
          // The normal pointing into each district
          let nx = -s.uy, ny = s.ux;
          const intoP = pointInPolygon([s.at[0] + nx * 0.3, s.at[1] + ny * 0.3], p.poly);
          if (!intoP) { nx = -nx; ny = -ny; }
          gates.get(p.id).push({ at: s.at, nx, ny, kind: s.kind });
          gates.get(q.id).push({ at: s.at, nx: -nx, ny: -ny, kind: s.kind });
        }
      }
    }
  return gates;
}

function nearPath([x, y], path, dist) {
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    if (Math.hypot(ax + t * dx - x, ay + t * dy - y) < dist) return true;
  }
  return false;
}
