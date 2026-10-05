/** ENCIRRA mark: three CBRN arcs around a fused core. */
export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="11" fill="none" stroke="#2b3644" strokeWidth="1.6" />
      <path d="M16 5a11 11 0 0 1 9.53 5.5" fill="none" stroke="#2dd4bf" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M25.53 21.5A11 11 0 0 1 6.47 21.5" fill="none" stroke="#ff9142" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M6.47 10.5A11 11 0 0 1 11.6 5.9" fill="none" stroke="#6ec1f5" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="16" cy="16" r="3.4" fill="#ece7df" />
      <circle cx="16" cy="16" r="6.4" fill="none" stroke="#ece7df" strokeOpacity="0.18" strokeWidth="1" />
    </svg>
  );
}
