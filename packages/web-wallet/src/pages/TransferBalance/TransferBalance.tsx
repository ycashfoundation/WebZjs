import React, { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import useTransferBalanceForm, { TransferStep } from './useTransferBalanceForm';
import {
  TransferInput,
  TransferConfirm,
  TransferResult,
} from 'src/components/TransferCards';
import { PcztTransferStatus } from 'src/hooks/usePCZT';
import { useAddressBook } from '../../context/AddressBookContext';
import { classifyAddress } from '../../utils/address';

function TransferBalance(): React.JSX.Element {
  const {
    currentStep,
    formData,
    pcztTransferStatus,
    lastError,
    nextStep,
    handleChange,
    resetForm,
    submitForm,
  } = useTransferBalanceForm();
  const { lookup } = useAddressBook();
  const navigate = useNavigate();
  // Non-blocking "save this address?" prompt on first successful send to a
  // recipient that isn't already labeled. Only fires once per send — the
  // ref guards against useEffect re-runs on unrelated state changes.
  const promptedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (pcztTransferStatus !== PcztTransferStatus.SEND_SUCCESSFUL) return;
    const addr = formData.recipient.trim();
    if (!addr) return;
    if (promptedForRef.current === addr) return;
    const classification = classifyAddress(addr);
    if (classification.kind === 'invalid') return;
    if (lookup(addr)) return;
    promptedForRef.current = addr;

    toast.custom(
      (t) => (
        <div
          className="card-surface px-4 py-3 flex items-center gap-3 shadow-lg"
          role="status"
        >
          <span className="text-sm text-text">
            Save this address to your address book?
          </span>
          <button
            type="button"
            onClick={() => {
              toast.dismiss(t.id);
              navigate(
                `/dashboard/addresses?prefill=${encodeURIComponent(addr)}`,
              );
            }}
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-ycash hover:text-ycash-hover transition-colors"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => toast.dismiss(t.id)}
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim hover:text-text transition-colors"
          >
            Dismiss
          </button>
        </div>
      ),
      { duration: 8000 },
    );
  }, [pcztTransferStatus, formData.recipient, lookup, navigate]);

  return (
    <div className="w-full pb-16">
      {currentStep === TransferStep.INPUT && (
        <TransferInput
          formData={formData}
          nextStep={nextStep}
          handleChange={handleChange}
        />
      )}
      {currentStep === TransferStep.CONFIRM && (
        <TransferConfirm
          submitForm={submitForm}
          formData={formData}
          nextStep={nextStep}
        />
      )}
      {currentStep === TransferStep.RESULT && (
        <TransferResult
          pcztTransferStatus={pcztTransferStatus}
          resetForm={resetForm}
          errorMessage={lastError}
        />
      )}
    </div>
  );
}

export default TransferBalance;
