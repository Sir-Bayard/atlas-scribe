/**
 * The FA Nexus art provider: finds Forgotten Adventures files by name in the user's own FA Nexus catalog and
 * downloads them through FA Nexus (premium files need FA Nexus connected to Patreon). Uses FA Nexus's internal
 * methods, not a published API, so an FA Nexus update can break it; everything here fails soft (a file it can't
 * give is left out).
 *
 * Always pass the Patreon login state when asking for a download link: asking without it makes FA Nexus treat
 * the login as expired and disconnect Patreon.
 */
const MOD = "atlas-scribe";
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
  return { app: app ?? null, opened: !!app };
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
export async function fetchNames(names, progress = () => {}) {
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
    const res = await fetchWith(nexus.app, ask, progress, state);
    if (!res.why) for (const name of ask) if (!res.unsure.has(name)) found.set(name, { path: res.paths.get(name) ?? null, premium });
    for (const [k, v] of res.paths) paths.set(k, v);
    for (const n of res.locked ?? []) locked.add(n);
    return { paths, downloaded: res.downloaded, why: res.why, locked: lockedOf() };
  } catch (e) {
    // FA Nexus changed, or failed: the names not found earlier go without, and the render goes on
    console.warn(`${MOD} | FA Nexus couldn't be used: ${safeMessage(e)}`);
    return { paths, downloaded: 0, why: `FA Nexus couldn't be used (${safeMessage(e)})` };
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

async function fetchWith(app, names, progress, state) {
  const paths = new Map();
  if (!app?._contentService || !app?._downloadManager) return { paths, downloaded: 0, unsure: new Set(), why: "FA Nexus didn't open" };
  if (!catalog?.length) {
    const listed = await app._contentService.list("assets");
    const list = Array.isArray(listed) ? listed : Object.values(listed ?? {}).find(Array.isArray);
    catalog = Array.isArray(list) ? list : [];
    if (!catalog.length) return { paths, downloaded: 0, unsure: new Set(), why: "FA Nexus's catalog came back empty" };
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
  for (const name of names) {
    const lower = name.toLowerCase();
    const item = byName.get(lower) ?? byName.get(`~${lower.replace(/\.\w+$/, "")}`);
    progress(++done / total, `Fetching art: ${name}`);
    if (!item) continue;
    if (item.tier !== "free" && !state) { lockedNow.add(name); continue; } // premium needs the Patreon login; never ask without it
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
  }
  return { paths, downloaded, unsure, locked: lockedNow };
}
