/**
 * What a building is used for, and which plots a district gives to its notable buildings and trades. A district's
 * character and its trades set what it wants; a settlement's notable buildings (a temple near the green or square,
 * an inn on the main road, a smithy toward the edge) are shared out among its districts; each wanted use is then
 * given the plot that best fits its rule (tanners by the water and downstream, smiths by the roads and gates, bakers
 * by the market). Five uses have a building of their own (lots/forms.mjs); the rest keep the usual house and show
 * by their yard: clutter, pits, a kiln, smoke. Pure: runs anywhere.
 */
import { pointInPolygon, distanceToPath, bbox } from "./geom.mjs";
import { centroid, area } from "./lots/poly.mjs";
import { characterOf } from "./character.mjs";

/** The trades a district can be given (each a use). */
export const TRADES = [
  "smithy", "farrier", "tannery", "dyeworks", "fullery", "pottery", "brickworks", "carpenter", "cooper", "wheelwright",
  "bakery", "brewery", "butcher", "alchemist", "magic-shop", "laboratory", "gunsmith", "inventor",
];

/** Every use a building can have. */
export const USES = ["house", "shop", "inn", "temple", "mansion", "warehouse", "barracks", "stable", "armory", "workshop", "shed", "store", "guildhall", "customs", "keep", "palace", "market-hall", "shrine", "watch", ...TRADES];

/**
 * Per use: label (what labels and the window call it), form (a building of its own, lots/forms.mjs), notable (a
 * hidden label on Make scene), site (the weights of its siting rule, see score below), fire (no thatch on it or its
 * neighbors), smoke (light, gray, dark, or a tint), yard (what stands in its yard: prop classes), pits (tanning or
 * dyeing pits in its yard), kiln (a kiln in its yard), join (plots it may join, at most), minFt and deepFt (the
 * frontage and depth it needs, in feet).
 */
export const USE_INFO = {
  house: { label: "House" },
  shop: { label: "Shop", site: { square: 3, main: 2, road: 1 } },
  inn: { label: "Inn", form: "inn", notable: true, site: { road: 4, gate: 2, square: 2, spread: 2 }, join: 3, minFt: 45, deepFt: 85 },
  temple: { label: "Temple", form: "temple", notable: true, site: { square: 4, road: 1, center: 2, spread: 3 }, join: 8, minFt: 70, deepFt: 50 },
  mansion: { label: "Mansion", form: "mansion", notable: true, site: { quiet: 2, spread: 1 }, join: 3, minFt: 75, deepFt: 110 },
  warehouse: { label: "Warehouse", form: "warehouse", notable: true, site: { water: 4, road: 1 }, join: 2, minFt: 30, deepFt: 40, yard: ["crate", "barrel", "sacks"] },
  barracks: { label: "Barracks", form: "barracks", notable: true, site: { gate: 2, road: 1, spread: 2 }, join: 4, minFt: 90, deepFt: 90, yard: ["barrel", "crate"] },
  stable: { label: "Stable", form: "warehouse", notable: true, site: { road: 2, gate: 1 }, join: 2, minFt: 30, deepFt: 40, yard: ["hay", "hay", "cart"] },
  armory: { label: "Armory", form: "warehouse", notable: true, site: { center: 1 }, join: 2, minFt: 30, deepFt: 40, yard: ["crate", "cannonballs"] },
  workshop: { label: "Workshop" },
  shed: { label: "Shed" },
  store: { label: "Storehouse" },
  guildhall: { label: "Guildhall", notable: true },
  customs: { label: "Customs house", notable: true },
  keep: { label: "Keep", notable: true },
  palace: { label: "Palace", notable: true },
  "market-hall": { label: "Market hall", notable: true },
  shrine: { label: "Shrine", notable: true },
  watch: { label: "Watch post", notable: true },
  smithy: { label: "Smithy", notable: true, site: { road: 3, gate: 2, edge: 1, spread: 2 }, fire: true, smoke: "dark", yard: ["anvil", "firewood", "barrel"] },
  farrier: { label: "Farrier", notable: true, site: { road: 3, gate: 3, spread: 2 }, fire: true, smoke: "gray", yard: ["anvil", "hay", "cart"] },
  tannery: { label: "Tannery", notable: true, site: { water: 4, downstream: 3, edge: 2 }, yard: ["rack", "rack", "barrel"], pits: "tan" },
  dyeworks: { label: "Dyeworks", notable: true, site: { water: 4, downstream: 2, edge: 1 }, yard: ["rack", "rack"], pits: "dye" },
  fullery: { label: "Fullery", notable: true, site: { water: 4, downstream: 1, edge: 1 }, yard: ["rack", "rack"], pits: "full" },
  pottery: { label: "Pottery", notable: true, site: { edge: 3, water: 1, spread: 1 }, fire: true, smoke: "gray", yard: ["pots", "firewood"], kiln: true },
  brickworks: { label: "Brickworks", notable: true, site: { edge: 4, water: 1 }, fire: true, smoke: "dark", yard: ["firewood", "planks"], kiln: true },
  carpenter: { label: "Carpenter", notable: true, site: { road: 1, edge: 1, spread: 1 }, yard: ["planks", "planks", "firewood"] },
  cooper: { label: "Cooper", notable: true, site: { water: 1, road: 1, spread: 1 }, yard: ["barrel", "barrel", "planks"] },
  wheelwright: { label: "Wheelwright", notable: true, site: { road: 2, gate: 1, spread: 1 }, yard: ["cart", "planks"] },
  bakery: { label: "Bakery", notable: true, site: { square: 3, main: 2, spread: 2 }, fire: true, smoke: "light", yard: ["firewood", "sacks"] },
  brewery: { label: "Brewery", notable: true, site: { water: 2, square: 1, spread: 1 }, fire: true, smoke: "light", yard: ["barrel", "barrel", "sacks"] },
  butcher: { label: "Butcher", notable: true, site: { square: 3, water: 1, spread: 1 }, yard: ["barrel"] },
  alchemist: { label: "Alchemist", notable: true, site: { apart: 2, main: 1, spread: 2 }, fire: true, smoke: "green", yard: ["cauldron", "crate"] },
  "magic-shop": { label: "Magic shop", notable: true, site: { square: 2, main: 3, spread: 2 } },
  laboratory: { label: "Laboratory", notable: true, site: { edge: 2, apart: 3, spread: 2 }, fire: true, smoke: "violet", yard: ["cauldron", "crate"] },
  gunsmith: { label: "Gunsmith", notable: true, site: { apart: 2, road: 1, edge: 1, spread: 2 }, fire: true, smoke: "dark", yard: ["cannonballs", "crate"] },
  inventor: { label: "Inventor", notable: true, site: { edge: 1, apart: 1, spread: 2 }, smoke: "gray", yard: ["cogs", "crate", "cart"] },
};

/** How wide each kind of yard clutter is drawn, in feet (about twice life size, so it reads at a town's scale). */
export const CLUTTER_FT = { barrel: 6, crate: 6, sacks: 6, pots: 6, anvil: 5, cauldron: 6, cannonballs: 6, cogs: 8, rack: 9, firewood: 12, planks: 10, hay: 10, cart: 14, wagon: 20 };

/** What the window calls a use. */
export const useLabel = (use) => USE_INFO[use]?.label ?? null;

/** The trades a crafts district works when it isn't given any (those needing water only by water). */
const CRAFTS_DEFAULT = ["smithy", "carpenter", "cooper", "wheelwright", "pottery", "tannery", "dyeworks"];
const WET = new Set(["tannery", "dyeworks", "fullery"]);
const RANK = { hamlet: 0, village: 1, town: 2, city: 3 };

/**
 * The notable buildings of each settlement, shared out among its districts. dlist: [{ id, poly, feature }] every
 * district; squares: [polygon] squares and greens; roadIds: the plan's roads; ways: the plan's ways. Returns a Map
 * from a district id to { want: [use...], ctx } where ctx describes its settlement for the siting rules: { center,
 * radius, gates: [point], squares: [polygon] }. Depends only on the plan, never on a district's seed.
 */
export function notablesFor({ dlist, squares = [], roads = [], gates: wallGates = [], r }) {
  const out = new Map();
  // Settlements: districts that touch or nearly touch
  const groups = [];
  const near = (a, b) => {
    const [ax0, ay0, ax1, ay1] = bbox(a.poly), [bx0, by0, bx1, by1] = bbox(b.poly);
    if (ax0 > bx1 + 1 || bx0 > ax1 + 1 || ay0 > by1 + 1 || by0 > ay1 + 1) return false;
    const ring = (p) => [...p, p[0]];
    return a.poly.some((p) => pointInPolygon(p, b.poly) || distanceToPath(p, ring(b.poly)) < 1) || b.poly.some((p) => pointInPolygon(p, a.poly) || distanceToPath(p, ring(a.poly)) < 1);
  };
  for (const d of dlist) {
    const joined = groups.filter((g) => g.some((o) => near(o, d)));
    const merged = [d, ...joined.flat()];
    for (const g of joined) groups.splice(groups.indexOf(g), 1);
    groups.push(merged);
  }
  groups.forEach((g) => g.sort((a, b) => dlist.indexOf(a) - dlist.indexOf(b)));
  groups.sort((a, b) => dlist.indexOf(a[0]) - dlist.indexOf(b[0]));
  for (const g of groups) {
    // Its middle and reach, its ways in (where a road leaves it, and a town wall's gates), its squares and greens
    let ax = 0, ay = 0, at = 0;
    for (const d of g) { const a = area(d.poly), [cx, cy] = centroid(d.poly); ax += cx * a; ay += cy * a; at += a; }
    const center = at ? [ax / at, ay / at] : centroid(g[0].poly);
    const radius = Math.max(1, ...g.flatMap((d) => d.poly.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1]))));
    const inside = (p) => g.some((d) => pointInPolygon(p, d.poly));
    const gates = [...wallGates.filter((p) => Math.hypot(p[0] - center[0], p[1] - center[1]) < radius * 1.2)];
    for (const road of roads) {
      let was = null;
      for (let i = 1; i < road.path.length; i++) {
        const [a, b] = [road.path[i - 1], road.path[i]];
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
        for (let k = i === 1 ? 0 : 1; k <= n; k++) {
          const p = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n];
          const now = inside(p);
          if (was !== null && now !== was) gates.push(p);
          was = now;
        }
      }
    }
    const sqs = squares.filter((s) => g.some((d) => s.some((p) => pointInPolygon(p, d.poly)) || d.poly.some((p) => pointInPolygon(p, s))));
    const ctx = { center, radius, gates, squares: sqs };
    const top = Math.max(...g.map((d) => RANK[d.feature.profile] ?? 1));
    const want = new Map(g.map((d) => [d.id, []]));
    const on = (d) => d.feature.notable !== false;
    const roadIn = (d) => roads.some((w) => w.path.some((p) => pointInPolygon(p, d.poly)) || d.poly.some((p) => distanceToPath(p, w.path) < (w.width ?? 0.8) / 2 + 0.3));
    // A temple: one in a village (in the district nearest its green or square, else the biggest), one in each town or
    // city district; a temple district has its own
    const own = g.filter((d) => characterOf(d.feature) === "temple");
    for (const d of own) want.get(d.id).push("temple");
    if (top >= RANK.town || (top === RANK.village && !own.length)) {
      const eligible = g.filter((d) => on(d) && (RANK[d.feature.profile] ?? 1) >= RANK.village && !["garrison", "docks"].includes(characterOf(d.feature)));
      if (top === RANK.village) {
        const score = (d) => (sqs.some((s) => s.some((p) => pointInPolygon(p, d.poly)) || d.poly.some((p) => pointInPolygon(p, s))) ? 1e9 : 0) + area(d.poly);
        const best = [...eligible].sort((a, b) => score(b) - score(a))[0];
        if (best) want.get(best.id).push("temple");
      } else for (const d of eligible) if ((RANK[d.feature.profile] ?? 1) >= RANK.town && !["nobles", "temple"].includes(characterOf(d.feature))) want.get(d.id).push("temple");
    }
    // An inn in each village-or-bigger district a road runs through (one more in a big town district or a market)
    // and a smithy in each; in a hamlet, now and then one smithy
    const gr = r.fork("settlement", g[0].id);
    for (const d of g) {
      if (!on(d)) continue;
      const rank = RANK[d.feature.profile] ?? 1, ch = characterOf(d.feature);
      if (rank === RANK.hamlet) { if (d === g[0] && gr.next() < 0.5) want.get(d.id).push("smithy"); continue; }
      if (roadIn(d) && !["nobles", "temple", "garrison"].includes(ch)) {
        want.get(d.id).push("inn");
        if (rank >= RANK.town && area(d.poly) > 900) want.get(d.id).push("inn");
      }
      if (!["nobles", "temple", "market"].includes(ch)) want.get(d.id).push("smithy");
    }
    for (const d of g) out.set(d.id, { want: want.get(d.id), ctx });
  }
  return out;
}

/** What a district's character asks for besides its notable buildings, as uses with shares of its plots or counts. */
function characterWants(district, hasWater) {
  const ch = characterOf(district);
  const trades = (Array.isArray(district.trades) ? district.trades : []).filter((t) => TRADES.includes(t));
  const asked = trades.filter((t) => !WET.has(t) || hasWater);
  switch (ch) {
    case "market": return { shares: { shop: 0.6 }, counts: { inn: 1, bakery: 1, butcher: 1, brewery: 1 }, trades: asked };
    case "merchants": return { shares: { shop: 0.25 }, counts: { warehouse: 2 }, trades: asked, rear: "warehouse" };
    case "crafts": {
      const list = asked.length ? asked : CRAFTS_DEFAULT.filter((t) => !WET.has(t) || hasWater);
      return { trades: list, tradeShare: 0.4, rear: "workshop", out: "workshop" };
    }
    case "docks": return { shares: { warehouse: 0.35 }, counts: { cooper: 1, inn: 1 }, trades: asked, rear: "warehouse" };
    case "nobles": return { shares: { mansion: 0.55 }, trades: asked };
    case "garrison": return { counts: { barracks: 2, stable: 1, armory: 1 }, trades: asked, rear: "stable" };
    default: return { trades: asked };
  }
}

/**
 * Which plots this district gives to which use. district: the plan feature; lots: from lotsFor; ways: [{ id, path,
 * width, class }]; want: the notable buildings the settlement gave it; ctx: its settlement (see notablesFor); water:
 * [{ path, width }] streams and rivers, in the order they flow, and [{ ring }] lakes and the sea; roadIds: the plan's
 * roads; ftPerSquare; r: the district's stream for uses; tryForm(use, form, lots): lays a building of its own out on
 * those plots, or null where it doesn't fit (the next best plots are tried). Returns { sites: [{ use, form, lots: [i],
 * made }] (a building of its own on those plots, joined, and what tryForm made of it), missed: [use] (notable
 * buildings it had no room for), dry: [trade] (trades it was given that need water, with none near), useOf: Map(i, use) (the usual house, put to that use), noThatch: Set(i), rear,
 * out } (what a plot's back range and outbuildings are used for in this district).
 */
export function planUses({ district, lots, ways, want = [], ctx, water = [], roadIds = new Set(), ftPerSquare, r, tryForm = null }) {
  const sq = (ft) => ft / ftPerSquare;
  const out = { sites: [], useOf: new Map(), noThatch: new Set(), rear: null, out: null, missed: [], dry: [] };
  if (!lots.length) return out;
  const wayOf = new Map(ways.map((w) => [w.id, w]));
  // What each plot is like, measured once
  const info = lots.map((lot) => {
    const c = centroid(lot.poly);
    const w = wayOf.get(lot.way);
    let wd = Infinity, down = 0;
    for (const x of water) {
      if (x.path) {
        const d = distanceToPath(c, x.path) - (x.width ?? 0) / 2;
        if (d < wd) { wd = d; down = alongShare(c, x.path); }
      } else if (x.ring) {
        const d = distanceToPath(c, x.ring);
        if (d < wd) { wd = d; down = 1; }
      }
    }
    const fromMid = Math.hypot(c[0] - ctx.center[0], c[1] - ctx.center[1]) / ctx.radius;
    const gate = ctx.gates.length ? Math.min(...ctx.gates.map((g) => Math.hypot(g[0] - c[0], g[1] - c[1]))) : Infinity;
    const square = ctx.squares.length ? Math.min(...ctx.squares.map((s) => (pointInPolygon(c, s) ? 0 : distanceToPath(c, [...s, s[0]])))) : Infinity;
    return {
      c, water: wd, down, edge: Math.min(1.2, fromMid), gate, square,
      road: roadIds.has(lot.way) ? 1 : 0, main: w && w.class !== "lane" && w.class !== "back" ? 1 : 0,
    };
  });
  const R = ctx.radius;
  // Tanners, dyers and fullers only where some plot is near water; asked for and none is, the district says so
  const hasWater = info.some((f) => f.water < sq(300));
  const W = characterWants(district, hasWater);
  out.rear = W.rear ?? null;
  out.out = W.out ?? null;
  out.dry = hasWater ? [] : [...new Set((Array.isArray(district.trades) ? district.trades : []).filter((t) => WET.has(t)))];
  const taken = new Map(); // lot index -> use
  const placed = []; // [{ use, at }]
  // What's placed, in cells about as wide as the farthest a placed thing pushes others away (0.4 of the radius), so
  // each score looks only at the cells around its plot
  const cell = Math.max(1e-6, R * 0.4);
  const grid = new Map();
  const cellKey = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const near = (x, y) => {
    const out2 = [];
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out2.push(...(grid.get(`${cx + i},${cy + j}`) ?? []));
    return out2;
  };
  const sr = r.fork("sites");
  /** How well a plot suits a use: the higher the better. */
  const score = (i, use) => {
    const s = USE_INFO[use]?.site ?? {};
    const f = info[i];
    let v = sr.next() * 0.6; // a little chance, so two equal plots don't always fall the same way
    if (s.water) v += s.water * (Number.isFinite(f.water) ? Math.max(-3, 1 - f.water / sq(120)) : 0);
    if (s.downstream && Number.isFinite(f.water) && f.water < sq(200)) v += s.downstream * f.down;
    if (s.edge) v += s.edge * f.edge;
    if (s.center) v += s.center * (1 - f.edge);
    if (s.quiet) v += s.quiet * (1 - f.road) * 0.5 + s.quiet * (Number.isFinite(f.square) ? Math.min(1, f.square / (R * 0.5)) : 0.5) * 0.5;
    if (s.road) v += s.road * f.road;
    if (s.main) v += s.main * f.main;
    if (s.gate) v += s.gate * (Number.isFinite(f.gate) ? Math.max(0, 1 - f.gate / (R * 0.6)) : 0);
    if (s.square) v += s.square * (Number.isFinite(f.square) ? Math.max(0, 1 - f.square / (R * 0.5)) : 0);
    for (const p of near(f.c[0], f.c[1])) {
      const d = Math.hypot(p.at[0] - f.c[0], p.at[1] - f.c[1]) / R;
      if (s.spread && p.use === use) v -= s.spread * Math.max(0, 1 - d / 0.4);
      if (s.apart) v -= s.apart * Math.max(0, 1 - d / 0.25);
    }
    return v;
  };
  /** The plots beside lot i along its street (same block and street, touching), in order. */
  const joins = (a, b) => lots[a].block === lots[b].block && lots[a].way === lots[b].way && Math.hypot(lots[a].front.b[0] - lots[b].front.a[0], lots[a].front.b[1] - lots[b].front.a[1]) < 0.1;
  const runs = [];
  for (let i = 0; i < lots.length; i++) { if (i && joins(i - 1, i)) runs[i] = runs[i - 1]; else runs[i] = []; runs[i].push(i); }
  const run = (i) => runs[i];
  /** Gives the best free plot (or plots, for a building of its own) to a use. */
  // A temple is bigger in a town or city, and biggest in a temple district: it wants more frontage
  const bigger = (use) => (use !== "temple" ? 1 : ({ town: 1.5, city: 1.8 }[district.profile] ?? 1) * (characterOf(district) === "temple" ? 1.6 : 1));
  const give = (use) => {
    const u = USE_INFO[use];
    const need = sq((u.minFt ?? 0) * bigger(use)), deep = sq((u.deepFt ?? 0) * (use === "temple" ? Math.sqrt(bigger(use)) : 1));
    const wet = WET.has(use) && water.length > 0;
    const cands = [];
    for (let i = 0; i < lots.length; i++) {
      if (taken.has(i) || lots[i].depth < deep) continue;
      if (wet && !(info[i].water < sq(300))) continue; // tanners, dyers and fullers work by the water
      let pick = [i];
      if (u.form) {
        // Plots joined along the street until wide enough, centered on this one where it can
        const row = run(i);
        let lo = row.indexOf(i), hi = lo, width = lots[i].frontage;
        while (width < need && hi - lo + 1 < Math.ceil((u.join ?? 1) * bigger(use))) {
          const left = lo > 0 && !taken.has(row[lo - 1]) && lots[row[lo - 1]].depth >= deep ? lots[row[lo - 1]].frontage : -1;
          const right = hi < row.length - 1 && !taken.has(row[hi + 1]) && lots[row[hi + 1]].depth >= deep ? lots[row[hi + 1]].frontage : -1;
          if (left < 0 && right < 0) break;
          if (right >= left) { hi++; width += right; } else { lo--; width += left; }
        }
        if (width < need * (use === "temple" ? 0.7 : 1)) continue; // a temple turned into its plots needs less
        pick = row.slice(lo, hi + 1);
      }
      cands.push({ v: score(i, use), pick });
    }
    cands.sort((a, b) => b.v - a.v);
    // The best plots that take it (a building of its own is tried on the next best where it doesn't fit)
    let best = null, made = null;
    for (const c of cands.slice(0, u.form && tryForm ? 6 : 1)) {
      if (u.form && tryForm) { made = tryForm(use, u.form, c.pick); if (!made) continue; }
      best = c;
      break;
    }
    if (!best) return false;
    for (const k of best.pick) taken.set(k, use);
    const at = info[best.pick[Math.floor(best.pick.length / 2)]].c;
    placed.push({ use, at });
    const key = cellKey(at[0], at[1]);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push({ use, at });
    if (u.form) out.sites.push({ use, form: u.form, lots: best.pick, made });
    else out.useOf.set(best.pick[0], use);
    if (u.fire) for (const k of best.pick) for (const j of [k - 1, k, k + 1]) if (j >= 0 && j < lots.length) out.noThatch.add(j);
    return true;
  };
  // Buildings of their own first (they take the most room), then trades, then shops
  const order = [];
  for (const use of want) order.push(use);
  for (const [use, n] of Object.entries(W.counts ?? {})) for (let k = 0; k < n; k++) order.push(use);
  for (const [use, share] of Object.entries(W.shares ?? {})) if (USE_INFO[use].form) for (let k = 0; k < Math.round(lots.length * share / (USE_INFO[use].join ?? 1)); k++) order.push(use);
  // Trades: each at least once, then through the list again until the district's share of workshops is filled
  const trades = W.trades ?? [];
  if (trades.length) {
    const n = Math.min(Math.max(trades.length, 60), Math.max(trades.length, Math.round(lots.length * (W.tradeShare ?? 0)))); // at most 60 workshops: a crafts quarter isn't all trades
    for (let k = 0; k < n; k++) order.push(trades[k % trades.length]);
  }
  const formFirst = [...order.filter((u) => USE_INFO[u].form), ...order.filter((u) => !USE_INFO[u].form)];
  // Never more than half the plots to buildings of their own and trades
  let left = Math.max(1, Math.floor(lots.length / 2));
  const asked = new Set([...want, ...Object.keys(W.counts ?? {})]);
  for (const use of formFirst) {
    if (left <= 0) break;
    if (give(use)) left--;
    else if (asked.has(use) && !out.missed.includes(use)) out.missed.push(use);
  }
  // Shops: a share of what's left, best sited first
  for (const [use, share] of Object.entries(W.shares ?? {})) {
    if (USE_INFO[use].form) continue;
    const free = lots.map((_, i) => i).filter((i) => !taken.has(i));
    const n = Math.round(free.length * share);
    const ranked = free.map((i) => [i, score(i, use)]).sort((a, b) => b[1] - a[1]).slice(0, n);
    for (const [i] of ranked) { taken.set(i, use); out.useOf.set(i, use); }
  }
  return out;
}

/** How far along a path the point nearest p lies, as a share of its length (0 at its first point). */
function alongShare(p, path) {
  let total = 0, best = Infinity, at = 0;
  const lens = [];
  for (let i = 1; i < path.length; i++) { const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); lens.push(l); total += l; }
  let run = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const l = lens[i - 1];
    const t = l ? Math.max(0, Math.min(1, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / (l * l))) : 0;
    const d = Math.hypot(ax + t * (bx - ax) - p[0], ay + t * (by - ay) - p[1]);
    if (d < best) { best = d; at = run + t * l; }
    run += l;
  }
  return total ? at / total : 0;
}
