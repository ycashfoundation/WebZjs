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
use crate::ledger_sign::{build_ledger_tx_input, slice_32_chunks, slice_64_chunks};
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

    /// Attach a standalone transparent pubkey to an existing account.
    /// For accounts whose only transparent key material is a single
    /// 33-byte compressed pubkey with no chain code (e.g. the Ycash
    /// Ledger app, which exposes `m/44'/347'/0'/0/0` only). The
    /// imported pubkey lands in the `addresses` table as an
    /// `imported_transparent_receiver_pubkey`, and the wallet's
    /// transparent UTXO scanner will then recognise UTXOs at the
    /// corresponding `s1…` as belonging to this account.
    ///
    /// Pre-requisite: the account must already exist (created via
    /// [`Self::create_account_sapling_efvk`] or
    /// [`Self::create_account_full_efvk`]). For Ledger-style accounts
    /// without a UFVK transparent component, this is the only way to
    /// register transparent receivers; standard ZIP-32 child
    /// derivation isn't possible because the device doesn't expose a
    /// chain code.
    ///
    /// `pubkey_bytes` must be the 33-byte SEC1 compressed pubkey
    /// (matches the format the Ycash Ledger app returns from
    /// `GET_PUBKEY`).
    ///
    /// Requires the `transparent-key-import` feature on
    /// `zcash_client_sqlite` / `zcash_client_backend` (enabled in
    /// the WebZjs workspace).
    pub async fn import_transparent_pubkey(
        &self,
        account_id: u32,
        pubkey_bytes: Box<[u8]>,
    ) -> Result<(), Error> {
        self.handle
            .import_transparent_pubkey(account_id, pubkey_bytes.into_vec())
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
    ///
    /// `memo`, when provided, is attached as a ZIP-302 text memo on the
    /// Sapling output. Must be ≤ 512 UTF-8 bytes. Supplying a memo with a
    /// transparent recipient fails with `UnsupportedMemoRecipient`.
    pub async fn pczt_create(
        &self,
        account_id: u32,
        to_address: String,
        value: u64,
        memo: Option<String>,
    ) -> Result<Pczt, Error> {
        self.handle
            .pczt_create(account_id, to_address, value, memo)
            .await
            .map_err(err_to_error)
    }

    /// Ledger-signed counterpart to [`Self::pczt_create`]. Builds the
    /// same one-payment v4 PCZT, but pre-commits each Sapling spend's
    /// `alpha` and each output's ZIP-212 `rseed` to caller-supplied
    /// bytes so the on-device wide-reduction (alpha) and `cmu`
    /// recomputation (rseed) on the Ycash Ledger app agree with what
    /// the bundle embeds.
    ///
    /// Returns the unsigned PCZT plus per-spend / per-output entropy in
    /// bundle order. JS consumers feed this to the Ledger driver
    /// (`pczt_sign_with_ledger`); the alpha and rseed vectors line up
    /// with `pczt.sapling.spends` / `pczt.sapling.outputs` respectively.
    pub async fn pczt_create_for_ledger(
        &self,
        account_id: u32,
        to_address: String,
        value: u64,
        memo: Option<String>,
    ) -> Result<PcztForLedger, Error> {
        let (pczt, spend_alphas, output_rseeds) = self
            .handle
            .pczt_create_for_ledger(account_id, to_address, value, memo)
            .await
            .map_err(err_to_error)?;
        Ok(PcztForLedger {
            pczt,
            spend_alphas,
            output_rseeds,
        })
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

    /// Drive a connected Ycash Ledger device through one full
    /// v4/ZIP-243 signing pipeline and return a signed PCZT, ready to
    /// be handed to [`Self::pczt_send`].
    ///
    /// Inputs:
    /// * `pczt` — the unsigned PCZT returned from
    ///   [`Self::pczt_create_for_ledger`].
    /// * `spend_alphas` — flat concatenation of 64-byte per-spend alpha
    ///   buffers in bundle order (the `spend_alphas` getter on
    ///   [`PcztForLedger`]).
    /// * `output_rseeds` — flat concatenation of 32-byte per-output
    ///   rseed buffers in bundle order (the `output_rseeds` getter on
    ///   [`PcztForLedger`]).
    /// * `apdu` — JS-supplied `(Uint8Array) => Promise<Uint8Array>`
    ///   that exchanges one APDU with the device and returns the raw
    ///   response (status word included).
    ///
    /// Internally:
    /// 1. Sends `GET_PROOFGEN_KEY` to fetch the device's Sapling PGK.
    /// 2. Runs `pczt_prove` inside the DB worker with that PGK fed to
    ///    both external and internal scopes (the Ycash Ledger app only
    ///    derives one ZIP-32 path).
    /// 3. Serializes each proven Sapling spend / output into the device's
    ///    wire format and walks the
    ///    `INIT_TX → T_IN → T_OUT → S_IN → S_OUT → FEE → SIGN` state
    ///    machine in [`webzjs_ledger::sign_with_ledger`].
    /// 4. Cross-checks the device's computed v4 sighash against the
    ///    host-side `Signer::shielded_sighash` (a mismatch means the
    ///    device and host disagree about the transaction effects — any
    ///    signature it produced would reject downstream, so fail loud
    ///    here).
    /// 5. Applies every Sapling spend signature and every transparent
    ///    ECDSA signature back to the PCZT via the `Signer` role.
    ///
    /// The returned PCZT is post-Signer but pre-Extractor; the binding
    /// signature is produced automatically inside `pczt_send` when the
    /// `TransactionExtractor` runs.
    pub async fn pczt_sign_with_ledger(
        &self,
        pczt: Pczt,
        spend_alphas: Vec<u8>,
        output_rseeds: Vec<u8>,
        apdu: js_sys::Function,
    ) -> Result<Pczt, Error> {
        use pczt::roles::signer::Signer;
        use webzjs_ledger::{transport::ins, ApduCallback};

        let alphas = slice_64_chunks(&spend_alphas).ok_or_else(|| {
            Error::Generic(format!(
                "spend_alphas length {} is not a multiple of 64",
                spend_alphas.len()
            ))
        })?;
        let rseeds = slice_32_chunks(&output_rseeds).ok_or_else(|| {
            Error::Generic(format!(
                "output_rseeds length {} is not a multiple of 32",
                output_rseeds.len()
            ))
        })?;

        let apdu_cb = ApduCallback::new(apdu);

        // 1a. Warm the device's key cache with a GET_FVK before
        //     GET_PROOFGEN_KEY. The Ycash app's GET_PROOFGEN_KEY
        //     handler (zcash-ledger/src/apdu/dispatcher.c:258-266)
        //     reads `G_context.proofk_info.ak` directly without
        //     calling `derive_default_keys()` first, so if the device
        //     was just powered on / unlocked / app re-opened, the ak
        //     is uninitialized zeros and parsing fails with "invalid
        //     ak". GET_FVK (INS 0x07) does call `derive_default_keys`
        //     and populates `G_context`, after which GET_PROOFGEN_KEY
        //     reads valid bytes. Discard the response — we only need
        //     the side effect on device state.
        apdu_cb
            .apdu_send_recv(&[
                webzjs_ledger::transport::CLA,
                ins::GET_FVK,
                0,
                0,
                0,
            ])
            .await
            .map_err(|e| Error::Generic(format!("Ledger GET_FVK (warm-up) failed: {e}")))?;

        // 1b. Fetch the device's Sapling proof-generation key (ak || nsk).
        let pgk_bytes = apdu_cb
            .apdu_send_recv(&[
                webzjs_ledger::transport::CLA,
                ins::GET_PROOFGEN_KEY,
                0,
                0,
                0,
            ])
            .await
            .map_err(|e| Error::Generic(format!("Ledger GET_PROOFGEN_KEY failed: {e}")))?;
        if pgk_bytes.len() != 64 {
            return Err(Error::Generic(format!(
                "Ledger GET_PROOFGEN_KEY returned {} bytes, expected 64",
                pgk_bytes.len()
            )));
        }
        let pgk_wrapper = ProofGenerationKey::from_bytes(&pgk_bytes)
            .map_err(|e| Error::Generic(format!("PGK from device bytes: {e:?}")))?;
        let sapling_pgk: ::sapling::ProofGenerationKey = pgk_wrapper.into();

        // 2. Prove inside the DB worker. The Ycash Ledger app holds one
        //    ZIP-32 path; supplying the same PGK as both external and
        //    internal scope is correct for Ledger-managed accounts
        //    (every spendable note for the account lives under that
        //    one PGK).
        let proven_wrapper = self
            .handle
            .pczt_prove(pczt, Some(sapling_pgk.clone()), Some(sapling_pgk))
            .await
            .map_err(err_to_error)?;
        let proven: ::pczt::Pczt = proven_wrapper.into();

        // 3. Build the wire-format input for the Ledger driver and run
        //    the device pipeline. Borrowing `proven` here ends with the
        //    `LedgerTxInput`'s owned-byte copy, so `proven` is free to
        //    move into the Signer below.
        let ledger_input = build_ledger_tx_input(&proven, &alphas, &rseeds)?;
        let device_sigs = webzjs_ledger::sign_with_ledger(&ledger_input, &apdu_cb)
            .await
            .map_err(|e| Error::Generic(format!("Ledger sign pipeline: {e}")))?;

        // 4. Cross-check sighashes. If the device computed a different
        //    sighash than the host, every spend signature it produced
        //    is over a different message and would reject in the
        //    Extractor's `verify_bundle` step. Fail loudly *here* with
        //    a clear error rather than letting a broadcast attempt
        //    surface as a network-side `BadProofSignature`.
        let mut signer = Signer::new(proven)
            .map_err(|e| Error::Generic(format!("Signer::new on proven PCZT: {e:?}")))?;
        let host_sighash = signer.shielded_sighash();
        if let Some(device_sighash) = device_sigs.shielded_sighash {
            if device_sighash != host_sighash {
                return Err(Error::Generic(format!(
                    "Ledger sighash mismatch: host=0x{} device=0x{}",
                    hex::encode(host_sighash),
                    hex::encode(device_sighash)
                )));
            }
        } else if !ledger_input.shielded_spends.is_empty() {
            return Err(Error::Generic(
                "Ledger did not return a shielded sighash for a transaction with Sapling spends"
                    .to_string(),
            ));
        }

        // 5. Apply Sapling spend signatures. Bundle order matches the
        //    order `shielded_spends` was streamed to the device, which
        //    matches the order the host walks `sapling.spends()`.
        if device_sigs.spend_auth_sigs.len() != ledger_input.shielded_spends.len() {
            return Err(Error::Generic(format!(
                "Ledger returned {} spend auth sigs, expected {}",
                device_sigs.spend_auth_sigs.len(),
                ledger_input.shielded_spends.len()
            )));
        }
        for (i, sig_bytes) in device_sigs.spend_auth_sigs.iter().enumerate() {
            let sig = redjubjub::Signature::<redjubjub::SpendAuth>::from(*sig_bytes);
            signer
                .apply_sapling_signature(i, sig)
                .map_err(|e| Error::Generic(format!("apply_sapling_signature[{i}]: {e:?}")))?;
        }

        // 6. Apply transparent ECDSA signatures. The device returns
        //    compact 64-byte (r || s); `Signer::append_transparent_signature`
        //    takes a `secp256k1::ecdsa::Signature` and handles DER
        //    encoding + `SIGHASH_ALL` byte + script_sig assembly.
        if device_sigs.transparent_sigs.len() != ledger_input.transparent_inputs.len() {
            return Err(Error::Generic(format!(
                "Ledger returned {} transparent sigs, expected {}",
                device_sigs.transparent_sigs.len(),
                ledger_input.transparent_inputs.len()
            )));
        }
        for (i, sig_bytes) in device_sigs.transparent_sigs.iter().enumerate() {
            let sig = secp256k1::ecdsa::Signature::from_compact(sig_bytes).map_err(|e| {
                Error::Generic(format!(
                    "transparent compact sig[{i}] is not a valid ECDSA signature: {e}"
                ))
            })?;
            signer
                .append_transparent_signature(i, sig)
                .map_err(|e| Error::Generic(format!("append_transparent_signature[{i}]: {e:?}")))?;
        }

        Ok(signer.finish().into())
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

    /// Ledger-signed counterpart to [`Self::pczt_shield`]. Builds the
    /// unsigned shield-from-transparent PCZT and the bundle-order
    /// entropy needed for the device to compute matching `alpha` /
    /// `rseed`. Sapling spends are usually empty (transparent →
    /// Sapling), but the Sapling destination + change still need
    /// `rseed` agreement.
    ///
    /// Hand the result to [`Self::pczt_sign_with_ledger`] and then
    /// [`Self::pczt_send`].
    pub async fn pczt_shield_for_ledger(
        &self,
        account_id: u32,
    ) -> Result<PcztForLedger, Error> {
        let (pczt, spend_alphas, output_rseeds) = self
            .handle
            .pczt_shield_for_ledger(account_id)
            .await
            .map_err(err_to_error)?;
        Ok(PcztForLedger {
            pczt,
            spend_alphas,
            output_rseeds,
        })
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
        memo: Option<String>,
    ) -> Result<Vec<u8>, Error> {
        let txids = self
            .handle
            .send_transfer_from_seed(
                account_id,
                to_address,
                value,
                seed_phrase.to_string(),
                account_hd_index,
                memo,
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

/// JS-facing return value of [`WebWallet::pczt_create_for_ledger`]:
/// the unsigned PCZT plus per-Sapling-spend and per-Sapling-output
/// entropy in **bundle order**. JS consumes the entropy as flat byte
/// vectors (64 bytes per spend, 32 bytes per output) — the matching
/// `spend_count` / `output_count` getters tell the driver how to slice
/// them.
///
/// Returned across the wasm boundary by reference, so the Pczt is
/// extracted via [`Self::take_pczt`] (Pczt is `!Copy`); the entropy
/// readers are cheap copies.
#[wasm_bindgen]
pub struct PcztForLedger {
    pczt: Pczt,
    spend_alphas: Vec<[u8; 64]>,
    output_rseeds: Vec<[u8; 32]>,
}

#[wasm_bindgen]
impl PcztForLedger {
    /// Consume `self` and return the inner PCZT.
    #[wasm_bindgen(js_name = takePczt)]
    pub fn take_pczt(self) -> Pczt {
        self.pczt
    }

    /// Number of Sapling spends in the bundle (each contributes 64
    /// bytes to [`Self::spend_alphas`]).
    #[wasm_bindgen(getter, js_name = spendCount)]
    pub fn spend_count(&self) -> usize {
        self.spend_alphas.len()
    }

    /// Number of Sapling outputs in the bundle (each contributes 32
    /// bytes to [`Self::output_rseeds`]).
    #[wasm_bindgen(getter, js_name = outputCount)]
    pub fn output_count(&self) -> usize {
        self.output_rseeds.len()
    }

    /// Flat concatenation of per-spend 64-byte `alpha` buffers in
    /// bundle order. Total length is `64 * spend_count`.
    #[wasm_bindgen(getter, js_name = spendAlphas)]
    pub fn spend_alphas(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.spend_alphas.len() * 64);
        for a in &self.spend_alphas {
            out.extend_from_slice(a);
        }
        out
    }

    /// Flat concatenation of per-output 32-byte `rseed` buffers in
    /// bundle order. Total length is `32 * output_count`.
    #[wasm_bindgen(getter, js_name = outputRseeds)]
    pub fn output_rseeds(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.output_rseeds.len() * 32);
        for r in &self.output_rseeds {
            out.extend_from_slice(r);
        }
        out
    }
}
