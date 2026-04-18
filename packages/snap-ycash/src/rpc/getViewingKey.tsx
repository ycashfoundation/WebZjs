import { UnifiedSpendingKey } from '@chainsafe/webzjs-keys';
import { getSeed } from '../utils/getSeed';
import { Box, Copyable, Divider, Heading, Text } from '@metamask/snaps-sdk/jsx';

type Network = 'main' | 'test';

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

// Note: we deliberately don't wrap this in try/catch. `new UnifiedSpendingKey`
// or `to_sapling_extended_fvk_bytes` can trap the wasm module on unexpected
// input — swallowing that into a generic "Failed to generate Viewing Key"
// hides the real error. Let it propagate so MetaMask surfaces the actual
// RuntimeError to the dapp.

/**
 * Return the Sapling Extended Full Viewing Key (169-byte ZIP-32 encoding),
 * hex-encoded, for the seed held in this snap.
 *
 * Ycash never activated unified addresses, so we deliberately avoid the
 * ZIP-316 UFVK bech32 encoding — librustzcash-ycash panics in
 * `UnifiedFullViewingKey::encode` for Ycash networks. The dapp rebuilds an
 * in-memory sapling-only UFVK from these bytes via
 * `WebWallet.create_account_sapling_efvk` (see SnapSigningBackend).
 *
 * A confirmation dialog is shown to the user before the viewing key leaves
 * the snap sandbox.
 */
export async function getViewingKey(
  origin: string,
  network: Network = 'main',
  accountIndex: number = 0,
): Promise<string> {
  const seed = await getSeed();
  const spendingKey = new UnifiedSpendingKey(network, seed, accountIndex);
  const efvkBytes = spendingKey.to_sapling_extended_fvk_bytes();
  const efvkHex = bytesToHex(efvkBytes);

  const dialogApproved = await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: (
        <Box>
          <Heading>Reveal Viewing Key to {origin}</Heading>
          <Divider />
          <Text>{origin} is requesting the Sapling viewing key for your Ycash wallet.</Text>
          <Text>The viewing key lets the dapp see incoming shielded notes and derive your receive address. It cannot spend funds. The web wallet keeps it only in this browser.</Text>
          <Divider />
          <Copyable value={efvkHex} />
        </Box>
      ),
    },
  });

  if (!dialogApproved) {
    throw new Error('User rejected');
  }

  return efvkHex;
}
