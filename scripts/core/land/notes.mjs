/**
 * A short note for each point of interest on an overland map: what it is and a hook the GM can use, in plain words,
 * chosen by the seed from a few for each kind. The GM keeps, changes or clears it in the window; the gazetteer writes
 * it out. Pure.
 */

/** Notes by class: each a sentence or two. */
export const SITE_NOTES = {
  hamlet: ["A handful of farms. The families here know every path through the hills.", "A few houses around a well. Strangers are rare and watched closely.", "Herders' cottages. A child here has gone missing, and no one will say where."],
  inn: ["A coaching inn on the road. Its keeper trades in rumors as much as ale.", "A roadside inn with a good stable. Travelers who stop here sometimes leave without their horses.", "An old inn with a bricked-up cellar the owner won't talk about."],
  mine: ["A working mine. The miners have broken into older tunnels than their own.", "A mine gone quiet after a collapse. Its owner wants it opened again, quietly.", "A rich seam, fought over by two families from the nearest town."],
  quarry: ["A stone quarry. Its stone built the nearest town, and something was found in the last cut.", "A quarry worked by convicts. Escapes are more common than the warden admits.", "An abandoned quarry, now a pool deep enough to hide things."],
  tower: ["A watchtower over the road. Its garrison is short of men and long on stories.", "A beacon tower. When its fire is lit, the countryside arms itself.", "A ruined tower. A light shows in its top on moonless nights."],
  fort: ["A border fort. Its commander answers to no one nearer than the capital.", "A fort holding a crossing. Supplies have not come in weeks.", "An old fort, half garrisoned, half crumbling."],
  temple: ["A wayside shrine. Pilgrims leave offerings and sometimes messages.", "A small temple. Its priest asks travelers for news of a missing acolyte.", "A shrine at a spring said to heal. It is busier than it should be."],
  monastery: ["A monastery in high country. Its library is the best for many days' travel.", "A walled monastery. The monks take in travelers and ask nothing of them, at first.", "A monastery that has stopped answering its bell."],
  lighthouse: ["A lighthouse on the headland. Its keeper logs every ship that passes.", "A lighthouse whose light failed one night. Wreckers were seen on the beach.", "A lighthouse kept by one old woman, who sees more than ships."],
  customs: ["A customs house on the border. The toll is fixed; the bribe is not.", "A customs post where two realms argue over every cart.", "A customs house that smugglers go around, and some of its guards help them."],
  battlefield: ["An old battlefield. Farmers still plow up arrowheads and worse.", "A battlefield both realms claim they won. A monument here was defaced last spring.", "A field where an army vanished. No one camps here."],
  stones: ["A ring of standing stones. Their shadows point somewhere at midsummer.", "Standing stones the locals won't plow near.", "A line of stones marching into the hills, older than any road."],
  barrow: ["Old barrows on the ridge. One has been opened recently.", "A grave mound with a stone door. The door has no handle on the outside.", "Barrows the locals leave offerings at, to keep their dead quiet."],
  wreck: ["A wreck on the rocks. Its cargo was never recovered.", "A ship run aground in a storm. Its crew came ashore; its captain did not.", "An old hulk, home now to something that doesn't like visitors."],
  lair: ["A beast's lair. Livestock have gone missing for miles around.", "A cave where something large sleeps through the winter.", "A lair in the rocks, its floor littered with old bones and older coins."],
  cave: ["A cave system that runs deeper than anyone has mapped.", "A cave with paintings on its walls. Some of them are new.", "A cave mouth that breathes cold air, even in summer."],
  grove: ["A sacred grove. Cutting a branch here is a crime to the people nearby.", "A grove around a single great tree. Druids meet here at the turn of seasons.", "A grove where birds don't sing."],
  camp: ["A brigands' camp. They take tolls on the road and favors from the town nearby.", "Outlaws in the woods. Their leader was once a soldier of the realm.", "A camp of deserters who will trade, if approached carefully."],
  cove: ["A pirates' cove. Ships that anchor here don't fly their colors.", "A hidden cove with a smugglers' path up the cliff.", "A cove where the pirates of the coast meet to divide their takings."],
  monster: ["Something lives here that the maps warn of. Few who look for it come back.", "A creature's hunting ground. The bounty for it grows every season.", "A place travelers avoid. The tracks here belong to nothing anyone can name."],
};

/** A point of interest's note: one of its class's, by a hash of its id and the seed. Returns a string, or null for a class with none. */
/** A whole string's hash (FNV-1a), for a seed-steady choice by an id. */
export function strHash(id, seed = 0) {
  let h = 2166136261 ^ (Number(seed) | 0);
  for (const c of String(id)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

export function siteNote(cls, id, seed) {
  const list = SITE_NOTES[cls];
  if (!list) return null;
  return list[strHash(id, seed) % list.length];
}
