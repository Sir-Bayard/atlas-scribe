// One step of building on a district's plots (lots/build.mjs, buildOnLots): ctx holds what the steps share.
import { characterOf } from "../../character.mjs";
import { edgesOff, partCorners, pickWeighted } from "../build.mjs";
import { joinLots, layForm } from "../forms.mjs";
import { pointInPolygon } from "../../geom.mjs";

/**
 * A roof that won't catch a forge's sparks: the district's own slate or tile if it has one (a district given only
 * thatch keeps it: the GM's choice)
 */
export function ownBuildings(ctx) {
  const { byBlocked, district, fits, lots, onWayEdge, out, palette, r, roomOf, sq, styles, usesFor, yards } = ctx;
  const safeRoof = Object.keys(palette).find((x) => !/thatch|wood/.test(x)) ?? Object.keys(palette).find((x) => x !== "thatch") ?? Object.keys(palette)[0]; ctx.safeRoof = safeRoof;
  // Buildings of their own, laid out as the uses are chosen (a site that doesn't fit is tried on other plots)
  const character = characterOf(district); ctx.character = character;
  const tryForm = (use, form, picks) => {
    const lot = joinLots(picks.map((k) => lots[k]));
    const sr = r.fork("site", use, picks[0]);
    const roofPick = pickWeighted(sr.next(), palette), stylePick = pickWeighted(sr.next(), styles);
    const room = roomOf(lot);
    const made = layForm({ form, lot, use, fits: (pts) => fits(pts, room), sq, r: sr, roof: roofPick, safeRoof, style: stylePick, ownStyles: Array.isArray(district.roofStyles) && district.roofStyles.length > 0, profile: district.profile, character, variant: sr.int(8) });
    return made ? { ...made, lot, sr } : null;
  };
  const uses = usesFor ? usesFor(tryForm) : null; ctx.uses = uses;
  out.uses = uses;
  out.palette = palette; // the roof materials this district's houses use (the layout's block-middle fill takes them too)
  // Plots given to a building of their own are left to it; others may be put to a use
  const inSite = new Set((uses?.sites ?? []).flatMap((st) => st.lots)); ctx.inSite = inSite;
  const useOf = uses?.useOf ?? new Map(), noThatch = uses?.noThatch ?? new Set(); ctx.noThatch = noThatch; ctx.useOf = useOf;
  for (const site of uses?.sites ?? []) {
    const { lot, sr, ...made } = site.made;
    // Ids as a house's: the main building, then its parts (w1, w2...), so the window picks and pins it as one
    const base = `l${lot.block}-${site.lots[0]}`;
    made.parts.forEach((p, k) => out.houses.push({ id: k ? `${base}w${k}` : base, lot: site.lots[0], ...(k ? { wing: true } : {}), r: sr.fork(p.key), site: site.use, joined: site.lots.length, building: { ...p.building, use: p.use } }));
    out.surfaces.push(...made.surfaces);
    out.gardens.push(...made.gardens);
    out.trees.push(...made.trees.filter((t) => pointInPolygon([t.x, t.y], lot.poly) && !made.parts.some((p) => pointInPolygon([t.x, t.y], partCorners(p.building)))));
    // A temple's yard and a mansion's grounds are walled (not along the street, a kept square or yard beside it, or a
    // district's gate; no stub where a curving side breaks into short pieces)
    if (site.form === "temple" || made.grounds) out.walls.push(...edgesOff(lot.poly, (mid) => onWayEdge(mid) || byBlocked(mid)).filter((w) => w.reduce((s, q, i) => s + (i ? Math.hypot(q[0] - w[i - 1][0], q[1] - w[i - 1][1]) : 0), 0) >= 0.15));
    out.walls.push(...made.walls);
    while (out.wallSite.length < out.walls.length) out.wallSite.push(base);
    if (made.yard) yards.push({ i: site.lots[0], poly: lot.poly, use: site.use, ...made.yard, rot: Math.atan2(lot.along[1], lot.along[0]) / (Math.PI / 180), parts: made.parts.map((p) => partCorners(p.building)) });
  }
}
