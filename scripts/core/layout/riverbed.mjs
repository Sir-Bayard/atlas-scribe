/**
 * A river's or stream's bed (water fields shallows and islands): gravel bars in the shallows on the inside of its
 * bends, and small islands where it runs wide and straight, each kept clear of its bridges, fords, docks, boats and
 * mills. Squares; pure: runs anywhere.
 */

/** Points along a path no more than step apart, with the width at each (widths per point, or one width). */
function along(path, width, widths, step) {
  const pts = [], ws = [], at = [];
  let s = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / step));
    const wa = widths?.[i - 1] ?? width, wb = widths?.[i] ?? width;
    for (let k = 0; k < n; k++) { const t = k / n; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); ws.push(wa + (wb - wa) * t); at.push(s + L * t); }
    s += L;
  }
  pts.push(path.at(-1)); ws.push(widths?.at(-1) ?? width); at.push(s);
  return { pts, ws, at };
}

/**
 * The bed of one running water item w (its path, width, widths); want: { shallows, islands } from its plan feature;
 * avoid: points to keep clear of (squares); r: its stream. Returns { bars, islands }: polygons, bars in the water and
 * islands of land in it.
 */
export function riverbed(w, want, { avoid = [], r }) {
  const out = { bars: [], islands: [] };
  if (!Array.isArray(w.path) || w.path.length < 2) return out;
  const { pts, ws, at } = along(w.path, w.width, w.widths, 0.4);
  const n = pts.length, total = at.at(-1);
  if (n < 6) return out;
  // Each point's heading and its turning (radians a square, smoothed over about a width either side)
  const head = pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; return Math.atan2(b[1] - a[1], b[0] - a[0]); });
  const norm = head.map((h) => [-Math.sin(h), Math.cos(h)]);
  const turn = head.map((h, i) => { if (!i || i === n - 1) return 0; let d = head[i + 1] - head[i - 1]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d / Math.max(1e-6, at[i + 1] - at[i - 1]); });
  const smooth = turn.map((_, i) => { const reach = Math.max(1, Math.round(ws[i] / 0.4)); let s = 0, c = 0; for (let j = Math.max(0, i - reach); j <= Math.min(n - 1, i + reach); j++) { s += turn[j]; c++; } return s / c; });
  const clearOf = (i0, i1, pad) => { for (let i = i0; i <= i1; i++) for (const q of avoid) if (Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]) < ws[i] / 2 + pad) return false; return true; };
  const used = [];
  const free = (i0, i1) => used.every(([a, b]) => i1 < a - 4 || i0 > b + 4);
  const side = (i, d) => [pts[i][0] + norm[i][0] * d, pts[i][1] + norm[i][1] * d];
  // Bars: on the inside of each bend, sharp for the river's width (a turn of a radian over three widths or less)
  if (want.shallows) {
    let i = 0;
    while (i < n && out.bars.length < 8) {
      const bend = (k) => Math.abs(smooth[k]) * ws[k] * 3 > 0.6;
      if (!bend(i)) { i++; continue; }
      let j = i;
      while (j + 1 < n && bend(j + 1) && Math.sign(smooth[j + 1]) === Math.sign(smooth[i])) j++;
      const len = at[j] - at[i];
      if (len >= Math.max(1.2, ws[i] * 1.5) && free(i, j) && clearOf(i, j, 0.5)) {
        // (the inside of a turn to the left lies on the left: a positive turn's normal side)
        const sgn = Math.sign(smooth[i]), outer = [], inner = [];
        for (let k = i; k <= j; k++) {
          const t = (at[k] - at[i]) / len, half = ws[k] / 2;
          outer.push(side(k, sgn * half * 0.98));
          inner.push(side(k, sgn * (half * 0.98 - ws[k] * (0.12 + 0.3 * r.range(0.8, 1.1)) * Math.sin(Math.PI * t) ** 0.7)));
        }
        out.bars.push([...outer, ...inner.reverse()]);
        used.push([i, j]);
      }
      i = j + 1;
    }
  }
  // Islands: where the water runs straight and wide enough to part around one, well apart and away from its ends
  const want_ = Math.max(0, Math.min(6, Math.floor(want.islands ?? 0)));
  for (let tries = 0; tries < 60 && out.islands.length < want_; tries++) {
    const c = Math.floor(r.range(0, n));
    const L = Math.max(2, Math.min(10, ws[c] * r.range(2.5, 4)));
    if (ws[c] < 0.9 || at[c] - L / 2 < 3 || at[c] + L / 2 > total - 3) continue;
    let i0 = c, i1 = c;
    while (i0 > 0 && at[c] - at[i0] < L / 2) i0--;
    while (i1 < n - 1 && at[i1] - at[c] < L / 2) i1++;
    if (!free(i0, i1) || !clearOf(i0, i1, 1)) continue;
    if (smooth.slice(i0, i1 + 1).some((v, k) => Math.abs(v) * ws[i0 + k] * 3 > 0.45)) continue;
    const lean = r.range(-0.08, 0.08), wide = r.range(0.24, 0.34);
    const left = [], right = [];
    for (let k = i0; k <= i1; k++) {
      const t = (at[k] - at[i0]) / (at[i1] - at[i0]), hw = ws[k] * wide * Math.sin(Math.PI * t) ** 0.65, mid = ws[k] * lean;
      left.push(side(k, mid + hw)); right.push(side(k, mid - hw));
    }
    out.islands.push([...left, ...right.slice(1, -1).reverse()]);
    used.push([i0, i1]);
  }
  return out;
}
