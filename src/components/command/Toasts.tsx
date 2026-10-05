import { useEffect, useState } from 'react';
import { CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { useUI } from '../../store/ui';
import { TONE_HEX } from '../ui/tone';

export function Toasts() {
  const toast = useUI((s) => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const id = setTimeout(() => setVisible(false), 2600);
    return () => clearTimeout(id);
  }, [toast]);
  if (!toast || !visible) return null;
  const Icon = toast.tone === 'ok' ? CircleCheck : toast.tone === 'warn' ? TriangleAlert : Info;
  const c = toast.tone === 'ok' ? TONE_HEX.ok : toast.tone === 'warn' ? TONE_HEX.watch : TONE_HEX.info;
  return (
    <div className="pointer-events-none fixed bottom-9 left-1/2 z-50 -translate-x-1/2" role="status" aria-live="polite">
      <div key={toast.id} className="flex items-center gap-2 rounded-[7px] border border-line-strong bg-surface-2/96 px-3 py-2 text-[12px] text-ink-1 shadow-[0_12px_32px_rgb(0_0_0/0.45)] animate-fade-in">
        <Icon size={14} style={{ color: c }} aria-hidden />
        {toast.text}
      </div>
    </div>
  );
}
