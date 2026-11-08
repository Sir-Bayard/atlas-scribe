/**
 * Height in play, on a battle map AtlasScribe published (its ground and water regions, core/height.mjs): a token's
 * elevation follows the ground it moves onto (up a slope, down into a stream's bed, onto a bridge's deck), and one
 * walking can't cross a cliff's top line, up or down, or walk into deep water (it climbs, leaps, flies or swims
 * instead). A token placed
 * on the map starts at the ground's elevation there. All of it is off when the "Battle map heights" setting is.
 *
 * A token's elevation is left alone when it flies or burrows, when its move changes its elevation itself, or when it
 * stands above the ground it's leaving (flying, or raised by hand). Only a move made on the map (dragged, or with the
 * keys) is stopped, as walls stop only those; a script's move is grounded but not stopped. Each client works for the
 * moves it makes.
 */
import { groundAt, walkBlocked, WALKING, OFF_GROUND } from "../core/height.mjs";

const MOD = "atlas-scribe";
const SETTING = "battleHeight";
/** The moves stopped at a cliff or deep water: those a player or GM makes on the map, as walls stop them. */
const STOPPED = ["dragging", "keyboard"];
/** The moves that set a token's elevation: those, and a script's (a token set by its sheet, pasted or undone keeps its own). */
const GROUNDED = [...STOPPED, "api"];

/** Each scene's height zones (from its regions), kept until a region changes. */
const zones = new Map();

/** The setting and the hooks; called at init. */
export function registerHeight() {
  game.settings.register(MOD, SETTING, {
    name: "Battle map heights",
    hint: "On AtlasScribe battle maps, a token's elevation follows the ground it moves onto (up a rise, down into a stream bed), and a walking token can't walk up or down a cliff or into deep water: it climbs, leaps, flies or swims instead. With this off, banks, slopes and water still slow walkers, deep water is greater difficult terrain, and a cliff doesn't stop them.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  for (const h of ["createRegion", "updateRegion", "deleteRegion"]) Hooks.on(h, (r) => zones.delete(r.parent?.id));
  Hooks.on("canvasTearDown", () => zones.clear());
  Hooks.on("preCreateToken", onPreCreate);
  Hooks.on("preMoveToken", onPreMove);
  Hooks.on("moveToken", onMove);
}

const on = () => { try { return game.settings.get(MOD, SETTING); } catch { return false; } };

/** A scene's height zones, in its pixels: [{ kind, polys, elevation, order, over, style }]. */
function zonesOf(scene) {
  if (!scene) return [];
  if (zones.has(scene.id)) return zones.get(scene.id);
  const out = [];
  for (const r of scene.regions) {
    const f = r.flags?.[MOD];
    if (!f || !("built" in f) || !["ground", "face", "shallow", "deep", "ice"].includes(f.kind)) continue;
    const pairs = (flat) => { const pts = []; for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]); return pts; };
    const polys = r.shapes.filter((s) => s.type === "polygon" && s.points?.length >= 6).map((s) => pairs(s.points));
    const lines = (Array.isArray(f.lines) ? f.lines : []).filter((l) => Array.isArray(l) && l.length >= 4).map(pairs);
    out.push({ kind: f.kind, polys, elevation: f.elevation ?? 0, order: f.order ?? 0, over: !!f.over, style: f.style ?? null, lines, alone: !!f.alone });
  }
  zones.set(scene.id, out);
  return out;
}

/** The middle of a token standing at a position ({ x, y, width, height } as a waypoint gives it), in pixels. */
function middle(doc, at) {
  try {
    const c = doc.getCenterPoint(at);
    if (Number.isFinite(c?.x)) return [c.x, c.y];
  } catch { /* an older shape of the call: worked out below */ }
  const g = doc.parent?.grid?.size ?? 100;
  return [at.x + ((at.width ?? doc.width) * g) / 2, at.y + ((at.height ?? doc.height) * g) / 2];
}

/** A token placed on the map stands on the ground there, unless it was given an elevation of its own. */
function onPreCreate(doc, data) {
  if (!on() || (Number.isFinite(data?.elevation) && data.elevation !== 0)) return;
  const zs = zonesOf(doc.parent);
  if (!zs.length) return;
  const e = groundAt(zs, middle(doc, { x: doc.x, y: doc.y, width: doc.width, height: doc.height }));
  if (e !== (doc.elevation ?? 0)) doc.updateSource({ elevation: e });
}

/** A walking step up or down a cliff or into deep water is stopped, with a word to whoever moved it. */
function onPreMove(doc, movement, operation) {
  if (!on() || operation?.atlasScribeHeight || !STOPPED.includes(movement.method)) return;
  const zs = zonesOf(doc.parent);
  if (!zs.length) return;
  const step = (doc.parent?.grid?.size ?? 100) * 0.1;
  const ways = [movement.origin, ...(movement.passed?.waypoints ?? [])];
  for (let i = 1; i < ways.length; i++) {
    if (!WALKING.includes(ways[i].action)) continue;
    const a = middle(doc, ways[i - 1]), b = middle(doc, ways[i]);
    // (a change of elevation alone goes nowhere)
    if (a[0] === b[0] && a[1] === b[1]) continue;
    const why = walkBlocked(zs, a, b, step, { current: ways[i - 1].elevation ?? doc.elevation });
    if (!why) continue;
    ui.notifications.warn(why === "deep" ? `${doc.name} can't walk into deep water: swim instead.` : `${doc.name} can't walk up or down a cliff: climb, leap or fly instead.`);
    return false;
  }
}

/**
 * When a move ends, a token that was standing on the ground stands on the ground where it ended: the mover's client
 * sets its elevation, once its walk has played out.
 */
async function onMove(doc, movement, operation, user) {
  if (!on() || !user?.isSelf || operation?.atlasScribeHeight || !GROUNDED.includes(movement.method)) return;
  if (movement.pending?.waypoints?.length) return;
  const zs = zonesOf(doc.parent);
  if (!zs.length) return;
  const from = movement.origin, to = movement.destination, last = movement.passed?.waypoints?.at(-1);
  if (!from || !to || from.elevation !== to.elevation || OFF_GROUND.includes(last?.action)) return;
  // (one above the ground it left was flying or raised by hand, and stays where it is)
  if (from.elevation > groundAt(zs, middle(doc, from), from.elevation) + 0.01) return;
  const e = groundAt(zs, middle(doc, to), to.elevation);
  if (e === to.elevation) return;
  try {
    await doc.object?.movementAnimationPromise;
  } catch { /* the walk was cut short: set it anyway */ }
  if (doc.x !== to.x || doc.y !== to.y || doc.elevation !== to.elevation) return; // (moved again since)
  await doc.update({ elevation: e }, { atlasScribeHeight: true }).catch((err) => console.warn("AtlasScribe | couldn't set a token's elevation:", err));
}
