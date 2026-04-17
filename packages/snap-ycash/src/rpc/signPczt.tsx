import { Box, Copyable, Divider, Heading, Text } from '@metamask/snaps-sdk/jsx';
import {
  SeedFingerprint,
  UnifiedSpendingKey,
  pczt_sign,
  Pczt,
} from '@chainsafe/webzjs-keys';
import { getSeed } from '../utils/getSeed';
import { SignPcztParams } from '../types';

export async function signPczt(
  { pcztHexString, signDetails }: SignPcztParams,
  origin: string,
): Promise<string> {
  const result = await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: (
        <Box>
          <Heading>Sign Ycash transaction</Heading>
          <Divider />
          <Text>Origin: {origin}</Text>
          <Text>Recipient: {signDetails.recipient}</Text>
          <Text>Amount: {signDetails.amount} YEC</Text>
          <Divider />
          <Text>PCZT hex to sign</Text>
          <Copyable value={pcztHexString} />
        </Box>
      ),
    },
  });

  if (!result) {
    throw new Error('User rejected');
  }

  if (!/^[0-9a-fA-F]+$/.test(pcztHexString)) {
    throw new Error('pcztHexString must be valid hex');
  }

  const seed = await getSeed();

  // 'main' routes to YCASH_MAIN_NETWORK through webzjs-common's Network dispatch,
  // so USK derivation uses Ycash mainnet parameters.
  const spendingKey = new UnifiedSpendingKey('main', seed, 0);
  const seedFp = new SeedFingerprint(seed);

  const pcztBytes = new Uint8Array(Buffer.from(pcztHexString, 'hex'));
  const pczt = Pczt.from_bytes(pcztBytes);

  const pcztSigned = await pczt_sign('main', pczt, spendingKey, seedFp);
  const pcztBytesSigned = pcztSigned.serialize();

  return Buffer.from(pcztBytesSigned).toString('hex');
}
