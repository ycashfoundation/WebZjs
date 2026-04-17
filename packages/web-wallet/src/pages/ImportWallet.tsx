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
    if (status === 'unlocked') navigate('/dashboard/account-summary', { replace: true });
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
      setError('That does not look like a valid BIP39 seed phrase.');
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
    <div className="max-w-2xl mx-auto px-4 py-12">
      <h1 className="text-4xl font-semibold mb-2">Import a Ycash Wallet</h1>
      <p className="text-neutral-600 mb-8">
        Paste your 24-word BIP39 seed phrase. The seed will be encrypted on
        this device with a passphrase you choose; nothing is sent to a server.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <textarea
          placeholder="word1 word2 word3 …"
          value={mnemonic}
          onChange={(e) => setMnemonic(e.target.value)}
          className="border border-neutral-300 rounded-xl px-4 py-3 font-mono min-h-[120px]"
          autoFocus
          spellCheck={false}
        />
        <input
          type="password"
          placeholder="Passphrase (8+ characters)"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          className="border border-neutral-300 rounded-xl px-4 py-3"
        />
        <input
          type="password"
          placeholder="Confirm passphrase"
          value={passphraseAgain}
          onChange={(e) => setPassphraseAgain(e.target.value)}
          className="border border-neutral-300 rounded-xl px-4 py-3"
        />
        {error && <div className="text-red-600 text-sm">{error}</div>}
        <Button
          label={saving ? 'Encrypting…' : 'Import Wallet'}
          disabled={saving}
          onClick={() => handleSubmit()}
          type="submit"
        />
      </form>
    </div>
  );
};

export default ImportWallet;
