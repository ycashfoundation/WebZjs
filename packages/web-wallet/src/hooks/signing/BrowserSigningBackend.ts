import { Pczt, WebWallet } from '@chainsafe/webzjs-wallet';
import {
  SeedFingerprint,
  UnifiedSpendingKey,
  pczt_sign,
} from '@chainsafe/webzjs-keys';
import { SigningBackend } from './SigningBackend';

/**
 * Browser-resident signing backend. Holds a BIP39 mnemonic in memory for the
 * lifetime of the unlocked session; derives a fresh USK + SeedFingerprint
 * on each sign call rather than caching them, so nothing that persists past
 * a React remount outlives the unlock state.
 *
 * The mnemonic itself should be loaded by decrypting the passphrase-encrypted
 * seed vault (see `utils/seedVault.ts`). Instances of this class should be
 * discarded when the user locks the wallet.
 */
export class BrowserSigningBackend implements SigningBackend {
  readonly label = 'browser';

  constructor(
    private readonly network: 'main' | 'test',
    private readonly mnemonic: string,
    private readonly accountHdIndex: number = 0,
  ) {}

  async importAccount(
    wallet: WebWallet,
    accountName: string,
    birthdayHeight: number,
  ): Promise<number> {
    // Seed-phrase import is the path that already works on Ycash — it skips
    // the UFVK encoding that would panic, and lets the Rust side do a single
    // mnemonic→USK→UFVK→import in-process without ever surfacing a UA.
    return wallet.create_account(
      accountName,
      this.mnemonic,
      this.accountHdIndex,
      birthdayHeight,
    );
  }

  async signPczt(pczt: Pczt): Promise<Pczt> {
    const usk = UnifiedSpendingKey.from_seed_phrase(
      this.network,
      this.mnemonic,
      this.accountHdIndex,
    );
    const seedFp = SeedFingerprint.from_seed_phrase(this.mnemonic);
    return pczt_sign(this.network, pczt, usk, seedFp);
  }
}
