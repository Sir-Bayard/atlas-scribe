/**
 * What stands on each plot: the house at the street, sometimes an outbuilding behind, sometimes a tended garden,
 * and in hamlets and villages often a croft (a small fenced field) at the back, with the plot's boundary drawn.
 * Everything in squares. Pure: runs anywhere.
 */
import { pointInPolygon, polygonsOverlap } from "../geom.mjs";
import { lotTypeOf } from "./index.mjs";
import { intersect, area, difference } from "./poly.mjs";
import { ROOFS, ROOF_STYLES } from "../plan.mjs";
import { SegGrid, finitePaths } from "../spatial.mjs";
import { gardenShare as gardenShareOf, characterOf, LOOK } from "../character.mjs";
import { USE_INFO } from "../uses.mjs";
import { joinLots, layForm, rectCorners } from "./forms.mjs";

/** A key from { key: weight } for a roll in [0, 1). */
function pickWeighted(roll, weights) {
  const keys = Object.keys(weights);
  const total = keys.reduce((s, k) => s + weights[k], 0);
  let x = roll * total;
  for (const k of keys) if ((x -= weights[k]) < 0) return k;
  return keys[keys.length - 1];
}

/**
 * The roof materials a district's houses choose from: the plan's list, or `palette` of its type's materials
 * picked by weight from the district's own stream, so two villages side by side can look different.
 */
export function roofPalette(district, T, r) {
  const own = (Array.isArray(district.roofs) ? district.roofs : []).filter((x) => ROOFS.includes(x));
  if (own.length) return Object.fromEntries(own.map((x) => [x, 1]));
  const pool = { ...(T.roofs ?? { slate: 1 }) };
  const out = {};
  const pr = r.fork("roofs");
  for (let k = 0; k < (T.palette ?? 3) && Object.keys(pool).length; k++) {
    const x = pickWeighted(pr.next(), pool);
    out[x] = pool[x];
    delete pool[x];
  }
  return out;
}

/** The roof forms a district's houses choose from: the plan's list, or its type's mix. */
function roofStyles(district, T) {
  const own = (Array.isArray(district.roofStyles) ? district.roofStyles : []).filter((x) => ROOF_STYLES.includes(x));
  return own.length ? Object.fromEntries(own.map((x) => [x, 1])) : T.styles ?? { gable: 1 };
}

/** The four corners of a rectangle centered at (cx, cy), len along (ux, uy), dep across it. */
function corners(cx, cy, len, dep, [ux, uy]) {
  const [nx, ny] = [-uy, ux];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [cx + (a * len) / 2 * ux + (b * dep) / 2 * nx, cy + (a * len) / 2 * uy + (b * dep) / 2 * ny]);
}

/** True when a rectangle (its corners) lies in the plot; tested a hair inside its edges, so a house built right
 * on the street line or against its neighbor still counts as fitting. */
const fitsIn = (pts, poly) => {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.every(([x, y]) => pointInPolygon([cx + (x - cx) * 0.96, cy + (y - cy) * 0.96], poly));
};

/**
 * lots: from lotsFor. district: the plan feature. ways: [{ id, path, width }]. blocked: polygons to keep clear of
 * (squares, yards, named buildings). ftPerSquare. r: a stream for the
 * district's plots (each plot forks its own). usesFor(tryForm): planUses for this district, handed the way to try a
 * building of its own on some plots (what it gives: buildings of their own, plots put to a use, plots kept free of
 * thatch); or null for plain houses. The uses it settled on are returned as .uses. Returns { houses, outbuildings, gardens, crofts, bounds, trees, props,
 * surfaces, pits, kilns }: houses and outbuildings are { id, lot, building: { shape, rot, roof, height, chimney,
 * use }, r, smoke? }; gardens { cx, cy, w, d, rot }; crofts polygons; bounds [{ path, class }]; trees { x, y, s, rot,
 * variant, species? }; props { class, x, y, rot, variant }; surfaces { class, poly, surface }; pits { x, y, size, rot,
 * liquid }; kilns { x, y, rad }; walls: [path] stone walls around a temple's yard or a mansion's grounds.
 */
export function buildOnLots({ lots, district, ways, blocked = [], ftPerSquare, r, usesFor = null }) {
  // In the plot, and clear of anything the plot was cut around (a named building inside a block is a hole in it)
  // and clear of every street: the plot already stops at the street, but fitsIn's small tolerance could let a
  // corner over the line. Points along each side are tested too, since a street may bend at a house
  // The ways' segments in a grid, so each test looks only at the streets near it (the answers are the same as
  // testing every street; a way with a broken point or width is tested the slow way)
  const exact = finitePaths(ways.map((w) => w.path)) && ways.every((w) => Number.isFinite(w.width));
  const grid = exact ? new SegGrid(ways.map((w) => w.path)) : null;
  const maxHalf = ways.reduce((m, w) => Math.max(m, w.width / 2), 0);
  const clearAt = grid
    ? (x, y) => { for (const k of grid.near(x, y, maxHalf)) if (!(grid.dist(x, y, k) >= ways[grid.segPath[k]].width / 2 - 0.005)) return false; return true; }
    : (x, y) => ways.every((w) => distToPath([x, y], w.path) >= w.width / 2 - 0.005);
  const clearOfWays = (pts) => pts.every((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return [0, 0.25, 0.5, 0.75].every((t) => clearAt(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t));
  });
  /** True when the point is within 0.1 of a way's edge line. */
  const onWayEdge = grid
    ? (mid) => { let hit = false; grid.eachNear(mid[0], mid[1], maxHalf + 0.1, (p, d) => { if (Math.abs(d - ways[p].width / 2) < 0.1) hit = true; }); return hit; }
    : (mid) => ways.some((w) => Math.abs(distToPath(mid, w.path) - w.width / 2) < 0.1);
  const fits = (pts, poly) => fitsIn(pts, poly) && clearOfWays(pts) && !blocked.some((b) => polygonsOverlap(pts, b));
  /** True when the point is in a blocked shape or within 0.15 of its edge. */
  const byBlocked = (mid) => blocked.some((b) => b.length >= 3 && (pointInPolygon(mid, b) || b.some((c, k) => distToSeg(mid, c, b[(k + 1) % b.length]) < 0.15)));
  const T = lotTypeOf(district);
  const sq = (ft) => ft / ftPerSquare;
  const spacious = Math.max(0, Math.min(1, district.spacious ?? 0));
  const density = district.density ?? 1;
  const gardenShare = gardenShareOf(district);
  const out = { houses: [], outbuildings: [], gardens: [], crofts: [], bounds: [], trees: [], props: [], surfaces: [], pits: [], kilns: [], walls: [] };

  const workUse = (u) => u && u !== "house" && u !== "shop" && u !== "magic-shop";
  const yards = []; // the yards of plots put to a trade: { i, use, at, from, to, width }
  const wayById = new Map(ways.map((w) => [w.id, w]));
  const boundClass = (lr) => (district.profile === "hamlet" || district.profile === "roadside" ? (lr.next() < 0.5 ? "hedge" : "wall") : lr.next() < 0.8 ? "fence" : "wall");

  let croftOf = -1;
  /** A polygon's edges as boundary segments, except those along a street. */
  const addBounds = (p, way, cls, skip = null) => {
    for (let k = 0; k < p.length; k++) {
      const a = p[k], b = p[(k + 1) % p.length];
      if (skip?.(a, b)) continue;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      // Never along a street: this plot's own, or another one at its back or side
      if (onWayEdge(mid)) continue;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.02) continue;
      out.bounds.push({ path: [a, b], class: cls });
    }
  };

  const palette = roofPalette(district, T, r), styles = roofStyles(district, T);
  // A roof that won't catch a forge's sparks: the district's own slate or tile if it has one (a district given only
  // thatch keeps it: the GM's choice)
  const safeRoof = Object.keys(palette).find((x) => !/thatch|wood/.test(x)) ?? Object.keys(palette).find((x) => x !== "thatch") ?? Object.keys(palette)[0];
  // Buildings of their own, laid out as the uses are chosen (a site that doesn't fit is tried on other plots)
  const character = characterOf(district);
  const tryForm = (use, form, picks) => {
    const lot = joinLots(picks.map((k) => lots[k]));
    const sr = r.fork("site", use, picks[0]);
    const roofPick = pickWeighted(sr.next(), palette), stylePick = pickWeighted(sr.next(), styles);
    const made = layForm({ form, lot, use, fits: (pts) => fits(pts, lot.poly), sq, r: sr, roof: roofPick, safeRoof, style: stylePick, ownStyles: Array.isArray(district.roofStyles) && district.roofStyles.length > 0, profile: district.profile, character, variant: sr.int(8) });
    return made ? { ...made, lot, sr } : null;
  };
  const uses = usesFor ? usesFor(tryForm) : null;
  out.uses = uses;
  out.palette = palette; // the roof materials this district's houses use (the layout's block-middle fill takes them too)
  // Plots given to a building of their own are left to it; others may be put to a use
  const inSite = new Set((uses?.sites ?? []).flatMap((st) => st.lots));
  const useOf = uses?.useOf ?? new Map(), noThatch = uses?.noThatch ?? new Set();
  for (const site of uses?.sites ?? []) {
    const { lot, sr, ...made } = site.made;
    // Ids as a house's: the main building, then its parts (w1, w2...), so the window picks and pins it as one
    const base = `l${lot.block}-${site.lots[0]}`;
    made.parts.forEach((p, k) => out.houses.push({ id: k ? `${base}w${k}` : base, lot: site.lots[0], ...(k ? { wing: true } : {}), r: sr.fork(p.key), site: site.use, joined: site.lots.length, building: { ...p.building, use: p.use } }));
    out.surfaces.push(...made.surfaces);
    out.gardens.push(...made.gardens);
    out.trees.push(...made.trees.filter((t) => pointInPolygon([t.x, t.y], lot.poly) && !made.parts.some((p) => pointInPolygon([t.x, t.y], partCorners(p.building)))));
    // A temple's yard and a mansion's grounds are walled (not along the street, but a mansion's has its own there;
    // nor along a square or yard kept clear beside it, or a district's gate, where the street comes in)
    // (and no stub where a curving side is broken into short pieces)
    if (site.form === "temple" || made.grounds) out.walls.push(...edgesOff(lot.poly, (mid) => onWayEdge(mid) || byBlocked(mid)).filter((w) => w.reduce((s, q, i) => s + (i ? Math.hypot(q[0] - w[i - 1][0], q[1] - w[i - 1][1]) : 0), 0) >= 0.15));
    out.walls.push(...made.walls);
    if (made.yard) yards.push({ i: site.lots[0], poly: lot.poly, use: site.use, ...made.yard, rot: Math.atan2(lot.along[1], lot.along[0]) / (Math.PI / 180), parts: made.parts.map((p) => partCorners(p.building)) });
  }
  // Plot lines: off unless the district's plotLines is true (Patrick, 24 Oct, from a side-by-side render: plots show by
  // what's in them). When on, types that fence yards (hamlets, villages) draw yards and crofts; the others draw faint
  // lines between long plots behind the yards
  const linesOn = district.plotLines === true;
  const yardLines = linesOn && !!T.bounds, stripLines = linesOn && !T.bounds;
  const row = { key: null, roof: null, style: null, left: 0 };
  lots.forEach((lot, i) => {
    if (inSite.has(i)) return;
    const lr = r.fork("lot", lot.block, i);
    const use = useOf.get(i) ?? "house", working = workUse(use);
    const firstHouse = out.houses.length, firstOut = out.outbuildings.length;
    // Every choice drawn first, so a plot's dice never depend on what fitted
    const vacant = lr.next() < (1 - Math.min(1, density)) * 0.6;
    const cover = (T.cover[0] + lr.next() * (T.cover[1] - T.cover[0])) * (1 - 0.35 * spacious);
    const hd = sq(T.houseDepth[0] + lr.next() * (T.houseDepth[1] - T.houseDepth[0]));
    const sb = sq(T.setback[0] + lr.next() * (T.setback[1] - T.setback[0]) + 15 * spacious);
    let roof = pickWeighted(lr.next(), palette);
    const turn = (lr.next() - 0.5) * (T.cover[1] < 1 ? 4 : 0); // village houses sit a little askew; terraces don't
    let wantGarden = lr.next() < gardenShare, wantOut = lr.next() < T.outbuilding, wantCroft = lr.next() < (district.crofts ?? T.croft);
    if (working) wantGarden = wantCroft = false; // a workplace's yard is its work
    const gDepth = 0.8 + lr.next() * 0.6, oSize = sq(9 + lr.next() * 9), oSide = lr.next() - 0.5, yard = sq(10 + lr.next() * 15);
    const bClass = boundClass(lr);
    // The house's shape: one rear wing (L), two (U), or two and a back range around a yard (court)
    const shapeRoll = lr.next(), wingLeft = lr.next() < 0.5, wingW = sq(12 + lr.next() * 8), wingL = sq(15 + lr.next() * 20);
    const rowLen = 2 + lr.int(4); // terraces: houses in a row share one roof material
    const variant = lr.int(8); // a house and its wings share one roof
    let style = pickWeighted(lr.next(), styles);
    const oSquare = lr.next() < 0.35; // a square shed, under a pyramid roof
    // Details on the house (Patrick, 24 Oct: the roof forms in Tom Cartos's and others' town maps)
    const X = T.extras ?? {};
    const wantBay = lr.next() < (X.bay ?? 0), wantDormers = lr.next() < (X.dormers ?? 0), wantTurret = lr.next() < (X.turret ?? 0);
    const wantSteps = lr.next() < (X.steps ?? 0), oRound = lr.next() < (X.roundShed ?? 0);
    const wantRear = lr.next() < (X.rear ?? 0); // a stable, workshop or warehouse at the far end, by the back lane
    const dr = lr.fork("details"); // sizes for the details, so their count never moves the plot's other dice
    const [ux, uy] = lot.along, [nx, ny] = lot.inward;
    const [mx, my] = lot.front.mid;
    const ang = (Math.atan2(uy, ux) * 180) / Math.PI;

    // Terraces: a row of houses along one street shares its roof material, so it reads as a row
    if (T.cover[1] >= 1) {
      const key = `${lot.block}|${lot.way}`;
      if (row.key === key && row.left > 0) { roof = row.roof; style = row.style; row.left--; }
      else Object.assign(row, { key, roof, style, left: rowLen - 1 });
    }
    if (roof === "thatch" && noThatch.has(i)) roof = safeRoof;
    // The house, at the front, as wide as its share of the frontage; narrowed if the plot's sides close in
    let house = null;
    if (!vacant) {
      // Narrower, then shallower, then slid along the front, before a plot is left as a yard (odd corner plots)
      const rot = ang + turn;
      const a = (rot * Math.PI) / 180;
      const dir = [Math.cos(a), Math.sin(a)];
      // A house that will have wings keeps its front range shallower, leaving the plot room behind for them
      const S0 = T.shapes ?? {};
      const roll0 = lot.merged ? shapeRoll * 0.35 + (S0.L ?? 0) * 0.8 : shapeRoll; // as the wings are chosen below
      const winged = roll0 < (S0.L ?? 0) + (S0.T ?? 0) + (S0.U ?? 0) + (S0.court ?? 0);
      const plain = Math.min(hd, lot.depth * (T.cover[1] >= 1 ? 0.85 : 0.6));
      const depths = winged ? [Math.min(hd, lot.depth * 0.45), plain, plain * 0.75] : [plain, plain * 0.75];
      search: for (const depth of depths) {
        if (depth < sq(12)) continue;
        for (let w = lot.frontage * cover * 0.98; w > sq(12); w *= 0.85) {
          for (const slide of [0, 0.15, -0.15, 0.3, -0.3]) {
            const off = slide * lot.frontage;
            const cx = mx + nx * (sb + depth / 2) + ux * off, cy = my + ny * (sb + depth / 2) + uy * off;
            if (!fits(corners(cx, cy, w, depth, dir), lot.poly)) continue;
            house = { cx, cy, w, depth, off, rot, dir };
            break search;
          }
        }
      }
    }
    // Wings behind the house, at right angles to it; details on its front
    let reach = house ? sb + house.depth : sb;
    if (house) {
      const { cx, cy, w, depth, rot, dir } = house;
      const [dx, dy] = dir;
      const base = `l${lot.block}-${i}`;
      // The house's own "back": square to its front, on the side away from the street
      const [bx, by] = -dy * nx + dx * ny >= 0 ? [-dy, dx] : [dy, -dx];
      const at = (along, back) => [cx + dx * along + bx * back, cy + dy * along + by * back];
      const S = T.shapes ?? {};
      // Only a house wide enough gets wings, and a wing is never a thin stick: at least 10 ft wide, longer than wide
      // A double plot's house leans to the bigger forms: a courtyard or two wings far more often
      const roll = lot.merged ? shapeRoll * 0.35 + (S.L ?? 0) * 0.8 : shapeRoll;
      const cut = [S.L ?? 0, S.T ?? 0, S.U ?? 0, S.court ?? 0].reduce((a, v) => [...a, (a.at(-1) ?? 0) + v], []);
      const kindWanted = roll < cut[0] ? "L" : roll < cut[1] ? "T" : roll < cut[2] ? "U" : roll < cut[3] ? "court" : null;
      // A wing no wider than the house is deep, so its roof never reaches past the house's ridge
      const kind = !kindWanted || w < sq(22) || depth * 0.95 < sq(10) ? null : kindWanted === "T" && w < sq(26) ? "L" : kindWanted === "U" && w < sq(30) ? "L" : kindWanted === "court" && w < sq(32) ? "U" : kindWanted;
      const parts = [];
      const ww = Math.max(sq(10), Math.min(wingW, w * (kind === "L" ? 0.5 : 0.4), depth * 0.95));
      const wl = Math.max(kind === "court" ? Math.max(wingL, ww * 1.8) : wingL, ww * 1.2);
      const wing = (pos) => {
        // A wing running back from the house (pos -1 and 1: flush with one end; 0: from the middle, a T), overlapping it a little
        const [ox, oy] = at(pos * (w / 2 - ww / 2), depth / 2 + wl / 2 - 0.05);
        return { cx: ox, cy: oy, len: wl, dep: ww, rot: rot + 90, back: depth + wl, wing: true, pos };
      };
      if (kind === "L") parts.push(wing(wingLeft ? -1 : 1));
      if (kind === "T") parts.push(wing(0));
      if (kind === "U" || kind === "court") parts.push(wing(-1), wing(1));
      if (kind === "court") {
        // The back range takes the wings' far ends 0.05 in, as the house takes their near ends
        const [ox, oy] = at(0, depth / 2 + wl - 0.1 + ww / 2);
        parts.push({ cx: ox, cy: oy, len: w, dep: ww, rot, back: depth + wl + ww - 0.1 });
      }
      const rectOf = (q) => { const a = (q.rot * Math.PI) / 180; return corners(q.cx, q.cy, q.len, q.dep, [Math.cos(a), Math.sin(a)]); };
      // Every part must fit the plot, or the house stays a plain block
      const ok = parts.every((q) => fits(rectOf(q), lot.poly));
      const shape = ok ? kind : null;
      // A winged house's roof runs into its wings': a mansard or pyramid becomes a hip there; flat stays flat
      if (shape && (style === "mansard" || style === "pyramid")) style = "hip";
      const pitched = style !== "flat" && style !== "mansard";
      // On a hipped house a wing flush with one end has its outer slope in the plane of the house's hip end: no
      // valley on that side, and the hip at that corner starts where the wing's roof ends (Tom Cartos's L roofs)
      const flushWings = shape && style === "hip" ? parts.filter((q) => q.wing && q.pos) : [];
      const backSign = Math.sign(bx * -dy + by * dx) || 1; // the back, in the house's own frame (y across it)
      const cuts = (ySign) => flushWings.map((q) => [q.pos, ySign, ww / 2]);

      // A long plain house is often built in sections, each with its own roof and ridge: flush at the street, its
      // back and height stepping (Patrick, 24 Oct: stepped roofs)
      const sections = [];
      if (!shape && wantSteps && w > Math.max(depth * 2.2, sq(40))) {
        const n = w > depth * 3.4 ? 3 : 2;
        const cuts = n === 2 ? [0.4 + dr.next() * 0.2] : [0.28 + dr.next() * 0.1, 0.62 + dr.next() * 0.1];
        const edges = [0, ...cuts, 1].map((t) => -w / 2 + t * w);
        for (let k = 0; k < n; k++) {
          const d = depth * (k === 0 ? 1 : 0.8 + dr.next() * 0.2);
          const sw = edges[k + 1] - edges[k];
          const [ox, oy] = at((edges[k] + edges[k + 1]) / 2, -(depth - d) / 2);
          sections.push({ cx: ox, cy: oy, len: sw + (k < n - 1 ? 0.02 : 0), dep: d, height: 18 + Math.round(dr.next() * 8) });
        }
      }
      if (sections.length) {
        sections.forEach((q, k) => out.houses.push({ id: k ? `${base}s${k + 1}` : base, lot: i, ...(k ? { wing: true } : {}), r: lr.fork(k ? `section${k}` : "house"), shape: k ? null : "steps", building: { shape: { rect: [q.cx - q.len / 2, q.cy - q.dep / 2, q.cx + q.len / 2, q.cy + q.dep / 2] }, rot, roof, variant, roofStyle: style, height: q.height, use, ...(k ? { chimney: false } : {}) } }));
      } else {
        // The house first, then its wings: a wing's roof runs on into the house's and must lie over it (the valleys)
        out.houses.push({ id: base, lot: i, r: lr.fork("house"), shape, building: { shape: { rect: [cx - w / 2, cy - depth / 2, cx + w / 2, cy + depth / 2] }, rot, roof, variant, roofStyle: style, height: 20, use, ...(cuts(backSign).length ? { cut: cuts(backSign) } : {}) } });
      }
      // The end of a part that meets the house: its local x runs along its rot; the end nearer the house joins it
      const joinOf = (q) => {
        const a = (q.rot * Math.PI) / 180;
        return Math.cos(a) * (q.cx - cx) + Math.sin(a) * (q.cy - cy) > 0 ? { start: true } : { end: true };
      };
      const push = (q, id, extra) => out.houses.push({ id, lot: i, wing: true, r: lr.fork(id), building: { shape: { rect: [q.cx - q.len / 2, q.cy - q.dep / 2, q.cx + q.len / 2, q.cy + q.dep / 2] }, rot: q.rot, roof, variant, height: 20, chimney: false, use, ...extra } });
      const placed = []; // the house's own parts, which a turret must keep clear of
      // A courtyard's back range before its side wings, whose far ends run into it
      if (shape) [...parts].sort((p1, p2) => (p1.wing ? 1 : 0) - (p2.wing ? 1 : 0)).forEach((q, k) => {
        // Each part is set 0.05 into what it joins (inset), so the valleys start on that roof's real eave
        const join = !q.wing ? null : { ...(kind === "court" ? { start: true, end: true } : joinOf(q)), inset: 0.05, ...(flushWings.includes(q) ? { flush: -q.pos } : {}) };
        const cut = !q.wing && cuts(-backSign).length ? { cut: cuts(-backSign) } : {};
        push(q, `${base}w${k + 1}`, { roofStyle: style, ...(join ? { join } : {}), ...cut });
        placed.push(rectOf(q));
        reach = Math.max(reach, sb + q.back);
      });
      // A bay out to the street under its own small roof, a cross-gable, where the house is set back far enough
      let bay = null;
      if (!sections.length && pitched && wantBay && w >= sq(24)) {
        const bw = Math.min(w * 0.4, sq(10 + dr.next() * 6), depth * 0.95), bd = Math.min(sb * 0.8, sq(5 + dr.next() * 4));
        const [ox, oy] = at((dr.next() - 0.5) * (w - bw) * 0.5, -(depth / 2 + bd / 2 - 0.05));
        const q = { cx: ox, cy: oy, len: bd + 0.05, dep: bw, rot: rot + 90 };
        if (bd >= sq(4) && fits(rectOf(q), lot.poly)) {
          bay = q;
          push(q, `${base}b`, { roofStyle: style === "gable" ? "gable" : "hip", join: { ...joinOf(q), inset: 0.075 } });
          placed.push(rectOf(q));
        }
      }
      // Gables on the front slope of a long roof, the house's roof carrying on around them in valleys: either wall
      // dormers (a short gabled roof running back from the eave) or cross-gables (a gable rising straight from the
      // eave, its two slopes meeting the roof in a pair of valleys), half and half
      if (!sections.length && !bay && pitched && style !== "pyramid" && wantDormers && w >= sq(28)) {
        const n = w >= sq(45) ? 2 : 1;
        const dw = Math.min(sq(8 + dr.next() * 3), w / (n * 2.5));
        const crossGable = dr.next() < 0.5;
        const dl = crossGable ? Math.min(0.04, depth / 2 - dw / 2 - 0.02) : Math.min(depth / 2 - dw / 2 - 0.02, depth * 0.3);
        if (crossGable ? dl > 0.02 : dl >= sq(4)) for (let k = 0; k < n; k++) {
          const along = n === 1 ? (dr.next() - 0.5) * w * 0.3 : (k ? 1 : -1) * w * 0.22;
          // On a hipped roof the front slope narrows towards the ridge: the dormer must sit inside it, clear of the hips
          if (style !== "gable" && Math.abs(along) + dw / 2 + dl > w / 2 - 0.02) continue;
          const [ox, oy] = at(along, -(depth / 2 - dl / 2));
          const q = { cx: ox, cy: oy, len: dl, dep: dw, rot: rot + 90 };
          push(q, `${base}d${k + 1}`, { roofStyle: "gable", join: joinOf(q) });
          placed.push(rectOf(q));
        }
      }
      // A round turret at a corner of a big house, under a cone: at the front where the house stands back from the
      // street, else at the back, on a corner no wing takes
      if (!sections.length && pitched && wantTurret && w >= sq(28) && (!kind || kind === "L" || kind === "T" || !shape)) {
        const tr = sq(5 + dr.next() * 2.5);
        const front = sb >= tr * 1.1;
        const first = dr.next() < 0.5 ? -1 : 1;
        // Either corner on its side, the first that fits the plot and is clear of the house's wings, bay and dormers
        for (const side of [first, -first]) {
          const [ox, oy] = at(side * (w / 2 - tr * 0.4), (front ? -1 : 1) * (depth / 2 - tr * 0.4));
          const sqr = corners(ox, oy, 2 * tr, 2 * tr, dir);
          if (!fits(sqr, lot.poly) || placed.some((p) => polygonsOverlap(sqr, p))) continue;
          out.houses.push({ id: `${base}t`, lot: i, wing: true, r: lr.fork("turret"), building: { shape: { circle: [ox, oy, tr] }, rot, roof, variant, roofStyle: "cone", height: 30, chimney: false, use } });
          if (!front) reach = Math.max(reach, sb + depth + tr * 0.6); // a turret at the back pushes the yard back
          break;
        }
      }
    }
    let behind = reach + 0.15; // how far back from the street the next thing starts
    const houseBack = behind;

    // A tended garden right behind the house
    if (house && wantGarden) {
      for (const d of [gDepth, gDepth * 0.65]) {
        const w = Math.min(house.w * 0.95, lot.frontage * 0.85);
        const cx = mx + nx * (behind + d / 2), cy = my + ny * (behind + d / 2);
        if (fits(corners(cx, cy, w, d, [ux, uy]), lot.poly)) {
          out.gardens.push({ cx, cy, w, d, rot: ang });
          behind += d + 0.1;
          break;
        }
      }
    }
    // A shed, barn or workshop across the yard behind, to one side: small, so it never reads as a second house
    if (house && wantOut) {
      const ow = Math.min(oSize * (oSquare ? 1 : 1.3), lot.frontage * 0.5, house.w * 0.7), od = oSquare ? ow : oSize;
      const side = oSide * Math.max(0, lot.frontage - ow) * 0.8;
      const back = behind + sq(8);
      const cx = mx + nx * (back + od / 2) + ux * side, cy = my + ny * (back + od / 2) + uy * side;
      if (behind + od < lot.depth * 0.9 && fits(corners(cx, cy, ow, od, [ux, uy]), lot.poly)) {
        // A square shed under a pyramid roof, or now and then a round one (a dovecote) under a cone
        const square = Math.abs(ow / od - 1) < 0.15, round = square && oRound;
        const shape = round ? { circle: [cx, cy, Math.min(ow, od) / 2] } : { rect: [cx - ow / 2, cy - od / 2, cx + ow / 2, cy + od / 2] };
        out.outbuildings.push({ id: `l${lot.block}-${i}o`, lot: i, r: lr.fork("out"), building: { shape, rot: ang, roof: roof === "thatch" ? "thatch" : "wood-shingle", roofStyle: round ? "cone" : square ? "pyramid" : "gable", height: round ? 20 : 15, chimney: false, use: working ? "workshop" : uses?.out ?? "shed" } });
        behind = back + od + 0.1;
      }
    }
    // On a long plot, a range at the far end: the stable, workshop or warehouse that the back lane served
    let rearAt = null; // how far back the far-end range starts
    if (house && wantRear && lot.depth - behind > sq(45)) {
      const rw = Math.min(lot.frontage * 0.85, sq(16 + dr.next() * 12)), rd = sq(14 + dr.next() * 8);
      const back = lot.depth - rd / 2 - sq(2);
      const cx = mx + nx * back, cy = my + ny * back;
      if (fits(corners(cx, cy, rw, rd, [ux, uy]), lot.poly)) {
        rearAt = back - rd / 2;
        out.outbuildings.push({ id: `l${lot.block}-${i}r`, lot: i, r: lr.fork("rear"), building: { shape: { rect: [cx - rw / 2, cy - rd / 2, cx + rw / 2, cy + rd / 2] }, rot: ang, roof, variant, roofStyle: "gable", height: 18, chimney: false, use: working ? "workshop" : uses?.rear ?? "stable" } });
      }
    }
    // The yard behind the house ends here; a croft, if any, starts exactly here, so they share one fence
    const reachBack = Math.max(houseBack, behind) + yard;
    // A workplace's yard, for what its trade leaves about (laid out after every plot is built)
    if (house && working) {
      const main = out.houses.find((h) => h.lot === i && !h.wing);
      if (main && USE_INFO[use]?.smoke) main.smoke = USE_INFO[use].smoke;
      yards.push({ i, use, at: (along, back) => [mx + ux * along + nx * back, my + uy * along + ny * back], from: houseBack + sq(3), to: Math.min(lot.depth * 0.9, houseBack + sq(50)), width: lot.frontage * 0.8, rot: ang, first: firstHouse, firstOut });
    }
    // The croft: the back of the plot as a small fenced field
    if (wantCroft && lot.depth * 0.55 > behind) {
      const near = house ? reachBack : Math.max(behind, lot.depth * 0.55);
      const share = Math.max(0.1, Math.min(1, district.croftDepth ?? T.croftDepth ?? 1));
      const far = share >= 1 ? lot.depth * 1.6 : near + (lot.depth - near) * share;
      const slab = [[mx + nx * near - ux * 99, my + ny * near - uy * 99], [mx + nx * near + ux * 99, my + ny * near + uy * 99], [mx + nx * far + ux * 99, my + ny * far + uy * 99], [mx + nx * far - ux * 99, my + ny * far - uy * 99]];
      const piece = intersect([lot.poly], [slab]).reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
      if (piece && area(piece) > 0.5) { out.crofts.push(piece); croftOf = i; }
    }
    // The rest of the plot, behind the yard (Patrick, 24 Oct: fill the open ground; the burgage plots of real towns
    // held gardens, orchards and trees): a strip garden, an orchard in rows, a few trees, or open ground, by type
    if (house && croftOf !== i) {
      const fr = lr.fork("fill");
      const fill = working ? "open" : pickWeighted(fr.next(), T.fill ?? { open: 1 });
      // (a built-up back keeps only a narrow yard behind the house)
      // (and runs to the plot's real back, which in an odd-shaped block can lie well past its nominal depth)
      const farBack = fill === "sheds" ? Math.max(...lot.poly.map(([x, y]) => (x - mx) * nx + (y - my) * ny)) : 0;
      const start = fill === "sheds" ? Math.max(houseBack, behind) + sq(4) : reachBack, end = (rearAt ?? Math.max(lot.depth, Math.min(farBack, lot.depth * 2.5))) - sq(4);
      const span = end - start;
      // What this plot already holds, for trees to keep clear of
      const rects = [...out.houses.slice(firstHouse), ...out.outbuildings.slice(firstOut)].map((h) => {
        const b = h.building, a = ((b.rot ?? 0) * Math.PI) / 180;
        if (b.shape.circle) { const [x, y, rad] = b.shape.circle; return corners(x, y, rad * 2, rad * 2, [Math.cos(a), Math.sin(a)]); }
        const [x0, y0, x1, y1] = b.shape.rect;
        return corners((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, [Math.cos(a), Math.sin(a)]);
      });
      const clearOf = (x, y, rad) => !rects.some((q) => pointInPolygon([x, y], q) || q.some((c, k) => distToSeg([x, y], c, q[(k + 1) % 4]) < rad));
      const inPlot = (x, y, rad) => pointInPolygon([x, y], lot.poly) && lot.poly.every((c, k) => distToSeg([x, y], c, lot.poly[(k + 1) % lot.poly.length]) > rad * 0.6);
      const tree = (x, y, crown) => out.trees.push({ x, y, s: crown / 2.2, rot: fr.next() * 360, variant: fr.int(8) });
      if (fill === "garden" && span > sq(20)) {
        // Beds in rows across the plot, as wide as the plot allows
        const d = Math.min(span * (0.5 + fr.next() * 0.3), sq(70)), w = lot.frontage * 0.8;
        const cx = mx + nx * (start + d / 2), cy = my + ny * (start + d / 2);
        if (fits(corners(cx, cy, w, d, [ux, uy]), lot.poly)) out.gardens.push({ cx, cy, w, d, rot: ang, strip: true });
      } else if (fill === "orchard" && span > sq(25)) {
        // Fruit trees in rows square to the plot, 16 to 20 ft apart
        const sp = sq(16 + fr.next() * 4), crown = sp * 0.85;
        const cols = Math.max(1, Math.floor((lot.frontage * 0.85) / sp));
        for (let t = start + sp / 2; t <= end - sp / 2 + 1e-9; t += sp)
          for (let c = 0; c < cols; c++) {
            const off = (c - (cols - 1) / 2) * sp + (fr.next() - 0.5) * sp * 0.15;
            const x = mx + nx * t + ux * off, y = my + ny * t + uy * off;
            if (inPlot(x, y, crown / 2) && clearOf(x, y, crown * 0.4)) tree(x, y, crown);
          }
      } else if (fill === "sheds" && span > sq(16)) {
        // A dense quarter builds over the back of its plots: rows of sheds, stores or shacks across it, as many as fit
        const B = LOOK[character]?.back ?? { len: [14, 24], dep: [12, 18], gap: 6, use: "shed" };
        const ext = (range) => sq(range[0] + fr.next() * (range[1] - range[0]));
        // (a district given its own roof forms keeps them on these too)
        const ownStyle = Array.isArray(district.roofStyles) && district.roofStyles.some((s) => ROOF_STYLES.includes(s)) ? pickWeighted(fr.next(), styles) : null;
        let n = 0;
        for (let t = start + sq(3); t < end - sq(B.dep[0]) && n < 8; ) {
          const dd = ext(B.dep);
          for (let a = -lot.frontage * 0.46; n < 8; ) {
            const w = Math.min(ext(B.len), lot.frontage * 0.9);
            if (a + w > lot.frontage * 0.46) break;
            const off = a + w / 2;
            const cx = mx + nx * (t + dd / 2) + ux * off, cy = my + ny * (t + dd / 2) + uy * off;
            const pts = corners(cx, cy, w, dd, [ux, uy]);
            if (t + dd <= end && fits(pts, lot.poly) && !rects.some((q) => polygonsOverlap(q, pts))) {
              out.outbuildings.push({ id: `l${lot.block}-${i}k${++n}`, lot: i, r: fr.fork("shed", n), building: { shape: { rect: [cx - w / 2, cy - dd / 2, cx + w / 2, cy + dd / 2] }, rot: ang, roof: pickWeighted(fr.next(), palette), variant: fr.int(8), roofStyle: ownStyle ?? "gable", height: 15, chimney: false, use: B.use } });
              rects.push(pts);
            }
            a += w + sq(B.gap);
          }
          t += dd + sq(B.gap + 2);
        }
      } else if (fill === "trees" && span > sq(10)) {
        // A few trees about the yard and the plot behind it
        const n = 1 + Math.floor(fr.next() * Math.min(3, span / sq(30) + 1));
        const placed = [];
        for (let k = 0; k < n * 4 && placed.length < n; k++) {
          const t = start + fr.next() * span, off = (fr.next() - 0.5) * lot.frontage * 0.8, crown = sq(18 + fr.next() * 14);
          const x = mx + nx * t + ux * off, y = my + ny * t + uy * off;
          if (!inPlot(x, y, crown / 2) || !clearOf(x, y, crown * 0.35) || placed.some(([px, py]) => Math.hypot(px - x, py - y) < crown * 0.8)) continue;
          placed.push([x, y]);
          tree(x, y, crown);
        }
      }
      // Faint lines between long town plots, behind the yard only, where neighbors' backs meet (decision 24)
      if (stripLines && span > sq(20)) {
        const behindYard = difference([lot.poly], [clipDepth(lot.poly, [mx, my], [ux, uy], [nx, ny], reachBack) ?? []]).reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
        const depthOf = ([x, y]) => (x - mx) * nx + (y - my) * ny;
        // Not across the plot where the yard ends: only its sides and its far end
        if (behindYard) addBounds(behindYard, wayById.get(lot.way), "wall", (a, b) => Math.abs(depthOf(a) - reachBack) < 0.05 && Math.abs(depthOf(b) - reachBack) < 0.05);
      }
    }
    // Boundaries near the house only (Patrick, 24 Oct): the yard around the house and outbuilding, fenced on its
    // sides and back but not along the street, and the fence around a croft. The long back lines aren't drawn.
    const way = wayById.get(lot.way);
    if (yardLines && house) {
      const toft = clipDepth(lot.poly, [mx, my], [ux, uy], [nx, ny], reachBack);
      if (toft) addBounds(toft, way, bClass);
    }
    // The croft's fence: all around, its sides only (open at the back, fading into the fields), or none
    const croftFence = district.croftFence ?? T.croftFence ?? "all";
    if (yardLines && wantCroft && croftOf === i && croftFence !== "none") {
      const croft = out.crofts[out.crofts.length - 1];
      const backOf = croftFence === "sides" ? (a, b) => {
        const depthOf = ([x, y]) => (x - mx) * nx + (y - my) * ny;
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const across = Math.abs(((b[0] - a[0]) * ux + (b[1] - a[1]) * uy) / l) > 0.7;
        return across && Math.min(depthOf(a), depthOf(b)) > reachBack + 0.2;
      } : null;
      addBounds(croft, way, bClass, backOf);
    }
  });
  // What a trade leaves in its yard: its clutter, tanning or dyeing pits, a kiln
  for (const y of yards) {
    const info = USE_INFO[y.use] ?? {};
    const yr = r.fork("yard", y.i);
    const span = y.to - y.from;
    if (span < sq(8)) continue;
    const rects = y.parts ?? [...out.houses.filter((h) => h.lot === y.i), ...out.outbuildings.filter((h) => h.lot === y.i)].map((h) => partCorners(h.building));
    const taken = [];
    const lotPoly = y.poly ?? lots[y.i].poly; // a joined site's whole yard
    const free = (x, yy, rad) => pointInPolygon([x, yy], lotPoly) && !rects.some((q) => pointInPolygon([x, yy], q) || q.some((c, k) => distToSeg([x, yy], c, q[(k + 1) % 4]) < rad)) && !taken.some(([px, py, pr]) => Math.hypot(px - x, py - yy) < rad + pr);
    const spot = (rad) => {
      for (let k = 0; k < 12; k++) {
        const [x, yy] = y.at((yr.next() - 0.5) * y.width, y.from + rad + yr.next() * Math.max(0, span - 2 * rad));
        if (free(x, yy, rad)) { taken.push([x, yy, rad]); return [x, yy]; }
      }
      return null;
    };
    if (info.kiln) {
      const rad = sq(7 + yr.next() * 3), p = spot(rad);
      if (p) out.kilns.push({ x: p[0], y: p[1], rad, use: y.use });
    }
    if (info.pits) {
      // A grid of pits square to the plot, as many as fit
      const size = sq(6), step = sq(9);
      const cols = Math.max(1, Math.min(4, Math.floor((y.width * 0.8) / step))), rows = Math.max(1, Math.min(3, Math.floor((span * 0.7) / step)));
      for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
        const [x, yy] = y.at((a - (cols - 1) / 2) * step, y.from + sq(5) + b * step);
        if (!free(x, yy, size * 0.75)) continue;
        taken.push([x, yy, size * 0.6]);
        out.pits.push({ x, y: yy, size, rot: y.rot, liquid: info.pits === "dye" ? ["blue", "red", "yellow", "green"][yr.int(4)] : info.pits });
      }
    }
    const things = [...(info.yard ?? []), ...(y.inn ? ["wagon", "hay", "barrel"] : [])];
    const extra = yr.int(2), n = things.length ? Math.min(things.length + extra, 5) : 0; // (a use with no yard things leaves none)
    for (let k = 0; k < n; k++) {
      const cls = things[k % things.length];
      const p = spot(sq(cls === "wagon" || cls === "cart" ? 7 : 3));
      if (p) out.props.push({ class: cls, x: p[0], y: p[1], rot: y.rot + (yr.next() - 0.5) * 40 + (yr.next() < 0.5 ? 90 : 0), variant: yr.int(8) });
    }
  }
  // Neighbors' fences on the same line become one fence (their pieces overlap with staggered ends otherwise)
  out.bounds = joinBounds(mergeCollinear(out.bounds));
  return out;
}

/** A polygon's edges, joined end to end, leaving out those along a street (onWayEdge of their middle). */
function edgesOff(poly, onWayEdge) {
  const runs = [];
  let cur = null;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length];
    if (onWayEdge([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) || Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.02) { cur = null; continue; }
    if (cur && cur[cur.length - 1] === a) cur.push(b);
    else { cur = [a, b]; runs.push(cur); }
  }
  // A run that ends where the first began is one wall
  if (runs.length > 1 && runs[runs.length - 1][runs[runs.length - 1].length - 1] === runs[0][0]) runs[0] = [...runs.pop(), ...runs[0].slice(1)];
  return runs;
}

/** A building spec's footprint: four corners (a round one's square box). */
function partCorners(b) {
  if (b.shape.circle) { const [x, y, rad] = b.shape.circle; return rectCorners(x, y, rad * 2, rad * 2, b.rot ?? 0); }
  const [x0, y0, x1, y1] = b.shape.rect;
  return rectCorners((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, b.rot ?? 0);
}

/** The part of a plot from its front back to a given depth. */
function clipDepth(poly, [mx, my], [ux, uy], [nx, ny], depth) {
  const slab = [[mx - nx * 0.5 - ux * 99, my - ny * 0.5 - uy * 99], [mx - nx * 0.5 + ux * 99, my - ny * 0.5 + uy * 99], [mx + nx * depth + ux * 99, my + ny * depth + uy * 99], [mx + nx * depth - ux * 99, my + ny * depth - uy * 99]];
  return intersect([poly], [slab]).reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
}

/**
 * Merges fence segments lying on one line: overlapping or touching pieces become one, so two neighbors' fences
 * along their shared side are drawn once, from the front to the deeper of the two.
 */
function mergeCollinear(segs) {
  const lines = [];
  for (const sgm of segs) {
    const [[ax, ay], [bx, by]] = sgm.path;
    let ang = Math.atan2(by - ay, bx - ax);
    if (ang < 0) ang += Math.PI;
    if (ang >= Math.PI - 1e-9) ang -= Math.PI;
    // An existing line within a hair in angle and offset (a line near 0 and one near pi are the same, reversed)
    let L = null;
    for (const q of lines) {
      const d = Math.abs(ang - q.ang);
      if (d >= 0.03 && Math.PI - d >= 0.03) continue;
      const ux = q.ux, uy = q.uy;
      if (Math.abs(-ax * uy + ay * ux - q.off) < 0.03 && Math.abs(-bx * uy + by * ux - q.off) < 0.03) { L = q; break; }
    }
    if (!L) {
      const ux = Math.cos(ang), uy = Math.sin(ang);
      L = { ang, ux, uy, off: -ax * uy + ay * ux, cls: sgm.class, spans: [] };
      lines.push(L);
    }
    const t0 = ax * L.ux + ay * L.uy, t1 = bx * L.ux + by * L.uy;
    L.spans.push([Math.min(t0, t1), Math.max(t0, t1)]);
  }
  const out = [];
  for (const L of lines) {
    L.spans.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const sp of L.spans) {
      const last = merged[merged.length - 1];
      if (last && sp[0] <= last[1] + 0.03) last[1] = Math.max(last[1], sp[1]);
      else merged.push([...sp]);
    }
    const at = (t) => [t * L.ux - L.off * L.uy, t * L.uy + L.off * L.ux];
    for (const [t0, t1] of merged) out.push({ path: [at(t0), at(t1)], class: L.cls });
  }
  return out;
}

/** Joins boundary segments end to end into longer lines of the same kind, so they draw as fences, not dashes. */
function joinBounds(segs) {
  const out = [];
  const used = new Array(segs.length).fill(false);
  const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-3 && Math.abs(p[1] - q[1]) < 1e-3;
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const path = [...segs[i].path];
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < segs.length; j++) {
        if (used[j] || segs[j].class !== segs[i].class) continue;
        const [a, b] = segs[j].path;
        if (same(path[path.length - 1], a)) path.push(b);
        else if (same(path[path.length - 1], b)) path.push(a);
        else if (same(path[0], b)) path.unshift(a);
        else if (same(path[0], a)) path.unshift(b);
        else continue;
        used[j] = true;
        grew = true;
      }
    }
    out.push({ path, class: segs[i].class });
  }
  return out;
}

function distToSeg([x, y], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + t * dx - x, ay + t * dy - y);
}

function distToPath([x, y], path) {
  let d = Infinity;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    d = Math.min(d, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return d;
}
