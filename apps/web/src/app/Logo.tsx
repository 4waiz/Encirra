/**
 * Encirra mark: three offset bars forming an "E", stitched together by a network path whose
 * nodes sit on the bar tips — two infrastructures (power, water) coupled through shared nodes.
 */
export function LogoMark({ size = 48, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={(size * 64) / 52} viewBox="0 0 52 64" className={className} role="img" aria-label="Encirra">
      <defs>
        <linearGradient id="enc-logo-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4c95da" />
          <stop offset="1" stopColor="#1d4f86" />
        </linearGradient>
        <linearGradient id="enc-logo-b" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a9bccd" />
          <stop offset="1" stopColor="#5f7891" />
        </linearGradient>
        <linearGradient id="enc-logo-c" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#2a6cb5" />
          <stop offset="1" stopColor="#5aa6e6" />
        </linearGradient>
      </defs>
      {/* spine */}
      <path d="M4 6 L13 6 L13 58 L4 58 Z" fill="url(#enc-logo-a)" />
      {/* top bar */}
      <path d="M13 6 L41 6 L35 16 L13 16 Z" fill="url(#enc-logo-a)" />
      {/* middle bar (steel) */}
      <path d="M13 27 L31 27 L26.5 37 L13 37 Z" fill="url(#enc-logo-b)" />
      {/* bottom bar, folding upward */}
      <path d="M13 48 L36 48 L44 36 L48 36 L48 58 L13 58 Z" fill="url(#enc-logo-c)" />
      {/* network path across the bar tips */}
      <path d="M41.5 11 L32 32 L46 40" fill="none" stroke="#1d4f86" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
      <circle cx="41.5" cy="11" r="3.1" fill="#fff" stroke="#1d4f86" strokeWidth="1.6" />
      <circle cx="32" cy="32" r="3.1" fill="#fff" stroke="#5f7891" strokeWidth="1.6" />
      <circle cx="46" cy="40" r="3.1" fill="#fff" stroke="#2a6cb5" strokeWidth="1.6" />
    </svg>
  );
}
