import { cx } from '../../utils/format';

/** Shared navigation styles for the guided demo and AI Engine shells, in the home page's visual language. */
export const shellRoot = 'mre-app min-h-screen';
export const shellBody = 'flex min-h-[calc(100vh-3.5rem)]';
export const shellAside = 'sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 flex-col border-r border-line bg-bg lg:flex';
export const shellMain = 'mx-auto max-w-[1280px] space-y-6 px-5 py-8';
export const shellMobileNav = 'flex w-full gap-1.5 overflow-x-auto pb-1 lg:hidden';

export const sideLink = ({ isActive }: { isActive: boolean }) => cx(
  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
  isActive ? 'bg-panel2 font-medium text-ink shadow-[inset_2px_0_0_var(--color-accent)]' : 'text-mute hover:bg-panel hover:text-ink',
);
export const pillLink = ({ isActive }: { isActive: boolean }) => cx(
  'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
  isActive ? 'border-ink bg-ink text-bg' : 'border-line text-mute hover:border-line2 hover:text-ink',
);
