/**
 * Make This Town: a region map's place as Quick Start's choices for its own map, from what the region knows of its
 * site (its size, river, coast or lake, roads, the land around it and its high ground) and the way each lies, with the
 * facts in plain words for the dialog to show. Pure.
 */
import { CITIES } from "./quick.mjs";
import { apartDeg, THROUGH_APART } from "./directions.mjs";

/** The places a town's map can be made of, and the size each makes. */
export const TOWN_SIZES = { city: "city", town: "town", village: "village", hamlet: "hamlet" };

/** What a region's biome makes of the land around a town. */
const AROUND = {
  glacier: "open", tundra: "open", taiga: "woodland", "cold-steppe": "open", "temperate-forest": "mixed", "temperate-rainforest": "woodland",
  grassland: "farmland", shrubland: "open", "hot-desert": "open", savanna: "open", "seasonal-forest": "mixed", rainforest: "woodland",
  wetland: "mixed", "salt-flat": "open",
};
const BIOME_WORDS = {
  glacier: "ice", tundra: "tundra", taiga: "northern forest", "cold-steppe": "cold steppe", "temperate-forest": "forest and farmland", "temperate-rainforest": "deep forest",
  grassland: "grassland", shrubland: "scrub", "hot-desert": "desert", savanna: "savanna", "seasonal-forest": "forest", rainforest: "rainforest",
  wetland: "wetland", "salt-flat": "salt flats",
};

/** A bearing in words: north, north-east... */
export function compassWord(b) {
  const words = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  return words[Math.round((((b % 360) + 360) % 360) / 45) % 8];
}

const bearing = (v) => (typeof v === "number" && Number.isFinite(v) ? ((v % 360) + 360) % 360 : null);
const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * Quick Start's choices for a place's own map. plan: the region's plan; f: the place (a feature of class city, town,
 * village or hamlet); name: its name as the map shows it (a made name the plan doesn't keep). Returns { options
 * (size, season, water, roads, surroundings, river, high, name, seed), directions (Quick Start's, from its site), facts
 * (phrases that follow "A town": what the region shows of it, "on a large river flowing east", "with roads to the
 * north and west") }, or null for a place that has no map of its own this way.
 */
export function townFromPlace(plan, f, { name = null } = {}) {
  const size = TOWN_SIZES[f?.class];
  if (!size) return null;
  const site = f.site && typeof f.site === "object" ? f.site : {};
  const city = CITIES.includes(size);
  // (the seed from the region's and the place's, so the same place makes the same map)
  const seed = Number(f.seed) || 1 + (Math.abs([...`${plan.seed}:${f.id}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 999999);
  const river = site.river && typeof site.river === "object" ? site.river : null;
  const coast = bearing(site.coast), lakeSide = bearing(site.lakeSide);
  // Its water: the sea first, then a lake's shore, then its river (a small one a stream, but in a city)
  let water = "none";
  if (coast !== null) water = city && river ? "estuary" : "coast";
  else if (site.lake) water = "lake";
  else if (river) water = city || river.size !== "small" ? "river" : "stream";
  const roadsAt = (Array.isArray(site.roads) ? site.roads : []).map(bearing).filter((b) => b !== null);
  // (two roads on the same side of it are a fork: a road through it would leave one of them out)
  const roads = roadsAt.length >= 4 ? "crossroads" : roadsAt.length === 3 || (roadsAt.length === 2 && apartDeg(roadsAt[0], roadsAt[1]) < THROUGH_APART) ? "fork" : "through";
  const surroundings = AROUND[site.biome] ?? "mixed";
  const high = city ? null : site.pass || site.ground === "high" ? "mountains" : site.ground === "hills" ? "hills" : null;
  const options = {
    size, season: plan.season ?? "summer", water, roads, surroundings,
    ...(city && river && site.confluence && water === "river" ? { river: "meeting" } : {}),
    ...(high ? { high } : {}),
    ...(name || f.name ? { name: name || f.name } : {}),
    seed,
  };
  const directions = {
    ...(roadsAt.length ? { roads: roadsAt } : {}),
    ...(river && (water === "river" || water === "stream" || water === "estuary") && (bearing(river.in) !== null || bearing(river.out) !== null) ? { river: { in: bearing(river.in), out: bearing(river.out) } } : {}),
    ...(coast !== null ? { coast } : {}),
    ...(lakeSide !== null ? { lake: lakeSide } : {}),
  };
  // What the region shows, in words
  const facts = [];
  if (river) {
    const way = bearing(river.in) !== null && bearing(river.out) !== null ? ` flowing from the ${compassWord(river.in)} to the ${compassWord(river.out)}` : bearing(river.out) !== null ? ` flowing ${compassWord(river.out)}` : "";
    facts.push(`${site.confluence ? "where rivers meet" : `on a ${river.size ?? "medium"} river`}${way}`);
  }
  if (coast !== null) facts.push(`with the sea to the ${compassWord(coast)}`);
  else if (site.lake) facts.push(lakeSide !== null ? `with a lake to the ${compassWord(lakeSide)}` : "on a lake shore");
  // (each way said once: two roads north are "roads to the north")
  if (roadsAt.length) facts.push(`with ${roadsAt.length === 1 ? "a road" : "roads"} to the ${list([...new Set(roadsAt.map(compassWord))])}`);
  if (site.pass) facts.push("at the foot of a pass");
  else if (site.ground === "hills" || site.ground === "high") facts.push(site.ground === "high" ? "in high country" : "in hills");
  if (site.biome && BIOME_WORDS[site.biome]) facts.push(`among ${BIOME_WORDS[site.biome]}`);
  return { options, directions: Object.keys(directions).length ? directions : null, facts };
}
