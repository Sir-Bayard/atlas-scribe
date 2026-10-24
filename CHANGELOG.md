# Changelog

## 0.2.0

The engine: a map plan in, a painted map and a scene out, driven from the console for now (see the README's "Trying the engine").

- Plans: `api.checkPlan(plan)` reads a plan (JSON, or a fenced `mapplan` block) and checks it, explaining each problem in plain words, errors first; a badly formed plan is reported, never crashes it. One list of feature types (roads, water, crossings, squares, buildings, landmarks, districts, areas, walls, props and labels) sets what each takes and its defaults; the image settings (`output`) and the scene settings (`output.scene`) are checked too, including Foundry's smallest grid and the largest image WebP can hold.
- Rendering: `api.render(plan)` lays the plan out and paints it in a background worker, so Foundry never freezes, with a progress bar, then saves the image without writing over anything. The first fill is the "roadside" district (houses along every road and lane through it, each with a garden behind; houses and gardens never overlap each other, a yard, a square, water or a road), plus farmsteads, woods of any shape, hedgerows and a textured winter style. Art comes from FA Nexus when it's installed, through a role map; anything missing, or everything if FA Nexus can't be used, is painted in plain colours. Big maps paint in tiles, with no visible joins.
- Seeds: the same plan always gives the same map, and each district, farm and wood has its own seed (`seeds`): rerolling one district never moves the district beside it.
- Publishing: `api.publish(plan, { image })`, or `api.render(plan, { publish: true })`, makes the map a scene: the background, the grid, lighting, fog, weather and navigation from `output.scene`, a thumbnail, and the plan's labels as locked text drawings (hidden from players unless a label says `show: "all"`; sizes small, normal, large and huge). Give `scene: <id>` to update a scene AtlasScribe made (any other needs `force: true`): the whole scene is backed up first, its name and your own drawings are kept, and only its old labels are replaced.
- `api.cancel()` stops the job that's running; one job runs at a time.

## 0.1.0

- First build: the module's skeleton, its background worker and the upload path. `game.modules.get("atlas-scribe").api.test()` paints a test pattern in the worker, with a progress bar, and saves it to the world's atlas-scribe folder. Nothing for players or GMs to use yet.
