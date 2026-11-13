/**
 * The art folders provider: art in folders on the server, from any file source Foundry can browse. A folder's
 * manifest (atlas-scribe.json) names which of its images fill which roles; any image is also found by its file name,
 * so Forgotten Adventures files in a folder fill the FA role map with no FA Nexus.
 */
import { safeMessage, faRoleMap } from "./fa-nexus.mjs";
import { roleChain } from "../../core/roles.mjs";

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

/** At most this many variants for a role from a rule, a folder chosen by hand or a manifest (each is a full image). */
export const MOST_VARIANTS = 32;

const FP = () => foundry.applications.apps.FilePicker.implementation;
// The folders read this session, the read under way, and a count forget() bumps so a read begun before it isn't kept;
// the same for what's built from them and the GM's choices (rules and art chosen by hand), which forgetChoices()
// clears alone; and the folders chosen by hand, read once each
let base = null, pending = null, generation = 0;
let choices = null, choicesPending = null, choicesGeneration = 0;
const handWalks = new Map();

/** Forgets everything read, so the next render reads the folders again. */
export function forget() {
  base = null;
  pending = null;
  generation++;
  handWalks.clear();
  forgetChoices();
}

/** Forgets only what was built from the GM's rules and art chosen by hand (the folders aren't read again). */
export function forgetChoices() {
  choices = null;
  choicesPending = null;
  choicesGeneration++;
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

/** A world setting holding JSON, parsed; null when it's empty, unreadable or not registered. */
export function storedJSON(key) {
  let raw = "";
  try {
    raw = game.settings.get(MOD, key);
  } catch {
    return null; // not registered (tests)
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** The GM's list of folders (the world setting artFolders), or null until one is set. */
export function storedFolders() {
  const list = storedJSON("artFolders");
  return Array.isArray(list) ? list.map(folderOf) : null;
}

/**
 * Art the GM chose by hand (the world setting artRoles): { role: { files: [path], folders: [{ source, path,
 * bucket }], px, all } }. all: it also fills the role's more specific names (its seasons and kinds).
 */
export function storedRoles() {
  const o = storedJSON("artRoles");
  return o && typeof o === "object" && !Array.isArray(o) ? o : {};
}

/** A role name as matched: trimmed and lowercased. */
export const roleOf = (r) => String(r ?? "").trim().toLowerCase();

/** A test of whether AtlasScribe paints a role (one in the FA role map, a kind of one, or one with kinds there). */
async function rolesKnown() {
  const keys = Object.keys(await faRoleMap());
  if (!keys.length) return () => true; // (no role map to check against)
  const set = new Set(keys);
  return (r) => set.has(r) || roleChain(r).some((x) => set.has(x)) || keys.some((k) => k.startsWith(`${r}.`));
}

/** The GM's filename rules (the world setting artRules): [{ pattern, role, px }]. */
export function storedRules() {
  const list = storedJSON("artRules");
  return Array.isArray(list) ? list.filter((r) => r && typeof r.pattern === "string" && r.pattern.trim() && typeof r.role === "string" && r.role.trim()) : [];
}

/** A pixels-a-square value kept within what can be resized. */
export const gridPxOf = (v) => (Number(v) > 0 ? Math.min(GRID_PX[1], Math.max(GRID_PX[0], Number(v))) : ART_PX);

/** Whether text matches a pattern where * stands for any run of characters (no backtracking blow-up). */
export function globMatch(pat, text) {
  let p = 0, t = 0, star = -1, mark = 0;
  while (t < text.length) {
    if (p < pat.length && pat[p] !== "*" && pat[p] === text[t]) { p++; t++; }
    else if (p < pat.length && pat[p] === "*") { star = p++; mark = t; }
    else if (star >= 0) { p = star + 1; t = ++mark; }
    else return false;
  }
  while (p < pat.length && pat[p] === "*") p++;
  return p === pat.length;
}

/**
 * A filename rule's pattern as a test of a file ({ k: decoded lowercased path, r: its path inside its art folder }):
 * * matches anything. A pattern with no slash is tried on the file's name, one with a slash on its path inside the
 * art folder.
 */
export function ruleTest(pattern) {
  let p = String(pattern).trim().replace(/\\/g, "/");
  try {
    p = decodeURIComponent(p);
  } catch {
    /* plain text */
  }
  p = p.toLowerCase().replace(/^\/+/, "");
  return p.includes("/") ? (x) => globMatch(p, x.r ?? x.k) : (x) => globMatch(p, x.k.split("/").pop());
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
  // (r: the path inside the folder; a source's paths may be full web addresses, so the folder is found within them)
  const top = keyOf(folder.path);
  const bucket = folder.bucket ? keyOf(folder.bucket) : "";
  const inside = (k) => {
    let rest = k.replace(/^\w+:\/\/[^/]+\//, "");
    if (bucket && rest.startsWith(`${bucket}/`)) rest = rest.slice(bucket.length + 1);
    if (!top) return rest;
    if (rest.startsWith(`${top}/`)) return rest.slice(top.length + 1);
    const i = rest.indexOf(`/${top}/`);
    return i >= 0 ? rest.slice(i + top.length + 2) : rest;
  };
  const sorted = (list) => list.map((f) => { const k = keyOf(f); return { f, k, r: inside(k) }; }).sort(byKey);
  return { files: sorted(files), manifests: sorted(manifests), dirs, cut, errors };
}

/**
 * A manifest's roles turned into file paths: { role: { paths, px } }. An entry is a path from the manifest's folder:
 * a file, a file name with * in it, or a folder ending in / (every image under it; "./" for all of them). files:
 * [{ f: path, k: keyOf(path) }].
 */
export function readManifest(json, dir, files) {
  const base = keyOf(String(dir ?? "").replace(/\/+$/, ""));
  const px = gridPxOf(json?.gridPx);
  const rel = files.map((x) => (typeof x === "string" ? { f: x, k: keyOf(x) } : x)).filter(({ k }) => !base || k.startsWith(`${base}/`)).map(({ f, k }) => ({ f, r: base ? k.slice(base.length + 1) : k }));
  const out = {};
  for (const [name, entries] of Object.entries(json?.roles ?? {})) {
    const role = roleOf(name);
    if (!role) continue;
    const list = Array.isArray(entries) ? entries : [entries];
    const paths = [];
    for (const e of list) {
      if (typeof e !== "string" || !e.trim()) continue;
      const want = keyOf(e.trim().replace(/^\.?\/+/, ""));
      let hit;
      if (!want) hit = rel;
      else if (want.endsWith("/")) hit = rel.filter(({ r }) => r.startsWith(want));
      else if (want.includes("*")) {
        // (each piece of the path matched on its own, with no regular expression to blow up on many stars)
        const parts = want.split("/");
        hit = rel.filter(({ r }) => { const rp = r.split("/"); return rp.length === parts.length && parts.every((q, i) => globMatch(q, rp[i])); });
      } else {
        hit = rel.filter(({ r }) => r === want);
        // (the same file under another image type: Foundry can save an upload as WebP)
        if (!hit.length) hit = rel.filter(({ r }) => stemOf(r) === stemOf(want)).sort((a, b) => a.r.localeCompare(b.r)).slice(0, 1);
      }
      for (const { f } of [...hit].sort((a, b) => a.r.localeCompare(b.r))) if (!paths.includes(f)) paths.push(f);
    }
    if (paths.length && !out[role]) out[role] = { paths, px };
  }
  return out;
}

/**
 * The folders read (once a session, until forget()) and what's built from them: { byName, byStem, roles (from
 * manifests), rules (from filename rules), ruleMatches (files each rule matched), hand (art chosen by hand), notes
 * (about rules and art chosen by hand), folders: [{ folder, files, dirs, manifests, roles, cut, error, errors }] }.
 * The first folder in the list wins a file name or a role two folders both have; within a folder, a manifest nearer
 * its top wins. progress(label) while reading.
 */
export async function folderIndex(progress = () => {}) {
  const b = await baseIndex(progress);
  // (what's built is kept only with the read it was built from)
  if (choices?.base === b) return { ...b, ...choices.built };
  if (choicesPending?.base !== b) {
    const g = choicesGeneration;
    const p = buildChoices(b, progress).then((built) => {
      if (g === choicesGeneration && b === base) choices = { base: b, built };
      if (choicesPending?.promise === p) choicesPending = null;
      return built;
    }, (e) => {
      if (choicesPending?.promise === p) choicesPending = null;
      throw e;
    });
    choicesPending = { base: b, promise: p };
  }
  return { ...b, ...(await choicesPending.promise) };
}

function baseIndex(progress) {
  if (base) return Promise.resolve(base);
  if (pending) return pending;
  const g = generation;
  const p = readAll(progress).then((idx) => {
    if (g === generation) { base = idx; pending = null; }
    return idx;
  }, (e) => {
    if (g === generation) pending = null;
    throw e;
  });
  pending = p;
  return p;
}

/** A role's variants kept to MOST_VARIANTS, evenly spread through them, with a note when some are left out. */
function capped(paths, what, notes) {
  if (paths.length <= MOST_VARIANTS) return paths;
  notes.push(`${what}: ${paths.length} images; ${MOST_VARIANTS} of them, spread through the list, are used`);
  return Array.from({ length: MOST_VARIANTS }, (_, i) => paths[Math.floor((i * paths.length) / MOST_VARIANTS)]);
}

async function readAll(progress) {
  const byName = new Map(), byStem = new Map(), roles = new Map(), report = [], all = [];
  const budget = { dirs: MOST_DIRS, files: MOST_FILES }, seen = new Set();
  for (const folder of await foldersToUse()) {
    const row = { folder, files: 0, dirs: 0, manifests: 0, roles: 0, cut: false, error: null, errors: [] };
    report.push(row);
    if (budget.dirs <= 0 || budget.files <= 0) { row.cut = true; continue; }
    try {
      const { files, manifests, dirs, cut, errors } = await walk(folder, budget, progress);
      Object.assign(row, { files: files.length, dirs, cut, errors });
      // (a file in two folders on the list, one inside the other, counted once)
      const fresh = files.filter((x) => !seen.has(x.k));
      for (const x of fresh) seen.add(x.k);
      for (const { f, k } of fresh) {
        const n = k.split("/").pop();
        if (!byName.has(n)) byName.set(n, f);
        const s = stemOf(n);
        if (!byStem.has(s)) byStem.set(s, f);
      }
      all.push(...fresh);
      const depth = (x) => x.k.split("/").length;
      for (const { f: file, k } of [...manifests].sort((a, b) => depth(a) - depth(b) || (a.k < b.k ? -1 : 1))) {
        const slash = String(file).lastIndexOf("/");
        const dir = slash < 0 ? "" : String(file).slice(0, slash);
        try {
          const res = await fetch(file, { cache: "no-cache" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const found = readManifest(await res.json(), dir, files);
          row.manifests++;
          const known = await rolesKnown();
          for (const role of Object.keys(found)) if (!known(role)) row.errors.push(`${k}: AtlasScribe paints no role called ${role}`);
          for (const [role, v] of Object.entries(found)) {
            if (!roles.has(role)) { roles.set(role, { ...v, paths: capped(v.paths, `${k}, ${role}`, row.errors) }); row.roles++; }
          }
        } catch (e) {
          row.errors.push(`${k} couldn't be read (${safeMessage(e)})`);
        }
      }
    } catch (e) {
      row.error = `couldn't be read (${safeMessage(e)})`;
    }
  }
  return { byName, byStem, roles, all, keys: new Set(all.map((x) => x.k)), folders: report };
}

/** Whether a file (a path or web address) is one the folders read hold. */
export function holds(url) {
  if (!base) return false;
  let k = keyOf(String(url).replace(/[?#].*$/, ""));
  if (base.keys.has(k)) return true;
  k = k.replace(/^\w+:\/\/[^/]+\//, "");
  if (base.keys.has(k)) return true;
  // (Foundry served under a route prefix: /foundry/packs/x.png is packs/x.png)
  const route = keyOf(globalThis.foundry?.utils?.getRoute?.("/") ?? "/").replace(/^\/+/, "");
  return !!route && k.startsWith(route) && base.keys.has(k.slice(route.length));
}

/** Forgets the folders chosen by hand that hold a file (by its web address), so they're read again. */
export function forgetHandFolder(url) {
  const k = keyOf(String(url).replace(/[?#].*$/, ""));
  for (const key of [...handWalks.keys()]) {
    // (a key is source:path or source:bucket:path; a folder at the top holds everything)
    const path = keyOf(key.slice(key.lastIndexOf(":") + 1));
    if (!path || k.includes(`/${path}/`) || k.startsWith(`${path}/`)) handWalks.delete(key);
  }
  forgetChoices();
}

/** Whether a file is gone from the server: true only when the server says so. */
export async function isGone(url, ms = 5000) {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-cache", signal: AbortSignal.timeout(ms) });
    return [403, 404, 410].includes(res.status);
  } catch {
    return false; // (a network or cross-site error says nothing about the file)
  }
}

/** A folder chosen by hand, read once a session (until forget()). */
function handWalk(folder, progress) {
  const key = folderKey(folder);
  if (!handWalks.has(key)) {
    // (a folder that failed is tried again next time)
    handWalks.set(key, walk(folder, { dirs: MOST_DIRS, files: MOST_FILES }, progress).catch((e) => {
      handWalks.delete(key);
      return { error: e };
    }));
  }
  return handWalks.get(key);
}

/** Whether a file chosen by hand is still on the server: false only when the server says it's gone. */
async function stillThere(path, b) {
  if (b.keys.has(keyOf(path))) return true;
  try {
    const res = await fetch(path, { method: "HEAD", cache: "no-cache" });
    return ![403, 404, 410].includes(res.status);
  } catch {
    return true; // (a network or cross-site error says nothing about the file)
  }
}

/** The GM's filename rules and art chosen by hand, built over the folders read. */
async function buildChoices(b, progress) {
  const notes = [];
  // Filename rules over every image in the folders, in the rules' order (an earlier rule wins a role)
  const rules = new Map(), ruleMatches = [];
  const known = await rolesKnown();
  for (const rule of storedRules()) {
    const test = ruleTest(rule.pattern);
    const paths = b.all.filter((x) => test(x)).map(({ f }) => f);
    ruleMatches.push(paths.length);
    const role = roleOf(rule.role);
    if (!known(role)) notes.push(`Rule ${rule.pattern.trim()}: AtlasScribe paints no role called ${rule.role.trim()}`);
    if (paths.length && !rules.has(role)) rules.set(role, { paths: capped(paths, `Rule ${rule.pattern.trim()}`, notes), px: gridPxOf(rule.px) });
  }

  // Art chosen by hand: files as given (those gone from the server dropped), folders read for their images
  const hand = new Map();
  for (const [role, e] of Object.entries(storedRoles())) {
    const given = [...new Set((Array.isArray(e?.files) ? e.files : []).filter((f) => typeof f === "string" && f))];
    const there = await Promise.all(given.map((f) => stillThere(f, b)));
    const paths = given.filter((f, i) => {
      if (!there[i]) notes.push(`${role}: ${keyOf(f)} isn't on the server`);
      return there[i];
    });
    for (const fo of Array.isArray(e?.folders) ? e.folders : []) {
      const folder = folderOf(fo);
      const w = await handWalk(folder, progress);
      if (w.error) { notes.push(`${role}: ${folder.path || folder.source} couldn't be read (${safeMessage(w.error)})`); continue; }
      if (w.cut) notes.push(`${role}: ${folder.path} has more than AtlasScribe reads; only part of it was searched`);
      for (const { f } of w.files) if (!paths.includes(f)) paths.push(f);
    }
    if (paths.length) hand.set(role, { paths: capped(paths, role, notes), px: gridPxOf(e?.px), all: !!e?.all });
  }
  return { rules, ruleMatches, hand, notes };
}

/** A file named in the FA role map, found in the folders: the exact name, else the same name with another type. */
export function findFile(idx, name) {
  const n = String(name).toLowerCase();
  return idx.byName.get(n) ?? idx.byStem.get(stemOf(n)) ?? null;
}
