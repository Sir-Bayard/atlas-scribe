/**
 * Smooth seeded noise for bending streets and, later, ground variation. Value noise on a lattice with smooth
 * interpolation and a few octaves: cheap, deterministic, and enough for gentle wobble. Pure: runs anywhere.
 */
import { rng } from "./rng.mjs";

/**
 * A noise function noise(x, y) in -1..1, smooth at the given scale (squares per wobble). Same seed and keys,
 * same noise.
 */
export function makeNoise(seed, key, { scale = 12, octaves = 3 } = {}) {
  const r = rng(seed, "noise", key);
  const perm = new Uint16Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  r.shuffle(p);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = Float64Array.from({ length: 256 }, () => r.next() * 2 - 1);
  const at = (ix, iy) => vals[perm[(perm[ix & 255] + iy) & 511] & 255];
  const fade = (t) => t * t * (3 - 2 * t);
  const single = (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = fade(x - x0), fy = fade(y - y0);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  let norm = 0;
  for (let o = 0; o < octaves; o++) norm += 0.5 ** o;
  return (x, y) => {
    let v = 0;
    for (let o = 0; o < octaves; o++) {
      const f = 2 ** o / scale;
      v += single(x * f + o * 17.3, y * f - o * 9.1) * 0.5 ** o;
    }
    return v / norm;
  };
}
