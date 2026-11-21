/**
 * AtlasScribe: a map plan in, a map out. The entry point: settings and the API at
 * game.modules.get("atlas-scribe").api. Everything that changes the world is GM only. One job runs at a time;
 * cancel() stops it between any two steps.
 */
import { WorkerClient } from "./foundry/worker-client.mjs";
import { upload, freeName, freeDir, ensureDir } from "./foundry/files.mjs";
import { asBuilt, changesBetween, digestOf } from "./core/summary.mjs";
import { importAny } from "./core/import.mjs";
import { toUVTT } from "./core/uvtt.mjs";
import { progressBar } from "./foundry/progress.mjs";
import { readPlan, normalize } from "./core/plan.mjs";
import { toDataUrl } from "./core/land/pngio.mjs";
import { landSeedOf } from "./core/land/schema.mjs";
import { checkPlan } from "./core/check.mjs";
import { rerollPlan, setLocked } from "./core/seeds.mjs";
import { resolveArt, forgetBroken, forgetUnloadable } from "./foundry/art/index.mjs";
import { folderIndex, forget as forgetFolders, forgetChoices } from "./foundry/art/folders.mjs";
import { ArtMenu, artWindow } from "./foundry/art-browser.mjs";
import { nameSetsWindow, storedNameSets, saveNameSets, setUseHere, refreshNameSets } from "./foundry/name-sets.mjs";
import { parseNameSet, sampleNames } from "./core/land/namesets.mjs";
import { namer } from "./core/land/names.mjs";
import { withNameSet } from "./core/edit.mjs";
import { publish, stamp } from "./foundry/publish.mjs";
import { AtlasScribeApp } from "./foundry/preview.mjs";
import { filesWindow } from "./foundry/files-view.mjs";
import { listPlans, loadPlan, savePlan, planExists, fileFor } from "./foundry/plans.mjs";
import { quickPlan, QUICK, QUICK_LABELS, QUICK_ANY, HAS, QUARTERS, OUTSIDE } from "./core/quick.mjs";
import { briefPlan, BRIEF, BRIEF_LABELS } from "./core/brief.mjs";
import { landPlan, LAND_QUICK, LAND_QUICK_LABELS } from "./core/quick-land.mjs";
import { readDescription } from "./core/describe.mjs";
import { registerHeight } from "./foundry/height.mjs";
import { registerRules, registerRulesSetting, rules } from "./foundry/rules.mjs";
import { MOD, note } from "./foundry/util.mjs";
import { drawScene, SNAPSHOT } from "./foundry/snapshot.mjs";

// (on the page instead when the Render in a worker setting is off: a browser or host where workers fail)
const worker = new WorkerClient({
  inPage: () => { try { return game.settings.get(MOD, "renderInWorker") === false; } catch { return false; } },
  // (a Data path, a kept land's file, as a URL the worker can fetch: the server's route prefix included)
  urlOf: (path) => new URL(foundry.utils.getRoute(path), window.location.href).href,
  // (where a kept land's file would be in this world's output folder: a plan copied from another world, or a world
  // that moved, finds its file there)
  altOf: (path) => { try { const tail = String(path).split("/").slice(-3); return tail[0] === "lands" ? `${outputFolder()}/${tail.join("/")}` : null; } catch { return null; } },
});

/** The job running now: { canceled }, or null. */
let job = null;

/** The AtlasScribe window: one for the session, kept when closed so its plan and undo history are there next time. */
let theApp = null;
/** The longer side of the preview picture, in pixels. */
let previewPx = 1600;

/** A battle map's drawn art and its movable props, from the world settings: { look: "painted" or "inked", all, movable }. */
function drawnSetting() {
  const get = (k, d) => { try { return game.settings.get(MOD, k); } catch { return d; } };
  return { look: get("drawnLook", "painted") === "inked" ? "inked" : "painted", all: !!get("drawnAll", false), movable: get("movableProps", true) !== false };
}

/** When a scene is backed up before an update: "every" update, the first in a "session", or "never". */
function backupSetting() {
  try {
    const v = game.settings.get(MOD, "backups");
    return ["every", "session", "never"].includes(v) ? v : "every";
  } catch {
    return "every";
  }
}

/** The folder AtlasScribe writes into: the setting, or this world's own atlas-scribe folder. */
function outputFolder() {
  const set = String(game.settings.get(MOD, "outputFolder") ?? "").trim().replace(/^\/+|\/+$/g, "");
  return set || `worlds/${game.world.id}/${MOD}`;
}

/** A folder setting under the Data folder, or (left empty) its folder in the output folder. */
function folderSetting(key, under) {
  const set = String(setting(key, "") ?? "").trim().replace(/^\/+|\/+$/g, "");
  return set || `${outputFolder()}/${under}`;
}
/** A plan's id as a file name. */
const safeId = (id) => String(id).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "plan";
const backupFolder = () => folderSetting("backupFolder", "backups");
const cacheFolder = () => folderSetting("cacheFolder", "cache");

function requireGM() {
  if (!game.user.isGM) throw new Error("AtlasScribe: only a GM can do that");
}

/** The error a canceled job throws: canceled is true, and so is e.cancelled (the older spelling, which scripts may still read). */
function canceledError() {
  const e = new Error("AtlasScribe: canceled");
  e.canceled = true;
  e.cancelled = true;
  return e;
}

/** Runs fn(check) as the one job; check() throws once the job has been canceled. */
async function exclusive(fn) {
  if (job) throw new Error("AtlasScribe is already working on a map. Wait for it to finish, or stop it with cancel().");
  const me = { canceled: false };
  job = me;
  try {
    return await fn(() => {
      if (me.canceled) throw canceledError();
    });
  } finally {
    if (job === me) job = null;
  }
}

/** Checks a plan and throws, in plain words, if it has errors. Returns { plan (normalized), problems }. */
/** JSON with every object's keys sorted, to tell whether two plans are the same. */
const sortedJSON = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

function planOrThrow(input) {
  const checked = api.checkPlan(input);
  if (!checked.ok) {
    const errors = checked.problems.filter((p) => p.level === "error").map((p) => p.message);
    throw new Error(`AtlasScribe: the plan has ${errors.length} error(s): ${errors.join(" ")}`);
  }
  return checked;
}

/** { path, width, height, thumb?, overheads?, overlays?, furniture?, mist?, levels?, parts? } for an image: from render's result, or measured from its file. */
async function imageInfo(image) {
  if (image && typeof image === "object" && image.path && image.width && image.height)
    return { path: image.path, width: image.width, height: image.height, thumb: image.thumb ?? null, overheads: Array.isArray(image.overheads) ? image.overheads : null, overlays: Array.isArray(image.overlays) ? image.overlays : null, furniture: Array.isArray(image.furniture) ? image.furniture : null, mist: Array.isArray(image.mist) ? image.mist : null, levels: Array.isArray(image.levels) ? image.levels : null, parts: Array.isArray(image.parts) && image.parts.length ? image.parts : null };
  const path = typeof image === "string" ? image : image?.path;
  if (!path) throw new Error("AtlasScribe: publish needs the map image (render's result, or its path)");
  const res = await fetch(new URL(path, window.location.href));
  if (!res.ok) throw new Error(`AtlasScribe: couldn't load the map image ${path}`);
  const bmp = await createImageBitmap(await res.blob());
  const info = { path, width: bmp.width, height: bmp.height, thumb: null, overheads: null, overlays: null, furniture: null, mist: null, levels: null };
  bmp.close();
  return info;
}

/**
 * A checked plan laid out as the one job, on a progress bar of its own (what: what the bar says it's doing); then(got,
 * check), when given, runs in the same job on the layout. Returns then's result, or { layout, roles }.
 */
async function layOutAlone(plan, what, then = null) {
  return exclusive(async (check) => {
    const title = `AtlasScribe: ${what} ${plan.name ?? plan.id ?? "map"}`;
    const bar = progressBar(title);
    try {
      const got = await worker.run("layout", { plan }, { onProgress: (p, l) => bar.update(0.9 * p, l) });
      check();
      const out = then ? await then(got, check) : got;
      bar.done(`${title}: done`);
      return out;
    } catch (e) {
      bar.done(e.canceled ? `${title}: canceled` : `${title}: failed (${e.message})`);
      throw e;
    }
  });
}

/** Publishes a checked plan's image, with its own progress bar. */
async function publishChecked(plan, image, { scene, force, raw = null }, check) {
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
        if (e.canceled) throw e;
        lost = plan.land ? `The map's names (its hidden labels) were left off: laying the map out again for them failed (${e.message}).` : `The notable buildings' hidden labels were left off: laying the map out again for them failed (${e.message}).`;
      }
    }
    check();
    const res = await publish({ plan, image: img, width: img.width, height: img.height, folder: outputFolder(), layout, sceneId: scene, force, backups: backupSetting(), backupFolder: backupFolder(), batch: setting("batchTag", "").trim() || null, check, onProgress: (p, l) => bar.update(from + (1 - from) * p, l) });
    if (lost) res.warnings.push(lost);
    // (the plan the scene was made from, as written, kept under its id so Open scene's plan and planOf find it; a
    // file already there with another version of it is never written over: the window saves first, and a script
    // saves with savePlan)
    const keep = plan.id ? { ...(raw && typeof raw === "object" ? raw : plan), id: plan.id } : null;
    if (keep) {
      try {
        const file = fileFor(keep.id), path = `${plansDir()}/${file}`;
        if (!(await planExists(plansDir(), file))) res.plan = await savePlan(plansDir(), keep, file);
        else if (sortedJSON(await loadPlan(path).catch(() => null)) === sortedJSON(keep)) res.plan = path;
        else res.warnings.push(`The plan file ${file} holds another version of this plan, so it was kept as it was: save the plan from the window (or with api.savePlan) to keep this one with the scene.`);
      } catch (e) { res.warnings.push(`The plan wasn't kept with the scene (${e.message}); save it from the window to open it again later.`); }
    }
    bar.done(`${title}: ${res.created ? "created the scene" : "updated the scene"}${res.backup ? ` (backup: ${res.backup})` : ""}`);
    return res;
  } catch (e) {
    bar.done(e.canceled ? `${title}: canceled` : `${title}: failed (${e.message})`);
    throw e;
  }
}

const api = {
  get version() {
    return game.modules.get(MOD)?.version ?? null;
  },

  /** True while a job (render or publish) is running. */
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
    job.canceled = true;
    worker.cancel();
    return true;
  },

  /** Opens the Art Browser. */
  async openArt() {
    requireGM();
    return artWindow.open();
  },

  /**
   * Reads the art folders again and returns what each holds: [{ folder: { source, path }, files, dirs, manifests,
   * roles, cut, error, errors }].
   */
  async rescanArt() {
    requireGM();
    forgetFolders();
    forgetUnloadable();
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
   * Opens a saved plan in the window (GM only): a scene's (the plan saved under the id it was made from; scene: a
   * scene or its id), or { path } a plan file's. Asks before dropping the window's unsaved changes. Returns the window.
   */
  async openPlan(scene) {
    requireGM();
    let path = typeof scene?.path === "string" ? scene.path : null, plan;
    if (path) plan = await loadPlan(path);
    else {
      const sc = typeof scene === "string" ? game.scenes.get(scene) : scene;
      const id = sc?.getFlag?.(MOD, "plan");
      if (!id) throw new Error(`AtlasScribe: ${sc ? `"${sc.name}" wasn't made from a saved plan` : "there's no such scene"}`);
      path = `${plansDir()}/${fileFor(id)}`;
      plan = await loadPlan(path).catch(() => {
        throw new Error(`AtlasScribe: the plan ${fileFor(id)} that "${sc.name}" was made from isn't in ${plansDir()}`);
      });
    }
    const app = theWindow();
    if (app.publishing) throw new Error("AtlasScribe: the window is making a scene; try again when it's done");
    if (app.minimized) await app.maximize();
    if (app.rendered) app.bringToFront();
    else if (app.dirty) await app.render({ force: true });
    await app.offerDraft();
    if (!(await app.confirmDiscard())) return app;
    await app.show(plan, null, { path, saved: true });
    return app;
  },

  /**
   * What AtlasScribe made with a batch tag (the Batch tag setting's, else a plan's id): each scene marked with it, or
   * holding documents marked with it, and how many of each kind. Returns [{ id, name, scene: true when the scene itself
   * is marked, documents: { Tile: n, Wall: n, ... } }].
   */
  batch(tag) {
    requireGM();
    if (typeof tag !== "string" || !tag) throw new Error("AtlasScribe: batch(tag) needs the tag, a plan's id or the Batch Tag setting's word");
    const marked = (d) => d?.flags?.[MOD]?.batch === tag;
    const out = [];
    for (const sc of game.scenes) {
      const documents = {};
      for (const [type, coll] of [["Tile", sc.tiles], ["Wall", sc.walls], ["AmbientLight", sc.lights], ["Region", sc.regions], ["Drawing", sc.drawings], ["Level", sc.levels], ["AmbientSound", sc.sounds]]) {
        const n = coll?.filter?.(marked).length ?? 0;
        if (n) documents[type] = n;
      }
      if (marked(sc) || Object.keys(documents).length) out.push({ id: sc.id, name: sc.name, scene: marked(sc), documents });
    }
    return out;
  },

  /** Opens the Files window (GM only): each saved plan's maps and backups, their sizes, and which a scene uses. */
  async openFiles() {
    requireGM();
    return filesWindow.open({ folder: outputFolder(), plansDir: plansDir(), backupDir: backupFolder() });
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
    await app.offerDraft();
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
   * A generated region's plan, as Quick Start's Region tab makes it at a kingdom, realm, continent or world scale
   * ({ scale, type, seaSide, climate, hemisphere, span, mountains, towns, grid, size, names, season, age, plates,
   * coast, wind, rain, rivers, lakes, plateaus, volcanic, nameSet (a library set's id or name, or { name, text }),
   * name, seed }; any left out has a default, Any lets the seed pick; a world takes a span of latitudes, pole to pole
   * by default, in place of a climate and a hemisphere).
   * Returns { plan, choices, notes }; its towns and roads aren't placed yet (api.placeTowns). The choices are listed
   * in api.landChoices.
   */
  landPlan(options = {}) {
    const { nameSet, ...rest } = options ?? {};
    let set = null;
    if (typeof nameSet === "string") {
      const lib = storedNameSets().find((s) => s.id === nameSet || s.name === nameSet);
      if (!lib) throw new Error(`AtlasScribe: the library has no name set "${nameSet}"`);
      set = { name: lib.name, text: lib.text, from: lib.id };
    } else if (nameSet && typeof nameSet === "object") {
      if (typeof nameSet.text !== "string") throw new Error("AtlasScribe: a name set given as an object needs its text ({ name, text })");
      set = { name: nameSet.name, text: nameSet.text };
    }
    return landPlan({ ...rest, ...(set ? { nameSet: set } : {}) });
  },

  /** A generated region's choices for landPlan: each one's values (the first the default) and labels. */
  get landChoices() {
    return { values: structuredClone(LAND_QUICK), labels: structuredClone(LAND_QUICK_LABELS) };
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
   * its furniture and mist tiles; an overland map saves its places and roads as a see-through layer (overlays: [{ path,
   * kind, x, y, width, height }]). Returns { path, width, height, tiles, ms, layout, overheads, overlays, furniture, mist,
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
        const { layout, roles, layoutId } = await worker.run("layout", { plan, keep: true }, { onProgress: (p, l) => bar.update(0.05 * p, l) });
        check();
        // (a battle map draws what has no art, or with the setting everything, asking the art sources for nothing)
        const battle = layout.kind === "battle", drawn = battle ? drawnSetting() : null;
        const { art, scale, missing, notes, from } = drawn?.all ? { art: {}, scale: {}, missing: [], notes: [], from: { folders: 0, nexus: 0 } } : await resolveArt(roles, (p, l) => bar.update(0.05 + 0.15 * p, l), { drawn: battle, check });
        check();
        // (the worker keeps the layout it made, so it isn't copied back to it; a worker started since gets it sent)
        const paintIt = (which) => worker.run("paint", { ...which, art, scale, quality: plan.output.quality, format: plan.output.format, drawn, partSide: largestImage() }, { onProgress: (p, l) => bar.update(0.2 + 0.75 * p, l) });
        const img = await paintIt({ layoutId }).catch((e) => (/no layout/.test(e.message) ? paintIt({ layout }) : Promise.reject(e)));
        // (a file that failed: left out from now on if it's still there, else looked for again next time)
        let broken = [];
        try {
          if (img.brokenUrls?.length) broken = await forgetBroken(img.brokenUrls);
        } catch (e) {
          console.warn(`${MOD} | couldn't check the art that failed to load: ${e.message}`); // (never at the cost of the painted map)
        }
        if (img.overBudget?.length) notes.push(`${img.overBudget.length === 1 ? "An art file was" : `${img.overBudget.length} art files were`} left out: all the art together came to more than a map can hold in memory`);
        if (broken.length) notes.push(`${broken.length === 1 ? "An art file" : `${broken.length} art files`} couldn't be loaded and ${broken.length === 1 ? "was" : "were"} left out: ${broken.slice(0, 5).join(", ")}${broken.length > 5 ? ", ..." : ""}`);
        check();
        let path = null, overheads = [], levels = [], parts = [], overlays = [];
        if (save) {
          bar.update(0.97, "Saving");
          const dir = `${outputFolder()}/maps`;
          // (dated, so the Files window can tell maps apart; with another GM on, their own too, so two renders of the
          // same plan at once never pick the same name)
          const gms = game.users?.filter?.((u) => u.isGM && u.active).length ?? 1;
          const name = await freeName(dir, `${plan.id ?? "map"}-${stamp()}${gms > 1 ? `-${game.user.id.slice(0, 4)}` : ""}`, img.blob?.type === "image/jpeg" ? "jpg" : "webp");
          path = await upload(dir, name, img.blob);
          // A map bigger than the Largest image setting: its parts too, beside it in a folder named after it, for the
          // scene to show as tiles
          // (parts that fail to save are left off, said so: the scene then shows the whole map)
          if (img.parts?.length) {
            try {
              const sub = `${dir}/${await freeDir(dir, `${name.replace(/\.(webp|jpg)$/, "")}-parts`)}`;
              await ensureDir(sub);
              const ext = img.blob?.type === "image/jpeg" ? "jpg" : "webp";
              for (const [k, q] of img.parts.entries()) {
                check();
                bar.update(0.97, "Saving the map's parts");
                parts.push({ path: await upload(sub, `part-${k + 1}.${ext}`, q.blob, { ready: true }), x: q.x, y: q.y, width: q.width, height: q.height });
              }
            } catch (e) {
              if (e?.canceled) throw e;
              parts = [];
              notes.push(`The map's parts couldn't be saved (${e.message}), so its scene shows the whole map`);
            }
          }
          // A battle map's roofs and crowns go beside the map in a folder named after it (never one already there);
          // on a failure the error says where the map was saved
          if (img.overheads?.length) {
            try {
              const sub = `${dir}/${await freeDir(dir, `${name.replace(/\.(webp|jpg)$/, "")}-overhead`)}`;
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
          // An overland map's places and roads, a see-through layer beside the map in a folder of its own, for publish to
          // lay over the land as a tile
          if (img.overlays?.length) {
            try {
              const sub = `${dir}/${await freeDir(dir, `${name.replace(/\.(webp|jpg)$/, "")}-layers`)}`;
              await ensureDir(sub);
              for (const o of img.overlays) {
                check();
                bar.update(0.98, "Saving the places and roads");
                overlays.push({ path: await upload(sub, `${o.name}.webp`, o.blob, { ready: true }), kind: o.kind, x: o.x, y: o.y, width: o.width, height: o.height });
              }
            } catch (e) {
              // (overlays null: a scene published from this keeps the places and roads it had)
              e.result = { path, width: img.width, height: img.height, layout, overheads, overlays: null, furniture: null, mist: null, levels: null };
              throw e;
            }
          }
          // The drawn images its furniture and mist use, beside the map in a folder of their own, and the tiles pointed
          // at them
          if (img.drawnFiles?.length) {
            try {
              const sub = `${dir}/${await freeDir(dir, `${name.replace(/\.(webp|jpg)$/, "")}-drawn`)}`;
              await ensureDir(sub);
              const saved = new Map();
              for (const f of img.drawnFiles) { check(); saved.set(`drawn:${f.name}`, await upload(sub, f.name, f.blob, { ready: true })); }
              for (const t of [...(img.furniture ?? []), ...(img.mist ?? [])]) if (saved.has(t.src)) t.src = saved.get(t.src);
            } catch (e) {
              e.result = { path, width: img.width, height: img.height, layout, overheads, overlays, furniture: null, mist: null, levels: null };
              throw e;
            }
          }
          // A battle map's floors above and below the ground, each its own image beside the map (in a folder of its own,
          // as the roofs are), for publish to make the scene's levels of
          if (img.levels?.length) {
            try {
              const sub = `${dir}/${await freeDir(dir, `${name.replace(/\.(webp|jpg)$/, "")}-levels`)}`;
              await ensureDir(sub);
              for (const l of img.levels) {
                check();
                bar.update(0.99, "Saving the floors");
                levels.push({ floor: l.floor, path: await upload(sub, `${l.floor < 0 ? "cellar" : `floor-${l.floor}`}.webp`, l.blob, { ready: true }) });
              }
            } catch (e) {
              e.result = { path, width: img.width, height: img.height, layout, overheads, overlays, furniture: null, mist: null, levels: null };
              throw e;
            }
          }
        }
        // What changed since this plan's last saved map, from the digest kept in the cache folder (and this one kept)
        let changed = [];
        if (save && plan.id) {
          try {
            const digest = digestOf(layout), file = `${safeId(plan.id)}.json`;
            const before = await fetch(`${cacheFolder()}/${file}`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
            const names = Object.fromEntries(plan.features.filter((f) => f.name).map((f) => [f.id, f.name]));
            changed = changesBetween(before, digest, { names });
            await upload(cacheFolder(), file, new Blob([JSON.stringify(digest)], { type: "application/json" }));
          } catch (e) {
            console.warn(`${MOD} | couldn't keep what this map holds for next time: ${e.message}`); // (never at the cost of the map)
          }
        }
        const ms = Math.round(performance.now() - t0);
        bar.done(`${title}: done in ${Math.round(ms / 1000)} s${path ? `, saved to ${path}` : ""}`);
        result = {
          path, parts, width: img.width, height: img.height, tiles: img.tiles, ms, layout, overheads, overlays, furniture: img.furniture ?? [], mist: img.mist ?? [], levels,
          missingArt: [...new Set([...missing, ...(img.failedArt ?? [])])],
          drawn: drawn ? drawn.look : null, // (a battle map's: what has no art is drawn, in this look)
          artFrom: from, // (how many roles each source filled: { folders, nexus })
          notes: [...layout.notes.map((n) => n.message), ...notes, ...(changed.length ? [`Since this plan's last map: ${changed.join("; ")}`] : [])],
          artNotes: notes, // why art is missing (a folder that couldn't be read, say)
          changed, // what changed since this plan's last saved map, in short lines (empty for the first)
          warnings: checked.problems.filter((p) => p.level === "warning").map((p) => p.message),
        };
        Object.defineProperty(result, "thumb", { value: img.thumb ?? null, enumerable: false }); // for publish
      } catch (e) {
        bar.done(e.canceled ? `${title}: canceled` : `${title}: failed (${e.message})`);
        // (a layout kept for a paint that won't come is let go)
        if (!worker.busy) worker.run("forget").catch(() => {});
        throw e;
      }
      if (andPublish) {
        try {
          result.scene = await publishChecked(plan, result, { scene, force, raw: readPlan(input).plan ?? null }, check);
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
   * A plan from what an import reads (GM only): an AtlasScribe plan, a watabou city or village export (JSON), or a
   * Universal VTT file (.dd2vtt, .uvtt), whose image is saved in the output folder's imports and put under the sketch.
   * opts: name, and for watabou ftPerUnit, ftPerSquare, flipY, buildings. Returns { plan, notes, from }.
   */
  async importPlan(input, opts = {}) {
    requireGM();
    // (a seed of its own unless given, so two imports never share a plan id, map names or a cache)
    const got = importAny(input, { seed: 1 + Math.floor(Math.random() * 999999), ...opts });
    if (!got.plan) throw new Error(`AtlasScribe: ${got.error}`);
    let plan = got.plan;
    // (checked before its image is saved, so a plan that can't be used leaves no file behind)
    const checked = api.checkPlan(plan);
    if (!checked.ok) throw new Error(`AtlasScribe: the imported plan has errors: ${checked.problems.filter((p) => p.level === "error").map((p) => p.message).join(" ")}`);
    if (got.image) {
      const bytes = Uint8Array.from(atob(got.image.base64), (c) => c.charCodeAt(0));
      const ext = got.image.type === "image/png" ? "png" : got.image.type === "image/jpeg" ? "jpg" : "webp";
      const dir = `${outputFolder()}/imports`;
      const path = await upload(dir, await freeName(dir, plan.id, ext), new Blob([bytes], { type: got.image.type }));
      const [W, H] = plan.size.squares;
      plan = { ...plan, underlay: { path, rect: got.image.rect ?? [0, 0, W, H], opacity: 0.6 } };
    }
    return { plan, notes: got.notes ?? [], from: got.from };
  },

  /**
   * A scene as a Universal VTT file, for other VTTs and map makers (GM only): its map image, walls, doors and lights.
   * scene: a scene, its id or name; download: true saves it as a .dd2vtt file. Returns the file's object.
   */
  async exportUVTT(scene, { download = false } = {}) {
    requireGM();
    const sc = typeof scene === "string" ? game.scenes.get(scene) ?? game.scenes.getName(scene) : scene;
    if (!sc) throw new Error("AtlasScribe: there's no such scene");
    const src = sc.getFlag(MOD, "image") ?? sc.levels?.contents?.[0]?.background?.src ?? sc.background?.src;
    if (!src) throw new Error(`AtlasScribe: "${sc.name}" has no map image to export`);
    const res = await fetch(src);
    if (!res.ok) throw new Error(`AtlasScribe: couldn't load "${sc.name}"'s map image (${res.status})`);
    // (as PNG, which every program that reads these files takes)
    const bmp = await createImageBitmap(await res.blob());
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    cv.getContext("2d").drawImage(bmp, 0, 0);
    bmp.close?.();
    const blob = await cv.convertToBlob({ type: "image/png" });
    // (as base64, read by the browser in one go: a big map's image is tens of megabytes)
    const base64 = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).replace(/^data:[^,]*,/, "")); fr.onerror = () => no(fr.error); fr.readAsDataURL(blob); });
    const ground = (sc.initialLevel ?? sc.levels?.contents?.[0])?.id ?? null;
    const onGround = (d) => !ground || !(d.levels?.size ?? d.levels?.length) || [...d.levels].includes(ground);
    const { sceneX, sceneY } = sc.dimensions;
    const pps = sc.grid.size, size = [Math.round(sc.dimensions.sceneWidth / pps), Math.round(sc.dimensions.sceneHeight / pps)];
    const out = toUVTT({
      size, pps, origin: [sceneX, sceneY], ftPerSquare: sc.grid.distance ?? 5, image: base64,
      // (the ground floor's only, the format having one; a secret door as the wall it looks like)
      walls: sc.walls.filter(onGround).map((w) => ({ c: w.c, door: w.door === CONST.WALL_DOOR_TYPES.SECRET ? 0 : w.door, sight: w.sight, move: w.move })),
      lights: sc.lights.filter(onGround).map((l) => ({ x: l.x, y: l.y, config: l.config })),
    });
    if (download) foundry.utils.saveDataToFile(JSON.stringify(out), "application/json", `${sc.name.replace(/[^\w .-]+/g, "_")}.dd2vtt`);
    return out;
  },

  /**
   * A plan laid out, with no painting (GM only): returns { layout, roles, notes }, roles the art roles its style needs
   * and notes the layout's own (what couldn't be placed, say).
   */
  async build(input) {
    requireGM();
    const { plan, error } = readPlan(input);
    if (!plan) throw new Error(`AtlasScribe: ${error}`);
    const checked = planOrThrow(plan);
    const { layout, roles } = await layOutAlone(checked.plan, "laying out");
    return { layout, roles, notes: layout.notes.map((n) => n.message) };
  },

  /**
   * The art a plan (or a list of roles) would be painted with (GM only): { art: { role: [url, ...] }, missing: [role],
   * notes, from: { folders, nexus } }. With FA Nexus active it may download what it needs, as a render would.
   */
  async art(input) {
    requireGM();
    const find = async (roles, check = () => {}) => { const { art, missing, notes, from } = await resolveArt(roles, () => {}, { check }); return { art, missing, notes, from }; };
    if (Array.isArray(input)) return exclusive((check) => find(input.filter((r) => typeof r === "string"), check));
    const { plan, error } = readPlan(input);
    if (!plan) throw new Error(`AtlasScribe: ${error}`);
    return layOutAlone(planOrThrow(plan).plan, "finding the art for", ({ roles }, check) => find(roles, check));
  },

  /**
   * Towns, villages, castles, ruins, roads and bridges placed on an overland plan's land, in place of the generator's
   * own the GM hasn't changed (moved, renamed or otherwise edited ones are kept). options: { seed (a new one moves
   * them), density: few, some or many (the plan's land.towns when left out) }. Returns { plan, added, removed, notes }.
   */
  async placeTowns(input, { seed = 1 + Math.floor(Math.random() * 2147483645), density = null } = {}) {
    requireGM();
    const { plan, error } = readPlan(input);
    if (!plan) throw new Error(`AtlasScribe: ${error}`);
    if (plan.kind !== "region" || !plan.land || typeof plan.land !== "object") throw new Error("AtlasScribe: towns and roads are placed on an overland map (a region plan with land)");
    planOrThrow(plan);
    return exclusive(() => worker.run("placeTowns", { plan, seed, density }));
  },

  /**
   * Realms on an overland plan's land, ruled from its cities and towns, in place of the generator's own the GM hasn't
   * changed (renamed, recolored or moved ones are kept). options: { seed (a new one moves them), count: few, some or
   * many (the plan's land.realms when left out; none takes the generator's away) }. Returns { plan, added, removed,
   * notes }.
   */
  async placeRealms(input, { seed = 1 + Math.floor(Math.random() * 2147483645), count = null } = {}) {
    requireGM();
    const { plan, error } = readPlan(input);
    if (!plan) throw new Error(`AtlasScribe: ${error}`);
    if (plan.kind !== "region" || !plan.land || typeof plan.land !== "object") throw new Error("AtlasScribe: realms are placed on an overland map (a region plan with land)");
    planOrThrow(plan);
    return exclusive(() => worker.run("placeRealms", { plan, seed, count }));
  },

  /**
   * Keeps an overland plan's land (Keep This Land): its heights saved under the output folder's lands/ folder (a JSON file
   * holding the PNG),
   * so later versions of AtlasScribe never move its coasts, ranges or rivers. Returns { plan (with land.keep), path }.
   */
  async keepLand(input) {
    requireGM();
    const { plan, error } = readPlan(input);
    if (!plan) throw new Error(`AtlasScribe: ${error}`);
    if (plan.kind !== "region" || !plan.land || typeof plan.land !== "object") throw new Error("AtlasScribe: only an overland map (a region plan with land) has a land to keep");
    if (plan.land.keep) throw new Error("AtlasScribe: this land is already kept (Forget the Kept Land first)");
    planOrThrow(plan);
    const res = await exclusive(() => worker.run("keepLand", { plan }));
    const base = `${outputFolder()}/lands`;
    const dir = `${base}/${await freeDir(base, plan.id ?? plan.name ?? "land")}`;
    // (as JSON holding the PNG: Foundry turns an uploaded PNG into WebP, which loses the 16-bit heights and the node block)
    const path = await upload(dir, "land.json", new Blob([JSON.stringify({ atlasScribe: "kept-land", version: 1, gen: res.keep.gen, png: toDataUrl(res.bytes) })], { type: "application/json" }));
    // (its seed written in, so a new plan seed later can't move the land the file was made from)
    const seed = landSeedOf(plan);
    return { plan: { ...plan, land: { ...plan.land, seed, keep: { path, ...res.keep } } }, path };
  },

  /** The world's name sets (a GM's own naming rules for overland maps): [{ id, name, text }]. */
  nameSets() {
    requireGM();
    return storedNameSets();
  },

  /** Reads a name set's text: { ok, problems, samples: { places, features } } (samples only when it makes names). */
  checkNameSet(text) {
    const { set, problems } = parseNameSet(text);
    return { ok: !!set && !problems.some((p) => p.level === "error"), problems, samples: set ? sampleNames(set, namer, 1) : null };
  },

  /** Saves a name set to the world's library ({ id?, text }; its name comes from its name: line). Returns its id. */
  async saveNameSet({ id = null, text } = {}) {
    requireGM();
    const { set, problems } = parseNameSet(text);
    if (!set) throw new Error(`AtlasScribe: the name set makes no names: ${problems.map((p) => p.message).join(" ")}`);
    if (id !== null && (typeof id !== "string" || !id.trim())) throw new Error("AtlasScribe: a name set's id is a string (leave it out for a new set)");
    const list = storedNameSets(), sid = id ?? foundry.utils.randomID(), item = { id: sid, name: set.name ?? "Name Set", text };
    const k = list.findIndex((s) => s.id === sid);
    if (k >= 0) list[k] = item; else list.push(item);
    await saveNameSets(list);
    return sid;
  },

  /** Takes a name set out of the world's library (maps keep their own copies). */
  async deleteNameSet(id) {
    requireGM();
    await saveNameSets(storedNameSets().filter((s) => s.id !== id));
  },

  /**
   * An overland plan with a name set of the library (by id or name) or given as { name, text } copied into it; with
   * rename, the names it kept (Keep the Names) are made again by the set. Returns the plan.
   */
  useNameSet(input, set, { rename = false } = {}) {
    requireGM();
    const { plan, error } = readPlan(input);
    if (!plan) throw new Error(`AtlasScribe: ${error}`);
    const lib = typeof set === "string" ? storedNameSets().find((s) => s.id === set || s.name === set) : null;
    if (typeof set === "string" && !lib) throw new Error(`AtlasScribe: the library has no name set "${set}"`);
    const use = lib ? { name: lib.name, text: lib.text, from: lib.id } : set;
    const bad = parseNameSet(use?.text ?? "").problems.find((p) => p.level === "error");
    if (bad) throw new Error(`AtlasScribe: that name set can't name a map: ${bad.message}`);
    const res = withNameSet(plan, use, { rename });
    if (res.error) throw new Error(`AtlasScribe: ${res.error}`);
    return res.plan;
  },

  /** Opens the Name Sets window. */
  async openNameSets() {
    requireGM();
    return nameSetsWindow.open();
  },

  /** The names an overland plan's map makes, kept in the plan so they stay when the land is made again. Returns { plan, places, features }. */
  async keepNames(input) {
    requireGM();
    const { plan, error } = readPlan(input);
    if (!plan) throw new Error(`AtlasScribe: ${error}`);
    if (plan.kind !== "region" || !plan.land || typeof plan.land !== "object") throw new Error("AtlasScribe: names are kept on an overland map (a region plan with land)");
    planOrThrow(plan);
    return exclusive(() => worker.run("keepNames", { plan }));
  },

  /**
   * The "as built" summary of a plan, or of the plan a scene was made from ({ scene: id or name }), in Markdown: its
   * size, districts and what each holds, roads, water, walls, squares, parks and landmarks (GM only).
   */
  async summary(input) {
    requireGM();
    let plan = null, sceneName = null;
    if (input && typeof input === "object" && "scene" in input && !input.features) {
      const sc = game.scenes.get(input.scene) ?? game.scenes.getName(input.scene);
      const id = sc?.getFlag(MOD, "plan");
      if (!id) throw new Error(`AtlasScribe: "${input.scene}" isn't a scene AtlasScribe made`);
      plan = await loadPlan(`${plansDir()}/${fileFor(id)}`).catch(() => {
        throw new Error(`AtlasScribe: the plan ${fileFor(id)} that "${sc.name}" was made from isn't in ${plansDir()}`);
      });
      sceneName = sc.name;
    } else {
      const read = readPlan(input);
      if (!read.plan) throw new Error(`AtlasScribe: ${read.error}`);
      plan = read.plan;
    }
    const checked = planOrThrow(plan);
    return layOutAlone(checked.plan, "summing up", ({ layout }) => asBuilt(normalize(plan), layout, { scene: sceneName }));
  },

  /**
   * A picture of a scene without viewing it (foundry/snapshot.mjs): its background, tiles and tokens under its
   * darkness and lights as AtlasScribe draws them (close to Foundry's lighting, not the same). scene: a scene, its id
   * or its name. side: the longest side in pixels (default SNAPSHOT.side); tokens, lighting: whether they're drawn;
   * save: false returns the picture as a data URL instead of saving it to <output>/snapshots. GM only. Returns
   * { path or url, width, height }.
   */
  async snapshot(scene, { side = SNAPSHOT.side, tokens = true, lighting = true, save = true } = {}) {
    requireGM();
    const sc = typeof scene === "string" ? game.scenes.get(scene) ?? game.scenes.getName(scene) : scene;
    if (!sc?.dimensions) throw new Error(`AtlasScribe: there's no scene ${typeof scene === "string" ? `"${scene}"` : "like that"}`);
    const { canvas, width, height } = await drawScene(sc, { side, tokens, lighting });
    try {
      if (!save) return { url: canvas.toDataURL("image/webp", 0.85), width, height };
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.88));
      if (!blob) throw new Error("AtlasScribe: the snapshot couldn't be encoded");
      const dir = `${outputFolder()}/snapshots`;
      const path = await upload(dir, await freeName(dir, `${String(sc.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "scene"}-${stamp()}`, "webp"), blob);
      return { path, width, height };
    } finally { canvas.width = canvas.height = 1; }
  },

  /**
   * The plan a scene was made from (scene: a scene, its id or its name), as publishing kept it under the plan's id in
   * the plans folder. Throws when the scene isn't AtlasScribe's or its plan isn't there.
   */
  async planOf(scene) {
    requireGM();
    const sc = typeof scene === "string" ? game.scenes.get(scene) ?? game.scenes.getName(scene) : scene;
    const id = sc?.getFlag?.(MOD, "plan");
    if (!id) throw new Error(`AtlasScribe: ${sc ? `"${sc.name}" wasn't made by AtlasScribe from a plan with an id` : "there's no such scene"}`);
    return loadPlan(`${plansDir()}/${fileFor(id)}`).catch(() => {
      throw new Error(`AtlasScribe: the plan ${fileFor(id)} that "${sc.name}" was made from isn't in ${plansDir()}`);
    });
  },

  /**
   * Saves a plan in the plans folder, under its id unless file names another (GM only). The plan is checked first
   * and saved as given. Returns the saved file's path.
   */
  async savePlan(input, { file = null } = {}) {
    requireGM();
    const { plan } = planOrThrow(input);
    const raw = readPlan(input).plan ?? plan;
    return savePlan(plansDir(), raw, file ? fileFor(String(file).replace(/\.json$/i, "")) : fileFor(raw.id));
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
    return exclusive((check) => publishChecked(plan, image, { scene, force, raw: readPlan(input).plan ?? null }, check));
  }
};

/** The saved plans' folder, and (host, below) what the window asks of the module. */
const plansDir = () => `${outputFolder()}/plans`;
const host = {
  check: (input) => api.checkPlan(input),
  read: (input) => readPlan(input),
  importPlan: (input) => api.importPlan(input),
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
  openFiles: () => api.openFiles(),
  summary: (plan) => api.summary(plan),
  placeTowns: (plan, options) => api.placeTowns(plan, options),
  placeRealms: (plan, options) => api.placeRealms(plan, options),
  keepLand: (plan) => api.keepLand(plan),
  // (a layer view of the land: { blob, width, height }; not one of the jobs that hold AtlasScribe busy, so the window's
  // edits go on while it's made, and the worker takes it in turn)
  landView: (plan, options) => worker.run("landView", { plan: readPlan(plan).plan ?? plan, ...options }),
  layerViews: () => { try { return game.settings.get(MOD, "layerViews") === true; } catch { return false; } },
  keepNames: (plan) => api.keepNames(plan),
  nameSets: () => storedNameSets(),
  openNameSets: () => api.openNameSets(),
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

/** A setting's value, or dflt when it can't be read (before init, say). */
function setting(key, dflt) {
  try {
    return game.settings.get(MOD, key) ?? dflt;
  } catch {
    return dflt;
  }
}

/** The Largest image setting, in px (16384 when unset or unreadable: no map is split). */
function largestImage() {
  try {
    return Number(game.settings.get(MOD, "largestImage")) || 16384;
  } catch {
    return 16384;
  }
}

function theWindow() {
  theApp ??= new AtlasScribeApp({ run: runPreview, host });
  return theApp;
}

Hooks.once("init", () => {
  game.settings.register(MOD, "outputFolder", {
    name: "Output Folder",
    hint: "Where AtlasScribe saves plans, maps, thumbnails and scene backups, under the Data folder. Leave empty for this world's own atlas-scribe folder.",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });
  game.settings.register(MOD, "backupFolder", {
    name: "Backup Folder",
    hint: "Where scene backups go, under the Data folder. Leave empty for the backups folder in the output folder.",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });
  game.settings.register(MOD, "cacheFolder", {
    name: "Cache Folder",
    hint: "Where AtlasScribe keeps what it remembers between renders (what each plan's last map held, to say what changed). Leave empty for the cache folder in the output folder.",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });
  game.settings.register(MOD, "backups", {
    name: "Scene Backups",
    hint: "When AtlasScribe saves a copy of a scene before updating it. A scene it didn't make is always backed up first.",
    scope: "world",
    config: true,
    type: String,
    choices: { every: "Every Update", session: "First Update Each Session", never: "Never" },
    default: "every",
  });
  game.settings.register(MOD, "lastPlan", { scope: "client", config: false, type: String, default: "" });
  // (JSON: [{ source, path, bucket }]; empty until the GM sets a list, meaning FA Nexus's folder when it exists)
  game.settings.register(MOD, "artFolders", { scope: "world", config: false, type: String, default: "", onChange: () => { forgetFolders(); forgetUnloadable(); } });
  // (JSON: art chosen by hand, { role: { files, folders, px, all } }, and filename rules, [{ pattern, role, px }])
  // (the world's name sets: [{ id, name, text }], foundry/name-sets.mjs)
  game.settings.register(MOD, "nameSets", { scope: "world", config: false, type: String, default: "[]", onChange: () => { if (theApp?.rendered) theApp.render(); refreshNameSets(); } });
  game.settings.register(MOD, "artRoles", { scope: "world", config: false, type: String, default: "", onChange: () => { forgetChoices(); forgetUnloadable(); } });
  game.settings.register(MOD, "artRules", { scope: "world", config: false, type: String, default: "", onChange: () => { forgetChoices(); forgetUnloadable(); } });
  game.settings.registerMenu(MOD, "artMenu", {
    name: "Art",
    label: "Art",
    hint: "Where battle maps and the textured style get their art: folders on the server, art you choose, filename rules.",
    icon: "fa-solid fa-images",
    type: ArtMenu,
    restricted: true,
  });
  game.settings.register(MOD, "artNexus", {
    name: "Art From FA Nexus",
    hint: "Let AtlasScribe ask FA Nexus (when it's active) for the Forgotten Adventures files your art folders lack, downloading them as needed. Off: only your art folders are used.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(MOD, "artOrder", {
    name: "Art Order",
    hint: "When a folder's own art (its manifest or a filename rule) and a Forgotten Adventures file both fit a role, which is used. Art you chose by hand in the Art window always comes first.",
    scope: "world",
    config: true,
    type: String,
    choices: { yours: "Your Folders' Own Art First", fa: "Forgotten Adventures First" },
    default: "yours",
  });
  game.settings.register(MOD, "battleZoom", {
    name: "Battle Map Zoom",
    hint: "How big a battle map made from an area of a town map is drawn: true size, or bigger so there's room to fight. The Battle Map tool in the AtlasScribe window changes it too.",
    scope: "client",
    config: true,
    type: Number,
    choices: { 1: "True Size", 1.5: "1.5 Times True Size", 2: "2 Times True Size" },
    default: 2,
  });
  game.settings.register(MOD, "drawnLook", {
    name: "Drawn Battle Art",
    hint: "How a battle map draws what has no art: painted (shaded, in natural colors) or inked (pale colors with ink lines, like a town map).",
    scope: "world",
    config: true,
    type: String,
    choices: { painted: "Painted", inked: "Inked" },
    default: "painted",
  });
  game.settings.register(MOD, "drawnAll", {
    name: "Draw Whole Battle Maps",
    hint: "Draw every battle map entirely, even where art folders or FA Nexus have art, so the whole map has one look.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
  game.settings.register(MOD, "movableProps", {
    name: "Movable Props on Battle Maps",
    hint: "Place a battle map's carts, wagons, sledges, boats, barrels, crates, bedrolls and tents as tiles the GM can move, turn and resize, as furniture is, and its horses, mules and oxen as tokens (of a creature from your compendiums when one matches), instead of painting them into the map. A new map or an Update replaces them.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(MOD, "batchTag", {
    name: "Batch Tag",
    hint: "A word every scene, tile, wall, light and region AtlasScribe makes is marked with, so a script can find them (api.batch). Leave empty to mark each with its plan's id.",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });
  game.settings.register(MOD, "largestImage", {
    name: "Largest Image",
    hint: "A map wider or taller than this is also saved in parts, and its scene shows them as tiles: for graphics cards that can't show a big scene background.",
    scope: "world",
    config: true,
    type: Number,
    choices: { 16384: "16384 px (Most Graphics Cards)", 8192: "8192 px", 4096: "4096 px" },
    default: 16384,
  });
  game.settings.register(MOD, "layerViews", {
    name: "Layer Views",
    hint: "Adds a view switch over overland maps in the AtlasScribe window: the land's shading, uplift, rain, temperature, water flow, biomes, plates and where towns score best, to see how the generator made it.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => { for (const app of foundry.applications.instances.values()) if (app.id === MOD && app.rendered) app.render(); },
  });
  game.settings.register(MOD, "renderInWorker", {
    name: "Render in a Worker",
    hint: "Lay out and paint maps off Foundry's page, so it never freezes. Turn off only if maps fail to render in your browser; the page then pauses while a map is made.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });
  registerHeight();
  registerRulesSetting();
});

// "Open its plan" in the menu of a scene AtlasScribe made, for the GM
Hooks.on("getSceneContextOptions", (app, options) => {
  if (!game.user.isGM || !Array.isArray(options)) return;
  const sceneOf = (li) => game.scenes.get((li instanceof HTMLElement ? li : li?.[0])?.dataset?.entryId);
  options.push({
    name: "Open Its Plan in AtlasScribe",
    icon: `<i class="fa-solid fa-map"></i>`,
    condition: (li) => !!sceneOf(li)?.getFlag(MOD, "plan"),
    callback: (li) => api.openPlan(sceneOf(li)).catch((e) => note.error(e.message)),
  });
  options.push({
    name: "Export as Universal VTT",
    icon: `<i class="fa-solid fa-file-export"></i>`,
    condition: (li) => !!sceneOf(li)?.getFlag(MOD, "image"),
    callback: (li) => api.exportUVTT(sceneOf(li), { download: true }).catch((e) => note.error(e.message)),
  });
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
  button.dataset.tooltipText = "Make a map with Quick Start, change it on the map, and make it a scene";
  button.addEventListener("click", () => api.open().catch((e) => note.error(e.message)));
  (root.querySelector(".header-actions") ?? root.querySelector(".directory-header") ?? root).append(button);
});

Hooks.once("ready", () => {
  setUseHere((set) => theWindow().useNameSet(set));
  const module = game.modules.get(MOD);
  module.api = api;
  Hooks.callAll(`${MOD}.ready`, api);
});
