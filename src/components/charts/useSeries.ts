import { useMemo } from 'react';
import { useSim } from '../../store/sim';
import { history } from '../../simulation/history';

/** Last n samples of a history series (re-read once per simulation tick). */
export function useSeriesTail(key: string, n: number, every = 1) {
  const version = useSim((s) => s.historyVersion);
  return useMemo(() => {
    const s = history.get(key);
    if (!s) return [] as number[];
    const tail = s.tail(n * every);
    return every > 1 ? tail.filter((_, i) => i % every === 0) : tail;
  }, [version, key, n, every]); // eslint-disable-line react-hooks/exhaustive-deps
}
