/**
 * Checks a plan before anything is generated, and says what's wrong in plain words. Never guesses: anything it
 * can't use is reported. Each problem is { level: "error" | "warning", id, field, message }. Errors stop a
 * render; warnings don't (the generator falls back or skips). Pure: runs anywhere.
 */
import { PLAN_VERSION, TYPES, PROFILES, SCENE, normalize } from "./plan.mjs";
import { shapeToPolygon, bbox, pathTouchesPolygon, polygonsOverlap } from "./geom.mjs";

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
  const plan = normalize(raw);
  const [w, h] = plan.size.squares ?? [];
  if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0)) err(null, "size.squares", "size.squares must be two whole numbers above 0, like [100, 100].");
  if (!(isNum(plan.size.ftPerSquare) && plan.size.ftPerSquare > 0)) err(null, "size.ftPerSquare", "size.ftPerSquare must be a number above 0.");
  if (!Array.isArray(raw.features)) err(null, "features", "The plan has no features list.");

  // Ids: present, simple, unique
  const seen = new Map();
  plan.features.forEach((f, i) => {
    const where = f?.id ?? `feature ${i + 1}`;
    if (!f || typeof f !== "object") return err(null, `features[${i}]`, `Feature ${i + 1} isn't an object.`);
    if (!f.id) err(null, `features[${i}]`, `Feature ${i + 1} (${f.type ?? "no type"}) has no id.`);
    else if (!ID.test(f.id)) err(f.id, "id", `The id "${f.id}" should use only letters, digits, - and _.`);
    else if (seen.has(f.id)) err(f.id, "id", `The id "${f.id}" is used twice.`);
    else seen.set(f.id, f);
    checkFeature(f, where, raw.features?.[i] ?? {}, { err, warn, w, h });
  });

  // Districts: a known profile, and a way in
  const ways = plan.features.filter((f) => f.type === "road" && Array.isArray(f.path));
  for (const d of plan.features.filter((f) => f.type === "district")) {
    if (!PROFILES.includes(d.profile)) err(d.id, "profile", `District "${d.id}" uses the profile "${d.profile}", which this version doesn't know (it knows: ${PROFILES.join(", ")}).`);
    const poly = shapeToPolygon(d.shape);
    if (poly.length >= 3 && !ways.some((r) => pathTouchesPolygon(r.path, poly)))
      warn(d.id, "shape", `District "${d.id}" has no road or lane running into it, so nothing will be built along streets there.`);
  }

  // Buildings that overlap each other
  const footprints = [];
  for (const f of plan.features) {
    if (f.type === "building" && f.shape) footprints.push({ id: f.id, poly: shapeToPolygon(f.shape, f.rot) });
    if (f.type === "landmark") (f.buildings ?? []).forEach((b, j) => b.shape && footprints.push({ id: `${f.id}`, part: j, poly: shapeToPolygon(b.shape, b.rot) }));
  }
  for (let i = 0; i < footprints.length; i++)
    for (let j = i + 1; j < footprints.length; j++) {
      const a = footprints[i], b = footprints[j];
      if (a.id === b.id) continue; // parts of one landmark may touch
      if (a.poly.length >= 3 && b.poly.length >= 3 && polygonsOverlap(shrink(a.poly), shrink(b.poly)))
        warn(a.id, "shape", `"${a.id}" overlaps "${b.id}".`);
    }

  // Seeds and locks must point at something
  for (const id of Object.keys(plan.seeds ?? {})) if (!seen.has(id)) warn(id, "seeds", `There's a seed for "${id}", but no feature with that id.`);
  for (const id of plan.locked ?? []) if (!seen.has(id)) warn(id, "locked", `"${id}" is locked, but there's no feature with that id.`);

  // The scene it's published to
  const scene = raw.output?.scene;
  if (scene !== undefined && (typeof scene !== "object" || scene === null || Array.isArray(scene))) err(null, "output.scene", "output.scene should be an object.");
  else if (scene) {
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
  if (t.classes && !t.classes.includes(f.class))
    warn(f.id, "class", `"${where}" is a ${f.type} of class "${f.class}", which isn't one AtlasScribe draws yet (${t.classes.join(", ")}); it will be drawn as "${t.classes[0]}".`);

  // Geometry
  const g = t.geometry;
  const need = (ok, field, message) => (ok ? true : (err(f.id, field, message), false));
  if (g === "point") need(isPoint(f.at), "at", `"${where}" needs a position: at: [x, y].`);
  if (g === "path") need(isPath(f.path), "path", `"${where}" needs a path of two or more points: path: [[x, y], [x, y], ...].`);
  if (g === "shape") checkShape(f.shape, where, "shape", need);
  if (g === "path|shape") {
    if (f.path !== undefined) need(isPath(f.path), "path", `"${where}" has a path that isn't two or more [x, y] points.`);
    else checkShape(f.shape, where, "shape", need);
  }
  if (g === "buildings") {
    if (need(Array.isArray(f.buildings) && f.buildings.length > 0, "buildings", `Landmark "${where}" needs a list of buildings.`))
      f.buildings.forEach((b, j) => checkShape(b.shape, `${where}, building ${j + 1}`, `buildings[${j}].shape`, need));
  }

  // Fields: numbers in range, values from their lists, nothing unknown
  for (const [name, spec] of Object.entries(t.fields)) checkField(f.id, name, `"${where}"`, name, spec, f[name], { err, warn }, f.type === "label" ? "the default will be used" : undefined);
  if (f.type === "label" && !String(f.text ?? "").trim()) warn(f.id, "text", `Label "${where}" has no text.`);
  const known = new Set(["id", "type", "class", "at", "path", "shape", "buildings", "note", ...Object.keys(t.fields)]);
  for (const k of Object.keys(raw)) if (!known.has(k)) warn(f.id, k, `"${where}" has a field "${k}" that AtlasScribe doesn't use.`);

  // Far off the map
  const pts = f.at ? [f.at] : f.path ?? (f.shape ? shapeToPolygon(f.shape) : []);
  if (pts.length && pts.every(isPoint) && w > 0 && h > 0) {
    const [x0, y0, x1, y1] = bbox(pts);
    const mx = w * 0.1, my = h * 0.1;
    if (x1 < -mx || y1 < -my || x0 > w + mx || y0 > h + my) warn(f.id, "position", `"${where}" is entirely off the map.`);
  }
}

/** One field against its spec: numbers in range, the right kind, values from their list. */
function checkField(id, field, where, name, spec, v, { err, warn }, fallback = "a plain fill will stand in") {
  if (v === null || v === undefined) return;
  if (spec.kind === "number") {
    if (!isNum(v)) err(id, field, `${where}: ${name} should be a number${spec.unit ? ` (${spec.unit})` : ""}.`);
    else if ((spec.min !== undefined && v < spec.min) || (spec.max !== undefined && v > spec.max))
      err(id, field, `${where}: ${name} is ${v}; it should be ${spec.max !== undefined ? `${spec.min} to ${spec.max}` : `at least ${spec.min}`}.`);
  } else if (spec.kind === "boolean" && typeof v !== "boolean") err(id, field, `${where}: ${name} should be true or false.`);
  else if (spec.kind === "string" && typeof v !== "string") err(id, field, `${where}: ${name} should be text.`);
  else if (spec.kind === "enum" && !spec.values.includes(v))
    warn(id, field, `${where}: ${name} "${v}" isn't one AtlasScribe knows (${spec.values.join(", ")}); ${fallback}.`);
}

function isPath(p) {
  return Array.isArray(p) && p.length >= 2 && p.every(isPoint);
}

function checkShape(shape, where, field, need) {
  if (Array.isArray(shape)) return need(shape.length >= 3 && shape.every(isPoint), field, `"${where}" has a polygon that needs three or more [x, y] points.`);
  if (shape?.rect) {
    const r = shape.rect;
    return need(Array.isArray(r) && r.length === 4 && r.every(isNum) && r[0] < r[2] && r[1] < r[3], field, `"${where}" has a rect that should be [left, top, right, bottom], left below right and top below bottom.`);
  }
  if (shape?.circle) return need(Array.isArray(shape.circle) && shape.circle.length === 3 && shape.circle.every(isNum) && shape.circle[2] > 0, field, `"${where}" has a circle that should be [x, y, radius].`);
  if (shape?.ellipse) return need(Array.isArray(shape.ellipse) && shape.ellipse.length === 4 && shape.ellipse.every(isNum) && shape.ellipse[2] > 0 && shape.ellipse[3] > 0, field, `"${where}" has an ellipse that should be [x, y, radius across, radius down].`);
  return need(false, field, `"${where}" needs a shape: a polygon [[x, y], ...], { rect: [left, top, right, bottom] }, { circle: [x, y, r] } or { ellipse: [x, y, rx, ry] }.`);
}
