import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { get, set, del } from 'idb-keyval';
import toast from 'react-hot-toast';
import {
  clearEncryptedSeed,
  decryptSeed,
  encryptSeed,
  loadEncryptedSeed,
  saveEncryptedSeed,
} from '../utils/seedVault';
import { clearAddressBook } from '../utils/addressBook';

export type SessionStatus = 'unknown' | 'no-vault' | 'locked' | 'unlocked';
export type BackendChoice = 'browser' | 'snap';

const BACKEND_KEY = 'yw:backend';

/**
 * Idle timeout before the browser backend auto-wipes the in-memory seed and
 * forces re-unlock. Snap-backed wallets are immune — MetaMask manages its
 * own unlock state — so this only applies when `backend === 'browser'` and
 * the session is currently `unlocked`.
 *
 * 10 minutes is a middle ground: MetaMask defaults to 5 min (aggressive),
 * 1Password/Ledger Live default to 10 min, and Coinbase Wallet does 30 min.
 * We round to 10 because shielded sends are slow (prove + sign + broadcast
 * can run 30+ seconds on a cold page) and it's annoying to come back to a
 * lock screen in the middle of drafting a memo.
 */
const AUTO_LOCK_IDLE_MS = 10 * 60 * 1000;

/**
 * DOM events that count as "user is still here." Pointer + keyboard + scroll
 * covers every meaningful interaction; `visibilitychange` is handled
 * separately below (tab focus doesn't reset idle — you could leave a window
 * visible and walk away).
 */
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'mousedown',
  'mousemove',
  'keydown',
  'touchstart',
  'scroll',
  'wheel',
];

interface SessionContextShape {
  status: SessionStatus;
  /**
   * Which signing backend the user has committed to. `null` until they pick
   * one at onboarding. Persisted to IndexedDB so the choice survives reloads.
   */
  backend: BackendChoice | null;
  /** BIP39 mnemonic — only present for the browser backend while unlocked. */
  mnemonic: string | null;
  /**
   * Create a passphrase-encrypted vault, commit the backend as `'browser'`,
   * and move the session into the unlocked state.
   */
  createWallet: (mnemonic: string, passphrase: string) => Promise<void>;
  /** Decrypt the vault with `passphrase` (browser backend only). */
  unlock: (passphrase: string) => Promise<void>;
  /**
   * Commit the backend as `'snap'`. Doesn't touch MetaMask itself — callers
   * should have already installed the snap via `useRequestSnap`. This only
   * persists the choice and moves the session to `unlocked`, at which point
   * the Dashboard bootstrap will pull the UFVK from the snap.
   *
   * If `birthdayHeight` is provided, it is persisted as the account's sync
   * start block so Dashboard's `setupAccount` picks it up instead of the
   * chain tip default. Used for recovering older wallet state after a wipe.
   */
  chooseSnapBackend: (birthdayHeight?: number) => Promise<void>;
  /** Drop any in-memory mnemonic. For snap backend, effectively a no-op. */
  lock: () => void;
  /**
   * Full factory reset: erase vault, clear backend choice, return to the
   * initial "no-vault" state. Doesn't uninstall the snap — MetaMask manages
   * its own lifecycle.
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
  const [backend, setBackend] = useState<BackendChoice | null>(null);
  const [mnemonic, setMnemonic] = useState<string | null>(null);

  // On first mount, probe IndexedDB for (a) a persisted backend choice and
  // (b) an encrypted vault, then decide the starting session state.
  //
  //   backend=snap                       → unlocked (no passphrase needed)
  //   backend=browser, vault present     → locked
  //   backend=browser, no vault          → no-vault (partial state, treat as fresh)
  //   backend=null, vault present        → locked (legacy pre-E3 vault)
  //   backend=null, no vault             → no-vault
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [storedBackend, existingSeed] = await Promise.all([
        get(BACKEND_KEY) as Promise<BackendChoice | undefined>,
        loadEncryptedSeed(),
      ]);
      if (cancelled) return;
      if (storedBackend === 'snap') {
        setBackend('snap');
        setStatus('unlocked');
        return;
      }
      // Treat any other case as the browser path — either the user picked
      // browser explicitly, or they are an existing E2 user whose vault
      // predates the backend choice (default them to 'browser').
      setBackend(storedBackend === 'browser' ? 'browser' : null);
      setStatus(existingSeed ? 'locked' : 'no-vault');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const createWallet = useCallback(
    async (newMnemonic: string, passphrase: string) => {
      const enc = await encryptSeed(newMnemonic, passphrase);
      await saveEncryptedSeed(enc);
      await set(BACKEND_KEY, 'browser');
      setBackend('browser');
      setMnemonic(newMnemonic);
      setStatus('unlocked');
    },
    [],
  );

  const unlock = useCallback(async (passphrase: string) => {
    const existing = await loadEncryptedSeed();
    if (!existing) {
      setStatus('no-vault');
      return;
    }
    const phrase = await decryptSeed(existing, passphrase);
    // Backfill the backend choice for pre-E3 vaults that predate the field.
    await set(BACKEND_KEY, 'browser');
    setBackend('browser');
    setMnemonic(phrase);
    setStatus('unlocked');
  }, []);

  const chooseSnapBackend = useCallback(async (birthdayHeight?: number) => {
    await set(BACKEND_KEY, 'snap');
    if (birthdayHeight !== undefined) {
      await set('birthdayBlock', String(birthdayHeight));
    }
    setBackend('snap');
    setMnemonic(null);
    setStatus('unlocked');
  }, []);

  const lock = useCallback(() => {
    setMnemonic(null);
    // For snap backend there's nothing to re-authenticate (MetaMask handles
    // that on its side), so Lock is effectively a soft-reset that sends
    // them back to the passphrase prompt only for browser backend.
    setStatus(backend === 'snap' ? 'unlocked' : 'locked');
  }, [backend]);

  // Browser-backend auto-lock. Arm only when (a) we hold an in-memory
  // mnemonic and (b) the user hasn't interacted within the idle window.
  // Snap-backed sessions skip this entirely; locking a snap session would
  // just re-send the user through a no-op unlock with no security benefit.
  const lockRef = useRef(lock);
  lockRef.current = lock;
  useEffect(() => {
    if (status !== 'unlocked' || backend !== 'browser') return;

    let timerId: ReturnType<typeof setTimeout> | null = null;

    const triggerAutoLock = () => {
      lockRef.current();
      toast.success('Wallet locked after 10 minutes of inactivity', {
        id: 'auto-lock',
        duration: 6000,
      });
    };

    const armTimer = () => {
      if (timerId != null) clearTimeout(timerId);
      timerId = setTimeout(triggerAutoLock, AUTO_LOCK_IDLE_MS);
    };

    // Passive listeners so scroll handling stays smooth under load. We're
    // only interested in "did something happen," not the event details.
    const resetIdle = () => armTimer();
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, resetIdle, { passive: true });
    }

    armTimer();

    return () => {
      if (timerId != null) clearTimeout(timerId);
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, resetIdle);
      }
    };
  }, [status, backend]);

  const wipeVault = useCallback(async () => {
    // Full factory reset: besides the encrypted seed and backend choice,
    // clear the persisted wallet DB + stored birthday so the next
    // onboarding flow performs a fresh import rather than restoring the
    // old account. Without this, reconnecting a snap (or importing a
    // different seed via the browser backend) would silently restore the
    // previous account from IndexedDB.
    await Promise.all([
      clearEncryptedSeed(),
      del(BACKEND_KEY),
      del('wallet'),
      del('birthdayBlock'),
      clearAddressBook(),
    ]);
    // AddressBookProvider lives above this context in the tree and caches
    // its entries in memory; fire an event so it drops its state too
    // (otherwise labels survive a factory reset until the next reload).
    window.dispatchEvent(new CustomEvent('yw:addressbook-cleared'));
    setBackend(null);
    setMnemonic(null);
    setStatus('no-vault');
  }, []);

  const value = useMemo<SessionContextShape>(
    () => ({
      status,
      backend,
      mnemonic,
      createWallet,
      unlock,
      chooseSnapBackend,
      lock,
      wipeVault,
    }),
    [
      status,
      backend,
      mnemonic,
      createWallet,
      unlock,
      chooseSnapBackend,
      lock,
      wipeVault,
    ],
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
