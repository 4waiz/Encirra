/**
 * Standalone scene entry for visual QA (dev server only): renders <TwinCanvas/> without the
 * application shell so scene screenshots never depend on in-progress UI work.
 * Served at /src/scene/qa/index.html; not part of the production build.
 */
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import { TwinCanvas } from '../TwinCanvas';

createRoot(document.getElementById('root')!).render(
  <div style={{ position: 'relative', width: '100%', height: '100%' }}>
    <TwinCanvas />
  </div>,
);
