import { useState } from 'react';
import { confirmSignUp, signIn, signUp, type AuthUser } from '../lib/auth';

type Mode = 'signIn' | 'signUp' | 'confirm';

interface AuthPanelProps {
  onSignedIn: (user: AuthUser) => void;
}

export function AuthPanel({ onSignedIn }: AuthPanelProps) {
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handle(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signIn') {
        onSignedIn(await signIn(email, password));
      } else if (mode === 'signUp') {
        await signUp(email, password);
        setMode('confirm');
      } else {
        await confirmSignUp(email, code);
        onSignedIn(await signIn(email, password));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={handle}>
      <h2>
        {mode === 'signIn' && 'Sign in to report'}
        {mode === 'signUp' && 'Create an account'}
        {mode === 'confirm' && 'Check your email'}
      </h2>

      {mode === 'confirm' ? (
        <>
          <p className="hint">
            We sent a six-digit code to {email}. Enter it to finish setting up your
            account.
          </p>
          <label>
            Confirmation code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
          </label>
        </>
      ) : (
        <>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
              required
            />
          </label>
          {mode === 'signUp' && (
            <p className="hint">At least 12 characters, with upper, lower and a digit.</p>
          )}
        </>
      )}

      {error && <p className="error">{error}</p>}

      <button type="submit" disabled={busy}>
        {busy ? 'Working…' : mode === 'signUp' ? 'Create account' : 'Continue'}
      </button>

      {mode !== 'confirm' && (
        <button
          type="button"
          className="link"
          onClick={() => {
            setError(null);
            setMode(mode === 'signIn' ? 'signUp' : 'signIn');
          }}
        >
          {mode === 'signIn' ? 'Need an account?' : 'Already have one?'}
        </button>
      )}
    </form>
  );
}
