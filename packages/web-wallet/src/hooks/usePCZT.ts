import { useWebZjsContext } from '../context/WebzjsContext';
import { yecToZats } from '../utils';
import { useWebZjsActions } from './useWebzjsActions';
import { useSigningBackend } from './signing/useSigningBackend';
import { useState } from 'react';

interface IUsePczt {
  handlePcztTransaction: (
    accountId: number,
    toAddress: string,
    value: string,
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
  const { flushDbToStore, syncStateWithWallet } = useWebZjsActions();

  const [pcztTransferStatus, setPcztTransferStatus] = useState<PcztTransferStatus>(
    PcztTransferStatus.CHECK_WALLET,
  );
  const [lastError, setLastError] = useState<string | null>(null);

  const handlePcztTransaction = async (
    accountId: number,
    toAddress: string,
    value: string,
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
      );

      // sendShielded already broadcasts; persist the wallet bytes so the
      // pending transaction survives a tab crash.
      await flushDbToStore();
      setPcztTransferStatus(PcztTransferStatus.SEND_SUCCESSFUL);
      await syncStateWithWallet();
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      console.error('Transaction error:', error);

      let errorMessage = rawMessage;
      if (rawMessage.includes('InsufficientFunds')) {
        const availableMatch = rawMessage.match(/available:\s*Zatoshis\((\d+)\)/);
        const requiredMatch = rawMessage.match(/required:\s*Zatoshis\((\d+)\)/);
        if (availableMatch && requiredMatch) {
          const available = parseInt(availableMatch[1]);
          const required = parseInt(requiredMatch[1]);
          const availableYec = (available / 100_000_000).toFixed(8);
          const requiredYec = (required / 100_000_000).toFixed(8);
          const shortfallYec = ((required - available) / 100_000_000).toFixed(8);
          errorMessage = `Insufficient balance. Available: ${availableYec} YEC, Required: ${requiredYec} YEC (includes fees). You need ${shortfallYec} YEC more to complete this transaction.`;
        } else {
          errorMessage =
            'Insufficient balance. Your wallet may still be syncing — wait for sync to complete or try a Full Resync from the Account Summary page.';
        }
      }

      setLastError(errorMessage);
      setPcztTransferStatus(PcztTransferStatus.SEND_ERROR);
    }
  };

  const handlePcztShieldTransaction = async (
    _accountId: number,
    _toAddress: string,
    _value: string,
  ) => {
    // Shielding from transparent → Sapling goes through `pczt_shield`, which
    // returns a PCZT that the Phase E2 browser backend can't finalize (the
    // PCZT signer/io_finalizer roles don't implement v4 sighash yet).
    // The Shield Balance page warns about this and the button stays disabled
    // once the feature-flag check fires.
    setLastError(
      'Shielding transparent funds is not yet supported on Ycash. The PCZT finalizer ' +
        'needs v4 sighash support upstream before this path works on v4-only networks.',
    );
    setPcztTransferStatus(PcztTransferStatus.SEND_ERROR);
  };

  return {
    handlePcztTransaction,
    handlePcztShieldTransaction,
    pcztTransferStatus,
    lastError,
  };
};
