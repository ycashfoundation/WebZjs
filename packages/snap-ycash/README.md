# WebZjs Ycash Snap

## Overview

WebZjs Ycash Snap is a MetaMask Snap that brings Ycash (YEC) functionality into the MetaMask browser extension. It holds the seed inside the MetaMask sandbox and signs partially-constructed Ycash transactions (PCZTs) on behalf of the [Ycash web wallet](../web-wallet).

This is a Ycash-aware fork of the original `@chainsafe/webzjs-zcash-snap`. Key differences:

- BIP44 coin type `347` (Ycash) instead of `133` (Zcash).
- Proposed name / dialogs / install copy say Ycash, not Zcash.
- Birthday block reference values use `YCASH_FORK_HEIGHT` (570000) instead of NU5 activation.
- Consumes `@chainsafe/webzjs-keys` built against `ycashfoundation/librustzcash-nu61`, so `new UnifiedSpendingKey('main', ...)` derives on Ycash mainnet parameters.
- Signs v4 (ZIP-243) Sapling PCZTs. Ycash never activated NU5, so every shielded transaction it signs is v4. This exercises the PCZT v4 sighash path landed in librustzcash-ycash `1c42c5eb`.

## Prerequisites

- Node.js ≥ 18.18
- Yarn 4
- MetaMask Flask (for development): https://docs.metamask.io/snaps/get-started/install-flask/
- Wasm packages built: `just build` at the repo root

## Development

The snap manifest (`snap.manifest.json`) controls which origins can communicate with the snap via `allowedOrigins`. `scripts/generate-manifest.js` adds/strips localhost origins for dev vs prod — do not edit `allowedOrigins` by hand.

### Scripts

- `yarn dev` / `yarn start` — add localhost origins to `allowedOrigins`, watch for changes, serve on :8080
- `yarn build` — strip localhost origins, run a production build
- `yarn manifest:dev` / `yarn manifest:prod` — just the manifest edits

### Steps

1. `yarn install` from the repo root
2. `just build` (builds wasm packages — needed by the snap's keys import)
3. `yarn snap-ycash:start` from the repo root (or `yarn dev` in this package)
4. Point the web wallet at `local:http://localhost:8080` (its default snap origin)

### Do not commit a dev manifest

Running `yarn dev` rewrites `snap.manifest.json` to include `http://localhost:3000`. Run `yarn build` or `yarn manifest:prod` before committing to reset it.
