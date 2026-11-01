/**
 * Tracing streets through the tensor field. Streets start from points along the plan's roads, so every street is
 * joined to the road network from birth. Each follows the field in small steps, alternately along and across it,
 * and stops at the district's edge, at water, where it meets another street (a junction), or where it would run
 * too close alongside one. Each street seeds the next ones along its length. A later pass with a closer spacing
 * adds lanes between them. Everything in squares. Pure: runs anywhere.
 */
import { pointInPolygon, pathTouchesPolygon } from "../geom.mjs";

/** A spatial hash of street segments, for fast "what's near here" questions. */
class SegmentGrid {
  constructor(cell) {
    this.cell = cell;
    this.map = new Map();
  }
  #key(cx, cy) {
    return `${cx},${cy}`;
  }
  add(seg) {
    const c = this.cell;
    const x0 = Math.floor(Math.min(seg.ax, seg.bx) / c), x1 = Math.floor(Math.max(seg.ax, seg.bx) / c);
    const y0 = Math.floor(Math.min(seg.ay, seg.by) / c), y1 = Math.floor(Math.max(seg.ay, seg.by) / c);
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const k = this.#key(cx, cy);
        if (!this.map.has(k)) this.map.set(k, []);
        this.map.get(k).push(seg);
      }
  }
  near(x, y, r) {
    const c = this.cell, out = new Set();
    for (let cx = Math.floor((x - r) / c); cx <= Math.floor((x + r) / c); cx++)
      for (let cy = Math.floor((y - r) / c); cy <= Math.floor((y + r) / c); cy++)
        for (const s of this.map.get(this.#key(cx, cy)) ?? []) out.add(s);
    return out;
  }
}

function distToSeg(x, y, s) {
  const dx = s.bx - s.ax, dy = s.by - s.ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / l2)) : 0;
  return Math.hypot(s.ax + t * dx - x, s.ay + t * dy - y);
}

/** Where segment p-q crosses segment s, as a fraction along p-q, or null. */
function crossAt(px, py, qx, qy, s) {
  const rx = qx - px, ry = qy - py, sx = s.bx - s.ax, sy = s.by - s.ay;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((s.ax - px) * sy - (s.ay - py) * sx) / den;
  const u = ((s.ax - px) * ry - (s.ay - py) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/**
 * poly: the district polygon. field: from makeField. roads: [{ path }] the plan's roads (and any streets already
 * there). water: [{ path, clear }] (clear: distance from the center line to keep out of; clears, one a segment, where
 * it varies; body, a lake's polygon, its path then its shore). blocked: polygons
 * streets end at and never cross (squares, yards, landmarks). gates: [{ at, nx, ny, kind }] points on the edge
 * shared with another district (nx, ny: the way into this district) where a street of that kind must start, so
 * the two districts' streets meet. borders: the edges shared with other districts, as paths: a street that reaches
 * one away from a gate bends onto a gate nearby or is cut back to its last junction. passes: [{ kind, spacing, minLength, bridge }] in order (spacing in squares;
 * bridge: "bridge" or "footbridge" lets that pass cross water; only: "major" or "minor" keeps that pass to one of
 * the field's two directions). A pass { kind: "back", depth } traces nothing: it lays back lanes, depth behind the
 * streets and roads so far that run with the field's major direction (see backLanes). r: the district's random stream. trimDeadEnds:
 * drop short spurs that end nowhere.
 * Returns { streets: [{ path, kind, ends: [start, end] }], bridges: [{ at, angle, length, kind }] }; ends are
 * "road", "junction", "edge", "gate", "blocked", "water" or "open"; bridge angle in degrees, length in squares.
 */
export function traceStreets({ poly, field, roads = [], water = [], blocked = [], gates = [], borders = [], passes = [], r, step = 0.35, maxLength = 300, trimDeadEnds = false }) {
  const finest = Math.min(...passes.filter((p) => p.spacing).map((p) => p.spacing), 8);
  const grid = new SegmentGrid(Math.max(1, finest / 2));
  /** True when the straight line a-b crosses a blocked shape's edge. */
  const blockedOn = (a, b) => {
    for (const sg of grid.near((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.hypot(b[0] - a[0], b[1] - a[1]) / 2 + 1)) if (sg.line.edge === "blocked" && crossAt(a[0], a[1], b[0], b[1], sg) !== null) return true;
    return false;
  };
  const lines = [];
  let nextId = 0;
  const addLine = (path, kind, fixed = false, edge = null) => {
    const line = { id: nextId++, path, kind, fixed, edge, ends: ["open", "open"], joins: [] };
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, ay] = path[i], [bx, by] = path[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-9) continue;
      grid.add({ line, i, ax, ay, bx, by, ux: (bx - ax) / len, uy: (by - ay) / len });
    }
    lines.push(line);
    return line;
  };
  /** Notes that a street meets line at pt, so cutting line back never cuts that junction off. */
  const joinAt = (line, pt) => {
    if (line && !line.edge) line.joins.push(posOn(line.path, pt));
  };
  for (const road of roads) addLine(road.path, "road", true);
  // The district's edge and anything blocked count as lines: a street ends where it meets them, and keeps its
  // distance when running alongside them, but no street is seeded from them
  const closed = (pts) => [...pts, pts[0]];
  const edgeLine = addLine(closed(poly), "edge", true, "edge");
  for (const b of blocked) if (b.length >= 3) addLine(closed(b), "blocked", true, "blocked");

  /** The water at x, y, with the direction of its nearest stretch: { w, ux, uy }, or null. */
  const waterAt = (x, y) => {
    for (const w of water) {
      // A lake or the sea: anywhere in it (its path is its shore, kept clear of as a river's banks are)
      if (w.body && pointInPolygon([x, y], w.body)) return { w, ux: 1, uy: 0 };
      for (let i = 0; i < w.path.length - 1; i++) {
        const s = { ax: w.path[i][0], ay: w.path[i][1], bx: w.path[i + 1][0], by: w.path[i + 1][1] };
        if (distToSeg(x, y, s) < (w.clears ? w.clears[i] : w.clear)) {
          const l = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1;
          return { w, ux: (s.bx - s.ax) / l, uy: (s.by - s.ay) / l };
        }
      }
    }
    return null;
  };
  const inWater = (x, y) => waterAt(x, y) !== null;
  const bridges = [];

  /**
   * A bridge for a street heading (hx, hy) from (x, y) into water: the far bank, if it's close, the crossing is
   * near square to the water, the far bank is in the district, and no other bridge is near (mine: this street's own
 * bridges so far, kept only if the street is). Returns the far point.
   */
  const bridgeOver = (x, y, hx, hy, pass, mine) => {
    if (!pass.bridge) return null;
    const here = waterAt(x + hx * step, y + hy * step);
    if (!here || here.w.body || Math.abs(here.ux * hx + here.uy * hy) > 0.5) return null; // too slanting a crossing, or a lake
    const limit = Math.min(8, here.w.clear * 2 + 1.5);
    for (let d = step; d <= limit; d += step / 2) {
      const fx = x + hx * d, fy = y + hy * d;
      if (inWater(fx, fy)) continue;
      if (!pointInPolygon([fx, fy], poly) || blocked.some((b) => pointInPolygon([fx, fy], b))) return null;
      const mid = [(x + fx) / 2, (y + fy) / 2];
      if ([...bridges, ...mine].some((b) => Math.hypot(b.at[0] - mid[0], b.at[1] - mid[1]) < pass.spacing * 1.5)) return null;
      mine.push({ at: mid, angle: (Math.atan2(hy, hx) * 180) / Math.PI, length: d, kind: pass.bridge });
      return [fx, fy];
    }
    return null;
  };
  const inside = (x, y) => pointInPolygon([x, y], poly) && !inWater(x, y);

  /** True when a street running (ux, uy) at x, y has a near-parallel street within dist (other than skip). */
  const crowded = (x, y, ux, uy, dist, skip = null) => {
    for (const s of grid.near(x, y, dist)) {
      if (s.line === skip) continue;
      if (Math.abs(s.ux * ux + s.uy * uy) < 0.75) continue; // crossing streets don't count
      // The district edge and blocked shapes only need a little room: a street may run fairly close inside them
      if (distToSeg(x, y, s) < (s.line.edge ? dist * 0.25 : dist)) return true;
    }
    return false;
  };

  /** The field's direction at x, y (major or minor), turned to agree with the way we're heading. */
  const dirAt = (x, y, which, hx, hy) => {
    const a = which === "major" ? field.major(x, y) : field.minor(x, y);
    let ux = Math.cos(a), uy = Math.sin(a);
    if (ux * hx + uy * hy < 0) { ux = -ux; uy = -uy; }
    return [ux, uy];
  };

  /** Follows the field from (x, y), heading (hx, hy), until something stops it. Returns { pts, end }. */
  const follow = (x, y, which, hx, hy, pass, from, lead = 0) => {
    const spacing = pass.spacing;
    const [lx, ly] = [hx, hy]; // a gate street's first stretch runs straight out of the border, easing into the field
    let coast = 0; // how far it has run straight through a twist in the field
    const pts = [[x, y]];
    const mine = [];
    const keepOff = spacing * 0.5;
    let len = 0, end = "open", met = null;
    for (let n = 0; n < maxLength / step; n++) {
      // Midpoint step (second-order), so streets curve smoothly
      const [u1, v1] = dirAt(x, y, which, hx, hy);
      let [u2, v2] = dirAt(x + u1 * step * 0.5, y + v1 * step * 0.5, which, u1, v1);
      if (len < lead) {
        const w = len / lead;
        const bx = lx * (1 - w) + u2 * w, by = ly * (1 - w) + v2 * w, bl = Math.hypot(bx, by) || 1;
        [u2, v2] = [bx / bl, by / bl];
      } else if (u2 * hx + v2 * hy < 0.5) {
        // The field twists sharply here: run straight on for up to a square, then give up
        if (coast > 1) { end = "open"; break; }
        coast += step;
        [u2, v2] = [hx, hy];
      } else coast = 0;
      const nx = x + u2 * step, ny = y + v2 * step;
      // Meeting another street: stop at the junction
      let hit = null;
      for (const s of grid.near(nx, ny, step * 2)) {
        if (len < step * 3 && s.line === from) continue; // just left the street it started on
        const t = crossAt(x, y, nx, ny, s);
        if (t !== null && (!hit || t < hit.t)) hit = { t, s };
      }
      if (hit) {
        pts.push([x + (nx - x) * hit.t, y + (ny - y) * hit.t]);
        end = hit.s.line.edge ?? (hit.s.line.fixed ? "road" : "junction");
        met = hit.s.line;
        break;
      }
      if (!pointInPolygon([nx, ny], poly)) { end = "edge"; pts.push(edgePoint(x, y, nx, ny, poly)); break; }
      // Never into a blocked shape (a gate can open right beside one, so a street can start on its edge)
      if (blocked.some((b) => pointInPolygon([nx, ny], b))) { end = "blocked"; break; }
      if (inWater(nx, ny)) {
        const far = bridgeOver(x, y, hx, hy, pass, mine);
        if (!far) { end = "water"; break; }
        pts.push(far);
        len += Math.hypot(far[0] - x, far[1] - y);
        x = far[0]; y = far[1];
        continue;
      }
      if (len > step * 3 && crowded(nx, ny, u2, v2, keepOff, null)) { end = "open"; break; }
      if (len > spacing && Math.hypot(nx - pts[0][0], ny - pts[0][1]) < step * 2) { end = "open"; break; } // looped back
      pts.push([nx, ny]);
      len += step;
      x = nx; y = ny; hx = u2; hy = v2;
    }
    return { pts, end, bridges: mine, met };
  };

  /**
   * Back lanes (the burgage pattern): a lane `depth` behind each street or road that runs with the field's major
   * direction, on both sides, where there's room for a full plot between them. It runs only where that street
   * does (and keeps its distance from any other street running the same way), is shared when two streets' back
   * lanes would fall together, and is carried on at each end to the street it meets. The lane pass after it seeds
   * its cross lanes from them.
   */
  const backLanes = (pass) => {
    const nearBorder = ([x, y], d) => borders.some((b) => b.some((q, i) => i && distToSeg(x, y, { ax: b[i - 1][0], ay: b[i - 1][1], bx: q[0], by: q[1] }) < d));
    const D = pass.depth, ds = 0.25;
    const fronts = lines.filter((l) => !l.edge && (l.kind === "road" || l.kind === "street"));
    const made = [];
    const nearParallel = (x, y, tx, ty, skip, dist) => {
      for (const sg of grid.near(x, y, dist)) {
        if (sg.line === skip || sg.line.edge) continue; // only streets and roads count, not the edge or buildings
        if (Math.abs(sg.ux * tx + sg.uy * ty) < 0.8) continue; // a cross street: the lane may meet it
        if (distToSeg(x, y, sg) < dist) return true;
      }
      return false;
    };
    for (const f of fronts) {
      for (const side of [-1, 1]) {
        const runs = [];
        let cur = null;
        const p = f.path;
        for (let i = 0; i < p.length - 1; i++) {
          const [ax, ay] = p[i], [bx, by] = p[i + 1];
          const l = Math.hypot(bx - ax, by - ay);
          if (!l) continue;
          const tx = (bx - ax) / l, ty = (by - ay) / l;
          const nx = -ty * side, ny = tx * side;
          for (let t = 0; t < l; t += ds) {
            const x = ax + tx * t, y = ay + ty * t, qx = x + nx * D, qy = y + ny * D;
            const ma = field.major(x, y);
            const ok =
              Math.abs(Math.cos(ma) * tx + Math.sin(ma) * ty) > 0.82 && // this stretch of street runs with the major direction
              inside(qx, qy) && !blocked.some((b) => pointInPolygon([qx, qy], b)) &&
              !nearParallel(qx, qy, tx, ty, f, D * 0.85) && // no other street running the same way within a plot's depth
              !made.some((m) => m.pts.some(([mx, my]) => Math.hypot(mx - qx, my - qy) < D * 0.5)); // another street's back lane is here: share it
            if (ok) { if (!cur) { cur = []; runs.push(cur); } cur.push([qx, qy]); }
            else cur = null;
          }
        }
        for (const pts of runs) {
          if (pts.length * ds < Math.max(2, D)) continue;
          made.push({ pts, from: f });
        }
      }
    }
    for (const m of made) {
      let path = smooth(simplify(m.pts, 0.12), 2);
      const ends = ["open", "open"], met = [];
      // Each end carried on to the street, road or edge it runs toward, if one is near
      for (const endIx of [0, 1]) {
        const n = path.length;
        const [ex, ey] = endIx ? path[n - 1] : path[0];
        const [qx, qy] = endIx ? path[n - 2] : path[1];
        const d = Math.hypot(ex - qx, ey - qy) || 1;
        const ux = (ex - qx) / d, uy = (ey - qy) / d;
        const reach = D * 1.2, fx = ex + ux * reach, fy = ey + uy * reach;
        let best = null, wall = Infinity;
        for (const sg of grid.near(ex, ey, reach + 1)) {
          const t = crossAt(ex, ey, fx, fy, sg);
          if (t === null) continue;
          if (sg.line.edge === "blocked") wall = Math.min(wall, t);
          else if (!best || t < best.t) best = { t, sg };
        }
        // Never through a blocked shape (a landmark's walled block, a plan building) to a street beyond it
        if (best && best.t > wall) best = null;
        const pt = best && [ex + (fx - ex) * best.t, ey + (fy - ey) * best.t];
        // Towards a neighboring district with no street to meet: it turns back to its own street instead, a short
        // cross lane closing the loop (back lanes joined their high street at the ends of the town)
        if (!best || best.sg.line.edge === "edge" && nearBorder(pt, 0.3) || !inside(ex + (fx - ex) * best.t * 0.5, ey + (fy - ey) * best.t * 0.5)) {
          // Unless it has just crossed a street: then it ends there, rather than running on past it and laying a
          // link back to its own street alongside that one
          const total = pathLen(path);
          let cross = null;
          for (let i = 1; i < path.length; i++) {
            const [ax, ay] = path[i - 1], [bx, by] = path[i];
            for (const sg of grid.near((ax + bx) / 2, (ay + by) / 2, Math.hypot(bx - ax, by - ay))) {
              if (sg.line.edge || sg.line === m.from) continue;
              const t = crossAt(ax, ay, bx, by, sg);
              if (t === null) continue;
              const cp = [ax + (bx - ax) * t, ay + (by - ay) * t], at = posOn(path, cp);
              const fromEnd = endIx ? total - at : at;
              if (fromEnd > 0.3 && fromEnd < D * 1.5 && (!cross || fromEnd < cross.fromEnd)) cross = { fromEnd, at, cp, line: sg.line };
            }
          }
          if (cross) {
            path = endIx ? cutPath(path, 0, cross.at) : cutPath(path, cross.at, total);
            ends[endIx] = cross.line.fixed ? "road" : "junction";
            met.push({ line: cross.line, pt: cross.cp });
            continue;
          }
          const back = Math.min(pathLen(path) * 0.3, 1);
          path = endIx ? cutPath(path, 0, pathLen(path) - back) : cutPath(path, back, pathLen(path));
          const e = endIx ? path[path.length - 1] : path[0];
          // To the nearest point on the part of its street inside this district (a road can run on through others),
          // and only when the link stays inside; else the lane just ends
          const inPoly = ([x, y]) => pointInPolygon([x, y], poly);
          let q = null;
          for (let i = 1; i < m.from.path.length; i++) {
            const a2 = m.from.path[i - 1], b2 = m.from.path[i];
            if (!pathTouchesPolygon([a2, b2], poly)) continue; // a stretch outside the district (a road's ends often are)
            const c = nearestOnPath([a2, b2], e);
            if (!q || Math.hypot(c[0] - e[0], c[1] - e[1]) < Math.hypot(q[0] - e[0], q[1] - e[1])) q = c;
          }
          const lerp = (t) => [e[0] + (q[0] - e[0]) * t, e[1] + (q[1] - e[1]) * t];
          if (!q || !inPoly(lerp(0.5)) || !inPoly(lerp(0.9)) || blockedOn(e, q)) continue;
          const link = [e, lerp(0.5), q];
          if (endIx) path.push(...link.slice(1)); else path.unshift(...link.slice(1).reverse());
          ends[endIx] = m.from.fixed ? "road" : "junction";
          met.push({ line: m.from, pt: q });
          continue;
        }
        if (endIx) path.push(pt); else path.unshift(pt);
        ends[endIx] = best.sg.line.edge ?? (best.sg.line.fixed ? "road" : "junction");
        if (!best.sg.line.edge) met.push({ line: best.sg.line, pt });
      }
      const line = addLine(path, "back");
      line.ends = ends;
      for (const { line: other, pt } of met) { joinAt(other, pt); line.joins.push(posOn(line.path, pt)); }
      // Streets it crosses on the way are junctions too
      for (let i = 1; i < line.path.length; i++) {
        const [ax, ay] = line.path[i - 1], [bx, by] = line.path[i];
        for (const sg of grid.near((ax + bx) / 2, (ay + by) / 2, Math.hypot(bx - ax, by - ay))) {
          if (sg.line === line || sg.line.edge) continue;
          const t = crossAt(ax, ay, bx, by, sg);
          if (t === null) continue;
          const pt = [ax + (bx - ax) * t, ay + (by - ay) * t];
          joinAt(sg.line, pt);
          line.joins.push(posOn(line.path, pt));
        }
      }
    }
  };

  for (const pass of passes) {
    if (pass.kind === "back") {
      backLanes(pass);
      continue;
    }
    const spacing = pass.spacing;
    const minLength = pass.minLength ?? spacing * 0.5;
    // Seeds: points along every line so far, each asking for a street square to that line
    const queue = [];
    const gateLines = new Set(); // made this pass from gates, and seeded already
    const seedAlong = (line) => {
      const path = line.path;
      let carry = r.next() * spacing; // where along the line the first seed falls
      for (let i = 0; i < path.length - 1; i++) {
        const [ax, ay] = path[i], [bx, by] = path[i + 1];
        const l = Math.hypot(bx - ax, by - ay);
        if (!l) continue;
        const ux = (bx - ax) / l, uy = (by - ay) / l;
        for (let t = carry; t < l; t += spacing) queue.push({ x: ax + ux * t, y: ay + uy * t, ux, uy, line, jitter: r.next() });
        carry = ((carry - l) % spacing + spacing) % spacing;
      }
    };
    // Gates first: the streets that meet the neighboring district's at the shared edge
    for (const g of gates.filter((q) => q.kind === pass.kind)) {
      const [gx, gy] = g.at;
      const ma = field.major(gx + g.nx * 0.2, gy + g.ny * 0.2);
      const which = Math.abs(Math.cos(ma) * g.nx + Math.sin(ma) * g.ny) >= 0.7071 ? "major" : "minor";
      const a = which === "major" ? ma : ma + Math.PI / 2;
      let sx = Math.cos(a), sy = Math.sin(a);
      if (sx * g.nx + sy * g.ny < 0) { sx = -sx; sy = -sy; }
      const run = follow(gx, gy, which, g.nx, g.ny, pass, edgeLine, Math.min(1.5, spacing * 0.3));
      if (run.pts.length < 3) continue;
      const made = addLine(smooth(simplify(run.pts, 0.12), 2), pass.kind);
      made.ends = ["gate", run.end];
      made.gate = true;
      made.joins.push(0);
      joinAt(run.met, made.path[made.path.length - 1]);
      if (run.met && !run.met.edge) made.joins.push(pathLen(made.path));
      bridges.push(...run.bridges);
      gateLines.add(made);
      seedAlong(made);
    }
    for (const line of lines.filter((l) => !l.edge && !gateLines.has(l))) seedAlong(line);

    while (queue.length) {
      const seed = queue.shift();
      const { x, y, ux, uy, line, jitter } = seed;
      if (!inside(x, y) || blocked.some((b) => pointInPolygon([x, y], b))) continue;
      // Of the field's two directions here, take the one more square to the line the seed is on
      const ma = field.major(x, y);
      const mx = Math.cos(ma), my = Math.sin(ma);
      const which = Math.abs(mx * ux + my * uy) < 0.7071 ? "major" : "minor";
      if (pass.only && which !== pass.only) continue;
      const a = which === "major" ? ma : ma + Math.PI / 2;
      const sx = Math.cos(a), sy = Math.sin(a);
      if (crowded(x, y, sx, sy, spacing * (0.85 + 0.15 * jitter), line)) continue;
      const fwd = follow(x, y, which, sx, sy, pass, line);
      const back = follow(x, y, which, -sx, -sy, pass, line);
      // One street through the seed, from the back end to the front end
      const path = [...back.pts.slice(1).reverse(), ...fwd.pts];
      const ends = [back.pts.length > 1 ? back.end : "road", fwd.pts.length > 1 ? fwd.end : "road"];
      if (pathLen(path) < minLength) continue;
      const made = addLine(smooth(simplify(path, 0.12), 2), pass.kind);
      made.ends = ends;
      // Where it meets other streets, on both: the seed (on its parent street) and each end that met one
      made.joins.push(posOn(made.path, [x, y]));
      joinAt(line, [x, y]);
      for (const [run, pt] of [[back, made.path[0]], [fwd, made.path[made.path.length - 1]]]) {
        if (!run.met || run.met.edge) continue;
        joinAt(run.met, pt);
        made.joins.push(posOn(made.path, pt));
      }
      bridges.push(...fwd.bridges, ...back.bridges);
      seedAlong(made);
    }
  }

  // A street that stops just short of another is carried on to meet it
  for (const line of lines.filter((l) => !l.fixed)) {
    for (const endIx of [0, 1]) {
      if (line.ends[endIx] !== "open") continue;
      const p = line.path, n = p.length;
      const [ex, ey] = endIx ? p[n - 1] : p[0];
      const [qx, qy] = endIx ? p[n - 2] : p[1];
      const d = Math.hypot(ex - qx, ey - qy) || 1;
      const ux = (ex - qx) / d, uy = (ey - qy) / d;
      const reach = (passes.find((q) => q.kind === line.kind)?.spacing ?? 4) * 0.8;
      const fx = ex + ux * reach, fy = ey + uy * reach;
      let best = null;
      for (const s of grid.near(ex, ey, reach + 1)) {
        if (s.line === line) continue;
        const t = crossAt(ex, ey, fx, fy, s);
        if (t !== null && (!best || t < best.t)) best = { t, s };
      }
      if (best && inside(ex + (fx - ex) * best.t * 0.5, ey + (fy - ey) * best.t * 0.5)) {
        const pt = [ex + (fx - ex) * best.t, ey + (fy - ey) * best.t];
        if (endIx) p.push(pt); else p.unshift(pt);
        if (!endIx) line.joins = line.joins.map((j) => j + Math.hypot(pt[0] - ex, pt[1] - ey));
        line.ends[endIx] = best.s.line.edge ?? (best.s.line.fixed ? "road" : "junction");
        if (!best.s.line.edge) {
          joinAt(best.s.line, pt);
          line.joins.push(endIx ? pathLen(p) : 0);
        }
      }
    }
  }

  // Streets that reached a shared edge away from a gate: onto a gate nearby, else cut back to their last junction
  const onBorder = ([x, y]) => borders.some((b) => b.some((q, i) => i && distToSeg(x, y, { ax: b[i - 1][0], ay: b[i - 1][1], bx: q[0], by: q[1] }) < 0.2));
  for (const line of lines.filter((l) => !l.fixed)) {
    const spacing = passes.find((q) => q.kind === line.kind)?.spacing ?? 4;
    for (const endIx of [0, 1]) {
      if (line.ends[endIx] !== "edge") continue;
      const p = line.path;
      const e = endIx ? p[p.length - 1] : p[0];
      if (!onBorder(e)) continue; // the district's outer edge: a street may run out into the fields
      if (gates.some((g) => Math.hypot(g.at[0] - e[0], g.at[1] - e[1]) < 0.15)) { line.ends[endIx] = "gate"; continue; }
      const near = gates
        .map((g) => ({ g, d: Math.hypot(g.at[0] - e[0], g.at[1] - e[1]) }))
        .filter((q) => q.d < spacing * 0.6)
        .sort((a, b) => a.d - b.d)[0];
      if (near) {
        bendTo(p, endIx, near.g.at, Math.min(pathLen(p) * 0.5, spacing));
        line.ends[endIx] = "gate";
      } else line.ends[endIx] = "border";
    }
    // Cut back a border end to the last junction on that side; with none, the street goes
    const total = pathLen(line.path);
    const js = line.joins.length ? line.joins : [];
    let from = 0, to = total;
    if (line.ends[0] === "border") from = js.length ? Math.min(...js) : total;
    if (line.ends[1] === "border") to = js.length ? Math.max(...js) : 0;
    if (from > 0 || to < total) {
      if (to - from < step * 2) { line.dropped = true; continue; }
      line.path = cutPath(line.path, from, to);
      line.joins = line.joins.map((j) => j - from);
      if (line.ends[0] === "border") line.ends[0] = "junction";
      if (line.ends[1] === "border") line.ends[1] = "junction";
    }
  }

  let out = lines.filter((l) => !l.fixed && !l.dropped);
  if (trimDeadEnds) {
    const minSpur = Math.min(...passes.filter((p) => p.spacing).map((p) => p.spacing));
    out = out.filter((l) => l.gate || !(l.ends.includes("open") && pathLen(l.path) < minSpur));
  }
  // A bridge belongs to a street that was kept
  const kept = bridges.filter((b) => out.some((l) => l.path.some((p, i) => i && distToSeg(b.at[0], b.at[1], { ax: l.path[i - 1][0], ay: l.path[i - 1][1], bx: p[0], by: p[1] }) < 0.3)));
  return { streets: out.map((l) => ({ path: l.path, kind: l.kind, ends: l.ends })), bridges: kept };
}

/** The nearest point on a path to pt. */
function nearestOnPath(path, [x, y]) {
  let best = Infinity, out = path[0];
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const q = [ax + t * dx, ay + t * dy], d = Math.hypot(q[0] - x, q[1] - y);
    if (d < best) { best = d; out = q; }
  }
  return out;
}

/** How far along a path the nearest point to pt is. */
function posOn(path, [x, y]) {
  let best = Infinity, at = 0, run = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, l = Math.sqrt(l2);
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
    if (d < best) { best = d; at = run + t * l; }
    run += l;
  }
  return at;
}

/** The part of a path between two distances along it. */
function cutPath(path, from, to) {
  const out = [];
  let run = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const l = Math.hypot(bx - ax, by - ay);
    const pt = (d) => [ax + ((bx - ax) * (d - run)) / (l || 1), ay + ((by - ay) * (d - run)) / (l || 1)];
    if (!out.length && from <= run + l) out.push(pt(Math.max(from, run)));
    if (out.length && to <= run + l) { out.push(pt(to)); return out; }
    if (out.length) out.push([bx, by]);
    run += l;
  }
  return out.length >= 2 ? out : path;
}

/** Moves one end of a path onto pt, easing the change in over the last `over` squares so it stays smooth. */
function bendTo(path, endIx, pt, over) {
  const n = path.length;
  const e = endIx ? path[n - 1] : path[0];
  const dx = pt[0] - e[0], dy = pt[1] - e[1];
  let run = 0;
  for (let k = 0; k < n; k++) {
    const i = endIx ? n - 1 - k : k;
    if (k) {
      const j = endIx ? i + 1 : i - 1;
      run += Math.hypot(path[i][0] - path[j][0], path[i][1] - path[j][1]);
    }
    if (run > over) break;
    const w = 1 - run / over;
    path[i] = [path[i][0] + dx * w * w, path[i][1] + dy * w * w];
  }
  path[endIx ? n - 1 : 0] = [pt[0], pt[1]];
}

/** The point where the step from (x, y) to (nx, ny) leaves the polygon, found by halving. */
function edgePoint(x, y, nx, ny, poly) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 20; i++) {
    const m = (lo + hi) / 2;
    if (pointInPolygon([x + (nx - x) * m, y + (ny - y) * m], poly)) lo = m;
    else hi = m;
  }
  return [x + (nx - x) * lo, y + (ny - y) * lo];
}

function pathLen(path) {
  let l = 0;
  for (let i = 1; i < path.length; i++) l += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return l;
}

/** Rounds a path's corners (Chaikin), keeping its two ends where they are, so junctions stay joined. */
export function smooth(path, rounds = 1) {
  let p = path;
  for (let k = 0; k < rounds && p.length > 2; k++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, ay] = p[i], [bx, by] = p[i + 1];
      if (i > 0) q.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
      if (i < p.length - 2) q.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

/** Drops points that lie within tol of the line through their neighbors (Douglas-Peucker). */
export function simplify(path, tol) {
  if (path.length < 3) return path;
  const keep = new Uint8Array(path.length);
  keep[0] = keep[path.length - 1] = 1;
  const stack = [[0, path.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, bi = -1;
    const s = { ax: path[a][0], ay: path[a][1], bx: path[b][0], by: path[b][1] };
    for (let i = a + 1; i < b; i++) {
      const d = distToSeg(path[i][0], path[i][1], s);
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  return path.filter((_, i) => keep[i]);
}
