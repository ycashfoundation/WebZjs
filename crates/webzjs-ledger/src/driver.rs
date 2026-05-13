//! Drives the device through one full v4/ZIP-243 signing pipeline.
//!
//! Input is fully proven byte-level state (already-built SpendDescriptions
//! and OutputDescriptions, plus the 64-byte alpha entropy each spend was
//! built with). Output is the device's 32-byte sighash, per-spend
//! redjubjub signatures, and per-input ECDSA signatures. Applying those
//! to a PCZT and computing the host-side binding-sig is the consumer's
//! job — see `webzjs-wallet`.

use crate::error::LedgerError;
use crate::transport::{ins, stage, ApduCallback, CLA, STREAM_CHUNK_MAX};

/// One transparent input as the device wants to see it: a 36-byte
/// `OutPoint::write` serialization (txid little-endian || vout(4 LE)),
/// the input amount in zats, and the input's sequence number (almost
/// always `0xFFFFFFFF`).
#[derive(Debug, Clone)]
pub struct TransparentInputInput {
    pub prevout_36: [u8; 36],
    pub amount: u64,
    pub sequence: u32,
}

/// One transparent output. `hash160` is the 20-byte HASH160 of the
/// recipient pubkey; P2SH (`s2…`/`s3…`) is **not** supported because
/// the device firmware only renders P2PKH outputs (the `address_type`
/// byte in ADD_T_OUT is forced to 0).
#[derive(Debug, Clone)]
pub struct TransparentOutputInput {
    pub amount: u64,
    pub hash160: [u8; 20],
}

/// One Sapling spend, post-prove. `spend_description_320` is the
/// concatenation `cv(32) || anchor(32) || nullifier(32) || rk(32) ||
/// zkproof(192)` in that order. `alpha_64b` is the same 64 bytes the
/// host fed to
/// `SpendInfo::new_with_external_signer_alpha` — the device
/// wide-reduces them itself to recover alpha, randomizes its on-device
/// `ask`, and signs the device-computed sighash.
#[derive(Debug, Clone)]
pub struct ShieldedSpendInput {
    pub spend_description_320: [u8; 320],
    pub alpha_64b: [u8; 64],
}

/// One Sapling output, post-prove. The first five fields populate
/// `ADD_S_OUT` (which prompts the user to confirm the recipient and
/// amount); the device caches the resulting `cmu` and cross-checks
/// it against the bytes streamed via `ADD_S_OUT_NC`. The 948-byte
/// `output_description_948` is the v4 OutputDescription tail
/// (`cv(32) || cmu(32) || epk(32) || enc_ciphertext(580) ||
/// out_ciphertext(80) || zkproof(192)`).
#[derive(Debug, Clone)]
pub struct ShieldedOutputInput {
    /// Raw 43-byte Sapling payment address (`diversifier(11) || pk_d(32)`).
    pub address_43: [u8; 43],
    pub amount: u64,
    /// Ephemeral key bytes baked into the bundle's OutputDescription.
    pub epk_32: [u8; 32],
    /// First 52 bytes of `enc_ciphertext` — enough for the device to
    /// recover memo and outgoing-viewing-key plaintext during the
    /// confirmation dialog.
    pub enc_compact_52: [u8; 52],
    /// Same ZIP-212 AfterZip212 rseed the host fed to
    /// `OutputInfo::new_with_external_signer_rseed`. The device
    /// computes `cmu = note_commit(diversifier, pk_d, value, rseed)`
    /// and cross-checks the cmu it sees in `output_description_948`.
    pub rseed: [u8; 32],
    pub output_description_948: Vec<u8>,
}

/// Bundle of everything the driver needs to fire one signing pipeline.
/// Bundle order **matters** for both the spend list and the output
/// list: the device hashes them in the order they're streamed via
/// `ADD_S_IN` / `ADD_S_OUT_NC`, which has to match the order the host
/// hashed them when computing the v4 sighash on its side. The caller is
/// responsible for shuffling these into the post-randomization bundle
/// order before calling.
#[derive(Debug, Clone)]
pub struct LedgerTxInput {
    pub transparent_inputs: Vec<TransparentInputInput>,
    pub transparent_outputs: Vec<TransparentOutputInput>,
    pub shielded_spends: Vec<ShieldedSpendInput>,
    pub shielded_outputs: Vec<ShieldedOutputInput>,
    /// Sapling `value_balance` as a signed integer of zats (positive
    /// when the transaction nets value into the Sapling pool, negative
    /// when it nets out). Streamed via `SET_S_NET` (INS 0x16).
    pub value_balance: i64,
    /// v4 `lockTime` field; almost always `0` for wallet transactions.
    pub lock_time: u32,
    /// v4 `nExpiryHeight`; the height after which the tx becomes
    /// invalid. Mirrors `BlockHeight::from_u32(plan.expiry_height)`
    /// in the proposal.
    pub expiry_height: u32,
}

/// The device's outputs from one signing pipeline. The caller applies
/// them to the host-side PCZT / transparent bundle.
#[derive(Debug, Clone, Default)]
pub struct LedgerTxSignatures {
    /// 32-byte v4/ZIP-243 sapling sighash the device computed during
    /// the FEE-stage finalisation. `None` when the transaction has no
    /// Sapling component (pure transparent), because the device never
    /// computes a Sapling sighash in that case.
    pub shielded_sighash: Option<[u8; 32]>,
    /// One redjubjub `Signature` per shielded spend, in **bundle order**
    /// (matches `shielded_spends` in the input).
    pub spend_auth_sigs: Vec<[u8; 64]>,
    /// One ECDSA compact signature per transparent input, in input
    /// order. Caller must convert to DER + append `SIGHASH_ALL` and
    /// build the `script_sig`.
    pub transparent_sigs: Vec<[u8; 64]>,
}

/// Drive the device end-to-end. Returns when END_TX has been
/// acknowledged. All APDUs go through `apdu`; the function is
/// otherwise self-contained.
pub async fn sign_with_ledger(
    input: &LedgerTxInput,
    apdu: &ApduCallback,
) -> Result<LedgerTxSignatures, LedgerError> {
    let has_sapling = !input.shielded_spends.is_empty() || !input.shielded_outputs.is_empty();

    // INIT_TX: device clears per-tx state and returns a 32-byte mseed
    // we don't currently consume (it's only relevant if we wanted to
    // mirror the device's RNG for dummy spends, which we don't do —
    // the host owns all randomness).
    let _mseed = apdu_p1p2(apdu, ins::INIT_TX, 0, 0, &[]).await?;

    // Default stage after INIT_TX is T_IN; stream transparent inputs.
    for t_in in &input.transparent_inputs {
        let mut payload = Vec::with_capacity(48);
        payload.extend_from_slice(&t_in.prevout_36);
        payload.extend_from_slice(&t_in.amount.to_le_bytes());
        payload.extend_from_slice(&t_in.sequence.to_le_bytes());
        debug_assert_eq!(payload.len(), 48);
        apdu_p1p2(apdu, ins::ADD_T_IN, 0, 0, &payload).await?;
    }

    // CHANGE_STAGE T_OUT and stream transparent outputs. P1=1 on
    // ADD_T_OUT forces the on-device "confirm recipient" prompt — the
    // user has to press a button per output here.
    change_stage(apdu, stage::T_OUT).await?;
    for t_out in &input.transparent_outputs {
        let mut payload = Vec::with_capacity(29);
        payload.extend_from_slice(&t_out.amount.to_le_bytes());
        payload.push(0); // address_type = 0 (P2PKH); P2SH not supported.
        payload.extend_from_slice(&t_out.hash160);
        debug_assert_eq!(payload.len(), 29);
        apdu_p1p2(apdu, ins::ADD_T_OUT, 1, 0, &payload).await?;
    }

    // T_OUT -> S_IN (no-op transition; the device opens the
    // ZcashSSpendsHash accumulator here but doesn't read any data).
    change_stage(apdu, stage::S_IN).await?;

    // CHANGE_STAGE S_OUT and stream Sapling spends + outputs. Despite
    // the stage being named "S_OUT", spends are streamed first (the
    // device hashes shielded_spends before shielded_outputs in the
    // v4/ZIP-243 sighash sequence).
    change_stage(apdu, stage::S_OUT).await?;

    for spend in &input.shielded_spends {
        stream_chunks(apdu, ins::ADD_S_IN, &spend.spend_description_320).await?;
    }

    for output in &input.shielded_outputs {
        if output.output_description_948.len() != 948 {
            return Err(LedgerError::HostFraming(format!(
                "OutputDescription tail must be 948 bytes, got {}",
                output.output_description_948.len()
            )));
        }
        // ADD_S_OUT (P1=1 to force the on-device confirmation dialog
        // for the recipient address + amount + memo).
        let mut head = Vec::with_capacity(167);
        head.extend_from_slice(&output.address_43);
        head.extend_from_slice(&output.amount.to_le_bytes());
        head.extend_from_slice(&output.epk_32);
        head.extend_from_slice(&output.enc_compact_52);
        head.extend_from_slice(&output.rseed);
        debug_assert_eq!(head.len(), 167);
        apdu_p1p2(apdu, ins::ADD_S_OUT, 1, 0, &head).await?;

        stream_chunks(apdu, ins::ADD_S_OUT_NC, &output.output_description_948).await?;
    }

    // S_OUT -> FEE. Set sapling value_balance, set header, prompt user
    // to confirm the fee on device. The device computes the fee itself
    // from the T_IN amounts it stored earlier — there's no way for the
    // host to lie about the displayed fee.
    change_stage(apdu, stage::FEE).await?;
    let mut net_payload = [0u8; 8];
    net_payload.copy_from_slice(&input.value_balance.to_le_bytes());
    apdu_p1p2(apdu, ins::SET_S_NET, 0, 0, &net_payload).await?;

    let mut header_payload = [0u8; 8];
    header_payload[..4].copy_from_slice(&input.lock_time.to_le_bytes());
    header_payload[4..].copy_from_slice(&input.expiry_height.to_le_bytes());
    apdu_p1p2(apdu, ins::ADD_HEADER, 0, 0, &header_payload).await?;

    apdu_p1p2(apdu, ins::CONFIRM_FEE, 1, 0, &[]).await?;

    // Pipeline finalised; now collect outputs.
    let shielded_sighash = if has_sapling {
        let bytes = apdu_p1p2(apdu, ins::GET_S_SIGHASH, 0, 0, &[]).await?;
        if bytes.len() != 32 {
            return Err(LedgerError::UnexpectedResponseLength {
                what: "GET_S_SIGHASH",
                expected: 32,
                got: bytes.len(),
            });
        }
        let mut sh = [0u8; 32];
        sh.copy_from_slice(&bytes);
        Some(sh)
    } else {
        None
    };

    let mut spend_auth_sigs = Vec::with_capacity(input.shielded_spends.len());
    for spend in &input.shielded_spends {
        let resp = apdu_p1p2(apdu, ins::SIGN_SAPLING, 0, 0, &spend.alpha_64b).await?;
        if resp.len() != 64 {
            return Err(LedgerError::UnexpectedResponseLength {
                what: "SIGN_SAPLING",
                expected: 64,
                got: resp.len(),
            });
        }
        let mut sig = [0u8; 64];
        sig.copy_from_slice(&resp);
        spend_auth_sigs.push(sig);
    }

    let mut transparent_sigs = Vec::with_capacity(input.transparent_inputs.len());
    for idx in 0..input.transparent_inputs.len() {
        let resp = apdu_p1p2(apdu, ins::SIGN_TRANSPARENT, idx as u8, 0, &[]).await?;
        if resp.len() != 64 {
            return Err(LedgerError::UnexpectedResponseLength {
                what: "SIGN_TRANSPARENT",
                expected: 64,
                got: resp.len(),
            });
        }
        let mut sig = [0u8; 64];
        sig.copy_from_slice(&resp);
        transparent_sigs.push(sig);
    }

    // END_TX is an acknowledgement — the device clears per-tx state
    // and goes back to IDLE so a subsequent INIT_TX is safe.
    apdu_p1p2(apdu, ins::END_TX, 0, 0, &[]).await?;

    Ok(LedgerTxSignatures {
        shielded_sighash,
        spend_auth_sigs,
        transparent_sigs,
    })
}

/// Issue a single APDU with the given INS/P1/P2 and payload, returning
/// the response payload (status word already validated). Lc is set to
/// `data.len()` and must fit in one byte — the chunked-streaming
/// helpers below partition larger payloads into multiple APDUs.
async fn apdu_p1p2(
    apdu: &ApduCallback,
    ins: u8,
    p1: u8,
    p2: u8,
    data: &[u8],
) -> Result<Vec<u8>, LedgerError> {
    if data.len() > 0xFF {
        return Err(LedgerError::HostFraming(format!(
            "single APDU payload too large: {} bytes (max 255)",
            data.len()
        )));
    }
    let mut bytes = Vec::with_capacity(5 + data.len());
    bytes.extend_from_slice(&[CLA, ins, p1, p2, data.len() as u8]);
    bytes.extend_from_slice(data);
    apdu.apdu_send_recv(&bytes).await
}

async fn change_stage(apdu: &ApduCallback, target: u8) -> Result<(), LedgerError> {
    apdu_p1p2(apdu, ins::CHANGE_STAGE, target, 0, &[]).await?;
    Ok(())
}

/// Stream a payload to the device via repeated APDUs, P1=0 on every
/// chunk except the last (P1=1). Used for `ADD_S_IN` (320-byte
/// SpendDescription bodies) and `ADD_S_OUT_NC` (948-byte
/// OutputDescription tails). The device assembles the chunks into the
/// matching hash accumulator and only closes it when it sees P1=1.
async fn stream_chunks(apdu: &ApduCallback, ins: u8, payload: &[u8]) -> Result<(), LedgerError> {
    let mut offset = 0;
    while offset < payload.len() {
        let end = core::cmp::min(offset + STREAM_CHUNK_MAX, payload.len());
        let is_last = end == payload.len();
        apdu_p1p2(apdu, ins, if is_last { 1 } else { 0 }, 0, &payload[offset..end]).await?;
        offset = end;
    }
    Ok(())
}
