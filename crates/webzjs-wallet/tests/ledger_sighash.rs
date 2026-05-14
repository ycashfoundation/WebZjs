//! Consensus-critical regression test for the host's v4/ZIP-243 sighash
//! computation against a captured Ledger-device signing session.
//!
//! `pczt_sign_with_ledger` cross-checks `Signer::shielded_sighash` against
//! the device's `GET_S_SIGHASH` response and fails loudly on mismatch — a
//! divergence in production means every signature the device produced is
//! over a different message and consensus rejects the broadcast. The guard
//! already covers the runtime case; this test fences a *host-side*
//! regression (changes to `pczt`/`zcash_primitives` v4 sighash code or the
//! PCZT format) from silently breaking that guard without a device handy.
//!
//! Fixture: `ledger_v4_pczt.bin` is the serialized proven PCZT and
//! `ledger_v4_sighash.hex` is the 32-byte sighash, both captured from a
//! real Ledger Nano S+ signing run on Ycash mainnet
//! (txid 697778a4cddcbafa3605b4c77b6756e9d77b25f154ab0b56ea410767dc97f201,
//! 2026-05-14). The expected sighash is the *device's* value, not a
//! host-recomputed one — so the assertion is "host agrees with device,"
//! not "host agrees with itself."
//!
//! Runs both natively (`cargo test`) and under `wasm-pack test`. No
//! browser features are exercised; the PCZT parse + sighash compute is
//! pure Rust.

use pczt::roles::signer::Signer;
use pczt::Pczt;

#[cfg(all(target_family = "wasm", target_os = "unknown"))]
use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

#[cfg(all(target_family = "wasm", target_os = "unknown"))]
wasm_bindgen_test_configure!(run_in_browser);

const PCZT_BYTES: &[u8] = include_bytes!("./fixtures/ledger_v4_pczt.bin");
const EXPECTED_SIGHASH_HEX: &str = include_str!("./fixtures/ledger_v4_sighash.hex");

#[cfg_attr(all(target_family = "wasm", target_os = "unknown"), wasm_bindgen_test)]
#[cfg_attr(not(all(target_family = "wasm", target_os = "unknown")), test)]
fn host_sighash_matches_device_capture() {
    let expected: [u8; 32] = {
        let trimmed = EXPECTED_SIGHASH_HEX.trim();
        let bytes = hex::decode(trimmed).expect("fixture sighash is valid hex");
        assert_eq!(bytes.len(), 32, "fixture sighash is 32 bytes");
        let mut out = [0u8; 32];
        out.copy_from_slice(&bytes);
        out
    };

    let pczt = Pczt::parse(PCZT_BYTES).expect("fixture PCZT parses");
    let signer = Signer::new(pczt).expect("Signer::new accepts the proven PCZT");
    let host_sighash = signer.shielded_sighash();

    assert_eq!(
        host_sighash, expected,
        "host v4/ZIP-243 sighash diverged from the Ledger device's captured value — \
         consensus guard in pczt_sign_with_ledger would reject every real send. \
         host=0x{} device=0x{}",
        hex::encode(host_sighash),
        hex::encode(expected),
    );
}
