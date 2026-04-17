import { WebWallet, SeedFingerprint } from '@chainsafe/webzjs-wallet';
import { SigningBackend } from './SigningBackend';

/**
 * Invoke one of the Ycash snap's RPC methods. Supplied by `useSigningBackend`
 * so this module doesn't have to know about the MetaMask provider plumbing.
 */
export type InvokeSnap = <T = unknown>(
  method: string,
  params?: Record<string, unknown>,
) => Promise<T>;

/**
 * Signing backend backed by the Ycash MetaMask snap (`packages/snap-ycash`).
 * The seed lives entirely inside the snap sandbox — this class only knows
 * how to issue RPC calls across the snap boundary.
 *
 * E3.1 scope: account import via UFVK + seed fingerprint (one round-trip).
 * Once the snap approves the two dialogs, the resulting account is a
 * "spending-authority via UFVK" account: the wallet can sync, scan, and
 * show balances without ever seeing the seed.
 *
 * E3.2 will wire sendShielded / shieldAll through the PCZT pipeline:
 *   wallet.pczt_create → wallet.pczt_prove(pczt, pgk-from-snap)
 *     → snap.signPczt(pczt-hex) → wallet.pczt_send
 * The prover needs the Sapling proof-generation key; that requires a new
 * `getProofGenerationKey` snap RPC + `ProofGenerationKey::to_bytes/from_bytes`
 * in webzjs-keys, which is tracked separately.
 */
export class SnapSigningBackend implements SigningBackend {
  readonly label = 'snap';

  constructor(private readonly invokeSnap: InvokeSnap) {}

  async importAccount(
    wallet: WebWallet,
    accountName: string,
    birthdayHeight: number,
  ): Promise<number> {
    const [encodedUfvk, fingerprintHex] = await Promise.all([
      this.invokeSnap<string>('getViewingKey'),
      this.invokeSnap<string>('getSeedFingerprint'),
    ]);
    if (typeof encodedUfvk !== 'string' || encodedUfvk.length === 0) {
      throw new Error('Snap did not return a Unified Full Viewing Key');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(fingerprintHex)) {
      throw new Error(
        `Snap returned an invalid seed fingerprint: ${fingerprintHex}`,
      );
    }
    const fingerprintBytes = new Uint8Array(
      fingerprintHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)),
    );
    const fingerprint = SeedFingerprint.from_bytes(fingerprintBytes);

    return wallet.create_account_ufvk(
      accountName,
      encodedUfvk,
      fingerprint,
      0,
      birthdayHeight,
    );
  }

  async sendShielded(
    _wallet: WebWallet,
    _accountId: number,
    _toAddress: string,
    _amountZats: bigint,
  ): Promise<Uint8Array> {
    throw new Error(
      'Snap-based shielded send is pending Phase E3.2. The snap can sign ' +
        'PCZTs but proving requires a ProofGenerationKey export RPC that ' +
        'is not yet implemented. Use the browser signing backend in the ' +
        'meantime.',
    );
  }

  async shieldAll(_wallet: WebWallet, _accountId: number): Promise<void> {
    throw new Error(
      'Snap-based shield is pending Phase E3.2 (same PGK plumbing as ' +
        'sendShielded). Use the browser signing backend for now.',
    );
  }
}
