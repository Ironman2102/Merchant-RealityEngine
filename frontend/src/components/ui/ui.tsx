import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../../utils/format';
import type { EvidenceStatus } from '../../types/evidence';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'mute';
const toneCls: Record<Tone, string> = {
  ok: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  warn: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  bad: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
  info: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30',
  mute: 'text-[#d9cdbb] bg-white/[0.05] border-line2',
};
export const toneText: Record<Tone, string> = {
  ok: 'text-emerald-300',
  warn: 'text-amber-300',
  bad: 'text-rose-300',
  info: 'text-cyan-300',
  mute: 'text-mute',
};
export const toneBar: Record<Tone, string> = {
  ok: 'bg-emerald-400',
  warn: 'bg-amber-400',
  bad: 'bg-rose-400',
  info: 'bg-cyan-400',
  mute: 'bg-zinc-500',
};

export function Badge({ tone = 'mute', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none whitespace-nowrap', toneCls[tone], className)}>{children}</span>;
}
export const statusTone = (s: EvidenceStatus): Tone => (s === 'ILLICIT' ? 'bad' : s === 'BENIGN' ? 'ok' : 'mute');
export const statusLabel = (s: EvidenceStatus) => (s === 'ILLICIT' ? 'Red flag' : s === 'BENIGN' ? 'Normal' : 'No data');
export const StatusBadge = ({ s }: { s: EvidenceStatus }) => <Badge tone={statusTone(s)}>{statusLabel(s)}</Badge>;

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-2xl border border-line bg-panel shadow-[0_1px_0_rgba(246,239,228,0.03)_inset,0_10px_30px_-18px_rgba(0,0,0,0.8)]', className)}>{children}</div>;
}
export function Panel({ title, subtitle, right, children, className, bodyClass }: { title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <Card className={className}>
      {(title || right) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div><div className="font-display text-[15px] font-semibold tracking-tight text-ink">{title}</div>{subtitle && <div className="mt-0.5 text-xs text-mute">{subtitle}</div>}</div>
          {right}
        </div>
      )}
      <div className={cx('p-5', bodyClass)}>{children}</div>
    </Card>
  );
}
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <Card className="px-4 py-3.5">
      <div className="font-mono text-[10.5px] font-medium uppercase tracking-[.14em] text-mute">{label}</div>
      <div className={cx('mt-1.5 font-display text-[26px] font-bold tabular-nums tracking-tight', tone ? toneText[tone] : 'text-ink')}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-dim">{sub}</div>}
    </Card>
  );
}
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'outline' | 'danger'; size?: 'sm' | 'md' | 'lg' };
export function Btn({ variant = 'outline', size = 'md', className, ...p }: BtnProps) {
  const v = {
    primary: 'bg-crust text-[#140b05] hover:bg-[#ff8a4c] border-crust font-semibold',
    outline: 'border-line2 bg-panel text-ink hover:bg-panel2 hover:border-[#7a6754]',
    ghost: 'border-transparent text-mute hover:text-ink hover:bg-panel2',
    danger: 'border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20',
  }[variant];
  const s = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-3.5 py-2 text-sm', lg: 'px-5 py-2.5 text-sm' }[size];
  return <button {...p} className={cx('inline-flex items-center justify-center gap-2 rounded-full border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40', v, s, className)} />;
}
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-line" role="tablist">
      {tabs.map(t => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('-mb-px border-b-2 px-3.5 py-2 text-sm font-medium transition-colors', value === t.id ? 'border-crust text-ink' : 'border-transparent text-mute hover:text-ink')}>{t.label}</button>
      ))}
    </div>
  );
}
export function Bar({ value, tone = 'info', className }: { value: number; tone?: Tone; className?: string }) {
  return <div className={cx('h-2 overflow-hidden rounded-full bg-white/10', className)}><div className={cx('h-full rounded-full transition-all duration-500', toneBar[tone])} style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} /></div>;
}
export function Callout({ tone = 'info', title, children }: { tone?: Tone; title?: ReactNode; children: ReactNode }) {
  const b = {
    ok: 'border-emerald-400 bg-emerald-500/10',
    warn: 'border-amber-400 bg-amber-500/10',
    bad: 'border-rose-400 bg-rose-500/10',
    info: 'border-cyan-400 bg-cyan-500/10',
    mute: 'border-line2 bg-panel2',
  }[tone];
  return <div className={cx('rounded-r-lg border-l-4 px-4 py-3 text-sm text-ink', b)}>{title && <div className={cx('mb-0.5 font-semibold', toneText[tone])}>{title}</div>}<div className="text-mute">{children}</div></div>;
}
export const Mono = ({ children, className }: { children: ReactNode; className?: string }) => <span className={cx('font-mono text-[12px]', className)}>{children}</span>;
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="rounded-md border border-dashed border-line2 px-6 py-12 text-center"><div className="text-base font-medium text-ink">{title}</div><div className="mx-auto mt-1 max-w-md text-sm text-mute">{children}</div></div>;
}
export function Th({ children, className }: { children?: ReactNode; className?: string }) { return <th className={cx('px-3 py-2 text-left text-xs font-medium text-mute', className)}>{children}</th>; }
export function Td({ children, className }: { children?: ReactNode; className?: string }) { return <td className={cx('px-3 py-2 text-[13px]', className)}>{children}</td>; }
export const tableCls = 'w-full border-collapse text-left';
export const rowCls = 'border-t border-line hover:bg-panel2/60';
