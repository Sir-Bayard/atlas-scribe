// One phase of laying out a plan (layout/index.mjs, layoutPlan): ctx holds what the phases share.
import { bandPieces, isTownWall, layWall, offsetPath } from "../walls.mjs";
import { distanceToPath, pathTouchesPolygon } from "../../geom.mjs";
import { layDock } from "../docks.mjs";
import { tallOf } from "../index.mjs";

/**
 * Town walls and palisades: their runs, towers and gatehouses, a ditch or moat, and clear ground along them
 * (streets end there, and only roads pass, through gates)
 */
export function townWalls(ctx) {
  const { H, W, addBuilding, battle, bodies, cliffBands, districts, ft, items, laid, notes, plan, space, sq, streamFor } = ctx;
  const wallBands = [...cliffBands]; // (a cliff stops things as a wall does)
  const gatedBy = new Set(); // what has a gate through a wall
  const wallGatePts = []; ctx.wallGatePts = wallGatePts; // where the gates stand
  {
    // (and quays: one with no water near it yet may be moved onto a moat, below, so it gets a gate where it crosses
    // and keeps towers off it, but doesn't stop the wall where it only runs over it)
    const roadsSq = [...plan.features.filter((f) => f.type === "road" && Array.isArray(f.path)).map((f) => ({ id: f.id, path: f.path, width: ft(f.width), class: f.class })), ...laid.map((q) => ({ id: q.d.way.id, path: q.d.way.path, width: q.d.way.width, class: q.d.way.class, ...(q.d.snapped ? {} : { over: false }) }))];
    const watersSq = [
      ...plan.features.filter((f) => f.type === "water" && Array.isArray(f.path)).map((f) => (f._w ? { id: f.id, path: f.path, width: Math.max(...f._w), widths: f._w } : { id: f.id, path: f.path, width: ft(f.width) })),
      ...bodies.map((b) => ({ id: b.id, path: b.ring, width: 0, body: b.poly, reach: b.keep })),
    ];
    const moatFrozen = plan.features.some((f) => f.type === "water" && f.frozen); // a moat freezes with the plan's water
    for (const f of plan.features.filter(isTownWall)) {
      const r = streamFor(f.id);
      const w = layWall(f, { roads: roadsSq, waters: watersSq, sq, r: r.fork("wall"), battle });
      for (const g of w.gates) { gatedBy.add(g.road); if (Array.isArray(g.at)) wallGatePts.push(g.at); }
      // (each gate on a battle map, for its torches: along the wall there, and outward)
      if (battle) w.gates.filter((x) => Array.isArray(x.at)).forEach((g, k) => {
        const run = w.runs.flatMap((path) => path.slice(1).map((b, i) => [path[i], b])).reduce((best, sg) => { const d = distanceToPath(g.at, sg); return d < best.d ? { d, sg } : best; }, { d: Infinity, sg: null }).sg;
        const seg = run ?? [f.path[0], f.path[1]], L = Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]) || 1, dir = [(seg[1][0] - seg[0][0]) / L, (seg[1][1] - seg[0][1]) / L];
        const road = roadsSq.find((q) => q.id === g.road);
        items.push({ kind: "gate", id: `${f.id}/gate-${g.road}-${k + 1}`, from: f.id, at: g.at, dir, out: [w.side * dir[1], -w.side * dir[0]], roadWidth: road?.width ?? 1, thickness: ft(f.thickness) });
      });
      if (!w.runs.length && !w.notes.some((n) => /too short|all gates or water/.test(n.message))) notes.push({ level: "warning", id: f.id, message: `Nothing of "${f.id}" is built: all of it lies on roads or water.` });
      // Each run carries its outer face (where the battlements are) and its inner one
      // (a water gate's grille, a low wall across the river that stops boats and swimmers but not sight)
      (w.waterGates ?? []).forEach((path, k) => items.push({ kind: "wall", id: `${f.id}/watergate${k + 1}`, from: f.id, class: "watergate", path, height: ft(f.height) }));
      w.runs.forEach((path, k) => items.push({ kind: "wall", id: w.runs.length === 1 ? f.id : `${f.id}/r${k + 1}`, from: f.id, class: f.class, path, height: ft(f.height), tall: tallOf(f.height ?? 25), thickness: ft(f.thickness), side: w.side, face: offsetPath(path, (w.side * ft(f.thickness)) / 2), back: offsetPath(path, (-w.side * ft(f.thickness)) / 2) }));
      w.ditches.forEach((d, k) => {
        const id = `${f.id}/${d.moat ? "moat" : "ditch"}${k ? `-${k + 1}` : ""}`;
        if (d.moat) {
          // Before the plan's own water, so a river or stream is painted over where the moat opens into it
          const first = items.findIndex((i) => i.kind === "water");
          items.splice(first < 0 ? items.length : first, 0, { kind: "water", id, from: f.id, class: "moat", path: d.path, width: d.width, frozen: moatFrozen });
          space.water.push({ path: d.path, clear: d.width / 2 + 0.225 });
        } else items.push({ kind: "ditch", id, from: f.id, path: d.path, width: d.width });
        for (const poly of bandPieces(d.path, d.width / 2 + 0.1)) { space.reserved.push(poly); space.zones.push(poly); }
      });
      w.bridges.forEach((b, k) => items.push({ kind: "crossing", id: `${f.id}/b${k + 1}`, from: f.id, class: "bridge", at: b.at, angle: b.angle, length: b.length, width: b.width, frozen: false }));
      // Each tower from its own stream by where it stands; none well off the map
      const onMap = (t) => !Array.isArray(t.at) || (t.at[0] > -0.5 && t.at[1] > -0.5 && t.at[0] < W + 0.5 && t.at[1] < H + 0.5);
      w.towers.forEach((t, k) => { if (onMap(t)) addBuilding(t, `${f.id}/t${k + 1}`, r.fork("tower", t.key), f.id); });
      w.towers = w.towers.filter(onMap);
      for (const poly of bandPieces(f.path, w.band.half)) { space.reserved.push(poly); space.zones.push(poly); }
      wallBands.push({ path: f.path, half: w.band.half });
      notes.push(...w.notes);
      notes.push({ level: "info", id: f.id, message: `"${f.id}": ${w.towers.filter((t) => t.kind !== "gatehouse").length} towers, ${w.gates.length} ${w.gates.length === 1 ? "gate" : "gates"}${w.ditches.length ? (w.ditches[0].moat ? ", a moat" : ", a ditch") : ""}.` });
    }
  }
  const inWallBand = (x, y) => wallBands.some((b) => distanceToPath([x, y], b.path) < b.half); ctx.inWallBand = inWallBand;

  // A quay with no water near it until the walls' moats were dug: laid again along the moat (nothing has placed
  // anything by it yet)
  const moats = items.filter((i) => i.kind === "water" && i.class === "moat");
  if (moats.length) for (const q of laid) {
    if (q.d.snapped || gatedBy.has(q.d.way.id)) continue; // one with a gate stays where it was drawn, through it
    const again = layDock(q.f, { runs: moats, bodies: [], sq });
    if (!again?.item || !again.snapped) continue;
    // Not on the moat's inner bank, between the moat and the wall: the wall and its towers stand there
    if ([...again.item.path, ...again.item.land].some(([x, y]) => inWallBand(x, y))) continue;
    Object.assign(q.d.item, again.item);
    q.d.way.path = q.entry.path = again.way.path;
    for (const n of q.notes) { const k = notes.indexOf(n); if (k >= 0) notes.splice(k, 1); }
    notes.push(...again.notes);
  }
  // A quay drawn in a district and moved onto the water's edge out of it: the district has nothing to front it
  for (const { f, d } of laid) {
    const home = districts.find((x) => pathTouchesPolygon(f.path, x.poly));
    if (home && !pathTouchesPolygon(d.item.land, home.poly) && !pathTouchesPolygon(d.item.path, home.poly))
      notes.push({ level: "warning", id: f.id, message: `"${f.id}" was moved onto the water's edge, outside "${home.id}", so no houses there face it. Take "${home.id}" out to the water.` });
  }
}
