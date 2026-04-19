import React, { useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { useWebZjsContext } from '../context/WebzjsContext';
import { useSession } from '../context/SessionContext';
import { useWebZjsActions } from '../hooks';
import Loader from '../components/Loader/Loader';

/**
 * Dashboard is the authenticated shell. It assumes the ProtectedRoute gate
 * has already confirmed the session is unlocked. Bootstrap runs in two
 * stages because `setupAccount` depends on `state.webWallet`, which is only
 * populated after `initWallet` dispatches. Running them back-to-back in one
 * effect captures a stale closure (webWallet=null) and silently no-ops the
 * account creation. Splitting into two effects — one driven by session
 * status, one by webWallet availability — is the idiomatic fix.
 */
const Dashboard: React.FC = () => {
  const { state, dispatch, initWallet } = useWebZjsContext();
  const { status: sessionStatus } = useSession();
  const { setupAccount, fullResync } = useWebZjsActions();
  const initStartedRef = useRef(false);
  const setupStartedRef = useRef(false);
  const rescanStartedRef = useRef(false);

  useEffect(() => {
    if (sessionStatus !== 'unlocked') return;
    if (initStartedRef.current) return;
    initStartedRef.current = true;
    (async () => {
      try {
        await initWallet();
      } catch (err) {
        console.error('Dashboard initWallet failed:', err);
        initStartedRef.current = false;
      }
    })();
  }, [sessionStatus, initWallet]);

  useEffect(() => {
    if (sessionStatus !== 'unlocked') return;
    if (!state.webWallet) return;
    if (state.activeAccount != null) return;
    // Skip the normal path if the persisted DB failed to decode — the
    // rescan effect below owns account creation in that case.
    if (state.needsRescan) return;
    if (setupStartedRef.current) return;
    setupStartedRef.current = true;
    (async () => {
      try {
        await setupAccount();
      } catch (err) {
        console.error('Dashboard setupAccount failed:', err);
        setupStartedRef.current = false;
      }
    })();
  }, [
    sessionStatus,
    state.webWallet,
    state.activeAccount,
    state.needsRescan,
    setupAccount,
  ]);

  // Recovery path: wasm format changed under us, so the persisted DB is
  // unreadable. Rebuild the wallet from the stored seed/UFVK + birthday.
  useEffect(() => {
    if (!state.needsRescan) return;
    if (sessionStatus !== 'unlocked') return;
    if (!state.webWallet) return;
    if (rescanStartedRef.current) return;
    rescanStartedRef.current = true;
    (async () => {
      try {
        await fullResync();
        dispatch({ type: 'set-needs-rescan', payload: false });
      } catch (err) {
        console.error('Dashboard recovery resync failed:', err);
        rescanStartedRef.current = false;
      }
    })();
  }, [state.needsRescan, sessionStatus, state.webWallet, fullResync, dispatch]);

  const ready = state.initialized && state.activeAccount != null;
  const bootstrapLabel = state.needsRescan
    ? 'Rebuilding wallet from birthday'
    : 'Bootstrapping wallet';

  return (
    <div className="w-full">
      {ready ? (
        <Outlet />
      ) : (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <Loader />
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-text-dim">
            {bootstrapLabel}
          </span>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
