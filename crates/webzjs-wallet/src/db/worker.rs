//! Single-owner DB worker.
//!
//! Implements the [step-2 decision](project_sqlite_step2_decisions.md): all
//! SQLite operations run inside one dedicated [`wasm_thread`] Worker. The main
//! thread holds a [`DbWorkerHandle`] and drives the worker via an
//! [`mpsc::UnboundedSender`] of [`Envelope`]s; each request carries a
//! [`oneshot::Sender`] for its reply, so callers `.await` a single future per
//! op without sharing any long-lived locks across threads.
//!
//! The op set is intentionally tiny right now — `Ping` exists to exercise the
//! transport end-to-end. Real operations (wallet summary, block ingestion,
//! PCZT creation, …) will land op-by-op as the broader backend migration
//! proceeds.

use tokio::sync::{mpsc, oneshot};
use webzjs_common::Network;

use crate::db::sqlite::{Error as SqliteError, SqliteWalletDb};

/// An intent-level request sent from the main thread to the DB worker.
#[derive(Debug)]
pub enum Request {
    /// Liveness probe. The worker answers [`Response::Pong`] with the same
    /// nonce so callers can match a reply to their request in flight.
    Ping { nonce: u64 },
}

/// A reply from the DB worker.
#[derive(Debug)]
pub enum Response {
    Pong { nonce: u64 },
}

/// Paired request + reply channel, as enqueued on the worker inbox.
struct Envelope {
    req: Request,
    reply: oneshot::Sender<Response>,
}

/// Errors from talking to the DB worker.
#[derive(Debug, thiserror::Error)]
pub enum WorkerError {
    #[error("DB worker terminated before replying")]
    Dead,
    #[error(transparent)]
    Open(#[from] SqliteError),
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
            .send(Envelope { req, reply: reply_tx })
            .map_err(|_| WorkerError::Dead)?;
        reply_rx.await.map_err(|_| WorkerError::Dead)
    }

    /// Round-trip liveness check. Returns the same nonce the worker received.
    pub async fn ping(&self, nonce: u64) -> Result<u64, WorkerError> {
        match self.send(Request::Ping { nonce }).await? {
            Response::Pong { nonce } => Ok(nonce),
        }
    }
}

/// Spawn the DB worker.
///
/// Creates a dedicated Worker that owns a [`SqliteWalletDb`] for the entire
/// life of the returned [`DbWorkerHandle`]. Returns only once the worker has
/// successfully opened its database (the `ready_rx` handshake below), so
/// callers don't have to handle "worker exists but isn't functional yet".
///
/// The worker exits cleanly when all [`DbWorkerHandle`] clones are dropped:
/// its `rx.recv().await` resolves to `None`, the actor loop returns, and the
/// Worker terminates.
pub async fn spawn(backing: Backing, network: Network) -> Result<DbWorkerHandle, WorkerError> {
    let (tx, rx) = mpsc::unbounded_channel::<Envelope>();
    let (ready_tx, ready_rx) = oneshot::channel::<Result<(), SqliteError>>();

    // `wasm_thread::spawn` takes a `FnOnce() + Send + 'static`. Everything
    // captured here is Send (primitive types or tokio channel endpoints).
    // `SqliteWalletDb` itself is constructed *inside* the worker, so its
    // non-`Send` rusqlite `Connection` never crosses thread boundaries.
    let _join = wasm_thread::Builder::new()
        .spawn(move || {
            wasm_bindgen_futures::spawn_local(async move {
                let mut db = match open(backing, network).await {
                    Ok(db) => {
                        let _ = ready_tx.send(Ok(()));
                        db
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                };

                actor_loop(&mut db, rx).await;
            });
        })
        .expect("wasm_thread::spawn");

    ready_rx.await.map_err(|_| WorkerError::Dead)??;
    Ok(DbWorkerHandle { tx })
}

async fn open(backing: Backing, network: Network) -> Result<SqliteWalletDb, SqliteError> {
    match backing {
        #[cfg(all(target_family = "wasm", target_os = "unknown"))]
        Backing::Opfs { name } => SqliteWalletDb::open_opfs(&name, network).await,
        Backing::InMemory => SqliteWalletDb::open_in_memory(network),
    }
}

async fn actor_loop(db: &mut SqliteWalletDb, mut rx: mpsc::UnboundedReceiver<Envelope>) {
    // `rx.recv()` returns `None` only after every `DbWorkerHandle` clone is
    // dropped — that's the shutdown signal.
    while let Some(env) = rx.recv().await {
        let resp = handle(env.req, db).await;
        let _ = env.reply.send(resp);
    }
}

async fn handle(req: Request, _db: &mut SqliteWalletDb) -> Response {
    match req {
        Request::Ping { nonce } => Response::Pong { nonce },
    }
}
