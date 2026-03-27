import { Routes, Route, Navigate } from 'react-router-dom';
import { Header } from '@popup/components/Header';
import { Unlock } from '@popup/pages/Unlock';
import { Onboarding } from '@popup/pages/Onboarding';
import { Dashboard } from '@popup/pages/Dashboard';
import { Settings } from '@popup/pages/Settings';
import { usePopupStore } from '@popup/store/popupStore';
import { useWalletConnection } from '@popup/hooks/useWalletState';

export function App() {
  useWalletConnection();

  const status = usePopupStore((s) => s.status);
  const hasVault = usePopupStore((s) => s.hasVault);

  return (
    <div className="flex flex-col h-full">
      <Header />
      <main className="flex-1 overflow-hidden flex flex-col">
        <Routes>
          <Route
            path="/"
            element={<RootRedirect status={status} hasVault={hasVault} />}
          />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/unlock" element={<Unlock />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}

function RootRedirect({
  status,
  hasVault,
}: {
  status: string;
  hasVault: boolean | null;
}) {
  if (hasVault === null) {
    // Still checking
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Loading...
      </div>
    );
  }

  if (!hasVault) {
    return <Navigate to="/onboarding" replace />;
  }

  if (status === 'syncing' || status === 'synced') {
    return <Navigate to="/dashboard" replace />;
  }

  return <Navigate to="/unlock" replace />;
}
