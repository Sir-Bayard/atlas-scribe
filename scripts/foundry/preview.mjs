/**
 * The preview window: a plan laid out and drawn in plain colours in a second or so, with its districts and areas
 * outlined, so a reroll can be judged before a full render. Rerolling, locking and undoing happen here; the window
 * keeps the plan they make (app.plan), and Copy plan puts it on the clipboard. With Shapes on, districts and areas
 * show handles on their corners: drag one to reshape (corners two shapes share move together, and a corner dropped
 * on another snaps to it), drag the dot in the middle of a side to add a corner, alt-click or right-click a corner to
 * remove it. Scroll to zoom, drag to pan, double-click to fit.
 */
import { rerollable, rerollPlan, setLocked } from "../core/seeds.mjs";
import { shapeToPolygon } from "../core/geom.mjs";
import { normalize } from "../core/plan.mjs";
import { handlesOf, partnersOf, moveHandle, removeCorner, shapeProblem } from "../core/reshape.mjs";

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

export class PreviewApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "atlas-scribe-preview",
    classes: ["atlas-scribe", "as-preview"],
    tag: "div",
    window: { title: "AtlasScribe preview", icon: "fa-solid fa-map", resizable: true },
    position: { width: 1100, height: 760 },
    actions: {
      asReroll: PreviewApp.#onReroll,
      asRerollAll: PreviewApp.#onRerollAll,
      asLock: PreviewApp.#onLock,
      asUndo: PreviewApp.#onUndo,
      asCopy: PreviewApp.#onCopy,
      asOutlines: PreviewApp.#onOutlines,
      asFit: PreviewApp.#onFit,
      asShapes: PreviewApp.#onShapes,
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
  #shapes = false; // corner handles shown
  #handles = []; // handlesOf(plan) as drawn
  #edit = null; // the handle being dragged: { h, partners, plan, x, y, moved, next }

  constructor({ plan, run }, options = {}) {
    super(options);
    this.#plan = plan;
    this.#run = run;
  }

  /** Resolves once no draw is in flight. */
  async settled() {
    if (this.#drawing) await this.#drawing;
  }

  /** The plan as it stands now, with any rerolls and locks made here (a copy). */
  get plan() {
    return structuredClone(this.#plan);
  }

  /** Shows a new plan (the undo history starts again) and draws it; run replaces the drawing function if given. */
  async show(plan, run = null) {
    if (this.#drawing) await this.#drawing;
    if (run) this.#run = run;
    this.#plan = plan;
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
    this.#drawing = go().finally(() => { this.#drawing = null; });
    return this.#drawing;
  }

  #markBusy() {
    this.element?.querySelector(".as-pv-map")?.classList.add("as-busy");
    for (const b of this.element?.querySelectorAll("[data-action^='asRe'], [data-action='asLock'], [data-action='asUndo']") ?? []) b.disabled = true;
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

  async _renderHTML() {
    const el = document.createElement("div");
    el.className = "as-pv";
    const r = this.#result;
    const feats = this.#features();
    const [MW, MH] = r?.squares ?? this.#plan?.size?.squares ?? [1, 1];
    const fs = Math.max(MW, MH) / 55;
    const shapes = feats.filter((f) => f.poly.length >= 3).map((f) => {
      const [cx, cy] = centroid(f.poly);
      return `<g class="as-pv-shape as-${f.type}" data-id="${esc(f.id)}">
          <polygon points="${f.poly.map((p) => p.join(",")).join(" ")}" vector-effect="non-scaling-stroke"></polygon>
          <text x="${cx}" y="${cy}" data-fs="${fs}">${esc(f.name ?? f.id)}</text></g>`;
    }).join("");
    this.#handles = this.#shapes && r ? handlesOf(this.#plan) : [];
    const handles = this.#handles.map((h, n) => `<circle class="as-pv-handle as-${h.kind}" data-h="${n}" data-id="${esc(h.id)}" cx="${h.at[0]}" cy="${h.at[1]}" r="0.3"></circle>`).join("");
    const labels = (r?.labels ?? []).filter((l) => Array.isArray(l.at)).map((l) => `<text class="as-pv-label" x="${l.at[0]}" y="${l.at[1]}" data-fs="${fs * 0.85}">${esc(l.text)}</text>`).join("");
    const map = r
      ? `<div class="as-pv-stage" style="width:${r.width}px;height:${r.height}px">
          <img src="${this.#url}" width="${r.width}" height="${r.height}" alt="" draggable="false">
          <svg class="as-pv-overlay ${this.#outlines ? "" : "as-off"}" viewBox="0 0 ${MW} ${MH}" preserveAspectRatio="none">${shapes}${labels}${handles}</svg>
        </div>`
      : "";
    const rows = feats.map((f) => `<li data-id="${esc(f.id)}" class="${f.locked ? "as-locked" : ""}">
        <span class="as-pv-name"><strong>${esc(f.name ?? f.id)}</strong><em>${esc(f.type === "district" ? `${f.kind} district` : f.kind)}</em></span>
        <button type="button" data-action="asReroll" data-id="${esc(f.id)}" data-tooltip="Reroll" ${f.locked || this.#busy ? "disabled" : ""}><i class="fa-solid fa-dice"></i></button>
        <button type="button" data-action="asLock" data-id="${esc(f.id)}" data-tooltip="${f.locked ? "Locked: rerolls leave it alone. Click to unlock." : "Lock, so rerolls leave it alone"}" class="${f.locked ? "as-on" : ""}" ${this.#busy ? "disabled" : ""}><i class="fa-solid ${f.locked ? "fa-lock" : "fa-lock-open"}"></i></button>
      </li>`).join("");
    const notes = (r?.notes ?? []);
    const time = r ? `${r.squares[0]} by ${r.squares[1]} squares, drawn in ${(r.ms / 1000).toFixed(1)} s` : "";
    el.innerHTML = `
      <div class="as-pv-map ${this.#busy ? "as-busy" : ""} ${this.#stale ? "as-stale" : ""}">
        ${map}
        <div class="as-pv-wait"><i class="fa-solid fa-spinner fa-spin"></i> Drawing</div>
        ${this.#error ? `<p class="as-pv-error">${esc(this.#error)}</p>` : ""}
      </div>
      <aside class="as-pv-side">
        <header>
          <h3>${esc(this.#plan?.name ?? this.#plan?.id ?? "Plan")}</h3>
          <p class="as-pv-hint">${esc(time)}</p>
        </header>
        <div class="as-pv-tools">
          <button type="button" data-action="asRerollAll" ${this.#busy ? "disabled" : ""}><i class="fa-solid fa-dice"></i> Reroll all</button>
          <button type="button" data-action="asUndo" ${this.#history.length && !this.#busy ? "" : "disabled"} data-tooltip="Back to the plan before the last change"><i class="fa-solid fa-rotate-left"></i> Undo</button>
        </div>
        <ul class="as-pv-list">${rows || `<li class="as-pv-hint">This plan has no districts or areas to reroll.</li>`}</ul>
        ${notes.length ? `<details class="as-pv-notes"><summary>${notes.length} note${notes.length === 1 ? "" : "s"}</summary><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></details>` : ""}
        <div class="as-pv-tools">
          <button type="button" data-action="asOutlines" class="${this.#outlines ? "as-on" : ""}"><i class="fa-solid fa-draw-polygon"></i> Outlines</button>
          <button type="button" data-action="asShapes" class="${this.#shapes ? "as-on" : ""}" data-tooltip="Drag corners to reshape districts and areas; drag a side's middle dot to add a corner; alt-click or right-click a corner to remove it" ${this.#busy ? "disabled" : ""}><i class="fa-solid fa-vector-square"></i> Shapes</button>
          <button type="button" data-action="asFit" data-tooltip="Fit the map to the window (or double-click it)"><i class="fa-solid fa-expand"></i> Fit</button>
          <button type="button" data-action="asCopy" data-tooltip="Copy the plan, with its rerolls and locks, as JSON"><i class="fa-solid fa-copy"></i> Copy plan</button>
        </div>
        <p class="as-pv-hint">${this.#shapes ? "Drag a corner to reshape; corners districts share move together. A turned area can't be reshaped here yet." : "A quick sketch in plain colours. Scroll to zoom, drag to move."}</p>
      </aside>`;
    return el;
  }

  _replaceHTML(result, content) {
    const top = content.querySelector(".as-pv-list")?.scrollTop ?? 0;
    content.replaceChildren(result);
    const list = content.querySelector(".as-pv-list");
    if (list) list.scrollTop = top;
    this.#applyView();
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
      if (handle && !this.#busy) {
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
      if (!this.#drag) return;
      if (ev.buttons === 0) return stop(); // released where we couldn't see it (the map was redrawn mid-drag)
      const d = this.#drag;
      this.#view = { k: d.k, tx: d.tx + ev.clientX - d.x, ty: d.ty + ev.clientY - d.y };
      this.#applyView();
    });
    el.addEventListener("pointerup", (ev) => {
      if (this.#edit) return this.#editEnd(ev);
      stop();
    });
    el.addEventListener("pointercancel", () => {
      if (this.#edit) { this.#edit = null; this.render(); } // put the outline back
      stop();
    });
    el.addEventListener("lostpointercapture", () => { if (!this.#edit) stop(); });
    el.addEventListener("contextmenu", (ev) => { if (ev.target.closest?.(".as-pv-handle")) ev.preventDefault(); });
    el.addEventListener("dblclick", (ev) => {
      if (!ev.target.closest?.(".as-pv-map")) return;
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
    this.#resize?.disconnect();
    this.#resize = null;
    if (this.#url) URL.revokeObjectURL(this.#url);
    this.#url = null;
    this.#result = null;
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
      for (const o of this.#handles) {
        if (o.kind !== "corner" || moving.has(o.id)) continue;
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
    const before = new Map((this.#plan.features ?? []).map((f) => [f.id, JSON.stringify(f.shape)]));
    const changed = (next.features ?? []).filter((f) => before.get(f.id) !== JSON.stringify(f.shape));
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
    if (this.#busy) return;
    const { plan, rerolled } = rerollPlan(this.#plan, target.dataset.id);
    if (rerolled.length) await this.#change(plan);
  }

  static async #onRerollAll() {
    if (this.#busy) return;
    const { plan, rerolled } = rerollPlan(this.#plan);
    if (rerolled.length) await this.#change(plan);
    else ui.notifications.info("AtlasScribe: everything is locked, so there's nothing to reroll.");
  }

  static async #onLock(event, target) {
    if (this.#busy) return;
    const id = target.dataset.id;
    const on = !(Array.isArray(this.#plan?.locked) && this.#plan.locked.includes(id));
    this.#remember();
    this.#plan = setLocked(this.#plan, id, on);
    this.render(); // locking changes nothing on the map
  }

  static async #onUndo() {
    if (this.#busy || !this.#history.length) return;
    const before = this.#history.pop();
    const map = (p) => JSON.stringify({ ...p, locked: null }); // everything but the locks changes the map
    const sameMap = map(before) === map(this.#plan);
    this.#plan = before;
    if (sameMap) this.render();
    else await this.#draw();
  }

  static async #onCopy() {
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
