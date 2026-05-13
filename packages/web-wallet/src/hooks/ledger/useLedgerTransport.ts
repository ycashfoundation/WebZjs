import { useCallback, useEffect, useRef, useState } from 'react';
import { Buffer } from 'buffer';
import TransportWebHID from '@ledgerhq/hw-transport-webhid';

/**
 * Shape passed across the wasm boundary to `pczt_sign_with_ledger` and used
 * inline during onboarding. Returns the full device response **with** the
 * trailing 2-byte status word — the Rust side splits it.
 */
export type ApduCallback = (apdu: Uint8Array) => Promise<Uint8Array>;

/**
 * Singleton transport. WebHID only allows one open handle per device, so
 * we keep the live transport in module scope rather than per-component
 * state — re-renders that re-run the hook should latch onto the existing
 * connection instead of opening a second one.
 */
let activeTransport: TransportWebHID | null = null;

function adoptTransport(t: TransportWebHID): TransportWebHID {
  activeTransport = t;
  return t;
}

/**
 * Exchange one APDU with the device. Returns the device response **with**
 * the trailing 2-byte status word so the consumer can interpret it
 * (matches the shape `webzjs_ledger::ApduCallback` expects, and lets the
 * onboarding screen branch on specific status words like `0x6985` when
 * the user rejects a confirmation prompt).
 */
async function exchange(
  transport: TransportWebHID,
  apdu: Uint8Array,
): Promise<Uint8Array> {
  // `@ledgerhq/hw-transport-webhid` does its framing with a `Buffer`
  // (Node Buffer extends Uint8Array, but the underlying read paths
  // expect `.readUInt16BE` etc., so handing it a plain Uint8Array is
  // fragile). Convert in / out at the boundary.
  const resp = await transport.exchange(Buffer.from(apdu));
  return new Uint8Array(resp.buffer, resp.byteOffset, resp.byteLength);
}

export interface LedgerTransportHandle {
  /** True while a WebHID transport is open. */
  connected: boolean;
  /**
   * `null` if `navigator.hid` is not exposed in this browser. Used by the
   * onboarding screen to render a "browser unsupported" message rather
   * than letting the connect button silently throw.
   */
  supported: boolean;
  /**
   * Open the WebHID picker (must be called from a click handler) and
   * cache the transport. Resolves once a Ycash-app-running device is
   * selected and ready to receive APDUs.
   */
  connect: () => Promise<void>;
  /** Close the transport. Safe to call when already disconnected. */
  disconnect: () => Promise<void>;
  /**
   * Send an APDU. Throws if no transport is open — callers should
   * `connect()` first or guard on `connected`.
   */
  apdu: ApduCallback;
  /**
   * Stable, hook-supplied `ApduCallback` that the wasm side stores and
   * may invoke multiple times. Bound to the singleton transport so it
   * keeps working across re-renders.
   */
  apduCallback: ApduCallback;
}

/**
 * Wraps `@ledgerhq/hw-transport-webhid` in a React-friendly hook.
 *
 * Notes:
 * - WebHID requires a user gesture for `request()`, so `connect()` must be
 *   called from a click/touch handler. The hook itself doesn't auto-prompt.
 * - The transport survives unmount: closing it would break in-flight
 *   signing pipelines if the user navigates away mid-flow. Explicit
 *   `disconnect()` is the only way to release.
 * - Browser support is limited to Chromium-based browsers (Chrome, Edge,
 *   Brave, Opera). Firefox and Safari don't ship WebHID; the hook exposes
 *   `supported` so the UI can refuse early.
 */
export function useLedgerTransport(): LedgerTransportHandle {
  const [connected, setConnected] = useState(activeTransport != null);
  const transportRef = useRef<TransportWebHID | null>(activeTransport);

  // Listen for unplug. The Ledger transport emits a `disconnect` event when
  // the device goes away; reflect that in our connected flag so the UI
  // doesn't claim "ready" while the user reaches for the cable.
  useEffect(() => {
    const t = transportRef.current;
    if (!t) return;
    const handler = () => {
      activeTransport = null;
      transportRef.current = null;
      setConnected(false);
    };
    t.on('disconnect', handler);
    return () => {
      t.off('disconnect', handler);
    };
  }, [connected]);

  const supported =
    typeof navigator !== 'undefined' &&
    'hid' in navigator &&
    typeof (navigator as Navigator & { hid?: unknown }).hid !== 'undefined';

  const connect = useCallback(async () => {
    if (transportRef.current) {
      setConnected(true);
      return;
    }
    if (!supported) {
      throw new Error(
        'WebHID is not available in this browser. Use Chrome, Edge, or Brave.',
      );
    }
    // `request` forces the device picker; `openConnected` reuses an
    // already-authorized device. Try the silent path first so a user who
    // already granted permission doesn't have to re-pick on every page
    // load, then fall back to the prompt.
    const reopened = await TransportWebHID.openConnected();
    const t = reopened ?? (await TransportWebHID.request());
    adoptTransport(t);
    transportRef.current = t;
    setConnected(true);
  }, [supported]);

  const disconnect = useCallback(async () => {
    const t = transportRef.current;
    if (!t) return;
    activeTransport = null;
    transportRef.current = null;
    setConnected(false);
    try {
      await t.close();
    } catch {
      // Closing an already-closed transport throws; not actionable.
    }
  }, []);

  const apdu = useCallback<ApduCallback>(async (bytes) => {
    const t = transportRef.current ?? activeTransport;
    if (!t) {
      throw new Error('Ledger transport is not connected');
    }
    return exchange(t, bytes);
  }, []);

  // Stable callback identity for cases where the wasm side hangs onto it.
  // The closure reaches through `activeTransport` so it keeps working
  // even if the React state has gone stale.
  const apduCallback = useRef<ApduCallback>(async (bytes) => {
    const t = activeTransport;
    if (!t) throw new Error('Ledger transport is not connected');
    return exchange(t, bytes);
  }).current;

  return { connected, supported, connect, disconnect, apdu, apduCallback };
}
