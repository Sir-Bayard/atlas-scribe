/**
 * A plan from a map made in watabou's Medieval Fantasy City Generator or Village Generator, from its JSON export
 * (GeoJSON-like: a FeatureCollection whose features are named by id, such as earth, roads, walls, rivers, water,
 * districts, squares, greens, fields, buildings and trees). It comes in as a starting skeleton: the roads, rivers,
 * walls, water, squares, greens, fields and districts where the generator put them, and AtlasScribe builds the houses
 * and the rest as usual (the generator's own buildings only when asked). Pure: runs anywhere.
 */
import { PLAN_VERSION } from "./plan.mjs";

const r1 = (v) => Math.round(v * 10) / 10;
const isPt = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/**
 * Every geometry under a feature (a GeometryCollection's, a Feature's, a Multi*'s parts) as { type, coords, props }:
 * type "line" (a polyline), "ring" (a polygon's outer ring) or "point".
 */
function partsOf(f) {
  const out = [];
  const walk = (g, props) => {
    if (!g || typeof g !== "object") return;
    const p = { ...props, ...(g.properties ?? {}), ...Object.fromEntries(Object.entries(g).filter(([k, v]) => typeof v !== "object" && k !== "type")) };
    switch (g.type) {
      case "Feature": return walk(g.geometry, p);
      case "FeatureCollection": return (g.features ?? []).forEach((x) => walk(x, p));
      case "GeometryCollection": return (g.geometries ?? []).forEach((x) => walk(x, p));
      case "LineString": if (Array.isArray(g.coordinates)) out.push({ type: "line", coords: g.coordinates.filter(isPt), props: p }); return;
      case "MultiLineString": for (const l of g.coordinates ?? []) out.push({ type: "line", coords: (l ?? []).filter(isPt), props: p }); return;
      case "Polygon": if (Array.isArray(g.coordinates?.[0])) out.push({ type: "ring", coords: g.coordinates[0].filter(isPt), props: p }); return;
      case "MultiPolygon": for (const poly of g.coordinates ?? []) if (Array.isArray(poly?.[0])) out.push({ type: "ring", coords: poly[0].filter(isPt), props: p }); return;
      case "Point": if (isPt(g.coordinates)) out.push({ type: "point", coords: [g.coordinates], props: p }); return;
      case "MultiPoint": for (const q of g.coordinates ?? []) if (isPt(q)) out.push({ type: "point", coords: [q], props: p }); return;
      default:
    }
  };
  walk(f, {});
  return out.filter((x) => x.coords.length >= (x.type === "ring" ? 3 : x.type === "line" ? 2 : 1));
}

/** A district's character from its name, as the generator names its wards ("Market", "Temple", "Docks"...). */
function characterOf(name) {
  const n = String(name ?? "").toLowerCase();
  if (/market|bazaar|exchange/.test(n)) return "market";
  if (/temple|cathedral|church|abbey|priory|sanctuary/.test(n)) return "temple";
  if (/dock|harbou?r|port|wharf|pier/.test(n)) return "docks";
  if (/slum|shanty|poor|gutter/.test(n)) return "poor";
  if (/craft|smith|tann|mill|work|guild/.test(n)) return "crafts";
  if (/castle|citadel|garrison|barrack|military|keep/.test(n)) return "garrison";
  if (/noble|palace|manor|patrician|park/.test(n)) return "nobles";
  if (/merchant|trade/.test(n)) return "merchants";
  return null;
}

/**
 * The plan. json: the export (an object, or its text). Options: name; ftPerUnit (feet in one of the export's units:
 * 3.28 for meters, the generator's own); ftPerSquare (25, or 50 when the map would be wider than 300 squares);
 * flipY (true: the export's y runs north, as GeoJSON's does); buildings (keep the generator's buildings as fixed
 * buildings; else AtlasScribe builds its own); seed. Returns { plan, notes }.
 */
export function fromWatabou(json, { name = null, ftPerUnit = 3.28, ftPerSquare = null, flipY = true, buildings = false, seed = 1 } = {}) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  const feats = Array.isArray(data?.features) ? data.features : Array.isArray(data) ? data : null;
  if (!feats) throw new Error("This isn't a watabou export: it has no features list (export the map as JSON from the generator)");
  const notes = [];
  const byId = new Map();
  for (const f of feats) {
    const id = String(f?.id ?? f?.properties?.id ?? "").toLowerCase();
    if (!id) continue;
    byId.set(id, [...(byId.get(id) ?? []), f]);
  }
  const values = byId.get("values")?.[0] ?? {};
  const get = (...ids) => ids.flatMap((id) => (byId.get(id) ?? []).flatMap(partsOf));
  const all = [...byId.entries()].filter(([id]) => id !== "values").flatMap(([, fs]) => fs.flatMap(partsOf));
  if (!all.length) throw new Error("This watabou export holds no shapes to read");
  // The frame: the earth's (the land the map shows) when there is one, else everything's
  const frameParts = get("earth").length ? get("earth") : all;
  const xs = frameParts.flatMap((p) => p.coords.map((q) => q[0])), ys = frameParts.flatMap((p) => p.coords.map((q) => q[1]));
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const spanFt = Math.max(x1 - x0, y1 - y0) * ftPerUnit;
  const ftSq = ftPerSquare ?? (spanFt / 25 > 300 ? 50 : 25);
  const k = ftPerUnit / ftSq, margin = 2;
  const W = Math.max(10, Math.ceil((x1 - x0) * k) + 2 * margin), H = Math.max(10, Math.ceil((y1 - y0) * k) + 2 * margin);
  if (W > 400 || H > 400) notes.push(`The map comes to ${W} by ${H} squares, heavy to draw; importing with a larger ftPerSquare (api.importPlan) makes it smaller`);
  const at = ([x, y]) => [r1((x - x0) * k + margin), r1((flipY ? y1 - y : y - y0) * k + margin)];
  const path = (coords) => {
    const pts = coords.map(at);
    return pts.filter((p, i) => !i || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.05);
  };
  const ring = (coords) => {
    const pts = path(coords);
    if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
    return pts;
  };
  const widthFt = (p, dflt) => (Number.isFinite(Number(p.props?.width)) ? Number(p.props.width) * ftPerUnit : dflt);
  const features = [];
  const n = { road: 0, river: 0, wall: 0, water: 0, district: 0, square: 0, park: 0, fields: 0, building: 0 };
  const id = (kind) => `${kind}-${++n[kind]}`;
  const inMap = (q) => q[0] >= 0 && q[1] >= 0 && q[0] <= W && q[1] <= H;

  // Roads: the main ones (arteries) and the rest, by width
  const roadWidth = Number(values.roadWidth) * ftPerUnit || 15;
  for (const p of [...get("arteries"), ...get("roads")]) {
    const pts = path(p.coords);
    if (pts.length < 2) continue;
    const w = widthFt(p, roadWidth);
    features.push({ id: id("road"), type: "road", class: w >= 24 ? "highway" : w >= 12 ? "street" : "lane", path: pts });
  }
  // Rivers and the water's bodies (the sea when it reaches the map's edge, else a lake)
  for (const p of get("rivers")) {
    const pts = path(p.coords);
    if (pts.length >= 2) features.push({ id: id("river"), type: "water", class: "river", width: Math.max(10, Math.min(400, Math.round(widthFt(p, 60)))), path: pts });
  }
  for (const p of get("water", "sea", "lakes", "ponds")) {
    const pts = ring(p.coords);
    if (pts.length < 3) continue;
    const edge = pts.some((q) => q[0] <= margin + 0.5 || q[1] <= margin + 0.5 || q[0] >= W - margin - 0.5 || q[1] >= H - margin - 0.5);
    features.push({ id: id("water"), type: "water", class: edge ? "sea" : "lake", shape: pts });
  }
  // Walls: each a closed ring (a gate is wherever a road crosses it, as AtlasScribe makes them)
  for (const p of get("walls")) {
    const pts = ring(p.coords);
    if (pts.length < 3) continue;
    features.push({ id: id("wall"), type: "wall", class: widthFt(p, 6) < 4 ? "palisade" : "town", path: [...pts, pts[0]], straight: true });
  }
  // Squares, greens and fields
  for (const p of get("squares", "plazas")) { const pts = ring(p.coords); if (pts.length >= 3) features.push({ id: id("square"), type: "square", shape: pts }); }
  for (const p of get("greens", "parks")) { const pts = ring(p.coords); if (pts.length >= 3) features.push({ id: id("park"), type: "area", class: "park", style: "green", shape: pts }); }
  for (const p of get("fields")) { const pts = ring(p.coords); if (pts.length >= 3) features.push({ id: id("fields"), type: "area", class: "fields", shape: pts }); }
  // Districts: the generator's wards with their names, else one over the walls' inside (or the whole town)
  const houses = get("buildings", "prisms").filter((p) => p.type === "ring");
  const profile = houses.length > 900 ? "city" : houses.length > 150 ? "town" : "village";
  for (const p of get("districts", "wards")) {
    const pts = ring(p.coords);
    if (pts.length < 3) continue;
    const nm = p.props?.name ?? null, character = characterOf(nm);
    features.push({ id: id("district"), type: "district", profile, ...(character ? { character } : {}), ...(nm ? { name: String(nm) } : {}), shape: pts });
  }
  if (!n.district) {
    const wall = features.find((f) => f.type === "wall");
    const pts = wall ? wall.path.slice(0, -1) : (() => {
      const hx = houses.flatMap((p) => p.coords.map(at)), mx = hx.map((q) => q[0]), my = hx.map((q) => q[1]);
      return hx.length ? [[Math.min(...mx) - 1, Math.min(...my) - 1], [Math.max(...mx) + 1, Math.min(...my) - 1], [Math.max(...mx) + 1, Math.max(...my) + 1], [Math.min(...mx) - 1, Math.max(...my) + 1]] : [[margin, margin], [W - margin, margin], [W - margin, H - margin], [margin, H - margin]];
    })();
    features.push({ id: id("district"), type: "district", profile, shape: pts });
    notes.push("The export names no wards, so the town is one district: draw or split districts in the window to vary it");
  }
  // The generator's own buildings, when asked
  if (buildings) {
    for (const p of houses) { const pts = ring(p.coords); if (pts.length >= 3 && pts.every(inMap)) features.push({ id: id("building"), type: "building", shape: pts }); }
    if (n.building > 3000) notes.push(`${n.building} buildings came in as fixed buildings; laying them out is slow`);
  } else if (houses.length) notes.push(`The export's ${houses.length} buildings were left out: AtlasScribe builds its own (api.importPlan with { buildings: true } keeps the generator's)`);
  if (!n.road) notes.push("The export has no roads; AtlasScribe's districts make their own streets");
  const title = name ?? values.name ?? data.name ?? "Imported town";
  features.push({ id: "name", type: "label", text: String(title), at: [r1(W / 2), 1.5], show: "gm", size: "huge" });
  const plan = {
    atlasScribe: PLAN_VERSION,
    id: `${String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "imported"}-${seed}`,
    name: String(title), kind: "settlement", seed,
    size: { squares: [W, H], ftPerSquare: ftSq },
    features,
    source: { from: "watabou", generator: values.generator ?? null, version: values.version ?? null },
  };
  return { plan, notes };
}

/** True when a parsed JSON value looks like a watabou export (a feature list with an earth, roads or buildings). */
export function isWatabou(data) {
  const feats = Array.isArray(data?.features) ? data.features : null;
  return !!feats && feats.some((f) => ["earth", "roads", "buildings", "values", "walls", "arteries"].includes(String(f?.id ?? "").toLowerCase()));
}
