//! Database backends for [`crate::Wallet`].
//!
//! The default backend is [`zcash_client_memory::MemoryWalletDb`]. The optional
//! `sqlite-db` feature adds [`sqlite::SqliteWalletDb`], a wasm-capable
//! SQLite-backed store.

#[cfg(feature = "sqlite-db")]
pub mod sqlite;
