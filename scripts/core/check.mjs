/**
 * Checks a plan before anything is generated, and says what's wrong in plain words. Never guesses: anything it
 * can't use is reported. Each problem is { level: "error" | "warning", id, field, message }. Errors stop a
 * render; warnings don't (the generator falls back or skips). Pure: runs anywhere.
 */
import { underlayOf } from "./underlay.mjs";
import { checkLand, terrainGeometry } from "./land/schema.mjs";
import { extentOf, frameOf } from "./land/units.mjs";
import { PLAN_VERSION, TYPES, PROFILES, SCENE, NOT_DRAWN_YET, SEASONS, STYLES, SURFACES, OUTPUT_LIMITS, isObj, normalize, okJoin, okCut, okChimney } from "./plan.mjs";
import { shapeToPolygon, bbox, pathTouchesPolygon, polygonsOverlap, polygonCrossesItself, distanceToPath, segmentsIntersect, pointInPolygon } from "./geom.mjs";
import { districtGates, gateSpacing } from "./streets/index.mjs";
import { cliffOf, runsOnFace } from "./cliffs.mjs";
import { isTownWall, isClosed, wallReach, towerReach } from "./layout/walls.mjs";
import { parseRooms, ROOM } from "./layout/rooms.mjs";
import { waterEntries, nearWater, okWidths, bodyOf, RUNNING, BODIES } from "./water.mjs";
import { offset, intersect, area as polyArea } from "./lots/poly.mjs";
import { edgeSpan, heightGround, TERRAIN } from "./layout/terrain.mjs";

/** How much two polygons overlap, in square squares (sides lying on one line don't count, whatever the rounding). */
function overlapArea(a, b) {
  try { return intersect([a], [b]).reduce((s, p) => s + polyArea(p), 0); } catch { return 1; }
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isPoint = (p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]);
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
/** A road's width in feet when the plan leaves it out (as plan.mjs defaults it). */
const ROAD_WIDTH_FT = { highway: 30, street: 20, lane: 15, track: 10, path: 5 };
/**
 * A battle map's movable props' length in feet as their art draws them when the plan gives no size, and how wide each
 * is for its length: to tell when one sits on a height's edge or in a building. A sledge lies across the map at a turn
 * of 0, the rest along it.
 */
const PROP_FT = { wagon: 30, cart: 15, sledge: 15, boat: 20, tent: 15, bedroll: 10, horse: 11, mule: 9, ox: 13, barrel: 5, crate: 5 };
const PROP_WIDE = { wagon: 0.5, cart: 0.67, sledge: 0.33, boat: 0.25, tent: 1, bedroll: 0.5, horse: 0.5, mule: 0.5, ox: 0.5, barrel: 1, crate: 1 };
const ACROSS = new Set(["sledge"]);
/** The plan's cliffs with a usable line. */
const cliffsOf = (plan) => plan.features.filter((f) => f.type === "wall" && f.class === "cliff" && Array.isArray(f.path) && f.path.length >= 2 && f.path.every(isPoint));

/**
 * About how much memory painting a map this size takes, in words ("1.2 GB"): the map's canvas, the copy saved from it,
 * and the tiles it's painted in, four bytes a pixel.
 */
export function paintMemory(w, h) {
  const bytes = w * h * 4 * 2.5;
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

export function checkPlan(raw) {
  const out = [];
  const err = (id, field, message) => out.push({ level: "error", id, field, message });
  const warn = (id, field, message) => out.push({ level: "warning", id, field, message });

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    err(null, null, "The plan isn't an object.");
    return out;
  }
  if (raw.atlasScribe !== undefined && raw.atlasScribe !== PLAN_VERSION)
    err(null, "atlasScribe", `This plan is version ${raw.atlasScribe}; this AtlasScribe reads version ${PLAN_VERSION}.`);
  // The containers first: nothing else can be checked if these are the wrong kind
  if (raw.size !== undefined && !isObj(raw.size)) err(null, "size", "size should be an object, like { squares: [100, 100], ftPerSquare: 25 }.");
  else if (raw.size?.squares !== undefined && !Array.isArray(raw.size.squares)) err(null, "size.squares", "size.squares must be two whole numbers above 0, like [100, 100].");
  if (!Array.isArray(raw.features)) err(null, "features", "The plan has no features list: features: [ ... ].");
  if (raw.output !== undefined && !isObj(raw.output)) err(null, "output", "output should be an object, like { pxPerSquare: 50 }.");
  else if (raw.output?.scene !== undefined && !isObj(raw.output.scene)) err(null, "output.scene", "output.scene should be an object.");
  if (raw.seeds !== undefined && !isObj(raw.seeds)) err(null, "seeds", 'seeds should be an object of feature ids and numbers, like { "old-town": 4 }.');
  if (raw.locked !== undefined && !Array.isArray(raw.locked)) err(null, "locked", "locked should be a list of feature ids.");
  if (out.length) return out;

  const plan = normalize(raw);
  // The reference image under the window's sketch: never painted, so a broken one is only a warning
  if (raw.underlay !== undefined && !underlayOf(raw)) warn(null, "underlay", "underlay should be { path, rect: [left, top, right, bottom] } (squares, left less than right, top less than bottom); it's ignored.");
  else if (underlayOf(raw) && /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(underlayOf(raw).path)) warn(null, "underlay", `The underlay's image is outside Foundry's files (${underlayOf(raw).path.split("/")[2] ?? "another site"}); it's fetched from there each time the plan is opened.`);
  // an overland map: a region plan with land (land on another kind of map is ignored)
  const overland = plan.kind === "region" && raw.land !== undefined && raw.land !== null;
  if (plan.kind !== "region" && raw.land !== undefined) warn(null, "land", "land (generated overland terrain) is used only by a region map; it's ignored.");
  // (an overland map's extent comes from its grid: a hex grid's columns and rows aren't its width and height)
  const [w, h] = overland ? extentOf(plan) : plan.size.squares;
  if (!(plan.size.squares.length === 2 && plan.size.squares.every((v) => Number.isInteger(v) && v > 0))) err(null, "size.squares", "size.squares must be two whole numbers above 0, like [100, 100].");
  // Past 100 ft a square a district holds thousands of plots a square and takes minutes to lay out
  if (overland) {
    // an overland map: generated land, cells up to 120 miles
    if (!(isNum(plan.size.ftPerSquare) && plan.size.ftPerSquare >= 500 && plan.size.ftPerSquare <= 633600)) err(null, "size.ftPerSquare", "An overland map's size.ftPerSquare must be a number from 500 to 633600 (feet a cell; 31680 is 6 miles, 633600 is 120 miles).");
    for (const p of checkLand(raw.land)) (p.level === "error" ? err : warn)(null, p.field, p.message);
    // (painted layers cover the context frame: one of another shape would be stretched off it)
    const ls = raw.land?.layers?.size;
    if (Array.isArray(ls) && ls.length === 2 && ls.every((v) => Number.isInteger(v) && v >= 8)) {
      try {
        const fr = frameOf(plan), want = (ls[0] * fr.H) / fr.W;
        if (Math.abs(ls[1] - want) > 1) err(null, "land.layers.size", `land.layers.size [${ls[0]}, ${ls[1]}] isn't the shape of the map and its margin (about ${ls[0]} by ${Math.round(want)}); the layers can't be lined up with the land.`);
      } catch { /* (a size the checks above already report) */ }
    }
  } else if (plan.kind === "region") { if (!(isNum(plan.size.ftPerSquare) && plan.size.ftPerSquare >= 500 && plan.size.ftPerSquare <= 26400)) err(null, "size.ftPerSquare", "A region map's size.ftPerSquare must be a number from 500 to 26400 (feet a square; 2640 is half a mile, 5280 a mile)."); }
  else if (!(isNum(plan.size.ftPerSquare) && plan.size.ftPerSquare >= 1 && plan.size.ftPerSquare <= 100)) err(null, "size.ftPerSquare", "size.ftPerSquare must be a number from 1 to 100 (feet a square; 25 suits a village or town).");
  // (a battle map's walls, rooms, yards and furniture are sized in squares, made for 5 feet each)
  else if (plan.kind === "battle" && plan.size.ftPerSquare !== 5) warn(null, "size.ftPerSquare", `A battle map is made for 5 feet a square: its walls, rooms, yards and furniture are sized in squares, so at ${plan.size.ftPerSquare} feet a square they'd be ${Math.round((plan.size.ftPerSquare / 5) * 10) / 10} times too big. Set Feet a square to 5.`);
  if (!isNum(plan.seed) && !(typeof plan.seed === "string" && plan.seed)) err(null, "seed", "seed must be a number.");
  if (!["settlement", "battle", "region"].includes(plan.kind)) warn(null, "kind", `kind "${plan.kind}" isn't one AtlasScribe knows (settlement, battle, region); it's drawn as a settlement.`);
  for (const [name, values] of [["season", SEASONS], ["style", plan.kind === "region" ? (overland ? ["painted"] : ["region"]) : STYLES], ["ground", SURFACES]])
    if (!values.includes(plan[name])) warn(null, name, `${name} "${plan[name]}" isn't one AtlasScribe knows (${values.join(", ")}); ${name === "season" ? "summer" : name === "style" ? "illustrated" : "a plain fill"} will be used.`);

  // The image: Foundry's grid needs a whole number of pixels, 20 or more; WebP stops at 16383 px a side
  const pps = plan.output.pxPerSquare;
  if (!(Number.isInteger(pps) && pps >= OUTPUT_LIMITS.minPxPerSquare))
    err(null, "output.pxPerSquare", `output.pxPerSquare is ${pps}; it should be a whole number of pixels, ${OUTPUT_LIMITS.minPxPerSquare} or more (Foundry's smallest grid).`);
  else if (Number.isInteger(w) && Number.isInteger(h)) {
    const side = Math.max(w, h) * pps;
    if (side > OUTPUT_LIMITS.maxSide)
      err(null, "output.pxPerSquare", `The map would be ${w * pps} by ${h * pps} px; images can't be more than ${OUTPUT_LIMITS.maxSide} px a side. Use fewer pixels per square (at most ${Math.floor(OUTPUT_LIMITS.maxSide / Math.max(w, h))}).`);
    else if (side > OUTPUT_LIMITS.warnSide)
      warn(null, "output.pxPerSquare", `The map will be ${w * pps} by ${h * pps} px. Some graphics cards can't show a scene background over ${OUTPUT_LIMITS.warnSide} px a side, and painting it takes about ${paintMemory(w * pps, h * pps)} of memory.${plan.output.format === "webp" ? " Saving it as WebP takes a while; JPEG (Image file) saves several times faster." : ""}`);
  }
  if (!(isNum(plan.output.quality) && plan.output.quality > 0 && plan.output.quality <= 1)) err(null, "output.quality", `output.quality is ${plan.output.quality}; it should be a number above 0, up to 1.`);
  if (!["auto", "webp", "jpeg"].includes(plan.output.format)) warn(null, "output.format", `output.format "${plan.output.format}" isn't one AtlasScribe saves; it should be "auto", "webp" or "jpeg". It's saved as WebP.`);
  if (raw.output?.dressing !== undefined && typeof raw.output.dressing !== "boolean") warn(null, "output.dressing", `output.dressing should be true or false; it's left off.`);
  else if (raw.output?.dressing === true && STYLES.includes(plan.style) && plan.style === "textured") warn(null, "output.dressing", `Map dressing is drawn only in the illustrated and ink styles; this map is ${plan.style}.`);
  if (overland && raw.output?.places !== undefined && typeof raw.output.places !== "boolean") warn(null, "output.places", `output.places should be true or false; the places and roads are shown.`);
  for (const k of Object.keys(raw.output ?? {})) if (!["pxPerSquare", "format", "quality", "scene", "dressing", ...(overland ? ["grid", "places"] : [])].includes(k)) warn(null, `output.${k}`, `output has a field "${k}" that AtlasScribe doesn't use.`);
  // (an overland map's grid sets its extent: hex columns overlap, so a wrong value would change the map's size)
  if (overland && raw.output?.grid !== undefined && !["square", "hex"].includes(raw.output.grid)) err(null, "output.grid", `output.grid must be "square" or "hex" (lowercase); "${raw.output.grid}" isn't one.`);

  // A plan so big it takes minutes to lay out (C2): said before it's drawn, with how long, as near as can be told
  const plots = estimatePlots(plan);
  if (plots > BIG_PLOTS) warn(null, "size", `This plan has about ${(Math.round(plots / 1000) * 1000).toLocaleString()} plots to build on: laying it out takes about ${minutesFor(plots)}, and painting it longer. A smaller map, fewer districts or fewer feet a square make it quicker.`);

  // Ids: present, simple, unique
  const seen = new Map();
  plan.features.forEach((f, i) => {
    const where = f?.id ?? `feature ${i + 1}`;
    if (!isObj(raw.features[i])) return err(null, `features[${i}]`, `Feature ${i + 1} isn't an object.`);
    if (!f.id) err(null, `features[${i}]`, `Feature ${i + 1} (${f.type ?? "no type"}) has no id.`);
    else if (!ID.test(f.id)) err(f.id, "id", `The id "${f.id}" should use only letters, digits, - and _.`);
    else if (seen.has(f.id)) err(f.id, "id", `The id "${f.id}" is used twice.`);
    else seen.set(f.id, f);
    checkFeature(f, where, raw.features?.[i] ?? {}, { err, warn, w, h, overland });
    // (a rise or a hollow is drawn on a battle map only: a settlement map's squares are too big for one)
    if (f?.type === "place" && plan.kind !== "region") warn(f.id ?? null, "type", `"${where}" is a place, which only a region map draws; it's left off this map.`);
    if (f?.type === "height" && plan.kind !== "battle") warn(f.id ?? null, "type", `"${where}" is a rise or hollow, which only a battle map draws; it's left off this map.`);
    if ((f?.type === "light" || f?.type === "region" || f?.type === "trail" || f?.type === "tether") && plan.kind !== "battle") warn(f.id ?? null, "type", `"${where}" is a ${f.type}, which only a battle map places; it's left off this map.`);
    if (f?.type === "light" && typeof f.color === "string" && !/^#[0-9a-f]{6}$/i.test(f.color)) warn(f.id ?? null, "color", `"${where}": color "${f.color}" should be a color like #ffc56b; a lantern's warm yellow will be used.`);
    if (f?.type === "light" && Number.isFinite(f.bright) && Number.isFinite(f.dim) && f.dim < f.bright) warn(f.id ?? null, "dim", `"${where}": its dim light (${f.dim} ft) is less than its bright light (${f.bright} ft); it will reach as far as its bright light.`);
    if (f?.type === "road" && f.sunken != null && f.class === "street") warn(f.id ?? null, "sunken", `"${where}" is a street, whose houses front it at the ground's level, so it isn't sunken; make it a lane, track or road to sink it.`);
    else if (f?.type === "road" && f.sunken != null && plan.kind !== "battle") warn(f.id ?? null, "sunken", `"${where}" is sunken, which only a battle map draws; it's drawn at the ground's level here.`);
  });

  // Districts: a known profile, and a way in: a road into it, or a street from a neighboring district through a gate
  // on the side they share (a hamlet makes no streets of its own, so it needs a road)
  const ways = plan.features.filter((f) => f.type === "road" && isPath(f.path));
  const dfeats = plan.features.filter((f) => f.type === "district" && f.id);
  const quays = plan.features.filter((f) => f.type === "dock" && (f.class === "quay" || f.class === "wharf") && isPath(f.path)); // houses front a quay as they do a road
  let gates = null;
  const gatesOf = (id) => {
    if (!gates) {
      const sq = isNum(plan.size.ftPerSquare) && plan.size.ftPerSquare > 0 ? plan.size.ftPerSquare : 25;
      const list = dfeats.map((d) => { try { return { id: d.id, poly: shapeToPolygon(d.shape), ...gateSpacing(d, sq) }; } catch { return null; } }).filter((d) => d && d.poly.length >= 3);
      // As the layout places them: none on a side that lies in water
      const sqw = isNum(plan.size.ftPerSquare) && plan.size.ftPerSquare > 0 ? plan.size.ftPerSquare : 25;
      const ws = waterEntries(plan);
      const inWater = (x, y) => ws.some((w) => nearWater([x, y], w));
      // and none through a town wall (only roads pass it)
      const wb = plan.features.filter((f) => isTownWall(f) && f.path.every(isPoint)).map((f) => ({ path: f.path, half: wallReach(f, sqw) }));
      // (nor on a cliff)
      for (const f of cliffsOf(plan)) wb.push(cliffOf(f, sqw).keep);
      const blocked = (x, y) => inWater(x, y) || wb.some((b) => distanceToPath([x, y], b.path) < b.half);
      try { gates = districtGates(list, { roads: ways, inWater: blocked, seed: isNum(plan.seed) ? plan.seed : 1 }); } catch { gates = new Map(); }
    }
    return gates.get(id) ?? [];
  };
  for (const d of dfeats) {
    if (!PROFILES.includes(d.profile)) err(d.id, "profile", `District "${d.id}" uses the profile "${d.profile}", which this version doesn't know (it knows: ${PROFILES.join(", ")}).`);
    let poly = [];
    try { poly = shapeToPolygon(d.shape); } catch { poly = []; }
    if (poly.length < 3 || [...ways, ...quays].some((r) => pathTouchesPolygon(r.path, poly)) || gatesOf(d.id).length) continue;
    const hamlet = d.profile === "hamlet" || d.profile === "roadside";
    warn(d.id, "shape", hamlet
      ? `District "${d.id}" is a hamlet with no road or lane running into it, and a hamlet builds only along roads, so nothing will be built there.`
      : `District "${d.id}" has no road or lane running into it and shares no side with another district's streets, so nothing will be built along streets there.`);
  }

  // Town walls and palisades: a closed one no road crosses has no gate; one that crosses itself has no clear outside;
  // a road running along one would have its towers standing in it
  for (const f of plan.features.filter((f) => isTownWall(f) && f.path.every(isPoint))) {
    const crosses = (r) => r.path.some((p, i) => i && f.path.some((q, j) => j && segmentsIntersect(r.path[i - 1], p, f.path[j - 1], q)));
    if (isClosed(f.path)) {
      if (!ways.some(crosses)) warn(f.id, "path", `"${f.id}" is a closed wall with no road crossing it, so it has no gate. Run a road through it where a gate should be.`);
      if (f.path.length >= 4 && polygonCrossesItself(f.path.slice(0, -1))) warn(f.id, "path", `"${f.id}" crosses itself, so its inside and outside are unclear (it gets no ditch or moat). Give its points in order around it.`);
    }
    const sq = isNum(plan.size.ftPerSquare) && plan.size.ftPerSquare > 0 ? plan.size.ftPerSquare : 25;
    const near = Math.max((isNum(f.thickness) ? f.thickness : 12) / sq / 2 + 0.3, towerReach(f, sq) + 0.02); // where towers would stand in it
    const wb = f.path.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
    for (const r of ways) {
      const rh = (isNum(r.width) ? r.width : 20) / sq / 2;
      // (a road nowhere near the wall can't run along it)
      const m = rh + near + 0.5, rb = r.path.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
      if (rb[2] < wb[0] - m || rb[0] > wb[2] + m || rb[3] < wb[1] - m || rb[1] > wb[3] + m) continue;
      // Points every half square along the road that lie on the wall, away from where it crosses
      let run = 0, best = 0;
      for (let i = 1; i < r.path.length; i++) {
        const [a, b] = [r.path[i - 1], r.path[i]], l = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(l / 0.5));
        for (let k = 0; k < n; k++) {
          const q = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
          const inBox = q[0] >= wb[0] - m && q[0] <= wb[2] + m && q[1] >= wb[1] - m && q[1] <= wb[3] + m;
          run = inBox && distanceToPath(q, f.path) < rh + near ? run + l / n : 0;
          best = Math.max(best, run);
        }
      }
      // Longer than any crossing, however slanting
      if (best > (2 * (rh + near)) / 0.25) { warn(f.id, "path", `Road "${r.id}" runs along "${f.id}" rather than through it; its towers there are left out. Move the wall or the road apart.`); break; }
    }
  }

  // Boats and ships afloat: one drawn on dry land is said so (the layout draws it where it's put)
  {
    const afloat = plan.features.filter((f) => f.type === "prop" && (f.class === "boat" || f.class === "ship") && isPoint(f.at));
    if (afloat.length) {
      const ws = waterEntries(plan, 0);
      for (const f of afloat) if (!ws.some((w) => nearWater(f.at, w, 0.3))) warn(f.id, "at", `The ${f.class} "${f.id}" stands on dry land. Move it onto the water.`);
    }
  }

  // Cliffs: long enough to read as one, and no road climbs one
  // (anywhere on its face: across it or along it; a road ending at its top edge is fine)
  for (const f of cliffsOf(plan)) {
    if (f.path.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - f.path[i][0], p[1] - f.path[i][1]), 0) < 0.5) { warn(f.id, "path", `The cliff "${f.id}" is under half a square long, too short to read as a cliff. Give it points farther apart.`); }
    const c = cliffOf(f, isNum(plan.size.ftPerSquare) && plan.size.ftPerSquare > 0 ? plan.size.ftPerSquare : 25, Array.isArray(plan.size.squares) ? plan.size.squares : null);
    for (const r of ways) if (r.path.every(isPoint) && runsOnFace(r.path, c, (isNum(r.width) ? r.width : ROAD_WIDTH_FT[r.class] ?? 20) / (isNum(plan.size.ftPerSquare) && plan.size.ftPerSquare > 0 ? plan.size.ftPerSquare : 25) / 2)) warn(f.id, "path", `Road "${r.id}" runs over the cliff "${f.id}", and no road can climb a cliff. Bring the road around its end, or end the cliff short of the road.`);
  }

  // Districts and areas drawn as a list of points that cross themselves (a closing point equal to the first is fine)
  for (const f of plan.features.filter((f) => (f.type === "district" || f.type === "area" || f.type === "region") && Array.isArray(f.shape) && f.shape.every(isPoint))) {
    const pts = f.shape.filter((p, k) => !(k === f.shape.length - 1 && k > 0 && p[0] === f.shape[0][0] && p[1] === f.shape[0][1]));
    if (pts.length >= 3 && polygonCrossesItself(pts)) warn(f.id, "shape", `"${f.id}"'s outline crosses itself or repeats a corner, so what's inside it is unclear. Give its corners in order around the edge.`);
  }

  // Districts that overlap: the shared part is filled by both, so their houses stand on each other's
  // (each drawn in a little first, along its own outline, so neighbors sharing a side don't count, whatever their
  // shape: drawing in toward the middle of the box around it would push a bent district's far side out)
  // (a shape that can't be read is reported with its feature already, and left out here)
  const safePoly = (shape, rot) => { try { return shapeToPolygon(shape, rot) ?? []; } catch { return []; } };
  const dpolys = plan.features.filter((f) => f.type === "district").map((d) => ({ id: d.id, poly: safePoly(d.shape) })).filter((d) => d.poly.length >= 3)
    .map((d) => { let inner; try { inner = offset([d.poly], -0.03); } catch { inner = null; } return { ...d, inner: inner?.length ? inner : [shrink(d.poly)], box: bbox(d.poly) }; });
  const meets = (a, b) => a.box[0] <= b.box[2] && b.box[0] <= a.box[2] && a.box[1] <= b.box[3] && b.box[1] <= a.box[3];
  for (let i = 0; i < dpolys.length; i++)
    for (let j = i + 1; j < dpolys.length; j++)
      if (meets(dpolys[i], dpolys[j]) && dpolys[i].inner.some((a) => dpolys[j].inner.some((b) => polygonsOverlap(a, b) && overlapArea(a, b) > 0.02)))
        warn(dpolys[i].id, "shape", `Districts "${dpolys[i].id}" and "${dpolys[j].id}" overlap. They can share an edge, but where they overlap both build, and their houses stand on each other's.`);

  // Buildings that overlap each other
  const footprints = [];
  for (const f of plan.features) {
    if (f.type === "building" && f.shape) footprints.push({ id: f.id, poly: safePoly(f.shape, f.rot) });
    if (f.type === "landmark") f.buildings.forEach((b, j) => b?.shape && footprints.push({ id: `${f.id}`, part: j, poly: safePoly(b.shape, b.rot) }));
  }
  // Shrunk once each, sorted by left edge, and only pairs whose boxes meet are compared (fast for thousands)
  const fps = footprints.filter((f) => f.poly.length >= 3).map((f) => { const poly = shrink(f.poly); return { ...f, poly, box: bbox(poly) }; });
  fps.sort((a, b) => a.box[0] - b.box[0]);
  for (let i = 0; i < fps.length; i++) {
    const a = fps[i];
    for (let j = i + 1; j < fps.length && fps[j].box[0] <= a.box[2]; j++) {
      const b = fps[j];
      if (a.id === b.id) continue; // parts of one landmark may touch
      if (b.box[1] > a.box[3] || b.box[3] < a.box[1]) continue;
      if (polygonsOverlap(a.poly, b.poly)) warn(a.id, "shape", `"${a.id}" overlaps "${b.id}".`);
    }
  }

  // A battle map's props on a height's edge (a rise's or hollow's face, a sunken road's banks: a tile stands at one
  // height, and art on a face looks dropped there) or reaching into a building, each as a line along its length
  // turned by its rot, half its width either side. A face lies on an edge's low side, as wide as the layout draws it
  // (edgeSpan); a walkable slope is left alone.
  if (plan.kind === "battle") {
    const sq = isNum(plan.size.ftPerSquare) && plan.size.ftPerSquare > 0 ? plan.size.ftPerSquare : 5;
    // (the ground the layout makes of the rises and hollows: touching ones of one height joined, each side with its own
    // edge where a stretch gives one)
    let ground = [];
    try { ground = heightGround(plan); } catch { ground = []; }
    const rises = ground.map((G) => ({ id: G.f.id, h: G.h, style: G.style, styles: G.styles, rings: G.rings.filter((r) => r.length >= 3), low: G.h >= 0 ? 1 : -1 })).filter((G) => G.rings.length);
    const cuts = plan.features.filter((f) => f.type === "road" && f.class !== "street" && isNum(f.sunken) && f.sunken > 0 && Array.isArray(f.path) && f.path.length >= 2 && f.path.every(isPoint)).map((f) => {
      const style = f.sunken <= TERRAIN.tier ? "bank" : "cliff";
      return { id: f.id, path: f.path, half: (isNum(f.width) ? f.width : ROAD_WIDTH_FT[f.class] ?? 10) / sq / 2, span: edgeSpan({ drop: f.sunken, style }) + 0.05 };
    });
    const houses = fps;
    // (an interval [a, b] widened by w meeting the open band (lo, hi))
    const meets = (a, b, w, lo, hi) => a - w < hi && b + w > lo;
    for (const f of plan.features.filter((f) => f.type === "prop" && isPoint(f.at) && ((isNum(f.size) && f.size > 0) || f.class in PROP_FT))) {
      const len = (isNum(f.size) && f.size > 0 ? f.size : PROP_FT[f.class]) / sq, half = (len * (PROP_WIDE[f.class] ?? 0.4)) / 2;
      const a = (((isNum(f.rot) ? f.rot : 0) + (ACROSS.has(f.class) ? 90 : 0)) * Math.PI) / 180, u = [-Math.sin(a), Math.cos(a)];
      const pts = [-0.5, -0.25, 0, 0.25, 0.5].map((k) => [f.at[0] + u[0] * len * k, f.at[1] + u[1] * len * k]);
      const name = `The ${f.class} "${f.id}"`;
      // (each point's distance past the ground's outline toward its low side, negative on the high side, with the edge
      // of the side it's nearest; a point by a walkable slope doesn't count)
      const onFace = (G) => {
        const ds = [];
        for (const p of pts) {
          let best = Infinity, style = G.style, inside = 0;
          G.rings.forEach((ring, k) => {
            if (pointInPolygon(p, ring)) inside++;
            for (let i = 0; i < ring.length; i++) {
              const d = distanceToPath(p, [ring[i], ring[(i + 1) % ring.length]]);
              if (d < best) { best = d; style = G.styles?.[k]?.[i] ?? G.style; }
            }
          });
          if (style === "slope") continue;
          ds.push({ d: (inside % 2 ? -best : best) * G.low, span: edgeSpan({ drop: G.h, style }), style });
        }
        const hit = ds.find((x) => x.d > -half && x.d < x.span + half) ?? (ds.some((x) => x.d <= 0) && ds.some((x) => x.d >= x.span) ? ds[0] : null);
        return hit ? { id: G.id, style: hit.style } : null;
      };
      let h = null;
      for (const G of rises) if ((h = onFace(G))) break;
      if (h) warn(f.id, "at", `${name} sits on the edge of "${h.id}", partly on its ${h.style === "bank" ? "bank" : "cliff"}. Move it onto the ground above or below.`);
      else {
        const c = cuts.find((r) => { const d = pts.map((p) => distanceToPath(p, r.path)); return meets(Math.min(...d), Math.max(...d), half, r.half, r.half + r.span); });
        if (c) warn(f.id, "at", `${name} sits on the bank of the sunken road "${c.id}". Move it into the road or onto the ground beside it.`);
      }
      const b = houses.find((r) => pts.some((p) => pointInPolygon(p, r.poly)));
      if (b) warn(f.id, "at", `${name} reaches into "${b.id}": it's too long for where it stands. Move it clear, turn it, or make it shorter.`);
    }
  }

  // Seeds and locks must point at something
  for (const [id, v] of Object.entries(plan.seeds ?? {})) {
    if (!seen.has(id)) warn(id, "seeds", `There's a seed for "${id}", but no feature with that id.`);
    else if (!isNum(v)) warn(id, "seeds", `The seed for "${id}" isn't a number, so the plan's seed is used.`);
  }
  for (const id of plan.locked ?? []) if (!seen.has(id)) warn(id, "locked", `"${id}" is locked, but there's no feature with that id.`);
  // A name label must follow a district or area that's there
  for (const f of plan.features) {
    if (f?.type !== "label" || !f.of) continue;
    const owner = plan.features.find((g) => g?.id === f.of);
    if (!owner) warn(f.id, "of", `Label "${f.id}" names "${f.of}", but there's no feature with that id, so it isn't shown.`);
    else if (owner.type !== "district" && owner.type !== "area" && owner.type !== "landmark" && owner.type !== "place") warn(f.id, "of", `Label "${f.id}" names "${f.of}", a ${owner.type}; only districts, areas, landmarks and places can carry their name, so it isn't shown.`);
  }

  // The scene it's published to
  const scene = raw.output?.scene;
  if (scene) {
    for (const [name, spec] of Object.entries(SCENE)) checkField(null, `output.scene.${name}`, "output.scene", name, spec, scene[name], { err, warn }, "the default will be used");
    for (const k of Object.keys(scene)) if (!(k in SCENE)) warn(null, `output.scene.${k}`, `output.scene has a field "${k}" that AtlasScribe doesn't use.`);
    if (typeof scene.labelColor === "string" && !/^#[0-9a-f]{6}$/i.test(scene.labelColor))
      warn(null, "output.scene.labelColor", `output.scene.labelColor "${scene.labelColor}" should be a color like #13202e; the default will be used.`);
  }

  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
}

/** Pulls a polygon in slightly toward its center, so shapes that only touch don't count as overlapping. */
function shrink(poly, by = 0.02) {
  const [x0, y0, x1, y1] = bbox(poly);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return poly.map(([x, y]) => [x + (cx - x) * by, y + (cy - y) * by]);
}

function checkFeature(f, where, raw, { err, warn, w, h, overland = false }) {
  const t = TYPES[f.type];
  if (!t) return err(f.id ?? null, "type", `"${where}" has the type "${f.type}", which AtlasScribe doesn't know (types: ${Object.keys(TYPES).join(", ")}).`);
  if (t.classes && raw.class !== undefined && !t.classes.includes(raw.class))
    warn(f.id, "class", `"${where}" is a ${f.type} of class "${raw.class}", which AtlasScribe doesn't know (${t.classes.join(", ")}); it will be drawn as a ${t.classes[0]}.`);
  else if (NOT_DRAWN_YET[f.type]?.includes(f.class))
    warn(f.id, "class", `"${where}": ${f.type}s of class "${f.class}" aren't drawn yet; it stays in the plan but won't appear on the map.`);

  const g = t.geometry;
  const need = (ok, field, message) => (ok ? true : (err(f.id, field, message), false));
  if (g === "point" && !(f.type === "label" && typeof f.of === "string" && f.of)) need(isPoint(f.at), "at", `"${where}" needs a position: at: [x, y]${f.type === "label" ? " (or of: the id of the district, area or landmark it names)" : ""}.`);
  if (g === "path") need(isPath(f.path), "path", `"${where}" needs a path of two or more points: path: [[x, y], [x, y], ...].`);
  if (g === "shape") checkShape(f.shape, where, "shape", need);
  if (g === "path|shape") {
    if (f.path !== undefined) need(isPath(f.path), "path", `"${where}" has a path that isn't two or more [x, y] points.`);
    else checkShape(f.shape, where, "shape", need);
  }
  if (g === "terrain") {
    const tg = terrainGeometry(f.class);
    if (tg === "path") need(isPath(f.path), "path", `"${where}" is a range: it needs a spine, path: [[x, y], [x, y], ...].`);
    else if (tg === "point") need(isPoint(f.at), "at", `"${where}" is a peak: it needs a position, at: [x, y].`);
    else checkShape(f.shape, where, "shape", need);
    if (!overland) warn(f.id, "type", `"${where}" is painted terrain, which only an overland map (a region plan with land) uses; it's ignored.`);
  }
  if (g === "buildings") {
    if (need(Array.isArray(raw.buildings) && raw.buildings.length > 0, "buildings", `Landmark "${where}" needs a list of buildings.`))
      f.buildings.forEach((b, j) => checkShape(b.shape, `${where}, building ${j + 1}`, `buildings[${j}].shape`, need, MIN_PART));
  }

  // Water: a stream, river or canal runs along a path and a pond, lake or sea is a shape; its widths, one a point
  if (f.type === "water") {
    if (Array.isArray(f.path) && BODIES.includes(f.class)) warn(f.id, "class", `"${where}" is a ${f.class} drawn along a path, so it's drawn as a river. Give a ${f.class} a shape instead.`);
    if (!Array.isArray(f.path) && f.shape && RUNNING.includes(f.class)) warn(f.id, "class", `"${where}" is a ${f.class} drawn as a shape, so it's drawn as a lake. Give a ${f.class} a path instead.`);
    if (!Array.isArray(f.path) && f.shape && checkShape(f.shape, where, "shape", (ok) => ok) && !bodyOf(f, { W: w, H: h, seed: 1 }))
      warn(f.id, "shape", `"${where}" has nothing left to draw once its corners near the map's edge are moved onto it. Draw it farther from the edge.`);
    if (raw.widths != null && !(Array.isArray(f.path) && okWidths(raw.widths, f.path.length)))
      warn(f.id, "widths", `"${where}": widths should be a list with one width in feet (1 to 2,000) for each point of its path; it's ignored.`);
  }

  // A pinned building's drawing details, as the generator writes them (anything else is left out, with a warning)
  const details = (b, at) => {
    if (b.join != null && !okJoin(b.join)) warn(f.id, "join", `${at}: join isn't as AtlasScribe writes it, so it's left out.`);
    if (b.cut != null && !okCut(b.cut)) warn(f.id, "cut", `${at}: cut isn't as AtlasScribe writes it, so it's left out.`);
    if (b.chimneyAt != null && !okChimney(b.chimneyAt)) warn(f.id, "chimneyAt", `${at}: chimneyAt isn't as AtlasScribe writes it, so it's left out.`);
    // (a building's rooms past the first few aren't laid out: each one more makes the split much slower)
    if (b.rooms != null) { const n = parseRooms(b.rooms).rooms.length; if (n > ROOM.most) warn(f.id, "rooms", `${at} names ${n} rooms; the first ${ROOM.most} are laid out and the rest left out.`); }
  };
  if (f.type === "building") details(raw, `"${where}"`);
  if (f.type === "landmark" && Array.isArray(raw.buildings)) raw.buildings.forEach((b, j) => isObj(b) && details(b, `"${where}", building ${j + 1}`));
  // A landmark's buildings take a building's settings (roof, use, height...), checked as one's are
  if (f.type === "landmark" && Array.isArray(raw.buildings)) raw.buildings.forEach((b, j) => {
    if (!isObj(b)) return;
    for (const [name, spec] of Object.entries(TYPES.building.fields)) checkField(f.id, `buildings[${j}].${name}`, `"${where}", building ${j + 1}`, name, spec, b[name], { err, warn });
    for (const k of Object.keys(b)) if (k !== "shape" && !Object.hasOwn(TYPES.building.fields, k)) warn(f.id, `buildings[${j}].${k}`, `"${where}", building ${j + 1} has a field "${k}" that AtlasScribe doesn't use.`);
  });

  // Fields: numbers in range, values from their lists, nothing unknown
  for (const [name, spec] of Object.entries(t.fields)) {
    checkField(f.id, name, `"${where}"`, name, spec, f[name], { err, warn }, f.type === "label" ? "the default will be used" : undefined);
    // (a setting only some classes use, given to another: nothing reads it)
    if (Array.isArray(spec.only) && t.classes?.includes(f.class) && !spec.only.includes(f.class) && raw[name] !== undefined && raw[name] !== null)
      warn(f.id, name, `"${where}": ${name} does nothing on a ${f.type} of class ${f.class}, so it's ignored.`);
  }
  // (a height's stretches count its outline's points: only an outline given as points has them, and each must exist)
  if (f.type === "height" && Array.isArray(f.edges) && f.edges.length) {
    const n = Array.isArray(f.shape) && f.shape.every(isPoint) ? f.shape.length : 0;
    if (!n) warn(f.id, "edges", `"${where}": its edges stretches count the outline's points, and its outline isn't given as points; they're left out.`);
    else for (const x of f.edges) if (isObj(x) && (x.from >= n || x.to >= n)) warn(f.id, "edges", `"${where}": a stretch from point ${x.from} to ${x.to} names a point its outline doesn't have (it has ${n}, numbered 0 to ${n - 1}); that stretch is left out.`);
  }
  if (f.type === "label" && !String(f.text ?? "").trim() && !f.of) warn(f.id, "text", `Label "${where}" has no text.`);
  if (f.type === "label" && typeof f.font === "string" && f.font.trim() && !/^[\p{L}\p{N} _.-]+$/u.test(f.font.trim())) warn(f.id, "font", `Label "${where}": the font "${f.font}" isn't a plain font name; the plan's will be used.`);
  if (f.type === "label" && typeof f.color === "string" && !/^#[0-9a-f]{6}$/i.test(f.color)) warn(f.id, "color", `Label "${where}": color "${f.color}" should be a color like #13202e; the plan's will be used.`);
  const known = new Set(["id", "type", "class", "at", "path", "shape", "buildings", "note", ...Object.keys(t.fields)]);
  for (const k of Object.keys(raw)) if (!known.has(k)) warn(f.id, k, `"${where}" has a field "${k}" that AtlasScribe doesn't use.`);

  // Far off the map: wholly off it, it's left out; reaching far past it, laying it out would take too long
  let pts = [];
  try { pts = f.at ? [f.at] : f.path ?? (f.shape ? shapeToPolygon(f.shape) : []); } catch { pts = []; }
  if (Array.isArray(pts) && pts.length && pts.every(isPoint) && w > 0 && h > 0) {
    const [x0, y0, x1, y1] = bbox(pts);
    // How far past the edge: a district fills all of its shape with streets and plots, so it's held close; an area
    // less so; a road, river or wall just runs on (only one absurdly long would be too many points to curve)
    const big = Math.max(w, h);
    const far = f.type === "district" ? Math.ceil(Math.max(10, big / 4)) : f.type === "area" ? Math.max(20, big) : 10 * big;
    const mx = w * 0.1, my = h * 0.1;
    if (x1 < -mx || y1 < -my || x0 > w + mx || y0 > h + my) warn(f.id, "position", `"${where}" is entirely off the map.`);
    else if (x0 < -far || y0 < -far || x1 > w + far || y1 > h + far) err(f.id, "position", `"${where}" reaches far past the edge of the map. Bring it within ${far} squares of the edge (only what's on the map is drawn).`);
  }
}

/** One field against its spec: numbers in range, the right kind, values from their list. */
function checkField(id, field, where, name, spec, v, { err, warn }, fallback = "a plain fill will stand in") {
  if (v === null || v === undefined) return;
  if (spec.kind === "number") {
    if (!isNum(v)) err(id, field, `${where}: ${name} should be a number${spec.unit ? ` (${spec.unit})` : ""}.`);
    else if ((spec.min !== undefined && v < spec.min) || (spec.max !== undefined && v > spec.max))
      err(id, field, `${where}: ${name} is ${v}; it should be ${spec.max !== undefined ? `${spec.min} to ${spec.max}` : `at least ${spec.min}`}.`);
    else if (spec.integer && !Number.isInteger(v)) err(id, field, `${where}: ${name} is ${v}; it should be a whole number.`);
  } else if (spec.kind === "point" && !isPoint(v)) err(id, field, `${where}: ${name} should be a point, [x, y].`);
  else if (spec.kind === "boolean" && typeof v !== "boolean") err(id, field, `${where}: ${name} should be true or false.`);
  else if (spec.kind === "string" && typeof v !== "string") err(id, field, `${where}: ${name} should be text.`);
  else if (spec.kind === "list") {
    if (!Array.isArray(v)) err(id, field, `${where}: ${name} should be a list, like ["${spec.values[0]}", "${spec.values[1]}"].`);
    else for (const x of v) if (!spec.values.includes(x)) warn(id, field, `${where}: ${name} has "${x}", which AtlasScribe doesn't know (${spec.values.join(", ")}); it's left out.`);
  } else if (spec.kind === "stretches") {
    const bad = !Array.isArray(v) || v.some((x) => !isObj(x) || !Number.isInteger(x.from) || !Number.isInteger(x.to) || x.from < 0 || x.to < 0);
    if (bad) err(id, field, `${where}: ${name} should be a list like [{ "from": 3, "to": 5, "edge": "slope" }], from and to the outline's point numbers (from 0).`);
    else for (const x of v) if (!spec.values.includes(x.edge)) warn(id, field, `${where}: ${name} has an edge "${x.edge}" that AtlasScribe doesn't know (${spec.values.join(", ")}); that stretch keeps the shape's own edge.`);
  } else if (spec.kind === "enum" && !spec.values.includes(v))
    warn(id, field, `${where}: ${name} "${v}" isn't one AtlasScribe knows (${spec.values.join(", ")}); ${spec.fallback ?? fallback}.`);
}

function isPath(p) {
  return Array.isArray(p) && p.length >= 2 && p.every(isPoint);
}

/** Past this many plots a plan's checker warns how long it will take (C2). */
export const BIG_PLOTS = 15000;
/** Plots a square at 25 ft a square, by a district's profile (measured on Quick Start's maps), and the time a plot takes. */
const PLOTS_PER_SQUARE = { city: 0.25, town: 0.14, village: 0.07, hamlet: 0.04 };
const MS_PER_PLOT = 3;

/** About how many plots a plan's districts hold: their area in square feet, by their profiles. */
export function estimatePlots(plan) {
  const k = ((Number(plan?.size?.ftPerSquare) || 25) / 25) ** 2;
  let n = 0;
  for (const f of plan?.features ?? []) {
    if (f?.type !== "district") continue;
    let poly = [];
    try { poly = shapeToPolygon(f.shape) ?? []; } catch { poly = []; }
    // (cut to the map and a margin, as the layout fills a district reaching far past it)
    const [W, H] = plan?.size?.squares ?? [Infinity, Infinity];
    if (Number.isFinite(W) && Number.isFinite(H)) for (const [axis, lim, keep] of [[0, -8, (v) => v >= -8], [0, W + 8, (v) => v <= W + 8], [1, -8, (v) => v >= -8], [1, H + 8, (v) => v <= H + 8]]) {
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length], pin = keep(p[axis]), qin = keep(q[axis]);
        if (pin) out.push(p);
        if (pin !== qin) { const t = (lim - p[axis]) / (q[axis] - p[axis]); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
      }
      poly = out;
    }
    let a = 0;
    for (let i = 0; i < poly.length; i++) { const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length]; a += x0 * y1 - x1 * y0; }
    n += (Math.abs(a) / 2) * k * (PLOTS_PER_SQUARE[OLD_PROFILE_OF(f.profile)] ?? PLOTS_PER_SQUARE.village);
  }
  return Math.round(n);
}
const OLD_PROFILE_OF = (p) => ({ roadside: "hamlet", core: "city" })[p] ?? p;
/** A layout's time in words for a number of plots. */
const minutesFor = (plots) => { const m = (plots * MS_PER_PLOT) / 60000; return m < 1.5 ? "a minute" : `${Math.round(m)} minutes`; };

/** The smallest a shape may be across, in squares (its area at least this squared). */
const MIN_SIZE = 0.1;
/** A landmark's part may be smaller (a pinned house's dormer is a sliver of roof): a fiftieth of a square. */
const MIN_PART = 0.02;

function checkShape(shape, where, field, need, MIN_SHAPE = MIN_SIZE) {
  const big = (ok) => need(ok, field, `"${where}" is too small to draw: make it at least ${MIN_SHAPE} of a square across.`);
  if (Array.isArray(shape)) {
    if (!need(shape.length >= 3 && shape.every(isPoint), field, `"${where}" has a polygon that needs three or more [x, y] points.`)) return false;
    let a = 0;
    for (let i = 0; i < shape.length; i++) { const [x1, y1] = shape[i], [x2, y2] = shape[(i + 1) % shape.length]; a += x1 * y2 - x2 * y1; }
    const xs = shape.map((p) => p[0]), ys = shape.map((p) => p[1]);
    // An outline that crosses itself has halves whose areas cancel: its size is judged by its extent alone (the
    // crossing is warned about separately)
    return big((polygonCrossesItself(shape) || Math.abs(a / 2) >= MIN_SHAPE * MIN_SHAPE) && Math.max(...xs) - Math.min(...xs) >= MIN_SHAPE && Math.max(...ys) - Math.min(...ys) >= MIN_SHAPE);
  }
  if (shape?.rect) {
    const r = shape.rect;
    if (!need(Array.isArray(r) && r.length === 4 && r.every(isNum) && r[0] < r[2] && r[1] < r[3], field, `"${where}" has a rect that should be [left, top, right, bottom], left less than right and top less than bottom.`)) return false;
    return big(r[2] - r[0] >= MIN_SHAPE && r[3] - r[1] >= MIN_SHAPE);
  }
  if (shape?.circle) return need(Array.isArray(shape.circle) && shape.circle.length === 3 && shape.circle.every(isNum) && shape.circle[2] > 0, field, `"${where}" has a circle that should be [x, y, radius].`) && big(shape.circle[2] * 2 >= MIN_SHAPE);
  if (shape?.ellipse) return need(Array.isArray(shape.ellipse) && shape.ellipse.length === 4 && shape.ellipse.every(isNum) && shape.ellipse[2] > 0 && shape.ellipse[3] > 0, field, `"${where}" has an ellipse that should be [x, y, radius across, radius down].`) && big(Math.min(shape.ellipse[2], shape.ellipse[3]) * 2 >= MIN_SHAPE);
  return need(false, field, `"${where}" needs a shape: a polygon [[x, y], ...], { rect: [left, top, right, bottom] }, { circle: [x, y, r] } or { ellipse: [x, y, rx, ry] }.`);
}
