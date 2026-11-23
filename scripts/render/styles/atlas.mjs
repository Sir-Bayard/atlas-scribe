/**
 * Places, roads and crossings on an overland map as atlas markers: a red square
 * in a white box for a city, a red dot ringed in black for a town, a black dot for a village, a battlement mark for
 * a castle, and small marks for the rest; cased red highways, red roads with a pale edge, dashed tracks; )( ticks
 * either side of a road at a bridge, two dots at a ford. Sized by the picture's long side, so a map reads the same at
 * any picture size. Painting only.
 */
import { chaikin } from "../../core/land/raster.mjs";

const INK = "rgb(24,20,18)", PAPER = "rgb(252,246,232)", RED = [168, 40, 32], HIGH = [196, 64, 44];
const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/**
 * Draws one tile's roads, crossings and places. ctx: the style's (g, W, H, x0, y0, pp); layout: the layout (its way,
 * crossing and place items); rivers: the painted river lines in map units ([[x, y, t]...]), so a bridge sits where its
 * road crosses the river as drawn; outPx: the picture's long side in pixels.
 */
export function drawAtlas(ctx, layout, rivers, outPx) {
  const { ways, crossings } = preparedFor(layout, rivers);
  const items = layout.items ?? [];
  const { g, W, H, x0, y0, pp } = ctx;
  const u = outPx / 3600;
  const X = (x) => (x - x0) * pp, Y = (y) => (y - y0) * pp;
  const tx1 = x0 + W / pp, ty1 = y0 + H / pp;
  const pad = (40 * u) / pp + 0.5;
  const near = (pts) => { for (const [x, y] of pts) if (x >= x0 - pad && y >= y0 - pad && x <= tx1 + pad && y <= ty1 + pad) return true; return false; };
  const line = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); };
  g.save();
  g.lineCap = "round"; g.lineJoin = "round";
  // routes under the roads: sea lanes and ferries on the water, caravan routes and trails over the land
  // (by its box: a long straight leg can cross a tile with no point of it near)
  const boxNear = (pts) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, y] of pts) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); } return c >= x0 - pad && d >= y0 - pad && a <= tx1 + pad && b <= ty1 + pad; };
  for (const r of items) {
    if (r.kind !== "route" || !Array.isArray(r.path) || r.path.length < 2 || !boxNear(r.path)) continue;
    strokeRoute(g, r.class, u, () => line(r.path));
  }
  // roads, lowest class first, so a highway runs over a road where they meet
  for (const w of ways) {
    if (!near(w.line)) continue;
    strokeRoad(g, w.class, u, () => line(w.line));
  }
  // crossings: at the road's crossing with the river as drawn, nearest the crossing's own point
  for (const { c, at } of crossings) {
    if (!near([[at.x, at.y]])) continue;
    g.save(); g.translate(X(at.x), Y(at.y)); g.rotate(at.angle);
    crossingMark(g, c.class, at.cls, u);
    g.restore();
  }
  // places, smallest first so a city's mark is on top
  const ORDER = { hamlet: 0, inn: 0, mine: 0, ruin: 1, tower: 1, temple: 1, village: 2, castle: 3, town: 4, city: 5 }; // (points of interest: 0)
  const places = items.filter((i) => i.kind === "place").sort((a, b) => (ORDER[a.class] ?? 0) - (ORDER[b.class] ?? 0));
  // landmarks from the land (falls, passes, volcanoes...), under the places
  for (const lm of layout.landmarks ?? []) {
    if (!near([[lm.x, lm.y]])) continue;
    landmarkMark(g, X(lm.x), Y(lm.y), lm.kind, u);
  }
  for (const p of places) {
    if (!near([[p.x, p.y]])) continue;
    placeMark(g, X(p.x), Y(p.y), p.class, u);
    // (a port's anchor below and beside its mark)
    if (p.port) portMark(g, X(p.x) + 13 * u, Y(p.y) + 12 * u, u);
  }
  g.restore();
}

// (how far above a place's middle a realm's crown sits, by its mark's size; drawn with the realms: overland.mjs)
export const CROWN_LIFT = { city: 24, town: 20, village: 15, hamlet: 13, castle: 21 };

/** A capital's crown: three points on a band, gold with an ink edge, its middle at (x, y). Shared with the map's key. */
export function crownMark(g, x, y, u) {
  const s = u * 1.6;
  g.beginPath();
  g.moveTo(x - 8 * s, y + 4 * s); g.lineTo(x - 9 * s, y - 4 * s); g.lineTo(x - 4.5 * s, y); g.lineTo(x, y - 6 * s); g.lineTo(x + 4.5 * s, y); g.lineTo(x + 9 * s, y - 4 * s); g.lineTo(x + 8 * s, y + 4 * s); g.closePath();
  g.fillStyle = "rgba(214,168,52,1)"; g.fill();
  g.strokeStyle = INK; g.lineWidth = 1.5 * u; g.lineJoin = "round"; g.stroke();
}

/** Strokes a road of a class: path() builds the path (called once a pass). Shared with the map's key. */
export function strokeRoad(g, cls, u, path) {
  if (cls === "highway") {
    g.strokeStyle = "rgba(30,20,16,0.9)"; g.lineWidth = 7 * u; path(); g.stroke();
    g.strokeStyle = rgba(HIGH); g.lineWidth = 4 * u; path(); g.stroke();
  } else if (cls === "track" || cls === "path") {
    g.setLineDash([7 * u, 5 * u]); g.strokeStyle = "rgba(40,32,26,0.85)"; g.lineWidth = Math.max(1, 1.8 * u); path(); g.stroke(); g.setLineDash([]);
  } else {
    g.strokeStyle = "rgba(250,240,220,0.6)"; g.lineWidth = 5.5 * u; path(); g.stroke();
    g.strokeStyle = rgba(RED, 0.95); g.lineWidth = 3 * u; path(); g.stroke();
  }
}

/**
 * Strokes a route of a class (path() builds the path): a sea lane in long blue-gray dashes, a ferry in short dark
 * dashes, a caravan route in brown dashes and dots, a trail in fine dots. Shared with the map's key.
 */
export function strokeRoute(g, cls, u, path) {
  const STYLE = { "sea-lane": ["rgba(58,82,104,0.75)", 2.2, [14, 9]], ferry: ["rgba(36,40,48,0.9)", 2.2, [5, 4]], caravan: ["rgba(110,70,36,0.85)", 2.4, [12, 5, 2, 5]], trail: ["rgba(52,40,30,0.75)", 1.5, [1.5, 4.5]] };
  const [ink, w, dash] = STYLE[cls] ?? STYLE.trail;
  g.save();
  g.lineCap = "round";
  if (cls === "sea-lane" || cls === "ferry") { g.strokeStyle = "rgba(240,246,250,0.45)"; g.lineWidth = (w + 2.5) * u; g.setLineDash(dash.map((v) => v * u)); path(); g.stroke(); }
  g.strokeStyle = ink; g.lineWidth = Math.max(1, w * u); g.setLineDash(dash.map((v) => v * u)); path(); g.stroke();
  g.restore();
}

/** A port's anchor beside its place's mark, its middle at (x, y). Shared with the map's key. */
export function portMark(g, x, y, u) {
  const s = u * 1.15;
  g.save();
  g.strokeStyle = "rgba(250,246,236,0.9)"; g.lineWidth = 4.5 * s; g.lineCap = "round";
  const anchor = () => { g.beginPath(); g.moveTo(x, y - 6 * s); g.lineTo(x, y + 6 * s); g.moveTo(x - 4 * s, y - 3 * s); g.lineTo(x + 4 * s, y - 3 * s); g.moveTo(x - 6 * s, y + 2 * s); g.quadraticCurveTo(x - 5 * s, y + 7 * s, x, y + 7 * s); g.quadraticCurveTo(x + 5 * s, y + 7 * s, x + 6 * s, y + 2 * s); };
  anchor(); g.stroke();
  g.strokeStyle = "rgba(30,48,70,0.95)"; g.lineWidth = 1.8 * s; anchor(); g.stroke();
  g.beginPath(); g.arc(x, y - 7.5 * s, 1.7 * s, 0, 2 * Math.PI); g.stroke();
  g.restore();
}

/** A crossing's mark at the origin, along x: )( for a bridge, two dots for a ford, beside a road of class road. */
export function crossingMark(g, cls, road, u) {
  g.strokeStyle = INK;
  const w = (road === "highway" ? 7 : road === "track" ? 4 : 5) * u;
  if (cls === "ford") {
    g.fillStyle = INK; for (const s of [-1, 1]) { g.beginPath(); g.arc(0, s * (w + 2.5 * u), 1.6 * u, 0, 2 * Math.PI); g.fill(); }
  } else {
    const L = 9 * u; g.lineWidth = Math.max(1, 2 * u);
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(-L, s * (w + 3 * u)); g.quadraticCurveTo(0, s * w * 0.6, L, s * (w + 3 * u)); g.stroke(); }
  }
}

// (each layout's road lines and crossing spots, worked out once for all its tiles)
const PREPARED = new WeakMap();
function preparedFor(layout, rivers) {
  const hit = PREPARED.get(layout);
  if (hit && hit.rivers === rivers) return hit;
  const items = layout.items ?? [];
  const RANK = { path: 0, track: 0, lane: 1, street: 2, highway: 3 };
  const ways = items.filter((i) => i.kind === "way" && Array.isArray(i.path) && i.path.length >= 2).map((w) => ({ ...w, line: roadLine(w.path) }));
  ways.sort((a, b) => (RANK[a.class] ?? 1) - (RANK[b.class] ?? 1));
  const crossings = items.filter((i) => i.kind === "crossing").map((c) => ({ c, at: drawnCrossing(c, ways, rivers) ?? { x: c.x, y: c.y, angle: ((c.angle ?? 0) * Math.PI) / 180, cls: "street" } }));
  const out = { rivers, ways, crossings };
  PREPARED.set(layout, out);
  return out;
}

/**
 * A road as drawn: long straight runs broken into pieces about 0.7 units long with a small sideways wander (fixed by
 * where they are), then smoothed, so a road over flat land isn't ruled straight. Its ends stay where they are.
 */
export function roadLine(path) {
  const pts = [[path[0][0], path[0][1]]];
  for (let k = 1; k < path.length; k++) {
    const [ax, ay] = path[k - 1], [bx, by] = path[k];
    const dx = bx - ax, dy = by - ay, len = Math.sqrt(dx * dx + dy * dy);
    const m = Math.max(1, Math.round(len / 0.7));
    for (let q = 1; q < m; q++) {
      const t = q / m, hh = Math.sin((ax * 12.9898 + ay * 78.233 + q * 37.719) * 1.3) * 43758.5453, w = (hh - Math.floor(hh) - 0.5) * 0.12 * Math.min(1, len / m);
      pts.push([ax + dx * t - (dy / (len || 1)) * w, ay + dy * t + (dx / (len || 1)) * w]);
    }
    pts.push([bx, by]);
  }
  return chaikin(pts, 2);
}

/** One place's mark at (x, y) pixels. */
export function placeMark(g, x, y, cls, u) {
  g.lineWidth = 2.2 * u; g.strokeStyle = INK;
  const disc = (r, fill, ring = INK, rw = 2.2) => { g.fillStyle = fill; g.beginPath(); g.arc(x, y, r * u, 0, 2 * Math.PI); g.fill(); if (ring) { g.strokeStyle = ring; g.lineWidth = rw * u; g.stroke(); } };
  const battlement = (s, fill, edge) => {
    g.beginPath();
    g.moveTo(x - 10 * s, y + 8 * s); g.lineTo(x - 10 * s, y - 6 * s); g.lineTo(x - 6 * s, y - 6 * s); g.lineTo(x - 6 * s, y - 2 * s); g.lineTo(x - 2 * s, y - 2 * s); g.lineTo(x - 2 * s, y - 6 * s);
    g.lineTo(x + 2 * s, y - 6 * s); g.lineTo(x + 2 * s, y - 2 * s); g.lineTo(x + 6 * s, y - 2 * s); g.lineTo(x + 6 * s, y - 6 * s); g.lineTo(x + 10 * s, y - 6 * s); g.lineTo(x + 10 * s, y + 8 * s); g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    g.strokeStyle = edge; g.lineWidth = 1.6 * u; g.stroke();
  };
  if (cls === "city") {
    const a = 13 * u, b = 7.8 * u;
    g.fillStyle = PAPER; g.fillRect(x - a, y - a, 2 * a, 2 * a); g.strokeRect(x - a, y - a, 2 * a, 2 * a);
    g.fillStyle = rgba(RED); g.fillRect(x - b, y - b, 2 * b, 2 * b);
  } else if (cls === "town") disc(9.6, rgba(RED));
  else if (cls === "village") disc(5, INK, "rgba(252,246,232,0.8)", 1.6);
  else if (cls === "hamlet") disc(3.4, INK, "rgba(252,246,232,0.8)", 1.3);
  else if (cls === "castle") battlement(1.2 * u, INK, "rgba(252,246,232,0.8)");
  else if (cls === "ruin") { g.setLineDash([3 * u, 2.5 * u]); battlement(1.05 * u, "rgba(252,246,232,0.55)", INK); g.setLineDash([]); }
  else if (cls === "tower") {
    g.fillStyle = INK; g.fillRect(x - 4 * u, y - 10 * u, 8 * u, 18 * u);
    g.fillRect(x - 6 * u, y - 13 * u, 3 * u, 4 * u); g.fillRect(x - 1.5 * u, y - 13 * u, 3 * u, 4 * u); g.fillRect(x + 3 * u, y - 13 * u, 3 * u, 4 * u);
    g.strokeStyle = "rgba(252,246,232,0.8)"; g.lineWidth = 1.2 * u; g.strokeRect(x - 4 * u, y - 10 * u, 8 * u, 18 * u);
  } else if (cls === "temple") {
    disc(7, PAPER);
    g.strokeStyle = INK; g.lineWidth = 2 * u; g.beginPath(); g.moveTo(x, y - 4.5 * u); g.lineTo(x, y + 4.5 * u); g.moveTo(x - 3.2 * u, y - 1.2 * u); g.lineTo(x + 3.2 * u, y - 1.2 * u); g.stroke();
  } else if (cls === "inn") {
    g.fillStyle = INK; g.fillRect(x - 4.5 * u, y - 4.5 * u, 9 * u, 9 * u);
    g.strokeStyle = "rgba(252,246,232,0.8)"; g.lineWidth = 1.3 * u; g.strokeRect(x - 4.5 * u, y - 4.5 * u, 9 * u, 9 * u);
  } else if (cls === "mine") {
    g.strokeStyle = "rgba(252,246,232,0.8)"; g.lineWidth = 4.4 * u;
    const picks = () => { g.beginPath(); g.moveTo(x - 6 * u, y + 6 * u); g.lineTo(x + 6 * u, y - 6 * u); g.moveTo(x + 6 * u, y + 6 * u); g.lineTo(x - 6 * u, y - 6 * u); g.stroke(); };
    picks(); g.strokeStyle = INK; g.lineWidth = 2.2 * u; picks();
  } else if (SITE_MARK[cls]) siteMark(g, x, y, cls, u);
  else disc(4.4, INK, "rgba(252,246,232,0.8)", 1.4);
}

// (a landmark's mark, as a point of interest's: ink over a pale halo, some filled)
const LANDMARK = {
  // falling water: two chevrons
  falls: (g, x, y, u) => { for (const d of [-3, 2]) { g.moveTo(x - 6 * u, y + (d - 2) * u); g.lineTo(x, y + (d + 2) * u); g.lineTo(x + 6 * u, y + (d - 2) * u); } },
  // a pass between two slopes: )(
  pass: (g, x, y, u) => { g.moveTo(x - 7 * u, y - 7 * u); g.quadraticCurveTo(x - 2 * u, y, x - 7 * u, y + 7 * u); g.moveTo(x + 7 * u, y - 7 * u); g.quadraticCurveTo(x + 2 * u, y, x + 7 * u, y + 7 * u); },
  // a cone with smoke over it
  volcano: (g, x, y, u) => { g.moveTo(x - 9 * u, y + 6 * u); g.lineTo(x - 2.5 * u, y - 4 * u); g.lineTo(x + 2.5 * u, y - 4 * u); g.lineTo(x + 9 * u, y + 6 * u); g.closePath(); },
  // steam over a pool
  spring: (g, x, y, u) => { g.moveTo(x + 6 * u, y + 5 * u); g.ellipse(x, y + 5 * u, 6 * u, 2.5 * u, 0, 0, 2 * Math.PI); for (const d of [-3.5, 0, 3.5]) { g.moveTo(x + d * u, y + 1 * u); g.quadraticCurveTo(x + (d - 2) * u, y - 2.5 * u, x + d * u, y - 5 * u); g.quadraticCurveTo(x + (d + 2) * u, y - 7.5 * u, x + d * u, y - 10 * u); } },
  // a great tree: a crown on its trunk
  tree: (g, x, y, u) => { g.moveTo(x + 7 * u, y - 3 * u); g.arc(x, y - 3 * u, 7 * u, 0, 2 * Math.PI); g.moveTo(x - 1.6 * u, y + 3 * u); g.rect(x - 1.6 * u, y + 3 * u, 3.2 * u, 6 * u); },
  // rock pillars in the sea
  stacks: (g, x, y, u) => { for (const [d, t] of [[-5, 4], [0, 8], [5, 5]]) g.rect(x + (d - 1.5) * u, y + (4 - t) * u, 3 * u, t * u); },
  // a palm over a pool: its trunk bent, four fronds
  oasis: (g, x, y, u) => { g.moveTo(x + 6 * u, y + 7 * u); g.ellipse(x, y + 7 * u, 6 * u, 2 * u, 0, 0, 2 * Math.PI); g.moveTo(x - 1 * u, y + 6 * u); g.quadraticCurveTo(x + 2 * u, y, x, y - 5 * u); for (const [dx, dy] of [[-7, -2], [-4, -9], [4, -9], [7, -2]]) { g.moveTo(x, y - 5 * u); g.quadraticCurveTo(x + dx * 0.5 * u, y + (dy - 3) * u, x + dx * u, y + dy * u); } },
};
const LANDMARK_FILL = { volcano: "rgba(92,66,52,1)", tree: "rgba(36,64,34,1)", stacks: "rgba(110,98,86,1)" };
export function landmarkMark(g, x, y, kind, u0) {
  if (!LANDMARK[kind]) return;
  const u = u0 * SITE_SIZE, path = () => { g.beginPath(); LANDMARK[kind](g, x, y, u); };
  g.lineCap = "round"; g.lineJoin = "round";
  path(); g.strokeStyle = HALO; g.lineWidth = 4.4 * u; g.stroke();
  if (LANDMARK_FILL[kind]) { path(); g.fillStyle = LANDMARK_FILL[kind]; g.fill(); }
  path(); g.strokeStyle = kind === "falls" || kind === "spring" ? "rgba(40,90,130,1)" : INK; g.lineWidth = (LANDMARK_FILL[kind] ? 1.2 : 2) * u; g.stroke();
  if (kind === "volcano") {
    // (its smoke: a pale curl over the crater)
    g.beginPath(); g.moveTo(x, y - 5 * u); g.bezierCurveTo(x - 4 * u, y - 9 * u, x + 4 * u, y - 11 * u, x + 1 * u, y - 15 * u);
    g.strokeStyle = HALO; g.lineWidth = 3.4 * u; g.stroke(); g.strokeStyle = "rgba(90,86,82,0.9)"; g.lineWidth = 1.6 * u; g.stroke();
  }
}

// (a point of interest's mark: drawn in ink over a pale halo, as the mine's picks are)
const HALO = "rgba(252,246,232,0.82)";
const SITE_MARK = {
  // stepped cuts in a hillside
  quarry: (g, x, y, u) => { g.moveTo(x - 7 * u, y - 5 * u); g.lineTo(x - 7 * u, y + 5 * u); g.lineTo(x + 7 * u, y + 5 * u); g.lineTo(x + 7 * u, y + 1 * u); g.lineTo(x + 2 * u, y + 1 * u); g.lineTo(x + 2 * u, y - 2 * u); g.lineTo(x - 3 * u, y - 2 * u); g.lineTo(x - 3 * u, y - 5 * u); },
  // a bastioned square
  fort: (g, x, y, u) => { const a = 5 * u, b = 9 * u; g.moveTo(x, y - b); g.lineTo(x + a, y - a); g.lineTo(x + b, y); g.lineTo(x + a, y + a); g.lineTo(x, y + b); g.lineTo(x - a, y + a); g.lineTo(x - b, y); g.lineTo(x - a, y - a); g.closePath(); },
  // a house with a cross over it
  monastery: (g, x, y, u) => { g.rect(x - 6 * u, y - 2 * u, 12 * u, 8 * u); g.moveTo(x, y - 2 * u); g.lineTo(x, y - 11 * u); g.moveTo(x - 3 * u, y - 8 * u); g.lineTo(x + 3 * u, y - 8 * u); },
  // a tapered tower with its light
  lighthouse: (g, x, y, u) => { g.moveTo(x - 4 * u, y + 7 * u); g.lineTo(x - 2 * u, y - 5 * u); g.lineTo(x + 2 * u, y - 5 * u); g.lineTo(x + 4 * u, y + 7 * u); g.closePath(); g.moveTo(x - 9 * u, y - 9 * u); g.lineTo(x - 4 * u, y - 7 * u); g.moveTo(x + 9 * u, y - 9 * u); g.lineTo(x + 4 * u, y - 7 * u); g.moveTo(x, y - 13 * u); g.lineTo(x, y - 8 * u); },
  // a toll bar on its post
  customs: (g, x, y, u) => { g.moveTo(x - 7 * u, y + 6 * u); g.lineTo(x - 7 * u, y - 6 * u); g.moveTo(x - 7 * u, y - 3 * u); g.lineTo(x + 8 * u, y - 3 * u); g.moveTo(x - 2 * u, y - 5 * u); g.lineTo(x - 2 * u, y - 1 * u); g.moveTo(x + 3 * u, y - 5 * u); g.lineTo(x + 3 * u, y - 1 * u); },
  // crossed swords
  battlefield: (g, x, y, u) => { const s = 7 * u; g.moveTo(x - s, y + s); g.lineTo(x + s, y - s); g.moveTo(x + s, y + s); g.lineTo(x - s, y - s); g.moveTo(x - s + 1 * u, y + s - 5 * u); g.lineTo(x - s + 5 * u, y + s - 1 * u); g.moveTo(x + s - 1 * u, y + s - 5 * u); g.lineTo(x + s - 5 * u, y + s - 1 * u); },
  // a ring of standing stones
  stones: (g, x, y, u) => { for (let k = 0; k < 6; k++) { const a = (k / 6) * 2 * Math.PI, sx = x + 6.5 * u * Math.cos(a), sy = y + 5 * u * Math.sin(a); g.moveTo(sx, sy - 2 * u); g.lineTo(sx, sy + 2 * u); } },
  // a long mound
  barrow: (g, x, y, u) => { g.moveTo(x - 8 * u, y + 3 * u); g.quadraticCurveTo(x, y - 8 * u, x + 8 * u, y + 3 * u); g.closePath(); },
  // a hull on its side with a broken mast
  wreck: (g, x, y, u) => { g.moveTo(x - 8 * u, y); g.quadraticCurveTo(x, y + 9 * u, x + 8 * u, y - 2 * u); g.closePath(); g.moveTo(x - 1 * u, y + 2 * u); g.lineTo(x + 3 * u, y - 8 * u); g.lineTo(x + 6 * u, y - 6 * u); },
  // claw marks
  lair: (g, x, y, u) => { for (const d of [-4.5, 0, 4.5]) { g.moveTo(x + (d - 2) * u, y + 7 * u); g.quadraticCurveTo(x + (d + 3) * u, y, x + (d + 1) * u, y - 7 * u); } },
  // a cave's mouth
  cave: (g, x, y, u) => { g.moveTo(x - 8 * u, y + 5 * u); g.lineTo(x - 5 * u, y - 2 * u); g.quadraticCurveTo(x, y - 9 * u, x + 5 * u, y - 2 * u); g.lineTo(x + 8 * u, y + 5 * u); g.moveTo(x - 3 * u, y + 5 * u); g.quadraticCurveTo(x, y - 3 * u, x + 3 * u, y + 5 * u); },
  // three trees in a ring
  grove: (g, x, y, u) => { for (const [dx, dy] of [[-4.5, 2.5], [4.5, 2.5], [0, -4.5]]) { g.moveTo(x + (dx + 3) * u, y + dy * u); g.arc(x + dx * u, y + dy * u, 3 * u, 0, 2 * Math.PI); } },
  // a camp's tent
  camp: (g, x, y, u) => { g.moveTo(x - 8 * u, y + 6 * u); g.lineTo(x, y - 7 * u); g.lineTo(x + 8 * u, y + 6 * u); g.closePath(); g.moveTo(x, y - 7 * u); g.lineTo(x, y + 6 * u); },
  // an anchor
  cove: (g, x, y, u) => { g.moveTo(x, y - 8 * u); g.lineTo(x, y + 7 * u); g.moveTo(x - 4 * u, y - 4 * u); g.lineTo(x + 4 * u, y - 4 * u); g.moveTo(x - 7 * u, y + 1 * u); g.quadraticCurveTo(x - 6 * u, y + 7 * u, x, y + 7 * u); g.quadraticCurveTo(x + 6 * u, y + 7 * u, x + 7 * u, y + 1 * u); },
  // a serpent's coils
  monster: (g, x, y, u) => { g.moveTo(x - 10 * u, y + 3 * u); g.quadraticCurveTo(x - 7 * u, y - 6 * u, x - 4 * u, y + 2 * u); g.quadraticCurveTo(x - 1 * u, y + 8 * u, x + 2 * u, y); g.quadraticCurveTo(x + 5 * u, y - 7 * u, x + 8 * u, y - 1 * u); g.lineTo(x + 10 * u, y - 4 * u); },
};
// (marks drawn as solid shapes rather than lines)
const SITE_FILL = { fort: true, wreck: true, barrow: true, grove: "rgba(44,74,40,1)" };
// (drawn in lines, these read lighter than the solid marks, so a little larger)
const SITE_SIZE = 1.3;
function siteMark(g, x, y, cls, u0) {
  const u = u0 * SITE_SIZE;
  const path = () => { g.beginPath(); SITE_MARK[cls](g, x, y, u); };
  g.lineCap = "round"; g.lineJoin = "round";
  path(); g.strokeStyle = HALO; g.lineWidth = 4.4 * u; g.stroke();
  const fill = SITE_FILL[cls];
  if (fill) { path(); g.fillStyle = fill === true ? INK : fill; g.fill(); }
  path(); g.strokeStyle = INK; g.lineWidth = (fill ? 1.2 : 2) * u; g.stroke();
  if (cls === "fort") { g.beginPath(); g.arc(x, y, 2.2 * u, 0, 2 * Math.PI); g.fillStyle = HALO; g.fill(); }
}

/** Where a crossing's road meets a drawn river, near its own point: { x, y, angle (radians, along the road), cls }. */
function drawnCrossing(c, ways, rivers) {
  let best = null;
  const reach2 = 1.2 * 1.2;
  for (const w of ways) {
    const L = w.line;
    for (let m = 1; m < L.length; m++) {
      const a = L[m - 1], b = L[m];
      // (only segments near the crossing)
      if (Math.min(a[0], b[0]) > c.x + 1.2 || Math.max(a[0], b[0]) < c.x - 1.2 || Math.min(a[1], b[1]) > c.y + 1.2 || Math.max(a[1], b[1]) < c.y - 1.2) continue;
      for (const rv of rivers) for (let q = 1; q < rv.length; q++) {
        const p = rv[q - 1], s = rv[q];
        if (Math.min(p[0], s[0]) > c.x + 1.2 || Math.max(p[0], s[0]) < c.x - 1.2 || Math.min(p[1], s[1]) > c.y + 1.2 || Math.max(p[1], s[1]) < c.y - 1.2) continue;
        const hit = segHit(a, b, p, s);
        if (!hit) continue;
        const d2 = (hit[0] - c.x) ** 2 + (hit[1] - c.y) ** 2;
        if (d2 < reach2 && (!best || d2 < best.d2)) best = { x: hit[0], y: hit[1], angle: Math.atan2(b[1] - a[1], b[0] - a[0]), cls: w.class, d2 };
      }
    }
  }
  return best;
}

function segHit(a, b, c, d) {
  const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
  if (!den) return null;
  const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den, s = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
  return t >= 0 && t <= 1 && s >= 0 && s <= 1 ? [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] : null;
}
