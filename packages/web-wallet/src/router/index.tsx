import { createBrowserRouter } from 'react-router-dom';
import App from '../App';
import ProtectedRoute from '../components/ProtectedRoute/ProtectedRoute';
import Home from '../pages/Home';
import CreateWallet from '../pages/CreateWallet';
import ImportWallet from '../pages/ImportWallet';
import Unlock from '../pages/Unlock';
import Dashboard from '../pages/Dashboard';
import AccountSummary from '../pages/AccountSummary';
import TransferBalance from '../pages/TransferBalance/TransferBalance';
import Receive from '../pages/Receive/Receive';
import { ShieldBalance } from 'src/pages/ShieldBalance/ShieldBalance';
import TransactionHistory from '../pages/TransactionHistory/TransactionHistory';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        index: true,
        element: <Home />,
      },
      { path: 'create', element: <CreateWallet /> },
      { path: 'import', element: <ImportWallet /> },
      { path: 'unlock', element: <Unlock /> },
      {
        path: 'dashboard',
        element: (
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        ),
        children: [
          { path: 'account-summary', element: <AccountSummary /> },
          { path: 'transfer-balance', element: <TransferBalance /> },
          { path: 'shield-balance', element: <ShieldBalance /> },
          { path: 'receive', element: <Receive /> },
          { path: 'transactions', element: <TransactionHistory /> },
        ],
      },
    ],
  },
]);

export { router };
