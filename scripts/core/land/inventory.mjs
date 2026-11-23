/**
 * The feature inventory: what the land holds, each with a stable id, a kind, a label point and a size. Seas, land
 * masses (islands and continents), lakes, rivers (main stems), ranges, peaks, passes (the lowest point on the divide
 * between two big drainage basins), bays and capes, drainage basins as regions, deserts, forests and marshes, falls.
 * It feeds labels, names, the summary, road routing, town sites and (later) selecting a generated feature. Ids are a
 * hash of the kind and a coarsely rounded position, so a name kept by id survives small changes to the land. Pure.
 */
import { hashAt } from "../rng.mjs";
import { makeField, blur, regions } from "./field.mjs";
import { components } from "./uplift.mjs";

const KIND_CODE = { sea: 1, land: 2, lake: 3, river: 4, range: 5, peak: 6, pass: 7, bay: 8, cape: 9, basin: 10, desert: 11, forest: 12, marsh: 13, falls: 14, island: 15, delta: 16, estuary: 17, spit: 18, lagoon: 19, "salt-pan": 20, "seasonal-lake": 21, "inland-marsh": 22 };

/** A stable id: the kind and a position rounded to about 4% of the map. */
function idFor(L, kind, x, y, extra = 0) {
  const q = (kind === "river" || kind === "falls" ? 0.01 : 0.04) * Math.max(L.frame.mapW, L.frame.mapH);
  const h = hashAt(Math.round(x / q), Math.round(y / q), KIND_CODE[kind] ?? 0, extra);
  return `${kind}-${Math.floor(h * 0xffff).toString(16).padStart(4, "0")}`;
}

/** The area-weighted middle of a set of nodes, nudged to the member node nearest it (so it lies on the feature). */
function middleOf(L, nodes) {
  const { g } = L;
  let sx = 0, sy = 0, sa = 0;
  for (const i of nodes) { sx += g.x[i] * g.area[i]; sy += g.y[i] * g.area[i]; sa += g.area[i]; }
  const cx = sx / sa, cy = sy / sa;
  let best = nodes[0], bd = Infinity;
  for (const i of nodes) { const d = (g.x[i] - cx) * (g.x[i] - cx) + (g.y[i] - cy) * (g.y[i] - cy); if (d < bd) { bd = d; best = i; } }
  return [g.x[best], g.y[best], sa];
}

/** The inventory of a Land. Returns [{ id, kind, x, y (frame miles), size (square miles, or miles for rivers and ranges), ... }]. */
/** A length's class for a stable id: round(log2(length)) with arithmetic only (the class changes at sqrt(2) times a power of 2). */
function lengthClass(length) {
  let k = 0, edge = Math.SQRT2;
  while (length >= edge && k < 60) { k++; edge *= 2; }
  return k;
}

export function inventoryOf(L) {
  const { g, landMask, h, rec, frame } = L;
  const n = g.n, out = [];
  const mapArea = frame.mapW * frame.mapH;
  const inMap = (i) => frame.inMap(g.x[i], g.y[i]);
  const push = (kind, nodes, extra = {}) => { const [x, y, size] = middleOf(L, nodes); out.push({ id: idFor(L, kind, x, y, extra.key ?? 0), kind, x, y, size, ...extra }); };

  // seas and land masses (in the map)
  const seas = components(g, (i) => !landMask[i] && !L.lake[i] && inMap(i));
  const seaNodes = seas.areas.map(() => []);
  for (let i = 0; i < n; i++) if (seas.comp[i] >= 0) seaNodes[seas.comp[i]].push(i);
  seaNodes.forEach((nodes, k) => { if (seas.areas[k] > 0.01 * mapArea) push("sea", nodes); });
  const lands = components(g, (i) => landMask[i] && inMap(i));
  const landNodes = lands.areas.map(() => []);
  for (let i = 0; i < n; i++) if (lands.comp[i] >= 0) landNodes[lands.comp[i]].push(i);
  let landTotal = 0; for (const a of lands.areas) landTotal += a;
  landNodes.forEach((nodes, k) => { if (lands.areas[k] > 0.002 * mapArea) push(lands.areas[k] > 0.25 * landTotal ? "land" : "island", nodes, { share: lands.areas[k] / (landTotal || 1) }); });

  // lakes, rivers (main stems), falls
  for (const lk of L.lakes) {
    const nodes = []; for (let i = 0; i < n; i++) if (L.lakeId[i] === lk.id) nodes.push(i);
    if (!nodes.length) continue;
    const [x, y] = middleOf(L, nodes);
    const o = lk.outlet >= 0 ? lk.outlet : nodes[0];
    out.push({ id: idFor(L, "lake", g.x[o], g.y[o]), kind: "lake", x, y, size: lk.area, closed: lk.closed, lake: lk.id });
  }
  for (const R of L.rivers) {
    if (!R.main) continue;
    let length = 0; const p = R.points;
    for (let k = 1; k < p.length; k++) { const dx = p[k][0] - p[k - 1][0], dy = p[k][1] - p[k - 1][1]; length += Math.sqrt(dx * dx + dy * dy); }
    const mid = p[Math.floor(p.length / 2)], mouth = p[p.length - 1];
    out.push({ id: idFor(L, "river", mouth[0], mouth[1], lengthClass(length)), kind: "river", x: mid[0], y: mid[1], size: length, river: R.id, order: R.order, ends: R.ends, flow: mouth[2] });
  }
  // the coast's forms: deltas, estuaries, spits and lagoons (in the map)
  for (const c of L.coasts ?? []) if (frame.inMap(c.x, c.y)) out.push({ id: idFor(L, c.kind, c.x, c.y), kind: c.kind, x: c.x, y: c.y, size: c.size });
  // where rivers run out on dry land: salt pans, seasonal lakes, marshes (in the map)
  for (const c of L.sinks ?? []) if (frame.inMap(c.x, c.y)) out.push({ id: idFor(L, c.kind, c.x, c.y), kind: c.kind, x: c.x, y: c.y, size: c.size, river: c.river });
  for (const [x, y, rid] of L.marks?.falls ?? []) out.push({ id: idFor(L, "falls", x, y), kind: "falls", x, y, size: 0, river: rid });

  // ranges: from their spines, where they stand on land
  for (const sp of L.spines) {
    if (!sp.points?.length) continue;
    let sx = 0, sy = 0, k = 0, length = 0;
    for (let q = 0; q < sp.points.length; q++) { const [x, y] = sp.points[q]; if (q) { const dx = x - sp.points[q - 1][0], dy = y - sp.points[q - 1][1]; length += Math.sqrt(dx * dx + dy * dy); } const j = L.grid.nearest(x, y); if (landMask[j] && h[j] > 0.3) { sx += x; sy += y; k++; } }
    if (k < 3) continue;
    const x = sx / k, y = sy / k;
    out.push({ id: sp.id ? `range-${sp.id}` : idFor(L, "range", x, y, sp.plates ? sp.plates[0] * 64 + sp.plates[1] : 0), kind: "range", x, y, size: length, from: sp.kind, feature: sp.id ?? null, points: sp.points });
  }

  // peaks: the highest node within about 40 miles, standing well above its surroundings
  const R = Math.max(2, Math.round(40 / L.spacing));
  for (let i = 0; i < n; i++) {
    if (!landMask[i] || h[i] < 0.55 || !inMap(i)) continue;
    let top = true, low = h[i];
    // (a walk out R rings through neighbors)
    const seen = new Set([i]); let ring = [i];
    for (let r = 0; r < R && top; r++) {
      const next = [];
      for (const a of ring) for (let e = g.indptr[a]; e < g.indptr[a + 1]; e++) { const b = g.indices[e]; if (seen.has(b)) continue; seen.add(b); if (h[b] > h[i]) { top = false; break; } if (h[b] < low) low = h[b]; next.push(b); }
      ring = next;
    }
    if (top && h[i] - low > 0.25) out.push({ id: idFor(L, "peak", g.x[i], g.y[i]), kind: "peak", x: g.x[i], y: g.y[i], size: 0, height: h[i] });
  }

  // drainage basins: the outlet each land node drains to; big ones are regions, and passes cross their divides
  const basin = new Int32Array(n).fill(-1);
  const outletOf = (i) => { let j = i, k = 0; while (rec[j] !== j && landMask[j] && k < n) { j = rec[j]; k++; } return j; };
  const memo = new Map();
  for (let i = 0; i < n; i++) if (landMask[i]) { const o = outletOf(i); basin[i] = o; memo.set(o, (memo.get(o) ?? 0) + g.area[i]); }
  const bigBasin = (o) => (memo.get(o) ?? 0) > 0.02 * landTotal;
  for (const [o, a] of memo) if (a > 0.05 * landTotal) { const nodes = []; for (let i = 0; i < n; i++) if (basin[i] === o && inMap(i)) nodes.push(i); if (nodes.length) push("basin", nodes, { key: o % 977 }); }
  const saddle = new Map();
  for (let i = 0; i < n; i++) {
    if (!landMask[i] || basin[i] < 0 || !bigBasin(basin[i]) || !inMap(i)) continue;
    for (let e = g.indptr[i]; e < g.indptr[i + 1]; e++) {
      const j = g.indices[e];
      if (j < i || !landMask[j] || basin[j] === basin[i] || !bigBasin(basin[j])) continue;
      const key = basin[i] < basin[j] ? `${basin[i]}:${basin[j]}` : `${basin[j]}:${basin[i]}`;
      const hs = Math.max(h[i], h[j]);
      const cur = saddle.get(key);
      if (!cur || hs < cur.h) saddle.set(key, { h: hs, i: h[i] > h[j] ? i : j });
    }
  }
  for (const s of saddle.values()) if (s.h > 0.2 && s.h < 0.9) out.push({ id: idFor(L, "pass", g.x[s.i], g.y[s.i]), kind: "pass", x: g.x[s.i], y: g.y[s.i], size: 0, height: s.h });

  // bays and capes: the coast where land wraps the sea (a bay) or reaches out into it (a cape)
  const f = makeField(frame.W, frame.H, 384);
  const lm = { ...f, data: new Float64Array(f.w * f.h) };
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) lm.data[y * f.w + x] = landMask[L.grid.nearest((x + 0.5) * f.cell, (y + 0.5) * f.cell)] ? 1 : 0;
  const frac = { ...lm, data: Float64Array.from(lm.data) };
  blur(frac, Math.max(2, Math.round((0.035 * Math.max(frame.mapW, frame.mapH)) / f.cell)));
  const inMapPx = (k) => { const x = k % f.w, y = (k - x) / f.w; return frame.inMap((x + 0.5) * f.cell, (y + 0.5) * f.cell); };
  const pxNodes = (test) => { const reg = regions(lm, test); const groups = reg.sizes.map(() => []); for (let k = 0; k < reg.label.length; k++) if (reg.label[k] >= 0) groups[reg.label[k]].push(k); return groups; };
  const minPx = (0.0015 * mapArea) / (f.cell * f.cell);
  for (const grp of pxNodes((k) => !lm.data[k] && frac.data[k] > 0.62 && inMapPx(k))) if (grp.length > minPx) { const k = grp[Math.floor(grp.length / 2)], x = ((k % f.w) + 0.5) * f.cell, y = (Math.floor(k / f.w) + 0.5) * f.cell; out.push({ id: idFor(L, "bay", x, y), kind: "bay", x, y, size: grp.length * f.cell * f.cell }); }
  for (const grp of pxNodes((k) => lm.data[k] && frac.data[k] < 0.3 && inMapPx(k))) if (grp.length > minPx * 0.5) { const k = grp[Math.floor(grp.length / 2)], x = ((k % f.w) + 0.5) * f.cell, y = (Math.floor(k / f.w) + 0.5) * f.cell; out.push({ id: idFor(L, "cape", x, y), kind: "cape", x, y, size: grp.length * f.cell * f.cell }); }

  // deserts, forests and marshes: big connected stretches of those biomes
  const groupsOf = { desert: ["hot-desert", "cold-steppe", "salt-flat"], forest: ["temperate-forest", "temperate-rainforest", "seasonal-forest", "rainforest", "taiga"], marsh: ["wetland"] };
  for (const [kind, list] of Object.entries(groupsOf)) {
    const set = new Set(list);
    const c = components(g, (i) => landMask[i] && set.has(L.biome[i]) && inMap(i));
    const nodesBy = c.areas.map(() => []);
    for (let i = 0; i < n; i++) if (c.comp[i] >= 0) nodesBy[c.comp[i]].push(i);
    const min = kind === "marsh" ? 0.003 : 0.02;
    nodesBy.forEach((nodes, k) => { if (c.areas[k] > min * landTotal) push(kind, nodes); });
  }
  // (ids made unique: a second feature of a kind landing on the same rounded spot gets a suffix)
  const seen = new Map();
  for (const it of out) { const c = seen.get(it.id) ?? 0; seen.set(it.id, c + 1); if (c) it.id = `${it.id}-${c + 1}`; }
  return out;
}
