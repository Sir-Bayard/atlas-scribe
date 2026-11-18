/**
 * A battle map's animals as tokens: each horse, mule or ox a token of a creature from the GM's own compendiums when one
 * of the names it might go by is there (imported once into an "AtlasScribe animals" folder and reused), else of a plain
 * actor of the system's creature type with no stats. AtlasScribe ships no creatures: what's used is what the GM has
 * installed. The token shows the animal drawn from above, as the map draws it, so it reads as part of the scene.
 */
import { MOD } from "./util.mjs";

/**
 * Each animal: the names a creature for it may have in a compendium, tried in order (exact, any case), and the size
 * of its plain actor's token in squares when none is found.
 */
export const ANIMALS = {
  horse: { label: "Horse", names: ["Riding Horse", "Horse", "Draft Horse", "Warhorse", "War Horse"], size: 2, pf2eSize: "lg" },
  mule: { label: "Mule", names: ["Mule", "Riding Mule", "Donkey", "Pony", "Riding Pony"], size: 1, pf2eSize: "med" },
  ox: { label: "Ox", names: ["Ox", "Draft Ox", "Oxen", "Cattle", "Cow", "Bull"], size: 2, pf2eSize: "lg" },
};

/**
 * What a creature of the scene's dressing needs from the game system: in PF2e, a size its token keeps (PF2e sizes an
 * npc's token from its actor) and no side (an npc is otherwise the party's opposition, so a horse would count as an
 * enemy).
 */
const systemData = (kind) => (game.system?.id === "pf2e" ? { "system.traits.size.value": ANIMALS[kind].pf2eSize, "system.details.alliance": null } : {});

/** The folder AtlasScribe's animals are kept in, among the world's actors. */
export const ANIMAL_FOLDER = "AtlasScribe animals";

/** Compendium entries that are never a creature to place: player characters, hazards, loot and the like. */
const NOT_CREATURES = new Set(["character", "hazard", "loot", "vehicle", "party", "army", "familiar", "group"]);

/**
 * The best compendium entry for an animal: { pack, id, name } or null. Packs of the game system come first, then
 * modules', then the world's; within a pack's turn, the animal's names in order.
 * packs: Foundry's compendium collection (game.packs); system: game.system.id.
 */
export async function findCreature(kind, packs, system) {
  const spec = ANIMALS[kind];
  if (!spec) return null;
  const rank = (p) => ({ system: 0, module: 1, world: 2 }[p.metadata?.packageType] ?? 3);
  const list = [...(packs ?? [])].filter((p) => p.documentName === "Actor" && (!p.metadata?.system || p.metadata.system === system)).sort((a, b) => rank(a) - rank(b));
  const wanted = spec.names.map((n) => n.toLowerCase());
  let best = null;
  for (const pack of list) {
    let index;
    try { index = pack.index?.size ? pack.index : await pack.getIndex({ fields: ["type"] }); } catch { continue; }
    for (const e of index ?? []) {
      if (!e?.name || NOT_CREATURES.has(e.type)) continue;
      const at = wanted.indexOf(String(e.name).toLowerCase());
      if (at < 0) continue;
      const score = rank(pack) * 100 + at;
      if (!best || score < best.score) best = { pack, id: e._id, name: e.name, score };
    }
  }
  return best ? { pack: best.pack, id: best.id, name: best.name } : null;
}

/** The system's actor type for a creature the GM controls: npc where there is one. */
function creatureType() {
  const types = Object.keys(game.system?.documentTypes?.Actor ?? CONFIG?.Actor?.dataModels ?? {}).filter((t) => t !== "base");
  return types.includes("npc") ? "npc" : types.includes("creature") ? "creature" : types.includes("monster") ? "monster" : types[0] ?? "npc";
}

/** AtlasScribe's actor folder, made when it isn't there. */
async function animalFolder() {
  const there = game.folders?.find((f) => f.type === "Actor" && f.getFlag?.(MOD, "animals"));
  if (there) return there;
  return Folder.create({ name: ANIMAL_FOLDER, type: "Actor", flags: { [MOD]: { animals: true } } });
}

/**
 * The world actor an animal's tokens are made from: the one AtlasScribe made or imported for it before, else a
 * creature imported from the compendiums, else a plain actor. img: the drawn animal, for a plain actor's picture.
 * Returns { actor, from: "world" | "compendium" | "plain", name }.
 */
export async function animalActor(kind, { img = null } = {}) {
  const spec = ANIMALS[kind];
  if (!spec) throw new Error(`AtlasScribe: no animal "${kind}"`);
  const kept = game.actors?.find((a) => a.getFlag?.(MOD, "animal") === kind);
  if (kept) return { actor: kept, from: "world", name: kept.name };
  const folder = await animalFolder();
  const found = await findCreature(kind, game.packs, game.system?.id);
  if (found) {
    try {
      const actor = await game.actors.importFromCompendium(found.pack, found.id, { folder: folder.id, flags: { [MOD]: { animal: kind, source: found.pack.collection ?? null } } });
      if (actor) {
        if (actor.getFlag?.(MOD, "animal") !== kind) await actor.setFlag(MOD, "animal", kind);
        // (on its side: no one's; its size the creature's own)
        if (game.system?.id === "pf2e" && typeof actor.update === "function") await actor.update({ "system.details.alliance": null }).catch(() => {});
        return { actor, from: "compendium", name: found.name };
      }
    } catch (e) {
      console.warn(`${MOD} | couldn't import ${found.name} for the ${kind}s: ${e.message}`); // (a plain one stands in)
    }
  }
  const actor = await Actor.create(foundry.utils.expandObject({
    name: spec.label, type: creatureType(), folder: folder.id, ...(img ? { img } : {}),
    prototypeToken: { name: spec.label, width: spec.size, height: spec.size, actorLink: false, disposition: 0, ...(img ? { texture: { src: img } } : {}) },
    flags: { [MOD]: { animal: kind } },
    ...systemData(kind),
  }));
  return { actor, from: "plain", name: spec.label };
}

/**
 * An animal's token data: its actor's prototype token at the animal's place, its box the creature's size, with the
 * animal drawn from above as its picture at the size the map would paint it (no ring), turned as it stands, at the
 * ground's height, neutral, visible, unlinked, flagged as AtlasScribe's (with the plan's prop it stands for).
 * a: { src, x, y (its middle, px from the scene's corner), width, height (its painted size in px), rotation,
 * elevation, kind, id, level }; grid: px a square.
 */
export function animalToken(actor, a, grid, plan) {
  const proto = typeof actor.prototypeToken?.toObject === "function" ? actor.prototypeToken.toObject() : structuredClone(actor.prototypeToken ?? {});
  const w = Number(proto.width) > 0 ? Number(proto.width) : 1, h = Number(proto.height) > 0 ? Number(proto.height) : 1;
  // (Foundry fits the picture inside the box keeping its shape; scaled from there to the painted size)
  const pw = Number(a.width) > 0 ? a.width : grid, ph = Number(a.height) > 0 ? a.height : grid;
  const fitted = Math.min((w * grid) / pw, (h * grid) / ph), scale = Math.round((1 / fitted) * 1000) / 1000;
  return {
    ...proto,
    name: proto.name || actor.name, actorId: actor.id, actorLink: false,
    x: Math.round(a.x - (w * grid) / 2), y: Math.round(a.y - (h * grid) / 2), width: w, height: h,
    elevation: Math.round(a.elevation ?? 0), rotation: Math.round((a.rotation ?? 0) * 100) / 100, lockRotation: false, hidden: false,
    disposition: 0, ...(a.level ? { level: a.level } : {}),
    texture: { ...(proto.texture ?? {}), src: a.src, fit: "contain", scaleX: scale, scaleY: scale },
    ring: { ...(proto.ring ?? {}), enabled: false },
    // (PF2e would size the token from its actor and scale its picture: kept as placed)
    flags: { ...(proto.flags ?? {}), pf2e: { ...(proto.flags?.pf2e ?? {}), linkToActorSize: false, autoscale: false }, [MOD]: { ...(proto.flags?.[MOD] ?? {}), animal: plan, kind: a.kind, ...(a.id ? { piece: a.id } : {}) } },
  };
}
