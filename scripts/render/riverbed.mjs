/**
 * A river's bed (layout/riverbed.mjs) as every style draws it, over its water: gravel bars as pale shallows with a
 * soft edge, islands as land with a bank around them and a dark rim at the water. g: the canvas; X, Y: squares to
 * pixels; pp: pixels a square; colors: { bar, land, bank, ink }, CSS colors; near(box): whether a box in squares
 * reaches the tile. Pure canvas drawing: runs in the worker and under node.
 */
const boxOf = (pts) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, y] of pts) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; } return [a, b, c, d]; };

export function paintRiverbed(g, items, { X, Y, pp, colors, near = () => true }) {
  const ring = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); };
  for (const w of items.filter((i) => i.kind === "water" && (i.bars || i.islands))) {
    g.save();
    // (no shallows show through ice)
    for (const b of w.frozen ? [] : w.bars ?? []) {
      if (!near(boxOf(b))) continue;
      // (blurred, so the shallows fade into the deep water)
      g.filter = `blur(${Math.max(1, pp * 0.12)}px)`; ring(b); g.fillStyle = colors.bar; g.globalAlpha = 0.9; g.fill();
      g.filter = "none"; g.globalAlpha = 1;
    }
    for (const isl of w.islands ?? []) {
      if (!near(boxOf(isl))) continue;
      ring(isl); g.strokeStyle = colors.bank; g.lineWidth = Math.max(2, pp * 0.22); g.lineJoin = "round"; g.stroke();
      g.fillStyle = colors.land; g.fill();
      g.strokeStyle = colors.ink; g.lineWidth = Math.max(1, pp * 0.03); g.stroke();
    }
    g.restore();
  }
}
