//! End-to-end smoke test for the wasm SQLite backend.
//!
//! Exercises the full stack — rusqlite (ycash fork) → sqlite-wasm-rs FFI →
//! schemerz-rusqlite migrations → zcash_client_sqlite's schema init — on
//! `wasm32-unknown-unknown`. The goal is to catch FFI / VFS / migration
//! regressions before they reach the worker plumbing in step 4+.
//!
//! Uses the in-memory VFS rather than OPFS sahpool so the test runs in the
//! wasm-pack main-thread harness without needing a dedicated worker.

use webzjs_common::Network;
use webzjs_wallet::db::sqlite::SqliteWalletDb;
use zcash_client_sqlite::wallet::init::init_wallet_db;

#[cfg(all(target_family = "wasm", target_os = "unknown"))]
use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

#[cfg(all(target_family = "wasm", target_os = "unknown"))]
wasm_bindgen_test_configure!(run_in_browser);

/// Open an in-memory SQLite wallet, run the full schema migration with no
/// seed, and confirm the database reports itself ready for wallet operations.
#[cfg_attr(all(target_family = "wasm", target_os = "unknown"), wasm_bindgen_test)]
#[cfg_attr(not(all(target_family = "wasm", target_os = "unknown")), test)]
fn open_and_migrate_in_memory() {
    let mut db =
        SqliteWalletDb::open_in_memory(Network::MainNetwork).expect("open :memory: wallet");

    // init_wallet_db runs all schemerz-rusqlite migrations without a seed.
    // Seed-requiring migrations do not run until an account is added, so this
    // should succeed on a fresh in-memory DB.
    init_wallet_db(db.inner_mut(), None).expect("init_wallet_db should succeed on empty DB");
}
