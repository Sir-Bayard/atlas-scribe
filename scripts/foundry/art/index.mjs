/**
 * Art: turns the roles a Layout needs into image URLs, asking each provider in turn (only FA Nexus so far). A role
 * nobody fills is listed as missing and painted in a plain color.
 */
import * as faNexus from "./fa-nexus.mjs";
import { safeMessage } from "./fa-nexus.mjs";

const PROVIDERS = [faNexus];

/** Forgets what the providers found earlier, so the next render asks them again. */
export function forgetArt() {
  for (const p of PROVIDERS) p.forget?.();
}

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
      res = { art: {}, missing: remaining, why: `An art source failed (${safeMessage(e)}); its roles are painted in plain colors` };
    }
    if (res.why) notes.push(res.why);
    Object.assign(art, res.art);
    remaining = res.missing;
  }
  const abs = Object.fromEntries(Object.entries(art).map(([role, list]) => [role, list.map((p) => new URL(p, window.location.href).href)]));
  return { art: abs, missing: remaining, notes };
}
