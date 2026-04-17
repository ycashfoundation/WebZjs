import React, { useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import NavBar from '../components/NavBar/NavBar';
import { useWebZjsContext } from '../context/WebzjsContext';
import { useSession } from '../context/SessionContext';
import { useWebZjsActions } from '../hooks';
import Loader from '../components/Loader/Loader';

/**
 * Dashboard is the authenticated shell. It assumes the ProtectedRoute gate
 * has already confirmed the session is unlocked. On first mount it lazily
 * initializes the wasm runtime and bootstraps the active account from the
 * unlocked mnemonic — either promoting an existing IndexedDB-restored
 * account to active, or creating a fresh one at the current tip.
 */
const Dashboard: React.FC = () => {
  const { state, initWallet } = useWebZjsContext();
  const { status: sessionStatus } = useSession();
  const { setupAccount } = useWebZjsActions();
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    if (sessionStatus !== 'unlocked') return;
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    (async () => {
      try {
        await initWallet();
        await setupAccount();
      } catch (err) {
        console.error('Dashboard bootstrap failed:', err);
        // Allow retry next mount if init fails
        bootstrappedRef.current = false;
      }
    })();
  }, [sessionStatus, initWallet, setupAccount]);

  const ready = state.initialized && state.activeAccount != null;

  return (
    <div className="w-full">
      <NavBar />
      <div className="flex flex-col align-middle w-full mx-auto max-w-[1000px]">
        {ready ? (
          <Outlet />
        ) : (
          <div className="flex items-center justify-center py-32">
            <Loader />
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
