// Fetch + cache + install the Sapling proving parameters.
//
// The wasm binary no longer bundles these (~51 MB saved) — the JS host is
// responsible for making sure the wasm module has them before the user
// tries to spend. Call `ensureSaplingParams()` as early as possible in the
// page lifecycle so the wallet is always ready by the time Send is reached.
//
// Files are served same-origin from `/sapling-spend.params` and
// `/sapling-output.params` (populated by
// packages/web-wallet/scripts/fetch-sapling-params.mjs at build time).
// Verified SHA-256 on first fetch; subsequent loads hit IndexedDB.

import { get, set } from 'idb-keyval';
import {
  saplingParamsLoaded,
  setSaplingParams,
} from '@chainsafe/webzjs-wallet';

interface ParamSpec {
  name: string;
  url: string;
  idbKey: string;
  sha256: string;
}

const SPEND: ParamSpec = {
  name: 'sapling-spend.params',
  url: '/sapling-spend.params',
  idbKey: 'sapling-spend-params',
  sha256: '8e48ffd23abb3a5fd9c5589204f32d9c31285a04b78096ba40a79b75677efc13',
};

const OUTPUT: ParamSpec = {
  name: 'sapling-output.params',
  url: '/sapling-output.params',
  idbKey: 'sapling-output-params',
  sha256: '2f0ebbcbb9bb0bcffe95a397e7eba89c29eb4dde6191c339db88570e3f3fb0e4',
};

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function loadParam(spec: ParamSpec): Promise<Uint8Array> {
  const cached = (await get(spec.idbKey)) as Uint8Array | undefined;
  if (cached) {
    // Cached copies were SHA-verified when first stored. Skipping verification
    // here keeps page-load fast; corrupted bytes would surface as a
    // prover-parse panic on next spend — rare, recoverable by clearing IDB.
    return cached;
  }

  console.info(`[sapling] fetching ${spec.name}`);
  const res = await fetch(spec.url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${spec.name}: HTTP ${res.status}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const actual = await sha256Hex(bytes);
  if (actual !== spec.sha256) {
    throw new Error(
      `${spec.name}: SHA-256 mismatch — got ${actual}, expected ${spec.sha256}`,
    );
  }
  await set(spec.idbKey, bytes);
  return bytes;
}

/**
 * Installs Sapling proving parameters into the wasm module. Idempotent:
 * returns immediately if the module already has them, otherwise fetches
 * (from cache or network), verifies, stores, and hands off to wasm.
 *
 * Throws on network failure, checksum mismatch, or wasm rejection. Callers
 * should surface the error — a wallet without these cannot spend.
 */
export async function ensureSaplingParams(): Promise<void> {
  if (saplingParamsLoaded()) return;

  const [spend, output] = await Promise.all([loadParam(SPEND), loadParam(OUTPUT)]);

  // setSaplingParams takes ownership of the Uint8Arrays (copied into wasm
  // memory). If the module was initialized by another tab in parallel, the
  // set will throw — swallow that exact case.
  try {
    setSaplingParams(spend, output);
  } catch (err) {
    if (saplingParamsLoaded()) {
      // Another path loaded them between our check and our set; that's fine.
      return;
    }
    throw err;
  }
}
