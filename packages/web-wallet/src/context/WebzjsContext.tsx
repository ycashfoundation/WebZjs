import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { get, del } from 'idb-keyval';

import initWebzJSWallet, {
  initThreadPool,
  WalletSummary,
  WebWallet,
} from '@chainsafe/webzjs-wallet';
import initWebzJSKeys from '@chainsafe/webzjs-keys';
import { MAINNET_LIGHTWALLETD_PROXY } from '../config/constants';
import { ensureSaplingParams } from '../lib/saplingParams';
import { Snap } from '../types';
import toast, { Toaster } from 'react-hot-toast';

export interface WebZjsState {
  webWallet: WebWallet | null;
  installedSnap: Snap | null;
  error: Error | null | string;
  summary?: WalletSummary;
  chainHeight?: bigint;
  activeAccount?: number | null;
  syncInProgress: boolean;
  loading: boolean;
  initialized: boolean;
  /**
   * Set when the persisted wallet DB failed to deserialize (e.g. after a wasm
   * upgrade that changed the internal postcard layout). Signals Dashboard to
   * skip normal `setupAccount` bootstrap and drive a `fullResync` instead,
   * which rebuilds the wallet from the stored seed/UFVK + birthday.
   */
  needsRescan: boolean;
}

type Action =
  | { type: 'set-web-wallet'; payload: WebWallet }
  | { type: 'set-error'; payload: Error | null | string }
  | { type: 'set-summary'; payload: WalletSummary }
  | { type: 'set-chain-height'; payload: bigint }
  | { type: 'set-active-account'; payload: number }
  | { type: 'set-sync-in-progress'; payload: boolean }
  | { type: 'set-loading'; payload: boolean }
  | { type: 'set-initialized'; payload: boolean }
  | { type: 'set-needs-rescan'; payload: boolean };

const initialState: WebZjsState = {
  webWallet: null,
  installedSnap: null,
  error: null,
  summary: undefined,
  chainHeight: undefined,
  activeAccount: null,
  syncInProgress: false,
  loading: false,
  initialized: false,
  needsRescan: false,
};

function reducer(state: WebZjsState, action: Action): WebZjsState {
  switch (action.type) {
    case 'set-web-wallet':
      return { ...state, webWallet: action.payload };
    case 'set-error':
      return { ...state, error: action.payload };
    case 'set-summary':
      return { ...state, summary: action.payload };
    case 'set-chain-height':
      return { ...state, chainHeight: action.payload };
    case 'set-active-account':
      return { ...state, activeAccount: action.payload };
    case 'set-sync-in-progress':
      return { ...state, syncInProgress: action.payload };
    case 'set-loading':
      return { ...state, loading: action.payload };
    case 'set-initialized':
      return { ...state, initialized: action.payload };
    case 'set-needs-rescan':
      return { ...state, needsRescan: action.payload };
    default:
      return state;
  }
}

interface WebZjsContextType {
  state: WebZjsState;
  dispatch: React.Dispatch<Action>;
  initWallet: () => Promise<void>;
}

const WebZjsContext = createContext<WebZjsContextType>({
  state: initialState,
  dispatch: () => {},
  initWallet: async () => {},
});

export function useWebZjsContext(): WebZjsContextType {
  return useContext(WebZjsContext);
}

export const WebZjsProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const initializingRef = useRef(false);

  const initAll = useCallback(async () => {
    try {
      await initWebzJSWallet();
      await initWebzJSKeys();

      try {
        const concurrency = navigator.hardwareConcurrency || 4;
        await initThreadPool(concurrency);
      } catch (err) {
        console.error('Unable to initialize Thread Pool:', err);
        dispatch({
          type: 'set-error',
          payload: new Error('Unable to initialize Thread Pool'),
        });
        return;
      }

      // Sapling proving params are no longer bundled into the wasm binary
      // (saves ~51 MB per page load). Kick off the fetch now so the wallet
      // is spend-ready by the time the user clicks Send. Don't await — the
      // rest of wallet bootstrap (reading summary, chain height, etc.) does
      // not require the prover, and a slow network here should not delay
      // the Dashboard from rendering.
      ensureSaplingParams().catch((err) => {
        console.warn(
          'Sapling proving params failed to load — spends will be blocked until this resolves:',
          err,
        );
        dispatch({
          type: 'set-error',
          payload: new Error(
            `Could not load signing keys: ${err instanceof Error ? err.message : String(err)}`,
          ),
        });
      });

      const bytes = await get('wallet');
      let wallet: WebWallet;

      if (bytes) {
        console.info('Saved wallet detected. Restoring wallet from storage');
        try {
          wallet = new WebWallet('main', MAINNET_LIGHTWALLETD_PROXY, 1, 1, bytes);
        } catch (deserializeError) {
          console.warn(
            'Failed to restore wallet from storage (wasm format change). Dropping stale bytes and flagging for rescan from birthday.',
            deserializeError,
          );
          // Drop the undecodable bytes so a refresh mid-recovery doesn't
          // re-enter this branch. The seed vault + stored birthday (held in
          // SessionContext / IDB) are sufficient to reconstruct the wallet
          // via fullResync — no user-visible data loss beyond sync time.
          await del('wallet');
          toast(
            'Wallet storage format changed — resyncing from your birthday block. Your funds are safe.',
            { duration: 6000 },
          );
          dispatch({ type: 'set-needs-rescan', payload: true });
          wallet = new WebWallet('main', MAINNET_LIGHTWALLETD_PROXY, 1, 1, null);
        }
      } else {
        console.info('No saved wallet detected. Creating new wallet');
        wallet = new WebWallet('main', MAINNET_LIGHTWALLETD_PROXY, 1, 1, null);
      }

      dispatch({ type: 'set-web-wallet', payload: wallet });

      // Retrieve summary (accounts, balances, etc.)
      const summary = await wallet.get_wallet_summary();
      if (summary) {
        dispatch({ type: 'set-summary', payload: summary });
        if (summary.account_balances.length > 0) {
          dispatch({
            type: 'set-active-account',
            payload: summary.account_balances[0][0],
          });
        }
      }

      try {
        const chainHeight = await wallet.get_latest_block();
        if (chainHeight) {
          dispatch({ type: 'set-chain-height', payload: chainHeight });
        }
      } catch (err) {
        console.warn('Could not fetch chain height on startup (will retry on first sync):', err);
      }

      dispatch({ type: 'set-loading', payload: false });
      dispatch({ type: 'set-initialized', payload: true });
    } catch (err) {
      console.error('Initialization error:', err);
      dispatch({ type: 'set-error', payload: Error(String(err)) });
      dispatch({ type: 'set-loading', payload: false });
    }
  }, []);

  // Lazy-load WASM: call this when user wants to use wallet features
  const initWallet = useCallback(async () => {
    if (state.initialized || initializingRef.current) {
      return; // Already initialized or in progress
    }
    initializingRef.current = true;
    dispatch({ type: 'set-loading', payload: true });
    try {
      await initAll();
    } finally {
      initializingRef.current = false;
    }
  }, [state.initialized, initAll]);

  useEffect(() => {
    if (state.error) {
      toast.error(state.error.toString());
    }
  }, [state.error, dispatch]);


  return (
    <WebZjsContext.Provider value={{ state, dispatch, initWallet }}>
      <Toaster />
      {children}
    </WebZjsContext.Provider>
  );
};
