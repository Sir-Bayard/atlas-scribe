/**
 * The AtlasScribe window's dialogs for a plan's file: Quick Start, Open, Import, and the questions asked before
 * writing over a plan, dropping unsaved changes or bringing back a draft. Each resolves to what was chosen (null when
 * the dialog was closed or canceled); the window does the rest.
 */
import { battleTabHTML, wireBattleTab, briefFromForm } from "./quick-battle.mjs";
import { settlementTabHTML, wireSettlementTab } from "./quick-settlement.mjs";
import { windowKeys } from "../kit/keyboard.mjs";
import { REGION, REGION_LABELS } from "../core/quick-region.mjs";
import { esc, note } from "./util.mjs";

const Dialog = () => foundry.applications.api.DialogV2;

/**
 * Quick Start: three tabs, a settlement, a battle map or a region, each described in words or chosen, and a name and seed for
 * both. tab: the tab shown first; seed: the seed offered; onTab(tab) when the GM switches. Resolves to the settlement's
 * options ({ ..., name, seed }), or { battle: brief }, or { region: options }, or null.
 */
export async function quickDialog({ tab = "settlement", seed, onTab = () => {} }) {
  const tabButton = (id, label) => `<button type="button" role="tab" id="as-qs-tab-${id}" aria-controls="as-qs-panel-${id}" data-qs-tab="${id}">${label}</button>`;
  const content = `<div class="atlas-scribe as-quick">
      <input type="hidden" name="tab" value="${tab}">
      <div class="as-qs-tabs" role="tablist" aria-label="What to make">${tabButton("settlement", "Settlement")}${tabButton("battle", "Battle map")}${tabButton("region", "Region")}</div>
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
      showTab(root, tab);
    },
    buttons: [
      { action: "make", label: "Make the plan", icon: "fa-solid fa-wand-magic-sparkles", default: true, callback: (event, button) => {
        const { name, seed: s } = button.form.elements;
        if (button.form.elements.tab.value === "region") return { region: { ...Object.fromEntries(Object.keys(REGION).map((k) => [k, button.form.elements[`r-${k}`]?.value])), name: name.value, seed: Number(s.value) || seed } };
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

/** The Region tab: a stretch of country many miles across, with its places, roads, rivers and high ground. */
function regionTabHTML() {
  const select = (k, label) => `<div class="form-group"><label for="as-qr-${k}">${label}</label><select id="as-qr-${k}" name="r-${k}">${REGION[k].map((v) => `<option value="${v}">${esc(REGION_LABELS[k][v])}</option>`).join("")}</select></div>`;
  return `<section class="as-qs-region" data-tab="region" role="tabpanel" id="as-qs-panel-region" aria-labelledby="as-qs-tab-region" hidden>
      <p class="hint">Towns, villages, castles and ruins with their roads, rivers, woods and mountains. Each place's own map is made from it.</p>
      <div class="as-qs-two">${select("size", "Size")}${select("coast", "Coast")}${select("mountains", "Mountains")}${select("woods", "Woods")}${select("places", "Places")}${select("season", "Season")}</div>
    </section>`;
}

/** Open: the saved plans in a list. plans: listPlans()'s; folder: where they are. Resolves to the plan picked, or null. */
export async function openDialog(plans, folder) {
  const twice = new Set(plans.map((p) => p.name).filter((n, i, all) => all.indexOf(n) !== i)); // names saved more than once show their file
  const rows = plans.map((p, i) => `<option value="${i}" ${p.error ? "disabled" : ""}>${esc(p.name)}${twice.has(p.name) ? ` [${esc(p.file)}]` : ""}${p.size ? ` (${esc(p.size[0])} by ${esc(p.size[1])}${p.season ? `, ${esc(p.season)}` : ""})` : ""}${p.error ? " (can't be read)" : ""}</option>`).join("");
  const pick = await Dialog().wait({
    window: { title: "AtlasScribe: Open a plan", icon: "fa-solid fa-folder-open" },
    content: `<div class="atlas-scribe"><div class="form-group"><select name="plan" aria-label="Saved plans" size="${Math.min(12, Math.max(4, plans.length))}" style="width:100%">${rows}</select></div><p class="hint">Plans saved in ${esc(folder)}.</p></div>`,
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
    window: { title: "AtlasScribe: Import a plan", icon: "fa-solid fa-file-import" },
    content: `<div class="atlas-scribe as-import">
        <div class="form-group stacked"><label for="as-import-text">Paste a plan (JSON, or text with a mapplan block), a watabou export or a Universal VTT file</label><textarea id="as-import-text" name="text" rows="10"></textarea></div>
        <div class="form-group"><label for="as-import-file">Or a file</label><input type="file" id="as-import-file" name="file" accept=".json,.md,.txt,.dd2vtt,.uvtt,.df2vtt"></div>
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
  return Dialog().confirm({ window: { title: "Save over a plan" }, content: `<p>A plan is already saved as ${esc(file)}. Save this one over it?</p>`, rejectClose: false });
}

/** Whether to drop a plan's unsaved changes. */
export function confirmDrop(name) {
  return Dialog().confirm({ window: { title: "Unsaved changes" }, content: `<p>${esc(name)} has changes that aren't saved. Drop them?</p>`, rejectClose: false });
}

/** Whether to bring back a plan's unsaved changes, kept from before a reload or a crash. at: when they were made (ms). */
export function confirmDraft(name, at) {
  const when = new Date(at).toLocaleString();
  return Dialog().confirm({
    window: { title: "AtlasScribe: unsaved changes" },
    content: `<p>${esc(name)} had changes that weren't saved (${esc(when)}). Bring them back?</p>`,
    yes: { label: "Bring them back" },
    no: { label: "Drop them" },
    rejectClose: false,
  });
}

/** The "as built" summary in a box to read and copy (text: Markdown). */
export function summaryDialog(text) {
  return Dialog().wait({
    window: { title: "AtlasScribe: summary", icon: "fa-solid fa-list-ul" },
    position: { width: 560 },
    content: `<div class="atlas-scribe as-summary"><div class="form-group stacked"><label for="as-summary-text">What the map holds, in Markdown</label><textarea id="as-summary-text" name="text" rows="18" readonly>${esc(text)}</textarea></div></div>`,
    buttons: [
      { action: "copy", label: "Copy", icon: "fa-solid fa-copy", default: true, callback: async () => { await game.clipboard.copyPlainText(text); note.info("AtlasScribe: summary copied"); return "copy"; } },
      { action: "close", label: "Close" },
    ],
    rejectClose: false,
  });
}
