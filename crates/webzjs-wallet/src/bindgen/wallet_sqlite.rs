//! JS-facing wallet bound to a SQLite backend (sahpool OPFS on wasm,
//! `:memory:` on native tests).
//!
//! `WebWalletSqlite` is the sibling of [`super::wallet::WebWallet`] that the
//! plan's "step 4" calls out: introduce the SQLite entry point without
//! disturbing the memory-backed type that's currently in production. Method
//! parity with `WebWallet` is deliberately deferred to step 5 — right now
//! this exposes the construction handshake and a single round-trip `ping`
//! that proves the main-thread → worker → SQLite transport is live.
//!
//! On the JS side this looks like:
//! ```javascript
//! const w = await WebWalletSqlite.create("main", "webzjs-wallet.sqlite3");
//! await w.ping(123n); // returns 123n
//! ```

use wasm_bindgen::prelude::*;

use webzjs_common::Network;

use crate::db::worker::{spawn, Backing, DbWorkerHandle, WorkerError};

#[wasm_bindgen]
pub struct WebWalletSqlite {
    handle: DbWorkerHandle,
}

#[wasm_bindgen]
impl WebWalletSqlite {
    /// Spawn the DB worker and open a persistent SQLite wallet inside it.
    ///
    /// * `network` — "main" or "test".
    /// * `db_name` — the filename inside OPFS. Caller is responsible for
    ///   uniqueness; the same name always re-opens the same database.
    ///
    /// Returns once the worker has successfully opened the database. Any
    /// error during OPFS VFS install or schema open is surfaced here.
    #[wasm_bindgen(js_name = create)]
    pub async fn create(network: &str, db_name: String) -> Result<WebWalletSqlite, JsError> {
        let network: Network = network
            .parse()
            .map_err(|e: webzjs_common::Error| JsError::new(&e.to_string()))?;

        #[cfg(all(target_family = "wasm", target_os = "unknown"))]
        let backing = Backing::Opfs { name: db_name };
        #[cfg(not(all(target_family = "wasm", target_os = "unknown")))]
        let backing = {
            // Native (test) builds don't have OPFS; use an in-memory
            // database keyed by the name for parity with the sqlite path.
            let _ = db_name;
            Backing::InMemory
        };

        let handle = spawn(backing, network)
            .await
            .map_err(|e: WorkerError| JsError::new(&e.to_string()))?;

        Ok(WebWalletSqlite { handle })
    }

    /// Round-trip probe. Sends `nonce` to the worker thread and returns
    /// whatever the worker echoes back. Lets JS callers confirm the
    /// transport is live without executing a real wallet operation.
    pub async fn ping(&self, nonce: u64) -> Result<u64, JsError> {
        self.handle
            .ping(nonce)
            .await
            .map_err(|e| JsError::new(&e.to_string()))
    }
}
