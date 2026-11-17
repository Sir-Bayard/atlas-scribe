/**
 * The region style: a region map (layout/region.mjs) drawn as an old map on paper, needing no art. The country in
 * soft sage, water with inked shores and ripples along them, farmland in pale strips, woods as clustered trees, hills
 * as rounded humps and mountains as shaded peaks (snow on some), marshes as tufts of reeds, roads as lines (a track
 * dashed), and each place by a marker of its kind: a city's walled ring, a town's circle with a tower, a village's
 * dot, a castle's keep, a ruin's broken one. Its names are the plan's labels, placed by the window.
 */
import { PALETTE, SEASON } from "./palette.mjs";
import { hashAt } from "../../core/rng.mjs";

export const MAX_BLUR = 0.5;
export const rolesFor = () => [];

const rgb = ([r, g, b], a = 1) => (a === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`);
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

export function paint(ctx) {
  const { g, W, H, x0, y0, pp, layout: L, progress = () => {} } = ctx;
  const P = { ...PALETTE, ...(SEASON[L.season] ?? {}) };
  const winter = L.season === "winter";
  const seed = Number.isFinite(Number(L.seed)) ? Number(L.seed) : 1;
  const hash = (a, b, k = 0) => hashAt(a, b, k, seed);
  const X = (x) => (x - x0) * pp, Y = (y) => (y - y0) * pp;
  const items = (kind) => L.items.filter((i) => i.kind === kind);
  const path = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); };
  const poly = (pts) => { path(pts); g.closePath(); };
  const ink = rgb(P.ink, 0.85), inkW = Math.max(1, pp * 0.03);
  // (only what reaches this tile is drawn)
  const [tx1, ty1] = [x0 + W / pp, y0 + H / pp];
  const near = (x, y, r) => x + r >= x0 && y + r >= y0 && x - r <= tx1 && y - r <= ty1;
  g.lineCap = "round"; g.lineJoin = "round";

  // The country, and patches lighter and darker so no stretch reads flat
  progress(0.05, "The country");
  const land = mix(P.land, P.paper, 0.25);
  g.fillStyle = rgb(land); g.fillRect(0, 0, W, H);
  for (let gy = Math.floor(y0 / 6) * 6; gy < ty1 + 6; gy += 6) for (let gx = Math.floor(x0 / 6) * 6; gx < tx1 + 6; gx += 6) {
    const h = hash(gx, gy, 3);
    g.fillStyle = rgb(h > 0.5 ? mix(land, P.paper, 0.18) : mix(land, P.canopy, 0.08), 0.5);
    g.beginPath(); g.arc(X(gx + hash(gx, gy, 1) * 6), Y(gy + hash(gx, gy, 2) * 6), (3 + h * 4) * pp, 0, 2 * Math.PI); g.fill();
  }

  // Farmland: pale strips, each patch its own way
  for (const f of items("farmland")) {
    g.save(); poly(f.poly); g.clip();
    g.fillStyle = rgb(mix(land, [222, 206, 150], winter ? 0.15 : 0.45)); g.fill();
    const a = hash(f.poly[0][0], f.poly[0][1], 5) * Math.PI;
    g.strokeStyle = rgb(P.ink, 0.12); g.lineWidth = Math.max(1, pp * 0.04);
    const [cx, cy] = f.poly[0], R = 80;
    for (let t = -R; t <= R; t += 0.7) { g.beginPath(); g.moveTo(X(cx + Math.cos(a) * -R - Math.sin(a) * t), Y(cy + Math.sin(a) * -R + Math.cos(a) * t)); g.lineTo(X(cx + Math.cos(a) * R - Math.sin(a) * t), Y(cy + Math.sin(a) * R + Math.cos(a) * t)); g.stroke(); }
    g.restore();
    g.strokeStyle = rgb(P.ink, 0.25); g.lineWidth = inkW; poly(f.poly); g.stroke();
  }

  // Water: lakes and the sea with an inked shore and ripples inside it, then rivers
  progress(0.2, "Water");
  const water = rgb(winter ? P.water : P.water);
  for (const w of items("water").filter((x) => x.poly)) {
    g.fillStyle = water; poly(w.poly); g.fill();
    g.save(); poly(w.poly); g.clip();
    for (const [k, d] of [[1, 0.35], [2, 0.75]]) { g.strokeStyle = rgb(P.waterInk, 0.35 / k); g.lineWidth = Math.max(1, pp * 0.035); g.setLineDash([pp * 0.5, pp * 0.35]); g.lineDashOffset = k * pp * 0.3; poly(w.poly); g.lineWidth = Math.max(1, pp * 0.035) + d * pp * 2; g.stroke(); }
    g.setLineDash([]); g.restore();
    g.strokeStyle = rgb(P.waterInk, 0.9); g.lineWidth = inkW * 1.4; poly(w.poly); g.stroke();
  }
  for (const w of items("water").filter((x) => x.path)) {
    g.strokeStyle = rgb(P.waterInk, 0.9); g.lineWidth = Math.max(1.5, (w.width + 0.08) * pp); path(w.path); g.stroke();
    g.strokeStyle = water; g.lineWidth = Math.max(1, w.width * pp); path(w.path); g.stroke();
  }

  // Marshes: a damp tint, tufts of reeds
  for (const m of items("marsh")) { g.fillStyle = rgb(mix(land, P.water, 0.3), 0.6); poly(m.poly); g.fill(); }
  g.strokeStyle = rgb(P.canopyInk, 0.8); g.lineWidth = Math.max(1, pp * 0.03);
  for (const t of items("tuft")) {
    if (!near(t.x, t.y, 0.5)) continue;
    g.beginPath();
    for (const dx of [-0.18, 0, 0.18]) { g.moveTo(X(t.x + dx * 0.6), Y(t.y)); g.lineTo(X(t.x + dx), Y(t.y - 0.3 - Math.abs(dx))); }
    g.moveTo(X(t.x - 0.22), Y(t.y)); g.lineTo(X(t.x + 0.22), Y(t.y)); g.stroke();
  }

  // Roads: an inked edge and a pale middle; a track dashed
  progress(0.4, "Roads");
  for (const w of items("way")) {
    if (w.class === "track" || w.class === "path") {
      g.setLineDash([pp * 0.35, pp * 0.25]); g.strokeStyle = rgb(P.edge, 0.9); g.lineWidth = Math.max(1, w.width * pp); path(w.path); g.stroke(); g.setLineDash([]);
      continue;
    }
    g.strokeStyle = rgb(P.edge, 0.95); g.lineWidth = Math.max(1.5, (w.width + 0.08) * pp); path(w.path); g.stroke();
    g.strokeStyle = rgb(P.street); g.lineWidth = Math.max(1, w.width * pp); path(w.path); g.stroke();
  }

  // Hills and mountains, back to front: a hill a rounded hump shaded on its east; a mountain a peak, its east face
  // shaded, snow on its top on some
  progress(0.6, "Hills and mountains");
  const relief = [...items("hillock"), ...items("peak")].filter((r) => near(r.x, r.y, 2)).sort((a, b) => a.y - b.y);
  for (const r of relief) {
    const w = (r.kind === "peak" ? 1.1 : 0.9) * r.s, h = (r.kind === "peak" ? 1.0 : 0.38) * r.s;
    const bx = X(r.x), by = Y(r.y);
    if (r.kind === "hillock") {
      g.fillStyle = rgb(mix(land, P.paper, 0.2)); g.beginPath(); g.moveTo(bx - w * pp / 2, by); g.quadraticCurveTo(bx, by - h * 2 * pp, bx + w * pp / 2, by); g.closePath(); g.fill();
      g.fillStyle = rgb(P.ink, 0.12); g.beginPath(); g.moveTo(bx, by - h * pp); g.quadraticCurveTo(bx + w * pp * 0.3, by - h * 0.9 * pp, bx + w * pp / 2, by); g.lineTo(bx, by); g.closePath(); g.fill();
      g.strokeStyle = ink; g.lineWidth = inkW; g.beginPath(); g.moveTo(bx - w * pp / 2, by); g.quadraticCurveTo(bx, by - h * 2 * pp, bx + w * pp / 2, by); g.stroke();
      continue;
    }
    const top = [bx + w * pp * 0.06, by - h * pp];
    g.fillStyle = rgb(mix(land, P.stone, 0.7)); g.beginPath(); g.moveTo(bx - w * pp / 2, by); g.lineTo(...top); g.lineTo(bx + w * pp / 2, by); g.closePath(); g.fill();
    g.fillStyle = rgb(P.ink, 0.28); g.beginPath(); g.moveTo(...top); g.lineTo(bx + w * pp / 2, by); g.lineTo(bx + w * pp * 0.12, by); g.closePath(); g.fill();
    if (r.snow || winter) { g.fillStyle = rgb([246, 246, 244]); g.beginPath(); g.moveTo(...top); g.lineTo(top[0] - w * pp * 0.14, top[1] + h * pp * 0.3); g.lineTo(top[0] + w * pp * 0.05, top[1] + h * pp * 0.22); g.lineTo(top[0] + w * pp * 0.17, top[1] + h * pp * 0.32); g.closePath(); g.fill(); }
    g.strokeStyle = ink; g.lineWidth = inkW; g.beginPath(); g.moveTo(bx - w * pp / 2, by); g.lineTo(...top); g.lineTo(bx + w * pp / 2, by); g.stroke();
  }

  // Woods: their ground a little darker, then each tree a small round crown, back to front
  progress(0.75, "Woods");
  for (const f of items("forest")) { g.fillStyle = rgb(mix(land, P.canopy, 0.25), 0.6); poly(f.poly); g.fill(); }
  const crowns = items("forest").flatMap((f) => f.trees).filter(([x, y]) => near(x, y, 1)).sort((a, b) => a[1] - b[1]);
  for (const [x, y, s] of crowns) {
    const r = 0.36 * s * pp, c = winter ? mix(P.canopy, [220, 224, 226], 0.4) : mix(P.canopy, [140, 150, 90], hash(x, y, 9) * 0.4);
    g.fillStyle = rgb(P.ink, 0.18); g.beginPath(); g.arc(X(x) + r * 0.25, Y(y) + r * 0.2, r, 0, 2 * Math.PI); g.fill();
    g.fillStyle = rgb(c); g.beginPath(); g.arc(X(x), Y(y), r, 0, 2 * Math.PI); g.fill();
    g.strokeStyle = rgb(P.canopyInk, 0.9); g.lineWidth = Math.max(1, pp * 0.025); g.stroke();
  }

  // Places, each by a marker of its kind
  progress(0.9, "Places");
  for (const p of items("place")) {
    if (!near(p.x, p.y, 2)) continue;
    const x = X(p.x), y = Y(p.y), u = pp;
    g.lineWidth = inkW * 1.2; g.strokeStyle = ink;
    const disc = (r, fill) => { g.fillStyle = fill; g.beginPath(); g.arc(x, y, r * u, 0, 2 * Math.PI); g.fill(); g.stroke(); };
    const tower = (dx, dy, w, h) => { g.fillStyle = rgb(P.stone); g.fillRect(x + (dx - w / 2) * u, y + (dy - h) * u, w * u, h * u); g.strokeRect(x + (dx - w / 2) * u, y + (dy - h) * u, w * u, h * u); };
    if (p.class === "city") { disc(0.75, rgb(mix(P.urban, P.paper, 0.1))); g.beginPath(); g.arc(x, y, 0.55 * u, 0, 2 * Math.PI); g.stroke(); for (const a of [0, 1.57, 3.14, 4.71]) tower(Math.cos(a) * 0.62, Math.sin(a) * 0.62 + 0.15, 0.22, 0.3); disc(0.18, rgb(P.ink, 0.85)); }
    else if (p.class === "town") { disc(0.5, rgb(mix(P.urban, P.paper, 0.1))); tower(0, 0.05, 0.22, 0.42); }
    else if (p.class === "village") disc(0.3, rgb(P.ink, 0.85));
    else if (p.class === "hamlet") disc(0.18, rgb(P.ink, 0.85));
    else if (p.class === "castle") { tower(-0.28, 0.25, 0.22, 0.5); tower(0.28, 0.25, 0.22, 0.5); tower(0, 0.25, 0.4, 0.38); }
    else if (p.class === "ruin") { g.fillStyle = rgb(P.stone, 0.8); g.beginPath(); g.moveTo(x - 0.25 * u, y + 0.2 * u); g.lineTo(x - 0.25 * u, y - 0.25 * u); g.lineTo(x - 0.05 * u, y - 0.1 * u); g.lineTo(x + 0.1 * u, y - 0.32 * u); g.lineTo(x + 0.25 * u, y - 0.05 * u); g.lineTo(x + 0.25 * u, y + 0.2 * u); g.closePath(); g.fill(); g.stroke(); }
    else if (p.class === "tower") tower(0, 0.25, 0.22, 0.6);
    else if (p.class === "temple") { disc(0.3, rgb(P.paper)); g.beginPath(); g.moveTo(x, y - 0.22 * u); g.lineTo(x, y + 0.22 * u); g.moveTo(x - 0.14 * u, y - 0.06 * u); g.lineTo(x + 0.14 * u, y - 0.06 * u); g.stroke(); }
    else if (p.class === "inn") { disc(0.24, rgb([196, 150, 90])); }
    else if (p.class === "mine") { g.beginPath(); g.moveTo(x - 0.22 * u, y + 0.2 * u); g.lineTo(x + 0.22 * u, y - 0.2 * u); g.moveTo(x + 0.22 * u, y + 0.2 * u); g.lineTo(x - 0.22 * u, y - 0.2 * u); g.stroke(); }
    else disc(0.22, rgb(P.ink, 0.85));
  }
  progress(1, "Done");
}
