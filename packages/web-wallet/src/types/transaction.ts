export type TransactionType = 'Received' | 'Sent' | 'Shielded';
export type TransactionStatus = 'Confirmed' | 'Pending' | 'Expired';

export interface TransactionHistoryEntry {
  txid: string;
  tx_type: TransactionType;
  value: number;
  fee: number | null;
  block_height: number | null;
  confirmations: number;
  status: TransactionStatus;
  memo: string | null;
  timestamp: number | null;
  pool: string;
  /**
   * For Sent transactions, the external recipient address that was paid.
   * Null for received, shielded (self-transfer), or any tx where no
   * non-change external output was observed.
   */
  recipient_address: string | null;
}

export interface TransactionHistoryResponse {
  transactions: TransactionHistoryEntry[];
  total_count: number;
  has_more: boolean;
}
