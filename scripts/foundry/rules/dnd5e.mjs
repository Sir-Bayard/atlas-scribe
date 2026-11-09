/**
 * D&D 5e's rules on an AtlasScribe battle map (an adapter, foundry/rules.mjs):
 *   - Difficult terrain: banks, slopes, shallows and ice are the system's own difficult terrain, each of its kind
 *     (slope, liquid, ice), so a creature that ignores a kind of difficult terrain ignores it here. Deep water keeps
 *     Foundry's own cost (the system already charges extra to swim without a swim speed).
 *   - Floors: the system's falling reads a scene's surfaces as the floors a creature stands on, so the ground is laid as
 *     surfaces (each piece at its elevation, a bridge's deck over its bed) and every floor above or below as one at its
 *     height. Without them a token standing on a rise would count as falling.
 *   - Falling: a move over the ground's heights is made with them in it, so a token walking down a bank isn't taken for
 *     falling, and one that jumps down over a cliff's edge is left in the air for the system's falling to take, with
 *     its damage (unless it can't fall: it flies, hovers, or the world turned falling off). Walking off a cliff is still
 *     stopped, as in every system.
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

  heightBehaviors(spec, { core }) {
    const rough = roughOf(spec);
    // (a world whose system has no typed difficult terrain, an older one, keeps Foundry's own costs)
    if (!rough || !spec.cost || !globalThis.CONFIG?.RegionBehavior?.dataModels?.["dnd5e.difficultTerrain"]) return core();
    return [{ type: "dnd5e.difficultTerrain", name: "Difficult terrain", system: { magical: false, types: [TERRAIN_5E[rough]], ignoredDispositions: [] } }];
  },

  regions({ layout, levels, sceneX, sceneY, pps, floorFt = 10 }) {
    const pts = (ring) => ring.flatMap(([x, y]) => [Math.round(sceneX + x * pps), Math.round(sceneY + y * pps)]);
    const [W, H] = layout?.size?.squares ?? [0, 0];
    const out = [];
    for (const s of groundSurfaces(layout)) out.push({
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
