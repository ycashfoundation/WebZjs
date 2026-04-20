import { useCallback, useEffect, useState } from 'react';
import { get } from 'idb-keyval';
import { zatsToYec, toFriendlyError } from '../utils';
import useBalance from '../hooks/useBalance';
import { usePendingTransactions } from '../hooks/usePendingTransactions';
import { useYecPrice } from '../hooks/useYecPrice';
import { useSigningBackend } from '../hooks/signing/useSigningBackend';
import { useWebZjsContext } from 'src/context/WebzjsContext';
import { BlockHeightCard } from 'src/components/BlockHeightCard/BlockHeightCard';
import { useWebZjsActions } from '../hooks/useWebzjsActions';
import type { ShieldStage } from '../hooks/signing/SigningBackend';
import { MIN_SHIELDABLE_ZATS } from '../config/constants';

/**
 * In-card state for the inline shield flow. `idle` is the default render of
 * the "Shield now" link; everything else is mid-flight status text. `error`
 * surfaces the failure inline with a Retry affordance. `done` shows a brief
 * success before the card returns to idle (the newly-pending shield moves the
 * balance out of the unshielded column anyway, which usually hides the card's
 * Shield Now affordance naturally on the next sync tick).
 */
type InlineShieldState =
  | { kind: 'idle' }
  | { kind: 'running'; stage: ShieldStage }
  | { kind: 'done' }
  | { kind: 'error'; message: string; isUserCancellation: boolean };

function shieldStageLabel(stage: ShieldStage): string {
  switch (stage) {
    case 'creating':
      return 'Preparing transaction…';
    case 'awaiting-pgk':
      return 'Approve view key in MetaMask';
    case 'proving':
      return 'Proving locally…';
    case 'awaiting-sig':
      return 'Approve signature in MetaMask';
    case 'broadcasting':
      return 'Broadcasting…';
    case 'done':
      return 'Done';
  }
}

/** True when the current stage is waiting on the user (vs. a background task). */
function isUserActionStage(stage: ShieldStage): boolean {
  return stage === 'awaiting-pgk' || stage === 'awaiting-sig';
}

interface BalanceCardProps {
  label: string;
  balance: number;
  pool: string;
  accent?: 'ycash' | 'accent' | 'muted';
  footnote?: string;
  usdPerYec?: number | null;
  action?: React.ReactNode;
}

function formatUsd(usd: number): string {
  // Sub-cent precision matters at YEC's price range; drop fractional USD only
  // for values north of $100 where the extra digits just add noise.
  if (usd >= 100) {
    return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }
  if (usd >= 1) {
    return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  return `$${usd.toFixed(4)}`;
}

function formatYec(zats: number): string {
  const yec = zatsToYec(zats);
  const fixed = yec.toFixed(8);
  // Trim trailing zeros but keep at least 2 fractional digits.
  const [whole, fraction = '00'] = fixed.split('.');
  const trimmed = fraction.replace(/0+$/, '').padEnd(2, '0');
  return `${Number(whole).toLocaleString()}.${trimmed}`;
}

function BalanceCard({
  label,
  balance,
  pool,
  accent = 'muted',
  footnote,
  usdPerYec,
  action,
}: BalanceCardProps) {
  const formatted = formatYec(balance);
  const accentClass =
    balance === 0
      ? 'text-text-dim'
      : accent === 'ycash'
        ? 'text-ycash'
        : accent === 'accent'
          ? 'text-accent'
          : 'text-text';

  const usdLine =
    usdPerYec != null && balance > 0
      ? `≈ ${formatUsd(zatsToYec(balance) * usdPerYec)} USD`
      : null;

  return (
    <div className="card-surface p-6 flex flex-col gap-3 min-w-0">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-dim">
          {label}
        </span>
        <span className="pill pill-muted">{pool}</span>
      </div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span
          className={`stat-number text-[2.5rem] leading-none ${accentClass}`}
        >
          {formatted}
        </span>
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-text-dim">
          YEC
        </span>
      </div>
      {usdLine && (
        <div className="font-mono text-[11px] text-text-muted">{usdLine}</div>
      )}
      {footnote && (
        <div className="font-mono text-[11px] text-text-dim pt-1">
          {footnote}
        </div>
      )}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

function AccountSummary() {
  const { unshieldedBalance, shieldedBalance, totalPending } = useBalance();
  const { pendingTxs } = usePendingTransactions();
  const { state } = useWebZjsContext();
  const { fullResync, syncStateWithWallet } = useWebZjsActions();
  const { price: yecPrice } = useYecPrice();
  const signingBackend = useSigningBackend();
  const [birthdayBlock, setBirthdayBlock] = useState<string | undefined>();
  const [shieldState, setShieldState] = useState<InlineShieldState>({
    kind: 'idle',
  });

  useEffect(() => {
    // The wallet's birthday is stamped into IndexedDB by `setupAccount` /
    // `fullResync`. We surface it here as a UI breadcrumb so the user can see
    // which block the wallet started syncing from.
    (async () => {
      const stored = (await get('birthdayBlock')) as string | undefined;
      setBirthdayBlock(stored);
    })();
  }, []);

  const canShield =
    unshieldedBalance > MIN_SHIELDABLE_ZATS &&
    state.webWallet != null &&
    state.activeAccount != null &&
    signingBackend != null;

  const handleShieldNow = useCallback(async () => {
    if (!state.webWallet || state.activeAccount == null || !signingBackend) {
      return;
    }
    setShieldState({ kind: 'running', stage: 'creating' });
    try {
      await signingBackend.shieldAll(
        state.webWallet,
        state.activeAccount,
        (stage) => {
          if (stage === 'done') {
            setShieldState({ kind: 'done' });
          } else {
            setShieldState({ kind: 'running', stage });
          }
        },
      );
      // Refresh balances so the user sees the transparent amount drop
      // out — OPFS commits the post-broadcast wallet state inside the DB
      // worker, no explicit flush needed.
      await syncStateWithWallet();
      // Linger briefly on the success state, then fade back to idle. By the
      // time this timer fires, sync will have moved the funds into the
      // pending shielded column and the `canShield` gate will flip off,
      // naturally hiding the affordance until the next inbound UTXO.
      setTimeout(() => setShieldState({ kind: 'idle' }), 2500);
    } catch (err) {
      console.error('Inline shield failed:', err);
      const friendly = toFriendlyError(err, 'shield your balance');
      setShieldState({
        kind: 'error',
        message: friendly.message,
        isUserCancellation: friendly.isUserCancellation,
      });
    }
  }, [
    state.webWallet,
    state.activeAccount,
    signingBackend,
    syncStateWithWallet,
  ]);

  const renderShieldAffordance = () => {
    switch (shieldState.kind) {
      case 'running': {
        const label = shieldStageLabel(shieldState.stage);
        const isUserStep = isUserActionStage(shieldState.stage);
        return (
          <div
            className={`inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.15em] ${
              isUserStep ? 'text-ycash' : 'text-text-muted'
            }`}
          >
            {!isUserStep && (
              <span className="inline-block h-2 w-2 rounded-full bg-current animate-pulse" />
            )}
            <span>{label}</span>
          </div>
        );
      }
      case 'done':
        return (
          <div className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.15em] text-accent">
            <span aria-hidden>✓</span>
            <span>Shield submitted</span>
          </div>
        );
      case 'error': {
        // User cancellations aren't a failure — drop the red and use a
        // neutral tone so the card doesn't scream at someone who simply
        // closed a MetaMask prompt.
        const messageClass = shieldState.isUserCancellation
          ? 'font-mono text-[11px] text-text-muted break-words leading-relaxed'
          : 'font-mono text-[11px] text-danger break-words leading-relaxed';
        return (
          <div className="flex flex-col gap-2">
            <span className={messageClass}>{shieldState.message}</span>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={handleShieldNow}
                className="font-mono text-[11px] uppercase tracking-[0.15em] text-ycash hover:text-ycash-hover transition-colors"
              >
                {shieldState.isUserCancellation ? 'Try again →' : 'Retry →'}
              </button>
              <button
                type="button"
                onClick={() => setShieldState({ kind: 'idle' })}
                className="font-mono text-[11px] uppercase tracking-[0.15em] text-text-dim hover:text-text-muted transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        );
      }
      case 'idle':
      default:
        return (
          <button
            type="button"
            onClick={handleShieldNow}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.15em] text-ycash hover:text-ycash-hover transition-colors"
          >
            Shield now
            <span aria-hidden>→</span>
          </button>
        );
    }
  };

  return (
    <div className="w-full pb-16">
      <div className="mb-6">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-text-dim">
          Account · 0
        </span>
      </div>

      <div className="grid gap-4 grid-cols-1 min-[700px]:grid-cols-2 mb-3">
        {/*
          Hidden: Total balance card. Kept here for quick re-enable — just
          uncomment. Removed from the primary view because "total" conflates
          confirmed + pending and can mislead about what's actually spendable.
        */}
        {false && (
          <BalanceCard
            label="Total balance"
            balance={0}
            pool="ALL POOLS"
            accent="ycash"
            usdPerYec={yecPrice?.usd ?? null}
          />
        )}
        <BalanceCard
          label="Shielded balance"
          balance={shieldedBalance}
          pool="SAPLING"
          accent="accent"
          usdPerYec={yecPrice?.usd ?? null}
          action={
            totalPending > 0 ? (
              <div className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.15em] text-ycash">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-ycash opacity-60 animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ycash" />
                </span>
                <span>+{formatYec(totalPending)} YEC pending</span>
              </div>
            ) : null
          }
        />
        <BalanceCard
          label="Incoming transparent"
          balance={unshieldedBalance}
          pool="S-ADDR"
          usdPerYec={yecPrice?.usd ?? null}
          action={
            shieldState.kind !== 'idle' || canShield
              ? renderShieldAffordance()
              : null
          }
        />
      </div>

      {yecPrice && (
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-dim mb-6">
          1 YEC ≈ {formatUsd(yecPrice.usd)}
          {yecPrice.change24h != null && (
            <span
              className={
                yecPrice.change24h >= 0
                  ? 'text-accent ml-2'
                  : 'text-danger ml-2'
              }
            >
              {yecPrice.change24h >= 0 ? '+' : ''}
              {yecPrice.change24h.toFixed(2)}% 24h
            </span>
          )}
          <span className="ml-2">
            · via{' '}
            <a
              href="https://www.coingecko.com/en/coins/ycash"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-ycash transition-colors underline-offset-2 hover:underline"
            >
              CoinGecko
            </a>
          </span>
        </div>
      )}

      {pendingTxs.length > 0 && (
        <div className="card-surface border-ycash/30 p-4 mb-6 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="pill pill-ycash">pending</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-dim">
              {pendingTxs.length} transaction
              {pendingTxs.length === 1 ? '' : 's'} awaiting confirmation
            </span>
          </div>
          {pendingTxs.map((tx) => (
            <div
              key={tx.txid}
              className="flex items-center justify-between gap-3 text-sm pt-2 border-t border-border first:border-t-0 first:pt-0"
            >
              <span className="text-text-muted">{tx.tx_type}</span>
              <span className="mono text-ycash">
                {zatsToYec(tx.value)} YEC
              </span>
            </div>
          ))}
        </div>
      )}

      <BlockHeightCard
        state={state}
        syncedFrom={birthdayBlock}
        onFullResync={fullResync}
      />
    </div>
  );
}

export default AccountSummary;
