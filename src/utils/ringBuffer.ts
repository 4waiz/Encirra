/** Fixed-capacity time series. Memory is bounded; the oldest samples are overwritten. */
export class TimeSeries {
  readonly capacity: number;
  private times: Float64Array;
  private values: Float32Array;
  private head = 0;
  private count = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.times = new Float64Array(capacity);
    this.values = new Float32Array(capacity);
  }

  push(t: number, v: number) {
    this.times[this.head] = t;
    this.values[this.head] = v;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  get length() {
    return this.count;
  }

  /** i = 0 is the oldest retained sample. */
  timeAt(i: number) {
    return this.times[(this.head - this.count + i + this.capacity * 2) % this.capacity];
  }

  valueAt(i: number) {
    return this.values[(this.head - this.count + i + this.capacity * 2) % this.capacity];
  }

  last(): number | null {
    return this.count ? this.valueAt(this.count - 1) : null;
  }

  lastTime(): number | null {
    return this.count ? this.timeAt(this.count - 1) : null;
  }

  /** Value at or just before time t (null if t precedes the buffer). */
  valueAtTime(t: number): number | null {
    if (!this.count) return null;
    let lo = 0;
    let hi = this.count - 1;
    if (t < this.timeAt(0)) return null;
    if (t >= this.timeAt(hi)) return this.valueAt(hi);
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.timeAt(mid) <= t) lo = mid;
      else hi = mid - 1;
    }
    return this.valueAt(lo);
  }

  /** Linear interpolation at time t. */
  sample(t: number): number | null {
    if (!this.count) return null;
    if (t <= this.timeAt(0)) return this.valueAt(0);
    const n = this.count - 1;
    if (t >= this.timeAt(n)) return this.valueAt(n);
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.timeAt(mid) <= t) lo = mid;
      else hi = mid;
    }
    const t0 = this.timeAt(lo);
    const t1 = this.timeAt(hi);
    const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
    return this.valueAt(lo) + (this.valueAt(hi) - this.valueAt(lo)) * f;
  }

  /** Copy of samples with t >= since (oldest first). */
  slice(since: number): { t: number[]; v: number[] } {
    const t: number[] = [];
    const v: number[] = [];
    for (let i = 0; i < this.count; i++) {
      const ti = this.timeAt(i);
      if (ti >= since) {
        t.push(ti);
        v.push(this.valueAt(i));
      }
    }
    return { t, v };
  }

  /** Last n values (oldest first). */
  tail(n: number): number[] {
    const k = Math.min(n, this.count);
    const out = new Array<number>(k);
    for (let i = 0; i < k; i++) out[i] = this.valueAt(this.count - k + i);
    return out;
  }
}
