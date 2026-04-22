/**
 * Client-side classification of a Ycash address with real cryptographic
 * validation — the bech32 / base58check decode runs here, not just a regex
 * prefix match. The Rust layer will still do the final authoritative parse
 * at signing time, but this catches every typo (single-char substitution,
 * transposition, truncation) before the user wastes ~30 seconds on a proof
 * that was never going to be accepted.
 *
 * Ycash mainnet address shape (per `chainparams.cpp` and
 * `memory/reference_ycash_consensus.md`):
 *   - Sapling (bech32 HRP "ys")             → `ys1…` · 43-byte payload
 *                                              (11B diversifier + 32B pk_d)
 *   - Transparent P2PKH (base58check, version 0x1C 0x28) → `s1…` · 20B hash160
 *   - Transparent P2SH  (base58check, version 0x1C 0x2C) → `s3…` · 20B hash160
 *
 * Prefix-prefilter branches fire first so wrong-network typos (Zcash
 * addresses, testnet, unified) get their own user-facing reason. Anything
 * matching the Ycash shape then has its checksum verified; failures there
 * collapse to one "doesn't match — check for typos" message because the
 * underlying bech32 / base58check errors aren't end-user helpful.
 */

import { bech32, base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha256';

export type AddressClassification =
  | { kind: 'shielded' }
  | { kind: 'transparent' }
  | { kind: 'invalid'; reason: string };

const SAPLING_HRP = 'ys';
/** 11-byte diversifier + 32-byte pk_d. See ZIP-32 and librustzcash's `sapling_crypto::PaymentAddress`. */
const SAPLING_PAYLOAD_BYTES = 43;

/** Base58check payload = 2-byte version + 20-byte hash160. */
const TRANSPARENT_PAYLOAD_BYTES = 22;
const P2PKH_VERSION_0 = 0x1c;
const P2PKH_VERSION_1 = 0x28;
const P2SH_VERSION_0 = 0x1c;
const P2SH_VERSION_1 = 0x2c;

const BASE58CHECK = base58check(sha256);

const GENERIC_CHECKSUM_ERROR =
  "Address checksum doesn't match — check for typos.";

function verifySapling(addr: string): AddressClassification {
  try {
    // Bech32 is case-insensitive; canonical form is lowercase and
    // `@scure/base` rejects mixed case. Lowercase upfront so a pasted
    // `YS1…` validates the same as `ys1…`.
    const decoded = bech32.decodeToBytes(addr.toLowerCase());
    if (decoded.prefix !== SAPLING_HRP) {
      // Shouldn't happen — the prefix prefilter already matched — but
      // belt-and-suspenders in case the regex drifts.
      return {
        kind: 'invalid',
        reason: `Expected bech32 prefix "${SAPLING_HRP}", got "${decoded.prefix}".`,
      };
    }
    if (decoded.bytes.length !== SAPLING_PAYLOAD_BYTES) {
      return {
        kind: 'invalid',
        reason: `Sapling address has the wrong payload length (${decoded.bytes.length} bytes, expected ${SAPLING_PAYLOAD_BYTES}).`,
      };
    }
    return { kind: 'shielded' };
  } catch {
    return { kind: 'invalid', reason: GENERIC_CHECKSUM_ERROR };
  }
}

function verifyTransparent(addr: string): AddressClassification {
  let decoded: Uint8Array;
  try {
    decoded = BASE58CHECK.decode(addr);
  } catch {
    return { kind: 'invalid', reason: GENERIC_CHECKSUM_ERROR };
  }
  if (decoded.length !== TRANSPARENT_PAYLOAD_BYTES) {
    return {
      kind: 'invalid',
      reason: `Transparent address has the wrong payload length (${decoded.length} bytes, expected ${TRANSPARENT_PAYLOAD_BYTES}).`,
    };
  }
  const v0 = decoded[0];
  const v1 = decoded[1];
  const isP2PKH = v0 === P2PKH_VERSION_0 && v1 === P2PKH_VERSION_1;
  const isP2SH = v0 === P2SH_VERSION_0 && v1 === P2SH_VERSION_1;
  if (!isP2PKH && !isP2SH) {
    const hex = `0x${v0.toString(16).padStart(2, '0')}${v1.toString(16).padStart(2, '0')}`;
    return {
      kind: 'invalid',
      reason: `Version bytes ${hex} aren't Ycash mainnet (expected s1… or s3…).`,
    };
  }
  return { kind: 'transparent' };
}

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
    return verifySapling(trimmed);
  }

  // Base58 alphabet (preserves case — `s1`/`s2`/`s3` are all possible Ycash
  // mainnet prefixes). The visible second character depends on the full
  // 22-byte version+hash160 value, so P2SH (version 0x1C2C) can encode to
  // `s2…` or `s3…`; `verifyTransparent` below is the authority on which
  // version bytes are actually Ycash.
  if (/^s[123][A-HJ-NP-Za-km-z1-9]+$/.test(trimmed)) {
    return verifyTransparent(trimmed);
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
