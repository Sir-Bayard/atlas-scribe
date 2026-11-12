/**
 * The inspector in the AtlasScribe window: a feature's settings (or the plan's) as a form in the side panel. Each
 * input carries data-field (the setting's name or path) and data-kind; the window reads a change with readInput and
 * applies it with setField or setPlanField from core/edit.mjs. Builds HTML only; the window owns the events.
 */
import { useLabel } from "../core/uses.mjs";
import { fieldsOf, planFieldsOf, featureOf, wordsFor } from "../core/edit.mjs";
import { rerollable } from "../core/seeds.mjs";
import { TOOLS } from "../core/draw.mjs";
import { OLD_PROFILES } from "../core/plan.mjs";
import { cleanFont } from "../core/labels.mjs";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Words for a feature in the inspector's heading: "village district", "woods", "lane". */
export function kindOf(f) {
  if (!f) return "";
  if (f.type === "district") return `${OLD_PROFILES[f.profile] ?? f.profile ?? "village"} district`;
  if (f.type === "area") return f.class ?? "area";
  if (f.type === "height") return Number(f.height) < 0 ? "hollow" : "rise";
  if (f.type === "water") return f.class ?? "stream";
  if (f.type === "road") return f.class ?? "street";
  if (f.type === "wall") return f.class === "hedge" || f.class === "palisade" || f.class === "cliff" ? f.class : `${f.class ?? "drystone"} wall`;
  if (f.type === "crossing" || f.type === "prop" || f.type === "dock") return f.class ?? f.type;
  return f.type;
}

/** One setting as a labeled input. */
function fieldHTML(field, disabled, fonts = []) {
  const id = `as-f-${field.name.replace(/[^a-z0-9]/gi, "-")}`;
  const set = field.value !== undefined && field.value !== null;
  // What applies when it's left empty: words, or the default value (bare in a number box, which shows its unit beside it)
  const auto = field.auto === null || field.auto === undefined ? ""
    : typeof field.auto === "string" && !(field.values ?? []).includes(field.auto) ? field.auto
    : typeof field.auto === "number" ? String(field.auto) : wordsFor(field, field.auto);
  const dis = disabled ? "disabled" : "";
  const data = `data-field="${esc(field.name)}" data-kind="${esc(field.kind)}"`;
  let input;
  switch (field.kind) {
    case "enum": {
      const opts = field.values.map((v) => `<option value="${esc(v)}" ${set && field.value === v ? "selected" : ""}>${esc(field.names?.[v] ?? v)}</option>`).join("");
      // A field that is always set (a kind) has no "default" choice; nor has one that sets something else (a building
      // group's roof sets each building's), which shows what's there when it differs ("mixed") and can't be picked
      const blank = field.name === "class" ? ""
        : field.required ? (set ? "" : `<option value="" selected disabled>${esc(auto || "mixed")}</option>`)
        : `<option value="" ${set ? "" : "selected"}>${esc(auto ? `Default (${auto})` : "Default")}</option>`;
      input = `<select id="${id}" ${data} ${dis}>${blank}${opts}</select>`;
      break;
    }
    case "tristate":
      input = `<select id="${id}" ${data} ${dis}>
          <option value="" ${set ? "" : "selected"}>${esc(auto ? `Default (${auto})` : "Default")}</option>
          <option value="yes" ${field.value === true ? "selected" : ""}>yes</option>
          <option value="no" ${field.value === false ? "selected" : ""}>no</option></select>`;
      break;
    case "boolean": {
      const on = set ? !!field.value : !!field.auto;
      input = `<input type="checkbox" id="${id}" ${data} ${on ? "checked" : ""} ${dis}>`;
      break;
    }
    case "list": {
      const chosen = new Set(Array.isArray(field.value) ? field.value : []);
      input = `<div class="as-pv-checks" id="${id}" ${data}>${field.values.map((v) => `<label><input type="checkbox" value="${esc(v)}" ${chosen.has(v) ? "checked" : ""} ${dis}> ${esc(field.names?.[v] ?? v)}</label>`).join("")}</div>`;
      if (!set && auto) input += `<p class="as-pv-auto">None checked: ${esc(auto)}</p>`;
      break;
    }
    case "color": {
      // A color box shows the color in use: the label's own, or the plan's when it's left as the default
      const shown = /^#[0-9a-f]{6}$/i.test(field.value ?? "") ? field.value : /^#[0-9a-f]{6}$/i.test(field.auto ?? "") ? field.auto : "#13202e";
      input = `<input type="color" id="${id}" ${data} value="${esc(shown)}" ${dis}>${set ? "" : `<span class="as-pv-auto-inline">${esc(`Default (${field.auto ?? "plan's"})`)}</span>`}`;
      break;
    }
    case "font": {
      const list = [...new Set([...fonts, ...(set && !fonts.includes(field.value) ? [field.value] : [])])];
      const opts = list.map((v) => `<option value="${esc(v)}" ${set && field.value === v ? "selected" : ""} style="font-family: '${esc(cleanFont(v) ?? "")}'">${esc(v)}</option>`).join("");
      input = `<select id="${id}" ${data} ${dis}><option value="" ${set ? "" : "selected"}>${esc(field.auto ? `Default (${field.auto})` : "Default")}</option>${opts}</select>`;
      break;
    }
    case "number":
    case "share": {
      const min = field.kind === "share" ? 0 : field.min, max = field.kind === "share" ? 1 : field.max;
      const step = field.step ?? (max !== null && max !== undefined && max <= 2 ? 0.05 : 1);
      input = `<input type="number" id="${id}" ${data} value="${set ? esc(field.value) : ""}" placeholder="${esc(auto)}"
          ${min !== null && min !== undefined ? `min="${min}"` : ""} ${max !== null && max !== undefined ? `max="${max}"` : ""} step="${step}" ${dis}>`;
      break;
    }
    default:
      input = `<input type="text" id="${id}" ${data} value="${set ? esc(field.value) : ""}" placeholder="${esc(auto)}" ${dis}>`;
  }
  const unit = field.unit && field.kind === "number" ? `<span class="as-pv-unit">${esc(field.unit)}</span>` : "";
  // Back to the default: shown only when the plan sets it (a kind can't be cleared)
  const reset = field.required ? ""
    : set && field.name !== "class" && field.kind !== "boolean"
    ? `<button type="button" class="as-pv-reset" data-action="asReset" data-field="${esc(field.name)}" data-tooltip="Back to the default" ${dis}><i class="fa-solid fa-rotate-left"></i></button>`
    : field.kind === "boolean" && set ? `<button type="button" class="as-pv-reset" data-action="asReset" data-field="${esc(field.name)}" data-tooltip="Back to the default (${esc(wordsFor(field, field.auto))})" ${dis}><i class="fa-solid fa-rotate-left"></i></button>` : "";
  return `<div class="as-pv-field as-k-${esc(field.kind)} ${set ? "as-set" : ""}">
      <label for="${id}" ${field.help ? `data-tooltip="${esc(field.help)}"` : ""}>${esc(field.label)}</label>
      <div class="as-pv-input">${input}${unit}${reset}</div>
    </div>`;
}

/** Settings in two groups: the usual ones, then the rest under "More". */
function groupsHTML(fields, disabled, fonts) {
  const main = fields.filter((f) => !f.more), more = fields.filter((f) => f.more);
  return `${main.map((f) => fieldHTML(f, disabled, fonts)).join("")}
    ${more.length ? `<details class="as-pv-more" ${more.some((f) => f.value !== undefined) ? "open" : ""}><summary>More</summary>${more.map((f) => fieldHTML(f, disabled, fonts)).join("")}</details>` : ""}`;
}

/** The inspector for one feature: its kind, reroll and lock (districts and areas), its settings, Delete. */
export function featureHTML(plan, id, { working = false, fonts = [] } = {}) {
  const f = featureOf(plan, id);
  if (!f) return "";
  const fields = fieldsOf(plan, id);
  const locked = Array.isArray(plan.locked) && plan.locked.includes(id);
  const roll = rerollable(f)
    ? `<button type="button" data-action="asReroll" data-id="${esc(id)}" data-tooltip="Reroll" ${locked || working ? "disabled" : ""}><i class="fa-solid fa-dice"></i></button>
       <button type="button" data-action="asLock" data-id="${esc(id)}" data-tooltip="${locked ? "Locked: rerolls leave it alone. Click to unlock." : "Lock, so rerolls leave it alone"}" class="${locked ? "as-on" : ""}" ${working ? "disabled" : ""}><i class="fa-solid ${locked ? "fa-lock" : "fa-lock-open"}"></i></button>`
    : "";
  const parts = f.type === "landmark" && Array.isArray(f.buildings) ? `<p class="as-pv-hint">${f.buildings.length} building${f.buildings.length === 1 ? "" : "s"}; their own settings can't be changed here yet.</p>` : "";
  return `<section class="as-pv-insp" data-id="${esc(id)}">
      <header>
        <button type="button" data-action="asBack" data-tooltip="Back to the list" aria-label="Back to the list"><i class="fa-solid fa-arrow-left"></i></button>
        <span class="as-pv-name"><strong>${esc(f.name ?? f.text ?? id)}</strong><em>${esc(kindOf(f))}${f.name || f.text ? ` · ${esc(id)}` : ""}</em></span>
        ${roll}
      </header>
      <div class="as-pv-fields">${fields.length ? groupsHTML(fields, working, fonts) : `<p class="as-pv-hint">Nothing to set.</p>`}${parts}</div>
      <div class="as-pv-tools">
        ${f.type === "district" ? `<button type="button" data-action="asWallIn" data-id="${esc(id)}" data-tooltip="A town wall around it, just outside its edge, with a gate wherever a road crosses" ${working ? "disabled" : ""}><i class="fa-solid fa-chess-rook"></i> Wall in</button>` : ""}
        <button type="button" data-action="asDelete" data-id="${esc(id)}" class="as-danger" data-tooltip="Take it out of the plan (Undo brings it back)" ${working ? "disabled" : ""}><i class="fa-solid fa-trash"></i> Delete</button>
      </div>
    </section>`;
}

/** What the panel calls a trade's building, where its name alone is the worker ("a farrier" is a person). */
const PLACE = {
  farrier: "farrier's forge", gunsmith: "gunsmith's forge", carpenter: "carpenter's shop", cooper: "cooper's shop",
  wheelwright: "wheelwright's shop", butcher: "butcher's shop", alchemist: "alchemist's workshop", inventor: "inventor's workshop",
};

/**
 * The panel for something the generator made (a house or a district's street), picked on the map: what it is, and
 * Pin, which copies it into the plan so rerolls keep it. gen: { kind: "house" | "street", item }. nameOf: a
 * feature's name for the words (its name, else its id).
 */
export function generatedHTML(gen, { working = false, nameOf = (id) => id } = {}) {
  const { kind, item } = gen;
  const where = nameOf(item.from);
  // A building of its own or a house put to a use is called by its use ("A smithy", "A temple of 4 parts")
  const use = kind === "house" ? item.parts[0]?.use ?? "house" : null;
  const called = use ? (useLabel(use) ?? "House") : null;
  const named = use ? (PLACE[use] ?? called.toLowerCase()) : null; // a trade by its place: "a farrier's forge"
  const article = named && /^[aeiou]/i.test(named) ? "An" : "A";
  const what = kind === "house"
    ? `${item.parts.length > 1 ? `${article} ${named} of ${item.parts.length} parts` : `${article} ${named}`} the generator built in ${where}.`
    : `A ${item.class === "back" ? "back lane" : item.class === "street" ? "street" : "lane"} the generator laid out in ${where}${item.crossings?.length ? `, with ${item.crossings.length === 1 ? "a bridge" : `${item.crossings.length} bridges`}` : ""}.`;
  const fixed = kind === "house" && item.pinnable === false; // a district's centerpiece: its setting makes it
  const after = fixed
    ? `${where}'s centerpiece, made by its Centerpiece setting: it stays where it is through rerolls while that's on, so it can't be pinned. Turn the setting off to give its ground to houses.`
    : kind === "house"
    ? "Pinned, it becomes a fixed building group in the plan, its buildings drawn exactly as they are now (a walled yard or grounds around them aren't kept); you can then name it, label it and change its roofs. The rest of the district still rerolls around it."
    : "Pinned, it becomes a road in the plan along the same line, and stays when the district is rerolled; the district's other streets then follow it, so they change.";
  return `<section class="as-pv-insp" data-id="${esc(`@gen:${item.id}`)}">
      <header>
        <button type="button" data-action="asBack" data-tooltip="Back to the list" aria-label="Back to the list"><i class="fa-solid fa-arrow-left"></i></button>
        <span class="as-pv-name"><strong>${esc(kind === "house" ? called : item.class === "street" ? "Street" : "Lane")}</strong><em>generated · ${esc(item.id)}</em></span>
      </header>
      <div class="as-pv-fields">
        <p class="as-pv-hint">${esc(what)}</p>
        <p class="as-pv-hint">${esc(after)}</p>
      </div>
      <div class="as-pv-tools">
        <button type="button" data-action="asPin" ${working || fixed ? "disabled" : ""} data-tooltip="${fixed ? "Its district's Centerpiece setting keeps it" : "Keep it when the district is rerolled"}"><i class="fa-solid fa-thumbtack"></i> Pin</button>
      </div>
    </section>`;
}

/**
 * The underlay's panel: the image under the sketch to trace over. Opacity, shown, locked, where it sits (its
 * height follows its shape), another image, or none. Inputs carry data-under; the window reads them.
 */
export function underlayHTML(u, { working = false } = {}) {
  const [x0, y0, x1, y1] = u.rect;
  const num = (key, label, value, step = 0.5) => `<div class="as-pv-field"><label>${esc(label)}</label><div class="as-pv-input"><input type="number" data-under="${key}" value="${Math.round(value * 100) / 100}" step="${step}"><span class="as-pv-unit">squares</span></div></div>`;
  const box = (key, label, on, help) => `<div class="as-pv-field as-k-boolean"><label data-tooltip="${esc(help)}">${esc(label)}</label><div class="as-pv-input"><input type="checkbox" data-under="${key}" ${on ? "checked" : ""}></div></div>`;
  return `<section class="as-pv-insp" data-id="@underlay">
      <header>
        <button type="button" data-action="asBack" data-tooltip="Back to the list" aria-label="Back to the list"><i class="fa-solid fa-arrow-left"></i></button>
        <span class="as-pv-name"><strong>Underlay</strong><em>${esc(u.path.split("/").pop())}</em></span>
      </header>
      <div class="as-pv-fields">
        <p class="as-pv-hint">An image under the sketch to trace over. ${u.locked ? "It's locked: unlock it to move it." : "Drag it on the map to move it, or a corner to scale it."} It's saved with the plan and never painted into the scene.</p>
        <div class="as-pv-field"><label>Opacity</label><div class="as-pv-input"><input type="range" data-under="opacity" min="0.05" max="1" step="0.05" value="${u.opacity}"></div></div>
        ${box("shown", "Shown", u.shown, "Hide it without losing where it sits")}
        ${box("locked", "Locked", u.locked, "Locked, it can't be dragged by accident")}
        ${num("left", "Left", x0)}
        ${num("top", "Top", y0)}
        ${num("width", "Width", x1 - x0)}
      </div>
      <div class="as-pv-tools">
        <button type="button" data-action="asUnderPick" ${working ? "disabled" : ""}><i class="fa-solid fa-folder-open"></i> Another image</button>
        <button type="button" data-action="asUnderRemove" class="as-danger" ${working ? "disabled" : ""}><i class="fa-solid fa-trash"></i> Remove</button>
      </div>
    </section>`;
}

/** The plan's own settings: name, season, ground, size and scale, then the scene it's made into. */
export function planHTML(plan, { working = false, fonts = [] } = {}) {
  const fields = planFieldsOf(plan);
  const main = fields.filter((f) => f.group !== "scene");
  const scene = fields.filter((f) => f.group === "scene");
  return `<section class="as-pv-insp" data-id="@plan">
      <header>
        <button type="button" data-action="asBack" data-tooltip="Back to the list" aria-label="Back to the list"><i class="fa-solid fa-arrow-left"></i></button>
        <span class="as-pv-name"><strong>Plan settings</strong><em>${esc(plan.name ?? plan.id ?? "")}</em></span>
      </header>
      <div class="as-pv-fields">
        ${groupsHTML(main, working, fonts)}
        <details class="as-pv-more" ${scene.some((f) => f.value !== undefined) ? "open" : ""}><summary>Scene</summary>${scene.map((f) => fieldHTML(f, working, fonts)).join("")}</details>
      </div>
    </section>`;
}

/**
 * What a setting in the inspector says now, as setField takes it: a value, a list, or undefined (the default). el is
 * the element carrying data-field (for a list, the box around its checkboxes).
 */
export function readInput(el) {
  const kind = el.dataset.kind;
  if (kind === "list") return [...el.querySelectorAll("input[type=checkbox]:checked")].map((c) => c.value);
  if (kind === "boolean") return el.checked;
  const v = el.value;
  return v === "" ? undefined : v;
}

/** How to use each kind of tool, for the hint under the palette. */
const HOW = {
  shape: "Click each corner (double-click or Enter to finish), or drag a box. Corners snap to other districts' and areas' corners and sides, and to the map's edge.",
  box: "Drag a box, or click to place one of the usual size.",
  path: "Click each point (double-click or Enter to finish). Points snap onto a road (water onto water, a wall onto a wall) or the map's edge.",
  loop: "Click each point (double-click or Enter to finish, or click the first point to close it around). Points snap onto another wall or the map's edge.",
  sea: "Click each corner of the water (double-click or Enter to finish), or drag a box. Corners near the map's edge go past it, so the coast is its only shore.",
  quay: "Click points along the water's edge (double-click or Enter to finish). It's moved onto the nearest edge, and paved back from the water.",
  pier: "Click from the shore out into the water (double-click or Enter to finish).",
  cliff: "Click points along its top edge (double-click or Enter to finish). The drop is on your left as you go; its Drop setting turns it.",
  height: "Click each corner (double-click or Enter to finish), or drag a box. Battle maps only: its corners are rounded as ground lies, its edge is drawn as a cliff, bank or slope, and a token's elevation follows it.",
  point: "Click where it goes.",
  battle: "Drag a box over the area to fight in, or click to place one of the size picked below.",
};

/** The hint under the palette: how to use the tool, and the points so far. */
export function howText(tool, points) {
  return `${HOW[tool.how ?? (tool.closes ? "loop" : tool.geometry)]}${points ? ` ${points} point${points === 1 ? "" : "s"} so far; Backspace removes the last.` : ""} Esc cancels.`;
}

/** The drawing palette: a button per tool, the one in use lit, with how to use it and Finish and Cancel. */
export function paletteHTML(tool, { points = 0, working = false } = {}) {
  const groups = [["Areas", ["district", "woods", "fields", "park", "cemetery", "farmstead", "yard", "square"]], ["Buildings", ["building", "windmill", "watermill"]], ["Lines", ["road", "lane", "track", "wall", "hedge", "townwall", "palisade", "cliff"]], ["Ground", ["rise", "hollow"]], ["Water", ["river", "stream", "pond", "lake", "sea", "quay", "pier", "boat", "ship"]], ["Points", ["bridge", "ford", "tree", "well", "cart", "fountain", "cross", "crane", "label"]]];
  const by = new Map(TOOLS.map((t) => [t.id, t]));
  const active = tool ? by.get(tool) : null;
  return `<section class="as-pv-insp as-pv-palette">
      <header>
        <button type="button" data-action="asBack" data-tooltip="Back to the list" aria-label="Back to the list"><i class="fa-solid fa-arrow-left"></i></button>
        <span class="as-pv-name"><strong>Draw</strong><em>${esc(active ? `a new ${active.label.toLowerCase()}` : "pick what to add")}</em></span>
      </header>
      <div class="as-pv-fields">
        ${groups.map(([name, ids]) => `<p class="as-pv-group">${esc(name)}</p><div class="as-pv-tools-grid">${ids.map((id) => {
          const t = by.get(id);
          return `<button type="button" data-action="asTool" data-tool="${esc(id)}" class="${tool === id ? "as-on" : ""}" ${working ? "disabled" : ""}><i class="fa-solid ${esc(t.icon)}"></i> ${esc(t.label)}</button>`;
        }).join("")}</div>`).join("")}
        ${active ? `<p class="as-pv-hint as-pv-how">${esc(howText(active, points))}</p>` : ""}
      </div>
      ${active && active.geometry !== "point" && active.geometry !== "box" ? `<div class="as-pv-tools">
        <button type="button" data-action="asFinish" ${points >= (active.geometry === "path" ? 2 : 3) && !working ? "" : "disabled"}><i class="fa-solid fa-check"></i> Finish</button>
        <button type="button" data-action="asStopTool"><i class="fa-solid fa-xmark"></i> Cancel</button>
      </div>` : ""}
    </section>`;
}

/** What the Battle map tool's box makes: its size in battle squares and feet, with a word when it's big. */
export function battleSizeText({ box, size, big, limit, tooBig, most }) {
  if (!box || !size) return "No box yet.";
  return `${size[0]} x ${size[1]} squares (${size[0] * 5} x ${size[1] * 5} ft).${tooBig ? ` Over ${most} squares a side: too big for one image, so it can't be made. Drag a smaller box.` : big ? ` Over ${limit} squares a side: slow to make and heavy to play, but it can be made.` : ""}`;
}

/**
 * The Battle map tool's panel: how to place the box, the zoom, the sizes a click places, the box's size, and Make
 * battle map. st: the window's #battleState().
 */
export function battleHTML(st) {
  const zoomLabel = (z) => (z === 1 ? "True size" : z === 1.5 ? "1.5 times true size" : `${z} times true size`);
  return `<section class="as-pv-insp as-pv-palette as-pv-battle">
      <header>
        <button type="button" data-action="asBattle" data-tooltip="Back to the list" aria-label="Back to the list" ${st.working ? "disabled" : ""}><i class="fa-solid fa-arrow-left"></i></button>
        <span class="as-pv-name"><strong>Battle map</strong><em>an area of this map, at battle size</em></span>
      </header>
      <div class="as-pv-fields">
        <p class="as-pv-hint as-pv-how">${esc(HOW.battle)} Its streets, water, squares and notable buildings stay where they are here; its houses are built again at battle size.</p>
        <div class="as-pv-field"><label for="as-pv-battle-zoom">Zoom</label><select id="as-pv-battle-zoom" data-battle-zoom ${st.working ? "disabled" : ""}>${st.zooms.map((z) => `<option value="${z}" ${z === st.zoom ? "selected" : ""}>${esc(zoomLabel(z))}</option>`).join("")}</select></div>
        <p class="as-pv-group">A click places</p>
        <div class="as-pv-tools-grid">${st.presets.map((n) => `<button type="button" data-action="asBattlePreset" data-size="${n}" class="${n === st.preset ? "as-on" : ""}" aria-pressed="${n === st.preset}" ${st.working ? "disabled" : ""}>${n} x ${n}</button>`).join("")}</div>
        <p class="as-pv-group">The box</p>
        <p class="as-pv-hint as-pv-battle-size ${st.big ? "as-warn" : ""}">${esc(battleSizeText(st))}</p>
      </div>
      <div class="as-pv-tools">
        <button type="button" data-action="asBattleMake" ${st.placed && !st.working && !st.tooBig ? "" : "disabled"} data-tooltip="Make the battle map and open it here (save it to keep it)"><i class="fa-solid ${st.zooming ? "fa-spinner fa-spin" : "fa-chess-board"}"></i> ${st.zooming ? "Making it" : "Make battle map"}</button>
        ${st.zooming ? `<button type="button" data-action="asBattleStop"><i class="fa-solid fa-stop"></i> Stop</button>` : `<button type="button" data-action="asBattle" ${st.working ? "disabled" : ""}><i class="fa-solid fa-xmark"></i> Cancel</button>`}
      </div>
    </section>`;
}
