/**
 * The Art Browser: where AtlasScribe's art comes from. Folders: the folders it looks in. Art: every kind of art (role)
 * with what it would be painted with and from where, and art chosen by hand for a role or all its kinds. Rules:
 * filename rules that give a role every image whose name matches.
 */
import { foldersToUse, folderOf, folderKey, storedFolders, storedRoles, storedRules, folderIndex, nexusFolder, forget, forgetChoices, gridPxOf } from "./art/folders.mjs";
import { describeArt, forgetArt, styleRoles } from "./art/index.mjs";
import { faRoleMap } from "./art/fa-nexus.mjs";
import { FP, MOD, esc, note } from "./util.mjs";
import { rememberWindow } from "../kit/window-memory.mjs";
import { keyboardWindow } from "../kit/keyboard.mjs";
import { singleWindow } from "../kit/single-window.mjs";
import { titleCase } from "../core/titles.mjs";

/** Folder and rule edits left unsaved when the Art window was closed, given back when it opens again. */
let kept = null;

/** Thumbnails made this session: { url: data URL or "" when the image won't load }. */
const thumbs = new Map();
/** The side of an Art-tab thumbnail, in pixels. */
const THUMB = 64;

/** A small copy of an image, so a list of hundreds doesn't hold every full image decoded. */
function thumbOf(url) {
  if (thumbs.has(url)) return thumbs.get(url);
  const made = new Promise((done) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      try {
        const k = THUMB / Math.max(img.naturalWidth, img.naturalHeight, 1);
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * k));
        c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        done(c.toDataURL("image/webp", 0.8));
      } catch {
        done(url); // (an image from another site without CORS: shown as it is)
      }
      img.src = "";
    };
    img.onerror = () => done("");
    img.src = url;
  });
  thumbs.set(url, made);
  return made;
}


/** A role's group, by its first part. */
const GROUPS = {
  ground: "Ground", surface: "Paths and Paving", overlay: "Overlays", water: "Water", stone: "Stone", roof: "Roofs", tree: "Trees",
  bush: "Bushes", chimney: "Chimneys", prop: "Props", cliff: "Cliffs", smoke: "Smoke", floor: "Floors", wood: "Wood", wall: "Walls",
  window: "Windows", fence: "Fences", shore: "Shores", dock: "Docks", field: "Fields", furn: "Furniture", edge: "Banks and Edges",
  shadow: "Shadows", fog: "Mist", strip: "Strips",
};
const groupOf = (role) => role.split(".")[0];
/** A filename rule as saved, to compare edits with. */
const ruleOf = (r) => ({ pattern: String(r.pattern ?? "").trim(), role: String(r.role ?? "").trim(), px: Number(r.px) > 0 ? Number(r.px) : null });
const groupLabel = (g) => GROUPS[g] ?? g.charAt(0).toUpperCase() + g.slice(1);
/** A role's name in words: "roof.slate.winter" is "Slate, Winter". */
export function roleLabel(role) {
  const rest = role.split(".").slice(1).map((p) => p.replace(/-/g, " "));
  return titleCase(rest.length ? rest.join(", ") : role);
}
/** Whether every battle map is drawn (the world setting), whatever art there is. */
const drawAll = () => { try { return !!game.settings.get(MOD, "drawnAll"); } catch { return false; } };
const SOURCES = { hand: "By Hand", rule: "Rule", manifest: "Manifest", folder: "Folder", nexus: "FA Nexus", none: "None" };

const Base = keyboardWindow(rememberWindow(foundry.applications.api.ApplicationV2, { module: MOD, name: "art" }), { module: MOD, scope: "art", ownKeys: true });

export class ArtBrowser extends Base {
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
      asReloadEdits: ArtBrowser.#onReloadEdits,
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
  /** The folder list and rules as saved, to tell unsaved edits (JSON). */
  #savedFolders = "[]";
  #savedRules = "[]";
  /** The tabs ("folders", "rules") whose setting another GM saved while this window had unsaved edits of it. */
  #elsewhere = new Set();
  /** Roles the styles ask for, listed even when no art source knows them. */
  #styleRoles = [];
  #filter = { show: "all", text: "" };
  /** Groups opened in the Art tab, kept across redraws. */
  #open = new Set();
  /** Counts reads, so only the latest one's results are shown. */
  #readCount = 0;
  /** The hooks that hear another GM change the art settings. */
  #hook = null;

  async _prepareContext() {
    if (!this.#folders) {
      // (edits left unsaved when the window was last closed come back, still marked unsaved)
      if (kept) {
        ({ folders: this.#folders, rules: this.#rules, savedFolders: this.#savedFolders, savedRules: this.#savedRules, def: this.#default } = kept);
        kept = null;
        this.#folders = this.#folders.map((f) => ({ ...f }));
        this.#rules = this.#rules.map((r) => ({ ...r }));
      } else this.#loadEdits();
      this.#read();
      // (a setting's first save creates it, later ones update it)
      // (a tab with unsaved edits keeps them, with a note offering the saved ones instead; art chosen by hand is saved
      // as it's chosen, so there's nothing there to lose)
      const heard = (setting, change, options, userId) => {
        const m = String(setting.key ?? "").match(/^atlas-scribe\.art(Folders|Roles|Rules)$/);
        if (userId === game.user.id || !m) return;
        const tab = m[1] === "Folders" ? "folders" : m[1] === "Rules" ? "rules" : null;
        if (tab && this.dirty?.[tab]) this.#elsewhere.add(tab);
        else if (tab) this.#loadEdits(tab);
        this.#read();
      };
      this.#hook ??= [Hooks.on("updateSetting", heard), Hooks.on("createSetting", heard)];
    }
    return {};
  }

  /** Which tabs hold edits not saved yet: { folders, rules }, or null when none do. */
  get dirty() {
    const folders = !!this.#folders && JSON.stringify(this.#folders.map(folderOf)) !== this.#savedFolders;
    const rules = !!this.#rules && JSON.stringify(this.#rules.map(ruleOf)) !== this.#savedRules;
    return folders || rules ? { folders, rules } : null;
  }

  /**
   * Closing with unsaved folder or rule edits keeps them for this session (they come back, still unsaved, when the
   * window opens again) and says so; options.discard drops them.
   */
  async close(options = {}) {
    const dirty = this.dirty;
    if (dirty && !options.discard) {
      kept = { folders: this.#folders, rules: this.#rules, savedFolders: this.#savedFolders, savedRules: this.#savedRules, def: this.#default };
      const what = dirty.folders && dirty.rules ? "folder and rule changes" : dirty.folders ? "folder changes" : "rule changes";
      note.info(`AtlasScribe: your ${what} aren't saved. They're kept until you reload: open Art again to save them.`);
    } else if (options.discard) kept = null;
    if (this.#hook) { Hooks.off("updateSetting", this.#hook[0]); Hooks.off("createSetting", this.#hook[1]); this.#hook = null; }
    return super.close(options);
  }

  /** The folder list and rules being edited (or only one tab's: "folders" or "rules"), from the settings. */
  #loadEdits(only = null) {
    if (only !== "rules") {
      this.#elsewhere.delete("folders");
      foldersToUse().then((list) => {
        this.#folders = list.map((f) => ({ ...f }));
        this.#savedFolders = JSON.stringify(this.#folders.map(folderOf));
        this.#default = storedFolders() ? null : this.#savedFolders;
        if (this.rendered) this.render();
      });
      this.#folders ??= [];
    }
    if (only !== "folders") {
      this.#elsewhere.delete("rules");
      this.#rules = storedRules().map((r) => ({ pattern: r.pattern, role: r.role, px: r.px ?? "" }));
      this.#savedRules = JSON.stringify(this.#rules.map(ruleOf));
    }
  }

  /** Reads the folders (from the session's cache when it has them), then what every role would be painted with. */
  async #read() {
    const n = ++this.#readCount;
    this.#reading = true;
    if (this.rendered) this.render();
    try {
      const idx = await folderIndex();
      const map = await faRoleMap();
      this.#styleRoles = await styleRoles();
      const roles = [...new Set([...Object.keys(map), ...this.#styleRoles, ...idx.roles.keys(), ...idx.rules.keys(), ...idx.hand.keys(), ...Object.keys(storedRoles())])].sort();
      const rows = await describeArt(roles);
      if (n !== this.#readCount) return;
      this.#idx = idx;
      this.#rows = rows;
    } catch (e) {
      if (n === this.#readCount) note.error(`AtlasScribe: the art couldn't be read (${e.message})`);
    } finally {
      if (n === this.#readCount) {
        this.#reading = false;
        if (this.rendered) this.render();
      }
    }
  }

  async _renderHTML() {
    const dirty = this.dirty ?? {};
    const tab = (id, label) => {
      const on = this.#tab === id;
      const mark = dirty[id] ? ` <span class="as-dirty" aria-label="(not saved)" data-tooltip-text="Not saved">\u25CF</span>` : "";
      return `<button type="button" role="tab" id="as-art-tab-${id}" aria-selected="${on}" aria-controls="as-art-panel" class="${on ? "active" : ""}" data-action="asTab" data-tab="${id}" ${on ? "data-focus-home" : ""}>${label}${mark}</button>`;
    };
    const body = this.#tab === "folders" ? this.#foldersHTML() : this.#tab === "rules" ? this.#rulesHTML() : this.#artHTML();
    const elsewhere = this.#elsewhere.has(this.#tab) ? `<p class="as-art-elsewhere" role="status">Another GM saved art settings. <button type="button" data-action="asReloadEdits">Use Theirs</button></p>` : "";
    return `<nav class="as-art-tabs" role="tablist" aria-label="Art">${tab("folders", "Folders")}${tab("art", "Art")}${tab("rules", "Rules")}
        <button type="button" class="as-art-reread" data-action="asReread" ${this.#reading ? "disabled" : ""} data-tooltip-text="Read the folders again" aria-label="Read the Folders Again"><i class="fa-solid fa-rotate${this.#reading ? " fa-spin" : ""}" aria-hidden="true"></i></button></nav>
      <section class="as-art-body" id="as-art-panel" role="tabpanel" aria-labelledby="as-art-tab-${this.#tab}" data-keep-scroll="art-body">${elsewhere}${body}</section>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
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
        this.#markDirty();
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
    this.#watchThumbs(content);
  }

  /** Shows or hides the tabs' "not saved" marks as edits are typed, without a redraw. */
  #markDirty() {
    const dirty = this.dirty ?? {};
    for (const id of ["folders", "rules"]) {
      const t = this.element?.querySelector(`[role="tab"][data-tab="${id}"]`);
      if (!t) continue;
      const mark = t.querySelector(".as-dirty");
      if (dirty[id] && !mark) t.insertAdjacentHTML("beforeend", ` <span class="as-dirty" aria-label="(not saved)" data-tooltip-text="Not saved">\u25CF</span>`);
      else if (!dirty[id]) mark?.remove();
    }
  }

  /** Loads each thumbnail as its row comes into view. */
  #watchThumbs(content) {
    const imgs = content.querySelectorAll("img[data-thumb]");
    if (!imgs.length) return;
    const body = content.querySelector(".as-art-body");
    const seen = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        seen.unobserve(e.target);
        const img = e.target;
        thumbOf(img.dataset.thumb).then((src) => {
          if (src) img.src = src;
          else img.classList.add("as-art-broken");
        });
      }
    }, { root: body, rootMargin: "200px" });
    for (const img of imgs) seen.observe(img);
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
      const info = r?.within ? `Read with ${esc(r.within)}, which holds it` : !r ? "" : [
        r.error ? "" : `${r.files.toLocaleString()} images${r.manifests ? `, ${r.manifests} manifest${r.manifests > 1 ? "s" : ""}` : ""}${r.cut ? ", read in part" : ""}`,
        ...bad.slice(0, 3).map((e) => `<span class="as-bad">${esc(e)}</span>`),
        bad.length > 3 ? `<span class="as-bad">and ${bad.length - 3} more</span>` : "",
      ].filter(Boolean).join("<br>");
      return `<li>
          <div class="as-af-row">
            <span class="as-af-source">${esc(f.source === "data" ? "Data" : f.source)}</span>
            <input type="text" name="path-${i}" value="${esc(f.path)}" placeholder="folder" aria-label="Folder">
            <button type="button" data-action="asBrowse" data-i="${i}" data-tooltip-text="Browse" aria-label="Browse"><i class="fa-solid fa-folder-open"></i></button>
            <button type="button" data-action="asRemove" data-i="${i}" data-tooltip-text="Remove" aria-label="Remove"><i class="fa-solid fa-trash"></i></button>
          </div>
          ${info ? `<div class="as-af-info">${info}</div>` : ""}
        </li>`;
    }).join("");
    return `<p class="hint">Folders of map art on the server, looked in for battle maps and the textured style. Forgotten Adventures files are found by name; another pack needs a manifest (atlas-scribe.json) in its folder, or rules (the Rules tab), or art chosen in the Art tab.</p>
      <ol class="as-af-list">${rows || `<li class="as-af-none">No folders.</li>`}</ol>
      <div class="as-af-buttons">
        <button type="button" data-action="asAdd"><i class="fa-solid fa-plus"></i> Add a Folder</button>
        <button type="button" data-action="asDefault">Default</button>
        <button type="button" class="as-af-save" data-action="asSaveFolders" ${this.#reading ? "disabled" : ""}><i class="fa-solid fa-floppy-disk"></i> Save and Read</button>
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
      note.info("AtlasScribe: the default looks in FA Nexus's download folder, which isn't on this server, so it's no folders.");
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
        if (!folder.path && folder.source === "data") return note.warn("AtlasScribe: the top of the Data folder holds every module and world: choose a folder inside it.");
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
    if (key === "artFolders") { this.#savedFolders = JSON.stringify(this.#folders.map(folderOf)); this.#elsewhere.delete("folders"); }
    if (key === "artRules") { this.#savedRules = JSON.stringify(this.#rules.map(ruleOf)); this.#elsewhere.delete("rules"); }
    if (key === "artFolders") forget();
    else forgetChoices();
    await this.#read();
  }

  /** Drops this tab's unsaved edits for what another GM saved. */
  static #onReloadEdits() {
    this.#loadEdits(this.#tab);
    this.render();
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
    const btn = (action, role, label, icon, extra = "") => `<button type="button" data-action="${action}" data-role="${esc(role)}" data-tooltip-text="${label}" aria-label="${titleCase(label)}" ${extra}><i class="fa-solid ${icon}"></i></button>`;
    const html = [...groups].sort(([a], [b]) => groupLabel(a).localeCompare(groupLabel(b))).map(([g, rows]) => {
      const none = rows.filter((r) => r.source === "none").length;
      const items = rows.map((r) => {
        const mine = hand[r.role];
        const thumb = r.paths[0] ? `<img data-thumb="${esc(r.paths[0])}" width="${THUMB}" height="${THUMB}" alt="">` : `<span class="as-art-blank"></span>`;
        const via = r.source === "hand" && r.name !== r.role ? ` (${esc(roleLabel(r.name))})` : "";
        return `<li data-role="${esc(r.role)}" data-search="${esc(`${roleLabel(r.role)} ${r.role} ${groupLabel(g)}`.toLowerCase())}">
            ${thumb}
            <span class="as-art-name">${esc(roleLabel(r.role))}<small>${esc(r.role)}</small></span>
            <span class="as-art-src as-src-${r.source}">${SOURCES[r.source] ?? r.source}${via}${r.count ? ` <small>${r.count}</small>` : ""}</span>
            <span class="as-art-acts">
              ${btn("asPickFiles", r.role, "Choose an image", "fa-image")}
              ${btn("asPickFolder", r.role, "Use a folder of images", "fa-folder-open")}
              ${mine ? `<input type="number" class="as-art-px" data-role="${esc(r.role)}" value="${esc(mine.px ?? 200)}" min="20" max="2000" data-tooltip-text="Pixels a square" aria-label="Pixels a Square">
              ${hasKinds(r.role) ? btn("asAllKinds", r.role, "Also for its seasons and sizes", "fa-layer-group", `class="${mine.all ? "active" : ""}" aria-pressed="${!!mine.all}"`) : ""}
              ${btn("asClear", r.role, "Clear", "fa-xmark")}` : ""}
            </span>
            ${mine ? `<ul class="as-art-mine">${[
              ...(mine.files ?? []).map((f, i) => `<li><i class="fa-solid fa-image"></i> ${esc(fileName(f))}<button type="button" data-action="asDrop" data-role="${esc(r.role)}" data-file="${i}" aria-label="Remove" data-tooltip-text="Remove"><i class="fa-solid fa-xmark"></i></button></li>`),
              ...(mine.folders ?? []).map((f, i) => `<li><i class="fa-solid fa-folder"></i> ${esc(folderOf(f).path || folderOf(f).source)}<button type="button" data-action="asDrop" data-role="${esc(r.role)}" data-folder="${i}" aria-label="Remove" data-tooltip-text="Remove"><i class="fa-solid fa-xmark"></i></button></li>`),
            ].join("")}</ul>` : ""}
          </li>`;
      }).join("");
      return `<details data-group="${esc(g)}" data-focus-key="group-${esc(g)}" ${this.#open.has(g) ? "open" : ""}><summary>${esc(groupLabel(g))} <small>${rows.length}${none ? `, ${none} none` : ""}</small></summary><ul>${items}</ul></details>`;
    }).join("");
    const opt = (v, l) => `<option value="${v}" ${show === v ? "selected" : ""}>${l}</option>`;
    return `<div class="as-art-bar">
        <input type="search" class="as-art-search" placeholder="Search" aria-label="Search the Roles" value="${esc(this.#filter.text)}">
        <select class="as-art-show" aria-label="Show">${opt("all", "All")}${opt("none", "None")}${opt("mine", "Your Art")}${opt("hand", "By Hand")}${opt("folder", "Folders")}${game.modules.get("fa-nexus")?.active || show === "nexus" ? opt("nexus", "FA Nexus") : ""}</select>
      </div>
      <p class="hint">${drawAll() ? "Draw Whole Battle Maps is on (Configure Settings), so battle maps draw everything and use none of this art; the textured style still does." : "A role with none is drawn on a battle map and painted a plain color in the textured style."}</p>
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
        if (!folder.path && folder.source === "data") return note.warn("AtlasScribe: the top of the Data folder holds every module and world: choose a folder inside it.");
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
        <input type="number" name="px-${i}" value="${esc(r.px)}" placeholder="200" min="20" max="2000" data-tooltip-text="Pixels a square" aria-label="Pixels a Square">
        <span class="as-rule-n">${!this.#reading && same(r, i) && matches[i] !== undefined ? matches[i].toLocaleString() : ""}</span>
        <button type="button" data-action="asRemoveRule" data-i="${i}" data-tooltip-text="Remove" aria-label="Remove"><i class="fa-solid fa-trash"></i></button>
      </li>`).join("");
    return `<div class="as-rule-head"><span>Pattern</span><span>Role</span><span>px</span><span>Files</span></div>
      <ol class="as-rule-list">${rows || `<li class="as-af-none">No rules.</li>`}</ol>
      <datalist id="as-art-roles">${roles.map((r) => `<option value="${esc(r)}">${esc(roleLabel(r))}</option>`).join("")}</datalist>
      <div class="as-af-buttons">
        <button type="button" data-action="asAddRule"><i class="fa-solid fa-plus"></i> Add a Rule</button>
        <button type="button" class="as-af-save" data-action="asSaveRules" ${this.#reading ? "disabled" : ""}><i class="fa-solid fa-floppy-disk"></i> Save and Read</button>
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

/** The Art Browser, one at a time: open() shows the one already open, or a new one. */
export const artWindow = singleWindow(() => new ArtBrowser());

/** The settings menu's window: the Art Browser already open, else a new one. */
export class ArtMenu extends ArtBrowser {
  constructor(options) {
    const open = artWindow.current() ?? foundry.applications.instances.get("atlas-scribe-art");
    if (open) return open;
    super(options);
  }

  /** Foundry's settings menu calls render(true) on what it made: shown through artWindow so it's the one. */
  render(options, _options) {
    if (artWindow.current() !== this && !artWindow.current()) return artWindow.open().then(() => this);
    return super.render(options, _options);
  }
}
