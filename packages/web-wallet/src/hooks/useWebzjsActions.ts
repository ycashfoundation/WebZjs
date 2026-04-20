import { set, get } from 'idb-keyval';
import { useCallback, useRef } from 'react';
import { useWebZjsContext } from '../context/WebzjsContext';
import { useSession } from '../context/SessionContext';
import { useSigningBackend } from './signing/useSigningBackend';

/**
 * Actions on the loaded WebWallet. Everything here assumes the wallet has
 * already been initialized by `WebzjsContext.initWallet` — callers should
 * guard on `state.webWallet` before invoking.
 *
 * Any flow that needs the spending key (account setup, full resync) also
 * requires the session to be unlocked; those methods throw or no-op if the
 * mnemonic is not in memory.
 */
interface WebzjsActions {
  getAccountData: () => Promise<
    { saplingAddress: string; transparentAddress: string } | undefined
  >;
  /**
   * Ensure the wallet has an active account. If a prior account was restored
   * from the persisted OPFS DB, simply marks it active. Otherwise creates a
   * fresh account from the unlocked mnemonic at the given birthday (or the
   * current tip).
   */
  setupAccount: (birthdayHeight?: number) => Promise<void>;
  triggerRescan: () => Promise<void>;
  syncStateWithWallet: () => Promise<void>;
  /**
   * Wipes the current OPFS wallet DB and rebuilds it from scratch starting
   * at `customBirthday` (or the stored birthday). Runs in place on the
   * existing `WebWallet` instance via `wallet.reset()` — the same handle is
   * preserved so consumers don't need to rebind.
   */
  fullResync: (customBirthday?: number) => Promise<void>;
}

// Module-level flag: prevents the interval-driven rescan from racing with a
// full resync, even across re-renders.
let _fullResyncActive = false;

async function withRetry<T>(
  fn: () => Promise<T>,
  { retries = 3, baseDelay = 2000, label = 'operation' } = {},
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.warn(
        `${label} failed (attempt ${attempt}/${retries}), retrying in ${delay}ms:`,
        err,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}

export function useWebZjsActions(): WebzjsActions {
  const { state, dispatch } = useWebZjsContext();
  const { status: sessionStatus } = useSession();
  const signingBackend = useSigningBackend();

  const fullySyncedRef = useRef(state.summary?.fully_scanned_height);
  const chainHeightRef = useRef(state.chainHeight);
  fullySyncedRef.current = state.summary?.fully_scanned_height;
  chainHeightRef.current = state.chainHeight;

  const getAccountData = useCallback(async () => {
    try {
      if (state.activeAccount == null || !state.webWallet) return;
      const accountIndex = state.activeAccount;
      // Ycash never activated NU5, so Unified Addresses cannot be encoded on
      // this network — fetch the Sapling-only shielded address instead.
      // Transparent is optional (the snap backend derives a Sapling-only
      // UFVK), so surface the absence as an empty string instead of
      // collapsing the whole fetch on rejection.
      const saplingAddress =
        await state.webWallet.get_current_address_sapling(accountIndex);
      let transparentAddress = '';
      try {
        transparentAddress =
          await state.webWallet.get_current_address_transparent(accountIndex);
      } catch {
        // No transparent component on this account — expected for snap-backed
        // Sapling-only accounts.
      }
      return { saplingAddress, transparentAddress };
    } catch (error) {
      dispatch({
        type: 'set-error',
        payload: 'Cannot get active account data',
      });
      console.error(error);
    }
  }, [dispatch, state.activeAccount, state.webWallet]);

  const syncStateWithWallet = useCallback(async () => {
    if (!state.webWallet) return;
    try {
      const summary = await state.webWallet.get_wallet_summary();
      if (summary) dispatch({ type: 'set-summary', payload: summary });
    } catch (error) {
      console.warn('Failed to sync state (will retry next interval):', error);
    }
  }, [state.webWallet, dispatch]);

  const setupAccount = useCallback(
    async (birthdayHeight?: number) => {
      if (!state.webWallet) return;
      if (sessionStatus !== 'unlocked' || !signingBackend) {
        throw new Error('Wallet must be unlocked to set up an account');
      }

      // Was a prior account restored from the persisted OPFS DB? If so
      // just mark it active — the WebWallet already has the account
      // materialized internally.
      const existingSummary = await state.webWallet.get_wallet_summary();
      if (
        existingSummary &&
        existingSummary.account_balances.length > 0
      ) {
        const existingAccountId = existingSummary.account_balances[0][0];
        dispatch({ type: 'set-active-account', payload: existingAccountId });
        await syncStateWithWallet();
        return;
      }

      // Fresh account: pick the birthday in this priority:
      //   1. explicit arg from the caller
      //   2. pre-seeded `birthdayBlock` in IDB (set by onboarding flows that
      //      want to recover an older wallet — see `chooseSnapBackend`)
      //   3. current chain tip, so a brand-new user doesn't scan all history
      const storedBirthday = (await get('birthdayBlock')) as string | undefined;
      const birthday =
        birthdayHeight ??
        (storedBirthday
          ? Number(storedBirthday)
          : Number(await state.webWallet.get_latest_block()));
      await set('birthdayBlock', String(birthday));
      const accountId = await signingBackend.importAccount(
        state.webWallet,
        'account-0',
        birthday,
      );
      dispatch({ type: 'set-active-account', payload: accountId });
      await syncStateWithWallet();
    },
    [
      state.webWallet,
      sessionStatus,
      signingBackend,
      dispatch,
      syncStateWithWallet,
    ],
  );

  const triggerRescan = useCallback(async () => {
    if (
      !state.webWallet ||
      state.activeAccount == null ||
      state.syncInProgress ||
      _fullResyncActive
    ) {
      return;
    }

    // Skip if we're already at chain tip (2-block slack for network prop).
    const fullySyncedHeight = fullySyncedRef.current;
    const chainHeight = chainHeightRef.current
      ? Number(chainHeightRef.current)
      : 0;
    if (
      fullySyncedHeight &&
      chainHeight &&
      fullySyncedHeight >= chainHeight - 2
    ) {
      try {
        const latestBlock = await state.webWallet.get_latest_block();
        if (latestBlock && latestBlock !== chainHeightRef.current) {
          dispatch({ type: 'set-chain-height', payload: latestBlock });
          if (fullySyncedHeight < Number(latestBlock)) {
            dispatch({ type: 'set-sync-in-progress', payload: true });
            try {
              await withRetry(() => state.webWallet!.sync(), {
                label: 'sync',
                retries: 2,
                baseDelay: 3000,
              });
              await syncStateWithWallet();
            } finally {
              dispatch({ type: 'set-sync-in-progress', payload: false });
            }
          }
        }
      } catch (err) {
        console.error('Error checking chain height:', err);
      }
      return;
    }

    dispatch({ type: 'set-sync-in-progress', payload: true });
    try {
      await withRetry(() => state.webWallet!.sync(), {
        label: 'sync',
        retries: 2,
        baseDelay: 3000,
      });
      await syncStateWithWallet();
    } catch (err) {
      console.warn('Sync failed (will retry next interval):', err);
    } finally {
      dispatch({ type: 'set-sync-in-progress', payload: false });
    }
  }, [
    state.webWallet,
    state.activeAccount,
    state.syncInProgress,
    dispatch,
    syncStateWithWallet,
  ]);

  const fullResync = useCallback(
    async (customBirthday?: number) => {
      if (state.syncInProgress) {
        dispatch({
          type: 'set-error',
          payload: new Error('Sync already in progress'),
        });
        return;
      }
      if (sessionStatus !== 'unlocked' || !signingBackend) {
        dispatch({
          type: 'set-error',
          payload: new Error('Wallet must be unlocked for full resync'),
        });
        return;
      }
      if (!state.webWallet) return;

      _fullResyncActive = true;
      dispatch({ type: 'set-sync-in-progress', payload: true });

      try {
        const storedBirthday = (await get('birthdayBlock')) as
          | string
          | undefined;
        const birthdayBlock =
          customBirthday ??
          (storedBirthday ? Number(storedBirthday) : undefined);

        if (customBirthday) {
          await set('birthdayBlock', String(customBirthday));
        }

        // Wipe every scanned note/block/tx row in the OPFS DB and rerun
        // migrations. The in-browser `WebWallet` handle stays valid — the
        // worker owns the connection and the reset happens inside it.
        console.info('Full resync: wiping wallet DB via reset()');
        await state.webWallet.reset();

        console.info(
          `Full resync: Re-importing account with birthday ${birthdayBlock}`,
        );
        const resolvedBirthday =
          birthdayBlock ?? Number(await state.webWallet.get_latest_block());
        const accountId = await withRetry(
          () =>
            signingBackend.importAccount(
              state.webWallet!,
              'account-0',
              resolvedBirthday,
            ),
          { label: 'importAccount', retries: 3, baseDelay: 2000 },
        );

        // Sync loop — each sync() call makes incremental progress. Keep
        // calling until the wallet reports it's within 2 blocks of the tip.
        const MAX_SYNC_ROUNDS = 20;
        const SYNC_ROUND_DELAY = 2000;
        let consecutiveFailures = 0;
        const MAX_CONSECUTIVE_FAILURES = 4;
        for (let round = 1; round <= MAX_SYNC_ROUNDS; round++) {
          try {
            await state.webWallet.sync();
            consecutiveFailures = 0;
            const summary = await state.webWallet.get_wallet_summary();
            const chainTip = Number(await state.webWallet.get_latest_block());
            const scannedHeight = summary?.fully_scanned_height ?? 0;
            console.info(
              `Full resync: scanned to ${scannedHeight} / ${chainTip} (round ${round})`,
            );
            if (scannedHeight >= chainTip - 2) break;
            if (round < MAX_SYNC_ROUNDS) {
              await new Promise((r) => setTimeout(r, SYNC_ROUND_DELAY));
            }
          } catch (syncErr) {
            consecutiveFailures++;
            console.warn(
              `Full resync: round ${round} failed (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`,
              syncErr,
            );
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) throw syncErr;
            const backoff =
              SYNC_ROUND_DELAY * Math.pow(2, consecutiveFailures - 1);
            await new Promise((r) => setTimeout(r, backoff));
          }
        }

        dispatch({ type: 'set-active-account', payload: accountId });

        const summary = await state.webWallet.get_wallet_summary();
        if (summary) dispatch({ type: 'set-summary', payload: summary });

        const chainHeight = await state.webWallet.get_latest_block();
        if (chainHeight) {
          dispatch({ type: 'set-chain-height', payload: chainHeight });
        }

        console.info('Full resync: Complete');
      } catch (err: unknown) {
        console.error('Full resync failed:', err);
        dispatch({ type: 'set-error', payload: String(err) });
      } finally {
        _fullResyncActive = false;
        dispatch({ type: 'set-sync-in-progress', payload: false });
      }
    },
    [
      state.webWallet,
      state.syncInProgress,
      sessionStatus,
      signingBackend,
      dispatch,
    ],
  );

  return {
    getAccountData,
    setupAccount,
    triggerRescan,
    syncStateWithWallet,
    fullResync,
  };
}
