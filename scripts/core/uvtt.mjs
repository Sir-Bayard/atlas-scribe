/**
 * Universal VTT (the .dd2vtt / .uvtt files Dungeondraft, DungeonFog and other map makers trade): a battle map's image
 * with its walls, doors and lights in grid squares. In: a plan of the map's size whose walls follow its walls, with its
 * image under the sketch to trace over. Out: a published scene's background, walls, doors and lights. Pure: runs
 * anywhere (the image goes in and out as base64 text).
 */
import { PLAN_VERSION } from "./plan.mjs";

const r2 = (v) => Math.round(v * 100) / 100;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const ptOf = (p) => (isNum(p?.x) && isNum(p?.y) ? [p.x, p.y] : null);

/**
 * A plan from a Universal VTT file (an object, or its text). Its walls (line_of_sight and objects_line_of_sight) come
 * in as stone walls, its doors as gaps in them, its image as the underlay. Returns { plan, notes, image: { base64,
 * type, rect } or null } (rect: where the image lies, in squares). ftPerSquare: the grid's feet (5).
 */
export function fromUVTT(input, { name = "Imported battle map", ftPerSquare = 5, seed = 1 } = {}) {
  const u = typeof input === "string" ? JSON.parse(input) : input;
  const size = ptOf(u?.resolution?.map_size);
  if (!size || size[0] <= 0 || size[1] <= 0) throw new Error("This isn't a Universal VTT file: it has no resolution.map_size");
  const origin = ptOf(u.resolution.map_origin) ?? [0, 0];
  const W = Math.ceil(size[0]), H = Math.ceil(size[1]);
  const at = (p) => { const q = ptOf(p); return q ? [r2(q[0] - origin[0]), r2(q[1] - origin[1])] : null; };
  const notes = [];
  // Doors: their spans, so the walls running through them leave a gap there
  const doors = (u.portals ?? []).map((d) => (Array.isArray(d?.bounds) && d.bounds.length >= 2 ? [at(d.bounds[0]), at(d.bounds[1])] : null)).filter((d) => d && d[0] && d[1]);
  const onDoor = (a, b) => doors.some(([p, q]) => {
    const near = (x, y) => Math.hypot(x[0] - y[0], x[1] - y[1]) < 0.15;
    return (near(a, p) && near(b, q)) || (near(a, q) && near(b, p));
  });
  const features = [];
  let n = 0;
  for (const line of [...(u.line_of_sight ?? []), ...(u.objects_line_of_sight ?? [])]) {
    const pts = (Array.isArray(line) ? line : []).map(at).filter(Boolean);
    // (split where a segment is a door's span)
    let run = [];
    const flush = () => { if (run.length >= 2) features.push({ id: `wall-${++n}`, type: "wall", class: "stone", height: 10, path: run, straight: true }); run = []; };
    for (let i = 0; i < pts.length; i++) {
      if (i && onDoor(pts[i - 1], pts[i])) { flush(); run = [pts[i]]; continue; }
      if (i && Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) < 0.01) continue;
      run.push(pts[i]);
    }
    flush();
  }
  if (doors.length) notes.push(`${doors.length} ${doors.length === 1 ? "door comes" : "doors come"} in as a gap in the walls`);
  const lights = (u.lights ?? []).filter((l) => ptOf(l?.position));
  for (const [k, l] of lights.entries()) {
    const p = at(l.position);
    features.push({ id: `light-${k + 1}`, type: "prop", class: "torch", at: p });
  }
  const img = typeof u.image === "string" && u.image.length > 32 ? u.image.replace(/^data:[^,]*,/, "") : null;
  const type = img ? (img.startsWith("iVBOR") ? "image/png" : img.startsWith("/9j/") ? "image/jpeg" : "image/webp") : null;
  if (!img) notes.push("The file has no image; only its walls came in");
  const plan = {
    atlasScribe: PLAN_VERSION,
    id: `${String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "imported"}-${seed}`,
    name: String(name), kind: "battle", seed,
    size: { squares: [W, H], ftPerSquare },
    features,
    source: { from: "uvtt", format: u.format ?? null },
  };
  // (the image's own size in squares, which the map's rounds up)
  return { plan, notes, image: img ? { base64: img, type, rect: [0, 0, r2(size[0]), r2(size[1])] } : null };
}

/**
 * A Universal VTT file (format 0.3) from a scene's parts: size [W, H] in squares; pps: pixels a square; origin: the
 * map's corner on the scene in px (its padding); walls: [{ c: [x0, y0, x1, y1], door, sight, move }] in scene px;
 * lights: [{ x, y, config: { bright, dim, color } }] in scene px, their reach in feet; ftPerSquare; image: base64.
 */
export function toUVTT({ size, pps, origin = [0, 0], walls = [], lights = [], ftPerSquare = 5, image = "" }) {
  const g = ([x, y]) => ({ x: r2((x - origin[0]) / pps), y: r2((y - origin[1]) / pps) });
  const blocking = walls.filter((w) => !w.door && w.sight !== 0);
  const doors = walls.filter((w) => w.door);
  // (joined into runs where one wall ends where the next begins, as map makers write them)
  const runs = [];
  for (const w of blocking) {
    const a = g([w.c[0], w.c[1]]), b = g([w.c[2], w.c[3]]);
    const last = runs.at(-1)?.at(-1);
    if (last && Math.abs(last.x - a.x) < 0.01 && Math.abs(last.y - a.y) < 0.01) runs.at(-1).push(b);
    else runs.push([a, b]);
  }
  return {
    format: 0.3,
    resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: size[0], y: size[1] }, pixels_per_grid: pps },
    line_of_sight: runs,
    objects_line_of_sight: [],
    portals: doors.map((w) => {
      const a = g([w.c[0], w.c[1]]), b = g([w.c[2], w.c[3]]);
      return { position: { x: r2((a.x + b.x) / 2), y: r2((a.y + b.y) / 2) }, bounds: [a, b], rotation: Math.atan2(b.y - a.y, b.x - a.x), closed: true, freestanding: false };
    }),
    environment: { baked_lighting: false, ambient_light: "ffffffff" },
    lights: lights.map((l) => {
      const reach = Math.max(Number(l.config?.dim) || 0, Number(l.config?.bright) || 0);
      return { position: g([l.x, l.y]), range: r2(reach / ftPerSquare), intensity: 1, color: String(l.config?.color ?? "#ffffff").replace("#", "") + "ff", shadows: true };
    }),
    image,
  };
}

/** True when a parsed JSON value looks like a Universal VTT file. */
export const isUVTT = (data) => !!ptOf(data?.resolution?.map_size) && ("line_of_sight" in data || "image" in data);
