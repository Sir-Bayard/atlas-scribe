/**
 * A dressed map's corners and its title: where the compass rose, the scale bar and the cartouche go (the emptiest
 * corners), and the cartouche with the map's name, painted as a tile of its own over the map so the GM can show it to
 * the players when ready.
 */
import { PALETTE, SEASON, INK } from "./palette.mjs";
import { titleBoxOf } from "../../core/dressing.mjs";

export { cornersOf } from "../../core/dressing.mjs";

/**
 * Where a dressed map's cartouche goes, for a tile of its own over the map (hidden until the GM shows it): { x, y, w, h,
 * font } in squares (x, y its top left; font the letters' height), or null for a map that isn't dressed or has no
 * name. measure(text, fontSquares): the text's width in squares, as the page will draw it.
 */
export function titleBox(L, measure) {
  return titleBoxOf(L, measure);
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
