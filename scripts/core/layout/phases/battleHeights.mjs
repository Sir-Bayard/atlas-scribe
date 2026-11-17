// One phase of laying out a plan (layout/index.mjs, layoutPlan): ctx holds what the phases share.
import { bandPieces } from "../walls.mjs";
import { distanceToPath, pointInPolygon, shapeToPolygon } from "../../geom.mjs";
import { easeOnto } from "../crossings.mjs";
import { edgeSpan, resample, shiftRight, terrainOf } from "../terrain.mjs";

/**
 * Height on a battle map: the ground's levels (rises, hollows, stream beds) and the edges between them, each edge's
 * band kept clear (nothing is built or grows on a cliff face or a bank) (terrain.mjs)
 */
export function battleHeights(ctx) {
  const { asGiven, battle, items, notes, plan, space, sq, streamFor, ways } = ctx;
  Object.assign(ctx, { footOf });
  /** A building item's footprint (a round one's square box; a row house's own outline). */
  function footOf(b) {
    if (b.poly) return b.poly;
    return b.round ? shapeToPolygon({ rect: [b.cx - b.len / 2, b.cy - b.dep / 2, b.cx + b.len / 2, b.cy + b.dep / 2] }, b.rot) : shapeToPolygon({ rect: [b.cx - b.len / 2, b.cy - b.dep / 2, b.cx + b.len / 2, b.cy + b.dep / 2] }, b.rot);
  }
  if (battle) {
    const t = terrainOf({ plan, items, sq, pick: streamFor });
    notes.push(...t.notes);
    for (const L of t.levels) items.push({ kind: "level", id: L.id, from: L.from, name: L.name, rings: L.rings, elevation: L.elevation, style: L.style, rock: L.rock, bed: L.bed, water: L.water ?? null, waterClass: L.waterClass ?? null, within: L.within ?? null, ...(L.shore ? { shore: L.shore } : {}) });
    for (const e of t.edges) {
      items.push(e);
      // (a walkable slope is ground like any: trees and houses may stand on it)
      if (e.style === "slope") continue;
      const span = edgeSpan(e) + (e.style === "slope" ? 0 : 0.3);
      const mid = shiftRight(resample(e.path, 0.5), span / 2);
      for (const poly of bandPieces(mid, span / 2 + 0.15)) { space.reserved.push(poly); space.zones.push(poly); }
    }
    for (const L of t.levels.filter((x) => x.bed)) for (const ring of L.rings) space.reserved.push(ring);
    // A cliff drawn as a line: an edge of its own, its high side on its left as every edge's (its ground already kept
    // clear by its band), from the ground around it up its height; it bounds no level, so it sets no token's elevation
    for (const c of items.filter((i) => i.kind === "cliff")) {
      if (!Array.isArray(c.path) || c.path.length < 2) continue;
      const h = Math.max(5, c.height ?? 30);
      const path = c.sign > 0 ? [...c.path].reverse() : c.path.map((p) => [...p]);
      // (its foot on whatever ground lies below it, a rise's or a hollow's)
      const foot = shiftRight(resample(path, 0.5), 0.5), low = t.elevAt(foot[Math.floor(foot.length / 2)]);
      items.push({ kind: "edge", id: `${c.id}/edge1`, from: c.from, path, closed: false, drop: h, high: low + h, low, style: "cliff", rock: c.rock, bed: false, line: true, ...(c.climbDC != null ? { climbDC: c.climbDC } : {}) });
    }
    // A bridge over a stream's bed is lengthened until both its ends stand clear of the bed, bank top to bank top
    const beds = t.levels.filter((x) => x.bed);
    const inBed = (p) => beds.some((Lv) => { let n = 0; for (const r of Lv.rings) if (pointInPolygon(p, r)) n++; return n % 2 === 1; });
    for (const c of items.filter((i) => i.kind === "crossing" && i.class !== "ford" && Array.isArray(i.at))) {
      const a = ((c.angle ?? 0) * Math.PI) / 180, u = [Math.cos(a), Math.sin(a)];
      const end = (sg) => [c.at[0] + sg * u[0] * (c.length ?? 2) / 2, c.at[1] + sg * u[1] * (c.length ?? 2) / 2];
      for (let k = 0; k < 60 && (inBed(end(1)) || inBed(end(-1))); k++) c.length = (c.length ?? 2) + 0.25;
      // (and a road over it bends onto it gently over the squares before it, kept clear along its new line)
      for (const w of ways) {
        const eased = easeOnto(w.path, c);
        if (!eased) continue;
        // (a road joining it near the bridge has its end carried along, so it still meets it)
        for (const o of ways) {
          if (o === w) continue;
          const ends = [0, o.path.length - 1].filter((i) => distanceToPath(o.path[i], w.path) < 0.3);
          if (!ends.length) continue;
          const path = o.path.map((p, i) => (ends.includes(i) ? eased.move(p) : p));
          for (const sw of space.ways) if (sw.path === o.path) sw.path = path;
          o.path = path;
        }
        for (const sw of space.ways) if (sw.path === w.path) sw.path = eased.path;
        w.path = eased.path;
      }
    }
  }

  // A curve swings a little outside its straight line at a bend: say so where that takes a road into a plan building
  // its straight line kept clear of (more points, or straight: true, fixes it)
  {
    const fixed = new Set(plan.features.filter((f) => f.type === "building" || f.type === "landmark").map((f) => f.id));
    const feet = items.filter((i) => i.kind === "building" && fixed.has(i.from));
    for (const w of ways) {
      const given = asGiven.features.find((f) => f.id === w.id)?.path;
      if (!given || given.length < 3) continue;
      for (const b of feet) {
        const foot = footOf(b);
        const ring = [...foot, foot[0]];
        const gap = (path) => Math.min(...foot.map((p) => distanceToPath(p, path)), ...path.map((p) => (pointInPolygon(p, foot) ? 0 : distanceToPath(p, ring))));
        if (gap(w.path) < w.width / 2 && gap(given) >= w.width / 2)
          notes.push({ level: "warning", id: w.id, message: `"${w.id}" curves into "${b.from}" at a bend. Give the road another point there, or set straight: true on it.` });
      }
    }
  }
}
