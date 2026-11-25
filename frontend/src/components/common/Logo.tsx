/** A scored loaf: the bakery we use to explain the engine, drawn as the product mark. */
export function LoafMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M4 21c0-7 5.4-12 12-12s12 5 12 12c0 2.2-1.8 4-4 4H8c-2.2 0-4-1.8-4-4Z" fill="#ff6a2b" />
      <path d="M10.5 14.5l3 4.2M15.5 12.6l3 4.6M20.6 13.4l2.6 4" stroke="#140b05" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M7 25h18" stroke="#f4c95d" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ small }: { small?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LoafMark size={small ? 22 : 26} />
      <span className="font-display text-[15px] font-semibold tracking-tight text-ink">Merchant Reality Engine</span>
    </span>
  );
}
