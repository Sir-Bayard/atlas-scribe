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
  // roads, lowest class first, so a highway runs over a road where they meet
  for (const w of ways) {
    if (!near(w.line)) continue;
    if (w.class === "highway") {
      g.strokeStyle = "rgba(30,20,16,0.9)"; g.lineWidth = 7 * u; line(w.line); g.stroke();
      g.strokeStyle = rgba(HIGH); g.lineWidth = 4 * u; line(w.line); g.stroke();
    } else if (w.class === "track" || w.class === "path") {
      g.setLineDash([7 * u, 5 * u]); g.strokeStyle = "rgba(40,32,26,0.85)"; g.lineWidth = Math.max(1, 1.8 * u); line(w.line); g.stroke(); g.setLineDash([]);
    } else {
      g.strokeStyle = "rgba(250,240,220,0.6)"; g.lineWidth = 5.5 * u; line(w.line); g.stroke();
      g.strokeStyle = rgba(RED, 0.95); g.lineWidth = 3 * u; line(w.line); g.stroke();
    }
  }
  // crossings: at the road's crossing with the river as drawn, nearest the crossing's own point
  for (const { c, at } of crossings) {
    if (!near([[at.x, at.y]])) continue;
    g.save(); g.translate(X(at.x), Y(at.y)); g.rotate(at.angle); g.strokeStyle = INK;
    const w = (at.cls === "highway" ? 7 : at.cls === "track" ? 4 : 5) * u;
    if (c.class === "ford") {
      g.fillStyle = INK; for (const s of [-1, 1]) { g.beginPath(); g.arc(0, s * (w + 2.5 * u), 1.6 * u, 0, 2 * Math.PI); g.fill(); }
    } else {
      const L = 9 * u; g.lineWidth = Math.max(1, 2 * u);
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(-L, s * (w + 3 * u)); g.quadraticCurveTo(0, s * w * 0.6, L, s * (w + 3 * u)); g.stroke(); }
    }
    g.restore();
  }
  // places, smallest first so a city's mark is on top
  const ORDER = { hamlet: 0, inn: 0, mine: 0, ruin: 1, tower: 1, temple: 1, village: 2, castle: 3, town: 4, city: 5 };
  const places = items.filter((i) => i.kind === "place").sort((a, b) => (ORDER[a.class] ?? 1) - (ORDER[b.class] ?? 1));
  for (const p of places) {
    if (!near([[p.x, p.y]])) continue;
    placeMark(g, X(p.x), Y(p.y), p.class, u);
  }
  g.restore();
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
  } else disc(4.4, INK, "rgba(252,246,232,0.8)", 1.4);
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
