// Every string on screen. Text is set live in vector type each frame, so editing a line here and
// re-rendering is all it takes; layouts that depend on width (pills, badge, wipe) re-measure themselves.

export const COPY = {
  kicker: 'QA RELEASE LOG',
  title: 'ENCIRRA CBRN Command Platform',
  build: 'PHASE 2  ·  BUILD 4e084e5',

  performance: {
    card: 'Performance Optimization',
    meta: 'PRODUCTION BUILD  ·  3 SCREEN CYCLES',
    frameLabel: 'JS Frame Rate:',
    frameUnit: 'ms / frame',
    frameBudget: '16.7 ms frame budget (60 fps)',
    memoryLabel: 'Memory State:',
    memoryValue: 'Stable',
    memoryNote: '(0 leaks detected)',
    heap: '28.6 MB',
    heapNote: 'JS heap · steady',
  },

  enhancements: {
    before: 'BEFORE',
    after: 'AFTER',
    beforeCaption: 'Overlapping Incident Labels & Truncated Feeds',
    ringLabel: 'Sensor Cyan Ring mapping',
    afterCaption: 'Auto-framing & dynamic label placement fixed',
    graphLabel: 'AI INSIGHTS  ·  CORRELATION GRAPH',
    graphCaption: 'AI Insights Panel: Optimized to fit without scrolling',
    fullWidth: '100% width',
    labels: { incident: 'INC-1006-01', asset: 'UGV-01 · Inspecting', sensor: 'RAD-S17', feed: 'CAM-01  |  Exterior · Units 1–4 overview' },
  },

  webgl: {
    before: '3D Model Weight: 6.7 MB',
    after: 'Optimized Model: 0.68 MB',
    delta: '−90%',
    badge: 'WebGL Errors: 0 (Startup Shadow Bug Fixed)',
    footnote: 'Functional QA 23 / 23  ·  0 console errors  ·  0 failed requests',
  },
};
