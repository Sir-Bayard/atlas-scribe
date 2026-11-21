# AtlasScribe guide

The full guide to AtlasScribe: Map Generator. For a quick start, see the [README](../README.md).

- [The window](#the-window)
- [Quick Start: villages and towns](#quick-start-villages-and-towns)
- [Cities](#cities)
- [Overland maps](#overland-maps)
- [Changing the map](#changing-the-map)
- [Features in detail](#features-in-detail)
- [Saving and making scenes](#saving-and-making-scenes)
- [Battle maps](#battle-maps)
- [Caves and dungeons](#caves-and-dungeons)
- [Imports and exports](#imports-and-exports)
- [Battle Map Rules](#battle-map-rules)
- [Art](#art)
- [Settings](#settings)
- [From a script](#from-a-script)

## The window

As the GM, open the Scenes tab and click **AtlasScribe**. The window shows the plan you're working on as a quick sketch in plain colors, with its districts and areas listed on the right. Above the list, the top row has Quick Start (the wand); open, import, save, download and copy the plan; Plan Settings (the gear); the Art window (the pictures); the Files window (the folders); and the summary. The row under it has Draw, the Battle Map tool (on a town map), Reroll All, Undo and Redo. Ctrl+Z undoes, Ctrl+Y redoes, and the Delete key removes the picked feature. The plan you had open comes back with the window, and a draft of your unsaved changes is kept as you work, so after a reload or a crash the window offers it back.

A plan is what you decided: the roads, the water, the districts and what they're like, the buildings and labels you placed. Everything else (side streets, plots, houses, gardens, trees, clutter) is filled in from it each time it's drawn. Every random choice is seeded, so the same plan always gives the same map in this version of AtlasScribe, and each district has its own seed: reroll one and the districts beside it don't move (only trees its new houses and streets crowd can change), and lock the ones you like so a reroll leaves them alone.

## Quick Start: villages and towns

Quick Start's Settlement tab writes a plan from a few choices:

- **Place:** a hamlet, village, town, city or metropolis (see [Cities](#cities)).
- **Season**, **Water** (a river, a stream, a sea coast, a lake shore or none; a city can also have a river meeting the sea) and **Roads** (a crossroads, a road through or a fork). A village, hamlet or town on a sea coast or lake shore has its main road along the shore and a pier with boats at its landing.
- **Center:** a market square, a green, a well or none. A city's can also be a cathedral or a palace beside its square.
- **Around it:** farms and woods, farmland, woodland or open ground. Farmland is laid out in fields, hedged patchwork or open strips. Woods near the place are cleared toward it: scattered trees, stumps, logs and woodpiles, thickening farther off.
- **High ground** (a village or town): none, hills, or mountains with hills before them, along the edge with the most room, short of the houses, farms, fields and water.
- **It has:** Temple, Inn, Smithy, Cemetery, Watermill, Windmill and Walled (a palisade around a village, a town wall around a town). A box you leave alone is as its size has it (half-checked: now and then, by the seed), and Reset puts them all back.
- **Name** and **Seed.**

Set a choice to Any (last in its list) and the seed picks; Place on Any is a hamlet, village or town. River and Outline start on Any. Choices a size can't have are grayed out, with why.

Or type what you want in the **Describe** box ("a walled village called 'Edric's Cross' with a green, a watermill and an inn, in winter"). What it understood shows as chips and is set in the form, where you can change it; a chip's × takes it out, and words it doesn't know are listed and left out.

What you get: a river or stream bends through the country, often with a watermill on its own mill race by the houses; windmills stand among the fields; a town has a cemetery at its edge; and the market square is full of stalls. The square is paved in one of several pavings (cobbles, setts, flagstones, herringbone or plain brick, stone tiles) or, in a poorer place, left as bare ground, and it may be round, a rectangle, an irregular market place, a triangle at a fork or a long market street. Now and then an escarpment runs through the country. A river has gravel shallows on its bends and now and then an island or two; where two rivers meet in a city, the river below is as wide as the two together. Quick Start writes the plan and draws it in about a second.

## Cities

A walled city or a metropolis is made the same way, with more water to choose from (a river through it, a sea coast with a harbor, a lake shore, or a river meeting the sea). A city's river takes one of four shapes, chosen with River or left to the seed: bending through, split around an island at the city's heart (its temple ward often on the island), looping around the city outside its wall all but across a narrow neck, or two rivers meeting inside the walls. A river meeting the sea bends through, splits or meets another, but doesn't loop.

Its outline, chosen with Outline or left to the seed (which picks one that suits the water): compact, lobed and uneven, on a promontory with the sea or a lake on three sides and the wall across its neck (its gates all face the neck, so it has one or two whatever the Roads choice), long along its shore or river, or against a cliff, its wall ending at the cliff on each side.

A wall rings the city with a gate for each main road (a road through gives two, a fork three, a crossroads four; a metropolis two more), the main roads meet at a central market square (a grass square for a village green), a street runs inside the wall, and the inside is cut into wards, each an ordinary district bounded by streets, so you can reroll, lock and reshape any of them.

Each ward gets a character by the city's geography: the market and a temple ward at the center, docks on the water, the garrison by a gate against the wall (sometimes walled in as a citadel), the nobles' High Ward on the quiet side upstream, craft and low wards by the wall and downstream, merchants along the main roads, and homes (named by their side of the city) in between. A metropolis keeps its old inner wall.

A city's center can also be a cathedral or a palace beside its square (the temple's or the nobles' ward takes the square, its great building facing it, and that quarter can't be left out). Clear a quarter and the city has none (no poor quarter, say, and no shanties outside its gates either); ask for a citadel or leave it to the seed; clear the old wall, suburbs, cemeteries or mills to leave them out.

Suburbs grow along the roads outside some gates, with one or two walled or hedged burial grounds by the roads, a watermill on the river, windmills, farms, fields and woods beyond. A city takes a few seconds to draw, a metropolis about 20.

## Overland maps

Quick Start's **Region** tab makes a map miles across. Its **Scale** says how much it covers:

| Scale | The map | A cell |
|---|---|---|
| Kingdom | 240 by 160 miles | 6 miles |
| Realm | 720 by 480 miles | 12 miles |
| Continent | 2,400 by 1,600 miles | 40 miles |
| World | 7,200 by 4,800 miles | 120 miles |
| Local | 40 to 80 miles | half a mile (see [Local regions](#local-regions)) |

From Kingdom to World, the land is generated by a simulation of how land forms:

- Ranges rise where the plates under the land meet.
- Rivers wear valleys into the land over a long age, and join (never split) on their way to the sea or a lake.
- Rain falls on the side of a range the wind comes from, and the far side is drier.
- How warm and wet each place is decides what grows there.

It's painted like a hand-painted map, with forest, grassland, heath, desert, snow on the high peaks, shallows and deep sea, and a key, a compass, a scale bar in miles and a frame. Then towns, villages, castles and ruins, the roads between them, bridges and names are placed where people would put them: cities at river mouths, sheltered harbors and good farmland, roads through passes and along valleys, towns at crossings and crossroads.

### The Region tab

- **Land:** continents, one great continent, many islands, an island, an island arc, a coast, no sea, a peninsula or an inland sea. **Sea Side** places the sea for a coast or a peninsula.
- **Climate** (temperate, cold, warm, dry or tropical) and **Hemisphere**. A world takes **Latitudes** instead: pole to pole (the default), the northern or southern half, or across the equator.
- **Mountains:** none, few, some or many.
- **Towns:** how many towns, villages and castles. **Realms:** none (the default), few, some or many (see [Realms](#realms)).
- **Grid** (hexes or squares), **Size** (the picture's long side: 2,048, 4,096 or 8,192 px), **Names** (see [Names](#names)) and **Season**.
- Under **More:** Age (young land has sharp, high ranges; old land is worn down to hills), Plates, Coast (smooth, some inlets or rugged), Wind, Rain, Rivers, Lakes, Plateaus and Volcanoes.

A choice set to Any lets the seed pick. **Make the Plan** draws the land, then places the towns and roads: at the Medium size, a kingdom in a few seconds and a continent or a world in up to half a minute.

### The land's settings

Plan Settings (the gear) has a **Land** group:

- **Land**, **Sea Side** and **Land Share** (how much of the map is land, from 0.05 to 0.97).
- **Mountains** and **Coast**, each from 0 to 1 (Quick Start's few, some and many are 0.25, 0.5 and 0.8).
- **Age**, **Plates**, **Plateaus**, **Volcanoes**, **Climate**, **Hemisphere**, **Wind**, **Rain**, **Rivers** and **Lakes**.
- **Land Seed:** the land's own seed. Left empty, the land follows the plan's Seed.

A change makes the land again, and the towns, roads and realms the generator placed are placed again on it; any you moved, renamed or changed stay as you left them. One Undo puts both back. **Reroll Land** makes a new land of the same kind from a new land seed. A world's Latitudes are chosen in Quick Start.

Plan Settings also has Scale (one of the four, or your own size, set with the map's size and miles a cell), Grid, Towns, Realms, Names, Key, Label Look (white with a black outline, or map ink), Places and Roads (shows or hides them), and Show Realms.

### Towns and roads

**Place Towns and Roads** (in Plan Settings) places towns, villages, castles, ruins, roads and bridges; once they're placed it's **Reroll Places**. **Towns** sets how many. They're ordinary features of the plan: click a place to rename it or change what it is, drag it to move it (the roads that end at it come along), or delete it, and draw your own places and roads from the Draw palette's Places and Lines. Rerolling replaces only what the generator made and you haven't changed: a place you moved, renamed or edited stays, and the new roads join the roads you kept. A place on land that's now sea is warned about, not moved.

### Realms

**Place Realms** (in Plan Settings, once the map has a city or town) rules realms from its biggest cities and towns: as many as Realms says, or some when it says none. Each grows outward from its capital over the land, so borders fall along ranges, big rivers and coasts, and land no capital reaches cheaply stays wild. A realm is drawn as a dashed border over a light wash of its color, with a crown on its capital and its name in spaced capitals across its land. Click its name to change its name, color or capital (its borders grow again from the new one), or delete it. **Reroll Realms** rules them from other cities and towns, keeping any you renamed, recolored or gave another capital; Reroll Places rules the generator's realms again from its new towns. Turn **Show Realms** off to hide them.

### Names

Every place and the land's seas, bays, lakes, rivers, ranges, forests, islands and realms get a made name. **Names** says how they sound: the English countryside, English places with older-sounding names for the land's rivers, hills and seas, or one invented tongue for the whole map. Made names change when the land is made again, so **Keep the Names** writes them into the plan; a name you type is always kept.

**Name Sets** (in Plan Settings) opens a window for naming rules of your own, kept in the world and copied into each map that uses one. A set is a short block of text:

```
name: Northern Coast
sounds:
  onsets: sk st br dr gr b d g h l m n r s t v
  vowels: a a e i o u
  codas: rn rk ld nd ng st
  syllables: 1-3
elements:
  river mouth: -os
  coast: -nes
kinds:
  castle: {name}borg | {name} Castle
  sea: The {name} Sea
avoid:
  letters: c q w
```

It gives the sounds of its names (or 30 or more `examples:` to learn them from), word parts used where the land shows them (a ford, a river's mouth, a coast, a pass), a pattern for each kind of place or feature, names to use as they are (`names:`), and what a name mustn't have. **New** shows every part with a line saying what it's for, the window shows names the set makes and says when it can make only a few, and **Use on This Map** puts it on the open map. When a set changes in the library, **Update From Library** in Plan Settings brings the change into the map. Quick Start's Names lists your sets too.

### Shaping the land

The Draw palette's **Shape the Land** tools draw what the generator should follow: a **Mountain Range**, point by point along its spine (its height, width in miles, hard rock, age and flanking ridges in its settings); a **Peak** (a lone mountain or, with A Volcano, a cone with a crater); and areas of **Plateau**, **Basin**, **Lowland**, **Make Land**, **Make Sea**, **Hard Rock**, **Climate** (wetter or warmer) and **Biome Zone**. The generator widens and blends them into the land around, so a range rises out of its foothills. A biome zone paints its biome there and changes nothing else; with **The World Reacts** on, it changes the rain and warmth there instead, so the rivers and the land nearby follow. A river drawn with the Water tools is followed too, flowing from its first point to its last: the land is cut to carry it that way, and past its last point it runs on to wherever the water goes. A river drawn up into high ground cuts a valley through it, and one drawn into a lake can lengthen the lake up its own valley. Drawing changes the land, so, as for a setting, the generator's towns, roads and realms are placed again; most of the land stays as it was.

### Keep This Land

The same plan gives the same land in this version of AtlasScribe, but a later version may make land differently. **Keep This Land** (in the Land group) saves the land's heights as a file in the output folder's `lands` folder, and from then on the map is drawn from that file: its coasts, ranges and the valleys its rivers run in stay as they are, whatever later versions do, and it draws faster. Towns, roads, realms and kept names are in the plan already. While a land is kept, the settings that shape it (Land, Mountains, Coast, Age and the rest) and the Shape the Land tools are grayed out; Rain, Rivers and Lakes still work. **Forget the Kept Land** lets the generator make it from its settings again (in this version, the same land); you can keep it again any time, and the old file stays. A plan whose land was made by an older version and wasn't kept says so when it's drawn. To use a kept map in another world, copy its plan, and its folder in `lands` into the `lands` folder of that world's output folder.

### Layer views

With the **Layer Views** setting on, a Layer View list sits beside Outlines, Shapes and Fit once an overland map is drawn: the land's Shading, Uplift (where the land was pushed up), Rain, Temperature, Water Flow, Biomes, Plates and Site Score (where towns score best), to see how the generator made it. **Map** goes back.

### The scene

**Make Scene** paints the map and makes a scene with a grid of hexes or squares in miles. Towns and roads, realms, the key and the map dressing are each a tile of their own over the land, shown to players; hide any of them from the Tiles controls. The map's name is on its own cartouche tile, hidden at first. The names are text drawings, hidden from players until you show them: select them in the Drawings controls and toggle their visibility.

### Make This Town

Click a city, town, village or hamlet and **Make This Town** opens Quick Start's Settlement tab filled in with what the map shows of it: its size and name, its river, coast or lake and which side it's on, the roads and the way each leaves, its hills and the land around it, with **Follow the Map's Directions** checked. A castle's **Make This Castle** makes its battle map. Either one replaces the overland map in the window (you're asked first if it has unsaved changes), so save the map to come back to it.

### Local regions

The Local scale is the classic region from earlier versions: a map 40 to 80 miles across at half a mile a square, with a city and its towns, villages and hamlets, castles, ruins, towers, temples, inns and mines, the highways and roads between them, woods, hills, mountains and marsh, and the sea or a lake, placed by rule rather than generated. Places keep to dry, low ground and their names follow them when moved or renamed. It's drawn in a style of its own, and its scene has a grid in miles. Make This Town works here too. The Draw palette has the places (City to Mine), High Road, Road and Track, and the Land group (Woods, Fields, Hills, Mountains, Marsh).

## Changing the map

Each district and area in the list has a button to reroll it and one to lock it; Reroll All rerolls everything that isn't locked; Undo steps back (up to 50 changes). Click anything on the map (a district, wood, field system, farm, road, river, pond, lake, wall, quay, square, building, bridge, prop or label) or a district or area in the list to open its settings in the side panel; a district, area, pond, lake, sea, road, river, wall or dock can also be reshaped by dragging its corners or points (corners two districts share move together, and bridges follow a moved road or river); drag the dot in a side's middle to add a corner, and alt-click or right-click a corner to remove it; a circle's or ellipse's edge handle sets its size. Shapes shows every handle at once, and Outlines hides or shows the outlines. Scroll to zoom, drag to move, double-click (or Fit) to fit.

### A feature's settings

A feature's panel shows only the settings that thing uses, each showing in gray what applies when it's left empty; a change redraws the map at once (one made while it's still drawing waits its turn), and the arrow beside a setting puts it back to its default. A district's type, gardens, crofts, roofs and street surface; a wood's density (sparse, open, thick or dense) and leafy share; a field system's kind, field size, border and how much is farmed; a road's kind, width and surface; and so on. Less used ones are under More. Delete takes a feature out of the plan (Undo brings it back), and the back arrow returns to the list.

### Drawing

**Draw** adds something new: pick a tool (district, woods, fields, park, cemetery, farm, yard, square, hills, mountains, marsh, cave, dungeon; building, windmill, watermill; road, lane, track, wall, hedge, town wall, palisade, cliff; river, stream, pond, lake, sea, quay, pier, boat, ship; bridge, ford, tree, well, cart, fountain, market cross, crane, label; rise, hollow; campfire, brazier, torch, lamp post, cairn, standing stone, sledge; on a region, the places and high road), then click on the map. A district or area is drawn corner by corner (double-click, Enter or a click on the first corner finishes it) or by dragging a box; its corners snap onto other districts' and areas' corners and sides and onto the map's edge, and where it meets a neighbor along a side each takes the other's corners there, so the two share that side, their streets meet across it, and its corners move together. A road, river or wall is drawn point by point, and its points snap onto a road (water onto water, a wall onto a wall) or the map's edge. Where a new road crosses water, or a new river or stream crosses a road, a bridge is added (a ford where a track or path crosses a stream), unless one is already there; click it to change it or delete it. Bridges and lanes added this way are ordinary features you can change or delete. A district drawn with no road into it and no neighboring streets gets a lane from the nearest road it can reach without running through another district, square, building, yard, park, farm or pond, and a square drawn off the roads inside a district gets a street (a lane in a village or hamlet) from the nearest road into it, so houses line the way to it. Farms, yards, parks, squares and mills out in the country get a faint lane of their own to the nearest road when the map is drawn (none through water, and none where the only way is a long way around). A building is a box, or a click for one of the usual size; a bridge, ford, prop or label is one click (a bridge or ford moves onto the nearest place a road crosses the water). Finish (in the palette) ends a drawing too, Backspace or Delete takes the last point off and Esc cancels. The new feature's settings open when it's drawn.

### Pin

Click a house or a street the generator made (inside a district, away from the plan's own features) and its panel offers Pin. A pinned house becomes a fixed building group in the plan, drawn exactly as it was, which can be named, show its name on the map and have its roof changed; a pinned street or lane becomes a plan road along the same line. Rerolling the district keeps what's pinned and rebuilds around it (a pinned street changes how the district's other streets run). Delete gives the spot back to the generator.

### Underlay

An image under the sketch to trace over (a hand sketch, an old map). Underlay picks an image, fitted inside the map at half opacity; with its panel open, drag it to move it and drag a corner to scale it (it keeps its shape), or type where it sits. Opacity, Shown and Locked are in the panel. It's saved with the plan and never painted into the scene.

### Plan settings

The gear opens the plan's own settings: the name, style, map dressing, season, ground, the map's size, feet and pixels a square, the seed, the labels' color and font, the image file (WebP, or JPEG, which saves several times faster; the default picks JPEG past 24 megapixels) and its quality, and the scene's settings (its name, weather, time of day, darkness, light, fog, token vision, padding and grid). An overland map's also hold its land, towns, realms and names (see [Overland maps](#overland-maps)).

### Limits for now

An ellipse building is drawn as its bounding box (a polygon one is drawn under a gable, its ridge the way it's turned). A turned area can't be reshaped, and a circle or ellipse only changes size. Squares, buildings, bridges and props can't be dragged once drawn: delete one and draw it again. Places and painted peaks can: drag the point (with Shapes on, or once it's picked). A pinned house's buildings change together, not one by one. Drawing and reshaping need a mouse; everything else, including the feature list (its Everything view reaches every feature), works from the keyboard.

## Features in detail

### District character

A district's Character says what it's for, beside its Type (how built up it is): homes (the default), market, merchants, crafts, docks, nobles, temple, poor quarter or garrison. It shifts the odds rather than making the district uniform: the poor quarter has narrow, shallow plots packed tight, thatch and dark shingle, and narrow crooked streets; the nobles have big houses set back in walled grounds with a gravel drive, gardens and orchards; merchants have wide plots and courtyard houses with warehouses behind; the garrison has barracks in ranges around a yard and straight, wide streets; the docks have long warehouses; the market has shops along its streets; a crafts district has workshops and busy yards; a temple district has a big temple in its walled yard. Each also has its own ground (cobbles, bare dirt, trodden earth or lawns), street surface and roof colors, so the quarters read apart at a glance, and the dense ones (market, merchants, crafts, docks, poor quarter) build up the middles of their blocks. In a city, homes, market, crafts and poor quarters (and about half of a merchants' quarter) are built in rows: each house takes its plot's whole street front, the rows turning at the corners, with yards, sheds, gardens and small courts behind.

### Centerpieces

Each character has its great building on its own square, placed before the district's streets, which lead to it and run around it: a cathedral with its cloister before a paved square and fountain (temple), a palace in its walled grounds, entered by a gate, with a court of honor between two wings, pavilions at the corners and a domed one at the middle, and formal gardens behind (nobles), the market square and its hall (market), a guildhall (merchants and crafts), a customs house with cranes (docks), a keep on its parade ground (garrison), a shrine and well (poor quarter). They're drawn larger than life (the cathedral and the palace with green copper roofs). It stands in the middle of its district, off to one side or at its edge (often on a main road), so not every quarter is built around it: its Centerpiece Place setting picks, else the map's seed. Where it stands depends only on that and the district's shape and roads, so a reroll doesn't move it, and it can't be pinned; turn a district's Centerpiece off for none.

### What buildings are for

Every building the generator makes has a use (a house, a shop, an inn, a smithy, a warehouse and so on), shown when you click it, kept when you pin it, and settable on a building you draw. A village or bigger gets its notable buildings by itself: a temple near the green or square (one in a village, one in each town or city district; in a city of ten or more districts about a third get a temple and half an inn and a smithy), an inn where a road runs through, a smithy toward the edge; turn Notable Buildings off in a district for none. Five have a building of their own: a temple (nave, chancel and tower, with transepts when it's big) in a walled yard; a mansion set back in walled grounds; a long warehouse; barracks around a yard; an inn with a stable across its yard. The rest are houses whose yards show their work: crates, barrels, timber, hay, carts, tanning racks, colored dyeing pits, kilns, and smoke from forges, kilns and ovens, all drifting the same way.

### Trades

A district's Trades lists the trades worked there, each placed by its own rule: smiths and farriers by the roads and gates, never under thatch; tanners, dyers and fullers by the water, downstream (a river flows from its first point to its last) and toward the edge; potters and brickmakers toward the edge, with kilns; carpenters, coopers and wheelwrights with timber in their yards; bakers, brewers and butchers near the market; and alchemists, magic shops, laboratories, gunsmiths and inventors. A crafts district given no trades picks a mix of its own.

### Town walls

Draw one with the Town Wall or Palisade tool (click its first point again to close it around), or open a district and click Wall In for a town wall around it, just outside its edge. Wherever a road crosses a wall there's a gate: a gatehouse over the road, or a tower each side of it; where a river or stream crosses, or the wall runs along its bank, the wall stops at a tower on each side; a moat runs on into the water, so a river close along the wall comes right up to it, and a dry ditch stops short of it. Towers stand at its corners and about every 120 feet between (90 for a palisade). Its settings: the thickness and height, the towers (roofed, open with battlements, or some of each), their shape (round, square, some of each, or round at the corners and square between) and spacing, and what runs along its outside (nothing, a dry ditch or a moat, with bridges where the roads cross it, and its width). Each wall picks its own look from its seed unless you set it. A strip of ground along the wall stays clear: houses keep off it, a district's streets stop at the wall, and only roads pass through, at the gates, so two districts with a wall between them don't share streets across it. An open run's outside is on its left going along it from its first point (its "Outside Is on the" setting, under More, turns it around); a closed wall's is outward.

### Water

A river, stream or canal is drawn point by point; its width is at its first point, and End Width (when set) at its last, widening or narrowing smoothly between. A pond, lake or sea is drawn corner by corner or as a box (a pond's or lake's box is the oval inside it; a sea's keeps its straight sides). A sea's corners near the map's edge go past it, so its outline is the coast. Each has a shore (sand, pebbles, rocks, grass, marsh or reeds) picked from its seed unless you set it; the water is lighter in the shallows, the sea has surf along its coast outside winter, and reedy or marshy shores grow reeds. Ponds and lakes freeze in winter unless their Frozen setting is off; the sea doesn't. A river that runs into a lake or the sea opens out there and flows in with no bank. A quay (stone) or wharf (timber) is drawn along the water's edge: its line moves onto the nearest edge of a river, lake or the sea, it's paved back from the water, and houses face it. A pier (stone) or jetty (timber) runs out into the water as drawn. Houses, streets, trees and fields keep off the water and its shore.

### Markets, cemeteries, mills and harbors

A square's Market Stalls setting fills it with stalls in rows (awnings in many colors, a little larger than life so they read on a map of a whole town), with lanes between and goods set out, clear of the roads through it; a market quarter's square has them too. A square's In Its Middle setting puts a fountain or a market cross near its middle, clear of the roads (else picked from its seed: a market square a cross or a fountain). A cemetery is drawn with the Cemetery tool: a gate where the nearest road meets it, a path across it (a cross path in a big one), graves in rows with open patches, yews, tombs beside the paths and a chapel at the far end of a big one, and a drystone wall or a hedge around it (its Border setting). A building whose use is windmill gets sails over its cap; one whose use is watermill gets a wheel on the side facing the nearest river or stream. Boats are moored along quays, wharves, piers and jetties, ships at the sea's, with cranes on stone quays, a few ships at anchor off a harbor and rowboats on a river by the houses; none on frozen water. Ships are drawn in plain shapes where you have no hull art.

### Parks and greens

A park area is a green or a formal garden (its Style). A green can have a feature (a pond, a well, a maypole or a market cross). A formal garden is built from parts, each picked by the seed unless you set it: its layout (quartered, saltire, goose foot, concentric, long canal or compartments), its center (a basin, fountain, statue, sundial or rond-point), its beds (lawn, knot parterres, kitchen beds or an orchard quarter), its edging (hedges, low walls or none) and its planting (an avenue, a quincunx, bosquets or none).

### Hills, mountains and marsh

Drawn as areas. Hills rise in rings of contours, shaded from the northwest, with rocky outcrops on their upper ground; houses can stand on them. Mountains are steep rock with close contours, crags and scree; nothing is built on them. A marsh is damp ground with reeds and pools; nothing is built in it either. On a battle map they're drawn at battle size, and zoomed maps keep them.

### Woods and rivers

A wood's **Cleared Near Town** setting thins it toward the town's nearest houses: scattered trees, stumps, logs and woodpiles close by, thick woods farther off (about 300 feet on a town map, at most 80 on a battle map). A river's or stream's **Shallows** puts gravel bars on the inside of its bends, and **Islands** (0 to 6) puts small islands where it runs wide and straight (on town maps), clear of its bridges, fords, docks, boats and mills.

### Cliffs

Draw one with the Cliff tool along its top edge; the drop is on its left as you draw it (its "Drop Is on the" setting turns it around). Its height sets how wide its face looks from above, and its rock is earthy brown stone or gray slate. An end inside the map dies away over a few squares; an end on the map's edge runs on. Houses, streets, fields and farm lanes keep off it, and the plan check warns about a road that runs over it (no road can climb a cliff).

### Labels

A label is drawn at its true size, in its color and font. Click one, then drag its box to move it or the dot beside it to turn it (hold Shift for steps of 15 degrees). Dropped on a road, river or stream, a label turns to run along it, never upside down (inside a square it stays level). Its settings: the text, Shown To (the GM only or everyone), and its size, turn, color, font and opacity (color and font left empty use the plan's). A district or area can show its name on the map (its "Name on the Map" setting): the label sits inside it, moves with it when it's reshaped and can be dragged off the middle.

### Style and map dressing

A map is drawn in the illustrated style unless the plan's Style says textured or ink. Illustrated draws everything itself: a light palette with ink lines, a town's built-up ground as one pale mass, streets in the tone of their paving (gray cobbles, tan dirt lanes, speckled gravel), squares paved through to their streets, fields marked by their crop (furrows, stubble, stippled grain, grass tufts), clumped trees (bare in winter), water with its banks inked (a river with a dashed ripple down its middle, a lake or the sea with lines following its shore), and a faint paper grain. Ink is the same drawing in black ink on pale paper. Textured paints the map from map art (see [Art](#art)); it's made for battle maps, where its art is at home. An overland map is painted in a style of its own (see [Overland maps](#overland-maps)), and so is a local region. Map dressing (a setting, on for a Quick Start city or metropolis) adds a ruled frame, a compass rose and a scale bar in feet in the map's emptiest corners; the frame takes a narrow margin around the map's edge (about a sixtieth of its shorter side). The map's name goes on a cartouche in another corner as a tile of its own, hidden when the scene is made: show it to the players from the Tiles controls when you're ready.

## Saving and making scenes

**Save** keeps the plan in your world (in the output folder's `plans` folder), to open again later; it opens with the window next time. Plans can also be imported (pasted or from a file, see [Imports and exports](#imports-and-exports)) and downloaded. **Files** lists each saved plan's maps and backups, their sizes, and which one its scene shows; delete the old ones in Foundry's file browser.

**Make Scene** saves the plan, draws the map in its style (painting it with your art, for the textured style) and makes it a scene, with the plan's labels hidden from players (unless a label says otherwise) and a small hidden label on each notable building naming its use ("Inn", "Temple", "Smithy", "Market hall"), or the name you gave it when you pinned it. Where two would overlap, the more telling one stays (a district's centerpiece first, then buildings of their own, then trades, then street-corner shrines and watch posts). Cancel stops the painting. If some art couldn't be had, it says so: on a battle map those parts are drawn, in the textured style painted in plain colors. The scene is in the Scenes tab; the eye button beside Update Scene goes to it. After changes, **Update Scene** repaints that scene (backed up first, as the Scene Backups setting says), and the window says what changed since the last map. The notes from the last Make Scene stay in the window. The **summary** button gives the plan as built (its size, districts and what each holds, roads, water, walls, squares, parks and landmarks) to copy into your notes. A map bigger than the Largest Image setting is also saved in parts, shown in its scene as tiles. The art folders read and the art FA Nexus found are remembered until Foundry reloads or the Art window's **Read the Folders Again** button (the arrows at its top right) is clicked (the folders alone also when the folder list changes), so later scenes and updates don't wait for them again.

**Restoring a backup:** right-click the scene in the Scenes sidebar, choose Import Data, and pick the backup file from the backups folder (the Backup Folder setting, by default `backups` in the output folder). That puts the scene back exactly as it was.

## Battle maps

A battle map is a plan at 5 feet a square, made to fight on. It's painted from your map art (art folders, art you choose, or FA Nexus) and drawn where there's none (see [Art](#art)), and made a scene with its walls, doors, regions, lights and roof tiles. There are three ways to make one:

- **Quick Start's Battle Map tab:** pick a Site (Wilderness, Roadside Building, Village or Town Street, Camp, Castle, Cave, Dungeon; a castle can have roofed or open towers and a moat, which makes its map 12 squares wider each way), its size, the season, time of day, weather and ground, its features (a road, a sunken road, a stream, a pond, a cliff, a rise, a hollow) and how much is scattered over it. Or type what you want in the Describe box ("a roadside inn at night in spring with a stage and a kitchen"): what it understood is set in the form, where you can change it, and words it doesn't know are listed and left out.
- **From a town map:** on a village, town or city, the Battle Map tool takes a box you drag (or a 30, 45 or 60 square one you click to place) and **Make Battle Map** makes that area a battle map, twice true size by default so there's room to fight, and opens it in the window ready for Make Scene. It keeps the town map's streets, water, squares, notable buildings, walls, palisades, cliffs and high ground where they are and builds the rest again at battle size.
- **By hand:** start from a Quick Start battle map (or import a plan with `"kind": "battle"`) and draw on it with the same tools as any map, plus Rise and Hollow for height; Campfire, Brazier, Torch, Lamp Post and Light for light; the story props (Cairn, Standing Stone, Sledge); Horse, Mule, Ox and Picket Line for a camp; Footprints, Hoofprints, Paw Prints and Wheel Ruts for a trail; and the Regions group (Difficult Terrain, Greater Difficult, Hazard, Cover, Squeeze, Note).

What you get:

- **Buildings to fight in:** walls, doors and windows as Foundry walls, rooms divided by what the building is for and furnished, and a roof tile over each that fades when a token walks in. An inn, a mansion, a keep or a tower can have floors above and a cellar, each a level of the scene, joined by stairs.
- **Castles:** a stone town wall is built as a castle's, with a wall walk at 20 feet, towers with a room on every floor, and gatehouses with a portcullis.
- **Height:** rises, hollows, cliffs, banks, sunken roads and stream beds, each a region at its elevation, their faces painted in tiers with a shadow at the foot. With the Battle Map Heights setting a token's elevation follows the ground, and a walker can't go up or down a cliff.
- **The land:** woods at battle size, streams and rivers that wander in their beds, ponds and loose rock, fields in rows, farmyards and docks; in winter, snow, drifts and ice along the streams.
- **Light:** a fire at each hearth, lamps and torches, the plan's own lights, and the plan's Time of Day (day, dawn, dusk, a moonlit night, or a dark night).
- **Props you can move:** carts, wagons, sledges, boats, barrels, crates, bedrolls and tents are tiles the GM can move, turn and resize, as furniture is, and horses, mules and oxen are tokens (the Movable Props on Battle Maps setting; with it off they're painted into the map). An animal's token shows a Forgotten Adventures token through FA Nexus when it has one (with Art From FA Nexus on and whole maps not drawn), else the creature's own token art, else the animal drawn from above at its painted size; it's visible to everyone and neutral, and made from a creature in your compendiums when one matches (the game system's packs first, then modules', then the world's; imported once into the actors' "AtlasScribe animals" folder, where deleting it has it looked for again), else from a plain actor with no stats; an Update leaves a token you've put in a combat or linked to an actor, and doesn't make that animal again. A new map or an Update replaces them, as it does furniture (a scene published from a map's path keeps the ones it had). A wagon is only a tile: it gets no walls.

### Battle map features

- **Sunken roads:** a road's Sunken setting (in feet) cuts it below the ground around it, with a bank or cliff each side, and a region in the cut at its depth; through a rise or a hollow its floor goes up or down with the ground, with a slope between. A stream that crosses it runs under the road. A road at the ground's level that meets it stops at its bank, with no way down: a ramp into the cut is for a later version. Quick Start's Sunken Road feature, or "a sunken road" in the Describe box, makes one.
- **Rises and hollows that touch** are one piece of ground when they're the same height: no edge between them.
- **Part of an edge:** a rise's or hollow's Edge is one kind all the way around; in a plan, `edges` makes a stretch of it another kind, by its corners: `"edges": [{ "from": 3, "to": 5, "edge": "slope" }]` turns the edge from the fourth corner to the sixth into a walkable slope (a ramp in a cliff, a collapse, a breach). Moving or removing a corner keeps the stretches on the corners they were on.
- **Night:** Night is moonlit: a blue darkness with enough light to see by, and fires and lamps warm against it. Dark night is near black, with only the lights you place.
- **Lights:** the Light tool places a light of its own: its bright and dim reach in feet, its color, strength and flicker (torch, flame, pulse, wave, fog), and whether it's lit only in the dark.
- **Regions:** drawn by you, never guessed. Difficult Terrain and Greater Difficult cost a walker double and triple movement; Squeeze costs double; Hazard, Cover and Note are named, colored regions. Each can carry a note, shown to the GM when a token enters. Cover and squeezing have no automation of their own in PF2e, so those carry their name and note.
- **Trails and picket lines:** a trail is a path of prints (footprints, hoofprints, paw prints or wheel ruts) from one end to the other; a picket line is a rope from stake to stake for tying animals to.
- **A prop's turn and size:** at a Turn of 0 a cart, wagon, boat, bedroll or animal runs down the map (a wagon's shafts and an animal's head to the south) and a sledge lies across it; a Turn turns it clockwise. Size is its whole length in feet along its longest side, a wagon's with its shafts: a 25 ft wagon is five squares long.
- **Plan check:** warns when a cart, wagon, tent, animal or other movable prop sits on a rise's or hollow's bank or cliff or on a sunken road's bank (a walkable slope is fine), or reaches into a building, at the size its art draws it unless its Size says otherwise.
- **The summary** lists the plan's regions with their notes, its lights, trails and picket lines.

Limits for now: a big battle map is slow to paint, so the Battle Map tool's box turns amber past 60 squares a side.

## Caves and dungeons

Two of the Battle Map tab's sites, and two Draw tools for areas on any battle map:

- **A cave:** rock carved out by cellular automata. **Open Ground** sets how much is open, from tight twisting passages to wide caverns.
- **A dungeon:** rooms in solid rock joined by corridors, with doors where they meet. **Corridors** (narrow or wide) and **Doors** (none, some or all) set it.
- **Wear** on both (some or none): cracks, rubble, moss and puddles across the floor.

Their rock walls become Foundry walls that block movement and sight, and a dungeon's doors are Foundry doors. Underground, no road, stream, pond, cliff or weather is drawn. The Describe box knows "a damp cave", "a dungeon with narrow corridors" and the like.

## Imports and exports

**Import** (in the window) reads:

- an AtlasScribe plan (JSON, or text with a fenced `mapplan` block);
- a Watabou city or village export (its JSON): its walls, roads, water and districts as a starting plan, built again by AtlasScribe (a script can keep its buildings);
- a Universal VTT file (.dd2vtt, .uvtt, .df2vtt): its walls and doors as stone walls with gaps, its lights, and its image under the sketch.

A scene's menu in the Scenes sidebar has **Export as Universal VTT** (its ground floor's walls, doors and lights, and its map as a PNG) and **Open Its Plan in AtlasScribe**.

## Battle Map Rules

A battle map works in any game system with Foundry's own region behaviors: banks, slopes and shallow water slow walkers and stairs change level. With the Battle Map Heights setting (on by default) deep water is swum, a token's elevation follows the ground and a walker can't go up or down a cliff; with it off, deep water is greater difficult terrain. The Battle Map Rules setting adds the game system's own rules (set it to Foundry's own to leave them out):

- **Pathfinder Second Edition:** the scene's environment (urban, forest or plains) and the places in it of another kind (a wood, deep water, a cellar), so terrain-based abilities see the terrain a token stands in; a scene's environment you set yourself is kept. With PF2E Visioner, fences, low walls and parapets give standard cover.
- **D&D Fifth Edition:** banks, slopes, shallows and ice are the system's own difficult terrain, of its kinds (slope, liquid, ice); the ground is laid as floors so the system's falling knows where a token stands and doesn't take a token on a rise for falling (laid even with Battle Map Rules on Foundry's own, and not for the ground with Battle Map Heights off). A token that jumps off a cliff lands below without the system's falling damage: roll it yourself.
- **Climbing:** a walker stopped at a cliff gets a card, whispered to them and the GM, with an Athletics check at the cliff's Climb DC (15, or 20 for a cut or built face, unless a cliff's own Climb DC setting says otherwise): a button in Pathfinder Second Edition and D&D Fifth Edition, plain words in other systems.
- **Other systems:** Foundry's own rules. A system that automates falling may mark a token standing on raised ground as falling: turn off its falling setting, or AtlasScribe's Battle Map Heights setting, to avoid that.

Another module can add the rules for its system with `registerRules` (see [From a script](#from-a-script)).

## Art

AtlasScribe ships no art. The illustrated style needs none: everything on it is drawn. The textured style and battle maps paint with art you already have: from art folders on your server first, then through FA Nexus when it's installed and the Art From FA Nexus setting is on. Where a battle map has no art for something, AtlasScribe draws it: grass, paving, floors, roofs, water, trees, props and furniture, so a battle map needs no art at all (the textured style paints a plain color instead). The drawn art comes in two looks, set in Configure Settings, AtlasScribe, Drawn Battle Art: Painted (shaded, in natural colors, sitting closest to Forgotten Adventures art) or Inked (pale colors with ink lines, like a town map). Draw Whole Battle Maps draws every battle map entirely, even where you have art, so a map has one look. A map painted from someone's art is for your own table under that art's license.

The Art window (Configure Settings, AtlasScribe, Art, or the pictures button in the AtlasScribe window) has three tabs.

### The Folders tab

The folders AtlasScribe looks in, from any file source Foundry can browse. Until you set your own, it's FA Nexus's download folder (`fa-nexus-assets`) when that exists, so art FA Nexus has downloaded works with FA Nexus turned off. Forgotten Adventures files are found by their file names anywhere in a folder, so a folder of FA's downloaded packs works as it is; FA Nexus fetches only what the folders lack. A folder listed first wins when two have the same file. Click **Add a Folder**, browse to it, then **Save and Read**; **Default** goes back to FA Nexus's folder.

For other art, put an `atlas-scribe.json` manifest in its folder saying which images fill which of AtlasScribe's art roles (the roles are listed in [data/roles/fa-nexus.json](../data/roles/fa-nexus.json), and each role's name shows under it in the Art tab), and how many pixels a square the art is drawn at (left out, 200, Forgotten Adventures' scale):

```json
{
  "atlasScribe": 1,
  "gridPx": 140,
  "roles": {
    "roof.slate": ["roofs/slate-*.webp"],
    "tree.deciduous": ["trees/oaks/"],
    "ground.grass": "ground/grass.jpg"
  }
}
```

Each entry is a path from the manifest's folder (webp, png, jpg and avif images are read): a file, a file name with `*` in it, or a folder ending in `/` (every image under it). Several images for one role are variants (at most 32 are used). Where two manifests name the same role, the first folder in the list wins, and within a folder the manifest nearer its top.

### The Art tab

Every kind of art AtlasScribe paints (its roles, grouped as roofs, trees, props, furniture and so on), each with a picture of what it's painted with now and where that comes from: your art chosen by hand, a rule, a manifest, a folder (Forgotten Adventures files found by name), FA Nexus, or none (drawn on a battle map, a plain color in the textured style). Search it, or show only one kind of source. For any role, choose an image or a folder of images to use instead (several are variants; at most 32 are used), and set the pixels a square your art is drawn at. Each image or folder you chose can be taken off again, or the whole role cleared. A role with seasons or sizes under it (Slate roof, with Slate roof in winter) can use your art for all of them too; otherwise a season's own art is used before yours.

### The Rules tab

Filename rules for a pack with no manifest. A rule gives a role every image in your folders whose name matches its pattern, where `*` stands for anything (`*slate*roof*`), or, when the pattern has a `/`, whose path inside its folder does (`roofs/*slate*`); with the art's pixels a square. Each rule shows how many files it matched; an earlier rule wins a role two rules both name. **Save and Read** applies them.

Which art a role gets: the most specific name first (a season's before the plain role's), and at each name your art chosen by hand, then a rule's, then a manifest's, then Forgotten Adventures files, from your folders or FA Nexus (the Art Order setting can put Forgotten Adventures files before rules and manifests). A name with no art to be had passes on to the next.

## Settings

In Configure Settings, AtlasScribe:

- **Art** (a button): opens the Art window.
- **Output Folder:** where plans, maps, thumbnails and scene backups are saved, under the Data folder. Leave it empty for this world's own `atlas-scribe` folder.
- **Backup Folder** and **Cache Folder:** where scene backups go, and what AtlasScribe remembers between renders to say what changed. Left empty, folders in the output folder.
- **Scene Backups:** every update, the first update in a session, or never. A scene AtlasScribe didn't make is always backed up first.
- **Art From FA Nexus:** let AtlasScribe ask FA Nexus for the Forgotten Adventures files your folders lack. It uses your FA Nexus Patreon connection, downloads into FA Nexus's folder, and may open and close FA Nexus's window during a render.
- **Art Order:** whether a folder's own art (a manifest or rule) or a Forgotten Adventures file comes first for a role.
- **Batch Tag:** a word every scene, tile, wall, light and region AtlasScribe makes is marked with (else each plan's id), for `api.batch`.
- **Largest Image:** a map wider or taller than this is also saved in parts and shown as tiles.
- **Layer Views** (each user's own): a view switch over overland maps in the window, to see how the generator made the land (see [Layer views](#layer-views)).
- **Render in a Worker:** lay out and paint off Foundry's page (the default). Turn it off only if maps fail to render in your browser.
- **Battle Map Zoom** (each user's own): how big a battle map made from an area of a town map is drawn: true size, or bigger so there's room to fight.
- **Drawn Battle Art:** Painted or Inked, for whatever a battle map has no art for.
- **Draw Whole Battle Maps:** draws every battle map entirely, even where you have art, so it has one look.
- **Movable Props on Battle Maps:** carts, wagons, sledges, boats, barrels, crates, bedrolls and tents as tiles to move, as furniture is, and horses, mules and oxen as tokens (the default), or all painted into the map.
- **Battle Map Heights:** a token's elevation follows the ground on battle maps, and walkers are kept off cliffs and out of deep water.
- **Battle Map Rules:** the game system's rules on battle maps, or Foundry's own.

## From a script

The window edits an ordinary plan, a JSON object, so anything it does can also be written into a plan by hand; these calls, from the browser console (F12) or a script macro as a GM, read, check, reroll, preview, render and publish one. Positions are in grid squares from the top left, sizes in feet. Every setting a plan can have, with its range, is listed in `TYPES` in `scripts/core/plan.mjs`. The API is ready from Foundry's `ready` hook (and fires `atlas-scribe.ready` with it).

```js
const as = game.modules.get("atlas-scribe").api;
const plan = { atlasScribe: 1, id: "vance-crossing", name: "Vance's Crossing", size: { squares: [40, 30], ftPerSquare: 25 },
  season: "winter", ground: "snow",
  features: [
    { id: "road", type: "road", class: "street", path: [[0, 15], [40, 15]] },
    { id: "town", type: "district", name: "Kestrel", shape: { rect: [8, 8, 32, 22] } },
    { id: "wood", type: "area", class: "woods", shape: { circle: [6, 5, 5] } },
    { id: "town-name", type: "label", of: "town", size: "large", show: "all" } ] }; // the town's name, over it
as.checkPlan(plan);                    // { plan, problems, ok }: every problem in plain words
await as.preview(plan);                // a quick sketch in a window: reroll and lock there
await as.render(plan, { publish: true }); // paints it, saves it, and makes a new scene
```

- Pass your own `seed` or `id` in a plan a script makes: otherwise every unnamed village gets the same id, and making a second one updates the first one's scene.
- `open()`: opens the AtlasScribe window. `quickPlan({ size, season, water, roads, center, surroundings, river, shape, high, name, seed, has, quarters, outside })` gives `{ plan, choices }` without the window (`has: { inn: true, temple: false }` for a village or town, `quarters: ["market", "docks"]` to keep only those, `outside: { citadel: true, suburbs: false }` for a city); `quickChoices` lists the choices.
- `briefPlan(brief)`: a battle map's plan from Quick Start's Battle Map choices (`{ site, size, season, time, weather, ground, features, trees, litter, rocks, brush, building, street, camp, castle: { towers, moat }, underground: { openness, corridors, doors }, name, seed }`; any left out has a default), giving `{ plan, brief, notes }`. `briefChoices` lists the choices and their labels, and `readDescription(text)` reads words as the Describe box does.
- `landPlan(options)`: an overland plan from Quick Start's Region tab choices (`{ scale, type, seaSide, climate, hemisphere, span, mountains, towns, realms, grid, size, names, nameSet, season, age, plates, coast, wind, rain, rivers, lakes, plateaus, volcanic, name, seed }`; any left out has its default, and `nameSet` is a name set's id or name in the world's library, or `{ name, text }`), giving `{ plan, choices, notes }`. The plan has its land but no towns yet: `landChoices` lists the choices.
- `placeTowns(plan, { seed, density })`: places towns, villages, castles, ruins, roads and bridges on an overland plan, replacing those the generator made that you haven't changed (`density`: few, some or many, else the plan's Towns), and rules its realms again when it has some. `placeRealms(plan, { seed, count })` does the same for realms (`count`: few, some or many, else the plan's Realms). Each gives `{ plan, added, removed, notes }`. A new seed moves them. `const { plan } = as.landPlan({ scale: "realm", type: "coastal", realms: "some", seed: 7 }); const placed = await as.placeTowns(plan, { seed: 7 }); await as.render(placed.plan, { publish: true });`
- `keepLand(plan)`: Keep This Land, giving `{ plan, path }` (the plan with `land.keep`). `keepNames(plan)`: Keep the Names, giving `{ plan, places, features }`.
- `nameSets()` lists the world's name sets (`[{ id, name, text }]`); `checkNameSet(text)` reads one (`{ ok, problems, samples }`); `saveNameSet({ id, text })` saves one (its name from its `name:` line) and gives its id; `deleteNameSet(id)` takes one out of the library (maps keep their copies); `useNameSet(plan, set, { rename })` copies one into a plan (with `rename`, the names it kept are made again by the set); `openNameSets()` opens the Name Sets window.
- `checkPlan(plan)`: reads a plan (an object, JSON text, or text with a fenced `mapplan` block) and lists its problems, errors first. Errors stop a render; warnings don't.
- `render(plan, options)`: lays the plan out and paints it in the background (Foundry stays responsive, with a progress bar), then saves the image to the output folder's `maps` folder. It never writes over a file. `publish: true` also makes a scene; `save: false` paints without saving. It gives `{ path, width, height, tiles, parts, ms, layout, overheads, furniture, mist, levels, drawn, missingArt, artFrom, artNotes, notes, warnings, changed }` (and `scene` when published).
- `publish(plan, { image })`: makes a scene from a rendered map (render's result, or the image's path): the background, the grid, lighting, fog, weather and navigation from the plan's `output.scene`, a thumbnail, and the plan's labels as locked text drawings, hidden from players unless the label says `show: "all"`. Given only an image path, it lays the plan out again for the buildings' use labels, which takes a moment for a big city; if that fails, the scene is made without them and a warning says so.
- To update a scene instead of making a new one, give its id: `publish(plan, { image, scene: "<scene id>" })` (or the same options to `render`). AtlasScribe only changes scenes it made; for any other scene add `force: true`. Before anything changes, the whole scene is saved to the backups folder (as the Scene Backups setting says; always for a scene AtlasScribe didn't make). The scene keeps its name, your own drawings, tokens, walls and lights stay, and the labels AtlasScribe added before (from any plan) are replaced. If the map's size or padding changes, things you placed by hand may no longer line up with it.
- `reroll(plan, ids)`: gives `{ plan, rerolled, skipped }`, the plan a copy with new seeds for those districts or areas (one id or a list), so they're drawn again and nothing else moves. Leave out `ids` to reroll every district and area that isn't locked. `const { plan: next } = as.reroll(plan, "town"); await as.render(next);`
- `lock(plan, ids)` and `unlock(plan, ids)`: a copy of the plan with those features locked or unlocked; a reroll leaves locked ones alone. Seeds and locks are kept in the plan (`seeds`, `locked`), so a plan always draws the same map.
- `openArt()`: opens the Art window. `openFiles()`: opens the Files window. `openPlan(scene)`: opens a scene's plan (or `{ path }` a plan file's) in the window.
- `build(plan)`: lays a plan out without painting: `{ layout, roles, notes }`. `art(plan or roles)`: the art each role would be painted with: `{ art, missing, notes, from }`. `summary(plan or { scene })`: the plan as built, as text.
- `importPlan(input)`: imports a plan, a Watabou export or a Universal VTT file (text or object), its image saved under the output folder: `{ plan, notes, from }`. `exportUVTT(scene, { download })`: a scene as a Universal VTT object.
- `snapshot(scene, { side, tokens, lighting, save })`: a picture of a scene without viewing it: its background, tiles and tokens under its darkness and lights, saved to the output folder's `snapshots` folder (`save: false` gives a data URL instead): `{ path or url, width, height }`. side is its longest side in pixels (2000 unless given, from 64 to 6000, never bigger than the scene itself). Its lighting is AtlasScribe's own, close to Foundry's but not the same: walls don't stop light and there's no vision or fog. It's for comparing maps, not for what players see.
- `planOf(scene)`: the plan a scene was made from; publishing keeps it in the plans folder under its id. `savePlan(plan, { file })`: saves a plan there (by its id unless `file` is given).
- `batch(tag)`: what AtlasScribe made with a batch tag: `[{ id, name, scene, documents }]`.
- `rescanArt()`: reads the art folders again and gives what each holds: `[{ folder, files, dirs, manifests, roles, cut, error, errors }]`.
- `preview(plan, { px })`: opens the plan in the AtlasScribe window (px: the sketch's pixels a square) (see [Changing the map](#changing-the-map)) and gives the window. Copy the Plan puts the plan, with its new seeds and locks, on the clipboard, and the window's `plan` holds it too: `const app = await as.preview(plan); /* reroll until you like it */ await as.render(app.plan, { publish: true });`
- If the window holds a plan you haven't saved, `preview` shows it and asks before replacing it, and throws if you keep it.
- `registerRules(systemId, adapter)`: adds the battle map rules for a game system; what an adapter can give (region behaviors, more regions, the scene's own settings, walls, the climb check, falling) is described at the top of `scripts/foundry/rules.mjs`. A module can also add its adapter on the `atlas-scribe.rules` hook, fired at setup with this function. `rules` names the rules battle maps follow now.
- `cancel()`: stops the job that's running; its promise rejects with an error whose `canceled` is true. One job runs at a time; `busy` says whether one is, and `version` is the module's version.

