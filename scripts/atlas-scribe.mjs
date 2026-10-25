/**
 * AtlasScribe: a map plan in, a map out.
 * The entry point: settings and the API at game.modules.get("atlas-scribe").api. Everything that changes the
 * world is GM only. One job runs at a time; cancel() stops it between any two steps (and mid-paint).
 */
import { WorkerClient } from "./foundry/worker-client.mjs";
import { upload, freeName } from "./foundry/files.mjs";
import { progressBar } from "./foundry/progress.mjs";
import { readPlan, normalize } from "./core/plan.mjs";
import { checkPlan } from "./core/check.mjs";
import { rerollPlan, setLocked } from "./core/seeds.mjs";
import { resolveArt } from "./foundry/art/index.mjs";
import { publish } from "./foundry/publish.mjs";
import { AtlasScribeApp } from "./foundry/preview.mjs";
import { listPlans, loadPlan, savePlan, planExists, fileFor } from "./foundry/plans.mjs";
import { quickPlan, QUICK, QUICK_LABELS } from "./core/quick.mjs";

const MOD = "atlas-scribe";
const worker = new WorkerClient();

/** The job running now: { cancelled }, or null. */
let job = null;

/** The AtlasScribe window: one for the session, kept when closed so its plan and undo history are there next time. */
let theApp = null;
/** The longer side of the preview picture, in pixels. */
let previewPx = 1600;

/** The folder AtlasScribe writes into: the setting, or this world's own atlas-scribe folder. */
function outputFolder() {
  const set = String(game.settings.get(MOD, "outputFolder") ?? "").trim().replace(/^\/+|\/+$/g, "");
  return set || `worlds/${game.world.id}/${MOD}`;
}

function requireGM() {
  if (!game.user.isGM) throw new Error("AtlasScribe: only a GM can do that");
}

function cancelledError() {
  const e = new Error("AtlasScribe: cancelled");
  e.cancelled = true;
  return e;
}

/** Runs fn(check) as the one job; check() throws once the job has been cancelled. */
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

/** { path, width, height, thumb? } for an image: from render's result, or measured from its file. */
async function imageInfo(image) {
  if (image && typeof image === "object" && image.path && image.width && image.height)
    return { path: image.path, width: image.width, height: image.height, thumb: image.thumb ?? null };
  const path = typeof image === "string" ? image : image?.path;
  if (!path) throw new Error("AtlasScribe: publish needs the map image (render's result, or its path)");
  const res = await fetch(new URL(path, window.location.href));
  if (!res.ok) throw new Error(`AtlasScribe: couldn't load the map image ${path}`);
  const bmp = await createImageBitmap(await res.blob());
  const info = { path, width: bmp.width, height: bmp.height, thumb: null };
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
    const res = await publish({ plan, image: img, width: img.width, height: img.height, folder: outputFolder(), sceneId: scene, force, check, onProgress: (p, l) => bar.update(p, l) });
    bar.done(`${title}: ${res.created ? "created the scene" : "updated the scene"}${res.backup ? ` (backup: ${res.backup})` : ""}`);
    return res;
  } catch (e) {
    bar.done(e.cancelled ? `${title}: cancelled` : `${title}: failed (${e.message})`);
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

  /** Stops the running job at its next step (a paint stops at once). Returns true if there was one to stop. */
  cancel() {
    if (!job) return worker.cancel();
    job.cancelled = true;
    worker.cancel();
    return true;
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
   * Rerolls districts and areas: a copy of the plan with new seeds for the ids given (one id or a list), or for every
   * district and area that isn't locked when ids is left out. Locked features, the plan's own seed and everything
   * else stay as they are, and each rerolled one changes alone. Doesn't render: pass the plan to render.
   * Returns { plan, rerolled: [id], skipped: [{ id, why }] }.
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
   * A quick look at a plan: lays it out and draws it in plain colours (no art) in a window, in a second or so, with
   * its districts and areas outlined. Reroll, lock and undo there, then take the plan the window has made with Copy
   * plan or from the window's plan property. Only one preview window is open at a time: a second call shows the new
   * plan in it. px: the longer side of the picture, in pixels. Returns the window; if the plan can't be drawn (another
   * job is running, say) the window says why.
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
   * Quick Start without the window: a plan from { size, season, water, roads, centre, surroundings, name, seed }
   * (any left out is picked from the seed). Returns { plan, choices }. The choices are listed in api.quickChoices.
   */
  quickPlan(options = {}) {
    return quickPlan(options);
  },

  /** Quick Start's choices: { size: [...], season: [...], water, roads, centre, surroundings }. */
  get quickChoices() {
    return structuredClone(QUICK);
  },

  /**
   * Renders a plan into an image, in the worker, and saves it to <output>/maps (never over an existing file).
   * Steps: check the plan (errors stop it), lay it out, fetch the art its style needs (FA Nexus; roles with no art
   * are painted in plain colours and listed in missingArt), paint, save.
   * With publish: true the map is then published (see publish; scene and force as there). If publishing fails,
   * the error carries the saved map's result as error.result.
   * Returns { path, width, height, tiles, ms, layout, missingArt, notes, artNotes, warnings }, and scene when
   * published.
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
        const { art, missing, notes } = await resolveArt(roles, (p, l) => bar.update(0.05 + 0.15 * p, l));
        check();
        const img = await worker.run("paint", { layout, art, quality: plan.output.quality }, { onProgress: (p, l) => bar.update(0.2 + 0.75 * p, l) });
        check();
        let path = null;
        if (save) {
          bar.update(0.97, "Saving");
          const dir = `${outputFolder()}/maps`;
          path = await upload(dir, await freeName(dir, plan.id ?? "map", "webp"), img.blob);
        }
        const ms = Math.round(performance.now() - t0);
        bar.done(`${title}: done in ${Math.round(ms / 1000)} s${path ? `, saved to ${path}` : ""}`);
        result = {
          path, width: img.width, height: img.height, tiles: img.tiles, ms, layout,
          missingArt: [...new Set([...missing, ...(img.failedArt ?? [])])],
          notes: [...layout.notes.map((n) => n.message), ...notes],
          artNotes: notes, // why art is missing (FA Nexus not active, say)
          warnings: checked.problems.filter((p) => p.level === "warning").map((p) => p.message),
        };
        Object.defineProperty(result, "thumb", { value: img.thumb ?? null, enumerable: false }); // for publish
      } catch (e) {
        bar.done(e.cancelled ? `${title}: cancelled` : `${title}: failed (${e.message})`);
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
   * Makes a rendered map into a scene: the image as its background, the grid and settings from the plan's
   * output.scene, a thumbnail, and the plan's labels as locked text drawings (hidden from players unless show is
   * "all"). image: the result of render, or a path. scene: the id of a scene to update instead of creating one.
   * AtlasScribe only updates scenes it made, unless force is true; all of the scene is backed up to
   * <output>/backups first, its name is kept, and only the labels an earlier publish of this plan added are
   * replaced. Returns { sceneId, created, backup, thumb, labels, warnings }.
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
        bar.done(e.cancelled ? "AtlasScribe test: cancelled" : `AtlasScribe test: failed (${e.message})`);
        throw e;
      }
    });
  },
};

/** What the window asks of the module. */
const plansDir = () => `${outputFolder()}/plans`;
const host = {
  check: (input) => api.checkPlan(input),
  read: (input) => readPlan(input),
  quick: (options) => quickPlan(options),
  quickChoices: { QUICK, LABELS: QUICK_LABELS },
  folder: plansDir,
  plans: {
    list: () => listPlans(plansDir()),
    load: (path) => loadPlan(path),
    save: (plan, file) => savePlan(plansDir(), plan, file),
    exists: (file) => planExists(plansDir(), file),
    fileFor,
  },
  publish: (plan, { scene = null } = {}) => api.render(plan, { publish: true, scene }),
  cancel: () => api.cancel(),
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
    hint: "Where AtlasScribe saves maps, thumbnails and scene backups, under the Data folder. Leave empty for this world's own atlas-scribe folder.",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });
  game.settings.register(MOD, "lastPlan", { scope: "client", config: false, type: String, default: "" });
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
  button.dataset.tooltip = "Make a map: Quick Start, preview, reroll, and make it a scene";
  button.addEventListener("click", () => api.open().catch((e) => ui.notifications.error(e.message)));
  (root.querySelector(".header-actions") ?? root.querySelector(".directory-header") ?? root).append(button);
});

Hooks.once("ready", () => {
  const module = game.modules.get(MOD);
  module.api = api;
  Hooks.callAll(`${MOD}.ready`, api);
});
