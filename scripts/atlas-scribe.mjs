/**
 * AtlasScribe: a map plan in, a map out.
 * The entry point: settings and the API at game.modules.get("atlas-scribe").api. Everything that changes the
 * world is GM only.
 */
import { WorkerClient } from "./foundry/worker-client.mjs";
import { upload, freeName } from "./foundry/files.mjs";
import { progressBar } from "./foundry/progress.mjs";
import { readPlan, normalize } from "./core/plan.mjs";
import { checkPlan } from "./core/check.mjs";
import { resolveArt } from "./foundry/art/index.mjs";

const MOD = "atlas-scribe";
const worker = new WorkerClient();

/** The folder AtlasScribe writes into: the setting, or this world's own atlas-scribe folder. */
function outputFolder() {
  const set = String(game.settings.get(MOD, "outputFolder") ?? "").trim().replace(/^\/+|\/+$/g, "");
  return set || `worlds/${game.world.id}/${MOD}`;
}

function requireGM() {
  if (!game.user.isGM) throw new Error("AtlasScribe: only a GM can do that");
}

const api = {
  get version() {
    return game.modules.get(MOD)?.version ?? null;
  },

  /** True while the worker is busy. */
  get busy() {
    return worker.busy;
  },

  /** Stops the running job. */
  cancel: () => worker.cancel(),

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
   * Renders a plan into an image, in the worker, and saves it to <output>/maps (never over an existing file).
   * Steps: check the plan (errors stop it), lay it out, fetch the art its style needs (FA Nexus; roles with no art
   * are painted in plain colours and listed in missingArt), paint, save.
   * Returns { path, width, height, tiles, ms, layout, missingArt, notes, warnings }.
   */
  async render(input, { save = true } = {}) {
    requireGM();
    const checked = api.checkPlan(input);
    if (!checked.ok) {
      const errors = checked.problems.filter((p) => p.level === "error").map((p) => p.message);
      throw new Error(`AtlasScribe: the plan has ${errors.length} error(s): ${errors.join(" ")}`);
    }
    const plan = checked.plan;
    const title = `AtlasScribe: ${plan.name ?? plan.id ?? "map"}`;
    const bar = progressBar(title);
    const t0 = performance.now();
    try {
      const { layout, roles } = await worker.run("layout", { plan }, { onProgress: (p, l) => bar.update(0.05 * p, l) });
      const { art, missing, notes } = await resolveArt(roles, (p, l) => bar.update(0.05 + 0.15 * p, l));
      const img = await worker.run("paint", { layout, art, quality: plan.output.quality }, { onProgress: (p, l) => bar.update(0.2 + 0.75 * p, l) });
      let path = null;
      if (save) {
        bar.update(0.97, "Uploading");
        const dir = `${outputFolder()}/maps`;
        path = await upload(dir, await freeName(dir, plan.id ?? "map", "webp"), img.blob);
      }
      const ms = Math.round(performance.now() - t0);
      bar.done(`${title}: done in ${Math.round(ms / 1000)} s${path ? `, saved to ${path}` : ""}`);
      return {
        path, width: img.width, height: img.height, tiles: img.tiles, ms, layout, missingArt: missing,
        notes: [...layout.notes.map((n) => n.message), ...notes],
        warnings: checked.problems.filter((p) => p.level === "warning").map((p) => p.message),
      };
    } catch (e) {
      bar.done(e.cancelled ? `${title}: cancelled` : `${title}: failed (${e.message})`);
      throw e;
    }
  },

  /**
   * Paints a test pattern in the worker and uploads it to <output>/tests. Proves the whole pipeline: the worker,
   * image loading (texture: an image path to tile), soft masks, progress, WebP output and the upload.
   * Returns { path, width, height, ms, bytes }.
   */
  async test({ width = 2048, height = 2048, texture = null, seed = 1 } = {}) {
    requireGM();
    const bar = progressBar("AtlasScribe test");
    const textureUrl = texture ? new URL(texture, window.location.href).href : null;
    const res = await worker.run("test", { width, height, texture: textureUrl, seed }, { onProgress: (p, l) => bar.update(p, l) });
    bar.update(0.95, "Uploading");
    const dir = `${outputFolder()}/tests`;
    const path = await upload(dir, await freeName(dir, "atlas-scribe-test", "webp"), res.blob);
    bar.done(`AtlasScribe test saved: ${path}`);
    return { path, width: res.width, height: res.height, ms: res.ms, bytes: res.blob.size };
  },
};

Hooks.once("init", () => {
  game.settings.register(MOD, "outputFolder", {
    name: "Output folder",
    hint: "Where AtlasScribe saves maps, plans and backups, under the Data folder. Leave empty for this world's own atlas-scribe folder.",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });
});

Hooks.once("ready", () => {
  const module = game.modules.get(MOD);
  module.api = api;
  Hooks.callAll(`${MOD}.ready`, api);
});
