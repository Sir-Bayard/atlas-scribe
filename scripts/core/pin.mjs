/**
 * Pinning: copying something the generator made into the plan as a fixed feature, so rerolls keep it. A house (with
 * its wings, bay, dormers, stepped sections and turret) becomes a landmark whose buildings are drawn exactly as
 * they were; a district's street or lane becomes a plan road along the same line. Everything around it is still the
 * generator's: the district fills round a pinned house, and its other streets flow round a pinned street.
 * Pure: runs in the worker, on the page and under node.
 */
import { freeId } from "./draw.mjs";
import { distanceToPath } from "./geom.mjs";

const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;
const PART = /^(w\d+|d\d+|s\d+|t|b)$/; // a house's wings, dormers, stepped sections, turret and bay

/** The base id of a generated house part ("town/h-l3-2w1" is part of "town/h-l3-2"), or null if it isn't one. */
export function houseOf(id) {
  const m = /^(.+\/h-l\d+-\d+)(.*)$/.exec(String(id ?? ""));
  return m && (m[2] === "" || PART.test(m[2])) ? m[1] : null;
}

/**
 * What the window can pick and pin from a layout: houses ({ id, from, parts: [building items] }, parts in the order
 * they're drawn) and the districts' own streets and lanes ({ id, from, class, faint, path, width, surface }).
 */
export function pinnables(layout) {
  const houses = new Map();
  const streets = [];
  for (const i of layout?.items ?? []) {
    if (i.kind === "building" && i.from && i.id !== i.from) {
      const base = houseOf(i.id);
      if (!base) continue;
      if (!houses.has(base)) houses.set(base, { id: base, from: i.from, parts: [] });
      houses.get(base).parts.push(i);
    } else if (i.kind === "way" && i.from && /\/s\d+$/.test(i.id) && Array.isArray(i.path) && i.path.length >= 2) {
      streets.push({ id: i.id, from: i.from, class: i.class, path: i.path, width: i.width, surface: i.surface ?? null, crossings: [] });
    }
  }
  // The bridges and footbridges a district put on its own streets go with them
  for (const c of layout?.items ?? []) {
    if (c.kind !== "crossing" || c.id === c.from || !Array.isArray(c.at)) continue;
    const st = streets.filter((s) => s.from === c.from).map((s) => ({ s, d: distanceToPath(c.at, s.path) })).sort((a, b) => a.d - b.d)[0];
    if (st && st.d < Math.max(0.3, (st.s.width ?? 0) / 2 + 0.1)) st.s.crossings.push({ class: c.class, at: c.at });
  }
  return { houses: [...houses.values()].filter((h) => h.parts.some((p) => p.id === h.id)), streets };
}

/** One generated building as a plan building: its footprint, turn, roof, height and the details of how it was drawn. */
function asPlanBuilding(b) {
  const out = b.round
    ? { shape: { circle: [r3(b.cx), r3(b.cy), r3(b.len / 2)] } }
    : { shape: { rect: [r3(b.cx - b.len / 2), r3(b.cy - b.dep / 2), r3(b.cx + b.len / 2), r3(b.cy + b.dep / 2)] }, roofStyle: b.roofStyle };
  out.rot = r3(b.rot ?? 0);
  out.roof = b.roof;
  out.height = r2(20 + (b.tall ?? 0) * 20);
  if (Number.isFinite(b.variant)) out.variant = b.variant;
  out.chimney = !!b.chimney;
  if (b.chimney) out.chimneyAt = { u: b.chimney.u, v: b.chimney.v, variant: b.chimney.variant };
  if (b.join) out.join = structuredClone(b.join);
  if (Array.isArray(b.cut) && b.cut.length) out.cut = structuredClone(b.cut);
  return out;
}

/** The plan with a generated house pinned as a landmark. Returns { plan, id } or { error }. */
export function pinHouse(plan, house) {
  if (!house?.parts?.length) return { error: "There's no house there to pin." };
  const next = structuredClone(plan);
  if (!Array.isArray(next.features)) next.features = [];
  const id = freeId(next, "house");
  next.features.push({ id, type: "landmark", buildings: house.parts.map(asPlanBuilding) });
  return { plan: next, id };
}

/**
 * The plan with a district's generated street or lane pinned as a plan road along the same line (kept as drawn:
 * straight between its many points), with the bridges the district put on it. A back lane is pinned as a lane.
 * Returns { plan, id } or { error }.
 */
export function pinStreet(plan, street) {
  const path = (street?.path ?? []).map((p) => [r2(p[0]), r2(p[1])]).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  if (path.length < 2) return { error: "There's no street there to pin." };
  const sq = plan?.size?.ftPerSquare || 25;
  const cls = street.class === "street" ? "street" : "lane";
  const next = structuredClone(plan);
  if (!Array.isArray(next.features)) next.features = [];
  const id = freeId(next, cls);
  const road = { id, type: "road", class: cls, path, straight: true };
  if (Number.isFinite(street.width) && street.width > 0) road.width = Math.round(street.width * sq);
  if (typeof street.surface === "string") road.surface = street.surface;
  next.features.push(road);
  // Its bridges too, as plan crossings (each lands back on where the road crosses the water)
  for (const c of street.crossings ?? []) next.features.push({ id: freeId(next, c.class === "footbridge" ? "footbridge" : "bridge"), type: "crossing", class: c.class === "footbridge" ? "footbridge" : c.class === "ford" ? "ford" : "bridge", at: [r2(c.at[0]), r2(c.at[1])] });
  return { plan: next, id };
}
