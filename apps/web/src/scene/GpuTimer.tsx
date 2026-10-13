/**
 * Development-only frame profiler (enabled with ?gputime=1): GPU time per frame via
 * EXT_disjoint_timer_query_webgl2 around the composer render, plus CPU time of the render loop.
 * Results land in fx.gpuMs / fx.cpuMs (rolling means) for the QA scripts.
 */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { fx } from './runtime';

export function GpuTimer() {
  const gl = useThree((s) => s.gl);
  const st = useRef<{ ext: unknown; ctx: WebGL2RenderingContext; pending: WebGLQuery[]; active: WebGLQuery | null; cpu0: number } | null>(null);

  useEffect(() => {
    const ctx = gl.getContext() as WebGL2RenderingContext;
    const ext = ctx.getExtension('EXT_disjoint_timer_query_webgl2');
    st.current = { ext, ctx, pending: [], active: null, cpu0: 0 };
    fx.gpuMs = ext ? 0 : -1;
  }, [gl]);

  // start of the frame (before scene updates): CPU timer
  useFrame(() => {
    if (st.current) st.current.cpu0 = performance.now();
  }, -100);

  // just before the composer renders
  useFrame(() => {
    const s = st.current;
    if (!s || !s.ext) return;
    const e = s.ext as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
    // collect finished queries
    while (s.pending.length) {
      const q = s.pending[0];
      if (!s.ctx.getQueryParameter(q, s.ctx.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = s.ctx.getParameter(e.GPU_DISJOINT_EXT);
      const ns = s.ctx.getQueryParameter(q, s.ctx.QUERY_RESULT) as number;
      if (!disjoint) fx.gpuMs = fx.gpuMs > 0 ? fx.gpuMs * 0.9 + (ns / 1e6) * 0.1 : ns / 1e6;
      s.ctx.deleteQuery(q);
      s.pending.shift();
    }
    if (s.pending.length < 4) {
      const q = s.ctx.createQuery();
      if (q) {
        s.ctx.beginQuery(e.TIME_ELAPSED_EXT, q);
        s.active = q;
      }
    }
  }, 0.99);

  // just after the composer rendered
  useFrame(() => {
    const s = st.current;
    if (!s) return;
    if (s.ext && s.active) {
      const e = s.ext as { TIME_ELAPSED_EXT: number };
      s.ctx.endQuery(e.TIME_ELAPSED_EXT);
      s.pending.push(s.active);
      s.active = null;
    }
    const cpu = performance.now() - s.cpu0;
    fx.cpuMs = fx.cpuMs > 0 ? fx.cpuMs * 0.9 + cpu * 0.1 : cpu;
  }, 1.01);

  return null;
}
