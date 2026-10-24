/**
 * Publishing: a rendered map becomes a Foundry scene. A new scene is created unless the GM names one to update.
 * Before an existing scene is changed, all of it is saved as JSON to <output>/backups; updating keeps the scene's
 * name (the GM may have renamed it). A new scene gets a name no other scene has. Everything AtlasScribe adds carries
 * flags under "atlas-scribe" (the scene: plan, image, version, built; each label: batch, feature), so a
 * second publish replaces only its own labels and leaves the GM's own drawings alone.
 */
import { upload, freeName } from "./files.mjs";
import { LABEL_SIZES } from "../core/plan.mjs";

const MOD = "atlas-scribe";
const THUMB = 300;

/**
 * plan: a normalized plan. image: the rendered map's path, width and height in pixels. folder: the output folder.
 * sceneId: a scene to update instead of creating one. Returns { sceneId, created, backup, thumb, labels, warnings }.
 */
export async function publish({ plan, image, width, height, folder, sceneId = null, onProgress = () => {} }) {
  const warnings = [];
  const opts = plan.output.scene;
  let backup = null;

  // The scene to update, if one was named, and a backup of it first
  if (sceneId) {
    const scene = sceneById(sceneId);
    onProgress(0.1, "Backing up the scene");
    const json = JSON.stringify(scene.toObject(), null, 1);
    const dir = `${folder}/backups`;
    backup = await upload(dir, await freeName(dir, `${scene.name}-${stamp()}`, "json"), new Blob([json], { type: "application/json" }));
  }

  // The thumbnail is named after the scene, so a republish replaces it rather than adding another
  onProgress(0.3, "Making the thumbnail");
  const id = sceneId ?? foundry.utils.randomID();
  const thumb = await makeThumb(image, `${folder}/thumbs`, id);

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
    await scene.update(data);
    scene = sceneById(sceneId);
    const level = scene.initialLevel ?? scene.levels.contents[0];
    if (level) await scene.updateEmbeddedDocuments("Level", [{ _id: level.id, background: { src: image.path } }]);
    else await scene.createEmbeddedDocuments("Level", [{ name: "Ground", background: { src: image.path } }]);
  } else {
    scene = await Scene.create({ ...data, _id: id, name: freeSceneName(opts.name), levels: [{ name: "Ground", background: { src: image.path } }] }, { keepId: true });
    if (!scene) throw new Error("AtlasScribe: Foundry didn't create the scene");
    sceneId = scene.id;
    created = true;
  }

  // Labels: this plan's earlier labels out, the plan's labels in
  onProgress(0.75, "Placing the labels");
  scene = sceneById(sceneId);
  const old = scene.drawings.filter((d) => d.getFlag(MOD, "batch") === (plan.id ?? null)).map((d) => d.id);
  if (old.length) await sceneById(sceneId).deleteEmbeddedDocuments("Drawing", old);
  const labels = await labelDrawings(plan, sceneById(sceneId), warnings);
  if (labels.length) await sceneById(sceneId).createEmbeddedDocuments("Drawing", labels);

  onProgress(1, "Published");
  return { sceneId, created, backup, thumb, labels: labels.length, warnings };
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

/** A small preview for the scene list, saved in <output>/thumbs as <scene id>.webp. */
async function makeThumb(image, dir, id) {
  const IH = foundry.helpers.media.ImageHelper;
  const t = await IH.createThumbnail(image.path, { width: THUMB, height: THUMB, format: "image/webp", quality: 0.8 });
  const blob = await (await fetch(t.thumb)).blob();
  return upload(dir, `${id}.webp`, blob);
}

/** The plan's labels as text drawings, centred on their point. Hidden from players unless show is "all". */
async function labelDrawings(plan, scene, warnings) {
  const opts = plan.output.scene;
  const pps = plan.output.pxPerSquare;
  const font = typeof opts.labelFont === "string" && opts.labelFont.trim() ? opts.labelFont.trim() : "Signika";
  const color = /^#[0-9a-f]{6}$/i.test(opts.labelColor ?? "") ? opts.labelColor : "#13202e";
  const { sceneX, sceneY } = scene.dimensions;
  const ctx = new OffscreenCanvas(8, 8).getContext("2d");
  const out = [];
  for (const f of plan.features) {
    if (f.type !== "label" || !Array.isArray(f.at)) continue;
    const text = String(f.text ?? "").trim();
    if (!text) continue;
    const size = Math.round(pps * (LABEL_SIZES[f.size] ?? LABEL_SIZES.normal));
    try {
      await document.fonts.load(`${size}px "${font}"`);
    } catch {
      /* the browser falls back to another font */
    }
    ctx.font = `${size}px "${font}"`;
    const w = Math.ceil(ctx.measureText(text).width * 1.15 + size * 0.6);
    const h = Math.ceil(size * 1.6);
    out.push({
      x: Math.round(sceneX + f.at[0] * pps - w / 2),
      y: Math.round(sceneY + f.at[1] * pps - h / 2),
      shape: { type: "r", width: w, height: h },
      text, fontSize: size, fontFamily: font, textColor: color, textAlpha: 1,
      fillType: CONST.DRAWING_FILL_TYPES.NONE, strokeWidth: 0, strokeAlpha: 0,
      hidden: f.show !== "all",
      locked: true,
      flags: { [MOD]: { batch: plan.id ?? null, feature: f.id } },
    });
  }
  if (!document.fonts.check(`20px "${font}"`)) warnings.push(`The font "${font}" isn't loaded in this browser, so the labels use another.`);
  return out;
}

function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
