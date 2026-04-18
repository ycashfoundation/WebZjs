import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SeedFingerprint } from '@chainsafe/webzjs-keys';
import { useSession } from '../context/SessionContext';
import { useWebZjsContext } from '../context/WebzjsContext';
import Button from '../components/Button/Button';

const ImportWallet: React.FC = () => {
  const navigate = useNavigate();
  const { createWallet, status } = useSession();
  const { initWallet } = useWebZjsContext();
  const [mnemonic, setMnemonic] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [passphraseAgain, setPassphraseAgain] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Load wasm so SeedFingerprint.from_seed_phrase is available for validation.
    initWallet();
  }, [initWallet]);

  useEffect(() => {
    if (status === 'locked') navigate('/unlock', { replace: true });
    if (status === 'unlocked')
      navigate('/dashboard/account-summary', { replace: true });
  }, [status, navigate]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    const normalized = mnemonic.trim().replace(/\s+/g, ' ');
    // BIP39 word-count validation via the Rust bindings — any parse failure
    // throws, which we surface as a user-facing error. This avoids re-implementing
    // the BIP39 wordlist check in JS.
    try {
      SeedFingerprint.from_seed_phrase(normalized);
    } catch (err) {
      setError('That does not look like a valid 24-word seed phrase.');
      return;
    }
    if (passphrase.length < 8) {
      setError('Passphrase must be at least 8 characters.');
      return;
    }
    if (passphrase !== passphraseAgain) {
      setError('Passphrases do not match.');
      return;
    }
    setSaving(true);
    try {
      await createWallet(normalized, passphrase);
      navigate('/dashboard/account-summary');
    } catch (err) {
      console.error('createWallet failed:', err);
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-text-dim mb-3">
        Import wallet
      </div>
      <h1 className="text-4xl md:text-5xl font-semibold tracking-tight mb-3">
        Restore from a seed phrase
      </h1>
      <p className="text-text-muted mb-8 max-w-[52ch] leading-relaxed">
        Paste your 24-word seed phrase. It's encrypted on this device with a
        passphrase you choose — nothing is sent to a server.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="card-surface p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-dim mb-2">
            Seed phrase · 24 words
          </div>
          <textarea
            placeholder="word1  word2  word3  …"
            value={mnemonic}
            onChange={(e) => setMnemonic(e.target.value)}
            className="w-full bg-transparent font-mono text-sm text-text placeholder:text-text-dim min-h-[120px] resize-y focus:outline-none leading-relaxed"
            autoFocus
            spellCheck={false}
          />
        </div>
        <input
          type="password"
          placeholder="Passphrase (8+ characters)"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          className="bg-card border border-border rounded-md px-4 py-3 text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
        />
        <input
          type="password"
          placeholder="Confirm passphrase"
          value={passphraseAgain}
          onChange={(e) => setPassphraseAgain(e.target.value)}
          className="bg-card border border-border rounded-md px-4 py-3 text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
        />
        {error && (
          <div className="text-danger text-sm font-mono">{error}</div>
        )}
        <div className="flex gap-3 mt-2">
          <Button
            label={saving ? 'Encrypting…' : 'Import wallet'}
            disabled={saving}
            onClick={() => handleSubmit()}
            type="submit"
          />
          <Button
            label="Back"
            variant="ghost"
            onClick={() => navigate('/')}
            disabled={saving}
          />
        </div>
      </form>
    </div>
  );
};

export default ImportWallet;
