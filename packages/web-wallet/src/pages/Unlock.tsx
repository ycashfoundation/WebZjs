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
    if (status === 'unlocked') navigate('/dashboard/account-summary', { replace: true });
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
    <div className="max-w-md mx-auto px-4 py-16">
      <h1 className="text-3xl font-semibold mb-2">Unlock Wallet</h1>
      <p className="text-neutral-600 mb-6">
        Enter the passphrase you set when creating the wallet.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input
          type="password"
          placeholder="Passphrase"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          className="border border-neutral-300 rounded-xl px-4 py-3"
          autoFocus
        />
        {error && <div className="text-red-600 text-sm">{error}</div>}
        <Button
          label={submitting ? 'Unlocking…' : 'Unlock'}
          disabled={submitting || !passphrase}
          onClick={() => handleSubmit()}
          type="submit"
        />
      </form>

      <div className="mt-10 border-t border-neutral-200 pt-6">
        {!confirmWipe ? (
          <button
            type="button"
            onClick={() => setConfirmWipe(true)}
            className="text-sm text-neutral-500 underline hover:text-red-600"
          >
            Forgot passphrase / start over
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-red-700">
              Wiping the vault will delete the encrypted seed from this
              browser. If you don't have the 24-word phrase written down
              elsewhere, you will permanently lose access to any funds at
              that seed.
            </p>
            <div className="flex gap-3">
              <Button
                label="Wipe vault"
                onClick={handleWipe}
                variant="secondary"
              />
              <Button
                label="Cancel"
                onClick={() => setConfirmWipe(false)}
                variant="secondary"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Unlock;
