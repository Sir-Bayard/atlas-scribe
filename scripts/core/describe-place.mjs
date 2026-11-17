/**
 * Quick Start's settlement Describe box: a description in plain words into Quick Start's choices (quick.mjs), from a
 * fixed set of words with no AI, shown as chips the GM can take out. "A walled port city with a cathedral, a citadel
 * and no slums" reads as a city on a sea coast, a cathedral at its center, a citadel, and no poor quarter. Pure.
 */
import { QUICK_LABELS, QUARTERS, CENTERS } from "./quick.mjs";

/** Words for each choice (lowercase; a word's plural is matched too). */
const WORDS = {
  size: { hamlet: ["hamlet", "handful of houses"], village: ["village"], town: ["town", "market town"], city: ["city"], metropolis: ["metropolis", "capital", "great city", "huge city", "vast city", "sprawling city"] },
  season: { spring: ["spring", "springtime"], summer: ["summer", "summertime"], autumn: ["autumn", "fall", "autumnal"], winter: ["winter", "wintry", "snowy", "snow"] },
  water: { river: ["river", "riverside", "on a river", "by a river"], stream: ["stream", "creek", "brook"], coast: ["coast", "coastal", "sea", "seaside", "port", "seaport", "harbor", "bay"], lake: ["lake", "lakeside", "lakeshore"], estuary: ["estuary", "river mouth", "delta"] },
  roads: { crossroads: ["crossroads", "crossroad", "junction", "crossing roads"], fork: ["fork", "forked road", "fork in the road"], through: ["road through", "along a road", "along the road", "on a road", "roadside"] },
  surroundings: { farmland: ["farmland", "farms", "fields", "farming", "pasture"], woodland: ["woods", "woodland", "forest", "forested", "wooded"], open: ["open ground", "open country", "moor", "moorland", "heath", "plains", "grassland", "steppe"] },
  center: { square: ["square", "market square", "marketplace", "plaza", "market"], green: ["green", "village green"], well: ["a well", "the well", "village well", "town well"], cathedral: ["cathedral"], palace: ["palace"] },
  river: { island: ["island"], loop: ["loop", "looping", "oxbow"], meeting: ["two rivers", "confluence", "rivers meeting", "meeting rivers"], meander: ["winding", "bending", "meandering"] },
  shape: { compact: ["compact", "round", "circular"], lobed: ["lobed", "uneven", "irregular"], promontory: ["promontory", "peninsula", "headland", "cape"], shore: ["along the shore", "along the river", "strung out", "long and thin"], cliff: ["cliff", "cliffs", "escarpment", "clifftop", "bluff"] },
};
/** A village's or town's buildings and places. */
const HAS_WORDS = { temple: ["temple", "church", "chapel", "shrine"], inn: ["inn", "tavern", "pub", "alehouse"], smithy: ["smithy", "blacksmith", "forge", "smith"], cemetery: ["cemetery", "graveyard", "churchyard", "burial ground"], watermill: ["watermill", "water mill"], windmill: ["windmill", "wind mill"], walled: ["walled", "walls", "wall", "palisade", "stockade", "fortified", "fortifications"] };
/** A city's quarters. */
const QUARTER_WORDS = { docks: ["docks", "dockside", "wharf", "waterfront", "harbor quarter"], market: ["market quarter", "market ward", "markets"], temple: ["temple quarter", "temple ward", "temples"], nobles: ["nobles", "noble quarter", "rich quarter", "wealthy", "estates", "high ward"], crafts: ["crafts", "craftsmen", "artisans", "workshops", "craft quarter"], poor: ["poor quarter", "poor", "slum", "slums", "shanties", "squalid", "low ward"], garrison: ["garrison", "barracks"], merchants: ["merchants", "merchant quarter", "trade quarter"] };
/** What a city has outside its wards. */
const OUTSIDE_WORDS = { citadel: ["citadel", "castle", "castle keep", "fortress", "stronghold"], oldWall: ["old wall", "inner wall", "two walls", "double walls", "old town"], suburbs: ["suburbs", "suburb", "outskirts", "faubourg"], cemetery: HAS_WORDS.cemetery, mills: ["mill", "mills", "watermill", "windmill", "water mill", "wind mill"] };
const OUTSIDE_LABELS = { citadel: "A citadel", oldWall: "An old inner wall", suburbs: "Suburbs", cemetery: "A cemetery", mills: "Mills" };
const HAS_LABELS = { temple: "A temple", inn: "An inn", smithy: "A smithy", cemetery: "A cemetery", watermill: "A watermill", windmill: "A windmill", walled: "Walled" };
const NO_HAS = { walled: "No wall" };
const QUARTER_LABELS = { docks: "docks", market: "market", temple: "temple", nobles: "nobles'", crafts: "crafts", poor: "poor", garrison: "garrison", merchants: "merchants'" };
const CENTER_LABELS = { square: "A market square", green: "A green", well: "A well", cathedral: "A cathedral", palace: "A palace", none: "No center" };
/** Words not worth reporting as not understood. */
const STOP = new Set(`sprawling among amid i me my we our you your it its a an the and or but of in on at by to for from with into onto over under near beside along across around between through up down out off is are be been being was were has have had having do does did need needs want wants like would could should can will make made makes give gives map place settlement area some any all this that these those there here where which who what when while then than so very really just also plus please something somewhere lots lot sort kind type bit little more most much one ones side sides middle center centre edge top bottom left right north south east west inside outside near far nearby next close nice good cool big small large tiny huge old new quarter quarters ward wards district districts without not never nor no yes`.split(/\s+/)); // (read in British spelling too)
const CITIES = ["city", "metropolis"];

const escRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// (a word joined to the next by a hyphen isn't that word: "well-defended")
const pattern = (p) => new RegExp(`\\b${escRe(p).replace(/ /g, "\\s+")}(?:s|es)?\\b(?!-)`, "g");
/** The longest description read; the rest is left out. */
const MAX_TEXT = 2000;

/**
 * Reads a description. Returns { choices, chips, skipped, unknown }: choices, only what it found (size, season,
 * water, roads, surroundings, center, river, shape, name, has: { ... }, quarters: [...] when one is left out,
 * outside: { ... }); chips, what it understood, each { key, value, label }; skipped, what it read but couldn't use
 * for the size ({ label, why }); unknown, the words it didn't know. opts.size, a size chosen elsewhere (in the form),
 * is the size it reads for in place of the one it says; opts.water, the water chosen there, says what "a mill" is when
 * the description names no water.
 */
export function readPlace(text = "", opts = {}) {
  const raw = String(text ?? "").slice(0, MAX_TEXT);
  const lower = raw.toLowerCase().replace(/[’']/g, "'");
  const choices = {}, chips = [], skipped = [], used = [];
  const chip = (key, value, label) => { if (!chips.some((c) => c.key === key)) chips.push({ key, value, label }); };
  const find = (p) => [...lower.matchAll(pattern(p))].map((m) => ({ at: m.index, end: m.index + m[0].length }));
  const mark = (words) => words.forEach((w) => find(w).forEach((m) => used.push([m.at, m.end])));
  // ("no" covers a list joined by "or": "without a temple, inn or smithy" and "no inn or a temple", but not "no temple,
  // an inn", "no temple and an inn" nor "no walls, a temple, an inn or a smithy": after a comma an item with "a" or
  // "the" starts something new)
  const ART = /^(?:a|an|any|the|its)\b/;
  /** A list's pieces, items and separators by turns ([item, sep, item, ...]), or null if it's more than a list. */
  const pieces = (str) => {
    const t = str.split(/(,|\bor\b|\bnor\b)/).map((x) => x.trim());
    return t.some((x, k) => k % 2 === 0 && (x.split(/\s+/).length > 4 || /[.;:!?]/.test(x))) ? null : t;
  };
  const negated = (m) => {
    const before = lower.slice(Math.max(0, m.at - 80), m.at);
    const neg = [...before.matchAll(/\b(?:no|without|not|never|nor)\b/g)].pop();
    if (!neg) return false;
    // (between "no" and the word: earlier items, each closed by a separator, then the word's own "a" if any)
    const t = pieces(before.slice(neg.index + neg[0].length));
    if (!t || t.slice(0, -1).some((x, k) => k % 2 === 0 && !x) || !/^(?:(?:a|an|any|the|its))?$/.test(t.at(-1))) return false;
    if (t.some((x, k) => k % 2 === 1 && x === "," && ART.test(t[k + 1]))) return false;
    if (t.length === 1 || t.some((x, k) => k % 2 === 1 && x !== ",")) return true;
    // (a list joined only by commas so far: "no" covers it if it goes on to "or")
    const a = pieces(lower.slice(m.end, m.end + 80).split(/[.;:!?]/)[0]);
    if (!a || a[0]) return false;
    for (let k = 1; k < a.length; k += 2) {
      if (a[k] !== ",") return true;
      if (ART.test(a[k + 1] ?? "")) return false;
    }
    return false;
  };
  /** Each value of a group whose words occur, with whether it's said with "no": [{ value, no, at }]. */
  // (a word inside a phrase said with "no" is said with "no" too: "not on a river" holds "river")
  const hits = (group) => {
    const h = Object.entries(group).flatMap(([value, words]) => words.flatMap((w) => find(w).map((m) => ({ value, no: negated(m), at: m.at, end: m.end }))));
    for (const x of h) if (!x.no && h.some((y) => y.no && y.value === x.value && y.at <= x.at && y.end >= x.end)) x.no = true;
    return h;
  };
  /** The first value of a group said (not with "no"), marking its words read; null if none. */
  const first = (group) => {
    const h = hits(group).filter((x) => !x.no && !inName(x)).sort((a, b) => a.at - b.at)[0];
    mark(Object.values(group).flat());
    return h?.value ?? null;
  };

  // A name: in quotes or capitalized after "called" or "named"
  const named = raw.match(/\b(?:called|named)\s+(?:["“]([^"”]{1,60})["”]|['‘]((?:[^'’]|['’]\w){1,60})['’](?!\w)|((?:the\s+)?(?:[A-Z][\w'-]*)(?:\s+(?!(?:In|On|At|By|With|And|Near|During|Beside|Along|Among)\b)[A-Z][\w'-]*){0,3}))/);
  if (named) {
    const n = (named[1] ?? named[2] ?? named[3]).trim().replace(/^the\s+/, "The ");
    choices.name = n;
    chip("name", n, `Named ${n}`);
    used.push([named.index, named.index + named[0].length]);
  }
  // (words inside the name aren't read as anything else)
  const inName = (m) => named && m.at >= named.index && m.end <= named.index + named[0].length;

  // Size first: the rest depends on it
  const size = (() => {
    const h = hits(WORDS.size).filter((x) => !inName(x)).sort((a, b) => (b.end - b.at) - (a.end - a.at) || a.at - b.at);
    mark(Object.values(WORDS.size).flat());
    // (the longest phrase wins: "great city" over "city")
    return h[0]?.value ?? null;
  })();
  if (size) { choices.size = size; chip("size", size, QUICK_LABELS.size[size].replace(/ \(.*$/, "")); }
  // (what follows is read for the size chosen in the form, if one is, else the one said)
  const asSize = QUICK_LABELS.size[opts.size] ? opts.size : size;
  const city = CITIES.includes(asSize);

  const season = first(WORDS.season);
  if (season) { choices.season = season; chip("season", season, QUICK_LABELS.season[season]); }

  // Water: "no river" or "inland" says none
  const wh = hits(WORDS.water).filter((x) => !inName(x));
  mark(Object.values(WORDS.water).flat());
  // (the first said, the longer phrase where two start together: "river mouth" over "river")
  const noWater = find("inland").length || find("dry").filter((m) => !inName(m)).length || find("water").some((m) => negated(m));
  const water = wh.filter((x) => !x.no).sort((a, b) => a.at - b.at || (b.end - b.at) - (a.end - a.at))[0]?.value ?? (wh.some((x) => x.no) || noWater ? "none" : null);
  mark(["inland", "dry", "water"]);
  if (water) {
    if (!city && ["coast", "lake", "estuary"].includes(water)) skipped.push({ label: water === "coast" ? "the sea" : water, why: "A sea coast, a lake or an estuary is a city's (a village or town by the sea or a lake gets a river)" });
    else if (city && water === "stream") { choices.water = "river"; chip("water", "river", QUICK_LABELS.water.river); }
    else { choices.water = water; chip("water", water, QUICK_LABELS.water[water].replace(/ \(a city\)$/, "")); }
  }

  const roads = first(WORDS.roads);
  if (roads) { choices.roads = roads; chip("roads", roads, QUICK_LABELS.roads[roads]); }
  // (fields and woods both said: farms and woods)
  const sur = hits(WORDS.surroundings).filter((x) => !x.no && !inName(x));
  mark(Object.values(WORDS.surroundings).flat());
  const kinds = [...new Set(sur.map((x) => x.value))];
  const surroundings = kinds.includes("farmland") && kinds.includes("woodland") ? "mixed" : kinds[0] ?? null;
  if (surroundings) { choices.surroundings = surroundings; chip("surroundings", surroundings, QUICK_LABELS.surroundings[surroundings]); }

  // The center: a square, a green, a well, or (a city's) a cathedral or palace; "no square" says none
  // ("green hills" or "green fields" aren't a green)
  const ch = hits(WORDS.center).filter((x) => !inName(x) && !(x.value === "green" && /^\s+(?:hills?|fields?|valleys?|meadows?|woods?|forests?|country|land|pastures?)\b/.test(lower.slice(x.end))) && !(/^markets?$/.test(lower.slice(x.at, x.end)) && (lower.slice(x.at, x.end) === "markets" || /^\s+(?:quarter|ward|town|square|place|hall)s?\b/.test(lower.slice(x.end)))));
  mark(Object.values(WORDS.center).flat());
  const centerSaid = ch.filter((x) => !x.no).sort((a, b) => a.at - b.at)[0]?.value ?? (ch.some((x) => x.no && ["square", "green"].includes(x.value)) ? "none" : null);
  if (centerSaid) {
    const sz = asSize ?? "village";
    if (CENTERS[sz]?.includes(centerSaid) || centerSaid === "none") { choices.center = centerSaid; chip("center", centerSaid, CENTER_LABELS[centerSaid]); }
    else if (["cathedral", "palace"].includes(centerSaid)) {
      // (a village's or town's cathedral is its temple)
      if (centerSaid === "cathedral") { (choices.has ??= {}).temple = true; chip("has.temple", true, HAS_LABELS.temple); }
      else skipped.push({ label: "palace", why: "A palace stands at a city's center" });
    } else skipped.push({ label: centerSaid, why: "A city's center is a square, a green or a landmark beside a square" });
  }

  // A city's river and outline
  for (const k of ["river", "shape"]) {
    const v = first(WORDS[k]);
    if (!v) continue;
    if (!city) { skipped.push({ label: v === "shore" ? "along the shore" : v, why: k === "river" ? "A river's form is a city's" : "An outline is a city's" }); continue; }
    if (k === "river" && choices.water && choices.water !== "river") { skipped.push({ label: v, why: "A river's form needs a river" }); continue; }
    choices[k] = v;
    chip(k, v, QUICK_LABELS[k][v]);
  }

  if (city) {
    // Quarters: all of them unless some are said with "no"
    const qh = hits(QUARTER_WORDS);
    mark(Object.values(QUARTER_WORDS).flat());
    const left = [...new Set(qh.filter((x) => x.no).map((x) => x.value))].filter((q) => !qh.some((x) => x.value === q && !x.no));
    if (left.length) {
      choices.quarters = QUARTERS.filter((q) => !left.includes(q));
      for (const q of left) chip(`quarters.${q}`, false, `No ${QUARTER_LABELS[q]} quarter`);
    }
    // ("walled": a city is always walled)
    mark(HAS_WORDS.walled);
    const oh = hits(OUTSIDE_WORDS).filter((x) => !inName(x));
    mark(Object.values(OUTSIDE_WORDS).flat());
    for (const k of Object.keys(OUTSIDE_WORDS)) {
      const said = oh.filter((x) => x.value === k);
      if (!said.length) continue;
      const v = !said.some((x) => !x.no) ? false : true;
      if (k === "oldWall" && asSize !== "metropolis" && v) { skipped.push({ label: "an old wall", why: "An old inner wall is a metropolis's" }); continue; }
      (choices.outside ??= {})[k] = v;
      chip(`outside.${k}`, v, v ? OUTSIDE_LABELS[k] : `No ${OUTSIDE_LABELS[k].replace(/^(?:A|An) /, "").toLowerCase()}`);
    }
    // (a village's buildings said of a city: its wards have them already)
    // (not the temple of "temple quarter" or "temples")
    const vh = hits({ temple: HAS_WORDS.temple, inn: HAS_WORDS.inn, smithy: HAS_WORDS.smithy }).filter((x) => !qh.some((q) => x.at < q.end && q.at < x.end));
    mark([...HAS_WORDS.temple, ...HAS_WORDS.inn, ...HAS_WORDS.smithy]);
    if (vh.length) skipped.push({ label: lower.slice(vh[0].at, vh[0].end), why: "A city's wards have their temples, inns and smiths already" });
  } else {
    // A village's or town's buildings and places: said, or said with "no"
    const hh = hits(HAS_WORDS).filter((x) => !inName(x));
    mark(Object.values(HAS_WORDS).flat());
    for (const m of [...find("unwalled"), ...find("unfortified")].filter((m) => !inName(m))) hh.push({ value: "walled", no: true, at: m.at, end: m.end });
    mark(["unwalled", "unfortified"]);
    // ("mill" alone: a watermill by water, else a windmill)
    const mills = find("mill").concat(find("mills")).filter((m) => !inName(m));
    mark(["mill", "mills"]);
    const wet = water ?? (opts.water || null);
    for (const m of mills) hh.push({ value: wet && wet !== "none" ? "watermill" : "windmill", no: negated(m), at: m.at, end: m.end });
    for (const k of Object.keys(HAS_WORDS)) {
      const said = hh.filter((x) => x.value === k);
      if (!said.length) continue;
      const v = said.some((x) => !x.no);
      if (k === "watermill" && v && wet === "none") { skipped.push({ label: "a watermill", why: "A watermill needs a river or a stream" }); continue; }
      (choices.has ??= {})[k] = v;
      chip(`has.${k}`, v, v ? HAS_LABELS[k] : NO_HAS[k] ?? `No ${HAS_LABELS[k].replace(/^(?:A|An) /, "").toLowerCase()}`);
    }
    // (a city's quarters and citadel said of a village or town)
    const qh = [...hits(QUARTER_WORDS), ...hits({ citadel: OUTSIDE_WORDS.citadel, suburbs: OUTSIDE_WORDS.suburbs, oldWall: OUTSIDE_WORDS.oldWall })].filter((x) => !inName(x)).sort((a, b) => a.at - b.at);
    mark([...Object.values(QUARTER_WORDS).flat(), ...OUTSIDE_WORDS.citadel, ...OUTSIDE_WORDS.suburbs, ...OUTSIDE_WORDS.oldWall]);
    if (qh.length) skipped.push({ label: lower.slice(qh[0].at, qh[0].end), why: qh[0].value === "oldWall" ? "An old inner wall is a metropolis's" : "Quarters, a citadel and suburbs are a city's: pick a city or a metropolis" });
  }

  // The words it didn't know: outside every span read, but small words and numbers
  const unknown = [];
  for (const m of lower.matchAll(/[a-z][a-z-]*/g)) {
    const w = m[0], at = m.index, end = at + w.length;
    if (STOP.has(w) || w.length < 3 || used.some(([s, e]) => at >= s && end <= e)) continue;
    if (!unknown.includes(w)) unknown.push(w);
  }
  if (String(text ?? "").length > MAX_TEXT) skipped.push({ label: "the rest", why: `Only the first ${MAX_TEXT} characters are read` });
  return { choices, chips, skipped, unknown: unknown.slice(0, 8) };
}

/** Choices with a chip taken out: that choice back to the seed's (a quarter back in; a has or outside key gone). */
export function placeWithout(choices, chip) {
  const out = structuredClone(choices ?? {});
  const [k, sub] = String(chip.key).split(".");
  if (k === "quarters") { out.quarters = [...new Set([...(out.quarters ?? []), sub])]; if (QUARTERS.every((q) => out.quarters.includes(q))) delete out.quarters; }
  else if (sub) { if (out[k]) { delete out[k][sub]; if (!Object.keys(out[k]).length) delete out[k]; } }
  else delete out[k];
  return out;
}
