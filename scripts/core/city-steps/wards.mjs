// One step of making a city's plan from Quick Start's choices (quick-city.mjs, cityPlan): ctx holds what the steps share.
import { TAU, add, biggest, chain, densify, dirOf, distToPath, distToRing, inside, mergeSmall, mul, openRun, outline, pathLen, pathOutside, pt, voronoiIn } from "../quick-city.mjs";
import { area, difference, intersect, offset } from "../lots/poly.mjs";
import { offsetLine } from "../cliffs.mjs";

/**
 * The street inside the wall: the wall drawn in by its reach (half its thickness and the clear strip) and half a
 * street, kept to the land
 */
export function wards(ctx) {
  const { C, H, R, S, W, choices, r, radiusAt, roads, wet } = ctx;
  const ringPoly = (offset([ctx.wallPoly], -((12 / 2 + 15 + 10) / 25 + 0.2)) ?? []).reduce((a, b) => (!a || area(b) > area(a) ? b : a), null); ctx.ringPoly = ringPoly;
  const ringPieces = ringPoly ? pathOutside([...ringPoly, ringPoly[0]], [ctx.sea, ctx.lake].filter(Boolean), 3) : [];
  const ringClosed = ringPieces.length === 1 && !ctx.sea && !ctx.lake;
  // (drawn straight between its points, so it never curves out into the wall's band)
  ringPieces.forEach((p, k) => roads.push({ id: ringPieces.length > 1 ? `wall-street-${k + 1}` : "wall-street", type: "road", class: "street", surface: "cobble", straight: true, path: (ringClosed ? [...ringPoly, ringPoly[0]] : p).map(pt) }));

  // The ground the wards cover: inside the wall street, off the water
  let land = ringPoly ? difference([ringPoly], wet) : [];
  // A metropolis keeps its old wall: a smaller ring around the old town, the wards cut by its line (half its reach in
  // from it inside, half out from it outside), the main roads passing through it at its own gates
  ctx.oldWall = null; ctx.oldPoly = null; let oldCut = null;
  if (choices.size === "metropolis" && choices.oldWall !== false) {
    const n = 10 + r.int(4), f = r.range(0.48, 0.56);
    ctx.oldPoly = Array.from({ length: n }, (_, k) => {
      const a = (k + r.range(-0.3, 0.3)) * (TAU / n);
      return pt(add(C, mul(dirOf(a), radiusAt(a) * f * r.range(0.95, 1.05))));
    });
    // (drawn in toward the middle where it would come within a few squares of the wall street, which would run along it)
    if (ringPoly) {
      const ringPath = [...ringPoly, ringPoly[0]];
      for (let k = 0; k < 4 && densify([...ctx.oldPoly, ctx.oldPoly[0]], 1).some((p) => inside(p, ringPoly) && distToPath(p, ringPath) < 3); k++) ctx.oldPoly = ctx.oldPoly.map((p) => pt(add(C, mul([p[0] - C[0], p[1] - C[1]], 0.92))));
    }
    if (ctx.cutLine) {
      // (stopping at the cliff too, as the town wall does; else, where that would run it along the wall street inside
      // the town wall, a little further in)
      const ringPath = ringPoly ? [...ringPoly, ringPoly[0]] : null;
      for (const pull of [0, -4.5]) {
        const pulled = pull ? offsetLine(ctx.cutLine, pull) : ctx.cutLine, beyond = [...pulled, ...[...pulled].reverse().map((p) => add(p, mul(ctx.cliffAway, Math.hypot(W, H))))];
        const kept = biggest(difference([ctx.oldPoly], [beyond]));
        if (!kept) continue;
        const run = openRun(outline(kept), pulled);
        if (pull === 0 && run && ringPath) {
          // (the longest stretch within reach of the wall street, away from its ends, where it crosses that street)
          const pts = densify(run.path, 0.5), lens = [0];
          for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
          const L = lens[lens.length - 1];
          let cur = 0, most = 0;
          pts.forEach((p, i) => { cur = lens[i] > 3 && lens[i] < L - 3 && distToPath(p, ringPath) < 1.6 ? cur + 0.5 : 0; most = Math.max(most, cur); });
          if (most > 2) continue;
        }
        ctx.oldPoly = outline(kept); oldCut = pulled;
        break;
      }
    }
    const reach = (12 / 2 + 15) / 25 + 0.15;
    const innerLand = intersect(land, offset([ctx.oldPoly], -reach));
    const outerLand = difference(land, offset([ctx.oldPoly], reach));
    land = [...innerLand, ...outerLand];
    const oldRun = oldCut ? openRun(ctx.oldPoly, oldCut) : null;
    ctx.oldWall = { id: "old-wall", type: "wall", class: "town", path: oldRun ? oldRun.path : [...ctx.oldPoly, ctx.oldPoly[0]], ...(oldRun ? { side: oldRun.side } : {}), straight: true, outside: "none", towers: "roofed" };
  }
  const landArea = land.reduce((s, p) => s + area(p), 0);

  // Sectors between neighboring main roads, split by the water into pieces; an island in the river is a piece of its
  // own (cut into wedges it left slivers too small to build on)
  const far = R * 3;
  const pieces = ctx.island ? intersect(land, [ctx.island]).filter((p) => area(p) > 4) : [];
  const mainland = ctx.island ? difference(land, [ctx.island]) : land;
  roads.filter((rd) => rd.angle !== undefined).forEach((rd, k, list) => {
    const next = list[(k + 1) % list.length];
    const cut = (path) => { const i = path.findIndex((p) => Math.hypot(p[0] - C[0], p[1] - C[1]) > R * 1.6); return i < 0 ? path : path.slice(0, i + 1); };
    const a0 = rd.angle, a1 = next === rd ? rd.angle + TAU : next.angle + (next.angle <= rd.angle ? TAU : 0);
    const arc = [];
    for (let t = a0; t <= a1; t += 0.2) arc.push(add(C, mul(dirOf(t), far)));
    arc.push(add(C, mul(dirOf(a1), far)));
    const wedge = list.length === 1 ? null : [...cut(rd.path), ...arc, ...[...cut(next.path)].reverse().slice(0, -1)];
    for (const piece of wedge ? intersect([wedge], mainland) : mainland) if (area(piece) > 4) pieces.push(piece);
  });

  // Wards: each piece cut into Voronoi cells by its share of the wards wanted, the seeds spread out a little
  const [w0, w1] = S.wards;
  const wanted = w0 + r.int(w1 - w0 + 1);
  const target = landArea / wanted;
  const wards = []; ctx.wards = wards;
  const streets = [];
  for (const piece of pieces) {
    const k = Math.max(1, Math.round(area(piece) / target));
    if (area(piece) < target * 0.15) continue; // a scrap between the water and the wall stays open ground
    const cells = k === 1 ? [piece] : mergeSmall(voronoiIn(piece, k, r), target * 0.4);
    // Edges between two cells of this piece are streets; edges on the piece's own outline aren't
    const onEdge = (m) => distToRing(m, piece) < 0.05;
    const seen = new Map();
    for (const cell of cells) {
      wards.push(cell);
      for (let i = 0; i < cell.length; i++) {
        const a = cell[i], b = cell[(i + 1) % cell.length];
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (onEdge(m) || Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.05) continue;
        const key = [pt(a), pt(b)].map((p) => p.join(",")).sort().join("|");
        if (!seen.has(key)) seen.set(key, [a, b]);
      }
    }
    streets.push(...chain([...seen.values()]));
  }
  streets.filter((p) => pathLen(p) >= 2).forEach((p, k) => roads.push({ id: `ward-street-${k + 1}`, type: "road", class: "street", surface: "cobble", straight: true, path: p.map(pt) }));
}
