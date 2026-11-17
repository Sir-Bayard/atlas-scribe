// One phase of laying out a plan (layout/index.mjs, layoutPlan): ctx holds what the phases share.
import { PROP_SQUARES } from "../../plan.mjs";
import { closed, dryPieces } from "../index.mjs";
import { distanceToPath, pointInPolygon, shapeToPolygon } from "../../geom.mjs";
import { fillCemetery } from "../cemetery.mjs";
import { fillPark, hedgeBushes } from "../settlement.mjs";
import { nearWater } from "../../water.mjs";

/**
 * Parks, filled now: their paths start where the roads, the districts' streets and their own lanes meet them
 */
export function fillParks(ctx) {
  const { addBuilding, bodies, dropWet, footOf, items, lanes, parks, space, sq, streamFor, ways } = ctx;
  const streets = items.filter((i) => i.kind === "way" && !i.faint && !ways.includes(i));
  for (const f of parks) {
    if (f.class === "cemetery") { layCemetery(f); continue; }
    const park = fillPark({ area: f, r: streamFor(f.id), roads: [...ways, ...lanes.filter((l) => l.from === f.id), ...streets], ftPerSquare: sq });
    // A pond, lake or the sea on a green: its paths stop at the shore, and no tree or bed stands in the water
    if (bodies.length) {
      const wet = (x, y, extra = 0) => space.water.some((w) => w.body && nearWater([x, y], w, extra));
      park.surface.paths = park.surface.paths.flatMap((w) => dryPieces(w.path, (q) => wet(q[0], q[1], w.width / 2)).map((path) => ({ ...w, path })));
      park.trees = park.trees.filter((t) => !wet(t.x, t.y, 0.3));
      park.beds = park.beds.filter((b) => !wet(b.cx, b.cy, Math.hypot(b.w, b.d) / 2));
      if (park.surface.basin && wet(park.surface.basin.at[0], park.surface.basin.at[1], park.surface.basin.radius)) park.surface.basin = null;
    }
    items.push({ kind: "surface", id: f.id, from: f.id, class: "park", poly: park.surface.poly, style: park.surface.style, paths: park.surface.paths, basin: park.surface.basin });
    park.trees.forEach((t, k) => items.push({ kind: "tree", id: `${f.id}/t${k + 1}`, from: f.id, x: t.x, y: t.y, species: "bare", size: null, s: t.s, rot: t.rot, variant: t.variant }));
    park.beds.forEach((garden, k) => items.push({ kind: "surface", id: `${f.id}/g${k + 1}`, from: f.id, class: "garden", garden }));
    // Clipped hedges around the beds: small bushes close together
    park.hedges.forEach((path, k) => {
      const before = items.length;
      hedgeBushes({ wall: { id: `${f.id}/h${k + 1}`, from: f.id, path }, r: streamFor(f.id).fork("hedge", k), items, step: 0.22, scale: [0.32, 0.08] });
      dropWet(before);
    });
  }

  /**
   * A cemetery: its ground and paths as a park's (style cemetery), yews, graves, its tombs and chapel, and its wall or
   * hedge; paths cut at a pond, lake or the sea, and nothing of it in the water.
   */
  function layCemetery(f) {
    const r = streamFor(f.id);
    const c = fillCemetery({ area: f, r, roads: [...ways, ...lanes.filter((l) => l.from === f.id), ...streets], ftPerSquare: sq });
    if (c.surface.poly.length < 3) return; // (a shape with no area: nothing to lay out)
    // What's there already keeps its place (roads, water, buildings, props and trees); the cemetery's paths are cut
    // at water, and its graves, yews, tombs, chapel, wall and hedge are left out where they'd stand on any of it.
    // Only things standing in it count, so a neighbor's reroll never changes it
    const outline = shapeToPolygon(f.shape, f.rot ?? 0);
    const here = (x) => x.from !== f.id;
    const foots = items.filter((i) => i.kind === "building" && here(i)).map((b) => footOf(b)).filter((ft) => ft.some((q) => pointInPolygon(q, outline)) || outline.some((q) => pointInPolygon(q, ft)));
    const things = items.filter((i) => (i.kind === "prop" || i.kind === "tree") && here(i) && pointInPolygon([i.x, i.y], outline)).map((q) => ({ x: q.x, y: q.y, r: q.kind === "tree" ? 0.5 : ((PROP_SQUARES[q.class] ?? 0.45) * (q.scale ?? 1)) / 2 }));
    const allWays = [...ways, ...streets, ...lanes.filter((l) => l.from !== f.id)];
    const wet = (x, y, extra = 0) => space.water.some((w) => nearWater([x, y], w, extra));
    const crossed = (x, y, m) => wet(x, y, m) || allWays.some((w) => distanceToPath([x, y], w.path) < w.width / 2 + m);
    const taken = (x, y, m) => crossed(x, y, m)
      || foots.some((ft) => pointInPolygon([x, y], ft) || distanceToPath([x, y], closed(ft)) < m) || things.some((q) => Math.hypot(q.x - x, q.y - y) < q.r + m);
    c.surface.paths = c.surface.paths.flatMap((w) => dryPieces(w.path, (q) => wet(q[0], q[1], w.width / 2)).map((path) => ({ ...w, path }))).filter((w) => w.path.length >= 2);
    items.push({ kind: "surface", id: f.id, from: f.id, class: "park", poly: c.surface.poly, style: "cemetery", paths: c.surface.paths, basin: null });
    c.buildings.forEach(({ key, spec }) => {
      const [x0, y0, x1, y1] = spec.shape.rect, foot = shapeToPolygon(spec.shape, spec.rot ?? 0);
      if (![[(x0 + x1) / 2, (y0 + y1) / 2], ...foot].some(([x, y]) => taken(x, y, 0.2))) addBuilding(spec, `${f.id}/${key}`, r.fork(key), f.id);
    });
    c.trees.forEach((t, k) => { if (!taken(t.x, t.y, 0.3)) items.push({ kind: "tree", id: `${f.id}/t${k + 1}`, from: f.id, x: t.x, y: t.y, species: "conifer", size: "medium", s: t.s, rot: t.rot, variant: t.variant }); });
    c.graves.forEach((g, k) => { if (!taken(g.x, g.y, 0.2)) items.push({ kind: "prop", id: `${f.id}/grave${k + 1}`, from: f.id, class: "grave", x: g.x, y: g.y, rot: g.rot, variant: g.variant, scale: 7 / sq / 0.45 }); });
    // (a wall or hedge broken only where a road or water crosses its line)
    const pieces = (path) => { const out = []; let cur = []; for (const q of path) { if (crossed(q[0], q[1], 0.3)) { if (cur.length > 1) out.push(cur); cur = []; } else cur.push(q); } if (cur.length > 1) out.push(cur); return out; };
    c.walls.flatMap(pieces).forEach((path, k) => items.push({ kind: "wall", id: `${f.id}/w${k + 1}`, from: f.id, class: "drystone", path, height: 4 / sq }));
    c.hedges.flatMap(pieces).forEach((path, k) => {
      const before = items.length;
      items.push({ kind: "boundary", id: `${f.id}/h${k + 1}`, from: f.id, class: "hedge", path });
      hedgeBushes({ wall: { id: `${f.id}/h${k + 1}`, from: f.id, path }, r: r.fork("hedge", k), items, step: 0.4, scale: [0.5, 0.2] });
      dropWet(before);
    });
  }
}
