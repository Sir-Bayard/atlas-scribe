/**
 * Towns and roads on an overland plan, placed by the generator (settle.mjs) and kept in the plan as its own features,
 * and the names the map makes, kept in the plan so they stay when the land is made again. A generated place, road or
 * crossing carries `made`, a fingerprint of how it was made: one the GM has since moved, renamed or changed in any
 * setting no longer matches it, and counts as the GM's. Pure.
 */
import { settle } from "./settle.mjs";
import { normalize, TYPES, fieldDefault } from "../plan.mjs";

const fnv = (t) => { let h = 0x811c9dc5; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };

/**
 * A generated feature's fingerprint: everything the GM can change about it (its class, place or path, name and every
 * setting), leaving out its id, its site facts and the mark itself, and any setting left at its default (so a plan
 * read with its defaults filled in reads the same).
 */
export const madeMark = (f) => {
  const fields = TYPES[f?.type]?.fields ?? {};
  const keep = Object.keys(f ?? {}).filter((k) => !["id", "made", "site"].includes(k)).sort()
    .filter((k) => f[k] !== null && f[k] !== undefined && !(k in fields && JSON.stringify(f[k]) === JSON.stringify(fieldDefault(fields[k], f.class))));
  return fnv(JSON.stringify(keep.map((k) => [k, f[k]])));
};

/** Whether a feature is the generator's, as it made it (not moved, renamed or changed since). */
export const untouched = (f) => typeof f?.made === "string" && f.made === madeMark(f);

/** Whether a plan has any of the generator's places, roads or crossings (made, whether or not changed since). */
export const hasMadePlaces = (plan) => (plan?.features ?? []).some((f) => typeof f?.made === "string");

/**
 * Which of the generator's untouched features must still stay: those a label follows (its `of`), the places at the
 * ends of a road that stays (so it still runs between places), and the capital of a realm the GM changed (so it's
 * still ruled from a place). Returns a Set of ids.
 */
export function stillNeeded(features) {
  const need = new Set((features ?? []).filter((f) => f?.type === "label" && typeof f.of === "string").map((f) => f.of));
  const at = (p, q) => Array.isArray(p) && Array.isArray(q) && Math.abs(p[0] - q[0]) < 0.05 && Math.abs(p[1] - q[1]) < 0.05;
  const kept = (f) => !untouched(f) || need.has(f.id);
  for (const r of (features ?? []).filter((f) => f?.type === "road" && Array.isArray(f.path) && f.path.length >= 2 && kept(f)))
    for (const p of features) if (p?.type === "place" && untouched(p) && (at(p.at, r.path[0]) || at(p.at, r.path[r.path.length - 1]))) need.add(p.id);
  for (const q of (features ?? []).filter((f) => f?.type === "realm" && typeof f.capital === "string" && !untouched(f))) need.add(q.capital);
  return need;
}

/**
 * Places towns, villages, castles, ruins, roads and crossings on an overland plan's land, in place of the generator's
 * own that the GM hasn't changed (what the GM placed or changed is kept, with what it needs, and the new ones join it;
 * the ids of what went aren't given to the new ones). land: the layout's land (layoutPlan(plan).land). Returns { plan
 * (the plan given, with its features changed), added, removed, notes (plain words) }.
 */
export function placeTowns(plan, land, { seed = 1, density = null } = {}) {
  const all = plan.features ?? [];
  const need = stillNeeded(all);
  // (realms are left to placeRealms, which rules them again from the new towns: render/jobs.mjs)
  const keep = all.filter((f) => f?.type === "realm" || !untouched(f) || need.has(f.id));
  const gone = all.filter((f) => !keep.includes(f)).map((f) => f.id);
  const full = normalize({ ...plan, features: keep });
  const out = settle(land, full, { seed, density: density ?? full.land?.towns ?? "some", reserve: gone });
  const made = out.features.map((f) => ({ ...f, made: madeMark(f) }));
  const notes = (out.notes ?? []).map((n) => (typeof n === "string" ? n : n?.message)).filter(Boolean);
  // (a road or crossing kept from before that no longer meets what's around it: said, not changed)
  const roads = [...keep, ...made].filter((f) => f.type === "road" && Array.isArray(f.path));
  const places = [...keep, ...made].filter((f) => f.type === "place" && Array.isArray(f.at));
  const near = (p, q, d) => Math.hypot(p[0] - q[0], p[1] - q[1]) < d;
  const onRoad = (p) => roads.some((r) => r.path.some((q, k) => k > 0 && segDist(p, r.path[k - 1], q) < 0.3));
  for (const c of keep.filter((f) => f.type === "crossing" && Array.isArray(f.at) && !onRoad(f.at))) notes.push(`The ${c.class} "${c.name ?? c.id}" you kept isn't on a road any more; move it or delete it.`);
  for (const r of keep.filter((f) => f.type === "road" && Array.isArray(f.path) && f.path.length >= 2)) {
    const ends = [r.path[0], r.path[r.path.length - 1]];
    if (!ends.some((e) => places.some((p) => near(p.at, e, 0.05)) || roads.some((o) => o !== r && o.path.some((q) => near(q, e, 0.05))))) notes.push(`The road "${r.name ?? r.id}" you kept no longer meets a place or another road; the new roads don't follow it.`);
  }
  return { plan: { ...structuredClone(plan), features: [...structuredClone(keep), ...made] }, added: made.length, removed: gone.length, notes };
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1e-12;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/**
 * The names the map made, kept in the plan: each unnamed place takes its name (a generated one stays the
 * generator's, so Reroll places can still replace it), and each named feature of the land goes into land.names.
 * What it kept is noted in land.keptNames ({ places, land }: id to name), so a name set can name those again
 * without touching a name the GM typed. layout: layoutPlan(plan). Returns { plan, places, features } (how many
 * names were kept of each).
 */
export function keepNames(plan, layout) {
  const next = structuredClone(plan);
  const byId = new Map((layout.items ?? []).filter((i) => i.kind === "place").map((i) => [i.from ?? i.id, i]));
  let places = 0, features = 0;
  const was = next.land && typeof next.land.keptNames === "object" && next.land.keptNames ? next.land.keptNames : {};
  const kept = { places: { ...(was.places ?? {}) }, land: { ...(was.land ?? {}) } };
  for (const f of next.features ?? []) {
    if (f.type !== "place" || (typeof f.name === "string" && f.name.trim())) continue;
    const name = byId.get(f.id)?.name;
    if (typeof name !== "string" || !name) continue;
    const generated = untouched(f);
    f.name = name;
    if (generated) f.made = madeMark(f);
    else kept.places[f.id] = name;
    places++;
  }
  const names = next.land && typeof next.land.names === "object" && !Array.isArray(next.land.names) ? { ...next.land.names } : {};
  for (const [id, name] of Object.entries(layout.landNames ?? {})) if (!(typeof names[id] === "string" && names[id].trim())) { names[id] = name; kept.land[id] = name; features++; }
  if (next.land && typeof next.land === "object") { next.land.names = names; next.land.keptNames = kept; }
  return { plan: next, places, features };
}
