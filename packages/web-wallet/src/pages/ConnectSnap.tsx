import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import { useMetaMaskContext } from '../context/MetamaskContext';
import { useMetaMask } from '../hooks/snaps/useMetaMask';
import { useRequestSnap } from '../hooks/snaps/useRequestSnap';
import Button from '../components/Button/Button';
import Loader from '../components/Loader/Loader';
import { YCASH_FORK_HEIGHT } from '../config/constants';

/**
 * Snap onboarding page. Prompts the user to install the Ycash MetaMask snap,
 * commits the 'snap' backend choice once the snap is installed, and routes
 * to the dashboard where the account will be bootstrapped via the snap's
 * UFVK.
 */
const ConnectSnap: React.FC = () => {
  const navigate = useNavigate();
  const { status, chooseSnapBackend } = useSession();
  const { provider } = useMetaMaskContext();
  const { snapsDetected, installedSnap } = useMetaMask();
  const requestSnap = useRequestSnap();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoverOlder, setRecoverOlder] = useState(false);
  const [birthdayInput, setBirthdayInput] = useState('');

  // Already unlocked? Bounce to dashboard — snap backend commits are idempotent
  // but we don't want to render the onboarding screen twice.
  useEffect(() => {
    if (status === 'unlocked') navigate('/dashboard/account-summary', { replace: true });
  }, [status, navigate]);

  const handleInstallAndConnect = async () => {
    setError(null);
    let birthdayHeight: number | undefined;
    if (recoverOlder) {
      const parsed = Number.parseInt(birthdayInput, 10);
      if (
        !Number.isFinite(parsed) ||
        String(parsed) !== birthdayInput.trim() ||
        parsed < YCASH_FORK_HEIGHT
      ) {
        setError(
          `Enter a whole block height ≥ ${YCASH_FORK_HEIGHT} (Ycash fork height).`,
        );
        return;
      }
      birthdayHeight = parsed;
    }
    setBusy(true);
    try {
      if (!installedSnap) {
        await requestSnap();
      }
      await chooseSnapBackend(birthdayHeight);
      // Navigation happens via the effect above once status flips.
    } catch (err) {
      console.error('Connect snap failed:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to connect the Ycash snap. Check MetaMask and try again.',
      );
      setBusy(false);
    }
  };

  if (status === 'unknown') {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader />
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <h1 className="text-3xl font-semibold mb-2">Connect MetaMask Snap</h1>
      <p className="text-neutral-600 mb-6">
        The Ycash MetaMask Snap keeps your seed inside the MetaMask sandbox.
        Your browser never sees the seed phrase; you approve every signing
        operation in MetaMask.
      </p>

      {!provider && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
          <p>
            MetaMask not detected. Install the{' '}
            <a
              href="https://docs.metamask.io/snaps/get-started/install-flask/"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              MetaMask Flask
            </a>{' '}
            build to use Snaps, then refresh this page.
          </p>
        </div>
      )}

      {provider && !snapsDetected && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
          <p>
            Your MetaMask build doesn't support Snaps yet. Install{' '}
            <a
              href="https://docs.metamask.io/snaps/get-started/install-flask/"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              MetaMask Flask
            </a>
            .
          </p>
        </div>
      )}

      {installedSnap && (
        <div className="mb-6 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm">
          <p>Ycash Snap is installed. Click Connect to finish onboarding.</p>
        </div>
      )}

      <div className="mb-6 rounded-xl border border-neutral-200 p-4 text-sm">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={recoverOlder}
            onChange={(e) => setRecoverOlder(e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="font-medium">Recover older wallet?</span>
            <span className="block text-neutral-600 text-xs mt-1">
              By default, the snap starts syncing from the current chain tip.
              Enable this if you've connected this seed before and want to
              recover earlier shielded notes.
            </span>
          </span>
        </label>
        {recoverOlder && (
          <div className="mt-3 flex flex-col gap-1">
            <label className="text-neutral-600 text-xs">
              Birthday block (min: {YCASH_FORK_HEIGHT})
            </label>
            <input
              type="number"
              value={birthdayInput}
              onChange={(e) => setBirthdayInput(e.target.value)}
              placeholder="e.g. 2859770"
              min={YCASH_FORK_HEIGHT}
              className="px-2 py-1 border border-neutral-300 rounded text-sm w-full bg-white text-black"
            />
          </div>
        )}
      </div>

      {error && <div className="mb-4 text-sm text-red-600">{error}</div>}

      <Button
        label={
          busy
            ? 'Connecting…'
            : installedSnap
              ? 'Connect'
              : 'Install Ycash Snap'
        }
        onClick={handleInstallAndConnect}
        disabled={busy || !snapsDetected}
      />

      <div className="mt-10 border-t border-neutral-200 pt-6">
        <button
          type="button"
          onClick={() => navigate('/', { replace: true })}
          className="text-sm text-neutral-500 underline hover:text-neutral-800"
        >
          Back
        </button>
      </div>

      <div className="mt-8 text-xs text-neutral-500">
        Each shielded send triggers two MetaMask dialogs: one to authorize
        Sapling proving, then a second to sign the final Ycash transaction.
      </div>
    </div>
  );
};

export default ConnectSnap;
