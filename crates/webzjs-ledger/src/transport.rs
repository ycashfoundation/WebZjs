//! Async APDU exchange across a JS-supplied transport callback.
//!
//! The JS side (`@ledgerhq/hw-transport-webhid` wrapped in a small
//! shim) exposes a single function:
//!
//! ```js
//!   async (apduBytes: Uint8Array) => Uint8Array
//! ```
//!
//! The returned `Uint8Array` is the device's response **with** the
//! trailing two-byte status word — same shape `ledger-transport-hid`'s
//! `exchange()` returns minus the `retcode`/`data` split. We do the
//! split here so the rest of the driver only deals with payload bytes.
//!
//! Why a JS callback rather than direct `web-sys` WebHID wiring: the
//! transport layer is the part most likely to drift between Ledger
//! support contexts (WebUSB fallback, BLE on Android, speculos in
//! integration tests), and keeping it in JS lets us swap implementations
//! without rebuilding wasm.

use js_sys::{Function, Uint8Array};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

use crate::error::LedgerError;

/// Boxed wrapper around the JS-supplied APDU exchange function. The
/// driver passes one of these into every `apdu_send_recv` call rather
/// than capturing a global — keeps the call sites unit-testable and
/// avoids `thread_local!` shenanigans inside the wasm thread pool.
#[derive(Clone)]
pub struct ApduCallback {
    js_fn: Function,
}

impl ApduCallback {
    pub fn new(js_fn: Function) -> Self {
        Self { js_fn }
    }

    /// Send the bytes of an APDU command (CLA, INS, P1, P2, Lc, data)
    /// and await the device response. Returns the response payload
    /// **without** the trailing status word — the status is checked
    /// here and a non-`0x9000` is converted into `LedgerError::DeviceStatus`.
    pub async fn apdu_send_recv(&self, apdu: &[u8]) -> Result<Vec<u8>, LedgerError> {
        let argv = Uint8Array::new_with_length(apdu.len() as u32);
        argv.copy_from(apdu);
        let promise = self
            .js_fn
            .call1(&JsValue::NULL, &argv)
            .map_err(|e| LedgerError::Transport(format!("{e:?}")))?;
        let promise: js_sys::Promise = promise
            .dyn_into()
            .map_err(|_| LedgerError::Transport("apdu callback did not return a Promise".into()))?;
        let resolved = JsFuture::from(promise)
            .await
            .map_err(|e| LedgerError::Transport(format!("{e:?}")))?;
        let buf: Uint8Array = resolved.dyn_into().map_err(|_| {
            LedgerError::Transport("apdu callback resolved to non-Uint8Array value".into())
        })?;
        let mut bytes = vec![0u8; buf.length() as usize];
        buf.copy_to(&mut bytes);

        if bytes.len() < 2 {
            return Err(LedgerError::Transport(format!(
                "device response too short: {} bytes (need >= 2 for status word)",
                bytes.len()
            )));
        }
        let sw = u16::from_be_bytes([bytes[bytes.len() - 2], bytes[bytes.len() - 1]]);
        bytes.truncate(bytes.len() - 2);
        if sw != 0x9000 {
            return Err(LedgerError::DeviceStatus(sw));
        }
        Ok(bytes)
    }
}

/// CLA for every Ycash-app APDU. Hard-coded; the firmware ignores
/// nothing else.
pub const CLA: u8 = 0xE0;

/// INS values, matching the `command_e` enum in
/// `zcash-ledger/src/types.h:57-86`. Public so the driver can name them
/// at call sites and a single grep finds every wire-level reference.
pub mod ins {
    pub const GET_VERSION: u8 = 0x03;
    pub const GET_APP_NAME: u8 = 0x04;
    pub const GET_PUBKEY: u8 = 0x06;
    pub const GET_FVK: u8 = 0x07;
    pub const GET_PROOFGEN_KEY: u8 = 0x09;
    pub const CHANGE_STAGE: u8 = 0x0A;
    pub const INIT_TX: u8 = 0x10;
    pub const ADD_HEADER: u8 = 0x11;
    pub const ADD_T_IN: u8 = 0x12;
    pub const ADD_T_OUT: u8 = 0x13;
    pub const ADD_S_IN: u8 = 0x14;
    pub const ADD_S_OUT: u8 = 0x15;
    pub const SET_S_NET: u8 = 0x16;
    pub const CONFIRM_FEE: u8 = 0x17;
    pub const ADD_S_OUT_NC: u8 = 0x18;
    pub const SIGN_TRANSPARENT: u8 = 0x21;
    pub const SIGN_SAPLING: u8 = 0x22;
    pub const GET_S_SIGHASH: u8 = 0x24;
    pub const END_TX: u8 = 0x30;
}

/// Stage values for `CHANGE_STAGE` (P1). The firmware enforces strict
/// `+1` transitions, so even no-op stages have to be visited in order.
pub mod stage {
    pub const T_OUT: u8 = 2;
    pub const S_IN: u8 = 3;
    pub const S_OUT: u8 = 4;
    pub const FEE: u8 = 5;
}

/// Maximum chunk size for `ADD_S_IN` / `ADD_S_OUT_NC`. The firmware's
/// APDU buffer is 255 bytes after the 5-byte header; 250 leaves room
/// for future fields and matches the original native driver.
pub const STREAM_CHUNK_MAX: usize = 250;
