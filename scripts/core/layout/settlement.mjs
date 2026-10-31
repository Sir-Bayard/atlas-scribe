/**
 * The settlement fill outside the plots: farmsteads, woods, hedgerows and ground patches (houses stand on plots,
 * in lots/). Numbers are in squares and were tuned on a 25 ft square (a village overview). Pure: runs anywhere.
 */
import { bbox, pointInPolygon, rotateAbout, shapeToPolygon } from "../geom.mjs";
import { poissonInPolygon } from "../scatter.mjs";
import { WOOD_DENSITY } from "../plan.mjs";
import { makeNoise } from "../noise.mjs";

/** Cap on random tries for one area, so a huge or odd shape can't run on for ever. */
const MAX_TRIES = 20000;
const MAX_CHARACTER = 60000; // a sparse, open or dense wood's ceiling, however big

/** True when every corner of a polygon is inside another. */
const inside = (pts, poly) => pts.every((p) => pointInPolygon(p, poly));

/**
 * A farmstead: its yard (the area's shape, turned by rot), a house near the yard's top left and a barn across from
 * it, turned with the yard. Each building is placed only if it fits the yard and keeps clear of what's already
 * there. Returns notes for anything left out.
 */
export function fillFarmstead({ area, r, free, addBuilding, items }) {
  const notes = [];
  const rot = area.rot ?? 0;
  const flat = shapeToPolygon(area.shape);
  if (flat.length < 3) return notes;
  const [x0, y0, x1, y1] = bbox(flat);
  const c = [(x0 + x1) / 2, (y0 + y1) / 2];
  const yard = rot ? flat.map((p) => rotateAbout(p, c, rot)) : flat;
  items.push({ kind: "surface", id: `${area.id}/yard`, from: area.id, class: "farmyard", poly: yard, surface: "trodden" });
  // Draw every choice first, so the stream is the same whatever fits
  const houseRoof = r.pick(["slate", "slate", "wood-shingle", "wood-shingle"]);
  const hx = x0 + 1.6, hy = y0 + 1.2;
  const parts = [
    { id: `${area.id}/house`, at: [hx, hy], len: 2.4, dep: 1.3, rot, roof: houseRoof, chimney: undefined, r: r.fork("house") },
    { id: `${area.id}/barn`, at: [hx + 1.6, hy + 2.0], len: 2.0, dep: 1.4, rot: rot + 90, roof: "wood-shingle", chimney: false, r: r.fork("barn") },
  ];
  for (const b of parts) {
    const [cx, cy] = rot ? rotateAbout(b.at, c, rot) : b.at;
    const shape = { rect: [cx - b.len / 2, cy - b.dep / 2, cx + b.len / 2, cy + b.dep / 2] };
    const foot = shapeToPolygon(shape, b.rot);
    if (!inside(foot, yard)) {
      notes.push({ level: "warning", id: area.id, message: `"${area.id}": the yard is too small for its ${b.id.split("/")[1]}, so it's left out.` });
      continue;
    }
    if (!free(cx, cy, Math.max(b.len, b.dep) * 0.5, b.dep / 2)) {
      notes.push({ level: "warning", id: area.id, message: `"${area.id}": its ${b.id.split("/")[1]} would sit on something already there, so it's left out.` });
      continue;
    }
    addBuilding({ shape, rot: b.rot, roof: b.roof, height: 20, ...(b.chimney === false ? { chimney: false } : {}) }, b.id, b.r);
  }
  return notes;
}

/**
 * Woods: groves of trees whose crowns touch, rather than trees dotted evenly. Trees are spread by Poisson-disk sampling
 * (Bridson 2007) at a close spacing, but only where a noise is high enough, the threshold set so the area holds about
 * the number of trees asked for (trees; else about one per 2.4 square squares): a few trees make a few groves with
 * open ground between, many make a forest with clearings. Points are laid out before checking for anything else, so
 * what another district places can remove trees but never moves the rest. mix gives the share of each species.
 */
export function fillWoods({ area, r, free, items, winter = false }) {
  if (area.trees === 0) return []; // a wood with no trees asked for: open ground
  const poly = shapeToPolygon(area.shape, area.rot ?? 0);
  if (poly.length < 3) return [];
  const a = polyArea(poly);
  if (!(a > 0)) return [];
  // Sparse, open and dense woods each have their own character (a tree count, or thick, the groves below)
  const counted = Number.isFinite(area.trees) && area.trees > 0;
  if (!counted && (area.density === "sparse" || area.density === "open" || area.density === "dense")) return fillCharacter({ area, poly, r, free, items, winter });
  // A tree count, else the density (trees a square square) times the area: so a wood redrawn bigger keeps its look
  const want = Math.min(MAX_TRIES, Number.isFinite(area.trees) && area.trees > 0 ? area.trees : a * WOOD_DENSITY.thick);
  const spacing = 0.85; // squares between trees in a grove: crowns overlap a little
  const full = a / (spacing * spacing * 1.6); // about what a wood packed edge to edge would hold
  const share = Math.min(1, want / full);
  const grove = makeNoise(r.int(2 ** 31), `${area.id}/groves`, { scale: 5, octaves: 2 });
  // The noise level above which the right share of the area is wooded, measured on a grid over the shape
  let level = -Infinity;
  if (share < 0.98) {
    const [x0, y0, x1, y1] = bbox(poly);
    const step = Math.max(0.5, Math.sqrt(((x1 - x0) * (y1 - y0)) / 40000));
    const vals = [];
    for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) if (pointInPolygon([x, y], poly)) vals.push(grove(x, y));
    vals.sort((p, q) => p - q);
    if (vals.length) level = vals[Math.min(vals.length - 1, Math.floor((1 - share) * vals.length))];
  }
  const pts = poissonInPolygon(poly, spacing, r.fork("points"), { keep: (x, y) => grove(x, y) >= level, max: MAX_TRIES });
  // Too big an area to lay trees over (it would never finish): nothing, said so
  const [bx0, by0, bx1, by1] = bbox(poly), cell = spacing / Math.SQRT2; // as poissonInPolygon measures it
  if (!pts.length && Math.max(1, Math.ceil((bx1 - bx0) / cell)) * Math.max(1, Math.ceil((by1 - by0) / cell)) > 4e6) return [{ level: "warning", id: area.id, message: `"${area.id}" is too big to fill with trees, so it's left empty. Draw it as a few smaller woods.` }];
  const tr = r.fork("trees");
  // Big enough to read as canopies (the smallest fir art reads as specks at map scale); the leafy share by season
  const bareShare = area.mix?.bare ?? leafyShare("thick", winter);
  const sizes = ["large", "medium", "medium"];
  let n = 0;
  for (const [x, y] of pts) {
    const bare = tr.next() < bareShare, size = tr.pick(sizes), u = tr.next(), rot = tr.next() * 360, variant = tr.int(8);
    if (!free(x, y, 0.3)) continue;
    n++;
    items.push(bare
      ? { kind: "tree", id: `${area.id}/t${n}`, from: area.id, x, y, species: "bare", size: null, s: 0.7 + u * 0.3, rot, variant }
      : { kind: "tree", id: `${area.id}/t${n}`, from: area.id, x, y, species: "conifer", size, s: 1 + u * 0.5, rot, variant });
  }
  return [];
}

/**
 * A wood of its own character, spread over its whole shape:
 * - sparse: lone trees and small clumps of two or three, well apart (scrubby ground with the odd tree);
 * - open: big trees standing apart, crowns not touching, evenly spread, mostly leafy (old wood pasture or parkland);
 * - dense: crowns touching edge to edge, with only a few small gaps.
 * Points are laid out before checking for anything else, as in the groves, so other features remove trees without
 * moving the rest.
 */
function fillCharacter({ area, poly, r, free, items, winter }) {
  const kind = area.density;
  const spacing = kind === "sparse" ? 3.2 : kind === "open" ? 1.9 : 0.78;
  let keep = () => true;
  if (kind === "dense") {
    // A few small gaps: the lowest tenth of a noise
    const gaps = makeNoise(r.int(2 ** 31), `${area.id}/gaps`, { scale: 3.5, octaves: 2 });
    const [x0, y0, x1, y1] = bbox(poly);
    const step = Math.max(0.5, Math.sqrt(((x1 - x0) * (y1 - y0)) / 40000));
    const vals = [];
    for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) if (pointInPolygon([x, y], poly)) vals.push(gaps(x, y));
    vals.sort((p, q) => p - q);
    const level = vals.length ? vals[Math.floor(vals.length / 10)] : -Infinity;
    keep = (x, y) => gaps(x, y) >= level;
  }
  // As many tries as the wood can hold (a fixed budget ran out partway across a big wood, leaving bare swathes)
  const room = Math.ceil((1.3 * polyArea(poly)) / (spacing * spacing)) + 100;
  const base = poissonInPolygon(poly, spacing, r.fork("points"), { keep, max: Math.min(MAX_CHARACTER, Math.max(MAX_TRIES, room)) });
  const [bx0, by0, bx1, by1] = bbox(poly), cell = spacing / Math.SQRT2;
  if (!base.length && Math.max(1, Math.ceil((bx1 - bx0) / cell)) * Math.max(1, Math.ceil((by1 - by0) / cell)) > 4e6) return [{ level: "warning", id: area.id, message: `"${area.id}" is too big to fill with trees, so it's left empty. Draw it as a few smaller woods.` }];
  // Sparse: about half the lone trees grow a clump of one or two more beside them
  const pts = [];
  const cl = r.fork("clumps");
  for (const [x, y] of base) {
    pts.push([x, y]);
    if (kind !== "sparse" || cl.next() >= 0.5) continue;
    const extra = 1 + cl.int(2);
    for (let k = 0; k < extra; k++) {
      const ang = cl.next() * Math.PI * 2, d = 0.55 + cl.next() * 0.3;
      const p = [x + Math.cos(ang) * d, y + Math.sin(ang) * d];
      if (pointInPolygon(p, poly)) pts.push(p);
    }
  }
  const tr = r.fork("trees");
  const bareShare = area.mix?.bare ?? leafyShare(kind, winter);
  const sizes = kind === "open" ? ["large", "large", "medium"] : ["large", "medium", "medium"];
  let n = 0;
  for (const [x, y] of pts) {
    const bare = tr.next() < bareShare, size = tr.pick(sizes), u = tr.next(), rot = tr.next() * 360, variant = tr.int(8);
    if (!free(x, y, 0.3)) continue;
    n++;
    // Open woodland's trees are big, spreading ones; sparse ground's smaller
    const leafy = kind === "open" ? 0.8 + u * 0.3 : kind === "sparse" ? 0.55 + u * 0.3 : 0.65 + u * 0.3;
    const fir = kind === "open" ? 1.2 + u * 0.4 : kind === "sparse" ? 0.9 + u * 0.4 : 1 + u * 0.5;
    items.push(bare
      ? { kind: "tree", id: `${area.id}/t${n}`, from: area.id, x, y, species: "bare", size: null, s: leafy, rot, variant }
      : { kind: "tree", id: `${area.id}/t${n}`, from: area.id, x, y, species: "conifer", size, s: fir, rot, variant });
  }
  return [];
}

/**
 * A wood's share of broadleaf trees when its mix doesn't say: mostly broadleaf, so summer woods read as leafy
 * canopies; in winter mostly firs, so winter woods keep a snowy evergreen look rather than bare branches. Open
 * woodland leans broadleaf, sparse ground and dense woods less so.
 */
export function leafyShare(kind, winter) {
  const summer = { sparse: 0.5, open: 0.75, thick: 0.7, dense: 0.6 }[kind] ?? 0.7;
  return winter ? Math.round(summer * 0.45 * 100) / 100 : summer;
}

function polyArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; s += x1 * y2 - x2 * y1; }
  return Math.abs(s / 2);
}

/** A hedgerow: small bushes every 0.4 squares along the wall's path. */
export function hedgeBushes({ wall, r, items, step = 0.4, scale = [0.7, 0.3] }) {
  const pts = wall.path;
  let n = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const l = Math.hypot(bx - ax, by - ay);
    for (let t = 0; t < l; t += step) {
      n++;
      items.push({ kind: "prop", id: `${wall.id}/b${n}`, from: wall.from ?? wall.id, class: "bush", x: ax + ((bx - ax) * t) / l + (r.next() - 0.5) * 0.15, y: ay + ((by - ay) * t) / l + (r.next() - 0.5) * 0.15, scale: scale[0] + r.next() * scale[1], rot: r.next() * 360, variant: r.int(8) });
    }
  }
}

/** Soft patches across the ground: [x, y, radius, kind 0..1], for the style to texture. */
export function groundPatches(r, W, H) {
  const k = (W * H) / 10000;
  return Array.from({ length: Math.round(260 * k) }, () => [r.next() * W, r.next() * H, 1.5 + r.next() * 5, r.next()]);
}

/**
 * A park, by its style. "green" (the default): a village green of open grass, big trees in groups around its edges and
 * a few in the open, and trodden paths from where the roads meet it to a point near the middle. "formal": a garden laid
 * out square to the area's rot: gravel paths around it and across it, a round basin where they cross, four hedged
 * beds, and avenues of trees along the long walk. Everything is clipped to the area's shape. Returns
 * { surface, trees, beds, hedges }: surface { poly, style, paths: [{ path, width }], basin }, trees [{ x, y, s, ... }],
 * beds (gardens), hedges (paths). Squares throughout; ftPerSquare for widths in feet.
 */
export function fillPark({ area, r, roads = [], ftPerSquare }) {
  const sq = (ft) => ft / ftPerSquare;
  const poly = shapeToPolygon(area.shape, area.rot ?? 0);
  const style = area.style === "formal" ? "formal" : "green";
  const out = { surface: { poly, style, paths: [], basin: null }, trees: [], beds: [], hedges: [] };
  if (poly.length < 3) return out;
  const inside = (p) => pointInPolygon(p, poly);
  const edgeDist = (p) => Math.min(...poly.map((q, i) => distSeg(p, q, poly[(i + 1) % poly.length])));
  // A point on the edge moved a hair inside, so a path from it counts as in the park
  const nudgeIn = (p) => { const d = [c[0] - p[0], c[1] - p[1]], l = Math.hypot(...d) || 1; return [p[0] + (d[0] / l) * 0.05, p[1] + (d[1] / l) * 0.05]; };
  const nearPath = (p, d) => out.surface.paths.some((w) => w.path.some((q, i) => i && distSeg(p, w.path[i - 1], q) < d + w.width / 2));
  const tr = r.fork("trees");
  const tree = (x, y, s) => out.trees.push({ x, y, s, rot: tr.next() * 360, variant: tr.int(8) });
  const [bx0, by0, bx1, by1] = bbox(poly);
  const c = [(bx0 + bx1) / 2, (by0 + by1) / 2];

  if (style === "green") {
    // Where the roads meet it: at most one entry a side, four in all. A road or lane that ends at its edge gives its
    // end, exactly; else the road that runs closest along a side (within 2.5 squares, on average) gives that side's
    // middle, shifted a little. Every draw comes from a fork keyed by what it's for (the side, the entry), so a street
    // appearing or going near one side (a district rerolled) moves nothing else in the park.
    const [px0, py0, px1, py1] = [bx0 - 3, by0 - 3, bx1 + 3, by1 + 3];
    const near = roads.filter((road) => road.path.some((q, k) => k && Math.max(q[0], road.path[k - 1][0]) >= px0 && Math.min(q[0], road.path[k - 1][0]) <= px1 && Math.max(q[1], road.path[k - 1][1]) >= py0 && Math.min(q[1], road.path[k - 1][1]) <= py1));
    const sideOf = (p) => { let bi = 0, bd = Infinity; poly.forEach((a, i) => { const d = distSeg(p, a, poly[(i + 1) % poly.length]); if (d < bd) { bd = d; bi = i; } }); return bi; };
    const bySide = new Map(); // side -> { p, score }: an end scores below any side a road runs along
    const offer = (i, p, score) => { const had = bySide.get(i); if (!had || score < had.score) bySide.set(i, { p, score }); };
    for (const road of near) {
      const ends = [road.path[0], road.path[road.path.length - 1]].filter((e) => edgeDist(e) < 0.6);
      if (ends.length) {
        for (const e of ends) offer(sideOf(e), inside(e) ? e : nudgeIn(e), -1);
        continue;
      }
      let best = null;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        let sum = 0;
        for (let t = 0; t <= 1.0001; t += 0.1) {
          const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          sum += Math.min(...road.path.map((q, k) => (k ? distSeg(p, road.path[k - 1], q) : Infinity)));
        }
        const avg = sum / 11;
        if (!best || avg < best.avg) best = { avg, a, b, i };
      }
      if (!best || best.avg > 2.5) continue;
      const t = 0.5 + (r.fork("entry", best.i).next() - 0.5) * 0.3;
      offer(best.i, [best.a[0] + (best.b[0] - best.a[0]) * t, best.a[1] + (best.b[1] - best.a[1]) * t], best.avg);
    }
    const entries = [];
    for (const { p } of [...bySide.values()].sort((a, b) => a.score - b.score))
      if (entries.length < 4 && !entries.some((e) => Math.hypot(e[0] - p[0], e[1] - p[1]) < 3)) entries.push(p);
    // With one, a second from the far side (a path across, not two from the same side); with none, the ends of the
    // shape's long axis
    if (entries.length === 1) {
      const e = entries[0], mids = poly.map((q, i) => [(q[0] + poly[(i + 1) % poly.length][0]) / 2, (q[1] + poly[(i + 1) % poly.length][1]) / 2]);
      entries.push(nudgeIn(mids.reduce((a, b) => (Math.hypot(b[0] - e[0], b[1] - e[1]) > Math.hypot(a[0] - e[0], a[1] - e[1]) ? b : a))));
    }
    if (entries.length < 2) {
      const far = poly.reduce((a, b) => (Math.hypot(b[0] - c[0], b[1] - c[1]) > Math.hypot(a[0] - c[0], a[1] - c[1]) ? b : a));
      const opp = poly.reduce((a, b) => (Math.hypot(b[0] - far[0], b[1] - far[1]) > Math.hypot(a[0] - far[0], a[1] - far[1]) ? b : a));
      for (const p of [far, opp]) if (entries.length < 2 && !entries.some((e) => Math.hypot(e[0] - p[0], e[1] - p[1]) < 3)) entries.push(p);
    }
    // Desire lines: each entry curves gently in to a hub near the middle
    const hr = r.fork("hub");
    const hub = [c[0] + (hr.next() - 0.5) * (bx1 - bx0) * 0.2, c[1] + (hr.next() - 0.5) * (by1 - by0) * 0.2];
    const hubIn = inside(hub) ? hub : c;
    for (const e of entries) {
      const bend = (r.fork("bend", e[0].toFixed(1), e[1].toFixed(1)).next() - 0.5) * 0.5;
      const m = [(e[0] + hubIn[0]) / 2 - (hubIn[1] - e[1]) * bend, (e[1] + hubIn[1]) / 2 + (hubIn[0] - e[0]) * bend];
      const path = [];
      for (let t = 0; t <= 1.0001; t += 0.1) path.push([(1 - t) ** 2 * e[0] + 2 * (1 - t) * t * m[0] + t * t * hubIn[0], (1 - t) ** 2 * e[1] + 2 * (1 - t) * t * m[1] + t * t * hubIn[1]]);
      if (path.every(inside) || path.slice(1).every(inside)) out.surface.paths.push({ path, width: sq(5), surface: "trodden" });
    }
    // Big trees in groups around the edge, a few out in the open; each tree's looks from its own place, so a path that
    // clears one tree changes no other
    const groups = makeNoise(r.fork("groups").int(2 ** 31), `${area.id}/groups`, { scale: 4, octaves: 2 });
    const pts = poissonInPolygon(poly, 1.3, r.fork("points"), { keep: (x, y) => { const e = edgeDist([x, y]); return (e < 3 && groups(x, y) > -0.2) || groups(x, y) > 0.45; }, max: 2000 });
    for (const [x, y] of pts) {
      if (edgeDist([x, y]) <= 0.4 || nearPath([x, y], 0.5)) continue;
      const tt = r.fork("tree", x.toFixed(2), y.toFixed(2));
      out.trees.push({ x, y, s: 0.6 + tt.next() * 0.25, rot: tt.next() * 360, variant: tt.int(8) });
    }
    return out;
  }

  // Formal: laid out in the area's own frame (turned by rot), then turned back and clipped to the shape
  const rot = area.rot ?? 0;
  const local = poly.map((p) => rotateAbout(p, c, -rot));
  const [x0, y0, x1, y1] = bbox(local);
  const W = x1 - x0, H = y1 - y0;
  const along = W >= H; // the long walk runs along the longer side
  const back = (p) => rotateAbout(p, c, rot);
  const pw = sq(8), m = Math.min(W, H) * 0.08 + pw / 2;
  const clipLine = (pts) => {
    // The parts of a straight-segment path that lie inside the shape, finely sampled
    const runs = [];
    let cur = null;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.25));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) {
        const p = [ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n];
        if (inside(p)) { if (!cur) runs.push((cur = [])); cur.push(p); } else cur = null;
      }
    }
    return runs.filter((q) => q.length >= 2);
  };
  const addPath = (pts) => { for (const run of clipLine(pts.map(back))) out.surface.paths.push({ path: run, width: pw, surface: "gravel" }); };
  const lx0 = x0 + m, lx1 = x1 - m, ly0 = y0 + m, ly1 = y1 - m, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  addPath([[lx0, ly0], [lx1, ly0], [lx1, ly1], [lx0, ly1], [lx0, ly0]]); // the walk round
  addPath([[x0, my], [x1, my]]); // the cross walks, out to the edge
  addPath([[mx, y0], [mx, y1]]);
  const br = Math.min(W, H) * 0.12;
  if (inside(back([mx, my]))) out.surface.basin = { at: back([mx, my]), radius: br };
  // Four beds between the walks, each hedged
  const g = pw / 2 + 0.25, gi = Math.max(g, br * 0.72 + 0.3); // the inner sides stand back from the basin
  for (const [ax, ay, bx2, by2] of [[lx0 + g, ly0 + g, mx - gi, my - gi], [mx + gi, ly0 + g, lx1 - g, my - gi], [lx0 + g, my + gi, mx - gi, ly1 - g], [mx + gi, my + gi, lx1 - g, ly1 - g]]) {
    if (bx2 - ax < 0.6 || by2 - ay < 0.6) continue;
    const corners = [[ax, ay], [bx2, ay], [bx2, by2], [ax, by2]].map(back);
    if (!corners.every(inside)) continue;
    const bc = back([(ax + bx2) / 2, (ay + by2) / 2]);
    out.beds.push({ cx: bc[0], cy: bc[1], w: bx2 - ax, d: by2 - ay, rot, strip: true });
    out.hedges.push([...corners, corners[0]]);
  }
  // Avenues: trees either side of the long walk, clear of the basin
  const step = 1.3, off = pw / 2 + 0.55;
  if (along) {
    for (let x = lx0 + step / 2; x <= lx1; x += step) for (const s of [-1, 1]) {
      const p = back([x, my + s * off]);
      if (Math.abs(x - mx) > br + 0.8 && inside(p) && edgeDist(p) > 0.3) tree(p[0], p[1], 0.42 + tr.next() * 0.08);
    }
  } else {
    for (let y = ly0 + step / 2; y <= ly1; y += step) for (const s of [-1, 1]) {
      const p = back([mx + s * off, y]);
      if (Math.abs(y - my) > br + 0.8 && inside(p) && edgeDist(p) > 0.3) tree(p[0], p[1], 0.42 + tr.next() * 0.08);
    }
  }
  return out;
}

function distSeg([x, y], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + t * dx - x, ay + t * dy - y);
}
