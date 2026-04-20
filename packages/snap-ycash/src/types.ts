import type { Json } from '@metamask/snaps-sdk';

export type SetBirthdayBlockParams = { latestBlock: number };

export type SignPcztParams = {
  pcztHexString: string;
  signDetails: {
    recipient: string;
    amount: string;
    /**
     * ZIP-302 text memo attached to the Sapling output, if the sender
     * supplied one. Displayed to the user in the signing dialog so they
     * can audit what they're signing (memos are committed to the tx and
     * irreversibly on-chain once broadcast).
     */
    memo?: string;
  };
};

/**
 * Cached balance stored in snap state for recovery after cookie/IndexedDB clears.
 * All fields are Json-compatible (number extends Json).
 */
export type LastKnownBalance = {
  shielded: number;     // sapling zatoshis (Ycash has no Orchard)
  unshielded: number;   // transparent zatoshis
  timestamp: number;    // when last updated, ms since epoch
};

/**
 * Snap persistent state stored via snap_manageState.
 * Must be Json-serializable (no undefined values).
 * Optional fields use `| null` instead of `?` to maintain Json compatibility.
 */
export type SnapState = {
  webWalletSyncStartBlock: string;
  lastKnownBalance: LastKnownBalance | null;
  hasPendingTx: boolean | null;
} & Record<string, Json>;
