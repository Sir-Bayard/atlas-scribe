// One step of making a plan from Quick Start's choices (quick.mjs, quickPlan): ctx holds what the steps share.
import { distToPath, distToPoly, inside, pt } from "../quick.mjs";
import { shapeToPolygon } from "../geom.mjs";
import { makeNoise } from "../noise.mjs";
import { rng } from "../rng.mjs";

/**
 * High ground along an edge, when asked (choices.high): hills in a band along the side with the least on it (no water,
 * the fewest roads leaving, the most room before the place), their inner edge ragged; with mountains, the mountains
 * along the very edge and the hills in front of them. The band stops short of the districts, the water, the farms and
 * fields; a side with no room for it leaves it out, with a note. From streams of its own, so nothing else moves.
 */
export function highGround(ctx) {
  const { H, W, choices, cluster, features, roads, seed } = ctx;
  const want = ctx.options?.high;
  if (want !== "hills" && want !== "mountains") return;
  choices.high = want;
  const r = rng(seed, "quick", "high");
  const sides = ["north", "south", "east", "west"];
  const pts = (side, t, d) => (side === "north" ? [t, d] : side === "south" ? [t, H - d] : side === "west" ? [d, t] : [W - d, t]);
  const lenOf = (side) => (side === "north" || side === "south" ? W : H);
  // (how far in from the edge it may reach at a point along it: short of the town, the water, farms and fields)
  // (every area laid so far but woods, whatever its shape is written as: farms, fields, yards; woods may climb hills)
  const kept = [...cluster, ...features.filter((f) => f.type === "area" && f.class !== "woods" && f.shape).map((f) => shapeToPolygon(f.shape, f.rot ?? 0)).filter((p) => p.length >= 3)];
  const water = features.filter((f) => f.type === "water");
  // (the mills' races and yards, and the cemetery, kept off as well)
  const mills = ctx.millKeep ?? [];
  if (ctx.cemetery) kept.push(ctx.cemetery);
  const roomAt = (side, t, most) => {
    for (let d = 1; d <= most; d += 1) {
      const p = pts(side, t, d);
      if (kept.some((poly) => inside(p, poly) || distToPoly(p, poly) < 2.5)) return d - 2.5;
      if (water.some((w) => (Array.isArray(w.path) ? distToPath(p, w.path) < 3 : false))) return d - 3;
      if (mills.some((k) => (k.poly ? distToPoly(p, k.poly) < 3 : distToPath(p, k.path) < k.half + 3))) return d - 3;
    }
    return most;
  };
  const most = Math.min(W, H) * (want === "mountains" ? 0.32 : 0.26);
  // (the side scored by its room, less for each road leaving through it)
  const score = (side) => {
    let room = 0;
    for (let t = 0; t <= lenOf(side); t += 4) room += Math.max(0, roomAt(side, t, most));
    const leaving = roads.filter((rd) => rd.path.some((p) => (side === "north" ? p[1] < 1 : side === "south" ? p[1] > H - 1 : side === "west" ? p[0] < 1 : p[0] > W - 1))).length;
    return room - leaving * lenOf(side) * 1.5;
  };
  const side = sides.map((s) => ({ s, v: score(s) + r.next() })).sort((a, b) => b.v - a.v)[0].s;
  const noise = makeNoise(seed, "quick-high", { scale: 9, octaves: 2 });
  const band = (frac, k) => {
    const line = [];
    for (let t = -2; t <= lenOf(side) + 2; t += 0.75) {
      const room = roomAt(side, Math.max(0, Math.min(lenOf(side), t)), most);
      const d = Math.min(room, most * frac * (0.75 + 0.5 * (noise(t, k * 17) + 1) / 2));
      line.push(pts(side, t, Math.max(0, d)));
    }
    // (its far side well off the map, so its contours, drawn in from the whole outline, rise toward the edge and the
    // top lies past it, as ground rising out of the map)
    const e = most;
    const out = side === "north" ? [[W + e, -e], [-e, -e]] : side === "south" ? [[W + e, H + e], [-e, H + e]] : side === "west" ? [[-e, H + e], [-e, -e]] : [[W + e, H + e], [W + e, -e]];
    const deep = line.filter((p) => (side === "north" ? p[1] : side === "south" ? H - p[1] : side === "west" ? p[0] : W - p[0]) > 2.5).length;
    return deep > line.length * 0.4 ? [...line, ...out].map(pt) : null;
  };
  const hills = band(1, 1);
  if (!hills) { (ctx.notes ??= []).push("There was no room along any edge for the high ground asked for, so the map has none."); return; }
  features.push({ id: "hills", type: "area", class: "hills", name: "The hills", shape: hills });
  if (want === "mountains") {
    const peaks = band(0.5, 2);
    if (peaks) features.push({ id: "mountains", type: "area", class: "mountains", name: "The mountains", shape: peaks });
  }
}
