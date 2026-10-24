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
    if (i.kind === "water") roles.add(`stone.rough.${s}`).add(i.frozen ? "water.ice" : `water.${i.class}`).add("water.ice.cracked");
    if (i.kind === "crossing") roles.add(`surface.trodden.${s}`).add(`stone.rough.${s}`).add("water.ice.cracked");
    if (i.kind === "wall") roles.add(`stone.rough.${s}`);
    if (i.kind === "building") {
      roles.add(`roof.${i.roof}.${s}`);
      if (s === "winter" && /^tile/.test(i.roof)) roles.add("overlay.snow");
      if (i.chimney) roles.add("chimney.stone");
    }
    if (i.kind === "tree") roles.add(i.species === "bare" ? `tree.bare.${s}` : `tree.conifer.${i.size ?? "large"}.${s}`);
    if (i.kind === "prop") roles.add(i.class === "bush" ? `bush.bare.${s}` : `prop.${i.class}`);
  }
  return [...roles];
}

/**
 * Paints the window [x0, y0] .. [x0 + W/pp, y0 + H/pp] of the map.
 * ctx: { g: the tile's 2d context, mask: a same-size scratch canvas, W, H (px), x0, y0 (squares), pp (px a square),
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
  /** Draw shapes blurred into the mask, fill the mask with a fill, lay it on the map. */
  const soft = (shape, fill, blur, alpha = 1, op = "source-over") => {
    q.setTransform(1, 0, 0, 1, 0, 0);
    q.globalCompositeOperation = "source-over";
    q.clearRect(0, 0, W, H);
    q.filter = blur ? `blur(${blur * pp}px)` : "none";
    q.fillStyle = "#000"; q.strokeStyle = "#000"; q.lineCap = "round"; q.lineJoin = "round";
    shape(q);
    q.filter = "none";
    q.globalCompositeOperation = "source-in";
    q.fillStyle = fill;
    q.fillRect(0, 0, W, H);
    g.save();
    g.globalAlpha = alpha;
    g.globalCompositeOperation = op;
    g.drawImage(mask, 0, 0);
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
  for (const a of items("surface", "trodden")) soft((k) => { poly(k, a.poly); k.fill(); }, tex(`surface.trodden.${s}`, 3), MAX_BLUR, 0.5);

  // Yards, farmyards, gardens
  progress(0.12, "Yards and gardens");
  const yards = items("surface", "yard");
  soft((k) => { for (const y of yards) { poly(k, y.poly); k.fill(); } }, tex(`surface.trodden.${s}`, 2.5), 0.25, 0.95);
  soft((k) => { for (const y of items("surface", "farmyard")) { poly(k, y.poly); k.fill(); } }, tex(`surface.trodden.${s}`, 2.5), 0.4, 0.8);
  for (const y of yards.filter((y) => y.surface && y.surface !== "trodden")) {
    soft((k) => { poly(k, y.poly); k.fill(); }, tex(`surface.${y.surface}.${s}`, 2.5), 0.12, 0.55);
    soft((k) => { poly(k, y.poly); k.fill(); }, "rgb(160,150,138)", 0.12, 0.35, "multiply");
  }
  for (const y of yards.filter((y) => y.fence)) {
    g.save(); g.strokeStyle = "rgba(88,66,46,0.9)"; g.lineWidth = Math.max(1.5, pp * 0.05); g.setLineDash([pp * 0.14, pp * 0.06]); poly(g, y.poly); g.stroke(); g.setLineDash([]); g.restore();
  }
  for (const gd of items("surface", "garden")) {
    const { cx, cy, w: gw, d: gdp, rot } = gd.garden;
    g.save(); g.translate(X(cx), Y(cy)); g.rotate((rot * Math.PI) / 180);
    const w = gw * pp, d = gdp * pp;
    g.fillStyle = tex(`ground.${gb}.light`, 3); g.fillRect(-w / 2, -d / 2, w, d);
    g.fillStyle = "rgba(120,135,155,0.08)"; g.fillRect(-w / 2, -d / 2, w, d);
    const rows = Math.max(3, Math.round(gdp / 0.22));
    for (let i = 1; i < rows; i++) {
      const yy = -d / 2 + (d * i) / rows;
      g.fillStyle = "rgba(70,85,105,0.2)"; g.fillRect(-w / 2 + pp * 0.08, yy - pp * 0.03, w - pp * 0.16, pp * 0.05);
      g.fillStyle = "rgba(255,255,255,0.5)"; g.fillRect(-w / 2 + pp * 0.08, yy + pp * 0.02, w - pp * 0.16, pp * 0.04);
    }
    g.strokeStyle = "rgba(92,70,50,0.8)"; g.lineWidth = Math.max(1, pp * 0.03); g.setLineDash([pp * 0.1, pp * 0.05]); g.strokeRect(-w / 2, -d / 2, w, d); g.setLineDash([]);
    g.restore();
  }

  // Walls and hedges
  progress(0.25, "Walls and hedges");
  const walls = items("wall");
  soft((k) => { for (const w of walls) { k.save(); k.translate(pp * 0.03, -pp * 0.09); strokeLine(k, w.path, 0.2); k.restore(); } }, "rgb(30,40,58)", 0.08, 0.35);
  soft((k) => { for (const w of walls) strokeLine(k, w.path, 0.13); }, tex(`stone.rough.${s}`, 0.8), 0.01, 1);
  soft((k) => { for (const w of walls) strokeLine(k, w.path, 0.13); }, "rgb(88,84,80)", 0.01, 0.85, "multiply");
  if (s === "winter") soft((k) => { for (const w of walls) strokeLine(k, w.path, 0.04); }, "rgb(236,239,243)", 0.02, 0.6);
  for (const b of items("prop", "bush")) img(`bush.bare.${s}`, b.variant, b.x, b.y, b.scale, b.rot, 0.18);

  // Roads and lanes: trodden verge, the surface, a darker core, ruts
  progress(0.35, "Roads");
  const ways = items("way");
  soft((k) => { for (const w of ways) strokeLine(k, w.path, w.width + 0.7); }, tex(`surface.trodden.${s}`, 2.5), 0.25, 1);
  for (const surf of new Set(ways.map((w) => w.surface)))
    soft((k) => { for (const w of ways.filter((w) => w.surface === surf)) strokeLine(k, w.path, w.width); }, tex(`surface.${surf}.${s}`, 2.5), 0.15, 0.95);
  soft((k) => { for (const w of ways) strokeLine(k, w.path, w.width * (w.class === "highway" ? 0.85 : 0.7)); }, "rgb(118,108,96)", 0.2, 0.5, "multiply");
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
      g.save(); g.translate(X(x), Y(y)); g.rotate(r.next() * 3);
      g.shadowColor = "rgba(20,30,48,0.55)"; g.shadowBlur = pp * 0.05; g.shadowOffsetY = -pp * 0.04;
      g.fillStyle = tex(`ground.${gb}`, 2);
      g.beginPath();
      const nv = 5 + Math.floor(r.next() * 3);
      for (let v = 0; v < nv; v++) { const a = (v / nv) * Math.PI * 2, rr2 = sz * (0.3 + r.next() * 0.25); v ? g.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2) : g.moveTo(Math.cos(a) * rr2, Math.sin(a) * rr2); }
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
      k.fillRect((-b.len * pp) / 2, (-b.dep * pp) / 2, b.len * pp, b.dep * pp); k.restore();
    }
  }, "rgb(28,38,58)", 0.12, 0.45);
  const rs = (ROOF_SCALE * pp) / 50;
  for (const b of buildings) {
    const len = b.len * pp, dep = b.dep * pp, th = (b.rot * Math.PI) / 180;
    g.save(); g.translate(X(b.cx), Y(b.cy)); g.rotate(th);
    const role = `roof.${b.roof}.${s}`;
    const im = art(role, b.variant);
    if (im) { const p = g.createPattern(im, "repeat"); p.setTransform(new DOMMatrix().scale((rs * 1200) / im.width)); g.fillStyle = p; }
    else g.fillStyle = fallbackColor(role);
    g.fillRect(-len / 2, -dep / 2, len, dep);
    if (s === "winter" && /^tile/.test(b.roof)) {
      const so = art("overlay.snow", 0);
      if (so) { const p = g.createPattern(so, "repeat"); p.setTransform(new DOMMatrix().scale((pp * 1.5) / so.width)); g.globalAlpha = 0.5; g.fillStyle = p; g.fillRect(-len / 2, -dep / 2, len, dep); g.globalAlpha = 1; }
    }
    // the slope facing away from the sun is darker
    const north = Math.cos(th) >= 0;
    const gr = g.createLinearGradient(0, -dep / 2, 0, dep / 2);
    const dark = "rgba(18,28,48,0.34)", mid = "rgba(18,28,48,0.2)", lit = "rgba(255,248,236,0.05)", clear = "rgba(255,248,236,0.0)";
    if (north) { gr.addColorStop(0, dark); gr.addColorStop(0.5, mid); gr.addColorStop(0.5, lit); gr.addColorStop(1, clear); }
    else { gr.addColorStop(0, clear); gr.addColorStop(0.5, lit); gr.addColorStop(0.5, mid); gr.addColorStop(1, dark); }
    g.fillStyle = gr; g.fillRect(-len / 2, -dep / 2, len, dep);
    g.fillStyle = s === "winter" ? "rgba(235,238,242,0.75)" : "rgba(60,50,40,0.5)";
    g.fillRect(-len / 2, -Math.max(1, pp * 0.03), len, Math.max(2, pp * 0.06));
    g.strokeStyle = "rgba(28,28,36,0.85)"; g.lineWidth = Math.max(1, pp * 0.035); g.strokeRect(-len / 2, -dep / 2, len, dep);
    if (b.chimney) {
      const ci = art("chimney.stone", b.chimney.variant);
      const cw = 0.3 * pp;
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
    const big = t.species === "bare" ? 2.0 : { large: 1.0, medium: 0.78, small: 0.55 }[t.size] ?? 1.0;
    const sz = big * t.s * 1.1;
    img(t.species === "bare" ? `tree.bare.${s}` : `tree.conifer.${t.size}.${s}`, t.variant, t.x, t.y, sz, t.rot, sz * 0.35);
  }

  // A light vignette over the whole map
  progress(0.95, "Finishing");
  const vg = g.createRadialGradient(X(MW / 2), Y(MH / 2), Math.min(MW, MH) * pp * 0.35, X(MW / 2), Y(MH / 2), Math.max(MW, MH) * pp * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(20,28,40,0.25)");
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

/** The unit direction of the way passing closest to a point (for a ford), or straight down. */
function wayDirectionAt(L, [x, y]) {
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
