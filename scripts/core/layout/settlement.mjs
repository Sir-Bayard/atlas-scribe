/**
 * The settlement fill outside the plots: farmsteads, woods, hedgerows and ground patches (houses stand on plots,
 * in lots/). Numbers are in squares and were tuned on a 25 ft square (a village overview). Pure: runs anywhere.
 */
import { bbox, pointInPolygon, rotateAbout, shapeToPolygon } from "../geom.mjs";
import { poissonInPolygon } from "../scatter.mjs";
import { WOOD_DENSITY } from "../plan.mjs";
import { makeNoise } from "../noise.mjs";

/** Cap on random tries for one area, so a huge or odd shape can't run on forever. */
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
 * Woods: groves of trees whose crowns touch. Trees are spread by Poisson-disk sampling (Bridson 2007) where a noise
 * is high enough, its threshold set so the area holds about the number asked for (else one per 2.4 square squares).
 * Points are laid out before anything else is checked, so another district's things can remove trees but never move
 * the rest. mix gives each species' share. cleared (layout/cleared.mjs, clearing): the wood thinned toward the town.
 */
export function fillWoods({ area, r, free, items, winter = false, cleared = null }) {
  if (area.trees === 0) return []; // a wood with no trees asked for: open ground
  const poly = shapeToPolygon(area.shape, area.rot ?? 0);
  if (poly.length < 3) return [];
  const a = polyArea(poly);
  if (!(a > 0)) return [];
  // Sparse, open and dense woods each have their own character (a tree count, or thick, the groves below)
  const counted = Number.isFinite(area.trees) && area.trees > 0;
  if (!counted && (area.density === "sparse" || area.density === "open" || area.density === "dense")) return fillCharacter({ area, poly, r, free, items, winter, cleared });
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
  // (a cleared wood's own stream, so a wood not cleared lays the same trees as ever)
  const cu = r.fork("cleared");
  let n = 0, felled = 0;
  for (const [x, y] of pts) {
    const bare = tr.next() < bareShare, size = tr.pick(sizes), u = tr.next(), rot = tr.next() * 360, variant = tr.int(8);
    const ck = cleared ? [cu.next(), cu.next()] : null; // (drawn for every point, so one tree taken moves no other)
    if (!free(x, y, 0.3)) continue;
    if (cleared && !cleared.keep(x, y, ck[0])) { const f = cleared.felled(++felled, x, y, ck[1]); if (f) items.push(f); continue; }
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
function fillCharacter({ area, poly, r, free, items, winter, cleared }) {
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
  // As many tries as the wood can hold, so a big wood has no bare swathes
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
  // (a cleared wood's own stream, so a wood not cleared lays the same trees as ever)
  const cu = r.fork("cleared");
  let n = 0, felled = 0;
  for (const [x, y] of pts) {
    const bare = tr.next() < bareShare, size = tr.pick(sizes), u = tr.next(), rot = tr.next() * 360, variant = tr.int(8);
    const ck = cleared ? [cu.next(), cu.next()] : null; // (drawn for every point, so one tree taken moves no other)
    if (!free(x, y, 0.3)) continue;
    if (cleared && !cleared.keep(x, y, ck[0])) { const f = cleared.felled(++felled, x, y, ck[1]); if (f) items.push(f); continue; }
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
 * A wood's share of broadleaf trees when its mix doesn't say: mostly broadleaf in summer, mostly firs in winter (so
 * winter woods stay evergreen and snowy); open woodland leans broadleaf, sparse and dense less so.
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

/** A hedgerow: small bushes every step squares along the wall's path; free(x, y, rad), when given, leaves out those on something. */
export function hedgeBushes({ wall, r, items, step = 0.4, scale = [0.7, 0.3], free = null }) {
  const pts = wall.path;
  let n = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const l = Math.hypot(bx - ax, by - ay);
    for (let t = 0; t < l; t += step) {
      n++;
      const b = { kind: "prop", id: `${wall.id}/b${n}`, from: wall.from ?? wall.id, class: "bush", x: ax + ((bx - ax) * t) / l + (r.next() - 0.5) * 0.15, y: ay + ((by - ay) * t) / l + (r.next() - 0.5) * 0.15, scale: scale[0] + r.next() * scale[1], rot: r.next() * 360, variant: r.int(8) };
      // (a bush where a building or anything else already stands is left out; the rest stay where they are)
      if (!free || free(b.x, b.y, 0.2)) items.push(b);
    }
  }
}

/** Soft patches across the ground: [x, y, radius, kind 0..1], for the style to texture. */
export function groundPatches(r, W, H) {
  const k = (W * H) / 10000;
  return Array.from({ length: Math.round(260 * k) }, () => [r.next() * W, r.next() * H, 1.5 + r.next() * 5, r.next()]);
}

/**
 * A park by its style. "green" (the default): open grass, big trees in groups around its edge and a few in the open,
 * trodden paths from where the roads meet it to near its middle, and now and then a pond, a well, a maypole or a
 * market cross. "formal": a garden square to its rot, built from parts its seed picks (FORMAL): a layout of gravel
 * walks, a center, beds, their edging and trees. Clipped to the area. Returns { surface: { poly, style, paths, basin },
 * trees, beds, hedges, walls, props, design }. Squares; ftPerSquare for widths in feet.
 */
export function fillPark({ area, r, roads = [], ftPerSquare }) {
  const sq = (ft) => ft / ftPerSquare;
  const poly = shapeToPolygon(area.shape, area.rot ?? 0);
  const style = area.style === "formal" ? "formal" : "green";
  const out = { surface: { poly, style, paths: [], basin: null }, trees: [], beds: [], hedges: [], walls: [], props: [], design: null };
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
    // Where the roads meet it: at most one entry a side: a road ending at its edge gives its end, else the road
    // running closest along a side gives that side's middle, shifted a little. Each draw comes from a fork keyed by
    // side and entry, so a street appearing near one side moves nothing else
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
    // Now and then something on it (its own fork, so it moves nothing else): a pond off the paths, or a well, a
    // maypole or a market cross where they meet; the trees keep off it
    const fr = r.fork("feature");
    const roll = fr.next(), what = GREEN_FEATURES.includes(area.feature) ? area.feature : (roll < 0.15 ? "pond" : roll < 0.3 ? "well" : roll < 0.45 ? "maypole" : roll < 0.6 ? "cross" : "none");
    out.design = { feature: what };
    if (what === "pond") {
      const rad = Math.min(bx1 - bx0, by1 - by0) * fr.range(0.1, 0.16);
      for (let t = 0; t < 30; t++) {
        const p = [bx0 + fr.next() * (bx1 - bx0), by0 + fr.next() * (by1 - by0)];
        if (!inside(p) || edgeDist(p) < rad + 0.8 || nearPath(p, rad + 0.3)) continue;
        out.surface.basin = { at: p, radius: rad, rim: false };
        break;
      }
      if (out.surface.basin) { const { at, radius } = out.surface.basin; out.trees = out.trees.filter((t) => Math.hypot(t.x - at[0], t.y - at[1]) > radius + 0.6); }
    } else if (what !== "none" && inside(hubIn)) {
      // (its size in feet, never too small to see on an overview: a well 8 ft, a maypole's ring of ribbons 18, a cross 10)
      const size = Math.max(0.35, sq({ well: 8, maypole: 18, cross: 10 }[what]));
      out.props.push({ class: what, x: hubIn[0], y: hubIn[1], rot: fr.next() * 360, variant: fr.int(8), size });
      out.trees = out.trees.filter((t) => Math.hypot(t.x - hubIn[0], t.y - hubIn[1]) > size * (what === "maypole" ? 1.2 : 0.8) + 0.8);
    }
    return out;
  }

  // Formal: laid out in the area's own frame (turned by rot), then turned back and clipped to the shape. Each part from
  // its own fork, so a plan's choice of one part leaves the others as they were
  const rot = area.rot ?? 0;
  const local = poly.map((p) => rotateAbout(p, c, -rot));
  const [x0, y0, x1, y1] = bbox(local);
  const W = x1 - x0, H = y1 - y0;
  const along = W >= H; // the long walk runs along the longer side
  const back = (p) => rotateAbout(p, c, rot);
  const pick = (part) => { const list = FORMAL[part], given = area[part === "trees" ? "planting" : part]; return list.includes(given) ? given : list[r.fork("design", part).int(list.length)]; };
  const design = { layout: pick("layout"), center: pick("center"), beds: pick("beds"), edging: pick("edging"), trees: pick("trees") };
  out.design = design;
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
  const walks = []; // in the local frame: [[x, y], ...] polylines, for beds and trees to keep off
  const addPath = (pts, width = pw) => { walks.push({ pts, width }); for (const run of clipLine(pts.map(back))) out.surface.paths.push({ path: run, width, surface: "gravel" }); };
  const ring = (cx, cy, rad, n = 24) => Array.from({ length: n + 1 }, (_, k) => [cx + rad * Math.cos((2 * Math.PI * k) / n), cy + rad * Math.sin((2 * Math.PI * k) / n)]);
  const lx0 = x0 + m, lx1 = x1 - m, ly0 = y0 + m, ly1 = y1 - m, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const br = Math.min(W, H) * 0.12;
  addPath([[lx0, ly0], [lx1, ly0], [lx1, ly1], [lx0, ly1], [lx0, ly0]]); // the walk round
  const canal = design.layout === "canal";
  // The walks inside it
  if (design.layout === "quartered" || design.layout === "concentric") {
    addPath([[x0, my], [x1, my]]);
    addPath([[mx, y0], [mx, y1]]);
  }
  if (design.layout === "concentric") {
    const k = 0.55, ix0 = mx - ((lx1 - lx0) / 2) * k, ix1 = mx + ((lx1 - lx0) / 2) * k, iy0 = my - ((ly1 - ly0) / 2) * k, iy1 = my + ((ly1 - ly0) / 2) * k;
    addPath([[ix0, iy0], [ix1, iy0], [ix1, iy1], [ix0, iy1], [ix0, iy0]], pw * 0.8);
  }
  if (design.layout === "saltire") {
    addPath([[lx0, ly0], [lx1, ly1]]);
    addPath([[lx1, ly0], [lx0, ly1]]);
  }
  if (design.layout === "goose-foot") {
    // (three walks fanning from the middle of one short side, the middle one on the long axis)
    const [o, far] = along ? [[x0, my], lx1] : [[mx, y0], ly1];
    if (along) for (const dy of [ly0 + (ly1 - ly0) * 0.15, my, ly1 - (ly1 - ly0) * 0.15]) addPath([o, [far, dy]]);
    else for (const dx of [lx0 + (lx1 - lx0) * 0.15, mx, lx1 - (lx1 - lx0) * 0.15]) addPath([o, [dx, far]]);
  }
  if (design.layout === "compartments") {
    // (six or nine beds in a grid of walks)
    const cols = along ? 3 : 2 + r.fork("design", "grid").int(2), rows = along ? 2 + r.fork("design", "grid").int(2) : 3;
    for (let i = 1; i < cols; i++) { const x = lx0 + ((lx1 - lx0) * i) / cols; addPath([[x, ly0], [x, ly1]], pw * 0.8); }
    for (let j = 1; j < rows; j++) { const y = ly0 + ((ly1 - ly0) * j) / rows; addPath([[lx0, y], [lx1, y]], pw * 0.8); }
  }
  if (canal) {
    // (a long canal on the long axis, a walk either side)
    const cw = Math.max(0.6, Math.min(W, H) * 0.14), cl = (along ? lx1 - lx0 : ly1 - ly0) * 0.7;
    const rect = along ? [[mx - cl / 2, my - cw / 2], [mx + cl / 2, my - cw / 2], [mx + cl / 2, my + cw / 2], [mx - cl / 2, my + cw / 2]] : [[mx - cw / 2, my - cl / 2], [mx + cw / 2, my - cl / 2], [mx + cw / 2, my + cl / 2], [mx - cw / 2, my + cl / 2]];
    const worldRect = rect.map(back);
    if (worldRect.every(inside)) out.surface.basin = { at: back([mx, my]), radius: cw / 2, poly: worldRect };
    const off = cw / 2 + pw / 2 + 0.15;
    if (along) for (const s2 of [-1, 1]) addPath([[lx0, my + s2 * off], [lx1, my + s2 * off]], pw * 0.8);
    else for (const s2 of [-1, 1]) addPath([[mx + s2 * off, ly0], [mx + s2 * off, ly1]], pw * 0.8);
  }
  // The center (the canal is its own)
  let keepR = 0; // how far beds and trees keep from the middle
  if (!canal && inside(back([mx, my]))) {
    const at = back([mx, my]);
    if (design.center === "basin") { out.surface.basin = { at, radius: br }; keepR = br; }
    else if (design.center === "rond-point") { addPath(ring(mx, my, br * 0.9), pw * 0.8); out.props.push({ class: "statue", x: at[0], y: at[1], rot: rot + 90, variant: r.fork("design", "statue").int(8), size: Math.max(0.35, sq(8)) }); keepR = br * 0.9 + pw / 2; }
    else {
      const size = { fountain: Math.max(0.8, br * 1.6), statue: Math.max(0.35, sq(8)), sundial: Math.max(0.3, sq(5)) }[design.center];
      addPath(ring(mx, my, size * 0.5 + 0.35), pw * 0.7);
      out.props.push({ class: design.center, x: at[0], y: at[1], rot: rot + 90, variant: r.fork("design", "center").int(8), size });
      keepR = size * 0.5 + 0.35 + pw / 2;
    }
  }
  // The beds: the ground between the walks, found on a grid in the local frame (clear of every walk and the center)
  const clearOfWalks = (p, pad) => walks.every((w) => w.pts.every((q, i) => !i || distSeg(p, w.pts[i - 1], q) >= w.width / 2 + pad)) && Math.hypot(p[0] - mx, p[1] - my) >= keepR + pad && (!out.surface.basin?.poly || !pointInPolygon(back(p), out.surface.basin.poly));
  const cell = 0.5, open = [];
  for (let x = lx0 + cell / 2; x < lx1; x += cell) for (let y = ly0 + cell / 2; y < ly1; y += cell) if (clearOfWalks([x, y], 0.3) && inside(back([x, y])) && edgeDist(back([x, y])) > 0.3) open.push([x, y]);
  // (the open cells grouped into rectangles: each run of open cells across, grown downward while the run stays open)
  const key = (p) => `${Math.round(p[0] / cell)}:${Math.round(p[1] / cell)}`, free = new Set(open.map(key));
  const beds = [];
  for (const p of open) {
    if (!free.has(key(p))) continue;
    let wx = 1; while (free.has(key([p[0] + wx * cell, p[1]]))) wx++;
    let hy = 1; while ([...Array(wx).keys()].every((i) => free.has(key([p[0] + i * cell, p[1] + hy * cell])))) hy++;
    for (let i = 0; i < wx; i++) for (let j = 0; j < hy; j++) free.delete(key([p[0] + i * cell, p[1] + j * cell]));
    if (wx * hy >= 4 && wx >= 2 && hy >= 2) beds.push({ x0: p[0] - cell / 2, y0: p[1] - cell / 2, x1: p[0] + (wx - 0.5) * cell, y1: p[1] + (hy - 0.5) * cell });
  }
  const trees = design.trees, edging = design.edging;
  for (const [k, b] of beds.entries()) {
    const w = b.x1 - b.x0, d = b.y1 - b.y0, corners = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map(back);
    const bc = back([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]);
    if (design.beds === "parterre") out.beds.push({ cx: bc[0], cy: bc[1], w: w * 0.86, d: d * 0.86, rot, strip: true, knot: true });
    else if (design.beds === "kitchen") {
      // (two or three long beds across it, a path's width apart)
      const n = Math.max(1, Math.min(3, Math.floor(d / 1.1)));
      for (let i = 0; i < n; i++) { const y = b.y0 + (d * (i + 0.5)) / n, q = back([(b.x0 + b.x1) / 2, y]); out.beds.push({ cx: q[0], cy: q[1], w: w * 0.86, d: (d / n) * 0.6, rot, strip: true }); }
    } else if (design.beds === "orchard") {
      // (fruit trees in rows)
      const tr2 = r.fork("orchard", k);
      for (let x = b.x0 + 0.6; x <= b.x1 - 0.5; x += 1.2) for (let y = b.y0 + 0.6; y <= b.y1 - 0.5; y += 1.2) { const q = back([x, y]); tree(q[0], q[1], 0.34 + tr2.next() * 0.06); }
    }
    if (edging === "hedge") out.hedges.push([...corners, corners[0]]);
    else if (edging === "wall") out.walls.push([...corners, corners[0]]);
  }
  // Trees: an avenue either side of the long walk, a quincunx over the lawns, or clumps (bosquets) in the far beds
  if (trees === "avenue") {
    const step = 1.3, off = pw / 2 + 0.55;
    if (along) {
      for (let x = lx0 + step / 2; x <= lx1; x += step) for (const s2 of [-1, 1]) {
        const p = back([x, my + s2 * off]);
        if (Math.abs(x - mx) > keepR + 0.8 && inside(p) && edgeDist(p) > 0.3 && clearOfWalks([x, my + s2 * off], 0.2)) tree(p[0], p[1], 0.42 + tr.next() * 0.08);
      }
    } else {
      for (let y = ly0 + step / 2; y <= ly1; y += step) for (const s2 of [-1, 1]) {
        const p = back([mx + s2 * off, y]);
        if (Math.abs(y - my) > keepR + 0.8 && inside(p) && edgeDist(p) > 0.3 && clearOfWalks([mx + s2 * off, y], 0.2)) tree(p[0], p[1], 0.42 + tr.next() * 0.08);
      }
    }
  } else if (trees === "quincunx" && design.beds !== "orchard") {
    // (a tree at each corner of a square and one in its middle, repeated over the open ground at the edge)
    for (let x = x0 + 0.8, i = 0; x < x1; x += 1.6, i++) for (let y = y0 + 0.8 + (i % 2) * 0.8; y < y1; y += 1.6) {
      const p = back([x, y]);
      if (inside(p) && edgeDist(p) > 0.4 && clearOfWalks([x, y], 0.35) && !beds.some((b) => x > b.x0 - 0.2 && x < b.x1 + 0.2 && y > b.y0 - 0.2 && y < b.y1 + 0.2)) tree(p[0], p[1], 0.38 + tr.next() * 0.06);
    }
  } else if (trees === "bosquets" && design.beds !== "orchard") {
    // (the beds farthest from the middle filled with a clump of trees instead)
    const far = beds.map((b) => ({ b, d: Math.hypot((b.x0 + b.x1) / 2 - mx, (b.y0 + b.y1) / 2 - my) })).sort((a, b2) => b2.d - a.d).slice(0, Math.max(1, Math.floor(beds.length / 3)));
    const bt = r.fork("bosquets");
    for (const { b } of far) for (let x = b.x0 + 0.45; x <= b.x1 - 0.4; x += 0.8) for (let y = b.y0 + 0.45; y <= b.y1 - 0.4; y += 0.8) {
      const q = back([x + (bt.next() - 0.5) * 0.3, y + (bt.next() - 0.5) * 0.3]);
      if (inside(q)) tree(q[0], q[1], 0.36 + bt.next() * 0.1);
    }
  }
  return out;
}

/** What a green may have on it. */
export const GREEN_FEATURES = ["pond", "well", "maypole", "cross", "none"];

/** A formal garden's parts, one of each picked by the park's seed (or set by the plan's area: trees as its planting). */
export const FORMAL = {
  layout: ["quartered", "saltire", "goose-foot", "concentric", "canal", "compartments"],
  center: ["basin", "fountain", "statue", "sundial", "rond-point"],
  beds: ["lawn", "parterre", "kitchen", "orchard"],
  edging: ["hedge", "wall", "none"],
  trees: ["avenue", "quincunx", "bosquets", "none"],
};

function distSeg([x, y], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + t * dx - x, ay + t * dy - y);
}
