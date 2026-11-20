/**
 * The AtlasScribe window's drawing tools, as plain functions of the plan (no Foundry), so the node tests can run
 * them: which tool a palette id names, where a click lands once snapped, and the Battle map tool's box (its size
 * at a zoom, a box placed by a click at a preset size, kept on the map).
 */
import { snapCorner, snapEnd, toolOf } from "../core/draw.mjs";
import { OUTPUT_LIMITS } from "../core/plan.mjs";
import { zoomSize, ZOOMS } from "../core/zoom.mjs";

/**
 * The Battle map tool: a box dragged (or clicked into place) over a town map, made a battle map of its own
 * (zoom.mjs). It adds nothing to the plan. PRESETS: a clicked box's side in battle squares; BIG: past this many
 * squares a side the size shows amber; MOST: past this many it can't be made (one image's limit at the fewest pixels
 * a square); LEAST: a box under this many squares a side is too small to fight in.
 */
export const BATTLE_TOOL = { id: "battle", label: "Battle Map", geometry: "box", how: "battle" };
export const BATTLE = { PRESETS: [30, 45, 60], preset: 45, BIG: 60, MOST: Math.floor(OUTPUT_LIMITS.maxSide / OUTPUT_LIMITS.minPxPerSquare), LEAST: 5 };

/** The tool a palette id names. */
export const toolFor = (id) => (id === "battle" ? BATTLE_TOOL : toolOf(id));

/** Where a point lands with a tool, snapped: { at, kind }. tol: how near snaps, in squares. */
export function snapFor(plan, id, at, tol) {
  const t = toolFor(id), make = t.make, geo = t.geometry;
  if (geo === "shape") return snapCorner(plan, at, tol);
  if (geo === "path") return snapEnd(plan, make.type, at, tol, make.class ?? null);
  return { at: [Math.round(at[0] * 10) / 10, Math.round(at[1] * 10) / 10], kind: null };
}

/** A box's corners in order: [x0, y0, x1, y1] with x0 <= x1 and y0 <= y1. */
export const ordered = (b) => [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])];

/**
 * What the Battle map panel and the map show: { zoom, zooms, preset, presets, box, size, big, limit, tooBig, most,
 * placed }. raw: the box being dragged, else placed; placed: a box is placed (none being dragged).
 */
export function battleState(plan, { raw, zoom, preset, placed }) {
  const box = raw ? ordered(raw) : null;
  const size = box ? zoomSize(plan, box, zoom).squares : null;
  return { zoom, zooms: ZOOMS, preset, presets: BATTLE.PRESETS, box, size, big: !!size && Math.max(...size) > BATTLE.BIG, limit: BATTLE.BIG, tooBig: !!size && Math.max(...size) > BATTLE.MOST, most: BATTLE.MOST, placed };
}

/**
 * The Battle map tool's box once let go: a dragged box (drag), else a box of the preset size around a click (at),
 * slid onto the map whole where it fits, then cut to the map's edges. Returns { box } or { error } (too small to
 * fight in), or { box: null } when there's nothing to place.
 */
export function placeBox(plan, { drag = null, at = null, zoom, preset, squares }) {
  const [MW, MH] = squares;
  let box = null;
  if (drag) box = ordered(drag);
  else if (at) {
    // (the preset's battle squares in the plan's squares at this zoom)
    const per = zoomSize(plan, [0, 0, 1, 1], zoom).perSquare;
    const half = preset / per / 2, [x, y] = at;
    box = [x - half, y - half, x + half, y + half];
    const dx = box[0] < 0 ? -box[0] : box[2] > MW ? MW - box[2] : 0, dy = box[1] < 0 ? -box[1] : box[3] > MH ? MH - box[3] : 0;
    box = [box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy];
  }
  if (!box) return { box: null };
  box = [Math.max(0, box[0]), Math.max(0, box[1]), Math.min(MW, box[2]), Math.min(MH, box[3])].map((v) => Math.round(v * 100) / 100);
  const size = zoomSize(plan, box, zoom).squares;
  return Math.min(...size) >= BATTLE.LEAST ? { box } : { error: "That box is too small for a battle map. Drag a bigger one, or click to place one of the size picked." };
}
