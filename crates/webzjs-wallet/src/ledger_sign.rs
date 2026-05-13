//! Wire-format helpers for driving the Ycash Ledger app's v4/ZIP-243
//! signing pipeline from a proven [`pczt::Pczt`].
//!
//! This crate-internal module shoulders the byte serialization the
//! device expects — it doesn't talk to the device itself (that's the
//! [`webzjs_ledger`] crate's job) and doesn't apply signatures back to
//! the PCZT (that's the consumer of [`LedgerTxSignatures`] in the
//! bindgen layer). Splitting it out keeps `bindgen::wallet` focused on
//! the JS-facing surface.

use webzjs_ledger::{
    LedgerTxInput, ShieldedOutputInput, ShieldedSpendInput, TransparentInputInput,
    TransparentOutputInput,
};

use crate::error::Error;

/// Standard P2PKH script size: `OP_DUP OP_HASH160 0x14 <h160(20)>
/// OP_EQUALVERIFY OP_CHECKSIG`.
const P2PKH_SCRIPT_LEN: usize = 25;

/// Build a [`LedgerTxInput`] from a proven PCZT plus the bundle-order
/// entropy returned from `create_pczt_from_proposal_for_ledger`.
///
/// `spend_alphas` and `output_rseeds` must already be in bundle order
/// (which is what [`create_pczt_from_proposal_for_ledger`] returns) —
/// the device hashes shielded spends and outputs in the order they're
/// streamed, and that order has to match the order the host hashes them
/// when computing the v4 sighash, which is the bundle's serialization
/// order.
pub(crate) fn build_ledger_tx_input(
    pczt: &pczt::Pczt,
    spend_alphas: &[[u8; 64]],
    output_rseeds: &[[u8; 32]],
) -> Result<LedgerTxInput, Error> {
    let global = pczt.global();
    let sapling = pczt.sapling();
    let transparent = pczt.transparent();

    let n_spends = sapling.spends().len();
    let n_outputs = sapling.outputs().len();
    if spend_alphas.len() != n_spends {
        return Err(Error::Generic(format!(
            "Ledger entropy mismatch: PCZT has {} sapling spends, caller supplied {} alphas",
            n_spends,
            spend_alphas.len()
        )));
    }
    if output_rseeds.len() != n_outputs {
        return Err(Error::Generic(format!(
            "Ledger entropy mismatch: PCZT has {} sapling outputs, caller supplied {} rseeds",
            n_outputs,
            output_rseeds.len()
        )));
    }

    let anchor = *sapling.anchor();
    let mut shielded_spends = Vec::with_capacity(n_spends);
    for (i, spend) in sapling.spends().iter().enumerate() {
        let zkproof = spend.zkproof().as_ref().ok_or_else(|| {
            Error::Generic(format!(
                "Sapling spend {i} missing zkproof; pczt_prove must run first"
            ))
        })?;
        let mut buf = [0u8; 320];
        buf[0..32].copy_from_slice(spend.cv());
        buf[32..64].copy_from_slice(&anchor);
        buf[64..96].copy_from_slice(spend.nullifier());
        buf[96..128].copy_from_slice(spend.rk());
        buf[128..320].copy_from_slice(zkproof.as_ref());
        shielded_spends.push(ShieldedSpendInput {
            spend_description_320: buf,
            alpha_64b: spend_alphas[i],
        });
    }

    let mut shielded_outputs = Vec::with_capacity(n_outputs);
    for (i, output) in sapling.outputs().iter().enumerate() {
        let recipient = output.recipient().ok_or_else(|| {
            Error::Generic(format!("Sapling output {i} missing recipient address"))
        })?;
        let value = output.value().ok_or_else(|| {
            Error::Generic(format!(
                "Sapling output {i} missing cleartext value; required for the on-device confirm dialog"
            ))
        })?;
        let zkproof = output.zkproof().as_ref().ok_or_else(|| {
            Error::Generic(format!(
                "Sapling output {i} missing zkproof; pczt_prove must run first"
            ))
        })?;
        let enc = output.enc_ciphertext();
        let out_ct = output.out_ciphertext();

        // v4 OutputDescription tail: cv(32) || cmu(32) || epk(32) ||
        //   enc_ciphertext(580) || out_ciphertext(80) || zkproof(192) = 948
        let mut tail = Vec::with_capacity(948);
        tail.extend_from_slice(output.cv());
        tail.extend_from_slice(output.cmu());
        tail.extend_from_slice(output.ephemeral_key());
        tail.extend_from_slice(enc);
        tail.extend_from_slice(out_ct);
        tail.extend_from_slice(zkproof.as_ref());
        if tail.len() != 948 {
            return Err(Error::Generic(format!(
                "Sapling output {i} produced {} byte tail; v4 OutputDescription tail must be 948",
                tail.len()
            )));
        }
        if enc.len() < 52 {
            return Err(Error::Generic(format!(
                "Sapling output {i} has enc_ciphertext {} bytes; need >= 52 for ADD_S_OUT compact",
                enc.len()
            )));
        }
        let mut enc_compact_52 = [0u8; 52];
        enc_compact_52.copy_from_slice(&enc[..52]);

        shielded_outputs.push(ShieldedOutputInput {
            address_43: recipient,
            amount: value,
            epk_32: *output.ephemeral_key(),
            enc_compact_52,
            rseed: output_rseeds[i],
            output_description_948: tail,
        });
    }

    let mut transparent_inputs = Vec::with_capacity(transparent.inputs().len());
    for input in transparent.inputs() {
        let mut prevout_36 = [0u8; 36];
        prevout_36[..32].copy_from_slice(input.prevout_txid());
        prevout_36[32..].copy_from_slice(&input.prevout_index().to_le_bytes());
        transparent_inputs.push(TransparentInputInput {
            prevout_36,
            amount: *input.value(),
            sequence: input.sequence().unwrap_or(0xFFFF_FFFF),
        });
    }

    let mut transparent_outputs = Vec::with_capacity(transparent.outputs().len());
    for (i, output) in transparent.outputs().iter().enumerate() {
        let hash160 = extract_p2pkh_hash160(output.script_pubkey()).ok_or_else(|| {
            Error::Generic(format!(
                "Transparent output {i} is not a P2PKH script; Ycash Ledger app does not support P2SH"
            ))
        })?;
        transparent_outputs.push(TransparentOutputInput {
            amount: *output.value(),
            hash160,
        });
    }

    let value_balance = i64::try_from(*sapling.value_sum())
        .map_err(|_| Error::Generic("Sapling value_sum out of i64 range".to_string()))?;

    let lock_time = pczt::common::determine_lock_time(global, transparent.inputs())
        .ok_or_else(|| Error::Generic("PCZT has incompatible per-input lock times".to_string()))?;

    Ok(LedgerTxInput {
        transparent_inputs,
        transparent_outputs,
        shielded_spends,
        shielded_outputs,
        value_balance,
        lock_time,
        expiry_height: *global.expiry_height(),
    })
}

/// Parse `OP_DUP OP_HASH160 0x14 <20> OP_EQUALVERIFY OP_CHECKSIG` and
/// return the 20-byte hash160. Returns `None` for anything else,
/// including P2SH (`OP_HASH160 0x14 <20> OP_EQUAL`) and OP_RETURN.
fn extract_p2pkh_hash160(script: &[u8]) -> Option<[u8; 20]> {
    if script.len() != P2PKH_SCRIPT_LEN
        || script[0] != 0x76
        || script[1] != 0xA9
        || script[2] != 0x14
        || script[23] != 0x88
        || script[24] != 0xAC
    {
        return None;
    }
    let mut out = [0u8; 20];
    out.copy_from_slice(&script[3..23]);
    Some(out)
}

/// Slice the flat byte vector returned by JS into `[u8; 64]` chunks.
/// Used to consume `spend_alphas` from the wasm boundary. Returns
/// `None` if the length isn't a multiple of 64.
pub(crate) fn slice_64_chunks(bytes: &[u8]) -> Option<Vec<[u8; 64]>> {
    if bytes.len() % 64 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 64);
    for chunk in bytes.chunks_exact(64) {
        let mut buf = [0u8; 64];
        buf.copy_from_slice(chunk);
        out.push(buf);
    }
    Some(out)
}

/// Slice the flat byte vector returned by JS into `[u8; 32]` chunks.
pub(crate) fn slice_32_chunks(bytes: &[u8]) -> Option<Vec<[u8; 32]>> {
    if bytes.len() % 32 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 32);
    for chunk in bytes.chunks_exact(32) {
        let mut buf = [0u8; 32];
        buf.copy_from_slice(chunk);
        out.push(buf);
    }
    Some(out)
}
