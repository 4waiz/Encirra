import { useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Clapperboard, Pause, Play, RotateCcw, SkipBack, SkipForward, X } from 'lucide-react';
import { useTwin } from '@/state/store';
import { DEMO_LENGTH, DEMO_STEPS } from './demoScript';
import { demoControls } from './demoController';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function DemoOverlay() {
  const demo = useTwin((s) => s.demo);
  const runs = useTwin((s) => s.runsByStrategy);
  const topology = useTwin((s) => s.topology);
  const step = DEMO_STEPS[Math.min(demo.stepIndex, DEMO_STEPS.length - 1)];
  const done = demo.elapsedS >= DEMO_LENGTH - 0.01;
  const caption = useMemo(() => (topology ? step.caption({ runs, topology }) : ''), [step, runs, topology]);

  return (
    <AnimatePresence>
      {demo.active && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
          className="glass glass-solid pointer-events-auto w-[min(100%,680px)] rounded-[14px] px-4 py-3"
          data-testid="demo-overlay"
          data-step={step.id}
          data-paused={demo.paused}
        >
          <div className="flex items-center gap-2 max-lg:flex-wrap max-lg:gap-y-1">
            <Clapperboard size={15} className="shrink-0 text-power" />
            <span className="t-kicker !text-power max-lg:whitespace-nowrap">
              Cinematic demo · {done ? 'complete' : `step ${demo.stepIndex + 1} of ${DEMO_STEPS.length}`}
            </span>
            <span className="t-micro text-slate tabular" data-testid="demo-time">
              {mmss(demo.elapsedS)} / {mmss(DEMO_LENGTH)}
            </span>
            {demo.paused && !done && <span className="rounded bg-warn-soft px-1.5 py-[1px] t-micro font-semibold text-warn">Paused — explore freely, then resume</span>}
            <div className="ml-auto flex items-center gap-0.5 max-lg:-mx-2 max-lg:w-[calc(100%+16px)] max-lg:justify-between">
              <button type="button" className="rounded-md p-1 text-ink hover:bg-white/10" onClick={demoControls.back} aria-label="Previous step" data-tip="Previous step" data-tip-pos="top">
                <SkipBack size={15} />
              </button>
              {demo.paused || done ? (
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-md bg-[#F2F6FA] px-2 py-1 text-[12px] font-semibold text-[#0b1624] hover:bg-white"
                  onClick={demoControls.resume}
                  data-testid="demo-resume"
                >
                  {done ? <RotateCcw size={13} /> : <Play size={13} fill="currentColor" />}
                  {done ? 'Replay' : 'Resume'}
                </button>
              ) : (
                <button type="button" className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[12px] font-semibold text-navy hover:bg-white/15" onClick={demoControls.pause} data-testid="demo-pause">
                  <Pause size={13} fill="currentColor" />
                  Pause
                </button>
              )}
              <button type="button" className="rounded-md p-1 text-ink hover:bg-white/10" onClick={demoControls.skip} aria-label="Skip step" data-tip="Skip to next step" data-tip-pos="top" data-testid="demo-skip">
                <SkipForward size={15} />
              </button>
              <button type="button" className="rounded-md p-1 text-ink hover:bg-white/10" onClick={demoControls.restart} aria-label="Restart demo" data-tip="Restart" data-tip-pos="top">
                <RotateCcw size={15} />
              </button>
              <button type="button" className="rounded-md p-1 text-ink hover:bg-white/10" onClick={demoControls.exit} aria-label="Exit demo" data-tip="Exit demo" data-tip-pos="top" data-testid="demo-exit">
                <X size={15} />
              </button>
            </div>
          </div>
          <div className="mt-1.5 text-[16px] font-semibold text-navy">{done ? 'Demo complete' : step.title}</div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink max-lg:landscape:line-clamp-2" data-testid="demo-caption">
            {done ? 'Replay the sequence, or explore the twin, Analytics and Reports freely.' : caption}
          </p>
          <div className="mt-2 flex gap-[3px]">
            {DEMO_STEPS.map((s, i) => {
              const f = Math.max(0, Math.min(1, (demo.elapsedS - s.start) / s.duration));
              return (
                <div key={s.id} className="h-[3px] overflow-hidden rounded-full bg-white/10" style={{ flex: s.duration }} title={s.title}>
                  <div className="h-full rounded-full bg-power" style={{ width: `${f * 100}%`, opacity: i === demo.stepIndex ? 1 : 0.55 }} />
                </div>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
