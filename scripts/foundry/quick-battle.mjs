/**
 * Quick Start's Battle map tab: a Describe box over the brief's form. What the box reads (describe.mjs) shows as
 * chips and is set in the form; a chip's × takes its choice out; what it read but left out, and words it doesn't
 * know, are listed. The form is the brief (brief.mjs): site, size, season, time, weather, ground, features and
 * scatter, then the site's own settings.
 */
import { BRIEF, BRIEF_LABELS, SITE_LACKS, normalizeBrief } from "../core/brief.mjs";
import { readDescription } from "../core/describe.mjs";
import { titleCase } from "../core/titles.mjs";
import { esc } from "./util.mjs";

// (a chip that repeats words the GM wrote, a name or a list of rooms, is shown as written; the rest in title case)
const FREE_TEXT = new Set(["name", "building.name", "building.rooms", "building.upstairs"]);
// (every field's name begins b-: the Settlement tab shares the form)
const select = (name, title, key, value) => `<div class="form-group"><label for="as-qb-${name}">${title}</label><select id="as-qb-${name}" name="b-${name}">${BRIEF[key].map((v) => `<option value="${v}" ${v === value ? "selected" : ""}>${esc(titleCase(BRIEF_LABELS[key][v]))}</option>`).join("")}</select></div>`;

/** The tab's HTML, its form at the defaults. */
export function battleTabHTML() {
  const b = normalizeBrief({});
  return `<section class="as-qs-battle" data-tab="battle" id="as-qs-panel-battle" role="tabpanel" aria-labelledby="as-qs-tab-battle" hidden>
    <div class="form-group stacked"><label for="as-qb-describe">Describe It (Optional)</label><textarea id="as-qb-describe" name="b-describe" rows="3" placeholder="A roadside inn at night in spring, with a stage and a kitchen; a wilderness map on a cliff, littered with trees, stumps and logs; a caravan camp by a road at dusk; a fort with roofed towers in winter..."></textarea></div>
    <div class="as-qs-chips" aria-live="polite"></div>
    <h4>Site</h4>
    <div class="as-qs-two">
      ${select("site", "Site", "site", b.site)}${select("size", "Size", "size", b.size)}
      ${select("season", "Season", "season", b.season)}${select("time", "Time of Day", "time", b.time)}
      ${select("weather", "Weather", "weather", b.weather)}${select("ground", "Ground", "ground", b.ground)}
    </div>
    <div class="form-group"><label id="as-qb-features">Features</label><div class="as-qs-features" role="group" aria-labelledby="as-qb-features">${BRIEF.features.map((f) => `<label><input type="checkbox" name="b-f-${f}" ${b.features.includes(f) ? "checked" : ""}> ${esc(titleCase(BRIEF_LABELS.features[f]))}<span class="as-why"></span></label>`).join("")}</div></div>
    <h4>Scatter</h4>
    <div class="as-qs-two">
      ${select("trees", "Trees", "trees", b.trees)}${select("litter", "Stumps and Logs", "litter", b.litter)}
      ${select("rocks", "Rocks", "rocks", b.rocks)}${select("brush", "Bushes and Ferns", "brush", b.brush)}
    </div>
    <div data-site="roadside" hidden>
      <h4>Building</h4>
      <div class="as-qs-two">${select("use", "Use", "use", b.building.use)}${select("bsize", "Size", "buildingSize", b.building.size)}</div>
      <div class="form-group stacked"><label for="as-qb-rooms">Rooms</label><input type="text" id="as-qb-rooms" name="b-rooms" placeholder="From its use if empty (common room with a stage, kitchen, two bedrooms)"></div>
      <div class="form-group"><label for="as-qb-bname">Name</label><input type="text" id="as-qb-bname" name="b-bname" placeholder="Made up for an inn if empty"></div>
      <div class="as-qs-two">
        <div class="form-group"><label for="as-qb-floors">Floors Above</label><select id="as-qb-floors" name="b-floors"><option value="">By Its Use</option><option value="0">None</option><option value="1">One</option><option value="2">Two</option><option value="3">Three</option></select></div>
        <div class="form-group"><label for="as-qb-cellar">Cellar</label><select id="as-qb-cellar" name="b-cellar"><option value="">By Its Use</option><option value="yes">Yes</option><option value="no">No</option></select></div>
      </div>
      <div class="form-group stacked"><label for="as-qb-upstairs">Upstairs Rooms</label><input type="text" id="as-qb-upstairs" name="b-upstairs" placeholder="By its use if empty (an inn's guest rooms off a corridor: 7 bedrooms)"></div>
      <div class="form-group stacked"><label for="as-qb-crooms">Cellar Rooms</label><input type="text" id="as-qb-crooms" name="b-crooms" placeholder="By its use if empty (cellar, storeroom)"></div>
    </div>
    <div data-site="street" hidden>
      <h4>Street</h4>
      <div class="as-qs-two">${select("place", "Place", "place", b.street.place)}${select("quarter", "Quarter", "quarter", b.street.quarter)}</div>
    </div>
    <div data-site="camp" hidden>
      <h4>Camp</h4>
      <div class="as-qs-two">${select("camp", "Kind", "camp", b.camp.kind)}<div class="form-group"><label for="as-qb-tents">Tents</label><input type="number" id="as-qb-tents" name="b-tents" min="1" max="16" step="1" placeholder="By its kind"></div></div>
    </div>
    <div data-site="cave" hidden>
      <h4>Cave</h4>
      <p class="hint">Solid rock, its passages and chambers carved out, the floor worn with cracks, rubble, moss and puddles.</p>
      <div class="as-qs-two">${select("openness", "Open Ground", "openness", b.underground.openness)}</div>
    </div>
    <div data-site="dungeon" hidden>
      <h4>Dungeon</h4>
      <p class="hint">Rooms in solid rock, joined by corridors, doors where they meet.</p>
      <div class="as-qs-two">${select("corridors", "Corridors", "corridors", b.underground.corridors)}${select("doors", "Doors", "doors", b.underground.doors)}</div>
    </div>
    <div data-site="castle" hidden>
      <h4>Castle</h4>
      <p class="hint">A curtain wall with a walk along its top, towers and a gatehouse with floors, a keep and its yard's buildings, each floor a level of the scene. Its size above is the castle's.</p>
      <div class="as-qs-two">${select("towers", "Tower Tops", "towers", b.castle.towers)}${select("moat", "Moat", "moat", b.castle.moat)}</div>
    </div>
  </section>`;
}

export function briefFromForm(form, seed) {
  const v = (n) => form.elements[n === "name" ? n : `b-${n}`]?.value ?? "";
  return normalizeBrief({
    site: v("site"), size: v("size"), season: v("season"), time: v("time"), weather: v("weather"), ground: v("ground"),
    features: BRIEF.features.filter((f) => form.elements[`b-f-${f}`]?.checked && !form.elements[`b-f-${f}`]?.disabled),
    trees: v("trees"), litter: v("litter"), rocks: v("rocks"), brush: v("brush"),
    building: { use: v("use"), size: v("bsize"), rooms: v("rooms"), name: v("bname"), floors: v("floors"), cellar: v("cellar"), upstairs: v("upstairs"), cellarRooms: v("crooms") },
    street: { place: v("place"), quarter: v("quarter") },
    camp: { kind: v("camp"), tents: v("tents") ? Number(v("tents")) : null },
    castle: { towers: v("towers"), moat: v("moat") },
    underground: { openness: v("openness"), corridors: v("corridors"), doors: v("doors") },
    name: v("name"), seed,
  });
}

/** Sets the form to a brief (every choice; the brief already filled in), the shared Name too. */
function setForm(form, b) {
  const set = (n, value) => { const el = form.elements[`b-${n}`]; if (el) el.value = value ?? ""; };
  for (const k of ["site", "size", "season", "time", "weather", "ground", "trees", "litter", "rocks", "brush"]) set(k, b[k]);
  for (const f of BRIEF.features) if (form.elements[`b-f-${f}`]) form.elements[`b-f-${f}`].checked = b.features.includes(f);
  set("use", b.building.use); set("bsize", b.building.size); set("rooms", b.building.rooms); set("bname", b.building.name);
  set("floors", b.building.floors ?? ""); set("cellar", b.building.cellar === true ? "yes" : b.building.cellar === false ? "no" : ""); set("upstairs", b.building.upstairs); set("crooms", b.building.cellarRooms);
  set("place", b.street.place); set("quarter", b.street.quarter);
  set("camp", b.camp.kind); set("tents", b.camp.tents ?? "");
  set("towers", b.castle.towers); set("moat", b.castle.moat);
  set("openness", b.underground.openness); set("corridors", b.underground.corridors); set("doors", b.underground.doors);
  if (form.elements.name) form.elements.name.value = b.name ?? "";
}

/** Shows the site's own settings and hides the others'. */
function showSite(root) {
  const site = root.querySelector('[name="b-site"]')?.value;
  for (const el of root.querySelectorAll("[data-site]")) el.hidden = el.dataset.site !== site;
  // (a castle's size is the castle's own: a fort, a castle, a great castle, each with its map's size)
  for (const o of root.querySelectorAll('[name="b-size"] option')) o.textContent = (site === "castle" ? BRIEF_LABELS.castleSize : BRIEF_LABELS.size)[o.value] ?? o.textContent;
  // (a feature the site never has room for, grayed out with why)
  for (const f of BRIEF.features) {
    const box = root.querySelector(`[name="b-f-${f}"]`), why = SITE_LACKS[site]?.[f];
    if (!box) continue;
    box.disabled = !!why;
    if (why) box.checked = false;
    const label = box.closest("label");
    if (label) {
      label.classList.toggle("as-off", !!why);
      const w = label.querySelector(".as-why");
      if (w) w.textContent = why ? " (no room)" : "";
      if (why) label.dataset.tooltipText = why; else delete label.dataset.tooltipText;
    }
  }
}

/** A form field's brief key ("b-bsize" is "building.size", a feature's box "feature.pond"), or null for one that isn't. */
const FIELD_KEYS = { use: "building.use", bsize: "building.size", rooms: "building.rooms", bname: "building.name", floors: "building.floors", cellar: "building.cellar", upstairs: "building.upstairs", crooms: "building.cellarRooms", place: "street.place", quarter: "street.quarter", camp: "camp.kind", tents: "camp.tents", towers: "castle.towers", moat: "castle.moat", openness: "underground.openness", corridors: "underground.corridors", doors: "underground.doors" };
function keyOf(name) {
  if (name === "name") return "name";
  if (!name?.startsWith("b-") || name === "b-describe") return null;
  const n = name.slice(2);
  return n.startsWith("f-") ? `feature.${n.slice(2)}` : FIELD_KEYS[n] ?? n;
}
const getKey = (b, key) => key.split(".").reduce((o, k) => o?.[k], b);
const setKey = (b, key, value) => { const [k, sub] = key.split("."); if (sub) b[k] = { ...(b[k] ?? {}), [sub]: value }; else b[k] = value; };

/**
 * Wires the tab: the description read a moment after typing stops, its chips, a chip's ×, the site's own settings,
 * and a new site's defaults when the site is picked by hand. The form is the description's chips over the choices
 * made by hand, over the site's defaults: a choice set by hand is kept until the description newly says otherwise,
 * and a chip taken out stays out while the description still says it. Returns { flush } (reads a pending description,
 * for Make).
 */
export function wireBattleTab(root) {
  const form = root.closest("form") ?? root;
  const box = root.querySelector('[name="b-describe"]'), chips = root.querySelector(".as-qs-chips");
  const removed = new Set();
  const hand = {}; // (brief key: value, as set by hand)
  let timer = null, lastText = "", lastChips = new Set();
  const apply = () => {
    clearTimeout(timer); timer = null;
    const text = box.value.trim();
    const read = text ? readDescription(text) : { chips: [], later: [], skipped: [], unknown: [] };
    if (text !== lastText) {
      // (what the description newly says, a chip new or changed since it was last read, wins over what the hand set for
      // the same choice: a feature it names, each; a chip it said before keeps losing to the hand, and one taken out
      // stays out while the description still says it)
      const now = new Set(read.chips.map((c) => `${c.key}=${c.value}`));
      for (const c of read.chips) if (!lastChips.has(`${c.key}=${c.value}`)) delete hand[c.key === "features" ? `feature.${c.value}` : c.key];
      for (const k of [...removed]) if (!now.has(k)) removed.delete(k);
      lastText = text; lastChips = now;
    }
    // (the chips taken out are left out: each back to the hand's choice, else its site's default)
    const kept = read.chips.filter((c) => !removed.has(`${c.key}=${c.value}`));
    const partial = {};
    for (const c of kept) {
      if (c.key === "features") (partial.features ??= []).push(c.value);
      else setKey(partial, c.key, c.value);
    }
    // (a feature taken out leaves the features read, not the site's default ones; a box checked or cleared by hand is
    // laid over them, each on its own)
    const handFeatures = Object.keys(hand).filter((k) => k.startsWith("feature."));
    if (!partial.features && (read.chips.some((c) => c.key === "features") || handFeatures.length)) partial.features = read.chips.some((c) => c.key === "features") || !handFeatures.length ? [] : [...normalizeBrief({ site: partial.site ?? hand.site }).features];
    for (const k of handFeatures) { const f = k.slice(8); partial.features = partial.features.filter((x) => x !== f); if (hand[k]) partial.features.push(f); }
    for (const [k, v] of Object.entries(hand)) if (!k.startsWith("feature.")) setKey(partial, k, v);
    setForm(form, normalizeBrief(partial));
    showSite(root);
    chips.innerHTML = [
      kept.length || read.later.length || read.skipped.length || read.unknown.length ? `<div class="hint">What it understood (each also set in the form below; × takes it out):</div>` : "",
      ...kept.map((c) => `<span class="as-qs-chip" data-chip="${esc(`${c.key}=${c.value}`)}">${esc(FREE_TEXT.has(c.key) ? c.label : titleCase(c.label))} <button type="button" class="as-qs-x" aria-label="Take out ${esc(c.label)}" data-tooltip-text="Take this out">×</button></span>`),
      ...(read.later ?? []).map((l) => `<span class="as-qs-chip as-later">${esc(titleCase(l.label))}</span>`),
      ...read.skipped.map((k) => `<span class="as-qs-chip as-unknown" role="note" aria-label="${esc(`${k.label}: left out. ${k.why}`)}" data-tooltip-text="${esc(k.why)}">${esc(titleCase(k.label))}: Left Out</span>`),
      ...read.unknown.map((w) => `<span class="as-qs-chip as-unknown" data-tooltip-text="Not understood: left out">${esc(w)}</span>`),
    ].join("");
  };
  box.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(apply, 250); });
  chips.addEventListener("click", (event) => {
    const x = event.target.closest(".as-qs-x");
    if (!x) return;
    event.preventDefault();
    const at = [...chips.querySelectorAll(".as-qs-x")].indexOf(x);
    removed.add(x.closest("[data-chip]").dataset.chip);
    apply();
    // (focus to the next chip's ×, else the text, so the keyboard isn't left nowhere)
    const xs = chips.querySelectorAll(".as-qs-x");
    (xs[Math.min(at, xs.length - 1)] ?? box).focus();
  });
  // A choice made by hand: kept from now on; a site picked by hand brings its own ground, trees and features
  const onHand = (event) => {
    const key = keyOf(event.target?.name);
    if (!key) return;
    const now = briefFromForm(form, 1);
    if (key === "site") {
      for (const k of Object.keys(hand)) if (["ground", "trees", "litter", "rocks", "brush"].includes(k) || k.startsWith("feature.")) delete hand[k];
      hand.site = now.site;
      if (!lastText) { const d = normalizeBrief({ site: now.site }); setForm(form, { ...now, ground: d.ground, trees: d.trees, litter: d.litter, rocks: d.rocks, brush: d.brush, features: d.features }); showSite(root); return; }
      removed.add(`site=${getKey(readDescription(lastText).brief, "site")}`);
      apply();
      return;
    }
    hand[key] = key.startsWith("feature.") ? !!event.target.checked : key === "camp.tents" ? (now.camp.tents ?? null) : getKey(now, key);
  };
  form.addEventListener("change", onHand);
  for (const n of ["b-rooms", "b-bname", "b-tents", "b-upstairs", "b-crooms", "name"]) form.elements[n]?.addEventListener("input", onHand);
  showSite(root);
  return { flush: () => { if (timer) apply(); } };
}
