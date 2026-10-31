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
      const off = isPt(f.offset) ? f.offset : [0, 0];
      at = [a[0] + off[0], a[1] + off[1]];
      if (!text) text = line(owner.name) || line(owner.id);
    } else if (isPt(f.at)) at = f.at;
    if (!at || !text) continue;
    out.push({
      id: f.id, of: f.of ?? null, text, at,
      angle: Number.isFinite(f.angle) ? wrapAngle(f.angle) : 0,
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
  if (typeof g.of === "string" && g.of) {
    const a = anchorOf(normalize(plan).features.find((x) => x.id === g.of));
    if (!a) return plan;
    const off = [r(to[0] - a[0]), r(to[1] - a[1])];
    if (off[0] || off[1]) g.offset = off;
    else delete g.offset;
  } else g.at = [r(to[0]), r(to[1])];
  if (alongLines) {
    const angle = lineAngleAt(plan, to);
    if (angle !== null) {
      if (angle) g.angle = angle;
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
  const a = wrapAngle(angle);
  if (a) g.angle = a;
  else delete g.angle;
  return next;
}

/** The name labels following a feature: their ids. */
export const nameLabelsOf = (plan, id) => (plan.features ?? []).filter((f) => f?.type === "label" && f.of === id).map((f) => f.id);
