/**
 * The AtlasScribe window's overlay: the SVG drawn over the sketch, in the plan's squares. Outlines to click and
 * reroll, the faint outlines of buildings and squares, roads and rivers as lines, points for bridges and props, the
 * labels as they'll be painted, the underlay's box, what the generator made when it's picked, the corner handles,
 * and the drawing under way. Plain functions of plain data (no Foundry), so the node tests can run them.
 */
import { esc } from "./util.mjs";
import { LABEL_SIZES } from "../core/plan.mjs";
import { cleanFont } from "../core/labels.mjs";

/** The middle of a polygon (its area centroid; the mean of its points if it has no area). */
export function centroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    const k = x0 * y1 - x1 * y0;
    a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k;
  }
  if (Math.abs(a) < 1e-9) return [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  return [cx / (3 * a), cy / (3 * a)];
}

/** Where the underlay image sits on the stage, in its pixels. */
export const underStyle = (rect, px, opacity) => `left:${rect[0] * px}px;top:${rect[1] * px}px;width:${(rect[2] - rect[0]) * px}px;height:${(rect[3] - rect[1]) * px}px;opacity:${opacity}`;

const pts = (list) => list.map((p) => p.join(",")).join(" ");
const sel = (id, selected) => (id === selected ? "as-selected" : "");

/** A label's half width and half height in squares, guessed from its text before the browser has measured it. */
export function labelBox(l) {
  const em = LABEL_SIZES[l.size] ?? LABEL_SIZES.normal;
  return { em, hw: (String(l.text).length * em * 0.55) / 2 + em * 0.15, hh: em * 0.62 };
}

/**
 * The overlay's contents. o: {
 *   feats: [{ id, type, name, poly }] (districts and areas, named outlines), minor: [{ id, type, poly }],
 *   points: [{ id, type, at }], paths: [{ id, type, pts }], labels: the drawing's labels, handles: [{ kind, id, at }],
 *   under: the underlay or null, underEditing: its box shown, gen: { kind, polys | path } or null,
 *   selected, size: [MW, MH], drawing: true while a tool is out (no handles, no turning dot)
 * }
 */
export function overlaySVG(o) {
  const [MW, MH] = o.size;
  const fs = Math.max(MW, MH) / 55;
  const shapes = (o.feats ?? []).filter((f) => f.poly.length >= 3).map((f) => {
    const [cx, cy] = centroid(f.poly);
    return `<g class="as-pv-shape as-${esc(f.type)} ${sel(f.id, o.selected)}" data-id="${esc(f.id)}">
        <polygon points="${pts(f.poly)}" vector-effect="non-scaling-stroke"></polygon>
        <text x="${cx}" y="${cy}" data-fs="${fs}">${esc(f.name ?? f.id)}</text></g>`;
  }).join("");
  const minor = (o.minor ?? []).map((f) => `<g class="as-pv-shape as-minor as-${esc(f.type)} ${sel(f.id, o.selected)}" data-id="${esc(f.id)}"><polygon points="${pts(f.poly)}" vector-effect="non-scaling-stroke"></polygon></g>`).join("");
  const points = (o.points ?? []).map((p) => `<circle class="as-pv-shape as-point as-${esc(p.type)} ${sel(p.id, o.selected)}" data-id="${esc(p.id)}" cx="${p.at[0]}" cy="${p.at[1]}" r="${fs * 0.35}"></circle>`).join("");
  const handles = o.drawing ? "" : (o.handles ?? []).map((h, n) => `<circle class="as-pv-handle as-${esc(h.kind)}" data-h="${n}" data-id="${esc(h.id)}" cx="${h.at[0]}" cy="${h.at[1]}" r="0.3"></circle>`).join("");
  const lines = (o.paths ?? []).map((p) => `<g class="as-pv-shape as-path as-${esc(p.type)} ${sel(p.id, o.selected)}" data-id="${esc(p.id)}"><polyline points="${pts(p.pts)}" vector-effect="non-scaling-stroke"></polyline></g>`).join("");
  // Labels at their true size, turned, in their color, font and opacity; a picked one has a box to drag it by and a
  // dot to turn it by
  const labels = (o.labels ?? []).filter((l) => Array.isArray(l.at)).map((l) => {
    const { em, hw, hh } = labelBox(l), on = l.id === o.selected;
    const dark = /^#[0-9a-f]{6}$/i.test(l.color) && [1, 3, 5].reduce((a, i) => a + parseInt(l.color.slice(i, i + 2), 16), 0) < 384;
    return `<g class="as-pv-label-g ${on ? "as-selected" : ""}" data-id="${esc(l.id)}" transform="translate(${l.at[0]} ${l.at[1]}) rotate(${Number(l.angle) || 0})">
        ${on ? `<rect class="as-pv-label-box" data-id="${esc(l.id)}" x="${-hw}" y="${-hh}" width="${hw * 2}" height="${hh * 2}" vector-effect="non-scaling-stroke"></rect>` : ""}
        <text class="as-pv-label" data-id="${esc(l.id)}" x="0" y="0" font-size="${em}" style="font-family: '${esc(cleanFont(l.font) ?? "")}'; fill: ${esc(l.color)}; opacity: ${Number(l.alpha) || 1}; stroke: ${dark ? "rgba(255, 255, 255, 0.85)" : "rgba(0, 0, 0, 0.7)"}; stroke-width: ${em * 0.1}">${esc(l.text)}</text>
        ${on && !o.drawing ? `<circle class="as-pv-handle as-turn" data-id="${esc(l.id)}" cx="${hw + em * 0.6}" cy="0" r="0.3"></circle>` : ""}
      </g>`;
  }).join("");
  // The reference image's box while its panel is open (and it isn't locked): its edge and the grip in its middle
  // move it, its corners scale it; inside it, clicks reach the map as usual
  const u = o.under;
  const underBox = u && u.shown && !u.locked && o.underEditing ? (() => {
    const [x0, y0, x1, y1] = u.rect;
    const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    return `<g class="as-pv-under-box"><rect class="as-pv-under-move" x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" vector-effect="non-scaling-stroke"></rect>${corners.map((c, i) => `<circle class="as-pv-handle as-under" data-corner="${i}" cx="${c[0]}" cy="${c[1]}" r="0.3"></circle>`).join("")}<circle class="as-pv-handle as-under as-under-grip" cx="${(x0 + x1) / 2}" cy="${(y0 + y1) / 2}" r="0.3"></circle></g>`;
  })() : "";
  const g = o.gen;
  const genSvg = !g ? "" : g.kind === "house"
    ? `<g class="as-pv-gen as-selected">${g.polys.map((q) => `<polygon points="${pts(q)}" vector-effect="non-scaling-stroke"></polygon>`).join("")}</g>`
    : `<g class="as-pv-gen as-selected"><polyline points="${pts(g.path)}" vector-effect="non-scaling-stroke"></polyline></g>`;
  return `${shapes}${minor}${genSvg}${lines}${points}${labels}${underBox}${handles}<g class="as-pv-draft"></g>`;
}

/**
 * The drawing under way: its points, the line to the cursor, a box, and a ring where it snaps. t: { points, box,
 * cursor, snap }; geometry: the tool's ("shape", "path", "point" or "box"); r: a point's radius in squares.
 */
export function draftSVG(t, geometry, r) {
  const list = t.cursor && geometry !== "point" ? [...t.points, t.cursor] : [...t.points];
  let html = "";
  if (t.box) {
    const [x0, y0, x1, y1] = t.box;
    html += `<rect x="${Math.min(x0, x1)}" y="${Math.min(y0, y1)}" width="${Math.abs(x1 - x0)}" height="${Math.abs(y1 - y0)}" vector-effect="non-scaling-stroke"></rect>`;
  } else if (list.length >= 2) {
    const tag = geometry === "shape" && list.length >= 3 ? "polygon" : "polyline";
    html += `<${tag} points="${pts(list)}" vector-effect="non-scaling-stroke"></${tag}>`;
  }
  for (const p of t.points) html += `<circle class="as-pv-draft-pt" cx="${p[0]}" cy="${p[1]}" r="${r}"></circle>`;
  if (t.cursor && !t.box) html += `<circle class="as-pv-draft-cursor ${t.snap ? "as-snap" : ""}" cx="${t.cursor[0]}" cy="${t.cursor[1]}" r="${r * (t.snap ? 1.8 : 1)}"></circle>`;
  return html;
}

/** The Battle map tool's box with its size in battle squares above it (below it at the map's top edge). */
export function battleBoxSVG(st, size) {
  if (!st.box) return "";
  const [x0, y0, x1, y1] = st.box;
  const [MW, MH] = size;
  const fs = Math.max(MW, MH) / 90;
  const ty = y0 - fs * 0.35 > fs ? y0 - fs * 0.35 : y1 + fs * 1.05;
  return `<rect class="as-pv-zoombox ${st.big ? "as-warn" : ""}" x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" vector-effect="non-scaling-stroke"></rect>`
    + `<text class="as-pv-zoombox-size ${st.big ? "as-warn" : ""}" x="${x0}" y="${ty}" font-size="${fs}">${esc(`${st.size[0]} x ${st.size[1]}`)}</text>`;
}
