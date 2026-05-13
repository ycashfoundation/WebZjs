use thiserror::Error;

/// Errors surfaced by the Ledger driver. All variants are recoverable
/// from the caller's perspective — the device's per-tx state is reset
/// on the next `INIT_TX`, so a failed signing attempt doesn't leave
/// anything stuck.
#[derive(Debug, Error)]
pub enum LedgerError {
    /// JS-side WebHID call rejected (device disconnected, user denied
    /// permission, transfer stalled, etc.). The `String` is the JS-side
    /// error toString'd; surface it to the user unchanged.
    #[error("WebHID transport failed: {0}")]
    Transport(String),

    /// Device responded with a non-`0x9000` status word. Common cases:
    /// `0x6D02` = Ycash app not open, `0x6985` = user rejected the
    /// approval dialog, `0x5515` = device locked. Anything else is a
    /// firmware-side protocol violation worth surfacing verbatim.
    #[error("device returned status 0x{0:04X}{}", status_meaning(*.0))]
    DeviceStatus(u16),

    /// An APDU response wasn't the size the protocol expects (e.g.
    /// `GET_S_SIGHASH` should return exactly 32 bytes, `SIGN_SAPLING`
    /// exactly 64). Indicates host/device firmware drift.
    #[error("device returned {got} bytes for {what}, expected {expected}")]
    UnexpectedResponseLength {
        what: &'static str,
        expected: usize,
        got: usize,
    },

    /// Caller asked us to stream a payload of the wrong size — e.g. a
    /// SpendDescription body that isn't 320 bytes, or an
    /// OutputDescription tail that isn't 948 bytes. The check is on
    /// the host side so the device never sees a malformed chunk
    /// boundary.
    #[error("host-side framing error: {0}")]
    HostFraming(String),
}

fn status_meaning(sw: u16) -> &'static str {
    match sw {
        0x6D02 => " (Ycash app not open)",
        0x6985 => " (user rejected on device)",
        0x5515 => " (device locked)",
        _ => "",
    }
}
