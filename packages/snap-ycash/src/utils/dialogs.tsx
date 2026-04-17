import { Box, Heading, Text, Link } from '@metamask/snaps-sdk/jsx';

export const installDialog = async () => {
  await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'alert',
      content: (
        <Box>
          <Heading>Thank you for installing Ycash Shielded Wallet snap</Heading>
          <Text>
            This snap signs Ycash transactions for the Ycash Web Wallet at{' '}
            <Link href="https://wallet.ycash.xyz/">wallet.ycash.xyz</Link>.
          </Text>
        </Box>
      ),
    },
  });
};
