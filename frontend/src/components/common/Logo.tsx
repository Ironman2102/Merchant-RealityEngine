const base = import.meta.env.BASE_URL;

/** The Merchant Reality Engine lockup (orange MRE tile, dashed shadow tile, wordmark), dark-background inks. */
export function BrandLogo({ height = 36, className }: { height?: number; className?: string }) {
  return <img src={`${base}logo-dark.svg`} alt="Merchant Reality Engine" height={height} style={{ height, width: 'auto' }} className={className} />;
}

/** The MRE tile on its own, for tight spaces. */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return <img src={`${base}mark-dark.svg`} alt="" aria-hidden="true" width={size} height={size} className={className} />;
}

export function Logo({ small }: { small?: boolean }) {
  return <BrandLogo height={small ? 30 : 36} />;
}
