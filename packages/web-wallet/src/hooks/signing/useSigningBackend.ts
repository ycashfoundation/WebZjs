import { useMemo } from 'react';
import { useSession } from '../../context/SessionContext';
import { BrowserSigningBackend } from './BrowserSigningBackend';
import { SigningBackend } from './SigningBackend';
import { SnapSigningBackend } from './SnapSigningBackend';
import { useInvokeSnap } from '../snaps/useInvokeSnap';

/**
 * Returns the active signing backend, or `null` when the wallet is locked or
 * the snap is unavailable.
 *
 * - `backend === 'browser'` → browser-resident backend (uses in-memory mnemonic).
 * - `backend === 'snap'` → Ycash MetaMask snap backend (packages/snap-ycash).
 *
 * Consumers should guard on `null` rather than assume a backend is present;
 * a locked wallet can still sync and display balances but can't sign
 * transactions.
 */
export function useSigningBackend(): SigningBackend | null {
  const { status, backend, mnemonic } = useSession();
  const invokeSnap = useInvokeSnap();

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
    return null;
  }, [status, backend, mnemonic, invokeSnap]);
}
