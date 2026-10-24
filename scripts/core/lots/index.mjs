/**
 * Blocks and lots for one district, after Vanegas et al. 2012 (the strip method CityEngine uses) and the burgage
 * and toft-and-croft plots of real medieval towns and villages.
 *
 * Blocks: the district minus every street, road, river and square, each buffered to its width.
 * Lots: along each street side of a block, a band as deep as the district type's plots, cut square to the street
 * at varied frontages. The wider street goes first, so it takes the corner plot. Slivers are merged into their
 * neighbour. Whatever is left of a block (its middle, its back edges) is back land.
 * Everything in squares. Pure: runs anywhere.
 */
import { pointInPolygon } from "../geom.mjs";
import { bands, difference, intersect, union, offset, area, shapes, centroid } from "./poly.mjs";

/**
 * Plot numbers per district type, in feet. frontage and depth: ranges; cover: the share of the frontage the
 * house takes; houseDepth; setback: from the street; outbuilding: the chance of one behind the house; croft: the
 * chance the back of the plot is a small fenced field, croftDepth how far back it runs (a share of the plot behind
 * the yard) and croftFence how it's fenced (Patrick, 24 Oct: a quarter of village plots, half depth, open at the
 * back); bounds: whether plot boundaries are drawn; shapes: the chance a house has one rear wing (L), two (U) or
 * wings and a back range round a yard (court), the forms medieval town houses took on their plots (Pantin 1955);
 * merge: the chance a plot is joined to the one before it (a double plot); roofs: roof materials and their weights,
 * of which each district keeps `palette` (picked from its seed), so neighbouring districts can differ; styles: the
 * share of each roof form (a terrace row shares its material and form, so it reads as a row); shapes also take T (a
 * wing from the middle of the back); extras: the chance of a bay out to the street (a cross-gable), gabled dormers on
 * a long roof, a round corner turret, a long house built in stepped sections, a square shed being round, and a range
 * at the far end of a long plot (rear); fill: what the back of a plot behind the yard holds (a strip garden, an
 * orchard in rows, a few trees, open ground) by share; backBounds: faint lines between long plots behind the yard
 * (off everywhere: Patrick, 24 Oct, after renders, preferred the plots to show by what's in them);
 * wild: the spacing, in squares, of trees scattered over ground no plot takes (beyond the back lanes, inside blocks).
 */
export const LOT_TYPES = {
  hamlet: { frontage: [60, 120], depth: [140, 170], cover: [0.35, 0.55], houseDepth: [20, 30], setback: [10, 25], outbuilding: 0.5, croft: 0.4, croftDepth: 0.6, croftFence: "sides", bounds: true, shapes: { L: 0.25, T: 0.1, U: 0, court: 0 }, extras: { bay: 0.1, dormers: 0.05, turret: 0, steps: 0.2, roundShed: 0.25 },
    roofs: { thatch: 4, "wood-shingle": 2, "wood-shingle-dark": 1, "wood-shingle-light": 1, slate: 1 }, palette: 3, styles: { hip: 0.45, "half-hip": 0.3, gable: 0.25 }, fill: { orchard: 0.2, trees: 0.5, open: 0.3 }, wild: 1.3 },
  village: { frontage: [40, 80], depth: [100, 200], cover: [0.45, 0.75], houseDepth: [20, 30], setback: [5, 15], outbuilding: 0.3, croft: 0.25, croftDepth: 0.5, croftFence: "sides", bounds: true, shapes: { L: 0.25, T: 0.12, U: 0.05, court: 0 }, extras: { bay: 0.15, dormers: 0.1, turret: 0.06, steps: 0.3, roundShed: 0.2 },
    roofs: { slate: 4, "wood-shingle": 2, thatch: 2, "slate-blue": 1, "tile-red": 1, "tile-brown": 1, "wood-shingle-dark": 1 }, palette: 3, styles: { hip: 0.4, "half-hip": 0.2, gable: 0.4 }, fill: { orchard: 0.25, trees: 0.45, open: 0.3 }, wild: 1.4 },
  town: { frontage: [25, 40], depth: [200, 240], cover: [0.9, 1], houseDepth: [25, 40], setback: [0, 0], outbuilding: 0.15, croft: 0, bounds: false, merge: 0.12, shapes: { L: 0.35, T: 0.1, U: 0.1, court: 0.08 }, extras: { bay: 0, dormers: 0.25, turret: 0.08, steps: 0.5, roundShed: 0.05, rear: 0.45 },
    roofs: { slate: 3, "slate-blue": 2, "slate-purple": 1, "tile-red": 2, "tile-orange": 1, "tile-brown": 1, "wood-shingle-dark": 1 }, palette: 4, styles: { gable: 0.7, hip: 0.2, "half-hip": 0.05, flat: 0.05 }, fill: { garden: 0.3, orchard: 0.25, trees: 0.3, open: 0.15 }, backBounds: false, wild: 1.8 },
  core: { frontage: [18, 30], depth: [60, 100], cover: [1, 1], houseDepth: [30, 50], setback: [0, 0], outbuilding: 0, croft: 0, bounds: false, merge: 0.1, shapes: { L: 0.45, T: 0.1, U: 0.1, court: 0.05 }, extras: { bay: 0, dormers: 0.2, turret: 0.1, steps: 0.6, roundShed: 0 },
    roofs: { slate: 3, "slate-blue": 2, "slate-purple": 2, "tile-red": 2, "tile-orange": 1, "tile-tan": 1 }, palette: 4, styles: { gable: 0.6, hip: 0.2, flat: 0.12, mansard: 0.08 }, fill: { trees: 0.35, open: 0.65 }, wild: 2.5 },
};

export function lotTypeOf(district) {
  return LOT_TYPES[district.profile === "roadside" ? "hamlet" : district.profile] ?? LOT_TYPES.village;
}

const dist2seg = ([x, y], [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + t * dx - x, ay + t * dy - y);
};
const distToPath = (p, path) => {
  let d = Infinity;
  for (let i = 1; i < path.length; i++) d = Math.min(d, dist2seg(p, path[i - 1], path[i]));
  return d;
};

/**
 * district: the plan feature. poly: its polygon. ways: [{ id, path, width }] every road and street in it (squares).
 * water: [{ path, width }]. blocked: polygons nothing is built on (squares, yards, named buildings). ftPerSquare. r:
 * a stream for the lots. Returns { blocks: [polygon], lots: [lot], back: [polygon] }; a lot is { poly, front:
 * { a, b, mid }, along: [ux, uy], inward: [nx, ny], frontage, depth, way, block }.
 */
export function lotsFor({ district, poly, ways, water = [], blocked = [], ftPerSquare, r }) {
  const T = lotTypeOf(district);
  const sq = (ft) => ft / ftPerSquare;
  const spacious = Math.max(0, Math.min(1, district.spacious ?? 0));
  const cut = bands([
    ...ways.map((w) => ({ path: w.path, half: w.width / 2 })),
    ...water.map((w) => ({ path: w.path, half: w.width / 2 + 0.2 })),
  ]);
  // Squares, yards and named buildings keep a little clear ground round them
  const raw = difference([poly], [...cut, ...offset(blocked, 0.12)]);
  const blocks = shapes(raw).filter((b) => area(b.outer) - b.holes.reduce((s, h) => s + area(h), 0) > 0.5);
  // A fixed order, by position, so the same plan always cuts the same lots
  blocks.sort((a, b) => { const [ax, ay] = centroid(a.outer), [bx, by] = centroid(b.outer); return ay - by || ax - bx; });

  const lots = [];
  const back = [];
  blocks.forEach((block, bi) => {
    const br = r.fork("block", bi);
    const whole = [block.outer, ...block.holes];
    const depth = sq(T.depth[0] + br.next() * (T.depth[1] - T.depth[0]));
    // Plots front streets, roads and lanes; a back lane runs behind them and gets none
    const runs = frontageRuns(block.outer, ways.filter((w) => w.class !== "back"));
    // The band along the streets, as deep as a plot; the wider street cuts first, so it takes the corners
    const band = difference(whole, offset(whole, -depth));
    let claimed = [];
    runs.sort((a, b) => b.width - a.width || b.length - a.length);
    runs.forEach((run, ri) => {
      const rr = br.fork("run", ri);
      const [fmin, fmax] = T.frontage.map((f) => sq(f * (1 + 1.5 * spacious)));
      const ext = extend(run.path, depth);
      const total = pathLen(ext);
      // Cut positions: varied frontages, the last short one folded into its neighbour
      const cuts = [0];
      while (cuts[cuts.length - 1] < total) cuts.push(cuts[cuts.length - 1] + fmin + rr.next() * (fmax - fmin));
      if (cuts.length > 2 && total - cuts[cuts.length - 2] < fmin * 0.6) cuts.splice(cuts.length - 2, 1);
      cuts[cuts.length - 1] = total;
      const inward = inwardOf(run.path, block.outer);
      let prev = null, pending = null;
      for (let k = 0; k < cuts.length - 1; k++) {
        const front = subPath(ext, cuts[k], cuts[k + 1]);
        // Square to this plot's own stretch of street, so plots on a curve fan out with it
        const [fa, fb] = [front[0], front[front.length - 1]];
        const cl = Math.hypot(fb[0] - fa[0], fb[1] - fa[1]) || 1;
        let n = [-(fb[1] - fa[1]) / cl, (fb[0] - fa[0]) / cl];
        if (n[0] * inward[0] + n[1] * inward[1] < 0) n = [-n[0], -n[1]];
        // Plots meet back to back halfway to the next street behind them
        const others = runs.filter((o) => o !== run).map((o) => o.path);
        const slab = slabOf(front, n, depth * 1.6, others);
        const pieces = difference(intersect(band, [slab]), claimed);
        const piece = pieces.reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
        if (!piece || area(piece) < 0.05) continue;
        // A piece cut on the run's extension that barely touches this street is left for the street it does face
        // (on a curving block, the extension runs on past the corner along another street's frontage)
        if (frontOn({ poly: piece }, run) < fmin * 0.3) continue;
        claimed = union(claimed, [piece]);
        // Its real front: the stretch of its edge that lies on the street (a corner plot's cut front ran past it)
        const onStreet = piece.filter((p) => distToPath(p, run.path) < 0.05);
        let a = front[0], b = front[front.length - 1];
        if (onStreet.length >= 2) {
          const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
          const proj = (p) => p[0] * dx + p[1] * dy;
          onStreet.sort((p, q) => proj(p) - proj(q));
          [a, b] = [onStreet[0], onStreet[onStreet.length - 1]];
        }
        const fl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        // The middle of its front, on the street itself (on a curve the chord's middle is off it)
        const mid = nearestOn(run.path, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        const lot = {
          poly: piece, front: { a, b, mid }, along: [(b[0] - a[0]) / fl, (b[1] - a[1]) / fl], inward: n, frontage: fl,
          depth: Math.min(depth, reach(piece, mid, n)), way: run.way, block: bi,
        };
        // A sliver joins the plot beside it (the one before, or the next one if it's first)
        const sliver = area(piece) < fmin * depth * 0.35 || fl < fmin * 0.6;
        if (sliver && prev) {
          prev.poly = union([prev.poly], [piece]).reduce((x, y) => (area(y) > area(x) ? y : x));
          continue;
        }
        if (pending) {
          lot.poly = union([lot.poly], [pending]).reduce((x, y) => (area(y) > area(x) ? y : x));
          pending = null;
        }
        if (sliver) { pending = piece; continue; }
        // Now and then a plot is joined to the one before: a wealthier household's double plot (its house can be
        // wider, and on a wide plot a courtyard house or inn)
        const mergeRoll = rr.next();
        if (prev && mergeRoll < (T.merge ?? 0)) {
          const joined = union([prev.poly], [lot.poly]);
          if (joined.length === 1) {
            prev.poly = joined[0];
            const a2 = prev.front.a, b2 = lot.front.b;
            const fl2 = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]) || 1;
            prev.front = { a: a2, b: b2, mid: nearestOn(run.path, [(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2]) };
            prev.frontage = fl2;
            prev.along = [(b2[0] - a2[0]) / fl2, (b2[1] - a2[1]) / fl2];
            prev.merged = true;
            continue;
          }
        }
        lots.push(lot);
        prev = lot;
      }
    });
    for (const p of difference(whole, claimed)) if (area(p) > 0.3) back.push(p);
  });
  return { blocks: blocks.map((b) => b.outer), lots, back };
}

/** The nearest point on a path. */
function nearestOn(path, [x, y]) {
  let best = Infinity, pt = path[0];
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const q = [ax + t * dx, ay + t * dy];
    const d = Math.hypot(q[0] - x, q[1] - y);
    if (d < best) { best = d; pt = q; }
  }
  return pt;
}

/** How far a plot reaches back from a point on its front, straight in. */
function reach(poly, [x, y], [nx, ny]) {
  let d = 0;
  while (d < 40 && pointInPolygon([x + nx * (d + 0.05), y + ny * (d + 0.05)], poly)) d += 0.05;
  return d;
}

/** How much of a lot's front actually lies on its street (a corner piece can have very little). */
function frontOn(lot, run) {
  const pts = lot.poly.filter((p) => distToPath(p, run.path) < 0.05);
  if (pts.length < 2) return 0;
  let best = 0;
  for (const p of pts) for (const q of pts) best = Math.max(best, Math.hypot(p[0] - q[0], p[1] - q[1]));
  return best;
}

/**
 * The stretches of a block's edge that face a street: runs of edges lying half the street's width from its centre
 * line. Returns [{ path, way, width, length }].
 */
function frontageRuns(outer, ways) {
  const n = outer.length;
  const tag = [];
  for (let i = 0; i < n; i++) {
    const a = outer[i], b = outer[(i + 1) % n];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let best = null;
    for (const w of ways) {
      const d = Math.abs(distToPath(mid, w.path) - w.width / 2);
      if (d < 0.08 && (!best || w.width > best.width)) best = w;
    }
    tag.push(best);
  }
  // Start where the tag changes, so a run that wraps round the first corner stays whole
  let start = tag.findIndex((t, i) => t !== tag[(i - 1 + n) % n]);
  if (start < 0) start = 0;
  const runs = [];
  let cur = null;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    const t = tag[i];
    if (!t) { cur = null; continue; }
    if (!cur || cur.way !== t) { cur = { way: t, path: [outer[i]] }; runs.push(cur); }
    cur.path.push(outer[(i + 1) % n]);
  }
  return runs
    .map((r) => ({ path: r.path, way: r.way.id, width: r.way.width, length: pathLen(r.path) }))
    .filter((r) => r.length > 0.3);
}

/** The way into the block from a run: the side of its middle segment that's inside. */
function inwardOf(path, outer) {
  let best = null;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const l = Math.hypot(bx - ax, by - ay);
    if (!best || l > best.l) best = { ax, ay, bx, by, l };
  }
  const { ax, ay, bx, by, l } = best;
  const ux = (bx - ax) / l, uy = (by - ay) / l;
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  return pointInPolygon([mx - uy * 0.05, my + ux * 0.05], outer) ? [-uy, ux] : [uy, -ux];
}

/** A path carried on straight beyond both ends by d (so the corner plots reach into the corners). */
function extend(path, d) {
  const n = path.length;
  const [ax, ay] = path[0], [bx, by] = path[1];
  const l0 = Math.hypot(bx - ax, by - ay) || 1;
  const [cx, cy] = path[n - 2], [ex, ey] = path[n - 1];
  const l1 = Math.hypot(ex - cx, ey - cy) || 1;
  return [[ax - ((bx - ax) / l0) * d, ay - ((by - ay) / l0) * d], ...path, [ex + ((ex - cx) / l1) * d, ey + ((ey - cy) / l1) * d]];
}

/**
 * The front of a plot pushed back along the inward direction, by far, or less where another street lies behind
 * it (then to halfway): a slab to cut the plot from.
 */
function slabOf(front, [nx, ny], far, others = []) {
  const backPts = front.map(([x, y]) => {
    let d = far;
    for (const o of others) {
      const hit = rayHit([x + nx * 0.05, y + ny * 0.05], [nx, ny], o, far * 2);
      if (hit !== null) d = Math.min(d, hit / 2);
    }
    return [x + nx * d, y + ny * d];
  }).reverse();
  // A little in front of the street edge too, so rounding never leaves a seam
  const frontPts = front.map(([x, y]) => [x - nx * 0.05, y - ny * 0.05]);
  return [...frontPts, ...backPts];
}

/** How far along the ray from p in direction u it meets the path, up to max; null if it doesn't. */
function rayHit([px, py], [ux, uy], path, max) {
  let best = null;
  const qx = px + ux * max, qy = py + uy * max;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const rx = qx - px, ry = qy - py, sx = bx - ax, sy = by - ay;
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((ax - px) * sy - (ay - py) * sx) / den, u = ((ax - px) * ry - (ay - py) * rx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && (best === null || t * max < best)) best = t * max;
  }
  return best;
}

function pathLen(path) {
  let l = 0;
  for (let i = 1; i < path.length; i++) l += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return l;
}

/** The part of a path between two distances along it. */
function subPath(path, from, to) {
  const out = [];
  let run = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const l = Math.hypot(bx - ax, by - ay);
    const at = (d) => [ax + ((bx - ax) * (d - run)) / (l || 1), ay + ((by - ay) * (d - run)) / (l || 1)];
    if (!out.length && from <= run + l) out.push(at(Math.max(from, run)));
    if (out.length && to <= run + l) { out.push(at(to)); return out; }
    if (out.length) out.push([bx, by]);
    run += l;
  }
  return out.length >= 2 ? out : [path[0], path[path.length - 1]];
}
