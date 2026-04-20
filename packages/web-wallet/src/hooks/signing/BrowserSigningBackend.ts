import { WebWallet } from '@chainsafe/webzjs-wallet';
import { SigningBackend, ShieldStage } from './SigningBackend';

/**
 * Browser-resident signing backend. Holds a BIP39 mnemonic in memory for
 * the lifetime of the unlocked session. The SQLite-backed wallet fuses
 * `propose_transfer → create_proposed_transactions →
 * send_authorized_transactions` into a single DB-worker op
 * (`send_transfer_from_seed`) so the non-serializable
 * `Proposal<StandardFeeRule, ReceivedNoteId>` never has to cross the
 * actor boundary — see `project_sqlite_step6` in memory for the design
 * note.
 */
export class BrowserSigningBackend implements SigningBackend {
  readonly label = 'browser';

  constructor(
    private readonly mnemonic: string,
    private readonly accountHdIndex: number = 0,
  ) {}

  async importAccount(
    wallet: WebWallet,
    accountName: string,
    birthdayHeight: number,
  ): Promise<number> {
    return wallet.create_account(
      accountName,
      this.mnemonic,
      this.accountHdIndex,
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
    // Takes tens of seconds on a cold page — the caller's UI should
    // render a progress indicator around this call.
    const trimmedMemo = memo?.trim();
    return wallet.send_transfer_from_seed(
      accountId,
      toAddress,
      amountZats,
      this.mnemonic,
      this.accountHdIndex,
      trimmedMemo ? trimmedMemo : undefined,
    );
  }

  async shieldAll(
    wallet: WebWallet,
    accountId: number,
    onStage?: (stage: ShieldStage) => void,
  ): Promise<void> {
    // `wallet.shield` is a single opaque call — we can't split it into PCZT
    // stages, and there's no user approval step (the seed is in memory), so
    // collapse the whole thing into a single "broadcasting" tick.
    onStage?.('broadcasting');
    await wallet.shield(accountId, this.mnemonic, this.accountHdIndex);
    onStage?.('done');
  }
}
