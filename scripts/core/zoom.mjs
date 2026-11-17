/**
 * Zooming into an overview: a battle map of a rectangle of a town or city, made as a plan of its own. Its streets,
 * roads, water, squares, bridges, woods, parks and a centerpiece's walls and fountains carry over at the zoom (twice
 * true size by default); its districts keep their kind, character and roofs and are filled again at battle size; its
 * notable buildings stay where they stand as landmarks. The plan only remembers where it came from (source). Pure.
 */
import { intersect, shapes, area } from "./lots/poly.mjs";
import { shapeToPolygon, polygonsOverlap, unturn, pointInPolygon } from "./geom.mjs";
import { USE_INFO } from "./uses.mjs";
import { houseOf } from "./pin.mjs";
import { hash128 } from "./rng.mjs";
import { PROP_SQUARES, OUTPUT_LIMITS } from "./plan.mjs";

/** The zooms offered: battle squares for each overview square's worth of ground, as a share of true size. */
export const ZOOMS = [1, 1.5, 2];
export const DEFAULT_ZOOM = 2;
/** Whether a path crosses a polygon's edge. */
function pathMeets(path, poly) {
  for (let i = 1; i < path.length; i++) for (let j = 0; j < poly.length; j++) {
    const [a, b] = [path[i - 1], path[i]], [c, d] = [poly[j], poly[(j + 1) % poly.length]];
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    if (o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b)) return true;
  }
  return false;
}

/** How far past the rectangle, in battle squares, what's cut to it still reaches (so nothing stops at the map's edge). */
const REACH = 4;

const r3 = (v) => Math.round(v * 1000) / 1000;
const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

/** Which side of a run cut from a closed loop its outside is ("left" or "right" going along it): away from the loop's inside. */
function outsideOf(piece, loop) {
  let best = 1, len = -1;
  for (let i = 1; i < piece.length; i++) { const l = Math.hypot(piece[i][0] - piece[i - 1][0], piece[i][1] - piece[i - 1][1]); if (l > len) { len = l; best = i; } }
  const a = piece[best - 1], b = piece[best], l = len || 1;
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], left = [(b[1] - a[1]) / l, -(b[0] - a[0]) / l], eps = Math.min(0.05, l / 4);
  return pointInPolygon([mid[0] + left[0] * eps, mid[1] + left[1] * eps], loop) ? "right" : "left";
}

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
  // (a piece cut to the rectangle less than a battle square across or in area, a sliver its edge clips off, is left out)
  const worth = (ring) => {
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    return area(ring) * E * E >= 1 && (Math.max(...xs) - Math.min(...xs)) * E >= 1 && (Math.max(...ys) - Math.min(...ys)) * E >= 1;
  };
  // (and one lying only in the reach past it, never coming onto the map)
  const inner = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  // (whether a cut piece of a line comes onto the map: its middle within half its width of the rectangle)
  const reaches = (piece, half) => clipPath(piece, [x0 - half, y0 - half, x1 + half, y1 + half]).length > 0;
  const cut = (poly) => shapes(intersect([poly], [boxPoly])).filter((s) => worth(s.outer) && shapes(intersect([s.outer], [inner])).some((q) => area(q.outer) * E * E >= 0.01));
  // (high ground cut to a much wider box, so a slope's cut edges lie far off the battle map and its contours
  // don't ring a false top in its middle)
  const wide = (x1 - x0 + y1 - y0) / 2;
  const cutWide = (poly) => shapes(intersect([poly], [[[x0 - wide, y0 - wide], [x1 + wide, y0 - wide], [x1 + wide, y1 + wide], [x0 - wide, y1 + wide]]])).filter((s) => shapes(intersect([s.outer], [inner])).some((q) => area(q.outer) * E * E >= 0.01));
  const planFeature = new Map((plan?.features ?? []).map((f) => [f.id, f]));

  // Streets, roads and lanes, the overview's own and its districts' (faint field tracks left out), at their widths in feet
  for (const w of items.filter((i) => i.kind === "way" && !i.faint && Array.isArray(i.path) && i.path.length >= 2)) {
    const cls = ["street", "highway", "lane", "track", "path"].includes(w.class) ? w.class : w.class === "back" ? "lane" : w.class === "quay" ? null : "lane";
    if (!cls) continue;
    for (const piece of clipPath(w.path, box)) {
      // (a piece lying only in the reach past the rectangle, a road's corner clipped off, never comes onto the map: one
      // whose middle runs just past its edge but is wide enough to show on it comes)
      if (!reaches(piece, (w.width ?? 1) / 2)) continue;
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
      for (const piece of clipPath(w.path, box).filter((q) => reaches(q, (w.width ?? 1) / 2))) features.push({ id: idFor(w.id), type: "water", class: ["stream", "river", "canal"].includes(w.class) ? w.class : "river", path: piece.map(P), width: Math.round((w.width ?? 1) * ft * zoom), straight: true, ...(w.frozen ? { frozen: true } : {}) });
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
      for (const piece of clipPath(i.path, box).filter((q) => reaches(q, (i.thickness ?? 0.1) / 2))) features.push({ id: idFor(i.id.replace(/^.*\//, "")), type: "wall", class: "stone", path: piece.map(P), height: Math.round((i.height ?? 6 / ft) * ft), straight: true });
    } else if (i.kind === "prop" && PROP_CLASSES.has(i.class) && inRect(i.x, i.y)) {
      features.push({ id: idFor(i.id.replace(/^.*\//, "")), type: "prop", class: i.class, at: P([i.x, i.y]), rot: r3(i.rot ?? 0), size: Math.round((i.scale ?? 1) * (PROP_SQUARES[i.class] ?? 0.45) * E * 5) });
    } else if (i.kind === "tree" && inRect(i.x, i.y)) {
      features.push({ id: idFor(i.id.replace(/^.*\//, "")), type: "prop", class: "tree", at: P([i.x, i.y]), ...(i.species && i.species !== "bare" ? { species: i.species } : {}) });
    }
  }
  // Bridges and fords where the overview put them (a stone town wall's moat comes with the wall, which bridges it
  // again)
  const moated = new Set((plan?.features ?? []).filter((f) => f.type === "wall" && f.class === "town" && f.outside === "moat").map((f) => f.id));
  for (const c of items.filter((i) => i.kind === "crossing" && Array.isArray(i.at) && !moated.has(i.from))) {
    if (c.at[0] < box[0] || c.at[0] > box[2] || c.at[1] < box[1] || c.at[1] > box[3]) continue;
    features.push({ id: idFor(c.id), type: "crossing", class: ["bridge", "footbridge", "ford"].includes(c.class) ? c.class : "bridge", at: P(c.at) });
  }
  // The plan's own woods, parks, cemeteries, yards, hills and marshes, cut to the rectangle; its trees and props where
  // they stand
  for (const f of plan?.features ?? []) {
    if (f.type === "area" && ["woods", "park", "cemetery", "yard", "trodden", "hills", "mountains", "marsh"].includes(f.class) && f.shape) {
      // (a park keeps the design the overview gave it: its walks, center, beds, edging and trees, or its green's feature)
      const d = f.class === "park" ? items.find((i) => i.kind === "surface" && i.class === "park" && i.id === f.id)?.design : null;
      const kept = d ? Object.fromEntries(Object.entries({ layout: d.layout, center: d.center, beds: d.beds, edging: d.edging, planting: d.trees, feature: d.feature }).filter(([k, v]) => v && f[k] == null)) : {};
      for (const s of (f.class === "hills" || f.class === "mountains" ? cutWide : cut)(shapeToPolygon(f.shape, f.rot ?? 0))) features.push({ ...structuredClone(f), ...kept, id: idFor(f.id), shape: s.outer.map(P), rot: 0, ...(Number.isFinite(f.trees) ? { trees: Math.round(f.trees * Math.min(1, area(s.outer) / Math.max(1e-6, area(shapeToPolygon(f.shape, f.rot ?? 0))))) } : {}) });
    } else if ((f.type === "tree" || f.type === "prop") && Array.isArray(f.at) && f.at[0] >= x0 && f.at[0] <= x1 && f.at[1] >= y0 && f.at[1] <= y1) {
      features.push({ ...structuredClone(f), id: idFor(f.id), at: P(f.at) });
    }
  }
  // The plan's own low walls, hedges and fences, cut to the rectangle; its stone town walls too, built up as a
  // castle's (layout/castle.mjs), towers spaced for the zoom (a palisade or cliff is left off, and the notes say so)
  const LOW_WALLS = new Set(["drystone", "hedge", "fence", "stone"]);
  const notYet = new Set();
  for (const f of plan?.features ?? []) {
    if (f.type !== "wall" || !Array.isArray(f.path)) continue;
    // (a low wall's piece lying only in the reach past the rectangle is left out; a town wall's is kept, as thick
    // walls and towers reach in from it)
    const pieces = clipPath(f.path, box).filter((piece) => f.class === "town" || reaches(piece, (Number.isFinite(f.thickness) ? f.thickness / ft : 0.1) / 2));
    if (!pieces.length) continue;
    if (f.class === "town") {
      const closed = f.path.length >= 4 && same(f.path[0], f.path[f.path.length - 1]);
      // (a loop whose start lies in the rectangle comes out cut there in two, its last piece ending where its first
      // begins: one run, so its corner there gets one tower)
      const runs = pieces.map((q) => q.slice());
      if (closed && runs.length >= 2 && same(runs[0][0], f.path[0]) && same(runs[runs.length - 1][runs[runs.length - 1].length - 1], f.path[0])) runs.splice(0, 1, [...runs.pop(), ...runs[0].slice(1)]);
      for (const piece of runs) {
        // (a loop the rectangle cuts is an open run, its outside where the loop's was: away from the loop's inside)
        const loop = closed && piece.length >= 4 && same(piece[0], piece[piece.length - 1]);
        const side = loop ? null : closed ? outsideOf(piece, f.path) : f.side ?? null;
        features.push({
          id: idFor(f.id), type: "wall", class: "town", path: piece.map(P), straight: true, ...(side ? { side } : {}),
          ...(Number.isFinite(f.thickness) ? { thickness: f.thickness } : {}), ...(Number.isFinite(f.height) ? { height: f.height } : {}),
          ...(f.towers ? { towers: f.towers } : {}), ...(f.towerShape ? { towerShape: f.towerShape } : {}),
          towerSpacing: Math.round((Number.isFinite(f.towerSpacing) ? f.towerSpacing : 120) * zoom),
          ...(f.outside && f.outside !== "none" ? { outside: f.outside, ...(Number.isFinite(f.ditchWidth) ? { ditchWidth: f.ditchWidth } : {}) } : {}),
        });
      }
      continue;
    }
    if (!LOW_WALLS.has(f.class ?? "drystone")) { notYet.add(f.class === "cliff" ? "cliffs" : "palisades"); continue; }
    for (const piece of pieces) features.push({ ...structuredClone(f), id: idFor(f.id), path: piece.map(P) });
  }
  for (const what of notYet) notes.push(`A battle map doesn't draw ${what} yet, so the ${what.slice(0, -1)} here is left off.`);
  // Districts cut to the rectangle, kind, character and roofs kept, filled again at battle size; their streets and
  // notable buildings come from the overview, so they lay none of their own
  // (a district that no street of the overview reaches inside the area builds no houses of its own there: it keeps
  // the overview's, below)
  // (every way of the overview's that comes into the area but quays: a district builds plots along its tracks and
  // paths too)
  const streetsIn = items.filter((i) => i.kind === "way" && !i.faint && Array.isArray(i.path) && i.path.length >= 2 && i.class !== "quay").flatMap((w) => clipPath(w.path, box).filter((q) => reaches(q, (w.width ?? 1) / 2)));
  const streetless = new Set();
  for (const d of items.filter((i) => i.kind === "district" && Array.isArray(i.poly))) {
    const src = planFeature.get(d.from);
    if (!src) continue;
    const pieces = cut(d.poly);
    if (pieces.length && !pieces.some((s) => streetsIn.some((q) => q.some((pt) => pointInPolygon(pt, s.outer)) || pathMeets(q, s.outer)))) streetless.add(d.from);
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
    // (an ordinary house is kept only in a district no street reaches here, as the overview built it)
    const kept = !notable && parts.some((b) => streetless.has(b.from));
    if (!notable && !kept) continue;
    if (!parts.some((b) => polygonsOverlap(footOf(b), boxPoly))) continue;
    // (one that fronted a street still fronts it: streets keep their true width while everything else grows, so it's
    // moved up to each street it fronted; a centerpiece stays with its grounds)
    const [dx, dy] = kept || /\/h-anchor\d+$/.test(key) ? [0, 0] : frontShift(parts.map(footOf), fronts, (E - ft / 5) / E);
    const moved = dx || dy ? parts.map((b) => ({ ...b, cx: b.cx + dx, cy: b.cy + dy, ...(Array.isArray(b.poly) ? { poly: b.poly.map(([x, y]) => [x + dx, y + dy]) } : {}) })) : parts;
    features.push({ id: idFor(key.replace(/^.*\//, "") || "building"), type: "landmark", buildings: moved.map((b) => scaled(b, P, E)) });
  }
  if (!features.some((f) => f.type === "district")) notes.push("No district reaches into this area, so no houses will be built there.");
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
    // (100 px a square, fewer for a box so big its image would pass OUTPUT_LIMITS.maxSide, WebP's 16383 px a side;
    // never under 20)
    output: { pxPerSquare: Math.max(20, Math.min(100, Math.floor(OUTPUT_LIMITS.maxSide / Math.max(W, H, 1)))), scene: { name: name ?? `${plan?.name ?? "Map"} (battle map)` } },
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
 * The move, in overview squares, that brings a notable building back up to the streets it fronted (the nearest within
 * FRONTED squares, and another at a corner): (half the way's width + the gap) times what the zoom adds over true
 * size, as a share of the zoom ((E - ft/5) / E).
 */
const FRONTED = 0.25;
export function frontShift(feet, ways, share) {
  if (!(share > 0) || !feet.length) return [0, 0];
  const near = ways.map((w) => ({ w, ...frontOf(feet, w) })).filter((x) => x.gap < FRONTED && x.gap > -x.w.width / 2).sort((a, b) => a.gap - b.gap);
  const used = [];
  for (const x of near) if (used.length < 2 && used.every((u) => Math.abs(u.dir[0] * x.dir[0] + u.dir[1] * x.dir[1]) < Math.SQRT1_2)) used.push(x);
  // (how far toward each: half its width and the gap, overlap counting less, x share; at a corner both at once, the
  // move that comes that far toward each street, whatever the angle between them)
  const by = used.map((u) => (u.w.width / 2 + u.gap) * share);
  if (used.length === 1) return [r3(used[0].dir[0] * by[0]), r3(used[0].dir[1] * by[0])];
  if (!used.length) return [0, 0];
  const [a, b] = used.map((u) => u.dir), det = a[0] * b[1] - a[1] * b[0];
  return [r3((by[0] * b[1] - by[1] * a[1]) / det), r3((a[0] * by[1] - b[0] * by[0]) / det)];
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
