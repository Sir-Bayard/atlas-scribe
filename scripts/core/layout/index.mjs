/**
 * Plan to Layout: everything the generator works out from a plan, as plain items in squares.
 *
 * Fixed features become items as they are; districts and areas are filled. Each district or area has its own
 * random stream (the plan seed, or its own seed in plan.seeds, and its id), and draws from it the same number of
 * times whatever fits, so reseeding one moves only what it places and anything that was crowding against it.
 * Every random choice is made here, never in the painter, so the same plan always paints the same map, whatever
 * tiles it's painted in. Pure: runs in the worker and under node.
 */
import { normalize } from "../plan.mjs";
import { rng } from "../rng.mjs";
import { shapeToPolygon, bbox, pointInPolygon, distanceToPath, pathTouchesPolygon, polygonsOverlap } from "../geom.mjs";
import { seasonOf } from "../roles.mjs";
import { fillFarmstead, fillWoods, hedgeBushes, groundPatches } from "./settlement.mjs";
import { streetsFor, districtGates, gateSpacing } from "../streets/index.mjs";
import { sharedEdges } from "../streets/borders.mjs";
import { lotsFor } from "../lots/index.mjs";
import { buildOnLots } from "../lots/build.mjs";

export const LAYOUT_VERSION = 1;

/** An ordinary house is 20 ft; each 20 ft above that is one step of "tall" (longer shadows). */
const tallOf = (heightFt) => Math.max(0, (Number(heightFt) - 20) / 20);

export function layoutPlan(rawPlan, { onProgress = null } = {}) {
  const plan = normalize(rawPlan);
  const sq = plan.size.ftPerSquare;
  const ft = (v) => (v == null ? null : v / sq);
  const [W, H] = plan.size.squares;
  const notes = [];
  const items = [];
  const labels = [];
  const streamFor = (id) => rng(plan.seeds?.[id] ?? plan.seed, id);
  const progress = (pct, label) => onProgress?.(pct, label);

  // Everything placed so far that new things must keep clear of. While a district fills, what other districts
  // placed is ignored (each district's houses and gardens stay inside it, so they can't overlap), which keeps
  // districts independent: reseeding one never moves another.
  const owner = new WeakMap(); // a polygon or building item to the district that placed it
  const districts = plan.features.filter((f) => f.type === "district").map((f) => ({ id: f.id, poly: shapeToPolygon(f.shape) }));
  const districtIds = new Set(districts.map((d) => d.id));
  const touching = new Set(); // "a|b" for districts that overlap: those do see each other's houses
  for (const a of districts) for (const b of districts) if (a !== b && polygonsOverlap(shrink(a.poly, 0.01), shrink(b.poly, 0.01))) touching.add(`${a.id}|${b.id}`);
  let filling = null; // the district being filled
  const elsewhere = (o) => {
    const by = owner.get(o);
    return filling !== null && by !== undefined && by !== filling && districtIds.has(by) && !touching.has(`${filling}|${by}`);
  };
  const space = {
    reserved: [], // polygons
    zones: [], // squares and yards: open ground that gardens mustn't spill into either
    plots: [], // gardens laid so far, and every building's footprint, for gardens to keep out of
    gardens: [], // gardens laid so far, for houses to keep out of
    buildings: [], // {cx, cy, len, dep}
    ways: [], // {path, clear}: distance a new thing's edge keeps from the way's centre line
    water: [],
  };

  progress(0.05, "Fixed features");
  const ways = [];
  for (const f of plan.features) {
    switch (f.type) {
      case "road": {
        const width = ft(f.width);
        const item = { kind: "way", id: f.id, from: f.id, class: f.class, path: f.path, width, surface: f.surface, ruts: !!f.ruts };
        items.push(item);
        ways.push(item);
        space.ways.push({ path: f.path, clear: width / 2 + (f.class === "highway" ? 0.05 : -0.05), owner: null });
        break;
      }
      case "water":
        if (f.path) {
          items.push({ kind: "water", id: f.id, from: f.id, class: f.class, path: f.path, width: ft(f.width), frozen: !!f.frozen });
          space.water.push({ path: f.path, clear: ft(f.width) / 2 + 0.225 });
        } else notes.push({ level: "warning", id: f.id, message: `"${f.id}": water drawn as an area isn't painted yet; only rivers and streams along a path are.` });
        break;
      case "crossing":
        items.push({ kind: "crossing", id: f.id, from: f.id, class: f.class, at: f.at, angle: f.angle, length: ft(f.length), width: ft(f.width), frozen: !!f.frozen });
        break;
      case "square": {
        const poly = shapeToPolygon(f.shape);
        items.push({ kind: "surface", id: f.id, from: f.id, class: "square", poly, surface: f.surface });
        space.reserved.push(grow(poly, 0.3));
        space.zones.push(poly);
        break;
      }
      case "building":
        addBuilding(planBuilding(f), f.id, streamFor(f.id));
        break;
      case "landmark": {
        const r = streamFor(f.id);
        f.buildings.forEach((b, j) => addBuilding(planBuilding(b), `${f.id}/${j + 1}`, r, f.id));
        break;
      }
      case "wall":
        if (f.class === "hedge") break; // hedges are bushes, placed after the fill
        items.push({ kind: "wall", id: f.id, from: f.id, class: f.class, path: f.path, height: ft(f.height) });
        break;
      case "prop":
        addProp(f, streamFor(f.id));
        break;
      case "label":
        labels.push({ id: f.id, text: f.text, at: f.at, show: f.show, size: f.size });
        break;
      case "area":
        if (f.class === "yard") {
          const poly = shapeToPolygon(f.shape, f.rot);
          items.push({ kind: "surface", id: f.id, from: f.id, class: "yard", poly, surface: f.surface ?? "trodden", fence: f.fence ?? null });
          space.reserved.push(grow(poly, 0.35));
          space.zones.push(poly);
        } else if (f.class === "trodden") {
          items.push({ kind: "surface", id: f.id, from: f.id, class: "trodden", poly: shapeToPolygon(f.shape, f.rot, 48), surface: "trodden" });
        } else if (f.class !== "farmstead" && f.class !== "woods") {
          notes.push({ level: "warning", id: f.id, message: `"${f.id}": areas of class "${f.class}" aren't drawn yet.` });
        }
        break;
      default:
        break;
    }
  }

  /** A plan's building as addBuilding takes it: join and cut are the generator's own, never read from a plan. */
  function planBuilding(b) {
    const { join, cut, ...rest } = b;
    return rest;
  }

  /** Adds a building item and keeps space clear around it. r: the stream for its own small choices. */
  function addBuilding(b, id, r, from = id) {
    let cx, cy, len, dep, round = false;
    if (b.shape?.circle) {
      // A round building (a tower, a dovecote): drawn under a cone
      const [x, y, rad] = b.shape.circle;
      cx = x; cy = y; len = dep = 2 * rad; round = true;
    } else if (b.shape?.rect) {
      const [x0, y0, x1, y1] = b.shape.rect;
      cx = (x0 + x1) / 2; cy = (y0 + y1) / 2; len = x1 - x0; dep = y1 - y0;
    } else {
      const [x0, y0, x1, y1] = bbox(shapeToPolygon(b.shape));
      cx = (x0 + x1) / 2; cy = (y0 + y1) / 2; len = x1 - x0; dep = y1 - y0;
      notes.push({ level: "warning", id, message: `"${id}": only rectangular and round buildings are drawn so far; this one is drawn as its bounding box.` });
    }
    const roof = b.roof ?? "slate";
    const v = r.int(8); // drawn even when given, so the stream stays the same
    const item = {
      kind: "building", id, from, cx, cy, len, dep, rot: b.rot ?? 0, roof, variant: b.variant ?? v, tall: tallOf(b.height ?? 20),
      roofStyle: round ? "cone" : b.roofStyle ?? "gable", // see ROOF_STYLES; a round building's is always a cone
      ...(round ? { round: true } : {}),
      ...(b.join ? { join: b.join } : {}), // a wing's ends that run into another roof (valleys there, no hip)
      ...(b.cut ? { cut: b.cut } : {}), // hips that start in from their corner, where a flush wing covers it
      chimney: (b.chimney ?? r.chance(0.75)) && !round ? { u: 0.3, v: r.chance(0.5) ? -0.2 : 0.2, variant: r.int(8) } : null,
      ...(b.name ? { name: b.name } : {}),
    };
    items.push(item);
    space.buildings.push(item);
    const foot = round ? shapeToPolygon({ circle: [cx, cy, len / 2] }) : shapeToPolygon({ rect: [cx - len / 2, cy - dep / 2, cx + len / 2, cy + dep / 2] }, item.rot);
    const kept = grow(foot, 0.4);
    for (const o of [item, foot, kept]) owner.set(o, from);
    space.reserved.push(kept);
    space.plots.push(foot);
    Object.defineProperty(item, "footprint", { value: foot, enumerable: false }); // for its own garden; not part of the layout data
    return item;
  }

  function addProp(f, r) {
    const [x, y] = f.at;
    if (f.class === "tree") {
      const species = f.species === "conifer" ? "conifer" : "bare";
      items.push({ kind: "tree", id: f.id, from: f.id, x, y, species, size: species === "conifer" ? "large" : null, s: species === "bare" ? 0.5 + r.next() * 0.25 : 0.9 + r.next() * 0.6, rot: r.next() * 360, variant: r.int(8) });
    } else {
      items.push({ kind: "prop", id: f.id, from: f.id, class: f.class, x, y, rot: f.rot ?? 0, variant: r.int(8) });
    }
  }

  /** True when a thing of radius rad (half-depth half, when given) at x, y keeps clear of everything placed so far. */
  function free(x, y, rad, half = rad) {
    if (x < -1 || y < -1 || x > W + 1 || y > H + 1) return false;
    for (const poly of space.reserved) if (!elsewhere(poly) && (pointInPolygon([x, y], poly) || distanceToPath([x, y], closed(poly)) < rad * 0.9)) return false;
    for (const poly of space.gardens) if (!elsewhere(poly) && (pointInPolygon([x, y], poly) || distanceToPath([x, y], closed(poly)) < rad * 0.9)) return false;
    for (const w of space.water) if (distanceToPath([x, y], w.path) < half + w.clear) return false;
    for (const w of space.ways) if (!elsewhere(w) && distanceToPath([x, y], w.path) < half + w.clear) return false;
    for (const b of space.buildings) if (!elsewhere(b) && Math.hypot(b.cx - x, b.cy - y) < (rad + Math.max(b.len, b.dep) * 0.5) * 0.8 + 0.15) return false;
    return true;
  }



  // Farmsteads first, so district houses keep out of the farmyards
  progress(0.25, "Farms");
  for (const f of plan.features.filter((f) => f.type === "area" && f.class === "farmstead")) {
    const r = streamFor(f.id);
    const before = items.length;
    notes.push(...fillFarmstead({ area: f, r, free, addBuilding: (b, id, br) => addBuilding(b, id, br, f.id), items }));
    const yard = items.slice(before).find((i) => i.class === "farmyard");
    if (yard) {
      space.reserved.push(grow(yard.poly, 0.35));
      space.zones.push(yard.poly);
    }
  }

  // Districts: generated streets first (each district's own, meeting its neighbours' at gates on shared edges),
  // then houses along every road, street and lane that runs into it
  progress(0.4, "Districts");
  const dfeats = plan.features.filter((f) => f.type === "district");
  const dlist = dfeats.map((d) => ({ id: d.id, poly: shapeToPolygon(d.shape), ...gateSpacing(d, sq) }));
  const waterAt = (x, y) => space.water.some((w) => distanceToPath([x, y], w.path) < w.clear);
  const gates = districtGates(dlist, { roads: ways, inWater: waterAt, seed: plan.seed });
  const radials = plan.features.filter((f) => f.type === "square" && f.radial).map((f) => {
    const poly = shapeToPolygon(f.shape);
    const [x0, y0, x1, y1] = bbox(poly);
    const at = [(x0 + x1) / 2, (y0 + y1) / 2];
    return { at, radius: poly.reduce((s, p) => s + Math.hypot(p[0] - at[0], p[1] - at[1]), 0) / poly.length };
  });
  const blocked = [...space.zones, ...space.plots]; // squares, yards and every building so far
  for (const d of dfeats) {
    const { poly } = dlist.find((x) => x.id === d.id);
    const r = streamFor(d.id);
    const fixedHere = ways.filter((w) => pathTouchesPolygon(w.path, poly));
    const borders = dlist.filter((o) => o.id !== d.id && o.streetSpacing).flatMap((o) => sharedEdges(poly, o.poly));
    const made = streetsFor({
      district: d, poly, roads: fixedHere, water: space.water, radials, blocked, gates: gates.get(d.id) ?? [], borders,
      ftPerSquare: sq, r: r.fork("streets"),
    });
    const surface = d.surface ?? fixedHere[0]?.surface ?? "dirt";
    const own = [];
    made.streets.forEach((st, k) => {
      const item = { kind: "way", id: `${d.id}/s${k + 1}`, from: d.id, class: st.kind, path: st.path, width: st.width, surface, ruts: false };
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
    // Plots along every road and street, and what stands on them
    const waterItems = items.filter((i) => i.kind === "water" && i.path);
    const { lots } = lotsFor({ district: d, poly, ways: [...fixedHere, ...own], water: waterItems, blocked, ftPerSquare: sq, r: r.fork("lots") });
    const built = buildOnLots({ lots, district: d, ways: [...fixedHere, ...own], blocked, ftPerSquare: sq, r: r.fork("build") });
    filling = d.id;
    for (const h of built.houses) addBuilding(h.building, `${d.id}/h-${h.id}`, h.r, d.id);
    for (const o of built.outbuildings) addBuilding(o.building, `${d.id}/o-${o.id}`, o.r, d.id);
    built.gardens.forEach((garden, k) => {
      items.push({ kind: "surface", id: `${d.id}/g${k + 1}`, from: d.id, class: "garden", garden });
      const gp = shapeToPolygon({ rect: [garden.cx - garden.w / 2, garden.cy - garden.d / 2, garden.cx + garden.w / 2, garden.cy + garden.d / 2] }, garden.rot);
      owner.set(gp, d.id);
      space.gardens.push(gp);
    });
    built.crofts.forEach((poly, k) => items.push({ kind: "surface", id: `${d.id}/c${k + 1}`, from: d.id, class: "croft", poly }));
    built.bounds.forEach((b, k) => items.push({ kind: "boundary", id: `${d.id}/f${k + 1}`, from: d.id, class: b.class, path: b.path }));
    filling = null;
    notes.push({ level: "info", id: d.id, message: `"${d.id}": ${own.length} streets and lanes, ${made.bridges.length} bridges, ${lots.length} plots, ${built.houses.filter((h) => !h.wing).length} houses (${["L", "T", "U", "court"].map((k) => `${built.houses.filter((h) => h.shape === k).length} ${k}`).join(", ")}; ${built.houses.filter((h) => h.shape === "steps").length} in steps, ${built.houses.filter((h) => /b$/.test(h.id)).length} bays, ${built.houses.filter((h) => /d\d$/.test(h.id)).length} dormers, ${built.houses.filter((h) => /t$/.test(h.id)).length} turrets), ${built.outbuildings.length} outbuildings, ${built.gardens.length} gardens, ${built.crofts.length} crofts.` });
  }

  // Woods and hedgerows last: trees keep clear of every building
  progress(0.6, "Woods");
  for (const f of plan.features.filter((f) => f.type === "area" && f.class === "woods")) {
    fillWoods({ area: f, r: streamFor(f.id), free, items });
  }
  for (const f of plan.features.filter((f) => f.type === "wall" && f.class === "hedge")) {
    hedgeBushes({ wall: f, r: streamFor(f.id), items });
  }

  progress(0.85, "Ground");
  items.unshift({ kind: "ground", id: "plan/ground", from: "plan", base: plan.ground, patches: groundPatches(rng(plan.seed, "ground"), W, H) });

  const layout = {
    atlasScribe: LAYOUT_VERSION,
    plan: plan.id ?? null,
    size: { squares: [W, H], ftPerSquare: sq },
    season: seasonOf(plan),
    style: plan.style,
    sun: plan.sun,
    pxPerSquare: plan.output.pxPerSquare,
    items,
    labels,
    notes,
  };
  progress(1, "Done");
  return layout;
}

/** A polygon pushed out from its centre by a margin (rough, for keeping clear; fine for convex shapes). */
function grow(poly, by) {
  if (!by) return poly;
  const [x0, y0, x1, y1] = bbox(poly);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return poly.map(([x, y]) => {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1;
    return [x + (dx / d) * by, y + (dy / d) * by];
  });
}

const closed = (poly) => [...poly, poly[0]];

/** A polygon pulled in toward its centre by a fraction, so shapes that only touch don't count as overlapping. */
function shrink(poly, by) {
  const [x0, y0, x1, y1] = bbox(poly);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return poly.map(([x, y]) => [x + (cx - x) * by, y + (cy - y) * by]);
}
