// One step of building on a district's plots (lots/build.mjs, buildOnLots): ctx holds what the steps share.
import { LOOK } from "../../character.mjs";
import { ROOF_STYLES } from "../../plan.mjs";
import { USE_INFO } from "../../uses.mjs";
import { area, difference, intersect } from "../poly.mjs";
import { clipDepth, corners, distToSeg, grown, partCorners, pickWeighted, tidy } from "../build.mjs";
import { pointInPolygon, polygonsOverlap, unturn } from "../../geom.mjs";

/**
 * Plot lines, off unless the district's plotLines is true: types that fence yards draw yards and crofts, the others
 * faint lines between long plots behind the yards
 */
export function plotByPlot(ctx) {
  const { T, addBounds, apart, boundClass, character, density, district, fits, gardenShare, inSite, lots, noThatch, out, palette, r, roomOf, rowParts, safeRoof, spacious, sq, styles, useOf, uses, wayById, workUse, yards } = ctx;
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
    // Details on the house
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
    // How deep a plain house goes: most of a terrace plot, a little over half of a village one
    const plainDepth = Math.min(hd, lot.depth * (T.cover[1] >= 1 ? 0.85 : 0.6));
    // Whether a spot behind the house is clear of what's on this plot already and wholly in the plot whatever its
    // shape. gap: how far it keeps off them (a shed a square off the house on a battle map)
    const clearHere = (pts, gap = 0) => ![...out.houses.slice(firstHouse), ...out.outbuildings.slice(firstOut)].some((h) => polygonsOverlap(gap ? grown(partCorners(h.building), gap) : partCorners(h.building), pts)) && intersect([pts], [lot.poly]).reduce((s, q) => s + area(q), 0) > area(pts) * 0.995;
    const room = roomOf(lot); // where its buildings may stand (the plot, kept off its neighbors on a battle map)
    let house = null;
    // A city row: the house takes the plot's whole front under a roof along the street, and turns to carry on along a
    // street at its side or back too, so a block's every street front is built up
    const rowRoll = lr.fork("row").next(); // (its own stream: the plot's other dice stay as they were)
    // (its roof a gable, or flat where the house's form is flat: a row's ends are party walls, so it takes no hips;
    // a change of roof forms never moves it)
    const rowStyle = style === "flat" ? "flat" : "gable";
    if (!vacant && rowRoll < (T.rows ?? 0) && lot.frontage <= sq(50)) {
      const d = Math.min(hd, lot.depth * 0.9);
      const rows = rowParts(lot, d);
      if (rows.length) {
        const base = `l${lot.block}-${i}`;
        rows.forEach((q, k) => out.houses.push({ id: k ? `${base}w${k}` : base, lot: i, ...(k ? { wing: true } : {}), r: lr.fork(k ? `row${k}` : "house"), ...(k ? {} : { shape: "row" }), building: { shape: unturn(q.poly, q.rot), rot: q.rot, roof, variant, roofStyle: rowStyle, height: 20, use, ...(k ? { chimney: false } : {}) } }));
        // A wide row often in two sections under their own roofs, the second shallower and a little taller or lower
        // (not on a corner plot, where it would leave a notch)
        if (wantSteps && lot.frontage > sq(36) && rows.length === 1) {
          const cutAt = (0.4 + dr.next() * 0.2) * lot.frontage, d2 = d * (0.72 + dr.next() * 0.2), h2 = 16 + Math.round(dr.next() * 10);
          const [ax, ay] = lot.front.a, px = ax + ux * cutAt, py = ay + uy * cutAt;
          const left = [[px - ux * 99 - nx * 99, py - uy * 99 - ny * 99], [px - nx * 99, py - ny * 99], [px + nx * 99, py + ny * 99], [px - ux * 99 + nx * 99, py - uy * 99 + ny * 99]];
          const big = (ps) => ps.reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
          const first = big(intersect([rows[0].poly], [left]));
          const shallow = [[mx - nx - ux * 99, my - ny - uy * 99], [mx - nx + ux * 99, my - ny + uy * 99], [mx + nx * d2 + ux * 99, my + ny * d2 + uy * 99], [mx + nx * d2 - ux * 99, my + ny * d2 - uy * 99]];
          const second = big(intersect(difference([rows[0].poly], [left]), [shallow]));
          const least = sq(12) * sq(12);
          if (first && second && area(first) > least && area(second) > least) {
            const main = out.houses.find((h) => h.id === base);
            main.shape = "steps";
            main.building.shape = unturn(tidy(first), rows[0].rot);
            out.houses.push({ id: `${base}s2`, lot: i, wing: true, r: lr.fork("section1"), building: { shape: unturn(tidy(second), rows[0].rot), rot: rows[0].rot, roof, variant, roofStyle: rowStyle, height: h2, use, chimney: false } });
          }
        }
        house = { cx: mx + nx * (rows[0].depth / 2), cy: my + ny * (rows[0].depth / 2), w: lot.frontage, depth: rows[0].depth, off: 0, rot: ang, dir: [ux, uy], row: true, parts: rows };
      }
    }
    if (!vacant && !house) {
      // Narrower, then shallower, then slid along the front, before a plot is left as a yard (odd corner plots)
      const rot = ang + turn;
      const a = (rot * Math.PI) / 180;
      const dir = [Math.cos(a), Math.sin(a)];
      // A house that will have wings keeps its front range shallower, leaving the plot room behind for them
      const S0 = T.shapes ?? {};
      const roll0 = lot.merged ? shapeRoll * 0.35 + (S0.L ?? 0) * 0.8 : shapeRoll; // as the wings are chosen below
      // (and only on a plot wide enough for wings: a narrow house that couldn't take them keeps its full depth)
      const winged = roll0 < (S0.L ?? 0) + (S0.T ?? 0) + (S0.U ?? 0) + (S0.court ?? 0) && lot.frontage * cover * 0.98 >= sq(22);
      const plain = plainDepth;
      const depths = winged ? [Math.min(hd, lot.depth * 0.45), plain, plain * 0.75] : [plain, plain * 0.75];
      // (on a battle map no narrower than three squares, room to fight in: a plot too tight is left a yard)
      const least = apart ? [3, 3] : [sq(12), sq(10)];
      search: for (const depth of depths) {
        if (depth < least[0]) continue;
        for (let w = lot.frontage * cover * 0.98; w > least[1]; w *= 0.92) {
          for (const slide of [0, 0.15, -0.15, 0.3, -0.3]) {
            const off = slide * lot.frontage;
            const cx = mx + nx * (sb + depth / 2) + ux * off, cy = my + ny * (sb + depth / 2) + uy * off;
            if (!fits(corners(cx, cy, w, depth, dir), room)) continue;
            house = { cx, cy, w, depth, off, rot, dir };
            break search;
          }
        }
      }
    }
    // Wings behind the house, at right angles to it; details on its front (a row has none: its yard is behind it)
    let reach = house ? (house.row ? house.depth : sb + house.depth) : sb; // (a row stands on the street)
    if (house && !house.row) {
      let { cx, cy, depth } = house;
      const { w, rot, dir } = house;
      const [dx, dy] = dir;
      const base = `l${lot.block}-${i}`;
      // The house's own "back": square to its front, on the side away from the street
      const [bx, by] = -dy * nx + dx * ny >= 0 ? [-dy, dx] : [dy, -dx];
      const at = (along, back) => [cx + dx * along + bx * back, cy + dy * along + by * back];
      const S = T.shapes ?? {};
      // A double plot's house leans to the bigger forms: a courtyard or two wings far more often
      const roll = lot.merged ? shapeRoll * 0.35 + (S.L ?? 0) * 0.8 : shapeRoll;
      const cut = [S.L ?? 0, S.T ?? 0, S.U ?? 0, S.court ?? 0].reduce((a, v) => [...a, (a.at(-1) ?? 0) + v], []);
      const kindWanted = roll < cut[0] ? "L" : roll < cut[1] ? "T" : roll < cut[2] ? "U" : roll < cut[3] ? "court" : null;
      // Only a house wide enough gets wings (too narrow for its form, it takes an L or none); a wing is never a thin
      // stick (at least 10 ft wide, longer than wide) and no wider than the house is deep, so its roof never reaches
      // past the house's ridge
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
      const ok = parts.every((q) => fits(rectOf(q), room));
      const shape = ok ? kind : null;
      // A house kept shallow for wings that didn't fit takes its plot's full depth after all, where that fits
      if (!shape && depth < plainDepth - 1e-6) for (const d2 of [plainDepth, plainDepth * 0.85]) {
        if (d2 <= depth + 1e-6) break;
        const x2 = mx + nx * (sb + d2 / 2) + ux * house.off, y2 = my + ny * (sb + d2 / 2) + uy * house.off;
        if (fits(corners(x2, y2, w, d2, dir), room)) { cx = x2; cy = y2; depth = d2; Object.assign(house, { cx, cy, depth }); reach = sb + depth; break; }
      }
      // A winged house's roof runs into its wings': a mansard or pyramid becomes a hip there; flat stays flat
      if (shape && (style === "mansard" || style === "pyramid")) style = "hip";
      const pitched = style !== "flat" && style !== "mansard";
      // On a hipped house, a wing flush with one end has its outer slope in the plane of the hip end: no valley on
      // that side
      const flushWings = shape && style === "hip" ? parts.filter((q) => q.wing && q.pos) : [];
      const backSign = Math.sign(bx * -dy + by * dx) || 1; // the back, in the house's own frame (y across it)
      const cuts = (ySign) => flushWings.map((q) => [q.pos, ySign, ww / 2]);

      // A long plain house often in sections, each with its own roof: flush at the street, its back and height
      // stepping
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
        if (bd >= sq(4) && fits(rectOf(q), room)) {
          bay = q;
          push(q, `${base}b`, { roofStyle: style === "gable" ? "gable" : "hip", join: { ...joinOf(q), inset: 0.075 } });
          placed.push(rectOf(q));
        }
      }
      // Gables on the front slope of a long roof, half wall dormers (a short gabled roof running back from the eave),
      // half cross-gables (a gable rising from the eave)
      if (!sections.length && !bay && pitched && style !== "pyramid" && wantDormers && w >= sq(28)) {
        const n = w >= sq(45) ? 2 : 1;
        const dw = Math.min(sq(8 + dr.next() * 3), w / (n * 2.5));
        const crossGable = dr.next() < 0.5;
        const dl = crossGable ? Math.min(0.04, depth / 2 - dw / 2 - 0.02) : Math.min(depth / 2 - dw / 2 - 0.02, depth * 0.3);
        if (crossGable ? dl > 0.02 : dl >= sq(4)) for (let k = 0; k < n; k++) {
          const along = n === 1 ? (dr.next() - 0.5) * w * 0.3 : (k ? 1 : -1) * w * 0.22;
          // On a hipped roof the front slope narrows toward the ridge: the dormer must sit inside it, clear of the hips
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
          if (!fits(sqr, room) || placed.some((p) => polygonsOverlap(sqr, p))) continue;
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
        if (fits(corners(cx, cy, w, d, [ux, uy]), lot.poly) && clearHere(corners(cx, cy, w, d, [ux, uy]))) {
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
      if (behind + od < lot.depth * 0.9 && fits(corners(cx, cy, ow, od, [ux, uy]), room) && clearHere(corners(cx, cy, ow, od, [ux, uy]), apart)) {
        // A square shed under a pyramid roof, or now and then a round one (a dovecote) under a cone
        const square = Math.abs(ow / od - 1) < 0.15, round = square && oRound;
        const shape = round ? { circle: [cx, cy, Math.min(ow, od) / 2] } : { rect: [cx - ow / 2, cy - od / 2, cx + ow / 2, cy + od / 2] };
        out.outbuildings.push({ id: `l${lot.block}-${i}o`, lot: i, r: lr.fork("out"), building: { shape, rot: ang, roof: roof === "thatch" ? "thatch" : "wood-shingle", roofStyle: round ? "cone" : square ? "pyramid" : "gable", height: round ? 20 : 15, chimney: false, use: working ? "workshop" : uses?.out ?? "shed" } });
        behind = back + od + 0.1;
      }
    }
    // On a long plot, a range at the far end: the stable, workshop or warehouse that the back lane served
    let rearAt = null; // how far back the far-end range starts
    // (behind a row, on a city plot too short for a long yard: the range closes a small court behind the house)
    if (house && wantRear && lot.depth - behind > sq(house.row ? 22 : 45)) {
      const rw = Math.min(lot.frontage * 0.85, sq(16 + dr.next() * 12)), rd = sq(14 + dr.next() * 8);
      const back = lot.depth - rd / 2 - sq(2);
      const cx = mx + nx * back, cy = my + ny * back;
      if (fits(corners(cx, cy, rw, rd, [ux, uy]), room) && clearHere(corners(cx, cy, rw, rd, [ux, uy]), apart)) {
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
      if (piece && area(piece) > 0.5) { out.crofts.push(piece); ctx.croftOf = i; }
    }
    // The rest of the plot behind the yard, by type: a strip garden, an orchard in rows, a few trees, or open ground
    if (house && ctx.croftOf !== i) {
      const fr = lr.fork("fill");
      const fill = working ? "open" : pickWeighted(fr.next(), T.fill ?? { open: 1 });
      // (a built-up back keeps only a narrow yard behind the house)
      // (and runs to the plot's real back, which in an odd-shaped block can lie well past its nominal depth)
      const farBack = fill === "sheds" ? Math.max(...lot.poly.map(([x, y]) => (x - mx) * nx + (y - my) * ny)) : 0;
      const start = fill === "sheds" ? Math.max(houseBack, behind) + sq(4) : reachBack, end = (rearAt ?? Math.max(lot.depth, Math.min(farBack, lot.depth * 2.5))) - sq(4);
      const span = end - start;
      // What this plot already holds, for trees to keep clear of
      const rects = [...out.houses.slice(firstHouse), ...out.outbuildings.slice(firstOut)].map((h) => partCorners(h.building));
      const clearOf = (x, y, rad) => !rects.some((q) => pointInPolygon([x, y], q) || q.some((c, k) => distToSeg([x, y], c, q[(k + 1) % q.length]) < rad));
      const inPlot = (x, y, rad) => pointInPolygon([x, y], lot.poly) && lot.poly.every((c, k) => distToSeg([x, y], c, lot.poly[(k + 1) % lot.poly.length]) > rad * 0.6);
      const tree = (x, y, crown) => out.trees.push({ x, y, s: crown / 2.2, rot: fr.next() * 360, variant: fr.int(8) });
      if (fill === "garden" && span > sq(20)) {
        // Beds in rows across the plot, as wide as the plot allows
        const d = Math.min(span * (0.5 + fr.next() * 0.3), sq(70)), w = lot.frontage * 0.8;
        const cx = mx + nx * (start + d / 2), cy = my + ny * (start + d / 2);
        if (fits(corners(cx, cy, w, d, [ux, uy]), lot.poly) && clearHere(corners(cx, cy, w, d, [ux, uy]))) out.gardens.push({ cx, cy, w, d, rot: ang, strip: true });
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
            // (wholly in the plot, whatever its shape: a row next door is built right up to its edge)
            if (t + dd <= end && fits(pts, room) && !rects.some((q) => polygonsOverlap(apart ? grown(q, apart) : q, pts)) && clearHere(pts, apart)) {
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
      // Faint lines between long town plots, behind the yard only, where neighbors' backs meet
      if (stripLines && span > sq(20)) {
        const behindYard = difference([lot.poly], [clipDepth(lot.poly, [mx, my], [ux, uy], [nx, ny], reachBack) ?? []]).reduce((a, b) => (!a || area(b) > area(a) ? b : a), null);
        const depthOf = ([x, y]) => (x - mx) * nx + (y - my) * ny;
        // Not across the plot where the yard ends: only its sides and its far end
        if (behindYard) addBounds(behindYard, wayById.get(lot.way), "wall", (a, b) => Math.abs(depthOf(a) - reachBack) < 0.05 && Math.abs(depthOf(b) - reachBack) < 0.05);
      }
    }
    // Boundaries near the house only: the yard fenced on its sides and back (not the street), and a croft's fence
    const way = wayById.get(lot.way);
    if (yardLines && house) {
      const toft = clipDepth(lot.poly, [mx, my], [ux, uy], [nx, ny], reachBack);
      if (toft) addBounds(toft, way, bClass);
    }
    // The croft's fence: all around, its sides only (open at the back, fading into the fields), or none
    const croftFence = district.croftFence ?? T.croftFence ?? "all";
    if (yardLines && wantCroft && ctx.croftOf === i && croftFence !== "none") {
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
}
