/**
 * Biomes from temperature, moisture and ground (a Whittaker-like table, as Azgaar's). Temperature here is the
 * climate's at the node (height cools it), so high ground is tundra and ice; the lowland types read the temperature
 * with height's cooling added back, so a warm valley under a range isn't tundra. Wetland where flat, low ground
 * carries a lot of water. Pure.
 */

export const BIOMES = ["glacier", "tundra", "taiga", "cold-steppe", "temperate-forest", "temperate-rainforest", "grassland", "shrubland", "hot-desert", "savanna", "seasonal-forest", "rainforest", "wetland", "salt-flat"];

/** Each biome's middle climate (temperature 0..1, rain as normalized), for zones that react. */
export const BIOME_CLIMATE = {
  glacier: { temp: 0.02, rain: 0.6 }, tundra: { temp: 0.12, rain: 0.4 }, taiga: { temp: 0.25, rain: 0.9 },
  "cold-steppe": { temp: 0.35, rain: 0.25 }, "temperate-forest": { temp: 0.5, rain: 1.0 }, "temperate-rainforest": { temp: 0.5, rain: 1.6 },
  grassland: { temp: 0.55, rain: 0.55 }, shrubland: { temp: 0.6, rain: 0.35 }, "hot-desert": { temp: 0.85, rain: 0.1 },
  savanna: { temp: 0.85, rain: 0.5 }, "seasonal-forest": { temp: 0.85, rain: 0.95 }, rainforest: { temp: 0.92, rain: 1.6 },
  wetland: { temp: 0.5, rain: 1.3 }, "salt-flat": { temp: 0.7, rain: 0.05 },
};

/** The biome at a node. t: temperature there; h: height; rain: normalized; wet: a wetland candidate; salt. */
export function biomeOf(t, h, rain, wet = false, salt = false) {
  if (salt) return "salt-flat";
  if (t < 0.04) return "glacier";
  if (t < 0.14) return "tundra";
  if (wet) return "wetland";
  const tl = t + 0.75 * Math.max(0, h), m = Math.min(1, Math.max(0, rain / 1.6));
  if (tl < 0.22) return m > 0.3 ? "taiga" : "tundra";
  if (tl < 0.36) return m < 0.2 ? "cold-steppe" : m < 0.4 ? "grassland" : "taiga";
  if (tl < 0.7) return m < 0.16 ? (tl > 0.55 ? "hot-desert" : "cold-steppe") : m < 0.3 ? "shrubland" : m < 0.45 ? "grassland" : m < 0.8 ? "temperate-forest" : "temperate-rainforest";
  return m < 0.14 ? "hot-desert" : m < 0.34 ? "savanna" : m < 0.66 ? "seasonal-forest" : "rainforest";
}
