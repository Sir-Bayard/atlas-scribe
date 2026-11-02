/**
 * Boats and cranes where there's a harbor: rowboats moored along quays, wharves, piers and jetties, ships at the
 * sea's quays and piers, cranes on the quays, and a few boats out on the water nearby. Pure: runs anywhere. Numbers
 * are in squares unless they say feet.
 */

/** How wide each is drawn at scale 1, in squares (its art's short side): a rowboat 5 ft, a ship 20 ft. */
export const BOAT_SQUARES = { boat: 0.2, ship: 0.8 };
/** How long, as a share of its width (the art: a rowboat 1 by 4, a ship's hull 4 by 11). */
export const BOAT_LONG = { boat: 4, ship: 2.75 };

const unit = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
const deg = (u) => (Math.atan2(u[1], u[0]) * 180) / Math.PI;

/**
 * docks: the layout's dock items ({ class, path, edge, land, width }); waterAt(p): "sea", "lake", "river" or null;
 * clear(p): nothing else there (no bridge, no pier); forkOf(id): a stream keyed by a dock's id. Returns { props:
 * [{ class (boat, ship, crane), x, y, rot (degrees, turning the art: a boat's heading less 90), variant }], fits,
 * add } (for afloat).
 */
export function harborProps({ docks, waterAt, clear, forkOf }) {
  const out = [];
  const placed = [];
  // A boat of a class at p heading along u: all of it on water of a kind it may be on, clear of the others
  const fits = (cls, p, u, kinds) => {
    const w = BOAT_SQUARES[cls], L = w * BOAT_LONG[cls], n = [-u[1], u[0]];
    const pts = [[0, 0], [0.5, 0], [-0.5, 0], [0.5, 0.5], [0.5, -0.5], [-0.5, 0.5], [-0.5, -0.5]].map(([a, b]) => [p[0] + u[0] * a * L + n[0] * b * w, p[1] + u[1] * a * L + n[1] * b * w]);
    if (!pts.every((q) => kinds.includes(waterAt(q)) && clear(q))) return false;
    return placed.every((o) => Math.hypot(o.p[0] - p[0], o.p[1] - p[1]) > (o.r + L / 2) * 0.9);
  };
  // (rot turns the art, whose long side runs down it, to lie along the heading)
  const add = (cls, p, u, variant) => { out.push({ class: cls, x: p[0], y: p[1], rot: deg(u) - 90, variant }); placed.push({ p, r: (BOAT_SQUARES[cls] * BOAT_LONG[cls]) / 2 }); };

  for (const d of docks) {
    const r = forkOf(d.id);
    if (d.edge && d.land) {
      // Along a quay or wharf: boats moored at the edge every few squares, a crane on a stone quay
      const kinds = waterAt(d.edge[Math.floor(d.edge.length / 2)]) === "sea" ? ["sea"] : ["sea", "lake", "river"];
      let since = 0;
      for (let i = 1; i < d.edge.length; i++) {
        const e = d.edge[i], u = unit(e[0] - d.edge[i - 1][0], e[1] - d.edge[i - 1][1]);
        since += Math.hypot(e[0] - d.edge[i - 1][0], e[1] - d.edge[i - 1][1]);
        const away = unit(e[0] - d.land[i][0], e[1] - d.land[i][1]); // toward the water
        const want = r.next(), ship = r.chance(kinds[0] === "sea" ? 0.45 : 0), variant = r.int(16), crane = r.chance(0.12);
        if (since > 2.2 && want < 0.55) {
          const cls = ship ? "ship" : "boat", w = BOAT_SQUARES[cls];
          const p = [e[0] + away[0] * (w / 2 + 0.12), e[1] + away[1] * (w / 2 + 0.12)];
          if (fits(cls, p, u, kinds)) { add(cls, p, u, variant); since = 0; }
        }
        if (crane && d.class === "quay" && i % 4 === 0) {
          const q = [(e[0] + d.land[i][0]) / 2 + away[0] * d.width * 0.2, (e[1] + d.land[i][1]) / 2 + away[1] * d.width * 0.2];
          if (out.filter((x) => x.class === "crane").every((c) => Math.hypot(c.x - q[0], c.y - q[1]) > 4)) out.push({ class: "crane", x: q[0], y: q[1], rot: deg(away) - 90, variant });
        }
      }
    } else if (Array.isArray(d.path) && d.path.length >= 2) {
      // Along a pier or jetty: boats (ships at the sea) alongside its outer half, one side or both
      const a = d.path[0], b = d.path[d.path.length - 1], u = unit(b[0] - a[0], b[1] - a[1]), n = [-u[1], u[0]];
      const kinds = waterAt(b) === "sea" ? ["sea"] : ["sea", "lake", "river"];
      for (const side of [-1, 1]) {
        const want = r.chance(0.7), ship = kinds[0] === "sea" && r.chance(0.55), t = r.range(0.55, 0.85), variant = r.int(16);
        const cls = ship ? "ship" : "boat", w = BOAT_SQUARES[cls];
        const p = [a[0] + (b[0] - a[0]) * t + n[0] * side * (d.width / 2 + w / 2 + 0.08), a[1] + (b[1] - a[1]) * t + n[1] * side * (d.width / 2 + w / 2 + 0.08)];
        if (want && fits(cls, p, u, kinds)) add(cls, p, u, variant);
        else if (want && ship && fits("boat", p, u, kinds)) add("boat", p, u, variant);
      }
    }
  }
  return { props: out, fits, add };
}

/**
 * A few boats out on open water near a harbor or a town: ships riding at anchor in the sea, rowboats on a river.
 * spots: candidate [{ p, u }] on that water (nearest first); cls; count; fits and add from harborProps.
 */
export function afloat({ spots, cls, count, kinds, fits, add, r }) {
  let made = 0;
  for (const s of spots) {
    if (made >= count) break;
    const turn = (r.next() - 0.5) * (cls === "ship" ? 120 : 30), variant = r.int(16), keep = r.chance(0.5);
    if (!keep) continue;
    const a = Math.atan2(s.u[1], s.u[0]) + (turn * Math.PI) / 180, u = [Math.cos(a), Math.sin(a)];
    if (fits(cls, s.p, u, kinds)) { add(cls, s.p, u, variant); made++; }
  }
  return made;
}
