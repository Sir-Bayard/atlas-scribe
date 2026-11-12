/**
 * The Describe box's reader: a description in plain words into a battle map's brief (brief.mjs), from a fixed set of
 * words with no AI, works offline, and shows what it understood as chips the GM can take out. "A wilderness map on a
 * cliff, in summer, littered with trees, stumps and logs" reads as a wilderness with a cliff, in summer, trees thick,
 * stumps and logs lots. Room words go into the building's Rooms, a cellar and floors above into its own. Pure.
 */
import { BRIEF_LABELS, SITE_LACKS } from "./brief.mjs";

/** Words for each choice (single words or phrases, lowercase; a word's plural and -y forms are matched too). */
const WORDS = {
  season: { spring: ["spring", "springtime"], summer: ["summer", "summertime"], autumn: ["autumn", "fall", "autumnal"], winter: ["winter", "wintry", "wintertime"] },
  time: { day: ["day", "daytime", "daylight", "noon", "midday", "afternoon", "morning"], dawn: ["dawn", "sunrise", "daybreak"], dusk: ["dusk", "sunset", "twilight", "evening", "nightfall"], night: ["night", "nighttime", "midnight"] },
  weather: { rain: ["rain", "rainy", "raining", "storm", "stormy", "downpour", "drizzle"], fog: ["fog", "foggy", "mist", "misty"], snow: ["snow", "snowing", "snowy", "blizzard", "snowfall"], none: ["clear"] },
  ground: { forest: ["forest", "woods", "woodland", "wooded", "jungle"], clearing: ["clearing", "glade"], open: ["open ground", "open country", "field", "fields", "meadow", "meadows", "plain", "plains", "grassland", "countryside"], hills: ["hills", "hilly", "hillside", "hilltop"] },
  features: { road: ["road", "path", "track", "trail", "highway", "lane", "roadside"], stream: ["stream", "creek", "brook", "river"], pond: ["pond", "lake", "pool"], cliff: ["cliff", "cliffs", "cliffside", "ledge", "bluff", "escarpment", "precipice"], rise: ["rise", "hill", "knoll", "mound", "hillock", "ridge"], hollow: ["hollow", "dip", "ravine", "gully", "depression", "sinkhole", "pit"] },
  use: { inn: ["inn", "tavern", "alehouse", "roadhouse", "pub"], farmstead: ["farm", "farmstead", "farmhouse", "homestead"], shrine: ["shrine", "chapel", "temple"], smithy: ["smithy", "forge", "blacksmith", "smith"], watchtower: ["watchtower", "tower", "outpost", "lookout"] },
  place: { hamlet: ["hamlet"], village: ["village"], town: ["town"], city: ["city"] },
  quarter: { market: ["market", "marketplace", "bazaar"], merchants: ["merchants", "merchant"], crafts: ["crafts", "craftsmen", "artisans", "workshops"], docks: ["docks", "harbor", "wharf", "waterfront", "port"], nobles: ["nobles", "noble", "rich", "wealthy", "estates"], temple: ["temple", "temples", "cathedral"], poor: ["poor", "slum", "slums", "squalid"], garrison: ["garrison", "barracks"] },
  camp: { caravan: ["caravan", "wagons", "wagon"], soldiers: ["soldiers", "army", "military", "troops", "mercenaries", "warband", "legion"], campsite: ["campsite", "campfire"] },
  size: { small: ["small", "tiny", "little", "cramped"], medium: ["medium", "medium-sized", "mid-sized", "modest"], large: ["large", "big", "huge", "vast", "wide", "sprawling", "spacious", "grand"] },
  towers: { roofed: ["roofed towers", "roofed tower", "tower roofs", "conical roofs", "cone roofs", "pointed roofs", "spires", "spire"], open: ["battlements", "crenellated", "crenelated", "crenellations", "open towers", "open tower"] },
};
/** Words that name the site: a wilderness, a camp, a street or a castle. */
const SITE_WORDS = { wilderness: ["wilderness", "wild", "wilds"], camp: ["camp", "encampment", "bivouac", "tents", "tent"], street: ["street", "streets", "quarter", "square"], castle: ["castle", "fort", "fortress", "stronghold", "citadel", "bailey", "curtain wall", "ramparts", "rampart"] };
/** A castle's size from its own word, when no size is said: a fort small, a fortress or great castle large. */
const CASTLE_SIZE_WORDS = { small: ["fort", "small castle"], large: ["fortress", "great castle", "great fortress", "citadel"] };
/** Scattered things, and how much. */
const SCATTER_ITEMS = { trees: ["trees", "tree"], litter: ["stumps", "stump", "logs", "log", "deadfall", "fallen"], rocks: ["rocks", "rock", "boulders", "boulder", "stones"], brush: ["bushes", "bush", "shrubs", "shrub", "undergrowth", "ferns", "fern", "brush", "brambles"] };
const AMOUNTS = { lots: ["lots", "lot", "many", "littered", "full", "plenty", "strewn", "covered", "dense", "thick", "overgrown", "heavy", "packed", "loads"], some: ["some", "several", "scattered", "occasional", "with"], few: ["few", "sparse", "sparsely", "handful", "couple", "light", "thin"], none: ["no", "without", "barren", "treeless"] };
/** A level per scattered thing, by amount (trees as a wood's density). */
const LEVEL = { trees: { lots: "thick", some: "open", few: "sparse", none: "none" }, litter: { lots: "lots", some: "some", few: "few", none: "none" }, rocks: { lots: "lots", some: "some", few: "few", none: "none" }, brush: { lots: "lots", some: "some", few: "few", none: "none" } };
/** Room words, into the Rooms setting. */
const ROOM_WORDS = {
  common: ["tavern area", "taproom", "common room", "bar room", "tavern room", "drinking hall", "hall"],
  stage: ["stage", "performing", "performance", "performances", "bard", "bards", "music"],
  bar: ["bar", "counter"],
  kitchen: ["kitchen", "kitchens"],
  store: ["storeroom", "store room", "storage", "pantry"],
  bedroom: ["rooms for rent", "rooms to rent", "guest rooms", "guest room", "bedrooms", "bedroom", "rooms to let"],
};
/** Words that put a room or a thing on another floor: a cellar, or floors above (each a level of the scene). */
const LATER = { cellar: ["cellar", "cellars", "basement", "undercroft"], upstairs: ["upstairs", "upper floor", "second floor", "first floor", "attic", "loft", "upper floors", "two floors", "three floors", "2 floors", "3 floors", "stories", "storeys", "story", "storey"] }; // (read in British spelling too)
const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, a: 1, an: 1, single: 1, pair: 2, dozen: 12 };
/** Words not worth reporting as not understood. */
const STOP = new Set(`i me my we our you your it its a an the and or but of in on at by to for from with into onto over under near beside along across around between through up down out off is are be been being was were has have had having do does did need needs want wants like would could should can will make made makes give gives map battlemap battle scene place area spot set setting some any all this that these those there here where which who what when while then than so very really just also plus please something somewhere filled full lots lot sort kind type bit little more most much one ones side sides back front middle center centre edge edges top bottom left right north south east west inside outside around near far nearby next close open nice good cool interesting dark`.split(/\s+/)); // (read in British spelling too)

const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A phrase as a pattern over the text's words, its plurals too (inn, inns; pony, ponies). */
const pattern = (p) => new RegExp(`\\b${esc(p).replace(/ /g, "\\s+")}(?:s|es)?\\b`, "g");

/**
 * Reads a description. Returns { brief, chips, later, skipped, unknown }: brief, only the choices it found; chips,
 * what it understood, each { key, value, label } (key the brief's field, "building.use" and so on); later, always
 * empty (kept for the window); skipped, what it read but left out for the site ({ label, why }); unknown, the words
 * it didn't know.
 */
export function readDescription(text = "") {
  const raw = String(text ?? "");
  const lower = raw.toLowerCase().replace(/[’']/g, "'");
  const brief = {}, chips = [], later = [];
  const used = []; // ([start, end] spans of the text read)
  const chip = (key, value, label) => { if (!chips.some((c) => c.key === key && c.value === value)) chips.push({ key, value, label }); };
  /** Every place a phrase occurs: [{ at, end }]. */
  const find = (p) => [...lower.matchAll(pattern(p))].map((m) => ({ at: m.index, end: m.index + m[0].length }));
  // (a size said of a road or water, "a wide road", "a big river", isn't the map's or the building's)
  const ofWay = (m) => /^\s+(?:dirt\s+|stone\s+|old\s+)?(?:road|roads|street|streets|lane|track|path|highway|river|stream|creek|brook|pond|lake)\b/.test(lower.slice(m.end, m.end + 24));
  /** The first value of a group whose words occur, marking them read; null if none. */
  const first = (group) => {
    let best = null;
    for (const [value, words] of Object.entries(group)) for (const w of words) for (const m of find(w)) if ((!best || m.at < best.m.at) && !(group === WORDS.size && ofWay(m))) best = { value, m, w };
    if (!best) return null;
    for (const words of Object.values(group)) for (const w of words) for (const m of find(w)) used.push([m.at, m.end]);
    return best.value;
  };
  const all = (group) => Object.entries(group).filter(([, words]) => words.some((w) => find(w).length)).map(([v, words]) => { words.forEach((w) => find(w).forEach((m) => used.push([m.at, m.end]))); return v; });
  const mentions = (words) => words.some((w) => find(w).length);
  const mark = (words) => words.forEach((w) => find(w).forEach((m) => used.push([m.at, m.end])));

  // A name in quotes after "called" or "named": the building's (or the map's)
  // (in double quotes, or single ones: "Edric's Holding", 'The Gray Gull')
  const named = raw.match(/\b(?:called|named)\s+(?:["“]([^"”]{1,60})["”]|['‘]((?:[^'’]|['’]\w){1,60})['’](?!\w))/i);
  if (named && named[1] === undefined) named[1] = named[2];
  if (named) used.push([named.index, named.index + named[0].length]);

  // A cellar and floors above, and the rooms said to be there ("a cellar filled with casks", "an upstairs with 7 rooms
  // for rent"): each clause read on its own, for the building's cellar and floors (a building by a road's)
  const laterSpans = [], floorsSaid = [];
  for (const [what, words] of Object.entries(LATER)) for (const w of words) for (const m of find(w)) {
    // (the clause it's in: to the nearest comma, "and" or period either side)
    const before = lower.slice(0, m.at), after = lower.slice(m.end);
    const s = Math.max(before.lastIndexOf(","), before.lastIndexOf(" and "), before.lastIndexOf("."), before.lastIndexOf(";")) + 1;
    const e0 = after.search(/,|\.|;|\band\b/); const e = e0 < 0 ? lower.length : m.end + e0;
    const clause = (raw.length === lower.length ? raw : lower).slice(s, e).trim().replace(/^(?:and|with)\s+/i, "").replace(/^(?:a|an|the)\s+/i, "");
    laterSpans.push([s, e]);
    used.push([s, e]);
    // (every clause of a kind read together: "upstairs rooms, three floors" says both how many floors and what's there)
    // ("no cellar", "without an upstairs", "a single-story inn": none, said so)
    const no = /\b(?:no|without|not|never|nor)\s+(?:a\s+|an\s+|any\s+|the\s+)?$/.test(before.slice(-20)) || (what === "upstairs" && /\b(?:single|one)[\s-]+stor(?:y|ey)\b/.test(lower.slice(Math.max(0, m.at - 8), m.end)));
    const had = floorsSaid.find((l) => l.what === what), text = lower.slice(s, e);
    if (!had) floorsSaid.push({ what, word: w, text, label: clause, no });
    else { if (!had.text.includes(text)) had.text += ` ; ${text}`; had.no = had.no && no; }
  }
  const inLater = (m) => laterSpans.some(([s, e]) => m.at >= s && m.end <= e);

  // What kind of site: a building's words make a roadside, a camp's a camp, a place's a street, else a wilderness (a
  // caravan or soldiers make a camp only with no building or place said; "a village inn" is an inn by its road, the
  // village skipped)
  const useHits = Object.values(WORDS.use).flat().flatMap((w) => find(w));
  const use = first(WORDS.use);
  const place = first(WORDS.place);
  const camp = mentions(SITE_WORDS.camp) || (!use && !place && (mentions(WORDS.camp.caravan) || mentions(WORDS.camp.soldiers)));
  const streetWords = mentions(SITE_WORDS.street);
  // (a castle's words make a castle, whatever else is said: its towers, yard and keep are its own)
  const castle = mentions(SITE_WORDS.castle);
  if (castle) { brief.site = "castle"; mark(SITE_WORDS.castle); }
  else if (camp) { brief.site = "camp"; mark(SITE_WORDS.camp); }
  else if (streetWords || (place && !use)) { brief.site = "street"; mark(SITE_WORDS.street); }
  else if (use) brief.site = "roadside";
  else if (mentions(SITE_WORDS.wilderness)) { brief.site = "wilderness"; mark(SITE_WORDS.wilderness); }
  for (const k of ["season", "time", "weather", "ground"]) { const v = first(WORDS[k]); if (v) brief[k] = v; }
  if (!brief.site && (brief.ground || mentions(Object.values(WORDS.features).flat()))) brief.site = "wilderness";
  if (brief.site) chip("site", brief.site, BRIEF_LABELS.site[brief.site]);
  const skipped = [];
  if (place && brief.site !== "street") skipped.push({ label: place, why: brief.site === "camp" ? "A camp stands in the country" : brief.site === "castle" ? "A castle stands on its own" : "A building by a road stands on its own: pick Village or town street for a street" });
  if (brief.weather === "snow" && !brief.season) brief.season = "winter";

  // Size: of the building when there is one ("a wide open tavern area", "a big inn"), else of the map
  const size = first(WORDS.size);
  if (size && brief.site === "roadside") { brief.building = { ...brief.building, size }; chip("building.size", size, `${BRIEF_LABELS.buildingSize[size]} building`); }
  else if (brief.site === "castle") {
    // (a castle's size is the castle's: a fort, a castle, a great castle; said, or from its own word)
    const own = size ?? Object.keys(CASTLE_SIZE_WORDS).find((k) => CASTLE_SIZE_WORDS[k].some((w) => find(w).length));
    if (own) { brief.size = own; chip("size", own, BRIEF_LABELS.castleSize[own].replace(/ \(.*$/, "")); }
    mark(Object.values(CASTLE_SIZE_WORDS).flat());
    const towers = first(WORDS.towers);
    if (towers) { brief.castle = { towers }; chip("castle.towers", towers, towers === "open" ? "Towers open, with battlements" : "Towers roofed"); }
    mark(Object.values(WORDS.towers).flat());
    // (its towers are its own; any other building is one of its yard's, which come with its size)
    const other = useHits.filter((m) => !WORDS.use.watchtower.some((w) => lower.slice(m.at, m.end).startsWith(w)));
    mark(WORDS.use.watchtower);
    if (other.length) skipped.push({ label: lower.slice(other[0].at, other[0].end), why: "A castle's yard buildings come with its size" });
  }
  else if (size) { brief.size = size; chip("size", size, `${BRIEF_LABELS.size[size].split(" ")[0]} map`); }

  // The site's own: the building's use, the place and quarter, the camp's kind and tents
  if (brief.site === "roadside" && use) { brief.building = { ...brief.building, use }; chip("building.use", use, BRIEF_LABELS.use[use]); }
  if (brief.site === "street") {
    brief.street = { place: place ?? "village" };
    chip("street.place", brief.street.place, BRIEF_LABELS.place[brief.street.place]);
    const q = first(WORDS.quarter);
    if (q) { brief.street.quarter = q; chip("street.quarter", q, `${BRIEF_LABELS.quarter[q]} quarter`); }
    // (a building's word that isn't the quarter's, "an inn on a town street", can't be placed yet)
    const qHits = q ? WORDS.quarter[q].flatMap((w) => find(w)) : [];
    const own = useHits.filter((m) => !qHits.some((x) => x.at <= m.at && x.end >= m.end));
    if (use && own.length) skipped.push({ label: lower.slice(own[0].at, own[0].end), why: "A street's buildings are its quarter's own: a building of your choosing stands by a road" });
  }
  if (brief.site !== "camp") {
    const cw = [...WORDS.camp.caravan, ...WORDS.camp.soldiers].flatMap((w) => find(w)).sort((a, b) => a.at - b.at)[0];
    if (cw) { mark([...WORDS.camp.caravan, ...WORDS.camp.soldiers]); skipped.push({ label: lower.slice(cw.at, cw.end), why: "Wagons or soldiers make a camp only when it's said to be a camp (\"a caravan camp\"), with no building or place" }); }
  }
  if (brief.site === "camp" && use) skipped.push({ label: lower.slice(useHits[0].at, useHits[0].end), why: "A camp has no buildings" });
  if (brief.site === "camp") {
    const kind = first(WORDS.camp) ?? "campsite";
    brief.camp = { kind };
    chip("camp.kind", kind, `${BRIEF_LABELS.camp[kind]} camp`);
    const n = lower.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a dozen|dozen)\s+tents?\b/);
    const v = n ? (/^\d+$/.test(n[1]) ? Number(n[1]) : NUMBERS[n[1].replace(/^a /, "")]) : 0;
    if (v > 0) { brief.camp.tents = Math.min(16, v); chip("camp.tents", brief.camp.tents, `${brief.camp.tents} tents`); }
  }
  if (brief.season) chip("season", brief.season, BRIEF_LABELS.season[brief.season]);
  if (brief.time) chip("time", brief.time, BRIEF_LABELS.time[brief.time]);
  if (brief.weather) chip("weather", brief.weather, `Weather: ${BRIEF_LABELS.weather[brief.weather].toLowerCase()}`);
  if (brief.ground) chip("ground", brief.ground, `Ground: ${BRIEF_LABELS.ground[brief.ground].toLowerCase()}`);

  // Features: a road (a roadside site always has one), a stream, a pond, a cliff, a rise, a hollow
  // (hills as the ground aren't a rise as well: "on hills" isn't "with a hill")
  // (a feature said with "no" or "without" just before it, "no road", is left out)
  const negated = (m) => /\b(?:no|without|not|never|nor)\s+(?:a\s+|an\s+|any\s+)?$/.test(lower.slice(Math.max(0, m.at - 16), m.at));
  const features = all(WORDS.features).filter((f) => WORDS.features[f].some((w) => find(w).some((m) => !negated(m)))).filter((f) => (f !== "road" || brief.site !== "street") && !(f === "rise" && brief.ground === "hills" && !/\b(?:rise|knoll|mound|hillock|ridge)s?\b/.test(lower)));
  const noRoad = WORDS.features.road.some((w) => find(w).some((m) => negated(m)));
  if (brief.site === "roadside" && !features.includes("road") && !noRoad) features.unshift("road");
  // (one its site never has room for is read but left out, and said so)
  for (const f of features.filter((f) => SITE_LACKS[brief.site]?.[f])) skipped.push({ label: BRIEF_LABELS.features[f].toLowerCase(), why: SITE_LACKS[brief.site][f] });
  const kept = features.filter((f) => !SITE_LACKS[brief.site]?.[f]);
  if (kept.length) { brief.features = kept; kept.forEach((f) => chip("features", f, BRIEF_LABELS.features[f])); }

  // Scattered things: each takes the nearest amount word before it in its part of the sentence, carried back over a
  // list ("littered with trees, stumps and logs" makes all three lots); else some
  const items = Object.values(SCATTER_ITEMS).flat().map(esc).join("|");
  const ITEM = new RegExp(`\\b(?:${items})\\b`, "g"), ENDS_WITH_ITEM = new RegExp(`\\b(?:${items})\\s*$`);
  const reach = (at) => {
    const start = Math.max(lower.lastIndexOf(".", at - 1), lower.lastIndexOf(";", at - 1)) + 1;
    let from = Math.max(start, lower.lastIndexOf(",", at - 1) + 1);
    while (from > start && !lower.slice(from, at).replace(ITEM, " ").replace(/\b(?:and|or|a|an|the)\b/g, " ").replace(/[\s,]+/g, "")) {
      const prevFrom = Math.max(start, lower.lastIndexOf(",", from - 2) + 1);
      if (!ENDS_WITH_ITEM.test(lower.slice(prevFrom, from - 1))) break;
      from = prevFrom;
    }
    return lower.slice(from, at);
  };
  for (const [key, words] of Object.entries(SCATTER_ITEMS)) {
    const hits = words.flatMap((w) => find(w));
    if (!hits.length) continue;
    const m = hits.sort((a, b) => a.at - b.at)[0];
    const before = reach(m.at);
    // (the nearest amount word wins; a "with" straight after another one, "littered with", is that word's)
    const said0 = [];
    for (const [a, aw] of Object.entries(AMOUNTS)) for (const w of aw) for (const x of before.matchAll(pattern(w))) said0.push({ a, w, at: x.index, end: x.index + x[0].length });
    said0.sort((x, y) => y.at - x.at);
    let pick = said0[0];
    if (pick?.w === "with") { const prev = said0.find((x) => x.w !== "with" && before.slice(x.end, pick.at).trim() === ""); if (prev) pick = prev; }
    const amount = pick?.a ?? null, said = pick?.w ?? null;
    const level = LEVEL[key][amount ?? "some"];
    brief[key] = key === "trees" && said === "dense" ? "dense" : level;
    mark(words);
    const label = { trees: "Trees", litter: "Stumps and logs", rocks: "Rocks", brush: "Bushes and ferns" }[key];
    chip(key, brief[key], `${label}: ${BRIEF_LABELS[key === "trees" ? "trees" : key][brief[key]].toLowerCase()}`);
  }
  // (a forest said with how thick it is, "a dense forest", "sparse woods", its trees so, when no trees were said)
  if (!("trees" in brief) && brief.ground === "forest") {
    for (const w of WORDS.ground.forest) for (const m of find(w)) {
      const said = lower.slice(Math.max(0, m.at - 14), m.at).match(/\b(\w+)\s+$/)?.[1];
      const amount = said && Object.keys(AMOUNTS).find((a) => a !== "none" && AMOUNTS[a].includes(said) && said !== "with");
      if (amount && !("trees" in brief)) {
        brief.trees = said === "dense" ? "dense" : LEVEL.trees[amount];
        chip("trees", brief.trees, `Trees: ${BRIEF_LABELS.trees[brief.trees].toLowerCase()}`);
      }
    }
  }
  for (const aw of Object.values(AMOUNTS)) mark(aw.filter((w) => w !== "with"));

  // Rooms, for a building that has them (an inn, a farmstead): its common room with a stage and a bar, a kitchen, a
  // storeroom, bedrooms; those said to be in a cellar or upstairs come with levels
  if (brief.site === "roadside" || brief.site === "street") {
    const here = (words) => words.some((w) => find(w).some((m) => !inLater(m)));
    const parts = [];
    const stage = here(ROOM_WORDS.stage), bar = here(ROOM_WORDS.bar), common = here(ROOM_WORDS.common) || stage || bar;
    if (common) parts.push(`common room${stage || bar ? ` with ${[stage ? "a stage" : null, bar ? "a bar" : null].filter(Boolean).join(" and ")}` : ""}`);
    if (here(ROOM_WORDS.kitchen)) parts.push("kitchen");
    if (here(ROOM_WORDS.store)) parts.push("storeroom");
    const beds = ROOM_WORDS.bedroom.flatMap((w) => find(w)).filter((m) => !inLater(m));
    if (beds.length) {
      const n = lower.slice(Math.max(0, beds[0].at - 14), beds[0].at).match(/\b(\d+|a|an|no|one|single|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen)\s*$/);
      const k = !n ? 2 : n[1] === "no" ? 0 : /^\d+$/.test(n[1]) ? Number(n[1]) : NUMBERS[n[1]] ?? 2;
      if (k > 0) parts.push(k === 1 ? "bedroom" : `${k} bedrooms`);
    }
    Object.values(ROOM_WORDS).forEach(mark);
    if (parts.length && brief.site === "roadside") {
      brief.building = { ...brief.building, rooms: parts.join(", ") };
      chip("building.rooms", brief.building.rooms, `Rooms: ${brief.building.rooms}`);
    }
  }
  // The cellar and the floors above: a building's (by a road), with the rooms said to be there
  for (const f of floorsSaid) {
    if (brief.site !== "roadside") { skipped.push({ label: f.label, why: brief.site === "castle" ? "A castle's keep, towers and gatehouse have their floors and the keep its cellar already" : "A cellar or floors above go with a building: pick a building by a road" }); continue; }
    const t = f.text;
    const count = (re) => { const m = t.match(re); return m ? (/^\d+$/.test(m[1]) ? Number(m[1]) : NUMBERS[m[1]] ?? null) : null; };
    if (f.no) {
      brief.building = { ...brief.building, ...(f.what === "cellar" ? { cellar: false } : { floors: 0 }) };
      if (f.what === "cellar") chip("building.cellar", false, "No cellar");
      else chip("building.floors", 0, "No floor above");
    } else if (f.what === "cellar") {
      brief.building = { ...brief.building, cellar: true };
      chip("building.cellar", true, "A cellar");
      const rooms = [/\b(cask|casks|barrel|barrels|wine|ale|beer|kegs?)\b/.test(t) ? "cellar" : null, /\b(store ?rooms?|storage|pantry|stores)\b/.test(t) ? "storeroom" : null].filter(Boolean);
      if (rooms.length) { brief.building.cellarRooms = rooms.join(", "); chip("building.cellarRooms", brief.building.cellarRooms, `Cellar rooms: ${brief.building.cellarRooms}`); }
    } else {
      // (floors above: "upstairs" or an attic one; "three floors" or "three stories" the ground floor and two more)
      const total = count(/\b(\d+|two|three|four)[\s-]+(?:floors?|stor(?:ies|eys|ey|y))\b/);
      const up = Math.max(1, Math.min(3, total ? total - 1 : 1));
      brief.building = { ...brief.building, floors: up };
      chip("building.floors", up, up === 1 ? "A floor above" : `${up} floors above`);
      const beds = t.match(/\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen)?\s*(?:guest\s+)?(?:bed)?rooms?(?:\s+(?:for|to)\s+(?:rent|let))?\b/);
      // (only a number of rooms said sets them: "upstairs rooms" alone leaves them to its use, an inn's whole corridor)
      if (beds && /rooms?/.test(beds[0]) && beds[1]) {
        const n = /^\d+$/.test(beds[1]) ? Number(beds[1]) : NUMBERS[beds[1]] ?? 2;
        brief.building.upstairs = n === 1 ? "bedroom" : `${Math.min(8, n)} bedrooms`;
        chip("building.upstairs", brief.building.upstairs, `Upstairs: ${brief.building.upstairs}`);
      }
    }
  }

  if (named) {
    if (brief.site === "roadside") { brief.building = { ...brief.building, name: named[1].trim() }; chip("building.name", named[1].trim(), `Named ${named[1].trim()}`); }
    else { brief.name = named[1].trim(); chip("name", brief.name, `Named ${brief.name}`); }
  }

  // The words it didn't know: those of the text outside every span read, but small words and numbers
  const unknown = [];
  for (const m of lower.matchAll(/[a-z][a-z-]*/g)) {
    const w = m[0], at = m.index, end = at + w.length;
    if (STOP.has(w) || w.length < 3 || NUMBERS[w] || used.some(([s, e]) => at >= s && end <= e)) continue;
    if (!unknown.includes(w)) unknown.push(w);
  }
  return { brief, chips, later: later.map(({ label }) => ({ label })), skipped, unknown: unknown.slice(0, 8) };
}

/**
 * A brief with a chip taken out: its choice back to the brief's default (a feature, just that feature; the rooms, the
 * name, empty). brief: a brief (whole or partial); chip: { key, value }. Returns a new brief.
 */
export function withoutChip(brief, chip) {
  const out = structuredClone(brief ?? {});
  const [k, sub] = String(chip.key).split(".");
  if (k === "features") out.features = (out.features ?? []).filter((f) => f !== chip.value);
  else if (sub) { if (out[k]) delete out[k][sub]; }
  else delete out[k];
  return out;
}
