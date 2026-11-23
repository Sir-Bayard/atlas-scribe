/**
 * An overland scene's views: the physical map (the land, with each realm's color as a band along its borders), the
 * political map (realms in flat color, provinces and capitals) and the cultural map (each culture's land in its own
 * color), the last two tiles over the map that the GM switches between from the labels layer's controls. Pure.
 */

/** The views, in the order the controls show them. */
export const VIEWS = [
  { id: "physical", label: "Physical", icon: "fa-solid fa-mountain-sun" },
  { id: "political", label: "Political", icon: "fa-solid fa-flag" },
  { id: "cultural", label: "Cultural", icon: "fa-solid fa-people-group" },
];

/** The layer tiles each view shows: its own, and the realms' band only on the physical map. */
const SHOWS = { physical: ["realms"], political: ["political"], cultural: ["cultural"] };

/**
 * The tile changes that show a view: tiles: [{ id, layer (the tile's AtlasScribe layer name, or null), alpha }]. A view
 * is switched by the tiles' opacity, not by hiding them, since the GM sees hidden tiles faintly: the political and
 * cultural tiles are clear except in their view, the realms' band only in the physical view (hidden or shown to
 * players as the plan says). Returns [{ _id, alpha }] for the tiles that change.
 */
export function viewChanges(tiles, view) {
  const shows = new Set(SHOWS[view] ?? SHOWS.physical), out = [];
  const switched = new Set(["political", "cultural", "realms"]);
  for (const t of tiles ?? []) {
    if (!t || !switched.has(t.layer)) continue;
    const alpha = shows.has(t.layer) ? 1 : 0;
    if (alpha !== (Number.isFinite(t.alpha) ? t.alpha : 1)) out.push({ _id: t.id, alpha });
  }
  return out;
}

/** The view a scene shows now, from its tiles: political or cultural when that tile shows, else physical. */
export function viewOf(tiles) {
  for (const v of ["political", "cultural"]) if ((tiles ?? []).some((t) => t?.layer === v && (Number.isFinite(t.alpha) ? t.alpha : 1) > 0)) return v;
  return "physical";
}
