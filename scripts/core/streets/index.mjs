/**
 * Generated streets for one district: its type's numbers, the field from the plan's roads, rivers and radial
 * squares, and the tracer. Pure: runs anywhere.
 */
import { makeField } from "./field.mjs";
import { OLD_PROFILES } from "../plan.mjs";
import { withCharacterStreets, characterOf } from "../character.mjs";
import { traceStreets } from "./trace.mjs";
export { districtGates } from "./borders.mjs";

/**
 * District types. Spacings and widths in feet. streets: the main streets (spacing range: each district picks a
 * value in it from its seed); lanes: the closer pass between them (only: keep them to the field's minor direction,
 * across the main streets); back: back lanes a plot's depth behind the main streets (depth: a range, picked per
 * district from its seed; the burgage pattern: long plots from the street back to the lane, Patrick 24 Oct);
 * bridge: what each pass builds where it crosses water (none: it stops at the bank); bend: the wobble in degrees;
 * trim: drop short dead ends.
 */
export const DISTRICT_TYPES = {
  hamlet: { streets: null, lanes: null, bend: 0, trim: false },
  village: { streets: { spacing: [220, 320], width: 15, bridge: "footbridge" }, lanes: null, bend: 40, trim: false },
  town: { streets: { spacing: [350, 450], width: 20, bridge: "bridge" }, back: { depth: [150, 200], width: 10 }, lanes: { spacing: 250, width: 10, bridge: "footbridge", only: "minor" }, bend: 18, trim: true },
  city: { streets: { spacing: [125, 175], width: 15, bridge: "bridge" }, lanes: { spacing: 60, width: 8, bridge: null }, bend: 8, trim: true },
};

/** A district's type, by its profile (older names read as their new ones: "roadside" a hamlet, "core" a city), with its character's changes. */
export function typeOf(district) {
  return withCharacterStreets(DISTRICT_TYPES[OLD_PROFILES[district.profile] ?? district.profile] ?? DISTRICT_TYPES.hamlet, characterOf(district));
}

/**
 * The spacings a district's gates are placed by, in squares: the middle of its type's range (or its own
 * spacing). They never depend on the district's seed, so gates don't move when a district is rerolled.
 */
export function gateSpacing(district, ftPerSquare) {
  const type = typeOf(district);
  if (!type.streets) return { streetSpacing: null, laneSpacing: null };
  const [lo, hi] = type.streets.spacing;
  return {
    streetSpacing: (district.spacing ?? (lo + hi) / 2) / ftPerSquare,
    laneSpacing: type.lanes ? type.lanes.spacing / ftPerSquare : null,
  };
}

/** The main direction of a district: the longest road through it, else 0. In degrees. */
function axisOf(roads) {
  let best = 0, ang = 0;
  for (const road of roads)
    for (let i = 0; i < road.path.length - 1; i++) {
      const [ax, ay] = road.path[i], [bx, by] = road.path[i + 1];
      const l = Math.hypot(bx - ax, by - ay);
      if (l > best) { best = l; ang = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI; }
    }
  return ang;
}

/**
 * district: the plan feature (profile, bend, spacing, axis). poly: its polygon. roads: [{ path }] the plan's roads
 * touching it. water: [{ path, clear }]. radials: [{ at, radius }] radial squares. blocked: polygons streets stop
 * at (squares, yards, landmarks). gates: this district's gates (districtGates). borders: its edges shared with
 * other districts. ftPerSquare. r: the district's stream. Returns { streets: [{ path, kind, width, ends }],
 * bridges, field } (in squares), or nothing for a hamlet.
 */
export function streetsFor({ district, poly, roads, water = [], radials = [], blocked = [], gates = [], borders = [], ftPerSquare, r }) {
  const type = typeOf(district);
  if (!type.streets) return { streets: [], bridges: [], field: null };
  const sq = (ft) => ft / ftPerSquare;
  const [lo, hi] = type.streets.spacing;
  const spacing = sq(district.spacing ?? lo + r.next() * (hi - lo));
  const reach = spacing * 2;
  const field = makeField({
    lines: [
      ...roads.map((p) => ({ path: p.path, reach })),
      ...water.map((w) => ({ path: w.path, reach: reach * 0.8 })),
      // Shared edges: both districts line up with them, so streets cross them nearly square and meet cleanly
      ...borders.map((path) => ({ path, reach: spacing * 0.6 })),
    ],
    radials: radials.map((s) => ({ at: s.at, radius: s.radius, reach: spacing * 1.2 })),
    axis: district.axis ?? axisOf(roads),
    bend: district.bend ?? type.bend,
    seed: r.int(2 ** 31),
    key: district.id,
    wobble: spacing * 1.3,
  });
  const passes = [{ kind: "street", spacing, minLength: spacing * 0.6, bridge: type.streets.bridge ?? null }];
  // The back lanes' depth: from the street's center to the lane's, so a plot of the type's depth fits between
  const backDepth = type.back ? sq(type.back.depth[0] + r.next() * (type.back.depth[1] - type.back.depth[0]) + type.streets.width / 2 + type.back.width / 2) : null;
  if (type.back) passes.push({ kind: "back", depth: backDepth });
  if (type.lanes) passes.push({ kind: "lane", spacing: Math.min(sq(type.lanes.spacing), spacing * 0.6), minLength: sq(type.lanes.spacing) * 0.5, bridge: type.lanes.bridge ?? null, only: type.lanes.only ?? null });
  const traced = traceStreets({ poly, field, roads, water, blocked, gates, borders, passes, r, trimDeadEnds: type.trim });
  const width = { street: sq(type.streets.width), lane: sq(type.lanes?.width ?? type.streets.width), back: sq(type.back?.width ?? 10) };
  return { streets: traced.streets.map((s) => ({ ...s, width: width[s.kind] })), bridges: traced.bridges, field, backDepth };
}
