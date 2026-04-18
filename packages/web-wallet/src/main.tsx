import { createRoot } from 'react-dom/client';

import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { WebZjsProvider } from './context/WebzjsContext';
import { MetaMaskProvider } from './context/MetamaskContext';
import { SessionProvider } from './context/SessionContext';
import { ThemeProvider } from './context/ThemeContext';

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <MetaMaskProvider>
      <SessionProvider>
        <WebZjsProvider>
          <RouterProvider router={router} />
        </WebZjsProvider>
      </SessionProvider>
    </MetaMaskProvider>
  </ThemeProvider>,
);
