import { BrowserRouter } from 'react-router';
import { HistoryProvider } from './history';
import { AppProviders } from './providers';
import { AppRoutes } from './routes';

export function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <HistoryProvider>
          <AppRoutes />
        </HistoryProvider>
      </BrowserRouter>
    </AppProviders>
  );
}
