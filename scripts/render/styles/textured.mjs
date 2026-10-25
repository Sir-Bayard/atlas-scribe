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
const hasFlat = (b) => !b.round && (b.roofStyle === "flat" || b.roofStyle === "mansard");

/** A colour each crop's art is lifted toward outside winter: [colour, strength, how]. */
const FIELD_LIFT = {
  growing: ["rgb(70,88,22)", 0.55, "screen"],
  ripe: ["rgb(130,100,30)", 0.5, "screen"],
  stubble: ["rgb(120,100,62)", 0.3, "screen"],
  ploughed: ["rgb(92,64,40)", 0.4, "screen"],
  fallow: ["rgb(52,66,22)", 0.45, "screen"],
  pasture: ["rgb(24,34,10)", 0.25, "screen"],
  hay: ["rgb(80,68,30)", 0.35, "screen"],
};

/** What trodden ground (verges, yards) is lifted toward where the grass is lifted, so it doesn't rim the roads dark. */
const TRODDEN_LIFT = "rgb(72,64,40)";

/** The widest blur this style uses, in squares (tiles need this much margin). */
export const MAX_BLUR = 4;

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
    if (i.kind === "water") roles.add(`stone.rough.${s}`).add(i.frozen ? "water.ice" : `water.${i.class}`).add("water.ice.cracked");
    if (i.kind === "crossing") roles.add(`surface.trodden.${s}`).add(`stone.rough.${s}`).add("water.ice.cracked");
    if (i.kind === "wall") roles.add(`stone.rough.${s}`);
    if (i.kind === "building") {
      roles.add(`roof.${i.roof}.${s}`);
      if (hasFlat(i)) roles.add(`roof.flat.${s}`);
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

  /** A fill for a role: its texture as a map-anchored pattern (sqPerTile squares to one repeat), or its plain colour. */
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
   * Draw shapes into the mask, blur it, fill it with a fill, lay it on the map. The shapes are drawn sharp and the
   * mask blurred once (on a second canvas, ctx.blur): a canvas blur filter costs a whole-tile blur per drawing call,
   * so a hundred house shadows drawn under the filter cost a hundred blurs. Without ctx.blur, each call is blurred.
   */
  const bq = ctx.blur?.getContext("2d") ?? null;
  const soft = (shape, fill, blur, alpha = 1, op = "source-over") => {
    q.setTransform(1, 0, 0, 1, 0, 0);
    q.globalCompositeOperation = "source-over";
    q.clearRect(0, 0, W, H);
    q.filter = blur && !bq ? `blur(${blur * pp}px)` : "none";
    q.fillStyle = "#000"; q.strokeStyle = "#000"; q.lineCap = "round"; q.lineJoin = "round"; q.lineWidth = 1;
    shape(q);
    q.filter = "none";
    q.setTransform(1, 0, 0, 1, 0, 0);
    let k = q, out = mask;
    if (blur && bq) {
      bq.setTransform(1, 0, 0, 1, 0, 0);
      bq.globalCompositeOperation = "source-over";
      bq.clearRect(0, 0, W, H);
      bq.filter = `blur(${blur * pp}px)`;
      bq.drawImage(mask, 0, 0);
      bq.filter = "none";
      k = bq; out = ctx.blur;
    }
    k.globalCompositeOperation = "source-in";
    k.fillStyle = fill;
    k.fillRect(0, 0, W, H);
    k.globalCompositeOperation = "source-over";
    g.save();
    g.globalAlpha = alpha;
    g.globalCompositeOperation = op;
    g.drawImage(out, 0, 0);
    g.restore();
  };
  /** An image (a tree, a cart) size squares wide, turned, with a sun shadow; a plain blob when there's no art. */
  const img = (role, variant, x, y, size, rot = 0, shadow = 0) => {
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
  // FA's grass is dark for an overview: lift it toward a light green (Patrick chose this from four strengths)
  const grassLift = gb === "grass" && !winter;
  if (grassLift) { g.save(); g.globalCompositeOperation = "screen"; g.globalAlpha = 0.55; g.fillStyle = "rgb(75,88,30)"; g.fillRect(0, 0, W, H); g.restore(); }
  for (const a of items("surface", "trodden")) soft((k) => { poly(k, a.poly); k.fill(); }, tex(`surface.trodden.${s}`, 3), MAX_BLUR, 0.5);

  // Fields: each crop's texture, a field a shade lighter or darker than the next, a worn margin round each, then the
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
    // Under snow a field is mostly the snow round it: its own art shows only faintly
    soft((k) => { k.beginPath(); for (const f of list) fieldPath(k, f); k.fill("evenodd"); }, tex(`field.${crop}.${s}`, 4, Number(v)), winter ? 0.3 : 0.06, winter ? 0.45 : 1);
  }
  // The crop art is dark beside the grass: lift each crop toward its own colour (a screen), so a field reads as wheat,
  // hay or soil at a glance; snow needs none
  if (!winter) for (const [crop, [color, alpha, op]] of Object.entries(FIELD_LIFT)) {
    const these = fields.filter((f) => f.crop === crop);
    if (these.length) soft((k) => { k.beginPath(); for (const f of these) fieldPath(k, f); k.fill("evenodd"); }, color, 0.06, alpha, op);
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
    ploughed: winter ? ["rgba(70,78,92,0.24)", 0.07] : ["rgba(42,30,18,0.38)", 0.07],
    growing: ["rgba(36,48,18,0.24)", 0.05], ripe: ["rgba(90,66,24,0.24)", 0.05],
    stubble: winter ? ["rgba(110,100,84,0.2)", 0.04] : ["rgba(70,54,32,0.22)", 0.04],
  };
  // Cut hay lies in soft pale windrows, each with a little shadow on its north side
  const hay = fields.filter((f) => f.crop === "hay" && f.rows * pp >= 3);
  // One path for every windrow and one fill to trim them to their fields: a blurred mask costs a blur per drawing call
  const windrows = (dx, dy) => (k) => {
    k.beginPath();
    for (const f of hay) fieldPath(k, f);
    k.fill("evenodd");
    k.globalCompositeOperation = "source-in";
    k.lineWidth = 0.2 * pp; k.lineCap = "butt";
    k.beginPath();
    for (const f of hay) rowLines(k, f, (x) => X(x) + dx * pp, (y) => Y(y) + dy * pp);
    k.stroke();
    k.globalCompositeOperation = "source-over";
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
  const yards = items("surface", "yard");
  soft((k) => { for (const y of yards) { poly(k, y.poly); k.fill(); } }, tex(`surface.trodden.${s}`, 2.5), 0.25, 0.95);
  soft((k) => { for (const y of items("surface", "farmyard")) { poly(k, y.poly); k.fill(); } }, tex(`surface.trodden.${s}`, 2.5), 0.4, 0.8);
  // Lifted as the grass is, so yards don't read as dark patches on it
  if (grassLift) soft((k) => { for (const y of [...yards, ...items("surface", "farmyard")]) { poly(k, y.poly); k.fill(); } }, TRODDEN_LIFT, 0.4, 0.8, "screen");
  for (const y of yards.filter((y) => y.surface && y.surface !== "trodden")) {
    soft((k) => { poly(k, y.poly); k.fill(); }, tex(`surface.${y.surface}.${s}`, 2.5), 0.12, 0.55);
    soft((k) => { poly(k, y.poly); k.fill(); }, "rgb(160,150,138)", 0.12, 0.35, "multiply");
  }
  for (const y of yards.filter((y) => y.fence)) {
    g.save(); g.strokeStyle = "rgba(88,66,46,0.9)"; g.lineWidth = Math.max(1.5, pp * 0.05); g.setLineDash([pp * 0.14, pp * 0.06]); poly(g, y.poly); g.stroke(); g.setLineDash([]); g.restore();
  }
  // Parks: grass where the season shows it, then their paths (trodden or gravel), then a formal garden's basin
  for (const pk of items("surface", "park")) {
    if (s !== "winter") soft((k) => { poly(k, pk.poly); k.fill(); }, tex(`ground.grass.grassy`, 4), 0.4, 0.35);
    // Under snow every path is trodden snow
    for (const w of pk.paths ?? []) soft((k) => strokeLine(k, w.path, w.width), tex(s === "winter" ? "surface.trodden.winter" : `surface.${w.surface}.${s}`, 2.5), 0.06, w.surface === "gravel" ? 0.95 : 0.75);
    // A little darker, as a road's worn middle is, so a path shows on grass or snow alike
    soft((k) => { for (const w of pk.paths ?? []) strokeLine(k, w.path, w.width * 0.8); }, "rgb(150,142,132)", 0.08, s === "winter" ? 0.45 : 0.3, "multiply");
    if (pk.basin) {
      const { at, radius } = pk.basin;
      soft((k) => { k.beginPath(); k.arc(X(at[0]), Y(at[1]), (radius + 0.12) * pp, 0, 2 * Math.PI); k.fill(); }, tex(`stone.rough.${s}`, 0.8), 0.01, 1);
      soft((k) => { k.beginPath(); k.arc(X(at[0]), Y(at[1]), radius * pp, 0, 2 * Math.PI); k.fill(); }, tex(s === "winter" ? "water.ice" : "water.pond", 2), 0.01, 1);
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
  const walls = items("wall");
  soft((k) => { for (const w of walls) { k.save(); k.translate(pp * 0.03, -pp * 0.09); strokeLine(k, w.path, 0.2); k.restore(); } }, "rgb(30,40,58)", 0.08, 0.35);
  soft((k) => { for (const w of walls) strokeLine(k, w.path, 0.13); }, tex(`stone.rough.${s}`, 0.8), 0.01, 1);
  soft((k) => { for (const w of walls) strokeLine(k, w.path, 0.13); }, "rgb(88,84,80)", 0.01, 0.85, "multiply");
  if (s === "winter") soft((k) => { for (const w of walls) strokeLine(k, w.path, 0.04); }, "rgb(236,239,243)", 0.02, 0.6);
  for (const b of items("prop", "bush")) img(bushRole(s), b.variant, b.x, b.y, b.scale, b.rot, 0.18);

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
  soft((k) => { for (const w of ways) strokeLine(k, w.path, w.width + 0.7); }, tex(`surface.trodden.${s}`, 2.5), 0.25, 1);
  if (grassLift) soft((k) => { for (const w of ways) strokeLine(k, w.path, w.width + 0.7); }, TRODDEN_LIFT, 0.25, 0.45, "screen"); // no dark rim on the lifted grass
  for (const surf of new Set(ways.map((w) => w.surface)))
    soft((k) => { for (const w of ways.filter((w) => w.surface === surf)) strokeLine(k, w.path, w.width); }, tex(`surface.${surf}.${s}`, 2.5), 0.15, 0.95);
  // A darker worn middle: strong on snow and slush, lighter on summer dirt, which is dark enough already
  soft((k) => { for (const w of ways) strokeLine(k, w.path, w.width * (w.class === "highway" ? 0.85 : 0.7)); }, "rgb(118,108,96)", 0.2, s === "winter" ? 0.5 : 0.25, "multiply");
  soft((k) => {
    for (const w of ways) {
      if (w.ruts) for (const d of [-0.22, 0.22]) strokeLine(k, offsetPath(w.path, d), 0.07);
      else strokeLine(k, w.path, 0.06);
    }
  }, "rgb(70,62,54)", 0.03, 0.4, "multiply");

  // Squares
  progress(0.45, "Squares");
  for (const sq of items("surface", "square")) {
    soft((k) => { poly(k, sq.poly); k.fill(); }, tex(`surface.${sq.surface}.${s}`, 1.2), 0.12, 1);
    if (s === "winter") soft((k) => { poly(k, sq.poly); k.fill(); }, tex("overlay.snow", 2), 0.3, 0.35);
  }

  // Water: the bank, a dark edge, the water or ice, a cracked line, a darker core
  progress(0.5, "Water");
  for (const w of items("water")) {
    soft((k) => strokeLine(k, w.path, w.width + 0.95), tex(`stone.rough.${s}`, 2), 0.35, 0.8);
    soft((k) => strokeLine(k, w.path, w.width + 0.3), "rgb(48,62,80)", 0.12, 0.7);
    soft((k) => strokeLine(k, w.path, w.width), tex(w.frozen ? "water.ice" : `water.${w.class}`, 2.5), 0.06, 1);
    if (w.frozen) soft((k) => strokeLine(k, w.path, w.width * 0.48), tex("water.ice.cracked", 2), 0.2, 0.55);
    soft((k) => strokeLine(k, w.path, 0.25), "rgb(40,60,82)", 0.15, 0.35, "multiply");
  }

  // Crossings
  progress(0.55, "Crossings");
  for (const c of items("crossing")) {
    if (c.class === "ford") paintFord(c);
    else paintBridge(c);
  }

  function paintFord(c) {
    const [fx, fy] = c.at;
    const fa = (c.angle * Math.PI) / 180;
    const dir = wayDirectionAt(L, c.at); // the road running through the ford
    const along = (t) => [fx + dir[0] * t, fy + dir[1] * t];
    const el = (k, rx, ry) => { k.beginPath(); k.ellipse(X(fx), Y(fy), rx * pp, ry * pp, fa, 0, 7); k.fill(); };
    const rx = (c.width ?? 2) * 1.15, ry = rx * 0.54; // a 50 ft ford at 25 ft a square: 2.3 by 1.25 squares
    soft((k) => strokeLine(k, [along(-3.4), c.at, along(3.6)], 2.2), tex(`surface.trodden.${s}`, 2.5), 0.6, 0.35);
    soft((k) => el(k, rx, ry), "rgb(46,64,84)", 0.25, 0.92);
    soft((k) => el(k, rx * 0.83, ry * 0.76), tex("water.ice.cracked", 1.5), 0.3, 0.25);
    soft((k) => strokeLine(k, [along(-1.7), c.at, along(1.7)], 1.25), tex(`stone.rough.${s}`, 1.2), 0.2, 0.75);
    soft((k) => strokeLine(k, [along(-1.7), c.at, along(1.7)], 1.25), "rgb(120,104,86)", 0.2, 0.5, "multiply");
    soft((k) => strokeLine(k, [along(-1.3), c.at, along(1.3)], 0.55), "rgb(58,74,90)", 0.15, 0.45);
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

  // Buildings: shadows first, then roofs
  progress(0.6, "Roofs");
  const buildings = items("building");
  soft((k) => {
    for (const b of buildings) {
      const sh = 0.35 + 0.3 * (b.tall || 0);
      k.save(); k.translate(X(b.cx) + sh * 0.3 * pp, Y(b.cy) - sh * pp); k.rotate((b.rot * Math.PI) / 180);
      if (b.round) { k.beginPath(); k.arc(0, 0, (Math.min(b.len, b.dep) * pp) / 2, 0, 2 * Math.PI); k.fill(); }
      else k.fillRect((-b.len * pp) / 2, (-b.dep * pp) / 2, b.len * pp, b.dep * pp);
      k.restore();
    }
  }, "rgb(28,38,58)", 0.12, 0.45);
  const rs = (ROOF_SCALE * pp) / 50;
  const SUN = [0, 1]; // light from the south: slopes facing down the map are lit, those facing up are in shade
  for (const b of buildings) {
    const th = (b.rot * Math.PI) / 180, c = Math.cos(th), sn = Math.sin(th);
    const facets = roofFacets(b);
    g.save(); g.translate(X(b.cx), Y(b.cy)); g.rotate(th);
    const role = `roof.${b.roof}.${s}`;
    const im = art(role, b.variant);
    const flatIm = hasFlat(b) ? art(`roof.flat.${s}`, b.variant) : null;
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
      if (f.flat) fillTex(flatIm, 0, fallbackColor(`roof.flat.${s}`));
      else fillTex(im, f.eaveAngle, fallbackColor(role));
      shape(f.poly); g.fill();
      if (snow && (f.flat || !SNOWY_IN_WINTER.has(b.roof))) {
        const p = g.createPattern(snow, "repeat"); p.setTransform(new DOMMatrix().rotate(f.eaveAngle).scale((pp * 1.5) / snow.width));
        // A pale wash first, so a coloured roof reads as snowed on as much as the art that comes with snow
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
    // A flat roof's parapet: a low stone wall round its edge (not across a wing's join), casting a little shade inward
    if (facets.parapet) paintParapet(g, b, facets.parapet, pp, c, sn, s);
    // A mansard's skylight
    if (facets.skylight) paintSkylight(g, facets.skylight, pp, s);
    // The outline: only the eaves and verges, so a wing's roof joins its house's without a seam
    g.strokeStyle = "rgba(28,28,36,0.85)"; g.lineWidth = Math.max(1, pp * 0.035);
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

/** A ridge cap's colour: the roof's own colour, much paler. */
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
function paintParapet(g, b, { w, joined }, pp, c, sn, season) {
  const A = (b.len / 2) * pp, B = (b.dep / 2) * pp, W = w * pp;
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
  g.fillStyle = season === "winter" ? "rgb(226,230,235)" : "rgb(178,170,158)";
  for (const ed of edges) if (ed.on) g.fillRect(...ed.rect);
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
