import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePopupStore } from '@popup/store/popupStore';

/**
 * Auto-unlock page. Immediately redirects to Dashboard.
 * The wallet initializes in the background — the Dashboard
 * renders an empty wallet view while sync progress shows in
 * the status bar and progress indicators.
 */
export function Unlock() {
  const navigate = useNavigate();
  const setStatus = usePopupStore((s) => s.setStatus);
  const walletState = usePopupStore((s) => s.walletState);

  useEffect(() => {
    if (walletState) {
      setStatus(walletState.status);
    }
    // Always go to dashboard — it handles uninitialized state gracefully
    navigate('/dashboard', { replace: true });
  }, [walletState, navigate, setStatus]);

  return null;
}
