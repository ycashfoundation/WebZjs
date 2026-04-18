import { useTransactionHistory } from '../../hooks/useTransactionHistory';
import { zatsToYec } from '../../utils';
import type {
  TransactionHistoryEntry,
  TransactionType,
  TransactionStatus,
} from '../../types/transaction';

interface TransactionRowProps {
  transaction: TransactionHistoryEntry;
}

function formatTimestamp(timestamp: number | null): string {
  if (!timestamp) return 'Pending';
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getTypeLabel(type: TransactionType): string {
  switch (type) {
    case 'Received':
      return 'Received';
    case 'Sent':
      return 'Sent';
    case 'Shielded':
      return 'Shielded';
    default:
      return type;
  }
}

function getStatusPillClass(status: TransactionStatus): string {
  switch (status) {
    case 'Confirmed':
      return 'pill pill-accent';
    case 'Pending':
      return 'pill pill-ycash';
    case 'Expired':
      return 'pill pill-danger';
    default:
      return 'pill pill-muted';
  }
}

function truncateMiddle(s: string, left = 10, right = 8): string {
  if (s.length <= left + right + 1) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

function TransactionRow({ transaction }: TransactionRowProps) {
  const isPositive = transaction.value > 0;
  const valueColor = isPositive ? 'text-accent' : 'text-danger';
  const valuePrefix = isPositive ? '+' : '';

  return (
    <div className="card-surface p-4 md:p-5 hover:border-border-strong transition-colors">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-text font-medium">
              {getTypeLabel(transaction.tx_type)}
            </span>
            <span className={getStatusPillClass(transaction.status)}>
              {transaction.status}
            </span>
            <span className="pill pill-muted">{transaction.pool}</span>
          </div>
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-dim">
            {formatTimestamp(transaction.timestamp)}
          </div>
          {transaction.memo && (
            <div className="text-sm text-text-muted bg-surface border border-border rounded-md px-3 py-2 break-words mt-1">
              {transaction.memo}
            </div>
          )}
        </div>
        <div className="text-right flex flex-col items-end gap-1">
          <div className={`mono text-lg font-semibold ${valueColor}`}>
            {valuePrefix}
            {zatsToYec(Math.abs(transaction.value))} YEC
          </div>
          {transaction.confirmations > 0 && (
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-dim">
              {transaction.confirmations} conf
              {transaction.confirmations !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      </div>
      <div
        className="mt-3 pt-3 border-t border-border font-mono text-[11px] text-text-dim truncate"
        title={transaction.txid}
      >
        {truncateMiddle(transaction.txid, 16, 12)}
      </div>
    </div>
  );
}

function TransactionHistory() {
  const { transactions, loading, error, totalCount, hasMore, loadMore, refresh } =
    useTransactionHistory({ pageSize: 20 });

  if (error) {
    return (
      <div className="card-surface p-4 border-danger/40">
        <div className="flex items-center gap-2 mb-2">
          <span className="pill pill-danger">error</span>
        </div>
        <p className="text-sm text-text-muted font-mono break-words">
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-dim">
          {totalCount > 0
            ? `${totalCount} total · newest first`
            : 'No transactions yet'}
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="font-mono text-[11px] uppercase tracking-[0.15em] text-text-dim hover:text-ycash transition-colors disabled:opacity-40"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {transactions.length === 0 && !loading ? (
        <div className="card-surface p-10 text-center">
          <p className="text-text-muted text-sm">
            No transactions found for this account.
          </p>
          <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-text-dim mt-2">
            Let the wallet finish syncing, or wait for your first send/receive.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {transactions.map((tx) => (
            <TransactionRow key={tx.txid} transaction={tx} />
          ))}
        </div>
      )}

      {loading && transactions.length > 0 && (
        <div className="py-4 text-center font-mono text-[11px] uppercase tracking-[0.15em] text-text-dim">
          Loading more…
        </div>
      )}

      {hasMore && !loading && (
        <div className="mt-6 text-center">
          <button
            onClick={loadMore}
            className="font-mono text-[11px] uppercase tracking-[0.15em] text-text-muted hover:text-ycash transition-colors border border-border-strong hover:border-ycash rounded-md px-5 py-2.5"
          >
            Load more →
          </button>
        </div>
      )}
    </div>
  );
}

export default TransactionHistory;
