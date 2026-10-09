// Persistent header: kicker, platform title, line separator, build tag and the section indicator.
import { C } from '../theme';
import { COPY } from '../copy';
import { SCENES, DURATION } from '../timeline';
import { EASE } from '../engine/ease';
import { prog } from '../engine/anim';
import { measure, nullLayer, textLayer, type TextStyle } from '../engine/layers';
import { glow, line } from '../engine/draw';

const LEFT = 96;
const RIGHT = 1824;
const SECTION: TextStyle = { family: 'sans', size: 19, weight: 500, color: C.white, align: 'right' };
const INDEX: TextStyle = { family: 'mono', size: 14, weight: 500, color: C.cyan, align: 'right', tracking: 0.06 };

export function chrome(ctx: CanvasRenderingContext2D, t: number) {
  // the header steps back while scene 3's numbers take centre stage
  const dim = 1 - 0.42 * prog(t, 13.0, 13.6, EASE.inOut);
  nullLayer(ctx, { opacity: dim }, () => {
    const kicker = prog(t, 0.2, 0.85, EASE.out);
    textLayer(ctx, COPY.kicker, LEFT + (1 - kicker) * -12, 76, { family: 'mono', size: 13, weight: 500, color: C.cyan, tracking: 0.22 }, kicker);
    textLayer(ctx, COPY.build, RIGHT, 76, { family: 'mono', size: 13, color: C.text3, tracking: 0.12, align: 'right' }, kicker);

    const title = prog(t, 0.3, 1.15, EASE.out);
    textLayer(ctx, COPY.title, LEFT - (1 - title) * 26, 121, { family: 'sans', size: 36, weight: 600, color: C.white, tracking: -0.012 }, title);

    // separator: a hairline across the frame with a short cyan lead
    line(ctx, LEFT, 150.5, RIGHT, 150.5, prog(t, 0.5, 1.5, EASE.inOut), 'rgba(255, 255, 255, 0.14)', 1);
    ctx.save();
    glow(ctx, 'rgba(79, 251, 223, 0.7)', 10);
    line(ctx, LEFT, 150.5, LEFT + 144, 150.5, prog(t, 0.7, 1.35, EASE.inOut), C.cyan, 2);
    ctx.restore();

    // section indicator, cross-fading at each scene boundary
    for (const s of SCENES) {
      const first = s.start === 0;
      const last = s.end >= DURATION;
      const inn = prog(t, first ? 0.45 : s.start, first ? 1.1 : s.start + 0.55, EASE.out);
      const out = last ? 0 : prog(t, s.end - 0.5, s.end - 0.05, EASE.in);
      const k = inn * (1 - out);
      if (k <= 0.001) continue;
      const dy = (1 - inn) * 10 - out * 10;
      textLayer(ctx, s.label, RIGHT, 121 + dy, SECTION, k);
      textLayer(ctx, s.index, RIGHT - measure(ctx, s.label, SECTION) - 18, 121 + dy, INDEX, k);
    }
  });
}
