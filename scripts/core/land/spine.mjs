/**
 * The one range function, for every range: a plate boundary's and one a GM drew alike, so they look like one family
 * and differ only in where the spine came from. A spine is a polyline (frame miles); the range is built around it:
 * a core along it (in segments, its rock hard), flanking ridges offset to either side in staggered pieces, foothills
 * about four and a half core widths out, a faint foreland basin beyond on the gentle side, every edge wavered by
 * noise, steeper on one side when the range has an incoming side. Adds into uplift and hardness. Pure.
 */
import { sin, exp, len, PI } from "./dmath.mjs";

/** A polyline resampled to points about `step` miles apart. */
export function resample(pts, step) {
  if (pts.length < 2) return pts.map((p) => [...p]);
  const out = [[...pts[0]]];
  let carry = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, ay] = pts[k], [bx, by] = pts[k + 1], L = len(bx - ax, by - ay);
    let t = step - carry;
    while (t <= L) { out.push([ax + ((bx - ax) * t) / L, ay + ((by - ay) * t) / L]); t += step; }
    carry = L - (t - step);
  }
  const last = pts[pts.length - 1], tail = out[out.length - 1];
  if (len(last[0] - tail[0], last[1] - tail[1]) > step * 0.3) out.push([...last]);
  return out;
}

/**
 * Adds a range around a spine. g: the graph; spine: [[x, y]...] (miles); o: { height, width (core, miles), hard
 * (0..1), ridges (0..4), steep (+1: the left of the spine's direction is steeper, -1 the right, 0 neither), foreland
 * (boolean), kind ("range" | "arc" | "rift"), seed }; fields: { ridged, along, waver, foot } per node; r: a random
 * stream; out: { U, hard } Float64Arrays. Returns the core-weighted node count (0 if the spine touched nothing).
 */
export function addRange(g, spine, o, fields, r, out) {
  const w0 = Math.max(1, o.width ?? 30);
  let pts = resample(spine, w0 / 4);
  if (pts.length < 2) return 0;
  // a hand's wobble, perpendicular, smoothed
  const np = pts.length, wob = new Float64Array(np);
  for (let k = 0; k < np; k++) wob[k] = r.next() - 0.5;
  for (let pass = 0; pass < 4; pass++) for (let k = 1; k + 1 < np; k++) wob[k] = (wob[k - 1] + 2 * wob[k] + wob[k + 1]) / 4;
  const tan = pts.map((p, k) => { const a = pts[Math.max(0, k - 1)], b = pts[Math.min(np - 1, k + 1)]; const l = len(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; });
  pts = pts.map((p, k) => [p[0] - tan[k][1] * wob[k] * w0, p[1] + tan[k][0] * wob[k] * w0]);
  const phase = r.next() * 6.28, phases = [0, 1, 2, 3].map(() => r.next() * 6.28);
  const height = o.height ?? 1, hardness = o.hard ?? 0, ridges = Math.max(0, Math.min(4, o.ridges ?? 4));
  const kind = o.kind ?? "range";
  const FL = [[1.9, 0.38], [-2.1, 0.32], [3.4, 0.18], [-3.6, 0.16]];
  const reach = (kind === "rift" ? 3 : 11) * w0 * 1.2;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  let touched = 0;
  for (let i = 0; i < g.n; i++) {
    const x = g.x[i], y = g.y[i];
    if (x < x0 - reach || x > x1 + reach || y < y0 - reach || y > y1 + reach) continue;
    let bk = 0, bd = Infinity;
    for (let k = 0; k < np; k++) { const dx = x - pts[k][0], dy = y - pts[k][1], d = dx * dx + dy * dy; if (d < bd) { bd = d; bk = k; } }
    const d = Math.sqrt(bd);
    if (d > reach) continue;
    const t = bk / (np - 1);
    const rx = x - pts[bk][0], ry = y - pts[bk][1];
    const side = tan[bk][0] * ry - tan[bk][1] * rx >= 0 ? 1 : -1;
    const w = w0 * (0.8 + 0.4 * (0.5 + 0.5 * sin(3 * PI * t + phase)));
    let dw = d + 0.35 * w * fields.waver[i];
    if (dw < 0) dw = 0;
    // (the incoming side steeper, the other gentler)
    const asym = o.steep ? (side === o.steep ? 1.33 : 0.83) : 1;
    const da = dw * asym;
    // (the ends fade in and out)
    const taper = Math.min(1, t / 0.1) * Math.min(1, (1 - t) / 0.1);
    const q = (v) => v * v;
    if (kind === "rift") {
      out.U[i] -= height * 0.03 * exp(-q(da / w)) * taper;
      continue;
    }
    const seg = Math.min(1, Math.max(0, 0.55 + 0.45 * sin(17 * t + 2.5 * fields.along[i])));
    let core = exp(-q(da / w)) * (0.7 + 0.3 * seg);
    if (kind === "arc") core *= Math.min(1, Math.max(0, 1.6 * sin(9 * t * PI + phase) + 0.6 * fields.along[i]));
    let flanks = 0;
    for (let k = 0; k < ridges; k++) {
      const [off, amp] = FL[k];
      const stag = Math.min(1, Math.max(0, 1.4 * sin(t * (9 + 2 * k) + phases[k] + fields.along[i])));
      flanks += amp * exp(-q((side * dw * asym - off * w) / (0.75 * w))) * stag;
    }
    const foot = 0.1 * exp(-q(da / (4.5 * w))) * (0.6 + 0.4 * fields.foot[i]);
    const fore = o.foreland && side !== o.steep ? -0.004 * exp(-q((dw - 6 * w) / (2 * w))) : 0;
    const u = (height * (0.95 * core + 0.5 * flanks) * (0.6 + 0.4 * fields.ridged[i]) * (0.8 + 0.2 * fields.along01[i]) + foot * height) * taper + fore * taper;
    out.U[i] += u;
    const hd = 0.8 * hardness * exp(-q(dw / (0.9 * w))) * taper;
    if (hd > out.hard[i]) out.hard[i] = hd;
    if (core > 0.2) touched++;
  }
  return touched;
}
