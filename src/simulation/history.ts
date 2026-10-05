import { TimeSeries } from '../utils/ringBuffer';

/** 30 minutes at 1 Hz. Every buffer is capped, so memory stays bounded however long the app runs. */
export const HISTORY_CAPACITY = 1800;

class HistoryStore {
  private map = new Map<string, TimeSeries>();

  series(key: string): TimeSeries {
    let s = this.map.get(key);
    if (!s) {
      s = new TimeSeries(HISTORY_CAPACITY);
      this.map.set(key, s);
    }
    return s;
  }

  push(key: string, t: number, v: number) {
    this.series(key).push(t, v);
  }

  get(key: string): TimeSeries | undefined {
    return this.map.get(key);
  }

  delete(key: string) {
    this.map.delete(key);
  }
}

export const history = new HistoryStore();
