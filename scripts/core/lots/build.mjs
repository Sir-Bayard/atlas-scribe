/**
 * What stands on each plot: the house at the street, sometimes an outbuilding behind, sometimes a tended garden,
 * and in hamlets and villages often a croft (a small fenced field) at the back, with the plot's boundary drawn.
 * Everything in squares. Pure: runs anywhere.
 */
import { pointInPolygon } from "../geom.mjs";
import { lotTypeOf } from "./index.mjs";
import { intersect, area } from "./poly.mjs";

const HOUSE_ROOFS = ["slate", "slate", "slate", "slate", "wood-shingle", "wood-shingle", "tile-red", "tile-brown"];

/** The four corners of a rectangle centred at (cx, cy), len along (ux, uy), dep across it. */
function corners(cx, cy, len, dep, [ux, uy]) {
  const [nx, ny] = [-uy, ux];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [cx + (a * len) / 2 * ux + (b * dep) / 2 * nx, cy + (a * len) / 2 * uy + (b * dep) / 2 * ny]);
}

/** True when a rectangle (its corners) lies in the plot; tested a hair inside its edges, so a house built right
 * on the street line or against its neighbour still counts as fitting. */
const fits = (pts, poly) => {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.every(([x, y]) => pointInPolygon([cx + (x - cx) * 0.96, cy + (y - cy) * 0.96], poly));
};

/**
 * lots: from lotsFor. district: the plan feature. ways: [{ id, path, width }]. ftPerSquare. r: a stream for the
 * district's plots (each plot forks its own). Returns { houses, outbuildings, gardens, crofts, bounds }: houses and
 * outbuildings are { id, lot, building: { shape, rot, roof, height, chimney }, r }; gardens { cx, cy, w, d, rot };
 * crofts polygons; bounds [{ path, class }].
 */
export function buildOnLots({ lots, district, ways, ftPerSquare, r }) {
  const T = lotTypeOf(district);
  const sq = (ft) => ft / ftPerSquare;
  const spacious = Math.max(0, Math.min(1, district.spacious ?? 0));
  const density = district.density ?? 1;
  const gardenShare = district.gardens ?? 0.1;
  const out = { houses: [], outbuildings: [], gardens: [], crofts: [], bounds: [] };
  const wayById = new Map(ways.map((w) => [w.id, w]));
  const boundsSeen = new Set();
  const boundClass = (lr) => (district.profile === "hamlet" || district.profile === "roadside" ? (lr.next() < 0.5 ? "hedge" : "wall") : lr.next() < 0.8 ? "fence" : "wall");

  let croftOf = -1;
  /** A polygon's edges as boundary segments, except those along the street; each shared side once. */
  const addBounds = (p, way, cls) => {
    for (let k = 0; k < p.length; k++) {
      const a = p[k], b = p[(k + 1) % p.length];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (way && Math.abs(distToPath(mid, way.path) - way.width / 2) < 0.1) continue;
      const key = [a, b].map((q) => q.map((v) => v.toFixed(2)).join(",")).sort().join("|");
      if (boundsSeen.has(key)) continue;
      boundsSeen.add(key);
      out.bounds.push({ path: [a, b], class: cls });
    }
  };

  lots.forEach((lot, i) => {
    const lr = r.fork("lot", lot.block, i);
    // Every choice drawn first, so a plot's dice never depend on what fitted
    const vacant = lr.next() < (1 - Math.min(1, density)) * 0.6;
    const cover = (T.cover[0] + lr.next() * (T.cover[1] - T.cover[0])) * (1 - 0.35 * spacious);
    const hd = sq(T.houseDepth[0] + lr.next() * (T.houseDepth[1] - T.houseDepth[0]));
    const sb = sq(T.setback[0] + lr.next() * (T.setback[1] - T.setback[0]) + 15 * spacious);
    const roof = lr.pick(HOUSE_ROOFS);
    const turn = (lr.next() - 0.5) * (T.cover[1] < 1 ? 4 : 0); // village houses sit a little askew; terraces don't
    const wantGarden = lr.next() < gardenShare, wantOut = lr.next() < T.outbuilding, wantCroft = lr.next() < T.croft;
    const gDepth = 0.8 + lr.next() * 0.6, oSize = sq(9 + lr.next() * 9), oSide = lr.next() - 0.5, yard = sq(10 + lr.next() * 15);
    const bClass = boundClass(lr);
    const [ux, uy] = lot.along, [nx, ny] = lot.inward;
    const [mx, my] = lot.front.mid;
    const ang = (Math.atan2(uy, ux) * 180) / Math.PI;

    // The house, at the front, as wide as its share of the frontage; narrowed if the plot's sides close in
    let house = null;
    if (!vacant) {
      // Narrower, then shallower, then slid along the front, before a plot is left as a yard (odd corner plots)
      const rot = ang + turn;
      const a = (rot * Math.PI) / 180;
      const dir = [Math.cos(a), Math.sin(a)];
      const full = Math.min(hd, lot.depth * (T.cover[1] >= 1 ? 0.85 : 0.6));
      search: for (const depth of [full, full * 0.75]) {
        if (depth < sq(12)) continue;
        for (let w = lot.frontage * cover * 0.98; w > sq(12); w *= 0.85) {
          for (const slide of [0, 0.15, -0.15, 0.3, -0.3]) {
            const off = slide * lot.frontage;
            const cx = mx + nx * (sb + depth / 2) + ux * off, cy = my + ny * (sb + depth / 2) + uy * off;
            if (!fits(corners(cx, cy, w, depth, dir), lot.poly)) continue;
            house = { cx, cy, w, depth, off };
            out.houses.push({ id: `l${lot.block}-${i}`, lot: i, r: lr.fork("house"), building: { shape: { rect: [cx - w / 2, cy - depth / 2, cx + w / 2, cy + depth / 2] }, rot, roof, height: 20 } });
            break search;
          }
        }
      }
    }
    let behind = (house ? sb + house.depth : sb) + 0.15; // how far back from the street the next thing starts
    const houseBack = behind;

    // A tended garden right behind the house
    if (house && wantGarden) {
      for (const d of [gDepth, gDepth * 0.65]) {
        const w = Math.min(house.w * 0.95, lot.frontage * 0.85);
        const cx = mx + nx * (behind + d / 2), cy = my + ny * (behind + d / 2);
        if (fits(corners(cx, cy, w, d, [ux, uy]), lot.poly)) {
          out.gardens.push({ cx, cy, w, d, rot: ang });
          behind += d + 0.1;
          break;
        }
      }
    }
    // A shed, barn or workshop across the yard behind, to one side: small, so it never reads as a second house
    if (house && wantOut) {
      const ow = Math.min(oSize * 1.3, lot.frontage * 0.5, house.w * 0.7), od = oSize;
      const side = oSide * Math.max(0, lot.frontage - ow) * 0.8;
      const back = behind + sq(8);
      const cx = mx + nx * (back + od / 2) + ux * side, cy = my + ny * (back + od / 2) + uy * side;
      if (behind + od < lot.depth * 0.9 && fits(corners(cx, cy, ow, od, [ux, uy]), lot.poly)) {
        out.outbuildings.push({ id: `l${lot.block}-${i}o`, lot: i, r: lr.fork("out"), building: { shape: { rect: [cx - ow / 2, cy - od / 2, cx + ow / 2, cy + od / 2] }, rot: ang, roof: "wood-shingle", height: 15, chimney: false } });
        behind = back + od + 0.1;
      }
    }
    // The croft: the back of the plot as a small fenced field
    if (wantCroft && lot.depth * 0.55 > behind) {
      const far = lot.depth * 1.6, near = Math.max(behind, lot.depth * 0.55);
      const slab = [[mx + nx * near - ux * 99, my + ny * near - uy * 99], [mx + nx * near + ux * 99, my + ny * near + uy * 99], [mx + nx * far + ux * 99, my + ny * far + uy * 99], [mx + nx * far - ux * 99, my + ny * far - uy * 99]];
      const piece = intersect([lot.poly], [slab]).reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
      if (piece && area(piece) > 0.5) { out.crofts.push(piece); croftOf = i; }
    }
    // Boundaries near the house only (Patrick, 24 Oct): the yard round the house and outbuilding, fenced on its
    // sides and back but not along the street, and the fence round a croft. The long back lines aren't drawn.
    if (T.bounds && house) {
      const way = wayById.get(lot.way);
      const reachBack = Math.max(houseBack, behind) + yard;
      const toft = clipDepth(lot.poly, [mx, my], [ux, uy], [nx, ny], reachBack);
      if (toft) addBounds(toft, way, bClass);
    }
    if (T.bounds && out.crofts[out.crofts.length - 1] && wantCroft && croftOf === i) addBounds(out.crofts[out.crofts.length - 1], null, bClass);
  });
  out.bounds = joinBounds(out.bounds);
  return out;
}

/** The part of a plot from its front back to a given depth. */
function clipDepth(poly, [mx, my], [ux, uy], [nx, ny], depth) {
  const slab = [[mx - nx * 0.5 - ux * 99, my - ny * 0.5 - uy * 99], [mx - nx * 0.5 + ux * 99, my - ny * 0.5 + uy * 99], [mx + nx * depth + ux * 99, my + ny * depth + uy * 99], [mx + nx * depth - ux * 99, my + ny * depth - uy * 99]];
  return intersect([poly], [slab]).reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
}

/** Joins boundary segments end to end into longer lines of the same kind, so they draw as fences, not dashes. */
function joinBounds(segs) {
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

function distToPath([x, y], path) {
  let d = Infinity;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    d = Math.min(d, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return d;
}
