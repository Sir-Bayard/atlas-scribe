/**
 * A dressed map's corners and its title: where the compass rose, the scale bar and the cartouche go (the emptiest
 * corners), and the cartouche with the map's name, painted as a tile of its own over the map so the GM can show it to
 * the players when ready.
 */
import { PALETTE, SEASON, INK } from "./palette.mjs";

/**
 * The map's corners for its dressing, emptiest first (fewest buildings, roads and water there): the compass rose takes
 * the first, the scale bar the second and the cartouche with the map's name the third. unit: the dressing's own scale,
 * a hundredth of the map's shorter side; cw, ch: a corner's size; all in squares.
 */
export function cornersOf(L) {
  const [mw, mh] = L.size?.squares ?? [0, 0];
  const unit = Math.min(mw, mh) / 100;
  const cw = mw * 0.24, ch = mh * 0.24;
  const busy = (cx, cy, w, h) => L.items.filter((i) => (i.kind === "building" || i.kind === "way" || i.kind === "water") && [[i.cx ?? i.x ?? i.path?.[0]?.[0], i.cy ?? i.y ?? i.path?.[0]?.[1]]].some(([x, y]) => x > cx && x < cx + w && y > cy && y < cy + h)).length;
  // (an overland map's corners by how much land is in each: the dressing goes on the sea where it can)
  const byLand = Array.isArray(L.cornerLand) ? { nw: L.cornerLand[0], ne: L.cornerLand[1], sw: L.cornerLand[2], se: L.cornerLand[3] } : null;
  const corners = [["nw", 0, 0], ["ne", mw - cw, 0], ["sw", 0, mh - ch], ["se", mw - cw, mh - ch]].map(([k, cx, cy]) => ({ k, cx, cy, n: byLand ? byLand[k] : busy(cx, cy, cw, ch) })).sort((a, b) => a.n - b.n);
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
  const P = L.style === "ink" ? INK : { ...PALETTE, ...(SEASON[L.season] ?? {}) };
  const ink = (a = 1) => `rgba(${P.ink.join(",")},${a})`, paper = (a = 1) => `rgba(${P.paper.join(",")},${a})`;
  const { w, h, unit, font } = box;
  g.fillStyle = paper(0.92); g.fillRect(0, 0, w * pp, h * pp);
  g.strokeStyle = ink(0.9); g.lineWidth = Math.max(1, pp * 0.06); g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w * pp - g.lineWidth, h * pp - g.lineWidth);
  g.lineWidth = Math.max(1, pp * 0.025); g.strokeRect(unit * 0.6 * pp, unit * 0.6 * pp, (w - unit * 1.2) * pp, (h - unit * 1.2) * pp);
  g.fillStyle = ink(0.92); g.font = `italic ${Math.max(4, Math.round(font * pp))}px serif`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(L.title, (w / 2) * pp, (h / 2 + unit * 0.2) * pp);
}
