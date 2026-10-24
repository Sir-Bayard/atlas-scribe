/**
 * The "sketch" style: the preview. A Layout in plain map colours, with no art, no blur and no soft edges, so it
 * paints in a fraction of a second at a few px a square. It draws the same things the textured style does (the
 * roads, the water, every roof in its material's colour and form, the trees), so a preview shows what a full render
 * will put where. Numbers are in squares.
 *
 * paint(ctx) takes the same ctx as the other styles; art is never asked for.
 */
import { fallbackColor } from "../../core/roles.mjs";
import { roofFacets } from "../roofs.mjs";
import { wayDirectionAt } from "./textured.mjs";

/** No blur, so no tile margin. */
export const MAX_BLUR = 0;

/** A sketch needs no art. */
export const rolesFor = () => [];

/** "#rrggbb" or "rgb(...)" mixed toward [r, g, b] by k (0 to 1), as an rgb() colour. */
function mix(color, to, k) {
  const [r, g, b] = rgbOf(color).map((v, i) => Math.round(v + (to[i] - v) * k));
  return `rgb(${r},${g},${b})`;
}

export function paint(ctx) {
  const { g, W, H, x0, y0, pp, layout: L, progress = () => {} } = ctx;
  const s = L.season;
  const winter = s === "winter";
  const X = (x) => (x - x0) * pp, Y = (y) => (y - y0) * pp;
  const items = (kind, cls) => L.items.filter((i) => i.kind === kind && (cls === undefined || i.class === cls));
  const col = (role) => fallbackColor(role);
  const px = (sq, min = 1) => Math.max(min, sq * pp);
  const path = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); };
  const poly = (pts) => { path(pts); g.closePath(); };
  const fillPoly = (pts, fill) => { g.fillStyle = fill; poly(pts); g.fill(); };
  const stroke = (pts, width, color, min = 1) => { g.strokeStyle = color; g.lineWidth = px(width, min); path(pts); g.stroke(); };
  const dot = (x, y, r, fill) => { g.fillStyle = fill; g.beginPath(); g.arc(X(x), Y(y), Math.max(1, r * pp), 0, 2 * Math.PI); g.fill(); };
  g.lineCap = "round"; g.lineJoin = "round";

  // Ground, with its light and grassy patches as faint blobs
  progress(0.05, "Ground");
  const ground = L.items.find((i) => i.kind === "ground");
  const base = col(`ground.${ground?.base ?? "grass"}.${s}`);
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  const light = mix(base, [255, 255, 255], 0.03), dark = mix(base, [40, 50, 30], 0.025);
  for (const [x, y, r, t] of ground?.patches ?? []) {
    if (t < 0.45) dot(x, y, r, light);
    else if (t > 0.7) dot(x, y, r * 0.7, dark);
  }

  // Surfaces: trodden ground, yards, crofts, gardens, parks
  progress(0.2, "Yards and gardens");
  const trodden = col(`surface.trodden.${s}`);
  for (const a of items("surface", "trodden")) { g.globalAlpha = 0.5; fillPoly(a.poly, trodden); g.globalAlpha = 1; }
  for (const c of items("surface", "croft")) fillPoly(c.poly, winter ? "rgba(120,132,150,0.08)" : "rgba(110,135,60,0.15)"); // a tint, so what's under shows
  for (const y of [...items("surface", "yard"), ...items("surface", "farmyard")]) {
    fillPoly(y.poly, y.surface && y.surface !== "trodden" ? mix(col(`surface.${y.surface}.${s}`), [255, 255, 255], 0.15) : mix(trodden, rgbOf(base), 0.25));
    if (y.fence) { g.setLineDash([px(0.14, 2), px(0.06, 1)]); stroke(y.poly.concat([y.poly[0]]), 0.04, "rgb(110,84,58)"); g.setLineDash([]); }
  }
  for (const pk of items("surface", "park")) {
    fillPoly(pk.poly, winter ? mix(base, [200, 210, 220], 0.25) : mix(base, [120, 170, 70], 0.3)); // a green shows as a green
    stroke([...pk.poly, pk.poly[0]], 0.04, winter ? "rgba(120,130,140,0.5)" : "rgba(70,100,50,0.5)");
    for (const w of pk.paths ?? []) stroke(w.path, w.width, winter ? mix(trodden, [150, 142, 132], 0.3) : mix(col(`surface.${w.surface}.${s}`), [255, 255, 255], 0.1));
    if (pk.basin) {
      const { at, radius } = pk.basin;
      dot(at[0], at[1], radius + 0.12, col(`stone.rough.${s}`));
      dot(at[0], at[1], radius, col(winter ? "water.ice" : "water.pond"));
    }
  }

  // Gardens over parks, as the textured style lays them, so a formal garden's beds show
  for (const gd of items("surface", "garden")) {
    const { cx, cy, w, d, rot } = gd.garden;
    g.save(); g.translate(X(cx), Y(cy)); g.rotate((rot * Math.PI) / 180);
    g.fillStyle = winter ? "rgba(110,120,135,0.12)" : "rgba(105,85,55,0.25)";
    g.fillRect((-w / 2) * pp, (-d / 2) * pp, w * pp, d * pp);
    g.strokeStyle = "rgba(92,72,52,0.6)"; g.lineWidth = 1;
    g.strokeRect((-w / 2) * pp, (-d / 2) * pp, w * pp, d * pp);
    g.restore();
  }
  // Plot lines, walls, hedges and their bushes
  const boundColor = { fence: "rgba(110,84,58,0.7)", wall: "rgba(110,106,100,0.8)", hedge: "rgba(60,85,45,0.8)" };
  for (const b of items("boundary")) stroke(b.path, b.class === "hedge" ? 0.08 : 0.04, boundColor[b.class] ?? boundColor.fence);
  for (const w of items("wall")) stroke(w.path, 0.13, mix(col(`stone.rough.${s}`), [60, 60, 60], 0.2), 1.5);
  const bush = winter ? "rgb(104,98,90)" : mix(col("bush"), [30, 50, 25], 0.1);
  for (const b of items("prop", "bush")) dot(b.x, b.y, (b.scale ?? 0.5) * 0.45, bush);

  // Roads: a trodden verge, then the surface
  progress(0.4, "Roads");
  const ways = [...items("way")].sort((a, b) => b.width - a.width);
  for (const w of ways) stroke(w.path, w.width + 0.7, mix(trodden, [120, 110, 98], 0.15));
  for (const w of ways) stroke(w.path, w.width, winter ? mix(col(`surface.${w.surface}.${s}`), [225, 228, 232], 0.3) : col(`surface.${w.surface}.${s}`));
  for (const sq of items("surface", "square")) fillPoly(sq.poly, mix(col(`surface.${sq.surface}.${s}`), [255, 255, 255], winter ? 0.35 : 0.05));

  // Water and crossings
  progress(0.5, "Water");
  for (const w of items("water")) {
    stroke(w.path, w.width + 0.95, mix(col(`stone.rough.${s}`), [255, 255, 255], 0.1));
    stroke(w.path, w.width, col(w.frozen ? "water.ice" : `water.${w.class}`));
  }
  for (const c of items("crossing")) {
    const a = (c.angle * Math.PI) / 180, half = (c.length ?? 2) / 2;
    const [x, y] = c.at, dx = Math.cos(a) * half, dy = Math.sin(a) * half;
    if (c.class === "ford") {
      g.save(); g.fillStyle = mix(col("water.river"), [255, 255, 255], 0.3);
      g.beginPath(); g.ellipse(X(x), Y(y), (c.width ?? 2) * 1.15 * pp, (c.width ?? 2) * 0.62 * pp, a, 0, 2 * Math.PI); g.fill(); g.restore();
      const [ux, uy] = wayDirectionAt(L, c.at); // the stones run with the road through the ford, as in the textured style
      stroke([[x - ux * 1.7, y - uy * 1.7], [x + ux * 1.7, y + uy * 1.7]], 1.25, mix(trodden, [120, 104, 86], 0.4));
    } else {
      g.lineCap = "butt";
      stroke([[x - dx, y - dy], [x + dx, y + dy]], (c.width ?? 1) + 0.12, "rgb(60,42,28)", 2);
      stroke([[x - dx, y - dy], [x + dx, y + dy]], c.width ?? 1, "rgb(140,104,70)");
      g.lineCap = "round";
    }
  }

  // Buildings: a little shadow, then each roof facet in its material's colour, lit from the south
  progress(0.6, "Roofs");
  const buildings = items("building");
  g.fillStyle = "rgba(28,38,58,0.3)";
  for (const b of buildings) {
    const sh = 0.35 + 0.3 * (b.tall || 0); // as the textured style casts them
    g.save(); g.translate(X(b.cx) + sh * 0.3 * pp, Y(b.cy) - sh * pp); g.rotate((b.rot * Math.PI) / 180);
    if (b.round) { g.beginPath(); g.arc(0, 0, (Math.min(b.len, b.dep) * pp) / 2, 0, 2 * Math.PI); g.fill(); }
    else g.fillRect((-b.len * pp) / 2, (-b.dep * pp) / 2, b.len * pp, b.dep * pp);
    g.restore();
  }
  for (const b of buildings) {
    const th = (b.rot * Math.PI) / 180, c = Math.cos(th), sn = Math.sin(th);
    const facets = roofFacets(b);
    const roof = col(`roof.${b.roof}`), flat = col(`roof.flat.${s}`);
    g.save(); g.translate(X(b.cx), Y(b.cy)); g.rotate(th);
    const P = ([x, y]) => [x * pp, y * pp];
    const shape = (pts) => { g.beginPath(); pts.forEach((q, k) => { const [x, y] = P(q); k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); };
    const line = (a, b2) => { g.beginPath(); g.moveTo(...P(a)); g.lineTo(...P(b2)); g.stroke(); };
    for (const f of facets) {
      if (!f.poly.length) continue;
      const dy = f.down[0] * sn + f.down[1] * c; // facing south (down the map) is lit
      const lit = f.flat ? 0.35 : dy;
      let fill = f.flat ? flat : roof;
      if (winter) fill = mix(fill, [232, 237, 243], f.flat ? 0.85 : 0.55);
      g.fillStyle = lit >= 0 ? mix(fill, [255, 248, 236], 0.12 * lit) : mix(fill, [18, 28, 48], -0.3 * lit);
      shape(f.poly); g.fill();
    }
    g.strokeStyle = "rgba(28,28,36,0.45)"; g.lineWidth = 1;
    for (const cr of facets.creases) line(...cr.seg);
    if (facets.caps.length) {
      g.strokeStyle = winter ? "rgb(236,239,243)" : mix(roof, [225, 225, 225], 0.4); g.lineWidth = Math.max(1, pp * 0.04);
      for (const seg of facets.caps) line(...seg);
    }
    if (facets.parapet) {
      const w = facets.parapet.w * pp;
      g.strokeStyle = winter ? "rgb(226,230,235)" : "rgb(178,170,158)"; g.lineWidth = w;
      g.strokeRect((-b.len / 2) * pp + w / 2, (-b.dep / 2) * pp + w / 2, b.len * pp - w, b.dep * pp - w);
    }
    if (facets.skylight) {
      const { cx, cy, len, dep } = facets.skylight;
      g.fillStyle = "rgb(176,204,214)"; g.fillRect((cx - len / 2) * pp, (cy - dep / 2) * pp, len * pp, dep * pp);
    }
    g.strokeStyle = "rgba(28,28,36,0.85)"; g.lineWidth = Math.max(1, pp * 0.035);
    for (const f of facets) for (const [a, b2] of f.eaves) line(a, b2);
    if (facets.finial) { g.fillStyle = "rgb(70,62,54)"; g.beginPath(); g.arc(0, 0, Math.max(1.5, pp * 0.05), 0, 2 * Math.PI); g.fill(); }
    if (b.chimney) {
      const cw = Math.max(2, 0.3 * pp);
      g.fillStyle = col("chimney.stone");
      g.fillRect(b.len * pp * b.chimney.u - cw / 2, b.dep * pp * b.chimney.v - cw / 2, cw, cw);
    }
    g.restore();
  }

  // Props, then trees from north to south
  progress(0.8, "Trees");
  for (const p of items("prop").filter((p) => p.class !== "bush")) dot(p.x, p.y, 0.18 * (p.scale ?? 1), col(`prop.${p.class}`));
  // Sized as the textured style sizes them; leafy trees are crowns, and only in winter are they bare
  const crown = winter ? "rgb(88,104,84)" : col("tree"), leafy = winter ? crown : mix(col("tree"), [120, 150, 60], 0.25), bare = col("tree.bare");
  for (const t of [...items("tree")].sort((a, b) => a.y - b.y)) {
    const deciduous = t.species === "bare";
    const size = (deciduous ? 2.0 : { large: 1.0, medium: 0.78, small: 0.55 }[t.size] ?? 1.0) * (t.s ?? 1) * 1.1;
    const r = size * (deciduous ? 0.3 : 0.4);
    dot(t.x + r * 0.3, t.y - r * 0.3, r, "rgba(28,38,58,0.25)"); // shadow
    if (deciduous && winter) {
      g.strokeStyle = bare; g.lineWidth = Math.max(1, pp * 0.05);
      g.beginPath(); g.arc(X(t.x), Y(t.y), Math.max(1, r * pp), 0, 2 * Math.PI); g.stroke();
      dot(t.x, t.y, r * 0.2, bare);
    } else {
      const c = deciduous ? leafy : crown;
      dot(t.x, t.y, r, c);
      dot(t.x - r * 0.2, t.y + r * 0.2, r * 0.55, mix(c, [255, 255, 255], 0.12));
    }
  }
  progress(1, "Done");
}

/** [r, g, b] of "#rrggbb" or "rgb(...)"; mid grey for anything else. */
function rgbOf(color) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) { const n = parseInt(hex[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  const fn = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(color);
  return fn ? [+fn[1], +fn[2], +fn[3]] : [153, 153, 153];
}
