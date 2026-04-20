import {
  Box,
  Divider,
  Heading,
  Text,
} from '@metamask/snaps-sdk/jsx';
import { UnifiedSpendingKey } from '@chainsafe/webzjs-keys';
import { getSeed } from '../utils/getSeed';

export interface ProofGenerationKeyBundle {
  /** External-scope Sapling PGK (ak ‖ nsk, 64 bytes) as hex. Used by
   * the Prover when spending notes received at the account's external
   * addresses. */
  externalHex: string;
  /** Internal-scope Sapling PGK as hex. Same layout as `externalHex`.
   * Required whenever the Prover has to prove a spend of a change or
   * shield-self output — the internal ZIP-32 scope has different
   * `(ak, nsk)`, and the Prover / Signer would reject the PCZT
   * otherwise. */
  internalHex: string;
}

/**
 * Return the Sapling proof-generation keys for both ZIP-32 scopes —
 * external (incoming payments) and internal (change, shield-self
 * outputs) — as a hex pair.
 *
 * The dapp needs the PGK to run the PCZT Prover role locally: the snap
 * sandbox can't load the Sapling proving parameters (~50 MB) nor spawn
 * the worker thread the prover uses. PGK leaks nullifier-derivation
 * capability but no spending authority; the snap still owns the seed.
 *
 * Two scopes are returned because after enough self-transfer activity
 * (shield-all, internal change) the wallet's spendable balance can be
 * entirely internal-scope, and the Prover + Signer need the matching
 * `(ak, nsk)` per spend. The dapp decides per-spend which PGK to inject
 * (see `WebWallet::pczt_prove` in crates/webzjs-wallet/src/wallet.rs).
 *
 * We prompt once; both scopes are derived together from the same seed,
 * so a single user approval is sufficient.
 */
export async function getProofGenerationKey(
  origin: string,
): Promise<ProofGenerationKeyBundle> {
  const approved = await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: (
        <Box>
          <Heading>Authorize Sapling proving</Heading>
          <Divider />
          <Text>Origin: {origin}</Text>
          <Text>
            The web wallet is about to prove a Ycash Sapling spend on your
            behalf. Proving needs the Sapling proof-generation keys
            (ak ‖ nsk) for both scopes — external and internal — derived
            from your seed.
          </Text>
          <Text>
            Approving this dialog only lets the web wallet generate the
            zero-knowledge proof; a separate dialog will appear before
            this snap signs the final transaction.
          </Text>
        </Box>
      ),
    },
  });

  if (!approved) {
    throw new Error('User rejected');
  }

  const seed = await getSeed();
  const usk = new UnifiedSpendingKey('main', seed, 0);

  const externalHex = Buffer.from(
    usk.to_sapling_proof_generation_key().to_bytes(),
  ).toString('hex');
  const internalHex = Buffer.from(
    usk.to_sapling_internal_proof_generation_key().to_bytes(),
  ).toString('hex');

  return { externalHex, internalHex };
}
