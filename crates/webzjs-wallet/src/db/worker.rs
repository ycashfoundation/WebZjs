//! Single-owner DB worker.
//!
//! Implements the step-2 decision: all SQLite operations run inside one
//! dedicated [`wasm_thread`] Worker. The main thread holds a
//! [`DbWorkerHandle`] and drives the worker via an
//! [`mpsc::UnboundedSender`] of [`Envelope`]s; each request carries a
//! [`oneshot::Sender`] for its reply, so callers `.await` a single future
//! per op without sharing any long-lived locks across threads.
//!
//! Step 5 extends the actor from a bare `SqliteWalletDb` owner to a full
//! [`crate::Wallet`] owner — the DB connection is non-`Send` under
//! `sqlite-wasm-rs` (compiled `SQLITE_THREADSAFE=0`), so constructing the
//! `Wallet<SqliteWalletDb, Client>` inside the Worker and never cloning it
//! out keeps the type-system honest and avoids a second
//! `RwLock`-over-mutex layer. Request variants map 1:1 onto the [`WebWallet`](
//! crate::bindgen::wallet::WebWallet) method surface that the UI uses.
//!
//! Proving (CPU-bound, Groth16 + halo2) runs *inside* this Worker rather
//! than in a separate `thread::spawn_async` scope the way the
//! memory-backed path does: rayon's `Atomics.wait` primitive is forbidden
//! only on the browser main thread, not in any Worker, and keeping proving
//! co-located with the DB avoids having to ship proofs back through the
//! actor only to re-acquire a DB write lock on the way out.

use nonempty::NonEmpty;
use sapling::ProofGenerationKey;
use tokio::sync::{mpsc, oneshot};
use tonic_web_wasm_client::Client;
use zcash_address::ZcashAddress;
use zcash_client_backend::data_api::wallet::ConfirmationsPolicy;
use zcash_client_backend::data_api::{AccountPurpose, WalletRead, Zip32Derivation};
use zcash_client_backend::proto::service::{
    BlockId, BlockRange, ChainSpec, TransparentAddressBlockFilter,
};
use zcash_keys::encoding::AddressCodec;
use zcash_keys::keys::{UnifiedAddressRequest, UnifiedFullViewingKey};
use zcash_primitives::transaction::TxId;

use webzjs_common::{Network, Pczt};
use webzjs_keys::SeedFingerprint;

#[cfg(feature = "wasm")]
use crate::bindgen::transaction_history::{
    TransactionHistoryEntry, TransactionHistoryResponse, TransactionStatusType, TransactionType,
};
use crate::db::sqlite::{Error as SqliteError, SqliteWalletDb, WorkerWalletDb};
use crate::error::Error as WalletError;
use crate::Wallet;

/// The concrete wallet type the DB worker owns. Fixes the four
/// [`WalletDb`](zcash_client_sqlite::WalletDb) generic parameters the
/// WebZjs stack expects and pins the gRPC transport to the in-browser
/// `tonic_web_wasm_client::Client`.
pub type WorkerWallet = Wallet<WorkerWalletDb, Client>;

/// An intent-level request sent from the main thread to the DB worker.
///
/// Variants mirror the [`WebWallet`](crate::bindgen::wallet::WebWallet)
/// method surface the UI uses today. Each one is a fully-described unit
/// of work; no SQL or rusqlite handles cross the worker boundary.
///
/// Intentionally does not derive `Debug` — [`webzjs_keys::SeedFingerprint`]
/// and [`pczt::Pczt`] don't, and the in-process channel doesn't need it.
pub enum Request {
    /// Liveness probe. The worker answers [`Response::Pong`] with the same
    /// nonce so callers can match a reply to their request in flight.
    Ping {
        nonce: u64,
    },
    /// Seed-phrase account creation (BrowserSigningBackend path). Derives
    /// the USK inside the worker and imports the corresponding UFVK —
    /// functionally equivalent to [`Request::CreateAccountSaplingEfvk`]
    /// for the snap path, but keeps the seed out of the main thread.
    CreateAccount {
        account_name: String,
        seed_phrase: String,
        account_hd_index: u32,
        birthday_height: Option<u32>,
    },
    CreateAccountSaplingEfvk {
        account_name: String,
        sapling_efvk_bytes: Vec<u8>,
        seed_fingerprint: SeedFingerprint,
        account_hd_index: u32,
        birthday_height: Option<u32>,
    },
    CreateAccountFullEfvk {
        account_name: String,
        sapling_efvk_bytes: Vec<u8>,
        transparent_account_pubkey_bytes: Vec<u8>,
        seed_fingerprint: SeedFingerprint,
        account_hd_index: u32,
        birthday_height: Option<u32>,
    },
    GetWalletSummary,
    GetCurrentAddressSapling {
        account_id: u32,
    },
    GetCurrentAddressTransparent {
        account_id: u32,
    },
    GetLatestBlock,
    Sync,
    PcztCreate {
        account_id: u32,
        to_address: String,
        value: u64,
    },
    PcztProve {
        pczt: Pczt,
        sapling_proof_gen_key: Option<ProofGenerationKey>,
    },
    PcztSend {
        pczt: Pczt,
    },
    PcztShield {
        account_id: u32,
    },
    /// Paginated wallet transaction history. Gated behind `wasm` because
    /// the response type lives in the wasm-bindgen-exposed module; native
    /// test builds don't exercise this op.
    #[cfg(feature = "wasm")]
    GetTransactionHistory {
        account_id: u32,
        limit: u32,
        offset: u32,
    },
    /// Wallet-birthday autodetect. Streams `get_taddress_txids` from
    /// lightwalletd for the given transparent address and returns the
    /// earliest observed block height minus a safety buffer. Routed
    /// through the worker because the gRPC client lives there.
    DetectBirthdayFromTransparentAddress {
        transparent_address: String,
    },
    /// Combine a set of partial PCZTs produced by separate roles (e.g. a
    /// shielded-spend role and a transparent-spend role) into one. Pure
    /// CPU, no DB access — routed through the worker for surface parity
    /// with the memory-backed wallet.
    PcztCombine {
        pczts: Vec<Pczt>,
    },
    /// Fused `propose_transfer → create_proposed_transactions →
    /// send_authorized_transactions` for the browser-signing (seed-in-JS)
    /// path. The memory-backed wallet exposes the three steps
    /// individually; the SQLite-backed wallet collapses them into one op
    /// so the non-serializable `Proposal<StandardFeeRule, ReceivedNoteId>`
    /// never has to cross the actor boundary. Returns the flattened
    /// 32-byte txids, matching `WebWallet::create_proposed_transactions`.
    SendTransferFromSeed {
        account_id: u32,
        to_address: String,
        value: u64,
        seed_phrase: String,
        account_hd_index: u32,
    },
    /// Fused shielding-tx send (classic, non-PCZT) for the browser
    /// signing backend. Runs `propose_shielding →
    /// create_proposed_transactions → send_authorized_transactions`
    /// inside the worker so the seed phrase and non-serializable Proposal
    /// both stay local.
    ShieldFromSeed {
        account_id: u32,
        seed_phrase: String,
        account_hd_index: u32,
    },
    /// Drop every scanned row in the wallet database and rerun the
    /// `zcash_client_sqlite` migration chain against the (now empty)
    /// schema. Used by the full-resync recovery flow — the UI calls
    /// `reset` then re-imports the account and re-runs sync from the
    /// birthday height.
    Reset,
}

/// A reply from the DB worker.
///
/// Each variant is data-only; no references to worker-local state leak
/// back across the boundary. PCZTs are passed by value (they're already
/// `Send + Clone`); a structured wallet summary is serialized here rather
/// than on the main side so the bindgen-facing [`crate::bindgen::wallet::WalletSummary`]
/// wrapper can be a thin conversion.
pub enum Response {
    Pong {
        nonce: u64,
    },
    AccountId(u32),
    WalletSummary(Option<WalletSummaryData>),
    Address(String),
    LatestBlock(u64),
    OptionalHeight(Option<u32>),
    Unit,
    Pczt(Pczt),
    TxIds(Vec<[u8; 32]>),
    #[cfg(feature = "wasm")]
    TransactionHistory(TransactionHistoryResponse),
}

/// Plain-data wallet summary that can cross the actor boundary.
///
/// Mirrors [`crate::bindgen::wallet::WalletSummary`] but exists in the
/// non-wasm-bindgen layer so the worker can construct it without taking
/// a dependency on the bindgen module.
#[derive(Debug, Clone)]
pub struct WalletSummaryData {
    pub account_balances: Vec<(u32, AccountBalanceData)>,
    pub chain_tip_height: u32,
    pub fully_scanned_height: u32,
    pub next_sapling_subtree_index: u64,
    pub next_orchard_subtree_index: u64,
}

#[derive(Debug, Clone, Copy)]
pub struct AccountBalanceData {
    pub sapling_balance: u64,
    pub orchard_balance: u64,
    pub unshielded_balance: u64,
    pub pending_change: u64,
    pub pending_spendable: u64,
}

impl From<zcash_client_backend::data_api::AccountBalance> for AccountBalanceData {
    fn from(balance: zcash_client_backend::data_api::AccountBalance) -> Self {
        AccountBalanceData {
            sapling_balance: balance.sapling_balance().spendable_value().into(),
            orchard_balance: balance.orchard_balance().spendable_value().into(),
            unshielded_balance: balance.unshielded_balance().spendable_value().into(),
            pending_change: balance.change_pending_confirmation().into(),
            pending_spendable: balance.value_pending_spendability().into(),
        }
    }
}

/// Paired request + reply channel, as enqueued on the worker inbox.
struct Envelope {
    req: Request,
    reply: oneshot::Sender<Result<Response, String>>,
}

/// Errors from talking to the DB worker.
#[derive(Debug, thiserror::Error)]
pub enum WorkerError {
    #[error("DB worker terminated before replying")]
    Dead,
    #[error(transparent)]
    Open(#[from] SqliteError),
    #[error("wallet error: {0}")]
    Wallet(String),
    #[error("unexpected response variant from DB worker")]
    UnexpectedResponse,
}

/// Where the worker should place its SQLite file.
pub enum Backing {
    /// Persistent: install sqlite-wasm-rs's sahpool OPFS VFS and open
    /// `file:<name>`.
    #[cfg(all(target_family = "wasm", target_os = "unknown"))]
    Opfs { name: String },
    /// Transient `:memory:` SQLite. Used by tests and non-persistent smoke
    /// scenarios.
    InMemory,
}

/// A handle the main thread holds to send requests to the DB worker.
#[derive(Clone)]
pub struct DbWorkerHandle {
    tx: mpsc::UnboundedSender<Envelope>,
}

impl DbWorkerHandle {
    async fn send(&self, req: Request) -> Result<Response, WorkerError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(Envelope {
                req,
                reply: reply_tx,
            })
            .map_err(|_| WorkerError::Dead)?;
        reply_rx
            .await
            .map_err(|_| WorkerError::Dead)?
            .map_err(WorkerError::Wallet)
    }

    pub async fn ping(&self, nonce: u64) -> Result<u64, WorkerError> {
        match self.send(Request::Ping { nonce }).await? {
            Response::Pong { nonce } => Ok(nonce),
            _ => Err(WorkerError::UnexpectedResponse),
        }
    }

    pub async fn create_account(
        &self,
        account_name: String,
        seed_phrase: String,
        account_hd_index: u32,
        birthday_height: Option<u32>,
    ) -> Result<u32, WorkerError> {
        match self
            .send(Request::CreateAccount {
                account_name,
                seed_phrase,
                account_hd_index,
                birthday_height,
            })
            .await?
        {
            Response::AccountId(id) => Ok(id),
            _ => Err(WorkerError::UnexpectedResponse),
        }
    }

    pub async fn create_account_sapling_efvk(
        &self,
        account_name: String,
        sapling_efvk_bytes: Vec<u8>,
        seed_fingerprint: SeedFingerprint,
        account_hd_index: u32,
        birthday_height: Option<u32>,
    ) -> Result<u32, WorkerError> {
        match self
            .send(Request::CreateAccountSaplingEfvk {
                account_name,
                sapling_efvk_bytes,
                seed_fingerprint,
                account_hd_index,
                birthday_height,
            })
            .await?
        {
            Response::AccountId(id) => Ok(id),
            _ => Err(WorkerError::UnexpectedResponse),
        }
    }

    pub async fn create_account_full_efvk(
        &self,
        account_name: String,
        sapling_efvk_bytes: Vec<u8>,
        transparent_account_pubkey_bytes: Vec<u8>,
        seed_fingerprint: SeedFingerprint,
        account_hd_index: u32,
        birthday_height: Option<u32>,
    ) -> Result<u32, WorkerError> {
        match self
            .send(Request::CreateAccountFullEfvk {
                account_name,
                sapling_efvk_bytes,
                transparent_account_pubkey_bytes,
                seed_fingerprint,
                account_hd_index,
                birthday_height,
            })
            .await?
        {
            Response::AccountId(id) => Ok(id),
            _ => Err(WorkerError::UnexpectedResponse),
        }
    }

    pub async fn get_wallet_summary(&self) -> Result<Option<WalletSummaryData>, WorkerError> {
        match self.send(Request::GetWalletSummary).await? {
            Response::WalletSummary(summary) => Ok(summary),
            _ => Err(WorkerError::UnexpectedResponse),
        }
    }

    pub async fn get_current_address_sapling(
        &self,
        account_id: u32,
    ) -> Result<String, WorkerError> {
        match self
            .send(Request::GetCurrentAddressSapling { account_id })
            .await?
        {
            Response::Address(addr) => Ok(addr),
            _ => Err(WorkerError::UnexpectedResponse),
        }
    }

    pub async fn get_current_address_transparent(
        &self,
        account_id: u32,
    ) -> Result<String, WorkerError> {
        match self
            .send(Request::GetCurrentAddressTransparent { account_id })
            .await?
        {
            Response::Address(addr) => Ok(addr),
            _ => Err(WorkerError::UnexpectedResponse),
        }
    }

    pub async fn get_latest_block(&self) -> Result<u64, WorkerError> {
        match self.send(Request::GetLatestBlock).await? {
            Response::LatestBlock(h) => Ok(h),
            _ => Err(WorkerError::UnexpectedResponse),
        }
    }

    pub async fn sync(&self) -> Result<(), WorkerError> {
        match self.send(Request::Sync).await? {
            Response::Unit => Ok(()),
            _ => Err(WorkerError::UnexpectedResponse),
        }
    }

    pub async fn pczt_create(
        &self,
        account_id: u32,
        to_address: String,
        value: u64,
    ) -> Result<Pczt, WorkerError> {
        match self
            .send(Request::PcztCreate {
                account_id,
                to_address,
                value,
            })
            .await?
        {
            Response::Pczt(pczt) => Ok(pczt),
            _ => Err(WorkerError::UnexpectedResponse),
        }
    }

    pub async fn pczt_prove(
        &self,
        pczt: Pczt,
        sapling_proof_gen_key: Option<ProofGenerationKey>,
    ) -> Result<Pczt, WorkerError> {
        match self
            .send(Request::PcztProve {
                pczt,
                sapling_proof_gen_key,
            })
            .await?
        {
            Response::Pczt(pczt) => Ok(pczt),
            _ => Err(WorkerError::UnexpectedResponse),
        }
    }

    pub async fn pczt_send(&self, pczt: Pczt) -> Result<(), WorkerError> {
        match self.send(Request::PcztSend { pczt }).await? {
            Response::Unit => Ok(()),
            _ => Err(WorkerError::UnexpectedResponse),
        }
    }

    pub async fn pczt_shield(&self, account_id: u32) -> Result<Pczt, WorkerError> {
        match self.send(Request::PcztShield { account_id }).await? {
            Response::Pczt(pczt) => Ok(pczt),
            _ => Err(WorkerError::UnexpectedResponse),
        }
    }

    pub async fn detect_birthday_from_transparent_address(
        &self,
        transparent_address: String,
    ) -> Result<Option<u32>, WorkerError> {
        match self
            .send(Request::DetectBirthdayFromTransparentAddress {
                transparent_address,
            })
            .await?
        {
            Response::OptionalHeight(h) => Ok(h),
            _ => Err(WorkerError::UnexpectedResponse),
        }
    }

    pub async fn pczt_combine(&self, pczts: Vec<Pczt>) -> Result<Pczt, WorkerError> {
        match self.send(Request::PcztCombine { pczts }).await? {
            Response::Pczt(pczt) => Ok(pczt),
            _ => Err(WorkerError::UnexpectedResponse),
        }
    }

    pub async fn send_transfer_from_seed(
        &self,
        account_id: u32,
        to_address: String,
        value: u64,
        seed_phrase: String,
        account_hd_index: u32,
    ) -> Result<Vec<[u8; 32]>, WorkerError> {
        match self
            .send(Request::SendTransferFromSeed {
                account_id,
                to_address,
                value,
                seed_phrase,
                account_hd_index,
            })
            .await?
        {
            Response::TxIds(ids) => Ok(ids),
            _ => Err(WorkerError::UnexpectedResponse),
        }
    }

    pub async fn shield_from_seed(
        &self,
        account_id: u32,
        seed_phrase: String,
        account_hd_index: u32,
    ) -> Result<(), WorkerError> {
        match self
            .send(Request::ShieldFromSeed {
                account_id,
                seed_phrase,
                account_hd_index,
            })
            .await?
        {
            Response::Unit => Ok(()),
            _ => Err(WorkerError::UnexpectedResponse),
        }
    }

    pub async fn reset(&self) -> Result<(), WorkerError> {
        match self.send(Request::Reset).await? {
            Response::Unit => Ok(()),
            _ => Err(WorkerError::UnexpectedResponse),
        }
    }

    #[cfg(feature = "wasm")]
    pub async fn get_transaction_history(
        &self,
        account_id: u32,
        limit: u32,
        offset: u32,
    ) -> Result<TransactionHistoryResponse, WorkerError> {
        match self
            .send(Request::GetTransactionHistory {
                account_id,
                limit,
                offset,
            })
            .await?
        {
            Response::TransactionHistory(resp) => Ok(resp),
            _ => Err(WorkerError::UnexpectedResponse),
        }
    }
}

/// Spawn the DB worker.
///
/// Creates a dedicated Worker that owns a [`WorkerWallet`] for the entire
/// life of the returned [`DbWorkerHandle`]. The function returns only once
/// the worker has successfully opened its database and constructed the
/// wallet (the `ready_rx` handshake below), so callers don't have to
/// handle "worker exists but isn't functional yet".
///
/// The worker exits cleanly when all [`DbWorkerHandle`] clones are
/// dropped: its `rx.recv().await` resolves to `None`, the actor loop
/// returns, and the Worker terminates.
pub async fn spawn(
    backing: Backing,
    network: Network,
    lightwalletd_url: String,
    min_confirmations: ConfirmationsPolicy,
) -> Result<DbWorkerHandle, WorkerError> {
    let (tx, rx) = mpsc::unbounded_channel::<Envelope>();
    let (ready_tx, ready_rx) = oneshot::channel::<Result<(), String>>();

    // Construct `WorkerWallet` inside the worker; its `WalletDb` owns a
    // `rusqlite::Connection` that is deliberately non-`Send` under the
    // sqlite-wasm-rs backend, so we never let it cross thread boundaries.
    let _join =
        wasm_thread::Builder::new()
            .spawn(move || {
                wasm_bindgen_futures::spawn_local(async move {
                    let wallet =
                        match build_wallet(backing, network, &lightwalletd_url, min_confirmations)
                            .await
                        {
                            Ok(w) => {
                                let _ = ready_tx.send(Ok(()));
                                w
                            }
                            Err(e) => {
                                let _ = ready_tx.send(Err(e.to_string()));
                                return;
                            }
                        };

                    actor_loop(wallet, rx).await;
                });
            })
            .expect("wasm_thread::spawn");

    ready_rx
        .await
        .map_err(|_| WorkerError::Dead)?
        .map_err(WorkerError::Wallet)?;
    Ok(DbWorkerHandle { tx })
}

async fn build_wallet(
    backing: Backing,
    network: Network,
    lightwalletd_url: &str,
    min_confirmations: ConfirmationsPolicy,
) -> Result<WorkerWallet, WalletError> {
    let sqlite_db = open(backing, network)
        .await
        .map_err(|e| WalletError::Generic(format!("open sqlite: {e}")))?;

    // Run the `zcash_client_sqlite` migration chain to bring a freshly
    // opened OPFS file up to the current schema. `init_wallet_db` is
    // idempotent: on an already-migrated DB it no-ops.
    {
        use zcash_client_sqlite::wallet::init::init_wallet_db;
        let mut inner = sqlite_db.into_inner();
        init_wallet_db(&mut inner, None)
            .map_err(|e| WalletError::Generic(format!("init_wallet_db: {e:?}")))?;
        let client = Client::new(lightwalletd_url.to_string());
        Wallet::new(inner, client, network, min_confirmations)
    }
}

async fn open(backing: Backing, network: Network) -> Result<SqliteWalletDb, SqliteError> {
    match backing {
        #[cfg(all(target_family = "wasm", target_os = "unknown"))]
        Backing::Opfs { name } => SqliteWalletDb::open_opfs(&name, network).await,
        Backing::InMemory => SqliteWalletDb::open_in_memory(network),
    }
}

async fn actor_loop(mut wallet: WorkerWallet, mut rx: mpsc::UnboundedReceiver<Envelope>) {
    // `rx.recv()` returns `None` only after every `DbWorkerHandle` clone is
    // dropped — that's the shutdown signal.
    while let Some(env) = rx.recv().await {
        let resp = handle(env.req, &mut wallet).await;
        let _ = env.reply.send(resp);
    }
}

async fn handle(req: Request, wallet: &mut WorkerWallet) -> Result<Response, String> {
    match req {
        Request::Ping { nonce } => Ok(Response::Pong { nonce }),

        Request::CreateAccount {
            account_name,
            seed_phrase,
            account_hd_index,
            birthday_height,
        } => {
            let id = wallet
                .create_account(
                    &account_name,
                    &seed_phrase,
                    account_hd_index,
                    birthday_height,
                    None,
                )
                .await
                .map_err(|e| e.to_string())?;
            Ok(Response::AccountId(account_uuid_to_u32(id)))
        }

        Request::CreateAccountSaplingEfvk {
            account_name,
            sapling_efvk_bytes,
            seed_fingerprint,
            account_hd_index,
            birthday_height,
        } => {
            let efvk = ::sapling::zip32::ExtendedFullViewingKey::read(&sapling_efvk_bytes[..])
                .map_err(|e| format!("Sapling EFVK decode: {e}"))?;
            let ufvk = UnifiedFullViewingKey::from_sapling_extended_full_viewing_key(efvk)
                .map_err(|e| format!("UFVK from Sapling EFVK: {e}"))?;
            let derivation = Some(Zip32Derivation::new(
                seed_fingerprint.into(),
                zip32::AccountId::try_from(account_hd_index)
                    .map_err(|e| format!("account HD index: {e}"))?,
            ));
            let id = wallet
                .import_ufvk(
                    &account_name,
                    &ufvk,
                    AccountPurpose::Spending { derivation },
                    birthday_height,
                    None,
                )
                .await
                .map_err(|e| e.to_string())?;
            Ok(Response::AccountId(account_uuid_to_u32(id)))
        }

        Request::CreateAccountFullEfvk {
            account_name,
            sapling_efvk_bytes,
            transparent_account_pubkey_bytes,
            seed_fingerprint,
            account_hd_index,
            birthday_height,
        } => {
            let efvk = ::sapling::zip32::ExtendedFullViewingKey::read(&sapling_efvk_bytes[..])
                .map_err(|e| format!("Sapling EFVK decode: {e}"))?;
            let t_bytes: [u8; 65] =
                transparent_account_pubkey_bytes[..]
                    .try_into()
                    .map_err(|_| {
                        format!(
                            "Transparent AccountPubKey must be 65 bytes, got {}",
                            transparent_account_pubkey_bytes.len()
                        )
                    })?;
            let transparent = ::zcash_transparent::keys::AccountPubKey::deserialize(&t_bytes)
                .map_err(|e| format!("Transparent AccountPubKey decode: {e:?}"))?;
            let ufvk = UnifiedFullViewingKey::from_sapling_and_transparent(efvk, transparent)
                .map_err(|e| format!("UFVK from Sapling+transparent: {e}"))?;
            let derivation = Some(Zip32Derivation::new(
                seed_fingerprint.into(),
                zip32::AccountId::try_from(account_hd_index)
                    .map_err(|e| format!("account HD index: {e}"))?,
            ));
            let id = wallet
                .import_ufvk(
                    &account_name,
                    &ufvk,
                    AccountPurpose::Spending { derivation },
                    birthday_height,
                    None,
                )
                .await
                .map_err(|e| e.to_string())?;
            Ok(Response::AccountId(account_uuid_to_u32(id)))
        }

        Request::GetWalletSummary => {
            let summary = wallet
                .get_wallet_summary()
                .await
                .map_err(|e| e.to_string())?;
            Ok(Response::WalletSummary(summary.map(summary_to_data)))
        }

        Request::GetCurrentAddressSapling { account_id } => {
            let account_uuid = account_uuid_from_u32(wallet, account_id)
                .await
                .ok_or_else(|| format!("Account not found: {account_id}"))?;
            let db = wallet.db.read().await;
            let address = db
                .get_last_generated_address_matching(account_uuid, UnifiedAddressRequest::ALLOW_ALL)
                .map_err(|e| format!("get_last_generated_address_matching: {e}"))?
                .ok_or_else(|| format!("Account not found: {account_id}"))?;
            let sapling = address
                .sapling()
                .ok_or_else(|| format!("Account {account_id} has no Sapling receiver"))?;
            Ok(Response::Address(
                zcash_keys::encoding::encode_payment_address_p(&wallet.network, sapling),
            ))
        }

        Request::GetCurrentAddressTransparent { account_id } => {
            let account_uuid = account_uuid_from_u32(wallet, account_id)
                .await
                .ok_or_else(|| format!("Account not found: {account_id}"))?;
            let db = wallet.db.read().await;
            let address = db
                .get_last_generated_address_matching(account_uuid, UnifiedAddressRequest::ALLOW_ALL)
                .map_err(|e| format!("get_last_generated_address_matching: {e}"))?
                .ok_or_else(|| format!("Account not found: {account_id}"))?;
            let taddr = address
                .transparent()
                .ok_or_else(|| "Account has no transparent component".to_string())?;
            Ok(Response::Address(taddr.encode(&wallet.network)))
        }

        Request::GetLatestBlock => {
            let mut client = wallet.client.clone();
            let height = client
                .get_latest_block(ChainSpec {})
                .await
                .map_err(|e| format!("get_latest_block: {e}"))?
                .into_inner()
                .height;
            Ok(Response::LatestBlock(height))
        }

        Request::Sync => {
            wallet.sync().await.map_err(|e| e.to_string())?;
            Ok(Response::Unit)
        }

        Request::PcztCreate {
            account_id,
            to_address,
            value,
        } => {
            let account_uuid = account_uuid_from_u32(wallet, account_id)
                .await
                .ok_or_else(|| format!("Account not found: {account_id}"))?;
            let to_address =
                ZcashAddress::try_from_encoded(&to_address).map_err(|e| format!("{e}"))?;
            let pczt = wallet
                .pczt_create(account_uuid, to_address, value)
                .await
                .map_err(|e| e.to_string())?;
            Ok(Response::Pczt(pczt.into()))
        }

        Request::PcztProve {
            pczt,
            sapling_proof_gen_key,
        } => {
            let pczt_inner: ::pczt::Pczt = pczt.into();
            let proven = wallet
                .pczt_prove(pczt_inner, sapling_proof_gen_key)
                .await
                .map_err(|e| e.to_string())?;
            Ok(Response::Pczt(proven.into()))
        }

        Request::PcztSend { pczt } => {
            wallet
                .pczt_send(pczt.into())
                .await
                .map_err(|e| e.to_string())?;
            Ok(Response::Unit)
        }

        Request::PcztShield { account_id } => {
            let account_uuid = account_uuid_from_u32(wallet, account_id)
                .await
                .ok_or_else(|| format!("Account not found: {account_id}"))?;
            let pczt = wallet
                .pczt_shield(account_uuid)
                .await
                .map_err(|e| e.to_string())?;
            Ok(Response::Pczt(pczt.into()))
        }

        Request::DetectBirthdayFromTransparentAddress {
            transparent_address,
        } => {
            use futures_util::TryStreamExt;

            // Matches `bindgen::wallet::WebWallet::detect_birthday_from_transparent_address`:
            // scan from Sapling activation to tip, pull the min height we
            // see, back off 100 blocks for safety. Keep the values in sync
            // with that implementation — shared Ycash wallets do this on
            // recovery before any sync has run.
            let mut client = wallet.client.clone();
            let filter = TransparentAddressBlockFilter {
                address: transparent_address,
                range: Some(BlockRange {
                    start: Some(BlockId {
                        height: 419_200,
                        hash: vec![],
                    }),
                    end: Some(BlockId {
                        height: u64::MAX,
                        hash: vec![],
                    }),
                    pool_types: vec![],
                }),
            };
            let response = client
                .get_taddress_txids(filter)
                .await
                .map_err(|e| format!("get_taddress_txids: {e}"))?;
            let mut stream = response.into_inner();
            let mut min_height: Option<u64> = None;
            while let Some(raw_tx) = stream
                .try_next()
                .await
                .map_err(|e| format!("stream: {e}"))?
            {
                let h = raw_tx.height;
                min_height = Some(min_height.map_or(h, |m| m.min(h)));
            }
            Ok(Response::OptionalHeight(
                min_height.map(|h| h.saturating_sub(100) as u32),
            ))
        }

        Request::PcztCombine { pczts } => {
            let combined = wallet
                .pczt_combine(pczts.into_iter().map(Into::into).collect())
                .map_err(|e| e.to_string())?;
            Ok(Response::Pczt(combined.into()))
        }

        Request::SendTransferFromSeed {
            account_id,
            to_address,
            value,
            seed_phrase,
            account_hd_index,
        } => {
            // Derive the USK inside the worker so the seed only ever exists
            // on this thread. Matches the memory-backed `WebWallet::shield`
            // pattern (same function, same error shape).
            let (usk, _) =
                crate::wallet::usk_from_seed_str(&seed_phrase, account_hd_index, &wallet.network)
                    .map_err(|e| e.to_string())?;

            let account_uuid = account_uuid_from_u32(wallet, account_id)
                .await
                .ok_or_else(|| format!("Account not found: {account_id}"))?;
            let to = ZcashAddress::try_from_encoded(&to_address).map_err(|e| format!("{e}"))?;

            let proposal = wallet
                .propose_transfer(account_uuid, to, value)
                .await
                .map_err(|e| e.to_string())?;
            let txids = wallet
                .create_proposed_transactions(proposal, &usk)
                .await
                .map_err(|e| e.to_string())?;
            wallet
                .send_authorized_transactions(&txids)
                .await
                .map_err(|e| e.to_string())?;

            Ok(Response::TxIds(
                txids.into_iter().map(|id| *id.as_ref()).collect(),
            ))
        }

        Request::Reset => {
            // Wipe every user-defined table, index, view, and trigger,
            // then rerun the `zcash_client_sqlite` migration chain to
            // rebuild an empty schema. Using the `writable_schema`
            // trick rather than DROPping each table individually keeps
            // this robust against future schema additions — we don't
            // have to enumerate table names that evolve upstream.
            let mut db = wallet.db.write().await;
            {
                let conn = db.conn();
                conn.pragma_update(None, "writable_schema", "1")
                    .map_err(|e| format!("reset pragma on: {e}"))?;
                conn.execute(
                    "DELETE FROM sqlite_master
                     WHERE type IN ('table', 'index', 'trigger', 'view')
                       AND name NOT LIKE 'sqlite_%'",
                    [],
                )
                .map_err(|e| format!("reset wipe: {e}"))?;
                conn.pragma_update(None, "writable_schema", "0")
                    .map_err(|e| format!("reset pragma off: {e}"))?;
                // `VACUUM` can't run inside an implicit transaction, but
                // rusqlite on the sqlite-wasm-rs backend has autocommit
                // on by default outside explicit `transaction()` calls,
                // so this is fine here.
                conn.execute("VACUUM", [])
                    .map_err(|e| format!("reset vacuum: {e}"))?;
            }
            // Rerun migrations against the now-empty schema. The same
            // code path that `build_wallet` uses at spawn time.
            {
                use zcash_client_sqlite::wallet::init::init_wallet_db;
                init_wallet_db(&mut *db, None)
                    .map_err(|e| format!("reset init_wallet_db: {e:?}"))?;
            }
            Ok(Response::Unit)
        }

        Request::ShieldFromSeed {
            account_id,
            seed_phrase,
            account_hd_index,
        } => {
            let (usk, _) =
                crate::wallet::usk_from_seed_str(&seed_phrase, account_hd_index, &wallet.network)
                    .map_err(|e| e.to_string())?;

            let account_uuid = account_uuid_from_u32(wallet, account_id)
                .await
                .ok_or_else(|| format!("Account not found: {account_id}"))?;

            let proposal = wallet
                .propose_shielding(account_uuid)
                .await
                .map_err(|e| e.to_string())?;
            let txids = wallet
                .create_proposed_transactions(proposal, &usk)
                .await
                .map_err(|e| e.to_string())?;
            wallet
                .send_authorized_transactions(&txids)
                .await
                .map_err(|e| e.to_string())?;

            Ok(Response::Unit)
        }

        #[cfg(feature = "wasm")]
        Request::GetTransactionHistory {
            account_id,
            limit,
            offset,
        } => {
            let account_uuid = account_uuid_from_u32(wallet, account_id)
                .await
                .ok_or_else(|| format!("Account not found: {account_id}"))?;

            // Query the chain tip up front so the per-row confirmation count
            // is consistent across the page. Treat a `None` summary as
            // "no chain tip known" — the SQL path still works, just with
            // `confirmations = 0` on every row.
            let chain_tip_height: Option<u32> = wallet
                .get_wallet_summary()
                .await
                .ok()
                .flatten()
                .map(|s| s.chain_tip_height().into());

            let db = wallet.db.read().await;
            let conn = db.conn();
            let resp =
                query_transaction_history(conn, account_uuid, chain_tip_height, limit, offset)
                    .map_err(|e| format!("tx history: {e}"))?;
            Ok(Response::TransactionHistory(resp))
        }
    }
}

/// Collapse the sqlite `AccountUuid` down to a 32-bit handle the JS side
/// can use as a stable ID. We hash the UUID into the low 32 bits via
/// Default-for-Hasher (`DefaultHasher`); the purpose is only to give JS a
/// numeric key — every lookup that crosses the boundary carries the
/// integer and is resolved back to the canonical `AccountUuid` via
/// [`account_uuid_from_u32`]. Collisions are astronomically unlikely for
/// the small account counts a single wallet holds (typically 1).
fn account_uuid_to_u32(id: zcash_client_sqlite::AccountUuid) -> u32 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    id.hash(&mut hasher);
    (hasher.finish() & 0xFFFF_FFFF) as u32
}

async fn account_uuid_from_u32(
    wallet: &WorkerWallet,
    account_id: u32,
) -> Option<zcash_client_sqlite::AccountUuid> {
    let db = wallet.db.read().await;
    let accounts = db.get_account_ids().ok()?;
    for a in accounts {
        if account_uuid_to_u32(a) == account_id {
            return Some(a);
        }
    }
    None
}

fn summary_to_data<A>(
    summary: zcash_client_backend::data_api::WalletSummary<A>,
) -> WalletSummaryData
where
    A: Copy + std::hash::Hash + Eq,
    A: Into<zcash_client_sqlite::AccountUuid>,
{
    let mut account_balances: Vec<_> = summary
        .account_balances()
        .iter()
        .map(|(k, v)| (account_uuid_to_u32((*k).into()), (*v).into()))
        .collect();
    account_balances.sort_by(|a, b| a.0.cmp(&b.0));

    WalletSummaryData {
        account_balances,
        chain_tip_height: summary.chain_tip_height().into(),
        fully_scanned_height: summary.fully_scanned_height().into(),
        next_sapling_subtree_index: summary.next_sapling_subtree_index(),
        next_orchard_subtree_index: summary.next_orchard_subtree_index(),
    }
}

/// Consumes the [`NonEmpty`] of TxIds a `send_authorized_transactions`
/// result carries. Intentionally unused today — the `Send` op is folded
/// into `PcztSend` — but kept because the memory-backed Wallet returns
/// [`TxId`] lists directly and step 6 (tx history) will want this shape
/// without re-introducing the conversion at the call site.
#[allow(dead_code)]
fn txids_to_bytes(txids: NonEmpty<TxId>) -> Vec<[u8; 32]> {
    txids.into_iter().map(|id| *id.as_ref()).collect()
}

/// Paginated transaction history for the given account.
#[cfg(feature = "wasm")]
///
/// Runs two queries against the `zcash_client_sqlite` views:
///
/// 1. `v_transactions` — one row per tx with aggregated balance deltas,
///    block height, block time, and status flags.
/// 2. `v_tx_outputs` — one row per wallet-visible output, used to derive
///    the pool (transparent / sapling / orchard / mixed) and decode any
///    text memos.
///
/// The memory-backed path in `bindgen::transaction_history` builds the
/// same response shape by iterating `received_notes`, `sent_notes`, and
/// `transparent_received_outputs` in Rust; the SQLite path leans on the
/// views the schema already maintains. Output parity is exercised through
/// `sqlite_worker_smoke::get_transaction_history_on_empty_wallet`, and
/// in the dev browser on an account with
/// history.
fn query_transaction_history(
    conn: &rusqlite::Connection,
    account_uuid: zcash_client_sqlite::AccountUuid,
    chain_tip_height: Option<u32>,
    limit: u32,
    offset: u32,
) -> Result<TransactionHistoryResponse, rusqlite::Error> {
    // `AccountUuid` wraps a `uuid::Uuid`; rusqlite serializes `Uuid` via
    // the `uuid` feature (enabled by the fork) as a 16-byte BLOB, which
    // matches how `zcash_client_sqlite` stores `accounts.uuid`.
    let uuid = account_uuid.expose_uuid();

    let total_count: u32 = conn
        .prepare_cached("SELECT COUNT(*) FROM v_transactions WHERE account_uuid = ?1")?
        .query_row(rusqlite::params![uuid], |r| r.get::<_, u32>(0))?;

    // `mined_height IS NULL DESC` sorts unmined (pending) txs before mined
    // txs; among mined txs, newest first. Ties inside a block use
    // `tx_index DESC` to keep a stable order across refetches.
    let mut stmt = conn.prepare_cached(
        "SELECT
            txid,
            mined_height,
            account_balance_delta,
            total_received,
            fee_paid,
            sent_note_count,
            received_note_count,
            expired_unmined,
            is_shielding,
            block_time
         FROM v_transactions
         WHERE account_uuid = ?1
         ORDER BY mined_height IS NULL DESC, mined_height DESC, tx_index DESC
         LIMIT ?2 OFFSET ?3",
    )?;

    struct Row {
        txid: [u8; 32],
        mined_height: Option<u32>,
        balance_delta: i64,
        total_received: i64,
        fee_paid: Option<u64>,
        sent_count: u32,
        received_count: u32,
        expired_unmined: bool,
        is_shielding: bool,
        block_time: Option<i64>,
    }

    let rows: Vec<Row> = stmt
        .query_and_then::<_, rusqlite::Error, _, _>(rusqlite::params![uuid, limit, offset], |r| {
            Ok(Row {
                txid: r.get::<_, [u8; 32]>("txid")?,
                mined_height: r.get::<_, Option<u32>>("mined_height")?,
                balance_delta: r.get::<_, i64>("account_balance_delta")?,
                total_received: r.get::<_, i64>("total_received")?,
                fee_paid: r.get::<_, Option<i64>>("fee_paid")?.map(|v| v as u64),
                sent_count: r.get::<_, u32>("sent_note_count")?,
                received_count: r.get::<_, u32>("received_note_count")?,
                expired_unmined: r.get::<_, bool>("expired_unmined")?,
                is_shielding: r.get::<_, bool>("is_shielding")?,
                block_time: r.get::<_, Option<i64>>("block_time")?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // Fetch outputs (pool + memo bytes) for the paginated txids. A tx can
    // have outputs in multiple pools, so we aggregate in Rust rather than
    // using SQL GROUP_CONCAT — the logic matches the memory-backed path's
    // `acc.pools` HashSet and `acc.memos` Vec.
    let mut outputs: std::collections::HashMap<
        [u8; 32],
        (std::collections::HashSet<u8>, Vec<String>),
    > = std::collections::HashMap::new();
    if !rows.is_empty() {
        let mut stmt_outputs = conn.prepare_cached(
            "SELECT txid, output_pool, memo
             FROM v_tx_outputs
             WHERE (from_account_uuid = ?1 OR to_account_uuid = ?1)",
        )?;
        let mut query = stmt_outputs.query(rusqlite::params![uuid])?;
        while let Some(r) = query.next()? {
            let txid: [u8; 32] = r.get("txid")?;
            let pool_code: u8 = r.get("output_pool")?;
            let memo_bytes: Option<Vec<u8>> = r.get("memo")?;
            let entry = outputs.entry(txid).or_default();
            entry.0.insert(pool_code);
            if let Some(bytes) = memo_bytes {
                if let Some(text) = decode_memo_text(&bytes) {
                    if !text.is_empty() && !entry.1.contains(&text) {
                        entry.1.push(text);
                    }
                }
            }
        }
    }

    let tip = chain_tip_height;
    let entries: Vec<TransactionHistoryEntry> = rows
        .into_iter()
        .map(|row| {
            let txid_display = TxId::from_bytes(row.txid).to_string();

            let tx_type = if row.is_shielding {
                TransactionType::Shielded
            } else if row.balance_delta > 0 || (row.sent_count == 0 && row.received_count > 0) {
                TransactionType::Received
            } else if row.balance_delta < 0 || row.sent_count > 0 {
                TransactionType::Sent
            } else {
                TransactionType::Received
            };

            let value = match tx_type {
                // Mirror the memory-backed path: shielded txs report the
                // total inbound value (what landed in the shielded pool),
                // not the net zero/near-zero delta after fees.
                TransactionType::Shielded => row.total_received,
                _ => row.balance_delta,
            };

            // Only report a fee on the sending side. The memory-backed path
            // leaves `fee` unset for received txs, so parity is what the UI
            // expects.
            let fee = match tx_type {
                TransactionType::Sent | TransactionType::Shielded => row.fee_paid,
                TransactionType::Received => None,
            };

            let confirmations = match (row.mined_height, tip) {
                (Some(h), Some(t)) if t >= h => t - h + 1,
                _ => 0,
            };

            let status = if row.mined_height.is_some() {
                TransactionStatusType::Confirmed
            } else if row.expired_unmined {
                TransactionStatusType::Expired
            } else {
                TransactionStatusType::Pending
            };

            let (pools, memos) = outputs.remove(&row.txid).unwrap_or_default();
            let pool = aggregate_pool(&pools);
            let memo = if memos.is_empty() {
                None
            } else {
                Some(memos.join("\n"))
            };

            TransactionHistoryEntry {
                txid: txid_display,
                tx_type,
                value,
                fee,
                block_height: row.mined_height,
                confirmations,
                status,
                memo,
                timestamp: row.block_time.map(|t| t as u64),
                pool,
            }
        })
        .collect();

    let has_more = (offset as u64) + (entries.len() as u64) < total_count as u64;

    Ok(TransactionHistoryResponse {
        transactions: entries,
        total_count,
        has_more,
    })
}

/// Decodes the textual portion of a Zcash memo, or returns `None` if the
/// memo is empty, a non-text variant (arbitrary / future), or fails to
/// parse. Mirrors the memory-backed extraction in
/// `bindgen::transaction_history` which only surfaces `Memo::Text` values
/// to the UI.
#[cfg(feature = "wasm")]
fn decode_memo_text(bytes: &[u8]) -> Option<String> {
    // `Memo::from_bytes` expects exactly 512 bytes; outputs in the DB can
    // be shorter if the backend hasn't padded them, so right-pad with
    // `0xF6` (the no-memo marker) before decoding.
    let mut padded = [0xF6u8; 512];
    let n = bytes.len().min(512);
    padded[..n].copy_from_slice(&bytes[..n]);
    match zcash_protocol::memo::Memo::from_bytes(&padded) {
        Ok(zcash_protocol::memo::Memo::Text(text)) => Some(text.to_string()),
        _ => None,
    }
}

#[cfg(feature = "wasm")]
fn aggregate_pool(pools: &std::collections::HashSet<u8>) -> String {
    // `output_pool` codes come from `zcash_client_sqlite`'s view: 0 =
    // transparent, 2 = sapling, 3 = orchard. An empty set can legitimately
    // happen for a pending tx where no outputs have been materialized in
    // v_tx_outputs yet — surface that as "unknown" rather than panicking.
    if pools.len() > 1 {
        "mixed".to_string()
    } else {
        match pools.iter().next().copied() {
            Some(0) => "transparent".to_string(),
            Some(2) => "sapling".to_string(),
            Some(3) => "orchard".to_string(),
            Some(n) => format!("pool_{n}"),
            None => "unknown".to_string(),
        }
    }
}
