/**
 * What a map holds, in words: the "as built" summary of a plan and its layout (to paste into notes or a build sheet),
 * and a short digest of a layout kept between renders, so the next render can say what changed. Pure: runs anywhere.
 */
import { useLabel } from "./uses.mjs";

/** Names for the kinds of item a summary counts, singular and plural. */
const KINDS = {
  building: ["building", "buildings"], way: ["street or lane", "streets and lanes"], tree: ["tree", "trees"], prop: ["prop", "props"],
  place: ["place", "places"], wall: ["wall", "walls"], tower: ["tower", "towers"], water: ["stretch of water", "stretches of water"], surface: ["patch of ground", "patches of ground"],
};
const plural = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;

/**
 * A layout's digest: for each feature (by the id of what made each item), how many items of each kind it holds, and
 * the map's size and seed. Small enough to keep beside a plan.
 */
export function digestOf(layout) {
  const byFeature = Object.create(null); // (keyed by feature ids, which may be any name: "constructor" too)
  for (const i of layout?.items ?? []) {
    const from = typeof i.from === "string" ? i.from : "(map)";
    const k = typeof i.kind === "string" ? i.kind : "?";
    (byFeature[from] ??= Object.create(null))[k] = (byFeature[from][k] ?? 0) + 1;
  }
  return { size: layout?.size?.squares ?? null, seed: layout?.seed ?? null, features: byFeature };
}

/**
 * What changed between two digests, as short lines: features that came or went, and kinds whose counts moved (most
 * changed first, at most max lines). names: { id: name } for the features' names. Empty when nothing changed.
 */
export function changesBetween(before, after, { names = {}, max = 8 } = {}) {
  if (!before?.features || !after?.features) return [];
  const label = (id) => (Object.hasOwn(names, id) ? names[id] : id);
  const lines = [];
  if (JSON.stringify(before.size) !== JSON.stringify(after.size) && before.size && after.size) lines.push({ w: 1e9, text: `The map's size: ${before.size.join(" by ")} to ${after.size.join(" by ")} squares` });
  const ids = new Set([...Object.keys(before.features), ...Object.keys(after.features)]);
  for (const id of ids) {
    const a = Object.hasOwn(before.features, id) ? before.features[id] : undefined, b = Object.hasOwn(after.features, id) ? after.features[id] : undefined;
    const total = (o) => Object.values(o ?? {}).reduce((s, n) => s + n, 0);
    if (!a) { lines.push({ w: total(b), text: `${label(id)}: new` }); continue; }
    if (!b) { lines.push({ w: total(a), text: `${label(id)}: gone` }); continue; }
    const moved = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => (a[k] ?? 0) !== (b[k] ?? 0));
    if (!moved.length) continue;
    const parts = moved.sort((x, y) => Math.abs((b[y] ?? 0) - (a[y] ?? 0)) - Math.abs((b[x] ?? 0) - (a[x] ?? 0))).slice(0, 3).map((k) => `${KINDS[k]?.[1] ?? k} ${a[k] ?? 0} to ${b[k] ?? 0}`);
    lines.push({ w: moved.reduce((s, k) => s + Math.abs((b[k] ?? 0) - (a[k] ?? 0)), 0), text: `${label(id)}: ${parts.join(", ")}` });
  }
  lines.sort((x, y) => y.w - x.w);
  const shown = lines.slice(0, max).map((l) => l.text);
  if (lines.length > max) shown.push(`and ${lines.length - max} more`);
  return shown;
}

/**
 * The "as built" summary: a plan's name, size and what's in it, district by district, in Markdown. layout: the plan
 * laid out (its notes give each district's streets and houses); scene: the scene's name, when it was published.
 */
export function asBuilt(plan, layout, { scene = null } = {}) {
  const out = [];
  const [W, H] = plan?.size?.squares ?? layout?.size?.squares ?? [0, 0];
  const ft = plan?.size?.ftPerSquare ?? 25;
  out.push(`# ${plan?.name ?? plan?.id ?? "Map"}`, "");
  const region = plan?.kind === "region";
  const span = region ? `${ft} ft (${Math.round((W * ft) / 528) / 10} by ${Math.round((H * ft) / 528) / 10} miles)` : `${ft} ft (${Math.round(W * ft)} by ${Math.round(H * ft)} ft)`;
  out.push(`- ${plan?.kind === "battle" ? "Battle map" : region ? "Region" : "Settlement"}, ${W} by ${H} squares at ${span}, ${plan?.season ?? "summer"}, seed ${plan?.seed ?? "?"}`);
  if (scene) out.push(`- Scene: ${scene}`);
  const items = layout?.items ?? [];
  const count = (kind, f = () => true) => items.filter((i) => i.kind === kind && f(i)).length;
  const totals = region ? `${plural(count("place"), KINDS.place)}, ${plural(count("way"), ["road", "roads"])}` : ["building", "way", "tree"].map((k) => plural(count(k), KINDS[k])).join(", ");
  out.push(`- In all: ${totals}`);
  const feats = plan?.features ?? [];
  const named = (f) => f.name ?? f.id;
  // Districts and what each holds (from the layout's own notes), and the named buildings in each
  const districts = feats.filter((f) => f.type === "district");
  if (districts.length) {
    out.push("", "## Districts", "");
    for (const d of districts) {
      const houses = count("building", (i) => i.from === d.id), streets = count("way", (i) => i.from === d.id);
      const uses = [...new Set(items.filter((i) => i.kind === "building" && i.from === d.id && i.use && !["house", "shed", "barn", "outbuilding"].includes(i.use)).map((i) => useLabel(i.use) ?? i.use))];
      out.push(`- **${named(d)}**${d.character ? ` (${d.character})` : ""}: ${plural(houses, KINDS.building)}, ${plural(streets, KINDS.way)}${uses.length ? `; ${uses.slice(0, 8).join(", ")}` : ""}`);
    }
  }
  // The rest of the plan's features by type
  const groups = [
    ["Places", feats.filter((f) => f.type === "place")],
    ["Roads", feats.filter((f) => f.type === "road")],
    ["Water", feats.filter((f) => f.type === "water")],
    ["Walls", feats.filter((f) => f.type === "wall")],
    ["Squares", feats.filter((f) => f.type === "square")],
    [region ? "Woods, hills and mountains" : "Parks, woods and fields", feats.filter((f) => f.type === "area")],
    ["Buildings and landmarks", feats.filter((f) => f.type === "building" || f.type === "landmark")],
  ].filter(([, l]) => l.length);
  for (const [title, list] of groups) {
    out.push("", `## ${title}`, "");
    for (const f of list) {
      const what = f.class ?? f.use ?? f.type;
      const walls = f.type === "wall" ? layout?.notes?.find((n) => n.id === f.id && /towers?/.test(n.message))?.message.replace(/^"[^"]*": /, "") : null;
      out.push(`- ${named(f)}${what && what !== named(f) ? ` (${what})` : ""}${walls ? `: ${walls}` : ""}`);
    }
  }
  const labels = layout?.labels ?? [];
  if (labels.length) out.push("", "## Labels", "", ...labels.map((l) => `- ${l.text}`));
  return out.join("\n") + "\n";
}
