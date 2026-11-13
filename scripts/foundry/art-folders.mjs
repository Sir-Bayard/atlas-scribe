/**
 * The Art folders settings window: the folders AtlasScribe looks in for art, each with what was found in it.
 */
import { foldersToUse, folderOf, folderKey, storedFolders, folderIndex, nexusFolder, forget } from "./art/folders.mjs";

const MOD = "atlas-scribe";
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const FP = () => foundry.applications.apps.FilePicker.implementation;

export class ArtFoldersMenu extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "atlas-scribe-art-folders",
    classes: ["atlas-scribe", "as-art-folders"],
    tag: "form",
    window: { title: "AtlasScribe: Art folders", icon: "fa-solid fa-folder-tree", resizable: true },
    position: { width: 560, height: "auto" },
    form: { handler: ArtFoldersMenu.#onSave, closeOnSubmit: false },
    actions: {
      asAdd: ArtFoldersMenu.#onAdd,
      asBrowse: ArtFoldersMenu.#onBrowse,
      asRemove: ArtFoldersMenu.#onRemove,
      asDefault: ArtFoldersMenu.#onDefault,
    },
  };

  /** The list being edited, null until it's loaded. */
  #folders = null;
  /** What the last read found, by folder key. */
  #found = new Map();
  #reading = false;
  /** The default list as JSON, when Default was chosen: saved as "not set" if unchanged, so it follows FA Nexus's folder. */
  #default = null;

  async _prepareContext() {
    if (!this.#folders) {
      this.#folders = (await foldersToUse()).map((f) => ({ ...f }));
      if (!storedFolders()) this.#default = JSON.stringify(this.#folders.map(folderOf));
      this.#read();
    }
    return {};
  }

  /** Reads the folders (from the session's cache when it has them) and shows what was found. */
  async #read() {
    this.#reading = true;
    try {
      const idx = await folderIndex();
      this.#found = new Map(idx.folders.map((r) => [folderKey(r.folder), r]));
    } catch (e) {
      ui.notifications.error(`AtlasScribe: the art folders couldn't be read (${e.message})`);
    } finally {
      this.#reading = false;
      if (this.rendered) this.render();
    }
  }

  async _renderHTML() {
    const rows = this.#folders.map((f, i) => {
      const r = this.#found.get(folderKey(f));
      const bad = [r?.error, ...(r?.errors ?? [])].filter(Boolean);
      const info = !r ? "" : [
        r.error ? "" : `${r.files.toLocaleString()} images${r.manifests ? `, ${r.manifests} manifest${r.manifests > 1 ? "s" : ""}` : ""}${r.cut ? ", read in part" : ""}`,
        ...bad.slice(0, 3).map((e) => `<span class="as-bad">${esc(e)}</span>`),
        bad.length > 3 ? `<span class="as-bad">and ${bad.length - 3} more</span>` : "",
      ].filter(Boolean).join("<br>");
      return `<li data-i="${i}">
          <div class="as-af-row">
            <span class="as-af-source">${esc(f.source === "data" ? "Data" : f.source)}</span>
            <input type="text" name="path-${i}" value="${esc(f.path)}" placeholder="folder">
            <button type="button" data-action="asBrowse" data-i="${i}" data-tooltip="Browse"><i class="fa-solid fa-folder-open"></i></button>
            <button type="button" data-action="asRemove" data-i="${i}" data-tooltip="Remove"><i class="fa-solid fa-trash"></i></button>
          </div>
          ${info ? `<div class="as-af-info">${info}</div>` : ""}
        </li>`;
    }).join("");
    const html = `
      <ol class="as-af-list">${rows || `<li class="as-af-none">No folders.</li>`}</ol>
      <div class="as-af-buttons">
        <button type="button" data-action="asAdd"><i class="fa-solid fa-plus"></i> Add a folder</button>
        <button type="button" data-action="asDefault">Default</button>
        <button type="submit" ${this.#reading ? "disabled" : ""}><i class="fa-solid fa-floppy-disk"></i> ${this.#reading ? "Reading..." : "Save and read"}</button>
      </div>`;
    return html;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  /** Paths typed into the list are kept before the list changes. */
  #takeTyped() {
    for (const [i, f] of this.#folders.entries()) {
      const input = this.element?.querySelector(`[name="path-${i}"]`);
      if (input) f.path = input.value;
    }
  }

  static #onAdd() {
    this.#takeTyped();
    this.#folders.push({ source: "data", path: "" });
    this.render();
  }

  static #onRemove(event, target) {
    this.#takeTyped();
    this.#folders.splice(Number(target.dataset.i), 1);
    this.render();
  }

  static async #onDefault() {
    this.#takeTyped();
    let list = [];
    try {
      const nexus = nexusFolder();
      await FP().browse(nexus.source, nexus.path);
      list = [nexus];
    } catch {
      /* no FA Nexus folder */
    }
    this.#folders = list;
    this.#default = JSON.stringify(list.map(folderOf));
    this.render();
  }

  static #onBrowse(event, target) {
    this.#takeTyped();
    const i = Number(target.dataset.i);
    const f = this.#folders[i];
    const picker = new (FP())({
      type: "folder",
      current: f.path,
      activeSource: f.source,
      callback: (path, fp) => {
        const source = fp?.activeSource ?? "data";
        this.#folders[i] = folderOf({ source, path, bucket: source === "s3" ? fp?.sources?.s3?.bucket : undefined });
        this.render();
      },
    });
    picker.render(true);
  }

  static async #onSave() {
    if (this.#reading) return;
    this.#takeTyped();
    const seen = new Set();
    const list = this.#folders.map(folderOf).filter((f) => {
      const k = folderKey(f);
      if ((!f.path && f.source === "data") || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const unchanged = this.#default !== null && this.#default === JSON.stringify(list);
    await game.settings.set(MOD, "artFolders", unchanged ? "" : JSON.stringify(list));
    this.#folders = list;
    forget();
    this.#reading = true;
    this.render();
    await this.#read();
  }
}
