/**
 * The battle map style: a 5 ft a square layout painted from Forgotten Adventures art at its own scale (200 px of art
 * a square), with one sun casting every shadow to the northwest.
 *
 * Only the ground goes on the map image. What sits over a token (a building's roof, the trees' crowns) is painted
 * apart, one image a piece, for the scene to lay over the map as tiles: overheads(layout) lists the pieces and
 * paintOverhead(ctx, piece) paints one.
 *
 * The map is painted a tile at a time; every pattern and noise is anchored to the map, so tiles meet without seams.
 * Squares throughout.
 */
import { paintRelief } from "../relief.mjs";
import { paintRiverbed } from "../riverbed.mjs";
import { fallbackColor } from "../../core/roles.mjs";
import { PROP_SQUARES } from "../../core/plan.mjs";
import { makeNoise } from "../../core/noise.mjs";
import { hashAt } from "../../core/rng.mjs";
import { footprint, roofHeight } from "../../core/layout/battle.mjs";
import { FURNITURE } from "../../core/layout/rooms.mjs";
import { tiersOf, shelfOf, edgeSpan, shiftRight, resample, waterBand, TERRAIN } from "../../core/layout/terrain.mjs";
import { paintRoof } from "./textured.mjs";
import { groundOf, levelAt, deckOf } from "../../core/height.mjs";
import { union, offset, difference } from "../../core/lots/poly.mjs";
import { distanceToPath, pointInPolygon } from "../../core/geom.mjs";
import { offsetPath } from "../../core/layout/walls.mjs";
import { CASTLE } from "../../core/layout/castle.mjs";

/** The widest blur this style uses, in squares (tiles need this much margin). */
export const MAX_BLUR = 1;

/** A flight's drawn length in FA's stairs art, in squares (its tile is 1 by 3). */
const STAIR_DRAWN = 2.09;

/** How much a castle's masonry tops are darkened, so they read apart from the floors. */
const MASONRY_SHADE = 0.4;

/** Forgotten Adventures' art is drawn at 200 px a square. */
const ART_PX = 200;

/**
 * How one thing blends into the next: one table to tune. Each layer is laid at alpha through a soft mask (blur, in
 * squares) cut ragged by noise (scale: patch size in squares; cut: the noise level of its edge, higher for less;
 * soft: how gradually it fades). Where lift is given it is height-blended: along a soft edge the art's brighter parts
 * show first (lift: how far brightness moves the edge; gain: how sharp the edge is).
 * - ground: the map's ground patches (second, third), broad shade, and in winter rocky snow, also on a rise's top
 * - winter: drifts along the top of banks and cliffs, thin snow at their foot, a cap of snow on low walls and
 *   parapets, and frost overlays (one per cell squares, at chance)
 * - way: a trodden way in winter: disturbed snow, a trail down its middle, wheel tracks, footprints every step
 *   squares
 * - ice: along a stream: the shelves' shadow on the open water, the ice and snow over them, a ledge of ice at their
 *   edge (edgeWidth), and floes, chunks and foam drifting in the channel
 * - rise: a rise's or hollow's bank lit as a slope (dark facing away from the sun, light toward it), reach past its
 *   foot
 * - quarter: an unpaved quarter's own ground in ragged patches
 * - deadEnd: past a paved street that stops short: trodden ground tapering to a point reach squares on (or perHalf of
 *   its half width, if longer; tip wide there), bare earth (bare of its width) down the middle, ragged by noise
 * - props: a prop's drop shadow (a boulder's longer) and a soft contact shadow under it (ao, aoSize)
 */
export const BLEND = {
  ground: { second: { alpha: 0.5, scale: 10, cut: 0.25, soft: 0.2 }, third: { alpha: 0.6, scale: 7, cut: 0.45, soft: 0.15 }, rocky: { alpha: 0.8, scale: 6, cut: 0.32, soft: 0.22, lift: 0.9, gain: 1.6 }, shade: { alpha: 0.14, scale: 13, cut: 0.1, soft: 0.5 }, rise: { alpha: 0.45, scale: 3, cut: 0.05, soft: 0.4, lift: 0.9, gain: 1.6 } },
  winter: { drift: 0.9, thin: 0.75, cap: { alpha: 0.85, width: 0.24, variant: 0, scale: 0.9, cut: -0.15, soft: 0.45 }, frost: { alpha: 0.75, cell: 3.2, chance: 0.32, size: [0.5, 0.9] } },
  way: { snow: 0.9, edge: 0.18, trail: 0.85, wheel: 0.9, tracks: { alpha: 0.8, step: 1.7, size: 0.62 } },
  props: { alpha: 0.42, blur: 0.08, offset: 0.12, boulder: 0.22, ao: 0.28, aoSize: 0.7 },
  rise: { dark: 0.5, light: 0.45, reach: 0.4 },
  quarter: { alpha: 0.6, scale: 4, cut: 0.05, soft: 0.3, lift: 0.8, gain: 1.5 },
  deadEnd: { reach: 2.6, perHalf: 2.2, tip: 0.35, blur: 0.35, alpha: 0.85, bare: 0.75, rag: 0.7, cut: -0.45 },
  ice: { shadow: { width: 0.4, blur: 0.14, alpha: 0.5 }, cracked: 0.55, snow: 0.6, edge: 0.95, edgeWidth: 0.5, drift: { step: 1.3, chance: 0.5, floe: 0.85, icechunk: 0.55, foam: 0.75, foamAlpha: 0.85 } },
};

/** A grave's length in squares, laid across its row. */
const GRAVE_SQUARES = 1.4;
/**
 * What's drawn in a grave's curb, as shares of the art's width (across) and length (along), the head end negative.
 * curb: the curb's half size, kept clear of streets and buildings; mound: the earth inside it; stone: the headstone.
 */
const GRAVE = {
  curb: [0.3, 0.37],
  mound: { at: 0.07, across: 0.17, along: 0.22, round: 0.18, alpha: 0.8 },
  stone: { at: -0.235, across: 0.27, deep: 0.17, round: 0.05, shadow: 2.5, light: 0.18 },
};

/** A wild prop's least size across in squares (FA's arctic stump art is much smaller than its other stumps). */
const WILD_LEAST = { stump: 1.5 };

/**
 * The stones a surface is paved in at battle size (cobbles and herringbone read as noise at this scale). A road takes
 * the flagstones' second variant and a square the first, so the two read apart where they meet.
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
    c.width = c.height = 1;
  } catch { /* (an image the canvas can't read: the guess above) */ }
  BANDS.set(im, band);
  return band;
}

/** A bank's art by its rock (a mossy bank is grassy), in a season (snow on it in winter). */
const BANK = { earthy: "edge.bank.earthy", slate: "edge.bank.slate", mossy: "edge.bank.mossy" };
const bankRole = (rock, s) => `${BANK[rock] ?? "edge.bank.earthy"}.${s}`;
/** A prop's art in a season (a snowy rock, stump or log in winter; one with no art for the season keeps its own). */
const propRole = (cls, s) => `prop.${cls}.${s}`;
/** Whether a bank's art is laid flipped (FA's bank art has its grassy top at the top of the image: the high side). */
const BANK_FLIP = false;
/** The wild props laid flat on the ground (drawn first, no shadow); the rest stand up (shadowed). */
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
const treeTurn = (t) => (Number.isFinite(t.rot) ? t.rot : hashAt(t.x, t.y) * 360);
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

/** A paved way's stone: a main road's flagstones, so it reads apart from the streets off it. */
const wayPaving = (w) => (PAVING[w.surface] ? (w.class === "highway" ? "surface.flagstone" : PAVING[w.surface]) : null);
/** An unpaved way's or quarter's ground in winter: trodden snow for a snowy lane, slush for mud, else its own winter art. */
const WINTER_SURFACE = { snow: "surface.trodden.winter", mud: "surface.dirt.winter" };
const winterSurface = (surface) => WINTER_SURFACE[surface] ?? `surface.${surface ?? "dirt"}.winter`;
const wayRole = (w, s) => wayPaving(w) ?? (s === "winter" ? winterSurface(w.surface) : UNPAVED[w.surface] ?? "surface.dirt");
const floorRole = (b) => (STONE_FLOORS.has(b.use) || b.tower ? "floor.stone" : "floor.wood");
/** A room's floor (its kind's: a kitchen's stone, a stable's dirt). */
const ROOM_FLOOR = { wood: "floor.wood", stone: "floor.stone", dirt: "surface.dirt", earth: "surface.dirt" };
/** A quarter's own ground (look.ground: a market's paving, a crafts quarter's dirt), or null for lush grass. */
const isQuarter = (i) => i.kind === "surface" && i.class === "quarter" && !i.lush && Array.isArray(i.poly);
const quarterRole = (q, s) => PAVING[q.surface] ?? (q.surface === "trodden" ? `surface.trodden.${s}` : s === "winter" ? winterSurface(q.surface) : UNPAVED[q.surface] ?? "surface.dirt");
/**
 * The ground's art: its own, a lighter second and a third, each in broad patches. In winter a grass ground lies under
 * snow: snow, a lighter snow, and grass showing through the snow in places.
 */
export const groundRoles = (base, s) => {
  if (base === "snow" || (s === "winter" && base === "grass")) return ["ground.snow", "ground.snow.light", "ground.snow.grassy"];
  if (base === "grass" || !GROUND_SURFACE[base]) return ["ground.grass", "ground.grass.light", "ground.grass.clover"];
  // (any other ground is that surface's art all over)
  const r = s === "winter" ? `${GROUND_SURFACE[base]}.winter` : GROUND_SURFACE[base];
  return [r, r, r];
};
/** The surface art for a ground other than grass or snow (mud is dirt). */
const GROUND_SURFACE = { dirt: "surface.dirt", mud: "surface.dirt", slush: "surface.slush", trodden: "surface.trodden", cobble: "surface.cobble", gravel: "surface.gravel", flagstone: "surface.flagstone", setts: "surface.setts", herringbone: "surface.herringbone", brick: "surface.brick", tiles: "surface.tiles" };
/** A square's ground: its paving, or bare ground as a quarter's (dirt, gravel, trodden), else flagstones. */
const plazaRole = (sq, s) => (PAVING[sq.surface] || !sq.surface || sq.surface === "paved" ? PAVING[sq.surface] ?? "surface.flagstone" : quarterRole(sq, s));
const isPlaza = (i) => i.kind === "surface" && (i.class === "square" || i.class === "plaza" || i.class === "market") && Array.isArray(i.poly);

/**
 * A battle map's furniture, each piece a tile over the map so a GM can move it: [{ role, variant, piece }], rugs
 * first.
 */
export function furniture(layout) {
  const out = [];
  for (const it of layout.items.filter((i) => i.kind === "interior")) for (const p of it.furniture ?? []) if (FURNITURE[p.f] && !FURNITURE[p.f].drawn) out.push({ role: `furn.${p.f}`, variant: p.variant ?? 0, piece: it.floor ? { ...p, floor: it.floor } : p });
  // (a building's stairs: the same flight on each of its floors; a wall's only at the ground and the walk, FA's
  // flights end to end; a round tower's are painted, not art)
  for (const st of layout.items.filter((i) => i.kind === "stairs" && !i.painted)) {
    const n = Math.max(1, Math.round((st.len ?? 3) / STAIR_DRAWN)), step = (st.len ?? 3) / n, a = (st.rot * Math.PI) / 180, u = [Math.cos(a), Math.sin(a)];
    for (const f of stairFloors(st)) for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * step;
      out.push({ role: `furn.stairs.${st.material === "stone" || f < 0 ? "stone" : "wood"}`, variant: 0, piece: { f: "stairs", x: st.at[0] + u[0] * off, y: st.at[1] + u[1] * off, rot: st.rot + 90, variant: 0, floor: f, lock: true } });
    }
  }
  // (each light's own piece: candles, a lamp, a lantern, a torch, a lamp post, a fire)
  for (const l of layout.items.filter((i) => i.kind === "light" && i.prop && FURNITURE[i.prop.f])) out.push({ role: `furn.${l.prop.f}`, variant: l.prop.variant ?? 0, piece: l.prop });
  // (a rug first; what stands on a table last)
  const order = (f) => (FURNITURE[f].floor ? 0 : FURNITURE[f].on ? 2 : 1);
  return out.sort((a, b) => order(a.piece.f) - order(b.piece.f));
}

/**
 * The mist over a battle map's low places, each a fog tile under the tokens: [{ role, variant, x, y, size, rot, alpha
 * }] (x, y its middle, size across, in squares).
 */
export function mist(layout) {
  return layout.items.filter((i) => i.kind === "mist").map((m) => ({ role: "fog.light", variant: m.variant ?? 0, x: m.at[0], y: m.at[1], size: m.size, rot: m.rot ?? 0, alpha: m.alpha }));
}

/** The floors a flight of stairs joins: its own list, else every floor from its lowest to its highest. */
export function stairFloors(st) {
  if (Array.isArray(st.levels)) return st.levels;
  const out = [];
  for (let f = st.floors[0]; f <= st.floors[1]; f++) out.push(f);
  return out;
}

/** A battle map's floors other than the ground, lowest first (-1 a cellar, 1 and up above), each its own image. */
export function floorsOf(layout) {
  const fs = layout.items.filter((i) => i.kind === "interior" && i.floor).map((i) => i.floor);
  if (layout.items.some((i) => i.kind === "wall" && i.curtain)) fs.push(CASTLE.walk);
  return [...new Set(fs)].sort((a, b) => a - b);
}

export function rolesFor(layout) {
  const s = layout.season;
  const g = layout.items.find((i) => i.kind === "ground")?.base ?? "grass";
  const roles = new Set([...groundRoles(g, s), `surface.trodden.${s}`, `surface.dirt.${s}`, "stone.curb", "floor.wood", "floor.stone", "wood.fence", `stone.rough.${s}`]);
  for (const i of layout.items) {
    if (i.kind === "way" && !i.faint) roles.add(wayRole(i, s));
    if (isPlaza(i)) roles.add(plazaRole(i, s));
    if (isQuarter(i)) roles.add(quarterRole(i, s));
    if (i.kind === "surface" && i.garden) roles.add(`surface.dirt.${s}`);
    if (i.kind === "water") roles.add(i.frozen ? "water.ice" : `water.${i.class}`);
    if (i.kind === "water" && i.shelves?.length) for (const r of ["water.ice", "water.ice.cracked", "overlay.snow", "edge.ice.winter", "prop.floe", "prop.icechunk", "prop.foam"]) roles.add(r);
    if (i.kind === "crossing" && i.class !== "ford") roles.add(s === "winter" && i.class === "bridge" ? "surface.flagstone.winter" : "surface.flagstone");
    if (i.kind === "building") {
      roles.add(`roof.${i.roof}.${s}`);
      if (i.chimney) roles.add("chimney.stone");
      if (s === "winter") roles.add("overlay.snow");
      if (i.roofStyle === "flat" || i.roofStyle === "mansard") roles.add(i.flatRoof === "wood" ? `roof.flat.wood.${s}` : `roof.flat.${s}`);
    }
    if (i.kind === "tree") roles.add(treeRole(i, s));
    // (a castle's masonry is painted, from the rough stone: no wall art)
    if (i.kind === "shell" && i.material !== "masonry") { roles.add(`wall.${i.material}`); if (i.walls.some((w) => w.type === "window")) roles.add("window.small"); }
    if (i.kind === "wall" && i.curtain) roles.add("surface.flagstone");
    if (i.kind === "interior") {
      if (i.material !== "masonry") roles.add(`wall.${i.material}`);
      for (const r of i.rooms) roles.add(ROOM_FLOOR[r.floor] ?? "floor.wood");
      for (const f of i.furniture) if (!FURNITURE[f.f]?.drawn) roles.add(`furn.${f.f}`);
    }
    if (i.kind === "light" && i.prop && FURNITURE[i.prop.f]) roles.add(`furn.${i.prop.f}`);
    if (i.kind === "stairs" && !i.painted) { roles.add(`furn.stairs.${i.material === "stone" ? "stone" : "wood"}`); if (i.floors[0] < 0) roles.add("furn.stairs.stone"); }
    if (i.kind === "interior" && i.outer && i.material !== "masonry") { roles.add(`wall.${i.material}`); if (i.outer.some((w) => w.type === "window")) roles.add("window.small"); }
    if (i.kind === "mist") roles.add("fog.light");
    if (i.kind === "boundary" && i.class === "fence") roles.add("fence.wood");
    if (i.kind === "wall" && i.class === "stone") { roles.add(i.parapet ? "fence.stone.slate" : "fence.stone"); if (s === "winter") roles.add("strip.snow.cap"); }
    if (i.kind === "wall" && i.class === "palisade") roles.add("wood.stake");
    if (i.kind === "level" && i.bed) roles.add(`surface.bed.${s}`);
    if (i.kind === "edge") {
      if (i.style === "slope") roles.add(s === "winter" ? "edge.slope.winter" : "edge.grass");
      if (i.style === "cliff") { roles.add(`edge.face.${i.rock}.${s}`); roles.add(`edge.top.${i.rock}.${s}`); roles.add(`edge.foot.${i.rock}`); }
      if (i.style === "bank") roles.add(bankRole(i.rock, s));
      if (s === "winter" && i.style !== "slope") { roles.add("strip.snow.drift"); roles.add("strip.snow.thin"); }
    }
    if (i.kind === "tree" && i.wild && s !== "winter") roles.add(`ground.forest.${s}`);
    if (i.kind === "prop" && i.class === "fountain") roles.add(s === "winter" ? "water.ice" : "water.pond");
    if (i.kind === "surface" && i.class === "park" && i.basin) roles.add(s === "winter" ? "water.ice" : "water.pond");
    if (i.kind === "rock") { roles.add("stone.rough.summer"); roles.add(i.style === "cave" ? "surface.dirt.summer" : "floor.stone"); }
    if (i.kind === "reed") roles.add("prop.reeds");
    if (i.kind === "lily") roles.add("prop.lily");
    if (i.kind === "prop" && i.class !== "fountain") roles.add(i.class === "bush" ? bushRole(s) : propRole(i.class, s));
    // (a paved street's worn path past a dead end: trodden snow in winter)
    if (i.kind === "way" && !i.faint && s === "winter" && wayPaving(i)) roles.add("ground.snow.disturbed");
    if (i.kind === "way" && !i.faint && s === "winter" && !wayPaving(i)) { roles.add("ground.snow.disturbed"); roles.add("strip.snow.trail"); roles.add(i.width >= 1.6 ? "strip.track.wheel" : "prop.tracks.winter"); }
  }
  if (s === "winter") { roles.add("ground.snow.rocky"); roles.add("overlay.frost"); }
  return [...roles];
}

/**
 * Paints the window [x0, y0] .. [x0 + W/pp, y0 + H/pp] of the map's ground.
 * ctx: { g: the tile's 2d context, mask and blur: same-size scratch canvases, W, H (px), x0, y0 (squares), pp (px a square),
 *        layout, art(role, variant) -> ImageBitmap | null, progress(pct, label) }
 */
export function paint(ctx) {
  const brush = brushOf(ctx);
  if (ctx.floor) { brush.paintFloor(ctx.floor); return; }
  for (const pass of PASSES) pass(brush);
}

/**
 * What every pass of the ground's painting shares: the tile and its scratch canvases, the map's units, the art, and the
 * drawing helpers. g is the canvas drawn on now (a pass may draw a while on a layer of its own: setG).
 */
function brushOf(ctx) {
  const { mask, W, H, x0, y0, pp, layout: L, art, progress = () => {} } = ctx;
  // (the map's canvas, or for a while a layer of its own to be laid over it softened)
  let g = ctx.g;
  const q = mask.getContext("2d");
  const bq = ctx.blur?.getContext("2d") ?? null;
  const s = L.season;
  const X = (x) => (x - x0) * pp, Y = (y) => (y - y0) * pp;
  /** A number from 0 to 1 for a place on the map (and a key), the same in every tile. */
  // (a seed in words as a number)
  const seedN = Number.isFinite(Number(L.seed ?? 1)) ? Number(L.seed ?? 1) : [...String(L.seed)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 2147483647, 7);
  const hashHere = (a, b, k = 0) => hashAt(a, b, k, seedN);
  /**
   * A clip around a piece drawn turned about its middle (w by h squares), so its shadow is worked out only near it
   * (shadows are slow).
   */
  const clipNear = (w, h) => { const r = (Math.hypot(w, h) / 2 + 0.6) * pp; g.beginPath(); g.rect(-r, -r, 2 * r, 2 * r); g.clip(); };
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
   * Noise thresholded into a soft mask over this tile: opaque where it's above t, fading over softness. Sampled every
   * eighth pixel on a lattice anchored to the map, so every tile samples the same points. Returns { canvas, x, y, w,
   * h }.
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
   * Draws shapes into the mask, blurs it (blur in squares), cuts it by a noise mask, fills it and lays it on the map
   * at alpha. Only the mask is blurred, so the texture stays sharp. box: [x0, y0, x1, y1] in squares bounding the
   * shapes, so only that part of the tile is worked on (nothing when it misses the tile).
   */
  const soft = (shape, fill, { blur = 0, alpha = 1, noise: noiseIn = null, op = "source-over", box = null, lift = 0, gain = 1 } = {}) => {
    let rx = 0, ry = 0, rw = W, rh = H;
    if (box) {
      const m = blur * pp * 3 + 2;
      rx = Math.max(0, Math.floor(X(box[0]) - m)); ry = Math.max(0, Math.floor(Y(box[1]) - m));
      rw = Math.min(W, Math.ceil(X(box[2]) + m)) - rx; rh = Math.min(H, Math.ceil(Y(box[3]) + m)) - ry;
      if (rw <= 0 || rh <= 0) return;
    }
    // (a noise mask may come as a function, made only once the fill is known to reach the tile)
    const noise = typeof noiseIn === "function" ? noiseIn() : noiseIn;
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
    // (a noise mask is made for one fill: let go once it's drawn)
    if (noise) { k.globalCompositeOperation = "destination-in"; k.imageSmoothingEnabled = true; k.drawImage(noise.canvas, noise.x, noise.y, noise.w, noise.h); noise.canvas.width = noise.canvas.height = 1; }
    k.globalCompositeOperation = "source-in";
    k.fillStyle = fill;
    k.fillRect(rx, ry, rw, rh);
    k.globalCompositeOperation = "source-over";
    if (lift) heightBlend(k, rx, ry, rw, rh, lift, gain);
    g.save();
    g.globalAlpha = alpha;
    g.globalCompositeOperation = op;
    g.drawImage(out, rx, ry, rw, rh, rx, ry, rw, rh);
    g.restore();
  };
  /**
   * Height blending over a filled layer whose alpha is the soft mask: each pixel's alpha moved by the art's
   * brightness there, so along the soft edge the bright, raised parts show first. Solid and empty areas are
   * unchanged.
   */
  const heightBlend = (k, rx, ry, rw, rh, lift, gain) => {
    if (rw <= 0 || rh <= 0) return;
    let im;
    try { im = k.getImageData(rx, ry, rw, rh); } catch { return; }
    const d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a === 0 || a === 255) continue;
      const lum = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255;
      const v = (a / 255 - 0.5) * gain + (lum - 0.5) * lift + 0.5;
      d[i + 3] = v <= 0 ? 0 : v >= 1 ? 255 : v * 255;
    }
    k.putImageData(im, rx, ry);
  };
  /**
   * Snow along the top of low stone walls (FA has no snowy stone fence): a soft strip down the middle, broken by
   * noise.
   */
  const snowCap = (list) => {
    const C = BLEND.winter.cap, cap = s === "winter" && list.length ? art("strip.snow.cap", C.variant) : null;
    if (!cap) return;
    const layer = new OffscreenCanvas(W, H), g0 = g;
    g = layer.getContext("2d");
    try { for (const w of list) stripPath(cap, w.path, (w.path[0][0] * 0.37) % 1, false, { width: C.width }); } finally { g = g0; }
    const n = noiseMask("battle-cap", C.scale, C.cut, C.soft), lg = layer.getContext("2d");
    lg.globalCompositeOperation = "destination-in"; lg.imageSmoothingEnabled = true; lg.drawImage(n.canvas, n.x, n.y, n.w, n.h);
    g.save(); g.globalAlpha = C.alpha; g.drawImage(layer, 0, 0); g.restore();
    // (the layer and the mask let go at once: a map-sized canvas each)
    layer.width = layer.height = 1;
    n.canvas.width = n.canvas.height = 1;
  };
  /** A crisp fill straight onto the map. */
  const fill = (shape, style, alpha = 1) => { g.save(); g.globalAlpha = alpha; g.fillStyle = style; g.strokeStyle = style; shape(g); g.restore(); };
  /**
   * A path art strip (FA's "_Path" art: a band along the middle of a 200 px tall image) laid from a to b, its pattern
   * starting at a so tiles agree, carried ext0 and ext1 squares past each end.
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
  /**
   * A path art strip laid along a path, one piece a stretch, each cut at its ends on the line halfway between
   * stretches (a miter), so pieces meet cleanly on a bend.
   */
  const stripPath = (im, path, phase = 0, flip = false, { width = null } = {}) => {
    const n = path.length;
    if (n < 2) return;
    const half = ((width ? width * ART_PX : im.height) / ART_PX) * 1.2;
    const dir = (i) => { const a = path[i], b = path[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
    // (the cut at each point: the line through it halfway between the stretches either side, as long as the art is tall)
    const cut = (i) => {
      const d0 = dir(Math.max(0, i - 1)), d1 = dir(Math.min(n - 2, i)), m = [d0[0] + d1[0], d0[1] + d1[1]], L = Math.hypot(m[0], m[1]);
      const u = L < 1e-6 ? d1 : [m[0] / L, m[1] / L], nrm = [-u[1], u[0]], k = 1 / Math.max(0.35, u[0] * d1[0] + u[1] * d1[1]);
      return [[path[i][0] + nrm[0] * half * k, path[i][1] + nrm[1] * half * k], [path[i][0] - nrm[0] * half * k, path[i][1] - nrm[1] * half * k]];
    };
    let t = phase, c0 = cut(0);
    for (let i = 1; i < n; i++) {
      const c1 = cut(i);
      strip(im, path[i - 1], path[i], 0.6, 0.6, t, { flip, width, clip: [c0[0], c1[0], c1[1], c0[1]] });
      t += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
      c0 = c1;
    }
  };
  /** A rectangle w by d squares around cx, cy, turned rot degrees, as a polygon on the map (so a pattern stays anchored). */
  const rectAt = (cx, cy, w, d, rot) => {
    const a = (rot * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [cx + ((u * w) / 2) * c - ((v * d) / 2) * sn, cy + ((u * w) / 2) * sn + ((v * d) / 2) * c]);
  };

  const ground = L.items.find((i) => i.kind === "ground");
  const gb = ground?.base ?? "grass";
  const ways = items("way").filter((w) => !w.faint && Array.isArray(w.path) && w.path.length >= 2).map(toWall).map((w) => ({ w, bb: bboxOf(w.path) })).filter(({ w, bb }) => meets(bb, (w.width ?? 1) / 2 + 2)).map(({ w }) => w);
  const feet = items("building").map((b) => { const f = footprint(b); return { b, f, bb: bboxOf(f) }; }).filter(({ bb }) => meets(bb, 6));

  // Castle works, painted from dressed stone: a curtain wall's top (the walk between its parapet's merlons and its
  // inner edge), each tower's or gatehouse's masonry ring (doors and arrow slits cut through it) and a round tower's
  // stairs
  const curtains = items("wall").filter((w) => w.curtain && meets(bboxOf(w.path), (w.thickness ?? 2) + 1));
  const dark = "rgba(22,20,18,0.85)";
  const line = (k, pts, w) => { k.lineCap = "butt"; k.lineJoin = "miter"; k.lineWidth = w * pp; path(k, pts); k.stroke(); };
  // (a closed ring added to the path being built, so several make one shape: a ring with a hole, or many blocks)
  const sub = (k, pts) => { pts.forEach(([x, y], i) => (i ? k.lineTo(X(x), Y(y)) : k.moveTo(X(x), Y(y)))); k.closePath(); };
  function wallTops(list) {
    if (!list.length) return;
    const [ml, md, me] = CASTLE.merlon;
    for (const w of list) {
      const T = w.thickness ?? 2.4, side = w.side ?? 1;
      fill((k) => line(k, w.path, T), tex("stone.curb"));
      fill((k) => line(k, w.path, T), "rgb(20,18,16)", MASONRY_SHADE);
      fill((k) => line(k, offsetPath(w.path, (-side * md) / 2), T - md - 0.14), tex("surface.flagstone"), 0.9);
      // (the merlons along its face: blocks with gaps between)
      const blocks = [];
      for (let i = 1; i < w.face.length; i++) {
        const a = w.face[i - 1], b = w.face[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 0.2) continue;
        const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
        let n = [-u[1], u[0]];
        const bm = w.back[Math.min(i, w.back.length - 1)];
        if (n[0] * (bm[0] - a[0]) + n[1] * (bm[1] - a[1]) < 0) n = [-n[0], -n[1]];
        for (let t = 0.15; t + ml <= L - 0.05; t += me) {
          const p0 = [a[0] + u[0] * t, a[1] + u[1] * t], p1 = [a[0] + u[0] * (t + ml), a[1] + u[1] * (t + ml)];
          blocks.push([p0, p1, [p1[0] + n[0] * md, p1[1] + n[1] * md], [p0[0] + n[0] * md, p0[1] + n[1] * md]]);
        }
      }
      fill((k) => { k.beginPath(); for (const q of blocks) sub(k, q); k.fill(); }, tex("stone.curb"));
      fill((k) => { k.beginPath(); for (const q of blocks) sub(k, q); k.fill(); }, "rgb(20,18,16)", MASONRY_SHADE * 0.6);
      fill((k) => { k.lineWidth = 0.05 * pp; for (const q of blocks) { poly(k, q); k.stroke(); } }, dark, 0.7);
      fill((k) => { line(k, w.face, 0.07); line(k, w.back, 0.07); }, dark);
    }
  }
  function masonry(foot, inner, walls, T) {
    if (!foot || !inner) return;
    fill((k) => { k.beginPath(); sub(k, foot); sub(k, inner); k.fill("evenodd"); }, tex("stone.curb"));
    fill((k) => { k.beginPath(); sub(k, foot); sub(k, inner); k.fill("evenodd"); }, "rgb(20,18,16)", MASONRY_SHADE);
    for (const w of walls ?? []) {
      const n = w.inward ?? [0, 0], h = T / 2 + 0.03;
      if (w.type === "door") fill((k) => { poly(k, [[w.a[0] - n[0] * h, w.a[1] - n[1] * h], [w.b[0] - n[0] * h, w.b[1] - n[1] * h], [w.b[0] + n[0] * h, w.b[1] + n[1] * h], [w.a[0] + n[0] * h, w.a[1] + n[1] * h]]); k.fill(); }, tex("floor.stone"));
      else if (w.type === "window") {
        // (an arrow slit: a dark slot through the wall, splayed a little wider inside)
        const m = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2], L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1, t = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
        const o = [m[0] - n[0] * h, m[1] - n[1] * h], i = [m[0] + n[0] * h, m[1] + n[1] * h];
        fill((k) => { poly(k, [[o[0] - t[0] * 0.06, o[1] - t[1] * 0.06], [o[0] + t[0] * 0.06, o[1] + t[1] * 0.06], [i[0] + t[0] * 0.14, i[1] + t[1] * 0.14], [i[0] - t[0] * 0.14, i[1] - t[1] * 0.14]]); k.fill(); }, "rgb(30,28,26)");
      }
    }
    fill((k) => { k.lineWidth = 0.07 * pp; k.lineJoin = "miter"; poly(k, foot); k.stroke(); poly(k, inner); k.stroke(); }, dark);
  }
  function curlStairs(st) {
    const { c, r0, r1, a0, a1, steps } = st.curl;
    const rad = (d) => (d * Math.PI) / 180;
    fill((k) => { poly(k, st.box); k.fill(); }, tex("stone.curb"));
    // (each step a little lighter going up)
    for (let k2 = 0; k2 < steps; k2++) {
      const t0 = rad(a0 + ((a1 - a0) * k2) / steps), t1 = rad(a0 + ((a1 - a0) * (k2 + 1)) / steps);
      fill((k) => { k.beginPath(); k.arc(X(c[0]), Y(c[1]), r1 * pp, t0, t1); k.arc(X(c[0]), Y(c[1]), r0 * pp, t1, t0, true); k.closePath(); k.fill(); }, "rgb(16,14,12)", 0.04 * (steps - k2));
    }
    fill((k) => {
      k.lineWidth = 0.05 * pp;
      for (let k2 = 1; k2 < steps; k2++) { const t = rad(a0 + ((a1 - a0) * k2) / steps); k.beginPath(); k.moveTo(X(c[0] + r0 * Math.cos(t)), Y(c[1] + r0 * Math.sin(t))); k.lineTo(X(c[0] + r1 * Math.cos(t)), Y(c[1] + r1 * Math.sin(t))); k.stroke(); }
      poly(k, st.box); k.stroke();
    }, dark, 0.8);
  }
  const curls = (f) => items("stairs").filter((st) => st.curl && stairFloors(st).includes(f) && meets(bboxOf(st.box), 1));


  /**
   * A floor above or below the ground (1 and up, -1 a cellar) as a level of its own: empty but for the buildings with
   * that floor (a cellar dark rock all around), each with its floors, a shadow inside its walls and, from above, on
   * the ground below; its walls between rooms and its outer walls with windows (a cellar's stone, with none).
   */
  function paintFloor(f) {
    const its = items("interior").filter((it) => it.floor === f && meets(bboxOf(it.rooms.flatMap((r) => r.poly)), 2));
    if (f < 0) {
      g.fillStyle = "rgb(28,25,22)"; g.fillRect(0, 0, W, H);
      soft((k) => k.fillRect(0, 0, W, H), "rgb(54,48,42)", { noise: noiseMask("cellar-rock", 2.5, 0.15, 0.35), alpha: 0.55 });
    }
    // (the wall walk: the curtain's top at its own level, its shadow falling on the yard below)
    if (f === CASTLE.walk && curtains.length) {
      soft((k) => { for (const w of curtains) line(k, w.path.map(([x, y]) => [x - 0.25, y - 0.25]), (w.thickness ?? 2.4) + 0.3); }, "rgb(10,12,18)", { blur: 0.35, alpha: 0.45, box: boxAround(curtains.map((w) => bboxOf(w.path)), 3) });
      wallTops(curtains);
    }
    for (const it of its) {
      const mine = feet.filter(({ b }) => (b.group ?? b.id) === it.group);
      const b = mine[0]?.b, rot = b?.rot ?? 0, woodV = b ? Math.round(b.cx * 3 + b.cy) + 7 * f : 0;
      const box = boxAround(mine.map((x) => x.bb), 1);
      if (!mine.length) continue;
      // (from above, the floor's edge throws a shadow out onto the ground below)
      if (f > 0) soft((k) => { for (const { f: fp } of mine) { poly(k, fp); k.fill(); } }, "rgb(10,12,18)", { blur: 0.35, alpha: 0.5, box });
      const works = it.material === "masonry";
      const base = f < 0 || works ? "floor.stone" : "floor.wood";
      for (const { f: fp } of mine) fill((k) => { poly(k, fp); k.fill(); }, tex(base, base === "floor.wood" ? woodV : 0, rot));
      for (const r of it.rooms) {
        const role = ROOM_FLOOR[r.floor] ?? "floor.wood";
        if (role === base) continue;
        fill((k) => { poly(k, r.poly); k.fill(); }, tex(role, role === "floor.wood" ? woodV : 0, rot));
      }
      soft((k) => { k.lineWidth = 0.8 * pp; k.lineJoin = "miter"; for (const { f: fp } of mine) { poly(k, fp); k.stroke(); } }, "rgb(10,12,18)", { blur: 0.25, alpha: f < 0 ? 0.5 : 0.35, box });
      const im = art(`wall.${it.material}`, 0);
      for (const w of it.walls.filter((x) => x.type === "wall" && !x.join)) {
        if (im) strip(im, w.a, w.b, 0, 0, 0, { width: it.thickness });
        else fill((k) => stroke(k, [w.a, w.b], it.thickness, "butt"), "rgb(110,96,78)");
      }
      const sh = items("shell").find((x) => x.group === it.group);
      if (!sh || !it.outer) continue;
      if (works) { masonry(it.foot ?? sh.foot, it.rooms[0]?.poly ?? sh.floor, it.outer, sh.thickness); continue; }
      const om = art(`wall.${it.material}`, sh.variant), win = art("window.small", sh.variant);
      const half = sh.thickness, phase = (sh.variant % 7) * 0.37 + f * 0.5;
      for (const w of it.outer.filter((x) => x.type === "wall")) {
        if (om) strip(om, w.a, w.b, w.corner?.[0] ? half : 0, w.corner?.[1] ? half : 0, phase, { width: sh.thickness, clip: w.clip });
        else fill((k) => stroke(k, [w.a, w.b], sh.thickness, w.corner?.[0] || w.corner?.[1] ? "square" : "butt"), "rgb(110,96,78)");
      }
      for (const w of it.outer.filter((x) => x.type === "window")) {
        const m = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
        g.save(); g.translate(X(m[0]), Y(m[1])); g.rotate(Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]));
        if (win) { const band = bandOf(win), ky = (sh.thickness * ART_PX) / band.h; g.scale(1, ky); g.drawImage(win, -pp / 2, (-band.mid / ART_PX) * pp, pp, pp); }
        else { g.fillStyle = "rgb(150,190,210)"; g.fillRect((-sh.thickness * pp) / 2, -0.04 * pp, sh.thickness * pp, 0.08 * pp); }
        g.restore();
      }
    }
    for (const st of curls(f)) curlStairs(st);
    progress(1, f < 0 ? "Cellars" : "Upper floors");
  }
  return {
    ctx, H, L, W, X, Y, art, bboxOf, boxAround, clipNear, curlStairs, curls, curtains, dark, feet, fill, gb, hashHere, items, line, masonry, meets, noiseMask, paintFloor, poly, pp, progress, q, rectAt, s, snowCap, soft, strip, stripPath, stroke, sub, tex, wallTops, ways, wx1, wy1, x0, y0,
    get g() { return g; },
    setG(v) { g = v; return v; },
  };
}

/**
 * 1. The ground: its art and two more in broad soft patches (in winter, snow, lighter snow and grass showing
 * through)
 */
function groundPass(brush) {
  const { H, L, W, X, Y, art, bboxOf, boxAround, gb, items, meets, noiseMask, poly, pp, progress, s, soft, sub, tex } = brush;
  const g = brush.g;
  progress(0.02, "Ground");
  const [gBase, gLight, gThird] = groundRoles(gb, s);
  const B = BLEND.ground;
  g.fillStyle = tex(gBase); g.fillRect(0, 0, W, H);
  soft((k) => k.fillRect(0, 0, W, H), tex(gLight), { noise: noiseMask("battle-g1", B.second.scale, B.second.cut, B.second.soft), alpha: B.second.alpha });
  if (art(gThird)) soft((k) => k.fillRect(0, 0, W, H), tex(gThird), { noise: noiseMask("battle-g2", B.third.scale, B.third.cut, B.third.soft), alpha: B.third.alpha });
  // (in winter, rocky snow in ragged patches, the stones showing through first at their edges)
  if (s === "winter" && gb === "grass" && art("ground.snow.rocky")) soft((k) => k.fillRect(0, 0, W, H), tex("ground.snow.rocky"), { noise: noiseMask("battle-g3", B.rocky.scale, B.rocky.cut, B.rocky.soft), alpha: B.rocky.alpha, lift: B.rocky.lift, gain: B.rocky.gain });
  // (broad soft shade, so no wide stretch reads flat)
  soft((k) => k.fillRect(0, 0, W, H), "rgb(40,48,64)", { noise: noiseMask("battle-shade", B.shade.scale, B.shade.cut, B.shade.soft), alpha: B.shade.alpha, op: "multiply" });

  // 1b. A quarter's own ground (a market paved, a crafts quarter's dirt), worn into patches
  for (const q of L.items.filter(isQuarter)) {
    const bb = bboxOf(q.poly);
    if (!meets(bb, 1)) continue;
    // (paving laid all over; worn ground in ragged, height-blended patches with grass between)
    const Q = PAVING[q.surface] ? null : BLEND.quarter;
    soft((k) => { poly(k, q.poly); k.fill(); }, tex(quarterRole(q, s)), Q
      ? { blur: 0.5, alpha: Math.min(q.alpha ?? 0.7, Q.alpha), noise: () => noiseMask(`battle-q-${q.id}`, Q.scale, Q.cut, Q.soft), box: bb, lift: Q.lift, gain: Q.gain }
      : { blur: 0.5, alpha: q.alpha ?? 0.7, noise: () => noiseMask(`battle-q-${q.id}`, 5, -0.35, 0.35), box: bb });
  }

  // 1c. Height: the lower a level, the darker its ground; a stream's bed of stones under its water; then a forest
  // floor under the woods
  const levels = items("level").filter((Lv) => Lv.rings.some((r) => r.length >= 3 && meets(bboxOf(r), 2)));
  // (the bed's stones only on its floor: up the banks each tier's top is the ground's own grass)
  for (const Lv of levels.filter((x) => x.bed && !x.within)) {
    const w = L.items.find((i) => i.id === Lv.water && Array.isArray(i.path));
    const floor = w ? waterBand(w, shelfOf(Lv.style) + 0.1) : Lv.rings;
    const box = boxAround(floor.map(bboxOf), 0.2);
    soft((k) => { k.beginPath(); for (const r of floor) sub(k, r); k.fill("evenodd"); }, tex(`surface.bed.${s}`), { blur: 0.2, box });
  }
  // (a rise's top in winter: thin, rocky snow in patches)
  if (s === "winter" && art("ground.snow.rocky")) for (const Lv of levels.filter((x) => x.elevation > 0 && !x.bed)) {
    const box = boxAround(Lv.rings.map(bboxOf), 0.4), R = BLEND.ground.rise;
    soft((k) => { k.beginPath(); for (const r of Lv.rings) sub(k, r); k.fill("evenodd"); }, tex("ground.snow.rocky"), { blur: 0.4, alpha: R.alpha, noise: () => noiseMask(`battle-rise-${Lv.id}`, R.scale, R.cut, R.soft), box, lift: R.lift, gain: R.gain });
  }
  for (const Lv of levels.filter((x) => x.elevation < 0)) {
    const box = boxAround(Lv.rings.map(bboxOf), 0.4);
    soft((k) => { k.beginPath(); for (const r of Lv.rings) sub(k, r); k.fill("evenodd"); }, "rgb(14,20,34)", { blur: 0.35, alpha: Math.min(0.45, (-Lv.elevation / 10) * 0.3), box });
  }
  // (a wood's own trees, not a park's or a hedgerow's; none in winter)
  const woods = s === "winter" ? [] : L.items.filter((i) => i.kind === "tree" && i.wild && meets([i.x, i.y, i.x, i.y], 4));
  if (woods.length && art(`ground.forest.${s}`)) soft((k) => { for (const t of woods) { k.beginPath(); k.arc(X(t.x), Y(t.y), 3.2 * pp, 0, 2 * Math.PI); k.fill(); } }, tex(`ground.forest.${s}`), { blur: 0.9, alpha: 0.4, noise: () => noiseMask("battle-forest", 4, -0.15, 0.3), box: boxAround(woods.map((t) => [t.x, t.y, t.x, t.y]), 3.5) });
  Object.assign(brush, { levels });
}

/**
 * 1e. Hills, mountains and marshes: shaded ring by ring, rocks of rough stone, a marsh's pools and reeds
 */
function reliefPass(brush) {
  const { X, Y, items, meets, pp, s } = brush;
  if (!items("relief").length) return;
  const winter = s === "winter";
  paintRelief(brush.g, items("relief"), { X, Y, pp, near: (b) => meets(b, 1), contours: false, grain: 2, colors: { ink: "rgb(60,52,42)", light: "rgb(255,250,236)", shade: "rgb(28,26,38)", stone: winter ? "rgb(214,218,222)" : "rgb(140,134,124)", stoneInk: "rgba(40,36,30,0.7)", water: "rgb(64,96,104)", waterInk: "rgba(30,50,56,0.7)", reed: winter ? "rgb(170,158,120)" : "rgb(150,146,78)", marsh: winter ? "rgba(200,206,212,0.4)" : "rgba(70,86,52,0.4)" } });
}

/**
 * 1d. Caves and dungeons: the rock, dark and rough, with the floor carved out of it (a cave's earth and stone, a
 * dungeon's flagstones), a shadow along the foot of every rock wall and its edge inked; the floor's wear (cracks, moss,
 * puddles; rubble comes with the props), and a door's sill where a corridor meets a room. Underground, no season shows.
 */
function undergroundPass(brush) {
  const { X, Y, bboxOf, boxAround, fill, hashHere, items, meets, noiseMask, pp, progress, soft, stroke, sub, tex } = brush;
  const rocks = items("rock").filter((rk) => meets(bboxOf(rk.ring), 2));
  if (!rocks.length) return;
  progress(0.05, "Caves and dungeons");
  const rockRole = "stone.rough.summer";
  for (const rk of rocks) {
    const box = boxAround([bboxOf(rk.ring)], 1);
    const carve = (k) => { k.beginPath(); for (const r of rk.holes) sub(k, r); };
    // The rock: rough stone, darkened, in patches
    fill((k) => { k.beginPath(); sub(k, rk.ring); for (const r of rk.holes) sub(k, r); k.fill("evenodd"); }, tex(rockRole));
    soft((k) => { k.beginPath(); sub(k, rk.ring); for (const r of rk.holes) sub(k, r); k.fill("evenodd"); }, "rgb(26,22,20)", { alpha: 0.62, box });
    soft((k) => { k.beginPath(); sub(k, rk.ring); for (const r of rk.holes) sub(k, r); k.fill("evenodd"); }, "rgb(70,62,54)", { noise: () => noiseMask(`rock-${rk.id}`, 2.2, 0.1, 0.35), alpha: 0.5, box });
    // The floor
    if (rk.style === "cave") {
      fill((k) => { carve(k); k.fill("evenodd"); }, tex("surface.dirt.summer"));
      soft((k) => { carve(k); k.fill("evenodd"); }, tex(rockRole), { noise: noiseMask(`cave-${rk.id}`, 3, 0.05, 0.4), alpha: 0.55, box });
    } else fill((k) => { carve(k); k.fill("evenodd"); }, tex("floor.stone"));
    soft((k) => { carve(k); k.fill("evenodd"); }, "rgb(18,16,22)", { alpha: 0.25, box });
    // A shadow inside along the walls, then the walls' edge
    soft((k) => { k.lineWidth = 0.9 * pp; k.lineJoin = "round"; for (const r of rk.holes) { k.beginPath(); sub(k, r); k.stroke(); } }, "rgb(8,8,12)", { blur: 0.35, alpha: 0.7, box });
    fill((k) => { for (const r of rk.holes) stroke(k, [...r, r[0]], 0.08); }, "rgb(20,17,15)");
  }
  // The wear
  for (const w of items("wear").filter((w) => meets([w.x, w.y, w.x, w.y], 1))) {
    const r = 0.45 * (w.s ?? 1);
    if (w.class === "crack") {
      const a = (w.rot * Math.PI) / 180, pts = [];
      for (let t = -1; t <= 1.001; t += 0.25) pts.push([w.x + Math.cos(a) * t * r + (hashHere(w.x, w.y, t * 7) - 0.5) * 0.18, w.y + Math.sin(a) * t * r + (hashHere(w.y, w.x, t * 5) - 0.5) * 0.18]);
      fill((k) => stroke(k, pts, 0.035), "rgba(12,10,10,0.75)");
    } else if (w.class === "moss") {
      soft((k) => { k.beginPath(); k.arc(X(w.x), Y(w.y), r * pp, 0, 2 * Math.PI); k.fill(); }, "rgb(64,92,46)", { blur: 0.2, alpha: 0.55, noise: noiseMask("moss", 0.8, -0.1, 0.3), box: [w.x - 1, w.y - 1, w.x + 1, w.y + 1] });
    } else if (w.class === "puddle") {
      soft((k) => { k.beginPath(); k.ellipse(X(w.x), Y(w.y), r * pp, r * 0.7 * pp, (w.rot * Math.PI) / 180, 0, 2 * Math.PI); k.fill(); }, "rgb(30,44,58)", { blur: 0.12, alpha: 0.75, box: [w.x - 1, w.y - 1, w.x + 1, w.y + 1] });
      fill((k) => { k.beginPath(); k.ellipse(X(w.x - r * 0.25), Y(w.y - r * 0.2), r * 0.35 * pp, r * 0.15 * pp, (w.rot * Math.PI) / 180, 0, 2 * Math.PI); k.fill(); }, "rgba(170,190,205,0.25)");
    }
  }
  // A door's sill across its opening
  for (const d of items("door").filter((d) => meets([d.a[0], d.a[1], d.b[0], d.b[1]], 1))) fill((k) => stroke(k, [d.a, d.b], 0.3, "butt"), "rgb(70,60,52)");
}

/**
 * 2. Ground worn by feet around the buildings
 */
function wornPass(brush) {
  const { boxAround, feet, meets, noiseMask, poly, pp, s, soft, tex } = brush;
  const trodden = tex(`surface.trodden.${s}`);
  const near = feet.filter(({ bb }) => meets(bb, 4));
  if (near.length) soft((k) => { k.lineJoin = "round"; k.lineWidth = 2.2 * pp; for (const { f } of near) { poly(k, f); k.stroke(); k.fill(); } }, trodden, { blur: 0.9, noise: noiseMask("battle-yard", 3, -0.2, 0.3), alpha: 0.75, box: boxAround(near.map((x) => x.bb), 1.2) });
  Object.assign(brush, { trodden, near });
}

/**
 * 3. Water: a trodden bank, a stony edge, the water, deeper in the middle
 */
function waterPass(brush) {
  const { H, L, W, X, Y, art, bboxOf, boxAround, clipNear, fill, hashHere, items, levels, meets, noiseMask, poly, pp, progress, s, soft, strip, stripPath, stroke, sub, tex, trodden } = brush;
  let g = brush.g;
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
      // (its own width at each point: a battle map's stream wanders, a river widens)
      const band = (add, share = 1) => (k) => { k.beginPath(); for (const r of waterBand(w, add, share)) sub(k, r); k.fill("evenodd"); };
      if (!inBed) soft(band(1.2), trodden, { blur: 0.5, alpha: 0.7, box });
      soft(band(inBed ? 0.25 : 0.5), tex(`stone.rough.${s}`), { blur: 0.25, alpha: inBed ? 0.6 : 1, box });
      soft(band(0), tex(role), { blur: 0.06, box });
      if (!w.frozen) soft(band(0, 0.5), "rgb(8,40,52)", { blur: 1, alpha: 0.3, box });
      if (w.shelves?.length) iceAlong(w, box);
    }
  }
  /**
   * Ice along a stream's banks (the layout's shelves either side of its open channel): the shelves' shadow on the
   * open water, ice with cracks and patchy snow over the shelves, a ledge of broken ice at each edge, and floes,
   * chunks and foam drifting in the channel.
   */
  function iceAlong(w, box) {
    const I = BLEND.ice, shelves = (k) => { k.beginPath(); for (const r of w.shelves) sub(k, r); k.fill("evenodd"); };
    const ring = [...w.channel, w.channel[0]];
    soft((k) => stroke(k, ring, I.shadow.width), "rgb(6,14,22)", { blur: I.shadow.blur, alpha: I.shadow.alpha, box });
    soft(shelves, tex("water.ice"), { blur: 0.05, box });
    soft(shelves, tex("water.ice.cracked"), { blur: 0.05, alpha: I.cracked, noise: noiseMask(`ice-crack-${w.id}`, 2.2, -0.1, 0.4), box, lift: 0.6, gain: 1.3 });
    if (art("overlay.snow")) soft(shelves, tex("overlay.snow"), { blur: 0.12, alpha: I.snow, noise: noiseMask(`ice-snow-${w.id}`, 1.6, 0.05, 0.35), box });
    // (the ledge: FA's snowy ice cliff squeezed to edgeWidth, flipped so its snowy top faces the shelf)
    const edge = art("edge.ice.winter", 0);
    if (edge) { g.save(); g.globalAlpha = I.edge; let t = 0.19; for (let i = 1; i < ring.length; i++) { strip(edge, ring[i - 1], ring[i], i > 1 ? 0.05 : 0, 0, t, { width: I.edgeWidth, flip: true }); t += Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]); } g.restore(); }
    // (what drifts: at most one every step squares, at chance, inside the channel)
    const pts = resample(w.path, I.drift.step);
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      if (hashHere(p[0], p[1], 21) > I.drift.chance || !meets([p[0], p[1], p[0], p[1]], 2)) continue;
      const a = Math.atan2(pts[i + 1][1] - pts[i - 1][1], pts[i + 1][0] - pts[i - 1][0]), n = [-Math.sin(a), Math.cos(a)];
      const off = (hashHere(p[0], p[1], 22) - 0.5) * (w.width ?? 1) * 0.5, q = [p[0] + n[0] * off, p[1] + n[1] * off];
      if (!pointInPolygon(q, w.channel)) continue;
      const pick = hashHere(p[0], p[1], 23), kind = pick < 0.4 ? "foam" : pick < 0.75 ? "floe" : "icechunk";
      const im = art(`prop.${kind}`, Math.floor(hashHere(p[0], p[1], 24) * 12));
      if (!im) continue;
      const size = I.drift[kind], ww = size * (kind === "foam" ? 2 : 1), hh = (ww * im.height) / im.width;
      g.save(); g.globalAlpha = kind === "foam" ? I.drift.foamAlpha : 1; g.translate(X(q[0]), Y(q[1])); g.rotate(kind === "foam" ? a : hashHere(p[0], p[1], 25) * 2 * Math.PI); clipNear(ww, hh);
      if (kind !== "foam") { g.shadowColor = "rgba(6,14,22,0.35)"; g.shadowBlur = pp * 0.08; g.shadowOffsetX = SHADOW[0] * pp * 0.06; g.shadowOffsetY = SHADOW[1] * pp * 0.06; }
      g.drawImage(im, (-ww / 2) * pp, (-hh / 2) * pp, ww * pp, hh * pp); g.restore();
    }
  }
  // (a river's shallows: gravel bars on the inside of its bends; in winter under the ice along its banks)
  if (s !== "winter") paintRiverbed(g, L.items, { X, Y, pp, near: (b) => meets(b, 1), colors: { bar: "rgba(168,156,124,0.7)", land: "rgb(110,120,70)", bank: "rgb(146,132,106)", ink: "rgba(30,50,56,0.7)" } });
  // (a hollow a stream fills: its water over the whole hollow, its edge's banks laid over the shore, deeper in the middle)
  for (const Lv of levels.filter((x) => x.within)) {
    const w = L.items.find((i) => i.id === Lv.water);
    const role = w?.frozen ? "water.ice" : `water.${w?.class ?? "stream"}`, box = boxAround(Lv.rings.map(bboxOf), 0.5);
    const inner = offset(Lv.rings, -(edgeSpan({ drop: Lv.shore ?? 10, style: Lv.style }) - 0.1));
    soft((k) => { k.beginPath(); for (const r of inner) sub(k, r); k.fill("evenodd"); }, tex(role), { blur: 0.06, box });
    if (!w?.frozen) soft((k) => { k.beginPath(); for (const r of offset(Lv.rings, -1.6)) sub(k, r); k.fill("evenodd"); }, "rgb(8,40,52)", { blur: 1, alpha: 0.3, box });
  }

  // 3a. Reeds along a pond's shallows and lily pads on its water (none when frozen)
  for (const [kind, role] of [["lily", "prop.lily"], ["reed", "prop.reeds"]]) {
    for (const t of items(kind).filter((t) => meets([t.x, t.y, t.x, t.y], 1.5))) {
      const im = art(role, t.variant ?? 0);
      if (!im) continue;
      // (a reed's art fills under half its square: drawn half again as big)
      const k = Math.min(1.2, t.s ?? 1) * (kind === "reed" ? 1.5 : 1), w = (im.width / ART_PX) * k, h = (im.height / ART_PX) * k;
      g.save(); g.translate(X(t.x), Y(t.y)); g.rotate(((t.rot ?? 0) * Math.PI) / 180); g.drawImage(im, (-w / 2) * pp, (-h / 2) * pp, w * pp, h * pp); g.restore();
    }
  }

  // 3b. Edges where the ground drops, in tiers as FA builds them: a cliff in a tier of rock face for every five feet,
  // each drawn beneath and a little lower than the one above, with rubble at its foot, a shadow under each tier and a
  // lip on top; a bank in tiers of bank art; a slope as shade on the side turned from the sun. Each tier wanders a
  // little
  progress(0.2, "Banks and cliffs");
  const edges = items("edge").filter((e) => meets(bboxOf(e.path), edgeSpan(e) + 1));
  // (how far out a bank's foot lies: by its own drop, or a pool's whole shore where a stream falls into the pool)
  const footOf = (e) => edgeSpan(e.shore ? { drop: e.shore, style: e.style } : e);
  const wob = makeNoise(L.seed ?? 1, "battle-edge", { scale: 3, octaves: 2 });
  const tierPath = (e, d, k) => {
    const pts = resample(e.path, 0.5), calm = e.style === "bank" && tiersOf(e.shore ?? e.drop, e.style) > 2;
    return pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], Ln = Math.hypot(dx, dy) || 1;
      // (a tall bank's tiers wander less, so they don't open gaps)
      const dd = d + wob(p[0] + k * 17.3, p[1] - k * 9.1) * (calm ? 0.06 : 0.14) * Math.min(2, k);
      return [p[0] - (dy / Ln) * dd, p[1] + (dx / Ln) * dd];
    });
  };
  /**
   * A drop's face lit by the sun: each stretch shaded as its downhill side turns from the sun and lightened as it
   * turns toward it, over span squares down from its line, so which way the ground falls reads at a glance.
   */
  const lightFace = (e, span, dark, light) => {
    const pts = resample(e.path, 0.5), far = shiftRight(pts, span);
    const bb = boxAround([bboxOf(pts), bboxOf(far)], 0.5);
    soft((k) => {
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1], Ln = Math.hypot(dx, dy) || 1;
        const down = [-dy / Ln, dx / Ln], away = (down[0] * SHADOW[0] + down[1] * SHADOW[1]) / Math.hypot(...SHADOW);
        if (away <= 0.05) continue;
        k.globalAlpha = Math.min(1, away);
        poly(k, [pts[i - 1], pts[i], far[i], far[i - 1]]); k.fill();
      }
      k.globalAlpha = 1;
    }, "rgb(14,20,34)", { blur: 0.6, alpha: dark, box: bb });
    soft((k) => {
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1], Ln = Math.hypot(dx, dy) || 1;
        const down = [-dy / Ln, dx / Ln], toward = -(down[0] * SHADOW[0] + down[1] * SHADOW[1]) / Math.hypot(...SHADOW);
        if (toward <= 0.05) continue;
        k.globalAlpha = Math.min(1, toward);
        poly(k, [pts[i - 1], pts[i], far[i], far[i - 1]]); k.fill();
      }
      k.globalAlpha = 1;
    }, "rgb(255,248,210)", { blur: 0.6, alpha: light, op: "soft-light", box: bb });
  };
  // (a rise's or hollow's bank, not a stream's: its face lit and shaded as a slope's, under its art)
  for (const e of edges.filter((x) => x.style === "bank" && !x.bed)) lightFace(e, edgeSpan(e) + BLEND.rise.reach, BLEND.rise.dark, BLEND.rise.light);
  for (const e of edges.filter((x) => x.style === "slope")) {
    // (shaded as its downhill side turns from the sun, a little lighter facing it)
    lightFace(e, edgeSpan(e), Math.min(0.75, 0.42 * tiersOf(e.drop)), 0.4);
    // (the brow: longer grass a little down from the top; in winter a soft ridge of snow)
    const grass = art(s === "winter" ? "edge.slope.winter" : "edge.grass", 0);
    if (grass) { g.save(); g.globalAlpha = s === "winter" ? 0.8 : 0.55; stripPath(grass, tierPath(e, 0.35, 1)); g.restore(); }
  }
  // (where a stream's bed steps down, banks and shadows are kept off its water, which falls there as white water)
  const waterOf = new Map(items("water").filter((w) => Array.isArray(w.path)).map((w) => [w.id, w]));
  const fallWater = (e, by = 0.05) => { const w = e.fall ? waterOf.get(e.water) : null; return w ? waterBand(w, by) : null; };
  const shadeEdge = (e) => {
    // (the drop's shadow on the low ground past its foot where it faces away from the sun, longer the higher)
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
    // (a fall into a pool is drawn, off its water, as the pool's whole shore, so the shore runs unbroken)
    const n = tiersOf(e.fall && e.shore ? e.shore : e.drop, e.style), cliff = e.style === "cliff";
    const face = cliff ? art(`edge.face.${e.rock}.${s}`, 0) : art(bankRole(e.rock, s), 0);
    const face2 = cliff ? art(`edge.face.${e.rock}.${s}`, 1) ?? face : art(bankRole(e.rock, s), 1) ?? face;
    // (the rubble at the foot, under everything)
    const footArt = cliff ? art(`edge.foot.${e.rock}`, 0) : null;
    if (footArt) stripPath(footArt, tierPath(e, 0.25 + (n - 1) * TERRAIN.step + 0.4, n + 1));
    if (!cliff && !e.fall) {
      // (the bank's shadow on the water where its face is turned from the sun, longer the deeper)
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
      // (a bank's tier: its top toward the line, its face running down to the low side, the lowest one's foot just
      // into the water)
      const half = !cliff && face ? bandOf(face).h / ART_PX / 2 : TERRAIN.bankBand / 2;
      const d = cliff ? 0.25 + (k - 1) * TERRAIN.step : Math.max(half, footOf(e) - half - (n - k) * TERRAIN.bankStep + 0.04);
      // (the shadow under this tier, painted soft and darker going down; FA's shadow art overlaps in lines where
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
    const lip = cliff ? art(`edge.top.${e.rock}.${s}`, 0) : null;
    if (lip) stripPath(lip, tierPath(e, -0.05, 0), 0.21);
    // (in winter, a drift along the top and thin snow along the foot, only for a stream's bed and a cliff: on a
    // rise's bank a drift reads as a second rim)
    if (s === "winter" && !e.fall && (cliff || e.bed)) {
      const drift = art("strip.snow.drift", 0), thin = cliff ? art("strip.snow.thin", 0) : null;
      if (drift) { g.save(); g.globalAlpha = BLEND.winter.drift; stripPath(drift, tierPath(e, -0.42, 0), 0.13); g.restore(); }
      if (thin) { g.save(); g.globalAlpha = BLEND.winter.thin; stripPath(thin, tierPath(e, footOf(e) + 0.15, n + 1), 0.57); g.restore(); }
    }
  };
  // (a pool's edges, its shore and its falls, drawn as one unbroken rim, its stream's channel cut through it softly)
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
    g = brush.setG(lg);
    try { for (const e of rims) shadeEdge(e); for (const e of rims) drawEdge(e); } finally { g = brush.setG(g0); }
    if (w && Array.isArray(w.path)) {
      lg.save(); lg.globalCompositeOperation = "destination-out"; lg.filter = `blur(${0.12 * pp}px)`;
      lg.beginPath(); for (const r of waterBand(w, -0.05)) sub(lg, r); lg.fill("evenodd"); lg.restore();
    }
    g.drawImage(layer, rx, ry, rw, rh, rx, ry, rw, rh);
    layer.width = layer.height = 1;
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
  Object.assign(brush, { plain });
}

/**
 * 4. Ways: a trodden verge, an unpaved way's dirt, a paved one's curb (with its shadow and the joint) and paving,
 * narrower first so the main road runs through a junction. Ways of one look share a pass
 */
function waysPass(brush) {
  const { H, L, W, X, Y, art, bboxOf, boxAround, fill, items, meets, noiseMask, poly, progress, s, soft, stripPath, stroke, tex, trodden, ways } = brush;
  const g = brush.g;
  progress(0.25, "Streets");
  const wayBox = (list, add) => boxAround(list.map((w) => { const bb = bboxOf(w.path), r = (w.width ?? 1) / 2 + add; return [bb[0] - r, bb[1] - r, bb[2] + r, bb[3] + r]; }));
  const paved = ways.filter(wayPaving);
  // (no way is painted in a stream's bed: a bridge carries it over; a ford's crossing is left open so its track runs
  // through)
  const cutBeds = items("level").filter((Lv) => Lv.bed && meets(bboxOf(Lv.rings.flat()), 1));
  // (a paved street that stops short of anything, as one taken from a town map can, is cut square at its end and
  // carried on by a worn path that tapers out)
  const deadEnds = [];
  {
    const [mw, mh] = L.size?.squares ?? [Infinity, Infinity];
    const allWays = items("way").filter((o) => !o.faint && Array.isArray(o.path) && o.path.length >= 2);
    const plazas = L.items.filter(isPlaza), allFeet = items("building").map(footprint), spans = items("crossing").filter((c) => Array.isArray(c.at)).map(deckOf);
    for (const w of ways.filter(wayPaving)) [0, 1].forEach((k) => {
      if (w.wallEnds?.[k]) return;
      const p = k ? w.path.at(-1) : w.path[0], q = k ? w.path.at(-2) : w.path[1], hw = (w.width ?? 1) / 2;
      const Ln = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1, dir = [(p[0] - q[0]) / Ln, (p[1] - q[1]) / Ln];
      if (p[0] < 0.5 || p[1] < 0.5 || p[0] > mw - 0.5 || p[1] > mh - 0.5) return;
      // (a worn footpath meeting it doesn't make it a junction)
      if (allWays.some((o) => o !== w && o.class !== "path" && !o.approach && distanceToPath(p, o.path) < (o.width ?? 1) / 2 + hw + 0.3)) return;
      if (plazas.some((sq) => pointInPolygon(p, sq.poly) || distanceToPath(p, [...sq.poly, sq.poly[0]]) < hw + 0.5)) return;
      // (a building it runs up to; one merely beside its end doesn't count)
      if ([...allFeet, ...spans].some((f) => pointInPolygon(p, f) || pointInPolygon([p[0] + dir[0] * 0.6, p[1] + dir[1] * 0.6], f) || distanceToPath(p, [...f, f[0]]) < 0.4)) return;
      if (meets([p[0], p[1], p[0], p[1]], hw + BLEND.deadEnd.reach + 1)) deadEnds.push({ w, p, dir, hw });
    });
  }
  // (the box past a dead end that its round cap would fill, cut out of the ways below)
  const capBox = ({ p, dir, hw }) => { const n = [-dir[1], dir[0]], a = hw + 0.6, f = hw + 0.8; return [[p[0] + n[0] * a, p[1] + n[1] * a], [p[0] + n[0] * a + dir[0] * f, p[1] + n[1] * a + dir[1] * f], [p[0] - n[0] * a + dir[0] * f, p[1] - n[1] * a + dir[1] * f], [p[0] - n[0] * a, p[1] - n[1] * a]]; };
  g.save();
  if (cutBeds.length || deadEnds.length) {
    g.beginPath();
    g.rect(0, 0, W, H);
    // (one outline: the beds and dead ends' boxes together less each ford's deck, so where they overlap nothing is
    // cut twice, which even-odd would leave uncut)
    const fords = items("crossing").filter((c) => c.class === "ford" && Array.isArray(c.at)).map(deckOf);
    const cut = union([...cutBeds.flatMap((Lv) => Lv.rings), ...deadEnds.map(capBox)]);
    for (const ring of fords.length ? difference(cut, fords) : cut) { ring.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); }
    g.clip("evenodd");
  }
  // (an unpaved way narrows onto a footbridge's planks over its last squares, stroked a short piece at a time)
  const decks = items("crossing").filter((c) => c.class === "footbridge" && Array.isArray(c.at)).map((c) => {
    const a = ((c.angle ?? 0) * Math.PI) / 180;
    return { at: c.at, ux: Math.cos(a), uy: Math.sin(a), hl: (c.length ?? 2) / 2, hw: (c.width ?? 2) / 2 };
  });
  const TAPER = 3.5;
  // (a point of a way running onto decks, narrowed about its middle to the planks, or null under the deck itself)
  const nearDecks = (p, onto, w, extra) => {
    let width = w + extra;
    for (const d of onto) {
      const dx = p[0] - d.at[0], dy = p[1] - d.at[1], u = dx * d.ux + dy * d.uy, v = -dx * d.uy + dy * d.ux;
      if (Math.abs(v) > w + 1.5 || Math.abs(u) > d.hl + TAPER) continue;
      if (Math.abs(u) < d.hl - 0.25 && Math.abs(v) < d.hw + 0.3) return null;
      const t = Math.min(1, Math.max(0, (Math.abs(u) - d.hl) / TAPER)), e = t * t * (3 - 2 * t);
      const inner = (d.hw - 0.15) * 2;
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
  // (in winter an unpaved way is trodden snow, laid apart below: snow on snow needs its own marks to read)
  const snowWays = s === "winter" ? ways.filter((w) => !wayPaving(w)) : [];
  const verged = ways.filter((w) => !snowWays.includes(w));
  if (verged.length) soft((k) => { for (const w of verged) wayStroke(k, w, 0.8); }, trodden, { blur: 0.25, alpha: 0.8, box: wayBox(verged, 0.4) });
  const dirt = new Map();
  for (const w of ways.filter((w) => !wayPaving(w) && !snowWays.includes(w))) { const r = wayRole(w, s); if (!dirt.has(r)) dirt.set(r, []); dirt.get(r).push(w); }
  for (const [r, list] of dirt) soft((k) => { for (const w of list) wayStroke(k, w, 0); }, tex(r), { blur: 0.15, box: wayBox(list, 0) });
  if (snowWays.length) {
    // (disturbed snow in a ragged band, a trail down its middle, and wheel tracks on a track or wider; a path gets
    // footprints instead, laid after)
    const V = BLEND.way, box = wayBox(snowWays, 0.6);
    soft((k) => { for (const w of snowWays) wayStroke(k, w, 0.3); }, tex("ground.snow.disturbed"), { blur: 0.3, alpha: V.snow, noise: noiseMask("battle-snow-way", 1.4, -0.4, 0.55), box });
    soft((k) => { for (const w of snowWays) wayStroke(k, w, -0.2); }, "rgb(96,108,128)", { blur: 0.35, alpha: V.edge, op: "multiply", box });
    const trail = art("strip.snow.trail", 0), wheel = art("strip.track.wheel", 0);
    for (const w of snowWays) {
      const along = resample(w.path, 0.5);
      if (trail) { g.save(); g.globalAlpha = V.trail; stripPath(trail, along, 0.31); g.restore(); }
      if (wheel && w.width >= 1.6) { g.save(); g.globalAlpha = V.wheel; stripPath(wheel, along, 0.77); g.restore(); }
    }
  }
  if (paved.length) {
    soft((k) => { for (const w of paved) stroke(k, w.path, w.width + 0.55); }, "rgb(20,20,24)", { blur: 0.12, alpha: 0.35, box: wayBox(paved, 0.3) });
    fill((k) => { for (const w of paved) stroke(k, w.path, w.width + 0.5); }, tex("stone.curb"));
    fill((k) => { for (const w of paved) stroke(k, w.path, w.width + 0.08); }, "rgb(40,36,32)", 0.55);
    for (const w of [...paved].sort((a, b) => a.width - b.width)) fill((k) => stroke(k, w.path, w.width), tex(wayRole(w, s), wayRole(w, s) === "surface.flagstone" ? 1 : 0));
  }
  g.restore();
  // (each dead end's worn path, tapering from the street's width to a point)
  if (deadEnds.length) {
    const E = BLEND.deadEnd;
    const taper = ({ p, dir, hw }) => { const n = [-dir[1], dir[0]], b = hw * 0.85, t = E.tip / 2, reach = Math.max(E.reach, hw * E.perHalf), back = [p[0] - dir[0] * 0.3, p[1] - dir[1] * 0.3], tip = [p[0] + dir[0] * reach, p[1] + dir[1] * reach]; return [[back[0] + n[0] * b, back[1] + n[1] * b], [tip[0] + n[0] * t, tip[1] + n[1] * t], [tip[0] - n[0] * t, tip[1] - n[1] * t], [back[0] - n[0] * b, back[1] - n[1] * b]]; };
    const box = boxAround(deadEnds.map((d) => bboxOf(taper(d))), 0.5);
    soft((k) => { for (const d of deadEnds) { poly(k, taper(d)); k.fill(); } }, s === "winter" ? tex("ground.snow.disturbed") : trodden, { blur: E.blur, alpha: E.alpha, box });
    // (bare earth down its middle, so it reads against the grass)
    if (s !== "winter") soft((k) => { for (const d of deadEnds) { poly(k, taper({ ...d, hw: d.hw * E.bare })); k.fill(); } }, tex(`surface.dirt.${s}`), { blur: E.blur, alpha: E.alpha, noise: noiseMask("battle-dead-end", E.rag, E.cut, 0.35), box });
    // (a curb across the cut end)
    fill((k) => { for (const { p, dir, hw } of deadEnds) { const n = [-dir[1], dir[0]]; stroke(k, [[p[0] + n[0] * (hw + 0.25), p[1] + n[1] * (hw + 0.25)], [p[0] - n[0] * (hw + 0.25), p[1] - n[1] * (hw + 0.25)]], 0.25, "butt"); } }, tex("stone.curb"));
  }
}

/**
 * 5. Squares: flagstones inside a curb
 */
function squaresPass(brush) {
  const { L, bboxOf, fill, meets, poly, s, soft, stroke, tex } = brush;
  for (const sq of L.items.filter(isPlaza)) {
    const bb = bboxOf(sq.poly);
    if (!meets(bb, 1)) continue;
    const ring = [...sq.poly, sq.poly[0]];
    soft((k) => { poly(k, sq.poly); k.fill(); stroke(k, ring, 0.6); }, "rgb(20,20,24)", { blur: 0.12, alpha: 0.35, box: [bb[0] - 0.3, bb[1] - 0.3, bb[2] + 0.3, bb[3] + 0.3] });
    // (a paved square has a stone curb; a bare one only its ground)
    if (PAVING[sq.surface] || !UNPAVED[sq.surface]) fill((k) => { poly(k, sq.poly); k.fill(); stroke(k, ring, 0.5); }, tex("stone.curb"));
    fill((k) => { poly(k, sq.poly); k.fill(); }, tex(plazaRole(sq, s)));
  }
}

/**
 * 6. Gardens in tilled rows, graves, bridges (every shape a polygon on the map, so its pattern stays anchored)
 */
function gardensPass(brush) {
  const { X, Y, art, bboxOf, clipNear, fill, items, meets, noiseMask, poly, pp, progress, rectAt, s, soft, stroke, tex, trodden, ways } = brush;
  const g = brush.g;
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
  // (a grave that would lie over a street or under a building at battle size is left out)
  const graveWays = items("way").filter((o) => !o.faint && Array.isArray(o.path) && o.path.length >= 2), graveFeet = items("building").map(footprint);
  const graveClear = (gv) => {
    const a = (((gv.rot ?? 0) + 90) * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a), hx = GRAVE_SQUARES * GRAVE.curb[0], hy = GRAVE_SQUARES * 1.5 * GRAVE.curb[1];
    const pts = [[0, 0], [-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([u, v]) => [gv.x + u * c - v * sn, gv.y + u * sn + v * c]);
    return !pts.some((q) => graveWays.some((o) => distanceToPath(q, o.path) < (o.width ?? 1) / 2) || graveFeet.some((f) => pointInPolygon(q, f)));
  };
  const graves = items("prop", "grave").filter((gv) => meets([gv.x, gv.y, gv.x, gv.y], 1.5) && graveClear(gv));
  if (graves.length) {
    // (FA's grave art; a plain stone where there's none)
    const drawn = graves.filter((gv) => art(propRole("grave", s), gv.variant ?? 0));
    for (const gv of drawn) {
      const im = art(propRole("grave", s), gv.variant ?? 0), w = GRAVE_SQUARES, h = (w * im.height) / im.width;
      // (its long side across the row; its art turned with it, but its earth and stone filled with map-anchored
      // patterns: a path keeps the transform it was built in, a fill takes the one it's filled in)
      const base = g.getTransform();
      g.save(); g.translate(X(gv.x), Y(gv.y)); g.rotate((((gv.rot ?? 0) + 90) * Math.PI) / 180); clipNear(w, h);
      const fillFlat = () => { const t = g.getTransform(); g.setTransform(base); g.fill(); g.setTransform(t); };
      g.shadowColor = `rgba(16,24,40,${BLEND.props.alpha})`; g.shadowBlur = pp * BLEND.props.blur; g.shadowOffsetX = SHADOW[0] * pp * BLEND.props.offset; g.shadowOffsetY = SHADOW[1] * pp * BLEND.props.offset;
      g.drawImage(im, (-w / 2) * pp, (-h / 2) * pp, w * pp, h * pp);
      // (FA's art is only the plot's curb: a mound of earth and a headstone make it a grave)
      g.shadowColor = "transparent";
      const M = GRAVE.mound, T = GRAVE.stone, rr = (cx, cy, hw, hh, r) => { g.beginPath(); g.roundRect((cx - hw) * pp, (cy - hh) * pp, hw * 2 * pp, hh * 2 * pp, r * pp); };
      g.globalAlpha = M.alpha; g.fillStyle = tex(`surface.dirt.${s}`); rr(0, M.at * h, M.across * w, M.along * h, M.round); fillFlat();
      const lit = g.createRadialGradient(0, M.at * h * pp, 0, 0, M.at * h * pp, M.along * h * pp);
      lit.addColorStop(0, "rgba(255,240,210,0.22)"); lit.addColorStop(1, "rgba(30,20,10,0.25)");
      g.fillStyle = lit; rr(0, M.at * h, M.across * w, M.along * h, M.round); g.fill();
      g.globalAlpha = 1;
      g.shadowColor = `rgba(16,24,40,${BLEND.props.alpha})`; g.shadowBlur = pp * BLEND.props.blur; g.shadowOffsetX = SHADOW[0] * pp * BLEND.props.offset * T.shadow; g.shadowOffsetY = SHADOW[1] * pp * BLEND.props.offset * T.shadow;
      g.fillStyle = tex("stone.curb"); rr(0, T.at * h, T.across * w, T.deep / 2, T.round); fillFlat();
      g.shadowColor = "transparent"; g.fillStyle = `rgba(255,255,255,${T.light})`; g.fill();
      g.lineWidth = Math.max(1, pp * 0.02); g.strokeStyle = "rgba(20,20,24,0.85)"; g.stroke();
      g.restore();
    }
    const plain = graves.filter((gv) => !drawn.includes(gv));
    if (plain.length) {
      fill((k) => { for (const gv of plain) { poly(k, rectAt(gv.x - 0.1, gv.y - 0.1, 0.7, 0.36, gv.rot ?? 0)); k.fill(); } }, "rgba(20,24,34,0.35)");
      fill((k) => { for (const gv of plain) { poly(k, rectAt(gv.x, gv.y, 0.7, 0.36, gv.rot ?? 0)); k.fill(); } }, tex("stone.curb"));
    }
  }
  const levelItemsAll = items("level");
  for (const c of items("crossing").filter((c) => c.class !== "ford" && Array.isArray(c.at))) {
    const a = ((c.angle ?? 0) * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux, hl = (c.length ?? 2) / 2, hw = (c.width ?? 4) / 2;
    const pts = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([u, v]) => [c.at[0] + u * ux + v * nx, c.at[1] + u * uy + v * ny]);
    const bb = bboxOf(pts);
    if (!meets(bb, 2)) continue;
    // (its shadow on the water, farther and softer the deeper the bed)
    const lowBy = Math.max(0, levelAt(levelItemsAll, [c.at[0] + ux * hl, c.at[1] + uy * hl]) - levelAt(levelItemsAll, c.at));
    const off = 0.85 + (lowBy / 10) * 0.7;
    // (only over the bed it spans: where its ends rest on the bank it casts none)
    const under = levelItemsAll.filter((Lv) => Lv.bed && Lv.rings.some((r) => r.some((p) => Math.hypot(p[0] - c.at[0], p[1] - c.at[1]) < hl + 4)));
    g.save();
    if (under.length) { g.beginPath(); for (const ring of union(under.flatMap((Lv) => Lv.rings))) { ring.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); } g.clip("evenodd"); }
    soft((k) => { poly(k, pts.map(([x, y]) => [x + SHADOW[0] * off, y + SHADOW[1] * off])); k.fill(); }, "rgb(0,0,0)", { blur: 0.4 + lowBy / 40, alpha: 0.4, box: [bb[0] - 2, bb[1] - 2, bb[2], bb[3]] });
    g.restore();
    // (a road bridge in flagstones; a footbridge a deck of planks with a dark beam along each side and worn ends)
    if (c.class === "footbridge") {
      fill((k) => { poly(k, pts); k.fill(); }, tex("floor.wood", 1, (c.angle ?? 0) + 90));
      const side = (v) => [[-hl, v], [hl, v]].map(([u, w]) => [c.at[0] + u * ux + w * nx, c.at[1] + u * uy + w * ny]);
      soft((k) => { stroke(k, side(-hw + 0.06), 0.16, "butt"); stroke(k, side(hw - 0.06), 0.16, "butt"); }, "rgb(34,24,16)", { blur: 0.03, alpha: 0.75, box: bb });
      // (a sill beam across each end, with the track's dirt carried onto it)
      soft((k) => { for (const sg of [-1, 1]) stroke(k, [[-hw + 0.1, sg * (hl - 0.06)], [hw - 0.1, sg * (hl - 0.06)]].map(([v, u]) => [c.at[0] + u * ux + v * nx, c.at[1] + u * uy + v * ny]), 0.12, "butt"); }, "rgb(34,24,16)", { blur: 0.03, alpha: 0.6, box: bb });
      const onto = ways.find((w) => !wayPaving(w) && distanceToPath(c.at, w.path) < hw + 0.5);
      const worn = onto ? tex(wayRole(onto, s)) : trodden;
      soft((k) => { for (const sg of [-1, 1]) { const e = [c.at[0] + sg * ux * hl, c.at[1] + sg * uy * hl]; stroke(k, [[e[0] - sg * ux * 1.1, e[1] - sg * uy * 1.1], [e[0] + sg * ux * 0.05, e[1] + sg * uy * 0.05]], (hw - 0.2) * 2, "butt"); } }, worn, { blur: 0.35, alpha: 0.6, noise: noiseMask("battle-deck", 1.2, -0.3, 0.6), box: [bb[0] - 1, bb[1] - 1, bb[2] + 1, bb[3] + 1] });
    } else {
      // (no curb of its own: its parapets stand outside the deck, and its ends meet the road; snowy in winter)
      fill((k) => { poly(k, pts); k.fill(); }, s === "winter" ? tex("surface.flagstone.winter", 0, c.angle ?? 0) : tex("surface.flagstone", 1, c.angle ?? 0));
    }
  }
}

/**
 * 7. Yards: trodden ground inside each house's fenced yard and each work yard (a grass yard isn't worn); fences and
 * walls with their shadows
 */
function yardsPass(brush) {
  const { X, Y, art, bboxOf, boxAround, curtains, fill, items, meets, noiseMask, poly, pp, s, snowCap, soft, stripPath, stroke, tex, trodden, wallTops } = brush;
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
    // (a yard's low wall from fence art where there is some, a town wall a stone fill, a bridge's parapet a band of
    // stone)
    const parapets = stone.filter((w) => w.parapet);
    if (parapets.length) {
      // (FA's slate stone fence where there is some, else a band of dressed stone; a wing wall's ends rounded so its
      // corner with the parapet is closed)
      const slate = art("fence.stone.slate", 0);
      if (slate) {
        soft((k) => { for (const w of parapets) stroke(k, w.path.map(([x, y]) => [x + SHADOW[0] * 0.12, y + SHADOW[1] * 0.12]), 0.46, w.wing ? "round" : "butt"); }, "rgb(10,12,18)", { blur: 0.08, alpha: 0.45, box: boxAround(parapets.map((w) => bboxOf(w.path)), 0.6) });
        for (const w of parapets) stripPath(slate, w.path, w.wing ? 0.4 : 0, false, { width: 0.5 });
        snowCap(parapets);
      } else {
        fill((k) => { for (const w of parapets) stroke(k, w.path, 0.48, w.wing ? "round" : "butt"); }, "rgb(34,32,30)", 0.8);
        fill((k) => { for (const w of parapets) stroke(k, w.path, 0.4, w.wing ? "round" : "butt"); }, tex("stone.curb"));
      }
    }
    const lowArt = art("fence.stone");
    const low = lowArt ? stone.filter((w) => !w.parapet && !(w.thickness > 0.6)) : [];
    for (const w of low) stripPath(lowArt, w.path);
    snowCap(low);
    const high = stone.filter((w) => !w.parapet && !low.includes(w) && !w.curtain);
    if (high.length) fill((k) => { for (const w of high) stroke(k, w.path, thick(w), "butt"); }, tex(`stone.rough.${s}`));
    if (wood.length) fill((k) => { for (const w of wood) stroke(k, w.path, thick(w), "butt"); }, tex("wood.stake"));
    wallTops(curtains);
  }
}

/**
 * 8. Fountains: a stone basin of water
 */
function fountainsPass(brush) {
  const { X, Y, bboxOf, fill, items, meets, poly, pp, s, soft, tex } = brush;
  // A park's basin (a stone rim around its water), its canal (a long one), or a green's pond (soft-edged, no rim)
  for (const pk of items("surface", "park").filter((x) => x.basin)) {
    const b = pk.basin, water = tex(s === "winter" ? "water.ice" : "water.pond");
    if (b.poly) {
      if (!meets(bboxOf(b.poly), 1)) continue;
      fill((k) => { poly(k, b.poly); k.lineWidth = 0.6 * pp; k.lineJoin = "miter"; k.stroke(); }, tex("stone.curb"));
      fill((k) => { poly(k, b.poly); k.fill(); }, water);
      continue;
    }
    if (!meets([b.at[0], b.at[1], b.at[0], b.at[1]], b.radius + 1)) continue;
    const disc = (r) => (k) => { k.beginPath(); k.arc(X(b.at[0]), Y(b.at[1]), r * pp, 0, 2 * Math.PI); k.fill(); };
    if (b.rim === false) {
      soft(disc(b.radius + 0.3), tex(`surface.dirt.${s}`), { blur: 0.3, alpha: 0.7, box: [b.at[0] - b.radius - 1, b.at[1] - b.radius - 1, b.at[0] + b.radius + 1, b.at[1] + b.radius + 1] });
      soft(disc(b.radius), water, { blur: 0.12, box: [b.at[0] - b.radius - 1, b.at[1] - b.radius - 1, b.at[0] + b.radius + 1, b.at[1] + b.radius + 1] });
    } else {
      fill(disc(b.radius + 0.3), tex("stone.curb"));
      fill(disc(b.radius), water);
    }
  }
  for (const f of items("prop", "fountain")) {
    const r = Math.max(1.2, (0.45 * (f.scale ?? 1)) / 2);
    if (!meets([f.x, f.y, f.x, f.y], r + 0.5)) continue;
    fill((k) => { k.beginPath(); k.arc(X(f.x), Y(f.y), r * pp, 0, 2 * Math.PI); k.fill(); }, tex("stone.curb"));
    fill((k) => { k.beginPath(); k.arc(X(f.x), Y(f.y), (r - 0.35) * pp, 0, 2 * Math.PI); k.fill(); }, tex(s === "winter" ? "water.ice" : "water.pond"));
    fill((k) => { k.beginPath(); k.arc(X(f.x), Y(f.y), 0.4 * pp, 0, 2 * Math.PI); k.fill(); }, tex("stone.curb"));
  }
}

/**
 * 9. Buildings: their shadows, floors, a contact shadow along their walls, and the walls (from art, or plain)
 */
function buildingsPass(brush) {
  const { X, Y, art, bboxOf, boxAround, curlStairs, curls, feet, fill, items, line, masonry, meets, poly, pp, progress, rectAt, soft, strip, stroke, tex } = brush;
  const g = brush.g;
  progress(0.55, "Buildings");
  if (feet.length) soft((k) => {
    for (const { b, f } of feet) {
      const d = ((20 + (b.tall ?? 0) * 20 + (b.floorsAbove ?? 0) * 10) / 5) * 0.3;
      for (let t = 0; t <= 1.0001; t += 0.1) { poly(k, f.map(([x, y]) => [x + SHADOW[0] * d * t, y + SHADOW[1] * d * t])); k.fill(); }
    }
  }, "rgb(16,24,40)", { blur: 0.3, alpha: 0.24, box: boxAround(feet.map(({ b, bb }) => { const d = ((20 + (b.tall ?? 0) * 20 + (b.floorsAbove ?? 0) * 10) / 5) * 0.3 * 0.7; return [bb[0] - d, bb[1] - d, bb[2], bb[3]]; })) });
  for (const { b, f } of feet) fill((k) => { poly(k, f); k.fill(); }, tex(floorRole(b), floorRole(b) === "floor.wood" ? Math.round(b.cx * 3 + b.cy) : 0, b.rot ?? 0));
  // Interiors: each room's floor where it differs from the building's, a stage, and the walls between rooms (the
  // building's wall art, thinner, with gaps for doors). Furniture isn't painted: it lies over the map as tiles
  const interiors = items("interior").filter((it) => !it.floor && meets(bboxOf(it.rooms.flatMap((r) => r.poly)), 1)).map((it) => {
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
    // (a stage: a raised wooden platform, its edge in shadow)
    for (const f of it.furniture.filter((x) => FURNITURE[x.f]?.drawn)) {
      const [aw, ah] = FURNITURE[f.f].body;
      const box = rectAt(f.x, f.y, aw, ah, f.rot);
      soft((k) => { poly(k, box.map(([x, y]) => [x + 0.08, y + 0.08])); k.fill(); }, "rgb(16,24,40)", { blur: 0.12, alpha: 0.5, box: bboxOf(box) });
      fill((k) => { poly(k, box); k.fill(); }, tex("floor.wood", woodV + 1, f.rot + 90));
      fill((k) => { k.lineWidth = 0.08 * pp; poly(k, box); k.stroke(); }, "rgba(40,28,18,0.8)");
    }
    const im = art(`wall.${it.material}`, 0);
    for (const w of it.walls.filter((x) => x.type === "wall" && !x.join)) {
      // (a wall runs to the outer wall's middle line and over any inner wall it meets)
      if (it.material === "masonry") { fill((k) => line(k, [w.a, w.b], it.thickness), tex("stone.curb")); fill((k) => line(k, [w.a, w.b], it.thickness), "rgb(20,18,16)", 0.45); }
      else if (im) strip(im, w.a, w.b, 0, 0, 0, { width: it.thickness });
      else fill((k) => stroke(k, [w.a, w.b], it.thickness, "butt"), "rgb(110,96,78)");
    }
    // (a gatehouse's portcullis: an iron grille across its passage, a bar every half square)
    if (Array.isArray(it.portcullis)) {
      const [a, b] = it.portcullis, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
      fill((k) => {
        line(k, [a, b], 0.1);
        for (let t = 0; t <= L + 1e-6; t += 0.5) { const p = [a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L]; line(k, [[p[0] - n[0] * 0.14, p[1] - n[1] * 0.14], [p[0] + n[0] * 0.14, p[1] + n[1] * 0.14]], 0.07); }
      }, "rgb(34,34,36)");
    }
  }
  for (const st of curls(0)) curlStairs(st);
  // Each building's walls and windows from wall art (a door's gap is left for the scene's door), else plain strokes
  const shells = items("shell").filter((sh) => meets(bboxOf(sh.walls.flatMap((w) => [w.a, w.b])), 1));
  const noShell = feet.filter(({ b }) => !shells.some((sh) => sh.group === (b.group ?? b.id)));
  if (noShell.length) {
    const outlines = (k, w) => { k.lineWidth = w * pp; k.lineJoin = "miter"; for (const { f } of noShell) { poly(k, f); k.stroke(); } };
    fill((k) => outlines(k, 0.5), "rgb(70,58,46)");
    fill((k) => outlines(k, 0.34), "rgb(150,132,108)");
  }
  for (const sh of shells.filter((x) => x.material === "masonry")) masonry(sh.foot, sh.floor, sh.walls, sh.thickness);
  for (const sh of shells.filter((x) => x.material !== "masonry")) {
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
}

/**
 * 10. Props on the ground and tree shadows (each tree's own art, dark, to the northwest)
 */
function propsPass(brush) {
  const { X, Y, art, boxAround, clipNear, feet, hashHere, items, levels, meets, pp, progress, s, soft, ways, wx1, wy1, x0, y0 } = brush;
  const g = brush.g;
  progress(0.75, "Props and trees");
  // (wild props, a plan's own fern, log or rock too, at their art's own size)
  const isWild = (p) => p.wild || WILD_CLASSES.has(p.class);
  const P = BLEND.props;
  const hash = hashHere;
  const inBed = (p) => levels.some((Lv) => Lv.bed && Lv.rings.some((r) => r.length >= 3 && pointInPolygon(p, r)));
  // (each prop's size across in squares: the plan's own; else its art's at the layout's scale, never under its least)
  const wildSize = (p, im) => {
    if (Number.isFinite(p.size)) return [p.size, (p.size * im.height) / im.width];
    const k = Math.max(1, (WILD_LEAST[p.class] ?? 0) / (im.width / ART_PX)) * (p.scale ?? 1);
    return [(im.width / ART_PX) * k, (im.height / ART_PX) * k];
  };
  const placed = [];
  // (a windmill's sails go on its roof's tile: paintOverhead)
  for (const p of items("prop").filter((p) => p.class !== "grave" && p.class !== "fountain" && p.class !== "sails")) {
    const bush = p.class === "bush", wildOne = isWild(p) && !bush;
    const im = art(bush ? bushRole(s) : propRole(p.class, s), p.variant);
    if (!im) continue;
    // (a prop sized by the layout or the plan; else at its art's true size)
    let w, h;
    if (wildOne) [w, h] = wildSize(p, im);
    else { w = Number.isFinite(p.size) ? p.size : bush ? p.scale ?? 0.5 : p.scale != null ? (PROP_SQUARES[p.class] ?? 0.45) * p.scale : im.width / ART_PX; h = (w * im.height) / im.width; }
    if (!meets([p.x, p.y, p.x, p.y], Math.max(w, h) / 2 + 0.5)) continue;
    placed.push({ p, im, w, h, wildOne, flat: FLAT_PROPS.has(p.class) });
  }
  // (a soft contact shadow under everything standing on the ground, in one pass)
  const standing = placed.filter((x) => !x.flat && x.p.class !== "tracks" && x.p.class !== "ribbon");
  if (standing.length) soft((k) => { for (const { p, w, h } of standing) { k.beginPath(); k.ellipse(X(p.x), Y(p.y), (w * P.aoSize * pp) / 2, (h * P.aoSize * pp) / 2, ((p.rot ?? 0) * Math.PI) / 180, 0, 2 * Math.PI); k.fill(); } }, "rgb(14,20,32)", { blur: 0.12, alpha: P.ao, box: boxAround(standing.map(({ p, w, h }) => [p.x - w / 2, p.y - h / 2, p.x + w / 2, p.y + h / 2]), 0.3) });
  // (the flat ones first, under the logs, stumps and rocks; then the wild ones; then the rest)
  const order = (x) => (x.flat ? 0 : x.wildOne ? 1 : 2);
  for (const { p, im, w, h, flat } of placed.sort((a, b) => order(a) - order(b))) {
    g.save(); g.translate(X(p.x), Y(p.y)); g.rotate(((p.rot ?? 0) * Math.PI) / 180);
    if (!flat && p.class !== "tracks") { clipNear(w, h); const o = (p.class === "boulder" ? P.boulder : P.offset) * pp; g.shadowColor = `rgba(16,24,40,${P.alpha})`; g.shadowBlur = pp * P.blur; g.shadowOffsetX = SHADOW[0] * o; g.shadowOffsetY = SHADOW[1] * o; }
    g.drawImage(im, (-w / 2) * pp, (-h / 2) * pp, w * pp, h * pp);
    g.restore();
  }
  if (s === "winter") {
    // Footprints along a narrow trodden way in the snow, a pair every few squares, turned along it
    const T = BLEND.way.tracks;
    for (const w of ways.filter((w) => !wayPaving(w) && w.width < 1.6)) {
      const pts = resample(w.path, T.step);
      for (let i = 1; i < pts.length - 1; i++) {
        const q = pts[i];
        if (!meets([q[0], q[1], q[0], q[1]], 1) || inBed(q)) continue;
        const im = art("prop.tracks.winter", Math.floor(hash(q[0], q[1], 3) * 8));
        if (!im) break;
        const a = Math.atan2(pts[i + 1][1] - pts[i - 1][1], pts[i + 1][0] - pts[i - 1][0]) + Math.PI / 2, side = (hash(q[0], q[1], 4) - 0.5) * w.width * 0.4;
        g.save(); g.globalAlpha = T.alpha; g.translate(X(q[0] + Math.cos(a) * side), Y(q[1] + Math.sin(a) * side)); g.rotate(a); g.drawImage(im, (-T.size / 2) * pp, (-T.size / 2) * pp, T.size * pp, T.size * pp); g.restore();
      }
    }
    // Frost on the open ground: an overlay now and then on a grid anchored to the map, off ways, water and buildings
    const F = BLEND.winter.frost;
    const fx0 = Math.floor((x0 - 1) / F.cell), fy0 = Math.floor((y0 - 1) / F.cell), fx1 = Math.ceil((wx1 + 1) / F.cell), fy1 = Math.ceil((wy1 + 1) / F.cell);
    for (let cy = fy0; cy <= fy1; cy++) for (let cx = fx0; cx <= fx1; cx++) {
      if (hash(cx, cy, 11) > F.chance) continue;
      const q = [(cx + hash(cx, cy, 12)) * F.cell, (cy + hash(cx, cy, 13)) * F.cell], size = F.size[0] + (F.size[1] - F.size[0]) * hash(cx, cy, 14);
      if (!meets([q[0], q[1], q[0], q[1]], size)) continue;
      if (inBed(q) || ways.some((w) => distanceToPath(q, w.path) < (w.width ?? 1) / 2 + 0.4) || feet.some(({ f }) => pointInPolygon(q, f))) continue;
      const im = art("overlay.frost", Math.floor(hash(cx, cy, 15) * 12));
      if (!im) break;
      g.save(); g.globalAlpha = F.alpha; g.translate(X(q[0]), Y(q[1])); g.rotate(hash(cx, cy, 16) * 2 * Math.PI); g.drawImage(im, (-size / 2) * pp, (-size / 2) * pp, size * pp, size * pp); g.restore();
    }
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
}

/**
 * 12. The edge grade: the map darkened unevenly across its outer squares, so the play area is the lightest part
 */
function gradePass(brush) {
  const { L, X, Y, meets, noiseMask, pp, progress, soft } = brush;
  const [MW, MH] = L.size?.squares ?? [0, 0], GRADE = 2.5;
  if (MW > 4 * GRADE && MH > 4 * GRADE) {
    const frame = (k) => { k.beginPath(); k.rect(X(-3), Y(-3), (MW + 6) * pp, (MH + 6) * pp); k.rect(X(GRADE), Y(GRADE), (MW - 2 * GRADE) * pp, (MH - 2 * GRADE) * pp); k.fill("evenodd"); };
    // (painted once over the whole tile when it reaches any edge, so corners aren't darkened twice)
    const near = [[-3, -3, MW + 3, GRADE + 1.5], [-3, MH - GRADE - 1.5, MW + 3, MH + 3], [-3, -3, GRADE + 1.5, MH + 3], [MW - GRADE - 1.5, -3, MW + 3, MH + 3]].some((box) => meets(box, 1));
    if (near) soft(frame, "rgb(12,18,28)", { blur: 1.1, alpha: 0.24, noise: noiseMask("battle-grade", 3, -0.2, 0.9) });
  }
  progress(1, "Ground");
}

/** The passes, in the order they're painted. */
/**
 * 4b. Fields, farmyards and docks at battle size: a field's soil with its crop in rows (plowed furrows, green shoots,
 * ripe grain, stubble, hay in windrows; pasture and fallow a rougher green), a farmyard's trodden earth, a dock's
 * deck of stone or planks along its line.
 */
function farmsAndDocksPass(brush) {
  const { X, Y, bboxOf, fill, items, meets, poly, pp, s, stroke, tex } = brush;
  const g = brush.g;
  const winter = s === "winter";
  const CROP = { growing: "rgba(86,134,52,0.9)", ripe: "rgba(206,176,92,0.92)", stubble: "rgba(184,160,104,0.85)", hay: "rgba(170,160,88,0.9)", plowed: "rgba(92,70,48,0.75)" };
  for (const fd of items("field").filter((f) => Array.isArray(f.poly) && f.poly.length >= 3 && meets(bboxOf(f.poly), 1))) {
    const green = fd.crop === "pasture" || fd.crop === "fallow";
    fill((k) => { poly(k, fd.poly); k.fill(); }, green ? (winter ? "rgba(226,230,234,0.55)" : "rgba(104,132,64,0.55)") : tex(`surface.dirt.${s}`));
    if (!fd.rows || winter && fd.crop !== "plowed") continue;
    // (rows across the whole field, clipped to it, along its angle)
    const a = ((fd.angle ?? 0) * Math.PI) / 180, u = [Math.cos(a), Math.sin(a)], n = [-u[1], u[0]];
    const [x0, y0, x1, y1] = bboxOf(fd.poly), c = [(x0 + x1) / 2, (y0 + y1) / 2], R = Math.hypot(x1 - x0, y1 - y0) / 2 + 1;
    const step = Math.max(0.35, fd.rows * 2.2), width = fd.crop === "hay" ? step * 0.35 : step * 0.45;
    g.save(); g.beginPath(); fd.poly.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); g.clip();
    g.strokeStyle = CROP[fd.crop] ?? CROP.plowed; g.lineWidth = Math.max(1, width * pp); g.lineCap = "round";
    g.beginPath();
    for (let t = -R; t <= R; t += step) { const p = [c[0] + n[0] * t, c[1] + n[1] * t]; g.moveTo(X(p[0] - u[0] * R), Y(p[1] - u[1] * R)); g.lineTo(X(p[0] + u[0] * R), Y(p[1] + u[1] * R)); }
    g.stroke(); g.restore();
  }
  for (const y of items("surface", "farmyard").filter((i) => Array.isArray(i.poly) && i.poly.length >= 3 && meets(bboxOf(i.poly), 1)))
    fill((k) => { poly(k, y.poly); k.fill(); }, tex(`surface.dirt.${s}`));
  for (const d of items("dock").filter((i) => Array.isArray(i.path) && i.path.length >= 2 && meets(bboxOf(i.path), (i.width ?? 1) + 1))) {
    const wood = d.material === "wood", w = d.width ?? 1;
    fill((k) => stroke(k, d.path, w + 0.12, "butt"), "rgba(40,34,28,0.9)");
    fill((k) => stroke(k, d.path, w, "butt"), wood ? "rgb(128,96,62)" : winter ? "rgb(206,208,210)" : "rgb(150,144,134)");
    // (a wooden deck's planks across it, a stone one's joints)
    g.save(); g.strokeStyle = wood ? "rgba(70,50,30,0.6)" : "rgba(90,86,80,0.5)"; g.lineWidth = Math.max(1, pp * 0.03);
    for (let i = 1; i < d.path.length; i++) {
      const a = d.path[i - 1], b = d.path[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.01) continue;
      const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [-u[1] * (w / 2), u[0] * (w / 2)], gap = wood ? 0.25 : 1;
      g.beginPath();
      for (let t = gap; t < L; t += gap) { const p = [a[0] + u[0] * t, a[1] + u[1] * t]; g.moveTo(X(p[0] - n[0]), Y(p[1] - n[1])); g.lineTo(X(p[0] + n[0]), Y(p[1] + n[1])); }
      g.stroke();
    }
    g.restore();
  }
}

const PASSES = [groundPass, undergroundPass, reliefPass, wornPass, waterPass, farmsAndDocksPass, waysPass, squaresPass, gardensPass, yardsPass, fountainsPass, buildingsPass, propsPass, gradePass];


/**
 * The pieces painted apart to lie over the map as tiles: { name, kind: "roof" | "canopy", box: [x0, y0, x1, y1] in
 * squares, ids, elevation in feet }. A house and its wings are one roof (they fade together); trees are gathered by
 * where they stand. Boxes are cut to the map.
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
    // (a windmill's roof tile reaches as far as its sails turn)
    for (const sl of millSails(layout, parts)) { const r = sailsSpan(sl) / 2; pts.push([sl.x - r, sl.y - r], [sl.x + r, sl.y + r]); }
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

/** A castle tower's or gatehouse's open top, onto its roof's own image: flagstones inside a parapet, merlons along its edge. */
function battlements(g, b, X, Y, pp, art, [x0, y0]) {
  const pat = (role) => {
    const im = art(role, 0);
    if (!im) return fallbackColor(role);
    const p = g.createPattern(im, "repeat");
    p.setTransform(new DOMMatrix().translate(-x0 * pp, -y0 * pp).scale(pp / ART_PX));
    return p;
  };
  const sub = (pts) => { pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); };
  const foot = footprint(b), [ml, md, me] = CASTLE.merlon, wall = 0.5;
  const inner = offset([foot], -wall).reduce((a, q) => (!a || Math.abs(q.length) > Math.abs(a.length) ? q : a), null);
  g.save();
  g.fillStyle = pat("surface.flagstone"); g.beginPath(); sub(foot); g.fill();
  if (inner) {
    g.fillStyle = pat("stone.curb"); g.beginPath(); sub(foot); sub(inner); g.fill("evenodd");
    g.globalAlpha = MASONRY_SHADE; g.fillStyle = "rgb(20,18,16)"; g.beginPath(); sub(foot); sub(inner); g.fill("evenodd"); g.globalAlpha = 1;
  }
  // (merlons: blocks around the edge with gaps between, standing on the parapet)
  const cx = foot.reduce((a, p) => a + p[0] / foot.length, 0), cy = foot.reduce((a, p) => a + p[1] / foot.length, 0);
  const blocks = [];
  let carry = 0.15;
  foot.forEach((a, i) => {
    const c = foot[(i + 1) % foot.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (L < 1e-6) return;
    const u = [(c[0] - a[0]) / L, (c[1] - a[1]) / L];
    let n = [-u[1], u[0]];
    if (n[0] * (cx - a[0]) + n[1] * (cy - a[1]) < 0) n = [-n[0], -n[1]];
    let t = carry;
    for (; t + ml <= L; t += me) {
      const p0 = [a[0] + u[0] * t, a[1] + u[1] * t], p1 = [a[0] + u[0] * (t + ml), a[1] + u[1] * (t + ml)];
      blocks.push([p0, p1, [p1[0] + n[0] * md, p1[1] + n[1] * md], [p0[0] + n[0] * md, p0[1] + n[1] * md]]);
    }
    carry = Math.max(0, t - L);
  });
  g.fillStyle = pat("stone.curb"); g.beginPath(); for (const q of blocks) sub(q); g.fill();
  g.strokeStyle = "rgba(22,20,18,0.8)"; g.lineWidth = 0.05 * pp; g.beginPath(); for (const q of blocks) sub(q); g.stroke();
  g.lineWidth = 0.07 * pp; g.beginPath(); sub(foot); g.stroke();
  if (inner) { g.beginPath(); sub(inner); g.stroke(); }
  g.restore();
}

/** A building group's windmill sails (props `<building id>/sails`), and how far across they turn, in squares. */
const millSails = (layout, parts) => { const ids = new Set(parts.map((b) => `${b.id}/sails`)); return layout.items.filter((i) => i.kind === "prop" && i.class === "sails" && ids.has(i.id)); };
const sailsSpan = (sl) => (PROP_SQUARES.sails ?? 2.4) * (sl.scale ?? 1);

/**
 * Paints one overhead piece onto its own canvas, covering the piece's box at pp px a square. ctx: { g, W, H, pp,
 * layout, art(role, variant) }. A roof is clipped to its building's walls, so it covers them exactly.
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
    // (each roof's art at true scale, chimneys a little over half a square; a castle's open top as battlements)
    for (const b of parts) {
      if (b.castle && b.roofStyle === "flat") { battlements(g, b, X, Y, pp, art, [x0, y0]); continue; }
      const im = art(`roof.${b.roof}.${s}`, b.variant);
      paintRoof(g, b, { x: X(b.cx), y: Y(b.cy), pp, art, season: s, texPx: ((im?.width ?? ART_PX) * pp) / ART_PX, chimney: 0.6 });
    }
    g.restore();
    // (a windmill's sails over its cap, with a shadow below)
    for (const sl of millSails(L, parts)) {
      const im = art(propRole("sails", s), sl.variant ?? 0);
      if (!im) continue;
      const w = sailsSpan(sl), h = (w * im.height) / im.width;
      g.save(); g.translate(X(sl.x), Y(sl.y)); g.rotate(((sl.rot ?? 0) * Math.PI) / 180);
      g.shadowColor = `rgba(16,24,40,${BLEND.props.alpha})`; g.shadowBlur = pp * BLEND.props.blur; g.shadowOffsetX = SHADOW[0] * pp * BLEND.props.offset * 3; g.shadowOffsetY = SHADOW[1] * pp * BLEND.props.offset * 3;
      g.drawImage(im, (-w / 2) * pp, (-h / 2) * pp, w * pp, h * pp);
      g.restore();
    }
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
