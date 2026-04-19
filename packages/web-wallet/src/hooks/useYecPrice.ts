import { useEffect, useState } from 'react';

/**
 * Best-effort USD price for YEC from CoinGecko's public API.
 *
 * CoinGecko's "simple/price" endpoint returns `Access-Control-Allow-Origin: *`
 * and does not require an API key, so we fetch it straight from the browser.
 * A single module-scoped cache + shared polling timer means every component
 * that mounts this hook gets the same data without triggering duplicate
 * fetches — important because rate limits on the free tier are ~30/min.
 *
 * Never blocks or surfaces errors to the user: if the fetch fails, `usd`
 * stays `null` and the UI is expected to hide the USD line gracefully.
 */

const ENDPOINT =
  'https://api.coingecko.com/api/v3/simple/price?ids=ycash&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true';

// Stay comfortably under CoinGecko's free-tier limit and well past the wallet's
// 35s sync cadence. One fetch per minute per page load is plenty for a display
// that's primarily decorative.
const POLL_INTERVAL_MS = 60_000;

// Hydrate from localStorage on first mount to avoid a 1-2s blank-USD flicker
// on every reload. We still refetch in the background at the normal cadence
// — the cached value is only a display seed, never authoritative.
const LOCAL_STORAGE_KEY = 'yw:yecPrice';
const CACHE_MAX_AGE_MS = 5 * 60_000; // 5 min — long enough to cover a reload, short enough to avoid stale sticker prices

interface CachedEnvelope {
  price: YecPrice;
  cachedAtMs: number;
}

function loadCached(): YecPrice | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as CachedEnvelope;
    if (
      !envelope ||
      typeof envelope.cachedAtMs !== 'number' ||
      !envelope.price ||
      typeof envelope.price.usd !== 'number'
    ) {
      return null;
    }
    if (Date.now() - envelope.cachedAtMs > CACHE_MAX_AGE_MS) return null;
    return envelope.price;
  } catch {
    return null;
  }
}

function saveCached(price: YecPrice): void {
  try {
    const envelope: CachedEnvelope = { price, cachedAtMs: Date.now() };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // localStorage disabled / quota exceeded — silently ignore. The hook
    // keeps working against the in-memory state; we just lose the
    // cross-reload smoothing.
  }
}

export interface YecPrice {
  usd: number;
  change24h: number | null;
  /** Seconds since Unix epoch — when CoinGecko last refreshed its aggregate. */
  lastUpdatedAt: number | null;
}

type Listener = (state: State) => void;

interface State {
  price: YecPrice | null;
  error: unknown;
}

const state: State = { price: loadCached(), error: null };
const listeners = new Set<Listener>();
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

function emit() {
  for (const l of listeners) l(state);
}

async function fetchOnce() {
  if (inFlight) return;
  inFlight = true;
  try {
    const res = await fetch(ENDPOINT);
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const json = (await res.json()) as {
      ycash?: {
        usd?: number;
        usd_24h_change?: number;
        last_updated_at?: number;
      };
    };
    const ycash = json.ycash;
    if (!ycash || typeof ycash.usd !== 'number') {
      throw new Error('Malformed CoinGecko response');
    }
    state.price = {
      usd: ycash.usd,
      change24h:
        typeof ycash.usd_24h_change === 'number' ? ycash.usd_24h_change : null,
      lastUpdatedAt:
        typeof ycash.last_updated_at === 'number'
          ? ycash.last_updated_at
          : null,
    };
    state.error = null;
    saveCached(state.price);
  } catch (err) {
    state.error = err;
    // Keep the previous `price` in place on error so a transient failure
    // doesn't blank the UI — it'll just stop refreshing until recovery.
  } finally {
    inFlight = false;
    emit();
  }
}

function ensurePolling() {
  if (timer) return;
  // Fire immediately on first subscriber, then every interval.
  fetchOnce();
  timer = setInterval(fetchOnce, POLL_INTERVAL_MS);
}

function maybeStopPolling() {
  if (listeners.size > 0) return;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function useYecPrice(): State {
  const [snapshot, setSnapshot] = useState<State>(state);

  useEffect(() => {
    const listener: Listener = (s) => setSnapshot({ ...s });
    listeners.add(listener);
    ensurePolling();
    return () => {
      listeners.delete(listener);
      maybeStopPolling();
    };
  }, []);

  return snapshot;
}
