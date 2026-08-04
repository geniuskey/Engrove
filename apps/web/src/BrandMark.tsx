export function BrandMark({
  className = '',
  variant = 'auto',
}: {
  className?: string;
  variant?: 'auto' | 'light' | 'dark';
}) {
  return (
    <span
      aria-hidden="true"
      className={`engrove-brand-mark engrove-brand-mark--${variant} relative inline-grid ${className}`}
    >
      <img
        alt=""
        className="engrove-brand-mark-light col-start-1 row-start-1 size-full"
        src="/engrove-mark-light.png"
      />
      <img
        alt=""
        className="engrove-brand-mark-dark col-start-1 row-start-1 size-full"
        src="/engrove-mark-dark.png"
      />
    </span>
  );
}
