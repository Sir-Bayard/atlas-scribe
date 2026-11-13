/**
 * The art folders provider: art in folders on the server, from any file source Foundry can browse. A folder's
 * manifest (atlas-scribe.json) names which of its images fill which roles; any image is also found by its file name,
 * so Forgotten Adventures files in a folder fill the FA role map with no FA Nexus.
 */
import { safeMessage } from "./fa-nexus.mjs";

const MOD = "atlas-scribe";
export const MANIFEST = "atlas-scribe.json";
const IMAGE = /\.(webp|png|jpe?g|avif)$/i;
/** A folder tree past these is read no further (a whole Data folder, say), with a note. */
const MOST_DIRS = 20000, MOST_FILES = 300000;
/** Folders browsed at once while reading. */
const AT_ONCE = 6;
/** The art scale every style paints at: Forgotten Adventures' 200 px a square. */
export const ART_PX = 200;
/** The pixels a square a manifest may give (smaller or bigger art is too far from 200 to resize). */
const GRID_PX = [20, 2000];

const FP = () => foundry.applications.apps.FilePicker.implementation;
// The index read this session, the read under way, and a count forget() bumps so a read begun before it isn't kept
let index = null, pending = null, generation = 0;

/** Forgets the folders read earlier, so the next render reads them again. */
export function forget() {
  index = null;
  pending = null;
  generation++;
}

/** FA Nexus's download folder (its own setting, else its default name), looked in by default when it exists. */
export function nexusFolder() {
  let path = "fa-nexus-assets";
  try {
    path = game.settings.get("fa-nexus", "cloudDownloadDirAssets") || path;
  } catch {
    /* FA Nexus isn't installed */
  }
  return folderOf({ source: "data", path });
}

/** A folder as stored: { source, path, bucket? }, path without slashes at either end. */
export function folderOf(f) {
  const path = String(f?.path ?? "").trim().replace(/^\/+|\/+$/g, "");
  const out = { source: String(f?.source || "data"), path };
  if (f?.bucket) out.bucket = String(f.bucket);
  return out;
}

export const folderKey = (f) => `${f.source}:${f.bucket ? `${f.bucket}:` : ""}${f.path}`;

/** The GM's list of folders (the world setting artFolders, JSON), or null until one is set. */
export function storedFolders() {
  let raw = "";
  try {
    raw = game.settings.get(MOD, "artFolders");
  } catch {
    return null; // not registered (tests)
  }
  if (!raw) return null;
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.map(folderOf) : null;
  } catch {
    return null;
  }
}

/** The folders to look in: the GM's list, or, until the GM sets one, FA Nexus's download folder when it exists. */
export async function foldersToUse() {
  const set = storedFolders();
  if (set) return set;
  const nexus = nexusFolder();
  try {
    await FP().browse(nexus.source, nexus.path);
    return [nexus];
  } catch {
    return [];
  }
}

/** A path as one key for matching: decoded and lowercased. */
const keyOf = (p) => {
  let s = String(p);
  try {
    s = decodeURIComponent(s);
  } catch {
    /* already plain */
  }
  return s.toLowerCase();
};
const nameOf = (p) => keyOf(p).split("/").pop();
const stemOf = (name) => name.replace(/\.\w+$/, "");

/**
 * Every image and manifest under a folder, sorted by path so the same files always win a name: { files, manifests,
 * dirs, cut, errors }. A subfolder that can't be read is skipped and listed; the folder itself failing throws.
 */
async function walk(folder, budget, progress) {
  const opts = folder.bucket ? { bucket: folder.bucket } : {};
  const files = [], manifests = [], errors = [];
  let dirs = 0, cut = false;
  const queue = [folder.path];
  const one = async (dir, top) => {
    let r;
    try {
      r = await FP().browse(folder.source, dir, opts);
    } catch (e) {
      if (top) throw e;
      errors.push(`${keyOf(dir)} couldn't be read (${safeMessage(e)})`);
      return;
    }
    dirs++;
    if (dirs % 50 === 0) progress(`Reading art folders (${dirs.toLocaleString()} folders)`);
    for (const f of r.files ?? []) {
      const n = nameOf(f);
      if (n === MANIFEST) manifests.push(f);
      else if (IMAGE.test(n)) { files.push(f); budget.files--; }
    }
    queue.push(...(r.dirs ?? []));
  };
  budget.dirs--;
  await one(queue.shift(), true);
  while (queue.length) {
    if (budget.dirs <= 0 || budget.files <= 0) { cut = true; break; }
    const batch = queue.splice(0, Math.min(AT_ONCE, budget.dirs));
    budget.dirs -= batch.length;
    await Promise.all(batch.map((d) => one(d, false)));
  }
  const byKey = (a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0);
  const sorted = (list) => list.map((f) => ({ f, k: keyOf(f) })).sort(byKey);
  return { files: sorted(files), manifests: sorted(manifests), dirs, cut, errors };
}

/**
 * A manifest's roles turned into file paths: { role: { paths, px } }. An entry is a path from the manifest's folder:
 * a file, a file name with * in it, or a folder ending in / (every image under it; "./" for all of them). files:
 * [{ f: path, k: keyOf(path) }].
 */
export function readManifest(json, dir, files) {
  const base = keyOf(String(dir ?? "").replace(/\/+$/, ""));
  const given = Number(json?.gridPx);
  const px = given > 0 ? Math.min(GRID_PX[1], Math.max(GRID_PX[0], given)) : ART_PX;
  const rel = files.map((x) => (typeof x === "string" ? { f: x, k: keyOf(x) } : x)).filter(({ k }) => !base || k.startsWith(`${base}/`)).map(({ f, k }) => ({ f, r: base ? k.slice(base.length + 1) : k }));
  const out = {};
  for (const [role, entries] of Object.entries(json?.roles ?? {})) {
    const list = Array.isArray(entries) ? entries : [entries];
    const paths = [];
    for (const e of list) {
      if (typeof e !== "string" || !e.trim()) continue;
      const want = keyOf(e.trim().replace(/^\.?\/+/, ""));
      let hit;
      if (!want) hit = rel;
      else if (want.endsWith("/")) hit = rel.filter(({ r }) => r.startsWith(want));
      else if (want.includes("*")) {
        const re = new RegExp(`^${want.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}$`);
        hit = rel.filter(({ r }) => re.test(r));
      } else {
        hit = rel.filter(({ r }) => r === want);
        // (the same file under another image type: Foundry can save an upload as WebP)
        if (!hit.length) hit = rel.filter(({ r }) => stemOf(r) === stemOf(want)).sort((a, b) => a.r.localeCompare(b.r)).slice(0, 1);
      }
      for (const { f } of [...hit].sort((a, b) => a.r.localeCompare(b.r))) if (!paths.includes(f)) paths.push(f);
    }
    if (paths.length) out[role] = { paths, px };
  }
  return out;
}

/**
 * The folders read (once a session, until forget()): { byName, byStem, roles, folders: [{ folder, files, dirs,
 * manifests, roles, cut, error, errors }] }. The first folder in the list wins a file name or a role two folders
 * both have; within a folder, a manifest nearer its top wins. progress(label) while reading.
 */
export function folderIndex(progress = () => {}) {
  if (index) return Promise.resolve(index);
  if (pending) return pending;
  const g = generation;
  const p = readAll(progress).then((idx) => {
    if (g === generation) { index = idx; pending = null; }
    return idx;
  }, (e) => {
    if (g === generation) pending = null;
    throw e;
  });
  pending = p;
  return p;
}

async function readAll(progress) {
  const byName = new Map(), byStem = new Map(), roles = new Map(), report = [];
  const budget = { dirs: MOST_DIRS, files: MOST_FILES };
  for (const folder of await foldersToUse()) {
    const row = { folder, files: 0, dirs: 0, manifests: 0, roles: 0, cut: false, error: null, errors: [] };
    report.push(row);
    if (budget.dirs <= 0 || budget.files <= 0) { row.cut = true; continue; }
    try {
      const { files, manifests, dirs, cut, errors } = await walk(folder, budget, progress);
      Object.assign(row, { files: files.length, dirs, cut, errors });
      for (const { f, k } of files) {
        const n = k.split("/").pop();
        if (!byName.has(n)) byName.set(n, f);
        const s = stemOf(n);
        if (!byStem.has(s)) byStem.set(s, f);
      }
      const depth = (x) => x.k.split("/").length;
      for (const { f: file, k } of [...manifests].sort((a, b) => depth(a) - depth(b) || (a.k < b.k ? -1 : 1))) {
        const slash = String(file).lastIndexOf("/");
        const dir = slash < 0 ? "" : String(file).slice(0, slash);
        try {
          const res = await fetch(file, { cache: "no-cache" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const found = readManifest(await res.json(), dir, files);
          row.manifests++;
          for (const [role, v] of Object.entries(found)) {
            if (!roles.has(role)) { roles.set(role, v); row.roles++; }
          }
        } catch (e) {
          row.errors.push(`${k} couldn't be read (${safeMessage(e)})`);
        }
      }
    } catch (e) {
      row.error = `couldn't be read (${safeMessage(e)})`;
    }
  }
  return { byName, byStem, roles, folders: report };
}

/** A file named in the FA role map, found in the folders: the exact name, else the same name with another type. */
export function findFile(idx, name) {
  const n = String(name).toLowerCase();
  return idx.byName.get(n) ?? idx.byStem.get(stemOf(n)) ?? null;
}
