import { Pczt, WebWallet } from '@chainsafe/webzjs-wallet';

/**
 * Abstraction over "where the spending key lives." The rest of the send flow
 * talks to the active backend through this interface so we can swap the
 * browser-only backend (Phase E2) for a Snap-based backend (Phase E3, once the
 * Ycash-aware snap is rebuilt) without touching the UI layer.
 *
 * `importAccount` takes the freshly-constructed WebWallet and is responsible
 * for populating it with exactly one account (whatever method the backend
 * supports — seed phrase import, UFVK import, hardware wallet, etc.). It
 * returns the account id assigned by WebZjs.
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
   * Apply spend signatures to a PCZT. Returned PCZT is ready to be handed to
   * `WebWallet::pczt_prove` for SNARK generation.
   */
  signPczt(pczt: Pczt): Promise<Pczt>;
}
