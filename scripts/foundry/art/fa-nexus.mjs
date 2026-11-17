/**
 * The FA Nexus art provider: finds Forgotten Adventures files by name in the user's own FA Nexus catalog and
 * downloads them through FA Nexus (premium files need FA Nexus connected to Patreon). Uses FA Nexus's internal
 * methods, not a published API, so an FA Nexus update can break it; everything here fails soft (a file it can't
 * give is left out).
 *
 * Always pass the Patreon login state when asking for a download link: asking without it makes FA Nexus treat
 * the login as expired and disconnect Patreon.
 */
import { MOD } from "../util.mjs";
import { storage } from "../../kit/storage.mjs";

const store = storage(MOD);
/** Downloads through FA Nexus at once. */
const DOWNLOADS = 3;
let catalog = null;
let roleMap = null;
// What each file name came to earlier this session ({ path, premium }: premium when the Patreon login was there), so
// the next render needn't open FA Nexus. Names that failed to come are asked again; forget() clears it all.
const found = new Map();
// Premium file names FA Nexus has that were skipped for want of the Patreon login
const locked = new Set();

/** Forgets the files found earlier, so the next render asks FA Nexus again (when an image failed to load, say). */
export function forget() {
  found.clear();
  locked.clear();
  catalog = null; // read again too, in case the files changed in FA Nexus
}

/** An error's message with web addresses and query strings taken out (FA Nexus's errors can carry a signed link). */
export const safeMessage = (e) => String((typeof e === "string" ? e : e?.message) || "unknown error").replace(/\w+:\/\/\S+/g, "<link>").replace(/\?\S*=\S*/g, "?<removed>").slice(0, 200);

function patreonState() {
  try {
    return game.settings.get("fa-nexus", "patreon_auth_data")?.state ?? null;
  } catch {
    return null; // no Patreon login to be had: free files only
  }
}

export function available() {
  return !!game.modules.get("fa-nexus")?.active;
}

// FA Nexus's window while a render holds it open (hold() and release()), so it opens once a render, not once a round
let holds = 0, ours = null;

/** Keeps FA Nexus's window, once opened, open until release(): a render asks for files in several rounds. */
export function hold() {
  holds++;
}

/** Ends a hold(); the last one closes FA Nexus's window if AtlasScribe opened it. */
export async function release() {
  holds = Math.max(0, holds - 1);
  if (holds || !ours) return;
  const app = ours;
  ours = null;
  try {
    await app.close?.(); // we opened it only for its catalog
  } catch {
    /* closing is a nicety */
  }
}

/** The versions to give when FA Nexus changed in a way AtlasScribe can't use, and a note saying so. */
export function brokeNote(why) {
  const v = (id) => game.modules.get(id)?.version ?? "?";
  return `${why}. FA Nexus may have changed: report it with AtlasScribe ${v(MOD)} and FA Nexus ${v("fa-nexus")}`;
}

/**
 * Names of Forgotten Adventures files in the role map that FA Nexus lists as premium, as last read from its catalog
 * (kept in this browser, so a file downloaded while the Patreon login was there isn't used once it lapses).
 */
export function premiumNames() {
  const list = store.get("fa.premium", []);
  return new Set(Array.isArray(list) ? list.map((n) => String(n).toLowerCase()) : []);
}

/** Whether the Patreon login is there (premium files may be used). */
export function patron() {
  return !!patreonState();
}

/** FA Nexus's window, opened if it isn't (its catalog lives there). opened: true when we opened it, to close after. */
async function nexusApp() {
  let app = foundry.applications.instances.get("fa-nexus-app");
  if (app) return { app, opened: false };
  if (typeof globalThis.faNexus?.open !== "function") return { app: null, opened: false };
  globalThis.faNexus.open();
  for (let i = 0; i < 30 && !app; i++) {
    await new Promise((r) => setTimeout(r, 200));
    app = foundry.applications.instances.get("fa-nexus-app");
  }
  if (app && holds) ours = app;
  return { app: app ?? null, opened: !!app && !holds };
}

let styleList = null;
/** Every role the styles ask art for (data/roles/styles.json), including roles no FA file fills. */
export async function styleRoles() {
  if (styleList) return styleList;
  try {
    const res = await fetch(`modules/${MOD}/data/roles/styles.json`);
    styleList = res.ok ? (await res.json()).roles ?? [] : [];
  } catch {
    styleList = [];
  }
  return styleList;
}

/** The FA role map: { role: [Forgotten Adventures file name, ...] }, the names being variants. */
export async function faRoleMap() {
  if (roleMap) return roleMap;
  const res = await fetch(`modules/${MOD}/data/roles/fa-nexus.json`);
  roleMap = res.ok ? (await res.json()).roles ?? {} : {};
  return roleMap;
}

/**
 * Fetches Forgotten Adventures files by name through FA Nexus. Returns { paths: Map name -> local path (names FA
 * Nexus can't give are left out), downloaded, why }. progress(pct, label) while downloading.
 */
export async function fetchNames(names, progress = () => {}, { check = null } = {}) {
  const paths = new Map();
  if (!available()) return { paths, downloaded: 0, why: "FA Nexus isn't active" };
  const state = patreonState();
  const premium = !!state;
  // Names found earlier with the same login need no FA Nexus window
  const ask = [];
  // (premium files skipped for want of the Patreon login, said in a note each render)
  const lockedOf = () => (premium ? 0 : names.filter((n) => locked.has(n)).length);
  for (const name of names) {
    const f = found.get(name);
    if (f && f.premium === premium) { if (f.path) paths.set(name, f.path); }
    else ask.push(name);
  }
  if (!ask.length) return { paths, downloaded: 0, locked: lockedOf() };
  let nexus = { app: null, opened: false };
  try {
    nexus = await nexusApp();
    const res = await fetchWith(nexus.app, ask, progress, state, check);
    if (!res.why) for (const name of ask) if (!res.unsure.has(name)) found.set(name, { path: res.paths.get(name) ?? null, premium });
    for (const [k, v] of res.paths) paths.set(k, v);
    for (const n of res.locked ?? []) locked.add(n);
    return { paths, downloaded: res.downloaded, why: res.why, locked: lockedOf() };
  } catch (e) {
    if (e?.canceled) throw e;
    // FA Nexus changed, or failed: the names not found earlier go without, and the render goes on
    console.warn(`${MOD} | FA Nexus couldn't be used: ${safeMessage(e)}`);
    return { paths, downloaded: 0, why: brokeNote(`FA Nexus couldn't be used (${safeMessage(e)})`) };
  } finally {
    if (nexus.opened) {
      try {
        await nexus.app?.close?.(); // we opened it only for its catalog
      } catch {
        /* closing is a nicety */
      }
    }
  }
}

/**
 * A catalog entry's file name. FA Nexus's catalog gave it as `filename`; its newer catalog (schema 2) gives the
 * file's path without its type as `id` ("!Core_Settlements/.../Tent_Cloth_Tan_A1_3x3") and its type as
 * `selected_source.ext`.
 */
export function fileNameOf(a) {
  if (typeof a?.filename === "string" && a.filename) return a.filename;
  if (typeof a?.id !== "string" || !a.id) return "";
  const ext = typeof a.selected_source?.ext === "string" && a.selected_source.ext ? a.selected_source.ext.replace(/^(?!\.)/, ".") : "";
  return a.id.split("/").pop() + ext;
}

/** Stores which role-map files the catalog lists as premium (see premiumNames). */
async function keepPremium(list) {
  const wanted = new Set(Object.values(await faRoleMap()).flat().map((n) => String(n).toLowerCase()));
  const stems = new Set([...wanted].map((n) => n.replace(/\.\w+$/, "")));
  const premium = [];
  for (const a of list) {
    if (a?.tier === "free") continue;
    const n = fileNameOf(a).toLowerCase();
    if (n && (wanted.has(n) || stems.has(n.replace(/\.\w+$/, "")))) premium.push(n);
  }
  store.set("fa.premium", premium);
}

async function fetchWith(app, names, progress, state, check = null) {
  const paths = new Map();
  if (!app) return { paths, downloaded: 0, unsure: new Set(), why: brokeNote("FA Nexus's window didn't open") };
  if (!app._contentService || !app._downloadManager) return { paths, downloaded: 0, unsure: new Set(), why: brokeNote("FA Nexus's window has no catalog or downloads AtlasScribe knows") };
  if (!catalog?.length) {
    const read = async () => {
      const listed = await app._contentService.list("assets");
      const list = Array.isArray(listed) ? listed : Object.values(listed ?? {}).find(Array.isArray);
      return Array.isArray(list) ? list : [];
    };
    catalog = await read();
    // (a client that hasn't opened FA Nexus before has an empty catalog until FA Nexus fetches it: asked to, and read
    // again, for up to a minute)
    if (!catalog.length && typeof app._contentService.sync === "function") {
      progress(0, "Fetching FA Nexus's catalog");
      let timer;
      try {
        await Promise.race([
          app._contentService.sync("assets").catch(() => null),
          new Promise((r) => setTimeout(r, 60000)),
          // (a canceled render stops waiting at once)
          new Promise((_, fail) => { timer = setInterval(() => { try { check?.(); } catch (e) { fail(e); } }, 200); }),
        ]);
      } finally {
        clearInterval(timer);
      }
      catalog = await read();
    }
    if (!catalog.length) return { paths, downloaded: 0, unsure: new Set(), why: brokeNote("FA Nexus's catalog came back empty") };
    await keepPremium(catalog);
  }
  const byName = new Map();
  for (const a of catalog) {
    const k = fileNameOf(a).toLowerCase();
    if (!k) continue;
    if (!byName.has(k)) byName.set(k, a);
    const b = k.replace(/\.\w+$/, "");
    if (!byName.has(`~${b}`)) byName.set(`~${b}`, a);
  }
  const total = names.length || 1;
  let done = 0, downloaded = 0;
  const unsure = new Set(); // names that failed: asked again next time
  const lockedNow = new Set();
  const queue = [...names];
  const one = async (name) => {
    const lower = name.toLowerCase();
    const item = byName.get(lower) ?? byName.get(`~${lower.replace(/\.\w+$/, "")}`);
    progress(++done / total, `Fetching art: ${name}`);
    if (!item) return;
    if (item.tier !== "free" && !state) { lockedNow.add(name); return; } // premium needs the Patreon login; never ask without it
    try {
      let local = await app._downloadManager.getLocalPath?.("assets", item);
      if (!local) {
        const url = await app._contentService.getFullURL("assets", item, state);
        // forceDownload: with FA Nexus's "direct cloud URLs" setting on, free files would otherwise come back as
        // links to another site, which the worker may not be allowed to load
        local = await app._downloadManager.ensureLocal("assets", item, url, { forceDownload: true });
        downloaded++;
      }
      if (local) paths.set(name, local);
      else unsure.add(name);
    } catch (e) {
      console.warn(`${MOD} | couldn't get ${name} through FA Nexus: ${safeMessage(e)}`);
      unsure.add(name);
    }
  };
  // (a few at a time: each is a separate file FA Nexus fetches and saves)
  await Promise.all(Array.from({ length: Math.min(DOWNLOADS, queue.length) }, async () => {
    for (let name; (name = queue.shift()) !== undefined;) await one(name);
  }));
  return { paths, downloaded, unsure, locked: lockedNow };
}
