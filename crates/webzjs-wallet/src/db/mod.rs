//! SQLite-backed storage for [`crate::Wallet`].
//!
//! The wallet stores on-disk state in a wasm-capable
//! [`zcash_client_sqlite::WalletDb`] (sahpool OPFS on wasm, file-path or
//! `:memory:` on native). All SQLite operations are serialized through
//! the single-owner [`worker`] actor — see its module docs for the
//! threading story.

pub mod sqlite;
pub mod worker;
