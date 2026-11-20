/**
 * D&D 5e's rules on an AtlasScribe battle map (an adapter, foundry/rules.mjs):
 *   - Difficult terrain: banks, slopes, shallows and ice are the system's own difficult terrain, each of its kind
 *     (slope, liquid, ice), so a creature that ignores a kind of difficult terrain ignores it here. Deep water keeps
 *     Foundry's own cost (the system already charges extra to swim without a swim speed).
 *   - Floors: the system's falling reads a scene's surfaces as the floors a creature stands on, so the ground is laid as
 *     surfaces (each piece at its elevation, a bridge's deck over its bed) and every floor above or below as one at its
 *     height. Without them a token standing on a rise would count as falling.
 *   - Falling: AtlasScribe grounds a token on the ground's heights itself, as in every system, so the floors keep the
 *     system from taking a token on a rise for falling. A jump off a cliff lands it below without the system's falling
 *     damage (handing moves to the system's falling waits for floors that slope). Walking off a cliff is stopped.
 *   - Climbing: the card shown to a walker stopped at a cliff carries an Athletics check at the cliff's DC.
 * Cover: a fence, low wall or parapet keeps AtlasScribe's cover mark (the system works out no cover by itself).
 */
import { roughOf } from "../../core/rules.mjs";
import { groundSurfaces } from "../../core/height.mjs";

/** The system's kind of difficult terrain for each rough ground. */
export const TERRAIN_5E = { slope: "slope", water: "liquid", ice: "ice" };

/** A surface a token stands on and nothing else: no wall to sight, light or sound, no roof to fade. */
const floor = { type: "defineSurface", name: "Floor", system: { placement: "bottom", light: false, move: true, sight: false, sound: false, occlusion: false, exposure: false, culling: false } };

export const dnd5e = {
  id: "dnd5e",
  label: "Dungeons & Dragons Fifth Edition",
  // (its floors are laid even with the rules setting on Foundry's own: the system's falling reads them either way)
  surfaces: true,
  // (its falling isn't handed moves: Foundry's floors are flat, so a move made again over a slope stops at the top's
  // edge, below the raised floor (seen in dnd5e 6.0 on Foundry 14.370); AtlasScribe grounds tokens itself, as in
  // every system, and falls() stays for when floors can slope)
  canFall: () => false,

  heightBehaviors(spec, { core }) {
    const rough = roughOf(spec);
    // (a world whose system has no typed difficult terrain, an older one, keeps Foundry's own costs)
    if (!rough || !spec.cost || !globalThis.CONFIG?.RegionBehavior?.dataModels?.["dnd5e.difficultTerrain"]) return core();
    return [{ type: "dnd5e.difficultTerrain", name: "Difficult Terrain", system: { magical: false, types: [TERRAIN_5E[rough]], ignoredDispositions: [] } }];
  },

  regions({ layout, levels, sceneX, sceneY, pps, floorFt = 10 }) {
    const pts = (ring) => ring.flatMap(([x, y]) => [Math.round(sceneX + x * pps), Math.round(sceneY + y * pps)]);
    const [W, H] = layout?.size?.squares ?? [0, 0];
    const out = [];
    // (with Battle map heights off tokens stay at 0 ft, so the ground's heights aren't laid: each level's base is the floor)
    let heights = true;
    try { heights = game.settings.get("atlas-scribe", "battleHeight") !== false; } catch { /* before init: on */ }
    for (const s of heights ? groundSurfaces(layout) : []) out.push({
      name: s.name, color: s.deck ? "#7a5a3a" : "#6f6a4a",
      shapes: s.polys.map((p) => ({ type: "polygon", points: pts(p.points), hole: p.hole })),
      elevation: { bottom: s.elevation, top: s.elevation, topInclusive: true },
      visibility: CONST.REGION_VISIBILITY.LAYER, locked: true,
      behaviors: [floor],
      _floor: 0,
    });
    // (each floor above and the cellar below: one floor all across its level, at its height)
    if (levels && W > 0 && H > 0) for (const f of [...levels.keys()].filter((k) => k !== 0)) out.push({
      name: `Floor (${f * floorFt} ft)`, color: "#6f6a4a",
      shapes: [{ type: "rectangle", x: sceneX, y: sceneY, width: Math.round(W * pps), height: Math.round(H * pps), rotation: 0, hole: false }],
      elevation: { bottom: f * floorFt, top: f * floorFt, topInclusive: true },
      visibility: CONST.REGION_VISIBILITY.LAYER, locked: true,
      behaviors: [floor],
      _floor: f,
    });
    return out;
  },

  climbCheck: (dc) => `[[/check skill=ath dc=${dc}]]`,

  // (only where the system will drop it: not with its falling turned off, nor a token that flies, hovers or can't fall)
  falls(token, position) {
    try {
      if (game.settings.get("dnd5e", "disableFalling")) return false;
    } catch { /* no such setting: the system's falling is on */ }
    if (typeof token?._isFalling !== "function") return false;
    return !!token._isFalling({ position: { ...position, level: position.level ?? token.level } });
  },
};
