/**
 * Height distribution control: after the solve, land heights are remapped by a monotonic curve so the shares of
 * lowland, hill and mountain match targets set by the mountain amount. Ridges and valleys keep their order (the map
 * is monotonic), so drainage keeps its shape; within each band heights keep their proportions, so a tall range stays
 * taller than a low one. It makes "not mountain-heavy" a guarantee and the slider exact. Nodes held fixed (a kept or
 * locked land) are left alone. Heights: 1.1 is the top of the color scale (E = h / 1.1). Pure.
 */

/** Band edges in E (height / 1.1): lowland below LOW, hills to HILL, mountains above. */
export const BANDS = { LOW: 0.16, HILL: 0.45 };

/** The target shares of land for a mountain amount m (0 to 1): { low, hill, mountain }. */
export function targetShares(m) {
  const low = 0.72 - 0.3 * m, mountain = 0.04 + 0.22 * m;
  return { low, hill: Math.max(0, 1 - low - mountain), mountain };
}

/** Remaps h in place. land, fixed: masks per node. Returns { before, after } shares, for tests and notes. */
export function remapHeights(h, land, fixed, m) {
  const vals = [];
  for (let i = 0; i < h.length; i++) if (land[i] && !(fixed && fixed[i])) vals.push(h[i]);
  if (vals.length < 10) return null;
  vals.sort((a, b) => a - b);
  const q = (p) => vals[Math.min(vals.length - 1, Math.max(0, Math.floor(p * (vals.length - 1))))];
  const t = targetShares(m);
  const top = 0.8 + 0.45 * m; // (E of the highest peak)
  // breakpoints in the old heights, and where they go
  const h0 = Math.max(0, vals[0]), h1 = q(t.low), h2 = q(t.low + t.hill), h3 = vals[vals.length - 1];
  const E0 = 0.004, E1 = BANDS.LOW, E2 = BANDS.HILL, E3 = Math.max(E2 + 0.05, top);
  const map = (v) => {
    if (v <= h1) return (E0 + ((E1 - E0) * (v - h0)) / Math.max(1e-12, h1 - h0)) * 1.1;
    if (v <= h2) return (E1 + ((E2 - E1) * (v - h1)) / Math.max(1e-12, h2 - h1)) * 1.1;
    return (E2 + ((E3 - E2) * (v - h2)) / Math.max(1e-12, h3 - h2)) * 1.1;
  };
  const share = (arr) => { let a = 0, b = 0, c = 0; for (let i = 0; i < arr.length; i++) if (land[i]) { const E = arr[i] / 1.1; if (E < E1) a++; else if (E < E2) b++; else c++; } const s = a + b + c || 1; return { low: a / s, hill: b / s, mountain: c / s }; };
  const before = share(h);
  for (let i = 0; i < h.length; i++) if (land[i] && !(fixed && fixed[i])) h[i] = Math.max(0.0015, map(h[i]));
  return { before, after: share(h), target: t };
}
