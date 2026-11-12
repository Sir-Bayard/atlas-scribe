/**
 * Buildings of their own, on one plot or several joined along the street: a temple (nave, chancel and tower, with
 * transepts when it's big) in its yard; a mansion set back in walled grounds with a drive and a garden; a long
 * warehouse; barracks in ranges around a yard; an inn with a stable across its yard. Everything in squares. Pure.
 */
import { union, area } from "./poly.mjs";

const DEG = Math.PI / 180;
/** A roof form for a long range: a mansard or pyramid becomes a hip there (as on a winged house), flat stays flat. */
const plainStyle = (style) => (style === "mansard" || style === "pyramid" ? "hip" : style ?? "gable");

/** The four corners of a rectangle centered at (cx, cy), len along the angle rot (degrees), dep across it. */
export function rectCorners(cx, cy, len, dep, rot) {
  const ux = Math.cos(rot * DEG), uy = Math.sin(rot * DEG);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [cx + (a * len) / 2 * ux - (b * dep) / 2 * uy, cy + (a * len) / 2 * uy + (b * dep) / 2 * ux]);
}

/** A building spec (as addBuilding takes it) for a rectangle centered at (cx, cy). */
const spec = (cx, cy, len, dep, rot, extra) => ({ shape: { rect: [cx - len / 2, cy - dep / 2, cx + len / 2, cy + dep / 2] }, rot, ...extra });
/** The end of a part q (its x runs along its rot) that meets the building centered at (cx, cy): valleys there. */
const joinTo = (q, cx, cy) => (Math.cos(q.rot * DEG) * (q.cx - cx) + Math.sin(q.rot * DEG) * (q.cy - cy) > 0 ? { start: true, inset: 0.05 } : { end: true, inset: 0.05 });

/**
 * A ring without repeated points or slits: plots that almost touch leave a hairline crack in their union, which
 * shows as a spike going in and straight back out (a wall drawn along it would cut through the building), and plots
 * fanning out around a bend leave a wedge between them. A point where the outline turns back on itself fairly sharply
 * with the two sides closer than width (squares) goes, as does a notch narrower than 60 degrees; a plot's long thin
 * tail stays.
 */
export function cleanRing(poly, width = 0.15) {
  let pts = poly.slice();
  const turn = Math.sign(area2(pts)) || 1; // the ring's winding: a point turning the other way is a notch
  for (let changed = true; changed && pts.length > 3; ) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const p = pts[(i + pts.length - 1) % pts.length], c = pts[i], n = pts[(i + 1) % pts.length];
      const ax = p[0] - c[0], ay = p[1] - c[1], bx = n[0] - c[0], by = n[1] - c[1];
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      let drop = la < 1e-3;
      if (!drop && lb > 1e-6) {
        const cos = (ax * bx + ay * by) / (la * lb);
        const gap = Math.abs(ax * by - ay * bx) / Math.max(la, lb); // the nearer end's distance from the farther side
        const notch = Math.sign(-ax * by + ay * bx) === -turn; // (c - p) x (n - c), against the ring's winding
        drop = (cos > 0.94 && gap < width) || (notch && cos > 0.5); // a narrow crack under 20 degrees, a notch under 60 (a plot's real thin tail stays)
      }
      if (drop) { pts.splice(i, 1); changed = true; i--; }
    }
  }
  return pts.length >= 3 ? pts : poly;
}

/** Twice a ring's signed area. */
function area2(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; s += x0 * y1 - x1 * y0; }
  return s;
}

/**
 * Plots joined into one: their outline (the biggest piece of their union), the front from the first's start to the
 * last's end, the direction along it and inward, the frontage and the shallowest depth.
 */
export function joinLots(list) {
  const polys = union(list.map((l) => l.poly));
  const poly = cleanRing(polys.reduce((a, b) => (!a || area(b) > area(a) ? b : a), null) ?? list[0].poly);
  const a = list[0].front.a, b = list[list.length - 1].front.b;
  const fl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const along = [(b[0] - a[0]) / fl, (b[1] - a[1]) / fl];
  let inward = list[0].inward;
  if (along[0] * -inward[1] + along[1] * inward[0] === 0) inward = [-along[1], along[0]];
  const mid = list.length === 1 ? list[0].front.mid : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return { poly, front: { a, b, mid }, along, inward, frontage: fl, depth: Math.min(...list.map((l) => l.depth)), way: list[0].way, block: list[0].block };
}

/**
 * Lays out a building of its own. form: temple, mansion, warehouse, barracks or inn. lot: joined (joinLots). use:
 * what it's for (a warehouse form can be a stable or an armory). fits(corners): true when a rectangle stands in the
 * plot, clear of the streets. sq(ft). r: its stream. roof, style: the district's picks for it; safeRoof: the roof
 * used instead of thatch on a temple, warehouse or barracks; ownStyles: the district names its own roof styles (else
 * long ranges are gabled); profile, character: the district's; variant: the roof art's variant, shared by every part.
 * Returns null when it doesn't fit, else { parts: [{ key, building, use, wing }], surfaces: [{ class, poly, surface
 * }], gardens: [{ cx, cy, w, d, rot }], trees: [{ x, y, s, species }], walls: [path] (the grounds' wall along the
 * street, with its gate), yard: { at(along, back), from, to, width } where the yard's clutter goes, or null }.
 */
export function layForm({ form, lot, use, fits, sq, r, roof, safeRoof = roof, style, ownStyles = false, profile, character, variant }) {
  const [ux, uy] = lot.along, [nx, ny] = lot.inward;
  const [mx, my] = lot.front.mid;
  const angU = Math.atan2(uy, ux) / DEG;
  const at = (along, back) => [mx + ux * along + nx * back, my + uy * along + ny * back];
  const F = lot.frontage, D = lot.depth;
  const out = { parts: [], surfaces: [], gardens: [], trees: [], walls: [], yard: null };
  const ok = (list) => list.every((q) => fits(rectCorners(q.cx, q.cy, q.len, q.dep, q.rot)));
  const add = (q, key, extra, partUse = use) => out.parts.push({ key, use: partUse, wing: !!q.wing, building: spec(q.cx, q.cy, q.len, q.dep, q.rot, { roof, variant, ...extra }) });
  // A plot's frame as a polygon, from depth b0 to b1 across the width w (centered)
  const band = (w, b0, b1, off = 0) => [at(off - w / 2, b0), at(off + w / 2, b0), at(off + w / 2, b1), at(off - w / 2, b1)];

  if (form === "temple") {
    const big = character === "temple" ? 1.5 : 1;
    const [lo, hi] = profile === "city" ? [100, 130] : profile === "town" ? [80, 110] : [55, 72];
    const L0 = sq((lo + r.next() * (hi - lo)) * big);
    const orients = [0, angU, angU + 90];
    const backs = [0.5, 0.42, 0.58];
    const slides = [0, 0.12, -0.12];
    const tRoof = roof === "thatch" ? safeRoof : roof;
    for (const scale of [1, 0.85, 0.72, 0.6]) {
      const L = L0 * scale, Wn = Math.max(sq(20), L * 0.36);
      const Lc = L * 0.3, Wc = Wn * 0.72, Ws = Math.max(sq(16), Wn * 1.08);
      const cross = L >= sq(85);
      for (const o of orients) {
        const e = [Math.cos(o * DEG), Math.sin(o * DEG)], p = [-e[1], e[0]];
        for (const bk of backs) for (const sl of slides) {
          const [cx, cy] = at(sl * F, bk * D);
          const nave = { cx, cy, len: L, dep: Wn, rot: o };
          const chancel = { cx: cx + e[0] * (L / 2 + Lc / 2 - 0.05), cy: cy + e[1] * (L / 2 + Lc / 2 - 0.05), len: Lc, dep: Wc, rot: o, wing: true };
          const tower = { cx: cx - e[0] * (L / 2 + Ws / 2 - 0.05), cy: cy - e[1] * (L / 2 + Ws / 2 - 0.05), len: Ws, dep: Ws, rot: o, wing: true };
          const arms = [];
          if (cross) {
            const La = Wn * 0.9, Wt = Wn * 0.8, x = cx + e[0] * L * 0.12, y = cy + e[1] * L * 0.12;
            for (const s of [1, -1]) arms.push({ cx: x + p[0] * s * (Wn / 2 + La / 2 - 0.05), cy: y + p[1] * s * (Wn / 2 + La / 2 - 0.05), len: La, dep: Wt, rot: o + 90, wing: true, s });
          }
          if (!ok([nave, chancel, tower, ...arms])) continue;
          add(nave, "nave", { roofStyle: "gable", height: 40, chimney: false, roof: tRoof });
          add(chancel, "chancel", { roofStyle: "gable", height: 32, chimney: false, roof: tRoof, join: joinTo(chancel, cx, cy) });
          for (const a of arms) add(a, a.s > 0 ? "arm1" : "arm2", { roofStyle: "gable", height: 36, chimney: false, roof: tRoof, join: joinTo(a, cx, cy) });
          add(tower, "tower", { roofStyle: "pyramid", height: 65, chimney: false, roof: tRoof });
          out.surfaces.push({ class: "churchyard", poly: lot.poly });
          // A few yews about the yard
          const n = 2 + r.int(3);
          for (let k = 0; k < n * 4 && out.trees.length < n; k++) {
            const t = [mx + ux * (r.next() - 0.5) * F * 0.9 + nx * (0.1 + r.next() * 0.85) * D, my + uy * (r.next() - 0.5) * F * 0.9 + ny * (0.1 + r.next() * 0.85) * D];
            out.trees.push({ x: t[0], y: t[1], s: 0.45 + r.next() * 0.2, species: "conifer", size: "small", rot: r.next() * 360, variant: r.int(8) });
          }
          return out;
        }
      }
    }
    return null;
  }

  if (form === "mansion") {
    const Wm = Math.min(F * 0.55, sq(95)), Dm = sq(38 + r.next() * 10);
    const ww = Dm * 0.6, wl = Math.max(Wm * 0.4, ww * 1.3);
    const winged = r.next() < 0.75;
    for (const bk of [0.38, 0.32, 0.45, 0.28]) {
      const back = Math.max(D * bk, Dm / 2 + sq(25));
      const [cx, cy] = at(0, back);
      const main = { cx, cy, len: Wm, dep: Dm, rot: angU };
      const wings = winged ? [-1, 1].map((s) => { const [x, y] = at(s * (Wm / 2 - ww / 2), back + Dm / 2 + wl / 2 - 0.05); return { cx: x, cy: y, len: wl, dep: ww, rot: angU + 90, wing: true, s }; }) : [];
      if (back + Dm / 2 + (winged ? wl : 0) > D * 0.92 || !ok([main, ...wings])) continue;
      const mstyle = style === "flat" || style === "pyramid" ? "hip" : style;
      add(main, "house", { roofStyle: winged && mstyle === "mansard" ? "hip" : mstyle, height: 30 });
      for (const w of wings) add(w, w.s > 0 ? "wing1" : "wing2", { roofStyle: mstyle === "mansard" ? "hip" : mstyle, height: 26, chimney: false, join: joinTo(w, cx, cy) });
      // The drive from the gate to the door, the garden behind, an avenue of trees along the drive
      const front = back - Dm / 2;
      out.surfaces.push({ class: "drive", poly: band(sq(12), 0.05, front), surface: "gravel" });
      const gd = Math.min(D * 0.92 - (back + Dm / 2 + (winged ? wl : 0)) - sq(4), sq(70));
      if (gd > sq(15)) { const [gx, gy] = at(0, back + Dm / 2 + (winged ? wl : 0) + sq(3) + gd / 2); out.gardens.push({ cx: gx, cy: gy, w: Wm * 0.9, d: gd, rot: angU }); }
      for (let t = sq(14); t < front - sq(6); t += sq(22)) for (const s of [-1, 1]) {
        const [x, y] = at(s * sq(14), t);
        out.trees.push({ x, y, s: 0.5 + r.next() * 0.15, rot: r.next() * 360, variant: r.int(8) });
      }
      // A coach house to one side, near the front
      const side = r.next() < 0.5 ? -1 : 1;
      const [hx, hy] = at(side * (F / 2 - sq(22)), sq(26));
      const coach = { cx: hx, cy: hy, len: sq(30), dep: sq(18), rot: angU };
      if (F > Wm + sq(50) && ok([coach])) add(coach, "coach", { roofStyle: ownStyles ? plainStyle(style) : "gable", height: 18, chimney: false }, "stable");
      // The grounds' wall along the street, open at the drive
      const a = lot.front.a, b = lot.front.b, inset = 0.12;
      const g0 = F / 2 - sq(8), g1 = F / 2 + sq(8);
      const pt = (t) => [a[0] + ux * t + nx * inset, a[1] + uy * t + ny * inset];
      if (g0 > 0.2) out.walls.push([pt(0.05), pt(g0)]);
      if (F - g1 > 0.2) out.walls.push([pt(g1), pt(F - 0.05)]);
      out.grounds = true;
      return out;
    }
    return null;
  }

  if (form === "warehouse") {
    const W = Math.min(F * 0.9, sq(use === "stable" ? 70 : 60));
    const Dw = Math.min(D * 0.75, sq(use === "stable" ? 40 : 95));
    if (Dw < sq(25)) return null;
    for (const sb of [sq(2), sq(6)]) {
      const lengthwise = Dw > W * 1.15; // a long warehouse stands gable end to the street
      const [cx, cy] = at(0, sb + Dw / 2);
      const q = lengthwise ? { cx, cy, len: Dw, dep: W, rot: angU + 90 } : { cx, cy, len: W, dep: Dw, rot: angU };
      if (!ok([q])) continue;
      add(q, "main", { roofStyle: ownStyles ? plainStyle(style) : "gable", height: use === "stable" ? 18 : 32, chimney: false, roof: roof === "thatch" && use !== "stable" ? safeRoof : roof });
      out.yard = { at, from: sb + Dw + sq(4), to: Math.min(D * 0.95, sb + Dw + sq(40)), width: F * 0.85 };
      return out;
    }
    return null;
  }

  if (form === "barracks") {
    const W = Math.min(F * 0.9, sq(150)), Dd = Math.min(D * 0.85, sq(140)), t = sq(26), gap = sq(14);
    if (Dd < t * 3 || W < t * 3) return null;
    const sb = sq(3);
    const pieces = [];
    const fl = (W - gap) / 2;
    for (const s of [-1, 1]) { const [x, y] = at(s * (gap / 2 + fl / 2), sb + t / 2); pieces.push({ key: s < 0 ? "front1" : "front2", q: { cx: x, cy: y, len: fl, dep: t, rot: angU } }); }
    { const [x, y] = at(0, sb + Dd - t / 2); pieces.push({ key: "back", q: { cx: x, cy: y, len: W, dep: t, rot: angU } }); }
    for (const s of [-1, 1]) { const [x, y] = at(s * (W / 2 - t / 2), sb + Dd / 2); pieces.push({ key: s < 0 ? "side1" : "side2", q: { cx: x, cy: y, len: Dd - 2 * t + 0.1, dep: t, rot: angU + 90, wing: true } }); }
    if (!ok(pieces.map((p) => p.q))) return null;
    for (const { key, q } of pieces) add(q, key, { roofStyle: ownStyles ? plainStyle(style) : "gable", height: 25, roof: roof === "thatch" ? safeRoof : roof, ...(q.wing ? { chimney: false, join: { start: true, end: true, inset: 0.05 } } : {}) });
    out.surfaces.push({ class: "yard", poly: band(W - 2 * t, sb + t, sb + Dd - t), surface: "trodden" });
    out.yard = { at, from: sb + t + sq(4), to: sb + Dd - t - sq(4), width: W - 2 * t - sq(8) };
    return out;
  }

  if (form === "inn") {
    const Wi = Math.min(F * 0.9, sq(75)), Di = sq(30 + r.next() * 8);
    const yd = Math.min(sq(45), D - Di - sq(30));
    if (yd < sq(15) || Wi < sq(35)) return null;
    const side = r.next() < 0.5 ? -1 : 1;
    for (const sb of [0, sq(4)]) {
      const [cx, cy] = at(0, sb + Di / 2);
      const main = { cx, cy, len: Wi, dep: Di, rot: angU };
      const ww = sq(18), wl = Math.min(yd * 0.8, sq(30));
      const [wx, wy] = at(side * (Wi / 2 - ww / 2), sb + Di + wl / 2 - 0.05);
      const wing = { cx: wx, cy: wy, len: wl, dep: ww, rot: angU + 90, wing: true };
      const [sx, sy] = at(0, sb + Di + yd + sq(10));
      const stable = { cx: sx, cy: sy, len: Wi * 0.85, dep: sq(20), rot: angU };
      if (!ok([main, wing, stable])) continue;
      const istyle = style === "flat" ? "gable" : style;
      add(main, "house", { roofStyle: istyle, height: 26 });
      add(wing, "wing", { roofStyle: istyle === "mansard" || istyle === "pyramid" ? "hip" : istyle, height: 22, chimney: false, join: joinTo(wing, cx, cy) });
      add(stable, "stable", { roofStyle: ownStyles ? plainStyle(style) : "gable", height: 16, chimney: false }, "stable");
      out.surfaces.push({ class: "yard", poly: band(Wi * 0.95, sb + Di, sb + Di + yd), surface: "trodden" });
      out.yard = { at, from: sb + Di + sq(3), to: sb + Di + yd - sq(2), width: Wi * 0.8, inn: true };
      return out;
    }
    return null;
  }
  return null;
}
