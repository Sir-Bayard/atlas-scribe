/**
 * The settlement fill: houses along streets, farmsteads, woods, hedgerows and ground patches. Numbers are in
 * squares and were tuned on a 25 ft square (a village overview). Pure: runs anywhere.
 */
import { DEG, bbox, pointInPolygon, rotateAbout, shapeToPolygon } from "../geom.mjs";

/** Roofs for ordinary houses: slate most of all, then wood shingle, a few clay tiles. */
const HOUSE_ROOFS = ["slate", "slate", "slate", "slate", "wood-shingle", "wood-shingle", "tile-red", "tile-brown"];

/** Cap on random tries for one area, so a huge or odd shape can't run on for ever. */
const MAX_TRIES = 20000;

/** True when every corner of a polygon is inside another. */
const inside = (pts, poly) => pts.every((p) => pointInPolygon(p, poly));

/**
 * The "roadside" profile: houses along both sides of every road and lane through the district, ridges along the
 * street, turned and sized a little differently each, with a walled kitchen garden behind. Each house and its
 * garden lie wholly inside the district.
 *
 * The district's stream is drawn from the same number of times whatever fits, and each house's own choices (roof
 * variant, chimney) come from a stream of its own, so what happens elsewhere on the map never shifts this
 * district's dice; only things that physically crowd it can change it.
 */
export function fillRoadside({ district, poly, ways, r, free, freeGarden = () => true, addBuilding, items }) {
  const density = district.density ?? 1;
  let n = 0;
  for (const way of ways) {
    const pts = way.path;
    const setback = way.width / 2 + 0.25;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const seg = Math.hypot(bx - ax, by - ay);
      if (!seg) continue;
      const ux = (bx - ax) / seg, uy = (by - ay) / seg;
      const ang = Math.atan2(uy, ux) / DEG;
      let s = 0.4;
      for (let step = 0; s < seg - 0.4; step++) {
        const len = 1.3 + r.next() * 0.8, dep = 0.85 + r.next() * 0.35;
        const t = s + len / 2;
        const px = ax + ux * t, py = ay + uy * t;
        for (const side of [1, -1]) {
          if (r.next() < 0.12 + (1 - Math.min(1, density)) * 0.5) continue;
          const nx = -uy * side, ny = ux * side;
          const d = setback + dep / 2 + r.next() * 0.15;
          // a little variety, so rows don't look ruled
          const jl = len * (0.92 + r.next() * 0.16);
          const cx = px + nx * d + (r.next() - 0.5) * 0.12, cy = py + ny * d + (r.next() - 0.5) * 0.12;
          const rot = ang + (r.next() * 2 - 1) * 3 + (r.next() - 0.5) * 7;
          const roof = r.pick(HOUSE_ROOFS);
          const rad = Math.max(jl, dep) * 0.5;
          const rect = { rect: [cx - jl / 2, cy - dep / 2, cx + jl / 2, cy + dep / 2] };
          if (!inside(shapeToPolygon(rect, rot), poly) || !free(cx, cy, rad, dep / 2)) continue;
          n++;
          const house = addBuilding({ id: `${district.id}/h${n}`, r: r.fork("house", way.id, i, step, side), building: { shape: rect, rot, roof, height: 20 } });
          // The garden behind: full depth if it fits, else shallower, else none. It mustn't overlap another garden, a
          // building, a yard, a square, water or a road.
          if (district.gardens !== false) {
            const own = house?.footprint ?? null;
            for (const gd of [1.6, 1.0]) {
              const g = dep / 2 + 0.1 + gd / 2;
              const garden = { cx: cx + nx * g, cy: cy + ny * g, w: jl * 0.95, d: gd, rot };
              const gp = shapeToPolygon({ rect: [garden.cx - garden.w / 2, garden.cy - garden.d / 2, garden.cx + garden.w / 2, garden.cy + garden.d / 2] }, rot);
              if (inside(gp, poly) && freeGarden(gp, own, true)) {
                items.push({ kind: "surface", id: `${district.id}/g${n}`, from: district.id, class: "garden", garden });
                break;
              }
            }
          }
        }
        s += len + 0.25 + r.next() * 0.5;
      }
    }
  }
  return n;
}

/**
 * A farmstead: its yard (the area's shape, turned by rot), a house near the yard's top left and a barn across from
 * it, turned with the yard. Each building is placed only if it fits the yard and keeps clear of what's already
 * there. Returns notes for anything left out.
 */
export function fillFarmstead({ area, r, free, addBuilding, items }) {
  const notes = [];
  const rot = area.rot ?? 0;
  const flat = shapeToPolygon(area.shape);
  if (flat.length < 3) return notes;
  const [x0, y0, x1, y1] = bbox(flat);
  const c = [(x0 + x1) / 2, (y0 + y1) / 2];
  const yard = rot ? flat.map((p) => rotateAbout(p, c, rot)) : flat;
  items.push({ kind: "surface", id: `${area.id}/yard`, from: area.id, class: "farmyard", poly: yard, surface: "trodden" });
  // Draw every choice first, so the stream is the same whatever fits
  const houseRoof = r.pick(["slate", "slate", "wood-shingle", "wood-shingle"]);
  const hx = x0 + 1.6, hy = y0 + 1.2;
  const parts = [
    { id: `${area.id}/house`, at: [hx, hy], len: 2.4, dep: 1.3, rot, roof: houseRoof, chimney: undefined, r: r.fork("house") },
    { id: `${area.id}/barn`, at: [hx + 1.6, hy + 2.0], len: 2.0, dep: 1.4, rot: rot + 90, roof: "wood-shingle", chimney: false, r: r.fork("barn") },
  ];
  for (const b of parts) {
    const [cx, cy] = rot ? rotateAbout(b.at, c, rot) : b.at;
    const shape = { rect: [cx - b.len / 2, cy - b.dep / 2, cx + b.len / 2, cy + b.dep / 2] };
    const foot = shapeToPolygon(shape, b.rot);
    if (!inside(foot, yard)) {
      notes.push({ level: "warning", id: area.id, message: `"${area.id}": the yard is too small for its ${b.id.split("/")[1]}, so it's left out.` });
      continue;
    }
    if (!free(cx, cy, Math.max(b.len, b.dep) * 0.5, b.dep / 2)) {
      notes.push({ level: "warning", id: area.id, message: `"${area.id}": its ${b.id.split("/")[1]} would sit on something already there, so it's left out.` });
      continue;
    }
    addBuilding({ shape, rot: b.rot, roof: b.roof, height: 20, ...(b.chimney === false ? { chimney: false } : {}) }, b.id, b.r);
  }
  return notes;
}

/**
 * Woods: trees scattered through the area's shape (turned by rot), keeping clear of everything else. mix gives the
 * share of each species; trees (default: a quarter of the area's box, in squares) is how many to try. Every try
 * draws the same numbers whether or not its tree fits.
 */
export function fillWoods({ area, r, free, items }) {
  const poly = shapeToPolygon(area.shape, area.rot ?? 0);
  if (poly.length < 3) return;
  const [x0, y0, x1, y1] = bbox(poly);
  const want = area.trees ?? (x1 - x0) * (y1 - y0) * 0.25;
  const tries = Number.isFinite(want) ? Math.min(MAX_TRIES, Math.max(0, Math.round(want))) : 0;
  const bareShare = area.mix?.bare ?? 0.15;
  const sizes = ["large", "medium", "small"];
  let n = 0;
  for (let i = 0; i < tries; i++) {
    const x = x0 + r.next() * (x1 - x0), y = y0 + r.next() * (y1 - y0);
    const bare = r.next() < bareShare, size = r.pick(sizes), u = r.next(), rot = r.next() * 360, variant = r.int(8);
    if (!pointInPolygon([x, y], poly) || !free(x, y, 0.3)) continue;
    n++;
    items.push(bare
      ? { kind: "tree", id: `${area.id}/t${n}`, from: area.id, x, y, species: "bare", size: null, s: 0.55 + u * 0.3, rot, variant }
      : { kind: "tree", id: `${area.id}/t${n}`, from: area.id, x, y, species: "conifer", size, s: 0.9 + u * 0.6, rot, variant });
  }
}

/** A hedgerow: small bushes every 0.4 squares along the wall's path. */
export function hedgeBushes({ wall, r, items }) {
  const pts = wall.path;
  let n = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const l = Math.hypot(bx - ax, by - ay);
    for (let t = 0; t < l; t += 0.4) {
      n++;
      items.push({ kind: "prop", id: `${wall.id}/b${n}`, from: wall.id, class: "bush", x: ax + ((bx - ax) * t) / l + (r.next() - 0.5) * 0.15, y: ay + ((by - ay) * t) / l + (r.next() - 0.5) * 0.15, scale: 0.7 + r.next() * 0.3, rot: r.next() * 360, variant: r.int(8) });
    }
  }
}

/** Soft patches across the ground: [x, y, radius, kind 0..1], for the style to texture. */
export function groundPatches(r, W, H) {
  const k = (W * H) / 10000;
  return Array.from({ length: Math.round(260 * k) }, () => [r.next() * W, r.next() * H, 1.5 + r.next() * 5, r.next()]);
}
