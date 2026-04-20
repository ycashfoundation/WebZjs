import { useWebZjsContext } from '../context/WebzjsContext';
import { toFriendlyError, yecToZats } from '../utils';
import { useWebZjsActions } from './useWebzjsActions';
import { useSigningBackend } from './signing/useSigningBackend';
import { useState } from 'react';

interface IUsePczt {
  handlePcztTransaction: (
    accountId: number,
    toAddress: string,
    value: string,
    memo?: string,
  ) => void;
  handlePcztShieldTransaction: (
    accountId: number,
    toAddress: string,
    value: string,
  ) => void;
  pcztTransferStatus: PcztTransferStatus;
  lastError: string | null;
}

// Status labels are kept from the PCZT era for compatibility with the
// TransferResult UI; internally we now run a non-PCZT pipeline so "Signing"
// and "Proving" collapse into a single "Preparing" stage. The granular labels
// will return for the Snap-based backend in Phase E3.
export enum PcztTransferStatus {
  CHECK_WALLET = 'Checking wallet',
  CREATING_PCZT = 'Preparing transaction',
  SIGNING_PCZT = 'Signing transaction',
  PROVING_PCZT = 'Proving transaction',
  SENDING_PCZT = 'Broadcasting transaction',
  SEND_SUCCESSFUL = 'Send successful',
  SEND_ERROR = 'Send error',
}

export const usePczt = (): IUsePczt => {
  const { state } = useWebZjsContext();
  const signingBackend = useSigningBackend();
  const { syncStateWithWallet } = useWebZjsActions();

  const [pcztTransferStatus, setPcztTransferStatus] = useState<PcztTransferStatus>(
    PcztTransferStatus.CHECK_WALLET,
  );
  const [lastError, setLastError] = useState<string | null>(null);

  const handlePcztTransaction = async (
    accountId: number,
    toAddress: string,
    value: string,
    memo?: string,
  ) => {
    if (!state.webWallet) return;
    if (!signingBackend) {
      setLastError('Wallet must be unlocked to sign transactions.');
      setPcztTransferStatus(PcztTransferStatus.SEND_ERROR);
      return;
    }
    setLastError(null);

    try {
      // create_proposed_transactions bundles build + prove + sign; there's
      // no externally visible sign/prove split. Surface a single "preparing"
      // state for the UI so the TransferResult stepper doesn't lie.
      setPcztTransferStatus(PcztTransferStatus.CREATING_PCZT);
      const amountZats = yecToZats(value);
      await signingBackend.sendShielded(
        state.webWallet,
        accountId,
        toAddress,
        amountZats,
        memo,
      );

      // `sendShielded` already broadcast the tx. OPFS commits the write
      // inside the DB worker, so there's nothing else to flush.
      setPcztTransferStatus(PcztTransferStatus.SEND_SUCCESSFUL);
      await syncStateWithWallet();
    } catch (error) {
      console.error('Transaction error:', error);
      const friendly = toFriendlyError(error, 'send this transaction');
      setLastError(friendly.message);
      setPcztTransferStatus(PcztTransferStatus.SEND_ERROR);
    }
  };

  const handlePcztShieldTransaction = async (
    accountId: number,
    _toAddress: string,
    _value: string,
  ) => {
    if (!state.webWallet) return;
    if (!signingBackend) {
      setLastError('Wallet must be unlocked to shield funds.');
      setPcztTransferStatus(PcztTransferStatus.SEND_ERROR);
      return;
    }
    setLastError(null);

    try {
      setPcztTransferStatus(PcztTransferStatus.CREATING_PCZT);
      await signingBackend.shieldAll(state.webWallet, accountId);
      setPcztTransferStatus(PcztTransferStatus.SEND_SUCCESSFUL);
      await syncStateWithWallet();
    } catch (error) {
      console.error('Shielding error:', error);
      const friendly = toFriendlyError(error, 'shield your balance');
      setLastError(friendly.message);
      setPcztTransferStatus(PcztTransferStatus.SEND_ERROR);
    }
  };

  return {
    handlePcztTransaction,
    handlePcztShieldTransaction,
    pcztTransferStatus,
    lastError,
  };
};
