/**
 * A binary min-heap of node indexes keyed by a number, on typed arrays (no objects per entry), for the priority
 * flood. Ties pop in no promised order; callers that need a fixed order key ties apart themselves. Pure.
 */
export class Heap {
  /** capacity: the most entries held at once (it grows if passed). */
  constructor(capacity = 1024) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
    this.size = 0;
  }

  clear() { this.size = 0; }

  push(key, val) {
    if (this.size === this.keys.length) this.#grow();
    const keys = this.keys, vals = this.vals;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p]; vals[i] = vals[p]; i = p;
    }
    keys[i] = key; vals[i] = val;
  }

  /** Removes the smallest entry and returns its value (the key is left in `lastKey`). Only call when size > 0. */
  pop() {
    const keys = this.keys, vals = this.vals;
    const top = vals[0];
    this.lastKey = keys[0];
    const n = --this.size;
    if (n > 0) {
      const key = keys[n], val = vals[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        keys[i] = keys[c]; vals[i] = vals[c]; i = c;
      }
      keys[i] = key; vals[i] = val;
    }
    return top;
  }

  #grow() {
    const k = new Float64Array(this.keys.length * 2), v = new Int32Array(this.vals.length * 2);
    k.set(this.keys); v.set(this.vals);
    this.keys = k; this.vals = v;
  }
}
