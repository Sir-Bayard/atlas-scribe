// One step of making a city's plan from Quick Start's choices (quick-city.mjs, cityPlan): ctx holds what the steps share.
import { TAU, add, apart, biggest, crossings, densify, dirOf, distToPath, inside, mul, onMapRuns, outline, pathsCross, pt, segCross, simplify, wander, widestOf } from "../quick-city.mjs";
import { area, bands, difference } from "../lots/poly.mjs";
import { cliffOf, cliffWidth, offsetLine } from "../cliffs.mjs";

/** A path's length in squares. */
const lengthOf = (path) => path.slice(1).reduce((t, q, i) => t + Math.hypot(q[0] - path[i][0], q[1] - path[i][1]), 0);

/**
 * A cliff across the map behind the city, clear of the water; the wall ends at it and nothing is built on it
 */
export function cliffAndGates(ctx) {
  const { C, H, R, S, W, choices, headland, r, radiusAt, shape, sp, wet } = ctx;
  ctx.cliff = null; ctx.cutLine = null; ctx.cliffAway = null; let cliffKeep = null; // (cliffAway: the way from the city across the cliff)
  if (shape === "cliff") {
    let sides = [sp.next() * TAU];
    if (ctx.sea || ctx.lake) sides = [ctx.seaward + Math.PI];
    else if (ctx.river) {
      // (on the other side of the middle from the river)
      const n = dirOf(ctx.riverAngle + Math.PI / 2), near = densify(ctx.river.path, 1).filter((p) => Math.hypot(p[0] - C[0], p[1] - C[1]) < R * 1.2);
      const lean = near.reduce((s, p) => s + (p[0] - C[0]) * n[0] + (p[1] - C[1]) * n[1], 0);
      sides = lean > 0 ? [ctx.riverAngle - Math.PI / 2, ctx.riverAngle + Math.PI / 2] : [ctx.riverAngle + Math.PI / 2, ctx.riverAngle - Math.PI / 2];
    }
    const foot = sp.chance(0.55), height = 5 * Math.round(sp.range(40, 70) / 5), rock = sp.chance(0.6) ? "earthy" : "slate";
    found: for (const B of sides) for (const dc of [0.55, 0.62, 0.7, 0.8]) {
      const U = dirOf(B), V = [-U[1], U[0]], mid = add(C, mul(U, radiusAt(B) * dc)), span = Math.hypot(W, H), line = [];
      let off = 0;
      for (let s = -span; s <= span; s += 5) { off = Math.max(-2.5, Math.min(2.5, off + sp.range(-1.2, 1.2))); line.push(add(add(mid, mul(V, s)), mul(U, off))); }
      const run = onMapRuns(line, W, H).sort((a, b) => lengthOf(b) - lengthOf(a))[0]; // (the longest run on the map)
      if (!run) continue;
      const pts = densify(run, 1);
      if (ctx.rivers.some((rv) => pathsCross(run, rv.path) || pts.some((p) => distToPath(p, rv.path) < widestOf(rv) / 25 / 2 + 3))) continue;
      if ([ctx.sea, ctx.lake].some((q) => q && pts.some((p) => inside(p, q)))) continue;
      // (its line runs with the middle on its right: the city at its foot is on its low side, on top on its high side)
      ctx.cliff = { id: "cliff", type: "wall", class: "cliff", side: foot ? "right" : "left", height, rock, path: simplify(run, 0.15).map(pt) };
      // The city stops at its toe (at its foot) or just back from its top edge, with room for the tower at the wall's end
      ctx.cutLine = offsetLine(run, -((foot ? cliffWidth(height, 25) : 0) + 1.4));
      const beyond = [...ctx.cutLine, ...[...ctx.cutLine].reverse().map((p) => add(p, mul(U, span)))];
      const kept = biggest(difference([ctx.wallPoly], [beyond]));
      if (!kept || area(kept) < area(ctx.wallPoly) * 0.5) { ctx.cliff = null; continue; }
      ctx.wallPoly = outline(kept);
      ctx.cliffAway = U;
      cliffKeep = cliffOf(ctx.cliff, 25, [W, H]).keep;
      wet.push(...bands([{ path: cliffKeep.path, half: cliffKeep.half + 0.5 }]));
      break found;
    }
  }
  const inWater = (p) => wet.some((q) => inside(p, q)); ctx.inWater = inWater;

  // Gates spread around the land side of the wall. Each main road runs from the center out to the wall, then wanders
  // to the map's edge, kept only when it stays out of the sea and lake and crosses the river at 40 degrees or more
  const gateCount = S.gates[choices.roads] ?? S.gates.through;
  const blocked = (a) => (headland ? apart(a, ctx.seaward + Math.PI) > 0.6 : ctx.sea || ctx.lake ? apart(a, ctx.seaward) < 1.15 : false);
  const roadAt = (a) => {
    const U = dirOf(a), V = [-U[1], U[0]];
    const wallAt = radiusAt(a);
    const inner = [C];
    for (const f of [0.33, 0.66]) inner.push(add(add(C, mul(U, wallAt * f)), mul(V, r.range(-0.8, 0.8))));
    const gate = add(C, mul(U, wallAt * 1.06));
    inner.push(gate);
    const outer = wander(r, gate, dirOf(a + r.range(-0.1, 0.1)), W, H, { step: r.range(7, 10), amp: r.range(1, 2) });
    return [...inner, ...outer.slice(1)].map(pt);
  };
  // (and never runs along a river within its banks for longer than crossing it takes)
  const crossesWell = (path) => {
    for (const rv of ctx.rivers) {
      for (let i = 1; i < path.length; i++) for (let j = 1; j < rv.path.length; j++) {
        if (!segCross(path[i - 1], path[i], rv.path[j - 1], rv.path[j])) continue;
        const a = Math.atan2(path[i][1] - path[i - 1][1], path[i][0] - path[i - 1][0]), b = Math.atan2(rv.path[j][1] - rv.path[j - 1][1], rv.path[j][0] - rv.path[j - 1][0]);
        const d = Math.min(apart(a, b), apart(a, b + Math.PI));
        if (d < (40 * Math.PI) / 180) return false;
      }
      const half = widestOf(rv) / 25 / 2 + 1, most = (2 * half) / Math.sin((40 * Math.PI) / 180) + 1;
      let run = 0;
      for (const p of densify(path, 0.5)) { run = distToPath(p, rv.path) < half ? run + 0.5 : 0; if (run > most) return false; }
    }
    // (and crosses two rivers well apart, so each gets a bridge of its own)
    const hits = ctx.rivers.flatMap((rv) => crossings(path, rv.path));
    if (hits.some((p, i) => hits.some((q, j) => j > i && Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.3 && Math.hypot(p[0] - q[0], p[1] - q[1]) < 6))) return false;
    return true;
  };
  const roads = []; ctx.roads = roads;
  for (const share of ctx.cliff ? [0.6, 0.5, 0.4, 0.3, 0.22, 0.15] : [0.6, 0.5, 0.4, 0.3]) { // (closer together where a cliff leaves less room)
    for (let t = 0; t < 300 && roads.length < gateCount; t++) {
      const a = r.next() * TAU;
      if (blocked(a) || roads.some((g) => apart(g.angle, a) < (TAU / gateCount) * share)) continue;
      const path = roadAt(a);
      if ((ctx.sea || ctx.lake) && densify(path, 0.5).some((p) => inside(p, ctx.sea ?? ctx.lake))) continue;
      if (!crossesWell(path)) continue;
      // (none up or down the cliff or along its face, and none at the wall's end by it)
      if (ctx.cliff && (densify(path, 0.5).some((p) => distToPath(p, cliffKeep.path) < cliffKeep.half + 0.9) || distToPath(add(C, mul(dirOf(a), radiusAt(a))), ctx.cutLine) < 5)) continue;
      // (its gate clear of where a river passes the wall, where the wall stops at a tower each side)
      const gateAt = add(C, mul(dirOf(a), radiusAt(a)));
      if (ctx.rivers.some((rv) => distToPath(gateAt, rv.path) < widestOf(rv) / 25 / 2 + 3.5)) continue;
      roads.push({ type: "road", class: "highway", surface: "cobble", path, angle: a });
    }
    if (roads.length >= gateCount) break;
  }
  roads.sort((a, b) => a.angle - b.angle);
  roads.forEach((rd, k) => { rd.id = `gate-road-${k + 1}`; });
}
