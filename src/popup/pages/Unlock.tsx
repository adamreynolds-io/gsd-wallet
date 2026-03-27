import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePopupStore } from '@popup/store/popupStore';

/**
 * Auto-unlock page. Since we dropped password protection for non-mainnet,
 * this just shows a loading spinner while the SW auto-initializes.
 */
export function Unlock() {
  const navigate = useNavigate();
  const setStatus = usePopupStore((s) => s.setStatus);
  const walletState = usePopupStore((s) => s.walletState);

  useEffect(() => {
    // The SW auto-unlocks on start. Just wait for state.
    if (walletState) {
      setStatus(walletState.status);
      navigate('/dashboard');
    }
  }, [walletState, navigate, setStatus]);

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="w-8 h-8 border-4 border-accent-purple border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-gray-400 mt-3">Loading wallet...</p>
    </div>
  );
}
