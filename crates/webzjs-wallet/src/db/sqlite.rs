//! SQLite-backed wallet storage.
//!
//! Thin wrapper over [`zcash_client_sqlite::WalletDb`] that pins the
//! generic parameters the rest of the WebZjs stack expects (rusqlite
//! `Connection`, WebZjs `Network`, [`WasmClock`] on wasm /
//! [`zcash_client_sqlite::util::SystemClock`] on native, [`OsRng`]).
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
use zcash_client_sqlite::{util::Clock, WalletDb};

/// A [`Clock`] impl that sources the current time from `Date.now()` via
/// `js-sys` on wasm32, since `std::time::SystemTime::now()` is unimplemented
/// for `wasm32-unknown-unknown` and panics at runtime.
#[cfg(all(target_family = "wasm", target_os = "unknown"))]
#[derive(Clone, Copy, Default)]
pub struct WasmClock;

#[cfg(all(target_family = "wasm", target_os = "unknown"))]
impl Clock for WasmClock {
    fn now(&self) -> std::time::SystemTime {
        let ms_since_epoch = js_sys::Date::now() as u64;
        std::time::UNIX_EPOCH + std::time::Duration::from_millis(ms_since_epoch)
    }
}

#[cfg(all(target_family = "wasm", target_os = "unknown"))]
type DefaultClock = WasmClock;

#[cfg(not(all(target_family = "wasm", target_os = "unknown")))]
type DefaultClock = zcash_client_sqlite::util::SystemClock;

#[cfg(all(target_family = "wasm", target_os = "unknown"))]
fn default_clock() -> DefaultClock {
    WasmClock
}

#[cfg(not(all(target_family = "wasm", target_os = "unknown")))]
fn default_clock() -> DefaultClock {
    zcash_client_sqlite::util::SystemClock
}

/// A SQLite-backed wallet database.
///
/// Wraps [`zcash_client_sqlite::WalletDb`] with the `Connection` / `Network` /
/// [`DefaultClock`] / [`OsRng`] type choices that the rest of the WebZjs stack
/// expects. On wasm32, [`DefaultClock`] is [`WasmClock`] (Date.now); on native
/// it is [`zcash_client_sqlite::util::SystemClock`].
pub struct SqliteWalletDb {
    inner: WalletDb<Connection, Network, DefaultClock, OsRng>,
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
        let inner =
            WalletDb::for_path(uri, network, default_clock(), OsRng).map_err(Error::Sqlite)?;
        Ok(Self { inner })
    }

    /// Borrow the underlying [`WalletDb`]. Intended for the few call sites that
    /// hand the db to `zcash_client_backend::sync::run` or similar. Prefer
    /// going through the `crate::Wallet` facade instead.
    pub fn inner(&self) -> &WalletDb<Connection, Network, DefaultClock, OsRng> {
        &self.inner
    }

    pub fn inner_mut(&mut self) -> &mut WalletDb<Connection, Network, DefaultClock, OsRng> {
        &mut self.inner
    }

    /// Consume the wrapper and hand back the underlying
    /// [`WalletDb`]. Used by the DB worker, which plugs the open
    /// connection directly into [`crate::Wallet`].
    pub fn into_inner(self) -> WalletDb<Connection, Network, DefaultClock, OsRng> {
        self.inner
    }
}

/// The concrete [`WalletDb`] type the WebZjs DB worker owns. Named so
/// call sites outside this module (in particular `db::worker`) don't
/// have to duplicate the four-type parameter list.
pub type WorkerWalletDb = WalletDb<Connection, Network, DefaultClock, OsRng>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("failed to install sqlite VFS: {0}")]
    VfsInstall(String),
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
}
