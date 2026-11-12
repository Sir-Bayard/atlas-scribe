/**
 * Wild ground on a battle map: woods at battle size (trees standing apart, a crown four to six squares across, with
 * clearings), and what lies between them: undergrowth, logs, stumps, rocks in groups of three, fallen branches; and
 * fallen rock at the foot of a cliff.
 *
 * Every draw is taken whether a thing fits or not, so a building or a way removes what it stands on without moving
 * the rest. Pure: runs in the worker and under node. Positions in squares.
 */
import { pointInPolygon, bbox, shapeToPolygon, distanceToPath } from "../geom.mjs";
import { poissonInPolygon } from "../scatter.mjs";
import { makeNoise } from "../noise.mjs";
import { area as polyArea } from "../lots/poly.mjs";
import { tiersOf, shiftRight, resample } from "./terrain.mjs";

/**
 * A wood's numbers at battle size, by its density: trees apart (squares), the share of the wood left as clearings,
 * and how many of each thing on the ground for every hundred square squares.
 */
export const WILD = {
  spacing: { sparse: 5.5, open: 3.6, thick: 2.6, dense: 2.2 },
  clearing: { sparse: 0.1, open: 0.15, thick: 0.15, dense: 0.08 },
  per100: { fern: 3.2, bush: 1.2, log: 0.5, stump: 0.5, rocks: 0.35, branch: 0.8, roots: 0.25 },
};
/** The wild props' classes (each a prop item, drawn at its art's own size). */
export const WILD_PROPS = ["fern", "log", "stump", "rock", "boulder", "branch", "roots", "leaves"];
/** A wild prop's scale (of its art) when a plan places one without a size: the middle of what the woods give theirs. */
export const WILD_SCALE = { fern: 0.95, log: 0.88, stump: 0.52, rock: 0.75, boulder: 0.85, branch: 0.95, roots: 0.95, leaves: 0.8 };

/**
 * Fills one woods area at battle size. area: the plan feature; r: its random stream; free(x, y, rad): whether a spot
 * is clear; season. Returns the items made (trees and props) and notes.
 */
export function battleWoods({ area, r, free, season, keepOut = () => false }) {
  const poly = shapeToPolygon(area.shape, area.rot ?? 0);
  if (poly.length < 3 || !(polyArea(poly) > 0)) return { items: [], notes: [] };
  const kind = ["sparse", "open", "thick", "dense"].includes(area.density) ? area.density : "thick";
  const spacing = WILD.spacing[kind];
  const winter = season === "winter";
  const clear = makeNoise(r.int(2 ** 31), `${area.id}/clearings`, { scale: 9, octaves: 2 });
  // (the noise level under which a clearing opens: the share of the wood its density leaves open)
  const level = quantile(poly, clear, WILD.clearing[kind]);
  const open = (x, y) => clear(x, y) < level;
  const items = [];
  const tr = r.fork("trees");
  // (as many points as the wood can hold, up to settlement woods' cap, so a big wood has no bare patch)
  const pts = poissonInPolygon(poly, spacing, r.fork("points"), { max: 20000 });
  const leafy = area.mix?.bare ?? (winter ? 0.3 : 0.55);
  let n = 0;
  for (const [x, y] of pts) {
    const bare = tr.next() < leafy, u = tr.next(), rot = tr.next() * 360, variant = tr.int(8), size = tr.pick(["large", "large", "medium"]);
    if (open(x, y) || keepOut(x, y, 1) || !free(x, y, 0.6)) continue;
    n++;
    items.push(bare
      ? { kind: "tree", id: `${area.id}/t${n}`, from: area.id, x, y, species: "bare", size: null, s: 0.5 + u * 0.5, rot, variant, wild: true }
      : { kind: "tree", id: `${area.id}/t${n}`, from: area.id, x, y, species: "conifer", size, s: 0.4 + u * 0.6, rot, variant, wild: true });
  }
  // The ground between: each kind from its own stream, so one kind changing moves no other
  const a = polyArea(poly);
  // (what stands on the ground so far, so no two pieces lie on each other: { x, y, r })
  const taken = items.filter((i) => i.kind === "tree").map((t) => ({ x: t.x, y: t.y, r: 0.4 }));
  const clash = (x, y, rad) => taken.some((t) => Math.hypot(t.x - x, t.y - y) < t.r + rad);
  const per = (c) => Math.round((a / 100) * WILD.per100[c] * (kind === "sparse" ? 0.6 : 1));
  // Rocks in groups of three: a boulder and two smaller stones beside it (first, as the biggest)
  const gr = r.fork("rocks");
  const [bx0, by0, bx1, by1] = bbox(poly);
  let g = 0;
  for (let i = 0; i < per("rocks"); i++) {
    const x = gr.range(bx0, bx1), y = gr.range(by0, by1), turn = gr.next() * 360;
    const parts = [[0, 0, "boulder", gr.range(0.7, 1)], [gr.range(1, 1.6), gr.range(-0.6, 0.6), "rock", gr.range(0.6, 0.9)], [gr.range(-1.4, -0.8), gr.range(0.3, 1.1), "rock", gr.range(0.45, 0.7)]];
    const vs = parts.map(() => gr.int(12));
    if (!pointInPolygon([x, y], poly) || keepOut(x, y, 1.6) || !free(x, y, 1.2) || clash(x, y, 1.8)) continue;
    g++;
    taken.push({ x, y, r: 1.8 });
    const t = (turn * Math.PI) / 180;
    parts.forEach(([u, v, cls, sc], j) => items.push({ kind: "prop", id: `${area.id}/rocks${g}-${j + 1}`, from: area.id, class: cls, x: x + u * Math.cos(t) - v * Math.sin(t), y: y + u * Math.sin(t) + v * Math.cos(t), rot: (turn + j * 77) % 360, variant: vs[j], scale: sc, wild: true }));
  }
  const put = (cls, count, opts = {}) => {
    const kr = r.fork(cls);
    const [x0, y0, x1, y1] = bbox(poly);
    const rad = opts.r ?? 0.6;
    let k = 0;
    for (let i = 0; i < count; i++) {
      const x = kr.range(x0, x1), y = kr.range(y0, y1), rot = kr.next() * 360, variant = kr.int(12), sc = kr.range(opts.min ?? 0.8, opts.max ?? 1.1);
      if (!pointInPolygon([x, y], poly) || keepOut(x, y, rad) || !free(x, y, rad) || clash(x, y, rad)) continue;
      if (opts.inOpen === false && open(x, y)) continue;
      taken.push({ x, y, r: rad });
      items.push({ kind: "prop", id: `${area.id}/${cls}${++k}`, from: area.id, class: opts.as ?? cls, x, y, rot, variant, scale: sc, wild: true });
    }
  };
  put("log", per("log"), { r: 1.8, min: 0.75, max: 1 });
  put("stump", per("stump"), { r: 0.9, min: 0.45, max: 0.6 });
  put("bush", per("bush"), { r: 0.6, as: "bush" });
  put("roots", per("roots"), { r: 0.9, inOpen: false });
  if (!winter) put("fern", per("fern"), { r: 0.5 });
  put("branch", per("branch"), { r: 0.4 });
  if (season === "autumn") put("leaves", per("fern"), { r: 0.6, min: 0.6, max: 1 });
  return { items, notes: [] };
}

/**
 * Fallen rock at the foot of a cliff: groups of three along its foot, a group for about every six squares of cliff,
 * a few lying out past it. edge: a terrain edge (cliff style); r its stream.
 */
export function rockfall({ edge, r, free }) {
  if (edge.style !== "cliff") return [];
  const n = tiersOf(edge.drop);
  const foot = shiftRight(resample(edge.path, 0.5), 0.45 + (n - 1) * 0.38 + 0.9);
  let len = 0;
  for (let i = 1; i < foot.length; i++) len += Math.hypot(foot[i][0] - foot[i - 1][0], foot[i][1] - foot[i - 1][1]);
  const out = [];
  const groups = Math.floor(len / 6);
  for (let g = 0; g < groups; g++) {
    const at = foot[Math.min(foot.length - 1, Math.floor(r.range(0, 1) * foot.length))], out1 = r.range(0, 1.4), turn = r.next() * 360;
    const vs = [r.int(12), r.int(12), r.int(12)], sc = [r.range(0.6, 0.9), r.range(0.4, 0.6), r.range(0.35, 0.5)];
    const i = foot.indexOf(at), a = foot[Math.max(0, i - 1)], b = foot[Math.min(foot.length - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
    const c = [at[0] + nx * out1, at[1] + ny * out1];
    // (the rubble lies against the cliff's own band, so only the spot itself must be clear)
    if (!free(c[0], c[1], 0.15)) continue;
    [[0, 0], [0.9, 0.3], [-0.7, 0.5]].forEach(([u, v], j) => {
      const t = (turn * Math.PI) / 180;
      out.push({ kind: "prop", id: `${edge.id}/fall${g + 1}-${j + 1}`, from: edge.from, class: j ? "rock" : "boulder", x: c[0] + u * Math.cos(t) - v * Math.sin(t), y: c[1] + u * Math.sin(t) + v * Math.cos(t), rot: (turn + j * 101) % 360, variant: vs[j], scale: sc[j], wild: true });
    });
  }
  return out;
}

/**
 * Loose rock on a wild battle map's open ground (M6 chunk 10: a hand-built winter map has snowy rocks and boulders lying
 * about the open snow, which made AtlasScribe's look bare): groups of a boulder and a stone or two, and lone stones,
 * so many for each hundred squares of the map (OPEN_ROCKS), each kept clear of what's there (free: the layout's test;
 * near(x, y, r): whether anything already laid, a tree or a prop, lies within r).
 */
export const OPEN_ROCKS = { groups: 0.45, singles: 1.2, gap: 1.6, clump: 7, edge: 2, edgeBoost: 2.5 };

/**
 * edges: the map's drops ([{ path, style }]): rock gathers along the top of a bank or cliff, as it does where ground
 * breaks, edgeBoost times as likely within edge squares of one. Elsewhere it lies in looser and thicker patches (a noise
 * over clump squares), so the open ground isn't evenly peppered.
 */
export function openRocks({ W, H, r, free, near = () => false, edges = [] }) {
  const items = [];
  const groups = Math.round((W * H * OPEN_ROCKS.groups) / 100), singles = Math.round((W * H * OPEN_ROCKS.singles) / 100);
  const gr = r.fork("groups"), sr = r.fork("singles");
  const patch = makeNoise(r.int(2 ** 31), "open-rocks", { scale: OPEN_ROCKS.clump, octaves: 2 });
  const lines = edges.filter((e) => Array.isArray(e.path) && e.path.length >= 2 && e.style !== "slope");
  // (how likely a spot is to take a rock, 0 to 1: thick and thin patches, more by a drop's top)
  const likely = (x, y) => Math.min(1, Math.max(0.08, 0.5 + patch(x, y) * 0.8) * (lines.some((e) => distanceToPath([x, y], e.path) < OPEN_ROCKS.edge) ? OPEN_ROCKS.edgeBoost : 1));
  const taken = [];
  const clash = (x, y, d) => taken.some((t) => Math.hypot(t[0] - x, t[1] - y) < d + t[2]);
  let g = 0;
  for (let i = 0; i < groups * 6 && g < groups; i++) {
    const x = gr.range(1, W - 1), y = gr.range(1, H - 1), turn = gr.next() * 360, vs = [gr.int(12), gr.int(12), gr.int(12)];
    const parts = [[0, 0, "boulder", gr.range(0.55, 0.85)], [gr.range(0.9, 1.4), gr.range(-0.5, 0.5), "rock", gr.range(0.5, 0.8)], [gr.range(-1.2, -0.7), gr.range(0.2, 0.9), "rock", gr.range(0.4, 0.6)]];
    const keep = gr.next() < 0.5 ? 2 : 3;
    if (gr.next() > likely(x, y) || !free(x, y, 1.2) || near(x, y, OPEN_ROCKS.gap) || clash(x, y, 2)) continue;
    g++;
    taken.push([x, y, 1.6]);
    const t = (turn * Math.PI) / 180;
    parts.slice(0, keep).forEach(([u, v, cls, sc], j) => items.push({ kind: "prop", id: `ground/rocks${g}-${j + 1}`, from: "ground", class: cls, x: x + u * Math.cos(t) - v * Math.sin(t), y: y + u * Math.sin(t) + v * Math.cos(t), rot: (turn + j * 83) % 360, variant: vs[j], scale: sc, wild: true }));
  }
  let k = 0;
  for (let i = 0; i < singles * 6 && k < singles; i++) {
    const x = sr.range(0.5, W - 0.5), y = sr.range(0.5, H - 0.5);
    if (sr.next() > likely(x, y) || !free(x, y, 0.5) || near(x, y, 0.9) || clash(x, y, 0.6)) continue;
    k++;
    taken.push([x, y, 0.4]);
    items.push({ kind: "prop", id: `ground/stone${k}`, from: "ground", class: "rock", x, y, rot: sr.next() * 360, variant: sr.int(12), scale: sr.range(0.4, 0.7), wild: true });
  }
  return items;
}

/** The noise value under which the share `q` of a polygon lies (measured on a grid over it). */
function quantile(poly, noise, q) {
  if (!(q > 0)) return -Infinity;
  const [x0, y0, x1, y1] = bbox(poly);
  const step = Math.max(0.5, Math.sqrt(((x1 - x0) * (y1 - y0)) / 20000));
  const vals = [];
  for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) if (pointInPolygon([x, y], poly)) vals.push(noise(x, y));
  vals.sort((a, b) => a - b);
  return vals.length ? vals[Math.min(vals.length - 1, Math.floor(q * vals.length))] : -Infinity;
}

/** Whether a point is within d of a path (a cheap guard for keep-outs). */
export const nearPath = (p, path, d) => distanceToPath(p, path) < d;
