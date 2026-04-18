import { useEffect, useState } from 'react';
import { get } from 'idb-keyval';
import { zatsToYec } from '../utils';
import useBalance from '../hooks/useBalance';
import { usePendingTransactions } from '../hooks/usePendingTransactions';
import { useWebZjsContext } from 'src/context/WebzjsContext';
import { BlockHeightCard } from 'src/components/BlockHeightCard/BlockHeightCard';
import { useWebZjsActions } from '../hooks/useWebzjsActions';

interface BalanceCardProps {
  label: string;
  balance: number;
  pool: string;
  accent?: 'ycash' | 'accent' | 'muted';
  footnote?: string;
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
      {footnote && (
        <div className="font-mono text-[11px] text-text-dim pt-1">
          {footnote}
        </div>
      )}
    </div>
  );
}

function AccountSummary() {
  const {
    totalBalance,
    spendableBalance,
    unshieldedBalance,
    shieldedBalance,
    hasPending,
  } = useBalance();
  const { pendingTxs } = usePendingTransactions();
  const { state } = useWebZjsContext();
  const { fullResync } = useWebZjsActions();
  const [birthdayBlock, setBirthdayBlock] = useState<string | undefined>();

  useEffect(() => {
    // The wallet's birthday is stamped into IndexedDB by `setupAccount` /
    // `fullResync`. We surface it here as a UI breadcrumb so the user can see
    // which block the wallet started syncing from.
    (async () => {
      const stored = (await get('birthdayBlock')) as string | undefined;
      setBirthdayBlock(stored);
    })();
  }, []);

  const spendableFootnote =
    hasPending && spendableBalance !== totalBalance
      ? `${zatsToYec(spendableBalance)} YEC spendable now`
      : undefined;

  return (
    <div className="w-full pb-16">
      <div className="mb-8">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-text-dim">
          Account · 0
        </span>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mt-1">
          Summary
        </h1>
      </div>

      <div className="grid gap-4 grid-cols-1 min-[900px]:grid-cols-3 mb-6">
        <BalanceCard
          label="Total balance"
          balance={totalBalance}
          pool="ALL POOLS"
          accent="ycash"
          footnote={spendableFootnote}
        />
        <BalanceCard
          label="Shielded"
          balance={shieldedBalance}
          pool="SAPLING"
          accent="accent"
        />
        <BalanceCard
          label="Transparent"
          balance={unshieldedBalance}
          pool="T-ADDR"
        />
      </div>

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
