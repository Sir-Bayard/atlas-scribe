/**
 * Uploading AtlasScribe's output. Foundry's upload fails silently into a folder that doesn't exist, so every
 * folder on the way is created first, and a file is never written over: a taken name gets a number added.
 */
const FP = () => foundry.applications.apps.FilePicker.implementation;

/** Creates a folder under the Data folder, and each folder above it, if they're missing. */
export async function ensureDir(path) {
  const parts = path.split("/").filter(Boolean);
  let at = "";
  for (const part of parts) {
    at = at ? `${at}/${part}` : part;
    try {
      await FP().browse("data", at);
    } catch {
      await FP().createDirectory("data", at, {});
    }
  }
  return at;
}

/** A free file name in a folder: name.ext, else name-2.ext, name-3.ext and so on. Lowercase, as Foundry stores it. */
export async function freeName(dir, base, ext) {
  const safe = String(base).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "map";
  await ensureDir(dir);
  const listing = await FP().browse("data", dir);
  const taken = new Set((listing.files ?? []).map((f) => decodeURIComponent(f.split("/").pop()).toLowerCase()));
  let name = `${safe}.${ext}`;
  for (let n = 2; taken.has(name); n++) name = `${safe}-${n}.${ext}`;
  return name;
}

/** A free folder name in a folder: name, else name-2, name-3 and so on (as freeName, for folders). */
export async function freeDir(dir, base) {
  const safe = String(base).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "folder";
  await ensureDir(dir);
  const listing = await FP().browse("data", dir);
  const taken = new Set((listing.dirs ?? []).map((f) => decodeURIComponent(f.split("/").pop()).toLowerCase()));
  let name = safe;
  for (let n = 2; taken.has(name); n++) name = `${safe}-${n}`;
  return name;
}

/**
 * Uploads a Blob to dir/name and returns its path. Throws if Foundry doesn't confirm the upload. ready: the folder is
 * known to be there (made by ensureDir just before), so it isn't looked for again.
 */
export async function upload(dir, name, blob, { ready = false } = {}) {
  if (!ready) await ensureDir(dir);
  const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
  const res = await FP().upload("data", dir, file, {}, { notify: false });
  const path = res?.path;
  if (!path) throw new Error(`AtlasScribe: the upload of ${name} to ${dir} wasn't confirmed`);
  return path;
}
