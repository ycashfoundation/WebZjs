# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo shape

This is a hybrid Rust + JS monorepo. Rust crates under `crates/` are compiled to WebAssembly via `wasm-pack` and consumed as npm packages under `packages/` (a Yarn v4 workspace).

- `crates/webzjs-wallet` — main library (`WebWallet` type); compiled to `@chainsafe/webzjs-wallet` npm package
- `crates/webzjs-keys` — key management, seed → USK/UFVK, PCZT signing; compiled to `@chainsafe/webzjs-keys`
- `crates/webzjs-requests` — zip321 payment request parsing; compiled to `@chainsafe/webzjs-requests`
- `crates/webzjs-common` — shared types (`Network`, `Pczt`, `Error`) used by the other crates
- `packages/web-wallet` — React/Parcel reference wallet app that consumes the wasm packages
- `packages/snap` — MetaMask Snap that holds the seed and signs PCZTs inside the Snap sandbox
- `packages/e2e-tests` — Playwright tests driving a browser-loaded wallet via `window.webWallet`

The `packages/` output directories for the wasm crates (`packages/webzjs-wallet`, `packages/webzjs-keys`, `packages/webzjs-requests`) are **build artifacts** produced by `just build`, not hand-edited source.

## Toolchain

- Rust: nightly pinned via `rust-toolchain.toml` (currently `nightly-2025-01-07`) with `rust-src` and `wasm32-unknown-unknown` target. `build-std="panic_abort,std"` is required — that's why builds go through `just` and not plain `cargo`.
- Zcash deps are pinned to the `ChainSafe/librustzcash-nu61` fork (branch `feat/snap-nu61`). Any `librustzcash` upstream change must be ported to that fork first.
- `wasm-bindgen` is **pinned to `=0.2.100`** intentionally — newer versions break `TextEncoder.encodeInto` inside the MetaMask Snap sandbox. Don't bump it casually.
- Node ≥ 18.18, Yarn 4.5.1 (via `packageManager`), `just` as the task runner, `wasm-pack`, clang 17+ (needed for Zcash crypto deps).

## Common commands

### Build the wasm packages (required before JS work)
```shell
just build             # builds wallet + keys + requests into packages/
just build-wallet      # just the wallet crate
just build-keys
just build-requests
just check-wasm        # cargo check against wasm32 target with the right features
```

`just build-wallet` runs `add-worker-module.sh` after wasm-pack to inject a worker module shim into the generated `wasm_thread` snippet. If you re-run wasm-pack manually without this script, web workers will fail to start.

### Rust tests
```shell
just test-web                  # all wasm-bindgen tests in Firefox
just test-simple-web           # simple-sync-and-send test in Chrome
just test-message-board-web    # message-board-sync test in Chrome
just example-simple            # native cargo example (needs tonic/tls)
just example-message-board
```

CI runs `cargo fmt --all -- --check` and `cargo clippy --all --lib -- -D warnings -A deprecated -A unused-variables -A unused-imports` (see `.github/workflows/rust-checks.yml`).

### JS development
```shell
yarn                           # install workspace deps (after just build)
yarn dev                       # runs web-wallet + snap watch in parallel
yarn web-wallet:dev            # web-wallet only (parcel + express on :3000)
yarn snap:start                # snap dev (mm-snap watch on :8080)
yarn test:e2e                  # playwright e2e
```

Per-package: the web-wallet uses `vitest` (`yarn workspace @chainsafe/webzjs-web-wallet test`), the snap uses `jest` (`yarn workspace @chainsafe/webzjs-zcash-snap test`).

### Local lightwalletd proxy
The browser requires a gRPC-web proxy in front of a lightwalletd instance. Run one with `just run-proxy` (mainnet via `zec.rocks`) or `just run-test-proxy` (testnet), or use the docker-compose Traefik setup in `traefik/`.

## Architecture notes

### Wallet and syncing
`crates/webzjs-wallet/src/wallet.rs` defines the generic `Wallet<Db, Client>`. The wasm-exposed type is `WebWallet` in `src/bindgen/wallet.rs`, which pins it to `MemoryWalletDb<Network>` (in-memory only) and `tonic_web_wasm_client::Client` (the browser gRPC-web transport). Sync runs via `zcash_client_backend::sync::run` dispatched to a `wasm_thread` worker; other wallet methods take a write lock but are safe to call during sync.

### PCZT flow
Spending is a four-step PCZT pipeline: `pczt_create` (propose + build) → `pczt_sign` (requires USK; run inside the Snap) → `pczt_prove` (SNARK proving, parallelized across workers) → `pczt_send`. The `webzjs-keys` crate exists so the Snap can sign without pulling in the full wallet crate.

### Threading in the browser
The wasm build uses `wasm-bindgen-rayon` + `wasm_thread` (pinned to a specific git rev) for a worker-based thread pool. This means:
- Consumers **must** call `initWasm()` then `initThreadPool(n)` exactly once per page load.
- The hosting page needs `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` so `SharedArrayBuffer` is available (see `netlify.toml` and `packages/web-wallet/server.js`).
- The `.cargo/config.toml` sets `target-feature=+atomics,+bulk-memory,+mutable-globals` for the wasm target; this is what requires `build-std`.

### Snap manifest / allowed origins
`packages/snap/snap.manifest.json` is regenerated by `scripts/generate-manifest.js` — `yarn dev` writes `http://localhost:3000` into `allowedOrigins`, `yarn build` strips it. Two CI workflows (`check-snap-manifest.yml`, `check-snap-allowed-origins.yml`) fail `main` if localhost origins leak in. Run `yarn manifest:prod` (or `yarn build`) before committing changes to the manifest.

### Crate features
`webzjs-wallet` has mutually-exclusive-ish feature sets:
- `native` (default) — enables `tonic` with TLS for cargo examples and native tests
- `wasm` / `wasm-parallel` — browser build; `wasm-parallel` pulls in `wasm-bindgen-rayon` + `multicore`
- `no-bundler` — required when building for `wasm-pack test` and for direct-ESM consumers (tells `wasm-bindgen-rayon` and `wasm_thread` not to emit bundler-specific glue)
- `sqlite-db` — native-only, for examples that persist to sqlite
