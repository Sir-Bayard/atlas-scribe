/**
 * Game rules on a battle map, before any game system: what each part of a map is, in plain words a system's adapter
 * (foundry/rules.mjs) turns into that system's own rules. AtlasScribe names no game system here; an adapter for
 * Pathfinder Second Edition or D&D 5e reads these words and makes its regions, scene settings and flags from them.
 *
 *   - Rough ground: each region that slows a walker is slope (a bank or a walkable slope), water (shallows) or ice.
 *     Deep water isn't rough ground: it's swum.
 *   - Climbing: a cliff's Climb DC, from its own setting, else by its face: natural rock at the trained level, a cut or
 *     built face (a height drawn with sharp corners) one step harder.
 *   - Cover: a fence, a low wall or a castle's parapet is a waist-high obstacle a creature can shelter behind.
 *   - Environments: what kind of place a map is (a town, a forest, open country) and the places in it that are
 *     another kind (a wood in a town, deep water, a cellar).
 *
 * Pure: runs in the worker, the page and under node.
 */
import { shapeToPolygon, pointInPolygon } from "./geom.mjs";
import { intersect, union, area } from "./lots/poly.mjs";

/** A cliff's Climb DC when its plan gives none: natural rock, and a cut or built face. */
export const CLIMB_DC = { natural: 15, built: 20 };

/** A cliff edge's Climb DC: its plan's climbDC, else by its face. */
export function climbDC(edge) {
  const n = Number(edge?.climbDC);
  if (edge?.climbDC != null && Number.isFinite(n) && n > 0) return Math.round(n);
  return edge?.built ? CLIMB_DC.built : CLIMB_DC.natural;
}

/** What kind of rough ground each slowing region is (a face by its style, water by its kind); deep water is none. */
export const ROUGH = { bank: "slope", slope: "slope", shallow: "water", ice: "ice" };

/** The rough ground a height region is (a region spec from height.mjs), or null. */
export const roughOf = (r) => (r?.kind === "face" ? ROUGH[r.style] ?? null : ROUGH[r?.kind] ?? null);

/** The walls a creature can take cover behind (a battle wall's kind): each a waist-high obstacle. */
export const COVER = { fence: "low", "low-wall": "low", parapet: "low" };

/** The share of a map woods must cover for the map to be a forest. */
export const FOREST_SHARE = 0.25;

/**
 * What kind of place a battle map is, and the places in it of another kind. Returns { scene, forest } (scene: the
 * map's own environments, urban, forest or plains; forest: the woods' outlines, in squares, when the map itself isn't
 * a forest). A map is urban when it has a district or a town wall (a castle's too), a forest when its woods cover
 * FOREST_SHARE of it, else open country. A cellar's underground and deep water's aquatic are its adapter's to add,
 * on the cellar's level and the deep water's regions.
 */
export function environmentsOf(plan, layout) {
  const features = Array.isArray(plan?.features) ? plan.features : [];
  const [W, H] = layout?.size?.squares ?? plan?.size?.squares ?? [0, 0];
  const map = W > 0 && H > 0 ? [[[0, 0], [W, 0], [W, H], [0, H]]] : null;
  const urban = features.some((f) => f.type === "district" || (f.type === "wall" && (f.class === "town" || f.class === "palisade")))
    || (layout?.items ?? []).some((i) => i.kind === "wall" && i.curtain);
  const woods = [];
  for (const f of features.filter((x) => x.type === "area" && x.class === "woods" && x.shape)) {
    const poly = shapeToPolygon(f.shape, f.rot ?? 0);
    if (poly.length >= 3) woods.push(poly);
  }
  const inMap = woods.length && map ? intersect(union(woods), map) : [];
  const share = map ? areaOf(inMap) / (W * H) : 0;
  if (urban) return { scene: ["urban"], forest: inMap };
  if (share >= FOREST_SHARE) return { scene: ["forest"], forest: [] };
  return { scene: ["plains"], forest: inMap };
}

/** The area of a set of rings read even-odd: a ring inside an odd number of others is a hole, counted against. */
function areaOf(rings) {
  const ok = rings.filter((r) => r.length >= 3);
  return ok.reduce((s, ring, i) => s + (ok.filter((o, j) => j !== i && pointInPolygon(ring[0], o)).length % 2 ? -1 : 1) * area(ring), 0);
}
