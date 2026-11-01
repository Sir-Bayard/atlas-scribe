/**
 * The "textured" style: map art laid down layer by layer, as the overview prototype did. One sun for every shadow,
 * soft edges by blurring a mask and filling it with the texture (never blurring the texture), multiply tints for
 * wear and slush. Paints one window of the map (a tile) at a time; every pattern is anchored to the map, so tiles
 * meet without seams. Numbers are in squares.
 *
 * rolesFor(layout) lists the art roles a Layout needs; paint(ctx) paints one window.
 */
import { fallbackColor } from "../../core/roles.mjs";
import { rng } from "../../core/rng.mjs";
import { roofFacets } from "../roofs.mjs";
export { roofFacets };

/** Roof materials whose winter art already has snow on it; every other roof gets the snow overlay in winter. */
const SNOWY_IN_WINTER = new Set(["slate", "wood-shingle"]);
/** A tree's art: a deciduous tree is bare in winter and in leaf in the other seasons; conifers by size. */
const treeRole = (t, s) => (t.species === "bare" ? (s === "winter" ? "tree.bare.winter" : `tree.deciduous.${s}`) : `tree.conifer.${t.size ?? "large"}.${s}`);
/** How wide a tree's art is drawn, before its own scale: a bare winter tree's art spreads wider than one in leaf. */
const treeSize = (t, s) => (t.species === "bare" ? (s === "winter" ? 2.0 : 2.2) : { large: 1.0, medium: 0.78, small: 0.55 }[t.size] ?? 1.0);
/** A hedge's bushes: bare in winter, in leaf otherwise. */
const bushRole = (s) => (s === "winter" ? "bush.bare.winter" : `bush.leafy.${s}`);
/** A wall's face moved toward its center line by d squares (both lists of points, the same length). */
function offsetLine(face, center, d) {
  return face.map((p, i) => {
    const c = center[i] ?? p, dx = c[0] - p[0], dy = c[1] - p[1], l = Math.hypot(dx, dy) || 1;
    return [p[0] + (dx / l) * d, p[1] + (dy / l) * d];
  });
}

/**
 * How heavy the drawn lines are: a road's dark middle line (its ruts when it has them), its worn middle, its trodden
 * verge, the outline around roofs, and the dark edge along water. 1 is full strength.
 */
const LINES = { center: 0, worn: 0.6, verge: 0.6, eave: 0.75, waterEdge: 0.5 }; // Patrick chose these (31 Oct) over heavier lines

const hasFlat = (b) => (!b.round || b.tower) && (b.roofStyle === "flat" || b.roofStyle === "mansard");
/** The flat roof's role: stone paving, or planks on a palisade's open tower. */
const flatRole = (b, s) => (b.flatRoof === "wood" ? `roof.flat.wood.${s}` : `roof.flat.${s}`);

/** A color each crop's art is lifted toward outside winter: [color, strength, how]. */
const FIELD_LIFT = {
  growing: ["rgb(70,88,22)", 0.55, "screen"],
  ripe: ["rgb(130,100,30)", 0.5, "screen"],
  stubble: ["rgb(120,100,62)", 0.3, "screen"],
  plowed: ["rgb(92,64,40)", 0.4, "screen"],
  fallow: ["rgb(52,66,22)", 0.45, "screen"],
  pasture: ["rgb(24,34,10)", 0.25, "screen"],
  hay: ["rgb(80,68,30)", 0.35, "screen"],
};

/** What trodden ground (verges, yards) is lifted toward where the grass is lifted, so it doesn't rim the roads dark. */
const TRODDEN_LIFT = "rgb(72,64,40)";

/** The widest blur this style uses, in squares (tiles need this much margin). */
export const MAX_BLUR = 2;

const ROOF_SCALE = 0.1; // roof texture scale at 50 px a square (0.05 is true scale and reads as noise)

export function rolesFor(layout) {
  const s = layout.season;
  const g = layout.items.find((i) => i.kind === "ground")?.base ?? "grass";
  const roles = new Set([`ground.${g}`, `ground.${g}.light`, `ground.${g}.grassy`, `ground.${g}.rocky`, `surface.trodden.${s}`]);
  for (const i of layout.items) {
    if (i.kind === "way") roles.add(`surface.${i.surface}.${s}`);
    if (i.kind === "surface" && i.surface) roles.add(`surface.${i.surface}.${s}`);
    if (i.kind === "surface" && i.class === "square" && s === "winter") roles.add("overlay.snow");
    if (i.kind === "surface" && i.class === "park") {
      for (const w of i.paths ?? []) roles.add(s === "winter" ? "surface.trodden.winter" : `surface.${w.surface}.${s}`);
      if (i.basin) roles.add(`stone.rough.${s}`).add(s === "winter" ? "water.ice" : "water.pond");
      if (s !== "winter") roles.add("ground.grass.grassy");
    }
    if (i.kind === "water") {
      roles.add(i.poly ? `shore.${i.shore}.${s}` : `stone.rough.${s}`).add(i.frozen ? "water.ice" : `water.${i.class}`);
      if (i.frozen) roles.add("water.ice.cracked");
    }
    if (i.kind === "dock") roles.add(`dock.${i.material}.${s}`);
    if (i.kind === "reed") roles.add("prop.reeds");
    if (i.kind === "lily") roles.add("prop.lily");
    if (i.kind === "crossing") roles.add(`surface.trodden.${s}`).add(`stone.rough.${s}`).add("water.ice.cracked");
    if (i.kind === "wall") {
      if (i.class === "palisade") roles.add("wood.stake");
      else roles.add(`stone.rough.${s}`);
      if (i.class === "town") roles.add(`wall.walk.${s}`);
    }
    if (i.kind === "ditch") roles.add(`surface.dirt.${s}`);
    if (i.kind === "building") {
      roles.add(`roof.${i.roof}.${s}`);
      if (hasFlat(i)) roles.add(flatRole(i, s));
      if (s === "winter" && (!SNOWY_IN_WINTER.has(i.roof) || hasFlat(i))) roles.add("overlay.snow");
      if (i.chimney) roles.add("chimney.stone");
    }
    if (i.kind === "field") roles.add(`field.${i.crop}.${s}`);
    if (i.kind === "tree") roles.add(treeRole(i, s));
    if (i.kind === "prop") roles.add(i.class === "bush" ? bushRole(s) : `prop.${i.class}`);
  }
  return [...roles];
}

/**
 * Paints the window [x0, y0] .. [x0 + W/pp, y0 + H/pp] of the map.
 * ctx: { g: the tile's 2d context, mask and blur: same-size scratch canvases, W, H (px), x0, y0 (squares), pp (px a square),
 *        layout, art(role, variant) -> ImageBitmap | null, progress(pct, label) }
 */
export function paint(ctx) {
  const { g, mask, W, H, x0, y0, pp, layout, art, progress = () => {} } = ctx;
  const q = mask.getContext("2d");
  const L = layout;
  const s = L.season;
  const [MW, MH] = L.size.squares;
  const X = (x) => (x - x0) * pp, Y = (y) => (y - y0) * pp;
  const items = (kind, cls) => L.items.filter((i) => i.kind === kind && (cls === undefined || i.class === cls));
  const winter = s === "winter";

  /** A fill for a role: its texture as a map-anchored pattern (sqPerTile squares to one repeat), or its plain color. */
  const tex = (role, sqPerTile, variant = 0) => {
    const im = art(role, variant);
    if (!im) return fallbackColor(role);
    const p = g.createPattern(im, "repeat");
    p.setTransform(new DOMMatrix().translate(-x0 * pp, -y0 * pp).scale((pp * sqPerTile) / im.width));
    return p;
  };
  const path = (k, pts) => { k.beginPath(); pts.forEach(([x, y], i) => (i ? k.lineTo(X(x), Y(y)) : k.moveTo(X(x), Y(y)))); };
  const poly = (k, pts) => { path(k, pts); k.closePath(); };
  const strokeLine = (k, pts, w) => { k.lineWidth = w * pp; path(k, pts); k.stroke(); };
  /**
   * A line whose width varies (widths, one a point, times mul plus add), filled: a round end at each point and a band
   * between each two, every piece wound the same way, so they add up with no gaps where they overlap.
   */
  const strokeVar = (k, pts, widths, add = 0, mul = 1) => {
    k.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = X(pts[i][0]), y = Y(pts[i][1]), r = Math.max(0, ((widths[i] * mul + add) / 2) * pp);
      k.moveTo(x + r, y); k.arc(x, y, r, 0, 2 * Math.PI);
      if (!i) continue;
      const px = X(pts[i - 1][0]), py = Y(pts[i - 1][1]), r0 = Math.max(0, ((widths[i - 1] * mul + add) / 2) * pp);
      const dx = x - px, dy = y - py, l = Math.hypot(dx, dy);
      if (!l) continue;
      const nx = -dy / l, ny = dx / l;
      k.moveTo(px - nx * r0, py - ny * r0); k.lineTo(x - nx * r, y - ny * r); k.lineTo(x + nx * r, y + ny * r); k.lineTo(px + nx * r0, py + ny * r0); k.closePath();
    }
    k.fill("nonzero");
  };
  /** A stream's or river's line at its width (times mul, plus add): stroked when it's the same all along. */
  const waterLine = (k, w, add = 0, mul = 1) => (w.widths ? strokeVar(k, w.path, w.widths, add, mul) : strokeLine(k, w.path, mul === 1 ? w.width + add : w.width * mul + add));
  /**
   * Draw shapes into the mask, blur it, fill it with a fill, lay it on the map. The shapes are drawn sharp and the
   * mask blurred once (on a second canvas, ctx.blur): a canvas blur filter costs a whole-tile blur per drawing call,
   * so a hundred house shadows drawn under the filter cost a hundred blurs. Without ctx.blur, each call is blurred.
   */
  const bq = ctx.blur?.getContext("2d") ?? null;
  // box: [x0, y0, x1, y1] in squares, when the shapes lie within it: only that part of the tile (with room for the
  // blur) is cleared, blurred, filled and laid down, which is much cheaper than the whole tile for a small thing
  const soft = (shape, fill, blur, alpha = 1, op = "source-over", box = null) => {
    let rx = 0, ry = 0, rw = W, rh = H;
    if (box) {
      const m = (blur || 0) * pp * 3 + 2;
      rx = Math.max(0, Math.floor(X(box[0]) - m)); ry = Math.max(0, Math.floor(Y(box[1]) - m));
      rw = Math.min(W, Math.ceil(X(box[2]) + m)) - rx; rh = Math.min(H, Math.ceil(Y(box[3]) + m)) - ry;
      if (rw <= 0 || rh <= 0) return; // not in this tile
    }
    q.setTransform(1, 0, 0, 1, 0, 0);
    q.globalCompositeOperation = "source-over";
    q.clearRect(rx, ry, rw, rh);
    q.filter = blur && !bq ? `blur(${blur * pp}px)` : "none";
    q.fillStyle = "#000"; q.strokeStyle = "#000"; q.lineCap = "round"; q.lineJoin = "round"; q.lineWidth = 1;
    shape(q);
    q.filter = "none";
    q.setTransform(1, 0, 0, 1, 0, 0);
    let k = q, out = mask;
    if (blur && bq) {
      bq.setTransform(1, 0, 0, 1, 0, 0);
      bq.globalCompositeOperation = "source-over";
      bq.clearRect(rx, ry, rw, rh);
      bq.filter = `blur(${blur * pp}px)`;
      bq.drawImage(mask, rx, ry, rw, rh, rx, ry, rw, rh);
      bq.filter = "none";
      k = bq; out = ctx.blur;
    }
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
  // The tile's window in squares, so a pass or a thing wholly outside it is skipped
  const wx1 = x0 + W / pp, wy1 = y0 + H / pp;
  const near = (x, y, r) => x > x0 - r && x < wx1 + r && y > y0 - r && y < wy1 + r;
  /** The box round some point lists, grown by pad squares, for soft(); empty lists give a box no tile meets. */
  const boxOf = (lists, pad = 0) => {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const pts of lists) for (const [x, y] of pts) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; }
    return a === Infinity ? [-1e9, -1e9, -1e9, -1e9] : [a - pad, b - pad, c + pad, d + pad];
  };
  /** An image (a tree, a cart) size squares wide, turned, with a sun shadow; a plain blob when there's no art. */
  const img = (role, variant, x, y, size, rot = 0, shadow = 0) => {
    if (!near(x, y, size + shadow)) return;
    const im = art(role, variant);
    g.save();
    g.translate(X(x), Y(y));
    if (shadow) { g.shadowColor = "rgba(25,35,55,0.45)"; g.shadowBlur = pp * 0.2; g.shadowOffsetY = -shadow * pp; g.shadowOffsetX = shadow * pp * 0.3; }
    g.rotate((rot * Math.PI) / 180);
    const w = size * pp;
    if (im) g.drawImage(im, -w / 2, -(w * im.height) / im.width / 2, w, (w * im.height) / im.width);
    else { g.fillStyle = fallbackColor(role); g.beginPath(); g.arc(0, 0, w * 0.35, 0, Math.PI * 2); g.fill(); }
    g.restore();
  };

  // Ground
  progress(0.02, "Ground");
  const ground = L.items.find((i) => i.kind === "ground");
  const gb = ground?.base ?? "grass";
  g.fillStyle = tex(`ground.${gb}`, 5);
  g.fillRect(0, 0, W, H);
  const blobs = ground?.patches ?? [];
  soft((k) => { for (const [x, y, r, t] of blobs) if (t < 0.45) { k.beginPath(); k.arc(X(x), Y(y), r * pp, 0, 7); k.fill(); } }, tex(`ground.${gb}.light`, 4), 2, 0.7);
  soft((k) => { for (const [x, y, r, t] of blobs) if (t > 0.7) { k.beginPath(); k.arc(X(x), Y(y), r * 0.7 * pp, 0, 7); k.fill(); } }, tex(`ground.${gb}.grassy`, 4), 1.5, 0.4);
  soft((k) => { for (const [x, y, r, t] of blobs) if (t > 0.93) { k.beginPath(); k.arc(X(x), Y(y), r * 0.4 * pp, 0, 7); k.fill(); } }, tex(`ground.${gb}.rocky`, 3), 0.8, 0.6);
  // FA's grass is dark for an overview: lift it toward a light green
  const grassLift = gb === "grass" && !winter;
  if (grassLift) { g.save(); g.globalCompositeOperation = "screen"; g.globalAlpha = 0.55; g.fillStyle = "rgb(75,88,30)"; g.fillRect(0, 0, W, H); g.restore(); }
  for (const a of items("surface", "trodden")) soft((k) => { poly(k, a.poly); k.fill(); }, tex(`surface.trodden.${s}`, 3), 2, 0.5, "source-over", boxOf([a.poly]));

  // Fields: each crop's texture, a field a shade lighter or darker than the next, a worn margin around each, then the
  // rows (furrows, drills, the windrows of cut hay) and the grass balks between strips
  progress(0.08, "Fields");
  const fields = items("field");
  const fieldPath = (k, f) => {
    const ring = (pts) => { pts.forEach(([x, y], i) => (i ? k.lineTo(X(x), Y(y)) : k.moveTo(X(x), Y(y)))); k.closePath(); };
    ring(f.poly);
    for (const h of f.holes ?? []) ring(h);
  };
  const groups = new Map();
  for (const f of fields) {
    const key = `${f.crop}|${f.variant ?? 0}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  for (const [key, list] of groups) {
    const [crop, v] = key.split("|");
    // Under snow a field is mostly the snow around it: its own art shows only faintly
    soft((k) => { k.beginPath(); for (const f of list) fieldPath(k, f); k.fill("evenodd"); }, tex(`field.${crop}.${s}`, 4, Number(v)), winter ? 0.3 : 0.06, winter ? 0.45 : 1, "source-over", boxOf(list.map((f) => f.poly)));
  }
  // The crop art is dark beside the grass: lift each crop toward its own color (a screen), so a field reads as wheat,
  // hay or soil at a glance; snow needs none
  if (!winter) for (const [crop, [color, alpha, op]] of Object.entries(FIELD_LIFT)) {
    const these = fields.filter((f) => f.crop === crop);
    if (these.length) soft((k) => { k.beginPath(); for (const f of these) fieldPath(k, f); k.fill("evenodd"); }, color, 0.06, alpha, op, boxOf(these.map((f) => f.poly)));
  }
  for (const f of fields) {
    if (Math.abs(f.shade) < 0.15) continue;
    g.save();
    g.globalCompositeOperation = f.shade < 0 ? "multiply" : "screen";
    g.globalAlpha = Math.abs(f.shade) * (f.shade < 0 ? 0.22 : 0.12);
    g.fillStyle = f.shade < 0 ? "rgb(150,138,118)" : "rgb(120,118,96)";
    g.beginPath(); fieldPath(g, f); g.fill("evenodd");
    g.restore();
  }
  if (fields.length) soft((k) => { k.lineWidth = 0.3 * pp; for (const f of fields.filter((f) => !f.strip)) { k.beginPath(); fieldPath(k, f); k.stroke(); } }, "rgb(120,112,92)", 0.2, winter ? 0.12 : 0.2, "multiply");
  const rowColor = {
    plowed: winter ? ["rgba(70,78,92,0.24)", 0.07] : ["rgba(42,30,18,0.38)", 0.07],
    growing: ["rgba(36,48,18,0.24)", 0.05], ripe: ["rgba(90,66,24,0.24)", 0.05],
    stubble: winter ? ["rgba(110,100,84,0.2)", 0.04] : ["rgba(70,54,32,0.22)", 0.04],
  };
  // Cut hay lies in soft pale windrows, each with a little shadow on its north side
  const hay = fields.filter((f) => f.crop === "hay" && f.rows * pp >= 3);
  // Each field's rows clipped to that field (two hay fields side by side would otherwise cross-hatch); the mask is
  // blurred once afterwards, so the clips cost nothing extra
  const windrows = (dx, dy) => (k) => {
    k.lineWidth = 0.2 * pp; k.lineCap = "butt";
    for (const f of hay) {
      k.save(); k.beginPath(); fieldPath(k, f); k.clip("evenodd");
      k.beginPath(); rowLines(k, f, (x) => X(x) + dx * pp, (y) => Y(y) + dy * pp); k.stroke();
      k.restore();
    }
  };
  if (hay.length && !winter) {
    soft(windrows(0.03, -0.07), "rgb(70,60,40)", 0.06, 0.3, "multiply");
    soft(windrows(0, 0), "rgb(232,216,160)", 0.05, 0.5);
  }
  for (const f of fields) {
    const rc = rowColor[f.crop];
    if (!rc || !(f.rows > 0) || f.rows * pp < 3) continue;
    g.save(); g.beginPath(); fieldPath(g, f); g.clip("evenodd");
    paintRows(g, f, X, Y, pp, rc[0], Math.max(1, rc[1] * pp));
    g.restore();
  }
  const balks = items("boundary", "balk");
  if (balks.length) soft((k) => { for (const b of balks) strokeLine(k, b.path, 0.16); }, tex(`ground.${gb}.grassy`, 4), 0.05, 0.95);

  // Yards, farmyards, gardens
  progress(0.12, "Yards and gardens");
  const yards = items("surface", "yard"), farmyards = items("surface", "farmyard");
  if (yards.length) soft((k) => { for (const y of yards) { poly(k, y.poly); k.fill(); } }, tex(`surface.trodden.${s}`, 2.5), 0.25, 0.95, "source-over", boxOf(yards.map((y) => y.poly)));
  if (farmyards.length) soft((k) => { for (const y of farmyards) { poly(k, y.poly); k.fill(); } }, tex(`surface.trodden.${s}`, 2.5), 0.4, 0.8, "source-over", boxOf(farmyards.map((y) => y.poly)));
  // Lifted as the grass is, so yards don't read as dark patches on it
  const allYards = [...yards, ...farmyards];
  if (grassLift && allYards.length) soft((k) => { for (const y of allYards) { poly(k, y.poly); k.fill(); } }, TRODDEN_LIFT, 0.4, 0.8, "screen", boxOf(allYards.map((y) => y.poly)));
  for (const y of yards.filter((y) => y.surface && y.surface !== "trodden")) {
    const box = boxOf([y.poly]);
    soft((k) => { poly(k, y.poly); k.fill(); }, tex(`surface.${y.surface}.${s}`, 2.5), 0.12, 0.55, "source-over", box);
    soft((k) => { poly(k, y.poly); k.fill(); }, "rgb(160,150,138)", 0.12, 0.35, "multiply", box);
  }
  for (const y of yards.filter((y) => y.fence)) {
    g.save(); g.strokeStyle = "rgba(88,66,46,0.9)"; g.lineWidth = Math.max(1.5, pp * 0.05); g.setLineDash([pp * 0.14, pp * 0.06]); poly(g, y.poly); g.stroke(); g.setLineDash([]); g.restore();
  }
  // Parks: grass where the season shows it, then their paths (trodden or gravel), then a formal garden's basin
  for (const pk of items("surface", "park")) {
    const box = boxOf([pk.poly, ...(pk.paths ?? []).map((w) => w.path)], 1 + Math.max(0, ...(pk.paths ?? []).map((w) => w.width / 2)));
    if (s !== "winter") soft((k) => { poly(k, pk.poly); k.fill(); }, tex(`ground.grass.grassy`, 4), 0.4, 0.35, "source-over", box);
    // Under snow every path is trodden snow
    for (const w of pk.paths ?? []) soft((k) => strokeLine(k, w.path, w.width), tex(s === "winter" ? "surface.trodden.winter" : `surface.${w.surface}.${s}`, 2.5), 0.06, w.surface === "gravel" ? 0.95 : 0.75, "source-over", box);
    // A little darker, as a road's worn middle is, so a path shows on grass or snow alike
    if (pk.paths?.length) soft((k) => { for (const w of pk.paths) strokeLine(k, w.path, w.width * 0.8); }, "rgb(150,142,132)", 0.08, s === "winter" ? 0.45 : 0.3, "multiply", box);
    if (pk.basin) {
      const { at, radius } = pk.basin;
      const bb = [at[0] - radius - 0.2, at[1] - radius - 0.2, at[0] + radius + 0.2, at[1] + radius + 0.2];
      soft((k) => { k.beginPath(); k.arc(X(at[0]), Y(at[1]), (radius + 0.12) * pp, 0, 2 * Math.PI); k.fill(); }, tex(`stone.rough.${s}`, 0.8), 0.01, 1, "source-over", bb);
      soft((k) => { k.beginPath(); k.arc(X(at[0]), Y(at[1]), radius * pp, 0, 2 * Math.PI); k.fill(); }, tex(s === "winter" ? "water.ice" : "water.pond", 2), 0.01, 1, "source-over", bb);
      g.save(); g.strokeStyle = "rgba(40,40,46,0.6)"; g.lineWidth = Math.max(1, pp * 0.025);
      g.beginPath(); g.arc(X(at[0]), Y(at[1]), (radius + 0.12) * pp, 0, 2 * Math.PI); g.stroke(); g.restore();
    }
  }
  // Gardens are quiet: the ground shows through, rows barely show (winter) or softly (other seasons), and the fence
  // is a thin line, never a bright box
  for (const gd of items("surface", "garden")) {
    const { cx, cy, w: gw, d: gdp, rot } = gd.garden;
    g.save(); g.translate(X(cx), Y(cy)); g.rotate((rot * Math.PI) / 180);
    const w = gw * pp, d = gdp * pp;
    g.fillStyle = winter ? "rgba(110,120,135,0.07)" : "rgba(105,85,55,0.16)";
    g.fillRect(-w / 2, -d / 2, w, d);
    const rows = Math.max(3, Math.round(gdp / 0.25));
    for (let i = 1; i < rows; i++) {
      const yy = -d / 2 + (d * i) / rows;
      g.fillStyle = winter ? "rgba(80,92,110,0.08)" : "rgba(70,95,45,0.22)";
      g.fillRect(-w / 2 + pp * 0.1, yy - pp * 0.025, w - pp * 0.2, pp * 0.045);
    }
    g.strokeStyle = "rgba(92,72,52,0.45)"; g.lineWidth = Math.max(1, pp * 0.022);
    g.strokeRect(-w / 2, -d / 2, w, d);
    g.restore();
  }

  // Plots: crofts as a faint tint, then their boundaries as thin fences, low walls or hedges
  for (const c of items("surface", "croft")) {
    g.fillStyle = winter ? "rgba(120,132,150,0.06)" : "rgba(110,135,60,0.12)";
    poly(g, c.poly); g.fill();
  }
  const bounds = items("boundary");
  const boundStyle = {
    fence: { color: "rgba(88,68,48,0.55)", width: 0.03 },
    wall: { color: "rgba(105,102,98,0.6)", width: 0.05 },
    hedge: { color: winter ? "rgba(70,78,70,0.45)" : "rgba(60,85,45,0.6)", width: 0.08 },
  };
  for (const [cls, st] of Object.entries(boundStyle)) {
    const these = bounds.filter((b) => b.class === cls);
    if (!these.length) continue;
    g.save(); g.strokeStyle = st.color; g.lineWidth = Math.max(1, st.width * pp); g.lineCap = "round"; g.lineJoin = "round";
    for (const b of these) { path(g, b.path); g.stroke(); }
    if (winter && cls !== "hedge") {
      g.strokeStyle = "rgba(240,243,247,0.5)"; g.lineWidth = Math.max(1, st.width * pp * 0.4);
      for (const b of these) { path(g, b.path); g.stroke(); }
    }
    g.restore();
  }

  // Walls and hedges
  progress(0.25, "Walls and hedges");
  const walls = items("wall").filter((w) => !w.thickness); // town walls and palisades come after the water
  if (walls.length) {
    const box = boxOf(walls.map((w) => w.path), 0.5);
    soft((k) => { for (const w of walls) { k.save(); k.translate(pp * 0.03, -pp * 0.09); strokeLine(k, w.path, 0.2); k.restore(); } }, "rgb(30,40,58)", 0.08, 0.35, "source-over", box);
    soft((k) => { for (const w of walls) strokeLine(k, w.path, 0.13); }, tex(`stone.rough.${s}`, 0.8), 0.01, 1, "source-over", box);
    soft((k) => { for (const w of walls) strokeLine(k, w.path, 0.13); }, "rgb(88,84,80)", 0.01, 0.85, "multiply", box);
    if (s === "winter") soft((k) => { for (const w of walls) strokeLine(k, w.path, 0.04); }, "rgb(236,239,243)", 0.02, 0.6, "source-over", box);
  }
  // A bush placed in a plan has no scale of its own
  for (const b of items("prop", "bush")) img(bushRole(s), b.variant, b.x, b.y, b.scale ?? 0.5, b.rot, 0.18);

  // Ditches along town walls: a dark hollow of bare earth, grassed over at its edges, under the roads that cross it
  for (const d of items("ditch")) {
    const box = boxOf([d.path], d.width / 2 + 0.5);
    soft((k) => strokeLine(k, d.path, d.width + 0.12), "rgb(54,46,36)", 0.06, 0.55, "multiply", box);
    soft((k) => strokeLine(k, d.path, d.width), tex(`surface.dirt.${s}`, 2.5), 0.06, winter ? 0.5 : 0.9, "source-over", box);
    soft((k) => strokeLine(k, d.path, d.width * 0.55), "rgb(84,74,58)", 0.12, winter ? 0.3 : 0.5, "multiply", box);
    if (winter) soft((k) => strokeLine(k, d.path, d.width * 0.85), "rgb(232,236,242)", 0.15, 0.45, "source-over", box);
  }

  // Roads and lanes: trodden verge, the surface, a darker core, ruts
  progress(0.35, "Roads");
  // Tracks out to the fields first: faint trodden paths with no verge, fading toward their far end
  const tracks = items("way").filter((w) => w.faint); // the generated ones; a plan's own track is drawn as a road
  if (tracks.length) {
    soft((k) => { for (const t of tracks) strokeLine(k, t.path, t.width); }, tex(`surface.trodden.${s}`, 2.5), 0.15, 0.4);
    soft((k) => { for (const t of tracks) strokeLine(k, t.path.slice(0, Math.max(2, Math.ceil(t.path.length * 0.55))), t.width * 0.85); }, tex(`surface.trodden.${s}`, 2.5), 0.15, 0.4);
    if (grassLift) soft((k) => { for (const t of tracks) strokeLine(k, t.path, t.width); }, TRODDEN_LIFT, 0.15, 0.6, "screen");
  }
  const ways = items("way").filter((w) => !w.faint);
  soft((k) => { for (const w of ways) strokeLine(k, w.path, w.width + 0.7); }, tex(`surface.trodden.${s}`, 2.5), 0.25, LINES.verge);
  if (grassLift) soft((k) => { for (const w of ways) strokeLine(k, w.path, w.width + 0.7); }, TRODDEN_LIFT, 0.25, 0.45, "screen"); // no dark rim on the lifted grass
  // Widest roads' surfaces first, as the sketch lays them, so a lane's surface runs over the road it meets
  for (const surf of new Set([...ways].sort((a, b) => b.width - a.width).map((w) => w.surface)))
    soft((k) => { for (const w of ways.filter((w) => w.surface === surf)) strokeLine(k, w.path, w.width); }, tex(`surface.${surf}.${s}`, 2.5), 0.15, 0.95);
  // A darker worn middle: strong on snow and slush, lighter on summer dirt, which is dark enough already
  soft((k) => { for (const w of ways) strokeLine(k, w.path, w.width * (w.class === "highway" ? 0.85 : 0.7)); }, "rgb(118,108,96)", 0.2, (s === "winter" ? 0.5 : 0.25) * LINES.worn, "multiply");
  // Ruts where a road has them, else (when LINES.center isn't 0) a faint worn line down its middle
  const rutted = ways.filter((w) => w.ruts);
  if (rutted.length) soft((k) => { for (const w of rutted) for (const d of [-0.22, 0.22]) strokeLine(k, offsetPath(w.path, d), 0.07); }, "rgb(70,62,54)", 0.03, 0.4, "multiply");
  if (LINES.center > 0) soft((k) => { for (const w of ways) if (!w.ruts) strokeLine(k, w.path, 0.06); }, "rgb(70,62,54)", 0.03, LINES.center, "multiply");

  // Squares
  progress(0.45, "Squares");
  // A square sits in the roads rather than on them: a worn apron around it that the roads and streets run into, the
  // paving laid with a soft, slightly ragged edge, then the roads' worn lines carried on faintly across it
  for (const sq of items("surface", "square")) {
    const shape = (k, grow) => { poly(k, sq.poly); k.fill(); if (grow) { k.lineWidth = grow * 2 * pp; k.lineJoin = "round"; k.stroke(); } };
    const [bx0, by0, bx1, by1] = sq.poly.reduce(([a, b, c, d], [x, y]) => [Math.min(a, x), Math.min(b, y), Math.max(c, x), Math.max(d, y)], [Infinity, Infinity, -Infinity, -Infinity]);
    const box = [bx0 - 1, by0 - 1, bx1 + 1, by1 + 1];
    soft((k) => shape(k, 0.9), tex(`surface.trodden.${s}`, 2.5), 0.6, 0.85, "source-over", box);
    if (grassLift) soft((k) => shape(k, 0.9), TRODDEN_LIFT, 0.6, 0.45, "screen", box);
    soft((k) => shape(k, 0.15), tex(`surface.${sq.surface}.${s}`, 1.2), 0.3, 1, "source-over", box);
    // Paving worn and drifted at its edge: the ground's own patches over the rim
    soft((k) => { k.lineWidth = 0.5 * pp; poly(k, sq.poly); k.stroke(); }, tex(`surface.trodden.${s}`, 2.5), 0.35, 0.45, "source-over", box);
    const through = ways.filter((w) => w.path.some(([x, y]) => pointIn([x, y], sq.poly)));
    if (through.length) soft((k) => {
      poly(k, sq.poly); k.fill();
      k.globalCompositeOperation = "source-in";
      for (const w of through) strokeLine(k, w.path, w.width * 0.7);
      k.globalCompositeOperation = "source-over";
    }, "rgb(128,118,104)", 0.4, s === "winter" ? 0.3 : 0.2, "multiply", box);
    if (s === "winter") soft((k) => shape(k, 0.15), tex("overlay.snow", 2), 0.4, 0.35, "source-over", box);
  }

  // Water: the bank, a dark edge, the water or ice, a cracked line, a darker core
  progress(0.5, "Water");
  // Every bank and shore first, then every edge, then the water, so where a stream or moat opens into a river (or a
  // river into a lake or the sea) no bank runs across its mouth
  const waters = items("water").filter((w) => w.path).map((w) => ({ w, box: boxOf([w.path], w.width / 2 + 0.5) }));
  const lakes = items("water").filter((w) => w.poly).map((b) => ({ b, box: boxOf([b.ring], b.reach + 1) }));
  for (const { w, box } of waters) soft((k) => waterLine(k, w, 0.95), tex(`stone.rough.${s}`, 2), 0.35, 0.8, "source-over", box);
  for (const { b, box } of lakes) paintShore(b, box);
  for (const { w, box } of waters) soft((k) => waterLine(k, w, 0.3), "rgb(48,62,80)", 0.12, LINES.waterEdge, "source-over", box);
  // A lake's dark edge, but not along a beach, which slopes into the water
  for (const { b, box } of lakes) if (b.shore !== "sand" && b.shore !== "pebbles") soft((k) => strokeLine(k, b.ring, 0.3), "rgb(48,62,80)", 0.12, LINES.waterEdge, "source-over", box);
  for (const { w, box } of waters) {
    soft((k) => waterLine(k, w), tex(w.frozen ? "water.ice" : `water.${w.class}`, 2.5), 0.06, 1, "source-over", box);
    if (w.frozen) soft((k) => waterLine(k, w, 0, 0.48), tex("water.ice.cracked", 2), 0.2, 0.55, "source-over", box);
    soft((k) => strokeLine(k, w.path, 0.25), "rgb(40,60,82)", 0.15, 0.35, "multiply", box);
  }
  // Lakes and the sea over the rivers that run into them, each river's water fading out into it
  for (const { b, box } of lakes) {
    paintLake(b, box);
    if (b.frozen) continue;
    for (const { w, box: wb } of waters) {
      if (!w.widths || w.frozen || wb[2] < box[0] || wb[0] > box[2] || wb[3] < box[1] || wb[1] > box[3]) continue;
      soft((k) => { poly(k, b.poly); k.fill(); k.globalCompositeOperation = "source-in"; waterLine(k, w); k.globalCompositeOperation = "source-over"; }, tex(`water.${w.class}`, 2.5), 0.8, 0.5, "source-over", wb);
    }
  }
  for (const p of items("lily")) img("prop.lily", p.variant, p.x, p.y, p.s, p.rot, 0);

  /** A lake's or the sea's shore: a band of its ground out from the water's edge (none where a quay is). */
  function paintShore(b, box) {
    const runs = b.runs ?? [b.ring];
    const band = (k, w) => { for (const r of runs) strokeLine(k, r, w); };
    soft((k) => band(k, b.reach * 2), tex(`shore.${b.shore}.${s}`, b.shore === "sand" ? 3 : 2), 0.3, 0.9, "source-over", box);
    // Green shores lifted as the grass is, so they don't rim the water dark
    if (grassLift && (b.shore === "grass" || b.shore === "marsh" || b.shore === "reeds")) soft((k) => band(k, b.reach * 2), "rgb(75,88,30)", 0.3, 0.45, "screen", box);
    // Wet ground at the water's edge
    if (!winter) soft((k) => band(k, b.shore === "sand" || b.shore === "pebbles" ? 0.7 : 0.4), "rgb(112,100,84)", 0.15, b.shore === "sand" ? 0.45 : 0.3, "multiply", box);
  }

  /** A lake or the sea: the water, deeper away from the shore and lighter in the shallows, surf along a sea's coast; or ice. */
  function paintLake(b, box) {
    const fill = (k) => { poly(k, b.poly); k.fill(); };
    // The shape filled, then only what lies within w/2 of the shore kept (in: true), or only what lies beyond it
    const nearShore = (w, keepIn, dash = null) => (k) => {
      fill(k);
      k.globalCompositeOperation = keepIn ? "source-in" : "destination-out";
      if (dash) { k.setLineDash(dash.map((v) => v * pp)); k.lineCap = "butt"; }
      strokeLine(k, b.ring, w);
      k.setLineDash([]); k.lineCap = "round";
      k.globalCompositeOperation = "source-over";
    };
    soft(fill, tex(b.frozen ? "water.ice" : `water.${b.class}`, b.class === "sea" ? 8 : 3), 0.06, 1, "source-over", box);
    if (b.frozen) {
      // Cracked ice in from the shore, and snow drifted along it
      soft(nearShore(2.4, true), tex("water.ice.cracked", 2), 0.4, 0.45, "source-over", box);
      soft(nearShore(0.8, true), "rgb(236,239,243)", 0.25, 0.6, "source-over", box);
      return;
    }
    const S = { sea: 2.2, lake: 1.4, pond: 0.7 }[b.class] ?? 1.4;
    soft(nearShore(S * 2, false), "rgb(40,62,88)", S * 0.5, { sea: 0.3, lake: 0.22, pond: 0.15 }[b.class] ?? 0.22, "multiply", box);
    soft(nearShore(S, true), "rgb(120,160,150)", S * 0.3, 0.3, "screen", box);
    if (b.surf) {
      // Foam where the waves break, and a broken line of it a little way out
      soft(nearShore(0.3, true), "rgb(240,244,246)", 0.06, 0.55, "source-over", box);
      soft((k) => { nearShore(1.3, true, [0.6, 0.35, 0.25, 0.5])(k); k.globalCompositeOperation = "destination-out"; strokeLine(k, b.ring, 1.05); k.globalCompositeOperation = "source-over"; }, "rgb(236,242,245)", 0.05, 0.4, "source-over", box);
    }
  }

  // Crossings
  progress(0.55, "Crossings");
  for (const c of items("crossing")) {
    if (c.class === "ford") paintFord(c);
    else paintBridge(c);
  }

  /** Round posts (r squares in radius) at points, into the mask. */
  const posts = (k, pts, r) => { k.beginPath(); for (const [x, y] of pts) { k.moveTo(X(x) + r * pp, Y(y)); k.arc(X(x), Y(y), r * pp, 0, 2 * Math.PI); } k.fill(); };

  // Docks: quays and wharves along the water's edge, piers and jetties out into it; then the reeds
  progress(0.57, "Docks");
  for (const d of items("dock")) paintDock(d);
  for (const t of items("reed")) img("prop.reeds", t.variant, t.x, t.y, t.s, t.rot, 0.06);

  function paintDock(d) {
    const wood = d.material === "wood";
    const role = tex(`dock.${d.material}.${s}`, wood ? 1.2 : 1.5);
    if (d.edge) {
      // Along the edge: paving from the water's edge back to the land, a shadow on the water below it, a coping
      // along the top of its face (a timber wharf: planks across it on posts)
      const box = boxOf([d.edge, d.land], 0.6);
      const strip = (k) => { poly(k, [...d.edge, ...[...d.land].reverse()]); k.fill(); };
      const out = (dist) => d.edge.map((e, i) => [e[0] - ((d.land[i][0] - e[0]) / d.width) * dist, e[1] - ((d.land[i][1] - e[1]) / d.width) * dist]);
      soft((k) => strokeLine(k, out(0.08), 0.2), "rgb(25,35,55)", 0.08, 0.45, "source-over", box);
      if (wood) soft((k) => posts(k, along(out(0.04), 0.9), 0.075), "rgb(44,32,22)", 0.01, 0.95, "source-over", box);
      soft(strip, role, 0.01, 1, "source-over", box);
      soft(strip, wood ? "rgb(160,150,140)" : "rgb(176,170,162)", 0.01, 0.3, "multiply", box);
      if (wood) {
        g.save(); g.strokeStyle = "rgba(48,34,22,0.55)"; g.lineWidth = Math.max(1, pp * 0.022); g.beginPath();
        for (const [a, b] of across(d.edge, d.land, 0.14)) { g.moveTo(X(a[0]), Y(a[1])); g.lineTo(X(b[0]), Y(b[1])); }
        g.stroke(); g.restore();
      } else soft((k) => strokeLine(k, d.edge, 0.1), "rgb(200,194,184)", 0.01, 0.7, "source-over", box);
      soft((k) => strokeLine(k, out(0.01), 0.035), "rgb(38,38,42)", 0.01, 0.8, "source-over", box);
      if (winter) soft(strip, "rgb(236,239,243)", 0.05, 0.45, "source-over", box);
      return;
    }
    // Out into the water: a shadow on the water, posts under a timber deck (planks across it) or a stone one
    const box = boxOf([d.path], d.width + 0.6);
    const deck = (k, w) => { k.lineCap = "butt"; strokeLine(k, d.path, w); };
    soft((k) => { k.save(); k.translate(0.06 * pp, -0.14 * pp); deck(k, d.width); k.restore(); }, "rgb(25,35,55)", 0.08, 0.45, "source-over", box);
    if (wood) soft((k) => posts(k, [-1, 1].flatMap((side) => along(offsetPath(d.path, (side * d.width) / 2), 0.7)), 0.07), "rgb(44,32,22)", 0.01, 0.95, "source-over", box);
    else soft((k) => deck(k, d.width + 0.06), "rgb(44,44,48)", 0.01, 0.9, "source-over", box);
    soft((k) => deck(k, d.width), role, 0.01, 1, "source-over", box);
    soft((k) => deck(k, d.width), wood ? "rgb(160,150,140)" : "rgb(176,170,162)", 0.01, 0.3, "multiply", box);
    if (wood) {
      g.save(); g.strokeStyle = "rgba(48,34,22,0.55)"; g.lineWidth = Math.max(1, pp * 0.022); g.beginPath();
      for (const [a, b] of across(offsetPath(d.path, d.width / 2), offsetPath(d.path, -d.width / 2), 0.14)) { g.moveTo(X(a[0]), Y(a[1])); g.lineTo(X(b[0]), Y(b[1])); }
      g.stroke(); g.restore();
      soft((k) => { for (const side of [-1, 1]) strokeLine(k, offsetPath(d.path, (side * d.width) / 2), 0.03); }, "rgb(40,28,18)", 0.01, 0.8, "source-over", box);
    } else soft((k) => { for (const side of [-1, 1]) strokeLine(k, offsetPath(d.path, (side * (d.width - 0.08)) / 2), 0.06); }, "rgb(200,194,184)", 0.01, 0.6, "source-over", box);
    if (winter) soft((k) => deck(k, d.width * 0.9), "rgb(236,239,243)", 0.05, 0.45, "source-over", box);
  }

  function paintFord(c) {
    const [fx, fy] = c.at;
    const fa = (c.angle * Math.PI) / 180;
    const dir = wayDirectionAt(L, c.at); // the road running through the ford
    const along = (t) => [fx + dir[0] * t, fy + dir[1] * t];
    const el = (k, rx, ry) => { k.beginPath(); k.ellipse(X(fx), Y(fy), rx * pp, ry * pp, fa, 0, 7); k.fill(); };
    // A 50 ft ford at 25 ft a square: an ellipse 4.6 by 2.5 squares (semi-axes 2.3 and 1.25)
    const rx = (c.width ?? 2) * 1.15, ry = rx * 0.54;
    const reach = Math.max(rx * 1.4, 4.8);
    const box = [fx - reach, fy - reach, fx + reach, fy + reach];
    if (!near(fx, fy, reach + 2)) return;
    soft((k) => strokeLine(k, [along(-3.4), c.at, along(3.6)], 2.2), tex(`surface.trodden.${s}`, 2.5), 0.6, 0.35, "source-over", box);
    soft((k) => el(k, rx, ry), "rgb(46,64,84)", 0.25, 0.92, "source-over", box);
    soft((k) => el(k, rx * 0.83, ry * 0.76), tex("water.ice.cracked", 1.5), 0.3, 0.25, "source-over", box);
    soft((k) => strokeLine(k, [along(-1.7), c.at, along(1.7)], 1.25), tex(`stone.rough.${s}`, 1.2), 0.2, 0.75, "source-over", box);
    soft((k) => strokeLine(k, [along(-1.7), c.at, along(1.7)], 1.25), "rgb(120,104,86)", 0.2, 0.5, "multiply", box);
    soft((k) => strokeLine(k, [along(-1.3), c.at, along(1.3)], 0.55), "rgb(58,74,90)", 0.15, 0.45, "source-over", box);
    const r = rng(c.id, "ford");
    if (c.frozen) for (let i = 0; i < 14; i++) {
      const t = r.next() * Math.PI * 2, rr = 1 + r.next() * 0.35;
      const x = fx + Math.cos(t) * rx * rr * Math.cos(fa) - Math.sin(t) * ry * rr * Math.sin(fa);
      const y = fy + Math.cos(t) * rx * rr * Math.sin(fa) + Math.sin(t) * ry * rr * Math.cos(fa);
      const sz = (0.25 + r.next() * 0.45) * pp;
      // The rock's corners are worked out in tile space, so its texture stays anchored to the map
      const turn = r.next() * 3, ct = Math.cos(turn), st = Math.sin(turn), px = X(x), py = Y(y);
      g.save();
      g.shadowColor = "rgba(20,30,48,0.55)"; g.shadowBlur = pp * 0.05; g.shadowOffsetY = -pp * 0.04;
      g.fillStyle = tex(`ground.${gb}`, 2);
      g.beginPath();
      const nv = 5 + Math.floor(r.next() * 3);
      for (let v = 0; v < nv; v++) {
        const a = (v / nv) * Math.PI * 2, rr2 = sz * (0.3 + r.next() * 0.25);
        const lx = Math.cos(a) * rr2, ly = Math.sin(a) * rr2;
        const qx = px + lx * ct - ly * st, qy = py + lx * st + ly * ct;
        v ? g.lineTo(qx, qy) : g.moveTo(qx, qy);
      }
      g.closePath(); g.fill(); g.shadowColor = "transparent"; g.fillStyle = "rgba(150,175,200,0.25)"; g.fill(); g.restore();
    }
    for (let i = 0; i < 16; i++) {
      const [sx, sy] = along(-1.2 + r.next() * 2.4);
      const x = sx + (r.next() - 0.5) * 0.9 * -dir[1], y = sy + (r.next() - 0.5) * 0.9 * dir[0];
      const rad = (0.04 + r.next() * 0.09) * pp;
      g.fillStyle = "rgba(66,64,62,0.92)"; g.beginPath(); g.ellipse(X(x), Y(y), rad * 1.2, rad, r.next() * 3, 0, 7); g.fill();
      if (r.next() < 0.6) { g.fillStyle = "rgba(232,236,241,0.85)"; g.beginPath(); g.ellipse(X(x) - rad * 0.15, Y(y) - rad * 0.2, rad * 0.7, rad * 0.55, 0, 0, 7); g.fill(); }
    }
  }

  function paintBridge(c) {
    const [x, y] = c.at;
    const len = c.length, wid = c.width;
    g.save(); g.translate(X(x), Y(y)); g.rotate((c.angle * Math.PI) / 180);
    g.save(); g.shadowColor = "rgba(25,35,55,0.5)"; g.shadowBlur = pp * 0.1; g.shadowOffsetY = -pp * 0.1;
    g.fillStyle = "rgb(150,140,128)"; g.fillRect((-len / 2) * pp, (-wid / 2) * pp, len * pp, wid * pp); g.restore();
    g.fillStyle = "rgba(110,82,56,0.85)"; g.fillRect((-len / 2) * pp, (-wid / 2) * pp, len * pp, wid * pp);
    g.strokeStyle = "rgba(60,42,28,0.9)"; g.lineWidth = Math.max(1, pp * 0.04);
    for (let i = -len / 2 + 0.05; i <= len / 2; i += 0.14) { g.beginPath(); g.moveTo(i * pp, (-wid / 2) * pp); g.lineTo(i * pp, (wid / 2) * pp); g.stroke(); }
    g.lineWidth = Math.max(1.5, pp * 0.06); g.strokeRect((-len / 2) * pp, (-wid / 2) * pp, len * pp, wid * pp);
    g.restore();
  }

  // Town walls and palisades, over the water and roads they meet (their towers are buildings, below)
  for (const w of items("wall").filter((w) => w.thickness)) {
    const T = w.thickness;
    const box = boxOf([w.path], T + 1.5);
    const sh = 0.35 + 0.3 * (w.tall ?? 0); // as a building's
    // Its shadow, cast north as the buildings' are
    soft((k) => { k.save(); k.translate(sh * 0.3 * pp, -sh * pp); strokeLine(k, w.path, T); k.restore(); }, "rgb(28,38,58)", 0.12, 0.4, "source-over", box);
    if (w.class === "palisade") {
      // A line of upright logs, seen end on: a dark line, then each log's top as a round of timber
      soft((k) => { k.lineCap = "butt"; strokeLine(k, w.path, T * 0.9); }, "rgb(40,30,22)", 0.01, 0.9, "source-over", box);
      soft((k) => { k.lineCap = "round"; k.setLineDash([0.001 * pp, T * 0.95 * pp]); strokeLine(k, w.path, T * 1.05); k.setLineDash([]); }, "rgb(36,26,18)", 0.01, 0.95, "source-over", box);
      soft((k) => { k.lineCap = "round"; k.setLineDash([0.001 * pp, T * 0.95 * pp]); strokeLine(k, w.path, T * 0.85); k.setLineDash([]); }, tex("wood.stake", 0.5), 0.01, 1, "source-over", box);
      if (winter) soft((k) => { k.lineCap = "round"; k.setLineDash([0.001 * pp, T * 0.95 * pp]); strokeLine(k, w.path, T * 0.5); k.setLineDash([]); }, "rgb(236,239,243)", 0.01, 0.6, "source-over", box);
      continue;
    }
    // The wall: a dark outline, its stone, the walk along the top between two parapets, and battlements (the gaps
    // between merlons) along the outer one
    soft((k) => { k.lineCap = "butt"; strokeLine(k, w.path, T + 0.06); }, "rgb(36,36,40)", 0.01, 0.95, "source-over", box);
    soft((k) => { k.lineCap = "butt"; strokeLine(k, w.path, T); }, tex(`stone.rough.${s}`, 0.8), 0.01, 1, "source-over", box);
    soft((k) => { k.lineCap = "butt"; strokeLine(k, w.path, T); }, "rgb(170,166,160)", 0.01, 0.45, "multiply", box);
    soft((k) => { k.lineCap = "butt"; strokeLine(k, w.path, T * 0.62); }, tex(`wall.walk.${s}`, 1.2), 0.01, 1, "source-over", box);
    if (winter) soft((k) => { k.lineCap = "butt"; strokeLine(k, w.path, T * 0.58); }, "rgb(232,236,242)", 0.02, 0.75, "source-over", box);
    // The parapets' inner edges: a fine shadow line each side of the walk
    soft((k) => { k.lineCap = "butt"; for (const face of [w.face, w.back]) if (face) strokeLine(k, offsetLine(face, w.path, T * 0.19), 0.025); }, "rgb(40,40,44)", 0.01, 0.6, "source-over", box);
    if (w.face) soft((k) => { k.lineCap = "butt"; k.setLineDash([T * 0.22 * pp, T * 0.22 * pp]); strokeLine(k, offsetLine(w.face, w.path, T * 0.095), T * 0.12); k.setLineDash([]); }, "rgb(40,38,40)", 0, 0.85, "source-over", box);
  }

  // Buildings: shadows first, then roofs
  progress(0.6, "Roofs");
  const buildings = items("building");
  // The box reaches the biggest building and the longest shadow (a tall tower's falls well north of it)
  const reachB = 1 + Math.max(0, ...buildings.map((b) => Math.max(b.len, b.dep))) + 1.05 * Math.max(0, ...buildings.map((b) => 0.35 + 0.3 * (b.tall || 0)));
  if (buildings.length) soft((k) => {
    for (const b of buildings) {
      const sh = 0.35 + 0.3 * (b.tall || 0);
      k.save(); k.translate(X(b.cx) + sh * 0.3 * pp, Y(b.cy) - sh * pp); k.rotate((b.rot * Math.PI) / 180);
      if (b.round) { k.beginPath(); k.arc(0, 0, (Math.min(b.len, b.dep) * pp) / 2, 0, 2 * Math.PI); k.fill(); }
      else k.fillRect((-b.len * pp) / 2, (-b.dep * pp) / 2, b.len * pp, b.dep * pp);
      k.restore();
    }
  }, "rgb(28,38,58)", 0.12, 0.45, "source-over", boxOf([buildings.map((b) => [b.cx, b.cy])], reachB));
  const rs = (ROOF_SCALE * pp) / 50;
  const SUN = [0, 1]; // light from the south: slopes facing down the map are lit, those facing up are in shade
  for (const b of buildings) {
    if (!near(b.cx, b.cy, Math.max(b.len, b.dep))) continue;
    const th = (b.rot * Math.PI) / 180, c = Math.cos(th), sn = Math.sin(th);
    const facets = roofFacets(b);
    g.save(); g.translate(X(b.cx), Y(b.cy)); g.rotate(th);
    const role = `roof.${b.roof}.${s}`;
    const im = art(role, b.variant);
    const flatIm = hasFlat(b) ? art(flatRole(b, s), b.variant) : null;
    const snow = s === "winter" ? art("overlay.snow", 0) : null;
    const P = ([x, y]) => [x * pp, y * pp];
    const shape = (pts) => { g.beginPath(); pts.forEach((q, k) => { const [x, y] = P(q); k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); };
    const line = (a2, b2) => { g.beginPath(); g.moveTo(...P(a2)); g.lineTo(...P(b2)); g.stroke(); };
    const fillTex = (img, angle, fallback) => {
      if (img) {
        const p = g.createPattern(img, "repeat");
        p.setTransform(new DOMMatrix().rotate(angle).scale((rs * 1200) / img.width));
        g.fillStyle = p;
      } else g.fillStyle = fallback;
    };
    for (const f of facets) {
      if (!f.poly.length) continue; // a gable's verge: outline only
      // The texture's rows run along the facet's eave; flat pieces take the flat roof's paving
      if (f.flat) fillTex(flatIm, 0, fallbackColor(flatRole(b, s)));
      else fillTex(im, f.eaveAngle, fallbackColor(role));
      shape(f.poly); g.fill();
      if (snow && (f.flat || !SNOWY_IN_WINTER.has(b.roof))) {
        const p = g.createPattern(snow, "repeat"); p.setTransform(new DOMMatrix().rotate(f.eaveAngle).scale((pp * 1.5) / snow.width));
        // A pale wash first, so a colored roof reads as snowed on as much as the art that comes with snow
        g.fillStyle = "rgba(232,237,243,0.3)"; shape(f.poly); g.fill();
        g.globalAlpha = f.flat ? 0.9 : 0.75; g.fillStyle = p; shape(f.poly); g.fill(); g.globalAlpha = 1;
      }
      // Shade by which way the slope faces: lit to the south, in shade to the north, between to east and west
      const dx = f.down[0] * c - f.down[1] * sn, dy = f.down[0] * sn + f.down[1] * c;
      const lit = f.flat ? 0.35 : dx * SUN[0] + dy * SUN[1];
      g.fillStyle = `rgba(18,28,48,${(0.2 - 0.16 * lit).toFixed(3)})`; shape(f.poly); g.fill();
      if (lit > 0.5) { g.fillStyle = "rgba(255,248,236,0.05)"; shape(f.poly); g.fill(); }
    }
    g.lineCap = "round";
    // Valleys (and hips, under their caps) as fine lines
    g.strokeStyle = "rgba(28,28,36,0.45)"; g.lineWidth = Math.max(1, pp * 0.02);
    for (const cr of facets.creases) line(...cr.seg);
    // Ridge caps: a pale band along the ridge and down each hip, edged in shadow; snow along them in winter
    if (facets.caps.length) {
      const capW = Math.max(1.5, pp * 0.04);
      g.strokeStyle = "rgba(28,28,36,0.35)"; g.lineWidth = capW + Math.max(1, pp * 0.015);
      for (const seg of facets.caps) line(...seg);
      g.strokeStyle = s === "winter" ? "rgb(228,232,237)" : capColor(b.roof); g.lineWidth = capW;
      for (const seg of facets.caps) line(...seg);
    }
    // A flat roof's parapet: a low stone wall around its edge (not across a wing's join), casting a little shade inward
    if (facets.parapet) paintParapet(g, b, facets.parapet, pp, c, sn, s);
    // A mansard's skylight
    if (facets.skylight) paintSkylight(g, facets.skylight, pp, s);
    // The outline: only the eaves and verges, so a wing's roof joins its house's without a seam
    g.strokeStyle = `rgba(28,28,36,${0.85 * LINES.eave})`; g.lineWidth = Math.max(1, pp * 0.035 * LINES.eave);
    for (const f of facets) for (const [a2, b2] of f.eaves) line(a2, b2);
    if (facets.finial) {
      g.fillStyle = "rgb(70,62,54)"; g.beginPath(); g.arc(0, 0, Math.max(2, pp * 0.05), 0, 2 * Math.PI); g.fill();
    }
    if (b.chimney) {
      const ci = art("chimney.stone", b.chimney.variant);
      const cw = 0.3 * pp, len = b.len * pp, dep = b.dep * pp;
      g.save(); g.shadowColor = "rgba(25,35,55,0.5)"; g.shadowBlur = pp * 0.06; g.shadowOffsetY = -pp * 0.12;
      const ccx = len * b.chimney.u, ccy = dep * b.chimney.v;
      if (ci) { const ch = (cw * ci.height) / ci.width; g.drawImage(ci, ccx - cw / 2, ccy - ch / 2, cw, ch); }
      else { g.fillStyle = fallbackColor("chimney.stone"); g.fillRect(ccx - cw / 2, ccy - cw / 2, cw, cw); }
      g.restore();
    }
    g.restore();
  }

  // Props, then trees from north to south so southern crowns overlap
  progress(0.75, "Props and trees");
  for (const p of items("prop").filter((p) => p.class !== "bush")) {
    const size = { well: 0.45, cart: 0.45, wagon: 0.6 }[p.class] ?? 0.45;
    const shadow = { well: 0.1, cart: 0.08, wagon: 0.1 }[p.class] ?? 0.08;
    img(`prop.${p.class}`, p.variant, p.x, p.y, size * (p.scale ?? 1), p.rot, shadow);
  }
  for (const t of [...items("tree")].sort((a, b) => a.y - b.y)) {
    const sz = treeSize(t, s) * t.s * 1.1;
    img(treeRole(t, s), t.variant, t.x, t.y, sz, t.rot, sz * 0.35);
  }

  // A light vignette over the whole map (lighter outside winter, so summer grass doesn't darken at the edges)
  progress(0.95, "Finishing");
  const vg = g.createRadialGradient(X(MW / 2), Y(MH / 2), Math.min(MW, MH) * pp * 0.35, X(MW / 2), Y(MH / 2), Math.max(MW, MH) * pp * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, `rgba(20,28,40,${winter ? 0.25 : 0.12})`);
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
}

/** True when a point is inside a polygon (even-odd). */
function pointIn([x, y], poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Points every step squares along a path (from half a step in). */
function along(pts, step) {
  const out = [];
  let carry = step / 2;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], l = Math.hypot(bx - ax, by - ay);
    let t = carry;
    while (t <= l) { out.push([ax + ((bx - ax) * t) / l, ay + ((by - ay) * t) / l]); t += step; }
    carry = t - l;
  }
  return out;
}

/**
 * Lines across a strip between two paths with as many points (a quay's edge and its landward side, or a pier's two
 * sides), every step squares along the first: [[a, b]...].
 */
function across(a, b, step) {
  const out = [];
  let carry = step / 2;
  for (let i = 1; i < a.length; i++) {
    const l = Math.hypot(a[i][0] - a[i - 1][0], a[i][1] - a[i - 1][1]);
    let t = carry;
    while (t <= l) {
      const u = l ? t / l : 0;
      const lerp = (p, q) => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
      out.push([lerp(a[i - 1], a[i]), lerp(b[i - 1], b[i])]);
      t += step;
    }
    carry = t - l;
  }
  return out;
}

/** A path moved sideways by d squares (left of its direction), for ruts. */
function offsetPath(pts, d) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [p[0] - (dy / l) * d, p[1] + (dx / l) * d];
  });
}

/**
 * A field's rows: lines rows squares apart, running at its angle, across the whole field (the caller clips to it).
 * Shared by both styles. X, Y: map squares to tile pixels.
 */
export function paintRows(g, f, X, Y, pp, color, width) {
  g.strokeStyle = color; g.lineWidth = width; g.lineCap = "butt";
  g.beginPath();
  rowLines(g, f, X, Y);
  g.stroke();
  g.lineCap = "round";
}

/** Adds a field's rows to the path being built (no beginPath, no stroke). */
export function rowLines(g, f, X, Y) {
  const [x0, y0, x1, y1] = f.poly.reduce(([a, b, c, d], [x, y]) => [Math.min(a, x), Math.min(b, y), Math.max(c, x), Math.max(d, y)], [Infinity, Infinity, -Infinity, -Infinity]);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, reach = Math.hypot(x1 - x0, y1 - y0) / 2 + 1;
  const a = (f.angle * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
  // Anchored to the map, not the field's box, so rows sit the same in every tile
  const mid = cx * vx + cy * vy;
  const start = Math.floor((mid - reach) / f.rows) * f.rows;
  for (let t = start; t <= mid + reach; t += f.rows) {
    const px = cx + vx * (t - mid), py = cy + vy * (t - mid);
    g.moveTo(X(px - ux * reach), Y(py - uy * reach));
    g.lineTo(X(px + ux * reach), Y(py + uy * reach));
  }
}

/** The unit direction of the way passing closest to a point (for a ford), or straight down. */
export function wayDirectionAt(L, [x, y]) {
  let best = null, bestD = Infinity;
  for (const w of L.items.filter((i) => i.kind === "way")) {
    for (let i = 0; i < w.path.length - 1; i++) {
      const [ax, ay] = w.path[i], [bx, by] = w.path[i + 1];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      const d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
      if (d < bestD) { bestD = d; const l = Math.sqrt(l2) || 1; best = [dx / l, dy / l]; }
    }
  }
  return bestD < 3 && best ? best : [0, 1];
}

/** A ridge cap's color: the roof's own color, much paler. */
function capColor(roof) {
  const hex = fallbackColor(`roof.${roof}`);
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "rgb(200,196,188)";
  const n = parseInt(m[1], 16);
  const mix = (v) => Math.round(v + (225 - v) * 0.32);
  return `rgb(${mix(n >> 16)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

/**
 * A flat roof's parapet, in the building's frame (the context is already turned to it). Each free edge gets a band
 * of pale stone; a wing's joined end gets none, and its roof runs on over its house's parapet, so the two join.
 * The bands on the sunny side throw a soft shadow onto the roof.
 */
function paintParapet(g, b, { w, joined, round, R, crenels }, pp, c, sn, season) {
  const A = (b.len / 2) * pp, B = (b.dep / 2) * pp, W = w * pp;
  const stone = b.flatRoof === "wood" ? "rgb(104,78,54)" : season === "winter" ? "rgb(226,230,235)" : "rgb(178,170,158)";
  // Battlements: the gaps between merlons, as dark notches along the parapet's middle
  const notches = (draw) => {
    if (!crenels) return;
    g.save(); g.strokeStyle = "rgba(36,34,38,0.85)"; g.lineWidth = Math.max(1, W * 0.55); g.setLineDash([Math.max(1, W * 0.9), Math.max(1, W * 0.9)]);
    draw(); g.stroke(); g.restore();
  };
  if (round) {
    const r = R * pp;
    // Shade inside the north side's wall, then the ring of stone, its inner edge and its outer edge
    g.fillStyle = "rgba(18,28,48,0.18)"; g.beginPath(); g.arc(0, -W * 0.6, r - W, 0, 2 * Math.PI); g.arc(0, 0, r - W, 0, 2 * Math.PI, true); g.fill();
    g.strokeStyle = stone; g.lineWidth = W; g.beginPath(); g.arc(0, 0, r - W / 2, 0, 2 * Math.PI); g.stroke();
    notches(() => { g.beginPath(); g.arc(0, 0, r - W / 2, 0, 2 * Math.PI); });
    g.strokeStyle = "rgba(28,28,36,0.5)"; g.lineWidth = Math.max(1, pp * 0.015); g.beginPath(); g.arc(0, 0, r - W, 0, 2 * Math.PI); g.stroke();
    return;
  }
  const edges = [
    { on: true, rect: [-A, -B, 2 * A, W], n: [0, 1] },
    { on: true, rect: [-A, B - W, 2 * A, W], n: [0, -1] },
    { on: !joined.start, rect: [-A, -B, W, 2 * B], n: [1, 0] },
    { on: !joined.end, rect: [A - W, -B, W, 2 * B], n: [-1, 0] },
  ];
  // Shade inside the walls that face the sun (the wall on the south side shades the roof just north of it)
  for (const ed of edges) {
    if (!ed.on) continue;
    const ny = ed.n[0] * sn + ed.n[1] * c; // the inward normal, in map space (y down)
    const k = Math.max(0, -ny);
    if (k < 0.05) continue;
    const [x, y, ww, hh] = ed.rect;
    const sx = x + ed.n[0] * W, sy = y + ed.n[1] * W;
    g.fillStyle = `rgba(18,28,48,${(0.22 * k).toFixed(3)})`;
    g.fillRect(sx, sy, ww, hh);
  }
  g.fillStyle = stone;
  for (const ed of edges) if (ed.on) g.fillRect(...ed.rect);
  notches(() => { g.beginPath(); g.rect(-A + W / 2, -B + W / 2, 2 * A - W, 2 * B - W); });
  // Its inner edge, a fine dark line
  g.strokeStyle = "rgba(28,28,36,0.5)"; g.lineWidth = Math.max(1, pp * 0.015);
  for (const ed of edges) {
    if (!ed.on) continue;
    const [x, y, ww, hh] = ed.rect;
    const inner = ed.n[1] === 1 ? [[x, y + hh], [x + ww, y + hh]] : ed.n[1] === -1 ? [[x, y], [x + ww, y]] : ed.n[0] === 1 ? [[x + ww, y], [x + ww, y + hh]] : [[x, y], [x, y + hh]];
    g.beginPath(); g.moveTo(...inner[0]); g.lineTo(...inner[1]); g.stroke();
  }
  // The outer edge (joined ends left open)
  g.strokeStyle = "rgba(28,28,36,0.85)"; g.lineWidth = Math.max(1, pp * 0.035);
  const outer = [[[-A, -B], [A, -B], true], [[-A, B], [A, B], true], [[-A, -B], [-A, B], !joined.start], [[A, -B], [A, B], !joined.end]];
  for (const [p0, p1, on] of outer) if (on) { g.beginPath(); g.moveTo(...p0); g.lineTo(...p1); g.stroke(); }
}

/** A glass skylight: pale panes in a dark frame, with glazing bars. */
function paintSkylight(g, { cx, cy, len, dep }, pp, season) {
  const x = (cx - len / 2) * pp, y = (cy - dep / 2) * pp, w = len * pp, h = dep * pp;
  g.fillStyle = "rgb(58,60,66)"; g.fillRect(x, y, w, h);
  const f = Math.max(1, pp * 0.02);
  const grad = g.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, season === "winter" ? "rgb(214,224,232)" : "rgb(176,204,214)");
  grad.addColorStop(1, season === "winter" ? "rgb(236,242,246)" : "rgb(218,234,238)");
  g.fillStyle = grad; g.fillRect(x + f, y + f, w - 2 * f, h - 2 * f);
  g.strokeStyle = "rgb(58,60,66)"; g.lineWidth = Math.max(1, pp * 0.012);
  const nx = Math.max(2, Math.round(len / 0.12)), ny = Math.max(1, Math.round(dep / 0.12));
  for (let i = 1; i < nx; i++) { g.beginPath(); g.moveTo(x + (w * i) / nx, y); g.lineTo(x + (w * i) / nx, y + h); g.stroke(); }
  for (let j = 1; j < ny; j++) { g.beginPath(); g.moveTo(x, y + (h * j) / ny); g.lineTo(x + w, y + (h * j) / ny); g.stroke(); }
}
