/**
 * High and wet ground on a settlement or battle map (areas of class hills, mountains or marsh): hills as rising
 * ground, shaded from the sun and ringed with contours, rocky outcrops on their tops; mountains as steep rock, their
 * contours close, crags and scree; a marsh as damp ground with reeds. Nothing is built on mountains or in a marsh;
 * hills take houses as any ground does. Squares; pure: runs anywhere.
 */
import { bbox, pointInPolygon, shapeToPolygon } from "../geom.mjs";
import { offset, signedArea } from "../lots/poly.mjs";
import { poissonInPolygon } from "../scatter.mjs";

/** A ring's corners rounded (Chaikin's cutting, twice), so a contour reads as ground, not a staircase. */
function rounded(ring) {
  let pts = ring;
  for (let t = 0; t < 2; t++) pts = pts.flatMap((a, i) => { const b = pts[(i + 1) % pts.length]; return [[a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]]; });
  return pts;
}

/** A ring nudged in and out a little (by a fraction of a step, smoothly along it), so rings drawn in from one outline don't run parallel. */
const wavy = (ring, step, k) => ring.map(([x, y]) => { const w = (Math.sin(x * 0.55 + k * 1.7) + Math.cos(y * 0.6 - k * 1.1)) * step * 0.14; return [x + w, y + w * 0.6]; });

/** Contours: the outline drawn in by step squares again and again, while anything is left (at most `most` rings). */
function contoursOf(poly, step, most) {
  const out = [];
  let rings = [poly];
  for (let k = 1; k <= most && rings.length; k++) {
    rings = offset([poly], -step * k).filter((r) => r.length >= 3 && Math.abs(signedArea(r)) > step * step);
    out.push(...rings.map((r) => ({ level: k, ring: wavy(rounded(r), step, k) })));
  }
  return out;
}

/** A blob of rock around c, about rad across. */
const rockBlob = (r, c, rad) => Array.from({ length: 9 }, (_, k) => { const a = (2 * Math.PI * k) / 9, d = rad * (0.6 + r.next() * 0.6); return [c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d]; });

/**
 * Lays out one hills, mountains or marsh area f, its stream r; sq: feet a square. Returns { items, reserve } (reserve:
 * polygons nothing else is built on).
 */
export function layRelief(f, r, { sq = 25 } = {}) {
  const poly = shapeToPolygon(f.shape, f.rot ?? 0);
  if (poly.length < 3) return { items: [], reserve: [] };
  const ft = (v) => v / sq;
  const [x0, y0, x1, y1] = bbox(poly), span = Math.min(x1 - x0, y1 - y0);
  if (f.class === "marsh") {
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const pools = poissonInPolygon(poly, clamp(ft(60), 1.5, 5), r.fork("pools"), { max: 400 }).filter((_, k) => k === 0 || r.next() < 0.5).map((c) => rounded(rockBlob(r, c, clamp(ft(18), 0.4, 1.6)))).filter((b) => b.every((p) => pointInPolygon(p, poly)));
    // (as many tufts as the marsh holds, so a big one has no bare stretches; a pool's box tested before its outline)
    const spacing = clamp(ft(14), 0.5, 1.2), room = Math.ceil((1.3 * Math.abs(signedArea(poly))) / (spacing * spacing)) + 100;
    const boxes = pools.map((q) => bbox(q));
    const inPool = ([x, y]) => pools.some((q, k) => { const [a, b, c, d] = boxes[k]; return x >= a && x <= c && y >= b && y <= d && pointInPolygon([x, y], q); });
    const tufts = poissonInPolygon(poly, spacing, r.fork("tufts"), { max: Math.min(60000, room) }).filter((p) => !inPool(p)).map(([x, y]) => [x, y, r.next()]);
    return { items: [{ kind: "relief", id: f.id, from: f.id, class: "marsh", poly, tufts, pools }], reserve: [poly] };
  }
  const steep = f.class === "mountains";
  // (contours some tens of feet apart up a hill, closer on a mountain; on a battle map's small hill, a few rings at least)
  const step = Math.max(span / 14, Math.min(steep ? ft(30) : ft(55), span / 5));
  const contours = contoursOf(poly, step, steep ? 10 : 5);
  // Outcrops on a hill's upper ground, crags and scree on a mountain
  // (the rings at one level only: a higher ring lies inside a lower one, so taking both would crowd the summit)
  const levels = Math.max(0, ...contours.map((c) => c.level)), at = Math.min(steep ? 3 : 2, Math.max(1, levels - 1));
  const top = contours.filter((c) => c.level === at).map((c) => c.ring);
  const zone = top.length ? top : [poly];
  const rocks = [];
  // (spaced some tens of feet apart, but never more than 4 squares: a battle map's hill has its rocks too)
  for (const z of zone) for (const c of poissonInPolygon(z, Math.min(4, Math.max(1.2, ft(steep ? 70 : 110))), r.fork("rocks", rocks.length), { max: 600 })) {
    if (r.next() < (steep ? 0.65 : 0.6)) continue;
    rocks.push(rockBlob(r, c, Math.max(0.3, Math.min(0.9, ft(steep ? 18 : 12))) * (0.7 + r.next() * 0.6)));
  }
  const inside = rocks.filter((b) => b.every((p) => pointInPolygon(p, poly)));
  return { items: [{ kind: "relief", id: f.id, from: f.id, class: f.class, poly, contours, rocks: inside, step }], reserve: steep ? [poly] : [] };
}
