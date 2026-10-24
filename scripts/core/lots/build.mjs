/**
 * What stands on each plot: the house at the street, sometimes an outbuilding behind, sometimes a tended garden,
 * and in hamlets and villages often a croft (a small fenced field) at the back, with the plot's boundary drawn.
 * Everything in squares. Pure: runs anywhere.
 */
import { pointInPolygon, polygonsOverlap } from "../geom.mjs";
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
const fitsIn = (pts, poly) => {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.every(([x, y]) => pointInPolygon([cx + (x - cx) * 0.96, cy + (y - cy) * 0.96], poly));
};

/**
 * lots: from lotsFor. district: the plan feature. ways: [{ id, path, width }]. blocked: polygons to keep clear of
 * (squares, yards, named buildings). ftPerSquare. r: a stream for the
 * district's plots (each plot forks its own). Returns { houses, outbuildings, gardens, crofts, bounds }: houses and
 * outbuildings are { id, lot, building: { shape, rot, roof, height, chimney }, r }; gardens { cx, cy, w, d, rot };
 * crofts polygons; bounds [{ path, class }].
 */
export function buildOnLots({ lots, district, ways, blocked = [], ftPerSquare, r }) {
  // In the plot, and clear of anything the plot was cut round (a named building inside a block is a hole in it)
  const fits = (pts, poly) => fitsIn(pts, poly) && !blocked.some((b) => polygonsOverlap(pts, b));
  const T = lotTypeOf(district);
  const sq = (ft) => ft / ftPerSquare;
  const spacious = Math.max(0, Math.min(1, district.spacious ?? 0));
  const density = district.density ?? 1;
  const gardenShare = district.gardens ?? 0.1;
  const out = { houses: [], outbuildings: [], gardens: [], crofts: [], bounds: [] };
  const wayById = new Map(ways.map((w) => [w.id, w]));
  const boundClass = (lr) => (district.profile === "hamlet" || district.profile === "roadside" ? (lr.next() < 0.5 ? "hedge" : "wall") : lr.next() < 0.8 ? "fence" : "wall");

  let croftOf = -1;
  /** A polygon's edges as boundary segments, except those along a street. */
  const addBounds = (p, way, cls, skip = null) => {
    for (let k = 0; k < p.length; k++) {
      const a = p[k], b = p[(k + 1) % p.length];
      if (skip?.(a, b)) continue;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      // Never along a street: this plot's own, or another one at its back or side
      if (ways.some((w) => Math.abs(distToPath(mid, w.path) - w.width / 2) < 0.1)) continue;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.02) continue;
      out.bounds.push({ path: [a, b], class: cls });
    }
  };

  const row = { key: null, roof: null, left: 0 };
  lots.forEach((lot, i) => {
    const lr = r.fork("lot", lot.block, i);
    // Every choice drawn first, so a plot's dice never depend on what fitted
    const vacant = lr.next() < (1 - Math.min(1, density)) * 0.6;
    const cover = (T.cover[0] + lr.next() * (T.cover[1] - T.cover[0])) * (1 - 0.35 * spacious);
    const hd = sq(T.houseDepth[0] + lr.next() * (T.houseDepth[1] - T.houseDepth[0]));
    const sb = sq(T.setback[0] + lr.next() * (T.setback[1] - T.setback[0]) + 15 * spacious);
    let roof = lr.pick(HOUSE_ROOFS);
    const turn = (lr.next() - 0.5) * (T.cover[1] < 1 ? 4 : 0); // village houses sit a little askew; terraces don't
    const wantGarden = lr.next() < gardenShare, wantOut = lr.next() < T.outbuilding, wantCroft = lr.next() < (district.crofts ?? T.croft);
    const gDepth = 0.8 + lr.next() * 0.6, oSize = sq(9 + lr.next() * 9), oSide = lr.next() - 0.5, yard = sq(10 + lr.next() * 15);
    const bClass = boundClass(lr);
    // The house's shape: one rear wing (L), two (U), or two and a back range round a yard (court)
    const shapeRoll = lr.next(), wingLeft = lr.next() < 0.5, wingW = sq(12 + lr.next() * 8), wingL = sq(15 + lr.next() * 20);
    const rowLen = 2 + lr.int(4); // terraces: houses in a row share one roof material
    const variant = lr.int(8), hipped = lr.next() < (T.hip ?? 0); // a house and its wings share one roof
    const [ux, uy] = lot.along, [nx, ny] = lot.inward;
    const [mx, my] = lot.front.mid;
    const ang = (Math.atan2(uy, ux) * 180) / Math.PI;

    // Terraces: a row of houses along one street shares its roof material, so it reads as a row
    if (T.cover[1] >= 1) {
      const key = `${lot.block}|${lot.way}`;
      if (row.key === key && row.left > 0) { roof = row.roof; row.left--; }
      else Object.assign(row, { key, roof, left: rowLen - 1 });
    }
    // The house, at the front, as wide as its share of the frontage; narrowed if the plot's sides close in
    let house = null;
    if (!vacant) {
      // Narrower, then shallower, then slid along the front, before a plot is left as a yard (odd corner plots)
      const rot = ang + turn;
      const a = (rot * Math.PI) / 180;
      const dir = [Math.cos(a), Math.sin(a)];
      // A house that will have wings keeps its front range shallower, leaving the plot room behind for them
      const S0 = T.shapes ?? {};
      const winged = shapeRoll < (S0.L ?? 0) + (S0.U ?? 0) + (S0.court ?? 0);
      const plain = Math.min(hd, lot.depth * (T.cover[1] >= 1 ? 0.85 : 0.6));
      const depths = winged ? [Math.min(hd, lot.depth * 0.45), plain, plain * 0.75] : [plain, plain * 0.75];
      search: for (const depth of depths) {
        if (depth < sq(12)) continue;
        for (let w = lot.frontage * cover * 0.98; w > sq(12); w *= 0.85) {
          for (const slide of [0, 0.15, -0.15, 0.3, -0.3]) {
            const off = slide * lot.frontage;
            const cx = mx + nx * (sb + depth / 2) + ux * off, cy = my + ny * (sb + depth / 2) + uy * off;
            if (!fits(corners(cx, cy, w, depth, dir), lot.poly)) continue;
            house = { cx, cy, w, depth, off, rot, dir };
            break search;
          }
        }
      }
    }
    // Wings behind the house, at right angles to it
    let reach = house ? sb + house.depth : sb;
    if (house) {
      const { cx, cy, w, depth, rot, dir } = house;
      const [dx, dy] = dir;
      // The house's own "back": square to its front, on the side away from the street
      const [bx, by] = -dy * nx + dx * ny >= 0 ? [-dy, dx] : [dy, -dx];
      const S = T.shapes ?? {};
      // Only a house wide enough gets wings, and a wing is never a thin stick: at least 10 ft wide, longer than wide
      // A double plot's house leans to the bigger forms: a courtyard or two wings far more often
      const roll = lot.merged ? shapeRoll * 0.35 + (S.L ?? 0) * 0.8 : shapeRoll;
      const kindWanted = roll < S.L ? "L" : roll < S.L + S.U ? "U" : roll < S.L + S.U + S.court ? "court" : null;
      const kind = !kindWanted || w < sq(22) ? null : kindWanted === "U" && w < sq(30) ? "L" : kindWanted === "court" && w < sq(32) ? "U" : kindWanted;
      const parts = [];
      const ww = Math.max(sq(10), Math.min(wingW, w * (kind === "L" ? 0.5 : 0.4)));
      const wl = Math.max(kind === "court" ? Math.max(wingL, ww * 1.8) : wingL, ww * 1.2);
      const wing = (side) => {
        // A wing running back from one end of the house, flush with its side, overlapping it a little
        const along = side * (w / 2 - ww / 2);
        const ox = cx + dx * along + bx * (depth / 2 + wl / 2 - 0.05), oy = cy + dy * along + by * (depth / 2 + wl / 2 - 0.05);
        return { cx: ox, cy: oy, len: wl, dep: ww, rot: rot + 90, back: depth + wl, wing: true };
      };
      if (kind === "L") parts.push(wing(wingLeft ? -1 : 1));
      if (kind === "U" || kind === "court") parts.push(wing(-1), wing(1));
      if (kind === "court") {
        const off = depth / 2 + wl - 0.05 + ww / 2;
        parts.push({ cx: cx + bx * off, cy: cy + by * off, len: w, dep: ww, rot, back: depth + wl + ww - 0.05 });
      }
      // Every part must fit the plot, or the house stays a plain block
      const ok = parts.every((q) => { const a = (q.rot * Math.PI) / 180; return fits(corners(q.cx, q.cy, q.len, q.dep, [Math.cos(a), Math.sin(a)]), lot.poly); });
      const style = hipped ? "hip" : "gable";
      // The house first, then its wings: a wing's roof runs on into the house's and must lie over it (the valleys)
      out.houses.push({ id: `l${lot.block}-${i}`, lot: i, r: lr.fork("house"), shape: ok ? kind : null, building: { shape: { rect: [cx - w / 2, cy - depth / 2, cx + w / 2, cy + depth / 2] }, rot, roof, variant, roofStyle: style, height: 20 } });
      // A courtyard's back range before its side wings, whose far ends run into it
      if (ok) [...parts].sort((p1, p2) => (p1.wing ? 1 : 0) - (p2.wing ? 1 : 0)).forEach((q, k) => {
        // Which end of the wing meets the house: its local x runs along rot; the end facing the house joins it
        const a = (q.rot * Math.PI) / 180;
        const outward = Math.cos(a) * bx + Math.sin(a) * by > 0; // +x points away from the house
        const join = !q.wing ? null : kind === "court" ? { start: true, end: true } : outward ? { start: true } : { end: true };
        out.houses.push({ id: `l${lot.block}-${i}w${k + 1}`, lot: i, wing: true, r: lr.fork("wing", k), building: { shape: { rect: [q.cx - q.len / 2, q.cy - q.dep / 2, q.cx + q.len / 2, q.cy + q.dep / 2] }, rot: q.rot, roof, variant, roofStyle: style, ...(join ? { join } : {}), height: 20, chimney: false } });
        reach = Math.max(reach, sb + q.back);
      });
    }
    let behind = reach + 0.15; // how far back from the street the next thing starts
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
    // The yard behind the house ends here; a croft, if any, starts exactly here, so they share one fence
    const reachBack = Math.max(houseBack, behind) + yard;
    // The croft: the back of the plot as a small fenced field
    if (wantCroft && lot.depth * 0.55 > behind) {
      const near = house ? reachBack : Math.max(behind, lot.depth * 0.55);
      const share = Math.max(0.1, Math.min(1, district.croftDepth ?? T.croftDepth ?? 1));
      const far = share >= 1 ? lot.depth * 1.6 : near + (lot.depth - near) * share;
      const slab = [[mx + nx * near - ux * 99, my + ny * near - uy * 99], [mx + nx * near + ux * 99, my + ny * near + uy * 99], [mx + nx * far + ux * 99, my + ny * far + uy * 99], [mx + nx * far - ux * 99, my + ny * far - uy * 99]];
      const piece = intersect([lot.poly], [slab]).reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
      if (piece && area(piece) > 0.5) { out.crofts.push(piece); croftOf = i; }
    }
    // Boundaries near the house only (Patrick, 24 Oct): the yard round the house and outbuilding, fenced on its
    // sides and back but not along the street, and the fence round a croft. The long back lines aren't drawn.
    const way = wayById.get(lot.way);
    if (T.bounds && house) {
      const toft = clipDepth(lot.poly, [mx, my], [ux, uy], [nx, ny], reachBack);
      if (toft) addBounds(toft, way, bClass);
    }
    // The croft's fence: all round, its sides only (open at the back, fading into the fields), or none
    const croftFence = district.croftFence ?? T.croftFence ?? "all";
    if (T.bounds && wantCroft && croftOf === i && croftFence !== "none") {
      const croft = out.crofts[out.crofts.length - 1];
      const backOf = croftFence === "sides" ? (a, b) => {
        const depthOf = ([x, y]) => (x - mx) * nx + (y - my) * ny;
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const across = Math.abs(((b[0] - a[0]) * ux + (b[1] - a[1]) * uy) / l) > 0.7;
        return across && Math.min(depthOf(a), depthOf(b)) > reachBack + 0.2;
      } : null;
      addBounds(croft, way, bClass, backOf);
    }
  });
  // Neighbours' fences on the same line become one fence (their pieces overlap with staggered ends otherwise)
  out.bounds = joinBounds(mergeCollinear(out.bounds));
  return out;
}

/** The part of a plot from its front back to a given depth. */
function clipDepth(poly, [mx, my], [ux, uy], [nx, ny], depth) {
  const slab = [[mx - nx * 0.5 - ux * 99, my - ny * 0.5 - uy * 99], [mx - nx * 0.5 + ux * 99, my - ny * 0.5 + uy * 99], [mx + nx * depth + ux * 99, my + ny * depth + uy * 99], [mx + nx * depth - ux * 99, my + ny * depth - uy * 99]];
  return intersect([poly], [slab]).reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
}

/**
 * Merges fence segments lying on one line: overlapping or touching pieces become one, so two neighbours' fences
 * along their shared side are drawn once, from the front to the deeper of the two.
 */
function mergeCollinear(segs) {
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
