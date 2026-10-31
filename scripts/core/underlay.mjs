/**
 * The reference image under the window's sketch (a hand sketch, an old map) to trace over. It's saved in the plan
 * (plan.underlay: { path, rect: [left, top, right, bottom] in squares, opacity, shown, locked }) so it's there next
 * time, and is never painted into a scene. Pure: runs in the worker, on the page and under node.
 */
import { isObj } from "./plan.mjs";

const r2 = (v) => Math.round(v * 100) / 100;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** The plan's underlay if it's usable: { path, rect, opacity, shown, locked } with defaults filled; else null. */
export function underlayOf(plan) {
  const u = plan?.underlay;
  if (!isObj(u) || typeof u.path !== "string" || !u.path.trim()) return null;
  const r = Array.isArray(u.rect) && u.rect.length === 4 && u.rect.every(isNum) && u.rect[0] < u.rect[2] && u.rect[1] < u.rect[3] ? u.rect : null;
  if (!r) return null;
  return { path: u.path.trim(), rect: r, opacity: isNum(u.opacity) ? Math.min(1, Math.max(0.05, u.opacity)) : 0.5, shown: u.shown !== false, locked: u.locked === true };
}

/** The plan with an image of w by h pixels as its underlay, fitted inside the map and centered, half see-through. */
export function addUnderlay(plan, path, w, h) {
  if (!(isNum(w) && w > 0 && isNum(h) && h > 0)) return plan; // an image with no size can't be fitted
  const [MW, MH] = plan?.size?.squares ?? [50, 50];
  const k = Math.min(MW / w, MH / h);
  const iw = w * k, ih = h * k;
  const x0 = (MW - iw) / 2, y0 = (MH - ih) / 2;
  return { ...structuredClone(plan), underlay: { path, rect: [r2(x0), r2(y0), r2(x0 + iw), r2(y0 + ih)], opacity: 0.5 } };
}

/** The plan with some of its underlay's settings changed (opacity, shown, locked, rect); unknown keys are ignored. */
export function setUnderlay(plan, patch) {
  const u = underlayOf(plan);
  if (!u) return plan;
  const next = structuredClone(plan);
  const out = { ...next.underlay };
  if (isNum(patch.opacity)) out.opacity = Math.min(1, Math.max(0.05, patch.opacity));
  if (typeof patch.shown === "boolean") { if (patch.shown) delete out.shown; else out.shown = false; }
  if (typeof patch.locked === "boolean") { if (patch.locked) out.locked = true; else delete out.locked; }
  if (Array.isArray(patch.rect) && patch.rect.length === 4 && patch.rect.every(isNum)) {
    const rect = patch.rect.map(r2); // checked once rounded, so a sliver can't round away to nothing
    if (rect[0] < rect[2] && rect[1] < rect[3]) out.rect = rect;
  }
  next.underlay = out;
  return next;
}

/** The plan without its underlay. */
export function removeUnderlay(plan) {
  const next = structuredClone(plan);
  delete next.underlay;
  return next;
}

/** A rect moved by [dx, dy] squares. */
export const movedRect = (rect, dx, dy) => [rect[0] + dx, rect[1] + dy, rect[2] + dx, rect[3] + dy];

/**
 * A rect scaled from a dragged corner (0 top left, 1 top right, 2 bottom right, 3 bottom left) to `to`, keeping its
 * shape and the opposite corner where it is; never smaller than a square across.
 */
export function scaledRect(rect, corner, to) {
  const [x0, y0, x1, y1] = rect;
  const w = x1 - x0, h = y1 - y0, aspect = w / h;
  const ax = corner === 0 || corner === 3 ? x1 : x0, ay = corner === 0 || corner === 1 ? y1 : y0; // the anchor
  const sx = corner === 0 || corner === 3 ? -1 : 1, sy = corner === 0 || corner === 1 ? -1 : 1;
  // The bigger of the two pulls sets the size, the other follows the shape
  let nw = Math.max(1, (to[0] - ax) * sx), nh = Math.max(1, (to[1] - ay) * sy);
  if (nw / aspect > nh) nh = nw / aspect;
  else nw = nh * aspect;
  const nx0 = sx > 0 ? ax : ax - nw, ny0 = sy > 0 ? ay : ay - nh;
  return [nx0, ny0, nx0 + nw, ny0 + nh];
}
