/**
 * What stands on each plot: the house at the street, sometimes an outbuilding behind, sometimes a tended garden,
 * and in hamlets and villages often a croft (a small fenced field) at the back, with the plot's boundary drawn.
 * Everything in squares. Pure: runs anywhere.
 */
import { pointInPolygon, shapeToPolygon } from "../geom.mjs";
import { intersect, area, offset } from "./poly.mjs";
import { ROOFS, ROOF_STYLES } from "../plan.mjs";
import { rectCorners } from "./forms.mjs";
import { lotRules, ownBuildings, plotByPlot, yardsAndFences } from "./build-steps/index.mjs";

/** A key from { key: weight } for a roll in [0, 1). */
export function pickWeighted(roll, weights) {
  const keys = Object.keys(weights);
  const total = keys.reduce((s, k) => s + weights[k], 0);
  let x = roll * total;
  for (const k of keys) if ((x -= weights[k]) < 0) return k;
  return keys[keys.length - 1];
}

/**
 * The roof materials a district's houses choose from: the plan's list, or `palette` of its type's materials
 * picked by weight from the district's own stream, so two villages side by side can look different.
 */
export function roofPalette(district, T, r) {
  const own = (Array.isArray(district.roofs) ? district.roofs : []).filter((x) => ROOFS.includes(x));
  if (own.length) return Object.fromEntries(own.map((x) => [x, 1]));
  const pool = { ...(T.roofs ?? { slate: 1 }) };
  const out = {};
  const pr = r.fork("roofs");
  for (let k = 0; k < (T.palette ?? 3) && Object.keys(pool).length; k++) {
    const x = pickWeighted(pr.next(), pool);
    out[x] = pool[x];
    delete pool[x];
  }
  return out;
}

/** The roof forms a district's houses choose from: the plan's list, or its type's mix. */
export function roofStyles(district, T) {
  const own = (Array.isArray(district.roofStyles) ? district.roofStyles : []).filter((x) => ROOF_STYLES.includes(x));
  return own.length ? Object.fromEntries(own.map((x) => [x, 1])) : T.styles ?? { gable: 1 };
}

/** The four corners of a rectangle centered at (cx, cy), len along (ux, uy), dep across it. */
export function corners(cx, cy, len, dep, [ux, uy]) {
  const [nx, ny] = [-uy, ux];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [cx + (a * len) / 2 * ux + (b * dep) / 2 * nx, cy + (a * len) / 2 * uy + (b * dep) / 2 * ny]);
}

/** True when a rectangle (its corners) lies in the plot; tested a hair inside its edges, so a house built right
 * on the street line or against its neighbor still counts as fitting. */
export const fitsIn = (pts, poly) => {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.every(([x, y]) => pointInPolygon([cx + (x - cx) * 0.96, cy + (y - cy) * 0.96], poly));
};
/** A footprint grown by d all around (square corners), as the room a building keeps about it. */
export const grown = (pts, d) => offset([pts], d).reduce((a, b) => (!a || area(b) > area(a) ? b : a), null) ?? pts;
/** As fitsIn, but a fixed hair (0.03 of a square) inside, however big the rectangle: a battle map's spacing holds. */
export const fitsTight = (pts, poly) => {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.every(([x, y]) => {
    const d = Math.hypot(x - cx, y - cy);
    const k = d > 0.03 ? (d - 0.03) / d : 0;
    return pointInPolygon([cx + (x - cx) * k, cy + (y - cy) * k], poly);
  });
};

/**
 * lots: from lotsFor. district: the plan feature. ways: [{ id, path, width }]. blocked: polygons to keep clear of. r:
 * the district's plots' stream (each plot forks its own). usesFor(tryForm): planUses for this district, or null for
 * plain houses; the uses it settled on come back as .uses. Returns { houses, outbuildings, gardens, crofts, bounds,
 * trees, props, surfaces, pits, kilns, walls } (houses and outbuildings { id, lot, building, r, smoke? }; walls:
 * stone walls around a temple's yard or a mansion's grounds).
 */
export function buildOnLots({ lots, district, ways, blocked = [], ftPerSquare, r, usesFor = null }) {
  const ctx = { lots, district, ways, blocked, ftPerSquare, r, usesFor };
  lotRules(ctx);
  ownBuildings(ctx);
  plotByPlot(ctx);
  return yardsAndFences(ctx);
}

/** A polygon's edges, joined end to end, leaving out those along a street (onWayEdge of their middle). */
export function edgesOff(poly, onWayEdge) {
  const runs = [];
  let cur = null;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length];
    if (onWayEdge([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) || Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.02) { cur = null; continue; }
    if (cur && cur[cur.length - 1] === a) cur.push(b);
    else { cur = [a, b]; runs.push(cur); }
  }
  // A run that ends where the first began is one wall
  if (runs.length > 1 && runs[runs.length - 1][runs[runs.length - 1].length - 1] === runs[0][0]) runs[0] = [...runs.pop(), ...runs[0].slice(1)];
  return runs;
}

/** A building spec's footprint: its four corners (a round one's square box), or a row house's own outline. */
export function partCorners(b) {
  if (Array.isArray(b.shape)) return shapeToPolygon(b.shape, b.rot ?? 0);
  if (b.shape.circle) { const [x, y, rad] = b.shape.circle; return rectCorners(x, y, rad * 2, rad * 2, b.rot ?? 0); }
  const [x0, y0, x1, y1] = b.shape.rect;
  return rectCorners((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, b.rot ?? 0);
}

/**
 * An outline with repeated corners (closer than a hundredth of a square) and spikes (out to a point and straight back,
 * its two neighbors the same) taken out; the outline as given when that would leave fewer than three corners.
 */
export function cleanRing(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return poly;
  let pts = poly.slice();
  const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01;
  for (let changed = true; changed && pts.length > 3;) {
    changed = false;
    for (let k = 0; k < pts.length && pts.length > 3; k++) {
      const a = pts[(k + pts.length - 1) % pts.length], p = pts[k], c = pts[(k + 1) % pts.length];
      if (same(p, c) || same(a, c)) { pts.splice(k, 1); changed = true; k--; }
    }
  }
  return pts.length >= 3 ? pts : poly;
}

/**
 * A footprint cleaned up for drawing: no repeated corners, no corner in a straight edge, and no spike (a corner
 * sharper than 25 degrees, where a plot's cut met its neighbor's at a slant). Unchanged if that leaves too little.
 */
export function tidy(poly) {
  let pts = poly.slice();
  const orient = Math.sign(poly.reduce((s, p, k) => { const q = poly[(k + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0));
  for (let changed = true; changed && pts.length > 3; ) {
    changed = false;
    for (let k = 0; k < pts.length && pts.length > 3; k++) {
      const a = pts[(k + pts.length - 1) % pts.length], p = pts[k], c = pts[(k + 1) % pts.length];
      const ax = a[0] - p[0], ay = a[1] - p[1], cx = c[0] - p[0], cy = c[1] - p[1];
      const la = Math.hypot(ax, ay), lc = Math.hypot(cx, cy);
      const cos = la > 1e-9 && lc > 1e-9 ? (ax * cx + ay * cy) / (la * lc) : 1;
      // (only a spike that points out: cutting one off that points in would fill the notch past the plot's edge)
      const convex = Math.sign(-ax * cy + ay * cx) === orient;
      // (a needle, out and straight back, goes whichever way it points; one pointing in, a slit, comes back when the
      // result is kept to the shape given below)
      if (la < 0.03 || ((convex || cos > 0.99) && cos > Math.cos((25 * Math.PI) / 180)) || cos < -0.9995) { pts.splice(k, 1); changed = true; k--; }
    }
  }
  if (pts.length < 3 || area(pts) <= area(poly) * 0.9) return poly;
  // (cutting off a corner that points in fills its notch a hair past the plot: kept to the shape given)
  const kept = intersect([pts], [poly]).reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
  return kept && area(kept) > area(poly) * 0.9 ? kept : poly;
}

/** The part of a plot from its front back to a given depth. */
export function clipDepth(poly, [mx, my], [ux, uy], [nx, ny], depth) {
  const slab = [[mx - nx * 0.5 - ux * 99, my - ny * 0.5 - uy * 99], [mx - nx * 0.5 + ux * 99, my - ny * 0.5 + uy * 99], [mx + nx * depth + ux * 99, my + ny * depth + uy * 99], [mx + nx * depth - ux * 99, my + ny * depth - uy * 99]];
  return intersect([poly], [slab]).reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
}

/**
 * Merges fence segments lying on one line: overlapping or touching pieces become one, so two neighbors' fences
 * along their shared side are drawn once, from the front to the deeper of the two.
 */
export function mergeCollinear(segs) {
  const lines = [];
  for (const sgm of segs) {
    const [[ax, ay], [bx, by]] = sgm.path;
    let ang = Math.atan2(by - ay, bx - ax);
    if (ang < 0) ang += Math.PI;
    if (ang >= Math.PI - 1e-9) ang -= Math.PI;
    // An existing line within a hair in angle and offset (a line near 0 and one near pi are the same, reversed)
    let L = null;
    for (const q of lines) {
      const d = Math.abs(ang - q.ang);
      if (d >= 0.03 && Math.PI - d >= 0.03) continue;
      const ux = q.ux, uy = q.uy;
      if (Math.abs(-ax * uy + ay * ux - q.off) < 0.03 && Math.abs(-bx * uy + by * ux - q.off) < 0.03) { L = q; break; }
    }
    if (!L) {
      const ux = Math.cos(ang), uy = Math.sin(ang);
      L = { ang, ux, uy, off: -ax * uy + ay * ux, cls: sgm.class, spans: [] };
      lines.push(L);
    }
    const t0 = ax * L.ux + ay * L.uy, t1 = bx * L.ux + by * L.uy;
    L.spans.push([Math.min(t0, t1), Math.max(t0, t1)]);
  }
  const out = [];
  for (const L of lines) {
    L.spans.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const sp of L.spans) {
      const last = merged[merged.length - 1];
      if (last && sp[0] <= last[1] + 0.03) last[1] = Math.max(last[1], sp[1]);
      else merged.push([...sp]);
    }
    const at = (t) => [t * L.ux - L.off * L.uy, t * L.uy + L.off * L.ux];
    for (const [t0, t1] of merged) out.push({ path: [at(t0), at(t1)], class: L.cls });
  }
  return out;
}

/** Joins boundary segments end to end into longer lines of the same kind, so they draw as fences, not dashes. */
export function joinBounds(segs) {
  const out = [];
  const used = new Array(segs.length).fill(false);
  const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-3 && Math.abs(p[1] - q[1]) < 1e-3;
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const path = [...segs[i].path];
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < segs.length; j++) {
        if (used[j] || segs[j].class !== segs[i].class) continue;
        const [a, b] = segs[j].path;
        if (same(path[path.length - 1], a)) path.push(b);
        else if (same(path[path.length - 1], b)) path.push(a);
        else if (same(path[0], b)) path.unshift(a);
        else if (same(path[0], a)) path.unshift(b);
        else continue;
        used[j] = true;
        grew = true;
      }
    }
    out.push({ path, class: segs[i].class });
  }
  return out;
}

export function distToSeg([x, y], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + t * dx - x, ay + t * dy - y);
}

export function distToPath([x, y], path) {
  let d = Infinity;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    d = Math.min(d, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return d;
}
