import React from 'react';
import useTransferBalanceForm, { TransferStep } from './useTransferBalanceForm';
import {
  TransferInput,
  TransferConfirm,
  TransferResult,
} from 'src/components/TransferCards';

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
