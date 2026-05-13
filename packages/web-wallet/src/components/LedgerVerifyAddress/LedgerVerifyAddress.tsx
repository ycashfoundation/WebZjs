import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, set } from 'idb-keyval';
import toast from 'react-hot-toast';
import { useSession } from '../../context/SessionContext';
import { useWebZjsContext } from '../../context/WebzjsContext';
import Button from '../Button/Button';
import Loader from '../Loader/Loader';

const LEDGER_ADDR_VERIFIED_KEY = 'yw:ledger-addr-verified';

/**
 * One-time gate that fires when a Ledger-backed wallet finishes its first
 * account import. The Sapling address `ys1…` can only be computed by the
 * wasm wallet after import (the device keys themselves don't encode a
 * payment address — it's an FF1-AES diversifier search away), so the
 * verification has to happen post-bootstrap rather than during the
 * onboarding screen.
 *
 * The user is instructed to press **Get Address** on the device and
 * compare the on-device readout to what the wallet derived. A match
 * proves the device's GET_FVK response and the wallet's account
 * registration agree on the same key tree; a mismatch means either the
 * device firmware doesn't match the supported build, or the wasm
 * synthesis logic in `LedgerSigningBackend.importAccount` drifted —
 * either way, the safe response is to wipe and restart.
 *
 * Skipped if `backend !== 'ledger'`, if the flag is already set, or if
 * the wallet handle / active account isn't ready yet.
 */
export const LedgerVerifyAddress: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const navigate = useNavigate();
  const { backend, wipeVault } = useSession();
  const { state } = useWebZjsContext();
  // Synchronously short-circuit non-ledger sessions so the dashboard
  // doesn't flash a Loader for everyone — only Ledger-backed sessions
  // need to await the IDB flag.
  const [needsVerify, setNeedsVerify] = useState<boolean | null>(() =>
    backend === 'ledger' ? null : false,
  );
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Probe the IDB flag once we know the backend is ledger. Other
  // backends short-circuit out and never even check.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (backend !== 'ledger') {
        if (!cancelled) setNeedsVerify(false);
        return;
      }
      const flag = await get(LEDGER_ADDR_VERIFIED_KEY);
      if (cancelled) return;
      setNeedsVerify(flag !== true);
    })();
    return () => {
      cancelled = true;
    };
  }, [backend]);

  // Pull the imported Sapling address once the wallet + active account
  // are wired up. We deliberately read from the wallet rather than
  // synthesizing the address from the cached viewing material so that
  // a divergence between the two would surface as a visible mismatch.
  useEffect(() => {
    let cancelled = false;
    if (needsVerify !== true) return;
    if (!state.webWallet) return;
    if (state.activeAccount == null) return;
    (async () => {
      try {
        const addr = await state.webWallet!.get_current_address_sapling(
          state.activeAccount!,
        );
        if (!cancelled) setAddress(addr);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : 'Could not read the Sapling address from the wallet.',
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsVerify, state.webWallet, state.activeAccount]);

  if (needsVerify === null) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader />
      </div>
    );
  }

  if (needsVerify === false) {
    return <>{children}</>;
  }

  const handleMatch = async () => {
    setSubmitting(true);
    try {
      await set(LEDGER_ADDR_VERIFIED_KEY, true);
      setNeedsVerify(false);
      toast.success('Ledger address verified', { id: 'ledger-verified' });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not persist the verification flag.',
      );
      setSubmitting(false);
    }
  };

  const handleMismatch = async () => {
    if (
      !window.confirm(
        'This will wipe the Ledger backend choice and any local wallet state, then return to the start. Proceed?',
      )
    ) {
      return;
    }
    setSubmitting(true);
    try {
      await wipeVault();
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not wipe wallet state.',
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto px-6 py-12">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-text-dim mb-3">
        Verify with device
      </div>
      <h1 className="text-3xl font-semibold tracking-tight mb-3">
        Confirm the Sapling address
      </h1>
      <p className="text-text-muted mb-6 leading-relaxed">
        Before this Ledger-backed wallet is usable, verify that the
        address the wallet derived matches the one your Ledger shows.
        This catches firmware mismatches and host-side derivation bugs
        before any funds are at risk.
      </p>

      <ol className="list-decimal pl-5 text-sm text-text-muted leading-relaxed space-y-1.5 mb-6">
        <li>On the device home screen, open <strong>Ycash</strong>.</li>
        <li>
          Press <strong>Get Address</strong>. The first screen shows the
          Sapling address (<code>ys1…</code>); scroll right for the
          transparent address.
        </li>
        <li>Compare the Sapling address byte-for-byte with the one below.</li>
      </ol>

      <div className="card-surface p-5 mb-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim mb-2">
          Wallet-derived sapling address
        </div>
        {address ? (
          <div className="font-mono text-sm text-text break-all leading-relaxed">
            {address}
          </div>
        ) : (
          <div className="flex items-center gap-3 text-text-muted text-sm">
            <Loader />
            <span>Importing Ledger account…</span>
          </div>
        )}
      </div>

      {error && (
        <div className="text-danger text-sm font-mono mb-4">{error}</div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          label={submitting ? 'Saving…' : 'It matches'}
          onClick={handleMatch}
          disabled={submitting || !address}
        />
        <Button
          label="Doesn't match — wipe"
          variant="ghost"
          onClick={handleMismatch}
          disabled={submitting}
        />
      </div>
    </div>
  );
};

export default LedgerVerifyAddress;
