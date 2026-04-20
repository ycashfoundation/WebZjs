//! The JS-facing wallet. Backed by the single-owner SQLite DB worker
//! (sahpool OPFS on wasm, `:memory:` on native tests); see
//! [`crate::db::worker`] for the actor implementation.
//!
//! History: this module previously hosted two siblings — a memory-backed
//! `WebWallet` pinned to [`zcash_client_memory::MemoryWalletDb`] and a
//! sqlite-backed `WebWalletSqlite`. Step 7 (2026-04-19) retired the
//! memory path and renamed the SQLite type to `WebWallet`, so there's
//! only one browser wallet surface and JS callers don't have to
//! feature-detect.
//!
//! JS usage:
//! ```javascript
//! const w = await WebWallet.create(
//!   "main",
//!   "webzjs-wallet.sqlite3",
//!   "https://lite.ycash.xyz",
//!   1, 1);
//! const summary = await w.get_wallet_summary();
//! await w.sync();
//! const pczt = await w.pczt_create(accountId, toAddr, zats);
//! ```

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use webzjs_common::{Network, Pczt};
use webzjs_keys::{ProofGenerationKey, SeedFingerprint};

use super::transaction_history::TransactionHistoryResponse;
use crate::db::worker::{
    spawn, AccountBalanceData, Backing, DbWorkerHandle, WalletSummaryData, WorkerError,
};
use crate::error::Error;
use crate::validation::validate_confirmations_policy;

#[wasm_bindgen]
pub struct WebWallet {
    handle: DbWorkerHandle,
}

#[wasm_bindgen]
impl WebWallet {
    /// Spawn the DB worker, open the SQLite wallet inside it, and connect
    /// to lightwalletd. Returns once the worker has successfully opened
    /// the database and constructed the underlying [`crate::Wallet`]; any
    /// error during VFS install, schema init, or wallet construction
    /// surfaces here.
    ///
    /// * `network` — "main" or "test".
    /// * `db_name` — OPFS filename; the same name always re-opens the
    ///   same database. Ignored on native test builds (in-memory only).
    /// * `lightwalletd_url` — gRPC-web proxy in front of a lightwalletd
    ///   instance (e.g. `https://lite.ycash.xyz`).
    /// * `min_confirmations_trusted` / `min_confirmations_untrusted` —
    ///   see [`zcash_client_backend::data_api::wallet::ConfirmationsPolicy`].
    #[wasm_bindgen(js_name = create)]
    pub async fn create(
        network: &str,
        db_name: String,
        lightwalletd_url: String,
        min_confirmations_trusted: u32,
        min_confirmations_untrusted: u32,
    ) -> Result<WebWallet, Error> {
        let network: Network = network.parse()?;
        let min_confirmations = validate_confirmations_policy(
            min_confirmations_trusted,
            min_confirmations_untrusted,
            true,
        )
        .map_err(|_| Error::InvalidMinConformations)?;

        #[cfg(all(target_family = "wasm", target_os = "unknown"))]
        let backing = Backing::Opfs { name: db_name };
        #[cfg(not(all(target_family = "wasm", target_os = "unknown")))]
        let backing = {
            let _ = db_name;
            Backing::InMemory
        };

        let handle = spawn(backing, network, lightwalletd_url, min_confirmations)
            .await
            .map_err(err_to_error)?;

        Ok(WebWallet { handle })
    }

    /// Round-trip probe. Retained for diagnostics; unused by the UI.
    pub async fn ping(&self, nonce: u64) -> Result<u64, Error> {
        self.handle.ping(nonce).await.map_err(err_to_error)
    }

    /// Register a spending account from a BIP-39 seed phrase. Routes
    /// through the DB worker, which derives the USK + UFVK and calls
    /// `Wallet::create_account`. Used by the browser-resident signing
    /// backend (`BrowserSigningBackend`) — on the snap path, prefer
    /// [`Self::create_account_sapling_efvk`] /
    /// [`Self::create_account_full_efvk`], which keep the seed inside
    /// the snap sandbox.
    pub async fn create_account(
        &self,
        account_name: &str,
        seed_phrase: &str,
        account_hd_index: u32,
        birthday_height: Option<u32>,
    ) -> Result<u32, Error> {
        self.handle
            .create_account(
                account_name.to_string(),
                seed_phrase.to_string(),
                account_hd_index,
                birthday_height,
            )
            .await
            .map_err(err_to_error)
    }

    /// Import a Sapling-only account from a raw 169-byte ZIP-32
    /// `ExtendedFullViewingKey`. Ycash-compatible (Ycash never activated
    /// NU5, so ZIP-316 UA encoding is not available).
    pub async fn create_account_sapling_efvk(
        &self,
        account_name: &str,
        sapling_efvk_bytes: Box<[u8]>,
        seed_fingerprint: SeedFingerprint,
        account_hd_index: u32,
        birthday_height: Option<u32>,
    ) -> Result<u32, Error> {
        self.handle
            .create_account_sapling_efvk(
                account_name.to_string(),
                sapling_efvk_bytes.into_vec(),
                seed_fingerprint,
                account_hd_index,
                birthday_height,
            )
            .await
            .map_err(err_to_error)
    }

    /// Import a Sapling + transparent account from a raw 169-byte Sapling
    /// EFVK plus a 65-byte transparent `AccountPubKey`. Enables shieldAll
    /// and transparent-receive on snap-backed accounts.
    pub async fn create_account_full_efvk(
        &self,
        account_name: &str,
        sapling_efvk_bytes: Box<[u8]>,
        transparent_account_pubkey_bytes: Box<[u8]>,
        seed_fingerprint: SeedFingerprint,
        account_hd_index: u32,
        birthday_height: Option<u32>,
    ) -> Result<u32, Error> {
        self.handle
            .create_account_full_efvk(
                account_name.to_string(),
                sapling_efvk_bytes.into_vec(),
                transparent_account_pubkey_bytes.into_vec(),
                seed_fingerprint,
                account_hd_index,
                birthday_height,
            )
            .await
            .map_err(err_to_error)
    }

    pub async fn get_wallet_summary(&self) -> Result<Option<WalletSummary>, Error> {
        Ok(self
            .handle
            .get_wallet_summary()
            .await
            .map_err(err_to_error)?
            .map(Into::into))
    }

    /// Get the current Sapling shielded address for the given account,
    /// encoded with the network's HRP (`ys`/`ytestsapling` on Ycash,
    /// `zs`/`ztestsapling` on Zcash).
    pub async fn get_current_address_sapling(&self, account_id: u32) -> Result<String, Error> {
        self.handle
            .get_current_address_sapling(account_id)
            .await
            .map_err(err_to_error)
    }

    pub async fn get_current_address_transparent(&self, account_id: u32) -> Result<String, Error> {
        self.handle
            .get_current_address_transparent(account_id)
            .await
            .map_err(err_to_error)
    }

    pub async fn get_latest_block(&self) -> Result<u64, Error> {
        self.handle.get_latest_block().await.map_err(err_to_error)
    }

    pub async fn sync(&self) -> Result<(), Error> {
        self.handle.sync().await.map_err(err_to_error)
    }

    /// Create a Ycash PCZT v4 spend from `account_id` to `to_address` for
    /// `value` zatoshis. Runs `propose_transfer → create_pczt_from_proposal`
    /// inside the DB worker; the returned PCZT still needs to be signed
    /// (outside this wasm module, in the Snap) and proven
    /// ([`Self::pczt_prove`]) before it can be sent.
    pub async fn pczt_create(
        &self,
        account_id: u32,
        to_address: String,
        value: u64,
    ) -> Result<Pczt, Error> {
        self.handle
            .pczt_create(account_id, to_address, value)
            .await
            .map_err(err_to_error)
    }

    /// Run the Groth16 + halo2 prover over `pczt`. Runs inside the DB
    /// worker (a Web Worker, where `Atomics.wait` is available to rayon);
    /// no separate prove worker is spawned. Expect tens of seconds of CPU
    /// time; render progress UI around the call.
    ///
    /// `sapling_proof_gen_key` is the external-scope Sapling PGK (as
    /// before). `sapling_internal_pgk`, when supplied, is the
    /// internal-scope PGK — needed to spend change and shield-self
    /// outputs, which live in Sapling's internal ZIP-32 scope. The
    /// wallet injects the correct PGK per spend based on which scope's
    /// ivk actually owns the note.
    pub async fn pczt_prove(
        &self,
        pczt: Pczt,
        sapling_proof_gen_key: Option<ProofGenerationKey>,
        sapling_internal_pgk: Option<ProofGenerationKey>,
    ) -> Result<Pczt, Error> {
        let pgk: Option<::sapling::ProofGenerationKey> = sapling_proof_gen_key.map(Into::into);
        let int_pgk: Option<::sapling::ProofGenerationKey> = sapling_internal_pgk.map(Into::into);
        self.handle
            .pczt_prove(pczt, pgk, int_pgk)
            .await
            .map_err(err_to_error)
    }

    /// Extract the signed, proven PCZT into a `v4` Zcash transaction,
    /// persist it locally, and broadcast via lightwalletd.
    pub async fn pczt_send(&self, pczt: Pczt) -> Result<(), Error> {
        self.handle.pczt_send(pczt).await.map_err(err_to_error)
    }

    /// Build a shielding PCZT that sweeps every transparent UTXO for the
    /// given account into the Sapling pool. PCZT-shielding counterpart to
    /// `pczt_create`; the result still needs to pass through
    /// `pczt_prove → pczt_send`.
    pub async fn pczt_shield(&self, account_id: u32) -> Result<Pczt, Error> {
        self.handle
            .pczt_shield(account_id)
            .await
            .map_err(err_to_error)
    }

    /// Autodetect the wallet's birthday by scanning for the first
    /// transaction ever received at a given transparent address. Used by
    /// the recovery UX during import; the lightwalletd call runs inside
    /// the DB worker so the main thread never waits on gRPC.
    pub async fn detect_birthday_from_transparent_address(
        &self,
        transparent_address: &str,
    ) -> Result<Option<u32>, Error> {
        self.handle
            .detect_birthday_from_transparent_address(transparent_address.to_string())
            .await
            .map_err(err_to_error)
    }

    /// Combine partially-constructed PCZTs from multiple roles into a
    /// single PCZT. Pure CPU, but routed through the worker for surface
    /// parity.
    pub async fn pczt_combine(&self, pczts: Vec<Pczt>) -> Result<Pczt, Error> {
        self.handle.pczt_combine(pczts).await.map_err(err_to_error)
    }

    /// Fused `propose_transfer → create_proposed_transactions →
    /// send_authorized_transactions` for the browser-resident signing
    /// backend. Returns the flattened 32-byte txids.
    ///
    /// The three steps are collapsed into one op so the non-serializable
    /// `Proposal<StandardFeeRule, ReceivedNoteId>` never needs to cross
    /// the DB-worker boundary. If a standalone propose / preview step is
    /// ever required, swap this for a handle-based design (see the
    /// `project_sqlite_step6` memo).
    pub async fn send_transfer_from_seed(
        &self,
        account_id: u32,
        to_address: String,
        value: u64,
        seed_phrase: &str,
        account_hd_index: u32,
    ) -> Result<Vec<u8>, Error> {
        let txids = self
            .handle
            .send_transfer_from_seed(
                account_id,
                to_address,
                value,
                seed_phrase.to_string(),
                account_hd_index,
            )
            .await
            .map_err(err_to_error)?;
        Ok(txids.into_iter().flat_map(|id| id.to_vec()).collect())
    }

    /// Shield every transparent UTXO belonging to `account_id` into the
    /// Sapling pool and broadcast. Seed-phrase counterpart to
    /// [`Self::pczt_shield`].
    pub async fn shield(
        &self,
        account_id: u32,
        seed_phrase: &str,
        account_hd_index: u32,
    ) -> Result<(), Error> {
        self.handle
            .shield_from_seed(account_id, seed_phrase.to_string(), account_hd_index)
            .await
            .map_err(err_to_error)
    }

    /// Paginated transaction history for an account. Runs a pair of SQL
    /// queries inside the DB worker against the wallet's `v_transactions`
    /// and `v_tx_outputs` views, so no rusqlite handle crosses the actor
    /// boundary.
    pub async fn get_transaction_history(
        &self,
        account_id: u32,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<TransactionHistoryResponse, Error> {
        self.handle
            .get_transaction_history(account_id, limit.unwrap_or(50), offset.unwrap_or(0))
            .await
            .map_err(err_to_error)
    }

    /// Delete all scanned wallet state and re-run the SQLite schema
    /// migrations. Used by the "full resync" recovery flow: after
    /// `reset()` returns, re-import the account via
    /// [`Self::create_account`] / [`Self::create_account_sapling_efvk`] /
    /// [`Self::create_account_full_efvk`] and call [`Self::sync`] to
    /// rebuild the wallet from the birthday.
    ///
    /// The underlying OPFS file is cleared in place; no new file is
    /// created and no existing `WebWallet` handle is invalidated.
    pub async fn reset(&self) -> Result<(), Error> {
        self.handle.reset().await.map_err(err_to_error)
    }

    /// Return the u32 account handles for every account in the wallet.
    /// More reliable than reading `get_wallet_summary().account_balances`
    /// during bootstrap: the wallet summary returns `None` before the
    /// first sync populates `chain_tip_height`, which would miss a
    /// just-imported account. The JS bootstrap uses this to decide
    /// between "pick up existing account" and "import fresh" without
    /// racing the first sync.
    pub async fn get_account_ids(&self) -> Result<Vec<u32>, Error> {
        self.handle.get_account_ids().await.map_err(err_to_error)
    }
}

/// Convert a [`WorkerError`] to the bindgen-wide [`crate::error::Error`].
fn err_to_error(e: WorkerError) -> Error {
    match e {
        WorkerError::Wallet(msg) => Error::Generic(msg),
        other => Error::Generic(other.to_string()),
    }
}

/// Structured balance summary for one account.
#[derive(Debug, Serialize, Deserialize)]
pub struct AccountBalance {
    pub sapling_balance: u64,
    pub orchard_balance: u64,
    pub unshielded_balance: u64,
    /// Change from sent transactions waiting for mining confirmation
    pub pending_change: u64,
    /// Received notes waiting for required confirmations to become spendable
    pub pending_spendable: u64,
}

/// Wallet-wide summary: per-account balances plus sync progress.
#[derive(Debug, Serialize, Deserialize)]
#[wasm_bindgen(inspectable)]
pub struct WalletSummary {
    pub(crate) account_balances: Vec<(u32, AccountBalance)>,
    pub chain_tip_height: u32,
    pub fully_scanned_height: u32,
    pub next_sapling_subtree_index: u64,
    pub next_orchard_subtree_index: u64,
}

#[wasm_bindgen]
impl WalletSummary {
    #[wasm_bindgen(getter)]
    pub fn account_balances(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.account_balances).unwrap()
    }
}

impl From<WalletSummaryData> for WalletSummary {
    fn from(s: WalletSummaryData) -> Self {
        WalletSummary {
            account_balances: s
                .account_balances
                .into_iter()
                .map(|(id, bal)| (id, bal_from_data(bal)))
                .collect(),
            chain_tip_height: s.chain_tip_height,
            fully_scanned_height: s.fully_scanned_height,
            next_sapling_subtree_index: s.next_sapling_subtree_index,
            next_orchard_subtree_index: s.next_orchard_subtree_index,
        }
    }
}

fn bal_from_data(b: AccountBalanceData) -> AccountBalance {
    AccountBalance {
        sapling_balance: b.sapling_balance,
        orchard_balance: b.orchard_balance,
        unshielded_balance: b.unshielded_balance,
        pending_change: b.pending_change,
        pending_spendable: b.pending_spendable,
    }
}
