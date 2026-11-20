/**
 * Changing a plan from the window: what each feature's settings are (in plain words, with their defaults), setting
 * one, and deleting a feature. Every function returns a new plan and never changes the one it's given. The settings
 * come from TYPES in plan.mjs, so a field added there shows up here; FIELD_TEXT gives each its words.
 * Pure: runs in the worker, on the page and under node.
 */
import { USES, TRADES, useLabel } from "./uses.mjs";
import { TYPES, SURFACES, SEASONS, STYLES, ROOFS, OLD_PROFILES, RUNNING, BODIES, fieldDefault, isObj, normalize, isConifer } from "./plan.mjs";
import { nameLabelsOf, cleanFont } from "./labels.mjs";
import { CHARACTERS, CHARACTER_LABELS, characterOf } from "./character.mjs";
import { BLOCKS } from "./layout/anchors.mjs";
import { NAME_STYLES } from "./land/schema.mjs";
import { SCALES, gridFor, extentOf, MILE_FT } from "./land/units.mjs";
import { untouched, stillNeeded, madeMark } from "./land/places.mjs";

/** The characters that have a centerpiece. */
const ANCHORED = new Set(Object.keys(BLOCKS));

/** What the window calls each use, trade and district character. */
const USE_NAMES = Object.fromEntries(USES.map((u) => [u, useLabel(u).toLowerCase()]));
const TRADE_NAMES = Object.fromEntries(TRADES.map((u) => [u, useLabel(u).toLowerCase()]));
const CHARACTER_NAMES = Object.fromEntries(CHARACTERS.map((c) => [c, CHARACTER_LABELS[c].toLowerCase()]));
/** The district types the window offers (an old plan's "roadside" reads as a hamlet, "core" as a city). */
export const PROFILE_CHOICES = ["hamlet", "village", "town", "city"];

/**
 * Each field's words: label, help (a tooltip), auto (what happens when it's left empty, when that isn't a plain
 * value), more (shown under "More" as less used), values and kind (when the window shows it differently from its
 * spec), names (words for enum values), hidden (never shown: a field the generator ignores for now).
 * Keyed by "<type>.<field>", or "*.<field>" for every type.
 */
/** A formal garden's own fields. */
const FORMAL_FIELDS = new Set(["layout", "center", "beds", "edging", "planting"]);

export const FIELD_TEXT = {
  "*.name": { label: "Name", help: "What the window calls it, in place of its id", auto: "its id" },
  "*.class": { label: "Kind" },

  "road.width": { label: "Width", help: "How wide it is, in feet" },
  "road.surface": { label: "Surface", names: { dirt: "dirt", slush: "slush", snow: "snow", trodden: "trodden earth", cobble: "cobbles", gravel: "gravel", grass: "grass", mud: "mud", flagstone: "flagstones", setts: "square setts", herringbone: "herringbone brick", brick: "brick", tiles: "stone tiles" } },
  "road.ruts": { label: "Cart ruts", help: "Two worn ruts along the middle" },
  "road.straight": { label: "Straight", help: "Straight lines between its points instead of a smooth curve through them" },
  "road.sunken": { label: "Sunken", help: "On a battle map: how many feet below the ground either side it runs, in a cut with a bank each side (a cliff past 5 ft)", auto: "at the ground's level", more: true },

  "water.width": { label: "Width", help: "How wide it is at its first point, in feet" },
  "water.endWidth": { label: "End width", help: "How wide it is at its last point, in feet: it widens or narrows smoothly along the way", auto: "the same all along" },
  "water.widths": { hidden: true }, // a width at each point, for plans written by hand
  "water.shore": { label: "Shore", names: { sand: "sand", pebbles: "pebbles", rocks: "rocks", grass: "grass", marsh: "marsh", reeds: "reeds" }, auto: "picked from its seed" },
  "water.frozen": { label: "Frozen" },
  "water.straight": { label: "Straight", help: "Straight lines between its points (a canal) instead of a smooth curve" },
  "water.depth": { label: "Depth", help: "On a battle map: how far below the ground its bed lies, in feet (0 for none). Its middle is deep water to swim on a river or canal; a stream is shallow all across" },
  "water.banks": { label: "Banks", names: { bank: "steep banks", cliff: "cliffs", slope: "walkable slopes" }, help: "On a battle map: how its banks come down to the water. A cliff stops walkers (they climb, leap or fly); a bank or slope slows them. A bank deeper than 10 ft (where a stream cuts through higher ground) is a cliff" },
  "water.rock": { label: "Bank rock", names: { earthy: "earthy brown stone", slate: "gray slate", mossy: "mossy stone" }, auto: "picked from its seed", more: true },
  "water.ice": { label: "Ice", names: { edges: "along its banks", none: "none" }, help: "On a battle map in winter: shelves of ice along both banks with an open channel between (ice is difficult terrain). Frozen covers it all", auto: "along its banks in winter", more: true },
  "water.climbDC": { label: "Climb DC", help: "On a battle map, where its banks are cliffs: the DC of the check to climb them, shown when a walker is stopped at one", auto: "15, natural rock's", more: true },

  "dock.width": { label: "Width", help: "How wide it is, in feet" },
  "dock.material": { label: "Built of", names: { stone: "stone", wood: "timber" } },

  "crossing.angle": { label: "Angle", help: "Bridges and fords are turned to their road when one crosses the water nearby", more: true },
  "crossing.length": { label: "Length", help: "In feet; a bridge is made long enough for its water whatever this says" },
  "crossing.width": { label: "Width", help: "In feet; a bridge is made at least as wide as its road" },
  "crossing.frozen": { label: "Frozen" },

  "square.surface": { label: "Paving", names: { dirt: "dirt", slush: "slush", snow: "snow", trodden: "trodden earth", cobble: "cobbles", gravel: "gravel", grass: "grass", mud: "mud", flagstone: "flagstones", setts: "square setts", herringbone: "herringbone brick", brick: "brick", tiles: "stone tiles" } },
  "square.radial": { label: "Streets ring it", help: "The district's streets circle the square and run out from it" },
  "square.market": { label: "Market stalls", help: "Stalls in rows across the square, with lanes between, clear of what stands in its middle" },
  "square.middle": { label: "In its middle", help: "A fountain or a market cross near its middle, clear of the roads through it", names: { fountain: "a fountain", cross: "a market cross", none: "nothing" }, auto: "picked from its seed" },

  "building.roof": { label: "Roof" },
  "building.use": { label: "Use", names: USE_NAMES, help: "What it's for: a notable use (an inn, a temple, a trade) gets a hidden label on the scene, for the GM", auto: "a house" },
  "building.rooms": { label: "Rooms", help: "Its rooms on a battle map, in words: \"common room with stage, kitchen, 2 bedrooms, storeroom\". The first meets the front door. Empty: rooms by its use", auto: "rooms by its use" },
  "building.floors": { label: "Floors above", help: "How many floors it has above the ground floor on a battle map, each a level of the scene (0 to 3). Empty: by its use (an inn's guest floor, a keep's two, a big house's now and then)", auto: "by its use" },
  "building.cellar": { label: "Cellar", kind: "tristate", help: "Whether it has a cellar under it on a battle map, a level of its own. Empty: by its use (an inn's, a mansion's, a keep's)", auto: "by its use" },
  "building.upstairs": { label: "Upstairs rooms", help: "The rooms of each floor above, in words: \"7 bedrooms\". Three or more are laid off a corridor. Empty: by its use", auto: "by its use", more: true },
  "building.cellarRooms": { label: "Cellar rooms", help: "The cellar's rooms, in words: \"cellar, storeroom\". Empty: by its use", auto: "by its use", more: true },
  "building.roofStyle": { label: "Roof form" },
  "building.height": { label: "Height", help: "In feet; taller buildings cast longer shadows" },
  "building.chimney": { label: "Chimney", kind: "tristate", auto: "the generator decides" },
  "building.rot": { label: "Turned", help: "Degrees clockwise", more: true },
  "building.variant": { label: "Art piece", help: "Which of the roof art's pieces it uses; else picked from the seed", more: true },
  "building.tower": { label: "Tower", help: "Drawn as a tower: a flat roof inside a parapet (a round one too, if its roof form is flat)", more: true },
  "building.crenels": { label: "Battlements", help: "A tower's parapet notched as battlements", more: true },
  "building.chimneyAt": { hidden: true },
  "district.notables": { hidden: true }, // (Quick Start's: a temple, inn or smithy asked for or left out)
  "district.anchorToward": { hidden: true },
  "building.join": { hidden: true },
  "building.cut": { hidden: true },

  "district.profile": { label: "Type", kind: "enum", values: PROFILE_CHOICES, help: "Hamlet: houses on the roads only. Village: a few lanes, deep plots. Town: long plots with back lanes. City: dense rows and alleys." },
  "district.character": { label: "Character", names: CHARACTER_NAMES, help: "What it's for: shifts its plots, house shapes, gardens, roofs and streets (homes changes nothing)" },
  "district.trades": { label: "Trades", names: TRADE_NAMES, help: "The trades worked there, each placed by its own rule (tanners by the water, smiths by the roads)", auto: "none, or a crafts district's mix" },
  "district.anchor": { label: "Centerpiece", help: "Its character's great building on its own square, placed first so the streets lead to it: a cathedral, a palace, the market square and hall, a guildhall, a customs house, a keep, a shrine" },
  "district.anchorAt": { label: "Centerpiece place", names: { middle: "In the middle", side: "Off to one side", edge: "At its edge" }, help: "Where its centerpiece stands: in the middle, its streets ringing it and leading out from it; off to one side; or at its edge, often on a main road", auto: "picked from the map's seed" },
  "district.notable": { label: "Notable buildings", help: "A temple, an inn and a smithy of its own, as a place its size would have" },
  "district.streets": { label: "Own streets", help: "Lays streets and lanes of its own between the roads through it. Off, it has only the roads and streets drawn in the plan (as on a battle map zoomed from an overview, whose streets came with it)", more: true },
  "district.uses": { label: "Uses", help: "Its character's buildings and trades: warehouses, mansions, workshops, shops. Off, its houses are all plain (as on a battle map zoomed from an overview, whose notable buildings came with it)", more: true },
  "district.gardens": { label: "Gardens", help: "The share of houses with a tended garden (0 to 1)", auto: "its character's" },
  "district.density": { label: "Built up", help: "Below 1, some plots are left empty (0 to 1)", more: true },
  "district.surface": { label: "Street surface", help: "Else the surface of a road through it", auto: "its road's" },
  "district.bend": { label: "Bend", help: "How much its streets wander, in degrees", auto: "its type's", more: true },
  "district.spacing": { label: "Street spacing", help: "How far apart its main streets run, in feet", auto: "its type's", more: true },
  "district.axis": { label: "Street direction", help: "Degrees; its main streets run this way where no road steers them", auto: "from its roads", more: true },
  "district.spacious": { label: "Spacious", help: "Wider plots, houses farther apart (0 to 1)" },
  "district.crofts": { label: "Crofts", help: "The share of plots with a small field behind (0 to 1)", auto: "its type's" },
  "district.croftDepth": { label: "Croft depth", help: "How far back a croft runs, as a share of the plot behind the yard", auto: "its type's" },
  "district.croftFence": { label: "Croft fence", names: { all: "all around", sides: "sides only", none: "none" }, auto: "its type's" },
  "district.plotLines": { label: "Plot lines", help: "Fences around yards and crofts in hamlets and villages, faint walls between long plots elsewhere" },
  "district.roofs": { label: "Roofs", help: "The roof materials its houses choose from", auto: "a mix for its type" },
  "district.roofStyles": { label: "Roof forms", help: "The roof forms its houses choose from", auto: "its type's mix" },

  "area.surface": { label: "Surface", auto: "trodden ground" },
  "area.fence": { label: "Fence", auto: "none" },
  "area.rot": { label: "Turned", help: "Degrees; a turned area can't be reshaped by its corners yet", more: true },
  "area.density": { label: "Density", help: "Sparse: lone trees and small clumps. Open: big trees standing apart, like wood pasture. Thick: groves with clearings. Dense: crowns touching, a few gaps. A wood drawn bigger or smaller keeps its look", auto: "thick", names: { sparse: "sparse", open: "open", thick: "thick", dense: "dense" } },
  "area.trees": { label: "Tree count", help: "A set number of trees, in place of the density (setting one clears the other)", auto: "from its density and size", more: true },
  "area.mix": { label: "Leafy share", kind: "share", key: "bare", help: "The share of leafy trees; the rest are firs (0 to 1)", auto: "by density and season: outside winter half to three quarters leafy (0.5 sparse, 0.75 open, 0.7 thick, 0.6 dense), in winter mostly firs" },
  "area.style": { label: "Style", names: { green: "village green", formal: "formal garden" }, auto: "village green" },
  "water.shallows": { label: "Shallows", help: "Gravel bars on the inside of its bends" },
  "water.islands": { label: "Islands", help: "Small islands where it runs wide and straight, on a settlement map (0 to 6)" },
  "area.cleared": { label: "Cleared near town", help: "Its trees thin toward the town: scattered trees, stumps, logs and woodpiles near it, thick woods farther off" },
  "area.openness": { label: "Open ground", names: { tight: "tight passages", medium: "passages and chambers", open: "wide caverns" }, help: "How much of the cave is open ground" },
  "area.corridors": { label: "Corridors", names: { narrow: "one square", wide: "two squares" } },
  "area.doors": { label: "Doors", names: { none: "none", some: "some", all: "every one" }, help: "Where corridors meet rooms" },
  "area.wear": { label: "Wear", names: { some: "cracks, rubble, moss, puddles", none: "none" } },
  "place.name": { label: "Name" },
  "place.seed": { label: "Its map's seed", help: "The seed Make its map gives the place's own map; else one from the region's", more: true },
  "*.made": { hidden: true }, // (the generator's fingerprint on a place, road or crossing it made: land/places.mjs)
  "place.site": { hidden: true }, // (on generated land: what its own map should know, from Quick Start)
  "terrain.class": { names: { range: "a range", peak: "a peak", land: "land", sea: "sea", basin: "a basin", plateau: "a plateau", lowland: "lowland", hardness: "hard or soft rock", climate: "wetter or warmer", biome: "a biome", lock: "kept as it is" } },
  "terrain.height": { label: "Height", help: "How high it rises: 1 is high mountains" },
  "terrain.width": { label: "Width", help: "The range's core, in miles; foothills reach about four and a half times as far" },
  "terrain.hard": { label: "Hard rock", help: "How slowly it wears: 1 stays sharp however old the land" },
  "terrain.ridges": { label: "Flanking ridges", help: "Lesser ridges beside the spine, 0 to 4", more: true },
  "terrain.age": { label: "Age", names: { young: "young and sharp", mature: "mature", old: "old and worn" } },
  "terrain.radius": { label: "Radius", help: "In miles" },
  "terrain.volcanic": { label: "A volcano", help: "A cone with a crater (a lake in it where it's wet)" },
  "terrain.strength": { label: "Strength", help: "How firmly the land follows it" },
  "terrain.depth": { label: "Depth", help: "How far it sinks: a lake where it's wet, a salt flat where it's dry" },
  "terrain.wetter": { label: "Wetter", help: "More rain here (below 0, less)" },
  "terrain.warmer": { label: "Warmer", help: "Warmer here (below 0, colder)" },
  "terrain.biome": { label: "Biome", help: "Painted here whatever the climate" },
  "terrain.color": { label: "Color", help: "For a biome of your own" },
  "terrain.reacts": { label: "The world reacts", help: "Off: paints this biome here and changes nothing else. On: changes the rain and temperature here, so rivers and nearby land follow. Regenerates the land." },
  "terrain.rot": { label: "Turned", help: "Degrees clockwise", more: true },
  "realm.color": { label: "Color" },
  "realm.capital": { label: "Capital", help: "The place it's ruled from" },
  "area.feature": { label: "On the green", names: { pond: "a pond", well: "a well", maypole: "a maypole", cross: "a market cross", none: "nothing" }, help: "A village green's", auto: "by seed" },
  "area.layout": { label: "Walks", names: { quartered: "quartered", saltire: "saltire", "goose-foot": "goose foot", concentric: "concentric", canal: "long canal", compartments: "compartments" }, help: "A formal garden's", auto: "by seed" },
  "area.center": { label: "Center", names: { basin: "basin", fountain: "fountain", statue: "statue", sundial: "sundial", "rond-point": "rond-point" }, help: "A formal garden's", auto: "by seed" },
  "area.beds": { label: "Beds", names: { lawn: "lawn", parterre: "parterre", kitchen: "kitchen beds", orchard: "orchard" }, help: "A formal garden's", auto: "by seed" },
  "area.edging": { label: "Edging", names: { hedge: "hedge", wall: "low wall", none: "none" }, help: "Around a formal garden's beds", auto: "by seed" },
  "area.planting": { label: "Trees", names: { avenue: "avenue", quincunx: "quincunx", bosquets: "bosquets", none: "none" }, help: "A formal garden's", auto: "by seed" },
  "area.system": { label: "Field system", names: { patchwork: "hedged patchwork", strips: "open strips" }, help: "Else picked from its seed", auto: "by seed" },
  "area.fieldSize": { label: "Field size", help: "About how big a field (or a furlong of strips) is, in feet", auto: "by system" },
  "area.border": { label: "Border", help: "What bounds its fields, or a cemetery: a hedge, a drystone wall or nothing", auto: "by seed" },
  "area.coverage": { label: "Cultivated", help: "The share of its fields that are farmed; the rest is grass (0 to 1)", auto: "0.65" },

  "height.height": { label: "Height", help: "In feet: how far its ground stands above the ground around it (below zero, a hollow). A token's elevation follows it on the scene" },
  "height.edge": { label: "Edge", names: { cliff: "a cliff", bank: "a steep bank", slope: "a walkable slope" }, help: "How its edge comes down. A cliff stops walkers (they climb, leap or fly); a bank or slope slows them", auto: "a bank for 5 ft or less, else a cliff" },
  "height.edges": { hidden: true },
  "region.class": { names: { difficult: "difficult terrain", greater: "greater difficult terrain", hazard: "a hazard", cover: "cover", squeeze: "a squeeze", note: "a note" } },
  "trail.class": { names: { foot: "footprints", hoof: "hoofprints", paw: "paw prints", wheel: "wheel ruts" } },
  "light.bright": { label: "Bright light", help: "How far its bright light reaches, in feet" },
  "light.dim": { label: "Dim light", help: "How far its dim light reaches, in feet (at least as far as its bright light)" },
  "light.color": { label: "Color", kind: "color", help: "Its light's color, like #ffc56b (a lantern's warm yellow)" },
  "light.alpha": { label: "Color strength", help: "How strongly its color tints what it lights, 0 to 1", more: true },
  "light.animation": { label: "Flicker", names: { none: "none", torch: "a torch's", flame: "a fire's", pulse: "a slow pulse", wave: "a wave", fog: "drifting fog" } },
  "light.dark": { label: "Lit after dark", help: "Lit only from dusk on (a lamp's); else always lit" },
  "region.note": { label: "Note", help: "Shown to the GM when a token moves into it: what it is and what it does (\"Squeezing between the wagons\")" },
  "region.rot": { label: "Turned", help: "Degrees clockwise", more: true },
  "height.rock": { label: "Rock", names: { earthy: "earthy brown stone", slate: "gray slate", mossy: "mossy stone" }, auto: "picked from its seed" },
  "height.climbDC": { label: "Climb DC", help: "Where its edge is a cliff: the DC of the check to climb it, shown when a walker is stopped at it", auto: "15, or 20 with sharp corners (a cut or built face)", more: true },
  "height.rot": { label: "Turned", help: "Degrees clockwise; a turned rise can't be reshaped by its corners yet", more: true },
  "height.straight": { label: "Sharp corners", help: "Its corners kept sharp (a quarry's cut, a built terrace); else rounded as ground lies", more: true },

  "wall.height": { label: "Height", help: "In feet" },
  "wall.straight": { label: "Straight", help: "Straight lines between its points (a town wall's runs) instead of a smooth curve" },
  "wall.thickness": { label: "Thickness", help: "How thick the wall is, in feet" },
  "wall.towers": { label: "Towers", names: { roofed: "roofed", open: "open, with battlements", mixed: "some of each" }, auto: "picked from its seed" },
  "wall.towerShape": { label: "Tower shape", names: { round: "round", square: "square", mixed: "some of each", corners: "round corners, square between" }, auto: "picked from its seed (a palisade's are square; on a battle map round at the corners, square between)" },
  "wall.towerSpacing": { label: "Tower spacing", help: "About how far apart its towers stand along a straight run, in feet; there's one at every corner too", more: true },
  "wall.outside": { label: "Outside", names: { none: "nothing", ditch: "a dry ditch", moat: "a moat" }, help: "What runs along its outside" },
  "wall.ditchWidth": { label: "Ditch width", help: "How wide its ditch or moat is, in feet" },
  "wall.side": { label: "Outside is on the", names: { left: "left", right: "right" }, help: "For a wall that isn't a closed loop: which side is outside, going along it from its first point (a closed loop's outside is outward)", more: true, byClass: { cliff: { label: "Drop is on the", help: "Which side of its line the low ground lies, going along it from its first point: its line is the top edge", more: false } } },
  "wall.rock": { label: "Rock", names: { earthy: "earthy brown stone", slate: "gray slate" }, auto: "picked from its seed" },
  "wall.climbDC": { label: "Climb DC", help: "On a battle map: the DC of the check to climb the cliff, shown when a walker is stopped at it", auto: "15, natural rock's" },

  "prop.rot": { label: "Turned", help: "Degrees clockwise. At 0 a cart, wagon, boat, bedroll or animal runs down the map (a wagon's shafts and an animal's head to the south); a sledge lies across it", notFor: ["tree"] }, // a tree is turned at random
  "prop.species": { label: "Tree", kind: "enum", values: ["conifer", "bare"], names: { conifer: "fir", bare: "leafy" }, auto: "leafy" },
  "prop.size": { label: "Size", help: "Its length in feet along its longest side (a wagon's with its shafts; a tree's crown across); else the usual size", more: true },
  "prop.variant": { label: "Look", help: "Which of its pictures it's drawn with, counting from 0 (a tent's cloth, say); else one picked from its seed", auto: "picked from its seed", more: true },

  "label.text": { label: "Text" },
  "label.show": { label: "Shown to", names: { gm: "the GM only", all: "everyone" } },
  "label.size": { label: "Size" },
  "label.angle": { label: "Turn", help: "Degrees clockwise. A label dropped on a road or water turns along it; drag the dot beside a picked label to turn it by hand" },
  "label.color": { label: "Color", kind: "color", help: "Left as the plan's label color unless set" },
  "label.font": { label: "Font", kind: "font", help: "Left as the plan's label font unless set" },
  "label.alpha": { label: "Opacity", help: "Lower for quiet labels, like a wood's or a field's name" },
  "label.of": { hidden: true },
  "label.offset": { hidden: true },
};

/** The plan-wide settings, by path: what the "Plan" panel shows. */
export const PLAN_FIELDS = [
  { path: "name", label: "Name", kind: "string" },
  { path: "season", label: "Season", kind: "enum", values: SEASONS },
  { path: "style", label: "Style", kind: "enum", values: STYLES, names: { illustrated: "illustrated (drawn)", textured: "textured (map art)", ink: "ink (black and white)" }, help: "Illustrated draws the map in ink and color, with no art needed; ink the same in black ink on pale paper, as an engraved map; textured paints it from map art (your art folders, art you choose, or FA Nexus), made for battle maps" },
  { path: "output.dressing", label: "Map dressing", kind: "boolean", help: "A frame, a compass rose and a scale bar painted on the map, and the map's name on a hidden tile (illustrated style)" },
  { path: "@scale", label: "Scale", kind: "enum", values: Object.keys(SCALES), overland: true, required: true, auto: "custom", names: { kingdom: "kingdom (240 x 160 mi, 6 mi cells)", realm: "realm (720 x 480 mi, 12 mi cells)", continent: "continent (2,400 x 1,600 mi, 40 mi)", world: "world (7,200 x 4,800 mi, 120 mi)", custom: "your own size" }, help: "Sets the map's size and its cells. The land is made again at the new size; towns and roads the generator placed go (place them again), and what you placed keeps its spot on the map" },
  { path: "output.grid", label: "Grid", kind: "enum", values: ["hex", "square"], overland: true, auto: "square", names: { hex: "hexes", square: "squares" }, help: "Hexes or squares, in the scene and for the map's size: the map keeps its miles" },
  { path: "land.towns", label: "Towns", kind: "enum", values: ["few", "some", "many"], overland: true, auto: "some", help: "How many towns, villages and castles Place towns and roads puts down" },
  { path: "land.nameStyle", label: "Names", kind: "enum", values: NAME_STYLES, overland: true, names: { english: "English countryside", mixed: "English places, older features", invented: "one invented tongue", custom: "the map's name set" }, help: "How the invented names of places, rivers, ranges, seas and the rest sound (a name set of your own: Name sets). A name you give a place or feature is kept; the others are made from the land, so they change when the land is made again" },
  { path: "output.legend", label: "Key", kind: "boolean", overland: true, help: "A key in a corner of a dressed map: the symbols the map uses (towns, roads, bridges...), with the scale bar at its foot and the compass beside it. It's a tile of its own in the scene; the places it covers have no label" },
  { path: "output.scene.labelLook", label: "Label look", kind: "enum", values: ["bold", "ink"], overland: true, auto: "bold", names: { bold: "White with a black outline", ink: "Map ink: dark with a light outline" }, help: "How the made names look: white reads on any ground; map ink looks more like a printed map. Labels you place keep the Label color" },
  { path: "output.places", label: "Places and roads", kind: "boolean", overland: true, help: "Show the towns, roads and bridges. They're saved as a layer of their own over the land: in the scene a tile you can hide or show, and the land is also saved without them" },
  { path: "ground", label: "Ground", kind: "enum", values: SURFACES },
  { path: "size.squares.0", label: "Width", kind: "number", unit: "squares", min: 1, step: 1, required: true, help: "The map's width in squares" },
  { path: "size.squares.1", label: "Height", kind: "number", unit: "squares", min: 1, step: 1, required: true, help: "The map's height in squares" },
  { path: "size.ftPerSquare", label: "Feet a square", kind: "number", min: 1, max: 100, help: "25 suits a village or town, 5 a battle map" },
  { path: "output.pxPerSquare", label: "Pixels a square", kind: "number", min: 20, step: 1, whole: true, help: "The finished image's grid size, and so its size" },
  { path: "seed", label: "Seed", kind: "number", step: 1, whole: true, help: "Changing it redraws everything that has no seed of its own", more: true },
  { path: "output.format", label: "Image file", kind: "enum", values: ["auto", "webp", "jpeg"], names: { auto: "WebP, JPEG when big", webp: "WebP (smaller)", jpeg: "JPEG (saves faster)" }, more: true, help: "A big map saves several times faster as JPEG" },
  { path: "output.quality", label: "Image quality", kind: "number", min: 0.5, max: 1, step: 0.01, more: true, help: "From 0.5 to 1: higher keeps more detail and makes a bigger file" },
  { path: "output.scene.labelColor", label: "Label color", kind: "color", more: true, help: "Every label's color, unless a label sets its own (on an overland map the names it makes follow Label look; with map ink, its place names take this color)" },
  { path: "output.scene.labelFont", label: "Label font", kind: "font", more: true, help: "Every label's font, unless a label sets its own" },
  { path: "output.scene.name", label: "Scene name", kind: "string", group: "scene" },
  { path: "output.scene.weather", label: "Weather", kind: "string", group: "scene", help: "A Foundry weather effect (snow, rain, fog...), or none; left empty, a battle map in winter snows" },
  { path: "output.scene.time", label: "Time of day", kind: "enum", values: ["day", "dawn", "dusk", "night", "dark"], names: { day: "day", dawn: "dawn", dusk: "dusk", night: "night, moonlit", dark: "a dark night" }, group: "scene", help: "Sets the scene's darkness and light (in place of Darkness and Global light) and lights the lanterns and lamps after dark. A night is moonlit (dim light everywhere); a dark night has no moon" },
  { path: "output.scene.darkness", label: "Darkness", kind: "number", min: 0, max: 1, group: "scene" },
  { path: "output.scene.globalLight", label: "Global light", kind: "boolean", group: "scene" },
  { path: "output.scene.tokenVision", label: "Token vision", kind: "boolean", group: "scene" },
  { path: "output.scene.fog", label: "Fog of war", kind: "boolean", group: "scene" },
  { path: "output.scene.padding", label: "Padding", kind: "number", min: 0, max: 0.5, group: "scene" },
  { path: "output.scene.gridAlpha", label: "Grid strength", kind: "number", min: 0, max: 1, group: "scene" },
];

const textOf = (type, name) => FIELD_TEXT[`${type}.${name}`] ?? FIELD_TEXT[`*.${name}`] ?? {};

/** The feature with this id, or null. */
export function featureOf(plan, id) {
  return (Array.isArray(plan?.features) ? plan.features : []).find((f) => isObj(f) && f.id === id) ?? null;
}

/**
 * A feature's settings as the window shows them: [{ name, label, help, kind, values, names, unit, min, max, value,
 * auto, more }]. value is what the plan says (undefined when left out); auto describes what's used when it's left
 * out (a default value, or words). Only the fields its class uses.
 */
export function fieldsOf(plan, id) {
  const f = featureOf(plan, id);
  const t = f && TYPES[f.type];
  if (!t) return [];
  const out = [];
  // An unknown class is drawn as the type's first, so the window shows that
  const cls = t.classes ? (t.classes.includes(f.class) ? f.class : t.classes[0]) : undefined;
  // Water drawn along a path is a stream, river or canal; drawn as a shape, a pond, lake or sea
  const kinds = f.type === "water" ? t.classes.filter((c) => (Array.isArray(f.path) ? RUNNING : BODIES).includes(c)) : t.classes;
  // (a kind's words where it has them: a region's "squeeze" is "a squeeze")
  const kindNames = textOf(f.type, "class").names;
  if (t.classes) out.push({ name: "class", label: "Kind", kind: "enum", values: kinds, value: cls, auto: t.classes[0], ...(kindNames ? { names: kindNames } : {}) });
  // Water drawn as a shape (a pond, a lake) has no width and nothing to straighten
  const shaped = f.type === "water" && !Array.isArray(f.path);
  for (const [name, spec] of Object.entries(t.fields)) {
    if (spec.only && !spec.only.includes(cls)) continue;
    if (spec.kind === "stretches") continue; // (a height's edge stretches are set in the plan, by its outline's points)
    const base = textOf(f.type, name), txt = base.byClass?.[cls] ? { ...base, ...base.byClass[cls] } : base; // (a class's own words, a cliff's side, say)
    if (txt.hidden || txt.notFor?.includes(cls)) continue;
    // (a centerpiece only where the district's character has one, and not in a hamlet)
    if (f.type === "district" && (name === "anchor" || name === "anchorAt") && (!ANCHORED.has(characterOf(f)) || f.profile === "hamlet" || f.profile === "roadside")) continue;
    if (f.type === "district" && name === "anchorAt" && f.anchor === false) continue; // (no centerpiece, no place for it)
    if (shaped && (name === "width" || name === "straight")) continue;
    // (a green's feature only on a green, a formal garden's parts only on one)
    if (f.type === "area" && f.class === "park" && (name === "feature" ? f.style === "formal" : FORMAL_FIELDS.has(name) && f.style !== "formal")) continue;
    const kind = txt.kind ?? (spec.kind === "enum" ? "enum" : spec.kind);
    const values = txt.values ?? spec.values;
    const dflt = fieldDefault(spec, cls);
    let value = f[name];
    if (kind === "share") value = isObj(f[name]) ? f[name][txt.key] : undefined;
    if (f.type === "district" && name === "gardens" && typeof value === "boolean") value = value ? null : 0; // older plans give true (its character's share)
    if (f.type === "district" && name === "profile" && Object.hasOwn(OLD_PROFILES, value)) value = OLD_PROFILES[value]; // an older plan's name for it
    if (f.type === "prop" && name === "species" && value !== undefined && value !== null) value = isConifer(value) ? "conifer" : "bare"; // "pine" is drawn, and shown, as a fir
    let auto = txt.auto ?? (dflt === null || dflt === undefined ? null : dflt);
    if (f.type === "water" && name === "frozen" && dflt === null) auto = "in winter"; // a pond or lake left unset
    // A label's color and font fall back to the plan's; a name label's text to its feature's name
    if (f.type === "label" && name === "color") { const c = normalize(plan).output.scene.labelColor; auto = /^#[0-9a-f]{6}$/i.test(c ?? "") ? c : "#13202e"; }
    if (f.type === "label" && name === "font") auto = cleanFont(normalize(plan).output.scene.labelFont) ?? "Signika";
    if (f.type === "label" && name === "text" && f.of) { const o = featureOf(plan, f.of); auto = o ? `the name of ${o.name ?? o.id}` : null; }
    out.push({
      name, label: txt.label ?? name, help: txt.help ?? null, kind, values: values ?? null, names: txt.names ?? null,
      unit: spec.unit ?? null, min: spec.min ?? null, max: spec.max ?? null, whole: !!spec.integer,
      value, auto, more: !!txt.more,
    });
    // A landmark's roof, for all its buildings at once (blank when they differ); then, for a district, area or
    // landmark, its name on the map: a label that follows it (listed after its name)
    if (name === "name" && f.type === "landmark") {
      const roofs = new Set((Array.isArray(f.buildings) ? f.buildings : []).map((b) => b?.roof ?? "slate"));
      out.push({ name: ROOF_ALL, label: "Roof", help: "The roof of all its buildings", kind: "enum", values: ROOFS, names: null, unit: null, min: null, max: null, value: roofs.size === 1 ? [...roofs][0] : undefined, auto: roofs.size > 1 ? "mixed" : null, more: false, required: true });
    }
    if (name === "name" && (f.type === "district" || f.type === "area" || f.type === "landmark" || f.type === "place"))
      out.push({ name: NAME_LABEL, label: "Name on the map", help: "A label with its name that sits inside it and moves with it. Click the label to move it, turn it or change its look", kind: "boolean", values: null, names: null, unit: null, min: null, max: null, value: nameLabelsOf(plan, id).length > 0, auto: false, more: false, required: true });
  }
  return out;
}

/**
 * Checks and converts a value from the window for a field ({ kind, values, min, max }). Returns { value } (undefined
 * to leave the field out, so its default applies) or { error }.
 */
export function readValue(field, raw) {
  if (raw === undefined || raw === null || raw === "") return { value: undefined };
  switch (field.kind) {
    case "number":
    case "share": {
      const v = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isFinite(v)) return { error: `${field.label} should be a number.` };
      if (field.whole && !Number.isInteger(v)) return { error: `${field.label} should be a whole number.` };
      const min = field.kind === "share" ? 0 : field.min, max = field.kind === "share" ? 1 : field.max;
      if ((min !== null && min !== undefined && v < min) || (max !== null && max !== undefined && v > max))
        return { error: `${field.label} should be ${max !== null && max !== undefined ? `${min} to ${max}` : `at least ${min}`}.` };
      return { value: v };
    }
    case "boolean":
      return { value: raw === true || raw === "true" || raw === "on" };
    case "tristate":
      return raw === "yes" || raw === true ? { value: true } : raw === "no" || raw === false ? { value: false } : { value: undefined };
    case "enum":
      return field.values.includes(raw) ? { value: raw } : { error: `${field.label} can't be "${raw}".` };
    case "list": {
      const list = (Array.isArray(raw) ? raw : [raw]).filter((v) => field.values.includes(v));
      return { value: list.length ? field.values.filter((v) => list.includes(v)) : undefined };
    }
    case "string":
      return { value: String(raw).trim() || undefined };
    case "font":
      if (!String(raw).trim()) return { value: undefined };
      return cleanFont(String(raw)) ? { value: cleanFont(String(raw)) } : { error: `${field.label} should be a font's name (letters, numbers, spaces, dots and dashes).` };
    case "color":
      return /^#[0-9a-f]{6}$/i.test(String(raw).trim()) ? { value: String(raw).trim().toLowerCase() } : { error: `${field.label} should be a color like #13202e.` };
    default:
      return { error: `${field.label} can't be changed here.` };
  }
}

/**
 * The plan with one of a feature's fields set (value undefined leaves it out, so its default applies). Changing a
 * feature's class drops the settings the new class doesn't use. Returns { plan } or { error }.
 */
export function setField(plan, id, name, raw) {
  const f = featureOf(plan, id);
  if (!f) return { error: `There's no feature "${id}".` };
  const field = fieldsOf(plan, id).find((x) => x.name === name);
  if (!field) return { error: `"${id}" has no setting "${name}".` };
  const { value, error } = readValue(field, raw);
  if (error) return { error };
  if (name === NAME_LABEL) return { plan: withNameLabel(plan, id, value) };
  if (name === ROOF_ALL) {
    if (value === undefined) return { plan };
    const next = structuredClone(plan);
    for (const b of featureOf(next, id).buildings ?? []) if (isObj(b)) b.roof = value;
    return { plan: next };
  }
  // A placed label with no text couldn't be seen or picked again: it keeps its words (Delete takes it out)
  if (f.type === "label" && name === "text" && value === undefined && !f.of) return { error: "A label needs some text (Delete takes it out)." };
  const next = structuredClone(plan);
  const g = featureOf(next, id);
  if (field.kind === "share") {
    const key = textOf(f.type, name).key;
    const obj = isObj(g[name]) ? { ...g[name] } : {};
    if (value === undefined) delete obj[key];
    else obj[key] = value;
    if (Object.keys(obj).length) g[name] = obj;
    else delete g[name];
  } else if (value === undefined) delete g[name];
  else g[name] = value;
  // A river's width at each point (a Quick Start city's) gives way to a width or end width set in the window, which
  // would otherwise do nothing (not to one reset, or entered again as it was)
  if (g.type === "water" && (name === "width" || name === "endWidth") && value !== undefined && value !== f[name]) delete g.widths;
  // A wood's character and its tree count are two ways to say how thick it is: the one set last wins
  if (g.type === "area" && g.class === "woods" && value !== undefined) {
    if (name === "density") delete g.trees;
    if (name === "trees") delete g.density;
  }
  if (name === "class") {
    const t = TYPES[g.type];
    for (const [k, spec] of Object.entries(t.fields)) if (spec.only && !spec.only.includes(g.class ?? t.classes[0])) delete g[k];
  }
  return { plan: next };
}

/** The inspector's setting for a district's or area's name on the map (not a plan field: it adds or takes out a label). */
export const NAME_LABEL = "@nameLabel";

/** The inspector's setting for a landmark's roof (all its buildings at once). */
export const ROOF_ALL = "@roof";

/** The plan with a feature's name label added (on) or taken out (off). */
function withNameLabel(plan, id, on) {
  const had = nameLabelsOf(plan, id);
  if (!!on === had.length > 0) return plan;
  if (!on) return { ...structuredClone(plan), features: plan.features.filter((f) => !(isObj(f) && f.type === "label" && f.of === id)).map((f) => structuredClone(f)) };
  const next = structuredClone(plan);
  const f = featureOf(next, id);
  const taken = new Set(next.features.map((x) => x?.id));
  let lid = `${id}-name`;
  for (let n = 2; taken.has(lid); n++) lid = `${id}-name-${n}`;
  next.features.push({ id: lid, type: "label", of: id, size: f.type === "district" ? "large" : "normal", ...(f.type === "place" ? { offset: [0, 1.2] } : {}) });
  return next;
}

/** The plan without a feature: its seed and its lock go with it, and so do the name labels following it. */
export function deleteFeature(plan, id) {
  const next = structuredClone(plan);
  next.features = (Array.isArray(next.features) ? next.features : []).filter((f) => !(isObj(f) && (f.id === id || (f.type === "label" && f.of === id))));
  if (isObj(next.seeds)) delete next.seeds[id];
  if (Array.isArray(next.locked)) next.locked = next.locked.filter((x) => x !== id);
  return next;
}

const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

/**
 * The plan-wide settings: PLAN_FIELDS with each one's value now (as written) and what applies when it's left out (a
 * region's style and dressing left out: it has its own; its scale in hundreds or thousands of feet).
 */
export function planFieldsOf(plan) {
  const full = normalize(plan);
  const region = plan?.kind === "region";
  const overland = region && plan?.land && typeof plan.land === "object";
  const fields = (!region ? PLAN_FIELDS : PLAN_FIELDS.filter((p) => p.path !== "style" && !(p.path === "output.dressing" && !overland) && !(overland && p.path === "ground"))
    .map((p) => (p.path === "output.dressing" && overland ? { ...p, help: "A frame, a compass rose, a scale bar and the key painted on the map, and the map's name on a hidden tile" } : p))
    .map((p) => (p.path !== "size.ftPerSquare" ? p : overland ? { ...p, min: MILE_FT, max: 120 * MILE_FT, help: "A cell's width: 31680 is 6 miles (a kingdom), 211200 is 40 (a continent). Changing it changes the map's miles; Scale sets both" } : { ...p, min: 500, max: 26400, help: "2640 is half a mile, 5280 a mile" }))).filter((p) => !p.overland || overland);
  return fields.map((p) => ({ ...p, name: p.path, value: p.path === "@scale" ? scaleOf(plan) : getPath(plan, p.path), auto: p.path === "@scale" ? "custom" : getPath(full, p.path) ?? p.auto ?? null }));
}

/** Which scale preset an overland plan is at (its size and cells as the preset makes them), or undefined. */
function scaleOf(plan) {
  const grid = plan?.output?.grid === "hex" ? "hex" : "square", sq = plan?.size?.squares;
  return Object.keys(SCALES).find((k) => { const s = SCALES[k]; const g = gridFor(s.miles, s.cell, grid); return plan?.size?.ftPerSquare === s.cell * MILE_FT && Array.isArray(sq) && sq[0] === g[0] && sq[1] === g[1]; });
}

/**
 * A feature's place, path and shape scaled (to keep a GM's feature where it was on a resized map): every [x, y], a
 * rect's corners, an ellipse's middle and radii, a circle's middle and radius (by the mean of the two scales), and a
 * label's offset from what it follows.
 */
function scaleFeature(f, sx, sy) {
  const r2 = (v) => Math.round(v * 100) / 100;
  const pt = (v) => (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) ? [r2(v[0] * sx), r2(v[1] * sy)] : Array.isArray(v) ? v.map(pt) : v);
  const shape = (s) => {
    if (Array.isArray(s)) return pt(s);
    if (!isObj(s)) return s;
    const o = { ...s };
    if (Array.isArray(o.rect) && o.rect.length === 4) o.rect = [r2(o.rect[0] * sx), r2(o.rect[1] * sy), r2(o.rect[2] * sx), r2(o.rect[3] * sy)];
    if (Array.isArray(o.ellipse) && o.ellipse.length === 4) o.ellipse = [r2(o.ellipse[0] * sx), r2(o.ellipse[1] * sy), r2(o.ellipse[2] * sx), r2(o.ellipse[3] * sy)];
    if (Array.isArray(o.circle) && o.circle.length === 3) o.circle = [r2(o.circle[0] * sx), r2(o.circle[1] * sy), r2(o.circle[2] * Math.sqrt(sx * sy))];
    return o;
  };
  const out = { ...f };
  if (out.at !== undefined) out.at = pt(out.at);
  if (out.path !== undefined) out.path = pt(out.path);
  if (out.offset !== undefined) out.offset = pt(out.offset);
  if (out.shape !== undefined) out.shape = shape(out.shape);
  return out;
}

/** The plan with one plan-wide setting changed. Returns { plan } or { error }. */
export function setPlanField(plan, path, raw) {
  const field = planFieldsOf(plan).find((p) => p.path === path);
  if (!field) return { error: `The plan has no setting "${path}".` };
  const { value, error } = readValue(field, raw);
  if (error) return { error };
  const keys = path.split(".");
  const next = structuredClone(plan);
  // An overland map's scale: its size and cells from the preset; the generator's places go, the GM's keep their spot
  if (path === "@scale") {
    if (value === undefined) return { error: "Pick a scale; the map's own size is set with Width, Height and Feet a square." };
    const s = SCALES[value], grid = next.output?.grid === "hex" ? "hex" : "square";
    const [w0, h0] = extentOf(plan);
    next.size = isObj(next.size) ? next.size : {};
    next.size.squares = gridFor(s.miles, s.cell, grid);
    next.size.ftPerSquare = s.cell * MILE_FT;
    const [w1, h1] = extentOf(next);
    const need = stillNeeded(next.features ?? []);
    next.features = (next.features ?? []).filter((f) => !untouched(f) || need.has(f.id)).map((f) => scaleFeature(f, w1 / w0, h1 / h0));
    // (names kept for the land's features name other features on new land)
    if (isObj(next.land) && isObj(next.land.names)) next.land.names = {};
    if (isObj(next.land)) delete next.land.keptNames;
    return { plan: next };
  }
  // An overland map's grid: its cells are the same size, so it keeps its miles
  if (path === "output.grid" && next.land && typeof next.land === "object") {
    next.output = isObj(next.output) ? next.output : {};
    if (value === undefined) delete next.output.grid; else next.output.grid = value;
    // (the rows stay; the columns are worked out again for the map's width, so switching back and forth is the same map)
    const [w0] = extentOf(plan), rows = normalize(plan).size.squares[1];
    next.size = isObj(next.size) ? next.size : {};
    next.size.squares = [next.output.grid === "hex" ? Math.max(1, Math.round((w0 - 2 / Math.sqrt(3)) / (Math.sqrt(3) / 2) + 1)) : Math.max(1, Math.round(w0)), rows];
    return { plan: next };
  }
  // The map's size is two whole numbers, both always written
  if (path.startsWith("size.squares.")) {
    if (value === undefined || !Number.isInteger(value)) return { error: `${field.label} should be a whole number of squares.` };
    next.size = isObj(next.size) ? next.size : {};
    const sq = Array.isArray(next.size.squares) ? [...next.size.squares] : [...normalize(plan).size.squares];
    sq[Number(keys[2])] = value;
    next.size.squares = sq;
    return { plan: next };
  }
  let o = next;
  for (const k of keys.slice(0, -1)) {
    if (!isObj(o[k])) o[k] = {};
    o = o[k];
  }
  const last = keys[keys.length - 1];
  if (value === undefined) delete o[last];
  else o[last] = value;
  return { plan: next };
}

/** Which names an overland plan keeps from Keep names, still as kept: { places: Set of ids, land: Set of ids }. */
function keptIds(plan) {
  const k = isObj(plan?.land?.keptNames) ? plan.land.keptNames : {}, kp = isObj(k.places) ? k.places : {}, kl = isObj(k.land) ? k.land : {};
  const named = (n) => typeof n === "string" && n.trim();
  // (the generator's places that keep a name and haven't been changed since, and the GM's places Keep names named,
  // still with that name; a name the GM typed or changed is the GM's)
  const places = new Set((plan?.features ?? []).filter((f) => f?.type === "place" && named(f.name) && (untouched(f) || kp[f.id] === f.name)).map((f) => f.id));
  const names = isObj(plan?.land?.names) ? plan.land.names : {};
  const land = new Set(Object.keys(names).filter((id) => named(names[id]) && kl[id] === names[id]));
  return { places, land };
}

/**
 * The names an overland plan keeps (Keep names) that a name set could make again: { places, features }, how many.
 * Names the GM typed or changed aren't counted.
 */
export function keptNamesOf(plan) {
  const { places, land } = keptIds(plan);
  return { places: places.size, features: land.size };
}

/**
 * The plan with a name set of the GM's copied into it ({ name, text, from: its library id or null }), its names now
 * made by it. With rename, the names it kept (keptNamesOf) go too, so the set names those again; a place the GM
 * renamed or changed keeps its name. Returns { plan } or { error }.
 */
export function withNameSet(plan, set, { rename = false } = {}) {
  if (plan?.kind !== "region" || !isObj(plan.land)) return { error: "A name set is for an overland map (a region plan with land)." };
  if (!set || typeof set.text !== "string" || !set.text.trim()) return { error: "That name set is empty." };
  const next = structuredClone(plan);
  next.land.nameSet = { name: typeof set.name === "string" && set.name.trim() ? set.name.trim() : "Name set", text: set.text, ...(set.from ? { from: set.from } : {}) };
  next.land.nameStyle = "custom";
  if (rename) {
    const { places, land } = keptIds(plan);
    for (const f of next.features ?? []) {
      if (f?.type !== "place" || !places.has(f.id)) continue;
      const generated = untouched(f);
      delete f.name;
      if (generated) f.made = madeMark(f);
    }
    if (isObj(next.land.names)) for (const id of land) delete next.land.names[id];
    delete next.land.keptNames;
  }
  return { plan: next };
}

/** Words for a value shown in the window ("hedged patchwork", "250 ft", "village green"). */
export function wordsFor(field, v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (field.names && v in field.names) return field.names[v];
  if (typeof v === "boolean") return v ? "yes" : "no";
  return field.unit === "ft" ? `${v} ft` : String(v);
}

