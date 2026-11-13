/**
 * Art: turns the roles a Layout needs into image URLs. Art the GM chose by hand for a role and all its kinds wins
 * outright. Otherwise each role tries the names in its chain, most specific first (a season's before the plain one):
 * at each name art chosen by hand, else a filename rule's, else a folder manifest's, else the FA role map's files,
 * taken from the art folders by name and through FA Nexus for any the folders lack. The first name that gives any
 * art is used. A role nobody fills is listed as missing and painted in a plain color.
 */
import * as faNexus from "./fa-nexus.mjs";
import * as folders from "./folders.mjs";
import { roleChain } from "../../core/roles.mjs";

const EMPTY = { byName: new Map(), byStem: new Map(), roles: new Map(), rules: new Map(), ruleMatches: [], hand: new Map(), notes: [], all: [], folders: [] };

/** The GM's own art for a name (by hand, by a filename rule, or from a manifest), with where it came from. */
function ownArt(idx, r) {
  const h = idx.hand.get(r);
  if (h) return { ...h, source: "hand" };
  const rule = idx.rules.get(r);
  if (rule) return { ...rule, source: "rule" };
  const m = idx.roles.get(r);
  return m ? { ...m, source: "manifest" } : null;
}

/** Art chosen by hand for a role and all its kinds: the most specific such name in the role's chain. */
function handAll(idx, chain) {
  for (const r of chain) {
    const h = idx.hand.get(r);
    if (h) return h.all ? { ...h, source: "hand", name: r } : null;
  }
  return null;
}

/** Forgets what the sources found earlier, so the next render asks them again. */
export function forgetArt() {
  faNexus.forget();
  folders.forget();
}

/**
 * After images failed to load (urls): the folders are read again if they held one, FA Nexus asked again if any came
 * from elsewhere, and art chosen by hand checked again.
 */
export function forgetBroken(urls = []) {
  const inFolders = urls.filter((u) => folders.holds(u));
  if (inFolders.length) folders.forget();
  else folders.forgetChoices();
  if (inFolders.length < urls.length) faNexus.forget();
}

/**
 * Returns { art: { role: [absolute url, ...] }, scale: { url: factor }, missing: [role, ...], notes: [...], from:
 * { folders, nexus } }: scale for art not drawn at 200 px a square (from a manifest's gridPx), from counting the
 * roles each source filled. drawn: a battle map's, whose roles with no art are drawn (the notes say so).
 */
const abs = (p) => new URL(p, window.location.href).href;
/** A file's address marked with the scale it's drawn at. */
function scaled(p, px) {
  const u = new URL(p, window.location.href);
  u.searchParams.set("as-px", String(px));
  return u.href;
}

export async function resolveArt(roles, progress = () => {}, { drawn = false } = {}) {
  // (what a role with no art becomes: drawn on a battle map, a plain color in the textured style)
  const instead = drawn ? "drawn instead" : "painted in plain colors";
  const notes = [];
  let idx = EMPTY;
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
  for (const e of idx.notes ?? []) notes.push(`Your art: ${e}`);
  const map = await faNexus.faRoleMap();

  const art = {}, scale = {}, missing = [];
  const from = { folders: 0, nexus: 0 };
  const got = new Map();
  let nexusWhy = null;
  // Each round settles every role whose name at its step gives art; a role whose FA files all come to nothing goes
  // on to the next name in its chain, so FA Nexus is asked only for the files of names actually reached
  let open = roles.map((role) => {
    const chain = roleChain(role);
    return { role, chain, at: 0, own: handAll(idx, chain) };
  });
  while (open.length) {
    const asking = [];
    for (const o of open) {
      for (; !o.own && o.at < o.chain.length; o.at++) {
        const r = o.chain[o.at];
        const own = ownArt(idx, r);
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
        // (art at another scale gets its own address, so a file two roles use at two scales is resized for each)
        const k = folders.ART_PX / o.own.px;
        const urls = o.own.paths.map((p) => (k === 1 ? abs(p) : scaled(p, o.own.px)));
        art[o.role] = urls;
        if (k !== 1) for (const u of urls) scale[u] = k;
        from.folders++;
      } else if (o.files) {
        const paths = o.files.map((f) => f.path ?? got.get(f.name)).filter(Boolean);
        if (paths.length) {
          art[o.role] = paths.map(abs);
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
  if (nexusWhy) notes.push(`${nexusWhy}; art it would have given is ${instead}`);
  // (a battle map with no art at all is simply drawn: nothing to warn of)
  if (missing.length && !idx.folders.length && !faNexus.available() && !drawn) notes.push("No art folders are set and FA Nexus isn't active, so the map is painted in plain colors");

  return {
    art,
    scale,
    missing,
    notes,
    from,
  };
}

/**
 * What each role would be painted with, without asking FA Nexus for anything: [{ role, name (the chain name used),
 * source ("hand", "rule", "manifest", "folder", "nexus" or "none"), paths (files on the server, absolute), count }].
 * "nexus" means FA Nexus would be asked; whether it has the files is only known at a render.
 */
export async function describeArt(roles) {
  let idx = EMPTY;
  try {
    idx = await folders.folderIndex();
  } catch {
    /* described as if no folders */
  }
  const map = await faNexus.faRoleMap();
  const nexus = faNexus.available();
  return roles.map((role) => {
    const chain = roleChain(role);
    const all = handAll(idx, chain);
    if (all) return { role, name: all.name, source: "hand", paths: all.paths.map(abs), count: all.paths.length };
    for (const r of chain) {
      const own = ownArt(idx, r);
      if (own) return { role, name: r, source: own.source, paths: own.paths.map(abs), count: own.paths.length };
      if (map[r]?.length) {
        const found = map[r].map((n) => folders.findFile(idx, n)).filter(Boolean);
        if (found.length) return { role, name: r, source: "folder", paths: found.map(abs), count: nexus ? map[r].length : found.length };
        if (nexus) return { role, name: r, source: "nexus", paths: [], count: map[r].length };
      }
    }
    return { role, name: null, source: "none", paths: [], count: 0 };
  });
}
