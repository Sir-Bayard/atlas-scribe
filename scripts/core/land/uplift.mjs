/**
 * The uplift stage: where the land rises and how hard its rock is. From the shape field, the plates' range spines,
 * the GM's painted ranges and peaks and relief intent, plus the lowland tilt toward the sea, old uplands that stop
 * rising halfway, broad provinces of softer and harder rock, and fault basins that sink. Also decides which nodes are
 * land, which are outlets (the sea and the frame's edge), and the solver's per-node settings. Lengths in miles. Pure.
 */
import { noise, atNodes, makeField } from "./field.mjs";
import { growPlates, boundarySpines, plateCount } from "./plates.mjs";
import { addRange, resample } from "./spine.mjs";
import { nodeGrid } from "./graph.mjs";
import { Heap } from "./heap.mjs";
import { tanh, exp, len, pow, cos, sin } from "./dmath.mjs";

/** The solver's constants (calibrated in miles; see the plan's 5.7). */
export const SOLVER = {
  K0: 1.75, dt: 0.0125,
  steps: { young: 220, mature: 320, old: 420 },
  // hillslope rounding as a share per pass at the node spacing (a look at the map's own scale: the rounding of old
  // mountains must show whatever the zoom, so it isn't a physical diffusivity)
  diffusion: { young: 0.02, mature: 0.06, old: 0.16 },
  talus: 0.063, // (height per mile at a 1-mile node spacing; scaled by spacing^-0.3)
};

/** Multi-source distance over the graph (miles) from every node where src[i] is true. */
export function graphDistance(g, src) {
  const d = new Float64Array(g.n).fill(Infinity), heap = new Heap(g.n);
  for (let i = 0; i < g.n; i++) if (src[i]) { d[i] = 0; heap.push(0, i); }
  while (heap.size) {
    const i = heap.pop(), di = heap.lastKey;
    if (di > d[i]) continue;
    for (let k = g.indptr[i]; k < g.indptr[i + 1]; k++) { const j = g.indices[k], nd = di + g.elen[k]; if (nd < d[j]) { d[j] = nd; heap.push(nd, j); } }
  }
  return d;
}

/** Connected groups of nodes where test(i) holds: { comp (Int32Array, -1 outside), areas (square miles), edge (touches an outlet border) }. */
export function components(g, test) {
  const comp = new Int32Array(g.n).fill(-1), areas = [], edge = [];
  const stack = new Int32Array(g.n);
  for (let s = 0; s < g.n; s++) {
    if (comp[s] >= 0 || !test(s)) continue;
    const id = areas.length;
    let top = 0, a = 0, e = false;
    stack[top++] = s; comp[s] = id;
    while (top) {
      const i = stack[--top]; a += g.area[i]; if (g.border[i]) e = true;
      for (let k = g.indptr[i]; k < g.indptr[i + 1]; k++) { const j = g.indices[k]; if (comp[j] < 0 && test(j)) { comp[j] = id; stack[top++] = j; } }
    }
    areas.push(a); edge.push(e);
  }
  return { comp, areas, edge };
}

/** How much more of the map than the recipe's share ranges may raise from the sea, as a share of the map. */
export const RANGE_ROOM = 0.04;

/**
 * ctx: { g, frame, land (normalized land block), seed, r (random stream), shapeF (the shape field), terrain (the
 * plan's terrain features in frame miles: [{ class, path | at, ...fields }]), intent (sampled intent layers per node,
 * or null), gen (the generator to run as; left out, the newest) }. Returns { shape, U, Uold, K, hard, talus, D, early
 * (K, talus, D and hard without a plateau's rock, for the wearing down before the coast is made; null when the
 * same), rock (each node's rock family: ROCK_FAMILIES), landMask, outlet, fixedH, spines, plates, distSea, rangeT (how high a range stands before it makes land of
 * the sea) }.
 */
export function upliftStage(ctx) {
  const { g, frame, land, seed, r, shapeF } = ctx;
  const n = g.n;
  const shape = atNodes(shapeF, g);
  const coarse = makeField(frame.W, frame.H, 256);
  const N256 = (beta, key, opt) => atNodes(noise(coarse, beta, seed, ["uplift", key], opt), g);
  const N512 = (beta, key, opt) => atNodes(noise(shapeF, beta, seed, ["uplift", key], opt), g);
  const wander = N256(1.5, "wander"), alongN = N256(1.6, "along"), waver = N256(1.6, "waver"), footN = N256(1.5, "foot");
  const ridgedN = N512(1.3, "ridged"), uplands = N256(1.5, "uplands"), basinsN = N256(1.6, "basins");
  const province = N256(2.2, "province", { highCut: 400 });
  const fields = { waver, along: alongN, foot: new Float64Array(n), ridged: new Float64Array(n), along01: new Float64Array(n) };
  for (let i = 0; i < n; i++) {
    const t = tanh(0.9 * ridgedN[i]);
    fields.ridged[i] = (1 - Math.abs(t)) * (1 - Math.abs(t));
    fields.foot[i] = Math.min(1, Math.max(0, footN[i] * 0.5 + 0.5));
    fields.along01[i] = Math.min(1, Math.max(0, 0.5 + 0.5 * alongN[i]));
  }
  const mountains = Number.isFinite(land.mountains) ? Math.min(1, Math.max(0, land.mountains)) : 0.5;
  const U = new Float64Array(n), hard = new Float64Array(n);
  const out = { U, hard };
  // plates and their spines
  const count = plateCount(land.plates, frame.W * frame.H);
  const plates = growPlates(g, shape, wander, count, r.fork("plates"));
  const { spines } = boundarySpines(g, plates, Math.max(80, 0.06 * Math.max(frame.mapW, frame.mapH)));
  const grid = nodeGrid(g);
  const used = [];
  for (const [k, sp] of spines.entries()) {
    const sr = r.fork("spine", k);
    let pts = sp.points;
    const c = Math.max(0, sp.conv);
    if (sp.kind === "coastal") {
      // set inland on the continental plate's side, 30 to 80 miles
      const off = sr.range(30, 80);
      pts = pts.map((p, idx) => {
        const a = pts[Math.max(0, idx - 1)], b = pts[Math.min(pts.length - 1, idx + 1)];
        const l = len(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l;
        const j = grid.nearest(p[0] + nx * off, p[1] + ny * off);
        const s = plates.plate[j] === sp.lean ? 1 : -1;
        return [p[0] + s * nx * off, p[1] + s * ny * off];
      });
    }
    const o = sp.kind === "collision" ? { height: mountains * (0.9 + 0.4 * c), width: sr.range(40, 60), hard: 0.2, ridges: 4, steep: 0, foreland: true, kind: "range" }
      : sp.kind === "coastal" ? { height: mountains * (0.8 + 0.4 * c), width: sr.range(25, 40), hard: 0.2, ridges: 3, steep: 1, foreland: true, kind: "range" }
      : sp.kind === "arc" ? { height: 0.55 + 0.3 * c, width: sr.range(15, 25), hard: 0.3, ridges: 1, steep: 0, foreland: false, kind: "arc" }
      : { height: 1, width: sr.range(15, 30), kind: "rift" };
    if (mountains <= 0.02 && o.kind !== "rift") continue;
    const touched = addRange(g, pts, o, fields, sr, out);
    if (touched) used.push({ kind: sp.kind, points: pts, width: o.width, plates: [sp.a, sp.b], lean: sp.lean, from: sp.points });
  }
  // a frame with no range on land gets one or two placed directly when mountains are asked for (a kingdom inside one plate)
  let landRange = 0;
  for (let i = 0; i < n; i++) if (shape[i] > 0 && U[i] > 0.3) landRange++;
  if (!landRange && mountains > 0.3) {
    const pr = r.fork("own-spines");
    const landNodes = []; for (let i = 0; i < n; i++) if (shape[i] > 0.3 && frame.inMap(g.x[i], g.y[i])) landNodes.push(i);
    const many = mountains > 0.6 ? 2 : 1;
    for (let k = 0; k < many && landNodes.length; k++) {
      const s = landNodes[pr.int(landNodes.length)];
      const ang = pr.range(0, 6.283), Lm = pr.range(0.4, 0.8) * Math.max(frame.mapW, frame.mapH), bend = pr.range(-0.25, 0.25);
      const dx = cos(ang), dy = sin(ang);
      const pts = Array.from({ length: 9 }, (_, q) => { const t = q / 8 - 0.5; return [g.x[s] + dx * t * Lm - dy * bend * Lm * (1 - 4 * t * t), g.y[s] + dy * t * Lm + dx * bend * Lm * (1 - 4 * t * t)]; });
      const o = { height: mountains * 1.1, width: pr.range(30, 50), hard: 0.2, ridges: 4, steep: 0, foreland: true, kind: "range" };
      addRange(g, pts, o, fields, pr.fork("r", k), out);
      used.push({ kind: "own", points: pts, width: o.width });
    }
  }
  // plateaus and volcanoes, only when asked for (each from a stream of its own, so other lands don't change)
  if (land.plateaus && !ctx.keptWhole) plateaus({ g, frame, used, plates, fields, r: r.fork("plateaus"), out, shape });
  if (land.volcanic && !ctx.keptWhole) volcanoes({ g, frame, mountains, used, r: r.fork("volcanic"), out, shape });
  // the GM's painted ranges and peaks (vector intent)
  // (defaults and limits as the plan's terrain fields, so a raw plan and its normalized form give the same land)
  const num = (v, d, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  (ctx.terrain ?? []).forEach((t, k) => {
    if (t.class === "range" && Array.isArray(t.path) && t.path.length >= 2) {
      const o = { height: num(t.height, 1, 0, 2), width: num(t.width, 30, 2, 400), hard: num(t.hard, 0.8, 0, 1), ridges: Math.round(num(t.ridges, 4, 0, 4)), steep: 0, foreland: false, kind: "range", spacing: Math.sqrt((frame.W * frame.H) / g.n) };
      addRange(g, t.path, o, fields, r.fork("painted", t.id ?? `#${k}`), out);
      used.push({ kind: "painted", id: t.id, points: t.path, width: o.width });
    } else if (t.class === "peak" && Array.isArray(t.at)) {
      const rad = num(t.radius, 15, 1, 300), ht = num(t.height, 1, 0, 2), hd = num(t.hard, 0.8, 0, 1);
      for (let i = 0; i < n; i++) {
        const d = len(g.x[i] - t.at[0], g.y[i] - t.at[1]);
        if (d > rad * 3) continue;
        const q = d / rad;
        let u = ht * exp(-q * q);
        if (t.volcanic) u -= ht * 0.35 * exp(-(q / 0.25) * (q / 0.25)); // (a crater)
        U[i] += u;
        hard[i] = Math.max(hard[i], hd * exp(-q * q));
      }
    }
  });
  // land: the shape, plus wherever a range stands; but on a kingdom map, or of islands, ranges raise no more of the sea
  // than keeps the land within a little of the share the recipe asked for (on a small map a range's miles of width are
  // much of it, and a thin arc or a few islands would turn to one land): past that, only a range's higher ground stands
  // above the sea (generator 2 on)
  const landMask = new Uint8Array(n);
  let rangeT = 0.12;
  if ((ctx.gen ?? 2) >= 2 && (frame.scale === "kingdom" || ["archipelago", "arc", "island"].includes(land.type))) {
    let mapA = 0, shapeA = 0; const sea = [];
    for (let i = 0; i < n; i++) {
      if (!frame.inMap(g.x[i], g.y[i])) continue;
      mapA += g.area[i];
      if (shape[i] > 0) shapeA += g.area[i]; else if (U[i] > 0.12) sea.push(i);
    }
    const room = Math.max(0, (Number.isFinite(shapeF.share) ? shapeF.share + RANGE_ROOM : 1) * mapA - shapeA);
    let add = 0; for (const i of sea) add += g.area[i];
    if (add > room) {
      sea.sort((a, b) => U[b] - U[a] || a - b);
      let a = 0, k = 0;
      while (k < sea.length && a + g.area[sea[k]] <= room) a += g.area[sea[k++]];
      rangeT = k < sea.length ? U[sea[k]] : rangeT;
    }
  }
  for (let i = 0; i < n; i++) landMask[i] = shape[i] > 0 || U[i] > rangeT ? 1 : 0;
  // intent: land or sea painted
  if (ctx.intent?.water) for (let i = 0; i < n; i++) { const v = ctx.intent.water[i]; if (v > 0.6) landMask[i] = 1; else if (v < 0.4) landMask[i] = 0; }
  // clean: land specks under 0.2% of the map go; sea holes under 0.5% that don't reach the frame's edge fill
  const mapArea = frame.mapW * frame.mapH;
  const lc = components(g, (i) => landMask[i]);
  for (let i = 0; i < n; i++) if (lc.comp[i] >= 0 && lc.areas[lc.comp[i]] < 0.002 * mapArea && U[i] < 0.3) landMask[i] = 0;
  const sc = components(g, (i) => !landMask[i]);
  for (let i = 0; i < n; i++) if (sc.comp[i] >= 0 && !sc.edge[sc.comp[i]] && sc.areas[sc.comp[i]] < 0.005 * mapArea) landMask[i] = 1;
  // the sea's nodes and the frame's edge drain the land
  const outlet = new Uint8Array(n), fixedH = new Float64Array(n);
  for (let i = 0; i < n; i++) if (!landMask[i] || g.border[i]) { outlet[i] = 1; fixedH[i] = landMask[i] ? 0.004 : 0; }
  // tilt: the land rises gently away from the sea (or, with no sea in the frame, from its edge)
  let anySea = false; for (let i = 0; i < n; i++) if (!landMask[i]) { anySea = true; break; }
  const distSea = graphDistance(g, anySea ? Uint8Array.from(landMask, (v) => (v ? 0 : 1)) : g.border);
  const Uold = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (!landMask[i]) { U[i] = 0; continue; }
    U[i] += 0.003 + 0.012 * Math.min(1, distSea[i] / 820);
    const up = Math.min(1, Math.max(0, 0.6 * uplands[i] + 0.1));
    Uold[i] = 0.1 * (0.3 + mountains) * up * up;
    // fault basins, away from coasts
    if (distSea[i] > 60) U[i] -= 0.025 * Math.max(0, basinsN[i] - 1.0);
  }
  // a plateau's hard rock, once the coast is known: it fades to the sea as the plateau's top does (landforms), so a
  // shore stays where the sea wears it
  // (the rock before it, for the wearing down until the coast is made, so plateaus never move the coast)
  const hardBefore = out.plateau && (ctx.gen ?? Infinity) >= 3 ? Float64Array.from(hard) : null;
  if (out.plateau) for (let i = 0; i < n; i++) if (landMask[i] && out.plateau[i]) hard[i] = Math.max(hard[i], PLATEAU_HARD * out.plateau[i] * coastFade(g, distSea, i));
  // intent relief: raise or flatten
  // (raise toward mountains; below zero flatten, and past -0.5 sink: a basin)
  if (ctx.intent?.relief) for (let i = 0; i < n; i++) if (landMask[i]) { const v = ctx.intent.relief[i]; if (v > 0) U[i] += 0.9 * v; else { U[i] *= Math.max(0, 1 + v); if (v < -0.5) U[i] -= 0.03 * (-v - 0.5) * 2; } }
  // rock: provinces, hardness, the rock layer
  const K = new Float64Array(n), talus = new Float64Array(n), D = new Float64Array(n);
  const spacing = Math.sqrt((frame.W * frame.H) / n);
  const age = ["young", "mature", "old"].includes(land.age) ? land.age : "mature";
  const Dphys = SOLVER.diffusion[age];
  const early = hardBefore ? { K: new Float64Array(n), talus: new Float64Array(n), D: new Float64Array(n), hard: hardBefore } : null;
  for (let i = 0; i < n; i++) {
    let rock = 1 + 0.3 * Math.max(-1, Math.min(1, province[i]));
    if (ctx.intent?.rock) { rock *= 1.6 - 1.2 * ctx.intent.rock[i]; if (ctx.intent.rock[i] > 0.6 && ctx.intent.rock[i] > hard[i]) hard[i] = ctx.intent.rock[i]; if (hardBefore && ctx.intent.rock[i] > 0.6 && ctx.intent.rock[i] > hardBefore[i]) hardBefore[i] = ctx.intent.rock[i]; }
    K[i] = SOLVER.K0 * rock * (1 - 0.55 * hard[i]);
    const s = Math.sqrt(g.area[i]) || spacing;
    talus[i] = SOLVER.talus * pow(s, -0.3) * (1 + 0.6 * hard[i]);
    D[i] = (Dphys * (1 - 0.6 * hard[i])) / SOLVER.dt;
    if (early) { early.K[i] = SOLVER.K0 * rock * (1 - 0.55 * hardBefore[i]); early.talus[i] = SOLVER.talus * pow(s, -0.3) * (1 + 0.6 * hardBefore[i]); early.D[i] = (Dphys * (1 - 0.6 * hardBefore[i])) / SOLVER.dt; }
  }
  // (each node's rock family, for the painter and the mines: by the province, softer to harder, limestone (0),
  // sandstone (1), granite (2), basalt (3); a volcano's land basalt; hard peaks and plateaus granite)
  const rock = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = province[i];
    rock[i] = p < -0.3 ? 0 : p < 0.1 ? 1 : p < 0.45 ? 2 : 3;
    if (hard[i] > 0.5 && rock[i] < 2) rock[i] = 2;
  }
  if (out.cones) for (const c of out.cones) for (let i = 0; i < n; i++) if (len(g.x[i] - c.at[0], g.y[i] - c.at[1]) < 2.5 * c.rad) rock[i] = 3;
  return { shape, U, Uold, K, hard, talus, D, early, rock, landMask, outlet, fixedH, spines: used, plates, distSea, spacing, age, plateau: out.plateau ?? null, cones: out.cones ?? null, rangeT };
}

/**
 * A plateau's rock faded again to the coast as the coast forms left it (up.distSea, recomputed): its hardness, and the
 * K, talus and D it gives, on up in place. Needs up.early (a plateau on a generator 3 land); otherwise does nothing.
 */
export function refadePlateau(g, up, landMask) {
  if (!up.early || !up.plateau) return;
  const { early, hard, K, talus, D } = up;
  for (let i = 0; i < g.n; i++) {
    const was = hard[i], now = landMask[i] && up.plateau[i] ? Math.max(early.hard[i], PLATEAU_HARD * up.plateau[i] * coastFade(g, up.distSea, i)) : early.hard[i];
    if (now === was) continue;
    hard[i] = now;
    const b = early.hard[i];
    K[i] = (early.K[i] * (1 - 0.55 * now)) / (1 - 0.55 * b);
    talus[i] = (early.talus[i] * (1 + 0.6 * now)) / (1 + 0.6 * b);
    D[i] = (early.D[i] * (1 - 0.6 * now)) / (1 - 0.6 * b);
  }
}

/** The rock families, by uplift's rock index. */
export const ROCK_FAMILIES = ["limestone", "sandstone", "granite", "basalt"];

/** How hard a plateau's rock is at its heart. */
const PLATEAU_HARD = 0.75;

/**
 * A plateau's share at node i by its distance from the sea: none on the shore, all of it four node spacings in (the
 * node's own spacing, since the nodes are finer in some places than others).
 */
function coastFade(g, distSea, i) {
  const loc = Math.sqrt(g.area[i]);
  return Math.min(1, Math.max(0, (distSea[i] - 1.5 * loc) / (4 * loc)));
}

/** A polyline with its cumulative lengths, for toLine. */
function lineOf(pts) {
  const cum = [0]; for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + len(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  return { pts, cum };
}

/** Distance from (x, y) to a polyline (pts, with cumulative lengths cum) and how far along it, 0 to 1. */
function toLine(pts, cum, x, y) {
  let best = Infinity, at = 0;
  for (let k = 1; k < pts.length; k++) {
    const ax = pts[k - 1][0], ay = pts[k - 1][1], dx = pts[k][0] - ax, dy = pts[k][1] - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const d = len(ax + t * dx - x, ay + t * dy - y);
    if (d < best) { best = d; at = cum[k - 1] + t * (cum[k] - cum[k - 1]); }
  }
  return { d: best, t: cum[cum.length - 1] ? at / cum[cum.length - 1] : 0 };
}

/**
 * A plateau along a line, as a weight per node (out.plateau, 0 to 1: shaped onto the eroded land by landforms(),
 * since erosion would wear a flat top into ordinary hills; upliftStage gives it hard rock once the coast is known).
 * o: { back (miles from the line to the plateau's middle; 0 straddles it), half (half its breadth) }; keep(i): the
 * nodes it may raise (land on the plate behind a range).
 */
function addPlateau(g, line, o, keep, fields, out) {
  const pts = resample(line, Math.max(2, o.half / 6));
  if (pts.length < 2) return 0;
  const cum = [0]; for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + len(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  const total = cum[cum.length - 1], reach = o.back + 2 * o.half;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  let touched = 0;
  for (let i = 0; i < g.n; i++) {
    const x = g.x[i], y = g.y[i];
    if (x < x0 - reach || x > x1 + reach || y < y0 - reach || y > y1 + reach || !keep(i)) continue;
    const { d, t } = toLine(pts, cum, x, y);
    if (d > reach) continue;
    // (a ragged edge, and its ends rounded off over half its breadth)
    const q = Math.abs(d + 0.35 * o.half * fields.waver[i] - o.back) / o.half;
    const ends = Math.min(1, (t * total) / o.half, ((1 - t) * total) / o.half);
    const f = exp(-pow(q, 6)) * (ends <= 0 ? 0 : ends * ends * (3 - 2 * ends));
    if (f <= 1e-4) continue;
    out.plateau[i] = Math.max(out.plateau[i], f);
    touched++;
  }
  return touched;
}

/**
 * Plateaus: behind each range where two continents meet, on the larger plate (as a high plateau stands behind a
 * collision range), and behind a coastal range on its continent; when those leave the map itself with little or
 * none (a range off its edge), one stands on its own on the map's land, so a map asked for plateaus shows one.
 */
function plateaus({ g, frame, used, plates, fields, r, out, shape }) {
  out.plateau = new Float64Array(g.n);
  const size = new Map(); for (let i = 0; i < g.n; i++) size.set(plates.plate[i], (size.get(plates.plate[i]) ?? 0) + 1);
  let made = 0;
  for (const [k, u] of used.entries()) {
    if (u.kind !== "collision" && u.kind !== "coastal") continue;
    const behind = u.kind === "coastal" ? u.lean : (size.get(u.plates[0]) ?? 0) >= (size.get(u.plates[1]) ?? 0) ? u.plates[0] : u.plates[1];
    const pr = r.fork("behind", k);
    const o = u.kind === "collision"
      // (its near edge a range's width or more behind the spine, clear of the range's core and peaks)
      ? { back: u.width * pr.range(3, 3.6), half: u.width * pr.range(1.4, 2) }
      : { back: u.width * pr.range(2.6, 3.2), half: u.width * pr.range(1, 1.4) };
    // (behind a coastal range means inland of it: farther from the plates' boundary, the coast, than from the range)
    const inland = u.kind === "coastal" ? lineOf(u.from) : null, range = u.kind === "coastal" ? lineOf(u.points) : null;
    const landward = (i) => !inland || toLine(inland.pts, inland.cum, g.x[i], g.y[i]).d > toLine(range.pts, range.cum, g.x[i], g.y[i]).d;
    made += addPlateau(g, u.points, o, (i) => plates.plate[i] === behind && shape[i] > 0.05 && landward(i), fields, out);
  }
  // (how much of the map's own land they cover)
  let onMap = 0, mapLand = 0;
  for (let i = 0; i < g.n; i++) if (shape[i] > 0.05 && frame.inMap(g.x[i], g.y[i])) { mapLand++; if (out.plateau[i] > 0.5) onMap++; }
  if (made && onMap >= 0.03 * mapLand) return;
  // (one of its own: a broad rise on the land, a line through a spot well inland)
  const inland = []; for (let i = 0; i < g.n; i++) if (shape[i] > 0.35 && frame.inMap(g.x[i], g.y[i])) inland.push(i);
  if (!inland.length) return;
  const s = inland[r.int(inland.length)], long = Math.max(frame.mapW, frame.mapH);
  const ang = r.range(0, 6.283), L = r.range(0.25, 0.4) * long, dx = cos(ang), dy = sin(ang);
  const line = Array.from({ length: 7 }, (_, q) => { const t = q / 6 - 0.5; return [g.x[s] + dx * t * L, g.y[s] + dy * t * L]; });
  addPlateau(g, line, { back: 0, half: r.range(0.08, 0.13) * long }, (i) => shape[i] > 0.05, fields, out);
}

/**
 * A volcano: recorded in out.cones for landforms() to shape onto the eroded land (a cone with a crater at its top),
 * with enough uplift at its core that one out at sea raises an island the land's cleanup keeps (it keeps a speck
 * whose uplift is 0.3 or more), and harder rock than the land around it. rad: miles; ht: its height.
 */
function addCone(g, at, rad, ht, out) {
  (out.cones ??= []).push({ at, rad, ht });
  for (let i = 0; i < g.n; i++) {
    const dx = g.x[i] - at[0], dy = g.y[i] - at[1];
    if (dx > 3 * rad || dx < -3 * rad || dy > 3 * rad || dy < -3 * rad) continue;
    const q = len(dx, dy) / rad;
    if (q > 3) continue;
    out.U[i] += Math.max(0.35 * ht, 0.34) * exp(-q * q);
    out.hard[i] = Math.max(out.hard[i], 0.6 * exp(-q * q));
  }
}

/**
 * Volcanoes: a chain of cones along every island arc (where an ocean plate sinks under another) and along the crest of
 * every coastal range; when fewer than two stand on the map, a hotspot chain or two, cones in a line growing smaller
 * the older they are, out at sea as islands or on the land. Each cone at least a few nodes across, so it shows at any
 * scale. Returns how many were made.
 */
function volcanoes({ g, frame, mountains, used, r, out, shape }) {
  let area = 0; for (let i = 0; i < g.n; i++) area += g.area[i];
  const least = 2.2 * Math.sqrt(area / g.n); // (miles: a cone a couple of nodes across at the least)
  let cones = 0;
  for (const [k, u] of used.entries()) {
    if (u.kind !== "arc" && u.kind !== "coastal") continue;
    const arc = u.kind === "arc", vr = r.fork("chain", k);
    const pts = resample(u.points, u.width * (arc ? 2 : 3));
    for (let q = 1; q + 1 < pts.length; q++) {
      const cr = vr.fork("cone", q);
      if (!cr.chance(arc ? 0.75 : 0.55) || !frame.inMap(pts[q][0], pts[q][1])) continue;
      addCone(g, pts[q], Math.max(least, u.width * cr.range(0.45, 0.7)), arc ? cr.range(0.6, 0.95) : 0.45 + 0.5 * mountains * cr.range(0.8, 1.2), out);
      cones++;
    }
  }
  if (cones >= 2) return cones;
  // hotspot chains: one on a kingdom or realm, two on a continent or world
  const long = Math.max(frame.mapW, frame.mapH), chains = long > 1200 ? 2 : 1;
  for (let c = 0; c < chains; c++) {
    const hr = r.fork("hotspot", c);
    const rad = Math.max(least, hr.range(0.02, 0.032) * long), n = 3 + hr.int(4);
    const ang = hr.range(0, 6.283), step = rad * hr.range(2.2, 3), dx = cos(ang), dy = sin(ang);
    const x0 = frame.margin + hr.range(0.2, 0.8) * frame.mapW, y0 = frame.margin + hr.range(0.2, 0.8) * frame.mapH;
    for (let q = 0; q < n; q++) {
      const at = [x0 + dx * step * q, y0 + dy * step * q];
      if (!frame.inMap(at[0], at[1])) continue;
      addCone(g, at, rad * (1 - 0.12 * q), hr.range(0.6, 0.9) * (1 - 0.13 * q), out);
      cones++;
    }
  }
  return cones;
}

/**
 * Plateaus and volcanoes shaped onto the eroded land, after the heights are remapped and before the water is routed
 * (so rivers and lakes follow them): a plateau lifts its land toward a flat top a little above the hills, its own
 * relief pressed flat (rivers then cut its edges; it stands clear of the range behind it, and true mountains in it stay); a volcano stands as a cone over whatever is there, a crater at its
 * top. up: upliftStage's result; h: heights, changed in place (fixed nodes, the GM's kept land, are left).
 */
export function landforms(g, h, landMask, fixed, up, mountains) {
  if (up.plateau) {
    const top = 0.5 + 0.2 * mountains;
    for (let i = 0; i < g.n; i++) {
      // (it falls away to the sea: no plateau top on the shore itself)
      const p = up.plateau[i] * coastFade(g, up.distSea, i);
      // (true mountains standing in it, another range's peaks, are left as they are)
      if (!p || !landMask[i] || (fixed && fixed[i]) || h[i] > top + 0.25) continue;
      h[i] = (1 - p) * h[i] + p * (top + 0.15 * (h[i] - top));
    }
  }
  for (const c of up.cones ?? []) {
    // (a volcano stands above the land it rises from, even on a range's crest)
    let peak = c.ht, nearest = Infinity;
    for (let i = 0; i < g.n; i++) { const d = len(g.x[i] - c.at[0], g.y[i] - c.at[1]); if (d < nearest) { nearest = d; peak = Math.max(c.ht, h[i] + 0.25); } }
    for (let i = 0; i < g.n; i++) {
      if (!landMask[i] || (fixed && fixed[i])) continue;
      const dx = g.x[i] - c.at[0], dy = g.y[i] - c.at[1];
      if (dx > 2.5 * c.rad || dx < -2.5 * c.rad || dy > 2.5 * c.rad || dy < -2.5 * c.rad) continue;
      const q = len(dx, dy) / c.rad;
      if (q > 2.5) continue;
      const cone = peak * exp(-q * q) - 0.3 * peak * exp(-(q / 0.22) * (q / 0.22));
      if (cone > h[i]) h[i] = cone;
    }
  }
}

/**
 * Lake country, for land.lakes "many": small hollows scoured into the lower land away from the sea (as ice leaves
 * kettles and scoured basins), which the routing then floods into lakes. About one per 400 land nodes, each a few
 * nodes across, on the map's land below the mountains and at least four node spacings from the sea. r: a random
 * stream; h: changed in place; frame: for the map within it.
 */
export function scourHollows(g, h, landMask, fixed, distSea, r, frame) {
  let area = 0, land = 0; for (let i = 0; i < g.n; i++) { area += g.area[i]; if (landMask[i] && frame.inMap(g.x[i], g.y[i])) land++; }
  const spacing = Math.sqrt(area / g.n);
  const spots = []; for (let i = 0; i < g.n; i++) if (landMask[i] && frame.inMap(g.x[i], g.y[i]) && !(fixed && fixed[i]) && h[i] < 0.55 && distSea[i] > 4 * spacing) spots.push(i);
  const count = Math.floor(land / 400);
  for (let k = 0; k < count && spots.length; k++) {
    const hr = r.fork("hollow", k);
    const s = spots[hr.int(spots.length)], rad = spacing * hr.range(1.8, 3.2), depth = hr.range(0.02, 0.05);
    for (let i = 0; i < g.n; i++) {
      if (!landMask[i] || (fixed && fixed[i])) continue;
      const dx = g.x[i] - g.x[s], dy = g.y[i] - g.y[s];
      if (dx > 2 * rad || dx < -2 * rad || dy > 2 * rad || dy < -2 * rad) continue;
      const q = len(dx, dy) / rad;
      if (q < 2) h[i] = Math.max(0.0015, h[i] - depth * exp(-q * q));
    }
  }
}
