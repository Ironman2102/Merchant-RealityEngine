import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { LogIn, LogOut } from 'lucide-react';
import { Btn, Panel } from '../ui/ui';
import { me, signIn, signOut, type SessionUser } from '../../services/pilotApi';

/** Gate for the AI Engine: the investigation API requires a signed-in user with a role. */
export function SignInGate({ children }: { children: (user: SessionUser, logout: () => void) => ReactNode }) {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    me().then(setUser).catch(() => setUser(null));
    const onSwitch = (ev: Event) => {
      const next = (ev as CustomEvent<SessionUser>).detail;
      if (next) setUser(next);
    };
    window.addEventListener('mre-role-switched', onSwitch);
    return () => window.removeEventListener('mre-role-switched', onSwitch);
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { setUser(await signIn(username, password)); setPassword(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'Sign-in failed.'); }
    finally { setBusy(false); }
  };
  if (user === undefined) return <div className="py-12 text-center text-sm text-mute" role="status">Checking your session…</div>;
  if (user) return <>{children(user, () => { void signOut().then(() => setUser(null)); })}</>;
  return (
    <div className="mx-auto max-w-sm py-10">
      <Panel title="Sign in to the AI Engine" subtitle="Cases hold merchant data, so every action is tied to a named user and role.">
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-xs text-mute">Username<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} className="mt-1 w-full rounded border border-line2 bg-bg px-3 py-2 text-sm text-ink" required /></label>
          <label className="block text-xs text-mute">Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full rounded border border-line2 bg-bg px-3 py-2 text-sm text-ink" required /></label>
          {error && <p role="alert" className="text-xs text-stone-200">{error}</p>}
          <Btn variant="primary" disabled={busy}><LogIn size={14} />{busy ? 'Signing in…' : 'Sign in'}</Btn>
        </form>
        <p className="mt-4 text-[11px] text-dim">Use the username and password you were given. Several people can be signed in at once.</p>
      </Panel>
    </div>
  );
}

const DEMO_ROLES = ['analyst', 'reviewer', 'legal', 'admin'] as const;

export function SignedInAs({ user, logout }: { user: SessionUser; logout: () => void }) {
  const [switching, setSwitching] = useState(false);
  const switchRole = async (role: string) => {
    setSwitching(true);
    try {
      const res = await fetch('/api/auth/demo-switch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (res.ok) {
        const body = await res.json() as { user?: SessionUser };
        if (body.user) window.dispatchEvent(new CustomEvent('mre-role-switched', { detail: body.user }));
      }
    } finally {
      setSwitching(false);
    }
  };
  return (
    <div className="space-y-2 border-t border-line p-4 text-xs text-mute">
      <div className="flex items-center justify-between gap-2">
        <span>Signed in as <b className="text-ink">{user.username}</b> · <span className="font-mono text-zinc-300">{user.role}</span></span>
        <button onClick={logout} className="inline-flex items-center gap-1 hover:text-ink" aria-label="Sign out"><LogOut size={13} />Sign out</button>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-dim">Maker/Checker persona switch</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {DEMO_ROLES.map(r => (
            <button
              key={r}
              type="button"
              disabled={switching || (user.role === r && user.username === `demo-${r}`)}
              onClick={() => void switchRole(r)}
              className={`rounded border px-1.5 py-0.5 text-[11px] transition-colors ${
                user.role === r
                  ? 'border-zinc-400 bg-zinc-400/15 text-zinc-100'
                  : 'border-line2 bg-panel2 text-mute hover:text-ink'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
