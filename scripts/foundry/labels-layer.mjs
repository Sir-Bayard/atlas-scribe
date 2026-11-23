/**
 * AtlasScribe's labels layer: an overland scene's names drawn on the canvas from the scene's flag (core/scene-labels.mjs),
 * curved and spaced as the map set them, for every user (players see the ones the GM shows). The GM moves a label by
 * dragging it, edits it in a small window (double-click), shows or hides it (right-click), and with the keyboard picks
 * one (Tab), moves it (the arrow keys, Shift for bigger steps), bends it ([ and ]) and opens it (Enter). The layer's
 * scene controls also show or hide every label and switch the map's views (physical, political, cultural).
 */
import { MOD } from "./util.mjs";
import { glyphsOf } from "../core/label-curve.mjs";
import { labelsIn, patchLabel, showAll, resetLabel } from "../core/scene-labels.mjs";
import { VIEWS, viewChanges, viewOf } from "../core/scene-views.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Whether a color is light (a light label is outlined in black, a dark one in white, as Foundry outlines a drawing's text). */
const light = (hex) => { const n = parseInt(String(hex).slice(1), 16); return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 140; };

/** The labels a scene keeps (the layer's own changes waiting to be saved first). */
const sceneLabels = (scene) => labelsIn(scene?.flags?.[MOD]?.labels);

export class AtlasLabelsLayer extends foundry.canvas.layers.InteractionLayer {
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, { name: "atlasLabels", zIndex: 250 });
  }

  /** Each label's drawing by id: { box (its container), l (the label), w, h (its local box) }. */
  #drawn = new Map();
  #selected = null;
  #drag = null;
  /** Changes made here and not yet saved (arrow keys come quickly): the list to save, the scene it's for, its timer. */
  #pending = null;
  #pendingScene = null;
  #timer = null;
  #frame = null;
  /** The edit window's live look at one label ({ id, patch }), drawn but never saved. */
  #peek = null;

  /** The labels as they stand: the scene's, or the changes made here waiting to be saved. */
  get labels() { return this.#pending ?? sceneLabels(canvas.scene); }
  get selected() { return this.#selected; }
  /** A label as drawn: with the edit window's live look over it. */
  #looks(l) { return this.#peek?.id === l.id ? { ...l, ...this.#peek.patch } : l; }
  /** Whether a label is left off in the view the scene shows: realm, province and wild names on the cultural map, whose own names it paints. */
  #offInView(l) { return this.#view === "cultural" && /^@realm:|^@land:province:|^@land:wilds-/.test(l.id); }
  #view = "physical";

  async _draw(options) {
    await super._draw?.(options);
    // (the whole scene answers the mouse while the layer is active: the stage hears only what something covers)
    this.hitArea = canvas.dimensions.rect;
    this.root = this.addChild(new PIXI.Container());
    this.root.sortableChildren = true;
    this.#frame = this.addChild(new PIXI.Graphics());
    // (the labels' fonts loaded first, so letters are measured in them)
    await Promise.all([...new Set(this.labels.map((l) => l.font))].map((f) => document.fonts.load(`32px "${f}"`).catch(() => null)));
    this.refresh();
  }

  async _tearDown(options) {
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = null; await this.#save(); }
    this.#drawn.clear();
    this.#selected = null;
    this.#drag = null;
    this.#pending = null;
    this.#peek = null;
    return super._tearDown(options);
  }

  /** Draws every label again (from the scene, or the changes waiting). */
  refresh() {
    if (!this.root || this.root.destroyed) return;
    for (const c of this.root.removeChildren()) c.destroy({ children: true });
    this.#drawn.clear();
    const gm = game.user.isGM;
    this.#view = viewOf((canvas.scene?.tiles ?? []).map((t) => ({ layer: t.flags?.[MOD]?.kind ?? null, alpha: t.alpha })));
    this.labels.forEach((l0, k) => {
      const l = this.#looks(l0);
      if ((!l.shown && !gm) || this.#offInView(l)) return;
      const box = this.#build(l, gm);
      box.zIndex = k;
      this.root.addChild(box);
      this.#drawn.set(l.id, { box, l, b: box.getLocalBounds() });
    });
    if (this.#selected && !this.#drawn.has(this.#selected)) this.#selected = null;
    this.#outline();
  }

  /** Draws one label again (a move, a bend, the edit window's look), the rest left as they are. */
  #redraw(id) {
    if (!this.root || this.root.destroyed) return this.refresh();
    const k = this.labels.findIndex((x) => x.id === id), old = this.#drawn.get(id);
    if (k < 0) return this.refresh();
    const l = this.#looks(this.labels[k]);
    if (old) { this.root.removeChild(old.box); old.box.destroy({ children: true }); this.#drawn.delete(id); }
    if ((l.shown || game.user.isGM) && !this.#offInView(l)) {
      const box = this.#build(l, game.user.isGM);
      box.zIndex = k;
      this.root.addChild(box);
      this.#drawn.set(id, { box, l, b: box.getLocalBounds() });
    }
    this.#outline();
  }

  /** One label's drawing: a container at its middle, turned, holding its letters. */
  #build(l, gm) {
    const PT = foundry.canvas.containers.PreciseText;
    const box = new PIXI.Container();
    box.position.set(l.x, l.y);
    box.angle = l.angle;
    // (hidden from players: the GM sees it faded)
    box.alpha = l.alpha * (l.shown ? 1 : 0.45);
    const style = PT.getTextStyle({ fontFamily: l.font, fontSize: l.size, fill: l.color, stroke: light(l.color) ? "#000000" : "#ffffff", strokeThickness: Math.max(2, Math.round(l.size * 0.1)) });
    if (Math.abs(l.bend) < 0.005) {
      style.letterSpacing = l.spacing * l.size;
      const t = new PT(l.text, style);
      t.anchor.set(0.5, 0.5);
      box.addChild(t);
    } else {
      // (measured without the outline and shadow, which TextMetrics adds to every letter's width)
      const bare = style.clone();
      bare.strokeThickness = 0; bare.dropShadow = false;
      const widthOf = (ch) => PIXI.TextMetrics.measureText(ch, bare).width;
      for (const g of glyphsOf(l.text, { size: l.size, spacing: l.spacing, bend: l.bend }, widthOf).glyphs) {
        if (g.ch === " ") continue;
        const t = new PT(g.ch, style);
        t.anchor.set(0.5, 0.5);
        t.position.set(g.x, g.y);
        t.rotation = g.rot;
        box.addChild(t);
      }
    }
    box.eventMode = "none";
    return box;
  }

  /** The selected label's frame (the GM's only). */
  #outline() {
    const f = this.#frame;
    if (!f || f.destroyed) return;
    f.clear();
    const d = this.#selected && this.#drawn.get(this.#selected);
    if (!d || !game.user.isGM) return;
    const { box, b } = d, pad = 6 / (canvas.stage.scale.x || 1);
    const corners = [[b.left - pad, b.top - pad], [b.right + pad, b.top - pad], [b.right + pad, b.bottom + pad], [b.left - pad, b.bottom + pad]].map(([x, y]) => box.toGlobal(new PIXI.Point(x, y))).map((p) => this.toLocal(p));
    f.lineStyle(2 / (canvas.stage.scale.x || 1), 0xff9a2e, 1);
    f.moveTo(corners[0].x, corners[0].y);
    for (const p of [...corners.slice(1), corners[0]]) f.lineTo(p.x, p.y);
  }

  /** The label under a canvas point, the last drawn first (the one on top), or null. */
  pick(point) {
    const list = [...this.#drawn.values()].reverse();
    for (const d of list) {
      const p = d.box.toLocal(new PIXI.Point(point.x, point.y), this);
      if (p.x >= d.b.left && p.x <= d.b.right && p.y >= d.b.top && p.y <= d.b.bottom) return d.l.id;
    }
    return null;
  }

  select(id) {
    this.#selected = id && this.#drawn.has(id) ? id : null;
    this.#outline();
  }

  /**
   * A change to labels made here: shown at once, saved to the scene a moment later (one save for a run of keys). only:
   * the one label it changes, drawn again alone.
   */
  change(list, { now = false, only = null } = {}) {
    if (!game.user.isGM || !canvas.scene) return;
    this.#pending = list;
    this.#pendingScene = canvas.scene.id;
    if (only) this.#redraw(only); else this.refresh();
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#save(), now ? 0 : 400);
  }

  async #save() {
    this.#timer = null;
    const list = this.#pending, scene = game.scenes.get(this.#pendingScene);
    if (!list || !scene) return;
    try {
      await scene.update({ [`flags.${MOD}.labels`]: list });
    } catch (e) {
      ui.notifications.error(`AtlasScribe: the labels couldn't be saved (${e.message}).`);
    }
    if (this.#pending === list) this.#pending = null;
  }

  /** The edit window's live look at one label (a patch), drawn and never saved; null ends it. */
  peek(id, patch) {
    const was = this.#peek?.id;
    this.#peek = patch ? { id, patch } : null;
    if (was && was !== id) this.#redraw(was);
    if (id) this.#redraw(id);
  }

  /** Changes one label (a patch of its fields) as the GM's. */
  patch(id, p, opts = {}) { this.change(patchLabel(this.labels, id, p), { ...opts, only: id }); }

  // ---- the mouse ----
  _onClickLeft(event) {
    if (!game.user.isGM) return;
    this.select(this.pick(event.interactionData.origin));
  }

  _onClickLeft2(event) {
    if (!game.user.isGM) return;
    const id = this.pick(event.interactionData.origin);
    if (id) { this.select(id); labelWindow(this, id); }
  }

  _onClickRight(event) {
    if (!game.user.isGM) return;
    const id = this.pick(event.interactionData.origin);
    const l = id && this.labels.find((x) => x.id === id);
    if (l) { this.select(id); this.change(this.labels.map((x) => (x.id === id ? { ...x, shown: !x.shown } : x)), { now: true, only: id }); }
  }

  _canDragLeftStart(user, event) {
    return user.isGM && !!this.pick(event.interactionData.origin);
  }

  _onDragLeftStart(event) {
    const id = this.pick(event.interactionData.origin);
    const d = id && this.#drawn.get(id);
    if (!d) return;
    this.select(id);
    this.#drag = { id, x: d.l.x, y: d.l.y, origin: { ...event.interactionData.origin } };
  }

  _onDragLeftMove(event) {
    const g = this.#drag, d = g && this.#drawn.get(g.id);
    if (!d) return;
    const to = event.interactionData.destination;
    d.box.position.set(g.x + to.x - g.origin.x, g.y + to.y - g.origin.y);
    this.#outline();
  }

  _onDragLeftDrop(event) {
    const g = this.#drag;
    this.#drag = null;
    if (!g) return;
    const to = event.interactionData.destination;
    this.patch(g.id, { x: g.x + to.x - g.origin.x, y: g.y + to.y - g.origin.y }, { now: true });
  }

  _onDragLeftCancel(event) {
    const g = this.#drag;
    this.#drag = null;
    if (g) this.refresh();
  }

  // ---- the keyboard ----
  /** Tab: the next label (left to right, top to bottom), Shift+Tab the one before. */
  _onCycleViewKey(event) {
    if (!game.user.isGM) return false;
    const list = [...this.#drawn.values()].map((d) => d.l).sort((a, b) => a.y - b.y || a.x - b.x);
    if (!list.length) return false;
    const k = list.findIndex((l) => l.id === this.#selected), step = event?.shiftKey ? -1 : 1;
    const next = list[(k < 0 ? (step > 0 ? 0 : list.length - 1) : (k + step + list.length) % list.length)];
    this.select(next.id);
    canvas.animatePan({ x: next.x, y: next.y, duration: 250 });
    return true;
  }

  _onDismissKey(event) {
    if (!this.#selected) return false;
    this.select(null);
    return true;
  }

  /** The keyboard's change to the selected label: move (dx, dy in grid tenths), bend, or open it. Returns whether it acted. */
  key(action, { shift = false } = {}) {
    const id = this.#selected, l = id && this.labels.find((x) => x.id === id);
    if (!l || !game.user.isGM || !this.active) return false;
    const step = Math.max(shift ? 20 : 4, (canvas.grid?.size ?? 100) * (shift ? 1 : 0.1));
    const moves = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    if (moves[action]) this.patch(id, { x: l.x + moves[action][0] * step, y: l.y + moves[action][1] * step });
    else if (action === "bendMore" || action === "bendLess") this.patch(id, { bend: l.bend + (action === "bendMore" ? 0.02 : -0.02) * (shift ? 3 : 1) });
    else if (action === "open") labelWindow(this, id);
    else return false;
    return true;
  }
}

/** The small window for one label: its text, size, turn, bend, spacing, color and whether players see it, shown live. */
export async function labelWindow(layer, id) {
  const l = layer.labels.find((x) => x.id === id), sceneId = canvas.scene?.id;
  if (!l || !sceneId) return;
  const row = (label, input, help = "") => `<div class="form-group"><label>${label}</label><div class="form-fields">${input}</div>${help ? `<p class="hint">${help}</p>` : ""}</div>`;
  const content = `<div class="as-label-edit">
    ${row("Text", `<input type="text" name="text" value="${esc(l.text)}" maxlength="200" autofocus>`)}
    ${row("Size", `<input type="number" name="size" value="${l.size}" min="8" max="256" step="1">`, "Font size in pixels")}
    ${row("Turn", `<input type="number" name="angle" value="${l.angle}" min="-180" max="180" step="1">`, "Degrees clockwise")}
    ${row("Bend", `<input type="range" name="bend" value="${l.bend}" min="-0.35" max="0.35" step="0.01">`, "Right arches it, left makes it sag; the middle is straight")}
    ${row("Spacing", `<input type="range" name="spacing" value="${l.spacing}" min="0" max="2" step="0.05">`, "Room between the letters")}
    ${row("Color", `<input type="color" name="color" value="${esc(l.color)}">`)}
    ${row("Shown to Players", `<input type="checkbox" name="shown" ${l.shown ? "checked" : ""}>`)}
  </div>`;
  const read = (form) => {
    const f = new foundry.applications.ux.FormDataExtended(form).object;
    return { text: String(f.text ?? l.text), size: Number(f.size), angle: Number(f.angle), bend: Number(f.bend), spacing: Number(f.spacing), color: String(f.color), shown: !!f.shown };
  };
  // (the window's look is drawn over the label and never saved; Save patches the labels as they stand then, so a
  // change made elsewhere meanwhile stays)
  const here = () => canvas.scene?.id === sceneId && canvas.atlasLabels === layer;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: `Label: ${l.text}` },
    position: { width: 420 },
    content,
    buttons: [
      { action: "save", label: "Save", icon: "fa-solid fa-check", default: true, callback: (event, button) => read(button.form) },
      { action: "reset", label: "Put Back", icon: "fa-solid fa-rotate-left", callback: () => "reset" },
      { action: "cancel", label: "Cancel", icon: "fa-solid fa-xmark" },
    ],
    render: (event, dialog) => {
      const form = dialog.element.querySelector("form") ?? dialog.element;
      form.addEventListener("input", () => { if (!here()) return; const p = read(form); if (p.text.trim()) layer.peek(id, p); });
    },
    rejectClose: false,
  });
  if (!here()) { if (result && result !== "cancel") ui.notifications.warn("AtlasScribe: the scene changed while the label was open, so nothing was saved."); return; }
  layer.peek(null);
  if (result === "reset") layer.change(resetLabel(layer.labels, id), { now: true, only: id });
  else if (result && typeof result === "object") layer.change(patchLabel(layer.labels, id, result), { now: true, only: id });
}

/** Whether a scene has AtlasScribe labels or views. */
const hasLabels = (scene) => !!scene && (Array.isArray(scene.flags?.[MOD]?.labels) || scene.tiles?.some((t) => ["political", "cultural"].includes(t.flags?.[MOD]?.kind)));

/** The layer's scene controls (the GM's only, on a scene with AtlasScribe labels or views). */
function addControls(controls) {
  if (!game.user.isGM) return;
  const scene = canvas?.scene, has = hasLabels(scene);
  const views = new Set((scene?.tiles ?? []).map((t) => t.flags?.[MOD]?.kind).filter((v) => v === "political" || v === "cultural"));
  const tools = {
    // (not "select": the canvas draws a selection box for a tool of that name instead of passing the drag on)
    move: { name: "move", order: 1, title: "Labels: drag to move, double-click to edit, right-click to show or hide; Tab picks one, the arrow keys move it, [ and ] bend it, Enter edits it", icon: "fa-solid fa-expand" },
    showAll: { name: "showAll", order: 2, title: "Show Every Label to Players", icon: "fa-solid fa-eye", button: true, onChange: () => { const L = canvas.atlasLabels; L?.change(showAll(L.labels, true), { now: true }); } },
    hideAll: { name: "hideAll", order: 3, title: "Hide Every Label From Players", icon: "fa-solid fa-eye-slash", button: true, onChange: () => { const L = canvas.atlasLabels; L?.change(showAll(L.labels, false), { now: true }); } },
  };
  let order = 4;
  for (const v of VIEWS) {
    if (v.id !== "physical" && !views.has(v.id)) continue;
    if (views.size === 0) break;
    tools[`view-${v.id}`] = { name: `view-${v.id}`, order: order++, title: `${v.label} View`, icon: v.icon, button: true, onChange: () => switchView(v.id) };
  }
  controls.atlasLabels = { name: "atlasLabels", order: 12, title: "AtlasScribe Labels and Views", icon: "fa-solid fa-signature", layer: "atlasLabels", visible: has, activeTool: "move", tools,
    // (the control activates its layer, as core's controls do theirs)
    onChange: (event, active) => { if (active) canvas.atlasLabels?.activate(); } };
}

/** Shows one of the map's views (its tile; none for the physical map) and hides the others. */
export async function switchView(id) {
  const scene = canvas?.scene;
  if (!scene || !game.user.isGM) return;
  const updates = viewChanges(scene.tiles.map((t) => ({ id: t.id, layer: t.flags?.[MOD]?.kind ?? null, alpha: t.alpha })), id);
  if (updates.length) await scene.updateEmbeddedDocuments("Tile", updates);
  ui.notifications.info(`AtlasScribe: the ${VIEWS.find((v) => v.id === id)?.label.toLowerCase() ?? id} view.`);
}

/** Registers the layer, its controls and keys (at init). */
export function registerLabels() {
  CONFIG.Canvas.layers.atlasLabels = { layerClass: AtlasLabelsLayer, group: "interface" };
  Hooks.on("getSceneControlButtons", addControls);
  Hooks.on("updateScene", (scene, changes) => {
    if (scene.id !== canvas?.scene?.id) return;
    if (foundry.utils.hasProperty(changes, `flags.${MOD}`)) canvas.atlasLabels?.refresh();
  });
  // (the controls appear when a scene first gets labels or views)
  // (only when it changes whether the scene has labels or views: a rebuild of the controls each save is wasted)
  let had = null;
  const recheck = () => { const has = hasLabels(canvas?.scene); if (has !== had) { had = has; ui.controls?.render({ reset: true }); } };
  Hooks.on("canvasReady", () => { had = hasLabels(canvas?.scene); });
  for (const h of ["createTile", "deleteTile"]) Hooks.on(h, (doc) => { if (doc.parent?.id === canvas?.scene?.id) recheck(); });
  // (a view switched: the cultural map's own names stand in for the realms')
  Hooks.on("updateTile", (doc, changes) => { if (doc.parent?.id === canvas?.scene?.id && "alpha" in changes && ["political", "cultural", "realms"].includes(doc.flags?.[MOD]?.kind)) canvas.atlasLabels?.refresh(); });
  Hooks.on("updateScene", (scene, changes) => { if (scene.id === canvas?.scene?.id && foundry.utils.hasProperty(changes, `flags.${MOD}`)) recheck(); });
  const keys = [["labelUp", "ArrowUp", "up"], ["labelDown", "ArrowDown", "down"], ["labelLeft", "ArrowLeft", "left"], ["labelRight", "ArrowRight", "right"], ["labelBendMore", "BracketRight", "bendMore"], ["labelBendLess", "BracketLeft", "bendLess"], ["labelOpen", "Enter", "open"]];
  const names = { up: "Move a Label Up", down: "Move a Label Down", left: "Move a Label Left", right: "Move a Label Right", bendMore: "Bend a Label Up", bendLess: "Bend a Label Down", open: "Edit a Label" };
  for (const [name, key, action] of keys) {
    game.keybindings.register(MOD, name, {
      name: names[action],
      hint: "On the AtlasScribe Labels layer, with a label picked (Tab picks one). Shift for bigger steps.",
      editable: [{ key }, ...(action === "open" ? [] : [{ key, modifiers: ["Shift"] }])],
      // (held down, a move or bend repeats, as the canvas's own pan would on these keys)
      repeat: action !== "open",
      restricted: true,
      precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY,
      onDown: (ctx) => canvas?.atlasLabels?.key(action, { shift: !!ctx?.isShift }) ?? false,
    });
  }
}
