/**
 * Drawn art: images drawn in code for battle-map roles that have no art, shaped like the art they stand in for, so the
 * battle style paints them unchanged. Textures tile seamlessly at 200 px a square (two squares a tile); path strips
 * are 200 px tall with their band in the middle; props and furniture are drawn at their size in squares on a clear
 * ground. Two looks: "painted" (shaded, in natural colors) and "inked" (flat, paler colors with ink lines, the
 * battle-map counterpart of the illustrated style).
 */

import { FURNITURE } from "../core/layout/rooms.mjs";

const PX = 200; // (px a square, as Forgotten Adventures' art)
const T = 400; // (a texture tile: two squares)
const cache = new Map();

/** A canvas w by h px. */
const cv = (w, h) => new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));

/** A seeded random stream from a string. */
function rngOf(key) {
  let h = 1779033703 ^ key.length;
  for (let i = 0; i < key.length; i++) { h = Math.imul(h ^ key.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  const next = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  next.range = (lo, hi) => lo + next() * (hi - lo);
  next.int = (n) => Math.floor(next() * n);
  next.pick = (l) => l[Math.floor(next() * l.length)];
  return next;
}

/** Noise that repeats every `period` cells (0 to 1), smooth between lattice points. */
function periodicNoise(r, period) {
  const v = Array.from({ length: period * period }, () => r());
  const at = (i, j) => v[(((j % period) + period) % period) * period + (((i % period) + period) % period)];
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const i = Math.floor(x), j = Math.floor(y), fx = s(x - i), fy = s(y - j);
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}
/** Fractal noise over a tile size px across, repeating at its edges; cells: the coarsest cells across. */
function tileFbm(r, size, cells = 4, octaves = 4) {
  const ns = Array.from({ length: octaves }, (_, k) => periodicNoise(r, cells << k));
  return (px, py) => {
    let v = 0, amp = 1, tot = 0;
    for (let k = 0; k < octaves; k++) { v += ns[k]((px / size) * (cells << k), (py / size) * (cells << k)) * amp; tot += amp; amp *= 0.5; }
    return v / tot;
  };
}

const hex = (c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const rgb = (c, a = 1) => `rgba(${c.map((x) => Math.round(Math.max(0, Math.min(255, x)))).join(",")},${a})`;
const shade = (c, k) => rgb(hex(c).map((x) => x * k));
/** A color as #rrggbb, from [r, g, b]. */
const toHex = (c) => `#${c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("")}`;

/** Fills a tile with a noise-mottled color between dark and light (hex), lumpiness by cells. */
function mottle(g, size, r, dark, light, { cells = 4, contrast = 1, h = size } = {}) {
  const f = tileFbm(r, size, cells, 4), im = g.createImageData(size, h), A = hex(dark), B = hex(light);
  for (let y = 0; y < h; y++) for (let x = 0; x < size; x++) {
    const t = Math.max(0, Math.min(1, 0.5 + (f(x, y) - 0.5) * 2.2 * contrast)), c = mix(A, B, t), o = (y * size + x) * 4;
    im.data[o] = c[0]; im.data[o + 1] = c[1]; im.data[o + 2] = c[2]; im.data[o + 3] = 255;
  }
  g.putImageData(im, 0, 0);
}
/** Runs draw(dx, dy) once, and again shifted a tile over wherever the shape (reach px around x, y) crosses an edge. */
function wrapped(x, y, reach, size, draw) {
  const xs = [0], ys = [0];
  if (x - reach < 0) xs.push(size); if (x + reach > size) xs.push(-size);
  if (y - reach < 0) ys.push(size); if (y + reach > size) ys.push(-size);
  for (const dx of xs) for (const dy of ys) draw(dx, dy);
}

// ---------------------------------------------------------------------------------------------------------------------
// The looks: colors for each, and whether ink lines are drawn

const LOOKS = {
  painted: {
    ink: null, inkW: 0,
    grass: { summer: ["#4f6b2c", "#7a9a45"], spring: ["#5b7d31", "#8db352"], autumn: ["#6d6b2e", "#a59448"], winter: ["#cfd8df", "#f4f7fa"] },
    forest: { summer: ["#3f5326", "#677a3a"], spring: ["#47602a", "#768f44"], autumn: ["#5a4626", "#8f6d3a"], winter: ["#c8d1d8", "#eef2f6"] },
    dirt: ["#6b5236", "#9a7a52"], trodden: ["#7d6a4b", "#a89068"], bed: ["#5d564a", "#8c8471"],
    stone: ["#7b7a74", "#aaa79d"], mortar: "#4d4a44", wood: ["#6a4a2c", "#9b7043"], woodDark: "#3d2a19",
    water: ["#24546a", "#3f8099"], waterLight: "#9fd0dc", plaster: "#d8cdb4", beam: "#4a3320",
    leaf: { summer: ["#2f4d1f", "#5f8a35"], spring: ["#3d6a26", "#79a845"], autumn: ["#7a3e18", "#c98a2e"], winter: ["#5b5d52", "#86887a"] },
    leafAlt: { summer: [["#36561f", "#6e963a"], ["#2b4520", "#557a30"]], spring: [["#466f28", "#86b04c"], ["#3a6224", "#709c40"]], autumn: [["#6e2216", "#b4452a"], ["#5c5a1e", "#a0a03a"]] },
    conifer: { summer: ["#1f3a24", "#3f6b40"], spring: ["#22422a", "#457547"], autumn: ["#22402a", "#466e45"], winter: ["#2c4a34", "#d6e2e8"] },
    rock: ["#5f605d", "#9c9b94"], roof: { slate: ["#4c545c", "#7a848c"], shingle: ["#5b3e26", "#8a6440"], thatch: ["#8d7340", "#c9ad6a"], tile: ["#8a3b26", "#c2603c"] },
    cloth: ["#7a2f2a", "#3f5c7a", "#6b6a3a", "#5b3a6a"], metal: "#55575c", fire: "#f2a43a",
  },
  inked: {
    ink: "#3a352d", inkW: 2.4,
    grass: { summer: ["#a7b97d", "#c4d29c"], spring: ["#a9c27f", "#c9daa0"], autumn: ["#c2b47c", "#dacd9d"], winter: ["#e4e8ea", "#f6f8f9"] },
    forest: { summer: ["#97aa72", "#b4c48f"], spring: ["#9bb375", "#b8cb93"], autumn: ["#b9a274", "#d1be93"], winter: ["#dde2e5", "#f2f5f7"] },
    dirt: ["#c9b08b", "#ddc8a4"], trodden: ["#d4bf9b", "#e6d6b8"], bed: ["#b6ad9a", "#cfc8b6"],
    stone: ["#c9c4b8", "#e1ddd2"], mortar: "#8f877a", wood: ["#c39a6c", "#d9b78b"], woodDark: "#8a6a48",
    water: ["#8fb8c4", "#acd0d8"], waterLight: "#e6f3f5", plaster: "#eee5d0", beam: "#7b5c3e",
    leaf: { summer: ["#7f9c5c", "#a3bc7c"], spring: ["#8aab62", "#adc985"], autumn: ["#c8935a", "#e0b479"], winter: ["#a7a99c", "#c4c6ba"] },
    leafAlt: { summer: [["#8aa564", "#adc585"], ["#748f56", "#98b177"]], spring: [["#93b16a", "#b6cf8d"], ["#82a35f", "#a6c381"]], autumn: [["#c07560", "#da9a82"], ["#b4b06a", "#cfcb8c"]] },
    conifer: { summer: ["#6f8d62", "#8fab80"], spring: ["#749466", "#94b285"], autumn: ["#6f8d62", "#8fab80"], winter: ["#7d977a", "#e8eef1"] },
    rock: ["#b4b0a6", "#d2cfc6"], roof: { slate: ["#9aa3aa", "#b8c0c6"], shingle: ["#b48b62", "#cfa983"], thatch: ["#d4bb82", "#e6d3a2"], tile: ["#c47c5f", "#da9b80"] },
    cloth: ["#b46a60", "#7f97b0", "#a6a36e", "#957aa3"], metal: "#8d8f93", fire: "#f0b45a",
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// Textures

/** Widths from lo to hi (px, random) that add up to total exactly, so a run of them repeats at the tile's edge. */
function partition(r, total, lo, hi) {
  const out = []; let left = total;
  // (what's left near the end shared between two, so no piece comes out a sliver)
  while (left > hi) { if (left < lo + hi) { out.push(left / 2); left /= 2; break; } const w = r.range(lo, hi); out.push(w); left -= w; }
  out.push(left);
  return out;
}

/** Grass: mottled ground, blades, and by variant clover, small stones or a lighter tone. */
function grass(L, r, season, kind = "", forest = false) {
  const c = cv(T, T), g = c.getContext("2d");
  const [d, l] = (forest ? L.forest : L.grass)[season] ?? L.grass.summer;
  const light = kind === "light", winter = season === "winter";
  mottle(g, T, r, light ? toHex(mix(hex(d), hex(l), 0.35)) : d, l, { cells: 8, contrast: L.ink ? 0.35 : 0.55 });
  if (!winter) {
    // (blades: short strokes leaning one way, light and dark)
    const n = L.ink ? 260 : 2600;
    for (let i = 0; i < n; i++) {
      const x = r() * T, y = r() * T, len = L.ink ? r.range(6, 10) : r.range(3, 8), a = -Math.PI / 2 + r.range(-0.5, 0.5), lw = L.ink ? 1.4 : r.range(0.8, 1.6);
      const col = L.ink ? (r() < 0.7 ? rgb(hex(L.ink), 0.35) : rgb(hex(l), 0.9)) : rgb(mix(hex(d), hex(l), r.range(-0.3, 1.3)), 0.8);
      wrapped(x, y, len, T, (dx, dy) => {
        g.strokeStyle = col; g.lineWidth = lw;
        g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx + Math.cos(a) * len, y + dy + Math.sin(a) * len); g.stroke();
      });
    }
  }
  if (forest && !winter) dots(g, r, L, 90, [3, 7], season === "autumn" ? ["#a0562a", "#c78a3a", "#7a4a26"] : ["#5a4a2a", "#6e5a34"], 0.7);
  if (kind === "clover") dots(g, r, L, 120, [2, 4], ["#e8eadf", "#c9d6a8"], 0.9);
  if (kind === "rocky") pebbles(g, r, L, 40, [5, 12]);
  return c;
}
/** Small round marks scattered over a tile. */
function dots(g, r, L, n, [a, b], cols, alpha = 1) {
  for (let i = 0; i < n; i++) {
    const x = r() * T, y = r() * T, s = r.range(a, b), col = r.pick(cols), rot = r() * 3;
    wrapped(x, y, s + 1, T, (dx, dy) => { g.fillStyle = rgb(hex(col), alpha); g.beginPath(); g.ellipse(x + dx, y + dy, s, s * 0.7, rot, 0, 7); g.fill(); });
  }
}
/** Pebbles: little stones lit from the southeast. */
function pebbles(g, r, L, n, [a, b], base = L.rock) {
  for (let i = 0; i < n; i++) {
    const x = r() * T, y = r() * T, s = r.range(a, b), t = r();
    wrapped(x, y, s + 3, T, (dx, dy) => {
      const px = x + dx, py = y + dy;
      if (!L.ink) { g.fillStyle = "rgba(0,0,0,0.25)"; g.beginPath(); g.ellipse(px - s * 0.25, py - s * 0.25, s, s * 0.75, 0.4, 0, 7); g.fill(); }
      g.fillStyle = rgb(mix(hex(base[0]), hex(base[1]), t)); g.beginPath(); g.ellipse(px, py, s, s * 0.75, 0.4, 0, 7); g.fill();
      if (L.ink) { g.strokeStyle = rgb(hex(L.ink), 0.55); g.lineWidth = 1; g.stroke(); }
      else { g.fillStyle = "rgba(255,255,255,0.18)"; g.beginPath(); g.ellipse(px + s * 0.2, py + s * 0.2, s * 0.5, s * 0.35, 0.4, 0, 7); g.fill(); }
    });
  }
}
/** Bare earth: dirt, trodden ground or a stream's bed, with specks and stones. */
function earth(L, r, kind) {
  const c = cv(T, T), g = c.getContext("2d"), [d, l] = L[kind] ?? L.dirt;
  mottle(g, T, r, d, l, { cells: 8, contrast: L.ink ? 0.35 : 0.55 });
  dots(g, r, L, L.ink ? 80 : 700, [0.6, 1.8], [shade(d, 0.8), shade(l, 1.1)], L.ink ? 0.35 : 0.6);
  pebbles(g, r, L, kind === "bed" ? 70 : L.ink ? 6 : 14, kind === "bed" ? [4, 11] : [4, 8]);
  return c;
}
/** Water: mottled blue with light ripples (calm for a pond, a lake or the sea). */
function water(L, r, calm) {
  const c = cv(T, T), g = c.getContext("2d"), [d, l] = L.water;
  mottle(g, T, r, d, l, { cells: 2, contrast: L.ink ? 0.4 : 0.8 });
  for (let i = 0; i < (calm ? 40 : 90); i++) {
    const x = r() * T, y = r() * T, len = r.range(10, 34), alpha = r.range(0.15, 0.45), lw = L.ink ? 1.3 : r.range(1, 2.2);
    wrapped(x, y, len, T, (dx, dy) => {
      g.strokeStyle = L.ink ? rgb(hex(L.ink), 0.3) : rgb(hex(L.waterLight), alpha); g.lineWidth = lw; g.lineCap = "round";
      g.beginPath(); g.moveTo(x + dx, y + dy); g.quadraticCurveTo(x + dx + len / 2, y + dy - 3, x + dx + len, y + dy); g.stroke();
    });
  }
  return c;
}
/** Ice: pale blue, frosted in patches, crazed with cracks (more of them when cracked). */
function iceField(L, r, cracked) {
  const c = cv(T, T), g = c.getContext("2d");
  mottle(g, T, r, L.ink ? "#b9d6e0" : "#8fb9c9", L.ink ? "#e4f1f5" : "#d3e8ef", { cells: 3, contrast: 0.7 });
  for (let i = 0; i < (cracked ? 40 : 14); i++) {
    const pts = [[r() * T, r() * T]]; for (let k = 0; k < 5; k++) pts.push([pts.at(-1)[0] + r.range(-24, 24), pts.at(-1)[1] + r.range(-24, 24)]);
    wrapped(pts[0][0], pts[0][1], 130, T, (dx, dy) => { g.strokeStyle = L.ink ? rgb(hex(L.ink), 0.5) : "rgba(255,255,255,0.75)"; g.lineWidth = 1.4; g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x + dx, y + dy) : g.moveTo(x + dx, y + dy))); g.stroke(); });
  }
  return c;
}
/** One stone or brick, rounded, with the look's finish, in a cell (x, y, w, h) less its joint. */
function stoneCell(g, L, x, y, w, h, col, gap, rad) {
  const W = w - gap, H = h - gap;
  g.beginPath(); g.roundRect(x + gap / 2, y + gap / 2, W, H, rad);
  g.fillStyle = col; g.fill();
  if (L.ink) { g.strokeStyle = L.ink; g.lineWidth = 1.4; g.stroke(); return; }
  g.save(); g.clip();
  g.fillStyle = "rgba(255,255,255,0.13)"; g.fillRect(x + gap / 2, y + gap / 2 + H * 0.55, W, H);
  g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(x + gap / 2, y + gap / 2, W, H * 0.25);
  g.restore();
}
/**
 * Stones laid in a pattern: setts, bricks, long curb stones, tiles, a basket weave, flagstones or a stone floor.
 * Rows and their stones are sized to repeat exactly at the tile's edges.
 */
function stones(L, r, kind, base = L.stone) {
  const c = cv(T, T), g = c.getContext("2d");
  g.fillStyle = L.ink ? shade(base[0], 0.92) : L.mortar; g.fillRect(0, 0, T, T);
  const cells = [];
  if (kind === "setts" || kind === "brick" || kind === "curb") {
    const [w, h] = { setts: [40, 25], brick: [50, 25], curb: [100, 40] }[kind];
    for (let y = 0, row = 0; y < T; y += h, row++) { let x = (row % 2) * (w / 2); for (const ww of partition(r, T, w * 0.8, w * 1.2)) { cells.push([x, y, ww, h]); x += ww; } }
  } else if (kind === "tiles") {
    for (let y = 0; y < T; y += 50) for (let x = 0; x < T; x += 50) cells.push([x, y, 50, 50]);
  } else if (kind === "weave") {
    // (pairs of bricks, across and down by turns)
    for (let y = 0; y < T; y += 50) for (let x = 0; x < T; x += 50) for (let k = 0; k < 2; k++) cells.push(((x + y) / 50) % 2 ? [x + k * 25, y, 25, 50] : [x, y + k * 25, 50, 25]);
  } else {
    // (flagstones: the tile cut again and again into rectangles of a square or so)
    const big = kind === "floor" ? 110 : 80;
    const split = (x, y, w, h) => { if (w < big * 1.4 && h < big * 1.4) { cells.push([x, y, w, h]); return; } if (w > h) { const k = Math.round(w * r.range(0.35, 0.65)); split(x, y, k, h); split(x + k, y, w - k, h); } else { const k = Math.round(h * r.range(0.35, 0.65)); split(x, y, w, k); split(x, y + k, w, h - k); } };
    split(0, 0, T, T);
  }
  const gap = kind === "brick" || kind === "tiles" || kind === "weave" ? 2.5 : 3.5, rad = kind === "setts" ? 5 : 3;
  for (const [x, y, w, h] of cells) {
    const col = rgb(mix(hex(base[0]), hex(base[1]), r()));
    // (a stone past the right edge is drawn again at the left, so the tile repeats)
    for (const dx of x + w > T ? [0, -T] : [0]) stoneCell(g, L, x + dx, y, w, h, col, gap, rad);
  }
  if (!L.ink) { const o = cv(T, T), k = o.getContext("2d"); mottle(k, T, r, "#000000", "#ffffff", { cells: 3 }); g.globalAlpha = 0.12; g.globalCompositeOperation = "overlay"; g.drawImage(o, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; }
  return c;
}
/** Planks running across (or with down, stakes side by side): a wooden floor or deck, joints staggered, grain and nails. */
function planks(L, r, { dark = false, down = false } = {}) {
  const c = cv(T, T), g = c.getContext("2d"), h = 40, [a, b] = L.wood;
  g.fillStyle = L.ink ? L.woodDark : "#2a1c10"; g.fillRect(0, 0, T, T);
  if (down) { g.translate(T, 0); g.rotate(Math.PI / 2); }
  for (let y = 0; y < T; y += h) {
    let x = r.range(0, 120);
    for (const w of partition(r, T, 130, 260)) {
      const col = mix(hex(a), hex(b), r()).map((v) => v * (dark ? 0.75 : 1));
      const grain = Array.from({ length: 4 }, (_, k) => [y + 6 + k * 8 + r.range(-2, 2), r.range(-3, 3), r.range(-3, 3)]);
      const draw = (dx) => {
        g.fillStyle = rgb(col); g.fillRect(x + dx + 1, y + 1.5, w - 2, h - 3);
        g.strokeStyle = L.ink ? rgb(hex(L.ink), 0.25) : rgb(col.map((v) => v * 0.8), 0.7); g.lineWidth = 1;
        for (const [yy, u, v] of grain) { g.beginPath(); g.moveTo(x + dx + 4, yy); g.bezierCurveTo(x + dx + w / 3, yy + u, x + dx + (2 * w) / 3, yy + v, x + dx + w - 4, yy); g.stroke(); }
        if (L.ink) { g.strokeStyle = L.ink; g.lineWidth = 1.5; g.strokeRect(x + dx + 1, y + 1.5, w - 2, h - 3); }
        g.fillStyle = L.ink ? L.ink : "#1d140b"; for (const nx of [x + dx + 6, x + dx + w - 8]) { g.beginPath(); g.arc(nx, y + h / 2, 1.6, 0, 7); g.fill(); }
      };
      draw(0); if (x + w > T) draw(-T);
      x = (x + w) % T;
    }
  }
  return c;
}
/** Roofing in rows: slates, shingles, clay tiles or thatch. Rows run across, the eaves down; it repeats at its edges. */
function roofing(L, r, kind, color) {
  const c = cv(T, T), g = c.getContext("2d");
  const base = color ?? L.roof[kind] ?? L.roof.shingle;
  if (kind === "thatch") {
    mottle(g, T, r, base[0], base[1], { cells: 3, contrast: 0.8 });
    for (let i = 0; i < (L.ink ? 500 : 3000); i++) {
      const x = r() * T, y = r() * T, len = r.range(10, 24), lean = r.range(-2, 2);
      const col = L.ink ? rgb(hex(L.ink), 0.3) : rgb(mix(hex(base[0]), hex(base[1]), r.range(-0.4, 1.4)), 0.8);
      wrapped(x, y, len, T, (dx, dy) => { g.strokeStyle = col; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx + lean, y + dy + len); g.stroke(); });
    }
    for (let y = 25; y < T; y += 50) { g.fillStyle = L.ink ? rgb(hex(L.ink), 0.35) : "rgba(40,28,10,0.35)"; g.fillRect(0, y, T, 3); }
    return c;
  }
  // (rows of 25 px, 16 to the tile; each row's pieces fill it exactly, the next row's joints half a piece over)
  const w = kind === "tile" ? 34 : kind === "slate" ? 44 : 38, h = 25;
  g.fillStyle = shade(base[0], 0.6); g.fillRect(0, 0, T, T);
  const rows = [];
  for (let y = 0, row = 0; y < T; y += h, row++) { let x = (row % 2) * (w / 2) + w / 4; rows.push(partition(r, T, w * 0.85, w * 1.15).map((ww) => { const p = [x, y, ww, mix(hex(base[0]), hex(base[1]), r())]; x += ww; return p; })); }
  // (drawn from the top row down, each lapping the one above; the top row again under the tile's bottom edge; ink
  // lines after every fill, so the row below doesn't cover them)
  const pieces = [...rows, rows[0].map(([x, , ww, col]) => [x, T, ww, col])].flat().flatMap(([x, y, ww, col]) => (x + ww > T ? [[x, y, ww, col], [x - T, y, ww, col]] : [[x, y, ww, col]]));
  for (const [X, y, ww, col] of pieces) {
    g.fillStyle = rgb(col);
    if (kind === "tile") { g.beginPath(); g.moveTo(X, y - h * 0.2); g.lineTo(X + ww, y - h * 0.2); g.lineTo(X + ww, y + h * 0.6); g.quadraticCurveTo(X + ww / 2, y + h * 1.2, X, y + h * 0.6); g.closePath(); g.fill(); }
    else g.fillRect(X + 1, y - 4, ww - 2, h + 4);
    if (!L.ink) { g.fillStyle = "rgba(0,0,0,0.28)"; g.fillRect(X + 1, y + h - 3, ww - 2, 3); g.fillStyle = "rgba(255,255,255,0.1)"; g.fillRect(X + 1, y - 4, ww - 2, 3); }
  }
  if (L.ink) for (const [X, y, ww] of pieces) { g.strokeStyle = L.ink; g.lineWidth = 1.3; g.beginPath(); g.moveTo(X, y - 4); g.lineTo(X + ww, y - 4); g.moveTo(X + 1, y - 4); g.lineTo(X + 1, y + h - 4); g.stroke(); }
  return c;
}
/** Rough stone: mottled rock with cracks. */
function rough(L, r, season) {
  const c = cv(T, T), g = c.getContext("2d");
  mottle(g, T, r, L.rock[0], L.rock[1], { cells: 3, contrast: L.ink ? 0.6 : 1.2 });
  for (let i = 0; i < 18; i++) {
    const pts = [[r() * T, r() * T]]; for (let k = 0; k < 5; k++) pts.push([pts.at(-1)[0] + r.range(-14, 14), pts.at(-1)[1] + r.range(-14, 14)]);
    wrapped(pts[0][0], pts[0][1], 80, T, (dx, dy) => { g.strokeStyle = L.ink ? L.ink : "rgba(30,30,28,0.55)"; g.lineWidth = L.ink ? 1.3 : 1.5; g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x + dx, y + dy) : g.moveTo(x + dx, y + dy))); g.stroke(); });
  }
  if (season === "winter") dots(g, r, L, 60, [6, 14], ["#eef3f6"], 0.8);
  return c;
}
/** A palisade's stakes from above: round tops side by side, in rows. */
function stakes(L, r) {
  const c = cv(T, T), g = c.getContext("2d");
  g.fillStyle = L.ink ? L.woodDark : "#24180d"; g.fillRect(0, 0, T, T);
  for (let y = 0, row = 0; y < T; y += 40, row++) for (let x = (row % 2) * 20; x < T + 40; x += 40) {
    const col = mix(hex(L.wood[0]), hex(L.wood[1]), r()), R = r.range(16, 19);
    for (const dx of x + R > T ? [0, -T] : [0]) {
      g.fillStyle = rgb(col); g.beginPath(); g.arc(x + dx, y + 20, R, 0, 7); g.fill();
      g.strokeStyle = L.ink ? L.ink : rgb(col.map((v) => v * 0.7)); g.lineWidth = L.ink ? 1.4 : 1; for (const k of [R, R * 0.55]) { g.beginPath(); g.arc(x + dx, y + 20, k, 0, 7); g.stroke(); }
    }
  }
  return c;
}
/** Snow dusted over a drawn image where it isn't clear: patches thick on a texture, a light dusting on a sprite. */
function snowOn(c, r, heavy) {
  const g = c.getContext("2d"), w = c.width, h = c.height;
  g.save(); g.globalCompositeOperation = "source-atop";
  const n = Math.round((w * h) / (heavy ? 900 : 2600));
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h, s = r.range(heavy ? 5 : 3, heavy ? 16 : 8);
    const draw = (dx, dy) => { g.fillStyle = `rgba(244,248,251,${heavy ? 0.85 : 0.75})`; g.beginPath(); g.ellipse(x + dx, y + dy, s, s * 0.7, 0.4, 0, 7); g.fill(); };
    if (heavy && w === T && h === T) wrapped(x, y, s + 1, T, draw); else draw(0, 0);
  }
  g.restore();
  return c;
}

// ---------------------------------------------------------------------------------------------------------------------
// Path strips (200 px tall, the band in the middle; along it they repeat every 400 px)

function stripCanvas(bandH, draw, w = T) {
  const c = cv(w, PX), g = c.getContext("2d"), y0 = (PX - bandH) / 2;
  draw(g, y0, bandH, w);
  return c;
}
/** A wall: stones, plaster between timbers, or boards, along its band. */
function wallStrip(L, r, kind) {
  return stripCanvas(60, (g, y0, h, w) => {
    if (kind === "wood") {
      g.fillStyle = L.woodDark; g.fillRect(0, y0, w, h);
      for (let k = 0; k < 4; k++) { g.fillStyle = rgb(mix(hex(L.wood[0]), hex(L.wood[1]), r())); g.fillRect(0, y0 + 1 + k * (h / 4), w, h / 4 - 2); }
    } else if (kind === "timber") {
      // (from above a timber wall shows its top plate: one long beam with its grain, a joint every square; posts and
      // plaster panels squeezed to the wall's thickness read as dashes)
      g.fillStyle = L.beam; g.fillRect(0, y0, w, h);
      const grain = rgb(hex(L.beam).map((v) => v * 0.78)), light = rgb(hex(L.beam).map((v) => Math.min(255, v * 1.18)));
      for (let k = 0; k < 7; k++) {
        const y = y0 + 6 + r() * (h - 12), x0 = r() * w, len = r.range(w * 0.2, w * 0.6);
        g.strokeStyle = k % 3 ? grain : light; g.lineWidth = r.range(1, 2.2);
        for (const dx of x0 + len > w ? [0, -w] : [0]) { g.beginPath(); g.moveTo(x0 + dx, y); g.lineTo(x0 + dx + len, y + r.range(-2, 2)); g.stroke(); }
      }
      g.fillStyle = rgb(hex(L.beam).map((v) => v * 0.55));
      for (let x = 0; x < w; x += PX) { g.fillRect(x, y0, 3, h); g.fillRect(x + 3, y0 + h * 0.3, 2, h * 0.4); }
    } else {
      g.fillStyle = L.mortar; g.fillRect(0, y0, w, h);
      // (two courses: a wall is squeezed to its thickness, so more would read as dashes)
      for (let row = 0; row < 2; row++) {
        let x = row * 28;
        for (const sw of partition(r, w, 44, 70)) {
          const col = mix(hex(L.stone[0]), hex(L.stone[1]), r() * 0.7).map((v) => v * (L.ink ? 1 : 0.85));
          for (const dx of x + sw > w ? [0, -w] : [0]) { g.fillStyle = rgb(kind === "stonewood" && row === 1 ? hex(L.wood[0]) : col); g.beginPath(); g.roundRect(x + dx + 1, y0 + row * (h / 2) + 1, sw - 2, h / 2 - 2, 3); g.fill(); if (L.ink) { g.strokeStyle = L.ink; g.lineWidth = 1.2; g.stroke(); } }
          x = (x + sw) % w;
        }
      }
    }
    if (L.ink) { g.strokeStyle = L.ink; g.lineWidth = 3; g.beginPath(); g.moveTo(0, y0 + 1.5); g.lineTo(w, y0 + 1.5); g.moveTo(0, y0 + h - 1.5); g.lineTo(w, y0 + h - 1.5); g.stroke(); }
    else { g.fillStyle = "rgba(255,255,255,0.12)"; g.fillRect(0, y0, w, 6); g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(0, y0 + h - 6, w, 6); }
  });
}
/** A fence: rails between posts (wood), or a dry-stone run (stone). */
function fenceStrip(L, r, stone) {
  if (stone) return stripCanvas(36, (g, y0, h, w) => {
    g.fillStyle = L.mortar; g.fillRect(0, y0, w, h);
    let x = 0;
    for (const sw of partition(r, w, 16, 30)) {
      const col = rgb(mix(hex(L.rock[0]), hex(L.rock[1]), r())), dy = r.range(-4, 4);
      for (const dx of [0, ...(x + sw * 1.1 > w ? [-w] : []), ...(x - sw * 0.1 < 0 ? [w] : [])]) { g.fillStyle = col; g.beginPath(); g.ellipse(x + dx + sw / 2, y0 + h / 2 + dy, sw * 0.6, h / 2 - 2, 0, 0, 7); g.fill(); if (L.ink) { g.strokeStyle = L.ink; g.lineWidth = 1.2; g.stroke(); } }
      x += sw;
    }
  });
  return stripCanvas(22, (g, y0, h, w) => {
    g.fillStyle = rgb(hex(L.wood[0])); g.fillRect(0, y0 + 6, w, h - 12);
    if (L.ink) { g.strokeStyle = L.ink; g.lineWidth = 1.5; g.strokeRect(-2, y0 + 6, w + 4, h - 12); }
    for (let x = 20; x < w; x += 100) { g.fillStyle = L.woodDark; g.fillRect(x - 7, y0, 14, h); if (L.ink) { g.strokeStyle = L.ink; g.strokeRect(x - 7, y0, 14, h); } }
  });
}
/** A window: a pane in a frame across the wall's band, a square wide. */
function windowStrip(L) {
  return stripCanvas(60, (g, y0, h) => {
    g.fillStyle = L.beam; g.fillRect(30, y0, 140, h);
    g.fillStyle = L.ink ? "#cfe3ea" : "#7fb1c4"; g.fillRect(42, y0 + 18, 116, h - 36);
    g.fillStyle = L.beam; g.fillRect(97, y0 + 18, 6, h - 36);
    if (L.ink) { g.strokeStyle = L.ink; g.lineWidth = 2; g.strokeRect(30, y0, 140, h); }
  }, PX);
}
/**
 * A bank or cliff, as a path strip: part "bank" (a grassy lip along the top, earth and roots down its face, a pale toe),
 * "face" (a rock face in ledges), "top" (a lip of rock under turf) or "foot" (scree spreading out); kind earthy, mossy,
 * slate or ice.
 */
function bankStrip(L, r, kind, season, part = "bank") {
  // (a cliff's top is only its lip: a narrow edge of rock under the grass or snow that overhangs it)
  const c = cv(T, PX), g = c.getContext("2d"), y0 = 30, h = part === "top" ? 44 : 140;
  const rocky = kind === "slate" || part === "face" || part === "foot", icy = kind === "ice";
  const [d, l] = icy ? ["#a9c9d6", "#e6f2f6"] : rocky ? L.rock : L.dirt;
  if (part === "foot") {
    for (let i = 0; i < 70; i++) { const y = y0 + Math.pow(r(), 1.6) * h, x = r.range(14, T - 14), s = r.range(4, 13) * (1 - (y - y0) / h * 0.6); g.fillStyle = rgb(mix(hex(d), hex(l), r())); g.beginPath(); g.ellipse(x, y, s, s * 0.7, r() * 3, 0, 7); g.fill(); if (L.ink) { g.strokeStyle = rgb(hex(L.ink), 0.6); g.lineWidth = 1; g.stroke(); } }
    return c;
  }
  const grd = g.createLinearGradient(0, y0, 0, y0 + h);
  grd.addColorStop(0, shade(d, 0.6)); grd.addColorStop(0.5, d); grd.addColorStop(1, l);
  g.fillStyle = grd; g.fillRect(0, y0, T, h);
  if (part === "face" || rocky) {
    // (ledges across, cracks down)
    // (each ledge's line starts and ends at the same height, so the strip repeats)
    for (let y = y0 + 18; y < y0 + h; y += r.range(16, 28)) { const jog = Array.from({ length: T / 20 }, () => r.range(-4, 4)); jog.push(jog[0]); g.strokeStyle = L.ink ? rgb(hex(L.ink), 0.6) : "rgba(20,20,20,0.45)"; g.lineWidth = 2; g.beginPath(); jog.forEach((j, k) => (k ? g.lineTo(k * 20, y + j) : g.moveTo(0, y + j))); g.stroke(); g.fillStyle = "rgba(255,255,255,0.12)"; g.fillRect(0, y + 2, T, 4); }
    for (let i = 0; i < 26; i++) { const x = r.range(8, T - 8), yy = y0 + r() * h, dx = r.range(-6, 6), dy = r.range(10, 24); g.strokeStyle = L.ink ? rgb(hex(L.ink), 0.45) : "rgba(20,20,20,0.35)"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, yy); g.lineTo(x + dx, yy + dy); g.stroke(); }
  } else {
    for (let i = 0; i < 40; i++) { const x = r.range(14, T - 14), y = y0 + 12 + r() * (h - 24); g.fillStyle = L.ink ? rgb(hex(L.ink), 0.5) : rgb(hex(d), 0.6); g.beginPath(); g.ellipse(x, y, r.range(4, 12), r.range(2, 5), 0, 0, 7); g.fill(); }
    if (L.ink) for (let x = 6; x < T; x += 14) { g.strokeStyle = rgb(hex(L.ink), 0.6); g.lineWidth = 1.3; g.beginPath(); g.moveTo(x, y0 + 8); g.lineTo(x + r.range(-3, 3), y0 + h * r.range(0.35, 0.6)); g.stroke(); }
  }
  // (the lip: grass, or snow in winter, over the top edge; none on a bare face)
  if (part !== "face") {
    const [gd, gl] = season === "winter" || icy ? ["#dfe8ee", "#fbfdfe"] : L.grass[season] ?? L.grass.summer;
    g.fillStyle = gd; g.fillRect(0, y0, T, 10);
    for (let x = 0; x < T; x += 3) { g.strokeStyle = r() < 0.5 ? gd : gl; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y0 + 4); g.lineTo(x + r.range(-2, 2), y0 + 10 + r.range(2, 14)); g.stroke(); }
  }
  if (L.ink) { g.strokeStyle = L.ink; g.lineWidth = 2.5; g.beginPath(); g.moveTo(0, y0 + 2); g.lineTo(T, y0 + 2); g.stroke(); }
  return c;
}
/** A soft fringe of grass along a path's band, fading out to both sides. */
function grassEdge(L, r, season) {
  const c = cv(T, PX), g = c.getContext("2d"), [d, l] = L.grass[season] ?? L.grass.summer;
  for (let i = 0; i < 900; i++) { const x = r.range(3, T - 3), y = PX / 2 + (r() + r() + r() - 1.5) * 36; g.strokeStyle = rgb(mix(hex(d), hex(l), r()), 0.85); g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + r.range(-2, 2), y - r.range(4, 9)); g.stroke(); }
  return c;
}

// ---------------------------------------------------------------------------------------------------------------------
// Sprites (props, furniture, trees), drawn in a w by h squares box on a clear ground

function sprite(w, h, draw) { const c = cv(w * PX, h * PX), g = c.getContext("2d"); draw(g, w * PX, h * PX); return c; }
/** A shape with the look's finish: a soft drop shadow and highlight (painted) or an ink outline (inked). */
function finish(g, L, path, fill, { shadow = true, lw = 1 } = {}) {
  if (!L.ink && shadow) { g.save(); g.translate(-5, -5); g.fillStyle = "rgba(0,0,0,0.3)"; path(); g.fill(); g.restore(); }
  g.fillStyle = fill; path(); g.fill();
  if (L.ink) { g.strokeStyle = L.ink; g.lineWidth = L.inkW * lw; g.lineJoin = "round"; path(); g.stroke(); }
}
const roundRect = (g, x, y, w, h, r) => () => { g.beginPath(); g.roundRect(x, y, w, h, r); };
const circle = (g, x, y, r) => () => { g.beginPath(); g.arc(x, y, r, 0, 7); };

/** A tree's crown: clumps of leaves (broadleaf), whorls of needles (fir) or bare branches; lit from the southeast. */
function crown(L, r, kind, season, variant = 0) {
  const S = 600, c = cv(S, S), g = c.getContext("2d"), m = S / 2;
  if (kind === "bare") {
    g.strokeStyle = L.ink ?? "#3b2c1f"; g.lineCap = "round";
    const branch = (x, y, a, len, wdt, depth) => { if (depth > 5 || len < 8) return; const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len; g.lineWidth = wdt; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke(); for (let k = 0; k < 2; k++) branch(x2, y2, a + r.range(-0.7, 0.7), len * 0.68, wdt * 0.65, depth + 1); };
    for (let k = 0; k < 6; k++) branch(m, m, (k / 6) * 2 * Math.PI + r.range(-0.3, 0.3), 90, 12, 0);
    return c;
  }
  const fir = kind === "conifer";
  let [d, l] = fir ? L.conifer[season] ?? L.conifer.summer : L.leaf[season] ?? L.leaf.summer;
  // (each variant of a broadleaf its own tone: in autumn red, gold or still green)
  if (!fir && variant) { const alt = (L.leafAlt[season] ?? [])[variant - 1]; if (alt) [d, l] = alt; }
  const R = m * 0.94;
  // The outline: bumps around the rim (rounded for leaves, sharp tips for needles)
  const n = fir ? 34 : 13, rad = Array.from({ length: n }, () => r.range(fir ? 0.8 : 0.84, 1));
  const rim = (k = 1, ox = 0, oy = 0) => {
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * 2 * Math.PI, a1 = ((i + 1) / n) * 2 * Math.PI, am = (a0 + a1) / 2, r0 = R * k * rad[i], r1 = R * k * rad[(i + 1) % n];
      const p0 = [m + ox + Math.cos(a0) * r0, m + oy + Math.sin(a0) * r0], p1 = [m + ox + Math.cos(a1) * r1, m + oy + Math.sin(a1) * r1];
      if (i === 0) g.moveTo(...p0);
      if (fir) { const rm = (r0 + r1) / 2 * 0.82; g.lineTo(m + ox + Math.cos(am) * rm, m + oy + Math.sin(am) * rm); g.lineTo(...p1); }
      else { const rm = ((r0 + r1) / 2) * 1.14; g.quadraticCurveTo(m + ox + Math.cos(am) * rm, m + oy + Math.sin(am) * rm, ...p1); }
    }
    g.closePath();
  };
  if (L.ink) {
    // (as the illustrated style's trees: a crown in one tone, an inked rim, a sunlit top)
    g.fillStyle = d; rim(); g.fill();
    g.save(); rim(); g.clip(); g.fillStyle = rgb(mix(hex(d), hex(l), 0.85)); rim(0.62, R * 0.12, R * 0.12); g.fill(); g.restore();
    if (fir) { g.strokeStyle = rgb(hex(L.ink), 0.55); g.lineWidth = 1.6; for (let i = 0; i < 12; i++) { const a = (i / 12) * 2 * Math.PI; g.beginPath(); g.moveTo(m, m); g.lineTo(m + Math.cos(a) * R * 0.7, m + Math.sin(a) * R * 0.7); g.stroke(); } }
    g.strokeStyle = L.ink; g.lineWidth = 4; g.lineJoin = "round"; rim(); g.stroke();
    return c;
  }
  // Painted: the crown in shade, then clumps lit toward the southeast, then speckle, all inside the rim
  g.save(); rim(); g.clip();
  g.fillStyle = shade(d, 0.8); g.fillRect(0, 0, S, S);
  if (fir) {
    // (needles: strokes out from the trunk, the outer ones lighter, in three whorls)
    for (let w = 0; w < 3; w++) for (let i = 0; i < 260; i++) {
      const a = r() * 2 * Math.PI, len = R * r.range(0.35, 1) * (1 - w * 0.22), t = len / R;
      const x = m + Math.cos(a) * len, y = m + Math.sin(a) * len, lit = 0.5 + 0.5 * Math.cos(a - Math.PI / 4);
      g.strokeStyle = rgb(mix(hex(d), hex(l), Math.min(1, t * 0.6 + lit * 0.5 + w * 0.15)), 0.9); g.lineWidth = r.range(2, 4);
      g.beginPath(); g.moveTo(m + Math.cos(a) * len * 0.5, m + Math.sin(a) * len * 0.5); g.lineTo(x, y); g.stroke();
    }
  } else {
    for (let i = 0; i < 70; i++) {
      const a = r() * 2 * Math.PI, rr = Math.sqrt(r()) * R * 0.8, x = m + Math.cos(a) * rr, y = m + Math.sin(a) * rr, cr = r.range(R * 0.16, R * 0.3);
      const lit = 0.35 + 0.35 * ((x - m + y - m) / (2 * R)) + 0.3 * (rr / R);
      const gr = g.createRadialGradient(x + cr * 0.35, y + cr * 0.35, cr * 0.1, x, y, cr);
      gr.addColorStop(0, rgb(mix(hex(d), hex(l), Math.min(1, lit + 0.35)))); gr.addColorStop(1, rgb(mix(hex(d), hex(l), Math.max(0, lit - 0.35)), 0.95));
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, cr, 0, 7); g.fill();
    }
  }
  for (let i = 0; i < 700; i++) { const a = r() * 2 * Math.PI, rr = Math.sqrt(r()) * R; g.fillStyle = rgb(mix(hex(d), hex(l), r.range(-0.2, 1.4)), 0.5); g.beginPath(); g.arc(m + Math.cos(a) * rr, m + Math.sin(a) * rr, r.range(2, 5), 0, 7); g.fill(); }
  // (the rim darker, so a crown reads against the next)
  const gr = g.createRadialGradient(m + R * 0.15, m + R * 0.15, R * 0.5, m, m, R * 1.05);
  gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,0.35)"); g.fillStyle = gr; g.fillRect(0, 0, S, S);
  g.restore();
  if (season === "winter" && fir) { g.save(); rim(); g.clip(); for (let i = 0; i < 120; i++) { const a = r() * 2 * Math.PI, rr = r() * R; g.fillStyle = "rgba(240,246,250,0.85)"; g.beginPath(); g.ellipse(m + Math.cos(a) * rr, m + Math.sin(a) * rr, r.range(6, 14), r.range(3, 7), a, 0, 7); g.fill(); } g.restore(); }
  return c;
}
/** A bush: a small crown. */
function bush(L, r, season) {
  const big = crown(L, r, season === "winter" ? "bare" : "leaf", season), c = cv(PX, PX);
  c.getContext("2d").drawImage(big, 0, 0, PX, PX);
  return c;
}
/** A rock or boulder: a lumpy stone lit from the southeast, on a 2 by 2 ground (fill: how much of it the stone takes). */
function rock(L, r, fill, size = 2) {
  return sprite(size, size, (g, w, h) => {
    const pts = []; const n = 10; for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI; pts.push([w / 2 + Math.cos(a) * w * fill * r.range(0.4, 0.5), h / 2 + Math.sin(a) * h * fill * r.range(0.32, 0.45)]); }
    const path = () => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
    finish(g, L, path, L.rock[0]);
    if (!L.ink) { g.save(); path(); g.clip(); const gr = g.createLinearGradient(w * 0.2, h * 0.2, w * 0.8, h * 0.8); gr.addColorStop(0, "rgba(0,0,0,0.3)"); gr.addColorStop(1, "rgba(255,255,255,0.35)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.restore(); }
    else { g.fillStyle = L.rock[1]; g.beginPath(); g.ellipse(w * 0.55, h * 0.56, w * fill * 0.2, h * fill * 0.14, 0.5, 0, 7); g.fill(); }
  });
}
/** A log lying across a 6 by 2 ground (or with down, along a 1 by 3 one): bark along it, rings at its end. */
function log(L, r, down = false) {
  if (down) { const c = cv(PX, 3 * PX), g = c.getContext("2d"), k = log(L, r); g.translate(PX, 0); g.rotate(Math.PI / 2); g.drawImage(k, 0, 0, 3 * PX, PX); return c; }
  return sprite(6, 2, (g, w, h) => {
    finish(g, L, roundRect(g, w * 0.08, h * 0.3, w * 0.84, h * 0.4, h * 0.2), shade(L.wood[0], 0.85));
    g.strokeStyle = L.ink ? rgb(hex(L.ink), 0.6) : "rgba(30,20,10,0.6)"; g.lineWidth = 3;
    for (let k = 0; k < 5; k++) { const y = h * (0.36 + k * 0.07); g.beginPath(); g.moveTo(w * 0.12, y); g.lineTo(w * 0.86, y + r.range(-5, 5)); g.stroke(); }
    finish(g, L, () => { g.beginPath(); g.ellipse(w * 0.9, h / 2, h * 0.09, h * 0.19, 0, 0, 7); }, L.wood[1], { shadow: false });
  });
}
/** A stump on a 4 by 4 ground: a cut top with rings, its roots spreading. */
function stump(L, r, size = 4) {
  return sprite(size, size, (g, w) => {
    for (let k = 0; k < 5; k++) { const a = k * 1.3 + r(); g.strokeStyle = L.ink ?? shade(L.wood[0], 0.7); g.lineWidth = 22; g.lineCap = "round"; g.beginPath(); g.moveTo(w / 2, w / 2); g.quadraticCurveTo(w / 2 + Math.cos(a + 0.3) * w * 0.2, w / 2 + Math.sin(a + 0.3) * w * 0.2, w / 2 + Math.cos(a) * w * 0.32, w / 2 + Math.sin(a) * w * 0.32); g.stroke(); }
    finish(g, L, circle(g, w / 2, w / 2, w * 0.17), L.wood[1]);
    g.strokeStyle = L.ink ? rgb(hex(L.ink), 0.6) : rgb(hex(L.wood[0]), 0.8); g.lineWidth = 2.5; for (const k of [0.12, 0.08, 0.04]) { g.beginPath(); g.arc(w / 2, w / 2, w * k, 0, 7); g.stroke(); }
  });
}
/** A fern on a 2 by 2 ground: fronds out from the middle. */
function fern(L, r, season) {
  const [d, l] = L.leaf[season] ?? L.leaf.summer;
  return sprite(2, 2, (g, w) => {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * 2 * Math.PI + r(), len = w * r.range(0.3, 0.42);
      g.save(); g.translate(w / 2, w / 2); g.rotate(a);
      g.strokeStyle = L.ink ?? d; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(len, 0); g.stroke();
      for (let t = 0.12; t < 1; t += 0.1) { g.fillStyle = rgb(mix(hex(d), hex(l), t)); g.beginPath(); g.ellipse(len * t, 0, 10, (1 - t) * 26 + 5, 0, 0, 7); g.fill(); }
      g.restore();
    }
  });
}
/** Litter: a fallen branch, roots, or leaves strewn. */
function litter(L, r, kind, season, [sw, sh] = [1, 1]) {
  const [d, l] = L.leaf[season] ?? L.leaf.summer;
  return sprite(sw, sh, (g, w, h) => {
    if (kind === "leaves") { for (let i = 0; i < 26 * sw * sh; i++) { g.fillStyle = rgb(mix(hex(d), hex(l), r()), 0.95); g.beginPath(); g.ellipse(r.range(0.1, 0.9) * w, r.range(0.1, 0.9) * h, 6, 3, r() * 3, 0, 7); g.fill(); } return; }
    g.strokeStyle = L.ink ?? shade(L.wood[0], 0.8); g.lineCap = "round";
    const twig = (x, y, a, len, wd, dep) => { if (dep > 3) return; const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len; g.lineWidth = wd; g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke(); twig(x2, y2, a + r.range(-0.6, 0.6), len * 0.6, wd * 0.6, dep + 1); if (r() < 0.6) twig(x2, y2, a + r.range(-1, 1), len * 0.5, wd * 0.5, dep + 1); };
    if (kind === "roots") { for (let k = 0; k < 5; k++) twig(w / 2, h / 2, (k / 5) * 2 * Math.PI + r(), w * 0.22, 10, 0); return; }
    twig(w * 0.5, h * 0.92, -Math.PI / 2 + r.range(-0.2, 0.2), h * 0.4, 7, 0);
  });
}
/** A barrel seen from above: staves, two hoops. */
function barrel(L, r, size = 1) {
  return sprite(size, size, (g, w) => {
    finish(g, L, circle(g, w / 2, w / 2, w * 0.4), L.wood[0]);
    g.strokeStyle = L.ink ?? L.metal; g.lineWidth = 4; for (const k of [0.4, 0.3]) { g.beginPath(); g.arc(w / 2, w / 2, w * k - 2, 0, 7); g.stroke(); }
    g.fillStyle = L.wood[1]; g.beginPath(); g.arc(w / 2, w / 2, w * 0.27, 0, 7); g.fill();
    g.strokeStyle = L.ink ? rgb(hex(L.ink), 0.5) : rgb(hex(L.wood[0]), 0.9); g.lineWidth = 1.5; for (let x = -2; x <= 2; x++) { g.beginPath(); g.moveTo(w / 2 + x * w * 0.1, w * 0.25); g.lineTo(w / 2 + x * w * 0.1, w * 0.75); g.stroke(); }
  });
}
/** A crate: boards and a cross brace. */
function crate(L, r) {
  return sprite(1, 1, (g, w) => {
    const m = w * 0.12;
    finish(g, L, roundRect(g, m, m, w - 2 * m, w - 2 * m, 4), L.wood[1]);
    g.strokeStyle = L.ink ?? L.woodDark; g.lineWidth = 6; g.strokeRect(m + 6, m + 6, w - 2 * m - 12, w - 2 * m - 12);
    g.beginPath(); g.moveTo(m + 6, m + 6); g.lineTo(w - m - 6, w - m - 6); g.stroke();
  });
}
/** A table: round or square, a work table plain, with things on it. */
function table(L, r, kind, w, h) {
  return sprite(w, h, (g, W, H) => {
    const m = Math.min(W, H) * 0.08;
    const path = kind === "round" ? circle(g, W / 2, H / 2, Math.min(W, H) / 2 - m) : roundRect(g, m, m, W - 2 * m, H - 2 * m, 8);
    finish(g, L, path, L.wood[1]);
    g.save(); path(); g.clip(); g.strokeStyle = L.ink ? rgb(hex(L.ink), 0.3) : rgb(hex(L.wood[0]), 0.7); g.lineWidth = 1.5; for (let y = m; y < H; y += 22) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); } g.restore();
    if (kind !== "work") for (let i = 0; i < 4; i++) { const x = W / 2 + r.range(-W * 0.25, W * 0.25), y = H / 2 + r.range(-H * 0.25, H * 0.25); finish(g, L, circle(g, x, y, 14), L.ink ? "#f3efe4" : "#d9d2c0", { shadow: false, lw: 0.6 }); }
    else { finish(g, L, roundRect(g, W * 0.2, H * 0.3, W * 0.2, H * 0.4, 4), L.metal, { shadow: false, lw: 0.6 }); }
  });
}
/** A chair, stool or bench: a seat (a chair with its back along the top). */
function seat(L, r, kind, w, h) {
  return sprite(w, h, (g, W, H) => {
    const m = Math.min(W, H) * 0.18;
    if (kind === "stool") { finish(g, L, circle(g, W / 2, H / 2, Math.min(W, H) * 0.3), L.wood[1]); return; }
    finish(g, L, roundRect(g, m, m, W - 2 * m, H - 2 * m, 6), L.wood[1]);
    if (kind === "chair") finish(g, L, roundRect(g, m, m, W - 2 * m, H * 0.16, 4), L.wood[0], { shadow: false });
  });
}
/** A bed: frame, blanket and pillow (the head at the top). */
function bed(L, r, w, h) {
  return sprite(w, h, (g, W, H) => {
    const m = W * 0.06;
    finish(g, L, roundRect(g, m, m, W - 2 * m, H - 2 * m, 8), L.wood[0]);
    finish(g, L, roundRect(g, m * 2, H * 0.28, W - 4 * m, H * 0.66, 10), r.pick(L.cloth), { shadow: false });
    for (let k = 0; k < (W > 1.5 * PX ? 2 : 1); k++) { const pw = (W - 5 * m) / (W > 1.5 * PX ? 2 : 1); finish(g, L, roundRect(g, m * 2.5 + k * pw, H * 0.08, pw - m, H * 0.16, 10), L.ink ? "#f3efe4" : "#e2dccb", { shadow: false }); }
  });
}
/** A long counter or shelf: a board, with goods on a shelf. */
function counter(L, r, kind, w, h) {
  return sprite(w, h, (g, W, H) => {
    finish(g, L, roundRect(g, 4, 4, W - 8, H - 8, 6), kind === "bar" ? L.wood[0] : L.wood[1]);
    if (kind === "goods" || kind === "shelf") for (let x = 14; x < W - 14; x += r.range(18, 30)) finish(g, L, roundRect(g, x, H * 0.25, r.range(10, 16), H * 0.5, 3), r.pick([...L.cloth, L.metal]), { shadow: false, lw: 0.5 });
    if (kind === "bar") for (let i = 0; i < W / 70; i++) finish(g, L, circle(g, 30 + i * 70, H / 2, 9), L.ink ? "#f3efe4" : "#c9c0aa", { shadow: false, lw: 0.6 });
  });
}
/** A hearth, oven, forge or fire: stone around a fire. */
function fire(L, r, kind, w, h) {
  return sprite(w, h, (g, W, H) => {
    const stone = kind === "oven" || kind === "forge" || kind.startsWith("hearth");
    if (stone) finish(g, L, roundRect(g, 4, 4, W - 8, H - 8, kind === "oven" ? Math.min(W, H) / 2 : 10), L.stone[0]);
    if (kind === "firepit" || kind === "campfire") finish(g, L, circle(g, W / 2, H / 2, Math.min(W, H) * 0.42), L.rock[0]);
    const R = Math.min(W, H) * 0.24, gr = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, R);
    gr.addColorStop(0, "#fff2b0"); gr.addColorStop(0.5, L.fire); gr.addColorStop(1, "rgba(160,40,10,0.9)");
    g.fillStyle = gr; g.beginPath(); g.arc(W / 2, H / 2, R, 0, 7); g.fill();
  });
}
/** Stairs: treads across, going up toward the top. */
function stairs(L, r, stone, w, h) {
  return sprite(w, h, (g, W, H) => {
    const base = stone ? L.stone : L.wood, n = 9;
    for (let k = 0; k < n; k++) { const t = k / n; finish(g, L, roundRect(g, 6, (H * k) / n + 2, W - 12, H / n - 4, 3), rgb(mix(hex(base[0]), hex(base[1]), 1 - t)), { shadow: false, lw: 0.6 }); }
  });
}
/** A rug: a field with a border. */
function rug(L, r, w, h) {
  return sprite(w, h, (g, W, H) => {
    const col = r.pick(L.cloth);
    finish(g, L, roundRect(g, 6, 6, W - 12, H - 12, 4), col, { shadow: false });
    g.strokeStyle = L.ink ? L.ink : shade(col, 1.4); g.lineWidth = 6; g.strokeRect(22, 22, W - 44, H - 44);
  });
}
/** A chest or wardrobe: a box with a lid line and a lock. */
function box(L, r, w, h) {
  return sprite(w, h, (g, W, H) => {
    finish(g, L, roundRect(g, 8, 8, W - 16, H - 16, 6), L.wood[0]);
    g.strokeStyle = L.ink ?? L.metal; g.lineWidth = 5; g.beginPath(); g.moveTo(8, H / 2); g.lineTo(W - 8, H / 2); g.stroke();
    g.fillStyle = L.ink ? "#d8c58a" : "#c9a648"; g.fillRect(W / 2 - 8, H / 2 - 8, 16, 16);
  });
}
/** A trough, quench tub or the like: a long box of water (or hay). */
function trough(L, r, w, h, fill) {
  return sprite(w, h, (g, W, H) => {
    finish(g, L, roundRect(g, 6, 6, W - 12, H - 12, 8), L.wood[0]);
    g.fillStyle = fill; g.beginPath(); g.roundRect(18, 18, W - 36, H - 36, 6); g.fill();
  });
}
/** A small light: candles, a lantern or a lamp. */
function light(L, r, w, h) {
  return sprite(w, h, (g, W, H) => {
    const R = Math.min(W, H) * 0.25, gr = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, R * 2);
    gr.addColorStop(0, "rgba(255,240,180,0.95)"); gr.addColorStop(0.35, "rgba(255,200,90,0.6)"); gr.addColorStop(1, "rgba(255,190,80,0)");
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    finish(g, L, circle(g, W / 2, H / 2, R * 0.5), "#fff4c8", { shadow: false, lw: 0.6 });
  });
}
/** A wagon or cart: a bed of boards between wheels. */
function wagon(L, r, w, h) {
  // (a wagon, 3 by 6: four wheels, a tongue, and half the time a canvas tilt over hoops; a cart, 2 by 3: two wheels and
  // a pair of shafts. Its bed has side rails, and an open bed now and then a load of sacks, barrels or hay)
  const big = h >= 5, cover = big && r() < 0.5, load = cover ? null : r.pick(["sacks", "barrels", "hay", null]);
  return sprite(w, h, (g, W, H) => {
    const bed = [W * 0.2, H * 0.08, W * 0.6, big ? H * 0.72 : H * 0.62];
    const wheel = (x, y) => { finish(g, L, roundRect(g, x - W * 0.045, y - H * (big ? 0.075 : 0.13), W * 0.09, H * (big ? 0.15 : 0.26), 3), L.woodDark, { shadow: true }); g.fillStyle = L.ink ?? "#2a2018"; g.fillRect(x - W * 0.012, y - H * (big ? 0.07 : 0.12), W * 0.024, H * (big ? 0.14 : 0.24)); };
    for (const y of big ? [H * 0.2, H * 0.62] : [H * 0.42]) for (const x of [bed[0] - W * 0.03, bed[0] + bed[2] + W * 0.03]) wheel(x, y);
    // (the tongue or the shafts, out of the front)
    g.strokeStyle = L.woodDark; g.lineCap = "round";
    if (big) { g.lineWidth = W * 0.06; g.beginPath(); g.moveTo(W / 2, bed[1] + bed[3]); g.lineTo(W / 2, H * 0.98); g.stroke(); g.lineWidth = W * 0.035; g.beginPath(); g.moveTo(W * 0.36, H * 0.93); g.lineTo(W * 0.64, H * 0.93); g.stroke(); }
    else for (const x of [W * 0.3, W * 0.7]) { g.lineWidth = W * 0.05; g.beginPath(); g.moveTo(x, bed[1] + bed[3] - H * 0.02); g.lineTo(x + (x < W / 2 ? W * 0.06 : -W * 0.06), H * 0.98); g.stroke(); }
    finish(g, L, roundRect(g, ...bed, 6), L.wood[0]);
    finish(g, L, roundRect(g, bed[0] + W * 0.05, bed[1] + H * 0.025, bed[2] - W * 0.1, bed[3] - H * 0.05, 4), L.wood[1], { shadow: false, lw: 0.6 });
    g.strokeStyle = L.ink ? rgb(hex(L.ink), 0.5) : rgb(hex(L.woodDark), 0.7); g.lineWidth = 1.5;
    for (let y = bed[1] + H * 0.05; y < bed[1] + bed[3] - H * 0.03; y += H * 0.06) { g.beginPath(); g.moveTo(bed[0] + W * 0.06, y); g.lineTo(bed[0] + bed[2] - W * 0.06, y); g.stroke(); }
    if (cover) {
      const col = L.ink ? "#efe6cf" : "#d8ccac";
      finish(g, L, roundRect(g, bed[0] - W * 0.02, bed[1] + H * 0.04, bed[2] + W * 0.04, bed[3] * 0.82, 18), col);
      g.strokeStyle = L.ink ? rgb(hex(L.ink), 0.45) : "rgba(120,104,76,0.55)"; g.lineWidth = 3;
      for (let k = 1; k < 5; k++) { const y = bed[1] + H * 0.04 + (bed[3] * 0.82 * k) / 5; g.beginPath(); g.moveTo(bed[0] - W * 0.02, y); g.lineTo(bed[0] + bed[2] + W * 0.02, y); g.stroke(); }
    } else if (load === "sacks") {
      for (let k = 0; k < (big ? 6 : 3); k++) { const x = bed[0] + W * 0.1 + (k % 2) * bed[2] * 0.42, y = bed[1] + H * 0.06 + Math.floor(k / 2) * H * (big ? 0.18 : 0.2); finish(g, L, roundRect(g, x, y, bed[2] * 0.36, H * (big ? 0.15 : 0.17), 14), L.ink ? "#e4d6b4" : "#b9a37a", { lw: 0.6 }); }
    } else if (load === "barrels") {
      for (let k = 0; k < (big ? 6 : 2); k++) { const x = bed[0] + bed[2] * (k % 2 ? 0.72 : 0.28), y = bed[1] + H * 0.1 + Math.floor(k / 2) * H * (big ? 0.2 : 0.26); finish(g, L, circle(g, x, y, Math.min(bed[2] * 0.2, H * 0.08)), L.wood[0], { lw: 0.6 }); }
    } else if (load === "hay") {
      finish(g, L, roundRect(g, bed[0] + W * 0.04, bed[1] + H * 0.03, bed[2] - W * 0.08, bed[3] - H * 0.06, 16), L.roof.thatch[1], { lw: 0.6 });
    }
  });
}
/** A well: a ring of stones round dark water. */
function well(L, r) {
  return sprite(2, 2, (g, w) => {
    finish(g, L, circle(g, w / 2, w / 2, w * 0.4), L.stone[0]);
    g.strokeStyle = L.ink ?? L.mortar; g.lineWidth = 2; for (let k = 0; k < 14; k++) { const a = (k / 14) * 2 * Math.PI; g.beginPath(); g.moveTo(w / 2 + Math.cos(a) * w * 0.27, w / 2 + Math.sin(a) * w * 0.27); g.lineTo(w / 2 + Math.cos(a) * w * 0.4, w / 2 + Math.sin(a) * w * 0.4); g.stroke(); }
    g.fillStyle = L.ink ? "#5d7f8c" : "#14262e"; g.beginPath(); g.arc(w / 2, w / 2, w * 0.27, 0, 7); g.fill();
    if (L.ink) { g.strokeStyle = L.ink; g.lineWidth = L.inkW; g.stroke(); }
  });
}
/** Hay: a bale of straw. */
function hay(L, r, w, h) {
  return sprite(w, h, (g, W, H) => {
    finish(g, L, roundRect(g, 8, 8, W - 16, H - 16, 10), L.roof.thatch[1]);
    g.strokeStyle = L.ink ? rgb(hex(L.ink), 0.4) : rgb(hex(L.roof.thatch[0]), 0.9); g.lineWidth = 1.2; for (let i = 0; i < 80; i++) { const x = r.range(12, W - 12), y = r.range(12, H - 12); g.beginPath(); g.moveTo(x, y); g.lineTo(x + r.range(6, 14), y + r.range(-2, 2)); g.stroke(); }
  });
}
/** An anvil, or a rack of weapons. */
function metalThing(L, r, kind, w, h) {
  return sprite(w, h, (g, W, H) => {
    if (kind === "anvil") { finish(g, L, () => { g.beginPath(); g.moveTo(W * 0.15, H * 0.35); g.lineTo(W * 0.75, H * 0.35); g.quadraticCurveTo(W * 0.95, H * 0.5, W * 0.75, H * 0.65); g.lineTo(W * 0.15, H * 0.65); g.closePath(); }, L.metal); return; }
    finish(g, L, roundRect(g, 6, H * 0.35, W - 12, H * 0.3, 4), L.wood[0]);
    for (let x = 20; x < W - 10; x += 26) finish(g, L, roundRect(g, x, H * 0.12, 6, H * 0.76, 2), L.metal, { shadow: false, lw: 0.5 });
  });
}
/** A chimney's top: a stone stack with a dark flue. */
function chimney(L) {
  return sprite(1, 1, (g, w) => { finish(g, L, roundRect(g, 20, 20, w - 40, w - 40, 6), L.stone[0]); g.fillStyle = "#1c1a18"; g.fillRect(w / 2 - 25, w / 2 - 25, 50, 50); });
}
/** Mist: a soft pale cloud. */
function fog() {
  const c = cv(T, T), g = c.getContext("2d"), gr = g.createRadialGradient(T / 2, T / 2, 0, T / 2, T / 2, T / 2);
  gr.addColorStop(0, "rgba(235,240,242,0.8)"); gr.addColorStop(1, "rgba(235,240,242,0)"); g.fillStyle = gr; g.fillRect(0, 0, T, T);
  return c;
}

// ---------------------------------------------------------------------------------------------------------------------

/** Cloth or canvas in one of the look's colors (by variant), or a plain canvas. */
const clothOf = (L, r) => r.pick([...L.cloth, L.ink ? "#e9e0c8" : "#cdbf9c"]);
/** A tent from above: two pitched halves of canvas, a ridge down the middle (3 by 3). */
function tent(L, r) {
  return sprite(3, 3, (g, w) => {
    const col = clothOf(L, r), m = w * 0.18;
    finish(g, L, roundRect(g, m, m, w - 2 * m, w - 2 * m, 6), col);
    g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(m, m, (w - 2 * m) / 2, w - 2 * m);
    g.strokeStyle = L.ink ?? shade(col, 0.6); g.lineWidth = 4; g.beginPath(); g.moveTo(w / 2, m); g.lineTo(w / 2, w - m); g.stroke();
  });
}
/** A bedroll: cloth rolled out, a pillow end at the top (1 by 2). */
function bedroll(L, r) {
  return sprite(1, 2, (g, w, h) => { const col = clothOf(L, r); finish(g, L, roundRect(g, w * 0.22, h * 0.1, w * 0.56, h * 0.8, 12), col); finish(g, L, roundRect(g, w * 0.26, h * 0.12, w * 0.48, h * 0.14, 10), shade(col, 1.3), { shadow: false, lw: 0.6 }); });
}
/** A fountain: a round basin of water, a statue in the middle (2 by 2). */
function fountain(L, r) {
  return sprite(2, 2, (g, w) => {
    finish(g, L, circle(g, w / 2, w / 2, w * 0.45), L.stone[0]);
    g.fillStyle = L.ink ? "#b4d3db" : "#3e7f98"; g.beginPath(); g.arc(w / 2, w / 2, w * 0.36, 0, 7); g.fill();
    finish(g, L, circle(g, w / 2, w / 2, w * 0.12), L.stone[1]);
  });
}
/** A statue: a figure on a plinth, from above (1 by 1). */
function statue(L, r) {
  return sprite(1, 1, (g, w) => { finish(g, L, roundRect(g, w * 0.15, w * 0.15, w * 0.7, w * 0.7, 4), L.stone[0]); finish(g, L, circle(g, w / 2, w / 2, w * 0.2), L.stone[1], { shadow: false }); });
}
/** A market stall: an awning in stripes (2 by 2, or 2 by 3 long). */
function stall(L, r, h) {
  return sprite(2, h, (g, W, H) => {
    const a = clothOf(L, r), b = L.ink ? "#f3ecd9" : "#e0d6bd";
    g.save(); roundRect(g, W * 0.06, H * 0.06, W * 0.88, H * 0.88, 6)(); g.clip();
    for (let x = 0, k = 0; x < W; x += W / 8, k++) { g.fillStyle = k % 2 ? a : b; g.fillRect(x, 0, W / 8, H); }
    g.restore();
    if (!L.ink) { g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(W * 0.06, H * 0.84, W * 0.88, H * 0.1); }
    else { g.strokeStyle = L.ink; g.lineWidth = L.inkW; g.strokeRect(W * 0.06, H * 0.06, W * 0.88, H * 0.88); }
  });
}
/** A windmill's sails: two lattice blades on a bar (10 by 2). */
function sails(L, r) {
  return sprite(10, 2, (g, w, h) => {
    g.fillStyle = L.ink ?? L.woodDark; g.fillRect(w * 0.02, h * 0.46, w * 0.96, h * 0.08);
    for (const side of [0, 1]) {
      const x0 = side ? w * 0.56 : w * 0.06, bw = w * 0.38;
      g.fillStyle = L.ink ? "#efe7d2" : "#d9d0b8"; g.fillRect(x0, h * 0.2, bw, h * 0.26);
      g.strokeStyle = L.ink ?? L.woodDark; g.lineWidth = 3; g.strokeRect(x0, h * 0.2, bw, h * 0.26);
      for (let x = x0; x < x0 + bw; x += bw / 8) { g.beginPath(); g.moveTo(x, h * 0.2); g.lineTo(x, h * 0.46); g.stroke(); }
    }
    finish(g, L, circle(g, w / 2, h / 2, h * 0.12), L.woodDark, { shadow: false });
  });
}
/** A waterwheel seen edge on: a long frame of paddles (1 by 6). */
function waterwheel(L, r) {
  return sprite(1, 6, (g, w, h) => { finish(g, L, roundRect(g, w * 0.2, h * 0.05, w * 0.6, h * 0.9, 6), L.wood[0]); g.strokeStyle = L.ink ?? L.woodDark; g.lineWidth = 4; for (let y = h * 0.08; y < h * 0.95; y += h * 0.05) { g.beginPath(); g.moveTo(w * 0.2, y); g.lineTo(w * 0.8, y); g.stroke(); } });
}
/** A boat: a rowboat's hull, its bow at the top, thwarts across (1 by 4); a ship's hull and deck (4 by 11). */
function boat(L, r, ship) {
  const [W, H] = ship ? [4, 11] : [1, 4];
  return sprite(W, H, (g, w, h) => {
    const hull = () => { g.beginPath(); g.moveTo(w / 2, h * 0.03); g.bezierCurveTo(w * 0.95, h * 0.2, w * 0.92, h * 0.8, w * 0.8, h * 0.97); g.lineTo(w * 0.2, h * 0.97); g.bezierCurveTo(w * 0.08, h * 0.8, w * 0.05, h * 0.2, w / 2, h * 0.03); g.closePath(); };
    finish(g, L, hull, L.wood[0]);
    g.save(); hull(); g.clip(); g.fillStyle = L.wood[1]; g.beginPath(); g.ellipse(w / 2, h * 0.52, w * 0.36, h * 0.44, 0, 0, 7); g.fill();
    g.strokeStyle = L.ink ? rgb(hex(L.ink), 0.5) : rgb(hex(L.wood[0]), 0.8); g.lineWidth = 2;
    if (ship) { for (let x = w * 0.2; x < w * 0.8; x += w * 0.08) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } for (const y of [0.3, 0.55]) finish(g, L, circle(g, w / 2, h * y, w * 0.07), L.woodDark, { shadow: false }); }
    else for (const y of [0.35, 0.6, 0.8]) { g.fillStyle = L.ink ?? L.woodDark; g.fillRect(w * 0.15, h * y, w * 0.7, h * 0.04); }
    g.restore();
  });
}
/** A boat's sail, bellied across (5 by 2). */
function sail(L, r) {
  return sprite(5, 2, (g, w, h) => finish(g, L, () => { g.beginPath(); g.moveTo(w * 0.05, h * 0.45); g.quadraticCurveTo(w / 2, h * 0.05, w * 0.95, h * 0.45); g.lineTo(w * 0.95, h * 0.55); g.quadraticCurveTo(w / 2, h * 0.35, w * 0.05, h * 0.55); g.closePath(); }, L.ink ? "#f3ecd9" : "#e3dac2"));
}
/** A market cross, standing stone or obelisk: a square shaft lit on its southeast faces (2 by 2). */
function obelisk(L, r) {
  return sprite(2, 2, (g, w) => {
    const c = w / 2, R = w * 0.22;
    finish(g, L, roundRect(g, c - R * 1.4, c - R * 1.4, R * 2.8, R * 2.8, 6), L.stone[0]);
    const tri = (a, b, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(c, c); g.lineTo(...a); g.lineTo(...b); g.closePath(); g.fill(); if (L.ink) { g.strokeStyle = L.ink; g.lineWidth = 1.5; g.stroke(); } };
    const [x0, y0, x1, y1] = [c - R, c - R, c + R, c + R];
    tri([x0, y0], [x1, y0], shade(L.stone[0], 0.75)); tri([x0, y0], [x0, y1], shade(L.stone[0], 0.85)); tri([x1, y0], [x1, y1], L.stone[1]); tri([x0, y1], [x1, y1], shade(L.stone[1], 1.08));
  });
}
/** A maypole from above: its pole, ribbons in the look's colors out to a ring (3 by 3). */
function maypole(L, r) {
  return sprite(3, 3, (g, w) => {
    const c = w / 2, R = w * 0.44;
    g.strokeStyle = L.ink ? rgb(hex(L.ink), 0.4) : "rgba(90,76,52,0.45)"; g.lineWidth = 3; g.beginPath(); g.arc(c, c, R, 0, 7); g.stroke();
    const cols = [...L.cloth, L.ink ? "#f3ecd9" : "#e9e2cc"];
    for (let k = 0; k < 12; k++) { const a = (k / 12) * 2 * Math.PI; g.strokeStyle = cols[k % cols.length]; g.lineWidth = 5; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a) * R, c + Math.sin(a) * R); g.stroke(); }
    finish(g, L, circle(g, c, c, w * 0.06), L.wood[1]);
  });
}
/** A sundial: a stone pillar's square top, a brass dial and its gnomon (1 by 1). */
function sundial(L, r) {
  return sprite(1, 1, (g, w) => {
    finish(g, L, roundRect(g, w * 0.18, w * 0.18, w * 0.64, w * 0.64, 4), L.stone[0]);
    finish(g, L, circle(g, w / 2, w / 2, w * 0.24), L.ink ? "#e2c98a" : "#b8975a", { shadow: false });
    g.strokeStyle = L.ink ?? "#3a3128"; g.lineWidth = 3; g.beginPath(); g.moveTo(w / 2, w / 2); g.lineTo(w / 2, w * 0.28); g.stroke();
  });
}
/** A dockside crane: a wooden frame with its arm (2 by 4). */
function crane(L, r) {
  return sprite(2, 4, (g, w, h) => { finish(g, L, roundRect(g, w * 0.15, h * 0.6, w * 0.7, h * 0.32, 6), L.wood[0]); finish(g, L, roundRect(g, w * 0.42, h * 0.06, w * 0.16, h * 0.7, 4), L.wood[1]); g.strokeStyle = L.ink ?? "#2b2b2b"; g.lineWidth = 2; g.beginPath(); g.moveTo(w / 2, h * 0.08); g.lineTo(w / 2, h * 0.02); g.stroke(); });
}
/** A grave's stone curb, the painter adds its earth and headstone (2 by 3). */
function grave(L, r) {
  return sprite(2, 3, (g, w, h) => { g.strokeStyle = L.stone[0]; g.lineWidth = w * 0.06; g.strokeRect(w * 0.2, h * 0.13, w * 0.6, h * 0.74); if (L.ink) { g.strokeStyle = L.ink; g.lineWidth = 1.5; g.strokeRect(w * 0.17, h * 0.1, w * 0.66, h * 0.8); g.strokeRect(w * 0.23, h * 0.16, w * 0.54, h * 0.68); } });
}
/** A topiary: a neatly clipped round bush (2 by 2). */
function topiary(L, r, season) {
  const [d, l] = L.leaf[season === "autumn" ? "summer" : season] ?? L.leaf.summer;
  return sprite(2, 2, (g, w) => {
    finish(g, L, circle(g, w / 2, w / 2, w * 0.36), d);
    if (!L.ink) { const gr = g.createRadialGradient(w * 0.6, w * 0.6, 0, w / 2, w / 2, w * 0.36); gr.addColorStop(0, l); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.beginPath(); g.arc(w / 2, w / 2, w * 0.36, 0, 7); g.fill(); }
    else { g.fillStyle = l; g.beginPath(); g.arc(w * 0.56, w * 0.56, w * 0.18, 0, 7); g.fill(); }
  });
}
/** Firewood: a pile of cut logs, their ends showing (3 by 1). */
function firewood(L, r) {
  return sprite(3, 1, (g, w, h) => { for (let x = w * 0.1; x < w * 0.9; x += h * 0.22) for (let y = h * 0.3; y < h * 0.75; y += h * 0.22) finish(g, L, circle(g, x + r.range(-3, 3), y, h * 0.12), r() < 0.5 ? L.wood[0] : L.wood[1], { lw: 0.6 }); });
}
/** A stack of planks (1 by 1). */
function plankStack(L, r) {
  return sprite(1, 1, (g, w) => { for (let k = 0; k < 4; k++) finish(g, L, roundRect(g, w * 0.12, w * (0.2 + k * 0.15), w * 0.76, w * 0.13, 2), rgb(mix(hex(L.wood[0]), hex(L.wood[1]), r())), { lw: 0.6, shadow: k === 0 }); });
}
/** Sacks: two bulging cloth sacks (1 by 1). */
function sacks(L, r) {
  return sprite(1, 1, (g, w) => { const col = L.ink ? "#d8c49c" : "#a68b5f"; for (const [x, y] of [[0.38, 0.42], [0.62, 0.58]]) finish(g, L, () => { g.beginPath(); g.ellipse(w * x, w * y, w * 0.2, w * 0.24, 0.3, 0, 7); }, col, { lw: 0.7 }); });
}
/** A tanning rack: a frame with a hide stretched in it (1 by 1). */
function rack(L, r) {
  return sprite(1, 1, (g, w) => { finish(g, L, roundRect(g, w * 0.12, w * 0.12, w * 0.76, w * 0.76, 2), L.woodDark); g.fillStyle = L.ink ? "#d9bd92" : "#b08a5a"; g.beginPath(); g.ellipse(w / 2, w / 2, w * 0.28, w * 0.3, 0, 0, 7); g.fill(); });
}
/** Clay pots or amphorae: round mouths seen from above (1 by 1). */
function pots(L, r) {
  return sprite(1, 1, (g, w) => { const col = L.ink ? "#d39c78" : "#a65f3c"; for (const [x, y, s] of [[0.35, 0.38, 0.2], [0.65, 0.42, 0.16], [0.48, 0.68, 0.18]]) { finish(g, L, circle(g, w * x, w * y, w * s), col, { lw: 0.7 }); g.fillStyle = "#2a1a12"; g.beginPath(); g.arc(w * x, w * y, w * s * 0.35, 0, 7); g.fill(); } });
}
/** Cannonballs: a pile of dark iron balls (1 by 1). */
function cannonballs(L, r) {
  return sprite(1, 1, (g, w) => { for (const [x, y] of [[0.38, 0.4], [0.62, 0.4], [0.5, 0.6], [0.34, 0.64], [0.66, 0.64], [0.5, 0.48]]) finish(g, L, circle(g, w * x, w * y, w * 0.11), L.ink ? "#6f7176" : "#2c2d30", { lw: 0.5 }); });
}
/** A cog: a toothed wheel of metal (2 by 2). */
function cog(L, r) {
  return sprite(2, 2, (g, w) => {
    const c = w / 2, n = 12;
    finish(g, L, () => { g.beginPath(); for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * 2 * Math.PI, rr = i % 2 ? w * 0.3 : w * 0.36; g.lineTo(c + Math.cos(a) * rr, c + Math.sin(a) * rr); } g.closePath(); }, L.ink ? "#c9a95e" : "#9a7a35");
    g.fillStyle = "rgba(0,0,0,0.6)"; g.beginPath(); g.arc(c, c, w * 0.08, 0, 7); g.fill();
  });
}
/** A cauldron: a black pot with something in it (1 by 1). */
function cauldron(L, r) {
  return sprite(1, 1, (g, w) => { finish(g, L, circle(g, w / 2, w / 2, w * 0.36), L.ink ? "#6f7176" : "#232427"); g.fillStyle = L.ink ? "#a9b97d" : "#5d6b33"; g.beginPath(); g.arc(w / 2, w / 2, w * 0.27, 0, 7); g.fill(); });
}
/** A cairn: a heap of stones (1 by 2). */
function cairn(L, r, [cw, ch] = [1, 2]) {
  return sprite(cw, ch, (g, w, h) => { for (let i = 0; i < 9; i++) { const x = w * r.range(0.3, 0.7), y = h * r.range(0.25, 0.75), s = Math.min(w, h) * r.range(0.1, 0.17); finish(g, L, circle(g, x, y, s), rgb(mix(hex(L.rock[0]), hex(L.rock[1]), r())), { lw: 0.6 }); } });
}
/** A sledge: two runners under a bed of slats (3 by 1). */
function sledge(L, r) {
  return sprite(3, 1, (g, w, h) => { g.fillStyle = L.ink ?? L.woodDark; g.fillRect(w * 0.06, h * 0.22, w * 0.88, h * 0.06); g.fillRect(w * 0.06, h * 0.72, w * 0.88, h * 0.06); finish(g, L, roundRect(g, w * 0.14, h * 0.25, w * 0.72, h * 0.5, 4), L.wood[1]); });
}
/** A ribbon: a strip of red cloth knotted on, its two tails trailing (1 by 1), bold enough to read as a clue. */
function ribbon(L, r) {
  return sprite(1, 1, (g, w) => {
    const red = L.ink ? "#c4302b" : "#b3121f", dark = "#5a0a10";
    g.lineCap = "round";
    for (const [x1, y1, x2, y2, bend] of [[0.42, 0.36, 0.3, 0.86, -0.12], [0.5, 0.36, 0.66, 0.84, 0.14]]) {
      g.strokeStyle = dark; g.lineWidth = w * 0.16; g.beginPath(); g.moveTo(w * x1, w * y1); g.quadraticCurveTo(w * (x1 + bend), w * 0.62, w * x2, w * y2); g.stroke();
      g.strokeStyle = red; g.lineWidth = w * 0.12; g.beginPath(); g.moveTo(w * x1, w * y1); g.quadraticCurveTo(w * (x1 + bend), w * 0.62, w * x2, w * y2); g.stroke();
    }
    // (the knot)
    g.fillStyle = red; g.strokeStyle = dark; g.lineWidth = w * 0.025; g.beginPath(); g.ellipse(w * 0.46, w * 0.33, w * 0.1, w * 0.07, r() * 0.6, 0, 7); g.fill(); g.stroke();
  });
}
/** Cattails: a clump of reeds with brown heads (1 by 1). */
function reeds(L, r, season) {
  const [d, l] = L.leaf[season] ?? L.leaf.summer;
  return sprite(1, 1, (g, w) => { for (let i = 0; i < 9; i++) { const a = r() * 2 * Math.PI, len = w * r.range(0.2, 0.42); g.strokeStyle = rgb(mix(hex(d), hex(l), r())); g.lineWidth = 3; g.beginPath(); g.moveTo(w / 2, w / 2); g.lineTo(w / 2 + Math.cos(a) * len, w / 2 + Math.sin(a) * len); g.stroke(); if (r() < 0.5) { g.fillStyle = L.ink ? "#8a6a48" : "#5a3a1e"; g.beginPath(); g.ellipse(w / 2 + Math.cos(a) * len, w / 2 + Math.sin(a) * len, 4, 9, a, 0, 7); g.fill(); } } });
}
/** Lily pads on the water (1 by 1). */
function lily(L, r) {
  return sprite(1, 1, (g, w) => { for (const [x, y, s] of [[0.4, 0.42, 0.18], [0.64, 0.6, 0.13]]) { const a = r() * 6; finish(g, L, () => { g.beginPath(); g.moveTo(w * x, w * y); g.arc(w * x, w * y, w * s, a, a + 5.8); g.closePath(); }, L.ink ? "#9cbf7a" : "#4f7f34", { shadow: false, lw: 0.6 }); } });
}
/** Ice: a floe of snow-covered ice, a chunk of cracked blue ice, or foam drifting. */
function ice(L, r, kind) {
  if (kind === "foam") return sprite(2, 1, (g, w, h) => { for (let i = 0; i < 40; i++) { g.fillStyle = "rgba(245,250,252,0.7)"; g.beginPath(); g.arc(w * r.range(0.1, 0.9), h * r.range(0.35, 0.65), r.range(3, 9), 0, 7); g.fill(); } });
  return sprite(1, 1, (g, w) => {
    const pts = []; for (let i = 0; i < 7; i++) { const a = (i / 7) * 2 * Math.PI; pts.push([w / 2 + Math.cos(a) * w * r.range(0.22, 0.38), w / 2 + Math.sin(a) * w * r.range(0.22, 0.38)]); }
    finish(g, L, () => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); }, kind === "floe" ? "#f2f6f8" : "#bcdbe6", { lw: 0.6 });
  });
}
/**
 * A horse, mule or ox seen from above, standing, its head to the south (at rot 0, as a wagon's shafts): its body, neck
 * and head, ears, mane or horns, and tail, in a coat picked from its variant (1 by 2; an ox's broader).
 */
function animal(L, r, kind) {
  const COATS = { horse: ["#6b4226", "#8a5a2b", "#2e2420", "#9a9a94", "#c9b38a"], mule: ["#6e5a48", "#4f4238", "#857262"], ox: ["#a07850", "#d8c8a8", "#5a3e2a", "#3a2e26"] };
  const coat = COATS[kind][Math.floor(r() * COATS[kind].length)], dark = rgb(mix(hex(coat), [0, 0, 0], 0.45)), light = rgb(mix(hex(coat), [255, 255, 255], 0.18));
  const broad = kind === "ox" ? 1.18 : kind === "mule" ? 0.9 : 1;
  return sprite(1, 2, (g, w, h) => {
    const cx = w / 2, bw = w * 0.3 * broad, bodyTop = h * 0.2, bodyBot = h * 0.66;
    // (the tail, behind)
    g.strokeStyle = kind === "horse" ? dark : coat; g.lineWidth = w * (kind === "horse" ? 0.08 : 0.04); g.lineCap = "round";
    g.beginPath(); g.moveTo(cx, bodyTop + h * 0.02); g.quadraticCurveTo(cx + w * 0.06 * (r() - 0.5), bodyTop - h * 0.06, cx + w * 0.05 * (r() - 0.5), bodyTop - h * 0.12); g.stroke();
    if (kind !== "horse") { g.fillStyle = dark; g.beginPath(); g.arc(cx, bodyTop - h * 0.12, w * 0.04, 0, 7); g.fill(); }
    // (the body: a barrel between the haunches and the shoulders)
    finish(g, L, () => { g.beginPath(); g.ellipse(cx, (bodyTop + bodyBot) / 2, bw, (bodyBot - bodyTop) / 2, 0, 0, 7); }, coat);
    g.fillStyle = light; g.globalAlpha = 0.35; g.beginPath(); g.ellipse(cx - bw * 0.25, (bodyTop + bodyBot) / 2, bw * 0.4, (bodyBot - bodyTop) / 2.6, 0, 0, 7); g.fill(); g.globalAlpha = 1;
    // (the neck and head, reaching south)
    const nw = w * (kind === "ox" ? 0.2 : 0.14), headY = h * (kind === "ox" ? 0.8 : 0.86);
    finish(g, L, () => { g.beginPath(); g.moveTo(cx - nw, bodyBot - h * 0.04); g.lineTo(cx + nw, bodyBot - h * 0.04); g.lineTo(cx + nw * 0.8, headY - h * 0.04); g.lineTo(cx - nw * 0.8, headY - h * 0.04); g.closePath(); }, coat, { shadow: false });
    finish(g, L, () => { g.beginPath(); g.ellipse(cx, headY, w * (kind === "ox" ? 0.15 : 0.1), h * (kind === "ox" ? 0.07 : 0.085), 0, 0, 7); }, coat);
    g.fillStyle = dark; g.beginPath(); g.ellipse(cx, headY + h * (kind === "ox" ? 0.05 : 0.065), w * 0.07, h * 0.025, 0, 0, 7); g.fill();
    // (a horse's mane down its neck; a mule's long ears; an ox's horns)
    if (kind === "horse") { g.strokeStyle = dark; g.lineWidth = w * 0.05; g.beginPath(); g.moveTo(cx, bodyBot - h * 0.05); g.lineTo(cx, headY - h * 0.05); g.stroke(); }
    const ear = kind === "mule" ? 0.09 : 0.045;
    g.fillStyle = dark;
    for (const sd of [-1, 1]) { g.beginPath(); g.ellipse(cx + sd * w * 0.08, headY - h * 0.07, w * 0.025, h * ear / 2, sd * 0.5, 0, 7); g.fill(); }
    if (kind === "ox") { g.strokeStyle = "#e8e0cc"; g.lineWidth = w * 0.04; for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(cx + sd * w * 0.1, headY - h * 0.04); g.quadraticCurveTo(cx + sd * w * 0.26, headY - h * 0.05, cx + sd * w * 0.24, headY - h * 0.1); g.stroke(); } }
  });
}
/** A picket line's rope: a twisted strand along the strip (a path's band). */
function rope(L, r) {
  const c = cv(T, PX), g = c.getContext("2d"), y = PX / 2;
  g.strokeStyle = L.ink ? "#7a5a36" : "#8a6a42"; g.lineWidth = 9; g.beginPath(); g.moveTo(0, y); g.lineTo(T, y); g.stroke();
  g.strokeStyle = "rgba(40,28,16,0.6)"; g.lineWidth = 2;
  for (let x = 0; x < T; x += 8) { g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 6, y + 4); g.stroke(); }
  return c;
}
/** Footprints in snow: two rows of prints going up (1 by 1). */
function tracks(L, r) {
  return sprite(1, 1, (g, w) => { g.fillStyle = "rgba(120,140,160,0.45)"; for (let k = 0; k < 4; k++) { const y = w * (0.85 - k * 0.22), x = w * (k % 2 ? 0.6 : 0.4); g.beginPath(); g.ellipse(x, y, w * 0.05, w * 0.08, 0, 0, 7); g.fill(); } });
}
/** Smoke: soft gray puffs rising along the image (1 by 2). */
function smoke(L, r, tone) {
  const col = { light: [230, 230, 228], gray: [160, 160, 160], dark: [80, 78, 76] }[tone] ?? [160, 160, 160];
  return sprite(1, 2, (g, w, h) => { for (let i = 0; i < 9; i++) { const y = h * (0.9 - i * 0.09), R = w * (0.12 + i * 0.03), gr = g.createRadialGradient(w / 2, y, 0, w / 2, y, R); gr.addColorStop(0, rgb(col, 0.55 - i * 0.04)); gr.addColorStop(1, rgb(col, 0)); g.fillStyle = gr; g.fillRect(0, 0, w, h); } });
}
/** Frost: a pale patch fading out at its edge (1 by 1), or an ice sheen to lay over water (a texture). */
function frost(L, r, sheen) {
  if (sheen) { const c = cv(T, T), g = c.getContext("2d"); mottle(g, T, r, "#bfd9e3", "#eaf4f8", { cells: 3, contrast: 0.6 }); g.globalCompositeOperation = "destination-in"; g.fillStyle = "rgba(0,0,0,0.6)"; g.fillRect(0, 0, T, T); return c; }
  return sprite(1, 1, (g, w) => { for (let i = 0; i < 160; i++) { const a = r() * 2 * Math.PI, rr = Math.sqrt(r()) * w * 0.45; g.fillStyle = `rgba(240,246,250,${0.5 - rr / w})`; g.beginPath(); g.arc(w / 2 + Math.cos(a) * rr, w / 2 + Math.sin(a) * rr, r.range(2, 6), 0, 7); g.fill(); } });
}
/** A winter strip: drifted snow, a thin dusting, a cap on a wall, a trodden trail, disturbed snow, wheel ruts, or cracked ice. */
function winterStrip(L, r, kind) {
  const c = cv(T, PX), g = c.getContext("2d");
  if (kind === "wheel") { g.strokeStyle = "rgba(110,120,130,0.6)"; g.lineWidth = 12; for (const y of [70, 130]) { g.beginPath(); g.moveTo(0, y); g.lineTo(T, y); g.stroke(); } return c; }
  if (kind === "cracked") { g.fillStyle = "#cfe5ec"; g.fillRect(0, 60, T, 80); g.strokeStyle = "rgba(90,130,150,0.6)"; g.lineWidth = 1.5; for (let i = 0; i < 20; i++) { let x = r.range(60, T - 60), y = 60 + r() * 80; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += r.range(-15, 15); y += r.range(-10, 10); g.lineTo(x, Math.max(60, Math.min(140, y))); } g.stroke(); } return c; }
  const h = { drift: 90, thin: 70, cap: 40, trail: 50, disturbed: 80 }[kind] ?? 60, y0 = (PX - h) / 2;
  const gr = g.createLinearGradient(0, y0 - 10, 0, y0 + h + 10);
  gr.addColorStop(0, "rgba(246,250,252,0)"); gr.addColorStop(0.2, "rgba(246,250,252,0.95)"); gr.addColorStop(0.8, "rgba(236,242,246,0.95)"); gr.addColorStop(1, "rgba(236,242,246,0)");
  g.fillStyle = gr; g.fillRect(0, y0 - 10, T, h + 20);
  if (kind === "trail" || kind === "disturbed") { g.fillStyle = "rgba(150,165,180,0.3)"; for (let i = 0; i < 40; i++) { g.beginPath(); g.ellipse(r.range(10, T - 10), PX / 2 + r.range(-h / 3, h / 3), r.range(4, 9), r.range(3, 6), 0, 0, 7); g.fill(); } }
  return c;
}
/** A field's crop: rows of green shoots, ripe gold, or hay in windrows. */
function crop(L, r, kind, season) {
  const c = cv(T, T), g = c.getContext("2d");
  const base = kind === "hay" ? L.roof.thatch : L.dirt;
  mottle(g, T, r, base[0], base[1], { cells: 6, contrast: 0.4 });
  const [d, l] = kind === "ripe" ? ["#b8922e", "#e2c25a"] : kind === "hay" ? L.roof.thatch : L.leaf[season] ?? L.leaf.summer;
  for (let y = 10; y < T; y += 25) {
    g.strokeStyle = rgb(mix(hex(d), hex(l), 0.5), kind === "hay" ? 0.9 : 0.95); g.lineWidth = kind === "hay" ? 12 : 9; g.lineCap = "round";
    g.beginPath(); g.moveTo(0, y); g.lineTo(T, y); g.stroke();
    for (let x = 3; x < T; x += 6) { g.fillStyle = rgb(mix(hex(d), hex(l), r()), 0.9); g.beginPath(); g.arc(x, y + r.range(-4, 4), r.range(2, 3), 0, 7); g.fill(); }
    if (L.ink) { g.strokeStyle = rgb(hex(L.ink), 0.35); g.lineWidth = 1; g.beginPath(); g.moveTo(0, y + 7); g.lineTo(T, y + 7); g.stroke(); }
  }
  return c;
}
/** A path's half shadow: a soft dark band (as FA's 40% shadow path). */
function halfShadow() {
  const c = cv(T, PX), g = c.getContext("2d"), gr = g.createLinearGradient(0, 40, 0, 160);
  gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(0.5, "rgba(0,0,0,0.4)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(0, 40, T, 120);
  return c;
}

/** Pieces drawn along their length: turned to run down a body that's taller than it's wide (a rack on a side wall). */
const LONG = new Set(["anvil", "bench", "pew", "bar", "bar.long", "shelf", "shelf.goods", "trough", "quench", "weapon.rack", "wardrobe", "desk", "altar", "table.work", "chest"]);
/**
 * A piece of furniture, drawn into its body (FURNITURE: the size its art is laid at, the drawn part's size, and the
 * side it stands back against), so it's placed as Forgotten Adventures' art would be.
 */
function furniture(L, r, f, stone) {
  const F = FURNITURE[f];
  if (!F || F.drawn) return null;
  const [aw, ah] = F.size, [bw, bh] = F.body, back = F.back ?? "top";
  const turn = LONG.has(f) && bh > bw, [w, h] = turn ? [bh, bw] : [bw, bh];
  const inner = (() => {
    if (/^(hearth|oven|forge|campfire|firepit|brazier)/.test(f)) return fire(L, r, f, w, h);
    if (f.startsWith("bed")) return bed(L, r, w, h);
    if (f === "table.round") return table(L, r, "round", w, h);
    if (f === "table.square" || f === "table.long") return table(L, r, "square", w, h);
    if (f === "table.work" || f === "desk" || f === "altar") return table(L, r, "work", w, h);
    if (f === "chair" || f === "stool" || f === "bench" || f === "pew") return seat(L, r, f === "pew" ? "bench" : f, w, h);
    if (f.startsWith("bar")) return counter(L, r, "bar", w, h);
    if (f.startsWith("shelf")) return counter(L, r, f === "shelf.goods" ? "goods" : "shelf", w, h);
    if (f === "wardrobe" || f === "chest") return box(L, r, w, h);
    if (f === "crate") return crate(L, r);
    if (f === "barrel") return barrel(L, r);
    if (f === "rug") return rug(L, r, w, h);
    if (f === "anvil") return metalThing(L, r, "anvil", w, h);
    if (f === "weapon.rack" || f === "armor.stand") return metalThing(L, r, f === "weapon.rack" ? "weapon" : "armor", w, h);
    if (f === "trough" || f === "quench") return trough(L, r, w, h, L.ink ? "#b3ccd1" : "#3b5a66");
    if (f === "hay") return hay(L, r, w, h);
    if (f === "stairs") return stairs(L, r, stone, w, h);
    if (/^(candles|lamp|lantern|torch)/.test(f)) return light(L, r, w, h);
    return null;
  })();
  if (!inner) return null;
  const c = cv(aw * PX, ah * PX), g = c.getContext("2d");
  const cx = (back === "left" ? bw / 2 : aw / 2) * PX, cy = (back === "top" ? bh / 2 : ah / 2) * PX;
  g.translate(cx, cy); if (turn) g.rotate(Math.PI / 2);
  g.drawImage(inner, (-w / 2) * PX, (-h / 2) * PX, w * PX, h * PX);
  return c;
}

const SEASONS = new Set(["spring", "summer", "autumn", "winter"]);
/** A role's season (its last word when one) and the role without it. */
function seasonOf(role) {
  const p = role.split(".");
  return SEASONS.has(p.at(-1)) ? [p.slice(0, -1).join("."), p.at(-1)] : [role, "summer"];
}

/** The kinds of role that take snow in winter: textures thickly, props lightly. */
const SNOWY_TEXTURES = new Set(["surface", "roof", "field", "shore", "dock"]);
/** Draws a role's image, with snow on it in winter where the art would have it: null for a role nothing is drawn for. */
function draw(role, variant, look) {
  const im = drawOne(role, variant, look), [name, s] = seasonOf(role), a = name.split(".")[0];
  if (!im || s !== "winter" || name === "surface.grass") return im;
  if (SNOWY_TEXTURES.has(a)) return snowOn(im, rngOf(`snow|${role}|${variant}`), true);
  if (a === "prop" && !/^prop\.(floe|icechunk|foam|tracks|reeds|lily)/.test(name)) return snowOn(im, rngOf(`snow|${role}|${variant}`), false);
  return im;
}
function drawOne(role, variant, look) {
  const L = LOOKS[look] ?? LOOKS.painted, [name, s] = seasonOf(role), r = rngOf(`${look}|${role}|${variant}`), p = name.split(".");
  const [a, b, c] = p;
  if (s === "winter" && (a === "ground" || name === "surface.grass")) return snowField(L, r);
  if (name === "overlay.snow") return snowPatches(L, r);
  if (name === "overlay.frost") return frost(L, r, false);
  if (name === "overlay.ice") return frost(L, r, true);
  if (a === "strip" && b === "rope") return rope(L, r);
  if (a === "strip") return winterStrip(L, r, b === "track" ? "wheel" : b === "ice" ? "cracked" : c);
  if (a === "smoke") return smoke(L, r, b);
  if (name === "shadow.half") return halfShadow();
  if (a === "field" && (b === "growing" || b === "ripe" || b === "hay")) return crop(L, r, b, s);
  if (a === "ground") return b === "forest" ? grass(L, r, s, "", true) : b === "snow" ? snowField(L, r) : grass(L, r, s, c ?? "");
  if (name === "surface.grass" || name === "field.pasture" || name === "shore.grass") return grass(L, r, s);
  if (name === "surface.dirt" || name === "field.fallow" || name === "field.plowed" || name === "shore.marsh") return earth(L, r, "dirt");
  if (name === "surface.trodden" || name === "surface.slush" || name === "field.stubble") return earth(L, r, "trodden");
  if (name === "surface.bed" || name === "shore.pebbles" || name === "surface.gravel") return earth(L, r, "bed");
  if (name === "shore.sand") return earth(L, r, "trodden");
  if (name === "surface.setts" || name === "surface.cobble") return stones(L, r, "setts");
  if (name === "surface.flagstone" || name === "dock.stone" || name === "wall.walk") return stones(L, r, "flag");
  if (name === "floor.stone") return stones(L, r, "floor");
  if (name === "surface.brick") return stones(L, r, "brick", L.roof.tile);
  if (name === "surface.herringbone") return stones(L, r, "weave", L.roof.tile);
  if (name === "surface.tiles") return stones(L, r, "tiles");
  if (name === "floor.wood" || name === "dock.wood" || name === "roof.flat.wood" || name === "wood.fence") return planks(L, r);
  if (name === "wood.stake") return stakes(L, r);
  if (name === "stone.curb") return stones(L, r, "curb");
  if (a === "water") return b === "ice" ? iceField(L, r, c === "cracked") : water(L, r, b !== "stream" && b !== "river");
  if (a === "stone" && b === "rough") return rough(L, r, s);
  if (a === "shore" && (b === "rocks" || b === "reeds")) return b === "rocks" ? rough(L, r, s) : grass(L, r, s);
  if (a === "roof") {
    const k = b ?? "";
    if (k.startsWith("thatch")) return roofing(L, r, "thatch");
    if (k.startsWith("slate") || k === "flat") return roofing(L, r, "slate", k === "slate-blue" ? ["#4b5a6e", "#71839a"] : undefined);
    if (k.startsWith("tile")) return roofing(L, r, "tile", { "tile-gray": L.roof.slate, "tile-black": ["#3a3a3c", "#5e5e60"], "tile-brown": L.roof.shingle }[k]);
    return roofing(L, r, "shingle", k.includes("dark") || k.includes("walnut") ? L.roof.shingle.map((x) => toHex(hex(x).map((v) => v * 0.75))) : k.includes("light") || k.includes("ashen") ? L.roof.shingle.map((x) => toHex(hex(x).map((v) => Math.min(255, v * 1.18)))) : k.includes("red") ? L.roof.tile : undefined);
  }
  if (a === "wall" && b !== "walk") return wallStrip(L, r, b);
  if (name === "fence.wood") return fenceStrip(L, r, false);
  if (name.startsWith("fence.stone")) return fenceStrip(L, r, true);
  if (name === "window.small") return windowStrip(L);
  if (a === "edge" && (b === "grass" || b === "slope")) return grassEdge(L, r, s);
  if (a === "edge" || a === "cliff") return bankStrip(L, r, (a === "cliff" ? c : c ?? b) ?? "earthy", s, a === "cliff" ? b : b === "bank" || b === "slope" ? "bank" : b);
  if (a === "tree") return crown(L, r, b === "conifer" ? "conifer" : b === "bare" ? "bare" : "leaf", s, variant);
  if (a === "bush") return bush(L, r, b === "bare" ? "winter" : s);
  if (name === "chimney.stone") return chimney(L);
  if (name === "fog.light") return fog();
  if (a === "prop") {
    // (at the sizes of Forgotten Adventures' files, which differ in winter)
    const w = s === "winter";
    if (b === "rock") return rock(L, r, w ? 0.7 : 0.55, w ? 1 : 2); if (b === "boulder") return rock(L, r, 0.85); if (b === "log") return log(L, r, w);
    if (b === "stump") return stump(L, r, w ? 1 : 4); if (b === "fern") return fern(L, r, s);
    if (b === "branch") return litter(L, r, b, s, [1, 2]); if (b === "roots") return litter(L, r, b, s, [3, 3]); if (b === "leaves") return litter(L, r, b, s, [2, 2]);
    if (b === "barrel") return barrel(L, r); if (b === "crate") return crate(L, r); if (b === "well") return well(L, r);
    if (b === "horse" || b === "mule" || b === "ox") return animal(L, r, b);
    if (b === "wagon") return wagon(L, r, 3, 6); if (b === "cart") return wagon(L, r, 2, 3); if (b === "hay") return hay(L, r, 2, 1);
    if (b === "tent") return tent(L, r); if (b === "bedroll") return bedroll(L, r); if (b === "fountain") return fountain(L, r); if (b === "statue") return statue(L, r);
    if (b === "stall") return stall(L, r, 2); if (b === "stall-long") return stall(L, r, 3); if (b === "sails") return sails(L, r); if (b === "waterwheel") return waterwheel(L, r);
    if (b === "boat" || b === "ship") return boat(L, r, b === "ship"); if (b === "sail") return sail(L, r);
    if (b === "maypole") return maypole(L, r); if (b === "sundial") return sundial(L, r);
    if (b === "cross" || b === "standing-stone") return obelisk(L, r); if (b === "crane") return crane(L, r); if (b === "grave") return grave(L, r);
    if (b === "topiary") return topiary(L, r, s); if (b === "firewood") return firewood(L, r); if (b === "planks") return plankStack(L, r); if (b === "sacks") return sacks(L, r);
    if (b === "rack") return rack(L, r); if (b === "pots") return pots(L, r); if (b === "anvil") return metalThing(L, r, "anvil", 1, 1); if (b === "cannonballs") return cannonballs(L, r);
    if (b === "cogs") return cog(L, r); if (b === "cauldron") return cauldron(L, r); if (b === "cairn") return cairn(L, r, w ? [2, 1] : [1, 2]); if (b === "sledge") return sledge(L, r);
    if (b === "ribbon") return ribbon(L, r); if (b === "reeds") return reeds(L, r, s); if (b === "lily") return lily(L, r);
    if (b === "floe" || b === "icechunk" || b === "foam") return ice(L, r, b); if (b === "tracks") return tracks(L, r);
    return null;
  }
  if (a === "furn") return furniture(L, r, b === "stairs" ? "stairs" : p.slice(1).join("."), c === "stone");
  return null;
}
/** Snow: white with blue shade in drifts. */
function snowField(L, r) {
  const c = cv(T, T), g = c.getContext("2d");
  mottle(g, T, r, L.ink ? "#e2e8ec" : "#c6d2dc", "#fbfdfe", { cells: 3, contrast: 0.7 });
  return c;
}

/** Snow lying in patches over something (a roof, the ground): a snow field cut by soft blobs, about half covered. */
function snowPatches(L, r) {
  const c = snowField(L, r), g = c.getContext("2d");
  // (the patches drawn on three tiles by three, each blob again on every side, and blurred there, so the middle tile
  // repeats without a seam)
  const m = cv(3 * T, 3 * T), k = m.getContext("2d");
  k.fillStyle = "#000";
  for (let i = 0; i < 26; i++) {
    const a = 0.35 + r() * 0.5, x = r() * T, y = r() * T, rad = T * (0.08 + r() * 0.14);
    k.globalAlpha = a;
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) { k.beginPath(); k.arc(x + dx * T, y + dy * T, rad, 0, 2 * Math.PI); k.fill(); }
  }
  const b = cv(3 * T, 3 * T), bk = b.getContext("2d");
  bk.filter = `blur(${Math.round(T * 0.03)}px)`; bk.drawImage(m, 0, 0); bk.filter = "none";
  g.globalCompositeOperation = "destination-in"; g.drawImage(b, T, T, T, T, 0, 0, T, T);
  g.globalCompositeOperation = "source-over";
  m.width = m.height = b.width = b.height = 1;
  return c;
}

/** Lets go of the drawn images (after a map is painted: a worker keeps nothing between maps). */
export function forgetDrawn() {
  cache.clear();
}

/**
 * The drawn image for a role and variant in a look ("painted" or "inked"), or null where nothing is drawn for it.
 * Drawn once and kept.
 */
export function drawnArt(role, variant = 0, { look = "painted", kept = cache } = {}) {
  if (typeof role !== "string" || !role) return null;
  const v = ((variant % 3) + 3) % 3, key = `${look}|${role}|${v}`;
  if (!kept.has(key)) kept.set(key, draw(role, v, look));
  return kept.get(key);
}

/**
 * Drawn images kept for one paint: art(role, variant, { look }) as drawnArt, and forget() to let them go. Two paints at
 * once each keep their own, so one finishing never clears the other's.
 */
export function drawnSet() {
  const kept = new Map();
  return { art: (role, variant = 0, opts = {}) => drawnArt(role, variant, { ...opts, kept }), forget: () => kept.clear() };
}
