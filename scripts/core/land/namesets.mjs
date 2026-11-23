/**
 * Name sets: a GM's own naming rules for an overland map, written as a short plain-text block. A set gives the sound
 * of its names (onsets, vowels, codas, endings spelled out, or learned from example names), names to use as they are
 * (a bank, used first), word parts that each mean something (a ford, a river's mouth, a cape) used where the land
 * means it, a pattern for each kind of thing (a castle, a lake, a sea), and what a name mustn't have. Pure.
 *
 *   name: Northern Coast
 *   sounds:
 *     onsets: sk st hr br dr fl gr b d f g h l m n r s t v
 *     vowels: a a e i o u á é              (one listed twice comes twice as often)
 *     codas: rn rk ld nd ng st ll nn
 *     syllables: 1-3
 *   examples: Hallmark, Dunrest, ...          (used when there are no sounds: at least 30)
 *   names:
 *     places: Hvitanes, Myrkos               (or per class: city, town...; features, or per kind: river...)
 *   elements:
 *     river mouth: -os                       (a suffix; "reyk-" a prefix; "Inbhir {river:gen}" a pattern)
 *     cape: -nes
 *   kinds:
 *     castle: {name}borg | {name} Castle
 *     sea: the {name} Sea
 *   avoid:
 *     letters: c q w
 *     parts: stad, hold
 *     starts: t
 *     names: Oldname, Othername
 *   genitive:
 *     ach > aich                             (an ending; "^M > Mh" a start)
 *   inns: common                             (or local)
 */


/** What a place's site can say, most telling first, and what each needs of the site. */
export const SITE_ELEMENTS = {
  "river mouth": (s) => !!s.mouth,
  confluence: (s) => !!s.confluence,
  ford: (s) => !!s.river && s.river.size === "small" && (s.roads?.length ?? 0) > 0,
  bridge: (s) => !!s.river && s.river.size !== "small" && (s.roads?.length ?? 0) > 0,
  coast: (s) => s.coast !== null && s.coast !== undefined,
  lake: (s) => !!s.lake,
  pass: (s) => !!s.pass,
  river: (s) => !!s.river,
  mountains: (s) => s.ground === "high",
  hills: (s) => s.ground === "hills",
  forest: (s) => /forest|taiga/.test(s.biome ?? ""),
  marsh: (s) => /wetland|marsh/.test(s.biome ?? ""),
  plain: () => true,
};
/** The kinds a name set can give a pattern or an element for: places' classes and the land's features. */
export const PLACE_KINDS = ["city", "town", "village", "hamlet", "castle", "ruin", "tower", "temple", "inn", "mine", "quarry", "fort", "monastery", "lighthouse", "customs", "battlefield", "stones", "barrow", "wreck", "lair", "cave", "grove", "camp", "cove", "monster"];
export const FEATURE_KINDS = ["sea", "ocean", "bay", "lake", "river", "range", "hills", "mountains", "forest", "desert", "marsh", "island", "cape", "delta", "estuary", "spit", "lagoon", "land", "realm", "falls", "pass", "volcano", "spring", "tree", "stacks"];
const SECTIONS = ["name", "sounds", "examples", "names", "elements", "kinds", "avoid", "genitive", "inns"];
const SOUND_KEYS = ["onsets", "vowels", "codas", "endings", "syllables", "length"];
const AVOID_KEYS = ["letters", "parts", "starts", "names"];

/** A name set's plain-text form read: { set, problems: [{ level, line, message }] }. The set is null only for no text. */
export function parseNameSet(text) {
  const problems = [];
  const err = (line, message) => problems.push({ level: "error", line, message });
  const warn = (line, message) => problems.push({ level: "warning", line, message });
  if (typeof text !== "string" || !text.trim()) return { set: null, problems: [{ level: "error", line: 0, message: "The name set is empty." }] };
  const set = { name: null, sounds: null, examples: [], names: {}, elements: {}, kinds: {}, avoid: { letters: [], parts: [], starts: [], names: [] }, genitive: [], inns: "common" };
  let section = null, sub = null, subLine = 0;
  const raw = {};
  const lines = text.replace(/\r/g, "").split("\n");
  // (gather each section's lines: "key: value" at the left margin opens a section, indented "key: value" a part of it,
  // and an indented line with no key carries on the last one)
  for (let n = 0; n < lines.length; n++) {
    // (runs of spaces inside a line made one, so a line padded with thousands of them still reads at once)
    const line = lines[n].replace(/(\S)[ \t]{2,}/g, "$1 ").replace(/\s+#.*$/, "").replace(/^#.*$/, "");
    if (!line.trim()) continue;
    const top = /^([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/.exec(line);
    if (top && !/^\s/.test(line)) {
      section = top[1].toLowerCase();
      sub = null;
      if (!SECTIONS.includes(section)) { warn(n + 1, `"${top[1]}" isn't a part of a name set (it has ${SECTIONS.join(", ")}); it's left out.`); section = null; continue; }
      raw[section] ??= { value: "", parts: [], line: n + 1 };
      if (top[2].trim()) raw[section].value += (raw[section].value ? "\n" : "") + top[2].trim();
      continue;
    }
    if (!section) { warn(n + 1, `"${line.trim()}" isn't under any part of the name set; it's left out.`); continue; }
    const part = /^\s+([A-Za-z][A-Za-z' ]*?)\s*:\s*(.*)$/.exec(line);
    if (part && !["examples", "genitive", "name", "inns"].includes(section)) {
      sub = { key: part[1].trim().toLowerCase(), value: part[2].trim(), line: n + 1 };
      raw[section].parts.push(sub);
      continue;
    }
    if (sub) sub.value += (sub.value ? "\n" : "") + line.trim();
    else raw[section].value += (raw[section].value ? "\n" : "") + line.trim();
  }
  const words = (v) => v.split(/[\s,]+/).map((w) => w.trim()).filter(Boolean);
  const names = (v) => v.split(/[,\n]+/).map((w) => w.trim()).filter(Boolean);
  const choices = (v) => v.split(/\s*[|,\n]\s*/).map((w) => w.trim()).filter(Boolean);
  const range = (v, line, what, lo, hi) => {
    const m = /^(\d+)\s*(?:-|to)\s*(\d+)$/.exec(v.trim()) ?? /^(\d+)$/.exec(v.trim());
    if (!m) { err(line, `${what} should be a number or a range like 2-3.`); return null; }
    const a = Number(m[1]), b = Number(m[2] ?? m[1]);
    if (a < lo || b > hi || a > b) { err(line, `${what} should be from ${lo} to ${hi}, the smaller first.`); return null; }
    return [a, b];
  };
  if (raw.name) set.name = raw.name.value.split("\n")[0].trim() || null;
  if (raw.inns) { const v = raw.inns.value.trim().toLowerCase(); if (["common", "local"].includes(v)) set.inns = v; else warn(raw.inns.line, `inns should be common (plain names anyone can read) or local; common is used.`); }
  if (raw.examples) set.examples = names(raw.examples.value);
  if (raw.sounds) {
    const s = { onsets: [], vowels: [], codas: [], endings: [], syllables: [1, 3], length: [3, 10] };
    for (const p of raw.sounds.parts) {
      if (!SOUND_KEYS.includes(p.key)) { warn(p.line, `"${p.key}" isn't one of the sounds (${SOUND_KEYS.join(", ")}); it's left out.`); continue; }
      if (p.key === "syllables") s.syllables = range(p.value, p.line, "syllables", 1, 6) ?? s.syllables;
      else if (p.key === "length") s.length = range(p.value, p.line, "length", 2, 24) ?? s.length;
      else s[p.key] = words(p.value).map((w) => w.replace(/^-/, "").toLowerCase());
    }
    if (!s.vowels.length) err(raw.sounds.line, "sounds need vowels.");
    else set.sounds = s;
  }
  if (raw.names) for (const p of raw.names.parts) {
    if (!["places", "features", ...PLACE_KINDS, ...FEATURE_KINDS].includes(p.key)) { warn(p.line, `names: "${p.key}" isn't places, features, a kind of place or a kind of feature; it's left out.`); continue; }
    set.names[p.key] = names(p.value);
  }
  if (raw.elements) for (const p of raw.elements.parts) {
    const m = /^(?:(place|places|feature|features)\s+)?(.+)$/.exec(p.key), only = m[1] ? (m[1].startsWith("place") ? "place" : "feature") : null, key = m[2].trim();
    const site = key in SITE_ELEMENTS, kind = FEATURE_KINDS.includes(key) || PLACE_KINDS.includes(key);
    if (!site && !kind) { warn(p.line, `elements: "${key}" isn't something the land shows (${Object.keys(SITE_ELEMENTS).join(", ")}, or a kind of feature); it's left out.`); continue; }
    const list = choices(p.value).map((t) => elementOf(t));
    if (list.some((e) => !e)) warn(p.line, `elements: "${key}" has a part that isn't a suffix (-os), a prefix (reyk-) or a pattern with {name} or {river}; it's left out.`);
    (set.elements[key] ??= []).push(...list.filter(Boolean).map((e) => ({ ...e, only })));
  }
  if (raw.kinds) for (const p of raw.kinds.parts) {
    if (![...PLACE_KINDS, ...FEATURE_KINDS].includes(p.key)) { warn(p.line, `kinds: "${p.key}" isn't a kind of place or feature; it's left out.`); continue; }
    const list = choices(p.value), good = list.filter((t) => t.includes("{name}"));
    if (list.length > good.length) warn(p.line, `kinds: each pattern for ${p.key} needs {name} where the name goes; those without it are left out.`);
    if (good.length) set.kinds[p.key] = good;
    else if (!list.length) warn(p.line, `kinds: ${p.key} has no pattern; the usual one is used.`);
  }
  if (raw.avoid) for (const p of raw.avoid.parts) {
    if (!AVOID_KEYS.includes(p.key)) { warn(p.line, `avoid: "${p.key}" isn't ${AVOID_KEYS.join(", ")}; it's left out.`); continue; }
    set.avoid[p.key] = p.key === "names" ? names(p.value) : p.key === "letters" ? words(p.value).flatMap((w) => [...w.toLowerCase()]) : words(p.value).map((w) => w.replace(/^-|-$/g, "").toLowerCase());
  }
  if (raw.genitive) for (const r of raw.genitive.value.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const m = /^(\^?)(\S+?)(\$?)\s*>\s*(\S*)$/.exec(r);
    if (!m) { warn(raw.genitive.line, `genitive: "${r}" should read like "ach > aich" (an ending) or "^M > Mh" (a start).`); continue; }
    set.genitive.push({ from: m[2], to: m[4], at: m[1] ? "start" : "end" });
  }
  // (enough to make names from)
  const learned = [...set.examples, ...Object.values(set.names).flat()];
  if (!set.sounds && !learned.length) err(0, "The name set needs sounds (onsets, vowels, codas) or example names to make names from.");
  else if (!set.sounds && learned.length < 30) warn(0, `Only ${learned.length} example names to learn the sound from; 30 or more give names that don't just repeat them.`);
  if ((set.sounds || learned.length) && !problems.some((p) => p.level === "error")) {
    const make = wordMaker(set, (w) => keepsRules(set, w));
    if (![1, 2, 3, 4, 5, 6].some((k) => make(probe(k)))) err(0, set.sounds ? "It can't make a name with these rules: check its syllables and length against each other, and what it avoids." : "It can't make a name from these examples with these rules: examples need three letters or more, and the avoid rules may leave nothing.");
    else {
      // (a set that makes only a handful of words would fill a map with numbered repeats)
      const seen = new Set();
      for (let k = 1; k <= 300 && seen.size < 40; k++) { const wd = make(probe(k)); if (wd) seen.add(wd); }
      if (seen.size < 40) warn(0, `It can make only about ${seen.size} different names; give it more sounds or syllables, or a map runs out and numbers them.`);
    }
  }
  return { set: problems.some((p) => p.level === "error") && !set.sounds && !learned.length ? null : set, problems };
}

/** A small seeded random source shaped like rng.mjs's (int, pick, chance, next), for trying a set out. */
function probe(seed) {
  let a = (seed * 2654435761) >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (n) => Math.floor(next() * n), pick: (l) => l[Math.floor(next() * l.length)], chance: (p) => next() < p };
}

/** An element as written: "-os" a suffix, "reyk-" a prefix, text with {name} or {river} a pattern; else null. */
function elementOf(t) {
  if (/\{(name|river(:gen)?)\}/.test(t)) return { type: "pattern", text: t };
  if (/^-\S+$/.test(t)) return { type: "suffix", text: t.slice(1) };
  if (/^\S+-$/.test(t)) return { type: "prefix", text: t.slice(0, -1) };
  return null;
}

/** Whether a set's elements name a place's river ({river} or {river:gen}). */
export const usesRiver = (set) => Object.values(set?.elements ?? {}).flat().some((e) => e.type === "pattern" && /\{river/.test(e.text));

/** A name in the genitive by the set's rules (each rule once, starts and ends), else as it is. */
export function genitiveOf(name, rules = []) {
  let out = name, start = false, end = false;
  // (the first rule that fits each end, on the name as given: "ach > aich" then "ich > x" doesn't chain)
  for (const r of rules) {
    if (r.at === "start" && !start && name.startsWith(r.from)) { out = r.to + out.slice(r.from.length); start = true; }
    else if (r.at === "end" && !end && name.endsWith(r.from)) { out = out.slice(0, out.length - r.from.length) + r.to; end = true; }
  }
  return out;
}

const plain = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w);

/**
 * A word maker for a set: (r) => a new root word, or null. From its sounds when it has them, else learned from its
 * example names and bank (letter by letter; never one of them as it is). check(word)
 * says whether a word may stand (the set's avoid rules and the rude and well-known filters). Learned from the two letters
 * before on a small sample (under 120 words), three on a bigger one; never one letter off a sample.
 */
export function wordMaker(set, check = () => true) {
  if (set?.sounds) {
    const S = set.sounds, [s0, s1] = S.syllables, [l0, l1] = S.length;
    return (r) => {
      for (let t = 0; t < 60; t++) {
        const n = s0 + r.int(s1 - s0 + 1);
        let w = "";
        for (let k = 0; k < n; k++) {
          const on = S.onsets.length && (k > 0 || r.chance(0.8)) ? r.pick(S.onsets) : "";
          const co = S.codas.length && (k === n - 1 ? r.chance(0.55) : r.chance(0.2)) ? r.pick(S.codas) : "";
          w += on + r.pick(S.vowels) + co;
        }
        if (S.endings.length && r.chance(0.4)) { const e = r.pick(S.endings); w = /[aeiouyáéíóúýàèìòùâêîôûäëïöüæøœ]$/i.test(w) && /^[aeiouyáéíóúýàèìòùâêîôûäëïöüæøœ]/i.test(e) ? w.slice(0, -1) + e : w + e; }
        const len = [...w].length;
        if (len < l0 || len > l1 || !check(w)) continue;
        return cap(w);
      }
      return null;
    };
  }
  // learned: each word of the examples and the bank, less the set's own suffixes and prefixes
  const affixes = Object.values(set?.elements ?? {}).flat().filter((e) => e.type !== "pattern").map((e) => ({ ...e, text: e.text.toLowerCase() }));
  const train = [...(set?.examples ?? []), ...Object.values(set?.names ?? {}).flat()].flatMap((n) => n.toLowerCase().split(/[\s']+/)).filter((w) => [...w].length >= 3).map((w) => {
    for (const a of affixes) {
      if (a.type === "suffix" && w.endsWith(a.text) && [...w].length - [...a.text].length >= 3) return w.slice(0, w.length - a.text.length);
      if (a.type === "prefix" && w.startsWith(a.text) && [...w].length - [...a.text].length >= 3) return w.slice(a.text.length);
    }
    return w;
  });
  if (!train.length) return () => null;
  const seen = new Set(train.map(plain));
  // (one letter off a sample is a sample: Thalbrunn from Halbrunn)
  const nearSample = (w) => { const p = plain(w); for (const t of seen) if (Math.abs(t.length - p.length) <= 1 && edits1(t, p)) return true; return false; };
  const lens = train.map((w) => [...w].length).sort((a, b) => a - b), lo = Math.max(3, lens[Math.floor(lens.length * 0.1)]), hi = Math.max(lo + 1, lens[Math.floor(lens.length * 0.9)]);
  // (from the two letters before on a small sample, three on a big one: a small sample learned closely only repeats itself)
  const order = train.length < 120 ? 2 : 3, orders = order === 3 ? [3, 2, 1] : [2, 1];
  const model = new Map();
  for (const w of train) {
    const ch = ["^", "^", "^", ...w, "$"];
    for (let k = 3; k < ch.length; k++) for (const o of orders) { const ctx = ch.slice(k - o, k).join(""); const m = model.get(`${o}:${ctx}`) ?? new Map(); m.set(ch[k], (m.get(ch[k]) ?? 0) + 1); model.set(`${o}:${ctx}`, m); }
  }
  const next = (r, hist) => {
    for (const o of orders) {
      const m = model.get(`${o}:${hist.slice(-o).join("")}`);
      if (!m) continue;
      const tot = [...m.values()].reduce((a, b) => a + b, 0);
      let x = r.next() * tot;
      for (const [c, v] of [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) { x -= v; if (x < 0) return c; }
    }
    return "$";
  };
  return (r) => {
    for (let t = 0; t < 80; t++) {
      const hist = ["^", "^", "^"];
      let w = "";
      for (let k = 0; k < hi + 3; k++) { const c = next(r, hist); if (c === "$") break; w += c; hist.push(c); }
      const len = [...w].length;
      if (len < lo || len > hi || seen.has(plain(w)) || !check(w) || nearSample(w)) continue;
      return cap(w);
    }
    return null;
  };
}

/** Whether two words are one letter apart (one added, taken out or changed). */
function edits1(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

/** Whether a word keeps a set's avoid rules (letters, parts, starts; names are whole names, checked by the namer). */
export function keepsRules(set, word) {
  const w = plain(word), a = set?.avoid ?? {};
  // (a letter with an accent avoids only itself; a plain one, every accent of it too)
  const raw = String(word).normalize("NFC").toLowerCase();
  if ((a.letters ?? []).some((c) => (plain(c) === c ? w.includes(c) : raw.includes(c.normalize("NFC"))))) return false;
  if ((a.parts ?? []).some((p) => p && w.includes(plain(p)))) return false;
  if ((a.starts ?? []).some((p) => p && w.startsWith(plain(p)))) return false;
  return true;
}

/** Joins a root and an element: a suffix (a vowel where two would meet is dropped from the root), a prefix, a pattern. */
export function withElement(root, e, { river = null, riverGen = null } = {}) {
  if (e.type === "suffix") {
    const V = /[aeiouyáéíóúýàèìòùâêîôûäëïöüæøœ]/i;
    const a = V.test(root.slice(-1)) && V.test(e.text[0] ?? "") ? root.slice(0, -1) : root;
    return a + e.text;
  }
  if (e.type === "prefix") return cap(e.text) + root.toLowerCase();
  if (/\{river/.test(e.text) && !river) return null;
  // (a name joined to letters before it is lowercased: "Aber{river:gen}" gives Abersilverrun, not AberSilverrun)
  const put = (v) => (m, at, all) => (at > 0 && /\p{L}/u.test(all[at - 1]) ? v.toLowerCase() : v);
  return e.text.replace(/\{name\}/g, put(root)).replace(/\{river:gen\}/g, put(riverGen ?? river ?? "")).replace(/\{river\}/g, put(river ?? ""));
}

/** A few names a set makes, for a GM to judge it by: { places, features } (made with namer, from names.mjs). */
export function sampleNames(set, namerOf, seed = 1) {
  const nm = namerOf("custom", seed, { set });
  const sites = [{ river: { size: "large", roads: [] }, roads: [0, 180], mouth: true, coast: 90 }, { river: { size: "small" }, roads: [10] }, { coast: 200 }, { ground: "hills" }, { ground: "high", pass: true }, { biome: "temperate-forest" }, { lake: true }, {}, { river: { size: "medium" }, confluence: true, roads: [90] }, {}];
  const classes = ["city", "town", "town", "village", "castle", "village", "village", "hamlet", "town", "ruin"];
  const river = usesRiver(set) ? nm.feature("river", {}, "sample-river") : undefined;
  const places = classes.map((c, k) => nm.place(c, { ...sites[k], riverName: k === 0 ? river : undefined }, `sample-${k}`));
  const features = ["sea", "bay", "lake", "river", "range", "forest", "island", "cape"].map((k, i) => nm.feature(k, { high: i === 4 }, `sample-f${i}`));
  return { places, features };
}

/** A set's examples, as a rough count of what it has: for the window's list. */
export const describeSet = (set) => !set ? "" : [set.sounds ? "spelled-out sounds" : `${[...set.examples, ...Object.values(set.names).flat()].length} example names`, `${Object.keys(set.elements).length} elements`, `${Object.keys(set.kinds).length} kinds`, `${Object.values(set.names).flat().length} names to use`].join(", ");


