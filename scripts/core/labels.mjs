/**
 * Labels: where each one sits and how it looks, worked out from the plan. A label is placed (at: [x, y]) or follows a
 * district or area (of: its id), sitting at a point well inside it plus its offset, and showing its name unless it
 * has text of its own. A label can be turned (angle, degrees clockwise), and has its own color, font and opacity,
 * each falling back to the plan's (output.scene.labelColor, labelFont). A label dropped on a road or water takes the
 * line's angle there, turned so it never reads upside down.
 * Pure: runs in the worker, on the page and under node.
 */
import { normalize, isObj, LABEL_SIZES } from "./plan.mjs";
import { shapeToPolygon, insidePoint, distanceToPath, pointInPolygon } from "./geom.mjs";
import { smoothPlanPaths } from "./smooth.mjs";
import { USE_INFO, useLabel } from "./uses.mjs";

const isPt = (p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "number" && Number.isFinite(v));
const HEX = /^#[0-9a-f]{6}$/i;
/** A font name as it can be used: letters, numbers, spaces, dots and dashes (nothing that could break out of CSS). */
export const cleanFont = (v) => (typeof v === "string" && /^[\p{L}\p{N} _.-]+$/u.test(v.trim()) ? v.trim() : null);

/** The middle of a polygon by its area (so a corner added on a side doesn't move it), or null for no area. */
function areaCentroid(poly) {
  let a = 0, x = 0, y = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length], c = x1 * y2 - x2 * y1;
    a += c; x += (x1 + x2) * c; y += (y1 + y2) * c;
  }
  return Math.abs(a) < 1e-9 ? null : [x / (3 * a), y / (3 * a)];
}

/** The point a feature's name label sits at when it has no offset: well inside its shape. Null if it has none. */
export function anchorOf(f) {
  // A region's place: where it stands
  if (f?.type === "place") return isPt(f.at) ? f.at : null;
  // A landmark's (a pinned house's): the middle of its first building
  if (f?.type === "landmark") {
    const b = Array.isArray(f.buildings) ? f.buildings[0] : null;
    try {
      const poly = b?.shape ? shapeToPolygon(b.shape, b.rot ?? 0) : [];
      return poly.length >= 3 && poly.every(isPt) ? areaCentroid(poly) ?? insidePoint(poly) : null;
    } catch {
      return null;
    }
  }
  if (!f || !(f.type === "district" || f.type === "area") || !f.shape) return null;
  try {
    const poly = shapeToPolygon(f.shape, f.type === "area" ? f.rot ?? 0 : 0);
    if (poly.length < 3 || !poly.every(isPt)) return null;
    // Its middle by area if that's inside it (a C-shaped district's isn't), else a point well inside
    const c = areaCentroid(poly);
    return c && pointInPolygon(c, poly) ? c : insidePoint(poly);
  } catch {
    return null;
  }
}

/** An angle in degrees as -180 (exclusive) to 180, rounded to a tenth. */
export function wrapAngle(a) {
  let v = ((Number(a) % 360) + 360) % 360;
  if (v > 180) v -= 360;
  return Math.round(v * 10) / 10 || 0;
}

/** An angle turned so text along it reads left to right: -90 (exclusive) to 90. */
export function readable(a) {
  let v = wrapAngle(a);
  if (v > 90) v -= 180;
  else if (v <= -90) v += 180;
  return Math.round(v * 10) / 10 || 0;
}

/**
 * Every label the plan shows, resolved: [{ id, of, text, at, angle, size, show, color, font, alpha }], color and
 * font always set (the label's own, else the plan's). Labels with no text, no place, or following a feature that
 * isn't there (or has no shape) are left out.
 */
export function labelsOf(plan) {
  const p = normalize(plan);
  const scene = isObj(p.output?.scene) ? p.output.scene : {};
  const planColor = HEX.test(scene.labelColor ?? "") ? scene.labelColor : "#13202e";
  const planFont = cleanFont(scene.labelFont) ?? "Signika";
  const byId = new Map(p.features.map((f) => [f.id, f]));
  const out = [];
  for (const f of p.features) {
    if (f.type !== "label") continue;
    // One line, as the window draws it (Foundry would break the text at a newline)
    const line = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
    let at = null, text = line(f.text);
    if (typeof f.of === "string" && f.of) {
      const owner = byId.get(f.of);
      const a = anchorOf(owner);
      if (!a) continue;
      // Its offset and angle are the turned area's own, so they turn with it
      const off = turned(isPt(f.offset) ? f.offset : [0, 0], rotOf(owner));
      at = [a[0] + off[0], a[1] + off[1]];
      if (!text) text = line(owner.name) || line(owner.id);
    } else if (isPt(f.at)) at = f.at;
    if (!at || !text) continue;
    const spin = typeof f.of === "string" && f.of ? rotOf(byId.get(f.of)) : 0;
    out.push({
      id: f.id, of: f.of ?? null, text, at,
      // (turned with its area, but never upside down)
      angle: spin ? readable(wrapAngle((Number.isFinite(f.angle) ? f.angle : 0) + spin)) : wrapAngle(Number.isFinite(f.angle) ? f.angle : 0),
      size: LABEL_SIZES[f.size] ? f.size : "normal",
      show: f.show === "all" ? "all" : "gm",
      color: HEX.test(f.color ?? "") ? f.color : planColor,
      font: cleanFont(f.font) ?? planFont,
      alpha: Number.isFinite(f.alpha) ? Math.min(1, Math.max(0.1, f.alpha)) : 1,
    });
  }
  return out;
}

/**
 * Hidden labels for a map's notable buildings (an inn, a temple, a smithy, a warehouse), from its layout: each reads
 * its use, or the name the GM gave a pinned or drawn building. One per building group, level, at its main part's
 * middle, small, for the GM only. A building the plan already labels gets none, nor one off the map. Where two
 * would overlap (or one would cover a plan label), the more telling one stays: a district's centerpiece, then a
 * plan's building or one of its own (a temple, an inn), then a trade, then a street-corner shrine or watch post.
 * Same shape as labelsOf.
 */
const GROUP = /\/h-(l\d+-\d+|anchor\d+|shrine\d+|watch\d+)$/;
export function useLabelsOf(plan, layout) {
  const p = normalize(plan);
  const scene = isObj(p.output?.scene) ? p.output.scene : {};
  const color = HEX.test(scene.labelColor ?? "") ? scene.labelColor : "#13202e";
  const font = cleanFont(scene.labelFont) ?? "Signika";
  const byId = new Map(p.features.map((f) => [f.id, f]));
  const labeled = new Set(p.features.filter((f) => f.type === "label" && typeof f.of === "string").map((f) => f.of));
  const [W, H] = Array.isArray(layout?.size?.squares) ? layout.size.squares : [Infinity, Infinity];
  const done = new Set();
  const want = [];
  for (const b of layout?.items ?? []) {
    if (b.kind !== "building" || typeof b.use !== "string" || !USE_INFO[b.use]?.notable) continue;
    // The group it belongs to: a generated building's main part (its parts end in w1, w2...: a house's, a district's
    // centerpiece's, a street-corner shrine's or watch post's), a plan building or landmark
    const owner = byId.get(b.from);
    const planned = !!owner && (owner.type === "building" || owner.type === "landmark");
    const group = planned ? owner.id : GROUP.test(b.id) ? b.id : null;
    if (!group || done.has(group) || labeled.has(group)) continue;
    done.add(group);
    if (!(b.cx >= 0 && b.cy >= 0 && b.cx <= W && b.cy <= H)) continue;
    const name = planned && typeof owner.name === "string" && owner.name.trim() ? owner.name.replace(/\s+/g, " ").trim() : null;
    const rank = /\/h-anchor\d+$/.test(group) ? 0 : planned || USE_INFO[b.use].form ? 1 : /\/h-(shrine|watch)\d+$/.test(group) ? 3 : 2;
    want.push({ rank, k: want.length, label: { id: `@use:${group}`, of: null, text: name ?? useLabel(b.use), at: [b.cx, b.cy], angle: 0, size: "small", show: "gm", color, font, alpha: 1 } });
  }
  // Roughly the box a label takes on the scene, as publish sizes it (the font its size share of a square, the box
  // its text plus 0.6 of the size wide and 1.6 of it high), turned by its angle (the box around the turned box)
  const boxOf = (l) => {
    const sz = LABEL_SIZES[l.size] ?? LABEL_SIZES.normal;
    const w = String(l.text ?? "").length * sz * 0.6 + sz * 0.6, h = sz * 1.6;
    const a = ((Number.isFinite(l.angle) ? l.angle : 0) * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    const hw = (w * c + h * s) / 2, hh = (w * s + h * c) / 2;
    return [l.at[0] - hw, l.at[1] - hh, l.at[0] + hw, l.at[1] + hh];
  };
  const hits = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
  const taken = [];
  try { for (const l of labelsOf(plan)) if (isPt(l.at)) taken.push(boxOf(l)); } catch { /* a plan whose labels can't be read: none to keep off */ }
  const out = [];
  for (const { label } of want.sort((a, b) => a.rank - b.rank || a.k - b.k)) {
    const box = boxOf(label);
    if (taken.some((t) => hits(t, box))) continue;
    taken.push(box);
    out.push(label);
  }
  return out;
}

/**
 * The roads and water as the map draws them (curved), for angleNear: [{ path, half }], with the squares' outlines as
 * .squares (a label in a square names the square, so it isn't turned along a road running through it).
 */
export function linesOf(plan) {
  try {
    const p = smoothPlanPaths(normalize(plan));
    const sq = p.size?.ftPerSquare || 25;
    const out = p.features.filter((f) => (f.type === "road" || f.type === "water") && Array.isArray(f.path) && f.path.length >= 2).map((f) => ({ path: f.path, half: (f.width ?? 0) / sq / 2 }));
    out.squares = p.features.filter((f) => f.type === "square").map((f) => { try { return shapeToPolygon(f.shape); } catch { return []; } }).filter((q) => q.length >= 3);
    return out;
  } catch {
    return [];
  }
}

/** The readable angle of the line (from linesOf) nearest p, if one runs within tol squares of its edge; else null. */
export function angleNear(lines, p, tol = 1) {
  if (!isPt(p)) return null;
  if (lines?.squares?.some((q) => pointInPolygon(p, q))) return null;
  let best = null;
  for (const { path, half } of lines ?? []) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      const d = distanceToPath(p, [a, b]) - half;
      if (d <= tol && (!best || d < best.d)) best = { d, a, b };
    }
  }
  return best ? readable((Math.atan2(best.b[1] - best.a[1], best.b[0] - best.a[0]) * 180) / Math.PI) : null;
}

/** The readable angle of the road or water nearest p, within tol squares of its edge (as the map draws it), or null. */
export const lineAngleAt = (plan, p, tol = 1) => angleNear(linesOf(plan), p, tol);

/**
 * The plan with a label moved so it sits at `to` (a placed label's at; a name label's offset from its feature), and,
 * if it lands on a road or water, turned along it. Returns the same plan if the label isn't there.
 */
export function moveLabel(plan, id, to, { alongLines = true } = {}) {
  const f = plan.features?.find((x) => x?.id === id && x.type === "label");
  if (!f || !isPt(to)) return plan;
  const r = (v) => Math.round(v * 10) / 10;
  const next = structuredClone(plan);
  const g = next.features.find((x) => x?.id === id);
  const spin = nameSpin(plan, g);
  if (typeof g.of === "string" && g.of) {
    const a = anchorOf(normalize(plan).features.find((x) => x.id === g.of));
    if (!a) return plan;
    const own = turned([to[0] - a[0], to[1] - a[1]], -spin); // in the turned area's own frame
    const off = [r(own[0]), r(own[1])];
    if (off[0] || off[1]) g.offset = off;
    else delete g.offset;
  } else g.at = [r(to[0]), r(to[1])];
  if (alongLines) {
    const angle = lineAngleAt(plan, to);
    if (angle !== null) {
      const a = spin ? wrapAngle(angle - spin) : angle;
      if (a) g.angle = a;
      else delete g.angle;
    }
  }
  return next;
}

/** The plan with a label turned to `angle` degrees (0 takes the setting out). */
export function turnLabel(plan, id, angle) {
  const f = plan.features?.find((x) => x?.id === id && x.type === "label");
  if (!f || !Number.isFinite(angle)) return plan;
  const next = structuredClone(plan);
  const g = next.features.find((x) => x?.id === id);
  const a = wrapAngle(angle - nameSpin(plan, g)); // a name label's angle is its turned area's own
  if (a) g.angle = a;
  else delete g.angle;
  return next;
}

/** How far a feature is turned (an area's rot, in degrees), else 0. */
const rotOf = (f) => (f?.type === "area" && Number.isFinite(f.rot) ? f.rot : 0);

/** A name label's area's turn (0 for a placed label). */
function nameSpin(plan, label) {
  if (typeof label?.of !== "string" || !label.of) return 0;
  return rotOf((plan.features ?? []).find((x) => x?.id === label.of));
}

/** [x, y] turned by deg degrees (clockwise on the map, y down). */
function turned([x, y], deg) {
  if (!deg) return [x, y];
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}

/** The name labels following a feature: their ids. */
export const nameLabelsOf = (plan, id) => (plan.features ?? []).filter((f) => f?.type === "label" && f.of === id).map((f) => f.id);
