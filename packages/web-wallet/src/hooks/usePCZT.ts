import { useWebZjsContext } from '../context/WebzjsContext';
import { Pczt } from '@chainsafe/webzjs-wallet';
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

export enum PcztTransferStatus {
  CHECK_WALLET = 'Checking wallet',
  CREATING_PCZT = 'Creating transaction',
  SIGNING_PCZT = 'Signing transaction',
  PROVING_PCZT = 'Proving transaction',
  SENDING_PCZT = 'Sending transaction',
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

  const createPCZT = async (
    accountId: number,
    toAddress: string,
    value: string,
  ) => {
    const valueInZats = yecToZats(value);
    return await state.webWallet!.pczt_create(accountId, toAddress, valueInZats);
  };

  const provePczt = async (pczt: Pczt): Promise<Pczt> => state.webWallet!.pczt_prove(pczt);

  const sendPczt = async (signedPczt: Pczt) => {
    try {
      await state.webWallet!.pczt_send(signedPczt);
    } catch (error) {
      console.error('Error sending PCZT:', error);
      setPcztTransferStatus(PcztTransferStatus.SEND_ERROR);
      throw error;
    }
  };

  const handlePcztGenericTransaction = async (
    accountId: number,
    toAddress: string,
    value: string,
    createPcztFunc: (
      accountId: number,
      toAddress: string,
      value: string,
    ) => Promise<Pczt>,
  ) => {
    if (!state.webWallet) return;
    if (!signingBackend) {
      setLastError('Wallet must be unlocked to sign transactions.');
      setPcztTransferStatus(PcztTransferStatus.SEND_ERROR);
      return;
    }
    setLastError(null);

    try {
      setPcztTransferStatus(PcztTransferStatus.CREATING_PCZT);
      const pczt = await createPcztFunc(accountId, toAddress, value);

      setPcztTransferStatus(PcztTransferStatus.SIGNING_PCZT);
      const signedPczt = await signingBackend.signPczt(pczt);

      setPcztTransferStatus(PcztTransferStatus.PROVING_PCZT);
      const provedPczt = await provePczt(signedPczt);

      setPcztTransferStatus(PcztTransferStatus.SENDING_PCZT);
      await sendPczt(provedPczt);

      // Persist wallet state immediately after broadcast to prevent data loss
      // on tab crash.
      await flushDbToStore();

      setPcztTransferStatus(PcztTransferStatus.SEND_SUCCESSFUL);

      // Refresh summary; totalBalance includes pending amounts so the UI
      // stays correct without a special post-tx handler.
      await syncStateWithWallet();
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      console.error('Transaction error:', error);

      let errorMessage = rawMessage;

      // Pretty-print the common InsufficientFunds case.
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
    accountId: number,
    toAddress: string,
    value: string,
  ) => {
    await handlePcztGenericTransaction(
      accountId,
      toAddress,
      value,
      async (acctId) => state.webWallet!.pczt_shield(acctId),
    );
  };

  const handlePcztTransaction = async (
    accountId: number,
    toAddress: string,
    value: string,
  ) => {
    await handlePcztGenericTransaction(accountId, toAddress, value, createPCZT);
  };

  return {
    handlePcztTransaction,
    handlePcztShieldTransaction,
    pcztTransferStatus,
    lastError,
  };
};
