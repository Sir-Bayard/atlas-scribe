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
 *
 * A walker stopped at a cliff is shown a card (to them and the GM) with the check to climb it at the cliff's Climb DC,
 * in the game system's own words (rules.mjs). Where the system has falling of its own (an adapter's falls), a token that leaves a
 * cliff top in the air (a jump, say) is left at its height for the system to drop it.
 */
import { groundAt, blockedBy, groundWay, WALKING, OFF_GROUND } from "../core/height.mjs";
import { rules } from "./rules.mjs";

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

/**
 * A scene's height zones on a level, in its pixels: [{ kind, polys, elevation, order, over, style }]. The ground's
 * regions lie on the ground's level when the scene has floors, so a token in a cellar or up on a floor has none.
 */
function zonesOf(scene, level = null) {
  if (!scene) return [];
  const all = zones.get(scene.id) ?? readZones(scene);
  return all.filter((z) => !z.levels.length || !level || z.levels.includes(level));
}

/** Every height zone of a scene, each with the levels its region lies on (none: every level); kept until one changes. */
function readZones(scene) {
  const out = [];
  for (const r of scene.regions) {
    const f = r.flags?.[MOD];
    if (!f || !("built" in f) || !["ground", "face", "shallow", "deep", "ice"].includes(f.kind)) continue;
    const pairs = (flat) => { const pts = []; for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]); return pts; };
    const polys = r.shapes.filter((s) => s.type === "polygon" && s.points?.length >= 6).map((s) => pairs(s.points));
    const lines = (Array.isArray(f.lines) ? f.lines : []).filter((l) => Array.isArray(l) && l.length >= 4).map(pairs);
    out.push({ kind: f.kind, polys, elevation: f.elevation ?? 0, order: f.order ?? 0, over: !!f.over, style: f.style ?? null, lines, alone: !!f.alone, climb: Number(f.climb) > 0 ? Number(f.climb) : null, levels: [...(r.levels ?? [])] });
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
  const zs = zonesOf(doc.parent, doc.level ?? data?.level ?? null);
  if (!zs.length) return;
  const e = groundAt(zs, middle(doc, { x: doc.x, y: doc.y, width: doc.width, height: doc.height }));
  if (e !== (doc.elevation ?? 0)) doc.updateSource({ elevation: e });
}

/**
 * A walking step up or down a cliff or into deep water is stopped, with a word to whoever moved it. Where the game
 * system has falling of its own, a move by a token on the ground is made again with the ground's heights in it (each
 * waypoint at the ground there), so the system never sees it standing above the ground it walked down onto.
 */
function onPreMove(doc, movement, operation) {
  if (!on() || operation?.atlasScribeHeight) return;
  const zs = zonesOf(doc.parent, movement.origin?.level ?? doc.level ?? null);
  if (!zs.length) return;
  const step = (doc.parent?.grid?.size ?? 100) * 0.1;
  // (a move made on the map; a script's move is grounded after it, onMove, so the script sees its move made)
  const R = rules(), falls = fallsIn(R) && STOPPED.includes(movement.method);
  const all = [...(movement.passed?.waypoints ?? []), ...(falls ? movement.pending?.waypoints ?? [] : [])];
  if (STOPPED.includes(movement.method)) {
    // (a move made again isn't checked again, so all of it is checked here)
    const ways = [movement.origin, ...all];
    for (let i = 1; i < ways.length; i++) {
      if (!WALKING.includes(ways[i].action)) continue;
      const a = middle(doc, ways[i - 1]), b = middle(doc, ways[i]);
      // (a change of elevation alone goes nowhere)
      if (a[0] === b[0] && a[1] === b[1]) continue;
      const hit = blockedBy(zs, a, b, step, { current: ways[i - 1].elevation ?? doc.elevation });
      if (!hit) continue;
      ui.notifications.warn(hit.why === "deep" ? `${doc.name} can't walk into deep water: swim instead.` : `${doc.name} can't walk up or down a cliff: climb, leap or fly instead.`);
      if (hit.why === "cliff") climbCard(doc, hit.zone).catch((err) => console.warn("AtlasScribe | couldn't show the climb card:", err));
      return false;
    }
  }
  if (!falls || !all.length) return;
  // (Foundry 14 reads a region's shape without working it out first when a move changes height at its ends, which
  // fails on a scene no one is viewing; reading each one's shape first works it out, before the system is asked too)
  for (const r of doc.parent?.regions ?? []) void r.polygonTree;
  const way = groundWay(zs, { p: middle(doc, movement.origin), elevation: movement.origin.elevation },
    all.map((w) => ({ p: middle(doc, w), elevation: w.elevation, action: w.action })),
    { step, falls: (i, e) => { try { return !!R.falls(doc, { ...all[i], elevation: e }); } catch { return false; } } });
  if (!way) return;
  // (a jump the system drops the token from ends the move where it jumps: it falls there)
  const ways = all.slice(0, way.length).map((w, i) => ({ ...Object.fromEntries(WAY_KEYS.filter((k) => w[k] !== undefined).map((k) => [k, w[k]])), elevation: way[i] }));
  const options = { method: movement.method, atlasScribeHeight: true, constrainOptions: foundry.utils.deepClone(movement.constrainOptions ?? {}), autoRotate: movement.autoRotate, showRuler: movement.showRuler };
  setTimeout(() => doc.move(ways, options).catch((err) => console.warn("AtlasScribe | couldn't move a token over the ground's heights:", err)), 0);
  return false;
}

/** Whether a game system's rules drop a token left above the ground themselves (rules.mjs: falls). */
const fallsIn = (R) => typeof R?.falls === "function";
/** What a waypoint carries into a move made again. */
const WAY_KEYS = ["x", "y", "width", "height", "shape", "action", "snapped", "explicit", "checkpoint", "level"];

/** When each token was last shown a climb card for a cliff, so a walker trying again at once isn't shown another. */
const shown = new Map();
const AGAIN = 6000;

/**
 * A card to whoever moved a token that a cliff stopped, and to the GM: the check to climb it at its Climb DC, in the
 * game system's words (an inline check its chat makes a button of), else plain words.
 */
async function climbCard(doc, zone) {
  const dc = Number(zone?.climb);
  if (!(dc > 0)) return;
  const key = `${doc.uuid}|${zone.lines?.[0]?.slice(0, 2).join(",") ?? ""}`, now = Date.now();
  if (now - (shown.get(key) ?? 0) < AGAIN) return;
  shown.set(key, now);
  const R = rules();
  const check = (typeof R.climbCheck === "function" ? R.climbCheck(dc) : null) ?? `Athletics (climbing), DC ${dc}`;
  const name = foundry.utils.escapeHTML(doc.name ?? "This token");
  const whisper = [...new Set([game.user.id, ...game.users.filter((u) => u.isGM).map((u) => u.id)])];
  await ChatMessage.implementation.create({
    content: `<p><strong>${name}</strong> can't walk up or down this cliff. To climb it:</p><p>${check}</p>`,
    speaker: ChatMessage.implementation.getSpeaker({ token: doc }),
    whisper,
    flags: { [MOD]: { climb: dc } },
  });
}

/**
 * When a move ends, a token that was standing on the ground stands on the ground where it ended: the mover's client
 * sets its elevation, once its walk has played out.
 */
async function onMove(doc, movement, operation, user) {
  if (!on() || !user?.isSelf || operation?.atlasScribeHeight || !GROUNDED.includes(movement.method)) return;
  // (a move made on the map in a system with falling of its own had the ground's heights put into it, onPreMove)
  if (fallsIn(rules()) && STOPPED.includes(movement.method)) return;
  if (movement.pending?.waypoints?.length) return;
  const zs = zonesOf(doc.parent, movement.destination?.level ?? doc.level ?? null);
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
  // (a change of height is a move: the regions' shapes worked out first, as for a move made again, onPreMove)
  for (const r of doc.parent?.regions ?? []) void r.polygonTree;
  await doc.update({ elevation: e }, { atlasScribeHeight: true }).catch((err) => console.warn("AtlasScribe | couldn't set a token's elevation:", err));
}
