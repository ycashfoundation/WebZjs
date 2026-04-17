import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { generate_seed_phrase } from '@chainsafe/webzjs-keys';
import { useSession } from '../context/SessionContext';
import { useWebZjsContext } from '../context/WebzjsContext';
import Button from '../components/Button/Button';

type Step = 'backup' | 'passphrase' | 'creating';

const CreateWallet: React.FC = () => {
  const navigate = useNavigate();
  const { createWallet, status } = useSession();
  const { initWallet } = useWebZjsContext();
  const [step, setStep] = useState<Step>('backup');
  const [mnemonic, setMnemonic] = useState<string>('');
  const [confirmed, setConfirmed] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseAgain, setPassphraseAgain] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Lazy-init the wasm so `generate_seed_phrase` is available, then seed the
  // mnemonic into state exactly once. We throw away this mnemonic if the user
  // backs out — it never hits disk until they commit the passphrase step.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await initWallet();
      if (!cancelled && !mnemonic) {
        setMnemonic(generate_seed_phrase());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initWallet, mnemonic]);

  // If a vault already exists (e.g. user typed /create directly), bounce them
  // to the unlock page rather than overwriting.
  useEffect(() => {
    if (status === 'locked') navigate('/unlock', { replace: true });
    if (status === 'unlocked') navigate('/dashboard/account-summary', { replace: true });
  }, [status, navigate]);

  const words = mnemonic ? mnemonic.split(' ') : [];

  const handleCommit = async () => {
    setError(null);
    if (passphrase.length < 8) {
      setError('Passphrase must be at least 8 characters.');
      return;
    }
    if (passphrase !== passphraseAgain) {
      setError('Passphrases do not match.');
      return;
    }
    setStep('creating');
    try {
      await createWallet(mnemonic, passphrase);
      navigate('/dashboard/account-summary');
    } catch (err) {
      console.error('createWallet failed:', err);
      setError(err instanceof Error ? err.message : String(err));
      setStep('passphrase');
    }
  };

  if (!mnemonic) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        Generating seed…
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <h1 className="text-4xl font-semibold mb-2">Create a Ycash Wallet</h1>
      <p className="text-neutral-600 mb-8">
        Your seed phrase is the only way to recover this wallet. Write it down
        somewhere safe. Anyone who sees these 24 words controls your funds.
      </p>

      {step === 'backup' && (
        <>
          <div className="grid grid-cols-3 gap-2 bg-neutral-50 border border-neutral-300 rounded-2xl p-6 mb-6 font-mono text-sm">
            {words.map((w, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-neutral-400 w-6 text-right">{i + 1}.</span>
                <span>{w}</span>
              </div>
            ))}
          </div>

          <label className="flex items-start gap-3 mb-6 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-1"
            />
            <span className="text-sm text-neutral-700">
              I have written these 24 words down and stored them somewhere I
              control. Losing them means losing access to the wallet.
            </span>
          </label>

          <Button
            label="Continue"
            disabled={!confirmed}
            onClick={() => setStep('passphrase')}
          />
        </>
      )}

      {(step === 'passphrase' || step === 'creating') && (
        <>
          <p className="text-neutral-700 mb-6">
            Set a passphrase to encrypt the seed on this browser. You'll need
            it every time you unlock the wallet.
          </p>

          <div className="flex flex-col gap-4 mb-6">
            <input
              type="password"
              placeholder="Passphrase (8+ characters)"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="border border-neutral-300 rounded-xl px-4 py-3"
              autoFocus
            />
            <input
              type="password"
              placeholder="Confirm passphrase"
              value={passphraseAgain}
              onChange={(e) => setPassphraseAgain(e.target.value)}
              className="border border-neutral-300 rounded-xl px-4 py-3"
            />
          </div>

          {error && (
            <div className="text-red-600 text-sm mb-4">{error}</div>
          )}

          <Button
            label={step === 'creating' ? 'Encrypting…' : 'Create Wallet'}
            disabled={step === 'creating'}
            onClick={handleCommit}
          />
        </>
      )}
    </div>
  );
};

export default CreateWallet;
