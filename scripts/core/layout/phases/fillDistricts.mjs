// One phase of laying out a plan (layout/index.mjs, layoutPlan): ctx holds what the phases share.
import { CLUTTER_FT, USE_INFO, notablesFor, planUses, useLabel } from "../../uses.mjs";
import { DISTRICT_CACHE_BYTES, GATE_WIDTH, KEY_MARGIN, LAYOUT_VERSION, boxOf, cacheStats, cacheUse, closed, districtCache, keyJSON, rayHit, stepsAlong, trimAtBuildings } from "../index.mjs";
import { OLD_PROFILES, PROP_SQUARES } from "../../plan.mjs";
import { anchorFor, layAnchor } from "../anchors.mjs";
import { battleBack } from "../battle.mjs";
import { bbox, distanceToPath, pathTouchesPolygon, pointInPolygon, shapeToPolygon } from "../../geom.mjs";
import { buildOnLots } from "../../lots/build.mjs";
import { centroid, shapes } from "../../lots/poly.mjs";
import { districtGates, gateSpacing, streetsFor, typeOf } from "../../streets/index.mjs";
import { hash128, rng } from "../../rng.mjs";
import { lookOf } from "../../character.mjs";
import { lotTypeOf, lotsFor } from "../../lots/index.mjs";
import { makeNoise } from "../../noise.mjs";
import { nearWater } from "../../water.mjs";
import { poissonInPolygon } from "../../scatter.mjs";
import { seedOf } from "../../seeds.mjs";
import { sharedEdges } from "../../streets/borders.mjs";

/**
 * Districts: generated streets first (each district's own, meeting its neighbors' at gates on shared edges),
 * then houses along every road, street and lane that runs into it
 */
export function fillDistricts(ctx) {
  const { H, W, addAnchor, addBuilding, addGraves, battle, bodies, cache, catchUp, fillBack, free, graveCount, inWallBand, items, nearby, notes, owner, parks, plan, progress, space, sq, streamFor, streetCorners, touching, wallGatePts, ways } = ctx;
  progress(0.4, "Districts");
  // (a district whose shape makes no polygon is left out: the checker warns of it)
  const dfeats = plan.features.filter((f) => f.type === "district" && shapeToPolygon(f.shape).length >= 3); ctx.dfeats = dfeats;
  const dlist = dfeats.map((d) => ({ id: d.id, poly: shapeToPolygon(d.shape), ...gateSpacing(d, sq) })); ctx.dlist = dlist;
  const waterAt = (x, y) => space.water.some((w) => nearWater([x, y], w));
  const gates = districtGates(dlist, { roads: ways, inWater: (x, y) => waterAt(x, y) || inWallBand(x, y), seed: plan.seed });
  const radials = plan.features.filter((f) => f.type === "square" && f.radial).map((f) => {
    const poly = shapeToPolygon(f.shape);
    const [x0, y0, x1, y1] = bbox(poly);
    const at = [(x0 + x1) / 2, (y0 + y1) / 2];
    return { at, radius: poly.reduce((s, p) => s + Math.hypot(p[0] - at[0], p[1] - at[1]), 0) / poly.length };
  });
  // What every district's fill reads besides itself and what's near it (see districtCache), hashed once
  const waterItems = items.filter((i) => i.kind === "water" && i.path);
  // What plots keep off: each stream and river (a stretch at a time where its width varies), and each lake's or sea's
  // shore where no quay covers it (a quay is a way, which plots front)
  const lotWater = [
    ...waterItems.flatMap((w) => (w.widths ? w.path.slice(1).map((b, i) => ({ path: [w.path[i], b], width: Math.max(w.widths[i], w.widths[i + 1]) })) : [w])),
    ...bodies.flatMap((b) => b.runs.map((path) => ({ path, width: 2 * (b.keep - 0.1) }))),
  ];
  // Each settlement's notable buildings shared out among its districts, and what the trades are sited by: the water
  // (rivers flow from their first point), the plan's roads, the squares and greens, the wind for smoke
  const roadIds = new Set(plan.features.filter((f) => f.type === "road").map((f) => f.id));
  const useWater = [...waterItems.map((w) => ({ path: w.path, width: w.width })), ...bodies.map((b) => ({ ring: b.ring }))];
  const greens = [...plan.features.filter((f) => f.type === "square").map((f) => shapeToPolygon(f.shape)), ...parks.filter((f) => f.class === "park" && f.style !== "formal").map((f) => shapeToPolygon(f.shape, f.rot ?? 0))];
  const notables = notablesFor({ dlist: dlist.map((x) => ({ ...x, seed: seedOf(plan, x.id), feature: dfeats.find((f) => f.id === x.id) })), squares: greens, roads: ways.filter((w) => roadIds.has(w.id)), gates: wallGatePts, r: rng(plan.seed, "notables") });
  const wind = rng(plan.seed, "wind").next() * 360;
  // Buildings the plan already has with a use (drawn, or pinned), by the district they stand in: a district doesn't
  // build another inn because the GM pinned its inn
  const planUsesIn = new Map();
  for (const f of plan.features) {
    const bs = f.type === "building" ? [f] : f.type === "landmark" ? f.buildings ?? [] : [];
    const counted = new Set();
    for (const b of bs) {
      if (typeof b.use !== "string" || counted.has(b.use)) continue;
      const [x0, y0, x1, y1] = bbox(shapeToPolygon(b.shape ?? { rect: [0, 0, 0, 0] }));
      const home = dlist.find((x) => pointInPolygon([(x0 + x1) / 2, (y0 + y1) / 2], x.poly));
      if (!home) continue;
      counted.add(b.use); // a landmark's parts share a use: one building
      const m = planUsesIn.get(home.id) ?? {};
      m[b.use] = (m[b.use] ?? 0) + 1;
      planUsesIn.set(home.id, m);
    }
  }
  /** A list of uses less those the plan already has (each counted once). */
  const lessPlanned = (list, have = {}) => { const left = { ...have }; return list.filter((u) => !(left[u] > 0 && left[u]--)); };
  /** Counts of small things less those the plan already has. */
  const reduceBy = (want, have = {}) => Object.fromEntries(Object.entries(want).map(([k, n]) => [k, Math.max(0, n - (have[k] ?? 0))]));
  const shared = cache ? hash128(keyJSON([LAYOUT_VERSION, plan.kind, plan.seed, sq, W, H, waterItems, space.water, radials, bodies.length ? lotWater : 0, wind])).join(".") : null;
  // What was placed before the districts, with each thing's box (the districts add to space as they fill). A district
  // sees only what lies within KEY_MARGIN squares of it, with or without the cache, so its key covers all it reads
  const placed = Object.fromEntries(["reserved", "zones", "plots", "buildings", "ways", "gardens"].map((k) => [k, space[k].map((v) => [v, boxOf(v)])]));
  for (const [dk, d] of dfeats.entries()) {
    if (dk) progress(0.4 + (0.15 * dk) / dfeats.length, "Districts"); // (a metropolis has dozens)
    const { poly } = dlist.find((x) => x.id === d.id);
    const fixedHere = ways.filter((w) => pathTouchesPolygon(w.path, poly));
    // Roads running just outside the edge too, so plots and houses keep off them
    const ring = closed(poly);
    const nearHere = [...fixedHere, ...ways.filter((w) => !fixedHere.includes(w) && (w.path.some((p) => distanceToPath(p, ring) < w.width / 2 + 0.5) || poly.some((p) => distanceToPath(p, w.path) < w.width / 2 + 0.5)))];
    // (each neighbor's shared edges worked out once: the street borders, and the key)
    const edgesWith = dlist.filter((o) => o.id !== d.id).map((o) => [o, sharedEdges(poly, o.poly)]);
    const borders = edgesWith.filter(([o]) => o.streetSpacing).flatMap(([, e]) => e);
    const [bx0, by0, bx1, by1] = bbox(poly);
    const near = ([, b]) => !b || (b[0] <= bx1 + KEY_MARGIN && b[2] >= bx0 - KEY_MARGIN && b[1] <= by1 + KEY_MARGIN && b[3] >= by0 - KEY_MARGIN);
    const around = Object.fromEntries(Object.entries(placed).map(([k, list]) => [k, list.filter(near).map(([v]) => v)]));
    // Squares, yards and buildings placed before the districts, for plots and houses to keep off. Streets are traced
    // around the squares and yards only (a building would stop streets being seeded near it, so a pinned house would
    // lose its street); streets running into a building are cut short after (trimAtBuildings)
    const blocked = [...around.zones, ...around.plots];
    const streetBlocked = [...around.zones];
    // Laid out before with the same inputs: what it made is put back as it was (a district overlapping another sees
    // that one's things, so it's always laid out afresh)
    const overlaps = [...touching].some((k) => k.startsWith(`${d.id}|`));
    let key = null;
    if (cache && !overlaps) {
      key = hash128(keyJSON([shared, d, seedOf(plan, d.id), notables.get(d.id) ?? null, planUsesIn.get(d.id) ?? null, [...roadIds], gates.get(d.id) ?? [], borders, edgesWith.flatMap(([, e]) => e), nearHere, around])).join(".");
    }
    if (key && districtCache.has(key)) {
      cacheStats.hits++;
      const kept = districtCache.get(key);
      districtCache.delete(key);
      districtCache.set(key, kept); // most recently used last
      // One clone of the whole record, so a building is the same object in items and in space.buildings, as it was
      const rec = structuredClone(kept.rec);
      items.push(...rec.items);
      rec.buildings.forEach((b) => {
        space.buildings.push(b);
        owner.set(b, d.id);
      });
      for (const p of rec.reserved) { space.reserved.push(p); owner.set(p, d.id); }
      for (const p of rec.plots) { space.plots.push(p); owner.set(p, d.id); }
      for (const p of rec.gardens) { space.gardens.push(p); owner.set(p, d.id); }
      for (const w of rec.ways) { space.ways.push(w); owner.set(w, d.id); }
      notes.push(...rec.notes);
      continue;
    }
    if (key) cacheStats.misses++;
    const mark = { items: items.length, buildings: space.buildings.length, reserved: space.reserved.length, plots: space.plots.length, gardens: space.gardens.length, ways: space.ways.length, notes: notes.length };
    const r = streamFor(d.id);
    // Its anchor first, the landmark its character is known by, on its own square: the streets lead to it and the
    // plots keep off it (where it stands hangs on the district's shape and roads, not its seed)
    const anchorAt = anchorFor({ district: d, poly, roads: nearHere, water: space.water, blocked: [...around.zones, ...around.plots], ftPerSquare: sq, seed: plan.seed, margin: (sq ? (typeOf(d).streets?.width ?? 15) / sq : 0.6) + 0.15 });
    const anchor = anchorAt ? layAnchor(anchorAt, r.fork("anchor"), sq, { apart: battle ? 1.05 : 0 }) : null;
    // A band along a path (half its width each side) inside the district, off water, plan roads, squares, yards and
    // buildings: where the anchor's ring and approach streets may run. bandWhy says what's in the way ("road" when
    // only a plan road, which can stand in for the street); skip: a road it may meet
    const bandWhy = (path, half, skip = null) => {
      catchUp();
      let road = false;
      for (const [p] of stepsAlong(path, 0.4)) {
        if (!pointInPolygon(p, poly)) return "other";
        for (const k of nearby.water.near(p[0], p[1], half)) { const w = space.water[nearby.water.segPath[k]]; if (nearby.water.dist(p[0], p[1], k) < half + (w.clears ? w.clears[nearby.water.segIndex[k] - 1] : w.clear)) return "other"; }
        if ([...around.zones, ...around.plots].some((z) => pointInPolygon(p, z) || distanceToPath(p, closed(z)) < half)) return "other";
        if (nearHere.some((w) => w !== skip && distanceToPath(p, w.path) < w.width / 2 + half)) road = true;
      }
      return road ? "road" : null;
    };
    const bandClear = (path, half, skip = null) => bandWhy(path, half, skip) === null;
    // A street all around the anchor's block, so the houses about it face it, as a square's do (where it fits); the
    // district's own streets then stop at its outer edge rather than on the block's walls
    const ringWidth = sq ? (typeOf(d).streets?.width ?? 15) / sq : 0.6;
    // A side the main road runs along is left to the road; anything else in the way, and there's no ring. anchorRing:
    // the ring's corners; ringRuns: the stretches laid, the front first if laid
    let anchorRing = null, ringRuns = [], frontOnRoad = false;
    if (anchor) {
      const g = ringWidth / 2 + 0.02;
      const R = shapeToPolygon({ rect: [anchor.center[0] - anchor.w / 2 - g, anchor.center[1] - anchor.h / 2 - g, anchor.center[0] + anchor.w / 2 + g, anchor.center[1] + anchor.h / 2 + g] }, anchor.rot);
      const why = R.map((a, k) => bandWhy([a, R[(k + 1) % 4]], ringWidth / 2));
      if (!why.includes("other") && why.some((w) => w === null)) {
        anchorRing = R;
        if (why.every((w) => w === null)) ringRuns = [[...R, R[0]]];
        else {
          // Runs of laid sides, each from the corner after a road side
          const start = why.findIndex((w, k) => w === null && why[(k + 3) % 4] !== null);
          let cur = null;
          for (let n = 0; n < 4; n++) {
            const k = (start + n) % 4;
            if (why[k] !== null) { cur = null; continue; }
            if (!cur) { cur = [R[k]]; ringRuns.push(cur); }
            cur.push(R[(k + 1) % 4]);
          }
        }
      }
      // Its front: the side whose middle is nearest where the approach starts
      const fp = anchor.approach?.[0];
      if (fp) {
        const mids = R.map((a, k) => [(a[0] + R[(k + 1) % 4][0]) / 2, (a[1] + R[(k + 1) % 4][1]) / 2]);
        const fk = mids.reduce((b, m, k) => (Math.hypot(m[0] - fp[0], m[1] - fp[1]) < Math.hypot(mids[b][0] - fp[0], mids[b][1] - fp[1]) ? k : b), 0);
        frontOnRoad = why[fk] === "road";
      }
    }
    // (with no ring, a street's half width short of the walls, so its end doesn't run over them)
    const grow = anchorRing ? ringWidth + 0.05 : ringWidth / 2 + 0.05;
    const streetStop = anchor ? shapeToPolygon({ rect: [anchor.center[0] - anchor.w / 2 - grow, anchor.center[1] - anchor.h / 2 - grow, anchor.center[0] + anchor.w / 2 + grow, anchor.center[1] + anchor.h / 2 + grow] }, anchor.rot) : null;
    // (none of its own when it says so: a zoomed battle map's district, whose streets are its overview's, carried)
    const made = d.streets === false ? { streets: [], bridges: [], field: null } : streetsFor({
      district: d, poly, roads: fixedHere, water: space.water, radials: anchor?.radial ? [...radials, { ...anchor.radial, anchor: true, ...(anchorAt.place !== "middle" ? { pull: 0.5 } : {}) }] : radials, blocked: streetStop ? [...streetBlocked, streetStop] : streetBlocked, gates: gates.get(d.id) ?? [], borders,
      ftPerSquare: sq, r: r.fork("streets"),
    });
    made.streets = trimAtBuildings(made.streets, around.plots, sq);
    for (const path of ringRuns) made.streets.push({ path, kind: "street", width: ringWidth, ends: [], ring: true });
    // The anchor's square opens onto the town: a street straight out from its front to the nearest way it meets,
    // where clear (none when its front is on the main road)
    if (anchor?.approach && !frontOnRoad) {
      const [front, dir] = anchor.approach;
      const from = anchorRing ? [front[0] + dir[0] * ringWidth, front[1] + dir[1] * ringWidth] : front;
      const others = [...made.streets.filter((st) => !st.ring).map((st) => ({ path: st.path, width: st.width ?? ringWidth, road: null })), ...nearHere.map((w) => ({ path: w.path, width: w.width, road: w }))];
      let hit = null;
      for (const o of others) for (let i = 1; i < o.path.length; i++) {
        const t = rayHit(from, dir, o.path[i - 1], o.path[i]);
        if (t !== null && t > 0.2 && (!hit || t < hit.t)) hit = { t, o };
      }
      const to = hit ? [from[0] + dir[0] * hit.t, from[1] + dir[1] * hit.t] : null;
      const upTo = hit ? hit.t - hit.o.width / 2 - 0.05 : 0;
      if (to && hit.t < 25 && upTo > 0.1 && bandClear([from, [from[0] + dir[0] * upTo, from[1] + dir[1] * upTo]], ringWidth / 2, hit.o.road)) made.streets.push({ path: [from, to], kind: "street", width: ringWidth, ends: [] });
    }
    // How its character shows: the ground under it, its streets' surface, trees along them, its blocks built up
    const look = lookOf(d);
    const surface = d.surface ?? look.street ?? fixedHere.find((w) => !w.quay)?.surface ?? "dirt";
    if (look.ground) items.push({ kind: "surface", id: `${d.id}/ground`, from: d.id, class: "quarter", poly, ...look.ground });
    // (a town's or city's built-up ground on a battle map, where its character has none of its own: worn by feet, as
    // its overview shows it, rather than a meadow between the houses)
    else if (battle && ["town", "city"].includes(OLD_PROFILES[d.profile] ?? d.profile)) items.push({ kind: "surface", id: `${d.id}/ground`, from: d.id, class: "quarter", poly, surface: "trodden", alpha: 0.55 });
    const own = [];
    made.streets.forEach((st, k) => {
      const item = { kind: "way", id: `${d.id}/s${k + 1}`, from: d.id, class: st.kind, path: st.path, width: st.width, surface, ruts: false, ...(st.wallEnds ? { wallEnds: st.wallEnds } : {}) };
      items.push(item);
      own.push(item);
      const entry = { path: st.path, clear: st.width / 2 - 0.05 };
      owner.set(entry, d.id);
      space.ways.push(entry);
    });
    made.bridges.forEach((b, k) => {
      const foot = b.kind === "footbridge";
      items.push({ kind: "crossing", id: `${d.id}/b${k + 1}`, from: d.id, class: b.kind, at: b.at, angle: b.angle, length: b.length + 0.3, width: (foot ? 8 : 20) / sq, frozen: false });
    });
    // Plots along every road and street, and what stands on them. Each gate is kept clear too: the neighbor's street
    // starts there, and its width reaches a little over the shared edge even where this district's street doesn't
    const gateClear = (gates.get(d.id) ?? []).map((g) => shapeToPolygon({ circle: [g.at[0], g.at[1], (g.kind === "lane" ? GATE_WIDTH.lane : GATE_WIDTH.street) / sq / 2 + 0.05] }));
    const keepOff = [...blocked, ...gateClear, ...(anchor ? [anchor.block] : [])];
    const { lots, back } = lotsFor({ district: d, poly, ways: [...nearHere, ...own], water: lotWater, blocked: keepOff, ftPerSquare: sq, r: r.fork("lots") });
    // Which plots go to its notable buildings, trades and shops
    const note = notables.get(d.id);
    const usesFor = (tryForm) => planUses({ district: d, lots, ways: [...nearHere, ...own], want: lessPlanned((note?.want ?? []).filter((u) => !(anchor && u === "temple" && anchorAt.kind === "temple")), planUsesIn.get(d.id)), ctx: note?.ctx ?? { center: centroid(poly), radius: 10, gates: [], squares: [] }, water: useWater, roadIds, ftPerSquare: sq, r: r.fork("uses"), tryForm });
    const built = buildOnLots({ lots, district: d, ways: [...nearHere, ...own], blocked: keepOff, ftPerSquare: sq, r: r.fork("build"), usesFor });
    const uses = built.uses;
    ctx.filling = d.id;
    if (anchor) addAnchor(d, anchor, r.fork("anchor-fill"));
    const smoky = [];
    // (a house and its wings share a group, so a style can treat them as one: one roof tile on a battle map)
    let main = null;
    for (const h of built.houses) {
      const item = addBuilding(h.building, `${d.id}/h-${h.id}`, h.r, d.id);
      if (!h.wing) { main = item.id; item.main = true; }
      item.group = main ?? item.id;
      if (h.smoke) smoky.push([item, h.smoke]);
    }
    for (const o of built.outbuildings) addBuilding(o.building, `${d.id}/o-${o.id}`, o.r, d.id);
    // Smoke from a forge's, kiln's or oven's chimney (or its middle), drifting with the map's wind
    for (const [b, tint] of smoky) {
      const a = (b.rot * Math.PI) / 180, u = b.chimney ? b.chimney.u * b.len : 0, v = b.chimney ? b.chimney.v * b.dep : 0;
      items.push({ kind: "smoke", id: `${b.id}/smoke`, from: d.id, x: b.cx + u * Math.cos(a) - v * Math.sin(a), y: b.cy + u * Math.sin(a) + v * Math.cos(a), tint, s: 1, wind });
    }
    built.kilns.forEach((k, n) => {
      items.push({ kind: "kiln", id: `${d.id}/k${n + 1}`, from: d.id, x: k.x, y: k.y, rad: k.rad });
      items.push({ kind: "smoke", id: `${d.id}/k${n + 1}/smoke`, from: d.id, x: k.x, y: k.y, tint: USE_INFO[k.use]?.smoke ?? "gray", s: 1.2, wind });
      const kp = shapeToPolygon({ circle: [k.x, k.y, k.rad] }, 0, 12);
      owner.set(kp, d.id);
      space.plots.push(kp);
    });
    built.surfaces.forEach((x, k) => items.push({ kind: "surface", id: `${d.id}/u${k + 1}`, from: d.id, class: x.class, poly: x.poly, surface: x.surface }));
    for (const x of built.surfaces.filter((x) => x.class === "churchyard")) {
      const t = built.houses.find((h) => h.site === "temple" && pointInPolygon([(h.building.shape.rect?.[0] + h.building.shape.rect?.[2]) / 2, (h.building.shape.rect?.[1] + h.building.shape.rect?.[3]) / 2], x.poly));
      addGraves(d, x.poly, t?.building.rot ?? 0, graveCount(d, false), r.fork("graves", x.poly.length, Math.round(x.poly[0][0] * 10)));
    }
    built.pits.forEach((x, k) => items.push({ kind: "pit", id: `${d.id}/p${k + 1}`, from: d.id, ...x }));
    built.walls.forEach((path, k) => items.push({ kind: "wall", id: `${d.id}/v${k + 1}`, from: d.id, class: "stone", path, height: 5 / sq, ...(battle ? { lot: built.wallSite[k] ?? true } : {}) }));
    built.props.forEach((x, k) => items.push({ kind: "prop", id: `${d.id}/q${k + 1}`, from: d.id, class: x.class, x: x.x, y: x.y, rot: x.rot, variant: x.variant, scale: (CLUTTER_FT[x.class] ?? 6) / sq / (PROP_SQUARES[x.class] ?? 0.45) }));
    built.gardens.forEach((garden, k) => {
      items.push({ kind: "surface", id: `${d.id}/g${k + 1}`, from: d.id, class: "garden", garden });
      const gp = shapeToPolygon({ rect: [garden.cx - garden.w / 2, garden.cy - garden.d / 2, garden.cx + garden.w / 2, garden.cy + garden.d / 2] }, garden.rot);
      owner.set(gp, d.id);
      space.gardens.push(gp);
    });
    built.crofts.forEach((poly, k) => items.push({ kind: "surface", id: `${d.id}/c${k + 1}`, from: d.id, class: "croft", poly }));
    // (a plot's lines read as stray fences at battle size: its yard is fenced instead, after)
    if (!battle) built.bounds.forEach((b, k) => items.push({ kind: "boundary", id: `${d.id}/f${k + 1}`, from: d.id, class: b.class, path: b.path }));
    // Trees in the plots: orchards in rows and trees about the yards
    built.trees.forEach((t, k) => items.push({ kind: "tree", id: `${d.id}/y${k + 1}`, from: d.id, x: t.x, y: t.y, species: t.species ?? "bare", size: t.size ?? null, s: t.s, rot: t.rot, variant: t.variant }));
    // Ground no plot takes (beyond the back lanes, the middle of big blocks): trees scattered evenly (Poisson-disk),
    // thinned in patches by a noise, so they gather in clumps with open ground between
    const T = lotTypeOf(d);
    const wr = r.fork("wild");
    const patch = makeNoise(plan.seed, `${d.id}/wild`, { scale: 6, octaves: 2 });
    let wild = 0;
    // A dense quarter builds up the middles of its blocks instead: rows of stores, workshops or shacks square to the
    // nearest street, with its clutter between them
    // (on a battle map every block's middle is built up, BATTLE_BACK)
    const backLook = battle ? battleBack(look.back) : look.back;
    const keepPlots = backLook ? [...lots.map((l) => l.poly), ...built.surfaces.filter((x) => x.poly).map((x) => x.poly)].map((p) => [p, bbox(p)]) : [];
    if (backLook) shapes(back).forEach((piece, k) => fillBack(d, piece, k, backLook, [...nearHere, ...own], r.fork("back", k), keepPlots, built.palette));
    else back.forEach((poly, k) => {
      const pts = poissonInPolygon(poly, T.wild ?? 1.5, wr.fork(k), { keep: (x, y) => patch(x, y) > -0.1 && free(x, y, 0.45), max: 400 });
      for (const [x, y] of pts) {
        wild++;
        items.push({ kind: "tree", id: `${d.id}/w${wild}`, from: d.id, x, y, species: "bare", size: null, s: 0.4 + wr.next() * 0.25, rot: wr.next() * 360, variant: wr.int(8) });
      }
    });
    // Trees along its main streets (a nobles' or temple quarter's), where there's room
    if (look.streetTrees) {
      const tr = r.fork("avenue");
      let n = 0;
      for (const st of own.filter((w) => w.class === "street")) {
        for (const [p, dir] of stepsAlong(st.path, 35 / sq)) for (const side of [-1, 1]) {
          const off = st.width / 2 + 7 / sq;
          const x = p[0] - dir[1] * off * side, y = p[1] + dir[0] * off * side;
          if (!pointInPolygon([x, y], poly) || !free(x, y, 0.4, 0.3)) continue;
          items.push({ kind: "tree", id: `${d.id}/a${++n}`, from: d.id, x, y, species: "bare", size: null, s: 0.42 + tr.next() * 0.12, rot: tr.next() * 360, variant: tr.int(8) });
        }
      }
    }
    // Small things by its streets: wells, fountains, wayside shrines, watch posts (its character says how many)
    if (look.extras) streetCorners(d, poly, own.filter((w) => w.class !== "back"), reduceBy(look.extras, planUsesIn.get(d.id)), r.fork("extras"));
    ctx.filling = null;
    const remember = () => {
      if (!key) return;
      const rec = structuredClone({
        items: items.slice(mark.items), buildings: space.buildings.slice(mark.buildings), reserved: space.reserved.slice(mark.reserved),
        plots: space.plots.slice(mark.plots), gardens: space.gardens.slice(mark.gardens), ways: space.ways.slice(mark.ways), notes: notes.slice(mark.notes),
      });
      // (its size as JSON, two bytes a character: what the cache counts against its budget)
      const bytes = keyJSON(rec).length * 2;
      if (districtCache.has(key)) cacheUse.bytes -= districtCache.get(key).bytes;
      districtCache.set(key, { rec, bytes });
      cacheUse.bytes += bytes;
      while (cacheUse.bytes > DISTRICT_CACHE_BYTES && districtCache.size > 1) {
        const [old, e] = districtCache.entries().next().value;
        districtCache.delete(old);
        cacheUse.bytes -= e.bytes;
      }
    };
    notes.push({ level: "info", id: d.id, message: `"${d.id}": ${own.length} ${own.length === 1 ? "street or lane" : "streets and lanes"}, ${made.bridges.length} ${made.bridges.length === 1 ? "bridge" : "bridges"}, ${lots.length - uses.sites.reduce((n, st) => n + st.lots.length - 1, 0)} plots, ${built.houses.filter((h) => !h.wing).length} houses (${built.houses.filter((h) => !h.wing && (h.shape === "row" || (h.shape === "steps" && Array.isArray(h.building.shape)))).length} in rows; ${["L", "T", "U", "court"].map((k) => `${built.houses.filter((h) => h.shape === k).length} ${k}`).join(", ")}; ${built.houses.filter((h) => h.shape === "steps").length} in steps, ${built.houses.filter((h) => /b$/.test(h.id)).length} bays, ${built.houses.filter((h) => /d\d$/.test(h.id)).length} dormers, ${built.houses.filter((h) => /t$/.test(h.id)).length} turrets), ${built.outbuildings.length} outbuildings, ${built.gardens.length} gardens, ${built.crofts.length} crofts, ${built.trees.length} trees in plots, ${wild} beyond.` });
    for (const use of uses?.missed ?? []) notes.push({ level: "info", id: d.id, message: `"${d.name ?? d.id}" had no room for its ${useLabel(use).toLowerCase()}.` });
    for (const use of uses?.dry ?? []) notes.push({ level: "info", id: d.id, message: `"${d.name ?? d.id}" has no water near for its ${useLabel(use).toLowerCase()}, so it has none.` });
    remember();
  }
}
