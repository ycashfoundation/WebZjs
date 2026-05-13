//! Browser-side driver for the Ycash Ledger app (Nano S+ "Ycash"
//! firmware on branch `ycash-display`). The host's job is to:
//!
//!   1. Drive the device through its v4/ZIP-243 state-machine APDUs in
//!      the exact `IDLE → T_IN → T_OUT → S_IN → S_OUT → FEE → SIGN`
//!      order the firmware enforces (see `zcash-ledger/src/types.h`).
//!   2. Stream proven SpendDescription (320 B) / OutputDescription
//!      (948 B) bytes the host built using
//!      `sapling-crypto::SpendInfo::new_with_external_signer_alpha`
//!      and `OutputInfo::new_with_external_signer_rseed`, so the
//!      device's wide-reduction of the same 64-byte alpha produces a
//!      `spend_auth_sig` that verifies against the bundle's `rk` and
//!      the device's `cmu` (from `(diversifier, pk_d, value, rseed)`)
//!      matches the bundle's.
//!   3. Collect the device-computed 32-byte ZIP-243 sighash, the
//!      per-spend redjubjub signatures, and the per-input ECDSA
//!      signatures, and hand them back to the caller. Applying them to
//!      a PCZT and computing the host-side binding-sig is the caller's
//!      job (lives in `webzjs-wallet`).
//!
//! The crate is wire-only: it has no opinion on PCZTs, librustzcash
//! types, or transaction proposals — those live one layer up.
//!
//! Transport is a JS-supplied callback (typically
//! `@ledgerhq/hw-transport-webhid::send`) passed across the wasm
//! boundary. Every APDU exchange is an `await` round-trip; the
//! sequencing is purely sequential because the device has one signing
//! pipeline at a time.

pub mod driver;
pub mod error;
pub mod transport;

pub use driver::{
    sign_with_ledger, LedgerTxInput, LedgerTxSignatures, ShieldedOutputInput, ShieldedSpendInput,
    TransparentInputInput, TransparentOutputInput,
};
pub use error::LedgerError;
pub use transport::ApduCallback;
