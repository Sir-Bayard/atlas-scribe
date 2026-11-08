/**
 * Zooming into an overview: a battle map of a rectangle picked on a town or city, made as a plan of its own (Patrick,
 * 7 Nov, M6 chunk 3). Its streets, roads, water, squares, bridges, woods, parks
 * and a centerpiece's walls and fountains carry over where the overview has
 * them, at the zoom (twice true size by default, so there's room to fight); its districts keep their kind, character
 * and roofs and are filled again at battle size, so their houses are re-made; its notable buildings (a temple, an inn,
 * a smithy, a centerpiece, the plan's own buildings) stay where they stand, with their use, as landmarks. The new plan
 * is independent: it only remembers where it came from (`source`), so the same area can be zoomed again later.
 * Pure: runs in the worker, on the page and under node.
 */
import { intersect, shapes, area } from "./lots/poly.mjs";
import { shapeToPolygon, polygonsOverlap, unturn } from "./geom.mjs";
import { USE_INFO } from "./uses.mjs";
import { houseOf } from "./pin.mjs";
import { hash128 } from "./rng.mjs";
import { PROP_SQUARES } from "./plan.mjs";

/** The zooms offered: battle squares for each overview square's worth of ground, as a share of true size. */
export const ZOOMS = [1, 1.5, 2];
export const DEFAULT_ZOOM = 2;
/** How far past the rectangle, in battle squares, what's cut to it still reaches (so nothing stops at the map's edge). */
const REACH = 4;

const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * The battle map's size for a rectangle on an overview: { squares: [w, h], perSquare } (perSquare: battle squares to
 * one overview square). rect: [x0, y0, x1, y1] in the overview's squares.
 */
export function zoomSize(plan, rect, zoom = DEFAULT_ZOOM) {
  const perSquare = (zoom * (plan?.size?.ftPerSquare ?? 25)) / 5;
  const [x0, y0, x1, y1] = rect;
  return { squares: [Math.max(1, Math.round(Math.abs(x1 - x0) * perSquare)), Math.max(1, Math.round(Math.abs(y1 - y0) * perSquare))], perSquare };
}

/** A polyline cut to a box: the pieces of it inside, each a polyline (Liang and Barsky, a segment at a time). */
export function clipPath(path, [bx0, by0, bx1, by1]) {
  const out = [];
  let cur = null;
  const push = (p) => {
    if (!cur) { cur = [p]; out.push(cur); return; }
    const q = cur[cur.length - 1];
    if (Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) cur.push(p);
  };
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const dx = bx - ax, dy = by - ay;
    let t0 = 0, t1 = 1, ok = true;
    for (const [p, q] of [[-dx, ax - bx0], [dx, bx1 - ax], [-dy, ay - by0], [dy, by1 - ay]]) {
      if (Math.abs(p) < 1e-12) { if (q < 0) { ok = false; break; } continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; } else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; }
    }
    if (!ok) { cur = null; continue; }
    if (t0 > 0) cur = null;
    push([ax + dx * t0, ay + dy * t0]);
    push([ax + dx * t1, ay + dy * t1]);
    if (t1 < 1) cur = null;
  }
  return out.filter((p) => p.length >= 2);
}

/**
 * A battle plan of a rectangle of an overview. plan: the overview's plan (normalized or not); layout: its layout
 * (layoutPlan's); rect: [x0, y0, x1, y1] in its squares; zoom: a share of true size (ZOOMS). Returns { plan, notes }.
 */
export function zoomPlan(plan, layout, rect, { zoom = DEFAULT_ZOOM, id = null, name = null } = {}) {
  const [x0, y0, x1, y1] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
  const { squares: [W, H], perSquare: E } = zoomSize(plan, [x0, y0, x1, y1], zoom);
  const ft = plan?.size?.ftPerSquare ?? 25;
  const P = ([x, y]) => [r3((x - x0) * E), r3((y - y0) * E)];
  const m = REACH / E; // the reach past the rectangle, in overview squares
  const box = [x0 - m, y0 - m, x1 + m, y1 + m];
  const boxPoly = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]];
  const items = layout?.items ?? [];
  const features = [];
  const notes = [];
  const taken = new Set();
  const idFor = (base) => {
    let s = String(base).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "f";
    let k = 1, out = s;
    while (taken.has(out)) out = `${s}-${++k}`;
    taken.add(out);
    return out;
  };
  const cut = (poly) => shapes(intersect([poly], [boxPoly])).filter((s) => area(s.outer) > 1e-4);
  const planFeature = new Map((plan?.features ?? []).map((f) => [f.id, f]));

  // Streets, roads and lanes, the overview's own and its districts' (faint field tracks left out), at their widths in feet
  for (const w of items.filter((i) => i.kind === "way" && !i.faint && Array.isArray(i.path) && i.path.length >= 2)) {
    const cls = ["street", "highway", "lane", "track", "path"].includes(w.class) ? w.class : w.class === "back" ? "lane" : w.class === "quay" ? null : "lane";
    if (!cls) continue;
    for (const piece of clipPath(w.path, box)) {
      const road = { id: idFor(w.id), type: "road", class: cls, path: piece.map(P), straight: true };
      if (Number.isFinite(w.width) && w.width > 0) road.width = Math.round(w.width * ft);
      if (typeof w.surface === "string") road.surface = w.surface;
      features.push(road);
    }
  }
  // Rivers, streams and canals at the zoom (a river twice true size stays as wide beside the houses); lakes, ponds and
  // the sea by their outline
  for (const w of items.filter((i) => i.kind === "water")) {
    if (Array.isArray(w.path) && w.path.length >= 2) {
      if (w.class === "moat") continue;
      for (const piece of clipPath(w.path, box)) features.push({ id: idFor(w.id), type: "water", class: ["stream", "river", "canal"].includes(w.class) ? w.class : "river", path: piece.map(P), width: Math.round((w.width ?? 1) * ft * zoom), straight: true, ...(w.frozen ? { frozen: true } : {}) });
    } else if (Array.isArray(w.poly) && w.poly.length >= 3) {
      for (const s of cut(w.poly)) features.push({ id: idFor(w.id), type: "water", class: ["pond", "lake", "sea"].includes(w.class) ? w.class : "lake", shape: s.outer.map(P), ...(w.frozen ? { frozen: true } : {}) });
    }
  }
  // Squares and a centerpiece's plaza, paved as they are. A plan's square keeps its name, market and middle (the
  // fountain or cross the overview put there); a plaza's middle comes with its centerpiece (below)
  const propIds = new Set(items.filter((i) => i.kind === "prop").map((i) => i.id));
  for (const s of items.filter((i) => i.kind === "surface" && (i.class === "square" || i.class === "plaza") && Array.isArray(i.poly))) {
    const src = planFeature.get(s.from);
    const own = src?.type === "square" ? {
      ...(src.name ? { name: src.name } : {}), ...(src.market ? { market: true } : {}), ...(src.radial ? { radial: true } : {}),
      middle: propIds.has(`${src.id}/fountain`) ? "fountain" : propIds.has(`${src.id}/cross`) ? "cross" : "none",
    } : { middle: "none" };
    for (const piece of cut(s.poly)) features.push({ id: idFor(s.id), type: "square", shape: piece.outer.map(P), ...(typeof s.surface === "string" ? { surface: s.surface } : {}), ...own });
  }
  // A centerpiece's own ground (a temple's precinct, a cloister's garth, a palace's lawns: kept as open grass, so no
  // house is built there), walls, fountains, crosses and statues, and trees
  const PROP_CLASSES = new Set(["well", "statue", "fountain", "cross", "cart", "wagon", "barrel", "crate"]);
  const OPEN_GROUND = new Set(["churchyard", "garth", "lawn"]);
  const inRect = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  for (const i of items.filter((i) => /\/anchor-[svqt]\d+$/.test(i.id ?? ""))) {
    if (i.kind === "surface" && OPEN_GROUND.has(i.class) && Array.isArray(i.poly)) {
      for (const piece of cut(i.poly)) features.push({ id: idFor(i.id.replace(/^.*\//, "")), type: "area", class: "yard", shape: piece.outer.map(P), surface: "grass" });
    } else if (i.kind === "wall" && Array.isArray(i.path)) {
      for (const piece of clipPath(i.path, box)) features.push({ id: idFor(i.id.replace(/^.*\//, "")), type: "wall", class: "stone", path: piece.map(P), height: Math.round((i.height ?? 6 / ft) * ft), straight: true });
    } else if (i.kind === "prop" && PROP_CLASSES.has(i.class) && inRect(i.x, i.y)) {
      features.push({ id: idFor(i.id.replace(/^.*\//, "")), type: "prop", class: i.class, at: P([i.x, i.y]), rot: r3(i.rot ?? 0), size: Math.round((i.scale ?? 1) * (PROP_SQUARES[i.class] ?? 0.45) * E * 5) });
    } else if (i.kind === "tree" && inRect(i.x, i.y)) {
      features.push({ id: idFor(i.id.replace(/^.*\//, "")), type: "prop", class: "tree", at: P([i.x, i.y]), ...(i.species && i.species !== "bare" ? { species: i.species } : {}) });
    }
  }
  // Bridges and fords where the overview put them (each lands again on its road over the water)
  for (const c of items.filter((i) => i.kind === "crossing" && Array.isArray(i.at))) {
    if (c.at[0] < box[0] || c.at[0] > box[2] || c.at[1] < box[1] || c.at[1] > box[3]) continue;
    features.push({ id: idFor(c.id), type: "crossing", class: ["bridge", "footbridge", "ford"].includes(c.class) ? c.class : "bridge", at: P(c.at) });
  }
  // The plan's own woods, parks, cemeteries and yards, cut to the rectangle; its trees and props where they stand
  for (const f of plan?.features ?? []) {
    if (f.type === "area" && ["woods", "park", "cemetery", "yard", "trodden"].includes(f.class) && f.shape) {
      for (const s of cut(shapeToPolygon(f.shape, f.rot ?? 0))) features.push({ ...structuredClone(f), id: idFor(f.id), shape: s.outer.map(P), rot: 0, ...(Number.isFinite(f.trees) ? { trees: Math.round(f.trees * Math.min(1, area(s.outer) / Math.max(1e-6, area(shapeToPolygon(f.shape, f.rot ?? 0))))) } : {}) });
    } else if ((f.type === "tree" || f.type === "prop") && Array.isArray(f.at) && f.at[0] >= x0 && f.at[0] <= x1 && f.at[1] >= y0 && f.at[1] <= y1) {
      features.push({ ...structuredClone(f), id: idFor(f.id), at: P(f.at) });
    }
  }
  // The plan's own low walls, hedges and fences, cut to the rectangle (a town wall, palisade or cliff isn't drawn on a
  // battle map yet: it's left off, and the notes say so)
  const LOW_WALLS = new Set(["drystone", "hedge", "fence", "stone"]);
  const notYet = new Set();
  for (const f of plan?.features ?? []) {
    if (f.type !== "wall" || !Array.isArray(f.path)) continue;
    const pieces = clipPath(f.path, box);
    if (!pieces.length) continue;
    if (!LOW_WALLS.has(f.class ?? "drystone")) { notYet.add(f.class === "cliff" ? "cliffs" : f.class === "palisade" ? "palisades" : "town walls"); continue; }
    for (const piece of pieces) features.push({ ...structuredClone(f), id: idFor(f.id), path: piece.map(P) });
  }
  for (const what of notYet) notes.push(`A battle map doesn't draw ${what} yet, so the ${what.slice(0, -1)} here is left off.`);
  // Districts, cut to the rectangle: their kind, character and roofs kept, filled again at battle size. Their streets and
  // notable buildings come from the overview (above and below), so they lay no streets of their own, and place no
  // notable buildings and no centerpiece
  for (const d of items.filter((i) => i.kind === "district" && Array.isArray(i.poly))) {
    const src = planFeature.get(d.from);
    if (!src) continue;
    const pieces = cut(d.poly);
    pieces.forEach((s) => {
      const f = structuredClone(src);
      for (const k of ["shape", "rot", "seed", "anchorAt", "spacing", "axis"]) delete f[k];
      Object.assign(f, { id: idFor(src.id), shape: s.outer.map(P), anchor: false, notable: false, uses: false, streets: false });
      features.push(f);
    });
  }
  // Notable buildings: a house group (with its wings) whose use is notable, a centerpiece's parts, a street corner's
  // shrine or watch post, and the plan's own buildings and landmarks (a town wall's towers stay with the wall)
  const fronts = items.filter((i) => i.kind === "way" && !i.faint && Array.isArray(i.path) && i.path.length >= 2 && !["back", "quay", "track", "path"].includes(i.class) && Number.isFinite(i.width));
  const groups = new Map();
  for (const b of items.filter((i) => i.kind === "building")) {
    const own = planFeature.get(b.from);
    if (own && (own.type === "wall")) continue;
    const key = houseOf(b.id) ?? (own && (own.type === "building" || own.type === "landmark") ? own.id : null);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  for (const [key, parts] of groups) {
    const planned = planFeature.has(key);
    const notable = planned || /\/h-(anchor|shrine|watch)\d+$/.test(key) || parts.some((b) => USE_INFO[b.use]?.notable);
    if (!notable) continue;
    if (!parts.some((b) => polygonsOverlap(footOf(b), boxPoly))) continue;
    // (one that fronted a street on the overview fronts it still: everything else grows with the zoom but streets keep
    // their true width, so it's moved up to the street by what that leaves between them, along each street it fronted)
    const [dx, dy] = frontShift(parts.map(footOf), fronts, (E - ft / 5) / E);
    const moved = dx || dy ? parts.map((b) => ({ ...b, cx: b.cx + dx, cy: b.cy + dy, ...(Array.isArray(b.poly) ? { poly: b.poly.map(([x, y]) => [x + dx, y + dy]) } : {}) })) : parts;
    features.push({ id: idFor(key.replace(/^.*\//, "") || "building"), type: "landmark", buildings: moved.map((b) => scaled(b, P, E)) });
  }
  if (!features.some((f) => f.type === "district")) notes.push("No district reaches into this area, so no houses will be built there.");
  // (a district's houses front its streets, all of them the overview's: with none in the area, none are built)
  else if (!features.some((f) => f.type === "road" && f.class !== "track" && f.class !== "path")) notes.push("No street runs through this area, so no houses will be built along streets there.");
  const out = {
    atlasScribe: 1,
    id: id ?? `${plan?.id ?? "map"}-battle-${hash128(JSON.stringify([x0, y0, x1, y1, zoom]))[0].toString(36).slice(0, 4)}`,
    name: name ?? `${plan?.name ?? "Map"} (battle map)`,
    kind: "battle",
    style: "textured",
    seed: 1 + (hash128(JSON.stringify([plan?.seed ?? 1, x0, y0, x1, y1, zoom]))[0] % 2147483646),
    season: plan?.season ?? "summer",
    ...(plan?.ground ? { ground: plan.ground } : {}),
    size: { squares: [W, H], ftPerSquare: 5 },
    features,
    source: { plan: plan?.id ?? null, name: plan?.name ?? null, rect: [x0, y0, x1, y1].map(r3), zoom },
    output: { pxPerSquare: 100, scene: { name: name ?? `${plan?.name ?? "Map"} (battle map)` } },
  };
  return { plan: out, notes };
}

/** The nearest point of a path to a point, and how far it is. */
function nearestOn(p, path) {
  let best = { d: Infinity, q: path[0] };
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i], vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - ax) * vx + (p[1] - ay) * vy) / L2)) : 0;
    const q = [ax + vx * t, ay + vy * t], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best.d) best = { d, q };
  }
  return best;
}

/** How far a group of footprints stands from fronting a way, and the way to move toward it: { gap, dir } (squares). */
function frontOf(feet, w) {
  let best = { d: Infinity, p: null, q: null };
  for (const f of feet) for (let i = 0; i < f.length; i++) {
    const a = f[i], b = f[(i + 1) % f.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05));
    for (let k = 0; k < n; k++) {
      const p = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n], r = nearestOn(p, w.path);
      if (r.d < best.d) best = { d: r.d, p, q: r.q };
    }
  }
  const L = best.d || 1;
  return { gap: best.d - w.width / 2, dir: best.p ? [(best.q[0] - best.p[0]) / L, (best.q[1] - best.p[1]) / L] : [0, 0] };
}

/**
 * The move, in overview squares, that brings a notable building up to the streets it fronted once the zoom has grown
 * it but not them: for the nearest way it stood within FRONTED squares of, and another at a corner (turned more than
 * 45 degrees from the first), (half the way's width + the gap) x share, share being what the zoom adds over true size
 * as a share of the zoom ((E - ft/5) / E).
 */
const FRONTED = 0.25;
export function frontShift(feet, ways, share) {
  if (!(share > 0) || !feet.length) return [0, 0];
  const near = ways.map((w) => ({ w, ...frontOf(feet, w) })).filter((x) => x.gap < FRONTED && x.gap > -x.w.width / 2).sort((a, b) => a.gap - b.gap);
  const used = [];
  for (const x of near) if (used.length < 2 && used.every((u) => Math.abs(u.dir[0] * x.dir[0] + u.dir[1] * x.dir[1]) < Math.SQRT1_2)) used.push(x);
  let dx = 0, dy = 0;
  for (const u of used) { const by = (u.w.width / 2 + Math.max(0, u.gap)) * share; dx += u.dir[0] * by; dy += u.dir[1] * by; }
  return [r3(dx), r3(dy)];
}

/** A building item's footprint on the map. */
function footOf(b) {
  if (Array.isArray(b.poly) && b.poly.length >= 3) return b.poly;
  return shapeToPolygon(b.round ? { circle: [b.cx, b.cy, b.len / 2] } : { rect: [b.cx - b.len / 2, b.cy - b.dep / 2, b.cx + b.len / 2, b.cy + b.dep / 2] }, b.rot ?? 0);
}

/** A building item as a plan building at the zoom: its footprint carried over and grown with it, its roof and details kept. */
function scaled(b, P, E) {
  const [cx, cy] = P([b.cx, b.cy]);
  const out = b.round
    ? { shape: { circle: [cx, cy, r3((b.len / 2) * E)] } }
    : Array.isArray(b.poly) && b.poly.length >= 3 ? { shape: unturn(b.poly.map(P), b.rot ?? 0).map(([x, y]) => [r3(x), r3(y)]), roofStyle: b.roofStyle }
      : { shape: { rect: [r3(cx - (b.len * E) / 2), r3(cy - (b.dep * E) / 2), r3(cx + (b.len * E) / 2), r3(cy + (b.dep * E) / 2)] }, roofStyle: b.roofStyle };
  if (b.tower) { out.tower = true; if (b.crenels) out.crenels = true; if (b.round) out.roofStyle = b.roofStyle; }
  out.rot = r3(b.rot ?? 0);
  if (b.roof) out.roof = b.roof;
  out.height = Math.round((20 + (b.tall ?? 0) * 20) * 100) / 100;
  if (Number.isFinite(b.variant)) out.variant = b.variant;
  out.chimney = !!b.chimney;
  if (b.chimney) out.chimneyAt = { u: b.chimney.u, v: b.chimney.v, variant: b.chimney.variant };
  // (a joined part is set into what it joins by a hair, as the overview had it, not grown with the zoom)
  if (b.join) out.join = structuredClone(b.join);
  if (Array.isArray(b.cut) && b.cut.length) out.cut = structuredClone(b.cut);
  if (typeof b.use === "string") out.use = b.use;
  if (typeof b.rooms === "string" && b.rooms) out.rooms = b.rooms; // (its rooms as the overview's plan gave them)
  return out;
}
