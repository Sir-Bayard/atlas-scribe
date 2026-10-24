/**
 * Seeded random numbers. Every random choice AtlasScribe makes goes through here, never Math.random(),
 * so the same plan and seeds always give the same map.
 *
 * rng(seed, ...keys) gives an independent stream for each combination of keys, so a district's stream
 * (rng(plan.seed, "district", id)) doesn't change when anything else in the plan does.
 * Pure: runs in the worker, on the main page and under node.
 */

/** A 128-bit hash of a string, as four 32-bit words (cyrb128). */
export function hash128(text) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** sfc32: a small, fast generator with a 128-bit state. Returns a function giving numbers in [0, 1). */
function sfc32(a, b, c, d) {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/**
 * A random stream for a seed and any keys. The stream has helpers:
 * next() in [0, 1), range(lo, hi), int(n) in 0..n-1, chance(p), pick(list), shuffle(list) (a copy), and
 * fork(...keys) for a sub-stream that doesn't disturb this one.
 */
export function rng(seed, ...keys) {
  const key = [String(seed), ...keys.map(String)].join("\u001f");
  const next = sfc32(...hash128(key));
  for (let i = 0; i < 12; i++) next(); // let the state settle
  const r = {
    next,
    range: (lo, hi) => lo + next() * (hi - lo),
    int: (n) => Math.floor(next() * n),
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    shuffle: (list) => {
      const a = [...list];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    fork: (...more) => rng(seed, ...keys, ...more),
  };
  return r;
}
