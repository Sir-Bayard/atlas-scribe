/**
 * exp, log, sin, cos, tanh, pow and atan2 built only from + - * / and Math.sqrt (which every JavaScript engine rounds
 * exactly), so the land comes out the same, bit for bit, in Chromium, Firefox and node. Math.exp, Math.sin and their
 * kin are "implementation-approximated" by the language and may differ in the last bit between engines, which is
 * enough to move a river. Accurate to about 1e-15 relative over the ranges the generator uses. Pure.
 */

const LN2_HI = 0.6931471803691238, LN2_LO = 1.9082149292705877e-10, INV_LN2 = 1.4426950408889634;
export const PI = 3.141592653589793;
const PIO2_HI = 1.5707963267341256, PIO2_LO = 6.077100506506192e-11, TWO_OVER_PI = 0.6366197723675814;

// powers of two, made by doubling and halving (exact)
const P2 = new Float64Array(2100);
P2[1050] = 1;
for (let k = 1; k <= 1023; k++) P2[1050 + k] = P2[1049 + k] * 2;
for (let k = 1; k <= 1049; k++) P2[1050 - k] = P2[1051 - k] / 2;
const pow2 = (k) => (k > 1023 ? Infinity : k < -1049 ? 0 : P2[1050 + k]);

/** Rounds to the nearest whole number, halves away from zero, with no Math call. */
const roundInt = (x) => (x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5));

export function exp(x) {
  if (x !== x) return NaN;
  if (x > 709.78) return Infinity;
  if (x < -745) return 0;
  const k = roundInt(x * INV_LN2);
  const r = (x - k * LN2_HI) - k * LN2_LO;        // |r| <= ln2 / 2
  // e^r by its series to r^14 (Horner)
  let p = 1 / 87178291200;
  p = p * r + 1 / 6227020800; p = p * r + 1 / 479001600; p = p * r + 1 / 39916800; p = p * r + 1 / 3628800;
  p = p * r + 1 / 362880; p = p * r + 1 / 40320; p = p * r + 1 / 5040; p = p * r + 1 / 720; p = p * r + 1 / 120;
  p = p * r + 1 / 24; p = p * r + 1 / 6; p = p * r + 0.5; p = p * r + 1; p = p * r + 1;
  return k < -1020 ? (p * pow2(k + 60)) * pow2(-60) : p * pow2(k);
}

export function log(x) {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let e = 0, m = x;
  while (m >= 1.4142135623730951) { m /= 2; e++; }
  while (m < 0.7071067811865476) { m *= 2; e--; }
  // log m = 2 atanh(s), s = (m - 1) / (m + 1), |s| <= 0.1716
  const s = (m - 1) / (m + 1), s2 = s * s;
  let p = 1 / 23;
  p = p * s2 + 1 / 21; p = p * s2 + 1 / 19; p = p * s2 + 1 / 17; p = p * s2 + 1 / 15; p = p * s2 + 1 / 13;
  p = p * s2 + 1 / 11; p = p * s2 + 1 / 9; p = p * s2 + 1 / 7; p = p * s2 + 1 / 5; p = p * s2 + 1 / 3; p = p * s2 + 1;
  return 2 * s * p + (e * LN2_HI + e * LN2_LO);
}

/** sin and cos of r for |r| <= pi / 4, by their series. */
function sinK(r) {
  const r2 = r * r;
  let p = -1 / 1307674368000;
  p = p * r2 + 1 / 6227020800; p = p * r2 - 1 / 39916800; p = p * r2 + 1 / 362880; p = p * r2 - 1 / 5040;
  p = p * r2 + 1 / 120; p = p * r2 - 1 / 6; p = p * r2 + 1;
  return r * p;
}
function cosK(r) {
  const r2 = r * r;
  let p = 1 / 20922789888000;
  p = p * r2 - 1 / 87178291200; p = p * r2 + 1 / 479001600; p = p * r2 - 1 / 3628800; p = p * r2 + 1 / 40320;
  p = p * r2 - 1 / 720; p = p * r2 + 1 / 24; p = p * r2 - 0.5; p = p * r2 + 1;
  return p;
}
function reduce(x) {
  const k = roundInt(x * TWO_OVER_PI);
  return [((x - k * PIO2_HI) - k * PIO2_LO), ((k % 4) + 4) % 4];
}
export function sin(x) {
  if (!Number.isFinite(x)) return NaN;
  const [r, q] = reduce(x);
  return q === 0 ? sinK(r) : q === 1 ? cosK(r) : q === 2 ? -sinK(r) : -cosK(r);
}
export function cos(x) {
  if (!Number.isFinite(x)) return NaN;
  const [r, q] = reduce(x);
  return q === 0 ? cosK(r) : q === 1 ? -sinK(r) : q === 2 ? -cosK(r) : sinK(r);
}

export function tanh(x) {
  if (x > 20) return 1;
  if (x < -20) return -1;
  if (x > -0.05 && x < 0.05) {
    const x2 = x * x;
    return x * (1 + x2 * (-1 / 3 + x2 * (2 / 15 + x2 * (-17 / 315 + x2 * (62 / 2835 - x2 * (1382 / 155925))))));
  }
  const e = exp(2 * x);
  return (e - 1) / (e + 1);
}

/** x to the power y; x below zero only for whole y. */
export function pow(x, y) {
  if (y === 0) return 1;
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x < 0) {
    if (Math.floor(y) !== y) return NaN;
    const v = exp(y * log(-x));
    return y % 2 === 0 ? v : -v;
  }
  if (y === 1) return x;
  if (y === 2) return x * x;
  if (y === 0.5) return Math.sqrt(x);
  return exp(y * log(x));
}

/** atan for |x| <= tan(pi / 12), by its series. */
function atanK(x) {
  const x2 = x * x;
  let p = -1 / 23;
  p = p * x2 + 1 / 21; p = p * x2 - 1 / 19; p = p * x2 + 1 / 17; p = p * x2 - 1 / 15; p = p * x2 + 1 / 13;
  p = p * x2 - 1 / 11; p = p * x2 + 1 / 9; p = p * x2 - 1 / 7; p = p * x2 + 1 / 5; p = p * x2 - 1 / 3; p = p * x2 + 1;
  return x * p;
}
const SQRT3 = 1.7320508075688772, TAN_PI_12 = 0.2679491924311228;
export function atan(x) {
  if (x !== x) return NaN;
  let sign = 1;
  if (x < 0) { x = -x; sign = -1; }
  let base = 0, inv = false;
  if (x > 1) { x = 1 / x; inv = true; }
  if (x > TAN_PI_12) { x = (x * SQRT3 - 1) / (x + SQRT3); base = PI / 6; }
  let a = base + atanK(x);
  if (inv) a = PI / 2 - a;
  return sign * a;
}
export function atan2(y, x) {
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
  return y > 0 ? PI / 2 : y < 0 ? -PI / 2 : 0;
}

/** Length of (x, y) without Math.hypot (which engines may round differently). */
export const len = (x, y) => Math.sqrt(x * x + y * y);
