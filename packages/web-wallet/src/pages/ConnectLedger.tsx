import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sha256 } from '@noble/hashes/sha256';
import { useSession } from '../context/SessionContext';
import { useLedgerTransport } from '../hooks/ledger/useLedgerTransport';
import Button from '../components/Button/Button';
import Loader from '../components/Loader/Loader';
import { YCASH_FORK_HEIGHT } from '../config/constants';

/**
 * Ledger device APDU bytes for `GET_FVK` (CLA 0xE0, INS 0x07, P1/P2/Lc = 0).
 * Returns 128 bytes: `ak(32) || nk(32) || ovk(32) || dk(32)`.
 */
const APDU_GET_FVK = new Uint8Array([0xe0, 0x07, 0x00, 0x00, 0x00]);

/**
 * Ledger device APDU bytes for `GET_PUBKEY` (CLA 0xE0, INS 0x06).
 * Returns 33 bytes: compressed secp256k1 pubkey of the transparent leaf
 * at `m/44'/347'/0'/0/0`.
 */
const APDU_GET_PUBKEY = new Uint8Array([0xe0, 0x06, 0x00, 0x00, 0x00]);

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function stripStatusWord(resp: Uint8Array): {
  payload: Uint8Array;
  sw: number;
} {
  if (resp.length < 2) {
    throw new Error(
      `Ledger response too short (${resp.length} bytes — expected status word)`,
    );
  }
  const sw =
    (resp[resp.length - 2] << 8) | resp[resp.length - 1];
  return { payload: resp.slice(0, resp.length - 2), sw };
}

interface DeviceMaterial {
  fvkHex: string;
  pubkeyHex: string;
}

/**
 * Ledger onboarding page. Drives the Ycash Ledger app through the two
 * unprivileged read APDUs (`GET_FVK`, `GET_PUBKEY`), surfaces the
 * non-standard sapling derivation disclosure, and commits the
 * `'ledger'` backend choice once the user confirms.
 *
 * Address verification on the dashboard. The Sapling default address
 * ys1… is computed by the wasm wallet only after account import (the
 * device keys themselves don't encode a payment address — that's an
 * FF1-AES diversifier search away). Onboarding here commits the
 * viewing material; the Dashboard's first-run verification banner
 * walks the user through pressing **Get Address** on the device and
 * comparing it to what the wallet derived.
 */
const ConnectLedger: React.FC = () => {
  const navigate = useNavigate();
  const { status, chooseLedgerBackend } = useSession();
  const ledger = useLedgerTransport();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [material, setMaterial] = useState<DeviceMaterial | null>(null);
  const [recoverOlder, setRecoverOlder] = useState(false);
  const [birthdayInput, setBirthdayInput] = useState('');
  const [ackDerivation, setAckDerivation] = useState(false);

  // Skip past the onboarding screen if the session is already unlocked.
  useEffect(() => {
    if (status === 'unlocked')
      navigate('/dashboard/account-summary', { replace: true });
  }, [status, navigate]);

  // First step: open WebHID + ask the device for the viewing keys. Must
  // run inside a click handler so WebHID will accept the permission
  // prompt.
  const handleConnect = async () => {
    setError(null);
    setBusy(true);
    try {
      await ledger.connect();
      const fvkResp = await ledger.apdu(APDU_GET_FVK);
      const { payload: fvkPayload, sw: fvkSw } = stripStatusWord(fvkResp);
      if (fvkSw !== 0x9000) {
        throw new Error(
          `Ledger GET_FVK returned status 0x${fvkSw.toString(16).padStart(4, '0')}. Make sure the Ycash app is open on the device.`,
        );
      }
      if (fvkPayload.length !== 128) {
        throw new Error(
          `Ledger GET_FVK returned ${fvkPayload.length} bytes, expected 128. The firmware may not match the supported Ycash app build.`,
        );
      }
      const pubResp = await ledger.apdu(APDU_GET_PUBKEY);
      const { payload: pubPayload, sw: pubSw } = stripStatusWord(pubResp);
      if (pubSw !== 0x9000) {
        throw new Error(
          `Ledger GET_PUBKEY returned status 0x${pubSw.toString(16).padStart(4, '0')}.`,
        );
      }
      if (pubPayload.length !== 33) {
        throw new Error(
          `Ledger GET_PUBKEY returned ${pubPayload.length} bytes, expected 33.`,
        );
      }
      setMaterial({
        fvkHex: bytesToHex(fvkPayload),
        pubkeyHex: bytesToHex(pubPayload),
      });
    } catch (err) {
      console.error('Connect Ledger failed:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Could not read viewing keys from the Ledger.',
      );
    } finally {
      setBusy(false);
    }
  };

  // Second step: user has reviewed the disclosure and clicks Continue.
  // Persist the viewing material + backend choice and let Dashboard
  // take over.
  const handleCommit = async () => {
    if (!material) return;
    setError(null);
    let birthdayHeight: number | undefined;
    if (recoverOlder) {
      const parsed = Number.parseInt(birthdayInput, 10);
      if (
        !Number.isFinite(parsed) ||
        String(parsed) !== birthdayInput.trim() ||
        parsed < YCASH_FORK_HEIGHT
      ) {
        setError(
          `Enter a whole block height ≥ ${YCASH_FORK_HEIGHT} (Ycash fork height).`,
        );
        return;
      }
      birthdayHeight = parsed;
    }
    setBusy(true);
    try {
      await chooseLedgerBackend(material, birthdayHeight);
      // Navigation handled by the effect above once status flips.
    } catch (err) {
      console.error('Commit ledger backend failed:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to register the Ledger backend.',
      );
      setBusy(false);
    }
  };

  if (status === 'unknown') {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader />
      </div>
    );
  }

  // Short device-key fingerprint (sha256 prefix). Lets the user sanity
  // check that re-onboarding the same device produces the same tag,
  // and that two distinct devices look different. Not a substitute for
  // the on-device address verification.
  const fingerprint =
    material &&
    bytesToHex(
      sha256(
        Uint8Array.from([
          ...hexToBytesLocal(material.fvkHex),
          ...hexToBytesLocal(material.pubkeyHex),
        ]),
      ).slice(0, 4),
    );

  return (
    <div className="max-w-xl mx-auto px-6 py-16">
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-text-dim mb-3">
        Hardware signing
      </div>
      <h1 className="text-4xl font-semibold tracking-tight mb-3">
        Connect Ledger
      </h1>
      <p className="text-text-muted mb-8 leading-relaxed">
        The Ycash Ledger app keeps your seed inside the device's secure
        element. This page never sees the seed phrase — every signing
        operation prompts you to approve it on the device.
      </p>

      {!ledger.supported && (
        <div className="card-surface p-4 mb-6 border-danger/40">
          <div className="flex items-center gap-2 mb-2">
            <span className="pill" style={{ color: 'var(--color-danger)' }}>
              unsupported
            </span>
          </div>
          <p className="text-sm text-text-muted leading-relaxed">
            WebHID isn't available in this browser. Use Chrome, Edge, Brave,
            or another Chromium-based browser to connect a Ledger.
          </p>
        </div>
      )}

      {ledger.supported && !material && (
        <div className="card-surface p-5 mb-6">
          <ol className="list-decimal pl-5 text-sm text-text-muted leading-relaxed space-y-1.5 mb-5">
            <li>Plug in your Ledger Nano S+ via USB.</li>
            <li>Unlock the device with its PIN.</li>
            <li>Open the <strong className="text-text">Ycash</strong> app on the device.</li>
            <li>
              Click Connect below and pick your Ledger in the browser dialog.
            </li>
          </ol>
          <Button
            label={busy ? 'Connecting…' : 'Connect Ledger'}
            onClick={handleConnect}
            disabled={busy}
          />
        </div>
      )}

      {material && (
        <>
          <div className="card-surface p-5 mb-6 border-accent/30">
            <div className="flex items-center gap-2 mb-2">
              <span className="pill pill-accent">connected</span>
            </div>
            <p className="text-sm text-text-muted leading-relaxed mb-3">
              Ycash viewing keys received from the device. Device
              fingerprint:
            </p>
            <div className="font-mono text-sm bg-surface border border-border rounded-md px-3 py-2 text-text break-all">
              {fingerprint}
            </div>
            <p className="text-xs text-text-dim mt-2 leading-relaxed">
              You'll verify the full <code>ys1…</code> address on the next
              screen by pressing <strong>Get Address</strong> on the device
              and comparing.
            </p>
          </div>

          <div className="card-surface p-5 mb-6 border-ycash/30">
            <div className="flex items-center gap-2 mb-2">
              <span className="pill pill-ycash">important</span>
            </div>
            <p className="text-sm text-text-muted leading-relaxed mb-2">
              <strong className="text-text">
                The Ycash Ledger app uses a non-standard sapling derivation.
              </strong>
            </p>
            <p className="text-sm text-text-muted leading-relaxed mb-2">
              Funds received at the device's <code>ys1…</code> address are
              <strong className="text-text">
                {' '}NOT recoverable
              </strong>{' '}
              from the 24-word seed phrase via Ywallet, zecwallet, or any
              standard ZIP-32 wallet. The device wraps a BIP-32 child of{' '}
              <code>m/44'/347'/0'/0/0</code> with{' '}
              <code>BLAKE2b("YSaplingSeedHash", …)</code> before running
              ZIP-32 expansion — the extra hash means standard wallets land
              on a different sapling key tree.
            </p>
            <p className="text-sm text-text-muted leading-relaxed mb-3">
              The only path back to your sapling funds without the device is
              the <code>ycash-ledger-recovery</code> tool, which reproduces
              this derivation from the 24-word seed. Make sure you have
              access to that tool and your seed before depositing any
              meaningful amount.
            </p>
            <label className="flex items-start gap-3 cursor-pointer pt-3 border-t border-border">
              <input
                type="checkbox"
                checked={ackDerivation}
                onChange={(e) => setAckDerivation(e.target.checked)}
                className="mt-1 accent-accent"
              />
              <span className="text-sm text-text">
                I understand and accept the non-standard derivation and
                recovery requirements.
              </span>
            </label>
          </div>

          <div className="card-surface p-5 mb-6">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={recoverOlder}
                onChange={(e) => setRecoverOlder(e.target.checked)}
                className="mt-1 accent-accent"
              />
              <span className="flex-1">
                <span className="text-sm font-medium text-text">
                  Recover an older wallet?
                </span>
                <span className="block text-text-muted text-xs mt-1 leading-relaxed">
                  By default the wallet syncs from the current chain tip.
                  Enable this if you've used this Ledger before and want to
                  see earlier transactions.
                </span>
              </span>
            </label>
            {recoverOlder && (
              <div className="mt-4 pt-4 border-t border-border flex flex-col gap-1.5">
                <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
                  Birthday block · min {YCASH_FORK_HEIGHT}
                </label>
                <input
                  type="number"
                  value={birthdayInput}
                  onChange={(e) => setBirthdayInput(e.target.value)}
                  placeholder="e.g. 2859770"
                  min={YCASH_FORK_HEIGHT}
                  className="bg-surface border border-border rounded-md px-3 py-2 text-text placeholder:text-text-dim font-mono text-sm focus:border-accent focus:outline-none"
                />
              </div>
            )}
          </div>
        </>
      )}

      {error && (
        <div className="text-danger text-sm font-mono mb-4">{error}</div>
      )}

      <div className="flex gap-3">
        {material ? (
          <Button
            label={busy ? 'Committing…' : 'Continue'}
            onClick={handleCommit}
            disabled={busy || !ackDerivation}
          />
        ) : null}
        <Button
          label="Back"
          variant="ghost"
          onClick={() => navigate('/', { replace: true })}
          disabled={busy}
        />
      </div>

      <div className="mt-12 pt-6 border-t border-border font-mono text-[11px] uppercase tracking-[0.15em] text-text-dim leading-loose">
        Receive at both ys1 (sapling) and s1 (transparent). Shielding
        s1 funds into the sapling pool is driven through the device.
        Sending transparent → external transparent addresses is not
        wired up yet.
      </div>
    </div>
  );
};

/** Local copy of hexToBytes — duplicated to avoid a cross-module import
 * just for one helper. */
function hexToBytesLocal(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

export default ConnectLedger;
