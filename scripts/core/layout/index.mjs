/**
 * Plan to Layout: everything the generator works out from a plan, as plain items in squares.
 *
 * Fixed features become items as they are; districts and areas are filled. Each district or area has its own
 * random stream (the plan seed, or its own seed in plan.seeds, and its id), so changing one never moves another.
 * Every random choice is made here, never in the painter, so the same plan always paints the same map, whatever
 * tiles it's painted in. Pure: runs in the worker and under node.
 */
import { normalize } from "../plan.mjs";
import { rng } from "../rng.mjs";
import { shapeToPolygon, bbox, pointInPolygon, distanceToPath, pathTouchesPolygon, polygonsOverlap } from "../geom.mjs";
import { seasonOf } from "../roles.mjs";
import { fillRoadside, fillFarmstead, fillWoods, hedgeBushes, groundPatches } from "./settlement.mjs";

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

  // Everything placed so far that new things must keep clear of
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
        space.ways.push({ path: f.path, clear: width / 2 + (f.class === "highway" ? 0.05 : -0.05) });
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
        addBuilding(f, f.id, streamFor(f.id));
        break;
      case "landmark": {
        const r = streamFor(f.id);
        f.buildings.forEach((b, j) => addBuilding(b, `${f.id}/${j + 1}`, r, f.id));
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
        labels.push({ id: f.id, text: f.text, at: f.at, show: f.show });
        break;
      case "area":
        if (f.class === "yard") {
          const poly = shapeToPolygon(f.shape);
          items.push({ kind: "surface", id: f.id, from: f.id, class: "yard", poly, surface: f.surface ?? "trodden", fence: f.fence ?? null });
          space.reserved.push(grow(poly, 0.35));
          space.zones.push(poly);
        } else if (f.class === "trodden") {
          items.push({ kind: "surface", id: f.id, from: f.id, class: "trodden", poly: shapeToPolygon(f.shape, 0, 48), surface: "trodden" });
        }
        break;
      default:
        break;
    }
  }

  function addBuilding(b, id, r, from = id) {
    let cx, cy, len, dep;
    if (b.shape?.rect) {
      const [x0, y0, x1, y1] = b.shape.rect;
      cx = (x0 + x1) / 2; cy = (y0 + y1) / 2; len = x1 - x0; dep = y1 - y0;
    } else {
      const [x0, y0, x1, y1] = bbox(shapeToPolygon(b.shape));
      cx = (x0 + x1) / 2; cy = (y0 + y1) / 2; len = x1 - x0; dep = y1 - y0;
      notes.push({ level: "warning", id, message: `"${id}": only rectangular buildings are drawn so far; this one is drawn as its bounding box.` });
    }
    const roof = b.roof ?? "slate";
    const item = {
      kind: "building", id, from, cx, cy, len, dep, rot: b.rot ?? 0, roof, variant: r.int(8), tall: tallOf(b.height ?? 20),
      chimney: (b.chimney ?? r.chance(0.75)) ? { u: 0.3, v: r.chance(0.5) ? -0.2 : 0.2, variant: r.int(8) } : null,
      ...(b.name ? { name: b.name } : {}),
    };
    items.push(item);
    space.buildings.push(item);
    const foot = shapeToPolygon({ rect: [cx - len / 2, cy - dep / 2, cx + len / 2, cy + dep / 2] }, item.rot);
    space.reserved.push(grow(foot, 0.4));
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
    for (const poly of space.reserved) if (pointInPolygon([x, y], poly) || distanceToPath([x, y], closed(poly)) < rad * 0.9) return false;
    for (const poly of space.gardens) if (pointInPolygon([x, y], poly) || distanceToPath([x, y], closed(poly)) < rad * 0.9) return false;
    for (const w of space.water) if (distanceToPath([x, y], w.path) < half + w.clear) return false;
    for (const w of space.ways) if (distanceToPath([x, y], w.path) < half + w.clear) return false;
    for (const b of space.buildings) if (Math.hypot(b.cx - x, b.cy - y) < (rad + Math.max(b.len, b.dep) * 0.5) * 0.8 + 0.15) return false;
    return true;
  }

  /**
   * True when a garden (a polygon) stays out of squares, yards, water and roads, other gardens and every building
   * except its own house (own: that house's footprint, which the garden only touches). A garden that fits is
   * remembered with record.
   */
  function freeGarden(poly, own = null, record = false) {
    for (const z of space.zones) if (polygonsOverlap(poly, z)) return false;
    for (const p of space.plots) if (p !== own && polygonsOverlap(shrink(poly, 0.04), p)) return false;
    for (const w of [...space.water, ...space.ways]) {
      if (pathTouchesPolygon(w.path, poly)) return false;
      if (poly.some((p) => distanceToPath(p, w.path) < w.clear)) return false;
    }
    if (record) {
      space.plots.push(poly);
      space.gardens.push(poly);
    }
    return true;
  }

  // Districts: houses along every road or lane that runs into them
  progress(0.25, "Districts");
  for (const d of plan.features.filter((f) => f.type === "district")) {
    const poly = shapeToPolygon(d.shape);
    const r = streamFor(d.id);
    const along = ways.filter((w) => pathTouchesPolygon(w.path, poly));
    const before = items.length;
    fillRoadside({ district: d, poly, ways: along, r, free, freeGarden, addBuilding: (spec) => addBuilding(spec.building, spec.id, r, d.id), items });
    const houses = items.slice(before).filter((i) => i.kind === "building").length;
    notes.push({ level: "info", id: d.id, message: `"${d.id}": ${houses} houses along ${along.length} roads and lanes.` });
  }

  // Farmsteads, then woods and lone trees (trees keep clear of the farms' buildings)
  progress(0.5, "Farms and woods");
  for (const f of plan.features.filter((f) => f.type === "area" && f.class === "farmstead")) {
    const r = streamFor(f.id);
    fillFarmstead({ area: f, r, addBuilding: (b, id) => addBuilding(b, id, r, f.id), items });
  }
  for (const f of plan.features.filter((f) => f.type === "area" && f.class === "woods")) {
    fillWoods({ area: f, r: streamFor(f.id), free, items });
  }
  for (const f of plan.features.filter((f) => f.type === "wall" && f.class === "hedge")) {
    hedgeBushes({ wall: f, r: streamFor(f.id), items });
  }

  progress(0.85, "Ground");
  items.unshift({ kind: "ground", id: "ground", from: "plan", base: plan.ground, patches: groundPatches(rng(plan.seed, "ground"), W, H) });

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
