/**
 * The Files window: what AtlasScribe has saved, plan by plan. Each plan's file, the maps rendered from it (with the
 * roofs, drawn pieces and floors saved beside a battle map, and a big map's parts), which map each of its scenes shows, the scene backups,
 * and how much room each takes. Foundry can't delete files, so this only shows them, with their paths to copy.
 */
import { listPlans } from "./plans.mjs";
import { FP, MOD, esc, note, labelAttr } from "./util.mjs";
import { rememberWindow } from "../kit/window-memory.mjs";
import { keyboardWindow } from "../kit/keyboard.mjs";
import { singleWindow } from "../kit/single-window.mjs";

/** A name as freeName() saves it: lowercase, with anything but letters, digits, dots, - and _ made a dash. */
export const safeName = (s) => String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
const nameOf = (p) => {
  const n = String(p).replace(/[?#].*$/, "").split("/").pop();
  try {
    return decodeURIComponent(n);
  } catch {
    return n;
  }
};
const bare = (p) => String(p ?? "").replace(/[?#].*$/, "");

/**
 * Sorts the files into plans. plans: [{ id, ... }]; maps: file paths in maps/; dirs: folder paths in maps/; backups:
 * file paths in backups/; scenes: [{ id, name, plan, image }]. Returns { groups: [{ plan, maps: [{ path, parts: [dir],
 * scenes: [name] }], backups: [path], scenes }], other: { maps, backups } }: a map belongs to the plan whose id its
 * name begins with (the longest such id), a backup to the plan of the scene it was named after.
 */
export function sortFiles({ plans, maps, dirs, backups, scenes }) {
  const ids = plans.map((p) => p.id).filter(Boolean).map((id) => ({ id, key: safeName(id) })).sort((a, b) => b.key.length - a.key.length);
  const planFor = (name) => ids.find(({ key }) => name === key || name.startsWith(`${key}-`))?.id ?? null;
  // (by file: two plan files can hold the same id; a map or backup goes to the first of them)
  const groups = new Map(plans.map((p) => [p.path, { plan: p, maps: [], backups: [], scenes: scenes.filter((s) => p.id && s.plan === p.id) }]));
  const groupOf = (id) => (id == null ? null : [...groups.values()].find((g) => g.plan.id === id) ?? null);
  const other = { maps: [], backups: [] };
  const used = new Map();
  for (const s of scenes) if (s.image) used.set(bare(s.image), [...(used.get(bare(s.image)) ?? []), s.name]);
  for (const path of maps) {
    const stem = nameOf(path).replace(/\.\w+$/, "").toLowerCase();
    const own = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(overhead|drawn|levels|parts)(-\\d+)?$`);
    const parts = dirs.filter((d) => own.test(nameOf(d).toLowerCase()));
    const entry = { path, parts, scenes: used.get(bare(path)) ?? [] };
    const g = groupOf(planFor(stem));
    (g ? g.maps : other.maps).push(entry);
  }
  for (const path of backups) {
    const n = nameOf(path).toLowerCase();
    // (the scene with the longest name the backup's begins with: "town-square-..." is Town Square's, not Town's)
    const s = scenes.filter((x) => x.plan && n.startsWith(`${safeName(x.name)}-`)).sort((a, b) => safeName(b.name).length - safeName(a.name).length)[0];
    const g = s ? groupOf(s.plan) : null;
    (g ? g.backups : other.backups).push(path);
  }
  return { groups: [...groups.values()], other };
}

/** The bytes a file takes, from the server (null when it doesn't say). */
const sizes = new Map();
function sizeOf(path) {
  if (!sizes.has(path)) {
    sizes.set(path, fetch(path, { method: "HEAD", cache: "no-cache" }).then((r) => (r.ok ? Number(r.headers.get("content-length")) || null : null)).catch(() => null));
  }
  return sizes.get(path);
}
const words = (n) => (n == null ? "" : n < 1024 ** 2 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 ** 2).toFixed(n < 1024 ** 2 * 10 ? 1 : 0)} MB`);

const browse = async (dir) => {
  try {
    const r = await FP().browse("data", dir);
    return { files: r.files ?? [], dirs: r.dirs ?? [] };
  } catch {
    return { files: [], dirs: [] };
  }
};

const Base = keyboardWindow(rememberWindow(foundry.applications.api.ApplicationV2, { module: MOD, name: "files" }), { module: MOD, scope: "files", ownKeys: true });

export class FilesView extends Base {
  static DEFAULT_OPTIONS = {
    id: "atlas-scribe-files",
    classes: ["atlas-scribe", "as-files"],
    tag: "div",
    window: { title: "AtlasScribe: Files", icon: "fa-solid fa-folder-tree", resizable: true },
    position: { width: 620, height: 640 },
    actions: { asCopyPath: FilesView.#onCopy, asOpenPlan: FilesView.#onOpenPlan, asRefresh: FilesView.#onRefresh },
  };

  #where = null;
  #data = null;
  #reading = false;
  #open = new Set();

  /** Where to look: { folder, plansDir, backupDir }. */
  set where(w) {
    this.#where = w;
  }

  async #read() {
    if (!this.#where || this.#reading) return;
    this.#reading = true;
    if (this.rendered) this.render();
    try {
      const { folder, plansDir, backupDir = `${folder}/backups` } = this.#where;
      const [plans, maps, backups] = await Promise.all([listPlans(plansDir), browse(`${folder}/maps`), browse(backupDir)]);
      const scenes = game.scenes.filter((s) => s.flags?.[MOD]).map((s) => ({ id: s.id, name: s.name, plan: s.getFlag(MOD, "plan") ?? null, image: s.getFlag(MOD, "image") ?? s.background?.src ?? null }));
      const parts = new Map(await Promise.all(maps.dirs.map(async (d) => [d, (await browse(d)).files])));
      this.#data = { ...sortFiles({ plans, maps: maps.files.filter((f) => /\.(webp|jpe?g)$/i.test(f)), dirs: maps.dirs, backups: backups.files, scenes }), parts, folder };
    } catch (e) {
      note.error(`AtlasScribe: the files couldn't be read (${e.message})`);
    } finally {
      this.#reading = false;
      if (this.rendered) this.render();
    }
  }

  async _prepareContext() {
    if (!this.#data && !this.#reading) this.#read();
    return {};
  }

  async _renderHTML() {
    const d = this.#data;
    const copy = (path) => `<button type="button" data-action="asCopyPath" data-path="${esc(path)}"${labelAttr(`Copy the path of ${nameOf(path)}`)}><i class="fa-solid fa-copy" aria-hidden="true"></i></button>`;
    const file = (path, extra = "") => `<li><span class="as-file-name">${esc(nameOf(path))}${extra}</span><span class="as-file-size" data-size="${esc(path)}"></span>${copy(path)}</li>`;
    const mapRow = (m) => {
      const pieces = m.parts.flatMap((p) => d.parts.get(p) ?? []);
      const use = m.scenes.length ? ` <em class="as-file-use">${esc(`shown by ${m.scenes.join(", ")}`)}</em>` : "";
      return file(m.path, `${use}${pieces.length ? ` <small>and ${pieces.length} ${pieces.length === 1 ? "piece" : "pieces"} beside it</small>` : ""}`).replace(`data-size="${esc(m.path)}"`, `data-size="${esc([m.path, ...pieces].join("\n"))}"`);
    };
    const group = (key, title, sub, body, all) => `<details data-group="${esc(key)}" data-focus-key="files-${esc(key)}" ${this.#open.has(key) ? "open" : ""}>
        <summary><strong>${esc(title)}</strong> <small>${esc(sub)}</small> <span class="as-file-size" data-size="${esc(all.join("\n"))}"></span></summary>${body}</details>`;
    // (a name saved in more than one plan file shows its file too)
    const names = (d?.groups ?? []).map(({ plan }) => plan.name ?? plan.file);
    const twice = new Set(names.filter((n, i) => names.indexOf(n) !== i));
    const body = !d ? `<p class="as-art-wait">Reading...</p>` : [
      ...d.groups.map(({ plan, maps, backups, scenes }) => {
        const pieces = maps.flatMap((m) => m.parts.flatMap((p) => d.parts.get(p) ?? []));
        const all = [plan.path, ...maps.map((m) => m.path), ...pieces, ...backups];
        const sub = `${maps.length} ${maps.length === 1 ? "map" : "maps"}, ${backups.length} ${backups.length === 1 ? "backup" : "backups"}${scenes.length ? `, ${scenes.length} ${scenes.length === 1 ? "scene" : "scenes"}` : ""}`;
        const title = plan.name ?? plan.file;
        return group(plan.id ?? plan.path, twice.has(title) ? `${title} [${plan.file}]` : title, sub, `<ul class="as-file-list">
            ${file(plan.path, " <small>(the plan)</small>")}
            ${maps.map(mapRow).join("")}
            ${backups.map((b) => file(b, " <small>(backup)</small>")).join("")}
          </ul>
          ${plan.id ? `<button type="button" data-action="asOpenPlan" data-path="${esc(plan.path)}"><i class="fa-solid fa-map" aria-hidden="true"></i> Open the Plan</button>` : ""}`, all);
      }),
      d.other.maps.length || d.other.backups.length ? group("@other", "Other Files", "maps and backups of plans not saved here", `<ul class="as-file-list">${d.other.maps.map(mapRow).join("")}${d.other.backups.map((b) => file(b, " <small>(backup)</small>")).join("")}</ul>`, [...d.other.maps.map((m) => m.path), ...d.other.backups]) : "",
    ].join("") || `<p class="as-art-wait">Nothing saved yet.</p>`;
    return `<div class="as-files-bar"><p class="hint">In ${esc(this.#where?.folder ?? "")}. Foundry can't delete files: remove ones you don't need from the server's Data folder.</p>
        <button type="button" data-action="asRefresh" ${this.#reading ? "disabled" : ""}${labelAttr("Read the files again")}><i class="fa-solid fa-rotate${this.#reading ? " fa-spin" : ""}" aria-hidden="true"></i></button></div>
      <section class="as-files-body" data-keep-scroll="files-body">${body}</section>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    for (const sum of content.querySelectorAll("details[data-group] > summary")) {
      sum.addEventListener("click", () => {
        const g = sum.parentElement;
        if (g.open) this.#open.delete(g.dataset.group);
        else this.#open.add(g.dataset.group);
      });
    }
    // (sizes come from the server one file at a time: shown as they arrive)
    for (const el of content.querySelectorAll("[data-size]")) {
      const paths = el.dataset.size.split("\n").filter(Boolean);
      Promise.all(paths.map(sizeOf)).then((list) => {
        const known = list.filter((n) => n != null);
        if (known.length) el.textContent = words(known.reduce((a, b) => a + b, 0));
      });
    }
  }

  static async #onCopy(event, target) {
    await game.clipboard.copyPlainText(target.dataset.path);
    note.info(`AtlasScribe: copied ${target.dataset.path}`);
  }

  static async #onOpenPlan(event, target) {
    try {
      await game.modules.get(MOD)?.api?.openPlan({ path: target.dataset.path });
    } catch (e) {
      note.error(e.message);
    }
  }

  static #onRefresh() {
    this.reread();
  }

  /** Reads the files and their sizes again. */
  reread() {
    sizes.clear();
    this.#data = null;
    this.#read();
  }
}

/** The Files window, one at a time; open() reads the files again. */
export const filesWindow = singleWindow((where) => {
  const w = new FilesView();
  w.where = where;
  return w;
}, { reuse: (w, where) => { w.where = where; w.reread(); } });
