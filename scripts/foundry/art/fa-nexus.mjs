/**
 * The FA Nexus art provider: finds each role's Forgotten Adventures files in the user's own FA Nexus catalog and
 * downloads them through FA Nexus (premium files need FA Nexus connected to Patreon). Uses FA Nexus's internal
 * methods, not a published API, so an FA Nexus update can break it; everything here fails soft (a role with no
 * art falls back to a plain colour).
 *
 * Always pass the Patreon login state when asking for a download link: asking without it makes FA Nexus treat
 * the login as expired and disconnect Patreon.
 */
import { roleChain } from "../../core/roles.mjs";

const MOD = "atlas-scribe";
let catalog = null;
let roleMap = null;

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

async function loadRoleMap() {
  if (roleMap) return roleMap;
  const res = await fetch(`modules/${MOD}/data/roles/fa-nexus.json`);
  roleMap = res.ok ? (await res.json()).roles ?? {} : {};
  return roleMap;
}

/**
 * Resolves roles to local file paths. Returns { art: { role: [path, ...] }, missing: [role, ...], downloaded }.
 * progress(pct, label) while downloading.
 */
export async function resolve(roles, progress = () => {}) {
  if (!available()) return { art: {}, missing: [...roles], downloaded: 0, why: "FA Nexus isn't active, so the map is painted in plain colours" };
  let nexus = { app: null, opened: false };
  try {
    nexus = await nexusApp();
    return await resolveWith(nexus.app, roles, progress);
  } catch (e) {
    // FA Nexus changed, or failed: every role falls back to a plain colour, and the render goes on
    console.warn(`${MOD} | FA Nexus couldn't be used: ${e?.message ?? e}`); // the message only: FA Nexus's own error may carry a signed URL
    return { art: {}, missing: [...roles], downloaded: 0, why: `FA Nexus couldn't be used (${e?.message ?? e}), so the map is painted in plain colours` };
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

async function resolveWith(app, roles, progress) {
  const art = {};
  const missing = [];
  const map = await loadRoleMap();
  if (!app?._contentService || !app?._downloadManager) return { art, missing: [...roles], downloaded: 0, why: "FA Nexus didn't open, so the map is painted in plain colours" };
  if (!catalog?.length) {
    const listed = await app._contentService.list("assets");
    const list = Array.isArray(listed) ? listed : Object.values(listed ?? {}).find(Array.isArray);
    catalog = Array.isArray(list) ? list : [];
    if (!catalog.length) return { art, missing: [...roles], downloaded: 0, why: "FA Nexus's catalog came back empty, so the map is painted in plain colours" };
  }
  const byName = new Map();
  for (const a of catalog) {
    const k = String(a?.filename ?? "").toLowerCase();
    if (!k) continue;
    if (!byName.has(k)) byName.set(k, a);
    const b = k.replace(/\.\w+$/, "");
    if (!byName.has(`~${b}`)) byName.set(`~${b}`, a);
  }
  let state = null;
  try {
    state = game.settings.get("fa-nexus", "patreon_auth_data")?.state ?? null;
  } catch {
    state = null; // no Patreon login to be had: free files only
  }

  // What each role needs
  const wanted = [];
  for (const role of roles) {
    const key = roleChain(role).find((r) => map[r]);
    if (!key) { missing.push(role); continue; }
    wanted.push({ role, files: map[key] });
  }
  const total = wanted.reduce((n, w) => n + w.files.length, 0) || 1;
  let done = 0, downloaded = 0;
  for (const { role, files } of wanted) {
    const paths = [];
    for (const name of files) {
      const lower = name.toLowerCase();
      const item = byName.get(lower) ?? byName.get(`~${lower.replace(/\.\w+$/, "")}`);
      progress(++done / total, `Fetching art: ${name}`);
      if (!item) continue;
      if (item.tier !== "free" && !state) continue; // premium needs the Patreon login; never ask without it
      try {
        let local = await app._downloadManager.getLocalPath?.("assets", item);
        if (!local) {
          const url = await app._contentService.getFullURL("assets", item, state);
          // forceDownload: with FA Nexus's "direct cloud URLs" setting on, free files would otherwise come back as
          // links to another site, which the worker may not be allowed to load
          local = await app._downloadManager.ensureLocal("assets", item, url, { forceDownload: true });
          downloaded++;
        }
        if (local) paths.push(local);
      } catch (e) {
        console.warn(`${MOD} | couldn't get ${name} through FA Nexus: ${e?.message ?? e}`);
      }
    }
    if (paths.length) art[role] = paths;
    else missing.push(role);
  }
  return { art, missing, downloaded };
}
