/**
 * Name sets: a world's library of a GM's own naming rules for overland maps (core/land/namesets.mjs reads them), and
 * the window to write them in. Each set is plain text; the window checks it as it's typed and shows names it makes.
 * Using a set on a map copies it into the map's plan, so a map's names never change when the library does.
 */
import { parseNameSet, sampleNames, describeSet } from "../core/land/namesets.mjs";
import { namer } from "../core/land/names.mjs";
import { MOD, esc, note } from "./util.mjs";
import { rememberWindow } from "../kit/window-memory.mjs";
import { keyboardWindow } from "../kit/keyboard.mjs";
import { singleWindow } from "../kit/single-window.mjs";

/** The library as saved: [{ id, name, text }]. */
export function storedNameSets() {
  try {
    const list = JSON.parse(game.settings.get(MOD, "nameSets") || "[]");
    return Array.isArray(list) ? list.filter((s) => s && typeof s.id === "string" && typeof s.text === "string").map((s) => ({ id: s.id, name: typeof s.name === "string" && s.name.trim() ? s.name.trim() : "Name Set", text: s.text })) : [];
  } catch { return []; }
}

/** Saves the library. */
export async function saveNameSets(list) {
  await game.settings.set(MOD, "nameSets", JSON.stringify(list.map((s) => ({ id: s.id, name: s.name, text: s.text }))));
}

/** The name a set's text gives itself (its name: line), else the fallback. */
export const setNameOf = (text, fallback = "Name Set") => parseNameSet(text).set?.name ?? fallback;

/** A new set's text: every part shown, with a line saying what it's for. */
export const NEW_SET = `name: New Name Set
# The sound of its names: spelled out here, or leave sounds out and list 30 or more examples
sounds:
  onsets: b d g k l m n r s t v br dr gr st
  vowels: a a e i o u
  codas: n r l s nd rn
  syllables: 1-3
# examples: Name, Name, Name
# Word parts that mean something, used where the land shows it: a suffix (-ford), a prefix (inver-) or a
# pattern ({name} the made word, {river} the river's name). river mouth, confluence, ford, bridge, coast, lake,
# pass, river, mountains, hills, forest, marsh, plain; or a kind of feature: sea, bay, lake, river, cape, delta, island...
# "place lake:" or "feature lake:" says which a word like lake means; without it, it's both
elements:
  coast: -port
# A pattern for each kind of place or feature ({name} where the name goes; | between choices)
kinds:
  castle: {name} Castle
  sea: the {name} Sea
# Names to use as they are, before any are made: places, features, or a kind (city, river...)
names:
  places:
# What a made name mustn't have: letters, parts, starts (its first letters), names (whole names)
avoid:
  letters:
# Inns: common (plain names a traveler can read) or local
inns: common
`;

const Base = keyboardWindow(rememberWindow(foundry.applications.api.ApplicationV2, { module: MOD, name: "name-sets" }), { module: MOD, scope: "name-sets", ownKeys: true });

let useHere = null;
/** A set being edited when the window closed unsaved: brought back when it opens again (until a reload). */
let keptEdit = null;
/** How "Use on This Map" reaches the AtlasScribe window: fn({ name, text, from }) => true when used. */
export function setUseHere(fn) { useHere = fn; }

export class NameSetsWindow extends Base {
  static DEFAULT_OPTIONS = {
    id: "atlas-scribe-name-sets",
    classes: ["atlas-scribe", "as-names"],
    tag: "div",
    window: { title: "AtlasScribe: Name Sets", icon: "fa-solid fa-signature", resizable: true },
    position: { width: 760, height: 640 },
    actions: {
      asNsPick: NameSetsWindow.#onPick,
      asNsNew: NameSetsWindow.#onNew,
      asNsSave: NameSetsWindow.#onSave,
      asNsDelete: NameSetsWindow.#onDelete,
      asNsUse: NameSetsWindow.#onUse,
      asNsMore: NameSetsWindow.#onMore,
    },
  };

  /** The set being edited: { id (null for a new one), text }; and the library as last read. */
  #edit = null;
  #sets = [];
  #seed = 1;
  #timer = null;

  get dirty() {
    if (!this.#edit) return false;
    const saved = this.#sets.find((s) => s.id === this.#edit.id);
    return !saved ? this.#edit.text !== NEW_SET : saved.text !== this.#edit.text;
  }

  async _prepareContext() {
    this.#sets = storedNameSets();
    if (!this.#edit && keptEdit) { this.#edit = keptEdit; keptEdit = null; }
    // (the set being edited was deleted meanwhile, by another GM: its text stays, as a new set not yet saved)
    if (this.#edit?.id && !this.#sets.some((s) => s.id === this.#edit.id)) this.#edit = { id: null, text: this.#edit.text };
    if (!this.#edit) this.#edit = this.#sets.length ? { id: this.#sets[0].id, text: this.#sets[0].text } : { id: null, text: NEW_SET };
    return {};
  }

  /** Closing with changes not saved keeps them for this session (they come back when the window opens again) and says so. */
  async close(options = {}) {
    if (this.dirty && !options.discard) {
      keptEdit = { ...this.#edit };
      note.info(`AtlasScribe: your changes to ${setNameOf(this.#edit.text)} aren't saved. They're kept until you reload: open Name Sets again to save them.`);
    }
    clearTimeout(this.#timer);
    return super.close(options);
  }

  async _renderHTML() {
    const list = this.#sets.map((s) => `<li><button type="button" data-action="asNsPick" data-id="${esc(s.id)}" class="${s.id === this.#edit.id ? "active" : ""}" aria-pressed="${s.id === this.#edit.id}">${esc(s.name)}</button></li>`).join("");
    const isNew = this.#edit.id === null;
    return `<div class="as-ns">
      <nav class="as-ns-list" aria-label="Name Sets">
        <ul>${list || `<li class="as-ns-empty">None Yet</li>`}${isNew ? `<li><button type="button" class="active" aria-pressed="true">${esc(setNameOf(this.#edit.text, "New Name Set"))} <em>(Not Saved)</em></button></li>` : ""}</ul>
        <button type="button" data-action="asNsNew"><i class="fa-solid fa-plus" aria-hidden="true"></i> New</button>
      </nav>
      <section class="as-ns-edit">
        <label for="as-ns-text" class="as-ns-label">The Set's Rules</label>
        <textarea id="as-ns-text" class="as-ns-text" spellcheck="false" data-focus-home>${esc(this.#edit.text)}</textarea>
        <div class="as-ns-buttons">
          <button type="button" data-action="asNsSave"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save</button>
          <button type="button" data-action="asNsUse" data-tooltip-text="Copy it into the plan open in AtlasScribe; that map's names follow it from then on (the library can change; the map keeps its copy)"><i class="fa-solid fa-map" aria-hidden="true"></i> Use on This Map</button>
          ${isNew ? "" : `<button type="button" data-action="asNsDelete" class="as-danger"><i class="fa-solid fa-trash" aria-hidden="true"></i> Delete</button>`}
        </div>
        <div class="as-ns-check" aria-live="polite">${this.#checkHTML()}</div>
      </section>
    </div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    const box = content.querySelector(".as-ns-text");
    box?.addEventListener("input", () => {
      this.#edit.text = box.value;
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => { const c = this.element?.querySelector(".as-ns-check"); if (c) c.innerHTML = this.#checkHTML(); }, 350);
    });
  }

  /** What the set says when read: its problems, and names it makes (another handful on More). */
  #checkHTML() {
    const { set, problems } = parseNameSet(this.#edit.text);
    const probs = problems.length ? `<ul class="as-ns-problems">${problems.map((p) => `<li class="as-${p.level}">${p.line ? `Line ${p.line}: ` : ""}${esc(p.message)}</li>`).join("")}</ul>` : `<p class="as-ns-ok"><i class="fa-solid fa-check" aria-hidden="true"></i> Reads cleanly: ${esc(describeSet(set))}.</p>`;
    if (!set || problems.some((p) => p.level === "error")) return probs;
    let names = null;
    try { names = sampleNames(set, namer, this.#seed); } catch (e) { return `${probs}<p class="as-error">It couldn't make names: ${esc(e.message)}</p>`; }
    return `${probs}<div class="as-ns-samples"><p><strong>Places</strong> ${names.places.map(esc).join(", ")}</p><p><strong>Features</strong> ${names.features.map(esc).join(", ")}</p>
      <button type="button" data-action="asNsMore"><i class="fa-solid fa-dice" aria-hidden="true"></i> More</button></div>`;
  }

  /** Asks before a pick or a new set drops unsaved changes. */
  async #mayLeave() {
    if (!this.dirty) return true;
    return foundry.applications.api.DialogV2.confirm({ window: { title: "AtlasScribe: Unsaved Name Set" }, content: `<p>${esc(setNameOf(this.#edit.text))} has changes that aren't saved. Drop them?</p>`, rejectClose: false });
  }

  static async #onPick(event, target) {
    if (target.dataset.id === this.#edit?.id || !(await this.#mayLeave())) return;
    const s = this.#sets.find((q) => q.id === target.dataset.id);
    if (s) { this.#edit = { id: s.id, text: s.text }; this.render(); }
  }

  static async #onNew() {
    if (!(await this.#mayLeave())) return;
    this.#edit = { id: null, text: NEW_SET };
    this.render();
  }

  static async #onSave() {
    const { set, problems } = parseNameSet(this.#edit.text);
    if (!set) return note.warn(`AtlasScribe: the name set can't be saved yet: ${problems.find((p) => p.level === "error")?.message ?? "it makes no names"}`);
    const list = storedNameSets();
    const id = this.#edit.id ?? foundry.utils.randomID();
    const item = { id, name: set.name ?? "Name Set", text: this.#edit.text };
    const k = list.findIndex((s) => s.id === id);
    if (k >= 0) list[k] = item; else list.push(item);
    await saveNameSets(list);
    this.#edit = { id, text: item.text };
    note.info(`AtlasScribe: saved the name set ${item.name}.`);
    this.render();
  }

  static async #onDelete() {
    const s = this.#sets.find((q) => q.id === this.#edit.id);
    if (!s) return;
    const yes = await foundry.applications.api.DialogV2.confirm({ window: { title: "AtlasScribe: Delete a Name Set" }, content: `<p>Delete ${esc(s.name)} from the library? Maps that use it keep their own copy.</p>`, rejectClose: false });
    if (!yes) return;
    await saveNameSets(storedNameSets().filter((q) => q.id !== s.id));
    this.#edit = null;
    this.render();
  }

  static async #onUse() {
    const { set, problems } = parseNameSet(this.#edit.text);
    const bad = problems.find((p) => p.level === "error");
    if (!set || bad) return note.warn(`AtlasScribe: this name set can't name a map yet: ${bad?.message ?? "it makes no names"}`);
    if (!useHere) return note.warn("AtlasScribe: open an overland map in AtlasScribe first.");
    // (the map's copy is the library's only when it's the text saved there; changes not saved make a copy of its own)
    const saved = this.#sets.find((s) => s.id === this.#edit.id), same = !!saved && saved.text === this.#edit.text;
    const done = await useHere({ name: set.name ?? "Name Set", text: this.#edit.text, from: same ? saved.id : null });
    if (done) note.info(`AtlasScribe: the map now uses ${set.name ?? "this name set"}.${same ? "" : " Save it to keep it in the library too."}`);
  }

  static #onMore() {
    this.#seed++;
    const c = this.element?.querySelector(".as-ns-check");
    if (c) c.innerHTML = this.#checkHTML();
  }
}

/** The Name Sets window, one at a time. */
export const nameSetsWindow = singleWindow(() => new NameSetsWindow());

/** Draws the Name Sets window again when the library changes (another GM saved or deleted a set). */
export function refreshNameSets() {
  const w = foundry.applications.instances.get("atlas-scribe-name-sets");
  if (w?.rendered) w.render();
}
