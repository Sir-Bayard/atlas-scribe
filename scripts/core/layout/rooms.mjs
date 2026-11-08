/**
 * A battle map's interiors (M6 chunk 4): each building's rooms, laid out by a program from its use (Patrick, 7 Nov:
 * rooms by use, an inn's common room with its bar and stage, a kitchen, a storeroom), the walls between them with
 * doors on private rooms and open doorways between public ones, and furniture by recipe, each piece a tile the GM can
 * move (Patrick, 7 Nov).
 *
 * Rooms: the building's inside (its walls' inner face) is cut, as a guillotine cuts paper, square to its own frame,
 * into rooms of the program's shares, each at least ROOM.min squares across; the rooms that must meet the front door
 * stay on its side. Furniture: each room's recipe (a bed against a wall away from the door, a hearth on an outside wall,
 * the ground before every door kept clear and a way left between the doors), to about a third of its floor. Pure: no
 * Foundry.
 */
import { intersect, difference, area, offset, signedArea } from "../lots/poly.mjs";
import { pointInPolygon, polygonsOverlap, spansAt } from "../geom.mjs";
import { rng } from "../rng.mjs";

/**
 * Sizes in squares: a room's least width, an inner wall's thickness, a door's width and an open doorway's, the ground
 * kept clear before a door, a way's half width between pieces, a door's least distance from a corner. most: the most
 * rooms a plan may name for one building (more are left out, with a note).
 */
export const ROOM = { min: 3, wall: 0.2, door: 1, opening: 1.2, doorClear: 1.2, lane: 0.45, cornerKeep: 0.4, most: 8 };

/**
 * Room kinds: what the window and the plan call each (`words`, the first is its name), its floor, whether it's private
 * (a door to it, rather than an open doorway), and for a program a plan gives: its share of the floor beside the others
 * (weight, 1 unless said), where it goes (a kitchen at the back door) and what it has unless said (a common room's bar).
 */
export const ROOMS = {
  hall: { words: ["hall", "living room", "main room"], floor: "wood", weight: 2, features: ["hearth"] },
  common: { words: ["common room", "taproom", "tavern", "bar room"], floor: "wood", weight: 3.5, features: ["bar", "hearth"] },
  kitchen: { words: ["kitchen"], floor: "stone", weight: 1.3, place: "back" },
  bedroom: { words: ["bedroom", "private room", "guest room"], floor: "wood", private: true },
  store: { words: ["storeroom", "store", "pantry", "cellar"], floor: "stone", private: true, weight: 0.8 },
  office: { words: ["office", "study"], floor: "wood", private: true },
  workroom: { words: ["workshop", "workroom"], floor: "wood", weight: 2 },
  forge: { words: ["forge"], floor: "stone", weight: 2 },
  shop: { words: ["shop", "shopfront", "counter room"], floor: "wood", weight: 2 },
  nave: { words: ["nave", "chapel", "sanctuary"], floor: "stone", weight: 4 },
  vestry: { words: ["vestry", "sacristy"], floor: "stone", private: true },
  bunks: { words: ["bunk room", "bunks", "dormitory"], floor: "wood", weight: 2 },
  mess: { words: ["mess hall", "mess"], floor: "wood", weight: 1.5 },
  armory: { words: ["armory"], floor: "stone", private: true },
  stalls: { words: ["stalls", "stable"], floor: "dirt" },
  storage: { words: ["storage"], floor: "wood", weight: 3 },
  dining: { words: ["dining room", "dining hall"], floor: "wood", weight: 1.5 },
};
/** What a room can have beside its kind's own furniture, said in a program ("common room with stage"). */
export const ROOM_FEATURES = ["stage", "bar", "hearth", "bed"];
const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, a: 1, an: 1 };

/**
 * Reads a program a plan gives ("common room with stage, kitchen, 2 bedrooms, storeroom", or a list of such): its
 * rooms in order, { kind, features }, and the words it couldn't read. "and" joins rooms ("kitchen and storeroom") or,
 * after "with", a room's features ("common room with a stage and a bar").
 */
export function parseRooms(given) {
  const parts0 = (Array.isArray(given) ? given : String(given ?? "").split(/[,;\n]+/)).map((s) => String(s).toLowerCase().replace(/\s+/g, " ").trim()).filter(Boolean);
  const feature = (w) => ROOM_FEATURES.includes(w.replace(/^(a|an|the)\s+/, "").replace(/s$/, ""));
  const parts = [];
  for (const p0 of parts0) {
    // (", and a bar" after a room with features is one more of them; ", and storeroom" one more room)
    const p = p0.replace(/^and\s+/, "");
    if (p !== p0 && parts.length && /\swith\s/.test(` ${parts.at(-1)} `) && feature(p)) { parts[parts.length - 1] += ` with ${p}`; continue; }
    const bits = p.split(/\s+and\s+/);
    let cur = bits[0];
    for (const bit of bits.slice(1)) {
      if (/\swith\s/.test(` ${cur} `) && feature(bit)) cur += ` with ${bit}`;
      else { parts.push(cur); cur = bit; }
    }
    parts.push(cur);
  }
  const rooms = [], unknown = [];
  for (const part0 of parts) {
    let part = part0;
    let n = 1;
    const m = part.match(/^(\d+|one|two|three|four|five|six|seven|eight|a|an)\s+(.*)$/);
    if (m) { n = Math.min(8, Number(m[1]) || NUMBERS[m[1]] || 1); part = m[2]; }
    const [head, ...withs] = part.split(/\s+with\s+/);
    const features = new Set(withs.join(" ").split(/\s+/).map((w) => w.replace(/s$/, "")).filter((w) => ROOM_FEATURES.includes(w)));
    const noun = head.replace(/ies$/, "y").replace(/s$/, "");
    const kind = Object.keys(ROOMS).find((k) => ROOMS[k].words.some((w) => w === head || w === noun || w.replace(/s$/, "") === noun));
    if (!kind) { unknown.push(part0); continue; }
    for (let i = 0; i < n; i++) rooms.push({ kind, features: new Set(features) });
  }
  return { rooms, unknown };
}

const P = (kind, share, place = "any", features = []) => ({ kind, share, place, features: new Set(features) });
const TRADE_SMITH = new Set(["smithy", "farrier", "gunsmith"]);
const TRADE_SHOP = new Set(["shop", "bakery", "butcher", "alchemist", "magic-shop"]);
const TRADE_LIST = ["tannery", "dyeworks", "fullery", "pottery", "brickworks", "carpenter", "cooper", "wheelwright", "brewery", "laboratory", "inventor"];
const STORAGE_USES = new Set(["warehouse", "store", "customs", "market-hall", "windmill", "watermill"]);

/**
 * A use's program for an inside of `a` square squares: rooms in order of importance (the last dropped first when they
 * don't fit), each with its share of the floor and where it goes (front: meets the front door; back: the back).
 */
export function programFor(use, a) {
  const u = use ?? "house";
  if (u === "shed") return [P("storage", 1)];
  if (u === "stable") return [P("stalls", 1)];
  if (u === "tomb") return [];
  if (u === "inn") {
    if (a < 60) return [P("common", 0.7, "front", ["bar", "hearth"]), P("kitchen", 0.3, "back")];
    if (a < 110) return [P("common", 0.6, "front", ["bar", "hearth"]), P("kitchen", 0.25, "back"), P("store", 0.15)];
    return [P("common", 0.55, "front", ["bar", "hearth", "stage"]), P("kitchen", 0.2, "back"), P("bedroom", 0.13), P("store", 0.12)];
  }
  if (TRADE_SMITH.has(u)) return a < 45 ? [P("forge", 1, "front")] : [P("forge", 0.7, "front"), P("store", 0.3)];
  if (TRADE_SHOP.has(u)) {
    if (a < 40) return [P("shop", 1, "front")];
    if (a < 80) return [P("shop", 0.6, "front"), P("store", 0.4, "back")];
    return [P("shop", 0.45, "front"), P("hall", 0.35, "back", ["hearth", "bed"]), P("store", 0.2)];
  }
  if (u === "temple" || u === "chapel" || u === "shrine") return a < 60 || u === "shrine" ? [P("nave", 1, "front")] : [P("nave", 0.8, "front"), P("vestry", 0.2, "back")];
  if (STORAGE_USES.has(u)) return a < 40 ? [P("storage", 1, "front")] : [P("storage", 0.85, "front"), P("office", 0.15)];
  if (u === "barracks") return [P("bunks", 0.5, "front"), P("mess", 0.3), P("armory", 0.2)];
  if (u === "armory") return [P("armory", 1, "front")];
  if (u === "keep" || u === "watch") return a < 50 ? [P("armory", 1, "front")] : [P("hall", 0.6, "front", ["hearth"]), P("armory", 0.4)];
  if (u === "mansion" || u === "palace") return [P("hall", 0.3, "front", ["hearth"]), P("dining", 0.2), P("kitchen", 0.2, "back"), P("bedroom", 0.15), P("office", 0.15)];
  if (u === "guildhall") return [P("hall", 0.6, "front", ["hearth"]), P("office", 0.2), P("store", 0.2)];
  if (u === "workshop" || TRADE_LIST.includes(u)) {
    if (a < 40) return [P("workroom", 1, "front")];
    if (a < 80) return [P("workroom", 0.65, "front"), P("store", 0.35)];
    return [P("workroom", 0.5, "front"), P("hall", 0.3, "back", ["hearth", "bed"]), P("store", 0.2)];
  }
  // A house: one room under about 28 square squares, then a hall and a bedroom, then a kitchen too, then two bedrooms
  if (a < 28) return [P("hall", 1, "front", ["hearth", "bed"])];
  if (a < 55) return [P("hall", 0.6, "front", ["hearth"]), P("bedroom", 0.4, "back")];
  if (a < 100) return [P("hall", 0.45, "front"), P("kitchen", 0.3, "back"), P("bedroom", 0.25)];
  return [P("hall", 0.35, "front"), P("kitchen", 0.25, "back"), P("bedroom", 0.2), P("bedroom", 0.2)];
}

/**
 * Furniture, each piece a tile the GM can move (Patrick, 7 Nov: grouped as the art groups it, a bed made up, a table
 * with its chairs and what's on it). size: its art in squares [across, deep] as the art lies (the files are 200 px a
 * square); body: the part that's drawn, as big as it is in any of its files, which the layout sets flush against a wall
 * and keeps clear of doors and other pieces; back: the side of the art that goes against a wall (top unless said; none
 * for a piece that stands free); floor: a rug, under the rest; drawn: painted into the map (a stage).
 */
export const FURNITURE = {
  hearth: { size: [1, 2], body: [0.6, 1.3], back: "left" },
  "hearth.large": { size: [2, 2], body: [1.1, 1.3], back: "left" },
  oven: { size: [2, 2], body: [1.78, 1.05] },
  bed: { size: [2, 2], body: [1.5, 1.68] },
  "bed.single": { size: [1, 2], body: [1, 1.68] },
  "table.round": { size: [2, 2], body: [1.9, 1.9], back: "none" },
  "table.square": { size: [2, 2], body: [1.9, 2], back: "none" },
  "table.long": { size: [4, 2], body: [3.6, 1.96], back: "none" },
  "table.work": { size: [2, 1], body: [1.56, 0.9] },
  desk: { size: [2, 1], body: [1.56, 0.8] },
  chair: { size: [1, 1], body: [0.6, 0.64] },
  stool: { size: [1, 1], body: [0.46, 0.46], back: "none" },
  bench: { size: [2, 1], body: [1.56, 0.6] },
  pew: { size: [2, 1], body: [1.6, 0.4] },
  altar: { size: [2, 1], body: [1.76, 0.9] },
  // (a bar's art fades out at its left end, which runs into a wall at a corner)
  bar: { size: [3, 1], body: [1.86, 0.76], end: true },
  "bar.long": { size: [5, 1], body: [3.36, 0.76], end: true },
  shelf: { size: [2, 1], body: [1.56, 0.52] },
  "shelf.goods": { size: [2, 1], body: [1.92, 0.78] },
  wardrobe: { size: [2, 1], body: [1.6, 0.68] },
  chest: { size: [1, 1], body: [0.9, 0.5] },
  crate: { size: [1, 1], body: [1, 1] },
  barrel: { size: [1, 1], body: [0.82, 0.82], back: "none" },
  rug: { size: [4, 3], body: [3.16, 2.12], floor: true, back: "none" },
  forge: { size: [2, 2], body: [1.28, 1.6] },
  anvil: { size: [1, 1], body: [0.5, 0.84], back: "none" },
  quench: { size: [1, 2], body: [0.36, 1.26], back: "left" },
  hay: { size: [2, 2], body: [1.9, 1.62] },
  trough: { size: [2, 1], body: [1.98, 0.58] },
  "weapon.rack": { size: [1, 2], body: [0.32, 1.94], back: "left" },
  "armor.stand": { size: [1, 1], body: [0.64, 0.3] },
  stage: { size: [4, 2], body: [4, 2], drawn: true },
  "stage.small": { size: [3, 2], body: [3, 2], drawn: true },
};

/**
 * Where a piece's art goes on the map, given its file's drawn part (insets [left, top, right, bottom] from the art's
 * edges, as shares of its width and height): its art's center, size and turn, so the drawn part's back meets the
 * body's back (flush to its wall) and it's centered across; a free piece's drawn part centered on its body.
 */
export function artPlacement(p, insets = [0, 0, 0, 0]) {
  const F = FURNITURE[p.f] ?? { size: [1, 1], body: [1, 1] };
  const [aw, ah] = F.size, [bw, bh] = F.body;
  const [l, t, r, b] = [insets[0] * aw, insets[1] * ah, insets[2] * aw, insets[3] * ah];
  let dx = (r - l) / 2, dy = (b - t) / 2;
  if ((F.back ?? "top") === "top") dy = ah / 2 - t - bh / 2;
  else if (F.back === "left") dx = aw / 2 - l - bw / 2;
  const a = ((p.rot ?? 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return { x: p.x + dx * c - dy * s, y: p.y + dx * s + dy * c, w: aw, h: ah, rot: p.rot ?? 0 };
}

/**
 * Each room kind's recipe, in order of importance: a piece (`f`), how many (`n`), where (wall: against one; corner;
 * center; near another piece; at a bed's foot; before a desk; behind a bar; or a set: tables, pews in rows, a rug),
 * what wall it wants (outside, inside, away from the door, the far end, a short end wall), `alt` stand-ins when it
 * won't fit, `when` a feature the room must have (a hearth) and `min` the least floor. Then each room is filled out
 * with its kind's `fill` pieces along the walls, to its share of the floor (`cover`), so it looks lived in.
 */
const RECIPES = {
  hall: { cover: 0.32, fill: ["chest", "barrel", "crate", "shelf", "stool"], steps: [
    { f: "hearth.large", at: "wall", want: "end", when: "hearth", min: 36, alt: [{ f: "hearth" }] },
    { f: "bed", at: "wall", want: "away", when: "bed", alt: [{ f: "bed.single" }] },
    { f: "chest", at: "foot", of: ["bed", "bed.single"] },
    { f: "table.square", at: "center", alt: [{ f: "table.round" }] },
    { f: "rug", at: "rug", min: 18 },
    { f: "shelf", at: "wall" }, { f: "barrel", at: "corner" }] },
  common: { cover: 0.34, fill: ["barrel", "bench", "stool", "crate"], steps: [
    { f: "stage", at: "wall", want: "far", when: "stage", alt: [{ f: "stage.small" }] },
    { f: "bar.long", at: "bar", when: "bar", min: 50, alt: [{ f: "bar" }] },
    { f: "barrel", at: "behind", n: 2 }, { f: "shelf.goods", at: "behind" },
    { f: "hearth.large", at: "wall", want: "end", when: "hearth", alt: [{ f: "hearth" }] },
    { f: "table.round", at: "tables", alt: [{ f: "table.square" }] },
    { f: "bench", at: "wall", n: 2 }, { f: "barrel", at: "corner", n: 2 }] },
  kitchen: { cover: 0.36, fill: ["barrel", "crate", "shelf.goods", "chest"], steps: [
    { f: "oven", at: "wall", want: "end", alt: [{ f: "hearth" }] },
    { f: "table.work", at: "center", alt: [{ at: "wall" }] },
    { f: "shelf.goods", at: "wall", n: 2 }, { f: "barrel", at: "corner", n: 2 }, { f: "crate", at: "corner" }] },
  bedroom: { cover: 0.3, fill: ["chest", "stool", "shelf"], steps: [
    { f: "bed", at: "wall", want: "away", alt: [{ f: "bed.single" }] },
    { f: "chest", at: "foot", of: ["bed", "bed.single"] },
    { f: "wardrobe", at: "wall" }, { f: "rug", at: "rug", min: 14 }, { f: "chair", at: "corner" }] },
  store: { cover: 0.5, fill: ["crate", "barrel", "crate", "shelf.goods"], steps: [] },
  office: { cover: 0.3, fill: ["chest", "shelf"], steps: [
    { f: "desk", at: "wall", want: "outside" }, { f: "chair", at: "seat", of: "desk" },
    { f: "shelf", at: "wall", n: 2 }, { f: "rug", at: "rug", min: 14 }] },
  workroom: { cover: 0.36, fill: ["crate", "barrel", "shelf.goods", "chest"], steps: [
    { f: "table.work", at: "center", alt: [{ at: "wall" }] }, { f: "table.work", at: "wall" },
    { f: "stool", at: "seat", of: "table.work" }, { f: "shelf.goods", at: "wall" }, { f: "crate", at: "corner", n: 2 }] },
  forge: { cover: 0.3, fill: ["crate", "barrel", "chest"], steps: [
    { f: "forge", at: "wall", want: "outside" }, { f: "anvil", at: "near", of: "forge" }, { f: "quench", at: "near", of: "anvil" },
    { f: "weapon.rack", at: "wall" }, { f: "table.work", at: "wall" }, { f: "barrel", at: "corner" }] },
  shop: { cover: 0.34, fill: ["crate", "barrel", "chest"], steps: [
    { f: "shelf.goods", at: "wall", want: "far", n: 2 }, { f: "bar", at: "counter" }, { f: "crate", at: "corner", n: 2 }] },
  nave: { cover: 0, fill: [], steps: [{ f: "altar", at: "wall", want: "far-end", centered: true }, { f: "pew", at: "pews" }] },
  vestry: { cover: 0.3, fill: ["chest", "shelf"], steps: [
    { f: "wardrobe", at: "wall" }, { f: "desk", at: "wall" }, { f: "chair", at: "seat", of: "desk" }, { f: "chest", at: "wall" }] },
  bunks: { cover: 0.36, fill: ["chest"], steps: [{ f: "bed.single", at: "wall", n: 10 }, { f: "chest", at: "foot", of: "bed.single", n: 10 }] },
  mess: { cover: 0.3, fill: ["barrel", "bench"], steps: [{ f: "table.long", at: "center", n: 2 }, { f: "barrel", at: "corner" }] },
  armory: { cover: 0.34, fill: ["chest", "crate"], steps: [{ f: "weapon.rack", at: "wall", n: 6 }, { f: "armor.stand", at: "corner", n: 3 }] },
  stalls: { cover: 0.25, fill: ["hay", "barrel"], steps: [{ f: "hay", at: "corner", n: 2 }, { f: "trough", at: "wall", n: 2 }] },
  storage: { cover: 0.45, fill: ["crate", "barrel", "crate"], steps: [] },
  dining: { cover: 0.3, fill: ["chest", "shelf", "barrel"], steps: [
    { f: "table.long", at: "center", alt: [{ f: "table.square" }] }, { f: "rug", at: "rug", min: 16 },
    { f: "hearth.large", at: "wall", want: "end", alt: [{ f: "hearth" }] }, { f: "wardrobe", at: "wall" }] },
};

// Geometry in a building's own frame (x along its main part, y across it), turned back to the map at the end
const turn = ([x, y], c, s) => [x * c - y * s, x * s + y * c];
const bbOf = (poly) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return [x0, y0, x1, y1]; };
const BIG = 1e5;
const halfPlane = (axis, c, low) => axis === 0
  ? (low ? [[-BIG, -BIG], [c, -BIG], [c, BIG], [-BIG, BIG]] : [[c, -BIG], [BIG, -BIG], [BIG, BIG], [c, BIG]])
  : (low ? [[-BIG, -BIG], [BIG, -BIG], [BIG, c], [-BIG, c]] : [[-BIG, c], [BIG, c], [BIG, BIG], [-BIG, BIG]]);
const sideOf = (poly, axis, c, low) => intersect([poly], [halfPlane(axis, c, low)]).filter((p) => area(p) > 1e-6);

/** Whether a piece is big enough for a room: at least ROOM.min across its frame box both ways and most of that box filled. */
function roomy(poly) {
  const [x0, y0, x1, y1] = bbOf(poly), w = x1 - x0, h = y1 - y0;
  return w >= ROOM.min - 1e-6 && h >= ROOM.min - 1e-6 && area(poly) >= 0.55 * w * h;
}

/**
 * Cuts a piece (in the frame) into rooms, in the program's order (each cut splits it between the rooms before a point
 * in that order and those after, either side low, where the low side holds its rooms' share of the floor): the ways
 * tried (up to a budget), the best kept, { rooms: [{ poly, room }], cuts: [{ axis, c, poly }], score }, or null when
 * they don't fit. doors: the building's outside doors (in the frame); only the first cut's ways are scored for them
 * (doorScore), the pieces below it by their rooms' shapes alone. memo: the work shared down the tree (and its
 * openings: the outside wall's doors and windows, which no cut meets, clearOf).
 */
/** How many pieces divide works out for one layout of a building at most (see divide). */
const DIVIDE_BUDGET = 4000;
function divide(poly, rooms, doors = null, memo = new Map()) {
  if (rooms.length === 1) return roomy(poly) || rooms[0].fits ? { rooms: [{ poly, room: rooms[0] }], cuts: [], score: shapeScore(poly) } : null;
  // (the same piece with the same rooms comes up again and again down the tree: worked out once)
  const key = doors ? null : `${rooms.map((x) => x.n).join(",")}|${poly.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(";")}`;
  if (key && memo.has(key)) return memo.get(key);
  // (a building with many rooms has more ways to cut than there's time to try: past a budget, no more are tried, the
  // likeliest, tried first, having found one already)
  memo.calls = (memo.calls ?? 0) + 1;
  if (!doors && memo.calls > DIVIDE_BUDGET) return null;
  const [x0, y0, x1, y1] = bbOf(poly), total = area(poly), boxy = total >= (x1 - x0) * (y1 - y0) * (1 - 1e-3);
  const sum = rooms.reduce((s, r) => s + r.share, 0);
  const ks = rooms.slice(1).map((_, i) => i + 1).sort((a, b) => Math.abs(rooms.slice(0, a).reduce((s, r) => s + r.share, 0) / sum - 0.5) - Math.abs(rooms.slice(0, b).reduce((s, r) => s + r.share, 0) / sum - 0.5));
  let best = null;
  for (const axis of (x1 - x0 >= y1 - y0 ? [0, 1] : [1, 0])) {
    const lo = axis === 0 ? x0 : y0, hi = axis === 0 ? x1 : y1;
    if (hi - lo < 2 * ROOM.min) continue;
    // (cutting across the piece's long way is better)
    const across = (axis === 0 ? x1 - x0 : y1 - y0) >= (axis === 0 ? y1 - y0 : x1 - x0) ? 0 : 1.5;
    for (const k of ks) for (const firstLow of [true, false]) {
      const lowRooms = firstLow ? rooms.slice(0, k) : rooms.slice(k), highRooms = firstLow ? rooms.slice(k) : rooms.slice(0, k);
      const share = lowRooms.reduce((s, r) => s + r.share, 0) / sum;
      // (where the low side holds that share: straight off a rectangle, else by halving; no nearer a side than a room's
      // least width; then moved off the building's doors and windows, so no inner wall meets one)
      let a = lo, b = hi;
      if (boxy) a = b = lo + share * (hi - lo);
      else for (let i = 0; i < 14; i++) { const c = (a + b) / 2; const la = sideOf(poly, axis, c, true).reduce((s, p) => s + area(p), 0); if (la / total < share) a = c; else b = c; }
      // (a cut near a corner of the piece's outline, where a wing meets it, goes on that corner's line: no sliver of a
      // room between them)
      let c0 = Math.min(hi - ROOM.min - 0.01, Math.max(lo + ROOM.min + 0.01, (a + b) / 2));
      const corner = poly.map((p) => p[axis]).filter((v) => v > lo + 1e-6 && v < hi - 1e-6 && v >= lo + ROOM.min && v <= hi - ROOM.min && Math.abs(v - c0) < 0.4).sort((u, v) => Math.abs(u - c0) - Math.abs(v - c0))[0];
      if (corner != null) c0 = corner;
      const c = clearOf(c0, axis, lo + ROOM.min, hi - ROOM.min, memo.openings, axis === 0 ? [y0, y1] : [x0, x1]);
      if (c == null) continue;
      const low = sideOf(poly, axis, c, true), high = sideOf(poly, axis, c, false);
      if (low.length !== 1 || high.length !== 1 || !roomy(low[0]) || !roomy(high[0])) continue;
      const A = divide(low[0], lowRooms, null, memo), B = A && divide(high[0], highRooms, null, memo);
      if (!A || !B) continue;
      const laid = { rooms: [...A.rooms, ...B.rooms], cuts: [{ axis, c, poly }, ...A.cuts, ...B.cuts] };
      laid.score = A.score + B.score + across + (doors ? doorScore(laid, doors) : 0);
      if (!best || laid.score < best.score) best = laid;
    }
  }
  // (not kept when the budget ran out on the way: it may have missed a way that works)
  if (key && memo.calls <= DIVIDE_BUDGET) memo.set(key, best);
  return best;
}
/**
 * A cut's line moved the least it can (within lo..hi) so it meets none of the outside wall's doors and windows
 * (openings: [{ axis, a, b, pos }] each one's span along that axis, padded, and where its wall lies across it; only
 * those on the piece's own sides, across from..to, count), or null when it can't be.
 */
function clearOf(c, axis, lo, hi, openings, [from, to]) {
  const spans = (openings ?? []).filter((o) => o.axis === axis && o.pos >= from - 0.6 && o.pos <= to + 0.6);
  if (!spans.some((o) => c > o.a && c < o.b)) return c;
  const tries = spans.flatMap((o) => [o.a, o.b]).filter((t) => t >= lo && t <= hi && !spans.some((o) => t > o.a + 1e-9 && t < o.b - 1e-9));
  return tries.length ? tries.reduce((x, t) => (Math.abs(t - c) < Math.abs(x - c) ? t : x)) : null;
}
/** A room's shape's cost: more the farther it is from a square, past two to one. */
function shapeScore(poly) { const [a0, b0, a1, b1] = bbOf(poly); const d = Math.max(a1 - a0, b1 - b0) / Math.min(a1 - a0, b1 - b0); return Math.max(0, d - 2); }

/**
 * A layout's cost for its doors: the front door into a room that should meet it (the program's front room), the back
 * door into its back room (a kitchen), and no outside door into a private room.
 */
function doorScore(laid, doors) {
  let s = 0;
  for (const d of doors) {
    const into = laid.rooms.reduce((a, x) => (!a || dist(x.poly, d.at) < dist(a.poly, d.at) ? x : a), null);
    if (!into) continue;
    if (ROOMS[into.room.kind].private) s += 6;
    if (d.side === "front" && laid.rooms.some((x) => x.room.place === "front") && into.room.place !== "front") s += 10;
    if (d.side === "back" && laid.rooms.some((x) => x.room.place === "back") && into.room.place !== "back") s += 3;
  }
  return s;
}

/**
 * Lays a program in a piece: the rooms that fit, the least important dropped first, the first room never (alone, it
 * takes the whole piece). The program is tried as given and with its later rooms reordered, the best for the doors kept.
 */
function layRooms(poly, program, doors, openings = []) {
  let rooms = program.map((r, n) => ({ ...r, n }));
  while (rooms.length) {
    const orders = rooms.length >= 3 ? [rooms, [rooms[0], ...rooms.slice(1).reverse()], [...rooms.slice(1), rooms[0]]] : [rooms];
    const memo = Object.assign(new Map(), { openings });
    const out = orders.map((o) => { memo.calls = 0; return divide(poly, o, doors, memo); }).filter(Boolean).reduce((a, x) => (!a || x.score < a.score ? x : a), null);
    if (out) return out;
    if (rooms.length === 1) { rooms[0].fits = true; continue; }
    rooms = rooms.slice(0, -1);
  }
  return { rooms: [], cuts: [] };
}

/**
 * Every building's interior on a battle map, from its shell (buildingShells): items `interior` with rooms (kind,
 * poly, floor, private), walls between them (wall, door, opening; each runs on to the outer wall's middle line and over
 * an inner wall it meets) and furniture ({ f, x, y, rot, variant, against }: x, y its body's middle, against when it's
 * flush to a wall). seed: the plan's. Groups wholly round get no shell, so none; a group with a round part gets one,
 * its rooms cut from the whole outline. Courtyard pieces and buildings the map's edge cuts (closed) get none.
 */
export function buildingInteriors(items, seed) {
  const buildings = items.filter((i) => i.kind === "building");
  const byGroup = new Map();
  for (const b of buildings) { const k = b.group ?? b.id; if (!byGroup.has(k)) byGroup.set(k, []); byGroup.get(k).push(b); }
  let n = 0;
  for (const sh of items.filter((i) => i.kind === "shell" && Array.isArray(i.ring))) {
    if (sh.holes?.length || sh.closed) continue;
    const parts = byGroup.get(sh.group) ?? [];
    const main = parts.find((b) => b.main) ?? parts[0];
    if (!main) continue;
    const inner = offset([sh.ring], -sh.thickness / 2).reduce((a, p) => (!a || area(p) > area(a) ? p : a), null);
    if (!inner || area(inner) < ROOM.min * ROOM.min) continue;
    // (a building's rooms as its plan names them: its main part's, or any part's)
    const named = main.rooms ?? parts.find((b) => b.rooms)?.rooms;
    const given = named ? parseRooms(named).rooms.slice(0, ROOM.most).map((r, i) => P(r.kind, ROOMS[r.kind].weight ?? 1, i === 0 ? "front" : ROOMS[r.kind].place ?? "any", [...(ROOMS[r.kind].features ?? []), ...r.features])) : null;
    const program = given?.length ? given : programFor(sh.use, area(inner));
    if (!program.length) continue;
    const r = rng(seed ?? 0, "interior", sh.id);
    const th = ((main.rot ?? 0) * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
    const toFrame = (p) => turn(p, c, -s), toMap = (p) => turn(p, c, s);
    const framePoly = inner.map(toFrame);
    const doors = sh.walls.filter((w) => w.type === "door").map((w) => { const a = toFrame(w.a), b = toFrame(w.b), L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return { at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], w: L, u: [(b[0] - a[0]) / L, (b[1] - a[1]) / L], side: w.side, outside: true }; });
    const front = doors.find((d) => d.side === "front")?.at ?? null;
    // (the outside wall's doors and windows, which no cut may meet: each one's span along the wall, past its ends by
    // an inner wall's half thickness and a little)
    const pad = ROOM.wall / 2 + 0.15;
    const holes = sh.walls.filter((w) => w.type === "door" || w.type === "window").map((w) => { const a = toFrame(w.a), b = toFrame(w.b), along = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 0 : 1; return { axis: along, a: Math.min(a[along], b[along]) - pad, b: Math.max(a[along], b[along]) + pad, pos: (a[1 - along] + b[1 - along]) / 2 }; });
    const laid = layRooms(framePoly, program, doors, holes);
    if (!laid.rooms.length) continue;
    // Inner walls: each cut's line within its piece; their stretches between two rooms; a spanning tree of doors from
    // the front room, a door to a private room, an open doorway between public ones
    const rooms = laid.rooms.map((x, i) => ({ i, poly: x.poly, kind: x.room.kind, features: x.room.features, private: !!ROOMS[x.room.kind].private }));
    const roomAt = (p) => rooms.find((q) => pointInPolygon(p, q.poly));
    const stretches = [];
    // (where a cut's line, going on from t one way, meets the outer wall's line within most of a square: its t there)
    const ringF = sh.ring.map(toFrame);
    const ringHit = (cut, t, dir) => {
      let best = null;
      for (let i = 0; i < ringF.length; i++) {
        const a = ringF[i], b = ringF[(i + 1) % ringF.length];
        // (in the cut's own terms: across, the line's fixed coordinate; along, t)
        const [aa, at] = cut.axis === 0 ? [a[0], a[1]] : [a[1], a[0]], [ba, bt] = cut.axis === 0 ? [b[0], b[1]] : [b[1], b[0]];
        if ((aa - cut.c) * (ba - cut.c) > 0 || aa === ba) continue;
        const h = at + ((cut.c - aa) / (ba - aa)) * (bt - at), s = (h - t) * dir;
        if (s >= -0.05 && s <= 0.8 && (best == null || s < (best - t) * dir)) best = h;
      }
      return best;
    };
    const spansOf = (k) => spansAt(k.axis === 0 ? k.poly.map(([x, y]) => [y, x]) : k.poly, k.c);
    for (const cut of laid.cuts) {
      const swap = cut.axis === 0;
      const spans = spansAt(swap ? cut.poly.map(([x, y]) => [y, x]) : cut.poly, cut.c);
      for (const [t0, t1] of spans) {
        const P2 = (t) => (swap ? [cut.c, t] : [t, cut.c]);
        const nrm = swap ? [1, 0] : [0, 1];
        let cur = null;
        for (let t = t0 + 0.05; t <= t1 - 0.05 + 1e-9; t += 0.1) {
          const p = P2(t), A = roomAt([p[0] - nrm[0] * 0.2, p[1] - nrm[1] * 0.2]), B = roomAt([p[0] + nrm[0] * 0.2, p[1] + nrm[1] * 0.2]);
          const key = A && B && A !== B ? `${Math.min(A.i, B.i)}-${Math.max(A.i, B.i)}` : null;
          if (cur && cur.key === key) cur.t1 = t + 0.05;
          else { if (cur?.key) stretches.push(cur); cur = { key, A, B, t0: t - 0.05, t1: t + 0.05, P2, swap }; }
        }
        if (cur?.key) stretches.push(cur);
        // (each stretch's wall runs on past its ends: at the outer wall to its middle line, where that wall's own line
        // runs; at an inner wall across it to that wall's far face; so walls meet and leave no gap to see or slip through)
        // (the inner walls across this one that reach it: a cut of the other way whose line, within its own piece, runs
        // to this line or over it)
        const across = laid.cuts.filter((k) => k.axis !== cut.axis && spansOf(k).some(([a, b]) => cut.c >= a - 0.15 && cut.c <= b + 0.15)).map((k) => k.c);
        // (a stretch ends where the rooms either side change, the samples a tenth apart putting that within a twentieth
        // of its end: at an inner wall that runs across there, on past every one that close to its far face; else at
        // the span's end, on to the outer wall's own line, found where this line meets the ring (a wing's or a sloped
        // wall's too), a hair past it)
        const meet = (t0s, dir, end) => {
          const t = end ?? t0s;
          const near = across.filter((x) => Math.abs(x - t) < 0.07);
          if (near.length) return (dir > 0 ? Math.max(...near) : Math.min(...near)) + dir * ROOM.wall / 2;
          // (near a sloped or round wall the rooms run out before the span does: the ring is looked for anyway)
          const hit = ringHit(cut, t, dir);
          return hit != null ? hit + dir * 0.02 : { free: t + dir * (ROOM.wall / 2 + 0.05) };
        };
        for (const st of stretches.filter((x) => x.P2 === P2)) {
          for (const [k, t, dir, end] of [[0, st.t0, -1, st.t0 <= t0 + 0.11 ? t0 : null], [1, st.t1, 1, st.t1 >= t1 - 0.11 ? t1 : null]]) {
            const e = meet(t, dir, end);
            st[`e${k}`] = typeof e === "number" ? e : e.free;
            // (an end that meets neither, beside a wing's corner or a round part's curve: joined to the ring's nearest
            // point, below)
            if (typeof e !== "number") st[`free${k}`] = true;
          }
        }
      }
    }
    const frontRoom = front ? rooms.reduce((a, q) => (dist(q.poly, front) < dist(a.poly, front) ? q : a)) : rooms[0];
    const reached = new Set([frontRoom.i]);
    const doorsIn = [];
    for (let grew = true; grew; ) {
      grew = false;
      const next = stretches.filter((st) => reached.has(st.A.i) !== reached.has(st.B.i) && st.t1 - st.t0 >= ROOM.door + 2 * ROOM.cornerKeep).sort((a, b) => b.t1 - b.t0 - (a.t1 - a.t0))[0];
      if (next) {
        const priv = next.A.private || next.B.private;
        const w = priv ? ROOM.door : ROOM.opening;
        const room = next.t1 - next.t0 - w - 2 * ROOM.cornerKeep;
        const t = (next.t0 + next.t1) / 2 + (r.next() - 0.5) * Math.max(0, room) * 0.6;
        doorsIn.push({ stretch: next, t, w, type: priv ? "door" : "opening" });
        reached.add(next.A.i); reached.add(next.B.i);
        grew = true;
      }
    }
    // The walls as segments (in the frame), gaps at the doors
    const walls = [];
    for (const st of stretches) {
      const gaps = doorsIn.filter((d) => d.stretch === st).map((d) => [d.t - d.w / 2, d.t + d.w / 2, d.type]).sort((a, b) => a[0] - b[0]);
      let t = st.e0;
      for (const [g0, g1, type] of gaps) {
        if (g0 > t + 1e-6) walls.push({ type: "wall", a: st.P2(t), b: st.P2(g0) });
        walls.push({ type, a: st.P2(g0), b: st.P2(g1) });
        t = g1;
      }
      if (st.e1 > t + 1e-6) walls.push({ type: "wall", a: st.P2(t), b: st.P2(st.e1) });
      // (a free end joined to the outer wall's line where that's within half a square: a short wall the scene gets but
      // the map doesn't paint, the outer wall's art covering it)
      for (const k of [0, 1]) if (st[`free${k}`]) {
        const p = st.P2(st[`e${k}`]);
        let best = null, bd = 0.5;
        for (let i = 0; i < ringF.length; i++) { const q = nearestOn(p, ringF[i], ringF[(i + 1) % ringF.length]), d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = q; } }
        if (best && bd > 1e-3) walls.push({ type: "wall", a: p, b: best, join: true });
      }
    }
    // Furniture, room by room
    const furniture = [];
    for (const q of rooms) {
      const openings = [
        ...doors.filter((d) => roomAt(d.at) === q || dist(q.poly, d.at) < 0.3).map((d) => ({ at: d.at, w: d.w, u: d.u, outside: true })),
        ...doorsIn.filter((d) => d.stretch.A === q || d.stretch.B === q).map((d) => ({ at: d.stretch.P2(d.t), w: d.w, u: d.stretch.swap ? [0, 1] : [1, 0] })),
      ];
      // (its floor: the room less half of each inner wall along it; its outer walls' inner face is its edge already)
      const bands = stretches.filter((st) => st.A === q || st.B === q).map((st) => { const a = st.P2(st.t0), b = st.P2(st.t1), u = st.swap ? [0, 1] : [1, 0]; return boxAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, st.t1 - st.t0 + 0.4, ROOM.wall, u, [-u[1], u[0]]); });
      const floor = (bands.length ? difference([q.poly], bands) : [q.poly]).reduce((a, p) => (!a || area(p) > area(a) ? p : a), null);
      if (floor && area(floor) > 1) furnish(q, tidyRing(floor), openings, framePoly, r.fork("room", q.i), furniture);
    }
    items.push({
      kind: "interior", id: `${sh.id}/interior`, from: sh.from, group: sh.group, use: sh.use,
      rooms: rooms.map((q) => ({ kind: q.kind, poly: q.poly.map(toMap), floor: ROOMS[q.kind].floor, private: q.private })),
      walls: walls.map((w) => ({ ...w, a: toMap(w.a), b: toMap(w.b) })),
      thickness: ROOM.wall, material: sh.material,
      furniture: furniture.map((f) => ({ ...f, ...(() => { const [x, y] = toMap([f.x, f.y]); return { x, y }; })(), rot: f.rot + (main.rot ?? 0) })),
    });
    n++;
  }
  return n;
}
/** A ring without its points that lie on a straight line (a cut leaves some). */
const tidyRing = (ring) => ring.filter((p, i) => { const a = ring[(i - 1 + ring.length) % ring.length], c = ring[(i + 1) % ring.length]; return Math.abs((p[0] - a[0]) * (c[1] - a[1]) - (p[1] - a[1]) * (c[0] - a[0])) > 1e-5; });
const dist = (poly, p) => (pointInPolygon(p, poly) ? 0 : Math.min(...poly.map((a, i) => segDist(p, a, poly[(i + 1) % poly.length]))));
/** The nearest point to p on the segment a to b. */
function nearestOn([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
  return [ax + t * dx, ay + t * dy];
}
function segDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/**
 * A room's furniture by its recipe (in the frame). q: the room (kind, features); room: its floor (inside its walls). openings: [{ at, w, u,
 * outside }] its doors and doorways: the ground before each is kept clear, and a way left between them. Each piece is
 * a { f, x, y, rot, variant, against } (x, y its body's middle; against when it's set flush to a wall) pushed to out.
 */
function furnish(q, room, openings, buildingPoly, r, out) {
  const [x0, y0, x1, y1] = bbOf(room), roomArea = area(room);
  const recipe = RECIPES[q.kind] ?? { cover: 0.3, fill: ["chest"], steps: [] };
  const placed = [];
  // (a door's clear ground: a box before it as wide as it and a little more, a door's swing deep, either side of its wall)
  const keep = openings.map(({ at, w, u }) => boxAt(at[0], at[1], w + 0.6, 2 * ROOM.doorClear, u, [-u[1], u[0]]));
  // (a way through from the room's widest way in, its outside door if it has one, to each of its other doors: on a
  // grid of quarter squares, each cell clear by a lane's half width of every piece)
  const hub = openings.reduce((a, o) => (!a || o.outside && !a.outside || o.w > a.w && !!o.outside === !!a.outside ? o : a), null);
  const G = 0.25, NX = Math.max(1, Math.ceil((x1 - x0) / G)), NY = Math.max(1, Math.ceil((y1 - y0) / G));
  const cellIn = new Uint8Array(NX * NY);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) cellIn[j * NX + i] = pointInPolygon([x0 + (i + 0.5) * G, y0 + (j + 0.5) * G], room) ? 1 : 0;
  const cellOf = ([x, y]) => [Math.min(NX - 1, Math.max(0, Math.floor((x - x0) / G))), Math.min(NY - 1, Math.max(0, Math.floor((y - y0) / G)))];
  const throughOK = (extra) => {
    if (openings.length < 2) return true;
    const free = cellIn.slice();
    // (each piece blocks the cells within its box that it covers)
    for (const w of [...placed.filter((p) => !FURNITURE[p.f].floor).map((p) => p.wide), extra]) {
      const [a0, b0, a1, b1] = bbOf(w);
      const [i0, j0] = cellOf([a0, b0]), [i1, j1] = cellOf([a1, b1]);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (free[j * NX + i] && pointInPolygon([x0 + (i + 0.5) * G, y0 + (j + 0.5) * G], w)) free[j * NX + i] = 0;
    }
    // (each door's cell: the nearest free one to it, within a square)
    const start = (at) => { const [ci, cj] = cellOf(at); let best = -1, bd = Infinity; for (let j = Math.max(0, cj - 4); j <= Math.min(NY - 1, cj + 4); j++) for (let i = Math.max(0, ci - 4); i <= Math.min(NX - 1, ci + 4); i++) { const d = (i - ci) ** 2 + (j - cj) ** 2; if (free[j * NX + i] && d < bd) { bd = d; best = j * NX + i; } } return best; };
    const s0 = start(hub.at);
    if (s0 < 0) return false;
    const seen = new Uint8Array(NX * NY), queue = [s0];
    seen[s0] = 1;
    while (queue.length) { const c = queue.pop(), i = c % NX, j = (c - i) / NX; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= NX || b >= NY) continue; const k = b * NX + a; if (!seen[k] && free[k]) { seen[k] = 1; queue.push(k); } } }
    return openings.every((o) => { const k = start(o.at); return k >= 0 && seen[k]; });
  };
  // (a piece fits inside the room, clear of the others and of the doors' ground, and leaves a way between the doors)
  // (a piece's box grown by a lane's half width on every side: each corner out along both its sides)
  const widen = (poly) => poly.map((p, i) => {
    const a = poly[(i + poly.length - 1) % poly.length], b = poly[(i + 1) % poly.length];
    const ua = [p[0] - a[0], p[1] - a[1]], ub = [p[0] - b[0], p[1] - b[1]], la = Math.hypot(...ua) || 1, lb = Math.hypot(...ub) || 1;
    return [p[0] + ROOM.lane * (ua[0] / la + ub[0] / lb), p[1] + ROOM.lane * (ua[1] / la + ub[1] / lb)];
  });
  const inside = (poly) => poly.every((p) => pointInPolygon(p, room));
  const fits = (poly) => inside(poly) && !placed.some((p) => !FURNITURE[p.f].floor && polygonsOverlap(p.poly, poly)) && !keep.some((k) => polygonsOverlap(k, poly)) && throughOK(widen(poly));
  const covered = () => placed.reduce((s, p) => s + (FURNITURE[p.f].floor ? 0 : FURNITURE[p.f].body[0] * FURNITURE[p.f].body[1]), 0) / roomArea;
  // (against: set flush to a wall)
  const put = (f, w, extra = {}) => { const item = { f, x: w.x, y: w.y, rot: w.rot, variant: r.int(12), poly: w.poly, wide: widen(w.poly), ...extra }; placed.push(item); out.push({ f, x: w.x, y: w.y, rot: w.rot, variant: item.variant, ...(extra.wall && !extra.wall.gap ? { against: true } : {}) }); return item; };
  const sgn = Math.sign(signedArea(room));
  const edges = room.map((a, i) => {
    const b = room[(i + 1) % room.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const n = sgn > 0 ? [-u[1], u[0]] : [u[1], -u[0]]; // inward
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const outside = !pointInPolygon([mid[0] - n[0] * 0.6, mid[1] - n[1] * 0.6], buildingPoly);
    const doorNear = openings.length ? Math.min(...openings.map((o) => Math.hypot(o.at[0] - mid[0], o.at[1] - mid[1]))) : 0;
    return { a, b, L, u, n, mid, outside, doorNear };
  }).filter((e) => e.L >= 0.5);
  /** A piece's body against wall e, its middle t along it, gap squares out from it: { x, y, rot, poly, along, deep }. */
  const onWall = (f, e, t, gap = 0) => {
    const F = FURNITURE[f], [bw, bh] = F.body, sideways = F.back === "left";
    const along = sideways ? bh : bw, deep = sideways ? bw : bh;
    const x = e.a[0] + e.u[0] * t + e.n[0] * (deep / 2 + 0.01 + gap), y = e.a[1] + e.u[1] * t + e.n[1] * (deep / 2 + 0.01 + gap);
    const rot = sideways ? deg(Math.atan2(e.n[1], e.n[0])) : deg(Math.atan2(-e.n[0], e.n[1]));
    return { x, y, rot, poly: boxAt(x, y, along, deep, e.u, e.n), along, deep, e, t };
  };
  /** A free piece's body at x, y, turned rot (0 or 90 in the frame, so it lies square to the room). */
  const free = (f, x, y, rot) => { const [bw, bh] = FURNITURE[f].body, a = (rot * Math.PI) / 180, u = [Math.cos(a), Math.sin(a)], n = [-u[1], u[0]]; return { x, y, rot, poly: boxAt(x, y, bw, bh, u, n) }; };
  const doorDist = (e, t) => { const p = [e.a[0] + e.u[0] * t, e.a[1] + e.u[1] * t]; return openings.length ? Math.min(...openings.map((o) => Math.hypot(o.at[0] - p[0], o.at[1] - p[1]))) : 0; };
  const wallScore = (e, want) => {
    let s = e.L * 0.1;
    if (want === "outside") s += e.outside ? 5 : 0;
    if (want === "inside") s += e.outside ? 0 : 4;
    if (want === "end") s += (e.outside ? 5 : 0) - e.L * 0.4; // (a hearth on an outside end wall, leaving the long ones)
    if (want === "away" || want === "far") s += e.doorNear * 0.8;
    if (want === "far-end") s += e.doorNear * 0.8 - e.L * 0.6; // (an altar at the end of the room away from its door)
    return s;
  };
  const long = x1 - x0 >= y1 - y0;
  /** Along a wall: the walls in the order this piece likes, and on each the places from the middle out (or its far end). */
  const tryWall = (f, want, { gap = 0, centered = false } = {}) => {
    const F = FURNITURE[f], along0 = F.back === "left" ? F.body[1] : F.body[0];
    for (const e of [...edges].sort((a, b) => wallScore(b, want) - wallScore(a, want))) {
      if (e.L < along0 + 0.02) continue;
      const ts = centered ? [e.L / 2] : [];
      for (let d = 0; d <= e.L / 2; d += 0.25) ts.push(e.L / 2 - d, e.L / 2 + d);
      if (want === "away") ts.sort((a, b) => doorDist(e, b) - doorDist(e, a));
      for (const t of ts) {
        if (t < along0 / 2 + 0.01 || t > e.L - along0 / 2 - 0.01) continue;
        const w = onWall(f, e, t, gap);
        if (fits(w.poly)) return put(f, w, { wall: { e, t, gap } });
      }
    }
    return null;
  };
  /** Into a corner: flush against both its walls, the corners farthest from a door first. */
  const tryCorner = (f) => {
    const F = FURNITURE[f], along0 = F.back === "left" ? F.body[1] : F.body[0];
    const ends = edges.flatMap((e) => [[e, along0 / 2 + 0.01], [e, e.L - along0 / 2 - 0.01]]).filter(([e, t]) => t > 0 && t < e.L);
    ends.sort((a, b) => doorDist(b[0], b[1]) - doorDist(a[0], a[1]));
    for (const [e, t] of ends) { const w = onWall(f, e, t); if (fits(w.poly)) return put(f, w, { wall: { e, t, gap: 0 } }); }
    return null;
  };
  // (a piece by its name or any of a list: a bed or a single bed)
  const isOf = (p, of) => (Array.isArray(of) ? of.includes(p.f) : p.f === of);
  const find = (of) => placed.find((p) => isOf(p, of));
  const step = (s) => {
    if (s.when && !q.features.has(s.when)) return null;
    if (s.min && roomArea < s.min) return null;
    const f = s.f, F = FURNITURE[f];
    if (s.at === "wall") return tryWall(f, s.want, s);
    if (s.at === "corner") return tryCorner(f);
    if (s.at === "center") {
      // (square to the room, its long side along the room's; from the middle out)
      const rot = F.body[0] >= F.body[1] ? (long ? 0 : 90) : (long ? 90 : 0);
      const c = [(x0 + x1) / 2, (y0 + y1) / 2], cands = [];
      for (let dx = -3; dx <= 3; dx += 0.25) for (let dy = -3; dy <= 3; dy += 0.25) cands.push([c[0] + dx, c[1] + dy]);
      cands.sort((a, b) => Math.hypot(a[0] - c[0], a[1] - c[1]) - Math.hypot(b[0] - c[0], b[1] - c[1]));
      for (const [x, y] of cands) { const w = free(f, x, y, rot); if (fits(w.poly)) return put(f, w); }
      return null;
    }
    if (s.at === "bar") {
      // A bar along a wall a barkeep's width out, its fading end into the wall at a corner
      const want = q.kind === "shop" ? "far" : "inside";
      for (const e of [...edges].sort((a, b) => wallScore(b, want) - wallScore(a, want))) {
        // (the art's left end, where it fades: which end of this wall it's toward)
        const w0 = onWall(f, e, e.L / 2, 1.1), a = (w0.rot * Math.PI) / 180, artX = [Math.cos(a), Math.sin(a)];
        const t = artX[0] * e.u[0] + artX[1] * e.u[1] > 0 ? F.body[0] / 2 + 0.01 : e.L - F.body[0] / 2 - 0.01;
        if (t < 0 || t > e.L) continue;
        const w = onWall(f, e, t, 1.1);
        if (fits(w.poly)) return put(f, w, { wall: { e, t, gap: 1.1 } });
      }
      return null;
    }
    if (s.at === "counter") return step({ ...s, at: "bar" });
    if (s.at === "behind") {
      // On the wall behind a bar, in the barkeep's way only at the bar's ends
      const bar = placed.find((p) => FURNITURE[p.f].end && p.wall?.gap >= 1);
      if (!bar) return null;
      const { e, t } = bar.wall, half = FURNITURE[bar.f].body[0] / 2;
      const along = (FURNITURE[f].back === "left" ? FURNITURE[f].body[1] : FURNITURE[f].body[0]) / 2;
      for (const d of [-(half - along), half - along, 0]) {
        const w = onWall(f, e, t + d);
        if (t + d - along < 0 || t + d + along > e.L) continue;
        if (fits(w.poly)) return put(f, w, { wall: { e, t: t + d, gap: 0 } });
      }
      return null;
    }
    if (s.at === "foot" || s.at === "seat") {
      // At a bed's foot, square to it; a chair or stool before a desk or a bench, facing it
      for (const p of placed.filter((x) => isOf(x, s.of) && !x.has)) {
        if (!p.wall) continue;
        const { e } = p.wall, deep = FURNITURE[p.f].back === "left" ? FURNITURE[p.f].body[0] : FURNITURE[p.f].body[1];
        const fd = FURNITURE[f].body[1], dd = deep / 2 + fd / 2 + (s.at === "seat" ? 0.05 : 0.04);
        const x = p.x + e.n[0] * dd, y = p.y + e.n[1] * dd;
        const rot = s.at === "seat" ? p.rot + 180 : p.rot;
        const [bw, bh] = FURNITURE[f].body, poly = boxAt(x, y, bw, bh, e.u, e.n);
        if (fits(poly)) { p.has = true; return put(f, { x, y, rot, poly }); }
      }
      return null;
    }
    if (s.at === "near") {
      const to = find(s.of);
      if (!to) return null;
      for (const d of [1.2, 1.5, 1.9]) for (let k = 0; k < 16; k++) {
        const a = (k * Math.PI) / 8, x = to.x + Math.cos(a) * d, y = to.y + Math.sin(a) * d;
        for (const rot of [0, 90]) { const w = free(f, x, y, rot); if (fits(w.poly)) return put(f, w); }
      }
      return null;
    }
    if (s.at === "rug") {
      // Under the room's table (or its middle), square to it and to the room, wholly on the floor and under nothing
      // else but what it's centered on
      const under = placed.find((p) => /^table|^bed$/.test(p.f));
      const c = under && !/^bed/.test(under.f) ? [under.x, under.y] : [(x0 + x1) / 2, (y0 + y1) / 2];
      for (const rot of long ? [0, 90] : [90, 0]) {
        const w = free(f, c[0], c[1], rot);
        if (inside(w.poly) && !placed.some((p) => p !== under && !FURNITURE[p.f].floor && polygonsOverlap(p.poly, w.poly))) return put(f, w);
      }
      return null;
    }
    if (s.at === "tables") {
      // Tables with their chairs, as many as fit with room to pass around each (from the room's middle out)
      const [bw, bh] = F.body, pad = 0.45;
      const c = [(x0 + x1) / 2, (y0 + y1) / 2], cands = [];
      for (let x = x0 + bw / 2; x <= x1 - bw / 2 + 1e-9; x += 0.25) for (let y = y0 + bh / 2; y <= y1 - bh / 2 + 1e-9; y += 0.25) cands.push([x, y]);
      cands.sort((p, q2) => Math.hypot(p[0] - c[0], p[1] - c[1]) - Math.hypot(q2[0] - c[0], q2[1] - c[1]));
      let any = null;
      for (const [x, y] of cands) {
        const w = free(f, x, y, 0), wide = boxAt(x, y, bw + 2 * pad, bh + 2 * pad, [1, 0], [0, 1]);
        if (fits(w.poly) && !placed.some((p) => !FURNITURE[p.f].floor && polygonsOverlap(p.poly, wide))) any = put(f, { ...w, rot: r.int(4) * 90 });
      }
      return any;
    }
    if (s.at === "pews") {
      // Pews in rows down the room's long way, facing the altar, either side of a middle aisle when there's room
      const altar = find("altar");
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const fromHi = altar ? (long ? altar.x > cx : altar.y > cy) : true;
      const lo = long ? x0 : y0, hi = long ? x1 : y1, acrossLo = long ? y0 : x0, acrossHi = long ? y1 : x1;
      const width = acrossHi - acrossLo, two = width >= 5.4, pw = FURNITURE.pew.body[0] + 0.1;
      const blocks = two ? [[acrossLo + 0.1, (acrossLo + acrossHi) / 2 - 0.6], [(acrossLo + acrossHi) / 2 + 0.6, acrossHi - 0.1]] : [[acrossLo + 0.1, acrossHi - 1.2]];
      let any = null;
      for (let d = 2.4; d < hi - lo - 1.6; d += 1.3) {
        const along = fromHi ? hi - d : lo + d;
        for (const [b0, b1] of blocks) {
          const k = Math.floor((b1 - b0) / pw);
          for (let j = 0; j < k; j++) {
            const across = (b0 + b1) / 2 + (j - (k - 1) / 2) * pw;
            const [x, y] = long ? [along, across] : [across, along];
            const u = long ? [0, 1] : [1, 0], n = long ? [fromHi ? -1 : 1, 0] : [0, fromHi ? -1 : 1];
            const poly = boxAt(x, y, FURNITURE.pew.body[0], FURNITURE.pew.body[1], u, n);
            // (the pew's back toward the door, so it faces the altar; the rows keep their own aisle, so no way is
            // looked for between them)
            if (inside(poly) && !placed.some((p) => polygonsOverlap(p.poly, poly)) && !keep.some((k) => polygonsOverlap(k, poly))) any = put("pew", { x, y, rot: deg(Math.atan2(n[0], -n[1])), poly });
          }
        }
      }
      return any;
    }
    return null;
  };
  for (const s of recipe.steps) {
    for (let k = 0; k < (s.n ?? 1); k++) {
      let done = step(s);
      // (a stand-in, smaller, needs no least floor of its own)
      for (const alt of s.alt ?? []) if (!done) done = step({ ...s, min: 0, ...alt, alt: null });
      if (!done) break;
    }
  }
  // Filled out: the kind's pieces along the walls, near the corners and each other first, to its share of the floor
  const fill = recipe.fill;
  for (let tries = 0; fill.length && tries < 60 && covered() < recipe.cover; tries++) {
    const f = fill[tries % fill.length];
    if (!(tryCorner(f) ?? tryNextTo(f))) { if (tries > 3 * fill.length) break; }
  }
  /** Beside a piece already against a wall, flush along the same wall (crates by crates, a chest by a shelf). */
  function tryNextTo(f) {
    const F = FURNITURE[f], along = (F.back === "left" ? F.body[1] : F.body[0]);
    for (const p of r.shuffle(placed.filter((x) => x.wall && !x.wall.gap))) {
      const { e, t } = p.wall, pa = (FURNITURE[p.f].back === "left" ? FURNITURE[p.f].body[1] : FURNITURE[p.f].body[0]);
      for (const d of [pa / 2 + along / 2 + 0.02, -(pa / 2 + along / 2 + 0.02)]) {
        const tt = t + d;
        if (tt < along / 2 || tt > e.L - along / 2) continue;
        const w = onWall(f, e, tt);
        if (fits(w.poly)) return put(f, w, { wall: { e, t: tt, gap: 0 } });
      }
    }
    return null;
  }
}
const deg = (a) => (a * 180) / Math.PI;

/** A box centered at x, y: `along` on u, `deep` on n. */
function boxAt(x, y, along, deep, u, n) {
  const a = along / 2, d = deep / 2;
  return [[-a, -d], [a, -d], [a, d], [-a, d]].map(([s, t]) => [x + u[0] * s + n[0] * t, y + u[1] * s + n[1] * t]);
}
