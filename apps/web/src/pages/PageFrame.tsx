import { useState, type ReactNode } from 'react';
import { Table2, LineChart as LineIcon } from 'lucide-react';
import clsx from 'clsx';
import { useSource } from '@/data/hooks';
import { SourceChip } from '@/ui/primitives';

export function PageFrame({ title, subtitle, actions, children, testId }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; testId?: string }) {
  const { dataSource } = useSource();
  return (
    <div className="enc-panel enc-panel-strong flex h-full min-h-0 flex-col rounded-[12px]" data-testid={testId}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-[clamp(14px,1.3vw,24px)] pt-[clamp(10px,1.4vh,16px)] pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="text-[clamp(18px,1.3vw,22px)] font-semibold tracking-[-0.01em] text-navy">{title}</h2>
            <SourceChip source={dataSource} />
          </div>
          {subtitle && <div className="mt-0.5 text-[13px] text-slate">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="enc-scroll min-h-0 flex-1 overflow-y-auto px-[clamp(14px,1.3vw,24px)] py-[clamp(10px,1.4vh,16px)]">{children}</div>
    </div>
  );
}

export interface TableSpec {
  columns: string[];
  rows: (string | number)[][];
}

/** Chart card with a table-view twin (every chart's values are readable without hovering). */
export function ChartCard({
  title,
  subtitle,
  legend,
  children,
  table,
  className,
  height = 220,
  testId,
}: {
  title: string;
  subtitle?: ReactNode;
  legend?: ReactNode;
  children: ReactNode;
  table?: TableSpec;
  className?: string;
  height?: number;
  testId?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <div className={clsx('flex min-w-0 flex-col rounded-[10px] border border-line bg-white px-3.5 pt-3 pb-2', className)} data-testid={testId}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-semibold text-navy">{title}</h3>
          {subtitle && <div className="text-[11.5px] text-slate">{subtitle}</div>}
        </div>
        {table && (
          <button
            type="button"
            onClick={() => setAsTable((v) => !v)}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-slate hover:bg-wash"
            aria-pressed={asTable}
          >
            {asTable ? <LineIcon size={13} /> : <Table2 size={13} />}
            {asTable ? 'Chart' : 'Table'}
          </button>
        )}
      </div>
      {legend && <div className="mt-1.5">{legend}</div>}
      <div className="mt-1 min-w-0" style={{ height }}>
        {asTable && table ? (
          <div className="enc-scroll h-full overflow-auto rounded border border-line/70">
            <table className="w-full border-collapse text-left text-[11px]">
              <thead className="sticky top-0 bg-wash text-slate">
                <tr>
                  {table.columns.map((c) => (
                    <th key={c} className="px-2 py-1 font-medium whitespace-nowrap">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-t border-line/60">
                    {r.map((v, j) => (
                      <td key={j} className="px-2 py-[3px] whitespace-nowrap text-ink tabular">
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
