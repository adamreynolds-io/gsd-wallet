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

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto flex-1">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold text-white">Settings</h2>
        <button
          className="text-sm text-gray-400 hover:text-white"
          onClick={() => navigate('/dashboard')}
        >
          Back
        </button>
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-1">
          Network
        </label>
        <select
          className="input-field"
          value={environment}
          onChange={(e) =>
            handleNetworkChange(e.target.value as Environment)
          }
        >
          {ENVIRONMENT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-1">
          Node URL
        </label>
        <input
          className="input-field text-sm"
          value={customUrls.nodeWsUrl}
          onChange={(e) =>
            setCustomUrls((u) => ({
              ...u,
              nodeWsUrl: e.target.value,
            }))
          }
        />
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-1">
          Indexer URL
        </label>
        <input
          className="input-field text-sm"
          value={customUrls.indexerHttpUrl}
          onChange={(e) =>
            setCustomUrls((u) => ({
              ...u,
              indexerHttpUrl: e.target.value,
            }))
          }
        />
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-1">
          Indexer WS URL
        </label>
        <input
          className="input-field text-sm"
          value={customUrls.indexerWsUrl}
          onChange={(e) =>
            setCustomUrls((u) => ({
              ...u,
              indexerWsUrl: e.target.value,
            }))
          }
        />
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-1">
          Prover URL
        </label>
        <input
          className="input-field text-sm"
          value={customUrls.provingServerUrl}
          onChange={(e) =>
            setCustomUrls((u) => ({
              ...u,
              provingServerUrl: e.target.value,
            }))
          }
        />
      </div>

      <div className="flex gap-3 mt-2">
        <button className="btn-secondary flex-1" onClick={handleReset}>
          Reset to Defaults
        </button>
        <button className="btn-primary flex-1" onClick={handleApply}>
          Apply
        </button>
      </div>

      <hr className="border-midnight-500 my-2" />

      <button
        className="btn-danger text-sm"
        onClick={() => {
          if (
            confirm(
              'Are you sure? You will need to re-import your wallet.',
            )
          ) {
            const port = chrome.runtime.connect({ name: 'gsd-popup' });
            port.postMessage({ type: 'CLEAR_ALL' });
            port.disconnect();
            navigate('/');
          }
        }}
      >
        Clear Wallet
      </button>

    </div>
  );
}
