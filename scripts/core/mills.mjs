/**
 * Mills for Quick Start: a watermill on a short mill race beside a river or stream, and a windmill on open ground in
 * its own trodden yard (so a lane comes to it). Each comes out as plan features (a canal, a building, a yard), so
 * everything else treats them as anything drawn. Pure: runs anywhere. Numbers are in squares (25 ft) unless they say
 * feet.
 */

const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const r1 = (v) => Math.round(v * 10) / 10;
const pt = (p) => [r1(p[0]), r1(p[1])];
function distToPath(p, path) {
  let m = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    m = Math.min(m, Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]));
  }
  return m;
}

/** Points along a path every step squares, each with its direction: [{ p, u (unit), s (length along) }]. */
function along(path, step) {
  const out = [];
  let s = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], d = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...d);
    if (!l) continue;
    const u = [d[0] / l, d[1] / l];
    for (let t = out.length ? step - ((s - out[out.length - 1].s) % step) : 0; t < l; t += step) out.push({ p: add(a, mul(u, t)), u, s: s + t });
    s += l;
  }
  return out;
}

/** The mill building's footprint as a rect turned about its middle (for tests): its four corners. */
const cornersOf = (c, u, len, dep) => { const n = [-u[1], u[0]]; return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => add(add(c, mul(u, (i * len) / 2)), mul(n, (j * dep) / 2))); };

/**
 * A watermill on a race beside a river: the race leaves the river, runs along it a bank's width away past the mill
 * and comes back in. water: { path, width (feet) }; ok(p, m): p is clear of everything by m (the town, roads, the map's
 * edge); want(c): the mill's middle is somewhere it should stand (by the town, say); r: a stream; id: the mill's id.
 * Returns [race (water, canal), mill (building, use watermill)] or null.
 */
export function watermill({ water, ok, want = () => true, r, id = "watermill", tries = 40 }) {
  const half = water.width / 25 / 2;
  const pts = along(water.path, 0.5);
  if (pts.length < 40) return null;
  for (let t = 0; t < tries; t++) {
    const i = 16 + r.int(pts.length - 32), side = r.chance(0.5) ? 1 : -1, len = r.range(1.3, 1.7), dep = r.range(0.9, 1.1), roof = r.pick(["thatch", "tile-red", "wood-shingle", "slate"]);
    const mid = pts[i], u = mid.u, n = mul([-u[1], u[0]], side);
    const off = half + 1.5; // the race's line: a strip of bank between it and the river
    const up = pts[i - 12], down = pts[i + 12];
    if (!up || !down) continue;
    // In off the river upstream, along it, and back in downstream, all as plan points
    const race = [up.p, add(pts[i - 8].p, mul([-pts[i - 8].u[1] * side, pts[i - 8].u[0] * side], off)), add(pts[i - 3].p, mul([-pts[i - 3].u[1] * side, pts[i - 3].u[0] * side], off)), add(pts[i + 3].p, mul([-pts[i + 3].u[1] * side, pts[i + 3].u[0] * side], off)), add(pts[i + 8].p, mul([-pts[i + 8].u[1] * side, pts[i + 8].u[0] * side], off)), down.p].map(pt);
    // The mill on the land side of the race, its long side along it
    const c = add(mid.p, mul(n, off + 0.2 + 0.45 + dep / 2)); // (a bank's width between it and the race, so a bend can't bring it in)
    const foot = cornersOf(c, u, len, dep);
    // Everything off the race's land side clear: the mill and a margin, and the race's own line
    const test = [c, ...foot, ...race.slice(1, -1)];
    if (!want(c) || !test.every((p) => ok(p, 1))) continue;
    if (foot.some((p) => distToPath(p, race) < 0.2 + 0.25)) continue; // (a bend in the race can come in at a corner)
    const rot = Math.round((Math.atan2(u[1], u[0]) * 180) / Math.PI);
    return [
      { id: `${id}-race`, type: "water", class: "canal", width: 10, path: race },
      { id, type: "building", use: "watermill", shape: { rect: [r1(c[0] - len / 2), r1(c[1] - dep / 2), r1(c[0] + len / 2), r1(c[1] + dep / 2)] }, rot, roof, roofStyle: "gable", height: 30 },
    ];
  }
  return null;
}

/**
 * A windmill on open ground: a round tower mill in a small trodden yard. ok(p, m): clear of everything by m; spot():
 * a candidate middle (from the caller's own rules); r: a stream. Returns [yard (area), mill (building, use windmill)]
 * or null.
 */
export function windmill({ ok, spot, r, id = "windmill", tries = 60 }) {
  for (let t = 0; t < tries; t++) {
    const c = spot(), rad = r.range(0.45, 0.55), yard = r.range(2.2, 2.8), roof = r.pick(["thatch", "wood-shingle", "slate", "tile-red"]);
    if (!c) continue;
    const box = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => add(c, [(i * yard) / 2, (j * yard) / 2]));
    if (![c, ...box].every((p) => ok(p, 0.8))) continue;
    return [
      { id: `${id}-yard`, type: "area", class: "yard", surface: "trodden", shape: { rect: [r1(c[0] - yard / 2), r1(c[1] - yard / 2), r1(c[0] + yard / 2), r1(c[1] + yard / 2)] } },
      { id, type: "building", use: "windmill", shape: { circle: [r1(c[0]), r1(c[1]), r1(rad)] }, roof, height: 45 },
    ];
  }
  return null;
}
