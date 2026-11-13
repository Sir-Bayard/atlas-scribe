/**
 * Quick Start's Settlement tab: a Describe box over the settlement's choices. What the box reads (describe-place.mjs)
 * shows as chips and is set in the form; a chip's × takes it out. The form's choices follow the size: a village's or
 * town's buildings and places, a city's quarters and what lies outside its walls; a choice the size can't have is
 * grayed out with why. A choice left on Any, and a building or place neither said nor checked or cleared by hand, is
 * picked from the seed.
 */
import { QUICK, QUICK_LABELS, QUICK_ANY, CENTERS, HAS, QUARTERS, quickLacks } from "../core/quick.mjs";
import { readPlace } from "../core/describe-place.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const CITIES = ["city", "metropolis"];
const CENTER_LABELS = { square: "A market square", green: "A green", well: "A well", cathedral: "A cathedral", palace: "A palace", none: "None" };
const HAS_LABELS = { temple: "Temple", inn: "Inn", smithy: "Smithy", cemetery: "Cemetery", watermill: "Watermill", windmill: "Windmill", walled: "Walled" };
const QUARTER_LABELS = { docks: "Docks", market: "Market", temple: "Temple", nobles: "Nobles", crafts: "Crafts", poor: "Poor", garrison: "Garrison", merchants: "Merchants" };
const ANY = `<option value="">Any (by the seed)</option>`;
// (every field's name begins s-: the tabs share the form)
const select = (name, title, values, labels, anyFirst) => {
  const opts = values.map((v) => `<option value="${v}">${esc(labels[v] ?? v)}</option>`).join("");
  return `<div class="form-group" data-field="${name}"><label for="as-qs-${name}">${title}</label><select id="as-qs-${name}" name="s-${name}">${anyFirst ? ANY + opts : opts + ANY}</select></div>`;
};
const yesNo = (name, title) => `<div class="form-group" data-field="${name}"><label for="as-qs-${name}">${title}</label><select id="as-qs-${name}" name="s-o-${name}">${ANY}<option value="yes">Yes</option><option value="no">No</option></select></div>`;
// (a box's why, when it's grayed out, is shown beside its name)
const box = (name, label) => `<label><input type="checkbox" name="${name}"> ${esc(label)}<span class="as-why"></span></label>`;

/** The tab's HTML. */
export function settlementTabHTML() {
  const L = QUICK_LABELS;
  return `<section class="as-qs-settlement" data-tab="settlement">
    <div class="form-group stacked"><label for="as-qs-describe">Describe it (optional)</label><textarea id="as-qs-describe" name="s-describe" rows="3" placeholder="A walled port city with a cathedral, a citadel and no slums; a village called 'Ashby' with a green, a mill and an inn, in winter; a fortified town on a river among farms and woods..."></textarea></div>
    <div class="as-qs-chips" aria-live="polite"></div>
    <div class="as-qs-two">
      ${select("size", "Place", QUICK.size, L.size, false)}${select("season", "Season", QUICK.season, L.season, false)}
      ${select("water", "Water", QUICK.water, L.water, false)}${select("roads", "Roads", QUICK.roads, L.roads, false)}
      ${select("surroundings", "Around it", QUICK.surroundings, L.surroundings, false)}${select("center", "Center", QUICK.center, CENTER_LABELS, false)}
      ${select("river", "River", QUICK.river, L.river, QUICK_ANY.includes("river"))}${select("shape", "Outline", QUICK.shape, L.shape, QUICK_ANY.includes("shape"))}
    </div>
    <div class="form-group" data-for="town"><label id="as-qs-has">It has</label><div class="as-qs-features" role="group" aria-labelledby="as-qs-has">${HAS.map((k) => box(`s-h-${k}`, HAS_LABELS[k])).join("")}<button type="button" class="as-qs-reset" data-tooltip="Back to what its size has" hidden>Reset</button></div></div>
    <div class="form-group" data-for="city"><label id="as-qs-quarters">Quarters</label><div class="as-qs-features" role="group" aria-labelledby="as-qs-quarters">${QUARTERS.map((k) => box(`s-q-${k}`, QUARTER_LABELS[k])).join("")}</div></div>
    <div class="as-qs-two" data-for="city">${yesNo("citadel", "Citadel")}</div>
    <div class="form-group" data-for="city"><label id="as-qs-outside">Also</label><div class="as-qs-features" role="group" aria-labelledby="as-qs-outside">${box("s-o-oldWall", "Old inner wall")}${box("s-o-suburbs", "Suburbs")}${box("s-o-cemetery", "Cemeteries")}${box("s-o-mills", "Mills")}</div></div>
  </section>`;
}

/** What a village's or town's buildings and places are when left to it: true, false, or null (now and then). */
function hasDefaults(size, water, surroundings) {
  if (!size) return { ...Object.fromEntries(HAS.map((k) => [k, null])), walled: false };
  const hamlet = size === "hamlet", wet = water && water !== "none";
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
export function wireSettlementTab(root) {
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
        o.title = w;
        o.textContent = `${String(labels[o.value] ?? o.value).replace(/ \(a city\)$/, "")}${short ? ` (${short})` : ""}`;
      }
      if (s.selectedOptions[0]?.disabled) s.value = firstOf(s);
    }
    // (a choice that's all a city's says so in place of Any)
    const anyText = (s, t) => { s.options[[...s.options].findIndex((o) => !o.value)].textContent = t || "Any (by the seed)"; };
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
      const b = el(`s-h-${k}`), off = k === "watermill" && water === "none" ? "needs a river or stream" : "";
      const v = known(`has.${k}`) ? !!value(`has.${k}`) : def[k];
      b.indeterminate = v === null && !off;
      b.checked = !off && v === true;
      why(b, off);
      const label = b.closest("label");
      if (!off && !known(`has.${k}`)) label.dataset.tooltip = v === null ? "Now and then, by the seed, until you check or clear it" : "As its size has it, until you check or clear it";
      else delete label.dataset.tooltip;
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
    const own = t ? readPlace(t) : { chips: [], skipped: [], unknown: [], choices: {} };
    note(own, textAt);
    kept = own.chips.filter((c) => !removed.has(`${c.key}=${c.value}`));
    // (read again for the size the form shows when that's not the size it says, so its chips fit the form; Any by
    // hand reads as a village's, as the form shows)
    const size = handWins("size") ? hand.size.v || "village" : chipFor("size")?.value;
    let read = own;
    if (t && size && size !== own.choices.size) { read = readPlace(t, { size }); note(read, textAt); }
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
        return `<span class="as-qs-chip${over ? " as-later" : ""}" data-chip="${esc(`${c.key}=${c.value}`)}"${over ? ` data-tooltip="Changed in the form below"` : ""}>${esc(c.label)}${over ? " (changed below)" : ""} <button type="button" class="as-qs-x" aria-label="Take out ${esc(c.label)}" data-tooltip="Take this out">×</button></span>`;
      }),
      ...read.skipped.map((k) => `<span class="as-qs-chip as-unknown" data-tooltip="${esc(k.why)}">${esc(k.label)}: left out<span class="as-sr"> (${esc(k.why)})</span></span>`),
      ...read.unknown.map((w) => `<span class="as-qs-chip as-unknown" data-tooltip="Not understood: left out">${esc(w)}</span>`),
    ].join("");
    // (only when it changed, so a screen reader doesn't read the list again at every click)
    if (html !== lastHTML) chips.innerHTML = lastHTML = html;
  };

  text.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(apply, 250); });
  chips.addEventListener("click", (event) => {
    const x = event.target.closest(".as-qs-x");
    if (!x) return;
    event.preventDefault();
    removed.add(x.closest("[data-chip]").dataset.chip);
    apply();
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
  draw();

  /** Quick Start's options from the form: choices on Any, and boxes neither said nor set by hand, left out. */
  const options = () => {
    const o = {};
    for (const k of ["size", "season", "water", "roads", "surroundings", "center", "river", "shape"]) { const s = el(`s-${k}`); if (s?.value && !s.disabled) o[k] = s.value; }
    const size = el("s-size").value;
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
