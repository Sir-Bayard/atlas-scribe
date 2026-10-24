# Changelog

## Unreleased

- Publishing: `api.publish(plan, { image })` makes the rendered map a scene: the image as its background, the grid, lighting, fog, weather and navigation from the plan's `output.scene`, a thumbnail, and the plan's labels as locked text drawings (hidden from players unless a label says `show: "all"`; sizes small, normal, large and huge). `api.render(plan, { publish: true })` does both in one go. Give `scene: <id>` to update a scene instead of making one: the whole scene is backed up to the atlas-scribe folder first, its name is kept, and only the labels AtlasScribe added are replaced.
- Rendering: `api.render(plan)` lays the plan out and paints it in the background worker, then saves the image. The first fill is the "roadside" district (houses along every road and lane through it, each with a garden behind), plus farmsteads, woods, hedgerows and a textured winter style; art comes from FA Nexus when it's installed, through a role map, and anything missing is painted in a plain colour. Big maps paint in tiles, with no visible joins. Gardens never overlap each other, a building, a yard, a square, water or a road: one that doesn't fit is made shallower or left off, and houses keep out of gardens already laid.
- Plans: `api.checkPlan(plan)` reads a plan (JSON, or a ```mapplan block) and checks it, explaining each problem in plain words. One list of feature types (roads, water, crossings, squares, buildings, landmarks, districts, areas, walls, props and labels) sets what each takes and its defaults.

## 0.1.0

- First build: the module's skeleton, its background worker and the upload path. `game.modules.get("atlas-scribe").api.test()` paints a test pattern in the worker, with a progress bar, and saves it to the world's atlas-scribe folder. Nothing for players or GMs to use yet.
