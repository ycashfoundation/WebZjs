import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  clearEncryptedSeed,
  decryptSeed,
  encryptSeed,
  loadEncryptedSeed,
  saveEncryptedSeed,
} from '../utils/seedVault';

export type SessionStatus = 'unknown' | 'no-vault' | 'locked' | 'unlocked';

interface SessionContextShape {
  status: SessionStatus;
  /** Present only while status === 'unlocked'. */
  mnemonic: string | null;
  /**
   * Persist a new seed to the passphrase-encrypted vault and unlock the
   * session in one shot. Used by the Create-wallet and Import-wallet flows.
   */
  createWallet: (mnemonic: string, passphrase: string) => Promise<void>;
  /**
   * Decrypt the stored vault with `passphrase` and move the session into the
   * unlocked state. Throws on wrong passphrase (AES-GCM auth failure).
   */
  unlock: (passphrase: string) => Promise<void>;
  /**
   * Drop the in-memory mnemonic. The encrypted vault stays on disk.
   */
  lock: () => void;
  /**
   * Erase the vault from IndexedDB and return the session to `no-vault`.
   * Destructive — used by "forgot passphrase" / factory-reset flows.
   */
  wipeVault: () => Promise<void>;
}

const SessionContext = createContext<SessionContextShape | undefined>(
  undefined,
);

export function SessionProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [status, setStatus] = useState<SessionStatus>('unknown');
  const [mnemonic, setMnemonic] = useState<string | null>(null);

  // On first mount, probe IndexedDB to see whether a vault already exists.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = await loadEncryptedSeed();
      if (cancelled) return;
      setStatus(existing ? 'locked' : 'no-vault');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const createWallet = useCallback(
    async (newMnemonic: string, passphrase: string) => {
      const enc = await encryptSeed(newMnemonic, passphrase);
      await saveEncryptedSeed(enc);
      setMnemonic(newMnemonic);
      setStatus('unlocked');
    },
    [],
  );

  const unlock = useCallback(async (passphrase: string) => {
    const existing = await loadEncryptedSeed();
    if (!existing) {
      // Vault disappeared between status probe and unlock attempt — fall back
      // to the onboarding path rather than throwing an opaque error.
      setStatus('no-vault');
      return;
    }
    const phrase = await decryptSeed(existing, passphrase);
    setMnemonic(phrase);
    setStatus('unlocked');
  }, []);

  const lock = useCallback(() => {
    setMnemonic(null);
    setStatus('locked');
  }, []);

  const wipeVault = useCallback(async () => {
    await clearEncryptedSeed();
    setMnemonic(null);
    setStatus('no-vault');
  }, []);

  const value = useMemo<SessionContextShape>(
    () => ({ status, mnemonic, createWallet, unlock, lock, wipeVault }),
    [status, mnemonic, createWallet, unlock, lock, wipeVault],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextShape {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return ctx;
}
