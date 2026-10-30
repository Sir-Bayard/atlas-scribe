/**
 * Geometry on plain arrays: a point is [x, y], a path or polygon is a list of points. Units are whatever the
 * caller uses (plan squares). Pure: runs in the worker, on the page and under node.
 */

export const DEG = Math.PI / 180;

/** A plan shape (polygon array, { rect }, { circle }, { ellipse }) as a polygon, turned by rot degrees about its centre. */
export function shapeToPolygon(shape, rot = 0, segments = 32) {
  let pts;
  if (Array.isArray(shape)) pts = shape.map((p) => [p[0], p[1]]);
  else if (shape?.rect) {
    const [x0, y0, x1, y1] = shape.rect;
    pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  } else if (shape?.circle) {
    const [cx, cy, r] = shape.circle;
    pts = ellipsePoints(cx, cy, r, r, segments);
  } else if (shape?.ellipse) {
    const [cx, cy, rx, ry] = shape.ellipse;
    pts = ellipsePoints(cx, cy, rx, ry, segments);
  } else return [];
  if (!rot) return pts;
  const [cx, cy] = centroidOfBox(pts);
  return pts.map((p) => rotateAbout(p, [cx, cy], rot));
}

function ellipsePoints(cx, cy, rx, ry, n) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
  });
}

export function rotateAbout([x, y], [cx, cy], deg) {
  const a = deg * DEG, c = Math.cos(a), s = Math.sin(a);
  const dx = x - cx, dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

/** [x0, y0, x1, y1] around a list of points. */
export function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

function centroidOfBox(pts) {
  const [x0, y0, x1, y1] = bbox(pts);
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

/** True when a point is inside a polygon (even-odd rule). */
export function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Shortest distance from a point to a path (a polyline). */
export function distanceToPath([x, y], path) {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i], [bx, by] = path[i + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    const d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
    if (d < best) best = d;
  }
  return best;
}

/** True when segments ab and cd cross or touch. */
export function segmentsIntersect(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const on = (p, q, r) => Math.min(p[0], r[0]) <= q[0] && q[0] <= Math.max(p[0], r[0]) && Math.min(p[1], r[1]) <= q[1] && q[1] <= Math.max(p[1], r[1]);
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && on(a, c, b)) || (o2 === 0 && on(a, d, b)) || (o3 === 0 && on(c, a, d)) || (o4 === 0 && on(c, b, d));
}

/** True when a polygon's sides cross each other (a bow-tie), or two of its corners are the same point. */
export function polygonCrossesItself(poly) {
  const n = poly?.length ?? 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (Math.hypot(poly[i][0] - poly[j][0], poly[i][1] - poly[j][1]) < 1e-9) return true;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // sides that meet at a corner
      if (segmentsIntersect(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** True when a path crosses or runs inside a polygon. */
export function pathTouchesPolygon(path, poly) {
  if (path.some((p) => pointInPolygon(p, poly))) return true;
  for (let i = 0; i < path.length - 1; i++)
    for (let j = 0, k = poly.length - 1; j < poly.length; k = j++)
      if (segmentsIntersect(path[i], path[i + 1], poly[k], poly[j])) return true;
  return false;
}

/** True when two polygons overlap (an edge crosses, or one holds a corner of the other). */
export function polygonsOverlap(a, b) {
  const [ax0, ay0, ax1, ay1] = bbox(a), [bx0, by0, bx1, by1] = bbox(b);
  if (ax1 < bx0 || bx1 < ax0 || ay1 < by0 || by1 < ay0) return false;
  for (let i = 0, k = a.length - 1; i < a.length; k = i++)
    for (let j = 0, m = b.length - 1; j < b.length; m = j++)
      if (segmentsIntersect(a[k], a[i], b[m], b[j])) return true;
  return pointInPolygon(a[0], b) || pointInPolygon(b[0], a);
}

/** Length of a path. */
export function pathLength(path) {
  let n = 0;
  for (let i = 0; i < path.length - 1; i++) n += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
  return n;
}

/** A point well inside a polygon: its middle if that's inside, else the inside point farthest from its edge (on a grid). */
export function insidePoint(poly) {
  const c = poly.reduce((a, q) => [a[0] + q[0] / poly.length, a[1] + q[1] / poly.length], [0, 0]);
  if (pointInPolygon(c, poly)) return c;
  const [x0, y0, x1, y1] = bbox(poly);
  const ring = [...poly, poly[0]];
  let best = null;
  for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) {
    const p = [x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * j) / 12];
    if (!pointInPolygon(p, poly)) continue;
    const d = distanceToPath(p, ring);
    if (!best || d > best.d) best = { p, d };
  }
  return best?.p ?? c;
}

/** True when segment a-b comes within d of a path anywhere along it. */
export function segmentNearPath(a, b, path, d) {
  const lo = [Math.min(a[0], b[0]) - d, Math.min(a[1], b[1]) - d], hi = [Math.max(a[0], b[0]) + d, Math.max(a[1], b[1]) + d];
  for (let i = 1; i < path.length; i++) {
    const c = path[i - 1], e = path[i];
    if (Math.max(c[0], e[0]) < lo[0] || Math.min(c[0], e[0]) > hi[0] || Math.max(c[1], e[1]) < lo[1] || Math.min(c[1], e[1]) > hi[1]) continue;
    if (segmentsIntersect(a, b, c, e)) return true;
    if (distanceToPath(a, [c, e]) < d || distanceToPath(b, [c, e]) < d || distanceToPath(c, [a, b]) < d || distanceToPath(e, [a, b]) < d) return true;
  }
  return false;
}

/** Points along a path every step (each point given, and between), for finding the nearest place on it to go. */
export function pointsAlong(path, step = 0.5) {
  const out = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
