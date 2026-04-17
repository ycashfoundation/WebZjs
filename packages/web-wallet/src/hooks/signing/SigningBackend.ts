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
   */
  sendShielded(
    wallet: WebWallet,
    accountId: number,
    toAddress: string,
    amountZats: bigint,
  ): Promise<Uint8Array>;

  /**
   * Shield every transparent UTXO for `accountId` into the Sapling pool.
   * Resolves when the shielding transaction has been broadcast.
   */
  shieldAll(wallet: WebWallet, accountId: number): Promise<void>;
}
