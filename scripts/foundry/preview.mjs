/**
 * The AtlasScribe window: a plan laid out and drawn in plain colors in a second or so, its districts and areas
 * outlined, so a change can be judged before a full render; around it the plan's file (Quick Start, open, import,
 * save, export), its problems, rerolls, locks, undo, reshaping, drawing and the inspector, and making it a scene.
 */
import { rerollable, rerollPlan, setLocked } from "../core/seeds.mjs";
import { shapeToPolygon, pointInPolygon, distanceToPath } from "../core/geom.mjs";
import { normalize, LABEL_SIZES } from "../core/plan.mjs";
import { estimatePlots, BIG_PLOTS } from "../core/check.mjs";
import { labelsOf, moveLabel, turnLabel, linesOf, angleNear, wrapAngle } from "../core/labels.mjs";
import { handlesOf, partnersOf, moveHandle, removeCorner, shapeProblem } from "../core/reshape.mjs";
import { featureOf, setField, setPlanField, deleteFeature } from "../core/edit.mjs";
import { featureHTML, planHTML, paletteHTML, howText, readInput, generatedHTML, underlayHTML, battleHTML, battleSizeText, rerollButtons, kindOf } from "./inspector.mjs";
import { pinHouse, pinStreet } from "../core/pin.mjs";
import { underlayOf, addUnderlay, setUnderlay, removeUnderlay, movedRect, scaledRect } from "../core/underlay.mjs";
import { addFeature, wallIn } from "../core/draw.mjs";
import { BATTLE, toolFor, snapFor, battleState, placeBox } from "./drawing.mjs";
import { roleLabel } from "./art-browser.mjs";
import { NO_ART } from "./art/index.mjs";
import { briefPlan } from "../core/brief.mjs";
import { offsetLine, lowSign, cliffWidth } from "../core/cliffs.mjs";
import { zoomSize, ZOOMS } from "../core/zoom.mjs";
import { esc, note, FP, MOD, labelAttr } from "./util.mjs";
import { overlaySVG, draftSVG, battleBoxSVG, underStyle } from "./overlay.mjs";
import { regionPlan } from "../core/quick-region.mjs";
import { quickDialog, openDialog, importDialog, confirmSaveOver, confirmDrop, confirmDraft, summaryDialog } from "./plan-files-ui.mjs";
import { rememberWindow } from "../kit/window-memory.mjs";
import { keyboardWindow } from "../kit/keyboard.mjs";
import { storage } from "../kit/storage.mjs";

const store = storage(MOD);
/** The largest underlay image, in pixels a side and in all: past these the browser may not show it. */
const UNDER_MOST = { side: 16384, pixels: 64e6 };

/** JSON with object keys sorted, so a plan whose keys merely moved (a setting reset, then set again) counts as unchanged. */
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

/** The fonts a label can use: the ones Foundry offers for drawings (its own and any the GM added). */
function fontChoices() {
  try {
    const FC = foundry.applications?.settings?.menus?.FontConfig ?? globalThis.FontConfig;
    const list = FC?.getAvailableFonts?.() ?? Object.keys(CONFIG.fontDefinitions ?? {});
    return [...list].sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/** The plan as the map sees it: labels (and the plan's label color and font) and the underlay don't change the picture. */
const mapKey = (p) => {
  const q = { ...p, locked: null, underlay: null, features: (p?.features ?? []).filter((f) => f?.type !== "label") };
  if (q.output?.scene) q.output = { ...q.output, scene: { ...q.output.scene, labelColor: null, labelFont: null } };
  return canon(q);
};

/** Ids of picked things the generator made start with this (they aren't in the plan). */
const GEN = "@gen:";
const genCache = new WeakMap();


const Base = keyboardWindow(rememberWindow(foundry.applications.api.ApplicationV2, { module: MOD, name: "main" }), { module: MOD, scope: "main", ownKeys: true });

export class AtlasScribeApp extends Base {
  static DEFAULT_OPTIONS = {
    id: "atlas-scribe",
    classes: ["atlas-scribe", "as-preview"],
    tag: "div",
    window: { title: "AtlasScribe", icon: "fa-solid fa-map", resizable: true },
    position: { width: 1160, height: 780 },
    actions: {
      asQuick: AtlasScribeApp.#onQuick,
      asArt: AtlasScribeApp.#onArt,
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
      asRedo: AtlasScribeApp.#onRedo,
      asPick: AtlasScribeApp.#onPick,
      asEverything: AtlasScribeApp.#onEverything,
      asFiles: AtlasScribeApp.#onFiles,
      asSummary: AtlasScribeApp.#onSummary,
      asRedraw: AtlasScribeApp.#onRedraw,
      asCopy: AtlasScribeApp.#onCopy,
      asOutlines: AtlasScribeApp.#onOutlines,
      asFit: AtlasScribeApp.#onFit,
      asShapes: AtlasScribeApp.#onShapes,
      asCancel: AtlasScribeApp.#onCancel,
      asStopDraw: AtlasScribeApp.#onStopDraw,
      asBack: AtlasScribeApp.#onBack,
      asReset: AtlasScribeApp.#onReset,
      asDelete: AtlasScribeApp.#onDelete,
      asWallIn: AtlasScribeApp.#onWallIn,
      asPlaceMap: AtlasScribeApp.#onPlaceMap,
      asPlan: AtlasScribeApp.#onPlan,
      asPin: AtlasScribeApp.#onPin,
      asUnder: AtlasScribeApp.#onUnder,
      asUnderPick: AtlasScribeApp.#onUnderPick,
      asUnderRemove: AtlasScribeApp.#onUnderRemove,
      asDraw: AtlasScribeApp.#onDraw,
      asTool: AtlasScribeApp.#onTool,
      asFinish: AtlasScribeApp.#onFinish,
      asBattle: AtlasScribeApp.#onBattle,
      asBattlePreset: AtlasScribeApp.#onBattlePreset,
      asBattleMake: AtlasScribeApp.#onBattleMake,
      asBattleStop: AtlasScribeApp.#onBattleStop,
      asStopTool: AtlasScribeApp.#onStopTool,
    },
  };

  /** run(plan) draws a plan: resolves to the worker's preview result, or throws. */
  #run;
  #plan;
  #history = [];
  #future = []; // plans Undo stepped back from, for Redo (any new change clears it)
  #everything = false; // the list shows every feature in the plan, not only those a reroll can redraw
  #sceneNotes = null; // what the last Make scene or Update scene said: { name, notes: [text] }
  #draftTimer = null;
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
  #zoomBox = null; // the Battle map tool's box, once placed: [x0, y0, x1, y1] in the plan's squares
  #preset = BATTLE.preset; // the Battle map tool's size for a click, in battle squares a side
  #zooming = false; // a battle map is being made from the box
  #boxPreset = false; // the box was placed by a click, at the preset size
  #keys = null; // the keyboard listener while drawing (Enter, Esc, Backspace)
  #presses = null; // while drawing: notes whether the last press was in the window
  #pressedHere = false;
  #finishedAt = 0; // when a drawing last finished, so the double-click that finished it doesn't also fit the map
  #picking = false; // the file picker for the underlay is open
  #queue = []; // inspector changes made while the map was drawing: (plan) => { plan } | { error }, applied when it's done
  #corners = []; // every corner in the plan, for a dragged corner to snap to
  #handles = []; // handlesOf(plan) as drawn
  #edit = null; // the handle being dragged: { h, partners, plan, gen, x, y, moved, next }
  #gen = 0; // bumped each time show() puts in a new plan, so a drag can tell an edited plan from a replaced one

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
  /**
   * Unsaved changes kept from before a reload or a crash: offered once, while the window has no plan, before anything
   * else is opened in it. Resolves to true when they were brought back.
   */
  async offerDraft() {
    const draft = !this.#plan ? AtlasScribeApp.draft() : null;
    if (!draft) return false;
    store.set("draft", null);
    if (!(await confirmDraft(draft.plan.name ?? draft.plan.id ?? "A plan", draft.at)) || this.#plan) return false;
    if (!this.rendered) await this.render({ force: true });
    await this.show(draft.plan, null, { path: draft.path ?? null });
    this.#saved = typeof draft.saved === "string" ? draft.saved : null;
    this.#keepDraft();
    await this.render();
    return true;
  }

  async reopen() {
    await this.render({ force: true });
    if (await this.offerDraft()) return this.#result;
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
    // (after a scene is made, if painting; a big plan still waits for Draw it)
    if (!this.#result && !this.#drawing && !this.#publishing && estimatePlots(this.#plan) <= BIG_PLOTS) return this.#draw();
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
    this.#gen++;
    this.#history = [];
    this.#future = [];
    this.#view = null;
    this.#sceneNotes = null;
    this.#keepDraft();
    // (a plan that takes minutes to lay out waits for the word: Draw it)
    const plots = estimatePlots(plan);
    if (plots > BIG_PLOTS) {
      this.#error = `This plan is big: about ${(Math.round(plots / 1000) * 1000).toLocaleString()} plots, a minute or more to draw.`;
      await this.render({ force: true });
      return null;
    }
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
        // Stopped: a change that started it is taken back (#change), so the plan matches the picture
        this.#error = !e.canceled ? e.message ?? String(e) : this.#result ? "Stopped drawing." : "Stopped drawing. Any change draws it again.";
      }
      this.#busy = false;
      this.#stale = !result;
      if (!this.rendered) return null; // closed meanwhile: nothing to show it in, and nothing to keep
      if (result) {
        // What the generator made has new ids in a new drawing: a picked house or street could now name another
        if (typeof this.#selected === "string" && this.#selected.startsWith(GEN)) this.#selected = null;
        if (typeof this.#inspect === "string" && this.#inspect.startsWith(GEN)) this.#inspect = null;
        if (this.#url) URL.revokeObjectURL(this.#url);
        this.#url = URL.createObjectURL(result.blob);
        this.#result = result;
      }
      // Changes made while it drew are applied first and show then (rendering now would snap a moved slider back)
      if (!this.#queue.length) await this.render();
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
    for (const b of this.element?.querySelectorAll("[data-action='asReroll'], [data-action='asRerollAll'], [data-action='asLock'], [data-action='asUndo'], [data-action='asScene'], [data-action='asQuick'], [data-action='asOpen'], [data-action='asImport']") ?? []) b.disabled = true;
    // The inspector stays usable: what's changed meanwhile is queued (#flush) rather than lost
  }

  /** True while anything that holds the job (a draw, or making the scene) is running. */
  get #working() {
    return this.#busy || this.#publishing || this.#saving || this.#zooming; // a reroll while "Save over a plan?" is up would go unsaved
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
      try { poly = shapeToPolygon(f.shape, f.type === "area" || f.type === "height" ? f.rot ?? 0 : 0) ?? []; } catch { poly = []; }
      const kind = f.type === "district" ? (f.profile ?? "village") : f.type === "height" ? (Number(f.height) < 0 ? "hollow" : "rise") : (f.class ?? "area");
      return { id: f.id, type: f.type, kind, name: f.name ?? null, poly, locked: locked.has(f.id) };
    });
  }

  /** The plan's roads, rivers, walls and docks as drawn on the overlay: [{ id, type, pts, half }] (half: half its widest). */
  #paths() {
    const plan = normalize(this.#plan);
    const sq = plan.size.ftPerSquare || 25;
    return plan.features.filter((f) => (f.type === "road" || f.type === "water" || f.type === "wall" || f.type === "dock") && Array.isArray(f.path) && f.path.length >= 2)
      // (a cliff along the middle of its face, as wide as the face, so it's picked anywhere on it)
      .map((f) => (f.type === "wall" && f.class === "cliff" ? { id: f.id, type: f.type, pts: offsetLine(f.path, (lowSign(f.side) * cliffWidth(f.height, sq)) / 2), half: cliffWidth(f.height, sq) / 2 } : { id: f.id, type: f.type, pts: f.path, half: f.type === "wall" ? 0.15 : Math.max(Number(f.width) || 10, Number(f.endWidth) || 0, ...(Array.isArray(f.widths) ? f.widths.filter(Number.isFinite) : [])) / sq / 2 }));
  }

  /**
   * Squares, plan buildings and a landmark's buildings, outlined faintly so they can be clicked: [{ id, type, poly }].
   * (A pond, lake or sea is outlined with the districts and areas, as it can be rerolled.)
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
      else if (f.type === "landmark") for (const b of f.buildings ?? []) add(f.id, "landmark", b.shape, b.rot ?? 0);
    }
    return out;
  }

  /**
   * What the generator made that can be picked and pinned, from the last drawing: houses with each part's outline,
   * and the districts' streets and lanes. Worked out once per drawing.
   */
  #generated() {
    const r = this.#result;
    if (!r?.pinnables) return { houses: [], streets: [] };
    if (genCache.has(r.pinnables)) return genCache.get(r.pinnables);
    const out = {
      houses: r.pinnables.houses.map((h) => ({ ...h, polys: h.parts.map((p) => {
        try { if (Array.isArray(p.poly) && p.poly.length >= 3) return p.poly; return p.round ? shapeToPolygon({ circle: [p.cx, p.cy, p.len / 2] }) : shapeToPolygon({ rect: [p.cx - p.len / 2, p.cy - p.dep / 2, p.cx + p.len / 2, p.cy + p.dep / 2] }, p.rot ?? 0); } catch { return []; }
      }).filter((q) => q.length >= 3) })),
      streets: r.pinnables.streets,
    };
    genCache.set(r.pinnables, out);
    return out;
  }

  /** The generated house or street a "@gen:" id names, as { kind, item }, or null. */
  #genOf(id) {
    if (typeof id !== "string" || !id.startsWith(GEN)) return null;
    const key = id.slice(GEN.length), g = this.#generated();
    const house = g.houses.find((h) => h.id === key);
    if (house) return { kind: "house", item: house };
    const street = g.streets.find((x) => x.id === key);
    return street ? { kind: "street", item: street } : null;
  }

  /** Bridges, fords and props: points that can be clicked, [{ id, type, at }]. A bridge is where it was drawn (moved onto its road). */
  #points() {
    const drawn = new Map((this.#result?.crossings ?? []).map((c) => [c.id, c.at]));
    return (this.#plan?.features ?? []).filter((f) => (f?.type === "crossing" || f?.type === "prop" || f?.type === "place") && Array.isArray(f.at))
      .map((f) => ({ id: f.id, type: f.type, at: drawn.get(f.id) ?? f.at }));
  }

  /**
   * The labels as drawn on the overlay with the box their text takes (squares, in the label's own frame, which is
   * turned by its angle): [{ id, at, angle, hw, hh }]. The width is measured from the drawn text when it's there.
   */
  #labelBoxes() {
    return (this.#result?.labels ?? []).map((l) => {
      const em = LABEL_SIZES[l.size] ?? LABEL_SIZES.normal;
      const t = this.element?.querySelector(`text.as-pv-label[data-id="${CSS.escape(l.id)}"]`);
      let w = 0;
      try { w = t?.getComputedTextLength?.() ?? 0; } catch { w = 0; }
      return { id: l.id, at: l.at, angle: l.angle ?? 0, hw: (w || String(l.text).length * em * 0.55) / 2 + em * 0.15, hh: em * 0.62 };
    });
  }

  async _renderHTML() {
    const el = document.createElement("div");
    el.className = "as-pv";
    if (!this.#plan) {
      el.classList.add("as-empty");
      el.innerHTML = `<div class="as-pv-welcome">
          <i class="fa-solid fa-map-location-dot"></i>
          <h2>Make a map</h2>
          <p>Quick Start makes a hamlet, village, town or city, or a battle map, from a few choices or a few words. Then change anything on the map here (reroll, reshape, change settings, draw new things) and make it into a scene.</p>
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
    const every = r ? handlesOf(this.#plan) : [];
    this.#corners = every.filter((h) => h.kind === "corner");
    // A feature that's gone (deleted, or undone away) is no longer picked or shown
    if (this.#selected && !featureOf(this.#plan, this.#selected) && !this.#genOf(this.#selected)) this.#selected = null;
    if (this.#inspect && this.#inspect !== "@plan" && !(this.#inspect === "@underlay" && underlayOf(this.#plan)) && !featureOf(this.#plan, this.#inspect) && !this.#genOf(this.#inspect)) this.#inspect = null;
    this.#handles = every.filter((h) => this.#shapes || h.id === this.#selected);
    const under = underlayOf(this.#plan);
    // A picked house or street the generator made: its outline
    const gen = this.#genOf(this.#selected);
    const svg = overlaySVG({
      feats, minor: this.#minor(), points: this.#points(), paths: this.#paths(), labels: r?.labels ?? [], handles: this.#handles,
      under, underEditing: this.#inspect === "@underlay", selected: this.#selected, size: [MW, MH], drawing: !!this.#tool,
      gen: !gen ? null : gen.kind === "house" ? { kind: "house", polys: this.#generated().houses.find((h) => h.id === gen.item.id).polys } : { kind: "street", path: gen.item.path },
    });
    const map = r
      ? `<div class="as-pv-stage" style="width:${r.width}px;height:${r.height}px">
          <img src="${this.#url}" width="${r.width}" height="${r.height}" alt="" draggable="false">
          ${under && under.shown ? `<img class="as-pv-under" src="${esc(under.path)}" style="${underStyle(under.rect, r.width / MW, under.opacity)}" alt="" draggable="false">` : ""}
          <svg class="as-pv-overlay ${this.#outlines ? "" : "as-off"} ${this.#shapes ? "as-shapes" : ""}" viewBox="0 0 ${MW} ${MH}" preserveAspectRatio="none">${svg}</svg>
        </div>`
      : "";
    // The list: what a reroll can redraw, or with Everything every feature in the plan, grouped by kind. Each name is a
    // button that picks it (as a click on the map does), so the whole plan can be reached from the keyboard
    const row = (id, name, kind, roll) => `<li data-id="${esc(id)}" class="${roll?.locked ? "as-locked" : ""} ${id === this.#selected ? "as-selected" : ""}">
        <button type="button" class="as-pv-name" data-action="asPick" data-id="${esc(id)}" aria-pressed="${id === this.#selected}"${labelAttr(`${name}: its settings, and reshape it`)}><strong>${esc(name)}</strong><em>${esc(kind)}</em></button>
        ${roll ? rerollButtons(id, name, roll.locked, this.#working) : ""}
      </li>`;
    const rows = this.#everything ? this.#everythingRows(feats, row) : feats.map((f) => row(f.id, f.name ?? f.id, f.type === "district" ? `${f.kind} district` : f.kind, f)).join("");
    const notes = (r?.notes ?? []);
    const time = r ? `${r.squares[0]} by ${r.squares[1]} squares, drawn in ${(r.ms / 1000).toFixed(1)} s` : "";
    const problems = this.#host.check(this.#plan).problems;
    const lastScene = this.#sceneNotes?.notes.length ? `<details class="as-pv-notes as-pv-scene-notes"><summary>${esc(this.#sceneNotes.name)}: ${this.#sceneNotes.notes.length} note${this.#sceneNotes.notes.length === 1 ? "" : "s"}</summary><ul>${this.#sceneNotes.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></details>` : "";
    const scene = this.#sceneFor();
    const file = this.#path ? this.#path.split("/").pop() : null;
    const status = this.dirty ? (file ? `Unsaved changes to ${file}` : "Not saved yet") : file ? `Saved as ${file}` : "";
    el.innerHTML = `
      <div class="as-pv-map ${this.#busy ? "as-busy" : ""} ${this.#stale ? "as-stale" : ""} ${this.#tool ? "as-drawing" : ""}">
        ${map}
        <div class="as-pv-wait"><i class="fa-solid fa-spinner fa-spin"></i> Drawing <button type="button" data-action="asStopDraw" data-tooltip-text="Stop drawing (the change that started it is taken back)">Stop</button></div>
        ${this.#error ? `<p class="as-pv-error" role="alert">${esc(this.#error)}${!r && !this.#busy ? ` <button type="button" data-action="asRedraw">Draw it</button>` : ""}</p>` : ""}
      </div>
      <aside class="as-pv-side">
        <header>
          <h3>${esc(this.#plan?.name ?? this.#plan?.id ?? "Plan")}${this.dirty ? ` <span class="as-pv-dirty" data-tooltip-text="Unsaved changes">*</span>` : ""}</h3>
          <p class="as-pv-hint">${esc(time)}</p>
          <p class="as-pv-hint">${esc(status)}</p>
        </header>
        <div class="as-pv-tools as-pv-file">
          <button type="button" data-action="asQuick" aria-label="Quick Start" data-tooltip-text="Quick Start: a new plan from a few choices" ${this.#working ? "disabled" : ""}><i class="fa-solid fa-wand-magic-sparkles"></i></button>
          <button type="button" data-action="asOpen" aria-label="Open a saved plan" data-tooltip-text="Open a saved plan" ${this.#working ? "disabled" : ""}><i class="fa-solid fa-folder-open"></i></button>
          <button type="button" data-action="asImport" aria-label="Import a plan" data-tooltip-text="Import a plan (JSON, or a mapplan block)" ${this.#working ? "disabled" : ""}><i class="fa-solid fa-file-import"></i></button>
          <button type="button" data-action="asSave" aria-label="Save the plan" data-tooltip-text="Save the plan in this world" class="${this.dirty ? "as-on" : ""}"><i class="fa-solid fa-floppy-disk"></i></button>
          <button type="button" data-action="asExport" aria-label="Download the plan" data-tooltip-text="Download the plan as a file"><i class="fa-solid fa-file-export"></i></button>
          <button type="button" data-action="asCopy" aria-label="Copy the plan" data-tooltip-text="Copy the plan as JSON"><i class="fa-solid fa-copy"></i></button>
          <button type="button" data-action="asPlan" aria-label="Plan settings" data-tooltip-text="Plan settings: name, season, size, the scene" class="${this.#inspect === "@plan" ? "as-on" : ""}"><i class="fa-solid fa-gear"></i></button>
          <button type="button" data-action="asArt" data-tooltip-text="Art: folders, art you choose, filename rules" aria-label="Art"><i class="fa-solid fa-images"></i></button>
          <button type="button" data-action="asFiles"${labelAttr("Files: each plan's maps and backups")}><i class="fa-solid fa-folder-tree" aria-hidden="true"></i></button>
          <button type="button" data-action="asSummary"${labelAttr("Summary: what the map holds, to copy into your notes")} ${this.#plan && !this.#working ? "" : "disabled"}><i class="fa-solid fa-list-ul" aria-hidden="true"></i></button>
        </div>
        ${problems.length ? `<details class="as-pv-problems"><summary><i class="fa-solid fa-triangle-exclamation"></i> ${problems.length} problem${problems.length === 1 ? "" : "s"} in the plan</summary><ul>${problems.map((p) => `<li class="as-${p.level}">${esc(p.message)}</li>`).join("")}</ul></details>` : ""}
        <div class="as-pv-tools">
          <button type="button" data-action="asDraw" class="${this.#palette ? "as-on" : ""}" data-tooltip-text="Draw something new: a district, area, square, building, road, river, wall, bridge, prop or label" ${this.#working ? "disabled" : ""}><i class="fa-solid fa-pen"></i> Draw</button>
          ${this.#plan?.kind !== "battle" && this.#plan?.kind !== "region" ? `<button type="button" data-action="asBattle" class="${this.#tool?.id === "battle" ? "as-on" : ""}" data-tooltip-text="Pick an area of this map to make a battle map of: its streets, water and notable buildings where they are here, its houses built again at battle size" ${this.#working || !this.#result ? "disabled" : ""}><i class="fa-solid fa-chess-board"></i> Battle map</button>` : ""}
          <button type="button" data-action="asRerollAll" ${this.#working ? "disabled" : ""}><i class="fa-solid fa-dice"></i> Reroll all</button>
          <button type="button" data-action="asUndo" ${this.#history.length && !this.#working ? "" : "disabled"} data-tooltip-text="Back to the plan before the last change (Ctrl+Z)"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Undo</button>
          <button type="button" data-action="asRedo" ${this.#future.length && !this.#working ? "" : "disabled"} data-tooltip-text="The change Undo took back (Ctrl+Y)"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Redo</button>
        </div>
        ${this.#tool?.id === "battle" ? battleHTML(this.#battleState())
          : this.#palette ? paletteHTML(this.#tool?.id ?? null, { points: this.#tool?.points.length ?? 0, working: this.#working, kind: this.#plan?.kind ?? "settlement" })
          : this.#inspect === "@plan" ? planHTML(this.#plan, { working: this.#working, fonts: fontChoices() })
          : this.#inspect === "@underlay" && under ? underlayHTML(under, { working: this.#working })
          : this.#genOf(this.#inspect) ? generatedHTML(this.#genOf(this.#inspect), { working: this.#working, nameOf: (id) => this.#nameOf(id) })
          : this.#inspect ? featureHTML(this.#plan, this.#inspect, { working: this.#working, fonts: fontChoices() })
          : `<div class="as-pv-list-bar"><button type="button" data-action="asEverything" aria-pressed="${this.#everything}" data-tooltip-text="Every feature in the plan, not only what a reroll redraws">Everything</button></div>
            <ul class="as-pv-list" tabindex="-1" data-focus-home data-keep-scroll="pv-list">${rows || `<li class="as-pv-hint">This plan has no districts or areas to reroll.</li>`}</ul>`}
        ${notes.length ? `<details class="as-pv-notes"><summary>${notes.length} note${notes.length === 1 ? "" : "s"}</summary><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></details>` : ""}
        ${lastScene}
        <div class="as-pv-tools">
          <button type="button" data-action="asOutlines" class="${this.#outlines ? "as-on" : ""}"><i class="fa-solid fa-draw-polygon"></i> Outlines</button>
          <button type="button" data-action="asShapes" class="${this.#shapes ? "as-on" : ""}" data-tooltip-text="Drag corners and points to reshape districts, areas, roads, rivers, walls, ponds, lakes, seas and docks; drag the dot in a side's middle to add one; alt-click or right-click one to remove it" ${this.#busy ? "disabled" : ""}><i class="fa-solid fa-vector-square"></i> Shapes</button>
          <button type="button" data-action="asFit" data-tooltip-text="Fit the map to the window (or double-click it)"><i class="fa-solid fa-expand"></i> Fit</button>
          <button type="button" data-action="asUnder" class="${this.#inspect === "@underlay" ? "as-on" : ""}" data-tooltip-text="${under ? "The reference image under the sketch: see-through, move, scale, lock" : "Put an image under the sketch to trace over (a sketch, an old map)"}" ${this.#working ? "disabled" : ""}><i class="fa-solid fa-image"></i> Underlay</button>
        </div>
        <div class="as-pv-tools as-pv-scene">
          <button type="button" data-action="asScene" class="as-primary" ${this.#working ? "disabled" : ""} data-tooltip-text="${scene ? "Draw the map and update the scene made from this plan (it's backed up first)" : "Draw the map and make it a scene"}"><i class="fa-solid fa-image"></i> ${this.#publishing ? "Painting..." : scene ? "Update scene" : "Make scene"}</button>
          ${this.#publishing ? `<button type="button" data-action="asCancel" data-tooltip-text="Stop painting (no scene is made or changed)"><i class="fa-solid fa-xmark"></i> Cancel</button>` : ""}
          ${scene && !this.#publishing ? `<button type="button" data-action="asView" data-tooltip-text="Go to the scene"><i class="fa-solid fa-eye"></i></button>` : ""}
        </div>
        <p class="as-pv-hint">${esc(this.#hint())}</p>
      </aside>`;
    return el;
  }

  /** Every feature in the plan, grouped by kind, for the list's Everything view. */
  #everythingRows(feats, row) {
    const rolls = new Map(feats.map((f) => [f.id, f]));
    const groups = new Map();
    for (const f of this.#plan?.features ?? []) {
      if (!f?.id) continue;
      const kind = kindOf(f);
      const g = f.type ?? "other";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(row(f.id, f.name ?? f.text ?? f.id, kind, rolls.get(f.id) ?? null));
    }
    const TITLES = { district: "Districts", area: "Areas", height: "Rises and hollows", water: "Water", road: "Roads", wall: "Walls", square: "Squares", building: "Buildings", landmark: "Landmarks", crossing: "Bridges and fords", dock: "Docks", prop: "Props", label: "Labels", boundary: "Boundaries" };
    return [...groups].map(([g, list]) => `<li class="as-pv-group" role="presentation"><strong>${esc(TITLES[g] ?? g)}</strong></li>${list.join("")}`).join("");
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
          // (not after a refusal: the box then shows what the plan has)
          if (!this.#error && was.value !== null && input.matches("input[type=text], input[type=number]") && input.value !== was.value) input.value = was.value;
        }
      }
    }
    this.#applyView();
    this.#drawDraft();
    this.#fitLabelBox();
    requestAnimationFrame(() => this.#applyView()); // the first time, the window has its size only after layout
  }

  /** The picked label's box and turning dot, fitted to its text as the browser drew it. */
  #fitLabelBox() {
    const g = this.element?.querySelector(".as-pv-label-g.as-selected");
    const t = g?.querySelector("text.as-pv-label"), rect = g?.querySelector(".as-pv-label-box"), dot = g?.querySelector(".as-turn");
    if (!t) return;
    let w = 0;
    try { w = t.getComputedTextLength(); } catch { w = 0; }
    if (!w) return;
    const em = Number(t.getAttribute("font-size")) || 0.7, hw = w / 2 + em * 0.15;
    rect?.setAttribute("x", -hw); rect?.setAttribute("width", hw * 2);
    dot?.setAttribute("cx", hw + em * 0.6);
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
      // A button over the map (Stop) is a button, not the start of a drag: a drag captures the pointer, and the
      // button's click would never reach it
      if (!box || !this.#result || ev.target.closest?.(".as-pv-wait, button")) return;
      const handle = ev.target.closest?.(".as-pv-handle");
      if (this.#tool && ev.button === 0) this.#tool.down = { x: ev.clientX, y: ev.clientY, at: this.#toSquares(ev) };
      // The underlay, while its panel is open: drag it to move it, or a corner to scale it
      const ug = ev.target.closest?.(".as-pv-under-move, .as-pv-handle.as-under");
      if (ug && !this.#working && !this.#tool && ev.button === 0) {
        const u = underlayOf(this.#plan);
        if (!u) return;
        ev.stopPropagation();
        // (a corner scales it; its edge, or the grip in its middle, moves it)
        const corner = ug.dataset.corner !== undefined ? Number(ug.dataset.corner) : null;
        this.#edit = { under: { corner, rect: u.rect, from: this.#toSquares(ev) }, plan: this.#plan, gen: this.#gen, x: ev.clientX, y: ev.clientY, moved: false, next: null };
        box.setPointerCapture(ev.pointerId);
        return;
      }
      // A picked label: drag its box to move it, or the dot beside it to turn it
      const grip = ev.target.closest?.(".as-pv-label-box, .as-pv-handle.as-turn");
      if (grip && !this.#working && !this.#tool && ev.button === 0) {
        const l = (this.#result?.labels ?? []).find((x) => x.id === grip.dataset.id);
        if (!l) return;
        ev.stopPropagation();
        const kind = grip.classList.contains("as-turn") ? "turn" : "move";
        this.#edit = { label: { id: l.id, kind, at: l.at, angle: l.angle ?? 0, from: this.#toSquares(ev), lines: kind === "move" ? linesOf(this.#plan) : null }, plan: this.#plan, gen: this.#gen, x: ev.clientX, y: ev.clientY, moved: false, next: null };
        box.setPointerCapture(ev.pointerId);
        return;
      }
      if (handle && !this.#working && !this.#tool) {
        const h = this.#handles[Number(handle.dataset.h)];
        if (!h) return;
        ev.stopPropagation();
        if (h.kind === "corner" && (ev.button === 2 || ev.altKey)) return this.#reshape(removeCorner(this.#plan, h.id, h.i));
        if (ev.button !== 0) return;
        this.#edit = { h, partners: h.kind === "corner" ? partnersOf(this.#plan, h.id, h.i) : [], plan: this.#plan, gen: this.#gen, x: ev.clientX, y: ev.clientY, moved: false, next: null };
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
        const t = this.#tool, geo = toolFor(t.id).geometry;
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
        if (click && ev.detail >= 2 && t.points.length && toolFor(t.id).geometry !== "point" && toolFor(t.id).geometry !== "box") { stop(); return this.#finish(); }
        if (click) this.#toolClick(ev);
        stop();
        return;
      }
      // A press that didn't move is a click: pick the district or area under it (or none)
      const d = this.#drag;
      if (d && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 4 && ev.target.closest?.(".as-pv-map")) this.#pick(ev);
      stop();
    });
    // Ctrl+Z and Ctrl+Y (or Ctrl+Shift+Z) undo and redo; Delete takes out what's picked. Not while typing in a box
    // (its own undo), and not while drawing (the tool's keys are its own)
    el.addEventListener("keydown", (ev) => {
      const t = ev.target;
      if (t?.isContentEditable || t?.closest?.("input, select, textarea, [contenteditable]") || this.#tool) return;
      const k = ev.key.toLowerCase(), ctrl = ev.ctrlKey || ev.metaKey;
      let act = null;
      if (ctrl && !ev.altKey && k === "z") act = ev.shiftKey ? "redo" : "undo";
      else if (ctrl && !ev.altKey && !ev.shiftKey && k === "y") act = "redo";
      else if (!ctrl && !ev.altKey && ev.key === "Delete" && this.#selected && featureOf(this.#plan, this.#selected)) act = "delete";
      if (!act) return;
      ev.preventDefault();
      ev.stopPropagation(); // (Foundry's own Ctrl+Z and Delete act on the canvas)
      if (act === "undo") AtlasScribeApp.#onUndo.call(this);
      else if (act === "redo") AtlasScribeApp.#onRedo.call(this);
      else this.#deleteFeature(this.#selected);
    });
    // A setting changed in the inspector: applied at once, and the map redrawn
    el.addEventListener("change", (ev) => {
      // The Battle map tool's zoom: kept as the client setting, and the box's size said again
      if (ev.target.dataset?.battleZoom !== undefined) {
        Promise.resolve(this.#host.battleZoom?.set(Number(ev.target.value))).catch(() => {}).finally(() => this.#rezoomBattleBox());
        return;
      }
      const ui = ev.target.closest?.(".as-pv-insp [data-under]");
      if (ui && this.#plan) {
        if (this.#publishing || this.#saving) return this.render();
        const u = underlayOf(this.#plan);
        if (!u) return;
        const k = ui.dataset.under, v = ui.type === "checkbox" ? ui.checked : Number(ui.value);
        // A number box left empty or with text it can't read isn't a request to move the image to 0
        if (ui.type === "number" && (ui.validity?.badInput || ui.value.trim() === "" || !Number.isFinite(v) || (k === "width" && v < 1))) {
          this.#error = k === "width" ? "Width should be a number of squares, 1 or more. Nothing was changed." : `${k === "left" ? "Left" : "Top"} should be a number of squares. Nothing was changed.`;
          return this.#working ? undefined : this.render();
        }
        const [x0, y0, x1, y1] = u.rect, aspect = (x1 - x0) / (y1 - y0);
        const patch = k === "opacity" ? { opacity: v } : k === "shown" ? { shown: v } : k === "locked" ? { locked: v }
          : k === "left" && Number.isFinite(v) ? { rect: [v, y0, v + x1 - x0, y1] }
          : k === "top" && Number.isFinite(v) ? { rect: [x0, v, x1, v + y1 - y0] }
          : k === "width" && Number.isFinite(v) && v >= 1 ? { rect: [x0, y0, x0 + v, y0 + v / aspect] } : null;
        if (!patch) return this.render();
        return this.#apply((plan) => ({ plan: setUnderlay(plan, patch) }));
      }
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
    // The underlay's see-through slider shows as it's dragged (the plan changes when it's let go)
    el.addEventListener("input", (ev) => {
      if (ev.target.dataset?.under === "opacity") this.element.querySelector(".as-pv-under")?.style.setProperty("opacity", ev.target.value);
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
    this.#queue = []; // a change waiting for a draw would otherwise open the window again
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
    const gen = this.#genOf(this.#selected);
    if (gen) return `The generator made this ${gen.kind} in ${this.#nameOf(gen.item.from)}. Pin it to keep it when ${this.#nameOf(gen.item.from)} is rerolled. Click elsewhere to finish.`;
    if (this.#selected) {
      const has = this.#handles.some((h) => h.id === this.#selected);
      const f = featureOf(this.#plan, this.#selected), name = this.#nameOf(this.#selected);
      // (roads, rivers, walls and cliffs curve through their points; docks are drawn straight between theirs)
      const how = f?.straight || f?.type === "dock" ? "straight between them" : "as a smooth curve through them";
      if (has && this.#handles.some((h) => h.id === this.#selected && h.path))
        return `Drag ${name}'s points to move it (the dot in a stretch's middle adds a point; right-click a point to remove it). It's drawn ${how}. Click elsewhere to finish.`;
      if (has) return `Drag ${name}'s corners to reshape it (the dot in a side's middle adds a corner; right-click a corner to remove it). Click elsewhere to finish.`;
      return (f?.type === "district" || f?.type === "area") && Number(f.rot)
        ? `${name} is turned (it has a rot), and can't be reshaped here yet. Its settings are in the panel.`
        : `${name}'s settings are in the panel. Click elsewhere to finish.`;
    }
    if (this.#shapes) return "Drag a corner or a road's point to reshape; points shared by two districts or two roads move together. A turned area can't be reshaped here yet.";
    return "A quick sketch in plain colors. Click anything to see its settings and reshape it; scroll to zoom, drag to move.";
  }

  /** A feature's name for the words in hints and notices: its name, else its id. */
  #nameOf(id) {
    const name = featureOf(this.#plan, id)?.name;
    return typeof name === "string" && name.trim() ? name : id;
  }

  /**
   * Picks what's under a click: a label's text, then a bridge, ford or prop, then the space around a label, then a
   * road, river or wall, then the smallest shape there (a building, square, pond, wood or district), so a wood inside
   * a district can be picked.
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
    // A label, by the box its text takes (with at least 8 pixels around it, however far out the map is zoomed). A
    // click on the text itself picks the label over a well or cart under it; around the text, the well or cart wins
    const near = 8 / px;
    const inLabel = (pad) => this.#labelBoxes().find((l) => {
      const a = (-l.angle * Math.PI) / 180, dx = at[0] - l.at[0], dy = at[1] - l.at[1];
      const x = dx * Math.cos(a) - dy * Math.sin(a), y = dx * Math.sin(a) + dy * Math.cos(a); // into the label's frame
      return Math.abs(x) <= Math.max(l.hw, pad) && Math.abs(y) <= Math.max(l.hh, pad);
    });
    const onText = inLabel(0);
    if (onText) return this.#select(onText.id);
    if (point) return this.#select(point);
    const label = inLabel(near);
    if (label) return this.#select(label.id);
    // A road, river or wall under the click (within its width, and at least 8 pixels) wins over the area around it
    let road = null, roadD = Infinity;
    for (const p of this.#paths()) {
      const d = distanceToPath(at, p.pts);
      if (d <= Math.max(p.half, 8 / px) && d < roadD) { roadD = d; road = p.id; }
    }
    if (road) return this.#select(road);
    const smallest = (list) => {
      let best = null, bestArea = Infinity;
      for (const f of list) {
        if (f.poly.length < 3 || !pointInPolygon(at, f.poly)) continue;
        const area = Math.abs(f.poly.reduce((a, p, i) => { const q = f.poly[(i + 1) % f.poly.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
        if (area < bestArea) { bestArea = area; best = f.id; }
      }
      return best;
    };
    // A plan building or square; then a house or street the generator made (to pin); then the smallest wood, field
    // system, farm, pond, lake or district there
    const minor = smallest(this.#minor());
    if (minor) return this.#select(minor);
    // A building or square too small to hit at this zoom: the nearest one within 8 pixels of its outline
    let close = null, closeD = 8 / px;
    for (const f of this.#minor()) {
      const d = distanceToPath(at, [...f.poly, f.poly[0]]);
      if (d < closeD) { closeD = d; close = f.id; }
    }
    if (close) return this.#select(close);
    const g = this.#stale ? { houses: [], streets: [] } : this.#generated(); // the picture is of another plan
    const house = g.houses.find((h) => h.polys.some((q) => pointInPolygon(at, q)));
    if (house) return this.#select(GEN + house.id);
    let street = null, streetD = Infinity;
    for (const w of g.streets) {
      const d = distanceToPath(at, w.path);
      if (d <= Math.max((w.width ?? 0) / 2, 6 / px) && d < streetD) { streetD = d; street = w.id; }
    }
    if (street) return this.#select(GEN + street);
    this.#select(smallest(this.#features()));
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
    if (e.label) return this.#labelMove(ev, e);
    if (e.under) return this.#underMove(ev, e);
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
        // Roads snap to roads (rivers to rivers, walls to walls, cliffs to cliffs), districts and areas to each other, and
        // ponds, lakes and seas to each other
        if (moving.has(o.id) || o.family !== e.h.family) continue;
        const d = Math.hypot(o.at[0] - to[0], o.at[1] - to[1]);
        if (d < bestD) { bestD = d; best = o.at; }
      }
      if (best) { to = [...best]; snapped = true; }
    }
    e.to = to;
    e.snapped = snapped;
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

  /**
   * A label being dragged: moved (taking the angle of a road or water it's over, as it will when let go) or turned
   * (Shift for steps of 15 degrees). The overlay follows; the plan changes when it's let go.
   */
  #labelMove(ev, e) {
    const l = e.label, now = this.#toSquares(ev);
    let at = l.at, angle = l.angle;
    if (l.kind === "move") {
      at = [l.at[0] + now[0] - l.from[0], l.at[1] + now[1] - l.from[1]];
      angle = angleNear(l.lines, at) ?? l.angle;
      e.next = moveLabel(e.plan, l.id, at);
      l.to = at;
    } else {
      angle = wrapAngle((Math.atan2(now[1] - l.at[1], now[0] - l.at[0]) * 180) / Math.PI);
      if (ev.shiftKey) angle = wrapAngle(Math.round(angle / 15) * 15);
      e.next = turnLabel(e.plan, l.id, angle);
      l.to = angle;
    }
    this.element.querySelector(`.as-pv-label-g[data-id="${CSS.escape(l.id)}"]`)?.setAttribute("transform", `translate(${at[0]} ${at[1]}) rotate(${angle})`);
  }

  /** The underlay being dragged (moved, or scaled from a corner keeping its shape): the image and its box follow. */
  #underMove(ev, e) {
    const u = e.under, now = this.#toSquares(ev);
    const rect = u.corner === null ? movedRect(u.rect, now[0] - u.from[0], now[1] - u.from[1]) : scaledRect(u.rect, u.corner, now);
    u.to = rect;
    e.next = true;
    const r = this.#result;
    const img = this.element.querySelector(".as-pv-under");
    if (img && r) img.setAttribute("style", underStyle(rect, r.width / r.squares[0], underlayOf(this.#plan)?.opacity ?? 0.5));
    const box = this.element.querySelector(".as-pv-under-move");
    box?.setAttribute("x", rect[0]); box?.setAttribute("y", rect[1]); box?.setAttribute("width", rect[2] - rect[0]); box?.setAttribute("height", rect[3] - rect[1]);
    const cs = [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]];
    for (const c of this.element.querySelectorAll(".as-pv-handle.as-under")) {
      const p = c.dataset.corner !== undefined ? cs[Number(c.dataset.corner)] : [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2];
      c.setAttribute("cx", p[0]); c.setAttribute("cy", p[1]);
    }
  }

  /** A handle let go: the reshaped plan is drawn (a click that didn't move does nothing). */
  async #editEnd() {
    const e = this.#edit;
    this.#edit = null;
    if (!e?.moved || !e.next) return;
    // Another plan was put in mid-drag (opened, imported, Quick Start): the drag was on a plan that's gone
    if (e.gen !== this.#gen) return this.render();
    // The underlay moved or scaled: kept on the plan as it is now (it changes nothing in the picture)
    if (e.under) {
      const rect = e.under.to;
      return this.#apply((plan) => ({ plan: setUnderlay(plan, { rect }) })); // waits its turn if the map is drawing
    }
    if (e.plan === this.#plan) return this.#reshape(e.next);
    // The plan changed under the drag (a setting typed and left as the drag began): the move is made again on the plan
    // as it is now, once its drawing is in
    await this.settled();
    if (e.gen !== this.#gen || this.#working || !this.rendered) return this.rendered ? this.render() : undefined;
    if (e.label) {
      if (!featureOf(this.#plan, e.label.id)) return this.render();
      return this.#reshape(e.label.kind === "move" ? moveLabel(this.#plan, e.label.id, e.label.to) : turnLabel(this.#plan, e.label.id, e.label.to));
    }
    if (!featureOf(this.#plan, e.h.id) || !e.to) return this.render();
    const partners = e.h.kind === "corner" ? partnersOf(this.#plan, e.h.id, e.h.i) : [];
    return this.#reshape(moveHandle(this.#plan, e.h, e.to, partners, { exact: e.snapped }));
  }

  /** Keeps a reshaped plan and draws it, unless a shape it changed would cross itself (then it says so). */
  #reshape(next) {
    const geo = (f) => JSON.stringify([f.shape, f.path, f.at, f.offset, f.angle]); // a district's shape, a road's path, a bridge's or label's place
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
    this.#future = [];
  }

  /**
   * Keeps the plan's unsaved changes in this browser a moment after each change, so a reload or a crash doesn't lose
   * them (offered again when the window next opens); a saved plan, or one with no changes, keeps none.
   */
  #keepDraft() {
    clearTimeout(this.#draftTimer);
    this.#draftTimer = setTimeout(() => {
      if (!this.#plan || !this.dirty) return store.set("draft", null);
      store.set("draft", { plan: this.#plan, path: this.#path, saved: this.#saved, at: Date.now() });
    }, 600);
  }

  /** The unsaved changes kept from an earlier session: { plan, path, saved, at }, or null. */
  static draft() {
    const d = store.get("draft", null);
    return d && typeof d === "object" && d.plan && typeof d.plan === "object" ? d : null;
  }

  /** Changes the plan (keeping the old one for Undo) and draws it again. */
  async #change(plan) {
    // (a change refused puts Redo back as it was)
    const future = this.#future;
    this.#remember();
    // Only labels changed: the picture stands, and only the labels on it are worked out again
    if (this.#result && !this.#stale && mapKey(plan) === mapKey(this.#plan)) {
      // (checked as a draw would check it: a label's error refuses the change)
      const errors = this.#host.check(plan).problems.filter((p) => p.level === "error");
      if (errors.length) {
        this.#history.pop();
        this.#future = future;
        this.#error = `${errors.map((e) => e.message).join(" ")} Nothing was changed.`;
        await this.render();
        return null;
      }
      this.#plan = plan;
      this.#keepDraft();
      this.#result = { ...this.#result, labels: labelsOf(plan) };
      await this.render();
      return this.#result;
    }
    this.#plan = plan;
    const result = await this.#draw();
    // If it couldn't be drawn, take the change back, so the plan always matches the picture (the error stays up)
    if (!result && this.rendered && this.#result) {
      this.#plan = this.#history.pop();
      this.#future = future;
      this.#stale = false;
      this.#error = `${this.#error ?? "It couldn't be drawn."} Nothing was changed.`;
      await this.render();
    }
    this.#keepDraft();
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
    else note.info("AtlasScribe: everything is locked, so there's nothing to reroll.");
  }

  static async #onLock(event, target) {
    if (this.#working) return;
    const id = target.dataset.id;
    const on = !(Array.isArray(this.#plan?.locked) && this.#plan.locked.includes(id));
    this.#remember();
    this.#error = null;
    this.#plan = setLocked(this.#plan, id, on);
    this.#keepDraft();
    this.render(); // locking changes nothing on the map
  }

  static async #onUndo() {
    if (this.#working || !this.#history.length) return;
    const before = this.#history.pop();
    this.#future.push(this.#plan);
    await this.#step(before, "undo");
  }

  static async #onRedo() {
    if (this.#working || !this.#future.length) return;
    const after = this.#future.pop();
    this.#history.push(this.#plan);
    await this.#step(after, "redo");
  }

  /** Undo or Redo: the plan put back, drawn again only when the map changes (locks and labels don't change it). */
  async #step(before, how) {
    this.#error = null;
    const sameMap = mapKey(before) === mapKey(this.#plan); // locks and labels don't change the picture
    this.#plan = before;
    if (sameMap && this.#result && !this.#stale) {
      this.#result = { ...this.#result, labels: labelsOf(before) };
      this.render();
    } else if (!(await this.#draw()) && this.rendered && this.#error === "Stopped drawing.") {
      this.#error = `Stopped drawing. The ${how} stands, but the picture is of the plan before it; any change draws it again.`;
      this.render();
    }
    this.#keepDraft();
  }

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
    if (!this.rendered) { this.#queue = []; return; }
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
    this.#error = !errors.length ? null
      : errors.length === ops.length ? `${errors.join(" ")} Nothing was changed.`
      : `${errors.join(" ")} The other changes were made.`;
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
    if (this.#publishing || this.#saving) return; // nothing changes while a scene is made or a plan saved
    const id = target.closest(".as-pv-insp")?.dataset.id, field = target.dataset.field;
    if (id) await this.#apply((plan) => (id === "@plan" ? setPlanField(plan, field, undefined) : setField(plan, id, field, undefined)));
  }

  /** Takes a feature out of the plan (its seed and lock too); Undo brings it back. */
  static async #onDelete(event, target) {
    await this.#deleteFeature(target.dataset.id);
  }

  async #deleteFeature(id) {
    if (this.#publishing || this.#saving || !this.#plan) return;
    if (!featureOf(this.#plan, id)) return;
    this.#selected = null;
    this.#inspect = null;
    await this.#apply((plan) => (featureOf(plan, id) ? { plan: deleteFeature(plan, id) } : { error: `"${id}" is already gone.` }));
  }

  /** Wall in: a town wall around the district; its settings open, and the map shows its gates and towers. */
  static async #onWallIn(event, target) {
    if (this.#working || !this.#plan) return;
    const res = wallIn(this.#plan, target.dataset.id);
    if (res.error) { this.#error = res.error; return this.render(); }
    this.#selected = res.id;
    this.#inspect = res.id;
    const drawn = await this.#change(res.plan);
    if (!drawn && this.#selected === res.id) { this.#selected = this.#inspect = null; this.render(); }
    if (drawn) note.info(`AtlasScribe: ${res.id} walls in ${this.#nameOf(target.dataset.id)}, with a gate wherever a road crosses it. Reshape it by its corners, or delete it.`);
  }

  /** Pins the picked house or street: copied into the plan as a fixed feature, whose settings then open. */
  static async #onPin() {
    const gen = this.#genOf(this.#inspect);
    if (!gen || this.#working || this.#stale) return; // never from a drawing of another plan
    const res = gen.kind === "house" ? pinHouse(this.#plan, gen.item) : pinStreet(this.#plan, gen.item);
    if (res.error) { this.#error = res.error; return this.render(); }
    this.#selected = res.id;
    this.#inspect = res.id;
    const drawn = await this.#change(res.plan);
    if (!drawn && this.#selected === res.id) { this.#selected = this.#inspect = null; this.render(); }
    if (drawn) note.info(`AtlasScribe: pinned as ${res.id}. ${gen.kind === "house" ? "It stays as it is when" : "It stays, and the district's other streets follow it, when"} ${this.#nameOf(gen.item.from)} is rerolled; delete it to let the generator have the spot again.`);
  }

  /** Underlay: with none, pick an image to put under the sketch; with one, its panel (again to close it). */
  static async #onUnder() {
    if (this.#working || !this.#plan) return;
    if (underlayOf(this.#plan)) {
      this.#endTool();
      this.#palette = false;
      this.#selected = null;
      this.#inspect = this.#inspect === "@underlay" ? null : "@underlay";
      return this.render();
    }
    await this.#pickUnderlay();
  }

  static async #onUnderPick() {
    await this.#pickUnderlay();
  }

  static async #onUnderRemove() {
    if (this.#working || !underlayOf(this.#plan)) return;
    this.#inspect = null;
    await this.#change(removeUnderlay(this.#plan));
  }

  /** Foundry's file picker for an image; it's fitted inside the map and centered, half see-through, and its panel opens. */
  async #pickUnderlay() {
    if (this.#picking) return;
    this.#picking = true;
    try {
      await this.#pickUnderlayNow();
    } finally {
      this.#picking = false;
    }
  }

  async #pickUnderlayNow() {
    const path = await new Promise((resolve) => {
      const fp = new (FP())({ type: "image", current: underlayOf(this.#plan)?.path ?? "", callback: (p) => resolve(p) });
      fp.addEventListener?.("close", () => setTimeout(() => resolve(null), 0), { once: true });
      fp.render(true);
    });
    if (!path || !this.#plan || this.#working) return;
    // Its size, from the load event (decode() waits while the window is in the background)
    const img = new Image();
    const ok = await new Promise((resolve) => {
      img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0);
      img.onerror = () => resolve(false);
      img.src = path;
    });
    if (!this.rendered || !this.#plan) return; // the window was closed meanwhile
    if (!ok) {
      this.#error = `The image ${path} couldn't be opened.`;
      return this.render();
    }
    // (an image past what browsers draw reliably shows blank or crashes the tab: refused, with its size)
    const w = img.naturalWidth, h = img.naturalHeight;
    if (Math.max(w, h) > UNDER_MOST.side || w * h > UNDER_MOST.pixels) {
      this.#error = `The image is ${w.toLocaleString()} by ${h.toLocaleString()} pixels, too big to show under the sketch. Use one at most ${UNDER_MOST.side.toLocaleString()} pixels a side and ${UNDER_MOST.pixels / 1e6} million in all.`;
      return this.render();
    }
    if (this.#working) {
      this.#error = "The map was busy, so the image wasn't put under it. Try again when it's done.";
      return this.render();
    }
    const old = underlayOf(this.#plan);
    let next = addUnderlay(this.#plan, path, img.naturalWidth, img.naturalHeight);
    if (old) next = setUnderlay(next, { opacity: old.opacity, shown: true }); // a new picture keeps the see-through
    this.#endTool();
    this.#palette = false;
    this.#selected = null;
    this.#inspect = "@underlay";
    await this.#change(next);
  }

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
    return snapFor(this.#plan, this.#tool.id, at, this.#tolerance());
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
    const tool = toolFor(t.id);
    const { at } = this.#snapped(this.#toSquares(ev));
    if (tool.geometry === "point" || tool.geometry === "box") {
      t.points = [at];
      return this.#finish();
    }
    if (tool.geometry === "shape" && t.points.length >= 3 && Math.hypot(at[0] - t.points[0][0], at[1] - t.points[0][1]) <= this.#tolerance()) return this.#finish();
    // A town wall or palisade closes around on its first point
    if (tool.closes && t.points.length >= 3 && Math.hypot(at[0] - t.points[0][0], at[1] - t.points[0][1]) <= this.#tolerance()) {
      t.points.push([...t.points[0]]);
      return this.#finish();
    }
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
    const tool = toolFor(t.id);
    how.textContent = howText(tool, t.points.length);
    const fin = this.element.querySelector('[data-action="asFinish"]');
    if (fin) fin.disabled = t.points.length < (tool.geometry === "path" ? 2 : 3) || this.#working;
  }

  /** Makes the feature drawn and opens its settings; a drawing that can't be kept says why and carries on. */
  async #finish() {
    const t = this.#tool;
    if (!t) return;
    if (t.id === "battle") return this.#placeBattleBox();
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
    if (drawn && res.crossings?.length) note.info(`AtlasScribe: added ${res.crossings.join(" and ")} where it crosses ${toolFor(kept.id).make.type === "road" ? "the water" : "a road"}. Click one to make it a ford or footbridge, or delete it.`);
    if (drawn && res.access?.length) note.info(`AtlasScribe: ${res.id} had no road ${toolFor(kept.id).make.type === "square" ? "to" : "into"} it, so ${res.access[0]} runs to it from the nearest road${res.access.length > 1 ? ` (with ${res.access.slice(1).join(" and ")} over the water)` : ""}. Move or delete it as you like.`);
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
      // A key sent to the page itself counts only when the window had the last press: after a click on the canvas,
      // Delete and Esc are Foundry's
      if (target !== document.body ? !this.element?.contains(target) : !this.#pressedHere) return;
      if (ev.key === "Enter") { if (this.#tool.id === "battle" && this.#zoomBox && !this.#tool.box) this.#makeBattle(); else this.#finish(); }
      // (Esc while a battle map is being made leaves the tool and its Stop button as they are: Stop stops it)
      else if (ev.key === "Escape") { if (!this.#zooming) { this.#endTool(); this.render(); } }
      else if (ev.key === "Backspace" || ev.key === "Delete") { this.#tool.points.pop(); this.render(); }
      else return;
      ev.preventDefault();
      ev.stopImmediatePropagation(); // Foundry would close the window on Esc
    };
    window.addEventListener("keydown", this.#keys, true);
    // Which was pressed last, the window or the rest of the page
    this.#pressedHere = true;
    this.#presses = (ev) => { this.#pressedHere = !!this.element?.contains(ev.target); };
    document.addEventListener("pointerdown", this.#presses, true);
  }

  #endTool() {
    this.#zoomBox = null;
    if (this.#keys) window.removeEventListener("keydown", this.#keys, true);
    if (this.#presses) document.removeEventListener("pointerdown", this.#presses, true);
    this.#keys = null;
    this.#presses = null;
    this.#tool = null;
  }

  /** The drawing under way on the overlay: its points, the line to the cursor, a box, and a ring where it snaps. */
  #drawDraft() {
    const g = this.element?.querySelector(".as-pv-draft");
    if (!g) return;
    const t = this.#tool;
    if (!t) { g.innerHTML = ""; return; }
    if (t.id === "battle") return this.#drawBattleBox(g);
    const [MW, MH] = this.#result?.squares ?? [1, 1];
    g.innerHTML = draftSVG(t, toolFor(t.id).geometry, Math.max(MW, MH) / 160);
  }

  /** The Battle map tool's zoom (the client setting). */
  #battleZoom() {
    const z = Number(this.#host.battleZoom?.get?.() ?? 2);
    return ZOOMS.includes(z) ? z : 2;
  }

  /** The Battle map tool's box (being dragged, else placed) and its size at the zoom, for the panel and the map. */
  #battleState() {
    const t = this.#tool;
    return { ...battleState(this.#plan, { raw: t?.box ?? this.#zoomBox, zoom: this.#battleZoom(), preset: this.#preset, placed: !!this.#zoomBox && !t?.box }), working: this.#working, zooming: this.#zooming };
  }

  /** The box let go (or a click: a box of the preset size around it), kept on the map within its edges. */
  #placeBattleBox() {
    const t = this.#tool;
    this.#boxPreset = !t.box && !!t.points.length;
    // (a box dragged while the battle map of the last one is being made isn't placed)
    const res = this.#zooming ? { box: null } : placeBox(this.#plan, { drag: t.box, at: t.points[0] ?? null, zoom: this.#battleZoom(), preset: this.#preset, squares: this.#result?.squares ?? [0, 0] });
    t.box = null;
    t.points = [];
    if (res.box || res.error) {
      this.#zoomBox = res.box ?? null;
      this.#error = res.error ?? null;
    }
    this.render();
  }

  /**
   * The zoom changed: a box placed by a click keeps its size in battle squares (the preset), around its middle; a
   * dragged one keeps its area, and is dropped if that's now too small to fight in.
   */
  #rezoomBattleBox() {
    const t = this.#tool;
    if (t?.id === "battle" && this.#zoomBox) {
      const [x0, y0, x1, y1] = this.#zoomBox;
      if (this.#boxPreset) t.points = [[(x0 + x1) / 2, (y0 + y1) / 2]];
      else t.box = [x0, y0, x1, y1];
      return this.#placeBattleBox();
    }
    this.render();
  }

  /** The Battle map tool's box on the map, with its size in battle squares, and the panel's size line kept with it. */
  #drawBattleBox(g) {
    const st = this.#battleState();
    const line = this.element?.querySelector(".as-pv-battle-size");
    if (line) {
      line.textContent = battleSizeText(st);
      line.classList.toggle("as-warn", st.big);
    }
    g.innerHTML = battleBoxSVG(st, this.#result?.squares ?? [1, 1]);
  }

  /** The Battle map button: the tool on (the side panel shows it), or off again. */
  static #onBattle() {
    if (this.#working) return;
    this.#boxPreset = false;
    if (this.#tool?.id === "battle") this.#endTool();
    else { this.#startTool("battle"); this.#palette = false; this.#inspect = null; }
    this.#error = null;
    this.render();
  }

  /** A preset size for a clicked box; a placed box takes it too, around its middle. */
  static #onBattlePreset(event, target) {
    const n = Number(target.dataset.size);
    if (!BATTLE.PRESETS.includes(n)) return;
    this.#preset = n;
    if (this.#zoomBox && this.#tool?.id === "battle") {
      const [x0, y0, x1, y1] = this.#zoomBox;
      this.#tool.points = [[(x0 + x1) / 2, (y0 + y1) / 2]];
      return this.#placeBattleBox();
    }
    this.render();
  }

  static async #onBattleMake() {
    await this.#makeBattle();
  }

  /** Stops making the battle map. */
  static #onBattleStop() {
    if (this.#zooming) this.#host.cancel?.();
  }

  /**
   * Makes the battle map of the placed box and opens it here, a new plan not saved until Save (the town map's own
   * unsaved changes are asked about first, as opening any plan does). It remembers where it came from (source).
   */
  async #makeBattle() {
    const before = this.#plan;
    if (!this.#zoomBox || this.#working || !before) return;
    // (one past the most squares an image can hold at its fewest pixels a square can't be made)
    if (Math.max(...zoomSize(before, this.#zoomBox, this.#battleZoom()).squares) > BATTLE.MOST) return;
    if (!(await this.#mayDiscard())) return;
    // (while the dialog was up: a job started, the plan changed (asked about again), or the box went)
    if (this.#working || !this.#zoomBox || !(await this.#mayReplace(before)) || this.#working) return;
    // (the box as it is now: it may have been moved while the dialog was up)
    const box = this.#zoomBox, from = this.#plan, zoom = this.#battleZoom();
    this.#zooming = true;
    this.#error = null;
    this.render();
    let res = null;
    try {
      res = await this.#host.zoom(from, box, zoom);
    } catch (e) {
      this.#error = e.canceled ? "Stopped making the battle map." : `The battle map couldn't be made: ${e.message ?? e}`;
    }
    this.#zooming = false;
    // (the window closed meanwhile, asking the job to stop, which it does only between its steps: what it made is let go,
    // and nothing is opened)
    if (!this.rendered) return;
    if (!res?.plan || this.#plan !== from) {
      // (changes made in the panel meanwhile are applied now, as after a draw)
      if (this.#queue.length) setTimeout(() => this.#flush(), 0);
      return this.rendered ? this.render() : undefined;
    }
    for (const n of res.notes ?? []) note.warn(`AtlasScribe: ${n}`);
    const drawn = await this.show(res.plan);
    if (drawn) note.info(`AtlasScribe: made ${res.plan.name}, ${res.plan.size.squares.join(" x ")} squares. Save it to keep it, or Make scene.`);
  }

  /** The drawing tools in the side panel (again to close them). */
  static #onDraw() {
    if (this.#palette) { this.#endTool(); this.#palette = false; }
    else { if (this.#tool?.id === "battle") this.#endTool(); this.#palette = true; this.#inspect = null; this.#selected = null; }
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

  /** The scene this plan was made into last, if any. */
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
    return confirmDrop(this.#plan?.name ?? "This plan");
  }

  /**
   * After a dialog that will put a new plan in: true if it still may. Not while a scene is made or the plan saved, and
   * a plan changed while the dialog was up is asked about again.
   */
  async #mayReplace(before) {
    if (this.#publishing || this.#saving) {
      note.warn("AtlasScribe: the window is making a scene or saving the plan. Try again when it's done.");
      return false;
    }
    return this.#plan === before || this.#mayDiscard();
  }

  /** Which Quick Start tab was used last (settlement or battle), shown first next time. */
  #quickTab = "settlement";

  /**
   * A region's place made a map of its own: a city, town, village or hamlet by Quick Start at its size, a castle by the
   * battle map's Castle site, named as the place and seeded from the region and the place, so it comes out the same.
   */
  static async #onPlaceMap(event, target) {
    const f = featureOf(this.#plan, target.dataset.id);
    if (!f || this.#working || !(await this.#mayDiscard())) return;
    const seed = Number(f.seed) || 1 + (Math.abs([...`${this.#plan.seed}:${f.id}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 999999);
    const before = this.#plan;
    if (!(await this.#mayReplace(before))) return;
    try {
      const made = f.class === "castle" ? briefPlan({ site: "castle", seed, name: f.name ?? "" }) : this.#host.quick({ size: f.class, seed, ...(f.name ? { name: f.name } : {}), season: this.#plan.season });
      await this.show(made.plan);
      for (const n of made.notes ?? []) note.info(n);
    } catch (e) {
      note.error(e.message);
    }
  }

  /** Quick Start: a few choices in a dialog, then a new plan in the window (not saved until Save). */
  static async #onQuick() {
    if (this.#working || !(await this.#mayDiscard())) return;
    const before = this.#plan;
    const { LABELS } = this.#host.quickChoices;
    const seed = 1 + Math.floor(Math.random() * 999999); // only a starting point: the plan keeps it, so it draws the same every time
    const chosen = await quickDialog({ tab: ["battle", "region"].includes(this.#quickTab) ? this.#quickTab : "settlement", seed, onTab: (t) => { this.#quickTab = t; } });
    if (!chosen) return;
    // A region: its plan into the window
    if (chosen.region) {
      if (!(await this.#mayReplace(before))) return;
      try {
        const opts = { ...chosen.region };
        if (!opts.name?.trim()) delete opts.name;
        const { plan, notes } = regionPlan(opts);
        await this.show(plan);
        for (const n of notes) note.info(n);
      } catch (e) {
        note.error(e.message);
      }
      return;
    }
    // A battle map: its plan from the brief, into the window (not saved until Save)
    if (chosen.battle) {
      if (!(await this.#mayReplace(before))) return;
      try {
        // (what couldn't be made as asked, such as a cliff with no room beside the site, is said)
        const { plan, notes } = briefPlan(chosen.battle);
        await this.show(plan);
        for (const n of notes) note.info(n);
      } catch (e) {
        note.error(e.message);
      }
      return;
    }
    const opts = { ...chosen, seed: Number(chosen.seed) || seed };
    if (!opts.name?.trim()) delete opts.name;
    if (!(await this.#mayReplace(before))) return;
    const { plan, choices, notes: notesOf } = this.#host.quick(opts);
    // An outline or a river form that couldn't be made (it doesn't go with the water or the other choices, or there's no
    // room for it) is replaced: say so
    for (const [k, what] of [["shape", "outline"], ["river", "river"]]) {
      if (opts[k] && (choices?.size === "city" || choices?.size === "metropolis") && choices[k] !== opts[k]) {
        const name = (v) => (LABELS[k]?.[v] ?? v ?? "none").toLowerCase();
        note.info(`The ${what} "${name(opts[k])}" couldn't be made here (with ${(LABELS.water?.[choices.water] ?? choices.water).toLowerCase()} and your other choices), so ${choices[k] ? `"${name(choices[k])}" was used instead` : "there's none"}.`);
      }
    }
    // (a building or place asked for that found no room is said too)
    // (a temple, inn or smithy is placed when the map is laid out, which notes one that doesn't fit)
    const NAMES = { cemetery: "a cemetery", watermill: "a watermill", windmill: "a windmill", walled: "a wall", citadel: "a citadel" };
    const got = choices?.has ?? choices?.outside ?? {};
    const missed = Object.entries({ ...opts.has, ...opts.outside }).filter(([k, v]) => v === true && got[k] === false && NAMES[k]).map(([k]) => NAMES[k]);
    if (missed.length) note.info(`No room was found for ${missed.length > 1 ? `${missed.slice(0, -1).join(", ")} and ${missed.at(-1)}` : missed[0]} here, so the plan is made without ${missed.length > 1 ? "them" : "it"}. A new seed may fit ${missed.length > 1 ? "them" : "it"}.`);
    for (const n of notesOf ?? []) note.info(n);
    try {
      const drawn = await this.show(plan);
      // (a temple, inn or smithy is placed when the map is laid out: one asked for that found no room is said too)
      const asked = ["temple", "inn", "smithy"].filter((k) => opts.has?.[k] === true);
      const lost = asked.filter((k) => (drawn?.notes ?? []).some((t) => new RegExp(`had no room for its ${k}`, "i").test(t)));
      if (lost.length) note.info(`No room was found for ${lost.length > 1 ? `the ${lost.slice(0, -1).join(", ")} and ${lost.at(-1)}` : `the ${lost[0]}`} here. A new seed may fit ${lost.length > 1 ? "them" : "it"}.`);
    } catch (e) {
      note.error(e.message);
    }
  }

  /** Open a plan saved in this world. */
  static async #onOpen() {
    if (this.#working || !(await this.#mayDiscard())) return;
    const before = this.#plan;
    const plans = await this.#host.plans.list();
    if (!plans.length) return note.info(`AtlasScribe: no plans are saved in ${this.#host.folder()} yet.`);
    const chosen = await openDialog(plans, this.#host.folder());
    if (!chosen || !(await this.#mayReplace(before))) return;
    try {
      const plan = await this.#host.plans.load(chosen.path);
      // A plan with errors can't be drawn: say why, as Import does, rather than open a window that can't show it
      const errors = this.#host.check(plan).problems.filter((p) => p.level === "error");
      if (errors.length) return note.error(`AtlasScribe: ${chosen.file} has ${errors.length} error(s): ${errors.map((e) => e.message).join(" ")}`, { permanent: true });
      await this.show(plan, null, { path: chosen.path, saved: true });
    } catch (e) {
      note.error(e.message);
    }
  }

  /** Import a plan from pasted text or a file; one with errors is refused, with them listed. */
  static async #onImport() {
    if (this.#working || !(await this.#mayDiscard())) return;
    const before = this.#plan;
    const text = await importDialog();
    if (!text) return;
    // (a plan, a watabou export or a Universal VTT file, its image put under the sketch)
    let imported;
    try {
      imported = await this.#host.importPlan(text);
    } catch (e) {
      return note.error(e.message);
    }
    const checked = this.#host.check(imported.plan);
    if (!checked.plan) return note.error(checked.problems[0]?.message ?? "AtlasScribe: that isn't a plan.");
    const errors = checked.problems.filter((p) => p.level === "error");
    if (errors.length) return note.error(`AtlasScribe: the plan has ${errors.length} error(s): ${errors.map((e) => e.message).join(" ")}`, { permanent: true });
    if (!(await this.#mayReplace(before))) return;
    for (const n of imported.notes ?? []) note.info(`AtlasScribe: ${n}`);
    try {
      await this.show(imported.plan);
    } catch (e) {
      note.error(e.message);
    }
  }

  /** Saves the plan in this world, by its id; asks before writing over another plan's file. */
  static async #onSave() {
    await this.#save();
  }

  /** Saves the plan; resolves to true when it was saved. */
  async #save() {
    if (!this.#plan || this.#saving) return false;
    // Settings changed while the map draws are applied first, so what's saved is what the window shows
    await this.settled();
    if (this.#queue.length) { await this.#flush(); await this.settled(); }
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
        if (!(await confirmSaveOver(file))) return false;
      }
      const saved = await this.#host.plans.save(plan, file);
      this.#path = saved ?? path;
      this.#saved = json;
      this.#keepDraft();
      this.#host.setLast(this.#path);
      note.info(`AtlasScribe: saved ${plan.name ?? plan.id} as ${this.#path}.`);
      if (this.rendered) this.render();
      return true;
    } catch (e) {
      note.error(e.message);
      return false;
    } finally {
      this.#saving = false;
      if (this.#queue.length && this.rendered) setTimeout(() => this.#flush(), 0); // a change made while the dialog was up
    }
  }

  /** The plan, given an id from its name if it has none (a scene and a file need one). */
  #withId() {
    if (!this.#plan.id) {
      // From its name, with a short random tail, so two plans of the same name never share a file or a scene
      const id = `${String(this.#plan.name ?? "plan").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "plan"}-${Math.random().toString(36).slice(2, 6)}`;
      this.#plan = { ...this.#plan, id };
      // Undo must not take the id away again: a second Make scene would make a second file and scene
      this.#history = this.#history.map((p) => (p && !p.id ? { ...p, id } : p));
      this.#future = this.#future.map((p) => (p && !p.id ? { ...p, id } : p));
    }
    return this.#plan;
  }

  /** Opens the Art Browser. */
  static #onArt() {
    this.#host.openArt?.().catch?.((e) => note.error(e.message));
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
      note.info(`AtlasScribe: ${res?.scene?.created ? "made the scene" : "updated the scene"} ${made?.name ?? ""} in ${Math.round((res?.ms ?? 0) / 1000)} s.${res?.scene?.title ? " The map's name is a hidden tile: show it to the players from the Tiles controls when you're ready." : ""}`);
      // Why the map looks as it does, when it isn't as asked: art that couldn't be had, settings the scene didn't take
      // (when no art could be had at all, the note says so, and listing every kind would add nothing)
      const n = res?.missingArt?.length ?? 0;
      const none = (res?.artNotes ?? []).includes(NO_ART);
      const sentence = (t) => (/[.!?)]$/.test(t) ? t : `${t}.`);
      const kinds = `${n} ${n === 1 ? "kind of art wasn't" : "kinds of art weren't"} found and ${n === 1 ? "is" : "are"} ${res?.drawn ? "drawn instead" : "painted in plain colors"} (${res?.missingArt?.slice(0, 6).join(", ")}${n > 6 ? ", ..." : ""}).`;
      // (on a battle map what has no art is drawn, which is no fault: said in passing, not as a warning)
      const why = [...(res?.artNotes ?? []).map(sentence), ...(n && !none && !res?.drawn ? [kinds] : []), ...(res?.warnings ?? []).map(sentence)];
      if (why.length) note.warn(`AtlasScribe: ${why.join(" ")}`, { permanent: true });
      // (and kept in the window, under the map's own notes, until another plan is opened)
      this.#sceneNotes = { name: made?.name ?? "The scene", notes: why };
      // (and not at all when nothing came from any art: the whole map is drawn, as it should be)
      const had = (res?.artFrom?.folders ?? 0) + (res?.artFrom?.nexus ?? 0);
      if (n && res?.drawn && had) note.info(`AtlasScribe: ${n} ${n === 1 ? "kind of art had" : "kinds of art had"} none of yours and ${n === 1 ? "is" : "are"} drawn (${res.missingArt.slice(0, 6).map(roleLabel).join(", ")}${n > 6 ? ", ..." : ""}).`);
    } catch (e) {
      if (!e.canceled) note.error(e.message, { permanent: true });
      // Canceled once the map was saved: Foundry can't delete a file, so say where it is
      else if (e.result?.path) note.info(`AtlasScribe: canceled. The map had already been saved, to ${e.result.path}; the scene wasn't changed.`);
    } finally {
      this.#publishing = false;
      if (this.rendered) {
        // A window reopened while it painted has no picture yet; changes made meanwhile wait in the queue
        if (!this.#result && !this.#drawing) this.#draw();
        else if (this.#queue.length) setTimeout(() => this.#flush(), 0);
        else this.render();
      }
    }
  }

  /** Stops the painting under way (nothing is saved or changed). */
  static #onCancel() {
    if (this.#publishing) this.#host.cancel();
  }

  /** Stops the drawing under way (a slow one: a big map, or many feet a square); the change that started it is taken back. */
  static #onStopDraw() {
    if (this.#busy && !this.#publishing) this.#host.cancel();
  }

  /** Goes to the scene made from this plan. */
  static #onView() {
    this.#sceneFor()?.view();
  }

  static async #onCopy() {
    if (!this.#plan) return;
    await game.clipboard.copyPlainText(JSON.stringify(this.#plan, null, 2));
    note.info("AtlasScribe: the plan is on the clipboard.");
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

  /** A name in the list: picks it (again to put it down), as a click on the map does. */
  static #onPick(event, target) {
    const id = target.dataset.id;
    this.#select(this.#selected === id ? null : id);
  }

  /** The list shows every feature in the plan, or only what a reroll can redraw. */
  static #onEverything() {
    this.#everything = !this.#everything;
    this.render();
  }

  static #onFiles() {
    this.#host.openFiles?.().catch?.((e) => note.error(e.message));
  }

  /** The "as built" summary of the plan in the window, to read and copy. */
  static async #onSummary() {
    if (!this.#plan) return;
    try {
      await summaryDialog(await this.#host.summary(this.plan));
    } catch (e) {
      note.error(e.message);
    }
  }

  /** Draws the plan again after a draw was stopped before any picture came. */
  static #onRedraw() {
    if (this.#working || !this.#plan) return;
    this.#draw();
  }

  static #onFit() {
    this.#view = null;
    this.#applyView();
  }
}
