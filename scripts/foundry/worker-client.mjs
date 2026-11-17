/**
 * The page's side of the worker: starts it on first use, sends jobs, passes progress on, and can cancel.
 * Canceling stops the worker outright (the only way to stop a long paint); the next job starts a new one.
 */
export class WorkerClient {
  #worker = null;
  #next = 1;
  #pending = new Map();

  #start() {
    if (this.#worker) return this.#worker;
    const w = new Worker(new URL("../render/worker.mjs", import.meta.url), { type: "module", name: "atlas-scribe" });
    w.onmessage = (event) => {
      const { id, progress, result, error } = event.data ?? {};
      if (id === null && error) return this.#fail(new Error(`AtlasScribe worker: ${error.message}`)); // not tied to one job
      const job = this.#pending.get(id);
      if (!job) return;
      if (progress) return job.onProgress?.(progress.pct, progress.label);
      this.#pending.delete(id);
      if (error) {
        const e = new Error(`AtlasScribe worker: ${error.message}`);
        if (error.stack) e.workerStack = error.stack;
        job.reject(e);
      } else job.resolve(result);
    };
    w.onmessageerror = () => this.#fail(new Error("AtlasScribe worker: a reply from the worker couldn't be read"));
    w.onerror = (event) => {
      event.preventDefault?.();
      this.#fail(new Error(`AtlasScribe worker failed: ${event.message ?? "unknown error"}`));
    };
    this.#worker = w;
    return w;
  }

  #fail(error) {
    for (const job of this.#pending.values()) job.reject(error);
    this.#pending.clear();
    this.#worker?.terminate();
    this.#worker = null;
  }

  /** Runs a job in the worker. onProgress(pct, label) is called as it goes. */
  run(type, payload = {}, { onProgress = null, transfer = [] } = {}) {
    const w = this.#start();
    const id = this.#next++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, onProgress });
      w.postMessage({ id, type, payload }, transfer);
    });
  }

  /** True while a job is running. */
  get busy() {
    return this.#pending.size > 0;
  }

  /** Stops whatever is running; its promise rejects with "canceled". */
  cancel() {
    if (!this.#pending.size) return false;
    const e = new Error("AtlasScribe: canceled");
    e.canceled = true;
    e.cancelled = true; // (the older spelling, which scripts may still read)
    this.#fail(e);
    return true;
  }
}
