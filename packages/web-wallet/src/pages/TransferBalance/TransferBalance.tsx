import React from 'react';
import useTransferBalanceForm, { TransferStep } from './useTransferBalanceForm';
import PageHeading from '../../components/PageHeading/PageHeading';
import useBalance from '../../hooks/useBalance';
import { zatsToYec } from '../../utils';
import {
  TransferInput,
  TransferConfirm,
  TransferResult,
} from 'src/components/TransferCards';

function TransferBalance(): React.JSX.Element {
  const { shieldedBalance } = useBalance();
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

  return (
    <div className="w-full pb-16">
      {currentStep !== TransferStep.RESULT && (
        <PageHeading title="Send YEC" eyebrow="Private transfer">
          <div className="card-surface px-4 py-2 flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-dim">
              Shielded balance
            </span>
            <span className="mono text-sm text-ycash">
              {zatsToYec(shieldedBalance)} YEC
            </span>
          </div>
        </PageHeading>
      )}

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
