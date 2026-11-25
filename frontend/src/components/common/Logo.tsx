export function Logo({ small }: { small?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={small ? 22 : 26} height={small ? 22 : 26} />
      <span className="text-[15px] font-semibold tracking-tight text-ink">Merchant Reality Engine</span>
    </span>
  );
}
