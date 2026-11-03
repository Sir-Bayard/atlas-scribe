/**
 * A district's anchor: the landmark its character is known by, placed before its streets, on its own square or
 * forecourt (Patrick, 1 Nov, after the research on fantasy city maps: landmarks first, drawn larger than life, with
 * open ground around them; the square steers the district's streets toward it). A temple quarter's cathedral with
 * its cloister and yard, the nobles' palace with its forecourt and formal garden, the market square and its hall, a
 * merchants' or crafts guildhall, the docks' customs house with cranes, the garrison's keep on its parade ground, the
 * poor quarter's shrine and well. Where it stands depends only on the district's shape and roads, never its seed, so
 * rerolling the district doesn't move it (the seed picks only its small details). Everything in squares. Pure.
 */
import { marketStalls } from "./market.mjs";
import { PAVINGS } from "../squares.mjs";
import { pointInPolygon, distanceToPath, polygonsOverlap } from "../geom.mjs";
import { centroid, area } from "../lots/poly.mjs";
import { characterOf } from "../character.mjs";

const DEG = Math.PI / 180;
/** How much bigger than life a landmark is drawn (the old city views' convention). */
const GRAND = 1.5;
const SCALE = { hamlet: 0.5, village: 0.7, town: 1, city: 1.15 };

/**
 * Each anchor's block in feet (w along the district's axis, h across) and how it's laid out (see layAnchor).
 * Before GRAND and the profile's scale.
 */
export const BLOCKS = {
  temple: { w: 180, h: 240 },
  nobles: { w: 190, h: 220 },
  market: { w: 170, h: 120 },
  merchants: { w: 110, h: 120 },
  crafts: { w: 110, h: 120 },
  docks: { w: 120, h: 80 },
  garrison: { w: 160, h: 150 },
  poor: { w: 60, h: 50 },
};

const rectAt = ([x, y], w, h, rot) => {
  const c = Math.cos(rot * DEG), s = Math.sin(rot * DEG);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + (a * w) / 2 * c - (b * h) / 2 * s, y + (a * w) / 2 * s + (b * h) / 2 * c]);
};

/**
 * Where a district's anchor stands: the block (w by h squares, turned to the district's main road) that fits inside
 * it, clear of its roads, water and anything placed, nearest its middle (a market's nearest a road). district: the
 * plan feature; poly: its polygon; roads: [{ path, width }] in or beside it; water: [{ path, clear }]; blocked:
 * polygons it must keep off; ftPerSquare. Returns { at, rot, w, h, kind } or null (no character with an anchor, a
 * hamlet, or no room).
 */
export function anchorFor({ district, poly, roads = [], water = [], blocked = [], ftPerSquare }) {
  const kind = characterOf(district);
  const B = BLOCKS[kind];
  if (!B || district.anchor === false || district.profile === "hamlet" || district.profile === "roadside") return null;
  const scale = (SCALE[district.profile] ?? 1) * GRAND;
  // Its axis: the longest road through the district, else its own axis setting, else level
  let rot = Number.isFinite(district.axis) ? district.axis : 0, best = 0;
  for (const w of roads) for (let i = 1; i < w.path.length; i++) {
    const [ax, ay] = w.path[i - 1], [bx, by] = w.path[i];
    const l = Math.hypot(bx - ax, by - ay);
    if (l > best && pointInPolygon([(ax + bx) / 2, (ay + by) / 2], poly)) { best = l; rot = Math.atan2(by - ay, bx - ax) / DEG; }
  }
  const [cx, cy] = centroid(poly);
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // (turned a quarter at each size, then smaller, down to about half, before a ward goes without: a city's wards are
  // crowded with streets)
  for (const shrink of [1, 0.85, 0.7, 0.55]) for (const turn of [0, 90]) {
    const w = (B.w * scale * shrink) / ftPerSquare, h = (B.h * scale * shrink) / ftPerSquare, rt = rot + turn;
    const half = Math.hypot(w, h) / 2;
    // (how far the turned block reaches from its middle, across and down)
    const c = Math.abs(Math.cos(rt * DEG)), sn = Math.abs(Math.sin(rt * DEG));
    const ex = (w * c + h * sn) / 2, ey = (w * sn + h * c) / 2;
    let pick = null;
    const step = Math.max(0.5, Math.min(w, h) / 6);
    for (let y = y0 + ey; y <= y1 - ey + 1e-9; y += step) for (let x = x0 + ex; x <= x1 - ex + 1e-9; x += step) {
      if (Math.hypot(x - cx, y - cy) > half * 4 + 10 && pick) continue;
      const box = rectAt([x, y], w, h, rt);
      if (!box.every((p) => pointInPolygon(p, poly))) continue;
      // Clear of roads by their width, and of water and whatever was placed before (a square, a park, a building)
      const roadGap = Math.min(Infinity, ...roads.map((r) => distanceToPath([x, y], r.path) - r.width / 2));
      if (roads.some((r) => r.path.some((p) => pointInPolygon(p, box)) || box.some((p, k) => distanceToPath(p, r.path) < r.width / 2 + 0.2) || segHits(box, r.path))) continue;
      if (water.some((wt) => box.some((p) => distanceToPath(p, wt.path) < (wt.clear ?? 0) + 0.3) || wt.path.some((p) => pointInPolygon(p, box)))) continue;
      if (blocked.some((b) => polygonsOverlap(box, b))) continue;
      // Nearest the middle; a market and the docks' square want a road beside them
      const mid = Math.hypot(x - cx, y - cy);
      const score = mid + (kind === "market" || kind === "docks" ? Math.max(0, roadGap - 1) * 0.6 : 0);
      if (!pick || score < pick.score) pick = { score, at: [x, y] };
    }
    if (pick) return { at: pick.at, rot: rt, w, h, kind, scale: scale * shrink };
  }
  return null;
}

/** True when a point is inside a convex quadrilateral. */
function inQuad([x, y], q) {
  let sign = 0;
  for (let k = 0; k < 4; k++) {
    const [ax, ay] = q[k], [bx, by] = q[(k + 1) % 4];
    const c = Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax));
    if (c && sign && c !== sign) return false;
    if (c) sign = c;
  }
  return true;
}

/** True when any of a path's segments crosses a box's edges. */
function segHits(box, path) {
  const cross = (a, b, c, d) => {
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
  };
  for (let i = 1; i < path.length; i++) for (let k = 0; k < 4; k++) if (cross(path[i - 1], path[i], box[k], box[(k + 1) % 4])) return true;
  return false;
}

/**
 * The anchor laid out: { block (its outline, kept clear of plots), radial: { at, radius } (steers the district's
 * streets), buildings: [{ key, spec }] (addBuilding specs; the first is the landmark), surfaces: [{ class, poly,
 * surface }], props: [{ class, x, y, rot, size }] (size across in feet), trees: [{ x, y, s, species, size }],
 * walls: [path], hedges: [path] (clipped box), approach: [point, direction] (a
 * street runs out from there to the town) }. a: from anchorFor; r: the
 * district's stream for its details; ftPerSquare.
 */
export function layAnchor(a, r, ftPerSquare) {
  const sq = (ft) => (ft * a.scale) / ftPerSquare; // feet in the anchor's own (grand) scale
  const ux = Math.cos(a.rot * DEG), uy = Math.sin(a.rot * DEG), nx = -uy, ny = ux;
  const P = (u, v) => [a.at[0] + ux * u + nx * v, a.at[1] + uy * u + ny * v];
  const box = (u, v, w, h) => rectAt(P(u, v), w, h, a.rot);
  const spec = (u, v, w, h, extra, turn = 0) => { const [x, y] = P(u, v); return { shape: { rect: [x - w / 2, y - h / 2, x + w / 2, y + h / 2] }, rot: a.rot + turn, chimney: false, grand: true, ...extra }; };
  const W = a.w, H = a.h; // in squares
  const out = { block: rectAt(a.at, W, H, a.rot), radial: null, buildings: [], surfaces: [], props: [], trees: [], walls: [], hedges: [] };
  const fountain = (u, v, ft = 30) => { const [x, y] = P(u, v); out.props.push({ class: "fountain", x, y, rot: a.rot, size: ft * a.scale }); };
  // (each centerpiece's square paved in its own way, from a stream of its own)
  const paving = r.fork("paving").pick(PAVINGS);
  const plaza = (v0, v1, surface = paving, u0 = -W / 2, u1 = W / 2) => out.surfaces.push({ class: "plaza", poly: [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)], surface });

  switch (a.kind) {
    case "temple": {
      // A paved square before the west front, the cathedral across the block, its cloister and yard behind
      const front = -H / 2 + sq(55);
      plaza(-H / 2, front);
      fountain(0, (-H / 2 + front) / 2, 28);
      const L = sq(150), Wn = sq(36), Ws = sq(26), Tx = (Wn + sq(70)) / 2; // Tx: how far the transept reaches each side
      const nv = front + sq(8) + Tx; // the nave's middle, across the block
      // Nave, transepts, the round apse at the east end (+u), two towers at the west front (-u)
      out.buildings.push({ key: "nave", spec: spec(0, nv, L, Wn, { roof: "tile-green", roofStyle: "gable", height: 60, use: "temple" }) });
      out.buildings.push({ key: "transept", spec: spec(L * 0.18, nv, sq(34), Wn + sq(70), { roof: "tile-green", roofStyle: "gable", height: 55, use: "temple" }) });
      { const [x, y] = P(L / 2 + sq(4), nv); out.buildings.push({ key: "apse", spec: { shape: { circle: [x, y, Wn / 2] }, rot: a.rot, roof: "tile-green", roofStyle: "cone", height: 50, chimney: false, grand: true, use: "temple" } }); }
      for (const s of [-1, 1]) out.buildings.push({ key: s < 0 ? "tower1" : "tower2", spec: spec(-L / 2 + Ws / 2 - sq(2), nv + s * (Wn / 2 + Ws / 2 - sq(6)), Ws, Ws, { roof: "tile-green", roofStyle: "pyramid", height: 95, use: "temple" }) });
      // The cloister: four ranges around a square garden, behind the nave
      const cv0 = nv + Tx + sq(4), cs = Math.min(sq(70), H / 2 - cv0 - sq(4));
      if (cs > sq(40)) {
        const cu = -L * 0.15, t = sq(14);
        const c = cv0 + cs / 2;
        out.buildings.push({ key: "cloister1", spec: spec(cu, cv0 + t / 2, cs, t, { roof: "slate", roofStyle: "gable", height: 22, use: "temple" }) });
        out.buildings.push({ key: "cloister2", spec: spec(cu, cv0 + cs - t / 2, cs, t, { roof: "slate", roofStyle: "gable", height: 22, use: "temple" }) });
        for (const s of [-1, 1]) out.buildings.push({ key: s < 0 ? "cloister3" : "cloister4", spec: spec(cu + s * (cs / 2 - t / 2), c, cs - 2 * t + 0.1, t, { roof: "slate", roofStyle: "gable", height: 22, use: "temple", join: { start: true, end: true, inset: 0.05 } }, 90) });
        out.surfaces.push({ class: "garth", poly: box(cu, c, cs - 2 * t, cs - 2 * t) });
        fountain(cu, c, 14);
      }
      // The rest of the block is the temple's yard, walled, with yews
      out.surfaces.push({ class: "churchyard", poly: [P(-W / 2, front), P(W / 2, front), P(W / 2, H / 2), P(-W / 2, H / 2)] });
      out.walls.push([P(-W / 2, front), P(-W / 2, H / 2), P(W / 2, H / 2), P(W / 2, front)]);
      for (let k = 0; k < 6; k++) {
        const [x, y] = P((r.next() - 0.5) * W * 0.9, front + sq(4) + r.next() * (H / 2 - front - sq(8)));
        out.trees.push({ x, y, s: 0.45 + r.next() * 0.15, species: "conifer", size: "small", rot: r.next() * 360, variant: r.int(8) });
      }
      out.radial = { at: P(0, (-H / 2 + front) / 2), radius: Math.min(W, front + H / 2) / 2 };
      break;
    }
    case "nobles": {
      // A palace as a palace reads from above: a walled precinct entered by a gate on the street, a court of honor
      // between two wings running out from the main range toward it, pavilions at the corners and a domed one at the
      // middle, and formal gardens behind on the same axis
      const gate = sq(26), m = sq(10); // (the gate's width; the precinct's margin inside its wall)
      const pw = W - 2 * m - sq(8), pd = sq(34), court = sq(70), wt = sq(28);
      const c0 = -H / 2 + m, c1 = c0 + court; // the court, from just inside the gate to the main range
      const pv = c1 + pd / 2;
      out.buildings.push({ key: "palace", spec: spec(0, pv, pw, pd, { roof: "tile-green", roofStyle: "hip", height: 54, use: "palace" }) });
      // The wings along the court's sides, joined to the main range
      for (const s of [-1, 1]) out.buildings.push({ key: s < 0 ? "wing1" : "wing2", spec: spec(s * (pw / 2 - wt / 2), (c0 + sq(4) + c1) / 2 + 0.02, c1 - c0 - sq(4), wt, { roof: "tile-green", roofStyle: "hip", height: 46, use: "palace", join: { end: true, inset: 0.05 } }, 90) });
      // Pavilions: at the main range's ends (a little proud of it) and at the wings' ends by the gate, square with
      // pyramid roofs; a domed one projecting into the court from the middle of the main range
      const pav = sq(40), wpav = sq(32);
      for (const s of [-1, 1]) out.buildings.push({ key: s < 0 ? "pav1" : "pav2", spec: spec(s * (pw / 2 - pav / 2 + sq(4)), pv, pav, pav + sq(6), { roof: "tile-green", roofStyle: "pyramid", height: 62, use: "palace" }) });
      for (const s of [-1, 1]) out.buildings.push({ key: s < 0 ? "pav3" : "pav4", spec: spec(s * (pw / 2 - wt / 2), c0 + sq(4) + wpav / 2, wpav, wpav, { roof: "tile-green", roofStyle: "pyramid", height: 56, use: "palace" }) });
      out.buildings.push({ key: "front", spec: spec(0, c1 - sq(6), sq(54), sq(16), { roof: "tile-green", roofStyle: "hip", height: 58, use: "palace" }) });
      { const [x, y] = P(0, pv + sq(2)); out.buildings.push({ key: "dome", spec: { shape: { circle: [x, y, sq(16)] }, rot: a.rot, roof: "tile-green", roofStyle: "cone", height: 80, chimney: false, grand: true, use: "palace" } }); }
      // The court of honor: paved, a fountain on the axis
      plaza(c0, c1, "flagstone", -pw / 2 + wt, pw / 2 - wt);
      plaza(-H / 2, c0, "flagstone", -gate / 2, gate / 2); // (the way in through the gate)
      fountain(0, c0 + court * 0.42, 30);
      // The gardens behind: lawn, a parterre of beds either side of a broad walk on the axis, a basin, trees in rows
      const g0 = pv + pd / 2 + sq(8), g1 = H / 2 - m;
      out.surfaces.push({ class: "lawn", poly: [P(-W / 2 + m, g0 - sq(4)), P(W / 2 - m, g0 - sq(4)), P(W / 2 - m, H / 2 - m), P(-W / 2 + m, H / 2 - m)] });
      if (g1 - g0 > sq(40)) {
        const gu0 = -W / 2 + m + sq(14), gu1 = W / 2 - m - sq(14), walk = sq(14), edge = sq(6);
        plaza(g0, g1, "gravel", gu0, gu1);
        const rows = g1 - g0 > sq(90) ? 3 : 2, half = (gu1 - gu0 - walk) / 2 - edge;
        const bh = (g1 - g0 - 2 * edge - (rows - 1) * sq(10)) / rows;
        for (const side of [-1, 1]) for (let rr = 0; rr < rows; rr++) {
          const u0 = side < 0 ? gu0 + edge : walk / 2, v0 = g0 + edge + rr * (bh + sq(10));
          const bed = [P(u0, v0), P(u0 + half, v0), P(u0 + half, v0 + bh), P(u0, v0 + bh)];
          out.surfaces.push({ class: "bed", poly: bed });
          out.hedges.push([...bed, bed[0]]);
          for (const [cu, cv] of [[u0, v0], [u0 + half, v0], [u0 + half, v0 + bh], [u0, v0 + bh]]) { const [x, y] = P(cu, cv); out.props.push({ class: "topiary", x, y, rot: a.rot, size: 9 * a.scale }); }
        }
        fountain(0, (g0 + g1) / 2, 24); // (on the broad walk, clear of the beds)
        for (const su of [-W / 2 + m + sq(6), W / 2 - m - sq(6)]) for (let v = g0 + sq(10); v < g1 - sq(4); v += sq(20)) {
          const [x, y] = P(su, v);
          out.trees.push({ x, y, s: 0.5 + r.next() * 0.1, rot: r.next() * 360, variant: r.int(8) });
        }
      }
      // The precinct's wall all around, open at the gate, with a pier each side of it
      // (the wall stops at each pier)
      out.walls.push([P(-gate / 2 - sq(8), -H / 2 + 0.1), P(-W / 2 + 0.1, -H / 2 + 0.1), P(-W / 2 + 0.1, H / 2 - 0.1), P(W / 2 - 0.1, H / 2 - 0.1), P(W / 2 - 0.1, -H / 2 + 0.1), P(gate / 2 + sq(8), -H / 2 + 0.1)]);
      for (const s of [-1, 1]) out.buildings.push({ key: s < 0 ? "pier1" : "pier2", spec: spec(s * (gate / 2 + sq(4)), -H / 2 + sq(4), sq(8), sq(8), { roof: "slate", roofStyle: "pyramid", height: 22, use: "palace" }) });
      out.radial = { at: P(0, (c0 + c1) / 2), radius: W / 2.5 };
      break;
    }
    case "market": {
      // The whole block is the market square; a long open hall in it, a fountain and a cross
      plaza(-H / 2, H / 2);
      out.buildings.push({ key: "hall", spec: spec(0, H * 0.12, sq(90), sq(32), { roof: "tile-red", roofStyle: "hip", height: 34, use: "market-hall" }) });
      fountain(-W * 0.3, -H * 0.2, 28);
      { const [x, y] = P(W * 0.3, -H * 0.2); out.props.push({ class: "statue", x, y, rot: a.rot, size: 10 * a.scale }); }
      { const [x, y] = P(-W * 0.3, H * 0.3); out.props.push({ class: "well", x, y, rot: a.rot, size: 8 * a.scale }); }
      // Stalls in rows across the square, clear of the hall, the fountain, the statue and the well (at true size,
      // from their own stream, so the rest of the district draws as before)
      {
        const local = (p) => { const dx = p[0] - a.at[0], dy = p[1] - a.at[1]; return [dx * ux + dy * uy, dx * nx + dy * ny]; };
        const marks = out.props.map((p) => [p.x, p.y, (p.size ?? 10) / ftPerSquare / 2 + 0.45]);
        const inside = (p) => { const [u, v] = local(p); return Math.abs(u) < W / 2 - 0.3 && Math.abs(v) < H / 2 - 0.3; };
        const clear = (p) => {
          const [u, v] = local(p);
          if (Math.abs(u) < sq(90) / 2 + 0.45 && Math.abs(v - H * 0.12) < sq(32) / 2 + 0.45) return false;
          return marks.every(([x, y, m]) => Math.hypot(p[0] - x, p[1] - y) > m);
        };
        for (const x of marketStalls({ at: a.at, angle: a.rot, reach: Math.hypot(W, H) / 2, inside, clear, r: r.fork("stalls"), sq: ftPerSquare })) out.props.push(x);
      }
      out.radial = { at: a.at, radius: Math.min(W, H) / 2 };
      break;
    }
    case "merchants":
    case "crafts": {
      // A guildhall around its court, on a paved square (merchants) or behind an open work yard (crafts)
      const front = -H / 2 + sq(40);
      plaza(-H / 2, front, a.kind === "crafts" ? "trodden" : "cobble");
      if (a.kind === "merchants") fountain(0, (-H / 2 + front) / 2, 22);
      const gw = sq(80), gd = sq(26), wl = sq(34);
      const gv = front + sq(4) + gd / 2;
      out.buildings.push({ key: "hall", spec: spec(0, gv, gw, gd, { roof: a.kind === "crafts" ? "tile-brown" : "tile-red", roofStyle: "gable", height: 40, use: "guildhall" }) });
      for (const s of [-1, 1]) out.buildings.push({ key: s < 0 ? "wing1" : "wing2", spec: spec(s * (gw / 2 - gd / 2), gv + gd / 2 + wl / 2 - 0.05, wl, gd * 0.8, { roof: a.kind === "crafts" ? "tile-brown" : "tile-red", roofStyle: "gable", height: 32, use: "guildhall", join: { start: true, inset: 0.05 } }, 90) });
      if (a.kind === "crafts") for (const [k, cls] of ["planks", "cart", "firewood", "barrel", "planks"].entries()) { const [x, y] = P((k - 2) * W * 0.18, (-H / 2 + front) / 2 + (r.next() - 0.5) * sq(10)); out.props.push({ class: cls, x, y, rot: a.rot + (r.next() - 0.5) * 40, size: null }); }
      out.radial = { at: P(0, (-H / 2 + front) / 2), radius: Math.min(W, front + H / 2) / 2 };
      break;
    }
    case "docks": {
      // A paved square with the customs house, cranes and stacked goods
      plaza(-H / 2, H / 2);
      out.buildings.push({ key: "house", spec: spec(0, H * 0.18, sq(70), sq(30), { roof: "slate", roofStyle: "hip", height: 36, use: "customs" }) });
      for (const s of [-1, 1]) { const [x, y] = P(s * W * 0.35, -H * 0.15); out.props.push({ class: "crane", x, y, rot: a.rot + 90 * s, size: 30 * a.scale }); }
      for (let k = 0; k < 6; k++) { const [x, y] = P((r.next() - 0.5) * W * 0.8, -H * 0.3 + r.next() * H * 0.2); out.props.push({ class: r.next() < 0.5 ? "crate" : "barrel", x, y, rot: a.rot + r.next() * 30, size: null }); }
      out.radial = { at: a.at, radius: Math.min(W, H) / 2 };
      break;
    }
    case "garrison": {
      // A keep on one side of a parade ground, walled
      plaza(-H / 2, H / 2, "trodden");
      const ks = sq(60);
      out.buildings.push({ key: "keep", spec: spec(0, H / 2 - ks / 2 - sq(8), ks, ks, { roof: "slate-black", roofStyle: "flat", height: 80, tower: true, crenels: true, use: "keep" }) });
      for (const s of [-1, 1]) { const [x, y] = P(s * (W / 2 - sq(10)), H / 2 - sq(10)); out.buildings.push({ key: s < 0 ? "tower1" : "tower2", spec: { shape: { circle: [x, y, sq(10)] }, rot: a.rot, roof: "slate-black", roofStyle: "flat", height: 50, chimney: false, tower: true, crenels: true, grand: true, use: "keep" } }); }
      out.walls.push([P(-W / 2, -H / 2 + 0.1), P(-W / 2, H / 2), P(W / 2, H / 2), P(W / 2, -H / 2 + 0.1)]);
      out.radial = { at: P(0, -H * 0.15), radius: Math.min(W, H) / 2.5 };
      break;
    }
    case "poor": {
      // A scrap of open ground with a shrine and a well
      plaza(-H / 2, H / 2, "dirt");
      out.buildings.push({ key: "shrine", spec: spec(0, H * 0.2, sq(16), sq(16), { roof: "slate", roofStyle: "pyramid", height: 26, use: "shrine" }) });
      { const [x, y] = P(-W * 0.25, -H * 0.15); out.props.push({ class: "well", x, y, rot: a.rot, size: 8 * a.scale }); }
      out.radial = { at: a.at, radius: Math.min(W, H) / 2 };
      break;
    }
  }
  // Where its square opens onto the town: the middle of its front, facing out (-v)
  out.approach = [P(0, -H / 2), [-nx, -ny]];
  out.center = a.at;
  out.rot = a.rot;
  // Nothing of it stands outside its block (whatever a small block squeezed out is left off)
  const inBlock = ([x, y]) => { const du = (x - a.at[0]) * ux + (y - a.at[1]) * uy, dv = (x - a.at[0]) * nx + (y - a.at[1]) * ny; return Math.abs(du) <= W / 2 + 0.05 && Math.abs(dv) <= H / 2 + 0.05; };
  const cornersOf = (b) => (b.shape.circle ? (([x, y, rr]) => [[x - rr, y], [x + rr, y], [x, y - rr], [x, y + rr]])(b.shape.circle) : (([x0, y0, x1, y1]) => rectAt([(x0 + x1) / 2, (y0 + y1) / 2], x1 - x0, y1 - y0, b.rot))(b.shape.rect));
  const main = out.buildings[0];
  out.buildings = out.buildings.filter((b) => cornersOf(b.spec).every(inBlock));
  // The landmark itself squeezed out: no anchor at all (another part mustn't stand in for it)
  if (out.buildings[0] !== main) return null;
  // No tree or prop stands in a building
  const foot = (b) => (b.shape.circle ? (([x, y, rr]) => (p) => Math.hypot(p[0] - x, p[1] - y) < rr + 0.15)(b.shape.circle) : (([x0, y0, x1, y1]) => { const q = rectAt([(x0 + x1) / 2, (y0 + y1) / 2], x1 - x0 + 0.3, y1 - y0 + 0.3, b.rot); return (p) => inQuad(p, q); })(b.shape.rect));
  const feet = out.buildings.map((b) => foot(b.spec));
  out.trees = out.trees.filter((t) => !feet.some((f) => f([t.x, t.y])));
  out.props = out.props.filter((t) => !feet.some((f) => f([t.x, t.y])));
  out.w = W;
  out.h = H;
  return out;
}
