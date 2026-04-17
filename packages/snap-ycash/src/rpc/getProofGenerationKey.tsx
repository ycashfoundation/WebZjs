import {
  Box,
  Divider,
  Heading,
  Text,
} from '@metamask/snaps-sdk/jsx';
import { UnifiedSpendingKey } from '@chainsafe/webzjs-keys';
import { getSeed } from '../utils/getSeed';

/**
 * Return the Sapling proof-generation key (ak ‖ nsk, 64 bytes) as hex.
 *
 * The dapp needs this to run the PCZT Prover role locally — the snap
 * sandbox can't load the Sapling proving parameters (~50 MB) nor spawn
 * the worker thread the prover uses. PGK leaks nullifier-derivation
 * capability but no spending authority; the snap still owns the seed.
 *
 * We prompt on every call so the user is aware that the dapp is about
 * to run a real Ycash send. For v4 Sapling the Prover must run before
 * the Signer (sighash depends on the Groth16 proofs), so this call will
 * typically be immediately followed by a `signPczt` call in the same
 * transaction flow.
 */
export async function getProofGenerationKey(origin: string): Promise<string> {
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
            behalf. Proving needs the Sapling proof-generation key (ak ‖
            nsk), which is derived from your seed.
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
  const pgk = usk.to_sapling_proof_generation_key();
  const bytes = pgk.to_bytes();

  return Buffer.from(bytes).toString('hex');
}
