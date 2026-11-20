/**
 * The AtlasScribe window's dialogs for a plan's file: Quick Start, Open, Import, and the questions asked before
 * writing over a plan, dropping unsaved changes or bringing back a draft. Each resolves to what was chosen (null when
 * the dialog was closed or canceled); the window does the rest.
 */
import { battleTabHTML, wireBattleTab, briefFromForm } from "./quick-battle.mjs";
import { settlementTabHTML, wireSettlementTab } from "./quick-settlement.mjs";
import { windowKeys } from "../kit/keyboard.mjs";
import { REGION, REGION_LABELS } from "../core/quick-region.mjs";
import { LAND_QUICK, LAND_QUICK_LABELS, LAND_MORE } from "../core/quick-land.mjs";
import { storedNameSets } from "./name-sets.mjs";
import { titleCase } from "../core/titles.mjs";
import { esc, note } from "./util.mjs";

const Dialog = () => foundry.applications.api.DialogV2;

/**
 * Quick Start: three tabs, a settlement, a battle map or a region, each described in words or chosen, and a name and seed for
 * both. tab: the tab shown first; seed: the seed offered; onTab(tab) when the GM switches. Resolves to the settlement's
 * options ({ ..., name, seed }), or { battle: brief }, or { region: options } (the classic local region), or
 * { land: options } (a generated kingdom, realm, continent or world, its name set from the library as nameSetId), or null.
 */
export async function quickDialog({ tab = "settlement", seed, onTab = () => {} }) {
  const tabButton = (id, label) => `<button type="button" role="tab" id="as-qs-tab-${id}" aria-controls="as-qs-panel-${id}" data-qs-tab="${id}">${label}</button>`;
  const content = `<div class="atlas-scribe as-quick">
      <input type="hidden" name="tab" value="${tab}">
      <div class="as-qs-tabs" role="tablist" aria-label="What to make">${tabButton("settlement", "Settlement")}${tabButton("battle", "Battle Map")}${tabButton("region", "Region")}</div>
      ${settlementTabHTML()}
      ${battleTabHTML()}
      ${regionTabHTML()}
      <div class="as-qs-two">
        <div class="form-group"><label for="as-qs-name">Name</label><input type="text" id="as-qs-name" name="name" placeholder="Made up if empty"></div>
        <div class="form-group"><label for="as-qs-seed">Seed</label><input type="number" id="as-qs-seed" name="seed" value="${seed}" min="1" step="1"></div>
      </div>
      <p class="hint">Everything it makes can be changed afterwards.</p>
    </div>`;
  const showTab = (root, which) => {
    root.querySelector('[name="tab"]').value = which;
    for (const el of root.querySelectorAll("section[data-tab]")) el.hidden = el.dataset.tab !== which;
    for (const b of root.querySelectorAll("[data-qs-tab]")) {
      const on = b.dataset.qsTab === which;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
      if (on) b.setAttribute("data-focus-home", "");
      else b.removeAttribute("data-focus-home");
    }
  };
  let battleTab = null, settlementTab = null; // (each tab's wiring: its flush reads a description still waiting to be read)
  const chosen = await Dialog().wait({
    window: { title: "AtlasScribe: Quick Start", icon: "fa-solid fa-wand-magic-sparkles" },
    position: { width: 580 },
    content,
    render: (event, dialog) => {
      const el = dialog.element ?? event?.target?.element;
      const root = el?.querySelector(".as-quick");
      if (!root) return;
      // (the tabs move with the arrow keys, and the dialog's buttons work from the keyboard)
      windowKeys(el);
      root.querySelectorAll("[data-qs-tab]").forEach((b) => b.addEventListener("click", () => { showTab(root, b.dataset.qsTab); onTab(b.dataset.qsTab); }));
      battleTab = wireBattleTab(root.querySelector(".as-qs-battle"));
      settlementTab = wireSettlementTab(root.querySelector(".as-qs-settlement"));
      wireRegionTab(root.querySelector(".as-qs-region"));
      showTab(root, tab);
    },
    buttons: [
      { action: "make", label: "Make the Plan", icon: "fa-solid fa-wand-magic-sparkles", default: true, callback: (event, button) => {
        const { name, seed: s } = button.form.elements;
        if (button.form.elements.tab.value === "region") {
          const el = button.form.elements;
          if (el["r-scale"].value === "local") return { region: { ...Object.fromEntries(Object.keys(REGION).map((k) => [k, el[`r-${k}`]?.value])), name: name.value, seed: Number(s.value) || seed } };
          const names = el["l-names"].value, set = names.startsWith("set:") ? names.slice(4) : null;
          return { land: { ...Object.fromEntries(Object.keys(LAND_QUICK).filter((k) => k !== "names").map((k) => [k, k === "scale" ? el["r-scale"].value : el[`l-${k}`]?.value])), names: set ? "english" : names, ...(set ? { nameSetId: set } : {}), name: name.value, seed: Number(s.value) || seed } };
        }
        if (button.form.elements.tab.value !== "battle") { settlementTab?.flush(); return { ...settlementTab?.options(), name: name.value, seed: s.value }; }
        battleTab?.flush();
        return { battle: briefFromForm(button.form, Number(button.form.elements.seed.value) || seed) };
      } },
      { action: "cancel", label: "Cancel" },
    ],
    rejectClose: false,
  });
  return chosen && chosen !== "cancel" ? chosen : null;
}

/**
 * The Region tab: a generated kingdom, realm, continent or world (the land made by AtlasScribe's generator, towns,
 * roads and names placed on it), or the classic local region of a few dozen miles.
 */
function regionTabHTML() {
  const select = (k, label) => `<div class="form-group"><label for="as-qr-${k}">${label}</label><select id="as-qr-${k}" name="r-${k}">${REGION[k].map((v) => `<option value="${v}">${esc(titleCase(REGION_LABELS[k][v]))}</option>`).join("")}</select></div>`;
  // (what a choice means, as a tooltip and for screen readers)
  const land = (k, label, tip = "") => `<div class="form-group" data-land="${k}"><label for="as-ql-${k}">${label}</label><select id="as-ql-${k}" name="l-${k}"${tip ? ` data-tooltip-text="${esc(tip)}" aria-describedby="as-ql-${k}-tip"` : ""}>${LAND_QUICK[k].map((v) => `<option value="${v}">${esc(titleCase(LAND_QUICK_LABELS[k][v]))}</option>`).join("")}</select>${tip ? `<span id="as-ql-${k}-tip" class="as-sr-only">${esc(tip)}</span>` : ""}</div>`;
  // (names: a style, or one of the world's name sets)
  const sets = storedNameSets();
  const namesTip = "How the names of places, rivers, ranges and seas sound: a style, or a name set of your own (Name Sets, in the Plan panel)";
  const names = `<div class="form-group"><label for="as-ql-names">Names</label><span id="as-ql-names-tip" class="as-sr-only">${namesTip}</span><select id="as-ql-names" name="l-names" data-tooltip-text="${namesTip}" aria-describedby="as-ql-names-tip">${LAND_QUICK.names.map((v) => `<option value="${v}">${esc(titleCase(LAND_QUICK_LABELS.names[v]))}</option>`).join("")}${sets.length ? `<optgroup label="Your Name Sets">${sets.map((x) => `<option value="set:${esc(x.id)}">${esc(x.name)}</option>`).join("")}</optgroup>` : ""}</select></div>`;
  const tips = {
    type: "The shape of the land and sea",
    seaSide: "Where the open sea lies, for a coast or a peninsula",
    towns: "How many towns, villages and castles are placed (Reroll Places in the Plan panel places them again)",
    size: "The picture's long side; a bigger map takes longer to draw",
    age: "Young land has sharp, high ranges; old land is worn down to hills",
    plates: "How many plates the land is built from: more makes more, shorter ranges",
    coast: "How broken the coastline is",
    wind: "Where the wind comes from: the far side of a range from it is drier",
    rivers: "How many rivers are drawn",
    climate: "How warm and wet the land is",
    hemisphere: "Which side of the equator the map lies on: which way it grows warmer, and which way the winds blow",
    span: "The latitudes the world covers: pole to pole squeezes the whole globe onto the map, ice at the top and bottom",
    lakes: "How many lakes: more shows smaller basins as lakes, and fewer of them dry to salt flats",
    plateaus: "High, flat land of hard rock behind the great ranges, its edges cut into canyons",
    volcanic: "Volcanoes along island arcs and coastal ranges, or a hotspot chain where there are none",
  };
  return `<section class="as-qs-region" data-tab="region" role="tabpanel" id="as-qs-panel-region" aria-labelledby="as-qs-tab-region" hidden>
      <div class="form-group"><label for="as-qr-scale">Scale</label><select id="as-qr-scale" name="r-scale">${[...LAND_QUICK.scale, "local"].map((v) => `<option value="${v}"${v === lastScale ? " selected" : ""}>${esc(titleCase(v === "local" ? "Local (40 to 80 mi, the classic region)" : LAND_QUICK_LABELS.scale[v]))}</option>`).join("")}</select></div>
      <div data-for="land">
        <p class="hint">Land, rivers and climate made by the generator, then towns, villages, castles, roads and names placed on it. Each town's own map can be made from it.</p>
        <div class="as-qs-two">${land("type", "Land", tips.type)}${land("seaSide", "Sea Side", tips.seaSide)}${land("climate", "Climate", tips.climate)}${land("hemisphere", "Hemisphere", tips.hemisphere)}${land("span", "Latitudes", tips.span)}${land("mountains", "Mountains")}${land("towns", "Towns", tips.towns)}${land("grid", "Grid")}${land("size", "Size", tips.size)}${names}${land("season", "Season")}</div>
        <details class="as-qs-more"><summary>More</summary><div class="as-qs-two">${LAND_MORE.map((k) => land(k, { age: "Age", plates: "Plates", coast: "Coast", wind: "Wind", rain: "Rain", rivers: "Rivers", lakes: "Lakes", plateaus: "Plateaus", volcanic: "Volcanic" }[k], tips[k])).join("")}</div></details>
      </div>
      <div data-for="local" hidden>
        <p class="hint">Towns, villages, castles and ruins with their roads, rivers, woods and mountains. Each place's own map is made from it.</p>
        <div class="as-qs-two">${select("size", "Size")}${select("coast", "Coast")}${select("mountains", "Mountains")}${select("woods", "Woods")}${select("places", "Places")}${select("season", "Season")}</div>
      </div>
    </section>`;
}

/** The Region tab's last Scale, kept for the session. */
let lastScale = LAND_QUICK.scale[0];

/** The Region tab's Scale shows the generated region's choices, or the classic local region's; a world, its latitudes. */
function wireRegionTab(root) {
  if (!root) return;
  const scale = root.querySelector('[name="r-scale"]');
  const show = () => {
    const local = scale.value === "local";
    lastScale = scale.value;
    root.querySelector('[data-for="land"]').hidden = local;
    root.querySelector('[data-for="local"]').hidden = !local;
    // (a world takes a span of latitudes in place of a climate and a hemisphere)
    const world = scale.value === "world";
    root.querySelector('[data-land="climate"]').hidden = world;
    root.querySelector('[data-land="hemisphere"]').hidden = world;
    root.querySelector('[data-land="span"]').hidden = !world;
  };
  scale.addEventListener("change", show);
  show();
}

/** Open: the saved plans in a list. plans: listPlans()'s; folder: where they are. Resolves to the plan picked, or null. */
export async function openDialog(plans, folder) {
  const twice = new Set(plans.map((p) => p.name).filter((n, i, all) => all.indexOf(n) !== i)); // names saved more than once show their file
  const rows = plans.map((p, i) => `<option value="${i}" ${p.error ? "disabled" : ""}>${esc(p.name)}${twice.has(p.name) ? ` [${esc(p.file)}]` : ""}${p.size ? ` (${esc(p.size[0])} by ${esc(p.size[1])}${p.season ? `, ${esc(p.season)}` : ""})` : ""}${p.error ? " (can't be read)" : ""}</option>`).join("");
  const pick = await Dialog().wait({
    window: { title: "AtlasScribe: Open a Plan", icon: "fa-solid fa-folder-open" },
    content: `<div class="atlas-scribe"><div class="form-group"><select name="plan" aria-label="Saved Plans" size="${Math.min(12, Math.max(4, plans.length))}" style="width:100%">${rows}</select></div><p class="hint">Plans saved in ${esc(folder)}.</p></div>`,
    buttons: [
      { action: "open", label: "Open", icon: "fa-solid fa-folder-open", default: true, callback: (event, button) => button.form.elements.plan.value },
      { action: "cancel", label: "Cancel" },
    ],
    rejectClose: false,
  });
  if (pick === null || pick === undefined || pick === "cancel" || pick === "") return null; // closed, or nothing picked
  return plans[Number(pick)] ?? null;
}

/** Import: a plan pasted or from a file. Resolves to its text, or null. */
export async function importDialog() {
  const text = await Dialog().wait({
    window: { title: "AtlasScribe: Import a Plan", icon: "fa-solid fa-file-import" },
    content: `<div class="atlas-scribe as-import">
        <div class="form-group stacked"><label for="as-import-text">Paste a Plan</label><textarea id="as-import-text" name="text" rows="10" aria-describedby="as-import-hint"></textarea><p class="hint" id="as-import-hint">A plan's JSON, text with a mapplan block, a watabou export or a Universal VTT file.</p></div>
        <div class="form-group"><label for="as-import-file">Or a File</label><input type="file" id="as-import-file" name="file" accept=".json,.md,.txt,.dd2vtt,.uvtt,.df2vtt"></div>
      </div>`,
    buttons: [
      { action: "import", label: "Import", icon: "fa-solid fa-file-import", default: true, callback: async (event, button) => {
        const f = button.form.elements.file.files?.[0];
        return f ? f.text() : button.form.elements.text.value;
      } },
      { action: "cancel", label: "Cancel" },
    ],
    rejectClose: false,
  });
  return text && text !== "cancel" ? text : null;
}

/** Whether to save over another plan's file. */
export function confirmSaveOver(file) {
  return Dialog().confirm({ window: { title: "AtlasScribe: Save Over a Plan" }, content: `<p>A plan is already saved as ${esc(file)}. Save this one over it?</p>`, rejectClose: false });
}

/** Whether to drop a plan's unsaved changes. */
export function confirmDrop(name) {
  return Dialog().confirm({ window: { title: "AtlasScribe: Unsaved Changes" }, content: `<p>${esc(name)} has changes that aren't saved. Drop them?</p>`, rejectClose: false });
}

/** Whether to bring back a plan's unsaved changes, kept from before a reload or a crash. at: when they were made (ms). */
export function confirmDraft(name, at) {
  const when = new Date(at).toLocaleString();
  return Dialog().confirm({
    window: { title: "AtlasScribe: Unsaved Changes" },
    content: `<p>${esc(name)} had changes that weren't saved (${esc(when)}). Bring them back?</p>`,
    yes: { label: "Bring Them Back" },
    no: { label: "Drop Them" },
    rejectClose: false,
  });
}

/** The "as built" summary in a box to read and copy (text: Markdown). */
export function summaryDialog(text) {
  return Dialog().wait({
    window: { title: "AtlasScribe: Summary", icon: "fa-solid fa-list-ul" },
    position: { width: 560 },
    content: `<div class="atlas-scribe as-summary"><div class="form-group stacked"><label for="as-summary-text">What the Map Holds (Markdown)</label><textarea id="as-summary-text" name="text" rows="18" readonly>${esc(text)}</textarea></div></div>`,
    buttons: [
      { action: "copy", label: "Copy", icon: "fa-solid fa-copy", default: true, callback: async () => { await game.clipboard.copyPlainText(text); note.info("AtlasScribe: summary copied"); return "copy"; } },
      { action: "close", label: "Close" },
    ],
    rejectClose: false,
  });
}
