/**
 * Checks a plan before anything is generated, and says what's wrong in plain words. Never guesses: anything it
 * can't use is reported. Each problem is { level: "error" | "warning", id, field, message }. Errors stop a
 * render; warnings don't (the generator falls back or skips). Pure: runs anywhere.
 */
import { underlayOf } from "./underlay.mjs";
import { PLAN_VERSION, TYPES, PROFILES, SCENE, NOT_DRAWN_YET, SEASONS, STYLES, SURFACES, OUTPUT_LIMITS, isObj, normalize, okJoin, okCut, okChimney } from "./plan.mjs";
import { shapeToPolygon, bbox, pathTouchesPolygon, polygonsOverlap, polygonCrossesItself, distanceToPath } from "./geom.mjs";
import { districtGates, gateSpacing } from "./streets/index.mjs";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isPoint = (p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]);
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

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
  if (raw.underlay !== undefined && !underlayOf(raw)) warn(null, "underlay", "underlay should be { path, rect: [left, top, right, bottom] } (squares, left below right, top below bottom); it's ignored.");
  else if (underlayOf(raw) && /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(underlayOf(raw).path)) warn(null, "underlay", `The underlay's image is outside Foundry's files (${underlayOf(raw).path.split("/")[2] ?? "another site"}); it's fetched from there each time the plan is opened.`);
  const [w, h] = plan.size.squares;
  if (!(plan.size.squares.length === 2 && Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0)) err(null, "size.squares", "size.squares must be two whole numbers above 0, like [100, 100].");
  // Past 100 ft a square a district holds thousands of plots a square and takes minutes to lay out
  if (!(isNum(plan.size.ftPerSquare) && plan.size.ftPerSquare >= 1 && plan.size.ftPerSquare <= 100)) err(null, "size.ftPerSquare", "size.ftPerSquare must be a number from 1 to 100 (feet a square: 5 for a battle map, 25 for a town).");
  if (!isNum(plan.seed) && !(typeof plan.seed === "string" && plan.seed)) err(null, "seed", "seed must be a number.");
  for (const [name, values] of [["season", SEASONS], ["style", STYLES], ["ground", SURFACES]])
    if (!values.includes(plan[name])) warn(null, name, `${name} "${plan[name]}" isn't one AtlasScribe knows (${values.join(", ")}); ${name === "season" ? "summer" : name === "style" ? "textured" : "a plain fill"} will be used.`);

  // The image: Foundry's grid needs a whole number of pixels, 20 or more; WebP stops at 16383 px a side
  const pps = plan.output.pxPerSquare;
  if (!(Number.isInteger(pps) && pps >= OUTPUT_LIMITS.minPxPerSquare))
    err(null, "output.pxPerSquare", `output.pxPerSquare is ${pps}; it should be a whole number of pixels, ${OUTPUT_LIMITS.minPxPerSquare} or more (Foundry's smallest grid).`);
  else if (Number.isInteger(w) && Number.isInteger(h)) {
    const side = Math.max(w, h) * pps;
    if (side > OUTPUT_LIMITS.maxSide)
      err(null, "output.pxPerSquare", `The map would be ${w * pps} by ${h * pps} px; images can't be more than ${OUTPUT_LIMITS.maxSide} px a side. Use fewer pixels per square (at most ${Math.floor(OUTPUT_LIMITS.maxSide / Math.max(w, h))}).`);
    else if (side > OUTPUT_LIMITS.warnSide)
      warn(null, "output.pxPerSquare", `The map will be ${w * pps} by ${h * pps} px. Some graphics cards can't show a scene background over ${OUTPUT_LIMITS.warnSide} px a side, and it takes a lot of memory to paint.`);
  }
  if (!(isNum(plan.output.quality) && plan.output.quality > 0 && plan.output.quality <= 1)) err(null, "output.quality", `output.quality is ${plan.output.quality}; it should be a number above 0, up to 1.`);
  if (plan.output.format !== "webp") warn(null, "output.format", `output.format "${plan.output.format}" isn't supported yet; the map is saved as WebP.`);
  for (const k of Object.keys(raw.output ?? {})) if (!["pxPerSquare", "format", "quality", "scene"].includes(k)) warn(null, `output.${k}`, `output has a field "${k}" that AtlasScribe doesn't use.`);

  // Ids: present, simple, unique
  const seen = new Map();
  plan.features.forEach((f, i) => {
    const where = f?.id ?? `feature ${i + 1}`;
    if (!isObj(raw.features[i])) return err(null, `features[${i}]`, `Feature ${i + 1} isn't an object.`);
    if (!f.id) err(null, `features[${i}]`, `Feature ${i + 1} (${f.type ?? "no type"}) has no id.`);
    else if (!ID.test(f.id)) err(f.id, "id", `The id "${f.id}" should use only letters, digits, - and _.`);
    else if (seen.has(f.id)) err(f.id, "id", `The id "${f.id}" is used twice.`);
    else seen.set(f.id, f);
    checkFeature(f, where, raw.features?.[i] ?? {}, { err, warn, w, h });
  });

  // Districts: a known profile, and a way in: a road into it, or a street from a neighbouring district through a gate
  // on the side they share (a hamlet makes no streets of its own, so it needs a road)
  const ways = plan.features.filter((f) => f.type === "road" && Array.isArray(f.path));
  const dfeats = plan.features.filter((f) => f.type === "district" && f.id);
  let gates = null;
  const gatesOf = (id) => {
    if (!gates) {
      const sq = isNum(plan.size.ftPerSquare) && plan.size.ftPerSquare > 0 ? plan.size.ftPerSquare : 25;
      const list = dfeats.map((d) => { try { return { id: d.id, poly: shapeToPolygon(d.shape), ...gateSpacing(d, sq) }; } catch { return null; } }).filter((d) => d && d.poly.length >= 3);
      // As the layout places them: none on a side that lies in water
      const sqw = isNum(plan.size.ftPerSquare) && plan.size.ftPerSquare > 0 ? plan.size.ftPerSquare : 25;
      const ws = plan.features.filter((f) => f.type === "water" && Array.isArray(f.path) && f.path.every(isPoint)).map((f) => ({ path: f.path, clear: (isNum(f.width) ? f.width : 0) / sqw / 2 + 0.225 }));
      const inWater = (x, y) => ws.some((w) => distanceToPath([x, y], w.path) < w.clear);
      try { gates = districtGates(list, { roads: ways, inWater, seed: isNum(plan.seed) ? plan.seed : 1 }); } catch { gates = new Map(); }
    }
    return gates.get(id) ?? [];
  };
  for (const d of dfeats) {
    if (!PROFILES.includes(d.profile)) err(d.id, "profile", `District "${d.id}" uses the profile "${d.profile}", which this version doesn't know (it knows: ${PROFILES.join(", ")}).`);
    const poly = shapeToPolygon(d.shape);
    if (poly.length < 3 || ways.some((r) => pathTouchesPolygon(r.path, poly)) || gatesOf(d.id).length) continue;
    const hamlet = d.profile === "hamlet" || d.profile === "roadside";
    warn(d.id, "shape", hamlet
      ? `District "${d.id}" is a hamlet with no road or lane running into it, and a hamlet builds only along roads, so nothing will be built there.`
      : `District "${d.id}" has no road or lane running into it and shares no side with another district's streets, so nothing will be built along streets there.`);
  }

  // Districts and areas drawn as a list of points that cross themselves (a closing point equal to the first is fine)
  for (const f of plan.features.filter((f) => (f.type === "district" || f.type === "area") && Array.isArray(f.shape))) {
    const pts = f.shape.filter((p, k) => !(k === f.shape.length - 1 && k > 0 && p[0] === f.shape[0][0] && p[1] === f.shape[0][1]));
    if (pts.length >= 3 && polygonCrossesItself(pts)) warn(f.id, "shape", `"${f.id}"'s outline crosses itself or repeats a corner, so what's inside it is unclear. Give its corners in order round the edge.`);
  }

  // Districts that overlap: the shared part is filled by both, so their houses stand on each other's
  const dpolys = plan.features.filter((f) => f.type === "district").map((d) => ({ id: d.id, poly: shapeToPolygon(d.shape) })).filter((d) => d.poly.length >= 3);
  for (let i = 0; i < dpolys.length; i++)
    for (let j = i + 1; j < dpolys.length; j++)
      if (polygonsOverlap(shrink(dpolys[i].poly), shrink(dpolys[j].poly)))
        warn(dpolys[i].id, "shape", `Districts "${dpolys[i].id}" and "${dpolys[j].id}" overlap. They can share an edge, but where they overlap both build, and their houses stand on each other's.`);

  // Buildings that overlap each other
  const footprints = [];
  for (const f of plan.features) {
    if (f.type === "building" && f.shape) footprints.push({ id: f.id, poly: shapeToPolygon(f.shape, f.rot) });
    if (f.type === "landmark") f.buildings.forEach((b, j) => b.shape && footprints.push({ id: `${f.id}`, part: j, poly: shapeToPolygon(b.shape, b.rot) }));
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
    else if (owner.type !== "district" && owner.type !== "area" && owner.type !== "landmark") warn(f.id, "of", `Label "${f.id}" names "${f.of}", a ${owner.type}; only districts, areas and landmarks can carry their name, so it isn't shown.`);
  }

  // The scene it's published to
  const scene = raw.output?.scene;
  if (scene) {
    for (const [name, spec] of Object.entries(SCENE)) checkField(null, `output.scene.${name}`, "output.scene", name, spec, scene[name], { err, warn }, "the default will be used");
    for (const k of Object.keys(scene)) if (!(k in SCENE)) warn(null, `output.scene.${k}`, `output.scene has a field "${k}" that AtlasScribe doesn't use.`);
    if (typeof scene.labelColor === "string" && !/^#[0-9a-f]{6}$/i.test(scene.labelColor))
      warn(null, "output.scene.labelColor", `output.scene.labelColor "${scene.labelColor}" should be a colour like #13202e; the default will be used.`);
  }

  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
}

/** Pulls a polygon in slightly toward its centre, so shapes that only touch don't count as overlapping. */
function shrink(poly, by = 0.02) {
  const [x0, y0, x1, y1] = bbox(poly);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return poly.map(([x, y]) => [x + (cx - x) * by, y + (cy - y) * by]);
}

function checkFeature(f, where, raw, { err, warn, w, h }) {
  const t = TYPES[f.type];
  if (!t) return err(f.id ?? null, "type", `"${where}" has the type "${f.type}", which AtlasScribe doesn't know (types: ${Object.keys(TYPES).join(", ")}).`);
  if (t.classes && raw.class !== undefined && !t.classes.includes(raw.class))
    warn(f.id, "class", `"${where}" is a ${f.type} of class "${raw.class}", which AtlasScribe doesn't know (${t.classes.join(", ")}); it will be drawn as a ${t.classes[0]}.`);
  else if (NOT_DRAWN_YET[f.type]?.includes(f.class))
    warn(f.id, "class", `"${where}": ${f.type}s of class "${f.class}" aren't drawn yet; it stays in the plan but won't appear on the map.`);

  // Geometry
  const g = t.geometry;
  const need = (ok, field, message) => (ok ? true : (err(f.id, field, message), false));
  if (g === "point" && !(f.type === "label" && typeof f.of === "string" && f.of)) need(isPoint(f.at), "at", `"${where}" needs a position: at: [x, y]${f.type === "label" ? " (or of: the id of the district, area or landmark it names)" : ""}.`);
  if (g === "path") need(isPath(f.path), "path", `"${where}" needs a path of two or more points: path: [[x, y], [x, y], ...].`);
  if (g === "shape") checkShape(f.shape, where, "shape", need);
  if (g === "path|shape") {
    if (f.path !== undefined) need(isPath(f.path), "path", `"${where}" has a path that isn't two or more [x, y] points.`);
    else checkShape(f.shape, where, "shape", need);
  }
  if (g === "buildings") {
    if (need(Array.isArray(raw.buildings) && raw.buildings.length > 0, "buildings", `Landmark "${where}" needs a list of buildings.`))
      f.buildings.forEach((b, j) => checkShape(b.shape, `${where}, building ${j + 1}`, `buildings[${j}].shape`, need, MIN_PART));
  }

  // A pinned building's drawing details, as the generator writes them (anything else is left out, with a warning)
  const details = (b, at) => {
    if (b.join != null && !okJoin(b.join)) warn(f.id, "join", `${at}: join isn't as AtlasScribe writes it, so it's left out.`);
    if (b.cut != null && !okCut(b.cut)) warn(f.id, "cut", `${at}: cut isn't as AtlasScribe writes it, so it's left out.`);
    if (b.chimneyAt != null && !okChimney(b.chimneyAt)) warn(f.id, "chimneyAt", `${at}: chimneyAt isn't as AtlasScribe writes it, so it's left out.`);
  };
  if (f.type === "building") details(raw, `"${where}"`);
  if (f.type === "landmark" && Array.isArray(raw.buildings)) raw.buildings.forEach((b, j) => isObj(b) && details(b, `"${where}", building ${j + 1}`));

  // Fields: numbers in range, values from their lists, nothing unknown
  for (const [name, spec] of Object.entries(t.fields)) checkField(f.id, name, `"${where}"`, name, spec, f[name], { err, warn }, f.type === "label" ? "the default will be used" : undefined);
  if (f.type === "label" && !String(f.text ?? "").trim() && !f.of) warn(f.id, "text", `Label "${where}" has no text.`);
  if (f.type === "label" && typeof f.font === "string" && f.font.trim() && !/^[\p{L}\p{N} _.-]+$/u.test(f.font.trim())) warn(f.id, "font", `Label "${where}": the font "${f.font}" isn't a plain font name; the plan's will be used.`);
  if (f.type === "label" && typeof f.color === "string" && !/^#[0-9a-f]{6}$/i.test(f.color)) warn(f.id, "color", `Label "${where}": color "${f.color}" should be a colour like #13202e; the plan's will be used.`);
  const known = new Set(["id", "type", "class", "at", "path", "shape", "buildings", "note", ...Object.keys(t.fields)]);
  for (const k of Object.keys(raw)) if (!known.has(k)) warn(f.id, k, `"${where}" has a field "${k}" that AtlasScribe doesn't use.`);

  // Far off the map: wholly off it, it's left out; reaching far past it, laying it out would take too long
  const pts = f.at ? [f.at] : f.path ?? (f.shape ? shapeToPolygon(f.shape) : []);
  if (pts.length && pts.every(isPoint) && w > 0 && h > 0) {
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
  } else if (spec.kind === "point" && !isPoint(v)) err(id, field, `${where}: ${name} should be a point, [x, y].`);
  else if (spec.kind === "boolean" && typeof v !== "boolean") err(id, field, `${where}: ${name} should be true or false.`);
  else if (spec.kind === "string" && typeof v !== "string") err(id, field, `${where}: ${name} should be text.`);
  else if (spec.kind === "list") {
    if (!Array.isArray(v)) err(id, field, `${where}: ${name} should be a list, like ["${spec.values[0]}", "${spec.values[1]}"].`);
    else for (const x of v) if (!spec.values.includes(x)) warn(id, field, `${where}: ${name} has "${x}", which AtlasScribe doesn't know (${spec.values.join(", ")}); it's left out.`);
  } else if (spec.kind === "enum" && !spec.values.includes(v))
    warn(id, field, `${where}: ${name} "${v}" isn't one AtlasScribe knows (${spec.values.join(", ")}); ${spec.fallback ?? fallback}.`);
}

function isPath(p) {
  return Array.isArray(p) && p.length >= 2 && p.every(isPoint);
}

/** The smallest a shape may be, in squares across (and so a tenth of a square across, squared, in area). */
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
    if (!need(Array.isArray(r) && r.length === 4 && r.every(isNum) && r[0] < r[2] && r[1] < r[3], field, `"${where}" has a rect that should be [left, top, right, bottom], left below right and top below bottom.`)) return false;
    return big(r[2] - r[0] >= MIN_SHAPE && r[3] - r[1] >= MIN_SHAPE);
  }
  if (shape?.circle) return need(Array.isArray(shape.circle) && shape.circle.length === 3 && shape.circle.every(isNum) && shape.circle[2] > 0, field, `"${where}" has a circle that should be [x, y, radius].`) && big(shape.circle[2] * 2 >= MIN_SHAPE);
  if (shape?.ellipse) return need(Array.isArray(shape.ellipse) && shape.ellipse.length === 4 && shape.ellipse.every(isNum) && shape.ellipse[2] > 0 && shape.ellipse[3] > 0, field, `"${where}" has an ellipse that should be [x, y, radius across, radius down].`) && big(Math.min(shape.ellipse[2], shape.ellipse[3]) * 2 >= MIN_SHAPE);
  return need(false, field, `"${where}" needs a shape: a polygon [[x, y], ...], { rect: [left, top, right, bottom] }, { circle: [x, y, r] } or { ellipse: [x, y, rx, ry] }.`);
}
