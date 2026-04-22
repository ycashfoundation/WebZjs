/**
 * Loose, client-side classification of a Ycash address. Not authoritative —
 * the Rust layer does the bech32/base58 parse and will reject anything we let
 * through — but catches the common "pasted the wrong address" cases early
 * and lets the UI gate behavior (e.g. memo allowed only for shielded) before
 * any expensive pipeline work runs.
 *
 * Ycash mainnet prefixes (per `chainparams.cpp` and
 * `memory/reference_ycash_consensus.md`):
 *   - Sapling (bech32 HRP "ys")             → `ys1…`
 *   - Transparent P2PKH (base58 0x1C,0x28)  → `s1…`
 *   - Transparent P2SH  (base58 0x1C,0x2C)  → `s3…`
 *
 * Everything else is rejected with a message naming *why*. Zcash addresses
 * (zs1, t1, t3, u1, ua1) are the overwhelmingly common typo because the
 * chains share a UX history.
 */

export type AddressClassification =
  | { kind: 'shielded' }
  | { kind: 'transparent' }
  | { kind: 'invalid'; reason: string };

export function classifyAddress(addr: string): AddressClassification {
  const trimmed = addr.trim();
  if (!trimmed) return { kind: 'invalid', reason: 'Please enter a valid address' };
  const lower = trimmed.toLowerCase();

  if (/^zs1/.test(lower)) {
    return {
      kind: 'invalid',
      reason:
        'That is a Zcash Sapling address (zs1…). This wallet only sends Ycash — ask the recipient for a ys1… address.',
    };
  }
  if (/^(u1|ua1)[a-z0-9]/.test(lower)) {
    return {
      kind: 'invalid',
      reason:
        'Unified addresses require NU5, which Ycash never activated. Ask the recipient for their ys1… Sapling address.',
    };
  }
  if (/^t[13][a-z0-9]/i.test(trimmed)) {
    return {
      kind: 'invalid',
      reason:
        'Zcash transparent addresses (t1…, t3…) are not compatible with Ycash.',
    };
  }
  if (/^(ytestsapling|zt|tm|sm)/.test(lower)) {
    return {
      kind: 'invalid',
      reason: 'That looks like a testnet address — this wallet is mainnet-only.',
    };
  }

  if (/^ys1[a-z0-9]+$/.test(lower)) {
    return { kind: 'shielded' };
  }

  // Base58 alphabet (preserves case — `s3`/`s1` are real version bytes).
  if (/^s[13][A-HJ-NP-Za-km-z1-9]+$/.test(trimmed)) {
    return { kind: 'transparent' };
  }

  return {
    kind: 'invalid',
    reason: "Doesn't look like a Ycash address (expected ys1… or s1…/s3…).",
  };
}

/**
 * Canonicalize an address for use as a lookup key. Bech32 (`ys1…`) is
 * case-insensitive so we lowercase; base58 is case-sensitive and preserved
 * verbatim. Always trims surrounding whitespace.
 *
 * Two addresses that round-trip through this function to the same string
 * are the same payment destination; callers can use it as a Map key.
 */
export function normalizeAddress(addr: string): string {
  const trimmed = addr.trim();
  if (/^ys1/i.test(trimmed)) return trimmed.toLowerCase();
  return trimmed;
}
