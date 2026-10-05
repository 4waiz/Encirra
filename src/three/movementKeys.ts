// Held-key state for WASD navigation (twin camera and repositionable feed cameras).
// Keys typed into text fields and menus are ignored; arrow-key widgets keep their arrows.

const CODES = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyE', 'PageUp'],
  down: ['KeyQ', 'PageDown'],
} as const;

const MOVE_CODES = new Set<string>(Object.values(CODES).flat());
const SHIFT = new Set(['ShiftLeft', 'ShiftRight']);
// Text entry and open menus swallow every movement key; widgets that navigate with the arrow keys
// (segmented radios, tabs, sliders, lists, checkboxes) only swallow the arrow / page keys, so WASD keeps
// working after clicking one of them.
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'number', 'password', 'url', 'tel', 'date', 'time']);
const TEXT_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'menu', 'menuitem']);
const ARROW_ROLES = new Set(['slider', 'listbox', 'option', 'radio', 'radiogroup', 'tab', 'tablist', 'grid', 'tree']);
const held = new Set<string>();

function ignoredTarget(t: EventTarget | null, code: string) {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  const role = el.getAttribute('role') ?? '';
  if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable || TEXT_ROLES.has(role)) return true;
  if (tag === 'INPUT' && TEXT_INPUT_TYPES.has((el as HTMLInputElement).type)) return true;
  const arrowKey = !code.startsWith('Key');
  return arrowKey && (ARROW_ROLES.has(role) || tag === 'INPUT');
}

/** Installs global listeners; `enabled` decides whether a movement target is currently active. */
export function installMovementKeys(enabled: () => boolean) {
  const onDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const isMove = MOVE_CODES.has(e.code);
    if (!isMove && !SHIFT.has(e.code)) return;
    if (ignoredTarget(e.target, e.code) || !enabled()) return;
    held.add(e.code);
    // arrows / page keys would otherwise scroll a panel under the pointer
    if (isMove && !e.code.startsWith('Key')) e.preventDefault();
  };
  const onUp = (e: KeyboardEvent) => {
    held.delete(e.code);
  };
  const clear = () => held.clear();
  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);
  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', clear);
  return () => {
    window.removeEventListener('keydown', onDown);
    window.removeEventListener('keyup', onUp);
    window.removeEventListener('blur', clear);
    document.removeEventListener('visibilitychange', clear);
    held.clear();
  };
}

export function clearMovementKeys() {
  held.clear();
}

export function movementAxes() {
  const has = (k: keyof typeof CODES) => CODES[k].some((c) => held.has(c));
  const fwd = (has('forward') ? 1 : 0) - (has('back') ? 1 : 0);
  const right = (has('right') ? 1 : 0) - (has('left') ? 1 : 0);
  const up = (has('up') ? 1 : 0) - (has('down') ? 1 : 0);
  return { fwd, right, up, fast: held.has('ShiftLeft') || held.has('ShiftRight'), active: fwd !== 0 || right !== 0 || up !== 0 };
}
