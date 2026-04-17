import { useMemo } from 'react';
import { useSession } from '../../context/SessionContext';
import { BrowserSigningBackend } from './BrowserSigningBackend';
import { SigningBackend } from './SigningBackend';

/**
 * Returns the active signing backend, or `null` when the wallet is locked.
 *
 * Phase E2 only ships the browser-resident backend — a Snap-based backend
 * will slot in here during Phase E3 once the Ycash-aware snap is rebuilt.
 * Consumers should guard on `null` rather than assuming the backend is
 * available; a locked wallet can still sync and display balances but can't
 * sign transactions.
 */
export function useSigningBackend(): SigningBackend | null {
  const { status, mnemonic } = useSession();

  return useMemo(() => {
    if (status !== 'unlocked' || !mnemonic) return null;
    return new BrowserSigningBackend(mnemonic, 0);
  }, [status, mnemonic]);
}
