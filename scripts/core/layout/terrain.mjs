/**
 * Height on a battle map: where the ground stands higher or lower, and the edges between. A height feature (a shape
 * at an elevation in feet, its edge a cliff, bank or slope) and each stream's bed (by its depth) become levels, later
 * ones over earlier (a bed cuts through a rise). Wherever the ground either side of a level's outline differs an edge
 * runs, its high side on its left (as FA's cliff and bank art is drawn), with the drop, style and rock. Pure; squares
 * and feet.
 */
import { shapeToPolygon, pointInPolygon, distanceToPath } from "../geom.mjs";
import { bands, difference } from "../lots/poly.mjs";
import { makeNoise } from "../noise.mjs";

/**
 * Sizes in squares and feet. tier: feet of drop per tier of art; step: how far each tier lies past the one above;
 * shelf: ground between a stream's water and its banks' foot; sample: how finely an outline is walked; slope: a
 * slope's run per tier; bankMost: the deepest a stream's bank stays a bank (deeper, a cliff); bankTier, bankStep,
 * bankBand: a bank's tier (FA's woodland cliff art), its step toward the water and its art's band.
 */
export const TERRAIN = { tier: 5, step: 0.38, shelf: 0.2, sample: 0.25, slope: 1.2, bankMost: 10, bankTier: 5, bankStep: 0.45, bankBand: 0.62 };
export const EDGE_STYLES = ["cliff", "bank", "slope"];
export const ROCKS = ["earthy", "slate", "mossy"];

/** The shelf of stones between a bed's water and its banks (none for a bank: its earth comes down to the water). */
export const shelfOf = (style) => (style === "bank" ? 0 : TERRAIN.shelf);
/**
 * How many tiers of art an edge with this drop (feet) is drawn in, one for every TERRAIN.tier feet (a bank's every
 * TERRAIN.bankTier), at least one.
 */
export const tiersOf = (drop, style = "cliff") => Math.max(1, Math.round(Math.abs(drop) / (style === "bank" ? TERRAIN.bankTier : TERRAIN.tier)));
/** How far an edge reaches from its line toward its low side, in squares (its art and the ground it takes). */
export function edgeSpan(e) {
  const n = tiersOf(e.drop, e.style);
  if (e.style === "slope") return n * TERRAIN.slope;
  if (e.style === "bank") return TERRAIN.bankBand + (n - 1) * TERRAIN.bankStep;
  return 0.45 + (n - 1) * TERRAIN.step;
}

/**
 * The ground a running water's band covers (share of its width), add squares past each edge, by its width at each
 * point where it varies. w: { path, width, widths }.
 */
export function waterBand(w, add = 0, share = 1) {
  const ws = Array.isArray(w?.widths) && w.widths.length === w.path?.length ? w.widths : null;
  if (!ws) return bands([{ path: w.path, half: ((w.width ?? 1) * share) / 2 + add }]);
  return bands(w.path.slice(1).map((q, i) => ({ path: [w.path[i], q], half: (Math.max(ws[i], ws[i + 1]) * share) / 2 + add })));
}

/**
 * Ice along a stream in winter: shelves along both banks with a narrower open channel between. The channel is channel
 * of the water's width, swelling by up to ragged over wave squares, its middle swinging up to sway, never under
 * least; a finer wobble (fine, fineWave) roughens its edges and now and then a bite (up to bite squares, over
 * biteWave) is broken out of a shelf. The shelves reach reach squares past the water's edge. All seeded.
 */
export const ICE = { channel: 0.42, ragged: 0.4, wave: 2.6, sway: 0.18, least: 0.6, fine: 0.16, fineWave: 0.45, bite: 0.9, biteWave: 1.7, reach: 0.45 };

/**
 * A running water's ice shelves: its band less the open channel down it. Returns { shelves: rings, channel: ring }
 * (squares), or null when the water is too short. w: { path, width, widths }.
 */
export function iceShelves(w, { seed = 1, id = "water" } = {}) {
  if (!Array.isArray(w?.path) || w.path.length < 2) return null;
  const ws = Array.isArray(w.widths) && w.widths.length === w.path.length ? w.widths : null;
  // (its path every quarter square, each point with its width and its distance along)
  const pts = [], wid = [], at = [];
  let s0 = 0;
  for (let i = 1; i < w.path.length; i++) {
    const a = w.path[i - 1], b = w.path[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 0.25));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      wid.push(ws ? ws[i - 1] + (ws[i] - ws[i - 1]) * t : w.width ?? 1);
      at.push(s0 + L * t);
    }
    s0 += L;
  }
  if (pts.length < 3) return null;
  const swell = makeNoise(seed, `ice-${id}`, { scale: ICE.wave, octaves: 2 }), sway = makeNoise(seed, `ice-sway-${id}`, { scale: ICE.wave * 2.5, octaves: 2 });
  const fine = makeNoise(seed, `ice-fine-${id}`, { scale: ICE.fineWave, octaves: 2 });
  const bite = makeNoise(seed, `ice-bite-${id}`, { scale: ICE.biteWave, octaves: 2 });
  // (a bite only where the noise runs high: most of an edge has none)
  const bitten = (v) => Math.max(0, v - 0.35) / 0.65 * ICE.bite;
  const left = [], right = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L, W = wid[i];
    const half = Math.max(ICE.least / 2, ((W * ICE.channel) / 2) * (1 + swell(at[i], 0.3) * ICE.ragged));
    // (its middle kept far enough in that the channel never reaches the bank)
    const room = Math.max(0, W / 2 - half - 0.25), mid = Math.max(-room, Math.min(room, sway(at[i], 0.6) * ICE.sway * W));
    const l = mid + half + fine(at[i], 1.1) * ICE.fine + bitten(bite(at[i], 3.7)), r = mid - half + fine(at[i], 2.3) * ICE.fine - bitten(bite(at[i], 8.9));
    left.push([p[0] + nx * l, p[1] + ny * l]);
    right.push([p[0] + nx * r, p[1] + ny * r]);
  });
  const channel = [...left, ...right.reverse()];
  const shelves = difference(waterBand(w, ICE.reach), [channel]).filter((r) => r.length >= 3);
  return { shelves, channel };
}

/** Whether a point is in a level: inside an odd number of its rings (so a ring inside another is a hole). */
function inLevel(L, p) {
  let n = 0;
  for (const ring of L.rings) if (ring.length >= 3 && pointInPolygon(p, ring)) n++;
  return n % 2 === 1;
}

/**
 * The levels and edges of a battle plan's ground. plan: smoothed; items: the layout's so far (water as laid); sq:
 * feet a square; pick(id): a feature's random stream. Returns { levels: [{ id, from, name, rings, elevation, style,
 * rock, bed, water, waterClass, within }], edges, elevAt(p), notes } (within: the hollow a stream's pool fills).
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
    // (a cliff's Climb DC when the plan gives one; a straight one is a cut or built face, harder to climb)
    levels.push({ id: f.id, from: f.id, name: f.name ?? null, rings: [ring], elevation: h, style, rock, bed: false, ...(f.climbDC != null ? { climbDC: f.climbDC } : {}), ...(f.straight ? { built: true } : {}) });
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
    // (its bed below the lowest ground it runs over: through a rise a gorge; a hollow it passes takes the bed down
    // below it)
    const along = resample(w.path, 0.5), ks = along.map((p) => top(p, before));
    const under = ks.map((k) => (k < 0 ? 0 : levels[k].elevation));
    const level = under.filter((e) => e >= 0);
    const base = level.length ? Math.min(...level) : under.length ? Math.min(...under) : 0;
    const style = EDGE_STYLES.includes(f.banks) ? f.banks : "bank";
    // (the bed: the water, a shelf of stones each side below a cliff, and the banks coming down to it)
    const rings = waterBand(w, shelfOf(style) + edgeSpan({ drop: depth, style }));
    if (!rings.length) continue;
    const rock = ROCKS.includes(f.rock) ? f.rock : pick(w.from ?? w.id).fork("rock").pick(ROCKS);
    levels.push({ id: `${w.id}/bed`, from: w.from ?? w.id, name: null, rings, elevation: base - depth, style, rock, bed: true, water: w.id, waterClass: w.class, ...(f.climbDC != null ? { climbDC: f.climbDC } : {}) });
    // (each hollow it runs through fills as a pool its depth below the hollow's floor, the hollow's edge its shore;
    // inner hollows over outer ones, and only where it's the ground seen)
    for (const k of [...new Set(ks.filter((k) => k >= 0 && levels[k].elevation < base))].sort((a, b) => a - b)) {
      const H = levels[k], over = levels.slice(k + 1, before).flatMap((x) => x.rings);
      const seen = over.length ? difference(H.rings, over) : H.rings.map((r) => r.map((p) => [...p]));
      if (!seen.length) continue;
      levels.push({ id: `${w.id}/pool-${H.id}`, from: w.from ?? w.id, name: null, rings: seen, elevation: H.elevation - depth, style: H.style, rock: H.rock, bed: true, water: w.id, waterClass: w.class, within: H.id, shore: base - (H.elevation - depth), ...(H.climbDC != null ? { climbDC: H.climbDC } : {}), ...(H.built ? { built: true } : {}) });
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
        out.push({ kind: "edge", id: `${L.id}/edge${++n}`, from: L.from, path, closed: closedAll, drop: r.hi - r.lo, high: r.hi, low: r.lo, style, rock: L.rock, bed: L.bed, ...(r.fall ? { fall: true, water: L.water } : {}), ...(L.shore ? { shore: L.shore } : {}), ...(L.within ? { pool: L.id } : {}), ...(L.climbDC != null ? { climbDC: L.climbDC } : {}), ...(L.built ? { built: true } : {}) });
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
