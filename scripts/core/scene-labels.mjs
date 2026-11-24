/**
 * The labels an overland scene keeps for AtlasScribe's labels layer (foundry/labels-layer.mjs), in the scene's flag
 * `flags.atlas-scribe.labels`: each a name in scene pixels with its turn, bend, spacing, font and color, and whether
 * players see it. Made from a map's layout at Make Scene; a label the GM has moved, bent or edited is kept through
 * later updates, and the old text drawings of an overland scene are moved over. Pure.
 *
 * A label: { id, text, x, y (its middle, scene px), angle (degrees), size (px), font, color, alpha, bend, spacing (ems),
 * shown (players see it), edited (the GM changed it), ownText (the GM changed its words), home (the label as the map
 * made it: { text, x, y, angle, size, bend, spacing, color }, for Put Back) }.
 */
import { cleanBend, cleanSpacing } from "./label-curve.mjs";
import { LABEL_SIZES } from "./plan.mjs";

/** The font sizes a label can have, in px (room for an ocean's name on the biggest maps). */
export const SIZE = { min: 8, max: 512 };

const str = (s, d = "") => (typeof s === "string" ? s : d);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const round = (v, k = 10) => Math.round(v * k) / k;

/** A label as the layer can trust it: every field present and in range, or null when it has no id or text. */
export function cleanLabel(l) {
  if (!l || typeof l !== "object" || typeof l.id !== "string" || !l.id || typeof l.text !== "string" || !l.text.trim()) return null;
  return {
    id: l.id, text: l.text.replace(/\s+/g, " ").trim().slice(0, 200),
    x: round(num(l.x)), y: round(num(l.y)), angle: round(((num(l.angle) % 360) + 540) % 360 - 180),
    size: Math.round(Math.max(SIZE.min, Math.min(SIZE.max, num(l.size, 24)))),
    font: str(l.font, "Signika") || "Signika", color: /^#[0-9a-f]{6}$/i.test(str(l.color)) ? l.color : "#ffffff",
    alpha: Math.max(0.1, Math.min(1, num(l.alpha, 1))), bend: round(cleanBend(l.bend), 1000), spacing: round(cleanSpacing(l.spacing), 100),
    shown: l.shown === true, edited: l.edited === true, ownText: l.ownText === true, home: homeOf(l.home),
  };
}

const HOME = ["x", "y", "angle", "size", "bend", "spacing"];
/** A label's home as kept: its text and numbers, or null. */
function homeOf(h) {
  if (!h || typeof h !== "object" || typeof h.text !== "string") return null;
  const out = { text: h.text };
  for (const k of HOME) out[k] = num(h[k]);
  if (/^#[0-9a-f]{6}$/i.test(str(h.color))) out.color = h.color;
  return out;
}

/** The labels a scene keeps, cleaned, in order: [label]. */
export function labelsIn(flag) {
  return (Array.isArray(flag) ? flag : []).map(cleanLabel).filter(Boolean);
}

/**
 * An overland map's labels as the scene keeps them. layoutLabels: the layout's labels (map units, `em` the size in map
 * units); pps: pixels a map unit; sceneX, sceneY: the scene's padding. old: the labels the scene keeps now (a label the
 * GM changed stays as they left it while its name is still on the map, with the map's new words unless they changed
 * its words; every label keeps whether players see it); drawings:
 * an older scene's label drawings ({ feature, hidden, text }), whose shown or hidden state carries over. Returns
 * { labels, kept (how many of the GM's changed labels stayed), dropped (changes left behind with a thing the map no
 * longer has under that id) }. alive: the label ids whose thing is still on the map (a changed label the layout left
 * off is kept while its id is in it).
 */
export function sceneLabelsOf(layoutLabels, { pps, sceneX = 0, sceneY = 0, old = [], drawings = [], alive = null } = {}) {
  const before = new Map(labelsIn(old).map((l) => [l.id, l]));
  const drawn = new Map((drawings ?? []).filter((d) => d && typeof d.feature === "string").map((d) => [d.feature, d]));
  const out = [];
  let kept = 0, dropped = 0;
  for (const l of layoutLabels ?? []) {
    if (!l || typeof l.id !== "string" || !Array.isArray(l.at)) continue;
    const prev = before.get(l.id);
    const d = drawn.get(l.id);
    const shown = prev ? prev.shown : d ? d.hidden === false : l.show === "all";
    // (the map's names carry their size in map units; a GM's own plan label its size by name)
    const em = Number.isFinite(l.em) && l.em > 0 ? l.em : LABEL_SIZES[l.size] ?? LABEL_SIZES.normal;
    const rec = cleanLabel({
      id: l.id, text: l.text, x: sceneX + l.at[0] * pps, y: sceneY + l.at[1] * pps, angle: l.angle ?? 0, size: pps * em,
      font: l.font, color: l.color, alpha: l.alpha ?? 1, bend: l.bend ?? 0, spacing: l.spacing ?? 0, shown, edited: false,
    });
    if (!rec) continue;
    rec.home = homeOf(rec);
    // (an id the generator gave again to another thing, a town or realm placed anew elsewhere with other words, doesn't
    // take the GM's change to the old one: the map's words and place differ, and its home lies more than a few squares
    // off)
    const other = prev?.edited && prev.home && prev.home.text !== rec.text && Math.hypot(prev.home.x - rec.x, prev.home.y - rec.y) > 4 * pps;
    if (prev?.edited && !other) { out.push({ ...prev, ...(prev.ownText ? {} : { text: rec.text }), home: rec.home }); kept++; continue; }
    if (other) dropped++;
    out.push(other ? { ...rec, shown: prev.shown } : rec);
  }
  // (a name the GM changed that the layout left off this time, crowded out, stays as they left it while what it names
  // is still on the map)
  if (alive) {
    const placed = new Set(out.map((l) => l.id));
    for (const prev of before.values()) if (prev.edited && !placed.has(prev.id) && alive.has(prev.id)) { out.push(prev); kept++; }
  }
  return { labels: out, kept, dropped };
}

/**
 * A label changed by the GM (a patch of its fields): marked as theirs, so a later update keeps it, when a field the map
 * sets differs (whether players see it doesn't count), and its words as theirs when those differ. Returns a new list.
 */
// (how far a value may move under the window's steps and still be the same)
const SAME_WITHIN = { x: 0.05, y: 0.05, angle: 0.5, size: 0.5, bend: 0.006, spacing: 0.026 };

export function patchLabel(list, id, patch) {
  return labelsIn(list).map((l) => {
    if (l.id !== id) return l;
    const next = cleanLabel({ ...l, ...patch, id: l.id });
    if (!next) return l;
    // (a value the window's controls only rounded, or a color only written in other letters, is no change: the
    // label keeps its own, and isn't marked as the GM's)
    for (const [k, tol] of Object.entries(SAME_WITHIN)) if (Number.isFinite(next[k]) && Number.isFinite(l[k]) && Math.abs(next[k] - l[k]) <= tol) next[k] = l[k];
    if (typeof next.color === "string" && typeof l.color === "string" && next.color.toLowerCase() === l.color.toLowerCase()) next.color = l.color;
    const moved = ["text", "x", "y", "angle", "size", "font", "color", "alpha", "bend", "spacing"].some((k) => next[k] !== l[k]);
    return { ...next, edited: l.edited || moved, ownText: l.ownText || next.text !== l.text };
  });
}

/** Labels shown to players, or hidden from them, all at once (each keeps its other changes). Returns a new list. */
export function showAll(list, shown) {
  return labelsIn(list).map((l) => ({ ...l, shown: !!shown }));
}

/** A label put back as the map made it (its home), keeping whether players see it. Returns a new list. */
export function resetLabel(list, id) {
  return labelsIn(list).map((l) => (l.id !== id || !l.home ? l : cleanLabel({ ...l, ...l.home, edited: false, ownText: false })));
}
