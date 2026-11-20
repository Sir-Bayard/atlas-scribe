/**
 * Where a dressed map's pieces go: the compass rose, the scale bar and the cartouche with the map's name, each in one
 * of the emptiest corners; on an overland map with places, a key (the symbols the map uses, with the scale bar at its
 * foot and the compass beside it) in the emptiest corner and the cartouche in the next. The painter draws them from
 * here and an overland map's labels keep off them, so the two always agree. Pure. All sizes in squares (map units).
 */

/** What a key can list, in its order: places, then roads, then crossings; only those the map has are shown. */
export const KEY_ENTRIES = [
  { kind: "place", cls: "city", text: "City" }, { kind: "place", cls: "town", text: "Town" }, { kind: "place", cls: "village", text: "Village" },
  { kind: "place", cls: "hamlet", text: "Hamlet" }, { kind: "place", cls: "castle", text: "Castle" }, { kind: "place", cls: "tower", text: "Tower" },
  { kind: "place", cls: "temple", text: "Temple" }, { kind: "place", cls: "inn", text: "Inn" }, { kind: "place", cls: "mine", text: "Mine" },
  { kind: "place", cls: "ruin", text: "Ruin" },
  { kind: "way", cls: "highway", text: "Highway" }, { kind: "way", cls: "street", text: "Road" }, { kind: "way", cls: "track", text: "Track" },
  { kind: "crossing", cls: "bridge", text: "Bridge" }, { kind: "crossing", cls: "ford", text: "Ford" },
];
// (sizes in the dressing's unit: letters, a row, the symbol's column, the padding, the gap between the columns, the
// heading, the scale bar's part at the foot, and the inset from the map's edge)
const KEY = { font: 1.55, row: 2.9, mark: 4.2, pad: 1.6, gap: 2.2, head: 3.6, scale: 6.2, inset: 3, least: 22 };

/**
 * An overland map's key: { x, y, w, h (its box), unit, corner, heading: { x, y, font }, columns: [{ x, entries: [{ ...,
 * y }] }], scale: { y, ... as scaleBarOf }, compass: { x, y, R } }, or null when the map isn't dressed, isn't overland,
 * has its key or its places turned off, or has no places or roads to show.
 */
export function keyOf(L, { miles = true } = {}) {
  if (!L.dressing || !L.overland || L.legend === false || L.places === false || !(L.size?.squares?.[0] > 0)) return null;
  const items = L.items ?? [];
  const has = (kind, cls) => items.some((i) => i.kind === kind && (kind !== "way" ? i.class === cls : (cls === "street" ? !["highway", "track", "path"].includes(i.class) : cls === "track" ? i.class === "track" || i.class === "path" : i.class === cls)));
  const shown = KEY_ENTRIES.filter((e) => has(e.kind, e.cls));
  if (!shown.some((e) => e.kind === "place" || e.kind === "way")) return null;
  const [mw, mh] = L.size.squares;
  const { unit: u, corners } = cornersOf(L);
  // two columns: places, then roads and crossings (one column when either is empty)
  const places = shown.filter((e) => e.kind === "place"), lines = shown.filter((e) => e.kind !== "place");
  const cols = [places, lines].filter((l) => l.length);
  const colW = (list) => KEY.mark * u + Math.max(...list.map((e) => e.text.length)) * KEY.font * u * 0.56;
  const inner = Math.max(KEY.least * u, cols.reduce((t, l) => t + colW(l), 0) + (cols.length - 1) * KEY.gap * u);
  const rows = Math.max(...cols.map((l) => l.length));
  const w = inner + 2 * KEY.pad * u, h = KEY.pad * u + KEY.head * u + rows * KEY.row * u + u + KEY.scale * u + KEY.pad * u;
  // the corner: of the emptiest, the one whose key would cover fewest places, crossings and road bends (the key hides
  // what's under it)
  const marks = items.filter((i) => (i.kind === "place" || i.kind === "crossing") && Number.isFinite(i.x) && Number.isFinite(i.y));
  const bends = items.filter((i) => i.kind === "way" && Array.isArray(i.path)).flatMap((i) => i.path);
  const boxAt = (c) => { const wx = c.k.endsWith("w") ? KEY.inset * u : mw - KEY.inset * u - w, wy = c.k.startsWith("n") ? KEY.inset * u : mh - KEY.inset * u - h; return [wx, wy, wx + w, wy + h]; };
  const covers = (b) => 3 * marks.filter((m) => m.x > b[0] && m.x < b[2] && m.y > b[1] && m.y < b[3]).length + bends.filter((p) => p[0] > b[0] && p[0] < b[2] && p[1] > b[1] && p[1] < b[3]).length;
  const score = (k) => covers(boxAt(k)) + 4 * (k.n ?? 0);
  const c = corners.reduce((a, k) => (score(k) < score(a) ? k : a));
  const west = c.k.endsWith("w"), north = c.k.startsWith("n");
  const [x, y] = boxAt(c);
  const heading = { x: x + w / 2, y: y + KEY.pad * u + KEY.head * u * 0.5, font: 2.1 * u };
  let cx = x + KEY.pad * u;
  const columns = cols.map((list) => {
    const out = { x: cx, entries: list.map((e, k) => ({ ...e, y: y + KEY.pad * u + KEY.head * u + (k + 0.5) * KEY.row * u })) };
    cx += colW(list) + KEY.gap * u;
    return out;
  });
  // the scale bar at the foot: the biggest round length that fits inside
  const ft = L.size?.ftPerSquare ?? 25, per = miles ? ft / 5280 : ft;
  const want = Math.min((mw * per) / 5, (inner - 4 * u) * per), mag = 10 ** Math.floor(Math.log10(want)), nice = [10, 5, 2.5, 2, 1].map((m) => m * mag).find((v) => v <= want) ?? mag;
  const len = nice / per, barY = y + h - KEY.pad * u - 2.6 * u;
  const scale = { x: x + w / 2, y: barY, left: x + w / 2 - len / 2, len, h: 0.9 * u, nice, per, unit: u };
  // the compass beside it, toward the map's middle: over or under the key, or to its side, wherever it covers fewest
  // places and crossings (ties: over or under)
  const R = 5 * u, gapC = 1.2 * u;
  const spots = [
    { x: x + w / 2, y: north ? y + h + gapC + 1.43 * R : y - gapC - 1.05 * R },
    { x: west ? x + w + gapC + 1.05 * R : x - gapC - 1.05 * R, y: north ? y + 1.43 * R : y + h - 1.05 * R },
  ];
  const under = (c) => marks.filter((m) => m.x > c.x - 1.3 * R && m.x < c.x + 1.3 * R && m.y > c.y - 1.6 * R && m.y < c.y + 1.3 * R).length;
  const best = spots.reduce((a, c) => (under(c) < under(a) ? c : a));
  const compass = { x: best.x, y: best.y, R, unit: u };
  return { x, y, w, h, unit: u, corner: c.k, heading, columns, scale, compass };
}

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
  const key = keyOf(L);
  if (key) return key.compass;
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
  const key = keyOf(L, { miles });
  if (key) return { ...key.scale, inKey: true };
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
  const key = keyOf(L, { miles });
  if (key) out.push([key.x, key.y, key.x + key.w, key.y + key.h]);
  else {
    const s = scaleBarOf(L, { miles });
    // (its paper, and the line under it saying what a square is, which can be the wider: about 26 letters)
    const half = Math.max(s.len / 2 + s.unit * 2, (miles ? 26 : 22) * s.unit * 0.75 * 0.5 + s.unit);
    out.push([s.x - half, s.y - s.unit * 3.6, s.x + half, s.y + s.h + s.unit * 2.1]);
  }
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
  // (the third emptiest corner; with a key, which holds the compass and the scale bar together, the emptiest it left)
  const key = keyOf(L);
  const c = key ? corners.find((k) => k.k !== key.corner) : corners[2], x = c.cx + cw / 2, y = c.cy + ch / 2;
  // (a long name in smaller letters, so its box keeps to its corner)
  let font = unit * 3.2;
  const fit = (cw - unit * 11) / Math.max(1e-6, measure(name, font)); // (its padding, and clear of the frame each side)
  if (fit < 1) font *= fit;
  const w = measure(name, font) + unit * 6, h = unit * 6;
  return { x: x - w / 2, y: y - h / 2, w, h, font, unit };
}
