/**
 * Quick Start's Settlement tab: a Describe box over the settlement's choices. What the box reads (describe-place.mjs)
 * shows as chips and is set in the form; a chip's × takes it out. The form's choices follow the size: a village's or
 * town's buildings and places, a city's quarters and what lies outside its walls; a choice the size can't have is
 * grayed out with why. A choice left on Any, and a building or place neither said nor checked or cleared by hand, is
 * picked from the seed.
 */
import { QUICK, QUICK_LABELS, QUICK_ANY, QUICK_HIGH, QUICK_HIGH_LABELS, HAS, QUARTERS, quickLacks } from "../core/quick.mjs";
import { readPlace } from "../core/describe-place.mjs";
import { titleCase } from "../core/titles.mjs";
import { esc } from "./util.mjs";

const CITIES = ["city", "metropolis"];
const CENTER_LABELS = { square: "A market square", green: "A green", well: "A well", cathedral: "A cathedral", palace: "A palace", none: "None" };
const HAS_LABELS = { temple: "Temple", inn: "Inn", smithy: "Smithy", cemetery: "Cemetery", watermill: "Watermill", windmill: "Windmill", walled: "Walled" };
const QUARTER_LABELS = { docks: "Docks", market: "Market", temple: "Temple", nobles: "Nobles", crafts: "Crafts", poor: "Poor", garrison: "Garrison", merchants: "Merchants" };
const ANY = `<option value="">Any (by the Seed)</option>`;
// (every field's name begins s-: the tabs share the form)
const select = (name, title, values, labels, anyFirst) => {
  const opts = values.map((v) => `<option value="${v}">${esc(titleCase(labels[v] ?? v))}</option>`).join("");
  return `<div class="form-group" data-field="${name}"><label for="as-qs-${name}">${title}</label><select id="as-qs-${name}" name="s-${name}">${anyFirst ? ANY + opts : opts + ANY}</select></div>`;
};
const yesNo = (name, title) => `<div class="form-group" data-field="${name}"><label for="as-qs-${name}">${title}</label><select id="as-qs-${name}" name="s-o-${name}">${ANY}<option value="yes">Yes</option><option value="no">No</option></select></div>`;
// (a box's why, when it's grayed out, is shown beside its name)
const box = (name, label) => `<label><input type="checkbox" name="${name}"> ${esc(titleCase(label))}<span class="as-why"></span></label>`;

/**
 * The tab's HTML. fill: a region's place it starts from (townFromPlace's): what the region shows of it, and a box to
 * follow the way its roads, river and shore lie.
 */
export function settlementTabHTML(fill = null) {
  const L = QUICK_LABELS;
  const article = (w) => (/^[aeiou]/i.test(w) ? "An" : "A");
  const from = fill ? `<div class="as-qs-from" role="note">
      <p class="hint"><strong>From the region map:</strong> ${esc(`${article(fill.options.size)} ${fill.options.size}${fill.facts.length ? ` ${fill.facts.join(", ")}` : ""}.`)} Change anything below before making it.</p>
      ${fill.directions ? `<label data-tooltip-text="Its roads leave, its river runs and its sea or lake lies the way the region map shows them"><input type="checkbox" name="s-follow" checked> Follow the Map's Directions</label>` : ""}
    </div>` : "";
  return `<section class="as-qs-settlement" data-tab="settlement" id="as-qs-panel-settlement" role="tabpanel" aria-labelledby="as-qs-tab-settlement">
    ${from}
    <div class="form-group stacked"><label for="as-qs-describe">Describe It (Optional)</label><textarea id="as-qs-describe" name="s-describe" rows="3" placeholder="A walled port city with a cathedral, a citadel and no slums; a village called 'Ashby' with a green, a mill and an inn, in winter; a fortified town on a river among farms and woods..."></textarea></div>
    <div class="as-qs-chips" aria-live="polite"></div>
    <div class="as-qs-two">
      ${select("size", "Place", QUICK.size, L.size, false)}${select("season", "Season", QUICK.season, L.season, false)}
      ${select("water", "Water", QUICK.water, L.water, false)}${select("roads", "Roads", QUICK.roads, L.roads, false)}
      ${select("surroundings", "Around It", QUICK.surroundings, L.surroundings, false)}${select("center", "Center", QUICK.center, CENTER_LABELS, false)}
      ${select("river", "River", QUICK.river, L.river, QUICK_ANY.includes("river"))}${select("shape", "Outline", QUICK.shape, L.shape, QUICK_ANY.includes("shape"))}
    </div>
    <div class="as-qs-two" data-for="town">${select("high", "High Ground", QUICK_HIGH, QUICK_HIGH_LABELS, false).replace(ANY, "").replace("<select ", '<select data-tooltip-text="Along the edge with the most room; mountains come with hills before them" ')}</div>
    <div class="form-group" data-for="town"><label id="as-qs-has">It Has</label><div class="as-qs-features" role="group" aria-labelledby="as-qs-has">${HAS.map((k) => box(`s-h-${k}`, HAS_LABELS[k])).join("")}<button type="button" class="as-qs-reset" data-tooltip-text="Back to what its size has" hidden>Reset</button></div></div>
    <div class="form-group" data-for="city"><label id="as-qs-quarters">Quarters</label><div class="as-qs-features" role="group" aria-labelledby="as-qs-quarters">${QUARTERS.map((k) => box(`s-q-${k}`, QUARTER_LABELS[k])).join("")}</div></div>
    <div class="as-qs-two" data-for="city">${yesNo("citadel", "Citadel")}</div>
    <div class="form-group" data-for="city"><label id="as-qs-outside">Also</label><div class="as-qs-features" role="group" aria-labelledby="as-qs-outside">${box("s-o-oldWall", "Old inner wall")}${box("s-o-suburbs", "Suburbs")}${box("s-o-cemetery", "Cemeteries")}${box("s-o-mills", "Mills")}</div></div>
  </section>`;
}

/** What a village's or town's buildings and places are when left to it: true, false, or null (now and then). */
function hasDefaults(size, water, surroundings) {
  if (!size) return { ...Object.fromEntries(HAS.map((k) => [k, null])), walled: false };
  // (a watermill needs running water: a river or a stream, not a sea or a lake)
  const hamlet = size === "hamlet", wet = water === "river" || water === "stream";
  const fieldy = !surroundings ? null : surroundings === "farmland" || surroundings === "mixed";
  return {
    temple: !hamlet, inn: !hamlet, smithy: hamlet ? null : true,
    cemetery: size === "town",
    watermill: !water ? null : !wet ? false : hamlet ? null : true,
    windmill: hamlet || fieldy === false ? false : size === "town" && fieldy ? true : null,
    walled: false,
  };
}

/**
 * Wires the tab: the description read a moment after typing stops, its chips and their ×, the choices that follow
 * the size, and choices made by hand. A chip and a choice by hand for the same thing: the later wins. Returns
 * { flush, options }: flush reads a description still waiting; options() gives Quick Start's options from the form
 * (name and seed aside).
 */
export function wireSettlementTab(root, fill = null) {
  const form = root.closest("form") ?? root;
  const text = root.querySelector('[name="s-describe"]'), chips = root.querySelector(".as-qs-chips");
  const el = (n) => form.elements[n];
  const removed = new Set(); // (chips taken out, "key=value", while the description still says them)
  const hand = {}; // (key: { v, t }, set by hand; keys size, center, has.temple, quarters.poor, outside.citadel ...)
  const seen = new Map(); // ("key=value": when the chip first showed, while it shows)
  let kept = [], clock = 0, timer = null, shownName = "", lastHTML = "", lastText = "", textAt = 0;

  const firstOf = (s) => [...s.options].find((o) => o.value && !o.disabled)?.value ?? "";
  const chipFor = (key) => kept.find((c) => c.key === key);
  /** Whichever of the chip and the hand's choice came later. */
  const handWins = (key) => { const h = hand[key], c = chipFor(key); return !!h && (!c || h.t > (seen.get(`${c.key}=${c.value}`) ?? 0)); };
  const known = (key) => key in hand || !!chipFor(key);
  const value = (key) => (handWins(key) ? hand[key].v : chipFor(key)?.value);
  const setHand = (key, v) => { hand[key] = { v, t: ++clock }; };
  const why = (b, short) => {
    b.disabled = !!short;
    const label = b.closest("label");
    label.classList.toggle("as-off", !!short);
    label.querySelector(".as-why").textContent = short ? ` (${short})` : "";
  };

  /** Sets the form from what's said and set by hand, everything else to its first value or the size's own, then grays out. */
  const draw = () => {
    // (a choice neither said nor set shows its first value, as the dialog always has; a city's river and outline Any)
    for (const k of ["size", "season", "water", "roads", "surroundings", "center", "river", "shape"]) el(`s-${k}`).value = known(k) ? value(k) ?? "" : QUICK_ANY.includes(k) ? "" : QUICK[k][0];
    el("s-high").value = known("high") ? value("high") ?? "none" : "none";
    // (a name the description gave and no longer gives is cleared, unless it was typed over)
    if (el("name")) {
      if (known("name")) el("name").value = shownName = value("name") ?? "";
      else if (shownName && el("name").value === shownName) el("name").value = shownName = "";
    }
    const size = el("s-size").value, city = CITIES.includes(size), lacks = quickLacks(size || "village");
    // (the size's own sections)
    for (const s of root.querySelectorAll("[data-for]")) s.hidden = s.dataset.for === "city" ? !city : city;
    // Center, water: what the size can't have, grayed out, each saying whose it is (a dropdown shows no tooltips)
    for (const [k, labels] of [["center", CENTER_LABELS], ["water", QUICK_LABELS.water]]) {
      const s = el(`s-${k}`);
      for (const o of s.options) {
        if (!o.value) continue;
        const w = lacks[k]?.[o.value] ?? "", short = !w ? "" : city ? (k === "water" ? "a river in a city" : "a village's or town's") : "a city's";
        o.disabled = !!w;
        o.textContent = `${titleCase(String(labels[o.value] ?? o.value).replace(/ \(a city\)$/, ""))}${short ? ` (${short})` : ""}`;
      }
      if (s.selectedOptions[0]?.disabled) s.value = firstOf(s);
    }
    // (a choice that's all a city's says so in place of Any)
    const anyText = (s, t) => { s.options[[...s.options].findIndex((o) => !o.value)].textContent = t || "Any (by the Seed)"; };
    for (const k of ["river", "shape"]) {
      const w = lacks[k], s = el(`s-${k}`);
      s.disabled = !!w;
      if (w) s.value = "";
      anyText(s, w);
      root.querySelector(`[data-field="${k}"]`).classList.toggle("as-off", !!w);
    }
    const water = el("s-water").value, sur = el("s-surroundings").value, center = el("s-center").value;
    // A village's or town's buildings and places: said or set, else the size's own (now-and-then ones half-checked)
    const def = hasDefaults(size || null, water || null, sur || null);
    for (const k of HAS) {
      // (a watermill needs running water: not with no water, nor on a sea coast or a lake shore alone)
      const b = el(`s-h-${k}`), off = k === "watermill" && ["none", "coast", "lake"].includes(water) ? "needs a river or stream" : "";
      const v = known(`has.${k}`) ? !!value(`has.${k}`) : def[k];
      b.indeterminate = v === null && !off;
      b.checked = !off && v === true;
      why(b, off);
      const label = b.closest("label");
      if (!off && !known(`has.${k}`)) label.dataset.tooltipText = v === null ? "Now and then, by the seed, until you check or clear it" : "As its size has it, until you check or clear it";
      else delete label.dataset.tooltipText;
    }
    root.querySelector(".as-qs-reset").hidden = !HAS.some((k) => known(`has.${k}`));
    // A city's quarters (docks need water; a cathedral's or palace's quarter is kept), its citadel (the garrison's)
    // and old wall (a metropolis's)
    const lead = { cathedral: "temple", palace: "nobles" }[center];
    for (const k of QUARTERS) {
      const b = el(`s-q-${k}`), off = k === "docks" && water === "none" ? "needs water" : k === lead ? `the ${center}'s` : "";
      b.checked = k === lead || (!off && (known(`quarters.${k}`) ? !!value(`quarters.${k}`) : true));
      why(b, off);
    }
    {
      const s = el("s-o-citadel"), off = !el("s-q-garrison").checked;
      const v = known("outside.citadel") ? value("outside.citadel") : null;
      s.value = off || v === null || v === undefined ? "" : v ? "yes" : "no";
      s.disabled = off;
      anyText(s, off ? "None without the garrison" : "");
      root.querySelector('[data-field="citadel"]').classList.toggle("as-off", off);
    }
    for (const k of ["oldWall", "suburbs", "cemetery", "mills"]) {
      const b = el(`s-o-${k}`), off = k === "oldWall" && lacks.outside?.oldWall ? "a metropolis's" : "";
      b.checked = !off && (known(`outside.${k}`) ? !!value(`outside.${k}`) : true);
      why(b, off);
    }
  };

  const apply = () => {
    clearTimeout(timer); timer = null;
    const t = text.value.trim();
    // (a chip that shows because the text changed is new now; one that shows because the size changed by hand is as
    // old as the text, so it doesn't win over choices made since)
    if (t !== lastText) { lastText = t; textAt = ++clock; }
    const note = (r, at) => { for (const c of r.chips) { const id = `${c.key}=${c.value}`; if (!seen.has(id)) seen.set(id, at); } };
    const formWater = { water: el("s-water").value };
    const own = t ? readPlace(t, formWater) : { chips: [], skipped: [], unknown: [], choices: {} };
    note(own, textAt);
    kept = own.chips.filter((c) => !removed.has(`${c.key}=${c.value}`));
    // (read again for the size the form shows when that's not the size it says, so its chips fit the form; Any by
    // hand reads as a village's, as the form shows)
    const size = handWins("size") ? hand.size.v || "village" : chipFor("size")?.value;
    let read = own;
    if (t && size && size !== own.choices.size) { read = readPlace(t, { size, ...formWater }); note(read, textAt); }
    // (forgotten only when neither read has it: a size changed and back brings nothing back over the hand's choices)
    const now = new Set([...own.chips, ...read.chips].map((c) => `${c.key}=${c.value}`));
    for (const id of [...seen.keys()]) if (!now.has(id)) seen.delete(id);
    for (const id of [...removed]) if (!now.has(id)) removed.delete(id);
    kept = read.chips.filter((c) => !removed.has(`${c.key}=${c.value}`));
    draw();
    const html = [
      kept.length || read.skipped.length || read.unknown.length ? `<div class="hint">What it understood (each also set in the form below; × takes it out):</div>` : "",
      ...kept.map((c) => {
        const over = handWins(c.key) && hand[c.key].v !== c.value;
        return `<span class="as-qs-chip${over ? " as-later" : ""}" data-chip="${esc(`${c.key}=${c.value}`)}">${esc(c.key === "name" ? c.label : titleCase(c.label))}${over ? " (changed below)" : ""} <button type="button" class="as-qs-x" aria-label="Take out ${esc(c.label)}" data-tooltip-text="Take this out">×</button></span>`;
      }),
      ...read.skipped.map((k) => `<span class="as-qs-chip as-unknown" role="note" aria-label="${esc(`${k.label}: left out. ${k.why}`)}" data-tooltip-text="${esc(k.why)}">${esc(titleCase(k.label))}: Left Out</span>`),
      ...read.unknown.map((w) => `<span class="as-qs-chip as-unknown" data-tooltip-text="Not understood: left out">${esc(w)}</span>`),
    ].join("");
    // (only when it changed, so a screen reader doesn't read the list again at every click)
    if (html !== lastHTML) chips.innerHTML = lastHTML = html;
  };

  text.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(apply, 250); });
  chips.addEventListener("click", (event) => {
    const x = event.target.closest(".as-qs-x");
    if (!x) return;
    event.preventDefault();
    const at = [...chips.querySelectorAll(".as-qs-x")].indexOf(x);
    removed.add(x.closest("[data-chip]").dataset.chip);
    apply();
    // (focus to the next chip's ×, else the text, so the keyboard isn't left nowhere)
    const xs = chips.querySelectorAll(".as-qs-x");
    (xs[Math.min(at, xs.length - 1)] ?? text).focus();
  });
  // A village's or town's buildings and places back to its size's: what's set by hand forgotten, what's said taken out
  root.querySelector(".as-qs-reset").addEventListener("click", (event) => {
    event.preventDefault();
    for (const k of HAS) { delete hand[`has.${k}`]; const c = chipFor(`has.${k}`); if (c) removed.add(`${c.key}=${c.value}`); }
    apply();
  });
  // A choice made by hand ("" is Any, chosen)
  const keyOf = (n) => {
    if (!n?.startsWith("s-") || n === "s-describe") return null;
    const m = n.match(/^s-(h|q|o)-(\w+)$/);
    return m ? `${{ h: "has", q: "quarters", o: "outside" }[m[1]]}.${m[2]}` : n.slice(2);
  };
  form.addEventListener("change", (event) => {
    const t = event.target, key = keyOf(t?.name);
    if (!key) return;
    setHand(key, t.type === "checkbox" ? t.checked : key === "outside.citadel" ? (t.value === "" ? null : t.value === "yes") : t.value);
    apply();
  });
  el("name")?.addEventListener("input", () => setHand("name", el("name").value));
  // (a region's place: its choices as if set by hand, so the Describe box can still change them)
  if (fill) for (const k of ["size", "season", "water", "roads", "surroundings", "river", "high", "name"]) if (fill[k] !== undefined && fill[k] !== null) setHand(k, fill[k]);
  // (what the region map decided of it: walls and a temple, a city's citadel)
  if (fill) { for (const [k, v] of Object.entries(fill.has ?? {})) if (HAS.includes(k)) setHand(`has.${k}`, !!v); if (fill.outside && "citadel" in fill.outside) setHand("outside.citadel", !!fill.outside.citadel); }
  draw();

  /** Quick Start's options from the form: choices on Any, and boxes neither said nor set by hand, left out. */
  const options = () => {
    const o = {};
    for (const k of ["size", "season", "water", "roads", "surroundings", "center", "river", "shape"]) { const s = el(`s-${k}`); if (s?.value && !s.disabled) o[k] = s.value; }
    const size = el("s-size").value;
    if (!CITIES.includes(size) && el("s-high").value !== "none") o.high = el("s-high").value;
    if (CITIES.includes(size)) {
      if (QUARTERS.some((k) => known(`quarters.${k}`) || el(`s-q-${k}`).disabled)) o.quarters = QUARTERS.filter((k) => el(`s-q-${k}`).checked);
      const out = {};
      if (!el("s-q-garrison").checked) out.citadel = false;
      else if (el("s-o-citadel").value) out.citadel = el("s-o-citadel").value === "yes";
      for (const k of ["oldWall", "suburbs", "cemetery", "mills"]) if (!el(`s-o-${k}`).checked && !el(`s-o-${k}`).disabled) out[k] = false;
      if (Object.keys(out).length) o.outside = out;
    } else {
      const has = {};
      for (const k of HAS) if (known(`has.${k}`) && !el(`s-h-${k}`).disabled) has[k] = !!value(`has.${k}`);
      if (Object.keys(has).length) o.has = has;
    }
    return o;
  };
  return { flush: () => { if (timer) apply(); }, options };
}
