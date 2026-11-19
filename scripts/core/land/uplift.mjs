/**
 * The uplift stage: where the land rises and how hard its rock is. From the shape field, the plates' range spines,
 * the GM's painted ranges and peaks and relief intent, plus the lowland tilt toward the sea, old uplands that stop
 * rising halfway, broad provinces of softer and harder rock, and fault basins that sink. Also decides which nodes are
 * land, which are outlets (the sea and the frame's edge), and the solver's per-node settings. Lengths in miles. Pure.
 */
import { noise, atNodes, makeField } from "./field.mjs";
import { growPlates, boundarySpines, plateCount } from "./plates.mjs";
import { addRange } from "./spine.mjs";
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

/**
 * ctx: { g, frame, land (normalized land block), seed, r (random stream), shapeF (the shape field), terrain (the
 * plan's terrain features in frame miles: [{ class, path | at, ...fields }]), intent (sampled intent layers per node,
 * or null) }. Returns { shape, U, Uold, K, hard, talus, D, landMask, outlet, fixedH, spines, plates, distSea }.
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
    if (touched) used.push({ kind: sp.kind, points: pts, width: o.width, plates: [sp.a, sp.b] });
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
  // the GM's painted ranges and peaks (vector intent)
  // (defaults and limits as the plan's terrain fields, so a raw plan and its normalized form give the same land)
  const num = (v, d, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  (ctx.terrain ?? []).forEach((t, k) => {
    if (t.class === "range" && Array.isArray(t.path) && t.path.length >= 2) {
      const o = { height: num(t.height, 1, 0, 2), width: num(t.width, 30, 2, 400), hard: num(t.hard, 0.8, 0, 1), ridges: Math.round(num(t.ridges, 4, 0, 4)), steep: 0, foreland: false, kind: "range" };
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
  // land: the shape, plus wherever a range stands
  const landMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) landMask[i] = shape[i] > 0 || U[i] > 0.12 ? 1 : 0;
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
  // intent relief: raise or flatten
  // (raise toward mountains; below zero flatten, and past -0.5 sink: a basin)
  if (ctx.intent?.relief) for (let i = 0; i < n; i++) if (landMask[i]) { const v = ctx.intent.relief[i]; if (v > 0) U[i] += 0.9 * v; else { U[i] *= Math.max(0, 1 + v); if (v < -0.5) U[i] -= 0.03 * (-v - 0.5) * 2; } }
  // rock: provinces, hardness, the rock layer
  const K = new Float64Array(n), talus = new Float64Array(n), D = new Float64Array(n);
  const spacing = Math.sqrt((frame.W * frame.H) / n);
  const age = ["young", "mature", "old"].includes(land.age) ? land.age : "mature";
  const Dphys = SOLVER.diffusion[age];
  for (let i = 0; i < n; i++) {
    let rock = 1 + 0.3 * Math.max(-1, Math.min(1, province[i]));
    if (ctx.intent?.rock) { rock *= 1.6 - 1.2 * ctx.intent.rock[i]; if (ctx.intent.rock[i] > 0.6 && ctx.intent.rock[i] > hard[i]) hard[i] = ctx.intent.rock[i]; }
    K[i] = SOLVER.K0 * rock * (1 - 0.55 * hard[i]);
    const s = Math.sqrt(g.area[i]) || spacing;
    talus[i] = SOLVER.talus * pow(s, -0.3) * (1 + 0.6 * hard[i]);
    D[i] = (Dphys * (1 - 0.6 * hard[i])) / SOLVER.dt;
  }
  return { shape, U, Uold, K, hard, talus, D, landMask, outlet, fixedH, spines: used, plates, distSea, spacing, age };
}
