#!/usr/bin/env node
// Fetch Sapling proving parameters and place them next to the web-wallet
// build so Parcel + the dev server can serve them same-origin. Invoked from
// `predev` / `prebuild` hooks in package.json; safe to run repeatedly (skips
// files that already match the expected SHA-256).
//
// The files are byte-identical to Zcash mainnet's trusted-setup output —
// Ycash forked post-Sapling and inherits the original ceremony. See
// zcash_proofs/src/lib.rs in librustzcash-ycash for the canonical hashes.

import { createHash } from 'node:crypto';
import { mkdir, stat, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public-sapling');

const PARAMS = [
  {
    name: 'sapling-spend.params',
    url: 'https://download.z.cash/downloads/sapling-spend.params',
    sha256: '8e48ffd23abb3a5fd9c5589204f32d9c31285a04b78096ba40a79b75677efc13',
    sizeBytes: 47958396,
  },
  {
    name: 'sapling-output.params',
    url: 'https://download.z.cash/downloads/sapling-output.params',
    sha256: '2f0ebbcbb9bb0bcffe95a397e7eba89c29eb4dde6191c339db88570e3f3fb0e4',
    sizeBytes: 3592860,
  },
];

function hashHex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fileSize(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

async function ensureParam({ name, url, sha256, sizeBytes }) {
  const dest = join(OUT_DIR, name);

  const size = await fileSize(dest);
  if (size === sizeBytes) {
    const existing = await readFile(dest);
    if (hashHex(existing) === sha256) {
      console.log(`[sapling] ${name}: present and verified`);
      return;
    }
    console.warn(`[sapling] ${name}: size matches but hash does not; refetching`);
  } else if (size !== null) {
    console.warn(`[sapling] ${name}: size mismatch (${size} vs ${sizeBytes}); refetching`);
  }

  console.log(`[sapling] ${name}: downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const actualHash = hashHex(bytes);
  if (actualHash !== sha256) {
    throw new Error(
      `[sapling] ${name}: checksum mismatch — expected ${sha256}, got ${actualHash}`,
    );
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(dest, bytes);
  console.log(`[sapling] ${name}: wrote ${bytes.length} bytes`);
}

async function main() {
  for (const param of PARAMS) {
    await ensureParam(param);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
