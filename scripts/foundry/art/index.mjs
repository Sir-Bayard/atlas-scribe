/**
 * Art: turns the roles a Layout needs into image URLs. Each role tries the names in its chain, most specific first (a
 * season's before the plain one): at each name a folder manifest's art, else the FA role map's files, taken from the
 * art folders by name and through FA Nexus for any the folders lack. The first name that gives any art is used. A
 * role nobody fills is listed as missing and painted in a plain color.
 */
import * as faNexus from "./fa-nexus.mjs";
import * as folders from "./folders.mjs";
import { roleChain } from "../../core/roles.mjs";

/** Forgets what the sources found earlier, so the next render asks them again. */
export function forgetArt() {
  faNexus.forget();
  folders.forget();
}

/**
 * Returns { art: { role: [absolute url, ...] }, scale: { url: factor }, missing: [role, ...], notes: [...], from:
 * { folders, nexus } }: scale for art not drawn at 200 px a square (from a manifest's gridPx), from counting the
 * roles each source filled.
 */
export async function resolveArt(roles, progress = () => {}) {
  const notes = [];
  let idx = { byName: new Map(), byStem: new Map(), roles: new Map(), folders: [] };
  try {
    idx = await folders.folderIndex((label) => progress(0, label));
  } catch (e) {
    notes.push(`The art folders couldn't be read (${faNexus.safeMessage(e)})`);
  }
  for (const f of idx.folders) {
    const name = `${f.folder.source === "data" ? "" : `${f.folder.source}: `}${f.folder.path || "(top)"}`;
    if (f.error) notes.push(`Art folder ${name}: ${f.error}`);
    for (const e of f.errors ?? []) notes.push(`Art folder ${name}: ${e}`);
    if (f.cut) notes.push(`Art folder ${name} has more than AtlasScribe reads; only part of it was searched`);
  }
  const map = await faNexus.faRoleMap();

  const art = {}, scale = {}, missing = [];
  const from = { folders: 0, nexus: 0 };
  const got = new Map();
  let nexusWhy = null;
  // Each round settles every role whose name at its step gives art; a role whose FA files all come to nothing goes
  // on to the next name in its chain, so FA Nexus is asked only for the files of names actually reached
  let open = roles.map((role) => ({ role, chain: roleChain(role), at: 0 }));
  while (open.length) {
    const asking = [];
    for (const o of open) {
      for (; o.at < o.chain.length; o.at++) {
        const r = o.chain[o.at];
        const own = idx.roles.get(r);
        if (own) { o.own = own; break; }
        if (map[r]?.length) { o.files = map[r].map((name) => ({ name, path: folders.findFile(idx, name) })); break; }
      }
      if (o.files) for (const f of o.files) if (!f.path && !got.has(f.name)) asking.push(f.name);
    }
    const ask = [...new Set(asking)];
    if (ask.length) {
      const res = await faNexus.fetchNames(ask, progress);
      for (const name of ask) got.set(name, res.paths.get(name) ?? null);
      if (res.why && faNexus.available()) nexusWhy ??= res.why;
    }
    const next = [];
    for (const o of open) {
      if (o.own) {
        art[o.role] = [...o.own.paths];
        if (o.own.px !== folders.ART_PX) for (const p of o.own.paths) scale[p] = folders.ART_PX / o.own.px;
        from.folders++;
      } else if (o.files) {
        const paths = o.files.map((f) => f.path ?? got.get(f.name)).filter(Boolean);
        if (paths.length) {
          art[o.role] = paths;
          if (o.files.some((f) => f.path)) from.folders++;
          else from.nexus++;
        } else {
          o.files = null;
          o.at++;
          next.push(o);
        }
      } else missing.push(o.role);
    }
    open = next;
  }
  if (nexusWhy) notes.push(`${nexusWhy}; art it would have given is painted in plain colors`);
  if (missing.length && !idx.folders.length && !faNexus.available()) notes.push("No art folders are set and FA Nexus isn't active, so the map is painted in plain colors");

  const abs = (p) => new URL(p, window.location.href).href;
  return {
    art: Object.fromEntries(Object.entries(art).map(([role, list]) => [role, list.map(abs)])),
    scale: Object.fromEntries(Object.entries(scale).map(([p, k]) => [abs(p), k])),
    missing,
    notes,
    from,
  };
}
