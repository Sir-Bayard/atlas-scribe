/**
 * A picture of a scene without viewing it: its background, its tiles (ground tiles, then those above, by elevation
 * and sort) and, unless asked not to, its tokens, under a darkness drawn from its environment with each light's pool
 * cut out of it and tinted. Foundry lights only the scene a client is viewing, so the lighting here is drawn by
 * AtlasScribe and is close to Foundry's, not the same: walls don't stop the light, and there's no vision or fog. It's
 * for comparing maps and seeing a scene at a glance, never for what players see.
 */

/** The longest side of a snapshot, in pixels, unless asked for another (at most MOST). */
export const SNAPSHOT = { side: 2000, most: 6000 };

/** An image's element, loaded, or null when it can't be. */
function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

/** "#rrggbb" as [r, g, b], or the fallback. */
const rgbOf = (c, fallback = [255, 255, 255]) => (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : fallback);

/** A hue in [0, 1) with an intensity as the darkness's color: Foundry's dark tint, kept to a cool, dark blue at none. */
function darkColor(dark) {
  const h = Number.isFinite(dark?.hue) ? dark.hue : 0.71, k = Math.max(0, Math.min(1, dark?.intensity ?? 0));
  // (hsl at the hue, saturated as much as its intensity, dark)
  const s = 0.25 + 0.5 * k, l = 0.08, a = s * Math.min(l, 1 - l), f = (n) => { const q = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(q - 3, 9 - q, 1)); };
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}

/**
 * Draws scene (a Scene document) into a canvas: { canvas, width, height }. side: the longest side in pixels; tokens:
 * whether its tokens are drawn; lighting: whether its darkness and lights are.
 */
export async function drawScene(scene, { side = SNAPSHOT.side, tokens = true, lighting = true } = {}) {
  const d = scene.dimensions;
  const k = Math.min(1, Math.max(64, Math.min(SNAPSHOT.most, side)) / Math.max(d.sceneWidth, d.sceneHeight));
  const W = Math.max(1, Math.round(d.sceneWidth * k)), H = Math.max(1, Math.round(d.sceneHeight * k));
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const X = (x) => (x - d.sceneX) * k, Y = (y) => (y - d.sceneY) * k;
  g.fillStyle = scene.backgroundColor ?? "#999999";
  g.fillRect(0, 0, W, H);
  // (the background: the first level's, else the scene's own)
  const bg = await loadImage(scene.initialLevel?.background?.src ?? scene.background?.src);
  if (bg) g.drawImage(bg, 0, 0, W, H);
  // (a piece placed by its middle, size and turn: Foundry 14 anchors a tile at its middle, a token at its corner)
  const place = (im, cx, cy, w, h, rot = 0, alpha = 1) => {
    g.save(); g.globalAlpha = alpha; g.translate(X(cx), Y(cy)); g.rotate((rot * Math.PI) / 180);
    g.drawImage(im, (-w / 2) * k, (-h / 2) * k, w * k, h * k); g.restore();
  };
  // (only what's on the scene's first level: a tile on no level in particular is on all of them)
  const first = scene.initialLevel?.id ?? null;
  const onFirst = (lv) => !first || lv == null || (typeof lv === "string" ? lv === first : !lv.size || lv.has?.(first));
  const tiles = scene.tiles.contents.filter((t) => !t.hidden && t.texture?.src && onFirst(t.levels)).sort((a, b) => (a.elevation - b.elevation) || (a.sort - b.sort));
  // (AtlasScribe's roofs and crowns over the tokens, its furniture and props under them; another tile over them from
  // 20 ft up)
  const ours = (t) => t.flags?.["atlas-scribe"] ?? {};
  const isOver = (t) => "overhead" in ours(t) || (!("furniture" in ours(t)) && t.elevation >= 20);
  const under = tiles.filter((t) => !isOver(t)), over = tiles.filter(isOver);
  for (const t of under) { const im = await loadImage(t.texture.src); if (im) place(im, t.x, t.y, t.width, t.height, t.rotation, t.alpha ?? 1); }
  if (tokens) for (const t of scene.tokens.contents.filter((x) => !x.hidden && x.texture?.src && onFirst(x.level))) {
    const im = await loadImage(t.texture.src), w = t.width * d.size, h = t.height * d.size;
    if (!im) continue;
    // (its picture fitted inside its box keeping its shape, as Foundry's "contain", then scaled by its texture's scale)
    const fit = Math.min(w / im.width, h / im.height), sx = Math.abs(t.texture.scaleX ?? 1) || 1, sy = Math.abs(t.texture.scaleY ?? 1) || 1;
    place(im, t.x + w / 2, t.y + h / 2, im.width * fit * sx, im.height * fit * sy, t.rotation, t.alpha ?? 1);
  }
  for (const t of over) { const im = await loadImage(t.texture.src); if (im) place(im, t.x, t.y, t.width, t.height, t.rotation, t.alpha ?? 1); }
  if (lighting) {
    const env = scene.environment ?? {}, dark = Math.max(0, Math.min(1, env.darknessLevel ?? 0));
    const gl = env.globalLight ?? {}, lit = gl.enabled && dark >= (gl.darkness?.min ?? 0) && dark <= (gl.darkness?.max ?? 1);
    // (the darkness: as dark as the scene, less under a global light, which lights it dim or bright)
    const depth = dark * (lit ? (gl.bright ? 0.15 : 0.55) : 0.92);
    if (depth > 0.01) {
      const shade = document.createElement("canvas");
      shade.width = W; shade.height = H;
      const sg = shade.getContext("2d"), [r, gg, b] = darkColor(env.dark);
      sg.fillStyle = `rgba(${r},${gg},${b},${depth})`;
      sg.fillRect(0, 0, W, H);
      // (a global light's own color washed over what it lights, faintly)
      if (lit && gl.color) { const [cr, cg, cb] = rgbOf(gl.color); sg.globalCompositeOperation = "source-atop"; sg.fillStyle = `rgba(${cr},${cg},${cb},0.12)`; sg.fillRect(0, 0, W, H); sg.globalCompositeOperation = "source-over"; }
      // (each light lit at this darkness cuts its pool out of the darkness: clear to its bright radius, fading to its dim)
      const lights = scene.lights.contents.filter((l) => !l.hidden && onFirst(l.levels) && dark >= (l.config?.darkness?.min ?? 0) && dark <= (l.config?.darkness?.max ?? 1));
      const px = (ft) => (ft / (d.distance || 5)) * d.size * k;
      sg.globalCompositeOperation = "destination-out";
      for (const l of lights) {
        const bright = px(l.config?.bright ?? 0), dim = Math.max(bright, px(l.config?.dim ?? 0));
        if (dim <= 0) continue;
        const gr = sg.createRadialGradient(X(l.x), Y(l.y), 0, X(l.x), Y(l.y), dim);
        gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(Math.min(0.99, bright / dim), "rgba(0,0,0,0.95)"); gr.addColorStop(1, "rgba(0,0,0,0)");
        sg.fillStyle = gr; sg.beginPath(); sg.arc(X(l.x), Y(l.y), dim, 0, 2 * Math.PI); sg.fill();
      }
      sg.globalCompositeOperation = "source-over";
      g.drawImage(shade, 0, 0);
      // (and each light's color over its pool: tinting what it lights, then a soft glow)
      for (const [op, k0] of [["multiply", 1], ["screen", 0.35]]) {
        g.save(); g.globalCompositeOperation = op;
        for (const l of lights) {
          const dim = Math.max(px(l.config?.bright ?? 0), px(l.config?.dim ?? 0));
          if (dim <= 0) continue;
          const [cr, cg, cb] = rgbOf(l.config?.color, [255, 220, 170]), a = Math.min(0.85, (l.config?.alpha ?? 0.5) * 1.4) * k0;
          const gr = g.createRadialGradient(X(l.x), Y(l.y), 0, X(l.x), Y(l.y), dim);
          gr.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`); gr.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          g.fillStyle = gr; g.beginPath(); g.arc(X(l.x), Y(l.y), dim, 0, 2 * Math.PI); g.fill();
        }
        g.restore();
      }
      shade.width = shade.height = 1;
    }
  }
  return { canvas: c, width: W, height: H };
}
