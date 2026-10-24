# AtlasScribe: Map Generator

A map plan in, a map out, inside Foundry VTT.

You decide what matters: where the roads run, the river and its crossings, the square, the walls and gates, the landmarks, and what each district is like. AtlasScribe fills in everything nobody wants to place by hand (side streets, plots, houses, gardens, trees and clutter) and paints the map from the map art you already have. Every random choice is seeded, so the same plan always gives the same map, and each district has its own seed: reroll one and the districts beside it don't move (only woods its new houses crowd can change). Pinning a feature so it stays put is planned.

It's system agnostic and GM only.

## Status

**Early development. Not ready for use.** This repository holds the work in progress. The first public release, 1.0.0, comes when settlements, cities and battle maps all work.

What's planned, in order:

1. The engine: a plan file rendered into a scene without freezing Foundry.
2. Quick Start: pick a size, terrain and style, and get a town.
3. Editing on the map: click a district to change, reroll or lock it; draw a road or a landmark.
4. Cities: walls, gates, rivers and coasts, many districts.
5. Art for everyone: use any folder of map art, not only FA Nexus.
6. A painted style for city maps.
7. Battle maps built as Foundry content: tiles, walls, doors, lights and regions (1.0.0).

## Making a map

As the GM, open the Scenes tab and click **AtlasScribe**.

1. **Quick Start** asks a few things: a hamlet, village or town; the season; a river, a stream or no water; a crossroads, a road through or a fork; a market square, a village green or neither; and what's around it (farms and woods, farmland, woodland or open ground). Leave any of them on "Any" and the seed picks. It writes a plan and draws it in about a second.
2. **Change it in the preview.** Each district, farm and wood has a button to reroll it and one to lock it; Reroll all rerolls everything that isn't locked; Undo steps back. Click a district, a wood or a road (or a name in the list) to reshape it by dragging its corners or points; Shapes shows every handle at once. Scroll to zoom, drag to move.
3. **Save** keeps the plan in your world (in the output folder's `plans` folder), to open again later; it opens with the window next time. Plans can also be imported (pasted or from a file) and exported.
4. **Make scene** paints the map with your art and makes it a scene, with the plan's labels hidden from players. After changes, **Update scene** repaints that scene (it's backed up first).

## From a script

Everything the window does can also be done from the browser console (F12) or a script macro, as a GM. A plan is JSON (see the sample below); positions are in grid squares from the top left, sizes in feet.

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

- `open()`: opens the AtlasScribe window. `quickPlan({ size, season, water, roads, centre, surroundings, name, seed })` gives `{ plan, choices }` without the window; `quickChoices` lists the choices.
- `checkPlan(plan)`: reads a plan (an object, JSON text, or text with a fenced `mapplan` block) and lists its problems, errors first. Errors stop a render; warnings don't.
- `render(plan, options)`: lays the plan out and paints it in the background (Foundry stays responsive, with a progress bar), then saves the image to the output folder's `maps` folder. It never writes over a file. `publish: true` also makes a scene.
- `publish(plan, { image })`: makes a scene from a rendered map (render's result, or the image's path): the background, the grid, lighting, fog, weather and navigation from the plan's `output.scene`, a thumbnail, and the plan's labels as locked text drawings, hidden from players unless the label says `show: "all"`.
- To update a scene instead of making a new one, give its id: `publish(plan, { image, scene: "<scene id>" })` (or the same options to `render`). AtlasScribe only changes scenes it made; for any other scene add `force: true`. Before anything changes, the whole scene is saved to the output folder's `backups` folder. The scene keeps its name, your own drawings, tokens, walls and lights stay, and only the labels this plan added before are replaced. If the map's size or padding changes, things you placed by hand may no longer line up with it.
- `reroll(plan, ids)`: a copy of the plan with new seeds for those districts or areas (one id or a list), so they're drawn again and nothing else moves. Leave out `ids` to reroll every district and area that isn't locked. `const { plan: next } = as.reroll(plan, "town"); await as.render(next);`
- `lock(plan, ids)` and `unlock(plan, ids)`: a copy of the plan with those features locked or unlocked; a reroll leaves locked ones alone. Seeds and locks are kept in the plan (`seeds`, `locked`), so a plan always draws the same map.
- `preview(plan)`: lays the plan out and draws it in plain colours, with no art, in a window, in about a second, its districts and areas outlined and named. Each district and area has a button to reroll it and one to lock it, Reroll all rerolls everything that isn't locked, and Undo steps back. Shapes shows handles on the districts' and areas' corners: drag one to reshape (corners two districts share move together), drag a side's middle dot to add a corner, alt-click or right-click a corner to remove it. Scroll to zoom, drag to move, double-click to fit. Copy plan puts the plan, with its new seeds and locks, on the clipboard, and the window's `plan` holds it too: `const app = await as.preview(plan); /* reroll until you like it */ await as.render(app.plan, { publish: true });`
- `cancel()`: stops the job that's running. One job runs at a time.

The output folder is a setting (by default `worlds/<your world>/atlas-scribe`).

**Restoring a backup:** right-click the scene in the Scenes sidebar, choose Import Data, and pick the backup file from `backups`. That puts the scene back exactly as it was.

## Art

AtlasScribe ships no art. It paints with art you already have: through FA Nexus when it's installed, from art folders you choose, or with plain fills when there's none. A map painted from someone's art is for your own table under that art's license.

AtlasScribe isn't affiliated with Forgotten Adventures; FA Nexus is named only to say what AtlasScribe works with.

## Changes

See [CHANGELOG.md](CHANGELOG.md).

## How it was made

Written with Claude and tested in Foundry 14.

## Problems and suggestions

[Open an issue](https://github.com/Sir-Bayard/atlas-scribe/issues).

## License

MIT. See [LICENSE](LICENSE).
