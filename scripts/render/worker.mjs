/**
 * The AtlasScribe worker. Heavy work (laying out a plan, painting a map) runs here, off Foundry's page, so the
 * client never freezes. It knows nothing of Foundry: it gets plain data and image URLs, and sends back plain
 * data and images. The jobs themselves are in jobs.mjs.
 *
 * Messages in:  { id, type, payload }
 * Messages out: { id, progress: { pct, label } } while working, then { id, result } or { id, error }.
 */
import { jobs, prepare } from "./jobs.mjs";

// A message that can't be read (it failed to clone) would otherwise leave its job waiting forever
self.onmessageerror = () => self.postMessage({ id: null, error: { message: "a message to the worker couldn't be read" } });

self.onmessage = async (event) => {
  const { id, type, payload } = event.data ?? {};
  const job = jobs[type];
  if (!job) return self.postMessage({ id, error: { message: `unknown job "${type}"` } });
  const progress = (pct, label) => self.postMessage({ id, progress: { pct, label } });
  try {
    await prepare(payload);
    const result = await job(payload ?? {}, progress);
    self.postMessage({ id, result }); // a Blob crosses by reference, so nothing needs transferring
  } catch (e) {
    self.postMessage({ id, error: { message: e?.message ?? String(e), stack: e?.stack ?? null } });
  }
};
