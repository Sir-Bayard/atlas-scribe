# Changelog

## Unreleased

- Rendering: `api.render(plan)` lays the plan out and paints it in the background worker, then saves the image. The first fill is the "roadside" district (houses along every road and lane through it, each with a garden behind), plus farmsteads, woods, hedgerows and a textured winter style; art comes from FA Nexus when it's installed, through a role map, and anything missing is painted in a plain colour. Big maps paint in tiles, with no visible joins.
- Plans: `api.checkPlan(plan)` reads a plan (JSON, or a ```mapplan block) and checks it, explaining each problem in plain words. One list of feature types (roads, water, crossings, squares, buildings, landmarks, districts, areas, walls, props and labels) sets what each takes and its defaults.

## 0.1.0

- First build: the module's skeleton, its background worker and the upload path. `game.modules.get("atlas-scribe").api.test()` paints a test pattern in the worker, with a progress bar, and saves it to the world's atlas-scribe folder. Nothing for players or GMs to use yet.
