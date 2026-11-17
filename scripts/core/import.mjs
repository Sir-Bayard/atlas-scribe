/**
 * What an import reads: an AtlasScribe plan (JSON, or text with a mapplan block), a watabou city or village export, or
 * a Universal VTT file. Pure: runs anywhere.
 */
import { readPlan } from "./plan.mjs";
import { fromWatabou, isWatabou } from "./import-watabou.mjs";
import { fromUVTT, isUVTT } from "./uvtt.mjs";

/**
 * Reads input (text or a parsed object). Returns { plan, notes, image, from } (from: "plan", "watabou" or "uvtt";
 * image: a Universal VTT file's { base64, type }, to put under the sketch), or { plan: null, error }.
 */
export function importAny(input, opts = {}) {
  const read = readPlan(input);
  if (!read.plan) return { plan: null, error: read.error };
  const data = read.plan;
  try {
    if (isUVTT(data)) return { ...fromUVTT(data, opts), from: "uvtt" };
    if (isWatabou(data)) return { ...fromWatabou(data, opts), image: null, from: "watabou" };
  } catch (e) {
    return { plan: null, error: e.message };
  }
  return { plan: data, notes: [], image: null, from: "plan" };
}
