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
      <div className="w-full bg-yellow-100 border border-yellow-300 text-yellow-900 px-4 py-3 rounded-b-xl text-sm md:text-base">
        <strong>Ycash Web Wallet — beta.</strong> Seeds are generated and signed locally in this
        browser, encrypted with a passphrase, and stored only in this browser's IndexedDB. Write
        your seed phrase down when you create the wallet — clearing browser data destroys this
        copy, and there is no server-side recovery.
      </div>
      <Layout>
        <Outlet />
      </Layout>
    </div>
  );
}

export default App;
