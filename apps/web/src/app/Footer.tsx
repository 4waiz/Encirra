import { Info } from 'lucide-react';
import { useTwin } from '@/state/store';

export const CREDIT_HREF = 'https://kanbanstudios.ae/team-kanban';

/** The credit link — exact text and target; used in the footer and the About panel. */
export function CreditLink({ className }: { className?: string }) {
  return (
    <a href={CREDIT_HREF} target="_blank" rel="noopener noreferrer" className={className} data-testid="credit-link">
      Built by Team Kanban
    </a>
  );
}

export function Footer() {
  const setAboutOpen = useTwin((s) => s.setAboutOpen);
  return (
    <footer className="absolute inset-x-0 bottom-0 z-20 flex h-[var(--footer-h)] items-center justify-between gap-4 border-t border-white/60 bg-white/80 px-[var(--pad-x)] text-[11px] text-slate backdrop-blur-[4px]">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium text-ink" data-testid="footer-disclaimer">
          Research Prototype — Synthetic/Benchmark Infrastructure Data
        </span>
        <span className="hidden truncate text-slate xl:inline">· No private utility data is available or authorized.</span>
        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          className="ml-1 inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-[1px] font-medium text-info hover:bg-info-soft"
          data-testid="about-open"
        >
          <Info size={12} />
          About Encirra
        </button>
      </div>
      <CreditLink className="shrink-0 font-medium text-ink hover:text-info hover:underline" />
    </footer>
  );
}
