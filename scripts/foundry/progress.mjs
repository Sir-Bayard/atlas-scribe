/** A progress bar in Foundry's notification area, for long jobs. */
export function progressBar(title) {
  const note = ui.notifications.info(title, { progress: true, console: false });
  return {
    update(pct, label) {
      note.update({ pct: Math.max(0, Math.min(1, pct ?? 0)), message: label ? `${title}: ${label}` : title });
    },
    done(message) {
      note.update({ pct: 1, message: message ?? title });
    },
  };
}
