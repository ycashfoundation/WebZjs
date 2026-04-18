import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import Button from '../components/Button/Button';

const Unlock: React.FC = () => {
  const navigate = useNavigate();
  const { status, unlock, wipeVault } = useSession();
  const [passphrase, setPassphrase] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  useEffect(() => {
    if (status === 'no-vault') navigate('/', { replace: true });
    if (status === 'unlocked')
      navigate('/dashboard/account-summary', { replace: true });
  }, [status, navigate]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await unlock(passphrase);
    } catch (err) {
      // AES-GCM auth failures surface as DOMException on wrong passphrase.
      // Don't leak the crypto error shape — user-facing message is the same
      // whether they mistyped or the vault is genuinely corrupt.
      setError('Passphrase did not unlock the vault.');
      setSubmitting(false);
    }
  };

  const handleWipe = async () => {
    await wipeVault();
    navigate('/', { replace: true });
  };

  return (
    <div className="max-w-md mx-auto px-6 py-20">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-text-dim mb-3">
        Welcome back
      </div>
      <h1 className="text-4xl font-semibold tracking-tight mb-3">
        Unlock wallet
      </h1>
      <p className="text-text-muted mb-8 leading-relaxed">
        Enter the passphrase you set when you created this wallet.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="password"
          placeholder="Passphrase"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          className="bg-card border border-border rounded-md px-4 py-3 text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
          autoFocus
        />
        {error && (
          <div className="text-danger text-sm font-mono">{error}</div>
        )}
        <div className="mt-2">
          <Button
            label={submitting ? 'Unlocking…' : 'Unlock'}
            disabled={submitting || !passphrase}
            onClick={() => handleSubmit()}
            type="submit"
          />
        </div>
      </form>

      <div className="mt-14 pt-6 border-t border-border">
        {!confirmWipe ? (
          <button
            type="button"
            onClick={() => setConfirmWipe(true)}
            className="font-mono text-[11px] uppercase tracking-[0.15em] text-text-dim hover:text-danger transition-colors"
          >
            Forgot passphrase · start over
          </button>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="card-surface p-4 border-danger/40">
              <div className="flex items-center gap-2 mb-2">
                <span className="pill pill-danger">danger</span>
              </div>
              <p className="text-sm text-text leading-relaxed">
                Wiping the vault deletes the encrypted seed from this
                browser. If you don't have the 24-word phrase stored
                somewhere else, funds at that seed are unrecoverable.
              </p>
            </div>
            <div className="flex gap-3">
              <Button label="Wipe vault" onClick={handleWipe} variant="danger" />
              <Button
                label="Cancel"
                onClick={() => setConfirmWipe(false)}
                variant="ghost"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Unlock;
