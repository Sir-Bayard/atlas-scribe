/**
 * Game rules on a battle map: the adapter for the world's game system. AtlasScribe itself uses only Foundry's own
 * region behaviors (a movement cost over banks, slopes and water; change level on stairs; a roof's surface), which any
 * system reads. An adapter adds what one system's own rules understand, from the plain words in core/rules.mjs:
 * Pathfinder Second Edition's (rules/pf2e.mjs) comes with the module, and another module can add one for any system
 * (registerRules, or the "atlas-scribe.rules" hook fired at setup). The D&D 5e adapter (rules/dnd5e.mjs) is written
 * and tested in node but held back until it's checked in a live 5e world (planned for after 1.0), so a 5e world gets
 * Foundry's own rules for now.
 *
 * An adapter is an object; every part is optional, and a part left out keeps Foundry's own:
 *   id, label: its name.
 *   heightBehaviors(spec, { core }): the behaviors of a ground, face or water region (spec: a region spec from
 *     core/height.mjs; core(): Foundry's own behaviors for it), or undefined for Foundry's own.
 *   sceneData({ plan, layout, scene }): changes to the scene's own data (its flags), or null.
 *   regions({ plan, layout, levels, sceneX, sceneY, pps, floorFt }): more regions for the map, each as Region data
 *     with _floor (a floor: 0 the ground, -1 the cellar, 1 and up above), _floors (several) or _all (every level);
 *     levels: the scene's floors (a Map of floor to level id, null with none but the ground).
 *   wall(data): a wall's data, changed as the system wants (cover, say): flags.atlas-scribe.cover marks a wall a
 *     creature can take cover behind (core/rules.mjs COVER).
 *   climbCheck(dc): the check to climb a cliff, as text for a chat card (an inline check the system makes a button
 *     of), shown to whoever was stopped at the cliff.
 *   falls(token, position): for a system with falling of its own: whether it drops a token at that position (a
 *     waypoint, at the elevation it left a cliff top at). With it, a move over the ground's heights is made with them in
 *     it (each waypoint at the ground there, so the system never sees a token above the ground it walked down onto),
 *     and a jump down over a cliff's edge is left in the air where this says the system drops it.
 */
import { pf2e } from "./rules/pf2e.mjs";

const MOD = "atlas-scribe";
const SETTING = "gameRules";

/** Foundry's own rules: no adapter. */
export const CORE = Object.freeze({ id: "core", label: "Foundry's own" });

/** The adapters by game system id. */
const adapters = new Map([["pf2e", pf2e]]);

/** Adds (or replaces) the adapter for a game system. Returns true when it was taken. */
export function registerRules(systemId, adapter) {
  if (typeof systemId !== "string" || !systemId || !adapter || typeof adapter !== "object") return false;
  adapters.set(systemId, { ...adapter, id: systemId });
  return true;
}

/** The world setting, and the hook other modules add their adapters on. Called at init. */
export function registerRulesSetting() {
  game.settings.register(MOD, SETTING, {
    name: "Battle map rules",
    hint: "The rules a battle map's regions follow. The game system's: PF2e's environments and climb checks, or another system's when a module adds it (any other system keeps Foundry's own). Foundry's own: only the movement costs and level changes every system reads. Takes effect when a scene is made or updated.",
    scope: "world",
    config: true,
    type: String,
    choices: { system: "The game system's", core: "Foundry's own" },
    default: "system",
  });
  Hooks.once("setup", () => Hooks.callAll(`${MOD}.rules`, registerRules));
}

/** The adapter in use: the world's game system's, unless the setting says Foundry's own or there's none. */
export function rules() {
  let which = "system";
  try { which = game.settings.get(MOD, SETTING); } catch { /* before init: the system's */ }
  if (which === "core") return CORE;
  return adapters.get(globalThis.game?.system?.id) ?? CORE;
}

/** The adapter for a system id, for tests and the API (Foundry's own when there's none). */
export const rulesFor = (systemId) => adapters.get(systemId) ?? CORE;
