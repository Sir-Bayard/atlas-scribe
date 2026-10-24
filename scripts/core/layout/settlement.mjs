/**
 * The settlement fill: houses along streets, farmsteads, woods, hedgerows and ground patches. Numbers are in
 * squares and were tuned on a 25 ft square (a village overview). Pure: runs anywhere.
 */
import { DEG, pointInPolygon, shapeToPolygon } from "../geom.mjs";

/** Roofs for ordinary houses: slate most of all, then wood shingle, a few clay tiles. */
const HOUSE_ROOFS = ["slate", "slate", "slate", "slate", "wood-shingle", "wood-shingle", "tile-red", "tile-brown"];

/**
 * The "roadside" profile: houses along both sides of every road and lane through the district, ridges along the
 * street, turned and sized a little differently each, with a walled kitchen garden behind. Only inside the district.
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
      while (s < seg - 0.4) {
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
          if (!pointInPolygon([cx, cy], poly) || !free(cx, cy, rad, dep / 2)) continue;
          n++;
          const house = addBuilding({ id: `${district.id}/h${n}`, building: { shape: { rect: [cx - jl / 2, cy - dep / 2, cx + jl / 2, cy + dep / 2] }, rot, roof, height: 20 } });
          // The garden behind: full depth if it fits, else shallower, else none. It mustn't overlap another garden, a
          // building, a yard, a square, water or a road.
          if (district.gardens !== false) {
            const own = house?.footprint ?? null;
            for (const gd of [1.6, 1.0]) {
              const g = dep / 2 + 0.1 + gd / 2;
              const garden = { cx: cx + nx * g, cy: cy + ny * g, w: jl * 0.95, d: gd, rot };
              const gp = shapeToPolygon({ rect: [garden.cx - garden.w / 2, garden.cy - garden.d / 2, garden.cx + garden.w / 2, garden.cy + garden.d / 2] }, rot);
              if (freeGarden(gp, own, true)) {
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

/** A farmstead: its yard (the area's shape), a house near the yard's top left and a barn across from it. */
export function fillFarmstead({ area, r, addBuilding, items }) {
  const [x0, y0, x1, y1] = area.shape.rect ?? bboxOf(area.shape);
  const rot = area.rot ?? 0;
  const hx = x0 + 1.6, hy = y0 + 1.2;
  items.push({ kind: "surface", id: `${area.id}/yard`, from: area.id, class: "farmyard", poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], surface: "trodden" });
  addBuilding({ shape: { rect: [hx - 1.2, hy - 0.65, hx + 1.2, hy + 0.65] }, rot, roof: r.pick(["slate", "slate", "wood-shingle", "wood-shingle"]), height: 20 }, `${area.id}/house`);
  addBuilding({ shape: { rect: [hx + 1.6 - 1.0, hy + 2.0 - 0.7, hx + 1.6 + 1.0, hy + 2.0 + 0.7] }, rot: rot + 90, roof: "wood-shingle", height: 20, chimney: false }, `${area.id}/barn`);
}

/** Woods: trees scattered through the area, keeping clear of everything else. mix gives the share of each species. */
export function fillWoods({ area, r, free, items }) {
  const [x0, y0, x1, y1] = area.shape.rect ?? bboxOf(area.shape);
  const tries = area.trees ?? Math.round((x1 - x0) * (y1 - y0) * 0.25);
  const bareShare = area.mix?.bare ?? 0.15;
  const sizes = ["large", "medium", "small"];
  let n = 0;
  for (let i = 0; i < tries; i++) {
    const x = x0 + r.next() * (x1 - x0), y = y0 + r.next() * (y1 - y0);
    if (!free(x, y, 0.3)) continue;
    const bare = r.next() < bareShare;
    n++;
    items.push(bare
      ? { kind: "tree", id: `${area.id}/t${n}`, from: area.id, x, y, species: "bare", size: null, s: 0.55 + r.next() * 0.3, rot: r.next() * 360, variant: r.int(8) }
      : { kind: "tree", id: `${area.id}/t${n}`, from: area.id, x, y, species: "conifer", size: r.pick(sizes), s: 0.9 + r.next() * 0.6, rot: r.next() * 360, variant: r.int(8) });
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

function bboxOf(shape) {
  const pts = Array.isArray(shape) ? shape : [];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
