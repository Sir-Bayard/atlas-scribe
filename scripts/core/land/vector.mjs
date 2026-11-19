/**
 * Outlines from rasters: the zero line of a signed field (the coast, a lake's shore, a ripple ring) traced by marching
 * squares with the crossing placed between pixels by the values, joined into polylines and rings. Pure.
 */

/**
 * The lines where a w by h field crosses `level` (pixel centers at x + 0.5, y + 0.5). Returns [{ pts: [[x, y]...],
 * closed }], in pixels. Lines shorter than minLen points are dropped.
 */
export function contours(f, w, h, level = 0, minLen = 3) {
  // each cell's crossing segments, keyed by edge id: an edge is between two pixel centers
  const hx = (x, y) => 2 * (y * w + x), vy = (x, y) => 2 * (y * w + x) + 1; // (edge to the right / below pixel x, y)
  const pt = new Map();
  const at = (id) => {
    if (pt.has(id)) return pt.get(id);
    const base = id >> 1, x = base % w, y = (base - x) / w, a = f[base] - level;
    let p;
    if (id & 1) { const b = f[base + w] - level, t = a / (a - b); p = [x + 0.5, y + 0.5 + t]; }
    else { const b = f[base + 1] - level, t = a / (a - b); p = [x + 0.5 + t, y + 0.5]; }
    pt.set(id, p);
    return p;
  };
  const next = new Map(), prev = new Map();
  const link = (a, b) => { next.set(a, b); prev.set(b, a); };
  for (let y = 0; y + 1 < h; y++) for (let x = 0; x + 1 < w; x++) {
    const i = y * w + x;
    const tl = f[i] > level, tr = f[i + 1] > level, bl = f[i + w] > level, br = f[i + w + 1] > level;
    const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
    if (code === 0 || code === 15) continue;
    const T = hx(x, y), B = hx(x, y + 1), L = vy(x, y), R = vy(x + 1, y);
    // (segments oriented with the high side on the left, so rings wind one way)
    switch (code) {
      case 1: link(L, B); break;
      case 2: link(B, R); break;
      case 3: link(L, R); break;
      case 4: link(R, T); break;
      case 5: { const mid = (f[i] + f[i + 1] + f[i + w] + f[i + w + 1]) / 4 > level; if (mid) { link(L, T); link(R, B); } else { link(L, B); link(R, T); } break; }
      case 6: link(B, T); break;
      case 7: link(L, T); break;
      case 8: link(T, L); break;
      case 9: link(T, B); break;
      case 10: { const mid = (f[i] + f[i + 1] + f[i + w] + f[i + w + 1]) / 4 > level; if (mid) { link(T, R); link(B, L); } else { link(T, L); link(B, R); } break; }
      case 11: link(T, R); break;
      case 12: link(R, L); break;
      case 13: link(R, B); break;
      case 14: link(B, L); break;
    }
  }
  const out = [], used = new Set();
  // open lines first (they start where nothing leads in), then rings
  const walk = (start) => {
    const ids = [start]; used.add(start);
    let cur = start;
    for (;;) {
      const nx = next.get(cur);
      if (nx === undefined) return { ids, closed: false };
      if (nx === start) return { ids, closed: true };
      if (used.has(nx)) return { ids, closed: false };
      ids.push(nx); used.add(nx); cur = nx;
    }
  };
  const starts = [...next.keys()].sort((a, b) => a - b);
  for (const s of starts) if (!prev.has(s) && !used.has(s)) { const r = walk(s); if (r.ids.length >= minLen) out.push({ pts: r.ids.map(at), closed: false }); }
  for (const s of starts) if (!used.has(s)) { const r = walk(s); if (r.ids.length >= minLen) out.push({ pts: r.ids.map(at), closed: r.closed }); }
  return out;
}

/** Chaikin smoothing for a line or ring of [x, y] points, n times. */
export function smoothLine(pts, closed, n = 2) {
  let p = pts;
  for (let t = 0; t < n; t++) {
    if (p.length < 3) return p;
    const q = closed ? [] : [p[0]];
    const m = closed ? p.length : p.length - 1;
    for (let i = 0; i < m; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    if (!closed) q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}
