import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../../utils/format';
import type { EvidenceStatus } from '../../types/evidence';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'mute';
const toneCls: Record<Tone, string> = {
  ok: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  warn: 'text-amber-800 bg-amber-50 border-amber-200',
  bad: 'text-rose-700 bg-rose-50 border-rose-200',
  info: 'text-indigo-700 bg-indigo-50 border-indigo-200',
  mute: 'text-slate-600 bg-slate-100 border-slate-200',
};
export const toneText: Record<Tone, string> = {
  ok: 'text-emerald-700',
  warn: 'text-amber-700',
  bad: 'text-rose-700',
  info: 'text-indigo-700',
  mute: 'text-slate-500',
};
export const toneBar: Record<Tone, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-rose-500',
  info: 'bg-indigo-600',
  mute: 'bg-slate-400',
};

export function Badge({ tone = 'mute', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none whitespace-nowrap', toneCls[tone], className)}>{children}</span>;
}
export const statusTone = (s: EvidenceStatus): Tone => (s === 'ILLICIT' ? 'bad' : s === 'BENIGN' ? 'ok' : 'mute');
export const statusLabel = (s: EvidenceStatus) => (s === 'ILLICIT' ? 'Red flag' : s === 'BENIGN' ? 'Normal' : 'No data');
export const StatusBadge = ({ s }: { s: EvidenceStatus }) => <Badge tone={statusTone(s)}>{statusLabel(s)}</Badge>;

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-xl border border-line bg-panel shadow-[0_1px_2px_rgba(15,23,42,0.04)]', className)}>{children}</div>;
}
export function Panel({ title, subtitle, right, children, className, bodyClass }: { title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <Card className={className}>
      {(title || right) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div><div className="text-sm font-semibold text-ink">{title}</div>{subtitle && <div className="mt-0.5 text-xs text-mute">{subtitle}</div>}</div>
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
      <div className="text-xs font-medium text-mute">{label}</div>
      <div className={cx('mt-1 text-2xl font-bold tabular-nums tracking-tight', tone ? toneText[tone] : 'text-ink')}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-dim">{sub}</div>}
    </Card>
  );
}
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'outline' | 'danger'; size?: 'sm' | 'md' | 'lg' };
export function Btn({ variant = 'outline', size = 'md', className, ...p }: BtnProps) {
  const v = {
    primary: 'bg-slate-900 text-white hover:bg-slate-800 border-slate-900 shadow-xs',
    outline: 'border-line2 bg-panel text-ink hover:bg-panel2 hover:border-slate-400',
    ghost: 'border-transparent text-mute hover:text-ink hover:bg-panel2',
    danger: 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100',
  }[variant];
  const s = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-3.5 py-2 text-sm', lg: 'px-5 py-2.5 text-sm' }[size];
  return <button {...p} className={cx('inline-flex items-center justify-center gap-2 rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40', v, s, className)} />;
}
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-line" role="tablist">
      {tabs.map(t => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('-mb-px border-b-2 px-3.5 py-2 text-sm font-medium transition-colors', value === t.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-mute hover:text-ink')}>{t.label}</button>
      ))}
    </div>
  );
}
export function Bar({ value, tone = 'info', className }: { value: number; tone?: Tone; className?: string }) {
  return <div className={cx('h-2 overflow-hidden rounded-full bg-slate-200', className)}><div className={cx('h-full rounded-full transition-all duration-500', toneBar[tone])} style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} /></div>;
}
export function Callout({ tone = 'info', title, children }: { tone?: Tone; title?: ReactNode; children: ReactNode }) {
  const b = {
    ok: 'border-emerald-500 bg-emerald-50/70',
    warn: 'border-amber-500 bg-amber-50/70',
    bad: 'border-rose-500 bg-rose-50/70',
    info: 'border-indigo-500 bg-indigo-50/60',
    mute: 'border-slate-300 bg-panel2',
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
