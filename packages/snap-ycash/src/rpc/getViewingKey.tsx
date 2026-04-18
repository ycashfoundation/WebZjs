import { UnifiedSpendingKey } from '@chainsafe/webzjs-keys';
import { getSeed } from '../utils/getSeed';
import { Box, Copyable, Divider, Heading, Text } from '@metamask/snaps-sdk/jsx';

type Network = 'main' | 'test';

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export interface ViewingKeyBundle {
  /** Sapling ExtendedFullViewingKey, 169-byte ZIP-32 encoding, hex. */
  saplingEfvkHex: string;
  /** Transparent AccountPubKey, 65 bytes (chain code ‖ compressed pubkey), hex. */
  transparentAccountPubkeyHex: string;
}

// Note: we deliberately don't wrap this in try/catch. `new UnifiedSpendingKey`
// or the viewing-key serializers can trap the wasm module on unexpected
// input — swallowing that into a generic "Failed to generate Viewing Key"
// hides the real error. Let it propagate so MetaMask surfaces the actual
// RuntimeError to the dapp.

/**
 * Return both halves of the account's viewing key — Sapling EFVK and
 * transparent AccountPubKey — hex-encoded, for the seed held in this snap.
 *
 * Ycash never activated unified addresses, so we deliberately avoid the
 * ZIP-316 UFVK bech32 encoding — librustzcash-ycash panics in
 * `UnifiedFullViewingKey::encode` for Ycash networks. The dapp rebuilds the
 * in-memory UFVK from these two blobs via
 * `WebWallet.create_account_full_efvk` (see SnapSigningBackend).
 *
 * Returning both halves lets the dapp derive Sapling receive addresses AND
 * transparent receive addresses for the same account, so shieldAll and
 * transparent-receive flows work on snap-backed wallets. The transparent
 * half is a view-only xpub — it cannot spend.
 *
 * A confirmation dialog is shown to the user before the viewing key leaves
 * the snap sandbox.
 */
export async function getViewingKey(
  origin: string,
  network: Network = 'main',
  accountIndex: number = 0,
): Promise<ViewingKeyBundle> {
  const seed = await getSeed();
  const spendingKey = new UnifiedSpendingKey(network, seed, accountIndex);
  const saplingEfvkHex = bytesToHex(spendingKey.to_sapling_extended_fvk_bytes());
  const transparentAccountPubkeyHex = bytesToHex(
    spendingKey.to_transparent_account_pubkey_bytes(),
  );

  const dialogApproved = await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: (
        <Box>
          <Heading>Reveal Viewing Keys to {origin}</Heading>
          <Divider />
          <Text>
            {origin} is requesting the Sapling and transparent viewing keys
            for your Ycash wallet.
          </Text>
          <Text>
            These let the dapp see incoming shielded notes, derive your
            receive addresses (both shielded and transparent), and shield
            transparent balances into the Sapling pool. They cannot spend
            funds. The web wallet keeps them only in this browser.
          </Text>
          <Divider />
          <Text>Sapling ExtendedFullViewingKey (hex):</Text>
          <Copyable value={saplingEfvkHex} />
          <Text>Transparent AccountPubKey (hex):</Text>
          <Copyable value={transparentAccountPubkeyHex} />
        </Box>
      ),
    },
  });

  if (!dialogApproved) {
    throw new Error('User rejected');
  }

  return { saplingEfvkHex, transparentAccountPubkeyHex };
}
