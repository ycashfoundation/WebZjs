//! SQLite-backed wallet storage.
//!
//! This is the entry point for the ongoing migration from
//! [`zcash_client_memory::MemoryWalletDb`] to
//! [`zcash_client_sqlite::WalletDb`]. The migration plan is documented in the
//! project memory (`project_sqlite_plan.md` / `project_sqlite_step2_decisions.md`).
//!
//! # Threading & VFS
//!
//! On wasm, this type **must** be constructed and operated from a single
//! dedicated worker. sqlite-wasm-rs is compiled `-DSQLITE_THREADSAFE=0` and the
//! OPFS sahpool VFS uses synchronous [`FileSystemSyncAccessHandle`] handles
//! that are only available to workers. The long-term architecture is a single
//! owner DB worker that accepts intent-level requests (see step-2 decision
//! memo); this module currently just provides the raw wrapper.
//!
//! On native targets, [`SqliteWalletDb`] is backed by a file-path or in-memory
//! connection for tests and the `simple-sync` example.

use rand::rngs::OsRng;
use rusqlite::Connection;
use webzjs_common::Network;
use zcash_client_sqlite::{util::SystemClock, WalletDb};

/// A SQLite-backed wallet database.
///
/// Wraps [`zcash_client_sqlite::WalletDb`] with the `Connection` / `Network` /
/// [`SystemClock`] / [`OsRng`] type choices that the rest of the WebZjs stack
/// expects.
pub struct SqliteWalletDb {
    inner: WalletDb<Connection, Network, SystemClock, OsRng>,
}

impl SqliteWalletDb {
    /// Open the wallet database backed by OPFS via the `sahpool` VFS.
    ///
    /// Installs the sahpool VFS on first call (idempotent by design in
    /// sqlite-wasm-rs) and opens `file:<name>` using it. Must be called from a
    /// Worker context — `FileSystemSyncAccessHandle` is unavailable on the
    /// main thread.
    ///
    /// `name` is treated as the OPFS-side filename; do not pass a filesystem
    /// path.
    #[cfg(all(target_family = "wasm", target_os = "unknown"))]
    pub async fn open_opfs(name: &str, network: Network) -> Result<Self, Error> {
        use sqlite_wasm_rs::sahpool_vfs::{install as install_opfs_sahpool, OpfsSAHPoolCfg};

        install_opfs_sahpool(&OpfsSAHPoolCfg::default(), true)
            .await
            .map_err(|e| Error::VfsInstall(format!("{e:?}")))?;

        let uri = format!("file:{name}");
        Self::open_uri(&uri, network)
    }

    /// Open an in-memory wallet database. Used by native tests and as a
    /// transient fallback until the OPFS path is wired up end-to-end.
    pub fn open_in_memory(network: Network) -> Result<Self, Error> {
        Self::open_uri(":memory:", network)
    }

    fn open_uri(uri: &str, network: Network) -> Result<Self, Error> {
        let inner = WalletDb::for_path(uri, network, SystemClock, OsRng)
            .map_err(Error::Sqlite)?;
        Ok(Self { inner })
    }

    /// Borrow the underlying [`WalletDb`]. Intended for the few call sites that
    /// hand the db to `zcash_client_backend::sync::run` or similar. Prefer
    /// going through the `crate::Wallet` facade instead.
    pub fn inner(&self) -> &WalletDb<Connection, Network, SystemClock, OsRng> {
        &self.inner
    }

    pub fn inner_mut(&mut self) -> &mut WalletDb<Connection, Network, SystemClock, OsRng> {
        &mut self.inner
    }
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("failed to install sqlite VFS: {0}")]
    VfsInstall(String),
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
}
