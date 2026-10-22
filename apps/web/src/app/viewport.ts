/**
 * Viewport classes. Phones and small tablets (< 1024 CSS px wide) get the touch layout
 * (src/mobile); everything ≥ 1024 px keeps the desktop command-centre layout unchanged.
 */
import { useMediaQuery } from '@/dashboard/kit';

export const MOBILE_QUERY = '(max-width: 1023.98px)';
/** phone held sideways: short and wide */
export const LANDSCAPE_QUERY = '(max-width: 1023.98px) and (orientation: landscape) and (max-height: 600px)';
/** wide enough for Story and Live side by side inside the sheet (tablet portrait) */
export const TWO_COLUMN_QUERY = '(min-width: 700px) and (max-width: 1023.98px) and (min-height: 700px)';

export const useIsMobile = () => useMediaQuery(MOBILE_QUERY);
export const useIsLandscapePhone = () => useMediaQuery(LANDSCAPE_QUERY);
export const useIsTwoColumn = () => useMediaQuery(TWO_COLUMN_QUERY);
