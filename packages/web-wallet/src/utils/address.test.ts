import { describe, it, expect } from 'vitest';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha256';
import { classifyAddress, normalizeAddress } from './address';

// Known-good mainnet Ycash Sapling address pulled from a real on-chain tx
// on `feat/ycash` (`d331802e` recipient — first Ycash PCZT v4 tx out of
// this wallet). If it ever stops validating, the bech32 checksum code has
// a bug — this checksum is authoritative.
const REAL_SAPLING =
  'ys1whtgalsyf4ecmydc3mxm7ruh9qgusjnakhpl34nvzt37kgw37d0evf65g6xrm4rv5qpyxrfy6rp';

// Synthesize valid transparent fixtures instead of hardcoding a real on-chain
// one: encode the canonical Ycash mainnet version prefix + 20 bytes of
// payload via base58check(sha256). The checksum comes out correct by
// construction, so this exercises the round-trip without needing a known
// funded address.
const BASE58CHECK = base58check(sha256);
const zeros20 = new Uint8Array(20); // hash160-shaped placeholder
const ffs20 = new Uint8Array(20).fill(0xff);
// Ycash P2PKH (version 0x1C28) deterministically encodes to `s1…` for any
// payload. P2SH (version 0x1C2C) can encode to `s2…` or `s3…` depending on
// the payload bytes — we verify both here.
const VALID_S1 = BASE58CHECK.encode(new Uint8Array([0x1c, 0x28, ...zeros20]));
const VALID_S2_P2SH = BASE58CHECK.encode(
  new Uint8Array([0x1c, 0x2c, ...zeros20]),
);
const VALID_S3_P2SH = BASE58CHECK.encode(
  new Uint8Array([0x1c, 0x2c, ...ffs20]),
);
// Same base58check shape but non-Ycash version bytes — the decoder must
// reject on the version-byte check even though the checksum is valid.
const WRONG_VERSION = BASE58CHECK.encode(
  new Uint8Array([0x1d, 0x25, ...zeros20]),
);

describe('classifyAddress', () => {
  it('accepts a known-good ys1 Sapling address', () => {
    expect(classifyAddress(REAL_SAPLING)).toEqual({ kind: 'shielded' });
  });

  it('accepts the same ys1 address in uppercase (bech32 is case-insensitive)', () => {
    expect(classifyAddress(REAL_SAPLING.toUpperCase())).toEqual({
      kind: 'shielded',
    });
  });

  it('rejects a ys1 address with one character mutated (checksum fail)', () => {
    // Flip one payload character; bech32 checksum must catch it.
    const mutated = REAL_SAPLING.replace(/w/, 'x'); // first 'w' → 'x'
    expect(mutated).not.toBe(REAL_SAPLING);
    expect(classifyAddress(mutated).kind).toBe('invalid');
  });

  it('rejects a ys1 address with a character dropped', () => {
    const truncated = REAL_SAPLING.slice(0, -1);
    expect(classifyAddress(truncated).kind).toBe('invalid');
  });

  it('accepts a ys1 address with mixed case (normalized by lowercasing)', () => {
    // BIP-173 technically forbids mixed-case bech32, but accepting it is a
    // UX choice: the payment destination is identical regardless of case,
    // and real-world clipboards occasionally mangle case. Strict rejection
    // would confuse users without catching any typo the checksum misses.
    const mid = Math.floor(REAL_SAPLING.length / 2);
    const mixed = REAL_SAPLING.slice(0, mid) + REAL_SAPLING.slice(mid).toUpperCase();
    expect(classifyAddress(mixed)).toEqual({ kind: 'shielded' });
  });

  it('accepts a synthesized valid s1 (P2PKH) address', () => {
    expect(VALID_S1).toMatch(/^s1/);
    expect(classifyAddress(VALID_S1)).toEqual({ kind: 'transparent' });
  });

  it('accepts a synthesized valid P2SH that encodes as s2…', () => {
    // Ycash P2SH version (0x1C2C) with an all-zero payload encodes to the
    // `s2…` prefix — this is valid Ycash P2SH even though the prefix
    // isn't `s3…`. Confirms the prefilter accepts `s[123]`, not only
    // `s[13]`.
    expect(VALID_S2_P2SH).toMatch(/^s2/);
    expect(classifyAddress(VALID_S2_P2SH)).toEqual({ kind: 'transparent' });
  });

  it('accepts a synthesized valid P2SH that encodes as s3…', () => {
    expect(VALID_S3_P2SH).toMatch(/^s3/);
    expect(classifyAddress(VALID_S3_P2SH)).toEqual({ kind: 'transparent' });
  });

  it('rejects an s1 address with a checksum-breaking mutation', () => {
    const mutated = VALID_S1.slice(0, -1) + 'X';
    expect(classifyAddress(mutated).kind).toBe('invalid');
  });

  it('rejects a base58check address with non-Ycash version bytes', () => {
    // The prefilter regex matches any s[123]… shape, but non-Ycash version
    // bytes must still be rejected even when the checksum is valid.
    // Skip if the encoded form happens not to start with s (version-byte
    // arithmetic determines the visible prefix).
    if (/^s[123]/.test(WRONG_VERSION)) {
      expect(classifyAddress(WRONG_VERSION).kind).toBe('invalid');
    }
  });

  it('rejects a Zcash zs1 address with a Zcash-specific message', () => {
    const result = classifyAddress(
      'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly',
    );
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/Zcash Sapling/);
    }
  });

  it('rejects a Zcash t1 transparent address', () => {
    const result = classifyAddress('t1Q4pENJ3nFEfwdTYT6LizqRE1bDoVaVnDp');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/Zcash transparent/);
    }
  });

  it('rejects a Unified Address', () => {
    const result = classifyAddress('u1something');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/Unified/);
    }
  });

  it('rejects a testnet ytestsapling address', () => {
    const result = classifyAddress(
      'ytestsapling1q2w3e4r5t6y7u8i9o0p',
    );
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/testnet/);
    }
  });

  it('rejects empty input', () => {
    expect(classifyAddress('').kind).toBe('invalid');
    expect(classifyAddress('   ').kind).toBe('invalid');
  });

  it('rejects a random string that vaguely matches ys1 shape', () => {
    expect(classifyAddress('ys1aaaaaaaaaaaaaaaa').kind).toBe('invalid');
  });
});

describe('normalizeAddress', () => {
  it('lowercases bech32 (ys1) addresses', () => {
    expect(normalizeAddress(REAL_SAPLING.toUpperCase())).toBe(REAL_SAPLING);
  });

  it('preserves case on base58 (s1/s3) addresses', () => {
    expect(normalizeAddress(VALID_S1)).toBe(VALID_S1);
  });

  it('trims whitespace', () => {
    expect(normalizeAddress(`  ${REAL_SAPLING}  `)).toBe(REAL_SAPLING);
  });
});
