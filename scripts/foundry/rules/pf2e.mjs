/**
 * Pathfinder Second Edition's rules on an AtlasScribe battle map (an adapter, foundry/rules.mjs):
 *   - Environments: the scene's own environment types (urban, forest or plains, core/rules.mjs) and an Environment
 *     region over each wood on a map that isn't a forest, over deep water (aquatic) and over a cellar's level
 *     (underground), so the system's terrain roll options are true where a token stands. A scene's environment types
 *     the GM set are kept.
 *   - Climbing: the card shown to a walker stopped at a cliff carries an Athletics check at the cliff's DC.
 *   - Cover: a fence, low wall or parapet carries PF2E Visioner's wall cover flag (standard cover), read when that
 *     module is in the world and ignored when it isn't.
 * The movement costs stay Foundry's own (PF2e reads them as difficult and greater difficult terrain).
 */
import { environmentsOf } from "../../core/rules.mjs";
import { withHoles } from "../../core/height.mjs";

const MOD = "atlas-scribe";

/** An Environment behavior adding or setting environment types where it lies. */
const environment = (types, mode = "add") => ({ type: "environment", name: "Environment", system: { environmentTypes: types, mode } });

/** Whether the system has its Environment behavior (an older version may not): without it none is given. */
const hasEnvironment = () => !!globalThis.CONFIG?.RegionBehavior?.dataModels?.environment;

/** Whether two lists hold the same words. */
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x) => b.includes(x));

export const pf2e = {
  id: "pf2e",
  label: "Pathfinder Second Edition",

  heightBehaviors(spec, { core }) {
    const out = core();
    // (deep water is aquatic: a token swimming in it has the aquatic environment)
    if (spec.kind === "deep" && hasEnvironment()) out.push(environment(["aquatic"]));
    return out;
  },

  sceneData({ plan, layout, scene }) {
    const want = environmentsOf(plan, layout).scene;
    const now = scene?.flags?.pf2e?.environmentTypes ?? [];
    const ours = scene?.flags?.[MOD]?.environment ?? null;
    // (only a scene that never had any, or still has the ones AtlasScribe set last time: the GM's own choice stays,
    // none at all included)
    if (Array.isArray(ours) ? !same(now, ours) : Array.isArray(now) && now.length) return null;
    return { "flags.pf2e.environmentTypes": want, [`flags.${MOD}.environment`]: want };
  },

  regions({ plan, layout, levels, sceneX, sceneY, pps }) {
    if (!hasEnvironment()) return [];
    const pts = (ring) => ring.flatMap(([x, y]) => [Math.round(sceneX + x * pps), Math.round(sceneY + y * pps)]);
    const [W, H] = layout?.size?.squares ?? [0, 0];
    const out = [];
    const { forest } = environmentsOf(plan, layout);
    const woods = withHoles(forest);
    if (woods.length) out.push({
      name: "Woods (forest)", color: "#3f6b35",
      shapes: woods.map((p) => ({ type: "polygon", points: pts(p.points), hole: p.hole })),
      visibility: CONST.REGION_VISIBILITY.LAYER, locked: true,
      behaviors: [environment(["forest"])],
      _floor: 0,
    });
    // (a cellar is underground, wherever on its level a token stands)
    if (levels?.has?.(-1) && W > 0 && H > 0) out.push({
      name: "Cellar (underground)", color: "#5a4a3a",
      shapes: [{ type: "rectangle", x: sceneX, y: sceneY, width: Math.round(W * pps), height: Math.round(H * pps), rotation: 0, hole: false }],
      visibility: CONST.REGION_VISIBILITY.LAYER, locked: true,
      behaviors: [environment(["underground"], "override")],
      _floor: -1,
    });
    return out;
  },

  wall(data) {
    if (!data?.flags?.[MOD]?.cover) return data;
    return { ...data, flags: { ...data.flags, "pf2e-visioner": { ...(data.flags["pf2e-visioner"] ?? {}), coverOverride: "standard" } } };
  },

  climbCheck: (dc) => `@Check[athletics|dc:${dc}]`,
};
