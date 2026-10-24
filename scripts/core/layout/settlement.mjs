/**
 * The settlement fill outside the plots: farmsteads, woods, hedgerows and ground patches (houses stand on plots,
 * in lots/). Numbers are in squares and were tuned on a 25 ft square (a village overview). Pure: runs anywhere.
 */
import { bbox, pointInPolygon, rotateAbout, shapeToPolygon } from "../geom.mjs";
import { poissonInPolygon } from "../scatter.mjs";
import { makeNoise } from "../noise.mjs";

/** Cap on random tries for one area, so a huge or odd shape can't run on for ever. */
const MAX_TRIES = 20000;

/** True when every corner of a polygon is inside another. */
const inside = (pts, poly) => pts.every((p) => pointInPolygon(p, poly));

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
 * Woods: groves of trees whose crowns touch, rather than trees dotted evenly. Trees are spread by Poisson-disk sampling
 * (Bridson 2007) at a close spacing, but only where a noise is high enough, the threshold set so the area holds about
 * the number of trees asked for (trees; else about one per 2.4 square squares): a few trees make a few groves with
 * open ground between, many make a forest with clearings. Points are laid out before checking for anything else, so
 * what another district places can remove trees but never moves the rest. mix gives the share of each species.
 */
export function fillWoods({ area, r, free, items }) {
  const poly = shapeToPolygon(area.shape, area.rot ?? 0);
  if (poly.length < 3) return;
  const a = polyArea(poly);
  if (!(a > 0)) return;
  const want = Math.min(MAX_TRIES, Number.isFinite(area.trees) && area.trees > 0 ? area.trees : a / 2.4);
  const spacing = 0.85; // squares between trees in a grove: crowns overlap a little
  const full = a / (spacing * spacing * 1.6); // about what a wood packed edge to edge would hold
  const share = Math.min(1, want / full);
  const grove = makeNoise(r.int(2 ** 31), `${area.id}/groves`, { scale: 5, octaves: 2 });
  // The noise level above which the right share of the area is wooded, measured on a grid over the shape
  let level = -Infinity;
  if (share < 0.98) {
    const [x0, y0, x1, y1] = bbox(poly);
    const step = Math.max(0.5, Math.sqrt(((x1 - x0) * (y1 - y0)) / 40000));
    const vals = [];
    for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) if (pointInPolygon([x, y], poly)) vals.push(grove(x, y));
    vals.sort((p, q) => p - q);
    if (vals.length) level = vals[Math.min(vals.length - 1, Math.floor((1 - share) * vals.length))];
  }
  const pts = poissonInPolygon(poly, spacing, r.fork("points"), { keep: (x, y) => grove(x, y) >= level, max: MAX_TRIES });
  const tr = r.fork("trees");
  const bareShare = area.mix?.bare ?? 0.15;
  const sizes = ["large", "medium", "small"];
  let n = 0;
  for (const [x, y] of pts) {
    const bare = tr.next() < bareShare, size = tr.pick(sizes), u = tr.next(), rot = tr.next() * 360, variant = tr.int(8);
    if (!free(x, y, 0.3)) continue;
    n++;
    items.push(bare
      ? { kind: "tree", id: `${area.id}/t${n}`, from: area.id, x, y, species: "bare", size: null, s: 0.55 + u * 0.3, rot, variant }
      : { kind: "tree", id: `${area.id}/t${n}`, from: area.id, x, y, species: "conifer", size, s: 0.9 + u * 0.6, rot, variant });
  }
}

function polyArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; s += x1 * y2 - x2 * y1; }
  return Math.abs(s / 2);
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
