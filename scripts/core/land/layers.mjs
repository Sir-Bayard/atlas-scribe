/**
 * Painted intent: the land's layers (8-bit gray rasters over the context frame, kept in the plan as PNG data URLs)
 * read into fields in plain units, with the plan's vector terrain areas (land, sea, basin, plateau, lowland,
 * hardness, climate, biome, lock) rasterized into the same fields, so there is one path through the generator for
 * both ways of authoring. Then sampled at the graph's nodes, blurred by a few miles so intent blends (the generator
 * widens and blends every intent). Units: water 0 sea to 1 land (0.5 lets the recipe decide); relief -1 (flatten and
 * sink) to 1 (raise to mountains); rock 0 soft to 1 hard (0.5 normal); climateWet and climateWarm -1 to 1; zones an
 * index into land.zones; lock 0 or 1. The order of authority (lock, painted water, land and sea, relief, rock,
 * climate, zones, then the generator) is kept by the stages that read these. Pure (writeLayers is async: it encodes).
 */
import { makeField, like, sample, blur } from "./field.mjs";
import { decodeGraySync, encodeGray, fromDataUrl, toDataUrl } from "./pngio.mjs";
import { LAYER_NAMES, terrainGeometry } from "./schema.mjs";
import { shapeToPolygon, pointInPolygon, bbox } from "../geom.mjs";

/** How each layer's 0..255 value reads, and its neutral value. */
const READ = {
  water: { from: (v) => v / 255, neutral: 0.5 }, rock: { from: (v) => v / 255, neutral: 0.5 }, lock: { from: (v) => (v >= 128 ? 1 : 0), neutral: 0 },
  relief: { from: (v) => (v - 128) / 127, neutral: 0 }, climateWet: { from: (v) => (v - 128) / 127, neutral: 0 }, climateWarm: { from: (v) => (v - 128) / 127, neutral: 0 },
  zones: { from: (v) => v, neutral: 0 }, cover: { from: (v) => v, neutral: 0 },
};
const WRITE = {
  water: (x) => Math.round(x * 255), rock: (x) => Math.round(x * 255), lock: (x) => (x ? 255 : 0),
  relief: (x) => Math.round(128 + 127 * x), climateWet: (x) => Math.round(128 + 127 * x), climateWarm: (x) => Math.round(128 + 127 * x),
  zones: (x) => x, cover: (x) => x,
};
/** Blur (miles) when sampled at nodes: land and sea and relief blend over miles; zones and lock stay sharp. */
const SOFT = { water: 8, relief: 18, rock: 10, climateWet: 15, climateWarm: 15, zones: 0, cover: 0, lock: 0 };

/**
 * Reads a plan's intent (synchronously). frame: frameOf(plan). Returns null when there is none, else { fields: { name: field },
 * zones: [{ index, id, name, biome, color, reacts }] }.
 */
export function readIntent(plan, frame) {
  const land = plan.land ?? {}, fields = {};
  const lay = land.layers && typeof land.layers === "object" ? land.layers : null;
  // (layers cover the frame, so their shape is the frame's: one that isn't, or is under 2 px a side, is left out; the
  // checker says why)
  const fits = (w, h) => w >= 2 && h >= 2 && Math.abs(h - (w * frame.H) / frame.W) <= 1;
  const size = Array.isArray(lay?.size) && lay.size.length === 2 && fits(lay.size[0], lay.size[1]) ? lay.size : null;
  const blank = (name) => { const f = size ? { w: size[0], h: size[1], cell: frame.W / size[0], data: new Float64Array(size[0] * size[1]) } : makeField(frame.W, frame.H, 256); f.data.fill(READ[name].neutral); return f; };
  if (lay) for (const name of LAYER_NAMES) {
    if (typeof lay[name] !== "string") continue;
    try {
      const { w, h, values } = decodeGraySync(fromDataUrl(lay[name]));
      if (!fits(w, h) || (size && (w !== size[0] || h !== size[1]))) continue;
      const f = { w, h, cell: frame.W / w, data: new Float64Array(w * h) };
      for (let i = 0; i < w * h; i++) f.data[i] = READ[name].from(values[i]);
      fields[name] = f;
    } catch { /* (a layer that can't be read is left out; the checker says why) */ }
  }
  const zones = (Array.isArray(land.zones) ? land.zones : []).filter((z) => z && Number.isInteger(z.index)).map((z) => ({ ...z }));
  // vector terrain areas into the same fields
  // (a lake the GM drew as a water shape is forced: the ground there sinks and stays land, so the water gathers)
  const areas = (plan.features ?? []).filter((f) => (f.type === "terrain" && terrainGeometry(f.class) === "shape" && f.shape) || (f.type === "water" && ["lake", "pond"].includes(f.class) && f.shape && !f.path));
  let nextZone = Math.max(0, ...zones.map((z) => z.index)) + 1;
  for (const f of areas) {
    const poly = shapeToPolygon(f.shape, f.rot ?? 0).map((p) => frame.toFrame(p));
    if (poly.length < 3) continue;
    const paint = (name, value) => {
      const fl = (fields[name] ??= blank(name));
      const [x0, y0, x1, y1] = bbox(poly);
      for (let y = Math.max(0, Math.floor(y0 / fl.cell)); y <= Math.min(fl.h - 1, Math.ceil(y1 / fl.cell)); y++)
        for (let x = Math.max(0, Math.floor(x0 / fl.cell)); x <= Math.min(fl.w - 1, Math.ceil(x1 / fl.cell)); x++)
          if (pointInPolygon([(x + 0.5) * fl.cell, (y + 0.5) * fl.cell], poly)) fl.data[y * fl.w + x] = value;
    };
    const st = Number.isFinite(f.strength) ? f.strength : 1;
    if (f.type === "water") { paint("relief", -1); paint("water", 1); }
    else if (f.class === "land") paint("water", 0.5 + 0.5 * st);
    else if (f.class === "sea") paint("water", 0.5 - 0.5 * st);
    else if (f.class === "basin") paint("relief", -(0.5 + 0.5 * (Number.isFinite(f.depth) ? f.depth : 0.5)));
    else if (f.class === "plateau") paint("relief", 0.45 * (Number.isFinite(f.height) ? f.height : 1));
    else if (f.class === "lowland") paint("relief", -0.5 * st);
    else if (f.class === "hardness") paint("rock", Number.isFinite(f.hard) ? f.hard : 0.8);
    else if (f.class === "climate") { if (Number.isFinite(f.wetter) && f.wetter) paint("climateWet", f.wetter); if (Number.isFinite(f.warmer) && f.warmer) paint("climateWarm", f.warmer); }
    else if (f.class === "biome") { const index = nextZone++; zones.push({ index, id: f.id, name: f.name ?? null, biome: f.biome ?? "custom", color: f.color ?? null, reacts: f.reacts === true }); paint("zones", index); }
    else if (f.class === "lock") paint("lock", 1);
  }
  if (!Object.keys(fields).length) return null;
  return { fields, zones };
}

/** The intent at every node: { water, relief, rock, wet, warm, zone (Int32Array), lock (Uint8Array) } (missing layers absent). */
export function intentAtNodes(intent, g) {
  if (!intent) return null;
  const out = {};
  const at = (name) => {
    const src = intent.fields[name];
    if (!src) return null;
    const f = like(src, src.data);
    const r = Math.round(SOFT[name] / f.cell);
    if (r >= 1) blur(f, r);
    const a = new Float64Array(g.n);
    for (let i = 0; i < g.n; i++) a[i] = sharp(name) ? nearestValue(src, g.x[i], g.y[i]) : sample(f, g.x[i], g.y[i]);
    return a;
  };
  const sharp = (name) => SOFT[name] === 0;
  const water = at("water"), relief = at("relief"), rock = at("rock"), wet = at("climateWet"), warm = at("climateWarm"), zones = at("zones"), lock = at("lock");
  if (water) out.water = water;
  if (relief) out.relief = relief;
  if (rock) out.rock = rock;
  if (wet) out.wet = wet;
  if (warm) out.warm = warm;
  if (zones) out.zone = Int32Array.from(zones, (v) => Math.round(v));
  if (lock) out.lock = Uint8Array.from(lock, (v) => (v >= 0.5 ? 1 : 0));
  out.zones = intent.zones;
  return out;
}

const nearestValue = (f, x, y) => f.data[Math.min(f.h - 1, Math.max(0, Math.floor(y / f.cell))) * f.w + Math.min(f.w - 1, Math.max(0, Math.floor(x / f.cell)))];

/** Fields back into plan layers: { size, name: data URL } (for brushes later and for tests). */
export async function writeLayers(fields) {
  const names = Object.keys(fields).filter((n) => LAYER_NAMES.includes(n));
  if (!names.length) return null;
  const { w, h } = fields[names[0]];
  const out = { size: [w, h] };
  for (const name of names) {
    const f = fields[name], v = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) v[i] = Math.min(255, Math.max(0, WRITE[name](f.data[i])));
    out[name] = toDataUrl(await encodeGray(v, w, h, 8));
  }
  return out;
}
