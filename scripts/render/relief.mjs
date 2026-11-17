/**
 * High and wet ground (layout/relief.mjs) as every style draws it, in that style's colors: hills shaded from the
 * northwest sun ring by ring with their contours inked, mountains the same steeper with crags, rocks as stone, a
 * marsh as damp ground with pools and tufts of reeds. g: the canvas; X, Y: squares to pixels; pp: pixels a square;
 * colors: { land, ink, light, shade, stone, stoneInk, water, waterInk, reed }, CSS colors; near(box): whether a box in
 * squares reaches the tile. Pure canvas drawing: runs in the worker and under node.
 */
const boxOf = (pts) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, y] of pts) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; } return [a, b, c, d]; };

export function paintRelief(g, items, { X, Y, pp, colors, near = () => true, contours = true, grain = 1 }) {
  const ring = (pts, dx = 0, dy = 0) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(X(x) + dx, Y(y) + dy) : g.moveTo(X(x) + dx, Y(y) + dy))); g.closePath(); };
  for (const r of items.filter((i) => i.kind === "relief" && near(boxOf(i.poly)))) {
    g.save();
    if (r.class === "marsh") {
      // (its edge soft: damp ground fades into dry)
      g.filter = `blur(${Math.max(1, pp * 0.5)}px)`; ring(r.poly); g.fillStyle = colors.marsh; g.fill(); g.filter = "none";
      for (const p of r.pools ?? []) { ring(p); g.fillStyle = colors.water; g.fill(); g.strokeStyle = colors.waterInk; g.lineWidth = Math.max(1, pp * 0.03); g.stroke(); }
      g.strokeStyle = colors.reed; g.lineWidth = Math.max(1, pp * 0.035 * grain); g.lineCap = "round";
      const t = Math.min(0.45, 0.3 * grain);
      for (const [x, y, s] of r.tufts ?? []) {
        if (!near([x - 1, y - 1, x + 1, y + 1])) continue;
        const h = t * (0.7 + s * 0.6);
        g.beginPath();
        for (const dx of [-0.35, 0, 0.35]) { g.moveTo(X(x + dx * h * 0.5), Y(y)); g.lineTo(X(x + dx * h), Y(y - h * (1 - Math.abs(dx)))); }
        g.stroke();
      }
      g.restore();
      continue;
    }
    // Shading ring by ring: each ring's southeast lip darker, its northwest lighter (offset by a fraction of a step)
    const off = Math.max(1, Math.min((r.step ?? 1) * pp * 0.35, pp * 0.8));
    const rings = [{ level: 0, ring: r.poly }, ...(r.contours ?? [])];
    const steep = r.class === "mountains";
    ring(r.poly); g.clip();
    // (a mountain's ground bare rock)
    if (steep) { ring(r.poly); g.fillStyle = colors.stone; g.globalAlpha = 0.45; g.fill(); g.globalAlpha = 1; }
    // (blurred, so a ring's lip is a slope, not a step)
    g.filter = `blur(${off * 0.8}px)`;
    for (const c of rings) {
      ring(c.ring, off, off); g.fillStyle = colors.shade; g.globalAlpha = steep ? 0.22 : 0.14; g.fill();
      ring(c.ring, -off * 0.6, -off * 0.6); g.fillStyle = colors.light; g.globalAlpha = steep ? 0.2 : 0.16; g.fill();
    }
    g.filter = "none"; g.globalAlpha = 1;
    if (contours) {
      g.strokeStyle = colors.ink; g.lineWidth = Math.max(1, pp * (steep ? 0.03 : 0.025)); g.globalAlpha = steep ? 0.5 : 0.35;
      for (const c of r.contours ?? []) { ring(c.ring); g.stroke(); }
      g.globalAlpha = 1;
    }
    // Rocks: stone, lit on their northwest, inked
    for (const b of r.rocks ?? []) {
      if (!near(boxOf(b))) continue;
      ring(b, off * 0.3, off * 0.3); g.fillStyle = colors.shade; g.globalAlpha = 0.35; g.fill(); g.globalAlpha = 1;
      ring(b); g.fillStyle = colors.stone; g.fill();
      g.strokeStyle = colors.stoneInk; g.lineWidth = Math.max(1, pp * 0.025); g.stroke();
    }
    g.restore();
  }
}
