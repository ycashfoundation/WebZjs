// Copyright 2024 ChainSafe Systems
// SPDX-License-Identifier: Apache-2.0, MIT

//! Plain-data types for paginated transaction history that the
//! [`crate::db::worker`] actor populates and hands back to
//! [`super::wallet::WebWallet::get_transaction_history`]. The SQL query
//! that produces the rows lives in `db::worker::query_transaction_history`
//! — this module is just the wasm-bindgen wire shape.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// The type of transaction
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[wasm_bindgen]
pub enum TransactionType {
    /// Funds received from external source
    Received,
    /// Funds sent to external recipient
    Sent,
    /// Internal transfer (shielding, de-shielding, or pool migration)
    Shielded,
}

/// The status of a transaction
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[wasm_bindgen]
pub enum TransactionStatusType {
    /// Transaction has been mined
    Confirmed,
    /// Transaction is waiting to be mined
    Pending,
    /// Transaction has expired without being mined
    Expired,
}

/// A single transaction history entry.
///
/// Fields are `pub(crate)` so the SQLite-backed worker in [`crate::db::worker`]
/// can build entries directly without a separate intermediate type. Public
/// access from JS is through the `#[wasm_bindgen]` getters below.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[wasm_bindgen(inspectable)]
pub struct TransactionHistoryEntry {
    /// Hex-encoded transaction ID
    pub(crate) txid: String,
    /// Type of transaction (Received, Sent, or Shielded)
    pub(crate) tx_type: TransactionType,
    /// Net value change in zatoshis (positive = received, negative = sent)
    pub(crate) value: i64,
    /// Fee paid in zatoshis (only for sent transactions)
    pub(crate) fee: Option<u64>,
    /// Block height where transaction was mined
    pub(crate) block_height: Option<u32>,
    /// Number of confirmations
    pub(crate) confirmations: u32,
    /// Transaction status
    pub(crate) status: TransactionStatusType,
    /// Decoded memo text (UTF-8)
    pub(crate) memo: Option<String>,
    /// Estimated timestamp (seconds since Unix epoch)
    pub(crate) timestamp: Option<u64>,
    /// Pool type: "sapling", "orchard", "transparent", or "mixed"
    pub(crate) pool: String,
}

#[wasm_bindgen]
impl TransactionHistoryEntry {
    #[wasm_bindgen(getter)]
    pub fn txid(&self) -> String {
        self.txid.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn tx_type(&self) -> TransactionType {
        self.tx_type
    }

    #[wasm_bindgen(getter)]
    pub fn value(&self) -> i64 {
        self.value
    }

    #[wasm_bindgen(getter)]
    pub fn fee(&self) -> Option<u64> {
        self.fee
    }

    #[wasm_bindgen(getter)]
    pub fn block_height(&self) -> Option<u32> {
        self.block_height
    }

    #[wasm_bindgen(getter)]
    pub fn confirmations(&self) -> u32 {
        self.confirmations
    }

    #[wasm_bindgen(getter)]
    pub fn status(&self) -> TransactionStatusType {
        self.status
    }

    #[wasm_bindgen(getter)]
    pub fn memo(&self) -> Option<String> {
        self.memo.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn timestamp(&self) -> Option<u64> {
        self.timestamp
    }

    #[wasm_bindgen(getter)]
    pub fn pool(&self) -> String {
        self.pool.clone()
    }
}

/// Response containing paginated transaction history.
///
/// See the note on [`TransactionHistoryEntry`] for why the fields are
/// `pub(crate)` — the SQLite-backed worker constructs values of this type
/// directly and ships them across the actor boundary, rather than going
/// through a separate data-only twin.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[wasm_bindgen(inspectable)]
pub struct TransactionHistoryResponse {
    pub(crate) transactions: Vec<TransactionHistoryEntry>,
    pub(crate) total_count: u32,
    pub(crate) has_more: bool,
}

#[wasm_bindgen]
impl TransactionHistoryResponse {
    #[wasm_bindgen(getter)]
    pub fn transactions(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.transactions).unwrap_or(JsValue::NULL)
    }

    #[wasm_bindgen(getter)]
    pub fn total_count(&self) -> u32 {
        self.total_count
    }

    #[wasm_bindgen(getter)]
    pub fn has_more(&self) -> bool {
        self.has_more
    }
}
