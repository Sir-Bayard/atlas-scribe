/**
 * Curved and spaced labels: where each letter of a label goes when it's set along an arc, with space between its
 * letters, as an atlas sets the name of a country or a range. Shared by the window's map and the scene's labels layer,
 * each giving its own measure of a letter's width. Pure.
 *
 * A label's bend is how far its middle stands above the line between its ends, as a share of its width (0 straight,
 * 0.2 a strong arch, below 0 a sag); its spacing the room added after each letter, in ems.
 */

/** The most a label bends either way. */
export const MAX_BEND = 0.35;

/** A bend kept to the range a label can be read at: a number from -MAX_BEND to MAX_BEND (0 for anything else). */
export const cleanBend = (b) => (Number.isFinite(b) ? Math.max(-MAX_BEND, Math.min(MAX_BEND, b)) : 0);

/** A spacing kept to what a label can carry: 0 to 2 ems. */
export const cleanSpacing = (s) => (Number.isFinite(s) ? Math.max(0, Math.min(2, s)) : 0);

/**
 * Each letter of text set at size (px) with spacing (ems) along an arc of the given bend, centered on 0,0 in the
 * label's own frame (x right, y down; a turned label is turned as a whole after): { glyphs: [{ ch, x, y, rot (radians),
 * w }], width, height } where x, y is the middle of the letter's baseline and width and height the box the letters
 * take. widthOf(ch) gives a letter's width in px at that size.
 */
export function glyphsOf(text, { size = 16, spacing = 0, bend = 0 } = {}, widthOf = (ch) => size * (ch === " " ? 0.3 : 0.55)) {
  const chars = [...String(text ?? "")], gap = cleanSpacing(spacing) * size, b = cleanBend(bend);
  const w = chars.map((ch) => Math.max(0, Number(widthOf(ch)) || 0));
  // (the advance of the whole line: each letter and the gap after it, none after the last)
  const total = w.reduce((t, x) => t + x, 0) + gap * Math.max(0, chars.length - 1);
  const height = size * 1.2;
  if (!chars.length) return { glyphs: [], width: 0, height };
  // (straight: letters along the x axis)
  if (Math.abs(b) < 0.005 || total <= 0) {
    let x = -total / 2;
    const glyphs = chars.map((ch, k) => { const g = { ch, x: x + w[k] / 2, y: 0, rot: 0, w: w[k] }; x += w[k] + gap; return g; });
    return { glyphs, width: total, height };
  }
  // (an arc whose length is the line's advance, so letters keep their widths: its chord and rise from the bend)
  // the chord c and rise s = b * c of an arc of length L: L = 2 R asin(c / 2R) with R = (c^2/4 + s^2) / 2s; R and c
  // in proportion to L, solved once for the bend
  const k = Math.abs(b), up = b > 0 ? 1 : -1;
  const Rc = (0.25 + k * k) / (2 * k); // R / c
  const half = Math.asin(Math.min(1, 1 / (2 * Rc))); // half the arc's angle
  const c = total / (2 * Rc * half), R = Rc * c, s = k * c;
  // (the circle's middle below the arc for an arch, above it for a sag; the arc's ends and apex centered on y = 0)
  const cy = up * (R - s / 2);
  let t = -total / 2;
  const glyphs = chars.map((ch, n) => {
    const mid = t + w[n] / 2, th = mid / R;
    t += w[n] + gap;
    return { ch, x: R * Math.sin(th), y: cy - up * R * Math.cos(th), rot: up * th, w: w[n] };
  });
  return { glyphs, width: c, height: height + s };
}

/**
 * The bend of an arc through three points (its ends and a point near its middle), as a label set along it reads it:
 * the middle point's height above the chord over the chord's length, positive where it stands above the chord when
 * the label is turned to read left to right. points in any units; flipped: the label is turned the other way around
 * from a to b (its reading direction b to a).
 */
export function bendThrough(a, m, b, flipped = false) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.sqrt(dx * dx + dy * dy);
  if (!(L > 0)) return 0;
  // (y down: a point above the chord, reading from a to b, has a negative cross product)
  const cross = (dx * (m[1] - a[1]) - dy * (m[0] - a[0])) / L;
  return cleanBend(((flipped ? 1 : -1) * cross) / L);
}

/**
 * The long axis of an area, for a name set along it: points (the area's cells or nodes, [x, y], y down) give its
 * middle, the angle of its longest spread (degrees, turned to read left to right, within maxTurn of level), how long
 * it is along that angle (the middle 90% of its points), and the bend of a curve fitted through it (the area's own
 * arch or sag along its length). A round area, or one of too few points, lies level and straight.
 */
export function axisOf(points, { maxTurn = 40 } = {}) {
  const n = points.length;
  if (n < 6) return { mid: n ? points[0] : [0, 0], angle: 0, length: 0, bend: 0 };
  let mx = 0, my = 0;
  for (const p of points) { mx += p[0]; my += p[1]; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of points) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  // (the spread's main direction and how much longer than wide it is)
  const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(1e-12, tr / 2 - disc);
  let ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const long = l1 / l2 > 2.2;
  if (!long) ang = 0;
  // (read left to right, and never steeper than maxTurn)
  let deg = (ang * 180) / Math.PI;
  if (deg > 90) deg -= 180; else if (deg <= -90) deg += 180;
  deg = Math.max(-maxTurn, Math.min(maxTurn, deg));
  const a = (deg * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a), vx = uy, vy = -ux; // (v: the label's up)
  const us = [], vs = [];
  for (const p of points) { const dx = p[0] - mx, dy = p[1] - my; us.push(dx * ux + dy * uy); vs.push(dx * vx + dy * vy); }
  const sorted = us.slice().sort((p, q) => p - q), lo = sorted[Math.floor(n * 0.05)], hi = sorted[Math.min(n - 1, Math.floor(n * 0.95))];
  const length = Math.max(0, hi - lo);
  if (!long || !(length > 0)) return { mid: [mx, my], angle: Math.round(deg * 10) / 10, length, bend: 0 };
  // (v = A u^2 + B u + C by least squares; the middle's height above the chord between the ends, over the length)
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (let k = 0; k < n; k++) { const u = us[k], v = vs[k], u2 = u * u; s0++; s1 += u; s2 += u2; s3 += u2 * u; s4 += u2 * u2; t0 += v; t1 += u * v; t2 += u2 * v; }
  const D = s4 * (s2 * s0 - s1 * s1) - s3 * (s3 * s0 - s1 * s2) + s2 * (s3 * s1 - s2 * s2);
  if (!(Math.abs(D) > 1e-12)) return { mid: [mx, my], angle: Math.round(deg * 10) / 10, length, bend: 0 };
  const A = (t2 * (s2 * s0 - s1 * s1) - s3 * (t1 * s0 - s1 * t0) + s2 * (t1 * s1 - s2 * t0)) / D;
  // (an area's arch is gentler than its outline: half of it, so the name keeps inside)
  const bend = cleanBend(((-A * length) / 4) * 0.5);
  return { mid: [mx, my], angle: Math.round(deg * 10) / 10, length, bend: Math.round(bend * 1000) / 1000 };
}
