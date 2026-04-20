import { WebWallet } from '@chainsafe/webzjs-wallet';

/**
 * Abstraction over "where the spending key lives." The rest of the send flow
 * talks to the active backend through this interface so we can swap the
 * browser-only backend (Phase E2) for a Snap-based backend (Phase E3, once the
 * Ycash-aware snap is rebuilt) without touching the UI layer.
 *
 * The interface is deliberately high-level — `sendShielded` covers the full
 * propose → build → prove → sign → broadcast pipeline in one call — because
 * the two concrete backends split the pipeline very differently:
 *
 * - `BrowserSigningBackend` holds the seed phrase in memory and uses
 *   `WebWallet::create_proposed_transactions` (classic one-shot build) rather
 *   than PCZT. PCZT's `EffectsOnly` proxy authorization can't compute the
 *   ZIP-243 (v4) sighash that Ycash requires, so the PCZT pipeline is a
 *   no-go until upstream adds v4 Sapling support.
 * - `SnapSigningBackend` (future) would keep the seed inside the snap and
 *   use PCZT (`pczt_create` → snap sign → `pczt_prove` → `pczt_send`) because
 *   that's the only way the snap boundary makes sense.
 */
export interface SigningBackend {
  /** Human-readable tag used in logs and diagnostics. */
  readonly label: string;

  /**
   * Create an account on the given wallet, using whatever credentials the
   * backend holds. Returns the assigned account id.
   */
  importAccount(
    wallet: WebWallet,
    accountName: string,
    birthdayHeight: number,
  ): Promise<number>;

  /**
   * Build, authorize, and broadcast a shielded transfer to `toAddress` for
   * `amountZats` Zatoshis. Returns the flattened 32-byte-per-txid bytes that
   * `WebWallet::send_authorized_transactions` yields.
   *
   * `memo`, when non-empty, is attached to the Sapling output as a ZIP-302
   * text memo. Only valid for shielded recipients; passing a memo to a
   * transparent address rejects in the Rust layer with
   * `UnsupportedMemoRecipient`.
   */
  sendShielded(
    wallet: WebWallet,
    accountId: number,
    toAddress: string,
    amountZats: bigint,
    memo?: string,
  ): Promise<Uint8Array>;

  /**
   * Shield every transparent UTXO for `accountId` into the Sapling pool.
   * Resolves when the shielding transaction has been broadcast.
   *
   * An optional `onStage` callback fires between each pipeline step so the
   * caller can render step-by-step status (especially useful for the Snap
   * path, where two of the stages require the user to approve a prompt in
   * MetaMask and "Signing locally" is indistinguishable from "Waiting for
   * MetaMask" without this hook).
   */
  shieldAll(
    wallet: WebWallet,
    accountId: number,
    onStage?: (stage: ShieldStage) => void,
  ): Promise<void>;
}

/**
 * Coarse stages in the shield pipeline. Exposed so the UI can render a
 * step-by-step indicator without having to know the PCZT internals.
 *
 * The two `awaiting-*` stages are where the user must click "approve" in
 * MetaMask — label them explicitly so the UI can nudge them instead of
 * showing a generic spinner while MetaMask is modally blocking.
 */
export type ShieldStage =
  | 'creating'
  | 'awaiting-pgk'
  | 'proving'
  | 'awaiting-sig'
  | 'broadcasting'
  | 'done';
