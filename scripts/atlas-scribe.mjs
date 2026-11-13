/**
 * AtlasScribe: a map plan in, a map out. The entry point: settings and the API at
 * game.modules.get("atlas-scribe").api. Everything that changes the world is GM only. One job runs at a time;
 * cancel() stops it between any two steps.
 */
import { WorkerClient } from "./foundry/worker-client.mjs";
import { upload, freeName, freeDir, ensureDir } from "./foundry/files.mjs";
import { progressBar } from "./foundry/progress.mjs";
import { readPlan, normalize } from "./core/plan.mjs";
import { checkPlan } from "./core/check.mjs";
import { rerollPlan, setLocked } from "./core/seeds.mjs";
import { resolveArt, forgetBroken } from "./foundry/art/index.mjs";
import { folderIndex, forget as forgetFolders, forgetChoices } from "./foundry/art/folders.mjs";
import { ArtBrowser, ArtMenu } from "./foundry/art-browser.mjs";
import { publish } from "./foundry/publish.mjs";
import { AtlasScribeApp } from "./foundry/preview.mjs";
import { listPlans, loadPlan, savePlan, planExists, fileFor } from "./foundry/plans.mjs";
import { quickPlan, QUICK, QUICK_LABELS, QUICK_ANY, HAS, QUARTERS, OUTSIDE } from "./core/quick.mjs";
import { briefPlan, BRIEF, BRIEF_LABELS } from "./core/brief.mjs";
import { readDescription } from "./core/describe.mjs";
import { registerHeight } from "./foundry/height.mjs";
import { registerRules, registerRulesSetting, rules } from "./foundry/rules.mjs";

const MOD = "atlas-scribe";
const worker = new WorkerClient();

/** The job running now: { cancelled }, or null. */
let job = null;

/** The AtlasScribe window: one for the session, kept when closed so its plan and undo history are there next time. */
let theApp = null;
/** The longer side of the preview picture, in pixels. */
let previewPx = 1600;

/** The folder AtlasScribe writes into: the setting, or this world's own atlas-scribe folder. */
/** A battle map's drawn art, from the world settings: { look: "painted" or "inked", all }. */
function drawnSetting() {
  const get = (k, d) => { try { return game.settings.get(MOD, k); } catch { return d; } };
  return { look: get("drawnLook", "painted") === "inked" ? "inked" : "painted", all: !!get("drawnAll", false) };
}

function outputFolder() {
  const set = String(game.settings.get(MOD, "outputFolder") ?? "").trim().replace(/^\/+|\/+$/g, "");
  return set || `worlds/${game.world.id}/${MOD}`;
}

function requireGM() {
  if (!game.user.isGM) throw new Error("AtlasScribe: only a GM can do that");
}

function cancelledError() {
  const e = new Error("AtlasScribe: canceled");
  e.cancelled = true;
  return e;
}

/** Runs fn(check) as the one job; check() throws once the job has been canceled. */
async function exclusive(fn) {
  if (job) throw new Error("AtlasScribe is already working on a map. Wait for it to finish, or stop it with cancel().");
  const me = { cancelled: false };
  job = me;
  try {
    return await fn(() => {
      if (me.cancelled) throw cancelledError();
    });
  } finally {
    if (job === me) job = null;
  }
}

/** Checks a plan and throws, in plain words, if it has errors. Returns { plan (normalized), problems }. */
function planOrThrow(input) {
  const checked = api.checkPlan(input);
  if (!checked.ok) {
    const errors = checked.problems.filter((p) => p.level === "error").map((p) => p.message);
    throw new Error(`AtlasScribe: the plan has ${errors.length} error(s): ${errors.join(" ")}`);
  }
  return checked;
}

/** { path, width, height, thumb?, overheads?, furniture?, mist?, levels? } for an image: from render's result, or measured from its file. */
async function imageInfo(image) {
  if (image && typeof image === "object" && image.path && image.width && image.height)
    return { path: image.path, width: image.width, height: image.height, thumb: image.thumb ?? null, overheads: Array.isArray(image.overheads) ? image.overheads : null, furniture: Array.isArray(image.furniture) ? image.furniture : null, mist: Array.isArray(image.mist) ? image.mist : null, levels: Array.isArray(image.levels) ? image.levels : null };
  const path = typeof image === "string" ? image : image?.path;
  if (!path) throw new Error("AtlasScribe: publish needs the map image (render's result, or its path)");
  const res = await fetch(new URL(path, window.location.href));
  if (!res.ok) throw new Error(`AtlasScribe: couldn't load the map image ${path}`);
  const bmp = await createImageBitmap(await res.blob());
  const info = { path, width: bmp.width, height: bmp.height, thumb: null, overheads: null, furniture: null, mist: null, levels: null };
  bmp.close();
  return info;
}

/** Publishes a checked plan's image, with its own progress bar. */
async function publishChecked(plan, image, { scene, force }, check) {
  if (scene && !game.scenes.get(scene)) throw new Error(`AtlasScribe: there's no scene with the id ${scene}`);
  const img = await imageInfo(image);
  const title = `AtlasScribe: publishing ${plan.output.scene.name}`;
  const bar = progressBar(title);
  try {
    // The layout names the notable buildings' labels: render's, else laid out again (the same plan lays out the same,
    // so it can take a while for a big city: it shows on the bar and can be canceled). Should that fail, the scene
    // is still made, without those labels
    let layout = image?.layout ?? null, from = 0, lost = null;
    if (!layout) {
      from = 0.3;
      try {
        layout = (await worker.run("layout", { plan }, { onProgress: (p, l) => bar.update(from * p, `Laying out for the labels: ${l ?? ""}`.trim()) })).layout;
      } catch (e) {
        if (e.cancelled) throw e;
        lost = `The notable buildings' hidden labels were left off: laying the map out again for them failed (${e.message}).`;
      }
    }
    check();
    const res = await publish({ plan, image: img, width: img.width, height: img.height, folder: outputFolder(), layout, sceneId: scene, force, check, onProgress: (p, l) => bar.update(from + (1 - from) * p, l) });
    if (lost) res.warnings.push(lost);
    bar.done(`${title}: ${res.created ? "created the scene" : "updated the scene"}${res.backup ? ` (backup: ${res.backup})` : ""}`);
    return res;
  } catch (e) {
    bar.done(e.cancelled ? `${title}: canceled` : `${title}: failed (${e.message})`);
    throw e;
  }
}

const api = {
  get version() {
    return game.modules.get(MOD)?.version ?? null;
  },

  /** True while a job (render, publish or test) is running. */
  get busy() {
    return job !== null || worker.busy;
  },

  /**
   * Adds the rules adapter for a game system (see scripts/foundry/rules.mjs for what an adapter can give), used by
   * battle maps made or updated from then on. Returns true when it was taken.
   */
  registerRules(systemId, adapter) {
    return registerRules(systemId, adapter);
  },

  /** The rules battle maps follow now: { id, label } of the game system's adapter, or Foundry's own ("core"). */
  get rules() {
    const R = rules();
    return { id: R.id, label: R.label ?? R.id };
  },

  /** Stops the running job at its next step (a paint stops at once). Returns true if there was one to stop. */
  cancel() {
    if (!job) return worker.cancel();
    job.cancelled = true;
    worker.cancel();
    return true;
  },

  /** Opens the Art Browser. */
  async openArt() {
    requireGM();
    return (foundry.applications.instances.get("atlas-scribe-art") ?? new ArtBrowser()).render(true);
  },

  /**
   * Reads the art folders again and returns what each holds: [{ folder: { source, path }, files, dirs, manifests,
   * roles, cut, error, errors }].
   */
  async rescanArt() {
    requireGM();
    forgetFolders();
    return (await folderIndex()).folders;
  },

  /**
   * Reads a plan (an object, JSON text, or text with a ```mapplan block) and checks it.
   * Returns { plan, problems, ok }: plan has every default filled in (null if it couldn't be read), problems is the
   * checker's list ({ level, id, field, message }), and ok is true when there are no errors.
   */
  checkPlan(input) {
    const { plan, error } = readPlan(input);
    if (!plan) return { plan: null, problems: [{ level: "error", id: null, field: null, message: error }], ok: false };
    const problems = checkPlan(plan);
    return { plan: normalize(plan), problems, ok: !problems.some((p) => p.level === "error") };
  },

  /**
   * Rerolls what a reroll can redraw (districts, areas, heights and shaped water: seeds.mjs rerollable): a copy of
   * the plan with new seeds for the ids given (one id or a list), or for every such feature that isn't locked when
   * ids is left out. Locked features, the plan's own seed and everything else stay as they are, and each rerolled one
   * changes alone. Doesn't render: pass the plan to render. Returns { plan, rerolled: [id], skipped: [{ id, why }] }.
   */
  reroll(input, ids = null) {
    const { plan, error } = readPlan(input);
    if (!plan) throw new Error(`AtlasScribe: ${error}`);
    return rerollPlan(plan, ids);
  },

  /** A copy of the plan with these features locked, so a reroll leaves them alone. Returns the plan. */
  lock(input, ids) {
    const { plan, error } = readPlan(input);
    if (!plan) throw new Error(`AtlasScribe: ${error}`);
    return setLocked(plan, ids, true);
  },

  /** A copy of the plan with these features unlocked. Returns the plan. */
  unlock(input, ids) {
    const { plan, error } = readPlan(input);
    if (!plan) throw new Error(`AtlasScribe: ${error}`);
    return setLocked(plan, ids, false);
  },

  /**
   * A quick look at a plan: laid out and drawn in plain colors in the window in a second or so. Only one window is
   * open at a time; a second call shows the new plan in it. px: the picture's longer side. Returns the window (it
   * says why when the plan can't be drawn).
   */
  async preview(input, { px = 1600 } = {}) {
    requireGM();
    const { plan, error } = readPlan(input);
    if (!plan) throw new Error(`AtlasScribe: ${error}`);
    planOrThrow(plan);
    previewPx = px;
    const app = theWindow();
    if (app.publishing) throw new Error("AtlasScribe: the window is making a scene; try again when it's done");
    if (app.minimized) await app.maximize();
    if (app.rendered) app.bringToFront();
    // The window may hold unsaved work: show it, and ask before putting another plan in its place
    else if (app.dirty) await app.render({ force: true });
    if (!(await app.confirmDiscard())) throw new Error("AtlasScribe: kept the window's unsaved plan; save it, then preview again");
    await app.show(plan);
    return app;
  },

  /**
   * Opens the AtlasScribe window (GM only): the plan it had, else the plan last opened, else a welcome with Quick
   * Start. Returns the window.
   */
  async open() {
    requireGM();
    const app = theWindow();
    if (app.minimized) await app.maximize();
    if (app.rendered) app.bringToFront();
    await app.reopen();
    return app;
  },

  /**
   * Quick Start without the window: a plan from { size, season, water, roads, center, surroundings, river, shape, name,
   * seed, has, quarters, outside } (any left out is picked from the seed): has, a village's or town's buildings and
   * places ({ temple: true, inn: false, ... }); quarters, the city's quarters to keep; outside, a city's { citadel,
   * oldWall, suburbs, cemetery, mills }. Returns { plan, choices }. The choices are listed in api.quickChoices.
   */
  quickPlan(options = {}) {
    return quickPlan(options);
  },

  /**
   * Quick Start's choices: { size: [...], season: [...], water, roads, center, surroundings, river and shape (a city's),
   * has, quarters, outside }.
   */
  get quickChoices() {
    return { ...structuredClone(QUICK), has: [...HAS], quarters: [...QUARTERS], outside: [...OUTSIDE] };
  },

  /**
   * A battle map's plan from a brief, as Quick Start's Battle map tab makes it ({ site, size, season, time, weather,
   * ground, features, trees, litter, rocks, brush, building, street, camp, castle, name, seed }; any left out has a
   * default). Returns { plan, brief, notes }. The choices are listed in api.briefChoices.
   */
  briefPlan(brief = {}) {
    return briefPlan(brief);
  },

  /**
   * The brief's choices: each one's values ({ site: [...], size, season, time, weather, ground, features, trees, litter,
   * rocks, brush, use, buildingSize, place, quarter, camp, ... }), and labels, the words the window shows for them.
   */
  get briefChoices() {
    return { ...structuredClone(BRIEF), labels: structuredClone(BRIEF_LABELS) };
  },

  /** Reads a description in words, as the Describe box does: { brief, chips, later, skipped, unknown } (see core/describe.mjs). */
  readDescription(text = "") {
    return readDescription(text);
  },

  /**
   * Renders a plan into an image in the worker and saves it to <output>/maps (never over an existing file): check the
   * plan (errors stop it), lay it out, fetch its art (the art folders, then FA Nexus; roles with none are listed in
   * missingArt and painted plain, or on a battle map drawn, in the look drawn names), paint, save. With publish: true the map is then published (scene and force as there); if that fails,
   * the error carries the saved map's result as error.result. A battle map also saves its roofs and crowns
   * (overheads: [{ path, kind, x, y, width, height, elevation }]), its floors (levels: [{ floor, path }]) and lists
   * its furniture and mist tiles. Returns { path, width, height, tiles, ms, layout, overheads, furniture, mist,
   * levels, missingArt, drawn, notes, artNotes, warnings }, and scene when published.
   */
  async render(input, { save = true, publish: andPublish = false, scene = null, force = false } = {}) {
    requireGM();
    if (andPublish && !save) throw new Error("AtlasScribe: a map has to be saved to be published");
    if (andPublish && scene && !game.scenes.get(scene)) throw new Error(`AtlasScribe: there's no scene with the id ${scene}`);
    const checked = planOrThrow(input);
    const plan = checked.plan;
    return exclusive(async (check) => {
      const title = `AtlasScribe: ${plan.name ?? plan.id ?? "map"}`;
      const bar = progressBar(title);
      const t0 = performance.now();
      let result;
      try {
        const { layout, roles } = await worker.run("layout", { plan }, { onProgress: (p, l) => bar.update(0.05 * p, l) });
        check();
        // (a battle map draws what has no art, or with the setting everything, asking the art sources for nothing)
        const battle = layout.kind === "battle", drawn = battle ? drawnSetting() : null;
        const { art, scale, missing, notes } = drawn?.all ? { art: {}, scale: {}, missing: [], notes: [] } : await resolveArt(roles, (p, l) => bar.update(0.05 + 0.15 * p, l), { drawn: battle });
        check();
        const img = await worker.run("paint", { layout, art, scale, quality: plan.output.quality, drawn }, { onProgress: (p, l) => bar.update(0.2 + 0.75 * p, l) });
        if (img.brokenArt?.length) forgetBroken(img.brokenUrls ?? []); // a file that failed may have gone: look again next time
        check();
        let path = null, overheads = [], levels = [];
        if (save) {
          bar.update(0.97, "Saving");
          const dir = `${outputFolder()}/maps`;
          const name = await freeName(dir, plan.id ?? "map", "webp");
          path = await upload(dir, name, img.blob);
          // A battle map's roofs and crowns go beside the map in a folder named after it (never one already there);
          // on a failure the error says where the map was saved
          if (img.overheads?.length) {
            try {
              const sub = `${dir}/${await freeDir(dir, `${name.replace(/\.webp$/, "")}-overhead`)}`;
              await ensureDir(sub);
              for (const [k, o] of img.overheads.entries()) {
                check();
                bar.update(0.97 + (0.03 * k) / img.overheads.length, "Saving the roofs and trees");
                overheads.push({ path: await upload(sub, `${o.name}.webp`, o.blob, { ready: true }), kind: o.kind, x: o.x, y: o.y, width: o.width, height: o.height, elevation: o.elevation });
              }
            } catch (e) {
              // (overheads null, not empty: a scene published from this keeps the roofs and trees it had)
              e.result = { path, width: img.width, height: img.height, layout, overheads: null, furniture: null, mist: null, levels: null };
              throw e;
            }
          }
          // The drawn images its furniture and mist use, beside the map in a folder of their own, and the tiles pointed
          // at them
          if (img.drawnFiles?.length) {
            try {
              const sub = `${dir}/${await freeDir(dir, `${name.replace(/\.webp$/, "")}-drawn`)}`;
              await ensureDir(sub);
              const saved = new Map();
              for (const f of img.drawnFiles) { check(); saved.set(`drawn:${f.name}`, await upload(sub, f.name, f.blob, { ready: true })); }
              for (const t of [...(img.furniture ?? []), ...(img.mist ?? [])]) if (saved.has(t.src)) t.src = saved.get(t.src);
            } catch (e) {
              e.result = { path, width: img.width, height: img.height, layout, overheads, furniture: null, mist: null, levels: null };
              throw e;
            }
          }
          // A battle map's floors above and below the ground, each its own image beside the map (in a folder of its own,
          // as the roofs are), for publish to make the scene's levels of
          if (img.levels?.length) {
            try {
              const sub = `${dir}/${await freeDir(dir, `${name.replace(/\.webp$/, "")}-levels`)}`;
              await ensureDir(sub);
              for (const l of img.levels) {
                check();
                bar.update(0.99, "Saving the floors");
                levels.push({ floor: l.floor, path: await upload(sub, `${l.floor < 0 ? "cellar" : `floor-${l.floor}`}.webp`, l.blob, { ready: true }) });
              }
            } catch (e) {
              e.result = { path, width: img.width, height: img.height, layout, overheads, furniture: null, mist: null, levels: null };
              throw e;
            }
          }
        }
        const ms = Math.round(performance.now() - t0);
        bar.done(`${title}: done in ${Math.round(ms / 1000)} s${path ? `, saved to ${path}` : ""}`);
        result = {
          path, width: img.width, height: img.height, tiles: img.tiles, ms, layout, overheads, furniture: img.furniture ?? [], mist: img.mist ?? [], levels,
          missingArt: [...new Set([...missing, ...(img.failedArt ?? [])])],
          drawn: drawn ? drawn.look : null, // (a battle map's: what has no art is drawn, in this look)
          notes: [...layout.notes.map((n) => n.message), ...notes],
          artNotes: notes, // why art is missing (a folder that couldn't be read, say)
          warnings: checked.problems.filter((p) => p.level === "warning").map((p) => p.message),
        };
        Object.defineProperty(result, "thumb", { value: img.thumb ?? null, enumerable: false }); // for publish
      } catch (e) {
        bar.done(e.cancelled ? `${title}: canceled` : `${title}: failed (${e.message})`);
        throw e;
      }
      if (andPublish) {
        try {
          result.scene = await publishChecked(plan, result, { scene, force }, check);
          result.warnings.push(...result.scene.warnings);
        } catch (e) {
          e.result = result; // the map was saved; say where
          throw e;
        }
      }
      return result;
    });
  },

  /**
   * Makes a rendered map into a scene (see foundry/publish.mjs): the image, the plan's grid and scene settings, a
   * thumbnail, the labels, and on a battle map its tiles, walls, regions, lights and levels. image: render's result
   * or a path. scene: a scene to update (only one AtlasScribe made, unless force; backed up first). Returns publish's
   * result.
   */
  async publish(input, { image, scene = null, force = false } = {}) {
    requireGM();
    const { plan } = planOrThrow(input);
    return exclusive((check) => publishChecked(plan, image, { scene, force }, check));
  },

  /**
   * Paints a test pattern in the worker and uploads it to <output>/tests. Proves the whole pipeline: the worker,
   * image loading (texture: an image path to tile), soft masks, progress, WebP output and the upload.
   * Returns { path, width, height, ms, bytes }.
   */
  async test({ width = 2048, height = 2048, texture = null, seed = 1 } = {}) {
    requireGM();
    return exclusive(async (check) => {
      const bar = progressBar("AtlasScribe test");
      try {
        const textureUrl = texture ? new URL(texture, window.location.href).href : null;
        const res = await worker.run("test", { width, height, texture: textureUrl, seed }, { onProgress: (p, l) => bar.update(p, l) });
        check();
        bar.update(0.95, "Saving");
        const dir = `${outputFolder()}/tests`;
        const path = await upload(dir, await freeName(dir, "atlas-scribe-test", "webp"), res.blob);
        bar.done(`AtlasScribe test saved: ${path}`);
        return { path, width: res.width, height: res.height, ms: res.ms, bytes: res.blob.size };
      } catch (e) {
        bar.done(e.cancelled ? "AtlasScribe test: canceled" : `AtlasScribe test: failed (${e.message})`);
        throw e;
      }
    });
  },
};

/** The saved plans' folder, and (host, below) what the window asks of the module. */
const plansDir = () => `${outputFolder()}/plans`;
const host = {
  check: (input) => api.checkPlan(input),
  read: (input) => readPlan(input),
  quick: (options) => quickPlan(options),
  quickChoices: { QUICK, LABELS: QUICK_LABELS, ANY: QUICK_ANY },
  folder: plansDir,
  plans: {
    list: () => listPlans(plansDir()),
    load: (path) => loadPlan(path),
    save: (plan, file) => savePlan(plansDir(), plan, file),
    exists: (file) => planExists(plansDir(), file),
    fileFor,
  },
  publish: (plan, { scene = null } = {}) => api.render(plan, { publish: true, scene }),
  // A battle map of a rectangle on a plan (the window's Battle map tool): { plan, notes }
  zoom: (plan, rect, zoom) => exclusive(async () => {
    const checked = planOrThrow(plan);
    return worker.run("zoom", { plan: checked.plan, rect, zoom });
  }),
  battleZoom: {
    get: () => Number(game.settings.get(MOD, "battleZoom")) || 2,
    set: (v) => game.settings.set(MOD, "battleZoom", v),
  },
  cancel: () => api.cancel(),
  openArt: () => api.openArt(),
  // The last plan opened here, for this world only (a client setting is shared by every world on the browser)
  last: () => {
    try {
      const { world, path } = JSON.parse(game.settings.get(MOD, "lastPlan") || "{}");
      return world === game.world.id && path ? path : null;
    } catch {
      return null;
    }
  },
  setLast: (path) => game.settings.set(MOD, "lastPlan", path ? JSON.stringify({ world: game.world.id, path }) : ""),
};

/** The preview's drawing: one job at a time, as render is. */
const runPreview = (p) => exclusive(async () => {
  const checked = planOrThrow(p);
  return worker.run("preview", { plan: checked.plan, px: previewPx });
});

function theWindow() {
  theApp ??= new AtlasScribeApp({ run: runPreview, host });
  return theApp;
}

Hooks.once("init", () => {
  game.settings.register(MOD, "outputFolder", {
    name: "Output folder",
    hint: "Where AtlasScribe saves plans, maps, thumbnails and scene backups, under the Data folder. Leave empty for this world's own atlas-scribe folder.",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });
  game.settings.register(MOD, "lastPlan", { scope: "client", config: false, type: String, default: "" });
  // (JSON: [{ source, path, bucket }]; empty until the GM sets a list, meaning FA Nexus's folder when it exists)
  game.settings.register(MOD, "artFolders", { scope: "world", config: false, type: String, default: "", onChange: () => forgetFolders() });
  // (JSON: art chosen by hand, { role: { files, folders, px, all } }, and filename rules, [{ pattern, role, px }])
  game.settings.register(MOD, "artRoles", { scope: "world", config: false, type: String, default: "", onChange: () => forgetChoices() });
  game.settings.register(MOD, "artRules", { scope: "world", config: false, type: String, default: "", onChange: () => forgetChoices() });
  game.settings.registerMenu(MOD, "artMenu", {
    name: "Art",
    label: "Art",
    hint: "Where battle maps and the textured style get their art: folders on the server, art you choose, filename rules.",
    icon: "fa-solid fa-images",
    type: ArtMenu,
    restricted: true,
  });
  game.settings.register(MOD, "battleZoom", {
    name: "Battle map zoom",
    hint: "How big a battle map made from an area of a town map is drawn: true size, or bigger so there's room to fight. The Battle map tool in the AtlasScribe window changes it too.",
    scope: "client",
    config: true,
    type: Number,
    choices: { 1: "True size", 1.5: "1.5 times true size", 2: "2 times true size" },
    default: 2,
  });
  game.settings.register(MOD, "drawnLook", {
    name: "Drawn battle art",
    hint: "How a battle map draws what has no art: painted (shaded, in natural colors) or inked (pale colors with ink lines, like a town map).",
    scope: "world",
    config: true,
    type: String,
    choices: { painted: "Painted", inked: "Inked" },
    default: "painted",
  });
  game.settings.register(MOD, "drawnAll", {
    name: "Draw whole battle maps",
    hint: "Draw every battle map entirely, even where art folders or FA Nexus have art, so the whole map has one look.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
  registerHeight();
  registerRulesSetting();
});

// An AtlasScribe button at the top of the Scenes tab, for the GM
Hooks.on("renderSceneDirectory", (app, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".atlas-scribe-open")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "atlas-scribe-open";
  button.innerHTML = `<i class="fa-solid fa-map"></i> AtlasScribe`;
  button.dataset.tooltip = "Make a map with Quick Start, change it on the map, and make it a scene";
  button.addEventListener("click", () => api.open().catch((e) => ui.notifications.error(e.message)));
  (root.querySelector(".header-actions") ?? root.querySelector(".directory-header") ?? root).append(button);
});

Hooks.once("ready", () => {
  const module = game.modules.get(MOD);
  module.api = api;
  Hooks.callAll(`${MOD}.ready`, api);
});
