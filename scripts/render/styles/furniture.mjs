/**
 * Map furniture: the frame, compass rose and scale bar a dressed map is painted with, shared by the illustrated and
 * the overland painted styles (the map's name is a tile of its own: title.mjs).
 */
import { compassOf, scaleBarOf } from "../../core/dressing.mjs";

/**
 * Map dressing: a ruled frame, a compass rose and a scale bar (in feet, or miles on an overland map), each in the
 * emptiest corner left (the third kept for the map's name, a tile of its own). Drawn in map units, so tiles join.
 */
export function dress(ctx, P, { miles = false } = {}) {
  const { g, x0, y0, pp, layout: L } = ctx;
  const X = (x) => (x - x0) * pp, Y = (y) => (y - y0) * pp;
  const [mw, mh] = L.size?.squares ?? [0, 0];
  if (!mw || !mh) return;
  const ft = L.size?.ftPerSquare ?? 25;
  const ink = (a = 1) => `rgba(${P.ink.join(",")},${a})`, paper = (a = 1) => `rgba(${P.paper.join(",")},${a})`;
  const unit = Math.min(mw, mh) / 100;

  // The compass rose in the emptiest corner
  { const { x, y, R } = compassOf(L);
    g.save(); g.translate(X(x), Y(y));
    const r = R * pp;
    g.fillStyle = paper(0.55); g.beginPath(); g.arc(0, 0, r * 1.05, 0, 2 * Math.PI); g.fill();
    g.strokeStyle = ink(0.85); g.lineWidth = Math.max(1, pp * 0.05);
    for (const rr of [r, r * 0.93]) { g.beginPath(); g.arc(0, 0, rr, 0, 2 * Math.PI); g.stroke(); }
    for (let k = 0; k < 32; k++) { const a = (k / 32) * 2 * Math.PI, l = k % 4 ? 0.04 : 0.08; g.beginPath(); g.moveTo(Math.cos(a) * r * 0.93, Math.sin(a) * r * 0.93); g.lineTo(Math.cos(a) * r * (0.93 - l), Math.sin(a) * r * (0.93 - l)); g.stroke(); }
    const point = (a, len, wide, dark) => {
      const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
      for (const side of [1, -1]) {
        g.fillStyle = (side > 0) === dark ? ink(0.85) : paper(1);
        g.beginPath(); g.moveTo(0, 0); g.lineTo(ux * len, uy * len); g.lineTo(vx * wide * side + ux * wide, vy * wide * side + uy * wide); g.closePath(); g.fill(); g.stroke();
      }
    };
    for (let k = 0; k < 4; k++) point(-Math.PI / 4 + (k * Math.PI) / 2, r * 0.55, r * 0.09, true);
    for (let k = 0; k < 4; k++) point(-Math.PI / 2 + (k * Math.PI) / 2, r * 0.88, r * 0.14, true);
    g.fillStyle = ink(0.9); g.font = `italic ${Math.round(r * 0.3)}px serif`; g.textAlign = "center"; g.textBaseline = "bottom";
    g.fillText("N", 0, -r * 1.07);
    g.restore(); }

  // The scale bar: about a fifth of the map across, in a round number of feet, five parts
  { const { x, y, left, len, h, nice, per } = scaleBarOf(L, { miles });
    g.save();
    g.fillStyle = paper(0.6); g.fillRect(X(left - unit * 2), Y(y - unit * 3.6), (len + unit * 4) * pp, unit * 6 * pp);
    g.strokeStyle = ink(0.9); g.lineWidth = Math.max(1, pp * 0.04);
    for (let k = 0; k < 5; k++) { g.fillStyle = k % 2 ? paper(1) : ink(0.85); g.fillRect(X(left + (k * len) / 5), Y(y), (len / 5) * pp, h * pp); }
    g.strokeRect(X(left), Y(y), len * pp, h * pp);
    g.fillStyle = ink(0.9); g.font = `${Math.round(unit * 1.5 * pp)}px serif`; g.textAlign = "center"; g.textBaseline = "bottom";
    // (to a tenth at most, so a 25-mile bar's middle reads 12.5, not 13)
    const num = (v) => `${Number(v.toFixed(1))}`;
    for (const k of [0, 5]) g.fillText(num((nice * k) / 5), X(left + (k * len) / 5), Y(y - unit * 0.3));
    g.fillText(num(nice / 2), X(left + len / 2), Y(y - unit * 0.3));
    g.textBaseline = "top"; g.font = `italic ${Math.round(unit * 1.5 * pp)}px serif`;
    g.fillText(miles ? `miles  (one ${L.size?.grid === "hex" ? "hex" : "square"}: ${Number(per.toPrecision(3))} mi)` : `feet  (one square: ${ft} ft)`, X(x), Y(y + h + unit * 0.4));
    g.restore(); }

  // (the map's name is a tile of its own, which the GM can show the players: see titleBox and paintTitle)

  // The frame: a broad paper margin ruled twice inside, and a fine rule outside
  { const m = unit * 1.6, t = m * pp;
    g.save();
    g.fillStyle = paper(1);
    g.fillRect(X(0), Y(0), mw * pp, t); g.fillRect(X(0), Y(mh) - t, mw * pp, t); g.fillRect(X(0), Y(0), t, mh * pp); g.fillRect(X(mw) - t, Y(0), t, mh * pp);
    g.strokeStyle = ink(0.9);
    g.lineWidth = Math.max(1.5, pp * 0.08); g.strokeRect(X(m), Y(m), (mw - 2 * m) * pp, (mh - 2 * m) * pp);
    g.lineWidth = Math.max(1, pp * 0.03); g.strokeRect(X(m * 0.6), Y(m * 0.6), (mw - 1.2 * m) * pp, (mh - 1.2 * m) * pp);
    g.lineWidth = Math.max(1, pp * 0.03); g.strokeRect(X(m * 1.25), Y(m * 1.25), (mw - 2.5 * m) * pp, (mh - 2.5 * m) * pp);
    // (ticks every ten squares along the inner rule, as a map's border is graduated)
    g.lineWidth = Math.max(1, pp * 0.03);
    for (let x = 10; x < mw; x += 10) for (const yy of [m * 0.6, mh - m * 0.6]) { g.beginPath(); g.moveTo(X(x), Y(yy)); g.lineTo(X(x), Y(yy + (yy < mh / 2 ? m * 0.4 : -m * 0.4))); g.stroke(); }
    for (let y = 10; y < mh; y += 10) for (const xx of [m * 0.6, mw - m * 0.6]) { g.beginPath(); g.moveTo(X(xx), Y(y)); g.lineTo(X(xx + (xx < mw / 2 ? m * 0.4 : -m * 0.4)), Y(y)); g.stroke(); }
    g.restore(); }
}
