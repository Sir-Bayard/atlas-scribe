/**
 * Plans saved in the world: one JSON file per plan, named by its id, in <output folder>/plans. A plan is saved over
 * its own file (unlike maps, which are never written over), so Save keeps one file per plan.
 */
import { ensureDir } from "./files.mjs";
import { readPlan } from "../core/plan.mjs";
import { FP } from "./util.mjs";


/** A file name for a plan id: lowercase letters, digits, - and _. */
export const fileFor = (id) => `${String(id ?? "plan").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "plan"}.json`;

/** The saved plans: [{ path, file, name, id, size, season }], by name. Unreadable files are listed with an error. */
export async function listPlans(dir) {
  let listing;
  try {
    listing = await FP().browse("data", dir);
  } catch {
    return []; // no folder yet: nothing saved
  }
  const files = (listing.files ?? []).filter((f) => f.toLowerCase().endsWith(".json"));
  const out = await Promise.all(files.map(async (path) => {
    const file = decodeURIComponent(path.split("/").pop());
    try {
      const plan = await loadPlan(path);
      return { path, file, name: plan.name ?? plan.id ?? file, id: plan.id ?? null, size: plan.size?.squares ?? null, season: plan.season ?? null };
    } catch (e) {
      return { path, file, name: file, id: null, error: e.message };
    }
  }));
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** Reads a saved plan. Throws, in plain words, if it can't be read. */
export async function loadPlan(path) {
  const res = await fetch(`${new URL(path, window.location.href).href}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`AtlasScribe: couldn't load the plan ${path} (HTTP ${res.status})`);
  const { plan, error } = readPlan(await res.text());
  if (!plan) throw new Error(`AtlasScribe: ${path}: ${error}`);
  return plan;
}

/** True when a plan file of this name is already saved. */
export async function planExists(dir, file) {
  try {
    const listing = await FP().browse("data", dir);
    return (listing.files ?? []).some((f) => decodeURIComponent(f.split("/").pop()).toLowerCase() === file.toLowerCase());
  } catch {
    return false;
  }
}

/** Saves a plan as dir/<file> (over the file if it's there). Returns its path. */
export async function savePlan(dir, plan, file = fileFor(plan.id)) {
  await ensureDir(dir);
  const blob = new File([JSON.stringify(plan, null, 1)], file, { type: "application/json" });
  const res = await FP().upload("data", dir, blob, {}, { notify: false });
  if (!res?.path) throw new Error(`AtlasScribe: saving ${file} to ${dir} wasn't confirmed`);
  return res.path;
}
