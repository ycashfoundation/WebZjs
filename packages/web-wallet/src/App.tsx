import { useInterval } from 'usehooks-ts';
import { Outlet } from 'react-router-dom';
import { RESCAN_INTERVAL } from './config/constants';
import { useWebZjsActions } from './hooks';
import Layout from './components/Layout/Layout';
import { useSession } from './context/SessionContext';
import { useWebZjsContext } from './context/WebzjsContext';

function App() {
  const { triggerRescan } = useWebZjsActions();
  const { status: sessionStatus } = useSession();
  const { state } = useWebZjsContext();

  // Only poll for new blocks when the session is unlocked AND the wallet has
  // been initialized — a locked session has no active account to sync against.
  const interval =
    sessionStatus === 'unlocked' &&
    state.initialized &&
    state.activeAccount != null &&
    !state.syncInProgress
      ? RESCAN_INTERVAL
      : null;

  useInterval(() => {
    triggerRescan();
  }, interval);

  return (
    <div className="flex flex-col min-h-screen">
      <div className="sticky top-0 z-40 w-full bg-surface border-b border-border px-6 py-2.5">
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <span className="pill pill-ycash shrink-0">Beta</span>
          <span className="leading-relaxed">
            Seeds are signed locally in this browser. Write your seed phrase
            down when you create the wallet — clearing browser data destroys
            your only copy.
          </span>
        </div>
      </div>
      <Layout>
        <Outlet />
      </Layout>
    </div>
  );
}

export default App;
