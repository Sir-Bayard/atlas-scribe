/**
 * Roof shapes, as flat pieces to paint: each slope of a roof seen from above. Everything is in the building's own
 * frame (squares, x along len, y along dep, centred on the building). Pure: runs anywhere.
 *
 * A facet is { poly, down (its downslope, a unit vector; [0, 0] for a flat piece), eaveAngle (degrees: the texture's
 * rows run along the eave, its lower edge downslope), eaves (outline edges), flat (true for a flat piece) }. The list also carries:
 *   ridge: [a, b] or null; creases: [{ seg: [a, b], kind: "hip" | "valley" }]; caps: the ridge and hips, which get
 *   a ridge cap; parapet: for a flat roof, { w, joined: { start, end } }; skylight: { cx, cy, len, dep } or null.
 *
 * Every form assumes equal pitches, so hips and valleys run at 45 degrees in plan (Tom Cartos-style roofs). A wing's
 * end that runs into another roof (b.join.start: the -x end, b.join.end: +x) has no hip or gable: its slopes carry on
 * half its width past the end and meet in a point, forming the valleys where it joins the other roof.
 */

/** How far a half-hip's small hip reaches down its end, as a share of the half width. */
const HALF_HIP = 0.42;

export function roofFacets(b) {
  if (b.round) return coneFacets(b);
  const style = b.roofStyle ?? "gable";
  if (style === "flat") return flatFacets(b);
  if (style === "mansard" && !b.join) return mansardFacets(b);
  return slopedFacets(b, style === "mansard" ? "hip" : style);
}

/** Drops empty facets and sets each slope's eaveAngle from its downslope (the builders leave it 0). */
function finish(out, extra) {
  const kept = out.filter((f) => f.poly.length || f.eaves.length);
  // The texture's rows run along the eave, its lower edge (a tile's or thatch's ragged end) downslope
  for (const f of kept) if (f.down[0] || f.down[1]) f.eaveAngle = (Math.atan2(f.down[1], f.down[0]) * 180) / Math.PI - 90;
  return Object.assign(kept, { ridge: null, creases: [], caps: [], parapet: null, skylight: null }, extra);
}

/** Drops repeated points (a hip's corner landing on an eave corner, a gable's on its ridge end). */
function clean(poly) {
  return poly.filter((p, i) => {
    const q = poly[(i + poly.length - 1) % poly.length];
    return Math.abs(p[0] - q[0]) > 1e-9 || Math.abs(p[1] - q[1]) > 1e-9;
  });
}

/** gable, hip, half-hip and pyramid: two long slopes, and at each end a hip (all, part or none of it) or a join. */
function slopedFacets(b, style) {
  const join = b.join ?? {};
  const clip = style === "hip" || style === "pyramid" ? 1 : style === "half-hip" ? HALF_HIP : 0;
  // A hipped roof's ridge runs along its longer side; a gable's (and any wing's) along x
  const swap = clip === 1 && !b.join && b.dep > b.len;
  const A = (swap ? b.dep : b.len) / 2, B = (swap ? b.len : b.dep) / 2;
  const map = ([u, v]) => (swap ? [v, u] : [u, v]);
  // A joined end may be set into the other building a little (join.inset): its valleys start where the other
  // roof's eave really is, so they land true
  const inset = Math.max(0, Math.min(A, join.inset ?? 0));
  const s0 = join.start ? -A + inset : -A, s1 = join.end ? A - inset : A;
  const end = (e, joined) => (joined ? (e < 0 ? s0 - B : s1 + B) : e * (A - clip * B));
  let h0 = end(-1, join.start), h1 = end(1, join.end);
  if (style === "pyramid" && !b.join) h0 = h1 = 0;
  if (h0 > h1) h0 = h1 = (h0 + h1) / 2; // a short hipped roof comes to a point
  const r0 = [h0, 0], r1 = [h1, 0];
  const out = [], creases = [];
  const facet = (poly, down, eaves) => out.push({ poly: clean(poly).map(map), down: map(down), eaveAngle: 0, eaves: eaves.map((e) => e.map(map)), flat: false });
  for (const sgn of [-1, 1]) {
    const e0 = [s0, sgn * B], e1 = [s1, sgn * B];
    // Where this slope's edge leaves each end wall: at the eave for a hip, partway up for a half-hip, at the ridge for a gable
    const k0 = join.start ? null : [-A, sgn * clip * B];
    const k1 = join.end ? null : [A, sgn * clip * B];
    facet([e0, e1, ...(k1 ? [k1] : []), r1, r0, ...(k0 ? [k0] : [])], [0, sgn], [[e0, e1]]);
    // A side flush with a hipped roof's end (join.flush) lies in the same plane as that hip: no valley there
    const valley = join.flush !== sgn;
    if (join.start) { if (valley) creases.push({ seg: [e0, r0], kind: "valley" }); }
    else if (clip > 0) creases.push({ seg: [k0, r0], kind: "hip" });
    if (join.end) { if (valley) creases.push({ seg: [e1, r1], kind: "valley" }); }
    else if (clip > 0) creases.push({ seg: [k1, r1], kind: "hip" });
  }
  // Each free end: its hip (whole or clipped), outlined along the whole end wall (a gable's verge is outline only)
  for (const [e, hx, joined] of [[-1, h0, join.start], [1, h1, join.end]]) {
    if (joined) continue;
    const c0 = [e * A, -B], c1 = [e * A, B];
    if (clip > 0) facet([[e * A, -clip * B], [e * A, clip * B], [hx, 0]], [e, 0], [[c0, c1]]);
    else out.push({ poly: [], down: [0, 0], eaveAngle: 0, eaves: [[c0, c1].map(map)], flat: false });
  }
  const ridge = h1 > h0 ? [map(r0), map(r1)] : null;
  const crs = creases.map((c) => ({ seg: c.seg.map(map), kind: c.kind }));
  // A hip whose corner a flush wing covers (b.cut: [x sign, y sign, d] in the building's frame) starts where the
  // wing's roof ends, d in from the corner along both sides
  for (const [ex, ey, d] of Array.isArray(b.cut) ? b.cut : []) {
    for (const c of crs) {
      if (c.kind !== "hip") continue;
      const [p] = c.seg;
      if (Math.abs(p[0] - (ex * b.len) / 2) < 1e-6 && Math.abs(p[1] - (ey * b.dep) / 2) < 1e-6) c.seg = [[ex * (b.len / 2 - d), ey * (b.dep / 2 - d)], c.seg[1]];
    }
  }
  for (let k = crs.length - 1; k >= 0; k--) {
    const [p, q] = crs[k].seg;
    // A cut longer than the hip, or a crease of no length, is dropped
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6 || (crs[k].kind === "hip" && (Math.abs(p[0]) < Math.abs(q[0]) - 1e-9 || Math.abs(p[1]) < Math.abs(q[1]) - 1e-9))) crs.splice(k, 1);
  }
  return finish(out, { ridge, creases: crs, caps: [...(ridge ? [ridge] : []), ...crs.filter((c) => c.kind === "hip").map((c) => c.seg)] });
}

/** A flat roof behind a parapet; a wing's joined ends have none, so wing and house read as one roof. */
function flatFacets(b) {
  const A = b.len / 2, B = b.dep / 2;
  const w = Math.min(0.1, Math.min(A, B) * 0.25);
  const js = !!b.join?.start, je = !!b.join?.end;
  // A joined end's roof reaches on, between its own walls, over the parapet of the roof it joins
  const poly = [[-A, -B], [A, -B], ...(je ? [[A, -B + w], [A + w, -B + w], [A + w, B - w], [A, B - w]] : []), [A, B], [-A, B], ...(js ? [[-A, B - w], [-A - w, B - w], [-A - w, -B + w], [-A, -B + w]] : [])];
  return finish([{ poly, down: [0, 0], eaveAngle: 0, eaves: [], flat: true }], { parapet: { w, joined: { start: js, end: je } } });
}

/** A mansard: four steep slopes round a flat top, with a skylight along it when there's room. */
function mansardFacets(b) {
  const A = b.len / 2, B = b.dep / 2;
  const m = Math.min(A, B) * 0.38; // the steep slopes' width in plan
  const a = A - m, c = B - m;
  const out = [];
  const facet = (poly, down, eaves) => out.push({ poly, down, eaveAngle: 0, eaves, flat: false });
  facet([[-A, -B], [A, -B], [a, -c], [-a, -c]], [0, -1], [[[-A, -B], [A, -B]]]);
  facet([[-A, B], [A, B], [a, c], [-a, c]], [0, 1], [[[-A, B], [A, B]]]);
  facet([[-A, -B], [-A, B], [-a, c], [-a, -c]], [-1, 0], [[[-A, -B], [-A, B]]]);
  facet([[A, -B], [A, B], [a, c], [a, -c]], [1, 0], [[[A, -B], [A, B]]]);
  const top = [[-a, -c], [a, -c], [a, c], [-a, c]];
  out.push({ poly: top, down: [0, 0], eaveAngle: 0, eaves: [[top[0], top[1]], [top[1], top[2]], [top[2], top[3]], [top[3], top[0]]], flat: true });
  const hips = [[[-A, -B], [-a, -c]], [[A, -B], [a, -c]], [[A, B], [a, c]], [[-A, B], [-a, c]]];
  const along = a >= c;
  // Along the flat top's longer side, inside it
  const skylight = Math.max(a, c) > 0.15 && Math.min(a, c) > 0.08 ? { cx: 0, cy: 0, len: a * (along ? 1.1 : 0.9), dep: c * (along ? 0.9 : 1.1) } : null;
  return finish(out, { creases: hips.map((seg) => ({ seg, kind: "hip" })), caps: hips, skylight });
}

/** A round building's cone: wedges round the centre, each lit by the way it faces. */
function coneFacets(b) {
  const R = Math.min(b.len, b.dep) / 2;
  const n = 16;
  const out = [];
  for (let k = 0; k < n; k++) {
    const t0 = (k / n) * 2 * Math.PI, t1 = ((k + 1) / n) * 2 * Math.PI, tm = (t0 + t1) / 2;
    const p0 = [R * Math.cos(t0), R * Math.sin(t0)], p1 = [R * Math.cos(t1), R * Math.sin(t1)];
    out.push({ poly: [[0, 0], p0, p1], down: [Math.cos(tm), Math.sin(tm)], eaveAngle: 0, eaves: [[p0, p1]], flat: false });
  }
  return finish(out, { finial: true });
}
