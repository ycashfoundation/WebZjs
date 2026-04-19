//! Round-trip smoke test for the single-owner DB worker.
//!
//! Runs on the main thread (wasm-bindgen-test default), spawns a DB worker
//! holding an in-memory SQLite database, sends a few `Ping` requests, and
//! asserts each reply carries the matching nonce. Proves the full transport:
//! main-thread `spawn` → `wasm_thread` Worker creation → tokio mpsc/oneshot
//! message passing across thread boundaries via SharedArrayBuffer.

#![cfg(feature = "sqlite-db")]
#![cfg(all(target_family = "wasm", target_os = "unknown"))]

use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};
use webzjs_common::Network;
use webzjs_wallet::db::worker::{spawn, Backing};

wasm_bindgen_test_configure!(run_in_browser);

#[wasm_bindgen_test]
async fn ping_round_trip_in_memory() {
    let handle = spawn(Backing::InMemory, Network::MainNetwork)
        .await
        .expect("spawn DB worker");

    // Send several distinct nonces to make sure replies match their senders
    // (a broken implementation that always echoes 0 would still pass a single
    // nonce=0 ping; this catches that).
    for nonce in [1u64, 42, 0xdead_beef, u64::MAX] {
        let echoed = handle.ping(nonce).await.expect("ping reply");
        assert_eq!(echoed, nonce, "nonce mismatch");
    }
}

#[wasm_bindgen_test]
async fn worker_handles_concurrent_pings() {
    let handle = spawn(Backing::InMemory, Network::MainNetwork)
        .await
        .expect("spawn DB worker");

    // Fire several pings before awaiting any — the worker must serialize
    // responses correctly under a queue of pending requests.
    let futs: Vec<_> = (0..16u64).map(|n| handle.ping(n)).collect();
    for (i, fut) in futs.into_iter().enumerate() {
        let echoed = fut.await.expect("ping reply");
        assert_eq!(echoed, i as u64);
    }
}
