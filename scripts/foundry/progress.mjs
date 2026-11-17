/** A progress bar in Foundry's notification area, for long jobs. Its words are escaped: they carry plan names and messages. */
import { esc } from "./util.mjs";

export function progressBar(title) {
  const note = ui.notifications.info(esc(title), { progress: true, console: false });
  return {
    update(pct, label) {
      note.update({ pct: Math.max(0, Math.min(1, pct ?? 0)), message: esc(label ? `${title}: ${label}` : title) });
    },
    done(message) {
      note.update({ pct: 1, message: esc(message ?? title) });
    },
  };
}
