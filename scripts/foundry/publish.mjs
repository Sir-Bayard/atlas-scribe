/**
 * Publishing: a rendered map becomes a Foundry scene, a new one unless the GM names one to update (backed up first as
 * JSON in <output>/backups, its name kept). Everything AtlasScribe adds carries flags under "atlas-scribe", so a
 * republish replaces only its own labels, tiles, walls, regions and lights and leaves the GM's alone. A battle map
 * follows the game system's rules through its adapter (rules.mjs).
 */
import { upload, freeName } from "./files.mjs";
import { LABEL_SIZES, isObj } from "../core/plan.mjs";
import { labelsOf, useLabelsOf } from "../core/labels.mjs";
import { titleBox, paintTitle } from "../render/styles/illustrated.mjs";
import { footprint, roofHeight, ROOF_HEIGHT } from "../core/layout/battle.mjs";
import { union, shapes } from "../core/lots/poly.mjs";
import { FURNITURE, FLOORS } from "../core/layout/rooms.mjs";
import { heightRegions, groundOf, WALKING } from "../core/height.mjs";
import { LIGHTS, LIT_FROM } from "../core/layout/lights.mjs";
import { CASTLE } from "../core/layout/castle.mjs";
import { COVER } from "../core/rules.mjs";
import { rules as rulesInUse, CORE } from "./rules.mjs";

const MOD = "atlas-scribe";
const THUMB = 300;
/** Foundry's limits on a drawing's font size. */
const FONT = { min: 8, max: 256 };

/**
 * plan: a normalized plan. image: the rendered map's path, width, height and thumb (a Blob). folder: the output
 * folder. layout: the map's layout (none: no notable-building labels or battle documents). sceneId: a scene to update
 * (one AtlasScribe didn't make is refused unless force). check(): throws once the job is canceled; called before
 * anything is written. Returns { sceneId, created, backup, thumb, labels, title, overheads, furniture, mist, walls,
 * roofs, heights, lights, stairs, levels, rules, ruled, warnings }, counts of what was placed.
 */
export async function publish({ plan, image, width, height, folder, layout = null, sceneId = null, force = false, check = () => {}, onProgress = () => {} }) {
  const warnings = [];
  const opts = plan.output.scene;
  const R = rulesInUse();
  let backup = null;

  // The scene to update, if one was named, and a backup of it first
  if (sceneId) {
    const scene = sceneById(sceneId);
    if (!scene.flags?.[MOD] && !force)
      throw new Error(`AtlasScribe: "${scene.name}" wasn't made by AtlasScribe, so it isn't changed. Publish with force: true to replace its background and settings anyway (it's backed up first).`);
    check();
    onProgress(0.1, "Backing up the scene");
    const json = JSON.stringify(scene.toObject(), null, 1);
    const dir = `${folder}/backups`;
    backup = await upload(dir, await freeName(dir, `${scene.name}-${stamp()}`, "json"), new Blob([json], { type: "application/json" }));
  }

  // The thumbnail is named after the scene, so a republish replaces it; it's saved only after the last chance to stop
  check();
  onProgress(0.3, "Making the thumbnail");
  const id = sceneId ?? foundry.utils.randomID();
  const thumbBlob = await thumbOf(image);
  check(); // the last chance to stop: from here the scene is written
  const thumb = await upload(`${folder}/thumbs`, `${id}.webp`, thumbBlob);

  // (a battle map left without weather snows in winter; "none" for none)
  // (a battle map is one by its layout, or by its plan when it couldn't be laid out again for a publish by path)
  const battle = (layout?.kind ?? plan.kind) === "battle";
  let weather = opts.weather ?? (battle && (layout?.season ?? plan.season) === "winter" ? "snow" : "");
  if (weather === "none") weather = "";
  if (weather && !(weather in (CONFIG.weatherEffects ?? {}))) {
    warnings.push(`The weather "${weather}" isn't one this world offers, so the scene has none.`);
    weather = "";
  }
  // (the time of day, when the plan gives one, in place of its darkness and global light; one taken off again puts
  // back the plain tint and dim global light it replaced, kept as the scene's flag time)
  const time = TIMES[opts.time] ?? null;
  const hadTime = sceneId ? (sceneById(sceneId)?.getFlag(MOD, "time") ?? null) : null;
  const environment = time
    ? { darknessLevel: time.darkness, globalLight: { enabled: time.global, bright: time.bright }, base: time.base ?? BASE_TINT }
    : { darknessLevel: opts.darkness, globalLight: { enabled: opts.globalLight, ...(hadTime ? { bright: false } : {}) }, ...(hadTime ? { base: BASE_TINT } : {}) };
  const data = {
    width, height,
    padding: opts.padding,
    thumb,
    grid: { type: CONST.GRID_TYPES.SQUARE, size: plan.output.pxPerSquare, distance: plan.size.ftPerSquare, units: "ft", alpha: opts.gridAlpha },
    tokenVision: opts.tokenVision,
    fog: { mode: opts.fog ? CONST.FOG_EXPLORATION_MODES.INDIVIDUAL : CONST.FOG_EXPLORATION_MODES.DISABLED },
    environment,
    weather,
    navigation: opts.navigation,
    flags: { [MOD]: { plan: plan.id ?? null, image: image.path, version: game.modules.get(MOD)?.version ?? null, built: Date.now(), time: time ? opts.time : null } },
  };

  onProgress(0.5, sceneId ? "Updating the scene" : "Creating the scene");
  // A battle map's level reaches up to its roofs (Foundry draws a door's art at the level's top). AtlasScribe sets
  // that top only on a level with none or the one it set before (flag levelTop), and takes it off for a settlement
  // map
  const reach = battle ? { elevation: { bottom: 0, top: ROOF_HEIGHT.low } } : {};
  let scene, created = false;
  if (sceneId) {
    scene = sceneById(sceneId);
    const before = scene.getFlag(MOD, "image"), wasTop = scene.getFlag(MOD, "levelTop") ?? null;
    await scene.update(data);
    scene = sceneById(sceneId);
    // The level that shows AtlasScribe's last map, else the one the scene opens on
    const level = scene.levels.find((l) => before && l.background?.src === before) ?? scene.initialLevel ?? scene.levels.contents[0];
    let top;
    if (level) {
      const now = level.elevation?.top ?? null, ours = now !== null && now === wasTop;
      if (battle && (now === null || ours)) top = ROOF_HEIGHT.low;
      else if (!battle && ours) top = null;
      await scene.updateEmbeddedDocuments("Level", [{ _id: level.id, background: { src: image.path }, ...(top !== undefined ? { "elevation.top": top } : {}) }]);
    } else {
      await scene.createEmbeddedDocuments("Level", [{ name: "Ground", background: { src: image.path }, ...reach }]);
      if (battle) top = ROOF_HEIGHT.low;
    }
    if (top !== undefined) await sceneById(sceneId).update({ [`flags.${MOD}.levelTop`]: top });
  } else {
    if (battle) data.flags[MOD].levelTop = ROOF_HEIGHT.low;
    scene = await Scene.create({ ...data, _id: id, name: freeSceneName(opts.name), levels: [{ name: "Ground", background: { src: image.path }, ...reach }] }, { keepId: true });
    if (!scene) throw new Error("AtlasScribe: Foundry didn't create the scene");
    sceneId = scene.id;
    created = true;
  }

  // A battle map's floors above and below the ground, each a Foundry level with its image; every document placed
  // below goes on its own floor's level
  let levelOf = null;
  if (!battle) {
    // (a settlement map over what was a battle map with floors: its floors' levels come out)
    try { await syncLevels(sceneId, [], image.path); } catch (e) { warnings.push(`The old floors' levels couldn't be taken out (${e.message}).`); }
  } else {
    try {
      onProgress(0.8, "Placing the floors");
      // (a castle's 20 ft level is its wall walk as well as its buildings' floors at that height)
      const walk = layout?.items?.some((i) => i.kind === "wall" && i.curtain);
      levelOf = await syncLevels(sceneId, image.levels, image.path, walk ? { 2: "Wall walk" } : {});
      // (a map given by its path brings no floor images: a scene without its floors' levels gets only the ground's)
      if (!levelOf && !Array.isArray(image.levels) && layout?.items?.some((i) => i.kind === "stairs")) warnings.push("This battle map's floors above and below the ground weren't made: they come only with a map rendered for the scene, so only the ground's walls, furniture and lights were placed.");
    } catch (e) {
      warnings.push(`The floors above and below the ground couldn't all be made levels (${e.message}).`);
    }
  }
  // The game system's own scene settings (PF2e's environment types) through its adapter; ones AtlasScribe set that no
  // adapter sets now come off again, unless the GM changed them
  try {
    // (a battle map with no layout, published by its path and not laid out again, keeps what it had)
    const change = battle && !layout ? null : battle && typeof R.sceneData === "function" ? R.sceneData({ plan, layout, scene: sceneById(sceneId) }) : unsetScene(sceneById(sceneId));
    if (change && Object.keys(change).length) await sceneById(sceneId).update(change);
  } catch (e) {
    warnings.push(`The scene's ${R.label ?? R.id} settings couldn't be made (${e.message}).`);
  }
  // Labels: every label AtlasScribe put in this scene out, the plan's in, on the ground's level when there are floors
  onProgress(0.85, "Placing the labels");
  // The new labels go in before the old ones come out, so a failure never leaves the scene with none
  scene = sceneById(sceneId);
  const old = scene.drawings.filter((d) => isObj(d.flags?.[MOD]) && "batch" in d.flags[MOD]).map((d) => d.id);
  const labels = (await labelDrawings(plan, sceneById(sceneId), warnings, layout)).map((d) => (levelOf?.get(0) ? { ...d, levels: [levelOf.get(0)] } : d));
  if (labels.length) await sceneById(sceneId).createEmbeddedDocuments("Drawing", labels);
  if (old.length) await sceneById(sceneId).deleteEmbeddedDocuments("Drawing", old);

  /**
   * A document's data on its floor's level (_floor; _floors, several; _all, every level), its floor notes taken off.
   */
  // (one whose floors have no level is left out, never piled onto the ground; with no levels but the ground's, only
  // the ground's documents go in)
  const onFloor = ({ _floor, _floors, _all, ...d }) => {
    const fs = _floors ?? [_floor ?? 0];
    if (_all) return d;
    if (!levelOf) return fs.includes(0) ? d : null;
    const ids = fs.map((f) => levelOf.get(f)).filter(Boolean);
    return ids.length ? { ...d, levels: ids } : null;
  };

  // The map's name on a dressed map: a cartouche on a tile of its own, hidden until the GM shows it to the players
  // (the old one out once the new one is in)
  onProgress(0.9, "Placing the title");
  // (an old one comes out only when a new one went in, or the map no longer has one; never on a failure)
  const oldTitles = sceneById(sceneId).tiles.filter((t) => isObj(t.flags?.[MOD]) && "title" in t.flags[MOD]).map((t) => t.id);
  const wanted = plan.style === "illustrated" && plan.output.dressing === true && typeof plan.name === "string" && plan.name.trim() !== "";
  let title = false;
  if (wanted && !layout) warnings.push("The map's name wasn't made into a tile (the map couldn't be laid out again); the scene keeps the one it had.");
  else {
    try {
      const data = wanted ? await titleTile(plan, layout, sceneById(sceneId), sceneId, folder) : null;
      if (data) { await sceneById(sceneId).createEmbeddedDocuments("Tile", [data]); title = true; }
      if ((title || !wanted) && oldTitles.length) await sceneById(sceneId).deleteEmbeddedDocuments("Tile", oldTitles);
    } catch (e) {
      warnings.push(`The map's name couldn't be made into a tile (${e.message}).`);
    }
  }

  // A battle map's roofs and tree crowns as tiles over the map, new ones in before AtlasScribe's old ones come out; a
  // map given by its path alone has none, so the scene keeps those it had
  onProgress(0.95, "Placing the roofs and trees");
  const oldOver = sceneById(sceneId).tiles.filter((t) => isObj(t.flags?.[MOD]) && "overhead" in t.flags[MOD]).map((t) => t.id);
  let overheads = 0;
  if (Array.isArray(image.overheads)) {
    let placed = false;
    try {
      const { sceneX, sceneY } = sceneById(sceneId).dimensions;
      // (a roof or a tree's crown over the ground and every floor above, not the cellars below)
      const above = levelOf ? [...levelOf.keys()].filter((f) => f >= 0) : null;
      const tiles = image.overheads.map((o) => onFloor({ ...overheadTile(o, sceneX, sceneY, plan.id ?? null), ...(above ? { _floors: above } : {}) })).filter(Boolean);
      if (tiles.length) await sceneById(sceneId).createEmbeddedDocuments("Tile", tiles);
      overheads = tiles.length;
      placed = true;
      if (oldOver.length) await sceneById(sceneId).deleteEmbeddedDocuments("Tile", oldOver);
    } catch (e) {
      warnings.push(placed ? `The roofs and trees from the last map couldn't be taken out (${e.message}); delete the old ones from the Tiles controls.` : `The roofs and trees couldn't be placed over the map (${e.message}).`);
    }
  } else if (oldOver.length) warnings.push("The roofs and trees over the map were left as they were: they come only with a map rendered for the scene.");
  else if (layout?.kind === "battle") warnings.push("This battle map's roofs and trees weren't placed: they come only with a map rendered for the scene.");

  // A battle map's mist, fog overlays over its low places (lying on the map, under the tokens): new ones in, the old out
  const oldMist = sceneById(sceneId).tiles.filter((t) => isObj(t.flags?.[MOD]) && "atmosphere" in t.flags[MOD]).map((t) => t.id);
  let mist = 0;
  if (Array.isArray(image.mist)) {
    let placed = false;
    try {
      const { sceneX, sceneY } = sceneById(sceneId).dimensions;
      const tiles = image.mist.map((m) => onFloor(mistTile(m, sceneX, sceneY, plan.id ?? null))).filter(Boolean);
      await createAll(sceneId, "Tile", tiles);
      mist = tiles.length;
      placed = true;
      for (let k = 0; k < oldMist.length; k += BATCH) await sceneById(sceneId).deleteEmbeddedDocuments("Tile", oldMist.slice(k, k + BATCH));
    } catch (e) {
      warnings.push(placed ? `The last map's mist couldn't all be taken out (${e.message}); delete AtlasScribe's old mist from the Tiles controls.` : `The mist couldn't all be placed (${e.message}).`);
    }
  } else if (oldMist.length) warnings.push("The mist was left as it was: it comes only with a map rendered for the scene.");

  // A battle map's furniture, a tile a piece for the GM to move: new in, then the old out; a map given by its path,
  // or whose furniture art wasn't found at all, keeps those it had
  let furniture = 0;
  const oldFurn = sceneById(sceneId).tiles.filter((t) => isObj(t.flags?.[MOD]) && "furniture" in t.flags[MOD]).map((t) => t.id);
  const pieces = (layout?.items ?? []).filter((i) => i.kind === "interior").flatMap((i) => i.furniture ?? []).filter((f) => FURNITURE[f.f] && !FURNITURE[f.f].drawn).length
    + (layout?.items ?? []).filter((i) => i.kind === "light" && i.prop && FURNITURE[i.prop.f]).length;
  if (Array.isArray(image.furniture) && pieces && !image.furniture.length) warnings.push(`None of the furniture's art was found, so no furniture was placed${oldFurn.length ? " and the last map's was kept" : ""}.`);
  else if (Array.isArray(image.furniture)) {
    if (image.furniture.length < pieces) warnings.push(`${pieces - image.furniture.length} of the ${pieces} pieces of furniture had no art and were left out.`);
    let placed = false;
    try {
      onProgress(0.96, "Placing the furniture");
      const { sceneX, sceneY } = sceneById(sceneId).dimensions;
      const tiles = image.furniture.map((f) => onFloor({ ...furnitureTile(f, sceneX, sceneY, plan.id ?? null), _floor: f.floor ?? 0 })).filter(Boolean);
      await createAll(sceneId, "Tile", tiles);
      furniture = tiles.length;
      placed = true;
      for (let k = 0; k < oldFurn.length; k += BATCH) await sceneById(sceneId).deleteEmbeddedDocuments("Tile", oldFurn.slice(k, k + BATCH));
    } catch (e) {
      warnings.push(placed ? `The last map's furniture couldn't all be taken out (${e.message}); delete AtlasScribe's old pieces from the Tiles controls.` : `The furniture couldn't all be placed (${e.message}).`);
    }
  } else if (oldFurn.length) warnings.push("The furniture was left as it was: it comes only with a map rendered for the scene.");

  // A battle map's walls, doors and windows, fences and low walls (movement only), a roof region over each building,
  // and its ground, banks, cliffs and water (height.mjs): new ones in, then the old out (a settlement map just takes
  // them out)
  let walls = 0, roofs = 0, heights = 0, lights = 0, stairs = 0, ruled = 0;
  if (layout) {
    const { sceneX, sceneY } = sceneById(sceneId).dimensions;
    const pps = plan.output.pxPerSquare;
    // (each set replaces only its own: the roofs their old roofs, the ground its old ground and water regions)
    const mine = (docs, kinds) => docs.filter((d) => isObj(d.flags?.[MOD]) && "built" in d.flags[MOD] && (!kinds || kinds(d.flags[MOD].kind))).map((d) => d.id);
    const isHeight = (k) => HEIGHT_KINDS.includes(k);
    for (const [type, make, what, kinds, count] of [
      ["Wall", () => battleWalls(layout, sceneX, sceneY, pps, plan.id ?? null).map((w) => (typeof R.wall === "function" ? R.wall(w) ?? w : w)), "walls and doors", null, (n) => (walls = n)],
      ["Region", () => battleRoofs(layout, sceneX, sceneY, pps, plan.id ?? null), "roofs' surfaces and indoors", (k) => !isHeight(k) && k !== "stairs" && k !== "rules", (n) => (roofs = n)],
      ["Region", () => battleHeights(layout, sceneX, sceneY, pps, plan.id ?? null, R), "ground and water regions", isHeight, (n) => (heights = n)],
      ["Region", () => rulesRegions(R, { plan, layout, levels: levelOf, sceneX, sceneY, pps }), `${R.label ?? R.id} regions`, (k) => k === "rules", (n) => (ruled = n)],
      ["Region", () => (levelOf ? battleStairs(layout, sceneX, sceneY, pps, plan.id ?? null).filter((r) => r._floors.filter((f) => levelOf.has(f)).length > 1) : []), "stairs between floors", (k) => k === "stairs", (n) => (stairs = n)],
      ["AmbientLight", () => battleLights(layout, sceneX, sceneY, pps, plan.id ?? null), "lights", null, (n) => (lights = n)],
    ]) {
      let placed = false;
      try {
        const data = battle ? make().map(onFloor).filter(Boolean) : [];
        const old = mine(type === "Wall" ? sceneById(sceneId).walls : type === "AmbientLight" ? sceneById(sceneId).lights : sceneById(sceneId).regions, kinds);
        await createAll(sceneId, type, data);
        count(data.length);
        placed = true;
        for (let k = 0; k < old.length; k += BATCH) await sceneById(sceneId).deleteEmbeddedDocuments(type, old.slice(k, k + BATCH));
      } catch (e) {
        const where = type === "Wall" ? "Walls" : type === "AmbientLight" ? "Lighting" : "Regions";
        warnings.push(placed ? `The last map's ${what} couldn't all be taken out (${e.message}); delete AtlasScribe's old ones from the ${where} controls.` : `The ${what} couldn't all be placed (${e.message}).`);
      }
    }
  } else if (plan.kind === "battle") warnings.push("This battle map's walls, doors, roofs, ground regions and lights were left as they were: the map couldn't be laid out again for them.");

  onProgress(1, "Published");
  return { sceneId, created, backup, thumb, labels: labels.length, title, overheads, furniture, mist, walls, roofs, heights, lights, stairs, levels: levelOf ? levelOf.size : 1, rules: R.id, ruled, warnings };
}

/**
 * Takes off a scene's environment types AtlasScribe set for a game system (PF2e's), when no adapter sets them now: the
 * types themselves only if they're still the ones it set. Null when there's nothing to take off.
 */
export function unsetScene(scene) {
  const ours = scene?.flags?.[MOD]?.environment;
  if (!Array.isArray(ours)) return null;
  const now = scene.flags?.pf2e?.environmentTypes;
  const same = Array.isArray(now) && now.length === ours.length && now.every((x) => ours.includes(x));
  // (Foundry 14's way to take a flag off; the older "-=" key where there's none, as under node)
  const FD = globalThis.foundry?.data?.operators?.ForcedDeletion;
  const off = FD ? { [`flags.${MOD}.environment`]: new FD() } : { [`flags.${MOD}.-=environment`]: null };
  return { ...off, ...(same ? { "flags.pf2e.environmentTypes": [] } : {}) };
}

/**
 * The game system's own regions for a battle map, from its adapter (rules.mjs): each marked as AtlasScribe's, of the
 * kind "rules", so a republish replaces them.
 */
export function rulesRegions(R, { plan, layout, levels, sceneX, sceneY, pps }) {
  if (typeof R?.regions !== "function") return [];
  return (R.regions({ plan, layout, levels, sceneX, sceneY, pps, floorFt: FLOOR_FT }) ?? []).map((r) => ({
    ...r,
    flags: { ...(r.flags ?? {}), [MOD]: { ...(r.flags?.[MOD] ?? {}), built: plan.id ?? null, kind: "rules", rules: R.id } },
  }));
}

/** How many documents go to Foundry in one request (a big battle map has thousands of walls). */
const BATCH = 1000;

/**
 * Creates documents in batches; should a batch fail, those already made are taken out again, so a scene never keeps
 * half a new set beside its old one.
 */
async function createAll(sceneId, type, data) {
  const made = [];
  try {
    for (let k = 0; k < data.length; k += BATCH) made.push(...(await sceneById(sceneId).createEmbeddedDocuments(type, data.slice(k, k + BATCH))).map((d) => d.id));
  } catch (e) {
    for (let k = 0; k < made.length; k += BATCH) await sceneById(sceneId).deleteEmbeddedDocuments(type, made.slice(k, k + BATCH)).catch(() => {});
    throw e;
  }
}

/** How see-through an overhead tile is while a token is under it: a roof nearly gone, a tree's crown thinned. */
const OVERHEAD_ALPHA = { roof: 0.12, canopy: 0.25 };

/**
 * An overhead piece (render's { path, kind, x, y, width, height, elevation }, px from the map's corner) as Tile data,
 * x and y its middle (Foundry 14 anchors tiles at their center). A roof fades when a token is under it and clears
 * where a token outside sees in; a crown opens around a token beneath it.
 */
function overheadTile(o, sceneX, sceneY, plan) {
  const M = CONST.TILE_OCCLUSION_MODES;
  return {
    texture: { src: o.path },
    x: Math.round(sceneX + o.x + o.width / 2), y: Math.round(sceneY + o.y + o.height / 2),
    width: o.width, height: o.height,
    elevation: o.elevation,
    // (a roof also clears where a token outside sees under it, through a door or window: Foundry's Vision mode)
    occlusion: { modes: o.kind === "roof" ? [M.FADE, M.VISION] : [M.RADIAL], alpha: OVERHEAD_ALPHA[o.kind] ?? 0.25 },
    // (a fire or candle under it doesn't light it from below; under a roof, no weather when it fades)
    restrictions: { light: true, weather: o.kind === "roof" },
    locked: true,
    flags: { [MOD]: { overhead: plan, kind: o.kind } },
  };
}

/**
 * A piece of furniture's tile: its art from the art folder (where FA Nexus saved it), on the ground under tokens and
 * roofs, a rug under the rest; left unlocked, for the GM to move.
 */
function furnitureTile(f, sceneX, sceneY, plan) {
  return {
    texture: { src: localPath(f.src) },
    x: Math.round(sceneX + f.x), y: Math.round(sceneY + f.y),
    width: Math.round(f.width), height: Math.round(f.height), rotation: Math.round((f.rotation ?? 0) * 100) / 100,
    // (on its floor: a floor's height up for each above the ground, one down in a cellar; stairs locked, their region
    // being where they are)
    elevation: (f.floor ?? 0) * FLOOR_FT, sort: FURNITURE[f.f]?.floor ? 0 : FURNITURE[f.f]?.on ? 2 : 1,
    ...(f.lock ? { locked: true } : {}),
    flags: { [MOD]: { furniture: plan, piece: f.f } },
  };
}
/**
 * A mist overlay's tile: faint, turned at random, lying on the map at the ground's height, under the tokens; it hides
 * nothing and doesn't fade.
 */
function mistTile(m, sceneX, sceneY, plan) {
  return {
    texture: { src: localPath(m.src) },
    x: Math.round(sceneX + m.x), y: Math.round(sceneY + m.y),
    width: Math.round(m.width), height: Math.round(m.height), rotation: Math.round((m.rotation ?? 0) * 100) / 100,
    elevation: 0, alpha: m.alpha ?? 0.2,
    occlusion: { modes: [], alpha: 1 },
    locked: true,
    flags: { [MOD]: { atmosphere: plan } },
  };
}

/**
 * The times of day a plan can give (output.scene.time): the scene's darkness, whether outdoor light is on and bright
 * or dim, and its tint. A lantern, torch or lamp post is lit from LIT_FROM darkness on.
 */
export const TIMES = {
  day: { darkness: 0, global: true, bright: true },
  dawn: { darkness: 0.45, global: true, bright: false, base: { hue: 0.07, intensity: 0.35, luminosity: 0, saturation: 0.15, shadows: 0 } },
  dusk: { darkness: 0.6, global: true, bright: false },
  night: { darkness: 0.9, global: false, bright: false },
};
const BASE_TINT = { hue: 0, intensity: 0, luminosity: 0, saturation: 0, shadows: 0 };

/**
 * A battle layout's lights as AmbientLight data (layout/lights.mjs): each at its place and the ground's elevation
 * there, stopped by walls, its numbers from LIGHTS (feet), a lantern's, torch's or lamp post's lit only from LIT_FROM.
 */
export function battleLights(layout, sceneX, sceneY, pps, plan) {
  return layout.items.filter((i) => i.kind === "light" && LIGHTS[i.class]).map((l) => {
    const L = LIGHTS[l.class];
    return {
      x: Math.round(sceneX + l.at[0] * pps), y: Math.round(sceneY + l.at[1] * pps),
      elevation: Math.max(l.elevation ?? 0, 0),
      walls: true, vision: false,
      config: { bright: L.bright, dim: L.dim, color: L.color, alpha: L.alpha, attenuation: 0.6, luminosity: 0.5, animation: { ...L.animation, reverse: false }, darkness: { min: L.dark ? LIT_FROM : 0, max: 1 } },
      locked: true,
      flags: { [MOD]: { built: plan, kind: "light", light: l.class } },
      ...(l.floor ? { _floor: l.floor } : {}),
    };
  });
}

/** An art file's address as Foundry's path to it (the worker was given full addresses). */
function localPath(src) {
  try {
    const url = new URL(src, window.location.href);
    // (AtlasScribe's own mark of the scale art is drawn at goes)
    url.searchParams.delete("as-px");
    if (url.origin !== window.location.origin) return url.href;
    const base = new URL(foundry.utils.getRoute("/"), window.location.href).pathname;
    // (decoded as Foundry keeps paths, but a %, # or ? in a file's name kept escaped, or it would end the path)
    return decodeURIComponent(url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname.replace(/^\//, "")).replace(/%/g, "%25").replace(/#/g, "%23").replace(/\?/g, "%3F");
  } catch {
    return String(src).replace(/[?&]as-px=[^&#]*/, "");
  }
}

/**
 * The doors Foundry ships (Forgotten Adventures' art, in every install): a house's by its variant (a temple's wide
 * door two leaves), a yard's gate. Foundry fits a door's art to the door, so each is a one-square door.
 */
const CORE_DOORS = ["canvas/doors/small/Door_Wood_Walnut_F_1x1.webp", "canvas/doors/small/Door_Wood_Dark_H_1x1.webp", "canvas/doors/small/Door_Wood_Ashen_A_1x1.webp", "canvas/doors/small/Door_Wood_Light_B_1x1.webp"];
const CORE_GATE = "canvas/doors/small/Door_Wood_Light_G_1x1.webp";
/**
 * How thick a door's art is drawn: Foundry scales it by the scene's grid over flags.core.textureGridSize. The door is
 * a 26 px band across the middle of its 200 px art, so a smaller grid size thickens it to its wall (or a gate to its
 * fence's band, about 0.185 of a square).
 */
const DOOR_BAND = 26, FENCE_THICK = 0.185;
const doorGrid = (thick) => Math.round(DOOR_BAND / thick);

/** A battle layout's walls as Wall data: buildings' walls, doors and windows; fences and low walls; yard gates. */
export function battleWalls(layout, sceneX, sceneY, pps, plan) {
  // (Foundry 14 names the sense types EDGE_SENSE_TYPES; WALL_SENSE_TYPES is the old, deprecated name)
  const S = CONST.EDGE_SENSE_TYPES ?? CONST.WALL_SENSE_TYPES, M = CONST.WALL_MOVEMENT_TYPES, D = CONST.WALL_DOOR_TYPES;
  const c = (a, b) => [a, b].flatMap(([x, y]) => [Math.round(sceneX + x * pps), Math.round(sceneY + y * pps)]);
  // (a wall a creature can take cover behind carries the cover mark, core/rules.mjs, for an adapter to read)
  const flags = (kind, grid = null) => ({ [MOD]: { built: plan, kind, ...(COVER[kind] ? { cover: COVER[kind] } : {}) }, ...(grid ? { core: { textureGridSize: grid } } : {}) });
  const dist = layout.size?.ftPerSquare ?? 5;
  const swing = (texture, double = false) => ({ type: "swing", texture, double, duration: 500, direction: 1, flip: false, strength: 1 });
  const out = [];
  for (const sh of layout.items.filter((i) => i.kind === "shell")) {
    for (const w of sh.walls) {
      const base = { c: c(w.a, w.b), move: M.NORMAL, sight: S.NORMAL, light: S.NORMAL, sound: S.NORMAL };
      if (w.type === "wall") out.push({ ...base, flags: flags("wall") });
      // (a window: seen through from close by, two squares or less, as Foundry's window walls are)
      else if (w.type === "window") out.push({ ...base, sight: S.PROXIMITY, light: S.PROXIMITY, threshold: { sight: 2 * dist, light: 2 * dist, attenuation: true }, flags: flags("window") });
      else if (w.type === "door") {
        const wide = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) > 1.5;
        out.push({ ...base, door: D.DOOR, doorSound: sh.material === "stone" || sh.material === "masonry" ? "woodHeavy" : "woodBasic",
          animation: swing(CORE_DOORS[(sh.variant ?? 0) % CORE_DOORS.length], wide),
          flags: flags("door", doorGrid(sh.thickness ?? 0.3)) });
      }
    }
  }
  // Walls between rooms and the doors in them (an open doorway is left open), on each floor; a floor above or below
  // has its own outer walls (windows above, none in a cellar)
  for (const it of layout.items.filter((i) => i.kind === "interior")) {
    const _floor = it.floor ?? 0;
    for (const w of it.walls) {
      const base = { c: c(w.a, w.b), move: M.NORMAL, sight: S.NORMAL, light: S.NORMAL, sound: S.NORMAL, ...(_floor ? { _floor } : {}) };
      if (w.type === "wall") out.push({ ...base, flags: flags("inner-wall") });
      else if (w.type === "door") out.push({ ...base, door: D.DOOR, doorSound: "woodBasic", animation: swing(CORE_DOORS[0]), flags: flags("inner-door", doorGrid(it.thickness ?? 0.2)) });
      // (a gatehouse's portcullis: a door that stops movement when it's down but not sight, light or sound)
      else if (w.type === "portcullis") out.push({ ...base, sight: S.NONE, light: S.NONE, sound: S.NONE, door: D.DOOR, doorSound: "jailHeavy", flags: flags("portcullis") });
    }
    if (_floor && Array.isArray(it.outer)) for (const w of it.outer) {
      const base = { c: c(w.a, w.b), move: M.NORMAL, sight: S.NORMAL, light: S.NORMAL, sound: S.NORMAL, _floor };
      if (w.type === "window") out.push({ ...base, sight: S.PROXIMITY, light: S.PROXIMITY, threshold: { sight: 2 * dist, light: 2 * dist, attenuation: true }, flags: flags("window") });
      // (a castle tower's door onto the wall walk)
      else if (w.type === "door") out.push({ ...base, door: D.DOOR, doorSound: "woodHeavy", animation: swing(CORE_DOORS[0]), flags: flags("door", doorGrid(0.3)) });
      else out.push({ ...base, flags: flags("wall") });
    }
  }
  // (fences and low walls stop movement only; a yard's gate between its back fences is a door that does the same)
  const fenceOnly = { move: M.NORMAL, sight: S.NONE, light: S.NONE, sound: S.NONE };
  // A castle's curtain: solid on the ground and the floor above, its faces cut where towers and gatehouses stand; at
  // the walk its parapet and inner edge stop movement only
  const W2 = CASTLE.walk;
  for (const w of layout.items.filter((i) => i.kind === "wall" && i.curtain)) {
    for (const [a, b] of [...w.curtain.face, ...w.curtain.back, ...w.curtain.ends]) out.push({ c: c(a, b), move: M.NORMAL, sight: S.NORMAL, light: S.NORMAL, sound: S.NORMAL, _floors: [0, 1], flags: flags("curtain") });
    for (const [a, b] of [...w.curtain.parapet, ...w.curtain.ends]) out.push({ ...fenceOnly, c: c(a, b), _floor: W2, flags: flags("parapet") });
    for (const [a, b] of w.curtain.edge) out.push({ ...fenceOnly, c: c(a, b), _floor: W2, flags: flags("walk-edge") });
  }
  for (const f of layout.items.filter((i) => i.kind === "boundary" && i.class === "fence" && Array.isArray(i.path)))
    for (let k = 1; k < f.path.length; k++) out.push({ ...fenceOnly, c: c(f.path[k - 1], f.path[k]), flags: flags("fence") });
  for (const w of layout.items.filter((i) => i.kind === "wall" && i.class === "stone" && Array.isArray(i.path) && !(i.thickness > 0.6)))
    for (let k = 1; k < w.path.length; k++) out.push({ ...fenceOnly, c: c(w.path[k - 1], w.path[k]), flags: flags("low-wall") });
  for (const y of layout.items.filter((i) => i.kind === "surface" && i.class === "backyard")) {
    const f3 = layout.items.find((i) => i.id === y.id + "-f3"), f4 = layout.items.find((i) => i.id === y.id + "-f4");
    if (f3 && f4) out.push({ ...fenceOnly, c: c(f3.path.at(-1), f4.path[0]), door: D.DOOR, doorSound: "woodBasic",
      animation: swing(CORE_GATE), flags: flags("gate", doorGrid(FENCE_THICK)) });
  }
  // (none wholly off the map, where a building at its edge runs past it, and none whose ends round to one pixel)
  const [MW, MH] = layout.size?.squares ?? [Infinity, Infinity];
  const x1 = sceneX + MW * pps, y1 = sceneY + MH * pps;
  return out.filter(({ c: [ax, ay, bx, by] }) => (ax !== bx || ay !== by) && Math.max(ax, bx) >= sceneX && Math.min(ax, bx) <= x1 && Math.max(ay, by) >= sceneY && Math.min(ay, by) <= y1);
}

/**
 * A battle layout's roofs as Region data: over each building a surface at its roof's height that Foundry reveals to a
 * token outside and that fades the roof tile for a token beneath (Define Surface, Reveal Elevated Surface), and under
 * it the indoors, a little darker. A courtyard is a hole in both.
 */
export function battleRoofs(layout, sceneX, sceneY, pps, plan) {
  const groups = new Map();
  for (const b of layout.items.filter((i) => i.kind === "building")) {
    const k = b.group ?? b.id;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  }
  const pts = (ring) => ring.flatMap(([x, y]) => [Math.round(sceneX + x * pps), Math.round(sceneY + y * pps)]);
  const out = [];
  for (const parts of groups.values()) {
    const pieces = shapes(union(parts.map(footprint))).filter((p) => p.outer.length >= 3);
    if (!pieces.length) continue;
    // (its roof at its height above the ground it stands on: a house on a rise has its roof up with it)
    const e = roofHeight(parts) + groundOf(layout, parts);
    out.push({
      name: "Roof",
      color: "#9c6b3c",
      shapes: pieces.flatMap((p) => [{ type: "polygon", points: pts(p.outer), hole: false }, ...p.holes.map((h) => ({ type: "polygon", points: pts(h), hole: true }))]),
      elevation: { bottom: e, top: e },
      visibility: CONST.REGION_VISIBILITY.LAYER,
      // (a roof stops light, sight, sound and movement through it, from above as from below)
      behaviors: [{ type: "defineSurface", name: "Roof", system: { placement: "bottom", exposure: true, occlusion: true, light: true, move: true, sight: true, sound: true, culling: false } }],
      locked: true,
      flags: { [MOD]: { built: plan, kind: "roof" } },
      _all: true,
    });
    // (and under it, indoors: a little darker than outside; the roof tile keeps the weather out once it fades, where a
    // region suppressing the weather would stop it falling on the roof too)
    out.push({
      name: "Indoors",
      color: "#6b5a3c",
      shapes: pieces.flatMap((p) => [{ type: "polygon", points: pts(p.outer), hole: false }, ...p.holes.map((h) => ({ type: "polygon", points: pts(h), hole: true }))]),
      elevation: { bottom: null, top: e },
      visibility: CONST.REGION_VISIBILITY.LAYER,
      behaviors: [
        { type: "adjustDarknessLevel", name: "Indoors", system: { mode: globalThis.CONFIG?.RegionBehavior?.dataModels?.adjustDarknessLevel?.MODES?.DARKEN ?? 2, modifier: INDOOR_DARK } },
      ],
      locked: true,
      flags: { [MOD]: { built: plan, kind: "indoor" } },
      _all: true,
    });
    // (a cellar under it: dark, on its own level, but for the lamps and lanterns brought down)
    if (parts.some((b) => b.cellar)) out.push({
      name: "Cellar",
      color: "#3a2e22",
      shapes: pieces.flatMap((p) => [{ type: "polygon", points: pts(p.outer), hole: false }, ...p.holes.map((h) => ({ type: "polygon", points: pts(h), hole: true }))]),
      visibility: CONST.REGION_VISIBILITY.LAYER,
      behaviors: [{ type: "adjustDarknessLevel", name: "Cellar", system: { mode: globalThis.CONFIG?.RegionBehavior?.dataModels?.adjustDarknessLevel?.MODES?.DARKEN ?? 2, modifier: CELLAR_DARK } }],
      locked: true,
      flags: { [MOD]: { built: plan, kind: "cellar" } },
      _floors: [-1],
    });
  }
  return out;
}

/** How much darker a cellar is (an Adjust Darkness Level region's darken, on top of indoors). */
const CELLAR_DARK = 0.55;
/** A floor's height in feet: a floor's level, its furniture's and its lights' elevation. */
const FLOOR_FT = FLOORS.height;
/** A floor's level's name. */
// (counted as American floors are: the ground floor is the first)
const FLOOR_NAMES = { "-1": "Cellar", 1: "Second floor", 2: "Third floor", 3: "Fourth floor" };

/**
 * A battle layout's stairs as Region data: over each flight, Foundry's own Change Level, on every floor it joins
 * (_floors, for publish to turn into levels), so a token that walks onto it is asked which floor to go to.
 */
export function battleStairs(layout, sceneX, sceneY, pps, plan) {
  const pts = (ring) => ring.flatMap(([x, y]) => [Math.round(sceneX + x * pps), Math.round(sceneY + y * pps)]);
  return layout.items.filter((i) => i.kind === "stairs" && Array.isArray(i.box)).map((st) => {
    // (a wall's flight joins the ground and the walk only; a building's every floor from its lowest to its highest)
    const floors = [];
    if (Array.isArray(st.levels)) floors.push(...st.levels);
    else for (let f = st.floors[0]; f <= st.floors[1]; f++) floors.push(f);
    return {
      name: "Stairs",
      color: "#c8a060",
      shapes: [{ type: "polygon", points: pts(st.box), hole: false }],
      visibility: CONST.REGION_VISIBILITY.LAYER,
      behaviors: [{ type: "changeLevel", name: "Stairs", system: {} }],
      locked: true,
      flags: { [MOD]: { built: plan, kind: "stairs" } },
      _floors: floors,
    };
  });
}

/**
 * Makes a scene's levels match a battle map's floors: AtlasScribe's levels (flags floor) updated, made or taken out,
 * the ground's level (showing groundPath) left as it is. wanted: render's levels ([{ floor, path }]), or null for a
 * map given by its path (the scene's floors are kept). A floor above sees down to the floors below; a cellar sees
 * nothing else. Returns a Map of floor to level id (0 the ground), or null when there are no floors but the ground.
 */
async function syncLevels(sceneId, wanted, groundPath, names = {}) {
  let scene = sceneById(sceneId);
  const ground = scene.levels.find((l) => l.background?.src === groundPath) ?? scene.initialLevel ?? scene.levels.contents[0];
  if (!ground) return null;
  const ours = scene.levels.filter((l) => l.id !== ground.id && Number.isInteger(l.flags?.[MOD]?.floor) && l.flags[MOD].floor !== 0);
  const map = new Map([[0, ground.id]]);
  if (!Array.isArray(wanted)) {
    for (const l of ours) map.set(l.flags[MOD].floor, l.id);
    return map.size > 1 ? map : null;
  }
  const floors = [...wanted].filter((w) => Number.isInteger(w.floor) && w.floor !== 0 && w.path).sort((a, b) => a.floor - b.floor);
  const byFloor = new Map(ours.map((l) => [l.flags[MOD].floor, l]));
  const make = [], change = [];
  for (const w of floors) {
    const data = {
      name: names[w.floor] ?? FLOOR_NAMES[w.floor] ?? `Floor ${w.floor}`,
      elevation: { bottom: w.floor * FLOOR_FT, top: (w.floor + 1) * FLOOR_FT },
      background: { src: w.path },
      sort: w.floor,
      flags: { [MOD]: { floor: w.floor } },
    };
    const old = byFloor.get(w.floor);
    if (old) change.push({ _id: old.id, ...data });
    else make.push(data);
  }
  if (change.length) await scene.updateEmbeddedDocuments("Level", change);
  if (make.length) await scene.createEmbeddedDocuments("Level", make);
  scene = sceneById(sceneId);
  for (const l of scene.levels) {
    const f = l.flags?.[MOD]?.floor;
    if (l.id !== ground.id && floors.some((w) => w.floor === f)) map.set(f, l.id);
  }
  const vis = [...map.entries()].filter(([f]) => f !== 0).map(([f, id]) => ({ _id: id, visibility: { levels: f > 0 ? [...map.entries()].filter(([g]) => g >= 0 && g < f).map(([, i]) => i) : [] } }));
  if (vis.length) await scene.updateEmbeddedDocuments("Level", vis);
  const gone = ours.filter((l) => !floors.some((w) => w.floor === l.flags[MOD].floor)).map((l) => l.id);
  if (gone.length) await scene.deleteEmbeddedDocuments("Level", gone);
  return map.size > 1 ? map : null;
}

/** How much darker it is indoors than out (an Adjust Darkness Level region's darken). */
const INDOOR_DARK = 0.25;

/** The kinds of AtlasScribe's ground and water regions (a roof's is "roof", the indoors' under it "indoor"). */
const HEIGHT_KINDS = ["ground", "face", "shallow", "deep", "ice"];

/** Each kind of height region's color in the Regions controls. */
const HEIGHT_COLOR = { ground: "#8a7a4a", face: "#6b5a48", shallow: "#4a90b0", deep: "#1f4f7a", ice: "#b8d8e8" };

/**
 * A battle layout's height as Region data (height.mjs): each level's ground at its elevation (no behavior: the height
 * hook reads it), and a walkers' cost over each bank, slope, cliff face and water (Modify Movement Cost; flying and
 * swimming left alone), with what the hook needs in its flags. rules: the game system's adapter (rules.mjs), which
 * may give a region its system's own behaviors.
 */
export function battleHeights(layout, sceneX, sceneY, pps, plan, rules = CORE) {
  const pts = (ring) => ring.flatMap(([x, y]) => [Math.round(sceneX + x * pps), Math.round(sceneY + y * pps)]);
  // (the actions the scene's movement cost knows, so a system that leaves some out isn't given them)
  const keys = Object.keys(CONFIG.RegionBehavior?.dataModels?.modifyMovementCost?.schema?.fields?.difficulties?.fields ?? {});
  const slows = (cost) => [{ type: "modifyMovementCost", name: "Walking cost", system: { difficulties: Object.fromEntries(keys.map((k) => [k, WALKING.includes(k) ? cost : 1])) } }];
  const core = (r) => (r.kind === "ground" || !keys.length || !r.cost ? [] : slows(r.cost));
  return heightRegions(layout).map((r) => ({
    name: r.name,
    color: HEIGHT_COLOR[r.kind] ?? "#888888",
    shapes: r.polys.map((p) => ({ type: "polygon", points: pts(p.points), hole: p.hole })),
    // (a top elevation counts as inside, so a token standing at a bank's top or wading in from the bank is in it)
    elevation: r.kind === "ground" ? { bottom: r.elevation, top: r.elevation, topInclusive: true } : { bottom: r.kind === "face" ? r.bottom : null, top: r.top, topInclusive: true },
    visibility: CONST.REGION_VISIBILITY.LAYER,
    behaviors: (typeof rules?.heightBehaviors === "function" ? rules.heightBehaviors(r, { core: () => core(r) }) : undefined) ?? core(r),
    locked: true,
    flags: { [MOD]: { built: plan, kind: r.kind, elevation: r.elevation ?? null, order: r.order ?? null, over: !!r.over, style: r.style ?? null, lines: (r.lines ?? []).map((l) => pts(l)), alone: !!r.alone, climb: r.climb ?? null } },
    _floor: 0,
  }));
}

/** The scene with this id, or an error: every write checks the scene is still there. */
function sceneById(id) {
  const scene = game.scenes.get(id);
  if (!scene) throw new Error(`AtlasScribe: there's no scene with the id ${id}`);
  return scene;
}

/** A name no other scene has: name, else name (2), name (3) and so on. */
function freeSceneName(name) {
  const taken = new Set(game.scenes.map((s) => s.name));
  let out = name;
  for (let n = 2; taken.has(out); n++) out = `${name} (${n})`;
  return out;
}

/**
 * A small preview for the scene list (<output>/thumbs/<scene id>.webp, replaced on a republish), as a Blob: the
 * worker's thumbnail, else one Foundry makes.
 */
async function thumbOf(image) {
  if (image.thumb) return image.thumb;
  const IH = foundry.helpers.media.ImageHelper;
  const t = await IH.createThumbnail(image.path, { width: THUMB, height: THUMB, format: "image/webp", quality: 0.8 });
  return (await fetch(t.thumb)).blob();
}

/**
 * The plan's labels as text drawings, centered on their point and turned by their angle (labels.mjs works out where
 * each sits, including a name label following its district or area, and its color, font and opacity). Hidden from
 * players unless show is "all".
 */
async function labelDrawings(plan, scene, warnings, layout) {
  const pps = plan.output.pxPerSquare;
  const { sceneX, sceneY } = scene.dimensions;
  const ctx = new OffscreenCanvas(8, 8).getContext("2d");
  const out = [], fonts = new Set();
  for (const l of [...labelsOf(plan), ...useLabelsOf(plan, layout)]) {
    const size = Math.min(FONT.max, Math.max(FONT.min, Math.round(pps * (LABEL_SIZES[l.size] ?? LABEL_SIZES.normal))));
    try {
      await document.fonts.load(`${size}px "${l.font}"`);
    } catch {
      /* the browser falls back to another font */
    }
    fonts.add(l.font);
    ctx.font = `${size}px "${l.font}"`;
    const w = Math.ceil(ctx.measureText(l.text).width * 1.15 + size * 0.6);
    const h = Math.ceil(size * 1.6);
    out.push({
      x: Math.round(sceneX + l.at[0] * pps - w / 2),
      y: Math.round(sceneY + l.at[1] * pps - h / 2),
      shape: { type: "r", width: w, height: h },
      rotation: l.angle,
      text: l.text, fontSize: size, fontFamily: l.font, textColor: l.color, textAlpha: l.alpha,
      fillType: CONST.DRAWING_FILL_TYPES.NONE, strokeWidth: 0, strokeAlpha: 0,
      hidden: l.show !== "all",
      locked: true,
      flags: { [MOD]: { batch: plan.id ?? null, feature: l.id } },
    });
  }
  for (const font of fonts) {
    const known = font in (CONFIG.fontDefinitions ?? {}) || [...document.fonts].some((f) => f.family.replace(/["']/g, "") === font);
    if (!known) warnings.push(`The font "${font}" isn't one Foundry knows, so labels in it may show in another.`);
  }
  return out;
}

/**
 * A dressed map's cartouche as Tile data, hidden, over the corner kept for it (saved in <output>/titles as <scene id>.webp), or null
 * when the map isn't dressed or has no name.
 */
async function titleTile(plan, layout, scene, sceneId, folder) {
  const pps = plan.output.pxPerSquare;
  const m = new OffscreenCanvas(8, 8).getContext("2d");
  const measure = (text, f) => { m.font = `italic ${Math.max(4, Math.round(f * pps))}px serif`; return m.measureText(text).width / pps; };
  const box = titleBox(layout, measure);
  if (!box) return null;
  const c = new OffscreenCanvas(Math.max(1, Math.ceil(box.w * pps)), Math.max(1, Math.ceil(box.h * pps)));
  paintTitle(c.getContext("2d"), layout, box, pps);
  const blob = await c.convertToBlob({ type: "image/webp", quality: 0.92 });
  // (named after the scene, as its thumbnail is, so an update replaces it rather than adding another)
  const path = await upload(`${folder}/titles`, `${sceneId}.webp`, blob);
  const { sceneX, sceneY } = scene.dimensions;
  return {
    texture: { src: path },
    // (a tile's x and y are its middle: Foundry 14 anchors tiles at their center)
    x: Math.round(sceneX + box.x * pps + c.width / 2), y: Math.round(sceneY + box.y * pps + c.height / 2),
    width: c.width, height: c.height,
    hidden: true,
    flags: { [MOD]: { title: plan.id ?? null } },
  };
}

function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
