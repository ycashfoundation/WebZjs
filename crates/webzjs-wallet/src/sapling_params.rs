//! Externally-loaded Sapling proving parameters.
//!
//! The Sapling trusted-setup parameters (~51 MB combined) used to be bundled
//! into the wasm binary via `zcash_proofs`'s `bundled-prover` feature. That
//! made the wallet a single ~60 MB download and easy to reason about, but
//! meant every page load shipped the full prover blob whether the user ever
//! sent a transaction or not.
//!
//! With this module the wasm bundle drops to ~8 MB. The JS host is
//! responsible for fetching `sapling-spend.params` + `sapling-output.params`
//! (from download.z.cash or any mirror — these are byte-identical to Zcash's
//! trusted setup) and pushing them into the wasm module via
//! [`set_sapling_params`]. The prover is parsed once and memoized; subsequent
//! calls reuse the same [`LocalTxProver`] across every spend/PCZT flow.
//!
//! Ordering: the JS side should start this fetch as early as possible (at
//! page load, not at "Send" click) so the wallet is always spend-ready once
//! the user reaches the Send page.

use std::sync::OnceLock;

use wasm_bindgen::prelude::*;
use zcash_proofs::prover::LocalTxProver;

use crate::error::Error;

static PROVER: OnceLock<LocalTxProver> = OnceLock::new();

/// Install the Sapling proving parameters.
///
/// `spend` must be the contents of `sapling-spend.params` (47,958,396 bytes,
/// sha256 `8e48ffd23abb3a5fd9c5589204f32d9c31285a04b78096ba40a79b75677efc13`);
/// `output` must be the contents of `sapling-output.params` (3,592,860 bytes,
/// sha256 `2f0ebbcbb9bb0bcffe95a397e7eba89c29eb4dde6191c339db88570e3f3fb0e4`).
/// (The librustzcash `parse_parameters` call additionally BLAKE2b-verifies
/// the parsed circuit shape before the prover is usable, so a bad payload
/// still fails loudly at install time even if the SHA-256 is forged.)
/// Both files are byte-identical to Zcash mainnet's trusted setup output;
/// Ycash forked post-Sapling and never re-ran the ceremony.
///
/// Returns an error if the params have already been set on this wasm module
/// instance — this function is idempotent-via-failure rather than silent
/// replacement, so the JS side can notice wasted work.
#[wasm_bindgen(js_name = setSaplingParams)]
pub fn set_sapling_params(spend: Vec<u8>, output: Vec<u8>) -> Result<(), JsError> {
    let prover = LocalTxProver::from_bytes(&spend, &output);
    PROVER
        .set(prover)
        .map_err(|_| JsError::new("Sapling params are already loaded"))
}

/// JS probe: has [`set_sapling_params`] succeeded on this module yet?
#[wasm_bindgen(js_name = saplingParamsLoaded)]
pub fn sapling_params_loaded() -> bool {
    PROVER.get().is_some()
}

/// Rust-internal accessor used by the PCZT prove / send paths.
pub(crate) fn prover() -> Result<&'static LocalTxProver, Error> {
    PROVER.get().ok_or(Error::SaplingParamsNotLoaded)
}
