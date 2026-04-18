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
    if (status === 'unlocked')
      navigate('/dashboard/account-summary', { replace: true });
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
      <div className="max-w-2xl mx-auto px-4 py-16 text-center font-mono text-sm text-text-muted">
        Generating seed…
      </div>
    );
  }

  const stepNum = step === 'backup' ? 1 : 2;

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-text-dim mb-3">
        Step {stepNum} of 2 · {step === 'backup' ? 'Back up your seed' : 'Set a passphrase'}
      </div>
      <h1 className="text-4xl md:text-5xl font-semibold tracking-tight mb-3">
        Create a Ycash wallet
      </h1>
      <p className="text-text-muted mb-10 max-w-[52ch] leading-relaxed">
        Your 24-word seed phrase is the only way to recover this wallet.
        Anyone who has it controls your funds. Write it down somewhere you
        trust — not a password manager, not a screenshot.
      </p>

      {step === 'backup' && (
        <>
          <div className="card-surface p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-dim">
                seed phrase · 24 words
              </span>
              <span className="pill pill-danger">keep private</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-5 gap-y-3 font-mono text-sm">
              {words.map((w, i) => (
                <div key={i} className="flex items-baseline gap-2.5">
                  <span className="text-text-dim w-5 text-right tabular-nums">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="text-text">{w}</span>
                </div>
              ))}
            </div>
          </div>

          <label className="flex items-start gap-3 mb-8 cursor-pointer group">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-1 accent-accent"
            />
            <span className="text-sm text-text-muted group-hover:text-text transition-colors">
              I have written these 24 words down and stored them somewhere
              I control. Losing them means losing access to the wallet.
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
          <p className="text-text-muted mb-6 max-w-[52ch] leading-relaxed">
            The passphrase encrypts your seed in this browser. You'll enter
            it every time you unlock the wallet. It can't be recovered — if
            you forget it, use the seed phrase above to import the wallet
            again.
          </p>

          <div className="flex flex-col gap-3 mb-4">
            <input
              type="password"
              placeholder="Passphrase (8+ characters)"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="bg-card border border-border rounded-md px-4 py-3 text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
              autoFocus
            />
            <input
              type="password"
              placeholder="Confirm passphrase"
              value={passphraseAgain}
              onChange={(e) => setPassphraseAgain(e.target.value)}
              className="bg-card border border-border rounded-md px-4 py-3 text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
            />
          </div>

          {error && (
            <div className="text-danger text-sm mb-4 font-mono">{error}</div>
          )}

          <div className="flex gap-3">
            <Button
              label={step === 'creating' ? 'Encrypting…' : 'Create wallet'}
              disabled={step === 'creating'}
              onClick={handleCommit}
            />
            <Button
              label="Back"
              variant="ghost"
              onClick={() => setStep('backup')}
              disabled={step === 'creating'}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default CreateWallet;
