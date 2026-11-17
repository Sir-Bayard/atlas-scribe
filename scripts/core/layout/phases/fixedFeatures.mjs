// One phase of laying out a plan (layout/index.mjs, layoutPlan): ctx holds what the phases share.
import { layRelief } from "../relief.mjs";
import { NOT_DRAWN_YET, PROP_SIZE, PROP_SQUARES, isConifer, okChimney, okCut, okJoin } from "../../plan.mjs";
import { SHORE_REACH, frozenOf, isRunning, segClears } from "../../water.mjs";
import { WILD_PROPS, WILD_SCALE } from "../wild.mjs";
import { area, offset } from "../../lots/poly.mjs";
import { bandPieces, isTownWall } from "../walls.mjs";
import { bbox, shapeToPolygon } from "../../geom.mjs";
import { chimneyOf, grow, ridgeChimney, tallOf } from "../index.mjs";
import { cliffOf, offsetLine } from "../../cliffs.mjs";
import { edgeSpan, iceShelves } from "../terrain.mjs";
import { roadWaterCrossings, snapCrossings } from "../crossings.mjs";
import { seasonOf } from "../../roles.mjs";
import { seedOf } from "../../seeds.mjs";

/** What the plan fixes: its water, roads, crossings, walls, plan buildings, landmarks and props, laid first. */
export function fixedFeatures(ctx) {
  const { H, W, battle, ft, items, notes, owner, plan, progress, space, sq, streamFor } = ctx;
  Object.assign(ctx, { addBuilding });
  /** A plan's building as addBuilding takes it: join and cut are the generator's own, never read from a plan. */
  function planBuilding(b) {
    // join and cut only as the generator writes them (a pinned building); anything else is left out
    const { join, cut, chimneyAt, ...rest } = b;
    return { ...rest, ...(okJoin(join) ? { join } : {}), ...(okCut(cut) ? { cut } : {}), ...(okChimney(chimneyAt) ? { chimneyAt } : {}) };
  }
  /** Adds a building item and keeps space clear around it. r: the stream for its own small choices. */
  function addBuilding(b, id, r, from = id) {
    let cx, cy, len, dep, round = false, poly = null;
    if (Array.isArray(b.shape) && shapeToPolygon(b.shape).length >= 3) {
      // A footprint of any shape (a city row house), measured in the frame of its turn, under a gable whose ridge
      // runs that way
      poly = shapeToPolygon(b.shape, b.rot ?? 0);
      const a = ((b.rot ?? 0) * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a);
      const us = poly.map(([x, y]) => x * ux + y * uy), vs = poly.map(([x, y]) => -x * uy + y * ux);
      const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
      const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
      cx = um * ux - vm * uy; cy = um * uy + vm * ux; len = u1 - u0; dep = v1 - v0;
      // (a gable or a flat roof: a polygon takes no other form, and says so when the plan asked for one)
      if (b.roofStyle && b.roofStyle !== "gable" && b.roofStyle !== "flat") notes.push({ level: "warning", id, message: `"${id}": a building of any other shape than a rectangle is drawn with a gable (or flat), not a ${b.roofStyle} roof.` });
    } else if (b.shape?.circle) {
      // A round building (a tower, a dovecote): drawn under a cone
      const [x, y, rad] = b.shape.circle;
      cx = x; cy = y; len = dep = 2 * rad; round = true;
    } else if (b.shape?.rect) {
      const [x0, y0, x1, y1] = b.shape.rect;
      cx = (x0 + x1) / 2; cy = (y0 + y1) / 2; len = x1 - x0; dep = y1 - y0;
    } else {
      const [x0, y0, x1, y1] = bbox(shapeToPolygon(b.shape));
      cx = (x0 + x1) / 2; cy = (y0 + y1) / 2; len = x1 - x0; dep = y1 - y0;
      notes.push({ level: "warning", id, message: `"${id}": only rectangular, round and polygon buildings are drawn so far; this one is drawn as its bounding box.` });
    }
    const roof = b.roof ?? "slate";
    const v = r.int(8); // drawn even when given, so the stream stays the same
    const cc = r.chance(0.75), cv = r.chance(0.5), ci = r.int(8); // the chimney's, likewise (a landmark's buildings share a stream)
    const item = {
      kind: "building", id, from, cx, cy, len, dep, rot: b.rot ?? 0, roof, variant: b.variant ?? v, tall: tallOf(b.height ?? 20),
      roofStyle: round ? (b.tower && b.roofStyle === "flat" ? "flat" : "cone") : poly ? (b.roofStyle === "flat" ? "flat" : "gable") : b.roofStyle ?? "gable", // see ROOF_STYLES; a round building's is a cone (an open tower's flat), a polygon's a gable or flat
      ...(poly ? { poly } : {}),
      ...(round ? { round: true } : {}),
      ...(b.tower ? { tower: true, ...(b.crenels ? { crenels: true } : {}), ...(b.flatRoof ? { flatRoof: b.flatRoof } : {}) } : {}),
      ...(b.join ? { join: b.join } : {}), // a wing's ends that run into another roof (valleys there, no hip)
      ...(b.cut ? { cut: b.cut } : {}), // hips that start in from their corner, where a flush wing covers it
      // (a row house's stands on its ridge, near one end of it)
      chimney: chimneyOf(b, (b.chimney ?? cc) && !round ? (poly ? ridgeChimney(poly, cx, cy, len, b.rot ?? 0, cv, ci) : { u: 0.3, v: cv ? -0.2 : 0.2, variant: ci }) : null),
      ...(b.name ? { name: b.name } : {}),
      ...(b.use ? { use: b.use } : {}),
      ...(b.grand ? { grand: true } : {}),
      ...(b.rooms ? { rooms: b.rooms } : {}), // its rooms on a battle map, as its plan gives them
      // (its floors above and cellar on a battle map, and their rooms, as its plan gives them)
      ...(b.floors != null ? { floors: b.floors } : {}), ...(b.cellar != null ? { cellar: b.cellar } : {}),
      ...(b.upstairs ? { upstairs: b.upstairs } : {}), ...(b.cellarRooms ? { cellarRooms: b.cellarRooms } : {}),
      // (a battle map's castle works: a wall's tower or gatehouse, built by castle.mjs; a gatehouse's passage across)
      ...(b.works ? { works: b.works } : {}), ...(b.passage ? { passage: b.passage } : {}),
    };
    items.push(item);
    space.buildings.push(item);
    const foot = round ? shapeToPolygon({ circle: [cx, cy, len / 2] }) : poly ?? shapeToPolygon({ rect: [cx - len / 2, cy - dep / 2, cx + len / 2, cy + dep / 2] }, item.rot);
    // (a polygon's grown by a true offset: pushing its corners out from its middle would pull a notch's sides in)
    // (its outer ring: the biggest, as a C closing up around its gap leaves a hole too)
    const kept = poly ? offset([poly], 0.4).reduce((a, p) => (!a || area(p) > area(a) ? p : a), null) ?? grow(foot, 0.4) : grow(foot, 0.4);
    for (const o of [item, foot, kept]) owner.set(o, from);
    space.reserved.push(kept);
    space.plots.push(foot);
    return item;
  }
  function addProp(f, r) {
    const [x, y] = f.at;
    const size = Number.isFinite(f.size) && f.size > 0 ? f.size / sq : null; // across, in squares
    if (f.class === "tree") {
      const species = isConifer(f.species) ? "conifer" : "bare";
      const s = species === "bare" ? 0.5 + r.next() * 0.25 : 0.9 + r.next() * 0.6; // drawn even when its size is given
      // Its size: the crown across (the art is drawn 1.1 times its size, the crown filling about three quarters)
      const sized = size === null ? s : size / ((species === "bare" ? 2.2 * 0.75 : 0.85) * 1.1);
      items.push({ kind: "tree", id: f.id, from: f.id, x, y, species, size: species === "conifer" ? "large" : null, s: sized, rot: r.next() * 360, variant: r.int(8) });
    } else {
      const variant = r.int(8);
      // (a wild one, a rock or a stump, at its own size when the plan gives one, else at the size the woods give theirs;
      // anything else scaled to its size)
      const sized = WILD_PROPS.includes(f.class) ? (size !== null ? { size } : { scale: WILD_SCALE[f.class] ?? 0.8 }) : size !== null ? { scale: size / (PROP_SQUARES[f.class] ?? 0.45) } : PROP_SIZE[f.class] ? { size: PROP_SIZE[f.class] } : {};
      items.push({ kind: "prop", id: f.id, from: f.id, class: f.class, x, y, rot: f.rot ?? 0, variant: Number.isInteger(f.variant) ? f.variant : variant, ...sized });
    }
  }
  progress(0.05, "Fixed features");
  // Where the plan's roads cross its water, for its bridges and fords to sit on
  const overWater = roadWaterCrossings(
    plan.features.filter((f) => f.type === "road" && Array.isArray(f.path)).map((f) => ({ id: f.id, path: f.path, width: ft(f.width) })),
    plan.features.filter((f) => f.type === "water" && Array.isArray(f.path)).map((f) => (f._w ? { id: f.id, path: f.path, width: Math.max(...f._w), widths: f._w } : { id: f.id, path: f.path, width: ft(f.width) })),
  );
  const snapped = snapCrossings(
    plan.features.filter((f) => f.type === "crossing" && Array.isArray(f.at)).map((f) => ({ id: f.id, class: f.class, at: f.at, angle: f.angle, length: ft(f.length), width: ft(f.width) })),
    overWater,
  );
  const ways = []; ctx.ways = ways;
  const parks = []; ctx.parks = parks;
  const bodies = []; ctx.bodies = bodies; // ponds, lakes and seas
  const cliffBands = []; ctx.cliffBands = cliffBands; // { path, half }: the ground each cliff takes
  const winter = seasonOf(plan) === "winter"; ctx.winter = winter;
  // (a stream's or river's ice along its banks, on a battle map in winter unless it's frozen over or its plan says none)
  const shelvesOf = (f, w) => {
    if (!battle || !winter || f.frozen || f.ice === "none" || (f.class === "canal" && f.ice !== "edges")) return {};
    const ice = iceShelves(w, { seed: seedOf(plan, f.id), id: f.id });
    return ice?.shelves.length ? { shelves: ice.shelves, channel: ice.channel } : {};
  };
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
        if (isRunning(f)) {
          if (f._w) {
            // Wider at one end, or opening out into a lake: a width at each point, and the widest for its box
            const width = Math.max(...f._w);
            items.push({ kind: "water", id: f.id, from: f.id, class: f.class, path: f.path, width, widths: f._w, frozen: !!f.frozen, ...shelvesOf(f, { path: f.path, width, widths: f._w }) });
            space.water.push({ path: f.path, clear: width / 2 + 0.225, clears: segClears(f._w, 0.225) });
          } else {
            const width = ft(f.width ?? 60); // a pond, lake or sea along a path is drawn as a river (the checker says so)
            items.push({ kind: "water", id: f.id, from: f.id, class: f.class, path: f.path, width, frozen: !!f.frozen, ...shelvesOf(f, { path: f.path, width }) });
            space.water.push({ path: f.path, clear: width / 2 + 0.225 });
          }
        } else if (f._poly) {
          // A pond, lake or sea: its shore, frozen in winter unless the plan says (a sea never freezes unasked);
          // things keep clear by keep, which a reroll never changes
          const shore = f._shore;
          const reach = SHORE_REACH[shore];
          const frozen = frozenOf(f, winter);
          const item = { kind: "water", id: f.id, from: f.id, class: f.class, poly: f._poly, ring: f._ring, shore, reach, keep: f._keep, frozen, surf: f.class === "sea" && !frozen && !winter };
          items.push(item);
          bodies.push(item);
          space.water.push({ path: f._ring, clear: f._keep + 0.15, body: f._poly });
          space.reserved.push(f._poly);
          space.zones.push(f._poly);
        } else notes.push({ level: "warning", id: f.id, message: `"${f.id}" has no outline to draw.` });
        break;
      case "crossing": {
        const c = snapped.get(f.id) ?? { at: f.at, angle: f.angle, length: ft(f.length), width: ft(f.width), snappedTo: null };
        if (!c.snappedTo) notes.push({ level: "warning", id: f.id, message: `"${f.id}": there's no road over water near it, so it's drawn where the plan puts it.` });
        items.push({ kind: "crossing", id: f.id, from: f.id, class: f.class, at: c.at, angle: c.angle, length: c.length, width: c.width, frozen: !!f.frozen });
        break;
      }
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
        if (f.class === "hedge" || isTownWall(f)) break; // hedges are bushes, placed after the fill; town walls just below
        if (f.class === "cliff") {
          // A cliff: its face from its top edge down to its toe, rubble at its foot; nothing is built or laid on it
          if (!Array.isArray(f.path) || f.path.length < 2) break;
          const c = cliffOf(f, sq, [W, H]);
          const cr = streamFor(f.id), rock = ["earthy", "slate"].includes(f.rock) ? f.rock : cr.fork("rock").chance(0.6) ? "earthy" : "slate";
          items.push({ kind: "cliff", id: f.id, from: f.id, path: c.line, taper: c.taper, toe: c.toe, w: c.w, sign: c.sign, rock, height: f.height ?? 30, variant: cr.fork("look").int(2), top: cr.fork("top").int(4), ...(f.climbDC != null ? { climbDC: f.climbDC } : {}) });
          // (on a battle map it's drawn in tiers of rock, terrain.mjs, so it keeps only their ground clear, its fallen
          // rock lying past them)
          const span = edgeSpan({ drop: Math.max(5, f.height ?? 30), style: "cliff" }) + 0.3;
          const keep = battle ? { path: offsetLine(f.path, (c.sign * span) / 2), half: span / 2 + 0.15 } : c.keep;
          for (const poly of bandPieces(keep.path, keep.half)) { space.reserved.push(poly); space.zones.push(poly); }
          cliffBands.push(keep);
          break;
        }
        items.push({ kind: "wall", id: f.id, from: f.id, class: f.class, path: f.path, height: ft(f.height) });
        break;
      case "prop":
        addProp(f, streamFor(f.id));
        break;
      case "area":
        if (f.class === "yard") {
          const poly = shapeToPolygon(f.shape, f.rot);
          items.push({ kind: "surface", id: f.id, from: f.id, class: "yard", poly, surface: f.surface ?? "trodden", fence: f.fence ?? null });
          space.reserved.push(grow(poly, 0.35));
          space.zones.push(poly);
        } else if (f.class === "trodden") {
          items.push({ kind: "surface", id: f.id, from: f.id, class: "trodden", poly: shapeToPolygon(f.shape, f.rot, 48), surface: "trodden" });
        } else if (f.class === "park" || f.class === "cemetery") {
          parks.push(f); // laid out once every road is known, so its paths can meet them
        } else if (f.class === "hills" || f.class === "mountains" || f.class === "marsh") {
          // (high or wet ground: shaded and contoured, rocks on it; nothing built on a mountain or in a marsh)
          const made = layRelief(f, streamFor(f.id), { sq });
          items.push(...made.items);
          for (const poly of made.reserve) { space.reserved.push(poly); space.zones.push(poly); }
        } else if (f.class !== "farmstead" && f.class !== "woods" && f.class !== "fields" && f.class !== "cave" && f.class !== "dungeon" && !NOT_DRAWN_YET.area.includes(f.class)) {
          notes.push({ level: "warning", id: f.id, message: `"${f.id}": areas of class "${f.class}" aren't drawn yet.` }); // (the checker already says so for a class not drawn yet)
        }
        break;
      default:
        break;
    }
  }
}
