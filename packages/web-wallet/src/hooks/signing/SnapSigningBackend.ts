import {
  WebWallet,
  SeedFingerprint,
  ProofGenerationKey,
  Pczt,
} from '@chainsafe/webzjs-wallet';
import { SigningBackend } from './SigningBackend';

/**
 * Invoke one of the Ycash snap's RPC methods. Supplied by `useSigningBackend`
 * so this module doesn't have to know about the MetaMask provider plumbing.
 */
export type InvokeSnap = <T = unknown>(
  method: string,
  params?: Record<string, unknown>,
) => Promise<T>;

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

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/**
 * Signing backend backed by the Ycash MetaMask snap (`packages/snap-ycash`).
 * The BIP39 seed lives entirely inside the snap sandbox.
 *
 * PCZT v4 pipeline (Ycash never activated NU5, so every shielded send is v4):
 *
 *   1. wallet.pczt_create                                 (dapp, no key material)
 *   2. snap.getProofGenerationKey        → pgk-hex        (one MetaMask dialog)
 *   3. wallet.pczt_prove(pczt, pgk)                       (dapp, CPU-bound Groth16)
 *   4. snap.signPczt(pcztHex)            → signed-pcztHex (one more MetaMask dialog)
 *   5. wallet.pczt_send(pczt)                             (dapp, broadcasts)
 *
 * For v4 the Prover must run BEFORE the Signer because ZIP-243 sighash
 * depends on the Sapling Groth16 proof bytes. This is opposite of the
 * v5 convention and the only subtle ordering rule in this flow.
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
    const fingerprint = SeedFingerprint.from_bytes(hexToBytes(fingerprintHex));

    return wallet.create_account_ufvk(
      accountName,
      encodedUfvk,
      fingerprint,
      0,
      birthdayHeight,
    );
  }

  /**
   * Fetch the Sapling proof-generation key from the snap. The snap prompts
   * the user before releasing it; the returned object carries ak ‖ nsk in a
   * form the wasm Prover can consume.
   */
  private async fetchProofGenerationKey(): Promise<ProofGenerationKey> {
    const pgkHex = await this.invokeSnap<string>('getProofGenerationKey');
    if (!/^[0-9a-fA-F]{128}$/.test(pgkHex)) {
      throw new Error(
        `Snap returned an invalid proof-generation key (expected 64 bytes hex): ${pgkHex}`,
      );
    }
    return ProofGenerationKey.from_bytes(hexToBytes(pgkHex));
  }

  private async signPcztInSnap(
    pczt: Pczt,
    recipient: string,
    amount: string,
  ): Promise<Pczt> {
    const pcztHex = bytesToHex(pczt.serialize());
    const signedHex = await this.invokeSnap<string>('signPczt', {
      pcztHexString: pcztHex,
      signDetails: { recipient, amount },
    });
    if (!/^[0-9a-fA-F]+$/.test(signedHex)) {
      throw new Error('Snap returned non-hex PCZT');
    }
    return Pczt.from_bytes(hexToBytes(signedHex));
  }

  async sendShielded(
    wallet: WebWallet,
    accountId: number,
    toAddress: string,
    amountZats: bigint,
  ): Promise<Uint8Array> {
    // 1. Create the unsigned, unproven PCZT from the active account.
    const unsigned = await wallet.pczt_create(accountId, toAddress, amountZats);

    // 2. Ask the snap for the Sapling PGK (user approval #1).
    const pgk = await this.fetchProofGenerationKey();

    // 3. Prove locally. pczt_prove injects the PGK into each non-dummy
    //    spend, then runs Groth16 in a spawned worker.
    const proven = await wallet.pczt_prove(unsigned, pgk);

    // 4. Snap signs using its USK (user approval #2). For v4, sighash is
    //    computed over the proofs we just inserted.
    const amountYec = (Number(amountZats) / 1e8).toString();
    const signed = await this.signPcztInSnap(proven, toAddress, amountYec);

    // 5. Broadcast. send() returns void; we return an empty marker to
    //    match the SigningBackend interface (the classic path returns the
    //    32-byte txid bytes, but PCZT's pczt_send doesn't surface those).
    await wallet.pczt_send(signed);
    return new Uint8Array();
  }

  async shieldAll(wallet: WebWallet, accountId: number): Promise<void> {
    // pczt_shield is the PCZT-shaped counterpart to wallet.shield(): it
    // proposes "shield every transparent UTXO into Sapling" and returns
    // the unsigned PCZT. From there the flow is identical to sendShielded.
    const unsigned = await wallet.pczt_shield(accountId);
    const pgk = await this.fetchProofGenerationKey();
    const proven = await wallet.pczt_prove(unsigned, pgk);
    const signed = await this.signPcztInSnap(
      proven,
      '(shield to Sapling)',
      '(all transparent)',
    );
    await wallet.pczt_send(signed);
  }
}
