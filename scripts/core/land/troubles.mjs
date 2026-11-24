/**
 * Troubles on an overland map, for the GM's eyes only: an invasion across an enemy border, rebels in a province far
 * from its capital, a flood on a big river, a plague in a busy port or city and along the way out of it. Each is a shape
 * in map units (a band along a line, or a ring about a point) with a few words, painted hatched on a hidden tile.
 * Chosen from the layout (its realms, relations, provinces, rivers, routes and places) by the seed; how many by the
 * map's Troubles setting. Pure.
 */
import { hashAt } from "../rng.mjs";
import { strHash } from "./notes.mjs";
import { len as hyp } from "./dmath.mjs";

/** How many troubles a map has, by the Troubles setting. */
export const TROUBLE_COUNTS = { none: 0, few: 1, some: 2, many: 4 };
export const TROUBLE_KINDS = ["invasion", "rebels", "flood", "plague"];

/**
 * The map's troubles: [{ kind, text, line ([[u, v], ...]: a band along it, `width` map units wide) | at ([u, v], with
 * `radius`) }]. layout: the overland layout (items, realms, labels, landNames, land, size); count: TROUBLE_COUNTS's key.
 */
export function troublesOf(layout, { count = "none", seed = 1 } = {}) {
  const want = TROUBLE_COUNTS[count] ?? 0;
  if (!want || !layout?.overland) return [];
  const [MW, MH] = layout.size?.squares ?? [1, 1], side = Math.max(MW, MH);
  const R = layout.realms, f = layout.land?.frame;
  const U = f ? (x, y) => [(x - f.margin) / f.mpu, (y - f.margin) / f.mpu] : (x, y) => [x, y];
  const inside = (p) => p[0] >= 0 && p[1] >= 0 && p[0] <= MW && p[1] <= MH;
  const placeName = new Map((layout.labels ?? []).filter((l) => String(l.id).startsWith("@place:")).map((l) => [l.id.slice(7), l.text]));
  const names = layout.landNames ?? {};
  const realmName = (k) => R?.list?.[k]?.name ?? "a realm";
  // (a made name in the middle of a sentence: "the Duchy of Mira")
  const mid = (s) => String(s).replace(/^The /, "the ");
  const cand = [];
  // (an invasion: a disputed border, the realm across it the invader)
  if (R?.borders?.length) R.borders.forEach((b, k) => {
    if (R.kinds?.[k] !== "disputed" || b.length < 3) return;
    const m = b[Math.floor(b.length / 2)];
    // (who's on each side: the grid either side of the line's middle)
    const g = R.grid, idAt = (p) => { const c = Math.floor(p[0] / g.cell), r = Math.floor(p[1] / g.cell); return c >= 0 && r >= 0 && c < g.w && r < g.h ? g.ids[r * g.w + c] : -1; };
    const a = b[Math.max(0, Math.floor(b.length / 2) - 1)], c = b[Math.min(b.length - 1, Math.floor(b.length / 2) + 1)];
    const dx = c[0] - a[0], dy = c[1] - a[1], L = hyp(dx, dy) || 1, off = side / 60;
    const left = idAt([m[0] - (dy / L) * off, m[1] + (dx / L) * off]), right = idAt([m[0] + (dy / L) * off, m[1] - (dx / L) * off]);
    if (left < 0 || right < 0 || left === right) return;
    const [by, of] = hashAt(k, 111, seed) < 0.5 ? [left, right] : [right, left];
    cand.push({ kind: "invasion", text: `${realmName(by)} invades ${mid(realmName(of))}`, line: b, width: side / 22, w: 3 + hashAt(k, 112, seed) });
  });
  // (rebels: a province far from its realm's capital)
  for (const P of R?.provinces ?? []) {
    const cap = R.list[P.realm]?.at;
    if (!cap || !P.seat || !P.spot || R.list[P.realm]?.capital === P.seat) continue;
    const d = hyp(P.spot[0] - cap[0], P.spot[1] - cap[1]);
    const name = names[`province:${P.seat}`];
    if (!name) continue;
    cand.push({ kind: "rebels", text: `Rebels in ${mid(name)}`, at: P.spot, radius: Math.max(side / 30, (P.axis?.length ?? side / 10) / 3), w: 2 + d / side + hashAt(strHash(P.seat) % 1000003, 113, seed) });
  }
  // (a flood: the lower course of the biggest named river in the map)
  // (each river's longest run inside the map, so one that leaves and comes back isn't joined across the gap)
  const longestRun = (pts) => { let best = [], run = []; for (const q of pts) { if (inside(q)) { run.push(q); if (run.length > best.length) best = run; } else run = []; } return best; };
  const rivers = (layout.land?.rivers ?? []).map((r) => ({ r, pts: longestRun(r.points.map((q) => U(q[0], q[1]))) })).filter((x) => x.pts.length >= 6);
  rivers.sort((a, b) => b.pts.length - a.pts.length);
  for (const { r, pts } of rivers.slice(0, 2)) {
    const inv = (layout.land?.inventory ?? []).find((q) => q.kind === "river" && q.river === r.id);
    const name = inv ? names[inv.id] : null;
    if (!name) continue;
    cand.push({ kind: "flood", text: `Flood on ${/^River /.test(name) ? `the ${name}` : mid(name)}`, line: pts.slice(Math.floor(pts.length / 2)), width: side / 30, w: 2 + hashAt(r.id, 114, seed) });
  }
  // (a plague: the biggest port, else the biggest city, and the way out of it)
  const places = (layout.items ?? []).filter((i) => i.kind === "place" && (i.class === "city" || i.class === "town"));
  const ports = places.filter((p) => p.port);
  for (const p of [...new Set([...ports.filter((q) => q.class === "city"), ...places.filter((q) => q.class === "city"), ...ports])].slice(0, 2)) {
    const route = (layout.items ?? []).find((i) => (i.kind === "route" || i.kind === "way") && Array.isArray(i.path) && i.path.some((q) => hyp(q[0] - p.x, q[1] - p.y) < side / 80));
    cand.push({ kind: "plague", text: `Plague in ${placeName.get(p.id) ?? p.name ?? "the city"}`, at: [p.x, p.y], radius: side / 22, ...(route ? { line: route.path, width: side / 45 } : {}), w: 2 + hashAt(strHash(p.id) % 1000003, 115, seed) });
  }
  // (the strongest of each kind first, then the rest, one of a kind before a second)
  const out = [], used = new Set();
  const byKind = TROUBLE_KINDS.map((k) => cand.filter((c) => c.kind === k).sort((a, b) => b.w - a.w));
  const order = TROUBLE_KINDS.map((k, i) => [k, hashAt(i, 116, seed)]).sort((a, b) => a[1] - b[1]).map(([k]) => k);
  for (let round = 0; out.length < want && round < 3; round++) for (const k of order) {
    if (out.length >= want) break;
    const c = byKind[TROUBLE_KINDS.indexOf(k)][round];
    if (!c || used.has(c)) continue;
    used.add(c);
    const { w, ...rest } = c;
    out.push(rest);
  }
  return out;
}
