import { describe, expect, it } from 'vitest';
import { comparisonCsv, csvCell, exportJson, timeseriesCsv, toCsv } from '../export';
import { clockFromT, fmtDuration, fmtNum, pct, simDate } from '../format';
import { makeRun, makeTopology } from './builders';

function parseCsv(text: string): string[][] {
  // minimal RFC 4180 parser for the assertions below
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  return rows;
}

describe('CSV export', () => {
  it('escapes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('x\ny')).toBe('"x\ny"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvCell(1.5)).toBe('1.5');
    expect(toCsv(['a', 'b'], [[1, 'x,y']])).toBe('a,b\r\n1,"x,y"\r\n');
  });

  it('writes one comparison row per loaded strategy with summary values', () => {
    const runs = { none: makeRun('none'), encirra: makeRun('encirra') };
    const rows = parseCsv(comparisonCsv(runs));
    expect(rows[0].slice(0, 3)).toEqual(['scenarioId', 'strategy', 'runId']);
    expect(rows).toHaveLength(3);
    const h = rows[0];
    const enc = rows.find((r) => r[1] === 'encirra')!;
    expect(enc[h.indexOf('loadInterruptedKW')]).toBe('200');
    expect(enc[h.indexOf('verification')]).toBe('simulation-verified');
    expect(enc[h.indexOf('faultLabel')]).toBe('Feeder F3 · line B2–B3');
    const none = rows.find((r) => r[1] === 'none')!;
    expect(none[h.indexOf('plan')]).toBe('');
  });

  it('writes one time-series row per frame per strategy, including tank columns', () => {
    const runs = { 'grid-only': makeRun('grid-only'), encirra: makeRun('encirra') };
    const rows = parseCsv(timeseriesCsv(runs, makeTopology()));
    expect(rows[0]).toContain('tank_T2_pct');
    expect(rows.length - 1).toBe(16);
    const h = rows[0];
    const r = rows[1 + 3]; // grid-only, frame 3
    expect(r[h.indexOf('strategy')]).toBe('grid-only');
    expect(r[h.indexOf('unserved_kW')]).toBe('200');
    expect(r[h.indexOf('vmin_bus')]).toBe('B2');
  });
});

describe('JSON export', () => {
  it('bundles meta, scenario, comparison and the runs unchanged', () => {
    const enc = makeRun('encirra');
    const text = exportJson({ exportedAt: 'now', dataSource: 'replay', disclaimer: 'd' }, null, { encirra: enc }, null);
    const parsed = JSON.parse(text);
    expect(parsed.meta.dataSource).toBe('replay');
    expect(parsed.runs.encirra).toEqual(JSON.parse(JSON.stringify(enc)));
  });
});

describe('formatting', () => {
  it('formats the simulated date without the viewer time zone and rolls over midnight', () => {
    expect(simDate('2026-04-28T17:00:00+04:00', '17:00', 0)).toBe('Tue, Apr 28, 2026');
    expect(simDate('2026-04-28T17:00:00+04:00', '17:00', 7 * 3600)).toBe('Wed, Apr 29, 2026');
  });
  it('derives clocks from the timebase', () => {
    expect(clockFromT('17:00', 0)).toBe('17:00');
    expect(clockFromT('17:00', 125 * 60)).toBe('19:05');
    expect(clockFromT('23:30', 45 * 60)).toBe('00:15');
  });
  it('never prints negative zero and handles missing values', () => {
    expect(fmtNum(-0.0001, 1)).toBe('0.0');
    expect(fmtNum(1234.5, 0)).toBe('1,235');
    expect(fmtNum(null)).toBe('—');
    expect(pct(1, 0)).toBeNull();
    expect(pct(1, 4)).toBe(25);
    expect(fmtDuration(75)).toBe('1 h 15 min');
  });
});
