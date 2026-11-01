# AtlasScribe: Map Generator

A map plan in, a map out, inside Foundry VTT.

You decide what matters: where the roads run, the river and its crossings, the square, the walls and gates, the landmarks, and what each district is like. AtlasScribe fills in everything nobody wants to place by hand (side streets, plots, houses, gardens, trees and clutter) and paints the map from the map art you already have. Every random choice is seeded, so the same plan always gives the same map, and each district has its own seed: reroll one and the districts beside it don't move (only trees its new houses and streets crowd can change), and lock the ones you like so a reroll leaves them alone.

It's system agnostic and GM only.

## Status

**Early development.** Villages and towns work (0.4.0): make one with Quick Start, change anything on the map in the AtlasScribe window, and make it a scene. Cities come next, then battle maps; the first full release, 1.0.0, comes when settlements, cities, battle maps and a painted style for city maps all work.

What's done and what's planned, in order:

1. Done: the engine, a plan file rendered into a scene without freezing Foundry.
2. Done: Quick Start, a hamlet, village or town from a few choices, with generated streets, plots, houses, fields and woods.
3. Done: editing on the map. Reroll, lock and reshape districts, areas, roads, rivers and walls, change anything's settings, draw new features, place, move and turn labels, pin generated houses and streets, and trace over an image, all in the window.
4. In progress: cities. Done so far: faster layout on big maps; town walls with towers and gates, ditches, moats and palisades; ponds, lakes and the sea, rivers that widen, quays and piers. Next: district character, wards and a Quick Start city.
5. Battle maps built as Foundry content: tiles, walls, doors, lights and regions.
6. Art for everyone: use any folder of map art, not only FA Nexus.
7. A painted style for city maps (1.0.0).

## Making a map

As the GM, open the Scenes tab and click **AtlasScribe**.

1. **Quick Start** asks a few things: a hamlet, village or town; the season; a river, a stream or no water; a crossroads, a road through or a fork; a market square, a village green or neither; and what's around it (farms and woods, farmland, woodland or open ground; farmland is laid out in fields, hedged patchwork or open strips). Leave any of them on "Any" and the seed picks. It writes a plan and draws it in about a second.
2. **Change it in the preview.** Each district and area in the list has a button to reroll it and one to lock it; Reroll all rerolls everything that isn't locked; Undo steps back (up to 50 changes). Click anything on the map (a district, wood, field system, farm, road, river, pond, lake, wall, quay, square, building, bridge, prop or label) or a district or area in the list to open its settings in the side panel; a district, area, pond, lake, sea, road, river, wall or dock can also be reshaped by dragging its corners or points. Shapes shows every handle at once. Scroll to zoom, drag to move.
   - **Settings:** only the ones that thing uses, each showing in gray what applies when it's left empty; a change redraws the map at once (one made while it's still drawing waits its turn), and the arrow beside a setting puts it back to its default. A district's type, gardens, crofts, roofs and street surface; a wood's density (sparse, open, thick or dense) and leafy share; a field system's kind, field size, border and how much is farmed; a road's kind, width and surface; and so on. Less used ones are under More. Delete takes a feature out of the plan (Undo brings it back), and the back arrow returns to the list.
   - **Draw** adds something new: pick a tool (district, woods, fields, park, farm, yard, square, building; road, lane, track, wall, hedge, town wall, palisade; river, stream, pond, lake, sea, quay, pier; bridge, ford, tree, well, cart, label), then click on the map. A district or area is drawn corner by corner (double-click, Enter or a click on the first corner finishes it) or by dragging a box; its corners snap onto other districts' and areas' corners and sides and onto the map's edge, and where it meets a neighbor along a side each takes the other's corners there, so the two share that side, their streets meet across it, and its corners move together. A road, river or wall is drawn point by point, and its points snap onto a road (water onto water, a wall onto a wall) or the map's edge. Where a new road crosses water, or a new river or stream crosses a road, a bridge is added (a ford where a track or path crosses a stream), unless one is already there; click it to change it or delete it. Bridges and lanes added this way are ordinary features you can change or delete. A district drawn with no road into it and no neighboring streets gets a lane from the nearest road it can reach without running through another district, square, building, yard, park, farm or pond, and a square drawn off the roads inside a district gets a street (a lane in a village or hamlet) from the nearest road into it, so houses line the way to it. Farms, yards, parks and squares out in the country get a faint lane of their own to the nearest road when the map is drawn (none through water, and none where the only way is a long way around). A building is a box, or a click for one of the usual size; a bridge, ford, prop or label is one click (a bridge or ford moves onto the nearest place a road crosses the water). Finish (in the palette) ends a drawing too, Backspace or Delete takes the last point off and Esc cancels. The new feature's settings open when it's drawn.
   - **Town walls:** draw one with the Town wall or Palisade tool (click its first point again to close it around), or open a district and click Wall in for a town wall around it, just outside its edge. Wherever a road crosses a wall there's a gate: a gatehouse over the road, or a tower each side of it; where a river or stream crosses, or the wall runs along its bank, the wall stops at a tower on each side; a moat runs on into the water, so a river close along the wall comes right up to it, and a dry ditch stops short of it. Towers stand at its corners and about every 120 feet between (90 for a palisade). Its settings: the thickness and height, the towers (roofed, open with battlements, or some of each), their shape (round, square or some of each) and spacing, and what runs along its outside (nothing, a dry ditch or a moat, with bridges where the roads cross it, and its width). Each wall picks its own look from its seed unless you set it. A strip of ground along the wall stays clear: houses keep off it, a district's streets stop at the wall, and only roads pass through, at the gates, so two districts with a wall between them don't share streets across it. An open run's outside is on its left going along it from its first point (its "Outside is on the" setting, under More, turns it around); a closed wall's is outward.
   - **Water:** a river, stream or canal is drawn point by point; its width is at its first point, and End width (when set) at its last, widening or narrowing smoothly between. A pond, lake or sea is drawn corner by corner or as a box (the oval inside it). A sea's corners near the map's edge go past it, so its outline is the coast. Each has a shore (sand, pebbles, rocks, grass, marsh or reeds) picked from its seed unless you set it; the water is lighter in the shallows, the sea has surf along its coast outside winter, and reedy or marshy shores grow reeds. Ponds and lakes freeze in winter unless their Frozen setting is off; the sea doesn't. A river that runs into a lake or the sea opens out there and flows in with no bank. A quay (stone) or wharf (timber) is drawn along the water's edge: its line moves onto the nearest edge of a river, lake or the sea, it's paved back from the water, and houses face it. A pier (stone) or jetty (timber) runs out into the water as drawn. Houses, streets, trees and fields keep off the water and its shore.
   - **Labels:** a label is drawn at its true size, in its color and font. Click one, then drag its box to move it or the dot beside it to turn it (hold Shift for steps of 15 degrees). Dropped on a road, river or stream, a label turns to run along it, never upside down (inside a square it stays level). Its settings: the text, who sees it (the GM only, or everyone), its size, turn, color, font and opacity; color and font left empty use the plan's. A district or area can show its name on the map (its "Name on the map" setting): the label sits inside it, moves with it when it's reshaped and can be dragged off the middle.
   - **Pin:** click a house or a street the generator made (inside a district, away from the plan's own features) and its panel offers Pin. A pinned house becomes a fixed building group in the plan, drawn exactly as it was, which can be named, show its name on the map and have its roof changed; a pinned street or lane becomes a plan road along the same line. Rerolling the district keeps what's pinned and rebuilds around it (a pinned street changes how the district's other streets run). Delete gives the spot back to the generator.
   - **Underlay:** an image under the sketch to trace over (a hand sketch, an old map). Underlay picks an image, fitted inside the map at half opacity; with its panel open, drag it to move it and drag a corner to scale it (it keeps its shape), or type where it sits. Opacity, Shown and Locked are in the panel. It's saved with the plan and never painted into the scene.
   - **Plan settings** (the gear): the name, season, ground, the map's size, feet and pixels a square, the seed, the labels' color and font, and the scene's settings (its name, weather, darkness, light, fog, token vision, padding and grid).
   - **Limits for now:** cemeteries aren't drawn yet, and a building that isn't a rectangle or a circle is drawn as its bounding box. A turned area can't be reshaped, and a circle or ellipse only changes size. Squares, buildings, bridges and props can't be dragged once drawn: delete one and draw it again. A pinned house's buildings change together, not one by one. Changes you haven't saved last only until Foundry reloads.
3. **Save** keeps the plan in your world (in the output folder's `plans` folder), to open again later; it opens with the window next time. Plans can also be imported (pasted or from a file) and exported.
4. **Make scene** saves the plan, paints the map with your art and makes it a scene, with the plan's labels hidden from players (unless a label says otherwise). Cancel stops the painting. If some art couldn't be had, it says so and paints those parts in plain colors. After changes, **Update scene** repaints that scene (it's backed up first). The art FA Nexus found is remembered until Foundry reloads, so later scenes and updates don't wait for it again.

## From a script

The window edits an ordinary plan, a JSON object, so anything it does can also be written into a plan by hand; these calls, from the browser console (F12) or a script macro as a GM, read, check, reroll, preview, render and publish one. Positions are in grid squares from the top left, sizes in feet. Every setting a plan can have, with its range, is listed in `TYPES` in `scripts/core/plan.mjs`. The API is ready from Foundry's `ready` hook (and fires `atlas-scribe.ready` with it).

```js
const as = game.modules.get("atlas-scribe").api;
const plan = { atlasScribe: 1, id: "vance-crossing", name: "Vance's Crossing", size: { squares: [40, 30], ftPerSquare: 25 },
  season: "winter", ground: "snow",
  features: [
    { id: "road", type: "road", class: "street", path: [[0, 15], [40, 15]] },
    { id: "town", type: "district", shape: { rect: [8, 8, 32, 22] } },
    { id: "wood", type: "area", class: "woods", shape: { circle: [6, 5, 5] } },
    { id: "label-inn", type: "label", text: "Kestrel's inn", at: [20, 12], show: "gm" } ] };
as.checkPlan(plan);                    // { plan, problems, ok }: every problem in plain words
await as.preview(plan);                // a quick sketch in a window: reroll and lock there
await as.render(plan, { publish: true }); // paints it, saves it, and makes a new scene
```

- `open()`: opens the AtlasScribe window. `quickPlan({ size, season, water, roads, center, surroundings, name, seed })` gives `{ plan, choices }` without the window; `quickChoices` lists the choices.
- `checkPlan(plan)`: reads a plan (an object, JSON text, or text with a fenced `mapplan` block) and lists its problems, errors first. Errors stop a render; warnings don't.
- `render(plan, options)`: lays the plan out and paints it in the background (Foundry stays responsive, with a progress bar), then saves the image to the output folder's `maps` folder. It never writes over a file. `publish: true` also makes a scene; `save: false` paints without saving. It gives `{ path, width, height, ms, missingArt, notes, warnings }` (and `scene` when published).
- `publish(plan, { image })`: makes a scene from a rendered map (render's result, or the image's path): the background, the grid, lighting, fog, weather and navigation from the plan's `output.scene`, a thumbnail, and the plan's labels as locked text drawings, hidden from players unless the label says `show: "all"`.
- To update a scene instead of making a new one, give its id: `publish(plan, { image, scene: "<scene id>" })` (or the same options to `render`). AtlasScribe only changes scenes it made; for any other scene add `force: true`. Before anything changes, the whole scene is saved to the output folder's `backups` folder. The scene keeps its name, your own drawings, tokens, walls and lights stay, and only the labels this plan added before are replaced. If the map's size or padding changes, things you placed by hand may no longer line up with it.
- `reroll(plan, ids)`: gives `{ plan, rerolled, skipped }`, the plan a copy with new seeds for those districts or areas (one id or a list), so they're drawn again and nothing else moves. Leave out `ids` to reroll every district and area that isn't locked. `const { plan: next } = as.reroll(plan, "town"); await as.render(next);`
- `lock(plan, ids)` and `unlock(plan, ids)`: a copy of the plan with those features locked or unlocked; a reroll leaves locked ones alone. Seeds and locks are kept in the plan (`seeds`, `locked`), so a plan always draws the same map.
- `preview(plan)`: lays the plan out and draws it in plain colors, with no art, in a window, in about a second, its districts and areas outlined and named. Each district and area has a button to reroll it and one to lock it, Reroll all rerolls everything that isn't locked, and Undo steps back. Click a district, area, road, river or wall to show its handles, or Shapes to show them all: drag a corner or point to reshape (corners two districts share move together, and bridges follow a moved road or river), drag a side's middle dot to add a corner, alt-click or right-click a corner to remove it; a circle's or ellipse's edge handle sets its size. Scroll to zoom, drag to move, double-click to fit. Click anything to change its settings in the side panel, or the gear for the plan's own (see Making a map). Copy plan puts the plan, with its new seeds and locks, on the clipboard, and the window's `plan` holds it too: `const app = await as.preview(plan); /* reroll until you like it */ await as.render(app.plan, { publish: true });`
- If the window holds a plan you haven't saved, `preview` shows it and asks before replacing it, and throws if you keep it.
- `cancel()`: stops the job that's running. One job runs at a time; `busy` says whether one is, and `version` is the module's version.

The output folder is a setting (by default `worlds/<your world>/atlas-scribe`).

**Restoring a backup:** right-click the scene in the Scenes sidebar, choose Import Data, and pick the backup file from `backups`. That puts the scene back exactly as it was.

## Art

AtlasScribe ships no art. It paints with art you already have, through FA Nexus when it's installed, or in plain colors when there's none (other art folders are planned). A map painted from someone's art is for your own table under that art's license.

AtlasScribe isn't affiliated with Forgotten Adventures; FA Nexus is named only to say what AtlasScribe works with.

## Changes

See [CHANGELOG.md](CHANGELOG.md).

## How it was made

Written with Claude and tested in Foundry 14.

## Problems and suggestions

[Open an issue](https://github.com/Sir-Bayard/atlas-scribe/issues).

## License

MIT. See [LICENSE](LICENSE).
