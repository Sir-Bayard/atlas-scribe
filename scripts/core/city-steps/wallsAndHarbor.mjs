// One step of making a city's plan from Quick Start's choices (quick-city.mjs, cityPlan): ctx holds what the steps share.
import { add, crossings, densify, distToPath, distToRing, feetOf, harborRun, inside, mul, openRun, pt, simplify, widestOf } from "../quick-city.mjs";

/**
 * The town wall, closed, straight between its corners; a moat where it's by a river, else a ditch or none
 * (against a cliff: open, from the cliff around to the cliff)
 */
export function wallsAndHarbor(ctx) {
  const { H, W, r, ringPoly, roads, water } = ctx;
  const wallRun = ctx.cutLine ? openRun(ctx.wallPoly, ctx.cutLine) : null;
  const wall = { id: "town-wall", type: "wall", class: "town", path: wallRun ? wallRun.path : [...ctx.wallPoly, ctx.wallPoly[0]], ...(wallRun ? { side: wallRun.side } : {}), straight: true, outside: ctx.form === "loop" ? "none" : ctx.river ? (r.chance(0.6) ? "moat" : "ditch") : r.pick(["none", "ditch", "ditch", "moat"]) }; ctx.wall = wall;

  // Bridges wherever a road crosses the river
  const crossingsOut = []; ctx.crossingsOut = crossingsOut;
  if (ctx.rivers.length) {
    let n = 0;
    for (const rv of ctx.rivers) for (const rd of roads) for (const hit of crossings(rd.path.map(pt), rv.path)) {
      if (crossingsOut.some((c) => Math.hypot(c.at[0] - hit[0], c.at[1] - hit[1]) < 1.2)) continue; // (the same crossing twice, where an arm leaves the river)
      crossingsOut.push({ id: `bridge-${++n}`, type: "crossing", class: "bridge", at: pt(hit) });
    }
  }

  // The harbor: a quay along the shore inside the wall, and piers out from it
  const docks = []; ctx.docks = docks;
  const shore = ctx.sea ?? ctx.lake;
  if (shore && ringPoly) {
    const quay = harborRun({ shore, ringPoly, river: ctx.river, W, H });
    if (quay) {
      const path = simplify(quay.slice(2, -2), 0.1).map(pt);
      docks.push({ id: "quay", type: "dock", class: ctx.sea ? "quay" : "wharf", path });
      // Piers square to the shore, out into the water
      const piers = ctx.sea ? 2 + r.int(3) : 1 + r.int(2);
      for (let k = 0; k < piers; k++) {
        const i = Math.floor(((k + 0.5) / piers) * (quay.length - 2)) + 1;
        const a = quay[i - 1], b = quay[i + 1];
        const d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...d) || 1;
        let n = [-d[1] / l, d[0] / l];
        if (!inside(add(quay[i], mul(n, 1.5)), shore)) n = mul(n, -1);
        const len = ctx.sea ? r.range(4, 7) : r.range(2.5, 4);
        docks.push({ id: `${ctx.sea ? "pier" : "jetty"}-${k + 1}`, type: "dock", class: ctx.sea ? "pier" : "jetty", path: [pt(quay[i]), pt(add(quay[i], mul(n, len)))] });
      }
    }
  }
  if (ctx.river && (water === "river" || !docks.length) && ringPoly) {
    // A quay along one bank inside the wall (an estuary's too, when its sea lies beyond the wall)
    const ft = feetOf(ctx.river);
    const side = r.chance(0.5) ? 1 : -1;
    // (in one unbroken stretch: the longest, where an arm or another river leaves it or the wall comes near)
    const runs = [[]];
    for (let i = 1; i < ctx.river.path.length; i++) {
      const a = ctx.river.path[i - 1], b = ctx.river.path[i], d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...d) || 1, n = [(-d[1] / l) * side, (d[0] / l) * side];
      const half = Math.max(ft[i - 1], ft[i]) / 25 / 2;
      for (const p of densify([a, b], 0.5)) {
        const q = add(p, mul(n, half + 0.3));
        if (inside(q, ringPoly) && distToRing(q, ringPoly) > 3 && !ctx.rivers.some((o) => o !== ctx.river && distToPath(q, o.path) < widestOf(o) / 25 / 2 + 1.5)) runs[runs.length - 1].push(q);
        else if (runs[runs.length - 1].length) runs.push([]);
      }
    }
    const bank = runs.reduce((x, y) => (y.length > x.length ? y : x));
    if (bank.length > 10) docks.push({ id: "quay", type: "dock", class: "quay", path: simplify(bank.slice(2, -2), 0.1).map(pt) });
  }
}
