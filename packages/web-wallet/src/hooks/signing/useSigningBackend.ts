import { useMemo } from 'react';
import { useSession } from '../../context/SessionContext';
import { BrowserSigningBackend } from './BrowserSigningBackend';
import { SigningBackend } from './SigningBackend';
import { SnapSigningBackend } from './SnapSigningBackend';
import { LedgerSigningBackend } from './LedgerSigningBackend';
import { useInvokeSnap } from '../snaps/useInvokeSnap';
import { useLedgerTransport } from '../ledger/useLedgerTransport';

/**
 * Returns the active signing backend, or `null` when the wallet is locked or
 * the chosen backend is unavailable.
 *
 * - `backend === 'browser'` → browser-resident backend (uses in-memory mnemonic).
 * - `backend === 'snap'` → Ycash MetaMask snap backend (packages/snap-ycash).
 * - `backend === 'ledger'` → Ledger Nano S+ via WebHID. Signing prompts the
 *   user to reconnect the device on demand; cached viewing material lets
 *   the wallet operate (sync + view balances) without the device plugged
 *   in.
 *
 * Consumers should guard on `null` rather than assume a backend is present;
 * a locked wallet can still sync and display balances but can't sign
 * transactions.
 */
export function useSigningBackend(): SigningBackend | null {
  const { status, backend, mnemonic, ledgerViewing } = useSession();
  const invokeSnap = useInvokeSnap();
  const ledger = useLedgerTransport();

  return useMemo(() => {
    if (status !== 'unlocked') return null;
    if (backend === 'snap') {
      return new SnapSigningBackend(async (method, params) => {
        const result = await invokeSnap({ method, params });
        return result as never;
      });
    }
    if (backend === 'browser' && mnemonic) {
      return new BrowserSigningBackend(mnemonic, 0);
    }
    if (backend === 'ledger' && ledgerViewing) {
      // `ledger.apduCallback` is a stable, re-render-safe handle that
      // resolves the live transport at call time; the wasm side may
      // invoke it many times across one signing pipeline. The
      // `connect` arg auto-prompts WebHID inside `sendShielded` so
      // the user doesn't have to manually re-pair before each send.
      return new LedgerSigningBackend(
        ledgerViewing,
        ledger.apduCallback,
        ledger.connect,
      );
    }
    return null;
  }, [
    status,
    backend,
    mnemonic,
    invokeSnap,
    ledgerViewing,
    ledger.apduCallback,
    ledger.connect,
  ]);
}
