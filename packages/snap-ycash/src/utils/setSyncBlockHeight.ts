// Ycash forked from Zcash at block 570000 (see ycashd/src/chainparams.cpp).
// Any wallet created in the Ycash namespace can only have received funds on
// or after this height, so it is the floor we clamp the user-supplied
// birthday block to.
const YCASH_FORK_HEIGHT = 570000;

export function setSyncBlockHeight(
  userInputCreationBlock: string | null,
  latestBlock: number,
): number {
  //In case input was empty, default to latestBlock
  if (userInputCreationBlock === null) return latestBlock;

  // Check if input is a valid number
  if (!/^\d+$/.test(userInputCreationBlock)) return latestBlock;

  const customBirthdayBlock = Number(userInputCreationBlock);

  // Check if custom block is higher than latest block
  if (customBirthdayBlock > latestBlock) return latestBlock;

  //In case user entered older than acceptable block height
  return customBirthdayBlock > YCASH_FORK_HEIGHT
    ? customBirthdayBlock
    : YCASH_FORK_HEIGHT;
}
