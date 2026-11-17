/**
 * The illustrated style's colors: summer's, with what spring, autumn and winter change. The map's title tile uses
 * them too.
 */

/** The palette. Summer, with what spring, autumn and winter change. */
export const PALETTE = {
  land: [178, 190, 140], // the country: a soft sage
  urban: [212, 202, 176], // a city's built-up ground
  street: [230, 221, 198],
  edge: [138, 116, 84], // a street's inked edge
  ink: [58, 46, 36],
  paper: [236, 226, 200], // what every color leans toward, so they sit together
  water: [152, 194, 196],
  deep: [128, 176, 184],
  bank: [206, 194, 156],
  waterInk: [70, 112, 122],
  stone: [204, 196, 176],
  shadow: "rgba(66,52,34,0.18)",
  canopy: [104, 132, 78],
  canopyInk: [56, 70, 42],
  lawn: [168, 186, 120],
};
export const SEASON = {
  autumn: { land: [186, 186, 136], canopy: [150, 130, 70], canopyMix: [[170, 112, 58], [128, 132, 70], [176, 146, 66]] },
  winter: { land: [226, 230, 232], urban: [230, 228, 222], street: [244, 244, 242], canopy: [96, 112, 96], lawn: [214, 222, 226], water: [176, 200, 212], deep: [160, 188, 204] },
  spring: { land: [172, 192, 132] },
};
