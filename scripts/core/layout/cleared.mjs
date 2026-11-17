/**
 * Woods cleared near a town (a woods area with cleared: true): the trees thin toward the town's nearest district or
 * building, scattered close to it and thickening with distance, and where trees were felled stand stumps, with a log
 * or a stack of firewood here and there. Squares; pure: runs anywhere.
 */

/**
 * What decides a cleared wood's trees. toward: points of the town (its districts' outlines, its buildings); band:
 * how far from the town, in squares, the wood is thinned; sq: feet a square; battle: a battle map. Returns null when
 * there's no town to clear toward, else { keep(x, y, u), felled(i, x, y, u) }: keep, whether a tree at x, y stands (u:
 * a number in [0, 1) of the tree's own); felled, the prop left where a tree was taken (null for none), i its count.
 */
export function clearing(toward, { band = 12, id = "wood", sq = 25, battle = false } = {}) {
  if (!toward.length || !(band > 0)) return null;
  // (a grid of the town's points, so the nearest is found among a few cells)
  const cell = band / 2, grid = new Map();
  const key = (i, j) => `${i},${j}`;
  for (const [x, y] of toward) { const k = key(Math.floor(x / cell), Math.floor(y / cell)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([x, y]); }
  const reach = Math.ceil((band * 1.2) / cell);
  const distance = (x, y) => {
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell);
    let best = Infinity;
    for (let i = ci - reach; i <= ci + reach; i++) for (let j = cj - reach; j <= cj + reach; j++) for (const [px, py] of grid.get(key(i, j)) ?? []) { const d = Math.hypot(px - x, py - y); if (d < best) best = d; }
    return best;
  };
  // (the share of trees left standing: a tenth beside the town, all of them a band away, rising smoothly)
  const share = (x, y) => { const t = Math.min(1, distance(x, y) / band); return 0.1 + 0.9 * t * t * (3 - 2 * t); };
  return {
    keep: (x, y, u) => u < share(x, y),
    felled: (i, x, y, u) => {
      if (u >= 0.55) return null;
      const cls = u < 0.42 ? "stump" : u < 0.5 ? "log" : "firewood";
      // (sized as the map's other props are: a battle map's stump and log at their art's size, the rest in feet)
      const feet = { stump: 3, log: 14, firewood: 6 }[cls];
      const scale = battle && cls !== "firewood" ? (cls === "stump" ? 0.45 + u * 0.3 : 0.8) : feet / sq / 0.45;
      return { kind: "prop", id: `${id}/felled${i}`, from: id, class: cls, x, y, rot: (u * 7919) % 360, variant: Math.floor(u * 1000) % 12, scale, felled: true };
    },
  };
}
