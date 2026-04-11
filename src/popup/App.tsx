import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Header } from '@popup/components/Header';
import { Unlock } from '@popup/pages/Unlock';
import { Onboarding } from '@popup/pages/Onboarding';
import { Dashboard } from '@popup/pages/Dashboard';
import { Settings } from '@popup/pages/Settings';
import { usePopupStore } from '@popup/store/popupStore';
import { useWalletConnection } from '@popup/hooks/useWalletState';
import { ErrorBoundary } from '@popup/components/ErrorBoundary';

const DISCLAIMER_KEY = 'gsdDisclaimerAccepted';

export function App() {
  useWalletConnection();

  const status = usePopupStore((s) => s.status);
  const hasVault = usePopupStore((s) => s.hasVault);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState<boolean | null>(null);

  useEffect(() => {
    if (window.innerWidth > 800) {
      document.body.style.width = '100vw';
      document.body.style.height = '100vh';
      document.body.style.maxWidth = '960px';
      document.body.style.margin = '0 auto';
    }
  }, []);

  useEffect(() => {
    chrome.storage.local.get(DISCLAIMER_KEY).then((result) => {
      setDisclaimerAccepted(result[DISCLAIMER_KEY] === true);
    });
  }, []);

  if (disclaimerAccepted === null) return null;

  if (!disclaimerAccepted) {
    return <Disclaimer onAccept={() => {
      chrome.storage.local.set({ [DISCLAIMER_KEY]: true });
      setDisclaimerAccepted(true);
    }} />;
  }

  return (
    <div className="flex flex-col h-full">
      <Header />
      <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <ErrorBoundary>
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
        </ErrorBoundary>
      </main>
    </div>
  );
}

function Disclaimer({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full bg-midnight-900 p-6">
      <div className="max-w-lg w-full bg-midnight-800 border border-midnight-500 rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-2">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <h1 className="text-lg font-bold text-white">Development Wallet</h1>
        </div>

        <div className="text-sm text-gray-300 space-y-3">
          <p>
            <strong className="text-amber-400">Midnight GSD is a developer tool, not a production wallet.</strong>
          </p>
          <p>
            By using this wallet you acknowledge and agree that:
          </p>
          <ul className="list-disc list-inside space-y-1.5 text-gray-400">
            <li>Seed phrases and private keys are stored <strong className="text-red-400">unencrypted</strong> in browser storage</li>
            <li>This wallet is intended solely for <strong className="text-white">development, testing, and debugging</strong> on Midnight networks</li>
            <li>You should <strong className="text-red-400">never</strong> import a seed phrase that controls real funds or mainnet assets of value</li>
            <li>DApp connections are auto-approved without user confirmation</li>
            <li>No security audit has been performed on this software</li>
          </ul>
          <p className="text-gray-500 text-xs">
            The authors accept no liability for any loss of funds resulting from the use of this wallet.
            Use at your own risk.
          </p>
        </div>

        <button
          onClick={onAccept}
          className="w-full py-2.5 px-4 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded transition-colors"
        >
          I understand — this is a development wallet only
        </button>
      </div>
    </div>
  );
}

function RootRedirect({
  hasVault,
}: {
  status: string;
  hasVault: boolean | null;
}) {
  // No vault confirmed — onboard
  if (hasVault === false) {
    return <Navigate to="/onboarding" replace />;
  }

  // Vault exists or still checking — go straight to Dashboard.
  // Dashboard renders the empty wallet view while waiting for state.
  return <Navigate to="/dashboard" replace />;
}
