// Palette and type for the ENCIRRA QA release video.

/** Logical frame size; every scene draws in these coordinates (the renderer scales for 4K). */
export const W = 1920;
export const H = 1080;

export const C = {
  bg: '#0B0C10',
  white: '#FFFFFF',
  cyan: '#4FFBDF',
  mint: '#00E676',
  /** secondary and tertiary text */
  text2: 'rgba(255, 255, 255, 0.64)',
  text3: 'rgba(255, 255, 255, 0.40)',
  /** hairlines and card surfaces */
  line: 'rgba(255, 255, 255, 0.12)',
  card: 'rgba(255, 255, 255, 0.028)',
  panel: '#0F1117',
};

export const FONT = {
  sans: '"Inter Variable", "Inter", system-ui, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
};

/** Render state shared with the drawing helpers (glow radii are in device pixels, so they follow the scale). */
export const RENDER = { scale: 1 };
