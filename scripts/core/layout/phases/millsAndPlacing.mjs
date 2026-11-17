// One phase of laying out a plan (layout/index.mjs, layoutPlan): ctx holds what the phases share.
import { CLUTTER_FT } from "../../uses.mjs";
import { PROP_SQUARES } from "../../plan.mjs";
import { apartBy, closed, ownStyles, pickRoof, stepsAlong } from "../index.mjs";
import { area, centroid } from "../../lots/poly.mjs";
import { bbox, distanceToPath, pointInPolygon, polygonsOverlap, shapeToPolygon } from "../../geom.mjs";
import { pastEdge } from "../../water.mjs";
import { rng } from "../../rng.mjs";
import { seedOf } from "../../seeds.mjs";

/**
 * Mills: a windmill's sails over its cap, turned by its own stream; a watermill's wheel just in the water its
 * nearest wall faces (within a square of the wall), else no wheel and a note
 */
export function millsAndPlacing(ctx) {
  const { H, W, addBuilding, battle, elsewhere, footOf, items, notes, owner, plan, space, sq, ways } = ctx;
  Object.assign(ctx, { fillBack, addAnchor, streetCorners, graveCount, addGraves, free });
  /** True when a thing of radius rad (half-depth half, when given) at x, y keeps clear of everything placed so far. */
  function free(x, y, rad, half = rad) {
    if (x < -1 || y < -1 || x > W + 1 || y > H + 1) return false;
    ctx.catchUp();
    const pr = Math.max(0, rad * 0.9);
    for (const k of ctx.nearby.reserved.near(x, y, pr)) { const poly = space.reserved[k]; if (!elsewhere(poly) && (pointInPolygon([x, y], poly) || distanceToPath([x, y], closed(poly)) < rad * 0.9)) return false; }
    for (const k of ctx.nearby.gardens.near(x, y, pr)) { const poly = space.gardens[k]; if (!elsewhere(poly) && (pointInPolygon([x, y], poly) || distanceToPath([x, y], closed(poly)) < rad * 0.9)) return false; }
    const hr = Math.max(0, half);
    // (a pond's or lake's shore by the thing's whole reach, so a farmhouse's corner stays off it too)
    for (const k of ctx.nearby.water.near(x, y, Math.max(hr, rad))) { const w = space.water[ctx.nearby.water.segPath[k]]; if (ctx.nearby.water.dist(x, y, k) < (w.body ? Math.max(half, rad) : half) + (w.clears ? w.clears[ctx.nearby.water.segIndex[k] - 1] : w.clear)) return false; }
    for (const k of ctx.nearby.ways.near(x, y, hr)) { const w = space.ways[ctx.nearby.ways.segPath[k]]; if (!elsewhere(w) && ctx.nearby.ways.dist(x, y, k) < half + w.clear) return false; }
    for (const k of ctx.nearby.buildings.near(x, y, Math.max(0, rad * 0.8))) { const b = space.buildings[k]; if (!elsewhere(b) && Math.hypot(b.cx - x, b.cy - y) < (rad + Math.max(b.len, b.dep) * 0.5) * 0.8 + 0.15) return false; }
    return true;
  }
  for (const b of items.filter((i) => i.kind === "building" && (i.use === "windmill" || i.use === "watermill"))) {
    const r = rng(seedOf(plan, b.from), b.id, "mill");
    if (b.use === "windmill") {
      items.push({ kind: "prop", id: `${b.id}/sails`, from: b.from, class: "sails", x: b.cx, y: b.cy, rot: r.next() * 90, variant: r.int(8), scale: Math.max(2, Math.max(b.len, b.dep) * 3.2) / (PROP_SQUARES.sails ?? 2.4) });
      continue;
    }
    // Out from the middle of each wall to the water it faces: the wheel stands just in it, on the nearest
    const foot = shapeToPolygon({ rect: [b.cx - b.len / 2, b.cy - b.dep / 2, b.cx + b.len / 2, b.cy + b.dep / 2] }, b.rot);
    const runs = items.filter((i) => i.kind === "water" && Array.isArray(i.path) && i.path.length >= 2);
    let best = null;
    for (let k = 0; k < 4; k++) {
      const a = foot[k], e = foot[(k + 1) % 4], m = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2], l = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1;
      let n = [-(e[1] - a[1]) / l, (e[0] - a[0]) / l];
      if (pointInPolygon([m[0] + n[0] * 0.1, m[1] + n[1] * 0.1], foot)) n = [-n[0], -n[1]];
      for (let t = 0.05; t <= 1.0 && !(best && best.t <= t); t += 0.05) {
        const q = [m[0] + n[0] * t, m[1] + n[1] * t];
        if (runs.some((w) => pastEdge(q, w) < -0.06)) { best = { t, m, n, along: Math.atan2(e[1] - a[1], e[0] - a[0]) }; break; }
      }
    }
    const variant = r.int(8);
    if (!best) { notes.push({ level: "warning", id: b.from, message: `"${b.from}" is a watermill with no river or stream within a square of its walls, so it has no wheel. Move it next to the water.` }); continue; }
    items.push({ kind: "prop", id: `${b.id}/wheel`, from: b.from, class: "waterwheel", x: best.m[0] + best.n[0] * best.t, y: best.m[1] + best.n[1] * best.t, rot: (best.along * 180) / Math.PI - 90, variant, scale: 1 });
  }

  /**
   * True when a rectangle (its four corners) keeps clear of this district's and the plan's buildings, ways, water,
   * squares, yards and other kept ground: tested at its corners, the middles of its sides and its middle, and its
   * outline against every building near it. Things another district placed don't count (see elsewhere).
   */
  function rectFree(pts) {
    ctx.catchUp();
    const samples = [...pts, ...pts.map((p, i) => [(p[0] + pts[(i + 1) % 4][0]) / 2, (p[1] + pts[(i + 1) % 4][1]) / 2]), [(pts[0][0] + pts[2][0]) / 2, (pts[0][1] + pts[2][1]) / 2]];
    const reach = Math.hypot(pts[2][0] - pts[0][0], pts[2][1] - pts[0][1]) / 2;
    const [cx, cy] = samples[8];
    for (const [x, y] of samples) {
      if (x < 0 || y < 0 || x > W || y > H) return false;
      for (const k of ctx.nearby.ways.near(x, y, 0.02)) { const w = space.ways[ctx.nearby.ways.segPath[k]]; if (!elsewhere(w) && ctx.nearby.ways.dist(x, y, k) < w.clear + 0.02) return false; }
      for (const k of ctx.nearby.water.near(x, y, 0.02)) { const w = space.water[ctx.nearby.water.segPath[k]]; if (ctx.nearby.water.dist(x, y, k) < (w.clears ? w.clears[ctx.nearby.water.segIndex[k] - 1] : w.clear)) return false; }
    }
    for (const k of ctx.nearby.buildings.near(cx, cy, reach)) { const b = space.buildings[k]; if (!elsewhere(b) && polygonsOverlap(pts, footOf(b))) return false; }
    for (const z of space.zones) if (!elsewhere(z) && polygonsOverlap(pts, z)) return false;
    for (const k of ctx.nearby.gardens.near(cx, cy, reach)) { const g = space.gardens[k]; if (!elsewhere(g) && polygonsOverlap(pts, g)) return false; }
    return true;
  }

  /**
   * Builds up one empty middle of a dense quarter's block: rows of buildings square to the nearest street, each inside
   * the piece and clear of the others, with a little clutter in the gaps. B: the quarter's back numbers (LOOK).
   */
  function fillBack(d, shape, k, B, near, r, plots = [], palette = null) {
    const piece = shape.outer, holes = shape.holes ?? [];
    // The plots along the streets (with their boxes): the middle of a block can reach a little into the backs of the
    // odd plot, and a temple's yard or a mansion's grounds stay open
    const [px0, py0, px1, py1] = bbox(piece);
    const near2 = plots.filter(([, b]) => b[0] < px1 && b[2] > px0 && b[1] < py1 && b[3] > py0);
    const onPlot = (pts) => {
      const [x0, y0, x1, y1] = bbox(pts);
      const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
      const inset = pts.map(([x, y]) => { const dx = mx - x, dy = my - y, l = Math.hypot(dx, dy) || 1, t = Math.min(0.08, l * 0.4) / l; return [x + dx * t, y + dy * t]; });
      // (on a battle map half a square off them: a plot's buildings keep half a square in from its edge, so a shed
      // here is a square from them)
      const probe = battle ? apartBy(pts, 0.5) : inset;
      const [g0, h0, g1, h1] = battle ? bbox(probe) : [x0, y0, x1, y1];
      return near2.some(([p, b]) => b[0] < g1 && b[2] > g0 && b[1] < h1 && b[3] > h0 && polygonsOverlap(probe, p));
    };
    const [cx0, cy0] = centroid(piece);
    let dir = [1, 0], bd = Infinity;
    for (const w of near) for (let i = 1; i < w.path.length; i++) {
      const [ax, ay] = w.path[i - 1], [bx, by] = w.path[i];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((cx0 - ax) * dx + (cy0 - ay) * dy) / l2));
      const dd = Math.hypot(ax + t * dx - cx0, ay + t * dy - cy0);
      if (dd < bd) { bd = dd; const l = Math.sqrt(l2); dir = [dx / l, dy / l]; }
    }
    const [ux, uy] = dir, nxv = -uy, nyv = ux;
    const rot = (Math.atan2(uy, ux) * 180) / Math.PI;
    const us = piece.map(([x, y]) => (x - cx0) * ux + (y - cy0) * uy), vs = piece.map(([x, y]) => (x - cx0) * nxv + (y - cy0) * nyv);
    const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
    const ext = (range) => (range[0] + r.next() * (range[1] - range[0])) / sq;
    // (a battle map's sheds a square apart at least, and a square off any other building)
    const gap = battle ? Math.max(B.gap / sq, 1) : B.gap / sq;
    const placed = [];
    const roomy = (pts) => {
      if (!battle) return true;
      const far = apartBy(pts, 1);
      const [x0, y0, x1, y1] = bbox(far);
      for (const k of ctx.nearby.buildings.near((x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0) / 2)) if (polygonsOverlap(far, footOf(space.buildings[k]))) return false;
      return true;
    };
    // Corners in the piece, none of its corners (or a hole's) poking in, and no hole under it
    const inside = (pts) => pts.every((p) => pointInPolygon(p, piece)) && !piece.some((p) => pointInPolygon(p, pts)) && !holes.some((h) => polygonsOverlap(h, pts)) && !onPlot(pts);
    let n = 0, m = 0;
    // A battle map packs a block's middle by trying places at random (it's a ragged leftover between plots): back
    // houses, then sheds beside a house, then a garden or a yard between, all near the street fronts' plots, so open
    // ground (a precinct, a green) stays open
    if (battle) {
      const BEHIND = 6; // how far behind a plot back land is built on, in squares
      // (a place whose middle is in the piece and on the map, found in a few draws: the piece is often a thin ragged
      // shape in a big box)
      const placeAt = (ll, dd) => {
        if (u1 - u0 < ll + 2 * gap || v1 - v0 < dd + 2 * gap) return null;
        for (let j = 0; j < 12; j++) {
          const cu = u0 + gap + ll / 2 + r.next() * (u1 - u0 - 2 * gap - ll), cv = v0 + gap + dd / 2 + r.next() * (v1 - v0 - 2 * gap - dd);
          const x = cx0 + ux * cu + nxv * cv, y = cy0 + uy * cu + nyv * cv;
          if (x < 0 || y < 0 || x > W || y > H || !pointInPolygon([x, y], piece)) continue;
          return { x, y, pts: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + ux * (a * ll) / 2 + nxv * (b * dd) / 2, y + uy * (a * ll) / 2 + nyv * (b * dd) / 2]) };
        }
        return null;
      };
      const clearOf = (pts) => { const far = apartBy(pts, gap); return !placed.some((q) => polygonsOverlap(q, far)); };
      const nearPlot = (pts) => { const far = apartBy(pts, BEHIND); return near2.some(([p]) => polygonsOverlap(far, p)); };
      const besideHouse = (pts) => {
        const far = apartBy(pts, 3), [x0, y0, x1, y1] = bbox(far);
        for (const k of ctx.nearby.buildings.near((x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(x1 - x0, y1 - y0) / 2)) if (polygonsOverlap(far, footOf(space.buildings[k]))) return true;
        return placed.some((q) => polygonsOverlap(q, far));
      };
      const tries = Math.min(400, Math.ceil(area(piece) * 3));
      const build = (small, at, ll, dd) => {
        placed.push(at.pts);
        const use = small ? B.shed.use : B.use;
        const item = addBuilding({ shape: { rect: [at.x - ll / 2, at.y - dd / 2, at.x + ll / 2, at.y + dd / 2] }, rot, roof: pickRoof(d, r, palette), variant: r.int(8), roofStyle: ownStyles(d).length ? ownStyles(d)[r.int(ownStyles(d).length)] : "gable", height: small ? 10 : 15, chimney: use === "house" ? undefined : false, use }, `${d.id}/o-b${k}-${++n}`, r.fork("b", n), d.id);
        // (a back house is a household's own, with a yard behind it where there's room, battle.mjs)
        if (use === "house") item.main = true;
      };
      for (let t = 0; t < tries && n < 200; t++) {
        const ll = ext(B.len), dd = ext(B.dep), at = placeAt(ll, dd);
        if (at && inside(at.pts) && nearPlot(at.pts) && clearOf(at.pts) && rectFree(at.pts) && roomy(at.pts)) build(false, at, ll, dd);
      }
      if (B.shed) for (let t = 0; t < tries * B.shed.share && n < 200; t++) {
        const ll = ext(B.shed.len), dd = ext(B.shed.dep), at = placeAt(ll, dd);
        if (at && inside(at.pts) && nearPlot(at.pts) && besideHouse(at.pts) && clearOf(at.pts) && rectFree(at.pts) && roomy(at.pts)) build(true, at, ll, dd);
      }
      for (let t = 0; t < tries / 2; t++) {
        const ll = ext(B.len), dd = ext(B.dep), at = placeAt(ll, dd);
        if (!at || !inside(at.pts) || !nearPlot(at.pts) || !clearOf(at.pts) || !rectFree(at.pts)) continue;
        placed.push(at.pts);
        const { x, y } = at;
        if (B.gardens && !(B.clutter?.length && r.next() < 0.4)) {
          const garden = { cx: x, cy: y, w: ll * 0.9, d: dd * 0.9, rot, strip: true };
          items.push({ kind: "surface", id: `${d.id}/g-b${k}-${++m}`, from: d.id, class: "garden", garden });
          const gp = shapeToPolygon({ rect: [x - ll * 0.45, y - dd * 0.45, x + ll * 0.45, y + dd * 0.45] }, rot);
          owner.set(gp, d.id);
          space.gardens.push(gp);
        } else if (B.clutter?.length) {
          // (a yard: its ground worn to dirt, a thing or two of the quarter's in it)
          items.push({ kind: "surface", id: `${d.id}/yd-b${k}-${++m}`, from: d.id, class: "yard", poly: at.pts });
          for (let j = 1 + r.int(2); j > 0; j--) {
            const cls = B.clutter[r.int(B.clutter.length)];
            const px = x + ux * (r.next() - 0.5) * ll * 0.5 + nxv * (r.next() - 0.5) * dd * 0.5, py = y + uy * (r.next() - 0.5) * ll * 0.5 + nyv * (r.next() - 0.5) * dd * 0.5;
            items.push({ kind: "prop", id: `${d.id}/q-b${k}-${m}-${j}`, from: d.id, class: cls, x: px, y: py, rot: rot + r.next() * 30, variant: r.int(8), scale: (CLUTTER_FT[cls] ?? 6) / sq / (PROP_SQUARES[cls] ?? 0.45) });
          }
        }
      }
      return;
    }
    for (let v = v0 + gap; v < v1 - gap && n < 200; ) {
      const dd = ext(B.dep);
      for (let u = u0 + gap; u < u1 - gap && n < 200; ) {
        const ll = ext(B.len);
        const cu = u + ll / 2, cv = v + dd / 2;
        const x = cx0 + ux * cu + nxv * cv, y = cy0 + uy * cu + nyv * cv;
        const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + ux * (a * ll) / 2 + nxv * (b * dd) / 2, y + uy * (a * ll) / 2 + nyv * (b * dd) / 2]);
        // Now and then a gap is left open: a yard with the quarter's clutter, or (a close) a garden or an orchard
        const open = r.next() < (B.gardens ? 0.4 : 0.15);
        if (!open && inside(pts) && !placed.some((q) => polygonsOverlap(q, pts)) && rectFree(pts) && roomy(pts)) {
          placed.push(pts);
          addBuilding({ shape: { rect: [x - ll / 2, y - dd / 2, x + ll / 2, y + dd / 2] }, rot, roof: pickRoof(d, r, palette), variant: r.int(8), roofStyle: ownStyles(d).length ? ownStyles(d)[r.int(ownStyles(d).length)] : "gable", height: 15, chimney: B.use === "house" ? undefined : false, use: B.use }, `${d.id}/o-b${k}-${++n}`, r.fork("b", n), d.id);
        } else if (open && B.gardens && inside(pts) && !placed.some((q) => polygonsOverlap(q, pts)) && rectFree(pts)) {
          placed.push(pts);
          if (r.next() < 0.6) {
            const garden = { cx: x, cy: y, w: ll * 0.9, d: dd * 0.9, rot, strip: true };
            items.push({ kind: "surface", id: `${d.id}/g-b${k}-${++m}`, from: d.id, class: "garden", garden });
            const gp = shapeToPolygon({ rect: [x - ll * 0.45, y - dd * 0.45, x + ll * 0.45, y + dd * 0.45] }, rot);
            owner.set(gp, d.id);
            space.gardens.push(gp);
          } else for (const [a2, b2] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
            const tx = x + ux * a2 * ll + nxv * b2 * dd, ty = y + uy * a2 * ll + nyv * b2 * dd;
            items.push({ kind: "tree", id: `${d.id}/t-b${k}-${++m}`, from: d.id, x: tx, y: ty, species: "bare", size: null, s: 0.35 + r.next() * 0.1, rot: r.next() * 360, variant: r.int(8) });
          }
        } else if (open && B.clutter?.length && inside(pts) && !placed.some((q) => polygonsOverlap(q, pts)) && rectFree(pts)) {
          placed.push(pts); // the yard stays open
          const cls = B.clutter[r.int(B.clutter.length)];
          items.push({ kind: "prop", id: `${d.id}/q-b${k}-${++m}`, from: d.id, class: cls, x, y, rot: rot + r.next() * 30, variant: r.int(8), scale: (CLUTTER_FT[cls] ?? 6) / sq / (PROP_SQUARES[cls] ?? 0.45) });
        }
        u += ll + gap;
      }
      v += dd + gap;
    }
  }

  /** Puts a district's anchor on the map: its square, buildings, garden, walls, props and trees. */
  function addAnchor(d, A, r) {
    A.surfaces.forEach((x, k) => items.push({ kind: "surface", id: `${d.id}/anchor-s${k + 1}`, from: d.id, class: x.class, poly: x.poly, ...(x.surface ? { surface: x.surface } : {}) }));
    // The landmark and its parts, ids as a house's (the first, then w1, w2...), so it's picked and pinned as one
    A.buildings.forEach((b, k) => addBuilding(b.spec, k ? `${d.id}/h-anchor0w${k}` : `${d.id}/h-anchor0`, r.fork(b.key), d.id));
    A.walls.forEach((path, k) => items.push({ kind: "wall", id: `${d.id}/anchor-v${k + 1}`, from: d.id, class: "stone", path, height: 6 / sq }));
    A.hedges.forEach((path, k) => items.push({ kind: "boundary", id: `${d.id}/anchor-h${k + 1}`, from: d.id, class: "clipped", path }));
    // (a stall comes with its own color and scale)
    A.props.forEach((x, k) => { const variant = r.int(8); items.push({ kind: "prop", id: `${d.id}/anchor-q${k + 1}`, from: d.id, class: x.class, x: x.x, y: x.y, rot: x.rot, variant: x.variant ?? variant, scale: x.scale ?? (x.size ?? CLUTTER_FT[x.class] ?? 6) / sq / (PROP_SQUARES[x.class] ?? 0.45) }); });
    A.trees.forEach((t, k) => items.push({ kind: "tree", id: `${d.id}/anchor-t${k + 1}`, from: d.id, x: t.x, y: t.y, species: t.species ?? "bare", size: t.size ?? null, s: t.s, rot: t.rot, variant: t.variant }));
    // The temple's yard holds its graves (a churchyard is where a parish buries its own; big cemeteries lie outside)
    for (const yard of A.surfaces.filter((x) => x.class === "churchyard")) addGraves(d, yard.poly, A.rot ?? 0, graveCount(d, true), r.fork("graves"));
    // Kept clear, so nothing else is built on it
    const kept = A.block;
    owner.set(kept, d.id);
    space.reserved.push(kept);
    space.zones.push(kept);
  }

  /**
   * Wells, fountains, shrines and watch posts at the corners of a district's streets: just off a street where two
   * meet or one ends, on free ground, kept apart from each other.
   */
  function streetCorners(d, poly, own, want, r) {
    // Where two of its own streets meet (a well or fountain stands right there, in the crossing; never on the plan's
    // roads), and spots along every street just off it (a shrine or watch post, where there's room)
    const junctions = [];
    for (const w of own) for (const end of [w.path[0], w.path[w.path.length - 1]]) {
      if (own.some((o) => o !== w && distanceToPath(end, o.path) < (o.width ?? 0.6) / 2 + 0.1) && !ways.some((o) => distanceToPath(end, o.path) < (o.width ?? 0.6) / 2 + 0.6)) junctions.push(end);
    }
    const spots = [];
    for (const w of own) for (const [at, dir] of stepsAlong(w.path, 2.5)) for (const s of [-1, 1]) spots.push({ at, dir, side: s, width: w.width });
    const order = r.shuffle(spots), crossings = r.shuffle(junctions);
    // What this district has already put down that space doesn't hold (walls, props, trees, kilns), to keep off
    const mine = items.filter((i) => i.from === d.id && (i.kind === "prop" || i.kind === "tree" || i.kind === "kiln"));
    const myWalls = items.filter((i) => i.from === d.id && i.kind === "wall");
    const clearOfMine = (x, y, rad) => !mine.some((i) => Math.hypot(i.x - x, i.y - y) < rad + (i.rad ?? 0.25)) && !myWalls.some((w) => distanceToPath([x, y], w.path) < rad + 0.1);
    const ownBuildings = space.buildings.filter((b) => owner.get(b) === d.id || owner.get(b) === b.from && !ctx.dfeats.some((f) => f.id === owner.get(b)));
    const taken = [];
    const SIZE = { well: 10, fountain: 18, shrine: 12, watch: 14 }; // feet across
    for (const [what, n] of Object.entries(want)) {
      let left = n;
      if (what === "well" || what === "fountain") {
        for (const [x, y] of crossings) {
          if (left <= 0) break;
          const size = SIZE[what] / sq;
          if (!pointInPolygon([x, y], poly) || taken.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < 6) || !clearOfMine(x, y, size / 2)) continue;
          if (ownBuildings.some((b) => Math.hypot(b.cx - x, b.cy - y) < Math.max(b.len, b.dep) / 2 + size / 2)) continue;
          taken.push([x, y]);
          left--;
          items.push({ kind: "prop", id: `${d.id}/x-${what}${taken.length}`, from: d.id, class: what, x, y, rot: 0, variant: r.int(8), scale: (what === "fountain" ? 18 : 8) / sq / 0.45 });
        }
      }
      for (const sp of order) {
        if (left <= 0) break;
        const size = SIZE[what] / sq, reach = (size / 2) * Math.SQRT2; // a turned square's corners reach farther
        const off = sp.width / 2 + reach + 0.25, along = reach + 0.4;
        const x = sp.at[0] + sp.dir[0] * along - sp.dir[1] * off * sp.side, y = sp.at[1] + sp.dir[1] * along + sp.dir[0] * off * sp.side;
        const rot = (Math.atan2(sp.dir[1], sp.dir[0]) * 180) / Math.PI;
        const box = shapeToPolygon({ rect: [x - reach, y - reach, x + reach, y + reach] });
        if (!box.every((p) => pointInPolygon(p, poly)) || taken.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < 6)) continue;
        if (!free(x, y, reach + 0.1, reach) || !rectFree(box) || !clearOfMine(x, y, reach)) continue;
        taken.push([x, y]);
        left--;
        if (what === "shrine") addBuilding({ shape: { rect: [x - size / 2, y - size / 2, x + size / 2, y + size / 2] }, rot, roof: "slate", roofStyle: "pyramid", height: 22, chimney: false, use: "shrine" }, `${d.id}/h-shrine${taken.length}`, r.fork("shrine", taken.length), d.id);
        else if (what === "watch") addBuilding({ shape: { circle: [x, y, size / 2] }, rot, roof: "slate-black", roofStyle: "flat", height: 34, chimney: false, tower: true, crenels: true, use: "watch" }, `${d.id}/h-watch${taken.length}`, r.fork("watch", taken.length), d.id);
        else items.push({ kind: "prop", id: `${d.id}/x-${what}${taken.length}`, from: d.id, class: what, x, y, rot, variant: r.int(8), scale: (what === "fountain" ? SIZE.fountain : 8) / sq / 0.45 });
      }
    }
  }

  /** How many graves a temple's yard holds: more in a bigger place, most around a cathedral. */
  function graveCount(d, cathedral) {
    return Math.round(({ hamlet: 8, village: 14, town: 22, city: 30 }[d.profile] ?? 14) * (cathedral ? 1.6 : 1));
  }
  /**
   * Graves in rows in a temple's yard, square to the temple, each clear of buildings, trees and each other.
   */
  function addGraves(d, poly, rot, count, r) {
    const ux = Math.cos((rot * Math.PI) / 180), uy = Math.sin((rot * Math.PI) / 180);
    const [cx, cy] = centroid(poly);
    const us = poly.map(([x, y]) => (x - cx) * ux + (y - cy) * uy), vs = poly.map(([x, y]) => -(x - cx) * uy + (y - cy) * ux);
    const step = 14 / sq, row = 20 / sq;
    const spots = [];
    // Only this district's own trees, so its graves stay inside its cache key (a grave under a plan's tree is taken
    // out after, with the other districts' clean-up)
    const trees = items.filter((t) => t.kind === "tree" && t.from === d.id);
    for (let v = Math.min(...vs) + row / 2; v < Math.max(...vs); v += row) for (let u = Math.min(...us) + step / 2; u < Math.max(...us); u += step) {
      const x = cx + ux * u - uy * v, y = cy + uy * u + ux * v;
      if (pointInPolygon([x, y], poly) && free(x, y, 0.3, 0.2) && !trees.some((t) => Math.abs(t.x - x) < 0.8 && Math.abs(t.y - y) < 0.8)) spots.push([x, y]);
    }
    // Rows filled from one side, a few gaps left, so the yard reads as used but not full
    let n = 0;
    for (const [x, y] of spots) {
      if (n >= count) break;
      if (r.next() < 0.25) continue;
      items.push({ kind: "prop", id: `${d.id}/grave${++n}-${Math.round(x * 10)}`, from: d.id, class: "grave", x, y, rot: rot + 90 + (r.next() - 0.5) * 8, variant: r.int(8), scale: 9 / sq / 0.45 });
    }
  }
}
