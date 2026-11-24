/**
 * What an overland map knows of each of its towns, decided on the map: whether it's a port, walled, has a citadel or a
 * temple, about how many live there, what kind of town it is, and the realm, its rank, the province and the people it
 * belongs to. Make This Town hands these to the town's own map, and the gazetteer writes them out. From the layout
 * (its realms, provinces, cultures and names) and the plan. Pure.
 */
import { hashAt } from "../rng.mjs";
import { strHash } from "./notes.mjs";
import { SITE_CLASSES } from "./sites.mjs";
import { realmRank } from "./realms.mjs";

// (about how many people, by the place's class: the middle of a range the seed moves a little)
const PEOPLE = { city: 12000, town: 2500, village: 400, hamlet: 60 };
// (a realm's capital, by its rank, holds more)
const CAPITAL = { barony: 1.3, county: 1.6, duchy: 2.2, march: 2.2, kingdom: 3.5, empire: 5 };
const RANK_WORD = /\b(barony|county|duchy|march|kingdom|empire)\b/i;

const roundPeople = (n) => (n >= 10000 ? Math.round(n / 1000) * 1000 : n >= 1000 ? Math.round(n / 100) * 100 : n >= 100 ? Math.round(n / 10) * 10 : Math.round(n / 5) * 5);

/**
 * Each town's facts: Map(place id -> { port, walls, citadel, temple, people, kind, realm: { id, name, rank } | null,
 * capital, province: { seat, name } | null, culture: { id, name } | null, near: [the points of interest within a day,
 * by class] }). layout: the overland layout (items, realms, cultures, landNames, size); plan: the plan (its places'
 * site facts).
 */
export function placeFacts(layout, plan) {
  const out = new Map();
  const features = new Map((plan.features ?? []).map((f) => [f.id, f]));
  const items = (layout.items ?? []).filter((i) => i.kind === "place");
  const R = layout.realms, C = layout.cultures;
  const at = (grid, x, y) => { if (!grid) return -1; const c = Math.floor(x / grid.cell), r = Math.floor(y / grid.cell); return c >= 0 && r >= 0 && c < grid.w && r < grid.h ? grid.ids[r * grid.w + c] : -1; };
  const names = layout.landNames ?? {};
  const capitals = new Map((R?.list ?? []).filter((q) => q.capital).map((q) => [q.capital, q]));
  const sites = items.filter((i) => SITE_CLASSES.includes(i.class) && i.class !== "hamlet");
  const [MW, MH] = layout.size?.squares ?? [1, 1];
  // (a day's travel, about 22 miles, in map squares, never under a square and a half on the biggest maps)
  const mi = (plan.size?.ftPerSquare ?? 5280) / 5280;
  const day = Math.max(1.5, 22 / mi), near1 = Math.max(1.5, 0.4 * day);
  // (a realm's rank from its cells in the map and its towns, for a name that doesn't say it)
  const rankOf = (k) => {
    if (k < 0 || !R?.grid) return null;
    let cells = 0; for (const v of R.grid.ids) if (v === k) cells++;
    const towns = items.filter((i) => (i.class === "city" || i.class === "town") && at(R.grid, i.x, i.y) === k).length;
    return realmRank(cells * (R.grid.cell * mi) ** 2, towns);
  };
  for (const p of items) {
    if (!["city", "town", "village", "hamlet"].includes(p.class)) continue;
    const f = features.get(p.id) ?? {}, site = f.site ?? {};
    const k = at(R?.grid, p.x, p.y), realm = k >= 0 ? R.list[k] : null;
    // (its rank: the word in its name, else from its size and towns as the realms were ranked)
    const rank = realm ? (RANK_WORD.exec(realm.name ?? "")?.[1]?.toLowerCase() ?? rankOf(R.list.indexOf(realm))) : null;
    const cap = capitals.get(p.id);
    // (the province: the one whose land it's on, as the province lines are drawn; else the nearest seat in the realm)
    let province = null;
    const pk = R?.provinceIds ? at({ ...R.grid, ids: R.provinceIds }, p.x, p.y) : -1;
    if (realm && pk >= 0 && R.list[R.provinces?.[pk]?.realm]?.id === realm.id && R.provinces[pk].seat) province = R.provinces[pk];
    else if (realm) {
      let bd = Infinity;
      for (const P of R.provinces ?? []) {
        if (R.list[P.realm]?.id !== realm.id || !P.seat) continue;
        const d = (P.at[0] - p.x) ** 2 + (P.at[1] - p.y) ** 2;
        if (d < bd) { bd = d; province = P; }
      }
    }
    const cu = at(C?.grid, p.x, p.y), culture = cu >= 0 ? C.list[cu] : null;
    const port = !!site.port;
    const near = sites.filter((s) => (s.x - p.x) ** 2 + (s.y - p.y) ** 2 < day * day).map((s) => s.class);
    const h = hashAt(strHash(p.id) % 1000003, 101, plan.seed ?? 1);
    const people = roundPeople((PEOPLE[p.class] ?? 100) * (0.7 + 0.6 * h) * (cap ? CAPITAL[rank] ?? 1.5 : 1) * (port ? 1.25 : 1));
    // (walls: a city, a capital, a town on a border or a frontier; a citadel in a capital city or a frontier city)
    const onBorder = !!realm && (R.borders ?? []).some((b) => b.some((q) => (q[0] - p.x) ** 2 + (q[1] - p.y) ** 2 < near1 ** 2));
    const walls = p.class === "city" || !!cap || (p.class === "town" && onBorder);
    const citadel = p.class === "city" && (!!cap || onBorder);
    const temple = p.class !== "hamlet" && (p.class !== "village" || h > 0.5);
    // (what kind of place it is, in its own class's word: a mining city, a fortress town, a farming hamlet)
    const kind = port ? `port ${p.class}` : `${near.includes("mine") || near.includes("quarry") ? "mining" : citadel || (onBorder && walls) ? "fortress" : site.river && p.class !== "hamlet" ? "river" : p.class === "city" || p.class === "town" ? "market" : "farming"} ${p.class}`;
    out.set(p.id, {
      port, walls, citadel, temple, people, kind,
      realm: realm ? { id: realm.id, name: realm.name ?? null, rank } : null, capital: !!cap,
      province: province && province.seat !== realm?.capital ? { seat: province.seat, name: names[`province:${province.seat}`] ?? null } : null,
      culture: culture ? { id: culture.id, name: culture.name ?? null } : null,
      near,
    });
  }
  return out;
}

/** A number of people in words: "about 4,200". */
export const peopleWords = (n) => `about ${n.toLocaleString("en-US")}`;
