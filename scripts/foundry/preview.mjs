/**
 * The AtlasScribe window. A plan laid out and drawn in plain colours in a second or so, with its districts and areas
 * outlined, so a change can be judged before a full render; and around it, the plan's file (Quick Start, open, import,
 * save, export), its problems, and making it into a scene. Rerolling, locking and undoing happen here; the window
 * keeps the plan they make (app.plan), and Copy plan puts it on the clipboard. With Shapes on, districts and areas
 * show handles on their corners: drag one to reshape (corners two shapes share move together, and a corner dropped
 * on another snaps to it), drag the dot in the middle of a side to add a corner, alt-click or right-click a corner to
 * remove it. Scroll to zoom, drag to pan, double-click to fit. Clicking a feature (on the map or in the list) opens
 * its settings in the side panel (the inspector), and the gear opens the plan's own; each change redraws the map.
 */
import { rerollable, rerollPlan, setLocked } from "../core/seeds.mjs";
import { shapeToPolygon, pointInPolygon, distanceToPath } from "../core/geom.mjs";
import { normalize } from "../core/plan.mjs";
import { handlesOf, partnersOf, moveHandle, removeCorner, shapeProblem } from "../core/reshape.mjs";
import { featureOf, setField, setPlanField, deleteFeature } from "../core/edit.mjs";
import { featureHTML, planHTML, paletteHTML, howText, readInput } from "./inspector.mjs";
import { addFeature, snapCorner, snapEnd, toolOf } from "../core/draw.mjs";

/** JSON with object keys sorted, so a plan whose keys merely moved (a setting reset, then set again) counts as unchanged. */
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The middle of a polygon (its area centroid; the mean of its points if it has no area). */
function centroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    const k = x0 * y1 - x1 * y0;
    a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k;
  }
  if (Math.abs(a) < 1e-9) return [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  return [cx / (3 * a), cy / (3 * a)];
}

export class AtlasScribeApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "atlas-scribe",
    classes: ["atlas-scribe", "as-preview"],
    tag: "div",
    window: { title: "AtlasScribe", icon: "fa-solid fa-map", resizable: true },
    position: { width: 1160, height: 780 },
    actions: {
      asQuick: AtlasScribeApp.#onQuick,
      asOpen: AtlasScribeApp.#onOpen,
      asImport: AtlasScribeApp.#onImport,
      asSave: AtlasScribeApp.#onSave,
      asExport: AtlasScribeApp.#onExport,
      asScene: AtlasScribeApp.#onScene,
      asView: AtlasScribeApp.#onView,
      asReroll: AtlasScribeApp.#onReroll,
      asRerollAll: AtlasScribeApp.#onRerollAll,
      asLock: AtlasScribeApp.#onLock,
      asUndo: AtlasScribeApp.#onUndo,
      asCopy: AtlasScribeApp.#onCopy,
      asOutlines: AtlasScribeApp.#onOutlines,
      asFit: AtlasScribeApp.#onFit,
      asShapes: AtlasScribeApp.#onShapes,
      asCancel: AtlasScribeApp.#onCancel,
      asBack: AtlasScribeApp.#onBack,
      asReset: AtlasScribeApp.#onReset,
      asDelete: AtlasScribeApp.#onDelete,
      asPlan: AtlasScribeApp.#onPlan,
      asDraw: AtlasScribeApp.#onDraw,
      asTool: AtlasScribeApp.#onTool,
      asFinish: AtlasScribeApp.#onFinish,
      asStopTool: AtlasScribeApp.#onStopTool,
    },
  };

  /** run(plan) draws a plan: resolves to the worker's preview result, or throws. */
  #run;
  #plan;
  #history = [];
  #result = null;
  #url = null;
  #error = null;
  #stale = false; // the picture is of another plan (a new plan that couldn't be drawn)
  #busy = false;
  #outlines = true;
  #view = null; // { k, tx, ty }: zoom and pan; null fits the map to the window
  #drag = null;
  #resize = null;
  #drawing = null; // the draw in flight, so a new plan waits for it
  #shapes = false; // every corner handle shown
  #selected = null; // the feature clicked: its handles are shown even with Shapes off, and its settings in the side panel
  #inspect = null; // what the side panel shows instead of the list: a feature's id, "@plan", or null
  #palette = false; // the side panel shows the drawing tools
  #tool = null; // the drawing under way: { id, points, box, cursor, snap, down }
  #keys = null; // the keyboard listener while drawing (Enter, Esc, Backspace)
  #finishedAt = 0; // when a drawing last finished, so the double-click that finished it doesn't also fit the map
  #queue = []; // inspector changes made while the map was drawing: (plan) => { plan } | { error }, applied when it's done
  #corners = []; // every corner in the plan, for a dragged corner to snap to
  #handles = []; // handlesOf(plan) as drawn
  #edit = null; // the handle being dragged: { h, partners, plan, x, y, moved, next }

  #host; // what the window asks of the module: check, quick, plans, publish, folder, last
  #saved = null; // the plan as last saved or opened (JSON), to tell when there are changes to save
  #path = null; // the file it was opened from or saved to
  #publishing = false; // a Make scene or Update scene is running (drawing has its own flag, #busy)
  #saving = false;

  constructor({ plan = null, run, host }, options = {}) {
    super(options);
    this.#plan = plan;
    this.#run = run;
    this.#host = host;
  }

  /** True when the plan has changes that aren't saved. */
  get dirty() {
    return !!this.#plan && canon(this.#plan) !== this.#saved;
  }

  /** Opens the window (again): draws the plan it had, else the plan last opened here, else shows Quick Start's welcome. */
  async reopen() {
    await this.render({ force: true });
    if (!this.#plan) {
      const last = this.#host.last();
      if (last) {
        let plan = null;
        try { plan = await this.#host.plans.load(last); } catch { this.#host.setLast(null); } // gone: forget it, start empty
        // Quick Start or Open from the welcome may have given the window a plan while that loaded: keep theirs
        if (plan && !this.#plan) return this.show(plan, null, { path: last, saved: true });
      }
      return null;
    }
    if (!this.#result && !this.#drawing) return this.#draw();
    return this.#result;
  }

  /** Resolves once no draw is in flight. */
  async settled() {
    if (this.#drawing) await this.#drawing;
  }

  /** The plan as it stands now, with any rerolls and locks made here (a copy). */
  get plan() {
    return structuredClone(this.#plan);
  }

  /**
   * Shows a new plan (the undo history starts again) and draws it; run replaces the drawing function if given.
   * path: the file it came from; saved: it's as saved there (else it counts as unsaved).
   */
  async show(plan, run = null, { path = null, saved = false } = {}) {
    // A scene is being painted from the plan here: swapping the plan under it would leave the window showing one plan
    // while another is published
    if (this.#publishing) throw new Error("AtlasScribe: the window is making a scene; try again when it's done");
    while (this.#drawing) await this.#drawing; // one draw at a time, however many are waiting
    if (run) this.#run = run;
    this.#plan = plan;
    this.#path = path;
    this.#selected = null;
    this.#inspect = null; // a new plan opens on its list (ids repeat between plans)
    this.#endTool();
    this.#palette = false;
    this.#queue = [];
    this.#saved = saved ? canon(plan) : null;
    this.#error = null;
    this.#result = null;
    if (path) this.#host.setLast(path);
    this.#history = [];
    this.#view = null;
    return this.#draw();
  }

  /**
   * Draws the current plan, then renders the window. Resolves to the result when the picture is in, or to null if
   * the draw failed (the window says why) or the window was closed meanwhile. One draw at a time.
   */
  #draw() {
    const go = async () => {
      this.#busy = true;
      this.#error = null;
      if (this.rendered) this.#markBusy();
      else await this.render({ force: true });
      let result = null;
      try {
        result = await this.#run(this.#plan);
      } catch (e) {
        this.#error = e.message ?? String(e);
      }
      this.#busy = false;
      this.#stale = !result;
      if (!this.rendered) return null; // closed meanwhile: nothing to show it in, and nothing to keep
      if (result) {
        if (this.#url) URL.revokeObjectURL(this.#url);
        this.#url = URL.createObjectURL(result.blob);
        this.#result = result;
      }
      await this.render();
      return result;
    };
    this.#drawing = go().finally(() => {
      this.#drawing = null;
      if (this.#queue.length) setTimeout(() => this.#flush(), 0);
    });
    return this.#drawing;
  }

  #markBusy() {
    this.element?.querySelector(".as-pv-map")?.classList.add("as-busy");
    for (const b of this.element?.querySelectorAll("[data-action^='asRe'], [data-action='asLock'], [data-action='asUndo'], [data-action='asScene'], [data-action='asQuick'], [data-action='asOpen'], [data-action='asImport']") ?? []) b.disabled = true;
    // The inspector stays usable: what's changed meanwhile is queued (#flush) rather than lost
  }

  /** True while anything that holds the job (a draw, or making the scene) is running. */
  get #working() {
    return this.#busy || this.#publishing || this.#saving; // a reroll while "Save over a plan?" is up would go unsaved
  }

  /** True while Make scene or Update scene is painting. */
  get publishing() {
    return this.#publishing;
  }

  /** The features a reroll can redraw, with their outlines (read with every default filled in, as the layout reads them). */
  #features() {
    const plan = normalize(this.#plan);
    const locked = new Set(plan.locked);
    return plan.features.filter(rerollable).map((f) => {
      let poly = [];
      // Areas are turned by their rot, as the layout turns them; districts aren't turned
      try { poly = shapeToPolygon(f.shape, f.type === "area" ? f.rot ?? 0 : 0) ?? []; } catch { poly = []; }
      const kind = f.type === "district" ? (f.profile ?? "village") : (f.class ?? "area");
      return { id: f.id, type: f.type, kind, name: f.name ?? null, poly, locked: locked.has(f.id) };
    });
  }

  /** The plan's roads, rivers and walls as drawn on the overlay: [{ id, type, pts, half }] (half: half its width). */
  #paths() {
    const plan = normalize(this.#plan);
    const sq = plan.size.ftPerSquare || 25;
    return plan.features.filter((f) => (f.type === "road" || f.type === "water" || f.type === "wall") && Array.isArray(f.path) && f.path.length >= 2)
      .map((f) => ({ id: f.id, type: f.type, pts: f.path, half: f.type === "wall" ? 0.15 : (Number(f.width) || 10) / sq / 2 }));
  }

  /**
   * Squares, plan buildings, a landmark's buildings and water drawn as a shape (a pond, a lake), outlined faintly so
   * they can be clicked: [{ id, type, poly }].
   */
  #minor() {
    const plan = normalize(this.#plan);
    const out = [];
    const add = (id, type, shape, rot = 0) => {
      let poly = [];
      try { poly = shapeToPolygon(shape, rot) ?? []; } catch { poly = []; }
      if (poly.length >= 3) out.push({ id, type, poly });
    };
    for (const f of plan.features) {
      if (f.type === "square") add(f.id, f.type, f.shape);
      else if (f.type === "building") add(f.id, f.type, f.shape, f.rot ?? 0);
      else if (f.type === "water" && !Array.isArray(f.path) && f.shape) add(f.id, f.type, f.shape);
      else if (f.type === "landmark") for (const b of f.buildings ?? []) add(f.id, "landmark", b.shape, b.rot ?? 0);
    }
    return out;
  }

  /** Bridges, fords and props: points that can be clicked, [{ id, type, at }]. A bridge is where it was drawn (moved onto its road). */
  #points() {
    const drawn = new Map((this.#result?.crossings ?? []).map((c) => [c.id, c.at]));
    return (this.#plan?.features ?? []).filter((f) => (f?.type === "crossing" || f?.type === "prop") && Array.isArray(f.at))
      .map((f) => ({ id: f.id, type: f.type, at: drawn.get(f.id) ?? f.at }));
  }

  /** The plan's labels with the box their text takes on the overlay (squares), for clicking: [{ id, at, hw, hh }]. */
  #labelBoxes() {
    const [MW, MH] = this.#result?.squares ?? this.#plan?.size?.squares ?? [1, 1];
    const fs = (Math.max(MW, MH) / 55) * 0.85; // as the overlay draws them
    return (this.#plan?.features ?? []).filter((f) => f?.type === "label" && Array.isArray(f.at))
      .map((f) => ({ id: f.id, at: f.at, hw: Math.max(fs, String(f.text ?? "").length * fs * 0.3), hh: fs * 0.6 }));
  }

  async _renderHTML() {
    const el = document.createElement("div");
    el.className = "as-pv";
    if (!this.#plan) {
      el.classList.add("as-empty");
      el.innerHTML = `<div class="as-pv-welcome">
          <i class="fa-solid fa-map-location-dot"></i>
          <h2>Make a map</h2>
          <p>Quick Start makes a hamlet, village or town from a few choices. Then reroll, lock and reshape it here, and make it into a scene.</p>
          <div class="as-pv-tools">
            <button type="button" data-action="asQuick"><i class="fa-solid fa-wand-magic-sparkles"></i> Quick Start</button>
            <button type="button" data-action="asOpen"><i class="fa-solid fa-folder-open"></i> Open a saved plan</button>
            <button type="button" data-action="asImport"><i class="fa-solid fa-file-import"></i> Import a plan</button>
          </div>
          ${this.#error ? `<p class="as-pv-error">${esc(this.#error)}</p>` : ""}
        </div>`;
      return el;
    }
    const r = this.#result;
    const feats = this.#features();
    const [MW, MH] = r?.squares ?? this.#plan?.size?.squares ?? [1, 1];
    const fs = Math.max(MW, MH) / 55;
    const shapes = feats.filter((f) => f.poly.length >= 3).map((f) => {
      const [cx, cy] = centroid(f.poly);
      return `<g class="as-pv-shape as-${f.type} ${f.id === this.#selected ? "as-selected" : ""}" data-id="${esc(f.id)}">
          <polygon points="${f.poly.map((p) => p.join(",")).join(" ")}" vector-effect="non-scaling-stroke"></polygon>
          <text x="${cx}" y="${cy}" data-fs="${fs}">${esc(f.name ?? f.id)}</text></g>`;
    }).join("");
    const every = r ? handlesOf(this.#plan) : [];
    this.#corners = every.filter((h) => h.kind === "corner");
    // A feature that's gone (deleted, or undone away) is no longer picked or shown
    if (this.#selected && !featureOf(this.#plan, this.#selected)) this.#selected = null;
    if (this.#inspect && this.#inspect !== "@plan" && !featureOf(this.#plan, this.#inspect)) this.#inspect = null;
    const minor = this.#minor().map((f) => `<g class="as-pv-shape as-minor as-${f.type} ${f.id === this.#selected ? "as-selected" : ""}" data-id="${esc(f.id)}"><polygon points="${f.poly.map((p) => p.join(",")).join(" ")}" vector-effect="non-scaling-stroke"></polygon></g>`).join("");
    const points = this.#points().map((p) => `<circle class="as-pv-shape as-point as-${p.type} ${p.id === this.#selected ? "as-selected" : ""}" data-id="${esc(p.id)}" cx="${p.at[0]}" cy="${p.at[1]}" r="${fs * 0.35}"></circle>`).join("");
    this.#handles = every.filter((h) => this.#shapes || h.id === this.#selected);
    const handles = this.#handles.map((h, n) => `<circle class="as-pv-handle as-${h.kind}" data-h="${n}" data-id="${esc(h.id)}" cx="${h.at[0]}" cy="${h.at[1]}" r="0.3"></circle>`).join("");
    const lines = this.#paths().map((p) => `<g class="as-pv-shape as-path as-${p.type} ${p.id === this.#selected ? "as-selected" : ""}" data-id="${esc(p.id)}"><polyline points="${p.pts.map((q) => q.join(",")).join(" ")}" vector-effect="non-scaling-stroke"></polyline></g>`).join("");
    const labels = (r?.labels ?? []).filter((l) => Array.isArray(l.at)).map((l) => `<text class="as-pv-label ${l.id === this.#selected ? "as-selected" : ""}" data-id="${esc(l.id)}" x="${l.at[0]}" y="${l.at[1]}" data-fs="${fs * 0.85}">${esc(l.text)}</text>`).join("");
    const map = r
      ? `<div class="as-pv-stage" style="width:${r.width}px;height:${r.height}px">
          <img src="${this.#url}" width="${r.width}" height="${r.height}" alt="" draggable="false">
          <svg class="as-pv-overlay ${this.#outlines ? "" : "as-off"} ${this.#shapes ? "as-shapes" : ""}" viewBox="0 0 ${MW} ${MH}" preserveAspectRatio="none">${shapes}${minor}${lines}${points}${labels}${this.#tool ? "" : handles}<g class="as-pv-draft"></g></svg>
        </div>`
      : "";
    const rows = feats.map((f) => `<li data-id="${esc(f.id)}" class="${f.locked ? "as-locked" : ""} ${f.id === this.#selected ? "as-selected" : ""}" data-tooltip="Click for its settings and to reshape it">
        <span class="as-pv-name"><strong>${esc(f.name ?? f.id)}</strong><em>${esc(f.type === "district" ? `${f.kind} district` : f.kind)}</em></span>
        <button type="button" data-action="asReroll" data-id="${esc(f.id)}" data-tooltip="Reroll" ${f.locked || this.#working ? "disabled" : ""}><i class="fa-solid fa-dice"></i></button>
        <button type="button" data-action="asLock" data-id="${esc(f.id)}" data-tooltip="${f.locked ? "Locked: rerolls leave it alone. Click to unlock." : "Lock, so rerolls leave it alone"}" class="${f.locked ? "as-on" : ""}" ${this.#working ? "disabled" : ""}><i class="fa-solid ${f.locked ? "fa-lock" : "fa-lock-open"}"></i></button>
      </li>`).join("");
    const notes = (r?.notes ?? []);
    const time = r ? `${r.squares[0]} by ${r.squares[1]} squares, drawn in ${(r.ms / 1000).toFixed(1)} s` : "";
    const problems = this.#host.check(this.#plan).problems;
    const scene = this.#sceneFor();
    const file = this.#path ? this.#path.split("/").pop() : null;
    const status = this.dirty ? (file ? `Unsaved changes to ${file}` : "Not saved yet") : file ? `Saved as ${file}` : "";
    el.innerHTML = `
      <div class="as-pv-map ${this.#busy ? "as-busy" : ""} ${this.#stale ? "as-stale" : ""} ${this.#tool ? "as-drawing" : ""}">
        ${map}
        <div class="as-pv-wait"><i class="fa-solid fa-spinner fa-spin"></i> Drawing</div>
        ${this.#error ? `<p class="as-pv-error">${esc(this.#error)}</p>` : ""}
      </div>
      <aside class="as-pv-side">
        <header>
          <h3>${esc(this.#plan?.name ?? this.#plan?.id ?? "Plan")}${this.dirty ? ` <span class="as-pv-dirty" data-tooltip="Unsaved changes">*</span>` : ""}</h3>
          <p class="as-pv-hint">${esc(time)}</p>
          <p class="as-pv-hint">${esc(status)}</p>
        </header>
        <div class="as-pv-tools as-pv-file">
          <button type="button" data-action="asQuick" data-tooltip="Quick Start: a new plan from a few choices" ${this.#working ? "disabled" : ""}><i class="fa-solid fa-wand-magic-sparkles"></i></button>
          <button type="button" data-action="asOpen" data-tooltip="Open a saved plan" ${this.#working ? "disabled" : ""}><i class="fa-solid fa-folder-open"></i></button>
          <button type="button" data-action="asImport" data-tooltip="Import a plan (JSON, or a mapplan block)" ${this.#working ? "disabled" : ""}><i class="fa-solid fa-file-import"></i></button>
          <button type="button" data-action="asSave" data-tooltip="Save the plan in this world" class="${this.dirty ? "as-on" : ""}"><i class="fa-solid fa-floppy-disk"></i></button>
          <button type="button" data-action="asExport" data-tooltip="Download the plan as a file"><i class="fa-solid fa-file-export"></i></button>
          <button type="button" data-action="asCopy" data-tooltip="Copy the plan as JSON"><i class="fa-solid fa-copy"></i></button>
          <button type="button" data-action="asPlan" data-tooltip="Plan settings: name, season, size, the scene" class="${this.#inspect === "@plan" ? "as-on" : ""}"><i class="fa-solid fa-gear"></i></button>
        </div>
        ${problems.length ? `<details class="as-pv-problems"><summary><i class="fa-solid fa-triangle-exclamation"></i> ${problems.length} problem${problems.length === 1 ? "" : "s"} in the plan</summary><ul>${problems.map((p) => `<li class="as-${p.level}">${esc(p.message)}</li>`).join("")}</ul></details>` : ""}
        <div class="as-pv-tools">
          <button type="button" data-action="asDraw" class="${this.#palette ? "as-on" : ""}" data-tooltip="Draw a new district, area, road, river, wall, bridge, prop or label" ${this.#working ? "disabled" : ""}><i class="fa-solid fa-pen"></i> Draw</button>
          <button type="button" data-action="asRerollAll" ${this.#working ? "disabled" : ""}><i class="fa-solid fa-dice"></i> Reroll all</button>
          <button type="button" data-action="asUndo" ${this.#history.length && !this.#working ? "" : "disabled"} data-tooltip="Back to the plan before the last change"><i class="fa-solid fa-rotate-left"></i> Undo</button>
        </div>
        ${this.#palette ? paletteHTML(this.#tool?.id ?? null, { points: this.#tool?.points.length ?? 0, working: this.#working })
          : this.#inspect === "@plan" ? planHTML(this.#plan, { working: this.#working })
          : this.#inspect ? featureHTML(this.#plan, this.#inspect, { working: this.#working })
          : `<ul class="as-pv-list">${rows || `<li class="as-pv-hint">This plan has no districts or areas to reroll.</li>`}</ul>`}
        ${notes.length ? `<details class="as-pv-notes"><summary>${notes.length} note${notes.length === 1 ? "" : "s"}</summary><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></details>` : ""}
        <div class="as-pv-tools">
          <button type="button" data-action="asOutlines" class="${this.#outlines ? "as-on" : ""}"><i class="fa-solid fa-draw-polygon"></i> Outlines</button>
          <button type="button" data-action="asShapes" class="${this.#shapes ? "as-on" : ""}" data-tooltip="Drag corners to reshape districts and areas; drag a side's middle dot to add a corner; alt-click or right-click a corner to remove it" ${this.#busy ? "disabled" : ""}><i class="fa-solid fa-vector-square"></i> Shapes</button>
          <button type="button" data-action="asFit" data-tooltip="Fit the map to the window (or double-click it)"><i class="fa-solid fa-expand"></i> Fit</button>
        </div>
        <div class="as-pv-tools as-pv-scene">
          <button type="button" data-action="asScene" class="as-primary" ${this.#working ? "disabled" : ""} data-tooltip="${scene ? "Paint the map with your art and update the scene made from this plan (it's backed up first)" : "Paint the map with your art and make it a scene"}"><i class="fa-solid fa-image"></i> ${this.#publishing ? "Painting..." : scene ? "Update scene" : "Make scene"}</button>
          ${this.#publishing ? `<button type="button" data-action="asCancel" data-tooltip="Stop painting (no scene is made or changed)"><i class="fa-solid fa-xmark"></i> Cancel</button>` : ""}
          ${scene && !this.#publishing ? `<button type="button" data-action="asView" data-tooltip="Go to the scene"><i class="fa-solid fa-eye"></i></button>` : ""}
        </div>
        <p class="as-pv-hint">${esc(this.#hint())}</p>
      </aside>`;
    return el;
  }

  _replaceHTML(result, content) {
    const top = content.querySelector(".as-pv-list")?.scrollTop ?? 0;
    // The inspector as it was: where it was scrolled, which sections were open, which setting had focus
    const insp = content.querySelector(".as-pv-insp");
    const was = insp && {
      id: insp.dataset.id,
      top: insp.querySelector(".as-pv-fields")?.scrollTop ?? 0,
      open: [...insp.querySelectorAll("details")].map((d) => d.open),
      focus: document.activeElement?.closest?.(".as-pv-insp [data-field]")?.dataset.field ?? null,
      value: document.activeElement?.matches?.("input[type=text], input[type=number]") ? document.activeElement.value : null,
    };
    content.replaceChildren(result);
    const list = content.querySelector(".as-pv-list");
    if (list) list.scrollTop = top;
    const now = content.querySelector(".as-pv-insp");
    if (was && now && now.dataset.id === was.id) {
      [...now.querySelectorAll("details")].forEach((d, i) => { if (was.open[i]) d.open = true; });
      const fields = now.querySelector(".as-pv-fields");
      if (fields) fields.scrollTop = was.top;
      if (was.focus) {
        const el = now.querySelector(`[data-field="${CSS.escape(was.focus)}"]`);
        const input = el?.matches("input, select") ? el : el?.querySelector("input");
        if (input && !input.disabled) {
          input.focus({ preventScroll: true });
          // Something typed while the map redrew is kept, not wiped by the redraw
          if (was.value !== null && input.matches("input[type=text], input[type=number]") && input.value !== was.value) input.value = was.value;
        }
      }
    }
    this.#applyView();
    this.#drawDraft();
    requestAnimationFrame(() => this.#applyView()); // the first time, the window has its size only after layout
  }

  _onFirstRender() {
    const el = this.element;
    el.addEventListener("wheel", (ev) => {
      const box = ev.target.closest?.(".as-pv-map");
      if (!box || !this.#result) return;
      ev.preventDefault();
      const v = this.#currentView();
      const rect = box.getBoundingClientRect();
      const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      const k = Math.min(Math.max(8, v.fit * 4), Math.max(v.fit * 0.5, v.k * Math.exp(-ev.deltaY * 0.0015)));
      this.#view = { k, tx: mx - ((mx - v.tx) * k) / v.k, ty: my - ((my - v.ty) * k) / v.k };
      this.#applyView();
    }, { passive: false });
    const stop = () => {
      this.#drag = null;
      el.querySelector(".as-pv-map")?.classList.remove("as-dragging");
    };
    el.addEventListener("pointerdown", (ev) => {
      const box = ev.target.closest?.(".as-pv-map");
      if (!box || !this.#result) return;
      const handle = ev.target.closest?.(".as-pv-handle");
      if (this.#tool && ev.button === 0) this.#tool.down = { x: ev.clientX, y: ev.clientY, at: this.#toSquares(ev) };
      if (handle && !this.#working && !this.#tool) {
        const h = this.#handles[Number(handle.dataset.h)];
        if (!h) return;
        ev.stopPropagation();
        if (h.kind === "corner" && (ev.button === 2 || ev.altKey)) return this.#reshape(removeCorner(this.#plan, h.id, h.i));
        if (ev.button !== 0) return;
        this.#edit = { h, partners: h.kind === "corner" ? partnersOf(this.#plan, h.id, h.i) : [], plan: this.#plan, x: ev.clientX, y: ev.clientY, moved: false, next: null };
        box.setPointerCapture(ev.pointerId);
        return;
      }
      if (ev.button !== 0) return;
      const v = this.#currentView();
      this.#drag = { x: ev.clientX, y: ev.clientY, tx: v.tx, ty: v.ty, k: v.k };
      box.setPointerCapture(ev.pointerId);
      box.classList.add("as-dragging");
    });
    el.addEventListener("pointermove", (ev) => {
      if (this.#edit) return this.#editMove(ev);
      if (this.#tool && this.#result && ev.target.closest?.(".as-pv-map")) {
        const t = this.#tool, geo = toolOf(t.id).geometry;
        // A drag from an empty start makes a box (a shape or a building); otherwise it moves the map
        if (t.down && ev.buttons === 1 && (geo === "shape" || geo === "box") && !t.points.length && (t.box || Math.hypot(ev.clientX - t.down.x, ev.clientY - t.down.y) >= 4)) {
          t.box = [...t.down.at, ...this.#toSquares(ev)];
          this.#drag = null;
          this.element.querySelector(".as-pv-map")?.classList.remove("as-dragging");
          return this.#drawDraft();
        }
        this.#cursor(ev);
      }
      if (!this.#drag) return;
      if (ev.buttons === 0) return stop(); // released where we couldn't see it (the map was redrawn mid-drag)
      const d = this.#drag;
      this.#view = { k: d.k, tx: d.tx + ev.clientX - d.x, ty: d.ty + ev.clientY - d.y };
      this.#applyView();
    });
    el.addEventListener("pointerup", (ev) => {
      if (this.#edit) return this.#editEnd(ev);
      if (this.#tool) {
        const t = this.#tool, d = this.#drag, down = t.down;
        t.down = null;
        if (t.box) { stop(); return this.#finish(); }
        const click = down && d && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 4 && ev.target.closest?.(".as-pv-map");
        // The second click of a double-click finishes a shape or a line (its first click already placed the point)
        if (click && ev.detail >= 2 && t.points.length && toolOf(t.id).geometry !== "point" && toolOf(t.id).geometry !== "box") { stop(); return this.#finish(); }
        if (click) this.#toolClick(ev);
        stop();
        return;
      }
      // A press that didn't move is a click: pick the district or area under it (or none)
      const d = this.#drag;
      if (d && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 4 && ev.target.closest?.(".as-pv-map")) this.#pick(ev);
      stop();
    });
    // Clicking a district's or area's name in the list picks it too
    el.addEventListener("click", (ev) => {
      const li = ev.target.closest?.(".as-pv-list li[data-id]");
      if (!li || ev.target.closest("button")) return;
      this.#select(this.#selected === li.dataset.id ? null : li.dataset.id);
    });
    // A setting changed in the inspector: applied at once, and the map redrawn
    el.addEventListener("change", (ev) => {
      const box = ev.target.closest?.(".as-pv-insp [data-field]");
      if (!box || !this.#plan) return;
      const id = box.closest(".as-pv-insp").dataset.id, field = box.dataset.field;
      // A number box with text it can't read ("-", "1e") reports itself as empty: that's not a request to clear it
      if (box.validity?.badInput) {
        this.#error = `${box.closest(".as-pv-field")?.querySelector("label")?.textContent ?? field} should be a number. Nothing was changed.`;
        return this.#working ? undefined : this.render();
      }
      const value = readInput(box);
      if (this.#publishing || this.#saving) return this.render(); // put the input back: nothing changes while a scene is made
      this.#apply((plan) => (id === "@plan" ? setPlanField(plan, field, value) : setField(plan, id, field, value)));
    });
    el.addEventListener("pointercancel", () => {
      if (this.#edit) { this.#edit = null; this.render(); } // put the outline back
      stop();
    });
    el.addEventListener("lostpointercapture", () => { if (!this.#edit) stop(); });
    el.addEventListener("contextmenu", (ev) => { if (ev.target.closest?.(".as-pv-handle")) ev.preventDefault(); });
    el.addEventListener("dblclick", (ev) => {
      if (!ev.target.closest?.(".as-pv-map")) return;
      if (this.#tool) return this.#finish();
      if (Date.now() - this.#finishedAt < 800) return; // the double-click that finished a drawing
      this.#view = null;
      this.#applyView();
    });
    // Hovering a row lights its outline, and hovering an outline lights its row
    el.addEventListener("pointerover", (ev) => this.#hover(ev.target.closest?.("[data-id]")?.dataset.id ?? null));
    el.addEventListener("pointerleave", () => this.#hover(null));
    // Keep a fitted map fitted as the window is resized
    this.#resize = new ResizeObserver(() => {
      if (!this.#view) this.#applyView();
    });
    this.#resize.observe(el);
  }

  _onClose() {
    this.#endTool();
    this.#palette = false;
    this.#resize?.disconnect();
    this.#resize = null;
    if (this.#url) URL.revokeObjectURL(this.#url);
    this.#url = null;
    this.#result = null;
  }

  /** What the hint under the tools says: how to reshape, given what's picked. */
  #hint() {
    if (this.#selected) {
      const has = this.#handles.some((h) => h.id === this.#selected);
      if (has && this.#handles.some((h) => h.id === this.#selected && h.path))
        return `Drag ${this.#selected}'s points to move it (the dot in a stretch's middle adds a point; right-click a point to remove it). It's drawn as a smooth curve through them. Click elsewhere to finish.`;
      if (has) return `Drag ${this.#selected}'s corners to reshape it (the dot in a side's middle adds a corner; right-click a corner to remove it). Click elsewhere to finish.`;
      const f = featureOf(this.#plan, this.#selected);
      return (f?.type === "district" || f?.type === "area") && Number(f.rot)
        ? `${this.#selected} is turned (it has a rot), and can't be reshaped here yet. Its settings are in the panel.`
        : `${this.#selected}'s settings are in the panel. Click elsewhere to finish.`;
    }
    if (this.#shapes) return "Drag a corner or a road's point to reshape; points shared by two districts or two roads move together. A turned area can't be reshaped here yet.";
    return "A quick sketch in plain colours. Click anything to see its settings and reshape it; scroll to zoom, drag to move.";
  }

  /**
   * Picks what's under a click: a bridge, ford or prop first, then a label, then a road, river or wall, then the
   * smallest shape there (a building, square, pond, wood or district), so a wood inside a district can be picked.
   */
  #pick(ev) {
    if (!this.#result || this.#working) return;
    const at = this.#toSquares(ev);
    const r = this.#result;
    const px = (r.width / r.squares[0]) * this.#currentView().k;
    // Within the drawn circle (it scales with the map) or 10 pixels of it, whichever is more
    const [MW, MH] = r.squares;
    let point = null, pointD = Math.max(10 / px, (Math.max(MW, MH) / 55) * 0.35);
    for (const p of this.#points()) {
      const d = Math.hypot(p.at[0] - at[0], p.at[1] - at[1]);
      if (d <= pointD) { pointD = d; point = p.id; }
    }
    if (point) return this.#select(point);
    // A label, by the box its text takes
    const near = 8 / px; // at least 8 pixels round the text, however far out the map is zoomed
    const label = this.#labelBoxes().find((l) => Math.abs(at[0] - l.at[0]) <= Math.max(l.hw, near) && Math.abs(at[1] - l.at[1]) <= Math.max(l.hh, near));
    if (label) return this.#select(label.id);
    // A road, river or wall under the click (within its width, and at least 8 pixels) wins over the area round it
    let road = null, roadD = Infinity;
    for (const p of this.#paths()) {
      const d = distanceToPath(at, p.pts);
      if (d <= Math.max(p.half, 8 / px) && d < roadD) { roadD = d; road = p.id; }
    }
    if (road) return this.#select(road);
    let best = null, bestArea = Infinity;
    for (const f of [...this.#features(), ...this.#minor()]) {
      if (f.poly.length < 3 || !pointInPolygon(at, f.poly)) continue;
      const area = Math.abs(f.poly.reduce((a, p, i) => { const q = f.poly[(i + 1) % f.poly.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
      if (area < bestArea) { bestArea = area; best = f.id; }
    }
    this.#select(best);
  }

  /** Picks a feature (or none): its handles show and its settings open in the side panel. */
  #select(id) {
    if (id === this.#selected && (id === null || this.#inspect === id) && !this.#palette) return;
    this.#palette = false;
    this.#selected = id;
    this.#inspect = id;
    this.render();
  }

  #hover(id) {
    for (const n of this.element?.querySelectorAll(".as-hover") ?? []) n.classList.remove("as-hover");
    if (!id) return;
    const sel = CSS.escape(id);
    for (const n of this.element.querySelectorAll(`.as-pv-shape[data-id="${sel}"], .as-pv-list li[data-id="${sel}"]`)) n.classList.add("as-hover");
  }

  /** The zoom and pan now: the one set by the user, or the one that fits the map in the window. */
  #currentView() {
    const box = this.element?.querySelector(".as-pv-map");
    const r = this.#result;
    if (!box || !r) return { k: 1, tx: 0, ty: 0, fit: 1 };
    const fit = Math.min(box.clientWidth / r.width, box.clientHeight / r.height) || 1;
    if (this.#view) return { ...this.#view, fit };
    return { k: fit, tx: (box.clientWidth - r.width * fit) / 2, ty: (box.clientHeight - r.height * fit) / 2, fit };
  }

  #applyView() {
    const stage = this.element?.querySelector(".as-pv-stage");
    if (!stage) return;
    const { k, tx, ty, fit } = this.#currentView();
    stage.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
    // Names grow only a little as the map is zoomed, so they don't cover it close up
    const grow = Math.pow(fit / k, 0.8);
    for (const t of stage.querySelectorAll("text[data-fs]")) t.setAttribute("font-size", Number(t.dataset.fs) * grow);
    // Handles stay the same size on screen
    const r = this.#result;
    if (r) {
      const px = (r.width / r.squares[0]) * k; // screen pixels a square
      for (const c of stage.querySelectorAll(".as-pv-handle")) c.setAttribute("r", (c.classList.contains("as-mid") ? 4 : 6) / px);
    }
  }

  /** Squares under a pointer. */
  #toSquares(ev) {
    const box = this.element.querySelector(".as-pv-map");
    const r = this.#result;
    const { k, tx, ty } = this.#currentView();
    const rect = box.getBoundingClientRect();
    const f = r.squares[0] / r.width;
    return [((ev.clientX - rect.left - tx) / k) * f, ((ev.clientY - rect.top - ty) / k) * f];
  }

  /** A handle being dragged: the outline follows, and a corner dropped near another corner snaps to it. */
  #editMove(ev) {
    const e = this.#edit;
    if (ev.buttons === 0) { this.#edit = null; this.render(); return; } // let go where we couldn't see it: put it back
    if (!e.moved && Math.hypot(ev.clientX - e.x, ev.clientY - e.y) < 3) return;
    e.moved = true;
    let to = this.#toSquares(ev);
    const r = this.#result;
    const [MW, MH] = r.squares;
    to = [Math.max(0, Math.min(MW, to[0])), Math.max(0, Math.min(MH, to[1]))];
    let snapped = false;
    if (e.h.kind === "corner" || e.h.kind === "mid") {
      const px = (r.width / MW) * this.#currentView().k;
      // Snap only onto other shapes' corners, never this shape's own (that would fold it) or the ones moving with it
      const moving = new Set([e.h.id, ...e.partners.map((p) => p.id)]);
      let best = null, bestD = 10 / px; // within 10 screen pixels
      for (const o of this.#corners) {
        if (moving.has(o.id) || !!o.path !== !!e.h.path) continue; // roads snap to roads, districts to districts
        const d = Math.hypot(o.at[0] - to[0], o.at[1] - to[1]);
        if (d < bestD) { bestD = d; best = o.at; }
      }
      if (best) { to = [...best]; snapped = true; }
    }
    e.next = moveHandle(e.plan, e.h, to, e.partners, { exact: snapped });
    // Redraw the outlines that moved, and the handle, without redrawing the map
    const ids = new Set([e.h.id, ...e.partners.map((p) => p.id)]);
    const plan = normalize(e.next);
    for (const f of plan.features) {
      if (!ids.has(f.id)) continue;
      if (Array.isArray(f.path)) {
        this.element.querySelector(`.as-pv-shape[data-id="${CSS.escape(f.id)}"] polyline`)?.setAttribute("points", f.path.map((p) => p.join(",")).join(" "));
        continue;
      }
      let poly = [];
      try { poly = shapeToPolygon(f.shape) ?? []; } catch { poly = []; }
      this.element.querySelector(`.as-pv-shape[data-id="${CSS.escape(f.id)}"] polygon`)?.setAttribute("points", poly.map((p) => p.join(",")).join(" "));
    }
    const c = this.element.querySelector(`.as-pv-handle[data-h="${this.#handles.indexOf(e.h)}"]`);
    c?.setAttribute("cx", to[0]); c?.setAttribute("cy", to[1]);
  }

  /** A handle let go: the reshaped plan is drawn (a click that didn't move does nothing). */
  #editEnd() {
    const e = this.#edit;
    this.#edit = null;
    if (!e?.moved || !e.next) return;
    if (e.plan !== this.#plan) return this.render(); // the plan was replaced mid-drag: drop the drag
    return this.#reshape(e.next);
  }

  /** Keeps a reshaped plan and draws it, unless a shape it changed would cross itself (then it says so). */
  #reshape(next) {
    const geo = (f) => JSON.stringify([f.shape, f.path, f.at]); // a district's shape, a road's path, a bridge's place
    const before = new Map((this.#plan.features ?? []).map((f) => [f.id, geo(f)]));
    const changed = (next.features ?? []).filter((f) => before.get(f.id) !== geo(f));
    if (!changed.length) return this.render();
    const problem = changed.map((f) => shapeProblem(next, f.id)).find(Boolean);
    if (problem) {
      this.#error = `${problem} Nothing was changed.`;
      return this.render();
    }
    this.#error = null;
    return this.#change(next);
  }

  /** Keeps the plan as it is now for Undo (the last 50). */
  #remember() {
    this.#history.push(this.#plan);
    if (this.#history.length > 50) this.#history.shift();
  }

  /** Changes the plan (keeping the old one for Undo) and draws it again. */
  async #change(plan) {
    this.#remember();
    this.#plan = plan;
    const result = await this.#draw();
    // If it couldn't be drawn, take the change back, so the plan always matches the picture (the error stays up)
    if (!result && this.rendered && this.#result) {
      this.#plan = this.#history.pop();
      this.#stale = false;
      this.#error = `${this.#error ?? "It couldn't be drawn."} Nothing was changed.`;
      await this.render();
    }
    return result;
  }

  static async #onReroll(event, target) {
    if (this.#working) return;
    const { plan, rerolled } = rerollPlan(this.#plan, target.dataset.id);
    if (rerolled.length) await this.#change(plan);
  }

  static async #onRerollAll() {
    if (this.#working) return;
    const { plan, rerolled } = rerollPlan(this.#plan);
    if (rerolled.length) await this.#change(plan);
    else ui.notifications.info("AtlasScribe: everything is locked, so there's nothing to reroll.");
  }

  static async #onLock(event, target) {
    if (this.#working) return;
    const id = target.dataset.id;
    const on = !(Array.isArray(this.#plan?.locked) && this.#plan.locked.includes(id));
    this.#remember();
    this.#plan = setLocked(this.#plan, id, on);
    this.render(); // locking changes nothing on the map
  }

  static async #onUndo() {
    if (this.#working || !this.#history.length) return;
    const before = this.#history.pop();
    const map = (p) => JSON.stringify({ ...p, locked: null }); // everything but the locks changes the map
    const sameMap = map(before) === map(this.#plan);
    this.#plan = before;
    if (sameMap) this.render();
    else await this.#draw();
  }

  /** The scene this plan was made into last, if any. */
  /**
   * Applies an inspector change ((plan) => { plan } | { error }) and redraws; while the map is drawing it waits its
   * turn, so a change made then isn't lost. An error leaves the plan as it was.
   */
  async #apply(op) {
    this.#queue.push(op);
    if (!this.#working) await this.#flush();
  }

  /** Applies every waiting inspector change as one step (one Undo), then redraws once. */
  async #flush() {
    if (this.#working || !this.#queue.length || !this.#plan) return;
    const ops = this.#queue;
    this.#queue = [];
    let plan = this.#plan;
    const errors = [];
    for (const op of ops) {
      const res = op(plan);
      if (res.error) errors.push(res.error);
      else plan = res.plan;
    }
    this.#error = errors.length ? `${errors.join(" ")} Nothing else was changed by ${errors.length === 1 ? "it" : "them"}.` : null;
    if (canon(plan) === canon(this.#plan)) return this.render();
    const err = this.#error;
    await this.#change(plan);
    if (err && !this.#error) { this.#error = err; this.render(); }
  }

  /** Back from the inspector to the list (nothing is picked). */
  static #onBack() {
    this.#endTool();
    this.#palette = false;
    this.#inspect = null;
    this.#selected = null;
    this.render();
  }

  /** A setting back to its default: left out of the plan. */
  static async #onReset(event, target) {
    const id = target.closest(".as-pv-insp")?.dataset.id, field = target.dataset.field;
    if (id) await this.#apply((plan) => (id === "@plan" ? setPlanField(plan, field, undefined) : setField(plan, id, field, undefined)));
  }

  /** Takes a feature out of the plan (its seed and lock too); Undo brings it back. */
  static async #onDelete(event, target) {
    if (this.#publishing || this.#saving || !this.#plan) return;
    const id = target.dataset.id;
    if (!featureOf(this.#plan, id)) return;
    this.#selected = null;
    this.#inspect = null;
    await this.#apply((plan) => (featureOf(plan, id) ? { plan: deleteFeature(plan, id) } : { error: `"${id}" is already gone.` }));
  }

  /** The plan's own settings in the side panel (again to close them). */
  static #onPlan() {
    this.#endTool();
    this.#palette = false;
    this.#inspect = this.#inspect === "@plan" ? null : "@plan";
    if (this.#inspect) this.#selected = null;
    this.render();
  }

  /** How near a click must be to snap, in squares (10 pixels at the zoom now). */
  #tolerance() {
    const r = this.#result;
    return r ? 10 / ((r.width / r.squares[0]) * this.#currentView().k) : 0.5;
  }

  /** Where a click with the current tool lands, snapped: { at, kind }. */
  #snapped(at) {
    const t = this.#tool, make = toolOf(t.id).make, geo = toolOf(t.id).geometry;
    if (geo === "shape") return snapCorner(this.#plan, at, this.#tolerance());
    if (geo === "path") return snapEnd(this.#plan, make.type, at, this.#tolerance());
    return { at: [Math.round(at[0] * 10) / 10, Math.round(at[1] * 10) / 10], kind: null };
  }

  /** The cursor while drawing: where the next point would land, shown on the draft. */
  #cursor(ev) {
    if (!this.#tool) return;
    const s = this.#snapped(this.#toSquares(ev));
    this.#tool.cursor = s.at;
    this.#tool.snap = s.kind;
    this.#drawDraft();
  }

  /** A click while drawing: a point tool places its feature; others add a point (a shape closes on its first corner). */
  #toolClick(ev) {
    const t = this.#tool;
    if (!t || this.#working) return;
    const tool = toolOf(t.id);
    const { at } = this.#snapped(this.#toSquares(ev));
    if (tool.geometry === "point" || tool.geometry === "box") {
      t.points = [at];
      return this.#finish();
    }
    if (tool.geometry === "shape" && t.points.length >= 3 && Math.hypot(at[0] - t.points[0][0], at[1] - t.points[0][1]) <= this.#tolerance()) return this.#finish();
    t.points.push(at);
    // Only the drawing and the palette's count change: a full render would replace the map under the pointer, and
    // the browser would then send no double-click
    if (this.#error) { this.#error = null; this.element.querySelector(".as-pv-map > .as-pv-error")?.remove(); }
    this.#refreshPalette();
    this.#drawDraft();
  }

  /** The palette's count of points and its Finish button, brought up to date without a render. */
  #refreshPalette() {
    const t = this.#tool;
    const how = this.element?.querySelector(".as-pv-how");
    if (!t || !how) return;
    const tool = toolOf(t.id);
    how.textContent = howText(tool, t.points.length);
    const fin = this.element.querySelector('[data-action="asFinish"]');
    if (fin) fin.disabled = t.points.length < (tool.geometry === "path" ? 2 : 3) || this.#working;
  }

  /** Makes the feature drawn and opens its settings; a drawing that can't be kept says why and carries on. */
  async #finish() {
    const t = this.#tool;
    if (!t) return;
    if (this.#working) { t.box = null; return this.#drawDraft(); } // a box let go while the map draws is dropped, not kept for later
    // A box's two corners snap as a shape's corners do
    const box = t.box && [...this.#snapped(t.box.slice(0, 2)).at, ...this.#snapped(t.box.slice(2)).at];
    const res = addFeature(this.#plan, t.id, box ? { box } : { points: t.points });
    if (res.error) {
      t.box = null;
      this.#error = `${res.error} Nothing was added.`;
      return this.render();
    }
    const kept = { id: t.id, points: t.points };
    this.#endTool();
    this.#palette = false;
    this.#error = null;
    this.#selected = res.id;
    this.#inspect = res.id;
    this.#finishedAt = Date.now();
    const drawn = await this.#change(res.plan);
    // It couldn't be drawn (the change was taken back): the drawing comes back too, to fix or cancel
    if (!drawn && this.rendered) {
      this.#selected = this.#inspect = null;
      this.#palette = true;
      this.#startTool(kept.id);
      this.#tool.points = kept.points;
      this.render();
    }
  }

  /** Starts drawing with a tool, listening for Enter (finish), Esc (cancel) and Backspace (the last point off). */
  #startTool(id) {
    this.#endTool();
    this.#tool = { id, points: [], box: null, cursor: null, snap: null, down: null };
    this.#selected = null;
    this.#keys = (ev) => {
      // Only keys meant for the window: not typing anywhere (a text box, a rich editor such as chat or a journal),
      // not another window or dialog, and not while this one is minimized
      const target = ev.target;
      if (!this.#tool || this.minimized || target?.isContentEditable || target?.closest?.("input, select, textarea, [contenteditable]")) return;
      if (target !== document.body && !this.element?.contains(target)) return;
      if (ev.key === "Enter") this.#finish();
      else if (ev.key === "Escape") { this.#endTool(); this.render(); }
      else if (ev.key === "Backspace" || ev.key === "Delete") { this.#tool.points.pop(); this.render(); }
      else return;
      ev.preventDefault();
      ev.stopImmediatePropagation(); // Foundry would close the window on Esc
    };
    window.addEventListener("keydown", this.#keys, true);
  }

  #endTool() {
    if (this.#keys) window.removeEventListener("keydown", this.#keys, true);
    this.#keys = null;
    this.#tool = null;
  }

  /** The drawing under way on the overlay: its points, the line to the cursor, a box, and a ring where it snaps. */
  #drawDraft() {
    const g = this.element?.querySelector(".as-pv-draft");
    if (!g) return;
    const t = this.#tool;
    if (!t) { g.innerHTML = ""; return; }
    const tool = toolOf(t.id);
    const [MW, MH] = this.#result?.squares ?? [1, 1];
    const r = Math.max(MW, MH) / 160;
    const pts = t.cursor && tool.geometry !== "point" ? [...t.points, t.cursor] : [...t.points];
    let html = "";
    if (t.box) {
      const [x0, y0, x1, y1] = t.box;
      html += `<rect x="${Math.min(x0, x1)}" y="${Math.min(y0, y1)}" width="${Math.abs(x1 - x0)}" height="${Math.abs(y1 - y0)}" vector-effect="non-scaling-stroke"></rect>`;
    } else if (pts.length >= 2) {
      const tag = tool.geometry === "shape" && pts.length >= 3 ? "polygon" : "polyline";
      html += `<${tag} points="${pts.map((p) => p.join(",")).join(" ")}" vector-effect="non-scaling-stroke"></${tag}>`;
    }
    for (const p of t.points) html += `<circle class="as-pv-draft-pt" cx="${p[0]}" cy="${p[1]}" r="${r}"></circle>`;
    if (t.cursor && !t.box) html += `<circle class="as-pv-draft-cursor ${t.snap ? "as-snap" : ""}" cx="${t.cursor[0]}" cy="${t.cursor[1]}" r="${r * (t.snap ? 1.8 : 1)}"></circle>`;
    g.innerHTML = html;
  }

  /** The drawing tools in the side panel (again to close them). */
  static #onDraw() {
    if (this.#palette) { this.#endTool(); this.#palette = false; }
    else { this.#palette = true; this.#inspect = null; this.#selected = null; }
    this.render();
  }

  /** Picks a tool (again to put it down). */
  static #onTool(event, target) {
    if (this.#working) return;
    if (this.#tool?.id === target.dataset.tool) this.#endTool();
    else this.#startTool(target.dataset.tool);
    this.#error = null;
    this.render();
  }

  static async #onFinish() {
    await this.#finish();
  }

  static #onStopTool() {
    this.#endTool();
    this.render();
  }

  #sceneFor() {
    const id = this.#plan?.id;
    if (!id) return null;
    const made = game.scenes.filter((sc) => sc.getFlag("atlas-scribe", "plan") === id);
    return made.sort((a, b) => (b.getFlag("atlas-scribe", "built") ?? 0) - (a.getFlag("atlas-scribe", "built") ?? 0))[0] ?? null;
  }

  /** True when there are no unsaved changes, or the GM says to drop them (for api.preview, which replaces the plan). */
  confirmDiscard() {
    return this.#mayDiscard();
  }

  /** True when there are no unsaved changes, or the GM says to drop them. */
  async #mayDiscard() {
    if (!this.dirty) return true;
    return foundry.applications.api.DialogV2.confirm({
      window: { title: "Unsaved changes" },
      content: `<p>${esc(this.#plan?.name ?? "This plan")} has changes that aren't saved. Drop them?</p>`,
      rejectClose: false,
    });
  }

  /** Quick Start: a few choices in a dialog, then a new plan in the window (not saved until Save). */
  static async #onQuick() {
    if (this.#working || !(await this.#mayDiscard())) return;
    const { QUICK, LABELS } = this.#host.quickChoices;
    const select = (key, title) => `<div class="form-group"><label>${title}</label><select name="${key}">${QUICK[key].map((v) => `<option value="${v}">${esc(LABELS[key]?.[v] ?? v)}</option>`).join("")}<option value="">Any (picked from the seed)</option></select></div>`;
    const seed = 1 + Math.floor(Math.random() * 999999); // only a starting point: the plan keeps it, so it draws the same every time
    const content = `<div class="atlas-scribe as-quick">
        <div class="form-group"><label>Name</label><input type="text" name="name" placeholder="Leave empty for a made-up name"></div>
        ${select("size", "Place")}${select("season", "Season")}${select("water", "Water")}${select("roads", "Roads")}${select("centre", "Centre")}${select("surroundings", "Around it")}
        <div class="form-group"><label>Seed</label><input type="number" name="seed" value="${seed}" min="1" step="1"></div>
        <p class="hint">Every choice can be rerolled, locked and reshaped afterwards.</p>
      </div>`;
    const chosen = await foundry.applications.api.DialogV2.wait({
      window: { title: "AtlasScribe: Quick Start", icon: "fa-solid fa-wand-magic-sparkles" },
      content,
      buttons: [
        { action: "make", label: "Make the plan", icon: "fa-solid fa-wand-magic-sparkles", default: true, callback: (event, button) => Object.fromEntries(new FormData(button.form)) },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    });
    if (!chosen || chosen === "cancel") return;
    const opts = { ...chosen, seed: Number(chosen.seed) || seed };
    for (const k of Object.keys(QUICK)) if (!opts[k]) delete opts[k];
    const { plan } = this.#host.quick(opts);
    await this.show(plan);
  }

  /** Open a plan saved in this world. */
  static async #onOpen() {
    if (this.#working || !(await this.#mayDiscard())) return;
    const plans = await this.#host.plans.list();
    if (!plans.length) return ui.notifications.info(`AtlasScribe: no plans are saved in ${this.#host.folder()} yet.`);
    const twice = new Set(plans.map((p) => p.name).filter((n, i, all) => all.indexOf(n) !== i)); // names saved more than once show their file
    const rows = plans.map((p, i) => `<option value="${i}" ${p.error ? "disabled" : ""}>${esc(p.name)}${twice.has(p.name) ? ` [${esc(p.file)}]` : ""}${p.size ? ` (${esc(p.size[0])} by ${esc(p.size[1])}${p.season ? `, ${esc(p.season)}` : ""})` : ""}${p.error ? " (can't be read)" : ""}</option>`).join("");
    const pick = await foundry.applications.api.DialogV2.wait({
      window: { title: "AtlasScribe: Open a plan", icon: "fa-solid fa-folder-open" },
      content: `<div class="atlas-scribe"><div class="form-group"><select name="plan" size="${Math.min(12, Math.max(4, plans.length))}" style="width:100%">${rows}</select></div><p class="hint">Plans saved in ${esc(this.#host.folder())}.</p></div>`,
      buttons: [
        { action: "open", label: "Open", icon: "fa-solid fa-folder-open", default: true, callback: (event, button) => button.form.elements.plan.value },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    });
    if (pick === null || pick === undefined || pick === "cancel" || pick === "") return; // closed, or nothing picked
    const chosen = plans[Number(pick)];
    if (!chosen) return;
    try {
      const plan = await this.#host.plans.load(chosen.path);
      // A plan with errors can't be drawn: say why, as Import does, rather than open a window that can't show it
      const errors = this.#host.check(plan).problems.filter((p) => p.level === "error");
      if (errors.length) return ui.notifications.error(`AtlasScribe: ${chosen.file} has ${errors.length} error(s): ${errors.map((e) => e.message).join(" ")}`, { permanent: true });
      await this.show(plan, null, { path: chosen.path, saved: true });
    } catch (e) {
      ui.notifications.error(e.message);
    }
  }

  /** Import a plan from pasted text or a file; one with errors is refused, with them listed. */
  static async #onImport() {
    if (this.#working || !(await this.#mayDiscard())) return;
    const text = await foundry.applications.api.DialogV2.wait({
      window: { title: "AtlasScribe: Import a plan", icon: "fa-solid fa-file-import" },
      content: `<div class="atlas-scribe as-import">
          <div class="form-group stacked"><label>Paste a plan (JSON, or text with a mapplan block)</label><textarea name="text" rows="10"></textarea></div>
          <div class="form-group"><label>Or a file</label><input type="file" name="file" accept=".json,.md,.txt"></div>
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
    if (!text || text === "cancel") return;
    const checked = this.#host.check(text);
    if (!checked.plan) return ui.notifications.error(checked.problems[0]?.message ?? "AtlasScribe: that isn't a plan.");
    const errors = checked.problems.filter((p) => p.level === "error");
    if (errors.length) return ui.notifications.error(`AtlasScribe: the plan has ${errors.length} error(s): ${errors.map((e) => e.message).join(" ")}`, { permanent: true });
    const { plan } = this.#host.read(text);
    await this.show(plan);
  }

  /** Saves the plan in this world, by its id; asks before writing over another plan's file. */
  static async #onSave() {
    await this.#save();
  }

  /** Saves the plan; resolves to true when it was saved. */
  async #save() {
    if (!this.#plan || this.#saving) return false;
    this.#withId();
    // What's saved is the plan as it is now: a reroll made while the dialog is up stays unsaved
    const json = canon(this.#plan);
    const plan = JSON.parse(json);
    const file = this.#host.plans.fileFor(plan.id);
    const path = `${this.#host.folder()}/${file}`;
    const same = (a, b) => !!a && !!b && decodeURIComponent(a).toLowerCase() === decodeURIComponent(b).toLowerCase();
    const mine = same(this.#path, path); // the very file it came from (the same name in another folder or world isn't)
    this.#saving = true;
    try {
      if (!mine && (await this.#host.plans.exists(file))) {
        const ok = await foundry.applications.api.DialogV2.confirm({
          window: { title: "Save over a plan" },
          content: `<p>A plan is already saved as ${esc(file)}. Save this one over it?</p>`,
          rejectClose: false,
        });
        if (!ok) return false;
      }
      const saved = await this.#host.plans.save(plan, file);
      this.#path = saved ?? path;
      this.#saved = json;
      this.#host.setLast(this.#path);
      ui.notifications.info(`AtlasScribe: saved ${plan.name ?? plan.id} as ${this.#path}.`);
      if (this.rendered) this.render();
      return true;
    } catch (e) {
      ui.notifications.error(e.message);
      return false;
    } finally {
      this.#saving = false;
    }
  }

  /** The plan, given an id from its name if it has none (a scene and a file need one). */
  #withId() {
    if (!this.#plan.id) {
      // From its name, with a short random tail, so two plans of the same name never share a file or a scene
      const id = `${String(this.#plan.name ?? "plan").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "plan"}-${Math.random().toString(36).slice(2, 6)}`;
      this.#plan = { ...this.#plan, id };
    }
    return this.#plan;
  }

  /** Downloads the plan as a JSON file. */
  static #onExport() {
    if (!this.#plan) return;
    const plan = this.#plan;
    foundry.utils.saveDataToFile(JSON.stringify(plan, null, 2), "application/json", this.#host.plans.fileFor(plan.id ?? plan.name));
  }

  /** Paints the map with the GM's art and makes it a scene, or updates the scene made from this plan before. */
  static async #onScene() {
    if (this.#working || !this.#plan) return;
    // A plan made into a scene is saved first, so the scene can always be updated from it later (if it isn't saved,
    // because the GM kept another plan's file, no scene is made)
    this.#withId(); // a plan read with no id gets one now and so is saved with it, so the scene can find its plan again
    if (this.dirty && !(await this.#save())) return;
    if (this.#working || !this.#plan) return;
    const plan = this.#withId();
    const scene = this.#sceneFor();
    this.#publishing = true;
    this.render();
    try {
      const res = await this.#host.publish(plan, { scene: scene?.id ?? null });
      const made = game.scenes.get(res?.scene?.sceneId);
      ui.notifications.info(`AtlasScribe: ${res?.scene?.created ? "made the scene" : "updated the scene"} ${made?.name ?? ""} in ${Math.round((res?.ms ?? 0) / 1000)} s.`);
      // Why the map looks as it does, when it isn't as asked: art that couldn't be had, settings the scene didn't take
      const why = [...(res?.artNotes ?? []), ...(res?.missingArt?.length ? [`${res.missingArt.length} kinds of art weren't found and are painted in plain colours (${res.missingArt.slice(0, 6).join(", ")}${res.missingArt.length > 6 ? ", ..." : ""}).`] : []), ...(res?.warnings ?? [])];
      if (why.length) ui.notifications.warn(`AtlasScribe: ${why.join(" ")}`, { permanent: true });
    } catch (e) {
      if (!e.cancelled) ui.notifications.error(e.message, { permanent: true });
    } finally {
      this.#publishing = false;
      if (this.rendered) this.render();
    }
  }

  /** Stops the painting under way (nothing is saved or changed). */
  static #onCancel() {
    if (this.#publishing) this.#host.cancel();
  }

  /** Goes to the scene made from this plan. */
  static #onView() {
    this.#sceneFor()?.view();
  }

  static async #onCopy() {
    if (!this.#plan) return;
    await game.clipboard.copyPlainText(JSON.stringify(this.#plan, null, 2));
    ui.notifications.info("AtlasScribe: the plan is on the clipboard.");
  }

  static #onOutlines() {
    this.#outlines = !this.#outlines;
    this.element.querySelector(".as-pv-overlay")?.classList.toggle("as-off", !this.#outlines);
    this.element.querySelector("[data-action='asOutlines']")?.classList.toggle("as-on", this.#outlines);
  }

  static #onShapes() {
    if (this.#busy) return;
    this.#shapes = !this.#shapes;
    if (this.#shapes) this.#outlines = true; // handles live on the outlines
    this.render();
  }

  static #onFit() {
    this.#view = null;
    this.#applyView();
  }
}
