// One step of making a plan from Quick Start's choices (quick.mjs, quickPlan): ctx holds what the steps share.
import { add, distToPoly, inside, mul, outline, pt } from "../quick.mjs";
import { toEdge, grown, biggest } from "../quick-city.mjs";
import { area, difference, intersect } from "../lots/poly.mjs";
import { rng } from "../rng.mjs";

/** The sea a village's or town's map keeps on its side, in squares, at the least. */
const SEA_ROOM = { hamlet: 10, village: 12, town: 16 };

/**
 * A village's or town's sea coast or lake shore (choices.water coast or lake), on the side ctx.shoreAt faces (screen
 * degrees, set by roadsAndDistricts): the shore a little beyond the houses on that side, the sea or lake past it. A
 * district or road reaching into the water is cut back at the shore; where a road reaches it, a pier (a jetty in a
 * hamlet or village) runs out, with a boat or two moored by it. From a stream of its own.
 */
export function shoreSide(ctx) {
  const { C, H, W, choices, cluster, districts, features, roads, seed } = ctx;
  ctx.shore = null;
  if (choices.water !== "coast" && choices.water !== "lake") return;
  const sr = rng(seed, "quick", "shore");
  const deg = ctx.shoreAt, N = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)], T = [-N[1], N[0]];
  const along = (p) => (p[0] - C[0]) * N[0] + (p[1] - C[1]) * N[1];
  // (the shore a few squares past the houses on that side, leaving the sea or lake room on the map)
  const reach = Math.max(...cluster.flat().map(along));
  const room = toEdge(C, N, W, H) - (SEA_ROOM[choices.size] ?? 12);
  const d = Math.min(reach + sr.range(3.5, 6), room);
  const span = Math.hypot(W, H);
  let water;
  if (choices.water === "coast") {
    // (a shore line across the map, square to the sea's side, wandering a little; the sea all beyond it)
    const line = [];
    let off = 0;
    for (let s = -span; s <= span; s += 4) { off = Math.max(-2.5, Math.min(2.5, off + sr.range(-1.2, 1.2))); line.push(add(add(C, mul(N, d + off)), mul(T, s))); }
    const far = line.map((p) => add(p, mul(N, span))).reverse();
    water = biggest(intersect([[...line, ...far]], [[[0, 0], [W, 0], [W, H], [0, H]]]));
  } else {
    // (a lake: an oval whose near shore is that far out, its far shore on the map or past its edge)
    const out = toEdge(C, N, W, H) - d;
    const rb = Math.max(6, out * sr.range(0.75, 1.5)), ra = Math.min(span * 0.45, rb * sr.range(1.4, 2.3));
    const lc = add(C, mul(N, d + rb)), ring = [];
    for (let k = 0; k < 24; k++) {
      const t = (k / 24) * 2 * Math.PI, rr = sr.range(0.93, 1.06);
      ring.push(add(lc, add(mul(T, Math.cos(t) * ra * rr), mul(N, Math.sin(t) * rb * rr))));
    }
    water = biggest(intersect([ring], [[[0, 0], [W, 0], [W, H], [0, H]]]));
  }
  if (!water || area(water) < 40) { (ctx.notes ??= []).push(`There was no room on the map for the ${choices.water === "coast" ? "sea" : "lake"}, so it was left out.`); return; }
  water = outline(water.map(pt));
  // (the layout roughens a body's shore by up to half a square, a lake's a little more: kept clear of that)
  const wet = grown(water, choices.water === "lake" ? 0.9 : 0.5);
  ctx.shore = { poly: water, wet, cls: choices.water === "coast" ? "sea" : "lake" };
  features.push({ id: choices.water === "coast" ? "sea" : "lake", type: "water", class: choices.water === "coast" ? "sea" : "lake", shape: water });

  // A district reaching into the water keeps its land; one left with little is dropped (a hamlet's never is)
  for (const dist of districts) {
    if (!dist.poly.some((p) => inside(p, wet)) && !wet.some((p) => inside(p, dist.poly))) continue;
    const land = biggest(difference([dist.poly], [wet]));
    if (land && (area(land) > area(dist.poly) * 0.35 || dist.profile === "hamlet")) dist.poly = outline(land.map(pt));
    else dist.gone = true;
  }
  for (let k = districts.length - 1; k >= 0; k--) if (districts[k].gone) districts.splice(k, 1);
  cluster.length = 0; cluster.push(...districts.map((x) => x.poly));

  // Roads stop at the shore: each keeps the stretch nearest the middle; where one reaches the water, a pier
  const wetAt = (p) => inside(p, wet);
  const landings = [];
  // (where segment a-b, one end dry and one in the water, meets the shore)
  const meet = (dry, wetP) => {
    let lo = 0, hi = 1;
    for (let s = 0; s < 18; s++) { const m = (lo + hi) / 2; if (wetAt([dry[0] + (wetP[0] - dry[0]) * m, dry[1] + (wetP[1] - dry[1]) * m])) hi = m; else lo = m; }
    return pt([dry[0] + (wetP[0] - dry[0]) * lo, dry[1] + (wetP[1] - dry[1]) * lo]);
  };
  for (let k = roads.length - 1; k >= 0; k--) {
    const rd = roads[k];
    if (!rd.path.some(wetAt)) continue; // (dry all along)
    // (its dry stretches, each with the shore where it begins or ends at the water)
    const runs = [];
    let run = null;
    for (let i = 0; i < rd.path.length; i++) {
      const p = rd.path[i], wet = wetAt(p);
      if (!wet) {
        if (!run) { run = { pts: [], wetStart: null, wetEnd: null }; if (i > 0) { const at = meet(p, rd.path[i - 1]); run.pts.push(at); run.wetStart = { at, from: p }; } }
        run.pts.push(p);
      } else if (run) {
        const a = run.pts[run.pts.length - 1], at = meet(a, p);
        run.pts.push(at); run.wetEnd = { at, from: a };
        runs.push(run); run = null;
      }
    }
    if (run) runs.push(run);
    const nearest = (pts) => Math.min(...pts.map((p) => Math.hypot(p[0] - C[0], p[1] - C[1])));
    const keep = runs.filter((x) => x.pts.length >= 2).sort((a, b) => nearest(a.pts) - nearest(b.pts))[0];
    if (!keep || keep.pts.reduce((s, p, i) => s + (i ? Math.hypot(p[0] - keep.pts[i - 1][0], p[1] - keep.pts[i - 1][1]) : 0), 0) < 3) { roads.splice(k, 1); continue; }
    // (rounded as the plan keeps them, all but the center itself: the next steps find the roads leaving it by it)
    rd.path = keep.pts.map((p) => (p[0] === C[0] && p[1] === C[1] ? p : pt(p)));
    if (keep.wetEnd) landings.push(keep.wetEnd);
    if (keep.wetStart) landings.push(keep.wetStart);
  }
  // (and the arms the rest of the map follows: each arm cut the same way, an arm wholly in the water dropped)
  if (ctx.arms) for (let k = ctx.arms.length - 1; k >= 0; k--) {
    const arm = ctx.arms[k], firstWet = arm.findIndex(wetAt);
    if (firstWet === 0) ctx.arms.splice(k, 1);
    // (ending at the shore, so every arm keeps two points at least)
    else if (firstWet > 0) ctx.arms[k] = [...arm.slice(0, firstWet), meet(arm[firstWet - 1], arm[firstWet])];
  }
  // A pier at each landing (two at most) well in from the map's edge, running out over the water, a boat or two moored
  // beside it; with none, one at the shore nearest the middle, a lane down to it from the nearest road
  const big = choices.size === "town";
  const inFrom = (p, m) => p[0] >= m && p[1] >= m && p[0] <= W - m && p[1] <= H - m;
  let made = 0;
  const pier = (l, lone) => {
    const dir = [l.at[0] - l.from[0], l.at[1] - l.from[1]], len = Math.hypot(dir[0], dir[1]) || 1, u = [dir[0] / len, dir[1] / len];
    const reachOut = big ? sr.range(5, 8) : sr.range(3.5, 5.5);
    const end = add(l.at, mul(u, reachOut));
    if (!inFrom(l.at, 4) || !inFrom(end, 1.5) || !wetAt(end)) return false;
    made++;
    const start = pt(add(l.at, mul(u, -0.5)));
    features.push({ id: `pier-${made}`, type: "dock", class: big ? "pier" : "jetty", path: [start, pt(end)] });
    if (lone && roads.length) {
      let best = null, bd = Infinity;
      for (const rd of roads) for (const q of rd.path) { const dd = Math.hypot(q[0] - l.at[0], q[1] - l.at[1]); if (dd < bd) { bd = dd; best = q; } }
      if (best && bd > 2) roads.push({ id: "shore-lane", class: "lane", path: [pt(best), start] });
    }
    const side = [-u[1], u[0]], rot = Math.round((Math.atan2(u[1], u[0]) * 180) / Math.PI - 90);
    for (let b = 0; b < (big ? 2 : 1); b++) {
      const at = pt(add(add(l.at, mul(u, reachOut * sr.range(0.45, 0.85))), mul(side, (b ? -1 : 1) * sr.range(1.4, 2))));
      if (wetAt(at)) features.push({ id: `boat-${made}-${b + 1}`, type: "prop", class: "boat", at, rot });
    }
    return true;
  };
  for (const l of landings) if (made < 2) pier(l, false);
  if (!made) {
    // (the shore nearest the middle, along the way to the water)
    let best = null, bd = Infinity;
    for (let s = -span / 2; s <= span / 2; s += 1) {
      const p = add(add(C, mul(N, d)), mul(T, s));
      if (!inFrom(p, 6)) continue;
      if (Math.abs(s) < bd) { bd = Math.abs(s); best = p; }
    }
    if (best) {
      let q = add(best, mul(N, -6));
      for (let s = 0; s < 40 && !wetAt(q); s++) q = add(q, mul(N, 0.4));
      pier({ at: pt(add(q, mul(N, -0.4))), from: pt(add(q, mul(N, -3))) }, true);
    }
  }
  // (what the later steps keep off: the water and its bank)
  ctx.inShore = (p, m = 0) => inside(p, wet) || (m > 0 && distToPoly(p, wet) < m);
}
