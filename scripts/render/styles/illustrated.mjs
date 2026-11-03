/**
 * The "illustrated" style: a map drawn, not textured. One light palette, ink lines along every edge, the built-up
 * ground of a town or city as a single pale mass, roofs in two tones, trees as clumped canopies, water with its banks
 * inked (lines following a lake's shore, a dashed ripple down a river), and a faint paper grain over all. It needs no art, so every user gets it,
 * and it reads at city scale, where battle-map textures repeat into noise. Numbers are in squares.
 *
 * paint(ctx) takes the same ctx as the other styles; art is never asked for.
 */
import { fallbackColor } from "../../core/roles.mjs";
import { roofFacets, outlineOf } from "../roofs.mjs";
import { offset, union, difference, intersect, bands, shapes } from "../../core/lots/poly.mjs";
import { wayDirectionAt, paintRows, tangentBand } from "./textured.mjs";

/** The widest blur, in squares (a town's built-up ground fades at its edge), so tiles get a margin for it. */
export const MAX_BLUR = 1.5;

/** It needs no art. */
export const rolesFor = () => [];

/** The palette. Summer, with what spring, autumn and winter change. */
const PALETTE = {
  land: [178, 190, 140], // the country: a soft sage
  urban: [212, 202, 176], // a city's built-up ground
  street: [230, 221, 198],
  edge: [138, 116, 84], // a street's inked edge
  ink: [58, 46, 36],
  paper: [236, 226, 200], // what every color leans toward, so they sit together
  water: [152, 194, 196],
  deep: [128, 176, 184],
  bank: [206, 194, 156],
  waterInk: [70, 112, 122],
  stone: [204, 196, 176],
  shadow: "rgba(66,52,34,0.18)",
  canopy: [104, 132, 78],
  canopyInk: [56, 70, 42],
  lawn: [168, 186, 120],
};
const SEASON = {
  autumn: { land: [186, 186, 136], canopy: [150, 130, 70], canopyMix: [[170, 112, 58], [128, 132, 70], [176, 146, 66]] },
  winter: { land: [226, 230, 232], urban: [230, 228, 222], street: [244, 244, 242], canopy: [96, 112, 96], lawn: [214, 222, 226], water: [176, 200, 212], deep: [160, 188, 204] },
  spring: { land: [172, 192, 132] },
};

const rgb = ([r, g, b], a = 1) => (a >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`);
const mixA = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
/** [r, g, b] of "#rrggbb" or "rgb(...)"; mid gray for anything else. */
function rgbOf(color) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) { const n = parseInt(hex[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  const fn = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(color);
  return fn ? [+fn[1], +fn[2], +fn[3]] : [153, 153, 153];
}
/** A color drawn into the palette: softened toward the paper and a little less saturated. */
function tame(c, k, paper) {
  const gray = (c[0] + c[1] + c[2]) / 3;
  return mixA(mixA(c, [gray, gray, gray], 0.18), paper, k);
}
/** The distance from p to the segment a-b. */
function segDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
}
/** A small stable hash of a number pair, 0 to 1 (for per-item variety without a stream). */
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
/** A smooth wander, -1 to 1, fixed to the map (so tiles join): a hand's unsteadiness. */
const wander = (x, y) => Math.sin(x * 1.31 + y * 0.37) * 0.5 + Math.sin(x * 0.53 - y * 1.73 + 1.7) * 0.32 + Math.sin(x * 2.9 + y * 2.3) * 0.18;
/** A path redrawn by hand: a point every 0.4 squares, each moved across the line by up to amp squares. */
function wobble(pts, amp) {
  if (!amp || pts.length < 2) return pts;
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(l / 0.4));
    const nx = l ? -(b[1] - a[1]) / l : 0, ny = l ? (b[0] - a[0]) / l : 0;
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      // (the ends stay put, so lines still meet)
      const end = (i === 1 && k === 0) || (i === pts.length - 1 && k === n);
      const d = end ? 0 : wander(x, y) * amp;
      out.push([x + nx * d, y + ny * d]);
    }
  }
  return out;
}

/** The surfaces a street or square can have: a tone, an edge, and the marks a hand would stipple or rule on it. */
const SURFACE = {
  cobble: { c: [188, 183, 171], marks: "stones" },
  setts: { c: [184, 181, 175], marks: "grid" },
  flagstone: { c: [202, 197, 184], marks: "flags" },
  tiles: { c: [198, 192, 180], marks: "grid" },
  brick: { c: [190, 150, 122], marks: "grid" },
  herringbone: { c: [190, 158, 132], marks: "diagonal" },
  gravel: { c: [212, 202, 180], marks: "specks" },
  dirt: { c: [196, 170, 128], marks: "specks", soft: true },
  trodden: { c: [196, 180, 142], marks: "specks", soft: true },
  mud: { c: [176, 156, 120], marks: "specks", soft: true },
  slush: { c: [214, 214, 210], marks: "specks", soft: true },
  snow: { c: [240, 242, 244], soft: true },
  grass: { c: [168, 186, 120], soft: true },
};
/** How a street's surface ranks where two meet: the better paving is laid last, so it runs through the junction. */
const RANK = { trodden: 0, mud: 0, snow: 0, grass: 0, dirt: 1, slush: 1, gravel: 2, cobble: 3, setts: 4, tiles: 4, brick: 4, flagstone: 5, herringbone: 5 };

const areaOf = (pts) => Math.abs(pts.reduce((sum, [x, y], i) => { const [x2, y2] = pts[(i + 1) % pts.length]; return sum + x * y2 - x2 * y; }, 0) / 2);
const inside = ([x, y], pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const meanOf = (pts) => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
const okPoly = (pts) => Array.isArray(pts) && pts.length >= 3 && pts.every((p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]));
const BUILT = { city: 1, town: 0.8, village: 0.5, hamlet: 0.35, roadside: 0.35 };

/**
 * What doesn't change from tile to tile, worked out once per layout (a big map is painted in several tiles):
 * masses, the built-up ground of each settlement (all its districts joined, crisp inside a town wall, else fading
 * out), and zones, the open ground about the squares paved through (each with the square whose paving it takes).
 */
const GEOMETRY = new WeakMap();
function geometryOf(L) {
  if (GEOMETRY.has(L)) return GEOMETRY.get(L);
  const items = (kind, cls) => L.items.filter((i) => i.kind === kind && (cls === undefined || i.class === cls));
  // Settlements: every district joined; each mass as built up as the most built-up district in it
  const ds = items("district").filter((d) => okPoly(d.poly));
  const walls = items("wall").filter((w) => w.thickness && okPoly(w.path) && Math.hypot(w.path[0][0] - w.path.at(-1)[0], w.path[0][1] - w.path.at(-1)[1]) < 0.05);
  let masses = [];
  try {
    masses = shapes(union(ds.map((d) => d.poly))).map(({ outer, holes }) => {
      const mine = ds.filter((d) => inside(meanOf(d.poly), outer));
      const k = Math.max(0.35, ...mine.map((d) => BUILT[d.profile] ?? 0.6));
      return { rings: [outer, ...holes], k, crisp: walls.some((w) => inside(meanOf(outer), w.path)) };
    });
  } catch { masses = ds.map((d) => ({ rings: [d.poly], k: BUILT[d.profile] ?? 0.6, crisp: false })); }
  // Places: the squares and centerpiece squares (not a narrow way in, like a gate's) grown a little and those near each
  // other joined, the gaps between them closed
  const opens = [...items("surface", "square"), ...items("surface", "plaza")].filter((o) => okPoly(o.poly));
  const big = opens.filter((o) => areaOf(o.poly) >= 4);
  let places = [];
  try { places = big.length ? offset(union(offset(big.map((o) => o.poly), 1.4)), -0.7) : []; } catch { places = []; }
  // (and the small islands of ground left between a place, the streets into it and each other, paved into it: a corner
  // a few squares across, where the streets meet it at an angle; each place against the ways near it only)
  const ways = items("way").filter((w) => !w.faint && Array.isArray(w.path) && w.path.length >= 2 && w.path.every((p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1])) && w.width > 0);
  const gaps = [];
  for (const z of places) {
    try {
      const xs = z.map((p) => p[0]), ys = z.map((p) => p[1]), b = [Math.min(...xs) - 3, Math.min(...ys) - 3, Math.max(...xs) + 3, Math.max(...ys) + 3];
      // (any stretch crossing the box, not only a way with a point in it: a long street can run past a square)
      const cuts = (p, q) => Math.max(p[0], q[0]) > b[0] && Math.min(p[0], q[0]) < b[2] && Math.max(p[1], q[1]) > b[1] && Math.min(p[1], q[1]) < b[3] && segDist([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], p, q) < Math.hypot(b[2] - b[0], b[3] - b[1]) / 2;
      const near = ways.filter((w) => w.path.some((p, i) => i > 0 && cuts(w.path[i - 1], p)));
      if (!near.length) continue;
      const U = union([z, ...bands(near.map((w) => ({ path: w.path, half: w.width / 2 })))]);
      gaps.push(...difference(offset(offset(U, 1.2), -1.2), U).filter((gp) => areaOf(gp) > 0.02 && areaOf(gp) < 6 && intersect(offset([gp], 0.2), [z]).length));
    } catch { /* (no islands for this place) */ }
  }
  if (gaps.length) try { places = union([...places, ...offset(gaps, 0.08)]); } catch { /* (the places as they were) */ }
  // Each zone takes the paving of the biggest square in it (the town square first), else of the nearest
  const zones = places.filter((z) => z.length >= 3).map((z) => {
    const mine = big.filter((o) => o.poly.some((p) => inside(p, z)));
    const c = meanOf(z);
    const o = mine.sort((a, b) => (b.class === "square") - (a.class === "square") || areaOf(b.poly) - areaOf(a.poly))[0]
      ?? [...big].sort((a, b) => Math.hypot(...meanOf(a.poly).map((v, i) => v - c[i])) - Math.hypot(...meanOf(b.poly).map((v, i) => v - c[i])))[0];
    return { o, z: [z] };
  });
  const out = { masses, opens, zones };
  GEOMETRY.set(L, out);
  return out;
}

export function paint(ctx) {
  const { g, W, H, x0, y0, pp, layout: L, progress = () => {} } = ctx;
  const s = L.season;
  const winter = s === "winter";
  const P = { ...PALETTE, ...(SEASON[s] ?? {}) };
  const X = (x) => (x - x0) * pp, Y = (y) => (y - y0) * pp;
  const items = (kind, cls) => L.items.filter((i) => i.kind === kind && (cls === undefined || i.class === cls));
  const col = (role) => rgbOf(fallbackColor(role));
  const px = (sq, min = 1) => Math.max(min, sq * pp);
  const inkW = Math.max(1, pp * 0.035);
  const path = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); };
  const poly = (pts) => { path(pts); g.closePath(); };
  const fillPoly = (pts, fill) => { g.fillStyle = fill; poly(pts); g.fill(); };
  const inkPoly = (pts, color = rgb(P.ink, 0.7), w = inkW) => { g.strokeStyle = color; g.lineWidth = w; poly(pts); g.stroke(); };
  const stroke = (pts, width, color, min = 1) => { g.strokeStyle = color; g.lineWidth = px(width, min); path(pts); g.stroke(); };
  const dot = (x, y, r, fill) => { g.fillStyle = fill; g.beginPath(); g.arc(X(x), Y(y), Math.max(0.8, r * pp), 0, 2 * Math.PI); g.fill(); };
  g.lineCap = "round"; g.lineJoin = "round";

  // The country, with soft lighter and darker patches
  progress(0.05, "Ground");
  const ground = L.items.find((i) => i.kind === "ground");
  g.fillStyle = rgb(P.land); g.fillRect(0, 0, W, H);
  for (const [x, y, r, t] of ground?.patches ?? []) {
    if (t < 0.4) dot(x, y, r, rgb(mixA(P.land, P.paper, 0.3), 0.18));
    else if (t > 0.75) dot(x, y, r * 0.7, rgb(mixA(P.land, [90, 104, 70], 0.3), 0.1));
  }

  // Fields: each in its crop's color drawn into the palette, marked as a hand would mark that crop (furrows ruled
  // close for plowed land, broken rows of stubble, stippled ripe grain, tufts on pasture and fallow), inked round
  const tufts = fieldMarks(ctx, P);
  for (const f of items("field").filter((f) => okPoly(f.poly))) {
    const c = winter ? mixA(tame(col(`field.${f.crop}.${s}`), 0.5, P.paper), P.land, 0.6) : tame(col(`field.${f.crop}.${s}`), 0.5, P.paper);
    const edge = wobble([...f.poly, f.poly[0]], 0.04);
    const ring = (pts) => { pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); };
    const outline = () => { g.beginPath(); ring(edge); for (const h of f.holes ?? []) ring(h); };
    g.fillStyle = rgb(f.shade >= 0 ? mixA(c, P.paper, 0.06 * f.shade) : mixA(c, [80, 70, 50], -0.06 * f.shade));
    outline(); g.fill("evenodd");
    g.save(); outline(); g.clip("evenodd");
    const dark = mixA(c, P.ink, 0.45);
    const rows = { ...f, rows: Math.max(0.18, f.rows ?? 0.3) };
    if (f.crop === "plowed") paintRows(g, rows, X, Y, pp, rgb(dark, 0.45), Math.max(1, pp * 0.045));
    else if (f.crop === "stubble") { g.setLineDash([px(0.22), px(0.18)]); paintRows(g, { ...rows, rows: rows.rows * 1.3 }, X, Y, pp, rgb(dark, 0.4), Math.max(1, pp * 0.035)); g.setLineDash([]); }
    else if (f.crop === "growing") paintRows(g, rows, X, Y, pp, rgb(mixA(c, [60, 90, 40], 0.5), 0.45), Math.max(1, pp * 0.05));
    else if (f.crop === "ripe") { paintRows(g, { ...rows, rows: rows.rows * 1.6 }, X, Y, pp, rgb(dark, 0.18), Math.max(1, pp * 0.03)); if (tufts.grain) { g.fillStyle = tufts.grain; outline(); g.fill("evenodd"); } }
    else if (f.crop === "hay") paintRows(g, { ...rows, rows: rows.rows * 2.2 }, X, Y, pp, rgb(mixA(c, P.paper, 0.4), 0.8), Math.max(1, pp * 0.12));
    else if (tufts.tuft) { g.fillStyle = tufts.tuft; outline(); g.fill("evenodd"); }
    g.restore();
    g.strokeStyle = rgb(P.ink, 0.3); g.lineWidth = Math.max(1, pp * 0.025); outline(); g.stroke();
  }

  // The built-up ground: every town and city district one pale mass (a village's a lighter wash of it)
  progress(0.15, "Districts");
  const geo = geometryOf(L);
  for (const m of geo.masses) {
    // (a walled city's ground runs up to its wall street; a town's or village's fades out into the fields)
    if (!m.crisp) g.filter = `blur(${Math.max(1, pp * 0.9).toFixed(1)}px)`;
    g.globalAlpha = m.k; g.fillStyle = rgb(P.urban);
    g.beginPath(); for (const r of m.rings) { r.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); } g.fill("nonzero");
    g.globalAlpha = 1; g.filter = "none";
  }
  // A quarter's character, only as a whisper: lawns for the nobles and the temple, a little dust for the poor
  for (const qg of items("surface", "quarter")) {
    if (qg.lush) { g.globalAlpha = 0.45; fillPoly(qg.poly, rgb(P.lawn)); g.globalAlpha = 1; continue; }
    if (qg.mud) { g.globalAlpha = 0.12; fillPoly(qg.poly, rgb([170, 146, 108])); g.globalAlpha = 1; }
  }
  // The open ground about the squares, paved through: each square and centerpiece square grown a little, so the
  // corners left between a square, its streets and the house fronts read as part of the place, not as gaps (the
  // houses stand over it; lawns and yards are laid after)
  const { opens, zones } = geo;
  const marks = surfaceMarks(ctx, P);
  const placeOf = (o) => SURFACE[o?.surface] ?? SURFACE.cobble;
  const zone = zones.flatMap((x) => x.z);
  const ringsOf = (polys) => { g.beginPath(); for (const z of polys) { z.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); } };
  for (const { z } of zones) { ringsOf(z); g.strokeStyle = rgb(P.edge); g.lineWidth = px(0.16); g.stroke(); }
  for (const { o, z } of zones) {
    const S = placeOf(o);
    ringsOf(z); g.fillStyle = rgb(mixA(S.c, P.paper, 0.2)); g.fill("nonzero");
    const m = marks(S.marks); if (m) { g.fillStyle = m; g.fill("nonzero"); }
  }
  /** Clips what's drawn next to outside the given polygons (restore after). */
  const clipOut = (polys) => {
    g.save();
    if (!polys.length) return;
    g.beginPath(); g.rect(-10, -10, W + 20, H + 20);
    for (const z of polys) { z.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); }
    g.clip("evenodd");
  };
  // Yards, farmyards and trodden ground: a shade darker than what's around them
  for (const a of items("surface", "trodden")) { g.globalAlpha = 0.35; fillPoly(a.poly, rgb(mixA(P.urban, P.edge, 0.25))); g.globalAlpha = 1; }
  for (const y of [...items("surface", "yard"), ...items("surface", "farmyard")]) {
    fillPoly(y.poly, rgb(mixA(P.urban, P.edge, 0.12)));
    inkPoly(y.poly, rgb(P.ink, 0.25), Math.max(1, pp * 0.02));
  }
  // Gardens and crofts: green inside the blocks
  for (const gd of items("surface", "garden")) {
    const { cx, cy, w, d, rot } = gd.garden;
    g.save(); g.translate(X(cx), Y(cy)); g.rotate((rot * Math.PI) / 180);
    g.fillStyle = rgb(P.lawn, 0.8); g.fillRect((-w / 2) * pp, (-d / 2) * pp, w * pp, d * pp);
    g.strokeStyle = rgb(P.ink, 0.3); g.lineWidth = Math.max(1, pp * 0.02); g.strokeRect((-w / 2) * pp, (-d / 2) * pp, w * pp, d * pp);
    g.restore();
  }
  for (const c of items("surface", "croft")) { g.globalAlpha = 0.5; fillPoly(c.poly, rgb(P.lawn)); g.globalAlpha = 1; }
  // Parks, lawns and churchyards: lawn with inked paths
  for (const pk of items("surface", "park")) {
    fillPoly(pk.poly, rgb(P.lawn)); inkPoly(pk.poly, rgb(P.ink, 0.35));
    for (const w of pk.paths ?? []) { stroke(w.path, w.width + 0.08, rgb(P.edge, 0.7)); stroke(w.path, w.width, rgb(P.street)); }
    if (pk.basin) { const { at, radius } = pk.basin; dot(at[0], at[1], radius + 0.12, rgb(P.stone)); dot(at[0], at[1], radius, rgb(P.water)); }
  }
  for (const ln of [...items("surface", "lawn"), ...items("surface", "garth"), ...items("surface", "churchyard")]) fillPoly(ln.poly, rgb(P.lawn, 0.85));
  for (const pt of items("pit")) dot(pt.x, pt.y, pt.size * 0.45, rgb(mixA(P.edge, P.ink, 0.3), 0.7));
  for (const kl of items("kiln")) { dot(kl.x, kl.y, kl.rad, rgb([176, 110, 84])); dot(kl.x, kl.y, kl.rad * 0.4, rgb(P.ink)); }
  // Hedges, walls and fences between plots and fields
  for (const b of items("boundary")) {
    if (b.class === "hedge" || b.class === "clipped") stroke(b.path, b.class === "clipped" ? 0.16 : 0.1, rgb(mixA(P.canopy, P.canopyInk, 0.4)));
    else if (b.class === "balk") stroke(b.path, 0.08, rgb(mixA(P.land, P.paper, 0.3)));
    else stroke(b.path, 0.035, rgb(P.ink, 0.35));
  }
  for (const w of items("wall").filter((w) => !w.thickness)) { stroke(w.path, 0.15, rgb(P.ink, 0.75), 1.5); stroke(w.path, 0.09, rgb(P.stone)); }
  // Cliffs: a hatched face from top to toe, inked along the top
  for (const c of items("cliff")) {
    fillPoly([...c.path, ...[...c.toe].reverse()], rgb(tame(c.rock === "slate" ? [128, 130, 134] : [150, 132, 108], 0.2, P.paper)));
    g.save(); g.strokeStyle = rgb(P.ink, 0.5); g.lineWidth = Math.max(1, 0.03 * pp);
    let carry = 0;
    for (let i = 1; i < c.path.length; i++) {
      const a = c.path[i - 1], b = c.path[i], ta = c.toe[i - 1], tb = c.toe[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = carry; t < l; t += 0.22) {
        const f = t / l, p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], q = [ta[0] + (tb[0] - ta[0]) * f, ta[1] + (tb[1] - ta[1]) * f], long = Math.round(t / 0.22) % 2 ? 1 : 0.6;
        g.beginPath(); g.moveTo(X(p[0]), Y(p[1])); g.lineTo(X(p[0] + (q[0] - p[0]) * long), Y(p[1] + (q[1] - p[1]) * long)); g.stroke();
      }
      carry = Math.max(0, 0.22 - ((l - carry) % 0.22)) % 0.22;
    }
    g.restore();
    stroke(c.path, 0.07, rgb(P.ink, 0.9));
  }
  for (const d of items("ditch")) { stroke(d.path, d.width, rgb(mixA(P.land, P.ink, 0.15))); stroke(d.path, d.width * 0.4, rgb(mixA(P.land, P.ink, 0.28))); }

  // Water: a pale bank, an inked edge, the water and a deeper middle; a lake's or the sea's shore lines
  progress(0.35, "Water");
  const runs = items("water").filter((w) => Array.isArray(w.path) && w.path.length >= 2), lakes = items("water").filter((w) => okPoly(w.poly) && okPoly(w.ring));
  const line = (w, add, color) => {
    if (!w.widths) return stroke(w.path, w.width + add, color);
    g.fillStyle = color; g.beginPath();
    w.path.forEach(([x, y], i) => {
      const r = Math.max(0.5, ((w.widths[i] + add) / 2) * pp);
      g.moveTo(X(x) + r, Y(y)); g.arc(X(x), Y(y), r, 0, 2 * Math.PI);
      if (!i) return;
      const [px0, py0] = w.path[i - 1], r0 = Math.max(0.5, ((w.widths[i - 1] + add) / 2) * pp);
      const band = tangentBand(X(px0), Y(py0), r0, X(x), Y(y), r);
      if (!band) return;
      g.moveTo(...band[0]); g.lineTo(...band[1]); g.lineTo(...band[2]); g.lineTo(...band[3]); g.closePath();
    });
    g.fill("nonzero");
  };
  const water = P.water;
  for (const w of runs) line(w, 0.9, rgb(P.bank));
  for (const b of lakes) for (const r of b.runs ?? [b.ring]) stroke(r, b.reach * 1.6, rgb(P.bank));
  for (const w of runs) line(w, 0.14, rgb(P.waterInk));
  for (const b of lakes) stroke(b.ring, 0.14, rgb(P.waterInk));
  for (const w of runs) line(w, 0, rgb(w.frozen ? [214, 226, 234] : water));
  for (const w of runs) if (!w.frozen && w.width > 1.2) line(w, -w.width * 0.45, rgb(P.deep));
  for (const b of lakes) {
    const wc = b.frozen ? [214, 226, 234] : water;
    fillPoly(b.poly, rgb(mixA(wc, P.deep, 0.5)));
    // The shallows paler, and lines following the shore out into the water, as an engraver draws a coast
    g.save(); poly(b.poly); g.clip();
    stroke(b.ring, 9, rgb(wc));
    if (!b.frozen) for (const off of [3.2, 2.0, 1.1, 0.5]) { stroke(b.ring, 2 * off + 0.09, rgb(P.paper, 0.6)); stroke(b.ring, 2 * off - 0.09, rgb(wc)); }
    g.restore();
  }
  // Ripples on a river: a thin pale dashed line down its middle
  for (const w of runs) {
    if (w.frozen || w.width < 1) continue;
    g.save(); g.setLineDash([px(0.9), px(1.6)]); g.globalAlpha = 0.5;
    stroke(w.path, Math.max(0.03, w.width * 0.02), rgb(P.paper));
    g.restore();
  }
  for (const p of items("lily")) dot(p.x, p.y, p.s * 0.3, rgb(mixA(P.lawn, [70, 100, 50], 0.4)));
  for (const t of items("reed")) dot(t.x, t.y, t.s * 0.2, rgb(mixA(P.land, [110, 96, 60], 0.5)));

  // Docks: a quay paved back from the water's edge, piers out into it
  for (const d of items("dock")) {
    const deck = d.material === "wood" ? rgb([170, 140, 104]) : rgb(mixA(P.stone, P.paper, 0.15));
    if (d.edge) { fillPoly([...d.edge, ...[...d.land].reverse()], deck); stroke(d.edge, 0.07, rgb(P.ink, 0.85)); continue; }
    g.lineCap = "butt"; stroke(d.path, d.width + 0.12, rgb(P.ink, 0.85), 2); stroke(d.path, d.width, deck); g.lineCap = "round";
  }

  // Streets and roads: an inked edge under everything, then the surface, so junctions join cleanly; squares open
  progress(0.5, "Streets");
  const ways = [...items("way")].filter((w) => !w.faint).map((w) => ({ w, path: wobble(w.path, 0.02), S: SURFACE[w.surface] ?? SURFACE.cobble, r: RANK[w.surface] ?? 3 })).sort((a, b) => a.r - b.r || a.w.width - b.w.width);
  for (const t of items("way").filter((w) => w.faint)) stroke(wobble(t.path, 0.05), t.width * 0.8, rgb(mixA(P.land, P.paper, 0.4), 0.8));
  // (square ends: a street that stops at a quay, a bridge or the map's edge stops square, with no rounded cap)
  g.lineCap = "butt";
  // (the inked edge inside the street's own width, so a house front on the street's edge meets the line, never
  // stands over it; none inside the open ground about a square)
  clipOut(zone);
  for (const { w, path: p, S } of ways) stroke(p, w.width, S.soft ? rgb(mixA(P.edge, S.c, 0.25)) : rgb(mixA(P.edge, P.ink, 0.3)));
  g.restore();
  // (about a square its own paving runs through: the streets stop where it starts)
  clipOut(zone);
  for (const { w, path: p, S } of ways) {
    const inner = Math.max(w.width * 0.5, w.width - 0.2);
    stroke(p, inner, rgb(S.c));
    const m = marks(S.marks);
    if (m) stroke(p, inner * 0.95, m);
  }
  g.restore();
  for (const o of opens) {
    const S = placeOf(o);
    fillPoly(o.poly, rgb(mixA(S.c, P.paper, 0.2)));
    const m = marks(S.marks);
    if (m) fillPoly(o.poly, m);
  }
  // (a garden's beds and a drive over its square, as the textured style lays them)
  for (const bd of items("surface", "bed")) { fillPoly(bd.poly, rgb(mixA(P.lawn, [90, 120, 60], 0.2))); inkPoly(bd.poly, rgb(P.ink, 0.35), Math.max(1, pp * 0.02)); }
  for (const dv of items("surface", "drive")) { const S = SURFACE[dv.surface] ?? SURFACE.gravel; fillPoly(dv.poly, rgb(S.c)); const m = marks(S.marks); if (m) fillPoly(dv.poly, m); inkPoly(dv.poly, rgb(P.edge, 0.6)); }
  // Boats and ships before the bridges, so one moored by a bridge passes under it; a market cross with them
  for (const p of items("prop").filter((p) => p.class === "boat" || p.class === "ship" || p.class === "cross")) {
    const w = (p.class === "boat" ? 0.2 : p.class === "ship" ? 0.8 : 0.5) * (p.scale ?? 1), Lh = p.class === "boat" ? w * 4 : p.class === "ship" ? w * 2.75 : w;
    g.save(); g.translate(X(p.x), Y(p.y)); g.rotate(((p.rot ?? 0) * Math.PI) / 180);
    g.fillStyle = p.class === "cross" ? rgb(P.stone) : rgb([150, 116, 82]); g.strokeStyle = rgb(P.ink, 0.85); g.lineWidth = Math.max(1, pp * 0.025);
    if (p.class === "cross") { g.fillRect((-w / 2) * pp, (-w / 2) * pp, w * pp, w * pp); g.strokeRect((-w / 2) * pp, (-w / 2) * pp, w * pp, w * pp); }
    else { g.beginPath(); g.ellipse(0, 0, (w / 2) * pp, (Lh / 2) * pp, 0, 0, 2 * Math.PI); g.fill(); g.stroke(); if (p.class === "ship") { g.fillStyle = rgb(P.paper); g.fillRect((-w * 0.62) * pp, (Lh * 0.04) * pp, w * 1.24 * pp, w * 0.18 * pp); } }
    g.restore();
  }
  // Bridges: the road carried over the water in its own paving, a parapet inked along each side with its ends
  // turned out onto the banks; fords as a pale shallow with the road's stones across
  const wayAt = (p) => { let best = null, bd = 1.2; for (const { w, S } of ways) for (let i = 1; i < w.path.length; i++) { const d = segDist(p, w.path[i - 1], w.path[i]); if (d < bd) { bd = d; best = { w, S }; } } return best; };
  for (const c of items("crossing").filter((c) => Number.isFinite(c.at?.[0]) && Number.isFinite(c.at?.[1]))) {
    const a = ((Number.isFinite(c.angle) ? c.angle : 0) * Math.PI) / 180, half = (c.length ?? 2) / 2, ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
    const [x, y] = c.at;
    const on = wayAt(c.at);
    if (c.class === "ford") {
      const [fx, fy] = c.dir ?? wayDirectionAt(L, c.at);
      stroke([[x - fx * 1.7, y - fy * 1.7], [x + fx * 1.7, y + fy * 1.7]], 1.1, rgb(mixA(P.bank, P.water, 0.4)));
      continue;
    }
    const wide = c.width ?? on?.w.width ?? 1, S = c.material === "wood" ? { c: [178, 150, 112], marks: null } : on?.S ?? SURFACE.cobble;
    const A = [x - ux * half, y - uy * half], B = [x + ux * half, y + uy * half];
    g.lineCap = "butt";
    stroke([A, B], wide + 0.04, rgb(S.c));
    const m = marks(S.marks); if (m) stroke([A, B], wide, m);
    if (c.material === "wood") { g.strokeStyle = rgb(P.ink, 0.35); g.lineWidth = Math.max(1, pp * 0.02); for (let t = -half; t <= half; t += 0.25) { g.beginPath(); g.moveTo(X(x + ux * t - vx * wide / 2), Y(y + uy * t - vy * wide / 2)); g.lineTo(X(x + ux * t + vx * wide / 2), Y(y + uy * t + vy * wide / 2)); g.stroke(); } }
    g.lineCap = "round";
    for (const side of [-1, 1]) {
      const off = side * (wide / 2 + 0.05), turn = 0.35;
      const p0 = [A[0] + vx * off, A[1] + vy * off], p1 = [B[0] + vx * off, B[1] + vy * off];
      const flare = (p, dir) => [p[0] + (dir * ux * 0.7 + side * vx) * turn, p[1] + (dir * uy * 0.7 + side * vy) * turn];
      stroke([flare(p0, -1), p0, p1, flare(p1, 1)], 0.09, rgb(P.ink, 0.9));
    }
  }

  // Town walls: inked both sides, pale stone, a walk along the top (the towers are buildings, drawn with the roofs)
  for (const w of items("wall").filter((w) => w.thickness)) {
    const T = w.thickness;
    g.save(); g.translate(0.12 * pp, -0.3 * pp); stroke(w.path, T, P.shadow); g.restore();
    g.lineCap = "butt";
    if (w.class === "palisade") { stroke(w.path, T + 0.1, rgb(P.ink)); stroke(w.path, T * 0.8, rgb([150, 116, 80])); g.lineCap = "round"; continue; }
    stroke(w.path, T + 0.14, rgb(P.ink));
    stroke(w.path, T, rgb(P.stone));
    stroke(w.path, T * 0.35, rgb(mixA(P.stone, P.paper, 0.45)));
    g.lineCap = "round";
  }

  // Buildings: a soft shadow, roofs in two tones (the sunlit slopes paler), inked eaves and ridges
  progress(0.6, "Roofs");
  // (only what reaches this tile: a big map is painted tile by tile)
  const tx0 = x0 - 1, ty0 = y0 - 1, tx1 = x0 + W / pp + 1, ty1 = y0 + H / pp + 1;
  const here = (x, y, r) => x + r > tx0 && x - r < tx1 && y + r > ty0 && y - r < ty1;
  const buildings = items("building").filter((b) => here(b.cx, b.cy, Math.hypot(b.len, b.dep) / 2 + 1));
  g.fillStyle = P.shadow;
  for (const b of buildings) {
    const sh = 0.14 + 0.12 * (b.tall || 0);
    g.save(); g.translate(X(b.cx) + sh * 0.35 * pp, Y(b.cy) - sh * pp); g.rotate((b.rot * Math.PI) / 180);
    if (b.round) { g.beginPath(); g.arc(0, 0, (Math.min(b.len, b.dep) * pp) / 2, 0, 2 * Math.PI); g.fill(); }
    else { g.beginPath(); outlineOf(b).forEach(([x, y], k) => (k ? g.lineTo(x * pp, y * pp) : g.moveTo(x * pp, y * pp))); g.closePath(); g.fill(); }
    g.restore();
  }
  for (const b of buildings) {
    const th = (b.rot * Math.PI) / 180, c = Math.cos(th), sn = Math.sin(th);
    const facets = roofFacets(b);
    let roof = tame(col(`roof.${b.roof}`), 0.2, P.paper);
    if (b.grand) roof = mixA(roof, P.paper, 0.05);
    const flat = b.flatRoof === "wood" ? [150, 118, 86] : mixA(roof, [150, 138, 122], 0.55); // (a flat roof in its material's family, a little grayer)
    g.save(); g.translate(X(b.cx), Y(b.cy)); g.rotate(th);
    const Pt = ([x, y]) => [x * pp, y * pp];
    const shape = (pts) => { g.beginPath(); pts.forEach((q, k) => { const [x, y] = Pt(q); k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); };
    const seg = (a, b2) => { g.beginPath(); g.moveTo(...Pt(a)); g.lineTo(...Pt(b2)); g.stroke(); };
    for (const f of facets) {
      if (!f.poly.length) continue;
      const dy = f.down[0] * sn + f.down[1] * c; // facing south (down the map) is lit
      let fill = f.flat ? flat : roof;
      if (winter) fill = mixA(fill, [238, 241, 245], f.flat ? 0.7 : 0.38); // (snow on the roofs, the colors still showing)
      const lit = f.flat ? 0.3 : dy;
      g.fillStyle = rgb(lit >= 0 ? mixA(fill, P.paper, 0.22 * lit) : mixA(fill, [40, 30, 26], -0.22 * lit));
      shape(f.poly); g.fill();
    }
    g.strokeStyle = rgb(P.ink, 0.45); g.lineWidth = Math.max(0.8, pp * 0.02);
    for (const cr of facets.creases) seg(...cr.seg);
    if (facets.parapet) {
      const w = facets.parapet.w * pp, A = (b.len / 2) * pp, B = (b.dep / 2) * pp, { joined, round, R, crenels } = facets.parapet;
      g.fillStyle = rgb(P.stone); g.strokeStyle = rgb(P.stone);
      if (round) { g.lineWidth = w; g.beginPath(); g.arc(0, 0, R * pp - w / 2, 0, 2 * Math.PI); g.stroke(); }
      else { g.fillRect(-A, -B, 2 * A, w); g.fillRect(-A, B - w, 2 * A, w); if (!joined.start) g.fillRect(-A, -B, w, 2 * B); if (!joined.end) g.fillRect(A - w, -B, w, 2 * B); }
      if (crenels) {
        g.strokeStyle = rgb(P.ink, 0.8); g.lineWidth = Math.max(1, w * 0.5); g.setLineDash([Math.max(1, w * 0.9), Math.max(1, w * 0.9)]);
        g.beginPath(); if (round) g.arc(0, 0, R * pp - w / 2, 0, 2 * Math.PI); else g.rect(-A + w / 2, -B + w / 2, 2 * A - w, 2 * B - w); g.stroke(); g.setLineDash([]);
      }
    }
    if (facets.skylight) { const { cx, cy, len, dep } = facets.skylight; g.fillStyle = rgb([190, 210, 214]); g.fillRect((cx - len / 2) * pp, (cy - dep / 2) * pp, len * pp, dep * pp); }
    g.strokeStyle = rgb(P.ink, 0.9); g.lineWidth = inkW;
    for (const f of facets) for (const [a, b2] of f.eaves) seg(a, b2);
    // (a flat roof has no eaves: its outline inked all around)
    if (facets.some((f) => f.flat) && !b.round && !b.poly) g.strokeRect((-b.len / 2) * pp, (-b.dep / 2) * pp, b.len * pp, b.dep * pp);
    if (facets.finial) { g.fillStyle = rgb(P.ink); g.beginPath(); g.arc(0, 0, Math.max(1.2, pp * 0.04), 0, 2 * Math.PI); g.fill(); }
    g.restore();
  }

  // Props: fountains, stalls, sails and wheels, boats; the rest as small inked dots
  progress(0.8, "Trees");
  for (const p of items("prop").filter((p) => p.class === "fountain")) { const rad = (0.45 * (p.scale ?? 1)) / 2; dot(p.x, p.y, rad + 0.1, rgb(P.ink, 0.8)); dot(p.x, p.y, rad + 0.05, rgb(P.stone)); dot(p.x, p.y, rad * 0.7, rgb(P.water)); }
  const AWNING = [[196, 172, 128], [110, 136, 170], [150, 112, 82], [128, 150, 100], [190, 132, 80], [150, 116, 160], [176, 92, 80], [228, 222, 206]];
  for (const p of items("prop").filter((p) => p.class === "stall" || p.class === "stall-long")) {
    const w = 0.4 * (p.scale ?? 1), h = p.class === "stall-long" ? w * 1.5 : w;
    g.save(); g.translate(X(p.x), Y(p.y)); g.rotate(((p.rot ?? 0) * Math.PI) / 180);
    g.fillStyle = rgb(AWNING[(p.variant ?? 0) % AWNING.length]); g.fillRect((-w / 2) * pp, (-h / 2) * pp, w * pp, h * pp);
    g.strokeStyle = rgb(P.ink, 0.7); g.lineWidth = Math.max(1, pp * 0.02); g.strokeRect((-w / 2) * pp, (-h / 2) * pp, w * pp, h * pp);
    g.restore();
  }
  for (const p of items("prop").filter((p) => p.class === "sails" || p.class === "waterwheel")) {
    const len = p.class === "sails" ? 2.4 * (p.scale ?? 1) : 1.5 * (p.scale ?? 1), wid = p.class === "sails" ? len * 0.14 : 0.25 * (p.scale ?? 1);
    g.save(); g.translate(X(p.x), Y(p.y)); g.fillStyle = p.class === "sails" ? rgb(P.paper) : rgb([120, 92, 64]); g.strokeStyle = rgb(P.ink, 0.8); g.lineWidth = Math.max(1, pp * 0.02);
    const [w, h] = p.class === "sails" ? [len, wid] : [wid, len];
    for (const turn of p.class === "sails" ? [0, 90] : [0]) { g.save(); g.rotate((((p.rot ?? 0) + turn) * Math.PI) / 180); g.fillRect((-w / 2) * pp, (-h / 2) * pp, w * pp, h * pp); g.strokeRect((-w / 2) * pp, (-h / 2) * pp, w * pp, h * pp); g.restore(); }
    g.restore();
  }
  // (only the bigger things a map like this would show: wells, carts and the like as small inked dots; clutter left out)
  const SHOWN = new Set(["well", "cart", "wagon", "statue", "shrine", "crane", "obelisk", "hay"]);
  for (const p of items("prop").filter((p) => SHOWN.has(p.class))) { dot(p.x, p.y, 0.16 * (p.scale ?? 1) + 0.04, rgb(P.ink, 0.8)); dot(p.x, p.y, 0.16 * (p.scale ?? 1), rgb(mixA(P.stone, P.paper, 0.2))); }

  // Trees as clumped canopies: every crown's inked rim first, then every crown, then their sunlit tops, so trees that
  // touch merge into one canopy as on a drawn map
  const trees = [...items("tree").filter((t) => here(t.x, t.y, 2.5))].sort((a, b) => a.y - b.y).map((t) => {
    const leafy = t.species === "bare" || t.species === undefined || t.species === "deciduous";
    const size = (leafy ? 2.0 : { large: 1.0, medium: 0.78, small: 0.55 }[t.size] ?? 1.0) * (t.s ?? 1);
    const r = size * (leafy ? 0.34 : 0.38);
    const v = hash(t.x, t.y);
    let c = leafy ? P.canopy : mixA(P.canopy, [60, 90, 70], 0.35);
    if (leafy && P.canopyMix && v > 0.45) c = P.canopyMix[Math.floor(v * 97) % P.canopyMix.length];
    return { t, r, c, v };
  });
  // (in winter a leafy tree is bare: a ring of fine branches and its trunk, not a canopy)
  const bare = winter ? trees.filter((x) => x.t.species === "bare" || x.t.species === undefined || x.t.species === "deciduous") : [];
  const crowns = trees.filter((x) => !bare.includes(x));
  for (const { t, r } of crowns) dot(t.x + r * 0.35, t.y - r * 0.25, r, P.shadow);
  for (const { t, r } of crowns) dot(t.x, t.y, r + 0.06, rgb(P.canopyInk, 0.9));
  for (const { t, r, c } of crowns) dot(t.x, t.y, r, rgb(c));
  for (const { t, r, c } of crowns) dot(t.x - r * 0.22, t.y + r * 0.22, r * 0.5, rgb(mixA(c, P.paper, 0.22)));
  for (const { t, r, v } of bare) {
    const rr = r * 0.85;
    dot(t.x, t.y, rr, rgb([150, 136, 120], 0.22));
    g.strokeStyle = rgb([96, 80, 66], 0.75); g.lineWidth = Math.max(0.8, pp * 0.025);
    for (let k = 0; k < 7; k++) { const a = (k / 7) * 2 * Math.PI + v * 6; g.beginPath(); g.moveTo(X(t.x), Y(t.y)); g.lineTo(X(t.x + Math.cos(a) * rr), Y(t.y + Math.sin(a) * rr)); g.stroke(); }
    dot(t.x, t.y, Math.max(0.05, rr * 0.12), rgb([80, 66, 54]));
  }
  const bushes = items("prop", "bush");
  for (const b of bushes) dot(b.x, b.y, (b.scale ?? 0.5) * 0.42 + 0.04, rgb(P.canopyInk, 0.8));
  for (const b of bushes) dot(b.x, b.y, (b.scale ?? 0.5) * 0.42, rgb(mixA(P.canopy, P.lawn, 0.3)));

  // Paper: a faint grain over everything, and the edges a touch darker
  progress(0.95, "Paper");
  const grain = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(256, 256) : null;
  if (grain) {
    const gg = grain.getContext("2d"), img = gg.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) { const v = 200 + Math.floor(hash(i % 256, Math.floor(i / 256)) * 55); img.data.set([v, v - 4, v - 12, 255], i * 4); }
    gg.putImageData(img, 0, 0);
    const pat = g.createPattern(grain, "repeat");
    // (fixed to the map, so tiles join)
    if (pat.setTransform && typeof DOMMatrix !== "undefined") pat.setTransform(new DOMMatrix().translate(-((x0 * pp) % 256), -((y0 * pp) % 256)));
    g.save(); g.globalCompositeOperation = "multiply"; g.globalAlpha = 0.22; g.fillStyle = pat; g.fillRect(0, 0, W, H); g.restore();
  }
  const [mw, mh] = L.size?.squares ?? [W / pp, H / pp];
  const cx = X(mw / 2), cy = Y(mh / 2), rad = Math.hypot(mw, mh) * pp * 0.62;
  const vg = g.createRadialGradient(cx, cy, rad * 0.55, cx, cy, rad);
  vg.addColorStop(0, "rgba(90,70,40,0)"); vg.addColorStop(1, "rgba(90,70,40,0.22)");
  g.save(); g.globalCompositeOperation = "multiply"; g.fillStyle = vg; g.fillRect(0, 0, W, H); g.restore();
  if (L.dressing) dress(ctx, P);
  progress(1, "Done");
}

/** A small tile canvas (a pattern's), or null where there's no canvas to make one. */
function tile(w, h) {
  if (typeof OffscreenCanvas === "undefined") return null;
  const c = new OffscreenCanvas(w, h);
  return { c, g: c.getContext("2d") };
}
/** A pattern made at a square's size and fixed to the map, so tiles join. */
function mapPattern(g, t, ctx, every = 1) {
  const p = g.createPattern(t.c, "repeat");
  const { x0, y0, pp } = ctx, size = Math.max(1, Math.round(pp * every));
  if (p.setTransform && typeof DOMMatrix !== "undefined") p.setTransform(new DOMMatrix().translate(-((x0 * pp) % size), -((y0 * pp) % size)));
  return p;
}

/** The marks a paved or worn surface is stippled or ruled with, as patterns by name (null where none, or too small). */
function surfaceMarks(ctx, P) {
  const { g, pp } = ctx, cache = new Map();
  return (name) => {
    if (!name || pp < 12) return null;
    if (cache.has(name)) return cache.get(name);
    const S = Math.max(4, Math.round(pp)), t = tile(S, S);
    if (!t) return null;
    const ink = (a) => `rgba(${P.ink.join(",")},${a})`;
    const k = t.g;
    if (name === "stones") {
      // Cobbles: small rounded stones, each a faint ring
      const n = 7;
      k.strokeStyle = ink(0.22); k.lineWidth = Math.max(0.6, S * 0.012);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const x = ((i + 0.5 + (hash(i, j) - 0.5) * 0.5) / n) * S, y = ((j + 0.5 + (hash(j, i + 9) - 0.5) * 0.5) / n) * S;
        k.beginPath(); k.ellipse(x, y, S / n * 0.4, S / n * 0.33, hash(i + 3, j) * 3, 0, 2 * Math.PI); k.stroke();
      }
    } else if (name === "grid") {
      k.strokeStyle = ink(0.2); k.lineWidth = Math.max(0.6, S * 0.012);
      const n = 5;
      for (let i = 0; i <= n; i++) { k.beginPath(); k.moveTo(0, (i / n) * S); k.lineTo(S, (i / n) * S); k.stroke(); }
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = ((i + (j % 2 ? 0.5 : 0)) / n) * S; k.beginPath(); k.moveTo(x, (j / n) * S); k.lineTo(x, ((j + 1) / n) * S); k.stroke(); }
    } else if (name === "flags") {
      k.strokeStyle = ink(0.18); k.lineWidth = Math.max(0.6, S * 0.012);
      const n = 3;
      for (let j = 0; j < n; j++) { const y = (j / n) * S; k.beginPath(); k.moveTo(0, y); k.lineTo(S, y); k.stroke(); for (let i = 0; i < 2; i++) { const x = ((i + hash(i, j)) / 2) * S; k.beginPath(); k.moveTo(x, y); k.lineTo(x, y + S / n); k.stroke(); } }
    } else if (name === "diagonal") {
      k.strokeStyle = ink(0.2); k.lineWidth = Math.max(0.6, S * 0.012);
      for (let i = -6; i <= 6; i++) { k.beginPath(); k.moveTo((i / 6) * S, 0); k.lineTo((i / 6) * S + S, S); k.stroke(); k.beginPath(); k.moveTo((i / 6) * S + S, 0); k.lineTo((i / 6) * S, S); k.stroke(); }
    } else if (name === "specks") {
      for (let i = 0; i < 26; i++) { k.fillStyle = ink(0.12 + hash(i, 3) * 0.12); const r = Math.max(0.5, S * (0.008 + hash(i, 5) * 0.012)); k.beginPath(); k.arc(hash(i, 1) * S, hash(i, 2) * S, r, 0, 2 * Math.PI); k.fill(); }
    }
    const p = mapPattern(g, t, ctx);
    cache.set(name, p);
    return p;
  };
}

/** The marks for fields: tufts of grass for pasture and fallow, a stipple of grain for ripe fields. */
function fieldMarks(ctx, P) {
  const { g, pp } = ctx;
  if (pp < 12) return {};
  const S = Math.max(8, Math.round(pp * 2)), out = {};
  const ink = (a) => `rgba(${P.ink.join(",")},${a})`;
  const t = tile(S, S);
  if (!t) return out;
  t.g.strokeStyle = ink(0.32); t.g.lineWidth = Math.max(0.7, pp * 0.025); t.g.lineCap = "round";
  for (let i = 0; i < 7; i++) {
    const x = hash(i, 11) * S, y = hash(i, 12) * S, h = S * 0.06;
    for (const dx of [-0.6, 0, 0.6]) { t.g.beginPath(); t.g.moveTo(x + dx * h * 0.5, y); t.g.lineTo(x + dx * h, y - h * (dx ? 0.8 : 1.1)); t.g.stroke(); }
  }
  out.tuft = mapPattern(g, t, ctx, 2);
  const u = tile(S, S);
  for (let i = 0; i < 60; i++) { u.g.fillStyle = `rgba(150,110,40,${0.18 + hash(i, 7) * 0.2})`; u.g.beginPath(); u.g.arc(hash(i, 8) * S, hash(i, 9) * S, Math.max(0.6, pp * 0.022), 0, 2 * Math.PI); u.g.fill(); }
  out.grain = mapPattern(g, u, ctx, 2);
  return out;
}

/**
 * The map's corners for its dressing, emptiest first (fewest buildings, roads and water there): the compass rose takes
 * the first, the scale bar the second and the cartouche with the map's name the third. unit: the dressing's own scale,
 * a hundredth of the map's shorter side; cw, ch: a corner's size; all in squares.
 */
function cornersOf(L) {
  const [mw, mh] = L.size?.squares ?? [0, 0];
  const unit = Math.min(mw, mh) / 100;
  const cw = mw * 0.24, ch = mh * 0.24;
  const busy = (cx, cy, w, h) => L.items.filter((i) => (i.kind === "building" || i.kind === "way" || i.kind === "water") && [[i.cx ?? i.x ?? i.path?.[0]?.[0], i.cy ?? i.y ?? i.path?.[0]?.[1]]].some(([x, y]) => x > cx && x < cx + w && y > cy && y < cy + h)).length;
  const corners = [["nw", 0, 0], ["ne", mw - cw, 0], ["sw", 0, mh - ch], ["se", mw - cw, mh - ch]].map(([k, cx, cy]) => ({ k, cx, cy, n: busy(cx, cy, cw, ch) })).sort((a, b) => a.n - b.n);
  return { unit, cw, ch, corners };
}

/**
 * Where a dressed map's cartouche goes, for a tile of its own over the map (hidden until the GM shows it): { x, y, w, h,
 * font } in squares (x, y its top left; font the letters' height), or null for a map that isn't dressed or has no
 * name. measure(text, fontSquares): the text's width in squares, as the page will draw it.
 */
export function titleBox(L, measure) {
  const name = L.title;
  if (!L.dressing || !name || !(L.size?.squares?.[0] > 0)) return null;
  const { unit, cw, ch, corners } = cornersOf(L);
  const c = corners[2], x = c.cx + cw / 2, y = c.cy + ch / 2;
  // (a long name in smaller letters, so its box keeps to its corner)
  let font = unit * 3.2;
  const fit = (cw - unit * 11) / Math.max(1e-6, measure(name, font)); // (its padding, and clear of the frame each side)
  if (fit < 1) font *= fit;
  const w = measure(name, font) + unit * 6, h = unit * 6;
  return { x: x - w / 2, y: y - h / 2, w, h, font, unit };
}

/** Paints the cartouche into its own canvas (g), box from titleBox, at pp pixels a square. */
export function paintTitle(g, L, box, pp) {
  const P = { ...PALETTE, ...(SEASON[L.season] ?? {}) };
  const ink = (a = 1) => `rgba(${P.ink.join(",")},${a})`, paper = (a = 1) => `rgba(${P.paper.join(",")},${a})`;
  const { w, h, unit, font } = box;
  g.fillStyle = paper(0.92); g.fillRect(0, 0, w * pp, h * pp);
  g.strokeStyle = ink(0.9); g.lineWidth = Math.max(1, pp * 0.06); g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w * pp - g.lineWidth, h * pp - g.lineWidth);
  g.lineWidth = Math.max(1, pp * 0.025); g.strokeRect(unit * 0.6 * pp, unit * 0.6 * pp, (w - unit * 1.2) * pp, (h - unit * 1.2) * pp);
  g.fillStyle = ink(0.92); g.font = `italic ${Math.max(4, Math.round(font * pp))}px serif`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(L.title, (w / 2) * pp, (h / 2 + unit * 0.2) * pp);
}

/**
 * Map dressing: a ruled frame, a compass rose and a scale bar in feet, each in the emptiest corner left (the third
 * kept for the map's name, a tile of its own). Drawn in map units, so tiles join.
 */
function dress(ctx, P) {
  const { g, x0, y0, pp, layout: L } = ctx;
  const X = (x) => (x - x0) * pp, Y = (y) => (y - y0) * pp;
  const [mw, mh] = L.size?.squares ?? [0, 0];
  if (!mw || !mh) return;
  const ft = L.size?.ftPerSquare ?? 25;
  const ink = (a = 1) => `rgba(${P.ink.join(",")},${a})`, paper = (a = 1) => `rgba(${P.paper.join(",")},${a})`;
  const { unit, cw, ch, corners } = cornersOf(L);
  const spot = (c) => ({ x: c.cx + cw / 2, y: c.cy + ch / 2 });

  // The compass rose in the emptiest corner
  { const c0 = spot(corners[0]), R = unit * 6.5;
    // (drawn in a little toward the middle, so its N clears the frame)
    const x = c0.x + (mw / 2 - c0.x) * 0.12, y = c0.y + (mh / 2 - c0.y) * 0.12 + unit * 1.2;
    g.save(); g.translate(X(x), Y(y));
    const r = R * pp;
    g.fillStyle = paper(0.55); g.beginPath(); g.arc(0, 0, r * 1.05, 0, 2 * Math.PI); g.fill();
    g.strokeStyle = ink(0.85); g.lineWidth = Math.max(1, pp * 0.05);
    for (const rr of [r, r * 0.93]) { g.beginPath(); g.arc(0, 0, rr, 0, 2 * Math.PI); g.stroke(); }
    for (let k = 0; k < 32; k++) { const a = (k / 32) * 2 * Math.PI, l = k % 4 ? 0.04 : 0.08; g.beginPath(); g.moveTo(Math.cos(a) * r * 0.93, Math.sin(a) * r * 0.93); g.lineTo(Math.cos(a) * r * (0.93 - l), Math.sin(a) * r * (0.93 - l)); g.stroke(); }
    const point = (a, len, wide, dark) => {
      const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
      for (const side of [1, -1]) {
        g.fillStyle = (side > 0) === dark ? ink(0.85) : paper(1);
        g.beginPath(); g.moveTo(0, 0); g.lineTo(ux * len, uy * len); g.lineTo(vx * wide * side + ux * wide, vy * wide * side + uy * wide); g.closePath(); g.fill(); g.stroke();
      }
    };
    for (let k = 0; k < 4; k++) point(-Math.PI / 4 + (k * Math.PI) / 2, r * 0.55, r * 0.09, true);
    for (let k = 0; k < 4; k++) point(-Math.PI / 2 + (k * Math.PI) / 2, r * 0.88, r * 0.14, true);
    g.fillStyle = ink(0.9); g.font = `italic ${Math.round(r * 0.3)}px serif`; g.textAlign = "center"; g.textBaseline = "bottom";
    g.fillText("N", 0, -r * 1.07);
    g.restore(); }

  // The scale bar: about a fifth of the map across, in a round number of feet, five parts
  { const c = corners[1];
    // (the biggest round length no longer than a fifth of the map, and short enough to sit in its corner)
    const want = Math.min((mw * ft) / 5, (cw - unit * 5) * ft), mag = 10 ** Math.floor(Math.log10(want)), nice = [10, 5, 2.5, 2, 1].map((m) => m * mag).find((v) => v <= want) ?? mag;
    const len = nice / ft, h = unit * 0.9;
    const x = Math.min(Math.max(spot(c).x, len / 2 + unit * 4.5), mw - len / 2 - unit * 4.5), y = spot(c).y, left = x - len / 2;
    g.save();
    g.fillStyle = paper(0.6); g.fillRect(X(left - unit * 2), Y(y - unit * 3.6), (len + unit * 4) * pp, unit * 6 * pp);
    g.strokeStyle = ink(0.9); g.lineWidth = Math.max(1, pp * 0.04);
    for (let k = 0; k < 5; k++) { g.fillStyle = k % 2 ? paper(1) : ink(0.85); g.fillRect(X(left + (k * len) / 5), Y(y), (len / 5) * pp, h * pp); }
    g.strokeRect(X(left), Y(y), len * pp, h * pp);
    g.fillStyle = ink(0.9); g.font = `${Math.round(unit * 1.5 * pp)}px serif`; g.textAlign = "center"; g.textBaseline = "bottom";
    for (const k of [0, 5]) g.fillText(`${Math.round((nice * k) / 5)}`, X(left + (k * len) / 5), Y(y - unit * 0.3));
    g.fillText(`${Math.round(nice / 2)}`, X(left + len / 2), Y(y - unit * 0.3));
    g.textBaseline = "top"; g.font = `italic ${Math.round(unit * 1.5 * pp)}px serif`;
    g.fillText(`feet  (one square: ${ft} ft)`, X(x), Y(y + h + unit * 0.4));
    g.restore(); }

  // (the map's name is a tile of its own, which the GM can show the players: see titleBox and paintTitle)

  // The frame: a broad paper margin ruled twice inside, and a fine rule outside
  { const m = unit * 1.6, t = m * pp;
    g.save();
    g.fillStyle = paper(1);
    g.fillRect(X(0), Y(0), mw * pp, t); g.fillRect(X(0), Y(mh) - t, mw * pp, t); g.fillRect(X(0), Y(0), t, mh * pp); g.fillRect(X(mw) - t, Y(0), t, mh * pp);
    g.strokeStyle = ink(0.9);
    g.lineWidth = Math.max(1.5, pp * 0.08); g.strokeRect(X(m), Y(m), (mw - 2 * m) * pp, (mh - 2 * m) * pp);
    g.lineWidth = Math.max(1, pp * 0.03); g.strokeRect(X(m * 0.6), Y(m * 0.6), (mw - 1.2 * m) * pp, (mh - 1.2 * m) * pp);
    g.lineWidth = Math.max(1, pp * 0.03); g.strokeRect(X(m * 1.25), Y(m * 1.25), (mw - 2.5 * m) * pp, (mh - 2.5 * m) * pp);
    // (ticks every ten squares along the inner rule, as a map's border is graduated)
    g.lineWidth = Math.max(1, pp * 0.03);
    for (let x = 10; x < mw; x += 10) for (const yy of [m * 0.6, mh - m * 0.6]) { g.beginPath(); g.moveTo(X(x), Y(yy)); g.lineTo(X(x), Y(yy + (yy < mh / 2 ? m * 0.4 : -m * 0.4))); g.stroke(); }
    for (let y = 10; y < mh; y += 10) for (const xx of [m * 0.6, mw - m * 0.6]) { g.beginPath(); g.moveTo(X(xx), Y(y)); g.lineTo(X(xx + (xx < mw / 2 ? m * 0.4 : -m * 0.4)), Y(y)); g.stroke(); }
    g.restore(); }
}
