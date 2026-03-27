import { useState } from 'react';
import { Modal } from './Modal';
import { usePopupStore } from '@popup/store/popupStore';
import { NIGHT_TOKEN_ID, NIGHT_DENOMINATION } from '@shared/constants';
import type { SerializedUtxo } from '@shared/types';

interface DustModalProps {
  open: boolean;
  onClose: () => void;
  mode: 'register' | 'deregister';
}

type Step = 'select' | 'confirm' | 'processing' | 'result';

export function DustModal({ open, onClose, mode }: DustModalProps) {
  const walletState = usePopupStore((s) => s.walletState);
  const [step, setStep] = useState<Step>('select');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [txId, setTxId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isRegister = mode === 'register';
  const title = isRegister ? 'Register for Dust' : 'Deregister from Dust';

  function getUtxos(): SerializedUtxo[] {
    if (!walletState) return [];
    return walletState.unshielded.utxos.filter((u) =>
      u.tokenType === NIGHT_TOKEN_ID && (isRegister ? !u.registered : u.registered)
    );
  }

  function toggleUtxo(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function formatValue(val: string): string {
    const n = BigInt(val);
    const whole = n / NIGHT_DENOMINATION;
    const frac = n % NIGHT_DENOMINATION;
    if (frac === 0n) return `${whole} NIGHT`;
    const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
    return `${whole}.${fracStr} NIGHT`;
  }

  function totalValue(): string {
    const utxos = getUtxos().filter((u) => selectedIds.has(u.id));
    const total = utxos.reduce((acc, u) => acc + BigInt(u.value), 0n);
    return formatValue(String(total));
  }

  function reset() {
    setStep('select');
    setSelectedIds(new Set());
    setTxId(null);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    setStep('processing');
    setError(null);

    const port = chrome.runtime.connect({ name: 'gsd-popup' });
    const msgType = isRegister ? 'DUST_REGISTER' : 'DUST_DEREGISTER';
    port.postMessage({
      type: msgType,
      utxoIds: [...selectedIds],
    });

    const resultType = isRegister ? 'DUST_REGISTER_RESULT' : 'DUST_DEREGISTER_RESULT';
    port.onMessage.addListener((msg) => {
      if (msg.type === resultType) {
        if (msg.result.success) {
          setTxId(msg.result.txId);
        } else {
          setError(msg.result.error);
        }
        setStep('result');
        port.disconnect();
      }
    });
  }

  return (
    <Modal open={open} onClose={handleClose} title={title}>
      {step === 'select' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">
            {isRegister
              ? 'Select NIGHT UTXOs to register for dust generation'
              : 'Select registered UTXOs to deregister'}
          </p>
          <div className="space-y-2 max-h-52 overflow-y-auto">
            {getUtxos().length === 0 && (
              <div className="text-sm text-gray-500 text-center py-4">
                {isRegister ? 'No unregistered UTXOs' : 'No registered UTXOs'}
              </div>
            )}
            {getUtxos().map((utxo) => (
              <label
                key={utxo.id}
                className={`card flex items-center gap-3 cursor-pointer border-2 transition-colors ${selectedIds.has(utxo.id) ? 'border-accent-purple' : 'border-transparent hover:border-midnight-400'}`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(utxo.id)}
                  onChange={() => toggleUtxo(utxo.id)}
                  className="accent-accent-purple"
                />
                <div className="flex-1">
                  <div className="text-sm text-white font-mono">{formatValue(utxo.value)}</div>
                  <div className="text-[10px] text-gray-500 font-mono truncate">{utxo.id}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary flex-1" onClick={handleClose}>Cancel</button>
            <button
              className="btn-primary flex-1"
              disabled={selectedIds.size === 0}
              onClick={() => setStep('confirm')}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">Confirm {isRegister ? 'registration' : 'deregistration'}</p>
          <div className="card space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">UTXOs</span>
              <span className="text-white">{selectedIds.size}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Total Value</span>
              <span className="text-white font-mono">{totalValue()}</span>
            </div>
          </div>
          {isRegister && (
            <p className="text-xs text-status-amber">
              These UTXOs will start generating dust
            </p>
          )}
          {!isRegister && (
            <p className="text-xs text-status-amber">
              These UTXOs will stop generating dust after deregistration
            </p>
          )}
          <div className="flex gap-2">
            <button className="btn-secondary flex-1" onClick={() => setStep('select')}>Back</button>
            <button className="btn-primary flex-1" onClick={handleSubmit}>
              {isRegister ? 'Register' : 'Deregister'}
            </button>
          </div>
        </div>
      )}

      {step === 'processing' && (
        <div className="flex flex-col items-center py-8 gap-4">
          <div className="w-10 h-10 border-4 border-accent-purple border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-400">
            {isRegister ? 'Registering UTXOs...' : 'Deregistering UTXOs...'}
          </p>
        </div>
      )}

      {step === 'result' && (
        <div className="flex flex-col items-center py-6 gap-4">
          {txId ? (
            <>
              <div className="w-14 h-14 rounded-full bg-status-green/20 flex items-center justify-center text-3xl text-status-green">
                &#x2713;
              </div>
              <p className="text-white font-medium">
                {isRegister ? 'Registration' : 'Deregistration'} successful!
              </p>
              <p className="text-xs text-gray-400 font-mono break-all text-center">{txId}</p>
            </>
          ) : (
            <>
              <div className="w-14 h-14 rounded-full bg-status-red/20 flex items-center justify-center text-3xl text-status-red">
                &#x2717;
              </div>
              <p className="text-white font-medium">
                {isRegister ? 'Registration' : 'Deregistration'} failed
              </p>
              <p className="text-xs text-status-red text-center">{error}</p>
            </>
          )}
          <button className="btn-primary w-full mt-2" onClick={handleClose}>Done</button>
        </div>
      )}
    </Modal>
  );
}
