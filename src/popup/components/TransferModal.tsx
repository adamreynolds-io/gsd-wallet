import { useState } from 'react';
import { Modal } from './Modal';
import { StepIndicator } from './StepIndicator';
import { usePopupStore } from '@popup/store/popupStore';
import { NIGHT_TOKEN_ID, NIGHT_DENOMINATION } from '@shared/constants';

interface TransferModalProps {
  open: boolean;
  onClose: () => void;
}

type Step = 'type' | 'token' | 'amount' | 'address' | 'confirm' | 'processing' | 'result';

const STEP_LABELS = ['Type', 'Token', 'Amount', 'Address', 'Confirm'];

function stepIndex(step: Step): number {
  const map: Record<string, number> = { type: 0, token: 1, amount: 2, address: 3, confirm: 4, processing: 4, result: 4 };
  return map[step] ?? 0;
}

export function TransferModal({ open, onClose }: TransferModalProps) {
  const walletState = usePopupStore((s) => s.walletState);
  const provingStatus = usePopupStore((s) => s.provingStatus);
  const [step, setStep] = useState<Step>('type');
  const [tokenType, setTokenType] = useState<'shielded' | 'unshielded'>('shielded');
  const [tokenId, setTokenId] = useState(NIGHT_TOKEN_ID);
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [txId, setTxId] = useState<string | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [activePort, setActivePort] = useState<chrome.runtime.Port | null>(null);

  function reset() {
    setStep('type');
    setTokenType('shielded');
    setTokenId(NIGHT_TOKEN_ID);
    setAmount('');
    setAddress('');
    setError(null);
    setTxId(null);
    setResultError(null);
  }

  function handleClose() {
    if (activePort) {
      activePort.disconnect();
      setActivePort(null);
    }
    reset();
    onClose();
  }

  function getTokens(): Array<{ id: string; balance: string }> {
    if (!walletState) return [];
    const balances = tokenType === 'shielded'
      ? walletState.shielded.balances
      : walletState.unshielded.balances;
    return Object.entries(balances)
      .filter(([, bal]) => bal !== '0')
      .map(([id, bal]) => ({ id, balance: bal }));
  }

  function getTokenName(id: string): string {
    if (tokenType === 'unshielded' && id === NIGHT_TOKEN_ID) return 'NIGHT';
    return `${id.slice(0, 8)}...`;
  }

  function toSmallestUnit(val: string): string {
    if (tokenType === 'unshielded' && tokenId === NIGHT_TOKEN_ID) {
      const parts = val.split('.');
      const whole = BigInt(parts[0] ?? '0');
      const fracStr = (parts[1] ?? '').padEnd(6, '0').slice(0, 6);
      const frac = BigInt(fracStr);
      return String(whole * NIGHT_DENOMINATION + frac);
    }
    return val;
  }

  async function handleSend() {
    setStep('processing');
    setError(null);

    const port = chrome.runtime.connect({ name: 'gsd-popup' });
    setActivePort(port);
    port.postMessage({
      type: 'SEND_TRANSFER',
      params: {
        tokenType,
        tokenId,
        amount: toSmallestUnit(amount),
        receiverAddress: address,
      },
    });

    const timeout = setTimeout(() => {
      setResultError('Transfer timed out after 120s');
      setStep('result');
      port.disconnect();
      setActivePort(null);
    }, 120_000);

    port.onMessage.addListener((msg) => {
      if (msg.type === 'TRANSFER_RESULT') {
        clearTimeout(timeout);
        if (msg.result.success) {
          setTxId(msg.result.txId);
        } else {
          setResultError(msg.result.error);
        }
        setStep('result');
        port.disconnect();
        setActivePort(null);
      }
    });
  }

  return (
    <Modal open={open} onClose={handleClose} title="Transfer">
      <StepIndicator steps={STEP_LABELS} current={stepIndex(step)} />

      {step === 'type' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">Select transfer type</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              className={`card text-center py-4 cursor-pointer border-2 transition-colors ${tokenType === 'shielded' ? 'border-accent-purple bg-accent-purple/10' : 'border-transparent hover:border-midnight-400'}`}
              onClick={() => setTokenType('shielded')}
            >
              <div className="text-2xl mb-1">&#x1f512;</div>
              <div className="text-sm font-medium text-white">Shielded</div>
              <div className="text-xs text-gray-400">Private transfer</div>
            </button>
            <button
              className={`card text-center py-4 cursor-pointer border-2 transition-colors ${tokenType === 'unshielded' ? 'border-accent-purple bg-accent-purple/10' : 'border-transparent hover:border-midnight-400'}`}
              onClick={() => setTokenType('unshielded')}
            >
              <div className="text-2xl mb-1">&#x1f513;</div>
              <div className="text-sm font-medium text-white">Unshielded</div>
              <div className="text-xs text-gray-400">Public transfer</div>
            </button>
          </div>
          <button className="btn-primary w-full mt-2" onClick={() => setStep('token')}>
            Next
          </button>
        </div>
      )}

      {step === 'token' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">Select token</p>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {getTokens().length === 0 && (
              <div className="text-sm text-gray-500 text-center py-4">No tokens with balance</div>
            )}
            {getTokens().map((t) => (
              <button
                key={t.id}
                className={`w-full card flex justify-between items-center cursor-pointer border-2 transition-colors ${tokenId === t.id ? 'border-accent-purple' : 'border-transparent hover:border-midnight-400'}`}
                onClick={() => setTokenId(t.id)}
              >
                <span className="text-sm text-white font-mono">{getTokenName(t.id)}</span>
                <span className="text-sm text-gray-400 font-mono">{t.balance}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary flex-1" onClick={() => setStep('type')}>Back</button>
            <button className="btn-primary flex-1" onClick={() => setStep('amount')}>Next</button>
          </div>
        </div>
      )}

      {step === 'amount' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">Enter amount</p>
          <input
            type="text"
            className="input-field font-mono text-lg"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
          <p className="text-xs text-gray-500">
            Available: {walletState?.[tokenType === 'shielded' ? 'shielded' : 'unshielded'].balances[tokenId] ?? '0'}
          </p>
          {error && <p className="text-xs text-status-red">{error}</p>}
          <div className="flex gap-2">
            <button className="btn-secondary flex-1" onClick={() => setStep('token')}>Back</button>
            <button
              className="btn-primary flex-1"
              disabled={!amount || amount === '0'}
              onClick={() => { setError(null); setStep('address'); }}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {step === 'address' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">Recipient address</p>
          <input
            type="text"
            className="input-field font-mono text-sm"
            placeholder={tokenType === 'shielded' ? 'mn_shield-addr...' : 'mn_addr...'}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            autoFocus
          />
          {error && <p className="text-xs text-status-red">{error}</p>}
          <div className="flex gap-2">
            <button className="btn-secondary flex-1" onClick={() => setStep('amount')}>Back</button>
            <button
              className="btn-primary flex-1"
              disabled={!address}
              onClick={() => { setError(null); setStep('confirm'); }}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">Confirm transfer</p>
          <div className="card space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Type</span>
              <span className="text-white capitalize">{tokenType}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Token</span>
              <span className="text-white font-mono">{getTokenName(tokenId)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Amount</span>
              <span className="text-white font-mono">{amount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">To</span>
              <span className="text-white font-mono text-xs truncate max-w-[200px]">{address}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary flex-1" onClick={() => setStep('address')}>Back</button>
            <button className="btn-primary flex-1" onClick={handleSend}>Send</button>
          </div>
        </div>
      )}

      {step === 'processing' && (
        <div className="flex flex-col items-center py-8 gap-4">
          <div className="w-10 h-10 border-4 border-accent-purple border-t-transparent rounded-full animate-spin" />
          {provingStatus?.activeProver === 'wasm' && provingStatus.phase === 'proving' ? (
            <>
              <p className="text-sm text-gray-400">Proving via WASM...</p>
              <button
                onClick={() => {
                  const port = chrome.runtime.connect({ name: 'gsd-popup' });
                  port.postMessage({ type: 'CANCEL_WASM_PROVE' });
                  port.disconnect();
                }}
                className="text-xs text-blue-400 hover:text-blue-300 underline"
              >
                Use proof server instead
              </button>
            </>
          ) : provingStatus?.phase === 'cancelled' ? (
            <p className="text-sm text-gray-400">Retrying with proof server...</p>
          ) : (
            <p className="text-sm text-gray-400">Processing transfer...</p>
          )}
        </div>
      )}

      {step === 'result' && (
        <div className="flex flex-col items-center py-6 gap-4">
          {txId ? (
            <>
              <div className="w-14 h-14 rounded-full bg-status-green/20 flex items-center justify-center text-3xl text-status-green">
                &#x2713;
              </div>
              <p className="text-white font-medium">Transfer successful!</p>
              <p className="text-xs text-gray-400 font-mono break-all text-center">{txId}</p>
            </>
          ) : (
            <>
              <div className="w-14 h-14 rounded-full bg-status-red/20 flex items-center justify-center text-3xl text-status-red">
                &#x2717;
              </div>
              <p className="text-white font-medium">Transfer failed</p>
              <p className="text-xs text-status-red text-center">{resultError}</p>
            </>
          )}
          <button className="btn-primary w-full mt-2" onClick={handleClose}>Done</button>
        </div>
      )}
    </Modal>
  );
}
