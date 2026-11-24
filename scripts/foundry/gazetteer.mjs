/**
 * Make Gazetteer: an overland map's gazetteer as a journal entry for the GM (land/gazetteer.mjs gives its contents): a
 * page for the map, one per realm, one for its towns and one for its points of interest, the secret ones on a page of
 * their own; and map notes on the scene's towns, each opening its page. GM only: players see neither the entry nor the
 * notes until the GM shares them. Made again, it replaces the entry's pages and the notes it placed.
 */
import { MOD } from "./util.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const para = (s) => `<p>${esc(s)}</p>`;
const items = (list) => (list.length ? `<ul>${list.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");

// (a count in words: "1 realm", "3 realms", "No realms")
const count = (n, one, many, none) => (n ? `${n} ${n === 1 ? one : many}` : none);

/** The pages: [{ name, html, key }] in order. */
export function gazetteerPages(G) {
  const pages = [];
  pages.push({ key: "map", name: G.title, html: [
    para(`${count(G.realms.length, "realm", "realms", "No realms")}, ${count(G.places.length, "town or village", "towns and villages", "no towns")}, ${count(G.sites.filter((s) => !s.secret).length, "point of interest", "points of interest", "no points of interest")}.`),
    G.cultures.length ? `<h2>Peoples</h2>${items(G.cultures.map((c) => `${c.name}${c.realms.length ? `: ${c.realms.join(", ")}` : ""}`))}` : "",
    G.realms.length ? `<h2>Realms</h2>${items(G.realms.map((r) => r.name))}` : "",
  ].join("") });
  for (const r of G.realms) {
    pages.push({ key: `realm:${r.id}`, name: r.name, html: [
      para(`${r.form === "monarchy" ? "A monarchy" : `A ${r.form}`}${r.culture ? ` of ${r.culture.replace(/^The /, "the ")}` : ""}${r.capital ? `, ruled from ${r.capital}` : ""}.`),
      r.relations.length ? `<h2>Neighbors</h2>${items(r.relations.map((x) => `${x[0].toUpperCase()}${x.slice(1)}`))}` : "",
      r.provinces.length ? `<h2>Provinces</h2>${items(r.provinces)}` : "",
      r.towns.length ? `<h2>Towns</h2>${items(r.towns)}` : "",
    ].join("") });
  }
  if (G.places.length) pages.push({ key: "places", name: "Towns and Villages", html: G.places.map((p) => `<h2 id="as-${esc(p.id)}">${esc(p.name)}</h2>${para(`${p.title}. ${p.facts.join(" ")}`)}`).join("") });
  const open = G.sites.filter((s) => !s.secret), hid = G.sites.filter((s) => s.secret);
  if (open.length) pages.push({ key: "sites", name: "Points of Interest", html: open.map((s) => `<h3>${esc(s.name)}</h3>${para(`${s.title}.${s.note ? ` ${s.note}` : ""}`)}`).join("") });
  if (hid.length) pages.push({ key: "secrets", name: "Secrets", html: hid.map((s) => `<h3>${esc(s.name)}</h3>${para(`${s.title}.${s.note ? ` ${s.note}` : ""}`)}`).join("") });
  return pages;
}

// (the secrets page is the GM's alone even when the entry is shared: made with no one else's ownership)
const secretPage = (d) => (d.flags[MOD].gazetteer === "secrets" ? { ...d, ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE } } : d);

/**
 * Makes (or makes again) the gazetteer entry for a plan: G (gazetteerOf's), scene (the scene its map is on, or null:
 * then no map notes), pps (pixels a map unit). Returns { entry, pages, notes }.
 */
export async function makeGazetteer(G, { planId, scene = null, pps = 100 } = {}) {
  const name = `Gazetteer: ${G.title}`;
  const pages = gazetteerPages(G);
  let entry = game.journal.find((j) => j.flags?.[MOD]?.gazetteer === planId);
  const data = pages.map((p, k) => ({ name: p.name, type: "text", sort: (k + 1) * 100, text: { content: p.html, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML }, flags: { [MOD]: { gazetteer: p.key } } }));
  if (entry) {
    // (its own pages updated in place by their key, so their ids and links survive; new ones added, gone ones taken
    // out; pages the GM added and the entry's name, if the GM changed it, are left alone)
    const mine = new Map(entry.pages.filter((p) => typeof p.flags?.[MOD]?.gazetteer === "string").map((p) => [p.flags[MOD].gazetteer, p]));
    const keys = new Set(pages.map((p) => p.key));
    const update = data.filter((d) => mine.has(d.flags[MOD].gazetteer)).map((d) => ({ _id: mine.get(d.flags[MOD].gazetteer).id, name: d.name, sort: d.sort, text: d.text }));
    const create = data.filter((d) => !mine.has(d.flags[MOD].gazetteer)).map(secretPage);
    const gone = [...mine].filter(([k]) => !keys.has(k)).map(([, p]) => p.id);
    if (update.length) await entry.updateEmbeddedDocuments("JournalEntryPage", update);
    if (create.length) await entry.createEmbeddedDocuments("JournalEntryPage", create);
    if (gone.length) await entry.deleteEmbeddedDocuments("JournalEntryPage", gone);
  } else {
    entry = await JournalEntry.create({ name, ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE }, flags: { [MOD]: { gazetteer: planId } }, pages: data.map(secretPage) });
  }
  // map notes on the towns and cities, each opening the towns page; the ones this placed before, on any scene, come out
  let notes = 0;
  const placesPage = entry.pages.find((p) => p.flags?.[MOD]?.gazetteer === "places");
  // (with no scene for the map, the notes already placed stay as they are)
  if (!scene) return { entry, pages: pages.length, notes: 0 };
  const want = G.places.filter((p) => p.cls === "city" || p.cls === "town");
  // (a note this placed before on this scene is updated where it stands, so one the GM moved or restyled keeps that)
  const here = new Map(scene.notes.filter((n) => n.flags?.[MOD]?.gazetteer === planId && typeof n.flags[MOD].place === "string").map((n) => [n.flags[MOD].place, n]));
  const update = want.filter((p) => here.has(p.id)).map((p) => ({ _id: here.get(p.id).id, entryId: entry.id, pageId: placesPage?.id ?? null, text: p.name }));
  const make = want.filter((p) => !here.has(p.id)).map((p) => ({
    entryId: entry.id, pageId: placesPage?.id ?? null, x: Math.round(scene.dimensions.sceneX + p.at[0] * pps), y: Math.round(scene.dimensions.sceneY + p.at[1] * pps),
    text: p.name, iconSize: 32, fontSize: 18, global: false, flags: { [MOD]: { gazetteer: planId, place: p.id } },
  }));
  if (update.length) await scene.updateEmbeddedDocuments("Note", update);
  const created = make.length ? await scene.createEmbeddedDocuments("Note", make) : [];
  const keep = new Set([...created.map((n) => n.id), ...update.map((u) => u._id)]);
  // (the rest it placed, on this scene or another, come out)
  for (const sc of game.scenes) {
    const old = sc.notes.filter((n) => n.flags?.[MOD]?.gazetteer === planId && !keep.has(n.id)).map((n) => n.id);
    if (old.length) await sc.deleteEmbeddedDocuments("Note", old);
  }
  notes = keep.size;
  return { entry, pages: pages.length, notes };
}
