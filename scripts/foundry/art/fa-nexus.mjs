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

async function nexusApp() {
  let app = foundry.applications.instances.get("fa-nexus-app");
  if (app) return app;
  if (typeof globalThis.faNexus?.open !== "function") return null;
  globalThis.faNexus.open();
  for (let i = 0; i < 30 && !app; i++) {
    await new Promise((r) => setTimeout(r, 200));
    app = foundry.applications.instances.get("fa-nexus-app");
  }
  return app ?? null;
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
  const art = {};
  const missing = [];
  if (!available()) return { art, missing: [...roles], downloaded: 0, why: "FA Nexus isn't active" };
  const map = await loadRoleMap();
  const app = await nexusApp();
  if (!app?._contentService || !app?._downloadManager) return { art, missing: [...roles], downloaded: 0, why: "FA Nexus didn't open" };
  catalog ??= Object.values(await app._contentService.list("assets"))[0] ?? [];
  const byName = new Map();
  for (const a of catalog) {
    const k = String(a.filename ?? "").toLowerCase();
    if (!byName.has(k)) byName.set(k, a);
    const b = k.replace(/\.\w+$/, "");
    if (!byName.has(`~${b}`)) byName.set(`~${b}`, a);
  }
  const state = game.settings.get("fa-nexus", "patreon_auth_data")?.state ?? null;

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
        console.warn(`${MOD} | couldn't get ${name} through FA Nexus`, e);
      }
    }
    if (paths.length) art[role] = paths;
    else missing.push(role);
  }
  return { art, missing, downloaded };
}
