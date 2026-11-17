// One phase of laying out a plan (layout/index.mjs, layoutPlan): ctx holds what the phases share.
import { BoxGrid, SegGrid } from "../../spatial.mjs";

/**
 * What free() keeps clear of, in grids so it measures only what's near (the same answers as measuring
 * everything). The grids catch up with space's lists, which only grow, each time free() is asked
 */
export function spaceGrids(ctx) {
  const { space } = ctx;
  const nearby = {
    reserved: new BoxGrid(), gardens: new BoxGrid(), buildings: new BoxGrid(),
    water: new SegGrid([], { pad: (p) => space.water[p].clear }), ways: new SegGrid([], { pad: (p) => space.ways[p].clear }),
  }; ctx.nearby = nearby;
  const polyBox = (grid, poly) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of poly) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
    grid.add(x0, y0, x1, y1);
  };
  const catchUp = () => {
    for (const k of ["reserved", "gardens"]) while (nearby[k].count < space[k].length) polyBox(nearby[k], space[k][nearby[k].count]);
    for (const k of ["water", "ways"]) while (nearby[k].paths.length < space[k].length) nearby[k].addPath(space[k][nearby[k].paths.length].path);
    const bs = nearby.buildings;
    while (bs.count < space.buildings.length) {
      const b = space.buildings[bs.count], m = Math.max(b.len, b.dep) * 0.5 * 0.8 + 0.15;
      bs.add(b.cx - m, b.cy - m, b.cx + m, b.cy + m);
    }
  }; ctx.catchUp = catchUp;
}
