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
          <label className="block text-xs text-mute">Username<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} className="mt-1 w-full rounded-md border border-line2 bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-ink" required /></label>
          <label className="block text-xs text-mute">Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full rounded-md border border-line2 bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-ink" required /></label>
          {error && <p role="alert" className="text-xs text-stone-200">{error}</p>}
          <Btn variant="primary" disabled={busy}><LogIn size={14} />{busy ? 'Signing in…' : 'Sign in'}</Btn>
        </form>
        <p className="mt-4 text-[11px] text-dim">Use the username and password you were given. Several people can be signed in at once.</p>
      </Panel>
    </div>
  );
}

export function SignedInAs({ user, logout }: { user: SessionUser; logout: () => void }) {
  return (
    <div className="space-y-1 border-t border-line p-4 text-xs text-mute">
      <div className="flex items-center justify-between gap-2">
        <span>Signed in as <b className="text-ink">{user.username}</b> · <span className="font-mono">{user.role}</span></span>
        <button onClick={logout} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap hover:text-ink" aria-label="Sign out"><LogOut size={13} />Sign out</button>
      </div>
      <p className="text-[10px] text-dim">Approvals need a different person signed in with their own account.</p>
    </div>
  );
}
