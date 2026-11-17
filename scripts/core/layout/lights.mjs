/**
 * A battle map's lights and mist: its fires, candles, lanterns, torches and lamp posts, each a Foundry light and most
 * a piece of FA art laid as a tile with the furniture, and fog overlays in its low places.
 *
 * - Indoors: a light on each hearth, oven and forge; candles on tables and an altar, an oil lamp on each desk.
 * - Floors above and below: wall lanterns that always burn, down a corridor or one a room.
 * - Door lanterns by the street door of each inn, temple, shop and workshop (a house's now and then); a torch each
 *   side of a town gate.
 * - Street lamps in a city's districts only: posts evenly spaced at the curb, in facing pairs on main roads and down
 *   one side elsewhere, and around each square; off doors, buildings and water.
 * - A plan's campfire, fire pit, brazier, torch or lamp post, lit where it stands.
 *
 * A fire or candle always burns; a lantern, torch or lamp post is lit only from dusk (a light's darkness range).
 * LIGHTS are in feet, as Foundry's are. Mist lies faint (10 to 30%) along stream beds, over pools and in hollows.
 */
import { rng } from "../rng.mjs";
import { pointInPolygon, distanceToPath } from "../geom.mjs";
import { levelAt } from "../height.mjs";
import { footprint } from "./battle.mjs";
import { FLOORS } from "./rooms.mjs";

/** The props a plan can place that are lights (each lit where it stands). */
export const LIGHT_PROPS = ["campfire", "firepit", "brazier", "torch", "lamp-post"];

/** The darkness a lantern, torch or lamp post is lit from (dawn's 0.45 and darker). */
export const LIT_FROM = 0.4;

/**
 * Each light: bright and dim (feet), color, how see-through its color is (and how bright its middle, luminosity,
 * lower for a lantern so its pool reads warm, not white), its flicker (Foundry's animation), and
 * whether it waits for the dark. prop: the piece of furniture art it's drawn as (none for a hearth, oven or forge,
 * whose own art is the fire).
 */
export const LIGHTS = {
  hearth: { bright: 10, dim: 20, color: "#ff9b50", alpha: 0.35, animation: { type: "flame", speed: 2, intensity: 3 } },
  "hearth.large": { bright: 15, dim: 30, color: "#ff9b50", alpha: 0.35, animation: { type: "flame", speed: 2, intensity: 3 } },
  oven: { bright: 5, dim: 15, color: "#ff8a3c", alpha: 0.35, animation: { type: "flame", speed: 2, intensity: 2 } },
  forge: { bright: 10, dim: 25, color: "#ff6a2a", alpha: 0.4, animation: { type: "flame", speed: 3, intensity: 4 } },
  candles: { bright: 0, dim: 10, color: "#ffd590", alpha: 0.3, animation: { type: "torch", speed: 2, intensity: 1 }, prop: "candles" },
  lamp: { bright: 5, dim: 15, color: "#ffcf80", alpha: 0.3, animation: { type: "torch", speed: 1, intensity: 1 }, prop: "lamp.table" },
  lantern: { bright: 10, dim: 20, color: "#ffc56b", alpha: 0.55, luminosity: 0.3, animation: { type: "torch", speed: 1, intensity: 1 }, dark: true, prop: "lantern.wall" },
  "lantern-indoor": { bright: 10, dim: 20, color: "#ffc56b", alpha: 0.55, luminosity: 0.3, animation: { type: "torch", speed: 1, intensity: 1 }, prop: "lantern.wall" },
  "gate-torch": { bright: 20, dim: 40, color: "#ff9a40", alpha: 0.4, animation: { type: "torch", speed: 3, intensity: 3 }, dark: true, prop: "torch.stake" },
  "lamp-post": { bright: 5, dim: 20, color: "#ffc56b", alpha: 0.55, luminosity: 0.3, animation: { type: "torch", speed: 1, intensity: 1 }, dark: true, prop: "lamp.post" },
  campfire: { bright: 20, dim: 40, color: "#ff9040", alpha: 0.4, animation: { type: "flame", speed: 3, intensity: 3 }, prop: "campfire" },
  firepit: { bright: 15, dim: 30, color: "#ff9040", alpha: 0.4, animation: { type: "flame", speed: 3, intensity: 3 }, prop: "firepit" },
  brazier: { bright: 15, dim: 30, color: "#ff9a40", alpha: 0.4, animation: { type: "flame", speed: 3, intensity: 3 }, prop: "brazier" },
  torch: { bright: 20, dim: 40, color: "#ff9a40", alpha: 0.4, animation: { type: "torch", speed: 3, intensity: 3 }, prop: "torch.stake" },
};

/** The furniture pieces that are fires, and what light each sheds. */
const FIRES = { hearth: "hearth", "hearth.large": "hearth.large", oven: "oven", forge: "forge" };
/** The tables candles stand on, and how many sets on each. */
const TABLES = { "table.round": 1, "table.square": 1, "table.long": 2 };
/** The buildings with a lantern by their street door; any other but these has one now and then (HOUSE_LANTERN). */
export const LANTERN_USES = new Set(["inn", "temple", "chapel", "shrine", "shop", "guildhall", "customs", "bakery", "butcher", "alchemist", "magic-shop", "smithy", "farrier", "gunsmith", "brewery", "watch", "barracks", "keep", "palace", "mansion", "market-hall", "workshop"]);
const NO_LANTERN = new Set(["shed", "store", "tomb", "mausoleum", "barn", "granary", "warehouse", "stable", "ruin"]);
const HOUSE_LANTERN = 0.3;
/**
 * Lamp posts: spacing along a street and a lane (squares), how far in from the edge (on the paving at the curb), the
 * classes that get them, and a square's spacing and inset. Each way's posts keep their rhythm; one whose place is
 * taken slides up to SLIDE along, else is left out. A highway's posts, or any way PAIRED wide or wider, face each
 * other; others run down one side.
 */
const LAMPS = { step: 7, laneStep: 12, curb: 0.35, classes: new Set(["highway", "street"]), lanes: new Set(["lane"]), squareStep: 6, squareIn: 0.7, apart: 3 };
const SLIDE = [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8];
const PAIRED = 5;
/** The open places whose edges get lamp posts in a city. */
const SQUARES = new Set(["square", "plaza", "market"]);

/** A floor's height in feet. */
const FLOOR_FT = FLOORS.height;

/** How far apart an upstairs corridor's lanterns are, in squares. */
const CORRIDOR_LANTERN = 7;

/**
 * Where the wall lanterns of a floor above or below the ground hang: spaced down its corridor if it has one, else one
 * in each room, each on the wall nearest the spot, clear of doors, windows and the stairs. Returns [[at, rot]].
 */
function floorLanterns(it, stairBoxes) {
  const rooms = it.rooms ?? [];
  const lit = rooms.some((m) => m.kind === "corridor") ? rooms.filter((m) => m.kind === "corridor") : rooms;
  // (each wall with its thickness: an inner wall's, an outer wall's, which a castle's masonry makes thicker)
  const walls = [...(it.walls ?? []).map((w) => ({ ...w, th: it.thickness ?? 0.3 })), ...(it.outer ?? []).map((w) => ({ ...w, th: it.outerThickness ?? it.thickness ?? 0.3 }))];
  const solid = walls.filter((w) => w.type === "wall");
  const gaps = walls.filter((w) => w.type !== "wall");
  const out = [];
  for (const m of lit) {
    const poly = m.poly;
    if (!Array.isArray(poly) || poly.length < 3) continue;
    // (the room's long axis: its longest edge's direction, through its middle)
    const c = poly.reduce((a, p) => [a[0] + p[0] / poly.length, a[1] + p[1] / poly.length], [0, 0]);
    let ax = [1, 0], best = 0;
    poly.forEach((p, k) => { const q = poly[(k + 1) % poly.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L > best) { best = L; ax = [(q[0] - p[0]) / L, (q[1] - p[1]) / L]; } });
    const span = poly.map((p) => (p[0] - c[0]) * ax[0] + (p[1] - c[1]) * ax[1]);
    const lo = Math.min(...span), hi = Math.max(...span);
    const n = m.kind === "corridor" ? Math.max(1, Math.round((hi - lo) / CORRIDOR_LANTERN)) : 1;
    for (let k = 0; k < n; k++) {
      const t = lo + ((k + 0.5) / n) * (hi - lo), spot = [c[0] + ax[0] * t, c[1] + ax[1] * t];
      // (the clear place on a solid wall nearest the spot, sliding along the walls past doors, windows and the stairs)
      let pick = null;
      for (const w of solid) {
        const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], L = Math.hypot(dx, dy);
        if (L < 0.3) continue;
        const nx = -dy / L, ny = dx / L;
        // (along it, clear of its ends; a short side of a round wall at its middle)
        for (let e = Math.min(0.4, L / 2); e <= Math.max(L - 0.4, L / 2) + 1e-9; e += 0.25) {
          const foot = [w.a[0] + (dx * e) / L, w.a[1] + (dy * e) / L];
          // (hung on the room's side of the wall)
          const reach = w.th / 2 + 0.2;
          const sgn = pointInPolygon([foot[0] + nx * reach, foot[1] + ny * reach], poly) ? 1 : pointInPolygon([foot[0] - nx * reach, foot[1] - ny * reach], poly) ? -1 : 0;
          if (!sgn) continue;
          const o = [nx * sgn, ny * sgn], q = [foot[0] + o[0] * (w.th / 2 + 0.15), foot[1] + o[1] * (w.th / 2 + 0.15)];
          if (!pointInPolygon(q, poly)) continue;
          const d = Math.hypot(q[0] - spot[0], q[1] - spot[1]);
          if (pick && d >= pick.d) continue;
          if (gaps.some((g) => distanceToPath(q, [g.a, g.b]) < 0.7)) continue;
          if (stairBoxes.some((bx) => pointInPolygon(q, bx) || distanceToPath(q, [...bx, bx[0]]) < 0.3)) continue;
          pick = { q, o, d };
        }
      }
      if (pick) out.push([[r3(pick.q[0]), r3(pick.q[1])], r3(deg(Math.atan2(-pick.o[0], pick.o[1])))]);
    }
  }
  return out;
}

/**
 * The map's lights: [{ kind: "light", id, from, class, at, elevation, prop: { f, x, y, rot, variant } | null }].
 * items: the battle layout's items so far; size: the map's [width, height] in squares. Light props the plan placed
 * are taken out of items (they're drawn as lights).
 */
export function lightsOf(items, seed, { size = null } = {}) {
  const r = rng(seed ?? 1, "lights");
  const out = [];
  const ground = (p) => levelAt(items, p);
  // (a light on a floor above or below the ground: its floor, and its elevation that floor's)
  let onFloor = 0;
  const add = (cls, from, at, prop = null, id = null) => out.push({ kind: "light", id: id ?? `${from}/light${out.length + 1}`, from, class: cls, at: [r3(at[0]), r3(at[1])], elevation: ground(at) + onFloor * FLOOR_FT, ...(onFloor ? { floor: onFloor } : {}), prop: prop && onFloor ? { ...prop, floor: onFloor } : prop });
  const piece = (f, x, y, rot, variant) => ({ f, x: r3(x), y: r3(y), rot: r3(rot), variant });
  const onMap = (q) => !Array.isArray(size) || (q[0] > 0.5 && q[1] > 0.5 && q[0] < size[0] - 0.5 && q[1] < size[1] - 0.5);
  const feet = items.filter((i) => i.kind === "building").map((b) => footprint(b));
  const onFoot = (q) => feet.some((f) => pointInPolygon(q, f) || distanceToPath(q, [...f, f[0]]) < 0.35);
  const waters = items.filter((i) => i.kind === "water");
  const inWater = (q) => waters.some((w) => (Array.isArray(w.poly) && pointInPolygon(q, w.poly)) || (Array.isArray(w.path) && distanceToPath(q, w.path) < (w.width ?? 1) / 2 + 0.6));

  const stairBoxes = items.filter((i) => i.kind === "stairs" && Array.isArray(i.box)).map((i) => i.box);
  // Indoor fires and candles
  for (const it of items.filter((i) => i.kind === "interior")) {
    onFloor = it.floor ?? 0;
    for (const p of it.furniture ?? []) {
      if (FIRES[p.f]) add(FIRES[p.f], it.from ?? it.id, [p.x, p.y]);
      const a = ((p.rot ?? 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      const at = (u, v) => [p.x + u * c - v * s, p.y + u * s + v * c];
      if (TABLES[p.f]) {
        const n = TABLES[p.f];
        for (let k = 0; k < n; k++) { const q = at(n === 1 ? 0 : (k - 0.5) * 1.6, 0); add("candles", it.from ?? it.id, q, piece("candles", q[0], q[1], r.next() * 360, r.int(8))); }
      } else if (p.f === "altar") {
        for (const u of [-0.62, 0.62]) { const q = at(u, 0.1); add("candles", it.from ?? it.id, q, piece("candles", q[0], q[1], r.next() * 360, r.int(8))); }
      } else if (p.f === "desk") {
        const q = at(0.5, 0.05);
        add("lamp", it.from ?? it.id, q, piece("lamp.table", q[0], q[1], 0, r.int(8)));
      }
    }
    if (onFloor) for (const [q, rot] of floorLanterns(it, stairBoxes)) add("lantern-indoor", it.from ?? it.id, q, piece("lantern.wall", q[0], q[1], rot, r.int(8)));
  }

  onFloor = 0;
  // Door lanterns: beside the street door of a building that serves the street, on its outer face
  const ways = items.filter((i) => i.kind === "way" && Array.isArray(i.path) && i.path.length >= 2 && !i.faint);
  const squares = items.filter((i) => i.kind === "surface" && SQUARES.has(i.class) && Array.isArray(i.poly) && i.poly.length >= 3);
  // (how far to the nearest street, road or square: a door on a square is on the street)
  const streets = ways.filter((w) => !w.approach); // (a path to a door isn't a street a lantern looks onto)
  const nearestWay = (p) => Math.min(
    streets.reduce((best, w) => Math.min(best, distanceToPath(p, w.path) - (w.width ?? 0) / 2), Infinity),
    squares.reduce((best, q) => Math.min(best, pointInPolygon(p, q.poly) ? 0 : distanceToPath(p, [...q.poly, q.poly[0]])), Infinity));
  const lanterns = [];
  // (a castle's towers and gatehouses have none: its gates have their torches)
  for (const sh of items.filter((i) => i.kind === "shell" && !NO_LANTERN.has(i.use) && !i.works)) {
    const doors = (sh.walls ?? []).filter((w) => w.type === "door" && Array.isArray(w.inward));
    if (!doors.length) continue;
    // (a house or workshop only now and then: a lit door here and there down the street)
    if (!LANTERN_USES.has(sh.use) && !r.chance(HOUSE_LANTERN)) continue;
    // (the door nearest a street or road, its lantern on the side away from the building's corner)
    const best = doors.map((w) => {
      const m = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2], o = [-w.inward[0], -w.inward[1]];
      return { w, m, o, d: nearestWay([m[0] + o[0], m[1] + o[1]]) };
    }).sort((a, b) => a.d - b.d)[0];
    if (best.d > 4) continue; // (no street near any door: a yard's house)
    const { w, m, o } = best, L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1, t = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
    const thick = sh.thickness ?? 0.3;
    for (const side of r.shuffle([1, -1])) {
      const q = [m[0] + t[0] * side * (L / 2 + 0.3) + o[0] * (thick / 2 + 0.15), m[1] + t[1] * side * (L / 2 + 0.3) + o[1] * (thick / 2 + 0.15)];
      // (on its own wall: not past the wall's end into a corner)
      if (!(sh.walls ?? []).some((x) => x.type !== "door" && distanceToPath(q, [x.a, x.b]) < thick / 2 + 0.25)) continue;
      if (!onMap(q)) continue;
      // (its art's top, the bracket, against the wall)
      add("lantern", sh.from ?? sh.id, q, piece("lantern.wall", q[0], q[1], deg(Math.atan2(-o[0], o[1])), r.int(8)));
      lanterns.push(q);
      break;
    }
  }

  // A torch each side of a town gate, on its outer face
  for (const g of items.filter((i) => i.kind === "gate" && Array.isArray(i.at) && Array.isArray(i.dir) && Array.isArray(i.out))) {
    const half = (g.roadWidth ?? 1) / 2 + 0.55;
    // (a battle map's gatehouse stands over the gate: its torches on the gatehouse's outer face, where the road comes in)
    const house = items.find((i) => i.kind === "building" && i.works === "gatehouse" && pointInPolygon(g.at, footprint(i)));
    let out = (g.thickness ?? 0.6) / 2 + 0.35;
    if (house) { const f = footprint(house); let d = 0; while (d < 20 && pointInPolygon([g.at[0] + g.out[0] * d, g.at[1] + g.out[1] * d], f)) d += 0.05; out = d + 0.45; }
    for (const side of [-1, 1]) {
      const q = [g.at[0] + g.dir[0] * side * half + g.out[0] * out, g.at[1] + g.dir[1] * side * half + g.out[1] * out];
      // (on the map, on dry ground and clear of the buildings: a gate at the map's edge may have only one, or none)
      if (!onMap(q) || inWater(q) || onFoot(q)) continue;
      add("gate-torch", g.from ?? g.id, q, piece("torch.stake", q[0], q[1], r.next() * 30 - 15, r.int(8)));
    }
  }

  // Street lamps: evenly along a city's highways (in facing pairs) and streets (down one side), its lanes more sparsely,
  // then around its squares
  const cityDistricts = items.filter((i) => i.kind === "district" && i.profile === "city" && Array.isArray(i.poly) && i.poly.length >= 3);
  const cities = cityDistricts.map((d) => d.poly);
  if (cities.length) {
    const doorsAt = items.filter((i) => i.kind === "shell").flatMap((sh) => (sh.walls ?? []).filter((w) => w.type === "door").map((w) => [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2]));
    // (a plan's own props, its fires and lamps among them, and the trees)
    const blocked = items.filter((i) => i.kind === "prop" || i.kind === "tree").map((p) => [p.x, p.y]);
    const levels = items.filter((i) => i.kind === "level" && i.bed);
    const decks = items.filter((i) => i.kind === "crossing" && Array.isArray(i.at));
    const posts = [];
    const ok = (q, from, own = null) =>
      onMap(q) &&
      cities.some((poly) => pointInPolygon(q, poly)) &&
      !onFoot(q) &&
      !doorsAt.some((d) => Math.hypot(d[0] - q[0], d[1] - q[1]) < 1.2) &&
      !blocked.some((b) => Math.hypot(b[0] - q[0], b[1] - q[1]) < 0.8) &&
      // (apart from another way's or square's posts; a way's own are spaced by it, its pairs facing closer)
      !posts.some((b) => b.from !== from && Math.hypot(b.q[0] - q[0], b.q[1] - q[1]) < LAMPS.apart) &&
      !lanterns.some((b) => Math.hypot(b[0] - q[0], b[1] - q[1]) < 1.5) &&
      !levels.some((L) => L.rings.some((ring) => pointInPolygon(q, ring))) &&
      !inWater(q) &&
      !decks.some((c) => Math.hypot(c.at[0] - q[0], c.at[1] - q[1]) < (c.length ?? 2) / 2 + 1) &&
      !ways.some((w) => w !== own && distanceToPath(q, w.path) < (w.width ?? 0) / 2 + 0.15);
    // (a post at distance d along a line, off to one side of it by off; slid a little along the line when that place
    // is taken; its art's top, the lamp, toward the line)
    const post = (from, line, d, side, off, own = null, within = null) => {
      for (const s of SLIDE) {
        const at = pointAlong(line, d + s);
        if (!at) continue;
        const n = [-at.dir[1] * side, at.dir[0] * side], q = [at.p[0] + n[0] * off, at.p[1] + n[1] * off];
        if (!ok(q, from, own) || (within && !pointInPolygon(q, within))) continue;
        add("lamp-post", from, q, piece("lamp.post", q[0], q[1], deg(Math.atan2(-n[0], n[1])), r.int(8)));
        posts.push({ q, from });
        return true;
      }
      return false;
    };
    // (spaced evenly along a line of length len: count posts, the first half a space in)
    const spaced = (len, step) => { const n = Math.max(1, Math.round(len / step)), gap = len / n; return Array.from({ length: n }, (_, k) => gap * (k + 0.5)); };
    const lit = [...ways.filter((x) => LAMPS.classes.has(x.class)).map((w) => [w, LAMPS.step]), ...ways.filter((x) => LAMPS.lanes.has(x.class)).map((w) => [w, LAMPS.laneStep])];
    for (const [w, step] of lit) {
      const off = Math.max((w.width ?? 1) / 2 - LAMPS.curb, 0.3), first = r.chance(0.5) ? 1 : -1;
      const sides = w.class === "highway" || (w.width ?? 0) >= PAIRED ? [first, -first] : [first];
      for (const d of spaced(pathLength(w.path), step)) for (const sd of sides) post(w.id, w.path, d, sd, off, w);
    }
    // (then around each square: a post in from each corner and evenly along each side between, but none where a
    // street's post already stands close by)
    for (const sq of items.filter((i) => i.kind === "surface" && SQUARES.has(i.class) && Array.isArray(i.poly) && i.poly.length >= 3)) {
      const ring = [...sq.poly, sq.poly[0]];
      // (the side of each edge the square lies on, from the way its outline turns: its signed area)
      const area = sq.poly.reduce((a, v, i) => { const w = sq.poly[(i + 1) % sq.poly.length]; return a + v[0] * w[1] - w[0] * v[1]; }, 0), inside = area > 0 ? 1 : -1;
      for (let e = 0; e < sq.poly.length; e++) {
        const side = [ring[e], ring[e + 1]], len = pathLength(side);
        if (len < 1) continue;
        const n = Math.max(1, Math.ceil(len / LAMPS.squareStep));
        // (each corner once: at the start of the side it begins, in from it diagonally)
        for (let k = 0; k < n; k++) post(sq.from ?? sq.id, side, Math.max(len * (k / n), LAMPS.squareIn), inside, LAMPS.squareIn, null, sq.poly);
      }
    }
  }

  // A plan's own fires and lamps: lit where they stand
  for (const p of items.filter((i) => i.kind === "prop" && LIGHT_PROPS.includes(i.class))) {
    const cls = p.class === "lamp-post" ? "lamp-post" : p.class;
    add(cls, p.from ?? p.id, [p.x, p.y], piece(LIGHTS[cls].prop, p.x, p.y, p.rot ?? 0, p.variant ?? 0), `${p.id}/light`);
  }
  return out;
}

/**
 * The mist in a battle map's low places: [{ kind: "mist", id, at, size (squares across), rot, alpha, variant }]:
 * overlays along each stream's bed and over each pool, and in each hollow, lying on the map under the tokens; more and
 * thicker in fog.
 */
export function mistOf(items, seed, { fog = false } = {}) {
  const r = rng(seed ?? 1, "mist");
  const out = [];
  const add = (from, at, k) => out.push({ kind: "mist", id: `${from}/mist${k}`, from, at: [r3(at[0]), r3(at[1])], size: r3(7 * r.range(1, fog ? 2.2 : 1.8)), rot: r3(r.next() * 360), alpha: r3(r.range(fog ? 0.18 : 0.1, fog ? 0.32 : 0.24)), variant: r.int(8) });
  const step = fog ? 3 : 4.5;
  // Along each stream's bed (and a pool it fills)
  for (const L of items.filter((i) => i.kind === "level" && i.bed && !i.within)) {
    const w = items.find((i) => i.kind === "water" && i.id === L.water && Array.isArray(i.path));
    if (!w) continue;
    along(w.path, step).forEach(({ p }, k) => add(L.id, [p[0] + r.range(-0.6, 0.6), p[1] + r.range(-0.6, 0.6)], k + 1));
  }
  // Over each pool, and in each hollow (not one a pool fills): a few across it
  const filled = new Set(items.filter((i) => i.kind === "level" && i.within).map((i) => i.within));
  for (const L of items.filter((i) => i.kind === "level" && ((i.bed && i.within) || (!i.bed && i.elevation < 0 && !filled.has(i.id))))) {
    const ring = L.rings?.[0];
    if (!ring?.length) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    let k = 0;
    for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) {
      const q = [x + r.range(-1, 1), y + r.range(-1, 1)];
      if (pointInPolygon(q, ring)) add(L.id, q, ++k + 100);
    }
  }
  return out;
}

/** Points along a path every `step` squares (from `first` in), each with the way it runs there: [{ p, dir }]. */
function along(path, step, first = step / 2) {
  const out = [];
  let next = first, run = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!L) continue;
    const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    while (next <= run + L) { const t = next - run; out.push({ p: [a[0] + dir[0] * t, a[1] + dir[1] * t], dir }); next += step; }
    run += L;
  }
  return out;
}

function pathLength(path) {
  let L = 0;
  for (let i = 1; i < path.length; i++) L += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return L;
}

/** The point at distance d along a path, and the path's direction there: { p, dir }, or null past either end. */
function pointAlong(path, d) {
  if (d < 0) return null;
  let run = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!L) continue;
    if (d <= run + L) { const t = d - run, dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; return { p: [a[0] + dir[0] * t, a[1] + dir[1] * t], dir }; }
    run += L;
  }
  return null;
}

const r3 = (v) => Math.round(v * 1000) / 1000;
const deg = (a) => (a * 180) / Math.PI;
