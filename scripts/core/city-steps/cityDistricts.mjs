// One step of making a city's plan from Quick Start's choices (quick-city.mjs, cityPlan): ctx holds what the steps share.
import { PAVINGS, squareShape } from "../squares.mjs";
import { area, centroid, difference, intersect, offset, union } from "../lots/poly.mjs";
import { assignCharacters, biggest, densify, distToSeg, harborRun, norm, outline, pt, r1, tidyRing } from "../quick-city.mjs";
import { pathTouchesPolygon, polygonCrossesItself, shapeToPolygon } from "../geom.mjs";
import { rng } from "../rng.mjs";

/**
 * The central square, where the main roads meet
 * (a green: the main roads meet on a grass square)
 * (its paving and shape from a stream of its own: a circle, a rectangle or an irregular market place)
 */
export function cityDistricts(ctx) {
  const { C, H, R, S, W, choices, features, inWater, ringPoly, roads, seed, wards } = ctx;
  const sr = rng(seed, "quick", "city-square");
  const spin = sr.next() * Math.PI, main = roads.find((rd) => rd.angle !== undefined); // (a rectangle lies along a main road)
  const sh = squareShape({ r: sr.fork("shape"), C, angle: main ? main.angle : spin, rad: S.square, kinds: ["circle", "rect", "irregular"] });
  // (a cathedral or palace at the center stands beside a paved square, as a market square does)
  const square = choices.center === "green"
    ? { id: "square", type: "square", shape: { circle: [r1(C[0]), r1(C[1]), S.square] }, surface: "grass", name: "The green" }
    : { id: "square", type: "square", shape: sh.shape, surface: sr.pick(PAVINGS), market: true, name: "The market square" };
  if (choices.center !== "none") features.push(square);

  // Districts: the wards, dense throughout, numbered around from the north
  const order = wards.map((poly) => ({ poly: outline(poly), c: centroid(poly) }))
    .filter((w) => w.poly.length >= 3)
    .sort((a, b) => norm(Math.atan2(a.c[1] - C[1], a.c[0] - C[0]) + Math.PI / 2) - norm(Math.atan2(b.c[1] - C[1], b.c[0] - C[0]) + Math.PI / 2) || Math.hypot(a.c[0] - C[0], a.c[1] - C[1]) - Math.hypot(b.c[0] - C[0], b.c[1] - C[1]));
  // Points the same up to rounding become one point, so shared corners stay shared
  const all = order.flatMap((w) => w.poly);
  for (const p of all) for (const q of all) if (p !== q && Math.abs(p[0] - q[0]) < 0.15 && Math.abs(p[1] - q[1]) < 0.15 && Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.15) { q[0] = p[0]; q[1] = p[1]; }
  // A corner of one ward lying on another's side goes into that side too, so the two share it exactly (only where the
  // ward runs along that side from the corner)
  const along = (u, v) => { const lu = Math.hypot(...u) || 1, lv = Math.hypot(...v) || 1; return Math.abs(u[0] * v[1] - u[1] * v[0]) / (lu * lv) < 0.1; }; ctx.along = along;
  for (const w of order) w.poly.forEach((p, i) => {
    const prev = w.poly[(i + w.poly.length - 1) % w.poly.length], next = w.poly[(i + 1) % w.poly.length];
    for (const o of order) {
      if (o === w || o.poly.some((q) => q[0] === p[0] && q[1] === p[1])) continue;
      const k = o.poly.findIndex((a, j) => {
        const b = o.poly[(j + 1) % o.poly.length], side = [b[0] - a[0], b[1] - a[1]];
        return distToSeg(p, a, b) < 0.12 && (along(side, [prev[0] - p[0], prev[1] - p[1]]) || along(side, [next[0] - p[0], next[1] - p[1]]));
      });
      if (k >= 0) o.poly.splice(k + 1, 0, [p[0], p[1]]);
    }
  });
  const districts = order.map((w, k) => ({
    id: `ward-${k + 1}`, type: "district",
    profile: "city", // dense inside the walls, its character setting how dense
    shape: tidyRing(outline(w.poly)),
  })).filter((d) => d.shape.length >= 3); ctx.districts = districts;
  // Last repairs: an outline crossing itself is untangled (its biggest piece kept), and where two wards still overlap
  // the smaller gives way
  const inset = (poly) => offset([poly], -0.03);
  for (const d of districts) if (polygonCrossesItself(d.shape)) { const u = biggest(union([d.shape])); if (u) d.shape = tidyRing(outline(u)); }
  for (let i = 0; i < districts.length; i++) for (let j = i + 1; j < districts.length; j++) {
    const a = districts[i], b = districts[j];
    const shared = intersect(inset(a.shape), inset(b.shape)).reduce((n, p) => n + area(p), 0);
    if (shared <= 0.02) continue;
    const [small, big] = area(a.shape) < area(b.shape) ? [a, b] : [b, a];
    const left = biggest(difference([small.shape], offset([big.shape], 0.06) ?? [big.shape])); // (a little past its edge, so rounding the corners to a tenth can't bring them back over)
    small.shape = left ? tidyRing(outline(left)) : [];
  }
  for (let k = districts.length - 1; k >= 0; k--) if (districts[k].shape.length < 3 || area(districts[k].shape) < 4 || polygonCrossesItself(districts[k].shape)) districts.splice(k, 1);
  // A ward no road reaches (cut off between the water and the old wall) gets a street in from the nearest road, on
  // dry ground; failing that it's left as open ground
  const roadPts = roads.flatMap((rd) => densify(rd.path, 0.5).map((p) => ({ p, rd })));
  for (let k = districts.length - 1; k >= 0; k--) {
    const d = districts[k];
    if (roads.some((rd) => pathTouchesPolygon(rd.path, d.shape))) continue;
    const mid = centroid(d.shape);
    const best = roadPts.map((x) => ({ ...x, l: Math.hypot(x.p[0] - mid[0], x.p[1] - mid[1]) })).filter((x) => x.l < R * 0.6 && !densify([mid, x.p], 0.4).some((q) => inWater(q))).sort((a, b) => a.l - b.l)[0];
    if (best) roads.push({ id: `${d.id}-street`, type: "road", class: "street", surface: "cobble", path: [pt(best.p), pt(mid)] });
    else districts.splice(k, 1);
  }
  const lead = choices.center === "cathedral" ? "temple" : choices.center === "palace" ? "nobles" : null;
  // (a cathedral's or palace's quarter is kept: the landmark is its)
  const allow = Array.isArray(choices.quarters) ? new Set([...choices.quarters, ...(lead ? [lead] : [])]) : null;
  const citadel = assignCharacters({ lead, allow, wantCitadel: choices.citadel, districts, C, R, S, size: choices.size, sea: ctx.sea, lake: ctx.lake, rivers: ctx.rivers, island: ctx.island, ringPoly, oldPoly: ctx.oldPoly, gateRoads: roads.filter((rd) => rd.angle !== undefined), allRoads: roads.map((rd) => rd.path), squarePoly: choices.center !== "none" ? shapeToPolygon(square.shape) : null, harbor: !!(ctx.sea ?? ctx.lake) && (!ringPoly || !!harborRun({ shore: ctx.sea ?? ctx.lake, ringPoly, river: ctx.river, W, H })), r: rng(seed, "quick", "city-wards") }); ctx.citadel = citadel;
}
