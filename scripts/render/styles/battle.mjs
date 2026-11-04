/**
 * The battle map style: a Layout at 5 ft a square painted from Forgotten Adventures art at its own scale (200 px of
 * art to a square), as the battle mockup Patrick approved on 3 Nov: bright grass, crisp stone curbs along the paved
 * streets, flat paving (setts and flagstones; cobbles and herringbone read as noise at this scale), floors inside the
 * buildings, fenced yards, and one sun casting every shadow to the northwest.
 *
 * Only the ground is painted on the map image. What sits over a token is painted apart, each piece onto an image of its
 * own, for the scene to lay over the map as tiles: a building's roof (fading when a token walks in) and the trees'
 * crowns (opening around a token beneath them). overheads(layout) lists the pieces; paintOverhead(ctx, piece) paints one.
 *
 * Paints one window of the map (a tile) at a time; every pattern and noise is anchored to the map, so tiles meet without
 * seams. Numbers are in squares.
 */
import { fallbackColor } from "../../core/roles.mjs";
import { PROP_SQUARES } from "../../core/plan.mjs";
import { makeNoise } from "../../core/noise.mjs";
import { footprint } from "../../core/layout/battle.mjs";
import { paintRoof } from "./textured.mjs";

/** The widest blur this style uses, in squares (tiles need this much margin). */
export const MAX_BLUR = 1;

/** Forgotten Adventures' art is drawn at 200 px a square. */
const ART_PX = 200;

/**
 * The paving a way's or square's surface is laid in at battle size: flat stones (Patrick, 3 Nov: cobbles "don't
 * translate" at this scale, and herringbone fought the grass around it). A road's flagstones are the second variant,
 * a square's the first, so the two read apart where they meet.
 */
const PAVING = { cobble: "surface.setts", setts: "surface.setts", flagstone: "surface.flagstone", herringbone: "surface.flagstone", brick: "surface.brick", tiles: "surface.tiles" };
const UNPAVED = { dirt: "surface.dirt", gravel: "surface.gravel", trodden: "surface.trodden" };
/** A building's floor: stone in a temple, a smithy or a tower; boards elsewhere, in one of two woods. */
const STONE_FLOORS = new Set(["temple", "smithy", "watch", "shrine", "tower", "keep", "chapel"]);

/** Overhead tiles' heights, in feet above the ground: a roof over a one-story wall, a tree's crown above it. */
export const OVERHEAD_ELEVATION = { roof: 20, canopy: 30 };
/** Trees are gathered onto canopy tiles about this many squares across (a tile per tree would be hundreds). */
const CANOPY_CELL = 24;

/** A tree's art role in a season (as the textured style's). */
const treeRole = (t, s) => (t.species === "bare" ? (s === "winter" ? "tree.bare.winter" : `tree.deciduous.${s}`) : `tree.conifer.${t.size ?? "large"}.${s}`);
/** A hedge's bushes: bare in winter, in leaf otherwise (as the textured style's). */
const bushRole = (s) => (s === "winter" ? "bush.bare.winter" : `bush.leafy.${s}`);
/** A tree's crown across, in squares: a broadleaf four to six, a fir by its size. */
function crownOf(t, s) {
  const k = Math.min(1, Math.max(0, t.s ?? 0.6));
  if (t.species === "bare") return s === "winter" ? 5 + 2.5 * k : 4 + 2.2 * k;
  return ({ large: 4, medium: 3, small: 2 }[t.size] ?? 4) * (0.85 + 0.3 * k);
}
/** Where a tree's art is turned and which variant it takes: from its own, else from where it stands. */
const treeTurn = (t) => (Number.isFinite(t.rot) ? t.rot : (Math.abs(Math.sin(t.x * 12.9898 + t.y * 78.233) * 43758.5453) % 1) * 360);
/** The shadow's direction: the sun low in the southeast, so shadows fall to the northwest. */
const SHADOW = [-0.7, -0.7];

/** A paved way's stone: a main road's flagstones, so it reads apart from the streets off it (as in the mockup). */
const wayPaving = (w) => (PAVING[w.surface] ? (w.class === "highway" ? "surface.flagstone" : PAVING[w.surface]) : null);
const wayRole = (w, s) => wayPaving(w) ?? (s === "winter" ? `surface.${w.surface ?? "dirt"}.winter` : UNPAVED[w.surface] ?? "surface.dirt");
const floorRole = (b) => (STONE_FLOORS.has(b.use) || b.tower ? "floor.stone" : "floor.wood");
const isPlaza = (i) => i.kind === "surface" && (i.class === "square" || i.class === "plaza" || i.class === "market") && Array.isArray(i.poly);

export function rolesFor(layout) {
  const s = layout.season;
  const g = layout.items.find((i) => i.kind === "ground")?.base ?? "grass";
  const roles = new Set([`ground.${g}`, `ground.${g}.light`, `ground.${g}.clover`, `surface.trodden.${s}`, "stone.curb", "floor.wood", "floor.stone", "wood.fence", `stone.rough.${s}`]);
  for (const i of layout.items) {
    if (i.kind === "way" && !i.faint) roles.add(wayRole(i, s));
    if (isPlaza(i)) roles.add(PAVING[i.surface] ?? "surface.flagstone");
    if (i.kind === "surface" && i.garden) roles.add(`surface.dirt.${s}`);
    if (i.kind === "water") roles.add(i.frozen ? "water.ice" : `water.${i.class}`);
    if (i.kind === "crossing" && i.class !== "ford") roles.add("surface.flagstone");
    if (i.kind === "building") {
      roles.add(`roof.${i.roof}.${s}`);
      if (i.chimney) roles.add("chimney.stone");
      if (s === "winter") roles.add("overlay.snow");
      if (i.roofStyle === "flat" || i.roofStyle === "mansard") roles.add(i.flatRoof === "wood" ? `roof.flat.wood.${s}` : `roof.flat.${s}`);
    }
    if (i.kind === "tree") roles.add(treeRole(i, s));
    if (i.kind === "wall" && i.class === "palisade") roles.add("wood.stake");
    if (i.kind === "prop" && i.class === "fountain") roles.add(s === "winter" ? "water.ice" : "water.pond");
    if (i.kind === "prop" && i.class !== "grave" && i.class !== "fountain") roles.add(i.class === "bush" ? bushRole(s) : `prop.${i.class}`);
  }
  return [...roles];
}

/**
 * Paints the window [x0, y0] .. [x0 + W/pp, y0 + H/pp] of the map's ground.
 * ctx: { g: the tile's 2d context, mask and blur: same-size scratch canvases, W, H (px), x0, y0 (squares), pp (px a square),
 *        layout, art(role, variant) -> ImageBitmap | null, progress(pct, label) }
 */
export function paint(ctx) {
  const { g, mask, W, H, x0, y0, pp, layout: L, art, progress = () => {} } = ctx;
  const q = mask.getContext("2d");
  const bq = ctx.blur?.getContext("2d") ?? null;
  const s = L.season;
  const X = (x) => (x - x0) * pp, Y = (y) => (y - y0) * pp;
  const items = (kind, cls) => L.items.filter((i) => i.kind === kind && (cls === undefined || i.class === cls));

  /** A fill for a role: its art at true scale as a map-anchored pattern (turned rot degrees), else its plain color. */
  const tex = (role, variant = 0, rot = 0) => {
    const im = art(role, variant);
    if (!im) return fallbackColor(role);
    const p = g.createPattern(im, "repeat");
    p.setTransform(new DOMMatrix().translate(-x0 * pp, -y0 * pp).rotate(rot).scale(pp / ART_PX));
    return p;
  };
  const path = (k, pts) => { k.beginPath(); pts.forEach(([x, y], i) => (i ? k.lineTo(X(x), Y(y)) : k.moveTo(X(x), Y(y)))); };
  const poly = (k, pts) => { path(k, pts); k.closePath(); };
  const stroke = (k, pts, w, cap = "round") => { k.lineCap = cap; k.lineJoin = "round"; k.lineWidth = w * pp; path(k, pts); k.stroke(); };

  /**
   * Noise thresholded into a soft mask over this tile: opaque where noise(x, y) is above t, fading over softness. It's
   * sampled every eighth pixel on a lattice anchored to the map's corner (so every tile samples the same points) and
   * scaled up when used. Returns { canvas, x, y, w, h }: where it's drawn on the tile.
   */
  const noiseMask = (key, scale, t, softness) => {
    const n = makeNoise(L.seed ?? 1, key, { scale, octaves: 3 });
    const f = 8, ox = Math.floor((x0 * pp) / f), oy = Math.floor((y0 * pp) / f);
    const w = Math.ceil(W / f) + 2, h = Math.ceil(H / f) + 2;
    const c = new OffscreenCanvas(w, h), k = c.getContext("2d"), im = k.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const v = n(((ox + i) * f) / pp, ((oy + j) * f) / pp);
      im.data[(j * w + i) * 4 + 3] = Math.max(0, Math.min(1, (v - t) / softness + 0.5)) * 255;
    }
    k.putImageData(im, 0, 0);
    return { canvas: c, x: ox * f - x0 * pp, y: oy * f - y0 * pp, w: w * f, h: h * f };
  };

  // The tile's window in squares; what lies wholly outside it (with room for its blur) is skipped
  const wx1 = x0 + W / pp, wy1 = y0 + H / pp;
  const bboxOf = (pts) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, y] of pts) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; } return [a, b, c, d]; };
  const meets = ([a, b, c, d], pad) => a - pad < wx1 && c + pad > x0 && b - pad < wy1 && d + pad > y0;
  /** The box around some boxes, grown by pad squares. */
  const boxAround = (boxes, pad = 0) => boxes.length ? [Math.min(...boxes.map((b) => b[0])) - pad, Math.min(...boxes.map((b) => b[1])) - pad, Math.max(...boxes.map((b) => b[2])) + pad, Math.max(...boxes.map((b) => b[3])) + pad] : null;

  /**
   * Draw shapes into the mask, blur it (blur in squares), cut it by a noise mask, fill it with a fill and lay it on the
   * map at alpha. The texture is never blurred, only the mask, so it stays sharp. box: [x0, y0, x1, y1] in squares,
   * when the shapes lie within it: only that part of the tile (with room for the blur) is worked on, and nothing at all
   * when it misses the tile.
   */
  const soft = (shape, fill, { blur = 0, alpha = 1, noise = null, op = "source-over", box = null } = {}) => {
    let rx = 0, ry = 0, rw = W, rh = H;
    if (box) {
      const m = blur * pp * 3 + 2;
      rx = Math.max(0, Math.floor(X(box[0]) - m)); ry = Math.max(0, Math.floor(Y(box[1]) - m));
      rw = Math.min(W, Math.ceil(X(box[2]) + m)) - rx; rh = Math.min(H, Math.ceil(Y(box[3]) + m)) - ry;
      if (rw <= 0 || rh <= 0) return;
    }
    q.setTransform(1, 0, 0, 1, 0, 0);
    q.globalCompositeOperation = "source-over"; q.globalAlpha = 1; q.filter = "none";
    q.clearRect(rx, ry, rw, rh);
    q.fillStyle = "#000"; q.strokeStyle = "#000";
    if (blur && !bq) q.filter = `blur(${blur * pp}px)`;
    shape(q);
    q.filter = "none";
    let k = q, out = mask;
    if (blur && bq) {
      bq.setTransform(1, 0, 0, 1, 0, 0);
      bq.globalCompositeOperation = "source-over"; bq.globalAlpha = 1;
      bq.clearRect(rx, ry, rw, rh);
      bq.filter = `blur(${blur * pp}px)`;
      bq.drawImage(mask, rx, ry, rw, rh, rx, ry, rw, rh);
      bq.filter = "none";
      k = bq; out = ctx.blur;
    }
    if (noise) { k.globalCompositeOperation = "destination-in"; k.imageSmoothingEnabled = true; k.drawImage(noise.canvas, noise.x, noise.y, noise.w, noise.h); }
    k.globalCompositeOperation = "source-in";
    k.fillStyle = fill;
    k.fillRect(rx, ry, rw, rh);
    k.globalCompositeOperation = "source-over";
    g.save();
    g.globalAlpha = alpha;
    g.globalCompositeOperation = op;
    g.drawImage(out, rx, ry, rw, rh, rx, ry, rw, rh);
    g.restore();
  };
  /** A crisp fill straight onto the map. */
  const fill = (shape, style, alpha = 1) => { g.save(); g.globalAlpha = alpha; g.fillStyle = style; g.strokeStyle = style; shape(g); g.restore(); };
  /** A rectangle w by d squares around cx, cy, turned rot degrees, as a polygon on the map (so a pattern stays anchored). */
  const rectAt = (cx, cy, w, d, rot) => {
    const a = (rot * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [cx + ((u * w) / 2) * c - ((v * d) / 2) * sn, cy + ((u * w) / 2) * sn + ((v * d) / 2) * c]);
  };

  const ground = L.items.find((i) => i.kind === "ground");
  const gb = ground?.base ?? "grass";
  const ways = items("way").filter((w) => !w.faint && Array.isArray(w.path) && w.path.length >= 2).map((w) => ({ w, bb: bboxOf(w.path) })).filter(({ w, bb }) => meets(bb, (w.width ?? 1) / 2 + 2)).map(({ w }) => w);
  const feet = items("building").map((b) => { const f = footprint(b); return { b, f, bb: bboxOf(f) }; }).filter(({ bb }) => meets(bb, 6));

  // 1. The ground: its art, a second grass and a little clover in broad soft patches
  progress(0.02, "Ground");
  g.fillStyle = tex(`ground.${gb}`); g.fillRect(0, 0, W, H);
  soft((k) => k.fillRect(0, 0, W, H), tex(`ground.${gb}.light`), { noise: noiseMask("battle-g1", 10, 0.25, 0.2), alpha: 0.5 });
  if (art(`ground.${gb}.clover`)) soft((k) => k.fillRect(0, 0, W, H), tex(`ground.${gb}.clover`), { noise: noiseMask("battle-g2", 7, 0.45, 0.15), alpha: 0.6 });

  // 2. Ground worn by feet around the buildings
  const trodden = tex(`surface.trodden.${s}`);
  const near = feet.filter(({ bb }) => meets(bb, 4));
  if (near.length) soft((k) => { k.lineJoin = "round"; k.lineWidth = 2.2 * pp; for (const { f } of near) { poly(k, f); k.stroke(); k.fill(); } }, trodden, { blur: 0.9, noise: noiseMask("battle-yard", 3, -0.2, 0.3), alpha: 0.75, box: boxAround(near.map((x) => x.bb), 1.2) });

  // 3. Water: a trodden bank, a stony edge, the water, deeper in the middle
  progress(0.15, "Water");
  for (const w of items("water")) {
    const role = w.frozen ? "water.ice" : `water.${w.class}`;
    if (Array.isArray(w.poly) && w.poly.length >= 3) {
      const bb = bboxOf(w.poly), box = [bb[0] - 1.3, bb[1] - 1.3, bb[2] + 1.3, bb[3] + 1.3];
      if (!meets(box, 2)) continue;
      const ring = [...w.poly, w.poly[0]];
      soft((k) => { poly(k, w.poly); k.fill(); stroke(k, ring, 2.4); }, trodden, { blur: 0.5, alpha: 0.7, box });
      soft((k) => { poly(k, w.poly); k.fill(); stroke(k, ring, 1); }, tex(`stone.rough.${s}`), { blur: 0.25, box });
      soft((k) => { poly(k, w.poly); k.fill(); }, tex(role), { blur: 0.06, box });
    } else if (Array.isArray(w.path) && w.path.length >= 2) {
      const width = w.width ?? 1, bb = bboxOf(w.path), r = width / 2 + 1.3, box = [bb[0] - r, bb[1] - r, bb[2] + r, bb[3] + r];
      if (!meets(box, 3)) continue;
      soft((k) => stroke(k, w.path, width + 2.4), trodden, { blur: 0.5, alpha: 0.7, box });
      soft((k) => stroke(k, w.path, width + 1), tex(`stone.rough.${s}`), { blur: 0.25, box });
      soft((k) => stroke(k, w.path, width), tex(role), { blur: 0.06, box });
      if (!w.frozen) soft((k) => stroke(k, w.path, width * 0.5), "rgb(8,40,52)", { blur: 1, alpha: 0.3, box });
    }
  }

  // 4. Ways: a trodden verge; an unpaved way's dirt; a paved one's curb (with its shadow on the grass and the joint
  // between curb and paving), then its paving, narrower first, so the main road runs through a junction. Ways of one
  // look share a pass
  progress(0.25, "Streets");
  const wayBox = (list, add) => boxAround(list.map((w) => { const bb = bboxOf(w.path), r = (w.width ?? 1) / 2 + add; return [bb[0] - r, bb[1] - r, bb[2] + r, bb[3] + r]; }));
  const paved = ways.filter(wayPaving);
  if (ways.length) soft((k) => { for (const w of ways) stroke(k, w.path, w.width + 0.8); }, trodden, { blur: 0.25, alpha: 0.8, box: wayBox(ways, 0.4) });
  const dirt = new Map();
  for (const w of ways.filter((w) => !wayPaving(w))) { const r = wayRole(w, s); if (!dirt.has(r)) dirt.set(r, []); dirt.get(r).push(w); }
  for (const [r, list] of dirt) soft((k) => { for (const w of list) stroke(k, w.path, w.width); }, tex(r), { blur: 0.15, box: wayBox(list, 0) });
  if (paved.length) {
    soft((k) => { for (const w of paved) stroke(k, w.path, w.width + 0.55); }, "rgb(20,20,24)", { blur: 0.12, alpha: 0.35, box: wayBox(paved, 0.3) });
    fill((k) => { for (const w of paved) stroke(k, w.path, w.width + 0.5); }, tex("stone.curb"));
    fill((k) => { for (const w of paved) stroke(k, w.path, w.width + 0.08); }, "rgb(40,36,32)", 0.55);
    for (const w of [...paved].sort((a, b) => a.width - b.width)) fill((k) => stroke(k, w.path, w.width), tex(wayRole(w, s), wayRole(w, s) === "surface.flagstone" ? 1 : 0));
  }

  // 5. Squares: flagstones inside a curb
  for (const sq of L.items.filter(isPlaza)) {
    const bb = bboxOf(sq.poly);
    if (!meets(bb, 1)) continue;
    const ring = [...sq.poly, sq.poly[0]];
    soft((k) => { poly(k, sq.poly); k.fill(); stroke(k, ring, 0.6); }, "rgb(20,20,24)", { blur: 0.12, alpha: 0.35, box: [bb[0] - 0.3, bb[1] - 0.3, bb[2] + 0.3, bb[3] + 0.3] });
    fill((k) => { poly(k, sq.poly); k.fill(); stroke(k, ring, 0.5); }, tex("stone.curb"));
    fill((k) => { poly(k, sq.poly); k.fill(); }, tex(PAVING[sq.surface] ?? "surface.flagstone"));
  }

  // 6. Gardens in tilled rows, graves, bridges (every shape as a polygon on the map, so its pattern stays anchored)
  progress(0.4, "Yards");
  for (const gd of items("surface").map((x) => x.garden).filter(Boolean)) {
    if (!meets([gd.cx, gd.cy, gd.cx, gd.cy], Math.max(gd.w, gd.d))) continue;
    const rot = gd.rot ?? 0, a = (rot * Math.PI) / 180;
    fill((k) => { poly(k, rectAt(gd.cx, gd.cy, gd.w, gd.d, rot)); k.fill(); }, tex(`surface.dirt.${s}`));
    if (s !== "winter") fill((k) => {
      for (let y = -gd.d / 2 + 0.4; y < gd.d / 2; y += 0.8) {
        const c = [gd.cx - y * Math.sin(a), gd.cy + y * Math.cos(a)];
        poly(k, rectAt(c[0], c[1], gd.w - 0.4, 0.36, rot)); k.fill();
      }
    }, "rgba(60,96,40,0.85)");
  }
  const graves = items("prop", "grave").filter((gv) => meets([gv.x, gv.y, gv.x, gv.y], 1));
  if (graves.length) {
    fill((k) => { for (const gv of graves) { poly(k, rectAt(gv.x - 0.1, gv.y - 0.1, 0.7, 0.36, gv.rot ?? 0)); k.fill(); } }, "rgba(20,24,34,0.35)");
    fill((k) => { for (const gv of graves) { poly(k, rectAt(gv.x, gv.y, 0.7, 0.36, gv.rot ?? 0)); k.fill(); } }, tex("stone.curb"));
  }
  for (const c of items("crossing").filter((c) => c.class !== "ford" && Array.isArray(c.at))) {
    const a = ((c.angle ?? 0) * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux, hl = (c.length ?? 2) / 2, hw = (c.width ?? 4) / 2;
    const pts = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([u, v]) => [c.at[0] + u * ux + v * nx, c.at[1] + u * uy + v * ny]);
    const bb = bboxOf(pts);
    if (!meets(bb, 2)) continue;
    soft((k) => { poly(k, pts.map(([x, y]) => [x + SHADOW[0] * 0.85, y + SHADOW[1] * 0.85])); k.fill(); }, "rgb(0,0,0)", { blur: 0.4, alpha: 0.35, box: [bb[0] - 1, bb[1] - 1, bb[2], bb[3]] });
    fill((k) => { poly(k, pts); k.fill(); }, tex("surface.flagstone", 1, c.angle ?? 0));
    fill((k) => { poly(k, pts); k.lineWidth = 0.5 * pp; k.stroke(); }, tex("stone.curb"));
  }

  // 7. Yards: trodden ground inside each fenced yard; fences (rails on posts) and walls, with their shadows
  // (a house's fenced yard behind it, and a trade's work yard)
  const yards = items("surface").filter((i) => (i.class === "backyard" || i.class === "yard") && Array.isArray(i.poly)).map((y) => ({ y, bb: bboxOf(y.poly) })).filter(({ bb }) => meets(bb, 1.5));
  if (yards.length) soft((k) => { for (const { y } of yards) { poly(k, y.poly); k.fill(); } }, trodden, { blur: 0.3, noise: noiseMask("battle-yd", 2.5, -0.3, 0.4), alpha: 0.7, box: boxAround(yards.map((x) => x.bb)) });
  // (rails: a yard's fence and any other fence or wall line; not hedges, balks or a garden's clipped box)
  const fences = items("boundary").filter((b) => Array.isArray(b.path) && b.path.length >= 2 && b.class !== "hedge" && b.class !== "balk" && b.class !== "clipped" && meets(bboxOf(b.path), 1));
  if (fences.length) {
    soft((k) => { for (const f of fences) stroke(k, f.path.map(([x, y]) => [x - 0.1, y - 0.1]), 0.35, "butt"); }, "rgb(16,20,30)", { blur: 0.08, alpha: 0.35, box: boxAround(fences.map((f) => bboxOf(f.path)), 0.4) });
    fill((k) => { for (const f of fences) stroke(k, f.path, 0.14, "butt"); }, tex("wood.fence"));
    fill((k) => {
      for (const f of fences) for (let i = 1; i < f.path.length; i++) {
        const [a, b] = [f.path[i - 1], f.path[i]], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let t = 0; t <= l + 1e-6; t += Math.max(0.5, l / Math.max(1, Math.round(l / 1.5)))) { const x = a[0] + ((b[0] - a[0]) * t) / (l || 1), y = a[1] + ((b[1] - a[1]) * t) / (l || 1); k.fillRect(X(x - 0.1), Y(y - 0.1), 0.2 * pp, 0.2 * pp); }
      }
    }, "rgb(52,38,28)");
  }
  // (a wall as thick as it is: a yard's half a square, a town wall its own thickness)
  const walls = items("wall").filter((w) => Array.isArray(w.path) && w.path.length >= 2 && w.class !== "cliff" && meets(bboxOf(w.path), (w.thickness ?? 0.45) + 1));
  const thick = (w) => Math.max(0.45, w.thickness ?? 0);
  if (walls.length) {
    soft((k) => { for (const w of walls) stroke(k, w.path.map(([x, y]) => [x - 0.15, y - 0.15]), thick(w) + 0.25, "butt"); }, "rgb(16,20,30)", { blur: 0.12, alpha: 0.4, box: boxAround(walls.map((w) => bboxOf(w.path)), Math.max(...walls.map(thick)) / 2 + 0.5) });
    // (stone, or a palisade's logs)
    const wood = walls.filter((w) => w.class === "palisade"), stone = walls.filter((w) => w.class !== "palisade");
    if (stone.length) fill((k) => { for (const w of stone) stroke(k, w.path, thick(w), "butt"); }, tex(`stone.rough.${s}`));
    if (wood.length) fill((k) => { for (const w of wood) stroke(k, w.path, thick(w), "butt"); }, tex("wood.stake"));
  }

  // 8. Fountains: a stone basin of water
  for (const f of items("prop", "fountain")) {
    const r = Math.max(1.2, (0.45 * (f.scale ?? 1)) / 2);
    if (!meets([f.x, f.y, f.x, f.y], r + 0.5)) continue;
    fill((k) => { k.beginPath(); k.arc(X(f.x), Y(f.y), r * pp, 0, 2 * Math.PI); k.fill(); }, tex("stone.curb"));
    fill((k) => { k.beginPath(); k.arc(X(f.x), Y(f.y), (r - 0.35) * pp, 0, 2 * Math.PI); k.fill(); }, tex(s === "winter" ? "water.ice" : "water.pond"));
    fill((k) => { k.beginPath(); k.arc(X(f.x), Y(f.y), 0.4 * pp, 0, 2 * Math.PI); k.fill(); }, tex("stone.curb"));
  }

  // 9. Buildings: their shadows, floors, a soft contact shadow along their walls, and the walls (half a square thick,
  // plain until the walls are made from art)
  progress(0.55, "Buildings");
  if (feet.length) soft((k) => {
    for (const { b, f } of feet) {
      const d = ((20 + (b.tall ?? 0) * 20) / 5) * 0.3;
      for (let t = 0; t <= 1.0001; t += 0.1) { poly(k, f.map(([x, y]) => [x + SHADOW[0] * d * t, y + SHADOW[1] * d * t])); k.fill(); }
    }
  }, "rgb(16,24,40)", { blur: 0.3, alpha: 0.24, box: boxAround(feet.map(({ b, bb }) => { const d = ((20 + (b.tall ?? 0) * 20) / 5) * 0.3 * 0.7; return [bb[0] - d, bb[1] - d, bb[2], bb[3]]; })) });
  for (const { b, f } of feet) fill((k) => { poly(k, f); k.fill(); }, tex(floorRole(b), floorRole(b) === "floor.wood" ? Math.round(b.cx * 3 + b.cy) : 0, b.rot ?? 0));
  if (feet.length) {
    const outlines = (k, w) => { k.lineWidth = w * pp; k.lineJoin = "miter"; for (const { f } of feet) { poly(k, f); k.stroke(); } };
    soft((k) => outlines(k, 0.8), "rgb(10,12,18)", { blur: 0.25, alpha: 0.35, box: boxAround(feet.map((x) => x.bb), 0.4) });
    fill((k) => outlines(k, 0.5), "rgb(70,58,46)");
    fill((k) => outlines(k, 0.34), "rgb(150,132,108)");
  }

  // 10. Props on the ground (wells, carts, crates, a hedge's bushes), and tree shadows (each tree's own art, dark, to
  // the northwest)
  progress(0.75, "Props and trees");
  for (const p of items("prop").filter((p) => p.class !== "grave" && p.class !== "fountain")) {
    const bush = p.class === "bush";
    const size = bush ? p.scale ?? 0.5 : (PROP_SQUARES[p.class] ?? 0.45) * (p.scale ?? 1);
    const im = art(bush ? bushRole(s) : `prop.${p.class}`, p.variant);
    if (!im || !meets([p.x, p.y, p.x, p.y], size + 0.5)) continue;
    g.save(); g.translate(X(p.x), Y(p.y)); g.rotate(((p.rot ?? 0) * Math.PI) / 180);
    g.shadowColor = "rgba(16,24,40,0.45)"; g.shadowBlur = pp * 0.15; g.shadowOffsetX = SHADOW[0] * pp * 0.2; g.shadowOffsetY = SHADOW[1] * pp * 0.2;
    const w = size * pp; g.drawImage(im, -w / 2, -(w * im.height) / im.width / 2, w, (w * im.height) / im.width);
    g.restore();
  }
  const trees = items("tree").filter((t) => meets([t.x, t.y, t.x, t.y], crownOf(t, s) + 1));
  if (trees.length) soft((k) => {
    for (const t of trees) {
      const im = art(treeRole(t, s), t.variant ?? 0), size = crownOf(t, s), d = size * 0.18;
      k.save(); k.translate(X(t.x + SHADOW[0] * d * 1.4), Y(t.y + SHADOW[1] * d * 1.4)); k.rotate((treeTurn(t) * Math.PI) / 180);
      if (im) k.drawImage(im, (-size / 2) * pp, (-size / 2) * pp, size * pp, size * pp);
      else { k.beginPath(); k.arc(0, 0, (size / 2) * 0.8 * pp, 0, 2 * Math.PI); k.fill(); }
      k.restore();
    }
  }, "rgb(16,24,40)", { blur: 0.15, alpha: 0.35, box: boxAround(trees.map((t) => { const r = crownOf(t, s) / 2 + crownOf(t, s) * 0.26; return [t.x - r, t.y - r, t.x + r, t.y + r]; })) });
  progress(1, "Ground");
}

/**
 * The pieces painted apart, to lie over the map as tiles: { name, kind: "roof" | "canopy", box: [x0, y0, x1, y1] in
 * squares, ids: the buildings or trees on it, elevation in feet }. A house and its wings are one roof (they fade
 * together); trees are gathered by where they stand. Boxes are cut to the map.
 */
export function overheads(layout) {
  const [MW, MH] = layout.size.squares;
  const s = layout.season;
  const clip = ([a, b, c, d]) => [Math.max(0, a), Math.max(0, b), Math.min(MW, c), Math.min(MH, d)];
  const ok = ([a, b, c, d]) => c - a > 0.05 && d - b > 0.05;
  const out = [];
  const groups = new Map();
  for (const b of layout.items.filter((i) => i.kind === "building")) {
    const k = b.group ?? b.id;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  }
  let n = 0;
  for (const parts of groups.values()) {
    const pts = parts.flatMap((b) => footprint(b));
    const box = clip([Math.min(...pts.map((p) => p[0])) - 0.5, Math.min(...pts.map((p) => p[1])) - 0.5, Math.max(...pts.map((p) => p[0])) + 0.5, Math.max(...pts.map((p) => p[1])) + 0.5]);
    if (ok(box)) out.push({ name: `roof-${String(++n).padStart(3, "0")}`, kind: "roof", box, ids: parts.map((b) => b.id), elevation: OVERHEAD_ELEVATION.roof });
  }
  const cells = new Map();
  for (const t of layout.items.filter((i) => i.kind === "tree")) {
    const k = `${Math.floor(t.x / CANOPY_CELL)},${Math.floor(t.y / CANOPY_CELL)}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(t);
  }
  n = 0;
  for (const k of [...cells.keys()].sort()) {
    const ts = cells.get(k);
    const r = (t) => crownOf(t, s) / 2;
    const box = clip([Math.min(...ts.map((t) => t.x - r(t))), Math.min(...ts.map((t) => t.y - r(t))), Math.max(...ts.map((t) => t.x + r(t))), Math.max(...ts.map((t) => t.y + r(t)))]);
    if (ok(box)) out.push({ name: `canopy-${String(++n).padStart(3, "0")}`, kind: "canopy", box, ids: ts.map((t) => t.id), elevation: OVERHEAD_ELEVATION.canopy });
  }
  return out;
}

/**
 * Paints one overhead piece onto its own canvas, which covers the piece's box at pp px a square.
 * ctx: { g, W, H, pp, layout, art(role, variant) }. A roof is clipped to its building's walls, so it covers them exactly.
 */
export function paintOverhead(ctx, piece) {
  const { g, pp, layout: L, art } = ctx;
  const [x0, y0] = piece.box;
  const X = (x) => (x - x0) * pp, Y = (y) => (y - y0) * pp;
  const s = L.season;
  const ids = new Set(piece.ids);
  if (piece.kind === "roof") {
    const parts = L.items.filter((i) => i.kind === "building" && ids.has(i.id));
    g.save();
    g.beginPath();
    for (const b of parts) { footprint(b).forEach(([x, y], k) => (k ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); }
    g.clip("nonzero");
    // (each roof's art at true scale; chimneys a little over half a square across)
    for (const b of parts) {
      const im = art(`roof.${b.roof}.${s}`, b.variant);
      paintRoof(g, b, { x: X(b.cx), y: Y(b.cy), pp, art, season: s, texPx: ((im?.width ?? ART_PX) * pp) / ART_PX, chimney: 0.6 });
    }
    g.restore();
    return;
  }
  for (const t of L.items.filter((i) => i.kind === "tree" && ids.has(i.id)).sort((a, b) => a.y - b.y)) {
    const im = art(treeRole(t, s), t.variant ?? 0), size = crownOf(t, s);
    g.save(); g.translate(X(t.x), Y(t.y)); g.rotate((treeTurn(t) * Math.PI) / 180);
    if (im) g.drawImage(im, (-size / 2) * pp, (-size / 2) * pp, size * pp, size * pp);
    else { g.fillStyle = fallbackColor(treeRole(t, s)); g.beginPath(); g.arc(0, 0, (size / 2) * 0.8 * pp, 0, 2 * Math.PI); g.fill(); }
    g.restore();
  }
}
