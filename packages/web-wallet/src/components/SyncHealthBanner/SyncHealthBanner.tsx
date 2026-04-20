import { useEffect, useState } from 'react';
import { useWebZjsContext } from '../../context/WebzjsContext';

/**
 * How many consecutive `sync()` failures we tolerate before showing the
 * banner. Picked at 2 so a single transient gRPC hiccup doesn't flash a
 * scary banner in the user's face; by the time we've seen two in a row
 * over an exponential-backoff schedule (3s, 6s, 12s per attempt × 2
 * dispatches), the proxy or network is genuinely unreachable.
 */
const FAILURE_THRESHOLD = 2;

/**
 * Short, human-friendly rendering of "how long ago did sync last work."
 * We don't need live ticking — it re-renders on every failure dispatch —
 * but we do tick once a minute so a long-running disconnection reads
 * correctly.
 */
function useAgoLabel(timestamp: number | null): string | null {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (timestamp == null) return;
    const interval = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(interval);
  }, [timestamp]);

  if (timestamp == null) return null;
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'less than a minute ago';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Top-level offline indicator. Renders only when either (a) we've failed
 * to reach the lightwalletd proxy enough times in a row, or (b) the
 * browser itself reports we're offline. Self-hides on the next successful
 * sync. No dismiss affordance — the banner is strictly derived from
 * observable state, so dismissing it would just mean "lie to the user
 * about whether the wallet is working," which defeats the point.
 */
export function SyncHealthBanner(): React.JSX.Element | null {
  const { state } = useWebZjsContext();
  const [browserOnline, setBrowserOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const onOnline = () => setBrowserOnline(true);
    const onOffline = () => setBrowserOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const agoLabel = useAgoLabel(state.lastSyncSuccessAt);

  const sawEnoughFailures = state.syncFailureStreak >= FAILURE_THRESHOLD;
  if (browserOnline && !sawEnoughFailures) return null;

  const reason = !browserOnline
    ? 'This browser reports it is offline.'
    : "Can't reach the lightwalletd proxy — will keep retrying.";
  const freshness = agoLabel
    ? `Last synced ${agoLabel}.`
    : 'No successful sync this session yet.';

  return (
    <div
      role="status"
      aria-live="polite"
      className="card-surface border-ycash/40 bg-ycash/5 p-4 flex flex-wrap items-center gap-3 mb-6"
    >
      <span className="pill pill-ycash">syncing paused</span>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-sm text-text">{reason}</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-text-dim">
          {freshness}
        </span>
      </div>
    </div>
  );
}

export default SyncHealthBanner;
