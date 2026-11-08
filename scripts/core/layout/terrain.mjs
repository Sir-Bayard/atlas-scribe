/**
 * Height on a battle map: where the ground stands higher or lower, and the edges between.
 *
 * The plan draws a rise or a hollow as a `height` feature (a shape with the elevation its ground stands at, in feet,
 * and how its edge comes down: a cliff, a bank or a walkable slope), and a stream or river runs in a bed below its
 * banks by its `depth`. Each becomes a level: polygons at one elevation, later ones over earlier (a bed cuts through a
 * rise). The edges are worked out from the levels: wherever the ground on either side of a level's outline stands at
 * different heights, an edge runs, drawn with its high side on its left (as FA's cliff and bank art is drawn, its top
 * toward the high ground), carrying the drop, the style of the level whose outline it is, and its rock.
 *
 * Pure: runs in the worker and under node. Positions in squares, heights in feet.
 */
import { shapeToPolygon, pointInPolygon, distanceToPath } from "../geom.mjs";
import { bands, difference } from "../lots/poly.mjs";

/**
 * Sizes, in squares and feet. tier: the feet of drop each tier of a cliff or bank stands for (one strip of art a
 * tier); step: how far each tier lies past the one above it, toward the low side; shelf: the ground between a
 * stream's water and the foot of its banks; sample: how finely an outline is walked to find its edges; slope: how
 * far a walkable slope runs for each tier of drop; bankMost: the deepest a stream's bank is drawn as a bank (deeper, a
 * cliff); bankTier, bankStep, bankBand: a bank's tier stands for 5 ft (FA's woodland cliff art, a face of earth and
 * roots under a grassy top, as a GM draws a stream's banks), each tier set out past the one above it toward the
 * water, its art's band this deep.
 */
export const TERRAIN = { tier: 5, step: 0.38, shelf: 0.2, sample: 0.25, slope: 1.2, bankMost: 10, bankTier: 5, bankStep: 0.45, bankBand: 0.62 };
export const EDGE_STYLES = ["cliff", "bank", "slope"];
export const ROCKS = ["earthy", "slate", "mossy"];

/** How many tiers of art an edge with this drop (feet) is drawn in: a cliff's one for every five feet, a bank's ten. */
/** The shelf of stones between a bed's water and its banks: a bank's earth comes down to the water itself. */
export const shelfOf = (style) => (style === "bank" ? 0 : TERRAIN.shelf);
export const tiersOf = (drop, style = "cliff") => Math.max(1, Math.round(Math.abs(drop) / (style === "bank" ? TERRAIN.bankTier : TERRAIN.tier)));
/** How far an edge reaches from its line toward its low side, in squares (its art and the ground it takes). */
export function edgeSpan(e) {
  const n = tiersOf(e.drop, e.style);
  if (e.style === "slope") return n * TERRAIN.slope;
  if (e.style === "bank") return TERRAIN.bankBand + (n - 1) * TERRAIN.bankStep;
  return 0.45 + (n - 1) * TERRAIN.step;
}

/** Whether a point is in a level: inside an odd number of its rings (so a ring inside another is a hole). */
function inLevel(L, p) {
  let n = 0;
  for (const ring of L.rings) if (ring.length >= 3 && pointInPolygon(p, ring)) n++;
  return n % 2 === 1;
}

/**
 * The levels and edges of a battle plan's ground.
 * plan: the smoothed plan (height features, running water with their widths in items); items: the layout's items so far
 * (water as laid); sq: feet a square; pick(id): a random stream for a feature (for its rock when the plan leaves it out).
 * Returns { levels: [{ id, from, name, rings, elevation, style, rock, bed, water, waterClass, within }], edges: [...], elevAt(p),
 * notes } (within: the hollow a stream's water fills, a pool below the rest of its bed; shore: how far the pool lies
 * below the ground around its hollow, which its edges' tiers are laid by, so a fall's line up with the shore's).
 */
export function terrainOf({ plan, items, sq, pick }) {
  const levels = [], notes = [];
  for (const f of plan.features.filter((x) => x.type === "height" && x.shape)) {
    // (its corners rounded, as ground lies, unless the plan wants it straight: a quarry's cut, a built terrace)
    const given = shapeToPolygon(f.shape, f.rot ?? 0);
    if (given.length < 3) continue;
    const ring = f.straight ? given : roundCorners(given, 2);
    const h = Number.isFinite(f.height) ? f.height : 10;
    const style = EDGE_STYLES.includes(f.edge) ? f.edge : Math.abs(h) <= TERRAIN.tier ? "bank" : "cliff";
    const rock = ROCKS.includes(f.rock) ? f.rock : pick(f.id).fork("rock").pick(ROCKS);
    levels.push({ id: f.id, from: f.id, name: f.name ?? null, rings: [ring], elevation: h, style, rock, bed: false });
  }
  // (the ground a point stands on, before the beds: a stream through a rise is sunk below the rise)
  const top = (p, upto = levels.length) => { for (let k = upto - 1; k >= 0; k--) if (inLevel(levels[k], p)) return k; return -1; };
  const elevAt = (p) => { const k = top(p); return k < 0 ? 0 : levels[k].elevation; };
  const byId = new Map(plan.features.map((f) => [f.id, f]));
  const before = levels.length;
  for (const w of items.filter((i) => i.kind === "water" && Array.isArray(i.path) && i.path.length >= 2)) {
    const f = byId.get(w.from) ?? {};
    // (a pond, lake or sea drawn along a path, and a moat, lie at the ground's level: no bed)
    const depth = Number.isFinite(f.depth) ? f.depth : ({ stream: 5, river: 10, canal: 5 }[w.class] ?? 0);
    if (!(depth > 0)) continue;
    // (its bed below the lowest ground it runs over, so it never stands above the ground beside it; through a rise
    // it cuts a gorge, its banks there as deep as the rise is high. A hollow it passes through takes the bed down with
    // it, below; a stream wholly in a hollow lies below the hollow)
    const along = resample(w.path, 0.5), ks = along.map((p) => top(p, before));
    const under = ks.map((k) => (k < 0 ? 0 : levels[k].elevation));
    const level = under.filter((e) => e >= 0);
    const base = level.length ? Math.min(...level) : under.length ? Math.min(...under) : 0;
    const style = EDGE_STYLES.includes(f.banks) ? f.banks : "bank";
    // (the bed: the water, a shelf of stones each side below a cliff, and the banks coming down to it)
    const rings = bands([{ path: w.path, half: (w.width ?? 1) / 2 + shelfOf(style) + edgeSpan({ drop: depth, style }) }]);
    if (!rings.length) continue;
    const rock = ROCKS.includes(f.rock) ? f.rock : pick(w.from ?? w.id).fork("rock").pick(ROCKS);
    levels.push({ id: `${w.id}/bed`, from: w.from ?? w.id, name: null, rings, elevation: base - depth, style, rock, bed: true, water: w.id, waterClass: w.class });
    // (each hollow it runs through fills with its water, a pool its depth below the hollow's floor, the hollow's own
    // edge its shore: a level of its own over the hollow and the bed, so the stream falls into it and out again)
    // (in the order the hollows lie, so one inside another is filled over it; each only where it's the ground seen, not
    // under a rise or hollow laid over it)
    for (const k of [...new Set(ks.filter((k) => k >= 0 && levels[k].elevation < base))].sort((a, b) => a - b)) {
      const H = levels[k], over = levels.slice(k + 1, before).flatMap((x) => x.rings);
      const seen = over.length ? difference(H.rings, over) : H.rings.map((r) => r.map((p) => [...p]));
      if (!seen.length) continue;
      levels.push({ id: `${w.id}/pool-${H.id}`, from: w.from ?? w.id, name: null, rings: seen, elevation: H.elevation - depth, style: H.style, rock: H.rock, bed: true, water: w.id, waterClass: w.class, within: H.id, shore: base - (H.elevation - depth) });
    }
  }
  return { levels, edges: edgesOf(levels), elevAt, notes };
}

/**
 * The edges between levels: each level's outline walked every TERRAIN.sample squares, and wherever the ground either
 * side of it differs (and this level is the one seen on its inner side), a piece of edge, joined into runs of one drop
 * and style. A boundary two levels share is drawn once, by the higher one.
 */
export function edgesOf(levels) {
  const topAt = (p) => { for (let k = levels.length - 1; k >= 0; k--) if (inLevel(levels[k], p)) return k; return -1; };
  const elev = (k) => (k < 0 ? 0 : levels[k].elevation);
  const nearRing = (k, p) => levels[k].rings.some((ring) => distanceToPath(p, [...ring, ring[0]]) < 0.08);
  const out = [];
  levels.forEach((L, li) => {
    let n = 0;
    for (const ring of L.rings) {
      if (ring.length < 3) continue;
      const pts = resample([...ring, ring[0]], TERRAIN.sample);
      const segs = [];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
        if (len < 0.01) continue;
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], lf = [dy / len, -dx / len];
        const pl = [m[0] + lf[0] * 0.06, m[1] + lf[1] * 0.06], pr = [m[0] - lf[0] * 0.06, m[1] - lf[1] * 0.06];
        const kl = topAt(pl), kr = topAt(pr);
        const inside = inLevel(L, pl) ? kl : kr, outside = inLevel(L, pl) ? kr : kl;
        if (inside !== li || elev(kl) === elev(kr)) { segs.push(null); continue; }
        // (a lower level whose outline runs along a higher one's: the higher draws it)
        if (elev(outside) > L.elevation && outside >= 0 && nearRing(outside, m)) { segs.push(null); continue; }
        // (a step between two stretches of one stream's bed, as where it falls into a hollow: a fall across its water)
        const fall = L.bed && outside >= 0 && levels[outside].bed && levels[outside].water === L.water;
        segs.push({ a, b, hiLeft: elev(kl) > elev(kr), hi: Math.max(elev(kl), elev(kr)), lo: Math.min(elev(kl), elev(kr)), fall });
      }
      // Runs of pieces with one drop (a ring's last run joined to its first when they meet)
      const runs = [];
      let cur = null;
      for (const s of segs) {
        if (s && cur && cur.hi === s.hi && cur.lo === s.lo && cur.hiLeft === s.hiLeft && cur.fall === s.fall) cur.pts.push(s.b);
        else { if (cur) runs.push(cur); cur = s ? { pts: [s.a, s.b], hi: s.hi, lo: s.lo, hiLeft: s.hiLeft, fall: s.fall } : null; }
      }
      if (cur) runs.push(cur);
      const closedAll = runs.length === 1 && segs.every(Boolean);
      if (runs.length > 1 && segs[0] && segs.at(-1)) {
        const f = runs[0], l = runs.at(-1);
        if (f.hi === l.hi && f.lo === l.lo && f.hiLeft === l.hiLeft && f.fall === l.fall && l !== f) { l.pts.push(...f.pts.slice(1)); runs.shift(); }
      }
      for (const r of runs) {
        // (a run a hair long: a spike in the outline, not an edge)
        if (r.pts.length < 2 || pathLength(r.pts) < 0.3) continue;
        const path = r.hiLeft ? r.pts : [...r.pts].reverse();
        // (a bed's bank deeper than TERRAIN.bankMost, where it cuts through higher ground, is a cliff)
        // (a pool's shore is its hollow's own edge, kept as the hollow has it)
        const style = L.bed && !L.within && L.style === "bank" && r.hi - r.lo > TERRAIN.bankMost ? "cliff" : L.style;
        out.push({ kind: "edge", id: `${L.id}/edge${++n}`, from: L.from, path, closed: closedAll, drop: r.hi - r.lo, high: r.hi, low: r.lo, style, rock: L.rock, bed: L.bed, ...(r.fall ? { fall: true, water: L.water } : {}), ...(L.shore ? { shore: L.shore } : {}), ...(L.within ? { pool: L.id } : {}) });
      }
    }
  });
  return out;
}

/** A closed ring with its corners cut (Chaikin's method, `times` over): each corner becomes a curve. */
export function roundCorners(ring, times = 2) {
  let pts = ring;
  for (let t = 0; t < times; t++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = out;
  }
  return pts;
}

/** The point halfway along a path, by its length. */
export function halfway(path) {
  let left = pathLength(path) / 2;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l >= left && l > 0) return [a[0] + ((b[0] - a[0]) * left) / l, a[1] + ((b[1] - a[1]) * left) / l];
    left -= l;
  }
  return [...path[path.length - 1]];
}

/** A path's length. */
const pathLength = (p) => { let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return s; };

/** A path with its points spaced about `step` apart (its own points kept). */
export function resample(path, step) {
  const out = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** A path moved d squares to its right (its low side, as edges run), each point along the mean of its sides' normals. */
export function shiftRight(path, d) {
  if (!d) return path.map((p) => [...p]);
  return path.map((p, i) => {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    return [p[0] - (dy / L) * d, p[1] + (dx / L) * d];
  });
}
