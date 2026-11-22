// A bagel seen from above, turning: ring of dough with a few sesame seeds.
export function BagelSpinner({ size = 24, light = false }: { size?: number; light?: boolean }) {
  return (
    <svg className="spin" data-light={light || undefined} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="13" fill="none" className="spin-dough" strokeWidth="9" />
      <circle cx="20" cy="20" r="13" fill="none" className="spin-crust" strokeWidth="9" strokeDasharray="20 62" strokeLinecap="round" />
      <g className="spin-seeds">
        <ellipse cx="20" cy="9" rx="1.6" ry="1" />
        <ellipse cx="30" cy="16" rx="1.6" ry="1" transform="rotate(60 30 16)" />
        <ellipse cx="27" cy="29" rx="1.6" ry="1" transform="rotate(-30 27 29)" />
        <ellipse cx="11" cy="26" rx="1.6" ry="1" transform="rotate(40 11 26)" />
      </g>
    </svg>
  );
}
