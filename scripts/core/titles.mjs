/**
 * Title case for what the window shows as a label: a button, a field, a menu's choices, a tab, a dialog's title, a
 * map's made names. Every word starts with a capital but the short ones inside a title: a, an, the, and, but, or,
 * nor, for, so, yet, and prepositions of three letters or fewer (as, at, by, in, of, off, on, per, to, up, via). The
 * first and last words always take a capital, and so does the first word after a colon or inside brackets. Words
 * the writer capitalized inside (AtlasScribe, PF2e, GM), numbers and units (px, ft, mi) are left as they are.
 * Tooltips, notes and help stay as sentences. Pure.
 */

const SMALL = new Set(["a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet", "as", "at", "by", "in", "of", "off", "on", "per", "to", "up", "via", "vs"]);
const UNITS = new Set(["px", "ft", "mi", "km", "x"]);

/** One word (with any brackets, quotes or commas about it) in title case. */
function word(w, edge) {
  const m = /^([(\["“‘]*)(.*?)([)\]"”’,.:;!?]*)$/.exec(w);
  const [, pre, core, post] = m;
  if (!core || /[A-Z]/.test(core.slice(1)) || /\d/.test(core) || UNITS.has(core)) return w;
  const parts = core.split("-");
  const out = parts.map((p, i) => {
    if (!p) return p;
    const small = SMALL.has(p.toLowerCase()) && !(edge.first && i === 0) && !(edge.last && i === parts.length - 1) && !pre;
    return small ? p.toLowerCase() : p[0].toUpperCase() + p.slice(1);
  });
  return pre + out.join("-") + post;
}

/** A label in title case ("Pole to pole" is "Pole to Pole"; "AtlasScribe: unsaved changes" is "AtlasScribe: Unsaved Changes"). */
export function titleCase(text) {
  if (typeof text !== "string" || !text) return text;
  return text.split(/(:\s+)/).map((seg) => {
    if (/^:\s+$/.test(seg)) return seg;
    const ws = seg.split(" "), idx = ws.map((w, i) => (w ? i : -1)).filter((i) => i >= 0);
    return ws.map((w, i) => (w ? word(w, { first: i === idx[0], last: i === idx[idx.length - 1] }) : w)).join(" ");
  }).join("");
}
