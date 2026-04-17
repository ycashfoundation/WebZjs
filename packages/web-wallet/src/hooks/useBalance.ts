import { useMemo } from 'react';
import { useWebZjsContext } from '../context/WebzjsContext';

type BalanceType = {
  /** Confirmed shielded balance (Sapling — Ycash has no Orchard pool) */
  shieldedBalance: number;
  /** Confirmed unshielded (transparent) balance */
  unshieldedBalance: number;
  /** Total balance including pending (ZIP 315 "total balance") */
  totalBalance: number;
  /** Confirmed-only spendable balance (excludes pending) */
  spendableBalance: number;
  saplingBalance: number;
  /** Change from sent transactions waiting for mining confirmation */
  pendingChange: number;
  /** Received notes waiting for required confirmations to become spendable */
  pendingSpendable: number;
  /** Total pending amount (change + pending spendable) */
  totalPending: number;
  /** True if there are any pending transactions */
  hasPending: boolean;
  loading: boolean;
  error: string | null;
};

const useBalance = (): BalanceType => {
  const { state } = useWebZjsContext();

  const activeBalanceReport = useMemo(() => {
    return state.summary?.account_balances.find(
      ([accountId]: [number]) => accountId === state.activeAccount,
    );
  }, [state.activeAccount, state.summary?.account_balances]);

  // ZIP 315 semantics: totalBalance = confirmed + pending ("what the user has"),
  // spendableBalance = confirmed only ("what can be spent right now").
  return useMemo((): BalanceType => {
    if (!activeBalanceReport) {
      return {
        shieldedBalance: 0,
        unshieldedBalance: 0,
        totalBalance: 0,
        spendableBalance: 0,
        saplingBalance: 0,
        pendingChange: 0,
        pendingSpendable: 0,
        totalPending: 0,
        hasPending: false,
        loading: !state.webWallet,
        error: null,
      };
    }

    const saplingBalance = activeBalanceReport[1].sapling_balance || 0;
    const unshieldedBalance = activeBalanceReport[1].unshielded_balance || 0;
    const pendingChange = activeBalanceReport[1].pending_change || 0;
    const pendingSpendable = activeBalanceReport[1].pending_spendable || 0;

    const confirmedTotal = saplingBalance + unshieldedBalance;
    const totalPending = pendingChange + pendingSpendable;

    return {
      shieldedBalance: saplingBalance,
      unshieldedBalance,
      totalBalance: confirmedTotal + totalPending,
      spendableBalance: confirmedTotal,
      saplingBalance,
      pendingChange,
      pendingSpendable,
      totalPending,
      hasPending: totalPending > 0,
      loading: false,
      error: null,
    };
  }, [activeBalanceReport, state.webWallet]);
};

export default useBalance;
