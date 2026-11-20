// One step of making a plan from Quick Start's choices (quick.mjs, quickPlan): ctx holds what the steps share.
import { ROAD_FT, add, clipToMap, dirOf, distToSeg, mul, outline, pt, wander } from "../quick.mjs";
import { mainRoad } from "../directions.mjs";
import { rng } from "../rng.mjs";

/**
 * The center, and the main road's direction (mostly across the map's long side)
 */
export function roadsAndDistricts(ctx) {
  const { H, S, W, choices, r, dirs } = ctx;
  const C0 = [W / 2 + r.range(-0.08, 0.08) * W, H / 2 + r.range(-0.08, 0.08) * H];
  // (a village or town by the sea or a lake: the side the water lies, the region's or one from a stream of its own,
  // and the place moved a little away from it, so the water has room on the map)
  const shore = choices.water === "coast" || choices.water === "lake";
  if (shore) ctx.shoreAt = (choices.water === "lake" ? dirs?.lake ?? dirs?.coast : dirs?.coast ?? dirs?.lake) ?? rng(ctx.seed, "quick", "shore-side").pick([-90, 0, 90, 180]) + rng(ctx.seed, "quick", "shore-turn").range(-25, 25);
  const away = shore ? { hamlet: 4, village: 5, town: 7 }[choices.size] ?? 5 : 0;
  const C = shore ? add(C0, mul(dirOf(ctx.shoreAt), -away)) : C0; ctx.C = C;
  // (the roads' own directions when a region gives them: the two most nearly opposite are the main road, through the
  // place; the draws are made either way, so the rest of the map draws as it would)
  const given = mainRoad(dirs?.roads);
  const theta0 = r.range(-30, 30) + (choices.size !== "town" && r.chance(0.25) ? 90 : 0); // a town runs along the long side
  // (by the water with no roads given, the main road runs along the shore)
  const theta = given.main.length ? given.main[0] : shore ? ctx.shoreAt + 90 + ((((theta0 + 45) % 90) + 90) % 90 - 45) * 0.4 : theta0; ctx.theta = theta;
  const U = dirOf(theta), V = [-U[1], U[0]]; ctx.V = V; ctx.U = U;
  const at = (u, v) => add(add(C, mul(U, u)), mul(V, v)); ctx.at = at;

  // Roads: arms from the center to the edges
  const arm = (deg, straight) => wander(r, C, dirOf(deg), W, H, { step: r.range(7, 10), amp: r.range(1, 2.4), straight });
  const join = (a, b) => [...[...a].reverse(), ...b.slice(1)]; // two arms into one road through the center
  const hold = S.square + 3; // straight near the center, so the roads meet the square squarely
  const roads = []; ctx.roads = roads;
  const mainA = arm(theta, hold), turnB = r.range(-8, 8), mainB = arm(given.main.length > 1 ? given.main[1] : theta + 180 + turnB, hold);
  const arms = [mainA, mainB]; ctx.arms = arms; // every road leaving the center
  // (a road the region gives, else the seed's)
  const next = (deg) => (given.rest.length ? given.rest.shift() : deg);
  if (choices.roads === "fork") {
    const branch = arm(next(theta + 180 + r.range(35, 55) * (r.chance(0.5) ? 1 : -1)), hold);
    arms.push(branch);
    roads.push({ id: "main-road", class: S.main, path: join(mainA, mainB) });
    roads.push({ id: "branch-road", class: S.cross, path: [...branch].reverse() });
  } else {
    roads.push({ id: "main-road", class: S.main, path: join(mainA, mainB) });
    if (choices.roads === "crossroads") {
      const c1 = arm(next(theta + 90 + r.range(-20, 20)), hold), c2 = arm(next(theta - 90 + r.range(-20, 20)), hold);
      arms.push(c1, c2);
      roads.push({ id: "cross-road", class: S.cross, path: join(c1, c2) });
    }
  }
  const roadHalf = (rd) => ROAD_FT[rd.class] / 25 / 2; ctx.roadHalf = roadHalf;

  // Districts, laid out along the main road: shared corners exactly equal, outer corners a little uneven
  const jig = () => r.range(-1.2, 1.2);
  const box = (u0, u1, v0, v1, ragged) => [
    at(u0 + (ragged.includes("w") ? jig() : 0), v0 + (ragged.includes("n") ? jig() : 0)),
    at(u1 + (ragged.includes("e") ? jig() : 0), v0 + (ragged.includes("n") ? jig() : 0)),
    at(u1 + (ragged.includes("e") ? jig() : 0), v1 + (ragged.includes("s") ? jig() : 0)),
    at(u0 + (ragged.includes("w") ? jig() : 0), v1 + (ragged.includes("s") ? jig() : 0)),
  ];
  /**
   * The main road as one path, and roadV(u): where it runs (its v) at a given u, so a district strung along it sits
   * on it.
   */
  const mainPath = [...[...mainA].reverse(), ...mainB.slice(1)];
  const roadV = (u) => {
    let best = 0, bestD = Infinity;
    for (const p of mainPath) {
      const pu = (p[0] - C[0]) * U[0] + (p[1] - C[1]) * U[1], pv = (p[0] - C[0]) * V[0] + (p[1] - C[1]) * V[1];
      if (Math.abs(pu - u) < bestD) { bestD = Math.abs(pu - u); best = pv; }
    }
    return best;
  };
  // Names by the compass side they lie on (the map's up is north)
  const compass = (dir) => (Math.abs(dir[0]) > Math.abs(dir[1]) ? (dir[0] > 0 ? "east" : "west") : dir[1] > 0 ? "south" : "north"); ctx.compass = compass;
  const fwd = compass(U), back = compass(mul(U, -1));
  const districts = []; ctx.districts = districts;
  if (choices.size === "hamlet") {
    districts.push({ id: "hamlet", profile: "hamlet", poly: box(-9, 9, -6.5, 6.5, "nsew") });
  } else if (choices.size === "village") {
    const half = r.range(13, 16);
    // Sometimes a hamlet strung out along the road beyond the village; the village's end it meets stays straight,
    // so the two share that edge
    const end = r.chance(0.5) ? (r.chance(0.5) ? 1 : -1) : 0;
    districts.push({ id: "village", profile: "village", poly: box(-half, half, -11, 11, `ns${end === 1 ? "" : "e"}${end === -1 ? "" : "w"}`) });
    if (end) {
      const near = end * half, far = end * (half + r.range(8, 11));
      const vc = Math.max(-4, Math.min(4, roadV((near + far) / 2)));
      districts.push({ id: `${end > 0 ? fwd : back}-end`, profile: "hamlet", end: true, poly: box(Math.min(near, far), Math.max(near, far), vc - 6, vc + 6, end > 0 ? "nse" : "nsw") });
    }
  } else {
    const core = r.range(10, 12), mid = core + r.range(14, 17);
    const end = r.chance(0.6) ? (r.chance(0.5) ? 1 : -1) : 0; // a village beyond one of the towns
    districts.push({ id: "core", profile: "city", poly: box(-core, core, -11, 11, "") });
    districts.push({ id: `town-${fwd}`, profile: "town", poly: box(core, mid, -15, 15, end === 1 ? "ns" : "nse") });
    districts.push({ id: `town-${back}`, profile: "town", poly: box(-mid, -core, -15, 15, end === -1 ? "ns" : "nsw") });
    if (end) {
      const near = end * mid, far = end * (mid + r.range(9, 12));
      const vc = Math.max(-4, Math.min(4, roadV((near + far) / 2)));
      districts.push({ id: `village-${end > 0 ? fwd : back}`, profile: "village", end: true, poly: box(Math.min(near, far), Math.max(near, far), vc - 10, vc + 10, end > 0 ? "nse" : "nsw") });
    }
    // The core's corners and the towns' inner corners are the same points: put them back exactly
    const [k0, k1, k2, k3] = districts[0].poly;
    districts[1].poly[0] = [...k1]; districts[1].poly[3] = [...k2];
    districts[2].poly[1] = [...k0]; districts[2].poly[2] = [...k3];
  }
  // Inner edges between neighbors were built from the same u, v; snap equal points together after rounding
  for (const d of districts) d.poly = outline(clipToMap(d.poly.map(pt), W, H));
  // Points the same up to rounding become one point, so shared corners stay shared
  const all = districts.flatMap((d) => d.poly);
  for (const p of all) for (const q of all) if (p !== q && Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.15) { q[0] = p[0]; q[1] = p[1]; }
  // A district strung on the end of another meets it partway along a side: put its corners into that side too, so
  // the two share corners (and move together when reshaped)
  for (const d of districts.filter((x) => x.end)) {
    for (const p of d.poly) {
      for (const o of districts) {
        if (o === d || o.poly.some((q) => q[0] === p[0] && q[1] === p[1])) continue;
        const k = o.poly.findIndex((a, i) => distToSeg(p, a, o.poly[(i + 1) % o.poly.length]) < 0.12); // on it, give or take the rounding
        if (k >= 0) o.poly.splice(k + 1, 0, [p[0], p[1]]);
      }
    }
  }
  const cluster = districts.map((d) => d.poly); ctx.cluster = cluster;
}
