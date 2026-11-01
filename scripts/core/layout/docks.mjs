/**
 * Quays, wharves, piers and jetties. A quay (stone) or wharf (timber) runs along the water's edge: each point of its
 * line is moved onto the edge of the nearest stream, river, canal, lake or sea within SNAP squares (on the side of a
 * river most of it was drawn on), and it's paved landward from there, as wide as its width, so houses front it as
 * they would a street. A pier (stone) or jetty (timber) runs out into the water as drawn. Pure: runs anywhere.
 * Numbers are in squares.
 */
import { pointInPolygon } from "../geom.mjs";
import { bandPieces } from "./walls.mjs";
import { pastEdge } from "../water.mjs";

/** The docks that run along the water's edge. */
export const QUAYS = ["quay", "wharf"];
export const isQuay = (f) => !!f && f.type === "dock" && QUAYS.includes(f.class);

/** How far from the water's edge a quay's line may be drawn and still be moved onto it. */
export const SNAP = 2.5;

const finite = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** A path with a point at least every step squares (its own points kept). */
function densify(path, step) {
  const out = [[path[0][0], path[0][1]]];
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

/** The nearest point to p on a path: { at, i (the segment ends at point i), t, d }. */
function nearestOn(p, path) {
  let best = null;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2)) : 0;
    const at = [ax + dx * t, ay + dy * t], d = Math.hypot(at[0] - p[0], at[1] - p[1]);
    if (!best || d < best.d) best = { at, i, t, d };
  }
  return best;
}

const unit = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

/**
 * Where the water's edge nearest p is, within SNAP: { key, at (on the edge), away (unit, from the water to the
 * land), side (a river's: 1 or -1, which bank), d } or null. runs: [{ id, path, width, widths? }]; bodies: [{ id,
 * poly, ring }].
 */
function edgeNear(p, runs, bodies) {
  let best = null;
  for (const w of runs) {
    const n = nearestOn(p, w.path);
    if (!n) continue;
    const a = w.path[n.i - 1], b = w.path[n.i];
    const half = (w.widths ? w.widths[n.i - 1] + (w.widths[n.i] - w.widths[n.i - 1]) * n.t : w.width) / 2;
    const [ux, uy] = unit(b[0] - a[0], b[1] - a[1]);
    const left = [uy, -ux];
    const side = (p[0] - n.at[0]) * left[0] + (p[1] - n.at[1]) * left[1] >= 0 ? 1 : -1;
    const d = Math.abs(n.d - half);
    if (d <= SNAP && (!best || d < best.d)) best = { key: w.id, d, run: { at: n.at, left, half }, side };
  }
  for (const b of bodies) {
    const n = nearestOn(p, b.ring);
    if (!n || n.d > SNAP || (best && n.d >= best.d)) continue;
    const inside = pointInPolygon(p, b.poly);
    let away;
    if (n.d > 1e-6) away = inside ? unit(n.at[0] - p[0], n.at[1] - p[1]) : unit(p[0] - n.at[0], p[1] - n.at[1]);
    else {
      // On the shore itself: the side of the shore's segment that's out of the water
      const a = b.ring[n.i - 1], c = b.ring[n.i];
      const [ux, uy] = unit(c[0] - a[0], c[1] - a[1]);
      away = pointInPolygon([n.at[0] + uy * 0.01, n.at[1] - ux * 0.01], b.poly) ? [-uy, ux] : [uy, -ux];
    }
    best = { key: b.id, d: n.d, at: n.at, away };
  }
  return best;
}

/**
 * One dock laid out. f: the plan feature (normalized). runs and bodies: the water as the layout has it. sq: feet a
 * square. Returns { item, way (a quay's, for houses to front and streets to start from), keep (polygons nothing
 * else is placed on: a pier's), edge (a quay's line along the water), notes }, or null when its path is too short.
 */
export function layDock(f, { runs = [], bodies = [], sq }) {
  const notes = [];
  const path = (Array.isArray(f.path) ? f.path.filter(finite) : []).filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1e-6).map((p) => [p[0], p[1]]);
  if (path.length < 2) return null;
  const width = (Number.isFinite(f.width) ? f.width : 15) / sq;
  const material = f.material === "wood" || f.material === "stone" ? f.material : f.class === "wharf" || f.class === "jetty" ? "wood" : "stone";
  const base = { kind: "dock", id: f.id, from: f.id, class: f.class, material, width };
  if (!isQuay(f)) {
    const wet = densify(path, 0.25).some((q) => runs.some((w) => pastEdge(q, w) < 0) || bodies.some((b) => pointInPolygon(q, b.poly)));
    if (!wet) notes.push({ level: "warning", id: f.id, message: `"${f.id}" doesn't reach any water, so it stands on dry land.` });
    return { item: { ...base, path }, way: null, keep: bandPieces(path, width / 2 + 0.1), edge: null, notes };
  }
  // A quay: each point onto the edge nearest it, all on one bank of a river
  const pts = densify(path, 0.5);
  const near = pts.map((p) => edgeNear(p, runs, bodies));
  const vote = new Map();
  for (const e of near) if (e?.run) vote.set(e.key, (vote.get(e.key) ?? 0) + e.side);
  const own = pts.map((p, i) => {
    const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
    const [ux, uy] = unit(next[0] - prev[0], next[1] - prev[1]);
    return [uy, -ux]; // the quay's own left
  });
  let edge = [], away = [];
  near.forEach((e, i) => {
    if (!e) { edge.push(null); away.push(null); return; }
    if (e.run) {
      const s = (vote.get(e.key) ?? 1) >= 0 ? 1 : -1;
      const { at, left, half } = e.run;
      edge.push([at[0] + left[0] * s * half, at[1] + left[1] * s * half]);
      away.push([left[0] * s, left[1] * s]);
    } else { edge.push(e.at); away.push(e.away); }
  });
  const snapped = edge.filter(Boolean).length;
  if (!snapped) notes.push({ level: "warning", id: f.id, message: `"${f.id}" isn't along the edge of any water within ${SNAP} squares, so it's drawn as paving where the plan puts it (a town wall's moat doesn't count yet).` });
  // Points with no water near keep their place, paved on the side the rest is
  let lean = 0;
  away.forEach((a, i) => { if (a) lean += a[0] * own[i][0] + a[1] * own[i][1]; });
  const sgn = lean < 0 ? -1 : 1;
  edge = edge.map((e, i) => e ?? pts[i]);
  away = away.map((a, i) => a ?? [own[i][0] * sgn, own[i][1] * sgn]);
  // Smoothed a little, so the paving doesn't kink where the nearest edge changes
  for (let pass = 0; pass < 2; pass++) away = away.map((a, i) => unit(a[0] * 2 + away[Math.max(0, i - 1)][0] + away[Math.min(away.length - 1, i + 1)][0], a[1] * 2 + away[Math.max(0, i - 1)][1] + away[Math.min(away.length - 1, i + 1)][1]));
  // Points that the moving brought together are one point
  const keep = edge.map((e, i) => i === 0 || Math.hypot(e[0] - edge[i - 1][0], e[1] - edge[i - 1][1]) > 0.05);
  edge = edge.filter((_, i) => keep[i]);
  away = away.filter((_, i) => keep[i]);
  if (edge.length < 2) return null;
  const mid = edge.map((e, i) => [e[0] + (away[i][0] * width) / 2, e[1] + (away[i][1] * width) / 2]);
  const land = edge.map((e, i) => [e[0] + away[i][0] * width, e[1] + away[i][1] * width]);
  const item = { ...base, path: mid, edge, land };
  const way = { kind: "way", id: f.id, from: f.id, class: "quay", path: mid, width, surface: "flagstone", ruts: false, quay: true };
  return { item, way, keep: [], edge, notes };
}

/**
 * A ring (a lake's or the sea's shore, closed on its first point) cut into the runs no quay covers, for its shore
 * to be painted and kept clear along. quayEdges: the quays' lines along the water. Returns { runs: [path], quayed:
 * [boolean] (one a segment of the ring) }.
 */
export function shoreRuns(ring, quayEdges) {
  const quayed = [];
  for (let i = 1; i < ring.length; i++) {
    const m = [(ring[i - 1][0] + ring[i][0]) / 2, (ring[i - 1][1] + ring[i][1]) / 2];
    quayed.push(quayEdges.some((e) => { const n = nearestOn(m, e); return n && n.d < 0.3; }));
  }
  if (!quayed.some(Boolean)) return { runs: [ring], quayed };
  const runs = [];
  // Start just after a quayed segment, so a run over the ring's start is one run
  const n = quayed.length, start = quayed.findIndex((q, i) => q && !quayed[(i + 1) % n]);
  let cur = null;
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    if (quayed[i]) { if (cur) runs.push(cur); cur = null; continue; }
    if (!cur) cur = [ring[i]];
    cur.push(ring[i + 1]);
  }
  if (cur) runs.push(cur);
  return { runs: runs.filter((r) => r.length >= 2), quayed };
}
