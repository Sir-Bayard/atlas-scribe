/**
 * Where a dressed map's pieces go: the compass rose, the scale bar and the cartouche with the map's name, each in one
 * of the emptiest corners. The painter draws them from here and an overland map's labels keep off them, so the two
 * always agree. Pure. All sizes in squares (map units).
 */

/**
 * The map's corners for its dressing, emptiest first (fewest buildings, roads and water there): the compass rose takes
 * the first, the scale bar the second and the cartouche with the map's name the third. unit: the dressing's own scale,
 * a hundredth of the map's shorter side; cw, ch: a corner's size.
 */
export function cornersOf(L) {
  const [mw, mh] = L.size?.squares ?? [0, 0];
  const unit = Math.min(mw, mh) / 100;
  const cw = mw * 0.24, ch = mh * 0.24;
  const busy = (cx, cy, w, h) => (L.items ?? []).filter((i) => (i.kind === "building" || i.kind === "way" || i.kind === "water") && [[i.cx ?? i.x ?? i.path?.[0]?.[0], i.cy ?? i.y ?? i.path?.[0]?.[1]]].some(([x, y]) => x > cx && x < cx + w && y > cy && y < cy + h)).length;
  // (an overland map's corners by how much land is in each: the dressing goes on the sea where it can)
  const byLand = Array.isArray(L.cornerLand) ? { nw: L.cornerLand[0], ne: L.cornerLand[1], sw: L.cornerLand[2], se: L.cornerLand[3] } : null;
  const corners = [["nw", 0, 0], ["ne", mw - cw, 0], ["sw", 0, mh - ch], ["se", mw - cw, mh - ch]].map(([k, cx, cy]) => ({ k, cx, cy, n: byLand ? byLand[k] : busy(cx, cy, cw, ch) })).sort((a, b) => a.n - b.n);
  return { unit, cw, ch, corners };
}

/** The compass rose: its middle and radius (its N stands above it, about 0.42 radius high). */
export function compassOf(L) {
  const [mw, mh] = L.size?.squares ?? [0, 0];
  const { unit, cw, ch, corners } = cornersOf(L);
  const c = corners[0], sx = c.cx + cw / 2, sy = c.cy + ch / 2;
  // (drawn in a little toward the middle, so its N clears the frame)
  return { x: sx + (mw / 2 - sx) * 0.12, y: sy + (mh / 2 - sy) * 0.12 + unit * 1.2, R: unit * 6.5, unit };
}

/**
 * The scale bar: about a fifth of the map across, in a round number of feet (or miles), five parts. Returns { x, y,
 * left, len, h, nice, per, unit }: its middle, left end, length and height, the round number it shows and the feet or
 * miles a square.
 */
export function scaleBarOf(L, { miles = false } = {}) {
  const [mw] = L.size?.squares ?? [0, 0];
  const ft = L.size?.ftPerSquare ?? 25;
  const { unit, cw, ch, corners } = cornersOf(L);
  const c = corners[1];
  const per = miles ? ft / 5280 : ft;
  // (the biggest round length up to a fifth of the map that fits its corner)
  const want = Math.min((mw * per) / 5, (cw - unit * 5) * per), mag = 10 ** Math.floor(Math.log10(want)), nice = [10, 5, 2.5, 2, 1].map((m) => m * mag).find((v) => v <= want) ?? mag;
  const len = nice / per, h = unit * 0.9;
  const x = Math.min(Math.max(c.cx + cw / 2, len / 2 + unit * 4.5), mw - len / 2 - unit * 4.5), y = c.cy + ch / 2;
  return { x, y, left: x - len / 2, len, h, nice, per, unit };
}

/**
 * The boxes a dressed map's pieces cover, [x0, y0, x1, y1] each: the compass rose with its N, the scale bar's paper and,
 * with a name, the cartouche (measured as `measure(text, fontSquares)` gives, else a fair guess at a serif's width).
 * pad: added on every side. None for a map that isn't dressed.
 */
export function dressingBoxes(L, { miles = false, measure = null, pad = 0 } = {}) {
  if (!L.dressing || !(L.size?.squares?.[0] > 0)) return [];
  const out = [];
  const k = compassOf(L);
  out.push([k.x - k.R * 1.05, k.y - k.R * 1.07 - k.R * 0.36, k.x + k.R * 1.05, k.y + k.R * 1.05]);
  const s = scaleBarOf(L, { miles });
  // (its paper, and the line under it saying what a square is, which can be the wider: about 26 letters)
  const half = Math.max(s.len / 2 + s.unit * 2, (miles ? 26 : 22) * s.unit * 0.75 * 0.5 + s.unit);
  out.push([s.x - half, s.y - s.unit * 3.6, s.x + half, s.y + s.h + s.unit * 2.1]);
  const t = titleBoxOf(L, measure ?? ((text, font) => text.length * font * 0.52));
  if (t) out.push([t.x, t.y, t.x + t.w, t.y + t.h]);
  return out.map((b) => [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad]);
}

/**
 * Where a dressed map's cartouche goes: { x, y, w, h, font, unit } in squares (x, y its top left; font the letters'
 * height), or null for a map that isn't dressed or has no name. measure(text, fontSquares): the text's width.
 */
export function titleBoxOf(L, measure) {
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
