import { useEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import clsx from 'clsx';

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  badge,
  children,
  width = 980,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  width?: number;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => ref.current?.focus(), 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 max-lg:p-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div className="absolute inset-0 bg-[rgba(6,12,20,0.45)]" onClick={onClose} aria-hidden />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            data-testid={testId}
            className={clsx('relative flex max-h-[min(88vh,900px)] w-full flex-col overflow-hidden rounded-[16px] bg-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] outline-none max-lg:h-[100dvh] max-lg:max-h-none max-lg:rounded-none max-lg:pt-[env(safe-area-inset-top)] max-lg:pb-[env(safe-area-inset-bottom)]')}
            style={{ maxWidth: width }}
            initial={{ y: 14, opacity: 0.6, scale: 0.99 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <div className="flex items-start gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-navy">{title}</h2>
                  {badge}
                </div>
                {subtitle && <div className="mt-1 text-[13px] text-slate">{subtitle}</div>}
              </div>
              <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate hover:bg-wash">
                <X size={18} />
              </button>
            </div>
            <div className="enc-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4 max-lg:overflow-x-hidden max-lg:px-4">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
