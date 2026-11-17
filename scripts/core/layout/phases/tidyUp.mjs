// One phase of laying out a plan (layout/index.mjs, layoutPlan): ctx holds what the phases share.
import { PARAPET, cutWhere } from "../index.mjs";
import { ROOM, buildingInteriors, parseRooms } from "../rooms.mjs";
import { battleYards, footprint } from "../battle.mjs";
import { bbox, distanceToPath, pointInPolygon } from "../../geom.mjs";
import { castleWorks } from "../castle.mjs";
import { fordDetail } from "../crossings.mjs";

/**
 * A tree laid before another feature's street is dropped where that street runs over it (and a hedge's bushes where
 * a farm's or park's lane goes through)
 */
export function tidyUp(ctx) {
  const { H, W, battle, items, lanes, notes, plan, sq } = ctx;
  const hard = items.filter((i) => i.kind === "way" && (!i.faint || lanes.includes(i))).map((w) => { const [x0, y0, x1, y1] = bbox(w.path), m = w.width / 2 + 0.05; return { w, m, box: [x0 - m, y0 - m, x1 + m, y1 + m] }; });
  for (let k = items.length - 1; k >= 0; k--) {
    const t = items[k];
    if ((t.kind === "tree" || (t.kind === "prop" && t.class === "bush")) && t.id !== t.from && hard.some(({ w, m, box }) => w.from !== t.from && t.x > box[0] && t.x < box[2] && t.y > box[1] && t.y < box[3] && distanceToPath([t.x, t.y], w.path) < m)) items.splice(k, 1);
  }

  // A grave under a tree the plan or another feature put in a temple's yard
  const yardTrees = items.filter((t) => t.kind === "tree");
  for (let k = items.length - 1; k >= 0; k--) {
    const g = items[k];
    if (g.kind === "prop" && g.class === "grave" && /\/grave\d+-/.test(g.id) && yardTrees.some((t) => t.from !== g.from && Math.abs(t.x - g.x) < 0.8 && Math.abs(t.y - g.y) < 0.8)) items.splice(k, 1);
  }

  // A yard's or a centerpiece's wall where another district's street comes by (one bending to its gate can cut a
  // corner over the border): a gap there
  for (let k = items.length - 1; k >= 0; k--) {
    const v = items[k];
    if (v.kind !== "wall" || !/\/(v|anchor-v)\d+$/.test(v.id)) continue;
    const [x0, y0, x1, y1] = bbox(v.path);
    const near = hard.filter(({ w, box }) => w.from !== v.from && box[0] < x1 && box[2] > x0 && box[1] < y1 && box[3] > y0);
    if (!near.length) continue;
    const runs = cutWhere(v.path, (pt) => near.some(({ w, m }) => distanceToPath(pt, w.path) < m));
    if (runs.length === 1 && runs[0] === v.path) continue;
    items.splice(k, 1, ...runs.map((path, n) => ({ ...v, id: n ? `${v.id}-${n + 1}` : v.id, path })));
  }

  // A boat on the water where a district's street later bridged the river is taken out again
  {
    const spans = items.filter((i) => i.kind === "crossing").map((c) => ({ at: c.at, r: (c.length ?? 1) / 2 + 0.6 }));
    for (let k = items.length - 1; k >= 0; k--) {
      const b = items[k];
      if (b.kind === "prop" && (b.class === "boat" || b.class === "ship") && b.from === "plan" && spans.some((c) => Math.hypot(c.at[0] - b.x, c.at[1] - b.y) < c.r)) items.splice(k, 1);
    }
  }

  // Each ford's stepping stones (and rocks, frozen), once every way is laid
  const allWays = items.filter((i) => i.kind === "way");
  for (const c of items) if (c.kind === "crossing" && c.class === "ford") Object.assign(c, fordDetail(c, allWays));

  if (battle) {
    // A bridge's parapets: a low stone wall along each side of its deck (a footbridge's wooden rails), stopping
    // movement as any low wall does. Each stands just outside the deck, so its whole width is walked on
    for (const c of items.filter((i) => i.kind === "crossing" && i.class !== "ford" && Array.isArray(i.at))) {
      const a = ((c.angle ?? 0) * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a), hl = (c.length ?? 2) / 2, hw = (c.width ?? 4) / 2 + (c.class === "bridge" ? PARAPET.out : PARAPET.rail);
      if (hw < 0.5) continue;
      [-1, 1].forEach((sg, k) => {
        const at = (u) => [c.at[0] + u * ux - sg * hw * uy, c.at[1] + u * uy + sg * hw * ux];
        const path = [at(-hl), at(hl)];
        items.push(c.class === "bridge"
          ? { kind: "wall", id: `${c.id}/parapet${k + 1}`, from: c.from ?? c.id, class: "stone", path, height: 3 / sq, parapet: true }
          : { kind: "boundary", id: `${c.id}/rail${k + 1}`, from: c.from ?? c.id, class: "fence", path });
        // (a stone bridge's wing walls: at each end of each parapet a short wall splaying out over the bank, holding
        // it back where the deck comes onto it)
        if (c.class === "bridge") [-1, 1].forEach((end, j) => {
          const e = at(end * hl), a2 = Math.atan2(uy, ux) + (end > 0 ? 0 : Math.PI) + sg * end * PARAPET.wingTurn * (Math.PI / 180);
          items.push({ kind: "wall", id: `${c.id}/wing${k + 1}-${j + 1}`, from: c.from ?? c.id, class: "stone", path: [e, [e[0] + Math.cos(a2) * PARAPET.wing, e[1] + Math.sin(a2) * PARAPET.wing]], height: 3 / sq, parapet: true, wing: true });
        });
      });
    }
    castleWorks(items, W, H, plan.seed);
    // (a plan's own scattered rocks, logs and brush that the houses built since have come down on, Quick Start's on a
    // street say, left out: they'd lie on a house's floor)
    {
      const feet = items.filter((i) => i.kind === "building").map(footprint);
      const SCATTERED = new Set(["stump", "log", "branch", "rock", "boulder", "bush", "fern"]);
      let dropped = 0;
      for (let k = items.length - 1; k >= 0; k--) {
        const i = items[k];
        if (i.kind === "prop" && SCATTERED.has(i.class) && i.from === i.id && feet.some((f) => pointInPolygon([i.x, i.y], f))) { items.splice(k, 1); dropped++; }
      }
      if (dropped) notes.push({ level: "info", id: null, message: `${dropped === 1 ? "A rock, log or bush" : `${dropped} rocks, logs and bushes`} of the plan's lay inside buildings and ${dropped === 1 ? "was" : "were"} left out.` });
    }
    battleYards(items, W, H);
    // (the logs, rocks and brush scattered before a building's approach path was laid, kept off it: each by its reach)
    {
      const paths = items.filter((i) => i.kind === "way" && i.approach);
      const REACH = { log: 1.2, boulder: 0.7, rock: 0.5, stump: 0.5, branch: 0.6, roots: 0.5, bush: 0.5, fern: 0.4, leaves: 0.4 };
      if (paths.length) for (let k = items.length - 1; k >= 0; k--) {
        const i = items[k];
        if (i.kind !== "prop" || !i.wild || !(i.class in REACH)) continue;
        if (paths.some((w) => distanceToPath([i.x, i.y], w.path) < (w.width ?? 1) / 2 + REACH[i.class])) items.splice(k, 1);
      }
    }
    buildingInteriors(items, plan.seed, notes);
    // (the words it doesn't know in a building's Upstairs rooms and Cellar rooms too)
    for (const b of items.filter((i) => i.kind === "building" && (i.upstairs || i.cellarRooms) && (i.main || i.id === i.from))) for (const [field, what] of [["upstairs", "upstairs rooms"], ["cellarRooms", "cellar rooms"]]) {
      const unknown = b[field] ? parseRooms(b[field]).unknown : [];
      if (unknown.length) notes.push({ level: "warning", id: b.from ?? b.id, message: `${b.name ?? "A building"}: ${what} not known (${unknown.join(", ")}); they're left out.` });
    }
    for (const b of items.filter((i) => i.kind === "building" && i.rooms)) {
      const { rooms, unknown } = parseRooms(b.rooms);
      if (unknown.length) notes.push({ level: "warning", id: b.from ?? b.id, message: `${b.name ?? "A building"}: rooms not known (${unknown.join(", ")}); they're left out.` });
      if (rooms.length > ROOM.most) notes.push({ level: "warning", id: b.from ?? b.id, message: `${b.name ?? "A building"}: ${rooms.length} rooms named; only the first ${ROOM.most} are laid out.` });
    }
    // What the battle style doesn't draw: left off the map, with a note
    const NOT_YET = { field: "fields", ditch: "ditches", dock: "quays and piers", pit: "pits", kiln: "kilns" };
    const NOT_YET_SURFACE = { park: "parks", bed: "flower beds", farmyard: "farmyards", croft: "crofts" };
    const missing = [...new Set(items.map((i) => NOT_YET[i.kind] ?? (i.kind === "surface" ? NOT_YET_SURFACE[i.class] : i.kind === "boundary" && i.class === "clipped" ? "clipped hedges" : null)).filter(Boolean))];
    if (missing.length) notes.push({ level: "warning", id: "plan", message: `A battle map doesn't draw ${missing.join(", ")} yet; they're left off this map.` });
  }
}
