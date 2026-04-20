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
  const { state, initWallet } = useWebZjsContext();
  const { status: sessionStatus } = useSession();
  const { setupAccount } = useWebZjsActions();
  const initStartedRef = useRef(false);
  const setupStartedRef = useRef(false);

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
  }, [sessionStatus, state.webWallet, state.activeAccount, setupAccount]);

  const ready = state.initialized && state.activeAccount != null;
  const bootstrapLabel = 'Bootstrapping wallet';

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
