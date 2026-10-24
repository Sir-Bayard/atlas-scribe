/**
 * Art: turns the roles a Layout needs into image URLs, through the providers in order (FA Nexus for now; art
 * folders later). A role nobody fills is listed as missing and painted in a plain colour.
 */
import * as faNexus from "./fa-nexus.mjs";

const PROVIDERS = [faNexus];

/** Returns { art: { role: [absolute url, ...] }, missing: [role, ...], notes: [...] }. */
export async function resolveArt(roles, progress = () => {}) {
  let remaining = [...roles];
  const art = {};
  const notes = [];
  for (const p of PROVIDERS) {
    if (!remaining.length) break;
    let res;
    try {
      res = await p.resolve(remaining, progress);
    } catch (e) {
      res = { art: {}, missing: remaining, why: `An art source failed (${e?.message ?? e}); its roles are painted in plain colours` };
    }
    if (res.why) notes.push(res.why);
    Object.assign(art, res.art);
    remaining = res.missing;
  }
  const abs = Object.fromEntries(Object.entries(art).map(([role, list]) => [role, list.map((p) => new URL(p, window.location.href).href)]));
  return { art: abs, missing: remaining, notes };
}
