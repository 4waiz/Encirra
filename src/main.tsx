import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-sans-condensed/500.css';
import '@fontsource/ibm-plex-sans-condensed/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/index.css';
import App from './App';
import { engine } from './simulation/engine';
import { useUI } from './store/ui';
import { useSim } from './store/sim';

engine.start();

// Automation hook for scripted demos and screenshot capture (local synthetic state only).
declare global {
  interface Window {
    __ENCIRRA__?: { engine: typeof engine; ui: typeof useUI; sim: typeof useSim };
  }
}
window.__ENCIRRA__ = { engine, ui: useUI, sim: useSim };

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
