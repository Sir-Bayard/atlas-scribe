/**
 * The inspector in the AtlasScribe window: a feature's settings (or the plan's) as a form in the side panel. Each
 * input carries data-field (the setting's name or path) and data-kind; the window reads a change with readInput and
 * applies it with setField or setPlanField from core/edit.mjs. Builds HTML only; the window owns the events.
 */
import { fieldsOf, planFieldsOf, featureOf, wordsFor } from "../core/edit.mjs";
import { rerollable } from "../core/seeds.mjs";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Words for a feature in the inspector's heading: "village district", "woods", "lane". */
export function kindOf(f) {
  if (!f) return "";
  if (f.type === "district") return `${f.profile === "roadside" ? "hamlet" : f.profile ?? "village"} district`;
  if (f.type === "area") return f.class ?? "area";
  if (f.type === "water") return f.class ?? "stream";
  if (f.type === "road") return f.class ?? "street";
  if (f.type === "wall") return f.class === "hedge" ? "hedge" : `${f.class ?? "drystone"} wall`;
  if (f.type === "crossing" || f.type === "prop") return f.class ?? f.type;
  return f.type;
}

/** One setting as a labelled input. */
function fieldHTML(field, disabled) {
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
      // A field that is always set (a kind) has no "default" choice
      const blank = field.name === "class" ? "" : `<option value="" ${set ? "" : "selected"}>${esc(auto ? `Default (${auto})` : "Default")}</option>`;
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
      if (!set && auto) input += `<p class="as-pv-auto">None ticked: ${esc(auto)}</p>`;
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
function groupsHTML(fields, disabled) {
  const main = fields.filter((f) => !f.more), more = fields.filter((f) => f.more);
  return `${main.map((f) => fieldHTML(f, disabled)).join("")}
    ${more.length ? `<details class="as-pv-more" ${more.some((f) => f.value !== undefined) ? "open" : ""}><summary>More</summary>${more.map((f) => fieldHTML(f, disabled)).join("")}</details>` : ""}`;
}

/** The inspector for one feature: its kind, reroll and lock (districts and areas), its settings, Delete. */
export function featureHTML(plan, id, { working = false } = {}) {
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
        <button type="button" data-action="asBack" data-tooltip="Back to the list"><i class="fa-solid fa-arrow-left"></i></button>
        <span class="as-pv-name"><strong>${esc(f.name ?? f.text ?? id)}</strong><em>${esc(kindOf(f))}${f.name || f.text ? ` · ${esc(id)}` : ""}</em></span>
        ${roll}
      </header>
      <div class="as-pv-fields">${fields.length ? groupsHTML(fields, working) : `<p class="as-pv-hint">Nothing to set.</p>`}${parts}</div>
      <div class="as-pv-tools">
        <button type="button" data-action="asDelete" data-id="${esc(id)}" class="as-danger" data-tooltip="Take it out of the plan (Undo brings it back)" ${working ? "disabled" : ""}><i class="fa-solid fa-trash"></i> Delete</button>
      </div>
    </section>`;
}

/** The plan's own settings: name, season, ground, size and scale, then the scene it's made into. */
export function planHTML(plan, { working = false } = {}) {
  const fields = planFieldsOf(plan);
  const main = fields.filter((f) => f.group !== "scene");
  const scene = fields.filter((f) => f.group === "scene");
  return `<section class="as-pv-insp" data-id="@plan">
      <header>
        <button type="button" data-action="asBack" data-tooltip="Back to the list"><i class="fa-solid fa-arrow-left"></i></button>
        <span class="as-pv-name"><strong>Plan settings</strong><em>${esc(plan.name ?? plan.id ?? "")}</em></span>
      </header>
      <div class="as-pv-fields">
        ${groupsHTML(main, working)}
        <details class="as-pv-more" ${scene.some((f) => f.value !== undefined) ? "open" : ""}><summary>Scene</summary>${scene.map((f) => fieldHTML(f, working)).join("")}</details>
      </div>
    </section>`;
}

/**
 * What a setting in the inspector says now, as setField takes it: a value, a list, or undefined (the default). el is
 * the element carrying data-field (for a list, the box round its checkboxes).
 */
export function readInput(el) {
  const kind = el.dataset.kind;
  if (kind === "list") return [...el.querySelectorAll("input[type=checkbox]:checked")].map((c) => c.value);
  if (kind === "boolean") return el.checked;
  const v = el.value;
  return v === "" ? undefined : v;
}
