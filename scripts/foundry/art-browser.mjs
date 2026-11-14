/**
 * The Art Browser: where AtlasScribe's art comes from. Folders: the folders it looks in. Art: every kind of art (role)
 * with what it would be painted with and from where, and art chosen by hand for a role or all its kinds. Rules:
 * filename rules that give a role every image whose name matches.
 */
import { foldersToUse, folderOf, folderKey, storedFolders, storedRoles, storedRules, folderIndex, nexusFolder, forget, forgetChoices, gridPxOf } from "./art/folders.mjs";
import { describeArt, forgetArt } from "./art/index.mjs";
import { faRoleMap } from "./art/fa-nexus.mjs";

const MOD = "atlas-scribe";
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const FP = () => foundry.applications.apps.FilePicker.implementation;

/** A role's group, by its first part. */
const GROUPS = {
  ground: "Ground", surface: "Paths and paving", overlay: "Overlays", water: "Water", stone: "Stone", roof: "Roofs", tree: "Trees",
  bush: "Bushes", chimney: "Chimneys", prop: "Props", cliff: "Cliffs", smoke: "Smoke", floor: "Floors", wood: "Wood", wall: "Walls",
  window: "Windows", fence: "Fences", shore: "Shores", dock: "Docks", field: "Fields", furn: "Furniture", edge: "Banks and edges",
  shadow: "Shadows", fog: "Mist", strip: "Strips",
};
const groupOf = (role) => role.split(".")[0];
const groupLabel = (g) => GROUPS[g] ?? g.charAt(0).toUpperCase() + g.slice(1);
/** A role's name in words: "roof.slate.winter" is "Slate, winter". */
export function roleLabel(role) {
  const rest = role.split(".").slice(1).map((p) => p.replace(/-/g, " "));
  const s = rest.length ? rest.join(", ") : role;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/** Whether every battle map is drawn (the world setting), whatever art there is. */
const drawAll = () => { try { return !!game.settings.get(MOD, "drawnAll"); } catch { return false; } };
const SOURCES = { hand: "By hand", rule: "Rule", manifest: "Manifest", folder: "Folder", nexus: "FA Nexus", none: "None" };

export class ArtBrowser extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "atlas-scribe-art",
    classes: ["atlas-scribe", "as-art"],
    tag: "div",
    window: { title: "AtlasScribe: Art", icon: "fa-solid fa-images", resizable: true },
    position: { width: 640, height: 720 },
    actions: {
      asTab: ArtBrowser.#onTab,
      asAdd: ArtBrowser.#onAdd,
      asBrowse: ArtBrowser.#onBrowse,
      asRemove: ArtBrowser.#onRemove,
      asDefault: ArtBrowser.#onDefault,
      asSaveFolders: ArtBrowser.#onSaveFolders,
      asPickFiles: ArtBrowser.#onPickFiles,
      asPickFolder: ArtBrowser.#onPickFolder,
      asAllKinds: ArtBrowser.#onAllKinds,
      asClear: ArtBrowser.#onClear,
      asDrop: ArtBrowser.#onDrop,
      asAddRule: ArtBrowser.#onAddRule,
      asRemoveRule: ArtBrowser.#onRemoveRule,
      asSaveRules: ArtBrowser.#onSaveRules,
      asReread: ArtBrowser.#onReread,
    },
  };

  #tab = "art";
  /** The folder list being edited, null until it's loaded. */
  #folders = null;
  /** The default list as JSON, when Default was chosen: saved as "not set" if unchanged, so it follows FA Nexus's folder. */
  #default = null;
  /** The rules being edited, null until loaded. */
  #rules = null;
  #idx = null;
  #rows = [];
  #reading = false;
  /** A button to give focus back to once it's enabled again (Save and read, Read the folders again: disabled while reading). */
  #refocus = null;
  #filter = { show: "all", text: "" };
  /** Groups opened in the Art tab, kept across redraws. */
  #open = new Set();
  /** Counts reads, so only the latest one's results are shown. */
  #readCount = 0;
  /** The hooks that hear another GM change the art settings. */
  #hook = null;

  async _prepareContext() {
    if (!this.#folders) {
      this.#loadEdits();
      this.#read();
      // (a setting's first save creates it, later ones update it)
      const heard = (setting, change, options, userId) => {
        if (userId === game.user.id || !/^atlas-scribe\.art(Folders|Roles|Rules)$/.test(setting.key ?? "")) return;
        this.#loadEdits();
        this.#read();
      };
      this.#hook ??= [Hooks.on("updateSetting", heard), Hooks.on("createSetting", heard)];
    }
    return {};
  }

  async close(options) {
    if (this.#hook) { Hooks.off("updateSetting", this.#hook[0]); Hooks.off("createSetting", this.#hook[1]); this.#hook = null; }
    return super.close(options);
  }

  /** The folder list and rules being edited, from the settings. */
  #loadEdits() {
    foldersToUse().then((list) => {
      this.#folders = list.map((f) => ({ ...f }));
      this.#default = storedFolders() ? null : JSON.stringify(this.#folders.map(folderOf));
      if (this.rendered) this.render();
    });
    this.#folders ??= [];
    this.#rules = storedRules().map((r) => ({ pattern: r.pattern, role: r.role, px: r.px ?? "" }));
  }

  /** Reads the folders (from the session's cache when it has them), then what every role would be painted with. */
  async #read() {
    const n = ++this.#readCount;
    this.#reading = true;
    if (this.rendered) this.render();
    try {
      const idx = await folderIndex();
      const map = await faRoleMap();
      const roles = [...new Set([...Object.keys(map), ...idx.roles.keys(), ...idx.rules.keys(), ...idx.hand.keys(), ...Object.keys(storedRoles())])].sort();
      const rows = await describeArt(roles);
      if (n !== this.#readCount) return;
      this.#idx = idx;
      this.#rows = rows;
    } catch (e) {
      if (n === this.#readCount) ui.notifications.error(`AtlasScribe: the art couldn't be read (${e.message})`);
    } finally {
      if (n === this.#readCount) {
        this.#reading = false;
        if (this.rendered) this.render();
      }
    }
  }

  async _renderHTML() {
    const tab = (id, label) => `<button type="button" role="tab" aria-selected="${this.#tab === id}" class="${this.#tab === id ? "active" : ""}" data-action="asTab" data-tab="${id}">${label}</button>`;
    const body = this.#tab === "folders" ? this.#foldersHTML() : this.#tab === "rules" ? this.#rulesHTML() : this.#artHTML();
    return `<nav class="as-art-tabs" role="tablist">${tab("folders", "Folders")}${tab("art", "Art")}${tab("rules", "Rules")}
        <button type="button" class="as-art-reread" data-action="asReread" ${this.#reading ? "disabled" : ""} data-tooltip="Read the folders again" aria-label="Read the folders again"><i class="fa-solid fa-rotate${this.#reading ? " fa-spin" : ""}"></i></button></nav>
      <section class="as-art-body">${body}</section>`;
  }

  _replaceHTML(result, content) {
    const scroll = content.querySelector(".as-art-body")?.scrollTop ?? 0;
    const focus = document.activeElement && content.contains(document.activeElement) ? document.activeElement : null;
    // (a button by its action and data, so focus comes back to it, or to its row's next one, after the redraw)
    const button = focus?.dataset?.action ? `[data-action="${focus.dataset.action}"]${Object.entries(focus.dataset).filter(([k]) => k !== "action" && k !== "tooltip").map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${CSS.escape(v)}"]`).join("")}` : null;
    // (a button waiting to be enabled again wins while focus is where it was left: nowhere, or on the active tab)
    const lost = !focus && (!document.activeElement || document.activeElement === document.body);
    const waiting = this.#refocus && (lost || focus?.getAttribute("role") === "tab") ? this.#refocus : null;
    const focusKey = focus?.name || (focus?.classList?.contains("as-art-search") ? ".as-art-search" : focus?.classList?.contains("as-art-show") ? ".as-art-show" : null);
    const caret = focus?.selectionStart ?? null;
    content.innerHTML = result;
    const body = content.querySelector(".as-art-body");
    if (body) body.scrollTop = scroll;
    if (focusKey) {
      const el = focusKey.startsWith(".") ? content.querySelector(focusKey) : content.querySelector(`[name="${focusKey}"]`);
      el?.focus();
      if (caret !== null) try { el?.setSelectionRange(caret, caret); } catch { /* not a text box */ }
    } else if (waiting || button) {
      // (a button gone with its row: the active tab, so focus isn't lost; one disabled for now gets it back once it's
      // enabled)
      const want = waiting ?? button;
      const el = content.querySelector(want);
      this.#refocus = el?.disabled ? want : null;
      (el && !el.disabled ? el : content.querySelector('[role="tab"][aria-selected="true"]'))?.focus();
    }
    content.querySelector(".as-art-search")?.addEventListener("input", (ev) => {
      this.#filter.text = ev.target.value;
      this.#applyFilter();
    });
    content.querySelector(".as-art-show")?.addEventListener("change", (ev) => {
      this.#filter.show = ev.target.value;
      this.render();
    });
    // (each box writes into the list being edited as it's typed in, so a redraw keeps it)
    for (const input of content.querySelectorAll("[name^='path-'], [name^='pattern-'], [name^='role-'], [name^='px-']")) {
      input.addEventListener("input", () => {
        const [, field, i] = input.name.match(/^(\w+)-(\d+)$/) ?? [];
        const row = field === "path" ? this.#folders[Number(i)] : this.#rules[Number(i)];
        if (row) row[field] = input.value;
      });
    }
    for (const input of content.querySelectorAll(".as-art-px")) {
      input.addEventListener("change", async () => {
        const cur = storedRoles()[input.dataset.role];
        if (!cur) return;
        const px = Number(input.value) > 0 ? gridPxOf(input.value) : cur.px ?? 200;
        input.value = px;
        if (px !== cur.px) await this.#setRole(input.dataset.role, { ...cur, px });
      });
    }
    // (a group's open state is remembered only from the GM's own clicks, not from a search opening it)
    for (const sum of content.querySelectorAll("details[data-group] > summary")) {
      sum.addEventListener("click", () => {
        const d = sum.parentElement;
        if (d.open) this.#open.delete(d.dataset.group);
        else this.#open.add(d.dataset.group);
      });
    }
    this.#applyFilter();
  }

  /** Hides rows that don't match the search text, and groups left empty. */
  #applyFilter() {
    const t = this.#filter.text.trim().toLowerCase();
    for (const d of this.element?.querySelectorAll("details[data-group]") ?? []) {
      let any = false;
      for (const li of d.querySelectorAll("li[data-role]")) {
        const hit = !t || li.dataset.search.includes(t);
        li.hidden = !hit;
        any ||= hit;
      }
      d.hidden = !any;
      d.open = t ? any : this.#open.has(d.dataset.group);
    }
  }

  // Folders

  #foldersHTML() {
    const found = new Map((this.#idx?.folders ?? []).map((r) => [folderKey(r.folder), r]));
    const rows = this.#folders.map((f, i) => {
      const r = found.get(folderKey(folderOf(f)));
      const bad = [r?.error, ...(r?.errors ?? [])].filter(Boolean);
      const info = !r ? "" : [
        r.error ? "" : `${r.files.toLocaleString()} images${r.manifests ? `, ${r.manifests} manifest${r.manifests > 1 ? "s" : ""}` : ""}${r.cut ? ", read in part" : ""}`,
        ...bad.slice(0, 3).map((e) => `<span class="as-bad">${esc(e)}</span>`),
        bad.length > 3 ? `<span class="as-bad">and ${bad.length - 3} more</span>` : "",
      ].filter(Boolean).join("<br>");
      return `<li>
          <div class="as-af-row">
            <span class="as-af-source">${esc(f.source === "data" ? "Data" : f.source)}</span>
            <input type="text" name="path-${i}" value="${esc(f.path)}" placeholder="folder" aria-label="Folder">
            <button type="button" data-action="asBrowse" data-i="${i}" data-tooltip="Browse" aria-label="Browse"><i class="fa-solid fa-folder-open"></i></button>
            <button type="button" data-action="asRemove" data-i="${i}" data-tooltip="Remove" aria-label="Remove"><i class="fa-solid fa-trash"></i></button>
          </div>
          ${info ? `<div class="as-af-info">${info}</div>` : ""}
        </li>`;
    }).join("");
    return `<p class="hint">Folders of map art on the server, looked in for battle maps and the textured style. Forgotten Adventures files are found by name; another pack needs a manifest (atlas-scribe.json) in its folder, or rules (the Rules tab), or art chosen in the Art tab.</p>
      <ol class="as-af-list">${rows || `<li class="as-af-none">No folders.</li>`}</ol>
      <div class="as-af-buttons">
        <button type="button" data-action="asAdd"><i class="fa-solid fa-plus"></i> Add a folder</button>
        <button type="button" data-action="asDefault">Default</button>
        <button type="button" class="as-af-save" data-action="asSaveFolders" ${this.#reading ? "disabled" : ""}><i class="fa-solid fa-floppy-disk"></i> Save and read</button>
      </div>`;
  }



  static #onTab(event, target) {
    this.#tab = target.dataset.tab;
    this.render();
  }

  static #onAdd() {
    this.#folders.push({ source: "data", path: "" });
    this.render();
  }

  static #onRemove(event, target) {
    this.#folders.splice(Number(target.dataset.i), 1);
    this.render();
  }

  static async #onDefault() {
    let list = [];
    try {
      const nexus = nexusFolder();
      await FP().browse(nexus.source, nexus.path);
      list = [nexus];
    } catch {
      ui.notifications.info("AtlasScribe: the default looks in FA Nexus's download folder, which isn't on this server, so it's no folders.");
    }
    this.#folders = list;
    this.#default = JSON.stringify(list.map(folderOf));
    this.render();
  }

  static #onBrowse(event, target) {
    const i = Number(target.dataset.i);
    const f = this.#folders[i];
    new (FP())({
      type: "folder",
      current: f.path,
      activeSource: f.source,
      callback: (path, fp) => {
        const source = fp?.activeSource ?? "data";
        const folder = folderOf({ source, path, bucket: source === "s3" ? fp?.sources?.s3?.bucket : undefined });
        if (!folder.path && folder.source === "data") return ui.notifications.warn("AtlasScribe: the top of the Data folder holds every module and world: choose a folder inside it.");
        this.#folders[i] = folder;
        this.render();
      },
    }).render(true);
  }

  static async #onSaveFolders() {
    if (this.#reading) return;
    const seen = new Set();
    const list = this.#folders.map(folderOf).filter((f) => {
      const k = folderKey(f);
      if ((!f.path && f.source === "data") || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const unchanged = this.#default !== null && this.#default === JSON.stringify(list);
    this.#folders = list;
    await this.#save("artFolders", unchanged ? "" : JSON.stringify(list));
  }

  /** Saves a setting, then reads again: the folders after a folder change, else only what's built from them. */
  async #save(key, value) {
    await game.settings.set(MOD, key, value);
    if (key === "artFolders") forget();
    else forgetChoices();
    await this.#read();
  }

  static async #onReread() {
    if (this.#reading) return;
    forgetArt();
    await this.#read();
  }

  // Art

  #artHTML() {
    if (!this.#idx) return `<p class="as-art-wait">Reading...</p>`;
    const show = this.#filter.show;
    const keep = (r) => show === "all" || (show === "mine" ? ["hand", "rule", "manifest"].includes(r.source) : r.source === show);
    const groups = new Map();
    for (const r of this.#rows) {
      if (!keep(r)) continue;
      const g = groupOf(r.role);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(r);
    }
    const hand = storedRoles();
    // (roles with more specific names under them, where "every kind" means something)
    const names = this.#rows.map((r) => r.role);
    const hasKinds = (role) => names.some((n) => n.startsWith(`${role}.`));
    const fileName = (f) => { try { return decodeURIComponent(String(f).split("/").pop()); } catch { return String(f).split("/").pop(); } };
    const btn = (action, role, label, icon, extra = "") => `<button type="button" data-action="${action}" data-role="${esc(role)}" data-tooltip="${label}" aria-label="${label}" ${extra}><i class="fa-solid ${icon}"></i></button>`;
    const html = [...groups].sort(([a], [b]) => groupLabel(a).localeCompare(groupLabel(b))).map(([g, rows]) => {
      const none = rows.filter((r) => r.source === "none").length;
      const items = rows.map((r) => {
        const mine = hand[r.role];
        const thumb = r.paths[0] ? `<img src="${esc(r.paths[0])}" loading="lazy" alt="">` : `<span class="as-art-blank"></span>`;
        const via = r.source === "hand" && r.name !== r.role ? ` (${esc(roleLabel(r.name))})` : "";
        return `<li data-role="${esc(r.role)}" data-search="${esc(`${roleLabel(r.role)} ${r.role} ${groupLabel(g)}`.toLowerCase())}">
            ${thumb}
            <span class="as-art-name">${esc(roleLabel(r.role))}<small>${esc(r.role)}</small></span>
            <span class="as-art-src as-src-${r.source}">${SOURCES[r.source] ?? r.source}${via}${r.count ? ` <small>${r.count}</small>` : ""}</span>
            <span class="as-art-acts">
              ${btn("asPickFiles", r.role, "Choose an image", "fa-image")}
              ${btn("asPickFolder", r.role, "Use a folder of images", "fa-folder-open")}
              ${mine ? `<input type="number" class="as-art-px" data-role="${esc(r.role)}" value="${esc(mine.px ?? 200)}" min="20" max="2000" data-tooltip="Pixels a square" aria-label="Pixels a square">
              ${hasKinds(r.role) ? btn("asAllKinds", r.role, "Also for its seasons and sizes", "fa-layer-group", `class="${mine.all ? "active" : ""}" aria-pressed="${!!mine.all}"`) : ""}
              ${btn("asClear", r.role, "Clear", "fa-xmark")}` : ""}
            </span>
            ${mine ? `<ul class="as-art-mine">${[
              ...(mine.files ?? []).map((f, i) => `<li><i class="fa-solid fa-image"></i> ${esc(fileName(f))}<button type="button" data-action="asDrop" data-role="${esc(r.role)}" data-file="${i}" aria-label="Remove" data-tooltip="Remove"><i class="fa-solid fa-xmark"></i></button></li>`),
              ...(mine.folders ?? []).map((f, i) => `<li><i class="fa-solid fa-folder"></i> ${esc(folderOf(f).path || folderOf(f).source)}<button type="button" data-action="asDrop" data-role="${esc(r.role)}" data-folder="${i}" aria-label="Remove" data-tooltip="Remove"><i class="fa-solid fa-xmark"></i></button></li>`),
            ].join("")}</ul>` : ""}
          </li>`;
      }).join("");
      return `<details data-group="${esc(g)}" ${this.#open.has(g) ? "open" : ""}><summary>${esc(groupLabel(g))} <small>${rows.length}${none ? `, ${none} none` : ""}</small></summary><ul>${items}</ul></details>`;
    }).join("");
    const opt = (v, l) => `<option value="${v}" ${show === v ? "selected" : ""}>${l}</option>`;
    return `<div class="as-art-bar">
        <input type="search" class="as-art-search" placeholder="Search" aria-label="Search the roles" value="${esc(this.#filter.text)}">
        <select class="as-art-show" aria-label="Show">${opt("all", "All")}${opt("none", "None")}${opt("mine", "Your art")}${opt("hand", "By hand")}${opt("folder", "Folders")}${game.modules.get("fa-nexus")?.active || show === "nexus" ? opt("nexus", "FA Nexus") : ""}</select>
      </div>
      <p class="hint">${drawAll() ? "Draw whole battle maps is on (Configure Settings), so battle maps draw everything and use none of this art; the textured style still does." : "A role with none is drawn on a battle map and painted a plain color in the textured style."}</p>
      ${(this.#idx.notes ?? []).length ? `<ul class="as-art-notes">${this.#idx.notes.slice(0, 5).map((n) => `<li>${esc(n)}</li>`).join("")}${this.#idx.notes.length > 5 ? `<li>and ${this.#idx.notes.length - 5} more</li>` : ""}</ul>` : ""}
      ${html || `<p class="as-art-wait">Nothing to show.</p>`}`;
  }

  /** Writes one role's hand-chosen art (null clears it). */
  async #setRole(role, entry) {
    const all = storedRoles();
    if (entry) all[role] = entry;
    else delete all[role];
    await this.#save("artRoles", Object.keys(all).length ? JSON.stringify(all) : "");
  }

  static #onPickFiles(event, target) {
    const role = target.dataset.role;
    new (FP())({
      type: "image",
      current: storedRoles()[role]?.files?.at(-1) ?? "",
      callback: async (path) => {
        // (read when the pick is made, so a change made while the picker was open isn't undone)
        const e = { files: [], folders: [], px: 200, all: false, ...storedRoles()[role] };
        if (!e.files.includes(path)) e.files = [...e.files, path];
        await this.#setRole(role, e);
      },
    }).render(true);
  }

  static #onPickFolder(event, target) {
    const role = target.dataset.role;
    new (FP())({
      type: "folder",
      callback: async (path, fp) => {
        const source = fp?.activeSource ?? "data";
        const folder = folderOf({ source, path, bucket: source === "s3" ? fp?.sources?.s3?.bucket : undefined });
        if (!folder.path && folder.source === "data") return ui.notifications.warn("AtlasScribe: the top of the Data folder holds every module and world: choose a folder inside it.");
        const e = { files: [], folders: [], px: 200, all: false, ...storedRoles()[role] };
        if (!e.folders.some((f) => folderKey(folderOf(f)) === folderKey(folder))) e.folders = [...e.folders, folder];
        await this.#setRole(role, e);
      },
    }).render(true);
  }

  static async #onAllKinds(event, target) {
    const role = target.dataset.role;
    const cur = storedRoles()[role];
    if (cur) await this.#setRole(role, { ...cur, all: !cur.all });
  }

  static async #onClear(event, target) {
    await this.#setRole(target.dataset.role, null);
  }

  /** Takes one image or folder off a role's art (the role cleared when nothing is left). */
  static async #onDrop(event, target) {
    const role = target.dataset.role;
    const cur = storedRoles()[role];
    if (!cur) return;
    const e = { ...cur, files: [...(cur.files ?? [])], folders: [...(cur.folders ?? [])] };
    if (target.dataset.file !== undefined) e.files.splice(Number(target.dataset.file), 1);
    if (target.dataset.folder !== undefined) e.folders.splice(Number(target.dataset.folder), 1);
    await this.#setRole(role, e.files.length || e.folders.length ? e : null);
  }

  // Rules

  #rulesHTML() {
    const roles = [...new Set(this.#rows.map((r) => r.role))];
    const matches = this.#idx?.ruleMatches ?? [];
    // (a rule's count shows only while its row is as saved, at the same place)
    const stored = storedRules();
    const same = (r, i) => stored[i] && stored[i].pattern.trim() === r.pattern.trim() && stored[i].role.trim() === r.role.trim();
    const rows = this.#rules.map((r, i) => `<li>
        <input type="text" name="pattern-${i}" value="${esc(r.pattern)}" placeholder="*slate*roof*" aria-label="Pattern">
        <input type="text" name="role-${i}" value="${esc(r.role)}" placeholder="roof.slate" list="as-art-roles" aria-label="Role">
        <input type="number" name="px-${i}" value="${esc(r.px)}" placeholder="200" min="20" max="2000" data-tooltip="Pixels a square" aria-label="Pixels a square">
        <span class="as-rule-n">${same(r, i) && matches[i] !== undefined ? matches[i].toLocaleString() : ""}</span>
        <button type="button" data-action="asRemoveRule" data-i="${i}" data-tooltip="Remove" aria-label="Remove"><i class="fa-solid fa-trash"></i></button>
      </li>`).join("");
    return `<div class="as-rule-head"><span>Pattern</span><span>Role</span><span>px</span><span>Files</span></div>
      <ol class="as-rule-list">${rows || `<li class="as-af-none">No rules.</li>`}</ol>
      <datalist id="as-art-roles">${roles.map((r) => `<option value="${esc(r)}">${esc(roleLabel(r))}</option>`).join("")}</datalist>
      <div class="as-af-buttons">
        <button type="button" data-action="asAddRule"><i class="fa-solid fa-plus"></i> Add a rule</button>
        <button type="button" class="as-af-save" data-action="asSaveRules" ${this.#reading ? "disabled" : ""}><i class="fa-solid fa-floppy-disk"></i> Save and read</button>
      </div>`;
  }



  static #onAddRule() {
    this.#rules.push({ pattern: "", role: "", px: "" });
    this.render();
  }

  static #onRemoveRule(event, target) {
    this.#rules.splice(Number(target.dataset.i), 1);
    this.render();
  }

  static async #onSaveRules() {
    if (this.#reading) return;
    this.#rules = this.#rules.filter((r) => r.pattern.trim() && r.role.trim()).map((r) => ({ ...r, pattern: r.pattern.trim(), role: r.role.trim() }));
    const list = this.#rules.map((r) => ({ pattern: r.pattern.trim(), role: r.role.trim(), ...(Number(r.px) > 0 ? { px: Number(r.px) } : {}) }));
    await this.#save("artRules", list.length ? JSON.stringify(list) : "");
  }
}

/** The settings menu's window: the Art Browser already open, else a new one. */
export class ArtMenu extends ArtBrowser {
  constructor(options) {
    const open = foundry.applications.instances.get("atlas-scribe-art");
    if (open) return open;
    super(options);
  }
}
