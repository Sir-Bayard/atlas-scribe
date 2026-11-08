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
import { footprint, roofHeight } from "../../core/layout/battle.mjs";
import { FURNITURE } from "../../core/layout/rooms.mjs";
import { tiersOf, shelfOf, edgeSpan, shiftRight, resample, TERRAIN } from "../../core/layout/terrain.mjs";
import { paintRoof } from "./textured.mjs";
import { groundOf, levelAt, deckOf } from "../../core/height.mjs";
import { bands, union, offset } from "../../core/lots/poly.mjs";
import { distanceToPath, pointInPolygon } from "../../core/geom.mjs";

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

/** A tree crown's tile height, in feet above the ground: above any roof (a roof's own: roofHeight). */
export const OVERHEAD_ELEVATION = { canopy: 30 };
/** Trees are gathered onto canopy tiles about this many squares across (a tile per tree would be hundreds). */
const CANOPY_CELL = 24;

/** A tree's art role in a season (as the textured style's). */
const treeRole = (t, s) => (t.species === "bare" ? (s === "winter" ? "tree.bare.winter" : `tree.deciduous.${s}`) : `tree.conifer.${t.size ?? "large"}.${s}`);
/**
 * Where a path art strip's band lies across its image: its middle row and its height in rows, measured once from the
 * art (rows whose mean alpha is over half), so a wall can be stretched to its thickness whatever the art's band.
 */
const BANDS = new WeakMap();
function bandOf(im) {
  if (BANDS.has(im)) return BANDS.get(im);
  let band = { mid: im.height / 2, h: im.height * 0.25 };
  try {
    const w = Math.min(im.width, 400), c = new OffscreenCanvas(w, im.height), k = c.getContext("2d");
    k.drawImage(im, 0, 0, w, im.height, 0, 0, w, im.height);
    const d = k.getImageData(0, 0, w, im.height).data, rows = [];
    for (let y = 0; y < im.height; y++) { let s = 0; for (let x = 0; x < w; x++) s += d[(y * w + x) * 4 + 3]; if (s / w > 128) rows.push(y); }
    if (rows.length) band = { mid: (rows[0] + rows.at(-1) + 1) / 2, h: rows.at(-1) - rows[0] + 1 };
  } catch { /* (an image the canvas can't read: the guess above) */ }
  BANDS.set(im, band);
  return band;
}

/** A bank's art by its rock (a mossy bank is grassy). */
const BANK = { earthy: "edge.bank.earthy", slate: "edge.bank.slate", mossy: "edge.bank.mossy" };
/** The wild props laid flat on the ground (drawn first, no shadow), and those standing up (shadowed). */
/**
 * Whether a bank's art is laid flipped. FA's bank art has its grassy top along the top of the image, as its cliff art
 * has, so it isn't: the top lies on the high side, the grass (Patrick, 8 Nov: "your cliff top is on the water not the
 * grass" when it was flipped).
 */
const BANK_FLIP = false;
const FLAT_PROPS = new Set(["fern", "leaves", "roots", "branch"]);
/** The classes drawn as wild props (at their art's size) wherever they come from. */
const WILD_CLASSES = new Set(["fern", "log", "stump", "rock", "boulder", "branch", "roots", "leaves"]);

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

/**
 * A way cut short of a building (wallEnds, from the layout) drawn on to its wall: each cut end carried on by the way's
 * half width and a little more, so its rounded end lies under the building's floor and the way meets the wall square.
 */
export function toWall(w) {
  if (!w.wallEnds) return w;
  const d = (w.width ?? 1) / 2 + 0.3;
  const on = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [b[0] + ((b[0] - a[0]) / L) * d, b[1] + ((b[1] - a[1]) / L) * d]; };
  let path = w.path;
  if (w.wallEnds[1]) path = [...path, on(path.at(-2), path.at(-1))];
  if (w.wallEnds[0]) path = [on(path[1], path[0]), ...path];
  return { ...w, path };
}

/** A paved way's stone: a main road's flagstones, so it reads apart from the streets off it (as in the mockup). */
const wayPaving = (w) => (PAVING[w.surface] ? (w.class === "highway" ? "surface.flagstone" : PAVING[w.surface]) : null);
const wayRole = (w, s) => wayPaving(w) ?? (s === "winter" ? `surface.${w.surface ?? "dirt"}.winter` : UNPAVED[w.surface] ?? "surface.dirt");
const floorRole = (b) => (STONE_FLOORS.has(b.use) || b.tower ? "floor.stone" : "floor.wood");
/** A room's floor (its kind's: a kitchen's stone, a stable's dirt). */
const ROOM_FLOOR = { wood: "floor.wood", stone: "floor.stone", dirt: "surface.dirt" };
/** A quarter's own ground (look.ground: a market's paving, a crafts quarter's dirt), or null for lush grass. */
const isQuarter = (i) => i.kind === "surface" && i.class === "quarter" && !i.lush && Array.isArray(i.poly);
const quarterRole = (q, s) => PAVING[q.surface] ?? (q.surface === "trodden" ? `surface.trodden.${s}` : s === "winter" ? `surface.${q.surface ?? "dirt"}.winter` : UNPAVED[q.surface] ?? "surface.dirt");
const isPlaza = (i) => i.kind === "surface" && (i.class === "square" || i.class === "plaza" || i.class === "market") && Array.isArray(i.poly);

/**
 * A battle map's furniture, each piece a tile over the map (Patrick, 7 Nov: so a GM can move it): [{ role, variant,
 * piece }], rugs first (they lie under the rest).
 */
export function furniture(layout) {
  const out = [];
  for (const it of layout.items.filter((i) => i.kind === "interior")) for (const p of it.furniture ?? []) if (FURNITURE[p.f] && !FURNITURE[p.f].drawn) out.push({ role: `furn.${p.f}`, variant: p.variant ?? 0, piece: p });
  // (and each light's own piece: candles, a lamp, a lantern, a torch, a lamp post, a fire)
  for (const l of layout.items.filter((i) => i.kind === "light" && i.prop && FURNITURE[i.prop.f])) out.push({ role: `furn.${l.prop.f}`, variant: l.prop.variant ?? 0, piece: l.prop });
  // (a rug first, under the rest; what stands on a table last, over it)
  const order = (f) => (FURNITURE[f].floor ? 0 : FURNITURE[f].on ? 2 : 1);
  return out.sort((a, b) => order(a.piece.f) - order(b.piece.f));
}

/**
 * The mist over a battle map (its layout's mist items, layout/lights.mjs), each a fog overlay tile lying on the map
 * over the low place, under the tokens: [{ role, variant, x, y, size, rot, alpha }] (x, y its middle, size across, in
 * squares).
 */
export function mist(layout) {
  return layout.items.filter((i) => i.kind === "mist").map((m) => ({ role: "fog.light", variant: m.variant ?? 0, x: m.at[0], y: m.at[1], size: m.size, rot: m.rot ?? 0, alpha: m.alpha }));
}

export function rolesFor(layout) {
  const s = layout.season;
  const g = layout.items.find((i) => i.kind === "ground")?.base ?? "grass";
  const roles = new Set([`ground.${g}`, `ground.${g}.light`, `ground.${g}.clover`, `surface.trodden.${s}`, "stone.curb", "floor.wood", "floor.stone", "wood.fence", `stone.rough.${s}`]);
  for (const i of layout.items) {
    if (i.kind === "way" && !i.faint) roles.add(wayRole(i, s));
    if (isPlaza(i)) roles.add(PAVING[i.surface] ?? "surface.flagstone");
    if (isQuarter(i)) roles.add(quarterRole(i, s));
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
    if (i.kind === "shell") { roles.add(`wall.${i.material}`); if (i.walls.some((w) => w.type === "window")) roles.add("window.small"); }
    if (i.kind === "interior") {
      roles.add(`wall.${i.material}`);
      for (const r of i.rooms) roles.add(ROOM_FLOOR[r.floor] ?? "floor.wood");
      for (const f of i.furniture) if (!FURNITURE[f.f]?.drawn) roles.add(`furn.${f.f}`);
    }
    if (i.kind === "light" && i.prop && FURNITURE[i.prop.f]) roles.add(`furn.${i.prop.f}`);
    if (i.kind === "mist") roles.add("fog.light");
    if (i.kind === "boundary" && i.class === "fence") roles.add("fence.wood");
    if (i.kind === "wall" && i.class === "stone") roles.add("fence.stone");
    if (i.kind === "wall" && i.class === "palisade") roles.add("wood.stake");
    if (i.kind === "level" && i.bed) roles.add(`surface.bed.${s}`);
    if (i.kind === "edge") {
      if (i.style === "slope" && s !== "winter") roles.add("edge.grass");
      if (i.style === "cliff") { roles.add(`edge.face.${i.rock}`); roles.add(`edge.top.${i.rock}`); roles.add(`edge.foot.${i.rock}`); }
      if (i.style === "bank") roles.add(BANK[i.rock] ?? "edge.bank.earthy");
    }
    if (i.kind === "tree" && i.wild && s !== "winter") roles.add(`ground.forest.${s}`);
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
  const { mask, W, H, x0, y0, pp, layout: L, art, progress = () => {} } = ctx;
  // (the map's canvas; for a while a layer of its own, to be laid over it softened)
  let g = ctx.g;
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
  /**
   * A path art strip (FA's "_Path" art: a band along the middle of a 200 px tall image, repeating along its length)
   * laid along a to b, its pattern starting at a (so tiles agree), carried ext0 and ext1 squares past each end.
   */
  const stripPatterns = new Map();
  const strip = (im, a, b, ext0 = 0, ext1 = 0, phase = 0, { width = null, clip = null, flip = false } = {}) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    if (L < 1e-3) return;
    g.save();
    if (clip) { poly(g, clip); g.clip(); }
    // (width: the band's thickness in squares, the art stretched across to it; else the art's own)
    const band = bandOf(im), ky = width ? (width * ART_PX) / band.h : 1;
    g.translate(X(a[0]), Y(a[1])); g.rotate(Math.atan2(dy, dx)); g.scale(pp / ART_PX, (pp / ART_PX) * ky * (flip ? -1 : 1));
    // (one pattern for each image: a map has hundreds of wall pieces)
    let p = stripPatterns.get(im);
    if (!p) stripPatterns.set(im, (p = g.createPattern(im, "repeat-x")));
    p.setTransform(new DOMMatrix().translate(-phase * ART_PX, -band.mid));
    g.fillStyle = p;
    g.fillRect(-ext0 * ART_PX, -band.mid, (L + ext0 + ext1) * ART_PX, im.height);
    g.restore();
  };
  const stripPath = (im, path, phase = 0, flip = false) => { let t = phase; for (let i = 1; i < path.length; i++) { strip(im, path[i - 1], path[i], i > 1 ? 0.05 : 0, 0, t, { flip }); t += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); } };
  /** A rectangle w by d squares around cx, cy, turned rot degrees, as a polygon on the map (so a pattern stays anchored). */
  const rectAt = (cx, cy, w, d, rot) => {
    const a = (rot * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [cx + ((u * w) / 2) * c - ((v * d) / 2) * sn, cy + ((u * w) / 2) * sn + ((v * d) / 2) * c]);
  };

  const ground = L.items.find((i) => i.kind === "ground");
  const gb = ground?.base ?? "grass";
  const ways = items("way").filter((w) => !w.faint && Array.isArray(w.path) && w.path.length >= 2).map(toWall).map((w) => ({ w, bb: bboxOf(w.path) })).filter(({ w, bb }) => meets(bb, (w.width ?? 1) / 2 + 2)).map(({ w }) => w);
  const feet = items("building").map((b) => { const f = footprint(b); return { b, f, bb: bboxOf(f) }; }).filter(({ bb }) => meets(bb, 6));

  // 1. The ground: its art, a second grass and a little clover in broad soft patches
  progress(0.02, "Ground");
  g.fillStyle = tex(`ground.${gb}`); g.fillRect(0, 0, W, H);
  soft((k) => k.fillRect(0, 0, W, H), tex(`ground.${gb}.light`), { noise: noiseMask("battle-g1", 10, 0.25, 0.2), alpha: 0.5 });
  if (art(`ground.${gb}.clover`)) soft((k) => k.fillRect(0, 0, W, H), tex(`ground.${gb}.clover`), { noise: noiseMask("battle-g2", 7, 0.45, 0.15), alpha: 0.6 });

  // 1b. A quarter's own ground, as its overview shows it (a market paved, a crafts quarter's dirt), worn into patches
  // with the grass showing through
  for (const q of L.items.filter(isQuarter)) {
    const bb = bboxOf(q.poly);
    if (!meets(bb, 1)) continue;
    soft((k) => { poly(k, q.poly); k.fill(); }, tex(quarterRole(q, s)), { blur: 0.5, alpha: q.alpha ?? 0.7, noise: noiseMask(`battle-q-${q.id}`, 5, -0.35, 0.35), box: bb });
  }

  // 1c. Height: the lower a level lies the darker its ground (light comes down into a cut less), a stream's bed of
  // stones and gravel under its water; then under the woods a forest floor in soft patches
  const levels = items("level").filter((Lv) => Lv.rings.some((r) => r.length >= 3 && meets(bboxOf(r), 2)));
  // (the bed's stones only on its floor, the shelf along the water: up the banks each tier's top is the ground's own
  // grass, a terrace stepping down, not a strip of stones between two banks)
  for (const Lv of levels.filter((x) => x.bed && !x.within)) {
    const w = L.items.find((i) => i.id === Lv.water && Array.isArray(i.path));
    const floor = w ? bands([{ path: w.path, half: (w.width ?? 1) / 2 + shelfOf(Lv.style) + 0.1 }]) : Lv.rings;
    const box = boxAround(floor.map(bboxOf), 0.2);
    soft((k) => { for (const r of floor) poly(k, r); k.fill("evenodd"); }, tex(`surface.bed.${s}`), { blur: 0.2, box });
  }
  for (const Lv of levels.filter((x) => x.elevation < 0)) {
    const box = boxAround(Lv.rings.map(bboxOf), 0.4);
    soft((k) => { for (const r of Lv.rings) poly(k, r); k.fill("evenodd"); }, "rgb(14,20,34)", { blur: 0.35, alpha: Math.min(0.45, (-Lv.elevation / 10) * 0.3), box });
  }
  // (a wood's own trees, not a park's or a hedgerow's; none in winter, when the snow lies over it)
  const woods = s === "winter" ? [] : L.items.filter((i) => i.kind === "tree" && i.wild && meets([i.x, i.y, i.x, i.y], 4));
  if (woods.length && art(`ground.forest.${s}`)) soft((k) => { for (const t of woods) { k.beginPath(); k.arc(X(t.x), Y(t.y), 3.2 * pp, 0, 2 * Math.PI); k.fill(); } }, tex(`ground.forest.${s}`), { blur: 0.9, alpha: 0.4, noise: noiseMask("battle-forest", 4, -0.15, 0.3), box: boxAround(woods.map((t) => [t.x, t.y, t.x, t.y]), 3.5) });

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
      // (in a bed below its banks the bed is its edge: no trodden bank up here)
      const inBed = levels.some((Lv) => Lv.bed && Lv.water === w.id);
      if (!inBed) soft((k) => stroke(k, w.path, width + 2.4), trodden, { blur: 0.5, alpha: 0.7, box });
      soft((k) => stroke(k, w.path, width + (inBed ? 0.5 : 1)), tex(`stone.rough.${s}`), { blur: 0.25, alpha: inBed ? 0.6 : 1, box });
      soft((k) => stroke(k, w.path, width), tex(role), { blur: 0.06, box });
      if (!w.frozen) soft((k) => stroke(k, w.path, width * 0.5), "rgb(8,40,52)", { blur: 1, alpha: 0.3, box });
    }
  }
  // (a hollow a stream fills: its water over the whole hollow, its edge's banks laid over the shore, deeper in the middle)
  for (const Lv of levels.filter((x) => x.within)) {
    const w = L.items.find((i) => i.id === Lv.water);
    const role = w?.frozen ? "water.ice" : `water.${w?.class ?? "stream"}`, box = boxAround(Lv.rings.map(bboxOf), 0.5);
    const inner = offset(Lv.rings, -(edgeSpan({ drop: Lv.shore ?? 10, style: Lv.style }) - 0.1));
    soft((k) => { for (const r of inner) poly(k, r); k.fill("evenodd"); }, tex(role), { blur: 0.06, box });
    if (!w?.frozen) soft((k) => { for (const r of offset(Lv.rings, -1.6)) poly(k, r); k.fill("evenodd"); }, "rgb(8,40,52)", { blur: 1, alpha: 0.3, box });
  }

  // 3b. Edges where the ground drops, as FA builds them (the Map Dressing Guide's tiers): a cliff in a tier of rock
  // face for every five feet, each a little lower than the one above it and drawn beneath it, the rubble at its foot,
  // a shadow tucked under each tier, darker going down, and a lip along the top; a bank in tiers of bank art; a
  // walkable slope as shade on the side turned from the sun. Each tier wanders a little on its own
  progress(0.2, "Banks and cliffs");
  const edges = items("edge").filter((e) => meets(bboxOf(e.path), edgeSpan(e) + 1));
  // (how far out a bank's foot lies from its line: by its own drop, or a pool's whole shore, so the step where a stream
  // falls into the pool is laid as the foot of the shore around it)
  const footOf = (e) => edgeSpan(e.shore ? { drop: e.shore, style: e.style } : e);
  const wob = makeNoise(L.seed ?? 1, "battle-edge", { scale: 3, octaves: 2 });
  const tierPath = (e, d, k) => {
    const pts = resample(e.path, 0.5), calm = e.style === "bank" && tiersOf(e.shore ?? e.drop, e.style) > 2;
    return pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], Ln = Math.hypot(dx, dy) || 1;
      // (a tall bank's many tiers wander less: they overlap less than a cliff's, and wandering apart would open gaps)
      const dd = d + wob(p[0] + k * 17.3, p[1] - k * 9.1) * (calm ? 0.06 : 0.14) * Math.min(2, k);
      return [p[0] - (dy / Ln) * dd, p[1] + (dx / Ln) * dd];
    });
  };
  for (const e of edges.filter((x) => x.style === "slope")) {
    const span = edgeSpan(e), pts = resample(e.path, 0.5), far = shiftRight(pts, span);
    const bb = boxAround([bboxOf(pts), bboxOf(far)], 0.5);
    // (each stretch shaded by how far its downhill side turns from the sun, low in the southeast)
    soft((k) => {
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1], Ln = Math.hypot(dx, dy) || 1;
        const down = [-dy / Ln, dx / Ln], away = (down[0] * SHADOW[0] + down[1] * SHADOW[1]) / Math.hypot(...SHADOW);
        if (away <= 0.05) continue;
        k.globalAlpha = Math.min(1, away);
        poly(k, [pts[i - 1], pts[i], far[i], far[i - 1]]); k.fill();
      }
      k.globalAlpha = 1;
    }, "rgb(14,20,34)", { blur: 0.6, alpha: Math.min(0.75, 0.42 * tiersOf(e.drop)), box: bb });
    // (and the side turned to the sun a little lighter, the top of the slope edged with longer grass)
    soft((k) => {
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1], Ln = Math.hypot(dx, dy) || 1;
        const down = [-dy / Ln, dx / Ln], toward = -(down[0] * SHADOW[0] + down[1] * SHADOW[1]) / Math.hypot(...SHADOW);
        if (toward <= 0.05) continue;
        k.globalAlpha = Math.min(1, toward);
        poly(k, [pts[i - 1], pts[i], far[i], far[i - 1]]); k.fill();
      }
      k.globalAlpha = 1;
    }, "rgb(255,248,210)", { blur: 0.6, alpha: 0.4, op: "soft-light", box: bb });
    // (the brow: longer grass a little down from the top)
    const grass = art("edge.grass", 0);
    if (grass) { g.save(); g.globalAlpha = 0.55; stripPath(grass, tierPath(e, 0.35, 1)); g.restore(); }
  }
  // (where a stream's bed steps down, as into a hollow, its banks' art and shadows are kept off its water, which falls
  // there in a line of white water instead)
  const waterOf = new Map(items("water").filter((w) => Array.isArray(w.path)).map((w) => [w.id, w]));
  const fallWater = (e, by = 0.05) => { const w = e.fall ? waterOf.get(e.water) : null; return w ? bands([{ path: w.path, half: (w.width ?? 1) / 2 + by }]) : null; };
  const shadeEdge = (e) => {
    // (the drop's own shadow on the low ground past its foot, where it faces away from the sun: longer the higher)
    const pts = resample(e.path, 0.5), foot = shiftRight(pts, edgeSpan(e)), far = shiftRight(pts, edgeSpan(e) + Math.min(3, (e.drop / 5) * 0.7));
    soft((k) => {
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1], Ln = Math.hypot(dx, dy) || 1;
        const down = [-dy / Ln, dx / Ln], away = (down[0] * SHADOW[0] + down[1] * SHADOW[1]) / Math.hypot(...SHADOW);
        if (away <= 0) continue;
        k.globalAlpha = Math.min(1, away * 1.2);
        poly(k, [foot[i - 1], foot[i], far[i], far[i - 1]]); k.fill();
      }
      k.globalAlpha = 1;
    }, "rgb(14,20,34)", { blur: 0.45, alpha: 0.32, box: boxAround([bboxOf(pts), bboxOf(far)], 0.6) });
  };
  const drawEdge = (e) => {
    // (a fall into a pool is drawn, off its water, as the pool's whole shore, so the shore runs unbroken past the stream)
    const n = tiersOf(e.fall && e.shore ? e.shore : e.drop, e.style), cliff = e.style === "cliff";
    const face = cliff ? art(`edge.face.${e.rock}`, 0) : art(BANK[e.rock] ?? "edge.bank.earthy", 0);
    const face2 = cliff ? art(`edge.face.${e.rock}`, 1) ?? face : art(BANK[e.rock] ?? "edge.bank.earthy", 1) ?? face;
    // (the rubble at the foot, under everything)
    const footArt = cliff ? art(`edge.foot.${e.rock}`, 0) : null;
    if (footArt) stripPath(footArt, tierPath(e, 0.25 + (n - 1) * TERRAIN.step + 0.4, n + 1));
    if (!cliff && !e.fall) {
      // (the bank's shadow on the water, cast where its face is turned from the sun, the longer the deeper it drops)
      const span = footOf(e) + 0.04, pts = resample(e.path, 0.5), foot = [], far = [];
      pts.forEach((p, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], Ln = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const nx = -(b[1] - a[1]) / Ln, ny = (b[0] - a[0]) / Ln, away = (nx * SHADOW[0] + ny * SHADOW[1]) / Math.hypot(...SHADOW);
        const len = Math.max(0, away) * (Math.abs(e.drop) / 10) * 0.45;
        foot.push([p[0] + nx * (span - 0.15), p[1] + ny * (span - 0.15)]); far.push([p[0] + nx * (span + len), p[1] + ny * (span + len)]);
      });
      soft((kk) => { poly(kk, [...foot, ...far.reverse()]); kk.fill(); }, "rgb(6,14,22)", { blur: 0.25, alpha: 0.4, box: boxAround([bboxOf(e.path)], edgeSpan(e) + 2) });
    }
    for (let k = n; k >= 1; k--) {
      // (a bank's tier laid with its top toward the edge's line and its face of earth and roots running down toward
      // the low side, the lowest one's foot just into the water: FA's woodland cliff art, as a GM draws it along a stream)
      const half = !cliff && face ? bandOf(face).h / ART_PX / 2 : TERRAIN.bankBand / 2;
      const d = cliff ? 0.25 + (k - 1) * TERRAIN.step : Math.max(half, footOf(e) - half - (n - k) * TERRAIN.bankStep + 0.04);
      // (the shadow under this tier, tucked in below its middle line and painted soft, darker going down: the tier's
      // art covers it where solid. Painted, not drawn from shadow art, whose pieces overlap in lines where it's
      // see-through)
      if (cliff) soft((kk) => stroke(kk, tierPath(e, d + 0.3, k), 0.42, "butt"), "rgb(14,20,34)", { blur: 0.16, alpha: Math.min(0.75, 0.32 + 0.22 * (k / n)), box: boxAround([bboxOf(e.path)], edgeSpan(e) + 1) });
      // (lighter between many tiers, where the lines would stack up)
      else if (k < n) soft((kk) => stroke(kk, tierPath(e, d + half - 0.04, k), 0.22, "butt"), "rgb(14,20,34)", { blur: 0.1, alpha: n > 2 ? 0.28 : 0.5, box: boxAround([bboxOf(e.path)], edgeSpan(e) + 1) });
      const im = k % 2 ? face : face2;
      if (im) stripPath(im, tierPath(e, d, k), k * 0.37, !cliff && BANK_FLIP);
      else fill((kk) => stroke(kk, tierPath(e, d, k), 0.5, "butt"), cliff ? "rgb(110,100,88)" : "rgb(96,84,60)");
    }
    // (where a bank's face goes into the water, dark: the foot of the face in shade, the water against it deep)
    if (!cliff && !e.fall) soft((kk) => stroke(kk, tierPath(e, footOf(e) - 0.04, n), 0.26, "butt"), "rgb(6,14,22)", { blur: 0.12, alpha: 0.45, box: boxAround([bboxOf(e.path)], edgeSpan(e) + 1) });
    const lip = cliff ? art(`edge.top.${e.rock}`, 0) : null;
    if (lip) stripPath(lip, tierPath(e, -0.05, 0), 0.21);
  };
  // (a pool's edges, its shore and the falls where its stream comes and goes, are drawn as one: its hollow's whole rim,
  // unbroken, its water's channel cut through it after, softly)
  const plain = edges.filter((x) => x.style !== "slope" && !x.pool);
  for (const e of plain) shadeEdge(e);
  for (const e of plain) drawEdge(e);
  for (const Lv of levels.filter((x) => x.within && meets(boxAround(x.rings.map(bboxOf), 0), 3))) {
    const w = waterOf.get(Lv.water);
    const rims = Lv.rings.map((r) => {
      const inside = Lv.rings.filter((o) => o !== r && pointInPolygon(r[0], o)).length % 2 === 1;
      let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q2 = r[(i + 1) % r.length]; a += p[0] * q2[1] - q2[0] * p[1]; }
      const pts = (a > 0) !== inside ? r : [...r].reverse();
      return { kind: "edge", id: `${Lv.id}/rim`, path: [...pts, pts[0]], closed: true, drop: Lv.shore ?? 10, high: Lv.elevation + (Lv.shore ?? 10), low: Lv.elevation, style: Lv.style ?? "bank", rock: Lv.rock, bed: true };
    });
    const box = boxAround(Lv.rings.map(bboxOf), 3), rx = Math.max(0, Math.floor(X(box[0]))), ry = Math.max(0, Math.floor(Y(box[1])));
    const rw = Math.min(W, Math.ceil(X(box[2]))) - rx, rh = Math.min(H, Math.ceil(Y(box[3]))) - ry;
    if (rw <= 0 || rh <= 0) continue;
    const layer = new OffscreenCanvas(W, H), lg = layer.getContext("2d"), g0 = g;
    g = lg;
    try { for (const e of rims) shadeEdge(e); for (const e of rims) drawEdge(e); } finally { g = g0; }
    if (w && Array.isArray(w.path)) {
      lg.save(); lg.globalCompositeOperation = "destination-out"; lg.filter = `blur(${0.12 * pp}px)`;
      lg.lineCap = "round"; lg.lineJoin = "round"; lg.lineWidth = Math.max(0.2, (w.width ?? 1) - 0.1) * pp;
      path(lg, w.path); lg.stroke(); lg.restore();
    }
    g.drawImage(layer, rx, ry, rw, rh, rx, ry, rw, rh);
  }
  // (the fall itself: dark water just below the step, white water broken along it)
  for (const e of edges.filter((x) => x.fall)) {
    const wb = fallWater(e);
    if (!wb) continue;
    g.save(); g.beginPath();
    for (const r of wb) { r.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); }
    g.clip();
    const box = boxAround([bboxOf(e.path)], 1.5), drop = Math.min(1.2, 0.3 + e.drop / 25);
    soft((kk) => stroke(kk, tierPath(e, drop / 2 + 0.1, 2), drop, "butt"), "rgb(6,14,22)", { blur: 0.25, alpha: 0.35, box });
    soft((kk) => stroke(kk, tierPath(e, drop + 0.3, 3), 0.8, "butt"), "rgb(214,228,230)", { blur: 0.2, alpha: 0.35, noise: noiseMask("battle-fall2", 0.35, 0.15, 0.5), box });
    soft((kk) => stroke(kk, tierPath(e, 0.12, 2), 0.3, "butt"), "rgb(232,240,240)", { blur: 0.07, alpha: 0.8, noise: noiseMask("battle-fall", 0.3, -0.05, 0.45), box });
    g.restore();
  }

  // 4. Ways: a trodden verge; an unpaved way's dirt; a paved one's curb (with its shadow on the grass and the joint
  // between curb and paving), then its paving, narrower first, so the main road runs through a junction. Ways of one
  // look share a pass
  progress(0.25, "Streets");
  const wayBox = (list, add) => boxAround(list.map((w) => { const bb = bboxOf(w.path), r = (w.width ?? 1) / 2 + add; return [bb[0] - r, bb[1] - r, bb[2] + r, bb[3] + r]; }));
  const paved = ways.filter(wayPaving);
  // (no way is painted down in a stream's bed: a bridge carries it over, and the road showing under the deck, curving
  // where the deck runs straight, read wrong; a ford's crossing is left open so its track runs through)
  const cutBeds = items("level").filter((Lv) => Lv.bed && meets(bboxOf(Lv.rings.flat()), 1));
  g.save();
  if (cutBeds.length) {
    g.beginPath();
    g.rect(0, 0, W, H);
    // (one outline for all of them: a pool's rings overlap its stream's bed, which even-odd would leave uncut)
    for (const ring of union(cutBeds.flatMap((Lv) => Lv.rings))) { ring.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); }
    for (const c of items("crossing").filter((c) => c.class === "ford" && Array.isArray(c.at))) { deckOf(c).forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); }
    g.clip("evenodd");
  }
  // (an unpaved way narrows onto a footbridge's planks over its last squares, rather than running on under the deck
  // at its own width: stroked a short piece at a time, each as wide as the way is there)
  const decks = items("crossing").filter((c) => c.class === "footbridge" && Array.isArray(c.at)).map((c) => {
    const a = ((c.angle ?? 0) * Math.PI) / 180;
    return { at: c.at, ux: Math.cos(a), uy: Math.sin(a), hl: (c.length ?? 2) / 2, hw: (c.width ?? 2) / 2 };
  });
  const TAPER = 3.5;
  // (a point of a way that runs onto decks, narrowed evenly about its middle to the deck's planks over its last squares
  // (the layout has already bent it onto the deck's middle line), or null under the deck itself, where nothing of the
  // way is drawn)
  const nearDecks = (p, onto, w, extra) => {
    let width = w + extra;
    for (const d of onto) {
      const dx = p[0] - d.at[0], dy = p[1] - d.at[1], u = dx * d.ux + dy * d.uy, v = -dx * d.uy + dy * d.ux;
      if (Math.abs(v) > w + 1.5 || Math.abs(u) > d.hl + TAPER) continue;
      if (Math.abs(u) < d.hl - 0.25 && Math.abs(v) < d.hw + 0.3) return null;
      const t = Math.min(1, Math.max(0, (Math.abs(u) - d.hl) / TAPER)), e = t * t * (3 - 2 * t);
      const inner = (d.hw - 0.3) * 2;
      width = Math.min(width, inner + (w + extra - inner) * e);
    }
    return { q: p, width };
  };
  // (the decks a way runs onto: those it passes through the middle of; any other way near a bridge is drawn as it is)
  const ontoDecks = new Map(ways.map((w) => [w, decks.filter((d) => distanceToPath(d.at, w.path) < d.hw + 0.5)]));
  const wayStroke = (k, w, extra) => {
    const onto = ontoDecks.get(w) ?? [];
    if (!onto.length) return stroke(k, w.path, w.width + extra);
    const pts = resample(w.path, 0.15).map((p) => nearDecks(p, onto, w.width, extra));
    for (let i = 1; i < pts.length; i++) if (pts[i - 1] && pts[i]) stroke(k, [pts[i - 1].q, pts[i].q], Math.min(pts[i - 1].width, pts[i].width));
  };
  if (ways.length) soft((k) => { for (const w of ways) wayStroke(k, w, 0.8); }, trodden, { blur: 0.25, alpha: 0.8, box: wayBox(ways, 0.4) });
  const dirt = new Map();
  for (const w of ways.filter((w) => !wayPaving(w))) { const r = wayRole(w, s); if (!dirt.has(r)) dirt.set(r, []); dirt.get(r).push(w); }
  for (const [r, list] of dirt) soft((k) => { for (const w of list) wayStroke(k, w, 0); }, tex(r), { blur: 0.15, box: wayBox(list, 0) });
  if (paved.length) {
    soft((k) => { for (const w of paved) stroke(k, w.path, w.width + 0.55); }, "rgb(20,20,24)", { blur: 0.12, alpha: 0.35, box: wayBox(paved, 0.3) });
    fill((k) => { for (const w of paved) stroke(k, w.path, w.width + 0.5); }, tex("stone.curb"));
    fill((k) => { for (const w of paved) stroke(k, w.path, w.width + 0.08); }, "rgb(40,36,32)", 0.55);
    for (const w of [...paved].sort((a, b) => a.width - b.width)) fill((k) => stroke(k, w.path, w.width), tex(wayRole(w, s), wayRole(w, s) === "surface.flagstone" ? 1 : 0));
  }
  g.restore();

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
  const levelItemsAll = items("level");
  for (const c of items("crossing").filter((c) => c.class !== "ford" && Array.isArray(c.at))) {
    const a = ((c.angle ?? 0) * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux, hl = (c.length ?? 2) / 2, hw = (c.width ?? 4) / 2;
    const pts = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([u, v]) => [c.at[0] + u * ux + v * nx, c.at[1] + u * uy + v * ny]);
    const bb = bboxOf(pts);
    if (!meets(bb, 2)) continue;
    // (its shadow on the water, cast the farther and softer the deeper the bed below it)
    const lowBy = Math.max(0, levelAt(levelItemsAll, [c.at[0] + ux * hl, c.at[1] + uy * hl]) - levelAt(levelItemsAll, c.at));
    const off = 0.85 + (lowBy / 10) * 0.7;
    // (only down in the bed it spans: where its ends rest on the bank, the deck lies on the ground and casts none)
    const under = levelItemsAll.filter((Lv) => Lv.bed && Lv.rings.some((r) => r.some((p) => Math.hypot(p[0] - c.at[0], p[1] - c.at[1]) < hl + 4)));
    g.save();
    if (under.length) { g.beginPath(); for (const ring of union(under.flatMap((Lv) => Lv.rings))) { ring.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); } g.clip("evenodd"); }
    soft((k) => { poly(k, pts.map(([x, y]) => [x + SHADOW[0] * off, y + SHADOW[1] * off])); k.fill(); }, "rgb(0,0,0)", { blur: 0.4 + lowBy / 40, alpha: 0.4, box: [bb[0] - 2, bb[1] - 2, bb[2], bb[3]] });
    g.restore();
    // (a road bridge in flagstones edged in stone; a footbridge a deck of planks laid across it, a dark beam along
    // each side, its ends worn where the track comes on, so the way runs onto it rather than stopping at a box)
    if (c.class === "footbridge") {
      fill((k) => { poly(k, pts); k.fill(); }, tex("floor.wood", 1, (c.angle ?? 0) + 90));
      const side = (v) => [[-hl, v], [hl, v]].map(([u, w]) => [c.at[0] + u * ux + w * nx, c.at[1] + u * uy + w * ny]);
      soft((k) => { stroke(k, side(-hw + 0.06), 0.16, "butt"); stroke(k, side(hw - 0.06), 0.16, "butt"); }, "rgb(34,24,16)", { blur: 0.03, alpha: 0.75, box: bb });
      // (a sill beam across each end, where the planks rest on the bank, and the track's dirt carried onto them by feet)
      soft((k) => { for (const sg of [-1, 1]) stroke(k, [[-hw + 0.1, sg * (hl - 0.06)], [hw - 0.1, sg * (hl - 0.06)]].map(([v, u]) => [c.at[0] + u * ux + v * nx, c.at[1] + u * uy + v * ny]), 0.12, "butt"); }, "rgb(34,24,16)", { blur: 0.03, alpha: 0.6, box: bb });
      const onto = ways.find((w) => !wayPaving(w) && distanceToPath(c.at, w.path) < hw + 0.5);
      const worn = onto ? tex(wayRole(onto, s)) : trodden;
      soft((k) => { for (const sg of [-1, 1]) { const e = [c.at[0] + sg * ux * hl, c.at[1] + sg * uy * hl]; stroke(k, [[e[0] - sg * ux * 1.1, e[1] - sg * uy * 1.1], [e[0] + sg * ux * 0.05, e[1] + sg * uy * 0.05]], (hw - 0.2) * 2, "butt"); } }, worn, { blur: 0.35, alpha: 0.6, noise: noiseMask("battle-deck", 1.2, -0.3, 0.6), box: [bb[0] - 1, bb[1] - 1, bb[2] + 1, bb[3] + 1] });
    } else {
      fill((k) => { poly(k, pts); k.fill(); }, tex("surface.flagstone", 1, c.angle ?? 0));
      fill((k) => { poly(k, pts); k.lineWidth = 0.5 * pp; k.stroke(); }, tex("stone.curb"));
    }
  }

  // 7. Yards: trodden ground inside each fenced yard; fences (rails on posts) and walls, with their shadows
  // (a house's fenced yard behind it, and a trade's work yard)
  // (a yard left as grass, a precinct's or a lawn, isn't worn)
  const yards = items("surface").filter((i) => (i.class === "backyard" || (i.class === "yard" && i.surface !== "grass")) && Array.isArray(i.poly)).map((y) => ({ y, bb: bboxOf(y.poly) })).filter(({ bb }) => meets(bb, 1.5));
  if (yards.length) soft((k) => { for (const { y } of yards) { poly(k, y.poly); k.fill(); } }, trodden, { blur: 0.3, noise: noiseMask("battle-yd", 2.5, -0.3, 0.4), alpha: 0.7, box: boxAround(yards.map((x) => x.bb)) });
  // (rails: a yard's fence and any other fence or wall line; not hedges, balks or a garden's clipped box)
  const isRail = (b) => /\/rail\d$/.test(b.id ?? "");
  const fences = items("boundary").filter((b) => Array.isArray(b.path) && b.path.length >= 2 && b.class !== "hedge" && b.class !== "balk" && b.class !== "clipped" && !isRail(b) && meets(bboxOf(b.path), 1));
  // (a footbridge's rails: a plain dark wooden handrail on posts, not the yard fence's art)
  const rails = items("boundary").filter((b) => isRail(b) && Array.isArray(b.path) && b.path.length >= 2 && meets(bboxOf(b.path), 1));
  if (rails.length) {
    const rb = boxAround(rails.map((f) => bboxOf(f.path)), 0.5);
    soft((k) => { for (const f of rails) stroke(k, f.path.map(([x, y]) => [x + SHADOW[0] * 0.12, y + SHADOW[1] * 0.12]), 0.2, "butt"); }, "rgb(10,12,18)", { blur: 0.05, alpha: 0.45, box: rb });
    const posts = [];
    for (const f of rails) {
      const [a, b] = [f.path[0], f.path.at(-1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(l / 1.25));
      for (let i = 0; i <= n; i++) posts.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
    }
    fill((k) => { for (const [x, y] of posts) { k.beginPath(); k.rect(X(x - 0.1), Y(y - 0.1), 0.2 * pp, 0.2 * pp); k.fill(); } }, "rgb(38,27,19)");
    for (const f of rails) {
      const ang = (Math.atan2(f.path.at(-1)[1] - f.path[0][1], f.path.at(-1)[0] - f.path[0][0]) * 180) / Math.PI;
      fill((k) => stroke(k, f.path, 0.13, "butt"), tex("floor.wood", 0, ang));
      fill((k) => stroke(k, f.path, 0.13, "butt"), "rgb(44,30,20)", 0.45);
    }
    fill((k) => { for (const [x, y] of posts) { k.beginPath(); k.rect(X(x - 0.07), Y(y - 0.07), 0.14 * pp, 0.14 * pp); k.fill(); } }, "rgb(70,52,36)");
  }
  if (fences.length) {
    soft((k) => { for (const f of fences) stroke(k, f.path.map(([x, y]) => [x - 0.1, y - 0.1]), 0.35, "butt"); }, "rgb(16,20,30)", { blur: 0.08, alpha: 0.35, box: boxAround(fences.map((f) => bboxOf(f.path)), 0.4) });
    const fenceArt = art("fence.wood");
    if (fenceArt) for (const f of fences) stripPath(fenceArt, f.path);
    else fill((k) => { for (const f of fences) stroke(k, f.path, 0.14, "butt"); }, tex("wood.fence"));
    if (!fenceArt) fill((k) => {
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
    // (a yard's low wall from fence art where there is some; a town wall, thicker, stays a stone fill)
    // (a bridge's parapet: a band of dressed stone, its edges dark)
    const parapets = stone.filter((w) => w.parapet);
    if (parapets.length) {
      fill((k) => { for (const w of parapets) stroke(k, w.path, 0.48, "butt"); }, "rgb(34,32,30)", 0.8);
      fill((k) => { for (const w of parapets) stroke(k, w.path, 0.4, "butt"); }, tex("stone.curb"));
    }
    const lowArt = art("fence.stone");
    const low = lowArt ? stone.filter((w) => !w.parapet && !(w.thickness > 0.6)) : [];
    for (const w of low) stripPath(lowArt, w.path);
    const high = stone.filter((w) => !w.parapet && !low.includes(w));
    if (high.length) fill((k) => { for (const w of high) stroke(k, w.path, thick(w), "butt"); }, tex(`stone.rough.${s}`));
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

  // 9. Buildings: their shadows, floors, a soft contact shadow along their walls, and the walls (from wall and window
  // art, or plain without it)
  progress(0.55, "Buildings");
  if (feet.length) soft((k) => {
    for (const { b, f } of feet) {
      const d = ((20 + (b.tall ?? 0) * 20) / 5) * 0.3;
      for (let t = 0; t <= 1.0001; t += 0.1) { poly(k, f.map(([x, y]) => [x + SHADOW[0] * d * t, y + SHADOW[1] * d * t])); k.fill(); }
    }
  }, "rgb(16,24,40)", { blur: 0.3, alpha: 0.24, box: boxAround(feet.map(({ b, bb }) => { const d = ((20 + (b.tall ?? 0) * 20) / 5) * 0.3 * 0.7; return [bb[0] - d, bb[1] - d, bb[2], bb[3]]; })) });
  for (const { b, f } of feet) fill((k) => { poly(k, f); k.fill(); }, tex(floorRole(b), floorRole(b) === "floor.wood" ? Math.round(b.cx * 3 + b.cy) : 0, b.rot ?? 0));
  // Interiors: each room's floor where it isn't the building's (under the shadow along the walls), then below a stage
  // and the walls between rooms (the building's wall art, thinner; a door's gap and an open doorway's left). The
  // furniture isn't painted: it lies over the map as tiles (furniture(layout))
  const interiors = items("interior").filter((it) => meets(bboxOf(it.rooms.flatMap((r) => r.poly)), 1)).map((it) => {
    const b = feet.find(({ b }) => (b.group ?? b.id) === it.group)?.b;
    return { it, b, rot: b?.rot ?? 0, woodV: b ? Math.round(b.cx * 3 + b.cy) : 0 };
  });
  for (const { it, b, rot, woodV } of interiors) for (const r of it.rooms) {
    const role = ROOM_FLOOR[r.floor] ?? "floor.wood";
    if (b && role === floorRole(b)) continue;
    fill((k) => { poly(k, r.poly); k.fill(); }, tex(role, role === "floor.wood" ? woodV : 0, rot));
  }
  if (feet.length) {
    const outlines = (k, w) => { k.lineWidth = w * pp; k.lineJoin = "miter"; for (const { f } of feet) { poly(k, f); k.stroke(); } };
    soft((k) => outlines(k, 0.8), "rgb(10,12,18)", { blur: 0.25, alpha: 0.35, box: boxAround(feet.map((x) => x.bb), 0.4) });
  }
  for (const { it, woodV } of interiors) {
    // (a stage: a raised wooden platform, its edge in shadow; the rest of the furniture lies over the map as tiles)
    for (const f of it.furniture.filter((x) => FURNITURE[x.f]?.drawn)) {
      const [aw, ah] = FURNITURE[f.f].body;
      const box = rectAt(f.x, f.y, aw, ah, f.rot);
      soft((k) => { poly(k, box.map(([x, y]) => [x + 0.08, y + 0.08])); k.fill(); }, "rgb(16,24,40)", { blur: 0.12, alpha: 0.5, box: bboxOf(box) });
      fill((k) => { poly(k, box); k.fill(); }, tex("floor.wood", woodV + 1, f.rot + 90));
      fill((k) => { k.lineWidth = 0.08 * pp; poly(k, box); k.stroke(); }, "rgba(40,28,18,0.8)");
    }
    const im = art(`wall.${it.material}`, 0);
    for (const w of it.walls.filter((x) => x.type === "wall" && !x.join)) {
      // (a wall runs to the outer wall's middle line and over any inner wall it meets already: no more past its ends)
      if (im) strip(im, w.a, w.b, 0, 0, 0, { width: it.thickness });
      else fill((k) => stroke(k, [w.a, w.b], it.thickness, "butt"), "rgb(110,96,78)");
    }
  }
  // Each building's walls from wall art (its shell: walls and windows; a door's gap is left for the scene's door), or
  // plain strokes along its footprint without art
  const shells = items("shell").filter((sh) => meets(bboxOf(sh.walls.flatMap((w) => [w.a, w.b])), 1));
  const noShell = feet.filter(({ b }) => !shells.some((sh) => sh.group === (b.group ?? b.id)));
  if (noShell.length) {
    const outlines = (k, w) => { k.lineWidth = w * pp; k.lineJoin = "miter"; for (const { f } of noShell) { poly(k, f); k.stroke(); } };
    fill((k) => outlines(k, 0.5), "rgb(70,58,46)");
    fill((k) => outlines(k, 0.34), "rgb(150,132,108)");
  }
  for (const sh of shells) {
    const im = art(`wall.${sh.material}`, sh.variant);
    const win = art("window.small", sh.variant);
    const half = sh.thickness / 2, phase = (sh.variant % 7) * 0.37;
    for (const w of sh.walls.filter((x) => x.type === "wall")) {
      if (im) strip(im, w.a, w.b, w.corner?.[0] ? sh.thickness : 0, w.corner?.[1] ? sh.thickness : 0, phase, { width: sh.thickness, clip: w.clip });
      else fill((k) => stroke(k, [w.a, w.b], sh.thickness, w.corner?.[0] || w.corner?.[1] ? "square" : "butt"), "rgb(110,96,78)");
    }
    // (windows after every wall, so each lies whole over the walls either side of its gap)
    for (const w of sh.walls) {
      if (w.type === "window") {
        const m = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
        g.save(); g.translate(X(m[0]), Y(m[1])); g.rotate(Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]));
        // (the window's art stretched across to the wall's thickness, as the wall's is)
        if (win) { const band = bandOf(win), ky = (sh.thickness * ART_PX) / band.h; g.scale(1, ky); g.drawImage(win, -pp / 2, (-band.mid / ART_PX) * pp, pp, pp); }
        else { g.fillStyle = "rgb(150,190,210)"; g.fillRect((-sh.thickness * pp) / 2, -0.04 * pp, sh.thickness * pp, 0.08 * pp); }
        g.restore();
      }
    }
  }

  // 10. Props on the ground (wells, carts, crates, a hedge's bushes), and tree shadows (each tree's own art, dark, to
  // the northwest)
  progress(0.75, "Props and trees");
  // (wild props at their art's own size: the flat ones first, under the logs, stumps and rocks)
  // (a plan's own fern, log or rock too, so it's drawn as the woods' are)
  const isWild = (p) => p.wild || WILD_CLASSES.has(p.class);
  const wild = items("prop").filter(isWild).sort((a, b) => (FLAT_PROPS.has(b.class) ? 1 : 0) - (FLAT_PROPS.has(a.class) ? 1 : 0));
  for (const p of wild) {
    if (p.class === "bush") continue;
    const im = art(`prop.${p.class}`, p.variant);
    if (!im) continue;
    const w = (im.width / ART_PX) * (p.scale ?? 1), h = (im.height / ART_PX) * (p.scale ?? 1);
    if (!meets([p.x, p.y, p.x, p.y], Math.max(w, h) / 2 + 0.5)) continue;
    g.save(); g.translate(X(p.x), Y(p.y)); g.rotate(((p.rot ?? 0) * Math.PI) / 180);
    if (!FLAT_PROPS.has(p.class)) { g.shadowColor = "rgba(16,24,40,0.5)"; g.shadowBlur = pp * 0.12; g.shadowOffsetX = SHADOW[0] * pp * (p.class === "boulder" ? 0.3 : 0.15); g.shadowOffsetY = SHADOW[1] * pp * (p.class === "boulder" ? 0.3 : 0.15); }
    g.drawImage(im, (-w / 2) * pp, (-h / 2) * pp, w * pp, h * pp);
    g.restore();
  }
  for (const p of items("prop").filter((p) => p.class !== "grave" && p.class !== "fountain" && !(isWild(p) && p.class !== "bush"))) {
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

  // 12. The edge grade (the Map Dressing Guide's rule 15): the map darkened across its outer squares, unevenly, so the
  // frame sits back and the play area is the lightest part of it
  const [MW, MH] = L.size?.squares ?? [0, 0], GRADE = 2.5;
  if (MW > 4 * GRADE && MH > 4 * GRADE) {
    const frame = (k) => { k.beginPath(); k.rect(X(-3), Y(-3), (MW + 6) * pp, (MH + 6) * pp); k.rect(X(GRADE), Y(GRADE), (MW - 2 * GRADE) * pp, (MH - 2 * GRADE) * pp); k.fill("evenodd"); };
    // (painted once over the whole tile when it reaches any edge, so the corners aren't darkened twice)
    const near = [[-3, -3, MW + 3, GRADE + 1.5], [-3, MH - GRADE - 1.5, MW + 3, MH + 3], [-3, -3, GRADE + 1.5, MH + 3], [MW - GRADE - 1.5, -3, MW + 3, MH + 3]].some((box) => meets(box, 1));
    if (near) soft(frame, "rgb(12,18,28)", { blur: 1.1, alpha: 0.24, noise: noiseMask("battle-grade", 3, -0.2, 0.9) });
  }
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
    // (a roof at its height above the ground its building stands on)
    if (ok(box)) out.push({ name: `roof-${String(++n).padStart(3, "0")}`, kind: "roof", box, ids: parts.map((b) => b.id), elevation: roofHeight(parts) + groundOf(layout, parts) });
  }
  const cells = new Map(), levelItems = layout.items.filter((i) => i.kind === "level");
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
    // (crowns above the highest ground their trees stand on)
    const up = Math.max(0, ...ts.map((t) => levelAt(levelItems, [t.x, t.y])));
    if (ok(box)) out.push({ name: `canopy-${String(++n).padStart(3, "0")}`, kind: "canopy", box, ids: ts.map((t) => t.id), elevation: OVERHEAD_ELEVATION.canopy + up });
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
