import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePopupStore } from '@popup/store/popupStore';
import { ENVIRONMENT_OPTIONS, getEnvironmentLabel } from '@shared/environments';
import type { Environment, SeedType } from '@shared/types';

type Step =
  | 'network'
  | 'method'
  | 'seed-input'
  | 'seed-display'
  | 'password'
  | 'creating';

export function Onboarding() {
  const [step, setStep] = useState<Step>('network');
  const [environment, setEnvironment] = useState<Environment | ''>('');
  const [seedType, setSeedType] = useState<SeedType>('mnemonic');
  const [seedWords, setSeedWords] = useState<string[]>([]);
  const [seedInput, setSeedInput] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const setStatus = usePopupStore((s) => s.setStatus);
  const showStatusMessage = usePopupStore((s) => s.showStatusMessage);

  const needsPassword = false; // Password disabled for now — dev wallet

  async function generateSeed(): Promise<{
    words: string[];
    seed: Uint8Array;
  }> {
    const { generateMnemonic, mnemonicToEntropy } = await import('@scure/bip39');
    const { wordlist } = await import('@scure/bip39/wordlists/english.js');
    const mnemonic = generateMnemonic(wordlist, 256);
    const words = mnemonic.split(' ');
    const entropy = mnemonicToEntropy(mnemonic, wordlist);
    return { words, seed: new Uint8Array(entropy.slice(0, 32)) };
  }

  async function parseSeedInput(): Promise<Uint8Array> {
    if (seedType === 'mnemonic') {
      const { mnemonicToEntropy, validateMnemonic } = await import('@scure/bip39');
      const { wordlist } = await import('@scure/bip39/wordlists/english.js');
      const trimmed = seedInput.trim().toLowerCase();
      if (!validateMnemonic(trimmed, wordlist)) {
        throw new Error('Invalid mnemonic phrase');
      }
      const entropy = mnemonicToEntropy(trimmed, wordlist);
      return new Uint8Array(entropy.slice(0, 32));
    }
    const hex = seedInput.trim().replace(/^0x/, '');
    if (!/^[0-9a-f]+$/i.test(hex) || (hex.length !== 64 && hex.length !== 128)) {
      throw new Error('Invalid hex seed (expected 64 or 128 hex chars)');
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes.slice(0, 32);
  }

  async function createWallet(seedOverride?: Uint8Array, nameOverride?: string) {
    setCreating(true);
    setError(null);

    try {
      let seed: Uint8Array;
      if (seedOverride) {
        seed = seedOverride;
      } else if (seedWords.length > 0 && step !== 'seed-input') {
        const { mnemonicToEntropy } = await import('@scure/bip39');
        const { wordlist: wl } = await import('@scure/bip39/wordlists/english.js');
        const ent = mnemonicToEntropy(seedWords.join(' '), wl);
        seed = new Uint8Array(ent.slice(0, 32));
      } else {
        seed = await parseSeedInput();
      }

      if (needsPassword) {
        if (password !== confirmPassword) {
          setError('Passwords do not match');
          setCreating(false);
          return;
        }
        if (password.length < 8) {
          setError('Password must be at least 8 characters');
          setCreating(false);
          return;
        }
      }

      const envLabel = environment ? getEnvironmentLabel(environment) : 'Wallet';
      const walletName = nameOverride ?? envLabel;
      const port = chrome.runtime.connect({ name: 'gsd-popup' });
      port.postMessage({
        type: 'ADD_WALLET',
        name: walletName,
        seed: Array.from(seed),
        environment,
      });

      port.onMessage.addListener((msg) => {
        if (msg.type === 'WALLET_ADDED') {
          setCreating(false);
          if (msg.success) {
            setSeedWords([]);
            setSeedInput('');
            usePopupStore.getState().setHasVault(true);
            setStatus('initializing');
            showStatusMessage('Wallet syncing...', 'info');
            navigate('/dashboard');
          } else {
            setError(msg.error ?? 'Failed to create wallet');
          }
          port.disconnect();
        }
        // Ignore other messages (STATE_UPDATE, DIAGNOSTIC_EVENT, etc.)
      });
    } catch (err) {
      setCreating(false);
      setError(err instanceof Error ? err.message : 'Invalid seed');
    }
  }

  async function importLocalnetWallet(index: number) {
    // Genesis wallets use seeds 1-4 (seed 1 = master wallet with all minted NIGHT)
    const hex = (index + 1).toString(16).padStart(64, '0');
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    await createWallet(bytes, `Genesis W${index}`);
  }

  return (
    <div className="flex flex-col h-full px-6 py-4 overflow-y-auto">
      <div className="bg-amber-900/60 border border-amber-600/40 text-amber-200 text-xs px-3 py-1.5 text-center mb-4">
        Developer/QA wallet only — do not use for real funds.
      </div>

      {step === 'network' && (
        <div className="flex flex-col gap-4 flex-1 justify-center max-w-sm mx-auto w-full">
          <h2 className="text-xl font-bold text-white text-center mb-2">
            Welcome to GSD
          </h2>
          <p className="text-sm text-gray-400 text-center mb-4">
            Select your network to get started
          </p>

          <select
            className="input-field"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value as Environment)}
          >
            <option value="" disabled>
              Select a network…
            </option>
            {ENVIRONMENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {environment === 'undeployed' && (
            <>
              <p className="text-xs text-gray-500 text-center">
                Quick import prefunded genesis wallets
              </p>
              <div className="grid grid-cols-2 gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <button
                    key={i}
                    className="btn-secondary text-sm"
                    disabled={creating}
                    onClick={() => importLocalnetWallet(i)}
                  >
                    {creating ? '...' : `Wallet ${i}`}
                  </button>
                ))}
              </div>
            </>
          )}

          {error && (
            <div className="text-status-red text-sm text-center">{error}</div>
          )}

          <button
            className="btn-primary mt-4"
            disabled={!environment}
            onClick={() => setStep('method')}
          >
            Import or Generate
          </button>
        </div>
      )}

      {step === 'method' && (
        <div className="flex flex-col gap-3 flex-1 justify-center max-w-sm mx-auto w-full">
          <h2 className="text-lg font-bold text-white text-center mb-4">
            Create or Import Wallet
          </h2>

          <button
            className="btn-primary"
            onClick={async () => {
              const { words } = await generateSeed();
              setSeedWords(words);
              setStep('seed-display');
            }}
          >
            Generate New Wallet
          </button>

          <button
            className="btn-secondary"
            onClick={() => { setSeedType('mnemonic'); setStep('seed-input'); }}
          >
            Import Seed Phrase
          </button>

          <button
            className="btn-secondary"
            onClick={() => { setSeedType('hex'); setStep('seed-input'); }}
          >
            Import Hex Seed
          </button>

          <button
            className="btn-secondary text-sm text-gray-400 mt-2"
            onClick={() => setStep('network')}
          >
            Back
          </button>
        </div>
      )}

      {step === 'seed-display' && (
        <div className="flex flex-col gap-4 flex-1 max-w-md mx-auto w-full">
          <div className="text-status-amber text-sm text-center font-medium">
            Write down these words and keep them safe!
          </div>

          <div className="grid grid-cols-3 gap-2 bg-midnight-600 rounded-lg p-4">
            {seedWords.map((word, i) => (
              <div key={i} className="text-sm font-mono text-gray-300">
                <span className="text-midnight-400 mr-1">{i + 1}.</span>
                {word}
              </div>
            ))}
          </div>

          <SeedCopyButton seedWords={seedWords} />

          <button
            className="btn-primary"
            onClick={() => {
              if (needsPassword) {
                setStep('password');
              } else {
                createWallet();
              }
            }}
          >
            {needsPassword ? "I've Saved My Seed Phrase" : 'Create Wallet'}
          </button>

          {error && <div className="text-status-red text-sm text-center">{error}</div>}

          <button className="btn-secondary text-sm text-gray-400" onClick={() => setStep('method')}>
            Back
          </button>
        </div>
      )}

      {step === 'seed-input' && (
        <div className="flex flex-col gap-4 flex-1 justify-center max-w-sm mx-auto w-full">
          <h2 className="text-lg font-bold text-white text-center">
            {seedType === 'mnemonic' ? 'Import Seed Phrase' : 'Import Hex Seed'}
          </h2>

          {seedType === 'mnemonic' ? (
            <textarea
              className="input-field h-24 resize-none"
              placeholder="word1 word2 word3 ..."
              value={seedInput}
              onChange={(e) => setSeedInput(e.target.value)}
              autoFocus
            />
          ) : (
            <input
              type="password"
              className="input-field"
              placeholder="0x... or raw hex (64-128 chars)"
              value={seedInput}
              onChange={(e) => setSeedInput(e.target.value)}
              autoFocus
            />
          )}

          {error && <div className="text-status-red text-sm text-center">{error}</div>}

          <button
            className="btn-primary"
            disabled={!seedInput.trim() || creating}
            onClick={() => {
              if (needsPassword) {
                setStep('password');
              } else {
                createWallet();
              }
            }}
          >
            {creating ? 'Creating...' : needsPassword ? 'Continue' : 'Import Wallet'}
          </button>

          <button className="btn-secondary text-sm text-gray-400" onClick={() => setStep('method')}>
            Back
          </button>
        </div>
      )}

      {step === 'password' && (
        <div className="flex flex-col gap-4 flex-1 justify-center max-w-sm mx-auto w-full">
          <h2 className="text-lg font-bold text-white text-center">Set Password</h2>
          <p className="text-sm text-gray-400 text-center">
            Required for mainnet — encrypts your wallet on this device
          </p>

          <input
            type="password"
            className="input-field"
            placeholder="Password (8+ characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          <input
            type="password"
            className="input-field"
            placeholder="Confirm password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />

          {error && <div className="text-status-red text-sm text-center">{error}</div>}

          <button
            className="btn-primary"
            disabled={creating || !password || !confirmPassword}
            onClick={() => createWallet()}
          >
            {creating ? 'Creating wallet...' : 'Create Wallet'}
          </button>

          <button
            className="btn-secondary text-sm text-gray-400"
            onClick={() => {
              setError(null);
              setStep(seedWords.length > 0 ? 'seed-display' : 'seed-input');
            }}
          >
            Back
          </button>
        </div>
      )}

      {creating && step !== 'password' && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-accent-purple border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-300">Initializing wallet...</p>
          </div>
        </div>
      )}
    </div>
  );
}

function SeedCopyButton({ seedWords }: { seedWords: string[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn-secondary text-sm"
      onClick={async () => {
        await navigator.clipboard.writeText(seedWords.join(' '));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? 'Copied!' : 'Copy Seed Phrase'}
    </button>
  );
}
