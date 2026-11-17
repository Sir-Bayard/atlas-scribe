// One phase of laying out a plan (layout/index.mjs, layoutPlan): ctx holds what the phases share.
import { closed } from "../index.mjs";
import { distanceToPath, pointInPolygon, shapeToPolygon } from "../../geom.mjs";
import { nearWater } from "../../water.mjs";

/**
 * Tracks: a district street that stops at its edge carries on as a trodden track into the land, wandering a little,
 * until it reaches a field gate, a road, water, another district or its length. Laid after the fields, from what
 * the plan, the fields and this district placed, so rerolling one district never changes another's
 */
export function wildTracks(ctx) {
  const { H, W, dfeats, districts, dlist, footOf, free, items, owner, plan, space, sq, streamFor, ways } = ctx;
  const fieldItems = items.filter((i) => i.kind === "field");
  const areaPolys = plan.features.filter((f) => f.type === "area" && f.class !== "fields").map((f) => shapeToPolygon(f.shape, f.rot ?? 0, 32));
  for (const d of dfeats) {
    ctx.filling = d.id;
    const { poly } = dlist.find((x) => x.id === d.id);
    const ring = closed(poly);
    const tr = streamFor(d.id).fork("tracks");
    let n = 0;
    for (const st of items.filter((i) => i.kind === "way" && i.from === d.id && !i.faint)) {
      for (const end of [0, st.path.length - 1]) {
        const want = tr.range(4, 10), wobble = tr.range(-6, 6), some = tr.chance(0.6); // drawn for every end, so the stream stays the same
        if (!some) continue; // not every lane runs on out to the fields
        const p = st.path[end], q = st.path[end === 0 ? 1 : end - 1];
        if (!q || distanceToPath(p, ring) > 1) continue; // ends inside the district
        if ([...ways, ...items.filter((w) => w.kind === "way" && w.from === d.id)].some((w) => w !== st && distanceToPath(p, w.path) < w.width / 2 + 0.6)) continue; // meets a way
        const l = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1;
        let dir = Math.atan2(p[1] - q[1], p[0] - q[0]);
        if (pointInPolygon([p[0] + ((p[0] - q[0]) / l) * 1.5, p[1] + ((p[1] - q[1]) / l) * 1.5], poly)) continue; // runs back in
        // A house by the lane's end (the district's own or one pinned there): a track (wider than a lane) would clip it
        const trackHalf = 10 / sq / 2 + 0.02;
        if (items.some((b) => b.kind === "building" && Math.abs(b.cx - p[0]) < Math.max(b.len, b.dep) + 1 && Math.abs(b.cy - p[1]) < Math.max(b.len, b.dep) + 1 && (pointInPolygon(p, footOf(b)) || distanceToPath(p, closed(footOf(b))) < trackHalf))) continue;
        const path = [p];
        let at = p, joined = false;
        for (let k = 0; k < want; k++) {
          dir += (wobble * Math.PI) / 180 / 3;
          const next = [at[0] + Math.cos(dir), at[1] + Math.sin(dir)];
          if (next[0] < 0.5 || next[1] < 0.5 || next[0] > W - 0.5 || next[1] > H - 0.5) break;
          if (space.water.some((w) => nearWater(next, w, 0.3))) break;
          if (fieldItems.some((f) => pointInPolygon(next, f.poly))) break; // at a field's gate
          if (districts.some((o) => o.id !== d.id && pointInPolygon(next, o.poly))) break;
          // A square short of a wood, a yard or a green, so a track never thins the trees at a wood's edge
          if (areaPolys.some((a) => pointInPolygon(next, a) || distanceToPath(next, closed(a)) < 1)) break;
          const road = ways.find((w) => distanceToPath(next, w.path) < w.width / 2 + 0.2);
          if (road) { path.push(next); joined = true; break; }
          if (!free(next[0], next[1], 0.3)) break;
          path.push(next);
          at = next;
        }
        if (path.length < (joined ? 2 : 3)) continue;
        const item = { kind: "way", id: `${d.id}/t${++n}`, from: d.id, class: "track", path, width: 10 / sq, surface: "trodden", ruts: false, faint: true };
        items.push(item);
        const entry = { path, clear: item.width / 2 };
        owner.set(entry, d.id);
        space.ways.push(entry);
      }
    }
    ctx.filling = null;
  }
}
