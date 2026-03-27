import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePopupStore } from '@popup/store/popupStore';
import { ENVIRONMENT_OPTIONS, ENVIRONMENTS } from '@shared/environments';
import type { Environment } from '@shared/types';

export function Settings() {
  const navigate = useNavigate();
  const currentEnv = usePopupStore((s) => s.environment);
  const showStatusMessage = usePopupStore((s) => s.showStatusMessage);
  const [environment, setEnvironment] = useState<Environment>(currentEnv);
  const [customUrls, setCustomUrls] = useState({
    nodeWsUrl: ENVIRONMENTS[currentEnv].nodeWsUrl,
    indexerHttpUrl: ENVIRONMENTS[currentEnv].indexerHttpUrl,
    indexerWsUrl: ENVIRONMENTS[currentEnv].indexerWsUrl,
    provingServerUrl: ENVIRONMENTS[currentEnv].provingServerUrl,
  });

  function handleNetworkChange(env: Environment) {
    setEnvironment(env);
    const config = ENVIRONMENTS[env];
    setCustomUrls({
      nodeWsUrl: config.nodeWsUrl,
      indexerHttpUrl: config.indexerHttpUrl,
      indexerWsUrl: config.indexerWsUrl,
      provingServerUrl: config.provingServerUrl,
    });
  }

  function handleApply() {
    const defaults = ENVIRONMENTS[environment];
    const urlsChanged =
      customUrls.nodeWsUrl !== defaults.nodeWsUrl ||
      customUrls.indexerHttpUrl !== defaults.indexerHttpUrl ||
      customUrls.indexerWsUrl !== defaults.indexerWsUrl ||
      customUrls.provingServerUrl !== defaults.provingServerUrl;

    const port = chrome.runtime.connect({ name: 'gsd-popup' });
    port.postMessage({
      type: 'SWITCH_ENVIRONMENT',
      environment,
      ...(urlsChanged ? { customUrls } : {}),
    });
    showStatusMessage('Settings applied, restarting wallet...', 'info');
    port.disconnect();
    setTimeout(() => navigate('/dashboard'), 1500);
  }

  function handleReset() {
    handleNetworkChange(environment);
    showStatusMessage('Reset to defaults', 'info');
  }

  function handleClear() {
    if (!confirm('Clear all wallets? You will need to re-import.')) return;
    const port = chrome.runtime.connect({ name: 'gsd-popup' });
    port.postMessage({ type: 'CLEAR_ALL' });
    port.disconnect();
    const store = usePopupStore.getState();
    store.setHasVault(false);
    store.setStatus('uninitialized');
    store.setError(null);
    store.clearStatusMessage();
    navigate('/onboarding', { replace: true });
  }

  return (
    <div className="flex flex-col gap-2 p-3 overflow-y-auto flex-1">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Settings</h2>
        <button className="text-xs text-gray-400 hover:text-white" onClick={() => navigate('/dashboard')}>
          Back
        </button>
      </div>

      <Field label="Network">
        <select
          className="input-field text-sm !py-1.5"
          value={environment}
          onChange={(e) => handleNetworkChange(e.target.value as Environment)}
        >
          {ENVIRONMENT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </Field>

      <Field label="Node URL">
        <input className="input-field text-xs !py-1.5" value={customUrls.nodeWsUrl}
          onChange={(e) => setCustomUrls((u) => ({ ...u, nodeWsUrl: e.target.value }))} />
      </Field>

      <Field label="Indexer URL">
        <input className="input-field text-xs !py-1.5" value={customUrls.indexerHttpUrl}
          onChange={(e) => setCustomUrls((u) => ({ ...u, indexerHttpUrl: e.target.value }))} />
      </Field>

      <Field label="Indexer WS">
        <input className="input-field text-xs !py-1.5" value={customUrls.indexerWsUrl}
          onChange={(e) => setCustomUrls((u) => ({ ...u, indexerWsUrl: e.target.value }))} />
      </Field>

      <Field label="Prover URL">
        <input className="input-field text-xs !py-1.5" value={customUrls.provingServerUrl}
          onChange={(e) => setCustomUrls((u) => ({ ...u, provingServerUrl: e.target.value }))} />
      </Field>

      <div className="flex gap-2 mt-1">
        <button className="btn-secondary flex-1 text-xs !py-1.5" onClick={handleReset}>Reset</button>
        <button className="btn-primary flex-1 text-xs !py-1.5" onClick={handleApply}>Apply</button>
      </div>

      <hr className="border-midnight-500 my-1" />

      <button className="btn-danger text-xs !py-1.5" onClick={handleClear}>
        Clear Wallet
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-0.5">{label}</label>
      {children}
    </div>
  );
}
