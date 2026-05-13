import { WebWallet, SeedFingerprint } from '@chainsafe/webzjs-wallet';
import { sha256 } from '@noble/hashes/sha256';
import { SigningBackend, ShieldStage } from './SigningBackend';
import type { ApduCallback } from '../ledger/useLedgerTransport';
import type { LedgerViewingMaterial } from '../../context/SessionContext';

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error('Expected even-length hex string');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

/**
 * Reconstruct a 169-byte Sapling `ExtendedFullViewingKey` byte string
 * from the Ledger's `GET_FVK` response (128 bytes: `ak || nk || ovk ||
 * dk`).
 *
 * Layout (matches `librustzcash/zcash_primitives::zip32::sapling::ExtendedFullViewingKey::write`):
 *
 *   depth(1) || parent_fvk_tag(4) || child_index(4 LE) ||
 *   chain_code(32) || ak(32) || nk(32) || ovk(32) || dk(32) = 169 B
 *
 * The Ycash Ledger app derives its sapling key tree from a single
 * non-standard `spk = BLAKE2b("YSaplingSeedHash", tsk)`; there is no
 * ZIP-32 parent or child relationship, so `depth`, `parent_fvk_tag`,
 * `child_index`, and `chain_code` are all zero (see
 * `ycash-ledger-recovery/src/main.rs` for the canonical encoding). The
 * resulting EFVK is functional for Sapling viewing + spending, but it
 * cannot be used to derive ZIP-32 children — which is fine because the
 * device only ever exposes the one leaf.
 */
function synthesizeEfvkBytes(fvkHex: string): Uint8Array {
  const fvk = hexToBytes(fvkHex);
  if (fvk.length !== 128) {
    throw new Error(
      `Ledger GET_FVK response must be 128 bytes (ak||nk||ovk||dk); got ${fvk.length}`,
    );
  }
  const out = new Uint8Array(169);
  // depth(1) + parent_fvk_tag(4) + child_index(4) + chain_code(32) = 41 zero bytes
  out.set(fvk, 41);
  return out;
}

/**
 * Deterministic stand-in for `zip32::SeedFingerprint::from_seed`. The
 * Ledger never exposes the BIP-39 seed, so the canonical fingerprint
 * isn't computable; instead we hash the device's viewing-key material
 * to produce a stable 32-byte tag that identifies *this account on this
 * device*. Used only as the `seed_fp` field on the
 * `Zip32Derivation` metadata stored alongside the imported UFVK — it
 * doesn't participate in any signing operation.
 */
function synthesizeSeedFingerprint(
  fvkHex: string,
  pubkeyHex: string,
): SeedFingerprint {
  const tag = sha256(
    Uint8Array.from([
      ...new TextEncoder().encode('YcashLedgerSeedFingerprintV1\0'),
      ...hexToBytes(fvkHex),
      ...hexToBytes(pubkeyHex),
    ]),
  );
  return SeedFingerprint.from_bytes(tag);
}

/**
 * Signing backend backed by a Ycash Ledger device (Nano S+ "Ycash" app
 * on branch `ycash-display`). The seed lives inside the device's
 * secure element; the host only ever sees viewing-key material and
 * signed PCZTs.
 *
 * Sapling-only. The Ledger Ycash app derives a single transparent leaf
 * at `m/44'/347'/0'/0/0` and returns it as a 33-byte compressed
 * pubkey, with no chain code — so we cannot synthesize a
 * `zcash_transparent::AccountPubKey` that derives the same address as
 * the device. To avoid the footgun of a wallet receiving funds at a
 * transparent address the device doesn't recognize, this backend
 * registers a Sapling-only account via
 * `WebWallet::create_account_sapling_efvk`. Users who need to recover
 * the device's transparent leg must use the standalone
 * `ycash-ledger-recovery` tool.
 *
 * PCZT v4 pipeline (per `WebWallet::pczt_sign_with_ledger`):
 *
 *   1. wallet.pczt_create_for_ledger              (dapp, returns entropy)
 *   2. wallet.pczt_sign_with_ledger(pczt, …, apdu)
 *        ├── device GET_PROOFGEN_KEY              (one device prompt)
 *        ├── wallet.pczt_prove (Groth16, in-worker)
 *        ├── device APDU pipeline (T_IN…SIGN)     (per-output prompts)
 *        ├── host-vs-device sighash cross-check
 *        └── apply spend + transparent sigs
 *   3. wallet.pczt_send                           (broadcasts)
 */
export class LedgerSigningBackend implements SigningBackend {
  readonly label = 'ledger';

  constructor(
    private readonly viewing: LedgerViewingMaterial,
    private readonly apdu: ApduCallback,
    /**
     * Open the WebHID transport (no-op if already connected). Must run
     * from a user gesture the first time around, which is why the
     * backend takes a callback rather than auto-connecting in the
     * constructor — the click handler that calls `sendShielded`
     * satisfies the gesture requirement.
     */
    private readonly ensureConnected: () => Promise<void>,
  ) {}

  async importAccount(
    wallet: WebWallet,
    accountName: string,
    birthdayHeight: number,
  ): Promise<number> {
    const efvk = synthesizeEfvkBytes(this.viewing.fvkHex);
    const fingerprint = synthesizeSeedFingerprint(
      this.viewing.fvkHex,
      this.viewing.pubkeyHex,
    );
    return wallet.create_account_sapling_efvk(
      accountName,
      efvk,
      fingerprint,
      0,
      birthdayHeight,
    );
  }

  async sendShielded(
    wallet: WebWallet,
    accountId: number,
    toAddress: string,
    amountZats: bigint,
    memo?: string,
  ): Promise<Uint8Array> {
    // Make sure the device is reachable before we spend cycles on
    // proposing + proving — saves a 30-second prover round-trip if the
    // user forgot to plug in the Ledger.
    await this.ensureConnected();

    // Build the unsigned, unproven PCZT and the bundle-order entropy
    // the device needs to reproduce host-side `alpha` and `rseed`.
    const trimmedMemo = memo?.trim();
    const memoArg = trimmedMemo ? trimmedMemo : undefined;
    const forLedger = await wallet.pczt_create_for_ledger(
      accountId,
      toAddress,
      amountZats,
      memoArg,
    );
    const spendAlphas = forLedger.spendAlphas;
    const outputRseeds = forLedger.outputRseeds;
    const unsigned = forLedger.takePczt();

    // Drive the device through prove + sign. The wasm side fetches
    // the device's PGK, runs Groth16 in the DB worker, walks the
    // v4/ZIP-243 state machine, and cross-checks the device sighash
    // against the host-computed one before applying signatures.
    const signed = await wallet.pczt_sign_with_ledger(
      unsigned,
      spendAlphas,
      outputRseeds,
      this.apdu,
    );

    // Broadcast. The Extractor inside `pczt_send` applies the binding
    // signature; nothing more for the host to do.
    await wallet.pczt_send(signed);
    return new Uint8Array();
  }

  async shieldAll(
    _wallet: WebWallet,
    _accountId: number,
    _onStage?: (stage: ShieldStage) => void,
  ): Promise<void> {
    // The device exposes a single transparent leaf and no chain code,
    // so the wallet never tracks a transparent receiver for Ledger
    // accounts (see the class doc). Shielding from that leaf is only
    // possible by importing the WIF into a wallet that has full key
    // material — `ycash-ledger-recovery` is the supported path.
    throw new Error(
      'Shielding is not supported for Ledger accounts. The device only exposes a single transparent leaf with no chain code, so the wallet cannot track transparent UTXOs at that address. To move transparent funds, export them via the ycash-ledger-recovery tool and import the WIF into Ywallet.',
    );
  }
}
