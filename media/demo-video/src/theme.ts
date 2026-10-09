// Palette and type for the ENCIRRA demo film (shared with the QA release piece and the app itself).

/** Logical frame size; every layer draws in these coordinates (the renderer scales for 4K). */
export const W = 1920;
export const H = 1080;

export const C = {
  bg: '#0B0C10',
  white: '#FFFFFF',
  cyan: '#4FFBDF',
  mint: '#00E676',
  amber: '#F2B33D',
  /** secondary and tertiary text */
  text2: 'rgba(255, 255, 255, 0.66)',
  text3: 'rgba(255, 255, 255, 0.42)',
  line: 'rgba(255, 255, 255, 0.12)',
  chip: 'rgba(11, 13, 18, 0.92)',
};

export const FONT = {
  sans: '"Inter Variable", "Inter", system-ui, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
};

/** Render state shared with the drawing helpers (glow radii are in device pixels, so they follow the scale). */
export const RENDER = { scale: 1 };

/** Where the app footage sits on screen when the camera is not zoomed (16:9, below the caption band). */
export const WINDOW = { x: 160, y: 150, w: 1600, h: 900, r: 14 };
