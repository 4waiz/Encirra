import { setConsoleFunction } from 'three';

/**
 * React Three Fiber 9 still constructs THREE.Clock, which three r183+ flags as deprecated each time a
 * canvas mounts. That notice is upstream and not actionable here, so exactly that message is dropped;
 * every other three.js log, warning and error is passed through unchanged.
 */
const UPSTREAM_NOTICE = 'THREE.Clock: This module has been deprecated';

type StackTrace = { isStackTrace?: boolean; getError?: (message: string) => Error };

setConsoleFunction((type, message, ...params) => {
  if (type === 'warn' && message.startsWith(UPSTREAM_NOTICE)) return;
  const out = type === 'error' ? console.error : type === 'warn' ? console.warn : console.log;
  const trace = params[0] as StackTrace | undefined;
  if (trace?.isStackTrace && trace.getError) out(trace.getError(message));
  else out(message, ...params);
});
