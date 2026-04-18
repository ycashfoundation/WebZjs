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
    if (status === 'unlocked')
      navigate('/dashboard/account-summary', { replace: true });
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
    <div className="max-w-xl mx-auto px-6 py-16">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-text-dim mb-3">
        MetaMask signing
      </div>
      <h1 className="text-4xl font-semibold tracking-tight mb-3">
        Connect the Ycash Snap
      </h1>
      <p className="text-text-muted mb-8 leading-relaxed">
        The Ycash MetaMask Snap keeps your seed inside MetaMask's sandbox.
        This page never sees the seed phrase — you approve each signature in
        the MetaMask window.
      </p>

      {!provider && (
        <div className="card-surface p-4 mb-6 border-ycash/30">
          <div className="flex items-center gap-2 mb-2">
            <span className="pill pill-ycash">required</span>
          </div>
          <p className="text-sm text-text-muted">
            MetaMask not detected. Install the{' '}
            <a
              href="https://docs.metamask.io/snaps/get-started/install-flask/"
              target="_blank"
              rel="noreferrer"
              className="text-ycash underline underline-offset-4 hover:text-ycash-hover"
            >
              MetaMask Flask
            </a>{' '}
            build to use Snaps, then refresh this page.
          </p>
        </div>
      )}

      {provider && !snapsDetected && (
        <div className="card-surface p-4 mb-6 border-ycash/30">
          <div className="flex items-center gap-2 mb-2">
            <span className="pill pill-ycash">upgrade</span>
          </div>
          <p className="text-sm text-text-muted">
            Your MetaMask build doesn't support Snaps yet. Install{' '}
            <a
              href="https://docs.metamask.io/snaps/get-started/install-flask/"
              target="_blank"
              rel="noreferrer"
              className="text-ycash underline underline-offset-4 hover:text-ycash-hover"
            >
              MetaMask Flask
            </a>
            .
          </p>
        </div>
      )}

      {installedSnap && (
        <div className="card-surface p-4 mb-6 border-accent/30">
          <div className="flex items-center gap-2 mb-2">
            <span className="pill pill-accent">installed</span>
          </div>
          <p className="text-sm text-text-muted">
            The Ycash Snap is ready. Click Connect to finish onboarding.
          </p>
        </div>
      )}

      <div className="card-surface p-5 mb-6">
        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={recoverOlder}
            onChange={(e) => setRecoverOlder(e.target.checked)}
            className="mt-1 accent-accent"
          />
          <span className="flex-1">
            <span className="text-sm font-medium text-text">
              Recover an older wallet?
            </span>
            <span className="block text-text-muted text-xs mt-1 leading-relaxed">
              By default the snap syncs from the current chain tip. Enable
              this if you've connected this seed before and want to see
              earlier transactions.
            </span>
          </span>
        </label>
        {recoverOlder && (
          <div className="mt-4 pt-4 border-t border-border flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
              Birthday block · min {YCASH_FORK_HEIGHT}
            </label>
            <input
              type="number"
              value={birthdayInput}
              onChange={(e) => setBirthdayInput(e.target.value)}
              placeholder="e.g. 2859770"
              min={YCASH_FORK_HEIGHT}
              className="bg-surface border border-border rounded-md px-3 py-2 text-text placeholder:text-text-dim font-mono text-sm focus:border-accent focus:outline-none"
            />
          </div>
        )}
      </div>

      {error && (
        <div className="text-danger text-sm font-mono mb-4">{error}</div>
      )}

      <div className="flex gap-3">
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
        <Button
          label="Back"
          variant="ghost"
          onClick={() => navigate('/', { replace: true })}
          disabled={busy}
        />
      </div>

      <div className="mt-12 pt-6 border-t border-border font-mono text-[11px] uppercase tracking-[0.15em] text-text-dim leading-loose">
        Sending shielded YEC triggers two MetaMask prompts:
        one to generate the privacy proof, then one to sign the transaction.
      </div>
    </div>
  );
};

export default ConnectSnap;
