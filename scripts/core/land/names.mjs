/**
 * Invented names for an overland map's places and features, in one of three styles: English countryside (Brightwick,
 * Fenford, the Gray Fells, Kestrel Water), English places with older-sounding features (the Varn, the Ostrel Hills),
 * or one invented tongue for everything (Vaskar, the Ethrin Hills), its sounds picked once per map so its names
 * sound alike. The kind of thing keeps a plain English word (Hills, Sea, Keep) in every style, so a name reads at a
 * glance. A place's name follows its site (a ford on a river, a haven on a coast, a wood in a forest); a bay or a lake
 * may take the name of the town beside it. Names are unique on a map and the same every time for the same land,
 * places and seed. Pure.
 */
import { rng } from "../rng.mjs";
import { NAME_STYLES } from "./schema.mjs";
import { wordMaker, keepsRules, withElement, genitiveOf, SITE_ELEMENTS } from "./namesets.mjs";
export { NAME_STYLES };

// ---- English countryside ----
const FIRST = ["Ash", "Elm", "Oak", "Thorn", "Mill", "Stone", "Fen", "Holt", "Lark", "Wren", "Bram", "Cold", "Bright", "Alder", "Heath", "Barrow", "Haw", "Rush", "Sedge", "Wold",
  "Brack", "Briar", "Bur", "Cran", "Dun", "East", "West", "North", "South", "Fair", "Fox", "Gold", "Green", "Gray", "Hart", "Hazel", "High", "Kings", "Ley", "Long",
  "Marsh", "Nether", "Old", "Pen", "Red", "Rook", "Sand", "Shep", "Silver", "Stan", "Swan", "Thistle", "Upper", "Wether", "White", "Wil", "Wood", "Yew", "Ember", "Copper",
  "Hollin", "Mor", "Ravens", "Lang", "Crow", "Kestrel", "Heron", "Otter", "Badger", "Bell", "Cherry", "Dew", "Elder", "Flint", "Hay", "Ivy", "Linden", "Maple", "Moss", "Pike",
  "Reed", "Salt", "Sloe", "Tor", "Willow", "Wolf", "Chalk", "Bridle", "Cinder", "Dale", "Glen", "Horn", "Ox", "Ram", "Shire", "Sorrel"];
const ENDS = {
  river: ["ford", "bridge", "brook", "wick", "ton", "mere", "ford", "bridge", "lock", "weir"],
  mouth: ["mouth", "haven", "port", "wick"],
  coast: ["haven", "port", "wick", "cliff", "strand", "hythe", "ness", "cove"],
  hills: ["ley", "down", "hill", "cote", "crag", "edge", "tor", "fell"],
  forest: ["wood", "holt", "hurst", "den", "shaw", "grove"],
  plain: ["ton", "by", "stead", "field", "well", "ham", "dale", "worth", "thorpe", "bury", "ley", "wick"],
};
const RIVER_ROOT = ["Wend", "Linnet", "Ashen", "Merrow", "Rill", "Sorrow", "Kestrel", "Willow", "Tansy", "Whin", "Brack", "Ember", "Swift", "Wren", "Brindle", "Sorrel", "Mardle", "Sedge", "Hollow", "Teal", "Thistle", "Bramble", "Hazel", "Fallow", "Glass"];
const WATER_ADJ = ["Black", "Cold", "Gray", "Swift", "Still", "Silver", "Bright", "Long", "Deep", "Clear", "Red", "White", "Green", "Dark"];
const RANGE_ADJ = ["Gray", "Storm", "Frost", "Wolf", "Ember", "Hollow", "Black", "Red", "Sawtooth", "Raven", "High", "Old", "Broken", "Bitter", "Pale", "Giant's", "King's", "Weeping", "Cinder", "Thorn", "White"];
const SEA_ADJ = ["Gray", "Silver", "Whale", "Amber", "Misty", "Long", "Quiet", "Wide", "Morning", "Gull", "Salt", "Stormy", "Pearl", "Glass", "Northern", "Southern", "Western", "Eastern"];
const LAND_ADJ = ["Hollow", "Green", "Silent", "Golden", "Burnt", "Whispering", "Bleak", "Pale", "Old", "Dim", "Red", "Wild", "Bitter", "Lonely"];

// ---- an invented tongue: its sounds picked per map ----
const ONSETS = ["b", "d", "f", "g", "h", "k", "l", "m", "n", "r", "s", "t", "th", "v", "w", "z", "br", "dr", "gr", "kr", "tr", "st", "sk", "sh", "ch", "gl", "fl", "cl", "j"];
const VOWELS = ["a", "e", "i", "o", "u"];
const DIPHTHONGS = ["ai", "ei", "ou", "ia", "au", "eo"];
const CODAS = ["n", "r", "l", "s", "th", "m", "k", "rn", "ld", "st", "nd", "sh", "x", "rk", "lt", "rm", "g"];
const SUFFIXES = ["ar", "eth", "un", "os", "ia", "wyn", "mir", "dal", "ost", "or", "an", "is", "ek", "ul", "ira", "esh", "ond", "en"];
// (sounds a name shouldn't make: some read badly, some too close to names in published settings)
// (an h after a consonant other than s, t or c, or before any consonant, is hard to say: Zirhmir, Grikshdal)
const AVOID = /ven|vae|aa|ee|ii|oo|uu|([bcdfghjklmnpqrstvwxz])\1|[bcdfgjklmnpqrstvwxz]{3}|[bdfgjklmnpqrvwxz]h|h[bcdfghjklmnpqrstvwxz]/;
// (words a name mustn't hold: rude or hurtful ones, in English and a few other tongues, inside a word or at its start or
// end; and real or well-known names, from history, faith, games and published settings. Kept as hashes, so the module
// doesn't spell them out: `fnv` of a word part, or of "^" + a start, or of an end + "$")
const fnv = (t) => { let h = 0x811c9dc5; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; };
const hashes = (t) => new Set(t.split(" ").map((x) => parseInt(x, 36)));
const RUDE_H = hashes("pfc60s l0zz4 piz70 sd3tw 5kl94a 5pekq6 6u4ocd 79ntrb 7n9u7y 9qgnjm e4iz3o hlm3ou hssb8u lcgksp p4rab8 s31e38 s4zqz5 t46lzu u74m7v vn5kni wmjpjg xisbcc ykn8e7 z4446r zefqh6 zf6i4d 1051mqh 11jflq4 120hcjv 12kjkj5 13ig1zx 14h9oi0 16yqbm2 173zgav 19dmk05 19o6l49 1a0p9d1 1aphvlf 1c8m2wt 1ddoja5 1g4wmwe 1hpzul3 1ico6dd 1jpkpg0 1mb5nmv 1mdh5y7 1npkzk5 1ongl9g 1oqemy5 1p1uv49 1v7lky7 1x6y0cl");
const KNOWN_H = hashes("ukn0k 2d4df7 2stqrb 2uhcrj 3s56d4 4gy52y 661kpx 68mdsb 7haj38 8fwt0a 92k6dj abwg0n aopeo4 awjaiz ax87yi bcd9l4 czjuei e4ayps ek90wt el3udx evt8ww fccg25 fjfmp4 g9iw85 gt6fw8 hm5xcy iapurj j4r50y j8v5u0 jshigv kfcw9k kqtzf4 kz0hat l7kqbg mesh3x mouu2c nwres2 o0xp79 o9y1jr oijm6x opds2o qmohl8 s50kt8 s6vl53 ssa2d6 toi8i6 voy3fq x5a5kc yknp7v ylh1sb zzamic 10hbqac 112jqhi 11iu1t7 11oesz8 122hru2 125e3v3 12u1dvu 149g164 14bgqou 14yl4h8 15eytdy 15pjx1q 16l7maw 17p1ak0 184lw2u 18v299g 19citbg 19dmk05 19e3bds 1ausv6x 1ayivl2 1bel6pu 1c0n5wa 1c205w7 1c2q6w5 1dxvgz1 1ekt9nj 1esg1c1 1eu5xtm 1eyh1nk 1ga6auy 1h39nxo 1i4wxdx 1iab3vs 1j8k62j 1jor9rb 1kvfyf8 1l21g8l 1lckbkh 1m17w43 1m94i7l 1mllz94 1n6ncv7 1nopxp2 1o9ukc8 1oipled 1v83xi4 1v8l0qp 1vj22gd 1wew5bu 1xfngpx");
const rudeWord = (w) => {
  for (let n = 3; n <= 5; n++) {
    if (w.length >= n && (RUDE_H.has(fnv(`^${w.slice(0, n)}`)) || RUDE_H.has(fnv(`${w.slice(-n)}$`)))) return true;
    for (let i = 0; i + n <= w.length; i++) if (RUDE_H.has(fnv(w.slice(i, i + n)))) return true;
  }
  return false;
};
/** Whether a name (one word or several) reads as something rude, inside a word or across the join of its parts. */
export const rude = (name) => { const t = String(name).toLowerCase(); return t.split(/[^a-z]+/).some((w) => w && rudeWord(w)) || rudeWord(t.replace(/[^a-z]/g, "")); };
/** Whether a word is a real or well-known name a made-up one shouldn't be. */
export const known = (word) => KNOWN_H.has(fnv(String(word).toLowerCase()));

function tongue(seed) {
  const r = rng(seed, "names", "tongue");
  const take = (list, lo, hi) => r.shuffle(list.slice()).slice(0, lo + r.int(hi - lo + 1));
  // (every vowel, a couple of two-vowel sounds, and a share of the consonants: so a map's names sound alike)
  // (two or three vowels the map favors, the others rarer)
  const fav = take(VOWELS, 2, 3);
  const T = { on: take(ONSETS, 9, 13), vo: [...fav, ...fav, ...fav, ...VOWELS], di: take(DIPHTHONGS, 1, 2), co: take(CODAS, 5, 8), su: take(SUFFIXES, 3, 5) };
  T.word = (rr, { min = 2, max = 3, suffix = 0.35 } = {}) => {
    for (let tries = 0; tries < 60; tries++) {
      const n = min + rr.int(max - min + 1);
      let w = "", di = false;
      for (let k = 0; k < n; k++) {
        // (each syllable after the first opens with a consonant, so vowels don't pile up; one two-vowel sound a word)
        const on = k === 0 ? (rr.chance(0.8) ? rr.pick(T.on) : "") : rr.pick(T.on);
        const v = !di && rr.chance(0.18) ? ((di = true), rr.pick(T.di)) : rr.pick(T.vo);
        const co = k === n - 1 ? (rr.chance(0.5) ? rr.pick(T.co) : "") : (rr.chance(0.2) ? rr.pick(T.co).slice(0, 1) : "");
        w += on + v + co;
      }
      if (rr.chance(suffix)) w = w.replace(/[aeiou]+$/, "") + rr.pick(T.su);
      if (w.length < 4 || w.length > 9 || AVOID.test(w) || rude(w) || known(w)) continue;
      return w[0].toUpperCase() + w.slice(1);
    }
    return "Ostrel";
  };
  return T;
}

/**
 * A namer for one map: { take(name), place(kind, site, key), feature(kind, info, key) }, each giving a name not used before on the
 * map. kind: a place's class (city, town, village, castle, ruin...) or an inventory feature's kind (sea, bay, lake,
 * river, range, forest, desert, marsh, island, cape, land). site: a place's site facts (river, coast, ground, biome).
 * info: { size, high, near (a nearby place's name), big } for a feature. key: a stable string (the id), so a name
 * doesn't move when other names change, except to step past one already taken. style "custom" with options.set (a
 * parsed name set, namesets.mjs) makes names by the GM's own rules; a site's riverName is its river's name, for an
 * element that names it.
 */
/** A name as a title: one that starts with "the" starts with "The" (a name stands on its own on a map or in a list). */
export const titled = (n) => (typeof n === "string" ? n.replace(/^the(\s)/, "The$1") : n);

export function namer(style = "english", seed = 1, { set = null } = {}) {
  if (style === "custom" && set) return customNamer(set, seed);
  const st = NAME_STYLES.includes(style) && style !== "custom" ? style : "english";
  const T = st === "english" ? null : tongue(seed);
  const used = new Set();
  const unique = (key, make) => {
    for (let k = 0; k < 30; k++) { const nm = titled(make(rng(seed, "names", st, key, k))); if (nm && !used.has(nm) && (st === "english" || !rude(nm))) { used.add(nm); return nm; } }
    let k = 2, base = titled(make(rng(seed, "names", st, key, "last"))); while (used.has(`${base} ${k}`)) k++;
    used.add(`${base} ${k}`); return `${base} ${k}`;
  };
  const inventedPlaces = st === "invented";
  const inventedFeatures = st !== "english";
  // an English place name from its site
  const englishPlace = (r, site = {}) => {
    const ends = site.mouth ? ENDS.mouth : site.coast != null && r.chance(0.7) ? ENDS.coast : site.river && r.chance(0.75) ? ENDS.river
      : site.ground === "hills" || site.ground === "high" ? ENDS.hills : /forest|taiga/.test(site.biome ?? "") && r.chance(0.6) ? ENDS.forest : ENDS.plain;
    const a = r.pick(FIRST), b = r.pick(ends);
    // (one s where two meet: Kingstead, not Kingsstead; and no sh, th or ch run into an h: Ashhaven)
    if (/(sh|th|ch)$/i.test(a) && b[0] === "h") return null;
    const nm = /s$/i.test(a) && b[0] === "s" ? a + b.slice(1) : a + b;
    // (and none that trips the tongue: Mapleley, Bellley)
    return /leley|eyley|yley|(.)\1\1/i.test(nm) ? null : nm;
  };
  const word = (r, opts) => T.word(r, opts);
  return {
    /** Marks a name as used (one the plan gives), so no invented one repeats it. */
    take(name) { used.add(name); },
    place(kind, site, key) {
      return unique(`place:${key}`, (r) => {
        // (the same base whatever the place's class, so a village grown to a town keeps its name)
        const base = inventedPlaces ? word(r, { min: 2, max: 3 }) : englishPlace(r, site);
        if (!base) return null;
        if (kind === "castle") return r.pick([`${base} Keep`, `${base} Castle`, `Castle ${base}`, `${base} Hold`]);
        if (kind === "ruin") return r.pick([`Old ${base}`, `${base} Ruins`, `Ruins of ${base}`, `The Fallen ${r.pick(["Tower", "Hall", "Keep", "Gate"])}`]);
        if (kind === "tower") return `${base} Tower`;
        if (kind === "temple") return r.pick([`${base} Abbey`, `${base} Shrine`, `${base} Priory`]);
        if (kind === "inn") return `The ${r.pick(["Gray", "Red", "Old", "Laughing", "Drowsy", "Golden"])} ${r.pick(["Stag", "Lantern", "Goose", "Hound", "Anchor", "Wheel"])}`;
        if (kind === "mine") return `${base} ${r.pick(["Mine", "Delvings", "Pits"])}`;
        return base;
      });
    },
    feature(kind, info = {}, key) {
      return unique(`feature:${key}`, (r) => {
        // the feature's own word: a nearby town's name for a bay or a lake sometimes, else a root in the map's style
        const root = (english) => (inventedFeatures ? word(r, { min: 2, max: 2, suffix: 0.4 }) : english);
        const near = info.near && r.chance(0.5) ? info.near : null;
        switch (kind) {
          case "sea": {
            const big = info.big;
            if (inventedFeatures) { const w = root(); return r.pick(big ? [`the ${w} Ocean`, `the Sea of ${w}`] : [`the ${w} Sea`, `the Sea of ${w}`]); }
            return big ? r.pick([`the ${r.pick(SEA_ADJ)} Ocean`, `the ${r.pick(SEA_ADJ)} Deep`]) : `the ${r.pick(SEA_ADJ)} Sea`;
          }
          case "bay": { const w = near ?? root(r.pick(FIRST)); return r.pick([`${w} Bay`, `${w} Sound`, `the Bay of ${w}`]); }
          case "lake": {
            if (near) return r.pick([`${near} Water`, `Lake ${near}`]);
            if (inventedFeatures) { const w = root(); return r.pick([`Lake ${w}`, `${w} Water`, `the ${w} Mere`]); }
            return (info.size ?? 0) < 60 ? r.pick([`${r.pick(FIRST)}mere`, `the ${r.pick(WATER_ADJ)} Tarn`]) : r.pick([`Lake ${r.pick(RIVER_ROOT)}`, `${r.pick(FIRST)}mere`, `${r.pick(WATER_ADJ)} Water`]);
          }
          case "river": {
            if (inventedFeatures) { const w = root(); return r.pick([`the ${w}`, `the ${w}`, `River ${w}`]); }
            return r.pick([`the ${r.pick(RIVER_ROOT)}`, `${r.pick(RIVER_ROOT)} Water`, `River ${r.pick(RIVER_ROOT)}`, `the ${r.pick(WATER_ADJ)}water`]);
          }
          case "range": {
            const kindWord = info.high ? r.pick(["Mountains", "Peaks", "Spires", "Teeth", "Crags"]) : r.pick(["Hills", "Fells", "Downs", "Heights"]);
            return `the ${inventedFeatures ? root() : r.pick(RANGE_ADJ)} ${kindWord}`;
          }
          case "forest": { const w = root(r.pick(FIRST)); return r.pick(inventedFeatures ? [`the ${w} Forest`, `${w} Wood`, `the ${w}wood`] : [`${w} Wood`, `${w} Forest`, `the ${r.pick(LAND_ADJ)} Weald`, `the ${r.pick(LAND_ADJ)}wood`]); }
          case "desert": return inventedFeatures ? r.pick([`the ${root()} Waste`, `the ${root()} Sands`]) : r.pick([`the ${r.pick(LAND_ADJ)} Waste`, `the ${r.pick(LAND_ADJ)} Barrens`, `the ${r.pick(FIRST)} Sands`]);
          case "marsh": { const w = near ?? root(r.pick(FIRST)); return r.pick([`${w} Fen`, `${w} Marsh`, `the ${w} Mire`, `${w} Moss`]); }
          case "island": { const w = root(r.pick(FIRST)); return r.pick([`${w} Isle`, `the Isle of ${w}`, inventedFeatures ? `${w}` : `${w}holm`]); }
          case "cape": { const w = near ?? root(r.pick(FIRST)); return r.pick([`${w} Head`, `${w} Point`, `Cape ${w}`, inventedFeatures || near ? `${w} Point` : `${w}ness`]); }
          case "land": return inventedFeatures ? root() : r.pick([`the ${r.pick(["West", "East", "North", "South", "Middle", "High", "Far"])}lands`, `${r.pick(FIRST)}land`]);
          case "realm": {
            // (a realm: its rank's word, and a name of its own, or now and then its capital's; info.rank great, middle
            // or small)
            // (one s where two meet, Kingshire, and no "march" or "king" twice: not the Reedmarch March or the Kingdom
            // of Kingsdale)
            const a = r.pick(FIRST), b = r.pick(REALM_ENDS);
            const w = near ?? (inventedFeatures ? root() : /s$/i.test(a) && b[0] === "s" ? a + b.slice(1) : a + b);
            const forms = (REALM_FORMS[info.rank] ?? REALM_FORMS.middle).filter((t) => !(/march/i.test(w) && /March/.test(t)) && !(/king/i.test(w) && /Kingdom/.test(t)));
            return r.pick(forms.length ? forms : ["{name}"]).replace("{name}", w);
          }
          default: return null;
        }
      });
    },
  };
}

/** A realm's name by its rank: the great ones kingdoms, the small ones marches, counties and baronies. */
const REALM_FORMS = {
  great: ["the Kingdom of {name}", "{name}", "the Kingdom of {name}"],
  middle: ["the Duchy of {name}", "the Kingdom of {name}", "the Principality of {name}", "{name}"],
  small: ["the {name} March", "the County of {name}", "the Barony of {name}", "the March of {name}"],
};
const REALM_ENDS = ["mark", "land", "shire", "wold", "dale", "moor", "reach", "march"];

// ---- a GM's name set (namesets.mjs) ----
// (the patterns a kind of thing takes when the set gives none: plain words anyone can read)
const COMMON = {
  city: ["{name}"], town: ["{name}"], village: ["{name}"], hamlet: ["{name}"], castle: ["{name} Castle"], ruin: ["Ruins of {name}"], tower: ["{name} Tower"],
  temple: ["{name} Shrine"], inn: ["{name}"], mine: ["{name} Mine"],
  sea: ["the {name} Sea", "the Sea of {name}"], ocean: ["the {name} Ocean"], bay: ["{name} Bay", "the Bay of {name}"], lake: ["Lake {name}"], river: ["the {name}", "River {name}"],
  hills: ["the {name} Hills"], mountains: ["the {name} Mountains"], range: ["the {name} Range"], forest: ["the {name} Forest"], desert: ["the {name} Waste"], marsh: ["the {name} Marsh"],
  island: ["{name} Isle", "the Isle of {name}"], cape: ["Cape {name}"], land: ["{name}"], realm: ["the Kingdom of {name}", "{name}"],
};

function customNamer(set, seed) {
  const used = new Set();
  const flat = (w) => String(w).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // (a name the set avoids is avoided as a word too: not "Baba Castle" when Baba is avoided)
  const banned = new Set((set.avoid?.names ?? []).map(flat));
  // (each made word once on a map: not "Kefeld" and "Kefeld Castle")
  const roots = new Set();
  const wordsOf = (n) => flat(n).split(/[\s'-]+/).filter((w) => w.length >= 3 && !["the", "of"].includes(w));
  const check = (w) => keepsRules(set, w) && !rude(flat(w)) && !known(flat(w)) && !roots.has(flat(w)) && !banned.has(flat(w));
  let lastRoot = null;
  const make0 = wordMaker(set, check), make = (r) => (lastRoot = make0(r));
  // (the bank: each list in an order of its own for the map; a place takes the first name free from where its key
  // points, so its name doesn't move when another place's changes; a class's or kind's own list before the general one)
  const banks = new Map();
  const bank = (key) => { if (!banks.has(key)) { const list = (set.names?.[key] ?? []).filter((n) => !banned.has(flat(n))); banks.set(key, rng(seed, "names", "bank", key).shuffle(list.slice())); } return banks.get(key); };
  const hash = (t) => { let h = 0x811c9dc5; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; };
  const fromBank = (keys, key) => {
    for (const k of keys) {
      const list = bank(k), at = hash(`${k}|${key}`);
      for (let i = 0; i < list.length; i++) { const n = titled(list[(at + i) % list.length]); if (!used.has(n)) { used.add(n); for (const w of wordsOf(n)) roots.add(w); return n; } }
    }
    return null;
  };
  const ok = (nm) => nm && !used.has(nm) && !banned.has(flat(nm));
  const unique = (key, makeOne) => {
    for (let k = 0; k < 40; k++) { lastRoot = null; const nm = titled(makeOne(rng(seed, "names", "custom", key, k))); if (ok(nm)) { used.add(nm); if (lastRoot) roots.add(flat(lastRoot)); return nm; } }
    let k = 2, base = titled(makeOne(rng(seed, "names", "custom", key, "last")) ?? [...used].find((u) => !/ \d+$/.test(u)) ?? "Unnamed"); while (used.has(`${base} ${k}`)) k++;
    used.add(`${base} ${k}`); return `${base} ${k}`;
  };
  const pattern = (r, kind, name) => { const own = set.kinds?.[kind], list = own?.length ? own : COMMON[kind] ?? ["{name}"]; return r.pick(list).replace(/\{name\}/g, name); };
  // (a word that took one of the set's endings gives it up for a suffix that says more: not Bricadunmagos)
  const endings = (set.sounds?.endings ?? []).slice().sort((a, b) => b.length - a.length);
  // (a word that's little more than its ending can't give it up: null)
  const bare = (root, e) => {
    if (e.type !== "suffix") return root;
    const end = endings.find((x) => root.toLowerCase().endsWith(x));
    if (!end) return root;
    return [...root].length - [...end].length >= 3 ? root.slice(0, root.length - end.length) : null;
  };
  // (a feature never takes an element that names a place's river)
  const elementFor = (key, scope) => (set.elements?.[key] ?? []).filter((e) => (!e.only || e.only === scope) && !(scope === "feature" && /\{river/.test(e.text)));
  return {
    take(name) { used.add(name); for (const w of wordsOf(name)) roots.add(w); },
    place(kind, site = {}, key) {
      // (an inn's sign in plain words, as travelers need; never a name from the bank)
      if (kind !== "inn" || set.inns === "local") { const banked = fromBank([kind, "places"], key); if (banked) return banked; }
      if (kind === "inn" && set.inns !== "local") return unique(`place:${key}`, (r) => `The ${r.pick(["Gray", "Red", "Old", "Laughing", "Drowsy", "Golden"])} ${r.pick(["Stag", "Lantern", "Goose", "Hound", "Anchor", "Wheel"])}`);
      return unique(`place:${key}`, (r) => {
        const root = make(r);
        if (!root) return null;
        // (the most telling thing about its site the set has a word part for, most of the time)
        let name = root;
        // (not on a place whose kind has a pattern of its own, a castle's "{name}borg": one word part a name is enough)
        const plainKind = (set.kinds?.[kind] ?? COMMON[kind] ?? ["{name}"]).every((t) => t === "{name}");
        const key0 = Object.keys(SITE_ELEMENTS).find((k) => SITE_ELEMENTS[k](site) && elementFor(k, "place").length);
        if (key0 && plainKind && r.chance(0.75)) {
          const e = r.pick(elementFor(key0, "place"));
          const river = site.riverName ? site.riverName.replace(/^(the|river)\s+/i, "") : null;
          // (a word that's little more than its ending: another word is made)
          const b = bare(root, e);
          if (!b) return null;
          name = withElement(b, e, { river, riverGen: river ? genitiveOf(river, set.genitive) : null }) ?? root;
        }
        return pattern(r, kind, name);
      });
    },
    feature(kind, info = {}, key) {
      const kinds = kind === "range" ? [info.high ? "mountains" : "hills", "range"] : kind === "sea" && info.big ? ["ocean", "sea"] : [kind];
      const banked = fromBank([...kinds, "features"], key);
      if (banked) return banked;
      return unique(`feature:${key}`, (r) => {
        const root = make(r);
        if (!root) return null;
        const k = kinds.find((x) => elementFor(x, "feature").length);
        if (k) {
          const e = r.pick(elementFor(k, "feature")), b = bare(root, e);
          if (!b) return null;
          const named = withElement(b, e);
          // (a suffix or prefix says what it is, and the set's own pattern for the kind, if it gives one, still applies;
          // a pattern of words is the whole name)
          return named && e.type !== "pattern" && set.kinds?.[k]?.length ? pattern(r, k, named) : named;
        }
        const pk = kinds.find((x) => set.kinds?.[x]) ?? kinds[0];
        return pattern(r, pk, root);
      });
    },
  };
}
