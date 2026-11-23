/**
 * The gazetteer of an overland map: what its realms, peoples, towns and points of interest are, as the map made them,
 * for a journal entry the GM keeps (foundry/gazetteer.mjs writes it). From the layout (names, realms, cultures,
 * provinces) and the plan (places, notes, site facts). Pure.
 */
import { placeFacts, peopleWords } from "./facts.mjs";
import { SITE_CLASSES, SECRET_SITES } from "./sites.mjs";

const TITLE = { city: "City", town: "Town", village: "Village", hamlet: "Hamlet" };
const SITE_WORDS = { inn: "Inn", mine: "Mine", quarry: "Quarry", tower: "Watchtower", fort: "Fort", temple: "Shrine", monastery: "Monastery", lighthouse: "Lighthouse", customs: "Customs House", battlefield: "Battlefield", stones: "Standing Stones", barrow: "Barrow", wreck: "Shipwreck", lair: "Lair", cave: "Cave", grove: "Sacred Grove", camp: "Brigands", cove: "Pirates", monster: "Monster", castle: "Castle", ruin: "Ruin", hamlet: "Hamlet" };
// (a made name in the middle of a sentence: "in the Kingdom of Vance")
const mid = (s) => String(s ?? "").replace(/^The /, "the ");
const RELATION_WORDS = { ally: "allied with", friendly: "friendly with", neutral: "at peace with", rival: "a rival of", enemy: "at war with", vassal: "a vassal of", overlord: "overlord of" };

/**
 * The gazetteer's contents: { title, realms: [{ id, name, form, kind, culture, capital, towns: [names], provinces:
 * [names], relations: [words] }], cultures: [{ name, realms: [names] }], places: [{ id, name, cls, at, facts (words),
 * realm }], sites: [{ id, name, cls, at, note, secret }] }. Names the map made, or the plan's own.
 */
export function gazetteerOf(layout, plan) {
  const names = new Map((layout.labels ?? []).filter((l) => String(l.id).startsWith("@place:")).map((l) => [l.id.slice(7), l.text]));
  const feat = new Map((plan.features ?? []).map((f) => [f.id, f]));
  // (a place's name: the plan's own, the layout's made name (marks with no label keep theirs), or its label's)
  const itemName = new Map((layout.items ?? []).filter((i) => i.kind === "place" && typeof i.name === "string" && i.name).map((i) => [i.id, i.name]));
  const nameOf = (id) => feat.get(id)?.name ?? itemName.get(id) ?? names.get(id) ?? null;
  const facts = placeFacts(layout, plan);
  const R = layout.realms?.list ?? [], C = layout.cultures?.list ?? [];
  const items = (layout.items ?? []).filter((i) => i.kind === "place");
  const towns = items.filter((i) => TITLE[i.class]);
  const realmOfPlace = (id) => facts.get(id)?.realm?.id ?? null;
  const realms = R.map((q) => {
    const mine = towns.filter((t) => realmOfPlace(t.id) === q.id);
    return {
      id: q.id, name: q.name ?? q.id, form: q.form ?? "monarchy", kind: q.kind ?? "generic",
      culture: C.find((c) => c.id === q.culture)?.name ?? null,
      capital: q.capital ? nameOf(q.capital) : null,
      towns: mine.filter((t) => t.class === "city" || t.class === "town").map((t) => nameOf(t.id)).filter(Boolean),
      provinces: (layout.realms?.provinces ?? []).filter((P) => R[P.realm]?.id === q.id && P.seat && P.seat !== q.capital).map((P) => layout.landNames?.[`province:${P.seat}`]).filter(Boolean),
      relations: Object.entries(q.relations ?? {}).map(([id, rel]) => { const o = R.find((x) => x.id === id); return o && RELATION_WORDS[rel] ? `${RELATION_WORDS[rel]} ${mid(o.name)}` : null; }).filter(Boolean),
    };
  });
  const cultures = C.map((c) => ({ name: c.name ?? c.id, realms: R.filter((q) => q.culture === c.id).map((q) => q.name).filter(Boolean) }));
  const places = towns.filter((t) => nameOf(t.id)).sort((a, b) => ["city", "town", "village", "hamlet"].indexOf(a.class) - ["city", "town", "village", "hamlet"].indexOf(b.class) || nameOf(a.id).localeCompare(nameOf(b.id))).map((t) => {
    const k = facts.get(t.id);
    const words = [];
    if (k) {
      words.push(`A ${k.kind}${k.capital && k.realm?.name ? `, the capital of ${mid(k.realm.name)}` : ""}.`);
      words.push(`About ${peopleWords(k.people).replace(/^about /, "")} people${k.culture?.name ? `, ${k.culture.name.replace(/^The /, "the ")}` : ""}.`);
      const has = [k.walls ? "walls" : null, k.citadel ? "a citadel" : null, k.temple ? "a temple" : null, k.port ? "a harbor" : null].filter(Boolean);
      if (has.length) words.push(`It has ${has.length > 1 ? `${has.slice(0, -1).join(", ")} and ${has[has.length - 1]}` : has[0]}.`);
      if (k.realm?.name && !k.capital) words.push(`In ${mid(k.realm.name)}${k.province?.name ? `, ${mid(k.province.name)}` : ""}.`);
    }
    return { id: t.id, name: nameOf(t.id), cls: t.class, title: TITLE[t.class], at: [t.x, t.y], facts: words, realm: k?.realm?.name ?? null };
  });
  // (hamlets are among the towns and villages, not the points of interest)
  const sites = items.filter((i) => (SITE_CLASSES.includes(i.class) && !TITLE[i.class]) || i.class === "castle" || i.class === "ruin").map((i) => ({
    id: i.id, name: nameOf(i.id) ?? SITE_WORDS[i.class] ?? i.class, cls: i.class, title: SITE_WORDS[i.class] ?? i.class, at: [i.x, i.y], note: feat.get(i.id)?.note ?? null, secret: SECRET_SITES.includes(i.class),
  }));
  return { title: (typeof plan.name === "string" && plan.name.trim()) || "The Map", realms, cultures, places, sites };
}
