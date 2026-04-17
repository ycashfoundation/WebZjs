import { WebWallet } from '@chainsafe/webzjs-wallet';
import { SigningBackend } from './SigningBackend';

/**
 * Browser-resident signing backend. Holds a BIP39 mnemonic in memory for the
 * lifetime of the unlocked session. Uses WebZjs's one-shot
 * `propose_transfer → create_proposed_transactions → send_authorized_transactions`
 * pipeline rather than PCZT — that classic path bundles build, prove, and
 * sign into a single call that takes the seed phrase directly, which is
 * exactly what we want when the seed lives in-process anyway.
 *
 * The non-PCZT path is also the only path that currently works on Ycash:
 * the PCZT Signer and IoFinalizer roles don't support v4 Sapling
 * transactions (upstream pczt uses `EffectsOnly` which can't compute a
 * ZIP-243 sighash without real Groth16 proof bytes).
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
  ): Promise<Uint8Array> {
    const proposal = await wallet.propose_transfer(
      accountId,
      toAddress,
      amountZats,
    );
    // `create_proposed_transactions` spawns a worker internally for the
    // Groth16 proving step and can take tens of seconds on a cold page —
    // the caller's UI should render a progress indicator around this call.
    const txids = await wallet.create_proposed_transactions(
      proposal,
      this.mnemonic,
      this.accountHdIndex,
    );
    await wallet.send_authorized_transactions(txids);
    return txids;
  }
}
