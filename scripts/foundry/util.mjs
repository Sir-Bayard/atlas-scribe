/** What the Foundry layer's files share: the module's id, Foundry's file picker, safe text and notices. */
import { esc } from "../kit/safe-text.mjs";

export const MOD = "atlas-scribe";
export const FP = () => foundry.applications.apps.FilePicker.implementation;
export { esc, safe, tipAttr, labelAttr } from "../kit/safe-text.mjs";

/** Notices whose whole text is escaped: names and messages in them come from plans, files and errors. */
export const note = {
  info: (text, options) => ui.notifications.info(esc(text), options),
  warn: (text, options) => ui.notifications.warn(esc(text), options),
  error: (text, options) => ui.notifications.error(esc(text), options),
};
