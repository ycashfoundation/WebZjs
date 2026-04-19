// Override via LIGHTWALLETD_PROXY env var for local dev (e.g. in .env.local).
// Default targets the Ycash Foundation's lightwalletd, which is served with
// gRPC-Web directly (no proxy needed — see packages/ycash-smoke for the
// end-to-end sync canary). For a ZEC build, swap in a Zcash lightwalletd
// proxy URL via the env var.
export const MAINNET_LIGHTWALLETD_PROXY = process.env.LIGHTWALLETD_PROXY || 'https://lite.ycash.xyz';
export const ZATOSHI_PER_YEC = 1e8;
export const RESCAN_INTERVAL = 35000;          // 35s sync interval
// Ycash forked from Zcash at this height (see ycashd/src/chainparams.cpp).
// Pre-fork Sapling notes on the shared history are addressable, but for a
// fresh Ycash wallet this is the minimum sensible birthday.
export const YCASH_FORK_HEIGHT = 570000;

// Minimum transparent balance worth shielding: the 0.001 YEC net floor plus
// a ~0.0005 YEC fee buffer. Below this, the shield path itself would reject
// the transaction with InsufficientFunds, so we hide the "Shield Now"
// affordance on the Balance page to avoid dead clicks.
export const MIN_SHIELDABLE_ZATS = 150_000;
