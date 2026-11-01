/**
 * The "sketch" style: the preview. A Layout in plain map colors, with no art, no blur and no soft edges, so it
 * paints in a fraction of a second at a few px a square. It draws the same things the textured style does (the
 * roads, the water, every roof in its material's color and form, the trees), so a preview shows what a full render
 * will put where. Numbers are in squares.
 *
 * paint(ctx) takes the same ctx as the other styles; art is never asked for.
 */
import { fallbackColor } from "../../core/roles.mjs";
import { roofFacets } from "../roofs.mjs";
import { wayDirectionAt, paintRows, tangentBand } from "./textured.mjs";

/** No blur, so no tile margin. */
export const MAX_BLUR = 0;

/** A sketch needs no art. */
export const rolesFor = () => [];

/** "#rrggbb" or "rgb(...)" mixed toward [r, g, b] by k (0 to 1), as an rgb() color. */
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

  // Surfaces: trodden ground, fields, yards, crofts, gardens, parks
  progress(0.2, "Yards and gardens");
  const trodden = col(`surface.trodden.${s}`);
  // A quarter's own ground: paving, dirt or lawns (under the trodden ground, fields, yards and parks on it)
  for (const qg of items("surface", "quarter")) {
    if (qg.lush) { if (!winter) fillPoly(qg.poly, "rgba(90,140,60,0.25)"); continue; }
    g.globalAlpha = (qg.alpha ?? 0.7) * 0.8; fillPoly(qg.poly, qg.mud ? mix(col(`surface.dirt.${s}`), [90, 70, 50], 0.3) : col(`surface.${qg.surface}.${s}`)); g.globalAlpha = 1;
  }
  for (const a of items("surface", "trodden")) { g.globalAlpha = 0.5; fillPoly(a.poly, trodden); g.globalAlpha = 1; }
  // Fields: each in its crop's color, a shade lighter or darker, with its rows
  for (const f of items("field")) {
    const c = col(`field.${f.crop}.${s}`);
    const ring = (pts) => { pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); };
    const outline = () => { g.beginPath(); ring(f.poly); for (const h of f.holes ?? []) ring(h); };
    g.fillStyle = f.shade >= 0 ? mix(c, [255, 255, 255], 0.07 * f.shade) : mix(c, [30, 30, 20], -0.1 * f.shade);
    outline(); g.fill("evenodd");
    if (f.rows > 0 && f.rows * pp >= 3) {
      g.save(); outline(); g.clip("evenodd");
      paintRows(g, f, X, Y, pp, f.crop === "hay" ? "rgba(235,222,170,0.5)" : winter ? "rgba(90,96,104,0.28)" : "rgba(40,32,20,0.16)", Math.max(1, pp * (f.crop === "hay" ? 0.12 : 0.05)));
      g.restore();
    }
  }
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

  // A landmark's lawns and its square
  for (const ln of [...items("surface", "lawn"), ...items("surface", "garth")]) if (!winter) fillPoly(ln.poly, "rgba(90,140,60,0.3)");
  for (const pz of items("surface", "plaza")) { fillPoly(pz.poly, mix(col(`surface.${pz.surface ?? "cobble"}.${s}`), [255, 255, 255], 0.05)); stroke([...pz.poly, pz.poly[0]], 0.04, "rgba(70,64,58,0.5)"); }
  for (const bd of items("surface", "bed")) fillPoly(bd.poly, winter ? "rgb(226,232,238)" : "rgb(120,160,80)");
  // A temple's yard, a little greener; a mansion's gravel drive
  for (const cy of items("surface", "churchyard")) fillPoly(cy.poly, winter ? "rgba(150,160,175,0.12)" : "rgba(80,120,60,0.18)");
  for (const dv of items("surface", "drive")) fillPoly(dv.poly, mix(col(`surface.gravel.${s}`), [255, 255, 255], 0.1));
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
  // Tanning and dyeing pits, and kilns
  const PIT = { tan: "rgb(92,66,38)", full: "rgb(150,156,142)", blue: "rgb(46,74,132)", red: "rgb(134,40,38)", yellow: "rgb(184,146,40)", green: "rgb(58,104,58)" };
  for (const pt of items("pit")) {
    g.save(); g.translate(X(pt.x), Y(pt.y)); g.rotate((pt.rot * Math.PI) / 180);
    const w = pt.size * pp;
    g.fillStyle = "rgb(88,70,52)"; g.fillRect(-w / 2, -w / 2, w, w);
    g.fillStyle = winter ? "rgb(214,220,226)" : PIT[pt.liquid] ?? PIT.tan; g.fillRect(-w * 0.38, -w * 0.38, w * 0.76, w * 0.76);
    g.restore();
  }
  for (const kl of items("kiln")) { dot(kl.x, kl.y, kl.rad, "rgb(150,86,64)"); dot(kl.x, kl.y, kl.rad * 0.42, "rgb(46,32,28)"); }
  // Crofts after gardens, as the textured style lays them: a tint, so what's under shows
  for (const c of items("surface", "croft")) fillPoly(c.poly, winter ? "rgba(120,132,150,0.08)" : "rgba(110,135,60,0.15)");
  // Plot lines, walls, hedges and their bushes
  const boundColor = { fence: "rgba(110,84,58,0.7)", wall: "rgba(110,106,100,0.8)", hedge: "rgba(60,85,45,0.8)", clipped: "rgb(44,74,36)", balk: winter ? "rgba(150,160,170,0.45)" : "rgba(118,140,78,0.75)" };
  const boundWidth = { hedge: 0.08, balk: 0.12, clipped: 0.16 };
  for (const b of items("boundary")) stroke(b.path, boundWidth[b.class] ?? 0.04, boundColor[b.class] ?? boundColor.fence);
  for (const w of items("wall").filter((w) => !w.thickness)) stroke(w.path, 0.13, mix(col(`stone.rough.${s}`), [60, 60, 60], 0.2), 1.5);
  const bush = winter ? "rgb(104,98,90)" : mix(col("bush"), [30, 50, 25], 0.1);
  for (const b of items("prop", "bush")) dot(b.x, b.y, (b.scale ?? 0.5) * 0.45, bush);

  // Ditches: a dark hollow, under the roads that cross them
  for (const d of items("ditch")) {
    stroke(d.path, d.width, winter ? mix(base, [160, 170, 182], 0.4) : mix(base, [70, 62, 42], 0.35));
    stroke(d.path, d.width * 0.45, winter ? mix(base, [130, 140, 152], 0.5) : mix(base, [50, 44, 30], 0.5));
  }

  // Roads: a trodden verge, then the surface
  progress(0.4, "Roads");
  // Tracks out to the fields: faint, with no verge
  for (const t of items("way").filter((w) => w.faint)) { g.globalAlpha = 0.5; stroke(t.path, t.width, winter ? mix(trodden, [150, 142, 132], 0.3) : trodden); g.globalAlpha = 1; }
  const ways = [...items("way")].filter((w) => !w.faint).sort((a, b) => b.width - a.width);
  for (const w of ways) stroke(w.path, w.width + 0.7, mix(trodden, [120, 110, 98], 0.15));
  for (const w of ways) stroke(w.path, w.width, winter ? mix(col(`surface.${w.surface}.${s}`), [225, 228, 232], 0.3) : col(`surface.${w.surface}.${s}`));
  for (const sq of items("surface", "square")) fillPoly(sq.poly, mix(col(`surface.${sq.surface}.${s}`), [255, 255, 255], winter ? 0.35 : 0.05));

  // Water and crossings
  progress(0.5, "Water");
  // Every bank and shore, then the water, so where a stream or moat opens into a river (or a river into a lake or the
  // sea) no bank runs across its mouth
  const runs = items("water").filter((w) => w.path), lakes = items("water").filter((w) => w.poly);
  // A stream's or river's line: stroked at its width, or (where its width varies) a round end at each point and a
  // band between each two, all wound the same way so the fill has no gaps
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
  for (const w of runs) line(w, 0.95, mix(col(`stone.rough.${s}`), [255, 255, 255], 0.1));
  for (const b of lakes) for (const r of b.runs ?? [b.ring]) stroke(r, b.reach * 2, col(`shore.${b.shore}.${s}`));
  for (const w of runs) line(w, 0, col(w.frozen ? "water.ice" : `water.${w.class}`));
  for (const b of lakes) {
    fillPoly(b.poly, col(b.frozen ? "water.ice" : `water.${b.class}`));
    // Lighter in the shallows
    g.save(); poly(b.poly); g.clip(); stroke(b.ring, b.class === "sea" ? 2 : 1, mix(col(b.frozen ? "water.ice" : `water.${b.class}`), [255, 255, 255], b.frozen ? 0.25 : 0.15)); g.restore();
  }
  for (const p of items("lily")) dot(p.x, p.y, p.s * 0.35, "rgb(86,122,62)");
  for (const c of items("crossing")) {
    const a = (c.angle * Math.PI) / 180, half = (c.length ?? 2) / 2;
    const [x, y] = c.at, dx = Math.cos(a) * half, dy = Math.sin(a) * half;
    if (c.class === "ford") {
      g.save(); g.fillStyle = mix(col("water.river"), [255, 255, 255], 0.3);
      g.beginPath(); g.ellipse(X(x), Y(y), (c.width ?? 2) * 1.15 * pp, (c.width ?? 2) * 0.62 * pp, a, 0, 2 * Math.PI); g.fill(); g.restore();
      const [ux, uy] = c.dir ?? wayDirectionAt(L, c.at); // the stones run with the road through the ford, as in the textured style
      stroke([[x - ux * 1.7, y - uy * 1.7], [x + ux * 1.7, y + uy * 1.7]], 1.25, mix(trodden, [120, 104, 86], 0.4));
    } else {
      g.lineCap = "butt";
      stroke([[x - dx, y - dy], [x + dx, y + dy]], (c.width ?? 1) + 0.12, "rgb(60,42,28)", 2);
      stroke([[x - dx, y - dy], [x + dx, y + dy]], c.width ?? 1, "rgb(140,104,70)");
      g.lineCap = "round";
    }
  }

  // Docks: a quay's paving from the water's edge back, or a pier's deck out into the water; then the reeds
  for (const d of items("dock")) {
    const deck = d.material === "wood" ? "rgb(128,96,64)" : mix(col("dock"), [255, 255, 255], 0.1);
    if (d.edge) { fillPoly([...d.edge, ...[...d.land].reverse()], deck); stroke(d.edge, 0.05, "rgb(50,46,44)"); continue; }
    g.lineCap = "butt";
    stroke(d.path, d.width + 0.08, "rgb(56,48,40)", 2);
    stroke(d.path, d.width, deck);
    g.lineCap = "round";
  }
  for (const t of items("reed")) dot(t.x, t.y, t.s * 0.22, "rgb(104,92,58)");

  // Town walls and palisades: a shadow, the wall, its walk along the top and battlements along its outer face (the
  // towers are buildings, drawn with the roofs)
  for (const w of items("wall").filter((w) => w.thickness)) {
    const T = w.thickness;
    const sh = 0.35 + 0.3 * (w.tall ?? 0); // as a building's
    g.save(); g.translate(sh * 0.3 * pp, -sh * pp); stroke(w.path, T, "rgba(28,38,58,0.3)"); g.restore();
    if (w.class === "palisade") {
      stroke(w.path, T * 0.9, "rgb(52,38,26)");
      g.setLineDash([0.001, px(T * 0.95)]); stroke(w.path, T * 0.85, winter ? "rgb(170,150,126)" : "rgb(132,100,66)"); g.setLineDash([]);
      continue;
    }
    g.lineCap = "butt";
    stroke(w.path, T + 0.05, "rgb(52,50,50)");
    stroke(w.path, T, mix(col(`stone.rough.${s}`), [70, 68, 66], 0.35));
    stroke(w.path, T * 0.55, winter ? "rgb(218,223,230)" : mix(col("wall.walk"), [255, 250, 240], 0.1));
    if (w.face) { g.setLineDash([px(0.1, 2), px(0.1, 2)]); stroke(w.face, Math.min(0.08, T * 0.3), "rgb(60,58,56)"); g.setLineDash([]); }
    g.lineCap = "round";
  }

  // Buildings: a little shadow, then each roof facet in its material's color, lit from the south
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
    const roof = col(`roof.${b.roof}`), flat = b.flatRoof === "wood" ? mix(col("roof.wood-shingle-dark"), [150, 120, 90], 0.3) : col(`roof.flat.${s}`);
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
      const A = (b.len / 2) * pp, B = (b.dep / 2) * pp, { joined, round, R, crenels } = facets.parapet;
      const stone = b.flatRoof === "wood" ? "rgb(96,72,50)" : winter ? "rgb(226,230,235)" : "rgb(178,170,158)";
      g.fillStyle = stone; g.strokeStyle = stone;
      if (round) { g.lineWidth = w; g.beginPath(); g.arc(0, 0, R * pp - w / 2, 0, 2 * Math.PI); g.stroke(); }
      else {
        g.fillRect(-A, -B, 2 * A, w); g.fillRect(-A, B - w, 2 * A, w); // a wing's joined ends are left open
        if (!joined.start) g.fillRect(-A, -B, w, 2 * B);
        if (!joined.end) g.fillRect(A - w, -B, w, 2 * B);
      }
      if (crenels) {
        // Battlements: the gaps between merlons, as dark notches in the parapet
        g.strokeStyle = "rgba(40,38,40,0.8)"; g.lineWidth = Math.max(1, w * 0.5);
        g.setLineDash([Math.max(1, w * 0.9), Math.max(1, w * 0.9)]);
        g.beginPath();
        if (round) g.arc(0, 0, R * pp - w / 2, 0, 2 * Math.PI);
        else g.rect(-A + w / 2, -B + w / 2, 2 * A - w, 2 * B - w);
        g.stroke(); g.setLineDash([]);
      }
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
  for (const p of items("prop").filter((p) => p.class === "fountain")) { const rad = (0.45 * (p.scale ?? 1)) / 2; dot(p.x, p.y, rad + 0.08, col(`stone.rough.${s}`)); dot(p.x, p.y, rad * 0.85, col(winter ? "water.ice" : "water.pond")); }
  for (const p of items("prop").filter((p) => p.class !== "bush" && p.class !== "fountain")) dot(p.x, p.y, 0.18 * (p.scale ?? 1), col(`prop.${p.class}`));
  // Sized as the textured style sizes them; leafy trees are crowns, and only in winter are they bare
  const crown = winter ? "rgb(88,104,84)" : col("tree"), leafy = winter ? crown : mix(col("tree"), [120, 150, 60], 0.25), bare = col("tree.bare");
  for (const t of [...items("tree")].sort((a, b) => a.y - b.y)) {
    const deciduous = t.species === "bare";
    // Sized as the textured style draws them: a bare winter tree's art spreads wider than one in leaf
    const size = (deciduous ? (winter ? 2.0 : 2.2) : { large: 1.0, medium: 0.78, small: 0.55 }[t.size] ?? 1.0) * (t.s ?? 1) * 1.1;
    const r = size * (deciduous ? (winter ? 0.3 : 0.36) : 0.4);
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
  // Smoke from forges, kilns and ovens, drifting with the wind
  const SMOKE = { dark: "rgb(70,70,72)", gray: "rgb(150,150,150)", light: "rgb(226,226,222)", green: "rgb(150,200,140)", violet: "rgb(180,150,215)" };
  for (const sm of items("smoke")) {
    const a = ((sm.wind ?? 0) * Math.PI) / 180, size = 1.8 * (sm.s ?? 1);
    for (let k = 0; k < 4; k++) {
      g.globalAlpha = 0.45 - k * 0.09;
      const d = size * (0.15 + k * 0.45);
      dot(sm.x + Math.cos(a) * d, sm.y + Math.sin(a) * d, size * (0.18 + k * 0.1), SMOKE[sm.tint] ?? SMOKE.gray);
    }
    g.globalAlpha = 1;
  }
  progress(1, "Done");
}

/** [r, g, b] of "#rrggbb" or "rgb(...)"; mid gray for anything else. */
function rgbOf(color) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) { const n = parseInt(hex[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  const fn = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(color);
  return fn ? [+fn[1], +fn[2], +fn[3]] : [153, 153, 153];
}
