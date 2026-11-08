/**
 * Height in play: a battle map's ground, its banks and cliffs, and its water as the regions a scene gets, and how a
 * token's elevation and its walking follow them.
 *
 * heightRegions turns a battle layout into region specs (in squares): the ground of each level at its elevation (a
 * rise, a hollow, a stream's bed, a bridge's deck over it), the face of each edge (a cliff to climb, a bank or a slope
 * that slows a walker), and the water (shallows that slow a walker; deep water to swim; ice that slows). Publishing
 * makes each a Region. groundAt and walkBlocked read those regions back as zones (in any one unit: squares here,
 * pixels in the scene), for the hook that sets a token's elevation and keeps a walker off a cliff face and out of deep
 * water.
 *
 * Pure: runs in the worker, the page and under node.
 */
import { pointInPolygon, insidePoint } from "./geom.mjs";
import { bands, difference, intersect, offset } from "./lots/poly.mjs";
import { edgeSpan, shiftRight, resample } from "./layout/terrain.mjs";
import { footprint } from "./layout/battle.mjs";

/**
 * shallows: how far shallow water reaches in from a river's or a pond's edge before it turns deep, in squares;
 * deepest: a river or canal narrower than twice that plus this has no deep middle.
 */
export const HEIGHT = { shallows: 1, deepest: 0.8 };
/** The movement actions that walk on the ground: those a cliff face and deep water stop. */
export const WALKING = ["walk", "crawl", "travel", "deploy", "drive"];
/** The movement actions that keep a token's elevation its own: no ground sets it. */
export const OFF_GROUND = ["fly", "burrow"];
/**
 * What each region does to a walker's cost: 2 difficult terrain, 3 greater difficult terrain (the most a Pathfinder
 * scene allows). A cliff costs nothing more: its face is drawn on the low ground at its foot, where a token may stand
 * and walk along it; what stops a walker is crossing the cliff's top line, which the hook checks (walkBlocked), as it
 * stops one walking into deep water.
 */
export const COST = { cliff: null, bank: 2, slope: 2, shallow: 2, deep: 3, ice: 2 };
/** The words each region is named by in the scene's region list. */
const FACE_NAME = { cliff: "Cliff face (climb)", bank: "Steep bank", slope: "Slope" };

/** Whether a point lies in a level or zone: inside an odd number of its rings (a ring inside another is a hole). */
export function inRings(rings, p) {
  let n = 0;
  for (const ring of rings) if (ring.length >= 3 && pointInPolygon(p, ring)) n++;
  return n % 2 === 1;
}

/** Rings as region polygons: each a hole when it lies inside an odd number of the others. */
export function withHoles(rings) {
  const ok = rings.filter((r) => r.length >= 3);
  return ok.map((ring, i) => {
    const p = ring[0];
    const around = ok.filter((o, j) => j !== i && pointInPolygon(p, o)).length;
    return { points: ring, hole: around % 2 === 1 };
  });
}

/** The elevation of the ground at a point from a layout's levels (the topmost there, beds included; 0 off them). */
export function levelAt(items, p) {
  const levels = items.filter((i) => i.kind === "level");
  for (let k = levels.length - 1; k >= 0; k--) if (inRings(levels[k].rings, p)) return levels[k].elevation;
  return 0;
}

/** The ground a building group stands on: the level under its parts' middle (0 off every level). */
export function groundOf(layout, parts) {
  const fs = parts.flatMap((b) => footprint(b));
  if (!fs.length) return 0;
  return levelAt(layout.items, [fs.reduce((a, p) => a + p[0], 0) / fs.length, fs.reduce((a, p) => a + p[1], 0) / fs.length]);
}

/** A crossing's deck: the rectangle it covers, in squares. */
export function deckOf(c) {
  const a = ((c.angle ?? 0) * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux, hl = (c.length ?? 2) / 2, hw = (c.width ?? 4) / 2;
  return [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([u, v]) => [c.at[0] + u * ux + v * nx, c.at[1] + u * uy + v * ny]);
}

/**
 * A battle layout's height as region specs, in squares:
 * { kind: "ground", name, polys, elevation, order, over } (over: a bridge's deck, ground only for a token up on it),
 * { kind: "face", name, polys, style, bottom, top, cost, lines, alone } (lines: a cliff's top line, its high side on
 * its left; alone: a cliff drawn as a line, with the same ground either side),
 * { kind: "shallow" | "deep" | "ice", name, polys, top, cost }, polys being [{ points, hole }].
 * A face's range runs from the low ground to the high (a token walking down it is still at the top's elevation until
 * it lands); water's from below to the ground above its banks (a token wading in from the bank is still at the bank's).
 */
export function heightRegions(layout) {
  const items = layout?.items ?? [];
  const [W, H] = layout?.size?.squares ?? [0, 0];
  const map = W > 0 && H > 0 ? [[[0, 0], [W, 0], [W, H], [0, H]]] : null;
  const clip = (polys) => (map ? intersect(polys, map) : polys);
  const levels = items.filter((i) => i.kind === "level");
  const top = (p, beds) => { for (let k = levels.length - 1; k >= 0; k--) if ((beds || !levels[k].bed) && inRings(levels[k].rings, p)) return levels[k].elevation; return 0; };
  // (the ground a bed is cut into: the level under it, beds left out)
  const baseAt = (p) => top(p, false);
  const out = [];
  levels.forEach((L, order) => {
    const polys = withHoles(clip(L.rings));
    if (!polys.length) return;
    const what = L.bed ? `${L.waterClass === "river" ? "River" : L.waterClass === "canal" ? "Canal" : "Stream"} bed` : L.name ?? (L.elevation < 0 ? "Hollow" : "Rise");
    out.push({ kind: "ground", name: `${what} (${L.elevation} ft)`, polys, elevation: L.elevation, order, over: false });
  });
  // A bridge's deck: ground at its banks' height, over the bed it spans (a footbridge's as a road bridge's)
  const decks = [];
  for (const c of items.filter((i) => i.kind === "crossing" && i.class !== "ford" && Array.isArray(i.at))) {
    const deck = deckOf(c);
    decks.push(deck);
    const e = baseAt(c.at);
    if (levels.length) out.push({ kind: "ground", name: `${c.class === "footbridge" ? "Footbridge" : "Bridge"} (${e} ft)`, polys: withHoles(clip([deck])), elevation: e, order: levels.length + decks.length, over: true });
  }
  // (a deck takes its ground out of what it spans: no bank, cliff or water under a token crossing it)
  const offDecks = (polys) => (decks.length ? difference(polys, decks) : polys);
  for (const e of items.filter((i) => i.kind === "edge")) {
    const span = edgeSpan(e);
    const band = bands([{ path: shiftRight(resample(e.path, 0.5), span / 2), half: span / 2 }]);
    const polys = withHoles(clip(offDecks(band)));
    if (polys.length) out.push({ kind: "face", name: FACE_NAME[e.style] ?? "Bank", polys, style: e.style, bottom: e.low, top: e.high, cost: COST[e.style] ?? null, lines: e.style === "cliff" ? [e.path] : [], alone: !!e.line });
  }
  const fords = items.filter((i) => i.kind === "crossing" && i.class === "ford" && Array.isArray(i.at)).map(deckOf);
  for (const w of items.filter((i) => i.kind === "water")) {
    let area, deep = [], at;
    if (Array.isArray(w.path) && w.path.length >= 2) {
      // (a width at each point when it widens; else one all along)
      const ws = Array.isArray(w.widths) && w.widths.length === w.path.length ? w.widths : w.path.map(() => w.width ?? 1);
      const segs = w.path.slice(1).map((q, i) => ({ path: [w.path[i], q], w: Math.max(ws[i], ws[i + 1]) }));
      area = bands(segs.map((s) => ({ path: s.path, half: s.w / 2 })));
      // (a river's or a canal's middle is deep, a shallow edge each side; a stream is shallow all across)
      if (w.class !== "stream") deep = bands(segs.map((s) => ({ path: s.path, half: s.w / 2 - HEIGHT.shallows })).filter((s) => s.half >= HEIGHT.deepest / 2));
      // (its water reaches up to the highest bank it runs between, so a token wading in from any bank counts)
      at = resample(w.path, 0.5).reduce((best, p) => (baseAt(p) > baseAt(best) ? p : best), w.path[0]);
    } else if (Array.isArray(w.poly) && w.poly.length >= 3) {
      area = [w.poly];
      deep = offset([w.poly], -HEIGHT.shallows);
      at = insidePoint(w.poly);
    } else continue;
    if (fords.length && deep.length) deep = difference(deep, fords);
    const surface = baseAt(at);
    const name = w.class === "moat" ? "moat" : w.class ?? "water";
    if (w.frozen) {
      const polys = withHoles(clip(offDecks(area)));
      if (polys.length) out.push({ kind: "ice", name: `Ice (${name})`, polys, top: surface, cost: COST.ice });
      continue;
    }
    const shallow = withHoles(clip(offDecks(deep.length ? difference(area, deep) : area)));
    if (shallow.length) out.push({ kind: "shallow", name: `Shallow water (${name})`, polys: shallow, top: surface, cost: COST.shallow });
    const dp = deep.length ? withHoles(clip(offDecks(deep))) : [];
    if (dp.length) out.push({ kind: "deep", name: `Deep water (${name}, swim)`, polys: dp, top: surface, cost: COST.deep });
  }
  return out;
}

/** Whether a point is in a zone ({ polys: [{ points }] }, read even-odd). */
export const inZone = (z, p) => inRings(z.polys.map((q) => q.points ?? q), p);

/**
 * The ground's elevation at a point: the topmost level there (0 where none is), a bridge's deck counting only for a
 * token already about as high as it (one wading under it stays in the bed). current: the token's elevation now.
 */
export function groundAt(zones, p, current = Infinity) {
  let best = null;
  for (const z of zones) {
    if (z.kind !== "ground" || (z.over && !(z.elevation <= current + 1))) continue;
    if ((!best || z.order > best.order) && inZone(z, p)) best = z;
  }
  return best ? best.elevation : 0;
}

/** The distance from point p to segment c-d. */
function toSeg(p, c, d) {
  const dx = d[0] - c[0], dy = d[1] - c[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - c[0]) * dx + (p[1] - c[1]) * dy) / l2)) : 0;
  return Math.hypot(c[0] + dx * t - p[0], c[1] + dy * t - p[1]);
}

/** The distance between segments a-b and c-d (0 when they cross). */
function segGap(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  if (o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0) return 0;
  return Math.min(toSeg(a, c, d), toSeg(b, c, d), toSeg(c, a, b), toSeg(d, a, b));
}

/** Which side of a line a point is on: 1 the high side (left of the way it runs), 0 the low side or on it. */
function sideOf(line, p, near) {
  let best = Infinity, side = 0;
  for (let i = 1; i < line.length; i++) {
    const c = line[i - 1], d = line[i], g = toSeg(p, c, d);
    if (g < best) { best = g; side = (d[0] - c[0]) * (p[1] - c[1]) - (d[1] - c[1]) * (p[0] - c[0]) < 0 ? 1 : 0; }
  }
  return best <= near ? 0 : side;
}

/**
 * Whether a walking step from a to b is stopped, and why: "cliff" when it goes up or down a cliff (it passes within
 * `near` of a cliff's top line and the ground under its two ends differs, so walking along a cliff's top or foot, or
 * across a bridge's deck over one, isn't stopped; for a cliff drawn as a line, with the same ground both sides, when
 * its ends lie on different sides of the line, a point on the line counting as below it), "deep" when it runs into
 * deep water from out of it (a token already swimming may walk out). step: how finely the way is checked for water;
 * near: how close to a line counts as on it (both in the zones' unit); current: the token's elevation (for a deck).
 */
export function walkBlocked(zones, a, b, step, { near = step * 0.2, current = Infinity } = {}) {
  let ground = null;
  for (const z of zones) {
    if (z.kind !== "face" || z.style !== "cliff") continue;
    for (const line of z.lines ?? []) {
      let close = false;
      for (let i = 1; i < line.length && !close; i++) close = segGap(a, b, line[i - 1], line[i]) <= near;
      if (!close) continue;
      if (z.alone) { if (sideOf(line, a, near) !== sideOf(line, b, near)) return "cliff"; continue; }
      ground ??= [groundAt(zones, a, current), groundAt(zones, b, current)];
      if (ground[0] !== ground[1]) return "cliff";
    }
  }
  const deep = zones.filter((z) => z.kind === "deep" && !inZone(z, a));
  if (deep.length) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / Math.max(step, 1e-6)));
    for (let k = 1; k <= n; k++) {
      const p = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
      if (deep.some((z) => inZone(z, p))) return "deep";
    }
  }
  return null;
}
