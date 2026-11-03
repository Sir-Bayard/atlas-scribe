/**
 * Publishing: a rendered map becomes a Foundry scene. A new scene is created unless the GM names one to update.
 * Before an existing scene is changed, all of it is saved as JSON to <output>/backups; updating keeps the scene's
 * name (the GM may have renamed it). A new scene gets a name no other scene has. Everything AtlasScribe adds carries
 * flags under "atlas-scribe" (the scene: plan, image, version, built; each label: batch, feature; the title tile:
 * title), so a second publish replaces only its own labels and title and leaves the GM's own drawings and tiles alone.
 */
import { upload, freeName } from "./files.mjs";
import { LABEL_SIZES, isObj } from "../core/plan.mjs";
import { labelsOf, useLabelsOf } from "../core/labels.mjs";
import { titleBox, paintTitle } from "../render/styles/illustrated.mjs";

const MOD = "atlas-scribe";
const THUMB = 300;
/** Foundry's limits on a drawing's font size. */
const FONT = { min: 8, max: 256 };

/**
 * plan: a normalized plan. image: the rendered map's path, width and height in pixels, and thumb (a Blob) when
 * the worker made one. folder: the output folder. layout: the map's layout, for its notable buildings' hidden labels
 * (none without it; api.publish lays the plan out again when it isn't given one). sceneId: a scene to update instead of creating one; one
 * AtlasScribe didn't make is refused unless force is true. check(): throws if the job was canceled; it's called
 * before anything is written. Returns { sceneId, created, backup, thumb, labels, title, warnings } (title: whether a dressed map's name went in as a hidden tile).
 */
export async function publish({ plan, image, width, height, folder, layout = null, sceneId = null, force = false, check = () => {}, onProgress = () => {} }) {
  const warnings = [];
  const opts = plan.output.scene;
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

  // The thumbnail is named after the scene, so a republish replaces it rather than adding another. It's made first and
  // saved only after the last chance to stop, so a cancel never leaves a new thumbnail over the old
  check();
  onProgress(0.3, "Making the thumbnail");
  const id = sceneId ?? foundry.utils.randomID();
  const thumbBlob = await thumbOf(image);
  check(); // the last chance to stop: from here the scene is written
  const thumb = await upload(`${folder}/thumbs`, `${id}.webp`, thumbBlob);

  let weather = opts.weather ?? "";
  if (weather && !(weather in (CONFIG.weatherEffects ?? {}))) {
    warnings.push(`The weather "${weather}" isn't one this world offers, so the scene has none.`);
    weather = "";
  }
  const data = {
    width, height,
    padding: opts.padding,
    thumb,
    grid: { type: CONST.GRID_TYPES.SQUARE, size: plan.output.pxPerSquare, distance: plan.size.ftPerSquare, units: "ft", alpha: opts.gridAlpha },
    tokenVision: opts.tokenVision,
    fog: { mode: opts.fog ? CONST.FOG_EXPLORATION_MODES.INDIVIDUAL : CONST.FOG_EXPLORATION_MODES.DISABLED },
    environment: { darknessLevel: opts.darkness, globalLight: { enabled: opts.globalLight } },
    weather,
    navigation: opts.navigation,
    flags: { [MOD]: { plan: plan.id ?? null, image: image.path, version: game.modules.get(MOD)?.version ?? null, built: Date.now() } },
  };

  onProgress(0.5, sceneId ? "Updating the scene" : "Creating the scene");
  let scene, created = false;
  if (sceneId) {
    scene = sceneById(sceneId);
    const before = scene.getFlag(MOD, "image");
    await scene.update(data);
    scene = sceneById(sceneId);
    // The level that shows AtlasScribe's last map, else the one the scene opens on
    const level = scene.levels.find((l) => before && l.background?.src === before) ?? scene.initialLevel ?? scene.levels.contents[0];
    if (level) await scene.updateEmbeddedDocuments("Level", [{ _id: level.id, background: { src: image.path } }]);
    else await scene.createEmbeddedDocuments("Level", [{ name: "Ground", background: { src: image.path } }]);
  } else {
    scene = await Scene.create({ ...data, _id: id, name: freeSceneName(opts.name), levels: [{ name: "Ground", background: { src: image.path } }] }, { keepId: true });
    if (!scene) throw new Error("AtlasScribe: Foundry didn't create the scene");
    sceneId = scene.id;
    created = true;
  }

  // Labels: every label AtlasScribe put in this scene out (an earlier map's, whatever plan it came from), the plan's in
  onProgress(0.75, "Placing the labels");
  // The new labels go in before the old ones come out, so a failure never leaves the scene with none
  scene = sceneById(sceneId);
  const old = scene.drawings.filter((d) => isObj(d.flags?.[MOD]) && "batch" in d.flags[MOD]).map((d) => d.id);
  const labels = await labelDrawings(plan, sceneById(sceneId), warnings, layout);
  if (labels.length) await sceneById(sceneId).createEmbeddedDocuments("Drawing", labels);
  if (old.length) await sceneById(sceneId).deleteEmbeddedDocuments("Drawing", old);

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

  onProgress(1, "Published");
  return { sceneId, created, backup, thumb, labels: labels.length, title, warnings };
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
 * A small preview for the scene list (saved in <output>/thumbs as <scene id>.webp, replaced on a republish; the
 * scene list may show the old one until the page reloads), as a Blob: the worker's thumbnail when there is one;
 * else Foundry makes one from the image.
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
    x: Math.round(sceneX + box.x * pps), y: Math.round(sceneY + box.y * pps),
    width: c.width, height: c.height,
    hidden: true,
    flags: { [MOD]: { title: plan.id ?? null } },
  };
}

function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
